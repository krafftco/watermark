// MoMA, the record (5 Nov): the CC0 collection data read as it streams, MoMA's artists into the hall (matched or made),
// every work into its artist's catalogue and the registry, the credit line as provenance, no picture taken.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { createApp } = require('../src/app');
const { csvStream, howOf } = require('../src/moma');
(async () => {
  // the reader: commas, quotes and new lines inside fields
  { const { Readable } = require('stream'); const got = []; await csvStream(Readable.from(['a,"b, ""c""\n', 'd",e\r\n1,', '2,3\n']), rows => { got.push(...rows); });
    assert.deepEqual(got, [['a', 'b, "c"\nd', 'e'], ['1', '2', '3']], 'the CSV reader: ' + JSON.stringify(got)); }
  assert.equal(howOf('Gift of Mrs. John D. Rockefeller'), 'gift'); assert.equal(howOf('Acquired through the Lillie P. Bliss Bequest'), 'bequest'); assert.equal(howOf('Purchase'), 'purchase');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-moma-')), src = path.join(dir, 'src'); fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'Artists.json'), JSON.stringify([
    { ConstituentID: 4675, DisplayName: 'Jackson Pollock', ArtistBio: 'American, 1912–1956', Nationality: 'American', Gender: 'male', BeginDate: 1912, EndDate: 1956, 'Wiki QID': 'Q37571', ULAN: '500025939' },
    { ConstituentID: 4609, DisplayName: 'Pablo Picasso', ArtistBio: 'Spanish, 1881–1973', Nationality: 'Spanish', Gender: 'male', BeginDate: 1881, EndDate: 1973, 'Wiki QID': 'Q5593', ULAN: '500009666' },
    { ConstituentID: 9, DisplayName: 'A. Few', ArtistBio: null, Nationality: null, Gender: null, BeginDate: 0, EndDate: 0, 'Wiki QID': null, ULAN: null },
    { ConstituentID: 10, DisplayName: 'Unidentified photographer', BeginDate: 0, EndDate: 0, 'Wiki QID': 'Q4233718', ULAN: null }]));
  const H = 'Title,Artist,ConstituentID,ArtistBio,Nationality,BeginDate,EndDate,Gender,Date,Medium,Dimensions,CreditLine,AccessionNumber,Classification,Department,DateAcquired,Cataloged,ObjectID,URL,ImageURL,OnView,Circumference (cm),Depth (cm),Diameter (cm),Height (cm),Length (cm),Weight (kg),Width (cm),Seat Height (cm),Duration (sec.)';
  const row = (title, artist, cid, date, medium, dims, credit, acc, cls, acq, oid, onv, h, w) => [title, artist, cid, '', '', '', '', '', date, medium, dims, credit, acc, cls, 'Painting & Sculpture', acq, 'Y', oid, `https://www.moma.org/collection/works/${oid}`, 'https://www.moma.org/media/x.jpg', onv, '', '', '', h, '', '', w, '', '']
    .map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',');
  fs.writeFileSync(path.join(src, 'Artworks.csv'), '﻿' + [H,
    row('One: Number 31, 1950', 'Jackson Pollock', '4675', '1950', 'Oil and enamel paint on canvas', '8\' 10" x 17\' 5 5/8" (269.5 x 530.8 cm)', 'Sidney and Harriet Janis Collection Fund (by exchange)', '7.1968', 'Painting', '1968-01-01', '78386', 'MoMA, Floor 4, 403', '269.5', '530.8'),
    row('Les Demoiselles d\'Avignon', 'Pablo Picasso', '4609', 'Paris, June-July 1907', 'Oil on canvas', '8\' x 7\' 8" (243.9 x 233.7 cm)', 'Acquired through the Lillie P. Bliss Bequest', '333.1939', 'Painting', '1939-01-01', '79766', '', '243.9', '233.7'),
    row('Joint Piece', 'Jackson Pollock, Pablo Picasso', '4675, 4609', '1940', 'Ink', '10 x 10 cm', 'Gift of a friend', '1.2000', 'Drawing', '2000-05-05', '1', '', '10', '10'),
    row('A Small Thing', 'A. Few', '9', '1999', 'Pencil', 'Line one\nline two', 'Purchase', '2.2001', 'Drawing', '2001-01-01', '2', '', '', ''),
    row('A Street', 'Unidentified photographer', '10', '1920', 'Gelatin silver print', '', 'Gift', '3.2001', 'Photograph', '', '3', '', '', '')].join('\n') + '\n');

  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'moma', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const studio = {}; await go(studio, '/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  // the hall already knows Pollock under the other way round: matched, never doubled
  const pol = app.locals.art.ensure('Pollock, Jackson'); assert.ok(pol);
  app.locals.moma.base = src;
  const j = await app.locals.moma.sync(); assert.ok(!j.error, j.error);
  const M = app.locals.moma.counts(); assert.ok(M.works === 5 && M.artists === 4, 'every record kept: ' + JSON.stringify(M));
  const ma = db.prepare('SELECT * FROM artists WHERE id=?').get(pol.id); assert.ok(ma.qid === 'Q37571' && ma.ulan === '500025939' && ma.born === 1912 && ma.died === 1956 && ma.moma_id === 4675, 'the known artist takes MoMA’s identifiers and dates');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM artists WHERE name LIKE '%Pollock%'").get().n, 1, 'one Pollock');
  const pic = db.prepare("SELECT * FROM artists WHERE name='Pablo Picasso'").get(); assert.ok(pic && pic.qid === 'Q5593', 'Picasso made, with a Wikidata identifier');
  assert.ok(!db.prepare("SELECT 1 FROM artists WHERE name='A. Few'").get(), 'one work and no identifier: kept in the record, not made an artist');
  assert.ok(!db.prepare("SELECT 1 FROM artists WHERE name LIKE 'Unidentified%'").get(), 'no artist named Unidentified');
  const cat = db.prepare("SELECT * FROM catalogue WHERE qid='moma:78386'").get(); assert.ok(cat && cat.artist_id === pol.id && cat.collection_qid === 'Q188740' && cat.on_view === 'MoMA, Floor 4, 403' && cat.kind === 'painting', 'in the catalogue: ' + JSON.stringify(cat));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM catalogue WHERE qid='moma:1'").get().n, 2, 'a joint work under both artists');
  // the registry: one record a work, the measured size, the credit line as provenance's last line, on one register entry a batch
  const o = db.prepare("SELECT o.* FROM objects o JOIN catalogue c ON c.id=o.catalogue_id WHERE c.qid='moma:78386'").get();
  assert.ok(o && o.holder === 'The Museum of Modern Art, New York' && o.accession === '7.1968' && o.classification === 'Painting' && JSON.parse(o.cm).w === 530.8 && JSON.parse(o.ids).artist_ulan === '500025939' && o.public === 1, 'the registry record: ' + JSON.stringify(o));
  const ev = db.prepare("SELECT * FROM object_events WHERE object_id=? AND kind='acquired'").get(o.id); assert.ok(ev && ev.how === 'exchange' && ev.on_date === '1968-01-01' && ev.seq && /Janis/.test(ev.body), 'acquired by exchange, on the register');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM objects WHERE record_kind='collection' AND status<>'merged' AND holder LIKE 'The Museum of Modern Art%'").get().n, 3, 'a record for each work whose artist the hall keeps, the joint work once');
  assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='registry.batch'").get() && !db.prepare("SELECT 1 FROM ledger WHERE type='object.recorded'").get(), 'one register entry a batch, not one a record');
  // the pages: the record, the artist's known works, the hall's room unchanged, a page for an artist with no picture
  let r = await go({}, '/registry/known/moma/78386'); assert.equal(r.status, 302); const rec = await (await go({}, r.headers.get('location'))).text();
  assert.ok(rec.includes('In the collection of') && rec.includes('Sidney and Harriet Janis') && rec.includes('On view now: MoMA, Floor 4, 403') && rec.includes('id="wall"') && !rec.includes('moma.org/media'), 'the lot page from MoMA’s record, the wall to scale, no MoMA picture');
  const pg = await (await go({}, `/art/${pic.slug}`)).text(); assert.ok(pg.includes('Les Demoiselles') && pg.includes('At MoMA') && !pg.includes('moma.org/media'), 'Picasso’s page lists the work known at MoMA');
  const pp = await (await go({}, `/art/${ma.slug}`)).text(); assert.ok(pp.includes('On view now: MoMA, Floor 4, 403'), 'on view now, said on the artist page');
  assert.equal((await go({}, '/studio/moma')).status, 302, 'a stranger is sent away from the desk');
  assert.ok((await (await go(studio, '/studio/moma')).text()).includes('MoMA, the record.'), 'the desk');
  // a second read changes nothing it should not
  await app.locals.moma.sync(); assert.equal(db.prepare("SELECT COUNT(*) n FROM objects WHERE holder LIKE 'The Museum of Modern Art%' AND status<>'merged'").get().n, 3, 'read again: no record twice');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM catalogue WHERE qid LIKE 'moma:%'").get().n, 4, 'nor a catalogue line twice');
  srv.close(); console.log('moma: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
