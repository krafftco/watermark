// Arrivals (Will, 20 Oct: "we have to learn how to deal with large uploads"; "the most efficient best app that we
// can, to replace Dropbox Transfer and ShootProof for creatives"). The way those two do it, and now the house: the
// browser puts the file straight into the vault in parts (PART_MB each, four in flight, each part resumable) by
// addresses the house signs; the house's server never carries the bytes. When the last part lands the house is
// told, and a queue takes the arrivals in one at a time in the background (match by look, swap the master in, or
// register a new frame privately), so nothing decodes inside a request and a small server never runs out of room.
//   Table `arrivals`: id, key, name, size, type, folder, upload_id, parts, status (uploading | arrived | working |
//   done | failed), outcome (master | archive | known | smaller), slug, title, error, by.
//   Routes (the Studio; makers next): POST /studio/arrivals/start {name,size,type,folder} → {id, key, partSize,
//   parts, direct:true|false}; POST /studio/arrivals/:id/urls {parts:[n…]} → {urls:{n:url}}; POST
//   /studio/arrivals/:id/done {parts:[{n,etag}]} → completes the upload and queues it; PUT /studio/arrivals/:id/body
//   (the whole file, when the vault is the local disk: development, the test house); GET /studio/arrivals/state;
//   POST /studio/arrivals/:id/abort. Stale uploading rows (a day old) are aborted and dropped.
//   The browser side is `public/arrivals.js` (the Masters desk).
//   The bucket needs a CORS rule for direct puts (docs/ARRIVALS.md): AllowedOrigins [the house's address],
//   AllowedMethods [PUT, GET], AllowedHeaders [*], ExposeHeaders [ETag].
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PART_MB = Number(process.env.ARRIVAL_PART_MB || 8);
const MAX_GB = Number(process.env.ARRIVAL_MAX_GB || 2);

