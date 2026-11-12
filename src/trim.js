'use strict';
// Trimming the scans (12 Nov, issue #1; Will, 11 Nov, Monet in Wander: "they don't fit the frame; they all differ").
// A museum's or Wikimedia's scan of a painting often carries a strip of the scanner bed, a paper margin, a black or
// white bar at an edge; shown edge to edge on the dark wall it looks careless. The house proposes a trim box per shelf
// work (`works.trim_read`), a person applies it on the desk (/studio/trim), and only then is it kept on `works.trim`
// ({x, y, w, h} as fractions of the upright picture, `by`, `at`). It is applied when the display copies are made
// (images.js: one extract from the master, before the resize; the trimmed copies carry the box's hash in their names);
// the master is never touched, and Undo puts the untrimmed copies back.
//
// How the house decides, side by side, from the screen copy at 1024 px (conservative: when in doubt, nothing):
//   - the outermost line is near-uniform (one colour, within BAND_TOL) — a margin, a bed, a bar;
//   - walking in from each position along the side, the band ends where the picture begins (a pixel more than STEP
//     away from the band's colour), within TRIM_MAX (6%) of the picture; the edge is found along at least COVER (90%)
//     of the side's length;
//   - it is straight: the depths along the side agree within TRIM_STRAIGHT (2 px at the measured scale);
//   - it is abrupt: across the edge the colour jumps by STEP within three pixels (a sky fading to the edge does not);
//   - the picture just inside differs from the band (so a flat field of the painting's own, a black ground running to
//     the edge, is never mistaken for a border: there the edge is not found, or is not straight, and nothing is cut).
// The cut is the edge's depth plus half a measured pixel and a 2-px inset at full size, so no sliver survives.
// Never: a living maker's work, a page of a volume, a drawing or a print (a sheet's margin is part of the object), or a
// work not on the shelves (frick.js's SHELF).
const sharp = require('sharp');
const fs = require('fs');
const ROLE = require('./role');

const N = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && process.env[k] !== '' && process.env[k] != null ? v : d; };
const TRIM_MAX = () => N('TRIM_MAX', 0.06);
const STRAIGHT = () => N('TRIM_STRAIGHT', 2);
const BAND_TOL = 18, STEP = 28, COVER = 0.9, MEASURE = 1024, INSET = 2;

