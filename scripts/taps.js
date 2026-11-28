// The presses, counted (#242; Will, 28 Nov: "how are we going to allow people to navigate the site where they could get
// to pretty much anything in three or four clicks… it needs to be so easy and so clear what is on the site").
//
// An in-process test house holding one of each kind of thing a visitor can want, walked in a real browser the size of
// an iPhone 13, with touch, by a stranger who starts at `/`. For each thing in THINGS the walk finds the fewest presses
// that reach it, pressing only what is on the screen:
//   - a press on a control that can be seen and pressed where the page stands counts one;
//   - a control that has to be scrolled to (down a page, or along a row) counts two: the scroll, then the press;
//   - a word typed in Find counts two (open Find, type) and one more for the press on what it finds. A typed way is
//     measured apart, as "by name": it only helps a person who already knows what the thing is called.
// The search is breadth-first by cost over the controls each screen shows (FAN at most a screen). A link's far side is
// opened by its address while searching; a button is pressed. Then every way found is walked again from `/` with real
// touches, one control at a time, and must arrive: a way that cannot be pressed is not counted.
// Each control on a way is read for its words: a control with no words to see, or a last press whose words do not
// name the thing (SAYS), is "not plainly named".
// Fails (exit 1) when a thing takes more than MAX presses, or cannot be reached without typing its name, unless it is
// on ALLOW with its issue. A line on ALLOW that is no longer needed fails too, so the list only shrinks.
// Run: `CHROME=/path/to/chrome node scripts/taps.js` (TAPS_MD=file writes the table; TAPS_DEBUG=1 says what each
// screen showed). About two and a half minutes on the workers' machine, so it is not one of CI's jobs: run it before
// a change to the bar, Discover, Find's opening state or Wander's plate, and put its table in the pull request.
'use strict';
process.env.NODE_ENV = 'test';
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { chromium, devices } = require('playwright');
const { createApp } = require('../src/app');

const MAX = 4;        // more presses than this fails
const GOAL = 3;       // the table marks what is over this
const FAN = 90;       // controls read from one screen, the bars first
const DEBUG = !!process.env.TAPS_DEBUG;

// What a visitor can want. `at`: the address that is the thing (tested on the path with its query, decoded).
// `says`: the words a newcomer would look for on the last press. `word`: what they would type in Find.
const THINGS = h => [
  { key: 'museum', name: 'A named museum’s collection (the Harbour Museum)', at: u => u.path === '/m/' + h.museum || (u.path === '/wander' && [u.get('maker'), u.get('in')].some(v => v === h.museum || v === 'maker:' + h.museum || v === 'museum:' + h.museum)), says: /harbour museum/i, word: 'Harbour Museum' },
  { key: 'artist', name: 'A named artist (Claude Monet)', at: u => u.path === '/art/' + h.artist || u.path === '/wander/art/' + h.artist || u.get('in') === 'artist:' + h.artist, says: /monet/i, word: 'Monet' },
  { key: 'movement', name: 'A movement (Impressionism)', at: u => u.get('in') === 'movement:Impressionism' || u.get('movement') === 'Impressionism', says: /impressionism/i, word: 'Impressionism' },
  { key: 'decade', name: 'A decade (the 1870s)', at: u => u.get('in') === 'decade:1870', says: /1870s/i, word: '1870s' },
  { key: 'place', name: 'A place (Lisbon)', at: u => u.path === '/wander' && (u.get('in') === 'place:Lisbon' || u.get('q') === 'Lisbon'), says: /lisbon/i, word: 'Lisbon' },
  { key: 'paintings', name: 'A kind of work: paintings', at: u => u.get('in') === 'kind:painting', says: /painting/i, word: 'paintings' },
  { key: 'sculpture', name: 'A kind of work: sculpture', at: u => u.get('in') === 'kind:sculpture', says: /sculpture/i, word: 'sculpture' },
  { key: 'prints', name: 'A kind of work: prints', at: u => u.get('in') === 'kind:print', says: /print/i, word: 'prints' },
  { key: 'photographs', name: 'A kind of work: photographs', at: u => u.get('in') === 'kind:photograph', says: /photograph/i, word: 'photographs' },
  { key: 'maker', name: 'A living maker’s page (Mira Kell)', at: u => u.path === '/m/' + h.maker, says: /mira kell/i, word: 'Mira Kell' },
  { key: 'book', name: 'A book (A Book of the House)', at: u => u.path === '/read/a-book', says: /book of the house/i, word: 'Book of the House' },
  { key: 'gallery', name: 'One’s own gallery', at: u => u.path === '/yours', says: /\byou\b|your gallery/i, word: 'my gallery' },
  { key: 'keep', name: 'How to keep one’s work here', at: u => u.path === '/makers' || u.path === '/join', says: /keep your work|open your studio|for photographers/i, word: 'keep my work' },
  { key: 'collecting', name: 'How collecting works', at: u => u.path === '/start', says: /how (it|the house|collecting) works|collect/i, word: 'collecting' },
  { key: 'register', name: 'The register', at: u => u.path === '/ledger', says: /register/i, word: 'register' },
  // The work a stranger is shown first: its page, or the Watermark sheet over it (the asset, its number, its terms).
  { key: 'record', name: 'The record of the work on screen', at: (u, slug) => !!slug && (u.path === '/w/' + slug || new RegExp('^/m/[^/]+/' + slug + '$').test(u.path)), says: /record|papers|its terms|about this work/i, word: null },
];

