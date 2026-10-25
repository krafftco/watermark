// The Bookshop (Will, 24 Oct: "the best bookstore in the world; better than the Strand; a place for book lovers, for
// first editions, signed copies, prints and reprints, and for supporting the artist directly").
//   A book in the house has three shelves on its page: read it here (free in the public domain, or the e-edition at the
//   author's price, the Library's take); have it in paper (a reprint the house prints, or the maker's own stock); and the
//   rare shelf: first editions and signed copies, each one a real object, described, photographed when it can be,
//   offered by its seller (the maker, a collector, or the house) at the seller's price, the house's share on top as on
//   a photograph (FEE). A copy is bought with name, email and address → Stripe Checkout → `copy_orders`, moved along on
//   Studio → Bookshop (Asked → Packed → Sent → Delivered), the buyer written to at each step, the seller told to ship.
//   A 'first edition' or 'signed' is the seller's attestation, labelled as such until the house has an appraiser; the
//   register says a copy was offered and that one sold, never who. A want: 'tell me when a signed copy turns up', kept
//   by email and answered when one is offered. Counsel: consignment terms before the first collector-to-collector sale.
const KINDS = { first: 'First edition', signed: 'Signed copy', reprint: 'The house’s reprint', paper: 'In paper', proof: 'Proof or advance copy', other: 'A copy' };
const STEPS = { asked: 'Asked', packed: 'Packed', sent: 'Sent', done: 'Delivered', declined: 'Declined' };
function mountBookshop(app, { db, V, C, buyerOf, setBuyer, mail, ledger, isStudio, stripe, makerOf }) {
  const { esc, tidy, money } = V, FEE = require('./fee'), I = require('./icons');
  const HOUSE = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  db.exec(`CREATE TABLE IF NOT EXISTS copies (id INTEGER PRIMARY KEY, text_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'other', seller_kind TEXT NOT NULL DEFAULT 'house', seller_id INTEGER, line TEXT, condition TEXT, note TEXT,
      price_cents INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 1, photo_slug TEXT, attest INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'offered', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS copy_orders (id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, copy_id INTEGER NOT NULL, buyer_id INTEGER, email TEXT, ship_name TEXT, address TEXT, cents INTEGER NOT NULL, house_cents INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0, how TEXT, stripe_session TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT, moved_at TEXT);
    CREATE TABLE IF NOT EXISTS wants (id INTEGER PRIMARY KEY, text_id INTEGER NOT NULL, email TEXT NOT NULL, kind TEXT, buyer_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), told_at TEXT)`);
  const nextRef = () => `CB-${new Date().getUTCFullYear()}-${String(db.prepare('SELECT COUNT(*) n FROM copy_orders').get().n + 1).padStart(5, '0')}`;
  const text = id => db.prepare('SELECT t.*, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.id=?').get(id);
  const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x; };
  const sellerOf = c => c.seller_kind === 'maker' ? db.prepare('SELECT name, email, handle FROM makers WHERE id=?').get(c.seller_id) : c.seller_kind === 'buyer' ? db.prepare('SELECT name, email, code FROM buyers WHERE id=?').get(c.seller_id) : { name: 'The house', email: HOUSE };
  const sellerName = c => { const s = sellerOf(c); return c.seller_kind === 'house' ? 'the house' : c.seller_kind === 'maker' ? (s && s.name) || 'the maker' : 'a collector'; };
  const totalOf = c => FEE.on() ? c.price_cents + FEE.premium(c.price_cents) : c.price_cents;
  const offered = textId => db.prepare("SELECT * FROM copies WHERE text_id=? AND status='offered' AND qty>0 ORDER BY CASE kind WHEN 'first' THEN 0 WHEN 'signed' THEN 1 WHEN 'proof' THEN 2 WHEN 'reprint' THEN 3 ELSE 4 END, price_cents").all(textId);
  // The block on a book's page: the shelves, and the want.
  function block(t, req) {
    const cs = offered(t.id); const b = buyerOf ? buyerOf(req) : null;
    const row = c => `<li class="bs-copy"><div class="bs-ck"><b>${esc(KINDS[c.kind] || KINDS.other)}</b>${c.line ? `<span>${esc(c.line)}</span>` : ''}${c.condition ? `<small>${esc(c.condition)}</small>` : ''}${c.note ? `<p>${esc(c.note)}</p>` : ''}<small class="bs-sl">Offered by ${esc(sellerName(c))}${c.kind === 'first' || c.kind === 'signed' ? ' · as the seller attests' : ''}${c.qty > 1 ? ` · ${c.qty} copies` : ''}</small></div>${c.photo_slug ? `<a class="bs-cp" href="/w/${esc(c.photo_slug)}"><img src="/img/${esc(c.photo_slug)}/thumb" alt=""></a>` : ''}<form method="post" action="/bookshop/copy/${c.id}/buy" class="bs-buy"><b>${money(totalOf(c))}</b>${FEE.on() ? `<small>${money(c.price_cents)} to ${esc(sellerName(c))}; <a href="/share">the house’s share</a> on top</small>` : ''}<input name="name" placeholder="Your name" required value="${esc(b && b.name || '')}"><input name="email" type="email" placeholder="Email" required value="${esc(b && b.email || '')}"><input name="street" placeholder="Street" required><input name="city" placeholder="City" required><input name="state" placeholder="State" required maxlength="2"><input name="zip" placeholder="ZIP" required><button class="buy-btn">Buy it, shipped</button><small>United States only for now; elsewhere by letter.</small></form></li>`;
    return `<section class="bs" id="bookshop"><p class="k">The Bookshop</p><h2>${cs.length ? 'Have it in your hands.' : 'In your hands, soon.'}</h2>${cs.length ? `<ul class="bs-list">${cs.map(row).join('')}</ul>` : `<p class="note">No copy is offered today.</p>`}
<form method="post" action="/bookshop/want" class="bs-want"><input type="hidden" name="text" value="${esc(t.slug)}"><label>Tell me when a copy turns up<input name="email" type="email" placeholder="Email" required value="${esc(b && b.email || '')}"></label><select name="kind"><option value="">Any copy</option><option value="first">A first edition</option><option value="signed">A signed copy</option><option value="reprint">In paper</option></select><button class="buy-btn bs-wb">Tell me</button></form>
<p class="bs-fine">Every copy sold here is a real object, described by its seller and recorded by the house. A first edition or a signature is the seller’s attestation until the house has an appraiser. The price is the seller’s, every dollar${FEE.on() ? '; the house’s share is on top' : ''}.</p></section>`;
  }
  // The shop's front: the rare shelf, in paper, and the books by shelf.
  app.get('/bookshop', (req, res) => {
    const rare = db.prepare("SELECT c.*, t.title, t.author, t.slug, w.slug AS cover FROM copies c JOIN texts t ON t.id=c.text_id LEFT JOIN works w ON w.id=t.cover_work_id WHERE c.status='offered' AND c.qty>0 AND c.kind IN ('first','signed','proof') ORDER BY c.id DESC LIMIT 24").all();
    const paper = db.prepare("SELECT c.*, t.title, t.author, t.slug, w.slug AS cover FROM copies c JOIN texts t ON t.id=c.text_id LEFT JOIN works w ON w.id=t.cover_work_id WHERE c.status='offered' AND c.qty>0 AND c.kind IN ('reprint','paper','other') ORDER BY c.id DESC LIMIT 24").all();
    const books = db.prepare("SELECT t.*, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 ORDER BY t.id DESC LIMIT 60").all();
    const sold = db.prepare("SELECT COUNT(*) n FROM copy_orders WHERE paid=1").get().n;
    const card = c => `<a class="bs-card" href="/library/${esc(c.slug)}#bookshop">${c.photo_slug ? `<img src="/img/${esc(c.photo_slug)}/screen" alt="">` : c.cover ? `<img src="/img/${esc(c.cover)}/screen" alt="">` : `<span class="bs-spine"><b>${esc(c.title)}</b></span>`}<span class="bs-ct"><i>${esc(KINDS[c.kind] || '')}</i><b>${esc(c.title)}</b>${c.author ? `<em>${esc(byName(c.author))}</em>` : ''}${c.line ? `<span>${esc(c.line)}</span>` : ''}<small>${money(totalOf(c))}</small></span></a>`;
    const bk = t => `<a class="bs-card" href="/library/${esc(t.slug)}">${t.cover ? `<img src="/img/${esc(t.cover)}/screen" alt="">` : `<span class="bs-spine"><b>${esc(t.title)}</b></span>`}<span class="bs-ct"><b>${esc(t.title)}</b>${t.author ? `<em>${esc(byName(t.author))}</em>` : ''}<small>${t.price_cents ? money(t.price_cents) : 'Read free'}</small></span></a>`;
    const shelf = (k, h, line, list, fn, empty) => `<section class="bs-shelf"><header><p class="k">${k}</p><h2>${h}</h2><p class="lede">${line}</p></header>${list.length ? `<div class="bs-row">${list.map(fn).join('')}</div>` : `<p class="note">${empty}</p>`}</section>`;
    const SHELF = require('./shelf'); const onShelf = [...rare, ...paper].map(c => ({ title: c.title, author: c.author, slug: c.slug, cover: c.photo_slug || c.cover })).concat(books).filter((t, i, a) => a.findIndex(x => x.slug === t.slug) === i).slice(0, 8);
    const hero = SHELF.band({ books: onShelf, href: t => `/library/${t.slug}`, k: 'The Bookshop', line: 'Sell with the house.', act: { href: '#sell', text: 'How it works' } });
    res.send(V.layout({ title: 'The Bookshop · Watermark', path: '/bookshop', desc: 'First editions, signed copies, reprints and the e-editions: books bought from the people who made and kept them.', body: `<section class="bs-front">${hero}<header class="bs-h"><p class="k">Watermark Publishing</p><h1>The Bookshop.</h1><p class="lede">A bookshop for people who love books: first editions and signed copies from the makers and collectors who hold them, reprints from the house’s own press, and every book in the Library to read here. The price is the seller’s, every dollar${FEE.on() ? '; the house’s share is on top, as on a photograph' : ''}.${sold ? ` ${sold} ${sold === 1 ? 'copy has' : 'copies have'} gone to new shelves.` : ''}</p></header>
${shelf('The rare shelf', 'First editions and signed copies.', 'Each one a real object, described by the person offering it, photographed when it can be, recorded by the house when it sells.', rare, card, 'Nothing rare is on the shelf today. Leave a want on any book and the house writes when a copy turns up.')}
${shelf('In paper', 'Reprints and stock.', 'The house’s own reprints of the public domain, set as the reading room sets them, and makers’ own books from their shelves.', paper, card, 'The first reprints are being set.')}
${shelf('The Library', 'Every book, to read here.', 'The public domain free, the house’s editions at the author’s price, photo books a plate at a time.', books, bk, 'The shelf is being filled.')}
<section class="bs-for" id="sell"><h2>Sell from your shelf.</h2><p>Makers offer signed copies of their own books from their studio; collectors offer first editions from their galleries; the house reprints the public domain. Every copy is described, priced by its seller and shipped by its seller, and the house records the sale. <a href="/publishing">Watermark Publishing</a> · <a href="/library">The Library</a></p></section></section>` }));
  });
  // A want: told once, when a copy of that kind is offered.
  app.post('/bookshop/want', (req, res) => {
    const t = db.prepare('SELECT * FROM texts WHERE slug=?').get(String(req.body.text || '')); const email = String(req.body.email || '').trim().toLowerCase();
    if (!t || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect(t ? `/library/${t.slug}#bookshop` : '/bookshop');
    const b = buyerOf ? buyerOf(req) : null; const kind = String(req.body.kind || '') || null;
    if (!db.prepare('SELECT 1 FROM wants WHERE text_id=? AND email=? AND (kind IS ? OR kind=?)').get(t.id, email, kind, kind)) db.prepare('INSERT INTO wants (text_id, email, kind, buyer_id) VALUES (?,?,?,?)').run(t.id, email, kind, b ? b.id : null);
    res.redirect(`/library/${t.slug}?ok=${encodeURIComponent('The house will write when a copy turns up.')}#bookshop`);
  });
  function tellWants(c) {
    const t = text(c.text_id); const rows = db.prepare('SELECT * FROM wants WHERE text_id=? AND told_at IS NULL AND (kind IS NULL OR kind=?)').all(c.text_id, c.kind);
    for (const w of rows) { db.prepare("UPDATE wants SET told_at=datetime('now') WHERE id=?").run(w.id); try { mail.send({ to: w.email, subject: `A copy of ${tidy(t.title)} has turned up`, text: `${KINDS[c.kind] || 'A copy'}${c.line ? `: ${c.line}` : ''}. ${money(totalOf(c))}, shipped.\n\n${C.base}/library/${t.slug}#bookshop\n\nYou asked the house to tell you. It has.` }); } catch (e) { /* */ } }
  }
  // Offering a copy: the house (Studio), or a maker from their studio, or a collector from Yours.
  function offer(x, who) {
    const t = db.prepare('SELECT * FROM texts WHERE slug=? OR id=?').get(String(x.text || ''), Number(x.text) || 0); if (!t) throw new Error('No book by that address.');
    const kind = KINDS[x.kind] ? x.kind : 'other'; const price = Math.round(parseFloat(x.price) * 100); if (!(price > 0)) throw new Error('A price, in dollars.');
    const photo = x.photo ? (db.prepare("SELECT slug FROM works WHERE slug=? AND status='held'").get(String(x.photo).trim()) || {}).slug || null : null;
    const id = db.prepare('INSERT INTO copies (text_id, kind, seller_kind, seller_id, line, condition, note, price_cents, qty, photo_slug, attest) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(t.id, kind, who.kind, who.id || null, String(x.line || '').trim().slice(0, 160) || null, String(x.condition || '').trim().slice(0, 80) || null, String(x.note || '').trim().slice(0, 600) || null, price, Math.max(1, Math.min(99, parseInt(x.qty, 10) || 1)), photo, x.attest ? 1 : 0).lastInsertRowid;
    const c = db.prepare('SELECT * FROM copies WHERE id=?').get(id);
    try { ledger.append(db, 'copy.offered', t.slug, { kind, title: t.title, seller: who.kind, price_cents: price }); } catch (e) { /* */ }
    tellWants(c); return c;
  }
  app.post('/studio/bookshop/offer', (req, res) => { if (!isStudio(req)) return res.sendStatus(403); try { const b = req.body || {}; let who = { kind: 'house', id: null }; if (b.maker) { const m = db.prepare('SELECT id FROM makers WHERE handle=?').get(String(b.maker).trim()); if (m) who = { kind: 'maker', id: m.id }; } if (b.collector) { const c = db.prepare('SELECT id FROM buyers WHERE code=?').get(String(b.collector).trim()); if (c) who = { kind: 'buyer', id: c.id }; } offer(b, who); res.redirect('/studio/bookshop?ok=' + encodeURIComponent('On the shelf.')); } catch (e) { res.redirect('/studio/bookshop?ok=' + encodeURIComponent(e.message)); } });
  app.post('/account/bookshop/offer', (req, res) => { const m = makerOf && makerOf(req); if (!m) return res.sendStatus(401); try { offer({ ...req.body, attest: 1 }, { kind: 'maker', id: m.id }); res.redirect(`/account/bookshop?ok=${encodeURIComponent('Your copy is on the shelf.')}`); } catch (e) { res.redirect('/account/bookshop?ok=' + encodeURIComponent(e.message)); } });
  app.post('/yours/bookshop/offer', (req, res) => { const b = buyerOf && buyerOf(req); if (!b) return res.sendStatus(401); try { offer({ ...req.body, attest: 1 }, { kind: 'buyer', id: b.id }); res.redirect(`/yours/bookshop?ok=${encodeURIComponent('Your copy is on the shelf.')}`); } catch (e) { res.redirect('/yours/bookshop?ok=' + encodeURIComponent(e.message)); } });
  app.post('/studio/bookshop/copy/:id/withdraw', (req, res) => { if (!isStudio(req)) return res.sendStatus(403); db.prepare("UPDATE copies SET status='withdrawn' WHERE id=?").run(Number(req.params.id)); res.redirect('/studio/bookshop'); });
  // Buying a copy: name, email, address → Checkout → paid → asked on the desk; the seller and the buyer written to.
  app.post('/bookshop/copy/:id/buy', async (req, res) => {
    const c = db.prepare("SELECT * FROM copies WHERE id=? AND status='offered' AND qty>0").get(Number(req.params.id)); if (!c) return res.status(410).send(V.sign ? V.sign(410) : 'Gone');
    const t = text(c.text_id); const x = req.body || {}, s = (v, n) => String(v || '').trim().slice(0, n);
    const name = s(x.name, 80), email = s(x.email, 160).toLowerCase(), street = s(x.street, 120), city = s(x.city, 80), state = s(x.state, 2).toUpperCase(), zip = s(x.zip, 10);
    const back = msg => res.redirect(`/library/${t.slug}?ok=${encodeURIComponent(msg)}#bookshop`);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !street || !city || !state || !zip) return back('Name, email and a United States address, please.');
    let b = buyerOf ? buyerOf(req) : null; const address = `${street}\n${city}, ${state} ${zip}\nUnited States`;
    const cents = totalOf(c), house = cents - c.price_cents, ref = nextRef();
    const id = db.prepare('INSERT INTO copy_orders (ref, copy_id, buyer_id, email, ship_name, address, cents, house_cents) VALUES (?,?,?,?,?,?,?,?)').run(ref, c.id, b ? b.id : null, email, name, address, cents, house).lastInsertRowid;
    if (!stripe) { db.prepare('DELETE FROM copy_orders WHERE id=?').run(id); return back('The till is closed for the moment; write to the house.'); }
    if (!b && setBuyer) { const bid = db.prepare("INSERT INTO buyers (customer, email, name) VALUES ('', ?, ?)").run(email, name).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(bid); setBuyer(res, b); db.prepare('UPDATE copy_orders SET buyer_id=? WHERE id=?').run(b.id, id); }
    try {
      const sess = await stripe.checkout.sessions.create({ mode: 'payment', submit_type: 'pay', ...(b && b.customer ? { customer: b.customer } : { customer_email: email }),
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `${KINDS[c.kind] || 'A copy'}: ${tidy(t.title)}`, description: `${c.line ? c.line + '. ' : ''}Shipped to you by ${sellerName(c)}.${FEE.on() ? ` ${money(c.price_cents)} to the seller; the house’s share on top.` : ''}`, images: t.cover ? [`${C.base}/img/${t.cover}/screen?f=jpg`] : [] } } }],
        metadata: { copy_order: String(id) }, payment_intent_data: { metadata: { copy_order: String(id) } },
        success_url: `${C.base}/bookshop/thanks/${ref}?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${C.base}/library/${t.slug}#bookshop` });
      db.prepare('UPDATE copy_orders SET stripe_session=? WHERE id=?').run(sess.id, id);
      res.redirect(303, sess.url);
    } catch (e) { console.error('[bookshop]', e.message); db.prepare('DELETE FROM copy_orders WHERE id=?').run(id); back('The till could not be reached; try again in a moment.'); }
  });
  function settle(o, how, sess) {
    if (!o || o.paid) return; if (sess && (o.stripe_session !== sess.id || sess.payment_status !== 'paid')) return;
    db.prepare("UPDATE copy_orders SET paid=1, how=?, status='asked', paid_at=datetime('now') WHERE id=?").run(how, o.id);
    const c = db.prepare('SELECT * FROM copies WHERE id=?').get(o.copy_id); db.prepare("UPDATE copies SET qty=qty-1, status=CASE WHEN qty-1<=0 THEN 'sold' ELSE status END WHERE id=?").run(c.id);
    const t = text(c.text_id), seller = sellerOf(c);
    try { ledger.append(db, 'copy.sold', t.slug, { kind: c.kind, title: t.title, price_cents: c.price_cents, house_cents: o.house_cents, ref: o.ref }); } catch (e) { /* */ }
    // A royalty (Will, 24 Oct: "one-person media companies with royalties"): when the house sells a reprint or copy of a living maker's text, the maker is owed REPRINT_ROYALTY_PCT of the price.
    if (c.seller_kind === 'house' && t.maker_id) { const pct = +(process.env.REPRINT_ROYALTY_PCT || 50); const cents = Math.round(c.price_cents * pct / 100); if (cents > 0) { try { db.prepare("INSERT INTO payouts (trade_id, kind, maker_id, amount_cents, status) VALUES (?,?,?,?,'owed')").run(0, 'royalty', t.maker_id, cents); ledger.append(db, 'royalty.owed', t.slug, { maker: t.maker_id, cents, ref: o.ref, kind: c.kind }); } catch (e) { console.error('[royalty]', e.message); } } }
    try { mail.send({ to: o.email, subject: `${tidy(t.title)}: your copy is on its way to being packed`, text: `Thank you. ${KINDS[c.kind] || 'A copy'} of ${tidy(t.title)}${c.line ? ` (${c.line})` : ''}, ${o.ref}.\n\nIt ships from ${sellerName(c)} to:\n${o.address}\n\nThe house writes at each step: packed, sent, delivered. Follow it: ${C.base}/bookshop/o/${o.ref}\n\nThank you for collecting.` }); } catch (e) { /* */ }
    try { mail.send({ to: seller && seller.email ? seller.email : HOUSE, subject: `Sold: ${KINDS[c.kind] || 'a copy'} of ${tidy(t.title)} (${o.ref})`, text: `${o.ship_name} bought it for ${money(c.price_cents)}${FEE.on() ? ` (the collector paid ${money(o.cents)}; the house's share ${money(o.house_cents)})` : ''}.\n\nPack it and send it to:\n${o.ship_name}\n${o.address}\n\nThen mark it on the desk: ${C.base}/studio/bookshop (the house moves it for you if you write).` }); } catch (e) { /* */ }
    if (seller && seller.email && seller.email !== HOUSE) { try { mail.send({ to: HOUSE, subject: `Bookshop: ${o.ref} sold, ${sellerName(c)} to ship`, text: `${tidy(t.title)}, ${KINDS[c.kind]}, ${money(c.price_cents)} to the seller.` }); } catch (e) { /* */ } }
  }
  app.locals.bookshopEvent = event => { if (event.type === 'checkout.session.completed') { const s = event.data.object; if (s.metadata && s.metadata.copy_order) settle(db.prepare('SELECT * FROM copy_orders WHERE id=?').get(Number(s.metadata.copy_order)), 'card', s); } };
  app.get('/bookshop/thanks/:ref', async (req, res) => {
    const o = db.prepare('SELECT * FROM copy_orders WHERE ref=?').get(String(req.params.ref)); if (!o) return res.sendStatus(404);
    if (!o.paid && stripe && o.stripe_session === req.query.session_id) { try { settle(o, 'card', await stripe.checkout.sessions.retrieve(o.stripe_session)); } catch (e) { /* the webhook */ } }
    res.redirect(`/bookshop/o/${o.ref}`);
  });
  app.get('/bookshop/o/:ref', (req, res) => {
    const o = db.prepare('SELECT * FROM copy_orders WHERE ref=?').get(String(req.params.ref)); if (!o) return res.sendStatus(404);
    const c = db.prepare('SELECT * FROM copies WHERE id=?').get(o.copy_id), t = text(c.text_id);
    res.send(V.layout({ title: `${t.title} · your copy`, path: `/bookshop/o/${o.ref}`, body: `<section class="bs-o"><p class="k">${esc(o.ref)}</p><h1>${o.paid ? `<em>${esc(tidy(t.title))}</em> is coming to you.` : 'One moment.'}</h1><p class="lede">${esc(KINDS[c.kind] || 'A copy')}${c.line ? `, ${esc(c.line)}` : ''}. ${o.paid ? `${esc(STEPS[o.status] || 'Asked')}${o.moved_at ? `, ${esc(o.moved_at.slice(0, 10))}` : ''}. It ships from ${esc(sellerName(c))} to ${esc(o.ship_name)}.` : 'Payment is being confirmed.'}</p><p><a href="/library/${esc(t.slug)}">The book</a> · <a href="/bookshop">The Bookshop</a></p><p class="bs-fine">Thank you for collecting. The house writes at each step.</p></section>` }));
  });
  // The desk: offer a copy; every order, moved along by hand; the buyer told.
  app.get('/studio/bookshop', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login'); V.setDeskPath && V.setDeskPath('/studio/bookshop');
    const orders = db.prepare('SELECT o.*, c.kind, c.line, c.seller_kind, c.seller_id, t.title, t.slug FROM copy_orders o JOIN copies c ON c.id=o.copy_id JOIN texts t ON t.id=c.text_id WHERE o.paid=1 ORDER BY CASE o.status WHEN \'asked\' THEN 0 WHEN \'packed\' THEN 1 WHEN \'sent\' THEN 2 ELSE 3 END, o.id DESC').all();
    const copies = db.prepare('SELECT c.*, t.title, t.slug FROM copies c JOIN texts t ON t.id=c.text_id ORDER BY c.id DESC LIMIT 100').all();
    const wants = db.prepare('SELECT w.*, t.title FROM wants w JOIN texts t ON t.id=w.text_id WHERE w.told_at IS NULL ORDER BY w.id DESC LIMIT 50').all();
    res.send(V.layout({ title: 'The Bookshop · Studio', studio: true, body: `<section class="studio-wrap bs-desk"><p class="k">Watermark Publishing</p><h1>The Bookshop.</h1>${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<h2>Offer a copy</h2><form method="post" action="/studio/bookshop/offer" class="cl-f bs-of"><label><span>The book (its Library slug)</span><input name="text" required placeholder="meditations"></label><label><span>Kind</span><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><label><span>The line (edition, year, publisher)</span><input name="line" placeholder="First edition, 1851, Harper &amp; Brothers"></label><label><span>Condition</span><input name="condition" placeholder="Very good; foxing to the endpapers"></label><label><span>Note</span><input name="note"></label><label><span>Price, $ (the seller’s)</span><input name="price" required inputmode="decimal"></label><label><span>Copies</span><input name="qty" value="1" inputmode="numeric"></label><label><span>Photograph of record (a held work’s slug)</span><input name="photo"></label><label><span>Seller: a maker’s handle</span><input name="maker" placeholder="blank: the house"></label><label><span>or a collector’s code</span><input name="collector"></label><button class="buy-btn">Put it on the shelf</button></form>
<h2>Orders</h2>${orders.length ? `<table class="tbl"><tr><th>Ref</th><th>Book</th><th>Copy</th><th>To</th><th>Paid</th><th>Status</th><th></th></tr>${orders.map(o => `<tr><td>${esc(o.ref)}</td><td><a href="/library/${esc(o.slug)}">${esc(o.title)}</a></td><td>${esc(KINDS[o.kind] || '')}${o.line ? `<br><small>${esc(o.line)}</small>` : ''}<br><small>from ${esc(o.seller_kind)}</small></td><td>${esc(o.ship_name)}<br><small>${esc(o.address).replace(/\n/g, '<br>')}</small></td><td>${money(o.cents)}</td><td>${esc(STEPS[o.status] || o.status)}</td><td><form method="post" action="/studio/bookshop/order/${o.id}/move" class="inl">${Object.entries(STEPS).filter(([k]) => k !== o.status).map(([k, v]) => `<button name="to" value="${k}">${v}</button>`).join(' ')}</form></td></tr>`).join('')}</table>` : '<p class="note">No orders yet.</p>'}
<h2>On the shelf</h2>${copies.length ? `<table class="tbl"><tr><th>Book</th><th>Copy</th><th>Seller</th><th>Price</th><th>Left</th><th></th></tr>${copies.map(c => `<tr><td><a href="/library/${esc(c.slug)}#bookshop">${esc(c.title)}</a></td><td>${esc(KINDS[c.kind] || '')}${c.line ? `<br><small>${esc(c.line)}</small>` : ''}</td><td>${esc(sellerName(c))}</td><td>${money(c.price_cents)}</td><td>${c.status === 'offered' ? c.qty : esc(c.status)}</td><td>${c.status === 'offered' ? `<form method="post" action="/studio/bookshop/copy/${c.id}/withdraw" class="inl"><button>Withdraw</button></form>` : ''}</td></tr>`).join('')}</table>` : '<p class="note">Nothing offered yet.</p>'}
<h2>Wants</h2>${wants.length ? `<ul>${wants.map(w => `<li>${esc(w.title)}: ${esc(w.kind ? KINDS[w.kind] || w.kind : 'any copy')} · ${esc(w.email)}</li>`).join('')}</ul>` : '<p class="note">No wants waiting.</p>'}</section>` }));
  });
  app.post('/studio/bookshop/order/:id/move', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403); const o = db.prepare('SELECT * FROM copy_orders WHERE id=?').get(Number(req.params.id)); const to = String(req.body.to || ''); if (!o || !STEPS[to]) return res.redirect('/studio/bookshop');
    db.prepare("UPDATE copy_orders SET status=?, moved_at=datetime('now') WHERE id=?").run(to, o.id);
    const c = db.prepare('SELECT * FROM copies WHERE id=?').get(o.copy_id), t = text(c.text_id);
    try { mail.send({ to: o.email, subject: `${tidy(t.title)}: ${STEPS[to].toLowerCase()}`, text: `${o.ref}: ${STEPS[to]}.\n\n${C.base}/bookshop/o/${o.ref}` }); } catch (e) { /* */ }
    res.redirect('/studio/bookshop');
  });
  // The seller's own desk (25 Oct): a maker (/account/bookshop) or a collector (/yours/bookshop) offers copies, sees
  // the shelf of what they offer (withdraw), and moves their own orders along (Asked → Packed → Sent → Delivered),
  // the buyer written to at each step, the address shown only to the seller of that copy. The house's Studio desk
  // sees everything as before.
  function moveOrder(o, to) {
    db.prepare("UPDATE copy_orders SET status=?, moved_at=datetime('now') WHERE id=?").run(to, o.id);
    const c = db.prepare('SELECT * FROM copies WHERE id=?').get(o.copy_id), t = text(c.text_id);
    try { mail.send({ to: o.email, subject: `${tidy(t.title)}: ${STEPS[to].toLowerCase()}`, text: `${o.ref}: ${STEPS[to]}.\n\n${C.base}/bookshop/o/${o.ref}` }); } catch (e) { /* */ }
  }
  function sellerDesk(base, who) {
    const mine = (w) => ({ copies: db.prepare('SELECT c.*, t.title, t.slug FROM copies c JOIN texts t ON t.id=c.text_id WHERE c.seller_kind=? AND c.seller_id=? ORDER BY c.id DESC').all(w.kind, w.id), orders: db.prepare("SELECT o.*, c.kind, c.line, t.title, t.slug FROM copy_orders o JOIN copies c ON c.id=o.copy_id JOIN texts t ON t.id=c.text_id WHERE c.seller_kind=? AND c.seller_id=? AND o.paid=1 ORDER BY CASE o.status WHEN 'asked' THEN 0 WHEN 'packed' THEN 1 WHEN 'sent' THEN 2 ELSE 3 END, o.id DESC").all(w.kind, w.id) });
    app.get(base, (req, res) => {
      const w = who(req); if (!w) return res.status(401).send(V.sign ? V.sign(401) : 'Sign in');
      const { copies, orders } = mine(w); const books = db.prepare("SELECT slug, title, author FROM texts WHERE status='held' AND public=1 ORDER BY title COLLATE NOCASE LIMIT 400").all();
      if (V.setDeskPath) V.setDeskPath(base);
      const earned = orders.filter(o => o.status !== 'declined').reduce((a, o) => a + ((o.cents || 0) - (o.house_cents || 0)), 0);
      res.send(V.layout({ title: 'Your shelf · The Bookshop · Watermark', studio: w.kind === 'maker', body: `<section class="studio-wrap bs-desk bs-mine"><p class="k">${w.kind === 'maker' ? '<a href="/account">&larr; Your studio</a>' : '<a href="/yours">&larr; Your gallery</a>'} &middot; The Bookshop</p><h1>Your shelf.</h1>
<p class="lede">Offer a first edition, a signed copy, a proof or a paperback of any book in the Library; the house lists it, takes the payment, and writes to you and the buyer. You pack and post; you move the order along here. 'First edition' and 'signed' are your word, and the page says so.${orders.length ? ` <b>${money(earned)}</b> from ${orders.length} sale${orders.length === 1 ? '' : 's'}.` : ''}</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<h2>Offer a copy</h2><form method="post" action="${base}/offer" class="cl-f bs-of"><label><span>The book</span><select name="text" required>${books.map(t => `<option value="${esc(t.slug)}">${esc(tidy(t.title))}${t.author ? ` · ${esc(t.author)}` : ''}</option>`).join('')}</select></label><label><span>Kind</span><select name="kind">${Object.entries(KINDS).filter(([k]) => k !== 'reprint').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><label><span>A line</span><input name="line" maxlength="160" placeholder="Signed on the half-title, 1923"></label><label><span>Condition</span><input name="condition" maxlength="80" placeholder="Very good; a little foxing"></label><label><span>Your price, in dollars</span><input name="price" inputmode="decimal" required placeholder="450"></label><label><span>How many</span><input name="qty" inputmode="numeric" value="1"></label><label><span>A note (private to the house)</span><input name="note" maxlength="300"></label><label class="bs-attest"><input type="checkbox" name="attest" value="1" required> I hold this copy, it is as I describe it, and I will post it within a week of the sale.</label><button class="buy-btn">Put it on the shelf</button></form>
<h2>Orders</h2>${orders.length ? `<table class="tbl"><tr><th>Ref</th><th>Book</th><th>To</th><th>Yours</th><th>Status</th><th></th></tr>${orders.map(o => `<tr><td>${esc(o.ref)}</td><td><a href="/library/${esc(o.slug)}">${esc(o.title)}</a><br><small>${esc(KINDS[o.kind] || '')}</small></td><td>${esc(o.name || '')}<br><small>${esc(o.address || '')}</small></td><td>${money((o.cents || 0) - (o.house_cents || 0))}</td><td>${esc(STEPS[o.status] || o.status)}</td><td>${['packed', 'sent', 'done'].filter(k => k !== o.status && STEPS[k]).map(k => `<form method="post" action="${base}/order/${o.id}/move" class="inline"><input type="hidden" name="to" value="${k}"><button class="link">${esc(STEPS[k])}</button></form>`).join(' · ')}</td></tr>`).join('')}</table>` : '<p class="note">No orders yet. A sale writes to you, and shows here with the address to post to.</p>'}
<h2>On your shelf</h2>${copies.length ? `<table class="tbl"><tr><th>Book</th><th>Copy</th><th>Price</th><th>Left</th><th></th></tr>${copies.map(c => `<tr><td><a href="/library/${esc(c.slug)}#bookshop">${esc(c.title)}</a></td><td>${esc(KINDS[c.kind] || '')}${c.line ? `<br><small>${esc(c.line)}</small>` : ''}</td><td>${money(c.price_cents)}</td><td>${c.status === 'offered' ? c.qty : esc(c.status)}</td><td>${c.status === 'offered' ? `<form method="post" action="${base}/copy/${c.id}/withdraw" class="inline"><button class="link">Withdraw</button></form>` : ''}</td></tr>`).join('')}</table>` : '<p class="note">Nothing offered yet.</p>'}
</section>` }));
    });
    app.post(`${base}/order/:id/move`, (req, res) => {
      const w = who(req); if (!w) return res.sendStatus(401); const o = db.prepare('SELECT o.* FROM copy_orders o JOIN copies c ON c.id=o.copy_id WHERE o.id=? AND c.seller_kind=? AND c.seller_id=?').get(Number(req.params.id), w.kind, w.id); const to = String(req.body.to || '');
      if (!o || !STEPS[to] || to === 'declined') return res.redirect(base); moveOrder(o, to); res.redirect(`${base}?ok=${encodeURIComponent(`${o.ref}: ${STEPS[to].toLowerCase()}. The buyer is written to.`)}`);
    });
    app.post(`${base}/copy/:id/withdraw`, (req, res) => { const w = who(req); if (!w) return res.sendStatus(401); db.prepare("UPDATE copies SET status='withdrawn' WHERE id=? AND seller_kind=? AND seller_id=? AND status='offered'").run(Number(req.params.id), w.kind, w.id); res.redirect(base); });
  }
  sellerDesk('/account/bookshop', req => { const m = makerOf && makerOf(req); return m ? { kind: 'maker', id: m.id } : null; });
  sellerDesk('/yours/bookshop', req => { const b = buyerOf && buyerOf(req); return b ? { kind: 'buyer', id: b.id } : null; });
  app.locals.bookshop = { block, offer, settle, KINDS, STEPS, offered, moveOrder };
  return app.locals.bookshop;
}
module.exports = { mountBookshop, KINDS, STEPS };
