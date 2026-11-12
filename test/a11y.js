// The checker (issue #4; Will, 11 Nov: "make sure that the website is ADA accessible"). axe-core runs in a real
// browser (Playwright's Chromium) over the house's main public doors at a phone's size and a desk's, and over the
// signed-in doors (a maker's studio, the Studio), against WCAG 2.0/2.1 A and AA. Any fault of impact serious or
// critical fails the run, named by page, rule and element. Run alone: `npm run a11y` (not in `npm test`: it needs a
// browser). In CI it is its own job; a failure is raised as an annotation, since CI's logs cannot be read from here.
process.env.NODE_ENV = 'test';
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { chromium, devices } = require('playwright');
const { createApp } = require('../src/app');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const FAIL = new Set(['serious', 'critical']);
// Exclusions: each a rule (or rule + selector) with its reason and the issue that will lift it. Empty by design.
const EXCLUDE = [
  // { rule: 'color-contrast', selector: '.example', why: 'one line', issue: 0 },
];
const SETTLE_MS = 700;

let dir;
(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-a11y-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'a11y', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('mk','Mira Kell','mk@example.com','maker',datetime('now'),'house')").run();
  const mk = db.prepare("SELECT * FROM makers WHERE handle='mk'").get();
  let slug;
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, `i${i}.jpg`);
    await sharp({ create: { width: i % 2 ? 1000 : 1600, height: i % 2 ? 1500 : 1000, channels: 3, background: { r: 40 + i * 30, g: 110, b: 190 - i * 25 } } }).jpeg().toFile(f);
    const w = await app.locals.registerWork({ file: f, title: `Frame ${i}`, place: 'Paris', originalName: `i${i}.jpg`, makerId: mk.id });
    db.prepare("UPDATE works SET status='held', stars=5, curated=1 WHERE slug=?").run(w.slug); slug = w.slug;
  }
  // The maker signs in as anyone does (the code), the Studio by its password.
  const cookiesOf = r => (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(c => { const kv = c.split(';')[0]; const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: base }; });
  const post = (p, body, json) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { origin: base, 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded' }, body: json ? JSON.stringify(body) : new URLSearchParams(body).toString() });
  await post('/signin/code', { email: 'mk@example.com' }, true);
  const makerCookies = cookiesOf(await post('/signin/verify', { email: 'mk@example.com', code: app.locals.lastCode.code }, true));
  const studioCookies = cookiesOf(await post('/studio/login', { password: 'pw' }));
  if (!makerCookies.length || !studioCookies.length) throw new Error('could not sign in the maker or the Studio');

  const pub = ['/', '/wander', '/house', '/w/' + slug, '/look', '/find?q=frame', '/makers', '/join', '/signin', '/collection', '/yours', '/library', '/about', '/terms', '/privacy', '/m/' + mk.handle, '/license/' + slug, '/feedback', '/everything', '/keys', '/public-domain', '/registry', '/basket'];
  const maker = ['/account', '/account/table', '/account/cull', '/account/upload', '/account/profile', '/account/prices', '/account/payouts'];
  const studio = ['/studio'];
  const runs = [];
  for (const [size, dev] of [['phone', devices['iPhone 13']], ['desk', { viewport: { width: 1440, height: 900 } }]]) {
    runs.push([size, dev, pub, null], [size, dev, maker, makerCookies], [size, dev, studio, studioCookies]);
  }

  const browser = await chromium.launch();
  const found = []; let pages = 0;
  const scan = async page => {
    await page.addScriptTag({ content: AXE });
    return page.evaluate(tags => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  };
  for (const [size, dev, list, cookies] of runs) {
    const ctx = await browser.newContext({ ...dev }); if (cookies) await ctx.addCookies(cookies);
    for (const p of list) {
      const page = await ctx.newPage();
      const resp = await page.goto(base + p, { waitUntil: 'load' });
      if (!resp || resp.status() >= 400) { found.push({ where: `${size} ${p}`, rule: 'status', impact: 'critical', html: `answered ${resp ? resp.status() : 'nothing'}` }); await page.close(); continue; }
      // A signed-in door that sent us to sign in was not checked: that is a fault of the test, said as one.
      if (cookies && /\/signin|\/studio\/(door|login)/.test(new URL(page.url()).pathname)) throw new Error(`${p} sent the signed-in visitor to ${page.url()}`);
      // Pictures are hidden until loaded (class ld) and some rooms fade in: wait for every picture, then settle.
      await page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(SETTLE_MS);
      // A fault seen twice, a moment apart, is a fault; one seen once was a frame of an animation.
      const a = await scan(page); await page.waitForTimeout(a.violations.length ? 1200 : 0);
      const b = a.violations.length ? await scan(page) : a;
      const again = new Set(b.violations.flatMap(v => v.nodes.map(n => v.id + '|' + n.target.join(' '))));
      for (const v of a.violations) {
        if (!FAIL.has(v.impact)) continue;
        for (const n of v.nodes) {
          const key = v.id + '|' + n.target.join(' ');
          if (!again.has(key)) continue;
          if (EXCLUDE.some(x => x.rule === v.id && (!x.selector || n.target.join(' ').includes(x.selector)))) continue;
          const d = (n.any[0] && n.any[0].data) || {};
          found.push({ where: `${size} ${p}`, rule: v.id, impact: v.impact, html: n.html.slice(0, 160), contrast: d.contrastRatio ? `${d.contrastRatio}:1 (needs ${d.expectedContrastRatio}) ${d.fgColor} on ${d.bgColor}` : '' });
        }
      }
      pages++; await page.close();
    }
    await ctx.close();
  }
  await browser.close(); srv.close();
  if (found.length) {
    const lines = found.map(f => `${f.where} · ${f.rule} (${f.impact})${f.contrast ? ' · ' + f.contrast : ''} · ${f.html}`);
    console.error(`a11y: ${found.length} serious or critical over ${pages} pages\n` + lines.join('\n'));
    if (process.env.GITHUB_ACTIONS) {
      const msg = `${found.length} serious or critical\n${lines.join('\n')}`.slice(0, 1500).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
      console.log(`::error title=a11y::${msg}`);
    }
    done(1);
  }
  console.log(`a11y: ${pages} pages, 0 serious`); done(0);
})().catch(e => {
  console.error(e.stack || e);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=a11y::${String(e.stack || e).slice(0, 1500).replace(/%/g, '%25').replace(/\n/g, '%0A')}`);
  done(1);
});
function done(code) { try { if (dir) fs.rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(code); }
