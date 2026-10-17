// Signing in, the way a good house does it: no password. A collector saves their gallery with a
// passkey (Face ID, Touch ID, a phone), which their phone or computer keeps in sync, so the
// collection follows them to every device. Email sign-in can join once the mail service is on.
const crypto = require('crypto');
const SW = require('@simplewebauthn/server');

function mountAuth(app, { db, C, buyerOf, setBuyer, ledger, V, makerOf, setMaker }) {
  db.exec(`CREATE TABLE IF NOT EXISTS passkeys (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL, cred_id TEXT UNIQUE NOT NULL, public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0, transports TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), used_at TEXT)`);
  const origin = C.base.replace(/\/$/, ''), rpID = new URL(origin).hostname;
  // Challenges live for five minutes, keyed by a random cookie.
  const pending = new Map();
  const hold = (res, data) => { const k = crypto.randomBytes(18).toString('base64url'); pending.set(k, { ...data, at: Date.now() }); res.cookie('wm_ch', k, { httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https'), maxAge: 5 * 60 * 1000 }); };
  const take = req => { const k = req.cookies && req.cookies.wm_ch; const v = k && pending.get(k); if (k) pending.delete(k); return v && Date.now() - v.at < 5 * 60 * 1000 ? v : null; };
  setInterval(() => { const now = Date.now(); for (const [k, v] of pending) if (now - v.at > 5 * 60 * 1000) pending.delete(k); }, 60 * 1000).unref();
  const keysOf = b => (b ? db.prepare('SELECT * FROM passkeys WHERE buyer_id=?').all(b.id) : []);
  const newBuyer = res => { const id = db.prepare("INSERT INTO buyers (customer, email) VALUES ('', NULL)").run().lastInsertRowid; const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); return b; };
  app.locals.passkeysOf = keysOf;

  app.get('/signin', (req, res) => { const b = buyerOf(req); res.send(V.signin({ b, has: keysOf(b).length > 0 })); });
  app.get('/static/webauthn.js', (req, res) => { res.type('application/javascript').set('Cache-Control', 'public, max-age=86400'); res.sendFile(require('path').join(__dirname, '..', 'node_modules', '@simplewebauthn', 'browser', 'dist', 'bundle', 'index.umd.min.js')); });

  // Save this collection with a passkey.
  app.post('/auth/passkey/register/options', async (req, res) => {
    const b = buyerOf(req) || newBuyer(res);
    const name = b.name || 'Watermark collection';
    const opts = await SW.generateRegistrationOptions({ rpName: 'Watermark', rpID, userName: name, userDisplayName: name, userID: new TextEncoder().encode('wm-buyer-' + b.id),
      attestationType: 'none', excludeCredentials: keysOf(b).map(k => ({ id: k.cred_id, transports: k.transports ? JSON.parse(k.transports) : undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' } });
    hold(res, { challenge: opts.challenge, buyer: b.id, kind: 'reg' });
    res.json(opts);
  });
  app.post('/auth/passkey/register/verify', async (req, res) => {
    const p = take(req), b = buyerOf(req);
    if (!p || p.kind !== 'reg' || !b || b.id !== p.buyer) return res.status(400).json({ ok: false });
    try {
      const v = await SW.verifyRegistrationResponse({ response: req.body, expectedChallenge: p.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
      if (!v.verified) return res.status(400).json({ ok: false });
      const c = v.registrationInfo.credential;
      db.prepare('INSERT OR IGNORE INTO passkeys (buyer_id, cred_id, public_key, counter, transports) VALUES (?,?,?,?,?)').run(b.id, c.id, Buffer.from(c.publicKey), c.counter || 0, JSON.stringify(c.transports || []));
      ledger.append(db, 'collector.passkey', `buyer-${b.id}`, {});
      res.json({ ok: true });
    } catch (e) { console.error('[passkey]', e.message); res.status(400).json({ ok: false }); }
  });

  // Sign in on any device: the passkey says whose collection this is.
  app.post('/auth/passkey/login/options', async (req, res) => {
    const opts = await SW.generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    hold(res, { challenge: opts.challenge, kind: 'auth' });
    res.json(opts);
  });
  app.post('/auth/passkey/login/verify', async (req, res) => {
    const p = take(req); const body = req.body || {};
    if (!p || p.kind !== 'auth' || !body.id) return res.status(400).json({ ok: false });
    const k = db.prepare('SELECT * FROM passkeys WHERE cred_id=?').get(String(body.id)); if (!k) return res.status(404).json({ ok: false, unknown: true });
    try {
      const v = await SW.verifyAuthenticationResponse({ response: body, expectedChallenge: p.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
        credential: { id: k.cred_id, publicKey: new Uint8Array(k.public_key), counter: k.counter, transports: k.transports ? JSON.parse(k.transports) : undefined } });
      if (!v.verified) return res.status(400).json({ ok: false });
      db.prepare("UPDATE passkeys SET counter=?, used_at=datetime('now') WHERE id=?").run(v.authenticationInfo.newCounter || 0, k.id);
      // Anything collected on this device before signing in joins the collection.
      const cur = buyerOf(req), b = db.prepare('SELECT * FROM buyers WHERE id=?').get(k.buyer_id);
      if (cur && cur.id !== b.id) {
        db.prepare('UPDATE licenses SET buyer_id=? WHERE buyer_id=?').run(b.id, cur.id);
        try { db.prepare('UPDATE patrons SET buyer_id=? WHERE buyer_id=?').run(b.id, cur.id); } catch (e) { /* no patronage table */ }
        if (!b.customer && cur.customer) db.prepare('UPDATE buyers SET customer=?, pm=COALESCE(pm, ?) WHERE id=?').run(cur.customer, cur.pm, b.id);
      }
      const fresh = db.prepare('SELECT * FROM buyers WHERE id=?').get(b.id);
      setBuyer(res, fresh, !!fresh.pm);
      res.json({ ok: true });
    } catch (e) { console.error('[passkey]', e.message); res.status(400).json({ ok: false }); }
  });
  // ---------- makers: the same passkey sign-in, for their own room ----------
  db.exec(`CREATE TABLE IF NOT EXISTS maker_passkeys (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, cred_id TEXT UNIQUE NOT NULL, public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0, transports TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), used_at TEXT)`);
  const mkeys = m => (m ? db.prepare('SELECT * FROM maker_passkeys WHERE maker_id=?').all(m.id) : []);
  app.locals.makerKeys = mkeys;
  app.post('/auth/maker/register/options', async (req, res) => {
    const m = makerOf && makerOf(req); if (!m) return res.status(401).json({ ok: false });
    const opts = await SW.generateRegistrationOptions({ rpName: 'Watermark', rpID, userName: m.email || m.name, userDisplayName: m.name, userID: new TextEncoder().encode('wm-maker-' + m.id),
      attestationType: 'none', excludeCredentials: mkeys(m).map(k => ({ id: k.cred_id })), authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' } });
    hold(res, { challenge: opts.challenge, maker: m.id, kind: 'mreg' }); res.json(opts);
  });
  app.post('/auth/maker/register/verify', async (req, res) => {
    const p = take(req), m = makerOf && makerOf(req);
    if (!p || p.kind !== 'mreg' || !m || m.id !== p.maker) return res.status(400).json({ ok: false });
    try {
      const v = await SW.verifyRegistrationResponse({ response: req.body, expectedChallenge: p.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
      if (!v.verified) return res.status(400).json({ ok: false });
      const c = v.registrationInfo.credential;
      db.prepare('INSERT OR IGNORE INTO maker_passkeys (maker_id, cred_id, public_key, counter, transports) VALUES (?,?,?,?,?)').run(m.id, c.id, Buffer.from(c.publicKey), c.counter || 0, JSON.stringify(c.transports || []));
      ledger.append(db, 'maker.passkey', m.handle, {}); res.json({ ok: true });
    } catch (e) { console.error('[passkey]', e.message); res.status(400).json({ ok: false }); }
  });
  app.post('/auth/maker/login/options', async (req, res) => { const opts = await SW.generateAuthenticationOptions({ rpID, userVerification: 'preferred' }); hold(res, { challenge: opts.challenge, kind: 'mauth' }); res.json(opts); });
  app.post('/auth/maker/login/verify', async (req, res) => {
    const p = take(req); const body = req.body || {};
    if (!p || p.kind !== 'mauth' || !body.id) return res.status(400).json({ ok: false });
    const k = db.prepare('SELECT * FROM maker_passkeys WHERE cred_id=?').get(String(body.id)); if (!k) return res.status(404).json({ ok: false, unknown: true });
    try {
      const v = await SW.verifyAuthenticationResponse({ response: body, expectedChallenge: p.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
        credential: { id: k.cred_id, publicKey: new Uint8Array(k.public_key), counter: k.counter, transports: k.transports ? JSON.parse(k.transports) : undefined } });
      if (!v.verified) return res.status(400).json({ ok: false });
      db.prepare("UPDATE maker_passkeys SET counter=?, used_at=datetime('now') WHERE id=?").run(v.authenticationInfo.newCounter || 0, k.id);
      setMaker(res, db.prepare('SELECT * FROM makers WHERE id=?').get(k.maker_id)); res.json({ ok: true, to: '/account' });
    } catch (e) { console.error('[passkey]', e.message); res.status(400).json({ ok: false }); }
  });
  app.post('/auth/signout', (req, res) => { res.clearCookie('wm_b'); res.clearCookie('wm_tap'); res.redirect('/signin?out=1'); });
  return { keysOf };
}

module.exports = { mountAuth };
