// Signing in, the way a good house does it. One field: your email. We send a six-digit code (and a link
// that does the same); you type the code or tap the link and you are in: your gallery, and your
// room if you are a maker, by the same email. A passkey, when you have one, is offered in the same
// field by the browser, so nothing is ever janky and nothing is ever remembered. No passwords.
// Codes live ten minutes, five tries, three a quarter-hour per address. Without a mail service the
// code is logged, so the flow still works in development and in tests.
const crypto = require('crypto');

const LIFE = 10 * 60 * 1000, TRIES = 5, PER = 3;
const hash = (code, salt) => crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
const mask = e => { const [u, d] = String(e).split('@'); return `${u.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}`; };
const okEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e) && e.length <= 160;

function mountSignin(app, { db, C, buyerOf, setBuyer, makerOf, setMaker, mail, ledger, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS signins (id INTEGER PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, salt TEXT NOT NULL, link TEXT UNIQUE NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, used_at INTEGER)`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('buyers') WHERE name='name'").get()) db.exec('ALTER TABLE buyers ADD COLUMN name TEXT');
  const recent = email => db.prepare('SELECT COUNT(*) n FROM signins WHERE email=? AND created_at>?').get(email, Date.now() - 15 * 60 * 1000).n;
  app.locals.lastCode = null; // tests read it; never set outside NODE_ENV=test

  // Who this email is on Watermark: a collector (buyers.email), a maker (makers.email), or new.
  const whois = email => ({
    buyer: db.prepare('SELECT * FROM buyers WHERE lower(email)=lower(?) ORDER BY CASE WHEN customer<>\'\' THEN 0 ELSE 1 END, id LIMIT 1').get(email) || null,
    maker: db.prepare('SELECT * FROM makers WHERE lower(email)=lower(?) ORDER BY id LIMIT 1').get(email) || null,
  });

  // Let them in: the collection on this device joins the one the email names; a maker opens their room too.
  function admit(req, res, email) {
    const { maker } = whois(email); let { buyer } = whois(email);
    const cur = buyerOf(req);
    if (!buyer) {
      if (cur && !cur.email) { db.prepare('UPDATE buyers SET email=? WHERE id=?').run(email, cur.id); buyer = db.prepare('SELECT * FROM buyers WHERE id=?').get(cur.id); }
      else { const id = db.prepare("INSERT INTO buyers (customer, email) VALUES ('', ?)").run(email).lastInsertRowid; buyer = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); }
    }
    if (cur && cur.id !== buyer.id) {
      db.prepare('UPDATE licenses SET buyer_id=? WHERE buyer_id=?').run(buyer.id, cur.id);
      for (const t of ['patrons', 'seats', 'applause', 'friends', 'market_offers']) { try { db.prepare(`UPDATE ${t} SET buyer_id=? WHERE buyer_id=?`).run(buyer.id, cur.id); } catch (e) { /* table may not exist */ } }
      if (!buyer.customer && cur.customer) db.prepare('UPDATE buyers SET customer=?, pm=COALESCE(pm, ?) WHERE id=?').run(cur.customer, cur.pm, buyer.id);
    }
    if (maker && !buyer.name) db.prepare('UPDATE buyers SET name=? WHERE id=?').run(maker.name, buyer.id);
    const fresh = db.prepare('SELECT * FROM buyers WHERE id=?').get(buyer.id);
    setBuyer(res, fresh, !!fresh.pm);
    if (maker) setMaker(res, maker);
    if (app.locals.claimStood) app.locals.claimStood(res, req, fresh);
    const first = ((maker && maker.name) || fresh.name || '').split(' ')[0];
    res.cookie('wm_hi', first || '·', { sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 60 * 1000 });
    ledger.append(db, 'signin.email', `buyer-${fresh.id}`, { maker: !!maker });
    const name = (maker && maker.name) || fresh.name || null;
    return { name: name ? name.split(' ')[0] : null, to: maker ? '/account' : '/yours', maker: !!maker, fresh: !cur || cur.id !== fresh.id ? !fresh.customer && !maker : false };
  }

  app.get('/signin', (req, res) => {
    const b = buyerOf(req), m = makerOf(req);
    res.send(V.signin({ b, m, has: (app.locals.passkeysOf ? app.locals.passkeysOf(b) : []).length > 0, mailOn: mail.on(), out: !!req.query.out, next: safeNext(req.query.next) }));
  });
  const safeNext = n => (typeof n === 'string' && /^\/[a-z0-9/_?=&#.%-]*$/i.test(n) && !n.startsWith('//') ? n : null);

  // Step one: the code goes out.
  app.post('/signin/code', async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!okEmail(email)) return res.status(400).json({ ok: false, why: 'That does not look like an email address.' });
    if (recent(email) >= PER) return res.status(429).json({ ok: false, why: 'We have sent a few already. Look in your mail, or try again in a little while.' });
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), salt = crypto.randomBytes(8).toString('hex'), link = crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO signins (email, code_hash, salt, link, created_at) VALUES (?,?,?,?,?)').run(email, hash(code, salt), salt, link, Date.now());
    const who = whois(email), first = who.maker ? who.maker.name.split(' ')[0] : null;
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    await mail.send({ to: email, subject: `${spaced} is your Watermark code`,
      text: `${first ? `${first},\n\n` : ''}Your code to sign in to Watermark is\n\n    ${spaced}\n\nIt is good for ten minutes. Or open this link on the device you are signing in on:\n\n${C.base}/signin/${link}\n\nIf you did not ask for it, nothing happens; ignore this message.\n\nWatermark, a Krafft company` });
    if (process.env.NODE_ENV === 'test') app.locals.lastCode = { email, code, link };
    if (!mail.on()) console.log(`[signin] code for ${email}: ${code}  link: ${C.base}/signin/${link}`);
    res.json({ ok: true, to: mask(email), known: !!(who.buyer || who.maker), maker: !!who.maker });
  });

  // Step two: the code comes back.
  app.post('/signin/verify', (req, res) => {
    const x = req.body || {}, email = String(x.email || '').trim().toLowerCase(), code = String(x.code || '').replace(/\D/g, '');
    const row = db.prepare('SELECT * FROM signins WHERE email=? AND used_at IS NULL ORDER BY id DESC LIMIT 1').get(email);
    if (!row || Date.now() - row.created_at > LIFE) return res.status(400).json({ ok: false, why: 'That code has expired. We can send another.', again: true });
    if (row.tries >= TRIES) return res.status(400).json({ ok: false, why: 'Too many tries. We can send a new code.', again: true });
    if (code.length !== 6 || hash(code, row.salt) !== row.code_hash) { db.prepare('UPDATE signins SET tries=tries+1 WHERE id=?').run(row.id); return res.status(400).json({ ok: false, why: 'Not that one. Look again.' }); }
    db.prepare('UPDATE signins SET used_at=? WHERE id=?').run(Date.now(), row.id);
    const r = admit(req, res, email);
    res.json({ ok: true, ...r, to: safeNext(x.next) || r.to });
  });

  // The link in the message does the same, on whatever device opens it.
  app.get('/signin/:link', (req, res) => {
    const row = db.prepare('SELECT * FROM signins WHERE link=?').get(String(req.params.link));
    if (!row || row.used_at || Date.now() - row.created_at > LIFE) return res.status(410).send(V.signin({ b: buyerOf(req), m: makerOf(req), has: false, mailOn: mail.on(), gone: true }));
    db.prepare('UPDATE signins SET used_at=? WHERE id=?').run(Date.now(), row.id);
    const r = admit(req, res, row.email);
    res.redirect(r.to);
  });

  // Leaving: the house says goodbye the way a good host does, at the door.
  app.post('/signout', (req, res) => {
    const b = buyerOf(req), m = makerOf(req); const name = ((m && m.name) || (b && b.name) || '').split(' ')[0] || null;
    for (const c of ['wm_b', 'wm_tap', 'wm_m']) res.clearCookie(c);
    res.redirect(`/farewell${name ? `?to=${encodeURIComponent(name)}` : ''}`);
  });
  app.get('/farewell', (req, res) => {
    const name = String(req.query.to || '').slice(0, 40).replace(/[^\p{L}\p{M}' .-]/gu, '') || null;
    const cover = db.prepare("SELECT slug, title, place, width, height FROM works WHERE status='held' AND width > height * 1.3 ORDER BY curated DESC, stars DESC, RANDOM() LIMIT 1").get();
    res.send(V.farewell({ name, cover }));
  });
  setInterval(() => db.prepare('DELETE FROM signins WHERE created_at<?').run(Date.now() - 24 * 60 * 60 * 1000), 60 * 60 * 1000).unref();
  return { admit, whois };
}

module.exports = { mountSignin, mask };
