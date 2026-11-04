// The loan desk (3 Nov): a museum asks another for a work; the lender agrees with its terms; the agreement is set out
// and fingerprinted; condition reports at each handover; home, the loan is the work's exhibition history.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-loan-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'loan', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; } return r; });
  const form = (p, body) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  await form('/studio/login', { password: 'pw' });
  for (const [name, kind] of [['The Lender Museum', 'institution'], ['The Borrowing Museum', 'institution'], ['A Painter', 'maker']]) await form('/studio/accounts', { name, kind, invite: '0' });
  const L = db.prepare("SELECT * FROM makers WHERE name='The Lender Museum'").get(), B = db.prepare("SELECT * FROM makers WHERE name='The Borrowing Museum'").get(), P = db.prepare("SELECT * FROM makers WHERE name='A Painter'").get();
  const f = path.join(dir, 'w.jpg'); fs.writeFileSync(f, await sharp(path.join(__dirname, 'fixture.jpg')).resize(1400).jpeg().toBuffer());
  const w = await app.locals.registerWork({ file: f, title: 'Interior with a Window', makerId: L.id, kind: 'painting', originalName: 'w.jpg' }); db.prepare("UPDATE works SET status='held' WHERE slug=?").run(w.slug);
  const as = h => go(`/account?maker=${h}`);
  const page = async p => { let r = await go(p); for (let i = 0; i < 3 && r.status >= 300 && r.status < 400; i++) r = await go(new URL(r.headers.get('location'), base).pathname + (new URL(r.headers.get('location'), base).search)); return r.text(); };
  // A painter cannot borrow; a museum can, and sees the door.
  await as(P.handle); let r = await go(`/account/loans/new?work=${w.slug}`); assert.ok(/borrow-kind/.test(r.headers.get('location') || ''), 'a maker lends, does not borrow');
  await as(B.handle); let t = await page('/w/' + w.slug); assert.ok(t.includes('Ask to borrow it for a show'), 'the door on the work for a museum');
  r = await form('/account/loans', { work: w.slug, show: 'Light and Water', venue: 'The Borrowing Museum', city: 'Boston', opens: '2027-03-01', closes: '2027-06-30', facility: '21°C, 50% RH, 50 lux', note: 'The centre of the show.' });
  const id = +(r.headers.get('location') || '').split('/').pop(); assert.ok(id > 0, 'asked: ' + r.headers.get('location'));
  // A third party sees nothing.
  assert.equal((await fetch(base + `/account/loans/${id}`, { redirect: 'manual' })).status, 403, 'a stranger cannot read the thread');
  // The lender agrees.
  await as(L.handle); t = await (await go('/account/loans')).text(); assert.ok(t.includes('Asked of you') && t.includes('Interior with a Window'), 'the lender sees it');
  await form(`/account/loans/${id}/step`, { do: 'agree', cover: 'indemnity', value: '250000', credit: 'Lent by The Lender Museum, New York', courier: '1' });
  let l = db.prepare('SELECT * FROM loans WHERE id=?').get(id); assert.equal(l.status, 'agreed'); assert.ok(l.agreement.includes('Indemnity') && l.agreement.includes('$250,000') && l.agreement.includes('with a courier') && /^[0-9a-f]{64}$/.test(l.agreement_hash), 'the agreement set out and fingerprinted');
  // The handovers.
  const step = async (stage, photo) => { const fd = new FormData(); fd.append('do', stage); fd.append('condition', `Sound, as it ${stage}.`); if (photo) fd.append('photo', new Blob([await sharp(path.join(__dirname, 'fixture.jpg')).resize(600).jpeg().toBuffer()], { type: 'image/jpeg' }), 'c.jpg'); return go(`/account/loans/${id}/step`, { method: 'POST', body: fd }); };
  await step('left', true); assert.equal(db.prepare('SELECT status FROM loans WHERE id=?').get(id).status, 'out', 'it has left');
  await as(B.handle); await step('arrived'); await step('returned'); assert.equal(db.prepare('SELECT status FROM loans WHERE id=?').get(id).status, 'back');
  t = await page('/w/' + w.slug); assert.ok(t.includes('Exhibition history') && t.includes('Light and Water') && t.includes('on loan now'), 'on loan, said on the work');
  await as(L.handle); await step('home');
  l = db.prepare('SELECT * FROM loans WHERE id=?').get(id); assert.equal(l.status, 'home'); assert.equal(JSON.parse(l.reports).length, 4, 'four condition reports');
  r = await go(`/account/loans/${id}/report/0`); assert.equal(r.headers.get('content-type'), 'image/jpeg', 'the photograph with the first report');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='work.lent'").get().n, 1, 'written on the register');
  t = await (await fetch(base + '/w/' + w.slug)).text(); assert.ok(t.includes('Exhibition history') && t.includes('2027') && t.includes('Lent to The Borrowing Museum') && !t.includes('on loan now'), 'home: the exhibition history');
  t = await (await fetch(base + '/ledger?span=all')).text(); assert.ok(t.includes('lent') && t.includes('Light and Water'), 'told on the public register');
  assert.ok(!(await (await fetch(base + '/ledger?span=all')).text()).includes('loan.asked'), 'the asking stays private');
  srv.close(); console.log('loans: all hold');
})().catch(e => { console.error(e); process.exit(1); });
