// The notebook (4 Nov): a note on a work (a line, a voice), private unless shared; Kept, with how long you looked;
// what held people, counted and never named.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-nbk-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'nbk', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const J = () => ({});
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const studio = J(); await form(studio, '/studio/login', { password: 'pw' }); await form(studio, '/studio/accounts', { name: 'Ada Lindqvist', invite: '0' });
  const m = db.prepare("SELECT * FROM makers WHERE name='Ada Lindqvist'").get();
  const f = path.join(dir, 'a.jpg'); fs.writeFileSync(f, await sharp(path.join(__dirname, 'fixture.jpg')).resize(1200).jpeg().toBuffer());
  const w = await app.locals.registerWork({ file: f, title: 'Wet Stone', makerId: m.id, originalName: 'a.jpg' });
  db.prepare("UPDATE works SET status='held' WHERE slug=?").run(w.slug);
  const signin = async (jar, email) => { app.locals.lastCode = null; await form(jar, '/signin/code', { email }); await form(jar, '/signin/verify', { email, code: app.locals.lastCode.code }); db.prepare("UPDATE buyers SET name=? WHERE email=?").run(email.startsWith('cole') ? 'Cole Davis' : 'Bea Moss', email); };

  const stranger = J();
  let r = await go(stranger, `/w/${w.slug}/note`, { method: 'POST', body: (() => { const fd = new FormData(); fd.append('body', 'Hello'); return fd; })(), headers: { accept: 'application/json' } });
  assert.equal(r.status, 401); assert.ok((await r.json()).go.startsWith('/signin'), 'a stranger is sent to sign in');

  const cole = J(); await signin(cole, 'cole@example.com');
  const note = async (jar, body, pub, audio) => { const fd = new FormData(); fd.append('body', body); fd.append('public', pub ? '1' : '0'); if (audio) { fd.append('voice', new Blob([audio], { type: 'audio/wav' }), 'note.wav'); fd.append('made', 'voice'); fd.append('seconds', '3'); } return go(jar, `/w/${w.slug}/note`, { method: 'POST', body: fd, headers: { accept: 'application/json' } }); };
  r = await note(cole, 'The stone holds the rain like a held breath.', false); let j = await r.json(); assert.ok(j.ok && !j.public, 'a private note: ' + JSON.stringify(j));
  // a voice: a small WAV, through the bag check
  const wav = (() => { const n = 8000, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), 44 + i * 2); return b; })();
  r = await note(cole, 'Said aloud.', true, wav); j = await r.json(); assert.ok(j.ok && j.public && j.audio, 'a shared voice note: ' + JSON.stringify(j));
  r = await note(cole, 'see www.example.com', true); assert.equal(r.status, 400, 'a shared note carries no links');

  // the work page: the shared note shows to a stranger, the private one does not
  let t = await (await go(stranger, `/w/${w.slug}`)).text();
  assert.ok(t.includes('Said aloud.') && !t.includes('held breath') && t.includes('data-note='), 'shared shows, private stays private, Note on the page');
  assert.equal((await go(stranger, j.audio)).status, 200, 'a shared voice plays for anyone');
  const priv = db.prepare("SELECT id FROM work_notes WHERE body LIKE 'The stone%'").get();
  const rid = db.prepare("SELECT id FROM work_notes WHERE body='Said aloud.'").get().id;
  db.prepare("UPDATE work_notes SET public=0 WHERE id=?").run(rid);
  assert.equal((await go(stranger, `/note/${rid}/audio`)).status, 404, 'a private voice is the writer’s alone');
  assert.equal((await go(cole, `/note/${rid}/audio`)).status, 200, 'the writer hears it');
  t = await (await go(cole, `/w/${w.slug}`)).text(); assert.ok(t.includes('held breath') && t.includes('kept to yourself'), 'the writer sees their own');

  // hats, bravo, and looking: Kept
  await go(cole, `/w/${w.slug}/applaud`, { method: 'POST', headers: { accept: 'application/json' } });
  const cb = db.prepare("SELECT id FROM buyers WHERE email='cole@example.com'").get();
  db.prepare("INSERT INTO stood (work_id, viewer, buyer_id, seconds, visits) VALUES (?, 'v-cole', ?, 252, 3)").run(w.id, cb.id);
  t = await (await go(cole, '/yours/kept')).text();
  assert.ok(t.includes('Wet Stone') && t.includes('4 min') && t.includes('3 visits') && t.includes('a hat') && t.includes('held breath'), 'Kept: the work, how long, the hat, the note');
  t = await (await go(cole, '/yours/kept?k=looked')).text(); assert.ok(t.includes('Longest looked') && t.includes('Wet Stone'));
  assert.ok((await go(stranger, '/yours/kept')).headers.get('location').startsWith('/signin'), 'Kept is private');

  // the other person cannot take down Cole's note; Cole can
  const bea = J(); await signin(bea, 'bea@example.com');
  assert.equal((await form(bea, `/note/${priv.id}/remove`, {})).status, 403);
  assert.equal((await form(bea, `/note/${priv.id}/public`, { on: '1' })).status, 403, 'only the writer shares it');
  await form(cole, `/note/${priv.id}/public`, { on: '1' }); assert.equal(db.prepare('SELECT public FROM work_notes WHERE id=?').get(priv.id).public, 1, 'shared later');

  // what held people: hidden below three people, counted (never named) at three
  await go(studio, `/account?maker=${m.handle}`);
  t = await (await go(studio, '/account/held')).text(); assert.ok(!t.includes('Wet Stone</a>'), 'one person is not enough to show');
  for (const v of ['v2', 'v3']) db.prepare("INSERT INTO stood (work_id, viewer, seconds, visits) VALUES (?, ?, 60, 1)").run(w.id, v);
  t = await (await go(studio, '/account/held')).text(); assert.ok(t.includes('Wet Stone</a>') && !t.includes('Cole'), 'three people: shown, unnamed');
  srv.close(); console.log('notebook: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
