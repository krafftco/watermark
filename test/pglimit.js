// The website's limits on Postgres (#115; 18 and 20 Nov: ten slow statements in a row on the one thread stopped the
// house). On ROLE=web a statement over DB_LIMIT_MS is stopped by the database itself, a run of statements past DB_HOLD_MS
// without the event loop turning is refused, the page says so in words, the fault is logged with the statement, and the
// next question and the front page are answered. Without DATABASE_URL only the watchdog's arithmetic is checked.
// Run: NODE_ENV=test DATABASE_URL=postgres://… node test/pglimit.js
process.env.ROLE = 'web'; process.env.DB_LIMIT_MS = '1000'; process.env.DB_HOLD_MS = '2500'; process.env.DB_LIMIT_MAX_MS = '5000'; process.env.DB_LIMIT_GRACE_MS = '2000'; process.env.ADB_LIMIT_MS = '1000';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const W = require('../src/watchdog');

// The watchdog's patience against the bridge's longest hold, at the house's defaults: a 4 s statement, an 8 s hold,
// a 20 s long write and 4 s of grace (32 s at worst) misses at most two answers of three; the old 20 s wait one.
{ const P = W.patience({ holdMs: 8000 + 20000 + 4000 }); assert.ok(P.ok && P.worst === 2, 'the longest hold never looks like three missed answers: ' + JSON.stringify(P));
  assert.strictEqual(W.missesFor(4000 + 4000, 15000, 8000), 1, 'one statement at the limit, at most one miss');
  assert.ok(!W.patience({ holdMs: 40000 }).ok, 'a 40 s hold would: the check sees it'); }

if (!process.env.DATABASE_URL) { console.log('the limits: the watchdog\'s arithmetic holds; no DATABASE_URL, so the Postgres half did not run'); process.exit(0); }

