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
    webhookSecret: cfg.webhookSecret !== undefined ? cfg.webhookSecret : process.env.STRIPE_WEBHOOK_SECRET,
    maker: cfg.maker || { handle: process.env.MAKER_HANDLE || 'krafft', name: process.env.MAKER_NAME || 'Will Fullerton', house: process.env.MAKER_HOUSE || 'Krafft Studios', email: process.env.MAKER_EMAIL || 'will@krafftco.com' },
  };
  const db = open(path.join(C.dataDir, 'watermark.db'));
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='renewal_sent_at'").get()) db.exec('ALTER TABLE licenses ADD COLUMN renewal_sent_at TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='renews'").get()) db.exec('ALTER TABLE licenses ADD COLUMN renews TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='conditions'").get()) db.exec('ALTER TABLE licenses ADD COLUMN conditions TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='rules'").get()) db.exec('ALTER TABLE works ADD COLUMN rules TEXT');
  // Catalogue fields, kept the way a museum keeps a record: an accession number, medium, keywords, credit line.
  for (const [c, t] of [['accession', 'TEXT'], ['medium', 'TEXT'], ['keywords', 'TEXT'], ['credit', 'TEXT'], ['dhash', 'TEXT'], ['master_at', 'TEXT']])
    if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
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
    const start = new Date();
    const end = u.term_months ? new Date(start.getTime()) : null;
    if (end) end.setUTCMonth(end.getUTCMonth() + u.term_months);
    const token = u.kind === 'print' ? null : nanoid(32);
    db.prepare("UPDATE licenses SET status='active', starts_at=?, ends_at=?, download_token=?, price_cents=COALESCE(?, price_cents), updated_at=datetime('now') WHERE ref=?")
      .run(start.toISOString(), end ? end.toISOString() : null, token, extra.price_cents ?? null, ref);
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

  async function registerWork({ file, title, place, caption, source_url, originalName }) {
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
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(maker.id, slug, title, caption || null, place || null, info.taken_at, info.camera, info.lens, info.width, info.height, path.basename(dest), info.sha256, source_url || null);
    const nw = q.work.get(slug);
    db.prepare("UPDATE works SET accession=?, medium=COALESCE(medium, 'Digital photograph'), dhash=? WHERE id=?").run(accession(nw), await images.dhash(dest).catch(() => null), nw.id);
    if (store.kind === 's3') fs.unlinkSync(dest); // the vault holds it; the disk is only a cache
    ledger.append(db, 'work.registered', slug, { maker: maker.handle, fingerprint: info.sha256, camera: info.camera, taken: info.taken_at, accession: accession(nw) });
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
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${['/', '/collection', '/about', '/terms', '/verify', '/ledger'].map(u).join('')}${ws.map(img).join('')}${ws.map(w => u(`/w/${w.slug}/life`)).join('')}${rooms.map(r => u(`/rooms/${r.slug}`)).join('')}</urlset>`);
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
      if (ref && s.payment_status === 'paid') { fillBuyer(ref, s); grant(ref, { paid: true, price_cents: s.amount_total }); }
    }
    res.json({ received: true });
  });

  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.json({ limit: '64kb' }));

  // --- auth for the Studio ---
  const sign = v => crypto.createHmac('sha256', C.secret).update(v).digest('hex');
  const isStudio = req => { const c = req.cookies.wm_s; if (!c) return false; const [exp, mac] = c.split('.'); return mac === sign(exp) && Date.now() < +exp; };
  const studioOnly = (req, res, next) => isStudio(req) ? next() : res.redirect('/studio/login');

  // --- public pages ---
  app.get('/', (req, res) => res.send(V.home({ maker, works: q.publicWorks.all(), uses: q.uses.all(maker.id), sent: req.query.sent })));
  app.get('/collection', (req, res) => {
    const rooms = db.prepare('SELECT id, slug, title FROM collections WHERE public=1 ORDER BY sort DESC, id DESC').all(); // newest stories first
    const ids = db.prepare("SELECT cw.work_id id FROM collection_works cw JOIN works w ON w.id=cw.work_id WHERE cw.collection_id=? AND w.status='held' ORDER BY cw.sort, cw.work_id");
    rooms.forEach(r => { r.ids = ids.all(r.id).map(x => x.id); });
    res.send(V.collection({ maker, works: db.prepare("SELECT * FROM works WHERE status='held' ORDER BY id").all(), rooms, share: q.use.get(maker.id, 'social') }));
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
    if (!w || (w.status !== 'held' && !isStudio(req))) return res.status(404).send(V.layout({ title: 'Not found · Watermark', body: '<section class="narrow"><h1>Nothing is held here.</h1></section>' }));
    countView(w.id, null, 'view');
    const rules = R.parse(w.rules);
    res.send(V.work({ w, maker, uses: q.uses.all(maker.id).filter(u => R.allows(rules, u.key)), base: C.base, rules }));
  });

  // The public life of a photograph: registered, licensed, and (if the maker chooses) what it has earned.
  app.get('/w/:slug/life', (req, res) => {
    const w = q.work.get(req.params.slug);
    if (!w || w.status !== 'held') return res.sendStatus(404);
    const rules = R.parse(w.rules);
    const lic = db.prepare("SELECT l.ref, l.starts_at, l.ends_at, l.status, l.price_cents, u.name AS use_name FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=? AND l.status IN ('active','expired') ORDER BY l.starts_at").all(w.id);
    const reg = db.prepare("SELECT * FROM ledger WHERE type='work.registered' AND subject=? ORDER BY seq LIMIT 1").get(w.slug);
    res.send(V.life({ w, maker, lic, reg, rules }));
  });

  app.get('/img/:slug/:size', async (req, res) => {
    const w = q.work.get(req.params.slug);
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
    res.set('Access-Control-Allow-Origin', '*');
    if (!w || w.status !== 'held') return res.status(404).json({ error: 'not found' });
    res.json({ slug: w.slug, title: w.title, maker: maker.name, house: maker.house, width: w.width, height: w.height,
      image: `${C.base}/img/${w.slug}/screen`, page: `${C.base}/w/${w.slug}`, license: `${C.base}/license/${w.slug}`, source: w.source_url });
  });
  app.post('/api/seen', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const w = q.work.get(String(req.body.work || req.query.work || ''));
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
    if (!w || w.status !== 'held') return res.sendStatus(404);
    countView(w.id, null, 'open');
    const rules = R.parse(w.rules);
    res.send(V.buy({ w, maker, rules, uses: q.uses.all(maker.id).filter(u => R.allows(rules, u.key)), chosen: req.query.use, renews: /^WM-\d{4}-\d{6}$/.test(String(req.query.renews || '')) ? req.query.renews : null, instant: !!stripe }));
  });

  // One tap: a priced use goes straight to Stripe Checkout (Apple Pay, Google Pay, Link, cards).
  // No account, no form: Stripe collects the buyer's name and email.
  app.post('/buy/:slug', async (req, res) => {
    const w = q.work.get(req.params.slug);
    if (!w || w.status !== 'held') return res.sendStatus(404);
    const u = q.use.get(maker.id, String(req.body.use || ''));
    const rules = R.parse(w.rules);
    if (!u || !R.allows(rules, u.key)) return res.redirect(`/license/${w.slug}`);
    const note = String(req.body.note || '').slice(0, 2000) || null;
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
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: u.price_cents, product_data: { name: `${w.title}: ${u.name}`, description: u.key === 'social' ? `To share on your own accounts, credited. The file arrives the moment you pay. Photograph by ${maker.name}. Watermark ${ref}.` : `${u.kind === 'print' ? 'Archival print, signed' : 'License, ' + V.termText(u)}. Photograph by ${maker.name}. Watermark ${ref}.`, images: [`${C.base}/img/${w.slug}/thumb`] } } }],
        ...(u.key === 'social' ? {} : { custom_fields: [{ key: 'company', label: { type: 'custom', custom: 'Company or publication' }, type: 'text', optional: true }] }),
        ...(u.kind === 'print' ? { shipping_address_collection: { allowed_countries: ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'CH', 'ES', 'NL', 'AU'] } } : {}),
        metadata: { ref },
        success_url: `${C.base}/thanks/${ref}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${C.base}/license/${w.slug}?use=${u.key}`,
      });
      db.prepare("UPDATE licenses SET stripe_session=? WHERE ref=?").run(s.id, ref);
      res.redirect(303, s.url);
    } catch (e) { console.error('[checkout]', e.message); res.status(502).send(V.ask({ w, maker, u, note, error: 'Payment is unavailable for a moment. Leave your details and the maker will send a link.' })); }
  });

  app.get('/buy/:slug', (req, res) => {
    const w = q.work.get(req.params.slug);
    if (!w || w.status !== 'held') return res.sendStatus(404);
    const u = q.use.get(maker.id, String(req.query.use || 'campaign')) || q.uses.all(maker.id)[0];
    res.send(V.ask({ w, maker, u }));
  });

  // The moment after paying: the work is theirs, the file is ready, the email is on its way.
  app.get('/thanks/:ref', async (req, res) => {
    let l = q.lic.get(req.params.ref);
    if (!l || !req.query.session_id || l.stripe_session !== req.query.session_id) return res.redirect(l ? `/c/${l.ref}` : '/');
    if (l.status !== 'active' && stripe) {
      try { const s = await stripe.checkout.sessions.retrieve(req.query.session_id); if (s.payment_status === 'paid') { fillBuyer(l.ref, s); l = grant(l.ref, { paid: true, price_cents: s.amount_total }); } } catch (e) { /* show pending */ }
    }
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    res.send(V.thanks({ lic: l, w, maker, use: q.useById.get(l.use_id) }));
  });

  app.post('/license/:slug', async (req, res) => {
    const w = q.work.get(req.params.slug);
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
    res.send(V.certificate({ lic: l, w, maker, use: q.useById.get(l.use_id), entry: q.lastEntryFor.get(l.ref), base: C.base, owner }));
  });

  app.get('/d/:token', async (req, res) => {
    const l = db.prepare("SELECT * FROM licenses WHERE download_token=?").get(req.params.token);
    if (!l || l.status !== 'active' || (l.ends_at && new Date(l.ends_at) < new Date())) return res.sendStatus(404);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
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
    res.send(S.workTerms({ rooms, views, w, rules: R.parse(w.rules), uses: q.uses.all(maker.id), NEVER: R.NEVER, seen, lic, seals, notice: req.query.ok }));
  });
  app.post('/studio/works/:slug', studioOnly, (req, res) => {
    const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404);
    const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
    const all = q.uses.all(maker.id).map(u => u.key);
    const open = arr(req.body.uses).filter(k => all.includes(k));
    const rules = { uses: open.length === all.length ? null : open, approve: req.body.approve === '1', never: arr(req.body.never).filter(k => R.NEVER[k]), credit: req.body.credit === '1', showEarned: req.body.showEarned === '1' };
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
    const cents = v === '' ? null : Math.round(Number(v) * 100);
    if (cents !== null && !(cents >= 0)) return res.redirect('/studio/uses');
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

  app.locals = { backupDb, store, fillBuyer, db, registerWork, grant, maker, C, sweep, sync };
  return app;
}

module.exports = { createApp, slugify };
