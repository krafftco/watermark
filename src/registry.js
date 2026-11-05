// The registry (Will, 5 Nov: "the future, where this is capable of offering the registry and the free-port exchange …
// how can this become the art platform where old masters trade?"; "let's get the registry in best shape then, with that
// in mind"). Before a physical work can change hands anywhere serious, five questions must be answered on paper: what
// it is, who owns it and how they came to, where it has been, where it is now and in what state, and whether anyone
// has a claim on it. The registry is the record that answers them: one record per object, an append-only history of
// events (never edited, only corrected by a later entry), each fingerprinted and laid on the house's signed register,
// with the papers kept in the vault. The owner keeps it; a custodian (a freeport, an art store, a registrar) attests
// what it holds; experts sign their own opinions. Private by default: an owner may publish the object (never the
// owner, never the place) or hand a reader a link. Title passes by both hands, owner and receiver; no money moves
// here, and the house judges no sale. 'Ready for the desk' reads what a private sale would ask, so the record is
// ready before anyone sells. Every word a draft for Will and counsel.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const multer = require('multer');
const { check } = require('./track');

const KINDS = {
  provenance: ['Provenance', 'In whose hands it was, and when'],
  acquired: ['Acquired', 'How the present owner came to own it'],
  custody: ['Custody', 'Where it is held, and by whom'],
  condition: ['Condition', 'A report on its state'],
  opinion: ['Opinion', 'An expert’s word on what it is'],
  exhibited: ['Exhibited', 'A show it hung in'],
  published: ['Published', 'A book or catalogue it appears in'],
  search: ['Searched', 'A search of a stolen-art register'],
  note: ['Note', 'Anything else worth keeping'],
  transfer: ['Title passed', 'Ownership moved on the registry'],
  correction: ['Correction', 'An earlier entry, set right'],
};
const HOW = ['purchase', 'gift', 'bequest', 'by descent', 'auction', 'commission', 'from the artist', 'exchange', 'unknown'];
const YEAR = 365.25 * 864e5;