const { createApp } = require('../src/app.js');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-pglimit-'));
  const said = []; const err0 = console.error; console.error = (...a) => { said.push(a.join(' ')); err0(...a); };
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'pgl', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  assert.strictEqual(db.kind, 'postgres', 'on Postgres'); assert.ok(db.limits().on, 'the limits are on for the website');
  assert.strictEqual(db.prepare('SHOW statement_timeout').pluck().get(), '1s', 'and the database holds the limit itself');
  // A test door that asks what the caller says, set first in the router so nothing else answers it.
  app.get('/__slow/:s', (req, res) => { const n = db.prepare(`SELECT pg_sleep(${+req.params.s}) AS s, 1 AS n`).get(); res.send('answered ' + n.n); });
  app.get('/__aslow', async (req, res) => { const n = await app.locals.adb.get('SELECT pg_sleep(3) AS s, 1 AS n'); res.send('answered ' + n.n); }); // (#149) the async path's limit
  app.get('/__many', (req, res) => { for (let i = 0; i < 6; i++) db.prepare('SELECT pg_sleep(0.8) AS s').get(); res.send('all six'); });
  const stack = app.router.stack; stack.unshift(stack.pop()); stack.unshift(stack.pop()); stack.unshift(stack.pop());
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (p, h = {}) => fetch(base + p, { redirect: 'manual', headers: { accept: 'text/html', ...h } });

  let r = await go('/'); assert.strictEqual(r.status, 200, 'the front page, before');
  r = await go('/__slow/0.1'); assert.strictEqual(await r.text(), 'answered 1', 'a question under the limit is answered');

  // One statement past the limit: stopped by the database at about a second, never the old twenty.
  let t0 = Date.now(), e = null;
  try { db.prepare('SELECT pg_sleep(3) AS s').get(); } catch (x) { e = x; }
  const ms = Date.now() - t0;
  assert.ok(e && e.limit && e.status === 503, 'over the limit: an error the house knows (' + (e && e.message) + ')');
  assert.ok(ms < 2500, `stopped at the limit, not after it (${ms} ms)`);
  assert.ok(said.some(l => /^\[pg limit\] over the limit of 1000 ms/.test(l) && /pg_sleep\(3\)/.test(l)), 'logged [pg limit] with the statement');
  await new Promise(r => setTimeout(r, 50));
  const left = db.prepare("SELECT COUNT(*) n FROM pg_stat_activity WHERE state='active' AND query LIKE '%pg_sleep(3)%' AND pid <> pg_backend_pid()").get().n;
  assert.strictEqual(left, 0, 'and the database is no longer working on it');
  assert.strictEqual(db.prepare('SELECT 1 AS n').get().n, 1, 'the next question is answered');

  // Inside a transaction: rolled back, and the connection is clean after.
  e = null; try { db.transaction(() => { db.prepare("INSERT INTO settings (k, v) VALUES ('pglimit', 'x')").run(); db.prepare('SELECT pg_sleep(3) AS s').get(); })(); } catch (x) { e = x; }
  assert.ok(e && e.limit, 'over the limit inside a transaction');
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM settings WHERE k='pglimit'").get().n, 0, 'which was rolled back');
  assert.strictEqual(db.prepare('SELECT 2 AS n').get().n, 2, 'and the connection answers');

  // A named long write asks for more, and the limit comes back after it.
  await new Promise(r => setImmediate(r));
  assert.strictEqual(db.longer(4000, () => db.prepare('SELECT pg_sleep(1.5) AS s, 3 AS n').get().n), 3, 'longer() gives a named write more time');
  await new Promise(r => setImmediate(r));
  e = null; try { db.prepare('SELECT pg_sleep(1.5) AS s').get(); } catch (x) { e = x; } assert.ok(e && e.limit, 'and the limit is back after it');
  assert.strictEqual(db.prepare('SHOW statement_timeout').pluck().get(), '1s', 'on the database too');

  // A page: the house's own words, not a bare status; then the next visitor and the front page are answered.
  r = await go('/__slow/3'); let t = await r.text();
  assert.strictEqual(r.status, 503, 'the page that ran over'); assert.ok(/took too long, so it was stopped/.test(t) && /<html/i.test(t), 'says so in the house\'s words');
  { const F = app.locals.lastFault; assert.ok(F && F.kind === 'limit' && F.room === '/__slow/:s' && /pg_sleep\(3\)/.test(F.sql || ''), 'the fault kept with its room and statement (#149): ' + JSON.stringify(F)); }
  r = await go('/__slow/3', { accept: 'application/json' }); assert.ok(/took too long/.test((await r.json()).why), 'and in words to a script');
  r = await go('/'); assert.strictEqual(r.status, 200, 'the front page loads after it');

  // (#149) The async path over its limit: the same house page, and the fault kept with its statement.
  r = await go('/__aslow'); t = await r.text();
  assert.strictEqual(r.status, 503, 'the async path over its limit'); assert.ok(/took too long/.test(t) && /<html/i.test(t), 'in the house\'s words');
  { const F = app.locals.lastFault; assert.ok(F && F.kind === 'limit' && F.room === '/__aslow' && /pg_sleep\(3\)/.test(F.sql || '') && F.instance, 'kept with its statement and its copy: ' + JSON.stringify(F)); }
  { let ae = null; try { await app.locals.adb.get('SELECT pg_sleep(3) AS s'); } catch (x) { ae = x; } assert.ok(ae && ae.limit === true && ae.status === 503 && /pg_sleep\(3\)/.test(ae.sql), 'adb\'s own error says limit, 503 and the statement'); }
  // The hold: six statements of 0.8 s each are each under the limit, but past 2.5 s the next is not asked.
  t0 = Date.now(); r = await go('/__many'); t = await r.text(); const held = Date.now() - t0;
  assert.strictEqual(r.status, 503, 'a run of statements past the hold is stopped'); assert.ok(/took too long/.test(t), 'in words');
  assert.ok(held < 2500 + 1000 + 2000, `the thread was held about the hold and one statement (${held} ms)`);
  assert.ok(said.some(l => /^\[pg limit\] the thread held \d+ ms without a turn/.test(l)), 'logged');
  r = await go('/'); assert.strictEqual(r.status, 200, 'and the front page loads after it');
  r = await go('/__slow/0.1'); assert.strictEqual(await r.text(), 'answered 1', 'a new request starts its own hold');

  console.error = err0; srv.close(); try { db.close(); } catch (x) {} fs.rmSync(dir, { recursive: true, force: true });
  console.log('the website\'s limits on Postgres: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
