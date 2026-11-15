// The way back (issue #43; Will, 15 Nov: "every single delivery, every single turn must always lead someplace they can
// always get back"). In a real browser (Playwright's Chromium), with the installed app emulated, at a phone's size and an
// iPad's (portrait and landscape):
//   1. each known download pressed: the app's address does not change, and the device's share sheet (stubbed) or an
//      outside open (window.open, stubbed) was asked for; a door that answers "one moment" (429) is waited on and tried
//      again; a pressed link cannot be pressed twice while its file comes;
//   2. each bare page has a Back that is on screen, 44 by 44 at least, inside the safe area, covered by nothing and
//      covering none of the page's own controls (by box), and goes somewhere; pages with their own way back (the easel,
//      an album's photograph) keep theirs, on screen and uncovered, and get no second one;
//   3. the artist page: back to the hall, the artist before and after in the hall's order, by touch and by arrow keys;
//   4. the service worker: in the app, a navigation that lands on a file or a bare status answers the house's page with
//      a way back;
//   5. the same pages in a browser: a download is a download (nothing stubbed is asked for), a page with a header gets no
//      second Back.
// How the app is emulated: Chromium cannot be told display-mode standalone from here (the DevTools media feature is
// accepted and ignored), so an init script sets the test hook `window.__WM_APP = true` (and navigator.standalone), which
// the layout's first script, back.js and save.js read exactly as they read display-mode. CSS keys on html.wm-app, which
// that script sets before the body is drawn. Run alone: `npm run wayback` (CHROME=/path/to/chrome to use a system Chrome).
process.env.NODE_ENV = 'test';
const fs = require('fs'); const path = require('path'); const os = require('os'); const assert = require('assert');
const sharp = require('sharp');
const { chromium, devices } = require('playwright');
const { createApp } = require('../src/app');
const SHOTS = process.env.WAYBACK_SHOTS || '';

const SIZES = [['phone', devices['iPhone 13']], ['ipad-portrait', { ...devices['iPad Pro 11'], viewport: { width: 834, height: 1194 } }], ['ipad-landscape', { ...devices['iPad Pro 11 landscape'] }]];
let dir; const fails = []; let checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails.push(msg); console.log('FAIL ' + msg); } };

const APP_INIT = () => {
  window.__WM_APP = true; try { Object.defineProperty(navigator, 'standalone', { get: () => true }); } catch (e) { /* */ }
  window.__shared = []; window.__opened = [];
  navigator.canShare = () => true;
  navigator.share = d => { window.__shared.push((d.files || []).map(f => ({ name: f.name, type: f.type, size: f.size }))); return Promise.resolve(); };
  window.open = (u) => { window.__opened.push(String(u)); return {}; };
};
const BROWSER_INIT = () => { window.__shared = []; window.__opened = []; const s = navigator.share; navigator.share = d => { window.__shared.push(1); return s ? s.call(navigator, d) : Promise.resolve(); }; const o = window.open; window.open = (...a) => { window.__opened.push(String(a[0])); return o.apply(window, a); }; };

