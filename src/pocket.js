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
  // One tap from the pocket is a choice (Will, 23 Oct: with credit in his account every Collect skipped Apple Pay, so the
  // demo never showed the pay sheet). `buyers.pocket_tap` 1 (default) spends the pocket first; 0 pays by card or wallet
  // every time and the pocket keeps its balance. `tap(b)` is the balance a one-tap may use: the balance, or nothing.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('buyers') WHERE name='pocket_tap'").get()) db.exec('ALTER TABLE buyers ADD COLUMN pocket_tap INTEGER NOT NULL DEFAULT 1');
  const tapOn = b => !!b && (b.pocket_tap == null || Number(b.pocket_tap) === 1);
  const tap = b => (tapOn(b) ? balance(b) : 0);
  app.post('/pocket/tap', (req, res) => { const b = buyerOf(req); if (b) db.prepare('UPDATE buyers SET pocket_tap=? WHERE id=?').run(req.body && req.body.on === '1' ? 1 : 0, b.id); res.redirect((req.body && req.body.back) || '/yours?tab=settings#pocket'); });
  const history = b => (b ? db.prepare("SELECT * FROM pocket WHERE buyer_id=? AND status='posted' ORDER BY id DESC LIMIT 40").all(b.id) : []);
  // Spend: returns true when the pocket covered it.
  function spend(b, cents, kind, ref, note) {
    if (!b || !(cents > 0) || !tapOn(b) || balance(b) < cents) return false;
    db.prepare('INSERT INTO pocket (buyer_id, cents, kind, ref, note) VALUES (?,?,?,?,?)').run(b.id, -cents, kind, ref || null, note || null);
    return true;
  }
  // Credit: money earned in the house (a curator's share, a card received, earnings kept here), posted at once.
  function credit(b, cents, kind, ref, note) { if (!b || !(cents > 0)) return false; db.prepare('INSERT INTO pocket (buyer_id, cents, kind, ref, note) VALUES (?,?,?,?,?)').run(b.id, cents, kind, ref || null, note || null); return true; }
  // What was earned here (not put in) may be cashed out: earned, less what has already gone out, never more than the balance.
  const EARNED = ['curation', 'thanks_in', 'earnings', 'resale', 'hosting'];
  const earned = b => (b ? db.prepare(`SELECT COALESCE(SUM(cents),0) s FROM pocket WHERE buyer_id=? AND status='posted' AND kind IN (${EARNED.map(() => '?').join(',')})`).get(b.id, ...EARNED).s : 0);
  const cashable = b => (b ? Math.max(0, Math.min(balance(b), earned(b) + db.prepare("SELECT COALESCE(SUM(cents),0) s FROM pocket WHERE buyer_id=? AND status IN ('posted','pending') AND kind='cashout'").get(b.id).s)) : 0);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('buyers') WHERE name='stripe_account'").get()) db.exec('ALTER TABLE buyers ADD COLUMN stripe_account TEXT');
  const PAY_ON = () => !!stripe && process.env.PAYOUTS === 'stripe';
  // The bank: Stripe Connect Express, the same door the makers use.
  app.post('/pocket/connect', async (req, res) => {
    const b = buyerOf(req); if (!b || !stripe) return res.redirect('/yours?tab=settings&pocket=off#pocket');
    try {
      let acct = b.stripe_account;
      if (!acct) { const a = await stripe.accounts.create({ type: 'express', email: b.email || undefined, capabilities: { transfers: { requested: true } }, business_profile: { name: b.name || undefined, product_description: 'Curation and cards on Watermark' } }); acct = a.id; db.prepare('UPDATE buyers SET stripe_account=? WHERE id=?').run(acct, b.id); }
      const link = await stripe.accountLinks.create({ account: acct, type: 'account_onboarding', refresh_url: `${C.base}/yours?tab=settings#pocket`, return_url: `${C.base}/yours?tab=settings&pocket=bank#pocket` });
      res.redirect(303, link.url);
    } catch (e) { console.error('[pocket connect]', e.message); res.redirect('/yours?tab=settings&pocket=unavailable#pocket'); }
  });
  // Cash out what was earned: transferred when payouts are on and the bank is there; otherwise recorded and paid by hand.
  app.post('/pocket/cashout', async (req, res) => {
    const b = buyerOf(req); if (!b) return res.redirect('/yours');
    const cents = cashable(b); if (cents < 100) return res.redirect('/yours?tab=settings&pocket=small#pocket');
    const id = db.prepare("INSERT INTO pocket (buyer_id, cents, kind, status, note) VALUES (?,?,'cashout','pending','Cashed out')").run(b.id, -cents).lastInsertRowid;
    if (PAY_ON() && b.stripe_account) {
      try { const t = await stripe.transfers.create({ amount: cents, currency: 'usd', destination: b.stripe_account, description: 'Watermark: cashed out', metadata: { pocket: String(id) } }); db.prepare("UPDATE pocket SET status='posted', ref=? WHERE id=?").run(t.id, id); ledger.append(db, 'pocket.cashed', `buyer-${b.id}`, { amount: cents, how: 'stripe' }); return res.redirect('/yours?tab=settings&pocket=cashed#pocket'); }
      catch (e) { console.error('[cashout]', e.message); }
    }
    db.prepare("UPDATE pocket SET status='posted' WHERE id=?").run(id);                      // the balance drops now; the house pays by hand
    ledger.append(db, 'pocket.cashed', `buyer-${b.id}`, { amount: cents, how: 'hand' });
    try { require('./mail').send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `Cash out: ${money(cents)} to buyer ${b.id}`, text: `${b.name || 'A collector'} <${b.email || 'no email'}> asked to cash out ${money(cents)} from their pocket.${b.stripe_account ? ` Connect account ${b.stripe_account}.` : ' No bank on file yet.'}` }); } catch (e) { /* mail off */ }
    res.redirect('/yours?tab=settings&pocket=cashed#pocket');
  });
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
  app.locals.pocket = { balance, tap, tapOn, spend, credit, earned, cashable, history, TOPUPS, settle };
  return app.locals.pocket;
}

