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

function mountMarket(app, { db, C, maker, buyerOf, setBuyer, isStudio, studioOnly, ledger, V, mk, edition }) {
  db.exec(`CREATE TABLE IF NOT EXISTS listings (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, seller INTEGER NOT NULL, ask_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS bids (id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL, buyer_id INTEGER, name TEXT, email TEXT NOT NULL, offer_cents INTEGER,
    status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, listing_id INTEGER, bid_id INTEGER, seller INTEGER, price_cents INTEGER NOT NULL,
    royalty_cents INTEGER NOT NULL, fee_cents INTEGER NOT NULL, settled TEXT NOT NULL DEFAULT 'brokered', claim TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
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
    res.send(page.listing({ s, l, m: mk({ maker_id: l.maker_id }), p: priceOf(l.work_id), mine: !!(b && b.id === s.seller), sent: req.query.sent, base: C.base }));
  });
  app.post('/market/:id/bid', (req, res) => {
    const s = db.prepare("SELECT * FROM listings WHERE id=? AND status='open'").get(Number(req.params.id)); if (!s) return res.redirect('/market');
    const x = req.body || {}, b = buyerOf(req);
    const email = String(x.email || '').trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect(`/market/${s.id}?sent=email`);
    if (b && b.id === s.seller) return res.redirect(`/market/${s.id}`);
    const offer = String(x.offer || '').trim() ? Math.round(Number(String(x.offer).replace(/[^0-9.]/g, '')) * 100) : null;
    db.prepare('INSERT INTO bids (listing_id, buyer_id, name, email, offer_cents) VALUES (?,?,?,?,?)').run(s.id, b ? b.id : null, String(x.name || '').trim().slice(0, 80) || null, email.slice(0, 160), offer && offer > 0 ? offer : null);
    ledger.append(db, 'market.bid', `listing-${s.id}`, { offer: offer || s.ask_cents });
    res.redirect(`/market/${s.id}?sent=1`);
  });

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
    res.send(page.studio({ bids, open, done, notice: req.query.ok, base: C.base }));
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
<li><b>Watermark settles it.</b> Payment is taken, the collector is paid, and the photographer receives ${Math.round(ROYALTY * 100)}% of every resale. Watermark keeps ${Math.round(FEE * 100)}%.</li>
<li><b>It hangs on your wall.</b> With its number, its certificate and its history, written to the ledger.</li></ol>
<p class="note">Prices here are what collectors ask and what they have paid. They are not valuations or advice, and past prices say nothing certain about future ones.</p></section>` }),

    listing: ({ s, l, m, p, mine, sent }) => layout({ title: `${tidy(l.title)}, No. ${l.collector_no} · The market · Watermark`, body: `<section class="mk-l">
<a class="mk-im mk-big" href="/w/${esc(l.slug)}" style="--r:${ratio(l)}"><img src="/img/${esc(l.slug)}/large" alt="${esc(tidy(l.title))}" draggable="false"></a>
<div class="mk-side"><p class="k">Offered by its collector</p><h1>${esc(tidy(l.title))}</h1><p class="mk-no mk-no-big">${no(l)}</p><p class="mk-by">${esc(m.name)}${l.place ? ` &middot; ${esc(l.place)}` : ''}</p>
<dl class="sh-dl mk-dl"><div><dt>Asking</dt><dd class="mk-ask">${money(s.ask_cents)}</dd></div>${p.issue != null ? `<div><dt>Issued at</dt><dd>${money(p.issue)}</dd></div>` : ''}${p.last != null ? `<div><dt>Last traded</dt><dd>${money(p.last)}, ${date(p.lastAt)}</dd></div>` : ''}<div><dt>To the photographer</dt><dd>${Math.round(ROYALTY * 100)}% of the price, ${money(Math.round(s.ask_cents * ROYALTY))} at the asking price</dd></div></dl>
${s.status !== 'open' ? '<p class="note">This piece is no longer offered.</p>' : mine ? '<p class="note">This is your offer. Change or withdraw it from <a href="/yours#files">your collection</a>.</p>'
  : sent === '1' ? '<p class="ok">Your request is with Watermark. We will write to you to settle it: payment first, then the piece moves to your collection with its number.</p>'
  : `<form method="post" action="/market/${s.id}/bid" class="form mk-f">${sent === 'email' ? '<p class="err">An email address, so we can settle it with you.</p>' : ''}<label>Your name<input name="name" autocomplete="name"></label><label>Email<input name="email" type="email" required autocomplete="email"></label>
<label>Your offer, if not the asking price<input name="offer" inputmode="decimal" placeholder="${esc(money(s.ask_cents))}"></label><button class="jewel"><span>Ask to buy it</span><b>${money(s.ask_cents)}</b></button>
<p class="note">Nothing is charged now. Watermark settles each trade with both collectors.</p></form>`}
<p class="sr-also"><a href="/w/${esc(l.slug)}/life">Its history</a> &middot; <a href="/market">The market</a></p></div></section>` }),

    studio: ({ bids, open, done, notice }) => layout({ studio: true, title: 'Market · Watermark', body: `<section class="studio-wrap hd">${require('./studio-views').nav('/studio/market')}
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}<p class="k">The market</p><h1>Trades to settle.</h1>
<p class="lede">Until settlement runs through Stripe Connect, each trade is brokered here: take payment from the buyer, pay the collector their share, then record it. The piece moves when the buyer opens their claim link.</p>
<section class="hd-list"><div class="hd-h"><h2>Requests</h2></div>${bids.length ? bids.map(d => { const price = d.offer_cents || d.ask_cents, sp = split(price); return `<div class="mk-bid"><div><b>${esc(tidy(d.title))}</b> <small>${no(d)}</small><p>${esc(d.name || 'Someone')} &lt;${esc(d.email)}&gt; ${d.offer_cents ? `offers <b>${money(d.offer_cents)}</b> (asking ${money(d.ask_cents)})` : `at the asking price, <b>${money(d.ask_cents)}</b>`}</p><small>At ${money(price)}: collector ${money(sp.seller)} &middot; photographer ${money(sp.royalty)} &middot; Watermark ${money(sp.fee)}</small></div>
<form method="post" action="/studio/market/${d.id}/settle" class="inline mk-set"><input name="price" inputmode="decimal" value="${(price / 100).toFixed(0)}" aria-label="Final price, dollars"><button>Record the trade</button></form><form method="post" action="/studio/market/${d.id}/decline" class="inline"><button class="link">Decline</button></form></div>`; }).join('') : '<p class="hd-calm">No requests waiting.</p>'}</section>
<section class="hd-list"><div class="hd-h"><h2>Offered</h2><a href="/market">The market &rarr;</a></div>${open.map(s => `<a class="hd-ev" href="/market/${s.id}"><span>${date(s.created_at)}</span><b>${esc(tidy(s.title))}</b><span>${no(s)} &middot; ${s.bids} request${s.bids === 1 ? '' : 's'}</span><span class="hd-v">${money(s.ask_cents)}</span></a>`).join('') || '<p class="hd-calm">Nothing offered.</p>'}</section>
<section class="hd-list"><div class="hd-h"><h2>Traded</h2></div>${done.map(t => `<div class="hd-ev"><span>${date(t.at)}</span><b>${esc(tidy(t.title))}</b><span>${no(t)} &middot; royalty ${money(t.royalty_cents)} &middot; fee ${money(t.fee_cents)}${t.claim ? ` &middot; <a href="/claim/${esc(t.claim)}">claim link</a>` : ''}</span><span class="hd-v">${money(t.price_cents)}</span></div>`).join('') || '<p class="hd-calm">No trades yet.</p>'}</section></section>` }),
  };
  return { priceOf, portfolio, split };
}

module.exports = { mountMarket, ROYALTY, FEE };
