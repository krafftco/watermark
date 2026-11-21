'use strict';
// Several copies of the website, on this machine (#123, docs/SCALE.md "Stage 2: several copies"). Starts N website
// processes (server.js, ROLE=web, each its own folder) on one Postgres behind a small round-robin proxy, as Render's
// balancer puts N instances behind one address, and runs scripts/load.js through the proxy. With COPIES_HOLD=1 the
// first copy is held the way a slow statement holds it on live: every COPIES_HOLD_EVERY_MS (3000) its bridge asks
// `SELECT pg_sleep(COPIES_HOLD_S)` (2), so its one thread waits as on the night of 20 Nov (a preload, scripts/copies-hold.js;
// nothing in the house is changed for it). It prints, for each N, what a visitor felt.
//   DATABASE_URL=postgres://… node scripts/copies.js                 N = 1, 2, 3, each with the first copy held
//   COPIES_N=2 COPIES_HOLD=0 DATABASE_URL=… node scripts/copies.js   one run, nobody held
//   COPIES_BALANCE=least …                                          the balancer sends to the copy with least in hand
// It needs an empty database it may fill (it seeds COPIES_WORKS works, 30). The folders it makes are removed on the way
// out. The smoke suite is not run through it: the smoke builds its own house in its own process and cannot be pointed
// at a running one; test/instances.js walks a visitor's journey across two copies instead.
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const { spawn } = require('child_process');
if (!process.env.DATABASE_URL) { console.error('copies: DATABASE_URL (a Postgres it may fill) is needed: several copies share one database'); process.exit(2); }
const ROOT = path.join(__dirname, '..');
const NS = process.env.COPIES_N ? String(process.env.COPIES_N).split(',').map(Number) : [1, 2, 3];
const HOLD = process.env.COPIES_HOLD === undefined ? true : process.env.COPIES_HOLD === '1';
const WORKS = +process.env.COPIES_WORKS || 30;
const LEAST = process.env.COPIES_BALANCE === 'least';
const nap = ms => new Promise(r => setTimeout(r, ms));
const dirs = []; const kids = [];
const tidy = () => { for (const k of kids) { try { k.kill('SIGKILL'); } catch (e) { /* gone */ } } for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* */ } } };
process.on('exit', tidy); process.on('SIGINT', () => process.exit(130));
const freePort = () => new Promise(res => { const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

async function seed() {
  // In this process, as load.js seeds its house: the works, their originals in a vault folder every copy gets a copy of
  // (the stand-in for the bucket every instance reads on live).
  const sharp = require('sharp'); const { createApp } = require('../src/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-copies-seed-')); dirs.push(dir);
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', noTimers: true, vaultNow: true });
  const { registerWork, db } = app.locals; const sizes = [[1600, 1067], [2400, 1600], [3600, 2400]];
  if (Number(db.prepare("SELECT COUNT(*) n FROM works").get().n)) { console.error('copies: the database already holds works; give it an empty one (the originals are seeded with it)'); process.exit(2); }
  for (let i = 0; i < WORKS; i++) {
    const [w, h] = sizes[i % sizes.length]; const f = path.join(dir, `w${i}.jpg`);
    await sharp({ create: { width: w, height: h, channels: 3, noise: { type: 'gaussian', mean: 90 + (i * 7) % 90, sigma: 30 } } }).jpeg({ quality: 90 }).toFile(f);
    const wk = await registerWork({ file: f, originalName: `w${i}.jpg`, title: `Copies ${i}`, place: ['Paris', 'Florence', 'London'][i % 3] });
    db.prepare("UPDATE works SET status='held', stars=?, curated=? WHERE id=?").run(3 + (i % 3), i % 5 === 0 ? 1 : 0, wk.id);
  }
  return dir;
}

async function startCopy(seedDir, i, held) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wm-copies-${i}-`)); dirs.push(dir);
  fs.cpSync(path.join(seedDir, 'vault'), path.join(dir, 'vault'), { recursive: true });
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: 'production', ROLE: 'web', DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'pw', SESSION_SECRET: 's', BASE_URL: `http://127.0.0.1:${port}`, WATCHDOG: '0', NO_SEED: '1', RENDER_GIT_COMMIT: 'copies00', RENDER_INSTANCE_ID: `copy-${i}`, LOOP_LAG: '0' };
  if (held) { env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require ${path.join(__dirname, 'copies-hold.js')}`.trim(); env.COPIES_HOLD_ON = '1'; }
  const k = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); kids.push(k);
  k.tail = []; for (const s of [k.stdout, k.stderr]) s.on('data', d => { for (const l of String(d).split('\n')) if (l) { k.tail.push(l); if (k.tail.length > 40) k.tail.shift(); } });
  k.port = port; k.held = held; k.name = `copy-${i}${held ? ' (held)' : ''}`;
  return k;
}
async function up(k) { for (let i = 0; i < 240; i++) { try { if ((await fetch(`http://127.0.0.1:${k.port}/healthz`)).ok) return true; } catch (e) { /* not yet */ } if (k.exitCode !== null) break; await nap(500); } throw new Error(`${k.name} never answered:\n${k.tail.slice(-15).join('\n')}`); }

// The balancer: each new request to the next copy, in turn; it counts what each copy answered.
function proxy(copies) {
  let n = 0; const count = new Map(copies.map(c => [c.port, 0]));
  const srv = http.createServer((req, res) => {
    // round (the default): the next copy in turn. least (COPIES_BALANCE=least): the copy with the fewest requests in
    // hand, so a held copy, whose requests pile up, is passed over; which Render's balancer does is not known here.
    let c = copies[n++ % copies.length];
    if (LEAST) for (const x of copies) if ((x.open || 0) < (c.open || 0)) c = x;
    count.set(c.port, count.get(c.port) + 1); c.open = (c.open || 0) + 1; res.on('close', () => { c.open--; });
    const p = http.request({ host: '127.0.0.1', port: c.port, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${c.port}` } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(p);
  });
  srv.keepAliveTimeout = 65000;
  return new Promise(res => srv.listen(0, () => res({ srv, port: srv.address().port, count })));
}

function load(base) {
  const env = { ...process.env, LOAD_BASE: base, LOAD_S: process.env.LOAD_S || '20', LOAD_C: process.env.LOAD_C || '20', LOAD_WARM_S: process.env.LOAD_WARM_S || '4', LOAD_MIN_N: process.env.LOAD_MIN_N || '40', LOAD_P95_MS: process.env.LOAD_P95_MS || '100000' };
  // Not spawnSync: the proxy lives in this process and must keep answering while load.js runs.
  return new Promise(res => { const k = spawn(process.execPath, [path.join(__dirname, 'load.js')], { cwd: ROOT, env }); kids.push(k); let out = ''; k.stdout.on('data', d => { out += d; }); k.stderr.on('data', d => { out += d; }); k.on('exit', status => res({ status, out })); });
}

(async () => {
  const seedDir = await seed(); console.log(`copies: ${WORKS} works seeded`);
  const rows = [];
  for (const N of NS) {
    const t0 = Date.now();
    const copies = []; for (let i = 0; i < N; i++) copies.push(await startCopy(seedDir, i, HOLD && i === 0));
    await Promise.all(copies.map(up)); const boot = Date.now() - t0;
    const P = await proxy(copies);
    const L = await load(`http://127.0.0.1:${P.port}`);
    const lines = L.out.split('\n').filter(l => /^\s*(door|warm-up|wander|feed|work|thumb|screen|large|find|collection|api|look)\b|p95|p50|errors|load:/.test(l)).slice(0, 30);
    const doorLines = L.out.split('\n').filter(l => /^\s*(wander|feed|work|find|collection|api|look)\s/.test(l));
    console.log(`\n=== N=${N}, ${LEAST ? 'least in hand' : 'round-robin'}${HOLD ? `, copy-0 held by pg_sleep(${process.env.COPIES_HOLD_S || 2}) every ${process.env.COPIES_HOLD_EVERY_MS || 3000} ms` : ', nobody held'}: up in ${boot} ms; answered by ${[...P.count].map(([p, n], i) => `${copies[i].name} ${n}`).join(', ')}; load.js exit ${L.status}`);
    console.log(lines.join('\n') || L.out.slice(-2500));
    rows.push({ N, boot, status: L.status, doors: doorLines });
    P.srv.close(); for (const k of copies) { try { k.kill('SIGTERM'); } catch (e) { /* */ } } await nap(1500);
  }
  console.log('\ncopies: done'); process.exit(0);
})().catch(e => { console.error('copies:', e.stack || e); process.exit(1); });
