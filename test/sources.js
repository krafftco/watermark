// The sources (#170): a work from a museum's open collection is shown as theirs. Its page names them, gives their credit
// line and their own page for the object, one tap away; the open credit is in their words (the Gallery's courtesy line);
// the page's data and a free-and-clear file claim no copyright and no licence of the house's; the Met's attribution
// qualifier ('Workshop of') is kept and such a work is not hung as the master's. A maker's own work is unchanged.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sources-'));
  const pic = await sharp({ create: { width: 2600, height: 2000, channels: 3, noise: { type: 'gaussian', mean: 120, sigma: 40 } } }).jpeg().toBuffer();
  let nth = 0; const fetchImpl = async u => {
    u = String(u);
    if (/collectionapi\.metmuseum\.org\/public\/collection\/v1\.1\/search/.test(u)) return new Response(JSON.stringify({ total: 1, objectIDs: [7] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/collectionapi\.metmuseum\.org\/public\/collection\/v1\/objects\/7/.test(u)) return new Response(JSON.stringify({ objectID: 7, isPublicDomain: true, primaryImage: 'https://images.metmuseum.org/7.jpg', title: 'A Workshop Panel', artistPrefix: 'Workshop of', artistDisplayName: 'Rogier van der Weyden', objectDate: 'ca. 1460', medium: 'Oil on wood', dimensions: '10 x 8 in.', creditLine: 'Bequest of A Test, 1913', department: 'European Paintings', accessionNumber: '13.1.7', objectURL: 'https://www.metmuseum.org/art/collection/search/7' }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(await sharp(pic).modulate({ brightness: 0.6 + (nth++) * 0.2 }).jpeg().toBuffer(), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'src', noTimers: true, vaultNow: true, fetchImpl });
  const { db } = app.locals; const I = app.locals.iiif; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const shelf = app.locals.art.shelf();
  // The Gallery, in nga.js's item shape (its labels).
  const ng = { id: 'https://www.nga.gov/collection/art-object-page.9.html', label: 'A Lady Writing', image: 'https://api.nga.gov/iiif/x/full/max/0/default.jpg', rights: 'cc0', kind: 'painting',
    meta: [['Artist', 'Johannes Vermeer'], ['Date', 'c. 1665'], ['Medium', 'oil on canvas'], ['Dimensions', 'overall: 45 x 39.9 cm'], ['Credit line', 'Gift of Harry Waldron Havemeyer'], ['Accession number', '1942.9.97'], ['Classification', 'Painting'], ['Courtesy', 'Courtesy National Gallery of Art, Washington']].map(([label, value]) => ({ label, value })), artist: { name: 'Johannes Vermeer', born: 1632, died: 1675 } };
  const r = await I.take(ng, { id: 1, maker_id: shelf.id, show: 1, open: 'cc0' }); assert.ok(r.w, 'taken');
  const w = db.prepare('SELECT slug, credit FROM works WHERE id=?').get(r.w.id);
  assert.equal(w.credit, 'Gift of Harry Waldron Havemeyer', 'the credit line kept whole in its own field');
  const html = await (await fetch(`${base}/w/${w.slug}`)).text();
  assert.ok(/From the collection of National Gallery of Art, Washington · Gift of Harry Waldron Havemeyer · <a href="https:\/\/www\.nga\.gov\/collection\/art-object-page\.9\.html"[^>]*>The object’s page at National Gallery of Art<\/a>/.test(html), 'their name, their credit line and their own page, on the label');
  assert.ok(/Courtesy National Gallery of Art, Washington\. CC0/.test(html) && !/The public domain, 1665/.test(html), 'the open credit in the Gallery’s own words, the artist first, never the shelf in the artist’s place');
  assert.ok(!/partner|in partnership|official/i.test((html.match(/From the collection of[^<]*/) || [''])[0]), 'a source, never a partner');
  const ld = JSON.parse((html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1]);
  assert.ok(!ld.copyrightNotice && !ld.copyrightHolder && !ld.acquireLicensePage && /publicdomain\/zero/.test(ld.license) && ld.creator.name === 'Johannes Vermeer', 'the page’s data claims no copyright and no licence page: ' + JSON.stringify(ld).slice(0, 300));
  const take = Buffer.from(await (await fetch(`${base}/open/${w.slug}/take`)).arrayBuffer()).toString('latin1');
  assert.ok(!/All rights reserved/.test(take) && !/CopyrightOwner|LicensorName/.test(take) && /<xmpRights:Marked>False/.test(take) && !/Not for AI training/.test(take), 'a free-and-clear file claims nothing the source did not');
  assert.ok(/<photoshop:Credit>Johannes Vermeer, A Lady Writing, 1665\. Gift of Harry Waldron Havemeyer\. Courtesy National Gallery of Art, Washington\.<\/photoshop:Credit>/.test(take), 'and carries their credit');
  const api = await (await fetch(`${base}/api/v1/works/${w.slug}`)).json();
  assert.ok(!/©|Held and licensed/.test(api.credit) && /Courtesy National Gallery of Art, Washington/.test(api.credit) && api.copyright.holder === null && /nga\.gov/.test(api.copyright.source), 'the public API says the same: ' + JSON.stringify({ c: api.credit, r: api.copyright }));
  const eye = await (await fetch(`${base}/api/eye/${w.slug}`)).json();
  assert.ok(/^CC0: no copyright is claimed here\./.test(eye.copyright) && !/©/.test(eye.copyright), 'the Watermark eye says the licence, not a ©: ' + eye.copyright);
  // The Met's qualifier, through its own reader.
  const man = await I.parseMet('https://collectionapi.metmuseum.org/public/collection/v1.1/search?q=panel', fetchImpl, 5);
  const it = man.items[0]; assert.ok(it.meta.some(m => m.label === 'Attribution' && m.value === 'Workshop of Rogier van der Weyden') && !it.artist && it.hand, 'Workshop of kept, never the master’s: ' + JSON.stringify(it.meta.slice(0, 2)));
  const r2 = await I.take(it, { id: 2, maker_id: shelf.id, show: 1, open: 'cc0' }); const w2 = db.prepare('SELECT slug, artist_id, hand FROM works WHERE id=?').get(r2.w.id);
  assert.ok(!w2.artist_id && w2.hand === 'not', 'not hung on the master’s wall');
  const h2 = await (await fetch(`${base}/w/${w2.slug}`)).text();
  assert.ok(/From the collection of The Metropolitan Museum of Art, New York · Bequest of A Test, 1913/.test(h2) && /Workshop of Rogier van der Weyden, A Workshop Panel/.test(h2), 'the Met’s line and the qualifier in the credit');
  // A maker's own work keeps its own data.
  const f3 = path.join(dir, 'mine.jpg'); fs.writeFileSync(f3, await sharp(pic).flop().jpeg().toBuffer());
  const own = await app.locals.registerWork({ file: f3, title: 'My Own Street', originalName: 'mine.jpg' }); db.prepare("UPDATE works SET status='held' WHERE id=?").run(own.id);
  const mine = db.prepare('SELECT slug FROM works WHERE id=?').get(own.id);
  { const h3 = await (await fetch(`${base}/w/${mine.slug}`)).text(); const l3 = JSON.parse((h3.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1]); assert.ok(l3.copyrightNotice && l3.acquireLicensePage, 'a maker’s work is unchanged'); }
  srv.close(); fs.rmSync(dir, { recursive: true, force: true }); console.log('the sources: holds'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