// The analysis of raw RGB (3 channels), W × H. → { sides: {top, bottom, left, right}: {px, why} , found: [names] }
function detect(px, W, H) {
  const dist = (i, c) => Math.max(Math.abs(px[i] - c[0]), Math.abs(px[i + 1] - c[1]), Math.abs(px[i + 2] - c[2]));
  const out = {};
  for (const name of ['top', 'bottom', 'left', 'right']) {
    const horiz = name === 'top' || name === 'bottom';
    const L = horiz ? W : H, D = horiz ? H : W;
    const at = (k, t) => { const x = horiz ? t : (name === 'left' ? k : W - 1 - k); const y = horiz ? (name === 'top' ? k : H - 1 - k) : t; return (y * W + x) * 3; };
    const dmax = Math.floor(TRIM_MAX() * D);
    if (dmax < 1) { out[name] = { px: 0, why: 'too small to measure' }; continue; }
    // The band's colour: the median of the outermost line, which must itself be near-uniform.
    const ch = [[], [], []]; for (let t = 0; t < L; t++) { const i = at(0, t); ch[0].push(px[i]); ch[1].push(px[i + 1]); ch[2].push(px[i + 2]); }
    const band = ch.map(a => a.sort((p, q) => p - q)[a.length >> 1]);
    let off = 0; for (let t = 0; t < L; t++) if (dist(at(0, t), band) > BAND_TOL) off++;
    if (off > L * 0.05) { out[name] = { px: 0, why: 'no band: the edge is the picture' }; continue; }
    // The depth of the band at each position along the side.
    const ds = []; const jumps = []; let inner = [0, 0, 0], innerN = 0;
    for (let t = 0; t < L; t++) {
      let d = -1; for (let k = 1; k <= dmax + 1; k++) if (dist(at(k, t), band) > STEP) { d = k; break; }
      if (d < 1 || d > dmax) continue;
      ds.push(d);
      const a = at(Math.min(D - 1, d + 1), t), b = at(Math.max(0, d - 2), t);
      jumps.push(Math.max(Math.abs(px[a] - px[b]), Math.abs(px[a + 1] - px[b + 1]), Math.abs(px[a + 2] - px[b + 2])));
      for (let k = d + 2; k < Math.min(D, d + 7); k++) { const i = at(k, t); inner[0] += px[i]; inner[1] += px[i + 1]; inner[2] += px[i + 2]; innerN++; }
    }
    if (ds.length < L * COVER) { out[name] = { px: 0, why: `the band does not end in an edge along the side (${Math.round(100 * ds.length / L)}%)` }; continue; }
    ds.sort((p, q) => p - q); jumps.sort((p, q) => p - q);
    const lo = ds[Math.floor(ds.length * 0.05)], hi = ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.95))];
    if (hi - lo > STRAIGHT()) { out[name] = { px: 0, why: `the edge is not straight (${lo}–${hi} px)` }; continue; }
    const jump = jumps[jumps.length >> 1];
    if (jump < STEP) { out[name] = { px: 0, why: `the edge fades (${jump} levels)` }; continue; }
    inner = inner.map(v => v / Math.max(1, innerN));
    const differs = Math.max(...inner.map((v, i) => Math.abs(v - band[i])));
    if (differs < STEP) { out[name] = { px: 0, why: 'the picture inside is the band’s colour' }; continue; }
    const deep = ds[ds.length - 1]; // the deepest position: no sliver anywhere along the side
    if (deep > dmax) { out[name] = { px: 0, why: 'deeper than the most the house will trim' }; continue; }
    out[name] = { px: deep, measured: D, band, jump, why: `a ${band.every(v => v > 200) ? 'pale' : band.every(v => v < 50) ? 'dark' : ''} band ${deep} px deep`.replace('  ', ' ') };
  }
  return out;
}
// The sides → a box of fractions of the upright full picture (fullW × fullH), or null when nothing is found.
function boxOf(sides, fullW, fullH) {
  const frac = (s, full) => { if (!s || !s.px) return 0; const f = (s.px + 0.5) / s.measured + INSET / Math.max(1, full); return f > TRIM_MAX() + 0.004 ? null : f; };
  const t = frac(sides.top, fullH), b = frac(sides.bottom, fullH), l = frac(sides.left, fullW), r = frac(sides.right, fullW);
  if ([t, b, l, r].some(v => v === null)) return null;
  if (!(t || b || l || r)) return null;
  const R = v => Math.round(v * 1e5) / 1e5;
  return { x: R(l), y: R(t), w: R(1 - l - r), h: R(1 - t - b) };
}

