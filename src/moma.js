// MoMA, the record (Will, 5 Nov: "copy everything relevant from MoMA … everything we need … the biggest art platform in
// the world … whatever will give us the structure and information for our own registry"). The Museum of Modern Art
// publishes its collection's records on GitHub under CC0: about 160,000 works and 16,000 artists, with title, date,
// medium, dimensions (and measured centimetres), credit line, accession number, classification, department, date
// acquired, where it hangs today, and each artist's dates, nationality, Wikidata and Getty ULAN identifiers. Images are
// not part of it (MoMA licenses them through Art Resource and Scala), so the house copies the record and never the
// picture: no MoMA image is fetched, shown or linked as a picture.
//
// What the house does with it:
//  - every record is kept in its own tables (moma_artists, moma_works), refreshed from the source each month;
//  - every MoMA artist with five works or more (or a Wikidata identifier) becomes an artist of the hall (or is matched
//    to one the house knows), with dates, nationality, Wikidata and ULAN filled where the house had none;
//  - every work joins its artist's catalogue (shown as a known work, "At MoMA", with where it hangs when it is on view);
//  - every work becomes a record in the registry: in the collection of MoMA, the accession, the credit line, the date
//    acquired as the last line of its provenance, the measured size (the wall to scale reads it), its classification.
// The register gets one entry a batch with the fingerprint of every line in it, never one a record.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { slugify, sortName } = require('./art');

const MOMA_QID = 'Q188740';
const HOLDER = 'The Museum of Modern Art, New York';
const SITE = 'https://www.moma.org';
const SOURCE = 'https://github.com/MuseumofModernArt/collection';
const BASE = () => process.env.MOMA_DATA || 'https://media.githubusercontent.com/media/MuseumofModernArt/collection/main';
const MIN = Number(process.env.MOMA_MIN_WORKS || 5);
const BATCH = 250;
const NOBODY = /^(unknown|unidentified|anonymous|various|unrecorded|not yet identified)/i;

