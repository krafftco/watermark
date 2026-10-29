// Hang my best (29 Oct, Will: "we need to put my best work up"; "my people work too, even without a release for some
// street photography"; "everybody but [one person] is pretty much good to put up"; "and maybe some of the kids: just
// a check"; "we need to find ways to prevent bad photos from going up"). One room at /account/hang that sorts the
// maker's kept-back work at or above a grade into what can hang now and what wants one look first, and hangs the
// first group in one act. Nothing is ever published by guesswork and nothing is deleted.
//   clear     graded, no recognisable people in Al's reading, the file sound → hung by 'Hang them'
//   people    recognisable people (street work, portraits) → one look: tap any to keep it back, hang the rest
//   children  a child likely in the picture → the same look
//   check     the file itself is doubtful: small for the walls, soft, badly exposed, or a near twin from one burst
//             (the best-graded of a burst stays clear) → held unless tapped in
//   unread    Al has not read it yet (no key, or not reached) → the same look as people
//   kept      kept back by the maker (`works.keep_back`): every publish refuses it, by batch, Library or here
// The checks are the house's own, from the thumb (`qc` on works, cached by fingerprint): megapixels against
// HANG_MIN_MP (12), sharpness as the spread of a Laplacian against the maker's own median (under HANG_SOFT .45 of
// it is soft), exposure as the share of the frame clipped to black or white (over HANG_CLIP .3).
// A person shown can always ask for a picture to come down (the claims door); a company's or a campaign's use stays
// closed until a release is in (clearance.js). Every word a draft for Will.
'use strict';
const sharp = require('sharp');

const MIN_MP = Number(process.env.HANG_MIN_MP || 12);
const SOFT = Number(process.env.HANG_SOFT || 0.45);
const CLIP = Number(process.env.HANG_CLIP || 0.3);
const TWIN = Number(process.env.HANG_TWIN || 0.9);

