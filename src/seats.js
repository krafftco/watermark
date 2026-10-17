// Seats: the people at a licensee who may hold the license too. A license for a company covers the company,
// so its team (and, for a campaign, the agency and the client) each get their own link: the license, the file
// and the agreement in their own collection, each seat recorded against the license. Seats are people inside
// the licensed use, not new licensees; passing it to another company is a new license.
const { nanoid } = require('nanoid');

const SEATS = { social: 1, reference: 1, editorial: 3, commercial: 5, campaign: 10, print: 0 }; // drafts

const SEAT_PRICE = 5000; // each extra seat (draft)

function mountSeats(app, { db, C, buyerOf, setBuyer, ledger, V, mail, stripe = null }) {
  db.exec(`CREATE TABLE IF NOT EXISTS seats (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, name TEXT, email TEXT,
    buyer_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), claimed_at TEXT, revoked_at TEXT)`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='extra_seats'").get()) db.exec('ALTER TABLE licenses ADD COLUMN extra_seats INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS seat_orders (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, n INTEGER NOT NULL, amount_cents INTEGER NOT NULL, stripe_session TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT)`);
  const lic = ref => db.prepare('SELECT l.*, u.key AS use_key, u.name AS use_name, w.slug, w.title FROM licenses l JOIN uses u ON u.id=l.use_id JOIN works w ON w.id=l.work_id WHERE l.ref=?').get(String(ref));
  const live = l => l && l.status === 'active' && (!l.ends_at || new Date(l.ends_at) > new Date());
  const seatsOf = licenseId => db.prepare('SELECT * FROM seats WHERE license_id=? AND revoked_at IS NULL ORDER BY id').all(licenseId);
  // The holder counts as the first seat.
  const capacity = l => (SEATS[l.use_key] != null ? SEATS[l.use_key] : 1) + (Number(l.extra_seats) || 0);
  app.locals.seatsOf = l => ({ list: seatsOf(l.id), capacity: capacity(l), price: SEAT_PRICE, canBuy: !!stripe && SEATS[l.use_key] > 1 });

  // More seats, bought by the holder: Stripe Checkout, then added the moment payment lands.
  app.post('/c/:ref/seats/buy', async (req, res) => {
    const l = lic(req.params.ref), x = req.body || {};
    if (!l || !x.k || x.k !== l.download_token || !stripe || !live(l) || !(SEATS[l.use_key] > 1)) return res.redirect(`/c/${encodeURIComponent(req.params.ref)}`);
    const n = Math.max(1, Math.min(25, Math.round(Number(x.n) || 1)));
    try {
      const cs = await stripe.checkout.sessions.create({ mode: 'payment', line_items: [{ quantity: n, price_data: { currency: 'usd', unit_amount: SEAT_PRICE, product_data: { name: `Seat on license ${l.ref}`, description: `${String(l.title).replace(/[.\s]+$/, '')}: ${l.use_name}. One more person at ${l.licensee_company || l.licensee_name || 'the licensee'}.` } } }],
        metadata: { seats: l.ref, n: String(n) }, success_url: `${C.base}/c/${l.ref}/seats/added?session_id={CHECKOUT_SESSION_ID}&k=${l.download_token}`, cancel_url: `${C.base}/c/${l.ref}?k=${l.download_token}#seats` });
      db.prepare('INSERT INTO seat_orders (license_id, n, amount_cents, stripe_session) VALUES (?,?,?,?)').run(l.id, n, n * SEAT_PRICE, cs.id);
      res.redirect(303, cs.url);
    } catch (e) { console.error('[seats]', e.message); res.redirect(`/c/${l.ref}?k=${l.download_token}&seat=unavailable#seats`); }
  });
  function addSeats(cs) {
    const o = db.prepare("SELECT * FROM seat_orders WHERE stripe_session=?").get(cs.id); if (!o || o.status !== 'pending' || cs.payment_status !== 'paid') return o;
    db.prepare("UPDATE seat_orders SET status='paid', paid_at=datetime('now') WHERE id=?").run(o.id);
    db.prepare('UPDATE licenses SET extra_seats=extra_seats+? WHERE id=?').run(o.n, o.license_id);
    const l = db.prepare('SELECT ref FROM licenses WHERE id=?').get(o.license_id);
    ledger.append(db, 'license.seats.added', l.ref, { n: o.n, amount: o.amount_cents });
    return o;
  }
  app.get('/c/:ref/seats/added', async (req, res) => {
    const l = lic(req.params.ref); if (!l || req.query.k !== l.download_token) return res.redirect('/');
    try { addSeats(await stripe.checkout.sessions.retrieve(String(req.query.session_id || ''))); } catch (e) { /* the webhook will add them */ }
    res.redirect(`/c/${l.ref}?k=${l.download_token}&seat=added#seats`);
  });
  const prevEvent = app.locals.patronEvent;
  app.locals.patronEvent = event => { if (prevEvent) prevEvent(event); const o = event.data.object; if (event.type === 'checkout.session.completed' && o.metadata && o.metadata.seats) addSeats(o); };
  app.locals.seatsFor = b => (b ? db.prepare(`SELECT s.token, s.claimed_at, l.ref, l.ends_at, l.status, u.name AS use_name, w.slug, w.title, w.width, w.height, l.licensee_company, l.licensee_name
    FROM seats s JOIN licenses l ON l.id=s.license_id JOIN uses u ON u.id=l.use_id JOIN works w ON w.id=l.work_id WHERE s.buyer_id=? AND s.revoked_at IS NULL ORDER BY s.id DESC`).all(b.id) : []);

  // The holder adds a person: a link of their own, by email when mail is on.
  app.post('/c/:ref/seats', (req, res) => {
    const l = lic(req.params.ref), x = req.body || {};
    if (!l || !x.k || x.k !== l.download_token) return res.redirect(`/c/${encodeURIComponent(req.params.ref)}`);
    const back = q => res.redirect(`/c/${l.ref}?k=${l.download_token}${q}#seats`);
    if (!live(l)) return back('&seat=ended');
    if (seatsOf(l.id).length + 1 >= capacity(l)) return back('&seat=full');
    const email = String(x.email || '').trim().slice(0, 160), name = String(x.name || '').trim().slice(0, 80) || null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return back('&seat=email');
    const token = nanoid(24);
    db.prepare('INSERT INTO seats (license_id, token, name, email) VALUES (?,?,?,?)').run(l.id, token, name, email);
    ledger.append(db, 'license.seat', l.ref, { seats: seatsOf(l.id).length + 1, of: capacity(l) });
    if (mail) mail.send({ to: email, subject: `${l.licensee_company || l.licensee_name || 'Your team'} shared a license with you: ${String(l.title).replace(/[.\s]+$/, '')}`,
      text: `You have a seat on license ${l.ref} (${l.use_name}${l.ends_at ? `, until ${new Date(l.ends_at).toDateString()}` : ''}).\n\nThe photograph, the file and the agreement: ${C.base}/seat/${token}` });
    back(`&seat=${token}`);
  });
  app.post('/c/:ref/seats/:id/remove', (req, res) => {
    const l = lic(req.params.ref), x = req.body || {};
    if (!l || !x.k || x.k !== l.download_token) return res.redirect(`/c/${encodeURIComponent(req.params.ref)}`);
    db.prepare("UPDATE seats SET revoked_at=datetime('now') WHERE id=? AND license_id=?").run(Number(req.params.id), l.id);
    ledger.append(db, 'license.seat.removed', l.ref, {});
    res.redirect(`/c/${l.ref}?k=${l.download_token}#seats`);
  });

  // The person with a seat: see it, keep it in their collection, take the file while the license lasts.
  const seatOf = t => db.prepare('SELECT * FROM seats WHERE token=? AND revoked_at IS NULL').get(String(t));
  app.get('/seat/:token', (req, res) => {
    const s = seatOf(req.params.token); if (!s) return res.status(404).send(V.layout({ title: 'Not found · Watermark', body: '<section class="narrow"><h1>This seat is no longer open.</h1><p class="lede">Ask the person who shared it with you.</p></section>' }));
    const l = db.prepare('SELECT l.*, u.name AS use_name, u.key AS use_key, w.slug, w.title FROM licenses l JOIN uses u ON u.id=l.use_id JOIN works w ON w.id=l.work_id WHERE l.id=?').get(s.license_id);
    const b = buyerOf(req);
    res.send(V.seat({ s, l, live: live(l), mine: !!(b && s.buyer_id === b.id) }));
  });
  app.post('/seat/:token', (req, res) => {
    const s = seatOf(req.params.token); if (!s) return res.redirect('/yours');
    let b = buyerOf(req);
    if (s.buyer_id && (!b || b.id !== s.buyer_id)) return res.redirect(`/seat/${s.token}`); // taken by someone else
    if (!b) { const id = db.prepare('INSERT INTO buyers (customer, email) VALUES (?,?)').run('', s.email || null).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); }
    if (!s.buyer_id) { db.prepare("UPDATE seats SET buyer_id=?, claimed_at=datetime('now') WHERE id=?").run(b.id, s.id); ledger.append(db, 'license.seat.claimed', `seat-${s.id}`, {}); }
    res.redirect(`/seat/${s.token}`);
  });
  app.get('/seat/:token/file', (req, res) => {
    const s = seatOf(req.params.token); if (!s) return res.sendStatus(404);
    const l = db.prepare('SELECT * FROM licenses WHERE id=?').get(s.license_id);
    if (!live(l) || !l.download_token) return res.sendStatus(404);
    ledger.append(db, 'license.seat.file', l.ref, {});
    app.locals.deliver(l, res);
  });
  return { SEATS, seatsOf };
}

module.exports = { mountSeats, SEATS, SEAT_PRICE };
