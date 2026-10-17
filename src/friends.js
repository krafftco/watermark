// Friends of the house. Watermark is an archive as much as a market: the Krafft Collection is its first
// collection, and like the Frick or the Met it is kept by its friends. Anyone may become a Friend of
// Watermark or of Krafft, monthly or once, at any amount; their name goes on the wall. The same rails
// carry Keeping: what a maker pays for the archive to hold, serve and protect a large body of work.
// All amounts are drafts until Will confirms them. Money lands in the house's Stripe.
const LEVELS = [
  { key: 'friend', name: 'Friend', cents: 1000, gives: 'Your name on the wall of friends, and the friend’s mark on your gallery.' },
  { key: 'patron', name: 'Patron', cents: 5000, gives: 'All of that, and first sight of every new series before it opens.' },
  { key: 'benefactor', name: 'Benefactor', cents: 25000, gives: 'All of that, a signed print from the Krafft Collection each year, and a seat at the table when the collection acquires.' },
];
const ONCE = [2500, 10000, 50000];
const HOUSES = { watermark: 'Watermark', krafft: 'Krafft' };
// Keeping: the archive holds a maker's work for free up to a point; beyond it, a monthly fee (drafts).
const KEEPING = { freeGB: 5, freeWorks: 200, cents: 1500, name: 'Keeping', gives: 'Up to 1 TB held in the vault, served, fingerprinted and protected; masters and derivatives; the register.' };