// The Back, measured: on screen, big enough, inside the safe area, covered by nothing, covering no control of the page.
const MEASURE = `(() => {
  const b = document.querySelector('.nv-float [data-nv-back]'); if (!b) return { none: true };
  const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
  const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const fr = [...document.querySelectorAll('.nv-float > *')].map(x => x.getBoundingClientRect()).filter(q => q.width > 0); // Back, and Share beside it in the app
  const ctl = [...document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.closest('.nv-float') && !el.closest('[hidden]') && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden')
    .map(el => [el, el.getBoundingClientRect()]).filter(([, q]) => q.width > 0 && q.height > 0)
    // A control counts as covered when the Back hides a quarter of it, or any of it if it is small (a picture that fills
    // the screen and is a link is not covered by a 44-pixel corner of it).
    .filter(([, q]) => fr.some(r => { const ix = Math.max(0, Math.min(q.right, r.right) - Math.max(q.left, r.left)), iy = Math.max(0, Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top)), a = ix * iy, qa = q.width * q.height; return a > 0 && (qa < 16 * 44 * 44 || a >= qa / 4); }))
    .map(([el]) => el.outerHTML.slice(0, 90));
  return { x: r.x, y: r.y, w: r.width, h: r.height, shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0, mine: !!(at && at.closest && at.closest('.nv-float')), covers: ctl, href: b.getAttribute('href'), name: b.getAttribute('aria-label') };
})()`;
const OWN = sel => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return null; const r = b.getBoundingClientRect(); const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { x: r.x, y: r.y, w: r.width, h: r.height, top: !!(at && (at === b || b.contains(at))), href: b.getAttribute('href'), floats: !!document.querySelector('.nv-float') }; })()`;

(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-wayback-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'wayback', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('mk','Mira Kell','mk@example.com','maker',datetime('now'),'house')").run();
  const mk = db.prepare("SELECT * FROM makers WHERE handle='mk'").get();
  const names = ['Claude Monet', 'Mary Cassatt', 'Paul Cezanne']; const slugs = [];
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, `i${i}.jpg`);
    await sharp({ create: { width: i % 2 ? 1000 : 1600, height: i % 2 ? 1500 : 1000, channels: 3, background: { r: 40 + i * 30, g: 110, b: 190 - i * 25 } } }).jpeg().toFile(f);
    const w = await app.locals.registerWork({ file: f, title: `Frame ${i}`, place: 'Paris', originalName: `i${i}.jpg`, makerId: mk.id });
    db.prepare("UPDATE works SET status='held', stars=5, curated=1 WHERE slug=?").run(w.slug); slugs.push(w.slug);
    if (i < 3) app.locals.art.link(db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug), names[i]);
  }
  // The hall's order: Cassatt, Cezanne, Monet (by sort_name).
  const near = app.locals.art.near(app.locals.art.bySlug('paul-cezanne'));
  ok(near.prev && near.prev.slug === 'mary-cassatt' && near.next && near.next.slug === 'claude-monet', `near(): Cezanne sits between Cassatt and Monet (${JSON.stringify(near)})`);
  const dv = db.prepare("INSERT INTO deliveries (token, maker_id, title, client_name) VALUES ('wbtok', ?, 'A day in Paris', 'Rae')").run(mk.id).lastInsertRowid;
  slugs.slice(0, 3).forEach((s, i) => db.prepare('INSERT INTO delivery_works (delivery_id, work_id, pos, ref) VALUES (?,?,?,?)').run(dv, db.prepare('SELECT id FROM works WHERE slug=?').get(s).id, i, 'r' + i));

  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const open = async (ctx, p) => { const page = await ctx.newPage(); const r = await page.goto(base + p, { waitUntil: 'load' }); await page.waitForTimeout(250); return [page, r]; };

  // ---- 1. Downloads in the app ----
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] }); await ctx.addInitScript(APP_INIT);
    await ctx.addCookies([{ name: 'wm_in', value: '1', url: base }]);
    // The files the house hands over, as its own pages link them: each kind of link, set on a page of the house.
    const files = [
      [`/deliver/wbtok/${slugs[0]}/file`, 'download', 'share'], // an album's photograph
      [`/deliver/wbtok/${slugs[0]}/file?full=1`, 'download', 'share'], // full size
      ['/deliver/wbtok/all.zip', '', 'outside'], // the whole album
      [`/w/${slugs[1]}/placard.jpg?dl=1`, 'download', 'share'], // the placard
      [`/w/${slugs[1]}/post.jpg?dl=1`, 'download', 'share'], // an Instagram card
      [`/w/${slugs[1]}/story.jpg?dl=1`, 'download', 'share'],
      ['/release/model.pdf', '', 'share'], // a PDF
      ['/hang/1/sales.csv', '', 'outside'], // a table: only another program opens it
    ];
    // An album's file is made from its licence row, which this house does not set up: its answer is stood in for (what is
    // under test is the press in the app, not the album's file, which test/smoke.js proves).
    const JPEG = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#357' } }).jpeg().toBuffer();
    await ctx.route(/\/deliver\/wbtok\/[^/]+\/file/, route => route.fulfill({ status: 200, headers: { 'content-type': 'image/jpeg', 'content-disposition': `attachment; filename="Frame 0, Mira Kell.jpg"` }, body: JPEG }));
    const [page] = await open(ctx, '/collection');
    for (const [href, dl, want] of files) {
      const before = page.url();
      await page.evaluate(([h, d]) => { window.__shared = []; window.__opened = []; document.querySelectorAll('[data-wb-t]').forEach(x => x.remove()); const a = document.createElement('a'); a.href = h; if (d) a.setAttribute('download', ''); a.textContent = 'Take it'; a.setAttribute('data-wb-t', ''); a.style.cssText = 'position:fixed;left:120px;top:300px;z-index:9999;padding:12px;background:#fff'; document.body.appendChild(a); const sv = document.querySelector('.sv'); if (sv) sv.hidden = true; }, [href, dl]);
      await page.click('[data-wb-t]');
      await page.waitForFunction(() => window.__shared.length || window.__opened.length || (document.querySelector('.sv-l') && /could not|used|outside/.test(document.querySelector('.sv-l').textContent)), null, { timeout: 8000 }).catch(() => {});
      const got = await page.evaluate(() => ({ shared: window.__shared, opened: window.__opened, line: (document.querySelector('.sv-l') || {}).textContent || '' }));
      ok(page.url() === before, `app: ${href} left the app's address alone (now ${page.url()})`);
      if (want === 'share') ok(got.shared.length === 1 && got.shared[0][0] && got.shared[0][0].size > 0, `app: ${href} went to the share sheet (${JSON.stringify(got)})`);
      else ok(got.opened.length === 1 && got.opened[0].includes(href.split('?')[0]) && !got.shared.length, `app: ${href} opened outside the app (${JSON.stringify(got)})`);
    }
    // The real pages: an album's photograph (Download, Full size) and the album (Download all).
    {
      const [p2] = await open(ctx, `/deliver/wbtok/${slugs[0]}`); const before = p2.url();
      const a = p2.locator(`a[href$="/${slugs[0]}/file"]`).first(); ok(await a.count() === 1, 'album photograph: a Download link');
      await a.click(); await p2.waitForFunction(() => window.__shared.length, null, { timeout: 8000 }).catch(() => {});
      const sh = await p2.evaluate(() => window.__shared);
      ok(p2.url() === before && sh.length === 1 && /\.jpe?g$/i.test(sh[0][0].name), `album photograph: Download → share sheet, a named file (${JSON.stringify(sh)})`);
      await p2.close();
      const [p3] = await open(ctx, '/deliver/wbtok'); const b3 = p3.url(); const z = p3.locator('a[href$="/all.zip"]').first();
      if (await z.count()) { await z.click(); await p3.waitForTimeout(300); const op = await p3.evaluate(() => window.__opened); ok(p3.url() === b3 && op.length === 1, `album: all.zip opened outside (${JSON.stringify(op)})`); } else ok(false, 'album: an all.zip link');
      await p3.close();
    }
    // The heavy door's "one moment": waited on, said quietly, tried again; pressed twice, fetched once.
    {
      let n = 0; const u = `/w/${slugs[2]}/placard.jpg?dl=1`;
      await page.route('**/placard.jpg?dl=1', async route => { n++; if (n === 1) return route.fulfill({ status: 429, headers: { 'Retry-After': '1', 'content-type': 'text/plain' }, body: 'One moment' }); return route.continue(); });
      await page.evaluate(h => { window.__shared = []; document.querySelectorAll('[data-wb-t]').forEach(x => x.remove()); const a = document.createElement('a'); a.href = h; a.setAttribute('download', ''); a.textContent = 'Take it'; a.setAttribute('data-wb-t', ''); a.style.cssText = 'position:fixed;left:120px;top:300px;z-index:9999;padding:12px;background:#fff'; document.body.appendChild(a); const sv = document.querySelector('.sv'); if (sv) sv.hidden = true; }, u);
      await page.click('[data-wb-t]');
      const busy = await page.evaluate(() => document.querySelector('[data-wb-t]').getAttribute('aria-busy'));
      await page.evaluate(() => document.querySelector('[data-wb-t]').click()); // a second press while it comes
      await page.waitForFunction(() => /One moment/.test((document.querySelector('.sv-l') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
      const said = await page.evaluate(() => document.querySelector('.sv-l').textContent);
      await page.waitForFunction(() => window.__shared.length, null, { timeout: 10000 }).catch(() => {});
      const sh = await page.evaluate(() => window.__shared.length);
      ok(busy === 'true', 'app: the pressed link says it is busy (aria-busy)');
      ok(/One moment/.test(said), `app: the waiting door is said quietly (${said})`);
      ok(n === 2 && sh === 1, `app: tried again as the house asked, once per press (fetches ${n}, shares ${sh})`);
      await page.unroute('**/placard.jpg?dl=1');
    }
    // A door that answers a page (a cold link is sent to the page the button is on): the app goes to that page.
    {
      await page.route('**/open/*/take', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>The work</title><p>The page the button is on' }));
      await page.evaluate(h => { window.__shared = []; window.__opened = []; document.querySelectorAll('[data-wb-t]').forEach(x => x.remove()); const a = document.createElement('a'); a.href = h; a.textContent = 'Take it'; a.setAttribute('data-wb-t', ''); a.style.cssText = 'position:fixed;left:120px;top:300px;z-index:9999;padding:12px;background:#fff'; document.body.appendChild(a); const sv = document.querySelector('.sv'); if (sv) sv.hidden = true; }, `/open/${slugs[0]}/take`);
      await Promise.all([page.waitForURL(/\/open\/.*\/take/, { timeout: 5000 }).catch(() => {}), page.click('[data-wb-t]')]);
      ok(/\/open\/.*\/take/.test(page.url()), `app: a page answered for a file is followed as a page, never shared (${page.url()})`);
    }
    await ctx.close();
  }

  // ---- 2 and 3. Bare pages and the artist page, in the app and in a browser, at three sizes ----
  const bare = ['/art/paul-cezanne', '/art/paul-cezanne?q=frame', '/@mk', '/deliver/wbtok', '/vangogh', '/i/none'];
  const own = [[`/easel/${slugs[0]}`, '.ez-back'], [`/deliver/wbtok/${slugs[0]}`, '.dv-back'], ['/wander', '.st-home'], ['/wander/room', '.vr-home'], ['/vr', '.xr-home'], [`/w/${slugs[0]}/frame`, '.fz-x']];
  for (const mode of ['app', 'browser']) {
    for (const [size, dev] of SIZES) {
      const ctx = await browser.newContext({ ...dev }); await ctx.addInitScript(mode === 'app' ? APP_INIT : BROWSER_INIT);
      for (const p of bare) {
        const [page, r] = await open(ctx, p);
        if (!r || !/text\/html/.test(r.headers()['content-type'] || '') || !(await page.evaluate(() => document.body.classList.contains('bare')))) { await page.close(); continue; }
        const m = await page.evaluate(MEASURE); const tag = `${mode} ${size} ${p}`;
        ok(!m.none && m.shown, `${tag}: a Back is on the page and shown`);
        if (m.none) { await page.close(); continue; }
        const vp = page.viewportSize();
        ok(m.x >= 0 && m.y >= 0 && m.x + m.w <= vp.width && m.y + m.h <= vp.height, `${tag}: the Back is on screen (${m.x},${m.y})`);
        ok(m.w >= 44 && m.h >= 44, `${tag}: the Back is 44 by 44 at least (${m.w}×${m.h})`);
        ok(m.mine, `${tag}: nothing covers the Back`);
        ok(!m.covers.length, `${tag}: the Back covers none of the page's controls (${m.covers.join(' | ')})`);
        ok(m.name === 'Back' && m.href && m.href !== p, `${tag}: the Back is named Back and goes somewhere (${m.href})`);
        if (size === 'phone') {
          await Promise.all([page.waitForURL(u => u.toString() !== base + p, { timeout: 4000 }).catch(() => {}), page.click('.nv-float [data-nv-back]')]);
          ok(page.url() !== base + p, `${tag}: pressing Back went somewhere (${page.url()})`);
        }
        if (SHOTS && mode === 'app' && (p === '/art/paul-cezanne' || p === '/@mk') && size !== 'ipad-landscape') { const [s2] = await open(ctx, p); await s2.screenshot({ path: path.join(SHOTS, `${size}-${p.replace(/\W+/g, '_')}.png`) }); await s2.close(); }
        await page.close();
      }
      for (const [p, sel] of own) {
        const [page] = await open(ctx, p); const o = await page.evaluate(OWN(sel)); const tag = `${mode} ${size} ${p}`; const vp = page.viewportSize();
        if (!o && new URL(page.url()).pathname !== p.split('?')[0]) { await page.close(); continue; } // sent on to another room (a phone's viewing room is Wander), checked there
        ok(o && o.w > 0 && o.x >= 0 && o.y >= 0 && o.x + o.w <= vp.width && o.y + o.h <= vp.height, `${tag}: its own way back (${sel}) is on screen ${JSON.stringify(o)}`);
        ok(o && o.top, `${tag}: nothing covers its own way back`);
        ok(o && o.href && o.href !== p, `${tag}: its own way back goes somewhere`);
        ok(o && !o.floats, `${tag}: no second Back laid over it`);
        await page.close();
      }
      // The artist page: the hall, the artist before and after.
      {
        const [page] = await open(ctx, '/art/paul-cezanne'); const tag = `${mode} ${size} artist`;
        const nav = await page.evaluate(() => { const n = document.querySelector('[data-apw-keys]'); if (!n) return null; const g = s => { const a = n.querySelector(s); if (!a) return null; const r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), w: r.width, h: r.height, x: r.x, y: r.y }; }; return { hall: g('.apw-hall'), prev: g('[data-apw="prev"]'), next: g('[data-apw="next"]'), ends: document.querySelectorAll('.apw').length }; });
        ok(nav && nav.hall && nav.hall.href === '/art', `${tag}: a way back to the hall`);
        ok(nav && nav.prev && nav.prev.href === '/art/mary-cassatt' && nav.next && nav.next.href === '/art/claude-monet', `${tag}: previous and next in the hall's order ${JSON.stringify(nav)}`);
        ok(nav && [nav.hall, nav.prev, nav.next].every(x => x && x.h >= 44 && x.w >= 44), `${tag}: each is 44 by 44 at least`);
        ok(nav && nav.ends === 2, `${tag}: at the top and again at the foot`);
        const fb = await page.evaluate(() => { const b = document.querySelector('.nv-float [data-nv-back]'); return b ? b.getBoundingClientRect().toJSON() : null; });
        ok(fb && nav && [nav.hall, nav.prev, nav.next].every(x => x.x >= fb.right || x.y >= fb.bottom || x.x + x.w <= fb.left || x.y + x.h <= fb.top), `${tag}: the hall's row clear of the Back`);
        await page.keyboard.press('ArrowRight'); await page.waitForURL(/claude-monet/, { timeout: 4000 }).catch(() => {});
        ok(/\/art\/claude-monet$/.test(page.url()), `${tag}: → goes to the next artist (${page.url()})`);
        const last = await page.evaluate(() => ({ next: !!document.querySelector('[data-apw-keys] [data-apw="next"]'), prev: (document.querySelector('[data-apw-keys] [data-apw="prev"]') || {}).getAttribute && document.querySelector('[data-apw-keys] [data-apw="prev"]').getAttribute('href') }));
        ok(!last.next && last.prev === '/art/paul-cezanne', `${tag}: the last artist has no next, and its previous is the one before ${JSON.stringify(last)}`);
        await page.keyboard.press('ArrowLeft'); await page.waitForURL(/paul-cezanne/, { timeout: 4000 }).catch(() => {});
        ok(/\/art\/paul-cezanne$/.test(page.url()), `${tag}: ← goes to the previous artist`);
        if (dev.hasTouch) { await Promise.all([page.waitForURL(/mary-cassatt/, { timeout: 4000 }).catch(() => {}), page.tap('[data-apw-keys] [data-apw="prev"]')]); ok(/mary-cassatt/.test(page.url()), `${tag}: a tap on previous goes there`); }
        const was = page.url(); await page.focus('.apl-find input'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
        ok(page.url() === was, `${tag}: arrows in the find field stay in the field`);
        await page.close();
      }
      if (mode === 'browser') {
        // A page with the house's header gets no second Back; a download in a browser is a download.
        const [page] = await open(ctx, '/collection');
        ok(!(await page.evaluate(() => !!document.querySelector('.nv-float'))), `browser ${size}: /collection has its header and no floating Back`);
        if (size === 'ipad-landscape') {
          await page.evaluate(h => { const a = document.createElement('a'); a.href = h; a.setAttribute('download', ''); a.textContent = 'Take it'; a.setAttribute('data-wb-t', ''); a.style.cssText = 'position:fixed;left:120px;top:300px;z-index:9999;padding:12px;background:#fff'; document.body.appendChild(a); }, `/deliver/wbtok/${slugs[0]}/file`);
          const [d] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), page.click('[data-wb-t]')]);
          const asked = await page.evaluate(() => window.__shared.length + window.__opened.length);
          ok(d && asked === 0, `browser: a download is a download, unchanged (download ${!!d}, share/open asked ${asked})`);
        }
        await page.close();
      }
      await ctx.close();
    }
  }

  // ---- 4. The service worker: in the app, a file or a bare status as a page is the house's page with a way back ----
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow' }); await ctx.addInitScript(APP_INIT);
    const [page] = await open(ctx, '/collection');
    await page.evaluate(() => navigator.serviceWorker.ready.then(g => new Promise(res => { const go = () => { (navigator.serviceWorker.controller || g.active).postMessage({ wm: 'app' }); res(); }; if (navigator.serviceWorker.controller) go(); else navigator.serviceWorker.addEventListener('controllerchange', go, { once: true }); setTimeout(go, 3000); })));
    await page.reload(); await page.waitForTimeout(400);
    ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'sw: the worker holds the page');
    for (const [p, kind] of [[`/w/${slugs[0]}/placard.jpg`, 'file'], ['/deliver/nothing-here/x/file', 'error']]) {
      const r = await page.goto(base + p).catch(e => ({ err: e.message })); await page.waitForTimeout(250);
      const h = r && r.headers ? r.headers() : {};
      const back = await page.evaluate(MEASURE).catch(() => ({ none: true }));
      ok(h['x-wm-landing'] === kind, `sw: ${p} in the app answered the house's page (${kind}; got ${JSON.stringify(h['x-wm-landing'] || (r && r.err) || h['content-type'])})`);
      ok(!back.none && back.shown && back.mine && back.w >= 44, `sw: ${p}: the house's page has a Back on screen`);
      if (kind === 'file') ok(await page.evaluate(() => !!document.querySelector('a[download][href*="wm_take=1"]')), `sw: ${p}: a way to take the file`);
    }
    const [r2] = await Promise.all([page.waitForURL(u => !/placard|nothing-here/.test(u.toString()), { timeout: 4000 }).catch(() => null), page.click('.nv-float [data-nv-back]')]);
    ok(!/nothing-here/.test(page.url()), `sw: Back from the error page went somewhere (${page.url()})`);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log(`${checks - fails.length} of ${checks} checks hold`);
  if (fails.length) { console.log(`::error title=wayback::${fails.length} failed: ${fails.slice(0, 12).join(' || ').replace(/%/g, '%25').replace(/\n/g, ' ')}`); process.exitCode = 1; }
  else console.log('ok: the way back holds (downloads, bare pages, the artist page, the worker)');
})().catch(e => { console.error(e); console.log('::error title=wayback::' + String(e && e.message || e).slice(0, 400)); process.exitCode = 1; })
  .finally(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } setTimeout(() => process.exit(), 50); });
