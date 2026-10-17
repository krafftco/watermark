// Maker accounts. Every maker (or an estate) has their own Watermark account: an invitation link
// signs them in (no password to keep), and their dashboard shows what they hold, the jewels of the
// collection, what is selling, and what they have earned from Share it, licenses and prints.
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const A = require('./account-views');

const MULTIPLE = 3; // draft: an archive valued at three times its last twelve months of earnings to the maker

function mountAccounts(app, { db, C, sign, isStudio, studioOnly, slugify, DEFAULT_USES, V, registerWork, upload, ledger }) {
  const fs = require('fs');
  for (const [c, t] of [['invite_token', 'TEXT'], ['share_pct', 'INTEGER NOT NULL DEFAULT 85'], ['kind', "TEXT NOT NULL DEFAULT 'maker'"], ['joined_at', 'TEXT']])
    if (!db.prepare("SELECT 1 FROM pragma_table_info('makers') WHERE name=?").get(c)) db.exec(`ALTER TABLE makers ADD COLUMN ${c} ${t}`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='curated'").get()) db.exec('ALTER TABLE works ADD COLUMN curated INTEGER NOT NULL DEFAULT 0');

  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 1000 * 60 * 60 * 24 * 90 };
  const makerOf = req => {
    const c = req.cookies && req.cookies.wm_m; if (!c) return null;
    const [id, exp, mac] = String(c).split('.');
    if (mac !== sign(`m${id}.${exp}`) || Date.now() > +exp) return null;
    return db.prepare('SELECT * FROM makers WHERE id=?').get(+id) || null;
  };
  // Will (the Studio) can open any maker's dashboard to see what they see.
  const whose = req => {
    if (req.query.maker && isStudio(req)) return db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.query.maker));
    return makerOf(req);
  };

  function inviteLink(m) { return `${C.base}/account/join/${m.invite_token}`; }

  // ---------- the Studio side: invite a maker or an estate ----------
  app.get('/studio/accounts', studioOnly, (req, res) => {
    const list = db.prepare(`SELECT m.*, (SELECT COUNT(*) FROM works w WHERE w.maker_id=m.id) AS works FROM makers m ORDER BY m.id`).all();
    res.send(A.studioAccounts({ list, base: C.base, notice: req.query.ok }));
  });
  app.post('/studio/accounts', studioOnly, (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 120); if (!name) return res.redirect('/studio/accounts');
    const email = String(req.body.email || '').trim().slice(0, 160) || null;
    let handle = slugify(name), i = 2; while (db.prepare('SELECT 1 FROM makers WHERE handle=?').get(handle)) handle = `${slugify(name)}-${i++}`;
    const kind = req.body.kind === 'estate' ? 'estate' : 'maker';
    const id = db.prepare('INSERT INTO makers (handle,name,email,house,invite_token,kind) VALUES (?,?,?,?,?,?)').run(handle, name, email, String(req.body.house || '').trim().slice(0, 120) || null, nanoid(32), kind).lastInsertRowid;
    const ins = db.prepare('INSERT OR IGNORE INTO uses (maker_id,key,name,description,term_months,kind,sort,price_cents) VALUES (?,?,?,?,?,?,?,?)');
    DEFAULT_USES.forEach(u => ins.run(id, ...u));
    if (req.body.application) db.prepare("UPDATE applications SET status='invited' WHERE id=?").run(+req.body.application);
    res.redirect(`/studio/accounts?ok=${encodeURIComponent(`${name} has an account. Send them their invitation link.`)}`);
  });
  app.post('/studio/accounts/:id/link', studioOnly, (req, res) => { // a fresh link, e.g. for a new device
    db.prepare('UPDATE makers SET invite_token=? WHERE id=?').run(nanoid(32), +req.params.id);
    res.redirect('/studio/accounts?ok=' + encodeURIComponent('A new sign-in link is ready.'));
  });

  // ---------- the maker side ----------
  const setMaker = (res, m) => { const exp = String(Date.now() + cookieOpts.maxAge); res.cookie('wm_m', `${m.id}.${exp}.${sign(`m${m.id}.${exp}`)}`, cookieOpts); };
  app.get('/account/join/:token', (req, res) => {
    const m = db.prepare('SELECT * FROM makers WHERE invite_token=?').get(String(req.params.token));
    if (!m) return res.status(404).send(A.gone());
    const exp = String(Date.now() + cookieOpts.maxAge);
    db.prepare("UPDATE makers SET invite_token=NULL, joined_at=COALESCE(joined_at, datetime('now')) WHERE id=?").run(m.id);
    res.cookie('wm_m', `${m.id}.${exp}.${sign(`m${m.id}.${exp}`)}`, cookieOpts);
    res.redirect('/account');
  });
  app.get('/account/logout', (req, res) => { res.clearCookie('wm_m'); res.redirect('/'); });

  function dashboard(m) {
    const pct = m.share_pct || 85;
    const paid = "l.status IN ('active','expired') AND l.price_cents > 0";
    const works = db.prepare(`SELECT w.id, w.slug, w.title, w.place, w.status, w.curated, w.share_cents, w.width, w.height, w.accession,
      (SELECT COALESCE(SUM(l.price_cents),0) FROM licenses l WHERE l.work_id=w.id AND ${paid}) AS gross,
      (SELECT COUNT(*) FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=w.id AND ${paid} AND u.key='social') AS shares,
      (SELECT COUNT(*) FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=w.id AND ${paid} AND u.key!='social') AS licenses,
      (SELECT COALESCE(SUM(count),0) FROM views v WHERE v.work_id=w.id AND v.day >= date('now','-30 day')) AS seen30,
      (SELECT COUNT(*) FROM sightings s WHERE s.work_id=w.id) AS sightings
      FROM works w WHERE w.maker_id=? ORDER BY w.curated DESC, gross DESC, seen30 DESC, w.id`).all(m.id);
    const byUse = db.prepare(`SELECT u.key, u.name, u.kind, COUNT(l.id) AS n, COALESCE(SUM(l.price_cents),0) AS gross FROM uses u
      LEFT JOIN licenses l ON l.use_id=u.id AND ${paid} WHERE u.maker_id=? GROUP BY u.id ORDER BY u.sort`).all(m.id);
    const recent = db.prepare(`SELECT l.ref, l.price_cents, l.starts_at, u.name AS use_name, u.key, w.title, w.slug FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id
      WHERE w.maker_id=? AND ${paid} ORDER BY l.starts_at DESC LIMIT 20`).all(m.id);
    const sum = (sql, ...a) => db.prepare(sql).get(...a).v || 0;
    const gross = sum(`SELECT SUM(l.price_cents) v FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND ${paid}`, m.id);
    const gross30 = sum(`SELECT SUM(l.price_cents) v FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND ${paid} AND l.starts_at >= datetime('now','-30 day')`, m.id);
    const ttm = sum(`SELECT SUM(l.price_cents) v FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND ${paid} AND l.starts_at >= datetime('now','-365 day')`, m.id);
    const toMaker = c => Math.round(c * pct / 100);
    return {
      m, pct, works, byUse, recent, multiple: MULTIPLE,
      jewels: works.filter(w => w.curated),
      totals: { works: works.length, public: works.filter(w => w.status === 'held').length, jewels: works.filter(w => w.curated).length,
        earned: toMaker(gross), earned30: toMaker(gross30), ttm: toMaker(ttm), shares: byUse.filter(u => u.key === 'social').reduce((a, u) => a + u.n, 0),
        value: ttm ? toMaker(ttm) * MULTIPLE : null },
      toMaker,
    };
  }
  app.get('/account', (req, res) => {
    const m = whose(req);
    if (!m) return res.status(401).send(A.signedOut());
    res.send(A.dashboard({ ...dashboard(m), viewing: !!(req.query.maker && isStudio(req)), need: req.query.need, money: V.money, keyed: app.locals.makerKeys ? app.locals.makerKeys(m).length > 0 : true }));
  });
  // The maker marks the jewels of their collection; they lead the dashboard.
  app.post('/account/works/:slug/jewel', (req, res) => {
    const m = makerOf(req) || (isStudio(req) && (req.body || {}).maker ? db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.body.maker)) : null);
    if (!m) return res.sendStatus(401);
    const w = db.prepare('SELECT * FROM works WHERE slug=? AND maker_id=?').get(req.params.slug, m.id); if (!w) return res.sendStatus(404);
    db.prepare('UPDATE works SET curated=? WHERE id=?').run(w.curated ? 0 : 1, w.id);
    res.redirect('/account' + ((req.body || {}).maker ? '?maker=' + encodeURIComponent(req.body.maker) : '') + '#w-' + w.slug);
  });

  // ---------- the maker's own uploads: private until they publish ----------
  app.get('/account/upload', (req, res) => { const m = makerOf(req); if (!m) return res.status(401).send(A.signedOut()); res.send(A.upload({ m })); });
  app.post('/account/works/one', (req, res, next) => upload().single('file')(req, res, next), async (req, res) => {
    const m = makerOf(req); if (!m) { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); return res.status(401).json({ ok: false }); }
    if (!req.file) return res.status(400).json({ ok: false, error: 'Not an image file.' });
    try {
      const name = req.file.originalname.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
      const w = await registerWork({ file: req.file.path, originalName: req.file.originalname, title: String(req.body.title || '').trim() || name || 'Untitled', place: String(req.body.place || '').trim() || null, makerId: m.id });
      db.prepare("UPDATE works SET status='hidden', credit=COALESCE(credit, ?) WHERE id=?").run(m.name, w.id);
      res.json({ ok: true, slug: w.slug, title: w.title });
    } catch (e) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(e.user ? 409 : 400).json({ ok: false, error: e.user ? e.message : 'Could not be read as a photograph.' });
    }
  });
  // Publishing is the maker's word that they hold the rights, and releases for anyone identifiable.
  app.post('/account/works/:slug/show', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const w = db.prepare('SELECT * FROM works WHERE slug=? AND maker_id=?').get(req.params.slug, m.id); if (!w) return res.sendStatus(404);
    if (w.status === 'held') { db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(w.id); return res.redirect('/account#w-' + w.slug); }
    if ((req.body || {}).attest !== '1') return res.redirect('/account?need=attest#w-' + w.slug);
    db.prepare("UPDATE works SET status='held' WHERE id=?").run(w.id);
    ledger.append(db, 'work.published', w.slug, { maker: m.handle, attested: 'rights and releases' });
    res.redirect('/account#w-' + w.slug);
  });

  return { makerOf, setMaker, dashboard, inviteLink };
}

module.exports = { mountAccounts, MULTIPLE };
