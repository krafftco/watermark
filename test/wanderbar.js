// The tab bar in Wander on a phone (#235; Will, 27 Nov: "why does the footer keep coming up"). In a real browser at a
// phone's size, with touch: the first screen shows the bar; arriving at the next picture does not bring it back; a
// still room has no bar and it cannot be pressed; one tap brings it back; another room keeps its bar.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { chromium, devices } = require('playwright');
const { createApp } = require('../src/app');
let dir;
(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-wanderbar-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'wanderbar', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('mk','Mira Kell','mk@example.com','maker',datetime('now'),'house')").run();
  const mk = db.prepare("SELECT * FROM makers WHERE handle='mk'").get();
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, `i${i}.jpg`);
    await sharp({ create: { width: i % 2 ? 1000 : 1600, height: i % 2 ? 1500 : 1000, channels: 3, background: { r: 40 + i * 30, g: 110, b: 190 - i * 25 } } }).jpeg().toFile(f);
    const w = await app.locals.registerWork({ file: f, title: `Frame ${i}`, place: 'Paris', originalName: `i${i}.jpg`, makerId: mk.id });
    db.prepare("UPDATE works SET status='held', stars=5, curated=1 WHERE slug=?").run(w.slug);
  }
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const bar = () => p.evaluate(() => { const b = document.querySelector('.tb'); if (!b) return null; const c = getComputedStyle(b); const r = b.getBoundingClientRect(); return { o: +c.opacity, pe: c.pointerEvents, shown: c.display !== 'none' && r.height > 0, cls: document.querySelector('main.st').className }; });
  await p.goto(base + '/wander', { waitUntil: 'load' }); await p.waitForTimeout(900);
  let b = await bar(); assert.ok(b && b.shown, 'Wander on a phone has the tab bar');
  assert.ok(b.o > 0.9, `the first screen shows the bar (opacity ${b.o}; ${b.cls})`);
  // On to the next picture: the bar stays away through the arrival and after it.
  await p.evaluate(() => { const s = document.querySelector('[data-st-scroll]'); s.scrollBy({ top: s.clientHeight, behavior: 'instant' }); });
  await p.waitForTimeout(1500);
  b = await bar(); assert.ok(/st-arr|st-still/.test(b.cls), `arrived at the next picture (${b.cls})`);
  assert.ok(b.o < 0.05 && b.pe === 'none', `the bar does not come back on arrival (opacity ${b.o}, ${b.pe}; ${b.cls})`);
  await p.waitForTimeout(3600);
  b = await bar(); assert.ok(/st-still/.test(b.cls), `the room goes still (${b.cls})`);
  assert.ok(b.o < 0.05 && b.pe === 'none', `a still room has no bar (opacity ${b.o}, ${b.pe})`);
  // One tap on the picture brings it back, and it can be pressed.
  const vp = devices['iPhone 13'].viewport; await p.touchscreen.tap(Math.round(vp.width / 2), Math.round(vp.height / 3)); await p.waitForTimeout(900);
  b = await bar(); assert.ok(b.o > 0.9 && b.pe !== 'none', `a tap brings the bar back (opacity ${b.o}, ${b.pe}; ${b.cls})`);
  // Another room keeps its bar.
  await p.goto(base + '/makers', { waitUntil: 'load' }); await p.waitForTimeout(400);
  const o = await p.evaluate(() => { const t = document.querySelector('.tb'); return t ? +getComputedStyle(t).opacity : -1; });
  assert.ok(o > 0.9, `another room keeps its bar (opacity ${o})`);
  assert.deepStrictEqual(errs, [], 'no page errors');
  await browser.close(); srv.close();
  console.log('ok: in Wander on a phone the tab bar keeps away until asked for');
})().catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } setTimeout(() => process.exit(), 50); });
