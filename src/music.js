// The makers' own music (Will, 24–25 Oct: "the Listening Room needs to be as good as a hi-fi listening room"; the
// Keys' shelf 'From the makers' had stood empty because the vault took only pictures). A musician's master comes
// in through the same manner as a photograph: fingerprinted the moment it arrives, kept byte for byte in the vault
// (`music/` beside the originals), written to the register, and never re-encoded by the house. A record is a
// `recordings` row with source 'maker' (the Listening Room already knows the kind: keyholders hear it, others see the
// window); its sides are the maker's files, each served from the house with ranges (/music/:slug/:n) to keyholders,
// the maker and the Studio, never to the street, never as a download. The maker's desk: /account/music (the rail's
// More → Music): make a record (title, performer, composer, year, a line, the sleeve, a cover from their own works),
// add sides (WAV, FLAC, AIFF, MP3, M4A; the bag check reads the bytes), put it on the turntable or take it off.
// Rights stay the maker's ('© year name. All rights reserved.'); nothing of it is sold yet: the licence for sound is
// counsel's. `music.registered` on the register with the fingerprint (hidden), the deed for a recording.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const MIME = { '.wav': 'audio/wav', '.flac': 'audio/flac', '.aiff': 'audio/aiff', '.aif': 'audio/aiff', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'audio/webm' };
const MAX_MB = +process.env.MUSIC_MAX_MB || 400;
function mountMusic(app, { db, V, C, store, ledger, isStudio, makerOf, dataDir, bagcheck, upload }) {
  const { esc, layout, tidy } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS music_sides (id INTEGER PRIMARY KEY, recording_id INTEGER NOT NULL, n INTEGER NOT NULL, title TEXT, file TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER, sha256 TEXT NOT NULL, seconds INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS music_sides_rec ON music_sides(recording_id, n);`);
  const dir = path.join(dataDir, 'music'); fs.mkdirSync(dir, { recursive: true });
  const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'record';
  const keyed = req => { const K = app.locals.keys; const k = K ? K.holds(req) : {}; return Object.keys(k).length > 0 || isStudio(req); };
  const mine = (req, r) => { const m = makerOf(req); return !!(m && r && r.maker_id === m.id) || isStudio(req); };
  const rec = slug => db.prepare("SELECT * FROM recordings WHERE slug=? AND source='maker'").get(String(slug));
  const sides = r => db.prepare('SELECT * FROM music_sides WHERE recording_id=? ORDER BY n').all(r.id);
  const sha = f => new Promise((ok, no) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', no); });
  // The record's files, as the Listening Room reads them (its `files` JSON): the house's own addresses, never the vault's.
  const filesOf = r => sides(r).map(s => ({ url: `/music/${r.slug}/${s.n}`, title: s.title || `Side ${s.n}`, seconds: s.seconds || null, mime: s.mime }));
  const refile = r => { const f = filesOf(r); db.prepare('UPDATE recordings SET files=?, seconds=? WHERE id=?').run(JSON.stringify(f), f.reduce((a, x) => a + (x.seconds || 0), 0) || null, r.id); };
  // A local copy for streaming: the vault's object fetched once to the disk beside the originals.
  async function localPath(s) {
    const p = path.join(dir, path.basename(s.file)); if (fs.existsSync(p)) return p;
    try { const buf = await store.get(s.file); if (buf) { fs.writeFileSync(p + '.part', buf); fs.renameSync(p + '.part', p); return p; } } catch (e) { /* not in the vault */ }
    return null;
  }
  // ---------- the maker's desk ----------
  const desk = (req, res, { ok = null } = {}) => {
    const m = makerOf(req); if (!m) return res.status(401).send(V.sign ? V.sign(401) : 'Sign in');
    const rows = db.prepare("SELECT * FROM recordings WHERE source='maker' AND maker_id=? ORDER BY id DESC").all(m.id);
    const covers = db.prepare("SELECT slug, title FROM works WHERE maker_id=? AND status IN ('held','hidden') ORDER BY stars DESC, id DESC LIMIT 60").all(m.id);
    if (V.setDeskPath) V.setDeskPath('/account/music');
    res.send(layout({ title: 'Music · Watermark', studio: true, body: `<section class="studio-wrap mu2">
<p class="k"><a href="/account">&larr; Your studio</a> &middot; Music</p><h1>Your records.</h1>
<p class="lede">A master comes in as a photograph does: fingerprinted on arrival, kept byte for byte, written to the register, never re-encoded. On the turntable it plays whole for keyholders in the Listening Room; the rights stay yours.</p>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
<form method="post" action="/account/music" class="form mu2-new"><h2>A new record</h2>
<label>Title<input name="title" required maxlength="160"></label><label>Performer<input name="performer" value="${esc(m.name)}" maxlength="160"></label><label>Composer<input name="composer" maxlength="160"></label><label>Year<input name="year" maxlength="4" inputmode="numeric"></label>
<label>A line<input name="line" maxlength="200" placeholder="One sentence, as the sleeve would say it"></label>
<label>The sleeve<textarea name="body" rows="4" maxlength="4000"></textarea></label>
<label>Cover, from your own work<select name="cover_slug"><option value="">The house’s label</option>${covers.map(w => `<option value="${esc(w.slug)}">${esc(tidy(w.title))}</option>`).join('')}</select></label>
<button class="buy-btn">Make the record</button></form>
${rows.length ? rows.map(r => { const ss = sides(r); return `<section class="mu2-rec" id="r-${esc(r.slug)}"><header><div><p class="k">${r.status === 'playing' ? 'On the turntable' : 'Shelved'}</p><h2>${esc(r.title)}</h2><p class="mu2-by">${esc(r.performer || '')}${r.composer ? ` · ${esc(r.composer)}` : ''}${r.year ? ` · ${esc(r.year)}` : ''}</p></div><img src="${esc(r.cover_slug ? `/img/${r.cover_slug}/thumb` : `/listening/${encodeURIComponent(r.slug)}/label.svg`)}" alt=""></header>
<ol class="mu2-sides">${ss.map(s => `<li><span class="mu2-n">${s.n}</span><b>${esc(s.title || `Side ${s.n}`)}</b><small>${esc(path.extname(s.file).slice(1).toUpperCase())} · ${(s.bytes / 1e6).toFixed(1)} MB · <code>${esc(s.sha256.slice(0, 12))}…</code></small><form method="post" action="/account/music/${esc(r.slug)}/sides/${s.id}/remove" class="inline"><button class="link">Remove</button></form></li>`).join('') || '<li class="mu2-none">No sides yet.</li>'}</ol>
<form method="post" action="/account/music/${esc(r.slug)}/sides" enctype="multipart/form-data" class="mu2-add"><label>Side title<input name="title" maxlength="160" placeholder="${esc(`Side ${ss.length + 1}`)}"></label><label class="mu2-file"><input type="file" name="file" accept=".wav,.flac,.aiff,.aif,.mp3,.m4a,audio/*" required><span>Choose the master (WAV, FLAC, AIFF, MP3, M4A; up to ${MAX_MB} MB)</span></label><button class="buy-btn">Add the side</button></form>
<div class="mu2-acts">${ss.length ? `<form method="post" action="/account/music/${esc(r.slug)}/status" class="inline"><input type="hidden" name="to" value="${r.status === 'playing' ? 'shelved' : 'playing'}"><button class="buy-btn">${r.status === 'playing' ? 'Take it off the turntable' : 'Put it on the turntable'}</button></form>` : ''}<a href="/listening/${esc(r.slug)}">Its page in the room</a></div></section>`; }).join('') : '<p class="note">No records yet.</p>'}
</section>` }));
  };
  app.get('/account/music', desk);
  app.post('/account/music', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); const x = req.body || {};
    const title = String(x.title || '').trim().slice(0, 160); if (!title) return res.redirect('/account/music');
    let slug = slugify(title), i = 2; while (db.prepare('SELECT 1 FROM recordings WHERE slug=?').get(slug)) slug = `${slugify(title)}-${i++}`;
    const year = String(x.year || '').replace(/\D/g, '').slice(0, 4) || null; const cover = String(x.cover_slug || '').trim() || null;
    const okCover = cover && db.prepare('SELECT 1 FROM works WHERE slug=? AND maker_id=?').get(cover, m.id) ? cover : null;
    db.prepare("INSERT INTO recordings (slug, title, performer, composer, year, source, files, license, credit, line, body, cover_slug, maker_id, chosen_by, status) VALUES (?,?,?,?,?,'maker','[]','maker',?,?,?,?,?,?,'shelved')")
      .run(slug, title, String(x.performer || m.name).trim().slice(0, 160) || m.name, String(x.composer || '').trim().slice(0, 160) || null, year, `© ${year || new Date().getFullYear()} ${m.name}. All rights reserved. A master held on Watermark.`, String(x.line || '').trim().slice(0, 200) || null, String(x.body || '').trim().slice(0, 4000) || null, okCover, m.id, m.name);
    try { ledger.append(db, 'music.made', slug, { maker: m.handle, title }); } catch (e) { /* */ }
    res.redirect(`/account/music?ok=${encodeURIComponent(`${title} is made. Add its sides.`)}#r-${slug}`);
  });
  app.post('/account/music/:slug/sides', upload.single('file'), bagcheck.gate('audio'), async (req, res) => {
    const r = rec(req.params.slug); if (!r || !mine(req, r)) { if (req.file) fs.unlink(req.file.path, () => {}); return res.sendStatus(r ? 403 : 404); }
    if (!req.file) return res.redirect(`/account/music?ok=${encodeURIComponent('No file came.')}`);
    if (req.file.size > MAX_MB * 1e6) { fs.unlink(req.file.path, () => {}); return res.redirect(`/account/music?ok=${encodeURIComponent(`That file is over ${MAX_MB} MB. Write to the house for a larger door.`)}`); }
    const ext = (path.extname(req.file.originalname || '') || '.wav').toLowerCase(); const mime = MIME[ext] || req.file.mimetype || 'application/octet-stream';
    const fp = await sha(req.file.path);
    if (db.prepare('SELECT 1 FROM music_sides WHERE sha256=?').get(fp)) { fs.unlink(req.file.path, () => {}); return res.redirect(`/account/music?ok=${encodeURIComponent('That file is already held as a side.')}#r-${r.slug}`); }
    const n = (db.prepare('SELECT COALESCE(MAX(n),0) n FROM music_sides WHERE recording_id=?').get(r.id).n || 0) + 1;
    const name = `${r.slug}-${n}-${fp.slice(0, 8)}${ext}`; const key = `music/${name}`; const local = path.join(dir, name);
    try { fs.renameSync(req.file.path, local); } catch (e) { fs.copyFileSync(req.file.path, local); fs.unlinkSync(req.file.path); }
    try { await store.put(key, local, mime); } catch (e) { console.error('[music vault]', e.message); } // the local copy stays; the vault follows (a failed put is retried by hand: the file is on disk)
    const title = String((req.body || {}).title || '').trim().slice(0, 160) || null; const bytes = fs.statSync(local).size;
    db.prepare('INSERT INTO music_sides (recording_id, n, title, file, mime, bytes, sha256) VALUES (?,?,?,?,?,?,?)').run(r.id, n, title, key, mime, bytes, fp);
    refile(r);
    try { ledger.append(db, 'music.registered', r.slug, { side: n, fingerprint: fp, bytes, maker: (makerOf(req) || {}).handle || 'studio' }); } catch (e) { /* */ }
    res.redirect(`/account/music?ok=${encodeURIComponent(`Side ${n} is in the vault: ${fp.slice(0, 12)}… is its fingerprint.`)}#r-${r.slug}`);
  });
  app.post('/account/music/:slug/sides/:id/remove', async (req, res) => {
    const r = rec(req.params.slug); if (!r || !mine(req, r)) return res.sendStatus(r ? 403 : 404);
    const s = db.prepare('SELECT * FROM music_sides WHERE id=? AND recording_id=?').get(+req.params.id, r.id); if (s) { db.prepare('DELETE FROM music_sides WHERE id=?').run(s.id); try { fs.unlinkSync(path.join(dir, path.basename(s.file))); } catch (e) { /* */ } try { if (store.del) await store.del(s.file); } catch (e) { /* */ } refile(r); }
    if (!sides(r).length && r.status === 'playing') db.prepare("UPDATE recordings SET status='shelved' WHERE id=?").run(r.id);
    res.redirect(`/account/music#r-${r.slug}`);
  });
  app.post('/account/music/:slug/status', (req, res) => {
    const r = rec(req.params.slug); if (!r || !mine(req, r)) return res.sendStatus(r ? 403 : 404);
    const to = (req.body || {}).to === 'playing' && sides(r).length ? 'playing' : 'shelved';
    db.prepare('UPDATE recordings SET status=? WHERE id=?').run(to, r.id);
    if (to === 'playing') { try { ledger.append(db, 'recording.playing', r.slug, { title: r.title, by: r.performer || r.composer || '', from: 'maker' }); } catch (e) { /* */ } }
    res.redirect(`/account/music?ok=${encodeURIComponent(to === 'playing' ? `${r.title} is on the turntable in the Listening Room.` : `${r.title} is shelved.`)}#r-${r.slug}`);
  });
  // ---------- the sides, streamed ----------
  app.get('/music/:slug/:n', async (req, res) => {
    const r = rec(req.params.slug); if (!r) return res.sendStatus(404);
    if (!(r.status === 'playing' && keyed(req)) && !mine(req, r)) return res.sendStatus(403);
    const s = db.prepare('SELECT * FROM music_sides WHERE recording_id=? AND n=?').get(r.id, +req.params.n); if (!s) return res.sendStatus(404);
    const p = await localPath(s); if (!p) return res.sendStatus(404);
    const size = fs.statSync(p).size; res.set({ 'Content-Type': s.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' });
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m) { const a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], size - 1) : size - 1; if (a > b || a >= size) { res.set('Content-Range', `bytes */${size}`); return res.sendStatus(416); } res.status(206).set({ 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 }); return fs.createReadStream(p, { start: a, end: b }).pipe(res); }
    res.set('Content-Length', size); fs.createReadStream(p).pipe(res);
  });
  app.locals.music = { rec, sides, filesOf };
}
module.exports = { mountMusic };
