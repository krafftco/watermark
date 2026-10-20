// The physical work (Will, 20 Oct: "it's not about photography … photographs of live paintings … masters, originals …
// the digital fingerprint or watermark of the physical work … collectors store and keep track of their collections …
// the ultimate tool for young collectors and artists and curators, every media type").
//   A work has a kind (`works.kind`: photograph by default; painting, drawing, print, sculpture, textile, mixed, film,
//   other). For a physical work the held file is the photograph of record and the work carries an object record:
//   medium (exists), dimensions, edition, where and how it was made, how it is signed, its condition, and, private to
//   the maker and the house, where it is and a note. The by-line follows the kind everywhere the house speaks
//   ('Painting by …', 'A work by …'); /w/:slug/object is the object's label and certificate: what the house attests
//   (the maker's record and attestation, the photograph of record's fingerprint and register entry) and what it does
//   not (the house does not hold the object). The Shield gains 'The object'.
//   The collector's cabinet becomes a registrar's book: each held object gains acquired (date, from whom), what was
//   paid and its insured value (private), where it is, its condition, provenance, and a link to a Watermark work when
//   the piece is a held work's physical edition (the maker and the deed come along). /yours/cabinet/book is the
//   catalogue as a registrar keeps it; /yours/cabinet.csv takes it out whole. Nothing of it is told to anyone.
const KINDS = { photograph: 'Photograph', painting: 'Painting', drawing: 'Drawing', print: 'Print', sculpture: 'Sculpture', textile: 'Textile', mixed: 'Mixed media', film: 'Film', other: 'Work' };
const kindOf = w => (w && KINDS[w.kind] ? w.kind : 'photograph');
const kindWord = w => KINDS[kindOf(w)];
const an = word => (/^[aeiou]/i.test(word) ? 'an' : 'a');
// 'Photograph by Will Fullerton' / 'Painting by …' / 'Work by …'
const by = (w, name) => `${kindWord(w)} by ${name}`;
// 'A photograph by …' / 'A painting by …' / 'A work by …'
const aBy = (w, name) => { const k = kindWord(w).toLowerCase(); return `${an(k) === 'an' ? 'An' : 'A'} ${k} by ${name}`; };
const physical = w => kindOf(w) !== 'photograph' && kindOf(w) !== 'film';

