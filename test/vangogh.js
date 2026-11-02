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
  assert.ok(t.includes('class="apl"') && t.includes('Saint-Rémy') && t.includes('apl-tick') && t.includes('/wander/art/' + a.slug) && t.includes('Share this page') && t.includes('data-send-url="/art/' + a.slug + '"') && t.includes('/art/' + a.slug + '/card.png') && t.includes('/claim'), 'the artist page, by period, the life as a line');
  { const ww = await (await fetch(base + '/wander/art/' + a.slug)).text(); assert.ok(ww.includes('data-st-setshare') && ww.includes('data-url="/art/' + a.slug + '"') && ww.includes('/art/' + a.slug + '/card.png') && ww.includes('>Vincent van Gogh<i>') && ww.includes('class="st-i'), 'the artist\'s wander, at an address worth sending, with its own card');
    const cd = await fetch(base + '/art/' + a.slug + '/card.png'); assert.equal(cd.status, 200); assert.equal(cd.headers.get('content-type'), 'image/png'); const cdb = Buffer.from(await cd.arrayBuffer()); if (process.env.CARD_OUT) require('fs').writeFileSync(process.env.CARD_OUT, cdb); const meta = await require('sharp')(cdb).metadata(); assert.ok(meta.width === 1200 && meta.height === 630, 'the artist\'s card, 1200 × 630');
    const nx = await fetch(base + '/wander/art/nobody-at-all', { redirect: 'manual' }); assert.equal(nx.status, 302, 'no such artist: to the hall'); }
  const mo = app.locals.art.ensure('Claude Monet', { born: 1840, died: 1926 }); let queued = []; app.locals.feeds.enqueue = b => { queued.push(b); return queued.length; };
  const br = await (await go('/studio/art/' + mo.slug + '/bring', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1&cats=' + encodeURIComponent('https://commons.wikimedia.org/wiki/Category:Paintings_by_Claude_Monet\nhttps://example.com/x') })).json();
  assert.ok(br.ok && queued.length === 1 && queued[0].open === 'pd' && /not a Commons/.test(br.feeds[1]), 'one Commons feed, open, the stranger address refused');
  t = await (await fetch(base + '/art/' + mo.slug)).text(); assert.ok(t.includes('Claude Monet') && t.includes('Born 1840'), 'an empty page still stands, with the life');
  // The catalogue (2 Nov): every work Wikidata knows by him, in order; the house's own as pictures, the rest named in their place; the open photographs queued through one feed.
  { const held = db.prepare('SELECT * FROM works WHERE slug=?').get(j.slug); db.prepare('UPDATE works SET source_url=? WHERE id=?').run('https://commons.wikimedia.org/wiki/File:Starry_Night.jpg', held.id);
    const b = (x) => ({ type: 'literal', value: x }); let asked = [];
    app.locals.iiif.doFetch = async u => { asked.push(u); const q = decodeURIComponent(String(u).split('query=')[1] || '');
      const rows = /P856/.test(q) ? [{ c: b('http://www.wikidata.org/entity/Q188740'), cLabel: b('Museum of Modern Art'), site: b('https://www.moma.org'), cityLabel: b('New York City'), countryLabel: b('United States'), coord: b('Point(-73.9776 40.7614)') }, { c: b('http://www.wikidata.org/entity/Q180788'), cLabel: b('National Gallery'), site: b('https://www.nationalgallery.org.uk'), cityLabel: b('London'), countryLabel: b('United Kingdom'), coord: b('Point(-0.1283 51.5089)') }]
        : /rdfs:label/.test(q) ? [{ p: b('http://www.wikidata.org/entity/Q5582'), born: b('1853-03-30T00:00:00Z'), n: b('900') }]
        : [{ w: b('http://www.wikidata.org/entity/Q45585'), wLabel: b('The Starry Night'), date: b('1889-06-01T00:00:00Z'), image: b('http://commons.wikimedia.org/wiki/Special:FilePath/Starry%20Night.jpg'), coll: b('http://www.wikidata.org/entity/Q188740'), collLabel: b('Museum of Modern Art'), described: b('https://www.moma.org/collection/works/79802'), inv: b('472.1941'), medLabel: b('oil paint'), typeLabel: b('painting') }, { w: b('http://www.wikidata.org/entity/Q45585'), wLabel: b('The Starry Night'), medLabel: b('canvas') },
           { w: b('http://www.wikidata.org/entity/Q151047'), wLabel: b('Sunflowers'), date: b('1888-08-01T00:00:00Z'), image: b('http://commons.wikimedia.org/wiki/Special:FilePath/Sunflowers.jpg'), coll: b('http://www.wikidata.org/entity/Q180788'), collLabel: b('National Gallery'), typeLabel: b('painting'), h: b('92.1'), wd: b('73') },
           { w: b('http://www.wikidata.org/entity/Q1'), wLabel: b('A lost study'), date: b('1885-01-01T00:00:00Z'), typeLabel: b('drawing') },
           { w: b('http://www.wikidata.org/entity/Q2'), wLabel: b('Q2'), typeLabel: b('painting') }];
      return { ok: true, status: 200, json: async () => ({ results: { bindings: rows } }) }; };
    const cr = await (await go('/studio/art/' + a.slug + '/catalogue', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1&do=read' })).json();
    assert.ok(cr.ok && cr.qid === 'Q5582' && cr.n === 3 && cr.pictures === 2, 'read: three works, two with a photograph, an unlabelled item left out');
    { const hw = db.prepare('SELECT * FROM works WHERE slug=?').get(j.slug); assert.ok(hw.medium === 'Oil on canvas' || /oil/i.test(hw.medium || ''), 'the medium as a label says it: ' + hw.medium); }
    assert.equal(require('../src/catalogue').mediumLabel(['oil paint', 'canvas']), 'Oil on canvas'); assert.equal(require('../src/catalogue').mediumLabel(['watercolor paint', 'graphite', 'paper']), 'Watercolour and pencil on paper');
    t = await (await fetch(base + '/art/' + a.slug)).text();
    assert.ok(t.includes('3 known works, 1 in the house') && t.includes('apl-gh') && t.includes('Sunflowers') && t.includes('National Gallery') && t.includes('A lost study') && t.includes('No open photograph') && t.includes('92.1 × 73 cm'), 'the whole body of work, the gaps named');
    assert.ok(t.indexOf('A lost study') < t.indexOf('Sunflowers') && t.indexOf('Sunflowers') < t.lastIndexOf('/img/' + j.slug + '/screen'), 'in the order made');
    t = await (await fetch(base + '/art/visit')).text(); assert.ok(t.includes('See it in person') && t.includes('Museum of Modern Art') && t.includes('New York City, United States') && t.includes('London, United Kingdom') && t.includes('data-lat="51.5089"') && t.includes('Nearest to me'), 'every house that keeps one, by city');
    t = await (await fetch(base + '/art/visit/Q180788')).text(); assert.ok(t.includes('National Gallery') && t.includes('Sunflowers') && t.includes('https://www.nationalgallery.org.uk') && t.includes('Plan a visit') && t.includes('no connection with National Gallery'), 'one museum: what you can see there');
    t = await (await fetch(base + '/w/' + j.slug)).text(); assert.ok(t.includes('class="ipn"') && t.includes('See it in person') && t.includes('Museum of Modern Art') && t.includes('https://www.moma.org/collection/works/79802') && t.includes('no. 472.1941'), 'the work: where to see the original');
    t = await (await fetch(base + '/art/' + a.slug)).text(); assert.ok(t.includes('/art/visit/Q180788') && t.includes('See it in person: every museum'), 'the artist page: where the originals are, linked');
    assert.equal((await fetch(base + '/art/visit/Q999999')).status, 404, 'an unknown house');
    { const wj = app.locals.wanderJSON(db.prepare('SELECT * FROM works WHERE slug=?').get(j.slug), { cookies: {}, headers: {} }); assert.ok(wj.maker === 'Vincent van Gogh' && wj.artist && wj.artist.href === '/art/' + a.slug && !wj.collect && wj.makerSlug, 'Wander names the artist, never the shelf, and sells nothing open'); }
    { t = await (await fetch(base + '/w/' + j.slug)).text(); assert.ok(t.includes('class="bgx"') && t.includes('Samsung Frame, 4K') && t.includes('/background/iphone'), 'backgrounds on the work page, free for an open work');
      for (const [k, W, H] of [['iphone', 1320, 2868], ['frame', 3840, 2160], ['duo', 2784, 1892]]) { const rr = await fetch(base + `/w/${j.slug}/background/${k}`); assert.equal(rr.status, 200); const md = await sharp(Buffer.from(await rr.arrayBuffer())).metadata(); assert.ok(md.width === W && md.height === H && md.format === 'jpeg', `${k}: ${W} by ${H} (${md.width}×${md.height})`); assert.ok(/attachment/.test(rr.headers.get('content-disposition')), 'to save'); }
      { const rr = await fetch(base + `/w/${j.slug}/background/macbook?mode=whole`); const raw = await sharp(Buffer.from(await rr.arrayBuffer())).raw().toBuffer({ resolveWithObject: true }); assert.ok(raw.info.width === 3456 && raw.data[0] < 20, 'whole: set on the dark'); }
      db.prepare('UPDATE works SET open=NULL WHERE slug=?').run(j.slug); assert.equal((await fetch(base + `/w/${j.slug}/background/iphone`, { redirect: 'manual' })).status, 302, 'a maker’s work: only for those who hold it');
      t = await (await fetch(base + '/w/' + j.slug)).text(); assert.ok(t.includes('Collect it</a> and every size is yours') && !t.includes('/background/iphone'), 'the sizes shown, the way to Collect'); db.prepare("UPDATE works SET open='pd' WHERE slug=?").run(j.slug); }
    const its = app.locals.catalogue.items('Q5582'); assert.ok(its.length === 1 && its[0].label === 'Sunflowers' && /Special:FilePath\/Sunflowers\.jpg\?width=3840/.test(its[0].image) && its[0].id === 'https://commons.wikimedia.org/wiki/File%3ASunflowers.jpg', 'what the feed will bring: only the open photograph not yet held');
    let fed = null; app.locals.feeds.enqueue = x => { fed = x; return 77; };
    const bq = await (await go('/studio/art/' + a.slug + '/catalogue', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1&do=bring' })).json();
    assert.ok(bq.ok && bq.feed === 77 && fed.kind === 'catalogue' && fed.open === 'pd' && /Q5582/.test(fed.url), 'brought through one feed');
    const mr = await (await go('/studio/art/' + mo.slug + '/catalogue', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1&do=bring' })).json(); assert.ok(!mr.ok, 'not before the catalogue is read');
    const liv = app.locals.art.ensure('A Living Painter', { born: 1980 }); db.prepare("UPDATE artists SET qid='Q9', catalogue_at=datetime('now') WHERE id=?").run(liv.id);
    const lr = await (await go('/studio/art/' + liv.slug + '/catalogue', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1&do=bring' })).json(); assert.ok(!lr.ok && /not in the public domain/.test(lr.error), 'a living artist is listed, never copied'); }
  console.log('vincent: all hold'); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
