// The reach walk (#42; Will, 15 Nov, on an iPad: "a lot of pages within House and Studio are just not clickable… on the
// Studio page, sometimes it feels like the top bar doesn't work… make sure that every single thing is clickable in every
// rotation and orientation… every navigational point, the backs").
//
// An in-process test house (works, a maker, the Studio, a volume, an album, a book) walked in a real browser with touch.
// For every control that is shown (link, button, summary, input, select, textarea, [role=button]):
//   - covered:   scrolled into view (block centre), the point at its centre (and most of four inset corners) belongs to
//                it, or to a label for it; else the thing over it is named, with its pointer-events, opacity, z-index.
//   - invisible: it takes presses but cannot be seen (opacity under .05 all the way up, pointer-events not none).
//   - stranded:  it cannot be brought onto the screen.
//   - inert:     it shows (opacity over .5) but takes no presses (pointer-events: none).
//   - wide:      the page is wider than the screen (the browser zooms it all out, or it scrolls sideways), at every
//                size and after the turn; never on ALLOW (#46): a wide table or line scrolls in its own box.
//   - small:     under 24×24, unless it is a link in running text or (outside a fixed or sticky bar) nothing else is
//                within a 24 px square of its centre (WCAG 2.5.8's spacing allowance).
//   - bar:       at the top of the page and at its foot (where scrolling cannot move it), a control under a fixed or
//                sticky bar; and at the top, halfway and the foot, a bar's own control that is covered.
//                A sticky bar its room has begun to push off the screen is leaving with the page, not a bar, then.
//   - tap:       the top bar's controls (Back, the menu, the desk's tabs, Find, the tab bar) are pressed for real, a
//                touch on a touch screen, at the top and after scrolling halfway: the press must reach the control.
//   - does:      on one page per person and size, Back, the menu and each desk tab are pressed and must do what they say.
//   - rotation:  on every page walked at iPad portrait, the page is turned to landscape and back, and every control is
//                scrolled to and hit-tested again (covered, stranded, small, invisible).
// Sizes: iPad portrait 820×1180 and iPad landscape 1180×820 walk every page; iPad mini 744×1133, phone 390×844 and desk
// 1440×900 walk the smaller set SMALL below. People: signed out (DOORS and the house's own pages), a maker by email code
// (the maker's and the collector's rooms), the Studio by its password (the house's rooms).
// Faults found and filed rather than fixed are on ALLOW, each with its issue; a new fault fails. Exit 1 on any fault.
// Run: `npm run reach` (PW_CHANNEL=chrome on a machine with Chrome but not Playwright's own Chromium; REACH_FONTS=dir
// where Google's fonts cannot be reached, or the words are narrower than in CI and the walk sees another house).
// `REACH_ONLY=/studio/volumes,/account` walks just those; `REACH_SIZES=ipadP` just that size; `REACH_SHOTS=dir` saves a
// picture of each fault's page.
process.env.NODE_ENV = 'test';
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { chromium } = require('playwright');
const ENGINE = require('./engine'); ENGINE.guard('reach');
const { createApp } = require('../src/app');
const V = require('../src/views');

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const SIZES = {
  ipadP: { viewport: { width: 820, height: 1180 }, ua: IPAD_UA, touch: true, full: true },
  ipadL: { viewport: { width: 1180, height: 820 }, ua: IPAD_UA, touch: true, full: true },
  mini: { viewport: { width: 744, height: 1133 }, ua: IPAD_UA, touch: true },
  phone: { viewport: { width: 390, height: 844 }, ua: IPHONE_UA, touch: true },
  desk: { viewport: { width: 1440, height: 900 }, touch: false },
};
// The browser and the device (#55). WM_ENGINE=webkit: Playwright's WebKit with Apple's own profiles (touch, the real
// user agent and scale): an iPad (gen 7) upright and turned, an iPad Mini, an iPhone 13; the desk is Safari's. The
// sizes keep their names so REACH_SIZES and the full/small lists hold. Every finding carries the engine's name.
if (ENGINE.webkit) {
  const d = ENGINE.devices, as = (dev, extra) => ({ viewport: dev.viewport, ua: dev.userAgent, touch: dev.hasTouch, dsf: dev.deviceScaleFactor, screen: dev.screen, ...extra });
  Object.assign(SIZES, { ipadP: as(d['iPad (gen 7)'], { full: true }), ipadL: as(d['iPad (gen 7) landscape'], { full: true }), mini: as(d['iPad Mini']), phone: as(d['iPhone 13']), desk: as(d['Desktop Safari'], { viewport: { width: 1440, height: 900 } }) });
}
// Seen in WebKit only and filed (kept here, apart from ALLOW, so the two lists are edited without meeting).
const ALLOW_WEBKIT = [
  // #52: the balcony's word layer over the footer; at the iPad (gen 7) turned (1080 wide) it also covers Terms.
  { page: /^\/balcony$/, control: /^a\[href="\/terms"\]$/, kind: '', issue: 52, why: 'the word layer over the footer\'s Terms (WebKit, iPad gen 7 landscape)' },
];
const launchBrowser = async () => {
  if (ENGINE.webkit) return ENGINE.launch();
  try { return await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}); }
  catch (e) { return chromium.launch({ channel: 'chrome' }); }
};
const contextFor = S => ({ viewport: S.viewport, userAgent: S.ua, hasTouch: S.touch, isMobile: S.touch, deviceScaleFactor: S.dsf || (S.touch ? 2 : 1), ...(S.screen ? { screen: S.screen } : {}) });
// WebKit: a programmatic scroll can still be easing (rubber band at an end) when elementFromPoint is asked; wait until
// the scroll position holds for two frames. Chromium is left as it was.
const scrollSettle = page => ENGINE.webkit ? page.evaluate(() => new Promise(res => { let last = -1, same = 0, n = 0; const f = () => { const y = scrollY; same = y === last ? same + 1 : 0; last = y; if (same >= 2 || ++n > 60) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); })) : Promise.resolve();
// The smaller set, walked at the iPad mini, the phone and the desk: the front, a work, Wander, the hall, a maker's
// page, a volume; the maker's studio and Library; the Studio's front, its Works, Volumes, Accounts and The numbers.
const SMALL = ['/', '/w/$slug', '/wander', '/art', '/art/$artist', '/volume/$volume', '/read/$book', '/about', '/account', '/account/table', '/account/upload', '/yours', '/studio', '/studio/trove', '/studio/volumes', '/studio/accounts', '/studio/analytics', '/studio/licenses'];
// One page per person where the top bar is pressed and must do what it says.
const DOES = { out: '/about', maker: '/account/table', studio: '/studio/volumes' };

