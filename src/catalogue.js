'use strict';
// The catalogue (Will, 2 Nov: "the single greatest art history resource of all time"; "imagine seeing whole bodies
// of artist work chronologically documented"; "can we get every work of Van Gogh loaded in"; "can we get da Vinci").
// Wikidata is the index: every work it knows by the artist (creator, P170), with its date, kind, medium, size, the
// collection that keeps it and its number there, and, when one exists, the photograph on Wikimedia Commons (P18).
// The house reads it into `catalogue`, one row a work, and the artist's page then shows the whole life's work in
// the order it was made: the works the house holds as pictures, the rest named in their place (where the original
// is; 'no open photograph' when there is none), so the gaps are honest. 'Bring in the pictures' queues every open
// photograph as a feed through the one door (the bag check, the deed, the register), for an artist in the public
// domain only; a living artist's work is listed, never copied.
const UA = 'Watermark (watermark.krafftco.com; house@watermark.krafftco.com)';
const SPARQL = process.env.WIKIDATA_SPARQL || 'https://query.wikidata.org/sparql';
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const qidOf = s => (String(s || '').match(/\bQ\d+\b/) || [])[0] || null;
const KIND = t => { t = String(t || '').toLowerCase(); return /painting|portrait|landscape|still life|triptych|altarpiece|fresco|mural/.test(t) ? 'painting' : /drawing|sketch|cartoon|study/.test(t) ? 'drawing' : /print|etching|lithograph|woodcut|engraving/.test(t) ? 'print' : /sculpture|statue|bust|relief/.test(t) ? 'sculpture' : /codex|notebook|manuscript|letter/.test(t) ? 'drawing' : /textile|tapestry/.test(t) ? 'textile' : t ? 'other' : null; };

