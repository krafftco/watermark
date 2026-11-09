'use strict';
// The scale test (9 Nov 2026; Will: "build this thing for 1 million works, 500,000 works… Shark Tank night"). The load
// test walks a house of sixty works; every outage of this week came from a page that read the whole collection, which
// sixty works never shows. Here a real house on Postgres (the bridge the live house runs on) takes SCALE_SEED (24)
// real pictures, then its rows are multiplied in the database to SCALE_WORKS (500,000) across SCALE_MAKERS (200)
// makers, and SCALE_C (200) visitors walk the public doors for SCALE_S (40) seconds. Pictures are asked only of the
// real works (the copies exist); every page, feed, search and record is asked of the whole.
//   SCALE_DB=postgres://… node scripts/scale.js      (the database is emptied first: never the live one)
// It fails when a page's p95 passes SCALE_P95_MS (1000), any door errors, the first hit of a door after start passes
// SCALE_FIRST_MS (3000), or the house's memory passes SCALE_RSS_MB (1200).
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');
const URL_ = process.env.SCALE_DB;
if (!URL_ || /render\.com|amazonaws|watermark-db/.test(URL_)) { console.error('scale: SCALE_DB must name a local test database'); process.exit(2); }
const N = +process.env.SCALE_WORKS || 500000, MK = +process.env.SCALE_MAKERS || 200, SEED = +process.env.SCALE_SEED || 24;
const C = +process.env.SCALE_C || 200, S = +process.env.SCALE_S || 40;
// SCALE_THINK_MS (3000): each visitor reads for about that long between pages (half to one and a half times it), as people do;
// 0 is the throughput run, every visitor asking again the instant a page lands.
const THINK = process.env.SCALE_THINK_MS === undefined ? 3000 : +process.env.SCALE_THINK_MS;
const P95 = +process.env.SCALE_P95_MS || 1000, FIRST = +process.env.SCALE_FIRST_MS || 3000, RSS = +process.env.SCALE_RSS_MB || 1200;
const node = (code, env) => execFileSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 }).toString();

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-scale-'));
  const env = { DATABASE_URL: URL_, DATA_DIR: dir, NODE_ENV: 'production', ADMIN_PASSWORD: 'pw', SESSION_SECRET: 's', BASE_URL: 'http://localhost', NO_SEED: '1', CHORES: '0', WATCHDOG: '0', DB_SLOW_MS: process.env.SCALE_SLOW_MS || '500', SCALE_N: String(N), SCALE_MK: String(MK), SCALE_SEED: String(SEED) };
  // 1. An empty database, a house, a few real works with their copies, then the rows multiplied.
  const t0 = Date.now();
  const out = node(`
    (async () => {
      const { Client } = require('pg'); const c0 = new Client({ connectionString: process.env.DATABASE_URL }); await c0.connect();
      await c0.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await c0.end();
      const sharp = require('sharp'), path = require('path');
      const { createApp } = require('./src/app');
      const app = createApp({ dataDir: process.env.DATA_DIR, base: 'http://localhost', adminPassword: 'pw', secret: 's', noTimers: true, vaultNow: true });
      const { registerWork, db } = app.locals; const N = +process.env.SCALE_N, MK = +process.env.SCALE_MK, SEED = +process.env.SCALE_SEED;
      const places = ['Paris','Florence','London','New York','Kyoto','Lisbon','Rome','Vienna','Dallas','Boston','Milan','Venice'];
      const slugs = [];
      for (let i = 0; i < SEED; i++) {
        const f = path.join(process.env.DATA_DIR, 'w' + i + '.jpg');
        await sharp({ create: { width: 2400, height: 1600, channels: 3, noise: { type: 'gaussian', mean: 80 + (i * 7) % 90, sigma: 30 } } }).jpeg({ quality: 90 }).toFile(f);
        const w = await registerWork({ file: f, originalName: 'w' + i + '.jpg', title: 'Scale ' + i, place: places[i % places.length] });
        db.prepare("UPDATE works SET status='held', stars=?, curated=?, hall=1, copies_at=datetime('now') WHERE id=?").run(3 + (i % 3), i % 5 === 0 ? 1 : 0, w.id);
        slugs.push(w.slug);
        try { await app.locals.copies.make(db.prepare('SELECT * FROM works WHERE id=?').get(w.id)); } catch (e) { console.error('copies', e.message); }
      }
      const house = db.prepare('SELECT id FROM makers ORDER BY id LIMIT 1').get().id;
      const mcols = Object.keys(db.prepare('SELECT * FROM makers WHERE id=?').get(house)).filter(k => !['id','handle','email','name','slug','buyer_id','stripe_account','white_domain'].includes(k));
      db.exec("INSERT INTO makers (handle, name, " + mcols.join(', ') + ") SELECT 'scale-' || g, 'Scale Maker ' || g, " + mcols.map(k => 'm.' + k).join(', ') + " FROM makers m, generate_series(1, " + MK + ") g WHERE m.id=" + house);
      db.exec("UPDATE makers SET door='house' WHERE handle LIKE 'scale-%'");
      const m0 = db.prepare("SELECT MIN(id) a FROM makers WHERE handle LIKE 'scale-%'").get().a;
      const cols = Object.keys(db.prepare('SELECT * FROM works ORDER BY id LIMIT 1').get()).filter(k => !['id','slug','maker_id','title','place','taken_at','stars','curated','accession'].includes(k));
      const per = Math.ceil(N / SEED);
      const t = Date.now();
      db.exec("INSERT INTO works (slug, maker_id, title, place, taken_at, stars, curated, accession, " + cols.join(', ') + ") SELECT w.slug || '-' || g, " + m0 + " + (g % " + MK + "), 'Work ' || g || ' of ' || w.title, (ARRAY['Paris','Florence','London','New York','Kyoto','Lisbon','Rome','Vienna','Dallas','Boston','Milan','Venice'])[1 + (g % 12)], (1900 + (g % 125)) || '-06-15 12:00:00', (g % 6), CASE WHEN g % 40 = 0 THEN 1 ELSE 0 END, 'S.' || w.id || '.' || g, " + cols.map(k => 'w.' + k).join(', ') + " FROM works w, generate_series(1, " + per + ") g WHERE w.slug LIKE 'scale-%'");
      require('./src/indexes').ensure(db);
      db.exec('ANALYZE');
      const n = db.prepare('SELECT COUNT(*) n FROM works').get().n;
      const far = db.prepare("SELECT slug FROM works WHERE id > ? ORDER BY id LIMIT 40").all(Math.floor(n / 2)).map(x => x.slug);
      const mk = db.prepare("SELECT handle FROM makers WHERE handle LIKE 'scale-%' ORDER BY id LIMIT 5").all().map(x => x.handle);
      console.log('@@' + JSON.stringify({ n, slugs, far, mk, cloneMs: Date.now() - t }));
      process.exit(0);
    })().catch(e => { console.error(e); process.exit(1); });`, env);
  const seed = JSON.parse(out.split('@@').pop());
  console.log(`scale: a house of ${seed.n.toLocaleString()} works by ${MK} makers (seeded in ${Math.round((Date.now() - t0) / 1000)} s; the rows multiplied in ${seed.cloneMs} ms)`);
  // 1b. The worker's part (shared.js): what it builds ahead for the website, built once here as it would have been.
  if (process.env.SCALE_WORKER !== '0') { const t1 = Date.now(); const o = node(`
    const { createApp } = require('./src/app');
    const app = createApp({ dataDir: process.env.DATA_DIR, base: 'http://localhost', adminPassword: 'pw', secret: 's', noTimers: true });
    const built = []; for (let i = 0; i < 20; i++) { const k = app.locals.shared.round(); if (!k) break; built.push(k); }
    console.log('@@' + built.join(', ')); process.exit(0);
  `, { ...env, ROLE: 'worker' }); console.log(`scale: the worker built ahead: ${o.split('@@').pop().trim()} (${Date.now() - t1} ms)`); }
  // 2. The website, as on Render: ROLE=web, its own process.
  const port = 3900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, ...env, ROLE: 'web', PORT: String(port), LOOP_LAG: '300' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  let up = false; for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/healthz')).ok) { up = true; break; } } catch (e) { /* not yet */ } await new Promise(r => setTimeout(r, 500)); }
  if (!up) { console.log(log.slice(-3000)); child.kill(); throw new Error('the house did not start'); }
  const mem = async () => { try { const j = await (await fetch(base + '/healthz')).json(); return j.mem || {}; } catch (e) { return {}; } };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const words = ['paris', 'work', 'flo', 'kyoto', 'scale 3', '1950'];
  const doors = [
    ['front', () => '/'], ['wander', () => '/wander'], ['feed', () => `/api/stroll?n=8&seen=${seed.slugs.slice(0, 3).join(',')}`],
    ['wander maker', () => `/wander?maker=${pick(seed.mk)}`], ['wander word', () => `/wander?q=${pick(['paris', 'kyoto', 'rome'])}`],
    ['work', () => `/w/${pick(seed.far)}`], ['work api', () => `/api/v1/works/${pick(seed.far)}`], ['side', () => `/stroll/side/${pick(seed.far)}`],
    ['house', () => '/house'], ['collection', () => '/collection'], ['makers', () => '/makers'], ['artists', () => '/artists'],
    ['maker', () => `/m/${pick(seed.mk)}`], ['look', () => '/look'], ['find', () => `/api/find?q=${encodeURIComponent(pick(words))}`], ['find page', () => `/find?q=${pick(['paris', 'work'])}`],
    ['api list', () => `/api/v1/works?limit=24&offset=${Math.floor(Math.random() * 2000)}`], ['index', () => '/api/index.json'], ['ledger', () => '/ledger'],
    ['thumb', () => `/img/${pick(seed.slugs)}/thumb`], ['screen', () => `/img/${pick(seed.slugs)}/screen`],
  ];
  const stats = Object.fromEntries(doors.map(([k]) => [k, { t: [], err: 0, first: 0, codes: {} }]));
  // The first visit to each door, alone: what a stranger pays when nothing is kept yet.
  for (const [k, u] of doors) { const t = Date.now(); try { const r = await fetch(base + u(), { redirect: 'manual', headers: { accept: 'text/html,image/webp,*/*' } }); await r.arrayBuffer(); if (r.status >= 400) { stats[k].err++; stats[k].codes[r.status] = 1; } } catch (e) { stats[k].err++; } stats[k].first = Date.now() - t; }
  const m0 = await mem();
  const until = Date.now() + S * 1000; let n = 0, peak = m0.rssMB || 0;
  const watch = setInterval(async () => { const m = await mem(); if (m.rssMB > peak) peak = m.rssMB; }, 3000);
  const nap = ms => new Promise(r => setTimeout(r, ms));
  async function visitor(i) {
    if (THINK) await nap(Math.random() * THINK); // people do not all arrive in the same instant
    while (Date.now() < until) {
      if (THINK && n > C) await nap(THINK * (0.5 + Math.random()));
      const [k, u] = doors[(i + n++) % doors.length]; const t = Date.now();
      try { const r = await fetch(base + u(), { redirect: 'manual', headers: { accept: 'text/html,image/webp,*/*', 'x-forwarded-for': `10.${i % 250}.${(i >> 8) % 250}.${1 + (n % 250)}` } }); await r.arrayBuffer(); if (r.status === 429) stats[k].lim = (stats[k].lim || 0) + 1; else if (r.status >= 400) { stats[k].err++; stats[k].codes[r.status] = (stats[k].codes[r.status] || 0) + 1; } } catch (e) { stats[k].err++; stats[k].codes.net = (stats[k].codes.net || 0) + 1; }
      stats[k].t.push(Date.now() - t);
    }
  }
  await Promise.all(Array.from({ length: C }, (_, i) => visitor(i)));
  clearInterval(watch); const m1 = await mem(); if (m1.rssMB > peak) peak = m1.rssMB;
  const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const faults = []; let total = 0;
  console.log(`scale: ${C} visitors for ${S} s${THINK ? `, reading about ${THINK / 1000} s between pages` : ', asking again at once (throughput)'}`);
  console.log('door              n   first    p50    p95    max  err');
  for (const [k] of doors) {
    const s = stats[k]; total += s.t.length; const p95 = q(s.t, 0.95);
    console.log(`${k.padEnd(13)} ${String(s.t.length).padStart(5)} ${String(s.first).padStart(7)} ${String(q(s.t, 0.5)).padStart(6)} ${String(p95).padStart(6)} ${String(q(s.t, 1)).padStart(6)} ${String(s.err).padStart(4)}${s.err ? ' ' + JSON.stringify(s.codes) : ''}${s.lim ? ` (429 × ${s.lim})` : ''}`);
    if (s.err) faults.push(`${k}: ${s.err} errors ${JSON.stringify(s.codes)}`);
    if (p95 > P95) faults.push(`${k}: p95 ${p95} ms over ${P95}`);
    if (s.first > FIRST) faults.push(`${k}: the first visit took ${s.first} ms, over ${FIRST}`);
  }
  console.log(`scale: ${total} answers, ${Math.round(total / S)} a second; memory rss ${m0.rssMB} → ${m1.rssMB} MB (peak ${peak}), heap ${m0.heapMB} → ${m1.heapMB} MB`);
  if (peak > RSS) faults.push(`memory peaked at ${peak} MB, over ${RSS}`);
  const slow = (log.match(/\[pg slow\][^\n]*/g) || []); const bySql = {};
  for (const l of slow) { const m = l.match(/\[pg slow\] (\d+) ms: (.*)/); if (m) { const k = m[2].slice(0, 150); bySql[k] = bySql[k] || { n: 0, max: 0, sum: 0 }; bySql[k].n++; bySql[k].sum += +m[1]; bySql[k].max = Math.max(bySql[k].max, +m[1]); } }
  const worst = Object.entries(bySql).sort((a, b) => b[1].sum - a[1].sum).slice(0, 18);
  if (worst.length) { console.log(`slow questions (${slow.length} over the line), the worst:`); for (const [k, v] of worst) console.log(`  ${String(v.sum).padStart(7)} ms in all · ${String(v.max).padStart(5)} worst × ${String(v.n).padStart(4)}  ${k}`); }
  { const L = log.split('\n'); const lag = []; L.forEach((l, i) => { if (/^\[lag\]/.test(l)) lag.push(`  ${l}   after: ${(L.slice(Math.max(0, i - 3), i).filter(x => !/^\[lag\]/.test(x)).pop() || '').slice(0, 170)}`); }); if (lag.length) console.log(`the loop was held ${lag.length} times over 300 ms:\n` + lag.slice(0, 30).join('\n')); }
  child.kill();
  if (faults.length) { console.log('scale: FAULTS\n  ' + faults.join('\n  ')); process.exit(1); }
  console.log('scale: holds'); process.exit(0);
}
main().catch(e => { console.error('scale:', e.message); process.exit(1); });
