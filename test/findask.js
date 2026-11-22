'use strict';
// How people ask (#179; Will, 20 Nov: "I could not search and find my picture the seine by will fullerton").
// One small house, asked on both roads: the list a small house keeps in memory (FIND_DB=0) and the database's
// candidates a large house asks for (FIND_DB=1, with a ceiling of five so the ceiling is met). Each shape must hold
// on each road, and the two roads must give the same works in the same order. Run on SQLite and on CI's Postgres.
process.env.NODE_ENV = 'test'; process.env.FIND_CANDIDATES = '5'; process.env.FIND_DB = '0';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const sharp = require('sharp');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-findask-'));
  const { createApp } = require('../src/app');
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', noTimers: true, vaultNow: true });
  const { registerWork, db } = app.locals; const F = app.locals.find;
  const maker = (handle, name, kind) => db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES (?, ?, ?, ?, datetime('now'), 'house')").run(handle, name, `${handle}@example.com`, kind).lastInsertRowid;
  const will = maker('wf', 'Will Fullerton', 'maker'), aic = maker('aic', 'Art Institute of Chicago', 'institution'), met = maker('met', 'The Metropolitan Museum of Art', 'institution');
  const seurat = app.locals.art.ensure('Georges Seurat', { born: 1859, died: 1891 });
  let i = 0;
  const mk = async (makerId, title, o = {}) => { const n = i++; const f = path.join(dir, `f${n}.jpg`); await sharp({ create: { width: 900, height: 600, channels: 3, noise: { type: 'gaussian', mean: 20 + n * 7, sigma: 10 + n } } }).jpeg().toFile(f); const w = await registerWork({ file: f, originalName: `f${n}.jpg`, title, place: o.place, makerId, kind: o.kind || 'photograph' }); db.prepare("UPDATE works SET status='held', taken_at=?, stars=?, curated=?, keywords=?, artist_id=?, zone=?, kind=? WHERE id=?").run(o.year ? `${o.year}-05-01 10:00:00` : null, o.stars || 0, o.curated ? 1 : 0, o.kw || null, o.artist || null, o.zone || 'all', o.kind || 'photograph', w.id); return { ...w, slug: w.slug }; };
  const W = {};
  W.seine = await mk(will, 'The Seine', { place: 'Paris', year: 2025 });                                   // the living maker's own, unstarred
  W.metSeine = await mk(met, 'The Seine', { place: 'Paris', year: 1890, stars: 5, curated: 1, kind: 'painting' });
  W.banks = []; for (let k = 0; k < 8; k++) W.banks.push(await mk(aic, `Banks of the Seine, study ${k + 1}`, { year: 1884, stars: 5, curated: 1, kind: 'painting', artist: seurat.id }));
  W.morning = await mk(will, 'Morning', { place: 'Rouen', year: 2024, kw: 'seine, fog', stars: 5, curated: 1 }); // a keyword only
  W.seated = await mk(aic, 'Seated Woman', { year: 1883, kind: 'drawing', artist: seurat.id });
  W.land = await mk(aic, 'Landscape with Trees', { year: 1881, kind: 'drawing', artist: seurat.id });
  W.jatte = await mk(aic, 'A Sunday on La Grande Jatte', { year: 1884, kind: 'painting', artist: seurat.id });
  W.embro = await mk(met, 'Embroidery', { year: 1883, kind: 'drawing', artist: seurat.id });
  W.circus = await mk(met, 'Circus Sideshow', { year: 1888, kind: 'painting', artist: seurat.id });
  W.bell = await mk(will, 'Bell Tower at Dusk', { place: 'Florence', year: 1998 });
  W.tower = await mk(will, 'Tower of the Bell', { place: 'Florence', year: 2001 });
  W.cafe = await mk(will, 'Cafe Terrace', { place: 'Paris', year: 1962 });
  W.roofs = await mk(will, 'Rooftops', { place: 'Paris', year: 1965 });
  W.harbour = await mk(will, 'Harbour', { place: 'Lisbon', year: 1962 });
  W.nude = await mk(will, 'Nude Study', { place: 'Paris', year: 1962, zone: 'mature' });
  require('../src/indexes').ensure(db);
  const acc = s => db.prepare('SELECT accession FROM works WHERE slug=?').get(s).accession;
  const uses = db.prepare('SELECT id FROM uses LIMIT 1').get();
  if (uses) db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, status) VALUES ('WM-2026-000042', (SELECT id FROM works WHERE slug=?), ?, 'A Holder', 'h@example.com', 'active')").run(W.harbour.slug, uses.id);
  const closed = { cookies: {} }, grown = { cookies: { wm_zone: 'mature' } };
  const s = (q, req = closed) => F.search(q, 24, req).works.map(w => w.slug);
  const title = slug => db.prepare('SELECT title FROM works WHERE slug=?').get(slug).title;
  const roads = {};
  for (const road of ['0', '1']) {
    process.env.FIND_DB = road; app.locals.findIndexDirty(); const R = roads[road] = {}; const on = `(road ${road === '1' ? 'database' : 'list'}, ${db.kind})`;
    assert.strictEqual(F.index().big, road === '1', 'the road is the one asked for');
    const ask = (q, req) => (R[q + (req === grown ? ' [grown]' : '')] = s(q, req));
    // 1. Understand the ask.
    assert.deepStrictEqual(ask('the seine by will fullerton'), [W.seine.slug, W.morning.slug], `a title by its maker: the title first, then his work that carries the word ${on}`);
    assert.deepStrictEqual(ask("will fullerton's seine"), [W.seine.slug, W.morning.slug], `the maker's title ${on}`);
    assert.deepStrictEqual(ask('paris 1962'), [W.cafe.slug], `a place and a year ${on}`);
    assert.deepStrictEqual(ask('paris 1960s').sort(), [W.cafe.slug, W.roofs.slug].sort(), `a place and a decade ${on}`);
    assert.deepStrictEqual(ask('seurat drawings').sort(), [W.seated.slug, W.land.slug, W.embro.slug].sort(), `an artist and a kind ${on}`);
    assert.deepStrictEqual(ask('seurat drawings at the art institute').sort(), [W.seated.slug, W.land.slug].sort(), `an artist, a kind and a holder ${on}`);
    assert.deepStrictEqual(ask('seurat at the met').sort(), [W.embro.slug, W.circus.slug].sort(), `a holder by its short name ${on}`);
    assert.deepStrictEqual(ask('met drawings'), [W.embro.slug], `the short name without "at" ${on}`);
    assert.deepStrictEqual(ask('"bell tower"'), [W.bell.slug], `a phrase in quotes is a phrase ${on}`);
    assert.deepStrictEqual(ask('“bell tower” florence'), [W.bell.slug], `a phrase in curled quotes, and a word ${on}`);
    assert.deepStrictEqual(ask('bell tower').sort(), [W.bell.slug, W.tower.slug].sort(), `without quotes, the words apart ${on}`);
    assert.strictEqual(ask(acc(W.roofs.slug))[0], W.roofs.slug, `an accession number typed exactly ${on}`);
    assert.strictEqual(ask(acc(W.roofs.slug).toLowerCase())[0], W.roofs.slug, `in small letters too ${on}`);
    if (uses) { assert.strictEqual(ask('WM-2026-000042')[0], W.harbour.slug, `a Watermark number ${on}`); assert.strictEqual(ask(require('../src/track').track('WM-2026-000042'))[0], W.harbour.slug, `the number as it is printed ${on}`); }
    // 2. Never an empty page: the word nothing carries is set aside, and said.
    let r = F.search('the seine by will fullerton xyzzy', 24, closed); R.aside = r.works.map(w => w.slug);
    assert.strictEqual(r.works[0].slug, W.seine.slug, `the telling words still find it ${on}`); assert.deepStrictEqual(r.aside, ['xyzzy']); assert.ok(/Nothing carries “xyzzy”\. Showing “the seine by will fullerton”\./.test(r.say), `and it is said: ${r.say}`);
    r = F.search('seine by will fulerton', 24, closed); R.mended = r.works.map(w => w.slug);
    assert.strictEqual(r.works[0].slug, W.seine.slug, `a slip in a known name is mended ${on}`); assert.ok(/Read “fulerton” as “fullerton”\./.test(r.say), r.say);
    r = F.search('lisbon 1998', 24, closed); R.together = r.works.map(w => w.slug);
    assert.deepStrictEqual(R.together, [W.harbour.slug], `carried, never together: the year is set aside ${on}`); assert.ok(/together\. Showing “lisbon”, without “1998”\./.test(r.say), r.say);
    r = F.search('"tower bell"', 24, closed); R.apart = r.works.map(w => w.slug).sort();
    assert.deepStrictEqual(R.apart, [W.bell.slug, W.tower.slug].sort(), `a phrase nothing carries: its words apart ${on}`); assert.ok(/as written\. Showing the words apart\./.test(r.say), r.say);
    r = F.search('zzzzqq', 24, closed); assert.strictEqual(r.works.length, 0, `a word nothing carries ${on}`); assert.strictEqual(r.say, null);
    assert.strictEqual(F.search('seine', 24, closed).say, null, 'nothing is said when nothing was set aside');
    if (road === '0' || db.kind === 'postgres') { r = F.search('rooftosp', 24, closed); assert.strictEqual(r.works[0] && r.works[0].slug, W.roofs.slug, `a slip in a title, the nearest ${on}`); assert.ok(/Showing the nearest\./.test(r.say), r.say); }
    // 3. Rank as a curator would.
    const seineAsk = ask('the seine');
    assert.strictEqual(seineAsk[0], W.seine.slug, `the living maker's exact title first, above the museum's starred one ${on}: ${seineAsk.map(title).join(' | ')}`);
    assert.strictEqual(seineAsk[1], W.metSeine.slug, `then the museum's exact title ${on}`);
    assert.ok(seineAsk.indexOf(W.metSeine.slug) < seineAsk.indexOf(W.morning.slug), `a museum's exact title above a maker's keyword ${on}`);
    assert.ok(seineAsk.indexOf(W.banks[0].slug) < seineAsk.indexOf(W.morning.slug), `a word of the title above a keyword, whoever made it ${on}`);
    assert.strictEqual(ask('seine')[0], W.seine.slug, `one word: not buried under the museum's objects that share it ${on}`);
    assert.ok(ask('seine').length >= (road === '1' ? 7 : 11), `and the museum's objects follow (the database road stops at its ceiling: five here, 400 in a house) ${on}`);
    // The adult zone: a closed zone never sees a mature work, by any road.
    for (const q of ['nude', 'nude study', '"nude study"', 'paris 1962', 'paris 1960s', 'nude xyzzy', 'nude by will fullerton', 'nuda study', acc(W.nude.slug), 'will fullerton']) assert.ok(!ask(q).includes(W.nude.slug), `closed zone, "${q}" ${on}`);
    assert.ok(ask('nude study', grown).includes(W.nude.slug) && ask(acc(W.nude.slug), grown)[0] === W.nude.slug && ask('paris 1962', grown).includes(W.nude.slug), `the open zone sees it ${on}`);
    assert.ok(!JSON.stringify(F.search('nude xyzzy', 24, closed)).includes(W.nude.slug), 'nor in anything else the answer carries');
  }
  // The two roads give the same answers.
  for (const k of Object.keys(roads['0'])) { const past = roads['0'][k].length > 5; assert.deepStrictEqual(past ? roads['1'][k].slice(0, 2) : roads['1'][k], past ? roads['0'][k].slice(0, 2) : roads['0'][k], `both roads, the same works in the same order (past the ceiling, the same first two): ${k}`); }
  // 4. What found nothing is kept: the words, the day, a count; nothing of a person. Only a deliberate ask is kept.
  const http = require('http'); const srv = http.createServer(app).listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const tick = () => new Promise(r => setTimeout(r, 150));
  await fetch(`${base}/api/find?q=zzzzqq`); await tick();
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM find_misses').get().n | 0, 0, 'typing in the box keeps nothing');
  let h = await (await fetch(`${base}/find?q=Zzzzqq%20Blorp`, { headers: { cookie: 'wm_v=abcdef1234567890', 'user-agent': 'A-Very-Particular-Browser/9', 'x-forwarded-for': '203.0.113.9' } })).text(); await tick();
  assert.ok(h.includes('Nothing by that word yet') && h.includes('/everything') && h.includes('fd-chips'), 'nothing, with ways on');
  await fetch(`${base}/find?q=zzzzqq+blorp`); await fetch(`${base}/wander?q=${encodeURIComponent('the seine by will fullerton xyzzy')}`); await fetch(`${base}/find?q=seine`); await fetch(`${base}/find?q=someone%40example.com`); await fetch(`${base}/find?q=qqq+212+555+0100`); await tick();
  const rows = db.prepare('SELECT * FROM find_misses ORDER BY words').all();
  assert.deepStrictEqual(rows.map(x => [x.words, Number(x.n)]), [['the seine by will fullerton xyzzy', 1], ['zzzzqq blorp', 2]], 'the words and a count: ' + JSON.stringify(rows));
  assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['day', 'n', 'words'], 'words, day and count only');
  assert.ok(/^\d{4}-\d\d-\d\d$/.test(rows[0].day) && !JSON.stringify(rows).match(/abcdef|Particular|203\.0|example\.com|555/), 'no person, no address, no cookie, no device');
  db.prepare("INSERT INTO find_misses (day, words, n) VALUES (?, 'an old ask', 3)").run(new Date(Date.now() - 91 * 86400e3).toISOString().slice(0, 10));
  db.prepare("INSERT INTO find_misses (day, words, n) VALUES (?, 'a recent ask', 1)").run(new Date(Date.now() - 80 * 86400e3).toISOString().slice(0, 10));
  assert.strictEqual(F.pruneMisses(), 1, 'ninety days, then let go'); assert.ok(db.prepare("SELECT 1 AS y FROM find_misses WHERE words='a recent ask'").get());
  const H = { 'content-type': 'application/x-www-form-urlencoded' };
  let r2 = await fetch(`${base}/studio/login`, { method: 'POST', headers: H, body: 'password=pw', redirect: 'manual' }); const ck = (r2.headers.getSetCookie ? r2.headers.getSetCookie() : [r2.headers.get('set-cookie')]).map(c => c.split(';')[0]).join('; ');
  h = await (await fetch(`${base}/studio/feedback`, { headers: { cookie: ck } })).text();
  assert.ok(h.includes('Searches that found nothing') && h.includes('zzzzqq blorp') && h.includes('2 times'), 'read in the Studio, on the feedback desk');
  assert.strictEqual((await fetch(`${base}/studio/feedback`, { redirect: 'manual' })).status !== 200, true, 'and only there');
  // The page says what was set aside; Wander walks the same words.
  h = await (await fetch(`${base}/find?q=${encodeURIComponent('the seine by will fullerton xyzzy')}`)).text();
  assert.ok(h.includes('Nothing carries “xyzzy”. Showing “the seine by will fullerton”.') && h.includes(W.seine.slug), 'the page says it and shows the work');
  const stroll = async (q, cookie) => ((await (await fetch(`${base}/api/stroll?n=12&q=${encodeURIComponent(q)}`, cookie ? { headers: { cookie } } : {})).json()).items || []).map(x => x.slug).filter(x => !/^[trc]:/.test(x));
  assert.deepStrictEqual((await stroll('the seine by will fullerton')).sort(), [W.seine.slug, W.morning.slug].sort(), 'Wander by the words as a person asks');
  assert.deepStrictEqual((await stroll('the seine by will fullerton xyzzy')).sort(), [W.seine.slug, W.morning.slug].sort(), 'and by the telling words');
  assert.deepStrictEqual((await stroll('seurat drawings at the art institute')).sort(), [W.seated.slug, W.land.slug].sort(), 'Wander by an artist, a kind and a holder');
  assert.ok(!(await stroll('nude study')).includes(W.nude.slug) && !(await stroll('paris 1962')).includes(W.nude.slug) && !(await stroll(acc(W.nude.slug))).includes(W.nude.slug), 'Wander: the closed zone');
  assert.ok((await stroll('nude study', 'wm_zone=mature')).includes(W.nude.slug), 'Wander: the open zone');
  srv.close(); console.log(`findask: how people ask holds on both roads (${db.kind})`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
