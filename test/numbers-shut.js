// The numbers on the website (20 Nov: opening the desk twice stopped the house; #114). On ROLE=web the desk, its json
// door, its refresh, the digest's three doors and the agents' desk read the worker's kept answer in one statement and
// say when it was made; with no fresh kept answer they say so in words. No statement over hits, fixity, conditions,
// stood or the register runs on the website for these doors (counted on SQLite, statement by statement). The rollups
// agree with the hits they roll up, and fixity's one-pass summary with the old subquery. NUMBERS_DESK overrides both ways.
// Run: NODE_ENV=test node test/numbers-shut.js   (with DATABASE_URL, the same on Postgres, less the statement count)
process.env.DESK_KEY = 'desk-test-key';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createApp } = require('../src/app.js');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ns-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'ns', noTimers: true, vaultNow: true });
  const { db } = app.locals; const pg = db.kind === 'postgres';
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie()) jar[c.split('=')[0]] = c.split('=')[1].split(';')[0]; return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });

  // Every statement the house runs, by its text (SQLite: better-sqlite3's prototype, as the scale gate counts).
  const ran = []; let counting = false;
  if (!pg) { const P = Object.getPrototypeOf(db.prepare('SELECT 1')); for (const m of ['get', 'all', 'run', 'iterate']) { const f = P[m]; P[m] = function (...a) { if (counting) ran.push(this.source); return f.apply(this, a); }; } }
  const audit = async (label, fn) => { ran.length = 0; counting = true; try { return await fn(); } finally { counting = false; } };
  // hits, fixity, conditions, stood: never; the register and works: never whole (a head read with a LIMIT, a row by key, is not a walk)
  const FORBIDDEN = s => /\b(FROM|JOIN)\s+(hits|hits_days|hits_vd|fixity|conditions|stood)\b/i.test(s) || (/\b(FROM|JOIN)\s+(ledger|works)\b/i.test(s) && !/\bLIMIT\b/i.test(s) && !/\bWHERE\b[^]*\b(id|seq|slug)\s*=\s*\?/i.test(s));
  const clean = label => { if (pg) return; const bad = ran.filter(s => FORBIDDEN(s)); assert.deepStrictEqual(bad, [], `${label}: no statement over hits, fixity, conditions, stood or the register on the website`); };
  const keptReads = () => ran.filter(s => /FROM kept_numbers/.test(s)).length;

  // Hits over three days, and fixity checks, to hold the rollups and the summary to the raw tables.
  const now = Math.floor(Date.now() / 1000), today = Math.floor(now / 86400) * 86400;
  const ins = db.prepare('INSERT INTO hits (at, path, kind, status, ms, visitor, ref, device, browser, bot, country, bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  db.transaction(() => { for (let d = 0; d < 3; d++) for (let i = 0; i < 40; i++) { const at = Math.min(now - 5, today - d * 86400 + 60 + i * 60); ins.run(at, i % 3 ? '/w/a-work' : '/wander', i % 7 === 0 ? 'api' : 'page', i % 11 === 0 ? 500 : i % 13 === 0 ? 404 : 200, 20 + i, 'v' + (i % 9), i % 4 ? null : 'example.org', i % 2 ? 'phone' : 'computer', 'Safari', i % 17 === 0 ? 1 : 0, i % 5 ? 'US' : null, 100); } })();
  const raw = (from) => db.prepare("SELECT COUNT(*) views, COUNT(DISTINCT visitor) visitors FROM hits WHERE kind='page' AND bot=0 AND status<400 AND at>=?").get(from);
  { delete process.env.ROLE; const A = app.locals.analytics; const R = A.report('today'), R7 = A.report('7d');
    const t = raw(today), s7 = raw(today - 6 * 86400);
    assert.strictEqual(R.cur.views, Number(t.views), 'today: views from the rollup = the hits'); assert.strictEqual(R.cur.visitors, Number(t.visitors), 'today: visitors exact');
    assert.strictEqual(R7.cur.views, Number(s7.views), 'seven days: views'); assert.strictEqual(R7.cur.visitors, Number(s7.visitors), 'seven days: visitors exact across days');
    const dev = db.prepare("SELECT device k, COUNT(DISTINCT visitor) n FROM hits WHERE kind='page' AND bot=0 AND at>=? GROUP BY device ORDER BY device").all(today);
    assert.deepStrictEqual(R.devices.map(r => [r.k, r.n]).sort(), dev.map(r => [r.k, Number(r.n)]).sort(), 'today: devices');
    const e5 = db.prepare('SELECT COUNT(*) n FROM hits WHERE status>=500 AND at>=?').get(today).n; assert.strictEqual(R.cur.errors, Number(e5), 'today: server errors');
    assert.strictEqual(R7.byDay.length, 3, 'three days in the seven'); assert.ok(R.works.length && R.works[0].path === '/w/a-work', 'works most seen'); }
  { const w = db.prepare('SELECT id FROM works LIMIT 1').get(); const wid = w ? w.id : 1;
    const f = db.prepare('INSERT INTO fixity (work_id, ok, sha256) VALUES (?,?,?)');
    f.run(wid, 1, 'a'); f.run(wid, 0, 'b'); f.run(wid + 1000, 0, 'c'); f.run(wid + 1000, 1, 'd'); f.run(wid + 2000, 0, 'e');
    const old = db.prepare('SELECT COUNT(*) n FROM (SELECT work_id, ok FROM fixity f WHERE id=(SELECT MAX(id) FROM fixity WHERE work_id=f.work_id)) x WHERE ok=0').get().n;
    const S = app.locals.archive.summary(); assert.strictEqual(S.failing, Number(old), 'fixity: the one-pass summary agrees with the old'); assert.strictEqual(S.failing, 2, 'two works failing at their latest check'); assert.strictEqual(S.checked, 3, 'three checked'); }

  // The switch shuts it anywhere.
  process.env.NUMBERS_DESK = '0';
  let r = await go('/studio/analytics'); let t = await r.text();
  assert.strictEqual(r.status, 200, 'the desk answers'); assert.ok(/no recent set to show/.test(t) && /Back to the Studio/.test(t), 'in words, with a way back'); assert.ok(!/an-bars|their browsers answering/.test(t), 'and shows no figures');
  delete process.env.NUMBERS_DESK;

  // The website, before the worker has made anything: closed, in words, and nothing over the hits asked.
  process.env.ROLE = 'web';
  db.prepare('DELETE FROM kept_numbers').run();
  await audit('closed', async () => {
    r = await go('/studio/analytics'); t = await r.text(); assert.ok(r.status === 200 && /no recent set to show/.test(t), 'the website with no kept report: closed in words');
    r = await go('/studio/analytics.json'); assert.strictEqual((await r.json()).closed, true, 'the json door says closed');
    r = await go('/studio/analytics?frag=1'); assert.strictEqual((await r.json()).closed, true, 'so does the page\'s own refresh');
    r = await go('/studio/digest'); assert.ok(/no recent set/.test(await r.text()), 'the digest too');
    r = await go('/studio/digest/send', { method: 'POST' }); assert.strictEqual(r.status, 302, 'sending it goes back to the Studio'); assert.ok(/waits for the numbers/.test(decodeURIComponent(r.headers.get('location'))), 'with the reason');
    r = await go('/api/desk?key=desk-test-key'); assert.strictEqual(r.status, 503); assert.ok(/no recent set/.test((await r.json()).why), 'the agents\' desk says so in words');
  });
  clean('closed');

  // The worker's round (as ROLE=worker runs it on its clock), then the website reads it.
  delete process.env.ROLE; const made = app.locals.numbers.makeAll(); process.env.ROLE = 'web';
  assert.deepStrictEqual(made.failed, [], 'the worker made every answer: ' + made.failed.join(', '));
  for (const k of ['health', 'report:today', 'report:7d', 'report:30d', 'desk', 'owner']) assert.ok(app.locals.numbers.read(k), 'kept: ' + k);
  await audit('desk', async () => { r = await go('/studio/analytics'); t = await r.text(); });
  assert.ok(r.status === 200 && /their browsers answering/.test(t) && /as of \d/.test(t) && /back room/.test(t), 'the desk opens on the kept report and says when it was made');
  clean('the desk'); if (!pg) assert.strictEqual(keptReads(), 1, 'the desk read the kept answer in one statement');
  await audit('json', async () => { r = await go('/studio/analytics.json?span=7d'); t = await r.json(); });
  assert.ok(t.span === '7d' && t.made && t.cur && t.cur.views > 0, 'the json door: the kept 7 days, with when'); clean('the json'); if (!pg) assert.strictEqual(keptReads(), 1, 'one statement');
  await audit('refresh', async () => { r = await go('/studio/analytics?span=30d&frag=1'); t = await r.text(); }); assert.ok(/The numbers/.test(t), 'the refresh'); clean('the refresh');
  await audit('digest', async () => { r = await go('/studio/digest'); t = await r.text(); }); assert.ok(/THE WEEK/.test(t) && /THE KEEPING/.test(t), 'the digest composes from the kept report'); clean('the digest');
  await audit('send', async () => { r = await go('/studio/digest/send', { method: 'POST' }); }); assert.ok(/went to the house/.test(decodeURIComponent(r.headers.get('location'))), 'and goes'); clean('the digest sent');
  await audit('alarm', async () => { r = await go('/studio/digest/alarm', { method: 'POST' }); }); assert.ok(/The alarm went/.test(decodeURIComponent(r.headers.get('location'))), 'the alarm'); clean('the alarm');
  await audit('api', async () => { r = await go('/api/desk?key=desk-test-key'); t = await r.json(); }); assert.ok(r.status === 200 && t.made && t.sales, 'the agents\' desk: the kept summary, with when'); clean('/api/desk'); if (!pg) assert.strictEqual(keptReads(), 1, 'one statement');
  await audit('owner', async () => { r = await go('/api/desk/owner?key=desk-test-key'); t = await r.json(); }); assert.ok(r.status === 200 && t.made && t.live && t.live.role === 'web', 'the owner\'s view, the website\'s own live line laid over'); clean('/api/desk/owner');

  // Stale: a kept report older than the freshness line is not shown as current.
  db.prepare('UPDATE kept_numbers SET at=?').run(Date.now() - app.locals.numbers.FRESH - 1000);
  r = await go('/studio/analytics'); assert.ok(/no recent set to show/.test(await r.text()), 'a stale report: closed again');
  // The switch opens it on the website anyway, made in process (the house with no worker).
  process.env.NUMBERS_DESK = '1';
  r = await go('/studio/analytics'); t = await r.text(); assert.ok(r.status === 200 && /their browsers answering/.test(t), 'NUMBERS_DESK=1 opens the desk');
  delete process.env.NUMBERS_DESK; delete process.env.ROLE; delete process.env.DESK_KEY;
  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`the numbers on the website, kept and read (${pg ? 'Postgres' : 'SQLite, every statement counted'}): all hold`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
