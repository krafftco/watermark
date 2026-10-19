// Notifications (Will, 18 Oct: "I want to know when an image of mine is licensed"). Three ways to be told, one list:
//   the bell: every notice kept in `notices`, shown at /notices and as a count beside your door in the header;
//   your phone or computer: Web Push (lock-screen notifications from the installed app on iPhone 16.4+, Android, Mac,
//     Windows), one subscription per device in `push_subs`, keys VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY from the
//     environment or, when unset, made once and kept in `settings`;
//   email: the mails the house already sends (Collected, Asked for, cards) stay as they are.
// What you hear about is yours to choose per kind (`notify_prefs`). The notifier listens to the register: every moment
// the house records passes through `ledger.append`, so one listener tells the right person.
const webpush = require('web-push');

const KINDS = {
  licensed: { who: 'maker', label: 'A photograph of yours is collected or licensed', on: true },
  requested: { who: 'maker', label: 'Someone asks to license one', on: true },
  thanks: { who: 'maker', label: 'A thank-you card arrives', on: true },
  hat: { who: 'maker', label: 'Someone tips their hat', on: false },
  bravo: { who: 'maker', label: 'Someone calls Bravo! for one of yours', on: true },
  note: { who: 'maker', label: 'A line in a guest book of yours', on: true },
  bench: { who: 'both', label: 'Someone speaks on the bench under your work, or your wall', on: true },
  paid: { who: 'maker', label: 'You are paid', on: true },
  show: { who: 'maker', label: 'A curator proposes a show, or opens your archive', on: true },
  reviewed: { who: 'buyer', label: 'A maker answers a show you curated', on: true },
  answered: { who: 'buyer', label: 'A maker answers your request', on: true },
  received: { who: 'buyer', label: 'A piece is sent to you', on: true },
  asked: { who: 'buyer', label: 'Someone asks you to pass on a piece you hold', on: true },
  placed: { who: 'buyer', label: 'A sale through your wall', on: true },
};

