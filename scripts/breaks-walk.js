#!/usr/bin/env node
'use strict';
// The breaks walk (#149): a visitor in a real browser while the house breaks, three ways, photographed at each.
//   1. a room throws: the house's own page, Try again, the way back;
//   2. a limit fires: the house's limit page, which tries again by itself;
//   3. the house stops mid-visit: an edge in front (a stand-in for CloudFront with the custom error responses Will is
//      asked to set: 502/503/504 → the one-moment page, answered 503) shows the one-moment page; the house comes back
//      and the page returns the visitor to the address by itself;
//   4. the same stop for a returning visitor whose service worker is installed and the edge answers a bare 502;
//   5. the one-moment page with scripts off.
// The house runs in a child process (so it can be stopped and started); the edge is a small proxy in this process.
//   node scripts/breaks-walk.js                    Chromium (the machine's Chrome)
//   WM_ENGINE=webkit node scripts/breaks-walk.js   Safari's engine (CI's reach-webkit job)
//   BREAKS_SHOTS=<dir>                             where the photographs go (default: ./scratch/breaks-<engine>)
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http'); const { spawn } = require('child_process');
const assert = require('assert');

// ---- the house, as a child ----
if (process.argv[2] === '--house') {
  process.env.NODE_ENV = 'test';
  const { createApp } = require('../src/app.js');
  const dir = process.argv[3]; const port = +process.argv[4];
  const app = createApp({ dataDir: dir, base: `http://127.0.0.1:${port}`, adminPassword: 'pw', secret: 'walk', noTimers: true, vaultNow: true });
  app.get('/__walk/throw', () => { throw new Error('the walk broke this room'); });
  app.get('/__walk/limit', () => { const e = new Error('database: over the limit of 4000 ms'); e.status = 503; e.limit = true; e.sql = 'SELECT slug FROM works WHERE maker_id=? LIMIT 200'; throw e; });
  const st = app.router.stack; st.unshift(st.pop()); st.unshift(st.pop());
  (async () => {
    const { db } = app.locals;
    if (!db.prepare("SELECT slug FROM works WHERE status='held' LIMIT 1").get()) {
      for (const [title, w, h] of [['The Harbour at Dusk', 3600, 2400], ['Rooftops, Morning', 3000, 2000]]) {
        const f = path.join(dir, `in-${w}.jpg`); await require('sharp')(path.join(__dirname, '..', 'test', 'fixture.jpg')).resize(w, h, { fit: 'fill' }).jpeg().toFile(f);
        const r = await app.locals.registerWork({ file: f, title, place: 'New York', originalName: path.basename(f) });
        db.prepare("UPDATE works SET status='held', curated=1 WHERE slug=?").run(r.slug);
      }
    }
    app.listen(port, '127.0.0.1', () => { process.send && process.send({ up: true, slugs: db.prepare("SELECT slug FROM works WHERE status='held' ORDER BY id LIMIT 2").all().map(x => x.slug) }); });
  })().catch(e => { console.error(e); process.exit(1); });
  return;
}

