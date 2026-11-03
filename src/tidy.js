// The tidy (Will, 2 Nov: "clean up Leonardo da Vinci: look at all the repeats and bad files; a curated and tight set
// of the best of his work, all but the best copies"). A Commons feed brings every file in a category: the same painting
// scanned four times, a detail beside the whole, an infrared study, a strip of a predella, a 300-pixel thumbnail from
// 2006. The house keeps the record of every file (nothing is deleted); the tidy chooses which stand on the walls.
//   The look (`plan`): every work of the artist on view is read from its thumbnail: pixels, aspect, colour or grey,
//   flatness; a bad file is named (too small, a strip, blank, a detail or a copy by its title); repeats are found by the
//   fingerprint (dhash within TIDY_HASH) and confirmed by the pairs' look (normalised correlation across crops, ≥ TIDY_SAME),
//   gathered into groups; in each group the best copy is kept (not bad, in the catalogue, in colour when any is, the most
//   pixels, the sharpest) and the rest are repeats of it.
//   The hand (`apply`): the repeats and the bad files go off view (status 'hidden', keep_back, `works.tidy` says why and
//   of what), the artist's wall and page are redrawn; `undo` puts every tidied work of the artist back. Never deleted;
//   a work put back by hand on its record stays back (its tidy note is cleared there).
'use strict';
const sharp = require('sharp');

const MIN_MP = Number(process.env.TIDY_MIN_MP || 0.4);     // under this, a web thumbnail of long ago
const MIN_SIDE = Number(process.env.TIDY_MIN_SIDE || 500);
const STRIP = Number(process.env.TIDY_STRIP || 4);          // longer than this against its width: a strip
const HASH = Number(process.env.TIDY_HASH || 12);           // dhash bits apart to be looked at
const SAME = Number(process.env.TIDY_SAME || 0.9);          // the pairs' look: one picture
const COARSE = Number(process.env.TIDY_COARSE || 0.8);      // the cheap look before the full one
const BLUR = Number(process.env.TIDY_BLUR || 2);
const SIG = Number(process.env.TIDY_SIG || 0.7);
const SETTLE_EVERY = Number(process.env.TIDY_SETTLE_EVERY || 25);         // the 144-number signature: anything under is not looked at again
const NOT_WHOLE = /\b(history of painting|preface|bearbeitet|mystery|solution|analysis|analyse|hypothes\w*|reconstruction|enhanced|colori[sz]ed|detail|details|detalle|détail|crop|cropped|infrared|infra-red|x-ray|xray|radiograph|reflectogra\w*|ultraviolet|uv\b|before (the )?restoration|during restoration|copy after|after leonardo|replica|engraving|facsimile|reproduction|poster|stamp|coin|banknote|comparison|montage|collage|diagram|annotated|overlay|mirror(ed)?|flipped|inverted|rotated|thumbnail|screenshot|sketch of the|tracing|outline|verso detail)\b/i;

