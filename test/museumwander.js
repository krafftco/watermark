// A museum's Wander stays in the museum (#238; Will, 28 Nov, on his phone: "one swipe takes you right back to my
// pictures"). In a real browser at a phone's size, with touch: a house with a graded maker and a museum of sixty
// ungraded works. From every door into Wander that arrives at a museum's work, ten swipes stay in the museum; its name
// is on the chip; one press leaves for the open Wander. A set, a word and a maker's own work are as they were. Find
// opens with the museums first, each to its own Wander. And a museum larger than one pool comes round whole.
// WALK_REPORT=1 prints the table of doors without judging it (run on the house before the repair, for the record).
process.env.NODE_ENV = 'test'; process.env.WANDER_FLOOR = '3'; process.env.WANDER_POOL_MAX = '16';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { chromium, devices } = require('playwright');
const { createApp } = require('../src/app');
const REPORT = process.env.WALK_REPORT === '1';
const ok = (v, msg) => { if (REPORT) { if (!v) console.log('   (would fail) ' + msg); } else assert.ok(v, msg); };
let dir;
(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-museumwander-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'museumwander', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('mk','Mira Kell','mk@example.com','maker',datetime('now'),'house')").run();
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door, place) VALUES ('the-old-hall','The Old Hall','hall@example.com','institution',datetime('now'),'house','Leiden')").run();
  const mk = db.prepare("SELECT * FROM makers WHERE handle='mk'").get(), hall = db.prepare("SELECT * FROM makers WHERE handle='the-old-hall'").get();
  const whose = new Map(); const mine = [], theirs = [];
  const hang = async (m, i, grade) => {
    const f = path.join(dir, `${m.handle}${i}.jpg`);
    // Each its own picture (the house refuses the same photograph twice): an 8 by 8 board of its own, enlarged.
    let seed = (m.id * 1000 + i) * 2654435761 >>> 0; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; const px = Buffer.alloc(8 * 8 * 3); for (let k = 0; k < px.length; k++) px[k] = Math.floor(rnd() * 256);
    await sharp(px, { raw: { width: 8, height: 8, channels: 3 } }).resize(i % 2 ? 1000 : 1600, i % 2 ? 1500 : 1000, { kernel: 'nearest', fit: 'fill' }).jpeg().toFile(f);
    const w = await app.locals.registerWork({ file: f, title: `${m.handle === 'mk' ? 'Frame' : 'Object'} ${i}`, place: 'Paris', originalName: `${m.handle}${i}.jpg`, makerId: m.id });
    db.prepare(`UPDATE works SET status='held'${grade ? ', stars=5, curated=1' : ''} WHERE slug=?`).run(w.slug);
    whose.set(w.slug, m.handle); (m.handle === 'mk' ? mine : theirs).push(w.slug);
  };
  for (let i = 0; i < 36; i++) await hang(mk, i, true);
  for (let i = 0; i < 60; i++) await hang(hall, i, false);
  if (app.locals.findIndexDirty) app.locals.findIndexDirty();
  const first = theirs[30];

  // The whole wall (done means 2): the museum holds more than one pool (60 against WANDER_POOL_MAX 16); a visitor who
  // keeps walking meets every work, not only the pool's best sixteen.
  { const met = new Set(); const seen = [];
    for (let i = 0; i < 400 && met.size < theirs.length; i++) { const j = await (await fetch(`${base}/api/stroll?n=8&maker=the-old-hall&seen=${encodeURIComponent(seen.slice(-300).join(','))}`)).json(); for (const w of j.items) { ok(whose.get(w.slug) === 'the-old-hall', `the museum's feed holds only the museum's (${w.slug})`); met.add(w.slug); seen.push(w.slug); } } // (a pool of sixteen can be all seen: the next is drawn elsewhere on the wall)
    console.log(`   the museum's Wander met ${met.size} of ${theirs.length} works (a pool holds 16)`);
    ok(met.size === theirs.length, `a museum's Wander comes round its whole wall (met ${met.size} of ${theirs.length})`);
    // A maker's own pool is as it was: the best by grade, nothing sliced.
    const j = await (await fetch(`${base}/api/stroll?n=8&maker=mk`)).json(); ok(j.items.length === 8 && j.items.every(w => whose.get(w.slug) === 'mk'), 'a maker\'s Wander is their own work'); }

  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const sent = await (await p.request.post(base + '/send', { data: { slug: first, name: 'Ada' } })).json();
  const at = () => p.evaluate(() => new URLSearchParams(location.search).get('at'));
  const room = () => p.evaluate(() => { const m = document.querySelector('main.st'); const c = document.querySelector('.st-top .st-chip'); const r = c ? c.getBoundingClientRect() : null; return { maker: m ? m.getAttribute('data-maker') : null, q: m ? m.getAttribute('data-q') : null, chip: c ? c.textContent.trim() : '', set: !!(c && c.classList.contains('st-set')), href: c ? c.getAttribute('href') : '', box: r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), right: Math.round(r.right) } : null, vw: innerWidth }; });
  const swipe = async () => { const was = await at(); await p.evaluate(() => { const s = document.querySelector('[data-st-scroll]'); s.scrollBy({ top: s.clientHeight, behavior: 'instant' }); }); for (let i = 0; i < 30; i++) { await p.waitForTimeout(100); const now = await at(); if (now && now !== was) return now; } return null; };
  // A door: where it lands, and where the next ten swipes come from.
  const walk = async (name, url, { n = 10 } = {}) => {
    await p.goto(base + url, { waitUntil: 'load' }); await p.waitForTimeout(700);
    if (await p.evaluate(() => !!document.querySelector('main.st-gifting'))) { await p.touchscreen.tap(195, 300); await p.waitForTimeout(900); } // a sent work opens alone; a tap lets the house in
    const r = await room(); const from = [];
    for (let i = 0; i < n; i++) { const s = await swipe(); if (!s) break; from.push(whose.get(s) || '?'); }
    const count = from.reduce((a, h) => (a[h] = (a[h] || 0) + 1, a), {});
    console.log(`   ${name} | ${url.replace(first, '<work>').replace(/found\/.+/, 'found/<token>')} | chip: ${r.chip || 'none'} | next ${from.length}: ${Object.entries(count).map(([h, k]) => `${k} ${h === 'the-old-hall' ? 'the museum' : h === 'mk' ? 'the graded maker' : h}`).join(', ') || 'none'}`);
    return { r, from };
  };
  const stays = async (name, url) => {
    const { r, from } = await walk(name, url);
    ok(from.length === 10 && from.every(h => h === 'the-old-hall'), `${name}: ten swipes stay in the museum (${from.join(',')})`);
    ok(r.chip === 'The Old Hall' && r.href === '/wander', `${name}: the museum's name is on the chip, and it leaves for the open Wander ("${r.chip}" → ${r.href})`);
    ok(r.box && r.box.w > 40 && r.box.h >= 20 && r.box.x >= 0 && r.box.right <= r.vw, `${name}: the chip is on the screen (${JSON.stringify(r.box)} of ${r.vw})`);
    ok(/[?&]maker=/.test(await p.evaluate(() => location.search)), `${name}: the address keeps the room, so a return lands in it`);
  };
  console.log('   door | address | the room named | where the next ten come from');
  // Doors that arrive at a museum's work with no room named.
  await stays('Find\'s work row; the record\'s way back; Study\'s way back', `/wander?at=${first}`);
  await stays('The viewing room\'s address, on a phone', `/wander/room?at=${first}`);
  await stays('A work sent to someone', new URL(sent.url).pathname);
  await stays('An old flower link', `/flower/${first}?from=Ada`);
  // Doors that name the museum already.
  await stays('The plate\'s maker link; the museum\'s cards', `/wander?maker=the-old-hall&at=${first}`);
  await stays('Find\'s museum row; the museum\'s page', '/wander?maker=the-old-hall');
  // One press leaves, and the open Wander is as it was: the edit.
  await p.goto(`${base}/wander?at=${first}`, { waitUntil: 'load' }); await p.waitForTimeout(700);
  if (!REPORT) {
    // Left still, the room puts its chrome away (the chip with it, and it cannot be pressed); a tap on the picture
    // brings it back, as it does the rest, and the chip is then one press.
    await p.waitForTimeout(5200); let c = await p.evaluate(() => { const t = getComputedStyle(document.querySelector('.st-top')); return { o: +t.opacity, pe: t.pointerEvents, cls: document.querySelector('main.st').className }; });
    assert.ok(c.o < 0.05 && c.pe === 'none', `a still room has no chip (${JSON.stringify(c)})`);
    await p.touchscreen.tap(195, 300); await p.waitForTimeout(700); c = await p.evaluate(() => { const t = getComputedStyle(document.querySelector('.st-top')); return { o: +t.opacity, pe: t.pointerEvents }; });
    assert.ok(c.o > 0.9 && c.pe !== 'none', `a tap brings the chip back (${JSON.stringify(c)})`);
    await p.tap('.st-top .st-chip'); await p.waitForURL(u => u.pathname === '/wander' && !u.search, { timeout: 5000 }); await p.waitForTimeout(700);
    const r = await room(); assert.ok(!r.chip && !r.maker, `one press leaves the museum for the open Wander (${JSON.stringify(r)})`);
    const from = []; for (let i = 0; i < 9; i++) { const s = await swipe(); if (s) from.push(whose.get(s)); }
    assert.ok(from.length >= 8 && from.includes('mk') && from.includes('the-old-hall'), `the open Wander: the living and the past (${from.join(',')})`); console.log(`   left by the chip | /wander | chip: none | next ${from.length}: ${from.filter(h => h === 'mk').length} the graded maker, ${from.filter(h => h !== 'mk').length} the museum`); }
  // What is asked for is left as asked: a set, a word, a maker's own work, the open Wander.
  { let x = await walk('The museum\'s page, a picture tapped (a set)', `/wander?at=${first}&in=maker:the-old-hall`); ok(x.r.set && !x.r.maker, 'a set keeps its own chip'); ok(x.from.every(h => h === 'the-old-hall'), 'a museum\'s set is the museum');
    x = await walk('The collection, a picture tapped (a set)', `/wander?at=${first}&in=collection`); ok(x.r.set && x.r.chip === 'The collection' && !x.r.maker, `the collection's walk is the collection's (${x.r.chip})`);
    x = await walk('A word', `/wander?at=${first}&q=Paris`); ok(x.r.q === 'Paris' && !x.r.maker && x.r.chip === 'Paris', `a word keeps its word (${JSON.stringify(x.r)})`);
    x = await walk('A graded maker\'s work', `/wander?at=${mine[0]}`); ok(!x.r.chip && !x.r.maker, 'a maker\'s work opens the open Wander, with no room named');
    // The open Wander (Will, 28 Nov: the makers of the past among the living): thirty swipes, the share about one in
    // three (a draft, WANDER_PAST_SHARE), the living first on the first screens, and no room named.
    x = await walk('The open Wander', '/wander', { n: 30 }); const pastN = x.from.filter(h => h === 'the-old-hall').length;
    console.log(`   the open Wander's mix over 30 swipes: ${x.from.map(h => (h === 'mk' ? 'L' : 'P')).join('')} (L a living maker's, P a museum's): ${pastN} of ${x.from.length} from the museum`);
    ok(!x.r.chip, 'the open Wander names no room');
    if (!REPORT) { assert.ok(x.from.length === 30 && pastN >= 5 && pastN <= 15, `about one in three of the open Wander is the past's (${pastN} of ${x.from.length})`);
      assert.ok(x.from[0] === 'mk' && whose.get(await p.evaluate(() => document.querySelector('.st-i').getAttribute('data-slug'))) === 'mk', 'the living come first: the first two screens are a living maker\'s');
      // Standing before a museum's work in the open Wander, a return to it (a reload, back from its record) is a
      // return to the open Wander: the museum is entered by its doors, not by looking at one of its works.
      const here = await at(); let on = here, tries = 0; while (whose.get(on) !== 'the-old-hall' && tries++ < 12) on = await swipe();
      assert.strictEqual(whose.get(on), 'the-old-hall', 'the open Wander reached a museum\'s work');
      await p.goto(`${base}/wander?at=${on}`, { waitUntil: 'load' }); await p.waitForURL(u => /all=1/.test(u.search) || true, { timeout: 3000 }); await p.waitForTimeout(900);
      const r = await room(); assert.ok(!r.chip && !r.maker, `back at a museum's work met in the open Wander: still the open Wander (${JSON.stringify(r)})`);
      const nx = []; for (let i = 0; i < 9; i++) { const sl = await swipe(); if (sl) nx.push(whose.get(sl)); } assert.ok(nx.includes('mk'), `and it walks on as the open Wander (${nx.join(',')})`);
      // The same address in a tab that was not standing there (a link sent, Find's row) arrives in the museum.
      const p2 = await ctx.newPage(); await p2.goto(`${base}/wander?at=${on}`, { waitUntil: 'load' }); await p2.waitForTimeout(500);
      assert.strictEqual(await p2.evaluate(() => (document.querySelector('.st-top .st-chip') || {}).textContent || ''), 'The Old Hall', 'the same address, arrived at fresh, is the museum'); await p2.close(); } }
  // Find opens with the museums first, each to its own Wander: two presses from Wander.
  if (!REPORT) {
    await p.goto(base + '/wander', { waitUntil: 'load' }); await p.waitForTimeout(700);
    await p.tap('.tb [data-find-open], .tb a[href="/find"]'); await p.waitForSelector('.fd-w, .fd-way', { timeout: 5000 });
    const f = await p.evaluate(() => { const k = document.querySelector('.fd-k'); const a = document.querySelector('a.fd-way'); const first = document.querySelector('.fd-k ~ a, .fd-ways a'); return { k: k ? k.textContent.trim() : '', first: first === a, href: a ? a.getAttribute('href') : '', text: a ? a.textContent.replace(/\s+/g, ' ').trim() : '', img: a && a.querySelector('img') ? a.querySelector('img').getAttribute('src') : '' }; });
    assert.ok(f.k === 'Museums' && f.first, `Find opens with the museums (${JSON.stringify(f)})`);
    assert.ok(f.href === '/wander?maker=the-old-hall', `the museum's row goes to its Wander (${f.href})`);
    assert.ok(/The Old Hall/.test(f.text) && /60 works/.test(f.text) && /^\/img\/.+\/thumb$/.test(f.img), `the row has the name, the count and a cover (${f.text}; ${f.img})`);
    await p.tap('a.fd-way'); await p.waitForURL(u => u.pathname === '/wander' && /maker=the-old-hall/.test(u.search), { timeout: 5000 }); await p.waitForTimeout(600);
    assert.strictEqual((await room()).chip, 'The Old Hall', 'two presses from Wander: Find, the museum');
    // The page, for a typed address or no script.
    const html = await (await fetch(base + '/find')).text(); const i = html.indexOf('class="fd-k"'); const way = /<p class="fd-k">Museums<\/p><div class="fd-ways"><a class="fd-way" href="\/wander\?maker=the-old-hall"><img src="\/img\/[^"]+\/thumb"[^>]*><b>The Old Hall<\/b><small>Leiden · 60 works<\/small>/.exec(html);
    assert.ok(way && way.index < i + 20, 'the Find page opens with the museums too');
    console.log('   Find from Wander: Museums first → /wander?maker=the-old-hall');
  }
  if (!REPORT) assert.deepStrictEqual(errs, [], 'no page errors');
  await browser.close(); srv.close();
  console.log(REPORT ? 'report: the doors, as this house walks them' : 'ok: a museum\'s Wander stays in the museum, comes round whole, names its room and lets you leave');
})().catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } setTimeout(() => process.exit(), 50); });