function mountHangBest(app, { db, V, images, cache, originalPath, ledger, makerOf }) {
  for (const [c, t] of [['keep_back', 'INTEGER NOT NULL DEFAULT 0'], ['qc', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  const esc = V.esc;
  const P = require('./pairs');
  const thumbOf = async w => { try { return await images.derivative(await originalPath(w), cache, w.slug, 'thumb', 'jpg'); } catch (e) { return null; } };

  // The house's look at the file: sharpness and exposure from the thumb, kept by fingerprint.
  async function qc(w) {
    try { const q = w.qc ? JSON.parse(w.qc) : null; if (q && q.sha === w.sha256) return q; } catch (e) { /* again */ }
    const t = await thumbOf(w); if (!t) return null;
    const g = sharp(t).greyscale().resize(600, 600, { fit: 'inside' });
    const lap = await g.clone().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).raw().toBuffer();
    let s = 0, s2 = 0; for (const v of lap) { s += v; s2 += v * v; } const n = lap.length || 1; const sharpness = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
    const px = await g.clone().raw().toBuffer(); let lo = 0, hi = 0; for (const v of px) { if (v <= 4) lo++; else if (v >= 251) hi++; }
    const q = { sha: w.sha256, sharpness: Math.round(sharpness * 100) / 100, black: Math.round(lo / px.length * 1000) / 1000, white: Math.round(hi / px.length * 1000) / 1000 };
    db.prepare('UPDATE works SET qc=? WHERE id=?').run(JSON.stringify(q), w.id); return q;
  }
  const read = w => { try { return w.attribution ? JSON.parse(w.attribution) : null; } catch (e) { return null; } };
  const mp = w => ((w.width || 0) * (w.height || 0)) / 1e6;

  // The sort. `jobs` keeps one run per maker so a long archive is looked at in the background while the page waits.
  const jobs = new Map();
  async function plan(m, from) {
    const rows = db.prepare(`SELECT * FROM works WHERE maker_id=? AND status IN ('hidden','held') AND (stars >= ? OR curated=1) ORDER BY stars DESC, id`).all(m.id, from);
    const out = { clear: [], people: [], children: [], check: [], unread: [], kept: [], hung: [] };
    const looks = [];
    for (const w of rows) {
      if (w.status === 'held') { out.hung.push({ w }); continue; }
      if (w.keep_back) { out.kept.push({ w }); continue; }
      if (w.flag === 'reject' || w.disputed > 0) continue;
      const q = await qc(w); looks.push({ w, q });
      await new Promise(r => setImmediate(r));
    }
    const sharp0 = looks.map(x => x.q && x.q.sharpness).filter(Boolean).sort((a, b) => a - b);
    const median = sharp0.length ? sharp0[Math.floor(sharp0.length / 2)] : 0;
    // A burst: the same moment to the second and the same picture; the best-graded (then the largest) stays.
    const byMoment = new Map();
    for (const x of looks) { const k = x.w.taken_at ? String(x.w.taken_at).slice(0, 19) : null; if (!k) continue; if (!byMoment.has(k)) byMoment.set(k, []); byMoment.get(k).push(x); }
    const twin = new Map();
    for (const group of byMoment.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => (b.w.stars - a.w.stars) || (mp(b.w) - mp(a.w)));
      const g0 = await P.greyOf(await thumbOf(group[0].w)).catch(() => null); if (!g0) continue;
      for (const x of group.slice(1)) { const gx = await P.greyOf(await thumbOf(x.w)).catch(() => null); if (gx && P.score(g0, gx, true) >= TWIN) twin.set(x.w.id, group[0].w); }
    }
    for (const { w, q } of looks) {
      const why = [];
      if (mp(w) < MIN_MP) why.push(`a small file (${Math.round(mp(w) * 10) / 10} MP)`);
      if (q && median && q.sharpness < SOFT * median) why.push('soft, by the house’s look');
      if (q && q.black > CLIP) why.push('much of it black');
      if (q && q.white > CLIP) why.push('much of it white');
      if (twin.has(w.id)) why.push(`a near twin of ${twin.get(w.id).title}`);
      const a = read(w); const p = a && a.people;
      if (why.length) out.check.push({ w, why });
      else if (!a || a.missed) out.unread.push({ w });
      else if (p && p.minors) out.children.push({ w });
      else if (p && p.recognisable > 0) out.people.push({ w, n: p.recognisable });
      else out.clear.push({ w });
    }
    return out;
  }
  function start(m, from) {
    const k = `${m.id}:${from}`; const j = jobs.get(k);
    if (j && (j.running || Date.now() - j.at < 60000)) return j;
    const job = { running: true, at: Date.now(), plan: null, error: null }; jobs.set(k, job);
    (async () => {
      try {
        // Al reads what he has not yet read (up to forty a press), so people and children are known before anything hangs.
        const art = app.locals.art;
        if (art && art.attribute && process.env.ANTHROPIC_API_KEY) {
          const un = db.prepare(`SELECT * FROM works WHERE maker_id=? AND status='hidden' AND keep_back=0 AND attribution IS NULL AND (stars >= ? OR curated=1) LIMIT 40`).all(m.id, from);
          for (const w of un) { try { await art.attribute(w); } catch (e) { /* stays unread */ } }
        }
        job.plan = await plan(m, from);
      } catch (e) { job.error = e.message; console.error('[hang]', e.message); }
      job.running = false; job.at = Date.now();
    })();
    return job;
  }

  function hang(m, works, why) {
    let n = 0;
    for (const w of works) {
      const f = db.prepare('SELECT * FROM works WHERE id=? AND maker_id=?').get(w.id, m.id);
      if (!f || f.status !== 'hidden' || f.keep_back || f.flag === 'reject' || (f.disputed || 0) > 0) continue;
      if (app.locals.mayHang && !app.locals.mayHang(m)) break;
      db.prepare("UPDATE works SET status='held' WHERE id=?").run(f.id);
      ledger.append(db, 'work.published', f.slug, { maker: m.handle, attested: 'rights; releases where a use needs them', by: 'hang', group: why }); n++;
    }
    if (n && app.locals.findIndexDirty) app.locals.findIndexDirty();
    if (n && app.locals.legal) { try { app.locals.legal.accept('maker', m.id, 'makers', null, 'hang'); } catch (e) { /* quiet */ } }
    return n;
  }

  const GROUPS = [
    ['people', 'With people', 'Street work and portraits. What you may do with each: hang it, have it collected, print it, put it in a book of your work. What waits for their release: a company’s work or a campaign (sign one on the spot, on your phone). Tap any you want kept back; the rest hang.', 'hang'],
    ['children', 'With a child, likely', 'A look, not a block. Tap any to keep back.', 'hang'],
    ['unread', 'Not yet read', 'Al has not looked at these yet. Look yourself: tap any to keep back.', 'hang'],
    ['check', 'Look at these first', 'The file itself is doubtful. They stay down unless you tap them in.', 'hold'],
    ['kept', 'Kept back', 'You keep these off the walls; nothing publishes them. Tap to let one go.', 'kept'],
  ];
  const tile = (x, mode) => `<button type="button" class="hb-t" data-hb-slug="${esc(x.w.slug)}" data-hb-mode="${mode}" aria-pressed="${mode === 'hold' || mode === 'kept' ? 'true' : 'false'}" title="${esc(x.w.title)}${x.why ? ' · ' + esc(x.why.join(', ')) : ''}"><img src="/img/${encodeURIComponent(x.w.slug)}/thumb" alt="" loading="lazy"><span class="hb-x">${mode === 'hold' ? 'Down' : 'Kept back'}</span>${x.why ? `<small>${esc(x.why[0])}</small>` : ''}</button>`;
  app.get('/account/hang', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/hang');
    res.set('Cache-Control', 'private, no-store');
    const from = Math.max(1, Math.min(5, parseInt(req.query.from, 10) || 4));
    const job = start(m, from); const p = job.plan;
    const head = `<p class="k"><a href="/account">Your studio</a></p><h1>Hang your best.</h1>
<p class="lede">Everything graded ${'★'.repeat(from)} and up that is still kept back, sorted into what can hang now and what wants one look first. Nothing hangs on a guess, and nothing is deleted.</p>
<nav class="hb-from">${[3, 4, 5].map(n => `<a href="/account/hang?from=${n}"${n === from ? ' aria-current="page"' : ''}>${'★'.repeat(n)} and up</a>`).join('')}</nav>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}`;
    if (!p) return res.send(V.layout({ title: 'Hang your best · Watermark', studio: true, body: `<section class="studio-wrap hb">${head}<p class="muted" data-hb-wait>The house is looking at each file${process.env.ANTHROPIC_API_KEY ? ', and Al at who is in it' : ''}. This page fills in by itself.</p>${job.error ? `<p class="err">${esc(job.error)}</p>` : ''}<script>setTimeout(function(){location.reload()},3000)</script></section>` }));
    const body = `${head}
<section class="hb-g hb-clear"><h2>Ready to hang · ${p.clear.length}</h2><p class="muted">Graded, sound files, no one recognisable in them.</p>
<div class="hb-grid">${p.clear.slice(0, 120).map(x => `<span class="hb-t hb-tc"><img src="/img/${encodeURIComponent(x.w.slug)}/thumb" alt="" loading="lazy"></span>`).join('')}</div>
${p.clear.length ? `<form method="post" action="/account/hang/go"><input type="hidden" name="from" value="${from}"><input type="hidden" name="group" value="clear"><label class="hb-at"><input type="checkbox" name="attest" value="1" required> These are mine and I hold the rights; I accept <a href="/legal/makers" target="_blank">the Maker Agreement</a>.</label><button class="buy-btn">Hang these ${p.clear.length}</button></form>` : '<p class="muted">None waiting.</p>'}</section>
${GROUPS.map(([k, name, line, mode]) => p[k].length ? `<section class="hb-g" data-hb-group="${k}"><h2>${name} · ${p[k].length}</h2><p class="muted">${line}</p>
<div class="hb-grid">${p[k].map(x => tile(x, mode)).join('')}</div>
${mode !== 'kept' ? `<form method="post" action="/account/hang/go"><input type="hidden" name="from" value="${from}"><input type="hidden" name="group" value="${k}"><input type="hidden" name="slugs" data-hb-slugs="${k}"><label class="hb-at"><input type="checkbox" name="attest" value="1" required> I have looked; these are mine and I hold the rights.</label><button class="btn">Hang ${mode === 'hold' ? 'the ones tapped in' : 'the rest'}</button></form>` : ''}</section>` : '').join('')}
${p.hung.length ? `<p class="muted">${p.hung.length} at this grade already on view.</p>` : ''}
<script src="/static/hangbest.js?v=${esc(V.VER || '')}" defer></script>`;
    res.send(V.layout({ title: 'Hang your best · Watermark', studio: true, body: `<section class="studio-wrap hb">${body}</section>` }));
  });
  // Keep back, or let go: one work at a time from the room's tiles (JSON).
  app.post('/account/hang/keep', (req, res) => {
    const m = makerOf(req); if (!m) return res.status(401).json({ ok: false });
    const w = db.prepare('SELECT * FROM works WHERE slug=? AND maker_id=?').get(String(req.body.slug || ''), m.id); if (!w) return res.status(404).json({ ok: false });
    const on = req.body.on === '1' || req.body.on === true;
    db.prepare('UPDATE works SET keep_back=? WHERE id=?').run(on ? 1 : 0, w.id);
    if (on && w.status === 'held') { db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(w.id); ledger.append(db, 'work.hidden', w.slug, { by: m.handle, kept: true }); if (app.locals.findIndexDirty) app.locals.findIndexDirty(); }
    for (const k of jobs.keys()) if (k.startsWith(m.id + ':')) jobs.delete(k);
    res.json({ ok: true, on });
  });
  app.post('/account/hang/go', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const from = Math.max(1, Math.min(5, parseInt(req.body.from, 10) || 4)); const group = String(req.body.group || 'clear');
    if (req.body.attest !== '1') return res.redirect(`/account/hang?from=${from}&ok=` + encodeURIComponent('Tick the line first.'));
    const k = `${m.id}:${from}`; const p = (jobs.get(k) || {}).plan || await plan(m, from);
    let pick = (p[group] || []).map(x => x.w);
    if (group === 'check') { const want = new Set(String(req.body.slugs || '').split(',').filter(Boolean)); pick = pick.filter(w => want.has(w.slug)); }
    const n = hang(m, pick, group);
    jobs.delete(k);
    res.redirect(`/account/hang?from=${from}&ok=` + encodeURIComponent(`${n} hung.`));
  });
  return { plan, qc, hang, start };
}

module.exports = { mountHangBest };