// A folio, a manuscript page, a page of a book: alike to the eye when softened (paper and ink), each its own work.
// These join only when all but identical (TIDY_PAGE_HASH, TIDY_PAGE_SAME), never by a chain.
const PAGE = /\b(codex|codice|manuscri\w*|folio|fol\.|carnet|notebook|taccuin\w*|recto|verso|page|feuillet)\b|\b\d{1,4}\s?[rv]\b|\d{3}[RV]-\d+/i;
const PAGE_HASH = Number(process.env.TIDY_PAGE_HASH || 6);
const PAGE_SAME = Number(process.env.TIDY_PAGE_SAME || 0.97);
const DETAIL_AT = Number(process.env.TIDY_DETAIL_AT || 0.8); // found at or under this scale inside another: a detail of it
function mountTidy(app, { db, V, images, cache, originalPath, ledger, studioOnly, pairs, governor }) {
  const { esc } = V;
  for (const [c, t] of [['tidy', 'TEXT'], ['tidy_at', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  const jobs = new Map(); // artist id → { on, at, n, done, plan, error }
  const artist = slug => db.prepare('SELECT * FROM artists WHERE slug=?').get(slug);
  const onView = a => db.prepare("SELECT id, slug, title, caption, width, height, dhash, source_url, stars, curated, original_file, maker_id, sha256 FROM works WHERE artist_id=? AND status='held' AND tidy IS NULL ORDER BY id").all(a.id);
  const tidied = a => db.prepare("SELECT id, slug, title, tidy FROM works WHERE artist_id=? AND tidy IS NOT NULL ORDER BY id").all(a.id);
  const catRow = w => { try { return app.locals.catalogue && app.locals.catalogue.rowOfWork ? app.locals.catalogue.rowOfWork(w) : null; } catch (e) { return null; } };
  const inCatalogue = w => !!catRow(w);
  const hamming = (a, b) => { if (!a || !b || a.length !== b.length) return 64; let d = 0; for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } } return d; };

  // What the thumbnail says of a file: its colour, its flatness, its sharpness.
  async function read(w) {
    const f = await images.derivativeOf(() => originalPath(w), cache, w.slug, 'thumb', 'jpg');
    // The grey picture, softened a little (blur 2 at 160 px): the pairs' look was made for the same frame at two sizes, where every
    // pixel lines up; a Commons scan and a second scan of the same painting are cut a hair differently, and a point-sampled
    // grid punishes that. Softened, a whole holds its 88% crop at .97 and a different picture stays under .4.
    const { data: gpx, info: gi } = await sharp(f).rotate().greyscale().resize(160, 160, { fit: 'inside', kernel: 'cubic' }).blur(BLUR).raw().toBuffer({ resolveWithObject: true });
    const grey = { w: gi.width, h: gi.height, px: gpx };
    const { data, info } = await sharp(f).rotate().resize(48, 48, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let sat = 0, n = info.width * info.height, sum = 0, sq = 0;
    for (let i = 0; i < data.length; i += 3) { const r = data[i], g = data[i + 1], b = data[i + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); sat += mx ? (mx - mn) / mx : 0; const l = (r + g + b) / 3; sum += l; sq += l * l; }
    const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
    // Sharpness: the mean absolute Laplacian of the grey picture, against its contrast.
    let lap = 0, m = 0; const { w: gw, h: gh, px } = grey;
    for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) { const i = y * gw + x; lap += Math.abs(4 * px[i] - px[i - 1] - px[i + 1] - px[i - gw] - px[i + gw]); m++; }
    return { grey, sat: sat / n, std, sharp: m ? lap / m / Math.max(8, std) : 0 };
  }
  function badOf(w, r) {
    const px = (w.width || 0) * (w.height || 0);
    if (px && px < MIN_MP * 1e6) return `too small (${Math.round(px / 1e4) / 100} MP)`;
    if (w.width && w.height && Math.max(w.width, w.height) / Math.min(w.width, w.height) > STRIP) return 'a strip';
    if ((w.width && w.width < MIN_SIDE) || (w.height && w.height < MIN_SIDE)) return `too small (${w.width} × ${w.height})`;
    if (r && r.std < 6) return 'blank';
    const m = `${w.title || ''} ${w.caption || ''}`.match(NOT_WHOLE); if (m) return `a detail or a copy (“${m[0]}”)`;
    return null;
  }
  // The look over an artist's set, in the background; the plan is kept on the job and in settings.
  async function plan(a) {
    const j = { on: true, at: new Date().toISOString(), n: 0, done: 0, plan: null, error: null }; jobs.set(a.id, j);
    try {
      const ws = onView(a); j.n = ws.length; const R = new Map();
      for (const w of ws) { try { R.set(w.id, await read(w)); } catch (e) { R.set(w.id, null); if (process.env.TIDY_DEBUG) console.error('[tidy] read', w.slug, e.message); } j.done++; if (governor && governor.settle && j.done % SETTLE_EVERY === 0) await governor.settle('tidy'); else await new Promise(r => setImmediate(r)); } // a thumbnail is light: the governor is asked every few, not every one (3 Nov: at every one, my own polling read as visitors and 3,725 would have taken three hours)
      const bad = new Map(); for (const w of ws) { const b = badOf(w, R.get(w.id)); if (b) bad.set(w.id, b); }
      // Repeats: the fingerprint names the candidates, the pairs' look decides; a union of what is one picture.
      const holds = new Map(); // id → how many others it contains as a small part (the whole over its details)
      const margin = new Set(); // ids that carry a frame or a page around the picture
      const link = new Map();   // 'a:b' → how alike, for the check against the kept copy
      const isPage = w => PAGE.test(`${w.title || ''}`);
      const parent = new Map(ws.map(w => [w.id, w.id])); const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
      const union = (x, y) => { x = find(x); y = find(y); if (x !== y) parent.set(y, x); };
      // Everything a pair needs is read once per work, never inside the pairs (3,725 Leonardos are seven million pairs):
      // the catalogue row, the fingerprint as two numbers, and a signature of 144 (the centre of the picture on a 12 grid,
      // normalised), whose dot product shortlists in a few operations. The loop yields to visitors every few thousand pairs.
      const cat = new Map(ws.map(w => [w.id, catRow(w)]));
      const hs = new Map(ws.map(w => [w.id, /^[0-9a-f]{16}$/i.test(w.dhash || '') ? [parseInt(w.dhash.slice(0, 8), 16) >>> 0, parseInt(w.dhash.slice(8), 16) >>> 0] : null]));
      const pop = x => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
      // Signatures at three scales of the centre (the whole, .85, .7), so a frame round the picture or a centred detail
      // still reaches the full look: A's whole against B's three, B's whole against A's two smaller.
      const sigOf = (r, sc) => { const v = pairs.sample(r.grey, 1, sc, 0.5, 0.5, 12, 12); let m = 0; for (const x of v) m += x; m /= v.length; let n2 = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; n2 += v[i] * v[i]; } n2 = Math.sqrt(n2) || 1; for (let i = 0; i < v.length; i++) v[i] /= n2; return v; };
      const sig = new Map(); for (const w of ws) { const r = R.get(w.id); if (r) sig.set(w.id, [sigOf(r, 1), sigOf(r, 0.85), sigOf(r, 0.7)]); }
      const dot1 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
      const dot = (A, B) => Math.max(dot1(A[0], B[0]), dot1(A[0], B[1]), dot1(A[0], B[2]), dot1(B[0], A[1]), dot1(B[0], A[2]));
      let tick = 0, lastYield = Date.now();
      for (let i = 0; i < ws.length; i++) for (let k = i + 1; k < ws.length; k++) {
        if (++tick % 200 === 0 && Date.now() - lastYield > 15) { await new Promise(r => setImmediate(r)); lastYield = Date.now(); } // never more than a few milliseconds away from a visitor
        const A = ws[i], B = ws[k]; const ra = R.get(A.id), rb = R.get(B.id); if (!ra || !rb) continue;
        const ca = cat.get(A.id), cb = cat.get(B.id); if (ca && cb && ca.id !== cb.id) continue; // two works the catalogue knows apart are never one (a series, a pair of panels)
        const ha = hs.get(A.id), hb = hs.get(B.id); const close = ha && hb && (pop(ha[0] ^ hb[0]) + pop(ha[1] ^ hb[1])) <= HASH;
        if (!close && dot(sig.get(A.id), sig.get(B.id)) < SIG) continue;
        const quick = pairs.quick(ra.grey, rb.grey); // the whole against the whole (a crop scores low here; the coarse look below sees it)
        if (pairs.score(ra.grey, rb.grey, true) < COARSE) continue;
        const pg = isPage(A) || isPage(B);
        if (pg && !(close && ha && hb && (pop(ha[0] ^ hb[0]) + pop(ha[1] ^ hb[1])) <= PAGE_HASH)) continue;
        const [ab, sab] = pairs.withinAt(ra.grey, rb.grey), [ba, sba] = pairs.withinAt(rb.grey, ra.grey); if (Math.max(ab, ba) < (pg ? PAGE_SAME : SAME)) continue;
        union(A.id, B.id); link.set(A.id + ':' + B.id, Math.max(ab, ba)); link.set(B.id + ':' + A.id, Math.max(ab, ba));
        // A small part found in another is its detail (the whole stands); found nearly whole inside a frame or a page, the
        // tighter one is the painting itself and the larger carries a margin (the clean scan stands).
        if (ab >= ba && sab <= DETAIL_AT) holds.set(A.id, (holds.get(A.id) || 0) + 1);
        else if (ba > ab && sba <= DETAIL_AT) holds.set(B.id, (holds.get(B.id) || 0) + 1);
        else if (ab >= SAME && sab < 0.97 && quick < SAME) margin.add(A.id);
        else if (ba >= SAME && sba < 0.97 && quick < SAME) margin.add(B.id);
      }
      const groups = new Map(); for (const w of ws) { const r = find(w.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(w); }
      const rank = (w, colour) => { const r = R.get(w.id) || {}; let s = 0; if (!bad.has(w.id)) s += 100; if (cat.get(w.id)) s += 30; s += holds.get(w.id) ? 25 : 0; if (margin.has(w.id)) s -= 40; if (colour && r.sat > 0.08) s += 20; if (w.curated) s += 10; s += Math.log2(Math.max(1, (w.width || 0) * (w.height || 0)) / 1e5) * 4; s += Math.min(8, (r.sharp || 0) * 4); return s; };
      const out = { groups: [], bad: [], n: ws.length, at: new Date().toISOString() };
      for (const g of groups.values()) {
        if (g.length < 2) continue;
        const colour = g.some(w => (R.get(w.id) || {}).sat > 0.08);
        g.sort((x, y) => rank(y, colour) - rank(x, colour));
        // No chains: every repeat must be alike to the kept copy itself; the rest stand alone again.
        { const k0 = g[0]; const rk = R.get(k0.id); for (let i = g.length - 1; i >= 1; i--) { const o = g[i]; let v = link.get(k0.id + ':' + o.id); if (v == null) { const ro = R.get(o.id); v = rk && ro ? Math.max(pairs.within(rk.grey, ro.grey), pairs.within(ro.grey, rk.grey)) : 0; await new Promise(r => setImmediate(r)); } if (v < ((isPage(k0) || isPage(o)) ? PAGE_SAME : SAME)) g.splice(i, 1); } }
        if (g.length < 2) continue;
        const keep = g[0]; const bk = bad.get(keep.id); if (bk) bad.delete(keep.id); // the best of a group stands even when small: it is the only copy
        out.groups.push({ keep: { slug: keep.slug, title: keep.title, w: keep.width, h: keep.height, cat: !!cat.get(keep.id), bad: bk || null }, others: g.slice(1).map(w => ({ slug: w.slug, title: w.title, w: w.width, h: w.height, why: `a repeat of ${keep.slug}` })) });
        for (const w of g.slice(1)) bad.delete(w.id);
      }
      for (const [id, why] of bad) { const w = ws.find(x => x.id === id); out.bad.push({ slug: w.slug, title: w.title, w: w.width, h: w.height, why }); }
      out.repeats = out.groups.reduce((s, g) => s + g.others.length, 0);
      j.plan = out; try { db.prepare("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(`tidy_plan_${a.id}`, JSON.stringify(out)); } catch (e) { /* kept in memory */ }
    } catch (e) { j.error = e.message; console.error('[tidy]', a.slug, e.message); }
    j.on = false; return j.plan;
  }
  const planOf = a => { const j = jobs.get(a.id); if (j && j.plan) return j.plan; try { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(`tidy_plan_${a.id}`); return r ? JSON.parse(r.v) : null; } catch (e) { return null; } };
  function after(a) { try { if (app.locals.art) { app.locals.art.wall(a); app.locals.art.uncache(a.slug); } } catch (e) { /* the page follows within the minute */ } try { if (app.locals.findIndexDirty) app.locals.findIndexDirty(); } catch (e) { /* */ } }
  // The hand: off view, named, reversible.
  function apply(a, p = planOf(a)) {
    if (!p) return 0; let n = 0; const now = new Date().toISOString();
    const hide = db.prepare("UPDATE works SET status='hidden', status_before='held', keep_back=1, tidy=?, tidy_at=? WHERE slug=? AND artist_id=? AND status='held' AND tidy IS NULL");
    const run = db.transaction(() => {
      for (const g of p.groups) for (const o of g.others) if (hide.run(o.why, now, o.slug, a.id).changes) { n++; try { ledger.append(db, 'work.tidied', o.slug, { artist: a.slug, why: o.why }); } catch (e) { /* */ } }
      for (const b of p.bad) if (hide.run(`a bad file: ${b.why}`, now, b.slug, a.id).changes) { n++; try { ledger.append(db, 'work.tidied', b.slug, { artist: a.slug, why: b.why }); } catch (e) { /* */ } }
    }); run();
    try { db.prepare('DELETE FROM settings WHERE k=?').run(`tidy_plan_${a.id}`); } catch (e) { /* */ } jobs.delete(a.id);
    after(a); return n;
  }
  function undo(a) {
    const rows = tidied(a);
    const back = db.prepare("UPDATE works SET status='held', keep_back=0, tidy=NULL, tidy_at=NULL WHERE id=? AND tidy IS NOT NULL");
    const run = db.transaction(() => { for (const w of rows) { back.run(w.id); try { ledger.append(db, 'work.untidied', w.slug, { artist: a.slug }); } catch (e) { /* */ } } }); run();
    after(a); return rows.length;
  }

  const th = (w, cls = '') => `<a class="tyd-w ${cls}" href="/studio/works/${esc(w.slug)}" title="${esc(w.title || w.slug)} · ${w.w || '?'} × ${w.h || '?'}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span>${esc(w.title || w.slug)}<small>${w.w || '?'} × ${w.h || '?'}${w.cat ? ' · in the catalogue' : ''}${w.bad ? ` · ${esc(w.bad)}` : ''}</small></span></a>`;
  function page(req, res, a) {
    const j = jobs.get(a.id); const p = planOf(a); const on = onView(a).length; const gone = tidied(a);
    const body = `<section class="studio-wrap tyd"><p class="k"><a href="/studio/art">The art</a> · <a href="/studio/art/${esc(a.slug)}">${esc(a.name)}</a></p><h1>The tidy</h1>
<p class="note">${on} works on view · ${gone.length} off view by the tidy. A Commons category brings every file: the same painting scanned four times, a detail beside the whole, a strip, an old thumbnail. The look reads each file and finds the repeats; the hand takes the lesser copies off view, named, reversible. Nothing is deleted.</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
${j && j.on ? `<p class="tyd-live" data-tyd-live>Looking… ${j.done} of ${j.n} read.</p><script>setTimeout(()=>location.reload(),4000)</script>` : `<form method="post" action="/studio/art/${esc(a.slug)}/tidy/plan" class="ax-f"><button class="buy-btn">${p ? 'Look again' : 'Look at the set'}</button> <span class="note">reads every file on view; a few minutes for a thousand</span></form>`}
${j && j.error ? `<p class="tyd-err">The look stopped: ${esc(j.error)}</p>` : ''}
${p && !(j && j.on) ? `<h2>${p.repeats} repeats in ${p.groups.length} groups · ${p.bad.length} bad files · of ${p.n} looked at${p.at ? ` · ${esc(V.date ? V.date(p.at) : p.at)}` : ''}</h2>
${p.repeats || p.bad.length ? `<form method="post" action="/studio/art/${esc(a.slug)}/tidy/apply" class="ax-f tyd-apply"><button class="buy-btn">Take ${p.repeats + p.bad.length} off view</button> <span class="note">the best copy of each group stays; the rest and the bad files go off view, named</span></form>` : '<p class="note">Nothing to take off: the set is tight.</p>'}
${p.groups.map(g => `<div class="tyd-g"><div class="tyd-keep">${th(g.keep, 'tyd-best')}</div><div class="tyd-rest">${g.others.map(o => th(o)).join('')}</div></div>`).join('')}
${p.bad.length ? `<h3>Bad files</h3><div class="tyd-bad">${p.bad.map(b => th({ ...b, bad: b.why })).join('')}</div>` : ''}` : ''}
${gone.length ? `<h2>Off view by the tidy · ${gone.length}</h2><form method="post" action="/studio/art/${esc(a.slug)}/tidy/undo" class="ax-f"><button class="btn">Put them all back</button></form><div class="tyd-gone">${gone.slice(0, 400).map(w => `<a href="/studio/works/${esc(w.slug)}" title="${esc(w.tidy)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"></a>`).join('')}</div>` : ''}</section>`;
    res.send(V.layout({ title: `The tidy · ${a.name} · Studio · Watermark`, path: '/studio/art', studio: true, body }));
  }
  app.get('/studio/art/:slug/tidy', studioOnly, (req, res) => { const a = artist(req.params.slug); if (!a) return res.sendStatus(404); page(req, res, a); });
  app.post('/studio/art/:slug/tidy/plan', studioOnly, (req, res) => {
    const a = artist(req.params.slug); if (!a) return res.sendStatus(404);
    const j = jobs.get(a.id); if (!(j && j.on)) { const go = () => plan(a); if (governor && governor.turn) governor.turn(`tidy ${a.slug}`, go).catch(() => {}); else go(); }
    if (req.body && req.body.json) return res.json({ ok: true });
    res.redirect(`/studio/art/${a.slug}/tidy`);
  });
  app.post('/studio/art/:slug/tidy/apply', studioOnly, (req, res) => { const a = artist(req.params.slug); if (!a) return res.sendStatus(404); const n = apply(a); if (req.body && req.body.json) return res.json({ ok: true, n }); res.redirect(`/studio/art/${a.slug}/tidy?ok=${encodeURIComponent(`${n} taken off view.`)}`); });
  app.post('/studio/art/:slug/tidy/undo', studioOnly, (req, res) => { const a = artist(req.params.slug); if (!a) return res.sendStatus(404); const n = undo(a); if (req.body && req.body.json) return res.json({ ok: true, n }); res.redirect(`/studio/art/${a.slug}/tidy?ok=${encodeURIComponent(`${n} put back.`)}`); });
  app.locals.tidy = { plan, planOf, apply, undo, badOf, jobs, state: a => { const j = jobs.get(a.id); return j ? { on: j.on, n: j.n, done: j.done, error: j.error } : null; } };
  return app.locals.tidy;
}
module.exports = { mountTidy, NOT_WHOLE };
