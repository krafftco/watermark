// The market: numbered pieces of limited editions pass between collectors, at prices they set.
// A collector offers a piece; someone asks to buy it; the trade is settled and the piece moves, with its
// number, through the same claim link as a gift. Every trade is written to the ledger with its price, so
// each work carries a price history and each collection a value at the market's own last word.
//
// On a resale the maker is paid a royalty and Watermark a fee, both drafts until Will confirms them.
// Collecting money from one collector and paying it to another is money moving between people: until
// counsel has signed off and Stripe Connect is in place (MARKET_SETTLEMENT=stripe), Watermark brokers
// each trade and records it from the Studio. Nothing here is investment advice; values are prices paid.
const { nanoid } = require('nanoid');

const ROYALTY = 0.10; // to the maker, on every resale (draft)
const FEE = 0.05;     // to Watermark (draft)

function mountMarket(app, { db, C, maker, buyerOf, setBuyer, isStudio, studioOnly, ledger, V, mk, edition, stripe = null, mail = null }) {
  db.exec(`CREATE TABLE IF NOT EXISTS listings (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, seller INTEGER NOT NULL, ask_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS bids (id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL, buyer_id INTEGER, name TEXT, email TEXT NOT NULL, offer_cents INTEGER,
    status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, listing_id INTEGER, bid_id INTEGER, seller INTEGER, price_cents INTEGER NOT NULL,
    royalty_cents INTEGER NOT NULL, fee_cents INTEGER NOT NULL, settled TEXT NOT NULL DEFAULT 'brokered', claim TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS offers (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, buyer_id INTEGER, name TEXT, email TEXT NOT NULL, offer_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT)`);

  // Settlement through Stripe: the buyer pays Watermark, the piece moves at once, the collector and the
  // photographer are paid out through Stripe Connect. On only with MARKET_SETTLEMENT=stripe (after counsel).
  const col = (t, c, d) => { if (!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name=?`).get(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`); };
  col('trades', 'buyer_id', 'INTEGER'); col('trades', 'stripe_session', 'TEXT'); col('trades', 'payment_intent', 'TEXT');
  col('listings', 'held_until', 'TEXT'); col('listings', 'held_session', 'TEXT');
  col('bids', 'token', 'TEXT');
  col('buyers', 'stripe_account', 'TEXT'); col('makers', 'stripe_account', 'TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS payouts (id INTEGER PRIMARY KEY, trade_id INTEGER NOT NULL, kind TEXT NOT NULL, buyer_id INTEGER, maker_id INTEGER,
    amount_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'owed', stripe_transfer TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT)`);
  const AUTO = () => !!stripe && process.env.MARKET_SETTLEMENT === 'stripe';
  app.locals.marketAuto = AUTO;
  const { layout, esc, money, date, tidy } = V;
  const lic = id => db.prepare('SELECT l.*, w.slug, w.title, w.place, w.width, w.height, w.edition_size, w.maker_id FROM licenses l JOIN works w ON w.id=l.work_id WHERE l.id=?').get(id);
  const openListing = licId => db.prepare("SELECT * FROM listings WHERE license_id=? AND status='open'").get(licId);
  const split = c => { const royalty = Math.round(c * ROYALTY), fee = Math.round(c * FEE); return { royalty, fee, seller: c - royalty - fee }; };

  // ---------- the price of a work, and of a collection ----------
  // A work's market price is its last trade; before any trade, what collectors paid for it at issue.
  function priceOf(workId) {
    const last = db.prepare('SELECT t.price_cents, t.at FROM trades t JOIN licenses l ON l.id=t.license_id WHERE l.work_id=? ORDER BY t.id DESC LIMIT 1').get(workId);
    const issue = db.prepare("SELECT price_cents FROM licenses WHERE work_id=? AND collector_no IS NOT NULL AND status IN ('active','expired') AND price_cents > 0 ORDER BY id DESC LIMIT 1").get(workId);
    const ask = db.prepare("SELECT MIN(s.ask_cents) a, COUNT(*) n FROM listings s JOIN licenses l ON l.id=s.license_id WHERE l.work_id=? AND s.status='open'").get(workId);
    const trades = db.prepare('SELECT COUNT(*) n FROM trades t JOIN licenses l ON l.id=t.license_id WHERE l.work_id=?').get(workId).n;
    return { last: last ? last.price_cents : null, lastAt: last ? last.at : null, issue: issue ? issue.price_cents : null, ask: ask.a, asks: ask.n, trades,
      value: last ? last.price_cents : issue ? issue.price_cents : null };
  }
  // What each piece in a collection cost its holder, and what the market last said it was worth.
  function portfolio(items) {
    let paid = 0, value = 0, priced = 0;
    const rows = items.map(i => {
      const bought = db.prepare('SELECT price_cents FROM trades WHERE license_id=? ORDER BY id DESC LIMIT 1').get(i.id);
      const cost = bought ? bought.price_cents : (i.price_cents || 0);
      const p = priceOf(i.wid); const v = i.edition_size ? (p.value != null ? p.value : cost) : cost;
      paid += cost; value += v; if (p.trades) priced++;
      return { ...i, cost, value: v, listing: openListing(i.id), market: p };
    });
    return { rows, paid, value, change: paid ? (value - paid) / paid : 0, priced };
  }
  app.locals.market = { priceOf, portfolio, openListing, ROYALTY, FEE };

  // ---------- a collector offers a piece ----------
  app.post('/yours/offer', (req, res) => {
    const b = buyerOf(req), x = req.body || {}; const l = b && db.prepare('SELECT * FROM licenses WHERE ref=?').get(String(x.ref || ''));
    if (!l || l.buyer_id !== b.id || l.status !== 'active' || !l.collector_no) return res.redirect('/yours');
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id); if (!w.edition_size) return res.redirect('/yours#files');
    const ask = Math.round(Number(String(x.ask || '').replace(/[^0-9.]/g, '')) * 100);
    if (!(ask >= 100 && ask <= 100000000)) return res.redirect('/yours?offer=price#files');
    const cur = openListing(l.id);
    if (cur) db.prepare('UPDATE listings SET ask_cents=? WHERE id=?').run(ask, cur.id);
    else db.prepare('INSERT INTO listings (license_id, seller, ask_cents) VALUES (?,?,?)').run(l.id, b.id, ask);
    ledger.append(db, 'market.offered', l.ref, { work: w.slug, collector_no: l.collector_no, ask });
    res.redirect('/yours?offer=1#files');
  });
  app.post('/yours/offer/withdraw', (req, res) => {
    const b = buyerOf(req); const l = b && db.prepare('SELECT * FROM licenses WHERE ref=?').get(String((req.body || {}).ref || ''));
    const s = l && openListing(l.id); if (!s || s.seller !== b.id) return res.redirect('/yours');
    db.prepare("UPDATE listings SET status='withdrawn', closed_at=datetime('now') WHERE id=?").run(s.id);
    ledger.append(db, 'market.withdrawn', l.ref, {});
    res.redirect('/yours#files');
  });

  // ---------- someone asks to buy it ----------
  app.get('/market/:id', (req, res) => {
    const s = db.prepare('SELECT * FROM listings WHERE id=?').get(Number(req.params.id)); if (!s) return res.sendStatus(404);
    const l = lic(s.license_id), b = buyerOf(req);
    const bid = req.query.bid ? db.prepare("SELECT * FROM bids WHERE listing_id=? AND token=? AND status='new'").get(s.id, String(req.query.bid)) : null;
    res.send(page.listing({ s, l, m: mk({ maker_id: l.maker_id }), p: priceOf(l.work_id), mine: !!(b && b.id === s.seller), sent: req.query.sent, base: C.base, auto: AUTO(), bid, held: isHeld(s) }));
  });
  app.post('/market/:id/bid', (req, res) => {
    const s = db.prepare("SELECT * FROM listings WHERE id=? AND status='open'").get(Number(req.params.id)); if (!s) return res.redirect('/market');
    const x = req.body || {}, b = buyerOf(req);
    const email = String(x.email || '').trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect(`/market/${s.id}?sent=email`);
    if (b && b.id === s.seller) return res.redirect(`/market/${s.id}`);
    const offer = String(x.offer || '').trim() ? Math.round(Number(String(x.offer).replace(/[^0-9.]/g, '')) * 100) : null;
    if (AUTO()) { // the collector decides: the offer goes to them, in their collection
      if (!(offer >= 100)) return res.redirect(`/market/${s.id}?sent=offer`);
      db.prepare('INSERT INTO offers (license_id, buyer_id, name, email, offer_cents) VALUES (?,?,?,?,?)').run(s.license_id, b ? b.id : null, String(x.name || '').trim().slice(0, 80) || null, email.slice(0, 160), offer);
      ledger.append(db, 'market.offer', `listing-${s.id}`, { offer });
      const sl = db.prepare('SELECT email FROM buyers WHERE id=?').get(s.seller); const l = lic(s.license_id);
      if (mail && sl && sl.email) mail.send({ to: sl.email, subject: `An offer: ${tidy(l.title)}, No. ${l.collector_no}`, text: `Someone offers ${money(offer)} for your piece (you ask ${money(s.ask_cents)}). Accept or decline it in your collection: ${C.base}/yours#files` });
      return res.redirect(`/market/${s.id}?sent=1`);
    }
    db.prepare('INSERT INTO bids (listing_id, buyer_id, name, email, offer_cents) VALUES (?,?,?,?,?)').run(s.id, b ? b.id : null, String(x.name || '').trim().slice(0, 80) || null, email.slice(0, 160), offer && offer > 0 ? offer : null);
    ledger.append(db, 'market.bid', `listing-${s.id}`, { offer: offer || s.ask_cents });
    res.redirect(`/market/${s.id}?sent=1`);
  });


  // ---------- an offer for a piece that is not on the market ----------
  // Anyone can make an offer for a numbered piece of a limited edition; its collector sees it in their
  // collection and may accept it, which puts the piece on the market at that price with the offer as its buyer.
  app.post('/w/:slug/offer', (req, res) => {
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(req.params.slug)); if (!w || !w.edition_size) return res.sendStatus(404);
    const x = req.body || {}, b = buyerOf(req);
    const email = String(x.email || '').trim(), cents = Math.round(Number(String(x.offer || '').replace(/[^0-9.]/g, '')) * 100);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !(cents >= 100)) return res.redirect(`/w/${w.slug}?offer=check#market`);
    const want = Number(x.no) || null;
    const held = db.prepare("SELECT * FROM licenses WHERE work_id=? AND collector_no IS NOT NULL AND status='active' AND buyer_id IS NOT NULL" + (want ? ' AND collector_no=?' : '') + ' ORDER BY collector_no').all(...[w.id, ...(want ? [want] : [])]);
    const to = held.filter(l => !(b && l.buyer_id === b.id)); if (!to.length) return res.redirect(`/w/${w.slug}?offer=none#market`);
    for (const l of to) db.prepare('INSERT INTO offers (license_id, buyer_id, name, email, offer_cents) VALUES (?,?,?,?,?)').run(l.id, b ? b.id : null, String(x.name || '').trim().slice(0, 80) || null, email.slice(0, 160), cents);
    ledger.append(db, 'market.offer', w.slug, { offer: cents, pieces: to.length });
    res.redirect(`/w/${w.slug}?offer=sent#market`);
  });
  const offersFor = b => (b ? db.prepare("SELECT o.*, l.ref, l.collector_no FROM offers o JOIN licenses l ON l.id=o.license_id WHERE l.buyer_id=? AND o.status='open' ORDER BY o.offer_cents DESC").all(b.id) : []);
  app.locals.offersFor = offersFor;
  app.post('/yours/offers/:id/:act', (req, res) => {
    const b = buyerOf(req), o = db.prepare("SELECT o.*, l.buyer_id AS holder FROM offers o JOIN licenses l ON l.id=o.license_id WHERE o.id=? AND o.status='open'").get(Number(req.params.id));
    if (!b || !o || o.holder !== b.id) return res.redirect('/yours');
    if (req.params.act === 'accept') {
      let s = openListing(o.license_id);
      if (s) db.prepare('UPDATE listings SET ask_cents=? WHERE id=?').run(o.offer_cents, s.id);
      else { db.prepare('INSERT INTO listings (license_id, seller, ask_cents) VALUES (?,?,?)').run(o.license_id, b.id, o.offer_cents); s = openListing(o.license_id); }
      const tok = nanoid(20);
      db.prepare('INSERT INTO bids (listing_id, buyer_id, name, email, offer_cents, token) VALUES (?,?,?,?,?,?)').run(s.id, o.buyer_id, o.name, o.email, o.offer_cents, tok);
      if (AUTO() && mail) { const l = lic(o.license_id); mail.send({ to: o.email, subject: `Your offer was accepted: ${tidy(l.title)}, No. ${l.collector_no}`, text: `The collector accepted your offer of ${money(o.offer_cents)}. Pay here and the piece moves to your collection at once:\n${C.base}/market/${s.id}?bid=${tok}` }); }
      db.prepare("UPDATE offers SET status='accepted', closed_at=datetime('now') WHERE id=?").run(o.id);
      ledger.append(db, 'market.accepted', `listing-${s.id}`, { offer: o.offer_cents });
      return res.redirect('/yours?accepted=1#files');
    }
    db.prepare("UPDATE offers SET status='declined', closed_at=datetime('now') WHERE id=?").run(o.id);
    res.redirect('/yours#files');
  });

  // What resale has paid makers and the house.
  const royaltiesTo = makerId => db.prepare(`SELECT COALESCE(SUM(t.royalty_cents),0) r, COALESCE(SUM(t.fee_cents),0) f, COUNT(*) n FROM trades t JOIN licenses l ON l.id=t.license_id JOIN works w ON w.id=l.work_id${makerId ? ' WHERE w.maker_id=?' : ''}`).get(...(makerId ? [makerId] : []));
  app.locals.royaltiesTo = royaltiesTo;

  // A small price chart: issue, then every trade.
  function chart(workId) {
    const pts = db.prepare('SELECT t.price_cents c, t.at FROM trades t JOIN licenses l ON l.id=t.license_id WHERE l.work_id=? ORDER BY t.id').all(workId);
    const p = priceOf(workId); if (!pts.length) return '';
    const series = [...(p.issue != null ? [{ c: p.issue, at: null }] : []), ...pts];
    const W = 560, H = 120, pad = 8, max = Math.max(...series.map(s => s.c)), min = Math.min(...series.map(s => s.c));
    const x = i => pad + (series.length === 1 ? (W - 2 * pad) / 2 : i * (W - 2 * pad) / (series.length - 1));
    const y = c => H - pad - (max === min ? (H - 2 * pad) / 2 : (c - min) * (H - 2 * pad) / (max - min));
    const d = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s.c).toFixed(1)}`).join(' ');
    return `<figure class="mk-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price history: ${series.map(s => money(s.c)).join(', ')}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/>${series.map((s, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(s.c).toFixed(1)}" r="${i === series.length - 1 ? 4 : 2.5}" fill="currentColor"/>`).join('')}</svg>
<figcaption><span>${p.issue != null ? `Issued at ${money(p.issue)}` : ''}</span><span>Last ${money(series[series.length - 1].c)}</span></figcaption></figure>`;
  }
  app.locals.marketChart = chart;

  // ---------- the exchange: everything offered, and what has traded ----------
  app.get('/market', (req, res) => {
    const open = db.prepare("SELECT s.*, l.collector_no, l.ref, w.id AS wid, w.slug, w.title, w.place, w.width, w.height, w.edition_size, m.name AS maker FROM listings s JOIN licenses l ON l.id=s.license_id JOIN works w ON w.id=l.work_id JOIN makers m ON m.id=w.maker_id WHERE s.status='open' ORDER BY s.id DESC").all()
      .map(r => ({ ...r, p: priceOf(r.wid) }));
    const recent = db.prepare('SELECT t.*, l.collector_no, w.slug, w.title, w.edition_size, m.name AS maker FROM trades t JOIN licenses l ON l.id=t.license_id JOIN works w ON w.id=l.work_id JOIN makers m ON m.id=w.maker_id ORDER BY t.id DESC LIMIT 24').all();
    const vol = db.prepare('SELECT COALESCE(SUM(price_cents),0) v, COUNT(*) n FROM trades').get();
    res.send(page.exchange({ open, recent, vol }));
  });

  // ---------- the Studio brokers the trade until settlement runs on its own ----------
  app.get('/studio/market', studioOnly, (req, res) => {
    const bids = db.prepare("SELECT d.*, s.ask_cents, s.id AS sid, l.ref, l.collector_no, w.title, w.slug, w.edition_size FROM bids d JOIN listings s ON s.id=d.listing_id JOIN licenses l ON l.id=s.license_id JOIN works w ON w.id=l.work_id WHERE d.status='new' AND s.status='open' ORDER BY d.id DESC").all();
    const open = db.prepare("SELECT s.*, l.ref, l.collector_no, w.title, w.slug, w.edition_size, (SELECT COUNT(*) FROM bids d WHERE d.listing_id=s.id AND d.status='new') bids FROM listings s JOIN licenses l ON l.id=s.license_id JOIN works w ON w.id=l.work_id WHERE s.status='open' ORDER BY s.id DESC").all();
    const done = db.prepare('SELECT t.*, l.ref, l.collector_no, w.title, w.slug FROM trades t JOIN licenses l ON l.id=t.license_id JOIN works w ON w.id=l.work_id ORDER BY t.id DESC LIMIT 30').all();
    const owed = db.prepare("SELECT p.*, COALESCE(b.email, m.name) who, w.title FROM payouts p JOIN trades t ON t.id=p.trade_id JOIN licenses l ON l.id=t.license_id JOIN works w ON w.id=l.work_id LEFT JOIN buyers b ON b.id=p.buyer_id LEFT JOIN makers m ON m.id=p.maker_id WHERE p.status='owed' ORDER BY p.id").all();
    res.send(page.studio({ bids, open, done, owed, auto: AUTO(), notice: req.query.ok, base: C.base }));
  });
  // Payment has been taken and the seller paid, by hand: record the trade and hand the buyer their claim link.
  app.post('/studio/market/:bid/settle', studioOnly, (req, res) => {
    const d = db.prepare("SELECT * FROM bids WHERE id=? AND status='new'").get(Number(req.params.bid)); if (!d) return res.redirect('/studio/market');
    const s = db.prepare("SELECT * FROM listings WHERE id=? AND status='open'").get(d.listing_id); if (!s) return res.redirect('/studio/market');
    const l = lic(s.license_id); const price = Math.round(Number(String((req.body || {}).price || '').replace(/[^0-9.]/g, '')) * 100) || d.offer_cents || s.ask_cents;
    const sp = split(price), token = nanoid(24);
    db.prepare('INSERT INTO transfers (license_id, token, from_buyer) VALUES (?,?,?)').run(l.id, token, s.seller);
    db.prepare('INSERT INTO trades (license_id, listing_id, bid_id, seller, price_cents, royalty_cents, fee_cents, claim) VALUES (?,?,?,?,?,?,?,?)').run(l.id, s.id, d.id, s.seller, price, sp.royalty, sp.fee, token);
    db.prepare("UPDATE listings SET status='sold', closed_at=datetime('now') WHERE id=?").run(s.id);
    db.prepare("UPDATE bids SET status='settled' WHERE id=?").run(d.id);
    db.prepare("UPDATE bids SET status='closed' WHERE listing_id=? AND status='new'").run(s.id);
    ledger.append(db, 'market.traded', l.ref, { work: l.slug, collector_no: l.collector_no, price, royalty: sp.royalty, fee: sp.fee });
    res.redirect('/studio/market?ok=' + encodeURIComponent(`Traded. Send ${d.email} this link to take it: ${C.base}/claim/${token}`));
  });
  app.post('/studio/market/:bid/decline', studioOnly, (req, res) => { db.prepare("UPDATE bids SET status='declined' WHERE id=?").run(Number(req.params.bid)); res.redirect('/studio/market'); });


  // ---------- settlement through Stripe ----------
  const isHeld = s => s.held_until && new Date(s.held_until + 'Z') > new Date();
  const buyerByEmail = (email, customer) => {
    let b = email && db.prepare('SELECT * FROM buyers WHERE lower(email)=lower(?) ORDER BY id LIMIT 1').get(email);
    if (!b) { const id = db.prepare('INSERT INTO buyers (customer, email) VALUES (?,?)').run(customer || '', email || null).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); }
    return b;
  };
  // Buy it now (or pay an accepted offer): Stripe Checkout, the piece held for the buyer while they pay.
  app.post('/market/:id/buy', async (req, res) => {
    const s = db.prepare("SELECT * FROM listings WHERE id=? AND status='open'").get(Number(req.params.id)); if (!s || !AUTO()) return res.redirect(`/market/${req.params.id}`);
    const b = buyerOf(req); if (b && b.id === s.seller) return res.redirect(`/market/${s.id}`);
    const tok = String((req.body || {}).bid || '');
    const d = tok ? db.prepare("SELECT * FROM bids WHERE listing_id=? AND token=? AND status='new'").get(s.id, tok) : null;
    if (isHeld(s) && !d) return res.redirect(`/market/${s.id}?sent=held`);
    const price = d ? d.offer_cents || s.ask_cents : s.ask_cents, l = lic(s.license_id), m = mk({ maker_id: l.maker_id });
    try {
      const cs = await stripe.checkout.sessions.create({
        mode: 'payment', submit_type: 'pay', customer_creation: 'always', ...(d && d.email ? { customer_email: d.email } : {}),
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: price, product_data: { name: `${tidy(l.title)}, No. ${l.collector_no}${l.edition_size ? ` of ${l.edition_size}` : ''}`, description: `From its collector, through Watermark. Photograph by ${m.name}; ${Math.round(ROYALTY * 100)}% goes to the photographer.`, images: [`${C.base}/img/${l.slug}/thumb`] } } }],
        metadata: { market: String(s.id), ...(d ? { bid: String(d.id) } : {}) }, payment_intent_data: { transfer_group: `listing-${s.id}`, metadata: { market: String(s.id) } },
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
        success_url: `${C.base}/market/${s.id}/done?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${C.base}/market/${s.id}`,
      });
      db.prepare("UPDATE listings SET held_until=datetime('now','+32 minutes'), held_session=? WHERE id=?").run(cs.id, s.id);
      res.redirect(303, cs.url);
    } catch (e) { console.error('[market]', e.message); res.redirect(`/market/${s.id}?sent=unavailable`); }
  });

  // Paid: record the trade, move the piece to the buyer, pay the collector and the photographer.
  async function settleStripe(listingId, cs) {
    const done = db.prepare('SELECT * FROM trades WHERE stripe_session=?').get(cs.id); if (done) return done;
    if (cs.payment_status !== 'paid') return null;
    const s = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
    const pi = typeof cs.payment_intent === 'string' ? cs.payment_intent : cs.payment_intent && cs.payment_intent.id;
    if (!s || s.status !== 'open') { // sold to someone else first: refund in full
      try { await stripe.refunds.create({ payment_intent: pi }); ledger.append(db, 'market.refunded', `listing-${listingId}`, { amount: cs.amount_total }); } catch (e) { console.error('[market] refund', e.message); }
      return null;
    }
    const l = lic(s.license_id), d = cs.customer_details || {}, price = cs.amount_total;
    const b = buyerByEmail(d.email, typeof cs.customer === 'string' ? cs.customer : '');
    const sp = split(price), token = nanoid(32);
    const tid = db.transaction(() => {
      db.prepare("INSERT INTO transfers (license_id, token, from_buyer, to_buyer, claimed_at) VALUES (?,?,?,?,datetime('now'))").run(l.id, nanoid(24), s.seller, b.id);
      const id = db.prepare("INSERT INTO trades (license_id, listing_id, bid_id, seller, price_cents, royalty_cents, fee_cents, settled, buyer_id, stripe_session, payment_intent) VALUES (?,?,?,?,?,?,?,'stripe',?,?,?)")
        .run(l.id, s.id, cs.metadata && cs.metadata.bid ? Number(cs.metadata.bid) : null, s.seller, price, sp.royalty, sp.fee, b.id, cs.id, pi || null).lastInsertRowid;
      db.prepare("UPDATE licenses SET buyer_id=?, download_token=?, licensee_name=COALESCE(?, licensee_name), licensee_email=COALESCE(?, licensee_email), updated_at=datetime('now') WHERE id=?").run(b.id, token, d.name || null, d.email || null, l.id);
      db.prepare("UPDATE listings SET status='sold', closed_at=datetime('now'), held_until=NULL WHERE id=?").run(s.id);
      db.prepare("UPDATE bids SET status=CASE WHEN id=? THEN 'settled' ELSE 'closed' END WHERE listing_id=? AND status='new'").run(cs.metadata && cs.metadata.bid ? Number(cs.metadata.bid) : 0, s.id);
      db.prepare("UPDATE offers SET status='closed', closed_at=datetime('now') WHERE license_id=? AND status='open'").run(l.id);
      db.prepare("INSERT INTO payouts (trade_id, kind, buyer_id, amount_cents) VALUES (?,?,?,?)").run(id, 'seller', s.seller, sp.seller);
      // The house keeps its own royalty; any other photographer is paid out.
      db.prepare("INSERT INTO payouts (trade_id, kind, maker_id, amount_cents, status) VALUES (?,?,?,?,?)").run(id, 'royalty', l.maker_id, sp.royalty, l.maker_id === maker.id ? 'house' : 'owed');
      return id;
    })();
    ledger.append(db, 'market.traded', l.ref, { work: l.slug, collector_no: l.collector_no, price, royalty: sp.royalty, fee: sp.fee, settled: 'stripe' });
    ledger.append(db, 'license.transferred', l.ref, { work: l.slug, collector_no: l.collector_no });
    if (mail && d.email) mail.send({ to: d.email, subject: `Yours: ${tidy(l.title)}, No. ${l.collector_no}`, text: `${tidy(l.title)}, No. ${l.collector_no}${l.edition_size ? ` of ${l.edition_size}` : ''}, is now in your collection.\n\nThe full file: ${C.base}/d/${token}\nIts certificate: ${C.base}/c/${l.ref}?k=${token}\nIts history: ${C.base}/w/${l.slug}/life` });
    const seller = db.prepare('SELECT * FROM buyers WHERE id=?').get(s.seller);
    if (mail && seller && seller.email) mail.send({ to: seller.email, subject: `Sold: ${tidy(l.title)}, No. ${l.collector_no}`, text: `Your piece sold for ${money(price)}. Your share is ${money(sp.seller)}${seller.stripe_account ? '; it is on its way to your bank.' : `. To be paid, add your bank details: ${C.base}/yours/payouts`}` });
    await payOwed();
    return db.prepare('SELECT * FROM trades WHERE id=?').get(tid);
  }
  app.locals.marketSettle = settleStripe;

  // Pay every owed share whose recipient can be paid (a Connect account that can receive transfers).
  async function payOwed() {
    if (!stripe) return 0; let n = 0;
    for (const p of db.prepare("SELECT p.*, t.payment_intent, t.listing_id FROM payouts p JOIN trades t ON t.id=p.trade_id WHERE p.status='owed'").all()) {
      const acct = p.buyer_id ? (db.prepare('SELECT stripe_account FROM buyers WHERE id=?').get(p.buyer_id) || {}).stripe_account : (db.prepare('SELECT stripe_account FROM makers WHERE id=?').get(p.maker_id) || {}).stripe_account;
      if (!acct) continue;
      try {
        let charge; if (p.payment_intent) { const pi = await stripe.paymentIntents.retrieve(p.payment_intent); charge = pi.latest_charge; }
        const tr = await stripe.transfers.create({ amount: p.amount_cents, currency: 'usd', destination: acct, transfer_group: `listing-${p.listing_id}`, ...(charge ? { source_transaction: charge } : {}), metadata: { payout: String(p.id) } });
        db.prepare("UPDATE payouts SET status='paid', stripe_transfer=?, paid_at=datetime('now') WHERE id=?").run(tr.id, p.id);
        ledger.append(db, 'payout.sent', `payout-${p.id}`, { kind: p.kind, amount: p.amount_cents }); n++;
      } catch (e) { console.error('[payout]', p.id, e.message); }
    }
    return n;
  }
  app.locals.payOwed = payOwed;

  app.get('/market/:id/done', async (req, res) => {
    const s = db.prepare('SELECT * FROM listings WHERE id=?').get(Number(req.params.id)); if (!s || !stripe) return res.redirect('/market');
    let t = null;
    try { const cs = await stripe.checkout.sessions.retrieve(String(req.query.session_id || '')); if (cs.metadata && cs.metadata.market === String(s.id)) t = await settleStripe(s.id, cs); } catch (e) { console.error('[market] done', e.message); }
    if (!t) return res.redirect(`/market/${s.id}?sent=pending`);
    const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(t.buyer_id); if (b) setBuyer(res, b);
    res.redirect('/yours?got=' + encodeURIComponent(lic(t.license_id).ref));
  });

  // Webhooks: a paid market checkout settles even if the buyer closes the tab; a session that lapses frees the piece.
  const prevEvent = app.locals.patronEvent;
  app.locals.patronEvent = event => {
    if (prevEvent) prevEvent(event);
    const o = event.data.object;
    if (event.type === 'checkout.session.completed' && o.metadata && o.metadata.market && AUTO()) settleStripe(Number(o.metadata.market), o).catch(e => console.error('[market]', e.message));
    if (event.type === 'checkout.session.expired' && o.metadata && o.metadata.market) db.prepare('UPDATE listings SET held_until=NULL, held_session=NULL WHERE id=? AND held_session=?').run(Number(o.metadata.market), o.id);
    if (event.type === 'account.updated' && o.payouts_enabled) payOwed().catch(() => {});
  };

  // Getting paid: a collector (or a photographer) connects a bank account once, through Stripe.
  const payoutsOf = b => db.prepare("SELECT p.*, w.title, l.collector_no FROM payouts p JOIN trades t ON t.id=p.trade_id JOIN licenses l ON l.id=t.license_id JOIN works w ON w.id=l.work_id WHERE p.buyer_id=? ORDER BY p.id DESC").all(b.id);
  app.get('/yours/payouts', async (req, res) => {
    const b = buyerOf(req); if (!b) return res.redirect('/signin');
    let ready = false; if (b.stripe_account && stripe) { try { const a = await stripe.accounts.retrieve(b.stripe_account); ready = !!a.payouts_enabled; if (ready) await payOwed(); } catch (e) { /* show as not ready */ } }
    res.send(page.payouts({ rows: payoutsOf(b), ready, linked: !!b.stripe_account, on: AUTO() }));
  });
  app.post('/yours/payouts/connect', async (req, res) => {
    const b = buyerOf(req); if (!b || !stripe) return res.redirect('/yours/payouts');
    try {
      let acct = b.stripe_account;
      if (!acct) { const a = await stripe.accounts.create({ type: 'express', email: b.email || undefined, capabilities: { transfers: { requested: true } }, metadata: { buyer: String(b.id) } }); acct = a.id; db.prepare('UPDATE buyers SET stripe_account=? WHERE id=?').run(acct, b.id); }
      const link = await stripe.accountLinks.create({ account: acct, type: 'account_onboarding', refresh_url: `${C.base}/yours/payouts`, return_url: `${C.base}/yours/payouts` });
      res.redirect(303, link.url);
    } catch (e) { console.error('[connect]', e.message); res.redirect('/yours/payouts?err=1'); }
  });

  // ---------- pages ----------
  const ratio = r => (r.width && r.height ? (r.width / r.height).toFixed(3) : '1.5');
  const no = r => `No.&nbsp;${r.collector_no}${r.edition_size ? ` of ${r.edition_size}` : ''}`;
  const page = {
    exchange: ({ open, recent, vol }) => layout({ title: 'The market · Watermark', desc: 'Numbered photographs offered by their collectors, and what has traded.', path: '/market', body: `<section class="cx-intro mk">
<p class="k">The market</p><h1>Where collectors pass the work on.</h1>
<p class="lede">Limited editions are numbered, and when an edition is complete the only way to own one is from a collector who holds it. Pieces offered here are offered by their collectors, at prices they set. Every trade is recorded, so each work carries its own price history.</p>
<p class="mk-stats"><span><b>${open.length}</b> offered</span><span><b>${vol.n}</b> traded</span><span><b>${money(vol.v)}</b> traded in all</span></p></section>
<section class="gal"><header class="gh"><h2>Offered now</h2><span>by their collectors</span></header>
${open.length ? `<div class="mk-grid">${open.map(r => `<a class="mk-c" href="/market/${r.id}"><span class="mk-im" style="--r:${ratio(r)}"><img src="/img/${esc(r.slug)}/thumb" alt="${esc(tidy(r.title))}" loading="lazy" draggable="false"></span>
<span class="mk-no">${no(r)}</span><b>${esc(tidy(r.title))}</b><span class="mk-by">${esc(r.maker)}</span><span class="mk-px"><em>${money(r.ask_cents)}</em>${r.p.last != null ? `<small>last traded ${money(r.p.last)}</small>` : r.p.issue != null ? `<small>issued at ${money(r.p.issue)}</small>` : ''}</span></a>`).join('')}</div>` : '<p class="hd-calm">Nothing is offered just now. When a collector offers a piece, it appears here.</p>'}</section>
${recent.length ? `<section class="gal"><header class="gh"><h2>Traded</h2><span>most recent first</span></header>${recent.map(t => `<a class="hd-ev" href="/w/${esc(t.slug)}/life"><span>${date(t.at)}</span><b>${esc(tidy(t.title))}</b><span>${no(t)} &middot; ${esc(t.maker)}</span><span class="hd-v">${money(t.price_cents)}</span></a>`).join('')}</section>` : ''}
<section class="gal mk-how"><header class="gh"><h2>How it works</h2></header><ol class="mk-steps">
<li><b>A collector offers a piece.</b> From their collection, at a price they choose. They can withdraw it at any time.</li>
<li><b>You ask to buy it.</b> At the asking price, or with an offer of your own.</li>
<li><b>Watermark settles it.</b> You pay Watermark; the piece moves to you with its number; the collector is paid out, and the photographer receives ${Math.round(ROYALTY * 100)}% of every resale. Watermark keeps ${Math.round(FEE * 100)}%. Neither side has to trust the other.</li>
<li><b>It hangs on your wall.</b> With its number, its certificate and its history, written to the ledger.</li></ol>
<p class="note">Prices here are what collectors ask and what they have paid. They are not valuations or advice, and past prices say nothing certain about future ones.</p></section>` }),

    listing: ({ s, l, m, p, mine, sent, auto, bid, held }) => layout({ title: `${tidy(l.title)}, No. ${l.collector_no} · The market · Watermark`, body: `<section class="mk-l">
<a class="mk-im mk-big" href="/w/${esc(l.slug)}" style="--r:${ratio(l)}"><img src="/img/${esc(l.slug)}/large" alt="${esc(tidy(l.title))}" draggable="false"></a>
<div class="mk-side"><p class="k">Offered by its collector</p><h1>${esc(tidy(l.title))}</h1><p class="mk-no mk-no-big">${no(l)}</p><p class="mk-by">${esc(m.name)}${l.place ? ` &middot; ${esc(l.place)}` : ''}</p>
<dl class="sh-dl mk-dl"><div><dt>Asking</dt><dd class="mk-ask">${money(s.ask_cents)}</dd></div>${p.issue != null ? `<div><dt>Issued at</dt><dd>${money(p.issue)}</dd></div>` : ''}${p.last != null ? `<div><dt>Last traded</dt><dd>${money(p.last)}, ${date(p.lastAt)}</dd></div>` : ''}<div><dt>To the photographer</dt><dd>${Math.round(ROYALTY * 100)}% of the price, ${money(Math.round(s.ask_cents * ROYALTY))} at the asking price</dd></div></dl>
${s.status !== 'open' ? '<p class="note">This piece is no longer offered.</p>' : mine ? '<p class="note">This is your offer. Change or withdraw it from <a href="/yours#files">your collection</a>.</p>'
  : auto ? (sent === '1' ? '<p class="ok">Your offer is with the collector. If they accept, you will have a link to pay, and the piece moves to your collection the moment you do.</p>' : '')
    + (sent === 'held' ? '<p class="note">Someone is paying for this piece right now. If they do not finish, it is offered again within half an hour.</p>' : sent === 'pending' ? '<p class="note">Your payment is being confirmed. The piece appears in your collection within a minute.</p>' : sent === 'unavailable' ? '<p class="err">Payment is unavailable for a moment. Try again shortly.</p>' : sent === 'offer' || sent === 'email' ? '<p class="err">An email address and an offer, so the collector can answer.</p>' : '')
    + `<form method="post" action="/market/${s.id}/buy" class="mk-buy">${bid ? `<input type="hidden" name="bid" value="${esc(bid.token)}"><p class="ok">The collector accepted your offer.</p>` : ''}<button class="jewel"${held && !bid ? ' disabled' : ''}><span>${bid ? 'Pay and take it' : 'Buy it now'}</span><b>${money(bid ? bid.offer_cents : s.ask_cents)}</b></button>
<p class="note">Apple Pay, Google Pay or card. The piece moves to your collection with its number the moment you pay; the collector is paid, and the photographer receives ${Math.round(ROYALTY * 100)}%.</p></form>`
    + (bid ? '' : `<details class="mk-off"><summary>Make an offer</summary><form method="post" action="/market/${s.id}/bid" class="form mk-f"><label>Your name<input name="name" autocomplete="name"></label><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Your offer<input name="offer" inputmode="decimal" required placeholder="${esc(money(Math.round(s.ask_cents * 0.85 / 100) * 100))}"></label><button class="btn">Send it to the collector</button><p class="note">Nothing is charged unless they accept and you pay.</p></form></details>`)
  : sent === '1' ? '<p class="ok">Your request is with Watermark. We will write to you to settle it: payment first, then the piece moves to your collection with its number.</p>'
  : `<form method="post" action="/market/${s.id}/bid" class="form mk-f">${sent === 'email' ? '<p class="err">An email address, so we can settle it with you.</p>' : ''}<label>Your name<input name="name" autocomplete="name"></label><label>Email<input name="email" type="email" required autocomplete="email"></label>
<label>Your offer, if not the asking price<input name="offer" inputmode="decimal" placeholder="${esc(money(s.ask_cents))}"></label><button class="jewel"><span>Ask to buy it</span><b>${money(s.ask_cents)}</b></button>
<p class="note">Nothing is charged now. Watermark settles each trade with both collectors.</p></form>`}
<p class="sr-also"><a href="/w/${esc(l.slug)}/life">Its history</a> &middot; <a href="/market">The market</a></p></div></section>` }),

    payouts: ({ rows, ready, linked, on }) => layout({ title: 'Getting paid · Watermark', body: `<section class="narrow mk-pay">
<p class="k">Getting paid</p><h1>${ready ? 'Your bank is connected.' : 'Where your share goes.'}</h1>
<p class="lede">When a piece you offer sells, your share is paid to your bank through Stripe, Watermark's payment provider. You add your details once; Watermark never sees them.</p>
${ready ? '<p class="ok">Payouts are on. Each sale is paid out as it settles.</p>' : on ? `<form method="post" action="/yours/payouts/connect"><button class="btn">${linked ? 'Finish adding your bank' : 'Add your bank, through Stripe'}</button></form>` : '<p class="note">Payouts open when the market settles through Stripe.</p>'}
${rows.length ? `<section class="hd-list"><div class="hd-h"><h2>Your shares</h2></div>${rows.map(r => `<div class="hd-ev"><span>${date(r.created_at)}</span><b>${esc(tidy(r.title))}</b><span>No.&nbsp;${r.collector_no} &middot; ${r.status === 'paid' ? 'paid' : 'waiting for your bank'}</span><span class="hd-v">${money(r.amount_cents)}</span></div>`).join('')}</section>` : ''}
<p class="sr-also"><a href="/yours">Your collection</a></p></section>` }),
    studio: ({ bids, open, done, owed = [], auto = false, notice }) => layout({ studio: true, title: 'Market · Watermark', body: `<section class="studio-wrap hd">${require('./studio-views').nav('/studio/market')}
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}<p class="k">The market</p><h1>Trades to settle.</h1>
<p class="lede">${auto ? 'Trades settle on their own: the buyer pays through Stripe, the piece moves at once, and each share is paid out through Stripe Connect as soon as its owner has added a bank account. Anything brokered by hand still appears below.' : 'Settlement through Stripe is off (MARKET_SETTLEMENT). Until it is on, each trade is brokered here: take payment from the buyer, pay the collector their share, then record it. The piece moves when the buyer opens their claim link.'}</p>
${owed.length ? `<section class="hd-list"><div class="hd-h"><h2>Owed</h2><span>paid when the owner adds a bank account</span></div>${owed.map(o => `<div class="hd-ev"><span>${date(o.created_at)}</span><b>${esc(o.kind === 'seller' ? 'Collector' : 'Photographer')}: ${esc(o.who || '')}</b><span>${esc(tidy(o.title))}</span><span class="hd-v">${money(o.amount_cents)}</span></div>`).join('')}</section>` : ''}
<section class="hd-list"><div class="hd-h"><h2>Requests</h2></div>${bids.length ? bids.map(d => { const price = d.offer_cents || d.ask_cents, sp = split(price); return `<div class="mk-bid"><div><b>${esc(tidy(d.title))}</b> <small>${no(d)}</small><p>${esc(d.name || 'Someone')} &lt;${esc(d.email)}&gt; ${d.offer_cents ? `offers <b>${money(d.offer_cents)}</b> (asking ${money(d.ask_cents)})` : `at the asking price, <b>${money(d.ask_cents)}</b>`}</p><small>At ${money(price)}: collector ${money(sp.seller)} &middot; photographer ${money(sp.royalty)} &middot; Watermark ${money(sp.fee)}</small></div>
<form method="post" action="/studio/market/${d.id}/settle" class="inline mk-set"><input name="price" inputmode="decimal" value="${(price / 100).toFixed(0)}" aria-label="Final price, dollars"><button>Record the trade</button></form><form method="post" action="/studio/market/${d.id}/decline" class="inline"><button class="link">Decline</button></form></div>`; }).join('') : '<p class="hd-calm">No requests waiting.</p>'}</section>
<section class="hd-list"><div class="hd-h"><h2>Offered</h2><a href="/market">The market &rarr;</a></div>${open.map(s => `<a class="hd-ev" href="/market/${s.id}"><span>${date(s.created_at)}</span><b>${esc(tidy(s.title))}</b><span>${no(s)} &middot; ${s.bids} request${s.bids === 1 ? '' : 's'}</span><span class="hd-v">${money(s.ask_cents)}</span></a>`).join('') || '<p class="hd-calm">Nothing offered.</p>'}</section>
<section class="hd-list"><div class="hd-h"><h2>Traded</h2></div>${done.map(t => `<div class="hd-ev"><span>${date(t.at)}</span><b>${esc(tidy(t.title))}</b><span>${no(t)} &middot; ${t.settled === 'stripe' ? 'settled through Stripe' : 'brokered'} &middot; royalty ${money(t.royalty_cents)} &middot; fee ${money(t.fee_cents)}${t.claim ? ` &middot; <a href="/claim/${esc(t.claim)}">claim link</a>` : ''}</span><span class="hd-v">${money(t.price_cents)}</span></div>`).join('') || '<p class="hd-calm">No trades yet.</p>'}</section></section>` }),
  };
  return { priceOf, portfolio, split, settleStripe, payOwed, AUTO };
}

module.exports = { mountMarket, ROYALTY, FEE };
