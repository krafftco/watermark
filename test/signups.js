'use strict';
// Sign-up bursts send no mail to strangers (#24, 12 Nov): form-filling bots posted the open door with other people's
// addresses and the house wrote to each. The door now carries a signed form time, opens at most RECORD_PER_HOUR new
// museums an hour in all (bots rotate addresses), and the letters the house sends by itself stop at MAIL_DAY_MAX a day,
// while sign-in codes always go.
process.env.NODE_ENV = 'test'; process.env.RECORD_MIN_MS = '0';
delete process.env.RECORD_PER_HOUR; delete process.env.MAIL_DAY_MAX;
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert'), crypto = require('crypto');
const { createApp } = require('../src/app');
const mail = require('../src/mail');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sgn-'));
  const SECRET = 'sgn';
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: SECRET, noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const log = app.locals.mailLog;
  const enc = o => new URLSearchParams(o).toString();
  const post = (u, body, ip, json) => fetch(base + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded', origin: base, 'x-forwarded-for': ip || '10.9.9.9' }, body: json ? JSON.stringify(body) : enc(body) });
  const tokOf = async (door = '/join') => ((await (await fetch(base + door)).text()).match(/name="t" value="([^"]+)"/) || [])[1];
  const opened = () => Number(db.prepare("SELECT COUNT(*) n FROM makers WHERE door='record'").get().n);
  const welcomes = (since = 0) => log.slice(since).filter(l => l.subject === 'Your museum is open').length;
  const age = () => db.prepare("UPDATE makers SET joined_at=datetime('now','-3 hours') WHERE door='record'").run();

  // Both doors carry the signed form time.
  const t1 = await tokOf('/join'), t2 = await tokOf('/own');
  assert.ok(/^\d+\.[0-9a-f]{32}$/.test(t1 || '') && /^\d+\.[0-9a-f]{32}$/.test(t2 || ''), 'the /join and /own forms carry a token');

  // (a) Fifty sign-ups in a burst from fifty addresses, each with a fresh form: at most the hour's ceiling (40) open,
  // and no more welcome letters than that; the rest see the busy page.
  let L0 = log.length, busy = 0;
  const burst = await Promise.all(Array.from({ length: 50 }, async (_, i) => { const t = await tokOf(); return post('/record', { name: `Bot ${i}`, email: `victim${i}@example.com`, adult: '1', t }, `10.0.${i}.1`); }));
  for (const r of burst) if (r.status === 429) { busy++; const b = await r.text(); assert.ok(/The door is busy; try again in a little while, or sign in if you have been here before/.test(b), 'a kind page, not a bare status'); }
  assert.ok(opened() <= 40, `at most 40 opened (opened ${opened()})`); assert.strictEqual(opened() + busy, 50, 'the rest were told the door is busy');
  assert.ok(welcomes(L0) <= 40 && welcomes(L0) === opened(), `no more letters than accounts (${welcomes(L0)})`);
  console.log(`  a burst of 50: ${opened()} opened, ${busy} told the door is busy, ${welcomes(L0)} letters`);

  // With RECORD_PER_HOUR=5, five.
  age(); const before = opened(); process.env.RECORD_PER_HOUR = '5'; L0 = log.length;
  await Promise.all(Array.from({ length: 50 }, async (_, i) => { const t = await tokOf(); return post('/record', { name: `Bot B${i}`, email: `b${i}@example.com`, adult: '1', t }, `10.1.${i}.1`); }));
  assert.strictEqual(opened() - before, 5, 'only five with RECORD_PER_HOUR=5'); assert.strictEqual(welcomes(L0), 5, 'and five letters');
  delete process.env.RECORD_PER_HOUR; age();

  // (b) No token, a forged one, one too young, one too old: answered as if it worked; nothing made, nothing mailed.
  const sig = ts => crypto.createHmac('sha256', SECRET).update(`record.${ts}`).digest('hex').slice(0, 32);
  L0 = log.length; const n0 = opened();
  const fakes = [undefined, 'nonsense', `${Date.now()}.${'0'.repeat(32)}`, `${Date.now() - 3 * 3600000}.${sig(Date.now() - 3 * 3600000)}`];
  for (const [i, t] of fakes.entries()) { const r = await post('/record', { name: 'Fake', email: `fake${i}@example.com`, adult: '1', ...(t ? { t } : {}) }, `10.2.${i}.1`); assert.ok(/welcome=own/.test(r.headers.get('location') || ''), 'redirected as if it worked'); assert.ok(!r.headers.getSetCookie().some(c => /^wm_m=[^;]/.test(c)), 'no cookie'); }
  process.env.RECORD_MIN_MS = '3000';
  { const t = await tokOf(); const r = await post('/record', { name: 'Fast', email: 'fast@example.com', adult: '1', t }, '10.2.9.1'); assert.ok(/welcome=own/.test(r.headers.get('location') || '')); }
  assert.strictEqual(opened(), n0, 'nothing made'); assert.strictEqual(welcomes(L0), 0, 'nothing mailed');
  console.log('  no token, a forged token, too old, too fast: nothing made or mailed');

  // (c) A real person: the form, a moment to read it, the post. Opened, signed in, one letter.
  process.env.RECORD_MIN_MS = '300'; L0 = log.length;
  { const t = await tokOf(); await new Promise(z => setTimeout(z, 400)); const r = await post('/record', { name: 'Real Person', email: 'real@example.com', adult: '1', t }, '10.3.0.1');
    assert.ok(/\/account\/upload\?welcome=own/.test(r.headers.get('location')), 'opened'); assert.ok(r.headers.getSetCookie().some(c => /^wm_m=[^;]/.test(c)), 'signed in');
    assert.ok(db.prepare("SELECT 1 FROM makers WHERE email='real@example.com' AND door='record'").get(), 'a museum'); }
  assert.strictEqual(log.slice(L0).filter(l => String(l.to) === 'real@example.com').length, 1, 'and its one letter');
  process.env.RECORD_MIN_MS = '0';
  // The welcome goes at most once a day to an address, whatever asks again.
  L0 = log.length; for (let i = 0; i < 3; i++) await mail.send({ kind: 'auto', once: 'welcome:real@example.com', to: 'real@example.com', subject: 'Your museum is open', text: 'again' });
  assert.strictEqual(welcomes(L0), 0, 'the welcome is never sent twice in a day');

  // (d) The day's ceiling on the house's own letters: three go, the fourth waits; a sign-in code still goes.
  db.prepare("DELETE FROM settings WHERE k LIKE 'mail_auto_%'").run(); process.env.MAIL_DAY_MAX = '3'; L0 = log.length;
  const res = []; for (let i = 0; i < 4; i++) res.push(await mail.send({ kind: 'auto', to: `m${i}@example.com`, subject: 'A morning letter', text: 'x' }));
  assert.strictEqual(log.slice(L0).filter(l => l.subject === 'A morning letter').length, 3, 'three automatic letters go'); assert.ok(res[3].skipped && res[3].ceiling, 'the fourth is skipped at the ceiling');
  assert.ok(mail.state.auto.ceiling && mail.state.auto.skipped >= 1, 'and the state says so');
  L0 = log.length; let r = await post('/signin/code', { email: 'real@example.com' }, '10.4.0.1', true); assert.strictEqual(r.status, 200);
  assert.ok(app.locals.lastCode && app.locals.lastCode.email === 'real@example.com', 'a code is made');
  assert.ok(log.slice(L0).some(l => String(l.to) === 'real@example.com' && /is your Watermark code/.test(l.subject)), 'and the sign-in code is sent past the ceiling');
  // A sign-up past the ceiling still opens the museum; only the automatic welcome waits.
  L0 = log.length; { const t = await tokOf(); r = await post('/record', { name: 'Late Person', email: 'late@example.com', adult: '1', t }, '10.5.0.1'); assert.ok(/welcome=own/.test(r.headers.get('location'))); }
  assert.ok(db.prepare("SELECT 1 FROM makers WHERE email='late@example.com'").get() && welcomes(L0) === 0, 'opened; the welcome waits for tomorrow');
  console.log('  MAIL_DAY_MAX=3: three automatic letters, the fourth skipped, the sign-in code sent');

  // (e) The morning digest says the ceiling was reached.
  const text = app.locals.digest.compose();
  assert.ok(/letters the house sent by itself: 3 today/.test(text) && /THE CEILING OF 3 WAS REACHED/.test(text), 'the digest says so:\n' + text.split('\n').filter(l => /letters the house/.test(l)).join('\n'));
  delete process.env.MAIL_DAY_MAX;

  console.log('signups: a burst sends no mail to strangers'); srv.close();
  fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
