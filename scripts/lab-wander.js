// TEMPORARY (#109 lab, removed before merge): Wander's side tabs on an iPad (gen 7), sampled every 50 ms through the
// walk's own turn, in WebKit. Prints notices for CI.
process.env.NODE_ENV = 'test';
const { spawn } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
const ENGINE = require('./engine'); ENGINE.guard('lab');
(async () => {
  const hold = path.join(os.tmpdir(), 'lab-hold-' + process.pid + '.json');
  const house = spawn(process.execPath, [path.join(__dirname, 'reach-walk.js')], { env: { ...process.env, REACH_HOLD: hold, WM_ENGINE: 'chromium' }, stdio: 'ignore' });
  for (let i = 0; i < 120 && !fs.existsSync(hold); i++) await new Promise(r => setTimeout(r, 500));
  const H = JSON.parse(fs.readFileSync(hold, 'utf8'));
  const browser = await ENGINE.launch(); const d = ENGINE.devices['iPad (gen 7)'];
  const out = [];
  for (let run = 0; run < 6; run++) {
    const ctx = await browser.newContext({ viewport: d.viewport, userAgent: d.userAgent, hasTouch: true, isMobile: true, deviceScaleFactor: d.deviceScaleFactor, screen: d.screen, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { try { localStorage.setItem('wm_toured', '1'); } catch (e) {} });
    const page = await ctx.newPage(); await page.goto(H.base + '/wander', { waitUntil: 'load' }); await page.waitForTimeout(400 + run * 300);
    await page.setViewportSize({ width: d.viewport.height, height: d.viewport.width }); await page.waitForTimeout(120);
    await page.setViewportSize(d.viewport);
    const s = await page.evaluate(() => new Promise(res => { const rows = []; const t0 = performance.now(); const f = () => { const t = document.querySelector('.st-tab-l'), m = document.querySelector('main'); const c = t && getComputedStyle(t);
      const a = t ? t.getAnimations().filter(x => x.playState === 'running').map(x => x.transitionProperty + ':' + Math.round(x.currentTime)).join('+') : '';
      rows.push(`${Math.round(performance.now() - t0)} ${m ? m.className.replace(/\bst\b/, '').trim() : '-'} op${c ? (+c.opacity).toFixed(2) : '-'} pe${c ? c.pointerEvents : '-'} ${c ? c.visibility : '-'} ${a}`);
      if (performance.now() - t0 < 3000) setTimeout(f, 50); else res(rows); }; f(); }));
    // compress: keep rows whose state changed
    const keep = []; let last = ''; for (const r of s) { const st = r.replace(/^\d+ /, '').replace(/:\d+/g, ''); if (st !== last) keep.push(r); last = st; }
    out.push(`run ${run}: ` + keep.join(' | '));
    await ctx.close();
  }
  for (const o of out) console.log(`::notice title=lab wander::${o.slice(0, 1400).replace(/%/g, '%25')}`);
  console.log(out.join('\n'));
  await browser.close(); house.kill(); process.exit(0);
})().catch(e => { console.log('::warning title=lab wander::' + String(e.message).slice(0, 500)); process.exit(0); });
