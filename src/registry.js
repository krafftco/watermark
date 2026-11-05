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
  const nameOf = key => { const [k, id] = String(key).split(':'); const r = k === 'm' ? db.prepare('SELECT name FROM makers WHERE id=?').get(+id) : db.prepare('SELECT name, email FROM buyers WHERE id=?').get(+id); return (r && (r.name || (r.email ? r.email.split('@')[0] : ''))) || 'the owner'; };
  const emailOf = key => { const [k, id] = String(key).split(':'); const r = k === 'm' ? db.prepare('SELECT email FROM makers WHERE id=?').get(+id) : db.prepare('SELECT email FROM buyers WHERE id=?').get(+id); return r && r.email; };
  const custodianOf = req => { const m = makerOf(req); return m && m.kind === 'custodian' ? m : null; };
  const role = (req, o) => {
    if (keysOf(req).includes(o.owner)) return 'owner';
    if (isStudio(req)) return 'house';
    const c = custodianOf(req); if (c && o.custodian_id === c.id) return 'custodian';
    if (o.token && req.query.k) { try { const a = Buffer.from(String(req.query.k)), b = Buffer.from(o.token); if (a.length === b.length && crypto.timingSafeEqual(a, b)) return 'reader'; } catch (e) { /* */ } }
    if (o.public) return 'public';
    return null;
  };
  const sees = (r, e) => r === 'owner' || r === 'house' || r === 'reader' || (r === 'custodian' && ['custody', 'condition', 'transfer'].includes(e.kind)) || (r === 'public' && e.public && !['acquired', 'custody', 'transfer', 'search'].includes(e.kind));

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
  const tell = (key, title, body, href) => { const [k, id] = String(key).split(':'); if (app.locals.notify && app.locals.notify.tell) { try { app.locals.notify.tell({ [k === 'm' ? 'maker_id' : 'buyer_id']: +id, kind: 'registry', title, body, href }); } catch (e) { /* */ } } };

  // Ready for the desk: what a private sale (or an insurer, or a lender) would ask of the record, read from it.
  function ready(o, ev = standing(events(o))) {
    const of = k => ev.filter(e => e.kind === k); const recent = e => Date.now() - new Date(String(e.at).replace(' ', 'T') + 'Z').getTime() < YEAR;
    const acq = of('acquired').concat(of('transfer')); const prov = of('provenance');
    const old = (o.made_year || 9999) < 1946;
    const covers = (a, b) => prov.some(p => (p.year_from || 0) <= a && (p.year_to || 9999) >= b) || prov.filter(p => p.year_from && p.year_to).sort((x, y) => x.year_from - y.year_from).reduce((at, p) => (p.year_from <= at + 1 && p.year_to > at ? p.year_to : at), a - 1) >= b;
    const custody = of('custody').filter(e => e.by_kind === 'custodian' && e.result !== 'released');
    const attributed = o.artist && !/^the owner$/i.test(o.artist);
    return [
      { k: 'described', ok: !!(o.title && o.made && o.medium && o.dims && (o.photo || o.work_id)), line: 'Described', why: 'Title, date, medium, dimensions and a photograph of record' },
      { k: 'title', ok: acq.some(e => e.file || e.kind === 'transfer'), line: 'Title to the owner', why: 'How the present owner came to own it, with the paper (a bill of sale, a deed of gift, a probate record)' },
      { k: 'provenance', ok: prov.length > 0 && (!old || covers(1933, 1945)), line: old ? 'Provenance, 1933–1945 accounted for' : 'Provenance', why: old ? 'Who held it from the work’s making to now; the years 1933 to 1945 without a gap, as every serious buyer and museum asks' : 'Who held it before the present owner' },
      { k: 'custody', ok: custody.some(recent), line: 'Custody attested', why: 'A custodian’s attestation in the last year that it holds the work for this owner' },
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
    const by = { owner: 'Entered by the owner', custodian: `Attested by ${esc(e.by_name || 'the custodian')}`, expert: `Signed by ${esc(e.by_name || 'the expert')}`, house: 'Entered by the house' }[e.by_kind] || '';
    const file = e.file && r !== 'public' ? ` · <a href="/registry/o/${o.id}/file/${e.id}${r === 'reader' ? `?k=${encodeURIComponent(o.token)}` : ''}">The paper</a>` : '';
    return `<li class="rgy-e rgy-${esc(e.kind)}"><span class="rgy-d">${esc(dateWord(e))}</span><div><p class="rgy-k">${esc(label)}${e.corrects ? ' <small>(sets right an earlier entry)</small>' : ''}</p>${bits ? `<p>${bits}</p>` : ''}${e.body ? `<p>${esc(e.body)}</p>` : ''}${e.source ? `<p class="rgy-src">Source: ${/^https:\/\//.test(e.source) ? `<a href="${esc(e.source)}" rel="noopener">${esc(e.source)}</a>` : esc(e.source)}</p>` : ''}<p class="rgy-by">${by}${e.at ? ` · ${esc(day(e.at))}` : ''}${e.seq ? ` · on the register, No. ${e.seq}` : ''}${file}</p></div></li>`;
  }
  function record(o, r) {
    const all = standing(events(o)); const ev = all.filter(e => sees(r, e));
    const prov = ev.filter(e => ['provenance', 'acquired', 'transfer'].includes(e.kind)).sort((a, b) => (a.year_from || yr(a.on_date) || 9999) - (b.year_from || yr(b.on_date) || 9999) || a.id - b.id);
    const rest = ev.filter(e => !prov.includes(e));
    const ph = photoOf(o, r); const rd = ready(o, all); const n = rd.filter(x => x.ok).length;
    const cust = o.custodian_id ? db.prepare('SELECT name, handle FROM makers WHERE id=?').get(o.custodian_id) : null;
    const desk = r === 'owner' || r === 'house';
    return `<header class="rgy-h">${ph ? `<figure class="rgy-ph"><img src="${esc(ph)}" alt="${esc(tidy(o.title))}"></figure>` : ''}<div><p class="k">The registry · <span class="rgy-no">${esc(no(o))}</span></p><h1>${esc(tidy(o.title))}</h1>
<p class="rgy-by1">${esc([o.artist, o.made].filter(Boolean).join(', '))}</p><p class="rgy-meta">${esc([o.medium, o.dims].filter(Boolean).join(' · '))}</p>${o.marks ? `<p class="rgy-meta">Marks and inscriptions: ${esc(o.marks)}</p>` : ''}${o.description ? `<p>${esc(o.description)}</p>` : ''}
${r !== 'public' ? `<p class="rgy-meta">${r === 'owner' ? 'Yours' : `Owned by ${esc(nameOf(o.owner))}`}${cust ? ` · held by ${esc(cust.name)}` : ''}</p>` : '<p class="rgy-meta">Owner and place are kept private.</p>'}</div></header>
<section class="rgy-sec"><h2>Provenance</h2>${prov.length ? `<ol class="rgy-l">${prov.map(e => entry(o, e, r)).join('')}</ol>` : '<p class="note">Nothing entered yet.</p>'}</section>
${rest.length ? `<section class="rgy-sec"><h2>The record</h2><ol class="rgy-l">${rest.map(e => entry(o, e, r)).join('')}</ol></section>` : ''}
${r !== 'public' ? `<section class="rgy-sec rgy-ready"><h2>Ready for the desk <small>${n} of ${rd.length}</small></h2><p class="note">What a private sale, a lender or an insurer will ask of this record. Nothing here is offered for sale; it is the record made ready.</p><ul>${rd.map(x => `<li class="${x.ok ? 'rgy-ok' : ''}"><b>${x.ok ? '✓' : '○'} ${esc(x.line)}</b><span>${esc(x.why)}</span></li>`).join('')}</ul></section>` : ''}
${desk ? deskBlock(o, r) : ''}
<p class="rgy-foot">Every entry is fingerprinted and laid on the house’s signed register; none is ever edited, only set right by a later one. <a href="/registry/o/${o.id}/dossier.pdf${r === 'reader' ? `?k=${encodeURIComponent(o.token)}` : ''}">The dossier, as a PDF</a>${o.public ? ` · <a href="/r/${noPath(o)}">The public record</a>` : ''}</p>`;
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
    const list = db.prepare("SELECT * FROM objects WHERE public=1 AND status='recorded' ORDER BY updated_at DESC LIMIT 60").all();
    res.send(shell('The registry', `<header class="rgy-hero"><p class="k">The registry</p><h1>The record of a work, kept.</h1><p class="lede">Before a painting changes hands anywhere serious, five questions are asked: what it is, who owns it and how they came to, where it has been, where it is now and in what state, and whether anyone has a claim on it. The registry keeps the answers in one record, with the papers, every entry fingerprinted and laid on the house’s signed register.</p>
<p><a class="buy-btn" href="/yours/registry">Put a work on the registry</a> <a class="rgy-sub" href="#how">How it works</a></p></header>
${list.length ? `<section class="rgy-sec"><h2>On the public registry</h2><div class="rgy-g">${list.map(o => { const ph = photoOf(o, 'public'); return `<a class="rgy-c" href="/r/${noPath(o)}">${ph ? `<img src="${esc(ph)}" alt="" loading="lazy">` : '<span class="rgy-blank"></span>'}<b>${esc(tidy(o.title))}</b><small>${esc([o.artist, o.made].filter(Boolean).join(', '))}</small><small class="rgy-no">${esc(no(o))}</small></a>`; }).join('')}</div></section>` : ''}
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
    const e = db.prepare('SELECT * FROM object_events WHERE id=? AND object_id=?').get(+req.params.eid, o.id); if (!e || !e.file || !sees(r, e)) return res.sendStatus(404);
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
    if (r !== 'public') doc.moveDown(.4).fillColor('#444').text(`Owner: ${nameOf(o.owner)}`).fillColor('#111');
    const ph = o.photo ? path.join(C.dataDir, o.photo) : null; if (ph && fs.existsSync(ph)) { try { doc.moveDown(.6).image(ph, { fit: [484, 300], align: 'center' }); } catch (e) { /* */ } }
    const ev = standing(events(o)).filter(e => sees(r, e));
    const sec = (h, list) => { if (!list.length) return; doc.moveDown(1).font('Times-Bold').fontSize(13).text(h).moveDown(.3); for (const e of list) { doc.font('Times-Bold').fontSize(10.5).text(`${dateWord(e) || '—'}   ${(KINDS[e.kind] || [e.kind])[0]}`, { continued: false }); doc.font('Times-Roman').fontSize(10.5).text([e.party, e.how, e.result, e.body].filter(Boolean).join(' · ')); doc.fontSize(8.5).fillColor('#666').text(`${{ owner: 'Entered by the owner', custodian: `Attested by ${e.by_name || 'the custodian'}`, expert: `Signed by ${e.by_name}`, house: 'Entered by the house' }[e.by_kind] || ''}${e.source ? ` · Source: ${e.source}` : ''}${e.file_sha ? ` · paper ${e.file_sha.slice(0, 16)}` : ''} · entry ${e.sha.slice(0, 16)}${e.seq ? ` · register No. ${e.seq}` : ''}`).fillColor('#111').moveDown(.5); } };
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
<table class="tbl"><thead><tr><th>No.</th><th>Work</th><th>Owner</th><th>Custodian</th><th>Ready</th><th>Public</th></tr></thead><tbody>${list.map(o => { const rd = ready(o); const c = o.custodian_id ? cus.find(x => x.id === o.custodian_id) : null; return `<tr><td><a href="/registry/o/${o.id}">${esc(no(o))}</a></td><td>${esc(tidy(o.title))}<br><small>${esc([o.artist, o.made].filter(Boolean).join(', '))}</small></td><td>${esc(nameOf(o.owner))}</td><td>${c ? esc(c.name) : ''}</td><td>${rd.filter(x => x.ok).length}/${rd.length}</td><td>${o.public ? 'Yes' : ''}</td></tr>`; }).join('')}</tbody></table></section>` }));
  });

  const api = { no, byNo, ready, add, create, events, standing, KINDS };
  app.locals.registry = api;
  return api;
}

module.exports = { mountRegistry, KINDS };