function mountFriends(app, { db, C, stripe, buyerOf, setBuyer, makerOf, ledger, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS friends (id INTEGER PRIMARY KEY, house TEXT NOT NULL, buyer_id INTEGER, maker_id INTEGER, kind TEXT NOT NULL DEFAULT 'friend', level TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    recurring INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', name TEXT, email TEXT, note TEXT, stripe_session TEXT, stripe_sub TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), started_at TEXT, ended_at TEXT)`);
  const wall = house => db.prepare("SELECT name, level, recurring, amount_cents, started_at FROM friends WHERE house=? AND kind='friend' AND status IN ('active','given') AND name IS NOT NULL ORDER BY CASE level WHEN 'benefactor' THEN 0 WHEN 'patron' THEN 1 WHEN 'friend' THEN 2 ELSE 3 END, started_at").all(house);
  const count = house => db.prepare("SELECT COUNT(*) n FROM friends WHERE house=? AND kind='friend' AND status IN ('active','given')").get(house).n;
  const mine = (b, house) => (b ? db.prepare("SELECT * FROM friends WHERE house=? AND buyer_id=? AND kind='friend' AND status IN ('active','given') ORDER BY id DESC").all(house, b.id) : []);
  app.locals.friendsOf = b => (b ? db.prepare("SELECT house, level, recurring, started_at FROM friends WHERE buyer_id=? AND kind='friend' AND status='active'").all(b.id) : []);

  app.get('/friends', (req, res) => {
    const b = buyerOf(req);
    res.send(V.friends({ levels: LEVELS, once: ONCE, houses: HOUSES, open: !!stripe, walls: { watermark: wall('watermark'), krafft: wall('krafft') }, counts: { watermark: count('watermark'), krafft: count('krafft') }, mine: { watermark: mine(b, 'watermark'), krafft: mine(b, 'krafft') }, unavailable: req.query.unavailable }));
  });
  app.post('/friends', async (req, res) => {
    const x = req.body || {}; const house = HOUSES[x.house] ? x.house : 'watermark';
    if (!stripe) return res.redirect('/friends?unavailable=1');
    const lv = LEVELS.find(l => l.key === x.level);
    const onceCents = !lv ? Math.round(Number(String(x.once || x.amount || '').replace(/[^0-9.]/g, ''))) * 100 : 0;
    if (!lv && !(onceCents >= 500 && onceCents <= 5000000)) return res.redirect('/friends#give');
    const amount = lv ? lv.cents : onceCents, b = buyerOf(req);
    const id = db.prepare('INSERT INTO friends (house, buyer_id, level, amount_cents, recurring, note) VALUES (?,?,?,?,?,?)').run(house, b ? b.id : null, lv ? lv.key : 'once', amount, lv ? 1 : 0, String(x.note || '').trim().slice(0, 280) || null).lastInsertRowid;
    const name = lv ? `${lv.name} of ${HOUSES[house]}` : `A gift to ${HOUSES[house]}`;
    try {
      const s = await stripe.checkout.sessions.create({
        mode: lv ? 'subscription' : 'payment', submit_type: lv ? undefined : 'donate',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, ...(lv ? { recurring: { interval: 'month' } } : {}), product_data: { name, description: lv ? lv.gives : `In support of ${HOUSES[house]} and the collection it keeps.` } } }],
        ...(b && b.customer ? { customer: b.customer } : lv ? {} : { customer_creation: 'always' }),
        metadata: { friend: String(id) }, ...(lv ? { subscription_data: { metadata: { friend: String(id) } } } : { payment_intent_data: { metadata: { friend: String(id) } } }),
        success_url: `${C.base}/friends/${id}/thanks?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${C.base}/friends#give`,
      });
      db.prepare('UPDATE friends SET stripe_session=? WHERE id=?').run(s.id, id);
      res.redirect(303, s.url);
    } catch (e) { console.error('[friends]', e.message); db.prepare("DELETE FROM friends WHERE id=? AND status='pending'").run(id); res.redirect('/friends?unavailable=1'); }
  });

  // Keeping: a maker pays for the archive to hold a large body of work. Free up to the line; a notice, not a wall, until Will confirms.
  // Culled work (held privately) weighs a quarter: the archive rewards a maker who grades and culls.
  const usage = m => { const r = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='held' THEN 1 ELSE 0.25 END) wn, SUM(COALESCE(bytes, 0) * CASE WHEN status='held' THEN 1 ELSE 0.25 END) b, SUM(CASE WHEN status='held' THEN 1 ELSE 0 END) pub FROM works WHERE maker_id=?").get(m.id); const gb = (r.b || 0) / 1e9; return { works: r.n, pub: r.pub || 0, weighed: Math.round(r.wn || 0), gb, over: (r.wn || 0) > KEEPING.freeWorks || gb > KEEPING.freeGB }; };
  const keeping = m => db.prepare("SELECT * FROM friends WHERE maker_id=? AND kind='keeping' AND status='active' ORDER BY id DESC").get(m.id) || null;
  app.locals.keepingOf = m => ({ ...usage(m), plan: keeping(m), terms: KEEPING });
  app.get('/account/keeping', (req, res) => { const m = makerOf(req); if (!m) return res.redirect('/account'); res.send(V.keeping({ m, ...usage(m), plan: keeping(m), terms: KEEPING, open: !!stripe, ok: req.query.ok })); });
  app.post('/account/keeping', async (req, res) => {
    const m = makerOf(req); if (!m || !stripe) return res.redirect('/account/keeping?ok=unavailable');
    if (keeping(m)) return res.redirect('/account/keeping');
    const id = db.prepare("INSERT INTO friends (house, maker_id, kind, level, amount_cents, recurring, name, email) VALUES ('watermark',?,'keeping','keeping',?,1,?,?)").run(m.id, KEEPING.cents, m.name, m.email).lastInsertRowid;
    try {
      const s = await stripe.checkout.sessions.create({ mode: 'subscription', ...(m.email ? { customer_email: m.email } : {}),
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: KEEPING.cents, recurring: { interval: 'month' }, product_data: { name: 'Keeping, on Watermark', description: KEEPING.gives } } }],
        metadata: { friend: String(id) }, subscription_data: { metadata: { friend: String(id) } },
        success_url: `${C.base}/friends/${id}/thanks?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${C.base}/account/keeping` });
      db.prepare('UPDATE friends SET stripe_session=? WHERE id=?').run(s.id, id);
      res.redirect(303, s.url);
    } catch (e) { console.error('[keeping]', e.message); db.prepare("DELETE FROM friends WHERE id=? AND status='pending'").run(id); res.redirect('/account/keeping?ok=unavailable'); }
  });
  app.post('/account/keeping/end', async (req, res) => {
    const m = makerOf(req), k = m && keeping(m); if (!k) return res.redirect('/account/keeping');
    try { if (stripe && k.stripe_sub) await stripe.subscriptions.update(k.stripe_sub, { cancel_at_period_end: true }); } catch (e) { /* recorded anyway */ }
    db.prepare("UPDATE friends SET status='ending' WHERE id=?").run(k.id);
    res.redirect('/account/keeping?ok=ending');
  });

  function activate(id, s) {
    const f = db.prepare('SELECT * FROM friends WHERE id=?').get(id); if (!f || f.status !== 'pending' || f.stripe_session !== s.id) return f;
    if (s.status !== 'complete' && s.payment_status !== 'paid') return f;
    const d = s.customer_details || {};
    db.prepare("UPDATE friends SET status=?, stripe_sub=?, email=COALESCE(?, email), name=COALESCE(name, ?), started_at=datetime('now') WHERE id=?").run(f.recurring ? 'active' : 'given', s.subscription || null, d.email || null, d.name || null, id);
    ledger.append(db, f.kind === 'keeping' ? 'keeping.begun' : f.recurring ? 'friend.joined' : 'friend.gave', `friend-${id}`, { house: f.house, level: f.level, amount: f.amount_cents });
    return db.prepare('SELECT * FROM friends WHERE id=?').get(id);
  }
  const prev = app.locals.patronEvent;
  app.locals.patronEvent = event => {
    if (prev) prev(event);
    const o = event.data.object;
    if (event.type === 'checkout.session.completed' && o.metadata && o.metadata.friend) activate(Number(o.metadata.friend), o);
    if (event.type === 'customer.subscription.deleted' && o.metadata && o.metadata.friend) db.prepare("UPDATE friends SET status='ended', ended_at=datetime('now') WHERE id=?").run(Number(o.metadata.friend));
  };
  app.get('/friends/:id/thanks', async (req, res) => {
    let f = db.prepare('SELECT * FROM friends WHERE id=?').get(Number(req.params.id));
    if (!f || !req.query.session_id || f.stripe_session !== req.query.session_id) return res.redirect('/friends');
    if (f.status === 'pending' && stripe) { try { f = activate(f.id, await stripe.checkout.sessions.retrieve(req.query.session_id)); } catch (e) { /* pending */ } }
    if (f.kind === 'keeping') return res.redirect('/account/keeping?ok=begun');
    res.send(V.friendThanks({ f, house: HOUSES[f.house], level: LEVELS.find(l => l.key === f.level) }));
  });
  // The maker may set their own name on the wall after the fact.
  app.post('/friends/:id/name', (req, res) => {
    const b = buyerOf(req), f = db.prepare('SELECT * FROM friends WHERE id=?').get(Number(req.params.id));
    if (!b || !f || f.buyer_id !== b.id) return res.redirect('/friends');
    db.prepare('UPDATE friends SET name=? WHERE id=?').run(String((req.body || {}).name || '').trim().slice(0, 80) || null, f.id);
    res.redirect('/friends#wall');
  });
  return { LEVELS, ONCE, KEEPING, wall };
}

module.exports = { mountFriends, LEVELS, ONCE, KEEPING, HOUSES };
