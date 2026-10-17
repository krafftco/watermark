// Friends of the house. Watermark is an archive as much as a market: the Krafft Collection is its first
// collection, and like the Frick or the Met it is kept by its friends. Anyone may become a Friend of
// Watermark or of Krafft, monthly or once, at any amount; their name goes on the wall. The same rails
// carry Keeping: what a maker pays for the archive to hold, serve and protect a large body of work.
// All amounts are drafts until Will confirms them. Money lands in the house's Stripe.
const LEVELS = [
  { key: 'friend', name: 'Friend', cents: 1000, gives: 'Your name on the wall of friends, and the friend’s mark on your gallery.' },
  { key: 'patron', name: 'Patron', cents: 5000, gives: 'All of that, and first sight of every new series before it opens.' },
  { key: 'benefactor', name: 'Benefactor', cents: 25000, gives: 'All of that, a signed print from the Krafft Collection each year, and a seat at the table when the collection acquires.' },
  // The Medici: a name on something, not a subscription. Monthly or once a year; above this, the house takes letters.
  { key: 'medici', name: 'Medici', cents: 250000, year: 2500000, gives: 'Your name at the head of the wall. First sight of every series, a signed print each year, a seat at every acquisition, and a photograph commissioned in your name.' },
];
// Above the Medici there is no price on the page: a room, a series, an acquisition fund are arranged by letter.
const LETTER = [
  { name: 'Found a room', what: 'A named room in the collection, kept in your name for good, and the acquisitions that fill it.' },
  { name: 'Commission a series', what: 'A photographer sent somewhere, for a season, with the series carrying your name as its patron.' },
  { name: 'Endow an estate', what: 'An acquisition fund that brings a photographer\u2019s estate into the archive, registered and kept.' },
];
const ONCE = [2500, 10000, 50000];
const HOUSES = { watermark: 'Watermark', krafft: 'Krafft' };
// Keeping: the archive holds a maker's work for free up to a point; beyond it, a monthly fee (drafts).
// Keeping: the archive is free to a line, and above it a maker pays by what is held. Storage costs; so the tiers
// are set by gigabytes, with a count of photographs as the plainer measure. Prices are drafts until Will confirms.
const TIERS = [
  { key: 'studio', name: 'The studio', gb: 5, works: 200, cents: 0, gives: 'Free. Every photograph fingerprinted, kept with its master, served at every size, protected by the Shield, on the register.' },
  { key: 'keeping', name: 'Keeping', gb: 100, works: 2000, cents: 1500, gives: 'For a working archive: masters and derivatives, the .wmark archival master for every work, fixity checks on a schedule.' },
  { key: 'archive', name: 'The archive', gb: 500, works: 10000, cents: 4500, gives: 'For a life\'s work or an estate: the whole body held, culled and graded, conserved and registered.' },
  { key: 'vault', name: 'The vault', gb: 2000, works: 50000, cents: 15000, gives: 'For an institution or a collection of masters: two terabytes held at the source. Above it, by letter.' },
];
const tierOf = key => TIERS.find(t => t.key === key) || TIERS[0];
const KEEPING = { freeGB: TIERS[0].gb, freeWorks: TIERS[0].works, cents: TIERS[1].cents, name: 'Keeping', gives: TIERS[1].gives, TIERS };