// Found and filed, not yet mended: the thing's key, its issue, and why. A new thing over MAX fails.
const ALLOW = [
];

const lines = [];
const say = s => { lines.push(s); console.log(s); };

async function seed(app, dir) {
  const { db } = app.locals; let k = 0;
  const pic = async (wd, ht) => { const f = path.join(dir, `t-${++k}.jpg`); const svg = `<svg width="${wd}" height="${ht}"><rect width="${wd}" height="${ht}" fill="hsl(${k * 47 % 360},40%,${30 + k * 5 % 40}%)"/><circle cx="${wd * (0.2 + (k % 5) * 0.15)}" cy="${ht * 0.45}" r="${ht * 0.22}" fill="hsl(${(k * 47 + 180) % 360},55%,70%)"/></svg>`; await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(f); return f; };
  const put = async (title, makerId, set = {}) => { const f = await pic(k % 2 ? 1600 : 1000, k % 2 ? 1000 : 1500); const w = await app.locals.registerWork({ file: f, title, makerId, originalName: path.basename(f), kind: set.kind, place: set.place }); db.prepare("UPDATE works SET status='held', stars=5, curated=1 WHERE slug=?").run(w.slug); for (const [c, v] of Object.entries(set.cols || {})) db.prepare(`UPDATE works SET ${c}=? WHERE slug=?`).run(v, w.slug); return w.slug; };
  // A museum (an invented one: the house never speaks for a real museum) holding the old work: an artist of the hall
  // with his movement and his decade, and one of each kind.
  db.prepare("INSERT INTO makers (handle, name, kind, place, joined_at, door) VALUES ('harbour-museum', 'The Harbour Museum', 'institution', 'Rotterdam', datetime('now'), 'house')").run();
  const museum = db.prepare("SELECT * FROM makers WHERE handle='harbour-museum'").get();
  const monet = app.locals.art.ensure('Claude Monet', { born: 1840, died: 1926, movement: 'Impressionism', nationality: 'French' });
  const old = { artist_id: monet.id, open: 'pd', hall: 1 };
  await put('Impression, Sunrise', museum.id, { kind: 'painting', cols: { ...old, taken_at: '1872-11-13' } });
  await put('The Seine at Argenteuil', museum.id, { kind: 'painting', cols: { ...old, taken_at: '1875-06-01' } });
  await put('A Seated Figure', museum.id, { kind: 'sculpture', cols: { open: 'pd', taken_at: '1878-01-01' } });
  await put('The Harbour, an etching', museum.id, { kind: 'print', cols: { open: 'pd', taken_at: '1874-01-01' } });
  await put('A View of the Quay', museum.id, { kind: 'print', cols: { open: 'pd', taken_at: '1891-01-01' } });
  // A living maker with photographs of a place.
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('mira-kell','Mira Kell','mira@example.com','maker',datetime('now'),'house')").run();
  const mk = db.prepare("SELECT * FROM makers WHERE handle='mira-kell'").get();
  for (let i = 0; i < 6; i++) await put(`Lisbon, frame ${i + 1}`, mk.id, { kind: 'photograph', place: 'Lisbon', cols: { taken_at: `2024-0${i + 1}-10` } });
  // A book of the Library.
  const body = ['## The first chapter', ...Array.from({ length: 12 }, (_, i) => `A paragraph of the first chapter, number ${i + 1}, long enough to wrap across the measure of a page.`), '## The second chapter', ...Array.from({ length: 12 }, (_, i) => `A paragraph of the second chapter, number ${i + 1}.`)].join('\n\n');
  db.prepare("INSERT INTO texts (slug, kind, title, author, body, public, status, source, terms) VALUES ('a-book','book','A Book of the House','An Author',?,1,'held','https://www.gutenberg.org/','Public domain.')").run(body);
  if (app.locals.findIndexDirty) app.locals.findIndexDirty();
  const V = require('../src/views');
  return { museum: V.makerSlug ? V.makerSlug(museum) : museum.handle, museumHandle: museum.handle, maker: V.makerSlug ? V.makerSlug(mk) : mk.handle, artist: db.prepare('SELECT slug FROM artists WHERE id=?').get(monet.id).slug };
}

