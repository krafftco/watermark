'use strict';
// An address is opened only by its owner (12 Nov). The open door and an introduction link let a NEW address in,
// unproven; an address the house already knows is sent to sign in with a code; the first proof signs earlier devices out.
process.env.NODE_ENV = 'test';
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-prf-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'prf', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const form = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const post = (u, body, cookie, json) => fetch(base + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded', origin: base, ...(cookie ? { cookie } : {}) }, body: json ? JSON.stringify(body) : form(body) });
  const jar = r => r.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => !/=$/.test(c)).join('; ');
  // a stranger opens a museum with a new address: let in, unproven
  let r = await post('/record', { name: 'Ada Lovelace', email: 'ada@example.com', adult: '1' });
  assert.strictEqual(r.status, 302); assert.ok(/\/account\/upload/.test(r.headers.get('location')));
  const first = jar(r); assert.ok(/wm_m=/.test(first), 'the new address is let in');
  let m = db.prepare("SELECT * FROM makers WHERE email='ada@example.com'").get(); assert.strictEqual(m.email_ok, 0, 'and marked unproven');
  r = await fetch(base + '/account', { headers: { cookie: first }, redirect: 'manual' }); assert.strictEqual(r.status, 200);
  // a second stranger types the same address: never let in
  r = await post('/record', { name: 'Not Ada', email: 'ada@example.com', adult: '1' });
  assert.ok(/\/signin\?/.test(r.headers.get('location')), 'a known address is sent to sign in');
  assert.ok(!/wm_m=|wm_b=/.test(jar(r)), 'and given no cookie');
  // the honeypot gives nothing
  r = await post('/record', { name: 'Bot', email: 'bot@example.com', adult: '1', website: 'http://spam' });
  assert.ok(!db.prepare("SELECT 1 FROM makers WHERE email='bot@example.com'").get(), 'a form-filler makes no account'); assert.ok(!/wm_m=/.test(jar(r)));
  // the owner proves the address with a code: theirs now, and the earlier device is out
  r = await post('/signin/code', { email: 'ada@example.com' }, null, true); assert.strictEqual(r.status, 200);
  const { code } = app.locals.lastCode;
  r = await post('/signin/verify', { email: 'ada@example.com', code }, null, true); assert.strictEqual(r.status, 200);
  const owner = jar(r); assert.ok(/wm_m=/.test(owner));
  m = db.prepare("SELECT * FROM makers WHERE email='ada@example.com'").get(); assert.strictEqual(m.email_ok, 1, 'proven');
  r = await fetch(base + '/account', { headers: { cookie: owner }, redirect: 'manual' }); assert.strictEqual(r.status, 200, 'the owner is in');
  r = await fetch(base + '/account', { headers: { cookie: first }, redirect: 'manual' }); assert.notStrictEqual(r.status, 200, 'the device let in before the proof is out');
  // a collector's address the house knows is never opened by an introduction link
  db.prepare("INSERT INTO buyers (customer, email, name, code) VALUES ('', 'col@example.com', 'Col', 'colcode001')").run();
  db.prepare("INSERT INTO introductions (token, by_kind, by_id, label, opens, uses, max_uses) VALUES ('tok123', 'house', 0, 'test', 'collector', 0, 50)").run();
  r = await post('/i/tok123', { name: 'Someone', email: 'col@example.com' });
  assert.ok(/\/signin\?/.test(r.headers.get('location') || ''), 'known collector → sign in: ' + r.status + ' ' + r.headers.get('location')); assert.ok(!/wm_b=/.test(jar(r)));
  // the first-week letters never go to an unproven address with nothing brought in
  r = await post('/record', { name: 'Typed Address', email: 'victim@example.com', adult: '1' });
  const before = (app.locals.mailLog || []).length;
  db.prepare("UPDATE makers SET joined_at=datetime('now','-2 days') WHERE email='victim@example.com'").run();
  if (app.locals.firstWeek && app.locals.firstWeek.mornings) { app.locals.firstWeek.mornings({ force: true }); await new Promise(z => setTimeout(z, 100)); assert.ok(!(app.locals.mailLog || []).slice(before).some(l => /victim@/.test(String(l.to))), 'no first-week letter to an unproven address'); }
  console.log('proof: an address is opened only by its owner'); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
