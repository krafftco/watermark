// A photographer's first ten minutes (issue #12): a stranger on an iPhone 13, from /makers to a page, work on view,
// prices, a bank and the Instagram room, walked through the pages' own controls in an in-process test house.
// node scripts/first-ten.js   (PW=/path/to/playwright; SHOTS=/dir for the screenshots, default ../12-shots beside the repo)
// Exits non-zero on a hard fault: a 5xx, a script error, a page wider than the screen, a step that cannot be done.
'use strict';
process.env.NODE_ENV = 'test';
const fs = require('fs'); const path = require('path'); const os = require('os');
const PW = process.env.PW || '/opt/npm-tools/node_modules/playwright';
const { chromium, devices } = require(PW);
const sharp = require('sharp');
const { createApp } = require('../src/app');

const SHOTS = process.env.SHOTS || path.join(__dirname, '..', '..', '12-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const steps = [], faults = [], notes = [];
let taps = 0, fields = 0;
const hard = (where, what) => faults.push({ hard: true, where, what });
const soft = (where, what) => faults.push({ hard: false, where, what });

async function pictures(dir) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const f = path.join(dir, `IMG_40${i}2.jpg`);
    const w = i === 2 ? 2400 : 3600, h = i === 2 ? 3600 : 2400; // one upright
    const svg = `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="hsl(${i * 70},45%,${30 + i * 8}%)"/>` +
      `<circle cx="${w * (0.2 + i * 0.15)}" cy="${h * 0.4}" r="${300 + i * 120}" fill="hsl(${i * 70 + 180},60%,70%)"/>` +
      `<rect x="${w * 0.1}" y="${h * (0.6 + i * 0.05)}" width="${w * 0.6}" height="${120 + i * 40}" fill="#111"/></svg>`;
    await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(f);
    out.push(f);
  }
  return out;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-first-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'first-ten', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const files = await pictures(dir);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  // Chromium's iPhone emulation leaves (pointer:coarse) false; a real phone has it, and the house's phone layout keys on it.
  let cdp = null; const coarse = async () => { try { cdp = cdp || await ctx.newCDPSession(p); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); } catch (e) { notes.push('coarse pointer not emulated'); } };
  await coarse(); // re-sent before each page: a file chooser resets it
  let errs = [], bad = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('response', r => { if (r.status() >= 400 && !/favicon|fonts\.g/.test(r.url())) bad.push(r.status() + ' ' + r.url().replace(base, '')); });
  await p.route(/fonts\.googleapis|fonts\.gstatic/, r => r.abort());

  const tap = async (sel, opt) => { await p.locator(sel).first().click(opt); taps++; };
  const fill = async (sel, v) => { await p.locator(sel).first().fill(v); fields++; };
  const look = async (name, extra = {}) => {
    await p.waitForTimeout(400);
    const m = await p.evaluate(() => {
      const unl = [].filter.call(document.querySelectorAll('a[href], button'), e => {
        const r = e.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') return false;
        const t = (e.textContent || '').trim() || e.getAttribute('aria-label') || e.getAttribute('title') || (e.querySelector('img[alt]:not([alt=""])') ? 'img' : '');
        return !t;
      }).map(e => e.outerHTML.slice(0, 90));
      const wide = [].filter.call(document.querySelectorAll('body *'), e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 3).map(e => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]);
      const kh = document.querySelector('.kh'); const khr = kh && kh.getBoundingClientRect();
      const khOn = !!(kh && khr.height && khr.bottom > 0 && getComputedStyle(kh).visibility !== 'hidden' && getComputedStyle(kh).display !== 'none' && !kh.classList.contains('kh-m'));
      const sk = document.querySelector('a.skip'); const skOn = !!(sk && sk.getBoundingClientRect().top >= 0 && sk.getBoundingClientRect().top < innerHeight && getComputedStyle(sk).clip === 'auto' && sk.getBoundingClientRect().width > 2);
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, title: document.title, path: location.pathname + location.search, unl, wide, khOn, khCls: kh ? kh.className : '', skOn, coarse: matchMedia('(pointer:coarse)').matches };
    });
    const shot = path.join(SHOTS, String(steps.length + 1).padStart(2, '0') + '-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png');
    await p.screenshot({ path: shot, fullPage: !!extra.full });
    const s = { name, path: m.path, title: m.title, errs: errs.slice(), bad: bad.slice(), taps, fields };
    steps.push(s);
    if (errs.length) hard(name, 'script error: ' + errs.join(' | '));
    for (const b of bad) (/^5/.test(b) ? hard : soft)(name, 'failed request ' + b);
    if (m.sw > m.iw) hard(name, `page wider than the screen: ${m.sw} > ${m.iw} (${m.wide.join(', ')})`);
    if (m.unl.length) soft(name, `unlabelled control: ${m.unl.slice(0, 2).join(' / ')}`);
    if (!m.coarse) notes.push(`${name}: pointer not coarse (emulation)`);
    if (m.khOn) notes.push(`${name}: the house bar is showing (${m.khCls}; coarse ${m.coarse})`);
    if (m.skOn) notes.push(`${name}: 'Skip to the content' is showing`);
    errs = []; bad = [];
    return m;
  };
  const go = async (url, name) => { await coarse(); const r = await p.goto(base + url, { waitUntil: 'load' }); if (r.status() >= 500) hard(name, `${url} answered ${r.status()}`); else if (r.status() >= 400) hard(name, `${url} answered ${r.status()}`); return r; };
  const step = async (name, fn) => { try { await fn(); } catch (e) { hard(name, 'could not be completed: ' + String(e.message).split('\n')[0]); try { await look(name + ' (failed)'); } catch (e2) {} } };

  // 1. The door
  await step('makers', async () => { await go('/makers', 'makers'); await look('makers'); });
  await step('join', async () => {
    const door = p.locator('a[href="/join"]').first();
    if (!(await door.count())) throw new Error('no "Open your museum" link to /join on /makers');
    await door.scrollIntoViewIfNeeded(); await door.click(); taps++;
    await p.waitForURL(/\/join/);
    await look('join');
    // typed as a person types, a key at a time (#24: the door turns away a form posted faster than a person can fill it)
    await p.locator('form[action="/record"] [name="name"]').first().pressSequentially('Ada Lumen', { delay: 70 }); fields++;
    await p.locator('form[action="/record"] [name="email"]').first().pressSequentially('ada@example.com', { delay: 70 }); fields++;
    await tap('form[action="/record"] [name="adult"]');
    await Promise.all([p.waitForNavigation(), tap('form[action="/record"] button')]);
    const m = await look('after join');
    if (!/\/account/.test(m.path)) throw new Error('landed on ' + m.path + ', not signed in');
    // #21: the door is whole on the first screen, the welcome said once and never over the door
    const v = await p.evaluate(() => {
      const r = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height }; };
      const hi = document.querySelector('.wm-hi'); const on = hi && getComputedStyle(hi).opacity !== '0';
      return { door: r(document.querySelector('.vt-door')), hi: on ? r(hi) : null, banners: document.querySelectorAll('[data-welcome]').length, vh: innerHeight };
    });
    if (!v.door) hard('after join', 'no vault door');
    else if (v.door.top < 0 || v.door.bottom > v.vh) hard('after join', `the vault door is not whole on the first screen (${Math.round(v.door.top)}–${Math.round(v.door.bottom)} of ${v.vh})`);
    if (v.hi && v.door && v.hi.top < v.door.bottom && v.hi.bottom > v.door.top && v.hi.left < v.door.right && v.hi.right > v.door.left) hard('after join', 'the welcome toast lies over the vault door');
    if (v.hi && v.banners) hard('after join', 'the welcome is said twice (banner and toast)');
  });
  const maker = db.prepare("SELECT * FROM makers WHERE email='ada@example.com'").get();
  if (!maker) { hard('join', 'no maker made'); return finish(); }

  // 2. The vault
  await step('upload', async () => {
    if (!/\/account\/upload/.test(p.url())) await go('/account/upload', 'upload');
    await look('vault, empty');
    await p.setInputFiles('#aFiles', files); taps++;
    await look('vault, chosen');
    const sd = await p.evaluate(() => { const b = document.querySelector('#aGo').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, vh: innerHeight }; });
    if (sd.top < 0 || sd.bottom > sd.vh) hard('vault, chosen', `Send is off the screen once files are chosen (${Math.round(sd.top)}–${Math.round(sd.bottom)} of ${sd.vh})`);
    const go1 = p.locator('#aGo'); if (await go1.isDisabled()) throw new Error('Send stayed disabled after choosing files');
    await go1.click(); taps++;
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const n = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=?").get(maker.id).n;
      if (n >= files.length) break;
      await p.waitForTimeout(1000);
    }
    await p.waitForTimeout(3500);
    const held = db.prepare('SELECT COUNT(*) n FROM works WHERE maker_id=?').get(maker.id).n;
    notes.push(`vault: ${held} of ${files.length} held in ${Math.round((Date.now() - t0) / 1000)} s`);
    await look('vault, held', { full: true });
    if (held < files.length) throw new Error(`only ${held} of ${files.length} held after two minutes`);
  });
  const works = db.prepare('SELECT slug, status FROM works WHERE maker_id=? ORDER BY id').all(maker.id);

  // 3. See them
  await step('desk', async () => {
    await go('/account', 'desk'); await look('desk', { full: true });
    // #20 (Will, 12 Nov): one checklist; the by-invitation 'way in' is gone from the desk of the open door
    const d = await p.evaluate(() => ({ way: !!document.querySelector('.hd-way'), words: /The way in|Ask the house to look|hanging there is by invitation/.test(document.body.innerText), lists: document.querySelectorAll('.fs, .hd-way').length, h: document.documentElement.scrollHeight }));
    if (d.way || d.words) hard('desk', 'the way in (by invitation) is still on the desk');
    if (d.lists > 1) hard('desk', `${d.lists} checklists on the desk`);
    notes.push(`desk ${d.h} px tall`);
  });
  await step('library', async () => { await go('/account/table', 'library'); await look('library'); });
  await step('cull', async () => {
    await go('/account/cull', 'cull'); await p.waitForTimeout(800); await look('cull');
    const right = p.locator('[data-cll-do="show"]');
    if (!(await right.count())) throw new Error('no On view button in the cull');
    await right.first().click(); taps++;
    await p.waitForTimeout(500);
    if (await p.locator('[data-cll-attest]').isVisible()) { await look('cull, the word'); await tap('[data-cll-attest-cb]'); await tap('[data-cll-attest-go]'); }
    await p.waitForTimeout(900);
    await tap('[data-cll-do="hide"]');
    await p.waitForTimeout(900);
    await look('cull, after two');
    const n = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(maker.id).n;
    if (n < 1) throw new Error('the swipe right put nothing on view');
  });

  // 4. The page
  await step('profile', async () => {
    await go('/account/profile', 'profile'); await look('profile');
    await fill('textarea[name="bio"]', 'I make photographs of cities at the edges of the day.');
    await p.setInputFiles('input[name="portrait"]', files[2]); taps++;
    await Promise.all([p.waitForNavigation(), p.locator('form:has(textarea[name="bio"]) button.btn').first().click()]); taps++;
    await look('profile, saved');
    if (!db.prepare('SELECT portrait FROM makers WHERE id=?').get(maker.id).portrait) soft('profile', 'the portrait did not save');
  });
  await step('public page', async () => { await go('/m/' + maker.handle, 'public page'); await look('maker page', { full: true }); });
  await step('link in bio', async () => { await go('/@' + maker.handle, 'link in bio'); await look('link in bio'); });

  // 5. Prices and getting paid
  await step('prices', async () => { await go('/account/prices', 'prices'); await look('prices', { full: true }); });
  await step('payouts', async () => {
    await go('/account/payouts', 'payouts'); await look('payouts');
    const bank = p.locator('form[action="/account/payouts/connect"] button, form[action="/account/payouts/connect"] [type=submit]');
    if (!(await bank.count())) soft('payouts', 'no bank button (form to /account/payouts/connect)');
  });

  // 6. A work's public page
  const pub = db.prepare("SELECT slug FROM works WHERE maker_id=? AND status='held' LIMIT 1").get(maker.id);
  await step('work page', async () => {
    if (!pub) throw new Error('no work on view to open');
    await go('/w/' + pub.slug, 'work page'); await look('work page');
    const col = await p.evaluate(() => { const b = document.querySelector('.ap-col, [data-collect-now]'); if (!b) return null; const r = b.getBoundingClientRect(); const tb = document.querySelector('.tb'); const t = tb && getComputedStyle(tb).display !== 'none' ? tb.getBoundingClientRect().top : innerHeight; return { top: r.top, bottom: r.bottom, vh: innerHeight, tb: t }; });
    if (!col) soft('work page', 'no Collect in the act row');
    else if (col.bottom > col.vh) hard('work page', `Collect sits below the first screen (bottom ${Math.round(col.bottom)} of ${col.vh})`);
    else if (col.bottom > col.tb) hard('work page', `Collect sits under the tab bar (bottom ${Math.round(col.bottom)}, the bar from ${Math.round(col.tb)})`);
    else notes.push(`work page: Collect ends at ${Math.round(col.bottom)}, the tab bar starts at ${Math.round(col.tb)}`);
    const send = p.locator('[data-wm-send]').first();
    if (!(await send.count())) throw new Error('no Send button');
    await send.click(); taps++; await p.waitForTimeout(900);
    await look('send sheet');
    const ig = await p.evaluate(() => [].map.call(document.querySelectorAll('.snd-ig button, .snd-ig a'), b => b.textContent.trim()));
    for (const w of ['Post', 'Story', 'Placard']) if (!ig.some(x => x.includes(w))) soft('send sheet', `no ${w} button in the sheet (saw: ${ig.join(', ') || 'none'})`);
  });

  // 7. Instagram and an album
  await step('billboard', async () => { await go('/account/billboard', 'billboard'); await look('billboard'); });
  await step('album', async () => { await go('/account/deliveries/new', 'album'); await look('album form', { full: true }); });

  finish();
  async function finish() {
    await browser.close(); srv.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    console.log(`taps ${taps}, fields ${fields}; ${notes.join('; ')}`);
    for (const s of steps) console.log(`  ${s.name.padEnd(18)} ${s.path}  (taps ${s.taps}, fields ${s.fields})`);
    console.log(`first ten minutes: ${steps.length} steps, ${faults.length} faults`);
    for (const f of faults) console.log(`  ${f.hard ? 'HARD' : 'soft'} ${f.where}: ${f.what}`);
    process.exit(faults.some(f => f.hard) ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(1); });
