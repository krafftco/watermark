// Feeds in (Will, 27 Oct: "how is this getting us ready for the Met and all of the other people? when they give us more
// resources, more material, more stuff, we can show it; we're training for ingest of all sorts of different media to
// show it beautifully and pass it into our system"). The bulk door: any institution's whole feed taken in as one
// background job, resumable, with a desk that shows progress and names every miss, the way the canon run does for books.
// A feed is read into items of one shape ({ id, label, summary, image, meta [{label, value}], artist?, kind? }: the IIIF
// importer's shape) and each item goes through the same door as a manifest's canvas (`iiif.take`: the picture fetched,
// the bag check, registerWork as the maker's, the licence and the year), so nothing is taken in by a second road.
// Readers: a CSV (by address or a file: title, image, source, place, date, medium, description, artist, kind, credit);
// OAI-PMH Dublin Core (ListRecords with resumptionToken paging; the first identifier that is a picture, else a IIIF
// image service); a IIIF Collection (its manifests walked, each through parseManifest); a IIIF manifest or the Met's
// API (the importer's own readers); a list of books (Gutenberg numbers or 'Title, Author' lines → the reading room).
// `feeds` keeps every run (status queued | running | done | failed | stopped; looked, taken, skipped, failed; the misses
// with why, up to 500, so 'Retry the misses' needs no second listing; the cursor, so a run cut by a restart resumes).
// Studio → Back office → Feeds in (/studio/feeds).
const fs = require('fs');
const path = require('path');
const { esc } = require('./views');

const MAX = +process.env.FEED_MAX || 2000;
const PAGE_WAIT = +process.env.FEED_PAUSE_MS || 300;

