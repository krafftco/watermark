// Patronage, the Medici way: anyone can keep a maker working, monthly or once.
// Patrons come closer to the work, never to the person: their name on the maker's wall, a mark on
// their own collection, their name in the credits of new series, and for the Medici a signed print.
// Levels and prices are drafts until Will confirms them. 85% to the maker, as with everything else.
const LEVELS = [
  { key: 'friend', name: 'Friend', cents: 1000, gives: 'Your name on the wall of patrons, and the patron’s mark on your gallery.' },
  { key: 'patron', name: 'Patron', cents: 5000, gives: 'All of that, and your name in the credits of every new series: made possible by its patrons.' },
  { key: 'benefactor', name: 'Benefactor', cents: 25000, gives: 'All of that, and each year a signed print, chosen with the maker.' },
  // The Medici: a name on the work, not a subscription. Monthly or once a year. Above it, the maker takes letters.
  { key: 'medici', name: 'Medici', cents: 250000, year: 2500000, gives: 'All of that, your name at the head of the wall, and a photograph made in your name each year, where you choose.' },
];
const ONCE = [2000, 5000, 10000];

function mountPatronage(app, { db, C, stripe, maker, slugify, buyerOf, setBuyer, ledger, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS patrons (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, buyer_id INTEGER, level TEXT NOT NULL,
    amount_cents INTEGER NOT NULL, recurring INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending', name TEXT, public INTEGER NOT NULL DEFAULT 1,
    email TEXT, stripe_session TEXT, stripe_sub TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), started_at TEXT, ended_at TEXT)`);
  const slugOf = m => slugify(m.name);
  // Patronage pays the maker directly, so for now it is open only for the house's own maker; others once payouts exist.
  const makerBySlug = s => [maker, ...db.prepare('SELECT * FROM makers').all()].find(m => slugOf(m) === s || m.handle === s) || null;
  const open = m => !!(stripe && m && m.id === maker.id);
  const wall = m => db.prepare("SELECT name, level, started_at FROM patrons WHERE maker_id=? AND status IN ('active','ending') AND public=1 AND name IS NOT NULL ORDER BY CASE level WHEN 'medici' THEN 0 WHEN 'benefactor' THEN 1 WHEN 'patron' THEN 2 WHEN 'friend' THEN 3 ELSE 4 END, started_at").all(m.id);
  const count = m => db.prepare("SELECT COUNT(*) n FROM patrons WHERE maker_id=? AND status IN ('active','ending')").get(m.id).n;
  const credits = m => db.prepare("SELECT name FROM patrons WHERE maker_id=? AND status IN ('active','ending') AND public=1 AND name IS NOT NULL AND level IN ('patron','benefactor','medici') ORDER BY CASE level WHEN 'medici' THEN 0 WHEN 'benefactor' THEN 1 ELSE 2 END, started_at").all(m.id).map(p => p.name);
  const of = b => (b ? db.prepare("SELECT p.*, m.name AS maker_name FROM patrons p JOIN makers m ON m.id=p.maker_id WHERE p.buyer_id=? AND p.status IN ('active','ending') ORDER BY p.started_at").all(b.id) : []);

  app.get('/m/:slug', async (req, res) => {
    const m = makerBySlug(req.params.slug); if (!m) return res.sendStatus(404);
    const RG = require('./regard');
    const works = RG.byRegard(db, db.prepare("SELECT * FROM works WHERE maker_id=? AND status='held' ORDER BY curated DESC, id").all(m.id));
    const years = RG.chronology(db, works);
    // Alongside their own work: what this maker collects, when their gallery is public.
    const mb = db.prepare('SELECT * FROM buyers WHERE (id=? OR (email IS NOT NULL AND lower(email)=lower(?))) AND public=1 ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1').get(m.buyer_id || 0, m.email || '', m.buyer_id || 0);
    const collects = mb ? { code: mb.code, n: db.prepare("SELECT COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE l.buyer_id=? AND l.collector_no IS NOT NULL AND l.status='active' AND w.maker_id<>? AND w.status='held'").get(mb.id, m.id).n,
      works: db.prepare("SELECT w.slug, w.title, w.width, w.height, l.collector_no, mk.name AS maker, mk.handle FROM licenses l JOIN works w ON w.id=l.work_id JOIN makers mk ON mk.id=w.maker_id WHERE l.buyer_id=? AND l.collector_no IS NOT NULL AND l.status='active' AND w.maker_id<>? AND w.status='held' ORDER BY l.id DESC LIMIT 8").all(mb.id, m.id) } : null;
    const collectors = db.prepare("SELECT COUNT(DISTINCT l.buyer_id) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.collector_no IS NOT NULL AND l.status IN ('active','expired')").get(m.id).n;
    const series = require('./series').filter(s => s.maker === m.name);
    const stories = app.locals.storiesBy ? await app.locals.storiesBy(m) : [];
    const lines = db.prepare("SELECT n.body, n.name, n.at, w.slug, w.title FROM notes n JOIN works w ON w.id=n.work_id WHERE w.maker_id=? AND n.removed_at IS NULL AND w.status='held' ORDER BY CASE WHEN n.seen_at IS NULL THEN 1 ELSE 0 END, n.id DESC LIMIT 3").all(m.id);
    const ap = db.prepare('SELECT COUNT(*) n FROM applause a JOIN works w ON w.id=a.work_id WHERE w.maker_id=?').get(m.id).n;
    res.send(V.makerPage({ introduced: app.locals.introductions ? app.locals.introductions.whoIntroduced(m.introduced_by) : null, m, slug: slugOf(m), works, collectors, patrons: count(m), wall: wall(m), series, levels: LEVELS, once: ONCE, open: open(m), mine: of(buyerOf(req)).filter(p => p.maker_id === m.id), stories, lines, applause: ap, years, collects }));
  });

  app.post('/m/:slug/patron', async (req, res) => {
    const m = makerBySlug(req.params.slug); if (!open(m)) return res.redirect(`/m/${req.params.slug}`);
    const x = req.body || {};
    const lv = LEVELS.find(l => l.key === x.level);
    const yearly = !!(lv && lv.year && x.interval === 'year');
    const onceCents = !lv ? Math.round(Number(String(x.once || x.amount || '').replace(/[^0-9.]/g, ''))) * 100 : 0;
    if (!lv && !(onceCents >= 500 && onceCents <= 1000000)) return res.redirect(`/m/${slugOf(m)}#patron`);
    const amount = lv ? (yearly ? lv.year : lv.cents) : onceCents;
    const b = buyerOf(req);
    const id = db.prepare('INSERT INTO patrons (maker_id, buyer_id, level, amount_cents, recurring) VALUES (?,?,?,?,?)').run(m.id, b ? b.id : null, lv ? lv.key : 'once', amount, lv ? 1 : 0).lastInsertRowid;
    const name = lv ? `Patron of ${m.name}: ${lv.name}` : `In support of ${m.name}`;
    try {
      const s = await stripe.checkout.sessions.create({
        mode: lv ? 'subscription' : 'payment', submit_type: lv ? undefined : 'donate',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, ...(lv ? { recurring: { interval: yearly ? 'year' : 'month' } } : {}), product_data: { name, description: lv ? `${lv.gives} 85% goes to ${m.name}. End it any time from Yours on Watermark.` : `Thank you. 85% goes to ${m.name}.` } } }],
        ...(b && b.customer ? { customer: b.customer } : lv ? {} : { customer_creation: 'always' }),
        metadata: { patron: String(id) }, ...(lv ? { subscription_data: { metadata: { patron: String(id) } } } : {}),
        success_url: `${C.base}/patron/${id}/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${C.base}/m/${slugOf(m)}#patron`,
      });
      db.prepare('UPDATE patrons SET stripe_session=? WHERE id=?').run(s.id, id);
      res.redirect(303, s.url);
    } catch (e) { console.error('[patron]', e.message); db.prepare("DELETE FROM patrons WHERE id=? AND status='pending'").run(id); res.redirect(`/m/${slugOf(m)}?unavailable=1#patron`); }
  });

  function activate(id, s) {
    const p = db.prepare('SELECT * FROM patrons WHERE id=?').get(id); if (!p || p.status !== 'pending' || p.stripe_session !== s.id) return p;
    if (s.status !== 'complete' && s.payment_status !== 'paid') return p;
    const d = s.customer_details || {};
    db.prepare("UPDATE patrons SET status=?, stripe_sub=?, email=COALESCE(?, email), name=COALESCE(name, ?), started_at=datetime('now') WHERE id=?")
      .run(p.recurring ? 'active' : 'given', s.subscription || null, d.email || null, d.name || null, id);
    ledger.append(db, p.recurring ? 'patron.joined' : 'patron.gave', `patron-${id}`, { maker: db.prepare('SELECT handle FROM makers WHERE id=?').get(p.maker_id).handle, level: p.level });
    return db.prepare('SELECT * FROM patrons WHERE id=?').get(id);
  }
  app.locals.patronEvent = event => {
    const o = event.data.object;
    if (event.type === 'checkout.session.completed' && o.metadata && o.metadata.patron) activate(Number(o.metadata.patron), o);
    if (event.type === 'customer.subscription.deleted' && o.metadata && o.metadata.patron) db.prepare("UPDATE patrons SET status='ended', ended_at=datetime('now') WHERE id=?").run(Number(o.metadata.patron));
  };

  app.get('/patron/:id/thanks', async (req, res) => {
    let p = db.prepare('SELECT * FROM patrons WHERE id=?').get(Number(req.params.id));
    if (!p || !req.query.session_id || p.stripe_session !== req.query.session_id) return res.redirect('/');
    if (p.status === 'pending' && stripe) { try { p = activate(p.id, await stripe.checkout.sessions.retrieve(req.query.session_id)); } catch (e) { /* show pending */ } }
    let b = buyerOf(req);
    if (p.status !== 'pending' && !p.buyer_id) {
      if (!b) { const s = await stripe.checkout.sessions.retrieve(req.query.session_id).catch(() => ({})); const nid = db.prepare('INSERT INTO buyers (customer, email) VALUES (?,?)').run(s.customer || '', p.email || null).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(nid); setBuyer(res, b); }
      db.prepare('UPDATE patrons SET buyer_id=? WHERE id=?').run(b.id, p.id); p = db.prepare('SELECT * FROM patrons WHERE id=?').get(p.id);
    }
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(p.maker_id);
    res.send(V.patronThanks({ p, m, slug: slugOf(m), level: LEVELS.find(l => l.key === p.level), own: !!(b && b.id === p.buyer_id), session: req.query.session_id }));
  });
  // The patron chooses how their name appears on the wall, or keeps it off.
  app.post('/patron/:id/name', (req, res) => {
    const p = db.prepare('SELECT * FROM patrons WHERE id=?').get(Number(req.params.id)), b = buyerOf(req), x = req.body || {};
    if (!p || !b || p.buyer_id !== b.id) return res.redirect('/yours');
    db.prepare('UPDATE patrons SET name=?, public=? WHERE id=?').run(String(x.name || '').trim().slice(0, 60) || null, x.public === '1' ? 1 : 0, p.id);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(p.maker_id);
    res.redirect(`/m/${slugOf(m)}#wall`);
  });
  // Ending is one press; it runs to the end of the month already paid.
  app.post('/patron/:id/end', async (req, res) => {
    const p = db.prepare('SELECT * FROM patrons WHERE id=?').get(Number(req.params.id)), b = buyerOf(req);
    if (!p || !b || p.buyer_id !== b.id || p.status !== 'active' || !p.stripe_sub) return res.redirect('/yours');
    try { await stripe.subscriptions.update(p.stripe_sub, { cancel_at_period_end: true }); } catch (e) { return res.redirect('/yours?patron=error#patronage'); }
    db.prepare("UPDATE patrons SET status='ending' WHERE id=?").run(p.id);
    ledger.append(db, 'patron.ending', `patron-${p.id}`, {});
    res.redirect('/yours#patronage');
  });

  return { of, credits: m => credits(m || maker), slugOf, levels: LEVELS };
}

module.exports = { mountPatronage, LEVELS };
