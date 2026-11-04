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
  let t = await get('/library'); assert.ok(/<nav class="nv-verbs"[^>]*><a href="\/look"[^>]*>Look<\/a>/.test(t), 'Look is the first word of the nav');
  assert.ok(!/>Collect<\/a><a href="\/makers"/.test(t), 'Collect is no longer a menu word');
  t = await get('/wander'); assert.ok(t.includes('class="st-look" href="/look"') && t.includes('Look around'), 'Wander carries Look around');
  // The tab bar: five, on public pages and in Wander, never on a desk.
  t = await get('/look'); assert.ok(/<nav class="tb"[^>]*>(?:(?!<\/nav>).)*Wander(?:(?!<\/nav>).)*aria-current="page">(?:(?!<\/nav>).)*Look<\/span>/s.test(t) && /data-tb-you/.test(t) && t.includes('<span>Read</span>') && t.includes('<span>Find</span>'), 'the tab bar, Look lit');
  t = await get('/wander'); assert.ok(t.includes('class="tb"') && t.includes('data-find-open="stroll"'), 'the tab bar in Wander');
  // The hub and the Met's room.
  t = await get('/look'); assert.ok(t.includes('Where would you like to look?') && t.indexOf('href="/met"') > -1 && t.indexOf('href="/met"') < t.indexOf('href="/collection"'), 'the Met first on /look');
  t = await get('/met'); assert.ok(t.includes('The Met, open to everyone.') && t.includes('id="painting"') && t.includes('id="print"') && t.includes('Wheat Field with Cypresses') && t.includes('The 19th century') && t.includes('not the Met’s own site'), 'the Met a room at a time: ' + t.length);
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
