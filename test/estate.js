// The estate (4 Nov): the catalogue as one object; the keys handed on only after the papers, the wait and the house;
// the maker can stop it with one tap.
process.env.NODE_ENV = 'test'; process.env.ESTATE_WAIT_DAYS = '30';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-est-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'est', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jarS = {}, jarH = {};
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  await form(jarS, '/studio/login', { password: 'pw' });
  await form(jarS, '/studio/accounts', { name: 'Ada Lindqvist', invite: '0' });
  const m = db.prepare("SELECT * FROM makers WHERE name='Ada Lindqvist'").get();
  db.prepare("UPDATE makers SET email='ada@example.com' WHERE id=?").run(m.id);
  await go(jarS, `/account?maker=${m.handle}`);
  for (const [i, t] of ['Wet Stone', 'North Window'].entries()) { const f = path.join(dir, `w${i}.jpg`); fs.writeFileSync(f, await sharp(path.join(__dirname, 'fixture.jpg')).resize(1200 + i * 100).jpeg().toBuffer()); const w = await app.locals.registerWork({ file: f, title: t, makerId: m.id, originalName: `w${i}.jpg` }); db.prepare("UPDATE works SET status='held' WHERE slug=?").run(w.slug); }
  // The room and the catalogue.
  let r = await go(jarS, '/account/estate'); let t = await r.text(); assert.ok(t.includes('The catalogue of your work.') && t.includes('2 works'), 'the room');
  r = await go(jarS, '/account/estate/catalogue.pdf'); const pdf = Buffer.from(await r.arrayBuffer()); assert.ok(pdf.slice(0, 5).toString() === '%PDF-' && pdf.length > 5000, 'the catalogue as a PDF');
  r = await go(jarS, '/account/estate/catalogue.zip?masters=1'); const zip = Buffer.from(await r.arrayBuffer());
  const unzipper = require('unzipper'); const dirz = await unzipper.Open.buffer(zip); const names = dirz.files.map(f => f.path);
  assert.ok(names.includes('README.txt') && names.includes('works.csv') && names.includes('catalogue.pdf') && names.filter(n => n.startsWith('masters/')).length === 2, 'the zip: ' + names.join(', '));
  const csv = (await dirz.files.find(f => f.path === 'works.csv').buffer()).toString(); assert.ok(/Wet Stone/.test(csv) && /North Window/.test(csv), 'the records');
  const w0 = db.prepare("SELECT * FROM works WHERE title='Wet Stone'").get(); const mf = dirz.files.find(f => /Wet Stone/.test(f.path) && f.path.startsWith('masters/'));
  assert.equal(require('crypto').createHash('sha256').update(await mf.buffer()).digest('hex'), w0.sha256, 'the master leaves byte for byte');
  assert.equal((await fetch(base + '/account/estate/catalogue.pdf', { redirect: 'manual' })).status, 401, 'a stranger gets nothing');
  // Name an heir, told.
  r = await form(jarS, '/account/estate/heirs', { name: 'Elin Lindqvist', email: 'elin@example.com', relation: 'Daughter', role: 'heir', tell: '1' }); assert.ok(/named/.test(decodeURIComponent(r.headers.get('location') || '')), 'named');
  const h = db.prepare("SELECT * FROM estate_heirs WHERE email='elin@example.com'").get(); assert.ok(h && h.told_at, 'told');
  t = await (await fetch(base + '/estate/h/' + h.token)).text(); assert.ok(t.includes('Ada Lindqvist named you') && t.includes('Ask for the keys'), 'her door');
  // She asks with the papers.
  const fd = new FormData(); fd.append('proof', new Blob([await sharp(path.join(__dirname, 'fixture.jpg')).resize(800).jpeg().toBuffer()], { type: 'image/jpeg' }), 'certificate.jpg'); fd.append('note', 'With the certificate.'); fd.append('attest', '1');
  r = await go(jarH, `/estate/h/${h.token}/ask`, { method: 'POST', body: fd }); assert.ok([302, 303].includes(r.status), 'asked');
  let h2 = db.prepare('SELECT * FROM estate_heirs WHERE id=?').get(h.id); assert.equal(h2.status, 'asked'); assert.ok(fs.existsSync(h2.proof), 'the papers kept');
  // The house cannot grant inside the wait.
  r = await form(jarS, `/studio/estate/${h.id}`, { do: 'grant' }); assert.ok(/wait/.test(decodeURIComponent(r.headers.get('location') || '')), 'the wait holds');
  // The maker stops it.
  await go({}, `/estate/stop/${h.stop_token}`, { method: 'POST' });
  assert.equal(db.prepare('SELECT status FROM estate_heirs WHERE id=?').get(h.id).status, 'declined', 'stopped by the maker');
  // Asked again (a second heir), the wait passes, the house grants.
  await form(jarS, '/account/estate/heirs', { name: 'Executor Bo', email: 'bo@example.com', role: 'executor' });
  const e = db.prepare("SELECT * FROM estate_heirs WHERE email='bo@example.com'").get(); assert.ok(!e.told_at, 'not told when not asked');
  const fd2 = new FormData(); fd2.append('proof', new Blob([await sharp(path.join(__dirname, 'fixture.jpg')).resize(800).jpeg().toBuffer()], { type: 'image/jpeg' }), 'letters.jpg'); fd2.append('attest', '1');
  await go({}, `/estate/h/${e.token}/ask`, { method: 'POST', body: fd2 });
  db.prepare("UPDATE estate_heirs SET asked_at=datetime('now','-31 days') WHERE id=?").run(e.id);
  r = await form(jarS, `/studio/estate/${e.id}`, { do: 'grant', word: 'Letters testamentary read.' }); assert.ok(/Granted/.test(decodeURIComponent(r.headers.get('location') || '')), 'granted');
  const seat = db.prepare("SELECT * FROM institution_staff WHERE maker_id=? AND role='estate'").get(m.id); assert.ok(seat, 'a seat at the desk');
  assert.ok(db.prepare('SELECT estate_at FROM makers WHERE id=?').get(m.id).estate_at, 'the studio is kept by the estate');
  // The executor opens the studio as himself and acts for it.
  const jarE = {}; await go(jarE, `/staff/join/${seat.token}`);
  t = await (await go(jarE, '/account/estate')).text(); assert.ok(t.includes('2 works'), 'the executor keeps the studio');
  // Nothing on the public register.
  t = await (await fetch(base + '/ledger')).text(); assert.ok(!/estate/i.test(t.replace(/Your estate|\/estate/g, '')), 'nothing told');
  t = await (await fetch(base + '/estate')).text(); assert.ok(t.includes('The catalogue of everything you have made.'), 'the public page');
  srv.close(); console.log('estate: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
