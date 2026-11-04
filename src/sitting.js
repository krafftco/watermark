// The sitting (Will, 3 Nov, after a show at Gagosian on Madison: "what is it like to live with this art"; "you sometimes
// want to know about the artist so that you can identify with the art"; "art is the manifestation of the artist, a
// portrait of how they see the world"; "who do I want to spend time with; what personalities, what perspectives";
// "Watermark can be a bridge: how the art is displayed versus the living, breathing, three-dimensional personality").
// Every maker may sit for the house: the same ten questions for everyone (QUESTIONS, drafts), so a collector can read
// three artists in a row and feel which one they would want at the table; their own voice (two minutes, recorded in
// the browser or a file); the studio in up to six photographs; and Living with it: a line from people who hold the
// work, written once it has lived with them a while (LIVING_DAYS), only by a holder. Everything comes from the artist
// or the holder, never from Al: the house does not guess at a living person's inner life.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const multer = require('multer');

const QUESTIONS = [
  ['look', 'What do you look at most?'],
  ['taught', 'Who taught you to see?'],
  ['studio', 'Where do you make your work, and what is on the walls there?'],
  ['right', 'What are you trying to get right?'],
  ['live', 'What is it like to live with your work? What does it ask of the person who does?'],
  ['never', 'What would you never make?'],
  ['keep', 'If you could keep only one of your works, which would it be, and why?'],
  ['who', 'Who should not live with your work?'],
  ['now', 'What are you working on now?'],
  ['feel', 'What do you hope someone feels standing in front of it?'],
];
const MAX = 900; const STUDIO_N = 6;

