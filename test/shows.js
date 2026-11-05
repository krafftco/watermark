// The show (5 Nov): a tight choice from an artist's whole catalogue, the best of each period in proportion, in the
// order made; proposed by the house, opened by a person; the artist's page and Wander lead with it; ?all=1 is everything.
process.env.NODE_ENV = 'test'; process.env.SHOW_N = '8';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ash-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'ash', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  const A = app.locals.art; const a = A.ensure('Claude Monet', { born: 1840, died: 1926 });
  db.prepare('UPDATE artists SET periods=? WHERE id=?').run('1860–1879 Argenteuil: the river.\n1880–1899 Series: haystacks and cathedrals.\n1900–1926 Giverny: the water lilies.', a.id);
  const shelf = db.prepare("SELECT id FROM makers WHERE handle='the-public-domain'").get() || (() => { db.prepare("INSERT INTO makers (handle, name, kind, joined_at) VALUES ('the-public-domain','The public domain','institution',datetime('now'))").run(); return db.prepare("SELECT id FROM makers WHERE handle='the-public-domain'").get(); })();
  // 30 works: 4 early, 6 middle, 20 at Giverny; one middle work curated, one Giverny work twice by title
  const years = [1865, 1869, 1872, 1875, 1881, 1886, 1890, 1891, 1893, 1895, ...Array.from({ length: 20 }, (_, i) => 1900 + i)];
  let i = 0;
  for (const y of years) {
    const f = path.join(dir, `m${i}.jpg`); fs.writeFileSync(f, await sharp(path.join(__dirname, 'fixture.jpg')).resize(1200).modulate({ hue: i * 11 + 3, brightness: 0.7 + (i % 5) * 0.08 }).jpeg().toBuffer());
    const title = i === 12 || i === 13 ? 'Water Lilies' : `Picture ${i}`;
    const w = await app.locals.registerWork({ file: f, title, makerId: shelf.id, originalName: `m${i}.jpg` });
    db.prepare("UPDATE works SET status='held', artist_id=?, taken_at=?, curated=?, stars=? WHERE slug=?").run(a.id, `${y}-06-01`, i === 7 ? 1 : 0, i === 25 ? 5 : 0, w.slug);
    i++;
  }
  const S = app.locals.shows;
  const pick = S.propose(a, 8);
  assert.equal(pick.length, 8, 'eight chosen');
  const yrs = pick.map(w => w.y); assert.deepEqual(yrs, yrs.slice().sort((x, y) => x - y), 'in the order made');
  assert.ok(pick.some(w => w.y < 1880) && pick.some(w => w.y >= 1880 && w.y < 1900) && pick.some(w => w.y >= 1900), 'every period is in the show');
  assert.ok(pick.filter(w => w.y >= 1900).length < 6, 'Giverny does not drown the early years');
  assert.ok(pick.some(w => w.curated) && pick.some(w => w.stars === 5), 'the curated and the starred are in');
  assert.ok(pick.filter(w => w.title === 'Water Lilies').length <= 1, 'no title twice');

  // the page before a show: the catalogue only; Studio proposes, the page still has none until opened
  let t = await (await go({}, `/art/${a.slug}`)).text(); assert.ok(!t.includes('class="ash"') && t.includes('Wander the work'));
  let r = await form(studio, `/studio/art/${a.slug}/show`, { do: 'propose', n: '8' }); assert.ok(r.headers.get('location').includes('ok=proposed'));
  t = await (await go(studio, `/studio/art/${a.slug}`)).text(); assert.ok(t.includes('Open the show') && t.includes('The show'), 'the desk');
  t = await (await go({}, `/art/${a.slug}`)).text(); assert.ok(!t.includes('class="ash"'), 'a proposed show is not on the page');
  await form(studio, `/studio/art/${a.slug}/show`, { do: 'save', title: 'Monet: The Light Moves', line: 'Eight works.' });
  await form(studio, `/studio/art/${a.slug}/show`, { do: 'open' });
  t = await (await go({}, `/art/${a.slug}`)).text();
  assert.ok(t.includes('class="ash"') && t.includes('Monet: The Light Moves') && t.includes('Walk the show') && t.includes('Wander everything') && t.includes('The catalogue'), 'the page leads with the show');
  assert.equal((t.match(/class="ash-w"/g) || []).length, 8, 'eight on the wall');
  assert.ok(t.includes(`/art/${a.slug}?all=1#`), 'a long period folds to its first twelve with All');
  const t2 = await (await go({}, `/art/${a.slug}?all=1`)).text(); assert.ok(!t2.includes('ash-more'), 'all=1 shows every work');
  // Wander walks the show; all=1 walks everything
  r = await go({}, `/wander/art/${a.slug}`); t = await r.text(); assert.equal(r.status, 200);
  const h = S.showOf(a); const first = db.prepare('SELECT w.slug FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? ORDER BY hw.pos LIMIT 1').get(h.id).slug;
  assert.ok(t.includes(first), 'Wander starts the show');
  // the register tells it
  t = await (await go({}, '/ledger')).text(); assert.ok(t.includes('The house opened a show'), 'on the register');
  await form(studio, `/studio/art/${a.slug}/show`, { do: 'close' });
  t = await (await go({}, `/art/${a.slug}`)).text(); assert.ok(!t.includes('class="ash"'), 'closed');
  srv.close(); console.log('shows: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
