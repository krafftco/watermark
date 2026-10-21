// Voices: what is said about a photograph, held with it. The maker on their own work, an art
// historian's reading, a written note. Recorded in the browser or uploaded; heard on the work's page
// and in the viewer, like a museum's audio guide, but from the person who was there.
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { nanoid } = require('nanoid');

const KINDS = { maker: 'The maker', historian: 'Art history', note: 'A note' };

function mountVoices(app, { db, C, store, isStudio, makerOf, mk, ledger, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS voices (id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, work_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'maker',
    speaker TEXT, role TEXT, body TEXT, audio TEXT, audio_type TEXT, seconds INTEGER, public INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const dir = path.join(C.dataDir, 'voices'); fs.mkdirSync(dir, { recursive: true });
  const up = multer({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: 80 * 1024 * 1024 },
    fileFilter: (req, f, cb) => cb(null, /^audio\//.test(f.mimetype) || /\.(m4a|mp3|wav|aac|ogg|webm)$/i.test(f.originalname)) });
  const work = slug => db.prepare('SELECT * FROM works WHERE slug=?').get(String(slug));
  // The Studio, or the maker the photograph belongs to.
  const may = (req, w) => !!w && (isStudio(req) || (makerOf(req) || {}).id === w.maker_id);
  const of = w => db.prepare('SELECT * FROM voices WHERE work_id=? AND public=1 ORDER BY sort, id').all(w.id);
  app.locals.voicesOf = of;
  const extOf = (t, n) => (/mp4|m4a|aac/.test(t) || /\.m4a$/i.test(n) ? '.m4a' : /mpeg|mp3/.test(t) || /\.mp3$/i.test(n) ? '.mp3' : /wav/.test(t) ? '.wav' : /ogg/.test(t) ? '.ogg' : '.webm');

  app.get('/voices/:slug', (req, res) => {
    const w = work(req.params.slug); if (!may(req, w)) return res.redirect(isStudio(req) ? '/studio' : '/account');
    res.send(V.voicesEdit({ w, maker: mk(w), voices: of(w), kinds: KINDS, saved: req.query.ok }));
  });
  app.post('/voices/:slug', up.single('audio'), (req, res, next) => app.locals.bagcheck.gate('audio')(req, res, next), async (req, res) => {
    const w = work(req.params.slug); const x = req.body || {};
    if (!may(req, w)) { if (req.file) fs.unlink(req.file.path, () => {}); return res.sendStatus(403); }
    const t = (v, n) => String(v || '').trim().slice(0, n) || null;
    const body = t(x.body, 6000);
    if (!req.file && !body) return res.redirect(`/voices/${w.slug}?ok=empty`);
    const key = nanoid(16); let audio = null, type = null;
    if (req.file) {
      type = req.file.mimetype || 'audio/webm'; const ext = extOf(type, req.file.originalname || '');
      audio = `voices/${key}${ext}`;
      const local = path.join(dir, key + ext);
      try { fs.renameSync(req.file.path, local); } catch (e) { fs.copyFileSync(req.file.path, local); fs.unlinkSync(req.file.path); }
      try { await store.put(audio, local, type); } catch (e) { console.error('[voices] store', e.message); }
    }
    const kind = KINDS[x.kind] ? x.kind : 'maker';
    const speaker = t(x.speaker, 120) || (kind === 'maker' ? mk(w).name : null);
    db.prepare('INSERT INTO voices (key, work_id, kind, speaker, role, body, audio, audio_type, seconds, sort) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(key, w.id, kind, speaker, t(x.role, 120), body, audio, type, Math.max(0, Math.round(Number(x.seconds) || 0)) || null, of(w).length);
    ledger.append(db, 'work.voice', w.slug, { kind, speaker, audio: !!audio });
    if (/json/.test(req.get('accept') || '')) return res.json({ ok: true });
    res.redirect(`/voices/${w.slug}?ok=1`);
  });
  app.post('/voices/:slug/:key/remove', (req, res) => {
    const w = work(req.params.slug); if (!may(req, w)) return res.sendStatus(403);
    db.prepare('UPDATE voices SET public=0 WHERE key=? AND work_id=?').run(req.params.key, w.id);
    res.redirect(`/voices/${w.slug}?ok=removed`);
  });
  // Heard by anyone looking at a public photograph. Range requests work, so the player can seek.
  app.get('/listen/:key', async (req, res) => {
    const v = db.prepare('SELECT v.*, w.status FROM voices v JOIN works w ON w.id=v.work_id WHERE v.key=? AND v.public=1').get(req.params.key);
    if (!v || !v.audio || (v.status !== 'held' && !isStudio(req))) return res.sendStatus(404);
    const local = path.join(dir, path.basename(v.audio));
    if (!fs.existsSync(local)) { try { fs.writeFileSync(local, await store.get(v.audio)); } catch (e) { return res.sendStatus(404); } }
    res.set('Cache-Control', 'public, max-age=86400'); res.type(v.audio_type || 'audio/webm');
    res.sendFile(local);
  });
  app.get('/api/voices/:slug', (req, res) => {
    const w = work(req.params.slug); if (!w || w.status !== 'held') return res.json({ voices: [] });
    res.json({ voices: of(w).map(v => ({ key: v.key, kind: KINDS[v.kind], speaker: v.speaker, role: v.role, body: v.body, audio: v.audio ? `/listen/${v.key}` : null, seconds: v.seconds })) });
  });
  return { of, KINDS };
}

module.exports = { mountVoices, KINDS };
