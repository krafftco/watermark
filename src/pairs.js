// Pairs (29 Oct, Will, sending the Paris masters over their old web copies: "maybe files are not perfectly the same;
// this is how we have to figure"). A master and the web copy it was exported beside are rarely the same file and often
// not the same edit: a tighter crop, a straightened horizon, a warmer grade, black and white. The arrival's first look
// (app.js upgradeIfHeld) only joins what is plainly one picture. This is the second look, after the import: for each
// new work kept back, the maker's older works are compared by the camera's own moment (taken_at, which Lightroom keeps
// in both) and by the picture itself, searched across crops and normalised for exposure and colour (`score`).
//   certain: the same moment and alike (or all but identical), and one file clearly larger than the other (half again
//            the pixels: two frames of a burst are the same size) → joined at once, reversibly;
//   likely:  alike, or the same moment and somewhat alike → shown to the maker side by side: Same picture / Not the same.
// A join keeps the older record (its page, number, deed, licences and words) with the larger file as its master; the
// newer record is retired as 'merged', never deleted; what the older record lacked (caption, keywords, place, stars) it
// takes from the newer. Undo puts both back. Nothing is joined on a guess.
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const G = 40;                    // the comparison grid
const LONG = 160;                // the grey picture each work is reduced to
const CERTAIN = Number(process.env.PAIR_CERTAIN || 0.9);
const CERTAIN_ALONE = Number(process.env.PAIR_CERTAIN_ALONE || 0.97);
const LIKELY = Number(process.env.PAIR_LIKELY || 0.72);
const LIKELY_TIME = Number(process.env.PAIR_LIKELY_TIME || 0.5);

// ---------- the look ----------
async function greyOf(file) {
  const { data, info } = await sharp(file).rotate().greyscale().resize(LONG, LONG, { fit: 'inside', kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, px: data };
}
// The region of A in B's shape at scale s (of the largest that fits) and offset (fx, fy), sampled to a G-wide grid.
function sample(A, aspect, s, fx, fy, gw, gh) {
  let rw = A.w, rh = rw / aspect; if (rh > A.h) { rh = A.h; rw = rh * aspect; }
  rw *= s; rh *= s;
  const x0 = (A.w - rw) * fx, y0 = (A.h - rh) * fy;
  const out = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = x0 + (i + 0.5) * rw / gw, y = y0 + (j + 0.5) * rh / gh;
    const xi = Math.min(A.w - 2, Math.max(0, Math.floor(x - 0.5))), yi = Math.min(A.h - 2, Math.max(0, Math.floor(y - 0.5)));
    const ax = Math.min(1, Math.max(0, x - 0.5 - xi)), ay = Math.min(1, Math.max(0, y - 0.5 - yi));
    const p = A.px, w = A.w;
    out[j * gw + i] = (p[yi * w + xi] * (1 - ax) + p[yi * w + xi + 1] * ax) * (1 - ay) + (p[(yi + 1) * w + xi] * (1 - ax) + p[(yi + 1) * w + xi + 1] * ax) * ay;
  }
  return out;
}
// Normalised correlation: exposure, contrast and colour edits fall away; 1 is the same picture.
function ncc(a, b) {
  let ma = 0, mb = 0; const n = a.length; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let s = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; va += x * x; vb += y * y; }
  return va && vb ? s / Math.sqrt(va * vb) : 0;
}
const grid = (aspect, n = G) => (aspect >= 1 ? [n, Math.max(6, Math.round(n / aspect))] : [Math.max(6, Math.round(n * aspect)), n]);
// The quick look: whole picture against whole picture.
function quick(A, B) { const asp = B.w / B.h; const [gw, gh] = grid(asp); return ncc(sample(A, asp, 1, 0.5, 0.5, gw, gh), sample(B, asp, 1, 0.5, 0.5, gw, gh)); }
// The full look: either picture may be a crop of the other. The coarse look (a 16 grid, fewer crops) is the cheap
// first pass over every older work, so a crop is never lost before the full look sees it.
function score(A, B, coarse) {
  let best = -1; const n = coarse ? 16 : G;
  const scales = coarse ? [1, 0.85, 0.72] : [1, 0.94, 0.88, 0.82, 0.76, 0.7];
  for (const [X, Y] of [[A, B], [B, A]]) {
    const asp = Y.w / Y.h; const [gw, gh] = grid(asp, n); const y = sample(Y, asp, 1, 0.5, 0.5, gw, gh);
    for (const s of scales) {
      const steps = s === 1 ? [0.5] : coarse ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
      for (const fx of steps) for (const fy of steps) { const v = ncc(sample(X, asp, s, fx, fy, gw, gh), y); if (v > best) best = v; }
    }
  }
  return best;
}

