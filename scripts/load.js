'use strict';
// The load test (7 Nov; Will: "we need to stabilize this build"; the website had held 3.8 GB after a morning's warm and
// no gate had said so). A house is started in this process with LOAD_WORKS (60) works of several sizes (one of them
// 6,000 px wide, as the Gallery's paintings are), then LOAD_C (40) visitors walk its public doors for LOAD_S (45)
// seconds: Wander and its feed, a work page, the pictures at every size, Find, the collection, the API. What is
// measured: every door's p50 and p95, errors (anything but 2xx/3xx), and the house's memory before and after. It
// fails when p95 of a page passes LOAD_P95_MS (1500), any error lands, or the memory grows past LOAD_GROW_MB (300).
//   node scripts/load.js            (a fresh house in a temp folder; the numbers printed, exit 1 on a fault)
//   LOAD_BASE=https://… node scripts/load.js   (read only: the doors of a running house, the memory from /healthz)
// How it is measured (#25, 15 Nov): the first LOAD_WARM_S (8) seconds of the same crowd are a warm-up, printed apart and
// not counted (a fresh process compiles, builds its find index and its first pools); memory is read after it, so growth
// is the crowd's, not the boot's. The measured window lasts LOAD_S, longer if needed (to 3 × LOAD_S) until every door
// has LOAD_MIN_N (80) answers, so one hiccup cannot decide a p95 made of a handful of samples. The house says when its
// loop was held (LOOP_LAG 300) and this process says when it was itself held (the runner's neighbours); both are
// printed beside a fault. Every fault goes out as one ::error annotation on CI: which budget, the numbers, the door.
// Rule (docs/STABILITY.md): a promotion to main that touches src/app.js, src/images.js, src/stroll.js, the governor or
// the bridge runs this first on the test house.
const fs = require('fs');
const os = require('os');
const path = require('path');

