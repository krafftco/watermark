// The franchise (Will, 25 Oct, after Franklin: he set up printers in other towns with a press and type, took a
// share of the profits for six years, and then the shop was theirs; "allow other printing-press studios to make
// their own pages, and we get a cut of all of it"; "they just pay us a fee"). The house's own house, which museums
// take by letter (/enterprise, tenants.js), opened to any maker at a fee by the month: their address, their name
// on the door, their work alone on the walls, their Gazette as the front page, their shop, their almanack, their
// rooms; 'Made with Watermark' in the footer and nothing else of ours. The press stays the house's: the house's
// share on every sale as published, and the fee. Nothing is held hostage: end it and the page is still theirs on
// the house's address, with every record.
function mountFranchise(app, { db, V, C, ledger, stripe, makerOf, mail }) {
  const { esc, money, layout } = V; const FEE = require('./fee');
  const base = C.base; const CENTS = () => Math.max(100, +process.env.FRANCHISE_CENTS || 2500); // a draft for Will
  db.exec(`CREATE TABLE IF NOT EXISTS franchises (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', stripe_session TEXT, stripe_sub TEXT, started_at TEXT, ended_at TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const byId = id => db.prepare('SELECT * FROM franchises WHERE id=?').get(Number(id));
  const ofMaker = m => (m ? db.prepare("SELECT * FROM franchises WHERE maker_id=? AND status IN ('active','ending') ORDER BY id DESC LIMIT 1").get(m.id) : null);
  const active = m => !!ofMaker(m);
  function activate(id, sess) {
    const f = byId(id); if (!f || f.status !== 'pending' || (sess.id && f.stripe_session && f.stripe_session !== sess.id)) return f;
    if (sess.status !== 'complete' && sess.payment_status !== 'paid') return f;
    db.prepare("UPDATE franchises SET status='active', stripe_sub=?, started_at=datetime('now') WHERE id=?").run(sess.subscription || null, id);
    db.prepare("UPDATE franchises SET status='ended', ended_at=datetime('now') WHERE maker_id=? AND id<>? AND status IN ('active','ending')").run(f.maker_id, id);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(f.maker_id);
    try { ledger.append(db, 'franchise.begun', m ? m.handle : `maker-${f.maker_id}`, { amount: f.cents, hidden: true }); } catch (e) { /* */ }
    if (m && m.email && mail) { try { mail.send({ to: m.email, subject: 'Your own house', text: `${String(m.name).split(' ')[0]},\n\nYour house is open. Set its address at ${base}/account/house, point a CNAME there, and write to us for the certificate; until then your page on the house is the front door as before.\n\nThe press stays ours; the paper is yours.\n\nWatermark` }); } catch (e) { /* */ } }
    return byId(id);
  }
  function end(f, how) {
    if (!f || f.status === 'ended') return;
    db.prepare("UPDATE franchises SET status='ended', ended_at=datetime('now') WHERE id=?").run(f.id);
    // The house's address closes; the page on the house's own address stays, with every record.
    db.prepare("UPDATE makers SET white_on=0 WHERE id=? AND kind<>'institution'").run(f.maker_id);
    if (app.locals.tenants) app.locals.tenants.refresh();
    const m = db.prepare('SELECT handle FROM makers WHERE id=?').get(f.maker_id);
    try { ledger.append(db, 'franchise.ended', m ? m.handle : `maker-${f.maker_id}`, { how, hidden: true }); } catch (e) { /* */ }
  }
  app.locals.franchiseEvent = event => {
    const o = event.data.object;
    if (event.type === 'checkout.session.completed' && o.metadata && o.metadata.franchise) activate(Number(o.metadata.franchise), o);
    if (event.type === 'customer.subscription.deleted' && o.metadata && o.metadata.franchise) end(byId(o.metadata.franchise), 'stripe');
  };
  // The offer, on the maker's desk.
  app.get('/account/house/franchise', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); const f = ofMaker(m); const cents = CENTS();
    res.set('Cache-Control', 'private, no-store');
    res.send(layout({ title: 'Your own house · Your studio', studio: true, body: `<section class="studio-wrap wh fch"><p class="k">The printing house</p><h1>Your own house.</h1>
<p class="lede">The whole house under your name, at your address: your Gazette as the front page, your work alone on the walls, your books, your records, your almanack, your shop, your rooms; <i>Made with Watermark</i> in the footer and nothing else of ours. The old presses in other towns took a share for six years and then were the printer’s own. Ours is simpler: the page is yours from the first day, the press stays the house’s.</p>
${req.query.ok === 'unavailable' ? '<p class="note">Payments are not open yet; write to the house.</p>' : req.query.ok === 'ending' ? '<p class="note">Your house closes with the month paid. Your page on the house’s address stays, with every record.</p>' : req.query.ok === 'open' ? '<p class="ok">Your house is open. Set its address below.</p>' : ''}
${f ? `<div class="fch-on"><p><b>Your house is ${f.status === 'ending' ? 'closing with this month' : 'open'}.</b> ${money(f.cents)} a month${f.started_at ? `, since ${V.date(f.started_at)}` : ''}.</p><p><a class="buy-btn" href="/account/house">Set the address</a></p>${f.status === 'active' ? `<form method="post" action="/account/house/franchise/end"><button class="link">Close the house</button> <small>The month paid runs out; your page on the house stays.</small></form>` : ''}</div>`
  : `<form method="post" action="/account/house/franchise/begin" class="fch-f"><button class="buy-btn">Open my house · ${money(cents)} a month</button><small>By the month through Stripe; end any time. ${FEE.on() ? 'The price of every sale stays yours; the house’s share is paid by the collector on top, as published' : `${FEE.yours(m.share_pct, 'yours').replace(/^the/, 'The')}`} (<a href="/share">the schedule</a>). The fee is the press and the paper: the address, the certificate, the walls, the rooms, the register, the backups.</small></form>`}
<h2>What is yours</h2><ul class="fch-list"><li>Your address and your name on the door; our name only in the footer’s last line.</li><li>Every page of the house, scoped to you: the front door is your Gazette; Wander, the collection and the Keys show your work; your balcony for your visitors.</li><li>Your shop: prints, books, writing, records, the almanack, patronage, paid every Friday.</li><li>Every record, deed and licence, signed on the register; export all of it at any time.</li></ul>
<h2>What stays the house’s</h2><ul class="fch-list"><li>The press: the vault, the walls, the reading room, the print room, the conservation room, the backups.</li><li>The standard: what hangs is still chosen; the house’s share on sales as published.</li><li>Verification: every work’s deed and number answer at the house as well as at your address.</li></ul>
<p class="ky-foot"><a href="/account">Your studio</a> · <a href="/press">The printing house</a> · <a href="/enterprise">For museums</a></p></section>` }));
  });
  app.post('/account/house/franchise/begin', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); if (ofMaker(m)) return res.redirect('/account/house/franchise');
    const cents = CENTS(); const id = db.prepare('INSERT INTO franchises (maker_id, cents) VALUES (?,?)').run(m.id, cents).lastInsertRowid;
    if (!stripe) return res.redirect('/account/house/franchise?ok=unavailable');
    try {
      const sess = await stripe.checkout.sessions.create({ mode: 'subscription', customer_email: m.email || undefined,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, recurring: { interval: 'month' }, product_data: { name: 'Your own house, Watermark', description: 'The house under your name, at your address. Made with Watermark.' } } }],
        metadata: { franchise: String(id) }, subscription_data: { metadata: { franchise: String(id) } },
        success_url: `${base}/account/house/franchise/${id}/thanks?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/account/house/franchise` });
      db.prepare('UPDATE franchises SET stripe_session=? WHERE id=?').run(sess.id, id);
      res.redirect(303, sess.url);
    } catch (e) { console.error('[franchise]', e.message); db.prepare("DELETE FROM franchises WHERE id=? AND status='pending'").run(id); res.redirect('/account/house/franchise?ok=unavailable'); }
  });
  app.get('/account/house/franchise/:id/thanks', async (req, res) => {
    const m = makerOf(req); let f = byId(req.params.id); if (!m || !f || f.maker_id !== m.id) return res.sendStatus(404);
    if (f.status === 'pending' && stripe && req.query.session_id) { try { const sess = await stripe.checkout.sessions.retrieve(String(req.query.session_id)); f = activate(f.id, sess) || f; } catch (e) { /* the webhook will */ } }
    res.redirect('/account/house/franchise?ok=open');
  });
  app.post('/account/house/franchise/end', async (req, res) => {
    const m = makerOf(req); const f = ofMaker(m); if (!f) return res.redirect('/account/house/franchise');
    try { if (stripe && f.stripe_sub) await stripe.subscriptions.update(f.stripe_sub, { cancel_at_period_end: true }); } catch (e) { /* recorded anyway */ }
    db.prepare("UPDATE franchises SET status='ending' WHERE id=?").run(f.id);
    res.redirect('/account/house/franchise?ok=ending');
  });
  app.locals.franchise = { active, ofMaker, activate, end, byId, CENTS };
  return app.locals.franchise;
}
module.exports = { mountFranchise };