function mountRegistry(app, { db, V, C, mail, ledger, store, isStudio, makerOf, buyerOf }) {
  const { esc, tidy } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS objects (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, artist TEXT, artist_id INTEGER, made TEXT, made_year INTEGER,
      medium TEXT, dims TEXT, marks TEXT, description TEXT, photo TEXT, work_id INTEGER, cabinet_id INTEGER, custodian_id INTEGER, public INTEGER NOT NULL DEFAULT 0, token TEXT,
      status TEXT NOT NULL DEFAULT 'recorded', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS object_events (id INTEGER PRIMARY KEY, object_id INTEGER NOT NULL, kind TEXT NOT NULL, on_date TEXT, year_from INTEGER, year_to INTEGER, party TEXT, how TEXT,
      place TEXT, body TEXT, source TEXT, result TEXT, price_cents INTEGER, file TEXT, mime TEXT, file_sha TEXT, by_kind TEXT NOT NULL, by_name TEXT, public INTEGER NOT NULL DEFAULT 1,
      corrects INTEGER, sha TEXT, seq INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS object_transfers (id INTEGER PRIMARY KEY, object_id INTEGER NOT NULL, from_owner TEXT NOT NULL, email TEXT NOT NULL, token TEXT UNIQUE NOT NULL, note TEXT,
      status TEXT NOT NULL DEFAULT 'offered', at TEXT NOT NULL DEFAULT (datetime('now')), taken_at TEXT)`);
  for (const [c, ty] of [['record_kind', "TEXT NOT NULL DEFAULT 'private'"], ['holder', 'TEXT'], ['accession', 'TEXT'], ['source_url', 'TEXT'], ['qid', 'TEXT'], ['catalogue_id', 'INTEGER'], ['from_line', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('objects') WHERE name=?").get(c)) db.exec(`ALTER TABLE objects ADD COLUMN ${c} ${ty}`);
  db.exec(`CREATE TABLE IF NOT EXISTS object_offers (id INTEGER PRIMARY KEY, object_id INTEGER NOT NULL, who TEXT NOT NULL, name TEXT, email TEXT, kind TEXT NOT NULL, on_date TEXT, year_from INTEGER, year_to INTEGER,
      party TEXT, how TEXT, result TEXT, body TEXT, source TEXT NOT NULL, file TEXT, mime TEXT, file_sha TEXT, status TEXT NOT NULL DEFAULT 'waiting', word TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS objects_work ON objects(work_id); CREATE INDEX IF NOT EXISTS objects_cat ON objects(catalogue_id)`);
  db.exec(`CREATE TABLE IF NOT EXISTS object_views (id INTEGER PRIMARY KEY, object_id INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, file TEXT NOT NULL, line TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const dir = path.join(C.dataDir, 'registry'); fs.mkdirSync(dir, { recursive: true });
  const up = multer({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: 60 * 1024 * 1024, files: 1 } });
  const bag = kind => (req, res, next) => (req.file && app.locals.bagcheck ? app.locals.bagcheck.gate(kind)(req, res, next) : next());
  const t = (v, n) => { const s = String(v == null ? '' : v).replace(/<[^>]*>/g, '').trim().slice(0, n); return s || null; };
  const yr = v => { const m = /(\d{3,4})/.exec(String(v || '')); return m ? +m[1] : null; };
  const ymd = v => (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(v || '').trim()) ? String(v).trim() : t(v, 40));
  const token = () => crypto.randomBytes(16).toString('base64url');
  const day = s => { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T') + (String(s).length > 10 && !/Z$/.test(s) ? 'Z' : '')); return isNaN(d) ? String(s) : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
  const money = c => (c == null ? '' : '$' + Math.round(c / 100).toLocaleString('en-US'));

  // The registry number: WR, the year, the record, two check digits (as the Watermark number), so a mistyped number fails.
  const no = o => { const y = String(o.created_at || '').slice(0, 4) || String(new Date().getFullYear()); const b = y + String(o.id).padStart(6, '0'); const d = b + check(b); return `WR ${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8, 12)}`; };
  const byNo = s => { const d = String(s || '').replace(/[^0-9]/g, ''); if (d.length !== 12 || check(d.slice(0, 10)) !== d.slice(10)) return null; const o = obj(+d.slice(4, 10)); return o && String(o.created_at || '').startsWith(d.slice(0, 4)) ? o : null; };
  const noPath = o => no(o).replace(/\s+/g, '').slice(2);

  const obj = id => db.prepare('SELECT * FROM objects WHERE id=?').get(Number(id));
  const events = o => db.prepare('SELECT * FROM object_events WHERE object_id=? ORDER BY id').all(o.id);
  // What stands: an entry corrected by a later one gives way to it.
  const standing = ev => { const gone = new Set(ev.filter(e => e.corrects).map(e => e.corrects)); return ev.filter(e => !gone.has(e.id)); };
  const keysOf = req => { const k = []; const b = buyerOf(req); if (b) k.push(`b:${b.id}`); const m = makerOf(req); if (m) k.push(`m:${m.id}`); return k; };
  const nameOf = key => { if (key === 'house') return 'the house'; const [k, id] = String(key).split(':'); const r = k === 'm' ? db.prepare('SELECT name FROM makers WHERE id=?').get(+id) : db.prepare('SELECT name, email FROM buyers WHERE id=?').get(+id); return (r && (r.name || (r.email ? r.email.split('@')[0] : ''))) || 'the owner'; };
  const emailOf = key => { if (key === 'house') return null; const [k, id] = String(key).split(':'); const r = k === 'm' ? db.prepare('SELECT email FROM makers WHERE id=?').get(+id) : db.prepare('SELECT email FROM buyers WHERE id=?').get(+id); return r && r.email; };
  const custodianOf = req => { const m = makerOf(req); return m && m.kind === 'custodian' ? m : null; };
  const role = (req, o) => {
    if (keysOf(req).includes(o.owner)) return 'owner';
    if (isStudio(req)) return 'house';
    const c = custodianOf(req); if (c && o.custodian_id === c.id) return 'custodian';
    if (o.token && req.query.k) { try { const a = Buffer.from(String(req.query.k)), b = Buffer.from(o.token); if (a.length === b.length && crypto.timingSafeEqual(a, b)) return 'reader'; } catch (e) { /* */ } }
    if (o.public) return 'public';
    return null;
  };
  const sees = (r, e, o = {}) => r === 'owner' || r === 'house' || r === 'reader' || (r === 'custodian' && ['custody', 'condition', 'transfer'].includes(e.kind)) || (r === 'public' && e.public && (o.record_kind === 'collection' || !['acquired', 'custody', 'transfer', 'search'].includes(e.kind)));

  // Every entry is fingerprinted and laid on the register: the record cannot be quietly rewritten.
  function add(o, e) {
    const row = { object_id: o.id, kind: e.kind, on_date: e.on_date || null, year_from: e.year_from || null, year_to: e.year_to || null, party: e.party || null, how: e.how || null, place: e.place || null,
      body: e.body || null, source: e.source || null, result: e.result || null, price_cents: e.price_cents == null ? null : e.price_cents, file: e.file || null, mime: e.mime || null, file_sha: e.file_sha || null,
      by_kind: e.by_kind, by_name: e.by_name || null, public: e.public == null ? 1 : (e.public ? 1 : 0), corrects: e.corrects || null };
    const sha = crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
    const id = db.prepare(`INSERT INTO object_events (object_id, kind, on_date, year_from, year_to, party, how, place, body, source, result, price_cents, file, mime, file_sha, by_kind, by_name, public, corrects, sha)
      VALUES (@object_id,@kind,@on_date,@year_from,@year_to,@party,@how,@place,@body,@source,@result,@price_cents,@file,@mime,@file_sha,@by_kind,@by_name,@public,@corrects,@sha)`).run({ ...row, sha }).lastInsertRowid;
    let seq = null; try { seq = ledger.append(db, 'object.event', `object-${o.id}`, { event: id, kind: row.kind, sha, by: row.by_kind }).seq; } catch (x) { /* */ }
    db.prepare("UPDATE object_events SET seq=? WHERE id=?").run(seq, id);
    db.prepare("UPDATE objects SET updated_at=datetime('now') WHERE id=?").run(o.id);
    return db.prepare('SELECT * FROM object_events WHERE id=?').get(id);
  }
  // A paper: kept byte for byte, fingerprinted, in the house's disk and the vault.
  async function keep(o, file) {
    if (!file) return {};
    const buf = await fs.promises.readFile(file.path); const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const isPdf = buf.slice(0, 4).toString() === '%PDF'; const ext = isPdf ? 'pdf' : /png/.test(file.mimetype) ? 'png' : 'jpg';
    const key = `registry/${o.id}/${sha.slice(0, 16)}.${ext}`; const local = path.join(C.dataDir, key); fs.mkdirSync(path.dirname(local), { recursive: true });
    await fs.promises.rename(file.path, local).catch(async () => { await fs.promises.copyFile(file.path, local); fs.unlink(file.path, () => {}); });
    try { await store.put(key, local, isPdf ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`); } catch (e) { /* the disk keeps it; the vault follows */ }
    return { file: key, mime: isPdf ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`, file_sha: sha };
  }
  const tell = (key, title, body, href) => { if (key === 'house') return; const [k, id] = String(key).split(':'); if (app.locals.notify && app.locals.notify.tell) { try { app.locals.notify.tell({ [k === 'm' ? 'maker_id' : 'buyer_id']: +id, kind: 'registry', title, body, href }); } catch (e) { /* */ } } };

  // Ready for the desk: what a private sale (or an insurer, or a lender) would ask of the record, read from it.
  function ready(o, ev = standing(events(o))) {
    const of = k => ev.filter(e => e.kind === k); const recent = e => Date.now() - new Date(String(e.at).replace(' ', 'T') + 'Z').getTime() < YEAR;
    const acq = of('acquired').concat(of('transfer')); const prov = of('provenance');
    const old = (o.made_year || 9999) < 1946;
    const covers = (a, b) => prov.some(p => (p.year_from || 0) <= a && (p.year_to || 9999) >= b) || prov.filter(p => p.year_from && p.year_to).sort((x, y) => x.year_from - y.year_from).reduce((at, p) => (p.year_from <= at + 1 && p.year_to > at ? p.year_to : at), a - 1) >= b;
    const custody = of('custody').filter(e => e.by_kind === 'custodian' && e.result !== 'released');
    const pub = o.record_kind === 'collection';
    const attributed = o.artist && !/^the owner$/i.test(o.artist);
    return [
      { k: 'described', ok: !!(o.title && o.made && o.medium && (o.dims || pub) && (o.photo || o.work_id)), line: 'Described', why: 'Title, date, medium, dimensions and a photograph of record' },
      { k: 'title', ok: acq.some(e => e.file || e.kind === 'transfer' || (pub && e.source)), line: 'Title to the owner', why: 'How the present owner came to own it, with the paper (a bill of sale, a deed of gift, a probate record)' },
      { k: 'provenance', ok: prov.length > 0 && (!old || covers(1933, 1945)), line: old ? 'Provenance, 1933–1945 accounted for' : 'Provenance', why: old ? 'Who held it from the work’s making to now; the years 1933 to 1945 without a gap, as every serious buyer and museum asks' : 'Who held it before the present owner' },
      { k: 'custody', ok: custody.some(recent) || (pub && !!o.holder), line: 'Custody attested', why: 'A custodian’s attestation in the last year that it holds the work for this owner' },
      { k: 'condition', ok: of('condition').some(recent), line: 'Condition reported', why: 'A condition report in the last year, by a custodian or a conservator' },
      { k: 'opinion', ok: !attributed || of('opinion').length > 0, line: 'An expert’s opinion', why: 'For a work given to an artist: a signed opinion by an authority on that artist (a catalogue raisonné, a foundation, a scholar)' },
      { k: 'search', ok: of('search').some(e => e.result === 'clear' && recent(e)), line: 'Searched and clear', why: 'A search of a stolen-art register in the last year, with its certificate' },
    ];
  }

  // The pages.
  const shell = (title, body, path) => V.layout({ title: `${title} · The registry · Watermark`, path, body: `<main class="rgy">${body}</main>` });
  const dateWord = e => (e.year_from || e.year_to ? (e.year_from && e.year_to && e.year_from !== e.year_to ? `${e.year_from}–${e.year_to}` : `${e.year_from || ''}${!e.year_from && e.year_to ? `until ${e.year_to}` : ''}${e.year_from && !e.year_to ? ' to' : ''}`) : e.on_date ? day(e.on_date) : '');
  const photoOf = (o, r) => o.photo ? `/registry/o/${o.id}/photo${r === 'reader' ? `?k=${encodeURIComponent(o.token)}` : ''}` : o.work_id ? (() => { const w = db.prepare('SELECT slug FROM works WHERE id=?').get(o.work_id); return w ? `/img/${w.slug}/screen` : null; })() : null;
  function entry(o, e, r) {
    const [label] = KINDS[e.kind] || [e.kind];
    const bits = [e.party ? `<b>${esc(e.party)}</b>` : '', e.how ? esc(e.how) : '', e.place && (r === 'owner' || r === 'house' || r === 'custodian') ? esc(e.place) : '', e.result ? `<i>${esc(e.result)}</i>` : '', e.price_cents != null && (r === 'owner' || r === 'house') ? `${money(e.price_cents)} <small>(private)</small>` : ''].filter(Boolean).join(' · ');
    const by = { owner: 'Entered by the owner', custodian: `Attested by ${esc(e.by_name || 'the custodian')}`, expert: `Signed by ${esc(e.by_name || 'the expert')}`, house: `Entered by the house${e.by_name ? `, ${esc(e.by_name)}` : ''}`, contributor: `Added by ${esc(e.by_name || 'a contributor')}, accepted by the house` }[e.by_kind] || '';
    const file = e.file && r !== 'public' ? ` · <a href="/registry/o/${o.id}/file/${e.id}${r === 'reader' ? `?k=${encodeURIComponent(o.token)}` : ''}">The paper</a>` : '';
    return `<li class="rgy-e rgy-${esc(e.kind)}"><span class="rgy-d">${esc(dateWord(e))}</span><div><p class="rgy-k">${esc(label)}${e.corrects ? ' <small>(sets right an earlier entry)</small>' : ''}</p>${bits ? `<p>${bits}</p>` : ''}${e.body ? `<p>${esc(e.body)}</p>` : ''}${e.source ? `<p class="rgy-src">Source: ${/^https:\/\//.test(e.source) ? `<a href="${esc(e.source)}" rel="noopener">${esc(e.source)}</a>` : esc(e.source)}</p>` : ''}<p class="rgy-by">${by}${e.at ? ` · ${esc(day(e.at))}` : ''}${e.seq ? ` · on the register, No. ${e.seq}` : ''}${file}</p></div></li>`;
  }
  function record(o, r) {
    const all = standing(events(o)); const ev = all.filter(e => sees(r, e, o));
    const prov = ev.filter(e => ['provenance', 'acquired', 'transfer'].includes(e.kind)).sort((a, b) => (a.year_from || yr(a.on_date) || 9999) - (b.year_from || yr(b.on_date) || 9999) || a.id - b.id);
    const rest = ev.filter(e => !prov.includes(e));
    const ph = photoOf(o, r); const rd = ready(o, all); const n = rd.filter(x => x.ok).length;
    const cust = o.custodian_id ? db.prepare('SELECT name, handle FROM makers WHERE id=?').get(o.custodian_id) : null;
    const desk = r === 'owner' || r === 'house';
    return lot(o, r, { ev, prov, rest, ph, rd, n, cust }) + `
${o.record_kind === 'collection' ? knownBlock(o, r, rd, n) : ''}
${r !== 'public' && o.record_kind !== 'collection' ? `<section class="rgy-sec rgy-ready" id="ready"><h2>Ready for the desk <small>${n} of ${rd.length}</small></h2><p class="note">What a private sale, a lender or an insurer will ask of this record. Nothing here is offered for sale; it is the record made ready.</p><ul>${rd.map(x => `<li class="${x.ok ? 'rgy-ok' : ''}"><b>${x.ok ? '✓' : '○'} ${esc(x.line)}</b><span>${esc(x.why)}</span></li>`).join('')}</ul></section>` : ''}
${desk && (o.record_kind !== 'collection' || r === 'house') ? deskBlock(o, r) : ''}
<p class="rgy-foot">Every entry is fingerprinted and laid on the house’s signed register; none is ever edited, only set right by a later one. <a href="/registry/o/${o.id}/dossier.pdf${r === 'reader' ? `?k=${encodeURIComponent(o.token)}` : ''}">The dossier, as a PDF</a>${o.public ? ` · <a href="/r/${noPath(o)}">The public record</a>` : ''}</p>`;
  }
  // The record read like a great sale room's lot page (Will, 5 Nov, a Christie's lot: "take what's good"): the picture
  // large and steady beside the catalogue entry (the artist in capitals with the dates, the title in italic, the marks,
  // the medium, the size, when it was made), the facts at a glance, one way to ask the house, and below it the
  // catalogue's own sections in their order: provenance as a catalogue note (each line with its source behind it),
  // exhibited, literature, about the work, condition, then more by the same hand. No estimate and no price, ever.
  const HOUSE = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  const I = (() => { try { return require('./icons'); } catch (e) { return {}; } })();
  const viewsOf = o => db.prepare('SELECT * FROM object_views WHERE object_id=? ORDER BY n, id').all(o.id);
  // The size as written, read into centimetres (height × width): '43.2 × 36.2 cm', '17 × 14 ¼ in.', '61 x 50 cm'.
  const FR = { '¼': .25, '½': .5, '¾': .75, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875, '⅓': 1 / 3, '⅔': 2 / 3 };
  const num = s => { s = String(s).trim(); let v = 0; const m = /^(\d+(?:\.\d+)?)?\s*([¼½¾⅛⅜⅝⅞⅓⅔])?(?:\s+(\d+)\/(\d+))?$/.exec(s); if (!m) return NaN; if (m[1]) v += +m[1]; if (m[2]) v += FR[m[2]]; if (m[3]) v += m[3] / m[4]; return v || NaN; };
  function cmOf(dims) {
    const d = String(dims || '').replace(/,/g, '.');
    const pair = '([\\d.]+(?:\\s*[¼½¾⅛⅜⅝⅞⅓⅔])?(?:\\s+\\d+/\\d+)?)\\s*[x×]\\s*([\\d.]+(?:\\s*[¼½¾⅛⅜⅝⅞⅓⅔])?(?:\\s+\\d+/\\d+)?)';
    let m = new RegExp(pair + '\\s*(?:x\\s*[\\d.]+\\s*)?cm', 'i').exec(d);
    if (m) { const h = num(m[1]), w = num(m[2]); if (h > 0 && w > 0) return { h, w }; }
    m = new RegExp(pair + '\\s*(?:x\\s*[\\d.]+\\s*)?(?:in\\b|in\\.|inches|")', 'i').exec(d);
    if (m) { const h = num(m[1]) * 2.54, w = num(m[2]) * 2.54; if (h > 0 && w > 0) return { h, w }; }
    return null;
  }
  // The work drawn to scale on a wall above a sofa (210 cm), as a buyer would stand before it at home.
  function wallOf(o, ph) {
    let c = null; try { const m = o.cm ? JSON.parse(o.cm) : null; if (m && m.h && m.w) c = { h: m.h, w: m.w }; } catch (e) { /* */ } c = c || cmOf(o.dims); if (!c || c.h > 1200 || c.w > 1200) return '';
    const SOFA = 210, SOFA_H = 82, EYE = 152;
    const W = Math.max(340, c.w * 1.6 + 40), floorTop = Math.max(c.h / 2 + EYE + 30, 240);
    const H = floorTop; const bottom = Math.max(EYE - c.h / 2, SOFA_H + 18);
    const pct = (v, of) => (v / of * 100).toFixed(3);
    const ft = cm => { const i = Math.round(cm / 2.54); return `${Math.floor(i / 12)} ft ${i % 12} in`; };
    return `<div class="rgy-wall" style="aspect-ratio:${W.toFixed(1)}/${H.toFixed(1)}">${ph ? `<img class="rgy-wall-w" src="${esc(ph)}" alt="" loading="lazy" style="width:${pct(c.w, W)}%;height:${pct(c.h, H)}%;left:${pct((W - c.w) / 2, W)}%;bottom:${pct(bottom, H)}%">` : `<span class="rgy-wall-w rgy-wall-0" style="width:${pct(c.w, W)}%;height:${pct(c.h, H)}%;left:${pct((W - c.w) / 2, W)}%;bottom:${pct(bottom, H)}%"></span>`}<span class="rgy-wall-s" style="width:${pct(SOFA, W)}%;height:${pct(SOFA_H, H)}%;left:${pct((W - SOFA) / 2, W)}%"></span></div>
<p class="note">Drawn to scale from the dimensions on the record: ${Math.round(c.h)} × ${Math.round(c.w)} cm (${ft(c.h)} × ${ft(c.w)}), hung at eye level above a sofa ${SOFA} cm wide.</p>`;
  }
  // Before and after, among the artist's public records (the lot's own neighbours).
  function navOf(o, r) {
    if (!o.public || !o.artist_id) return '';
    const list = db.prepare("SELECT id, title, made_year FROM objects WHERE artist_id=? AND public=1 AND status='recorded' ORDER BY made_year, id").all(o.artist_id);
    if (list.length < 2) return '';
    const i = list.findIndex(x => x.id === o.id); if (i < 0) return '';
    const go = x => { const ob = obj(x.id); return ob ? `/r/${noPath(ob)}` : '#'; };
    const pv = list[(i - 1 + list.length) % list.length], nx = list[(i + 1) % list.length];
    return `<nav class="rgy-nav"><a href="${esc(go(pv))}" title="${esc(tidy(pv.title))}">‹ Before</a><span>${i + 1} of ${list.length}${o.artist ? ` by ${esc(o.artist)}` : ''}</span><a href="${esc(go(nx))}" title="${esc(tidy(nx.title))}">Next ›</a></nav>`;
  }
  // The person who answers for the record: the house's director, in the director's own name (a draft).
  function keptBy() {
    const D = app.locals.director; const m = D && D.house ? D.house() : null; if (!m) return null;
    return ask => `<div class="rgy-kept"><p class="k">Kept by</p><div>${m.portrait ? `<img src="/portrait/${esc(m.handle)}" alt="">` : ''}<span><b>${esc(m.name)}</b><small>${esc(D.TITLE)}, the registry</small><a href="${esc(ask)}">${esc(HOUSE)}</a></span></div></div>`;
  }
  const ZOOM_JS = `<script>(()=>{const lot=document.querySelector('[data-rgy-lot]');if(!lot)return;const dlg=document.querySelector('[data-rgy-zm]'),st=dlg&&dlg.querySelector('[data-rgy-zm-st]'),im=dlg&&dlg.querySelector('[data-rgy-zm-img]');let s=1,x=0,y=0;const P=new Map();let d0=0,s0=1;const ap=()=>{im.style.transform='translate('+x+'px,'+y+'px) scale('+s+')'};const clamp=()=>{s=Math.max(1,Math.min(8,s));if(s===1){x=0;y=0}};const open=src=>{if(!dlg)return;s=1;x=0;y=0;ap();im.src=src;dlg.showModal()};document.addEventListener('click',e=>{const z=e.target.closest('[data-rgy-zoom]');if(z){e.preventDefault();open(z.dataset.rgyZoom)}const v=e.target.closest('[data-rgy-view]');if(v){const m=lot.querySelector('[data-rgy-main]');m.src=v.dataset.rgyView;m.closest('[data-rgy-zoom]').dataset.rgyZoom=v.dataset.rgyBig;lot.querySelectorAll('[data-rgy-view]').forEach(b=>b.classList.toggle('on',b===v))}if(e.target.closest('[data-rgy-zm-close]'))dlg.close();if(e.target.closest('[data-rgy-zm-in]')){s*=1.6;clamp();ap()}if(e.target.closest('[data-rgy-zm-out]')){s/=1.6;clamp();ap()}});if(!st)return;st.addEventListener('wheel',e=>{e.preventDefault();const r=st.getBoundingClientRect(),cx=e.clientX-r.left-r.width/2,cy=e.clientY-r.top-r.height/2,k=Math.exp(-e.deltaY*0.0022),ns=Math.max(1,Math.min(8,s*k));x=cx-(cx-x)*ns/s;y=cy-(cy-y)*ns/s;s=ns;clamp();ap()},{passive:false});st.addEventListener('dblclick',e=>{const r=st.getBoundingClientRect(),cx=e.clientX-r.left-r.width/2,cy=e.clientY-r.top-r.height/2;if(s>1){s=1;x=0;y=0}else{x=-cx*1.5;y=-cy*1.5;s=2.5}ap()});st.addEventListener('pointerdown',e=>{st.setPointerCapture(e.pointerId);P.set(e.pointerId,{x:e.clientX,y:e.clientY});if(P.size===2){const [a,b]=[...P.values()];d0=Math.hypot(a.x-b.x,a.y-b.y);s0=s}});st.addEventListener('pointermove',e=>{const p=P.get(e.pointerId);if(!p)return;if(P.size===2){P.set(e.pointerId,{x:e.clientX,y:e.clientY});const [a,b]=[...P.values()];const d=Math.hypot(a.x-b.x,a.y-b.y);if(d0){s=s0*d/d0;clamp();ap()}return}if(s>1){x+=e.clientX-p.x;y+=e.clientY-p.y;ap()}P.set(e.pointerId,{x:e.clientX,y:e.clientY})});const end=e=>{P.delete(e.pointerId);if(P.size<2)d0=0};st.addEventListener('pointerup',end);st.addEventListener('pointercancel',end);dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close()});const mini=document.querySelector('[data-rgy-mini]'),head=lot.querySelector('h1');if(mini&&head&&'IntersectionObserver' in window)new IntersectionObserver(es=>{mini.hidden=es[0].isIntersecting||es[0].boundingClientRect.top>0}).observe(head)})();</script>`;
  function lot(o, r, { ev, prov, rest, ph, rd, n, cust }) {
    const a = o.artist_id ? db.prepare('SELECT slug, name, born, died, nationality FROM artists WHERE id=?').get(o.artist_id) : null;
    const w = o.work_id ? db.prepare('SELECT slug, title, caption FROM works WHERE id=?').get(o.work_id) : null;
    const life = a && (a.born || a.died) ? `(${a.born && a.died ? `${a.born}–${a.died}` : a.born ? `b. ${a.born}` : `d. ${a.died}`})` : '';
    const artistLine = o.artist ? `<p class="rgy-art">${a ? `<a href="/art/${esc(a.slug)}">${esc(o.artist)}</a>` : esc(o.artist)}${life ? ` <span>${esc(life)}</span>` : ''}</p>` : '';
    const madeLine = o.made ? (/^\d{3,4}$/.test(String(o.made).trim()) ? `Made in ${esc(o.made)}` : `Made ${esc(o.made)}`) : '';
    const tomb = [o.classification ? esc(o.classification) : '', o.marks ? esc(o.marks) : '', o.medium ? esc(o.medium) : '', o.dims ? esc(o.dims) : '', madeLine].filter(Boolean).map(x => `<span>${x}</span>`).join('');
    const exh = rest.filter(e => e.kind === 'exhibited').sort((x, y) => (x.year_from || 9999) - (y.year_from || 9999));
    const lit = rest.filter(e => e.kind === 'published').sort((x, y) => (x.year_from || 9999) - (y.year_from || 9999));
    const cond = rest.filter(e => e.kind === 'condition');
    const other = rest.filter(e => !['exhibited', 'published', 'condition'].includes(e.kind));
    const big = w ? `/w/${esc(w.slug)}` : null;
    const zoom = w ? `/img/${esc(w.slug)}/wall` : ph;
    const glance = [[`Provenance`, prov.length ? `${prov.length} ${prov.length === 1 ? 'line' : 'lines'}` : 'not yet known', '#provenance'], exh.length ? ['Exhibited', `${exh.length}`, '#exhibited'] : null, lit.length ? ['Literature', `${lit.length}`, '#literature'] : null,
      r !== 'public' && o.record_kind !== 'collection' ? ['Ready for the desk', `${n} of ${rd.length}`, '#ready'] : null].filter(Boolean);
    const holder = o.record_kind === 'collection' ? holdLine(o) : r !== 'public' ? `<p class="rgy-meta">${r === 'owner' ? 'Yours' : `Owned by ${esc(nameOf(o.owner))}`}${cust ? ` · held by ${esc(cust.name)}` : ''}</p>` : '<p class="rgy-meta">Owner and place are kept private.</p>';
    const pubUrl = `${C.base}/r/${noPath(o)}`;
    const ask = `mailto:${HOUSE}?subject=${encodeURIComponent(`${no(o)} · ${tidy(o.title)}`)}`;
    // Provenance as the catalogue sets it: one line a hand, oldest first, "; " between what is said of each.
    const noteLine = e => [e.party ? esc(e.party) : (e.kind === 'acquired' ? 'The present owner' : ''), e.place && r !== 'public' ? esc(e.place) : '', dateWord(e), e.how && e.how !== 'unknown' ? (/^(by|from|at|in) /i.test(e.how) ? esc(e.how) : e.kind === 'acquired' || e.kind === 'transfer' ? `acquired by ${esc(e.how)}` : `by ${esc(e.how)}`) : ''].filter(Boolean).join(', ');
    const FROM = /^(purchase|auction|exchange|gift|bequest)$/;
    const note = prov.map((e, i) => {
      const prev = i > 0;
      if (e.kind === 'acquired' && !e.party && prev) return `Acquired from the above by the present owner${e.on_date ? `, ${esc(day(e.on_date))}` : ''}.`;
      if (prev && e.how && FROM.test(e.how) && e.party) {
        const when = e.on_date ? `, ${esc(day(e.on_date))}` : e.year_from ? `, ${e.year_from}` : '';
        const tail = e.year_to && e.year_to !== e.year_from ? `; until ${e.year_to}` : '';
        return `${esc(e.party)}${e.place && r !== 'public' ? `, ${esc(e.place)}` : ''} (acquired from the above${e.how === 'auction' ? ' at auction' : e.how === 'gift' ? ' as a gift' : e.how === 'bequest' ? ' by bequest' : e.how === 'exchange' ? ' by exchange' : ''}${when}${tail}).`;
      }
      const l = noteLine(e); return l ? `${l}.` : '';
    }).filter(Boolean);
    const plain = e => [e.party ? esc(e.party) : '', e.year_from && e.year_to && e.year_to !== e.year_from ? `${e.year_from}–${e.year_to}` : (e.year_from || e.year_to || (e.on_date ? day(e.on_date) : '')), e.body ? esc(e.body) : ''].filter(x => x !== '' && x != null).join(', ');
    const sec = (id, title, inner) => `<section class="rgy-sec rgy-ls" id="${id}"><h2>${title}</h2>${inner}</section>`;
    const tabs = [['provenance', 'Provenance'], exh.length && ['exhibited', 'Exhibited'], lit.length && ['literature', 'Literature'], (o.description || (w && w.caption)) && ['about', 'About the work'], cond.length && ['condition', 'Condition'], other.length && ['record', 'The record']].filter(Boolean);
    const more = o.artist_id ? db.prepare("SELECT * FROM objects WHERE artist_id=? AND id<>? AND public=1 AND status='recorded' ORDER BY (photo IS NULL AND work_id IS NULL), made_year, id LIMIT 8").all(o.artist_id, o.id) : [];
    // More views of the object (verso, signature, labels), each to look at closely; the first is the photograph of record.
    const k = r === 'reader' ? `?k=${encodeURIComponent(o.token)}` : '';
    const views = (ph ? [{ src: ph, big: zoom, line: 'The work' }] : []).concat(viewsOf(o).map(v => ({ id: v.id, src: `/registry/o/${o.id}/view/${v.id}${k}`, big: `/registry/o/${o.id}/view/${v.id}${k}`, line: v.line || 'Another view' })));
    const nav = navOf(o, r);
    const kept = keptBy();
    const scale = wallOf(o, ph);
    return `${nav}<article class="rgy-lot" data-rgy-lot>
<div class="rgy-lot-p">${ph ? `<figure class="rgy-ph"><button type="button" class="rgy-zbtn" data-rgy-zoom="${esc(zoom)}" title="Look closely"><img src="${esc(ph)}" alt="${esc(tidy(o.title))}" data-rgy-main></button></figure>
${views.length > 1 ? `<div class="rgy-views">${views.map((v, i) => `<button type="button" class="${i ? '' : 'on'}" data-rgy-view="${esc(v.src)}" data-rgy-big="${esc(v.big)}" title="${esc(v.line)}"><img src="${esc(v.src)}" alt="" loading="lazy"><span>${esc(v.line)}</span></button>`).join('')}</div>` : ''}
<p class="rgy-zoom"><button type="button" class="rgy-zl" data-rgy-zoom="${esc(zoom)}">${I.look || ''}Look closely</button>${scale ? `<a class="rgy-zl" href="#wall">${I.hang || ''}On a wall, to scale</a>` : ''}${big ? `<a class="rgy-zl" href="${big}">${I.wave || ''}At Watermark</a>` : ''}</p>` : '<figure class="rgy-ph rgy-ph0"><span>Known to exist; no photograph on the record yet.</span></figure>'}</div>
<div class="rgy-lot-t"><p class="k">The registry · <span class="rgy-no">${esc(no(o))}</span></p>
${o.from_line ? `<p class="rgy-from">${esc(o.from_line)}</p>` : ''}${artistLine}<h1>${esc(tidy(o.title))}</h1>
${tomb ? `<p class="rgy-tomb">${tomb}</p>` : ''}
${holder}
${glance.length ? `<dl class="rgy-gl">${glance.map(([k, v, h]) => `<div><dt><a href="${h}">${esc(k)}</a></dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
<p class="rgy-acts">${o.public ? `<button type="button" class="rgy-act rgy-share" data-send data-send-title="${esc(tidy(o.title))}" data-send-url="${esc(pubUrl)}">Share</button>` : ''}<a class="rgy-act" href="/registry/o/${o.id}/dossier.pdf${r === 'reader' ? `?k=${encodeURIComponent(o.token)}` : ''}">The dossier</a><a class="rgy-act" href="${esc(ask)}">Ask the house about this work</a></p>
<p class="rgy-fine">The registry keeps what owners, custodians, museums and experts enter and says who entered each line. It does not appraise, authenticate or guarantee title, and nothing here is for sale.</p>${kept ? kept(ask) : ''}</div></article>
<div class="rgy-mini" data-rgy-mini hidden><div><b>${esc(tidy(o.title))}</b><span>${esc(o.artist || '')}</span></div><a class="rgy-act" href="${esc(ask)}">Ask the house</a></div>
<dialog class="rgy-zm" data-rgy-zm><div class="rgy-zm-st" data-rgy-zm-st><img alt="${esc(tidy(o.title))}" data-rgy-zm-img draggable="false"></div><p class="rgy-zm-bar"><span>${esc(tidy(o.title))}${o.artist ? ` · ${esc(o.artist)}` : ''}</span><button type="button" data-rgy-zm-in aria-label="Closer">+</button><button type="button" data-rgy-zm-out aria-label="Further">−</button><button type="button" data-rgy-zm-close>Close</button></p></dialog>
${ZOOM_JS}
${tabs.length > 1 ? `<nav class="rgy-tabs">${tabs.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}</nav>` : ''}
${sec('provenance', 'Provenance', note.length ? `<div class="rgy-note">${note.map(x => `<p>${x}</p>`).join('')}</div><details class="rgy-each"${r === 'owner' || r === 'house' ? ' open' : ''}><summary>Each line, with who entered it and its source</summary><ol class="rgy-l">${prov.map(e => entry(o, e, r)).join('')}</ol></details>` : '<p class="note">Nothing entered yet.</p>')}
${exh.length ? sec('exhibited', 'Exhibited', `<div class="rgy-note">${exh.map(e => `<p>${plain(e)}</p>`).join('')}</div><details class="rgy-each"><summary>With their sources</summary><ol class="rgy-l">${exh.map(e => entry(o, e, r)).join('')}</ol></details>`) : ''}
${lit.length ? sec('literature', 'Literature', `<div class="rgy-note">${lit.map(e => `<p>${plain(e)}</p>`).join('')}</div><details class="rgy-each"><summary>With their sources</summary><ol class="rgy-l">${lit.map(e => entry(o, e, r)).join('')}</ol></details>`) : ''}
${o.description || (w && w.caption) ? sec('about', 'About the work', `<div class="rgy-essay">${String(o.description || w.caption).split(/\n{2,}/).slice(0, 6).map(p => `<p>${esc(p)}</p>`).join('')}</div>${w ? `<p><a href="${big}#closer">Look closer</a></p>` : ''}`) : ''}
${scale ? sec('wall', 'On a wall, to scale', scale) : ''}
${cond.length ? sec('condition', 'Condition', `<ol class="rgy-l">${cond.map(e => entry(o, e, r)).join('')}</ol>`) : ''}
${other.length ? sec('record', 'The record', `<ol class="rgy-l">${other.map(e => entry(o, e, r)).join('')}</ol>`) : ''}
${more.length ? sec('more', `More by ${esc(o.artist || 'the same hand')}`, `<div class="rgy-g">${more.map(x => { const p2 = photoOf(x, 'public'); return `<a class="rgy-c" href="/r/${noPath(x)}">${p2 ? `<img src="${esc(p2)}" alt="" loading="lazy">` : '<span class="rgy-blank"></span>'}<b>${esc(tidy(x.title))}</b><small>${esc(x.made || '')}</small></a>`; }).join('')}</div>${a ? `<p><a href="/art/${esc(a.slug)}">Everything by ${esc(a.name)} in the house</a></p>` : ''}`) : ''}`;
  }
  function deskBlock(o) {
    const sel = (n, list) => `<select name="${n}">${list.map(v => `<option value="${esc(v)}">${esc(v[0].toUpperCase() + v.slice(1))}</option>`).join('')}</select>`;
    const f = (kind, inner, files = true) => `<details class="rgy-add"><summary>${esc(KINDS[kind][0])} <span>${esc(KINDS[kind][1])}</span></summary><form method="post" action="/registry/o/${o.id}/event" enctype="multipart/form-data"><input type="hidden" name="kind" value="${kind}">${inner}${files ? '<label>The paper (PDF or a photograph)<input type="file" name="file" accept="application/pdf,image/*"></label>' : ''}<label>Source or reference<input name="source" maxlength="300"></label><label>A note<textarea name="body" rows="2" maxlength="2000"></textarea></label><button class="buy-btn">Enter it</button></form></details>`;
    const xfer = db.prepare("SELECT * FROM object_transfers WHERE object_id=? AND status='offered' ORDER BY id DESC LIMIT 1").get(o.id);
    return `<section class="rgy-sec rgy-desk"><h2>Add to the record</h2>
${f('provenance', `<label>Whose hands<input name="party" maxlength="200" required></label><div class="rgy-row"><label>From (year)<input name="year_from" inputmode="numeric"></label><label>To (year)<input name="year_to" inputmode="numeric"></label><label>How it came to them${sel('how', HOW)}</label></div><label>Where<input name="place" maxlength="160"></label>`)}
${f('acquired', `<label>From whom<input name="party" maxlength="200"></label><div class="rgy-row"><label>When<input name="on_date" type="date"></label><label>How${sel('how', HOW)}</label><label>Price paid (private)<input name="price" inputmode="decimal"></label></div>`)}
${f('condition', `<label>By whom<input name="party" maxlength="200" placeholder="A conservator, the custodian, the owner"></label><label>On<input name="on_date" type="date"></label><label>Condition<select name="result"><option>Excellent</option><option>Good</option><option>Fair</option><option>Needs care</option></select></label>`)}
${f('opinion', `<label>The expert or authority<input name="party" maxlength="200" required placeholder="A catalogue raisonné, a foundation, a scholar"></label><label>On<input name="on_date" type="date"></label><label>Their conclusion<input name="result" maxlength="200" placeholder="By the artist; studio of; attributed to; not by"></label>`)}
${f('exhibited', `<label>The show, the place<input name="party" maxlength="200" required></label><div class="rgy-row"><label>From (year)<input name="year_from" inputmode="numeric"></label><label>To (year)<input name="year_to" inputmode="numeric"></label></div>`, false)}
${f('published', `<label>The book, the page or plate<input name="party" maxlength="300" required></label><label>Year<input name="year_from" inputmode="numeric"></label>`, false)}
${f('search', `<label>The register searched<input name="party" maxlength="200" required placeholder="The Art Loss Register, Interpol, the FBI's National Stolen Art File"></label><label>On<input name="on_date" type="date"></label><label>Result<select name="result"><option value="clear">Clear</option><option value="match">A match</option></select></label>`)}
${f('note', '', true)}
<details class="rgy-add"><summary>The custodian <span>Who holds it; they attest receipt and condition themselves</span></summary><form method="post" action="/registry/o/${o.id}/custodian"><label>The custodian’s handle on Watermark<input name="handle" maxlength="80" placeholder="e.g. a freeport or art store with a custodian account"></label><button class="buy-btn">Name them</button><small>A custodian not yet on Watermark: write to the house and we open their door.</small></form></details>
<details class="rgy-add"><summary>Describe it again <span>Title, date, medium, dimensions, the photograph of record</span></summary><form method="post" action="/registry/o/${o.id}/edit" enctype="multipart/form-data">${describe(o)}<button class="buy-btn">Save</button><small>The description can be set right; the history cannot.</small></form></details>
<details class="rgy-add"><summary>More views <span>The back, the signature, the labels, the frame</span></summary><form method="post" action="/registry/o/${o.id}/view" enctype="multipart/form-data"><label>The photograph<input type="file" name="file" accept="image/*" required></label><label>What it shows<input name="line" maxlength="80" placeholder="Verso; Signature, lower right; Dealer’s label on the stretcher"></label><button class="buy-btn">Add the view</button></form>${(() => { const vs = viewsOf(o); return vs.length ? `<ul class="rgy-vl">${vs.map(v => `<li><img src="/registry/o/${o.id}/view/${v.id}" alt=""><span>${esc(v.line || 'Another view')}</span><form method="post" action="/registry/o/${o.id}/view/${v.id}/remove"><button>Take it off</button></form></li>`).join('')}</ul>` : ''; })()}</details>
<details class="rgy-add"><summary>How it is introduced <span>${o.from_line ? esc(o.from_line) : 'A line above the artist, as a sale room writes it'}</span></summary><form method="post" action="/registry/o/${o.id}/from"><label>The line<input name="from_line" maxlength="120" value="${esc(o.from_line || '')}" placeholder="From a private collection, Dallas"></label><button class="buy-btn">Save</button><small>It never names you unless you write your name.</small></form></details>
<details class="rgy-add"><summary>Who can see it <span>${o.public ? 'The object is public; the owner and place never are' : 'Private'}</span></summary><form method="post" action="/registry/o/${o.id}/share"><label class="rgy-ck"><input type="checkbox" name="public" value="1"${o.public ? ' checked' : ''}> Show the object on the public registry (what it is, its provenance, its shows and books; never the owner, the place, the price or the papers)</label><button class="buy-btn">Save</button></form>
${o.token ? `<p class="note">A reader’s link (an insurer, a scholar, a buyer you are speaking with) shows the whole record and the papers: <input readonly value="${esc(`${C.base}/registry/o/${o.id}?k=${o.token}`)}" onfocus="this.select()"></p>` : ''}<form method="post" action="/registry/o/${o.id}/share"><input type="hidden" name="link" value="1"><button>${o.token ? 'A new link (the old one stops working)' : 'Make a reader’s link'}</button></form></details>
<details class="rgy-add"><summary>Pass the title <span>To a new owner, by both your hands</span></summary>${xfer ? `<p class="note">Offered to ${esc(xfer.email)} on ${esc(day(xfer.at))}. <form method="post" action="/registry/o/${o.id}/transfer"><input type="hidden" name="cancel" value="1"><button>Take it back</button></form></p>` : `<form method="post" action="/registry/o/${o.id}/transfer"><label>Their email<input name="email" type="email" required></label><label>A word<input name="note" maxlength="300"></label><label class="rgy-ck"><input type="checkbox" name="attest" value="1" required> The work is theirs by an agreement made between us; the registry records the change of title, nothing more</label><button class="buy-btn">Offer the title</button></form><p class="note">No money moves here and the house judges no sale. The record, the papers and the custodian’s care go with it once they accept.</p>`}</details></section>`;
  }
  const describe = (o = {}) => `<label>Title<input name="title" maxlength="200" required value="${esc(o.title || '')}"></label><div class="rgy-row"><label>Artist<input name="artist" maxlength="160" value="${esc(o.artist || '')}" placeholder="Or ‘Unknown’, ‘Circle of…’, ‘After…’"></label><label>Date made<input name="made" maxlength="60" value="${esc(o.made || '')}" placeholder="1642, c. 1890, 1660s"></label></div>
<div class="rgy-row"><label>Medium<input name="medium" maxlength="160" value="${esc(o.medium || '')}" placeholder="Oil on canvas"></label><label>Dimensions<input name="dims" maxlength="120" value="${esc(o.dims || '')}" placeholder="61 × 50 cm"></label></div>
<label>Marks, inscriptions, labels<input name="marks" maxlength="400" value="${esc(o.marks || '')}" placeholder="Signed lower right; a dealer’s label on the stretcher"></label><label>A description<textarea name="description" rows="2" maxlength="2000">${esc(o.description || '')}</textarea></label><label>The photograph of record<input type="file" name="file" accept="image/*"></label>`;

  async function setPhoto(o, file) {
    if (!file) return;
    const key = `registry/${o.id}/photo-${crypto.randomBytes(4).toString('hex')}.jpg`; const local = path.join(C.dataDir, key); fs.mkdirSync(path.dirname(local), { recursive: true });
    try { await require('sharp')(file.path).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toFile(local); db.prepare('UPDATE objects SET photo=? WHERE id=?').run(key, o.id); try { await store.put(key, local, 'image/jpeg'); } catch (e) { /* */ } } catch (e) { /* not a picture */ }
    fs.unlink(file.path, () => {});
  }
  const fields = b => ({ title: t(b.title, 200), artist: t(b.artist, 160), made: t(b.made, 60), made_year: yr(b.made), medium: t(b.medium, 160), dims: t(b.dims, 120), marks: t(b.marks, 400), description: t(b.description, 2000) });
  function create(owner, b, from = {}) {
    const f = fields(b); if (!f.title) return null;
    const id = db.prepare('INSERT INTO objects (owner, title, artist, made, made_year, medium, dims, marks, description, work_id, cabinet_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(owner, f.title, f.artist, f.made, f.made_year, f.medium, f.dims, f.marks, f.description, from.work_id || null, from.cabinet_id || null).lastInsertRowid;
    const o = obj(id);
    if (f.artist && app.locals.art && app.locals.art.ensure) { try { const a = app.locals.art.ensure(f.artist); if (a) db.prepare('UPDATE objects SET artist_id=? WHERE id=?').run(a.id, id); } catch (e) { /* */ } }
    try { ledger.append(db, 'object.recorded', `object-${id}`, { no: no(o) }); } catch (e) { /* */ }
    return obj(id);
  }
  const deny = (req, res) => { if (!keysOf(req).length && !isStudio(req)) return res.redirect(`/signin?next=${encodeURIComponent(req.originalUrl)}`); return res.sendStatus(404); };

  // The public door.
  app.get('/registry', (req, res) => {
    const q = t(req.query.q, 80);
    const list = q ? db.prepare("SELECT * FROM objects WHERE public=1 AND status='recorded' AND (title LIKE ? OR artist LIKE ? OR holder LIKE ? OR accession LIKE ?) ORDER BY made_year, id LIMIT 120").all(...Array(4).fill(`%${q}%`))
      : db.prepare("SELECT * FROM objects WHERE public=1 AND status='recorded' AND record_kind='private' ORDER BY updated_at DESC LIMIT 24").all().concat(db.prepare("SELECT * FROM objects WHERE public=1 AND status='recorded' AND record_kind='collection' AND (photo IS NOT NULL OR work_id IS NOT NULL) ORDER BY updated_at DESC LIMIT 36").all());
    const counts = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN work_id IS NULL AND photo IS NULL THEN 1 ELSE 0 END) unseen FROM objects WHERE public=1 AND status='recorded'").get();
    res.send(shell('The registry', `<header class="rgy-hero"><p class="k">The registry</p><h1>The record of a work, kept.</h1><p class="lede">Before a painting changes hands anywhere serious, five questions are asked: what it is, who owns it and how they came to, where it has been, where it is now and in what state, and whether anyone has a claim on it. The registry keeps the answers in one record, with the papers, every entry fingerprinted and laid on the house’s signed register.</p>
<p><a class="buy-btn" href="/yours/registry">Put a work on the registry</a> <a class="rgy-sub" href="#how">How it works</a></p></header>
<form class="rgy-q" method="get" action="/registry"><input name="q" value="${esc(q || '')}" placeholder="A title, an artist, a museum, an accession number"><button>Find</button></form>${+counts.n ? `<p class="note">${(+counts.n).toLocaleString('en-US')} records on the public registry${+counts.unseen ? `, ${(+counts.unseen).toLocaleString('en-US')} of them works known to exist with no open photograph yet` : ''}.</p>` : ''}
${list.length ? `<section class="rgy-sec"><h2>${q ? `Found for “${esc(q)}”` : 'On the public registry'}</h2><div class="rgy-g">${list.map(o => { const ph = photoOf(o, 'public'); return `<a class="rgy-c" href="/r/${noPath(o)}">${ph ? `<img src="${esc(ph)}" alt="" loading="lazy">` : '<span class="rgy-blank"></span>'}<b>${esc(tidy(o.title))}</b><small>${esc([o.artist, o.made].filter(Boolean).join(', '))}</small><small class="rgy-no">${esc(no(o))}</small></a>`; }).join('')}</div></section>` : ''}
<section class="rgy-sec" id="how"><h2>How it works</h2><ol class="rgy-how"><li><b>The owner records it.</b> What it is, a photograph of record, how they came to own it, and what is known of where it has been. Free, and private unless they choose.</li><li><b>The custodian attests.</b> A freeport, an art store or a registrar holding the work says so in its own name: received, in this condition, held for this owner.</li><li><b>Experts sign their own words.</b> An opinion on what it is sits in its author’s name, with the paper.</li><li><b>The record is never rewritten.</b> Each entry is fingerprinted and on the register; a mistake is set right by a later entry, and both stand.</li><li><b>Title passes by two hands.</b> The owner offers, the new owner accepts, and the record goes with the work. No money moves here.</li><li><b>Ready for the desk.</b> The record reads what a private sale, a lender or an insurer will ask, so the work is ready before anyone asks.</li></ol>
<p class="note">The registry records what owners, custodians and experts enter, and says who entered each line. It does not appraise, authenticate or guarantee title, and it is not a sale.</p></section>`, '/registry'));
  });
  app.get('/r/:no', (req, res) => {
    const o = byNo(req.params.no); if (!o || !o.public) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=300').send(shell(tidy(o.title), record(o, 'public'), '/registry'));
  });

  // The owner's desk.
  app.get('/yours/registry', (req, res) => {
    const keys = keysOf(req); if (!keys.length) return res.redirect('/signin?next=/yours/registry');
    const list = db.prepare(`SELECT * FROM objects WHERE owner IN (${keys.map(() => '?').join(',')}) AND status='recorded' ORDER BY updated_at DESC`).all(...keys);
    const b = buyerOf(req); const cab = b ? db.prepare('SELECT id, title, artist FROM cabinet WHERE buyer_id=? AND id NOT IN (SELECT cabinet_id FROM objects WHERE cabinet_id IS NOT NULL) ORDER BY id DESC LIMIT 40').all(b.id) : [];
    const offered = db.prepare("SELECT x.*, o.title FROM object_transfers x JOIN objects o ON o.id=x.object_id WHERE x.status='offered' AND lower(x.email)=lower(?)").all(String((b && b.email) || (makerOf(req) || {}).email || '-'));
    res.set('Cache-Control', 'private, no-store').send(shell('Your registry', `<p class="k"><a href="/yours">You</a></p><h1>Your registry</h1><p class="lede">The record of the physical works you own: what each is, how you came to own it, where it has been, who holds it, its condition, and the papers.</p>
${req.query.ok ? `<p class="ok">${esc({ taken: 'The title is yours; the record came with it.', made: 'Recorded.' }[req.query.ok] || req.query.ok)}</p>` : ''}
${offered.length ? `<section class="rgy-sec"><h2>Offered to you</h2>${offered.map(x => `<p><b>${esc(tidy(x.title))}</b> · <a class="buy-btn" href="/registry/take/${esc(x.token)}">See it and accept</a></p>`).join('')}</section>` : ''}
${list.length ? `<div class="rgy-g">${list.map(o => { const ph = photoOf(o, 'owner'); const rd = ready(o); return `<a class="rgy-c" href="/registry/o/${o.id}">${ph ? `<img src="${esc(ph)}" alt="" loading="lazy">` : '<span class="rgy-blank"></span>'}<b>${esc(tidy(o.title))}</b><small>${esc([o.artist, o.made].filter(Boolean).join(', '))}</small><small class="rgy-no">${esc(no(o))} · ready ${rd.filter(x => x.ok).length} of ${rd.length}</small></a>`; }).join('')}</div>` : '<p class="note">Nothing on the registry yet.</p>'}
<section class="rgy-sec"><h2>Put a work on the registry</h2><form method="post" action="/yours/registry" enctype="multipart/form-data" class="rgy-new">${describe()}<button class="buy-btn">Record it</button></form>
${cab.length ? `<form method="post" action="/yours/registry" class="rgy-new rgy-cab"><p class="note">Or from your cabinet, with what you wrote there:</p><select name="cabinet">${cab.map(c => `<option value="${c.id}">${esc(tidy(c.title))}${c.artist ? `, ${esc(c.artist)}` : ''}</option>`).join('')}</select><button>Record it</button></form>` : ''}</section>`, '/yours/registry'));
  });
  app.post('/yours/registry', up.single('file'), bag('image'), async (req, res) => {
    const keys = keysOf(req); if (!keys.length) return res.redirect('/signin?next=/yours/registry');
    const owner = keys[0]; const b = req.body || {};
    if (b.cabinet) {
      const bb = buyerOf(req); const c = bb && db.prepare('SELECT * FROM cabinet WHERE id=? AND buyer_id=?').get(+b.cabinet, bb.id); if (!c) return res.redirect('/yours/registry');
      const o = create(`b:${bb.id}`, { title: c.title, artist: c.artist, made: c.year, medium: c.medium, dims: c.dims, description: c.note }, { cabinet_id: c.id, work_id: c.work_id || null });
      const src = c.file ? path.join(C.dataDir, 'cabinet', path.basename(c.file)) : null; if (src && fs.existsSync(src)) { const tmp = path.join(C.dataDir, 'incoming', `cab-${c.id}-${Date.now()}`); fs.copyFileSync(src, tmp); await setPhoto(o, { path: tmp }); }
      if (c.acquired || c.from_whom || c.paid_cents != null) add(o, { kind: 'acquired', on_date: ymd(c.acquired), party: c.from_whom || null, price_cents: c.paid_cents == null ? null : c.paid_cents, by_kind: 'owner', public: 0, body: 'From the cabinet.' });
      if (c.provenance) add(o, { kind: 'note', body: `Provenance as written in the cabinet: ${c.provenance}`, by_kind: 'owner', public: 0 });
      if (c.condition) add(o, { kind: 'condition', result: c.condition, by_kind: 'owner', party: 'The owner', public: 0 });
      return res.redirect(`/registry/o/${o.id}?ok=made`);
    }
    const o = create(owner, b); if (!o) { if (req.file) fs.unlink(req.file.path, () => {}); return res.redirect('/yours/registry'); }
    await setPhoto(o, req.file);
    res.redirect(`/registry/o/${o.id}?ok=made`);
  });
  app.get('/registry/o/:id', (req, res) => {
    const o = obj(req.params.id); if (!o) return res.sendStatus(404);
    const r = role(req, o); if (!r) return deny(req, res);
    const ok = req.query.ok ? `<p class="ok">${esc({ made: 'Recorded. Now add what is known: how you came to own it, where it has been, who holds it.', entered: 'Entered, fingerprinted and on the register.', custodian: 'The custodian is named and told; their attestations will appear here.', nocust: 'No custodian by that handle. Write to the house and we open their door.', shared: 'Saved.', offered: 'Offered. The title passes when they accept.', saved: 'Saved.' }[req.query.ok] || req.query.ok)}</p>` : '';
    res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', 'noindex').send(shell(tidy(o.title), `${r === 'owner' ? '<p class="k"><a href="/yours/registry">Your registry</a></p>' : ''}${ok}${record(o, r)}`, '/yours/registry'));
  });
  app.get('/registry/o/:id/photo', (req, res) => {
    const o = obj(req.params.id); if (!o || !o.photo) return res.sendStatus(404); const r = role(req, o); if (!r) return res.sendStatus(404);
    const f = path.join(C.dataDir, o.photo); if (!fs.existsSync(f)) return res.sendStatus(404);
    res.set('Cache-Control', r === 'public' ? 'public, max-age=3600' : 'private, no-store').type('image/jpeg').sendFile(f);
  });
  app.get('/registry/o/:id/file/:eid', async (req, res) => {
    const o = obj(req.params.id); if (!o) return res.sendStatus(404); const r = role(req, o); if (!r || r === 'public') return res.sendStatus(404);
    const e = db.prepare('SELECT * FROM object_events WHERE id=? AND object_id=?').get(+req.params.eid, o.id); if (!e || !e.file || !sees(r, e, o)) return res.sendStatus(404);
    const f = path.join(C.dataDir, e.file);
    if (!fs.existsSync(f)) { try { await store.download(e.file, f); } catch (x) { return res.sendStatus(404); } }
    res.set('Cache-Control', 'private, no-store').type(e.mime || 'application/octet-stream').sendFile(f);
  });
  const ownerOnly = (req, res) => { const o = obj(req.params.id); if (!o) { res.sendStatus(404); return null; } const r = role(req, o); if (r !== 'owner' && r !== 'house') { res.sendStatus(403); return null; } return { o, r }; };
  app.post('/registry/o/:id/event', up.single('file'), bag('papers'), async (req, res) => {
    const x = ownerOnly(req, res); if (!x) { if (req.file) fs.unlink(req.file.path, () => {}); return; } const { o, r } = x; const b = req.body || {};
    const kind = KINDS[b.kind] && !['custody', 'transfer', 'correction'].includes(b.kind) ? b.kind : 'note';
    const paper = await keep(o, req.file);
    const price = b.price ? Math.round(parseFloat(String(b.price).replace(/[^0-9.]/g, '')) * 100) : null;
    add(o, { kind, on_date: ymd(b.on_date), year_from: yr(b.year_from), year_to: yr(b.year_to), party: t(b.party, 300), how: HOW.includes(b.how) ? b.how : null, place: t(b.place, 160), body: t(b.body, 2000), source: t(b.source, 300), result: t(b.result, 200), price_cents: Number.isFinite(price) ? price : null, ...paper, by_kind: r === 'house' ? 'house' : kind === 'opinion' ? 'owner' : 'owner', public: kind === 'acquired' || kind === 'search' ? 0 : 1, corrects: b.corrects ? +b.corrects : null });
    res.redirect(`/registry/o/${o.id}?ok=entered`);
  });
  app.post('/registry/o/:id/edit', up.single('file'), bag('image'), async (req, res) => {
    const x = ownerOnly(req, res); if (!x) { if (req.file) fs.unlink(req.file.path, () => {}); return; } const { o } = x; const f = fields(req.body || {});
    if (f.title) db.prepare("UPDATE objects SET title=?, artist=?, made=?, made_year=?, medium=?, dims=?, marks=?, description=?, updated_at=datetime('now') WHERE id=?").run(f.title, f.artist, f.made, f.made_year, f.medium, f.dims, f.marks, f.description, o.id);
    await setPhoto(o, req.file);
    try { ledger.append(db, 'object.described', `object-${o.id}`, {}); } catch (e) { /* */ }
    res.redirect(`/registry/o/${o.id}?ok=saved`);
  });
  app.post('/registry/o/:id/from', (req, res) => {
    const x = ownerOnly(req, res); if (!x) return; const { o } = x;
    db.prepare("UPDATE objects SET from_line=?, updated_at=datetime('now') WHERE id=?").run(t((req.body || {}).from_line, 120), o.id);
    res.redirect(`/registry/o/${o.id}?ok=saved`);
  });
  app.post('/registry/o/:id/view', up.single('file'), bag('image'), async (req, res) => {
    const x = ownerOnly(req, res); if (!x) { if (req.file) fs.unlink(req.file.path, () => {}); return; } const { o } = x;
    if (!req.file) return res.redirect(`/registry/o/${o.id}`);
    if (viewsOf(o).length >= 12) { fs.unlink(req.file.path, () => {}); return res.redirect(`/registry/o/${o.id}?ok=${encodeURIComponent('Twelve views is the most a record keeps.')}`); }
    const key = `registry/${o.id}/view-${crypto.randomBytes(5).toString('hex')}.jpg`; const local = path.join(C.dataDir, key); fs.mkdirSync(path.dirname(local), { recursive: true });
    try {
      await require('sharp')(req.file.path).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toFile(local);
      const n = (db.prepare('SELECT MAX(n) m FROM object_views WHERE object_id=?').get(o.id) || {}).m || 0;
      db.prepare('INSERT INTO object_views (object_id, n, file, line) VALUES (?,?,?,?)').run(o.id, n + 1, key, t((req.body || {}).line, 80));
      try { await store.put(key, local, 'image/jpeg'); } catch (e) { /* */ }
    } catch (e) { /* not a picture */ }
    fs.unlink(req.file.path, () => {});
    res.redirect(`/registry/o/${o.id}?ok=saved`);
  });
  app.post('/registry/o/:id/view/:vid/remove', (req, res) => {
    const x = ownerOnly(req, res); if (!x) return; const { o } = x;
    db.prepare('DELETE FROM object_views WHERE id=? AND object_id=?').run(+req.params.vid, o.id);
    res.redirect(`/registry/o/${o.id}?ok=saved`);
  });
  app.get('/registry/o/:id/view/:vid', async (req, res) => {
    const o = obj(req.params.id); if (!o) return res.sendStatus(404); const r = role(req, o); if (!r) return res.sendStatus(404);
    const v = db.prepare('SELECT * FROM object_views WHERE id=? AND object_id=?').get(+req.params.vid, o.id); if (!v) return res.sendStatus(404);
    const f = path.join(C.dataDir, v.file);
    if (!fs.existsSync(f)) { try { const buf = await store.get(v.file); if (!buf) return res.sendStatus(404); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); } catch (e) { return res.sendStatus(404); } }
    res.set('Cache-Control', r === 'public' ? 'public, max-age=3600' : 'private, no-store').type('image/jpeg').sendFile(f);
  });
  app.post('/registry/o/:id/share', (req, res) => {
    const x = ownerOnly(req, res); if (!x) return; const { o } = x;
    if (req.body.link) db.prepare('UPDATE objects SET token=? WHERE id=?').run(token(), o.id);
    else db.prepare('UPDATE objects SET public=? WHERE id=?').run(req.body.public ? 1 : 0, o.id);
    res.redirect(`/registry/o/${o.id}?ok=shared`);
  });
  app.post('/registry/o/:id/custodian', (req, res) => {
    const x = ownerOnly(req, res); if (!x) return; const { o } = x;
    const c = db.prepare("SELECT * FROM makers WHERE handle=? AND kind='custodian'").get(String(req.body.handle || '').trim().toLowerCase()); if (!c) return res.redirect(`/registry/o/${o.id}?ok=nocust`);
    db.prepare('UPDATE objects SET custodian_id=? WHERE id=?').run(c.id, o.id);
    add(o, { kind: 'note', body: `The owner named ${c.name} as the work’s custodian.`, by_kind: 'owner', public: 0 });
    tell(`m:${c.id}`, `${tidy(o.title)} is yours to attest`, `The owner names you as the custodian of ${no(o)}.`, '/account/custody');
    if (c.email) mail.send({ to: c.email, subject: `A work to attest: ${tidy(o.title)}`, text: `The owner of ${tidy(o.title)} (${no(o)}) names you as its custodian on Watermark's registry. When it is in your hands, attest receipt and condition at ${C.base}/account/custody.` }).catch(() => {});
    res.redirect(`/registry/o/${o.id}?ok=custodian`);
  });

  // Title, by two hands.
  app.post('/registry/o/:id/transfer', (req, res) => {
    const x = ownerOnly(req, res); if (!x) return; const { o } = x; const b = req.body || {};
    if (b.cancel) { db.prepare("UPDATE object_transfers SET status='withdrawn' WHERE object_id=? AND status='offered'").run(o.id); return res.redirect(`/registry/o/${o.id}?ok=saved`); }
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email || '').trim()) ? String(b.email).trim().slice(0, 160) : null; if (!email || !b.attest) return res.redirect(`/registry/o/${o.id}`);
    db.prepare("UPDATE object_transfers SET status='withdrawn' WHERE object_id=? AND status='offered'").run(o.id);
    const tk = token(); db.prepare('INSERT INTO object_transfers (object_id, from_owner, email, token, note) VALUES (?,?,?,?,?)').run(o.id, o.owner, email, tk, t(b.note, 300));
    mail.send({ to: email, subject: `${nameOf(o.owner)} offers you the title to ${tidy(o.title)}`, cta: { label: 'See the record', url: `${C.base}/registry/take/${tk}` }, text: `${nameOf(o.owner)} offers you the title to ${tidy(o.title)} on Watermark's registry (${no(o)}).${b.note ? `\n\n“${t(b.note, 300)}”` : ''}\n\nWhen you accept, the record and its papers become yours to keep. No money moves on the registry; it records the change of title you have agreed between you.\n\n${C.base}/registry/take/${tk}` }).catch(() => {});
    try { ledger.append(db, 'object.offered', `object-${o.id}`, {}); } catch (e) { /* */ }
    res.redirect(`/registry/o/${o.id}?ok=offered`);
  });
  const offerOf = tk => db.prepare("SELECT * FROM object_transfers WHERE token=? AND status='offered'").get(String(tk));
  app.get('/registry/take/:token', (req, res) => {
    const x = offerOf(req.params.token); if (!x) return res.sendStatus(410); let o = obj(x.object_id);
    if (!o.token) { db.prepare('UPDATE objects SET token=? WHERE id=?').run(token(), o.id); o = obj(o.id); }
    const keys = keysOf(req);
    res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', 'noindex').send(shell(tidy(o.title), `<p class="k">The registry · offered to you</p><p class="lede">${esc(nameOf(o.owner))} offers you the title to this work.${x.note ? ` “${esc(x.note)}”` : ''}</p>
${keys.length ? `<form method="post" action="/registry/take/${esc(x.token)}"><label class="rgy-ck"><input type="checkbox" name="attest" value="1" required> I accept the title to this work, as agreed between us</label><button class="buy-btn">Accept the title</button></form>` : `<p><a class="buy-btn" href="/signin?next=${encodeURIComponent(`/registry/take/${x.token}`)}">Sign in with ${esc(x.email)} to accept</a></p>`}
${record(o, 'reader')}`, '/registry'));
  });
  app.post('/registry/take/:token', (req, res) => {
    const x = offerOf(req.params.token); if (!x) return res.sendStatus(410); const keys = keysOf(req); if (!keys.length) return res.redirect(`/signin?next=${encodeURIComponent(`/registry/take/${x.token}`)}`);
    if (!req.body.attest) return res.redirect(`/registry/take/${x.token}`);
    const b = buyerOf(req); const to = b ? `b:${b.id}` : keys[0]; const o = obj(x.object_id);
    if (to === o.owner) return res.redirect(`/registry/o/${o.id}`);
    const from = o.owner;
    db.transaction(() => {
      db.prepare("UPDATE object_transfers SET status='taken', taken_at=datetime('now') WHERE id=?").run(x.id);
      db.prepare("UPDATE objects SET owner=?, public=0, token=NULL, updated_at=datetime('now') WHERE id=?").run(to, o.id);
    })();
    add(obj(o.id), { kind: 'transfer', party: nameOf(to), how: 'by agreement', on_date: new Date().toISOString().slice(0, 10), body: `Title passed from ${nameOf(from)} on the registry, offered and accepted.`, by_kind: 'house', public: 0 });
    try { ledger.append(db, 'object.transferred', `object-${o.id}`, {}); } catch (e) { /* */ }
    tell(from, `${tidy(o.title)} has a new owner`, 'They accepted the title; the record went with it.', '/yours/registry');
    if (o.custodian_id) tell(`m:${o.custodian_id}`, `${tidy(o.title)} has a new owner`, `Title to ${no(o)} passed on the registry. Attest that you hold it for them.`, '/account/custody');
    res.redirect('/yours/registry?ok=taken');
  });

  // The custodian's desk.
  app.get('/account/custody', (req, res) => {
    const c = custodianOf(req); if (!c) { if (!makerOf(req)) return res.redirect('/signin?next=/account/custody'); return res.send(shell('In your care', '<h1>In your care</h1><p class="lede">This desk is for custodians: a freeport, an art store, a registrar who holds works for their owners. Write to the house and we open your door.</p>', '/account/custody')); }
    const list = db.prepare("SELECT * FROM objects WHERE custodian_id=? AND status='recorded' ORDER BY updated_at DESC").all(c.id);
    const last = o => db.prepare("SELECT result, at FROM object_events WHERE object_id=? AND kind='custody' AND by_kind='custodian' ORDER BY id DESC LIMIT 1").get(o.id);
    res.set('Cache-Control', 'private, no-store').send(shell('In your care', `<p class="k">${esc(c.name)}</p><h1>In your care</h1><p class="lede">Works whose owners name you as custodian. Attest what you hold in your own name: received, its condition, released. Each attestation is fingerprinted and on the register.</p>
${req.query.ok ? '<p class="ok">Attested, and on the register.</p>' : ''}
${list.length ? list.map(o => { const l = last(o); return `<article class="rgy-cu"><div><b>${esc(tidy(o.title))}</b><small>${esc([o.artist, o.made].filter(Boolean).join(', '))} · ${esc(no(o))} · for ${esc(nameOf(o.owner))}</small><small>${l ? `${esc(l.result)} · ${esc(day(l.at))}` : 'Not yet attested'}</small></div>
<form method="post" action="/account/custody/${o.id}" enctype="multipart/form-data"><select name="result"><option value="received">Received, held for the owner</option><option value="held">Still held for the owner</option><option value="condition">A condition report</option><option value="released">Released</option></select><input name="party" placeholder="Released to, or examined by" maxlength="200"><select name="condition"><option value="">Condition</option><option>Excellent</option><option>Good</option><option>Fair</option><option>Needs care</option></select><input name="body" placeholder="A note, a location code (private)" maxlength="600"><input type="file" name="file" accept="image/*,application/pdf"><button class="buy-btn">Attest</button></form></article>`; }).join('') : '<p class="note">Nothing yet. Owners name you from their record.</p>'}`, '/account/custody'));
  });
  app.post('/account/custody/:id', up.single('file'), bag('papers'), async (req, res) => {
    const c = custodianOf(req); const o = obj(req.params.id); if (!c || !o || o.custodian_id !== c.id) { if (req.file) fs.unlink(req.file.path, () => {}); return res.sendStatus(403); }
    const b = req.body || {}; const result = ['received', 'held', 'released', 'condition'].includes(b.result) ? b.result : 'held';
    const paper = await keep(o, req.file);
    if (result === 'condition' || b.condition) add(o, { kind: 'condition', result: t(b.condition, 40) || 'Reported', party: c.name, body: result === 'condition' ? t(b.body, 600) : null, ...(result === 'condition' ? paper : {}), on_date: new Date().toISOString().slice(0, 10), by_kind: 'custodian', by_name: c.name, public: 0 });
    if (result !== 'condition') add(o, { kind: 'custody', result, party: result === 'released' ? t(b.party, 200) : nameOf(o.owner), place: c.name, body: t(b.body, 600), ...paper, on_date: new Date().toISOString().slice(0, 10), by_kind: 'custodian', by_name: c.name, public: 0 });
    if (result === 'released') db.prepare('UPDATE objects SET custodian_id=NULL WHERE id=?').run(o.id);
    tell(o.owner, `${c.name} attested ${tidy(o.title)}`, { received: 'Received and held for you.', held: 'Held for you.', released: 'Released.', condition: 'A condition report.' }[result], `/registry/o/${o.id}`);
    res.redirect('/account/custody?ok=1');
  });

  // The dossier: the record as a document for an insurer, a lender, a buyer's adviser.
  app.get('/registry/o/:id/dossier.pdf', (req, res) => {
    const o = obj(req.params.id); if (!o) return res.sendStatus(404); const r = role(req, o); if (!r) return deny(req, res);
    const PDF = require('pdfkit'); const doc = new PDF({ size: 'LETTER', margin: 64, info: { Title: `${tidy(o.title)} · ${no(o)}` } });
    res.set('Cache-Control', 'private, no-store').type('application/pdf').set('Content-Disposition', `inline; filename="${noPath(o)}.pdf"`); doc.pipe(res);
    doc.font('Times-Roman').fontSize(9).fillColor('#666').text(`WATERMARK · THE REGISTRY · ${no(o)}`, { characterSpacing: 1 }).moveDown(1.2);
    doc.fillColor('#111').font('Times-Bold').fontSize(22).text(tidy(o.title)); doc.font('Times-Italic').fontSize(13).text([o.artist, o.made].filter(Boolean).join(', ')).moveDown(.3);
    doc.font('Times-Roman').fontSize(11).text([o.medium, o.dims].filter(Boolean).join(' · ')); if (o.marks) doc.text(`Marks and inscriptions: ${o.marks}`); if (o.description) doc.moveDown(.4).text(o.description);
    if (o.record_kind === 'collection') doc.moveDown(.4).fillColor('#444').text(`${o.holder ? `In the collection of ${o.holder}` : 'Where it is kept is not recorded'}${o.accession ? `, ${o.accession}` : ''}`).fillColor('#111'); else if (r !== 'public') doc.moveDown(.4).fillColor('#444').text(`Owner: ${nameOf(o.owner)}`).fillColor('#111');
    const ph = o.photo ? path.join(C.dataDir, o.photo) : null; if (ph && fs.existsSync(ph)) { try { doc.moveDown(.6).image(ph, { fit: [484, 300], align: 'center' }); } catch (e) { /* */ } }
    const ev = standing(events(o)).filter(e => sees(r, e, o));
    const sec = (h, list) => { if (!list.length) return; doc.moveDown(1).font('Times-Bold').fontSize(13).text(h).moveDown(.3); for (const e of list) { doc.font('Times-Bold').fontSize(10.5).text(`${dateWord(e) || '—'}   ${(KINDS[e.kind] || [e.kind])[0]}`, { continued: false }); doc.font('Times-Roman').fontSize(10.5).text([e.party, e.how, e.result, e.body].filter(Boolean).join(' · ')); doc.fontSize(8.5).fillColor('#666').text(`${({ owner: 'Entered by the owner', custodian: `Attested by ${e.by_name || 'the custodian'}`, expert: `Signed by ${e.by_name}`, house: `Entered by the house${e.by_name ? `, ${e.by_name}` : ''}`, contributor: `Added by ${e.by_name || 'a contributor'}, accepted by the house` })[e.by_kind] || ''}${e.source ? ` · Source: ${e.source}` : ''}${e.file_sha ? ` · paper ${e.file_sha.slice(0, 16)}` : ''} · entry ${e.sha.slice(0, 16)}${e.seq ? ` · register No. ${e.seq}` : ''}`).fillColor('#111').moveDown(.5); } };
    sec('Provenance', ev.filter(e => ['provenance', 'acquired', 'transfer'].includes(e.kind)).sort((a, b) => (a.year_from || yr(a.on_date) || 9999) - (b.year_from || yr(b.on_date) || 9999)));
    sec('The record', ev.filter(e => !['provenance', 'acquired', 'transfer'].includes(e.kind)));
    if (r !== 'public') { doc.moveDown(1).font('Times-Bold').fontSize(13).text('Ready for the desk').moveDown(.3); for (const x of ready(o)) doc.font('Times-Roman').fontSize(10.5).text(`${x.ok ? '✓' : '○'}  ${x.line}`); }
    doc.moveDown(1.2).fontSize(8.5).fillColor('#666').text(`Set ${new Date().toISOString().slice(0, 10)} from the record at ${C.base}. Every entry is fingerprinted and laid on the house’s signed register; anyone can check an entry against /ledger. The registry records what owners, custodians and experts enter and says who entered each line; it does not appraise, authenticate or guarantee title.`);
    doc.end();
  });

  // The house's view.
  app.get('/studio/registry', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const list = db.prepare('SELECT * FROM objects ORDER BY updated_at DESC LIMIT 200').all();
    const cus = db.prepare("SELECT id, name, handle FROM makers WHERE kind='custodian' ORDER BY name").all();
    res.send(V.layout({ title: 'The registry · Studio · Watermark', path: '/studio/registry', studio: true, body: `<section class="studio-wrap rgy"><p class="k">The registry</p><h1>Every record</h1><p class="note">${list.length} records · ${cus.length} custodians${cus.length ? `: ${cus.map(c => esc(c.name)).join(', ')}` : ''}. A custodian is opened from Accounts with the kind Custodian.</p>
${studioKnown()}${studioOffers()}
<table class="tbl"><thead><tr><th>No.</th><th>Work</th><th>Owner</th><th>Custodian</th><th>Ready</th><th>Public</th></tr></thead><tbody>${list.map(o => { const rd = ready(o); const c = o.custodian_id ? cus.find(x => x.id === o.custodian_id) : null; return `<tr><td><a href="/registry/o/${o.id}">${esc(no(o))}</a></td><td>${esc(tidy(o.title))}<br><small>${esc([o.artist, o.made].filter(Boolean).join(', '))}</small></td><td>${o.record_kind === 'collection' ? esc(o.holder || 'unrecorded') : esc(nameOf(o.owner))}</td><td>${c ? esc(c.name) : ''}</td><td>${rd.filter(x => x.ok).length}/${rd.length}</td><td>${o.public ? 'Yes' : ''}</td></tr>`; }).join('')}</tbody></table></section>` }));
  });

  // ---- What is known: records of public collections, from the house's own works and the open record ----
  const metaOf = cap => { const m = {}; for (const part of String(cap || '').split(' · ')) { const i = part.indexOf(': '); if (i > 0) m[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 2).trim(); } return m; };
  const HOLDERS = [[/metmuseum\.org/, 'The Metropolitan Museum of Art', 'the Met'], [/artic\.edu/, 'The Art Institute of Chicago', 'the Art Institute'], [/clevelandart\.org/, 'The Cleveland Museum of Art', 'the Cleveland Museum'], [/si\.edu/, 'The Smithsonian Institution', 'the Smithsonian']];
  const holderOf = url => { const h = HOLDERS.find(([re]) => re.test(url || '')); return h ? { name: h[1], short: h[2] } : null; };
  const howOf = credit => (/bequest|bequeathed/i.test(credit) ? 'bequest' : /gift|given|donat/i.test(credit) ? 'gift' : /purchase|fund|acquired/i.test(credit) ? 'purchase' : /exchange/i.test(credit) ? 'exchange' : null);
  const yearIn = s => { const all = String(s || '').match(/\b(1[5-9]\d\d|20[0-2]\d)\b/g); return all ? +all[all.length - 1] : null; };
  const metId = url => { const m = /\/(?:objects|search)\/(\d+)/.exec(String(url || '')); return m ? m[1] : null; };
  const UA = 'Watermark (watermark.krafftco.com; house@watermark.krafftco.com)';
  const SPARQL = process.env.WIKIDATA_SPARQL || 'https://query.wikidata.org/sparql';
  const fetchOf = () => (app.locals.iiif && app.locals.iiif.doFetch) || fetch;
  // The ownership history Wikidata keeps (owned by, with its dates) and the shows (exhibition history), for a batch.
  async function history({ met = [], qids = [] }) {
    const out = new Map(); qids = qids.filter(x => /^Q\d+$/.test(x)); met = met.map(x => String(x).replace(/\D/g, '')).filter(Boolean); if (!met.length && !qids.length) return out;
    const parts = []; if (met.length) parts.push(`{ VALUES ?mid { ${met.map(x => `"${x}"`).join(' ')} } ?item wdt:P3634 ?mid }`); if (qids.length) parts.push(`{ VALUES ?item { ${qids.map(x => `wd:${x}`).join(' ')} } }`);
    const q = `SELECT ?item ?mid ?owner ?ownerLabel ?start ?end ?exhLabel WHERE { ${parts.join(' UNION ')} OPTIONAL { ?item p:P127 ?st . ?st ps:P127 ?owner . OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end } } OPTIONAL { ?item wdt:P608 ?exh } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
    const r = await fetchOf()(`${SPARQL}?format=json&query=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA, accept: 'application/sparql-results+json' } });
    if (!r.ok) throw new Error(`wikidata ${r.status}`);
    const j = await r.json();
    for (const b of (j.results && j.results.bindings) || []) {
      const qid = String((b.item && b.item.value) || '').split('/').pop(); const key = b.mid ? `met:${b.mid.value}` : qid;
      const h = out.get(key) || { qid, owners: new Map(), shows: new Set() }; out.set(key, h); if (b.mid) out.set(qid, h);
      if (b.owner && b.ownerLabel && !/^Q\d+$/.test(b.ownerLabel.value)) { const k = `${b.ownerLabel.value}|${b.start ? b.start.value.slice(0, 5) : ''}`; if (!h.owners.has(k)) h.owners.set(k, { name: b.ownerLabel.value, from: b.start ? yearIn(b.start.value.slice(0, 5)) : null, to: b.end ? yearIn(b.end.value.slice(0, 5)) : null }); }
      if (b.exhLabel && !/^Q\d+$/.test(b.exhLabel.value)) h.shows.add(b.exhLabel.value);
    }
    return out;
  }
  // One record for a work the house holds from a museum: what it is, who holds it, how it came to them, and the
  // museum's own attribution, each line naming its source. Nothing is invented; what the open record does not say is left open.
  function recordWork(w) {
    if (db.prepare('SELECT 1 FROM objects WHERE work_id=?').get(w.id)) return null;
    const m = metaOf(w.caption); const h = holderOf(w.source_url); const CAT = app.locals.catalogue;
    const row = CAT && CAT.rowOfWork ? (() => { try { return CAT.rowOfWork(w); } catch (e) { return null; } })() : null;
    const holder = h ? h.name : row && row.collection ? row.collection : null;
    const artist = m.artist || (w.artist_id ? (db.prepare('SELECT name FROM artists WHERE id=?').get(w.artist_id) || {}).name : null) || null;
    const made = m.date || (row && row.year ? String(row.year) : null) || null;
    const id = db.prepare("INSERT INTO objects (owner, title, artist, artist_id, made, made_year, medium, dims, work_id, catalogue_id, public, record_kind, holder, accession, source_url, qid) VALUES ('house',?,?,?,?,?,?,?,?,?,1,'collection',?,?,?,?)")
      .run(tidy(w.title), artist, w.artist_id || null, made, yr(made), m.medium || w.medium || (row && row.medium) || null, m.dimensions || (row && row.size) || null, w.id, row ? row.id : null, holder, m['accession number'] || (row && row.inventory) || null, /^https:\/\//.test(w.source_url || '') ? w.source_url : null, row ? row.qid : null).lastInsertRowid;
    const o = obj(id); const src = h ? `${h.short}’s open-access record` : row ? 'Wikidata' : null;
    if (holder) add(o, { kind: 'acquired', party: holder, year_from: yearIn(m['credit line']), how: howOf(m['credit line'] || ''), body: m['credit line'] ? `Credit line: ${m['credit line']}` : null, source: o.source_url || (row ? `https://www.wikidata.org/wiki/${row.qid}` : null), by_kind: 'house', by_name: src ? `from ${src}` : null, public: 1 });
    if (artist && h) add(o, { kind: 'opinion', party: holder, result: `Catalogued as ${artist}`, source: o.source_url, by_kind: 'house', by_name: `from ${h.short}’s open-access record`, public: 1 });
    try { ledger.append(db, 'object.recorded', `object-${id}`, { no: no(o), from: 'collection' }); } catch (e) { /* */ }
    return obj(id);
  }
  // A work known to exist (an artist's catalogue) that the house holds no photograph of: the record waits for it.
  function recordKnown(row) {
    if (db.prepare('SELECT 1 FROM objects WHERE catalogue_id=?').get(row.id)) return null;
    const a = db.prepare('SELECT name FROM artists WHERE id=?').get(row.artist_id) || {};
    const id = db.prepare("INSERT INTO objects (owner, title, artist, artist_id, made, made_year, medium, dims, catalogue_id, public, record_kind, holder, accession, qid) VALUES ('house',?,?,?,?,?,?,?,?,1,'collection',?,?,?)")
      .run(tidy(row.title), a.name || null, row.artist_id, row.year ? String(row.year) : null, row.year || null, row.medium || null, row.size || null, row.id, row.collection || null, row.inventory || null, row.qid).lastInsertRowid;
    try { ledger.append(db, 'object.recorded', `object-${id}`, { no: no(obj(id)), from: 'catalogue' }); } catch (e) { /* */ }
    return obj(id);
  }
  function addHistory(o, h) {
    if (!h) return 0; let n = 0; if (h.qid && !o.qid) db.prepare('UPDATE objects SET qid=? WHERE id=?').run(h.qid, o.id);
    const src = `https://www.wikidata.org/wiki/${h.qid}`; const have = new Set(events(o).map(e => `${e.kind}|${e.party}`));
    for (const ow of h.owners.values()) { if (o.holder && ow.name === o.holder && !ow.from) continue; if (have.has(`provenance|${ow.name}`)) continue; add(o, { kind: 'provenance', party: ow.name, year_from: ow.from, year_to: ow.to, source: src, by_kind: 'house', by_name: 'from Wikidata', public: 1 }); n++; }
    for (const sh of h.shows) { if (have.has(`exhibited|${sh}`)) continue; add(o, { kind: 'exhibited', party: sh, source: src, by_kind: 'house', by_name: 'from Wikidata', public: 1 }); n++; }
    return n;
  }
  const job = { on: false, scope: null, done: 0, history: 0, missed: 0, n: 0, at: null, error: null };
  async function collections({ scope = 'held', n = 500 } = {}) {
    if (job.on) return job; Object.assign(job, { on: true, scope, done: 0, history: 0, missed: 0, n, at: new Date().toISOString(), error: null });
    const GOV = app.locals.governor; const lane = fn => (GOV && GOV.turn ? GOV.turn('registry', fn) : fn());
    try {
      let left = n, guard = 0;
      while (left > 0 && guard++ < 1000) {
        const batch = scope === 'known'
          ? db.prepare('SELECT * FROM catalogue WHERE id NOT IN (SELECT catalogue_id FROM objects WHERE catalogue_id IS NOT NULL) ORDER BY id LIMIT ?').all(Math.min(40, left))
          : db.prepare("SELECT w.id, w.slug, w.title, w.caption, w.medium, w.source_url, w.taken_at, w.artist_id FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND m.kind='institution' AND w.id NOT IN (SELECT work_id FROM objects WHERE work_id IS NOT NULL) ORDER BY w.curated DESC, w.stars DESC, w.id LIMIT ?").all(Math.min(40, left));
        if (!batch.length) break;
        const made = (await lane(async () => (scope === 'known' ? batch.map(recordKnown) : batch.map(recordWork)))).filter(Boolean);
        left -= batch.length; job.done += made.length; if (!made.length) break;
        const met = made.map(o => metId(o.source_url)).filter(Boolean), qids = made.map(o => o.qid).filter(Boolean);
        try { const hs = await history({ met, qids }); for (const o of made) { const h = hs.get(`met:${metId(o.source_url)}`) || (o.qid && hs.get(o.qid)); if (h) job.history += addHistory(obj(o.id), h); } } catch (e) { job.missed += made.length; job.error = e.message; }
        if (GOV && GOV.settle) await GOV.settle('registry');
      }
    } catch (e) { job.error = e.message; }
    job.on = false; job.at = new Date().toISOString();
    try { ledger.append(db, 'registry.collections', 'registry', { scope, done: job.done, history: job.history }); } catch (e) { /* */ }
    return job;
  }

  function holdLine(o) {
    return `<p class="rgy-meta rgy-hold">${o.holder ? `In the collection of <b>${esc(o.holder)}</b>` : 'Where it is kept is not recorded'}${o.accession ? ` · ${esc(o.accession)}` : ''}</p>`
      + `<p class="rgy-meta">${[o.source_url ? `<a href="${esc(o.source_url)}" rel="noopener">The holder’s own record</a>` : '', o.qid ? `<a href="https://www.wikidata.org/wiki/${esc(o.qid)}" rel="noopener">Wikidata</a>` : ''].filter(Boolean).join(' · ')}</p>`
      + (o.credit_line ? `<p class="rgy-meta rgy-credit">${esc(o.credit_line)}${o.acquired_on ? ` · acquired ${esc(o.acquired_on)}` : ''}${o.department ? ` · ${esc(o.department)}` : ''}</p>` : '')
      + (o.on_view ? `<p class="rgy-meta rgy-onview">On view now: ${esc(o.on_view)}</p>` : '')
      + (!o.photo && !o.work_id ? '<p class="rgy-meta">Known to exist; no open photograph in the house yet.</p>' : '');
  }
  function knownBlock(o, r, rd, n) {
    return `<section class="rgy-sec rgy-ready"><h2>What is known <small>${n} of ${rd.length}</small></h2><p class="note">A record of a public collection, set from open data with the source on every line. It is not kept by the holder, and nothing here is for sale. What is missing is what the record is waiting for.</p><ul>${rd.map(x => `<li class="${x.ok ? 'rgy-ok' : ''}"><b>${x.ok ? '✓' : '○'} ${esc(x.line)}</b><span>${esc(x.why)}</span></li>`).join('')}</ul></section>${offerForm(o, r)}`;
  }
  // What anyone may add: a line of what is known, with its source, read by the house before it stands.
  function offerForm(o) {
    return `<details class="rgy-add rgy-offer"><summary>Know more? <span>Add what you know, with its source; the house reads each line before it stands</span></summary><form method="post" action="/registry/o/${o.id}/offer" enctype="multipart/form-data"><label>What it is<select name="kind"><option value="provenance">Provenance: whose hands, when</option><option value="exhibited">A show it hung in</option><option value="published">A book or catalogue it appears in</option><option value="condition">Its condition, or a restoration</option><option value="note">Something else</option></select></label><label>Who, or what<input name="party" maxlength="300" required></label><div class="rgy-row"><label>From (year)<input name="year_from" inputmode="numeric"></label><label>To (year)<input name="year_to" inputmode="numeric"></label></div><label>The source (a book and page, an archive, an address)<input name="source" maxlength="300" required></label><label>A note<textarea name="body" rows="2" maxlength="1500"></textarea></label><label>A paper, if you have one<input type="file" name="file" accept="application/pdf,image/*"></label><label>Your name, as it will stand on the line<input name="name" maxlength="120" required></label><button class="buy-btn">Send it to the house</button></form><p class="note">Are you the holder? The record can be kept in your own name, your registrar’s word in place of ours: <a href="mailto:${esc(process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com')}?subject=${encodeURIComponent(`The registry: ${no(o)}`)}">write to the house</a>.</p></details>`;
  }
  app.post('/registry/o/:id/offer', up.single('file'), bag('papers'), async (req, res) => {
    const o = obj(req.params.id); const drop = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
    if (!o || o.record_kind !== 'collection') { drop(); return res.sendStatus(404); }
    const keys = keysOf(req); if (!keys.length) { drop(); return res.redirect(`/signin?next=${encodeURIComponent(`/registry/o/${o.id}`)}`); }
    const b = req.body || {}; const source = t(b.source, 300), party = t(b.party, 300), name = t(b.name, 120);
    if (!source || !party || !name) { drop(); return res.redirect(`/registry/o/${o.id}?ok=${encodeURIComponent('A line needs who or what, a source and your name.')}`); }
    const recent = db.prepare("SELECT COUNT(*) n FROM object_offers WHERE who=? AND at > datetime('now','-1 day')").get(keys[0]).n;
    if (recent >= 20) { drop(); return res.redirect(`/registry/o/${o.id}?ok=${encodeURIComponent('That is enough for today; the house is reading what you sent.')}`); }
    const paper = await keep(o, req.file);
    const kind = ['provenance', 'exhibited', 'published', 'condition', 'note'].includes(b.kind) ? b.kind : 'note';
    db.prepare('INSERT INTO object_offers (object_id, who, name, email, kind, year_from, year_to, party, body, source, file, mime, file_sha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(o.id, keys[0], name, emailOf(keys[0]), kind, yr(b.year_from), yr(b.year_to), party, t(b.body, 1500), source, paper.file || null, paper.mime || null, paper.file_sha || null);
    mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `The registry: a line for ${tidy(o.title)}`, text: `${name} offers a ${kind} line for ${no(o)}: ${party}. Source: ${source}.\n\n${C.base}/studio/registry#offers` }).catch(() => {});
    res.redirect(`/registry/o/${o.id}?ok=${encodeURIComponent('Thank you. The house reads it against its source; when it stands, it carries your name.')}`);
  });
  app.post('/studio/registry/offers/:id', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const x = db.prepare("SELECT * FROM object_offers WHERE id=? AND status='waiting'").get(+req.params.id); if (!x) return res.redirect('/studio/registry#offers');
    const o = obj(x.object_id); const yes = req.body.do === 'accept';
    if (yes) { add(o, { kind: x.kind, year_from: x.year_from, year_to: x.year_to, party: x.party, body: x.body, source: x.source, file: x.file, mime: x.mime, file_sha: x.file_sha, by_kind: 'contributor', by_name: x.name, public: 1 }); db.prepare("UPDATE object_offers SET status='accepted' WHERE id=?").run(x.id); }
    else db.prepare("UPDATE object_offers SET status='declined', word=? WHERE id=?").run(t(req.body.word, 300), x.id);
    if (x.email) mail.send({ to: x.email, subject: `The registry: ${tidy(o.title)}`, text: yes ? `Your line on ${tidy(o.title)} stands on the registry, in your name. Thank you.\n\n${C.base}/r/${noPath(o)}` : `Thank you for your line on ${tidy(o.title)}. The house could not set it on the record${req.body.word ? `: ${t(req.body.word, 300)}` : ''}.` }).catch(() => {});
    res.redirect('/studio/registry#offers');
  });
  app.post('/studio/registry/collections', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const n = Math.max(1, Math.min(20000, +req.body.n || 500)); const scope = req.body.scope === 'known' ? 'known' : 'held';
    if (!job.on) collections({ scope, n }).catch(() => {});
    res.redirect('/studio/registry?ok=running');
  });
  function studioKnown() {
    const held = db.prepare("SELECT COUNT(*) n FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND m.kind='institution' AND w.id NOT IN (SELECT work_id FROM objects WHERE work_id IS NOT NULL)").get().n;
    let known = 0; try { known = db.prepare('SELECT COUNT(*) n FROM catalogue WHERE id NOT IN (SELECT catalogue_id FROM objects WHERE catalogue_id IS NOT NULL)').get().n; } catch (e) { /* no catalogue yet */ }
    return `<section class="rgy-sec"><h2>What is known</h2><p class="note">Records of public collections, set from what the house already holds and the open record (the museum’s own data, Wikidata’s ownership history and shows), each line naming its source. ${(+held).toLocaleString('en-US')} museum works without a record; ${(+known).toLocaleString('en-US')} works known from the catalogues without one.</p>${job.on ? `<p class="ok">Running: ${esc(job.scope)}, ${job.done} recorded, ${job.history} lines of history so far.</p>` : job.at ? `<p class="note">Last run (${esc(job.scope)}): ${job.done} recorded, ${job.history} lines of history${job.missed ? `; ${job.missed} without history (${esc(job.error || '')})` : ''}.</p>` : ''}
<form method="post" action="/studio/registry/collections" class="rgy-fr"><input type="hidden" name="scope" value="held"><label>How many<input name="n" value="500" inputmode="numeric" size="6"></label><button class="buy-btn">Record the museum works the house holds</button></form>
<form method="post" action="/studio/registry/collections" class="rgy-fr"><input type="hidden" name="scope" value="known"><label>How many<input name="n" value="500" inputmode="numeric" size="6"></label><button>Record the works known from the catalogues</button></form></section>`;
  }
  function studioOffers() {
    const offers = db.prepare("SELECT x.*, o.title FROM object_offers x JOIN objects o ON o.id=x.object_id WHERE x.status='waiting' ORDER BY x.id").all();
    return `<section class="rgy-sec" id="offers"><h2>Lines offered <small>${offers.length}</small></h2>${offers.length ? offers.map(x => `<div class="rgy-cu"><div><b>${esc(tidy(x.title))}</b> · ${esc(x.kind)}: ${esc(x.party)}${x.year_from || x.year_to ? ` (${x.year_from || ''}–${x.year_to || ''})` : ''}<small>Source: ${esc(x.source)}${x.body ? ` · ${esc(x.body)}` : ''} · from ${esc(x.name)}${x.email ? ` (${esc(x.email)})` : ''}${x.file ? ' · a paper' : ''}</small></div><form method="post" action="/studio/registry/offers/${x.id}"><button name="do" value="accept" class="buy-btn">It stands</button><input name="word" placeholder="A word, if not" maxlength="300"><button name="do" value="decline">Not on the record</button></form></div>`).join('') : '<p class="note">None waiting.</p>'}</section>`;
  }
  const line = w => { const o = w && db.prepare("SELECT * FROM objects WHERE work_id=? AND public=1 AND status='recorded' LIMIT 1").get(w.id); return o ? `<p class="rgy-line">On the registry: <a href="/r/${noPath(o)}">${esc(no(o))}</a>, what is known of it and where it is kept.</p>` : ''; };

  const api = { cmOf, no, byNo, ready, add, create, events, standing, KINDS, recordWork, recordKnown, history, addHistory, collections, job, line };

  app.locals.registry = api;
  return api;
}

module.exports = { mountRegistry, KINDS };
