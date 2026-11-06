// The National Gallery of Art (6 Nov): the open CSVs read into an index, a slice through the feeds' door, the workshop
// piece never linked as the master's; and whose hand: the copy, the workshop piece and the extra file off a master's wall.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-nga-')); const data = path.join(dir, 'ngadata'); fs.mkdirSync(data);
  const fx = path.join(__dirname, 'fixture.jpg'); const pic = await sharp(fx).resize(1600).jpeg().toBuffer(); const asked = [];
  const fetchImpl = async u => { asked.push(String(u)); if (/api\.nga\.gov\/iiif/.test(u)) return new Response(/iiif\/b\//.test(u) ? await sharp(pic).flop().jpeg().toBuffer() : pic, { status: 200, headers: { 'content-type': 'image/jpeg' } }); return new Response('no', { status: 404 }); };
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'nga', noTimers: true, vaultNow: true, fetchImpl });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; } return r; });
  const form = (p, b) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  await form('/studio/login', { password: 'pw' });

  // The Gallery's four files, small: a painting by Vermeer, a workshop piece, a capped image, a print, a closed image.
  const csv = rows => rows.map(r => r.map(x => /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x).join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(data, 'objects.csv'), csv([['objectid', 'accessionnum', 'title', 'displaydate', 'beginyear', 'medium', 'dimensions', 'attribution', 'creditline', 'classification', 'isvirtual', 'wikidataid'],
    [1, '1942.9.97', 'A Lady Writing', 'c. 1665', 1665, 'oil on canvas', 'overall: 45 x 39.9 cm', 'Johannes Vermeer', 'Gift of Harry Waldron Havemeyer', 'Painting', 0, 'Q3207'],
    [2, '1952.5.1', 'Madonna and Child', 'c. 1500', 1500, 'oil on panel', '60 x 45 cm', 'Workshop of Leonardo da Vinci', 'Samuel H. Kress Collection', 'Painting', 0, ''],
    [3, '1937.1.1', 'Capped', '1600', 1600, 'oil', '', 'Someone', '', 'Painting', 0, ''],
    [4, '1943.3.1', 'A Print', '1520', 1520, 'engraving', '', 'Albrecht Dürer', '', 'Print', 0, ''],
    [5, '1999.1.1', 'Closed', '1990', 1990, 'oil', '', 'A Living Painter', '', 'Painting', 0, '']]));
  fs.writeFileSync(path.join(data, 'published_images.csv'), csv([['uuid', 'iiifurl', 'viewtype', 'width', 'height', 'maxpixels', 'openaccess', 'depictstmsobjectid'],
    ['a', 'https://api.nga.gov/iiif/a', 'primary', 9000, 10000, '', 1, 1], ['b', 'https://api.nga.gov/iiif/b', 'primary', 3000, 4000, '', 1, 2], ['c', 'https://api.nga.gov/iiif/c', 'primary', 3000, 4000, 640, 1, 3],
    ['d', 'https://api.nga.gov/iiif/d', 'primary', 3000, 4000, '', 1, 4], ['e', 'https://api.nga.gov/iiif/e', 'primary', 3000, 4000, '', 0, 5]]));
  fs.writeFileSync(path.join(data, 'objects_constituents.csv'), csv([['objectid', 'constituentid', 'displayorder', 'roletype', 'prefix'], [1, 10, 1, 'artist', ''], [1, 99, 1, 'owner', ''], [2, 11, 1, 'artist', 'Workshop of'], [4, 12, 1, 'artist', '']]));
  fs.writeFileSync(path.join(data, 'constituents.csv'), csv([['constituentid', 'preferreddisplayname', 'forwarddisplayname', 'beginyear', 'endyear', 'nationality', 'wikidataid'], [10, 'Vermeer, Johannes', 'Johannes Vermeer', 1632, 1675, 'Dutch', 'Q41264'], [11, 'Leonardo da Vinci', 'Leonardo da Vinci', 1452, 1519, 'Italian', 'Q762'], [12, 'Dürer, Albrecht', 'Albrecht Dürer', 1471, 1528, 'German', '']]));
  const N = app.locals.nga; N.base = data;
  const c = await N.counts(); assert.deepEqual(c, { Painting: 2, Print: 1 }, 'only open, uncapped primary images: ' + JSON.stringify(c));
  const sl = await N.items({ cls: 'Painting' }); assert.equal(sl.total, 2);
  const ver = sl.items.find(i => i.label === 'A Lady Writing'), shop = sl.items.find(i => i.label === 'Madonna and Child');
  assert.ok(/\/full\/!6000,6000\/0\/default\.jpg$/.test(ver.image), 'a large master asked for at 6000 a side: ' + ver.image);
  assert.ok(/\/full\/max\/0\/default\.jpg$/.test(shop.image), 'a smaller one at its own size');
  assert.ok(ver.artist && ver.artist.name === 'Johannes Vermeer' && ver.artist.died === 1675 && ver.rights === 'cc0' && ver.kind === 'painting' && /art-object-page\.1\.html$/.test(ver.id), 'the painting, its artist and its rights');
  assert.ok(!shop.artist && shop.hand && shop.meta.some(m => m.label === 'Attribution' && /Workshop of/.test(m.value)), 'a workshop piece is never the master’s');
  assert.ok(ver.meta.some(m => m.label === 'Courtesy' && /National Gallery of Art/.test(m.value)), 'credited');
  assert.equal(app.locals.feeds.kindOf({ url: N.urlFor({ cls: 'Painting' }) }), 'nga', 'the feeds know the Gallery');

  // Through the line: one slice, the feed run, the works on the shelf.
  const shelf = app.locals.art.shelf();
  let r = await form('/studio/line/nga', { cls: 'Painting', n: '10' }); assert.equal(r.status, 302);
  let t = await (await go('/studio/line')).text(); assert.ok(/The National Gallery of Art · Paintings · 1–10/.test(t) && /All of it, paintings first/.test(t), 'in line: ' + (t.match(/bl-r[^<]*<div><b>([^<]*)/) || [])[1]);
  await app.locals.line.tick(); const feedId = db.prepare("SELECT feed_id FROM lineup WHERE kind='nga'").get().feed_id; assert.ok(feedId, 'the line started a feed');
  await app.locals.feeds.run(db.prepare('SELECT * FROM feeds WHERE id=?').get(feedId));
  const f = db.prepare('SELECT * FROM feeds WHERE id=?').get(feedId); assert.equal(f.status, 'done', f.note); assert.equal(f.taken, 2, 'two came in: ' + JSON.stringify(f));
  const vw = db.prepare("SELECT * FROM works WHERE source_url LIKE '%art-object-page.1.html'").get(); const vermeer = db.prepare("SELECT * FROM artists WHERE name='Johannes Vermeer'").get();
  assert.ok(vw.maker_id === shelf.id && vw.status === 'held' && vw.open === 'cc0' && vw.artist_id === vermeer.id && vw.taken_at.startsWith('1665'), 'Vermeer on the shelf, linked, open, dated');
  { const j = await (await go(`/api/v1/works/${vw.slug}`)).json(); assert.equal(j.byline, 'Painting by Johannes Vermeer', 'the API names the artist, not the shelf'); }
  const sw = db.prepare("SELECT * FROM works WHERE source_url LIKE '%art-object-page.2.html'").get(); assert.ok(!sw.artist_id && sw.hand === 'not' && /Workshop/.test(sw.hand_why), 'the workshop piece not on Leonardo’s page: ' + JSON.stringify({ a: sw.artist_id, h: sw.hand }));
  await app.locals.line.tick(); assert.equal(db.prepare("SELECT status FROM lineup WHERE kind='nga'").get().status, 'done', 'the line closes the slice');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM lineup WHERE kind='nga'").get().n, 1, 'a short slice ends the classification: nothing more lined up');
  { // a full slice lines up the next in its own place, ahead of what was waiting behind it
    const L = app.locals.line; const a1 = L.addNga({ cls: 'Print', n: 10, more: 1 }); L.addNga({ cls: 'Sculpture', n: 10 }); db.prepare("UPDATE lineup SET status='running' WHERE id=?").run(a1);
    const fid = db.prepare("INSERT INTO feeds (name, kind, url, maker_id, status, looked) VALUES ('t','nga','https://www.nga.gov/open-access-images',?, 'done', 10)").run(shelf.id).lastInsertRowid; db.prepare('UPDATE lineup SET feed_id=? WHERE id=?').run(fid, a1);
    await L.tick(); const nx = db.prepare("SELECT label FROM lineup WHERE status='waiting' ORDER BY pos, id LIMIT 1").get(); assert.ok(/Prints · 11–20/.test(nx.label), 'the next slice of prints before the sculpture: ' + nx.label);
    db.prepare("DELETE FROM lineup WHERE kind='nga' AND status='waiting'").run();
  }
  r = await form('/studio/line/nga/all', {}); assert.equal(db.prepare("SELECT COUNT(*) n FROM lineup WHERE kind='nga' AND status='waiting'").get().n, N.CLASSES.length, 'all of it, a line for each classification');

  // Whose hand: Leonardo's catalogue, two catalogued versions of one subject, a third not in the catalogue, a workshop piece by its words, another file of a catalogued work, a different picture.
  const L = app.locals.art.ensure('Leonardo da Vinci', { born: 1452, died: 1519 }); db.prepare("UPDATE artists SET catalogue_at=datetime('now') WHERE id=?").run(L.id);
  let k = 0; const put = async (buf, title, file, caption) => { const p = path.join(dir, `h-${++k}.jpg`); fs.writeFileSync(p, buf); const w = await app.locals.registerWork({ file: p, title, makerId: shelf.id, kind: 'painting', artist: L.name, originalName: `h${k}.jpg`, caption: caption || null, source_url: file ? `https://commons.wikimedia.org/wiki/File:${file.replace(/ /g, '_')}` : null }); db.prepare("UPDATE works SET status='held', open='pd', artist_id=? WHERE slug=?").run(L.id, w.slug); return w.slug; };
  const cat = (qid, title, file, coll) => db.prepare('INSERT INTO catalogue (artist_id, qid, title, image, collection) VALUES (?,?,?,?,?)').run(L.id, qid, title, file, coll);
  cat('Q1', 'Madonna of the Yarnwinder (Buccleuch)', 'Buccleuch Madonna.jpg', 'Scottish National Gallery'); cat('Q2', 'Madonna of the Yarnwinder (Lansdowne)', 'Lansdowne Madonna.jpg', 'Private collection');
  const base1 = await sharp(fx).resize(1600).jpeg({ quality: 95 }).toBuffer();
  const buc = await put(base1, 'Madonna of the Yarnwinder', 'Buccleuch Madonna.jpg');
  const lan = await put(await sharp(fx).resize(1500).flop().jpeg({ quality: 95 }).toBuffer(), 'Madonna of the Yarnwinder', 'Lansdowne Madonna.jpg');
  const third = await put(await sharp(fx).resize(1400).blur(3).modulate({ saturation: 0.6, hue: 25 }).linear(1.2, -20).jpeg().toBuffer(), 'Madonna of the Yarnwinder', 'Yarnwinder copy 1600s.jpg');
  const extra = await put(await sharp(fx).resize(900).jpeg({ quality: 80 }).toBuffer(), 'The Buccleuch Madonna', 'Buccleuch Madonna.jpg');
  const shopL = await put(await sharp(fx).resize(1200).rotate(90).jpeg().toBuffer(), 'Saint John', 'Saint John workshop.jpg', 'Artist: Workshop of Leonardo da Vinci · Date: 1510');
  const attr = await put(await sharp(fx).resize(1200).rotate(180).jpeg().toBuffer(), 'La Belle Princesse', 'Belle Princesse.jpg', 'Artist: Attributed to Leonardo da Vinci');
  const other = await put(await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 30, g: 80, b: 140 } } }).composite([{ input: Buffer.from('<svg width="1200" height="900"><circle cx="300" cy="300" r="200" fill="#e6c875"/><rect x="700" y="500" width="300" height="250" fill="#5e0b14"/></svg>'), top: 0, left: 0 }]).jpeg().toBuffer(), 'A study of unknown date', 'Study.jpg');
  const p = await app.locals.hands.plan(L);
  const on = (list, s) => p[list].some(x => x.slug === s);
  assert.ok(on('kept', buc) && on('kept', lan), 'both catalogued versions stand: ' + JSON.stringify(p.kept.map(x => x.slug)));
  assert.ok(p.kept.find(x => x.slug === buc).keeper === 'Scottish National Gallery', 'named by its keeper');
  assert.ok(on('repeats', extra), 'the second file of the Buccleuch is an extra file');
  assert.ok(on('versions', third) || on('repeats', third), 'the third Yarnwinder, not in the catalogue, goes: ' + JSON.stringify({ v: p.versions, u: p.unknown.map(x => x.slug) }));
  assert.ok(on('not', shopL), 'workshop of Leonardo, by the record’s words');
  assert.ok(on('attributed', attr), 'attributed: it stands, marked');
  assert.ok(on('unknown', other), 'a different picture, not catalogued: a person looks; the house does not take it down');
  t = await (await go(`/studio/art/${L.slug}/hands`)).text(); assert.ok(/Whose hand/.test(t) && /Someone else’s hand/.test(t) && /Take \d+ off/.test(t), 'the desk');
  t = await (await go('/studio/art')).text(); assert.ok(/not theirs/.test(t) && /look at every master/.test(t), 'the art desk shows who has a plan');
  const res = await (await form(`/studio/art/${L.slug}/hands/apply`, { json: '1' })).json(); assert.ok(res.ok && res.n >= 3, 'taken off: ' + res.n);
  const st = s => db.prepare('SELECT status, hand, tidy FROM works WHERE slug=?').get(s);
  for (const s of [third, extra, shopL]) assert.equal(st(s).status, 'hidden', s + ' off the wall');
  for (const s of [buc, lan, attr, other]) assert.equal(st(s).status, 'held', s + ' stands');
  assert.equal(st(buc).hand, 'catalogued'); assert.equal(st(shopL).hand, 'not'); assert.equal(st(attr).hand, 'attributed');
  // The tidy's Put them all back undoes it too.
  const back = app.locals.tidy.undo(L); assert.ok(back >= 3 && st(third).status === 'held', 'put back');
  srv.close(); console.log('ok: the National Gallery of Art, and whose hand'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
