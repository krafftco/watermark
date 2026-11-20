// TEMPORARY (#109 lab, removed before merge): does a side tab come back after its fade-out is cut short? Wander's
// chrome is put away (st-still) and woken again (quiet) at points through the 0.4 s fade; the tab is sampled after.
process.env.NODE_ENV = 'test';
const { spawn } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path');
const ENGINE = require('./engine'); ENGINE.guard('lab');
(async () => {
  const hold = path.join(os.tmpdir(), 'lab-hold-' + process.pid + '.json');
  const house = spawn(process.execPath, [path.join(__dirname, 'reach-walk.js')], { env: { ...process.env, REACH_HOLD: hold, WM_ENGINE: 'chromium' }, stdio: 'ignore' });
  for (let i = 0; i < 120 && !fs.existsSync(hold); i++) await new Promise(r => setTimeout(r, 500));
  const H = JSON.parse(fs.readFileSync(hold, 'utf8'));
  const browser = ENGINE.webkit ? await ENGINE.launch() : await require('playwright').chromium.launch({ channel: 'chrome' });
  const d = ENGINE.devices['iPad (gen 7)'];
  const ctx = await browser.newContext({ viewport: d.viewport, userAgent: d.userAgent, hasTouch: true, isMobile: !ENGINE.webkit ? true : true, deviceScaleFactor: d.deviceScaleFactor, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('wm_toured', '1'); } catch (e) {} });
  const page = await ctx.newPage(); await page.goto(H.base + '/wander', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  const out = [];
  for (const cut of [50, 150, 250, 330, 360, 380, 395, 420]) {
    const r = await page.evaluate(cut => new Promise(res => {
      const root = document.querySelector('.st'), t = document.querySelector('.st-tab-l'); const cs = () => getComputedStyle(t);
      root.classList.remove('st-still', 'st-rest', 'st-arr'); setTimeout(() => {
        const before = +cs().opacity; root.classList.add('st-still');
        setTimeout(() => { const at = +cs().opacity; root.classList.remove('st-still');
          setTimeout(() => { const c = cs(); res({ cut, before, at, after: +(+c.opacity).toFixed(3), pe: c.pointerEvents, vis: c.visibility, running: t.getAnimations().map(a => a.playState).join(',') }); }, 1200); }, cut);
      }, 900);
    }), cut);
    out.push(`cut ${r.cut}ms: at ${r.at.toFixed(3)} → after 1.2 s op ${r.after} pe ${r.pe} ${r.vis} [${r.running}]`);
  }
  const msg = `${ENGINE.name}: ` + out.join(' | ');
  console.log(msg); if (process.env.CI) console.log(`::notice title=lab tabs ${ENGINE.name}::${msg.slice(0, 1400)}`);
  await browser.close(); house.kill(); process.exit(0);
})().catch(e => { console.log('::warning title=lab tabs::' + String(e.message).slice(0, 500)); console.error(e); process.exit(0); });