function mountSitting(app, { db, V, C, store, makerOf, buyerOf, isStudio, ledger, images }) {
  const { esc, tidy } = V;
  const LIVING_DAYS = Number(process.env.LIVING_DAYS || 30);
  db.exec(`CREATE TABLE IF NOT EXISTS maker_sittings (maker_id INTEGER PRIMARY KEY, answers TEXT, voice TEXT, voice_type TEXT, voice_seconds INTEGER, studio TEXT, shown INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS living_notes (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, license_id INTEGER NOT NULL UNIQUE, buyer_id INTEGER, body TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const dir = path.join(C.dataDir, 'sittings'); fs.mkdirSync(dir, { recursive: true });
  const up = multer({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: 60 * 1024 * 1024 } });
  const J = (s, d) => { try { return JSON.parse(s || '') || d; } catch (e) { return d; } };
  const of = m => { const s = db.prepare('SELECT * FROM maker_sittings WHERE maker_id=?').get(m.id); return s ? { ...s, answers: J(s.answers, {}), studio: J(s.studio, []) } : { maker_id: m.id, answers: {}, studio: [], shown: 1 }; };
  const save = (m, s) => db.prepare(`INSERT INTO maker_sittings (maker_id, answers, voice, voice_type, voice_seconds, studio, shown, updated_at) VALUES (?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(maker_id) DO UPDATE SET answers=excluded.answers, voice=excluded.voice, voice_type=excluded.voice_type, voice_seconds=excluded.voice_seconds, studio=excluded.studio, shown=excluded.shown, updated_at=excluded.updated_at`)
    .run(m.id, JSON.stringify(s.answers || {}), s.voice || null, s.voice_type || null, s.voice_seconds || null, JSON.stringify(s.studio || []), s.shown === 0 ? 0 : 1);
  const t = v => String(v == null ? '' : v).replace(/<[^>]*>/g, '').replace(/\r/g, '').trim().slice(0, MAX);
  const first = m => String(m.name || '').split(' ')[0];
  const PEOPLE = m => !['institution', 'company', 'printer', 'gallery'].includes(m.kind || 'maker');
  const paras = s => esc(s).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

  // Living with it: what the holders say. A holder of a paid personal licence, held LIVING_DAYS or more, one line a piece.
  const notesOf = m => db.prepare(`SELECT n.body, n.at, w.slug, w.title, b.name FROM living_notes n JOIN works w ON w.id=n.work_id LEFT JOIN buyers b ON b.id=n.buyer_id WHERE w.maker_id=? AND n.removed=0 AND w.status='held' ORDER BY n.id DESC LIMIT 12`).all(m.id);
  const holding = (b, ref) => (b ? db.prepare(`SELECT l.*, w.slug, w.maker_id, w.title FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE l.ref=? AND l.buyer_id=? AND l.status='active' AND u.key IN ('social','reference','print')`).get(String(ref), b.id) : null);
  const daysHeld = l => Math.floor((Date.now() - new Date(String(l.starts_at || l.created_at).replace(' ', 'T') + 'Z').getTime()) / 864e5);

  // The section on the maker's page.
  function section(m, req) {
    if (!m || !PEOPLE(m)) return '';
    const s = of(m); if (!s.shown) return '';
    const said = QUESTIONS.filter(([k]) => s.answers[k]);
    const notes = notesOf(m);
    if (!said.length && !s.voice && !s.studio.length && !notes.length) return '';
    return `<section class="asit" id="sitting"><div class="mh-wrap"><p class="k">The sitting</p><h2 class="asit-h">Meet ${esc(first(m))}.</h2>
${s.voice ? `<p class="asit-v"><button type="button" class="asit-play" data-voice="/sitting/${esc(m.handle)}/voice"><b>Hear ${esc(first(m))}</b><span>In their own voice${s.voice_seconds ? ` · ${Math.floor(s.voice_seconds / 60)}:${String(s.voice_seconds % 60).padStart(2, '0')}` : ''}</span></button></p><script src="/static/voices.js" defer></script>` : ''}
${said.length ? `<dl class="asit-qa">${said.map(([k, q]) => `<div><dt>${esc(q)}</dt><dd>${paras(s.answers[k])}</dd></div>`).join('')}</dl>` : ''}
${s.studio.length ? `<div class="asit-st"><p class="k">The studio</p><div class="asit-strip">${s.studio.map((p, i) => `<figure><img src="/sitting/${esc(m.handle)}/studio/${i}" alt="${esc(p.line || 'The studio')}" loading="lazy">${p.line ? `<figcaption>${esc(p.line)}</figcaption>` : ''}</figure>`).join('')}</div></div>` : ''}
${notes.length ? `<div class="asit-lv"><p class="k">Living with it</p><p class="asit-lvl">From people who have lived with ${esc(first(m))}’s work at home.</p><ul>${notes.map(n => `<li><a href="/w/${esc(n.slug)}"><img src="/img/${esc(n.slug)}/thumb" alt="" loading="lazy"></a><blockquote>${esc(n.body)}</blockquote><cite>${esc((n.name || '').split(' ')[0] || 'A collector')}, who holds <a href="/w/${esc(n.slug)}">${esc(tidy(n.title))}</a></cite></li>`).join('')}</ul></div>` : ''}
<p class="note asit-n">In ${esc(first(m))}’s own words. The house asks every artist the same questions.</p></div></section>`;
  }

  // The artist's desk.
  app.get('/account/sitting', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/sitting');
    const s = of(m);
    res.send(V.layout({ title: 'Your sitting · Watermark', path: '/account/sitting', body: `<section class="studio-wrap asit-desk"><p class="k">Your page and store</p><h1>Your sitting</h1>
<p class="lede">People who live with a work live with the person who made it. These are the same ten questions the house asks every artist, so that someone can meet you before they choose your work. Answer as many as you like, in your own words; leave any blank. Nothing here is written for you.</p>
${req.query.ok ? `<p class="ok">Kept.</p>` : ''}
<form method="post" action="/account/sitting" class="asit-f">${QUESTIONS.map(([k, q], i) => `<label><span>${i + 1}. ${esc(q)}</span><textarea name="${k}" rows="3" maxlength="${MAX}">${esc(s.answers[k] || '')}</textarea></label>`).join('')}
<label class="asit-show"><input type="checkbox" name="shown" value="1"${s.shown ? ' checked' : ''}> Show my sitting on my page</label><button class="buy-btn">Keep</button></form>
<h2>Your voice</h2><p>Two minutes, about one work or about why you make it. Record it here or choose a file.</p>
${s.voice ? `<p><button type="button" class="asit-play" data-voice="/sitting/${esc(m.handle)}/voice"><b>Hear it</b><span>${s.voice_seconds || ''} s</span></button> <form method="post" action="/account/sitting/voice/remove" style="display:inline"><button class="link">Take it down</button></form></p>` : ''}
<form method="post" action="/account/sitting/voice" enctype="multipart/form-data" data-vo-form class="asit-vf"><button type="button" class="buy-btn" data-rec><span>Record</span></button> <span data-rec-time></span><audio data-rec-play controls hidden></audio>
<label>Or a file <input type="file" name="audio" accept="audio/*"></label><input type="hidden" name="seconds" value=""><button class="buy-btn">Keep the voice</button></form>
<h2>The studio</h2><p>Up to ${STUDIO_N} photographs of where you work: the walls, the table, the window, the mess.</p>
${s.studio.length ? `<div class="asit-strip">${s.studio.map((p, i) => `<figure><img src="/sitting/${esc(m.handle)}/studio/${i}" alt=""><figcaption>${esc(p.line || '')} <form method="post" action="/account/sitting/studio/${i}/remove"><button class="link">Remove</button></form></figcaption></figure>`).join('')}</div>` : ''}
${s.studio.length < STUDIO_N ? `<form method="post" action="/account/sitting/studio" enctype="multipart/form-data" class="asit-sf"><input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required><input name="line" maxlength="140" placeholder="A line about it (optional)"><button class="buy-btn">Add it</button></form>` : ''}
<p><a href="/m/${esc(m.handle)}#sitting">See it on your page</a></p></section><script src="/static/voices.js" defer></script>` }));
  });
  app.post('/account/sitting', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const s = of(m); const b = req.body || {};
    for (const [k] of QUESTIONS) { const v = t(b[k]); if (v) s.answers[k] = v; else delete s.answers[k]; }
    s.shown = b.shown === '1' ? 1 : 0; save(m, s);
    ledger.append(db, 'maker.sat', m.handle, { answered: Object.keys(s.answers).length });
    res.redirect(303, '/account/sitting?ok=1');
  });
  app.get('/account/sitting/voice', (req, res) => res.redirect('/account/sitting' + (req.query.ok ? '?ok=1' : '')));
  app.post('/account/sitting/voice', up.single('audio'), (req, res, next) => app.locals.bagcheck.gate('audio')(req, res, next), async (req, res) => {
    const m = makerOf(req); if (!m) { if (req.file) fs.unlink(req.file.path, () => {}); return res.sendStatus(401); }
    if (!req.file) return res.redirect(303, '/account/sitting');
    const type = req.file.mimetype || 'audio/webm'; const ext = /mp4|m4a|aac/.test(type) ? '.m4a' : /mpeg|mp3/.test(type) ? '.mp3' : /wav/.test(type) ? '.wav' : /ogg/.test(type) ? '.ogg' : '.webm';
    const key = `sittings/${m.id}-voice-${crypto.randomBytes(5).toString('hex')}${ext}`; const local = path.join(C.dataDir, key);
    try { fs.renameSync(req.file.path, local); } catch (e) { fs.copyFileSync(req.file.path, local); fs.unlinkSync(req.file.path); }
    try { await store.put(key, local, type); } catch (e) { console.error('[sitting] store', e.message); }
    const s = of(m); s.voice = key; s.voice_type = type; s.voice_seconds = Math.max(0, Math.min(600, Math.round(Number((req.body || {}).seconds) || 0))) || null; save(m, s);
    if (/json/.test(req.get('accept') || '')) return res.json({ ok: true });
    res.redirect(303, '/account/sitting?ok=1');
  });
  app.post('/account/sitting/voice/remove', (req, res) => { const m = makerOf(req); if (!m) return res.sendStatus(401); const s = of(m); s.voice = null; s.voice_type = null; s.voice_seconds = null; save(m, s); res.redirect(303, '/account/sitting'); });
  app.post('/account/sitting/studio', up.single('photo'), (req, res, next) => app.locals.bagcheck.gate('image')(req, res, next), async (req, res) => {
    const m = makerOf(req); if (!m) { if (req.file) fs.unlink(req.file.path, () => {}); return res.sendStatus(401); }
    const s = of(m); if (!req.file || s.studio.length >= STUDIO_N) { if (req.file) fs.unlink(req.file.path, () => {}); return res.redirect(303, '/account/sitting'); }
    const key = `sittings/${m.id}-studio-${crypto.randomBytes(5).toString('hex')}.jpg`; const local = path.join(C.dataDir, key);
    try { await require('sharp')(req.file.path).rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(local); } catch (e) { fs.unlink(req.file.path, () => {}); return res.redirect(303, '/account/sitting'); }
    fs.unlink(req.file.path, () => {});
    try { await store.put(key, local, 'image/jpeg'); } catch (e) { console.error('[sitting] store', e.message); }
    s.studio.push({ file: key, line: String((req.body || {}).line || '').replace(/<[^>]*>/g, '').trim().slice(0, 140) || null }); save(m, s);
    res.redirect(303, '/account/sitting?ok=1');
  });
  app.post('/account/sitting/studio/:i/remove', (req, res) => { const m = makerOf(req); if (!m) return res.sendStatus(401); const s = of(m); s.studio.splice(+req.params.i, 1); save(m, s); res.redirect(303, '/account/sitting'); });
  // The files: local first, else the vault.
  const serve = async (res, key, type) => {
    const local = path.join(C.dataDir, key);
    if (!fs.existsSync(local) && store.get) { try { const buf = await store.get(key); if (buf) fs.writeFileSync(local, buf); } catch (e) { /* */ } }
    if (!fs.existsSync(local)) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=3600'); res.type(type); res.sendFile(local);
  };
  const shownOf = handle => { const m = db.prepare('SELECT * FROM makers WHERE handle=?').get(String(handle)); return m ? { m, s: of(m) } : null; };
  app.get('/sitting/:handle/voice', async (req, res) => { const x = shownOf(req.params.handle); if (!x || !x.s.voice || (!x.s.shown && (makerOf(req) || {}).id !== x.m.id)) return res.sendStatus(404); serve(res, x.s.voice, x.s.voice_type || 'audio/webm'); });
  app.get('/sitting/:handle/studio/:i', async (req, res) => { const x = shownOf(req.params.handle); const p = x && x.s.studio[+req.params.i]; if (!p || (!x.s.shown && (makerOf(req) || {}).id !== x.m.id)) return res.sendStatus(404); serve(res, p.file, 'image/jpeg'); });

  // Living with it: the holder's line.
  app.post('/yours/p/:ref/living', (req, res) => {
    const b = buyerOf(req); const l = holding(b, req.params.ref); if (!l) return res.sendStatus(403);
    if (daysHeld(l) < LIVING_DAYS) return res.redirect(303, `/yours/p/${encodeURIComponent(l.ref)}?ok=living-soon`);
    const body = String((req.body || {}).body || '').replace(/<[^>]*>/g, '').replace(/https?:\/\/\S+/g, '').trim().slice(0, 400);
    if (body.length < 12) return res.redirect(303, `/yours/p/${encodeURIComponent(l.ref)}?ok=living-short`);
    db.prepare("INSERT INTO living_notes (work_id, license_id, buyer_id, body) VALUES (?,?,?,?) ON CONFLICT(license_id) DO UPDATE SET body=excluded.body, removed=0, at=datetime('now')").run(l.work_id, l.id, b.id, body);
    ledger.append(db, 'living.said', l.slug, {});
    if (app.locals.notify && app.locals.notify.tell) { try { app.locals.notify.tell({ maker_id: l.maker_id, kind: 'bench', title: 'Someone wrote about living with your work', body: body.slice(0, 120), href: `/m/${l.slug}#sitting` }); } catch (e) { /* */ } }
    res.redirect(303, `/yours/p/${encodeURIComponent(l.ref)}?ok=living`);
  });
  // The card in the holder's room.
  function livingCard(l, b) {
    if (!l || !b || l.buyer_id !== b.id) return '';
    const n = db.prepare('SELECT body FROM living_notes WHERE license_id=? AND removed=0').get(l.id);
    const d = daysHeld(l);
    if (d < LIVING_DAYS && !n) return `<div class="kp-tile asit-lt"><b>Living with it</b><span>In ${LIVING_DAYS - d} days you can tell others what it is like to live with this piece. The artist will read it.</span></div>`;
    return `<form method="post" action="/yours/p/${esc(l.ref)}/living" class="kp-tile asit-lt"><b>Living with it</b><span>What is it like to live with it? A line for others deciding, and for the artist.</span><textarea name="body" rows="3" maxlength="400" required>${esc(n ? n.body : '')}</textarea><button class="buy-btn">${n ? 'Keep' : 'Say it'}</button></form>`;
  }
  // The maker (or the house) takes a line down.
  app.post('/living/:id/remove', (req, res) => {
    const n = db.prepare('SELECT n.*, w.maker_id FROM living_notes n JOIN works w ON w.id=n.work_id WHERE n.id=?').get(+req.params.id); if (!n) return res.sendStatus(404);
    const me = makerOf(req); const b = buyerOf(req);
    if (!(isStudio(req) || (me && me.id === n.maker_id) || (b && b.id === n.buyer_id))) return res.sendStatus(403);
    db.prepare('UPDATE living_notes SET removed=1 WHERE id=?').run(n.id); res.redirect(303, req.get('referer') || '/account');
  });
  app.locals.sitting = { QUESTIONS, section, livingCard, of };
  return app.locals.sitting;
}
module.exports = { mountSitting, QUESTIONS };
