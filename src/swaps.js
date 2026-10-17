// Trades in kind. Rembrandt collected; so did every great eye. Here anyone who holds a numbered piece,
// collector or maker, can offer it for a piece someone else holds: one for one, no money. The other
// side accepts or declines. On acceptance both pieces move at once, each with a fresh key, each
// transfer on the register, and the photographers are told. Nothing is paid, so nothing is owed;
// a trade for value is the market's job (src/market.js), and counsel's.
const { nanoid } = require('nanoid');

function mountSwaps(app, { db, C, buyerOf, ledger, V, mail = null }) {
  db.exec(`CREATE TABLE IF NOT EXISTS swaps (id INTEGER PRIMARY KEY, from_buyer INTEGER NOT NULL, to_buyer INTEGER NOT NULL, give_id INTEGER NOT NULL, want_id INTEGER NOT NULL,
    note TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT)`);
  const piece = id => db.prepare(`SELECT l.id, l.ref, l.buyer_id, l.collector_no, l.price_cents, l.status, w.id AS wid, w.slug, w.title, w.place, w.width, w.height, w.edition_size, w.maker_id, m.name AS maker, b.name AS holder, b.code AS holder_code, b.email AS holder_email
    FROM licenses l JOIN works w ON w.id=l.work_id JOIN makers m ON m.id=w.maker_id LEFT JOIN buyers b ON b.id=l.buyer_id WHERE l.id=?`).get(Number(id));
  const tradable = p => !!p && p.status === 'active' && p.collector_no != null && p.price_cents > 0;
  const listed = id => db.prepare("SELECT 1 FROM listings WHERE license_id=? AND status='open'").get(id);
  const mine = b => (b ? db.prepare(`SELECT l.id, l.ref, l.collector_no, w.slug, w.title, w.width, w.height, w.edition_size, m.name AS maker FROM licenses l JOIN works w ON w.id=l.work_id JOIN makers m ON m.id=w.maker_id
    WHERE l.buyer_id=? AND l.status='active' AND l.collector_no IS NOT NULL AND l.price_cents>0 ORDER BY l.id DESC`).all(b.id) : []);
  const theirs = (w, b) => db.prepare(`SELECT l.id, l.collector_no, l.starts_at, b.name AS holder, b.code, b.public FROM licenses l LEFT JOIN buyers b ON b.id=l.buyer_id
    WHERE l.work_id=? AND l.status='active' AND l.collector_no IS NOT NULL AND l.price_cents>0 AND l.buyer_id IS NOT NULL${b ? ' AND l.buyer_id<>?' : ''} ORDER BY l.collector_no`).all(...[w.id].concat(b ? [b.id] : []));
  const swapOf = id => { const s = db.prepare('SELECT * FROM swaps WHERE id=?').get(Number(id)); return s ? { ...s, give: piece(s.give_id), want: piece(s.want_id) } : null; };
  const forMe = b => (b ? db.prepare("SELECT id FROM swaps WHERE to_buyer=? AND status='open' ORDER BY id DESC").all(b.id).map(r => swapOf(r.id)) : []);
  const byMe = b => (b ? db.prepare("SELECT id FROM swaps WHERE from_buyer=? AND status IN ('open','accepted','declined') ORDER BY id DESC LIMIT 12").all(b.id).map(r => swapOf(r.id)) : []);
  app.locals.swaps = { forMe, byMe, theirs, mine, count: w => db.prepare("SELECT COUNT(*) n FROM swaps s JOIN licenses l ON l.id=s.want_id WHERE l.work_id=? AND s.status='accepted'").get(w.id).n };

  // Choose: which of their pieces you want, and which of yours you give.
  app.get('/swap/new', (req, res) => {
    const b = buyerOf(req), w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(req.query.work || ''));
    if (!w) return res.redirect('/collection');
    if (!b) return res.redirect(`/signin?next=${encodeURIComponent(`/swap/new?work=${w.slug}`)}`);
    const want = req.query.want ? piece(req.query.want) : null;
    res.send(V.swapNew({ w, b, theirs: theirs(w, b), want: want && want.wid === w.id && want.buyer_id !== b.id && tradable(want) ? want : null, mine: mine(b), err: req.query.err || null }));
  });
  app.post('/swap', (req, res) => {
    const b = buyerOf(req), x = req.body || {}; if (!b) return res.redirect('/signin');
    const want = piece(x.want), give = piece(x.give);
    const back = e => res.redirect(`/swap/new?work=${want ? want.slug : ''}${want ? `&want=${want.id}` : ''}&err=${e}`);
    if (!tradable(want) || want.buyer_id === b.id || !want.buyer_id) return back('want');
    if (!tradable(give) || give.buyer_id !== b.id) return back('give');
    if (app.locals.canTransfer && (!app.locals.canTransfer(give) || !app.locals.canTransfer(want))) return back('locked');
    if (give.id === want.id) return back('same');
    if (listed(give.id)) return back('listed');
    if (db.prepare("SELECT 1 FROM swaps WHERE from_buyer=? AND want_id=? AND status='open'").get(b.id, want.id)) return back('open');
    const id = db.prepare('INSERT INTO swaps (from_buyer, to_buyer, give_id, want_id, note) VALUES (?,?,?,?,?)').run(b.id, want.buyer_id, give.id, want.id, String(x.note || '').trim().slice(0, 400) || null).lastInsertRowid;
    ledger.append(db, 'swap.offered', `swap-${id}`, { give: give.slug, give_no: give.collector_no, want: want.slug, want_no: want.collector_no });
    if (mail && want.holder_email) mail.send({ to: want.holder_email, subject: `A trade is offered for ${V.tidy(want.title)}, No. ${want.collector_no}`,
      text: `${b.name || 'A collector'} offers ${V.tidy(give.title)}, No. ${give.collector_no}${give.edition_size ? ` of ${give.edition_size}` : ''}, by ${give.maker}, for your ${V.tidy(want.title)}, No. ${want.collector_no}.\n\nSee it, accept or decline: ${C.base}/swap/${id}\n\nNothing moves until you say so.` });
    res.redirect(`/swap/${id}`);
  });

  app.get('/swap/:id', (req, res) => {
    const s = swapOf(req.params.id), b = buyerOf(req); if (!s) return res.status(404).send(V.layout({ title: 'Watermark', body: '<section class="narrow"><h1>No such trade.</h1></section>' }));
    const role = b && b.id === s.to_buyer ? 'to' : b && b.id === s.from_buyer ? 'from' : null;
    if (!role) return res.redirect(`/signin?next=/swap/${s.id}`);
    res.send(V.swap({ s, role, b, ok: req.query.ok || null }));
  });
  app.post('/swap/:id/:act', (req, res) => {
    const s = swapOf(req.params.id), b = buyerOf(req), act = req.params.act; if (!s || !b) return res.redirect('/yours');
    if (act === 'withdraw' && s.from_buyer === b.id && s.status === 'open') { db.prepare("UPDATE swaps SET status='withdrawn', closed_at=datetime('now') WHERE id=?").run(s.id); return res.redirect('/yours#trades'); }
    if (s.to_buyer !== b.id || s.status !== 'open') return res.redirect(`/swap/${s.id}`);
    if (act === 'decline') { db.prepare("UPDATE swaps SET status='declined', closed_at=datetime('now') WHERE id=?").run(s.id); ledger.append(db, 'swap.declined', `swap-${s.id}`, {}); return res.redirect(`/swap/${s.id}?ok=declined`); }
    if (act !== 'accept') return res.redirect(`/swap/${s.id}`);
    // Both pieces must still be where they were, and neither on the market.
    const give = piece(s.give_id), want = piece(s.want_id);
    if (!tradable(give) || !tradable(want) || give.buyer_id !== s.from_buyer || want.buyer_id !== s.to_buyer || listed(give.id) || listed(want.id)) { db.prepare("UPDATE swaps SET status='lapsed', closed_at=datetime('now') WHERE id=?").run(s.id); return res.redirect(`/swap/${s.id}?ok=lapsed`); }
    const from = db.prepare('SELECT * FROM buyers WHERE id=?').get(s.from_buyer), to = db.prepare('SELECT * FROM buyers WHERE id=?').get(s.to_buyer);
    const move = (p, toB) => { const k = nanoid(32);
      db.prepare("INSERT INTO transfers (license_id, token, from_buyer, to_buyer, claimed_at) VALUES (?,?,?,?,datetime('now'))").run(p.id, nanoid(24), p.buyer_id, toB.id);
      db.prepare("UPDATE licenses SET buyer_id=?, download_token=?, licensee_name=COALESCE(?, licensee_name), licensee_email=COALESCE(?, licensee_email), updated_at=datetime('now') WHERE id=?").run(toB.id, k, toB.name || null, toB.email || null, p.id);
      db.prepare("UPDATE offers SET status='closed', closed_at=datetime('now') WHERE license_id=? AND status='open'").run(p.id);
      db.prepare("UPDATE swaps SET status='lapsed', closed_at=datetime('now') WHERE status='open' AND id<>? AND (give_id IN (?,?) OR want_id IN (?,?))").run(s.id, give.id, want.id, give.id, want.id);
      return k; };
    db.transaction(() => { move(give, to); move(want, from); db.prepare("UPDATE swaps SET status='accepted', closed_at=datetime('now') WHERE id=?").run(s.id); })();
    ledger.append(db, 'swap.traded', `swap-${s.id}`, { give: give.slug, give_no: give.collector_no, want: want.slug, want_no: want.collector_no });
    for (const [p, nb] of [[give, to], [want, from]]) {
      ledger.append(db, 'license.transferred', p.ref, { work: p.slug, collector_no: p.collector_no, how: 'trade' });
      if (mail && nb.email) mail.send({ to: nb.email, subject: `Yours by trade: ${V.tidy(p.title)}, No. ${p.collector_no}`, text: `${V.tidy(p.title)}, No. ${p.collector_no}${p.edition_size ? ` of ${p.edition_size}` : ''}, by ${p.maker}, is now in your gallery.\n\n${C.base}/yours` });
      const mk = db.prepare('SELECT email, name FROM makers WHERE id=?').get(p.maker_id);
      if (mail && mk && mk.email) mail.send({ to: mk.email, subject: `Traded: ${V.tidy(p.title)}, No. ${p.collector_no}`, text: `No. ${p.collector_no} of ${V.tidy(p.title)} changed hands in a trade, one piece for another. Its life: ${C.base}/w/${p.slug}/life` });
    }
    res.redirect(`/swap/${s.id}?ok=traded`);
  });
  return { forMe, byMe };
}

module.exports = { mountSwaps };