function mountNotify(app, { db, C, ledger, V, mk, makerOf, buyerOf, fetchImpl }) {
  db.exec(`CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY, maker_id INTEGER, buyer_id INTEGER, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, href TEXT, slug TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), read_at TEXT);
    CREATE INDEX IF NOT EXISTS notices_m ON notices(maker_id, at); CREATE INDEX IF NOT EXISTS notices_b ON notices(buyer_id, at);
    CREATE TABLE IF NOT EXISTS push_subs (id INTEGER PRIMARY KEY, maker_id INTEGER, buyer_id INTEGER, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), last_ok TEXT, fails INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS notify_prefs (owner TEXT NOT NULL, kind TEXT NOT NULL, push INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (owner, kind));
    CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);`);

  // Keys: from the environment, else made once and kept.
  let keys = null;
  function vapid() {
    if (keys) return keys;
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    else {
      const row = db.prepare("SELECT v FROM settings WHERE k='vapid'").get();
      if (row) keys = JSON.parse(row.v);
      else { keys = webpush.generateVAPIDKeys(); db.prepare("INSERT INTO settings (k, v) VALUES ('vapid', ?)").run(JSON.stringify(keys)); }
    }
    webpush.setVapidDetails(`mailto:${process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com'}`, keys.publicKey, keys.privateKey);
    return keys;
  }

  const ownerKeys = ({ maker_id, buyer_id }) => [maker_id ? `m:${maker_id}` : null, buyer_id ? `b:${buyer_id}` : null].filter(Boolean);
  const wants = (owner, kind) => { const r = db.prepare('SELECT push FROM notify_prefs WHERE owner=? AND kind=?').get(owner, kind); return r ? !!r.push : (KINDS[kind] || {}).on !== false; };

  async function push(sub, payload) {
    try {
      vapid();
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 24, urgency: 'normal' });
      db.prepare("UPDATE push_subs SET last_ok=datetime('now'), fails=0 WHERE id=?").run(sub.id); return true;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE id=?').run(sub.id); // the device let it go
      else db.prepare('UPDATE push_subs SET fails=fails+1 WHERE id=?').run(sub.id);
      return false;
    }
  }

  // Tell one person (as a maker, a collector, or both). Kept in the list; pushed to every device they've allowed.
  async function tell({ maker_id = null, buyer_id = null, kind, title, body = '', href = '/notices', slug = null }) {
    if (!maker_id && !buyer_id) return null;
    const r = db.prepare('INSERT INTO notices (maker_id, buyer_id, kind, title, body, href, slug) VALUES (?,?,?,?,?,?,?)').run(maker_id, buyer_id, kind, String(title).slice(0, 140), String(body || '').slice(0, 400), href, slug);
    const owners = ownerKeys({ maker_id, buyer_id });
    if (!owners.some(o => wants(o, kind))) return r.lastInsertRowid;
    const subs = db.prepare(`SELECT * FROM push_subs WHERE ${[maker_id ? 'maker_id=?' : null, buyer_id ? 'buyer_id=?' : null].filter(Boolean).join(' OR ')}`).all(...[maker_id, buyer_id].filter(Boolean));
    const payload = { title, body, url: `${C.base}${href}`, tag: `${kind}-${slug || r.lastInsertRowid}`, icon: '/static/app/icon-192.png', badge: '/static/app/icon-192.png', image: slug ? `${C.base}/img/${slug}/screen` : undefined };
    for (const s of subs) await push(s, payload);
    return r.lastInsertRowid;
  }
  const later = f => setImmediate(() => { Promise.resolve().then(f).catch(e => console.error('[notify]', e.message)); });

  // The register, heard. Each moment worth telling, told to the one it concerns.
  const work = slug => slug ? db.prepare('SELECT * FROM works WHERE slug=?').get(String(slug)) : null;
  const lic = ref => db.prepare('SELECT l.*, u.name AS use_name, u.key AS use_key FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.ref=?').get(String(ref));
  const first = n => String(n || '').split(/\s+/)[0] || 'Someone';
  function heard(type, subject, d = {}) {
    if (type === 'license.granted' && d.paid) later(() => {
      const l = lic(subject), w = work(d.work); if (!l || !w) return;
      const who = l.licensee_company || (l.licensee_name && l.licensee_name !== 'Collector' && l.licensee_name !== 'Buyer' ? first(l.licensee_name) : 'A collector');
      return tell({ maker_id: w.maker_id, kind: 'licensed', slug: w.slug, href: `/account/works/${w.slug}`,
        title: l.use_key === 'social' ? `${V.tidy(w.title)} was collected` : `${V.tidy(w.title)} was licensed`,
        body: `${who}${l.use_key === 'social' ? '' : `, ${l.use_name}`}. ${V.money(l.price_cents)}${l.collector_no ? ` · No. ${l.collector_no}` : ''}.` });
    });
    if (type === 'license.requested') later(() => {
      const l = lic(subject), w = work(d.work); if (!l || !w) return;
      return tell({ maker_id: w.maker_id, kind: 'requested', slug: w.slug, href: `/account/requests/${l.ref}`, title: `Asked for: ${V.tidy(w.title)}`, body: `${l.licensee_company || first(l.licensee_name)} would like it ${String(l.use_name || '').toLowerCase()}. Answer when you can.` });
    });
    if (type === 'thanks.given' && d.work) later(() => {
      const w = work(d.work); if (!w) return;
      return tell({ maker_id: w.maker_id, kind: 'thanks', slug: w.slug, href: '/account/payouts', title: `A thank-you card, ${V.money(d.amount || 0)}`, body: `For ${V.tidy(w.title)}. Yours whole.` });
    });
    if (type === 'work.applauded') later(() => {
      const w = work(subject); if (!w) return;
      return tell({ maker_id: w.maker_id, kind: 'hat', slug: w.slug, href: `/m/${V.makerSlug(mk(w))}/${w.slug}`, title: 'A tip of the hat', body: `For ${V.tidy(w.title)}.` });
    });
    if (type === 'work.bravo') later(() => {
      const w = work(subject); if (!w) return;
      return tell({ maker_id: w.maker_id, kind: 'bravo', slug: w.slug, href: `/m/${V.makerSlug(mk(w))}/${w.slug}`, title: `Bravo! ${V.tidy(w.title)}`, body: 'Someone was moved by it. A bravo is the most a person can give a work here, and they have three a month.' });
    });
    if (type === 'maker.paid') later(() => {
      const m = db.prepare('SELECT * FROM makers WHERE handle=?').get(String(subject)); if (!m) return;
      return tell({ maker_id: m.id, kind: 'paid', href: '/account/payouts', title: `Paid: ${V.money(d.amount || 0)}`, body: d.by === 'pocket' ? 'Into your pocket, to spend in the house.' : 'On its way to your bank.' });
    });
    if (type === 'license.quoted' || type === 'license.declined') later(() => {
      const l = lic(subject); if (!l || !l.buyer_id) return; const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
      return tell({ buyer_id: l.buyer_id, kind: 'answered', slug: w && w.slug, href: `/c/${l.ref}`, title: type === 'license.declined' ? `The maker declined: ${V.tidy(w.title)}` : type === 'license.quoted' ? `The maker said yes: ${V.tidy(w.title)}` : `Granted: ${V.tidy(w.title)}`, body: type === 'license.quoted' ? 'Terms and a payment link are waiting.' : '' });
    });
    if (type === 'license.transferred' && d.how === 'sent') later(() => {
      const l = lic(subject); if (!l || !l.buyer_id) return; const w = work(d.work);
      return tell({ buyer_id: l.buyer_id, kind: 'received', slug: w && w.slug, href: '/yours', title: `${w ? V.tidy(w.title) : 'A photograph'} was sent to you`, body: l.collector_no ? `No. ${l.collector_no}, now in your gallery.` : 'Now in your gallery.' });
    });
    if (type === 'curation.earned') later(() => {
      const l = lic(subject); const via = String(d.via || ''); const h = via.startsWith('hang:') ? db.prepare('SELECT * FROM hangs WHERE slug=?').get(via.slice(5)) : null;
      const bid = h ? h.buyer_id : (via.startsWith('gallery:') ? (db.prepare('SELECT id FROM buyers WHERE code=?').get(via.slice(8)) || {}).id : null); if (!bid) return; const w = work(d.work);
      return tell({ buyer_id: bid, kind: 'placed', slug: w && w.slug, href: '/yours?tab=settings', title: `Placed: ${w ? V.tidy(w.title) : 'a photograph'}`, body: `Collected through ${h ? `your wall, ${h.title}` : 'your gallery'}. ${V.money(d.amount || 0)} in your pocket.` });
    });
  }
  const append = ledger.append;
  ledger.append = function (db_, type, subject, data) { const r = append.apply(this, arguments); try { heard(type, subject, data || {}); } catch (e) { console.error('[notify]', e.message); } return r; };

  // Who is asking: the maker room and the gallery of the person at this device.
  const me = req => { const m = makerOf(req), b = buyerOf(req); return { maker_id: m ? m.id : null, buyer_id: b ? b.id : null, m, b }; };
  const mine = (w, sql = '', args = []) => { const p = [], a = []; if (w.maker_id) { p.push('maker_id=?'); a.push(w.maker_id); } if (w.buyer_id) { p.push('buyer_id=?'); a.push(w.buyer_id); } return p.length ? { where: `(${p.join(' OR ')})${sql}`, args: [...a, ...args] } : null; };
  const unread = w => { const q = mine(w, ' AND read_at IS NULL'); return q ? db.prepare(`SELECT COUNT(*) n FROM notices WHERE ${q.where}`).get(...q.args).n : 0; };
  app.locals.notify = { tell, unread, KINDS, vapid };

  app.get('/api/notices', (req, res) => {
    const w = me(req); const q = mine(w); res.set('Cache-Control', 'no-store');
    if (!q) return res.json({ in: false, unread: 0, items: [] });
    const items = db.prepare(`SELECT id, kind, title, body, href, slug, at, read_at FROM notices WHERE ${q.where} ORDER BY id DESC LIMIT 30`).all(...q.args);
    res.json({ in: true, unread: unread(w), items, key: vapid().publicKey });
  });
  app.get('/notices', (req, res) => {
    const w = me(req); const q = mine(w);
    if (!q) return res.redirect('/signin?next=/notices');
    const items = db.prepare(`SELECT * FROM notices WHERE ${q.where} ORDER BY id DESC LIMIT 100`).all(...q.args);
    const owners = ownerKeys(w);
    const kinds = Object.entries(KINDS).filter(([, k]) => (k.who === 'both' && (w.maker_id || w.buyer_id)) || (k.who === 'maker' && w.maker_id) || (k.who === 'buyer' && w.buyer_id)).map(([key, k]) => ({ key, label: k.label, on: owners.some(o => wants(o, key)) }));
    const devices = db.prepare(`SELECT id, ua, at, last_ok FROM push_subs WHERE ${[w.maker_id ? 'maker_id=?' : null, w.buyer_id ? 'buyer_id=?' : null].filter(Boolean).join(' OR ')} ORDER BY id DESC`).all(...[w.maker_id, w.buyer_id].filter(Boolean));
    res.set('Cache-Control', 'private, no-store');
    // A photograph to stand the page on: the maker's own best, else today's.
    const cover = (w.maker_id && db.prepare("SELECT slug, title FROM works WHERE maker_id=? AND status='held' ORDER BY curated DESC, stars DESC, id LIMIT 1").get(w.maker_id))
      || (app.locals.todays && app.locals.todays()) || db.prepare("SELECT slug, title FROM works WHERE status='held' ORDER BY id LIMIT 1").get() || null;
    res.send(V.noticesPage({ items, kinds, devices, key: vapid().publicKey, name: (w.m && w.m.name) || (w.b && w.b.name) || '', saved: req.query.ok || null, cover, maker: !!w.maker_id }));
    const qr = mine(w, ' AND read_at IS NULL'); db.prepare(`UPDATE notices SET read_at=datetime('now') WHERE ${qr.where}`).run(...qr.args);
  });
  app.post('/notices/subscribe', (req, res) => {
    const w = me(req); if (!w.maker_id && !w.buyer_id) return res.status(401).json({ ok: false });
    const s = req.body && req.body.subscription; const k = s && s.keys;
    if (!s || !/^https:\/\//.test(String(s.endpoint || '')) || !k || !k.p256dh || !k.auth) return res.status(400).json({ ok: false });
    db.prepare('INSERT INTO push_subs (maker_id, buyer_id, endpoint, p256dh, auth, ua) VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET maker_id=excluded.maker_id, buyer_id=excluded.buyer_id, p256dh=excluded.p256dh, auth=excluded.auth, ua=excluded.ua, fails=0')
      .run(w.maker_id, w.buyer_id, String(s.endpoint).slice(0, 1000), String(k.p256dh).slice(0, 200), String(k.auth).slice(0, 100), String(req.headers['user-agent'] || '').slice(0, 200));
    later(() => tell({ ...w, kind: 'welcome', title: 'Watermark will tell you here', body: 'When a photograph of yours is collected or licensed, and whatever else you choose.', href: '/notices' }));
    res.json({ ok: true });
  });
  app.post('/notices/unsubscribe', (req, res) => {
    const w = me(req); const ep = String((req.body && req.body.endpoint) || '');
    if (ep) db.prepare('DELETE FROM push_subs WHERE endpoint=? AND (maker_id IS ? OR buyer_id IS ?)').run(ep, w.maker_id, w.buyer_id);
    else if (req.body && req.body.id) db.prepare('DELETE FROM push_subs WHERE id=? AND (maker_id=? OR buyer_id=?)').run(+req.body.id, w.maker_id || -1, w.buyer_id || -1);
    if (req.accepts('html') && !req.is('json')) return res.redirect('/notices?ok=' + encodeURIComponent('That device will no longer be told.'));
    res.json({ ok: true });
  });
  app.post('/notices/prefs', (req, res) => {
    const w = me(req); const owners = ownerKeys(w); if (!owners.length) return res.sendStatus(401);
    const on = new Set([].concat((req.body && req.body.on) || []));
    for (const [key, k] of Object.entries(KINDS)) for (const o of owners) if (k.who === 'both' || (k.who === 'maker' && o[0] === 'm') || (k.who === 'buyer' && o[0] === 'b'))
      db.prepare('INSERT INTO notify_prefs (owner, kind, push) VALUES (?,?,?) ON CONFLICT(owner, kind) DO UPDATE SET push=excluded.push').run(o, key, on.has(key) ? 1 : 0);
    res.redirect('/notices?ok=' + encodeURIComponent('Saved.'));
  });
  app.post('/notices/test', async (req, res) => {
    const w = me(req); if (!w.maker_id && !w.buyer_id) return res.status(401).json({ ok: false });
    await tell({ ...w, kind: 'test', title: 'A test from the house', body: 'This is how Watermark will reach you.', href: '/notices' });
    res.json({ ok: true });
  });
  return app.locals.notify;
}

module.exports = { mountNotify, KINDS };
