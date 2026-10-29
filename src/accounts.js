// Maker accounts. Every maker (or an estate) has their own Watermark account: an invitation link
// signs them in (no password to keep), and their dashboard shows what they hold, the jewels of the
// collection, what is selling, and what they have earned from Share it, licenses and prints.
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const A = require('./account-views');

const MULTIPLE = 3; // draft: an archive valued at three times its last twelve months of earnings to the maker

function mountAccounts(app, { db, C, sign, isStudio, studioOnly, slugify, DEFAULT_USES, V, registerWork, upload, ledger, mail }) {
  const fs = require('fs');
  for (const [c, t] of [['invite_token', 'TEXT'], ['share_pct', 'INTEGER NOT NULL DEFAULT 85'], ['kind', "TEXT NOT NULL DEFAULT 'maker'"], ['joined_at', 'TEXT'], ['bio', 'TEXT'], ['place', 'TEXT'], ['site', 'TEXT'], ['instagram', 'TEXT'], ['emails', 'TEXT'], ['links', 'TEXT'], ['portrait', 'TEXT'], ['buyer_id', 'INTEGER'], ['standing', "TEXT NOT NULL DEFAULT 'open'"]])
    if (!db.prepare("SELECT 1 FROM pragma_table_info('makers') WHERE name=?").get(c)) db.exec(`ALTER TABLE makers ADD COLUMN ${c} ${t}`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='curated'").get()) db.exec('ALTER TABLE works ADD COLUMN curated INTEGER NOT NULL DEFAULT 0');
  // Stars: the maker's own grade, one to five, as in Lightroom. Five is a jewel. Zero is ungraded.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='stars'").get()) { db.exec('ALTER TABLE works ADD COLUMN stars INTEGER NOT NULL DEFAULT 0'); db.exec('UPDATE works SET stars=5 WHERE curated=1'); }

  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 1000 * 60 * 60 * 24 * 90 };
  // The house, having opened a maker's studio (?maker=handle), stays in it from room to room: the handle is kept
  // in a cookie for the Studio session and read wherever a maker is looked for. A real maker sign-in wins.
  app.use((req, res, next) => { if (req.query && req.query.maker && isStudio(req)) res.cookie('wm_as', String(req.query.maker), { ...cookieOpts, maxAge: 12 * 3600e3 }); next(); });
  const makerOf = req => {
    if (req.wmPush) return req.wmPush; // a computer's key (push.js), on the vault's import doors only
    const c = req.cookies && req.cookies.wm_m;
    if (!c) { const h = isStudio(req) ? (req.query && req.query.maker) || (req.cookies && req.cookies.wm_as) || (C.maker && C.maker.handle) : null; if (h) return db.prepare('SELECT * FROM makers WHERE handle=?').get(String(h)) || null; if (app.locals.institutions && req.cookies && req.cookies.wm_staff) { try { return app.locals.institutions.actingFor(req); } catch (e) { return null; } } return null; }
    const [id, exp, mac] = String(c).split('.');
    if (Date.now() > +exp) return null;
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(+id); if (!m) return null;
    return mac === sign(`m${id}.${exp}${m.sess ? '.' + m.sess : ''}`) ? m : null; // the session generation (devices.js) is in the signature
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
    res.send(A.studioAccounts({ list, base: C.base, notice: req.query.ok, week: app.locals.firstWeek ? m => app.locals.firstWeek.line(m) : null, asks: app.locals.houseAsksBlock ? app.locals.houseAsksBlock() : '', intros: app.locals.introductions ? require('./introductions').introBlock({ list: app.locals.introductions.all(), used: 0, limit: 0, base: C.base, action: '/studio/introductions', studio: true }) : '' }));
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
    if (email && req.body.invite !== '0') mail.send({ to: email, subject: 'An invitation to Watermark', feature: null, cta: { label: 'Open your studio', url: inviteLink(m) }, text: `${name.split(' ')[0]},\n\nWe have stood in front of your work, and it is ready to be shown. This is an invitation to hold it on Watermark: fingerprinted on arrival, shown on your own page, collected and licensed at the source, your copyright intact and ${require('./fee').yours(85)}.\n\nYour studio opens from this link, once, on the device you open it on:\n\n${inviteLink(m)}\n\nAfterwards you sign in with your email. Welcome to the house.` });
    ledger.append(db, 'maker.invited', handle, { application: req.body.application ? +req.body.application : null });
    res.redirect(`/studio/accounts?ok=${encodeURIComponent(`${name} has an account.${email && req.body.invite !== '0' ? ' The invitation is on its way.' : ' Send them their invitation link.'}`)}`);
  });
  app.post('/studio/accounts/:id/link', studioOnly, (req, res) => { // a fresh link, e.g. for a new device
    db.prepare('UPDATE makers SET invite_token=? WHERE id=?').run(nanoid(32), +req.params.id);
    res.redirect('/studio/accounts?ok=' + encodeURIComponent('A new sign-in link is ready.'));
  });

  // ---------- the maker side ----------
  const setMaker = (res, m) => { const exp = String(Date.now() + cookieOpts.maxAge); res.cookie('wm_m', `${m.id}.${exp}.${sign(`m${m.id}.${exp}${m.sess ? '.' + m.sess : ''}`)}`, cookieOpts); };
  app.get('/account/join/:token', (req, res) => {
    const m = db.prepare('SELECT * FROM makers WHERE invite_token=?').get(String(req.params.token));
    if (!m) return res.status(404).send(A.gone());
    db.prepare("UPDATE makers SET invite_token=NULL, joined_at=COALESCE(joined_at, datetime('now')) WHERE id=?").run(m.id);
    setMaker(res, m);
    if (app.locals.devices) app.locals.devices.seen(req, res, { buyer: null, maker: m, how: 'the invitation' });
    const none = m.kind === 'maker' && !db.prepare('SELECT 1 FROM works WHERE maker_id=? LIMIT 1').get(m.id);
    res.redirect(none ? '/account/upload?welcome=1' : '/account'); // the first week (26 Oct): a new maker lands in the vault, not on a desk
  });
  app.get('/account/logout', (req, res) => res.redirect('/signin')); // signing out is a POST (/signout), never a link a crawler can follow

  // ---------- open a studio: anyone, in a minute ----------
  // A name and an email make a maker. They are signed in at once and can upload; what they publish is
  // their word (the attestation) and the Studio sees every new maker on Accounts, and can hold one.
  app.get('/join', (req, res) => { const m = makerOf(req); if (m) return res.redirect('/account'); if (app.locals.museums && req.query.sent !== '1') return res.send(V.layout({ title: 'Open your museum · Watermark', desc: 'Put your work in, keep all of it, hang the best: your own museum, under your name.', path: '/join', body: require('./museums').joinPage({ esc: V.esc, base: C.base, err: req.query.err || null }) })); res.send(A.join({ err: req.query.err || null, sent: req.query.sent === '1', name: req.query.name || '', email: req.query.email || '' })); });
  // Studios are opened by invitation (Studio → Makers approves an application; the letter opens the studio). The old instant door is closed.
  app.post('/join', (req, res) => res.redirect(303, '/join'));

  // ---------- the maker's profile: who they are, on their page ----------
  const portraits = require('path').join(C.dataDir, 'portraits'); fs.mkdirSync(portraits, { recursive: true });
  app.get('/account/profile', (req, res) => { const m = makerOf(req); if (!m) return res.status(401).send(A.signedOut()); res.send(A.profile({ m, intros: app.locals.introductions ? require('./introductions').introBlock({ list: app.locals.introductions.mine('maker', m.id), used: app.locals.introductions.yearUsed(m).c, limit: app.locals.introductions.MAKER_INTROS_A_YEAR, base: C.base, action: '/account/introductions' }) : '', saved: req.query.ok || null, slug: app.locals.makerSlug ? app.locals.makerSlug(m) : m.handle })); });
  app.post('/account/profile', (req, res, next) => upload().fields([{ name: 'portrait', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, next), (req, res, next) => app.locals.bagcheck.gate('image')(req, res, next), async (req, res) => {
    req.file = (req.files && ((req.files.portrait || [])[0] || (req.files.file || [])[0])) || null;
    const m = makerOf(req); if (!m) { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); return res.sendStatus(401); }
    const b = req.body || {}, t = (v, n) => String(v || '').trim().slice(0, n) || null;
    const name = t(b.name, 120) || m.name;
    const site = t(b.site, 200), ig = t(b.instagram, 60);
    // Other addresses that open this studio (Will, 23 Oct: the gmail is the collector's door, the Krafft address the maker's; one person, two doors).
    const emails = String(b.emails || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) && x !== String(m.email || '').toLowerCase()).slice(0, 5).join(', ');
    if (emails !== String(m.emails || '')) { // another door to the studio opened or closed (27 Oct): said by letter to the address of record
      if (m.email && mail && mail.on()) mail.send({ to: m.email, subject: emails ? 'Another address can now open your studio' : 'Your studio opens by one address again', cta: { label: 'Your devices', url: `${C.base}/yours/devices` }, text: `${m.name.split(' ')[0]},\n\n${emails ? `These addresses can now open your studio on Watermark as you:\n\n    ${emails.split(', ').join('\n    ')}\n\nbeside ${m.email}.` : `Only ${m.email} opens your studio now; the other addresses were taken off.`}\n\nIf you did not do this, open Your devices and press Sign out everywhere, then write to the house.\n\n${C.base}/yours/devices\n\nWatermark, a Krafft company` }).catch(() => {});
    }
    db.prepare('UPDATE makers SET emails=? WHERE id=?').run(emails, m.id);
    // Elsewhere: writing, film, music, a shop; label and address, up to six.
    const links = []; for (let i = 0; i < 6; i++) { const L = t((b.link_label || [])[i], 40), U = t((b.link_url || [])[i], 300); if (L && U && /^https?:\/\//i.test(U)) links.push({ label: L, url: U }); }
    db.prepare('UPDATE makers SET links=? WHERE id=?').run(JSON.stringify(links), m.id);
    db.prepare('UPDATE makers SET name=?, house=?, place=?, bio=?, site=?, instagram=? WHERE id=?').run(name, t(b.house, 120), t(b.place, 120), t(b.bio, 700), site && /^https?:\/\//i.test(site) ? site : site ? 'https://' + site.replace(/^\/+/, '') : null, ig ? ig.replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '') : null, m.id);
    if (req.file) {
      try {
        const sharp = require('sharp'); const out = `${m.handle}-${Date.now()}.jpg`;
        await sharp(req.file.path).rotate().resize(720, 720, { fit: 'cover', position: 'attention' }).jpeg({ quality: 86 }).toFile(require('path').join(portraits, out));
        await sharp(req.file.path).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toFile(require('path').join(portraits, out.replace(/\.jpg$/, '-tall.jpg'))); // the whole portrait, its own shape (20 Oct)
        if (m.portrait && fs.existsSync(require('path').join(portraits, m.portrait))) fs.unlinkSync(require('path').join(portraits, m.portrait));
        db.prepare('UPDATE makers SET portrait=? WHERE id=?').run(out, m.id);
      } catch (e) { /* not an image: ignored */ }
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
    if (b.remove_portrait === '1' && m.portrait) { const f = require('path').join(portraits, m.portrait); if (fs.existsSync(f)) fs.unlinkSync(f); db.prepare('UPDATE makers SET portrait=NULL WHERE id=?').run(m.id); }
    res.redirect('/account/profile?ok=1');
  });
  // The house's own portrait ships with the code (Will, 20 Oct: "this needs to be my portrait on Krafft and Watermark
  // right now"): public/house/portrait.jpg is set as the house maker's portrait when none is set.
  app.locals.seedPortrait = async () => {
    try {
      const src = require('path').join(__dirname, '..', 'public', 'house', 'portrait.jpg'); if (!fs.existsSync(src)) return;
      const house = db.prepare('SELECT * FROM makers WHERE handle=?').get(C.maker.handle); if (!house || (house.portrait && fs.existsSync(require('path').join(portraits, house.portrait)))) return;
      const sharp = require('sharp'); const out = `${house.handle}-house.jpg`;
      await sharp(src).rotate().resize(720, 720, { fit: 'cover', position: 'attention' }).jpeg({ quality: 86 }).toFile(require('path').join(portraits, out));
      await sharp(src).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toFile(require('path').join(portraits, out.replace(/\.jpg$/, '-tall.jpg')));
      db.prepare('UPDATE makers SET portrait=? WHERE id=?').run(out, house.id); console.log('[portrait] the house\'s portrait is set');
    } catch (e) { console.error('[portrait]', e.message); }
  };
  setTimeout(() => app.locals.seedPortrait(), 3000).unref();
  app.get('/portrait/:handle', (req, res) => {
    const m = db.prepare('SELECT portrait FROM makers WHERE handle=?').get(String(req.params.handle)); if (!m || !m.portrait) return res.sendStatus(404);
    const tall = req.query.tall === '1' ? require('path').join(portraits, m.portrait.replace(/\.jpg$/, '-tall.jpg')) : null;
    res.set('Cache-Control', 'public, max-age=3600').sendFile(tall && fs.existsSync(tall) ? tall : require('path').join(portraits, m.portrait));
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
    const recent = db.prepare(`SELECT l.ref, l.price_cents, l.house_cents, l.starts_at, u.name AS use_name, u.key, w.title, w.slug FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id
      WHERE w.maker_id=? AND ${paid} ORDER BY l.starts_at DESC LIMIT 20`).all(m.id);
    const sum = (sql, ...a) => db.prepare(sql).get(...a).v || 0;
    const FEE = require('./fee'); const MK = FEE.sqlMaker(pct);
    const gross = sum(`SELECT SUM(${MK}) v FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND ${paid}`, m.id);
    const gross30 = sum(`SELECT SUM(${MK}) v FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND ${paid} AND l.starts_at >= datetime('now','-30 day')`, m.id);
    const ttm = sum(`SELECT SUM(${MK}) v FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND ${paid} AND l.starts_at >= datetime('now','-365 day')`, m.id);
    const today = db.prepare(`SELECT COALESCE(SUM(${MK}),0) v, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND ${paid} AND date(l.starts_at) = date('now')`).get(m.id);
    const month = db.prepare(`SELECT COALESCE(SUM(${MK}),0) v, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND ${paid} AND strftime('%Y-%m', l.starts_at) = strftime('%Y-%m','now')`).get(m.id);
    const toMaker = c => Math.round(c * pct / 100); const own = c => c; // gross, gross30 and ttm are already the maker's side
    return {
      m, pct, works, byUse, recent, multiple: MULTIPLE,
      jewels: works.filter(w => w.curated),
      totals: { works: works.length, public: works.filter(w => w.status === 'held').length, jewels: works.filter(w => w.curated).length,
        earned: own(gross), earned30: own(gross30), ttm: own(ttm), today: today.v, todayN: today.n, month: month.v, monthN: month.n, bank: !!m.stripe_account, shares: byUse.filter(u => u.key === 'social').reduce((a, u) => a + u.n, 0),
        value: ttm ? own(ttm) * MULTIPLE : null, tips: app.locals.tipsTo ? toMaker(app.locals.tipsTo(m.id).s) : 0, tipsN: app.locals.tipsTo ? app.locals.tipsTo(m.id).n : 0, royalties: app.locals.royaltiesTo ? app.locals.royaltiesTo(m.id).r : 0, resales: app.locals.royaltiesTo ? app.locals.royaltiesTo(m.id).n : 0 },
      toMaker,
    };
  }
  app.get('/account', (req, res) => {
    const m = whose(req);
    if (!m) return res.status(401).send(A.signedOut());
    const keyedNow = app.locals.makerKeys ? app.locals.makerKeys(m).length > 0 : true;
    // The gallery's and the institution's desk (25 Oct): the same shell, the role deciding the rows.
    let role = null;
    try {
      const n = (sql, ...p) => { try { return db.prepare(sql).get(...p).n || 0; } catch (e) { return 0; } };
      if (m.kind === 'gallery') role = { kind: 'gallery', represents: n("SELECT COUNT(*) n FROM representation WHERE gallery_id=? AND status='on'", m.id), offered: n("SELECT COUNT(*) n FROM representation WHERE gallery_id=? AND status='offered'", m.id), shows: (app.locals.galleries ? app.locals.galleries.shows(m) : []).length, cuts: n("SELECT COALESCE(SUM(cents),0) n FROM gallery_cuts WHERE gallery_id=?", m.id), cutsMonth: n("SELECT COALESCE(SUM(cents),0) n FROM gallery_cuts WHERE gallery_id=? AND strftime('%Y-%m', at)=strftime('%Y-%m','now')", m.id) };
      if (m.kind === 'institution') role = { kind: 'institution', rights: app.locals.rights ? app.locals.rights.waiting(m.id) : 0, team: n('SELECT COUNT(*) n FROM institution_staff WHERE maker_id=?', m.id), open: n("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held' AND open IS NOT NULL", m.id), imports: n('SELECT COUNT(*) n FROM iiif_imports WHERE maker_id=?', m.id), rightsOpen: !!m.rights_open };
    } catch (e) { role = null; }
    res.send(A.dashboard({ ...dashboard(m), role, almanack: (() => { try { const AL = app.locals.almanack; if (!AL) return null; const y = String(new Date().getFullYear()); return { y, has: !!AL.existing(m, y) }; } catch (e) { return null; } })(), ok: req.query.ok || null, batch: app.locals.batch && !(req.query.maker && isStudio(req)) ? app.locals.batch.bar({ action: '/account/works/batch' }) : '', way: app.locals.wayIn && !(req.query.maker && isStudio(req)) ? app.locals.wayIn(m, req.query.ok) : '', keys: app.locals.keys ? app.locals.keys.ofMaker(m) : [], steps: !(req.query.maker && isStudio(req)) && app.locals.steps ? app.locals.steps.of(m, keyedNow) : null, rep: (db.prepare("SELECT g.name FROM representation r JOIN makers g ON g.id=r.gallery_id WHERE r.maker_id=? AND r.status='offered' ORDER BY r.id DESC LIMIT 1").get(m.id) || {}).name || null, edit: (() => { const RG = require('./regard'); const now = RG.standing(db, m.id); const at = [3, 4, 5].map(f => ({ from: f, ...RG.standing(db, m.id, { from: f }) })); const best = at.filter(x => x.n > 0).sort((a, b) => b.standing - a.standing)[0] || null; return { now, at, best: best && best.standing > now.standing ? best : null }; })(), asks: app.locals.requests ? app.locals.requests.waiting(m.id) : 0, claims: app.locals.disputes ? app.locals.disputes.waiting(m.id) : 0, pairs: app.locals.pairs ? app.locals.pairs.waiting(m.id) : 0, owed: app.locals.payouts ? app.locals.payouts.statement(m).owed : 0, viewing: !!(req.query.maker && isStudio(req)), need: req.query.need, welcome: req.query.welcome === '1', stars: Number(req.query.stars) || null, culled: req.query.culled ? { from: Number(req.query.culled), down: Number(req.query.down) || 0, up: Number(req.query.up) || 0 } : null, keeping: app.locals.keepingOf ? app.locals.keepingOf(m) : null, money: V.money, keyed: app.locals.makerKeys ? app.locals.makerKeys(m).length > 0 : true }));
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
  app.get('/account/upload', (req, res) => { const m = makerOf(req); if (!m) return res.status(401).send(A.signedOut()); res.send(A.upload({ m, signLine: app.locals.signRelease ? app.locals.signRelease.line() : '', welcome: req.query.welcome === 'own' || req.query.welcome === '1' })); });
  // One file into a maker's vault (shared by the one-request route and the arrivals queue): registered as the
  // maker's work, held privately, with its title (from the file name unless given), place and kind.
  async function takeWork(file, { originalname, title, place, kind, artist, makerId }) {
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(makerId); if (!m) { try { fs.unlinkSync(file); } catch (e) { /* gone */ } return { ok: false, error: 'No such maker.' }; }
    let rawIn = null;
    try {
      // The raw door (26 Oct): a DNG's full-size preview is taken as the master; the DNG is kept as the negative.
      if (app.locals.raw) { rawIn = app.locals.raw.unwrap(file, originalname); if (rawIn) { file = rawIn.file; originalname = rawIn.originalname; } }
      const name = String(originalname || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
      // A better file for a work the maker already holds becomes its master (app.js upgradeIfHeld); a smaller one is declined with the record named.
      if (app.locals.upgradeIfHeld) { await app.locals.bagcheck.throwIfBad(file, { name: originalname || require('path').basename(file), where: 'takeWork', who: `m:${m.handle}` }); const up = await app.locals.upgradeIfHeld(file, originalname, m.id); if (up) { if (!up.ok) return up; const wf = db.prepare('SELECT * FROM works WHERE id=(SELECT id FROM works WHERE slug=?)').get(up.slug); const full = wf || {}; const seq = db.prepare("SELECT seq FROM ledger WHERE type='work.master' AND subject=? ORDER BY seq DESC LIMIT 1").get(up.slug); return { ok: true, outcome: 'master', slug: up.slug, title: up.title, note: `Now the master of ${up.title}: held at ${up.mp} megapixels. The record, the deed and every licence stay as they were.`, yours: app.locals.yours && wf ? app.locals.yours(wf, m) : null, deed: `/w/${up.slug}/deed`, accession: full.accession || null, fingerprint: up.fingerprint, width: up.width, height: up.height, mp: up.mp, entry: seq ? seq.seq : null }; } }
      const w = await registerWork({ file, originalName: originalname, title: String(title || '').trim(), fallbackTitle: name || 'Untitled', place: String(place || '').trim() || null, makerId: m.id, kind: String(kind || 'photograph'), artist: String(artist || '').trim() || null });
      db.prepare("UPDATE works SET status='hidden', credit=COALESCE(credit, ?) WHERE id=?").run(m.name, w.id);
      if (rawIn) await app.locals.raw.keep(w.slug, rawIn.dng, rawIn.originalname.replace(/\.jpg$/, '.dng'));
      const full = db.prepare('SELECT accession, sha256, width, height, bytes FROM works WHERE id=?').get(w.id) || {};
      const seq = db.prepare("SELECT seq FROM ledger WHERE type='work.registered' AND subject=? ORDER BY seq DESC LIMIT 1").get(w.slug);
      const wf = db.prepare('SELECT * FROM works WHERE id=?').get(w.id);
      return { ok: true, outcome: 'work', slug: w.slug, title: w.title, yours: app.locals.yours ? app.locals.yours(wf, m) : null, deed: `/w/${w.slug}/deed`, accession: full.accession || null, fingerprint: full.sha256 ? full.sha256.slice(0, 12) : null, width: full.width, height: full.height, mp: full.width && full.height ? Math.round(full.width * full.height / 1e6) : null, entry: seq ? seq.seq : null };
    } catch (e) {
      try { fs.unlinkSync(file); } catch (x) { /* gone */ }
      if (rawIn) { try { fs.unlinkSync(rawIn.dng); } catch (x) { /* gone */ } }
      return { ok: false, status: e.user ? 409 : 400, error: e.user ? e.message : 'Could not be read as a photograph.' };
    }
  }
  app.locals.takeWork = (file, a) => takeWork(file, { originalname: a.name, title: a.title, place: a.place, kind: a.kind, artist: a.artist, makerId: a.maker_id });
  app.post('/account/works/one', (req, res, next) => upload().single('file')(req, res, next), (req, res, next) => app.locals.bagcheck.gate('image', { json: true })(req, res, next), async (req, res) => {
    const m = makerOf(req); if (!m) { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); return res.status(401).json({ ok: false }); }
    if (!req.file) return res.status(400).json({ ok: false, error: 'Not an image file.' });
    const r = await takeWork(req.file.path, { originalname: req.file.originalname, title: req.body.title, place: req.body.place, kind: req.body.kind, artist: req.body.artist, makerId: m.id });
    return res.status(r.ok ? 200 : r.status || 400).json(r);
    try {
      const name = req.file.originalname.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
      const w = await registerWork({ file: req.file.path, originalName: req.file.originalname, title: String(req.body.title || '').trim() || name || 'Untitled', place: String(req.body.place || '').trim() || null, makerId: m.id, kind: String(req.body.kind || 'photograph') });
      db.prepare("UPDATE works SET status='hidden', credit=COALESCE(credit, ?) WHERE id=?").run(m.name, w.id);
      const full = db.prepare('SELECT accession, sha256, width, height, bytes FROM works WHERE id=?').get(w.id) || {};
      const seq = db.prepare("SELECT seq FROM ledger WHERE type='work.registered' AND subject=? ORDER BY seq DESC LIMIT 1").get(w.slug);
      const wf = db.prepare('SELECT * FROM works WHERE id=?').get(w.id);
      res.json({ ok: true, slug: w.slug, title: w.title, yours: app.locals.yours ? app.locals.yours(wf, m) : null, deed: `/w/${w.slug}/deed`, accession: full.accession || null, fingerprint: full.sha256 ? full.sha256.slice(0, 12) : null, width: full.width, height: full.height, mp: full.width && full.height ? Math.round(full.width * full.height / 1e5) / 10 : null, entry: seq ? seq.seq : null });
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
    if (app.locals.mayHang && !app.locals.mayHang(m)) return res.redirect('/account?need=wall#w-' + w.slug);
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
