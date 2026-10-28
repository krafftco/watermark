// Your devices (27 Oct, from docs/SECURITY.md 'next in code'): every sign-in is a device the house remembers, a letter
// goes out when a new one appears, and a person can see the list and sign one out, or all of them at once. The lever
// for 'everywhere' is a generation on the person (buyers.sess, makers.sess) folded into the cookie's signature, so a
// bump voids every cookie ever issued, including ones made before this room existed; a single device is ended by its
// row (`wm_d`), which the gate below checks on every request. A collector and a maker are one person with two doors,
// so the list shows both and 'everywhere' bumps both. The letter: a device the house has not seen for this person
// (by its name, 'Safari on iPhone') inside 180 days, after the first. Nothing of a device is told to anyone else.
'use strict';
const crypto = require('crypto');

function nameOf(ua) {
  ua = String(ua || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'a device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Watermark|wm-app/i.test(ua) ? 'the app' : 'a browser';
  return `${br} on ${os}`;
}
const maskIp = ip => { ip = String(ip || ''); if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + ':…'; const p = ip.split('.'); return p.length === 4 ? `${p[0]}.${p[1]}.…` : ip; };

function mountDevices(app, { db, C, V, mail, ledger }) {
  db.exec(`CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY, buyer_id INTEGER, maker_id INTEGER, token TEXT UNIQUE NOT NULL, name TEXT, ua TEXT, ip TEXT, how TEXT,
    first_at TEXT NOT NULL DEFAULT (datetime('now')), last_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT)`);
  db.exec('CREATE INDEX IF NOT EXISTS devices_buyer ON devices (buyer_id); CREATE INDEX IF NOT EXISTS devices_maker ON devices (maker_id)');
  for (const t of ['buyers', 'makers']) if (!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name='sess'`).get()) db.exec(`ALTER TABLE ${t} ADD COLUMN sess INTEGER NOT NULL DEFAULT 0`);
  const opts = { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 365 * 864e5 };
  const esc = V.esc;
  const touched = new Map(); // token → last touch (ms), so last_at is written at most every ten minutes

  // The gate: a device signed out by its row is out on its next request, whatever its cookies say.
  app.use((req, res, next) => {
    const t = req.cookies && req.cookies.wm_d; if (!t) return next();
    const d = db.prepare('SELECT id, ended_at FROM devices WHERE token=?').get(String(t));
    if (!d || d.ended_at) {
      for (const c of ['wm_b', 'wm_m', 'wm_as', 'wm_s', 'wm_d', 'wm_tap', 'wm_staff']) { res.clearCookie(c); if (req.cookies) delete req.cookies[c]; }
      return next();
    }
    const now = Date.now(); if ((touched.get(t) || 0) < now - 600e3) { touched.set(t, now); db.prepare("UPDATE devices SET last_at=datetime('now') WHERE id=?").run(d.id); }
    next();
  });

  // A sign-in landed: remember the device, write when it is new.
  function seen(req, res, { buyer, maker, how }) {
    try {
      const ua = String(req.headers['user-agent'] || '').slice(0, 300), name = nameOf(ua), ip = req.ip || '';
      const token = crypto.randomBytes(24).toString('base64url');
      const bid = buyer ? buyer.id : null, mid = maker ? maker.id : null;
      const mine = db.prepare('SELECT * FROM devices WHERE (buyer_id=? AND ? IS NOT NULL) OR (maker_id=? AND ? IS NOT NULL) ORDER BY id').all(bid, bid, mid, mid);
      const known = mine.some(d => d.name === name && d.last_at > new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 19).replace('T', ' '));
      db.prepare('INSERT INTO devices (buyer_id, maker_id, token, name, ua, ip, how) VALUES (?,?,?,?,?,?,?)').run(bid, mid, token, name, ua, ip, how || null);
      res.cookie('wm_d', token, opts);
      const email = (maker && maker.email) || (buyer && buyer.email) || null;
      if (mine.length && !known && email && mail.on()) {
        const first = ((maker && maker.name) || (buyer && buyer.name) || '').split(' ')[0];
        mail.send({ to: email, subject: 'A new sign-in to Watermark', cta: { label: 'Your devices', url: `${C.base}/yours/devices` },
          text: `${first ? `${first},\n\n` : ''}Someone signed in to Watermark as you just now, from ${name} we had not seen before (address ${maskIp(ip)}, ${new Date().toUTCString()}).\n\nIf that was you, there is nothing to do.\n\nIf it was not, open Your devices and press Sign out everywhere; every other device is out at once, and only a fresh code to your email can get back in.\n\n${C.base}/yours/devices\n\nWatermark, a Krafft company` }).catch(e => console.error('[devices] letter', e.message));
      }
      return token;
    } catch (e) { console.error('[devices]', e.message); return null; }
  }
  const forOwner = (b, m) => db.prepare('SELECT * FROM devices WHERE ended_at IS NULL AND ((buyer_id=? AND ? IS NOT NULL) OR (maker_id=? AND ? IS NOT NULL)) ORDER BY last_at DESC').all(b ? b.id : null, b ? b.id : null, m ? m.id : null, m ? m.id : null);
  const linkedMaker = b => (b && ((b.email && db.prepare('SELECT * FROM makers WHERE lower(email)=lower(?)').get(b.email)) || db.prepare('SELECT * FROM makers WHERE buyer_id=?').get(b.id))) || null;
  const linkedBuyer = m => (m && ((m.buyer_id && db.prepare('SELECT * FROM buyers WHERE id=?').get(m.buyer_id)) || (m.email && db.prepare('SELECT * FROM buyers WHERE lower(email)=lower(?)').get(m.email)))) || null;
  const whoAmI = req => { const b = app.locals.buyerOf(req), m = app.locals.accounts.makerOf(req); return { b: b || linkedBuyer(m), m: m || linkedMaker(b) }; };
  const ago = s => { const d = (Date.now() - new Date(s.replace(' ', 'T') + 'Z').getTime()) / 1000; return d < 90 ? 'just now' : d < 3600 ? `${Math.round(d / 60)} min ago` : d < 86400 ? `${Math.round(d / 3600)} h ago` : d < 30 * 86400 ? `${Math.round(d / 86400)} d ago` : s.slice(0, 10); };

  const page = (req, res) => {
    const { b, m } = whoAmI(req); if (!b && !m) return res.redirect('/signin?next=/yours/devices');
    const cur = req.cookies && req.cookies.wm_d; const rows = forOwner(b, m); const ok = String(req.query.ok || '');
    res.send(V.layout({ title: 'Your devices · Watermark', path: '/yours/devices', body: `<section class="cx-intro dvs"><p class="k">Your house</p><h1>Your devices.</h1>
<p class="lede">Every phone and computer signed in as you. The house writes to you when a new one appears. Sign one out, or everything at once: this device stays, every other is out on its next move, and only a fresh code to your email gets back in.</p>
${ok === 'all' ? '<p class="ok">Signed out everywhere else. This device stays.</p>' : ok === 'one' ? '<p class="ok">Signed out.</p>' : ''}
${rows.length ? `<table class="tbl dvs-t"><thead><tr><th>Device</th><th>Signed in</th><th>Last seen</th><th></th></tr></thead><tbody>${rows.map(d => `<tr${d.token === cur ? ' class="dvs-me"' : ''}><td><b>${esc(d.name || 'a device')}</b>${d.token === cur ? ' <small>· this one</small>' : ''}<br><small>${esc(maskIp(d.ip))}${d.how ? ` · by ${esc(d.how)}` : ''}</small></td><td>${esc(d.first_at.slice(0, 10))}</td><td>${esc(ago(d.last_at))}</td><td>${d.token === cur ? '' : `<form method="post" action="/yours/devices/${d.id}/end"><button class="link">Sign out</button></form>`}</td></tr>`).join('')}</tbody></table>` : '<p class="yc-shelf">Only sign-ins from today onward are listed; earlier ones are covered by Sign out everywhere.</p>'}
<form method="post" action="/yours/devices/all" class="dvs-all"><button class="buy-btn">Sign out everywhere else</button></form>
<p class="hg-share"><a href="/yours?tab=settings">Settings</a> · <a href="/signin/hand?next=/yours/devices">Hand it to my phone</a></p></section>` }));
  };
  app.get('/yours/devices', page); app.get('/account/devices', page);

  app.post('/yours/devices/:id/end', (req, res) => {
    const { b, m } = whoAmI(req); if (!b && !m) return res.sendStatus(401);
    const d = db.prepare('SELECT * FROM devices WHERE id=?').get(+req.params.id);
    if (!d || !((b && d.buyer_id === b.id) || (m && d.maker_id === m.id))) return res.sendStatus(404);
    db.prepare("UPDATE devices SET ended_at=datetime('now') WHERE id=?").run(d.id);
    ledger.append(db, 'device.ended', `buyer-${b ? b.id : 0}`, { one: true });
    res.redirect('/yours/devices?ok=one');
  });
  // Everywhere else: the generation on the person moves, every old cookie dies, this device is re-issued.
  app.post('/yours/devices/all', (req, res) => {
    const { b, m } = whoAmI(req); if (!b && !m) return res.sendStatus(401);
    const cur = req.cookies && req.cookies.wm_d;
    if (b) db.prepare('UPDATE buyers SET sess=sess+1 WHERE id=?').run(b.id);
    if (m) db.prepare('UPDATE makers SET sess=sess+1 WHERE id=?').run(m.id);
    db.prepare("UPDATE devices SET ended_at=datetime('now') WHERE ended_at IS NULL AND token<>? AND ((buyer_id=? AND ? IS NOT NULL) OR (maker_id=? AND ? IS NOT NULL))").run(String(cur || ''), b ? b.id : null, b ? b.id : null, m ? m.id : null, m ? m.id : null);
    const fb = b && db.prepare('SELECT * FROM buyers WHERE id=?').get(b.id), fm = m && db.prepare('SELECT * FROM makers WHERE id=?').get(m.id);
    if (app.locals.isStudio && app.locals.isStudio(req)) { app.locals.studioBump(); app.locals.openStudio(res); } // the house's own door too
    if (fb) app.locals.setBuyer(res, fb, !!fb.pm);
    if (fm && app.locals.accounts.makerOf(req)) app.locals.accounts.setMaker(res, fm);
    if (!cur) seen(req, res, { buyer: fb, maker: fm, how: 'kept' });
    ledger.append(db, 'device.ended', `buyer-${b ? b.id : 0}`, { all: true });
    res.redirect('/yours/devices?ok=all');
  });

  app.locals.devices = { seen, forOwner, nameOf };
  return app.locals.devices;
}
module.exports = { mountDevices, nameOf };
