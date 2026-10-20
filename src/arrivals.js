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

function mountArrivals(app, { db, C, store, studioOnly, incoming }) {
  db.exec(`CREATE TABLE IF NOT EXISTS arrivals (id INTEGER PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, type TEXT, folder TEXT, upload_id TEXT, parts INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploading', outcome TEXT, slug TEXT, title TEXT, error TEXT, by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), arrived_at TEXT, done_at TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS arrivals_status ON arrivals (status, id)');
  fs.mkdirSync(incoming, { recursive: true });
  const direct = !!(store.kind === 's3' && store.multipart);
  const partSize = PART_MB * 1024 * 1024;
  const row = id => db.prepare('SELECT * FROM arrivals WHERE id=?').get(+id);
  const safe = n => String(n || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120);
  const localFile = a => path.join(incoming, `arrival-${a.id}-${safe(a.name)}`);

  app.post('/studio/arrivals/start', studioOnly, async (req, res) => {
    const name = String(req.body.name || '').slice(0, 200), size = Math.floor(+req.body.size || 0), type = String(req.body.type || 'image/jpeg').slice(0, 60), folder = String(req.body.folder || '').slice(0, 300);
    if (!name || !size || size > MAX_GB * 1e9) return res.status(400).json({ ok: false, error: 'A name and a size under the limit, please.' });
    if (!/^image\//.test(type)) return res.status(400).json({ ok: false, error: 'Images only.' });
    const parts = Math.max(1, Math.ceil(size / partSize));
    const key = `arrivals/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safe(name)}`;
    let uploadId = null;
    if (direct) { try { uploadId = await store.multipart.start(key, type); } catch (e) { console.error('[arrivals] start', e.message); return res.status(502).json({ ok: false, error: 'The vault did not answer: ' + e.message.slice(0, 80) }); } }
    const r = db.prepare('INSERT INTO arrivals (key, name, size, type, folder, upload_id, parts, by) VALUES (?,?,?,?,?,?,?,?)').run(key, name, size, type, folder, uploadId, parts, 'studio');
    res.json({ ok: true, id: r.lastInsertRowid, key, partSize, parts, direct });
  });
  app.post('/studio/arrivals/:id/urls', studioOnly, async (req, res) => {
    const a = row(req.params.id); if (!a || a.status !== 'uploading') return res.status(404).json({ ok: false });
    if (!direct) return res.json({ ok: true, urls: {} });
    const ns = (Array.isArray(req.body.parts) ? req.body.parts : String(req.body.parts || '').split(',')).map(Number).filter(n => n >= 1 && n <= a.parts).slice(0, 16);
    const urls = {}; for (const n of ns) urls[n] = await store.multipart.partUrl(a.key, a.upload_id, n);
    res.json({ ok: true, urls });
  });
  // The whole file in one put, when the vault is the local disk (development, the test house): streamed to disk.
  app.put('/studio/arrivals/:id/body', studioOnly, (req, res) => {
    const a = row(req.params.id); if (!a || a.status !== 'uploading') return res.status(404).json({ ok: false });
    if (direct) return res.status(400).json({ ok: false, error: 'This vault takes parts.' });
    const f = localFile(a); const w = fs.createWriteStream(f); let n = 0;
    req.on('data', d => { n += d.length; if (n > a.size + 1024) req.destroy(); }); req.pipe(w);
    w.on('finish', () => { db.prepare("UPDATE arrivals SET status='arrived', arrived_at=datetime('now') WHERE id=?").run(a.id); res.json({ ok: true }); setImmediate(pump); });
    w.on('error', e => { res.status(500).json({ ok: false, error: e.message }); });
  });
  app.post('/studio/arrivals/:id/done', studioOnly, async (req, res) => {
    const a = row(req.params.id); if (!a) return res.status(404).json({ ok: false });
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
  app.post('/studio/arrivals/:id/abort', studioOnly, async (req, res) => {
    const a = row(req.params.id); if (!a) return res.status(404).json({ ok: false });
    if (a.status === 'uploading') { if (direct && a.upload_id) await store.multipart.abort(a.key, a.upload_id); try { fs.unlinkSync(localFile(a)); } catch (e) { /* none */ } db.prepare('DELETE FROM arrivals WHERE id=?').run(a.id); }
    res.json({ ok: true });
  });
  app.get('/studio/arrivals/state', studioOnly, (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const waiting = db.prepare("SELECT id, name, size, status FROM arrivals WHERE status IN ('arrived','working') ORDER BY id").all();
    const recent = db.prepare("SELECT id, name, size, status, outcome, slug, title, error, done_at FROM arrivals WHERE status IN ('done','failed') ORDER BY done_at DESC, id DESC LIMIT 40").all();
    const counts = {}; for (const r of db.prepare("SELECT outcome, COUNT(*) n FROM arrivals WHERE status='done' GROUP BY outcome").all()) counts[r.outcome] = r.n;
    res.json({ ok: true, direct, partSize, waiting, working: waiting.find(w => w.status === 'working') || null, recent, counts, failed: db.prepare("SELECT COUNT(*) n FROM arrivals WHERE status='failed'").get().n });
  });

  // The queue: one arrival at a time, fetched from the vault to the incoming folder and taken in.
  let pumping = false;
  async function pump() {
    if (pumping) return; pumping = true;
    try {
      for (;;) {
        const a = db.prepare("SELECT * FROM arrivals WHERE status='arrived' ORDER BY id LIMIT 1").get(); if (!a) break;
        db.prepare("UPDATE arrivals SET status='working' WHERE id=?").run(a.id);
        const f = localFile(a);
        try {
          if (direct) { await store.download(a.key, f); }
          const r = await app.locals.takeMaster(f, a.name, a.folder);
          if (r.ok) db.prepare("UPDATE arrivals SET status='done', outcome=?, slug=?, title=?, done_at=datetime('now') WHERE id=?").run(r.outcome, r.slug || null, r.title || null, a.id);
          else db.prepare("UPDATE arrivals SET status='failed', error=?, done_at=datetime('now') WHERE id=?").run(String(r.error || 'could not be taken in').slice(0, 300), a.id);
          if (direct) { try { await store.del(a.key); } catch (e) { /* later */ } }
        } catch (e) {
          console.error('[arrivals]', a.name, e.message);
          db.prepare("UPDATE arrivals SET status='failed', error=?, done_at=datetime('now') WHERE id=?").run(String(e.message || e).slice(0, 300), a.id);
        } finally { try { fs.unlinkSync(f); } catch (e) { /* consumed */ } }
      }
    } finally { pumping = false; }
  }
  // Stale uploads are aborted after a day; a failed arrival can be retried from the desk.
  app.post('/studio/arrivals/:id/retry', studioOnly, (req, res) => { const a = row(req.params.id); if (!a || a.status !== 'failed' || !direct) return res.status(404).json({ ok: false }); db.prepare("UPDATE arrivals SET status='arrived', error=NULL WHERE id=?").run(a.id); res.json({ ok: true }); setImmediate(pump); });
  const sweep = async () => { for (const a of db.prepare("SELECT * FROM arrivals WHERE status='uploading' AND created_at < datetime('now','-1 day')").all()) { if (direct && a.upload_id) await store.multipart.abort(a.key, a.upload_id); try { fs.unlinkSync(localFile(a)); } catch (e) { /* none */ } db.prepare('DELETE FROM arrivals WHERE id=?').run(a.id); }
    // a server that restarted mid-work: those go back to the queue
    db.prepare("UPDATE arrivals SET status='arrived' WHERE status='working'").run(); pump(); };
  if (process.env.NODE_ENV !== 'test') { setTimeout(() => sweep().catch(e => console.error('[arrivals] sweep', e.message)), 30000).unref(); setInterval(() => sweep().catch(() => {}), 3600000).unref(); }
  app.locals.arrivals = { pump, direct, partSize, sweep };
  return { pump, direct };
}
module.exports = { mountArrivals, PART_MB };
