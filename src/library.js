// The Library. Written work, kept the way the photographs are kept: books, journals, essays, papers and
// important digital copies of documents, shelved by kind, read in the house for nothing. To take a copy
// (the file, or a set page), or to use it elsewhere, you pay, and the taking is recorded on the register.
// Texts are shelved from the Studio: a body of text set by the house, or a PDF held in the vault (texts/).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');
const PDFDocument = require('pdfkit');
const { layout, esc, money, date, tidy } = require('./views');

const KINDS = [['book', 'Books'], ['photobook', 'Photo books'], ['almanack', 'Almanacks'], ['journal', 'Journals'], ['essay', 'Essays'], ['paper', 'Papers'], ['document', 'Documents'], ['history', 'Art history']];
const kindName = k => (KINDS.find(x => x[0] === k) || KINDS[2])[1];
const slugify = s => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// Set the text: paragraphs, headings (# or ##), quotations (>), rules (---). Escaped first; nothing else is HTML.
function set(body) {
  return String(body || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => {
    if (/^#{1,2}\s/.test(p)) return `<h2>${esc(p.replace(/^#+\s*/, ''))}</h2>`;
    if (/^---+$/.test(p)) return '<hr>';
    if (/^>\s?/.test(p)) return `<blockquote>${esc(p.replace(/^>\s?/gm, '')).replace(/\n/g, '<br>')}</blockquote>`;
    return `<p>${esc(p).replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
}
const words = body => String(body || '').split(/\s+/).filter(Boolean).length;

function mountLibrary(app, { db, C, store, stripe, isStudio, studioOnly, buyerOf, setBuyer, ledger, mail, upload, V, S }) {
  db.exec(`CREATE TABLE IF NOT EXISTS texts (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, kind TEXT NOT NULL DEFAULT 'essay', title TEXT NOT NULL, author TEXT, maker_id INTEGER, year TEXT,
    summary TEXT, body TEXT, file TEXT, pages INTEGER, bytes INTEGER, sha256 TEXT, public INTEGER NOT NULL DEFAULT 1, price_cents INTEGER, terms TEXT, source TEXT, cover_work_id INTEGER,
    status TEXT NOT NULL DEFAULT 'held', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
    CREATE TABLE IF NOT EXISTS text_orders (id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, text_id INTEGER NOT NULL, buyer_id INTEGER, email TEXT, status TEXT NOT NULL DEFAULT 'pending', stripe_session TEXT, token TEXT UNIQUE, price_cents INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT)`);
  try { db.exec('ALTER TABLE texts ADD COLUMN plates TEXT'); } catch (e) { /* has it */ } // a photo book's plates (reading.js)
  for (const c of ['pictures TEXT', 'illustrator TEXT']) { try { db.exec(`ALTER TABLE texts ADD COLUMN ${c}`); } catch (e) { /* has it */ } } // the pictures in the books (bookplates.js)
  const texts = () => db.prepare("SELECT t.*, w.slug AS cover, w.width, w.height FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' ORDER BY t.kind, t.year DESC, t.id DESC").all();
  const one = slug => db.prepare("SELECT t.*, w.slug AS cover, w.width, w.height, w.title AS cover_title FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.slug=?").get(String(slug || ''));
  const nextRef = () => `WL-${new Date().getUTCFullYear()}-${String(db.prepare('SELECT COUNT(*) n FROM text_orders').get().n + 1).padStart(5, '0')}`;
  const taken = t => db.prepare("SELECT COUNT(*) n FROM text_orders WHERE text_id=? AND status='paid'").get(t.id).n;
  const mineOf = (req, t) => { const b = buyerOf(req); return b ? db.prepare("SELECT * FROM text_orders WHERE text_id=? AND buyer_id=? AND status='paid' ORDER BY id DESC LIMIT 1").get(t.id, b.id) : null; };

  app.get('/library', (req, res) => {
    const all = texts().filter(t => t.public || isStudio(req));
    const shelves = KINDS.map(([k, name]) => ({ key: k, name, texts: all.filter(t => t.kind === k) })).filter(s => s.texts.length);
    res.send(V.library({ shelves, n: all.length }));
  });
  app.get('/library/:slug', (req, res) => {
    const t = one(req.params.slug); if (!t || (t.status !== 'held' && !isStudio(req))) return res.status(404).send(V.notFound({}));
    const mine = mineOf(req, t);
    const J = app.locals.jacket;
    res.send(V.text({ t, html: t.body ? set(t.body) : '', words: words(t.body), mine, taken: taken(t), stripe: !!stripe, ok: req.query.ok || null, studio: isStudio(req), front: J && t.public ? J.front(t) : '', back: J && t.public ? J.back(t) : '', jacketDesk: J && isStudio(req) ? J.studioLine(t) : '', plates: app.locals.bookplates ? app.locals.bookplates.strip(t, { studio: isStudio(req) }) : '', shop: app.locals.bookshop ? app.locals.bookshop.block(t, req) : '', shelf: app.locals.readingList && t.public ? app.locals.readingList.buttons(req, t, { back: `/library/${t.slug}` }) : '' }));
  });
  // Reading a held PDF in the house: inline, never as an attachment. (A determined reader can save it; the
  // taking that matters, with its license, is the one paid for and recorded.)
  app.get('/library/:slug/read', async (req, res) => {
    const t = one(req.params.slug); if (!t || !t.file || (!t.public && !isStudio(req))) return res.sendStatus(404);
    const buf = await store.get('texts/' + t.file); if (!buf) return res.sendStatus(404);
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', `inline; filename="${t.slug}.pdf"`).set('Cache-Control', 'private, max-age=600').send(buf);
  });

  // Taking a copy: a payment, a token, a file. Free texts are taken at once.
  app.post('/library/:slug/take', async (req, res) => {
    const t = one(req.params.slug); if (!t || t.status !== 'held' || t.price_cents == null) return res.redirect(`/library/${t ? t.slug : ''}`);
    let b = buyerOf(req);
    if (!b) { const id = db.prepare("INSERT INTO buyers (customer, email) VALUES ('', NULL)").run().lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); }
    const ref = nextRef();
    const FEE = require('./fee'); const total = FEE.on() && t.maker_id ? t.price_cents + FEE.premium(t.price_cents) : t.price_cents; // the maker's price; the house's share on top
    db.prepare('INSERT INTO text_orders (ref, text_id, buyer_id, email, price_cents, status) VALUES (?,?,?,?,?,?)').run(ref, t.id, b.id, b.email || null, total, 'pending');
    if (!t.price_cents) { settle(ref, null); return res.redirect(`/library/${t.slug}?ok=taken`); }
    if (!stripe) return res.redirect(`/library/${t.slug}?ok=nopay`);
    try {
      const s = await stripe.checkout.sessions.create({ mode: 'payment', ...(b.customer ? { customer: b.customer } : { customer_creation: 'always' }),
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: total, product_data: { name: `${tidy(t.title)} — a copy from the Watermark Library`, description: `${kindName(t.kind)}${t.author ? ` by ${t.author}` : ''}. Yours to keep and read; not for republication.` } } }],
        metadata: { library: ref }, payment_intent_data: { metadata: { library: ref } },
        success_url: `${C.base}/library/${t.slug}/thanks?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${C.base}/library/${t.slug}` });
      db.prepare('UPDATE text_orders SET stripe_session=? WHERE ref=?').run(s.id, ref);
      res.redirect(303, s.url);
    } catch (e) { console.error('[library]', e.message); db.prepare("DELETE FROM text_orders WHERE ref=? AND status='pending'").run(ref); res.redirect(`/library/${t.slug}?ok=unavailable`); }
  });
  function settle(ref, s) {
    const o = db.prepare('SELECT * FROM text_orders WHERE ref=?').get(ref); if (!o || o.status === 'paid') return o;
    const email = s && s.customer_details && s.customer_details.email ? s.customer_details.email : o.email;
    db.prepare("UPDATE text_orders SET status='paid', paid_at=datetime('now'), token=?, email=COALESCE(?, email), price_cents=COALESCE(?, price_cents) WHERE ref=?").run(nanoid(32), email, s ? s.amount_total : null, ref);
    if (s && s.customer && o.buyer_id) db.prepare("UPDATE buyers SET customer=COALESCE(NULLIF(customer,''), ?), email=COALESCE(email, ?) WHERE id=?").run(s.customer, email, o.buyer_id);
    const t = db.prepare('SELECT * FROM texts WHERE id=?').get(o.text_id);
    ledger.append(db, 'text.taken', t.slug, { ref, paid: !!(s && s.amount_total) });
    const g = db.prepare('SELECT * FROM text_orders WHERE ref=?').get(ref);
    if (g.email) mail.send({ to: g.email, subject: `Your copy of "${tidy(t.title)}" (${ref})`, cta: { label: 'Take your copy', url: `${C.base}/library/d/${g.token}` }, text: `Thank you. Your copy of "${tidy(t.title)}" from the Watermark Library is ready:\n\n${C.base}/library/d/${g.token}\n\nIt is yours to keep and read. It is not for republication; for that, write to the house.\n\nReference: ${ref}` });
    return g;
  }
  app.get('/library/:slug/thanks', async (req, res) => {
    const t = one(req.params.slug); if (!t) return res.redirect('/library');
    const o = db.prepare('SELECT * FROM text_orders WHERE text_id=? AND stripe_session=?').get(t.id, String(req.query.session_id || ''));
    if (!o) return res.redirect(`/library/${t.slug}`);
    if (o.status !== 'paid' && stripe) { try { const s = await stripe.checkout.sessions.retrieve(o.stripe_session); if (s.payment_status === 'paid') settle(o.ref, s); } catch (e) { /* the webhook will */ } }
    res.redirect(`/library/${t.slug}?ok=taken`);
  });
  app.locals.libraryEvent = event => {
    if (event.type !== 'checkout.session.completed') return; const s = event.data.object;
    if (s.metadata && s.metadata.library && s.payment_status === 'paid') settle(s.metadata.library, s);
  };
  // The copy itself: the held PDF, or the text set as a PDF by the house.
  app.get('/library/d/:token', async (req, res) => {
    const o = db.prepare("SELECT o.*, t.* FROM text_orders o JOIN texts t ON t.id=o.text_id WHERE o.token=? AND o.status='paid'").get(String(req.params.token));
    if (!o) return res.sendStatus(404);
    res.set('Content-Disposition', `attachment; filename="${o.slug}.pdf"`).set('Content-Type', 'application/pdf');
    if (o.file) { const buf = await store.get('texts/' + o.file); if (!buf) return res.sendStatus(404); return res.send(buf); }
    const doc = new PDFDocument({ size: 'A5', margins: { top: 64, bottom: 64, left: 56, right: 56 } }); doc.pipe(res);
    doc.font('Times-Roman').fontSize(9).fillColor('#777').text('WATERMARK LIBRARY', { characterSpacing: 2 }).moveDown(3);
    doc.fontSize(24).fillColor('#000').text(tidy(o.title)); if (o.author) doc.moveDown(0.4).fontSize(12).fillColor('#444').text(o.author); if (o.year) doc.fontSize(11).fillColor('#777').text(String(o.year));
    doc.addPage();
    for (const p of String(o.body || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) {
      if (/^#{1,2}\s/.test(p)) { doc.moveDown(0.6).fontSize(15).fillColor('#000').text(p.replace(/^#+\s*/, '')).moveDown(0.3); }
      else if (/^>\s?/.test(p)) { doc.fontSize(11).fillColor('#444').text(p.replace(/^>\s?/gm, ''), { indent: 18 }).moveDown(0.5); }
      else doc.fontSize(11.5).fillColor('#111').text(p, { align: 'left', lineGap: 2 }).moveDown(0.6);
    }
    doc.moveDown(2).fontSize(8).fillColor('#999').text(`A copy from the Watermark Library, ${o.ref}, taken ${String(o.paid_at || '').slice(0, 10)}. Yours to keep and read; not for republication.`);
    doc.end();
  });

  // ---- Studio: shelving ----
  app.get('/studio/library', studioOnly, (req, res) => res.send(S.library({ list: db.prepare('SELECT * FROM texts ORDER BY id DESC').all(), ok: req.query.ok || null, kinds: KINDS })));
  app.get('/studio/library/:slug', studioOnly, (req, res) => { const t = one(req.params.slug); if (!t) return res.sendStatus(404); res.send(S.libraryEdit({ t, kinds: KINDS, ok: req.query.ok || null })); });
  app.post('/studio/library', studioOnly, (req, res, next) => upload().single('file')(req, res, next), async (req, res) => {
    const b = req.body || {}, t = (v, n) => String(v || '').trim().slice(0, n) || null;
    const title = t(b.title, 200); if (!title) return res.redirect('/studio/library?ok=A+title+is+needed.');
    const id = b.id ? Number(b.id) : null;
    let slug = id ? db.prepare('SELECT slug FROM texts WHERE id=?').get(id).slug : slugify(title) || `text-${Date.now()}`;
    if (!id) { let i = 2; const base = slug; while (db.prepare('SELECT 1 FROM texts WHERE slug=?').get(slug)) slug = `${base}-${i++}`; }
    const kind = KINDS.some(k => k[0] === b.kind) ? b.kind : 'essay';
    const cover = b.cover ? db.prepare('SELECT id FROM works WHERE slug=?').get(String(b.cover).trim()) : null;
    const price = String(b.price || '').trim(); const cents = price === '' ? null : Math.max(0, Math.round(Number(price) || 0)) * 100;
    let file = null, pages = null, bytes = null, sha = null;
    if (req.file) {
      try {
        const buf = fs.readFileSync(req.file.path); sha = crypto.createHash('sha256').update(buf).digest('hex'); bytes = buf.length;
        file = `${slug}-${sha.slice(0, 8)}.pdf`; await store.put('texts/' + file, req.file.path, 'application/pdf');
        const m = buf.toString('latin1').match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/); pages = m ? Number(m[1]) : null;
      } catch (e) { console.error('[library] file', e.message); }
      finally { try { fs.unlinkSync(req.file.path); } catch (e) { /* gone */ } }
    }
    if (id) {
      db.prepare(`UPDATE texts SET kind=?, title=?, author=?, year=?, summary=?, body=?, public=?, price_cents=?, terms=?, source=?, cover_work_id=?, status=?, updated_at=datetime('now')${file ? ', file=?, pages=?, bytes=?, sha256=?' : ''} WHERE id=?`)
        .run(...[kind, title, t(b.author, 160), t(b.year, 12), t(b.summary, 1000), t(b.body, 400000), b.public ? 1 : 0, cents, t(b.terms, 400), t(b.source, 300), cover ? cover.id : null, b.status === 'private' ? 'private' : 'held', ...(file ? [file, pages, bytes, sha] : []), id]);
    } else {
      db.prepare('INSERT INTO texts (slug, kind, title, author, year, summary, body, file, pages, bytes, sha256, public, price_cents, terms, source, cover_work_id, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(slug, kind, title, t(b.author, 160), t(b.year, 12), t(b.summary, 1000), t(b.body, 400000), file, pages, bytes, sha, b.public ? 1 : 0, cents, t(b.terms, 400), t(b.source, 300), cover ? cover.id : null, b.status === 'private' ? 'private' : 'held');
      ledger.append(db, 'text.shelved', slug, { kind, title, sha256: sha });
    }
    res.redirect(`/studio/library/${slug}?ok=Shelved.`);
  });
  app.locals.library = { KINDS, kindName, set, texts, one };
  return app.locals.library;
}

// ---- Pages ----
function library({ shelves, n }) {
  const card = t => `<a class="lb-c" href="/library/${esc(t.slug)}">${t.cover ? `<span class="lb-cv" style="--r:${t.width && t.height ? (t.width / t.height).toFixed(3) : 1.5}"><img src="/img/${esc(t.cover)}/thumb" alt="" loading="lazy"></span>` : `<span class="lb-cv lb-cv-t"><i>${esc(tidy(t.title).slice(0, 60))}</i></span>`}<span class="lb-t"><b>${esc(tidy(t.title))}</b><small>${esc(t.author || 'The house')}${t.year ? ` · ${esc(t.year)}` : ''}</small><em>${t.public ? 'Read here' : 'Held'}${t.price_cents != null ? ` · take a copy, ${t.price_cents ? money(t.price_cents) : 'free'}` : ''}</em></span></a>`;
  return layout({ title: 'The Library · Watermark', desc: 'Books, journals, essays, papers and documents, kept with the photographs. Read in the house; take a copy to keep.', path: '/library', body: `<section class="cx-intro lb-intro"><p class="k">The Library</p><h1>Read in the house.</h1>
<p class="lede">Written work, kept the way the photographs are kept: books, journals, essays, papers and the important documents, each fingerprinted and on the register. Everything on the shelves is read here for nothing. To take a copy, or to use it elsewhere, you pay, and the taking is recorded. No advertising, ever.</p></section>
${shelves.length ? shelves.map(s => `<section class="gal lb-shelf"><header class="gh"><h2>${esc(s.name)}</h2><span>${s.texts.length}</span></header><div class="lb-grid">${s.texts.map(card).join('')}</div></section>`).join('') : '<section class="gal"><p class="note">The shelves are being filled. The first volumes are on their way.</p></section>'}
<section class="gal"><p class="note lb-note">A writer, a scholar, an estate with papers that should be kept? <a href="/join">Apply with the work</a>.</p></section>` });
}
const byName = a => { const x = String(a || '').trim(); if (!x) return ''; const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}`.replace(/\s+/g, ' ') : x; };
function text({ t, html, words, mine, taken, stripe, ok, studio, shop = '', shelf = '', front = '', back = '', jacketDesk = '', plates = '' }) {
  const notice = { 'jacket-written': 'The jacket is written.', 'jacket-hidden': 'The jacket is hidden.', 'jacket-shown': 'The jacket is shown.', 'jacket-off': 'The house’s AI is not switched on (ANTHROPIC_API_KEY).', 'jacket-failed': 'The jacket could not be written; see the log.', taken: 'Your copy is ready; it has been sent to your mail, and is below.', nopay: 'Payments are not switched on for this house yet.', unavailable: 'The payment could not be started. Try again in a moment.' }[ok];
  const take = t.price_cents == null ? '' : mine ? `<p class="lb-take"><a class="buy-btn" href="/library/d/${esc(mine.token)}">Take your copy (PDF)</a><small>${esc(mine.ref)}</small></p>`
    : `<form method="post" action="/library/${esc(t.slug)}/take" class="lb-take"><button class="buy-btn">${t.price_cents ? `Take a copy, ${money(t.price_cents)}` : 'Take a copy, free'}</button><small>Yours to keep and read. Not for republication; for a use elsewhere, <a href="mailto:house@watermark.krafftco.com?subject=${encodeURIComponent('Use of ' + tidy(t.title))}">write to the house</a>.</small></form>`;
  return layout({ title: `${tidy(t.title)} · The Library · Watermark`, desc: t.summary || `${kindName(t.kind)} in the Watermark Library.`, path: `/library/${t.slug}`, image: t.public ? `/read/${t.slug}/card.png` : null, type: 'book', body: `<article class="lb-read">
<header class="lb-head">${t.cover ? `<a class="lb-hero" href="/w/${esc(t.cover)}"><img src="/img/${esc(t.cover)}/large" alt="${esc(tidy(t.cover_title || ''))}"></a>` : ''}
<p class="k"><a href="/library">The Library</a> · ${esc(kindName(t.kind))}</p><h1>${esc(tidy(t.title))}</h1>
<p class="lb-by">${esc(byName(t.author) || 'The house')}${t.year ? ` · ${esc(t.year)}` : ''}${t.pages ? ` · ${t.pages} pages` : words ? ` · ${words.toLocaleString()} words` : ''}${taken ? ` · taken ${taken} time${taken === 1 ? '' : 's'}` : ''}</p>
${t.summary && !front ? `<p class="lede">${esc(t.summary)}</p>` : ''}${notice ? `<p class="ok">${esc(notice)}</p>` : ''}${front}${shelf}${plates}${t.public && (t.body || t.plates) && !t.file ? `<p class="lb-take"><a class="buy-btn" href="/read/${esc(t.slug)}">${t.kind === 'photobook' ? 'Open the book' : 'Read it in the reading room'}</a><small>Set for reading: your size, your light, your place kept.${!t.price_cents ? ` <a href="/read/${esc(t.slug)}.pdf">Or the book set for paper (PDF).</a>` : ''}</small></p>` : ''}${take}${shop}${studio ? `<p class="note"><a href="/studio/library/${esc(t.slug)}">Edit in the Studio</a> ${jacketDesk}</p>` : ''}</header>
${t.public ? (t.file ? `<div class="lb-pdf"><iframe src="/library/${esc(t.slug)}/read" title="${esc(tidy(t.title))}"></iframe></div>` : html ? (t.kind === 'book' ? `<details class="lb-body lb-fold"><summary>The text, here on the page</summary>${html}</details>` : `<div class="lb-body">${html}</div>`) : '') : '<p class="note">This volume is held, not shown. Take a copy to read it.</p>'}
${back}${t.source ? `<p class="note lb-src">Source: ${esc(t.source)}</p>` : ''}${t.terms ? `<p class="note">${esc(t.terms)}</p>` : ''}
<p class="note lb-reg">${t.sha256 ? `Fingerprint <code>sha256:${esc(t.sha256.slice(0, 16))}…</code> · ` : ''}On the <a href="/ledger">register</a> as ${esc(t.slug)}.</p></article>` });
}
function libraryDesk({ list, ok, kinds }) {
  const { nav } = require('./studio-views');
  return layout({ studio: true, title: 'Library · Studio', body: `<section class="studio-wrap">${nav('/studio/library')}<h1>The Library.</h1>${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
<p class="lede">Shelve written work: set the text here, or hold a PDF in the vault. Public volumes are read in the house; a price lets anyone take a copy.</p>
<table class="tbl"><thead><tr><th>Title</th><th>Kind</th><th>Author</th><th>Read</th><th>Take</th><th>Status</th></tr></thead><tbody>${list.map(t => `<tr><td><a href="/studio/library/${esc(t.slug)}">${esc(t.title)}</a></td><td>${esc(kindName(t.kind))}</td><td>${esc(t.author || '')}</td><td>${t.public ? 'In the house' : 'Held'}</td><td>${t.price_cents == null ? '—' : t.price_cents ? money(t.price_cents) : 'Free'}</td><td>${esc(t.status)}</td></tr>`).join('') || '<tr><td colspan="6">Nothing shelved yet.</td></tr>'}</tbody></table>
<h2>Shelve a volume</h2>${libraryForm({ t: null, kinds })}</section>` });
}
function libraryEdit({ t, kinds, ok }) {
  const { nav } = require('./studio-views');
  return layout({ studio: true, title: `${t.title} · Library · Studio`, body: `<section class="studio-wrap">${nav('/studio/library')}<p class="k"><a href="/studio/library">The Library</a> · <a href="/library/${esc(t.slug)}">See it in the house</a></p><h1>${esc(t.title)}</h1>${ok ? `<p class="ok">${esc(ok)}</p>` : ''}${libraryForm({ t, kinds })}</section>` });
}
function libraryForm({ t, kinds }) {
  const v = k => esc((t && t[k]) || '');
  return `<form method="post" action="/studio/library" enctype="multipart/form-data" class="form cat-form lb-form">${t ? `<input type="hidden" name="id" value="${t.id}">` : ''}
<label>Title<input name="title" value="${v('title')}" required></label><label>Kind<select name="kind">${kinds.map(([k, n]) => `<option value="${k}" ${t && t.kind === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
<label>Author<input name="author" value="${v('author')}" placeholder="Who wrote it"></label><label>Year<input name="year" value="${v('year')}" placeholder="1952"></label>
<label class="wide">Summary<textarea name="summary" rows="2">${v('summary')}</textarea></label>
<label class="wide">The text <small>paragraphs separated by a blank line; # for a heading; > for a quotation</small><textarea name="body" rows="14">${v('body')}</textarea></label>
<label>Or a PDF${t && t.file ? ` <small>held: ${esc(t.file)}${t.pages ? `, ${t.pages} pages` : ''}</small>` : ''}<input type="file" name="file" accept="application/pdf"></label>
<label>Cover photograph <small>slug</small><input name="cover" value="${t && t.cover_work_id ? esc(String(t.cover || '')) : ''}" placeholder="the-dome-of-the-pantheon"></label>
<label>Price to take a copy, USD <small>blank: not for taking; 0: free</small><input name="price" type="number" min="0" step="1" value="${t && t.price_cents != null ? t.price_cents / 100 : ''}"></label>
<label>Source<input name="source" value="${v('source')}" placeholder="Where it comes from, or who gave it"></label>
<label class="wide">Terms <small>a line shown under it</small><input name="terms" value="${v('terms')}" placeholder="Reproduced by permission of the estate."></label>
<label class="chk"><input type="checkbox" name="public" value="1" ${!t || t.public ? 'checked' : ''}> Read in the house (public)</label>
<label class="chk"><input type="checkbox" name="status" value="private" ${t && t.status === 'private' ? 'checked' : ''}> Keep off the shelves for now</label>
<button>Shelve</button></form>`;
}

module.exports = { mountLibrary, library, text, libraryDesk, libraryEdit, KINDS, set };
