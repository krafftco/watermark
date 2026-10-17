// Watermark: hold, show, license. One Express app.
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { open } = require('./db');
const ledger = require('./ledger');
const images = require('./images');
const V = require('./views');
const R = require('./rules');
const SEAL = require('./seal');
const { createStore } = require('./storage');
const S = require('./studio-views');
const prov = require('./provenance');
const mail = require('./mail');

// [key, name, description, term months, kind, sort, default price in cents (null = ask privately)]
const DEFAULT_USES = [
  ['social', 'Share it', 'Post it on your own accounts: Instagram, a story, X, your lock screen. Personal, not for a business; tag the maker.', null, 'license', 0, 500],
  ['editorial', 'In a story', 'A feature, a book, an essay or a report, with the maker named beside it.', 12, 'license', 1, 35000],
  ['commercial', 'For a company', 'The face of a website, a presentation, a letter to investors. Non-exclusive.', 12, 'license', 2, 75000],
  ['campaign', 'Before an audience', 'A campaign, a film, a billboard, a package. Non-exclusive; exclusivity on request.', 12, 'license', 3, 250000],
  ['print', 'On a wall', 'An archival print, signed by the photographer, to live with for good.', null, 'print', 4, 25000],
];

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'work';
}

function createApp(cfg = {}) {
  const C = {
    dataDir: cfg.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
    base: (cfg.base || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    adminPassword: cfg.adminPassword || process.env.ADMIN_PASSWORD || '',
    secret: cfg.secret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    stripeKey: cfg.stripeKey !== undefined ? cfg.stripeKey : process.env.STRIPE_SECRET_KEY,
    // Public by design: lets the page open Apple Pay / Google Pay / Link in place.
    stripePk: cfg.stripePk !== undefined ? cfg.stripePk : process.env.STRIPE_PUBLISHABLE_KEY,
    webhookSecret: cfg.webhookSecret !== undefined ? cfg.webhookSecret : process.env.STRIPE_WEBHOOK_SECRET,
    maker: cfg.maker || { handle: process.env.MAKER_HANDLE || 'krafft', name: process.env.MAKER_NAME || 'Will Fullerton', house: process.env.MAKER_HOUSE || 'Krafft Studios', email: process.env.MAKER_EMAIL || 'will@krafftco.com' },
  };
  const db = open(path.join(C.dataDir, 'watermark.db'));
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='renewal_sent_at'").get()) db.exec('ALTER TABLE licenses ADD COLUMN renewal_sent_at TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='renews'").get()) db.exec('ALTER TABLE licenses ADD COLUMN renews TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='conditions'").get()) db.exec('ALTER TABLE licenses ADD COLUMN conditions TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='set_ref'").get()) db.exec('ALTER TABLE licenses ADD COLUMN set_ref TEXT'); // bought together as a set
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='rules'").get()) db.exec('ALTER TABLE works ADD COLUMN rules TEXT');
  // Buyers who chose one-tap: Stripe customer and saved payment method, nothing else.
  // Editions: what a collector has printed, and works passed from one collector to another.
  db.exec(`CREATE TABLE IF NOT EXISTS prints (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, size TEXT, paper TEXT, made TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS transfers (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, from_buyer INTEGER, to_buyer INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), claimed_at TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS buyers (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, pm TEXT, email TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  // Collectors: every purchase is numbered and hangs in the buyer's own collection.
  for (const [t, c, d] of [['licenses', 'buyer_id', 'INTEGER'], ['licenses', 'collector_no', 'INTEGER'], ['buyers', 'code', 'TEXT'], ['buyers', 'name', 'TEXT'], ['buyers', 'public', 'INTEGER NOT NULL DEFAULT 0']])
    if (!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name=?`).get(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`);
  // Catalogue fields, kept the way a museum keeps a record: an accession number, medium, keywords, credit line.
  for (const [c, t] of [['accession', 'TEXT'], ['medium', 'TEXT'], ['keywords', 'TEXT'], ['credit', 'TEXT'], ['dhash', 'TEXT'], ['master_at', 'TEXT'], ['share_cents', 'INTEGER'], ['edition_size', 'INTEGER']])
    if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  // A photograph may carry its own Share it price; otherwise the maker's standard one.
  // A limited edition: the maker sets how many can ever be collected. Numbers are never reused.
  const edition = w => { if (!w || !w.edition_size) return null; const sold = db.prepare("SELECT COUNT(*) n FROM licenses WHERE work_id=? AND collector_no IS NOT NULL AND status IN ('active','expired')").get(w.id).n; return { size: w.edition_size, sold, left: Math.max(0, w.edition_size - sold) }; };
  // Checkouts still open (under 30 minutes) hold their number, so two buyers can't both take the last one.
  const soldOut = w => { const e = edition(w); if (!e) return false; const held = db.prepare("SELECT COUNT(*) n FROM licenses WHERE work_id=? AND status='awaiting_payment' AND created_at > datetime('now','-30 minutes')").get(w.id).n; return e.left - held <= 0; };
  // Founding Collectors: the first hundred people to collect on Watermark, numbered in the order they arrived.
  const FOUNDING = 100;
  const foundingNo = b => { if (!b) return null; const rows = db.prepare("SELECT buyer_id FROM licenses WHERE buyer_id IS NOT NULL AND collector_no IS NOT NULL AND status IN ('active','expired') GROUP BY buyer_id ORDER BY MIN(starts_at), buyer_id LIMIT ?").all(FOUNDING); const i = rows.findIndex(r => r.buyer_id === b.id); return i < 0 ? null : i + 1; };
  const foundingLeft = () => Math.max(0, FOUNDING - db.prepare("SELECT COUNT(DISTINCT buyer_id) n FROM licenses WHERE buyer_id IS NOT NULL AND collector_no IS NOT NULL AND status IN ('active','expired')").get().n);
  const priced = (u, w) => (u && w && u.key === 'social' && w.share_cents ? { ...u, price_cents: w.share_cents } : u);
  const accession = w => `WM.${String(w.created_at || new Date().toISOString()).slice(0, 4)}.${String(w.id).padStart(4, '0')}`;
  for (const w of db.prepare('SELECT id, created_at FROM works WHERE accession IS NULL').all()) db.prepare('UPDATE works SET accession=? WHERE id=?').run(accession(w), w.id);
  const stripe = cfg.stripeClient || (C.stripeKey ? require('stripe')(C.stripeKey) : null);
  const originals = path.join(C.dataDir, 'originals'); // a cache when the vault is S3
  const store = cfg.store || createStore({ bucket: cfg.bucket !== undefined ? cfg.bucket : process.env.S3_BUCKET, region: process.env.AWS_REGION, endpoint: process.env.S3_ENDPOINT, vaultKey: cfg.vaultKey !== undefined ? cfg.vaultKey : process.env.VAULT_KEY, localRoot: path.join(C.dataDir, 'vault') });
  // The original, from the local cache or, if this server is new, from the vault.
  async function originalPath(w) {
    const p = path.join(originals, w.original_file);
    if (fs.existsSync(p)) return p;
    const buf = await store.get('originals/' + w.original_file);
    if (!buf) throw new Error('Original missing from the vault: ' + w.original_file);
    fs.writeFileSync(p, buf); return p;
  }
  // Database backups: a consistent copy of SQLite, written to the vault.
  async function backupDb() {
    const tmp = path.join(C.dataDir, 'backup.tmp.db');
    await db.backup(tmp);
    const key = `backups/db/watermark-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    await store.put(key, tmp, 'application/x-sqlite3'); fs.unlinkSync(tmp);
    return key;
  }
  const cache = path.join(C.dataDir, 'cache');
  fs.mkdirSync(originals, { recursive: true });

  // The house maker (single-maker mode for v0; the schema is multi-maker).
  function ensureMaker(m) {
    let row = db.prepare('SELECT * FROM makers WHERE handle=?').get(m.handle);
    if (!row) {
      const id = db.prepare('INSERT INTO makers (handle,name,email,house) VALUES (?,?,?,?)').run(m.handle, m.name, m.email, m.house).lastInsertRowid;
      const ins = db.prepare('INSERT INTO uses (maker_id,key,name,description,term_months,kind,sort,price_cents) VALUES (?,?,?,?,?,?,?,?)');
      DEFAULT_USES.forEach(u => ins.run(id, ...u));
      row = db.prepare('SELECT * FROM makers WHERE id=?').get(id);
    }
    // Uses added since the maker joined (e.g. Share it) arrive at their default price.
    const add = db.prepare('INSERT OR IGNORE INTO uses (maker_id,key,name,description,term_months,kind,sort,price_cents) VALUES (?,?,?,?,?,?,?,?)');
    DEFAULT_USES.forEach(u => add.run(row.id, ...u));
    return row;
  }
  const maker = ensureMaker(C.maker);
  // Each work belongs to its maker; pages, prices, licenses and emails follow the work.
  const mk = w => (w && w.maker_id && w.maker_id !== maker.id ? db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id) : null) || maker;

  const q = {
    work: db.prepare("SELECT * FROM works WHERE slug=?"),
    publicWorks: db.prepare("SELECT * FROM works WHERE status='held' ORDER BY id DESC"),
    allWorks: db.prepare('SELECT * FROM works ORDER BY id DESC'),
    uses: db.prepare('SELECT * FROM uses WHERE maker_id=? ORDER BY sort'),
    use: db.prepare('SELECT * FROM uses WHERE maker_id=? AND key=?'),
    useById: db.prepare('SELECT * FROM uses WHERE id=?'),
    lic: db.prepare('SELECT * FROM licenses WHERE ref=?'),
    licFull: db.prepare('SELECT l.*, w.title, w.slug, u.name AS use_name, u.kind, u.term_months FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE l.ref=?'),
    licList: db.prepare('SELECT l.*, w.title, u.name AS use_name FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id ORDER BY l.id DESC LIMIT ?'),
    lastEntryFor: db.prepare("SELECT * FROM ledger WHERE subject=? ORDER BY seq DESC LIMIT 1"),
  };

  function nextRef() {
    const y = new Date().getUTCFullYear();
    const n = db.prepare("SELECT COUNT(*) AS n FROM licenses WHERE ref LIKE ?").get(`WM-${y}-%`).n + 1;
    return `WM-${y}-${String(n).padStart(6, '0')}`;
  }

  function grant(ref, extra = {}) {
    const l = q.lic.get(ref);
    if (!l || l.status === 'active') return l;
    const u = q.useById.get(l.use_id);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    const maker = mk(w); // the work's own maker
    const start = new Date();
    const end = u.term_months ? new Date(start.getTime()) : null;
    if (end) end.setUTCMonth(end.getUTCMonth() + u.term_months);
    const token = u.kind === 'print' ? null : nanoid(32);
    db.prepare("UPDATE licenses SET status='active', starts_at=?, ends_at=?, download_token=?, price_cents=COALESCE(?, price_cents), updated_at=datetime('now') WHERE ref=?")
      .run(start.toISOString(), end ? end.toISOString() : null, token, extra.price_cents ?? null, ref);
    // Collector No. n of this work: numbers are never reused, so an early number stays early.
    if (extra.paid) db.prepare('UPDATE licenses SET collector_no=(SELECT COALESCE(MAX(collector_no),0)+1 FROM licenses WHERE work_id=?) WHERE ref=? AND collector_no IS NULL').run(l.work_id, ref);
    ledger.append(db, 'license.granted', ref, { work: w.slug, fingerprint: w.sha256, use: u.key, starts: start.toISOString(), ends: end ? end.toISOString() : null, paid: !!extra.paid });
    const g = q.lic.get(ref);
    if (extra.paid) mail.send({ to: maker.email, ...mail.templates.soldToMaker({ ref, title: w.title, use: u.name, buyer: g.licensee_company || g.licensee_name, fee: V.money(g.price_cents, g.currency), base: C.base }) });
    if (g.licensee_email) mail.send({ to: g.licensee_email, ...mail.templates.grantedToLicensee({ ref, title: w.title, name: g.licensee_name, ends: g.ends_at, certUrl: `${C.base}/c/${ref}?k=${token || ''}`, downloadUrl: token ? `${C.base}/d/${token}` : null }) });
    return g;
  }

  // The buyer's name and email come from Stripe Checkout, so the license form never asks for them.
  function fillBuyer(ref, s) {
    const d = s.customer_details || {};
    const name = d.name || (d.email ? d.email.split('@')[0] : null);
    if (d.email) db.prepare("UPDATE licenses SET licensee_email=?, licensee_name=COALESCE(?, licensee_name), updated_at=datetime('now') WHERE ref=? AND status!='active'").run(d.email, name, ref);
    const co = (s.custom_fields || []).find(f => f.key === 'company');
    if (co && co.text && co.text.value) db.prepare('UPDATE licenses SET licensee_company=? WHERE ref=?').run(String(co.text.value).slice(0, 160), ref);
  }

  function countView(workId, host, kind) {
    const day = new Date().toISOString().slice(0, 10);
    db.prepare('INSERT INTO views (work_id,host,kind,day,count) VALUES (?,?,?,?,1) ON CONFLICT(work_id,host,kind,day) DO UPDATE SET count=count+1').run(workId, host || null, kind, day);
  }

  async function registerWork({ file, title, place, caption, source_url, originalName, makerId }) {
    const owner = makerId ? (db.prepare('SELECT * FROM makers WHERE id=?').get(makerId) || maker) : maker;
    const info = await images.inspect(file);
    const dupe = db.prepare('SELECT slug FROM works WHERE sha256=?').get(info.sha256);
    if (dupe) { fs.unlinkSync(file); const e = new Error(`This photograph is already held as "${dupe.slug}".`); e.user = true; throw e; }
    let slug = slugify(title), i = 2;
    while (q.work.get(slug)) slug = `${slugify(title)}-${i++}`;
    const ext = (path.extname(originalName || file) || '.jpg').toLowerCase();
    const dest = path.join(originals, slug + ext);
    // A file staged on another disk (e.g. /tmp beside a mounted volume) can't be renamed across; copy it.
    try { fs.renameSync(file, dest); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(file, dest); fs.unlinkSync(file); }
    await store.put('originals/' + path.basename(dest), dest, /\.png$/.test(ext) ? 'image/png' : /\.tiff?$/.test(ext) ? 'image/tiff' : 'image/jpeg');
    db.prepare(`INSERT INTO works (maker_id,slug,title,caption,place,taken_at,camera,lens,width,height,original_file,sha256,source_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(owner.id, slug, title, caption || null, place || null, info.taken_at, info.camera, info.lens, info.width, info.height, path.basename(dest), info.sha256, source_url || null);
    const nw = q.work.get(slug);
    db.prepare("UPDATE works SET accession=?, medium=COALESCE(medium, 'Digital photograph'), dhash=? WHERE id=?").run(accession(nw), await images.dhash(dest).catch(() => null), nw.id);
    if (store.kind === 's3') fs.unlinkSync(dest); // the vault holds it; the disk is only a cache
    ledger.append(db, 'work.registered', slug, { maker: owner.handle, fingerprint: info.sha256, camera: info.camera, taken: info.taken_at, accession: accession(nw) });
    return q.work.get(slug);
  }

  // ---------- app ----------
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  // Protection by default: tell crawlers and AI scrapers the work is reserved (TDMRep, noai).
  app.use((req, res, next) => { if (!req.path.startsWith('/studio')) res.set({ 'X-Robots-Tag': 'noai, noimageai', 'TDM-Reservation': '1', 'TDM-Policy': `${C.base}/terms` }); next(); });
  const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'CCBot', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'Applebot-Extended', 'PerplexityBot', 'Bytespider', 'Meta-ExternalAgent', 'Amazonbot', 'cohere-ai', 'Diffbot', 'ImagesiftBot', 'Omgilibot'];
  app.get('/robots.txt', (req, res) => res.type('text').send(`${AI_BOTS.map(b => `User-agent: ${b}\nDisallow: /`).join('\n\n')}\n\nUser-agent: *\nAllow: /img/*/thumb\nAllow: /img/*/screen\nDisallow: /img/\nDisallow: /d/\nDisallow: /k/\nDisallow: /studio\nDisallow: /buy/\nAllow: /\n\nSitemap: ${C.base}/sitemap.xml\n`));
  // Every public page, so search engines find the collection, each work, its life and the public rooms.
  app.get('/sitemap.xml', (req, res) => {
    const u = p => `<url><loc>${C.base}${p}</loc></url>`;
    const ws = db.prepare("SELECT slug, title, created_at FROM works WHERE status='held' ORDER BY id").all();
    const rooms = db.prepare('SELECT slug FROM collections WHERE public=1').all();
    const img = w => `<url><loc>${C.base}/w/${w.slug}</loc><image:image><image:loc>${C.base}/img/${w.slug}/screen</image:loc><image:title>${V.esc(w.title)}</image:title></image:image></url>`;
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${['/', '/collection', '/collectors', '/journal', '/patronage', '/series/the-great-rooms', '/about', '/terms', '/verify', '/ledger'].map(u).join('')}${ws.map(img).join('')}${ws.map(w => u(`/w/${w.slug}/life`)).join('')}${rooms.map(r => u(`/rooms/${r.slug}`)).join('')}</urlset>`);
  });
  app.get('/.well-known/tdmrep.json', (req, res) => res.json([{ location: '/*', 'tdm-reservation': 1, 'tdm-policy': `${C.base}/terms` }]));
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(cookieParser());

  // Stripe webhook needs the raw body, so it comes before the body parsers.
  app.post('/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    if (!stripe || !C.webhookSecret) return res.status(400).send('Stripe not configured');
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], C.webhookSecret); }
    catch (e) { return res.status(400).send('Bad signature'); }
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const ref = s.metadata && s.metadata.ref;
      if (s.metadata && s.metadata.set && s.payment_status === 'paid') grantSet(s.metadata.set, s);
      else if (ref && s.payment_status === 'paid') { fillBuyer(ref, s); grant(ref, { paid: true, price_cents: s.amount_total }); }
    }
    if (app.locals.patronEvent) app.locals.patronEvent(event); // patronage: joined, or ended
    if (event.type === 'payment_intent.succeeded') { // Share it, paid in place
      const pi = event.data.object, ref = pi.metadata && pi.metadata.ref;
      if (ref && q.lic.get(ref)) grant(ref, { paid: true, price_cents: pi.amount_received });
    }
    res.json({ received: true });
  });

  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.json({ limit: '64kb' }));

  // --- auth for the Studio ---
  const sign = v => crypto.createHmac('sha256', C.secret).update(v).digest('hex');
  const isStudio = req => { const c = req.cookies.wm_s; if (!c) return false; const [exp, mac] = c.split('.'); return mac === sign(exp) && Date.now() < +exp; };
  const studioOnly = (req, res, next) => isStudio(req) ? next() : res.redirect('/studio/login');
  // Every maker and estate has their own account and dashboard.
  app.locals.accounts = require('./accounts').mountAccounts(app, { db, C, sign, isStudio, studioOnly, slugify, DEFAULT_USES, V, registerWork: (...a) => registerWork(...a), upload: () => upload, ledger });

  // --- public pages ---
  app.get('/', (req, res) => res.send(V.home({ maker, works: q.publicWorks.all(), uses: q.uses.all(maker.id), sent: req.query.sent })));
  app.get('/collection', (req, res) => {
    const rooms = db.prepare('SELECT id, slug, title FROM collections WHERE public=1 ORDER BY sort DESC, id DESC').all(); // newest stories first
    const ids = db.prepare("SELECT cw.work_id id FROM collection_works cw JOIN works w ON w.id=cw.work_id WHERE cw.collection_id=? AND w.status='held' ORDER BY cw.sort, cw.work_id");
    rooms.forEach(r => { r.ids = ids.all(r.id).map(x => x.id); });
    const socialOf = {}; for (const u of db.prepare("SELECT maker_id, price_cents FROM uses WHERE key='social'").all()) socialOf[u.maker_id] = u.price_cents;
    const makers = Object.fromEntries(db.prepare('SELECT * FROM makers').all().map(m => [m.id, m]));
    const works = db.prepare("SELECT * FROM works WHERE status='held' ORDER BY id").all()
      .map(w => w.maker_id !== maker.id && !w.share_cents ? { ...w, share_cents: socialOf[w.maker_id] || null } : w)
      .map(w => ({ ...w, maker: makers[w.maker_id] || maker }));
    res.send(V.collection({ maker, works, rooms, share: q.use.get(maker.id, 'social'), pay: payCfg() }));
  });

  // Makers apply to hold their work here. Read in the Studio.
  app.post('/apply', (req, res) => {
    const b = req.body; const email = String(b.email || '').trim();
    if (!b.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect('/#apply');
    db.prepare('INSERT INTO applications (name,email,portfolio,practice,note) VALUES (?,?,?,?,?)').run(String(b.name).slice(0, 120), email.slice(0, 160), String(b.portfolio || '').slice(0, 300) || null, String(b.practice || '').slice(0, 80) || null, String(b.note || '').slice(0, 2000) || null);
    mail.send({ to: maker.email, ...mail.templates.applicationToMaker({ name: b.name, email, portfolio: b.portfolio, practice: b.practice, base: C.base }) });
    res.redirect(303, '/?sent=1#apply');
  });

  // Anyone can tell a maker where their work turned up. The maker decides what to do about it.
  app.post('/report/:slug', (req, res) => {
    const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404);
    const maker = mk(w); // the work's own maker
    const url = String(req.body.url || '').trim().slice(0, 500);
    if (!/^https?:\/\/\S+\.\S+/.test(url)) return res.redirect(`/w/${w.slug}#report`);
    const em = String(req.body.email || '').trim();
    db.prepare('INSERT INTO sightings (work_id,url,note,reporter_email) VALUES (?,?,?,?)').run(w.id, url, String(req.body.note || '').slice(0, 1000) || null, /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) ? em.slice(0, 160) : null);
    mail.send({ to: maker.email, ...mail.templates.sightingToMaker({ title: w.title, url, base: C.base }) });
    res.send(V.reported({ w }));
  });
  app.get('/about', (req, res) => res.send(V.about()));
  app.get('/terms', (req, res) => res.send(V.terms()));

  app.get('/w/:slug', (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (!w || (w.status !== 'held' && !isStudio(req))) return res.status(404).send(V.layout({ title: 'Not found · Watermark', body: '<section class="narrow"><h1>Nothing is held here.</h1></section>' }));
    countView(w.id, null, 'view');
    const rules = R.parse(w.rules);
    const holders = db.prepare(`SELECT COUNT(DISTINCT COALESCE(buyer_id, -id)) n FROM licenses WHERE work_id=? AND status IN ('active','expired') AND price_cents > 0`).get(w.id).n;
    const shown = db.prepare(`SELECT b.name, b.code, MIN(l.collector_no) no FROM licenses l JOIN buyers b ON b.id=l.buyer_id WHERE l.work_id=? AND b.public=1 AND b.code IS NOT NULL AND l.status IN ('active','expired') AND l.price_cents > 0 GROUP BY b.id ORDER BY no LIMIT 5`).all(w.id);
    res.send(V.work({ w, maker, uses: q.uses.all(maker.id).filter(u => R.allows(rules, u.key)).map(u => priced(u, w)), base: C.base, rules, pay: payCfg(), held: { n: holders, shown }, ed: edition(w), story: storyOf(w), patron: maker.id === mk(null).id && stripe ? app.locals.patronage.slugOf(maker) : null }));
  });

  // The public life of a photograph: registered, licensed, and (if the maker chooses) what it has earned.
  app.get('/w/:slug/life', (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (!w || w.status !== 'held') return res.sendStatus(404);
    const rules = R.parse(w.rules);
    const lic = db.prepare("SELECT l.id, l.ref, l.starts_at, l.ends_at, l.status, l.price_cents, l.collector_no, u.name AS use_name FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=? AND l.status IN ('active','expired') ORDER BY l.starts_at").all(w.id);
    const reg = db.prepare("SELECT * FROM ledger WHERE type='work.registered' AND subject=? ORDER BY seq LIMIT 1").get(w.slug);
    const ids = lic.map(l => l.id);
    const prints = ids.length ? db.prepare(`SELECT p.*, l.collector_no FROM prints p JOIN licenses l ON l.id=p.license_id WHERE p.license_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.id`).all(...ids) : [];
    const moves = ids.length ? db.prepare(`SELECT t.claimed_at, l.collector_no FROM transfers t JOIN licenses l ON l.id=t.license_id WHERE t.claimed_at IS NOT NULL AND t.license_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.claimed_at`).all(...ids) : [];
    res.send(V.life({ w, maker, lic, reg, rules, ed: edition(w), prints, moves }));
  });

  app.get('/img/:slug/:size', async (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (!w || !images.SIZES[req.params.size]) return res.sendStatus(404);
    try {
      const file = await images.derivative(await originalPath(w), cache, w.slug, req.params.size);
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      res.type('jpg').sendFile(file);
    } catch (e) { res.sendStatus(500); }
  });

  // JSON for embeds
  app.get('/api/work/:slug', (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    res.set('Access-Control-Allow-Origin', '*');
    if (!w || w.status !== 'held') return res.status(404).json({ error: 'not found' });
    res.json({ slug: w.slug, title: w.title, maker: maker.name, house: maker.house, width: w.width, height: w.height,
      image: `${C.base}/img/${w.slug}/screen`, page: `${C.base}/w/${w.slug}`, license: `${C.base}/license/${w.slug}`, source: w.source_url });
  });
  // Krafft Studios ↔ Watermark: which photographs in a Studios story are held here, so the K on each
  // one can open it on Watermark. Matched by the image's path, whatever size Ghost serves.
  const imgPath = s => { const m = String(s || '').split('?')[0].replace(/\/size\/w\d+(\/format\/\w+)?\//, '/').replace(/_o(\.[a-z]+)$/i, '$1').match(/\/content\/images\/.+$/); return m ? m[0] : null; };
  const storyOf = w => { try { const r = db.prepare("SELECT c.title, c.slug FROM studios_imports s JOIN collections c ON c.slug=s.post_slug WHERE s.work_id=? LIMIT 1").get(w.id); return r && w.source_url ? { title: r.title, url: w.source_url, room: r.slug } : null; } catch (e) { return null; } };
  app.locals.storyOf = storyOf;
  app.get('/api/k', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*'); res.set('Cache-Control', 'public, max-age=300');
    const post = String(req.query.post || '').replace(/[^a-z0-9-]/gi, '').slice(0, 160);
    let rows = [];
    try { rows = db.prepare("SELECT s.src, w.slug, w.title, w.rules, w.status FROM studios_imports s JOIN works w ON w.id=s.work_id WHERE s.post_slug=? AND w.status IN ('held','hidden')").all(post); } catch (e) { /* no imports yet */ }
    const room = db.prepare('SELECT slug, title, public FROM collections WHERE slug=?').get(post);
    // Every photograph carries the K. Public ones are collected at once; ones held privately (people,
    // other artists' work) are licensed on request, so nothing is sold without consent.
    const works = rows.map(r => ({ path: imgPath(r.src), slug: r.status === 'held' ? r.slug : null, title: r.title,
      collect: r.status === 'held' && R.allows(R.parse(r.rules), 'social'), ask: r.status !== 'held' })).filter(x => x.path);
    const shown = works.filter(w => !w.ask).length;
    res.json({ base: C.base, room: room && room.public && shown ? { slug: room.slug, title: room.title, url: `${C.base}/rooms/${room.slug}`, n: shown } : null, works,
      patron: stripe ? `${C.base}/m/${slugify(maker.name)}#patron` : null, license: 'https://www.krafftco.com/license', mark: 'K' });
  });
  // A Krafft image anywhere (krafftco.com/license?image=…): which work is it?
  app.get('/api/match', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*'); res.set('Cache-Control', 'public, max-age=300');
    const p = imgPath(req.query.src); if (!p) return res.json({ work: null });
    let r = null; try { r = db.prepare("SELECT w.slug, w.title, w.rules FROM studios_imports s JOIN works w ON w.id=s.work_id WHERE w.status='held' AND s.src LIKE ?").get('%' + p); } catch (e) { /* none */ }
    res.json({ work: r ? { slug: r.slug, title: r.title, page: `${C.base}/w/${r.slug}`, license: `${C.base}/license/${r.slug}`, collect: R.allows(R.parse(r.rules), 'social') } : null });
  });
  app.get('/k.js', (req, res) => { res.set('Cache-Control', 'public, max-age=600'); res.type('application/javascript'); res.sendFile(path.join(__dirname, '..', 'public', 'k.js')); });
  app.post('/api/seen', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const w = q.work.get(String(req.body.work || req.query.work || ''));
    const maker = mk(w); // the work's own maker
    const host = String(req.body.host || '').toLowerCase().replace(/[^a-z0-9.\-:]/g, '').slice(0, 120);
    const kind = ['embed', 'open'].includes(req.body.kind) ? req.body.kind : 'embed';
    if (w) countView(w.id, host || null, kind);
    res.sendStatus(204);
  });
  app.options('/api/seen', (req, res) => { res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' }); res.sendStatus(204); });
  // The house bar, shared with krafftco.com and studios.krafftco.com (loaded in each site's <head>).
  app.get('/house.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=600').set('Access-Control-Allow-Origin', '*');
    res.sendFile(path.join(__dirname, '..', 'public', 'house.js'));
  });
  app.get('/embed.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=3600').set('Access-Control-Allow-Origin', '*');
    res.send(fs.readFileSync(path.join(__dirname, '..', 'public', 'embed.js'), 'utf8').replace(/__WM_BASE__/g, C.base));
  });

  // --- licensing ---
  app.get('/license/:slug', (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (!w || w.status !== 'held') return res.sendStatus(404);
    countView(w.id, null, 'open');
    const rules = R.parse(w.rules);
    res.send(V.buy({ w, maker, rules, uses: q.uses.all(maker.id).filter(u => R.allows(rules, u.key)).map(u => priced(u, w)), chosen: req.query.use, renews: /^WM-\d{4}-\d{6}$/.test(String(req.query.renews || '')) ? req.query.renews : null, instant: !!stripe }));
  });

  // One tap: a priced use goes straight to Stripe Checkout (Apple Pay, Google Pay, Link, cards).
  // No account, no form: Stripe collects the buyer's name and email.
  app.post('/buy/:slug', async (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (!w || w.status !== 'held') return res.sendStatus(404);
    const u = priced(q.use.get(maker.id, String(req.body.use || '')), w);
    const rules = R.parse(w.rules);
    if (!u || !R.allows(rules, u.key)) return res.redirect(`/license/${w.slug}`);
    const note = String(req.body.note || '').slice(0, 2000) || null;
    if (u.key === 'social' && soldOut(w)) return res.redirect(`/w/${w.slug}`);
    if (rules.approve) return res.send(V.ask({ w, maker, u, note, renews: req.body.renews, approve: true }));
    if (req.body.ask || u.price_cents == null || !stripe) return res.send(V.ask({ w, maker, u, note, renews: req.body.renews }));
    const ref = nextRef();
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,intended_use,price_cents,status,conditions) VALUES (?,?,?,?,?,?,?,'awaiting_payment',?)")
      .run(ref, w.id, u.id, 'Buyer', '', note, u.price_cents, R.conditions(rules) || null);
    const renews = /^WM-\d{4}-\d{6}$/.test(String(req.body.renews || '')) ? String(req.body.renews) : null;
    if (renews) db.prepare('UPDATE licenses SET renews=? WHERE ref=?').run(renews, ref);
    ledger.append(db, 'license.checkout', ref, { work: w.slug, use: u.key });
    try {
      const s = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: u.price_cents, product_data: { name: u.key === 'social' ? `${w.title.replace(/[.\s]+$/, '')}` : `${w.title.replace(/[.\s]+$/, '')}: ${u.name}`, description: u.key === 'social' ? `Yours to share. Photograph by ${maker.name}.` : `${u.kind === 'print' ? 'Archival print, signed' : 'License, ' + V.termText(u)}. Photograph by ${maker.name}. Watermark ${ref}.`, images: [`${C.base}/img/${w.slug}/thumb`] } } }],
        // Share it: nothing but Apple Pay / Google Pay, card or Link (which remembers returning buyers).
        ...(u.key === 'social' ? { submit_type: 'pay' } : { custom_fields: [{ key: 'company', label: { type: 'custom', custom: 'Company or publication' }, type: 'text', optional: true }] }),
        ...(u.kind === 'print' ? { shipping_address_collection: { allowed_countries: ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'CH', 'ES', 'NL', 'AU'] } } : {}),
        metadata: { ref },
        success_url: `${C.base}/thanks/${ref}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: /^https:\/\/([a-z0-9-]+\.)?krafftco\.com\//.test(String(req.body.back || '')) ? String(req.body.back).slice(0, 500) : `${C.base}/license/${w.slug}?use=${u.key}`,
      });
      db.prepare("UPDATE licenses SET stripe_session=? WHERE ref=?").run(s.id, ref);
      res.redirect(303, s.url);
    } catch (e) { console.error('[checkout]', e.message); res.status(502).send(V.ask({ w, maker, u, note, error: 'Payment is unavailable for a moment. Leave your details and the maker will send a link.' })); }
  });

  // ---------- Share it, paid in place ----------
  // Tap, Face ID, done: the page opens Apple Pay / Google Pay / Link itself (Stripe Express Checkout),
  // the payment is confirmed here, and the file is handed over without leaving the photograph.
  const payCfg = () => { const u = q.use.get(maker.id, 'social'); return stripe && C.stripePk && u && u.price_cents != null ? { pk: C.stripePk, amount: u.price_cents, price: V.money(u.price_cents) } : null; };
  app.locals.payCfg = payCfg;
  // The buyer is known only by a signed cookie on their device; no account, no password.
  const buyerOf = req => { const c = req.cookies && req.cookies.wm_b; if (!c) return null; const [id, mac] = String(c).split('.'); return mac === sign('b' + id) ? db.prepare('SELECT * FROM buyers WHERE id=?').get(+id) : null; };
  const setBuyer = (res, b, tap) => {
    const o = { sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 1000 * 60 * 60 * 24 * 365 };
    res.cookie('wm_b', `${b.id}.${sign('b' + b.id)}`, { ...o, httpOnly: true });
    if (tap) res.cookie('wm_tap', '1', o); // tells the page a one-tap card is ready (holds nothing)
  };
  if (stripe && C.stripePk && !cfg.noTimers) { // Apple Pay shows only on a domain Stripe knows
    try { stripe.paymentMethodDomains.create({ domain_name: new URL(C.base).hostname }).catch(() => {}); } catch (e) { /* older client */ }
  }
  app.post('/pay/:slug', async (req, res) => {
    const w = q.work.get(req.params.slug); const maker = mk(w); const u = priced(q.use.get(maker.id, 'social'), w);
    if (!w || w.status !== 'held' || !u || u.price_cents == null || !stripe || !R.allows(R.parse(w.rules), 'social')) return res.status(404).json({ ok: false });
    if (soldOut(w)) return res.status(409).json({ ok: false, soldOut: true });
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(req.body.email || '')) ? String(req.body.email).slice(0, 160) : '';
    const name = String(req.body.name || '').trim().slice(0, 120) || (email ? email.split('@')[0] : 'Buyer');
    const ref = nextRef();
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,price_cents,status,conditions) VALUES (?,?,?,?,?,?,'awaiting_payment',?)")
      .run(ref, w.id, u.id, name, email, u.price_cents, R.conditions(R.parse(w.rules)) || null);
    try {
      // First Share it from this device: a Stripe customer is made so the card can be remembered for one tap next time.
      let b = buyerOf(req);
      if (!b) {
        const cu = await stripe.customers.create({ ...(email ? { email } : {}), ...(name && name !== 'Buyer' ? { name } : {}), metadata: { source: 'watermark-share' } });
        const id = db.prepare('INSERT INTO buyers (customer, email) VALUES (?,?)').run(cu.id, email || null).lastInsertRowid;
        b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b);
      }
      db.prepare('UPDATE licenses SET buyer_id=? WHERE ref=?').run(b.id, ref);
      const pi = await stripe.paymentIntents.create({ amount: u.price_cents, currency: 'usd', automatic_payment_methods: { enabled: true }, customer: b.customer, setup_future_usage: 'off_session',
        description: `${w.title.replace(/[.\s]+$/, '')}: Share it. Photograph by ${maker.name}. Watermark ${ref}.`, metadata: { ref, work: w.slug }, ...(email ? { receipt_email: email } : {}) });
      db.prepare('UPDATE licenses SET stripe_session=? WHERE ref=?').run(pi.id, ref);
      ledger.append(db, 'license.checkout', ref, { work: w.slug, use: u.key });
      res.json({ ok: true, ref, secret: pi.client_secret });
    } catch (e) { console.error('[pay]', e.message); db.prepare("DELETE FROM licenses WHERE ref=? AND status='awaiting_payment'").run(ref); res.status(502).json({ ok: false }); }
  });
  app.post('/pay/:ref/done', async (req, res) => {
    let l = q.lic.get(req.params.ref);
    if (!l || !stripe || !/^pi_/.test(l.stripe_session || '')) return res.status(404).json({ ok: false });
    if (l.status !== 'active') {
      const pi = await stripe.paymentIntents.retrieve(l.stripe_session).catch(() => null);
      if (!pi || pi.status !== 'succeeded') return res.json({ ok: false, status: pi ? pi.status : 'unknown' });
      const b = buyerOf(req);
      if (b && pi.customer === b.customer && pi.payment_method) { db.prepare('UPDATE buyers SET pm=?, email=COALESCE(email, ?) WHERE id=?').run(pi.payment_method, pi.receipt_email || null, b.id); setBuyer(res, b, true); }
      l = grant(l.ref, { paid: true, price_cents: pi.amount_received });
    }
    res.json(handover(l));
  });

  // Every Share it after the first: one tap, the remembered card, no sheet. Undo for a short while after.
  app.post('/pay/:slug/tap', async (req, res) => {
    const w = q.work.get(req.params.slug); const maker = mk(w); const u = priced(q.use.get(maker.id, 'social'), w), b = buyerOf(req);
    if (!w || w.status !== 'held' || !u || u.price_cents == null || !stripe || !R.allows(R.parse(w.rules), 'social')) return res.status(404).json({ ok: false });
    if (soldOut(w)) return res.status(409).json({ ok: false, soldOut: true });
    if (!b || !b.pm) return res.json({ ok: false, sheet: true });
    const ref = nextRef();
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,price_cents,status,conditions,buyer_id) VALUES (?,?,?,?,?,?,'awaiting_payment',?,?)")
      .run(ref, w.id, u.id, (b.email || 'Buyer').split('@')[0], b.email || '', u.price_cents, R.conditions(R.parse(w.rules)) || null, b.id);
    try {
      const pi = await stripe.paymentIntents.create({ amount: u.price_cents, currency: 'usd', customer: b.customer, payment_method: b.pm, off_session: true, confirm: true,
        description: `${w.title.replace(/[.\s]+$/, '')}: Share it. Photograph by ${maker.name}. Watermark ${ref}.`, metadata: { ref, work: w.slug, tap: '1' }, ...(b.email ? { receipt_email: b.email } : {}) });
      db.prepare('UPDATE licenses SET stripe_session=? WHERE ref=?').run(pi.id, ref);
      ledger.append(db, 'license.checkout', ref, { work: w.slug, use: u.key, tap: true });
      if (pi.status !== 'succeeded') return res.json({ ok: false, sheet: true });
      res.json({ ...handover(grant(ref, { paid: true, price_cents: pi.amount_received })), undo: true });
    } catch (e) { // the bank wants a word (3-D Secure) or the card has gone: fall back to the sheet
      db.prepare("DELETE FROM licenses WHERE ref=? AND status='awaiting_payment'").run(ref);
      res.json({ ok: false, sheet: true });
    }
  });
  // A mis-tap: within two minutes, the same device can take it back. Refunded in full; the file stops working.
  app.post('/pay/:ref/undo', async (req, res) => {
    const l = q.lic.get(req.params.ref), b = buyerOf(req);
    if (!l || !b || l.status !== 'active' || !/^pi_/.test(l.stripe_session || '') || Date.now() - new Date(l.starts_at).getTime() > 120e3) return res.status(400).json({ ok: false });
    const pi = await stripe.paymentIntents.retrieve(l.stripe_session).catch(() => null);
    if (!pi || pi.customer !== b.customer) return res.status(403).json({ ok: false });
    try { await stripe.refunds.create({ payment_intent: pi.id }); } catch (e) { return res.status(502).json({ ok: false }); }
    db.prepare("UPDATE licenses SET status='declined', download_token=NULL, updated_at=datetime('now') WHERE ref=?").run(l.ref);
    ledger.append(db, 'license.undone', l.ref, { refunded: true });
    res.json({ ok: true });
  });
  // Forget the remembered card on this device.
  app.post('/pay/forget', (req, res) => {
    const b = buyerOf(req); if (b) db.prepare('UPDATE buyers SET pm=NULL WHERE id=?').run(b.id);
    res.clearCookie('wm_b'); res.clearCookie('wm_tap'); res.json({ ok: true });
  });
  function handover(l) {
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    const maker = mk(w); // the work's own maker
    l = q.lic.get(l.ref);
    return { ok: true, ref: l.ref, no: l.collector_no, of: w.edition_size || null, price: V.money(l.price_cents), download: `/d/${l.download_token}`, page: `/c/${l.ref}?k=${l.download_token}`, credit: `Photograph by ${maker.name}${maker.house ? ' · ' + maker.house : ''}`, title: w.title };
  }

  // ---------- Collectors: everyone's own Watermark ----------
  // Every purchase hangs in the buyer's collection, numbered, room by room. Private by default;
  // the collector can open it to the world under a name of their choosing.
  function collected(b) {
    const items = db.prepare(`SELECT l.id, l.ref, l.collector_no, w.edition_size, (SELECT GROUP_CONCAT(COALESCE(p.size,'') || CASE WHEN p.paper IS NOT NULL AND p.paper != '' THEN ', ' || p.paper ELSE '' END, '; ') FROM prints p WHERE p.license_id=l.id) AS printed, l.starts_at, l.download_token, l.status, u.name AS use_name, u.key AS use_key, w.id AS wid, w.slug, w.title, w.place, w.width, w.height, m.name AS maker, m.handle
      FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id JOIN makers m ON m.id=w.maker_id
      WHERE l.buyer_id=? AND l.status IN ('active','expired') AND l.price_cents > 0 ORDER BY l.starts_at DESC`).all(b.id);
    const ids = [...new Set(items.map(i => i.wid))];
    const rooms = ids.length ? db.prepare(`SELECT c.slug, c.title, COUNT(*) AS total, SUM(CASE WHEN cw.work_id IN (${ids.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS have
      FROM collections c JOIN collection_works cw ON cw.collection_id=c.id JOIN works w ON w.id=cw.work_id AND w.status='held'
      WHERE c.public=1 GROUP BY c.id HAVING have > 0 ORDER BY (have * 1.0 / total) DESC, have DESC`).all(...ids) : [];
    return { items, rooms, works: ids.length, makers: new Set(items.map(i => i.handle)).size };
  }
  app.get('/yours', (req, res) => {
    const b = buyerOf(req);
    const give = req.query.give && b ? db.prepare('SELECT t.token, w.title FROM transfers t JOIN licenses l ON l.id=t.license_id JOIN works w ON w.id=l.work_id WHERE t.token=? AND t.from_buyer=? AND t.claimed_at IS NULL').get(String(req.query.give), b.id) : null;
    res.send(V.collector({ b, ...(b ? collected(b) : { items: [], rooms: [], works: 0, makers: 0 }), own: true, base: C.base, give, got: req.query.got || null, founding: foundingNo(b), left: foundingLeft(), patronOf: pat.of(b), patronSlug: pat.slugOf(maker), keyed: auth.keysOf(b).length > 0 }));
  });
  app.post('/yours', (req, res) => {
    const b = buyerOf(req); if (!b) return res.redirect('/yours');
    const name = String((req.body || {}).name || '').trim().slice(0, 60) || null, pub = (req.body || {}).public === '1' ? 1 : 0;
    const code = b.code || nanoid(10);
    db.prepare('UPDATE buyers SET name=?, public=?, code=? WHERE id=?').run(name, pub, code, b.id);
    res.redirect('/yours');
  });
  // Patronage: keep a maker working, monthly or once.
  const pat = app.locals.patronage = require('./patronage').mountPatronage(app, { db, C, stripe, maker, slugify, buyerOf, setBuyer, ledger, V });
  // Signing in with a passkey: the collection follows the collector to every device.
  const auth = require('./auth').mountAuth(app, { db, C, buyerOf, setBuyer, ledger, V });
  // A collector records a print they have made of a work they hold. It shows on their wall and in the work's life.
  app.post('/yours/print', (req, res) => {
    const b = buyerOf(req), x = req.body || {}; const l = b && q.lic.get(String(x.ref || ''));
    if (!l || l.buyer_id !== b.id || l.status !== 'active') return res.redirect('/yours');
    const t = (v, n) => String(v || '').trim().slice(0, n) || null;
    db.prepare('INSERT INTO prints (license_id, size, paper, made) VALUES (?,?,?,?)').run(l.id, t(x.size, 60), t(x.paper, 80), t(x.made, 40));
    ledger.append(db, 'print.recorded', l.ref, { size: t(x.size, 60), paper: t(x.paper, 80) });
    res.redirect('/yours#files');
  });
  // Passing a work on: the holder makes a one-time link; whoever opens and accepts it becomes the holder,
  // with the same collector number. The old file link stops; the new holder gets their own.
  app.post('/yours/give', (req, res) => {
    const b = buyerOf(req); const l = b && q.lic.get(String((req.body || {}).ref || ''));
    if (!l || l.buyer_id !== b.id || l.status !== 'active' || !l.collector_no) return res.redirect('/yours');
    let tr = db.prepare('SELECT * FROM transfers WHERE license_id=? AND claimed_at IS NULL').get(l.id);
    if (!tr) { db.prepare('INSERT INTO transfers (license_id, token, from_buyer) VALUES (?,?,?)').run(l.id, nanoid(24), b.id); tr = db.prepare('SELECT * FROM transfers WHERE license_id=? AND claimed_at IS NULL').get(l.id); }
    res.redirect(`/yours?give=${encodeURIComponent(tr.token)}#files`);
  });
  const claimOf = token => { const tr = db.prepare('SELECT * FROM transfers WHERE token=? AND claimed_at IS NULL').get(String(token)); if (!tr) return null; const l = db.prepare('SELECT * FROM licenses WHERE id=?').get(tr.license_id); if (!l || l.status !== 'active' || l.buyer_id !== tr.from_buyer) return null; return { tr, l, w: db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id) }; };
  app.get('/claim/:token', (req, res) => { const c = claimOf(req.params.token); res.status(c ? 200 : 404).send(V.claim({ c, maker: c ? mk(c.w) : null, mine: !!(c && buyerOf(req) && buyerOf(req).id === c.tr.from_buyer) })); });
  app.post('/claim/:token', (req, res) => {
    const c = claimOf(req.params.token); if (!c) return res.redirect('/yours');
    let b = buyerOf(req);
    if (b && b.id === c.tr.from_buyer) return res.redirect(`/claim/${req.params.token}`); // can't give it to yourself
    if (!b) { const id = db.prepare("INSERT INTO buyers (customer, email) VALUES ('', NULL)").run().lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); }
    const token = nanoid(32);
    db.prepare("UPDATE licenses SET buyer_id=?, download_token=?, updated_at=datetime('now') WHERE id=?").run(b.id, token, c.l.id);
    db.prepare("UPDATE transfers SET to_buyer=?, claimed_at=datetime('now') WHERE id=?").run(b.id, c.tr.id);
    ledger.append(db, 'license.transferred', c.l.ref, { work: c.w.slug, collector_no: c.l.collector_no });
    res.redirect('/yours?got=' + encodeURIComponent(c.l.ref));
  });

  // The collectors: walls their owners chose to show. Taste is what makes others want the work.
  app.get('/patronage', (req, res) => res.send(V.patronage()));
  // Series: the maker's photographs hung in order, in parts.
  const SERIES = require('./series');
  // Collecting more than one: a part of a series at a quarter off, the whole series at 40% off. Whole dollars. (Draft rates.)
  const SET_OFF = { part: 0.25, all: 0.40 };
  const collectable = slugs => slugs.map(slug => q.work.get(slug)).filter(w => w && w.status === 'held' && R.allows(R.parse(w.rules), 'social') && !soldOut(w))
    .map(w => ({ w, u: priced(q.use.get(mk(w).id, 'social'), w) })).filter(x => x.u && x.u.price_cents != null);
  const setPrice = (items, off) => { const full = items.reduce((a, x) => a + x.u.price_cents, 0); return { full, price: Math.max(100, Math.round(full * (1 - off) / 100) * 100) }; };
  const seriesParts = s => {
    const chapters = s.chapters.map((c, i) => { const items = collectable(c.works); return { ...c, i: i + 1, works: c.works.map(slug => q.work.get(slug)).filter(w => w && w.status === 'held'), items, ...setPrice(items, SET_OFF.part) }; }).filter(c => c.works.length);
    const every = chapters.flatMap(c => c.items);
    return { chapters, whole: { n: every.length, ...setPrice(every, SET_OFF.all) } };
  };
  const SETS = Object.fromEntries(SERIES.map(s => [s.slug, { name: s.title }]));
  app.get('/series/:slug', (req, res) => {
    const s = SERIES.find(x => x.slug === req.params.slug); if (!s) return res.sendStatus(404);
    const { chapters, whole } = seriesParts(s);
    res.send(V.series({ s, chapters, whole, buy: !!stripe, credits: app.locals.patronage.credits(), patronSlug: app.locals.patronage.slugOf(maker) }));
  });
  app.post('/series/:slug/collect', async (req, res) => {
    const s = SERIES.find(x => x.slug === req.params.slug); if (!s || !stripe) return res.redirect(`/series/${req.params.slug}`);
    const { chapters, whole } = seriesParts(s);
    const part = String((req.body || {}).part || 'all');
    const c = part === 'all' ? null : chapters.find(x => String(x.i) === part);
    const items = c ? c.items : chapters.flatMap(x => x.items);
    const { price, full } = c ? c : whole;
    if (items.length < 2) return res.redirect(`/series/${s.slug}`);
    const setRef = `${s.slug}:${nextRef()}`;
    // Each photograph is its own license and its own collector number; the price is shared out across them.
    const each = Math.floor(price / items.length), extra = price - each * items.length;
    const refs = items.map((x, j) => {
      const ref = nextRef();
      db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,price_cents,status,conditions,set_ref) VALUES (?,?,?,?,?,?,'awaiting_payment',?,?)")
        .run(ref, x.w.id, x.u.id, 'Buyer', '', each + (j === 0 ? extra : 0), R.conditions(R.parse(x.w.rules)) || null, setRef);
      return ref;
    });
    const label = c ? `${s.title}, ${c.title}` : `${s.title}, the whole series`;
    ledger.append(db, 'license.checkout', refs[0], { set: setRef, works: items.map(x => x.w.slug) });
    try {
      const ss = await stripe.checkout.sessions.create({
        mode: 'payment', submit_type: 'pay',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: price, product_data: { name: label, description: `${items.length} photographs by ${s.maker}, each yours to keep and share, each numbered in your collection. ${V.money(full)} if collected one by one.`, images: items.slice(0, 3).map(x => `${C.base}/img/${x.w.slug}/thumb`) } } }],
        metadata: { ref: refs[0], set: setRef },
        success_url: `${C.base}/thanks/${refs[0]}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${C.base}/series/${s.slug}${c ? '#ch-' + c.i : ''}`,
      });
      db.prepare('UPDATE licenses SET stripe_session=? WHERE set_ref=?').run(ss.id, setRef);
      res.redirect(303, ss.url);
    } catch (e) { console.error('[set]', e.message); db.prepare("DELETE FROM licenses WHERE set_ref=? AND status='awaiting_payment'").run(setRef); res.redirect(`/series/${s.slug}`); }
  });
  function grantSet(setRef, s) {
    const all = db.prepare("SELECT ref FROM licenses WHERE set_ref=?").all(setRef);
    for (const x of all) { fillBuyer(x.ref, s); grant(x.ref, { paid: true }); }
  }
  // The Journal: Krafft Studios writes, Watermark shows. Every Studios article tagged "watermark"
  // (news, art history, patronage) appears here, linked back to Studios where it was published.
  let journal = { at: 0, posts: [] };
  async function journalPosts() {
    if (Date.now() - journal.at < 10 * 60e3) return journal.posts;
    try {
      const API = process.env.GHOST_CONTENT_API || 'https://krafftstudios.ghost.io/ghost/api/content';
      const KEY = process.env.GHOST_CONTENT_KEY || '8198cc66daa230f254acfaf9d5';
      const r = await (cfg.fetchImpl || fetch)(`${API}/posts/?key=${KEY}&filter=tag:watermark&limit=30&fields=title,slug,url,custom_excerpt,excerpt,feature_image,feature_image_alt,published_at,reading_time&order=published_at%20desc`);
      if (r.ok) journal = { at: Date.now(), posts: ((await r.json()).posts || []) };
    } catch (e) { /* keep what we had */ }
    return journal.posts;
  }
  app.get('/journal', async (req, res) => res.send(V.journal({ posts: await journalPosts() })));
  app.get('/collectors', (req, res) => {
    const list = db.prepare(`SELECT b.id, b.code, b.name, COUNT(DISTINCT l.work_id) AS works, MIN(l.collector_no) AS earliest FROM buyers b
      JOIN licenses l ON l.buyer_id=b.id AND l.status IN ('active','expired') AND l.price_cents > 0 JOIN works w ON w.id=l.work_id AND w.status='held'
      WHERE b.public=1 AND b.code IS NOT NULL GROUP BY b.id ORDER BY works DESC, b.id LIMIT 200`).all();
    const thumbs = db.prepare(`SELECT w.slug, w.title FROM licenses l JOIN works w ON w.id=l.work_id AND w.status='held' WHERE l.buyer_id=? AND l.status IN ('active','expired') AND l.price_cents > 0 GROUP BY w.id ORDER BY MAX(l.starts_at) DESC LIMIT 4`);
    list.forEach(c => { c.thumbs = thumbs.all(c.id); });
    list.forEach(c => { c.founding = foundingNo(c); });
    res.send(V.collectors({ list, left: foundingLeft() }));
  });
  app.get('/collector/:code', (req, res) => {
    const b = db.prepare('SELECT * FROM buyers WHERE code=? AND public=1').get(String(req.params.code));
    if (!b) return res.status(404).send(V.collector({ b: null, items: [], rooms: [], works: 0, makers: 0, own: false, base: C.base }));
    res.send(V.collector({ b, ...collected(b), own: false, base: C.base, pay: payCfg(), share: q.use.get(maker.id, 'social'), founding: foundingNo(b), patronOf: pat.of(b) }));
  });

  app.get('/buy/:slug', (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (!w || w.status !== 'held') return res.sendStatus(404);
    const u = q.use.get(maker.id, String(req.query.use || 'campaign')) || q.uses.all(maker.id)[0];
    res.send(V.ask({ w, maker, u }));
  });

  // The moment after paying: the work is theirs, the file is ready, the email is on its way.
  app.get('/thanks/:ref', async (req, res) => {
    let l = q.lic.get(req.params.ref);
    if (!l || !req.query.session_id || l.stripe_session !== req.query.session_id) return res.redirect(l ? `/c/${l.ref}` : '/');
    if (l.set_ref) { // a set: every photograph in it, numbered, hung together
      if (l.status !== 'active' && stripe) { try { const s = await stripe.checkout.sessions.retrieve(req.query.session_id); if (s.payment_status === 'paid') grantSet(l.set_ref, s); } catch (e) { /* show pending */ } }
      const all = db.prepare('SELECT * FROM licenses WHERE set_ref=? ORDER BY id').all(l.set_ref);
      if (all.every(x => x.status === 'active')) {
        let b = buyerOf(req);
        if (!b) { const id = db.prepare("INSERT INTO buyers (customer, email) VALUES ('', ?)").run(l.licensee_email || null).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); }
        db.prepare('UPDATE licenses SET buyer_id=COALESCE(buyer_id, ?) WHERE set_ref=?').run(b.id, l.set_ref);
      }
      const items = db.prepare('SELECT l.*, w.slug, w.title, w.place FROM licenses l JOIN works w ON w.id=l.work_id WHERE l.set_ref=? ORDER BY l.id').all(l.set_ref);
      return res.send(V.setThanks({ items, name: (SETS[l.set_ref.split(':')[0]] || {}).name || 'The set' }));
    }
    if (l.status !== 'active' && stripe) {
      try { const s = await stripe.checkout.sessions.retrieve(req.query.session_id); if (s.payment_status === 'paid') { fillBuyer(l.ref, s); l = grant(l.ref, { paid: true, price_cents: s.amount_total }); } } catch (e) { /* show pending */ }
    }
    if (l.status === 'active' && !l.buyer_id) { // hang it in this device's collection
      let b = buyerOf(req);
      if (!b) { const id = db.prepare("INSERT INTO buyers (customer, email) VALUES ('', ?)").run(l.licensee_email || null).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); }
      db.prepare('UPDATE licenses SET buyer_id=? WHERE ref=?').run(b.id, l.ref); l = q.lic.get(l.ref);
    }
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    const maker = mk(w); // the work's own maker
    res.send(V.thanks({ lic: l, w, maker, use: q.useById.get(l.use_id) }));
  });

  app.post('/license/:slug', async (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (!w || w.status !== 'held') return res.sendStatus(404);
    const b = req.body; const uses = q.uses.all(maker.id);
    const rules = R.parse(w.rules);
    const u = q.use.get(maker.id, String(b.use || ''));
    const email = String(b.email || '').trim();
    if (!u || !R.allows(rules, u.key) || !b.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !b.agree) {
      return res.status(400).send(V.licenseForm({ w, maker, uses, chosen: b.use, values: b, renews: b.renews, error: 'Please choose a use, give your name and a valid email, and agree to the terms.' }));
    }
    const ref = nextRef();
    const needsMaker = u.price_cents == null || rules.approve || !stripe;
    db.prepare('INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,licensee_company,intended_use,price_cents,status,conditions) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(ref, w.id, u.id, String(b.name).slice(0, 120), email.slice(0, 160), String(b.company || '').slice(0, 160) || null, String(b.intended || '').slice(0, 2000) || null, u.price_cents, needsMaker ? 'requested' : 'awaiting_payment', R.conditions(rules) || null);
    ledger.append(db, 'license.requested', ref, { work: w.slug, use: u.key });
    const renews = /^WM-\d{4}-\d{6}$/.test(String(b.renews || '')) ? String(b.renews) : null;
    if (renews) db.prepare('UPDATE licenses SET renews=? WHERE ref=?').run(renews, ref);
    mail.send({ to: maker.email, ...mail.templates.requestToMaker({ ref, title: w.title, name: b.name, company: b.company, email, use: u.name, intended: b.intended, base: C.base }) });
    if (needsMaker) mail.send({ to: email, ...mail.templates.receivedToLicensee({ ref, title: w.title, name: b.name }) });
    if (!needsMaker) {
      const url = await checkoutUrl(ref);
      return res.redirect(303, url);
    }
    res.send(V.requested({ lic: q.lic.get(ref), w }));
  });

  async function checkoutUrl(ref) {
    const l = q.licFull.get(ref);
    const s = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: l.licensee_email,
      line_items: [{ quantity: 1, price_data: { currency: l.currency, unit_amount: l.price_cents, product_data: { name: `${l.use_name} license: ${l.title}`, description: `Watermark ${ref}. Photograph by ${maker.name}.` } } }],
      metadata: { ref },
      success_url: `${C.base}/c/${ref}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${C.base}/w/${l.slug}`,
    });
    db.prepare("UPDATE licenses SET stripe_session=?, status='awaiting_payment', updated_at=datetime('now') WHERE ref=?").run(s.id, ref);
    return s.url;
  }

  app.get('/c/:ref.pdf', (req, res) => {
    const l = q.licFull.get(req.params.ref);
    if (!l || l.status !== 'active') return res.sendStatus(404);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    const maker = mk(w); // the work's own maker
    const u = q.useById.get(l.use_id);
    const e = q.lastEntryFor.get(l.ref);
    res.type('pdf').set('Content-Disposition', `inline; filename="${l.ref}.pdf"`);
    prov.certificatePdf(res, { ref: l.ref, title: w.title, maker: maker.name, house: maker.house, licensee: l.licensee_company || l.licensee_name, use: u.name, description: u.description, starts: l.starts_at, ends: l.ends_at, fee: l.price_cents != null ? V.money(l.price_cents, l.currency) : null, fingerprint: w.sha256, ledgerHash: e && e.hash, base: C.base, intended: l.intended_use, conditions: l.conditions });
  });

  // Certificate. The licensee returns here from Stripe; if the webhook is slow, check the session directly.
  app.get('/c/:ref', async (req, res) => {
    let l = q.lic.get(req.params.ref);
    if (!l) return res.sendStatus(404);
    let owner = false;
    if (req.query.session_id && stripe && l.stripe_session === req.query.session_id) {
      owner = true;
      if (l.status !== 'active') {
        try { const s = await stripe.checkout.sessions.retrieve(req.query.session_id); if (s.payment_status === 'paid') l = grant(l.ref, { paid: true, price_cents: s.amount_total }); } catch (e) { /* show current status */ }
      }
    }
    if (req.query.k && l.download_token && req.query.k === l.download_token) owner = true;
    if (isStudio(req)) owner = true;
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    const maker = mk(w); // the work's own maker
    res.send(V.certificate({ lic: l, w, maker, use: q.useById.get(l.use_id), entry: q.lastEntryFor.get(l.ref), base: C.base, owner }));
  });

  app.get('/d/:token', async (req, res) => {
    const l = db.prepare("SELECT * FROM licenses WHERE download_token=?").get(req.params.token);
    if (!l || l.status !== 'active' || (l.ends_at && new Date(l.ends_at) < new Date())) return res.sendStatus(404);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    const maker = mk(w); // the work's own maker
    ledger.append(db, 'file.delivered', l.ref, { work: w.slug });
    const lu = q.useById.get(l.use_id);
    let file; try { file = await originalPath(w); if (lu && lu.key === 'social') file = await images.derivative(file, cache, w.slug, 'large'); } catch (e) { return res.sendStatus(503); }
    const name = `${w.slug}-${l.ref}${lu && lu.key === 'social' ? '.jpg' : path.extname(w.original_file)}`;
    if (/\.jpe?g$/i.test(file)) {
      try {
        const u = lu;
        const buf = prov.stampJpeg(file, { ref: l.ref, maker: maker.name, licensee: l.licensee_company || l.licensee_name, use: u.name, ends: l.ends_at, fingerprint: w.sha256, base: C.base, conditions: l.conditions });
        res.set('Content-Disposition', `attachment; filename="${name}"`);
        return res.type('jpg').send(buf);
      } catch (e) { /* fall through to the untouched original */ }
    }
    res.download(file, name);
  });

  app.get('/verify', (req, res) => {
    const ref = String(req.query.ref || '').trim().toUpperCase();
    const lic = ref ? q.lic.get(ref) : null;
    const w = lic ? db.prepare('SELECT * FROM works WHERE id=?').get(lic.work_id) : null;
    const maker = mk(w); // the work's own maker
    res.send(V.verify({ ref, lic, w, notFound: ref && !lic }));
  });

  app.get('/ledger', (req, res) => res.send(V.ledgerPage({ entries: db.prepare('SELECT * FROM ledger ORDER BY seq DESC LIMIT 500').all(), check: ledger.verify(db) })));
  app.get('/ledger.json', (req, res) => res.json({ check: ledger.verify(db), entries: db.prepare('SELECT * FROM ledger ORDER BY seq').all() }));

  // --- Studio ---
  app.get('/studio/login', (req, res) => res.send(S.login({})));
  app.post('/studio/login', (req, res) => {
    const ok = C.adminPassword && crypto.timingSafeEqual(crypto.createHash('sha256').update(String(req.body.password || '')).digest(), crypto.createHash('sha256').update(C.adminPassword).digest());
    if (!ok) return res.status(401).send(S.login({ error: C.adminPassword ? 'That password is not right.' : 'Set ADMIN_PASSWORD on the server first.' }));
    const exp = String(Date.now() + 1000 * 60 * 60 * 24 * 14);
    res.cookie('wm_s', `${exp}.${sign(exp)}`, { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 1000 * 60 * 60 * 24 * 14 });
    res.redirect('/studio');
  });
  app.get('/studio/logout', (req, res) => { res.clearCookie('wm_s'); res.redirect('/'); });

  // The Trove: the maker's private gallery of everything they hold, and what each work has done in its life.
  function troveRows() {
    return db.prepare(`SELECT w.*,
      (SELECT COALESCE(SUM(price_cents),0) FROM licenses l WHERE l.work_id=w.id AND l.status IN ('active','expired')) AS earned,
      (SELECT COUNT(*) FROM licenses l WHERE l.work_id=w.id AND l.status IN ('active','expired')) AS licensed,
      (SELECT COUNT(*) FROM licenses l WHERE l.work_id=w.id AND l.status='active') AS active,
      (SELECT COALESCE(SUM(count),0) FROM views v WHERE v.work_id=w.id) AS seen,
      (SELECT COALESCE(SUM(count),0) FROM views v WHERE v.work_id=w.id AND v.day >= date('now','-30 day')) AS seen30,
      (SELECT COUNT(DISTINCT host) FROM views v WHERE v.work_id=w.id AND v.kind='embed' AND v.host IS NOT NULL) AS sites,
      (SELECT COUNT(*) FROM sightings s WHERE s.work_id=w.id) AS sightings,
      (SELECT COUNT(*) FROM seals s WHERE s.work_id=w.id AND s.status='open') AS sealed,
      (SELECT GROUP_CONCAT(c.title, ' · ') FROM collection_works cw JOIN collections c ON c.id=cw.collection_id WHERE cw.work_id=w.id) AS rooms
      FROM works w ORDER BY w.id DESC`).all().map(w => {
        const missing = [];
        if (!w.caption) missing.push('caption'); if (!w.place) missing.push('place'); if (!w.taken_at) missing.push('date');
        if (!w.keywords) missing.push('keywords'); if (!w.rooms) missing.push('a collection');
        return { ...w, missing, complete: Math.round(100 * (5 - missing.length) / 5) };
      });
  }
  app.get('/studio', studioOnly, (req, res) => {
    let rows = troveRows();
    const room = req.query.room ? db.prepare('SELECT * FROM collections WHERE slug=?').get(String(req.query.room)) : null;
    if (room) { const ids = new Set(db.prepare('SELECT work_id FROM collection_works WHERE collection_id=?').all(room.id).map(r => r.work_id)); rows = rows.filter(w => ids.has(w.id)); }
    const sorts = { earned: (a, b) => b.earned - a.earned || b.seen - a.seen, seen: (a, b) => b.seen - a.seen, newest: (a, b) => b.id - a.id, taken: (a, b) => String(b.taken_at || '').localeCompare(String(a.taken_at || '')), untapped: (a, b) => (b.licensed ? -1 : b.seen) - (a.licensed ? -1 : a.seen), unfinished: (a, b) => a.complete - b.complete };
    const sort = sorts[req.query.sort] ? req.query.sort : 'earned';
    rows.sort(sorts[sort]);
    const all = troveRows();
    const totals = { works: all.length, earned: all.reduce((a, w) => a + w.earned, 0), licensed: all.filter(w => w.licensed).length, seen: all.reduce((a, w) => a + w.seen, 0), sealed: all.reduce((a, w) => a + w.sealed, 0), complete: all.length ? Math.round(all.reduce((a, w) => a + w.complete, 0) / all.length) : 0 };
    const untapped = all.filter(w => !w.licensed && w.seen > 0).sort((a, b) => b.seen - a.seen).slice(0, 3);
    res.send(S.trove({ maker, rows, totals, sort, room, rooms: db.prepare('SELECT c.*, (SELECT COUNT(*) FROM collection_works cw WHERE cw.collection_id=c.id) n FROM collections c ORDER BY sort, id').all(), untapped, notice: req.query.ok }));
  });

  // Collections: the maker's rooms. Private by default; a public room has its own page.
  app.post('/studio/collections', studioOnly, (req, res) => {
    const title = String(req.body.title || '').trim().slice(0, 120); if (!title) return res.redirect('/studio');
    let slug = slugify(title), i = 2; while (db.prepare('SELECT 1 FROM collections WHERE slug=?').get(slug)) slug = `${slugify(title)}-${i++}`;
    db.prepare('INSERT INTO collections (slug,title,note,public) VALUES (?,?,?,?)').run(slug, title, String(req.body.note || '').slice(0, 2000) || null, req.body.public ? 1 : 0);
    res.redirect(`/studio?room=${slug}&ok=${encodeURIComponent(`"${title}" is open. Add works to it from their catalogue pages.`)}`);
  });
  app.get('/rooms/:slug', (req, res) => {
    const c = db.prepare('SELECT * FROM collections WHERE slug=? AND public=1').get(req.params.slug); if (!c) return res.sendStatus(404);
    const works = db.prepare("SELECT w.* FROM collection_works cw JOIN works w ON w.id=cw.work_id WHERE cw.collection_id=? AND w.status='held' ORDER BY cw.sort, w.id").all(c.id);
    res.send(V.room({ c, works, maker }));
  });

  // The catalogue record for one work.
  app.post('/studio/works/:slug/catalogue', studioOnly, (req, res) => {
    const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404);
    const b = req.body; const t = (v, n) => String(v || '').trim().slice(0, n) || null;
    db.prepare('UPDATE works SET title=COALESCE(?,title), caption=?, place=?, keywords=?, credit=?, medium=? WHERE id=?')
      .run(t(b.title, 160), t(b.caption, 4000), t(b.place, 160), t(b.keywords, 400), t(b.credit, 200), t(b.medium, 120), w.id);
    // Share it price for this photograph alone: whole dollars, $3 at least; empty = the maker's standard price.
    const sp = String(b.share || '').trim(); const sc = sp === '' || !(Number(sp) >= 0) ? null : Math.max(3, Math.round(Number(sp))) * 100;
    db.prepare('UPDATE works SET share_cents=? WHERE id=?').run(sc, w.id);
    // Edition size: blank for an open edition. It can never be set below what has already been collected.
    const es = String(b.edition || '').trim(); const ed = edition({ ...w, edition_size: 1 });
    db.prepare('UPDATE works SET edition_size=? WHERE id=?').run(es === '' || !(Number(es) > 0) ? null : Math.max(Math.round(Number(es)), ed ? ed.sold : 0), w.id);
    // A work too important to share at any price: license only.
    const rl = R.parse(w.rules); rl.social = b.noshare === '1' ? false : undefined; db.prepare('UPDATE works SET rules=? WHERE id=?').run(JSON.stringify(rl), w.id);
    const ids = (b.rooms == null ? [] : Array.isArray(b.rooms) ? b.rooms : [b.rooms]).map(Number).filter(Boolean);
    db.prepare('DELETE FROM collection_works WHERE work_id=?').run(w.id);
    for (const cid of ids) if (db.prepare('SELECT 1 FROM collections WHERE id=?').get(cid)) db.prepare('INSERT OR IGNORE INTO collection_works (collection_id, work_id) VALUES (?,?)').run(cid, w.id);
    res.redirect(`/studio/works/${w.slug}?ok=${encodeURIComponent('Catalogue record saved.')}`);
  });

  app.get('/studio/activity', studioOnly, (req, res) => {
    const stats = {
      works: db.prepare("SELECT COUNT(*) n FROM works").get().n,
      active: db.prepare("SELECT COUNT(*) n FROM licenses WHERE status='active'").get().n,
      open: db.prepare("SELECT COUNT(*) n FROM licenses WHERE status IN ('requested','awaiting_payment')").get().n,
      earned: db.prepare("SELECT SUM(price_cents) s FROM licenses WHERE status='active'").get().s,
      views: db.prepare("SELECT COALESCE(SUM(count),0) n FROM views WHERE day >= date('now','-30 day')").get().n,
    };
    const views = db.prepare("SELECT host, kind, SUM(count) n FROM views WHERE day >= date('now','-30 day') GROUP BY host, kind ORDER BY n DESC LIMIT 20").all();
    const ending = db.prepare("SELECT l.ref, l.ends_at, l.renewal_sent_at, w.title, l.licensee_company, l.licensee_name FROM licenses l JOIN works w ON w.id=l.work_id WHERE l.status='active' AND l.ends_at IS NOT NULL AND l.ends_at <= ? ORDER BY l.ends_at").all(new Date(Date.now() + 60 * 864e5).toISOString());
    res.send(S.overview({ maker, stats, recent: q.licList.all(8), views, ending, notice: req.query.ok }));
  });

  const upload = multer({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: 250 * 1024 * 1024 }, fileFilter: (req, f, cb) => cb(null, /^image\//.test(f.mimetype)) });
  app.get('/studio/works', studioOnly, (req, res) => res.send(S.works({ list: q.allWorks.all(), notice: req.query.ok, rooms: db.prepare('SELECT id, title FROM collections ORDER BY sort, id').all() })));
  app.post('/studio/works', studioOnly, upload.single('file'), async (req, res) => {
    if (!req.file || !req.body.title) return res.status(400).send(S.works({ list: q.allWorks.all(), error: 'Choose a photograph and give it a title.' }));
    try {
      const w = await registerWork({ file: req.file.path, originalName: req.file.originalname, ...req.body });
      res.redirect(`/studio/works?ok=${encodeURIComponent(`"${w.title}" is held and registered.`)}`);
    } catch (e) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(400).send(S.works({ list: q.allWorks.all(), error: e.user ? e.message : 'That file could not be read as a photograph.' }));
    }
  });
  // Bulk registration: the page sends one file per request, so hundreds of masters go in one by one,
  // each fingerprinted and on the ledger, with no giant upload to time out. Duplicates are refused.
  const titleFrom = n => String(n || 'Untitled').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Untitled';
  app.post('/studio/works/one', studioOnly, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Not an image file.' });
    try {
      const w = await registerWork({ file: req.file.path, originalName: req.file.originalname, title: String(req.body.title || '').trim() || titleFrom(req.file.originalname), place: req.body.place, source_url: req.body.source_url });
      const cid = Number(req.body.room); if (cid && db.prepare('SELECT 1 FROM collections WHERE id=?').get(cid)) db.prepare('INSERT OR IGNORE INTO collection_works (collection_id, work_id) VALUES (?,?)').run(cid, w.id);
      if (req.body.hidden === '1') db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(w.id);
      res.json({ ok: true, slug: w.slug, title: w.title, accession: q.work.get(w.slug).accession });
    } catch (e) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(e.user ? 409 : 400).json({ ok: false, error: e.user ? e.message : 'Could not be read as a photograph.' });
    }
  });
  // ---------- Masters: full-resolution files from the maker's own archive ----------
  // Each file is matched by its visual fingerprint to the web copy already held (from Krafft Studios)
  // and replaces it as the original, on the ledger. A file with no match is registered privately.
  const PLACES = { HVNY: 'Hudson Valley, New York', NYC: 'New York', 'NEW YORK': 'New York', BOSTON: 'Boston', ZURICH: 'Zurich, Switzerland', DEIDESHEIM: 'Deidesheim, Germany',
    PARIS: 'Paris, France', MARLING: 'Marling, South Tyrol, Italy', 'SOUTH TYROL': 'South Tyrol, Italy', MILAN: 'Milan, Italy', COMO: 'Lake Como, Italy', 'LE MARCHE': 'Le Marche, Italy', BERLIN: 'Berlin, Germany',
    GARDA: 'Lake Garda, Italy', 'LAKE GARDA': 'Lake Garda, Italy', LONDON: 'London', MALLORCA: 'Mallorca, Spain', WETZLAR: 'Wetzlar, Germany', FLORENCE: 'Florence, Italy', KRONBERG: 'Kronberg, Germany' };
  const placeFromFolder = folder => {
    const parts = String(folder || '').split('/').map(x => x.replace(/^\d+_/, '').replace(/_/g, ' ').toUpperCase().trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) if (PLACES[parts[i]]) return PLACES[parts[i]];
    return null;
  };
  let hashed = false;
  async function ensureHashes() { // works registered before fingerprints existed
    if (hashed) return; hashed = true;
    for (const w of db.prepare('SELECT * FROM works WHERE dhash IS NULL').all()) {
      try { db.prepare('UPDATE works SET dhash=? WHERE id=?').run(await images.dhash(await originalPath(w)), w.id); } catch (e) { /* missing original: leave it */ }
    }
  }
  app.post('/studio/masters/one', studioOnly, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Not an image file.' });
    const file = req.file.path, gone = () => { if (fs.existsSync(file)) fs.unlinkSync(file); };
    try {
      await ensureHashes();
      const info = await images.inspect(file);
      const held = db.prepare('SELECT slug FROM works WHERE sha256=?').get(info.sha256);
      if (held) { gone(); return res.json({ ok: true, outcome: 'known', slug: held.slug }); }
      const h = await images.dhash(file);
      let best = null, bestD = 99;
      for (const w of db.prepare('SELECT id, slug, dhash, width, height FROM works WHERE dhash IS NOT NULL').all()) {
        const d = images.hamming(h, w.dhash);
        if (d < bestD && (w.width / w.height > 1) === (info.width / info.height > 1)) { best = w; bestD = d; }
      }
      if (best && bestD <= 6) {
        if ((best.width || 0) >= info.width) { gone(); return res.json({ ok: true, outcome: 'smaller', slug: best.slug }); }
        const w = q.work.get(best.slug);
        const ext = (path.extname(req.file.originalname) || '.jpg').toLowerCase();
        const name = `${w.slug}-master${ext}`, dest = path.join(originals, name);
        fs.mkdirSync(originals, { recursive: true });
        try { fs.renameSync(file, dest); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(file, dest); fs.unlinkSync(file); }
        await store.put('originals/' + name, dest, /\.png$/.test(ext) ? 'image/png' : /\.tiff?$/.test(ext) ? 'image/tiff' : 'image/jpeg');
        db.prepare(`UPDATE works SET original_file=?, sha256=?, width=?, height=?, dhash=?, master_at=datetime('now'),
          camera=COALESCE(?, camera), lens=COALESCE(?, lens), taken_at=COALESCE(?, taken_at) WHERE id=?`)
          .run(name, info.sha256, info.width, info.height, h, info.camera, info.lens, info.taken_at, w.id);
        for (const sz of Object.keys(images.SIZES)) { const c = path.join(cache, `${w.slug}-${sz}.jpg`); if (fs.existsSync(c)) fs.unlinkSync(c); }
        const old = path.join(originals, w.original_file); if (w.original_file !== name && fs.existsSync(old)) fs.unlinkSync(old);
        if (store.kind === 's3') fs.unlinkSync(dest);
        ledger.append(db, 'work.master', w.slug, { fingerprint: info.sha256, previous: w.sha256, width: info.width, height: info.height, camera: info.camera, taken: info.taken_at });
        return res.json({ ok: true, outcome: 'master', slug: w.slug, title: w.title, distance: bestD });
      }
      // Not yet published anywhere: into the archive, private.
      const place = placeFromFolder(req.body.folder);
      const frame = (req.file.originalname.match(/(\d+)\.[a-z]+$/i) || [])[1];
      const nw = await registerWork({ file, originalName: req.file.originalname, title: `${place ? place.split(',')[0] : 'Archive'}${frame ? `, frame ${frame}` : ''}`, place });
      db.prepare("UPDATE works SET status='hidden', credit=COALESCE(credit, 'Krafft Studios') WHERE id=?").run(nw.id);
      const roomSlug = 'archive-' + slugify(place ? place.split(',')[0] : 'unsorted');
      let c = db.prepare('SELECT id FROM collections WHERE slug=?').get(roomSlug);
      if (!c) { db.prepare('INSERT INTO collections (slug,title,note,public,sort) VALUES (?,?,?,0,900)').run(roomSlug, `Archive · ${place ? place.split(',')[0] : 'Unsorted'}`, 'Full-resolution frames from the archive, held privately.'); c = db.prepare('SELECT id FROM collections WHERE slug=?').get(roomSlug); }
      db.prepare('INSERT OR IGNORE INTO collection_works (collection_id, work_id) VALUES (?,?)').run(c.id, nw.id);
      res.json({ ok: true, outcome: 'archive', slug: nw.slug, title: nw.title });
    } catch (e) {
      gone();
      res.status(e.user ? 409 : 400).json({ ok: false, error: e.user ? e.message : 'Could not be read as a photograph.' });
    }
  });
  app.get('/studio/masters', studioOnly, (req, res) => res.send(S.masters({
    upgraded: db.prepare('SELECT COUNT(*) n FROM works WHERE master_at IS NOT NULL').get().n,
    web: db.prepare('SELECT COUNT(*) n FROM works WHERE master_at IS NULL').get().n })));

  app.post('/studio/works/:slug/toggle', studioOnly, (req, res) => {
    db.prepare("UPDATE works SET status = CASE status WHEN 'held' THEN 'hidden' ELSE 'held' END WHERE slug=?").run(req.params.slug);
    res.redirect('/studio/works');
  });

  // --- sealed files ---
  // The maker seals a full-resolution copy for someone. It opens only in the Watermark viewer.
  app.post('/studio/works/:slug/seal', studioOnly, async (req, res) => {
    const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404);
    const maker = mk(w); // the work's own maker
    const size = req.body.size === 'original' ? 'original' : 'large';
    const days = Number(req.body.days) || 0;
    const sharp = require('sharp');
    const orig = await originalPath(w);
    let image = size === 'large' ? fs.readFileSync(await images.derivative(orig, cache, w.slug, 'large')) : fs.readFileSync(orig);
    if (size === 'original' && !/\.(jpe?g|png)$/i.test(w.original_file)) image = await sharp(image).rotate().jpeg({ quality: 95 }).toBuffer();
    const preview = fs.readFileSync(await images.derivative(orig, cache, w.slug, 'thumb'));
    const id = nanoid(14), access = nanoid(24);
    const expires = days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null;
    const rules = R.parse(w.rules);
    const header = { v: 1, id, access, keys: `${C.base}/k/${id}`, work: w.slug, title: w.title, maker: maker.name, house: maker.house,
      credit: `Photograph by ${maker.name}`, fingerprint: w.sha256, conditions: R.conditions(rules) || null, expires, license: `${C.base}/license/${w.slug}`, sealed: new Date().toISOString() };
    const { key, file } = SEAL.seal({ image, preview, header });
    fs.mkdirSync(path.join(C.dataDir, 'seals'), { recursive: true });
    fs.writeFileSync(path.join(C.dataDir, 'seals', id + '.wmk'), file);
    await store.put(`seals/${id}.wmk`, file, 'application/vnd.watermark.sealed');
    db.prepare('INSERT INTO seals (id,work_id,label,size,access,wrapped_key,expires_at) VALUES (?,?,?,?,?,?,?)').run(id, w.id, String(req.body.label || '').slice(0, 120) || null, size, access, SEAL.wrap(key, C.secret), expires);
    ledger.append(db, 'seal.created', id, { work: w.slug, size, expires });
    res.redirect(`/studio/works/${w.slug}?ok=${encodeURIComponent('Sealed. Download the file and send it however you like.')}#seals`);
  });
  app.get('/studio/seals/:id.wmk', studioOnly, async (req, res) => {
    const s = db.prepare('SELECT s.*, w.slug FROM seals s JOIN works w ON w.id=s.work_id WHERE s.id=?').get(req.params.id); if (!s) return res.sendStatus(404);
    const local = path.join(C.dataDir, 'seals', s.id + '.wmk');
    const buf = fs.existsSync(local) ? fs.readFileSync(local) : await store.get(`seals/${s.id}.wmk`);
    if (!buf) return res.sendStatus(404);
    res.set('Content-Disposition', `attachment; filename="${s.slug}.wmk"`).type('application/vnd.watermark.sealed').send(buf);
  });
  app.post('/studio/seals/:id/:act', studioOnly, (req, res) => {
    const s = db.prepare('SELECT s.*, w.slug FROM seals s JOIN works w ON w.id=s.work_id WHERE s.id=?').get(req.params.id); if (!s) return res.sendStatus(404);
    const status = req.params.act === 'close' ? 'closed' : 'open';
    db.prepare('UPDATE seals SET status=? WHERE id=?').run(status, s.id);
    ledger.append(db, status === 'closed' ? 'seal.closed' : 'seal.reopened', s.id, { work: s.slug });
    res.redirect(`/studio/works/${s.slug}#seals`);
  });

  // The key desk. Every opening of a sealed file comes here; the answer is the maker's to give.
  app.post('/k/:id', (req, res) => {
    const s = db.prepare('SELECT * FROM seals WHERE id=?').get(req.params.id);
    const a = String(req.body.access || '');
    if (!s || a.length !== s.access.length || !crypto.timingSafeEqual(Buffer.from(a), Buffer.from(s.access))) return res.status(404).json({ open: false, reason: 'This file was not sealed on Watermark.' });
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(s.work_id);
    if (s.status !== 'open') return res.status(403).json({ open: false, reason: 'The maker has closed this file.', license: `${C.base}/license/${w.slug}` });
    if (s.expires_at && new Date(s.expires_at) < new Date()) return res.status(403).json({ open: false, reason: 'This file has expired.', license: `${C.base}/license/${w.slug}` });
    const host = String(req.body.host || '').toLowerCase().replace(/[^a-z0-9.\-:]/g, '').slice(0, 120) || null;
    const now = new Date().toISOString();
    db.prepare('UPDATE seals SET opens=opens+1, last_opened_at=? WHERE id=?').run(now, s.id);
    db.prepare('INSERT INTO seal_opens (seal_id,day,host) VALUES (?,?,?) ON CONFLICT(seal_id,day,host) DO UPDATE SET count=count+1').run(s.id, now.slice(0, 10), host);
    res.set('Cache-Control', 'no-store').json({ open: true, key: SEAL.unwrap(s.wrapped_key, C.secret).toString('base64') });
  });
  app.get('/view', (req, res) => res.send(V.viewer()));

  // The maker's say, per work.
  app.get('/studio/works/:slug', studioOnly, (req, res) => {
    const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404);
    const seen = db.prepare('SELECT * FROM sightings WHERE work_id=? ORDER BY id DESC').all(w.id);
    const lic = db.prepare("SELECT l.*, u.name AS use_name FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=? ORDER BY l.id DESC").all(w.id);
    const seals = db.prepare('SELECT * FROM seals WHERE work_id=? ORDER BY created_at DESC').all(w.id);
    const rooms = db.prepare('SELECT c.*, EXISTS(SELECT 1 FROM collection_works cw WHERE cw.collection_id=c.id AND cw.work_id=?) AS has FROM collections c ORDER BY sort, id').all(w.id);
    const views = db.prepare("SELECT host, kind, SUM(count) n, MIN(day) first, MAX(day) last FROM views WHERE work_id=? GROUP BY host, kind ORDER BY n DESC").all(w.id);
    res.send(S.workTerms({ makerName: mk(w).name, rooms, views, w, rules: R.parse(w.rules), uses: q.uses.all(maker.id), NEVER: R.NEVER, seen, lic, seals, notice: req.query.ok }));
  });
  app.post('/studio/works/:slug', studioOnly, (req, res) => {
    const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404);
    const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
    const all = q.uses.all(maker.id).map(u => u.key);
    const open = arr(req.body.uses).filter(k => all.includes(k));
    const rules = { uses: open.length === all.length ? null : open, approve: req.body.approve === '1', never: arr(req.body.never).filter(k => R.NEVER[k]), credit: req.body.credit === '1', showEarned: req.body.showEarned === '1', ...(open.includes('social') ? {} : { social: false }) };
    db.prepare('UPDATE works SET rules=? WHERE id=?').run(JSON.stringify(rules), w.id);
    ledger.append(db, 'work.terms', w.slug, { open: rules.uses || 'all', approve: rules.approve, never: rules.never });
    res.redirect(`/studio/works/${w.slug}?ok=${encodeURIComponent('Your terms are saved. They apply to every new license.')}`);
  });
  app.get('/studio/sightings', studioOnly, (req, res) => res.send(S.sightings({ list: db.prepare('SELECT s.*, w.title, w.slug FROM sightings s JOIN works w ON w.id=s.work_id ORDER BY s.id DESC').all(), embeds: db.prepare("SELECT v.host, w.title, w.slug, SUM(v.count) AS n, MAX(v.day) AS last FROM views v JOIN works w ON w.id=v.work_id WHERE v.kind='embed' AND v.host IS NOT NULL GROUP BY v.host, w.id ORDER BY last DESC").all(), base: C.base })));
  app.post('/studio/sightings/:id', studioOnly, (req, res) => {
    if (['new', 'licensed', 'offered', 'resolved'].includes(req.body.status)) db.prepare('UPDATE sightings SET status=? WHERE id=?').run(req.body.status, req.params.id);
    res.redirect('/studio/sightings');
  });
  app.get('/studio/makers', studioOnly, (req, res) => res.send(S.makers({ list: db.prepare('SELECT * FROM applications ORDER BY id DESC').all() })));
  app.post('/studio/makers/:id', studioOnly, (req, res) => {
    if (['new', 'invited', 'declined'].includes(req.body.status)) db.prepare('UPDATE applications SET status=? WHERE id=?').run(req.body.status, req.params.id);
    res.redirect('/studio/makers');
  });

  app.get('/studio/licenses', studioOnly, (req, res) => res.send(S.licenses({ list: db.prepare('SELECT l.*, w.title, u.name AS use_name FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id ORDER BY l.id DESC').all() })));
  app.get('/studio/licenses/:ref', studioOnly, (req, res) => {
    const l = q.licFull.get(req.params.ref); if (!l) return res.sendStatus(404);
    res.send(S.licenseDetail({ l, notice: req.query.ok, payLink: req.query.pay }));
  });
  app.post('/studio/licenses/:ref/quote', studioOnly, async (req, res) => {
    const l = q.lic.get(req.params.ref); if (!l) return res.sendStatus(404);
    const cents = Math.round(Number(req.body.price) * 100);
    if (!(cents > 0)) return res.redirect(`/studio/licenses/${l.ref}`);
    db.prepare("UPDATE licenses SET price_cents=?, status='awaiting_payment', updated_at=datetime('now') WHERE ref=?").run(cents, l.ref);
    ledger.append(db, 'license.quoted', l.ref, { currency: l.currency });
    if (!stripe) return res.redirect(`/studio/licenses/${l.ref}?ok=${encodeURIComponent('Fee saved. Connect Stripe (STRIPE_SECRET_KEY) to send a payment link.')}`);
    const url = await checkoutUrl(l.ref);
    const lf = q.licFull.get(l.ref);
    mail.send({ to: lf.licensee_email, ...mail.templates.payToLicensee({ ref: l.ref, title: lf.title, name: lf.licensee_name, fee: V.money(cents), url }) });
    res.redirect(`/studio/licenses/${l.ref}?ok=${encodeURIComponent(process.env.RESEND_API_KEY ? 'Payment link sent to the licensee.' : 'Payment link ready. Send it to the licensee.')}&pay=${encodeURIComponent(url)}`);
  });
  app.post('/studio/licenses/:ref/grant', studioOnly, (req, res) => { grant(req.params.ref, { paid: false }); res.redirect(`/studio/licenses/${req.params.ref}?ok=Granted`); });
  app.post('/studio/licenses/:ref/decline', studioOnly, (req, res) => {
    db.prepare("UPDATE licenses SET status='declined', updated_at=datetime('now') WHERE ref=? AND status!='active'").run(req.params.ref);
    ledger.append(db, 'license.declined', req.params.ref, {});
    res.redirect(`/studio/licenses/${req.params.ref}?ok=Declined`);
  });

  app.get('/studio/uses', studioOnly, (req, res) => res.send(S.uses({ list: q.uses.all(maker.id), notice: req.query.ok })));
  app.post('/studio/uses/:key', studioOnly, (req, res) => {
    const v = String(req.body.price || '').trim();
    // Whole dollars only. Share it has a floor: below $3 the card fee eats the maker's share.
    let cents = v === '' ? null : Math.round(Number(v)) * 100;
    if (cents !== null && !(cents >= 0)) return res.redirect('/studio/uses');
    if (req.params.key === 'social' && cents !== null && cents < 300) cents = 300;
    db.prepare('UPDATE uses SET price_cents=? WHERE maker_id=? AND key=?').run(cents, maker.id, req.params.key);
    res.redirect('/studio/uses?ok=Saved');
  });

  // Renewals: expire what has ended; remind licensees 30 days before the end.
  function sweep() {
    db.prepare("UPDATE licenses SET status='expired', updated_at=datetime('now') WHERE status='active' AND ends_at IS NOT NULL AND ends_at < ?").run(new Date().toISOString());
    const soon = new Date(Date.now() + 30 * 864e5).toISOString();
    const due = db.prepare("SELECT l.*, w.title, w.slug, u.key AS use_key FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE l.status='active' AND l.ends_at IS NOT NULL AND l.ends_at <= ? AND l.renewal_sent_at IS NULL").all(soon);
    for (const l of due) {
      mail.send({ to: l.licensee_email, ...mail.templates.renewalToLicensee({ ref: l.ref, title: l.title, name: l.licensee_name, ends: l.ends_at, url: `${C.base}/license/${l.slug}?use=${l.use_key}&renews=${l.ref}` }) });
      db.prepare("UPDATE licenses SET renewal_sent_at=? WHERE ref=?").run(new Date().toISOString(), l.ref);
      ledger.append(db, 'license.renewal_offered', l.ref, {});
    }
    return due.length;
  }
  if (!cfg.noTimers) { setTimeout(sweep, 5000).unref(); setInterval(sweep, 6 * 3600e3).unref(); }
  // Back the database up to the vault every six hours, and once shortly after start.
  if (!cfg.noTimers && store.kind === 's3') { const b = () => backupDb().then(k => console.log('[backup]', k)).catch(e => console.error('[backup]', e.message)); setTimeout(b, 60e3).unref(); setInterval(b, 6 * 3600e3).unref(); }
  app.post('/studio/backup', studioOnly, async (req, res) => { try { const k = await backupDb(); res.redirect(`/studio/activity?ok=${encodeURIComponent('Backed up to the vault: ' + k)}`); } catch (e) { res.redirect(`/studio/activity?ok=${encodeURIComponent('Backup failed: ' + e.message)}`); } });
  // Studios → Watermark: every photograph published on Krafft Studios is held here (see studios-sync.js).
  const sync = require('./studios-sync').createSync({ db, registerWork, slugify, fetchImpl: cfg.fetchImpl || fetch, stageDir: path.join(C.dataDir, 'incoming') });
  if (!cfg.noTimers && process.env.STUDIOS_SYNC !== 'off') { setTimeout(() => sync.run().catch(e => console.error('[studios-sync]', e.message)), 20e3).unref(); setInterval(() => sync.run().catch(e => console.error('[studios-sync]', e.message)), 6 * 3600e3).unref(); }
  app.post('/studio/sync', studioOnly, (req, res) => { sync.run().catch(e => console.error('[studios-sync]', e.message)); res.redirect('/studio?ok=' + encodeURIComponent('Pulling new photographs from Krafft Studios. They appear as they arrive.')); });
  app.post('/studio/renewals', studioOnly, (req, res) => res.redirect(`/studio/activity?ok=${encodeURIComponent(sweep() + ' renewal notices sent.')}`));

  app.get('/healthz', (req, res) => res.json({ ok: true, ledger: ledger.verify(db).ok }));
  app.use((req, res) => res.status(404).send(V.layout({ title: 'Not found · Watermark', body: '<section class="narrow"><h1>Nothing is held here.</h1><p><a href="/">See the collection</a></p></section>' })));

  Object.assign(app.locals, { backupDb, store, fillBuyer, db, registerWork, grant, maker, C, sweep, sync });
  return app;
}

module.exports = { createApp, slugify };