const N = +process.env.LOAD_WORKS || 60, C = +process.env.LOAD_C || 40, S = +process.env.LOAD_S || 45;
const P95 = +process.env.LOAD_P95_MS || 1500, GROW = +process.env.LOAD_GROW_MB || 300;
const WARM = process.env.LOAD_WARM_S === undefined ? 8 : +process.env.LOAD_WARM_S, MIN_N = +process.env.LOAD_MIN_N || 80;
const STAND_MS = 800, REQ_MS = 30000;
// What the house said on its own console while it was walked: loop holds and slow questions, with the request named.
const said = { lag: [], slow: [], phase: 'boot', tail: [] };
function listen(line) {
  said.tail.push(line); if (said.tail.length > 30) said.tail.shift();
  if (/^\[lag\]/.test(line)) said.lag.push({ phase: said.phase, ms: +(line.match(/\[lag\]\s+(\d+)/) || [])[1] || 0, line });
  else if (/\[pg slow\]|\[slow\]/.test(line)) said.slow.push({ phase: said.phase, line });
  if (/\[lag\]|\[pg slow\]|\[house\]|Error|error/.test(line)) process.stderr.write('  house: ' + line + '\n');
}
// This process's own holds: when the runner stops us, every answer in flight looks slow, and the fault should say so.
const self = { worst: 0, held: 0, phase: null };
{ let last = Date.now(); setInterval(() => { const now = Date.now(), d = now - last - 50; last = now; if (self.phase === 'measure' && d > 200) { self.held += d; self.worst = Math.max(self.worst, d); } }, 50).unref(); }
// The fault, said where it can be read: on CI as one annotation (newlines as %0A), always on the console.
function report(title, lines) {
  console.log(`load: ${title}\n  ` + lines.join('\n  '));
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=load::${(title + '\n' + lines.join('\n')).slice(0, 1500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
}
async function freePort() { const net = require('net'); return new Promise((ok, no) => { const s = net.createServer(); s.unref(); s.on('error', no); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); }); }

// The house in a child process (its own event loop, as on Render), seeded by this one through the same code.
async function house() {
  const sharp = require('sharp');
  const { spawn } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-load-'));
  // the house's folder is this run's own: removed on the way out, whatever the verdict (the machine is shared)
  let child = null;
  process.on('exit', () => { try { if (child) child.kill('SIGKILL'); } catch (e) { /* */ } try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } });
  // seed first, in-process, then let the child serve the same folder
  {
    const { createApp } = require('../src/app');
    const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', noTimers: true, vaultNow: true });
    const { registerWork, db } = app.locals;
    const sizes = [[1600, 1067], [2400, 1600], [3600, 2400], [6000, 4000]];
    for (let i = 0; i < N; i++) {
      const [w, h] = sizes[i % sizes.length]; const f = path.join(dir, `w${i}.jpg`);
      await sharp({ create: { width: w, height: h, channels: 3, noise: { type: 'gaussian', mean: 90 + (i * 7) % 90, sigma: 30 } } }).jpeg({ quality: 92 }).toFile(f);
      const wk = await registerWork({ file: f, originalName: `w${i}.jpg`, title: `Load ${i}`, place: ['Paris', 'Florence', 'London'][i % 3] });
      db.prepare("UPDATE works SET status='held', stars=?, curated=? WHERE id=?").run(3 + (i % 3), i % 5 === 0 ? 1 : 0, wk.id);
    }
    // the seeding app's connection stays open (its timers run on; closing it under them threw on the runner)
  }
  // the operating system names a free port (a random one could collide with another house on the same machine)
  const port = await freePort();
  child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production', DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'pw', SESSION_SECRET: 's', BASE_URL: `http://127.0.0.1:${port}`, CHORES: '0', NO_SEED: '1', MALLOC_ARENA_MAX: process.env.MALLOC_ARENA_MAX || '2', CLOSER_FILL: '0', SPEECH_FILL: '0', LOOP_LAG: process.env.LOOP_LAG || '300' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = null; child.on('exit', (code, sig) => { exited = sig || code; });
  for (const st of [child.stdout, child.stderr]) { let buf = ''; st.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { listen(buf.slice(0, i)); buf = buf.slice(i + 1); } }); }
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && exited === null; i++) { try { if ((await fetch(base + '/healthz')).ok) { up = true; break; } } catch (e) { /* not yet */ } await new Promise(r => setTimeout(r, 500)); }
  if (!up) { report('the house never answered', [`/healthz on ${base} silent for 60 s${exited !== null ? `; the house exited (${exited})` : ''}`, ...said.tail.slice(-8)]); try { child.kill(); } catch (e) { /* */ } process.exit(1); }
  said.phase = 'ready';
  const j = await (await fetch(base + '/api/v1/works?limit=200')).json();
  const slugs = (j.works || j.items || []).map(w => w.slug);
  return { base, slugs, close: () => { try { child.kill('SIGKILL'); } catch (e) { /* */ } }, mem: () => memOf(base), exited: () => exited };
}
// The pictures made once, as the worker makes them ahead of the first visitor: the test measures the house as it stands
// with its copies in place; the cold first look at each picture is reported apart.
async function warm(base, slugs, stats) {
  for (const s of slugs) for (const z of ['thumb', 'screen', 'large']) for (const acc of ['image/webp,*/*', 'image/jpeg,*/*']) { const t0 = Date.now(); try { const r = await fetch(`${base}/img/${s}/${z}`, { headers: { accept: acc } }); await r.arrayBuffer(); if (r.status >= 400) stats.err++; } catch (e) { stats.err++; } stats.t.push(Date.now() - t0); }
}

async function memOf(base) {
  try { const j = await (await fetch(base + '/healthz')).json(); heapLast = j.mem && j.mem.heapMB; return j.mem && j.mem.rssMB; } catch (e) { return null; }
}
let heapLast = null;

