// Getting paid. What a maker is owed: their share of every license sold (85%), every thank-you card and tip
// sent to them, every royalty from a resale; less what has been paid out. The statement is always exact and
// always theirs to see. Paying it: the maker adds a bank through Stripe (Connect Express; the house never
// sees the account), and once PAYOUTS=stripe is set in the host's settings, what is owed is transferred on
// the first of the month and whenever the maker asks, from the house's balance. Until then it is paid by
// hand from the same statement, and the page says so.
const { layout, esc, money, date, setDeskPath } = require('./views');

function mountPayouts(app, { db, C, stripe, makerOf, isStudio, ledger, mail }) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('makers') WHERE name='stripe_account'").get()) db.exec('ALTER TABLE makers ADD COLUMN stripe_account TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS maker_payouts (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'paid', how TEXT NOT NULL DEFAULT 'stripe',
    stripe_transfer TEXT, note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const ON = () => !!stripe && process.env.PAYOUTS === 'stripe';
  const q = {
    licensed: db.prepare("SELECT COALESCE(SUM(l.price_cents),0) s, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0"),
    thanks: db.prepare("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM tips WHERE maker_id=? AND status='paid'"),
    royalties: db.prepare("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM payouts WHERE maker_id=? AND kind='royalty' AND status IN ('owed','paid','house')"),
    paid: db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM maker_payouts WHERE maker_id=? AND status='paid'"),
    rows: db.prepare('SELECT * FROM maker_payouts WHERE maker_id=? ORDER BY id DESC LIMIT 60'),
  };
  // The statement: gross by kind, the maker's share, what has gone out, what is owed.
  function statement(m) {
    const pct = m.share_pct || 85;
    const L = q.licensed.get(m.id), T = q.thanks.get(m.id), R = q.royalties.get(m.id), P = q.paid.get(m.id).s;
    const share = Math.round(L.s * pct / 100);
    const earned = share + T.s + R.s;
    return { pct, licensed: L, share, thanks: T, royalties: R, earned, paid: P, owed: Math.max(0, earned - P), rows: q.rows.all(m.id) };
  }
  // Pay what is owed, when the maker can be paid and the house is set to pay.
  async function pay(m, { by = 'house' } = {}) {
    const st = statement(m);
    if (!ON() || !m.stripe_account || st.owed < 100) return { ok: false, why: !ON() ? 'off' : !m.stripe_account ? 'nobank' : 'small', owed: st.owed };
    try {
      const a = await stripe.accounts.retrieve(m.stripe_account); if (!a.payouts_enabled) return { ok: false, why: 'notready', owed: st.owed };
      const tr = await stripe.transfers.create({ amount: st.owed, currency: 'usd', destination: m.stripe_account, metadata: { maker: m.handle, by } });
      const id = db.prepare("INSERT INTO maker_payouts (maker_id, amount_cents, status, how, stripe_transfer) VALUES (?,?,'paid','stripe',?)").run(m.id, st.owed, tr.id).lastInsertRowid;
      ledger.append(db, 'maker.paid', m.handle, { amount: st.owed, transfer: tr.id, by });
      if (m.email) mail.send({ to: m.email, subject: `${money(st.owed)} on its way to you`, text: `${m.name.split(' ')[0]},\n\nYour Watermark earnings to date, ${money(st.owed)}, have been sent to your bank through Stripe. The statement is at ${C.base}/account/payouts.\n\nWatermark` });
      return { ok: true, amount: st.owed, id };
    } catch (e) { console.error('[payouts]', m.handle, e.message); return { ok: false, why: 'failed', owed: st.owed }; }
  }
  // Paid by hand (the Studio records it): the statement stays exact either way.
  function record(m, cents, note) {
    db.prepare("INSERT INTO maker_payouts (maker_id, amount_cents, status, how, note) VALUES (?,?,'paid','hand',?)").run(m.id, cents, note || null);
    ledger.append(db, 'maker.paid', m.handle, { amount: cents, by: 'hand' });
  }

  app.get('/account/payouts', async (req, res) => {
    const m = makerOf(req) || (req.query.maker && isStudio(req) ? db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.query.maker)) : null); if (!m) return res.redirect('/signin?next=/account/payouts');
    let ready = false; if (m.stripe_account && stripe) { try { const a = await stripe.accounts.retrieve(m.stripe_account); ready = !!a.payouts_enabled; } catch (e) { /* not ready */ } }
    res.send(payoutsPage({ m, st: statement(m), ready, on: ON(), ok: req.query.ok || null, viewing: !makerOf(req) }));
  });
  app.post('/account/payouts/connect', async (req, res) => {
    const m = makerOf(req); if (!m || !stripe) return res.redirect('/account/payouts?ok=off');
    try {
      let acct = m.stripe_account;
      if (!acct) { const a = await stripe.accounts.create({ type: 'express', email: m.email || undefined, capabilities: { transfers: { requested: true } }, business_profile: { name: m.name, product_description: 'Photographs licensed through Watermark' }, metadata: { maker: m.handle } }); acct = a.id; db.prepare('UPDATE makers SET stripe_account=? WHERE id=?').run(acct, m.id); }
      const link = await stripe.accountLinks.create({ account: acct, type: 'account_onboarding', refresh_url: `${C.base}/account/payouts`, return_url: `${C.base}/account/payouts?ok=bank` });
      res.redirect(303, link.url);
    } catch (e) { console.error('[connect]', e.message); res.redirect('/account/payouts?ok=err'); }
  });
  // Keep the money in the house: what is owed goes into the maker's pocket instead of to a bank, to collect
  // other makers' work, take Library copies, send cards. Recorded as paid, how 'pocket'.
  app.post('/account/payouts/pocket', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const st = statement(m); if (st.owed < 100) return res.redirect('/account/payouts?ok=small');
    const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null; if (!b || !app.locals.pocket) return res.redirect('/account/payouts?ok=err');
    db.prepare("INSERT INTO pocket (buyer_id, cents, kind, note) VALUES (?,?,'earnings',?)").run(b.id, st.owed, 'Your earnings, kept in the house');
    db.prepare("INSERT INTO maker_payouts (maker_id, amount_cents, status, how, note) VALUES (?,?,'paid','pocket','Into your pocket')").run(m.id, st.owed);
    ledger.append(db, 'maker.paid', m.handle, { amount: st.owed, by: 'pocket' });
    res.redirect(`/account/payouts?ok=pocket&n=${st.owed}`);
  });
  app.post('/account/payouts/pay', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const r = await pay(m, { by: 'maker' });
    res.redirect(`/account/payouts?ok=${r.ok ? 'paid' : r.why}`);
  });
  // The Studio records a payment made by hand.
  app.post('/studio/payouts/:handle', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(401);
    const m = db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.params.handle)); if (!m) return res.sendStatus(404);
    const cents = Math.round(Number((req.body || {}).amount) * 100); if (!(cents > 0)) return res.redirect('/studio/accounts');
    record(m, cents, String((req.body || {}).note || '').slice(0, 200));
    res.redirect(`/studio/accounts?ok=${encodeURIComponent(`${money(cents)} recorded as paid to ${m.name}.`)}`);
  });
  // The first of the month, and when a bank is added.
  const prev = app.locals.patronEvent;
  app.locals.patronEvent = event => { if (prev) prev(event); if (event.type === 'account.updated' && event.data.object.payouts_enabled) { const m = db.prepare('SELECT * FROM makers WHERE stripe_account=?').get(event.data.object.id); if (m) pay(m, { by: 'bank' }).catch(() => {}); } };
  async function monthly() { if (!ON()) return; if (new Date().getUTCDate() !== 1) return; for (const m of db.prepare('SELECT * FROM makers WHERE stripe_account IS NOT NULL').all()) await pay(m, { by: 'month' }); }
  if (process.env.NODE_ENV !== 'test') setInterval(() => monthly().catch(() => {}), 6 * 60 * 60 * 1000).unref();
  app.locals.payouts = { statement, pay, record, ON };
  return app.locals.payouts;
}

