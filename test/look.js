// Look and the price record (3 Nov): the nav's first word is Look; /look puts the Met first; /met a room at a time
// with search; Wander carries Look around; every work's price record from the register, working fees never priced.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-look-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'look', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const get = p => fetch(base + p, { redirect: 'manual' }).then(r => r.text());
  db.prepare("INSERT INTO makers (handle, name, kind, joined_at, door) VALUES ('museum-demo', 'A museum desk (demonstration)', 'institution', datetime('now'), 'house')").run();
  const met = db.prepare("SELECT * FROM makers WHERE handle='museum-demo'").get();
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const put = async (title, makerId, extra = {}) => { const f = path.join(dir, `l-${++k}.jpg`); fs.writeFileSync(f, await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: (k * 61) % 255, g: (k * 37) % 255, b: (k * 89) % 255 } } }).composite([{ input: await sharp(fx).resize(300 + k * 40).toBuffer(), left: k * 50, top: k * 30 }]).jpeg().toBuffer()); const w = await app.locals.registerWork({ file: f, title, makerId, originalName: path.basename(f), ...extra }); db.prepare("UPDATE works SET status='held' WHERE slug=?").run(w.slug); return w.slug; };
  const wheat = await put('Wheat Field with Cypresses', met.id, { kind: 'painting' }); db.prepare("UPDATE works SET taken_at='1889-06-01' WHERE slug=?").run(wheat);
  await put('The Great Wave', met.id, { kind: 'print' });
  // The nav and Wander.
  // The quiet house (4 Nov): Keep your work in the nav, Wander · Find · You at the foot; every room in Find and on /everything.
  const V = require('../src/views'); assert.ok(V.isQuiet(), 'quiet by default');
  let t = await get('/library'); assert.ok(/<nav class="nv-verbs"[^>]*><a href="\/makers"[^>]*>Keep your work<\/a>/.test(t) && /class="tb tb-3"/.test(t) && !/<span>Read<\/span>/.test(t.slice(t.indexOf('class="tb tb-3"'))), 'the quiet nav and tab bar');
  t = await get('/everything'); assert.ok(t.includes('Every room.') && t.includes('href="/listening"') && t.includes('href="/keys"') && t.includes('href="/met"'), '/everything lists the rooms');
  let fj = await fetch(base + '/api/find?q=listening').then(r => r.json()); assert.ok(fj.doors && fj.doors.some(d => d.href === '/listening') && fj.doorsFirst, 'Find finds a room by name');
  t = await get('/find?q=keys'); assert.ok(t.includes('In the house') && t.includes('href="/keys"'), 'the /find page shows the rooms');
  V.setQuiet(false);
  t = await get('/print'); assert.ok(/<nav class="nv-verbs"[^>]*><a href="\/look"[^>]*>Look<\/a>/.test(t), 'Look is the first word of the nav');
  assert.ok(!/>Collect<\/a><a href="\/makers"/.test(t), 'Collect is no longer a menu word');
  t = await get('/wander'); assert.ok(t.includes('class="st-look" href="/look"') && t.includes('Look around'), 'Wander carries Look around');
  // The tab bar: five, on public pages and in Wander, never on a desk.
  t = await get('/look'); assert.ok(/<nav class="tb"[^>]*>(?:(?!<\/nav>).)*Wander(?:(?!<\/nav>).)*aria-current="page">(?:(?!<\/nav>).)*Look<\/span>/s.test(t) && /data-tb-you/.test(t) && t.includes('<span>Read</span>') && t.includes('<span>Find</span>'), 'the tab bar, Look lit');
  t = await get('/wander'); assert.ok(t.includes('class="tb"') && t.includes('data-find-open="stroll"'), 'the tab bar in Wander');
  V.setQuiet(true); t = await get('/wander?q=wheat'); assert.ok(/class="tb tb-3"/.test(t) && t.includes('data-find-open="stroll"'), 'the quiet tab bar in Wander');
  // The hub and the Met's room.
  // Discover (5 Nov): one search that finds everything, the ways in, the walls; the Met still first among the collections.
  const vg = app.locals.art.ensure('Vincent van Gogh', { born: 1853, died: 1890, movement: 'Post-Impressionism' }); db.prepare('UPDATE works SET artist_id=? WHERE slug=?').run(vg.id, wheat);
  app.locals.findIndexDirty();
  t = await get('/look'); assert.ok(t.includes('What would you like to see?') && t.includes('class="dsc-ways"') && t.includes('href="#time"') && t.includes('href="/wander?in=arrived"') && t.indexOf('href="/met"') > -1 && t.indexOf('href="/met"') < t.indexOf('href="/collection"'), 'Discover: the search, the ways in, the Met first');
  assert.ok(t.includes('id="artists"') && t.includes('Vincent van Gogh') && t.includes('1853–1890') && t.includes('id="time"') && t.includes('The 1880s') && t.includes('/wander?in=decade:1880') && t.includes('id="mediums"') && t.includes('/wander?in=kind:painting') && t.includes('id="arrived"') && t.includes(`/wander?in=arrived&amp;at=${wheat}`), 'the walls: artists, in time, mediums, just arrived');
  fj = await fetch(base + '/api/find?q=van%20gogh').then(r => r.json()); assert.ok(fj.artists && fj.artists[0] && fj.artists[0].href === '/art/' + vg.slug && fj.artistsFirst && fj.artists[0].n === 1, 'Find finds an artist of the hall, first');
  fj = await fetch(base + '/api/find?q=vna%20gogh').then(r => r.json()); assert.ok(fj.artists && fj.artists[0] && fj.artists[0].href === '/art/' + vg.slug, 'a slip of the fingers forgiven');
  fj = await fetch(base + '/api/find?q=1889').then(r => r.json()); assert.ok(fj.times && fj.times[0] && fj.times[0].href === '/wander?in=year:1889' && fj.times[0].n === 1 && fj.works[0].slug === wheat, 'a year is a time and its works');
  fj = await fetch(base + '/api/find?q=1880s').then(r => r.json()); assert.ok(fj.times[0] && fj.times[0].href === '/wander?in=decade:1880', 'a decade');
  fj = await fetch(base + '/api/find?q=19th%20century').then(r => r.json()); assert.ok(fj.times[0] && fj.times[0].name === 'The 1880s', 'a century opens to its decades');
  fj = await fetch(base + '/api/find?q=post-impressionism').then(r => r.json()); assert.ok(fj.movements && fj.movements[0] && fj.movements[0].href.includes('movement=Post-Impressionism'), 'a movement');
  fj = await fetch(base + '/api/find?q=paintings').then(r => r.json()); assert.ok(fj.kinds && fj.kinds[0] && fj.kinds[0].href === '/wander?in=kind:painting', 'a medium');
  fj = await fetch(base + '/api/find?q=museum').then(r => r.json()); assert.ok(fj.museums && fj.museums[0] && fj.museums[0].n === 2, 'a museum');
  fj = await fetch(base + '/api/find').then(r => r.json()); assert.ok(fj.before.artists[0].name === 'Vincent van Gogh' && fj.before.decades[0].name === '1880s' && fj.before.kinds.length === 2, 'the ways in before typing');
  t = await get('/find?q=van%20gogh'); assert.ok(t.includes('Artists of the hall') && t.includes('href="/art/' + vg.slug + '"') && !t.includes('Nothing by that word'), 'the /find page finds the artist');
  for (const set of ['year:1889', 'decade:1880', 'kind:painting', 'movement:Post-Impressionism', 'artist:' + vg.slug, 'arrived', 'living', 'stood', 'open', 'place:' + encodeURIComponent('Paris')]) { const r = await fetch(base + '/wander?in=' + set + '&at=' + wheat, { redirect: 'manual' }); assert.ok(r.status === 200 || r.status === 302, 'Wander in ' + set + ': ' + r.status); }
  t = await get('/wander?in=year:1889'); assert.ok(t.includes('The year 1889') && t.includes(wheat), 'Wander walks a year');
  t = await get('/wander?q=gogh'); assert.ok(t.includes(wheat), 'Wander by a word finds the artist');
  let rr = await fetch(base + '/look?q=wheat', { redirect: 'manual' }); assert.strictEqual(rr.status, 302); assert.ok(rr.headers.get('location').startsWith('/find?q=wheat'), '/look?q goes to Find');
  rr = await fetch(base + '/look?time=1880s', { redirect: 'manual' }); assert.ok(rr.headers.get('location') === '/wander?in=decade:1880', '/look?time opens the decade');
  t = await get('/met'); assert.ok(t.includes('Open access works from The Metropolitan Museum of Art.') && t.includes('id="painting"') && t.includes('id="print"') && t.includes('Wheat Field with Cypresses') && t.includes('The 19th century') && t.includes('not the Met’s own site'), 'the Met a room at a time: ' + t.length);
  t = await get('/met?q=cypress'); assert.ok(t.includes('Wheat Field with Cypresses') && !t.includes('The Great Wave'), 'search inside the Met');
  // The price record.
  const house = db.prepare("SELECT m.* FROM makers m JOIN uses u ON u.maker_id=m.id AND u.key='social' ORDER BY m.id LIMIT 1").get();
  const mine = await put('The Staircase', house.id);
  const w = db.prepare('SELECT * FROM works WHERE slug=?').get(mine);
  const use = key => db.prepare('SELECT id FROM uses WHERE maker_id=? AND key=?').get(house.id, key).id;
  let n = 0; const sell = (key, cents, at, no) => db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, price_cents, status, starts_at, collector_no) VALUES (?,?,?,?,?,?, 'active', ?, ?)").run(`WM-2026-9${String(++n).padStart(5, '0')}`, w.id, use(key), 'A', 'a@example.com', cents, at, no);
  sell('social', 700, '2026-10-01 12:00:00', 1); sell('social', 1050, '2026-10-20 12:00:00', 2); sell('commercial', 90000, '2026-10-25 12:00:00', null);
  t = await get('/w/' + mine); assert.ok(t.includes('The price record') && t.includes('Last paid $10.50.') && t.includes('Collected, No. 2') && t.includes('those fees stay private') && !t.includes('$900'), 'the record on the work, the working fee unpriced');
  t = await get('/prices'); assert.ok(t.includes('2</b> sales') && t.includes('The Staircase') && !t.includes('$900'), 'the house index');
  t = await get('/prices/' + house.handle); assert.ok(t.includes('The Staircase'), 'the maker index');
  db.prepare('UPDATE makers SET price_record=0 WHERE id=?').run(house.id);
  t = await get('/w/' + mine); assert.ok(!t.includes('The price record'), 'a maker may keep it private');
  t = await get('/prices'); assert.ok(t.includes('0</b> sales'), 'and out of the index');
  srv.close(); console.log('look: all hold');
})().catch(e => { console.error(e); process.exit(1); });
