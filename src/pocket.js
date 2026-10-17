// The pocket. Small money, the way iTunes made it easy: put ten dollars in once, and the ninety-nine-cent
// cards go out with one tap, no checkout, no card fee on each. A top-up is a payment to the house (Stripe
// Checkout); what is in the pocket is the house's debt to you, spent only here, never cashed out. Every
// movement is a row; the balance is the sum. What makers are owed from the pocket is paid to them with the
// rest of their earnings (today by hand; by Stripe Connect when it is on).
const { esc, money } = require('./views');
const TOPUPS = [1000, 2500, 5000];

function mountPocket(app, { db, C, stripe, buyerOf, setBuyer, ledger }) {
  db.exec(`CREATE TABLE IF NOT EXISTS pocket (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL, cents INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT, note TEXT,
    status TEXT NOT NULL DEFAULT 'posted', stripe_session TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS pocket_buyer ON pocket(buyer_id, at)`);
  const balance = b => (b ? db.prepare("SELECT COALESCE(SUM(cents),0) s FROM pocket WHERE buyer_id=? AND status='posted'").get(b.id).s : 0);
  const history = b => (b ? db.prepare("SELECT * FROM pocket WHERE buyer_id=? AND status='posted' ORDER BY id DESC LIMIT 40").all(b.id) : []);
  // Spend: returns true when the pocket covered it.
  function spend(b, cents, kind, ref, note) {
    if (!b || !(cents > 0) || balance(b) < cents) return false;
    db.prepare('INSERT INTO pocket (buyer_id, cents, kind, ref, note) VALUES (?,?,?,?,?)').run(b.id, -cents, kind, ref || null, note || null);
    return true;
  }
  app.post('/pocket/add', async (req, res) => {
    const cents = Math.round(Number((req.body || {}).amount)); if (!TOPUPS.includes(cents)) return res.redirect('/yours?tab=settings#pocket');
    if (!stripe) return res.redirect('/yours?tab=settings&pocket=off#pocket');
    let b = buyerOf(req);
    if (!b) { const id = db.prepare("INSERT INTO buyers (customer, email) VALUES ('', NULL)").run().lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); }
    const id = db.prepare("INSERT INTO pocket (buyer_id, cents, kind, status) VALUES (?,?,'topup','pending')").run(b.id, cents).lastInsertRowid;
    try {
      const s = await stripe.checkout.sessions.create({ mode: 'payment', ...(b.customer ? { customer: b.customer } : { customer_creation: 'always' }),
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `${money(cents)} in your Watermark pocket`, description: 'For thank-you cards and small things in the house. Spent here; never cashed out.' } } }],
        metadata: { pocket: String(id) }, payment_intent_data: { metadata: { pocket: String(id) } },
        success_url: `${C.base}/pocket/thanks?id=${id}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${C.base}/yours?tab=settings#pocket` });
      db.prepare('UPDATE pocket SET stripe_session=? WHERE id=?').run(s.id, id);
      res.redirect(303, s.url);
    } catch (e) { console.error('[pocket]', e.message); db.prepare("DELETE FROM pocket WHERE id=? AND status='pending'").run(id); res.redirect('/yours?tab=settings&pocket=unavailable#pocket'); }
  });
  function settle(id, s) {
    const row = db.prepare('SELECT * FROM pocket WHERE id=?').get(Number(id)); if (!row || row.status !== 'pending' || row.stripe_session !== s.id) return;
    if (s.payment_status !== 'paid') return;
    db.prepare("UPDATE pocket SET status='posted', cents=? WHERE id=?").run(s.amount_total || row.cents, row.id);
    if (s.customer) db.prepare("UPDATE buyers SET customer=COALESCE(NULLIF(customer,''), ?), email=COALESCE(email, ?) WHERE id=?").run(s.customer, (s.customer_details || {}).email || null, row.buyer_id);
    ledger.append(db, 'pocket.filled', `buyer-${row.buyer_id}`, { amount: s.amount_total || row.cents });
  }
  app.get('/pocket/thanks', async (req, res) => {
    const row = db.prepare('SELECT * FROM pocket WHERE id=?').get(Number(req.query.id));
    if (row && row.status === 'pending' && stripe && row.stripe_session === req.query.session_id) { try { settle(row.id, await stripe.checkout.sessions.retrieve(row.stripe_session)); } catch (e) { /* webhook */ } }
    res.redirect('/yours?tab=settings&pocket=filled#pocket');
  });
  app.locals.pocketEvent = event => { if (event.type === 'checkout.session.completed') { const s = event.data.object; if (s.metadata && s.metadata.pocket) settle(s.metadata.pocket, s); } };
  app.locals.pocket = { balance, spend, history, TOPUPS, settle };
  return app.locals.pocket;
}

// The pocket on Yours → Settings.
function pocketBlock({ balance, history, state, on }) {
  const notice = { filled: 'Filled. Thank-you cards now go out with one tap.', off: 'The till is closed for the moment.', unavailable: 'The payment could not be started. Try again in a moment.' }[state];
  return `<section class="pocket" id="pocket"><header class="gh"><h2>Your pocket</h2><span>${money(balance)}</span></header>
<p class="lede pk-lede">Small money for small things: ninety-nine-cent thank-you cards to the people who made what you love, sent with one tap, no checkout each time. Put a little in; it is spent here and only here.</p>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<form method="post" action="/pocket/add" class="pk-add">${TOPUPS.map(c => `<button name="amount" value="${c}" ${on ? '' : 'disabled'}>Add ${money(c)}</button>`).join('')}</form>
${history.length ? `<ul class="pk-hist">${history.map(h => `<li><span>${esc(h.at.slice(0, 10))}</span><span>${h.kind === 'topup' ? 'Put in' : h.kind === 'thanks' ? `Thank you${h.note ? `: ${esc(h.note)}` : ''}` : esc(h.kind)}</span><b class="${h.cents < 0 ? 'out' : 'in'}">${h.cents < 0 ? '−' : '+'}${money(Math.abs(h.cents))}</b></li>`).join('')}</ul>` : ''}
<p class="note">What is in the pocket is the house's debt to you, spent in the house; it is never cashed out. The makers are paid what their cards add up to, with the rest of their earnings.</p></section>`;
}

module.exports = { mountPocket, pocketBlock, TOPUPS };
