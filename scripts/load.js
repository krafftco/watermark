'use strict';
// The load test (7 Nov; Will: "we need to stabilize this build"; the website had held 3.8 GB after a morning's warm and
// no gate had said so). A house is started in this process with LOAD_WORKS (60) works of several sizes (one of them
// 6,000 px wide, as the Gallery's paintings are), then LOAD_C (40) visitors walk its public doors for LOAD_S (45)
// seconds: Wander and its feed, a work page, the pictures at every size, Find, the collection, the API. What is
// measured: every door's p50 and p95, errors (anything but 2xx/3xx), and the house's memory before and after. It
// fails when p95 of a page passes LOAD_P95_MS (1500), any error lands, or the memory grows past LOAD_GROW_MB (300).
//   node scripts/load.js            (a fresh house in a temp folder; the numbers printed, exit 1 on a fault)
//   LOAD_BASE=https://… node scripts/load.js   (read only: the doors of a running house, the memory from /healthz)
// Rule (docs/STABILITY.md): a promotion to main that touches src/app.js, src/images.js, src/stroll.js, the governor or
// the bridge runs this first on the test house.
const fs = require('fs');
const os = require('os');
const path = require('path');

const N = +process.env.LOAD_WORKS || 60, C = +process.env.LOAD_C || 40, S = +process.env.LOAD_S || 45;
const P95 = +process.env.LOAD_P95_MS || 1500, GROW = +process.env.LOAD_GROW_MB || 300;

// The house in a child process (its own event loop, as on Render), seeded by this one through the same code.
async function house() {
  const sharp = require('sharp');
  const { spawn } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-load-'));
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
    if (db.close) db.close();
  }
  const port = 3300 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production', DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'pw', SESSION_SECRET: 's', BASE_URL: `http://127.0.0.1:${port}`, CHORES: '0', NO_SEED: '1', CLOSER_FILL: '0', SPEECH_FILL: '0' }, stdio: ['ignore', 'ignore', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch (e) { /* not yet */ } await new Promise(r => setTimeout(r, 500)); }
  const j = await (await fetch(base + '/api/v1/works?limit=200')).json();
  const slugs = (j.works || j.items || []).map(w => w.slug);
  return { base, slugs, close: () => child.kill(), mem: () => memOf(base) };
}
// The pictures made once, as the worker makes them ahead of the first visitor: the test measures the house as it stands
// with its copies in place; the cold first look at each picture is reported apart.
async function warm(base, slugs, stats) {
  for (const s of slugs) for (const z of ['thumb', 'screen', 'large']) for (const acc of ['image/webp,*/*', 'image/jpeg,*/*']) { const t0 = Date.now(); try { const r = await fetch(`${base}/img/${s}/${z}`, { headers: { accept: acc } }); await r.arrayBuffer(); if (r.status >= 400) stats.err++; } catch (e) { stats.err++; } stats.t.push(Date.now() - t0); }
}

async function memOf(base) {
  try { const j = await (await fetch(base + '/healthz')).json(); return j.mem && j.mem.rssMB; } catch (e) { return null; }
}

async function run() {
  const live = process.env.LOAD_BASE;
  const H = live ? null : await house();
  const base = live || H.base;
  let slugs = H ? H.slugs : [];
  if (live) { try { const j = await (await fetch(base + '/api/v1/works?limit=40')).json(); slugs = (j.works || j.items || []).map(w => w.slug).filter(Boolean); } catch (e) { /* */ } }
  if (!slugs.length) throw new Error('no works to walk');
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
  const stats = Object.fromEntries(doors.map(([k]) => [k, { t: [], err: 0, bytes: 0 }]));
  // The stand-in (7 Nov): with only the screen copy made, the large one is answered at once by the screen copy, uncached,
  // and the real copy follows behind; a visitor never waits on the master.
  if (H) { const s0 = slugs[0]; await (await fetch(`${base}/img/${s0}/screen`)).arrayBuffer(); const t0 = Date.now(); const r = await fetch(`${base}/img/${s0}/large`); await r.arrayBuffer(); const dt = Date.now() - t0;
    console.log(`stand-in: large with only screen made → ${r.status} in ${dt} ms, X-Stand-In ${r.headers.get('x-stand-in') || '-'}, ${r.headers.get('cache-control')}`);
    if (r.headers.get('x-stand-in') !== '1' || dt > 800) { console.log('load: FAULT the stand-in did not answer at once'); process.exit(1); }
    await new Promise(r => setTimeout(r, 4000)); const r2 = await fetch(`${base}/img/${s0}/large`); await r2.arrayBuffer(); console.log(`stand-in: the real copy ${r2.headers.get('x-stand-in') ? 'still' : 'now'} in place`); }
  const cold = { t: [], err: 0, bytes: 0 }; if (H) await warm(base, slugs, cold);
  const m0 = await memOf(base);
  const until = Date.now() + S * 1000; let n = 0;
  async function visitor(i) {
    while (Date.now() < until) {
      const [k, u] = doors[(i + n++) % doors.length];
      const t0 = Date.now();
      try {
        const r = await fetch(base + u(), { headers: { accept: 'image/webp,text/html,*/*' }, redirect: 'manual' });
        const b = await r.arrayBuffer(); stats[k].bytes += b.byteLength;
        if (r.status === 429) stats[k].lim = (stats[k].lim || 0) + 1; else if (r.status >= 400) stats[k].err++;
      } catch (e) { stats[k].err++; }
      stats[k].t.push(Date.now() - t0);
    }
  }
  await Promise.all(Array.from({ length: C }, (_, i) => visitor(i)));
  const m1 = await memOf(base);
  const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const faults = [];
  console.log(`load: ${C} visitors for ${S}s over ${slugs.length} works${live ? ' at ' + live : ''}`);
  console.log('door         n     p50     p95    max  err     MB');
  for (const [k] of doors) {
    const s = stats[k]; const p95 = q(s.t, 0.95);
    console.log(`${k.padEnd(10)} ${String(s.t.length).padStart(5)} ${String(q(s.t, 0.5)).padStart(6)} ${String(p95).padStart(7)} ${String(q(s.t, 1)).padStart(6)} ${String(s.err).padStart(4)} ${(s.bytes / 1048576).toFixed(1).padStart(6)}`);
    if (s.lim) console.log(`  (${k}: ${s.lim} answered 429 by the house's own limiter: one address asking as forty)`);
    if (s.err) faults.push(`${k}: ${s.err} errors`);
    if (!/thumb|screen|large/.test(k) && p95 > P95) faults.push(`${k}: p95 ${p95} ms over ${P95}`);
  }
  if (cold.t.length) console.log(`cold pictures (first look, one at a time): n ${cold.t.length}, p50 ${q(cold.t, 0.5)}, p95 ${q(cold.t, 0.95)}, max ${q(cold.t, 1)} ms, err ${cold.err}`);
  console.log(`memory: ${m0} → ${m1} MB${m0 != null && m1 != null ? ` (${m1 - m0 >= 0 ? '+' : ''}${m1 - m0})` : ''}`);
  if (m0 != null && m1 != null && m1 - m0 > GROW) faults.push(`memory grew ${m1 - m0} MB, over ${GROW}`);
  if (H) H.close();
  if (faults.length) { console.log('load: FAULTS\n  ' + faults.join('\n  ')); process.exit(1); }
  console.log('load: holds');
  process.exit(0);
}
const pick = a => a[Math.floor(Math.random() * a.length)];
run().catch(e => { console.error('load:', e.message); process.exit(1); });