function mountTrim(app, { db, V, ledger, studioOnly, images, cache, originalPath }) {
  const { esc } = V;
  for (const [c, t] of [['trim', 'TEXT'], ['trim_read', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)');
  const quiet = !!app.locals.noTimers;
  const G = () => app.locals.governor;
  const SHELF = (app.locals.frick && app.locals.frick.SHELF) || "(w.open IN ('pd','cc0','cc-by','cc-by-sa') OR m.kind IN ('institution') OR m.handle='the-public-domain')";
  // Who may be trimmed: the shelves, never a living maker (even of an open work), never a page of a volume, a drawing or a print.
  const MAY = `${SHELF} AND NOT (COALESCE(m.kind,'maker') IN ('maker','estate','writer') AND m.handle<>'the-public-domain') AND w.vol_page IS NULL AND COALESCE(w.kind,'') NOT IN ('drawing','print')`;
  const may = slug => !!db.prepare(`SELECT 1 FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.slug=? AND w.status='held' AND ${MAY}`).get(slug);
  const parse = s => { try { return JSON.parse(s || 'null'); } catch (e) { return null; } };
  const setting = k => { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? r.v : null; };
  const put = (k, v) => db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
  const del = k => db.prepare('DELETE FROM settings WHERE k=?').run(k);

  // The boxes every process knows (images.js asks by slug, synchronously); read from the database each minute and on
  // every change here; `note(w)` refreshes one from a row in hand (copies.js, before making a set).
  const boxes = new Map();
  const load = () => { try { boxes.clear(); for (const r of db.prepare('SELECT slug, trim FROM works WHERE trim IS NOT NULL').all()) { const t = parse(r.trim); if (t && t.w > 0 && t.h > 0) boxes.set(r.slug, t); } } catch (e) { /* the next minute */ } };
  const note = w => { if (!w || !w.slug) return; const t = parse(w.trim); if (t && t.w > 0 && t.h > 0) boxes.set(w.slug, t); else boxes.delete(w.slug); };
  load(); images.setTrim(slug => boxes.get(slug) || null);
  if (!quiet) setInterval(load, 60e3).unref();

  // One work read: the screen copy (untrimmed) at 1024 px → the sides and the box.
  async function read(w) {
    const f = await images.derivativeOf(() => originalPath(w), cache, w.slug, 'screen', 'jpg');
    const file = typeof f === 'string' ? f : f && f.file; if (!file) throw new Error('no screen copy yet');
    const { data, info } = await sharp(file).rotate().removeAlpha().toColourspace('srgb').resize(MEASURE, MEASURE, { fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const sides = detect(data, info.width, info.height);
    const box = boxOf(sides, w.width || info.width, w.height || info.height);
    return { at: new Date().toISOString(), box, sides: Object.fromEntries(Object.entries(sides).map(([k, v]) => [k, { px: v.px, why: v.why }])) };
  }
  async function propose(slug) {
    const w = db.prepare(`SELECT w.id, w.slug, w.width, w.height, w.original_file, w.sha256, w.maker_id FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.slug=? AND w.status='held' AND w.trim IS NULL AND ${MAY}`).get(slug);
    if (!w) return null;
    const r = await read(w); db.prepare('UPDATE works SET trim_read=? WHERE id=?').run(JSON.stringify(r), w.id); return r;
  }

  // The job: the next N unread shelf works, one at a time through the governor's lane, on the chores process (a split
  // house's website only writes the ask, `trim_run`; the chores process takes it up within half a minute). Never applies.
  const job = { running: false, done: 0, total: 0, found: 0, failed: 0, last: null, at: null };
  const tell = () => { try { put('trim_job', JSON.stringify({ ...job, beat: Date.now() })); } catch (e) { /* */ } };
  function run(n) {
    if (job.running) return job;
    const ids = db.prepare(`SELECT w.slug FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.trim IS NULL AND w.trim_read IS NULL AND ${MAY} ORDER BY COALESCE(w.curated,0) DESC, COALESCE(w.stars,0) DESC, w.id LIMIT ?`).all(Math.max(1, Math.min(2000, +n || 50))).map(r => r.slug);
    Object.assign(job, { running: true, done: 0, total: ids.length, found: 0, failed: 0, last: null, at: new Date().toISOString() }); tell();
    (async () => {
      for (const slug of ids) {
        const g = G();
        try { const r = g && g.turn ? await g.turn('trim', () => propose(slug)) : await propose(slug); if (r && r.box) job.found++; } catch (e) { job.failed++; job.last = e.message; }
        job.done++; if (job.done % 5 === 0) tell();
        if (g && g.settle && !quiet) await g.settle('trim'); else await new Promise(r => setImmediate(r));
      }
    })().catch(e => { job.last = e.message; }).finally(() => { job.running = false; job.at = new Date().toISOString(); tell(); try { del('trim_run'); } catch (e) { /* */ } try { ledger.append(db, 'trim.read', 'house', { read: job.done - job.failed, found: job.found }); } catch (e) { /* */ } });
    return job;
  }
  const ask = n => { put('trim_run', JSON.stringify({ n: +n || 50, at: Date.now() })); if (ROLE.chores) run(+n || 50); };
  if (!quiet && ROLE.chores) setInterval(() => { try { const a = parse(setting('trim_run')); if (a && !job.running) run(a.n); } catch (e) { /* */ } }, 30e3).unref();

  // Apply, refuse, undo.
  const remake = slug => {
    db.prepare('UPDATE works SET copies_at=NULL, copies_tries=0 WHERE slug=?').run(slug);
    try { if (app.locals.copies) app.locals.copies.ask(slug); } catch (e) { /* the scribes find it by copies_at */ }
    try { if (app.locals.edge && app.locals.edge.work) app.locals.edge.work(slug); } catch (e) { /* the hour */ }
  };
  function apply(slug) {
    if (!may(slug)) return { ok: false, why: 'not a shelf work the house may trim' };
    const w = db.prepare('SELECT id, slug, trim_read FROM works WHERE slug=?').get(slug); const r = parse(w && w.trim_read);
    if (!r || !r.box) return { ok: false, why: 'no trim proposed' };
    const t = { ...r.box, by: 'house', at: new Date().toISOString() };
    db.prepare('UPDATE works SET trim=? WHERE id=?').run(JSON.stringify(t), w.id); boxes.set(slug, t);
    remake(slug); try { ledger.append(db, 'work.trimmed', slug, { box: r.box }); } catch (e) { /* */ }
    return { ok: true, trim: t };
  }
  function dismiss(slug) {
    const w = db.prepare('SELECT id, trim_read FROM works WHERE slug=?').get(slug); const r = parse(w && w.trim_read); if (!r) return { ok: false };
    r.dismissed = new Date().toISOString(); db.prepare('UPDATE works SET trim_read=? WHERE id=?').run(JSON.stringify(r), w.id); return { ok: true };
  }
  async function undo(slug) {
    const w = db.prepare('SELECT id, slug, trim FROM works WHERE slug=?').get(slug); if (!w || !w.trim) return { ok: false, why: 'not trimmed' };
    // the trimmed copies go (the disk and the bucket) while the box still names them; the untrimmed ones were never moved
    for (const size of Object.keys(images.SIZES)) for (const fmt of Object.keys(images.FORMATS)) { try { fs.unlinkSync(images.fileOf(cache, slug, size, fmt)); } catch (e) { /* none */ } }
    try { await images.dropBucket(cache, slug); } catch (e) { /* the bucket keeps a stray copy */ }
    db.prepare('UPDATE works SET trim=NULL WHERE id=?').run(w.id); boxes.delete(slug);
    remake(slug); try { ledger.append(db, 'work.untrimmed', slug, {}); } catch (e) { /* */ }
    return { ok: true };
  }

  // The desk.
  const pct = v => `${Math.round(v * 1000) / 10}%`;
  const sideLine = b => [['top', b.y], ['bottom', 1 - b.y - b.h], ['left', b.x], ['right', 1 - b.x - b.w]].filter(([, v]) => v > 0.00001).map(([k, v]) => `${k} ${pct(v)}`).join(' · ');
  // Before and after from the untrimmed thumb (no picture work on the website): after is the same file cut by CSS.
  const pair = (w, b) => { const ar = (w.width && w.height ? (w.width * b.w) / (w.height * b.h) : 1.5).toFixed(4); const before = `/studio/trim/${esc(w.slug)}/before.jpg`; return `<div class="trm-pair"><figure><div class="trm-in"><img src="${before}" alt="" loading="lazy"><span class="trm-box" style="left:${pct(b.x)};top:${pct(b.y)};width:${pct(b.w)};height:${pct(b.h)}"></span></div><figcaption>Before</figcaption></figure><figure><div class="trm-cut" style="aspect-ratio:${ar}"><img src="${before}" alt="" loading="lazy" style="width:${(100 / b.w).toFixed(3)}%;left:${(-100 * b.x / b.w).toFixed(3)}%;top:${(-100 * b.y / b.h).toFixed(3)}%"></div><figcaption>After</figcaption></figure></div>`; };
  const form = (to, slug, label, cls = 'btn') => `<form method="post" action="/studio/trim/${to}"><input type="hidden" name="slug" value="${esc(slug)}"><button class="${cls}">${label}</button></form>`;
  app.get('/studio/trim', studioOnly, (req, res) => {
    const rows = db.prepare(`SELECT w.slug, w.title, w.width, w.height, w.trim, w.trim_read FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND (w.trim IS NOT NULL OR w.trim_read IS NOT NULL) AND ${MAY} ORDER BY w.id DESC LIMIT 2000`).all();
    const proposed = [], applied = []; let read = 0, none = 0, dismissed = 0;
    for (const w of rows) { const r = parse(w.trim_read), t = parse(w.trim); if (r) read++; if (t) { applied.push({ ...w, b: t }); continue; } if (!r) continue; if (r.dismissed) { dismissed++; continue; } if (r.box) proposed.push({ ...w, b: r.box, r }); else none++; }
    const unread = db.prepare(`SELECT COUNT(*) n FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.trim IS NULL AND w.trim_read IS NULL AND ${MAY}`).get().n;
    const j = job.running ? job : (parse(setting('trim_job')) || null); const asked = parse(setting('trim_run'));
    const tile = (w, acts) => `<article class="trm-w"><a class="trm-t" href="/studio/works/${esc(w.slug)}">${esc(w.title || w.slug)}</a>${pair(w, w.b)}<p class="trm-l">${sideLine(w.b)}</p><div class="trm-a">${acts}</div></article>`;
    const body = `<section class="wrap trm"><p class="kicker">Bringing in</p><h1>Trim the scans</h1>
<p class="note">The shelves only (the public domain and the museums' open access; never a living maker's work, a page of a volume, a drawing or a print). The house reads each scan's edges and proposes a trim when a straight, abrupt band (a scanner bed, a paper margin, a bar) runs along a side, at most ${pct(TRIM_MAX())} of it; a flat field of the picture's own is left alone. Nothing is trimmed until you apply it. The master is never touched: only the display copies are cut, and Undo puts the untrimmed copies back.</p>
${req.query.ok ? `<p class="ok">${esc(String(req.query.ok))}</p>` : ''}
<p class="trm-n">${read} read · ${proposed.length} proposed · ${applied.length} applied · ${none} with nothing to trim · ${dismissed} set aside · ${unread} unread</p>
${j && j.running ? `<p class="trm-live">Reading… ${j.done} of ${j.total} · ${j.found} with a trim${j.failed ? ` · ${j.failed} could not be read` : ''}</p><script>setTimeout(()=>location.reload(),5000)</script>` : asked ? '<p class="trm-live">Asked; the house begins within half a minute.</p><script>setTimeout(()=>location.reload(),8000)</script>' : `<form class="trm-run" method="post" action="/studio/trim/propose"><label>Propose for the next <input type="number" name="n" value="50" min="1" max="2000"></label><button class="buy-btn">Read them</button></form>${j && j.last ? `<p class="note">Last: ${esc(j.last)}</p>` : ''}`}
${proposed.length ? `<h2>Proposed · ${proposed.length}</h2><div class="trm-g">${proposed.slice(0, 300).map(w => tile(w, form('apply', w.slug, 'Apply', 'buy-btn') + form('dismiss', w.slug, 'Not this one'))).join('')}</div>` : ''}
${applied.length ? `<h2>Applied · ${applied.length}</h2><div class="trm-g">${applied.slice(0, 300).map(w => tile(w, form('undo', w.slug, 'Undo'))).join('')}</div>` : ''}
</section>`;
    res.set('Cache-Control', 'private, no-store').send(V.layout({ title: 'Trim the scans · Studio · Watermark', path: '/studio/trim', studio: true, body }));
  });
  // The untrimmed thumb, by its own name (the disk, else the bucket); never made here.
  app.get('/studio/trim/:slug/before.jpg', studioOnly, async (req, res) => {
    const slug = String(req.params.slug); const f = images.fileOf(cache, slug, 'thumb', 'jpg', null);
    if (!fs.existsSync(f) && !(await images.fromBucket(f))) { if (!boxes.has(slug)) return res.redirect(`/img/${encodeURIComponent(slug)}/thumb`); return res.sendStatus(404); }
    res.set('Cache-Control', 'private, no-store').sendFile(f);
  });
  const back = (res, ok) => res.redirect('/studio/trim?ok=' + encodeURIComponent(ok));
  const slugOf = req => String((req.body && req.body.slug) || '');
  const json = req => !!(req.body && req.body.json);
  app.post('/studio/trim/propose', studioOnly, (req, res) => { const n = Math.max(1, Math.min(2000, +(req.body && req.body.n) || 50)); ask(n); if (json(req)) return res.json({ ok: true, job }); back(res, `Reading the next ${n}.`); });
  app.post('/studio/trim/apply', studioOnly, (req, res) => { const r = apply(slugOf(req)); if (json(req)) return res.status(r.ok ? 200 : 403).json(r); back(res, r.ok ? 'Applied; the copies are being remade.' : `Not applied: ${r.why}.`); });
  app.post('/studio/trim/dismiss', studioOnly, (req, res) => { const r = dismiss(slugOf(req)); if (json(req)) return res.json(r); back(res, 'Set aside.'); });
  app.post('/studio/trim/undo', studioOnly, async (req, res) => { const r = await undo(slugOf(req)); if (json(req)) return res.json(r); back(res, r.ok ? 'Undone; the untrimmed copies are back.' : `Nothing to undo: ${r.why}.`); });

  const api = { detect, boxOf, read, propose, run, ask, apply, dismiss, undo, note, load, may, job, boxes, TRIM_MAX };
  app.locals.trim = api;
  return api;
}
module.exports = { mountTrim, detect, boxOf };