async function run() {
  const live = process.env.LOAD_BASE;
  const H = live ? null : await house();
  const base = live || H.base;
  let slugs = H ? H.slugs : [];
  if (live) { try { const j = await (await fetch(base + '/api/v1/works?limit=40')).json(); slugs = (j.works || j.items || []).map(w => w.slug).filter(Boolean); } catch (e) { /* */ } }
  if (!slugs.length) { report('no works to walk', [`${base}/api/v1/works answered none`, ...said.tail.slice(-6)]); process.exit(1); }
  const doors = [
    ['wander', () => '/wander'],
    ['feed', () => `/api/stroll?n=8&seen=${slugs.slice(0, 3).join(',')}`],
    ['work', () => `/w/${pick(slugs)}`],
    ['thumb', () => `/img/${pick(slugs)}/thumb`],
    ['screen', () => `/img/${pick(slugs)}/screen`],
    ['large', () => `/img/${pick(slugs)}/large`],
    ['find', () => `/api/find?q=${['paris', 'load', 'flo'][Math.floor(Math.random() * 3)]}`],
    ['collection', () => '/collection'],
    ['api', () => `/api/v1/works/${pick(slugs)}`],
    ['look', () => '/look'],
  ];
  const faults = [];
  // The stand-in (7 Nov): with only the screen copy made, the large one is answered at once by the screen copy, uncached,
  // and the real copy follows behind; a visitor never waits on the master. Asked of five works (not one): every answer
  // must be the stand-in, and the middle one inside STAND_MS (a single sample on a cold process was a coin toss).
  if (H) {
    said.phase = 'stand-in'; const st = [];
    for (const s0 of slugs.slice(0, 5)) {
      await (await fetch(`${base}/img/${s0}/screen`)).arrayBuffer();
      const t0 = Date.now(); const r = await fetch(`${base}/img/${s0}/large`); await r.arrayBuffer();
      st.push({ s0, ms: Date.now() - t0, status: r.status, stand: r.headers.get('x-stand-in') === '1', cc: r.headers.get('cache-control') });
    }
    const mid = [...st].sort((x, y) => x.ms - y.ms)[Math.floor(st.length / 2)].ms;
    console.log(`stand-in: large with only screen made, ${st.length} works → ${st.map(x => `${x.status} ${x.ms} ms${x.stand ? '' : ' NOT a stand-in'}`).join(', ')}; middle ${mid} ms; ${st[0].cc}`);
    for (const x of st.filter(x => !x.stand)) faults.push(`stand-in: /img/${x.s0}/large answered ${x.status} in ${x.ms} ms without X-Stand-In (a visitor waited on the master)`);
    if (mid > STAND_MS) faults.push(`stand-in: middle of ${st.length} answers ${mid} ms over ${STAND_MS} (${st.map(x => x.ms).join(', ')} ms)`);
    await new Promise(r => setTimeout(r, 4000)); const r2 = await fetch(`${base}/img/${slugs[0]}/large`); await r2.arrayBuffer(); console.log(`stand-in: the real copy ${r2.headers.get('x-stand-in') ? 'still' : 'now'} in place`);
  }
  said.phase = 'cold';
  const cold = { t: [], err: 0, bytes: 0 }; if (H) await warm(base, slugs, cold);

  const fresh = () => Object.fromEntries(doors.map(([k]) => [k, { t: [], err: 0, bytes: 0, lim: 0, first: null }]));
  let stats = fresh(), n = 0, until = 0;
  async function visitor(i, enough) {
    while (Date.now() < until || !enough()) {
      const [k, u] = doors[(i + n++) % doors.length]; const url = u();
      const t0 = Date.now(); const s = stats[k];
      try {
        const r = await fetch(base + url, { headers: { accept: 'image/webp,text/html,*/*' }, redirect: 'manual', signal: AbortSignal.timeout(REQ_MS) });
        const b = await r.arrayBuffer(); s.bytes += b.byteLength;
        if (r.status === 429) s.lim++; else if (r.status >= 400) { s.err++; s.first = s.first || `${r.status} at ${url}`; }
      } catch (e) { s.err++; s.first = s.first || `${e.name === 'TimeoutError' ? `no answer in ${REQ_MS / 1000} s` : e.message} at ${url}`; }
      s.t.push(Date.now() - t0);
    }
  }
  const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  // The warm-up: the same crowd, not counted.
  if (WARM > 0) {
    said.phase = 'warm-up'; until = Date.now() + WARM * 1000;
    await Promise.all(Array.from({ length: C }, (_, i) => visitor(i, () => true)));
    const all = Object.values(stats).flatMap(s => s.t), werr = Object.values(stats).reduce((a, s) => a + s.err, 0);
    console.log(`warm-up (not counted): ${WARM}s, n ${all.length}, p50 ${q(all, 0.5)}, p95 ${q(all, 0.95)}, max ${q(all, 1)} ms, err ${werr}`);
    stats = fresh();
  }
  const m0 = await memOf(base); const h0 = heapLast;
  said.phase = 'measure'; self.phase = 'measure';
  const t0 = Date.now(), cap = t0 + 3 * S * 1000; until = t0 + S * 1000;
  const enough = () => Date.now() >= cap || Object.values(stats).every(s => s.t.length >= MIN_N);
  await Promise.all(Array.from({ length: C }, (_, i) => visitor(i, enough)));
  const took = (Date.now() - t0) / 1000;
  self.phase = null; said.phase = 'after';
  const m1 = await memOf(base); const h1 = heapLast;
  console.log(`load: ${C} visitors for ${took.toFixed(0)}s (LOAD_S ${S}, at least ${MIN_N} answers a door) over ${slugs.length} works${live ? ' at ' + live : ''}`);
  console.log('door         n     p50     p95    max  err     MB');
  const rows = [], few = [];
  for (const [k] of doors) {
    const s = stats[k]; const p95 = q(s.t, 0.95);
    console.log(`${k.padEnd(10)} ${String(s.t.length).padStart(5)} ${String(q(s.t, 0.5)).padStart(6)} ${String(p95).padStart(7)} ${String(q(s.t, 1)).padStart(6)} ${String(s.err).padStart(4)} ${(s.bytes / 1048576).toFixed(1).padStart(6)}`);
    rows.push(`${k} n${s.t.length} p50 ${q(s.t, 0.5)} p95 ${p95} max ${q(s.t, 1)}`);
    if (s.lim) console.log(`  (${k}: ${s.lim} answered 429 by the house's own limiter: one address asking as forty)`);
    if (s.err) faults.push(`errors: ${k} answered ${s.err} of ${s.t.length} wrong, the first ${s.first}`);
    if (!/thumb|screen|large/.test(k) && p95 > P95) faults.push(`p95: ${k} ${p95} ms over ${P95} (n ${s.t.length}, p50 ${q(s.t, 0.5)}, max ${q(s.t, 1)})`);
    if (s.t.length < MIN_N) few.push(`samples: ${k} answered only ${s.t.length} times in ${took.toFixed(0)} s (at least ${MIN_N} are needed to read a p95)`);
  }
  if (cold.t.length) console.log(`cold pictures (first look, one at a time): n ${cold.t.length}, p50 ${q(cold.t, 0.5)}, p95 ${q(cold.t, 0.95)}, max ${q(cold.t, 1)} ms, err ${cold.err}`);
  console.log(`memory (after the warm-up → after the crowd): rss ${m0} → ${m1} MB${m0 != null && m1 != null ? ` (${m1 - m0 >= 0 ? '+' : ''}${m1 - m0})` : ''}; heap ${h0} → ${h1} MB`);
  if (m0 == null || m1 == null) faults.push(`memory: /healthz gave no rss (${m0} → ${m1}), so growth could not be read`);
  else if (m1 - m0 > GROW) faults.push(`memory: rss grew ${m1 - m0} MB (${m0} → ${m1}), over ${GROW}`);
  const slow = said.slow.filter(x => x.phase === 'measure' || x.phase === 'warm-up');
  for (const x of slow.slice(0, 3)) faults.push(`slow question (${x.phase}): ${x.line.slice(0, 200)}`);
  const lag = said.lag.filter(x => x.phase === 'measure').sort((a, b) => b.ms - a.ms);
  const ctx = [`the house's loop held over 300 ms ${lag.length} times${lag.length ? `, worst: ${lag[0].line.slice(0, 220)}` : ''}`, `this process held ${self.held} ms in all, worst ${self.worst} ms (the runner, not the house)`];
  console.log('context: ' + ctx.join('; '));
  if (H && H.exited() !== null) faults.push(`the house exited during the walk (${H.exited()})`);
  faults.push(...few);
  if (H) H.close();
  if (faults.length) { report(`${faults.length} fault${faults.length > 1 ? 's' : ''}: ${C} visitors, ${took.toFixed(0)} s, ${slugs.length} works`, [...faults, ...ctx, 'doors: ' + rows.join('; ')]); process.exit(1); }
  console.log('load: holds');
  process.exit(0);
}
const pick = a => a[Math.floor(Math.random() * a.length)];
run().catch(e => { report('the load test broke before it could judge', [String(e && e.stack || e).split('\n').slice(0, 4).join(' | '), ...said.tail.slice(-6)]); process.exit(1); });