// A small CSV reader (quotes, doubled quotes, commas and newlines inside quotes).
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false; const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim())) rows.push(row); row = []; } else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
const COLS = { title: /^(title|name|label|work)$/i, image: /^(image|image_?url|picture|file|url|src|primary_?image)$/i, id: /^(id|source|source_?url|identifier|object_?url|accession|permalink)$/i, place: /^(place|location|spatial|coverage)$/i, date: /^(date|year|made|taken|created)$/i, medium: /^(medium|technique|materials?|format)$/i, caption: /^(caption|description|summary|notes?|text)$/i, artist: /^(artist|creator|maker|author|by)$/i, kind: /^(kind|type|classification)$/i, credit: /^(credit|credit_?line)$/i, rights: /^(rights|rights_?statement|licen[cs]e|licen[cs]e_?url|edm:rights|dc:rights|usage)$/i };
function csvItems(text) {
  const rows = parseCSV(text); if (!rows.length) return [];
  const head = rows[0].map(h => h.trim()); const col = {}; for (const k of Object.keys(COLS)) col[k] = head.findIndex(h => COLS[k].test(h));
  if (col.image < 0) throw new Error('the CSV needs an image column (image, url, file, src)');
  const out = [];
  for (const r of rows.slice(1)) {
    const g = k => col[k] >= 0 ? String(r[col[k]] || '').trim() : '';
    const image = g('image'); if (!/^https?:\/\//.test(image)) continue;
    const meta = []; for (const [k, label] of [['date', 'Date'], ['place', 'Place'], ['medium', 'Medium'], ['credit', 'Credit'], ['artist', 'Artist'], ['rights', 'Rights']]) { const v = g(k); if (v) meta.push({ label, value: v }); }
    out.push({ id: g('id') || image, label: g('title') || 'Untitled', summary: g('caption') || null, image, meta, artist: g('artist') ? { name: g('artist') } : null, kind: g('kind').toLowerCase() || null, rights: g('rights') || null });
  }
  return out;
}
// OAI-PMH Dublin Core, one page: the records as items and the resumption token.
const unx = x => String(x || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
function oaiPage(xml) {
  const items = []; const recs = [...String(xml).matchAll(/<record>([\s\S]*?)<\/record>/g)];
  const tag = (s, t) => [...s.matchAll(new RegExp(`<(?:dc:)?${t}[^>]*>([\\s\\S]*?)<\\/(?:dc:)?${t}>`, 'g'))].map(m => unx(m[1])).filter(Boolean);
  for (const m of recs) {
    const r = m[1]; if (/<header[^>]*status="deleted"/.test(r)) continue;
    const ids = tag(r, 'identifier'); const oaiId = (r.match(/<header>[\s\S]*?<identifier>([\s\S]*?)<\/identifier>/) || [])[1];
    const image = ids.find(x => /^https?:\/\/.*\.(jpe?g|png|tiff?|webp)(\?|$)/i.test(x)) || ids.find(x => /\/iiif\//i.test(x) && /^https?:/.test(x)) || null;
    if (!image) continue;
    const img = /\/iiif\//i.test(image) && !/\.(jpe?g|png)(\?|$)/i.test(image) ? image.replace(/\/info\.json$/, '').replace(/\/$/, '') + '/full/max/0/default.jpg' : image;
    const meta = []; const add = (label, vs) => { for (const v of vs.slice(0, 2)) meta.push({ label, value: v }); };
    add('Artist', tag(r, 'creator')); add('Date', tag(r, 'date')); add('Place', tag(r, 'coverage')); add('Medium', tag(r, 'format')); add('Type', tag(r, 'type')); add('Rights', tag(r, 'rights'));
    const web = ids.find(x => /^https?:/.test(x) && x !== image) || null;
    items.push({ id: web || unx(oaiId) || image, label: tag(r, 'title')[0] || 'Untitled', summary: tag(r, 'description')[0] || null, image: img, meta, artist: tag(r, 'creator')[0] ? { name: tag(r, 'creator')[0] } : null, kind: null, rights: tag(r, 'rights')[0] || null });
  }
  const token = (String(xml).match(/<resumptionToken[^>]*>([\s\S]*?)<\/resumptionToken>/) || [])[1];
  return { items, token: token ? unx(token) : null };
}

// Smithsonian Open Access rows (api.si.edu) → items. Only CC0 records with a picture; the largest file from the IDS
// (deliveryService with no max); the maker, date, medium and place from the freetext; the record's own page as the id.
function siItems(rows) {
  const out = [];
  for (const r of rows) {
    const c = r.content || {}; const d = c.descriptiveNonRepeating || {}; const ft = c.freetext || {}; const ix = c.indexedStructured || {};
    if (String((d.online_media && d.online_media.mediaCount) || 0) === '0') continue;
    const access = String(((c.usage || r.usage) || {}).access || (d.metadata_usage && d.metadata_usage.access) || '');
    const media = ((d.online_media || {}).media || []).find(m => /Images?/i.test(m.type || '') && m.content) || ((d.online_media || {}).media || [])[0];
    if (!media || !media.content) continue;
    const imgUsage = String((media.usage || {}).access || access);
    if (!/CC0/i.test(imgUsage)) continue;
    const idsId = media.idsId || (String(media.content).match(/id=([^&]+)/) || [])[1];
    const image = idsId ? `https://ids.si.edu/ids/deliveryService?id=${encodeURIComponent(idsId)}` : String(media.content).replace(/&max=\d+/, '');
    const name = (ft.name || []).find(x => /artist|maker|painter|photographer|author|creator|designer|sculptor|architect/i.test(x.label || '')) || (ft.name || [])[0];
    const first = (arr, re) => { const hit = (arr || []).find(x => !re || re.test(x.label || '')); return hit ? String(hit.content || '').trim() : ''; };
    const meta = []; const add = (label, v) => { if (v) meta.push({ label, value: String(v).slice(0, 300) }); };
    add('Date', first(ft.date) || (ix.date || [])[0]); add('Medium', first(ft.physicalDescription, /medium|material/i) || first(ft.physicalDescription)); add('Place', first(ft.place) || (ix.place || [])[0]); add('Credit', first(ft.creditLine)); add('Unit', d.data_source || d.unit_code); add('Accession', first(ft.identifier, /accession|catalog|object number/i));
    const link = d.record_link || (d.record_ID ? `https://collections.si.edu/search/detail/${d.record_ID}` : null);
    out.push({ id: link || `si:${r.id}`, label: String(r.title || d.title || 'Untitled').slice(0, 160), summary: first(ft.notes, /description|summary|label/i) || null, image, meta, artist: name && name.content ? { name: String(name.content).replace(/,\s*\d{4}.*$/, '') } : null, kind: /painting/i.test(first(ft.objectType) || (ix.object_type || [])[0] || '') ? 'painting' : null, rights: 'CC0', width: null, height: null });
  }
  return out;
}

function mountFeeds(app, { db, V, C, isStudio, studioOnly, ledger, upload }) {
  db.exec(`CREATE TABLE IF NOT EXISTS feeds (id INTEGER PRIMARY KEY, name TEXT, kind TEXT NOT NULL, url TEXT, file TEXT, maker_id INTEGER NOT NULL, open TEXT, show INTEGER NOT NULL DEFAULT 0, max INTEGER,
    status TEXT NOT NULL DEFAULT 'queued', cursor TEXT, looked INTEGER NOT NULL DEFAULT 0, taken INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, missed TEXT, retry_of INTEGER, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), started_at TEXT, finished_at TEXT)`);
  const I = app.locals.iiif; const RD = () => app.locals.reading; const doFetch = (u, o) => I.doFetch(u, o);
  const KINDS = [['auto', 'Let the house read it'], ['csv', 'A CSV (title, image, source, place, date, medium, description, artist, kind, credit)'], ['oai', 'OAI-PMH (Dublin Core)'], ['iiif', 'A IIIF manifest or collection'], ['met', 'The Met’s open access'], ['books', 'A list of books (Gutenberg numbers, or Title, Author a line)'], ['documents', 'A CSV of documents (title, author, pdf, year, source, terms)'], ['ia', 'Internet Archive texts (a search address, or identifiers a line)'], ['guides', 'A CSV of spoken guides (work, audio, transcript, title, speaker, role, lang, license)'], ['se', 'Standard Ebooks (addresses or repositories a line; or the whole catalogue: https://standardebooks.org/ebooks)'], ['si', 'Smithsonian Open Access (an api.si.edu search; SI_API_KEY in the environment)']];
  function kindOf(job) {
    if (job.kind && job.kind !== 'auto') return job.kind;
    const u = String(job.url || ''); if (job.file) { if (/\.(txt|list)$/i.test(job.file)) return 'books'; try { const h = fs.readFileSync(job.file, 'utf8').split(/\r?\n/)[0] || ''; if (/(^|,)\s*"?pdf"?\s*(,|$)/i.test(h)) return 'documents'; if (/(^|,)\s*"?audio"?\s*(,|$)/i.test(h)) return 'guides'; } catch (e) { /* csv */ } return 'csv'; }
    if (I.isMet(u)) return 'met'; if (/archive\.org\/(advancedsearch|services\/search)/.test(u)) return 'ia'; if (/standardebooks\.org|github\.com\/standardebooks/.test(u)) return 'se'; if (/api\.si\.edu\/openaccess/.test(u)) return 'si'; if (/\.csv(\?|$)/i.test(u)) return 'csv'; if (/verb=|oai/i.test(u)) return 'oai'; if (/\.(txt|list)(\?|$)/i.test(u)) return 'books'; return 'iiif';
  }
  // The items of a feed, a page at a time, from the cursor on.
  async function* pages(job) {
    const kind = kindOf(job); const LIM = Math.min(MAX, job.max || MAX);
    if (kind === 'csv' || kind === 'books' || kind === 'documents' || kind === 'guides') {
      const text = job.file ? fs.readFileSync(job.file, 'utf8') : await (async () => { const r = await doFetch(job.url); if (!r.ok) throw new Error(`feed ${r.status}`); return r.text(); })();
      if (kind === 'documents' || kind === 'guides') { const rows = parseCSV(text); const head = (rows.shift() || []).map(h => String(h).trim().toLowerCase()); const items = rows.filter(r => r.some(x => String(x).trim())).map(r => { const o = {}; head.forEach((h, i) => { if (h) o[h] = String(r[i] || '').trim(); }); return kind === 'guides' ? { guide: o, id: `guide:${o.audio || o.work}`, label: o.title || `${o.work}: ${o.speaker || 'a guide'}` } : { doc: o, id: `doc:${o.pdf || o.title}`, label: o.title || o.pdf || '' }; }); yield { items: items.slice(+job.cursor || 0, LIM), cursor: null }; return; }
      if (kind === 'books') { const lines = text.split(/\r?\n/).map(x => x.trim()).filter(x => x && !/^#/.test(x)); yield { items: lines.slice(+job.cursor || 0, LIM).map(l => ({ book: l, id: `book:${l}`, label: l })), cursor: null }; return; }
      const items = csvItems(text); yield { items: items.slice(+job.cursor || 0, LIM), cursor: null }; return;
    }
    if (kind === 'si') {
      // Smithsonian Open Access: CC0 records with media, paged by start/rows; the key from the address or SI_API_KEY.
      const u = new URL(job.url); if (!u.searchParams.get('api_key')) { if (!process.env.SI_API_KEY) throw new Error('SI_API_KEY is not set (a free key from api.data.gov)'); u.searchParams.set('api_key', process.env.SI_API_KEY); }
      if (!u.searchParams.get('q')) u.searchParams.set('q', '*'); u.searchParams.set('rows', '100');
      let start = +job.cursor || 0, n = 0;
      while (n < LIM) {
        u.searchParams.set('start', String(start)); const r = await doFetch(u.href); if (!r.ok) throw new Error(`smithsonian ${r.status}`); const j = await r.json();
        const rows = ((j.response || {}).rows || []); const items = siItems(rows); n += rows.length; start += rows.length;
        yield { items, cursor: String(start) }; if (!rows.length || start >= ((j.response || {}).rowCount || 0)) return;
        await new Promise(x => setTimeout(x, app.locals.noTimers ? 0 : PAGE_WAIT));
      }
      return;
    }
    if (kind === 'se') {
      const SE = app.locals.standard; if (!SE) throw new Error('Standard Ebooks is not mounted');
      if (job.file) { const lines = fs.readFileSync(job.file, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(x => x && !/^#/.test(x)); yield { items: lines.slice(+job.cursor || 0, LIM).map(l => ({ se: l, id: `se:${SE.repoOf(l) || l}`, label: l })), cursor: null }; return; }
      const one = SE.repoOf(job.url);
      if (one) { yield { items: [{ se: one, id: `se:${one}`, label: one }], cursor: null }; return; }
      let n = 0; for await (const pg of SE.catalogue({ from: +job.cursor || 1, limit: LIM })) { n += pg.repos.length; yield { items: pg.repos.map(x => ({ se: x, id: `se:${x}`, label: x.replace('_', ' / ') })), cursor: String(pg.page) }; if (n >= LIM) return; await new Promise(x => setTimeout(x, app.locals.noTimers ? 0 : PAGE_WAIT)); }
      return;
    }
    if (kind === 'ia') {
      if (job.file) { const lines = fs.readFileSync(job.file, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(x => x && !/^#/.test(x)); yield { items: lines.slice(+job.cursor || 0, LIM).map(l => ({ ia: l, id: `ia:${l}`, label: l })), cursor: null }; return; }
      const u = new URL(job.url); let n = 0; let cursor = job.cursor || null;
      if (/services\/search\/v1\/scrape/.test(u.pathname)) {
        u.searchParams.set('fields', 'identifier,title'); u.searchParams.set('count', String(Math.min(1000, LIM)));
        while (n < LIM) { if (cursor) u.searchParams.set('cursor', cursor); else u.searchParams.delete('cursor'); const r = await doFetch(u.href); if (!r.ok) throw new Error(`archive ${r.status}`); const j = await r.json(); const items = (j.items || []).map(x => ({ ia: x.identifier, id: `ia:${x.identifier}`, label: x.title || x.identifier })); n += items.length; cursor = j.cursor || null; yield { items, cursor }; if (!cursor || !items.length) return; await new Promise(x => setTimeout(x, app.locals.noTimers ? 0 : PAGE_WAIT)); }
        return;
      }
      u.searchParams.set('output', 'json'); u.searchParams.delete('fl[]'); u.searchParams.append('fl[]', 'identifier'); u.searchParams.append('fl[]', 'title'); u.searchParams.set('rows', String(Math.min(LIM, 500)));
      let page = +cursor || 1;
      while (n < LIM) { u.searchParams.set('page', String(page)); const r = await doFetch(u.href); if (!r.ok) throw new Error(`archive ${r.status}`); const j = await r.json(); const docs = ((j.response || {}).docs || []); const items = docs.map(x => ({ ia: x.identifier, id: `ia:${x.identifier}`, label: Array.isArray(x.title) ? x.title[0] : (x.title || x.identifier) })); n += items.length; page++; yield { items, cursor: String(page) }; if (!items.length || items.length < 500) return; await new Promise(x => setTimeout(x, app.locals.noTimers ? 0 : PAGE_WAIT)); }
      return;
    }
    if (kind === 'met') { const man = await I.parseMet(job.url, doFetch, LIM); yield { items: man.items.slice(+job.cursor || 0), cursor: null, man }; return; }
    if (kind === 'oai') {
      let token = job.cursor || null; let n = 0; let base = String(job.url).replace(/[?&]verb=.*$/, ''); const set = (String(job.url).match(/[?&]set=([^&]+)/) || [])[1]; const prefix = (String(job.url).match(/[?&]metadataPrefix=([^&]+)/) || [])[1] || 'oai_dc';
      while (n < LIM) {
        const u = token ? `${base}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}` : `${base}?verb=ListRecords&metadataPrefix=${prefix}${set ? `&set=${set}` : ''}`;
        const r = await doFetch(u, { headers: { accept: 'text/xml, application/xml' } }); if (!r.ok) throw new Error(`oai ${r.status}`);
        const pg = oaiPage(await r.text()); n += pg.items.length; token = pg.token;
        yield { items: pg.items, cursor: token }; if (!token) return;
        await new Promise(x => setTimeout(x, app.locals.noTimers ? 0 : PAGE_WAIT));
      }
      return;
    }
    // iiif: a manifest, or a collection of manifests
    const r = await doFetch(job.url, { headers: { accept: 'application/ld+json, application/json' } }); if (!r.ok) throw new Error(`manifest ${r.status}`); const j = await r.json();
    const type = String(j.type || j['@type'] || '');
    if (/Collection/i.test(type)) {
      const mans = (j.items || j.manifests || j.members || []).filter(x => /Manifest/i.test(String(x.type || x['@type'] || ''))).map(x => x.id || x['@id']).filter(Boolean);
      const from = +job.cursor || 0; let n = 0;
      for (let k = from; k < mans.length && n < LIM; k++) {
        try { const mr = await doFetch(mans[k], { headers: { accept: 'application/ld+json, application/json' } }); if (!mr.ok) throw new Error(`manifest ${mr.status}`); const man = I.parseManifest(await mr.json()); n += man.items.length; yield { items: man.items, cursor: String(k + 1), man }; }
        catch (e) { yield { items: [{ id: mans[k], label: mans[k], miss: e.message }], cursor: String(k + 1) }; }
        await new Promise(x => setTimeout(x, app.locals.noTimers ? 0 : PAGE_WAIT));
      }
      return;
    }
    const man = I.parseManifest(j); yield { items: man.items.slice(+job.cursor || 0, LIM), cursor: null, man };
  }
  const missesOf = j => { try { return j.missed ? JSON.parse(j.missed) : []; } catch (e) { return []; } };
  let current = null, stopAsked = false;
  async function run(job) {
    current = job.id; stopAsked = false;
    db.prepare("UPDATE feeds SET status='running', started_at=COALESCE(started_at, datetime('now')), note=NULL WHERE id=?").run(job.id);
    let { looked, taken, skipped, failed } = job; const missed = job.retry_of ? [] : missesOf(job);
    const save = (cursor) => db.prepare('UPDATE feeds SET looked=?, taken=?, skipped=?, failed=?, missed=?, cursor=? WHERE id=?').run(looked, taken, skipped, failed, JSON.stringify(missed.slice(-500)), cursor == null ? null : String(cursor), job.id);
    try {
      const source = job.retry_of ? (async function* () { yield { items: missesOf(db.prepare('SELECT missed FROM feeds WHERE id=?').get(job.retry_of)).map(m => m.item).filter(Boolean), cursor: null }; })() : pages(job);
      for await (const pg of source) {
        for (const it of pg.items) {
          if (stopAsked) { db.prepare("UPDATE feeds SET status='stopped', finished_at=datetime('now') WHERE id=?").run(job.id); save(pg.cursor); current = null; return; }
          looked++;
          try {
            if (it.miss) throw new Error(it.miss);
            if (it.book) { const r = await bringBook(it.book, job); if (r.already) skipped++; else taken++; }
            else if (it.se) { const SE = app.locals.standard; const r = await SE.bring(it.se, { by: 'feed' }); if (r.already) skipped++; else taken++; }
            else if (it.ia) { const D = app.locals.documents; if (!D) throw new Error('the document room is not mounted'); const r = await D.bringIA(it.ia, { public: job.show ? 1 : 0, open: job.open ? 1 : 0 }, { by: 'feed' }); if (r.already) skipped++; else taken++; }
            else if (it.guide) { const G = app.locals.audioGuides; if (!G) throw new Error('the guides room is not mounted'); const r = await G.bringRow(it.guide, job); if (r.already) skipped++; else taken++; }
            else if (it.doc) { const D = app.locals.documents; if (!D) throw new Error('the document room is not mounted'); if (!it.doc.pdf) throw new Error('a row needs a pdf address'); const r = await D.bringUrl({ ...it.doc, public: job.show ? 1 : 0 }, { by: 'feed' }); if (r.already) skipped++; else taken++; }
            else { const r = await I.take(it, job, pg.man); if (r.skipped) skipped++; else taken++; }
          } catch (e) { failed++; missed.push({ id: it.id, label: String(it.label || '').slice(0, 120), why: String(e.message).slice(0, 160), item: it }); }
          if (looked % 5 === 0) save(pg.cursor);
        }
        save(pg.cursor);
      }
      db.prepare("UPDATE feeds SET status='done', finished_at=datetime('now') WHERE id=?").run(job.id); save(null);
      if (app.locals.findIndexDirty) app.locals.findIndexDirty();
      try { const m = db.prepare('SELECT handle, name FROM makers WHERE id=?').get(job.maker_id); ledger.append(db, 'collection.imported', `feed-${job.id}`, { maker: m.handle, n: taken, skipped, failed, from: job.url || job.name || 'a file', feed: kindOf(job) }); } catch (e) { /* */ }
    } catch (e) { db.prepare("UPDATE feeds SET status='failed', note=?, finished_at=datetime('now') WHERE id=?").run(String(e.message).slice(0, 300), job.id); save(job.cursor); }
    current = null;
  }
  async function bringBook(line, job) {
    const R = RD(); if (!R) throw new Error('the reading room is not mounted');
    if (/^\d+$/.test(line)) return R.bring(+line, { by: 'feed' });
    const [title, ...rest] = line.split(','); const author = rest.join(',').trim(); if (!title.trim() || !author) throw new Error('a line is a Gutenberg number, or Title, Author');
    const b = await R.find(title.trim(), author); if (!b) throw new Error('not found on Gutenberg');
    return R.bring(b.id, { by: 'feed', meta: b.formats ? b : null });
  }
  let running = null;
  function kick() { if (running) return; const job = db.prepare("SELECT * FROM feeds WHERE status IN ('queued','running') ORDER BY id LIMIT 1").get(); if (!job) return; running = run(job).catch(e => console.error('[feeds]', e.message)).finally(() => { running = null; setTimeout(kick, 50); }); }
  function enqueue(body, file) {
    const m = db.prepare('SELECT * FROM makers WHERE id=? OR handle=?').get(+body.maker || 0, String(body.maker || '').trim()); if (!m) throw new Error('which maker');
    const url = String(body.url || '').trim(); if (!url && !file) throw new Error('an address or a file');
    if (url && !/^https?:\/\//.test(url)) throw new Error('an https address');
    const open = ['pd', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc'].includes(body.open) ? body.open : null;
    const id = db.prepare('INSERT INTO feeds (name, kind, url, file, maker_id, open, show, max) VALUES (?,?,?,?,?,?,?,?)').run(String(body.name || '').trim().slice(0, 120) || null, KINDS.some(k => k[0] === body.kind) ? body.kind : 'auto', url || null, file || null, m.id, open, body.show ? 1 : 0, +body.max > 0 ? Math.min(+body.max, MAX) : null).lastInsertRowid;
    setTimeout(kick, app.locals.noTimers ? 0 : 20); return id;
  }
  function retry(id) { const j = db.prepare('SELECT * FROM feeds WHERE id=?').get(id); if (!j || !missesOf(j).length) return null; const nid = db.prepare('INSERT INTO feeds (name, kind, url, file, maker_id, open, show, max, retry_of) VALUES (?,?,?,?,?,?,?,?,?)').run(`${j.name || j.url || 'feed'} · the misses`, j.kind, j.url, j.file, j.maker_id, j.open, j.show, j.max, j.id).lastInsertRowid; setTimeout(kick, app.locals.noTimers ? 0 : 20); return nid; }
  // A restart puts a running job back in the queue; the cursor resumes it.
  db.prepare("UPDATE feeds SET status='queued' WHERE status='running'").run(); if (!app.locals.noTimers) setTimeout(kick, 15000).unref();

  const mk = db.prepare("SELECT id, name, handle, kind FROM makers WHERE standing IS NULL OR standing<>'held' ORDER BY CASE kind WHEN 'institution' THEN 0 ELSE 1 END, name");
  const word = j => ({ queued: 'Waiting', running: 'Coming in', done: 'Done', failed: 'Failed', stopped: 'Stopped' }[j.status] || j.status);
  const line = j => `${j.looked} looked at · ${j.taken} in · ${j.skipped} already held · ${j.failed} missed`;
  app.get('/studio/feeds', studioOnly, (req, res) => {
    const rows = db.prepare('SELECT f.*, m.name AS maker FROM feeds f JOIN makers m ON m.id=f.maker_id ORDER BY f.id DESC LIMIT 60').all(); const live = rows.some(r => r.status === 'running' || r.status === 'queued');
    res.send(V.layout({ title: 'Feeds in · Studio', path: '/studio/feeds', desc: '', studio: true, body: `${live ? '<script>setTimeout(function(){location.reload()},4000)</script>' : ''}<main class="wrap fe"><p class="k">The Studio · Back office</p><h1>Feeds in.</h1>
<p class="lede">An institution’s whole collection as one job: a feed read into works, one at a time in the background, every miss named, a run cut short resumed. The same door as a IIIF manifest: the picture, the bag check, the record, the deed, the register.</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}${req.query.err ? `<p class="err">${esc(req.query.err)}</p>` : ''}
<form method="post" action="/studio/feeds" enctype="multipart/form-data" class="fe-form">
<label>A name <input name="name" placeholder="The Frick’s paintings"></label>
<label>What it is <select name="kind">${KINDS.map(k => `<option value="${k[0]}">${esc(k[1])}</option>`).join('')}</select></label>
<label>The address <input name="url" placeholder="https://…/oai?verb=ListRecords&metadataPrefix=oai_dc · a manifest or collection · a CSV · the Met’s search"></label>
<label>Or a file <input type="file" name="file" accept=".csv,.txt,text/csv,text/plain"></label>
<label>For which maker <select name="maker">${mk.all().map(m => `<option value="${m.id}">${esc(m.name)}${m.kind === 'institution' ? ' · institution' : ''}</option>`).join('')}</select></label>
<label>Licence on arrival <select name="open"><option value="">The maker’s own terms</option><option value="pd">Public domain</option><option value="cc0">CC0</option><option value="cc-by">CC BY</option><option value="cc-by-sa">CC BY-SA</option><option value="cc-by-nc">CC BY-NC</option></select></label>
<label>At most <input name="max" type="number" min="1" max="${MAX}" placeholder="${MAX}"></label>
<label class="chk"><input type="checkbox" name="show" value="1"> Show at once (else held back for review)</label>
<button class="buy-btn">Bring it in</button></form>
<h2>The runs</h2>${rows.length ? `<table class="tbl"><tr><th>Feed</th><th>For</th><th>State</th><th>So far</th><th></th></tr>${rows.map(r => `<tr><td><a href="/studio/feeds/${r.id}">${esc(r.name || r.url || r.file || 'a file')}</a><br><small>${esc(kindOf(r))}${r.retry_of ? ` · the misses of No. ${r.retry_of}` : ''}</small></td><td>${esc(r.maker)}</td><td>${word(r)}${r.note ? `<br><small>${esc(r.note)}</small>` : ''}</td><td>${line(r)}</td><td>${r.status === 'running' || r.status === 'queued' ? `<form method="post" action="/studio/feeds/${r.id}/stop"><button>Stop</button></form>` : missesOf(r).length && !r.retry_of ? `<form method="post" action="/studio/feeds/${r.id}/retry"><button>Retry the misses</button></form>` : ''}</td></tr>`).join('')}</table>` : '<p class="note">No feed has come in yet.</p>'}</main>` }));
  });
  app.post('/studio/feeds', studioOnly, upload.single('file'), (req, res) => {
    try { const f = req.file ? req.file.path : null; if (f && /\.(txt|list)$/i.test(req.file.originalname || '') && (req.body.kind === 'auto' || !req.body.kind)) req.body.kind = 'books'; const id = enqueue(req.body || {}, f); res.redirect(`/studio/feeds/${id}?ok=` + encodeURIComponent('The feed is coming in, one work at a time; this page follows it.')); }
    catch (e) { if (req.file) { try { fs.unlinkSync(req.file.path); } catch (x) { /* */ } } res.redirect('/studio/feeds?err=' + encodeURIComponent(e.message)); }
  });
  app.get('/studio/feeds/:id', studioOnly, (req, res) => {
    const r = db.prepare('SELECT f.*, m.name AS maker, m.handle FROM feeds f JOIN makers m ON m.id=f.maker_id WHERE f.id=?').get(+req.params.id); if (!r) return res.sendStatus(404);
    const live = r.status === 'running' || r.status === 'queued'; const missed = missesOf(r);
    const came = db.prepare("SELECT slug, title, status FROM works WHERE maker_id=? AND created_at>=? ORDER BY id DESC LIMIT 60").all(r.maker_id, r.started_at || r.created_at);
    res.send(V.layout({ title: `${r.name || 'A feed'} · Feeds in`, path: `/studio/feeds/${r.id}`, desc: '', studio: true, body: `${live ? '<script>setTimeout(function(){location.reload()},3000)</script>' : ''}<main class="wrap fe"><p class="k"><a href="/studio/feeds">Feeds in</a></p><h1>${esc(r.name || r.url || 'A feed')}</h1>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}<p class="lede">${word(r)} · for ${esc(r.maker)} · ${esc(kindOf(r))}${r.open ? ` · ${esc(r.open)}` : ''}${r.show ? ' · shown at once' : ' · held back for review'}</p>
<p><b>${line(r)}</b>${r.note ? ` · ${esc(r.note)}` : ''}${r.cursor && live ? ` · at ${esc(r.cursor.slice(0, 40))}` : ''}</p>
${live ? `<form method="post" action="/studio/feeds/${r.id}/stop"><button>Stop</button></form>` : ''}${missed.length && !r.retry_of ? `<form method="post" action="/studio/feeds/${r.id}/retry"><button class="buy-btn">Retry the misses (${missed.length})</button></form>` : ''}
${missed.length ? `<h2>The misses</h2><table class="tbl"><tr><th>Item</th><th>Why</th></tr>${missed.slice(-200).reverse().map(m => `<tr><td>${esc(m.label || m.id)}<br><small>${esc(String(m.id || '').slice(0, 100))}</small></td><td>${esc(m.why)}</td></tr>`).join('')}</table>` : ''}
${came.length ? `<h2>What came in</h2><div class="fe-came">${came.map(w => `<a href="/studio/works/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span>${esc(w.title)}${w.status === 'hidden' ? ' · held back' : ''}</span></a>`).join('')}</div>` : ''}</main>` }));
  });
  app.post('/studio/feeds/:id/stop', studioOnly, (req, res) => { const id = +req.params.id; if (current === id) stopAsked = true; else db.prepare("UPDATE feeds SET status='stopped', finished_at=datetime('now') WHERE id=? AND status='queued'").run(id); res.redirect(`/studio/feeds/${id}`); });
  app.post('/studio/feeds/:id/retry', studioOnly, (req, res) => { const nid = retry(+req.params.id); res.redirect(nid ? `/studio/feeds/${nid}?ok=` + encodeURIComponent('The misses are going through the door again.') : `/studio/feeds/${req.params.id}`); });
  app.locals.feeds = { enqueue, retry, kick, run, pages, parseCSV, csvItems, oaiPage, siItems, kindOf, missesOf };
  return app.locals.feeds;
}

module.exports = { mountFeeds, parseCSV, csvItems, oaiPage, siItems };