function mountPairs(app, { db, V, images, cache, originalPath, replaceMaster, inLane, ledger, studioOnly }) {
  db.exec(`CREATE TABLE IF NOT EXISTS pairs (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, new_id INTEGER NOT NULL, old_id INTEGER NOT NULL,
    score REAL, same_time INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'proposed', how TEXT, prev TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT)`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS pairs_two ON pairs (new_id, old_id)');
  const esc = V.esc;
  const greys = new Map();
  async function grey(w) {
    const k = `${w.id}:${w.sha256}`; if (greys.has(k)) return greys.get(k);
    let file; try { file = await images.derivativeOf(() => originalPath(w), cache, w.slug, 'thumb', 'jpg'); } catch (e) { file = await originalPath(w); }
    const g = await greyOf(file); if (greys.size > 3000) greys.clear(); greys.set(k, g); return g;
  }
  const px = w => (w.width || 0) * (w.height || 0);
  const moment = w => (w.taken_at ? String(w.taken_at).slice(0, 19) : null);
  const work = id => db.prepare('SELECT * FROM works WHERE id=?').get(id);

  // ---------- the join, and its undo ----------
  async function join(p, how) {
    const N = work(p.new_id), O = work(p.old_id);
    if (!N || !O || N.status === 'merged' || O.status === 'merged') return { ok: false, error: 'One of the two is no longer here.' };
    const prev = { original_file: O.original_file, sha256: O.sha256, width: O.width, height: O.height, dhash: O.dhash, caption: O.caption, keywords: O.keywords, place: O.place, stars: O.stars, n_status: N.status };
    if (px(N) > px(O)) {
      const src = await originalPath(N); const tmp = path.join(path.dirname(src), `pair-${N.id}-${Date.now()}${path.extname(N.original_file) || '.jpg'}`);
      fs.copyFileSync(src, tmp);
      const info = await images.inspect(tmp); const h = N.dhash || await images.dhash(tmp).catch(() => null);
      await inLane(() => replaceMaster(O, { path: tmp, originalname: N.original_file }, info, h));
    }
    db.prepare(`UPDATE works SET caption=COALESCE(caption, ?), keywords=COALESCE(keywords, ?), place=COALESCE(place, ?), stars=CASE WHEN COALESCE(stars,0) < ? THEN ? ELSE stars END WHERE id=?`)
      .run(N.caption || null, N.keywords || null, N.place || null, N.stars || 0, N.stars || 0, O.id);
    db.prepare("UPDATE works SET status='merged', status_before=? WHERE id=?").run(N.status, N.id);
    db.prepare("UPDATE pairs SET status='joined', how=?, prev=?, decided_at=datetime('now') WHERE id=?").run(how, JSON.stringify(prev), p.id);
    db.prepare("UPDATE pairs SET status='dismissed', how='superseded', decided_at=datetime('now') WHERE new_id=? AND id<>? AND status='proposed'").run(N.id, p.id);
    ledger.append(db, 'work.merged', N.slug, { into: O.slug, by: how, score: Math.round((p.score || 0) * 1000) / 1000, same_time: !!p.same_time });
    if (app.locals.findIndexDirty) app.locals.findIndexDirty();
    return { ok: true, into: O.slug };
  }
  async function undo(p) {
    const N = work(p.new_id), O = work(p.old_id); const prev = p.prev ? JSON.parse(p.prev) : null;
    if (!N || !O || !prev) return { ok: false, error: 'Nothing to put back.' };
    if (prev.sha256 && O.sha256 !== prev.sha256) {
      db.prepare('UPDATE works SET original_file=?, sha256=?, width=?, height=?, dhash=? WHERE id=?').run(prev.original_file, prev.sha256, prev.width, prev.height, prev.dhash, O.id);
      for (const sz of Object.keys(images.SIZES)) for (const f of Object.keys(images.FORMATS)) { const c = images.fileOf(cache, O.slug, sz, f); try { fs.unlinkSync(c); } catch (e) { /* none */ } }
      if (app.locals.edge && app.locals.edge.work) app.locals.edge.work(O.slug);
    }
    db.prepare('UPDATE works SET caption=?, keywords=?, place=?, stars=? WHERE id=?').run(prev.caption, prev.keywords, prev.place, prev.stars || 0, O.id);
    db.prepare('UPDATE works SET status=? WHERE id=?').run(prev.n_status || 'hidden', N.id);
    db.prepare("UPDATE pairs SET status='undone', decided_at=datetime('now') WHERE id=?").run(p.id);
    ledger.append(db, 'work.unmerged', N.slug, { from: O.slug });
    if (app.locals.findIndexDirty) app.locals.findIndexDirty();
    return { ok: true };
  }

  // ---------- the scan ----------
  // New works: kept back, nothing sold, hung or editioned against them, arrived in the last 60 days, not yet decided.
  const lastKey = m => `pairs_last_${m}`;
  const getLast = m => { try { return Number((db.prepare('SELECT v FROM settings WHERE k=?').get(lastKey(m)) || {}).v) || 0; } catch (e) { return 0; } };
  const setLast = (m, id) => { try { db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v=excluded.v').run(lastKey(m), String(id)); } catch (e) { /* a mark only */ } };
  // By default only what arrived since the last look; 'all' looks at every new work again (Look again).
  async function scan(makerId, { days = 60, all = false } = {}) {
    const since = all ? 0 : getLast(makerId);
    const fresh = db.prepare(`SELECT w.* FROM works w WHERE w.maker_id=? AND w.id > ? AND w.status='hidden' AND w.original_file IS NOT NULL
      AND w.created_at > datetime('now', ?) AND NOT EXISTS (SELECT 1 FROM licenses l WHERE l.work_id=w.id)
      AND NOT EXISTS (SELECT 1 FROM hang_works h WHERE h.work_id=w.id) AND NOT EXISTS (SELECT 1 FROM pairs p WHERE p.new_id=w.id AND p.status IN ('joined','undone'))
      ORDER BY w.id`).all(makerId, since, `-${days} days`);
    if (!fresh.length) return { looked: 0, joined: 0, proposed: 0 };
    setLast(makerId, fresh[fresh.length - 1].id);
    const olds = db.prepare("SELECT * FROM works WHERE maker_id=? AND status IN ('held','hidden') AND original_file IS NOT NULL ORDER BY id").all(makerId);
    let joined = 0, proposed = 0;
    const breathe = () => new Promise(r => setImmediate(r)); // visitors first: the look yields between pictures
    for (const N of fresh) {
      await breathe();
      let gN; try { gN = await grey(N); } catch (e) { continue; }
      const cands = [];
      let k = 0;
      for (const O of olds) {
        if (O.id >= N.id) break;
        if (++k % 150 === 0) await breathe();
        const same = !!(moment(N) && moment(N) === moment(O));
        let gO; try { gO = await grey(O); } catch (e) { continue; }
        if (Math.max(px(N), px(O)) < 1.5 * Math.max(1, Math.min(px(N), px(O)))) continue; // the same size: frames, not a pair
        const q0 = score(gN, gO, true);
        if (same || q0 > 0.55) cands.push({ O, gO, same, q0 });
      }
      cands.sort((a, b) => (b.same - a.same) || (b.q0 - a.q0));
      let best = null;
      for (const c of cands.slice(0, 6)) { const s = score(gN, c.gO); if (!best || s > best.s || (c.same && !best.same && s > best.s - 0.05)) best = { ...c, s }; }
      if (!best) continue;
      const { O, s, same } = best;
      const differ = Math.max(px(N), px(O)) >= 1.5 * Math.max(1, Math.min(px(N), px(O)));
      // Two files of one size are two frames (a burst, a bracket), never a master and its web copy: only a clear
      // difference in size is a pair at all.
      const certain = differ && ((same && s >= CERTAIN) || s >= CERTAIN_ALONE);
      const likely = differ && (s >= LIKELY || (same && s >= LIKELY_TIME));
      if (!certain && !likely) continue;
      const had = db.prepare('SELECT * FROM pairs WHERE new_id=? AND old_id=?').get(N.id, O.id);
      if (had && had.status === 'dismissed') continue;
      if (!had) db.prepare('INSERT INTO pairs (maker_id, new_id, old_id, score, same_time) VALUES (?,?,?,?,?)').run(makerId, N.id, O.id, s, same ? 1 : 0);
      else db.prepare('UPDATE pairs SET score=?, same_time=? WHERE id=?').run(s, same ? 1 : 0, had.id);
      const p = db.prepare('SELECT * FROM pairs WHERE new_id=? AND old_id=?').get(N.id, O.id);
      if (certain && p.status === 'proposed') { const r = await join(p, 'house'); if (r.ok) joined++; } else if (p.status === 'proposed') proposed++;
    }
    if (joined || proposed) console.log(`[pairs] m:${makerId} ${joined} joined, ${proposed} to confirm`);
    if (proposed && app.locals.notify) { try { await app.locals.notify.tell({ maker_id: makerId, kind: 'import', title: `${proposed} ${proposed === 1 ? 'picture looks' : 'pictures look'} like ${proposed === 1 ? 'one' : 'ones'} you already hold`, body: 'Say whether each is the same picture.', href: '/account/pairs' }); } catch (e) { /* a notice is a courtesy */ } }
    return { looked: fresh.length, joined, proposed };
  }
  const queue = new Set(); let busy = false;
  function soon(makerId) {
    if (!makerId) return; queue.add(makerId); if (busy) return; busy = true;
    setTimeout(async () => { try { while (queue.size) { const m = queue.values().next().value; queue.delete(m); await scan(m).catch(e => console.error('[pairs]', e.message)); } } finally { busy = false; } }, 2000).unref();
  }

  // ---------- the desk ----------
  const makerOf = req => (app.locals.accounts ? app.locals.accounts.makerOf(req) : null);
  const img = w => `/img/${encodeURIComponent(w.slug)}/screen`;
  const mp = w => (px(w) ? `${Math.round(px(w) / 1e5) / 10} MP` : '');
  function page(m, ok) {
    const prop = db.prepare("SELECT * FROM pairs WHERE maker_id=? AND status='proposed' ORDER BY same_time DESC, score DESC, id").all(m.id);
    const done = db.prepare("SELECT * FROM pairs WHERE maker_id=? AND status='joined' ORDER BY decided_at DESC LIMIT 60").all(m.id);
    const row = (p, acts) => { const N = work(p.new_id), O = work(p.old_id); if (!N || !O) return '';
      return `<li class="pz-row"><figure><img src="${img(O)}" alt="" loading="lazy"><figcaption><b>${esc(O.title || O.slug)}</b><span>Held · ${esc(mp(O))}${O.taken_at ? ' · ' + esc(String(O.taken_at).slice(0, 16).replace('T', ' ')) : ''}</span></figcaption></figure>
<figure><img src="${img(N)}" alt="" loading="lazy"><figcaption><b>${esc(N.title || N.slug)}</b><span>New · ${esc(mp(N))}${N.taken_at ? ' · ' + esc(String(N.taken_at).slice(0, 16).replace('T', ' ')) : ''}</span></figcaption></figure>
<div class="pz-why">${p.same_time ? 'Made at the same moment, by the camera’s clock. ' : ''}${Math.round((p.score || 0) * 100)}% alike, allowing for a crop and the edit.</div>${acts(p)}</li>`; };
    const ask = p => `<form method="post" action="/account/pairs/${p.id}" class="pz-acts"><button class="btn" name="do" value="join">Same picture</button> <button class="btn ghost" name="do" value="no">Not the same</button></form>`;
    const back = p => `<form method="post" action="/account/pairs/${p.id}" class="pz-acts"><span class="muted">Joined ${p.how === 'house' ? 'by the house' : 'by you'}</span> <button class="btn ghost" name="do" value="undo">Undo</button></form>`;
    return V.layout({ title: 'Pairs · Watermark', path: '/account/pairs', studio: true, body: `<section class="studio-wrap pz">
<p class="k"><a href="/account">Your studio</a></p><h1>Pictures you already hold.</h1>
<p class="lede">A master and the web copy it was exported beside are rarely the same file. When the house is sure, it joins them: the older record keeps its page, number and licences, with the larger file as its master. When it is not sure, it asks you here.</p>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
<form method="post" action="/account/pairs/scan"><button class="btn ghost">Look again</button></form>
<h2>To confirm${prop.length ? ` · ${prop.length}` : ''}</h2>
<ul class="pz-list">${prop.map(p => row(p, ask)).join('') || '<li class="muted">Nothing waiting.</li>'}</ul>
<h2>Joined</h2>
<ul class="pz-list">${done.map(p => row(p, back)).join('') || '<li class="muted">None yet.</li>'}</ul></section>` });
  }
  app.get('/account/pairs', (req, res) => { const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/pairs'); res.set('Cache-Control', 'private, no-store'); res.send(page(m, req.query.ok)); });
  app.post('/account/pairs/scan', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const r = await scan(m.id, { all: true });
    res.redirect('/account/pairs?ok=' + encodeURIComponent(`Looked at ${r.looked}: ${r.joined} joined, ${r.proposed} to confirm.`));
  });
  app.post('/account/pairs/:id', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const p = db.prepare('SELECT * FROM pairs WHERE id=? AND maker_id=?').get(+req.params.id, m.id); if (!p) return res.sendStatus(404);
    let ok = '';
    if (req.body.do === 'join' && p.status === 'proposed') { const r = await join(p, 'maker'); ok = r.ok ? 'Joined.' : r.error; }
    else if (req.body.do === 'no' && p.status === 'proposed') { db.prepare("UPDATE pairs SET status='dismissed', how='maker', decided_at=datetime('now') WHERE id=?").run(p.id); ok = 'Kept as two works.'; }
    else if (req.body.do === 'undo' && p.status === 'joined') { const r = await undo(p); ok = r.ok ? 'Put back as two works.' : r.error; }
    res.redirect('/account/pairs?ok=' + encodeURIComponent(ok));
  });
  app.post('/studio/pairs/scan', studioOnly, async (req, res) => {
    const ids = db.prepare("SELECT DISTINCT maker_id FROM works WHERE status='hidden' AND created_at > datetime('now','-60 days')").all().map(r => r.maker_id);
    let t = { looked: 0, joined: 0, proposed: 0 }; for (const id of ids) { const r = await scan(id); t.looked += r.looked; t.joined += r.joined; t.proposed += r.proposed; }
    res.json({ ok: true, ...t });
  });
  // Every half hour, for makers whose last arrival is ten minutes old (an import still sending is left to finish).
  if (!app.locals.noTimers && require('./role').chores) setInterval(() => {
    try { for (const r of db.prepare(`SELECT maker_id FROM works WHERE status='hidden' AND created_at > datetime('now','-2 days') GROUP BY maker_id HAVING MAX(created_at) < datetime('now','-10 minutes')`).all()) soon(r.maker_id); } catch (e) { console.error('[pairs]', e.message); }
  }, 30 * 60000).unref();
  const waiting = makerId => db.prepare("SELECT COUNT(*) n FROM pairs WHERE maker_id=? AND status='proposed'").get(makerId).n;
  return { scan, soon, join, undo, waiting, score, quick, greyOf };
}

module.exports = { mountPairs, score, quick, greyOf, ncc };
