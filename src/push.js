// Push (29 Oct, Will: "let's start development; by using my archive as what we build it from"). The engine of the Mac
// app, first as a command (bin/watermark.js): it walks a folder, culls by the stars Lightroom wrote, fingerprints every
// file, asks the house what it already holds, and sends the rest in parts through the same doors as the vault page,
// as one import with its receipt. This file is the house's side: how a computer is let in, and how it is let out.
//
// The door is the phone hand-off's: the command asks for a pairing (POST /api/push/begin → a short code and a page),
// the person opens the page where they are already signed in and says yes (/push), and the command, polling, is given a
// key once (wmk_…), kept on that computer; the house keeps only its hash. A key opens only the vault's import doors
// (/account/arrivals, /account/imports) for that maker, never a page, money or a setting. It is listed on /account/push
// and ended there, or by 'Sign out everywhere' (the maker's session generation is folded into the key's row).
'use strict';
const crypto = require('crypto');

const CODE = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels, no look-alikes
const DOORS = /^\/account\/(arrivals|imports)(\/|$)/;
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function mountPush(app, { db, C, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS push_pairs (id INTEGER PRIMARY KEY, code TEXT NOT NULL, device_hash TEXT NOT NULL, name TEXT, status TEXT NOT NULL DEFAULT 'asked',
    maker_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), answered_at TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS push_keys (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, key_hash TEXT UNIQUE NOT NULL, name TEXT, sess INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), last_at TEXT, last_ip TEXT, sent INTEGER NOT NULL DEFAULT 0, ended_at TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS push_pairs_code ON push_pairs (code)');
  const esc = V.esc;
  const makerOf = req => (app.locals.accounts ? app.locals.accounts.makerOf(req) : null);
  const touched = new Map();

  // The key, on the import doors only. A wrong or ended key is a plain 401, so the command can say so.
  app.use((req, res, next) => {
    const h = req.get('authorization') || ''; const m0 = /^Bearer (wmk_[A-Za-z0-9_-]{20,})$/.exec(h);
    if (!m0) return next();
    if (!DOORS.test(req.path)) return res.status(403).json({ ok: false, error: 'This key opens only the vault.' });
    const k = db.prepare('SELECT * FROM push_keys WHERE key_hash=?').get(hash(m0[1]));
    const m = k && !k.ended_at ? db.prepare('SELECT * FROM makers WHERE id=?').get(k.maker_id) : null;
    if (!m || (m.sess || 0) !== (k.sess || 0) || m.standing === 'held') return res.status(401).json({ ok: false, error: 'This computer has been signed out. Run: watermark login' });
    req.wmPush = m; req.wmPushKey = k;
    const now = Date.now(); if ((touched.get(k.id) || 0) < now - 60000) { touched.set(k.id, now); db.prepare("UPDATE push_keys SET last_at=datetime('now'), last_ip=? WHERE id=?").run(String(req.ip || '').slice(0, 60), k.id); }
    if (req.method === 'POST' && /\/arrivals\/start$/.test(req.path)) db.prepare('UPDATE push_keys SET sent=sent+1 WHERE id=?').run(k.id);
    next();
  });

  // The command asks. Ten minutes to answer; a code is good once.
  app.post('/api/push/begin', (req, res) => {
    const device = crypto.randomBytes(24).toString('base64url');
    let code = ''; for (let i = 0; i < 8; i++) code += CODE[crypto.randomInt(CODE.length)];
    const name = String((req.body || {}).name || 'a computer').replace(/[^\w .'’()-]+/g, '').slice(0, 60) || 'a computer';
    db.prepare('INSERT INTO push_pairs (code, device_hash, name) VALUES (?,?,?)').run(code, hash(device), name);
    res.json({ ok: true, device, code: `${code.slice(0, 4)}-${code.slice(4)}`, url: `${C.base}/push?code=${code}`, every: 3 });
  });
  app.post('/api/push/poll', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const p = db.prepare("SELECT * FROM push_pairs WHERE device_hash=? AND created_at > datetime('now','-10 minutes')").get(hash((req.body || {}).device || ''));
    if (!p) return res.status(404).json({ ok: false, error: 'That pairing has run out. Run: watermark login' });
    if (p.status === 'asked') return res.json({ ok: true, waiting: true });
    if (p.status !== 'yes') return res.status(403).json({ ok: false, error: p.status === 'claimed' ? 'This pairing was already used.' : 'Not allowed.' });
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(p.maker_id);
    const key = 'wmk_' + crypto.randomBytes(30).toString('base64url');
    db.prepare("UPDATE push_pairs SET status='claimed' WHERE id=?").run(p.id);
    db.prepare('INSERT INTO push_keys (maker_id, key_hash, name, sess) VALUES (?,?,?,?)').run(m.id, hash(key), p.name, m.sess || 0);
    res.json({ ok: true, key, maker: { name: m.name, handle: m.handle }, house: C.base });
  });

  const live = code => db.prepare("SELECT * FROM push_pairs WHERE code=? AND status='asked' AND created_at > datetime('now','-10 minutes')").get(String(code || '').toUpperCase().replace(/[^A-Z]/g, ''));
  const page = (title, inner) => V.layout({ title: `${title} · Watermark`, path: '/push', studio: true, body: `<section class="studio-wrap psh">${inner}</section>` });
  app.get('/push', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    const p = live(req.query.code);
    if (!p) return res.send(page('Send from your computer', `<p class="k">Your vault</p><h1>That code has run out.</h1><p class="lede">Run <code>watermark login</code> again on your computer; a code is good for ten minutes, once.</p><p><a href="/account/push">The computers that can send to your vault</a></p>`));
    res.send(page('Let this computer send', `<p class="k">Your vault</p><h1>Let ${esc(p.name)} send to your vault?</h1>
<p class="lede">The code on your computer should read <b class="psh-code">${esc(p.code.slice(0, 4))}-${esc(p.code.slice(4))}</b>. If it does not, close this page.</p>
<p>It will be able to put work into your vault, as ${esc(m.name)}, and nothing else: no pages, no money, no settings. What it sends comes in private, as from the vault page. You can end it any time from <a href="/account/push">your computers</a>.</p>
<form method="post" action="/push/answer" class="psh-acts"><input type="hidden" name="code" value="${esc(p.code)}"><button class="btn" name="yes" value="1">Yes, let it send</button> <button class="btn ghost" name="yes" value="0">No</button></form>`));
  });
  app.post('/push/answer', (req, res) => {
    const m = makerOf(req); if (!m) return res.status(401).send(page('Sign in', '<h1>Sign in first.</h1>'));
    const p = live(req.body.code); if (!p) return res.redirect('/push?code=x');
    const yes = req.body.yes === '1';
    db.prepare("UPDATE push_pairs SET status=?, maker_id=?, answered_at=datetime('now') WHERE id=?").run(yes ? 'yes' : 'no', m.id, p.id);
    res.send(page(yes ? 'Allowed' : 'Not allowed', yes ? `<p class="k">Your vault</p><h1>Done. Go back to your computer.</h1><p class="lede">${esc(p.name)} can send to your vault now. It is listed with <a href="/account/push">your computers</a>.</p>` : `<h1>Not allowed.</h1><p class="lede">Nothing was given to ${esc(p.name)}.</p>`));
  });

  // The list: every computer that can send, what it sent, when it was last seen; end one.
  app.get('/account/push', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/push');
    const keys = db.prepare('SELECT * FROM push_keys WHERE maker_id=? AND ended_at IS NULL ORDER BY id DESC').all(m.id).filter(k => (k.sess || 0) === (m.sess || 0));
    res.send(page('Your computers', `<p class="k"><a href="/account">Your studio</a></p><h1>Send from your computer.</h1>
<p class="lede">For a whole archive: a folder or a drive, sent overnight, culled by the stars you gave it in Lightroom, every file fingerprinted and checked when it lands, never sent twice. One file, no install beyond Node.</p>
<pre class="psh-pre">curl -fsSLo watermark.js ${esc(C.base)}/push/watermark.js
node watermark.js login
node watermark.js push ~/Pictures/Exports/Philadelphia --place Philadelphia --stars 3</pre>
<p class="muted"><code>--dry</code> says what would go and sends nothing. Stop it any time; run the same line again and it carries on where it stopped. The full guide: <code>node watermark.js help</code>.</p>
<h2>The computers that can send to your vault</h2>
<ol class="psh-list">${keys.map(k => `<li><b>${esc(k.name || 'a computer')}</b><span>since ${esc(k.created_at.slice(0, 10))}${k.last_at ? ` · last seen ${esc(k.last_at.slice(0, 16))}` : ''} · ${k.sent} file${k.sent === 1 ? '' : 's'} sent</span><form method="post" action="/account/push/${k.id}/end"><button class="btn ghost">End it</button></form></li>`).join('') || '<li class="muted">None yet.</li>'}</ol>`));
  });
  app.post('/account/push/:id/end', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    db.prepare("UPDATE push_keys SET ended_at=datetime('now') WHERE id=? AND maker_id=?").run(+req.params.id, m.id);
    res.redirect('/account/push');
  });
  app.get('/push/watermark.js', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300'); res.type('application/javascript');
    res.sendFile(require('path').join(__dirname, '..', 'bin', 'watermark.js'));
  });
  return { hash };
}

module.exports = { mountPush };