function mountFriends(app, { db, C, stripe, buyerOf, setBuyer, makerOf, ledger, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS friends (id INTEGER PRIMARY KEY, house TEXT NOT NULL, buyer_id INTEGER, maker_id INTEGER, kind TEXT NOT NULL DEFAULT 'friend', level TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    recurring INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', name TEXT, email TEXT, note TEXT, stripe_session TEXT, stripe_sub TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), started_at TEXT, ended_at TEXT)`);
  const wall = house => db.prepare("SELECT name, level, recurring, amount_cents, started_at FROM friends WHERE house=? AND kind='friend' AND status IN ('active','given') AND name IS NOT NULL ORDER BY CASE level WHEN 'medici' THEN 0 WHEN 'benefactor' THEN 1 WHEN 'patron' THEN 2 WHEN 'friend' THEN 3 ELSE 4 END, started_at").all(house);
  const count = house => db.prepare("SELECT COUNT(*) n FROM friends WHERE house=? AND kind='friend' AND status IN ('active','given')").get(house).n;
  const mine = (b, house) => (b ? db.prepare("SELECT * FROM friends WHERE house=? AND buyer_id=? AND kind='friend' AND status IN ('active','given') ORDER BY id DESC").all(house, b.id) : []);
  app.locals.friendsOf = b => (b ? db.prepare("SELECT house, level, recurring, started_at FROM friends WHERE buyer_id=? AND kind='friend' AND status='active'").all(b.id) : []);

  app.get('/friends', (req, res) => {
    const b = buyerOf(req);
    res.send(V.friends({ levels: LEVELS, letter: LETTER, once: ONCE, houses: HOUSES, open: !!stripe, walls: { watermark: wall('watermark'), krafft: wall('krafft') }, counts: { watermark: count('watermark'), krafft: count('krafft') }, mine: { watermark: mine(b, 'watermark'), krafft: mine(b, 'krafft') }, unavailable: req.query.unavailable }));
  });
  app.post('/friends', async (req, res) => {
    const x = req.body || {}; const house = HOUSES[x.house] ? x.house : 'watermark';
    if (!stripe) return res.redirect('/friends?unavailable=1');
    const lv = LEVELS.find(l => l.key === x.level);
    const yearly = !!(lv && lv.year && x.interval === 'year');
    const onceCents = !lv ? Math.round(Number(String(x.once || x.amount || '').replace(/[^0-9.]/g, ''))) * 100 : 0;
    if (!lv && !(onceCents >= 500 && onceCents <= 5000000)) return res.redirect('/friends#give');
    const amount = lv ? (yearly ? lv.year : lv.cents) : onceCents, b = buyerOf(req);
    const id = db.prepare('INSERT INTO friends (house, buyer_id, level, amount_cents, recurring, note) VALUES (?,?,?,?,?,?)').run(house, b ? b.id : null, lv ? lv.key : 'once', amount, lv ? 1 : 0, String(x.note || '').trim().slice(0, 280) || null).lastInsertRowid;
    const name = lv ? `${lv.name} of ${HOUSES[house]}` : `A gift to ${HOUSES[house]}`;
    try {
      const s = await stripe.checkout.sessions.create({
        mode: lv ? 'subscription' : 'payment', submit_type: lv ? undefined : 'donate',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, ...(lv ? { recurring: { interval: yearly ? 'year' : 'month' } } : {}), product_data: { name, description: lv ? lv.gives : `In support of ${HOUSES[house]} and the collection it keeps.` } } }],
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
  const usage = m => {
    const r = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='held' THEN 1 ELSE 0.25 END) wn, SUM(COALESCE(bytes, 0) * CASE WHEN status='held' THEN 1 ELSE 0.25 END) b, SUM(CASE WHEN status='held' THEN 1 ELSE 0 END) pub FROM works WHERE maker_id=?").get(m.id);
    const gb = (r.b || 0) / 1e9, weighed = Math.round(r.wn || 0);
    const plan = keeping(m), tier = tierOf(plan ? plan.level : 'studio');
    const fits = TIERS.find(t => weighed <= t.works && gb <= t.gb) || null;           // the smallest tier the archive fits in
    return { works: r.n, pub: r.pub || 0, weighed, gb, tier, fits, over: !(weighed <= tier.works && gb <= tier.gb), pct: Math.min(100, Math.round(100 * Math.max(weighed / tier.works, gb / tier.gb))) };
  };
  const keeping = m => db.prepare("SELECT * FROM friends WHERE maker_id=? AND kind='keeping' AND status IN ('active','ending') ORDER BY id DESC").get(m.id) || null;
  app.locals.keepingOf = m => ({ ...usage(m), plan: keeping(m), terms: KEEPING, tiers: TIERS });
  app.get('/account/keeping', (req, res) => { const m = makerOf(req); if (!m) return res.redirect('/account'); res.send(V.keeping({ m, ...usage(m), plan: keeping(m), terms: KEEPING, tiers: TIERS, open: !!stripe, ok: req.query.ok })); });
  // Begin a tier, or move to another: a new subscription, or the standing one changed in place.
  app.post('/account/keeping', async (req, res) => {
    const m = makerOf(req); if (!m || !stripe) return res.redirect('/account/keeping?ok=unavailable');
    const t = tierOf(String((req.body || {}).tier || 'keeping')); if (!t.cents) return res.redirect('/account/keeping');
    const k = keeping(m);
    if (k && k.status === 'active') {
      if (k.level === t.key) return res.redirect('/account/keeping');
      try { if (k.stripe_sub) { const sub = await stripe.subscriptions.retrieve(k.stripe_sub); await stripe.subscriptions.update(k.stripe_sub, { proration_behavior: 'create_prorations', items: [{ id: sub.items.data[0].id, price_data: { currency: 'usd', unit_amount: t.cents, recurring: { interval: 'month' }, product_data: { name: `${t.name}, on Watermark`, description: t.gives } } }] }); } }
      catch (e) { console.error('[keeping]', e.message); return res.redirect('/account/keeping?ok=unavailable'); }
      db.prepare('UPDATE friends SET level=?, amount_cents=? WHERE id=?').run(t.key, t.cents, k.id);
      ledger.append(db, 'keeping.moved', `friend-${k.id}`, { to: t.key, amount: t.cents });
      return res.redirect('/account/keeping?ok=moved');
    }
    const id = db.prepare("INSERT INTO friends (house, maker_id, kind, level, amount_cents, recurring, name, email) VALUES ('watermark',?,'keeping',?,?,1,?,?)").run(m.id, t.key, t.cents, m.name, m.email).lastInsertRowid;
    try {
      const s = await stripe.checkout.sessions.create({ mode: 'subscription', ...(m.email ? { customer_email: m.email } : {}),
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: t.cents, recurring: { interval: 'month' }, product_data: { name: `${t.name}, on Watermark`, description: t.gives } } }],
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
  return { LEVELS, ONCE, KEEPING, TIERS, wall };
}

module.exports = { mountFriends, LEVELS, LETTER, ONCE, KEEPING, TIERS, HOUSES };
