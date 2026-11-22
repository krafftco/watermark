// An album in Wander (PR #200; Will, 22 Nov: "Wander is the way we want people to thumb through the albums, but we still
// want people to favourite, like, print, etc."; and "an album should play from the earliest photograph to the latest,
// so a night is seen in the order it happened"). In a real browser (Playwright's Chromium; CHROME=/path to use a system
// Chrome), at a phone's size and a desk's:
//   1. the order: an album made latest-first (the picker's order) shows earliest first on the album page, in the film's
//      list, in Wander and in Wander's feed; one taken at the same second is read by its file's number (IMG_9 before
//      IMG_10); an undated photograph comes last; the album's own rows (pos) are not rewritten;
//   2. a member of a group album presses a photograph on the album page and lands in Wander at it; the heart given there
//      is the album's (the album page shows it, and its count, when they come back); Download hands over the file;
//      Story hands the credited 9:16 copy to the phone's sheet (stubbed); Keep it keeps it (a licence, the thanks page);
//      the way back lands on the album at that photograph; nothing the rules forbid is offered (no Full size, Print,
//      Message or Instax for this member); Esc goes back to the album, not the collection;
//   3. the client's own link carries Print, Full size and Instax; the open Wander carries none of the album's acts;
//   4. a stranger to the group album is refused with the house's own door (no picture), and cannot heart it.
// SHOTS=<dir> keeps screenshots.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto'); const sharp = require('sharp');
const { chromium, devices } = require('playwright');
const { createApp } = require('../src/app');
const SHOTS = process.env.SHOTS || '';
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-albumwander-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'albumwander', noTimers: true, vaultNow: true });
  const { db } = app.locals; const CP = app.locals.copies;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const say = (...a) => console.log('albumwander:', ...a);
  const fails = []; const ok = (c, m) => { if (!c) { fails.push(m); console.log('FAIL ' + m); } };

  // A photographer, six photographs. Titles are the camera's names; taken_at set as a night: IMG_7 at 21:00 … the last
  // at 23:30; IMG_9 and IMG_10 at the same second (the file's number decides); IMG_12 carries no date.
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  await form(studio, '/studio/accounts', { name: 'Ada Lens', email: 'ada@example.com' });
  const invite = (app.locals.mailLog || []).find(m => m.to === 'ada@example.com' && /invitation/i.test(m.subject)); assert.ok(invite, 'the invitation');
  const ada = {}; await go(ada, (invite.text.match(/http:\/\/localhost(\/account\/join\/[\w-]+)/) || [])[1]);
  const M = db.prepare("SELECT * FROM makers WHERE email='ada@example.com'").get(); assert.ok(M && M.joined_at, 'Ada has joined');
  const night = [['IMG_7', '2026-11-21T21:00:00.000Z'], ['IMG_8', '2026-11-21T21:40:00.000Z'], ['IMG_10', '2026-11-21T22:15:00.000Z'], ['IMG_9', '2026-11-21T22:15:00.000Z'], ['IMG_11', '2026-11-21T23:30:00.000Z'], ['IMG_12', null]];
  const ws = {};
  for (let k = 0; k < night.length; k++) {
    const [t, at] = night[k]; const f = path.join(dir, `${t}.jpg`);
    await sharp({ create: { width: 1800, height: k % 2 ? 1200 : 2400, channels: 3, noise: { type: 'gaussian', mean: 80 + k * 18, sigma: 45 } } }).jpeg({ quality: 85 }).toFile(f);
    const w = await app.locals.registerWork({ file: f, title: t, makerId: M.id, originalName: `${t}.jpg` });
    db.prepare("UPDATE works SET taken_at=?, status='hidden' WHERE id=?").run(at, w.id); ws[t] = db.prepare('SELECT * FROM works WHERE id=?').get(w.id);
  }
  for (let i = 0; i < 20; i++) if (!(await CP.one())) break; // the copies, as the scribes make them
  const want = ['IMG_7', 'IMG_8', 'IMG_9', 'IMG_10', 'IMG_11', 'IMG_12'].map(t => ws[t].slug);
  // Made in the picker's order (newest upload first), as albums were: the latest first.
  let r; const made = new URLSearchParams(); for (const [k, v] of Object.entries({ title: 'The thirty-first', client: 'Ani', door: 'join', days: '30', size: 'original' })) made.append(k, v); want.slice().reverse().forEach(s => made.append('works', s));
  r = await go(ada, '/account/deliveries', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: made.toString() }); assert.equal(r.status, 302, 'the album is made');
  const d = db.prepare('SELECT * FROM deliveries WHERE maker_id=? ORDER BY id DESC LIMIT 1').get(M.id);
  const posOrder = db.prepare('SELECT w.slug FROM delivery_works dw JOIN works w ON w.id=dw.work_id WHERE dw.delivery_id=? ORDER BY dw.pos').all(d.id).map(x => x.slug);
  assert.deepEqual(posOrder, want.slice().reverse(), 'made latest first (pos)');
  // The group's rules: copies, keep, post, ask, the bench; no full files, no passing on.
  await form(ada, `/account/deliveries/${d.id}/door`, { door: 'join', r_download: '1', r_keep: '1', r_social: '1', r_ask: '1', r_speak: '1' });
  await (await go(ada, `/account/deliveries/${d.id}`)).text(); // the group's address is made when the album's page is first drawn
  const sh = db.prepare('SELECT share_token FROM deliveries WHERE id=?').get(d.id).share_token;
  assert.ok(sh, 'the group’s address');

  // 1. The order, everywhere, without the album being remade.
  const client = {}; let html = await (await go(client, `/deliver/${d.token}`)).text();
  const grid = [...html.matchAll(/<figure class="dv-w" id="p-([^"]+)" data-dv-slug="([^"]+)"/g)].map(m => m[2]);
  ok(JSON.stringify(grid) === JSON.stringify(want), 'the album page reads earliest first: ' + grid.join(','));
  const film = JSON.parse(html.match(/window\.__DV=(\{.*?\});<\/script>/)[1].replace(/\\u003c/g, '<')).list.map(x => x.s);
  ok(JSON.stringify(film) === JSON.stringify(want), 'the film plays earliest first: ' + film.join(','));
  html = await (await go(client, `/wander?in=delivery:${d.token}`)).text();
  const first = JSON.parse(html.match(/window\.__WM_STROLL=(\{.*?\});<\/script>/)[1].replace(/\\u003c/g, '<'));
  ok(JSON.stringify(first.items.map(x => x.slug)) === JSON.stringify(want), 'Wander opens on the earliest and walks on in order: ' + first.items.map(x => x.slug).join(','));
  const feed = await (await go(client, `/api/stroll?in=delivery:${d.token}&n=8&seen=${want[0]},${want[1]}`)).json();
  ok(JSON.stringify(feed.items.map(x => x.slug)) === JSON.stringify(want.slice(2)), 'Wander’s feed carries on in order: ' + feed.items.map(x => x.slug).join(','));
  ok(JSON.stringify(db.prepare('SELECT w.slug FROM delivery_works dw JOIN works w ON w.id=dw.work_id WHERE dw.delivery_id=? ORDER BY dw.pos').all(d.id).map(x => x.slug)) === JSON.stringify(posOrder), 'the album’s rows are not rewritten');
  say('1. an album made latest first reads earliest first: the page, the film, Wander and its feed; IMG_9 before IMG_10; the undated last');

  // 3 (first, over HTTP): the client's link carries Print, Full size, Instax; the open Wander none of the album's acts.
  const al = first.set && first.set.album; ok(al && al.instax && al.caps.full && al.caps.download && want.every(s => al.print[s] && /^\/yours\/p\/.+\?k=.+#print$/.test(al.print[s])), 'the client’s link: Print for every photograph, Full size, Instax: ' + JSON.stringify(al && { caps: al.caps, instax: al.instax, n: Object.keys(al.print || {}).length }));
  html = await (await go({}, '/wander')).text(); ok(!/"album":\{/.test(html), 'the open Wander carries no album');

  // 3b. The link's card: the cover first; a new cover, a new card (and the page's image address with it).
  const meanOf = async buf => (await sharp(buf).stats()).channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3;
  const screenMean = {}; for (const sl of want) screenMean[sl] = await meanOf(Buffer.from(await (await go(ada, `/img/${sl}/screen`)).arrayBuffer()));
  const firstTile = async () => { const r2 = await go(client, `/deliver/${d.token}/card.jpg`); assert.equal(r2.status, 200, 'the card'); const b = Buffer.from(await r2.arrayBuffer()); const m = await meanOf(await sharp(b).extract({ left: 0, top: 0, width: 390, height: 630 }).toBuffer()); return { b, near: want.slice().sort((x, y) => Math.abs(screenMean[x] - m) - Math.abs(screenMean[y] - m))[0] }; };
  const ogOf = async () => ((await (await go(client, `/deliver/${d.token}`)).text()).match(/card\.jpg\?v=([0-9a-f]+)/) || [])[1];
  await form(ada, `/account/deliveries/${d.id}/cover`, { slug: want[4] }); const c1 = await firstTile(), og1 = await ogOf();
  ok(c1.near === want[4], `the card leads with the cover: ${c1.near}, not ${want[4]}`);
  await form(ada, `/account/deliveries/${d.id}/cover`, { slug: want[1] }); const c2 = await firstTile(), og2 = await ogOf();
  ok(c2.near === want[1] && !c1.b.equals(c2.b), `a new cover, a new card: ${c2.near}`);
  ok(og1 && og2 && og1 !== og2, `the page's image address follows the card: ${og1} → ${og2}`);
  r = await go({}, `/a/${sh}/card.jpg`); ok(r.status === 404, 'a stranger gets no card of a private gallery: ' + r.status);
  say('3b. the link card leads with the cover; a new cover makes a new card and a new address');

  // 4. A stranger to the group album: the house's door, no picture; the heart refused.
  const stranger = {}; r = await go(stranger, `/wander?in=album:${sh}&at=${want[1]}`);
  ok(r.status === 302 && r.headers.get('location') === `/a/${encodeURIComponent(sh)}`, 'a stranger’s Wander goes to the album’s door: ' + r.status + ' ' + r.headers.get('location'));
  r = await go(stranger, `/a/${sh}`); html = await r.text();
  ok(r.status === 200 && /grp-door/.test(html) && /A private gallery/.test(html) && !want.some(s => html.includes(`/img/${s}/`)), 'the door is the house’s own page and shows no picture');
  r = await go(stranger, `/a/${sh}/${want[0]}/heart`, { method: 'POST', headers: { accept: 'application/json' } }); ok(r.status === 403, 'a stranger cannot heart a private album: ' + r.status);
  r = await go(stranger, `/api/stroll?in=album:${sh}&n=8`); const sj = await r.json(); ok(!(sj.items || []).some(i => want.includes(i.slug)), 'nor read it through the feed');
  say('3. the client’s link carries Print, Full size and Instax; 4. a stranger meets the door, no picture, no heart');

  // 2. A member, in Chromium, on a phone and at a desk.
  const member = {}; r = await form(member, `/a/${sh}/join`, { name: 'Bea' }); assert.equal(r.status, 303, 'Bea joins'); assert.ok(member.wm_pg, 'Bea’s key');
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const SIZES = [['phone', { ...devices['iPhone 13'] }], ['desk', { viewport: { width: 1280, height: 800 } }]];
  let size = 0;
  for (const [name, opt] of SIZES) {
    size++;
    const ctx = await browser.newContext({ ...opt, acceptDownloads: true });
    await ctx.addCookies([{ name: 'wm_pg', value: member.wm_pg, url: base }]);
    await ctx.addInitScript(() => { window.__shared = []; navigator.canShare = () => true; navigator.share = dd => { window.__shared.push({ files: (dd.files || []).map(f => ({ name: f.name, type: f.type, size: f.size })), url: dd.url || '' }); return Promise.resolve(); }; });
    const p = await ctx.newPage(); const errs = [], bad = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('response', x => { if (x.status() >= 400 && !/favicon/.test(x.url())) bad.push(x.status() + ' ' + x.url().replace(base, '')); });
    const shot = async n => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `${name}-${n}.png`) }); } };
    const showChrome = async () => { const c = await p.evaluate(() => document.querySelector('[data-stroll]').className); if (/st-still|st-arr/.test(c)) { await p.mouse.click(40, 300); await p.waitForTimeout(500); } };
    const pick = want[size]; // a different photograph at each size (each size is its own device, with its own hearts)
    // The album page says it once; a photograph pressed opens Wander at it.
    await p.goto(`${base}/a/${sh}`, { waitUntil: 'load' });
    const hint = await p.locator('.dv-wl').textContent(); ok(/opens in Wander/.test(hint) && /the heart/.test(hint) && /Download/.test(hint) && !/Print/.test(hint), `${name}: the album page says it once, naming only what Bea may do: ${hint}`);
    await shot('1-album');
    await p.locator(`figure[data-dv-slug="${pick}"] a.dv-im`).scrollIntoViewIfNeeded(); await p.locator(`figure[data-dv-slug="${pick}"] a.dv-im`).click();
    await p.waitForURL(/\/wander\?/); await p.waitForTimeout(900);
    const u = new URL(p.url()); ok(u.searchParams.get('in') === `album:${sh}` && u.searchParams.get('at') === pick, `${name}: pressed, Wander at the photograph: ${p.url()}`);
    const scr = p.locator(`.st-i[data-slug="${pick}"]`);
    const pic = await scr.locator('.st-im').evaluate(im => new Promise(res => { const done = () => res({ src: im.currentSrc || im.src, w: im.naturalWidth, h: im.naturalHeight }); if (im.complete) done(); else { im.addEventListener('load', done, { once: true }); im.addEventListener('error', done, { once: true }); setTimeout(done, 8000); } }));
    ok(pic.w >= 600, `${name}: the photograph is on the wall: ${JSON.stringify(pic)}`);
    ok(await scr.locator('[data-st-alh]').count() === 1 && await scr.locator('[data-st-alo]').count() === 1, `${name}: the heart and Album on the rail`);
    const box = await scr.locator('[data-st-alo]').boundingBox(); const hb = await scr.locator('[data-st-alh]').boundingBox();
    ok(box && box.width >= 44 && box.height >= 44 && hb.width >= 44 && hb.height >= 44, `${name}: the heart and Album are 44 px: ${JSON.stringify([hb, box])}`);
    ok(await scr.locator('.st-plate [data-st-alh]').count() === 1, `${name}: the heart is beside the title, not on the rail`);
    const tops = await p.evaluate(s => { const r = document.querySelector(`.st-i[data-slug="${s}"] .st-rail`).getBoundingClientRect(), t = document.querySelector('.st-top').getBoundingClientRect(); return { rail: r.top, bar: t.bottom }; }, pick);
    ok(tops.rail >= tops.bar, `${name}: the rail stays below the top bar: ${JSON.stringify(tops)}`);
    const railTxt = await scr.locator('.st-rail').evaluate(r => [].map.call(r.querySelectorAll('.st-b'), b => b.textContent.replace(/\s+/g, ' ').trim()));
    ok(!railTxt.some(x => /\d/.test(x) && !/^Collect/.test(x)), `${name}: no number on the rail: ${railTxt.join(' | ')}`);
    const chipHref = await p.locator('.st-top .st-set').getAttribute('href'); ok(chipHref === `/a/${sh}#p-${pick}`, `${name}: the album's chip goes back to the photograph: ${chipHref}`);
    await shot('2-wander');
    // The heart.
    await showChrome(); const hr = p.waitForResponse(x => x.url().endsWith(`/a/${sh}/${pick}/heart`)); await scr.locator('[data-st-alh]').click(); const hres = await (await hr).json();
    ok(hres.ok && hres.on && hres.n === 1, `${name}: the heart is the album's: ${JSON.stringify(hres)}`);
    ok(await scr.locator('[data-st-alh]').getAttribute('aria-pressed') === 'true', `${name}: the heart shows pressed`);
    // The sheet: what the rules allow, nothing else.
    await showChrome(); await scr.locator('[data-st-alo]').click(); const sheet = p.locator('.st-als'); await sheet.waitFor({ state: 'visible' });
    const verbs = await sheet.locator('.st-alrow > *').allTextContents(); ok(JSON.stringify(verbs.map(v => v.trim())) === JSON.stringify(['Download', 'Share', 'More']), `${name}: the sheet's row is Download · Share · More (no Print on the group's link): ${verbs.join(' · ')}`);
    for (const el of await sheet.locator('.st-alrow > *').all()) { const b = await el.boundingBox(); ok(b.width >= 44 && b.height >= 44, `${name}: a sheet button under 44 px: ${JSON.stringify(b)}`); }
    await shot('3-sheet');
    await sheet.locator('[data-st-alpb="share"]').click(); const shareOpts = (await sheet.locator('[data-st-alp="share"] b').allTextContents()); ok(JSON.stringify(shareOpts) === JSON.stringify(['Post', 'Story']), `${name}: Share is Post and Story (no Message: the rules do not pass it on): ${shareOpts}`);
    await sheet.locator('[data-st-alpb="more"]').click(); const moreOpts = (await sheet.locator('[data-st-alp="more"] b').allTextContents()); ok(JSON.stringify(moreOpts) === JSON.stringify(['Keep it', 'That’s me', 'That’s a friend', 'Ask to license it']), `${name}: More is Keep it, That's me, That's a friend, Ask (no Full size, no Instax): ${moreOpts}`);
    await shot('4-more');
    // Download.
    const dl = p.waitForEvent('download'); await sheet.locator('.st-alrow a', { hasText: 'Download' }).click(); const file = await dl; const fp = await file.path(); const meta = await sharp(fp).metadata();
    const mw = db.prepare('SELECT width, height FROM works WHERE slug=?').get(pick); ok(meta.format === 'jpeg' && Math.max(meta.width, meta.height) === Math.min(2400, Math.max(mw.width, mw.height)), `${name}: Download hands over the copy (2,400 pixels at most): ${meta.format} ${meta.width}×${meta.height} from ${mw.width}×${mw.height}`);
    // Story, to the phone's sheet.
    await sheet.locator('[data-st-alpb="share"]').click(); await sheet.locator('[data-st-alstory="story"]').click();
    await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 15000 }).catch(() => {});
    const shared = await p.evaluate(() => window.__shared); ok(shared.length === 1 && shared[0].files[0] && /\(story\)\.jpg$/.test(shared[0].files[0].name) && shared[0].files[0].type === 'image/jpeg' && shared[0].files[0].size > 10000, `${name}: Story hands the credited copy to the sheet: ${JSON.stringify(shared)}`);
    // Esc closes the sheet, then goes back to the album at this photograph.
    await p.keyboard.press('Escape'); ok(await sheet.isHidden(), `${name}: Esc closes the sheet`);
    if (name === 'desk') { await p.keyboard.press('Escape'); await p.waitForURL(new RegExp(`/a/${sh}#p-${pick}$`)); await p.goto(`${base}/wander?in=album:${sh}&at=${pick}`, { waitUntil: 'load' }); await p.waitForTimeout(600); }
    // Back to the album at the photograph, by the sheet's own link: the heart is there, and counted.
    await showChrome(); await p.locator(`.st-i[data-slug="${pick}"] [data-st-alo]`).click(); await sheet.waitFor({ state: 'visible' });
    await sheet.locator('.st-alback').click(); await p.waitForURL(new RegExp(`/a/${sh}#p-${pick}$`)); await p.waitForTimeout(700);
    const back = await p.evaluate(s => { const f = document.getElementById('p-' + s); const b = f.getBoundingClientRect(); return { hearted: f.hasAttribute('data-hearted'), pressed: f.querySelector('[data-dvh]').getAttribute('aria-pressed'), count: document.querySelector('[data-dvh-count]').textContent, top: b.top, bottom: b.bottom, vh: innerHeight }; }, pick);
    ok(back.hearted && back.pressed === 'true' && back.count === '1', `${name}: back on the album, the heart given in Wander is there and counted: ${JSON.stringify(back)}`);
    ok(back.top < back.vh && back.bottom > 0, `${name}: back on the album at the photograph: ${JSON.stringify(back)}`);
    await shot('5-back');
    // Keep it, from Wander (the form asks an email of someone not signed in).
    await p.goto(`${base}/wander?in=album:${sh}&at=${pick}`, { waitUntil: 'load' }); await p.waitForTimeout(600);
    await showChrome(); await p.locator(`.st-i[data-slug="${pick}"] [data-st-alo]`).click(); await sheet.waitFor({ state: 'visible' });
    await sheet.locator('[data-st-alpb="more"]').click(); await sheet.locator('[data-st-alkeep]').click();
    const f = sheet.locator('[data-st-alf]'); await f.locator('input[name=email]').fill(`bea${size}@example.com`); await f.locator('input[name=name]').fill('Bea');
    await shot('6-keep');
    await Promise.all([p.waitForURL(/\/thanks\//), f.locator('button.st-algo').click()]);
    const kept = db.prepare("SELECT l.* FROM licenses l JOIN buyers b ON b.id=l.buyer_id WHERE l.work_id=(SELECT id FROM works WHERE slug=?) AND b.email=? AND l.intended_use LIKE 'Kept from %'").get(pick, `bea${size}@example.com`);
    ok(kept && kept.status === 'active', `${name}: Keep it keeps it: ${kept ? kept.ref + ' ' + kept.status : 'no licence'}`);
    ok(!errs.length, `${name}: script errors: ${errs.join(' | ')}`);
    ok(!bad.length, `${name}: failed requests: ${bad.join(' | ')}`);
    await ctx.close();
    say(`2. ${name}: pressed into Wander; heart, Download, Story, Keep it; back to the album at the photograph, the heart counted`);
  }
  await browser.close();
  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  if (fails.length) { console.log(`::error title=albumwander::${fails.join(' / ').slice(0, 1500)}`); console.log(`albumwander: ${fails.length} fault(s)`); process.exit(1); }
  console.log('albumwander: holds'); process.exit(0);
})().catch(e => { console.error(e); console.log(`::error title=albumwander::${String(e && e.message || e).slice(0, 1500)}`); process.exit(1); });
