// At auction (10 Nov): a lot recorded by hand, a house photograph hung on it, shown, with the way out to bid.
process.env.NODE_ENV = 'test';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-auc-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'auc', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
  const a = app.locals.art.ensure('Vincent van Gogh', { born: 1853, died: 1890 });
  const f = path.join(dir, 'p.jpg'); await sharp({ create: { width: 1200, height: 900, channels: 3, noise: { type: 'gaussian', mean: 90, sigma: 30 } } }).jpeg().toFile(f);
  const w = await app.locals.registerWork({ file: f, title: 'Romans parisiens', originalName: 'p.jpg', kind: 'painting' });
  db.prepare("UPDATE works SET status='held', artist_id=?, open='pd' WHERE id=?").run(a.id, w.id);
  const jar = (await fetch(base + '/studio/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' })).headers.get('set-cookie').split(';')[0];
  const post = (p, body) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { cookie: jar, 'content-type': 'application/x-www-form-urlencoded', origin: base }, body });
  let r = await post('/studio/auction', 'house=Sotheby%E2%80%99s&title=');
  assert.ok(r.headers.get('location').includes('ok=bad'), 'needs a title');
  r = await post('/studio/auction', new URLSearchParams({ url: 'https://www.sothebys.com/buy/x/lots/y', house: 'Sotheby’s', sale: 'Modern Evening Auction', sale_at: '2026-11-18', city: 'New York', lot_no: '12', artist: 'Vincent van Gogh', title: 'Romans parisiens (Les Livres jaunes)', made: '1887', medium: 'Oil on canvas', est_low: '40,000,000', est_high: '60000000', work: '/w/' + w.slug, line: 'A table of yellow books.' }).toString());
  assert.ok(r.headers.get('location').includes('ok=made'));
  const l = db.prepare('SELECT * FROM auction_lots').get();
  assert.strictEqual(l.work_id, w.id); assert.strictEqual(l.artist_id, a.id); assert.strictEqual(l.est_low, 4000000000); assert.strictEqual(l.shown, 0);
  assert.strictEqual((await fetch(base + '/auction/' + l.slug)).status, 404, 'not shown: a stranger sees nothing');
  assert.ok(!(await (await fetch(base + '/auction')).text()).includes('Romans parisiens'), 'nor on the list');
  let t = await (await fetch(base + '/auction/' + l.slug, { headers: { cookie: jar } })).text(); assert.ok(t.includes('only the Studio sees'), 'the Studio previews it');
  await post('/studio/auction/' + l.id, 'do=show');
  t = await (await fetch(base + '/auction/' + l.slug)).text();
  assert.ok(t.includes('Bid at Sotheby’s') && t.includes('https://www.sothebys.com/buy/x/lots/y') && t.includes('$40,000,000 – $60,000,000') && t.includes('November 18, 2026') && t.includes('is not connected with Sotheby’s') && t.includes(`/img/${w.slug}/large`) && t.includes('/art/' + a.slug), 'the lot page');
  t = await (await fetch(base + '/auction')).text(); assert.ok(t.includes('Modern Evening Auction') && t.includes('Estimate $40,000,000'), 'the list');
  t = await (await fetch(base + '/w/' + w.slug)).text(); assert.ok(t.includes('Coming to sale at Sotheby’s') && t.includes('/auction/' + l.slug), 'the work page says so');
  // a javascript: address is never kept; the result recorded
  r = await post('/studio/auction/' + l.id, new URLSearchParams({ do: 'save', url: 'javascript:alert(1)', house: 'Sotheby’s', title: l.title, artist: l.artist, work: w.slug, status: 'sold', result: '62,700,000' }).toString());
  const l2 = db.prepare('SELECT * FROM auction_lots').get(); assert.strictEqual(l2.url, null); assert.strictEqual(l2.status, 'sold'); assert.strictEqual(l2.result, 6270000000);
  t = await (await fetch(base + '/auction')).text(); assert.ok(t.includes('Sold for $62,700,000') && t.includes('Sold, and remembered'), 'remembered after');
  assert.strictEqual((await fetch(base + '/studio/auction', { redirect: 'manual' })).status >= 300, true, 'the desk is the Studio’s');
  t = await (await fetch(base + '/studio/auction', { headers: { cookie: jar } })).text(); assert.ok(t.includes('Record a lot') && t.includes('On view'), 'the desk');
  srv.close(); console.log('auction ok'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
