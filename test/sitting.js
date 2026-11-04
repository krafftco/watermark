// The sitting (3 Nov): an artist answers the house's questions, records their voice, shows the studio; a holder writes
// what living with the work is like, only after it has lived with them; nothing on a museum's page; nothing by Al.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sit-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'sit', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jarS = {}, jarB = {};
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  await form(jarS, '/studio/login', { password: 'pw' });
  await form(jarS, '/studio/accounts', { name: 'Ada Lindqvist', invite: '0' });
  const m = db.prepare("SELECT * FROM makers WHERE name='Ada Lindqvist'").get();
  await go(jarS, `/account?maker=${m.handle}`);
  // Her answers.
  await form(jarS, '/account/sitting', { look: 'Light on wet stone, mostly.', live: 'It is quiet in the morning and loud at night.\n\nIt asks you to look twice.', shown: '1' });
  // Her voice: a tenth of a second of silence as a WAV.
  const pcm = Buffer.alloc(1600); const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0]), Buffer.from('data'), Buffer.from([0x40, 6, 0, 0]), pcm]); wav.writeUInt32LE(wav.length - 8, 4);
  let fd = new FormData(); fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'voice.wav'); fd.append('seconds', '7');
  let r = await go(jarS, '/account/sitting/voice', { method: 'POST', body: fd }); assert.ok([302, 303].includes(r.status), 'voice kept: ' + r.status);
  fd = new FormData(); fd.append('photo', new Blob([await sharp(path.join(__dirname, 'fixture.jpg')).resize(900).jpeg().toBuffer()], { type: 'image/jpeg' }), 'studio.jpg'); fd.append('line', 'The north window');
  r = await go(jarS, '/account/sitting/studio', { method: 'POST', body: fd }); assert.ok([302, 303].includes(r.status), 'studio kept');
  const s = app.locals.sitting.of(m); assert.equal(s.studio.length, 1); assert.ok(s.voice && s.voice_seconds === 7, 'the voice and its length');
  // A work of hers, held by a collector for forty days.
  const f = path.join(dir, 'w.jpg'); fs.writeFileSync(f, await sharp(path.join(__dirname, 'fixture.jpg')).resize(1400).jpeg().toBuffer());
  const w = await app.locals.registerWork({ file: f, title: 'Wet Stone', makerId: m.id, originalName: 'w.jpg' }); db.prepare("UPDATE works SET status='held' WHERE slug=?").run(w.slug);
  await go(jarB, '/signin/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'holder@example.com' }) });
  await go(jarB, '/signin/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'holder@example.com', code: app.locals.lastCode.code }) });
  const b = db.prepare("SELECT * FROM buyers WHERE lower(email)='holder@example.com'").get(); assert.ok(b, 'the holder signed in');
  db.prepare("UPDATE buyers SET name='Mira Holt' WHERE id=?").run(b.id);
  const use = db.prepare("SELECT id FROM uses WHERE maker_id=? AND key='social'").get(m.id).id;
  db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, price_cents, status, starts_at, buyer_id, collector_no) VALUES ('WM-2026-777001', ?, ?, 'Mira Holt', 'holder@example.com', 700, 'active', datetime('now','-40 days'), ?, 1)").run(w.id, use, b.id);
  db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, price_cents, status, starts_at, buyer_id, collector_no) VALUES ('WM-2026-777002', ?, ?, 'Mira Holt', 'holder@example.com', 700, 'active', datetime('now','-3 days'), ?, 2)").run(w.id, use, b.id);
  r = await form(jarB, '/yours/p/WM-2026-777002/living', { body: 'Too soon to say much about it yet.' }); assert.ok(/living-soon/.test(r.headers.get('location') || ''), 'not before it has lived with you');
  r = await form(jarB, '/yours/p/WM-2026-777001/living', { body: 'It changes with the weather in the hall. I stop every morning.' }); assert.ok(/ok=living$/.test(r.headers.get('location') || ''), 'the holder speaks');
  r = await fetch(base + '/yours/p/WM-2026-777001/living', { method: 'POST', redirect: 'manual', headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: 'body=a+stranger+speaking+here' }); assert.equal(r.status, 403, 'a stranger cannot');
  // Her page.
  const t = await (await fetch(base + '/m/' + m.handle)).text();
  for (const x of ['Meet Ada.', 'What do you look at most?', 'Light on wet stone', 'It asks you to look twice.', `/sitting/${m.handle}/voice`, `/sitting/${m.handle}/studio/0`, 'The north window', 'Living with it', 'It changes with the weather', 'Mira, who holds']) assert.ok(t.includes(x), 'the page has ' + x);
  assert.ok(!t.includes('Who taught you to see?'), 'unanswered questions are left out');
  r = await fetch(base + `/sitting/${m.handle}/voice`); assert.equal(r.status, 200, 'the voice plays');
  r = await fetch(base + `/sitting/${m.handle}/studio/0`); assert.equal(r.headers.get('content-type'), 'image/jpeg', 'the studio shows');
  // Kept private.
  await form(jarS, '/account/sitting', { look: 'Light on wet stone, mostly.' });
  assert.ok(!(await (await fetch(base + '/m/' + m.handle)).text()).includes('Meet Ada.'), 'the sitting can be kept off the page');
  assert.equal((await fetch(base + `/sitting/${m.handle}/voice`)).status, 404, 'and its voice');
  srv.close(); console.log('sitting: all hold');
})().catch(e => { console.error(e); process.exit(1); });