function mountArrivals(app, { db, C, store, studioOnly, incoming, makerOf, takeWork }) {
  // Two doors, one set of handlers: the Studio's masters desk (/studio/arrivals, purpose 'master') and every maker's
  // own vault (/account/arrivals, purpose 'work': the file becomes the maker's work, held privately, with its title,
  // place and kind). `who(req)` says which; a maker sees and touches only their own arrivals.
  db.exec(`CREATE TABLE IF NOT EXISTS arrivals (id INTEGER PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, type TEXT, folder TEXT, upload_id TEXT, parts INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploading', outcome TEXT, slug TEXT, title TEXT, error TEXT, by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), arrived_at TEXT, done_at TEXT,
    purpose TEXT NOT NULL DEFAULT 'master', place TEXT, kind TEXT, maker_id INTEGER, result TEXT)`);
  for (const [c, t] of [['purpose', "TEXT NOT NULL DEFAULT 'master'"], ['place', 'TEXT'], ['kind', 'TEXT'], ['maker_id', 'INTEGER'], ['result', 'TEXT'], ['via', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('arrivals') WHERE name=?").get(c)) db.exec(`ALTER TABLE arrivals ADD COLUMN ${c} ${t}`);
  db.exec('CREATE INDEX IF NOT EXISTS arrivals_status ON arrivals (status, id)');
  fs.mkdirSync(incoming, { recursive: true });
  const direct = !!(store.kind === 's3' && store.multipart);
  const partSize = PART_MB * 1024 * 1024;
  const row = id => db.prepare('SELECT * FROM arrivals WHERE id=?').get(+id);
  const safe = n => String(n || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120);
  const localFile = a => path.join(incoming, `arrival-${a.id}-${safe(a.name)}`);

  const maker = req => (makerOf ? makerOf(req) : null);
  const guardFor = base => (base === '/studio' ? studioOnly : (req, res, next) => (maker(req) ? next() : res.status(401).json({ ok: false, error: 'Sign in.' })));
  const mine = (req, base) => (base === '/studio' ? row(req.params.id) : (() => { const a = row(req.params.id); const m = maker(req); return a && m && a.maker_id === m.id ? a : null; })());
  for (const base of ['/studio', '/account']) {
  const guard = guardFor(base), purpose = base === '/studio' ? 'master' : 'work';
  app.post(`${base}/arrivals/start`, guard, async (req, res) => {
    const name = String(req.body.name || '').slice(0, 200), size = Math.floor(+req.body.size || 0), type = String(req.body.type || 'image/jpeg').slice(0, 60), folder = String(req.body.folder || '').slice(0, 300);
    if (!name || !size || size > MAX_GB * 1e9) return res.status(400).json({ ok: false, error: 'A name and a size under the limit, please.' });
    if (!/^image\//.test(type)) return res.status(400).json({ ok: false, error: 'Images only.' });
    const parts = Math.max(1, Math.ceil(size / partSize));
    const key = `arrivals/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safe(name)}`;
    let uploadId = null;
    if (direct) { try { uploadId = await store.multipart.start(key, type); } catch (e) { console.error('[arrivals] start', e.message); return res.status(502).json({ ok: false, error: 'The vault did not answer: ' + e.message.slice(0, 80) }); } }
    const m = purpose === 'work' ? maker(req) : null;
    const r = db.prepare('INSERT INTO arrivals (key, name, size, type, folder, upload_id, parts, by, purpose, title, place, kind, maker_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key, name, size, type, folder, uploadId, parts, m ? `m:${m.id}` : 'studio', purpose,
      String(req.body.title || '').trim().slice(0, 200) || null, String(req.body.place || '').trim().slice(0, 120) || null, String(req.body.kind || '').trim().slice(0, 30) || null, m ? m.id : null);
    res.json({ ok: true, id: r.lastInsertRowid, key, partSize, parts, direct });
  });
  app.post(`${base}/arrivals/:id/urls`, guard, async (req, res) => {
    const a = mine(req, base); if (!a || a.status !== 'uploading') return res.status(404).json({ ok: false });
    if (!direct) return res.json({ ok: true, urls: {} });
    const ns = (Array.isArray(req.body.parts) ? req.body.parts : String(req.body.parts || '').split(',')).map(Number).filter(n => n >= 1 && n <= a.parts).slice(0, 16);
    const urls = {}; for (const n of ns) urls[n] = await store.multipart.partUrl(a.key, a.upload_id, n);
    res.json({ ok: true, urls });
  });
  // The whole file in one put, through the house: the local vault's only way (development, the test house), and every
  // vault's fallback when the bucket will not let the browser in (21 Oct): streamed to disk, taken in from there.
  app.put(`${base}/arrivals/:id/body`, guard, (req, res) => {
    const a = mine(req, base); if (!a || a.status !== 'uploading') return res.status(404).json({ ok: false });
    const f = localFile(a); const w = fs.createWriteStream(f); let n = 0;
    req.on('data', d => { n += d.length; if (n > a.size + 1024) req.destroy(); }); req.pipe(w);
    w.on('finish', () => { if (n < a.size) { try { fs.unlinkSync(f); } catch (e) { /* */ } return res.status(400).json({ ok: false, error: 'The file arrived short; send it again.' }); } if (direct && a.upload_id) store.multipart.abort(a.key, a.upload_id).catch(() => {}); db.prepare("UPDATE arrivals SET status='arrived', via='house', arrived_at=datetime('now') WHERE id=?").run(a.id); res.json({ ok: true }); setImmediate(pump); });
    w.on('error', e => { res.status(500).json({ ok: false, error: e.message }); });
  });
  app.post(`${base}/arrivals/:id/done`, guard, async (req, res) => {
    const a = mine(req, base); if (!a) return res.status(404).json({ ok: false });
    if (a.status !== 'uploading') return res.json({ ok: true, status: a.status });
    if (direct) {
      let parts = []; try { parts = (typeof req.body.parts === 'string' ? JSON.parse(req.body.parts) : req.body.parts) || []; } catch (e) { parts = []; }
      parts = parts.map(p => ({ n: +p.n, etag: String(p.etag || '').replace(/"/g, '') })).filter(p => p.n >= 1 && p.etag).sort((x, y) => x.n - y.n);
      if (parts.length !== a.parts) return res.status(400).json({ ok: false, error: `Expected ${a.parts} parts, got ${parts.length}.` });
      try { await store.multipart.complete(a.key, a.upload_id, parts.map(p => ({ n: p.n, etag: `"${p.etag}"` }))); }
      catch (e) { console.error('[arrivals] complete', e.message); return res.status(502).json({ ok: false, error: 'The vault refused the parts: ' + e.message.slice(0, 100) }); }
    }
    db.prepare("UPDATE arrivals SET status='arrived', arrived_at=datetime('now') WHERE id=?").run(a.id);
    res.json({ ok: true, status: 'arrived' }); setImmediate(pump);
  });
  app.post(`${base}/arrivals/:id/abort`, guard, async (req, res) => {
    const a = mine(req, base); if (!a) return res.status(404).json({ ok: false });
    if (a.status === 'uploading') { if (direct && a.upload_id) await store.multipart.abort(a.key, a.upload_id); try { fs.unlinkSync(localFile(a)); } catch (e) { /* none */ } db.prepare('DELETE FROM arrivals WHERE id=?').run(a.id); }
    res.json({ ok: true });
  });
  app.get(`${base}/arrivals/state`, guard, (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const m = base === '/account' ? maker(req) : null; const scope = m ? 'maker_id=? AND' : "purpose='master' AND"; const args = m ? [m.id] : [];
    const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 200);
    const waiting = db.prepare(`SELECT id, name, size, status FROM arrivals WHERE ${scope} status IN ('arrived','working') ORDER BY id`).all(...args);
    const recent = db.prepare(`SELECT id, name, size, status, outcome, slug, title, error, done_at, result FROM arrivals WHERE ${scope} status IN ('done','failed') ORDER BY done_at DESC, id DESC LIMIT 40`).all(...args).map(r => ({ ...r, result: r.result ? JSON.parse(r.result) : null }));
    const asked = ids.length ? db.prepare(`SELECT id, status, outcome, slug, title, error, result FROM arrivals WHERE ${scope} id IN (${ids.map(() => '?').join(',')})`).all(...args, ...ids).map(r => ({ ...r, result: r.result ? JSON.parse(r.result) : null })) : [];
    const counts = {}; for (const r of db.prepare(`SELECT outcome, COUNT(*) n FROM arrivals WHERE ${scope} status='done' GROUP BY outcome`).all(...args)) counts[r.outcome] = r.n;
    res.json({ ok: true, direct, partSize, waiting, working: waiting.find(w => w.status === 'working') || null, recent, asked, counts, failed: db.prepare(`SELECT COUNT(*) n FROM arrivals WHERE ${scope} status='failed'`).get(...args).n });
  });
  app.post(`${base}/arrivals/:id/retry`, guard, (req, res) => { const a = mine(req, base); if (!a || a.status !== 'failed' || !direct) return res.status(404).json({ ok: false }); db.prepare("UPDATE arrivals SET status='arrived', error=NULL WHERE id=?").run(a.id); res.json({ ok: true }); setImmediate(pump); });
  }

  // The queue: one arrival at a time, fetched from the vault to the incoming folder and taken in.
  let pumping = false;
  // Two at a time (21 Oct, Will: "it's so slow"): one file's decode overlaps another's download; ARRIVALS_PARALLEL sets it.
  const PARALLEL = Math.max(1, Number(process.env.ARRIVALS_PARALLEL || 2));
  let running = 0;
  async function takeOne(a) {
    const f = localFile(a);
    try {
      if (direct && a.via !== 'house') { await store.download(a.key, f); }
      const r = a.purpose === 'work' ? await takeWork(f, a) : await app.locals.takeMaster(f, a.name, a.folder);
      if (r.ok) db.prepare("UPDATE arrivals SET status='done', outcome=?, slug=?, title=?, result=?, done_at=datetime('now') WHERE id=?").run(r.outcome, r.slug || null, r.title || null, JSON.stringify(r), a.id);
      else db.prepare("UPDATE arrivals SET status='failed', error=?, done_at=datetime('now') WHERE id=?").run(String(r.error || 'could not be taken in').slice(0, 300), a.id);
      if (direct && a.via !== 'house') { try { await store.del(a.key); } catch (e) { /* later */ } }
    } catch (e) {
      console.error('[arrivals]', a.name, e.message);
      db.prepare("UPDATE arrivals SET status='failed', error=?, done_at=datetime('now') WHERE id=?").run(String(e.message || e).slice(0, 300), a.id);
    } finally { try { fs.unlinkSync(f); } catch (e) { /* consumed */ } }
  }
  async function pump() {
    if (pumping) return; pumping = true;
    try {
      for (;;) {
        while (running < PARALLEL) {
          const a = db.prepare("SELECT * FROM arrivals WHERE status='arrived' ORDER BY id LIMIT 1").get(); if (!a) break;
          db.prepare("UPDATE arrivals SET status='working' WHERE id=?").run(a.id);
          running++; takeOne(a).finally(() => { running--; setImmediate(pump); });
        }
        break;
      }
    } finally { pumping = false; }
  }
  // Stale uploads are aborted after a day; a failed arrival can be retried from the desk.
  const sweep = async () => { for (const a of db.prepare("SELECT * FROM arrivals WHERE status='uploading' AND created_at < datetime('now','-1 day')").all()) { if (direct && a.upload_id) await store.multipart.abort(a.key, a.upload_id); try { fs.unlinkSync(localFile(a)); } catch (e) { /* none */ } db.prepare('DELETE FROM arrivals WHERE id=?').run(a.id); }
    // a server that restarted mid-work: those go back to the queue
    db.prepare("UPDATE arrivals SET status='arrived' WHERE status='working'").run(); pump(); };
  if (process.env.NODE_ENV !== 'test') { setTimeout(() => sweep().catch(e => console.error('[arrivals] sweep', e.message)), 30000).unref(); setInterval(() => sweep().catch(() => {}), 3600000).unref(); }
  app.locals.arrivals = { pump, direct, partSize, sweep };
  return { pump, direct };
}
module.exports = { mountArrivals, PART_MB };
