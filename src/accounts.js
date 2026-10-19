// Maker accounts. Every maker (or an estate) has their own Watermark account: an invitation link
// signs them in (no password to keep), and their dashboard shows what they hold, the jewels of the
// collection, what is selling, and what they have earned from Share it, licenses and prints.
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const A = require('./account-views');

const MULTIPLE = 3; // draft: an archive valued at three times its last twelve months of earnings to the maker

function mountAccounts(app, { db, C, sign, isStudio, studioOnly, slugify, DEFAULT_USES, V, registerWork, upload, ledger, mail }) {
  const fs = require('fs');
  for (const [c, t] of [['invite_token', 'TEXT'], ['share_pct', 'INTEGER NOT NULL DEFAULT 85'], ['kind', "TEXT NOT NULL DEFAULT 'maker'"], ['joined_at', 'TEXT'], ['bio', 'TEXT'], ['place', 'TEXT'], ['site', 'TEXT'], ['instagram', 'TEXT'], ['links', 'TEXT'], ['portrait', 'TEXT'], ['buyer_id', 'INTEGER'], ['standing', "TEXT NOT NULL DEFAULT 'open'"]])
    if (!db.prepare("SELECT 1 FROM pragma_table_info('makers') WHERE name=?").get(c)) db.exec(`ALTER TABLE makers ADD COLUMN ${c} ${t}`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='curated'").get()) db.exec('ALTER TABLE works ADD COLUMN curated INTEGER NOT NULL DEFAULT 0');
  // Stars: the maker's own grade, one to five, as in Lightroom. Five is a jewel. Zero is ungraded.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='stars'").get()) { db.exec('ALTER TABLE works ADD COLUMN stars INTEGER NOT NULL DEFAULT 0'); db.exec('UPDATE works SET stars=5 WHERE curated=1'); }

  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 1000 * 60 * 60 * 24 * 90 };
  // The house, having opened a maker's studio (?maker=handle), stays in it from room to room: the handle is kept
  // in a cookie for the Studio session and read wherever a maker is looked for. A real maker sign-in wins.
  app.use((req, res, next) => { if (req.query && req.query.maker && isStudio(req)) res.cookie('wm_as', String(req.query.maker), { ...cookieOpts, maxAge: 12 * 3600e3 }); next(); });
  const makerOf = req => {
    const c = req.cookies && req.cookies.wm_m;
    if (!c) { const h = isStudio(req) ? (req.query && req.query.maker) || (req.cookies && req.cookies.wm_as) : null; return h ? db.prepare('SELECT * FROM makers WHERE handle=?').get(String(h)) || null : null; }
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
    res.send(A.studioAccounts({ list, base: C.base, notice: req.query.ok, intros: app.locals.introductions ? require('./introductions').introBlock({ list: app.locals.introductions.all(), used: 0, limit: 0, base: C.base, action: '/studio/introductions', studio: true }) : '' }));
  });
  app.post('/studio/accounts', studioOnly, (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 120); if (!name) return res.redirect('/studio/accounts');
    const email = String(req.body.email || '').trim().slice(0, 160) || null;
    let handle = slugify(name), i = 2; while (db.prepare('SELECT 1 FROM makers WHERE handle=?').get(handle)) handle = `${slugify(name)}-${i++}`;
    const kind = ['estate', 'institution', 'gallery'].includes(req.body.kind) ? req.body.kind : 'maker';
    const id = db.prepare('INSERT INTO makers (handle,name,email,house,invite_token,kind) VALUES (?,?,?,?,?,?)').run(handle, name, email, String(req.body.house || '').trim().slice(0, 120) || null, nanoid(32), kind).lastInsertRowid;
    const ins = db.prepare('INSERT OR IGNORE INTO uses (maker_id,key,name,description,term_months,kind,sort,price_cents) VALUES (?,?,?,?,?,?,?,?)');
    DEFAULT_USES.forEach(u => ins.run(id, ...u));
    if (req.body.application) db.prepare("UPDATE applications SET status='invited' WHERE id=?").run(+req.body.application);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(id);
    if (email && req.body.invite !== '0') mail.send({ to: email, subject: 'An invitation to Watermark', feature: null, cta: { label: 'Open your studio', url: inviteLink(m) }, text: `${name.split(' ')[0]},\n\nWe have stood in front of your work, and it is ready to be shown. This is an invitation to hold it on Watermark: fingerprinted on arrival, shown on your own page, collected and licensed at the source, your copyright intact and 85% of every sale yours.\n\nYour studio opens from this link, once, on the device you open it on:\n\n${inviteLink(m)}\n\nAfterwards you sign in with your email. Welcome to the house.` });
    ledger.append(db, 'maker.invited', handle, { application: req.body.application ? +req.body.application : null });
    res.redirect(`/studio/accounts?ok=${encodeURIComponent(`${name} has an account.${email && req.body.invite !== '0' ? ' The invitation is on its way.' : ' Send them their invitation link.'}`)}`);
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
  app.get('/account/logout', (req, res) => res.redirect('/signin')); // signing out is a POST (/signout), never a link a crawler can follow

  // ---------- open a studio: anyone, in a minute ----------
  // A name and an email make a maker. They are signed in at once and can upload; what they publish is
  // their word (the attestation) and the Studio sees every new maker on Accounts, and can hold one.
  app.get('/join', (req, res) => { const m = makerOf(req); if (m) return res.redirect('/account'); res.send(A.join({ err: req.query.err || null, sent: req.query.sent === '1', name: req.query.name || '', email: req.query.email || '' })); });
  // Studios are opened by invitation (Studio → Makers approves an application; the letter opens the studio). The old instant door is closed.
  app.post('/join', (req, res) => res.redirect(303, '/join'));

  // ---------- the maker's profile: who they are, on their page ----------
  const portraits = require('path').join(C.dataDir, 'portraits'); fs.mkdirSync(portraits, { recursive: true });
  app.get('/account/profile', (req, res) => { const m = makerOf(req); if (!m) return res.status(401).send(A.signedOut()); res.send(A.profile({ m, intros: app.locals.introductions ? require('./introductions').introBlock({ list: app.locals.introductions.mine('maker', m.id), used: app.locals.introductions.yearUsed(m).c, limit: app.locals.introductions.MAKER_INTROS_A_YEAR, base: C.base, action: '/account/introductions' }) : '', saved: req.query.ok || null, slug: app.locals.makerSlug ? app.locals.makerSlug(m) : m.handle })); });
  app.post('/account/profile', (req, res, next) => upload().fields([{ name: 'portrait', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, next), async (req, res) => {
    req.file = (req.files && ((req.files.portrait || [])[0] || (req.files.file || [])[0])) || null;
    const m = makerOf(req); if (!m) { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); return res.sendStatus(401); }
    const b = req.body || {}, t = (v, n) => String(v || '').trim().slice(0, n) || null;
    const name = t(b.name, 120) || m.name;
    const site = t(b.site, 200), ig = t(b.instagram, 60);
    // Elsewhere: writing, film, music, a shop; label and address, up to six.
    const links = []; for (let i = 0; i < 6; i++) { const L = t((b.link_label || [])[i], 40), U = t((b.link_url || [])[i], 300); if (L && U && /^https?:\/\//i.test(U)) links.push({ label: L, url: U }); }
    db.prepare('UPDATE makers SET links=? WHERE id=?').run(JSON.stringify(links), m.id);
    db.prepare('UPDATE makers SET name=?, house=?, place=?, bio=?, site=?, instagram=? WHERE id=?').run(name, t(b.house, 120), t(b.place, 120), t(b.bio, 700), site && /^https?:\/\//i.test(site) ? site : site ? 'https://' + site.replace(/^\/+/, '') : null, ig ? ig.replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '') : null, m.id);
    if (req.file) {
      try {
        const sharp = require('sharp'); const out = `${m.handle}-${Date.now()}.jpg`;
        await sharp(req.file.path).rotate().resize(720, 720, { fit: 'cover', position: 'attention' }).jpeg({ quality: 86 }).toFile(require('path').join(portraits, out));
        if (m.portrait && fs.existsSync(require('path').join(portraits, m.portrait))) fs.unlinkSync(require('path').join(portraits, m.portrait));
        db.prepare('UPDATE makers SET portrait=? WHERE id=?').run(out, m.id);
      } catch (e) { /* not an image: ignored */ }
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
    if (b.remove_portrait === '1' && m.portrait) { const f = require('path').join(portraits, m.portrait); if (fs.existsSync(f)) fs.unlinkSync(f); db.prepare('UPDATE makers SET portrait=NULL WHERE id=?').run(m.id); }
    res.redirect('/account/profile?ok=1');
  });
  app.get('/portrait/:handle', (req, res) => {
    const m = db.prepare('SELECT portrait FROM makers WHERE handle=?').get(String(req.params.handle)); if (!m || !m.portrait) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=3600').sendFile(require('path').join(portraits, m.portrait));
  });

  // The Studio may hold a maker (their public works go private) or release them.
  app.post('/studio/accounts/:id/standing', studioOnly, (req, res) => {
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(+req.params.id); if (!m) return res.redirect('/studio/accounts');
    const to = m.standing === 'held' ? 'open' : 'held';
    db.prepare('UPDATE makers SET standing=? WHERE id=?').run(to, m.id);
    if (to === 'held') db.prepare("UPDATE works SET status='hidden' WHERE maker_id=? AND status='held'").run(m.id);
    ledger.append(db, to === 'held' ? 'maker.held' : 'maker.released', m.handle, {});
    res.redirect('/studio/accounts?ok=' + encodeURIComponent(to === 'held' ? `${m.name} is held; their work is private until released.` : `${m.name} is released.`));
  });

  function dashboard(m) {
    const pct = m.share_pct || 85;
    const paid = "l.status IN ('active','expired') AND l.price_cents > 0";
    const works = db.prepare(`SELECT w.id, w.slug, w.title, w.place, w.status, w.curated, w.stars, w.share_cents, w.width, w.height, w.accession, w.bytes,
      (SELECT COALESCE(SUM(l.price_cents),0) FROM licenses l WHERE l.work_id=w.id AND ${paid}) AS gross,
      (SELECT COUNT(*) FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=w.id AND ${paid} AND u.key='social') AS shares,
      (SELECT COUNT(*) FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=w.id AND ${paid} AND u.key!='social') AS licenses,
      (SELECT COALESCE(SUM(count),0) FROM views v WHERE v.work_id=w.id AND v.day >= date('now','-30 day')) AS seen30,
      (SELECT COUNT(*) FROM sightings s WHERE s.work_id=w.id) AS sightings
      FROM works w WHERE w.maker_id=? ORDER BY w.stars DESC, gross DESC, seen30 DESC, w.id`).all(m.id);
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
        value: ttm ? toMaker(ttm) * MULTIPLE : null, tips: app.locals.tipsTo ? toMaker(app.locals.tipsTo(m.id).s) : 0, tipsN: app.locals.tipsTo ? app.locals.tipsTo(m.id).n : 0, royalties: app.locals.royaltiesTo ? app.locals.royaltiesTo(m.id).r : 0, resales: app.locals.royaltiesTo ? app.locals.royaltiesTo(m.id).n : 0 },
      toMaker,
    };
  }
  app.get('/account', (req, res) => {
    const m = whose(req);
    if (!m) return res.status(401).send(A.signedOut());
    const keyedNow = app.locals.makerKeys ? app.locals.makerKeys(m).length > 0 : true;
    res.send(A.dashboard({ ...dashboard(m), keys: app.locals.keys ? app.locals.keys.ofMaker(m) : [], steps: !(req.query.maker && isStudio(req)) && app.locals.steps ? app.locals.steps.of(m, keyedNow) : null, rep: (db.prepare("SELECT g.name FROM representation r JOIN makers g ON g.id=r.gallery_id WHERE r.maker_id=? AND r.status='offered' ORDER BY r.id DESC LIMIT 1").get(m.id) || {}).name || null, edit: (() => { const RG = require('./regard'); const now = RG.standing(db, m.id); const at = [3, 4, 5].map(f => ({ from: f, ...RG.standing(db, m.id, { from: f }) })); const best = at.filter(x => x.n > 0).sort((a, b) => b.standing - a.standing)[0] || null; return { now, at, best: best && best.standing > now.standing ? best : null }; })(), asks: app.locals.requests ? app.locals.requests.waiting(m.id) : 0, claims: app.locals.disputes ? app.locals.disputes.waiting(m.id) : 0, owed: app.locals.payouts ? app.locals.payouts.statement(m).owed : 0, viewing: !!(req.query.maker && isStudio(req)), need: req.query.need, welcome: req.query.welcome === '1', stars: Number(req.query.stars) || null, culled: req.query.culled ? { from: Number(req.query.culled), down: Number(req.query.down) || 0, up: Number(req.query.up) || 0 } : null, keeping: app.locals.keepingOf ? app.locals.keepingOf(m) : null, money: V.money, keyed: app.locals.makerKeys ? app.locals.makerKeys(m).length > 0 : true }));
  });
  // The maker marks the jewels of their gallery; they lead the dashboard.
  app.post('/account/works/:slug/jewel', (req, res) => {
    const m = makerOf(req) || (isStudio(req) && (req.body || {}).maker ? db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.body.maker)) : null);
    if (!m) return res.sendStatus(401);
    const w = db.prepare('SELECT * FROM works WHERE slug=? AND maker_id=?').get(req.params.slug, m.id); if (!w) return res.sendStatus(404);
    db.prepare('UPDATE works SET curated=? WHERE id=?').run(w.curated ? 0 : 1, w.id);
    res.redirect('/account' + ((req.body || {}).maker ? '?maker=' + encodeURIComponent(req.body.maker) : '') + '#w-' + w.slug);
  });

  // ---------- stars and the cull ----------
  // Grade a work. Five stars makes it a jewel; the grade is the maker's, never the public's.
  app.post('/account/works/:slug/stars', (req, res) => {
    const m = makerOf(req) || (isStudio(req) && (req.body || {}).maker ? db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.body.maker)) : null);
    if (!m) return res.sendStatus(401);
    const w = db.prepare('SELECT * FROM works WHERE slug=? AND maker_id=?').get(req.params.slug, m.id); if (!w) return res.sendStatus(404);
    const n = Math.max(0, Math.min(5, Math.round(Number((req.body || {}).n)) || 0));
    db.prepare('UPDATE works SET stars=?, curated=? WHERE id=?').run(n, n === 5 ? 1 : 0, w.id);
    if (req.accepts('json') && !req.accepts('html')) return res.json({ ok: true, stars: n });
    res.format({ json: () => res.json({ ok: true, stars: n }), html: () => res.redirect('/account' + ((req.body || {}).maker ? '?maker=' + encodeURIComponent(req.body.maker) : '') + '#w-' + w.slug) });
  });
  // The cull: keep public from N stars up. Everything below stays held, fingerprinted and registered, but
  // private: proof it exists, out of the way. Works the maker has not yet published are left alone.
  app.post('/account/cull', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const from = Math.max(1, Math.min(5, Math.round(Number((req.body || {}).from)) || 3));
    const down = db.prepare("UPDATE works SET status='hidden' WHERE maker_id=? AND status='held' AND stars>0 AND stars<?").run(m.id, from).changes;
    const up = m.standing === 'held' ? 0 : db.prepare("UPDATE works SET status='held' WHERE maker_id=? AND status='hidden' AND stars>=? AND id IN (SELECT w.id FROM works w JOIN ledger g ON g.subject=w.slug AND g.type='work.published' WHERE w.maker_id=?)").run(m.id, from, m.id).changes;
    ledger.append(db, 'maker.culled', m.handle, { from, down, up });
    res.redirect(`/account?culled=${from}&down=${down}&up=${up}#holdings`);
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
      const full = db.prepare('SELECT accession, sha256, width, height, bytes FROM works WHERE id=?').get(w.id) || {};
      const seq = db.prepare("SELECT seq FROM ledger WHERE type='work.registered' AND subject=? ORDER BY seq DESC LIMIT 1").get(w.slug);
      res.json({ ok: true, slug: w.slug, title: w.title, accession: full.accession || null, fingerprint: full.sha256 ? full.sha256.slice(0, 12) : null, width: full.width, height: full.height, mp: full.width && full.height ? Math.round(full.width * full.height / 1e5) / 10 : null, entry: seq ? seq.seq : null });
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
    if (m.standing === 'held') return res.redirect('/account?need=held#w-' + w.slug);
    db.prepare("UPDATE works SET status='held' WHERE id=?").run(w.id);
    ledger.append(db, 'work.published', w.slug, { maker: m.handle, attested: 'rights and releases' });
    if (app.locals.legal) { try { app.locals.legal.accept('maker', m.id, 'makers', req.ip, w.slug); } catch (e) { console.error('[legal]', e.message); } } // publishing accepts the Maker Agreement
    res.redirect('/account#w-' + w.slug);
  });

  // The maker, or (for the Studio, with ?maker=handle) any maker: the Studio can open every room of a studio.
  const asMaker = req => makerOf(req) || (req.query && req.query.maker && isStudio(req) ? db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.query.maker)) : null);
  return { makerOf, asMaker, setMaker, dashboard, inviteLink, slugify, DEFAULT_USES };
}

module.exports = { mountAccounts, MULTIPLE };