function payoutsPage({ m, st, ready, on, ok, viewing = false }) {
  setDeskPath('/account/payouts');
  const first = m.name.split(' ')[0];
  const notice = { pocket: 'Into your pocket. Spend it in the house: collect the artists you admire, take a volume from the Library, send a card.', bank: 'Your bank is with Stripe. Payouts go out on the first of the month, and whenever you ask.', paid: 'Sent. It is on its way to your bank.', off: 'Payouts through Stripe are not switched on for the house yet; what you are owed is paid by hand each month, from this statement.', nobank: 'Add your bank first.', small: 'Under a dollar is carried to next month.', notready: 'Stripe has not finished with your bank details yet.', failed: 'The transfer could not be made; the house has been told.', err: 'Stripe could not be reached. Try again in a moment.' }[ok];
  const row = (k, v, small) => `<div><dt>${k}</dt><dd>${v}${small ? `<small>${small}</small>` : ''}</dd></div>`;
  return layout({ title: 'Getting paid · Watermark', studio: true, body: `<section class="studio-wrap hd gp">${viewing ? `<p class="ac-viewing">You are the Studio, looking at ${esc(m.name)}'s statement. <a href="/studio/accounts">Back to Accounts</a></p>` : ''}<p class="k">${viewing ? esc(m.name) : 'Your studio'}</p><h1>Getting paid.</h1>
<p class="lede">Every dollar that reaches you, and where it came from. ${st.pct}% of every license is yours; every thank-you card and tip is yours whole; every resale pays you a royalty. The house keeps the rest and pays for everything with it.</p>
${notice ? `<p class="${/paid|bank/.test(ok) ? 'ok' : 'note'}">${esc(notice)}</p>` : ''}
<div class="gp-cols"><div class="gp-main">
<div class="gp-big"><span>Owed to you now</span><b>${money(st.owed)}</b></div>
<dl class="facts gp-st">
${row('Licensed', money(st.licensed.s), `${st.licensed.n} sale${st.licensed.n === 1 ? '' : 's'}; your ${st.pct}% is ${money(st.share)}`)}
${row('Thank-you cards and tips', money(st.thanks.s), `${st.thanks.n}, yours whole`)}
${row('Royalties', money(st.royalties.s), `${st.royalties.n} resale${st.royalties.n === 1 ? '' : 's'}`)}
${row('Earned, all time', money(st.earned))}
${row('Paid out', money(st.paid))}
</dl>
${st.rows.length ? `<h2>Payments to you</h2><table class="tbl"><thead><tr><th>Date</th><th>Amount</th><th>How</th><th>Note</th></tr></thead><tbody>${st.rows.map(r => `<tr><td>${date(r.at)}</td><td>${money(r.amount_cents)}</td><td>${r.how === 'stripe' ? 'To your bank' : 'By hand'}</td><td>${esc(r.note || r.stripe_transfer || '')}</td></tr>`).join('')}</tbody></table>` : ''}
<p class="note gp-foot">${first}, this statement is yours to keep and to show an accountant: every line on it is on the register. <a href="/account/keeping">Keeping: what the archive holds, and the tiers.</a></p>
</div><aside class="gp-side">
<section class="gp-door"><p class="k">Keep it in the house</p><h2>Into your pocket.</h2><p>Every maker is a collector. Put what you are owed in your pocket and spend it here: on other makers' work, on the Library, on thank-you cards. Rembrandt collected; so can you.</p><form method="post" action="/account/payouts/pocket"><button class="jewel gp-pay" ${st.owed < 100 ? 'disabled' : ''}>Put ${money(st.owed)} in my pocket</button></form></section>
<section class="gp-door"><p class="k">Your bank</p><h2>${ready ? 'Connected.' : 'Out, to your bank.'}</h2>${ready ? `<p>Your bank is with Stripe; the house never sees it. ${on ? 'Payouts go on the first of the month, or now.' : 'Payouts through Stripe open soon; until then the house pays by hand from this statement.'}</p>${on ? `<form method="post" action="/account/payouts/pay"><button class="jewel gp-pay" ${st.owed < 100 ? 'disabled' : ''}>Send ${money(st.owed)} to my bank</button></form>` : ''}`
  : `<p>Add your bank through Stripe, a few minutes; the house never sees your details. ${on ? 'From then on what you are owed goes out on the first of the month, or whenever you ask.' : 'Until payouts through Stripe are switched on, the house pays by hand each month from this statement.'}</p><form method="post" action="/account/payouts/connect"><button class="jewel gp-pay">${m.stripe_account ? 'Finish adding your bank' : 'Add your bank, through Stripe'}</button></form>`}</section>
</aside></div>
</section>` });
}

module.exports = { mountPayouts, payoutsPage };
