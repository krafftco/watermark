// Wander's two sides (#241; Will, 28 Nov: the sideways swipes did not feel intentional; the side, the shield and the
// record said the same work three times, and nothing showed where to go next). In a real browser at a phone's size,
// with touch, from a museum's work and from a living maker's work: a finger moving right opens Where next, which lists
// the right ways (only those holding four or more), each one press into a Wander of that set, then the standing doors;
// a finger moving left opens About (the work, who made it, the Watermark record, once); the shield opens that same
// panel at the record and no sheet of its own. SHOTS=<folder> keeps a picture of each side.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { chromium, devices } = require('playwright');
const { createApp } = require('../src/app');
let dir;
(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-wanderdoors-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'wanderdoors', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  let k = 0;
  const put = async (title, makerId, place) => {
    const i = k++; const f = path.join(dir, `i${i}.jpg`);
    await sharp({ create: { width: i % 2 ? 1000 : 1600, height: i % 2 ? 1500 : 1000, channels: 3, background: { r: 30 + (i * 37) % 200, g: 60 + (i * 53) % 150, b: 200 - (i * 29) % 180 } } }).jpeg().toFile(f);
    const w = await app.locals.registerWork({ file: f, title, place, originalName: `i${i}.jpg`, makerId });
    db.prepare("UPDATE works SET status='held', stars=5, curated=1 WHERE slug=?").run(w.slug); return w.slug;
  };
  // A living maker: six photographs of one place, this decade.
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('mk','Mira Kell','mk@example.com','maker',datetime('now'),'house')").run();
  const mk = db.prepare("SELECT * FROM makers WHERE handle='mk'").get(); const mine = [];
  for (let i = 0; i < 6; i++) { const s = await put(`Frame ${i}`, mk.id, 'Paris'); db.prepare('UPDATE works SET taken_at=? WHERE slug=?').run(`2024-05-0${i + 1}`, s); mine.push(s); }
  // A museum (a demonstration desk; no real museum is named): six paintings by one artist of one movement, in the
  // 1880s; only two of them carry a place, so the place is not a way.
  db.prepare("INSERT INTO makers (handle, name, kind, joined_at, door) VALUES ('museum-demo', 'A museum desk (demonstration)', 'institution', datetime('now'), 'house')").run();
  const mu = db.prepare("SELECT * FROM makers WHERE handle='museum-demo'").get(); const theirs = [];
  const iv = app.locals.art.ensure('Ines Varga', { born: 1850, died: 1911, movement: 'Post-Impressionism' });
  for (let i = 0; i < 6; i++) { const s = await put(`Orchard, Study ${i + 1}`, mu.id, i < 2 ? 'Arles' : null); db.prepare("UPDATE works SET taken_at=?, kind='painting', artist_id=?, accession=? WHERE slug=?").run(`188${4 + i}-06-01`, iv.id, `D.${100 + i}`, s); theirs.push(s); }
  if (app.locals.findIndexDirty) app.locals.findIndexDirty();

  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const bad = []; p.on('response', r => { if (r.status() >= 400 && !/favicon|fonts\.g|\/api\/for-you/.test(r.url())) bad.push(r.status() + ' ' + r.url().replace(base, '')); });
  const vp = devices['iPhone 13'].viewport;
  const shot = async name => { if (!process.env.SHOTS) return; fs.mkdirSync(process.env.SHOTS, { recursive: true }); await p.waitForTimeout(700); await p.screenshot({ path: path.join(process.env.SHOTS, name + '.png') }); };
  // One finger across the picture: dx < 0 is a finger moving left.
  const swipe = dx => p.evaluate(async dx => {
    const img = document.querySelector('.st-i .st-im'); const x0 = dx < 0 ? 320 : 60, y = 380;
    const T = x => new Touch({ identifier: 7, target: img, clientX: x, clientY: y });
    const fire = (type, ts, ct) => img.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: ts, changedTouches: ct || ts, targetTouches: ts }));
    fire('touchstart', [T(x0)]); for (let i = 1; i <= 10; i++) { fire('touchmove', [T(x0 + dx * i / 10)]); await new Promise(r => setTimeout(r, 12)); }
    fire('touchend', [], [T(x0 + dx)]); await new Promise(r => setTimeout(r, 700));
  }, dx);
  const state = () => p.evaluate(() => {
    const l = document.querySelector('[data-st-side="yours"]'), r = document.querySelector('[data-st-side="keys"]'); const on = el => el.classList.contains('on') && getComputedStyle(el).visibility === 'visible';
    const a = document.activeElement;
    return { left: on(l), right: on(r), leftLabel: l.getAttribute('aria-label'), rightLabel: r.getAttribute('aria-label'), focusIn: a && (l.contains(a) ? 'left' : r.contains(a) ? 'right' : ''), focusRec: !!(a && a.hasAttribute && a.hasAttribute('data-st-rec')), sheet: !!document.querySelector('.wye'), eyes: document.querySelectorAll('[data-eye]').length };
  });
  const next = () => p.evaluate(() => { const l = document.querySelector('[data-st-side="yours"]'); return { h: (l.querySelector('h3') || {}).textContent, ways: [...l.querySelectorAll('.wnx-t')].map(a => ({ k: a.querySelector('small').textContent, name: a.querySelector('b').textContent, n: parseInt(a.querySelector('i').textContent, 10), href: a.getAttribute('href'), cover: !!a.querySelector('img') })), strip: [...l.querySelectorAll('.wnx .whp-strip a')].map(a => a.getAttribute('href')), doors: [...l.querySelectorAll('.wnx-door')].map(a => [a.querySelector('b').textContent, a.getAttribute('href')]) }; });
  const about = () => p.evaluate(() => {
    const r = document.querySelector('[data-st-side="keys"]'); const t = r.textContent; const pos = s => { const el = r.querySelector(s); return el ? el.getBoundingClientRect().top + r.scrollTop : -1; };
    const rec = r.querySelector('[data-st-rec]'); const box = rec ? rec.getBoundingClientRect() : null;
    return { text: t, work: pos('.wka-h'), who: pos('.whp-h'), rec: pos('[data-st-rec]'), recs: document.querySelectorAll('[data-st-rec]').length, title: (r.querySelector('.wka-h h3') || {}).textContent, h3s: [...r.querySelectorAll('h3')].map(h => h.textContent), dts: [...r.querySelectorAll('dt')].map(d => d.textContent), recTop: box ? box.top : -1, scroll: r.scrollTop, full: [...r.querySelectorAll('a')].filter(a => /The full record/.test(a.textContent)).length };
  });
  const count = (hay, needle) => hay.split(needle).length - 1;
  // Where a way lands: the Wander of that set (its label on the chip, its size), or of that maker.
  const lands = async w => {
    const r = await fetch(base + w.href); assert.strictEqual(r.status, 200, `${w.href} answers 200`); const html = await r.text();
    const S = JSON.parse(html.match(/window\.__WM_STROLL=(.*?);<\/script>/)[1]);
    assert.ok(S.items.length >= 1, `${w.href} opens on a picture`);
    if (/[?&]in=/.test(w.href)) { assert.ok(S.set && S.set.label === w.name, `${w.href} is the Wander of ${w.name} (${S.set && S.set.label})`); assert.strictEqual(S.set.n, w.n, `${w.name}: the tile's count is what its Wander holds (${w.n} v ${S.set.n})`); }
    else { assert.ok(S.maker, `${w.href} is a maker's Wander`); assert.ok(html.includes(`>${w.name}<i>`), `${w.href} carries ${w.name} on its chip`); }
    return S;
  };
  const DOORS = [['Museums', '/look#museums'], ['Artists', '/art'], ['In time', '/look#time'], ['Discover', '/look']];

  for (const [who, slug, want, title] of [
    ['museum', theirs[2], [['By the same hand', 'Ines Varga', 6], ['The same collection', 'A museum desk (demonstration)', 6], ['The same movement', 'Post-Impressionism', 6], ['The same time', 'The 1880s', 6], ['The same kind', 'Paintings', 6]], 'Orchard, Study 3'],
    ['maker', mine[2], [['By the same hand', 'Mira Kell', 6], ['The same time', 'The 2020s', 6], ['The same place', 'Paris', 6], ['The same kind', 'Photographs', 6]], 'Frame 2'],
  ]) {
    await p.goto(`${base}/wander?at=${slug}`, { waitUntil: 'load' }); await p.waitForTimeout(900);
    let s = await state(); assert.ok(!s.left && !s.right, `${who}: Wander opens on the picture, both sides shut`);
    assert.strictEqual(s.leftLabel, 'Where next'); assert.strictEqual(s.rightLabel, 'About this work');
    assert.strictEqual(s.eyes, 0, `${who}: the shield no longer opens a sheet of its own`);

    // A finger moving right: Where next.
    await swipe(240); await p.waitForFunction(() => document.querySelector('[data-st-side="yours"] .wnx-door'), null, { timeout: 5000 });
    s = await state(); assert.ok(s.left && !s.right, `${who}: a finger moving right opens the left side`); assert.strictEqual(s.focusIn, 'left', `${who}: focus goes into Where next`);
    const n = await next(); assert.strictEqual(n.h, 'Where next');
    assert.deepStrictEqual(n.ways.map(w => [w.k, w.name, w.n]), want, `${who}: the ways on from this picture`);
    assert.ok(n.ways.length <= 6 && n.ways.every(w => w.cover), `${who}: at most six tiles, each with a cover`);
    assert.ok(!n.ways.some(w => w.name === 'Arles'), `${who}: a place holding two works is not a way`);
    assert.strictEqual(n.strip.length, 4, `${who}: the strip by the same hand is kept under its tile`);
    assert.deepStrictEqual(n.doors, DOORS, `${who}: the standing doors`);
    for (const w of n.ways) await lands(w);
    for (const [, href] of DOORS) { const r = await fetch(base + href.replace(/#.*/, '')); assert.strictEqual(r.status, 200, `${href} answers`); }
    await shot(`${who}-where-next`);
    // One press: the first tile is that Wander.
    await p.tap('[data-st-side="yours"] .wnx-t'); await p.waitForLoadState('load'); await p.waitForTimeout(500);
    const there = await p.evaluate(() => ({ url: location.pathname + location.search, chip: (document.querySelector('.st-chip') || {}).textContent, pictures: document.querySelectorAll('.st-i .st-im').length }));
    assert.ok(there.chip && there.chip.includes(want[0][1]) && there.pictures >= 3, `${who}: one press lands in the Wander of ${want[0][1]} (${JSON.stringify(there)})`);

    // A finger moving left: About, the work, who made it, the record, once.
    await p.goto(`${base}/wander?at=${slug}`, { waitUntil: 'load' }); await p.waitForTimeout(900);
    await swipe(-240); await p.waitForFunction(() => document.querySelector('[data-st-side="keys"] [data-st-rec]'), null, { timeout: 5000 });
    s = await state(); assert.ok(s.right && !s.left, `${who}: a finger moving left opens the right side`); assert.strictEqual(s.focusIn, 'right', `${who}: focus goes into About`);
    let a = await about();
    assert.ok(a.work >= 0 && a.work < a.who && a.who < a.rec, `${who}: the work, then who made it, then the record (${a.work}, ${a.who}, ${a.rec})`);
    assert.strictEqual(a.scroll, 0, `${who}: a swipe opens About at the top`);
    assert.strictEqual(a.title, title); assert.strictEqual(count(a.text, title), 1, `${who}: the title is said once`);
    assert.strictEqual(a.recs, 1, `${who}: one record on the page`); assert.strictEqual(a.full, 1, `${who}: one way to the full record`);
    for (const dt of ['Its number', 'Copyright', 'The maker is paid', 'Held', 'Proof']) assert.strictEqual(a.dts.filter(x => x === dt).length, 1, `${who}: “${dt}” is there, once`);
    assert.ok(!a.dts.includes('Made by'), `${who}: who made it is not said again in the record`);
    assert.ok(a.dts.includes('Made') && (who === 'maker' || a.dts.includes('Accession')), `${who}: the work's own facts are kept`);
    assert.ok(/Wander their work/.test(a.text) && /Their page/.test(a.text), `${who}: who made it keeps its ways`);
    assert.ok(/No one holds it yet\./.test(a.text) && /Fingerprinted/.test(a.text) && /Its life/.test(a.text) && /Check a copy/.test(a.text), `${who}: what the shield's sheet said is kept`);
    if (who === 'maker') assert.ok(/©\s*Mira Kell/.test(a.text), 'a living maker’s copyright is in the record: ' + a.dts.join(' | ') + ' :: ' + a.text.slice(-700));
    assert.ok(!/blockchain/i.test(a.text), 'the register is the register');
    const html1 = await p.evaluate(() => document.querySelector('[data-st-side="keys"] [data-sd-body]').innerHTML);
    await shot(`${who}-about`);
    // A step back closes it (the same finger, the other way), and so does the shade.
    await p.evaluate(async () => { const el = document.querySelector('[data-st-side="keys"]'); const T = x => new Touch({ identifier: 8, target: el, clientX: x, clientY: 300 }); el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [T(120)], changedTouches: [T(120)], targetTouches: [T(120)] })); el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [T(300)], targetTouches: [] })); await new Promise(r => setTimeout(r, 600)); });
    s = await state(); assert.ok(!s.right && !s.left, `${who}: a step back closes About`); assert.strictEqual(s.focusIn, '', `${who}: focus leaves the closed side`);

    // The shield: the same panel, at the record. A tap on the picture brings the chrome; then the shield.
    await p.touchscreen.tap(Math.round(vp.width / 2), Math.round(vp.height / 3)); await p.waitForTimeout(900);
    await p.tap('.st-i .st-eye'); await p.waitForTimeout(900);
    s = await state(); assert.ok(s.right && !s.left, `${who}: the shield opens About`); assert.ok(!s.sheet, `${who}: and no second sheet`);
    assert.ok(s.focusRec, `${who}: focus is on the record`);
    a = await about(); assert.ok(a.scroll > 0 && a.recTop >= 0 && a.recTop < vp.height * 0.5, `${who}: the shield opens it at the record (top ${Math.round(a.recTop)}, scrolled ${Math.round(a.scroll)})`);
    const html2 = await p.evaluate(() => document.querySelector('[data-st-side="keys"] [data-sd-body]').innerHTML);
    assert.strictEqual(html2, html1, `${who}: the shield and the About side show the same panel`);
    await shot(`${who}-about-record`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    s = await state(); assert.ok(!s.right && !s.left, `${who}: Esc closes it`);
  }
  // The shelf keeps its own acts, and its sides still land somewhere: the standing doors, no work's ways.
  const none = await (await fetch(base + '/stroll/side/no-such-work')).json();
  assert.ok(/wnx-door/.test(none.like) && !/wnx-t/.test(none.like) && none.who === '', 'with no work on screen the left side is the standing doors alone');
  assert.deepStrictEqual(bad, [], 'every address answered');
  assert.deepStrictEqual(errs, [], 'no page errors');
  await browser.close(); srv.close();
  console.log('ok: in Wander the left is where next, the right is about, said once, and the shield opens it at the record');
})().catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } setTimeout(() => process.exit(), 50); });
