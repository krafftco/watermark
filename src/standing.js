// The standing order (Will, 25 Oct, from the list of what makes the house hum; "Let's go"): a collector asks the house to
// choose one piece a month and put it into their gallery, at the price of a Collect, charged by the month. Book-of-the-
// Month's shape, a museum's eye: the piece is chosen by the house's eye (looking.candidates: what they stood before,
// never what they hold or were shown), a Collect like any other (its own licence, its own number, the maker paid as for
// any sale, the house's share as published), and told by letter and notice with the piece on its mount. Pause or end any
// time; the month paid runs out. The first piece arrives the day the order begins. Nothing is chosen without a payment:
// each pick follows an invoice Stripe has paid (the first with the checkout, then each month's), and a daily catch-up
// asks Stripe about any order whose month has passed with no pick, so a missed webhook never costs a collector a piece.
const FEE = require('./fee');

const STANDING_CENTS = () => Number(process.env.STANDING_CENTS || FEE.total('social', 500)); // the Collect, with the house's share when the fee is on

function mountStanding(app, { db, V, C, ledger, stripe, buyerOf, setBuyer, mail, notify, grant, nextRef, stampHouse, collectFor, mk }) {
  const { esc, layout, money, tidy } = V;
  const base = C.base;
  db.exec(`CREATE TABLE IF NOT EXISTS standing (id INTEGER PRIMARY KEY, buyer_id INTEGER, email TEXT, name TEXT, cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      stripe_session TEXT, stripe_sub TEXT, started_at TEXT, ended_at TEXT, last_pick_at TEXT, picks INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS standing_picks (id INTEGER PRIMARY KEY, standing_id INTEGER NOT NULL, work_id INTEGER NOT NULL, ref TEXT, invoice TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS standing_buyer ON standing (buyer_id, status)`);
  const post = (to, subject, text, cta) => { if (!to || !mail) return; mail.send({ to, subject, text, cta }).catch(e => console.error('[standing]', e.message)); };
  const tell = (b, n) => { if (!notify || !b) return; notify.tell({ buyer_id: b.id, ...n }).catch(() => {}); };
  const byId = id => db.prepare('SELECT * FROM standing WHERE id=?').get(Number(id));
  const ofBuyer = b => b ? db.prepare("SELECT * FROM standing WHERE buyer_id=? AND status IN ('active','ending') ORDER BY id DESC LIMIT 1").get(b.id) : null;
  const picksOf = s => db.prepare('SELECT p.*, w.slug, w.title, w.place, w.taken_at, m.name AS maker, l.collector_no, l.download_token FROM standing_picks p JOIN works w ON w.id=p.work_id JOIN makers m ON m.id=w.maker_id LEFT JOIN licenses l ON l.ref=p.ref WHERE p.standing_id=? ORDER BY p.id DESC').all(s.id);

  // The eye chooses: the house's candidates for this collector, the first that can be collected now at the order's price
  // and that they do not hold; else the best unheld work in the house. Null only when there is nothing to give.
  function choose(s) {
    const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(s.buyer_id); if (!b) return null;
    const taken = new Set(db.prepare('SELECT work_id FROM standing_picks WHERE standing_id=?').all(s.id).map(r => r.work_id));
    const fits = w => { const x = collectFor(b, w.slug); return x && x.u.price_cents <= s.cents && !taken.has(x.w.id) ? x : null; };
    let cands = [];
    try { cands = app.locals.looking ? app.locals.looking.candidates(b, null, 40, 1).picks : []; } catch (e) { cands = []; }
    for (const c of cands) { const x = fits(c); if (x) return x; }
    const rest = db.prepare("SELECT slug FROM works WHERE status='held' ORDER BY curated DESC, stars DESC, random() LIMIT 200").all();
    for (const c of rest) { const x = fits(c); if (x) return x; }
    return null;
  }
  // One piece into the gallery: a licence granted as paid at the order's price, the register told, the letter sent.
  function pick(s, { invoice = null, why = null } = {}) {
    if (!s || !['active', 'ending'].includes(s.status)) return null;
    if (invoice && db.prepare('SELECT 1 FROM standing_picks WHERE invoice=?').get(invoice)) return null; // never twice for one payment
    const x = choose(s); if (!x) { console.error('[standing] nothing to give', s.id); return null; }
    const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(s.buyer_id);
    const ref = nextRef();
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,price_cents,status,buyer_id,set_ref) VALUES (?,?,?,?,?,?,'awaiting_payment',?,?)").run(ref, x.w.id, x.u.id, b.name || 'Collector', b.email || s.email || '', x.u.price_cents, b.id, `standing:${s.id}`);
    stampHouse(ref, x.u);
    grant(ref, { paid: true, price_cents: x.u.price_cents });
    db.prepare('INSERT INTO standing_picks (standing_id, work_id, ref, invoice) VALUES (?,?,?,?)').run(s.id, x.w.id, ref, invoice);
    db.prepare("UPDATE standing SET last_pick_at=datetime('now'), picks=picks+1 WHERE id=?").run(s.id);
    ledger.append(db, 'license.paid.standing', ref, { work: x.w.slug, use: 'social', amount: x.u.price_cents, standing: s.id });
    const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref), maker = mk(x.w);
    const first = (b.name || '').split(/\s+/)[0] || 'Collector';
    const k = l.download_token ? `?k=${l.download_token}` : '';
    tell(b, { kind: 'standing', title: `This month: ${tidy(x.w.title)}`, body: `${maker.name}${x.w.place ? ` · ${x.w.place}` : ''}. Chosen for you; it is in your gallery.`, href: `/thanks/${ref}${k}`, slug: x.w.slug });
    post(b.email || s.email, `This month, ${tidy(x.w.title)}`, `${first},\n\nThe house chose ${tidy(x.w.title)}, by ${maker.name}${x.w.place ? `, ${x.w.place}` : ''}, for you this month.${l.collector_no ? ` It is No. ${l.collector_no}.` : ''} It is in your gallery now; the file and the papers are at the address below.\n\nSee it: ${base}/thanks/${ref}${k}\nYour gallery: ${base}/yours\nYour standing order: ${base}/yours/standing\n\nThank you for collecting.\n\nWatermark`, { label: 'See it', url: `${base}/thanks/${ref}${k}` });
    return { ref, w: x.w };
  }
  function activate(id, sess) {
    const s = byId(id); if (!s || s.status !== 'pending' || (sess.id && s.stripe_session && s.stripe_session !== sess.id)) return s;
    if (sess.status !== 'complete' && sess.payment_status !== 'paid') return s;
    db.prepare("UPDATE standing SET status='active', stripe_sub=?, started_at=datetime('now') WHERE id=?").run(sess.subscription || null, id);
    ledger.append(db, 'standing.begun', `standing-${id}`, { amount: s.cents });
    pick(byId(id), { invoice: sess.invoice || `session:${sess.id}` });
    return byId(id);
  }
  function end(s, how) {
    if (!s || s.status === 'ended') return;
    db.prepare("UPDATE standing SET status='ended', ended_at=datetime('now') WHERE id=?").run(s.id);
    ledger.append(db, 'standing.ended', `standing-${s.id}`, { how });
  }
  // The catch-up: an order whose month has passed with no pick asks Stripe for its latest paid invoice.
  async function catchUp() {
    if (!stripe) return 0; let n = 0;
    for (const s of db.prepare("SELECT * FROM standing WHERE status IN ('active','ending') AND stripe_sub IS NOT NULL AND (last_pick_at IS NULL OR last_pick_at < datetime('now','-32 days'))").all()) {
      try {
        const sub = await stripe.subscriptions.retrieve(s.stripe_sub, { expand: ['latest_invoice'] });
        if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) { end(s, sub.status); continue; }
        const inv = sub.latest_invoice; if (inv && inv.status === 'paid' && (inv.paid || inv.amount_paid > 0)) { if (pick(s, { invoice: inv.id })) n++; }
      } catch (e) { console.error('[standing]', s.id, e.message); }
    }
    return n;
  }
  app.locals.standingEvent = event => {
    const o = event.data.object;
    if (event.type === 'checkout.session.completed' && o.metadata && o.metadata.standing) activate(Number(o.metadata.standing), o);
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
      const sid = (o.subscription_details && o.subscription_details.metadata && o.subscription_details.metadata.standing) || (o.lines && o.lines.data && o.lines.data[0] && o.lines.data[0].metadata && o.lines.data[0].metadata.standing) || null;
      if (sid && o.billing_reason !== 'subscription_create') { const s = byId(sid); if (s) pick(s, { invoice: o.id }); }
    }
    if (event.type === 'customer.subscription.deleted' && o.metadata && o.metadata.standing) end(byId(o.metadata.standing), 'stripe');
  };

  // The door: Yours → the standing order.
  app.get('/yours/standing', (req, res) => {
    const b = buyerOf(req); const s = ofBuyer(b); const cents = STANDING_CENTS();
    const picks = s ? picksOf(s) : [];
    res.set('Cache-Control', 'private, no-store');
    res.send(layout({ title: 'A piece a month · Watermark', path: '/yours', desc: 'The house chooses one piece a month for you, at the price of a Collect.', body: `<section class="narrow prose sto"><p class="k">Your gallery</p><h1>A piece a month.</h1>
<p class="lede">Ask the house to choose for you. Once a month, for ${money(cents)}, the house’s eye picks one work from what you have stood before and what you have not yet seen, collects it in your name, and puts it in your gallery with its number and its papers: a Collect like any other, the maker paid as for any sale. The first arrives today.</p>
${req.query.ok === 'check' ? '<p class="note">A name and an email, please.</p>' : req.query.ok === 'unavailable' ? '<p class="note">Payments are not open yet.</p>' : req.query.ok === 'ending' ? '<p class="note">Your order ends with the month paid. Thank you for collecting with us.</p>' : ''}
${s ? `<div class="sto-on"><p><b>Your standing order is ${s.status === 'ending' ? 'ending with this month' : 'on'}.</b> ${s.picks} piece${s.picks === 1 ? '' : 's'} chosen so far${s.last_pick_at ? `; the last on ${V.date(s.last_pick_at)}` : ''}. ${money(s.cents)} a month.</p>
${picks.length ? `<ul class="sto-picks">${picks.map(p => `<li><a href="/w/${esc(p.slug)}"><img src="/img/${esc(p.slug)}/thumb" alt="" loading="lazy"></a><div><a href="/yours/p/${esc(p.ref)}"><b>${esc(tidy(p.title))}</b></a><br><small>${esc(p.maker)}${p.place ? ` · ${esc(p.place)}` : ''}${p.collector_no ? ` · No. ${p.collector_no}` : ''} · ${V.date(p.at)}</small></div></li>`).join('')}</ul>` : ''}
${s.status === 'active' ? `<form method="post" action="/yours/standing/end"><button class="link">End the standing order</button> <small>The month paid runs out; what was chosen stays yours.</small></form>` : ''}</div>`
  : `<form method="post" action="/yours/standing/begin" class="sto-f"><label>Your name<input name="name" required maxlength="80" value="${esc((b && b.name) || '')}"></label><label>Your email<input type="email" name="email" required maxlength="160" value="${esc((b && b.email) || '')}"></label><button class="buy-btn">Begin · ${money(cents)} a month</button><small>By the month through Stripe; end any time. The price is the maker’s${FEE.on() ? '; the house’s share is on top, as published' : ''}. The pieces are chosen by the house and are not exchanged. The agreement is the same as any Collect’s.</small></form>`}
<h2>How the house chooses</h2><p>From what you have stood before longest, and from further off: never a piece you hold, never one you were shown this fortnight, half close to your taste and half to stretch it. Each is a numbered Collect with the file, the certificate and the agreement, and the maker is paid for it on Friday as for any sale. No piece is chosen without a month paid.</p>
<p class="ky-foot"><a href="/yours">Your gallery</a> · <a href="/wander">Wander</a></p></section>` }));
  });
  app.post('/yours/standing/begin', async (req, res) => {
    const x = req.body || {}; const name = String(x.name || '').trim().slice(0, 80), email = String(x.email || '').trim().toLowerCase().slice(0, 160);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect('/yours/standing?ok=check');
    let b = buyerOf(req);
    if (!b && setBuyer) { b = db.prepare('SELECT * FROM buyers WHERE email=? ORDER BY id LIMIT 1').get(email); if (!b) { const bid = db.prepare("INSERT INTO buyers (customer, email, name) VALUES ('', ?, ?)").run(email, name).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(bid); } setBuyer(res, b); }
    if (!b) return res.redirect('/signin?next=/yours/standing');
    if (ofBuyer(b)) return res.redirect('/yours/standing');
    const cents = STANDING_CENTS();
    const id = db.prepare('INSERT INTO standing (buyer_id, email, name, cents) VALUES (?,?,?,?)').run(b.id, email, name, cents).lastInsertRowid;
    if (!stripe) return res.redirect('/yours/standing?ok=unavailable');
    try {
      const sess = await stripe.checkout.sessions.create({ mode: 'subscription', customer_email: email,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, recurring: { interval: 'month' }, product_data: { name: 'A piece a month, Watermark', description: 'One work chosen by the house each month, collected in your name.' } } }],
        metadata: { standing: String(id) }, subscription_data: { metadata: { standing: String(id) } },
        success_url: `${base}/yours/standing/${id}/thanks?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/yours/standing` });
      db.prepare('UPDATE standing SET stripe_session=? WHERE id=?').run(sess.id, id);
      res.redirect(303, sess.url);
    } catch (e) { console.error('[standing]', e.message); db.prepare("DELETE FROM standing WHERE id=? AND status='pending'").run(id); res.redirect('/yours/standing?ok=unavailable'); }
  });
  app.get('/yours/standing/:id/thanks', async (req, res) => {
    let s = byId(req.params.id); if (!s) return res.sendStatus(404);
    if (s.status === 'pending' && stripe && req.query.session_id) { try { const sess = await stripe.checkout.sessions.retrieve(String(req.query.session_id)); s = activate(s.id, sess) || s; } catch (e) { /* the webhook will */ } }
    const last = db.prepare('SELECT ref FROM standing_picks WHERE standing_id=? ORDER BY id DESC LIMIT 1').get(s.id);
    if (last) { const l = db.prepare('SELECT download_token FROM licenses WHERE ref=?').get(last.ref); return res.redirect(`/thanks/${last.ref}${l && l.download_token ? `?k=${l.download_token}` : ''}`); }
    res.redirect('/yours/standing');
  });
  app.post('/yours/standing/end', async (req, res) => {
    const s = ofBuyer(buyerOf(req)); if (!s) return res.redirect('/yours/standing');
    try { if (stripe && s.stripe_sub) await stripe.subscriptions.update(s.stripe_sub, { cancel_at_period_end: true }); } catch (e) { /* recorded anyway */ }
    db.prepare("UPDATE standing SET status='ending' WHERE id=?").run(s.id);
    res.redirect('/yours/standing?ok=ending');
  });
  const summary = () => { const r = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(cents),0) c FROM standing WHERE status IN ('active','ending')").get(); return { n: r.n, cents: r.c }; };
  app.locals.standingOrders = { pick, activate, end, catchUp, ofBuyer, byId, summary, CENTS: STANDING_CENTS };
  return app.locals.standingOrders;
}
module.exports = { mountStanding, STANDING_CENTS };
