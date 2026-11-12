'use strict';
// Sign-up bursts send no mail to strangers (#24, 12 Nov): form-filling bots posted the open door with other people's
// addresses and the house wrote to each. The door carries a signed form time (a post without one, or too quick or too
// old, is shown the form again); past RECORD_PER_HOUR museums an hour the museum still opens but the welcome is dropped;
// past RECORD_FLOOD_PER_HOUR the door says it is busy; and the letters the house sends by itself stop at MAIL_DAY_MAX a
// day, while sign-in codes always go. A person is never turned away for being quick, slow or in a crowd.
process.env.NODE_ENV = 'test';
for (const k of ['RECORD_MIN_MS', 'RECORD_PER_HOUR', 'RECORD_FLOOD_PER_HOUR', 'MAIL_DAY_MAX']) delete process.env[k];
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert'), crypto = require('crypto');
const { createApp } = require('../src/app');
const mail = require('../src/mail');
const wait = ms => new Promise(z => setTimeout(z, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sgn-'));
  const SECRET = 'sgn';
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: SECRET, noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const log = app.locals.mailLog;
  const enc = o => new URLSearchParams(o).toString();
  const post = (u, body, ip, json) => fetch(base + u, { method: 'POST', redirect: 'manual', headers: { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded', origin: base, 'x-forwarded-for': ip || '10.9.9.9' }, body: json ? JSON.stringify(body) : enc(body) });
  const tokIn = html => (String(html).match(/name="t" value="([^"]+)"/) || [])[1];
  const tokOf = async (door = '/join') => tokIn(await (await fetch(base + door)).text());
  const doorMade = () => Number(db.prepare("SELECT COUNT(*) n FROM makers WHERE door_at IS NOT NULL").get().n);
  const has = email => !!db.prepare('SELECT 1 FROM makers WHERE email=?').get(email);
  const welcomes = (since = 0) => log.slice(since).filter(l => l.subject === 'Your museum is open').length;
  const age = () => db.prepare("UPDATE makers SET joined_at=datetime('now','-3 hours'), door_at=datetime('now','-3 hours') WHERE door_at IS NOT NULL").run();
  const opened = r => /\/account\/upload\?welcome=own/.test(r.headers.get('location') || '') && r.headers.getSetCookie().some(c => /^wm_m=[^;]/.test(c));
  let r, L0;

  // Both doors carry the signed form time, and neither is kept by a cache.
  for (const door of ['/join', '/own']) { r = await fetch(base + door); assert.ok(/^\d+\.[0-9a-f]{32}$/.test(tokIn(await r.text()) || ''), door + ' carries a token'); assert.ok(/no-store/.test(r.headers.get('cache-control') || ''), door + ' is no-store'); }
  assert.ok(/\(join\$\|own\$\|/.test(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8')), 'the service worker never keeps /join or /own');

  // A person who presses at 1.2 s (the default minimum is 1 s): opened, one letter.
  L0 = log.length;
  { const t = await tokOf(); await wait(1200); r = await post('/record', { name: 'Quick Person', email: 'quick@example.com', adult: '1', t }, '10.3.0.1'); }
  assert.ok(opened(r) && has('quick@example.com'), 'a 1.2 s submit opens the museum'); assert.strictEqual(log.slice(L0).filter(l => l.to === 'quick@example.com').length, 1, 'and its one letter');
  console.log('  a press at 1.2 s: opened, one letter');

  // No token, a forged one, too old, too quick: the same form again as typed, with a fresh token and one line;
  // nothing made or mailed. The second press, once valid, opens the museum.
  const sig = ts => crypto.createHmac('sha256', SECRET).update(`record.${ts}`).digest('hex').slice(0, 32);
  const old = Date.now() - 3 * 3600000;
  const fakes = [['none', undefined], ['forged', `${Date.now() - 5000}.${'0'.repeat(32)}`], ['too old', `${old}.${sig(old)}`], ['too quick', 'fresh']];
  for (const [i, [why, t0]] of fakes.entries()) {
    L0 = log.length; const email = `again${i}@example.com`;
    const t = t0 === 'fresh' ? await tokOf() : t0;
    r = await post('/record', { name: `Again ${i}`, email, adult: '1', ...(t ? { t } : {}) }, `10.2.${i}.1`);
    assert.strictEqual(r.status, 200, why + ': the form again, not a redirect or a refusal'); assert.ok(/no-store/.test(r.headers.get('cache-control') || ''));
    const page = await r.text();
    assert.ok(/One more press, please\./.test(page) && page.includes(`value="Again ${i}"`) && page.includes(`value="${email}"`), why + ': as typed, with the line');
    assert.ok(!r.headers.getSetCookie().some(c => /^wm_m=[^;]/.test(c)) && !has(email) && log.length === L0, why + ': nothing made or mailed');
    const t2 = tokIn(page); assert.ok(t2 && t2 !== t, why + ': a fresh token');
    await wait(1050); r = await post('/record', { name: `Again ${i}`, email, adult: '1', t: t2 }, `10.2.${i}.1`);
    assert.ok(opened(r) && has(email) && welcomes(L0) === 1, why + ': the second press opens it');
  }
  console.log('  no token, forged, expired, too quick: the form again, the second press opens');
  process.env.RECORD_MIN_MS = '0'; // the bursts below post fresh forms at once
  // The honeypot alone gets the silent fake success.
  r = await post('/record', { name: 'Bot', email: 'pot@example.com', adult: '1', website: 'http://spam', t: await tokOf() }, '10.2.9.1');
  assert.ok(/welcome=own/.test(r.headers.get('location') || '') && !has('pot@example.com'), 'the honeypot: told nothing, given nothing');

  // Fifty sign-ups in a burst from fifty addresses: every museum opens (people are never refused), and only the hour's
  // forty get a welcome; the rest are dropped.
  age(); L0 = log.length;
  let res = await Promise.all(Array.from({ length: 50 }, async (_, i) => post('/record', { name: `Burst ${i}`, email: `victim${i}@example.com`, adult: '1', t: await tokOf() }, `10.0.${i}.1`)));
  assert.ok(res.every(opened), 'every one lands where everyone does');
  assert.strictEqual(Number(db.prepare("SELECT COUNT(*) n FROM makers WHERE door_at > datetime('now','-1 hour')").get().n), 50, 'fifty museums');
  assert.strictEqual(welcomes(L0), 40, 'forty welcome letters, no more');
  console.log(`  a burst of 50: 50 opened, ${welcomes(L0)} welcomes`);
  // With RECORD_PER_HOUR=5, five letters.
  age(); process.env.RECORD_PER_HOUR = '5'; L0 = log.length;
  res = await Promise.all(Array.from({ length: 50 }, async (_, i) => post('/record', { name: `Burst B${i}`, email: `b${i}@example.com`, adult: '1', t: await tokOf() }, `10.1.${i}.1`)));
  assert.ok(res.every(opened) && welcomes(L0) === 5, `RECORD_PER_HOUR=5: all opened, five letters (${welcomes(L0)})`);

  // Partner makers (src/platform.js inserts door 'record' with no door_at) do not count toward the hour.
  age(); for (let i = 0; i < 20; i++) db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES (?,?,?,'maker',datetime('now'),'record')").run(`partner-${i}`, `Partner ${i}`, `partner${i}@example.com`);
  L0 = log.length; r = await post('/record', { name: 'After Partners', email: 'afterp@example.com', adult: '1', t: await tokOf() }, '10.6.0.1');
  assert.ok(opened(r) && welcomes(L0) === 1, 'twenty partner makers this hour leave the door its five letters');
  delete process.env.RECORD_PER_HOUR; db.prepare("UPDATE makers SET joined_at=datetime('now','-30 days') WHERE handle LIKE 'partner-%'").run(); // out of their first week, so the mornings below are Late Person's

  // A flood: past RECORD_FLOOD_PER_HOUR the busy page, and nothing made.
  age(); process.env.RECORD_FLOOD_PER_HOUR = '10'; const n0 = doorMade(); L0 = log.length;
  res = await Promise.all(Array.from({ length: 20 }, async (_, i) => post('/record', { name: `Flood ${i}`, email: `flood${i}@example.com`, adult: '1', t: await tokOf() }, `10.7.${i}.1`)));
  const busy = res.filter(x => x.status === 429);
  assert.strictEqual(doorMade() - n0, 10, 'ten made'); assert.strictEqual(busy.length, 10, 'ten told the door is busy');
  for (const x of busy) assert.ok(/The door is busy; try again in a little while, or sign in if you have been here before/.test(await x.text()), 'a kind page with the way in');
  delete process.env.RECORD_FLOOD_PER_HOUR; age();
  console.log('  partner makers uncounted; a flood: ten made, ten told the door is busy');

  // The welcome goes at most once a day to an address, whatever asks again.
  L0 = log.length; for (let i = 0; i < 3; i++) await mail.send({ kind: 'auto', once: 'welcome:quick@example.com', to: 'quick@example.com', subject: 'Your museum is open', text: 'again' });
  assert.strictEqual(welcomes(L0), 0, 'the welcome is never sent twice in a day');

  // The day's ceiling on the house's own letters: three go, the fourth is dropped (not counted as sent); a sign-in code
  // still goes; the first-week mornings past the ceiling are not marked, so they wait for the next day.
  db.prepare("DELETE FROM settings WHERE k LIKE 'mail_auto_%'").run(); process.env.MAIL_DAY_MAX = '3'; L0 = log.length;
  const out = []; for (let i = 0; i < 4; i++) out.push(await mail.send({ kind: 'auto', to: `m${i}@example.com`, subject: 'A morning letter', text: 'x' }));
  assert.strictEqual(log.slice(L0).filter(l => l.subject === 'A morning letter').length, 3, 'three automatic letters go'); assert.ok(out[3].skipped && out[3].ceiling, 'the fourth is dropped at the ceiling');
  assert.ok(mail.state.auto.ceiling && mail.state.auto.skipped >= 1 && mail.autoFull(), 'and the state says so');
  L0 = log.length; r = await post('/record', { name: 'Late Person', email: 'late@example.com', adult: '1', t: await tokOf() }, '10.5.0.1');
  assert.ok(opened(r) && welcomes(L0) === 0, 'a museum opened past the ceiling: opened, its welcome dropped');
  // a proven maker in their first week, due a morning letter
  db.prepare("UPDATE makers SET email_ok=1, joined_at=datetime('now','-2 days') WHERE email='late@example.com'").run();
  if (app.locals.firstWeek && app.locals.firstWeek.mornings) {
    const id = db.prepare("SELECT id FROM makers WHERE email='late@example.com'").get().id;
    app.locals.firstWeek.mornings({ force: true }); await wait(50);
    assert.ok(!db.prepare('SELECT 1 FROM first_week WHERE maker_id=?').get(id), 'the morning letter is not marked sent: it waits');
    db.prepare("DELETE FROM settings WHERE k LIKE 'mail_auto_%'").run(); L0 = log.length;
    app.locals.firstWeek.mornings({ force: true }); await wait(50);
    assert.ok(db.prepare('SELECT 1 FROM first_week WHERE maker_id=?').get(id) && log.slice(L0).some(l => l.to === 'late@example.com'), 'and goes when there is room');
    for (let i = 0; i < 3; i++) await mail.send({ kind: 'auto', to: `n${i}@example.com`, subject: 'A morning letter', text: 'x' }); // full again
  }
  L0 = log.length; r = await post('/signin/code', { email: 'quick@example.com' }, '10.4.0.1', true); assert.strictEqual(r.status, 200);
  assert.ok(log.slice(L0).some(l => l.to === 'quick@example.com' && /is your Watermark code/.test(l.subject)), 'the sign-in code is sent past the ceiling');
  console.log('  MAIL_DAY_MAX=3: three automatic letters, the fourth dropped, the morning waits, the sign-in code sent');

  // The morning digest says the ceiling was reached.
  const text = app.locals.digest.compose();
  assert.ok(/letters the house sent by itself: 3 today/.test(text) && /THE CEILING OF 3 WAS REACHED/.test(text), 'the digest says so:\n' + text.split('\n').filter(l => /letters the house/.test(l)).join('\n'));
  delete process.env.MAIL_DAY_MAX; delete process.env.RECORD_MIN_MS;

  console.log('signups: a burst sends no mail to strangers, and no person is turned away'); srv.close();
  fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