// The pocket on Yours → Settings.
function pocketBlock({ balance, history, state, on, cashable = 0, bank = false, tap = true }) {
  const notice = { filled: 'Filled. Thank-you cards now go out with one tap.', off: 'The till is closed for the moment.', unavailable: 'The payment could not be started. Try again in a moment.', cashed: 'Cashed out. It is on its way to your bank, or the house will send it by hand.', bank: 'Your bank is connected.', small: 'A dollar at least to cash out.' }[state];
  return `<section class="pocket" id="pocket"><header class="gh"><h2>Your pocket</h2><span>${money(balance)}</span></header>
<p class="lede pk-lede">Small money for small things: ninety-nine-cent thank-you cards to the people who made what you love, sent with one tap, no checkout each time. Put a little in; it is spent here and only here.</p>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<form method="post" action="/pocket/tap" class="pk-tap"><input type="hidden" name="on" value="${tap ? '0' : '1'}"><label><input type="checkbox" onchange="this.form.on.value=this.checked?'1':'0';this.form.requestSubmit()" ${tap ? 'checked' : ''}> One tap from the pocket when it covers a Collect or a card</label><small>${tap ? 'On. Turn it off to pay by card or Apple Pay every time; the pocket keeps its balance.' : 'Off: every Collect and card goes through the pay sheet. The pocket keeps its balance.'}</small></form>
<form method="post" action="/pocket/add" class="pk-add">${TOPUPS.map(c => `<button name="amount" value="${c}" ${on ? '' : 'disabled'}>Add ${money(c)}</button>`).join('')}</form>
${history.length ? `<ul class="pk-hist">${history.map(h => `<li><span>${esc(h.at.slice(0, 10))}</span><span>${h.kind === 'topup' ? 'Put in' : h.kind === 'earnings' ? 'Your earnings, kept in the house' : h.kind === 'thanks' ? `Thank you${h.note ? `: ${esc(h.note)}` : ''}` : h.kind === 'collect' ? `Collected${h.note ? `: ${esc(h.note)}` : ''}` : h.kind === 'curation' ? `Your eye: ${esc(h.note || '')}` : h.kind === 'thanks_in' ? esc(h.note || 'A card for you') : h.kind === 'cashout' ? 'Cashed out' : esc(h.kind)}</span><b class="${h.cents < 0 ? 'out' : 'in'}">${h.cents < 0 ? '−' : '+'}${money(Math.abs(h.cents))}</b></li>`).join('')}</ul>` : ''}
${cashable >= 100 ? `<div class="pk-out"><p><b>${money(cashable)}</b> of this you earned here: a curator's share, cards received. Spend it in the house, or take it out.</p><form method="post" action="/pocket/cashout"><button class="link">Cash out ${money(cashable)}</button></form>${bank ? '' : `<form method="post" action="/pocket/connect"><button class="link">Add your bank</button></form>`}</div>` : ''}
<p class="note">What you put in is spent in the house. What you earn in the house (collecting through your hangs and galleries, the cards people send you) can be spent here or cashed out. The makers are paid what their cards add up to, with the rest of their earnings.</p></section>`;
}

module.exports = { mountPocket, pocketBlock, TOPUPS };
