// The visit log by month (#119). SQLite: the batched prune keeps exactly the keep-days. Postgres (DATABASE_URL, a fresh
// schema): the one table moved into months by the worker's rounds while another process writes hits the whole time,
// a round interrupted and taken up by a fresh instance (a restart), a row the old table takes after the switch, then
// the prune 40 days on: whole months dropped, nothing older than the cut left, nothing inside it lost, the rollups intact.
//   NODE_ENV=test node test/hitslog.js                       (SQLite)
//   DATABASE_URL=postgres://… NODE_ENV=test node test/hitslog.js   (Postgres; the CI postgres job)
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { createApp } = require('../src/app');
const { mountHitsLog } = require('../src/hitslog');

const DAY = 86400;
const T = Math.floor(Date.UTC(2026, 10, 20, 12) / 1000); // a fixed "now": 20 Nov 2026, noon UTC
const quiet = [];
const log = s => { quiet.push(s); if (process.env.VERBOSE) console.log(s); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-hitslog-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', noTimers: true, vaultNow: true });
  const { db } = app.locals; const pg = db.kind === 'postgres';
  const count = (w = '1=1', ...a) => Number(db.prepare(`SELECT COUNT(*) AS n FROM hits WHERE ${w}`).get(...a).n);
  // 75 days of hits, oldest first (ids rise with time, as on live), 1,600 a day: 120,000 rows.
  const PER = 1600, DAYS = 75, N = PER * DAYS;
  const fill = () => {
    if (pg) db.exec(`INSERT INTO hits (at, path, kind, status, ms, visitor, bot) SELECT ${T - DAYS * DAY} + (g::bigint * ${DAYS * DAY} / ${N}), CASE WHEN g % 3 = 0 THEN '/w/a' ELSE '/' END, 'page', 200, 20, 'v' || (g % 500), CASE WHEN g % 5 = 0 THEN 1 ELSE 0 END FROM generate_series(1, ${N}) g`);
    else db.prepare(`WITH RECURSIVE s(g) AS (SELECT 1 UNION ALL SELECT g+1 FROM s WHERE g < ?) INSERT INTO hits (at, path, kind, status, ms, visitor, bot) SELECT ? - ? + (g * ? / ?), CASE WHEN g % 3 = 0 THEN '/w/a' ELSE '/' END, 'page', 200, 20, 'v' || (g % 500), CASE WHEN g % 5 = 0 THEN 1 ELSE 0 END FROM s`).run(N, T, DAYS * DAY, DAYS * DAY, N);
  };
  fill();
  const cut = T - 30 * DAY;
  const inside = count('at >= ?', cut);
  assert.ok(inside > 40000 && inside < 50000, 'inside the keep-days: ' + inside);

  if (!pg) {
    const H = mountHitsLog(db, { keepDays: 30, now: () => T, log });
    const r = H.prune();
    assert.strictEqual(count('at < ?', cut), 0, 'nothing older than the cut is left');
    assert.strictEqual(count(), inside, 'nothing inside the keep-days is lost');
    assert.strictEqual(r.deleted, N - inside);
    assert.deepStrictEqual(H.shape(), { kind: 'table' });
    assert.deepStrictEqual(await H.step(), { done: true, why: 'sqlite' });
    console.log(`hitslog (sqlite): ok — ${r.deleted.toLocaleString('en-US')} rows older than 30 days deleted, ${inside.toLocaleString('en-US')} kept`);
    fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
  }

  // ---- Postgres
  const relkind = () => (db.prepare("SELECT relkind AS k FROM pg_class WHERE relname='hits' AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=current_schema())").get() || {}).k;
  assert.strictEqual(relkind(), 'r', 'the house makes the one table');
  // The rollups of every day before the move, to show the prune leaves them.
  app.locals.analytics.rollup.roll(T);
  const daysBefore = Number(db.prepare("SELECT COUNT(*) AS n FROM hits_days WHERE dim='page'").get().n);
  assert.ok(daysBefore >= 8, 'the rollup made its days');

  // Another process writes a hit every 15 ms throughout (the website), each at "now", each with a mark to find it by.
  const writer = spawn(process.execPath, ['-e', `
    const { Client } = require('pg'); const c = new Client({ connectionString: process.env.DATABASE_URL }); let n = 0, stop = false;
    process.on('message', () => { stop = true; });
    c.connect().then(async () => { await c.query("SET lock_timeout = '4s'"); while (!stop) { try { await c.query("INSERT INTO hits (at, path, kind, status, ms, visitor, bot) VALUES ($1, '/written', 'page', 200, 1, $2, 0)", [${T}, 'w' + n]); n++; } catch (e) { console.error('writer', e.message); } await new Promise(r => setTimeout(r, 15)); } await c.end(); process.send(n); });
  `], { cwd: path.join(__dirname, '..'), env: process.env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const wrote = new Promise(r => writer.on('message', r));
  const pause = ms => new Promise(r => setTimeout(r, ms));
  await pause(400);

  // Round 1: one statement of copying, then a "restart" (a fresh instance takes it up from what hits_new holds).
  let H = mountHitsLog(db, { keepDays: 30, now: () => T, log });
  let r = await H.step({ batches: 1, yieldFn: () => pause(30) });
  assert.strictEqual(r.done, false); assert.ok(!r.switched, 'one batch does not reach the switch');
  const half = Number(db.prepare('SELECT COUNT(*) AS n FROM hits_new').get().n);
  assert.ok(half > 0 && half < inside, 'part copied: ' + half);
  H = mountHitsLog(db, { keepDays: 30, now: () => T, log });
  for (let i = 0; i < 20 && !r.switched; i++) r = await H.step({ batches: 2, yieldFn: () => pause(30) });
  assert.ok(r.switched, 'the switch came');
  assert.strictEqual(relkind(), 'p', 'hits is by month');
  await pause(300); // the writer goes on into the new table

  // A row the old table takes after the switch (a write that had resolved the old table before it was renamed).
  const last = Number(db.prepare("SELECT v FROM settings WHERE k='hits_switch'").get().v);
  db.prepare("INSERT INTO hits_old (id, at, path, kind, status, ms, visitor, bot) VALUES (?, ?, '/stray', 'page', 200, 1, 'stray', 0)").run(last + 7, T);
  writer.send('stop'); const n = await wrote;
  r = await H.step();
  assert.ok(r.done, 'the finish: ' + JSON.stringify(r));
  assert.strictEqual(r.strays, 1, 'the stray copied over');
  assert.ok(!db.prepare("SELECT 1 FROM pg_class WHERE relname='hits_old'").get(), 'hits_old dropped');
  assert.strictEqual(db.prepare("SELECT v FROM settings WHERE k='hits_switch'").get().v, 'done');
  // Nothing inside the keep-days lost: every row of before, every hit the writer wrote, the stray.
  assert.strictEqual(count("at >= ? AND path NOT IN ('/written', '/stray')", cut), inside, 'the rows of before, all there');
  assert.strictEqual(count("path = '/written'"), n, `every hit the other process wrote (${n})`);
  assert.strictEqual(count("path = '/stray'"), 1);
  assert.strictEqual(count('at < ?', cut), 0, 'nothing older than the cut was copied');
  // A write now gets an id past the gap, through the bridge, as the website writes.
  const id = Number(db.prepare("INSERT INTO hits (at, path, kind, status, ms, bot) VALUES (?, '/after', 'page', 200, 1, 0)").run(T).lastInsertRowid);
  assert.ok(id > last + 1000000, 'a new id past the gap: ' + id);
  assert.deepStrictEqual((await H.step()), { done: true });
  const shape = H.shape();
  assert.strictEqual(shape.kind, 'months'); assert.ok(shape.months.includes('hits_p202611') && shape.months.includes('hits_p202610'), shape.months.join(','));

  // The prune, 40 days on (30 Dec; the cut 30 Nov): October lies wholly before the cut and goes whole.
  const later = T + 40 * DAY, cut2 = later - 30 * DAY;
  const keep2 = count('at >= ?', cut2);
  const H2 = mountHitsLog(db, { keepDays: 30, now: () => later, log });
  const p = H2.prune();
  assert.ok(p.dropped.includes('hits_p202610'), 'October dropped whole: ' + p.dropped.join(','));
  assert.strictEqual(count('at < ?', cut2), 0, 'nothing older than the cut');
  assert.strictEqual(count(), keep2, 'nothing inside it lost');
  assert.ok(!db.prepare("SELECT 1 FROM pg_class WHERE relname='hits_p202610'").get(), 'its table is gone');
  assert.ok(H2.shape().months.includes('hits_p202702'), 'the months ahead made: ' + H2.shape().months.join(','));
  const daysAfter = Number(db.prepare("SELECT COUNT(*) AS n FROM hits_days WHERE dim='page'").get().n);
  assert.strictEqual(daysAfter, daysBefore, 'the rollups intact');
  console.log(`hitslog (postgres): ok — ${inside.toLocaleString('en-US')} rows inside the keep-days moved into months over rounds and a restart while another process wrote ${n} hits; the stray copied; months dropped 40 days on: ${p.dropped.join(', ')}; rollups intact (${daysAfter} days)`);
  try { db.close(); } catch (e) { /* */ }
  fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})().catch(e => { console.error(e); console.error(quiet.slice(-12).join('\n')); process.exit(1); });