// Found and filed, not yet fixed: page (a pattern), the control's short selector (a pattern), the kind, and its issue.
// Each line is a fault someone has to mend; it is here so the walk stays a fence for the next fault, not a pass for this one.
const ALLOW = [
];

const SETTLE_MS = 350;
const POOL = Number(process.env.REACH_POOL || 5);
const only = process.env.REACH_ONLY ? process.env.REACH_ONLY.split(',') : null;
const sizesRun = process.env.REACH_SIZES ? process.env.REACH_SIZES.split(',') : Object.keys(SIZES);
const shots = process.env.REACH_SHOTS || '';

// The probe, run in the page. mode 'centre': each control scrolled into view; mode 'here': only what is on the screen
// now, without scrolling (at the top, halfway, the foot), for bars.
function probe({ mode, edge }) {
  const SEL = 'a[href],button,summary,input:not([type=hidden]),select,textarea,[role=button]';
  const vw = innerWidth, vh = innerHeight;
  const cs = el => getComputedStyle(el);
  const short = el => {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    const a = el.getAttribute && (el.getAttribute('href') || '');
    const data = el.getAttributeNames ? el.getAttributeNames().find(n => n.startsWith('data-')) : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (c ? '.' + c : '') + (!c && data ? `[${data}]` : '') + (a && el.tagName === 'A' && !c ? `[href="${a.slice(0, 40)}"]` : '');
  };
  const words = el => (el.getAttribute('aria-label') || el.textContent || el.value || el.getAttribute('title') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const opacityUp = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= +cs(e).opacity; return o; };
  const barOf = el => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const p = cs(e).position; if (p === 'fixed' || p === 'sticky') return e; } return null; };
  // A bar as it is now: fixed, or sticky and held at its offset. A sticky box its container has begun to push off the
  // screen (its top above its offset) is leaving with the page, like any content, and is not a bar while it does (#45).
  const pinnedOf = el => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const s = cs(e); if (s.position === 'fixed') return e; if (s.position === 'sticky') { const t = parseFloat(s.top); if (isNaN(t) || e.getBoundingClientRect().top >= t - 1) return e; } } return null; };
  const who = h => h ? { tag: h.tagName.toLowerCase(), cls: (typeof h.className === 'string' ? h.className : '').slice(0, 60), sel: short(h), pe: cs(h).pointerEvents, op: +opacityUp(h).toFixed(2), z: cs(h).zIndex, pos: cs(h).position, bar: !!barOf(h) } : { tag: 'nothing' };
  const shown = el => {
    if (el.closest('[inert],[aria-hidden="true"]')) { const r = el.getBoundingClientRect(); if (el.closest('[inert]') || !r.width || !r.height) return false; }
    if (el.disabled) return false;
    if (el.getAttribute('aria-hidden') === 'true' && el.tabIndex < 0) return false; // a trap for robots (the honeypot), out of reach on purpose
    if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return false;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
    const s = cs(el); if (s.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%|inset\(100%/.test(s.clipPath)) return false; // the visually hidden pattern
    if (el.matches('a.skip') && document.activeElement !== el) return false; // the skip link waits off the screen for a key
    for (let e = el.parentElement; e; e = e.parentElement) { const p = cs(e); if ((p.clip === 'rect(0px, 0px, 0px, 0px)') || /inset\(50%|inset\(100%/.test(p.clipPath)) return false; }
    return true;
  };
  const belongs = (el, h) => !!h && (h === el || el.contains(h) || (el.labels && [...el.labels].some(l => l === h || l.contains(h))) || (h.closest && h.closest('label') && h.closest('label').control === el));
  const all = [...document.querySelectorAll(SEL)].filter(shown);
  const out = []; const seen = new Set();
  // (#109) What the page was doing at the moment of a finding, so a second look can tell a room from a walk read too early.
  const diag = el => { const run = []; for (let e = el; e && e.nodeType === 1 && run.length < 6; e = e.parentElement) for (const a of e.getAnimations ? e.getAnimations() : []) if (a.playState === 'running') run.push((a.transitionProperty || a.animationName || 'anim') + '@' + short(e) + ':' + Math.round(a.currentTime || 0)); const m = document.querySelector('main');
    return { main: m ? String(m.className).slice(0, 120) : '', t: Math.round(performance.now()), anims: run.join(' '), hover: matchMedia('(hover:hover)').matches, coarse: matchMedia('(pointer:coarse)').matches, vis: cs(el).visibility, op: +cs(el).opacity }; };
  const push = (el, kind, extra) => { const k = kind + '|' + short(el) + '|' + words(el); if (seen.has(k)) return; seen.add(k); out.push({ kind, sel: short(el), words: words(el), inBar: !!barOf(el), ...extra, ...(/^(invisible|inert|covered|bar)$/.test(kind) ? { diag: diag(el) } : {}) }); };
  // Five points: the centre and four inset corners, a quarter of the way in (so a round button's corners are its own).
  // A link that runs over two lines is tested on the first of its boxes.
  const boxOf = el => { const rs = el.getClientRects(); return cs(el).display === 'inline' && rs.length > 1 ? [...rs].find(x => x.width >= 2 && x.height >= 2) || el.getBoundingClientRect() : el.getBoundingClientRect(); };
  const pointsOf = r => {
    const cl = (v, m) => Math.min(Math.max(v, 1), m - 1);
    const cx = cl((r.left + r.right) / 2, vw), cy = cl((r.top + r.bottom) / 2, vh);
    const L = cl(r.left + r.width / 4, vw), R = cl(r.right - r.width / 4, vw), T = cl(r.top + r.height / 4, vh), B = cl(r.bottom - r.height / 4, vh);
    return [[cx, cy], [L, T], [R, T], [L, B], [R, B]];
  };
  const hitTest = el => {
    const r = boxOf(el);
    const pts = pointsOf(r); const hits = pts.map(([x, y]) => document.elementFromPoint(x, y));
    const ok = hits.map(h => belongs(el, h));
    return { r, centre: ok[0], fails: ok.filter(x => !x).length, cover: ok[0] ? hits.find((h, i) => !ok[i]) : hits[0] };
  };
  const scrolls = document.documentElement.scrollHeight > vh + 2;
  if (mode === 'centre') {
    const sx = scrollX, sy = scrollY;
    // Scrolling each control into view moves the rows that scroll inside the page (a row of tabs): put them back after.
    const inner = [...document.querySelectorAll('body *')].filter(e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map(e => [e, e.scrollLeft, e.scrollTop]);
    scrollTo({ left: 0, top: 0, behavior: 'instant' }); const rects = all.map(e => e.getBoundingClientRect());
    all.forEach((el, i) => {
      // An invisible thing that can be pressed (file, checkbox and radio inputs dressed by a visible label are the pattern).
      const op = opacityUp(el);
      // (#109) marked, so the walk can look at the same control again a moment later (still faded = held there; risen = mid-fade)
      if (op < 0.05 && cs(el).pointerEvents !== 'none' && !(el.tagName === 'INPUT' && /^(file|checkbox|radio)$/.test(el.type))) { const mark = 'i' + i; el.setAttribute('data-reach-mark', mark); push(el, 'invisible', { mark, cover: { op: +op.toFixed(2), pe: cs(el).pointerEvents } }); }
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const t = hitTest(el); const r = t.r;
      if (r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) { push(el, 'stranded', { box: [r.left, r.top, r.width, r.height].map(Math.round) }); return; }
      // Chrome put away on purpose (faded out and not taking presses: Wander's quiet bar) is hidden, not a fault; a
      // control that shows but takes no presses is.
      if (cs(el).pointerEvents === 'none') { if (op >= 0.5) push(el, 'inert', { cover: { pe: 'none', op: +op.toFixed(2) } }); return; }
      if (op >= 0.05 && (!t.centre || t.fails >= 3)) push(el, 'covered', { cover: who(t.cover), box: [r.left, r.top, r.width, r.height].map(Math.round) });
      // Size: 24×24, or a link in running text, or room around it (no other control within a 24 px square of its centre).
      const lab = el.labels && [...el.labels].map(l => l.getBoundingClientRect()).find(b => b.width >= 24 && b.height >= 24);
      if ((r.width < 24 || r.height < 24) && !lab) {
        const inline = cs(el).display === 'inline' && el.parentElement && [...el.parentElement.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        // A bar's own controls get no allowance for room around them: the bar is where people press most.
        if (!inline && barOf(el)) push(el, 'small', { box: [r.width, r.height].map(Math.round), cover: { sel: 'in a bar' } });
        else if (!inline) {
          const o = rects[i]; const cx = (o.left + o.right) / 2, cy = (o.top + o.bottom) / 2;
          const j = rects.findIndex((b, j) => j !== i && !all[j].contains(el) && !el.contains(all[j]) && b.left < cx + 12 && b.right > cx - 12 && b.top < cy + 12 && b.bottom > cy - 12);
          if (j >= 0) push(el, 'small', { box: [r.width, r.height].map(Math.round), cover: { sel: 'beside ' + short(all[j]) } });
        }
      }
    });
    for (const [e, l, t] of inner) { e.scrollLeft = l; e.scrollTop = t; }
    scrollTo({ left: sx, top: sy, behavior: 'instant' });
  } else {
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      if (opacityUp(el) < 0.05 || cs(el).pointerEvents === 'none') continue;
      const bar = pinnedOf(el); const t = hitTest(el);
      if (t.centre && t.fails < 3) continue;
      const c = t.cover; const cBar = c && pinnedOf(c);
      // A bar's own control covered (anywhere); or, where the page cannot scroll it out, a control under a bar.
      // Where scrolling cannot move it out: the top half of the screen at the top of the page, the foot half at its foot.
      const stuck = !scrolls || (edge === 'top' && r.bottom <= vh / 2) || (edge === 'foot' && r.top >= vh / 2);
      if (bar || (cBar && stuck)) push(el, 'bar', { at: edge, cover: who(c), box: [r.left, r.top, r.width, r.height].map(Math.round) });
    }
  }
  return out;
}

// The top bar's controls, as the walk names them.
const TOPBAR = 'header.top [data-nv-back]:not([hidden]), header.top a.brand, header.top .nv-find, header.top .nv-w, header.top .nv-verbs a, .dh [data-nv-back]:not([hidden]), .dh a.dh-brand, .dh .rm-b, .dh .dh-rooms > a, .dh .dh-as a, .dh .dh-find, .tb a, .tb button, .nv-float [data-nv-back]:not([hidden]), .rm-bar .rm-b';

let dir;
(async () => {
  const t0 = Date.now();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-reach-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'reach', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('mk','Mira Kell','mk@example.com','maker',datetime('now'),'house')").run();
  const mk = db.prepare("SELECT * FROM makers WHERE handle='mk'").get();
  const pic = async (name, w, h, n) => { const f = path.join(dir, name); await sharp({ create: { width: w, height: h, channels: 3, background: { r: 40 + n * 30 % 200, g: 110, b: 190 - n * 20 % 180 } } }).jpeg().toFile(f); return f; };
  const works = [];
  for (let i = 0; i < 8; i++) {
    const w = await app.locals.registerWork({ file: await pic(`i${i}.jpg`, i % 2 ? 1000 : 1600, i % 2 ? 1500 : 1000, i), title: `Frame ${i}`, place: 'Paris', originalName: `i${i}.jpg`, makerId: mk.id });
    db.prepare("UPDATE works SET status='held', stars=5, curated=1 WHERE slug=?").run(w.slug); works.push(db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug));
  }
  const slug = works[0].slug;
  // An artist of the hall with a bound volume (seven folios), opened by the Studio as the desk does.
  const artist = app.locals.art.ensure('Leonardo da Vinci', { born: 1452, died: 1519 });
  for (let n = 1; n <= 7; n++) {
    const w = await app.locals.registerWork({ file: await pic(`f${n}.jpg`, 900, 1200, n + 9), title: 'Codex Arundel, folio ' + n, originalName: `f${n}.jpg`, kind: 'drawing' });
    db.prepare("UPDATE works SET status='held', artist_id=?, kind='drawing', open='pd', hall=1 WHERE id=?").run(artist.id, w.id);
  }
  app.locals.volumes.propose({ artistId: artist.id });
  const vol = db.prepare('SELECT * FROM volumes').get();
  const artistSlug = db.prepare('SELECT slug FROM artists WHERE id=?').get(artist.id).slug;
  // A book of the Library.
  const bookBody = ['## The first chapter', ...Array.from({ length: 30 }, (_, i) => `A paragraph of the first chapter, number ${i + 1}, long enough to wrap across the measure of a page as a reader would see it.`), '## The second chapter', ...Array.from({ length: 30 }, (_, i) => `A paragraph of the second chapter, number ${i + 1}.`)].join('\n\n');
  db.prepare("INSERT INTO texts (slug, kind, title, author, body, public, status, source, terms) VALUES ('a-book','book','A Book of the House','An Author',?,1,'held','https://www.gutenberg.org/','Public domain.')").run(bookBody);
  // An album for a client.
  const dv = Number(db.prepare("INSERT INTO deliveries (token, maker_id, title, client_name) VALUES ('reachtok', ?, 'For Rae', 'Rae')").run(mk.id).lastInsertRowid);
  works.slice(0, 4).forEach((w, i) => db.prepare('INSERT INTO delivery_works (delivery_id, work_id, pos, ref) VALUES (?,?,?,?)').run(dv, w.id, i, 'R' + i));

  const cookiesOf = r => (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(c => { const kv = c.split(';')[0]; const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: base }; }).filter(c => c.name !== 'wm_hi');
  const post = (p, body, json, cookie) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { origin: base, ...(cookie ? { cookie } : {}), 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded' }, body: json ? JSON.stringify(body) : new URLSearchParams(body).toString() });
  await post('/signin/code', { email: 'mk@example.com' }, true);
  const makerCookies = cookiesOf(await post('/signin/verify', { email: 'mk@example.com', code: app.locals.lastCode.code }, true));
  const studioCookies = cookiesOf(await post('/studio/login', { password: 'pw' }));
  if (!makerCookies.length || !studioCookies.length) throw new Error('could not sign in the maker or the Studio');
  const sc = studioCookies.map(c => `${c.name}=${c.value}`).join('; ');
  const opened = await post('/studio/volumes/' + vol.id, { title: 'Codex Arundel', keeper: 'British Library', do: 'open' }, false, sc);
  if (opened.status !== 302) throw new Error('the Studio could not open the volume: ' + opened.status);

  // REACH_HOLD=file: keep the house up for a person to look, its address and sign-ins written to that file.
  if (process.env.REACH_HOLD) { fs.writeFileSync(process.env.REACH_HOLD, JSON.stringify({ base, slug, makerCookies, studioCookies, volume: vol.slug, artist: artistSlug })); console.log('holding at ' + base); return; }
  const fill = p => p.replace('$slug', slug).replace('$artist', artistSlug).replace('$volume', vol.slug).replace('$book', 'a-book');
  const rooms = groups => groups.flatMap(([, l]) => l.map(x => x[0]));
  const uniq = a => [...new Set(a)].filter(h => !/logout|signout/.test(h));
  const lists = {
    out: uniq([...rooms(V.DOORS), '/w/' + slug, '/m/mk', '/art/' + artistSlug, '/easel/' + slug, '/volume/' + vol.slug, '/read/a-book', '/deliver/reachtok', '/license/' + slug + '/ask', '/signin', '/everything']),
    maker: uniq([...rooms(V.ROOMS.maker), ...rooms(V.ROOMS.yours)]),
    studio: uniq(rooms(V.ROOMS.house)),
  };
  const cookiesFor = { out: null, maker: makerCookies, studio: studioCookies };
  const smallSet = SMALL.map(fill);
  const roleOf = p => /^\/studio/.test(p) ? 'studio' : /^\/(account|yours|notices|draw\/mine|curate)/.test(p) ? 'maker' : 'out';

  let browser;
  browser = await launchBrowser();
  const faults = []; const allowed = []; const skipped = new Set(); let walked = 0; const combos = new Set();
  const note = (f) => {
    // A page wider than its screen is never allowed (#46): the browser zooms all of it out and every press misses.
    const a = f.kind === 'wide' ? null : (ENGINE.webkit ? ALLOW.concat(ALLOW_WEBKIT) : ALLOW).find(x => x.page.test(f.page) && x.control.test(f.sel) && (!x.kind || x.kind === f.kind));
    f = { ...f, engine: ENGINE.name };
    (a ? allowed : faults).push(a ? { ...f, issue: a.issue } : f);
  };
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shotOnce = new Set();

  // Nothing in motion: no transition running (a bar fading out is neither shown nor hidden yet). Endless animations
  // (a spinner) are not waited for.
  const still = page => page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity), null, { timeout: 2500, polling: 100 }).catch(() => {});
  const settle = async page => {
    await page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 4000 }).catch(() => {});
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    await still(page);
  };
  // A real press: a capture-phase listener on the window records where each click landed and stops it there (so the
  // walk does not leave the page); each press is a touch on a touch screen, a mouse on the desk. The bar's controls are
  // found and pressed in one pass.
  const topbar = async (page, touch, p, size, role, edge, N = note) => {
    const boxes = await page.evaluate(sel => {
      window.__reachHits = [];
      if (!window.__reachArmed) { window.__reachArmed = 1; addEventListener('click', e => { if (!window.__reachTrap) return; if (window.__reachHits[window.__reachI] == null) window.__reachHits[window.__reachI] = e.target; e.preventDefault(); e.stopImmediatePropagation(); }, true); }
      window.__reachTrap = 1;
      const els = [...document.querySelectorAll(sel)].filter(el => { const r = el.getBoundingClientRect(); return r.width >= 2 && r.height >= 2 && el.checkVisibility({ visibilityProperty: true }) && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; });
      window.__reachEls = els;
      return els.map(el => { const r = el.getBoundingClientRect(); return { x: Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y: Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1) }; });
    }, TOPBAR);
    for (let i = 0; i < boxes.length; i++) {
      await page.evaluate(i => { window.__reachI = i; window.__reachHits[i] = null; }, i);
      if (touch) await page.touchscreen.tap(boxes[i].x, boxes[i].y); else await page.mouse.click(boxes[i].x, boxes[i].y);
    }
    const res = await page.evaluate(() => {
      window.__reachTrap = 0;
      const c = el => typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
      return window.__reachEls.map((el, i) => { const h = window.__reachHits[i]; const ok = h && (el === h || el.contains(h));
        return ok ? null : { sel: el.tagName.toLowerCase() + (c(el) ? '.' + c(el) : '') + (el.getAttribute('href') && !c(el) ? `[href="${el.getAttribute('href')}"]` : ''), words: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), tag: h ? 'landed on ' + h.tagName.toLowerCase() + (c(h) ? '.' + c(h) : '') : 'no click reached the page' }; }).filter(Boolean);
    });
    for (const d of res) N({ page: p, size, role, kind: 'tap', at: edge, sel: d.sel, words: d.words, cover: { tag: d.tag } });
  };
  // Wider than the screen: the document's width (scrollWidth) past its viewport (clientWidth + 1), or a layout viewport
  // the browser widened to fit it (innerWidth), so it zooms the whole page out or scrolls it sideways. Named by page and
  // size, with the first thing that runs past the edge outside a box that scrolls on its own.
  const wideCheck = async (page, p, size, role, N = note) => {
    const wide = await page.evaluate(() => {
      const w = document.documentElement.scrollWidth, c = document.documentElement.clientWidth; if (innerWidth <= c + 1 && w <= c + 1) return null;
      const inBox = e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o !== 'visible' && o !== 'clip') return true; } return false; };
      const e = [...document.querySelectorAll('body *')].find(e => { const r = e.getBoundingClientRect(); return r.right > c + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed' && !inBox(e); });
      return { w: Math.max(w, innerWidth), c, sel: e ? e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : '') : '?' };
    });
    if (wide) N({ page: p, size, role, kind: 'wide', sel: wide.sel, words: '', cover: { tag: `${p} is ${wide.w} wide on a ${wide.c} screen` } });
  };
  const scrollTo = (page, where) => page.evaluate(w => { const H = document.documentElement.scrollHeight - innerHeight; scrollTo({ top: w === 'top' ? 0 : w === 'mid' ? H / 2 : H, behavior: 'instant' }); }, where).then(() => scrollSettle(page));
  const walkHere = async (page, p, size, role, extra = '', edges = true, N = note) => {
    const found = await page.evaluate(probe, { mode: 'centre' });
    // An invisible control is looked at again 1.5 s later on the same page: still faded and pressable means it is held
    // there (a person meets it); risen means the walk read a fade in passing. Either way it is said in the finding.
    if (found.some(f => f.mark)) {
      await page.waitForTimeout(1500);
      const later = await page.evaluate(() => { const o = {}; for (const el of document.querySelectorAll('[data-reach-mark]')) { let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= +getComputedStyle(e).opacity; const c = getComputedStyle(el); o[el.getAttribute('data-reach-mark')] = { op: +op.toFixed(3), pe: c.pointerEvents, vis: c.visibility, cls: (document.querySelector('.st') || {}).className || '' }; el.removeAttribute('data-reach-mark'); } return o; }).catch(() => ({}));
      for (const f of found) if (f.mark) { const l = later[f.mark]; if (f.diag) f.diag.later = l ? `${l.op < 0.05 && l.pe !== 'none' && l.vis !== 'hidden' ? 'STILL' : 'no longer'} invisible 1.5 s later (op ${l.op}, pe ${l.pe}, ${l.vis}; ${String(l.cls).slice(0, 60)})` : 'gone 1.5 s later'; delete f.mark; }
    }
    for (const f of found) N({ page: p, size: size + extra, role, ...f });
    if (edges) for (const edge of ['top', 'mid', 'foot']) {
      await scrollTo(page, edge); if (edge !== 'top') { await page.waitForTimeout(60); await still(page); }
      // A room that grows as its foot is reached (more tiles, late pictures) is not at its foot yet: go down again.
      if (edge === 'foot') for (let i = 0; i < 6 && !(await page.evaluate(() => scrollY + innerHeight >= document.documentElement.scrollHeight - 2)); i++) { await scrollTo(page, edge); await page.waitForTimeout(120); await still(page); }
      for (const f of await page.evaluate(probe, { mode: 'here', edge })) N({ page: p, size: size + extra, role, ...f });
    }
    await scrollTo(page, 'top');
  };

  // (#109) A finding is called only when a second look agrees. Each door (a page at a size, as a person; or one edge of
  // the presses below) is visited, and if it found anything, visited again once, fresh: a new page in the same context.
  // What both looks found is a fault; what only one look found is `flaky`: kept in the findings file, raised as a notice,
  // never dropped. A door that throws (a navigation under the walk's feet, a press that never came into view) is a
  // finding of kind `error` like any other, and is looked at twice the same way. Nothing else is retried.
  const flaky = [];
  const keyOf = f => [f.page, f.size, f.role, f.kind, f.at || '', f.sel, f.words].join('|');
  const twice = async (door, look) => {
    const first = []; await look(f => first.push(f));
    if (!first.length) return;
    const second = []; await look(f => second.push(f));
    const again = new Map(second.map(f => [keyOf(f), f]));
    for (const f of first) { const g = again.get(keyOf(f)); if (g) note({ ...f, diag2: g.diag || g.cover && g.cover.err || null }); else flaky.push({ ...f, engine: ENGINE.name, door, seen: 'first look only' }); }
    const once = new Set(first.map(keyOf));
    for (const g of second) if (!once.has(keyOf(g))) flaky.push({ ...g, engine: ENGINE.name, door, seen: 'second look only' });
  };
  const errOf = e => String(e && e.message || e).split('\n')[0].replace(/\s+/g, ' ').slice(0, 160);

  const doesIt = async (ctx, size, role, touch) => {
    const p = DOES[role];
    // A press: brought into view (8 s at most; a control that cannot be is the finding, not a crash of the walk).
    const press = async (page, sel, N, edge, words) => {
      const el = page.locator(sel).first();
      try { await el.scrollIntoViewIfNeeded({ timeout: 8000 }); }
      catch (e) {
        const why = await el.evaluate(x => { const r = x.getBoundingClientRect(), c = getComputedStyle(x), row = x.parentElement; return `box ${[r.left, r.top, r.width, r.height].map(Math.round).join(',')}, display ${c.display}, visibility ${c.visibility}, opacity ${c.opacity}${row ? `, its row scrolls ${row.scrollLeft}/${row.scrollWidth - row.clientWidth}` : ''}, at ${Math.round(performance.now())} ms, ${document.readyState}`; }, null, { timeout: 2000 }).catch(x => 'not in the page: ' + errOf(x));
        N({ page: p, size, role, kind: 'does', at: edge, sel, words, cover: { tag: 'could not be brought into view (' + why + ')', err: errOf(e) } }); return false;
      }
      const b = await el.boundingBox(); if (!b) return false; const x = b.x + b.width / 2, y = b.y + b.height / 2; if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); return true;
    };
    const edgeOf = edge => async N => {
      const page = await ctx.newPage();
      try {
        // A press that left a navigation (or Back's own fallback) still under way would abort the next one: try again.
        const go = async u => { for (let i = 0; ; i++) { try { await page.waitForLoadState('load').catch(() => {}); return await page.goto(u, { waitUntil: 'load' }); } catch (e) { if (i >= 2) throw e; await page.waitForTimeout(600); } } };
        // Back: a page before this one, then this page; Back must return.
        await go(base + (role === 'studio' ? '/studio' : role === 'maker' ? '/account' : '/'));
        await go(base + p); await settle(page);
        if (edge === 'mid') await scrollTo(page, 'mid');
        const backSel = '[data-nv-back]:not([hidden])';
        if (await page.locator(backSel).count()) {
          const was = page.url(); await press(page, backSel, N, edge, 'Back'); await page.waitForURL(u => u.toString() !== was, { timeout: 3000 }).catch(() => {});
          if (page.url() === was) N({ page: p, size, role, kind: 'does', at: edge, sel: 'button.nv-back', words: 'Back', cover: { tag: 'Back did not leave the page' } });
        } else N({ page: p, size, role, kind: 'does', at: edge, sel: 'button.nv-back', words: 'Back', cover: { tag: 'no Back shown' } });
        // The menu (All rooms) opens its sheet; Find opens its layer.
        await go(base + p); await settle(page); if (edge === 'mid') await scrollTo(page, 'mid');
        if (await page.locator('.rm-b:visible').count()) {
          await press(page, '.rm-b:visible', N, edge, 'All rooms'); await page.waitForTimeout(150);
          if (!(await page.evaluate(() => { const d = document.querySelector('[data-rm]'); return !!(d && d.open); }))) N({ page: p, size, role, kind: 'does', at: edge, sel: 'button.rm-b', words: 'All rooms', cover: { tag: 'the sheet did not open' } });
          else { await page.locator('[data-rm-close]').first().click({ timeout: 5000 }).catch(() => {}); }
        }
        // Each desk tab goes to its room.
        const tabs = await page.evaluate(() => [...document.querySelectorAll('.dh-rooms > a')].map(a => a.getAttribute('href')));
        for (const h of tabs) {
          await go(base + p); await settle(page); if (edge === 'mid') await scrollTo(page, 'mid');
          const sel = `.dh-rooms > a[href="${h}"]`;
          if (!(await press(page, sel, N, edge, h))) continue;
          await page.waitForURL(u => new URL(u).pathname === h.split('?')[0], { timeout: 3000 }).catch(() => {});
          if (new URL(page.url()).pathname !== h.split('?')[0]) N({ page: p, size, role, kind: 'does', at: edge, sel, words: h, cover: { tag: 'the tab did not go to ' + h + ' (at ' + new URL(page.url()).pathname + ')' } });
        }
      } catch (e) { N({ page: p, size, role, kind: 'error', at: edge, sel: '-', words: 'the presses', cover: { tag: 'the walk could not finish here: ' + errOf(e), err: errOf(e) } }); }
      finally { await page.close().catch(() => {}); }
    };
    for (const edge of ['top', 'mid']) await twice(`${p} presses (${edge}) at ${size} as ${role}`, edgeOf(edge));
  };

  for (const size of sizesRun) {
    const S = SIZES[size];
    for (const role of ['out', 'maker', 'studio']) {
      const list = (only ? only.map(fill).filter(p => roleOf(p) === role) : S.full ? lists[role] : smallSet.filter(p => roleOf(p) === role));
      if (!list.length) continue;
      const ctx = await browser.newContext({ ...contextFor(S), serviceWorkers: 'block' });
      // REACH_FONTS=dir: the house's web fonts from a folder (fonts.css and its files) where Google's cannot be reached,
      // so the words are as wide here as in CI and on a phone.
      if (process.env.REACH_FONTS) {
        await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(process.env.REACH_FONTS, 'fonts.css')) }));
        await ctx.route('https://fonts.gstatic.com/reach/**', r => r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(path.join(process.env.REACH_FONTS, path.basename(new URL(r.request().url()).pathname))) }));
      }
      if (cookiesFor[role]) await ctx.addCookies(cookiesFor[role]);
      // The tours and the first-visit sheets would sit over the page for a newcomer: they are part of what is walked
      // only on the front door; elsewhere the walk is someone who has been here before.
      await ctx.addInitScript(() => { try { localStorage.setItem('wm_toured', '1'); } catch (e) {} });
      if ((!only || process.env.REACH_DOES) && DOES[role]) await doesIt(ctx, size, role, S.touch);
      if (S.touch) { const pg = await ctx.newPage(); await pg.goto(base + '/about'); const coarse = await pg.evaluate(() => matchMedia('(pointer:coarse)').matches); await pg.close(); if (!coarse) throw new Error('touch is not emulated: (pointer:coarse) does not match'); }
      // Each page in a fresh tab (a zoom left by one page must not lie over the next), POOL tabs at once.
      const queue = list.slice();
      const visit = p => async N => {
        const page = await ctx.newPage(); let skip = false;
        try {
          let err = null; const resp = await page.goto(base + p, { waitUntil: 'load' }).catch(e => { err = e; return null; });
          // A room with nothing to show in a test house (the Met's open access with no Met works) answers 404: not walked.
          if (resp && resp.status() === 404) { skip = true; return; }
          if (!resp || resp.status() >= 400) { N({ page: p, size, role, kind: 'status', sel: '-', words: '', cover: { tag: 'answered ' + (resp ? resp.status() : 'nothing' + (err ? ': ' + errOf(err) : '')), err: err ? errOf(err) : null } }); return; }
          if (cookiesFor[role] && /\/signin|\/studio\/(door|login)/.test(new URL(page.url()).pathname)) throw new Error(`${p} sent the signed-in visitor to ${page.url()}`);
          await settle(page);
          let n = 0; const M = f => { n++; N(f); };
          // Wider than the screen: the browser zooms the whole page out (or it scrolls sideways), and every control shrinks.
          await wideCheck(page, p, size, role, M);
          await walkHere(page, p, size, role, '', true, M);
          // A control that moves on the press itself (on touchend, before the click the walk holds back) takes the page
          // away: said, and the rest of that page's presses left out.
          if (S.touch) try { for (const edge of ['top', 'mid']) { await scrollTo(page, edge); await topbar(page, S.touch, p, size, role, edge, M); } }
          catch (e) { if (!/context was destroyed|navigation/i.test(String(e))) throw e; console.log(`left on a press: ${p} at ${size} (${role})`); await page.waitForLoadState('load').catch(() => {}); await page.goto(base + p, { waitUntil: 'load' }); await settle(page); }
          // Turn it: portrait → landscape → portrait, the page left open; walked again.
          if (size === 'ipadP') {
            await scrollTo(page, 'top');
            await page.setViewportSize({ width: S.viewport.height, height: S.viewport.width }); await page.waitForTimeout(120);
            await page.setViewportSize(S.viewport); await page.waitForTimeout(150); await still(page);
            await wideCheck(page, p, size + '↻', role, M);
            await walkHere(page, p, size, role, '↻', false, M);
          }
          if (shots && n && !shotOnce.has(p + size)) { shotOnce.add(p + size); await page.screenshot({ path: path.join(shots, `${size}-${p.replace(/[^a-z0-9]+/gi, '_')}.png`) }).catch(() => {}); }
        } catch (e) {
          // The page moved under the walk, or a step could not finish: a finding of its own, looked at twice like any other.
          N({ page: p, size, role, kind: 'error', sel: '-', words: '', cover: { tag: 'the walk could not finish this page: ' + errOf(e), err: errOf(e) } });
        } finally { await page.close().catch(() => {}); if (skip) skipped.add(p); }
      };
      const one = async p => {
        await twice(`${p} at ${size} as ${role}`, visit(p));
        if (!skipped.has(p)) { walked++; combos.add(`${p}|${size}|${role}`); }
      };
      await Promise.all(Array.from({ length: POOL }, async () => { while (queue.length) await one(queue.shift()); }));
      await ctx.close();
    }
  }
  await browser.close(); srv.close();
  const secs = Math.round((Date.now() - t0) / 1000);
  const line = f => `${f.page} · ${f.size} · ${f.role} · ${f.kind}${f.at ? ' (' + f.at + ')' : ''} · ${f.sel} “${f.words}”${f.box ? ' [' + f.box.join(',') + ']' : ''}${f.cover ? ' · under ' + [f.cover.sel || f.cover.tag, f.cover.pe ? 'pe:' + f.cover.pe : '', f.cover.op != null ? 'op:' + f.cover.op : '', f.cover.z ? 'z:' + f.cover.z : '', f.cover.pos && f.cover.pos !== 'static' ? f.cover.pos : ''].filter(Boolean).join(' ') : ''}${dline(f.diag)}`;
  if (process.env.REACH_JSON) fs.writeFileSync(process.env.REACH_JSON, JSON.stringify({ faults, allowed, flaky }, null, 1));
  // (#109) What only one of two looks found: said, never dropped. With the moment's diagnostics, so the next worker can
  // tell a room that is sometimes wrong from a walk that read it too early.
  const dline = d => d ? ` {${['main ' + d.main, d.anims ? 'running ' + d.anims : '', d.op != null ? 'op ' + d.op : '', d.vis ? 'vis ' + d.vis : '', 't ' + d.t + 'ms', d.hover ? 'hover' : '', d.coarse ? 'coarse' : '', d.later || ''].filter(Boolean).join('; ')}}` : '';
  if (flaky.length) {
    const rows = flaky.map(f => `${f.page} · ${f.size}${f.role === 'out' ? '' : '/' + f.role} · ${f.kind}${f.at ? ' (' + f.at + ')' : ''} · ${f.sel} “${f.words}” · ${f.cover ? (f.cover.sel || f.cover.tag || '') : ''} · ${f.seen}${dline(f.diag)}`);
    console.log(`flaky (${ENGINE.name}, ${flaky.length}: seen on one look of two, not called):\n` + rows.join('\n'));
    if (process.env.GITHUB_ACTIONS && !ENGINE.webkit) { let cur = ''; const packs = []; for (const r of rows) { if ((cur + r).length > 1400) { packs.push(cur); cur = ''; } cur += r.slice(0, 1400) + '\n'; } if (cur) packs.push(cur); packs.slice(0, 5).forEach((m, i) => console.log(`::notice title=reach flaky ${i + 1}/${packs.length}::${m.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`)); }
  }
  if (skipped.size) console.log(`not walked (404 in the test house): ${[...skipped].join(' ')}`);
  const summary = `reach (${ENGINE.name}): ${walked} page walks (${combos.size} page × size × person) in ${secs}s; ${faults.length} faults; ${allowed.length} on the allow-list; ${flaky.length} flaky (one look of two)`;
  if (allowed.length) console.log(`allowed (filed): ${[...new Set(allowed.map(a => '#' + a.issue))].join(' ')}`);
  if (faults.length) {
    const lines = faults.map(line);
    console.error(summary + '\n' + lines.join('\n'));
    if (process.env.GITHUB_ACTIONS) {
      // CI's log cannot be read from a session, only its annotations (ten a step): the faults grouped by page, kind and
      // control, with the sizes and people they were seen at, packed into as few annotations as they fit.
      const g = new Map();
      for (const f of faults) { const k = `${f.page} · ${f.kind} · ${f.sel} “${f.words}”${f.cover ? ' · under ' + (f.cover.sel || f.cover.tag) : ''}`; if (!g.has(k)) g.set(k, new Set()); g.get(k).add(f.size + (f.role === 'out' ? '' : '/' + f.role)); }
      const rows = [...g].map(([k, v]) => `${k} · ${[...v].join(',')}`); const packs = [summary]; let cur = '';
      for (const r of rows) { if ((cur + r).length > 3800) { packs.push(cur); cur = ''; } cur += r + '\n'; }
      if (cur) packs.push(cur);
      packs.slice(0, 10).forEach((m, i) => console.log(`::error title=reach ${i}/${Math.min(packs.length, 10) - 1}::${m.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`));
    }
    done(1);
  }
  console.log(summary); done(0);
})().catch(e => {
  console.error(e.stack || e);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=reach::${String(e.stack || e).slice(0, 1500).replace(/%/g, '%25').replace(/\n/g, '%0A')}`);
  done(1);
});
function done(code) { try { if (dir) fs.rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(code); }
