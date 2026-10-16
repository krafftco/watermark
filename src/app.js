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
const S = require('./studio-views');
const prov = require('./provenance');
const mail = require('./mail');

// [key, name, description, term months, kind, sort, default price in cents (null = ask privately)]
const DEFAULT_USES = [
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
  const stripe = cfg.stripeClient || (C.stripeKey ? require('stripe')(C.stripeKey) : null);
  const originals = path.join(C.dataDir, 'originals');
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
    fs.renameSync(file, dest);
    db.prepare(`INSERT INTO works (maker_id,slug,title,caption,place,taken_at,camera,lens,width,height,original_file,sha256,source_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(maker.id, slug, title, caption || null, place || null, info.taken_at, info.camera, info.lens, info.width, info.height, path.basename(dest), info.sha256, source_url || null);
    ledger.append(db, 'work.registered', slug, { maker: maker.handle, fingerprint: info.sha256, camera: info.camera, taken: info.taken_at });
    return q.work.get(slug);
  }

  // ---------- app ----------
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
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
  app.get('/', (req, res) => res.send(V.collection({ maker, works: q.publicWorks.all() })));
  app.get('/about', (req, res) => res.send(V.about()));
  app.get('/terms', (req, res) => res.send(V.terms()));

  app.get('/w/:slug', (req, res) => {
    const w = q.work.get(req.params.slug);
    if (!w || (w.status !== 'held' && !isStudio(req))) return res.status(404).send(V.layout({ title: 'Not found · Watermark', body: '<section class="narrow"><h1>Nothing is held here.</h1></section>' }));
    countView(w.id, null, 'view');
    res.send(V.work({ w, maker, uses: q.uses.all(maker.id), base: C.base }));
  });

  app.get('/img/:slug/:size', async (req, res) => {
    const w = q.work.get(req.params.slug);
    if (!w || !images.SIZES[req.params.size]) return res.sendStatus(404);
    try {
      const file = await images.derivative(path.join(originals, w.original_file), cache, w.slug, req.params.size);
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
  app.get('/embed.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=3600').set('Access-Control-Allow-Origin', '*');
    res.send(fs.readFileSync(path.join(__dirname, '..', 'public', 'embed.js'), 'utf8').replace(/__WM_BASE__/g, C.base));
  });

  // --- licensing ---
  app.get('/license/:slug', (req, res) => {
    const w = q.work.get(req.params.slug);
    if (!w || w.status !== 'held') return res.sendStatus(404);
    countView(w.id, null, 'open');
    res.send(V.buy({ w, maker, uses: q.uses.all(maker.id), chosen: req.query.use, renews: /^WM-\d{4}-\d{6}$/.test(String(req.query.renews || '')) ? req.query.renews : null, instant: !!stripe }));
  });

  // One tap: a priced use goes straight to Stripe Checkout (Apple Pay, Google Pay, Link, cards).
  // No account, no form: Stripe collects the buyer's name and email.
  app.post('/buy/:slug', async (req, res) => {
    const w = q.work.get(req.params.slug);
    if (!w || w.status !== 'held') return res.sendStatus(404);
    const u = q.use.get(maker.id, String(req.body.use || ''));
    if (!u) return res.redirect(`/license/${w.slug}`);
    const note = String(req.body.note || '').slice(0, 2000) || null;
    if (req.body.ask || u.price_cents == null || !stripe) return res.send(V.ask({ w, maker, u, note, renews: req.body.renews }));
    const ref = nextRef();
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,intended_use,price_cents,status) VALUES (?,?,?,?,?,?,?,'awaiting_payment')")
      .run(ref, w.id, u.id, 'Buyer', '', note, u.price_cents);
    const renews = /^WM-\d{4}-\d{6}$/.test(String(req.body.renews || '')) ? String(req.body.renews) : null;
    if (renews) db.prepare('UPDATE licenses SET renews=? WHERE ref=?').run(renews, ref);
    ledger.append(db, 'license.checkout', ref, { work: w.slug, use: u.key });
    try {
      const s = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: u.price_cents, product_data: { name: `${w.title}: ${u.name}`, description: `${u.kind === 'print' ? 'Archival print, signed' : 'License, ' + V.termText(u)}. Photograph by ${maker.name}. Watermark ${ref}.`, images: [`${C.base}/img/${w.slug}/thumb`] } } }],
        custom_fields: [{ key: 'company', label: { type: 'custom', custom: 'Company or publication' }, type: 'text', optional: true }],
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
    const u = q.use.get(maker.id, String(b.use || ''));
    const email = String(b.email || '').trim();
    if (!u || !b.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !b.agree) {
      return res.status(400).send(V.licenseForm({ w, maker, uses, chosen: b.use, values: b, renews: b.renews, error: 'Please choose a use, give your name and a valid email, and agree to the terms.' }));
    }
    const ref = nextRef();
    db.prepare('INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,licensee_company,intended_use,price_cents,status) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(ref, w.id, u.id, String(b.name).slice(0, 120), email.slice(0, 160), String(b.company || '').slice(0, 160) || null, String(b.intended || '').slice(0, 2000) || null, u.price_cents, u.price_cents == null ? 'requested' : 'awaiting_payment');
    ledger.append(db, 'license.requested', ref, { work: w.slug, use: u.key });
    const renews = /^WM-\d{4}-\d{6}$/.test(String(b.renews || '')) ? String(b.renews) : null;
    if (renews) db.prepare('UPDATE licenses SET renews=? WHERE ref=?').run(renews, ref);
    mail.send({ to: maker.email, ...mail.templates.requestToMaker({ ref, title: w.title, name: b.name, company: b.company, email, use: u.name, intended: b.intended, base: C.base }) });
    if (u.price_cents == null) mail.send({ to: email, ...mail.templates.receivedToLicensee({ ref, title: w.title, name: b.name }) });
    if (u.price_cents != null && stripe) {
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
    prov.certificatePdf(res, { ref: l.ref, title: w.title, maker: maker.name, house: maker.house, licensee: l.licensee_company || l.licensee_name, use: u.name, description: u.description, starts: l.starts_at, ends: l.ends_at, fee: l.price_cents != null ? V.money(l.price_cents, l.currency) : null, fingerprint: w.sha256, ledgerHash: e && e.hash, base: C.base, intended: l.intended_use });
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

  app.get('/d/:token', (req, res) => {
    const l = db.prepare("SELECT * FROM licenses WHERE download_token=?").get(req.params.token);
    if (!l || l.status !== 'active' || (l.ends_at && new Date(l.ends_at) < new Date())) return res.sendStatus(404);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    ledger.append(db, 'file.delivered', l.ref, { work: w.slug });
    const file = path.join(originals, w.original_file);
    const name = `${w.slug}-${l.ref}${path.extname(w.original_file)}`;
    if (/\.jpe?g$/i.test(w.original_file)) {
      try {
        const u = q.useById.get(l.use_id);
        const buf = prov.stampJpeg(file, { ref: l.ref, maker: maker.name, licensee: l.licensee_company || l.licensee_name, use: u.name, ends: l.ends_at, fingerprint: w.sha256, base: C.base });
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

  app.get('/studio', studioOnly, (req, res) => {
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
  app.get('/studio/works', studioOnly, (req, res) => res.send(S.works({ list: q.allWorks.all(), notice: req.query.ok })));
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
  app.post('/studio/works/:slug/toggle', studioOnly, (req, res) => {
    db.prepare("UPDATE works SET status = CASE status WHEN 'held' THEN 'hidden' ELSE 'held' END WHERE slug=?").run(req.params.slug);
    res.redirect('/studio/works');
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
  app.post('/studio/renewals', studioOnly, (req, res) => res.redirect(`/studio?ok=${encodeURIComponent(sweep() + ' renewal notices sent.')}`));

  app.get('/healthz', (req, res) => res.json({ ok: true, ledger: ledger.verify(db).ok }));
  app.use((req, res) => res.status(404).send(V.layout({ title: 'Not found · Watermark', body: '<section class="narrow"><h1>Nothing is held here.</h1><p><a href="/">See the collection</a></p></section>' })));

  app.locals = { fillBuyer, db, registerWork, grant, maker, C, sweep };
  return app;
}

module.exports = { createApp, slugify };
