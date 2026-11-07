// The Art Institute and Cleveland through the line (7 Nov): the scout's readers as feeds, a page at a time, onto a desk
// under the museum's own name; 'keep going' lines up the next pages while a run found anything; a short page ends it.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-mline-'));
  const pic = await sharp({ create: { width: 2600, height: 1800, channels: 3, noise: { type: 'gaussian', mean: 120, sigma: 40 } } }).jpeg().toBuffer();
  const asked = [];
  const fetchImpl = async (u, o) => {
    u = String(u); asked.push(u);
    if (/artic\.edu\/iiif/.test(u)) { const id = +((u.match(/\/2\/(\d+)\/full/) || [])[1] || 1); return new Response(id === 1 ? pic : await sharp(pic).modulate({ brightness: 0.5 + id / 10 }).flop().jpeg().toBuffer(), { status: 200, headers: { 'content-type': 'image/jpeg' } }); }
    if (/api\.artic\.edu\/api\/v1\/artworks\/search/.test(u)) {
      const page = +new URL(u).searchParams.get('page') || 1;
      const data = page === 1 ? [
        { id: 1, title: 'A Sunday on La Grande Jatte', artist_title: 'Georges Seurat', date_display: '1884–86', date_start: 1884, medium_display: 'Oil on canvas', image_id: '1', is_public_domain: true, artwork_type_title: 'Painting', main_reference_number: '1926.224', credit_line: 'Helen Birch Bartlett Memorial Collection' },
        { id: 2, title: 'Nighthawks', artist_title: 'Edward Hopper', date_display: '1942', date_start: 1942, medium_display: 'Oil on canvas', image_id: '2', is_public_domain: false, artwork_type_title: 'Painting' },
        { id: 3, title: 'Paris Street; Rainy Day', artist_title: 'Gustave Caillebotte', date_display: '1877', date_start: 1877, medium_display: 'Oil on canvas', image_id: '3', is_public_domain: true, artwork_type_title: 'Painting', main_reference_number: '1964.336' },
      ] : [];
      return new Response(JSON.stringify({ pagination: { total: 3 }, data, config: { iiif_url: 'https://www.artic.edu/iiif/2' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('no', { status: 404 });
  };
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'ml', noTimers: true, vaultNow: true, fetchImpl });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; } return r; });
  const form = (p, b) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  await form('/studio/login', { password: 'pw' });
  // The feeds know the two readers by name; the line's page offers them.
  assert.equal(app.locals.feeds.kindOf({ url: app.locals.line.museumUrl({ src: 'aic' }), kind: 'aic' }), 'aic');
  let t = await (await go('/studio/line')).text(); assert.ok(/All of the Art Institute/.test(t) && /All of Cleveland/.test(t), 'the line offers the museums');
  let r = await form('/studio/line/museum', { src: 'aic', n: '10', more: '1' }); assert.equal(r.status, 302);
  t = await (await go('/studio/line')).text(); assert.ok(/The Art Institute of Chicago · everything open · from page 1/.test(t), 'in line: ' + (t.match(/bl-r[^<]*<div><b>([^<]*)/) || [])[1]);
  await app.locals.line.tick(); const item = db.prepare("SELECT * FROM lineup WHERE kind='museum'").get(); assert.ok(item.feed_id, 'the line started a feed: ' + item.note);
  await app.locals.feeds.run(db.prepare('SELECT * FROM feeds WHERE id=?').get(item.feed_id));
  const f = db.prepare('SELECT * FROM feeds WHERE id=?').get(item.feed_id); assert.equal(f.status, 'done', f.note); assert.equal(f.taken, 2, 'the two open works came in, the closed one never asked for: ' + JSON.stringify(f));
  const desk = db.prepare("SELECT * FROM makers WHERE handle='art-institute-of-chicago'").get(); assert.ok(desk && desk.kind === 'institution', 'the museum’s own desk');
  const w = db.prepare("SELECT * FROM works WHERE source_url='https://www.artic.edu/artworks/1'").get(); const seurat = db.prepare("SELECT * FROM artists WHERE name='Georges Seurat'").get();
  assert.ok(w && w.maker_id === desk.id && w.status === 'held' && w.open === 'cc0' && w.artist_id === seurat.id && w.kind === 'painting', 'Seurat on the desk, open, linked: ' + JSON.stringify({ w: w && { m: w.maker_id, s: w.status, o: w.open, a: w.artist_id, k: w.kind }, seurat }));
  assert.ok(!db.prepare("SELECT 1 FROM works WHERE source_url='https://www.artic.edu/artworks/2'").get(), 'Hopper, under copyright, never came in');
  assert.ok(!asked.some(u => /artic\.edu\/iiif\/2\/2\//.test(u)), 'and its picture was never fetched');
  await app.locals.line.tick(); assert.equal(db.prepare("SELECT status FROM lineup WHERE id=?").get(item.id).status, 'done', 'the line closes the run');
  const nx = db.prepare("SELECT * FROM lineup WHERE status='waiting' ORDER BY pos, id LIMIT 1").get(); assert.ok(nx && /from page 2/.test(nx.label), 'keep going: the next page lined up: ' + (nx && nx.label));
  await app.locals.line.tick(); await app.locals.feeds.run(db.prepare('SELECT * FROM feeds WHERE id=?').get(db.prepare('SELECT feed_id FROM lineup WHERE id=?').get(nx.id).feed_id));
  await app.locals.line.tick(); assert.ok(!db.prepare("SELECT 1 FROM lineup WHERE status='waiting'").get(), 'an empty page ends it');
  // The work page says whose desk it is and names the artist.
  t = await (await go(`/w/${w.slug}`)).text(); assert.ok(t.includes('Georges Seurat') && t.includes('The Art Institute of Chicago'), 'the work page');
  srv.close(); console.log('the museums’ line: holds'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