const KIND = c => {
  c = String(c || '').toLowerCase();
  if (/painting/.test(c)) return 'painting'; if (/drawing|work on paper|collage/.test(c)) return 'drawing';
  if (/print|multiple|poster|illustrated book|portfolio/.test(c)) return 'print'; if (/photograph/.test(c)) return 'photograph';
  if (/sculpture|installation/.test(c)) return 'sculpture'; if (/design|architecture|archive|wallpaper|textile/.test(c)) return 'design';
  if (/film|video|media|digital/.test(c)) return 'film'; return 'other';
};
const yearOf = s => { const m = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(String(s || '')); return m ? Number(m[1]) : null; };
const howOf = c => { c = String(c || ''); return /bequest/i.test(c) ? 'bequest' : /exchange/i.test(c) ? 'exchange' : /gift|given|donat|promised/i.test(c) ? 'gift' : /purchase|fund|acquired through/i.test(c) ? 'purchase' : null; };
const num = v => { const n = Number(String(v || '').replace(/[()]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const clean = v => { const s = String(v == null ? '' : v).replace(/^\((.*)\)$/s, '$1').trim(); return s || null; };

// A CSV read as it streams: fields may hold commas, quotes and new lines. Calls `each(rows)` with a batch at a time.
async function csvStream(stream, each) {
  let row = [], field = '', q = false, pend = '', rows = [];
  for await (const chunk of stream) {
    const s = pend + chunk.toString('utf8'); pend = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '"') { if (i + 1 >= s.length) { pend = '"'; break; } if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
      if (c === '"') q = true; else if (c === ',') { row.push(field); field = ''; } else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; } else field += c;
    }
    if (rows.length >= BATCH) { const b = rows; rows = []; await each(b); }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (rows.length) await each(rows);
}

function mountMoma(app, { db, C, ledger, studioOnly, V }) {
  const esc = V.esc;
  db.exec(`CREATE TABLE IF NOT EXISTS moma_artists (cid INTEGER PRIMARY KEY, name TEXT NOT NULL, bio TEXT, nationality TEXT, gender TEXT, born INTEGER, died INTEGER, qid TEXT, ulan TEXT, works INTEGER NOT NULL DEFAULT 0, artist_id INTEGER);
    CREATE TABLE IF NOT EXISTS moma_works (oid INTEGER PRIMARY KEY, title TEXT, cids TEXT, artist TEXT, date TEXT, year INTEGER, medium TEXT, dims TEXT, credit TEXT, accession TEXT, classification TEXT, department TEXT,
      acquired TEXT, cataloged INTEGER, url TEXT, on_view TEXT, cm TEXT, read_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS moma_artists_aid ON moma_artists(artist_id)`);
  const col = (t, c, ty) => { if (!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name=?`).get(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ty}`); };
  col('artists', 'ulan', 'TEXT'); col('artists', 'moma_id', 'INTEGER'); col('artists', 'qid', 'TEXT');
  for (const c of ['on_view', 'credit', 'acquired']) col('catalogue', c, 'TEXT');
  // The registry's record gains MoMA's structure: what kind of object, the credit line, the date acquired, the department,
  // where it hangs, the measured size in centimetres (h, w, d, diameter, length, weight, duration) and every identifier.
  for (const [c, ty] of [['classification', 'TEXT'], ['credit_line', 'TEXT'], ['acquired_on', 'TEXT'], ['department', 'TEXT'], ['on_view', 'TEXT'], ['cm', 'TEXT'], ['ids', 'TEXT']]) col('objects', c, ty);
  db.exec('CREATE INDEX IF NOT EXISTS objects_artist ON objects(artist_id)');

  const dir = () => path.join(C.dataDir, 'moma');
  const job = { on: false, step: null, artists: 0, works: 0, linked: 0, made: 0, catalogued: 0, recorded: 0, at: null, error: null };
  const GOV = () => app.locals.governor;
  const lane = (label, fn) => (GOV() && GOV().turn ? GOV().turn(label, fn) : fn());
  // A breath between batches: short, and longer only while memory is high (5 Nov: the visitors' gate held each batch a
  // minute on the live house, ten hours for the whole record; a batch is a few hundred rows, gone in a moment).
  const breathe = async () => { if (app.locals.noTimers) return new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, 150));
    for (let i = 0; i < 20 && process.memoryUsage().rss / 1048576 > (+process.env.GOV_MEM_MB || 1600); i++) await new Promise(r => setTimeout(r, 1500)); };

  async function fetchTo(name) {
    const base = app.locals.moma.base || BASE();
    if (!/^https?:/.test(base)) return path.join(base, name);
    fs.mkdirSync(dir(), { recursive: true }); const to = path.join(dir(), name), tmp = to + '.part';
    const r = await fetch(`${base}/${name}`, { headers: { 'user-agent': 'Watermark (house@watermark.krafftco.com)' } });
    if (!r.ok) throw new Error(`MoMA ${name}: ${r.status}`);
    const { Readable } = require('stream'); const { pipeline } = require('stream/promises');
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp)); fs.renameSync(tmp, to);
    const head = fs.readFileSync(to, { encoding: 'utf8', flag: 'r' }).slice(0, 60);
    if (/git-lfs\.github\.com/.test(head)) throw new Error(`MoMA ${name}: the file came back as a Git LFS pointer`);
    return to;
  }
  const upsert = (table, key, cols, rows) => {
    if (!rows.length) return;
    db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${rows.map(() => `(${cols.map(() => '?').join(',')})`).join(',')} ON CONFLICT (${key}) DO UPDATE SET ${cols.filter(c => c !== key).map(c => `${c}=excluded.${c}`).join(', ')}`)
      .run(...rows.flatMap(r => cols.map(c => r[c] == null ? null : r[c])));
  };

  // 1. The artists, and 2. the works, into the house's own copy.
  async function readSource() {
    job.step = 'artists';
    const A = JSON.parse(fs.readFileSync(await fetchTo('Artists.json'), 'utf8'));
    const AC = ['cid', 'name', 'bio', 'nationality', 'gender', 'born', 'died', 'qid', 'ulan'];
    for (let i = 0; i < A.length; i += BATCH) {
      upsert('moma_artists', 'cid', AC, A.slice(i, i + BATCH).filter(a => a.ConstituentID && a.DisplayName).map(a => ({ cid: Number(a.ConstituentID), name: String(a.DisplayName).trim(), bio: clean(a.ArtistBio), nationality: clean(a.Nationality),
        gender: clean(a.Gender), born: num(a.BeginDate), died: num(a.EndDate), qid: /^Q\d+$/.test(a['Wiki QID'] || '') ? a['Wiki QID'] : null, ulan: a.ULAN ? String(a.ULAN) : null })));
      job.artists = Math.min(A.length, i + BATCH); await breathe();
    }
    job.step = 'works'; const counts = new Map(); let head = null;
    const WC = ['oid', 'title', 'cids', 'artist', 'date', 'year', 'medium', 'dims', 'credit', 'accession', 'classification', 'department', 'acquired', 'cataloged', 'url', 'on_view', 'cm'];
    await csvStream(fs.createReadStream(await fetchTo('Artworks.csv')), async rows => {
      if (!head) { head = rows.shift().map(h => h.replace(/^﻿/, '').trim()); }
      const at = k => head.indexOf(k), g = (r, k) => (at(k) >= 0 ? r[at(k)] : '');
      const out = rows.filter(r => r.length >= head.length - 2 && num(g(r, 'ObjectID'))).map(r => {
        const cids = String(g(r, 'ConstituentID') || '').split(',').map(s => Number(s.trim())).filter(Boolean);
        cids.forEach(c => counts.set(c, (counts.get(c) || 0) + 1));
        const cm = {}; for (const [k, n] of [['h', 'Height (cm)'], ['w', 'Width (cm)'], ['d', 'Depth (cm)'], ['diam', 'Diameter (cm)'], ['len', 'Length (cm)'], ['circ', 'Circumference (cm)'], ['kg', 'Weight (kg)'], ['seat', 'Seat Height (cm)'], ['sec', 'Duration (sec.)']]) { const v = num(g(r, n)); if (v) cm[k] = v; }
        return { oid: num(g(r, 'ObjectID')), title: clean(g(r, 'Title')) || 'Untitled', cids: cids.join(','), artist: clean(g(r, 'Artist')), date: clean(g(r, 'Date')), year: yearOf(g(r, 'Date')), medium: clean(g(r, 'Medium')),
          dims: clean(g(r, 'Dimensions')), credit: clean(g(r, 'CreditLine')), accession: clean(g(r, 'AccessionNumber')), classification: clean(g(r, 'Classification')), department: clean(g(r, 'Department')),
          acquired: /^\d{4}-\d{2}-\d{2}$/.test(g(r, 'DateAcquired')) ? g(r, 'DateAcquired') : null, cataloged: g(r, 'Cataloged') === 'Y' ? 1 : 0, url: /^https:\/\/www\.moma\.org\//.test(g(r, 'URL')) ? g(r, 'URL') : null,
          on_view: clean(g(r, 'OnView')), cm: Object.keys(cm).length ? JSON.stringify(cm) : null };
      });
      upsert('moma_works', 'oid', WC, out); job.works += out.length; await breathe();
    });
    const set = db.prepare('UPDATE moma_artists SET works=? WHERE cid=?'); db.prepare('UPDATE moma_artists SET works=0').run();
    for (const [c, n] of counts) set.run(n, c);
  }

  // 3. The artists of the hall: matched by Wikidata, then by name either way round; else made, when the work warrants it.
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  function linkArtists() {
    job.step = 'artists of the hall';
    const house = db.prepare('SELECT id, slug, name, sort_name, qid, moma_id FROM artists').all();
    const byQ = new Map(house.filter(a => a.qid).map(a => [a.qid, a])), byM = new Map(house.filter(a => a.moma_id).map(a => [a.moma_id, a])), byN = new Map();
    for (const a of house) for (const k of [norm(a.name), norm(a.sort_name), norm(sortName(a.name))]) if (k && !byN.has(k)) byN.set(k, a);
    const slugs = new Set(house.map(a => a.slug));
    const list = db.prepare('SELECT * FROM moma_artists WHERE works>0 AND (works>=? OR qid IS NOT NULL) ORDER BY works DESC').all(MIN);
    for (const m of list) {
      if (NOBODY.test(m.name)) continue;
      let a = byM.get(m.cid) || (m.qid && byQ.get(m.qid)) || byN.get(norm(m.name)) || byN.get(norm(sortName(m.name)));
      if (!a) {
        const base = slugify(m.name); let slug = base, i = 2; while (slugs.has(slug)) slug = `${base}-${i++}`;
        db.prepare('INSERT INTO artists (slug, name, sort_name, born, died, nationality, qid, ulan, moma_id, sources) VALUES (?,?,?,?,?,?,?,?,?,?)').run(slug, m.name, sortName(m.name), m.born, m.died, m.nationality, m.qid, m.ulan, m.cid, SOURCE);
        a = { id: db.prepare('SELECT id FROM artists WHERE slug=?').get(slug).id, slug, name: m.name }; slugs.add(slug); byN.set(norm(m.name), a); job.made++;
      } else db.prepare('UPDATE artists SET born=COALESCE(born,?), died=COALESCE(died,?), nationality=COALESCE(nationality,?), qid=COALESCE(qid,?), ulan=COALESCE(ulan,?), moma_id=COALESCE(moma_id,?) WHERE id=?').run(m.born, m.died, m.nationality, m.qid, m.ulan, m.cid, a.id);
      db.prepare('UPDATE moma_artists SET artist_id=? WHERE cid=?').run(a.id, m.cid); job.linked++;
    }
  }

  // 4. Each work into its artist's catalogue (the first named artist; joint works under each artist the hall keeps).
  async function catalogue() {
    job.step = 'catalogue';
    db.prepare("INSERT INTO keepers (qid, name, city, country, site, lat, lon) VALUES (?,?,?,?,?,?,?) ON CONFLICT (qid) DO UPDATE SET name=excluded.name, city=excluded.city, country=excluded.country, site=excluded.site, lat=excluded.lat, lon=excluded.lon")
      .run(MOMA_QID, 'The Museum of Modern Art', 'New York', 'United States', SITE, 40.7614, -73.9776);
    const aid = new Map(db.prepare('SELECT cid, artist_id FROM moma_artists WHERE artist_id IS NOT NULL').all().map(r => [r.cid, r.artist_id]));
    const CC = ['artist_id', 'qid', 'title', 'year', 'kind', 'type', 'medium', 'collection', 'collection_qid', 'inventory', 'size', 'object_url', 'on_view', 'credit', 'acquired'];
    let last = 0;
    for (;;) {
      const ws = db.prepare('SELECT * FROM moma_works WHERE oid>? ORDER BY oid LIMIT ?').all(last, BATCH); if (!ws.length) break; last = ws[ws.length - 1].oid;
      const rows = [];
      for (const w of ws) for (const c of String(w.cids || '').split(',').map(Number).filter(Boolean)) { const a = aid.get(c); if (!a) continue;
        rows.push({ artist_id: a, qid: `moma:${w.oid}`, title: w.title, year: w.year, kind: KIND(w.classification), type: w.classification, medium: w.medium, collection: HOLDER, collection_qid: MOMA_QID, inventory: w.accession,
          size: w.dims ? String(w.dims).split('\n')[0].slice(0, 300) : null, object_url: w.url, on_view: w.on_view, credit: w.credit, acquired: w.acquired }); }
      const seen = new Set(), uniq = rows.filter(r => { const k = r.artist_id + '|' + r.qid; if (seen.has(k)) return false; seen.add(k); return true; });
      if (uniq.length) db.prepare(`INSERT INTO catalogue (${CC.join(',')}) VALUES ${uniq.map(() => `(${CC.map(() => '?').join(',')})`).join(',')} ON CONFLICT (artist_id, qid) DO UPDATE SET ${CC.slice(2).map(c => `${c}=excluded.${c}`).join(', ')}`).run(...uniq.flatMap(r => CC.map(c => r[c] == null ? null : r[c])));
      job.catalogued += uniq.length; await breathe();
    }
    for (const a of db.prepare('SELECT a.slug FROM artists a JOIN moma_artists m ON m.artist_id=a.id').all()) try { app.locals.art.uncache(a.slug); } catch (e) { /* */ }
  }

  // 5. The registry: a record for every work, the provenance's last line from the credit line and the date acquired.
  async function record({ max = Infinity } = {}) {
    job.step = 'registry';
    const RG = app.locals.registry; if (!RG) throw new Error('the registry is not on');
    const OC = ['owner', 'title', 'artist', 'artist_id', 'made', 'made_year', 'medium', 'dims', 'catalogue_id', 'public', 'record_kind', 'holder', 'accession', 'source_url', 'classification', 'credit_line', 'acquired_on', 'department', 'on_view', 'cm', 'ids'];
    let left = max;
    while (left > 0) {
      const cs = db.prepare("SELECT c.id, c.artist_id, c.qid, a.name aname, a.qid aqid, a.ulan FROM catalogue c JOIN artists a ON a.id=c.artist_id WHERE c.qid LIKE 'moma:%' AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.catalogue_id=c.id) ORDER BY c.id LIMIT ?").all(Math.min(BATCH, left));
      if (!cs.length) break; left -= cs.length;
      const mw = new Map(db.prepare(`SELECT * FROM moma_works WHERE oid IN (${cs.map(() => '?').join(',')})`).all(...cs.map(c => Number(c.qid.slice(5)))).map(w => [w.oid, w]));
      // One record a work: a joint work is recorded once, under its first artist the hall keeps.
      const done = new Set(), objs = [];
      for (const c of cs) { const w = mw.get(Number(c.qid.slice(5))); if (!w || done.has(w.oid)) continue; done.add(w.oid);
        objs.push({ c, w, row: { owner: 'house', title: w.title, artist: w.artist || c.aname, artist_id: c.artist_id, made: w.date, made_year: w.year, medium: w.medium, dims: w.dims, catalogue_id: c.id, public: 1, record_kind: 'collection',
          holder: HOLDER, accession: w.accession, source_url: w.url, classification: w.classification, credit_line: w.credit, acquired_on: w.acquired, department: w.department, on_view: w.on_view, cm: w.cm,
          ids: JSON.stringify({ moma: w.oid, accession: w.accession, artist_qid: c.aqid || null, artist_ulan: c.ulan || null }) } }); }
      // Records for the other artists of a joint work point at the one record (so the batch never asks again).
      const skip = cs.filter(c => !objs.some(o => o.c.id === c.id));
      await lane('moma', async () => {
        const shas = [], ids = [];
        db.transaction(() => {
          for (const o of objs) o.id = db.prepare(`INSERT INTO objects (${OC.join(',')}) VALUES (${OC.map(() => '?').join(',')})`).run(...OC.map(k => o.row[k] == null ? null : o.row[k])).lastInsertRowid;
          for (const c of skip) { const twin = objs.find(o => o.w.oid === Number(c.qid.slice(5))); db.prepare("INSERT INTO objects (owner, title, artist_id, catalogue_id, public, record_kind, status) VALUES ('house', ?, ?, ?, 0, 'collection', 'merged')").run(twin ? twin.w.title : 'Joint work', c.artist_id, c.id); }
          for (const o of objs) {
            if (!o.w.acquired && !o.w.credit) continue;
            const e = { object_id: o.id, kind: 'acquired', on_date: o.w.acquired, year_from: o.w.acquired ? Number(o.w.acquired.slice(0, 4)) : null, party: HOLDER, how: howOf(o.w.credit), body: o.w.credit, source: o.w.url || SOURCE, by_kind: 'house', by_name: 'from MoMA’s open collection data', public: 1 };
            const sha = crypto.createHash('sha256').update(JSON.stringify(e)).digest('hex'); shas.push(sha);
            ids.push(db.prepare('INSERT INTO object_events (object_id, kind, on_date, year_from, party, how, body, source, by_kind, by_name, public, sha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(e.object_id, e.kind, e.on_date, e.year_from, e.party, e.how, e.body, e.source, e.by_kind, e.by_name, e.public, sha).lastInsertRowid);
          }
        })();
        { let seq = null; try { seq = ledger.append(db, 'registry.batch', 'moma', { records: objs.length, lines: shas.length, from: objs.length ? objs[0].w.oid : null, to: objs.length ? objs[objs.length - 1].w.oid : null,
            sha: crypto.createHash('sha256').update(shas.join('')).digest('hex') }).seq; } catch (x) { /* */ }
          if (seq != null && ids.length) for (let i = 0; i < ids.length; i += 500) db.prepare(`UPDATE object_events SET seq=? WHERE id IN (${ids.slice(i, i + 500).map(() => '?').join(',')})`).run(seq, ...ids.slice(i, i + 500)); }
      });
      job.recorded += objs.length; await breathe();
    }
  }

  async function sync({ registry = true, source = true } = {}) {
    if (job.on) return job; Object.assign(job, { on: true, step: null, artists: 0, works: 0, linked: 0, made: 0, catalogued: 0, recorded: 0, at: new Date().toISOString(), error: null });
    try {
      if (source) await readSource();
      linkArtists(); await catalogue(); if (registry) await record();
      db.prepare("INSERT INTO settings (k, v) VALUES ('moma_at', ?) ON CONFLICT (k) DO UPDATE SET v=excluded.v").run(new Date().toISOString());
      try { ledger.append(db, 'collection.recorded', 'moma', { holder: HOLDER, works: job.works, artists: job.linked, catalogued: job.catalogued, recorded: job.recorded }); } catch (e) { /* */ }
      try { if (app.locals.findIndexDirty) app.locals.findIndexDirty(); } catch (e) { /* */ }
    } catch (e) { job.error = e.message; console.error('[moma]', e.message); }
    job.on = false; job.step = null; job.at = new Date().toISOString(); return job;
  }
  const counts = () => ({ works: db.prepare('SELECT COUNT(*) n FROM moma_works').get().n, artists: db.prepare('SELECT COUNT(*) n FROM moma_artists').get().n,
    hall: db.prepare('SELECT COUNT(*) n FROM moma_artists WHERE artist_id IS NOT NULL').get().n, catalogue: db.prepare("SELECT COUNT(*) n FROM catalogue WHERE qid LIKE 'moma:%'").get().n,
    registry: db.prepare(`SELECT COUNT(*) n FROM objects WHERE holder=? AND record_kind='collection' AND status<>'merged'`).get(HOLDER).n, onView: db.prepare("SELECT COUNT(*) n FROM moma_works WHERE on_view IS NOT NULL").get().n,
    at: (db.prepare("SELECT v FROM settings WHERE k='moma_at'").get() || {}).v || null });

  app.get('/studio/moma', studioOnly, (req, res) => {
    const n = counts(), S = require('./studio-views');
    const top = db.prepare('SELECT m.name, m.works, a.slug FROM moma_artists m LEFT JOIN artists a ON a.id=m.artist_id ORDER BY m.works DESC LIMIT 24').all();
    res.send(V.layout({ studio: true, title: 'MoMA, the record · Watermark', path: '/studio/moma', body: `<section class="studio-wrap hd">${S.nav('/studio/moma')}
<p class="k">Bringing in · The Museum of Modern Art</p><h1>MoMA, the record.</h1>
<p class="lede">MoMA publishes its collection's records under CC0: every work, every artist, their dates and identifiers, the credit lines and the dates acquired. The house keeps the whole record, brings MoMA's artists into the hall, puts every work in its artist's catalogue and gives every work a record in the registry. Pictures are not part of it and the house takes none: MoMA licenses its images through Art Resource and Scala.</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<div class="hd-held"><span><b>${n.works.toLocaleString()}</b> works</span><span><b>${n.artists.toLocaleString()}</b> artists (${n.hall.toLocaleString()} in the hall)</span><span><b>${n.catalogue.toLocaleString()}</b> in the catalogues</span><span><b>${n.registry.toLocaleString()}</b> in the registry</span><span><b>${n.onView.toLocaleString()}</b> on view now</span></div>
<p class="note">${job.on ? `Working: ${esc(job.step || '')} · ${job.works.toLocaleString()} works read · ${job.catalogued.toLocaleString()} catalogued · ${job.recorded.toLocaleString()} recorded. This page refreshes itself.` : n.at ? `Last read ${esc(n.at.slice(0, 16).replace('T', ' '))} UTC; read again each month by itself.` : 'Not yet read.'}${job.error ? ` <b>Last error:</b> ${esc(job.error)}` : ''}</p>
<form method="post" action="/studio/moma/sync" class="form inline"><button${job.on ? ' disabled' : ''}>Read MoMA's collection, and record it all</button></form>
<form method="post" action="/studio/moma/sync" class="form inline"><input type="hidden" name="registry" value="0"><button class="link"${job.on ? ' disabled' : ''}>Read it into the hall and the catalogues only</button></form>
${top.length ? `<section class="hd-list"><div class="hd-h"><h2>The most collected</h2></div><p>${top.map(t => t.slug ? `<a href="/art/${esc(t.slug)}">${esc(t.name)}</a> ${t.works.toLocaleString()}` : `${esc(t.name)} ${t.works.toLocaleString()}`).join(' · ')}</p></section>` : ''}
<p class="note">Source: <a href="${SOURCE}" rel="noopener">MoMA's collection data</a>, CC0. The house says MoMA is the holder and links its own record; it is not connected with MoMA. One heavy job at a time: not while another feed or import runs.</p>
${job.on ? '<script>setTimeout(()=>location.reload(),8000)</script>' : ''}</section>` }));
  });
  app.post('/studio/moma/sync', studioOnly, (req, res) => {
    if (job.on) return res.redirect('/studio/moma');
    sync({ registry: String((req.body || {}).registry) !== '0' }).catch(() => {});
    res.redirect('/studio/moma?ok=' + encodeURIComponent('Reading MoMA’s collection in the background.'));
  });
  // Read again each month (MoMA updates the record "on a regular basis"), once it has been read once.
  if (!app.locals.noTimers) { const t = setInterval(() => { try { const ROLE = require('./role'); if (!ROLE.chores || job.on) return; const at = counts().at; if (at && Date.now() - Date.parse(at) > 30 * 864e5 && (!GOV() || !GOV().chores || GOV().chores())) sync().catch(() => {}); } catch (e) { /* */ } }, 6 * 3600e3); t.unref(); }

  // A MoMA work by its object number: its record in the registry (the artist page's known works link here).
  app.get('/registry/known/moma/:oid', (req, res, next) => {
    const RG = app.locals.registry; const c = db.prepare('SELECT id FROM catalogue WHERE qid=? ORDER BY id LIMIT 1').get(`moma:${Number(req.params.oid) || 0}`);
    const o = c && db.prepare("SELECT * FROM objects WHERE catalogue_id=? AND status<>'merged'").get(c.id);
    if (o && RG && RG.no) return res.redirect(`/r/${RG.no(o).replace(/\s+/g, '').slice(2)}`);
    const w = db.prepare('SELECT url FROM moma_works WHERE oid=?').get(Number(req.params.oid) || 0); if (w && w.url) return res.redirect(w.url); next();
  });
  app.locals.moma = { sync, readSource, linkArtists, catalogue, record, job, counts, base: null, HOLDER, MOMA_QID, csvStream };
}

module.exports = { mountMoma, csvStream, KIND, howOf, yearOf };