const ENGINE = require('./engine');
ENGINE.guard('breaks');
const { momentPage } = require('../src/breaks');
const MOMENT = momentPage();
const free = () => new Promise(r => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-breakswalk-'));
  const shots = process.env.BREAKS_SHOTS || path.join(process.cwd(), 'scratch', 'breaks-' + ENGINE.name); fs.mkdirSync(shots, { recursive: true });
  const housePort = await free(); const edgePort = await free();
  let house = null; let slugs = [];
  const start = () => new Promise((res, rej) => { house = spawn(process.execPath, [__filename, '--house', dir, String(housePort)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let err = ''; house.stderr.on('data', d => { err += d; }); house.on('message', m => { if (m.up) { slugs = m.slugs; res(); } }); house.on('exit', c => { if (c) rej(new Error('the house did not start: ' + err.slice(-800))); }); });
  const stop = () => new Promise(res => { if (!house || house.exitCode !== null) return res(); house.once('exit', () => res()); house.kill('SIGKILL'); });

  // The edge: forwards to the house; when the house answers 502/503/504 or cannot be reached, the one-moment page (503).
  let edgeMode = 'page'; // 'page': the custom error responses are set; 'bare': they are not (a bare 502, as the host's)
  const SWAP = new Set((process.env.EDGE_CODES || '502,503,504').split(',').map(Number));
  const edge = http.createServer((req, res) => {
    const fail = code => { if (res.headersSent) return res.destroy(); if (edgeMode === 'bare') { res.writeHead(502, { 'content-type': 'text/html' }); return res.end('<html><body><h1>502 Bad Gateway</h1></body></html>'); } res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(MOMENT); };
    const up = http.request({ host: '127.0.0.1', port: housePort, method: req.method, path: req.url, headers: req.headers }, r => {
      if (SWAP.has(r.statusCode)) { r.resume(); return fail(r.statusCode); }
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    up.on('error', () => fail(502)); req.pipe(up);
  }).listen(edgePort, '127.0.0.1');
  const E = `http://127.0.0.1:${edgePort}`; const O = `http://127.0.0.1:${housePort}`;

  await start();
  const browser = ENGINE.webkit ? await ENGINE.launch() : await require('playwright').chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' }).catch(() => require('playwright').chromium.launch());
  const phone = ENGINE.webkit ? ENGINE.devices['iPhone 13'] : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const said = [];
  const shot = async (page, name, what) => { const f = path.join(shots, `${name}.png`); await page.screenshot({ path: f, fullPage: false }); const t = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 400); said.push({ name, url: page.url(), what, text: t }); console.log(`[${ENGINE.name}] ${name}: ${what}\n    ${t}`); };
  const waitText = (page, re, ms = 60000) => page.waitForFunction(s => new RegExp(s).test(document.body && document.body.innerText || ''), re.source, { timeout: ms });

  // Visits without a service worker first (a first-time visitor).
  let ctx = await browser.newContext({ ...phone, serviceWorkers: 'block' }); let page = await ctx.newPage();
  await page.goto(`${E}/w/${slugs[0]}`); await shot(page, '0-a-work', 'a work, the house up');
  // 1. A room throws (reached from the work, so the way back is the work).
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/__walk/throw'; a.id = 'go'; a.textContent = 'go'; document.body.append(a); }); await Promise.all([page.waitForNavigation(), page.click('#go')]);
  let body = await page.locator('body').innerText(); assert.ok(/Something in this room gave way/.test(body) && /Nothing you have collected/.test(body) && /Back to where you were/.test(body) && /Try again/.test(body), '1: the house\'s page with its way back: ' + body.slice(0, 300));
  assert.strictEqual(await page.locator('a', { hasText: 'Back to where you were' }).getAttribute('href'), `/w/${slugs[0]}`);
  await shot(page, '1-a-room-throws', 'a room throws: the house\'s page, Try again and the way back');
  // 2. A limit, at the house itself (its own page) and through the edge (which, with 503 set, shows the one-moment page).
  await page.goto(`${O}/__walk/limit`); body = await page.locator('body').innerText(); assert.ok(/took too long/.test(body) && /Trying again by itself/.test(body), '2: the limit\'s page: ' + body.slice(0, 300));
  await shot(page, '2-a-limit-fires', 'a limit fires: the house\'s own page, trying again by itself');
  await page.goto(`${E}/__walk/limit`); body = await page.locator('body').innerText(); assert.ok(/caught a cold/.test(body), '2b: through the edge, the one-moment page');
  await shot(page, '2b-a-limit-through-the-edge', 'the same limit through an edge set for 503: the one-moment page');
  // 3. The house stops mid-visit: the next press meets the one-moment page; the house comes back; the visitor is returned.
  await page.goto(`${E}/w/${slugs[0]}`); await stop();
  await page.goto(`${E}/w/${slugs[1]}`); body = await page.locator('body').innerText(); assert.ok(/caught a cold/.test(body) && /Nothing you have collected/.test(body), '3: the one-moment page: ' + body.slice(0, 300));
  assert.strictEqual(page.url(), `${E}/w/${slugs[1]}`, 'at the address they asked for');
  await shot(page, '3-the-house-stops', 'the house stops mid-visit: the edge\'s one-moment page, at the address asked for');
  await page.waitForTimeout(4000); await shot(page, '3b-still-trying', 'still down: it says it is trying');
  const t0 = Date.now(); await start(); await waitText(page, /Rooftops, Morning/, 60000);
  assert.strictEqual(page.url(), `${E}/w/${slugs[1]}`); await shot(page, '3c-back-by-itself', `the house back: returned to the work by itself (${Math.round((Date.now() - t0) / 1000)} s after it was started)`);
  await ctx.close();

  // 4. A returning visitor with the service worker: the edge answers a bare 502 (as if nothing were set at the edge).
  let sw = 'not tried';
  try {
    ctx = await browser.newContext({ ...phone }); page = await ctx.newPage();
    await page.goto(`${E}/w/${slugs[0]}`); await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true));
    await page.waitForFunction(async () => !!(await caches.match('/static/cold.html')), null, { timeout: 30000 });
    await page.reload();
    edgeMode = 'bare'; await stop();
    await page.goto(`${E}/about`); body = await page.locator('body').innerText();
    assert.ok(/caught a cold/.test(body) && !/Bad Gateway/.test(body), '4: the worker shows the one-moment page, not the bare 502: ' + body.slice(0, 200));
    await shot(page, '4-returning-visitor-bare-502', 'a returning visitor, the edge unset (a bare 502): the service worker shows the one-moment page');
    await start(); await waitText(page, /About|Watermark/, 60000); await page.waitForFunction(() => document.body && !document.body.hasAttribute('data-wm-moment') && /About|Watermark/.test(document.body.innerText), null, { timeout: 60000 });
    await shot(page, '4b-back-by-itself', 'and back to /about by itself'); sw = 'proved';
    await ctx.close();
  } catch (e) { sw = 'failed: ' + e.message.split('\n')[0]; console.log(`[${ENGINE.name}] 4: ${sw}`); if (!ENGINE.webkit) throw e; }
  edgeMode = 'page';

  // 5. Scripts off: the page reads, Try again is a link, and it refreshes itself.
  ctx = await browser.newContext({ ...phone, javaScriptEnabled: false, serviceWorkers: 'block' }); page = await ctx.newPage(); await stop();
  await page.goto(`${E}/collection`); body = await page.locator('body').innerText(); assert.ok(/caught a cold/.test(body) && /every twenty seconds/.test(body), '5: scripts off');
  await shot(page, '5-scripts-off', 'scripts off: the same page, which refreshes itself every twenty seconds'); await ctx.close();
  // And at a desk's width.
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' }); page = await ctx.newPage();
  await page.goto(`${E}/w/${slugs[0]}`); await shot(page, '6-desk-one-moment', 'the one-moment page at a desk'); await ctx.close();

  await browser.close(); edge.close(); await stop(); fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync(path.join(shots, 'walk.json'), JSON.stringify({ engine: ENGINE.name, serviceWorker: sw, shots: said }, null, 2));
  console.log(`breaks walk (${ENGINE.name}): every break photographed in ${shots}; the service worker: ${sw}`);
  if (process.env.CI) console.log(`::notice title=breaks ${ENGINE.name}::passed; the service worker step: ${sw}. ` + said.map(x => `${x.name}: ${x.text.slice(0, 90)}`).join(' | ').slice(0, 1500).replace(/%/g, '%25'));
  process.exit(0);
})().catch(e => { console.log(`::error title=breaks ${ENGINE.name}::${String(e.message).slice(0, 900)}`); console.error(e); process.exit(1); });
