// The public house, as a stranger (#188, Will, 21 Nov: "remove all things that could get us in trouble, and make sure
// everything is at least correct"). A house with a maker, museum works from the Gallery and the Met, a collected piece
// and a piece offered on the market is walked by someone with no account: every door in DOORS, /everything, the front,
// the footers (the quiet house and the open one), and every page those link to. It fails on:
//   - a word the house never says to a reader (the list below), between the tags or in alt/title/aria-label/placeholder;
//   - /owners or /investors answering a stranger (they are the Studio's; a stranger is sent to /about);
//   - a script, stylesheet, font or picture asked of another host by the page itself;
//   - a cookie not on the house's own list (COOKIES).
// Machine addresses and the technical pages keep their technical words (MACHINE); the legal documents are counsel's and
// fingerprinted (LEGAL): their words are in docs/REDLINE.md, not changed here. PUBLIC_DUMP=<dir> writes what a reader reads
// on each page, one file a page, for a person to read through.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
const V = require('../src/views');

// The words a reader never meets on the public house (CLAUDE.md, #188): the register is "the register".
const BANNED = ['blockchain', 'nfts?', 'tokens?', 'tokenized', 'wallets?', 'hash(?:es|ed|ing)?', 'ledgers?', 'bitcoin', 'opentimestamps', 'mint(?:s|ed|ing)?', 'on[- ]chain', 'crypto(?:graphic|graphically|currency)?'];
// A machine's address said in a sentence ("/ledger.json") is the address, not the word: a word inside a path is not counted.
const BANNED_RE = new RegExp(`(?<![/\\w.-])(${BANNED.join('|')})\\b(?![./]\\w)`, 'gi');
// The house is never "a museum" (Will, 20 Nov): the phrases the house used of itself.
const SELF_MUSEUM = /\b(open your museum|your (own )?museum|the museum itself|a museum of your own|our museum|this museum|the house(?:'|’)s museum|watermark(?:'|’)s museum|watermark is a museum)\b/gi;
// Words that read as an offer of a share in the company (the issue's first order).
const OFFER = /\b(class [ab] shares?|owner shares?|own a share|invest in (?:krafft|watermark|the house|the company)|investors? page)\b/gi;
// Addresses for machines and the pages that explain the machinery: technical words are their subject.
const MACHINE = [/^\/ledger\.json/, /^\/ledger\/anchors\.json/, /^\/standard(\/|$|\?)/, /^\/api\//, /\.json(\?|$)/, /^\/sitemap\.xml/, /^\/robots\.txt/, /^\/\.well-known\//];
// The legal documents: counsel's words, fingerprinted. Read, never changed here (docs/REDLINE.md).
const LEGAL = [/^\/terms(\/|$|\?)/, /^\/privacy(\/|$|\?)/, /^\/legal(\/|$|\?)/, /^\/c\/[^/]+\/contract/];
// Words still said in a file another worker's open pull request holds (#188 may not edit it): page and phrase, with the
// file and the PR. The CTO session moves the words when it merges; a line here that no longer matches fails, so the list only shrinks.
const PENDING = [
  ['/estate', 'Open your museum', 'src/estate.js (PR #186)'],
];
// The house's own cookies, each for a stated purpose. A new one is added here and to the privacy page's list (counsel).
const COOKIES = {
  wm_b: 'a collector signed in', wm_m: 'a maker signed in', wm_s: 'the Studio signed in', wm_v: 'the viewer code', wm_bk: 'the basket',
  wm_in: 'the room you came from / been here before', wm_via: 'a curator’s or gallery’s door you came through', wm_g: 'a showing you were admitted to',
  wm_gg: 'the showings you were admitted to', wm_trade: 'the trade switch', wm_hi: 'a welcome line', wm_tz: 'your time zone, for the clock',
  wm_zone: 'the rooms you chose (the adult rooms by the door)', wm_tap: 'a one-tap card is ready', wm_ch: 'a sign-in in progress', wm_room: 'the balcony room',
  wm_d: 'a device you named', wm_dvh: 'a heart left without an account', wm_ph: 'a peephole reader', wm_as: 'the Studio acting as a maker', wm_staff: 'a museum’s staff',
};
const HOST = 'http://localhost';
const unesc = s => s.replace(/&rsquo;|&#8217;/g, '’').replace(/&lsquo;|&#8216;/g, '‘').replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…').replace(/&ndash;/g, '–').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const read = html => { const h = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' '); const attrs = [...h.matchAll(/\s(?:alt|title|aria-label|placeholder)="([^"]*)"/g)].map(m => m[1]).join(' · '); const title = (h.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''; const desc = (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || ''; return unesc(`${h.replace(/<head>[\s\S]*?<\/head>/, ' ').replace(/<[^>]+>/g, ' ')} · ${attrs} · ${title} · ${desc}`).replace(/\s+/g, ' '); };
// What the page itself asks another host for (a link to another site is not a request; a script, a stylesheet, a font, a picture is).
const outside = (html, base) => {
  const out = []; const own = u => { try { const x = new URL(u, base); return x.origin === new URL(base).origin; } catch (e) { return true; } };
  for (const m of html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/gi)) if (!own(m[1])) out.push('script ' + m[1]);
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) { const t = m[0]; const rel = (t.match(/\srel="([^"]+)"/i) || [])[1] || ''; const href = (t.match(/\shref="([^"]+)"/i) || [])[1] || ''; if (/stylesheet|preload|preconnect|dns-prefetch|modulepreload|icon|manifest/i.test(rel) && href && !own(href)) out.push(`link ${rel} ${href}`); }
  for (const m of html.matchAll(/<(?:img|source|video|audio|iframe|embed)\b[^>]*\s(?:src|srcset|poster)="([^"]+)"/gi)) for (const u of m[1].split(',').map(x => x.trim().split(/\s+/)[0]).filter(Boolean)) if (!/^data:|^blob:/.test(u) && !own(u)) out.push('media ' + u);
  for (const m of html.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/gi)) if (!own(m[1])) out.push('@import ' + m[1]);
  for (const m of html.matchAll(/url\(\s*["']?(https?:\/\/[^"')\s]+)/gi)) if (!own(m[1])) out.push('url() ' + m[1]);
  return out;
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-public-'));
  const pic = await sharp({ create: { width: 2600, height: 2000, channels: 3, noise: { type: 'gaussian', mean: 120, sigma: 40 } } }).jpeg().toBuffer();
  let nth = 0; const json = o => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async u => {
    u = String(u);
    if (/collectionapi\.metmuseum\.org\/public\/collection\/v1\.1\/search/.test(u)) return json({ total: 1, objectIDs: [7] });
    if (/collectionapi\.metmuseum\.org\/public\/collection\/v1\/objects\/7/.test(u)) return json({ objectID: 7, isPublicDomain: true, primaryImage: 'https://images.metmuseum.org/7.jpg', title: 'Wheat Field with Cypresses', artistDisplayName: 'Vincent van Gogh', objectDate: '1889', medium: 'Oil on canvas', dimensions: '28 7/8 × 36 3/4 in.', creditLine: 'Purchase, The Annenberg Foundation Gift, 1993', department: 'European Paintings', accessionNumber: '1993.132', objectURL: 'https://www.metmuseum.org/art/collection/search/436535' });
    if (/\.(jpe?g|png|tif)|iiif|images\./.test(u)) return new Response(await sharp(pic).modulate({ brightness: 0.6 + (nth++ % 8) * 0.1 }).jpeg().toBuffer(), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };
  const app = createApp({ dataDir: dir, base: HOST, adminPassword: 'pw', secret: 'public', noTimers: true, vaultNow: true, fetchImpl });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;

  // ---- the house: a maker's work, museum works, a collected piece, a piece on the market -----------------------------
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const put = async (title, extra = {}) => { const f = path.join(dir, `p-${++k}.jpg`); await sharp(fx).resize({ width: 3600 + k * 10, height: 2400, fit: 'fill' }).modulate({ hue: k * 40 }).jpeg({ quality: 70 }).toFile(f); const w = await app.locals.registerWork({ file: f, title, originalName: path.basename(f), ...extra }); db.prepare("UPDATE works SET status='held' WHERE slug=?").run(w.slug); return db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug); };
  const w1 = await put('The Dome at Noon'); db.prepare('UPDATE works SET edition_size=10 WHERE id=?').run(w1.id);
  const w2 = await put('The River in Flood'); const w3 = await put('A Street in the Rain'); await put('Morning, the Long Field');
  const maker = db.prepare('SELECT * FROM makers WHERE id=?').get(w1.maker_id);
  const I = app.locals.iiif; const shelf = app.locals.art.shelf();
  const ng = { id: 'https://www.nga.gov/collection/art-object-page.9.html', label: 'A Lady Writing', image: 'https://api.nga.gov/iiif/x/full/max/0/default.jpg', rights: 'cc0', kind: 'painting',
    meta: [['Artist', 'Johannes Vermeer'], ['Date', 'c. 1665'], ['Medium', 'oil on canvas'], ['Dimensions', 'overall: 45 x 39.9 cm'], ['Credit line', 'Gift of Harry Waldron Havemeyer'], ['Accession number', '1942.9.97'], ['Classification', 'Painting'], ['Courtesy', 'Courtesy National Gallery of Art, Washington']].map(([label, value]) => ({ label, value })), artist: { name: 'Johannes Vermeer', born: 1632, died: 1675 } };
  const t1 = await I.take(ng, { id: 1, maker_id: shelf.id, show: 1, open: 'cc0' }); assert.ok(t1.w, 'a Gallery work taken');
  const man = await I.parseMet('https://collectionapi.metmuseum.org/public/collection/v1.1/search?q=wheat', fetchImpl, 5);
  const t2 = await I.take(man.items[0], { id: 2, maker_id: shelf.id, show: 1, open: 'cc0' }); assert.ok(t2.w, 'a Met work taken');
  const use = key => db.prepare('SELECT * FROM uses WHERE maker_id=? AND key=?').get(maker.id, key);
  const buyer = db.prepare("INSERT INTO buyers (customer, email) VALUES ('cus_public', 'ada@example.com')").run().lastInsertRowid;
  const lic = db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, price_cents, status, starts_at, collector_no, download_token, rights, buyer_id) VALUES ('WM-2026-188001', ?, ?, 'Ada Collector', 'ada@example.com', 2500, 'active', datetime('now','-400 days'), 3, 'tok-public', ?, ?)").run(w1.id, use('social').id, JSON.stringify({ transferable: true }), buyer).lastInsertRowid;
  const lst = db.prepare("INSERT INTO listings (license_id, seller, ask_cents, status) VALUES (?, ?, 90000, 'open')").run(lic, buyer).lastInsertRowid;
  const desk = I.museumDesk('aic'); // a desk the house made under a museum's own name (COUNSEL 36): not public until claimed

  // ---- the walk --------------------------------------------------------------------------------------------------------
  const jar = {}; const setCookies = new Map(); // name → first page that set it
  const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { accept: 'text/html', cookie: Object.entries(jar).map(([a, b]) => `${a}=${b}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); const n = kv.slice(0, i); if (!setCookies.has(n)) setCookies.set(n, p); jar[n] = kv.slice(i + 1); } return r; });
  const seeds = new Set(['/', '/everything', '/about', '/promises', '/terms', '/privacy', '/legal', '/standard', '/developers', '/ledger', '/ledger.json', '/ledger/anchors.json', '/api', '/api/v1/works', `/api/v1/works/${w1.slug}`, '/sitemap.xml', '/robots.txt',
    `/w/${w1.slug}`, `/w/${w2.slug}`, `/w/${w3.slug}`, `/w/${db.prepare('SELECT slug FROM works WHERE id=?').get(t1.w.id).slug}`, `/w/${db.prepare('SELECT slug FROM works WHERE id=?').get(t2.w.id).slug}`, `/m/${maker.handle}`, '/market', `/market/${lst}`, `/verify?q=WM-2026-188001`,
    '/owners', '/investors', '/peephole', '/director', '/share', '/hanging', '/releases', `/m/${desk.handle}`, `/rights/${desk.handle}`, '/rights/museum-demo', '/m/museum-demo']);
  for (const [, list] of V.DOORS) for (const [h] of list) seeds.add(h);
  const skip = h => /^\/(studio|account|signout|signin\/|static\/|img\/|d\/|k\/|open\/[^/]+\/take|buy\/|easel\/|feedback)|\.(pdf|zip|jpe?g|png|webp|tiff?|mp3|mp4|csv|wmk|xmp|epub|svg)(\?|$)|\/(download|frame|background)\b/.test(h);
  const pages = new Map(); const queue = [...seeds]; const seen = new Set(queue);
  const visit = async (p) => {
    const r = await go(p); const ct = r.headers.get('content-type') || ''; const body = r.status === 200 ? await r.text() : ''; pages.set(p, { status: r.status, loc: r.headers.get('location'), ct, body });
    return body;
  };
  // The quiet house (the default), then the open house (the Studio's switch), so both footers' links are walked.
  for (const quiet of [true, false]) {
    V.setQuiet(quiet);
    for (const p of ['/', '/about', '/everything']) { const b = await visit(p); for (const m of b.matchAll(/href="(\/[^"#]*)"/g)) { const h = unesc(m[1]); if (!seen.has(h) && !skip(h)) { seen.add(h); queue.push(h); } } }
  }
  V.setQuiet(true);
  // Depth one: every page linked from a seed or a door.
  const first = queue.slice();
  for (const p of first) { const b = pages.has(p) ? pages.get(p).body : await visit(p); if (!/html/.test((pages.get(p) || {}).ct || '')) continue; for (const m of b.matchAll(/href="(\/[^"#]*)"/g)) { const h = unesc(m[1]); if (!seen.has(h) && !skip(h) && seen.size < 900) { seen.add(h); queue.push(h); } } }
  for (const p of queue) if (!pages.has(p)) await visit(p);

  // ---- what was found --------------------------------------------------------------------------------------------------
  const found = { banned: [], museum: [], offer: [], outside: [], status: [] }; const pendingSeen = new Set();
  const dump = process.env.PUBLIC_DUMP; if (dump) fs.mkdirSync(dump, { recursive: true });
  for (const [p, { status, loc, ct, body }] of pages) {
    if (status >= 500) found.status.push(`${p} → ${status}`);
    if (!body) continue;
    const machine = MACHINE.some(re => re.test(p)) || !/html/.test(ct); const legal = LEGAL.some(re => re.test(p));
    const txt = /html/.test(ct) ? read(body) : body;
    if (dump && /html/.test(ct)) fs.writeFileSync(path.join(dump, (p.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'root') + '.txt'), `${p}\n\n${txt}\n`);
    const at = (m, txt) => `${p}: "${m[0]}" (… ${txt.slice(Math.max(0, m.index - 60), m.index + 40)} …)`;
    const pend = (m) => { const hit = PENDING.find(([pg, w]) => pg === p && w.toLowerCase() === m[0].toLowerCase()); if (hit) pendingSeen.add(hit.join(' ')); return !!hit; };
    if (!machine && !legal) { for (const m of txt.matchAll(BANNED_RE)) if (!pend(m)) found.banned.push(at(m, txt)); for (const m of txt.matchAll(SELF_MUSEUM)) if (!pend(m)) found.museum.push(at(m, txt)); }
    if (!legal) for (const m of txt.matchAll(OFFER)) found.offer.push(at(m, txt));
    if (/html/.test(ct)) for (const o of outside(body, base)) found.outside.push(`${p}: ${o}`);
  }
  for (const s of ['/static/style.css', '/static/fonts.css']) { const r = await go(s); const css = await r.text(); for (const m of css.matchAll(/(?:@import\s+(?:url\()?|url\()\s*["']?(https?:\/\/[^"')\s;]+)/gi)) found.outside.push(`${s}: ${m[1]}`); }
  const uniq = a => [...new Set(a)];
  for (const k of Object.keys(found)) found[k] = uniq(found[k]);
  const cookies = [...setCookies].filter(([n]) => !COOKIES[n]).map(([n, p]) => `${n} (first set by ${p})`);
  if (process.env.PUBLIC_REPORT) fs.writeFileSync(process.env.PUBLIC_REPORT, JSON.stringify({ pages: [...pages].map(([p, x]) => [p, x.status, x.loc]), found, cookies, set: [...setCookies] }, null, 1));

  // ---- the checks ------------------------------------------------------------------------------------------------------
  assert.ok(pages.size >= 120, 'the walk read the house: ' + pages.size + ' pages');
  const stale = PENDING.filter(x => !pendingSeen.has(x.join(' '))); assert.deepStrictEqual(stale, [], 'a pending line no longer matches: take it off PENDING');
  // Taken off the public house (#188): each sends a stranger to /about, and the Studio still reads it.
  const studioJar = {}; { const r = await fetch(base + '/studio/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: 'password=pw' }); for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); studioJar[kv.slice(0, i)] = kv.slice(i + 1); } }
  for (const p of ['/director', '/releases', `/m/${desk.handle}`, `/rights/${desk.handle}`]) {
    const r = await fetch(base + p, { redirect: 'manual', headers: { accept: 'text/html' } }); assert.ok(r.status === 302 && r.headers.get('location') === '/about', `${p} is not public: a stranger is sent to /about (${r.status} ${r.headers.get('location')})`);
    const s = await fetch(base + p, { redirect: 'manual', headers: { accept: 'text/html', cookie: Object.entries(studioJar).map(([a, b]) => `${a}=${b}`).join('; ') } }); assert.equal(s.status, 200, `${p}: the Studio still reads it`);
  }
  assert.ok(![...pages.values()].some(x => x.body && /href="\/(director|releases)"/.test(x.body)), 'no public page links /director or /releases: ' + [...pages].filter(([, x]) => x.body && /href="\/(director|releases)"/.test(x.body)).map(([p]) => p).join(', '));
  for (const p of ['/owners', '/investors', '/OWNERS', '/Investors']) { const r = await fetch(base + p, { redirect: 'manual', headers: { accept: 'text/html' } }); assert.ok(r.status === 302 && r.headers.get('location') === '/about', `${p} is the Studio's: a stranger is sent to /about (${r.status} ${r.headers.get('location')})`); }
  assert.ok(![...pages.values()].some(x => x.body && /href="\/(owners|investors)\b/.test(x.body)), 'no public page links /owners or /investors: ' + [...pages].filter(([, x]) => x.body && /href="\/(owners|investors)\b/.test(x.body)).map(([p]) => p).join(', '));
  { const one = new RegExp(BANNED_RE.source, 'i'); assert.ok(one.test('written to the ledger') && one.test('a hashed file') && one.test('an NFT') && one.test('on-chain') && !one.test('the register records it') && !one.test('a hashtag') && !one.test('the minting of'.replace('minting', 'making')), 'the check itself works'); }
  assert.deepStrictEqual(found.banned, [], 'a reader meets a word the house never says:\n' + found.banned.join('\n'));
  assert.deepStrictEqual(found.museum, [], 'the house calls itself a museum:\n' + found.museum.join('\n'));
  assert.deepStrictEqual(found.offer, [], 'a page reads as an offer of a share:\n' + found.offer.join('\n'));
  assert.deepStrictEqual(found.outside, [], 'a page asks another host for a script, stylesheet, font or picture:\n' + found.outside.join('\n'));
  assert.deepStrictEqual(cookies, [], 'a cookie that is not on the house’s list:\n' + cookies.join('\n'));
  assert.deepStrictEqual(found.status, [], 'a public page broke:\n' + found.status.join('\n'));
  // The fonts are the house's own, and they are there.
  { const css = await (await go('/static/fonts.css')).text(); const files = [...css.matchAll(/url\((\/static\/fonts\/[^)]+)\)/g)].map(m => m[1]); assert.ok(files.length >= 12, 'the font faces: ' + files.length); for (const f of files) { const r = await go(f); assert.ok(r.status === 200 && (await r.arrayBuffer()).byteLength > 5000, 'a font file is served: ' + f); } }
  const csp = (await go('/about')).headers.get('content-security-policy') || ''; assert.ok(!/googleapis|gstatic/.test(csp), 'the policy names no font host: ' + csp);

  srv.close(); fs.rmSync(dir, { recursive: true, force: true }); console.log(`public: ok (${pages.size} pages as a stranger; cookies seen: ${[...setCookies.keys()].join(', ') || 'none'})`); process.exit(0);
})().catch(e => { console.error(e.message || e); process.exit(1); });