function mountObject(app, { db, V, ledger, studioOnly, isStudio, makerOf, mk }) {
  const { esc, tidy } = V;
  for (const [c, t] of [['kind', "TEXT NOT NULL DEFAULT 'photograph'"], ['obj_dims', 'TEXT'], ['obj_edition', 'TEXT'], ['obj_made', 'TEXT'], ['obj_signed', 'TEXT'], ['obj_condition', 'TEXT'], ['obj_located', 'TEXT'], ['obj_note', 'TEXT']]) if (!db.prepare(`SELECT 1 FROM pragma_table_info('works') WHERE name='${c}'`).get()) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  // The cabinet's columns, added once the cabinet exists (it is mounted after this module).
  const cabinetCols = () => { if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cabinet'").get()) return false; for (const [c, t] of [['acquired', 'TEXT'], ['from_whom', 'TEXT'], ['paid_cents', 'INTEGER'], ['value_cents', 'INTEGER'], ['located', 'TEXT'], ['condition', 'TEXT'], ['provenance', 'TEXT'], ['work_id', 'INTEGER'], ['accession', 'TEXT']]) if (!db.prepare(`SELECT 1 FROM pragma_table_info('cabinet') WHERE name='${c}'`).get()) db.exec(`ALTER TABLE cabinet ADD COLUMN ${c} ${t}`); return true; };
  setImmediate(cabinetCols);
  const t = (v, n) => { const s = String(v == null ? '' : v).replace(/<[^>]*>/g, '').trim().slice(0, n); return s || null; };

  // The object record on a work (the maker's, or the house's).
  const setObject = (w, b) => {
    const kind = KINDS[b.kind] ? b.kind : kindOf(w);
    db.prepare('UPDATE works SET kind=?, medium=COALESCE(?, medium), obj_dims=?, obj_edition=?, obj_made=?, obj_signed=?, obj_condition=?, obj_located=?, obj_note=? WHERE id=?')
      .run(kind, t(b.medium, 120), t(b.dims, 80), t(b.edition, 60), t(b.made, 200), t(b.signed, 120), t(b.condition, 200), t(b.located, 200), t(b.note, 600), w.id);
    ledger.append(db, 'work.object', w.slug, { kind, medium: t(b.medium, 120) || undefined, dims: t(b.dims, 80) || undefined, edition: t(b.edition, 60) || undefined });
    if (app.locals.findIndexDirty) app.locals.findIndexDirty();
  };
  app.post('/account/works/:slug/object', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const w = db.prepare('SELECT * FROM works WHERE slug=? AND maker_id=?').get(req.params.slug, m.id); if (!w) return res.sendStatus(404);
    setObject(w, req.body || {}); res.redirect(303, `/account/works/${encodeURIComponent(w.slug)}?ok=object`);
  });
  app.post('/studio/works/:slug/object', studioOnly, (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(req.params.slug); if (!w) return res.sendStatus(404);
    setObject(w, req.body || {}); res.redirect(303, `/studio/works/${encodeURIComponent(w.slug)}?ok=object`);
  });
  const block = (w, action) => `<section class="ob-set"><h2>The object</h2><p class="note">What kind of work this is. For a painting, a drawing, a sculpture or any physical piece, the file the house holds is the photograph of record, and the object has a record of its own: it is what a museum's registrar would write on the card. Where it is, and your note, are seen by you and the house alone.</p>
<form method="post" action="${action}" class="ob-f"><label>Kind<select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${kindOf(w) === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
<label>Medium<input name="medium" maxlength="120" value="${esc(w.medium || '')}" placeholder="oil on linen · gelatin silver print · bronze"></label>
<label>Dimensions<input name="dims" maxlength="80" value="${esc(w.obj_dims || '')}" placeholder="61 × 46 cm · 24 × 18 in · h 40 cm"></label>
<label>Edition<input name="edition" maxlength="60" value="${esc(w.obj_edition || '')}" placeholder="unique · 3 of 25 · artist's proof"></label>
<label>Made<input name="made" maxlength="200" value="${esc(w.obj_made || '')}" placeholder="where and how"></label>
<label>Signed<input name="signed" maxlength="120" value="${esc(w.obj_signed || '')}" placeholder="signed and dated lower right"></label>
<label>Condition<input name="condition" maxlength="200" value="${esc(w.obj_condition || '')}" placeholder="excellent · a small loss at the lower left corner"></label>
<label>Where it is (private)<input name="located" maxlength="200" value="${esc(w.obj_located || '')}" placeholder="the studio · on loan to …"></label>
<label class="ob-wide">A note (private)<textarea name="note" maxlength="600" rows="2">${esc(w.obj_note || '')}</textarea></label>
<button class="buy-btn">Keep</button></form></section>`;
  // The label under the plate, for a physical work.
  const label = w => (physical(w) ? `<p class="ob-label">${esc([w.medium, w.obj_dims, w.obj_edition].filter(Boolean).join(' · '))}${w.medium || w.obj_dims || w.obj_edition ? ' · ' : ''}<a href="/w/${esc(w.slug)}/object">The object</a></p>` : '');
  // The Shield's row.
  const shieldRow = w => { if (!physical(w)) return null; const bits = [kindWord(w), w.medium ? esc(w.medium) : null, w.obj_dims ? esc(w.obj_dims) : null].filter(Boolean).join(', '); return { k: 'The object', v: `${bits}. The held file is the photograph of record. <a href="/w/${esc(w.slug)}/object">Its label</a>` }; };

  // The object's label and certificate.
  app.get('/w/:slug/object', (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(req.params.slug); if (!w) return res.sendStatus(404);
    const m = mk(w); const me = makerOf(req); const own = (me && me.id === w.maker_id) || isStudio(req);
    if (w.status !== 'held' && !own) return res.sendStatus(404);
    const reg = db.prepare("SELECT seq, at FROM ledger WHERE type='work.registered' AND subject=? ORDER BY seq LIMIT 1").get(w.slug);
    const pub = db.prepare("SELECT at FROM ledger WHERE type='work.published' AND subject=? ORDER BY seq LIMIT 1").get(w.slug);
    const yr = (w.taken_at || '').slice(0, 4);
    const rows = [['Artist', m ? `<a href="/m/${esc(V.makerSlug(m))}">${esc(m.name)}</a>` : ''], ['Title', esc(tidy(w.title))], ['Date', esc(yr)], ['Kind', kindWord(w)], ['Medium', esc(w.medium || '')], ['Dimensions', esc(w.obj_dims || '')], ['Edition', esc(w.obj_edition || '')], ['Made', esc(w.obj_made || '')], ['Signed', esc(w.obj_signed || '')], ['Condition', esc(w.obj_condition || '')], ['Accession', esc(w.accession || '')], own ? ['Where it is (private)', esc(w.obj_located || '')] : null, own ? ['Note (private)', esc(w.obj_note || '')] : null].filter(r => r && r[1]);
    res.send(V.layout({ title: `${tidy(w.title)} · The object`, path: '/w', body: `<article class="ob"><p class="k">The object</p><h1>${esc(tidy(w.title))}</h1><p class="lede">${aBy(w, m ? esc(m.name) : '')}${yr ? `, ${esc(yr)}` : ''}.</p>
<figure class="ob-fig"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}"><figcaption>The photograph of record${w.camera ? `, made on ${esc(w.camera)}` : ''}.</figcaption></figure>
<dl class="ob-dl">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
<h2>What the house attests</h2>
<p>The house holds the photograph of record of this ${kindWord(w).toLowerCase()}, byte for byte, with its fingerprint <code>${esc(w.sha256.slice(0, 16))}…</code>${reg ? ` entered on the register as No. ${reg.seq} on ${esc(String(reg.at).slice(0, 10))}` : ''}; the maker's <a href="/w/${esc(w.slug)}/deed">deed of authorship</a>${pub ? `, attested at publication on ${esc(String(pub.at).slice(0, 10))}` : ''}; and this record, written by the maker${w.obj_condition ? ' with its condition' : ''}. Anyone with a copy of the photograph can <a href="/verify">check it against the register</a>.</p>
<p>The house does not hold the object itself and does not say where it is. Title to the object passes outside the house; a licence or a Collect here is a licence to the photograph of record, not a sale of the object, unless the maker's terms say otherwise.</p>
<p class="note"><a href="/w/${esc(w.slug)}">The work</a> · <a href="/w/${esc(w.slug)}/deed">The deed</a> · <a href="/w/${esc(w.slug)}/life">Its life</a>${own ? ` · <a href="/account/works/${esc(w.slug)}#the-object">Edit the record</a>` : ''}</p></article>` }));
  });

  // The cabinet as a registrar's book.
  const money = c => (c == null ? '' : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`);
  app.post('/cabinet/:id/record', (req, res) => {
    cabinetCols();
    const b = app.locals.buyerOf(req); const c = db.prepare('SELECT * FROM cabinet WHERE id=?').get(Number(req.params.id)); if (!b || !c || c.buyer_id !== b.id) return res.sendStatus(404);
    const x = req.body || {}; const cents = v => { const n = Math.round(parseFloat(String(v || '').replace(/[^0-9.]/g, '')) * 100); return Number.isFinite(n) && n >= 0 ? n : null; };
    let workId = null; if (x.work) { const w = db.prepare("SELECT id FROM works WHERE (slug=? OR accession=?) AND status IN ('held','hidden')").get(String(x.work).trim(), String(x.work).trim()); workId = w ? w.id : null; }
    db.prepare('UPDATE cabinet SET acquired=?, from_whom=?, paid_cents=?, value_cents=?, located=?, condition=?, provenance=?, work_id=?, accession=? WHERE id=?').run(t(x.acquired, 40), t(x.from_whom, 160), cents(x.paid), cents(x.value), t(x.located, 160), t(x.condition, 200), t(x.provenance, 1200), workId, t(x.accession, 40), c.id);
    res.redirect('/yours?tab=cabinet&cab=recorded#cab-' + c.id);
  });
  const recordForm = c => { const w = c.work_id ? db.prepare('SELECT w.slug, w.title, m.name FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.id=?').get(c.work_id) : null; return `<form method="post" action="/cabinet/${c.id}/record" class="cl-f cb-rec" id="cab-${c.id}"><h4>The registrar's card <small>· private</small></h4>
<div class="cb-run"><label><span>Your accession no.</span><input name="accession" maxlength="40" value="${esc(c.accession || '')}" placeholder="2026.004"></label><label><span>Acquired</span><input name="acquired" maxlength="40" value="${esc(c.acquired || '')}" placeholder="2024-05 · a date"></label><label><span>From</span><input name="from_whom" maxlength="160" value="${esc(c.from_whom || '')}" placeholder="the artist · a gallery · an auction"></label></div>
<div class="cb-run"><label><span>Paid</span><input name="paid" inputmode="decimal" value="${c.paid_cents != null ? (c.paid_cents / 100) : ''}" placeholder="$"></label><label><span>Insured value</span><input name="value" inputmode="decimal" value="${c.value_cents != null ? (c.value_cents / 100) : ''}" placeholder="$"></label><label><span>Where it is</span><input name="located" maxlength="160" value="${esc(c.located || '')}" placeholder="the hall · storage · on loan"></label></div>
<label><span>Condition</span><input name="condition" maxlength="200" value="${esc(c.condition || '')}"></label>
<label><span>Provenance</span><textarea name="provenance" rows="2" maxlength="1200" placeholder="where it has been, in order">${esc(c.provenance || '')}</textarea></label>
<label><span>A Watermark work this is the physical edition of (its address or accession)</span><input name="work" value="${w ? esc(w.slug) : ''}" placeholder="the-staircase">${w ? `<small>Linked: <a href="/w/${esc(w.slug)}">${esc(tidy(w.title))}</a> by ${esc(w.name)} · <a href="/w/${esc(w.slug)}/deed">the deed</a></small>` : ''}</label>
<button class="link">Keep the card</button></form>`; };
  app.locals.cabinetRecord = c => { cabinetCols(); return recordForm(c); };
  const book = b => db.prepare('SELECT c.*, w.slug AS wslug, w.title AS wtitle, m.name AS wmaker FROM cabinet c LEFT JOIN works w ON w.id=c.work_id LEFT JOIN makers m ON m.id=w.maker_id WHERE c.buyer_id=? ORDER BY c.accession IS NULL, c.accession, c.id').all(b.id);
  app.get('/yours/cabinet/book', (req, res) => {
    cabinetCols();
    const b = app.locals.buyerOf(req); if (!b) return res.redirect('/signin?back=/yours/cabinet/book');
    const rows = book(b); const total = rows.reduce((s, c) => s + (c.value_cents || 0), 0), paid = rows.reduce((s, c) => s + (c.paid_cents || 0), 0);
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'Your cabinet, the book · Watermark', path: '/yours', body: `<article class="cb-book"><p class="k">Your cabinet</p><h1>The book.</h1><p class="lede">Your collection as a registrar keeps it: ${rows.length} work${rows.length === 1 ? '' : 's'}${total ? `, insured at ${money(total)}` : ''}${paid ? `, ${money(paid)} paid` : ''}. Seen by you alone. <a href="/yours/cabinet.csv">Take it out as a spreadsheet</a> · <a href="/yours?tab=cabinet">Back to the cabinet</a></p>
<table class="tbl cb-tbl"><tr><th>No.</th><th></th><th>Title</th><th>Artist</th><th>Date</th><th>Medium</th><th>Dimensions</th><th>Acquired</th><th>From</th><th>Paid</th><th>Value</th><th>Where</th><th>Condition</th><th>Watermark</th></tr>
${rows.map(c => `<tr><td>${esc(c.accession || '')}</td><td><img src="/cab/${c.id}/thumb" alt="" loading="lazy"></td><td>${esc(tidy(c.title))}</td><td>${esc(c.artist || c.wmaker || '')}</td><td>${esc(c.year || '')}</td><td>${esc(c.medium || '')}</td><td>${esc(c.dims || '')}</td><td>${esc(c.acquired || '')}</td><td>${esc(c.from_whom || '')}</td><td>${money(c.paid_cents)}</td><td>${money(c.value_cents)}</td><td>${esc(c.located || '')}</td><td>${esc(c.condition || '')}</td><td>${c.wslug ? `<a href="/w/${esc(c.wslug)}">${esc(tidy(c.wtitle))}</a>` : ''}</td></tr>`).join('')}</table></article>` }));
  });
  app.get('/yours/cabinet.csv', (req, res) => {
    cabinetCols();
    const b = app.locals.buyerOf(req); if (!b) return res.sendStatus(401);
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = ['accession', 'title', 'artist', 'date', 'medium', 'dimensions', 'acquired', 'from', 'paid_usd', 'insured_value_usd', 'located', 'condition', 'provenance', 'note', 'watermark_work', 'fingerprint'];
    const lines = book(b).map(c => [c.accession, c.title, c.artist || c.wmaker, c.year, c.medium, c.dims, c.acquired, c.from_whom, c.paid_cents != null ? c.paid_cents / 100 : '', c.value_cents != null ? c.value_cents / 100 : '', c.located, c.condition, c.provenance, c.note, c.wslug ? `${app.locals.C ? app.locals.C.base : ''}/w/${c.wslug}` : '', c.sha256].map(q).join(','));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="cabinet.csv"', 'Cache-Control': 'private, no-store' }).send([head.join(','), ...lines].join('\n'));
  });

  app.locals.object = { KINDS, kindOf, kindWord, by, aBy, physical, block, label, shieldRow };
  return app.locals.object;
}
module.exports = { mountObject, KINDS, kindOf, kindWord, by, aBy, physical };