// Read in the page: every control that shows, what it says, and whether it can be pressed where the page stands
// (`near`) or must be scrolled to. With a sheet open (Find, the Watermark) only the sheet's controls are there.
function readScreen(FAN) {
  const vw = innerWidth, vh = innerHeight;
  const seen = e => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return false; if (n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true' || n.inert) return false; if (n.tagName === 'DETAILS' && !n.open && !(e.tagName === 'SUMMARY' && e.parentElement === n)) return false; } return getComputedStyle(e).pointerEvents !== 'none'; };
  const words = e => (e.innerText || '').replace(/\s+/g, ' ').trim();
  const label = e => words(e) || e.getAttribute('aria-label') || e.getAttribute('title') || (e.querySelector('img[alt]:not([alt=""])') || { alt: '' }).alt || '';
  const where = e => e.closest('nav.tb') ? 'the bar' : e.closest('.fd') ? 'Find' : e.closest('[role="dialog"]') ? 'the sheet' : (h => h && (!h.closest('main') || h.closest('main.st')))(e.closest('header')) ? 'the top bar' : e.closest('footer') ? 'the footer' : e.closest('main.st') ? 'Wander' : 'the page';
  const dialogs = [].filter.call(document.querySelectorAll('[role="dialog"]'), d => seen(d) && d.getBoundingClientRect().height > 40);
  const top = dialogs[dialogs.length - 1] || null;
  const out = [];
  for (const e of document.querySelectorAll('a[href], button, summary, [role="button"]')) {
    if (e.disabled || !seen(e) || (top && !top.contains(e))) continue;
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const inView = cx >= 0 && cx < vw && cy >= 0 && cy < vh;
    let near = false;
    if (inView) { const hit = document.elementFromPoint(cx, cy); near = !!hit && (e.contains(hit) || (hit.contains(e) && hit.closest('a,button,summary') === e)); }
    let fixed = false; for (let n = e; n && n.nodeType === 1; n = n.parentElement) if (getComputedStyle(n).position === 'fixed' && n !== top) fixed = true;
    if (!near && (inView || fixed)) continue; // under something, and no scroll will bring it out
    // Wander: a control on another picture's sheet is not on this screen; the scroll that reaches it changes the picture.
    const slide = e.closest('.st-i'); if (slide && !near) continue;
    const a = e.tagName === 'A' ? e : null; let href = null, ext = false;
    if (a) { const u = new URL(a.href, location.href); ext = u.origin !== location.origin || !/^https?:$/.test(u.protocol) || a.target === '_blank' || a.hasAttribute('download'); href = u.pathname + u.search + u.hash; }
    out.push({ tag: e.tagName.toLowerCase(), cls: String(e.className || ''), href, ext, label: label(e).slice(0, 90), words: words(e).slice(0, 90), near, slide: !!slide, where: where(e), screens: +(Math.max(0, r.top + (top ? 0 : scrollY)) / vh).toFixed(1), form: !a && !!e.closest('form') && (e.getAttribute('type') || 'submit') === 'submit' });
  }
  const rank = { 'the bar': 0, Find: 0, 'the sheet': 0, 'the top bar': 1, Wander: 2, 'the page': 3, 'the footer': 4 };
  out.sort((x, y) => (x.near === y.near ? 0 : x.near ? -1 : 1) || rank[x.where] - rank[y.where]);
  const cur = [].find.call(document.querySelectorAll('.st-i[data-slug]'), s => { const r = s.getBoundingClientRect(); return r.top < vh / 2 && r.bottom > vh / 2; });
  return { url: location.pathname + location.search + location.hash, controls: out.slice(0, FAN), all: out.length, slug: cur ? cur.getAttribute('data-slug') : null, sheets: dialogs.map(d => d.getAttribute('aria-label') || d.className), title: document.title, coarse: matchMedia('(pointer:coarse)').matches, bar: (() => { const b = document.querySelector('nav.tb'); return b ? [].map.call(b.querySelectorAll('span'), x => x.textContent).join(' · ') : ''; })() };
}

(async () => {
  const t0 = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-taps-'));
  let browser, srv, code = 0;
  try {
    const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'taps', noTimers: true, vaultNow: true });
    srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
    const house = await seed(app, dir); const T = { seed: Date.now() - t0 }; let tp = Date.now(); const lap = k => { T[k] = Date.now() - tp; tp = Date.now(); };
    browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
    const errs = []; let loads = 0;
    // A stranger every time: a new context (no cookie, nothing kept) for each screen read and each way walked.
    const open = async () => { const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' }); await ctx.route(/fonts\.googleapis|fonts\.gstatic/, r => r.abort()); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); try { const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); } catch (e) { /* a phone's coarse pointer; the walk says below if it is missing */ } return p; };
    // Read when the screen has come to rest: a room fades in, and a control under the fade is not yet there to press.
    const read = async (p, n) => { let last = -1, s = null; for (let i = 0; i < 8; i++) { s = await p.evaluate(readScreen, n); const near = s.controls.filter(x => x.near).length; if (near && near === last) break; last = near; await p.waitForTimeout(200); } return s; };
    const shut = p => p.context().close().catch(() => {});
    const settle = async p => { try { await p.waitForLoadState('load', { timeout: 1000 }); } catch (e) { /* the pictures are still coming; the controls are there */ } await p.waitForTimeout(250); }; // read soon: Wander puts its bars away when the room goes still
    const things = THINGS(house); const dec = u => { const x = new URL(u, 'http://h'); return { path: decodeURIComponent(x.pathname), get: k => x.searchParams.get(k) }; };
    const SKIP = /^(×|back|close|share|send|hat|bravo|save|full screen|sign out|where you have been|skip to|install|play|pause)/i; // a deed or a way out, not a way in
    const DEAD = /^\/(studio|account|signout|api|img|static|feedback)(\/|$|\?)|\.(pdf|png|jpe?g|svg|epub|json|xml|txt)(\?|$)/i; // desks, files, deeds
    const same = (a, b) => a.tag === b.tag && (b.chance ? a.cls === b.cls : a.label === b.label && (a.href || '') === (b.href || '')); // a link of the picture on screen is known by its place on the plate, whichever picture it is
    const press = async (p, ctl) => {
      const s = await read(p, 400); const c = s.controls.find(x => same(x, ctl) && x.near) || s.controls.find(x => same(x, ctl));
      if (!c) throw new Error(`“${ctl.label}” is not on ${s.url}${DEBUG ? ' [' + s.sheets + '] ' + s.controls.map(x => x.label + '|' + x.href + '|' + x.near).join(' ~ ') : ''}`);
      const i = await p.evaluate(({ c }) => { const words = e => (e.innerText || '').replace(/\s+/g, ' ').trim(); const label = e => words(e) || e.getAttribute('aria-label') || e.getAttribute('title') || (e.querySelector('img[alt]:not([alt=""])') || { alt: '' }).alt || ''; const all = [...document.querySelectorAll('a[href], button, summary, [role="button"]')]; const fit = all.filter(e => e.tagName.toLowerCase() === c.tag && String(e.className || '') === c.cls && label(e).slice(0, 90) === c.label && (c.href == null || (() => { const u = new URL(e.href, location.href); return u.pathname + u.search + u.hash === c.href; })())); const vis = fit.filter(e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; }); const near = vis.find(e => { const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h && (e.contains(h) || h.contains(e)); }); const e = near || vis[0]; if (!e) return -1; e.setAttribute('data-taps-press', '1'); return 1; }, { c });
      if (i < 0) throw new Error(`“${ctl.label}” cannot be found to press on ${s.url}`);
      const loc = p.locator('[data-taps-press]').first();
      if (!c.near) await loc.scrollIntoViewIfNeeded({ timeout: 4000 });
      await loc.tap({ timeout: 5000, noWaitAfter: true });
      await p.evaluate(() => { const e = document.querySelector('[data-taps-press]'); if (e) e.removeAttribute('data-taps-press'); }).catch(() => {});
      await settle(p);
    };
    const arrive = async st => { loads++; const ta = Date.now(); const p = await open(); const tb = Date.now(); try { const r = await p.goto(base + st.url, { waitUntil: 'domcontentloaded' }); await settle(p); for (const op of st.ops) await press(p, op); const s = await read(p, FAN); s.status = r ? r.status() : 0; s.ms = [tb - ta, Date.now() - tb]; return s; } finally { await shut(p); } };
    if (process.env.TAPS_DUMP) { for (const u of process.env.TAPS_DUMP.split(',')) { const s = await arrive({ url: u, ops: [] }); say(`== ${u} -> ${s.url} (${s.title}) sheets=${s.sheets} slug=${s.slug} all=${s.all}`); for (const c of s.controls) say(`  ${c.near ? 'near' : 'far '} [${c.where}] ${c.tag} "${c.label}" ${c.href || ''} ${c.screens}`); } return; }

    // The first screen.
    const first = await arrive({ url: '/', ops: [] });
    if (!first.coarse) say('note: the browser did not take a coarse pointer; the phone layout may not be the one walked');
    say(`The first screen: / opens ${first.url.replace(/\?.*/, '')} on “${first.slug}”; the bar reads ${first.bar}.`);
    // Wander puts its bar away when the picture has been left alone; a person who has looked a while needs a touch first.
    let still = null; { const p = await open(); try { await p.goto(base + '/', { waitUntil: 'domcontentloaded' }); await settle(p); await p.waitForTimeout(7000); const a = await p.evaluate(readScreen, FAN); const away = !a.controls.some(x => x.where === 'the bar' && x.near); let back = null; if (away) { const vp = devices['iPhone 13'].viewport; await p.touchscreen.tap(Math.round(vp.width / 2), Math.round(vp.height / 3)); await p.waitForTimeout(900); const b = await p.evaluate(readScreen, FAN); back = b.controls.some(x => x.where === 'the bar' && x.near); } still = { away, back }; } finally { await shut(p); } }
    say(still.away ? `After seven seconds on the first picture the bar is away; one touch on the picture ${still.back ? 'brings it back' : 'did NOT bring it back'}: every count below that begins on the bar is one more for a person who has stood that long.` : 'After seven seconds on the first picture the bar is still there.');
    const found = {}, viaDiscover = {}; // key -> { cost, path, bad }
    const step = (c, from) => ({ tag: c.tag, cls: c.cls, label: c.label, words: c.words, href: c.href, near: c.near, where: c.where, screens: c.screens, on: from });
    const cost = path => path.reduce((n, s) => n + (s.near ? 1 : 2), 0);
    const plainOf = (t, path) => { const bad = []; path.forEach((s, i) => { if (!s.words) bad.push(`“${s.label}” has no words to see`); else if (i === path.length - 1 && !t.says.test(s.words)) bad.push(`“${s.words}” does not name it`); }); return bad; };
    const offer = (t, path) => { const c = cost(path), bad = plainOf(t, path), was = found[t.key]; if (path[0].href === '/look' && path[0].where === 'the bar' && (!viaDiscover[t.key] || c < viaDiscover[t.key].cost)) viaDiscover[t.key] = { cost: c, path, bad }; if (!was || c < was.cost || (c === was.cost && bad.length < was.bad.length)) { found[t.key] = { cost: c, path, bad }; if (DEBUG) say(`  found ${t.key} in ${c}: ${path.map(s => s.label).join(' > ')}`); } };
    const hit = (u, slug) => things.filter(t => t.at(dec(u), slug));
    const buckets = Array.from({ length: MAX + 2 }, () => []); const seenUrl = new Map(), seenScreen = new Set();
    buckets[0].push({ url: '/', ops: [], path: [] }); const firstButtons = new Set(first.controls.filter(x => !x.href).map(x => x.label));
    for (let c = 0; c <= MAX; c++) {
      for (const st of buckets[c]) {
        if (c === MAX && things.every(t => found[t.key])) break;
        let s; try { s = await arrive(st); } catch (e) { if (DEBUG) say(`  could not arrive: ${st.path.map(x => x.label).join(' > ')}: ${String(e.message).split('\n')[0]}`); continue; }
        if (s.status >= 400) continue;
        const front = st.url === '/' || /^\/wander(\?at=[^&]*)?$/.test(s.url); // the open feed: which picture is on screen is chance
        const sig = s.url.replace(/#.*/, '') + '|' + s.sheets.join(',') + '|' + s.controls.filter(x => x.near).map(x => x.label + (x.href || '')).join('~');
        if (seenScreen.has(sig)) continue; seenScreen.add(sig);
        // What the screen itself is: an address a press was sent on to, or a sheet over the work.
        if (st.path.length) { for (const t of hit(s.url, null)) offer(t, st.path); if (st.url === '/' && s.sheets.some(x => /watermark/i.test(x))) offer(things.find(t => t.key === 'record'), st.path); }
        if (DEBUG) say(`[${c}] ${st.path.map(x => x.label).join(' > ') || '/'} -> ${s.url} ${s.sheets.length ? '(' + s.sheets + ')' : ''}: ${s.controls.filter(x => x.near).length} near, ${s.all} in all, ${s.ms} ms`);
        if (c === MAX) continue;
        for (const ctl of s.controls) {
          if (ctl.ext || ctl.form || SKIP.test(ctl.label) || !ctl.label) continue;
          if (c > 0 && !s.sheets.length && (ctl.where === 'the bar' || (!ctl.href && /^find$/i.test(ctl.label)))) continue; // the bar and Find are the same in every room: the first screen has pressed them
          if (c > 0 && st.url !== '/' && !ctl.href && firstButtons.has(ctl.label)) continue; // so is Wander's rail on every picture
          const nc = c + (ctl.near ? 1 : 2); if (nc > MAX) continue;
          const chance = front && !!ctl.href && (ctl.slide || ctl.where === 'the sheet'); // a link of the picture that happened to be first, or of its sheet
          const path = st.path.concat([{ ...step(ctl, s.url), chance }]);
          if (ctl.href) {
            if (DEAD.test(ctl.href)) continue;
            for (const t of hit(ctl.href, st.url === '/' ? s.slug : null)) if (!chance || t.key === 'record') offer(t, path);
            if (chance) continue; // not a way a newcomer can count on
            const u = ctl.href.replace(/#.*/, '') === s.url.replace(/#.*/, '') ? null : ctl.href; // a jump down the same page shows nothing a scroll does not
            if (!u || (seenUrl.has(u) && seenUrl.get(u) <= nc)) continue; seenUrl.set(u, nc);
            buckets[nc].push({ url: u, ops: [], path });
          } else buckets[nc].push({ url: st.url, ops: st.ops.concat([ctl]), path });
        }
      }
      if (things.every(t => found[t.key] && found[t.key].cost <= c + 1)) break;
    }

    lap('search');
    // Each way, walked again from the first screen with real touches.
    const walk = async (t, path) => {
      const q = await open();
      try {
        await q.goto(base + '/', { waitUntil: 'domcontentloaded' }); await settle(q);
        const s0 = await read(q, 10);
        for (const s of path) await press(q, s);
        const s = await read(q, 10);
        if (!(t.at(dec(s.url), s0.slug) || (t.key === 'record' && s.sheets.some(x => /watermark/i.test(x))))) throw new Error(`the presses ended on ${s.url}`);
      } finally { await shut(q); }
    };
    for (const t of things) { const f = found[t.key]; if (!f) continue; try { await walk(t, f.path); f.walked = true; } catch (e) { f.walked = false; f.why = String(e.message).split('\n')[0]; } }

    lap('walks');
    // By name: open Find, type the word, press what it finds.
    const typed = {};
    for (const t of things) {
      if (!t.word) continue;
      const q = await open();
      try {
        await q.goto(base + '/', { waitUntil: 'domcontentloaded' }); await settle(q);
        await q.locator('nav.tb [data-find-open]').tap({ timeout: 5000, noWaitAfter: true }); await settle(q);
        await q.locator('.fd input[type="search"]').pressSequentially(t.word, { delay: 20 }); await q.waitForTimeout(400); await settle(q);
        const s = await read(q, 400); const c = s.controls.find(x => x.href && x.near && t.at(dec(x.href))) || s.controls.find(x => x.href && t.at(dec(x.href)));
        if (!c) { typed[t.key] = { none: true, saw: s.controls.filter(x => x.where === 'Find' && x.href).slice(0, 8).map(x => `${x.label} (${x.href})`) }; continue; }
        await press(q, c); const e = await read(q, 5);
        typed[t.key] = t.at(dec(e.url)) || t.at(dec(c.href)) ? { cost: 2 + (c.near ? 1 : 2), label: c.label } : { none: true };
      } catch (e) { typed[t.key] = { none: true, why: String(e.message).split('\n')[0] }; }
      finally { await shut(q); }
    }

    lap('typed');
    // The table.
    const way = f => f.path.map(s => `${s.near ? '' : `scroll (${s.screens} screen${s.screens === 1 ? '' : 's'} down), `}${s.words || `[${s.label}]`} (${s.chance ? 'the plate of the picture on screen' : s.where})`).join(' → ');
    const rows = things.map(t => { const f = found[t.key], ty = typed[t.key]; return { t, f, ty, n: f && f.walked ? f.cost : null }; });
    const md = ['| The thing | The fewest presses | Presses | Plainly named? | Through Discover | By name in Find |', '|---|---|---|---|---|---|'];
    for (const r of rows) md.push(`| ${r.t.name} | ${r.f ? way(r.f) + (r.f.walked ? '' : ` (NOT walked: ${r.f.why})`) : `none within ${MAX}`} | ${r.n == null ? `over ${MAX}` : r.n} | ${!r.f ? 'n/a' : r.f.bad.length ? 'no: ' + r.f.bad.join('; ') : 'yes'} | ${viaDiscover[r.t.key] ? `${viaDiscover[r.t.key].cost}: ${way(viaDiscover[r.t.key]).replace(/^Discover \(the bar\) → /, '')}` : 'none found'} | ${!r.t.word ? 'n/a' : !r.ty || r.ty.none ? `“${r.t.word}”: not found${r.ty && r.ty.saw && r.ty.saw.length ? ' (it offers ' + r.ty.saw.join('; ') + ')' : ''}` : `“${r.t.word}”: ${r.ty.cost}`} |`);
    say(''); for (const l of md) say(l); say('');
    if (process.env.TAPS_MD) fs.writeFileSync(process.env.TAPS_MD, md.join('\n') + '\n');
    // The fence.
    const over = rows.filter(r => r.n == null || r.n > MAX), used = new Set();
    for (const r of over) { const a = ALLOW.find(x => x.key === r.t.key); if (a) { used.add(a.key); say(`allowed (#${a.issue}): ${r.t.name}: ${a.why}`); } else { say(`FAIL: ${r.t.name} takes ${r.n == null ? `more than ${MAX} presses, or cannot be reached without typing its name` : r.n + ' presses'}`); code = 1; } }
    for (const a of ALLOW) if (!used.has(a.key)) { say(`FAIL: “${a.key}” is on ALLOW (#${a.issue}) and no longer needs to be: take the line out`); code = 1; }
    const soft = rows.filter(r => r.n != null && r.n > GOAL && r.n <= MAX); if (soft.length) say(`over ${GOAL}, within ${MAX}: ${soft.map(r => `${r.t.name} (${r.n})`).join('; ')}`);
    if (errs.length) say(`script errors met on the way: ${[...new Set(errs)].slice(0, 5).join(' | ')}`);
    say(`${code ? 'taps: FAILED' : 'taps: all within ' + MAX}; ${loads} screens read in ${Math.round((Date.now() - t0) / 1000)} s (${Object.entries(T).map(([k, v]) => `${k} ${Math.round(v / 1000)}`).join(', ')})`);
  } catch (e) { console.error(e); code = 1; }
  finally {
    try { if (browser) await browser.close(); } catch (e) { /* */ }
    try { if (srv) srv.close(); } catch (e) { /* */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
    process.exitCode = code; setTimeout(() => process.exit(), 50);
  }
})();