function mountCatalogue(app, { db, V, C, ledger, studioOnly }) {
  const { esc } = V;
  const doFetch = (u, o) => (app.locals.iiif && app.locals.iiif.doFetch ? app.locals.iiif.doFetch(u, o) : fetch(u, o));
  db.exec(`CREATE TABLE IF NOT EXISTS catalogue (id INTEGER PRIMARY KEY, artist_id INTEGER NOT NULL, qid TEXT NOT NULL, title TEXT NOT NULL, year INTEGER, year_end INTEGER, kind TEXT, type TEXT, medium TEXT,
    collection TEXT, inventory TEXT, place TEXT, image TEXT, size TEXT, wiki TEXT, read_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (artist_id, qid));
    CREATE INDEX IF NOT EXISTS catalogue_artist ON catalogue(artist_id, year)`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('artists') WHERE name='qid'").get()) db.exec('ALTER TABLE artists ADD COLUMN qid TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('artists') WHERE name='catalogue_at'").get()) db.exec('ALTER TABLE artists ADD COLUMN catalogue_at TEXT');
  const A = () => app.locals.art;
  const ukey = u => { try { return decodeURIComponent(String(u || '')).replace(/ /g, '_'); } catch (e) { return String(u || ''); } };
  const commonsId = file => file ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(('File:' + String(file).replace(/^File:/, '')).replace(/ /g, '_'))}` : null;
  const filePath = (file, w) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(file).replace(/^File:/, '').replace(/ /g, '_'))}${w ? `?width=${w}` : ''}`;
  async function sparql(q) {
    const r = await doFetch(`${SPARQL}?format=json&query=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA, accept: 'application/sparql-results+json' } });
    if (!r.ok) throw new Error(`wikidata ${r.status}`); const j = await r.json(); return (j.results && j.results.bindings) || [];
  }
  // The artist's Wikidata item: the one set by hand, else a person with this English name who made art, the best known first.
  async function findQid(a) {
    if (a.qid) return a.qid;
    const name = String(a.name).replace(/"/g, '');
    const rows = await sparql(`SELECT ?p ?born (COUNT(?w) AS ?n) WHERE { ?p wdt:P31 wd:Q5; rdfs:label "${name}"@en. OPTIONAL { ?p wdt:P569 ?born } OPTIONAL { ?w wdt:P170 ?p } } GROUP BY ?p ?born ORDER BY DESC(?n) LIMIT 5`);
    const pick = rows.find(r => !a.born || !r.born || +String(r.born.value).slice(0, 4) === +a.born || +String(r.born.value).slice(0, 4) === +a.born - 1) || rows[0];
    return pick ? qidOf(pick.p.value) : null;
  }
  // Every work Wikidata knows by the artist, a row each (several values for one work are folded into the first).
  async function read(a, { qid } = {}) {
    qid = qidOf(qid) || await findQid(a); if (!qid) throw new Error(`no Wikidata item for ${a.name}`);
    const rows = await sparql(`SELECT ?w ?wLabel ?date ?end ?image ?collLabel ?inv ?medLabel ?typeLabel ?locLabel ?h ?wd ?article WHERE {
  ?w wdt:P170 wd:${qid} .
  OPTIONAL { ?w wdt:P571 ?date } OPTIONAL { ?w wdt:P582 ?end } OPTIONAL { ?w wdt:P18 ?image } OPTIONAL { ?w wdt:P195 ?coll } OPTIONAL { ?w wdt:P217 ?inv }
  OPTIONAL { ?w wdt:P186 ?med } OPTIONAL { ?w wdt:P31 ?type } OPTIONAL { ?w wdt:P1071 ?loc } OPTIONAL { ?w wdt:P2048 ?h } OPTIONAL { ?w wdt:P2049 ?wd }
  OPTIONAL { ?article schema:about ?w; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr,de,it,nl,es". } } LIMIT 20000`);
    const by = new Map();
    for (const r of rows) {
      const q = qidOf(r.w.value); if (!q) continue; const v = k => r[k] ? String(r[k].value) : null;
      const title = v('wLabel'); if (!title || /^Q\d+$/.test(title)) continue;
      let o = by.get(q); if (!o) { o = { qid: q, title, year: null, year_end: null, image: null, collection: null, inventory: null, medium: null, type: null, place: null, size: null, wiki: null }; by.set(q, o); }
      const y = s => { const m = String(s || '').match(/^(-?\d{1,4})-/); return m ? +m[1] : null; };
      if (o.year == null && v('date')) o.year = y(v('date'));
      if (o.year_end == null && v('end')) o.year_end = y(v('end'));
      if (!o.image && v('image')) o.image = decodeURIComponent(v('image').replace(/^.*Special:FilePath\//, '')).replace(/_/g, ' ');
      if (!o.collection && v('collLabel') && !/^Q\d+$/.test(v('collLabel'))) o.collection = v('collLabel');
      if (!o.inventory && v('inv')) o.inventory = v('inv');
      if (!o.medium && v('medLabel') && !/^Q\d+$/.test(v('medLabel'))) o.medium = v('medLabel');
      if (!o.type && v('typeLabel') && !/^Q\d+$/.test(v('typeLabel'))) o.type = v('typeLabel');
      if (!o.place && v('locLabel') && !/^Q\d+$/.test(v('locLabel'))) o.place = v('locLabel');
      if (!o.size && v('h') && v('wd')) o.size = `${(+v('h')).toFixed(1).replace(/\.0$/, '')} × ${(+v('wd')).toFixed(1).replace(/\.0$/, '')} cm`;
      if (!o.wiki && v('article')) o.wiki = v('article');
    }
    const items = [...by.values()].filter(o => !/^(exhibition|written work|literary work|letter|book|edition)$/i.test(o.type || ''));
    const up = db.prepare(`INSERT INTO catalogue (artist_id, qid, title, year, year_end, kind, type, medium, collection, inventory, place, image, size, wiki) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (artist_id, qid) DO UPDATE SET title=excluded.title, year=excluded.year, year_end=excluded.year_end, kind=excluded.kind, type=excluded.type, medium=excluded.medium, collection=excluded.collection, inventory=excluded.inventory, place=excluded.place, image=excluded.image, size=excluded.size, wiki=excluded.wiki, read_at=datetime('now')`);
    db.transaction(() => { for (const o of items) up.run(a.id, o.qid, o.title.slice(0, 300), o.year, o.year_end, KIND(o.type), o.type, o.medium, o.collection, o.inventory, o.place, o.image, o.size, o.wiki); })();
    db.prepare("UPDATE artists SET qid=?, catalogue_at=datetime('now') WHERE id=?").run(qid, a.id);
    try { A().uncache(a.slug); } catch (e) { /* */ }
    try { ledger.append(db, 'artist.catalogued', a.slug, { qid, n: items.length, pictures: items.filter(o => o.image).length }); } catch (e) { /* */ }
    return { qid, n: items.length, pictures: items.filter(o => o.image).length };
  }
  // The rows, each matched to a held work when the house has it (by the photograph's own address, else the title).
  function of(a, held = []) {
    const rows = db.prepare('SELECT * FROM catalogue WHERE artist_id=? ORDER BY COALESCE(year, 99999), title').all(a.id);
    const bySrc = new Map(held.filter(w => w.source_url).map(w => [ukey(w.source_url), w])); const byTitle = new Map(); held.forEach(w => { const k = norm(w.title); if (k && !byTitle.has(k)) byTitle.set(k, w); });
    const used = new Set();
    return rows.map(r => { let w = r.image ? bySrc.get(ukey(commonsId(r.image))) : null; if (!w) { const t = byTitle.get(norm(r.title)); if (t && !used.has(t.id)) w = t; } if (w) used.add(w.id); return { ...r, work: w || null }; });
  }
  const count = a => db.prepare('SELECT COUNT(*) n, SUM(CASE WHEN image IS NOT NULL THEN 1 ELSE 0 END) p FROM catalogue WHERE artist_id=?').get(a.id);
  // Bring in every open photograph the catalogue names that the house does not hold: one feed, through the one door.
  function bring(a, { max = 2000 } = {}) {
    const F = app.locals.feeds; if (!F) throw new Error('feeds are not on');
    const r = A().rights(a); if (r.state !== 'pd') throw new Error(`${a.name}'s work is not in the public domain: the catalogue lists it, the house does not copy it`);
    const shelf = db.prepare("SELECT * FROM makers WHERE handle='the-public-domain'").get(); if (!shelf) throw new Error('the public domain shelf is not set up (open the hall once)');
    if (!a.qid) throw new Error('read the catalogue first');
    const live = db.prepare("SELECT id FROM feeds WHERE kind='catalogue' AND url=? AND status IN ('queued','running')").get(`https://www.wikidata.org/wiki/${a.qid}`); if (live) return live.id;
    return F.enqueue({ maker: shelf.id, kind: 'catalogue', url: `https://www.wikidata.org/wiki/${a.qid}`, name: `${a.name}: the catalogue`, open: 'pd', show: '1', max: String(max), artist: a.name });
  }
  // The feed's reader asks for the items: every catalogued work with a photograph the house does not yet hold.
  function items(qid, { cursor = 0, limit = 2000 } = {}) {
    const a = db.prepare('SELECT * FROM artists WHERE qid=?').get(qid); if (!a) return [];
    const held = new Set(db.prepare("SELECT source_url FROM works WHERE source_url LIKE 'https://commons.wikimedia.org/%'").all().map(w => ukey(w.source_url)));
    return db.prepare('SELECT * FROM catalogue WHERE artist_id=? AND image IS NOT NULL ORDER BY COALESCE(year, 99999), id').all(a.id).filter(r => !held.has(ukey(commonsId(r.image)))).slice(cursor, cursor + limit).map(r => ({
      id: commonsId(r.image), label: r.title, image: filePath(r.image, 3840), name: r.image, kind: r.kind || 'painting', artist: { name: a.name, born: a.born, died: a.died },
      date: r.year ? String(r.year) : null, summary: null,
      meta: [r.year ? { label: 'Date', value: r.year_end && r.year_end !== r.year ? `${r.year}–${r.year_end}` : String(r.year) } : null, r.medium ? { label: 'Medium', value: r.medium } : null, r.size ? { label: 'Dimensions', value: r.size } : null, r.collection ? { label: 'Collection', value: r.collection } : null, r.inventory ? { label: 'Accession', value: r.inventory } : null, r.place ? { label: 'Place', value: r.place } : null, { label: 'Wikidata', value: `https://www.wikidata.org/wiki/${r.qid}` }].filter(Boolean),
      rights: 'https://creativecommons.org/publicdomain/mark/1.0/' }));
  }
  // The Studio's hand, on the artist's own desk.
  function desk(a) {
    const c = count(a);
    return `<form method="post" action="/studio/art/${esc(a.slug)}/catalogue" class="ax-edit"><h2>The catalogue</h2><p class="note">Every work Wikidata knows by ${esc(a.name)}, in the order it was made, with where each is kept. ${a.catalogue_at ? `Read ${esc(V.date(a.catalogue_at))}: ${c.n || 0} works, ${c.p || 0} with an open photograph.` : 'Not read yet.'}</p>
<label><span>Wikidata item</span><input name="qid" value="${esc(a.qid || '')}" placeholder="Found by name if left empty, e.g. Q5582"></label><p><button class="buy-btn" name="do" value="read">Read the catalogue</button>${a.catalogue_at && c.p ? ` <button class="buy-btn" name="do" value="bring">Bring in the pictures</button> <span class="note">Public domain only; one at a time, through the bag check.</span>` : ''}</p></form>`;
  }
  app.post('/studio/art/:slug/catalogue', studioOnly, async (req, res) => {
    const a = A().bySlug(req.params.slug); if (!a) return res.sendStatus(404); const x = req.body || {};
    try {
      if (x.qid && qidOf(x.qid) !== a.qid) db.prepare('UPDATE artists SET qid=? WHERE id=?').run(qidOf(x.qid), a.id);
      const fresh = A().bySlug(a.slug);
      if (x.do === 'bring') { const id = bring(fresh); if (x.json) return res.json({ ok: true, feed: id }); return res.redirect(`/studio/feeds/${id}?ok=` + encodeURIComponent(`${a.name}: every open photograph in the catalogue is coming in.`)); }
      const r = await read(fresh, { qid: x.qid });
      if (x.json) return res.json({ ok: true, ...r });
      res.redirect(`/studio/art/${a.slug}?ok=` + encodeURIComponent(`The catalogue: ${r.n} works by ${a.name}, ${r.pictures} with an open photograph.`));
    } catch (e) { if (x.json) return res.status(400).json({ ok: false, error: e.message }); res.redirect(`/studio/art/${a.slug}?ok=` + encodeURIComponent(e.message)); }
  });
  app.locals.catalogue = { read, of, count, bring, items, desk, findQid, commonsId };
  return app.locals.catalogue;
}
module.exports = { mountCatalogue, KIND, qidOf };
