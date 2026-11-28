// Many hands (#117, docs/SCALE.md "Stage 2: how a room is moved"): the async path (src/adb.js) beside the bridge.
// Runs on SQLite (npm test) and on Postgres (DATABASE_URL, CI's postgres job). What it holds:
//   1. the same rows as the bridge for real statements of the moved rooms, parameters every way the house passes them;
//   2. inside the bridge's transaction, adb sees what the transaction wrote;
//   3. the slow log; on Postgres, the limit ends a slow statement and the next one is answered on the same pool;
//   4. it closes cleanly: a process that used it exits by itself;
//   5. the moved rooms answer, and on Postgres, with a two-second statement running on the pool, they answer at once;
//      with the same statement on the bridge they wait for it (the fact the design rests on: docs/SCALE.md).
// SQLite cannot run a statement aside from its thread: there the stand-in for pg_sleep (a recursive count of about
// a second and a half) holds everything on both paths; the rooms' answers are checked and the timings printed, not judged.
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawn, spawnSync } = require('child_process');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const PG = !!process.env.DATABASE_URL;
const SLEEP = PG ? 'SELECT pg_sleep(2) AS z' : 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 15000000) SELECT COUNT(*) AS z FROM c';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-manyhands-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'mh', noTimers: true, vaultNow: true });
  const { db, adb } = app.locals;
  assert.ok(adb && typeof adb.get === 'function', 'app.locals.adb is mounted');
  assert.strictEqual(adb.kind, PG ? 'postgres' : 'sqlite');
  const m = db.prepare('SELECT * FROM makers ORDER BY id LIMIT 1').get();
  const buf = await sharp(path.join(__dirname, 'fixture.jpg')).resize(900).jpeg().toBuffer();
  const ws = [];
  for (let i = 0; i < 9; i++) {
    const f = path.join(dir, `w${i}.jpg`); fs.writeFileSync(f, await sharp(buf).modulate({ brightness: 1 + i / 40 }).jpeg().toBuffer());
    const w = await app.locals.registerWork({ file: f, title: `Harbour ${i}`, place: i % 2 ? 'Lisbon' : 'Kyoto', makerId: m.id, originalName: `w${i}.jpg` });
    db.prepare("UPDATE works SET status='held', stars=?, taken_at='1987-06-01 10:00:00' WHERE id=?").run(i % 6, w.id); ws.push(w);
  }

  // 1. The same rows as the bridge.
  const same = [
    ['SELECT * FROM works WHERE slug=?', 'get', [ws[0].slug]],
    ["SELECT w.*, m.name AS maker_name, m.handle AS maker_handle, m.portrait AS maker_portrait, m.kind AS maker_kind FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.slug=? AND w.status='held'", 'get', [ws[1].slug]],
    ["SELECT w.id, w.slug, w.curated, w.stars FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.maker_id=? ORDER BY w.curated DESC, w.stars DESC, w.id DESC LIMIT 4000", 'all', [m.id]],
    ["SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'", 'get', [m.id]],
    ["SELECT slug, title FROM works WHERE status='held' AND COALESCE(zone,'all')!='mature' AND place=? ORDER BY curated DESC, stars DESC, id DESC LIMIT 9", 'all', ['Kyoto']],
    ["SELECT COALESCE(SUM(price_cents),0) s, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0 AND l.starts_at >= date('now','start of month')", 'get', [m.id]],
    ['SELECT id, slug FROM works WHERE id IN (?,?,?) ORDER BY id', 'all', [[ws[0].id, ws[1].id, ws[2].id]]], // one array
    ['SELECT slug, title FROM works WHERE maker_id=@mk AND place=@p ORDER BY id LIMIT 5', 'all', [{ mk: m.id, p: 'Lisbon' }]], // named
    ["SELECT slug FROM works WHERE slug=? AND status='nothing'", 'get', [ws[0].slug]], // no row: undefined on both
    ["SELECT id FROM makers WHERE name LIKE ? LIMIT 60", 'all', ['%' + m.name.slice(0, 3) + '%']],
  ];
  for (const [sql, how, a] of same) {
    const bridge = db.prepare(sql)[how](...a); const asy = await adb[how](sql, ...a);
    assert.deepStrictEqual(asy, bridge, `same rows on both paths: ${sql.slice(0, 70)}`);
  }
  // A write on adb returns what the bridge's run returns.
  db.exec('CREATE TABLE IF NOT EXISTS mh_notes (id INTEGER PRIMARY KEY, body TEXT)');
  const r1 = db.prepare('INSERT INTO mh_notes (body) VALUES (?)').run('bridge'); const r2 = await adb.run('INSERT INTO mh_notes (body) VALUES (?)', 'async');
  assert.strictEqual(r2.changes, 1); assert.strictEqual(Number(r2.lastInsertRowid), Number(r1.lastInsertRowid) + 1, 'lastInsertRowid as the bridge gives it');
  await assert.rejects(adb.get('SELECT nothing_here FROM works LIMIT 1'), 'a bad statement rejects');
  console.log(`manyhands: ${same.length} statements, the same rows on both paths (${adb.kind})`);

  // 2. Inside the bridge's transaction adb sees what it wrote (it asks the bridge there).
  let seenIn = null; const txp = []; db.transaction(() => { db.prepare('INSERT INTO mh_notes (body) VALUES (?)').run('in tx'); txp.push(adb.get("SELECT COUNT(*) n FROM mh_notes WHERE body='in tx'")); })();
  seenIn = (await txp[0]).n; assert.strictEqual(seenIn, 1, 'a read inside the transaction sees its write');

  // 3. The slow log, and on Postgres the limit.
  process.env.ADB_SLOW_MS = '200';
  await adb.get(PG ? SLEEP.replace('pg_sleep(2)', 'pg_sleep(0.4)') : SLEEP);
  assert.ok(adb.slow().some(x => /pg_sleep|RECURSIVE/.test(x.sql)), 'a slow statement is logged and kept for /healthz');
  delete process.env.ADB_SLOW_MS;
  if (PG) {
    process.env.ADB_LIMIT_MS = '400'; const lim = require('../src/adb').open(db); delete process.env.ADB_LIMIT_MS;
    const t0 = Date.now(); let code = null; try { await lim.get('SELECT pg_sleep(3)'); } catch (e) { code = e.code; }
    const ended = Date.now() - t0;
    assert.strictEqual(code, '57014', 'the limit ends the statement (query_canceled)'); assert.ok(ended < 1500, `ended near the limit: ${ended} ms`);
    const after = await lim.get('SELECT 1 AS one'); assert.strictEqual(after.one, 1, 'the next statement is answered');
    const many = await Promise.all([1, 2, 3, 4, 5, 6].map(i => lim.get('SELECT ?::int AS i', i))); assert.deepStrictEqual(many.map(x => x.i), [1, 2, 3, 4, 5, 6], 'the pool is whole after it');
    await lim.close(); console.log(`manyhands: the limit ended a 3 s statement in ${ended} ms; the next was answered`);
  } else console.log('manyhands: no limit on SQLite (a statement cannot be ended from its own thread); the slow log holds');

  // 4. It closes cleanly: a process that opened it, asked and closed, exits by itself.
  const child = spawnSync(process.execPath, ['-e', `const db = require(${JSON.stringify(path.join(__dirname, '../src/db'))}).open(${JSON.stringify(path.join(dir, 'close.db'))}); const a = require(${JSON.stringify(path.join(__dirname, '../src/adb'))}).open(db); a.get('SELECT 1 AS one').then(r => { if (r.one !== 1) process.exit(3); return a.close(); }).then(() => { db.close(); console.log('closed'); });`], { env: process.env, timeout: 20000, encoding: 'utf8' });
  assert.ok(child.status === 0 && /closed/.test(child.stdout), `a process using adb exits by itself (status ${child.status}, ${child.signal || ''}): ${String(child.stderr).slice(-300)}`);
  console.log('manyhands: it closes cleanly');

  // 5. The moved rooms answer, and while a slow statement runs.
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const ROOMS = [`/w/${ws[0].slug}`, '/api/stroll?n=6&seen=', '/api/stroll?n=6&q=kyoto&seen=', `/api/stroll?n=6&maker=${encodeURIComponent(m.handle)}&seen=`, `/stroll/side/${ws[1].slug}`, '/wander', `/wander?in=${encodeURIComponent('maker:' + m.handle)}&at=${ws[2].slug}`];
  const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605', accept: 'text/html,application/json' };
  for (const p of ROOMS) { const r = await fetch(base + p, { headers: ua }); const t = await r.text(); assert.strictEqual(r.status, 200, `${p} answers: ${r.status} ${t.slice(0, 200)}`); }
  const st = await (await fetch(base + `/api/stroll?n=6&q=kyoto&seen=`)).json(); assert.ok(st.items.length && st.items.every(x => x.place === 'Kyoto' || x.kind), 'a word\'s wander holds to the word');
  const side = await (await fetch(base + `/stroll/side/${ws[1].slug}`)).json(); assert.ok(/whp-n/.test(side.who) && /wnx-door/.test(side.like), 'the sides carry who made it and where next');
  const page = await (await fetch(base + `/w/${ws[0].slug}`, { headers: ua })).text(); assert.ok(page.includes('Harbour 0'), 'the work\'s page');
  // The client in its own process (a client in this one would be frozen with the server and measure nothing).
  const measure = () => new Promise((resolve, reject) => {
    const code = `const rooms = ${JSON.stringify(ROOMS)}; const ua = ${JSON.stringify(ua)};
      const t = async p => { const t0 = Date.now(); const r = await fetch(${JSON.stringify(base)} + p, { headers: ua }); await r.text(); return [r.status, Date.now() - t0]; };
      (async () => { for (const p of rooms) await t(p); console.log('warm'); await new Promise(r => setTimeout(r, 400));
        const out = await Promise.all(rooms.map(t)); console.log(JSON.stringify(out)); })();`;
    const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] }); let s = '';
    c.stdout.on('data', d => { s += d; if (/warm\n/.test(s) && !c.started) { c.started = true; resolve({ c, done: new Promise(r => c.on('exit', () => r(JSON.parse(s.split('warm\n')[1])))) }); } });
    c.on('error', reject);
  });
  async function under(where) {
    const { done } = await measure();
    await new Promise(r => setTimeout(r, 100)); // the client asks 400 ms after 'warm'; the slow statement starts at 100 ms and runs about two seconds
    const t0 = Date.now(); let slowMs;
    if (where === 'bridge') { db.prepare(SLEEP).get(); slowMs = Date.now() - t0; } else { await adb.get(SLEEP); slowMs = Date.now() - t0; }
    const got = await done; return { slowMs, got };
  }
  const show = (label, { slowMs, got }) => console.log(`manyhands: ${label} (${slowMs} ms): ` + ROOMS.map((p, i) => `${p.split('?')[0]} ${got[i][0]} in ${got[i][1]} ms`).join('; '));
  const onPool = await under('pool'); show(`a slow statement on the async path`, onPool);
  const onBridge = await under('bridge'); show(`the same on the bridge`, onBridge);
  for (const r of [...onPool.got, ...onBridge.got]) assert.strictEqual(r[0], 200, 'every room answers');
  if (PG) {
    const worst = Math.max(...onPool.got.map(r => r[1]));
    assert.ok(worst < 1000, `with a 2 s statement on the async path, every moved room answers well inside it (worst ${worst} ms)`);
    const held = Math.min(...onBridge.got.map(r => r[1]));
    assert.ok(held > 900, `with it on the bridge, they wait for it (least ${held} ms): if this fails, the bridge no longer holds the thread and docs/SCALE.md stage 2 must be read again`);
  }
  srv.close(); await adb.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('manyhands: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
