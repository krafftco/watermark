// Seats: the people at a licensee who may hold the licence too. A licence for a company covers the company,
// so its team (and, for a campaign, the agency and the client) each get their own link: the licence, the file
// and the agreement in their own collection, each seat recorded against the licence. Seats are people inside
// the licensed use, not new licensees; passing it to another company is a new licence.
const { nanoid } = require('nanoid');

const SEATS = { social: 1, reference: 1, editorial: 3, commercial: 5, campaign: 10, print: 0 }; // drafts

function mountSeats(app, { db, C, buyerOf, setBuyer, ledger, V, mail }) {
  db.exec(`CREATE TABLE IF NOT EXISTS seats (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, name TEXT, email TEXT,
    buyer_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), claimed_at TEXT, revoked_at TEXT)`);
  const lic = ref => db.prepare('SELECT l.*, u.key AS use_key, u.name AS use_name, w.slug, w.title FROM licenses l JOIN uses u ON u.id=l.use_id JOIN works w ON w.id=l.work_id WHERE l.ref=?').get(String(ref));
  const live = l => l && l.status === 'active' && (!l.ends_at || new Date(l.ends_at) > new Date());
  const seatsOf = licenseId => db.prepare('SELECT * FROM seats WHERE license_id=? AND revoked_at IS NULL ORDER BY id').all(licenseId);
  // The holder counts as the first seat.
  const capacity = l => SEATS[l.use_key] != null ? SEATS[l.use_key] : 1;
  app.locals.seatsOf = l => ({ list: seatsOf(l.id), capacity: capacity(l) });
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
    if (mail) mail.send({ to: email, subject: `${l.licensee_company || l.licensee_name || 'Your team'} shared a licence with you: ${String(l.title).replace(/[.\s]+$/, '')}`,
      text: `You have a seat on licence ${l.ref} (${l.use_name}${l.ends_at ? `, until ${new Date(l.ends_at).toDateString()}` : ''}).\n\nThe photograph, the file and the agreement: ${C.base}/seat/${token}` });
    back(`&seat=${token}`);
  });
  app.post('/c/:ref/seats/:id/remove', (req, res) => {
    const l = lic(req.params.ref), x = req.body || {};
    if (!l || !x.k || x.k !== l.download_token) return res.redirect(`/c/${encodeURIComponent(req.params.ref)}`);
    db.prepare("UPDATE seats SET revoked_at=datetime('now') WHERE id=? AND license_id=?").run(Number(req.params.id), l.id);
    ledger.append(db, 'license.seat.removed', l.ref, {});
    res.redirect(`/c/${l.ref}?k=${l.download_token}#seats`);
  });

  // The person with a seat: see it, keep it in their collection, take the file while the licence lasts.
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

module.exports = { mountSeats, SEATS };
