// The Work Master (Will, 5 Nov: "what is the most important and valuable thing that we ourselves own and add to the
// world … what would Citadel or Point72 do … integrate further with the industry … ownership, value, what it trades
// for"). Finance runs on a security master: one identifier for each security that maps every other code for it, with
// its terms. Art has none. The house's registry number is that identifier for a work of art: the Work Master record
// joins every source's own number (MoMA, the Met, Wikidata, the holder's accession, the house's own work), says where
// each fact came from, who holds the work and since when, the line of owners with their sources, what may lawfully be
// done with it, and what it has traded for in the house; and it is signed by the house's register key
// (eddsa-jcs-2022, the same proof as the house's credentials), so anyone can check it was not altered.
// Public: the record as the registry shows it to anyone (a private owner is never named; a private price never shown).
// The Studio sees more with its own key: the auction results the price book holds for the artist.
const B = require('./bridge');

function mountMaster(app, { db, C, V, ledger, isStudio }) {
  const esc = V.esc;
  const RG = () => app.locals.registry;
  const VM = () => `did:web:${encodeURIComponent(new URL(C.base).host)}#register`;
  const digits = o => RG().no(o).replace(/\s+/g, '').slice(2);
  const metId = u => { const m = /metmuseum\.org\/(?:art\/collection\/search|objects?)\/(\d+)/.exec(String(u || '')); return m ? m[1] : null; };
  const momaId = (o, cat) => { const m = /moma\.org\/collection\/works\/(\d+)/.exec(String(o.source_url || '')); return m ? m[1] : cat && /^moma:/.test(cat.qid) ? cat.qid.slice(5) : null; };
  const json = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };

  // Any number in, the record out.
  function resolve(q) {
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    if (q.no) { const o = RG().byNo(String(q.no)); if (o) return o; }
    if (q.moma) { const c = one("SELECT id FROM catalogue WHERE qid=? ORDER BY id LIMIT 1", `moma:${Number(q.moma) || 0}`); const o = c && one("SELECT * FROM objects WHERE catalogue_id=? AND status<>'merged'", c.id); if (o) return o; }
    if (q.met) { const id = Number(q.met) || 0; const o = one("SELECT * FROM objects WHERE (source_url LIKE ? OR source_url LIKE ?) AND status<>'merged' ORDER BY id LIMIT 1", `%metmuseum.org/art/collection/search/${id}`, `%metmuseum.org/objects/${id}`); if (o) return o; }
    if (q.qid && /^Q\d+$/.test(q.qid)) { const o = one("SELECT * FROM objects WHERE qid=? AND status<>'merged' ORDER BY id LIMIT 1", q.qid) || (() => { const c = one('SELECT id FROM catalogue WHERE qid=? ORDER BY id LIMIT 1', q.qid); return c && one("SELECT * FROM objects WHERE catalogue_id=? AND status<>'merged'", c.id); })(); if (o) return o; }
    if (q.accession) { const o = q.holder ? one("SELECT * FROM objects WHERE accession=? AND lower(holder) LIKE ? AND status<>'merged' ORDER BY id LIMIT 1", String(q.accession), `%${String(q.holder).toLowerCase()}%`) : one("SELECT * FROM objects WHERE accession=? AND status<>'merged' ORDER BY id LIMIT 1", String(q.accession)); if (o) return o; }
    if (q.work) { const w = one('SELECT id FROM works WHERE slug=?', String(q.work)); const o = w && one("SELECT * FROM objects WHERE work_id=? AND status<>'merged'", w.id); if (o) return o; }
    return null;
  }

  function recordOf(o, { studio = false } = {}) {
    const R = RG(), a = o.artist_id ? db.prepare('SELECT * FROM artists WHERE id=?').get(o.artist_id) : null;
    const cat = o.catalogue_id ? db.prepare('SELECT * FROM catalogue WHERE id=?').get(o.catalogue_id) : null;
    const w = o.work_id ? db.prepare('SELECT id, slug, title, open, status, maker_id, artist_id, taken_at FROM works WHERE id=?').get(o.work_id) : null;
    const pub = o.public === 1 || o.public === true;
    const ev = R.standing(R.events(o)).filter(e => studio || (e.public && (o.record_kind === 'collection' || !['acquired', 'custody', 'transfer', 'search'].includes(e.kind))));
    const src = e => e.source || (e.by_name ? e.by_name : null);
    const ids = json(o.ids) || {};
    const identifiers = { watermark: R.no(o), wikidata: o.qid || (cat && /^Q\d+$/.test(cat.qid) ? cat.qid : null), moma: momaId(o, cat), met: metId(o.source_url), accession: o.accession || null, holder_record: o.source_url || null, house_work: w ? w.slug : null,
      artist: a ? { wikidata: a.qid || null, ulan: a.ulan || null, moma: a.moma_id || null, page: `${C.base}/art/${a.slug}` } : null };
    // What may be done with it: from the artist's dates (art.rights), an open work's licence, a held work's own terms.
    let rights = { state: 'unknown', why: 'Not enough is known of the artist or the date.' };
    try { if (a && app.locals.art && app.locals.art.rights) rights = app.locals.art.rights(a, w || { taken_at: o.made_year ? String(o.made_year) : null }); } catch (e) { /* */ }
    const pd = rights.state === 'pd' || (w && ['pd', 'cc0'].includes(w.open));
    const may = { record: true, show_picture: !!w && w.status === 'held', collect: !!w && w.status === 'held' && !(w.open && ['pd', 'cc0'].includes(w.open)), license: !!w && rights.state !== 'reserved' && !pd, print: !!w && (pd || rights.state !== 'reserved'), reproduce_freely: !!pd };
    // What it has traded for, in the house: every paid Collect and resale of the house's photograph of it.
    let house = null; try { if (w && app.locals.prices) { const p = app.locals.prices.record(w); house = { trades: p.events.map(e => ({ at: String(e.at).slice(0, 10), usd: e.cents / 100, what: e.what })), last_usd: p.value ? p.value / 100 : null, working_licences: p.working }; } } catch (e) { /* */ }
    const market = { house, observed: null, note: 'Trades observed by the house; never an estimate or an appraisal.' };
    if (studio && a && app.locals.pricebook) { const rows = app.locals.pricebook.rowsOf(a.id); market.observed = { artist_results: rows.length, sold: rows.filter(r => r.sold).length, last: rows.filter(r => r.sold).slice(-5).map(r => ({ date: r.sale_date, house: r.house, title: r.title, usd: r.usd / 100 })) }; }
    const doc = {
      '@context': ['https://www.w3.org/ns/credentials/v2', { wm: `${C.base}/master#` }], type: ['VerifiableCredential', 'WorkMasterRecord'], issuer: VM().split('#')[0],
      id: `${C.base}/r/${digits(o)}`, validFrom: new Date(o.updated_at || o.created_at || Date.now()).toISOString(),
      credentialSubject: {
        id: `${C.base}/r/${digits(o)}`, number: R.no(o), identifiers,
        work: { title: o.title, artist: a ? { name: a.name, born: a.born || null, died: a.died || null, nationality: a.nationality || null } : (o.artist ? { name: o.artist } : null), made: o.made || null, made_year: o.made_year || null,
          classification: o.classification || null, medium: o.medium || null, dimensions: o.dims || null, measured_cm: json(o.cm), marks: o.marks || null },
        ownership: o.record_kind === 'collection'
          ? { kind: 'institution', holder: o.holder || null, since: o.acquired_on || null, credit_line: o.credit_line || null, department: o.department || null, on_view: o.on_view || null }
          : { kind: 'private', holder: studio ? (o.owner || null) : 'A private owner (named only to the owner and the house)', custody_attested: ev.some(e => e.kind === 'custody') },
        provenance: ev.filter(e => ['provenance', 'acquired', 'transfer'].includes(e.kind)).map(e => ({ party: e.party || null, from: e.year_from || (e.on_date ? Number(String(e.on_date).slice(0, 4)) : null), to: e.year_to || null, how: e.how || null, line: e.body || null, source: src(e), entered_by: e.by_name || e.by_kind, register: e.seq || null, fingerprint: e.sha || null })),
        exhibited: ev.filter(e => e.kind === 'exhibited').map(e => ({ show: e.party || e.body, year: e.year_from || null, source: src(e) })),
        literature: ev.filter(e => e.kind === 'published').map(e => ({ ref: e.party || e.body, year: e.year_from || null, source: src(e) })),
        rights: { state: rights.state, why: rights.why, may },
        market,
        record: { page: `${C.base}/r/${digits(o)}`, kind: o.record_kind, kept_by: 'Watermark', facts_from: [...new Set(ev.map(src).filter(Boolean))].slice(0, 12) },
      },
    };
    if (!pub && !studio) return null;
    return B.prove(doc, { vm: VM(), signBytes: ledger.signBytes }) || doc;
  }

  const send = (req, res, o) => { const studio = isStudio(req); const r = o && recordOf(o, { studio }); if (!r) return res.status(404).json({ error: 'No public record by that number.' }); res.set('Cache-Control', studio ? 'private, no-store' : 'public, max-age=300').json(r); };
  app.get('/api/v1/master/resolve', (req, res) => send(req, res, resolve(req.query || {})));
  app.get('/api/v1/master/:n', (req, res, next) => { if (!/^\d{12}$/.test(String(req.params.n).replace(/\s+/g, ''))) return next(); send(req, res, RG().byNo('WR' + req.params.n)); });
  app.get('/api/v1/master', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase(); const lim = Math.min(50, Number(req.query.limit) || 25);
    const rows = q ? db.prepare("SELECT * FROM objects WHERE public=1 AND status='recorded' AND (lower(title) LIKE ? OR lower(artist) LIKE ? OR lower(accession) LIKE ?) ORDER BY made_year, id LIMIT ?").all(`%${q}%`, `%${q}%`, `%${q}%`, lim) : [];
    res.json({ count: rows.length, records: rows.map(o => ({ number: RG().no(o), title: o.title, artist: o.artist, made: o.made, holder: o.record_kind === 'collection' ? o.holder : 'A private owner', record: `${C.base}/api/v1/master/${digits(o)}` })) });
  });
  app.post('/api/v1/master/verify', (req, res) => { const pub = ledger.publicKey ? ledger.publicKey() : null; res.json({ verified: !!(pub && B.checkProof(req.body || {}, pub)) }); });
  // The page: what it is, and a box that takes any number.
  app.get('/master', (req, res) => {
    const q = req.query || {}; const any = String(q.id || '').trim();
    if (any) { const m = /^(?:wr\s*)?([\d\s]{12,16})$/i.exec(any), qid = /^Q\d+$/i.test(any) ? any.toUpperCase() : null; const o = m ? RG().byNo('WR' + m[1].replace(/\s/g, '')) : qid ? resolve({ qid }) : resolve({ moma: /^moma[:\s]*(\d+)$/i.test(any) ? any.replace(/\D/g, '') : null, met: /^met[:\s]*(\d+)$/i.test(any) ? any.replace(/\D/g, '') : null, accession: !/^(moma|met)/i.test(any) ? any : null });
      if (o && o.public) return res.redirect(`/r/${digits(o)}`); }
    const n = db.prepare("SELECT COUNT(*) n, COUNT(DISTINCT artist_id) a, COUNT(DISTINCT holder) h FROM objects WHERE public=1 AND status='recorded'").get();
    res.send(V.layout({ title: 'The Work Master · Watermark', path: '/master', desc: 'One number for every work of art, mapped to every museum’s own, with its owners, its rights and what it has traded for, signed.', body: `<section class="mst"><p class="k">The Work Master</p><h1>One number for every work of art.</h1>
<p class="lede">The same painting is one number at the museum that keeps it, another in Wikidata, another in a dealer's stock book and another on an insurer's schedule. The house gives each work one number and joins all the others to it, with every fact's source, who holds it and since when, the line of its owners, what may lawfully be done with it, and what it has traded for. Every record is signed by the house, so anyone can check that nothing in it was changed.</p>
<form method="get" action="/master" class="mst-f"><input name="id" value="${esc(any)}" placeholder="A Watermark number, a Wikidata Q-number, MoMA 78386, Met 436532, an accession number" aria-label="Any number"><button>Find the record</button></form>
${any ? '<p class="note">No public record by that number yet.</p>' : ''}
<div class="hd-held"><span><b>${n.n.toLocaleString()}</b> works</span><span><b>${n.a.toLocaleString()}</b> artists</span><span><b>${n.h.toLocaleString()}</b> holders</span></div>
<h2>For anyone building on it</h2><ul class="mst-api"><li><code>GET /api/v1/master/resolve?moma=78386</code> (or <code>met=</code>, <code>qid=</code>, <code>accession=</code>&amp;<code>holder=</code>, <code>no=</code>, <code>work=</code>)</li><li><code>GET /api/v1/master/&lt;12 digits&gt;</code>, the signed record</li><li><code>GET /api/v1/master?q=</code>, a search</li><li><code>POST /api/v1/master/verify</code>, a record back: is it as the house signed it?</li></ul>
<p class="note">A private owner is never named and a private price never shown. The house says where each line came from; it does not appraise, authenticate or guarantee title. Records drawn from museums' open data name the museum as the holder; the house is not connected with them.</p></section>` }));
  });
  app.locals.master = { resolve, recordOf };
}

module.exports = { mountMaster };
