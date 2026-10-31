// Vincent (31 Oct): the room renders, the wall follows the paintings, no sale on open work, the plain disclaimer.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-vg-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'vg', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  let t = await (await fetch(base + '/vangogh')).text(); assert.ok(/Vincent van Gogh/.test(t) && /no connection with the Van Gogh Museum/.test(t), 'the room, and its plain line');
  // A painting in, as the feed would leave it: the shelf's, open, linked to the artist.
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie()) jar[c.split('=')[0]] = c.split('=')[1].split(';')[0]; return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  app.locals.feeds.enqueue = () => 0; app.locals.reading.bring = async () => null; // no network in the test
  const r = await (await go('/studio/vangogh/bring', { method: 'POST' })).json(); assert.ok(r.ok);
  const shelf = db.prepare("SELECT * FROM makers WHERE handle='the-public-domain'").get(); assert.ok(shelf && shelf.kind === 'institution', 'the shelf');
  const a = db.prepare("SELECT * FROM artists WHERE lower(name) LIKE '%van gogh%'").get(); assert.ok(a && a.died === 1890, 'the artist');
  await go(`/account?maker=${shelf.handle}`);
  const buf = await sharp({ create: { width: 1200, height: 950, channels: 3, background: { r: 30, g: 60, b: 140 } } }).jpeg().toBuffer(); const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), 'starry.jpg');
  const j = await (await go('/account/works/one', { method: 'POST', body: fd })).json();
  db.prepare("UPDATE works SET status='held', open='pd', artist_id=?, title='The Starry Night', taken_at='1889-06-01' WHERE slug=?").run(a.id, j.slug);
  t = await (await go('/vangogh')).text(); assert.ok(t.includes('Saint-Rémy') && t.includes('The Starry Night') && t.includes('/wander?in=hang:vincent-van-gogh'), 'grouped by where he was, the wall to wander');
  assert.ok(db.prepare("SELECT 1 FROM hangs h JOIN hang_works hw ON hw.hang_id=h.id WHERE h.slug='vincent-van-gogh' AND h.public=1").get(), 'the wall holds it');
  const jw = app.locals.workJSON(db.prepare('SELECT * FROM works WHERE slug=?').get(j.slug)); assert.ok(!jw.uses.length && jw.open, 'open: nothing for sale');
  // The artist's page: periods from the bring, the life line, the wall, the claim door; the bring for any artist.
  t = await (await fetch(base + '/art/' + a.slug)).text();
  assert.ok(t.includes('class="apl"') && t.includes('Saint-Rémy') && t.includes('apl-tick') && t.includes('/wander?in=hang:art-') && t.includes('/claim'), 'the artist page, by period, the life as a line');
  const mo = app.locals.art.ensure('Claude Monet', { born: 1840, died: 1926 }); let queued = []; app.locals.feeds.enqueue = b => { queued.push(b); return queued.length; };
  const br = await (await go('/studio/art/' + mo.slug + '/bring', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1&cats=' + encodeURIComponent('https://commons.wikimedia.org/wiki/Category:Paintings_by_Claude_Monet\nhttps://example.com/x') })).json();
  assert.ok(br.ok && queued.length === 1 && queued[0].open === 'pd' && /not a Commons/.test(br.feeds[1]), 'one Commons feed, open, the stranger address refused');
  t = await (await fetch(base + '/art/' + mo.slug)).text(); assert.ok(t.includes('Claude Monet') && t.includes('Born 1840'), 'an empty page still stands, with the life');
  console.log('vincent: all hold'); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
