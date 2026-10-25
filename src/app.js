// Watermark: hold, show, license. One Express app.
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const K = require('./contract');
const { nanoid } = require('nanoid');
const { open } = require('./db');
const ledger = require('./ledger');
const images = require('./images');
const RG = require('./regard');
const CR = require('./credentials');
const V = require('./views');
const R = require('./rules');
const SEAL = require('./seal');
const { createStore } = require('./storage');
const S = require('./studio-views');
const prov = require('./provenance');
const mail = require('./mail');

// [key, name, description, term months, kind, sort, default price in cents (null = ask privately)]
const DEFAULT_USES = [
  ['social', 'Collect', 'Yours to keep and to share: your own accounts, a story, your lock screen. Personal, not for a business; the maker named.', null, 'license', 0, 500],
  ['editorial', 'In a story', 'A feature, a book, an essay or a report, with the maker named beside it.', 12, 'license', 1, 35000],
  ['commercial', 'For a company', 'The face of a website, a presentation, a letter to investors. Non-exclusive.', 12, 'license', 2, 75000],
  ['campaign', 'Before an audience', 'A campaign, a film, a billboard, a package. Non-exclusive; exclusivity on request.', 12, 'license', 3, 250000],
  // The Reference: the full original, for photographs held at reference quality (40 megapixels or more). Draft price.
  ['reference', 'Collect the Reference', 'The full original at reference quality, straight from the camera file. Yours to keep, to print large and to share, credited. Personal, not for a business.', null, 'license', 0, 2500],
  ['print', 'On a wall', 'An archival print, signed by the photographer, to live with for good.', null, 'print', 4, 25000],
  // Delivered (21 Oct): the maker's own client, by link, no money through the house; never offered on a wall (kind 'delivery' is left out of q.uses).
  ['delivery', 'Delivered', 'Delivered by the maker to their own client, under the terms agreed between them. The house keeps the record.', null, 'delivery', 9, null],
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
  // The test house (STAGING=1): a second copy of Watermark for trying everything before it reaches the public.
  // It never takes real money (a live Stripe key is refused), never mails anyone but the testers (MAIL_ALLOW),
  // never asks to be indexed, and says on every page that nothing in it is real. See docs/STAGING.md.
  C.staging = cfg.staging !== undefined ? !!cfg.staging : process.env.STAGING === '1';
  if (C.staging && /^(sk|rk)_live_/.test(C.stripeKey || '')) { console.error('[staging] a live Stripe key was refused; use test keys in the test house'); C.stripeKey = null; C.stripePk = null; }
  const db = open(path.join(C.dataDir, 'watermark.db'));
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='renewal_sent_at'").get()) db.exec('ALTER TABLE licenses ADD COLUMN renewal_sent_at TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='renews'").get()) db.exec('ALTER TABLE licenses ADD COLUMN renews TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='conditions'").get()) db.exec('ALTER TABLE licenses ADD COLUMN conditions TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='bytes'").get()) db.exec('ALTER TABLE works ADD COLUMN bytes INTEGER');
  // Launch fix 3.2: the maker's own note, in the maker's voice, shown above the guide written with AI.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='note'").get()) db.exec('ALTER TABLE works ADD COLUMN note TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='rights'").get()) db.exec('ALTER TABLE licenses ADD COLUMN rights TEXT'); // the contract's terms, as paid for
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='set_ref'").get()) db.exec('ALTER TABLE licenses ADD COLUMN set_ref TEXT'); // bought together as a set
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='rules'").get()) db.exec('ALTER TABLE works ADD COLUMN rules TEXT');
  // Buyers who chose one-tap: Stripe customer and saved payment method, nothing else.
  // Editions: what a collector has printed, and works passed from one collector to another.
  db.exec(`CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT, livemode INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS prints (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, size TEXT, paper TEXT, made TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS transfers (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, from_buyer INTEGER, to_buyer INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), claimed_at TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS buyers (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, pm TEXT, email TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  // Collectors: every purchase is numbered and hangs in the buyer's own collection.
  for (const [t, c, d] of [['licenses', 'buyer_id', 'INTEGER'], ['licenses', 'collector_no', 'INTEGER'], ['buyers', 'code', 'TEXT'], ['buyers', 'name', 'TEXT'], ['buyers', 'public', 'INTEGER NOT NULL DEFAULT 0']])
    if (!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name=?`).get(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`);
  // Catalogue fields, kept the way a museum keeps a record: an accession number, medium, keywords, credit line.
  for (const [c, t] of [['accession', 'TEXT'], ['medium', 'TEXT'], ['keywords', 'TEXT'], ['credit', 'TEXT'], ['dhash', 'TEXT'], ['master_at', 'TEXT'], ['share_cents', 'INTEGER'], ['edition_size', 'INTEGER'], ['credentials', 'TEXT'], ['copyright_reg', 'TEXT']])
    if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  // A photograph may carry its own Share it price; otherwise the maker's standard one.
  // A limited edition: the maker sets how many can ever be collected. Numbers are never reused.
  const edition = w => { if (!w || !w.edition_size) return null; const sold = db.prepare("SELECT COUNT(*) n FROM licenses WHERE work_id=? AND collector_no IS NOT NULL AND status IN ('active','expired')").get(w.id).n; return { size: w.edition_size, sold, left: Math.max(0, w.edition_size - sold) }; };
  // Checkouts still open (under 30 minutes) hold their number, so two buyers can't both take the last one.
  const soldOut = w => { const e = edition(w); if (!e) return false; const held = db.prepare("SELECT COUNT(*) n FROM licenses WHERE work_id=? AND status='awaiting_payment' AND created_at > datetime('now','-30 minutes')").get(w.id).n; return e.left - held <= 0; };
  // Founding Collectors: the first hundred people to collect on Watermark, numbered in the order they arrived.
  const FOUNDING = 100;
  const foundingNo = b => { if (app.locals.founders) return app.locals.founders.no(b); if (!b) return null; const rows = db.prepare("SELECT buyer_id FROM licenses WHERE buyer_id IS NOT NULL AND collector_no IS NOT NULL AND status IN ('active','expired') GROUP BY buyer_id ORDER BY MIN(starts_at), buyer_id LIMIT ?").all(FOUNDING); const i = rows.findIndex(r => r.buyer_id === b.id); return i < 0 ? null : i + 1; };
  const foundingLeft = () => Math.max(0, FOUNDING - db.prepare("SELECT COUNT(DISTINCT buyer_id) n FROM licenses WHERE buyer_id IS NOT NULL AND collector_no IS NOT NULL AND status IN ('active','expired')").get().n);
  const refOK = w => !!(w && w.width && w.height && w.width * w.height >= 40e6);
  // A use is offered only when the maker allows it and the file held is good enough for it (see MIN_MP).
  // A work under a claim is shown but not sold until the house decides (see disputes.js).
  // A partner's accepted exclusive on a work holds back the uses it covers while it runs (src/bridge.js).
  const held_ = (w, key) => !!(w && app && app.locals && app.locals.blockedBy && app.locals.blockedBy(w, key));
  const offered = (rules, key, w) => !held_(w, key) && !(w && w.disputed) && R.allows(rules, key) && (key !== 'reference' || refOK(w)) && meets(w, key);
  // Listed on the work page and the license page: every use the maker allows. A use the held file is too small
  // for is listed as Ask: the maker is asked for the master and the order goes through by hand (see /buy).
  const listed = (rules, key, w) => !held_(w, key) && !(w && w.disputed) && R.allows(rules, key) && (key !== 'reference' || refOK(w));
  // What each use needs of the file. A web copy is fine to share; a campaign or a print needs the master.
  // Megapixels, drafts until Will confirms. Below the line the use is asked of the maker, not sold instantly.
  const MIN_MP = { social: 1, reference: 40, editorial: 12, commercial: 12, campaign: 24, print: 24 };
  const mpOf = w => (w && w.width && w.height ? w.width * w.height / 1e6 : 0);
  const meets = (w, key) => mpOf(w) >= (MIN_MP[key] || 0);
  const QUALITY = { MIN_MP, mpOf, meets };
  // One name for the $5 piece: Collect (it was Share it).
  try { db.prepare("UPDATE uses SET name='Collect', description=? WHERE key='social' AND name='Share it'").run(DEFAULT_USES[0][2]); } catch (e) { /* first boot */ }
  // Downloads are counted. Every license comes with a number of them (drafts), shared with its seats; the
  // share-size file comes with every license, because holding a license includes the right to share it.
  const DL = { social: 5, reference: 5, editorial: 10, commercial: 25, campaign: 50, print: 5, delivery: 10 };
  db.exec(`CREATE TABLE IF NOT EXISTS downloads (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, seat_id INTEGER, size TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const [c, t] of [['sha256', 'TEXT'], ['mark', 'INTEGER'], ['work_id', 'INTEGER'], ['to_whom', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('downloads') WHERE name=?").get(c)) db.exec(`ALTER TABLE downloads ADD COLUMN ${c} ${t}`);
  // The mark (mark.js): every image that leaves the house carries its maker, its license and the way back, in the open
  // (XMP), sealed (Content Credentials) and within the picture (an invisible mark unique to the delivery). Policy, no switch.
  const MARK = require('./mark'); const MARK_KEY = process.env.MARK_KEY || cfg.markKey || C.secret;
  // Renditions carry the work's mark too (19 Oct): a copy scraped from the walls traces to the work and the house.
  // 20 Oct: the rendition mark showed as faint blocking in smooth skies and gradients (Will: 'the backgrounds have been
  // messed up'). Off until the mark is masked to texture (mark.js embedRaw with masking) and proven by eye; RENDITION_MARK=1 turns it back on.
  if (process.env.RENDITION_MARK === '1') images.setMarker({ key: MARK_KEY, payloadFor: slug => { const w = q.work.get(slug); return w ? MARK.renditionPayload(w.id) : null; } });
  // What a file says about itself, in words a person reads in Photos or Finder: the photograph, its maker, how it is
  // held, and the Watermark number that finds its license. The fingerprint stays in the file, out of the caption.
  const TRACK = require('./track');
  function captionOf({ w, maker, ref = null, licensee = null, use = null, ends = null }) {
    const title = V.tidy(w.title), year = (w.taken_at || '').slice(0, 4), number = ref ? TRACK.track(ref) : null;
    const l = ref ? db.prepare('SELECT l.collector_no, u.key FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.ref=?').get(ref) : null;
    const how = !ref ? 'Free and clear, from Watermark' : l && l.key === 'social' ? `Collected on Watermark${l.collector_no ? `, No. ${l.collector_no}` : ''}` : l && l.key === 'reference' ? 'The Reference, collected on Watermark' : `Licensed on Watermark${use ? `, ${String(use).toLowerCase()}` : ''}${ends ? `, until ${new Date(ends).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}`;
    const caption = `${title}. ${require('./object').aBy(w, maker.name).replace(/ by .*$/, '')} by ${maker.name}${w.place ? `, ${w.place}` : ''}${year ? `, ${year}` : ''}. ${how}.${number ? ` ${number}.` : ''}`;
    const copyright = `(c) ${year || new Date().getFullYear()} ${maker.name}. ${number ? `${number}. Look it up at watermark.krafftco.com/t/${TRACK.compact(ref)}` : `Held at watermark.krafftco.com/w/${w.slug}`}`;
    return { caption, copyright, number };
  }
  // A file's name: the title, the maker, the number. Readable in any folder; ASCII for the plain header, UTF-8 for the rest.
  function fileName(w, maker, ref, ext) {
    const n = ref ? TRACK.track(ref) : w.accession;
    const nice = `${V.tidy(w.title)}, ${maker.name}${n ? ` (${n})` : ''}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { utf8: nice + ext, ascii: nice.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').normalize('NFKD').replace(/[^\x20-\x7e]/g, '') + ext };
  }
  const disposition = f => `attachment; filename="${f.ascii.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.utf8)}`;
  // The master leaves untouched (Will, 21 Oct: "never compressing the image in a way that is ever noticeable; our images
  // have to be the most beautiful digital prints from the master"): a full-size delivery is the maker's own bytes with
  // the papers added in lossless segments (EXIF, XMP, Content Credentials); it is never decoded and re-encoded, and the
  // invisible mark within the pixels goes only into the display-size copies (Collect, share), which are made fresh from
  // a resize anyway. The file is still traced by its bytes (downloads.sha256) and its papers (XMP wm:license).
  // `share`: a display-size copy (made from a resize) carries the mark within the picture; `strip` (default with share):
  // the visible credit strip; an album's copies (21 Oct) are marked but carry no strip.
  // (21 Oct, later) Nothing is laid into the pixels of any delivered file either: the mark within the picture took a
  // 2,400-pixel copy from 41 dB to 36.6 against the master and showed on a face. A copy is made straight from the
  // master (images.copy) and leaves with its papers; a share copy also carries the visible credit strip. Every file is
  // traced by its bytes (downloads.sha256), its XMP and its Content Credentials.
  async function marked(buf, { w, maker, ref = null, licensee = null, use = null, ends = null, dlId, share = false, strip = null, format = 'jpeg' }) {
    let out = buf;
    if (share && strip !== false) out = await MARK.credit(out, { maker: maker.name, url: `watermark.krafftco.com/${ref ? `c/${ref}` : `w/${w.slug}`}` });
    if (format === 'jpeg') {
      const cap = captionOf({ w, maker, ref, licensee, use, ends });
      try { out = prov.stampJpegBuffer(out, { ref: ref || w.accession, maker: maker.name, licensee: licensee || 'the public', use: use || 'Free and clear', ends, fingerprint: w.sha256, base: C.base, conditions: null, caption: cap.caption, copyright: cap.copyright }); } catch (e) { /* keep */ }
      out = MARK.withXmp(out, MARK.xmp({ title: V.tidy(w.title), maker: maker.name, year: (w.taken_at || '').slice(0, 4) || null, credit: `${maker.name} / Watermark`, copyright: `© ${(w.taken_at || w.created_at || '').slice(0, 4)} ${maker.name}. All rights reserved.`, licensor: `${C.base}/license/${w.slug}`, statement: ref ? `${C.base}/c/${ref}` : `${C.base}/w/${w.slug}`, registry: 'watermark.krafftco.com', accession: w.accession, ref, licensee, use, ends, noAI: R.parse(w.rules).never.includes('ai'), caption: cap.caption, number: cap.number }));
    }
    db.prepare('UPDATE downloads SET sha256=?, mark=?, work_id=?, to_whom=? WHERE id=?').run(crypto.createHash('sha256').update(out).digest('hex'), dlId >>> 0, w.id, licensee || null, dlId);
    return out;
  }
  const markApi = { marked, read: buf => MARK.read(buf, MARK_KEY), readXmp: MARK.readXmp, trace: async buf => {
    const h = crypto.createHash('sha256').update(buf).digest('hex');
    let d = db.prepare('SELECT d.*, l.ref, l.licensee_name, l.licensee_company FROM downloads d LEFT JOIN licenses l ON l.id=d.license_id WHERE d.sha256=?').get(h); let how = 'bytes';
    if (!d) { const x = MARK.readXmp(buf); if (x && x.license) { d = db.prepare('SELECT d.*, l.ref, l.licensee_name, l.licensee_company FROM downloads d JOIN licenses l ON l.id=d.license_id WHERE l.ref=? ORDER BY d.id DESC LIMIT 1').get(x.license); how = 'xmp'; } }
    if (!d) { try { const r = await MARK.read(buf, MARK_KEY); if (r && r.ok && r.payload && MARK.isRendition(r.payload)) { const rw = db.prepare('SELECT slug, title FROM works WHERE id=?').get(MARK.renditionWork(r.payload)); if (rw) return { rendition: true, work: rw, how: 'mark' }; } if (r && r.ok && r.payload) { d = db.prepare('SELECT d.*, l.ref, l.licensee_name, l.licensee_company FROM downloads d LEFT JOIN licenses l ON l.id=d.license_id WHERE d.id=?').get(r.payload); how = 'mark'; } } catch (e) { /* unreadable */ } }
    return d ? { ...d, how } : null; } };
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='dl_extra'").get()) db.exec('ALTER TABLE licenses ADD COLUMN dl_extra INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='house_cents'").get()) db.exec('ALTER TABLE licenses ADD COLUMN house_cents INTEGER');
  const stampHouse = (ref, u) => { if (u && u.house_cents != null) db.prepare('UPDATE licenses SET house_cents=? WHERE ref=?').run(u.house_cents, ref); };
  const dlOf = l => { const u = q.useById.get(l.use_id); const limit = (DL[u ? u.key : 'social'] || 5) + (l.dl_extra || 0); const used = db.prepare('SELECT COUNT(*) n FROM downloads WHERE license_id=?').get(l.id).n; return { limit, used, left: Math.max(0, limit - used) }; };
  // The ladder: as a limited edition fills, its issue price rises, so every collector before the step
  // holds a piece now issued above what they paid. Quarters of the edition at 1x, 1.5x, 2x, 3x (drafts).
  const LADDER = [1, 1.5, 2, 3];
  const ladder = (w, base) => { const e = edition(w); if (!e || base == null) return { price: base, step: 0, base }; const step = Math.min(LADDER.length - 1, Math.floor(e.sold / (e.size / LADDER.length))); return { price: Math.round(base * LADDER[step] / 100) * 100, step, base, next: step < LADDER.length - 1 ? Math.round(base * LADDER[step + 1] / 100) * 100 : null, at: step < LADDER.length - 1 ? Math.ceil(e.size / LADDER.length) * (step + 1) : null }; };
  const priced = (u, w) => { if (!u || !w) return u; const v = { ...u, needsMaster: !meets(w, u.key) }; if (u.key === 'social') { const base = w.share_cents || u.price_cents; const L = ladder(w, base); v.price_cents = L.price; v.ladder = L; } v.maker_cents = v.price_cents; v.house_cents = FEE.on() && v.price_cents != null ? FEE.house(u.key, v.price_cents) : null; v.price_cents = FEE.total(u.key, v.price_cents); return v; };
  const accession = w => `WM.${String(w.created_at || new Date().toISOString()).slice(0, 4)}.${String(w.id).padStart(4, '0')}`;
  for (const w of db.prepare('SELECT id, created_at FROM works WHERE accession IS NULL').all()) db.prepare('UPDATE works SET accession=? WHERE id=?').run(accession(w), w.id);
  const stripe = cfg.stripeClient || (C.stripeKey ? require('stripe')(C.stripeKey) : null);
  const originals = path.join(C.dataDir, 'originals'); // a cache when the vault is S3
  ledger.setKey(cfg.signingSeed || process.env.REGISTER_SEED || process.env.VAULT_KEY || cfg.secret); ledger.ensureSig(db);
  const store = cfg.store || createStore({ bucket: cfg.bucket !== undefined ? cfg.bucket : process.env.S3_BUCKET, region: process.env.AWS_REGION, endpoint: process.env.S3_ENDPOINT, vaultKey: cfg.vaultKey !== undefined ? cfg.vaultKey : process.env.VAULT_KEY, localRoot: path.join(C.dataDir, 'vault') });
  // The original, from the local cache or, if this server is new, from the vault.
  // The local copy of an original is a cache when the vault is S3: kept under ORIGINALS_CACHE_GB (3) by dropping the
  // copies least recently used, so sixty-megapixel masters never fill the disk (20 Oct: a 10 GB disk, 50 GB of masters
  // on the way). Stale upload temp files (incoming/) older than a day go too.
  const CACHE_BUDGET = Number(process.env.ORIGINALS_CACHE_GB || 3) * 1e9;
  function trimOriginals(keep) {
    if (store.kind !== 's3') return;
    try {
      const files = fs.readdirSync(originals).map(f => { const p = path.join(originals, f); try { const st = fs.statSync(p); return { p, size: st.size, at: Math.max(st.atimeMs || 0, st.mtimeMs || 0) }; } catch (e) { return null; } }).filter(Boolean);
      let total = files.reduce((a, f) => a + f.size, 0); if (total <= CACHE_BUDGET) return;
      const hold = unvaulted();
      for (const f of files.sort((a, b) => a.at - b.at)) { if (total <= CACHE_BUDGET * 0.8) break; if (f.p === keep || hold.has(path.basename(f.p)) || (/\.tmp$/.test(f.p) && Date.now() - f.at < 600000)) continue; try { fs.unlinkSync(f.p); total -= f.size; } catch (e) { /* in use */ } }
    } catch (e) { /* no cache dir yet */ }
  }
  setInterval(() => { try { const inc = path.join(C.dataDir, 'incoming'); for (const f of fs.readdirSync(inc)) { const p = path.join(inc, f); try { if (Date.now() - fs.statSync(p).mtimeMs > 86400000) fs.unlinkSync(p); } catch (e) { /* gone */ } } } catch (e) { /* none */ } }, 3600000).unref();
  // Vaulting in the background (21 Oct, Will: "it's so slow"; "do the work in the backend so the user is free to go"):
  // a new original is written to the local disk and the work is whole at once (fingerprinted, deeded, on the register);
  // the copy to the bucket follows in a queue (`works.vaulted` 0 → 1), retried until it lands; an unvaulted original is
  // never trimmed from the local cache; `vaultPending()` runs 20 s after start and every 30 s, so a restart loses nothing.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='vaulted'").get()) { db.exec('ALTER TABLE works ADD COLUMN vaulted INTEGER NOT NULL DEFAULT 1'); }
  const unvaulted = () => new Set(db.prepare('SELECT original_file FROM works WHERE vaulted=0').all().map(r => r.original_file));
  let vaulting = false;
  const vaultState = { lastError: null, lastErrorAt: null, lastOkAt: null, lost: [] }; // told on /healthz `vault`
  async function vaultPending() {
    if (vaulting || store.kind !== 's3') return; vaulting = true;
    try {
      const lost = [];
      for (const w of db.prepare('SELECT * FROM works WHERE vaulted=0 ORDER BY id LIMIT 50').all()) {
        const p = path.join(originals, w.original_file);
        if (!fs.existsSync(p)) {
          // Not on disk: perhaps the bucket already has it (a put that landed as the process died); else the only copy
          // is gone, and the work goes off view for conservation with the finding, never a 500 on its picture.
          const inBucket = await store.size('originals/' + w.original_file).catch(() => null);
          if (inBucket && (!w.bytes || inBucket === w.bytes)) { db.prepare('UPDATE works SET vaulted=1 WHERE id=?').run(w.id); continue; }
          lost.push(w.slug); console.error('[vault] unvaulted original missing on disk', w.slug);
          if (app.locals.conservation && w.status !== 'restoring') try { app.locals.conservation.offView(w, ['The original is not on disk and never reached the vault; the file must be brought in again.']); } catch (e) { /* told on /healthz */ }
          continue;
        }
        try { await store.put('originals/' + w.original_file, p, /\.png$/i.test(p) ? 'image/png' : /\.tiff?$/i.test(p) ? 'image/tiff' : 'image/jpeg'); db.prepare('UPDATE works SET vaulted=1 WHERE id=?').run(w.id); vaultState.lastOkAt = new Date().toISOString(); vaultState.lastError = null; }
        catch (e) { console.error('[vault] put', w.slug, e.message); vaultState.lastError = `${w.slug}: ${e.message}`.slice(0, 200); vaultState.lastErrorAt = new Date().toISOString(); break; }
      }
      vaultState.lost = lost;
    } finally { vaulting = false; }
  }
  async function originalPath(w) {
    const p = path.join(originals, w.original_file);
    if (fs.existsSync(p)) { try { const now = new Date(); fs.utimesSync(p, now, now); } catch (e) { /* read-only */ } return p; }
    const buf = await store.get('originals/' + w.original_file);
    if (!buf) throw new Error('Original missing from the vault: ' + w.original_file);
    trimOriginals(p);
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp, buf); try { fs.renameSync(tmp, p); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* already there */ } } return p; // atomic: a second reader never sees a half-written original
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
  // Every maker gets a use added since they joined (Delivered, 21 Oct), at its default; their own prices are never touched.
  { const add = db.prepare('INSERT OR IGNORE INTO uses (maker_id,key,name,description,term_months,kind,sort,price_cents) VALUES (?,?,?,?,?,?,?,?)'); for (const m of db.prepare('SELECT id FROM makers').all()) DEFAULT_USES.forEach(u => add.run(m.id, ...u)); }
  // Each work belongs to its maker; pages, prices, licenses and emails follow the work.
  const mk = w => (w && w.maker_id && w.maker_id !== maker.id ? db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id) : null) || maker;

  const q = {
    work: db.prepare("SELECT * FROM works WHERE slug=?"),
    publicWorks: db.prepare("SELECT * FROM works WHERE status='held' ORDER BY id DESC"),
    allWorks: db.prepare('SELECT * FROM works ORDER BY id DESC'),
    uses: db.prepare("SELECT * FROM uses WHERE maker_id=? AND kind!='delivery' ORDER BY sort"),
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

  // What the two letters of a sale need (src/mail-letters.js): the photograph, its number, the rights in plain words,
  // the agreement, and for the maker what is theirs and how often the work has been chosen.
  const FEE = require('./fee'); // the house's share, paid by the collector when FEE_SIDE=collector
  const LETTERS = require('./mail-letters');
  function letterFor(g, w, maker, u, token) {
    let t = null; try { t = g.rights ? JSON.parse(g.rights) : null; } catch (e) { t = null; }
    if (!t) t = K.terms({ use: u, never: R.parse(w.rules).never, base: g.price_cents });
    const pr = V.plainRights(g, u, t), k = token ? `?k=${token}` : '';
    const pct = FEE.on() && g.house_cents != null ? 100 : (maker.share_pct || 85), cents = g.price_cents || 0;
    const fmtD = d => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
    const b = g.buyer_id ? db.prepare('SELECT * FROM buyers WHERE id=?').get(g.buyer_id) : null;
    const certUrl = `${C.base}/c/${g.ref}${k}`;
    const times = db.prepare("SELECT COUNT(*) n FROM licenses WHERE work_id=? AND status IN ('active','expired') AND price_cents > 0").get(w.id).n;
    const allTimes = db.prepare("SELECT COUNT(*) n FROM licenses l JOIN works x ON x.id=l.work_id WHERE x.maker_id=? AND l.status IN ('active','expired') AND l.price_cents > 0").get(maker.id).n;
    const month = db.prepare(`SELECT COALESCE(SUM(${FEE.sqlMaker(maker.share_pct || 85)}),0) c FROM licenses l JOIN works x ON x.id=l.work_id WHERE x.maker_id=? AND l.status IN ('active','expired') AND l.price_cents > 0 AND l.starts_at >= ?`).get(maker.id, new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()).c;
    return {
      base: C.base, title: V.tidy(w.title), maker: maker.name, place: w.place || null, year: (w.taken_at || '').slice(0, 4) || null,
      img: `${C.base}/img/${w.slug}/screen?f=jpg`, name: g.licensee_name, who: g.licensee_company || g.licensee_name || 'A collector',
      kind: u.kind, personal: !!t.personal, useName: u.name, useSays: `for ${u.name.toLowerCase()}`,
      no: g.collector_no || null, of: w.edition_size || null, can: pr.can, cannot: pr.cannot,
      fee: V.money(cents, g.currency), date: fmtD(g.starts_at || Date.now()), ends: g.ends_at ? fmtD(g.ends_at) : null,
      share: V.money(FEE.makerOf(g, maker.share_pct || 85), g.currency), house: FEE.on() && g.house_cents != null ? V.money(g.house_cents, g.currency) : null, pct, times, allTimes, month: allTimes > 1 ? V.money(month, g.currency) : null,
      number: TRACK.track(g.ref) || g.ref, checkUrl: `${C.base}/t/${TRACK.compact(g.ref) || g.ref}`,
      certUrl, contractUrl: `${C.base}/c/${g.ref}/contract${k}`, fileUrl: token ? `${C.base}/d/${token}` : null, printUrl: `${C.base}/yours/p/${g.ref}${k}#print`, proof: t.personal && u.kind !== 'print' ? { price: V.money(require('./keep').PROOF_CENTS), url: `${C.base}/yours/p/${g.ref}${k}#print` } : null,
      galleryUrl: b && b.public && b.code ? `${C.base}/g/${b.code}` : certUrl,
      studioUrl: `${C.base}/account/works/${w.slug}`, payUrl: `${C.base}/account/payouts`,
    };
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
    // The house's part of what was paid (FEE_SIDE=collector): recorded at the sale when the price was built, else here:
    // a maker's fee paid through a link arrives above the fee named (the difference is the house's), anything else by the rule.
    if (FEE.on() && extra.paid && l.house_cents == null) {
      const before = l.price_cents || 0, paid = extra.price_cents ?? before;
      const house = paid > before ? paid - before : Math.max(0, paid - FEE.makerFromTotal(u.key, paid));
      db.prepare('UPDATE licenses SET house_cents=? WHERE ref=?').run(house, ref);
    }
    // Collector No. n of this work: numbers are never reused, so an early number stays early.
    if (extra.paid) db.prepare('UPDATE licenses SET collector_no=(SELECT COALESCE(MAX(collector_no),0)+1 FROM licenses WHERE work_id=?) WHERE ref=? AND collector_no IS NULL').run(l.work_id, ref);
    if (extra.paid && app.locals.hangs) { try { app.locals.hangs.reward(q.lic.get(ref), w); } catch (e) { console.error('[curation]', e.message); } }
    if (extra.paid && app.locals.galleries) { try { app.locals.galleries.cut(q.lic.get(ref), w, maker.share_pct || 85, FEE.makerOf(q.lic.get(ref), maker.share_pct || 85)); } catch (e) { console.error('[representation]', e.message); } }
    ledger.append(db, 'license.granted', ref, { work: w.slug, fingerprint: w.sha256, use: u.key, starts: start.toISOString(), ends: end ? end.toISOString() : null, paid: !!extra.paid, house: (q.lic.get(ref) || {}).house_cents ?? undefined });
    if (extra.paid && app.locals.legal) { try { app.locals.legal.accept('buyer', l.buyer_id, 'house', null, ref); } catch (e) { console.error('[legal]', e.message); } } // paying accepts the terms of the house
    if (extra.paid && app.locals.bridge) app.locals.bridge.notice(ref).catch(e => console.error('[bridge]', e.message));
    if (app.locals.onGrant) { try { app.locals.onGrant(q.lic.get(ref), extra); } catch (e) { console.error('[editions]', e.message); } } // a print edition: the number, the order, the register
    const g = q.lic.get(ref);
    try { const L = letterFor(g, w, maker, u, token); if (extra.paid && maker.email) mail.send({ to: maker.email, ...LETTERS.sold(L) }); if (g.licensee_email) mail.send({ to: g.licensee_email, ...LETTERS.collected(L) }); }
    catch (e) { console.error('[letters]', e.message);
      if (extra.paid) mail.send({ to: maker.email, ...mail.templates.soldToMaker({ ref, title: w.title, use: u.name, buyer: g.licensee_company || g.licensee_name, fee: V.money(g.price_cents, g.currency), base: C.base }) });
      if (g.licensee_email) mail.send({ to: g.licensee_email, ...mail.templates.grantedToLicensee({ ref, title: w.title, name: g.licensee_name, ends: g.ends_at, certUrl: `${C.base}/c/${ref}?k=${token || ''}`, downloadUrl: token ? `${C.base}/d/${token}` : null }) }); }
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

  async function registerWork({ file, title, place, caption, source_url, originalName, makerId, kind }) {
    const owner = makerId ? (db.prepare('SELECT * FROM makers WHERE id=?').get(makerId) || maker) : maker;
    await BAG.throwIfBad(file, { name: originalName || path.basename(file), where: 'registerWork', who: `m:${owner.handle}` }); // the bag check: every arrival, by every door
    const info = await images.inspect(file);
    const dupe = db.prepare('SELECT * FROM works WHERE sha256=?').get(info.sha256);
    if (dupe) {
      // The same file for a record whose only copy was lost (vaulted 0, nothing on disk): the file comes home to its
      // record, which keeps its slug, deed and register entry; the queue vaults it and conservation puts it back on view.
      const home = path.join(originals, dupe.original_file || '');
      if (dupe.vaulted === 0 && dupe.original_file && !fs.existsSync(home)) {
        try { fs.renameSync(file, home); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(file, home); fs.unlinkSync(file); }
        if (dupe.status === 'restoring' && app.locals.conservation) app.locals.conservation.backOnView(dupe);
        setTimeout(() => vaultPending().catch(() => {}), 50).unref();
        const back = q.work.get(dupe.slug); back.cameHome = true; return back;
      }
      fs.unlinkSync(file); const e = new Error(`This photograph is already held as "${dupe.slug}".`); e.user = true; throw e;
    }
    title = require('./titles').titleCase(title);
    let slug = slugify(title), i = 2;
    while (q.work.get(slug)) slug = `${slugify(title)}-${i++}`;
    const ext = (path.extname(originalName || file) || '.jpg').toLowerCase();
    const dest = path.join(originals, slug + ext);
    // A file staged on another disk (e.g. /tmp beside a mounted volume) can't be renamed across; copy it.
    try { fs.renameSync(file, dest); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(file, dest); fs.unlinkSync(file); }
    const vaultLater = store.kind === 's3' && !cfg.vaultNow; // the copy to the bucket follows in the background (vaultPending)
    if (!vaultLater) await store.put('originals/' + path.basename(dest), dest, /\.png$/.test(ext) ? 'image/png' : /\.tiff?$/.test(ext) ? 'image/tiff' : 'image/jpeg');
    db.prepare(`INSERT INTO works (maker_id,slug,title,caption,place,taken_at,camera,lens,width,height,original_file,sha256,source_url,vaulted)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(owner.id, slug, title, caption || null, place || null, info.taken_at, info.camera, info.lens, info.width, info.height, path.basename(dest), info.sha256, source_url || null, vaultLater ? 0 : 1);
    if (vaultLater) setTimeout(() => vaultPending().catch(() => {}), 50).unref();
    const nw = q.work.get(slug);
    const kindOk = kind && require('./object').KINDS[kind] ? kind : 'photograph';
    db.prepare("UPDATE works SET accession=?, kind=?, medium=CASE WHEN ?='photograph' THEN COALESCE(medium, 'Digital photograph') ELSE medium END, dhash=?, bytes=? WHERE id=?").run(accession(nw), kindOk, kindOk, await images.dhash(dest).catch(() => null), (() => { try { return fs.statSync(dest).size; } catch (e) { return null; } })(), nw.id);
    const cred = await CR.inspect(dest); if (cred) db.prepare('UPDATE works SET credentials=? WHERE id=?').run(JSON.stringify(cred), nw.id);
    // (21 Oct) The local copy stays: it is the cache, trimmed by budget, and until the bucket has it (vaultPending) it is
    // the only copy in the world. The old line unlinked it here, and fourteen new arrivals were lost that way.
    ledger.append(db, 'work.registered', slug, { maker: owner.handle, fingerprint: info.sha256, camera: info.camera, taken: info.taken_at, accession: accession(nw) });
    return q.work.get(slug);
  }

  // ---------- app ----------
  const app = express();
  app.locals.vaultPending = vaultPending; app.locals.vaultState = vaultState;
  if (!cfg.noTimers && store.kind === 's3') { setTimeout(vaultPending, 20e3).unref(); setInterval(vaultPending, 30e3).unref(); }
  app.locals.mark = markApi; app.locals.fee = FEE;
  app.locals.quality = QUALITY; app.locals.downloadsOf = dlOf; app.locals.ladder = ladder;
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  // Protection by default: tell crawlers and AI scrapers the work is reserved (TDMRep, noai).
  app.use((req, res, next) => { if (!req.path.startsWith('/studio')) res.set({ 'X-Robots-Tag': 'noai, noimageai', 'TDM-Reservation': '1', 'TDM-Policy': `${C.base}/terms` }); next(); });
  const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'CCBot', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'Applebot-Extended', 'PerplexityBot', 'Bytespider', 'Meta-ExternalAgent', 'Amazonbot', 'cohere-ai', 'Diffbot', 'ImagesiftBot', 'Omgilibot'];
  app.get('/robots.txt', (req, res, next) => C.staging ? res.type('text').send('User-agent: *\nDisallow: /\n') : next());
  app.get('/robots.txt', (req, res) => res.type('text').send(`${AI_BOTS.map(b => `User-agent: ${b}\nDisallow: /`).join('\n\n')}\n\nUser-agent: *\nAllow: /img/*/thumb\nAllow: /img/*/screen\nDisallow: /img/\nDisallow: /d/\nDisallow: /k/\nDisallow: /studio\nDisallow: /buy/\nAllow: /\n\nSitemap: ${C.base}/sitemap.xml\n`));
  // Every public page, so search engines find the collection, each work, its life and the public rooms.
  app.get('/sitemap.xml', (req, res) => {
    const u = p => `<url><loc>${C.base}${p}</loc></url>`;
    const ws = db.prepare("SELECT slug, title, created_at FROM works WHERE status='held' ORDER BY id").all();
    const rooms = db.prepare('SELECT slug FROM collections WHERE public=1').all();
    const img = w => `<url><loc>${C.base}/w/${w.slug}</loc><image:image><image:loc>${C.base}/img/${w.slug}/screen</image:loc><image:title>${V.esc(w.title)}</image:title></image:image></url>`;
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${['/', '/makers', '/collection', '/collectors', '/journal', '/patronage', '/series/the-great-rooms', '/about', '/terms', '/verify', '/ledger'].map(u).join('')}${ws.map(img).join('')}${ws.map(w => u(`/w/${w.slug}/life`)).join('')}${rooms.map(r => u(`/rooms/${r.slug}`)).join('')}</urlset>`);
  });
  // Apple Pay, Google Pay and Link on the page need the domain registered with Stripe; Stripe checks this file.
  let applePayFile = null;
  app.get('/.well-known/apple-developer-merchantid-domain-association', async (req, res) => {
    try {
      if (!applePayFile) applePayFile = await (await fetch('https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association')).text();
      res.set('Cache-Control', 'public, max-age=86400').type('text/plain').send(applePayFile);
    } catch (e) { res.sendStatus(502); }
  });
  async function registerDomain() {
    if (!stripe || !/^https:/.test(C.base)) return null;
    const host = new URL(C.base).host;
    const have = await stripe.paymentMethodDomains.list({ domain_name: host, limit: 1 });
    let d = have.data[0];
    if (!d) d = await stripe.paymentMethodDomains.create({ domain_name: host });
    else if (!d.enabled || (d.apple_pay && d.apple_pay.status !== 'active')) d = await stripe.paymentMethodDomains.validate(d.id);
    return d;
  }
  app.locals.registerDomain = registerDomain;
  // The bucket's door for the browser (21 Oct): set by the house itself; the answer on /healthz `vault`.
  app.locals.vaultCors = store.kind === 's3' ? 'unknown' : 'n/a';
  async function ensureVaultCors() { if (!store.ensureCors) return; try { app.locals.vaultCors = await store.ensureCors([C.base.replace(/\/$/, '')]); } catch (e) { app.locals.vaultCors = 'error: ' + e.message.slice(0, 80); } console.log('[vault] cors', app.locals.vaultCors); }
  if (!cfg.noTimers && store.kind === 's3') { setTimeout(ensureVaultCors, 10e3).unref(); setInterval(ensureVaultCors, 6 * 3600e3).unref(); }
  app.locals.ensureVaultCors = ensureVaultCors;
  if (!cfg.noTimers && !cfg.stripeClient) setTimeout(() => registerDomain().then(d => { if (d) console.log('[stripe] domain', d.domain_name, d.enabled ? 'enabled' : 'not enabled', 'apple', d.apple_pay && d.apple_pay.status, 'google', d.google_pay && d.google_pay.status, 'link', d.link && d.link.status); }).catch(e => console.error('[stripe] domain', e.message)), 30e3).unref();
  app.get('/.well-known/tdmrep.json', (req, res) => res.json([{ location: '/*', 'tdm-reservation': 1, 'tdm-policy': `${C.base}/terms` }]));
  // Everything text leaves compressed; the browser keeps static files a year by version, images an hour.
  app.use(require('compression')({ threshold: 1024 }));
  const served = require('./served').mountServed(app, { publicDir: path.join(__dirname, '..', 'public'), cacheDir: cache, express }); // scripts and styles leave stripped (19 Oct)
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', immutable: false }));
  app.use(cookieParser());

  // Stripe webhook needs the raw body, so it comes before the body parsers.
  app.post('/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    if (!stripe || !C.webhookSecret) return res.status(400).send('Stripe not configured');
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], C.webhookSecret); }
    catch (e) { return res.status(400).send('Bad signature'); }
    try { db.prepare('INSERT INTO stripe_events (id, type, livemode) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').run(event.id, event.type, event.livemode ? 1 : 0); } catch (e) { /* table not yet made */ }
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const ref = s.metadata && s.metadata.ref;
      if (s.metadata && s.metadata.set && s.payment_status === 'paid') grantSet(s.metadata.set, s);
      else if (ref && s.payment_status === 'paid') { fillBuyer(ref, s); grant(ref, { paid: true, price_cents: s.amount_total, session: s }); }
    }
    if (app.locals.patronEvent) app.locals.patronEvent(event); // patronage: joined, or ended
    if (app.locals.libraryEvent) app.locals.libraryEvent(event); // a copy taken from the Library
    if (app.locals.pocketEvent) app.locals.pocketEvent(event); // the pocket filled
    if (app.locals.hangEvent) app.locals.hangEvent(event); // a card for a curator
    if (app.locals.keepEvent) app.locals.keepEvent(event); // a proof paid for
    if (app.locals.seasonEvent) app.locals.seasonEvent(event); // the Circle: joined, or ended
    if (app.locals.standingEvent) app.locals.standingEvent(event); // a piece a month: begun, a month paid, or ended
    if (app.locals.ownEvent) app.locals.ownEvent(event); // a Copyright Office filing paid for
    if (app.locals.bookshopEvent) app.locals.bookshopEvent(event); // a copy bought from the Bookshop
    if (event.type === 'payment_intent.succeeded') { // Share it, paid in place
      const pi = event.data.object, ref = pi.metadata && pi.metadata.ref;
      if (ref && q.lic.get(ref)) settle(q.lic.get(ref)).catch(e => console.error('[settle]', e.message));
    }
    res.json({ received: true });
  });

  require('./guardrails').mountGuardrails(app, { base: C.base });
  const BAG = require('./bagcheck').mountBagcheck(app, { db, V, ledger, studioOnly: (req, res, next) => studioOnly(req, res, next), makerOf: req => (app.locals.accounts ? app.locals.accounts.makerOf(req) : null), buyerOf: req => buyerOf(req) });
  app.use((req, res, next) => { try { V.setDeskAdmin(isStudio(req)); V.setHouseMaker(maker.handle); const mm = app.locals.accounts && /^\/account/.test(req.path) ? app.locals.accounts.makerOf(req) : null; V.setDeskGallery(!!(mm && mm.kind === 'gallery')); V.setDeskInstitution(!!(mm && mm.kind === 'institution')); } catch (e) { /* before the Studio exists */ } next(); });
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.json({ limit: '64kb' }));

  // --- auth for the Studio ---
  const sign = v => crypto.createHmac('sha256', C.secret).update(v).digest('hex');
  const isStudio = req => { const c = req.cookies.wm_s; if (!c) return false; const [exp, mac] = c.split('.'); return mac === sign(exp) && Date.now() < +exp; };
  const studioOnly = (req, res, next) => isStudio(req) ? next() : res.redirect('/studio/login');
  app.locals.analytics = require('./analytics').mountAnalytics(app, { db, V, C, studioOnly, ledger, mailState: () => mail.state || null }); // the numbers: every page and API hit, first-party, Studio → Back office → Analytics
  require('./tenants').mountTenants(app, { db, V, C, isStudio, makerOf: req => (app.locals.accounts ? app.locals.accounts.makerOf(req) : null) }); // a museum's own house on its own domain; /enterprise
  const zone = require('./zone').mountZone(app, { db, V, images, originalPath, cache, isStudio, makerOf: req => (app.locals.accounts ? app.locals.accounts.makerOf(req) : null) }); // the rooms: child-safe by default; adult rooms by the door
  const OB = require('./object').mountObject(app, { db, V, ledger, studioOnly, isStudio, makerOf: req => (app.locals.accounts ? app.locals.accounts.makerOf(req) : null), mk }); // the physical work: kinds, the object record, the cabinet's registrar card
  require('./easel').mountEasel(app, { db, V, mk, I: require('./icons') }); // the easel: the master study
  require('./conservation').mountConservation(app, { db, V, C, ledger, mail, images, store, cache, originalPath, originals, studioOnly, mk, notify: null }); // the restoration room: if it is not sound, it is not shown (the sign must come before /w)
  // The audit (Will, 19 Oct: security 3/6): every Studio action that changes anything is told on the register, signed into the
  // chain like everything else (`studio.action`, hidden): the route, the fields that matter (never a password, a secret or a key),
  // the outcome, who was at the desk. Read at Studio → Audit.
  const AUDIT_KEYS = ['status', 'standing', 'price', 'price_cents', 'amount', 'slug', 'ref', 'handle', 'maker', 'number', 'va', 'service_request', 'state', 'decision', 'kind', 'name', 'use', 'fee', 'cents', 'size', 'paper', 'note', 'title', 'launched', 'on', 'from', 'to', 'pct', 'key', 'application', 'label', 'featured', 'public', 'do', 'order', 'reason', 'how'];
  const AUDIT_NEVER = /pass|secret|token|cert|key$|^key$|webhook|api|private/i;
  app.use('/studio', (req, res, next) => {
    if (req.method !== 'POST' || req.path === '/login') return next();
    res.on('finish', () => {
      if (!isStudio(req) && res.statusCode >= 400) return;
      const b = req.body || {}; const data = {};
      for (const k of Object.keys(b)) { if (AUDIT_NEVER.test(k) && k !== 'key') continue; if (AUDIT_KEYS.includes(k) || /^(id|work|license)$/.test(k)) data[k] = String(b[k]).slice(0, 120); }
      if (b.key && req.path.startsWith('/uses')) data.key = String(b.key).slice(0, 40);
      const who = buyerOf(req); const m = app.locals.accounts && app.locals.accounts.makerOf ? app.locals.accounts.makerOf(req) : null;
      try { ledger.append(db, 'studio.action', `${req.method} /studio${req.path}`, { ...data, status: data.status || undefined, http: res.statusCode, by: m ? `maker:${m.handle}` : who && who.email ? who.email.replace(/^(.).*@/, '$1…@') : 'studio', ip: (req.ip || '').slice(0, 45) }); } catch (e) { console.error('[audit]', e.message); }
    });
    next();
  });
  app.get('/studio/audit', studioOnly, (req, res) => {
    const rows = db.prepare("SELECT * FROM ledger WHERE type IN ('studio.action','studio.opened','terms.reviewed','terms.draft','backup.failed','fixity.failed','dispute.upheld','dispute.dismissed','maker.paid','market.settled') ORDER BY seq DESC LIMIT 300").all();
    res.send(V.layout({ title: 'Audit · Studio · Watermark', studio: true, path: '/studio/audit', body: `<section class="studio-wrap"><p class="k">The house</p><h1>The audit.</h1>
<p class="lede">Every action taken at this desk, and every opening of its door, on the register: hashed into the chain and signed with the house key, so nothing here can be quietly changed or removed. Passwords, secrets and keys are never recorded.</p>
${rows.length ? `<table class="tbl au"><tr><th>When</th><th>What</th><th>Detail</th><th>Entry</th></tr>${rows.map(e => { let d = {}; try { d = JSON.parse(e.data || '{}'); } catch (x) { /* */ } const by = d.by || ''; delete d.by; return `<tr><td>${V.esc(V.date(e.at))}<br><small>${V.esc(e.at.slice(11, 19))}</small></td><td><code>${V.esc(e.type)}</code><br><small>${V.esc(e.subject)}</small></td><td><small>${V.esc(Object.entries(d).filter(([k, v]) => v !== undefined && v !== null && k !== 'ip').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '))}${by ? ` · by ${V.esc(by)}` : ''}</small></td><td><small>#${e.seq} · ${V.esc(String(e.hash).slice(0, 10))}</small></td></tr>`; }).join('')}</table>` : '<p>Nothing yet.</p>'}</section>` }));
  });
  // The letters, as they arrive: /studio/letters (the collector's) and ?as=maker (the maker's congratulations),
  // drawn from the latest paid license, or ?ref=. Nothing is sent.
  app.get('/studio/letters', studioOnly, async (req, res) => {
    if (req.query.as === 'looking') { const b0 = req.query.buyer ? db.prepare('SELECT * FROM buyers WHERE code=? OR email=?').get(String(req.query.buyer), String(req.query.buyer)) : db.prepare("SELECT b.* FROM buyers b JOIN stood s ON s.buyer_id=b.id WHERE b.email IS NOT NULL ORDER BY s.at DESC LIMIT 1").get(); if (!b0) return res.send('No collector has stood before anything yet.'); const c = await app.locals.looking.letterFor(b0); if (!c) return res.send('Nothing to offer this collector.'); const out = LETTERS.looking(c); return res.set('Cache-Control', 'no-store').send(out.html.replace('<body style="', `<body data-subject="${V.esc(out.subject)}" style="`)); }
    if (req.query.as === 'friday') { const m0 = req.query.maker ? db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.query.maker)) : maker; if (!m0 || !app.locals.payouts) return res.send('No maker.'); const out = LETTERS.friday(app.locals.payouts.letterFor(m0)); return res.set('Cache-Control', 'no-store').send(out.html.replace('<body style="', `<body data-subject="${V.esc(out.subject)}" style="`)); }
    const g = req.query.ref ? q.lic.get(String(req.query.ref)) : db.prepare("SELECT * FROM licenses WHERE status='active' AND price_cents > 0 ORDER BY id DESC LIMIT 1").get();
    if (!g) return res.send('No paid license yet to draw a letter from.');
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(g.work_id), u = q.useById.get(g.use_id);
    const L = letterFor(g, w, mk(w), u, g.download_token);
    const out = req.query.as === 'maker' ? LETTERS.sold(L) : req.query.as === 'wall' ? LETTERS.ready({ ...L, printUrl: L.printUrl, guideUrl: `${C.base}/print`, proof: L.proof || { price: V.money(require('./keep').PROOF_CENTS), url: L.printUrl } }) : LETTERS.collected(L);
    res.set('Cache-Control', 'no-store').send(out.html.replace('<body style="', `<body data-subject="${V.esc(out.subject)}" style="`));
  });
  // Every maker and estate has their own account and dashboard.
  app.locals.accounts = require('./accounts').mountAccounts(app, { db, C, sign, isStudio, studioOnly, slugify, DEFAULT_USES, V, registerWork: (...a) => registerWork(...a), upload: () => upload, ledger, mail });
  app.locals.steps = require('./steps').mountSteps(app, { db, V, base: C.base, makerOf: req => app.locals.accounts.makerOf(req) });

  // --- public pages ---
  // Never a break (Will, 18 Oct): a link to a photograph no longer shown goes on to the next one, on a phone in the stroll.
  const isPhone = req => /iPhone|iPod|Android.+Mobile|Mobile Safari/i.test(String(req.get('user-agent') || '')) && !/iPad/i.test(String(req.get('user-agent') || ''));
  function onward(req, from) { return isPhone(req) ? '/wander' : `/wander?from=${encodeURIComponent(from || '')}`; }
  app.locals.onward = onward; app.locals.isPhone = isPhone;
  // The front door is the collection; makers have their own entrance.
  // The viewing room: the picture alone on a dark wall, the guide read aloud, and on to the next by itself.
  app.get('/wander/room', (req, res) => {
    if (isPhone(req)) return res.redirect(req.query.at ? `/wander?at=${encodeURIComponent(String(req.query.at))}` : '/wander'); // on a phone, the stroll
    const from = String(req.query.from || '').split(',').filter(Boolean).slice(-12);
    const start = req.query.at ? q.work.get(String(req.query.at)) : null;
    const w = (start && start.status === 'held' ? start : null) || db.prepare(`SELECT * FROM works WHERE status='held'${from.length ? ` AND slug NOT IN (${from.map(() => '?').join(',')})` : ''} ORDER BY (CASE WHEN curated=1 THEN 3 WHEN stars>=4 THEN 2 WHEN stars>=3 THEN 1 ELSE 0 END) * RANDOM() DESC, RANDOM() LIMIT 1`).get(...from);
    res.set('Cache-Control', 'no-store').send(V.viewingRoom({ from: String(req.query.from || ''), first: w ? wanderJSON(w, req) : null }));
  });
  app.get('/api/wander', (req, res) => {
    const from = String(req.query.from || '').split(',').filter(Boolean).slice(-12);
    const w = db.prepare(`SELECT * FROM works WHERE status='held'${from.length ? ` AND slug NOT IN (${from.map(() => '?').join(',')})` : ''} ORDER BY (CASE WHEN curated=1 THEN 3 WHEN stars>=4 THEN 2 WHEN stars>=3 THEN 1 ELSE 0 END) * RANDOM() DESC, RANDOM() LIMIT 1`).get(...from)
      || db.prepare("SELECT * FROM works WHERE status='held' ORDER BY RANDOM() LIMIT 1").get();
    if (!w) return res.json({ none: true });
    res.set('Cache-Control', 'no-store').json(wanderJSON(w, req));
  });
  // What the room needs of a photograph: the picture, the plate, the guide, and the sale: one tap, from the pocket when it covers.
  function wanderJSON(w, req) {
    const m = mk(w); const c = app.locals.closerOf ? app.locals.closerOf(w) : null; const u = q.use.get(m.id, 'social');
    const b = buyerOf(req); const held = heldBy(req, w).length > 0; const pr = u ? priced(u, w) : null;
    const can = u && u.price_cents != null && offered(R.parse(w.rules), 'social', w);
    const pocket = b && app.locals.pocket ? app.locals.pocket.tap(b) : 0;
    const ap = app.locals.applauseOf ? app.locals.applauseOf(w, req) : null;
    return { slug: w.slug, title: V.tidy(w.title), place: w.place || null, year: (w.taken_at || '').slice(0, 4) || null, maker: m.name, makerSlug: V.makerSlug(m), width: w.width, height: w.height,
      img: `/img/${w.slug}/large`, thumb: `/img/${w.slug}/thumb`, guide: c ? c.text : null, study: !!(c && c.study && !c.studyHidden), audio: c ? `/closer/${w.slug}/audio` : null, approved: !!(c && c.state === 'approved'), held,
      collect: can && !held ? { url: `/buy/${w.slug}`, price: V.money(pr.price_cents), pocket: pocket >= pr.price_cents, edition: (() => { const e = edition(w); return e ? { size: e.size, sold: e.sold } : null; })() } : null,
      hat: ap ? { n: ap.n, mine: !!ap.mine } : null, bravo: ap && ap.bravo ? { mine: !!ap.bravo.mine } : null };
  }
  app.locals.wanderJSON = wanderJSON;
  require('./eye').mountEye(app, { db, V });
  require('./stroll').mountStroll(app, { db, V, wanderJSON, I: require('./icons') });
  // Today's photograph: one a day, the same for everyone, chosen from the best by the date, so there is a
  // reason to come back in the morning and something to talk about. /today opens it.
  function todays() {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const rows = db.prepare("SELECT id, slug, title, place, width, height FROM works WHERE status='held' AND COALESCE(zone,'all')='all' AND (curated=1 OR stars>=4) ORDER BY id").all();
    const pool = rows.length >= 7 ? rows : db.prepare("SELECT id, slug, title, place, width, height FROM works WHERE status='held' ORDER BY id").all();
    if (!pool.length) return null;
    const h = crypto.createHash('sha1').update('today:' + day).digest(); const i = h.readUInt32BE(0) % pool.length;
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(pool[i].id) || pool[i]; const m = mk(w) || {};
    let line = null; try { const c = w.closer ? JSON.parse(w.closer) : null; if (c && c.text) line = String(c.text).split(/(?<=[.!?])\s/)[0].slice(0, 180); } catch (e) { /* no guide */ }
    return { ...pool[i], day, maker: m.name || null, makerSlug: m.handle ? V.makerSlug(m) : null, line, year: w.taken_at ? String(w.taken_at).slice(0, 4) : null };
  }
  app.locals.todays = todays;
  app.get('/today', (req, res) => { const t = todays(); res.redirect(t ? `/w/${t.slug}?today=1` : '/collection'); });
  // Wander: a photograph you did not go looking for. The best work weighs more; what you just saw is left out.
  // /wander is the stroll now (stroll.js); the old random-work redirect is gone (Will, 21 Oct: one word, Wander).
  // The artists: every maker whose work hangs here, one layer above the collection. Will is one among many.
  app.get('/artists', (req, res) => {
    const rows = db.prepare(`SELECT m.*, COUNT(w.id) n, MIN(w.created_at) since FROM makers m JOIN works w ON w.maker_id=m.id AND w.status='held' WHERE COALESCE(m.standing,'open')='open' AND m.kind IN ('maker','estate','institution') GROUP BY m.id ORDER BY n DESC, m.id`).all();
    const artists = rows.map(m => ({ ...m, slug: app.locals.makerSlug ? app.locals.makerSlug(m) : m.handle, cover: db.prepare("SELECT slug, title, width, height FROM works WHERE maker_id=? AND status='held' ORDER BY curated DESC, stars DESC, id LIMIT 1").get(m.id),
      collectors: db.prepare("SELECT COUNT(DISTINCT l.buyer_id) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0").get(m.id).n }));
    artists.forEach(a => { const st = RG.standing(db, a.id); a.regard = st.standing; a.shown = st.n; a.held = st.held; }); artists.sort((a, b) => b.regard - a.regard || b.n - a.n);
    res.send(V.artists({ artists }));
  });
  // A minute's cache for the two slowest public rooms (21 Oct: /ledger took 6 s and /makers 3 s on the live house): the
  // register told entry by entry and every maker's standing, built once a minute for strangers; anyone signed in, or
  // the Studio, is built fresh. The page is the same for everyone else.
  const pageCache = new Map();
  const minute = handler => (req, res) => {
    const c = req.cookies || {}; const anon = !c.wm_m && !c.wm_s && !c.bck && !c.wm_staff && !c.wm_as && !req.tenant;
    if (!anon) return handler(req, res);
    const key = req.originalUrl + '#' + (db.prepare('SELECT MAX(seq) s FROM ledger').get().s || 0), hit = pageCache.get(key); // any entry on the register makes the page new
    if (hit && Date.now() - hit.at < 60e3) { res.set('Cache-Control', 'public, max-age=30'); return res.send(hit.body); }
    const send = res.send.bind(res);
    res.send = body => { if (res.statusCode === 200 && typeof body === 'string') { pageCache.set(key, { at: Date.now(), body }); if (pageCache.size > 40) pageCache.delete(pageCache.keys().next().value); } return send(body); };
    return handler(req, res);
  };
  app.locals.minute = minute;
  app.get('/makers', minute((req, res) => res.send(V.home({ maker, works: q.publicWorks.all(), uses: q.uses.all(maker.id), sent: req.query.sent }))));
  app.get(['/', '/collection'], (req, res) => {
    if (app.locals.walk) app.locals.walk.set(res, 'collection');
    const rooms = db.prepare('SELECT id, slug, title FROM collections WHERE public=1 ORDER BY sort DESC, id DESC').all(); // newest stories first
    const ids = db.prepare("SELECT cw.work_id id FROM collection_works cw JOIN works w ON w.id=cw.work_id WHERE cw.collection_id=? AND w.status='held' ORDER BY cw.sort, cw.work_id");
    // Launch fix 2.3: rooms read as places. A series name before a colon ('Journey Out West: The Nixon Library') is
    // the series, not the room; the place after it names the room. The record's own title is unchanged.
    const ROOM_AS = { 'on film': 'Out West, on film' };
    rooms.forEach(r => { r.ids = ids.all(r.id).map(x => x.id); const m = String(r.title || '').match(/^[^:]{3,40}:\s*(.+)$/); if (m) r.title = ROOM_AS[m[1].toLowerCase()] || m[1].replace(/^The /, ''); });
    const socialOf = {}; for (const u of db.prepare("SELECT maker_id, price_cents FROM uses WHERE key='social'").all()) socialOf[u.maker_id] = u.price_cents;
    const makers = Object.fromEntries(db.prepare('SELECT * FROM makers').all().map(m => [m.id, m]));
    const works = RG.byRegard(db, db.prepare("SELECT * FROM works WHERE status='held' ORDER BY id").all())
      .map(w => w.maker_id !== maker.id && !w.share_cents ? { ...w, share_cents: socialOf[w.maker_id] || null } : w)
      .map(w => ({ ...w, maker: makers[w.maker_id] || maker }));
    let heard = new Set(); try { heard = new Set(db.prepare('SELECT DISTINCT work_id FROM voices WHERE public=1 AND audio IS NOT NULL').all().map(r => r.work_id)); } catch (e) { /* none yet */ }
    works.forEach(w => { w.voiced = heard.has(w.id); });
    const front = req.path === '/'; const hangsNow = app.locals.hangs ? app.locals.hangs.publicHangs() : []; const showsList = showsNow(); const td = todays();
    const rowsHtml = front && app.locals.rows ? app.locals.rows.html(req, { works, hangs: hangsNow, shows: showsList, rooms, today: td, cover: works[0] || null }) : null;
    let collectors = 0, collectCents = null;
    if (front) {
      try { collectors = db.prepare("SELECT COUNT(DISTINCT buyer_id) n FROM licenses WHERE buyer_id IS NOT NULL AND collector_no IS NOT NULL AND status IN ('active','expired')").get().n; } catch (e) { collectors = 0; }
      try { const c = works[0]; const u = c ? priced(q.use.get(c.maker_id, 'social'), c) : null; collectCents = u && u.price_cents != null ? u.price_cents : null; } catch (e) { collectCents = null; }
    }
    res.send(V.collection({ front, rowsHtml, maker, works, rooms, share: q.use.get(maker.id, 'social'), pay: payCfg(), lately: app.locals.lately ? app.locals.lately(6) : [], today: td, hangs: hangsNow, shows: showsList, collections: publicCollections(), collectors, collectCents }));
  });
  // The collection's search index, apart from the page so the page stays light as the library grows;
  // cached by the browser and refreshed when a work changes (the ETag is the newest change).
  app.get('/api/index.json', (req, res) => {
    const socialOf = {}; for (const u of db.prepare("SELECT maker_id, price_cents FROM uses WHERE key='social'").all()) socialOf[u.maker_id] = u.price_cents;
    const makers = Object.fromEntries(db.prepare('SELECT * FROM makers').all().map(m => [m.id, m]));
    const stamp = db.prepare("SELECT MAX(created_at) m, MAX(id) i, COUNT(*) n FROM works WHERE status='held'").get(); const last = db.prepare('SELECT MAX(seq) s FROM ledger').get().s;
    const tag = `"${crypto.createHash('sha1').update([stamp.m, stamp.i, stamp.n, last].join(':')).digest('hex').slice(0, 16)}"`;
    res.set('ETag', tag).set('Cache-Control', 'public, max-age=300');
    if (req.headers['if-none-match'] === tag) return res.status(304).end();
    const works = db.prepare("SELECT * FROM works WHERE status='held' ORDER BY id").all().map(w => ({ ...w, maker: makers[w.maker_id] || maker, share_cents: w.maker_id !== maker.id && !w.share_cents ? socialOf[w.maker_id] || null : w.share_cents }));
    let heard = new Set(); try { heard = new Set(db.prepare('SELECT DISTINCT work_id FROM voices WHERE public=1 AND audio IS NOT NULL').all().map(r => r.work_id)); } catch (e) { /* none */ }
    const rooms = db.prepare('SELECT c.slug, cw.work_id FROM collections c JOIN collection_works cw ON cw.collection_id=c.id WHERE c.public=1').all();
    const roomOf = {}; rooms.forEach(r => { (roomOf[r.work_id] = roomOf[r.work_id] || []).push(r.slug); });
    res.json(works.map(w => V.indexRow(w, w.maker, { voiced: heard.has(w.id), rooms: roomOf[w.id] || [] })));
  });

  // Makers apply to hold their work here. Read in the Studio.
  app.get('/apply', (req, res) => res.redirect(301, '/join'));
  app.post('/apply', (req, res) => {
    const b = req.body; const email = String(b.email || '').trim();
    const back = e => res.redirect(`/join?err=${e}&name=${encodeURIComponent(String(b.name || ''))}&email=${encodeURIComponent(email)}`);
    if (!b.name || String(b.name).trim().length < 2) return back('name'); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return back('email'); if (!String(b.portfolio || '').trim()) return back('work');
    db.prepare('INSERT INTO applications (name,email,portfolio,practice,note) VALUES (?,?,?,?,?)').run(String(b.name).slice(0, 120), email.slice(0, 160), String(b.portfolio || '').slice(0, 300) || null, String(b.practice || '').slice(0, 80) || null, String(b.note || '').slice(0, 2000) || null);
    mail.send({ to: maker.email, ...mail.templates.applicationToMaker({ name: b.name, email, portfolio: b.portfolio, practice: b.practice, base: C.base }) });
    res.redirect(303, '/join?sent=1');
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
  require('./director').mountDirector(app, { db, V, C });
  require('./promises').mountPromises(app, { V, C }); // the country store: the house's promises (/promises)
  require('./owners').mountOwners(app, { db, V, C }); // owners: how Krafft is owned and run (/owners, /investors); describes, offers nothing // the founding director: /director, the title on the maker page
  require('./founders').mountFounders(app, { db, V, isStudio, FOUNDING }); // the Founding Collectors; the first named by hand (Will's mother)
  require('./iiif').mountIIIF(app, { db, V, C, registerWork, studioOnly, fetchImpl: cfg.fetchImpl, images, ledger, DEFAULT_USES }); // museums: a collection in from a IIIF manifest; the Image API out; /museums
  require('./institutions').mountInstitutions(app, { db, V, C, mail, ledger, isStudio, makerOf: req => (app.locals.accounts ? app.locals.accounts.makerOf(req) : null), buyerOf: req => buyerOf(req), admit: (req, res, email) => (app.locals.admit ? app.locals.admit(req, res, email) : null), notify: app.locals.notify && app.locals.notify.tell ? app.locals.notify.tell : null }); // museums: the team (staff acting for the institution), the museum strip
  require('./rights').mountRights(app, { db, V, C, mail, isStudio, makerOf: req => (app.locals.accounts ? app.locals.accounts.makerOf(req) : null), notify: app.locals.notify && app.locals.notify.tell ? app.locals.notify.tell : null }); // the rights desk: one door per institution (/rights/:slug), answered from /account/rights
  require('./legal').mountLegal(app, { db, V, C, ledger, buyerOf: req => app.locals.buyerOf(req), isStudio }); // /terms, /privacy, /legal/*: the house's agreements

  // What the visitor already holds of a work: one row per active license, with its use and any open offer.
  const heldBy = (req, w) => { const b = buyerOf(req); if (!b || !w) return [];
    return db.prepare(`SELECT l.id, l.use_id, l.dl_extra, l.ref, l.collector_no, l.ends_at, l.download_token, l.status, u.key, u.name, u.kind, (SELECT ask_cents FROM listings s WHERE s.license_id=l.id AND s.status='open') listed
      FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=? AND l.buyer_id=? AND l.status='active' AND (l.ends_at IS NULL OR l.ends_at > datetime('now')) ORDER BY l.id`).all(w.id, b.id)
      .map(h => ({ ...h, dl: dlOf({ id: h.id, use_id: h.use_id, dl_extra: h.dl_extra }) })); };
  // Holding any license includes the right to share the photograph: Collect is not sold to someone who already holds a larger use.
  const covers = (held, key) => held.some(h => h.key === key || (key === 'social' && h.kind !== 'print'));
  app.locals.heldBy = heldBy;
  // The signs: any door the app shuts with a bare status (sendStatus, status().end()) is shown to a browser as a
  // photograph and a way on, never a number. JSON, images and files keep their plain status.
  const coverFor = () => { try { return db.prepare("SELECT w.slug, w.title, w.width, w.height, m.name AS maker FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.width > w.height ORDER BY (CASE WHEN w.curated=1 THEN 3 WHEN w.stars>=4 THEN 2 ELSE 1 END) * (CASE WHEN w.width>=3840 THEN 4 WHEN w.width>=3000 THEN 2 ELSE 1 END) * RANDOM() DESC LIMIT 1").get() || null; } catch (e) { return null; } };
  const wantsSign = req => req.method === 'GET' && req.accepts('html') && !/^\/(api|img|cab|static|d|portrait|ledger\.json|healthz|sw\.js)/.test(req.path) && !req.xhr;
  app.use((req, res, next) => {
    const sendStatus = res.sendStatus.bind(res);
    res.sendStatus = code => { if (code >= 400 && wantsSign(req)) return res.status(code).send(V.sign({ code, cover: coverFor() })); return sendStatus(code); };
    next();
  });
  // Every address is the person's: a photograph lives under its maker (/m/<maker>/<slug>; /w/<slug> still answers),
  // a gallery, its hangs and showings under the collector (/g/<code>/…). Old links keep working.
  app.get('/m/:maker/:slug', (req, res, next) => { const w = q.work.get(req.params.slug); if (!w) return next(); const m = mk(w); if (V.makerSlug(m) !== String(req.params.maker)) return res.redirect(301, `/m/${V.makerSlug(m)}/${w.slug}`); req.url = `/w/${w.slug}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`; next(); });
  // Back from paying with ?paid=<ref>: settle it with Stripe before the page is drawn, so the work shows as yours.
  app.use(['/w/:slug', '/m/:maker/:slug'], (req, res, next) => (app.locals.rememberShow ? app.locals.rememberShow(req, res, next) : next())); // ?show=<hang slug> from a wall label: the show is remembered, so the sale is the show's (editions.js)
  app.get('/w/:slug', async (req, res, next) => { const r = String(req.query.paid || ''); if (r) { let l = q.lic.get(r); if (l && l.status !== 'active') await Promise.race([settle(l), new Promise(f => setTimeout(f, 6000))]); l = q.lic.get(r); if (l && l.status === 'active' && l.download_token) return res.redirect(`/thanks/${l.ref}?k=${l.download_token}`); } next(); });
  app.get('/w/:slug', (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (w && w.status !== 'held' && !isStudio(req)) return res.redirect(onward(req, w.slug)); // no break: a photograph taken down leads on to the next
    if (!w) return res.status(404).send(V.sign({ code: 404, cover: coverFor() }));
    countView(w.id, null, 'view');
    const rules = R.parse(w.rules);
    const holders = db.prepare(`SELECT COUNT(DISTINCT COALESCE(buyer_id, -id)) n FROM licenses WHERE work_id=? AND status IN ('active','expired') AND price_cents > 0`).get(w.id).n;
    const shown = db.prepare(`SELECT b.name, b.code, MIN(l.collector_no) no FROM licenses l JOIN buyers b ON b.id=l.buyer_id WHERE l.work_id=? AND b.public=1 AND b.code IS NOT NULL AND l.status IN ('active','expired') AND l.price_cents > 0 GROUP BY b.id ORDER BY no LIMIT 5`).all(w.id);
    const mkt = app.locals.market ? { sent: req.query.offer || null, held: db.prepare("SELECT COUNT(*) n FROM licenses WHERE work_id=? AND collector_no IS NOT NULL AND status='active' AND buyer_id IS NOT NULL").get(w.id).n, nos: db.prepare("SELECT collector_no FROM licenses WHERE work_id=? AND collector_no IS NOT NULL AND status='active' AND buyer_id IS NOT NULL ORDER BY collector_no").all(w.id).map(r => r.collector_no), p: app.locals.market.priceOf(w.id), open: db.prepare("SELECT s.id, s.ask_cents, l.collector_no FROM listings s JOIN licenses l ON l.id=s.license_id WHERE l.work_id=? AND s.status='open' ORDER BY s.ask_cents").all(w.id) } : null;
    res.send(V.work({ prints: app.locals.editions ? app.locals.editions.block(w, maker, req) : '', objectLabel: OB.label(w), zoneLabel: zone.label(w), walk: app.locals.walk ? app.locals.walk.walk(req, w.slug) : null, hang: app.locals.hangs ? require('./hangs').hangIt({ w, hangs: app.locals.hangs.mine(buyerOf(req)), hung: req.query.hung ? app.locals.hangs.byId(req.query.hung) : null }) : '', open: app.locals.openOf ? app.locals.openOf(w) : null, thanks: app.locals.thanksOf ? { ...app.locals.thanksOf(w), state: req.query.thanks || null, on: !!stripe, pocket: app.locals.pocket ? app.locals.pocket.tap(buyerOf(req)) : 0 } : null, stood: app.locals.stoodOf ? app.locals.stoodOf(w, req) : null, wander: req.query.wander === '1' || req.query.from === 'wander', office: app.locals.copyrightState ? app.locals.copyrightState(w) : null, mkt, shield: (() => { const sh = shieldOf(w, maker); const mine0 = heldBy(req, w); if (isStudio(req) || (app.locals.accounts.makerOf(req) || {}).id === w.maker_id || mine0.some(h => h.key === 'reference')) sh.archive = w.slug; return sh; })(), w, maker, uses: w.open ? [] : q.uses.all(maker.id).filter(u => listed(rules, u.key, w)).map(u => priced(u, w)), base: C.base, rules, pay: payCfg(), held: { n: holders, shown }, ed: edition(w), story: storyOf(w), voices: app.locals.voicesOf ? app.locals.voicesOf(w) : [], closer: app.locals.closerOf ? app.locals.closerOf(w) : null, mine: heldBy(req, w), up: req.query.up || null, ap: app.locals.applauseOf ? app.locals.applauseOf(w, req) : null, note: req.query.note || null, bench: app.locals.bench ? app.locals.bench.door('work', w) : '', canModerate: isStudio(req) || (app.locals.accounts.makerOf(req) || {}).id === w.maker_id, me: (buyerOf(req) || {}).id || null, edit: isStudio(req) || (app.locals.accounts.makerOf(req) || {}).id === w.maker_id, patron: maker.id === mk(null).id && stripe ? app.locals.patronage.slugOf(maker) : null }));
  });

  // The public life of a photograph: registered, licensed, and (if the maker chooses) what it has earned.
  // The Watermark Shield: what Watermark can stand behind for a photograph, in one place.
  function shieldOf(w, maker) {
    const reg = db.prepare("SELECT seq, hash, at FROM ledger WHERE type='work.registered' AND subject=? ORDER BY seq LIMIT 1").get(w.slug);
    let cred = null; try { cred = w.credentials ? JSON.parse(w.credentials) : null; } catch (e) { /* unreadable */ }
    const fx = app.locals.archive ? app.locals.archive.fixityOf(w) : null;
    return { maker: maker.name, house: maker.house, registered: (reg && reg.at) || w.created_at, seq: reg && reg.seq, hash: reg && reg.hash, accession: w.accession,
      mp: w.width && w.height ? Math.round(w.width * w.height / 1e5) / 10 : null, fixity: fx, archive: null,
      fingerprint: w.sha256, copyright: w.copyright_reg, office: app.locals.copyrightState ? app.locals.copyrightState(w) : null, cred, signs: CR.enabled(), noAI: R.parse(w.rules).never.includes('ai'), object: OB.shieldRow(w), kind: OB.kindWord(w) };
  }
  app.get('/w/:slug/life', (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (!w || w.status !== 'held') return w ? res.redirect(onward(req, w.slug)) : res.sendStatus(404);
    const rules = R.parse(w.rules);
    const lic = db.prepare("SELECT l.id, l.ref, l.starts_at, l.ends_at, l.status, l.price_cents, l.collector_no, u.name AS use_name FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=? AND l.status IN ('active','expired') ORDER BY l.starts_at").all(w.id);
    const reg = db.prepare("SELECT * FROM ledger WHERE type='work.registered' AND subject=? ORDER BY seq LIMIT 1").get(w.slug);
    const ids = lic.map(l => l.id);
    const prints = ids.length ? db.prepare(`SELECT p.*, l.collector_no FROM prints p JOIN licenses l ON l.id=p.license_id WHERE p.license_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.id`).all(...ids) : [];
    const moves = ids.length ? db.prepare(`SELECT t.claimed_at, l.collector_no FROM transfers t JOIN licenses l ON l.id=t.license_id WHERE t.claimed_at IS NOT NULL AND t.license_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.claimed_at`).all(...ids) : [];
    let trades = []; try { trades = db.prepare('SELECT t.price_cents, t.at, l.collector_no FROM trades t JOIN licenses l ON l.id=t.license_id WHERE l.work_id=? ORDER BY t.id').all(w.id); } catch (e) { /* no market yet */ }
    res.send(V.life({ chart: app.locals.marketChart ? app.locals.marketChart(w.id) : '', trades, w, maker, lic, reg, rules, ed: edition(w), prints, moves, shield: shieldOf(w, maker) }));
  });

  app.get('/img/:slug/:size', async (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (!w || !images.SIZES[req.params.size]) return res.sendStatus(404);
    try {
      const fmt = req.query.f === 'jpg' ? 'jpg' : images.pick(req.headers.accept); // mail asks for JPEG by name
      const file = await images.derivative(await originalPath(w), cache, w.slug, req.params.size, fmt);
      res.set('Cache-Control', 'public, max-age=3600, must-revalidate'); // (20 Oct) a copy is rechecked within the hour, never served stale for days
      res.set('Vary', 'Accept');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      res.type(images.FORMATS[fmt][1]).sendFile(file);
    } catch (e) { console.error('[img]', w.slug, req.params.size, e.message); res.set('Cache-Control', 'no-store'); res.sendStatus(/missing from the vault/.test(e.message) ? 404 : 500); }
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
  app.get('/api/k', async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*'); res.set('Cache-Control', 'public, max-age=300');
    const post = String(req.query.post || '').replace(/[^a-z0-9-]/gi, '').slice(0, 160);
    let rows = [];
    try { rows = db.prepare("SELECT s.src, w.slug, w.title, w.rules, w.status, w.width, w.height FROM studios_imports s JOIN works w ON w.id=s.work_id WHERE s.post_slug=? AND w.status IN ('held','hidden')").all(post); } catch (e) { /* no imports yet */ }
    const room = db.prepare('SELECT slug, title, public FROM collections WHERE slug=?').get(post);
    const allUses = q.uses.all(maker.id);
    // Every photograph carries the K. Public ones are collected at once; ones held privately (people,
    // other artists' work) are licensed on request, so nothing is sold without consent.
    const works = rows.map(r => ({ path: imgPath(r.src), slug: r.status === 'held' ? r.slug : null, title: r.title,
      collect: r.status === 'held' && R.allows(R.parse(r.rules), 'social'), ask: r.status !== 'held',
      // What the K can toggle between for this photograph: Collect first, then the licenses it allows.
      page: r.status === 'held' ? `${C.base}/m/${V.makerSlug(maker)}/${r.slug}` : null,
      // Every use the work allows, as on its page: instant ones priced, the rest asked of the maker (the file is too small, or the maker approves by hand).
      uses: r.status === 'held' ? allUses.filter(u => listed(R.parse(r.rules), u.key, r)).map(u => { const pr = priced(u, r); const ask = !offered(R.parse(r.rules), u.key, r) || pr.price_cents == null; return { k: u.key, l: u.key === 'social' ? 'Collect' : u.name, p: ask ? null : pr.price_cents, ask }; }) : [] })).filter(x => x.path);
    const shown = works.filter(w => !w.ask).length;
    let credits = null; try { const cr = app.locals.creditsOf ? await app.locals.creditsOf(post) : null; if (cr && cr.people.length) credits = { people: cr.people.map(p => ({ name: p.name, label: p.label })), tip: stripe ? `${C.base}/tip/${post}` : null }; } catch (e) { /* none */ }
    const firstHeld = works.find(x => x.slug);
    res.json({ base: C.base, room: room && room.public && shown ? { slug: room.slug, title: room.title, url: `${C.base}/rooms/${room.slug}`, n: shown } : null, wander: firstHeld ? `${C.base}/wander?at=${firstHeld.slug}` : null, works, credits,
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
  // Who is at the door: for the house bar on every Krafft site. Same-site cookies carry across
  // *.krafftco.com; elsewhere the answer is nobody, and the bar offers the way in.
  const HOUSE_ORIGINS = /^https:\/\/([a-z0-9-]+\.)?(krafftco|wrkfullerton)\.com$/;
  app.get('/api/me', (req, res) => {
    const o = String(req.headers.origin || ''); if (HOUSE_ORIGINS.test(o)) { res.set('Access-Control-Allow-Origin', o); res.set('Access-Control-Allow-Credentials', 'true'); res.set('Vary', 'Origin'); }
    res.set('Cache-Control', 'private, no-store');
    const m = app.locals.accounts.makerOf(req), b = buyerOf(req);
    if (!m && !b) return res.json({ in: false });
    const name = (m && m.name) || (b && b.name) || null;
    res.json({ in: true, name, initial: name ? name.trim().charAt(0).toUpperCase() : null, maker: m ? { handle: m.handle, slug: V.makerSlug(m) } : null, collector: b ? { code: b.public ? b.code : null } : null });
  });
  app.get('/sw.js', async (req, res) => { res.type('application/javascript').set('Cache-Control', 'no-cache').set('Service-Worker-Allowed', '/'); let f = null; try { f = await served.serve('sw.js'); } catch (e) { /* source */ } res.sendFile(f || path.join(__dirname, '..', 'public', 'sw.js')); });
  app.get('/offline', (req, res) => res.send(V.offline()));
  app.get('/start', (req, res) => res.send(V.startPage()));
  app.get('/app', (req, res) => res.send(V.appPage({ standalone: req.query.app === '1' })));
  app.get('/house.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=60, must-revalidate').set('Access-Control-Allow-Origin', '*'); // one minute: a change to the bar reaches every site at once
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
    if (!w || w.status !== 'held') return w ? res.redirect(onward(req, w.slug)) : res.sendStatus(404);
    countView(w.id, null, 'open');
    const rules = R.parse(w.rules);
    if (!q.uses.all(maker.id).some(u => listed(rules, u.key, w))) return res.redirect(`/w/${w.slug}`); // nothing to license (open, or every use closed)
    res.send(V.buy({ w, maker, rules, simply: app.locals.saidSimply ? app.locals.saidSimply(maker, q.uses.all(maker.id).filter(u => listed(rules, u.key, w)).map(u => priced(u, w))) : '', mine: heldBy(req, w), uses: q.uses.all(maker.id).filter(u => listed(rules, u.key, w)).map(u => priced(u, w)), chosen: req.query.use, renews: /^WM-\d{4}-\d{6}$/.test(String(req.query.renews || '')) ? req.query.renews : null, instant: !!stripe }));
  });

  // One tap: a priced use goes straight to Stripe Checkout (Apple Pay, Google Pay, Link, cards).
  // No account, no form: Stripe collects the buyer's name and email.
  app.post('/buy/:slug', async (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (!w || w.status !== 'held') return res.sendStatus(404);
    const u = priced(q.use.get(maker.id, String(req.body.use || '')), w);
    const rules = R.parse(w.rules);
    if (w.open) return res.redirect(`/w/${w.slug}#open`);
    if (!u || !listed(rules, u.key, w)) return res.redirect(`/license/${w.slug}`);
    // Already held: not sold twice (a renewal is the exception).
    if (!req.body.renews && covers(heldBy(req, w), u.key)) return res.redirect(`/w/${w.slug}#yours`);
    const note = String(req.body.note || '').slice(0, 2000) || null;
    if ((u.key === 'social' || u.key === 'reference') && soldOut(w)) return res.redirect(`/w/${w.slug}`);
    // The contract, assembled from what is being paid for: the use's rights, any added, any extended.
    const t = K.terms({ use: u, add: req.body.add || [], extras: req.body.x || [], never: rules.never, base: u.price_cents, transfer: rules.transfer || null });
    const wants = t.added.length || t.extras.length ? `Rights asked for: ${K.RIGHTS.filter(r => t.rights.includes(r.key)).map(r => r.label).join(', ')}${t.extras.length ? `; ${t.extras.map(k => K.EXTRAS.find(e => e.key === k).label).join(', ')}` : ''}.` : '';
    const noteAll = [wants, note].filter(Boolean).join('\n') || null;
    if (rules.approve) return res.send(V.ask({ w, maker, u, note: noteAll, renews: req.body.renews, approve: true, uses: usesFor(w, maker) }));
    if (req.body.ask || t.ask || u.needsMaster || u.price_cents == null || !stripe) return res.send(V.ask({ w, maker, u, note: u.needsMaster ? [noteAll, 'Needs the full-resolution master.'].filter(Boolean).join('\n') : noteAll, renews: req.body.renews, uses: usesFor(w, maker) }));
    u.price_cents = t.price; t.house = u.house_cents || 0; t.maker = t.price - t.house;
    const ref = nextRef();
    // The exact text accepted at checkout, fingerprinted, so the agreement can be shown word for word later.
    t.version = 'standard-2021-counsel/v0'; t.hash = require('crypto').createHash('sha256').update(JSON.stringify(K.assemble({ t, work: w.title, maker: maker.name, ref }))).digest('hex');
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,intended_use,price_cents,status,conditions,rights) VALUES (?,?,?,?,?,?,?,'awaiting_payment',?,?)")
      .run(ref, w.id, u.id, 'Buyer', '', noteAll, u.price_cents, R.conditions(rules) || null, JSON.stringify(t));
    stampHouse(ref, u);
    if (app.locals.hangs) app.locals.hangs.stampVia(req, ref);
    const renews = /^WM-\d{4}-\d{6}$/.test(String(req.body.renews || '')) ? String(req.body.renews) : null;
    if (renews) db.prepare('UPDATE licenses SET renews=? WHERE ref=?').run(renews, ref);
    // From the pocket: money already in the house, spent in the house, one tap, no checkout.
    if (req.body.from === 'pocket' && app.locals.pocket) {
      const pb = buyerOf(req);
      if (pb && app.locals.pocket.spend(pb, u.price_cents, 'collect', ref, `${w.title.replace(/[.\s]+$/, '')}, No. ${(edition(w) || {}).sold + 1 || ''}`.replace(/, No\. $/, ''))) {
        db.prepare('UPDATE licenses SET buyer_id=?, licensee_name=?, licensee_email=? WHERE ref=?').run(pb.id, pb.name || 'Collector', pb.email || '', ref);
        grant(ref, { paid: true, price_cents: u.price_cents });
        ledger.append(db, 'license.paid.pocket', ref, { work: w.slug, use: u.key, amount: u.price_cents });
        const pl = db.prepare('SELECT collector_no, download_token FROM licenses WHERE ref=?').get(ref) || {};
        if (req.body.json) return res.json({ ok: true, no: pl.collector_no || null, thanks: `/thanks/${ref}?k=${pl.download_token || ''}` });
        return res.redirect(`/thanks/${ref}?k=${pl.download_token || ''}`);
      }
      if (req.body.json) return res.json({ ok: false, why: 'Your pocket does not cover it.' });
    }
    ledger.append(db, 'license.checkout', ref, { work: w.slug, use: u.key });
    try {
      const s = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: u.price_cents, product_data: { name: u.key === 'social' ? `${w.title.replace(/[.\s]+$/, '')}` : `${w.title.replace(/[.\s]+$/, '')}: ${u.name}`, description: u.key === 'social' ? `Yours to share. Photograph by ${maker.name}.` : u.key === 'reference' ? `The full original at reference quality, ${Math.round(w.width * w.height / 1e6)} megapixels. Photograph by ${maker.name}.` : `${u.kind === 'print' ? 'Archival print, signed' : 'License, ' + V.termText(u) + ': ' + K.RIGHTS.filter(r => t.rights.includes(r.key)).map(r => r.label.toLowerCase()).join(', ') + (t.extras.length ? '; ' + t.extras.map(k => K.EXTRAS.find(e => e.key === k).label.toLowerCase()).join(', ') : '')}. Photograph by ${maker.name}. Watermark ${ref}.`, images: [`${C.base}/img/${w.slug}/thumb`] } } }],
        // Share it: nothing but Apple Pay / Google Pay, card or Link (which remembers returning buyers).
        ...(u.key === 'social' ? { submit_type: 'pay' } : { custom_fields: [{ key: 'company', label: { type: 'custom', custom: 'Company or publication' }, type: 'text', optional: true }] }),
        ...(u.kind === 'print' ? { shipping_address_collection: { allowed_countries: ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'CH', 'ES', 'NL', 'AU'] } } : {}),
        metadata: { ref },
        custom_text: { submit: { message: `By paying you accept the Standard Content License Agreement for this order (${ref}), with the rights shown on Watermark: ${C.base}/contract/${w.slug}?use=${u.key}${t.added.map(a => '&add=' + a).join('')}${t.extras.map(a => '&x=' + a).join('')} and the terms of the house: ${C.base}/terms` } },
        success_url: `${C.base}/thanks/${ref}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: /^https:\/\/([a-z0-9-]+\.)?krafftco\.com\//.test(String(req.body.back || '')) ? String(req.body.back).slice(0, 500) : /^\/(wander\/room|stroll)/.test(String(req.query.back || '')) ? `${C.base}${String(req.query.back).slice(0, 200)}` : `${C.base}/license/${w.slug}?use=${u.key}`,
      });
      db.prepare("UPDATE licenses SET stripe_session=? WHERE ref=?").run(s.id, ref);
      res.redirect(303, s.url);
    } catch (e) { console.error('[checkout]', e.message); res.status(502).send(V.ask({ w, maker, u, note, uses: usesFor(w, maker), error: 'Payment is unavailable for a moment. Leave your details and the maker will send a link.' })); }
  });

  // ---------- Share it, paid in place ----------
  // Tap, Face ID, done: the page opens Apple Pay / Google Pay / Link itself (Stripe Express Checkout),
  // the payment is confirmed here, and the file is handed over without leaving the photograph.
  const payCfg = () => { const u = q.use.get(maker.id, 'social'); return stripe && C.stripePk && u && u.price_cents != null ? { pk: C.stripePk, amount: u.price_cents, price: V.money(u.price_cents) } : null; };
  app.locals.payCfg = payCfg;
  // The buyer is known only by a signed cookie on their device; no account, no password.
  const buyerOf = req => { const c = req.cookies && req.cookies.wm_b; if (!c) return null; const [id, mac] = String(c).split('.'); return mac === sign('b' + id) ? db.prepare('SELECT * FROM buyers WHERE id=?').get(+id) : null; };
  app.locals.buyerOf = buyerOf; app.locals.makerSlug = V.makerSlug;
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
    if (covers(heldBy(req, w), 'social')) return res.status(409).json({ ok: false, held: true, page: `/w/${w.slug}#yours` });
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(req.body.email || '')) ? String(req.body.email).slice(0, 160) : '';
    const name = String(req.body.name || '').trim().slice(0, 120) || (email ? email.split('@')[0] : 'Buyer');
    const ref = nextRef();
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,price_cents,status,conditions) VALUES (?,?,?,?,?,?,'awaiting_payment',?)")
      .run(ref, w.id, u.id, name, email, u.price_cents, R.conditions(R.parse(w.rules)) || null);
    stampHouse(ref, u);
    if (app.locals.hangs) app.locals.hangs.stampVia(req, ref);
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
        description: `${w.title.replace(/[.\s]+$/, '')}: Collected. Photograph by ${maker.name}. Watermark ${ref}.`, metadata: { ref, work: w.slug }, ...(email ? { receipt_email: email } : {}) });
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
      l = await settle(l);
    }
    res.json(handover(l));
  });

  // Every Share it after the first: one tap, the remembered card, no sheet. Undo for a short while after.
  app.post('/pay/:slug/tap', async (req, res) => {
    const w = q.work.get(req.params.slug); const maker = mk(w); const u = priced(q.use.get(maker.id, 'social'), w), b = buyerOf(req);
    if (!w || w.status !== 'held' || !u || u.price_cents == null || !stripe || !R.allows(R.parse(w.rules), 'social')) return res.status(404).json({ ok: false });
    if (soldOut(w)) return res.status(409).json({ ok: false, soldOut: true });
    if (covers(heldBy(req, w), 'social')) return res.status(409).json({ ok: false, held: true, page: `/w/${w.slug}#yours` });
    if (!b || !b.pm) return res.json({ ok: false, sheet: true });
    const ref = nextRef();
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,price_cents,status,conditions,buyer_id) VALUES (?,?,?,?,?,?,'awaiting_payment',?,?)")
      .run(ref, w.id, u.id, (b.email || 'Buyer').split('@')[0], b.email || '', u.price_cents, R.conditions(R.parse(w.rules)) || null, b.id);
    stampHouse(ref, u);
    if (app.locals.hangs) app.locals.hangs.stampVia(req, ref);
    try {
      const pi = await stripe.paymentIntents.create({ amount: u.price_cents, currency: 'usd', customer: b.customer, payment_method: b.pm, off_session: true, confirm: true,
        description: `${w.title.replace(/[.\s]+$/, '')}: Collected. Photograph by ${maker.name}. Watermark ${ref}.`, metadata: { ref, work: w.slug, tap: '1' }, ...(b.email ? { receipt_email: b.email } : {}) });
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
    return { ok: true, ref: l.ref, no: l.collector_no, of: w.edition_size || null, price: V.money(l.price_cents), download: `/d/${l.download_token}`, page: `/c/${l.ref}?k=${l.download_token}`, thanks: `/thanks/${l.ref}?k=${l.download_token}`, credit: `Photograph by ${maker.name}${maker.house ? ' · ' + maker.house : ''}`, title: w.title };
  }

  // ---------- Collectors: everyone's own Watermark ----------
  // Every purchase hangs in the buyer's collection, numbered, room by room. Private by default;
  // the collector can open it to the world under a name of their choosing.
  function collected(b) {
    const items = db.prepare(`SELECT l.id, l.ref, l.collector_no, l.price_cents, w.edition_size, (SELECT GROUP_CONCAT(COALESCE(p.size,'') || CASE WHEN p.paper IS NOT NULL AND p.paper != '' THEN ', ' || p.paper ELSE '' END, '; ') FROM prints p WHERE p.license_id=l.id) AS printed, l.starts_at, l.ends_at, l.use_id, l.dl_extra, l.extra_seats, l.licensee_company, l.download_token, l.status, u.name AS use_name, u.key AS use_key, u.kind AS use_kind, w.id AS wid, w.slug, w.title, w.place, w.width, w.height, m.name AS maker, m.handle
      FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id JOIN makers m ON m.id=w.maker_id
      WHERE l.buyer_id=? AND l.status IN ('active','expired') AND (l.price_cents > 0 OR l.intended_use LIKE 'Kept from %') ORDER BY l.starts_at DESC`).all(b.id);
    const ids = [...new Set(items.map(i => i.wid))];
    const rooms = ids.length ? db.prepare(`SELECT c.slug, c.title, COUNT(*) AS total, SUM(CASE WHEN cw.work_id IN (${ids.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS have
      FROM collections c JOIN collection_works cw ON cw.collection_id=c.id JOIN works w ON w.id=cw.work_id AND w.status='held'
      WHERE c.public=1 GROUP BY c.id HAVING have > 0 ORDER BY (have * 1.0 / total) DESC, have DESC`).all(...ids) : [];
    return { items, rooms, works: ids.length, makers: new Set(items.map(i => i.handle)).size };
  }
  // Rembrandt's room: a maker's fives hang in their own gallery as the artist's copies, alongside what they collect.
  app.locals.ownHand = (b, req) => ownHand(b, req);
  const ownHand = (b, req) => { const m = (b && db.prepare('SELECT * FROM makers WHERE buyer_id=? OR (email IS NOT NULL AND email=?) ORDER BY buyer_id=? DESC LIMIT 1').get(b.id, b.email || '', b.id)) || (req && app.locals.accounts.makerOf(req)); if (!m || m.standing === 'held') return []; return db.prepare("SELECT * FROM works WHERE maker_id=? AND status='held' AND stars=5 ORDER BY id DESC").all(m.id).map(w => ({ ...w, maker: m.name, maker_slug: V.makerSlug(m) })); };
  app.get('/yours', (req, res) => {
    let b = buyerOf(req);
    // A maker signed in without a gallery yet is given one: every maker is a collector.
    // A visitor who opens their cabinet or hangs is given a gallery on the spot: both are theirs to begin before they collect.
    // A signed-in maker's gallery is their own (by makers.buyer_id or email), made if they have none: every maker is a collector.
    if (!b) { const m = app.locals.accounts.makerOf(req); if (m) { b = (m.buyer_id && db.prepare('SELECT * FROM buyers WHERE id=?').get(m.buyer_id)) || (m.email && db.prepare('SELECT * FROM buyers WHERE email=?').get(m.email)) || null; if (!b) { const id = db.prepare("INSERT INTO buyers (customer, email, name, code) VALUES ('', ?, ?, ?)").run(m.email || null, m.name, nanoid(10)).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); } db.prepare('UPDATE makers SET buyer_id=COALESCE(buyer_id, ?) WHERE id=?').run(b.id, m.id); setBuyer(res, b); } }
    if (!b && ['cabinet', 'hangs'].includes(String(req.query.tab))) { const id = db.prepare("INSERT INTO buyers (customer, email, code) VALUES ('', NULL, ?)").run(nanoid(10)).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); }
    if (b && !b.code) { db.prepare('UPDATE buyers SET code=? WHERE id=?').run(nanoid(10), b.id); b = buyerOf(req); }
    const give = req.query.give && b ? db.prepare('SELECT t.token, w.title FROM transfers t JOIN licenses l ON l.id=t.license_id JOIN works w ON w.id=l.work_id WHERE t.token=? AND t.from_buyer=? AND t.claimed_at IS NULL').get(String(req.query.give), b.id) : null;
    const col = b ? collected(b) : { items: [], rooms: [], works: 0, makers: 0 };
    const pf = b && col.items.length ? app.locals.market.portfolio(col.items) : null;
    const rights = col.items.filter(i => i.use_key !== 'social' && i.use_kind !== 'print').map(i => ({ ...i, dl: dlOf({ id: i.id, use_id: i.use_id, dl_extra: i.dl_extra }), seats: (() => { try { return db.prepare('SELECT COUNT(*) n FROM seats WHERE license_id=?').get(i.id).n; } catch (e) { return 0; } })(), live: i.status === 'active' && (!i.ends_at || new Date(i.ends_at) > new Date()), soon: i.ends_at && new Date(i.ends_at) - Date.now() < 30 * 864e5 }));
    // The same person is a maker and a collector (20 Oct: on a phone, a collector signed in by code or passkey had no
    // maker cookie, so Yours showed no Studio | Gallery switch). A buyer whose verified email, or buyer_id, is a maker's
    // is given the maker's door here, so the switch is always there.
    let isMaker = !!app.locals.accounts.makerOf(req);
    if (!isMaker && b) { const mm = db.prepare("SELECT * FROM makers WHERE (buyer_id=? OR (email IS NOT NULL AND email<>'' AND email=?)) AND COALESCE(standing,'open')='open' ORDER BY buyer_id=? DESC LIMIT 1").get(b.id, b.email || '', b.id); if (mm) { app.locals.accounts.setMaker(res, mm); isMaker = true; } }
    res.send(V.collector({ hand: ownHand(b, req), rights, isMaker, isHouse: isStudio(req), pocket: app.locals.pocket ? require('./pocket').pocketBlock({ tap: app.locals.pocket.tapOn(b), balance: app.locals.pocket.balance(b), history: app.locals.pocket.history(b), state: req.query.pocket || null, on: !!stripe, cashable: app.locals.pocket.cashable(b), bank: !!(b && b.stripe_account) }) : '', cabinet: app.locals.cabinet ? require('./cabinet').cabinetBlock({ holdings: app.locals.cabinet.holdings(b), showings: app.locals.cabinet.showings(b), state: req.query.cab || null, CAP: app.locals.cabinet.CAP, ACCESS: app.locals.cabinet.ACCESS, registrar: app.locals.cabinetRecord }) : '', hangs: app.locals.hangs ? require('./hangs').hangsBlock({ hangs: app.locals.hangs.mine(b), b: b || {}, pct: app.locals.hangs.CURATOR_PCT, base: C.base, earned: b ? db.prepare("SELECT COALESCE(SUM(cents),0) s FROM pocket WHERE buyer_id=? AND kind='curation' AND status='posted'").get(b.id).s : 0 }) : '', sent: req.query.sent || null, canSend: i => canTransfer({ id: i.id }), looking: app.locals.lookingOf ? app.locals.lookingOf(b, req) : null, tab: req.query.tab || null, b, ...col, book: b && b.public && b.code && app.locals.galleryBook ? app.locals.galleryBook(b, req) : null, me: b ? b.id : null, swaps: app.locals.swaps ? { forMe: app.locals.swaps.forMe(b).map(t => ({ ...t, from_name: (db.prepare('SELECT name FROM buyers WHERE id=?').get(t.from_buyer) || {}).name })), byMe: app.locals.swaps.byMe(b) } : undefined, shared: app.locals.seatsFor ? app.locals.seatsFor(b) : [], lines: app.locals.linesBy ? app.locals.linesBy(b) : [], applauded: app.locals.applaudedBy ? app.locals.applaudedBy(b) : [], regard: app.locals.regardOf ? app.locals.regardOf(b) : null, pf, offer: req.query.offer || null, offers: app.locals.offersFor ? app.locals.offersFor(b) : [], accepted: req.query.accepted || null, own: true, base: C.base, give, got: req.query.got || null, founding: foundingNo(b), first: app.locals.founders ? { is: app.locals.founders.isFirst(b), note: app.locals.founders.note() } : null, left: foundingLeft(), patronOf: pat.of(b), patronSlug: pat.slugOf(maker), keyed: auth.keysOf(b).length > 0, keys: app.locals.keys ? [...app.locals.keys.ofBuyer(b), ...app.locals.keys.ofMaker(app.locals.accounts.makerOf(req))] : [] }));
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
  // Voices: the maker, an art historian, a note, held with each photograph.
  const tips = app.locals.tips = require('./tips').mountTips(app, { db, C, stripe, maker, slugify, ledger, V });
  // Applause and notes: a tip of the hat, and a sentence, held with the work.
  require('./applause').mountApplause(app, { db, buyerOf, setBuyer, isStudio, makerOf: app.locals.accounts.makerOf, ledger, V });
  // Friends of the house, and Keeping for makers' archives.
  require('./friends').mountFriends(app, { db, C, stripe, buyerOf, setBuyer, makerOf: app.locals.accounts.makerOf, ledger, V });
  // Seats: the people at a licensee who hold the license too, each with their own link.
  require('./seats').mountSeats(app, { db, C, buyerOf, setBuyer, ledger, V, mail, stripe });
  // The market: collectors pass numbered pieces on, at their own prices; every trade is priced and recorded.
  require('./hall').mountHall(app, { db, studioOnly, V });
  require('./firsts').mountFirsts(app, { db, buyerOf, V });
  require('./swaps').mountSwaps(app, { db, C, buyerOf, ledger, V, mail });
  const market = require('./market').mountMarket(app, { db, C, maker, buyerOf, setBuyer, isStudio, studioOnly, ledger, V, mk, edition, stripe, mail });
  // The bridge to the U.S. Copyright Office: groups, title lists, deposits, and registration numbers back onto the works.
  app.locals.beta = require('./beta').mountBeta(app, { db, V, mail, studioOnly, C });
  require('./copyright').mountCopyright(app, { db, C, maker, studioOnly, ledger, images, originalPath, cache, V, S });
  require('./ready').mountReady(app, { db, V, C, ledger, mail, studioOnly, makerOf: req => app.locals.accounts.makerOf(req) }); // ready to hang: the two floors, the review room, the edit wanders
  require('./own').mountOwn(app, { db, V, C, ledger, stripe, buyerOf, makerOf: req => app.locals.accounts.makerOf(req), isStudio, studioOnly, registerWork }); // you already own it: the deed, /own, the open door, the Office one tap, said simply
  require('./committee').mountCommittee(app, { db, V, C, ledger, mail, studioOnly, isStudio, buyerOf, makerOf: req => app.locals.accounts.makerOf(req) }); // the committees: the Front Door (who hangs) and the Walls (what stays)
  // Titles set in title case, once, for what is already held (the maker's wording kept in title_given).
  try { const n = require('./titles').retitle(db); if (n) console.log('[titles] set in title case:', n); } catch (e) { console.error('[titles]', e.message); }
  // Look closer: a guide written by AI on every photograph, which the maker can correct, approve or hide.
  require('./closer').mountCloser(app, { db, C, studioOnly, isStudio, makerOf: app.locals.accounts.makerOf, ledger, V,
    imageOf: async w => fs.promises.readFile(await images.derivative(await originalPath(w), cache, w.slug, 'screen')) });
  const voices = require('./voices').mountVoices(app, { db, C, store, isStudio, makerOf: app.locals.accounts.makerOf, mk, ledger, V });
  require('./speech').mountSpeech(app, { db, C, store, closerOf: w => app.locals.closerOf(w) });
  require('./notify').mountNotify(app, { db, C, ledger, V, mk, makerOf: req => app.locals.accounts.makerOf(req), buyerOf });
  // Signing in with a passkey: the collection follows the collector to every device.
  const auth = require('./auth').mountAuth(app, { db, C, buyerOf, setBuyer, ledger, V, makerOf: app.locals.accounts.makerOf, setMaker: app.locals.accounts.setMaker });
  // Signing in by email: a six-digit code or the link in the message; the same email opens a maker's room.
  require('./signin').mountSignin(app, { db, C, buyerOf, setBuyer, ledger, V, mail, makerOf: app.locals.accounts.makerOf, setMaker: app.locals.accounts.setMaker });
  require('./door').mountDoor(app, { db, C, V, ledger, buyerOf, openStudio: res => app.locals.openStudio(res), isStudio, passkeysOf: b => (app.locals.passkeysOf ? app.locals.passkeysOf(b) : []) }); // the Studio door: email code + passkey
  // A collector records a print they have made of a work they hold. It shows on their wall and in the work's life.
  app.post('/yours/print', (req, res) => {
    const b = buyerOf(req), x = req.body || {}; const l = b && q.lic.get(String(x.ref || ''));
    if (!l || l.buyer_id !== b.id || l.status !== 'active') return res.redirect('/yours');
    const t = (v, n) => String(v || '').trim().slice(0, n) || null;
    db.prepare('INSERT INTO prints (license_id, size, paper, made) VALUES (?,?,?,?)').run(l.id, t(x.size, 60), t(x.paper, 80), t(x.made, 40));
    ledger.append(db, 'print.recorded', l.ref, { size: t(x.size, 60), paper: t(x.paper, 80) });
    res.redirect(/^\/yours\/p\/[\w-]+$/.test(String(x.back || '')) ? `${x.back}?ok=recorded` : '/yours#files');
  });
  require('./find').mountFind(app, { db, V, I: require('./icons') });
  app.locals.keep = require('./keep').mountKeep(app, { db, V, C, buyerOf, mk, mail, ledger, dlOf, isStudio, stripe, setBuyer, pocket: () => app.locals.pocket, originalPath });
  require('./batch').mountBatch(app, { db, ledger, studioOnly, isStudio, makerOf: req => app.locals.accounts.makerOf(req), mayHang: m => (app.locals.mayHang ? app.locals.mayHang(m) : true), KINDS: Object.keys(require('./object').KINDS) }); // tick works, do the lot: publish, private, stars, place, kind, curated
  app.locals.editionsRoom = require('./editions').mountEditions(app, { db, C, V, stripe, q, mk, R, K, nextRef, meets, listed, priced, buyerOf, ledger, studioOnly, isStudio, makerOf: req => app.locals.accounts.makerOf(req), notify: null }); // the editions room: prints sold off the wall, at the show and after
  // Passing a work on: the holder makes a one-time link; whoever opens and accepts it becomes the holder,
  // with the same collector number. The old file link stops; the new holder gets their own.
  // May this license pass to another wallet? The agreement decides: a numbered personal piece may; a working
  // license may only when the maker's terms say so. Stored on the license when it was made; judged by use before that.
  function canTransfer(l0) {
    const l = l0 && l0.use_id ? l0 : db.prepare('SELECT * FROM licenses WHERE id=?').get(l0 && l0.id); if (!l) return false;
    try { const r = JSON.parse(l.rights || 'null'); if (r && typeof r.transferable === 'boolean') return r.transferable; } catch (e) { /* older license */ }
    const u = db.prepare('SELECT key, kind FROM uses WHERE id=?').get(l.use_id); if (!u) return false;
    const w = db.prepare('SELECT rules FROM works WHERE id=?').get(l.work_id);
    return ['social', 'reference'].includes(u.key) || u.kind === 'print' || !!R.parse(w && w.rules).transfer;
  }
  app.locals.canTransfer = canTransfer;
  // Send a piece to another wallet: by its address (the code on their gallery) or by email. A known wallet
  // takes it at once; an unknown email gets the claim link. Either way a fresh key, a transfer on the register.
  app.post('/yours/send', (req, res) => {
    const b = buyerOf(req), x = req.body || {}; const l = b && q.lic.get(String(x.ref || ''));
    if (!l || l.buyer_id !== b.id || l.status !== 'active' || !l.collector_no) return res.redirect('/yours?tab=files');
    if (!canTransfer(l)) return res.redirect('/yours?tab=files&sent=locked');
    if (db.prepare("SELECT 1 FROM listings WHERE license_id=? AND status='open'").get(l.id)) return res.redirect('/yours?tab=files&sent=listed');
    const to = String(x.to || '').trim().toLowerCase().replace(/^wm-/, ''); if (!to) return res.redirect('/yours?tab=files&sent=who');
    const email = /@/.test(to) ? to : null;
    let dest = email ? db.prepare('SELECT * FROM buyers WHERE lower(email)=? ORDER BY CASE WHEN customer<>\'\' THEN 0 ELSE 1 END, id LIMIT 1').get(email) : db.prepare('SELECT * FROM buyers WHERE lower(code)=?').get(to);
    if (dest && dest.id === b.id) return res.redirect('/yours?tab=files&sent=self');
    const w = db.prepare('SELECT slug, title FROM works WHERE id=?').get(l.work_id);
    if (dest) {
      const token = nanoid(32);
      db.transaction(() => {
        db.prepare("INSERT INTO transfers (license_id, token, from_buyer, to_buyer, claimed_at) VALUES (?,?,?,?,datetime('now'))").run(l.id, nanoid(24), b.id, dest.id);
        db.prepare("UPDATE licenses SET buyer_id=?, download_token=?, licensee_name=COALESCE(?, licensee_name), licensee_email=COALESCE(?, licensee_email), updated_at=datetime('now') WHERE id=?").run(dest.id, token, dest.name || null, dest.email || null, l.id);
        db.prepare("UPDATE offers SET status='closed', closed_at=datetime('now') WHERE license_id=? AND status='open'").run(l.id);
      })();
      ledger.append(db, 'license.transferred', l.ref, { work: w.slug, collector_no: l.collector_no, how: 'sent', to: dest.code || null });
      if (dest.email) mail.send({ to: dest.email, subject: `Sent to you: ${V.tidy(w.title)}, No. ${l.collector_no}`, text: `${b.name || 'A collector'} sent ${V.tidy(w.title)}, No. ${l.collector_no}, to your gallery on Watermark. It is there now, with its file and its license.\n\n${C.base}/yours` });
      return res.redirect('/yours?tab=files&sent=done');
    }
    if (!email) return res.redirect('/yours?tab=files&sent=unknown');
    let tr = db.prepare('SELECT * FROM transfers WHERE license_id=? AND claimed_at IS NULL').get(l.id);
    if (!tr) { db.prepare('INSERT INTO transfers (license_id, token, from_buyer) VALUES (?,?,?)').run(l.id, nanoid(24), b.id); tr = db.prepare('SELECT * FROM transfers WHERE license_id=? AND claimed_at IS NULL').get(l.id); }
    mail.send({ to: email, subject: `${b.name || 'A collector'} is sending you ${V.tidy(w.title)}, No. ${l.collector_no}`, text: `A numbered photograph is being passed to you on Watermark: ${V.tidy(w.title)}, No. ${l.collector_no}.\n\nTake it into your gallery: ${C.base}/claim/${tr.token}` });
    ledger.append(db, 'license.transfer.offered', l.ref, { work: w.slug, collector_no: l.collector_no });
    res.redirect('/yours?tab=files&sent=mailed');
  });
  app.post('/yours/give', (req, res) => {
    const b = buyerOf(req); const l = b && q.lic.get(String((req.body || {}).ref || ''));
    if (!l || l.buyer_id !== b.id || l.status !== 'active' || !l.collector_no) return res.redirect('/yours');
    if (!canTransfer(l)) return res.redirect('/yours?tab=files&sent=locked');
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
  SETS.basket = { name: 'Your basket' };
  // The basket (Mom, 18 Oct: "I could only collect one image; it needs a cart"). Photographs gathered from anywhere in
  // the house and collected together in one payment: from the pocket in one tap, or one Stripe checkout with a line per
  // photograph. Each is its own license and its own collector number, as if collected one by one. The basket itself
  // lives in the visitor's browser (cookie wm_bk, slugs); nothing is reserved until payment.
  const BASKET_MAX = 40;
  const basketOf = req => [...new Set(String((req.cookies && req.cookies.wm_bk) || '').split(',').map(x => decodeURIComponent(x).trim()).filter(x => /^[a-z0-9-]{1,120}$/.test(x)))].slice(0, BASKET_MAX);
  // Can this collector collect this work now? (the standing order asks without a request)
  const collectFor = (b, slug) => { const x = collectable([slug])[0]; if (!x || !offered(R.parse(x.w.rules), 'social', x.w)) return null;
    if (b && db.prepare("SELECT 1 FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=? AND l.buyer_id=? AND l.status='active' AND (l.ends_at IS NULL OR l.ends_at > datetime('now')) AND u.key IN ('social','reference')").get(x.w.id, b.id)) return null; return x; };
  app.locals.collectFor = collectFor;
  const basketItems = (req, slugs) => {
    const held = new Set();
    const rows = collectable(slugs).filter(x => offered(R.parse(x.w.rules), 'social', x.w) && !heldBy(req, x.w).some(h => h.key === 'social' || h.key === 'reference'));
    const out = []; for (const x of rows) { if (held.has(x.w.id)) continue; held.add(x.w.id); out.push(x); }
    return out;
  };
  app.get('/api/basket', (req, res) => {
    const slugs = String(req.query.s || '').split(',').filter(Boolean).slice(0, BASKET_MAX);
    const items = basketItems(req, slugs.length ? slugs : basketOf(req));
    const b = buyerOf(req); const pocket = b && app.locals.pocket ? app.locals.pocket.tap(b) : 0;
    const total = items.reduce((a, x) => a + x.u.price_cents, 0);
    res.set('Cache-Control', 'no-store').json({ items: items.map(x => ({ slug: x.w.slug, title: V.tidy(x.w.title), maker: mk(x.w).name, place: x.w.place || null, price: x.u.price_cents, thumb: `/img/${x.w.slug}/thumb` })), total, pocket, covers: !!b && pocket >= total && total > 0, signedIn: !!b });
  });
  app.get('/basket', (req, res) => {
    const items = basketItems(req, basketOf(req));
    const b = buyerOf(req); const pocket = b && app.locals.pocket ? app.locals.pocket.tap(b) : 0;
    const total = items.reduce((a, x) => a + x.u.price_cents, 0);
    res.set('Cache-Control', 'private, no-store');
    res.send(V.basketPage({ items: items.map(x => ({ w: x.w, maker: mk(x.w), price: x.u.price_cents })), total, pocket, covers: !!b && pocket >= total && total > 0, buy: !!stripe, note: req.query.ok || null }));
  });
  app.post('/basket/collect', async (req, res) => {
    const items = basketItems(req, basketOf(req));
    if (!items.length) return res.redirect('/basket?ok=' + encodeURIComponent('Nothing in the basket can be collected just now.'));
    const b = buyerOf(req);
    const total = items.reduce((a, x) => a + x.u.price_cents, 0);
    const setRef = `basket:${nextRef()}`;
    const refs = items.map(x => { const ref = nextRef(); db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,price_cents,status,conditions,set_ref,buyer_id) VALUES (?,?,?,?,?,?,'awaiting_payment',?,?,?)").run(ref, x.w.id, x.u.id, (b && b.name) || 'Collector', (b && b.email) || '', x.u.price_cents, R.conditions(R.parse(x.w.rules)) || null, setRef, b ? b.id : null); stampHouse(ref, x.u); return ref; });
    const pocket = app.locals.pocket;
    if (req.body && req.body.from === 'pocket' && b && pocket && pocket.spend(b, total, 'collect', refs[0], `The basket: ${items.length} photograph${items.length === 1 ? '' : 's'}`)) {
      for (const [i, ref] of refs.entries()) { grant(ref, { paid: true, price_cents: items[i].u.price_cents }); ledger.append(db, 'license.paid.pocket', ref, { work: items[i].w.slug, use: 'social', amount: items[i].u.price_cents, basket: true }); }
      res.cookie('wm_bk', '', { maxAge: 0, path: '/' });
      return res.redirect(`/thanks/${refs[0]}`);
    }
    if (!stripe) { db.prepare("DELETE FROM licenses WHERE set_ref=?").run(setRef); return res.redirect('/basket?ok=' + encodeURIComponent('Payments are not open yet.')); }
    ledger.append(db, 'license.checkout', refs[0], { set: setRef, works: items.map(x => x.w.slug) });
    try {
      const ss = await stripe.checkout.sessions.create({ mode: 'payment', submit_type: 'pay', ...(b && b.email ? { customer_email: b.email } : {}),
        line_items: items.map(x => ({ quantity: 1, price_data: { currency: 'usd', unit_amount: x.u.price_cents, product_data: { name: `${V.tidy(x.w.title)}, by ${mk(x.w).name}`, description: 'Collect: yours to keep and share, credited. Numbered in your gallery.', images: [`${C.base}/img/${x.w.slug}/thumb`] } } })),
        custom_text: { submit: { message: `By paying you accept the Standard Content License Agreement for each photograph collected (Collect) and the terms of the house: ${C.base}/terms` } },
        metadata: { ref: refs[0], set: setRef },
        success_url: `${C.base}/thanks/${refs[0]}?session_id={CHECKOUT_SESSION_ID}&basket=1`,
        cancel_url: `${C.base}/basket` });
      db.prepare('UPDATE licenses SET stripe_session=? WHERE set_ref=?').run(ss.id, setRef);
      res.redirect(303, ss.url);
    } catch (e) { console.error('[basket]', e.message); db.prepare("DELETE FROM licenses WHERE set_ref=? AND status='awaiting_payment'").run(setRef); res.redirect('/basket?ok=' + encodeURIComponent('Checkout could not open just now. Try again in a moment.')); }
  });
  app.get('/series/:slug', (req, res) => {
    const s = SERIES.find(x => x.slug === req.params.slug); if (!s) return res.sendStatus(404);
    if (app.locals.walk) app.locals.walk.set(res, `series:${s.slug}`);
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
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: price, product_data: { name: label, description: `${items.length} photographs by ${s.maker}, each yours to keep and share, each numbered in your gallery. ${V.money(full)} if collected one by one.`, images: items.slice(0, 3).map(x => `${C.base}/img/${x.w.slug}/thumb`) } } }],
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
  // Paid but not yet granted (18 Oct: a $5 Collect paid in place went through at Stripe, but the page's call and the
  // webhook both missed it, during a restart). The house asks Stripe itself: every few minutes, every license still
  // awaiting payment from the last three days is checked, and what Stripe says is paid is granted, with the buyer's
  // email taken from the payment when the sheet never asked for one. Nothing is charged here; it only reads.
  async function settle(l) {
    if (!stripe || !l || l.status === 'active' || !l.stripe_session) return l;
    try {
      if (/^pi_/.test(l.stripe_session)) {
        const pi = await stripe.paymentIntents.retrieve(l.stripe_session, { expand: ['latest_charge'] });
        if (!pi || pi.status !== 'succeeded') return l;
        const bd = (pi.latest_charge && pi.latest_charge.billing_details) || {};
        const email = pi.receipt_email || bd.email || null, name = bd.name || (email ? email.split('@')[0] : null);
        if (email) db.prepare("UPDATE licenses SET licensee_email=CASE WHEN COALESCE(licensee_email,'')='' THEN ? ELSE licensee_email END, licensee_name=CASE WHEN COALESCE(licensee_name,'') IN ('','Buyer') AND ? IS NOT NULL THEN ? ELSE licensee_name END WHERE ref=? AND status!='active'").run(email, name, name, l.ref);
        if (email && l.buyer_id) db.prepare('UPDATE buyers SET email=COALESCE(email, ?) WHERE id=?').run(email, l.buyer_id);
        console.log('[settle] granted', l.ref);
        return grant(l.ref, { paid: true, price_cents: pi.amount_received });
      }
      if (/^cs_/.test(l.stripe_session)) {
        const s = await stripe.checkout.sessions.retrieve(l.stripe_session);
        if (!s || s.payment_status !== 'paid') return l;
        console.log('[settle] granted', l.ref);
        if (s.metadata && s.metadata.set) { grantSet(s.metadata.set, s); return q.lic.get(l.ref); }
        fillBuyer(l.ref, s); return grant(l.ref, { paid: true, price_cents: s.amount_total, session: s });
      }
    } catch (e) { console.error('[settle]', l.ref, e.message); }
    return l;
  }
  async function settleAll() {
    if (!stripe) return 0;
    const rows = db.prepare("SELECT * FROM licenses WHERE status='awaiting_payment' AND stripe_session IS NOT NULL AND updated_at > datetime('now','-3 days') ORDER BY id").all();
    const seen = new Set(); let n = 0;
    for (const l of rows) { if (seen.has(l.stripe_session)) continue; seen.add(l.stripe_session); const g = await settle(l); if (g && g.status === 'active') n++; }
    return n;
  }
  app.locals.settle = settle; app.locals.settleAll = settleAll;
  // Once (18 Oct): every letter refused between the evening of the 17th and the mail fix goes out again, to each
  // collector with an address, then the maker is told in one note what was sent. Marked done before it begins.
  async function lettersAgain() {
    try { db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)'); } catch (e) { /* made elsewhere */ }
    if (db.prepare("SELECT 1 FROM settings WHERE k='letters_again_1017'").get()) return;
    db.prepare("INSERT INTO settings (k, v) VALUES ('letters_again_1017', ?)").run(new Date().toISOString());
    const rows = db.prepare("SELECT * FROM licenses WHERE status='active' AND starts_at >= '2026-10-17T22:30:00Z' AND starts_at < '2026-10-18T20:28:00Z' AND COALESCE(licensee_email,'')!='' ORDER BY id").all();
    const out = [];
    for (const g of rows) {
      try {
        const w = db.prepare('SELECT * FROM works WHERE id=?').get(g.work_id), m = mk(w), u = q.useById.get(g.use_id);
        await mail.send({ to: g.licensee_email, ...LETTERS.collected(letterFor(g, w, m, u, g.download_token)) });
        out.push(`${tidyTitle(w.title)} (${g.ref}) to ${g.licensee_email}`);
      } catch (e) { console.error('[letters again]', g.ref, e.message); }
      await new Promise(f => setTimeout(f, 700));
    }
    console.log('[letters again]', out.length);
    if (out.length && maker.email) mail.send({ to: maker.email, subject: `${out.length} letter${out.length === 1 ? '' : 's'} sent again`, text: `The house's mail was refused from the evening of 17 October until this afternoon, so these collectors never had their letters. Each has now been sent again:\n\n${out.join('\n')}\n\nWatermark` });
  }
  if (process.env.NODE_ENV !== 'test') setTimeout(() => lettersAgain().catch(e => console.error('[letters again]', e.message)), 60e3).unref();
  if (process.env.NODE_ENV !== 'test') { setTimeout(() => settleAll().catch(() => {}), 20e3).unref(); setInterval(() => settleAll().catch(() => {}), 5 * 60e3).unref(); }
  // The Journal: Krafft Studios writes, Watermark shows. Every Studios article tagged "watermark"
  // (news, art history, patronage) appears here, linked back to Studios where it was published.
  let journal = { at: 0, posts: [] };
  // Stories by a maker, from Krafft Studios (Ghost), by author slug; ten minutes' cache per maker.
  const storiesCache = new Map();
  async function storiesBy(m) {
    const slug = slugify(m.name); const hit = storiesCache.get(slug); if (hit && Date.now() - hit.at < 10 * 60e3) return hit.posts;
    let posts = [];
    try {
      const API = process.env.GHOST_CONTENT_API || 'https://krafftstudios.ghost.io/ghost/api/content';
      const KEY = process.env.GHOST_CONTENT_KEY || '8198cc66daa230f254acfaf9d5';
      const r = await (cfg.fetchImpl || fetch)(`${API}/posts/?key=${KEY}&filter=authors:${slug}&limit=6&include=tags&fields=title,slug,url,custom_excerpt,excerpt,feature_image,published_at,reading_time&order=published_at%20desc`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) posts = ((await r.json()).posts || []);
    } catch (e) { /* none */ }
    storiesCache.set(slug, { at: Date.now(), posts }); return posts;
  }
  app.locals.storiesBy = storiesBy;
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
  app.get('/journal', async (req, res) => res.send(V.journal({ posts: await journalPosts(), study: db.prepare("SELECT slug, title, place, width, height FROM works WHERE status='held' AND (curated=1 OR stars>=4) ORDER BY RANDOM() LIMIT 3").all() })));
  // The public collections and the shows now, for Galleries and the Collection's doors.
  function publicCollections() {
    const list = db.prepare(`SELECT b.id, b.code, b.name, COUNT(DISTINCT l.work_id) AS works, MIN(l.collector_no) AS earliest FROM buyers b
      JOIN licenses l ON l.buyer_id=b.id AND l.status IN ('active','expired') AND l.price_cents > 0 JOIN works w ON w.id=l.work_id AND w.status='held'
      WHERE b.public=1 AND b.code IS NOT NULL GROUP BY b.id ORDER BY works DESC, b.id LIMIT 200`).all();
    const thumbs = db.prepare(`SELECT w.slug, w.title FROM licenses l JOIN works w ON w.id=l.work_id AND w.status='held' WHERE l.buyer_id=? AND l.status IN ('active','expired') AND l.price_cents > 0 GROUP BY w.id ORDER BY MAX(l.starts_at) DESC LIMIT 4`);
    list.forEach(c => { c.thumbs = thumbs.all(c.id); });
    list.forEach(c => { c.founding = foundingNo(c); c.first = app.locals.founders ? app.locals.founders.isFirst(c) : false; });
    list.forEach(c => { c.statement = (db.prepare('SELECT statement FROM buyers WHERE id=?').get(c.id) || {}).statement; });
    const G = app.locals.galleries; if (G) list.forEach(c => { c.eye = G.eye(c); });
    return list;
  }
  const showsNow = () => { const G = app.locals.galleries; return G ? G.onNow().map(h => ({ ...h, thumbs: db.prepare("SELECT w.slug FROM hang_works hw JOIN works w ON w.id=hw.work_id AND w.status='held' WHERE hw.hang_id=? ORDER BY hw.pos LIMIT 3").all(h.id) })) : []; };
  app.get('/collectors', (req, res) => {
    const list = publicCollections();
    res.send(V.collectors({ list, left: foundingLeft(), hangs: app.locals.hangs ? app.locals.hangs.publicHangs() : [], shows: showsNow() }));
  });
  app.get('/g/:code', (req, res, next) => { req.url = `/collector/${req.params.code}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`; next(); });
  app.get('/collector/:code', (req, res) => {
    const b = db.prepare('SELECT * FROM buyers WHERE code=? AND public=1').get(String(req.params.code));
    if (b && app.locals.walk) app.locals.walk.set(res, `gallery:${b.code}`);
    if (!b) return res.status(404).send(V.collector({ b: null, items: [], rooms: [], works: 0, makers: 0, own: false, base: C.base }));
    res.send(V.collector({ hand: ownHand(b), b, ...collected(b), book: app.locals.galleryBook ? app.locals.galleryBook(b, req) : null, note: req.query.note || null, me: (buyerOf(req) || {}).id || null, lines: app.locals.linesBy ? app.locals.linesBy(b) : [], applauded: app.locals.applaudedBy ? app.locals.applaudedBy(b) : [], regard: app.locals.regardOf ? app.locals.regardOf(b) : null, own: false, base: C.base, pay: payCfg(), share: q.use.get(maker.id, 'social'), founding: foundingNo(b), first: app.locals.founders ? { is: app.locals.founders.isFirst(b), note: app.locals.founders.note() } : null, patronOf: pat.of(b) }));
  });

  // Every use a work allows, priced, with whether it goes through at once or is asked of the maker: the menu that stays with the buyer.
  const usesFor = (w, maker) => (w.open ? [] : q.uses.all(maker.id).filter(u => listed(R.parse(w.rules), u.key, w)).map(u => priced(u, w)));
  app.get('/buy/:slug', (req, res) => {
    const w = q.work.get(req.params.slug);
    const maker = mk(w); // the work's own maker
    if (!w || w.status !== 'held') return res.sendStatus(404);
    const u = q.use.get(maker.id, String(req.query.use || 'campaign')) || q.uses.all(maker.id)[0];
    res.send(V.ask({ w, maker, u, uses: usesFor(w, maker) }));
  });

  // The moment after paying: the work is theirs, the file is ready, the email is on its way.
  app.get('/thanks/:ref', async (req, res) => {
    let l = q.lic.get(req.params.ref);
    // The holder's key opens it too (23 Oct): a pocket one-tap or a payment in place lands here like a Checkout does.
    const byKey = l && l.status === 'active' && req.query.k && l.download_token && req.query.k === l.download_token;
    if (!l || (!byKey && (!req.query.session_id || l.stripe_session !== req.query.session_id))) return res.redirect(l ? `/c/${l.ref}` : '/');
    if (l.set_ref) { // a set: every photograph in it, numbered, hung together
      if (l.status !== 'active' && stripe) { try { const s = await stripe.checkout.sessions.retrieve(req.query.session_id); if (s.payment_status === 'paid') grantSet(l.set_ref, s); } catch (e) { /* show pending */ } }
      const all = db.prepare('SELECT * FROM licenses WHERE set_ref=? ORDER BY id').all(l.set_ref);
      if (all.every(x => x.status === 'active')) {
        let b = buyerOf(req);
        if (!b) { const id = db.prepare("INSERT INTO buyers (customer, email) VALUES ('', ?)").run(l.licensee_email || null).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); }
        db.prepare('UPDATE licenses SET buyer_id=COALESCE(buyer_id, ?) WHERE set_ref=?').run(b.id, l.set_ref);
      }
      const items = db.prepare('SELECT l.*, w.slug, w.title, w.place FROM licenses l JOIN works w ON w.id=l.work_id WHERE l.set_ref=? ORDER BY l.id').all(l.set_ref);
      if (l.set_ref.startsWith('basket:') && items.every(x => x.status === 'active')) res.cookie('wm_bk', '', { maxAge: 0, path: '/' });
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
    const needsMaker = u.price_cents == null || rules.approve || !stripe || !meets(w, u.key);
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
      line_items: [{ quantity: 1, price_data: { currency: l.currency, unit_amount: l.house_cents != null ? l.price_cents : FEE.total(l.kind === 'print' ? 'print' : (q.useById.get(l.use_id) || {}).key, l.price_cents), product_data: { name: `${l.use_name} license: ${l.title}`, description: `Watermark ${ref}. Photograph by ${maker.name}.` } } }],
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
    prov.certificatePdf(res, { ref: l.ref, title: w.title, maker: maker.name, house: maker.house, licensee: l.licensee_company || l.licensee_name, use: u.name, description: u.description, starts: l.starts_at, ends: l.ends_at, fee: l.price_cents != null ? V.money(l.price_cents, l.currency) : null, fingerprint: w.sha256, ledgerHash: e && e.hash, base: C.base, intended: l.intended_use, conditions: l.conditions, credentials: CR.enabled() });
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
    const me = buyerOf(req); if (me && l.buyer_id === me.id) owner = true; // in your account
    if (l.status !== 'active' && owner) l = await settle(l); // paid at Stripe but not yet told here
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    const maker = mk(w); // the work's own maker
    const resend = owner && l.status === 'active' ? { room: `/yours/p/${encodeURIComponent(l.ref)}${l.download_token ? `?k=${l.download_token}` : ''}`, email: l.licensee_email || (me && me.email) || '', sent: req.query.sent ? String(req.query.sent).slice(0, 160) : null } : null;
    res.send(V.certificate({ lic: l, w, maker, use: q.useById.get(l.use_id), entry: q.lastEntryFor.get(l.ref), base: C.base, owner, seats: owner && app.locals.seatsOf ? app.locals.seatsOf({ ...l, use_key: (q.useById.get(l.use_id) || {}).key }) : null, seat: req.query.seat || null, dl: dlOf(l), resend }));
  });
  // Send it again (Will, 18 Oct: the letter never came): the holder, signed in or holding the key, asks for the
  // collector's letter once more, to the address on the license or a new one (kept on the license when it had none).
  const resent = new Map();
  app.post('/c/:ref/resend', (req, res) => {
    const l = q.lic.get(req.params.ref); if (!l || l.status !== 'active') return res.sendStatus(404);
    const me = buyerOf(req), back = k => `/c/${encodeURIComponent(l.ref)}?${l.download_token && req.get('referer') && req.get('referer').includes('k=') ? 'k=' + l.download_token + '&' : ''}sent=${encodeURIComponent(k)}#again`;
    if (!(isStudio(req) || (me && l.buyer_id === me.id) || (req.get('referer') || '').includes('k=' + l.download_token))) return res.sendStatus(403);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect(303, back('no'));
    const t = resent.get(l.ref) || 0; if (Date.now() - t < 60e3) return res.redirect(303, back('slow')); resent.set(l.ref, Date.now());
    if (!l.licensee_email) db.prepare('UPDATE licenses SET licensee_email=? WHERE ref=?').run(email, l.ref);
    if (me && !me.email) db.prepare('UPDATE buyers SET email=? WHERE id=?').run(email, me.id);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id), maker = mk(w), u = q.useById.get(l.use_id), g = q.lic.get(l.ref);
    try { mail.send({ to: email, ...LETTERS.collected(letterFor(g, w, maker, u, g.download_token)) }); }
    catch (e) { console.error('[letters]', e.message); mail.send({ to: email, ...mail.templates.grantedToLicensee({ ref: g.ref, title: w.title, name: g.licensee_name, ends: g.ends_at, certUrl: `${C.base}/c/${g.ref}?k=${g.download_token || ''}`, downloadUrl: g.download_token ? `${C.base}/d/${g.download_token}` : null }) }); }
    res.redirect(303, back(email));
  });

  // ---------- The contract ----------
  // Preview while choosing (no names), and the signed copy for each license.
  const contractFor = (w, maker, u, t, extra = {}) => K.assemble({ t, work: tidyTitle(w.title), maker: maker.name, ...extra });
  const tidyTitle = s => String(s || '').replace(/[.\s]+$/, '');
  app.get('/contract/:slug', (req, res) => {
    const w = q.work.get(req.params.slug); const maker = mk(w);
    if (!w || w.status !== 'held') return res.sendStatus(404);
    const rules = R.parse(w.rules);
    let u = priced(q.use.get(maker.id, String(req.query.use || 'commercial')), w);
    if (!u || !offered(rules, u.key, w)) { const on = q.uses.all(maker.id).filter(x => offered(rules, x.key, w)); u = (on.find(x => x.key !== 'social') || on[0] || null) && priced(on.find(x => x.key !== 'social') || on[0], w); } // the first use on offer
    if (!u) return res.sendStatus(404);
    const t = K.terms({ use: u, add: [].concat(req.query.add || []), extras: [].concat(req.query.x || []), never: rules.never, base: u.price_cents, transfer: rules.transfer || null });
    const sections = contractFor(w, maker, u, t, { price: t.price != null && !t.ask ? V.money(t.price) : null });
    res.send(req.query.frag ? V.contractBody(sections) : V.contractPage({ sections, w, maker, u, t, preview: true }));
  });
  app.get('/c/:ref/contract', (req, res) => {
    const l = q.lic.get(req.params.ref); if (!l) return res.sendStatus(404);
    if (!(isStudio(req) || (req.query.k && req.query.k === l.download_token))) return res.redirect(`/c/${l.ref}`);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id), maker = mk(w), u = q.useById.get(l.use_id);
    let t; try { t = l.rights ? JSON.parse(l.rights) : null; } catch (e) { t = null; }
    if (!t) t = K.terms({ use: u, never: R.parse(w.rules).never, base: l.price_cents });
    const sections = contractFor(w, maker, u, t, { licensee: l.licensee_company || l.licensee_name, ref: l.ref, price: l.price_cents != null ? V.money(l.price_cents, l.currency) : null });
    res.send(V.contractPage({ sections, w, maker, u, t, lic: l }));
  });
  app.get('/studio/contract', studioOnly, (req, res) => res.send(S.contract({ review: K.REVIEW, rights: K.RIGHTS, extras: K.EXTRAS, bundles: K.BUNDLES, add: K.ADD_RIGHT })));

  // A comp: the photograph at screen size with a mark across its foot, free for layouts and pitches, not for publication.
  const compLimit = require('./guardrails').limiter({ name: 'comp', max: 120, windowMs: 3600e3 });
  app.get('/comp/:slug', compLimit, async (req, res) => {
    const w = q.work.get(String(req.params.slug)); if (!w || w.status !== 'held') return res.sendStatus(404);
    const maker = mk(w);
    try {
      const file = await images.derivative(await originalPath(w), cache, w.slug, 'screen', 'jpg');
      let out = await MARK.credit(fs.readFileSync(file), { maker: `Comp, not for publication. ${maker.name}`, url: `watermark.krafftco.com/w/${w.slug}` });
      out = MARK.withXmp(out, MARK.xmp({ title: V.tidy(w.title), maker: maker.name, year: (w.taken_at || '').slice(0, 4) || null, credit: `${maker.name} / Watermark`, copyright: `© ${maker.name}. A comp: not for publication.`, licensor: `${C.base}/license/${w.slug}`, statement: `${C.base}/license/${w.slug}`, registry: 'watermark.krafftco.com', accession: w.accession, ref: null, licensee: null, use: null, ends: null, noAI: true, caption: `${V.tidy(w.title)}. A photograph by ${maker.name}. Comp for layout only; license it at watermark.krafftco.com/license/${w.slug}.` }));
      res.set('Content-Disposition', disposition({ utf8: `${V.tidy(w.title)}, ${maker.name} (comp).jpg`, ascii: `${V.tidy(w.title)}, ${maker.name} (comp).jpg`.normalize('NFKD').replace(/[^\x20-\x7e]/g, '') }));
      ledger.append(db, 'comp.taken', w.slug, {});
      res.type('jpg').send(out);
    } catch (e) { res.sendStatus(503); }
  });
  // The Watermark number, looked up: /t/202600008231 (or with spaces, or WM-…) opens the license it names.
  app.get('/t/:n', (req, res) => {
    const ref = TRACK.ref(req.params.n) || (/^WM-\d{4}-\d{6}$/.test(req.params.n) ? req.params.n : null);
    const l = ref ? q.lic.get(ref) : null; if (!l) return res.sendStatus(404);
    res.redirect(`/verify?ref=${encodeURIComponent(l.ref)}`);
  });
  app.get('/d/:token', (req, res) => {
    const l = db.prepare("SELECT * FROM licenses WHERE download_token=?").get(req.params.token);
    // A phone opening the link itself (from the email): a page with the photograph and Save to Photos, not a file
    // dropped in Files. The file is taken only when they tap (and only then counted).
    const nav = /text\/html/.test(req.headers.accept || '') && (req.headers['sec-fetch-mode'] || 'navigate') === 'navigate' && !req.query.raw;
    if (l && l.status === 'active' && nav && /iPhone|iPad|iPod|Android/.test(req.headers['user-agent'] || '')) {
      const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
      res.set('Cache-Control', 'private, no-store');
      return res.send(V.savePage({ w, maker: mk(w), file: `/d/${l.download_token}?raw=1${req.query.size ? `&size=${encodeURIComponent(req.query.size)}` : ''}`, ref: l.ref }));
    }
    deliver(l, res, { size: req.query.size });
  });
  // The licensed file, stamped and sealed: for the holder's link, and for each seat on the license.
  async function deliver(l, res, { size = null, seat = null } = {}) {
    if (!l || l.status !== 'active' || (l.ends_at && new Date(l.ends_at) < new Date())) return res.sendStatus(404);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    const maker = mk(w); // the work's own maker
    const lu = q.useById.get(l.use_id);
    // A licence may fix its own size and strip (23 Oct: a photograph kept from an album leaves at the album's size, with no credit strip, like the album's own files).
    let R = {}; try { R = l.rights ? JSON.parse(l.rights) : {}; } catch (e) { R = {}; }
    const share = size === 'share' || (lu && lu.key === 'social') || R.size === 'share';
    const dl = dlOf(l);
    if (!dl.left) return res.status(410).send(V.layout({ title: 'Downloads used · Watermark', body: `<section class="narrow"><p class="k">License ${V.esc(l.ref)}</p><h1>Every download has been used.</h1><p class="lede">This license came with ${dl.limit} downloads and all have been taken. The files you have are still licensed. For more, write to the maker from <a href="/c/${V.esc(l.ref)}${l.download_token ? `?k=${V.esc(l.download_token)}` : ''}">the license</a>.</p></section>` }));
    const dlId = Number(db.prepare('INSERT INTO downloads (license_id, seat_id, size) VALUES (?,?,?)').run(l.id, seat, share ? 'share' : 'full').lastInsertRowid);
    ledger.append(db, 'file.delivered', l.ref, { work: w.slug, size: share ? 'share' : 'full', left: dl.left - 1 });
    let file; try { file = await originalPath(w); } catch (e) { return res.sendStatus(503); }
    const fname = fileName(w, maker, l.ref, share ? '.jpg' : path.extname(w.original_file).toLowerCase()); const name = fname.ascii;
    if (/\.(jpe?g|png|tiff?)$/i.test(file)) {
      try {
        const u = lu;
        const fmt = share ? 'jpeg' : /\.png$/i.test(file) ? 'png' : /\.tiff?$/i.test(file) ? 'tiff' : 'jpeg';
        const raw = share ? await images.copy(file, 2400) : fs.readFileSync(file); // a share copy straight from the master (21 Oct), the original untouched
        const buf = await marked(raw, { w, maker, ref: l.ref, licensee: l.licensee_company || l.licensee_name, use: u.name, ends: l.ends_at, dlId, share, strip: R.strip === false ? false : null, format: fmt });
        if (fmt !== 'jpeg') { res.set('Content-Disposition', disposition(fname)); return res.type(fmt === 'png' ? 'png' : 'tiff').send(buf); }
        res.set('Content-Disposition', disposition(fname));
        // The Shield goes with the file: Content Credentials naming the maker, the copyright holder and this license.
        if (CR.enabled()) {
          const tmp = path.join(cache, `deliver-${l.ref}-${Date.now()}.jpg`), outp = tmp.replace(/\.jpg$/, '-cr.jpg');
          fs.writeFileSync(tmp, buf);
          const ok = await CR.seal({ input: tmp, output: outp, parent: await originalPath(w), title: w.title, maker: maker.name, year: (w.taken_at || '').slice(0, 4) || null, accession: w.accession,
            url: `${C.base}/w/${w.slug}`, license: `${C.base}/verify?ref=${l.ref}`, ref: l.ref, licensee: l.licensee_company || l.licensee_name, use: u.name, ends: l.ends_at, fingerprint: w.sha256,
            noAI: R.parse(w.rules).never.includes('ai'), resized: !!(lu && lu.key === 'social') });
          const sealed = ok ? fs.readFileSync(outp) : buf; for (const f of [tmp, outp]) fs.rmSync(f, { force: true });
          return res.type('jpg').send(sealed);
        }
        return res.type('jpg').send(buf);
      } catch (e) { /* fall through to the untouched original */ }
    }
    res.download(file, name);
  }
  app.locals.deliver = deliver;

  app.get('/verify', (req, res) => {
    const raw = String(req.query.ref || '').trim().toUpperCase();
    const ref = TRACK.ref(raw) || raw; // a Watermark number (WM 2026 0000 8264) or the ref itself
    const lic = ref ? q.lic.get(ref) : null;
    const w = lic ? db.prepare('SELECT * FROM works WHERE id=?').get(lic.work_id) : null;
    const maker = mk(w); // the work's own maker
    res.send(V.verify({ ref, lic, w, notFound: ref && !lic }));
  });

  // The register, told in plain words with the photographs beside it.
  require('./register').mountRegister(app, { db, V, ledger });
  // The register, whole, with the house's public key: anyone can check the chain and every signature offline.
  app.get('/ledger.json', (req, res) => res.json({ check: ledger.verify(db), house: ledger.publicKey(), signature: 'ed25519 over the entry hash, hex', entries: db.prepare('SELECT * FROM ledger ORDER BY seq').all() }));

  // --- Studio ---
  const openStudio = res => { const exp = String(Date.now() + 1000 * 60 * 60 * 24 * 14); res.cookie('wm_s', `${exp}.${sign(exp)}`, { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 1000 * 60 * 60 * 24 * 14 }); };
  app.locals.openStudio = openStudio;
  const doorNamed = () => !!String(process.env.STUDIO_EMAILS || '').trim();
  // The password answers only while no one is named at the door (STUDIO_EMAILS); then the door is email code + passkey (src/door.js).
  app.get('/studio/login', (req, res) => doorNamed() ? res.redirect('/studio/door') : res.send(S.login({})));
  app.post('/studio/login', (req, res) => {
    if (doorNamed()) return res.status(403).send(S.login({ error: 'The password is retired. The door is your email code and your passkey.' }));
    const ok = C.adminPassword && crypto.timingSafeEqual(crypto.createHash('sha256').update(String(req.body.password || '')).digest(), crypto.createHash('sha256').update(C.adminPassword).digest());
    if (!ok) return res.status(401).send(S.login({ error: C.adminPassword ? 'That password is not right.' : 'Set ADMIN_PASSWORD on the server first.' }));
    openStudio(res);
    try { ledger.append(db, 'studio.opened', 'password', { factors: 'password' }); } catch (e) { /* */ }
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
  app.get('/studio/trove', studioOnly, (req, res) => {
    let rows = troveRows();
    const room = req.query.room ? db.prepare('SELECT * FROM collections WHERE slug=?').get(String(req.query.room)) : null;
    if (room) { const ids = new Set(db.prepare('SELECT work_id FROM collection_works WHERE collection_id=?').all(room.id).map(r => r.work_id)); rows = rows.filter(w => ids.has(w.id)); }
    const st = app.locals.standing ? app.locals.standing() : {}, cp = app.locals.capturesOf ? app.locals.capturesOf() : {}; rows.forEach(w => { w.applause = st[w.id] || 0; w.standing = w.seen ? w.applause / w.seen : 0; w.captures = cp[w.id] || 0; });
    const sorts = { stars: (a, b) => (b.stars || 0) - (a.stars || 0) || b.earned - a.earned, standing: (a, b) => b.applause - a.applause || b.standing - a.standing || b.seen - a.seen, duds: (a, b) => (a.seen >= 20 ? a.standing : 9) - (b.seen >= 20 ? b.standing : 9) || b.seen - a.seen, earned: (a, b) => b.earned - a.earned || b.seen - a.seen, seen: (a, b) => b.seen - a.seen, newest: (a, b) => b.id - a.id, taken: (a, b) => String(b.taken_at || '').localeCompare(String(a.taken_at || '')), untapped: (a, b) => (b.licensed ? -1 : b.seen) - (a.licensed ? -1 : a.seen), unfinished: (a, b) => a.complete - b.complete };
    const sort = sorts[req.query.sort] ? req.query.sort : 'earned';
    rows.sort(sorts[sort]);
    const all = troveRows();
    const totals = { works: all.length, earned: all.reduce((a, w) => a + w.earned, 0), licensed: all.filter(w => w.licensed).length, seen: all.reduce((a, w) => a + w.seen, 0), sealed: all.reduce((a, w) => a + w.sealed, 0), complete: all.length ? Math.round(all.reduce((a, w) => a + w.complete, 0) / all.length) : 0 };
    const untapped = all.filter(w => !w.licensed && w.seen > 0).sort((a, b) => b.seen - a.seen).slice(0, 3);
    res.send(S.trove({ batch: app.locals.batch ? app.locals.batch.bar({ action: '/studio/works/batch', studio: true, back: req.originalUrl.split('?')[0] + (req.query.view ? '?view=' + req.query.view : '') }) : '', view: req.query.view === 'list' ? 'list' : 'wall', maker, rows, totals, sort, room, rooms: db.prepare('SELECT c.*, (SELECT COUNT(*) FROM collection_works cw WHERE cw.collection_id=c.id) n FROM collections c ORDER BY sort, id').all(), untapped, notice: req.query.ok }));
  });


  // Edition sizes, proposed for the maker to approve. A size makes a photograph a numbered limited
  // edition, which is what lets it be traded. Rarer for the works that matter most; never below what has sold.
  function proposeEditions() {
    const series = new Set(require('./series').flatMap(x => x.chapters.flatMap(c => c.works || c.slugs || [])));
    const rows = db.prepare(`SELECT w.id, w.slug, w.title, w.place, w.curated, w.edition_size, w.status,
      (SELECT COUNT(*) FROM licenses l WHERE l.work_id=w.id AND l.collector_no IS NOT NULL AND l.status IN ('active','expired')) AS sold,
      (SELECT COALESCE(SUM(count),0) FROM views v WHERE v.work_id=w.id AND v.day >= date('now','-90 day')) AS seen
      FROM works w WHERE w.maker_id=? AND w.status='held' ORDER BY w.id`).all(maker.id);
    const seenSorted = rows.map(r => r.seen).sort((a, b) => b - a), top = seenSorted[Math.floor(seenSorted.length / 4)] || 0;
    return rows.map(r => {
      let size = 100, why = 'Open to many collectors';
      if (r.seen > 0 && r.seen >= top) { size = 50; why = 'Among the most seen'; }
      if (series.has(r.slug)) { size = 25; why = 'In The Great Rooms'; }
      if (r.curated) { size = 10; why = 'One of your jewels'; }
      size = Math.max(size, r.sold);
      return { ...r, size, why };
    });
  }
  app.get('/studio/editions', studioOnly, (req, res) => res.send(S.editions({ rows: proposeEditions(), notice: req.query.ok })));
  app.post('/studio/editions', studioOnly, (req, res) => {
    const b = req.body || {}; let n = 0;
    for (const r of proposeEditions()) {
      if (!b['on_' + r.id]) continue;
      const v = Math.round(Number(b['size_' + r.id]));
      if (!(v > 0)) continue;
      db.prepare('UPDATE works SET edition_size=? WHERE id=?').run(Math.max(v, r.sold), r.id); n++;
    }
    if (n) ledger.append(db, 'editions.set', maker.handle, { works: n });
    res.redirect('/studio/editions?ok=' + encodeURIComponent(`${n} photograph${n === 1 ? '' : 's'} now numbered as limited editions.`));
  });

  // Launch: every rail Watermark needs to take real money and keep its promises, checked in one place.
  app.get('/studio/launch', studioOnly, async (req, res) => {
    const key = C.stripeKey || '', live = /^(sk|rk)_live_/.test(key);
    const last = db.prepare('SELECT * FROM stripe_events ORDER BY at DESC LIMIT 1').get();
    const seen = new Set(db.prepare('SELECT DISTINCT type FROM stripe_events').all().map(r => r.type));
    const want = ['checkout.session.completed', 'payment_intent.succeeded', 'customer.subscription.deleted'];
    let endpoint = null; try { if (stripe) { const l = await stripe.webhookEndpoints.list({ limit: 20 }); endpoint = l.data.find(e => e.url && e.url.startsWith(C.base)) || null; } } catch (e) { endpoint = { error: e.message }; }
    const enabled = endpoint && endpoint.enabled_events ? endpoint.enabled_events : [];
    const missing = want.filter(t => !(enabled.includes('*') || enabled.includes(t)));
    const n = sql => db.prepare(sql).get().n;
    const held = n("SELECT COUNT(*) n FROM works WHERE status='held'");
    const checks = [
      { group: 'The address', items: [
        { ok: /^https:\/\//.test(C.base), name: 'Served at its own address, over HTTPS', detail: C.base } ] },
      { group: 'Payments', items: [
        { ok: !!stripe, name: 'Stripe connected', detail: stripe ? (live ? 'Live mode: real cards, real money' : 'Test mode: sandbox only, no real money moves') : 'STRIPE_SECRET_KEY is not set in Render' },
        { ok: live, name: 'Live keys', detail: live ? 'Live' : 'Switch STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET to the live ones in Render when ready', manual: !live },
        { ok: !!C.stripePk, name: 'Payment sheet on the page (Apple Pay, cards)', detail: C.stripePk ? 'Publishable key set' : 'STRIPE_PUBLISHABLE_KEY is not set: buyers go to Stripe Checkout instead of paying in place' },
        { ok: !!C.webhookSecret && !!endpoint && !endpoint.error, name: 'Webhook endpoint', detail: endpoint && endpoint.error ? 'Could not read from Stripe: ' + endpoint.error : endpoint ? endpoint.url : 'No endpoint at this address in Stripe' },
        { ok: !!endpoint && !missing.length, name: 'Webhook events', detail: missing.length ? 'Add in Stripe: ' + missing.join(', ') : 'All the events Watermark listens for' },
        { ok: !!last, name: 'Webhook heard from', detail: last ? `${last.type}, ${last.at} UTC${last.livemode ? ' (live)' : ' (test)'}` : 'Nothing received yet. A test purchase will confirm it.' },
        { ok: false, manual: true, name: 'Payouts to other makers, writers and sellers', detail: 'Needs Stripe Connect, after counsel. Until then Watermark records each person\'s share and pays by hand.' } ] },
      { group: 'Email', items: [
        { ok: !!process.env.RESEND_API_KEY, name: 'Receipts, files and invitations by email', detail: process.env.RESEND_API_KEY ? `Sending as ${process.env.MAIL_FROM || 'the default address'}` : 'RESEND_API_KEY is not set: buyers get their file on the thanks page only, and no emails go out' } ] },
      { group: 'The vault', items: [
        { ok: store.kind === 's3', name: 'Originals held off the server', detail: store.kind === 's3' ? 'S3' : 'Local disk only' },
        { ok: !!process.env.VAULT_KEY, name: 'Sealed with Watermark\'s own key', detail: process.env.VAULT_KEY ? 'VAULT_KEY set' : 'Provider encryption only' },
        { ok: CR.enabled(), name: 'Content Credentials on every delivered file', detail: CR.enabled() ? 'Signing' : 'Needs a C2PA certificate (DigiCert, SSL.com and others) as C2PA_CERT and C2PA_KEY' },
        { ok: process.env.MARKET_SETTLEMENT === 'stripe', manual: process.env.MARKET_SETTLEMENT !== 'stripe', name: 'The market settles itself', detail: process.env.MARKET_SETTLEMENT === 'stripe' ? 'Buyers pay through Stripe; collectors and photographers paid through Connect' : 'After counsel: turn on Stripe Connect (Express), add account.updated and checkout.session.expired to the webhook, then MARKET_SETTLEMENT=stripe' },
        (() => { const n = db.prepare("SELECT COUNT(*) n FROM works WHERE status='held'").get().n, g = db.prepare("SELECT COUNT(*) n FROM works WHERE status='held' AND closer IS NOT NULL").get().n; return { ok: !!process.env.ANTHROPIC_API_KEY && g >= n, name: 'Look closer: a guide on every photograph', detail: process.env.ANTHROPIC_API_KEY ? `${g} of ${n} written` + (g < n ? '; the rest are being written' : '') : 'Needs ANTHROPIC_API_KEY (console.anthropic.com)' }; })() ] },
      { group: 'The collection', items: [
        { ok: held > 0, name: 'Photographs public', detail: `${held}` },
        { ok: n("SELECT COUNT(*) n FROM works WHERE status='held' AND edition_size IS NOT NULL") > 0, name: 'Numbered as editions', detail: `${n("SELECT COUNT(*) n FROM works WHERE status='held' AND edition_size IS NOT NULL")} of ${held}. Studio, Editions.` },
        { ok: n("SELECT COUNT(*) n FROM works WHERE copyright_reg IS NOT NULL AND copyright_reg!=''") > 0, name: 'Registered with the U.S. Copyright Office', detail: `${n("SELECT COUNT(*) n FROM works WHERE copyright_reg IS NOT NULL AND copyright_reg!=''")} of ${held}. Studio, Copyright.` } ] },
      (() => {
        // The launch list (Will, 18 Oct): what the public sees first must read as finished.
        const top = db.prepare("SELECT * FROM works WHERE status='held' ORDER BY curated DESC, stars DESC, id DESC LIMIT 10").all();
        const ids = top.map(w => w.id), inTop = ids.length ? `(${ids.join(',')})` : '(0)';
        const notes = top.filter(w => w.note && String(w.note).trim().length > 20).length;
        const caps = top.filter(w => w.caption && String(w.caption).trim().length > 40).length;
        const lines = n(`SELECT COUNT(DISTINCT work_id) n FROM notes WHERE work_id IN ${inTop}`);
        const small = n("SELECT COUNT(*) n FROM works WHERE status='held' AND (COALESCE(width,0) * COALESCE(height,0)) < 12000000");
        const others = n(`SELECT COUNT(DISTINCT w.maker_id) n FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND m.id != ${Number(maker.id) || 0} AND COALESCE(m.kind,'maker') IN ('maker','writer')`);
        const open = app.locals.beta ? app.locals.beta.open() : 0;
        const list = s => top.filter(s).slice(0, 4).map(w => V.tidy(w.title)).join(', ');
        return { group: 'Before the announcement', items: [
          { ok: notes >= 10, name: 'The maker\'s note on the ten in front', detail: `${notes} of ${top.length}.${notes < top.length ? ' Missing: ' + list(w => !(w.note && String(w.note).trim().length > 20)) + '. On each work\'s record.' : ''}` },
          { ok: caps >= 10, name: 'A catalogue note on the ten in front', detail: `${caps} of ${top.length} have two sentences or more.` },
          { ok: lines >= 10, name: 'Guest-book lines from real people on the ten in front', detail: `${lines} of ${top.length} have a line. Ask friends to sign.` },
          { ok: small === 0, name: 'Full masters for every photograph shown', detail: small ? `${small} held at under 12 megapixels. Studio, Masters.` : 'Every one at 12 megapixels or more' },
          { ok: others >= 2, name: 'Two or three makers besides you', detail: `${others} so far. The house is a house when others hang in it. Studio, Accounts.` },
          { ok: open === 0, name: 'Feedback answered', detail: open ? `${open} open. Studio, Feedback.` : 'Nothing open' },
          { ok: false, manual: true, name: 'The test house', detail: 'A second Render service with test keys, for trying every flow without real money. docs/STAGING.md' },
          { ok: false, manual: true, name: 'Uptime watched', detail: 'A monitor on /healthz that texts you when it fails (Better Stack or UptimeRobot, free).' },
          { ok: false, manual: true, name: 'Counsel has read the agreement and the terms', detail: 'docs/CONTRACT.md lists what to ask.' } ] };
      })(),
      { group: 'Words and terms (yours to confirm)', items: [
        { ok: false, manual: true, name: 'Prices', detail: 'Collect, the Reference, the four licenses and prints are drafts' },
        { ok: false, manual: true, name: 'Shares', detail: FEE.on() ? `The price is the maker’s; the house’s share (Collect $${(FEE.COLLECT_HOUSE_CENTS / 100).toFixed(0)}, else ${FEE.schedule()}) is paid by the collector; 10% resale royalty and 5% market fee are drafts` : '85% to the maker, 10% resale royalty and 5% market fee are drafts' },
        { ok: false, manual: true, name: 'Terms for resale', detail: 'The license says non-transferable; counsel to revise it before the market opens' } ] },
    ];
    res.send(S.launch({ checks, live, launched: app.locals.beta ? app.locals.beta.launched() : false, ok: req.query.ok }));
  });
  // Holdings: the Studio's front page.
  app.get('/studio', studioOnly, (req, res) => {
    const all = troveRows();
    const sum = sql => db.prepare(sql).get().s || 0;
    const paid = "l.status IN ('active','expired')";
    const collected = sum(`SELECT SUM(l.price_cents) s FROM licenses l JOIN uses u ON u.id=l.use_id WHERE ${paid} AND u.key='social'`);
    const licensed = sum(`SELECT SUM(l.price_cents) s FROM licenses l JOIN uses u ON u.id=l.use_id WHERE ${paid} AND u.key!='social'`);
    let monthly = 0, gifts = 0, patrons = 0;
    try { monthly = sum("SELECT SUM(amount_cents) s FROM patrons WHERE recurring=1 AND status IN ('active','ending')"); gifts = sum("SELECT SUM(amount_cents) s FROM patrons WHERE recurring=0 AND status IN ('active','ending')"); patrons = db.prepare("SELECT COUNT(*) n FROM patrons WHERE status IN ('active','ending')").get().n; } catch (e) { /* no patronage */ }
    const tipped = app.locals.tipsTo ? app.locals.tipsTo(null) : { s: 0, n: 0 };
    const resale = app.locals.royaltiesTo ? app.locals.royaltiesTo(null) : { r: 0, f: 0, n: 0 };
    const earned = collected + licensed + gifts + tipped.s + resale.r + resale.f;
    const month = sum(`SELECT SUM(l.price_cents) s FROM licenses l WHERE ${paid} AND COALESCE(l.starts_at, l.created_at) >= date('now','start of month')`);
    const ed = new Map(db.prepare("SELECT work_id, COUNT(*) n FROM licenses WHERE collector_no IS NOT NULL AND status IN ('active','expired') GROUP BY work_id").all().map(r => [r.work_id, r.n]));
    const t = { earned, month, works: all.length, rooms: db.prepare('SELECT COUNT(*) n FROM collections').get().n,
      numbered: db.prepare("SELECT COUNT(*) n FROM licenses WHERE collector_no IS NOT NULL AND status IN ('active','expired')").get().n,
      collectors: db.prepare("SELECT COUNT(DISTINCT buyer_id) n FROM licenses WHERE buyer_id IS NOT NULL AND collector_no IS NOT NULL AND status IN ('active','expired')").get().n,
      seen30: all.reduce((a, w) => a + w.seen30, 0), complete: all.length ? Math.round(all.reduce((a, w) => a + w.complete, 0) / all.length) : 0 };
    const streams = [{ name: 'Collected', cents: collected }, { name: 'Licensed', cents: licensed }, { name: 'Resale', cents: resale.r + resale.f, note: `${resale.n} trade${resale.n === 1 ? '' : 's'} · ${V.money(resale.r)} royalties, ${V.money(resale.f)} fees` }, { name: 'Tips', cents: tipped.s, note: `${tipped.n} from readers, to writers and photographers` }, { name: 'Patronage', cents: monthly, per: ' / mo', note: `${patrons} patron${patrons === 1 ? '' : 's'}${gifts ? ` · ${V.money(gifts)} in gifts` : ''}` }];
    const n = sql => db.prepare(sql).get().n;
    const needs = [
      { n: n("SELECT COUNT(*) n FROM licenses WHERE status='requested'"), label: ' license requests to answer', href: '/studio/licenses' },
      { n: n("SELECT COUNT(*) n FROM applications WHERE status='new'"), label: ' makers asking to join', href: '/studio/makers' },
      { n: (() => { try { return n("SELECT COUNT(*) n FROM bids WHERE status='new'"); } catch (e) { return 0; } })(), label: ' requests to buy from collectors', href: '/studio/market' },
      { n: db.prepare("SELECT COUNT(*) n FROM licenses WHERE status='active' AND ends_at IS NOT NULL AND ends_at <= ?").get(new Date(Date.now() + 60 * 864e5).toISOString()).n, label: ' licenses ending within 60 days', href: '/studio/activity' },
      { n: n("SELECT COUNT(*) n FROM sightings WHERE status='new'"), label: ' sightings of your work to look at', href: '/studio/sightings' },
      { n: all.filter(w => w.missing.length).length, label: ' works missing part of their record', href: '/studio/trove?sort=unfinished' },
      { n: all.filter(w => !w.copyright_reg && !w.copyright_group).length, label: ' photographs not yet registered with the U.S. Copyright Office', href: '/studio/copyright' },
      { n: all.filter(w => !w.edition_size && w.status === 'held').length, label: ' public photographs not yet numbered as editions', href: '/studio/editions' },
      { n: all.filter(w => w.status === 'held' && !meets(w, 'campaign')).length, label: ' public photographs held below full resolution: upload their masters', href: '/studio/masters#need' },
    ];
    const rows = all.map(w => ({ ...w, sold: ed.get(w.id) || 0 })).sort((a, b) => b.earned - a.earned || b.seen30 - a.seen30 || b.seen - a.seen).slice(0, 12);
    const recent = db.prepare(`SELECT l.*, w.title, u.name AS use_name FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE ${paid} ORDER BY l.id DESC LIMIT 6`).all();
    // The house's desk (Will, 24 Oct, "do it": the same shell as the maker's): the line and three columns, one verb a row.
    let desk = null;
    try {
      const D = app.locals.deskSummary ? app.locals.deskSummary() : null; const q = (sql, dflt = 0) => { try { return db.prepare(sql).get().n; } catch (e) { return dflt; } };
      const asks = q("SELECT COUNT(*) n FROM house_asks WHERE status='open' OR status IS NULL"), restoring = q("SELECT COUNT(*) n FROM works WHERE status='restoring'"), lost = (vaultState.lost || []).length;
      const lastBackup = (() => { try { return db.prepare("SELECT at FROM backup_runs WHERE kind='backup' AND ok=1 ORDER BY id DESC LIMIT 1").get(); } catch (e) { return null; } })();
      const need = needs.filter(x => x.n > 0);
      const N = D ? D.needs : {};
      // Two numbers the business runs on (Will, 25 Oct): do collectors come back, and how long does a maker wait for a first sale.
      const so = app.locals.standingOrders ? app.locals.standingOrders.summary() : null;
      const again = (() => { const r = db.prepare(`WITH p AS (SELECT l.buyer_id, MIN(l.starts_at) first FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.buyer_id IS NOT NULL AND l.price_cents > 0 AND l.status IN ('active','expired') AND u.key IN ('social','reference') GROUP BY l.buyer_id)
        SELECT COUNT(*) n, SUM(EXISTS (SELECT 1 FROM licenses l2 WHERE l2.buyer_id=p.buyer_id AND l2.price_cents > 0 AND l2.status IN ('active','expired') AND l2.starts_at > p.first AND l2.starts_at <= datetime(p.first, '+60 days'))) back FROM p WHERE p.first <= datetime('now', '-60 days') OR EXISTS (SELECT 1 FROM licenses l3 WHERE l3.buyer_id=p.buyer_id AND l3.price_cents > 0 AND l3.starts_at > p.first)`).get();
        return r && r.n >= 3 ? `${Math.round(100 * (r.back || 0) / r.n)}% of ${r.n} collectors, within 60 days` : null; })();
      const firstSale = (() => { const days = db.prepare(`SELECT (julianday(MIN(l.starts_at)) - julianday(COALESCE(m.joined_at, m.created_at))) d FROM makers m JOIN works w ON w.maker_id=m.id JOIN licenses l ON l.work_id=w.id WHERE l.price_cents > 0 AND l.status IN ('active','expired') AND COALESCE(m.joined_at, m.created_at) IS NOT NULL GROUP BY m.id HAVING d >= 0 ORDER BY d`).all().map(r => r.d);
        if (days.length < 2) return null; const med = days[Math.floor(days.length / 2)]; return `${Math.round(med)} day${Math.round(med) === 1 ? '' : 's'} from joining, the median of ${days.length}`; })();
      desk = {
        line: [[V.money(D ? D.sales.today.c : 0), 'today' + (D && D.sales.today.n ? ' · ' + D.sales.today.n : '')], [V.money(D ? D.sales.month.c : t.month), 'this month'], [String(D ? D.stood.today : 0), 'stood today'], [String(t.collectors), 'collectors']],
        needs: [
          N.requests ? ['/studio/licenses', 'Answer', `${N.requests} license request${N.requests === 1 ? '' : 's'}`] : null,
          N.applications ? ['/studio/makers', 'Decide', `${N.applications} maker${N.applications === 1 ? '' : 's'} asking to join`] : null,
          asks ? ['/studio/accounts#asking', 'Look', `${asks} asking to hang`] : null,
          N.claims ? ['/studio/claims', 'Decide', `${N.claims} claim${N.claims === 1 ? '' : 's'} open`] : null,
          N.prints ? ['/studio/prints', 'Print', `${N.prints} print${N.prints === 1 ? '' : 's'} asked for`] : null,
          N.dinnerNames ? ['/studio/season', 'Draw the table', `${N.dinnerNames} name${N.dinnerNames === 1 ? '' : 's'} down for dinner`] : null,
          ...need.filter(x => /requests to buy/.test(x.label)).map(x => [x.href, 'Settle', x.n === 1 ? 'One of the requests to buy from collectors' : `${x.n} requests to buy from collectors`]),
          ...need.filter(x => /ending within/.test(x.label)).map(x => [x.href, 'Renew', `${x.n} license${x.n === 1 ? '' : 's'} ending within 60 days`]),
          ...need.filter(x => /missing part/.test(x.label)).map(x => [x.href, 'Complete', `${x.n} record${x.n === 1 ? '' : 's'} missing a part`]),
          ...need.filter(x => /requests to buy/.test(x.label)).map(x => [x.href, 'Settle', `${x.n} request${x.n === 1 ? '' : 's'} to buy from collectors`]),
          ...need.filter(x => /ending within/.test(x.label)).map(x => [x.href, 'Renew', `${x.n} license${x.n === 1 ? '' : 's'} ending within 60 days`]),
          ...need.filter(x => /missing part/.test(x.label)).map(x => [x.href, 'Complete', `${x.n} record${x.n === 1 ? '' : 's'} missing a part`]),
          N.feedback ? ['/studio/feedback', 'Read', `${N.feedback} note${N.feedback === 1 ? '' : 's'} from visitors`] : null,
          restoring ? ['/studio/restoration', 'Restore', `${restoring} work${restoring === 1 ? '' : 's'} off view`] : null,
          lost ? ['/studio/restoration', 'Find', `${lost} original${lost === 1 ? '' : 's'} not in the vault`] : null,
          ...need.filter(x => /masters|sightings/.test(x.label)).map(x => [x.href, /masters/.test(x.label) ? 'Upload masters' : 'Look', /masters/.test(x.label) ? `${x.n} public work${x.n === 1 ? '' : 's'} below full resolution` : `${x.n} sighting${x.n === 1 ? '' : 's'} of the work`]),
        ].filter(Boolean),
        work: [
          ['/studio/trove', 'The holdings', `${t.works} held · ${t.rooms} rooms · ${D ? D.house.hidden : 0} kept back`],
          ['/studio/masters', 'Masters', (need.find(x => /masters/.test(x.label)) || { n: 0 }).n + ' below full resolution'],
          ['/studio/accounts', 'The makers', `${D ? D.house.makers : 0} with a studio`],
          ['/studio/copyright', 'The Copyright Office', (need.find(x => /Copyright/.test(x.label)) || { n: 0 }).n + ' not yet registered'],
          ['/studio/editions', 'Editions', (need.find(x => /editions/.test(x.label)) || { n: 0 }).n + ' public works not yet numbered'],
          ['/studio/backups', 'Backups', lastBackup ? 'Last good copy ' + V.date(lastBackup.at) : 'No good copy yet'],
          ['/studio/analytics', 'The numbers', D ? `${D.stood.week} stood this week` : 'Who is on the site'],
        ],
        money: [
          ['/studio/licenses', 'This month', `${V.money(D ? D.sales.month.c : t.month)} · ${D ? D.sales.month.n : 0} sale${D && D.sales.month.n === 1 ? '' : 's'}`],
          ['/studio/licenses', 'All time', `${V.money(t.earned)} · ${t.numbered} numbered`],
          ['/studio/payouts', N.owed >= 100 ? 'Pay the makers' : 'Owed to makers', V.money(N.owed || 0)],
          D && D.friends.n ? ['/friends', 'Friends of the house', `${D.friends.n} · ${V.money(D.friends.c)} a month`] : null,
          D && D.circle.n ? ['/studio/circle', 'The Club', `${D.circle.n} member${D.circle.n === 1 ? '' : 's'}`] : null,
          so && so.n ? ['/studio/licenses', 'Standing orders', `${so.n} · ${V.money(so.cents)} a month`] : null,
          again ? ['/studio/analytics', 'Come back to collect', again] : null,
          firstSale ? ['/studio/accounts', 'A maker’s first sale', firstSale] : null,
          resale.n ? ['/studio/market', 'Resale', `${resale.n} trade${resale.n === 1 ? '' : 's'} · ${V.money(resale.r)} royalties, ${V.money(resale.f)} fees`] : null,
          ['/share', 'The share', require('./fee').on ? 'Paid by the collector, on top' : 'The house keeps its part of each sale'],
        ].filter(Boolean),
        late: recent.slice(0, 3),
      };
    } catch (e) { console.warn('[desk]', e.message); }
    res.send(S.holdings({ maker, t, streams, needs, rows, recent, notice: req.query.ok, desk }));
  });

  // Collections: the maker's rooms. Private by default; a public room has its own page.
  app.post('/studio/collections', studioOnly, (req, res) => {
    const title = String(req.body.title || '').trim().slice(0, 120); if (!title) return res.redirect('/studio/trove');
    let slug = slugify(title), i = 2; while (db.prepare('SELECT 1 FROM collections WHERE slug=?').get(slug)) slug = `${slugify(title)}-${i++}`;
    db.prepare('INSERT INTO collections (slug,title,note,public) VALUES (?,?,?,?)').run(slug, title, String(req.body.note || '').slice(0, 2000) || null, req.body.public ? 1 : 0);
    res.redirect(`/studio/trove?room=${slug}&ok=${encodeURIComponent(`"${title}" is open. Add works to it from their catalogue pages.`)}`);
  });
  app.get('/rooms/:slug', (req, res) => {
    const c = db.prepare('SELECT * FROM collections WHERE slug=? AND public=1').get(req.params.slug); if (!c) return res.sendStatus(404);
    const works = db.prepare("SELECT w.* FROM collection_works cw JOIN works w ON w.id=cw.work_id WHERE cw.collection_id=? AND w.status='held' ORDER BY cw.sort, w.id").all(c.id);
    res.send(V.room({ c, works, maker }));
  });

  // The catalogue record for one work.
  // Who may edit a work's record and terms: the Studio, or the work's own maker (from their own studio).
  const mayEdit = (req, w) => !!(w && (isStudio(req) || (app.locals.accounts.makerOf(req) || {}).id === w.maker_id));
  const deskBase = req => (req.path.startsWith('/account') ? '/account/works' : '/studio/works');
  function saveCatalogue(req, res, w) {
    const b = req.body; const t = (v, n) => String(v || '').trim().slice(0, n) || null;
    db.prepare('UPDATE works SET title=COALESCE(?,title), caption=?, place=?, keywords=?, credit=?, medium=? WHERE id=?')
      .run(t(b.title, 160) && require('./titles').titleCase(t(b.title, 160)), t(b.caption, 4000), t(b.place, 160), t(b.keywords, 400), t(b.credit, 200), t(b.medium, 120), w.id);
    // Share it price for this photograph alone: whole dollars, $3 at least; empty = the maker's standard price.
    const sp = String(b.share || '').trim(); const sc = sp === '' || !(Number(sp) >= 0) ? null : Math.max(3, Math.round(Number(sp))) * 100;
    db.prepare('UPDATE works SET share_cents=? WHERE id=?').run(sc, w.id);
    if ('note' in b) db.prepare('UPDATE works SET note=? WHERE id=?').run(t(b.note, 2000), w.id);
    db.prepare('UPDATE works SET copyright_reg=? WHERE id=?').run(t(b.copyright_reg, 60), w.id);
    // Edition size: blank for an open edition. It can never be set below what has already been collected.
    const es = String(b.edition || '').trim(); const ed = edition({ ...w, edition_size: 1 });
    db.prepare('UPDATE works SET edition_size=? WHERE id=?').run(es === '' || !(Number(es) > 0) ? null : Math.max(Math.round(Number(es)), ed ? ed.sold : 0), w.id);
    // A work too important to share at any price: license only.
    const rl = R.parse(w.rules); rl.social = b.noshare === '1' ? false : undefined; db.prepare('UPDATE works SET rules=? WHERE id=?').run(JSON.stringify(rl), w.id);
    const ids = (b.rooms == null ? [] : Array.isArray(b.rooms) ? b.rooms : [b.rooms]).map(Number).filter(Boolean);
    if (isStudio(req)) db.prepare('DELETE FROM collection_works WHERE work_id=?').run(w.id);
    if (isStudio(req)) { for (const cid of ids) if (db.prepare('SELECT 1 FROM collections WHERE id=?').get(cid)) db.prepare('INSERT OR IGNORE INTO collection_works (collection_id, work_id) VALUES (?,?)').run(cid, w.id); }
    res.redirect(`${deskBase(req)}/${w.slug}?ok=${encodeURIComponent('Catalogue record saved.')}`);
  }
  app.post('/studio/works/:slug/catalogue', studioOnly, (req, res) => { const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404); saveCatalogue(req, res, w); });
  app.post('/account/works/:slug/catalogue', (req, res) => { const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404); if (!mayEdit(req, w)) return res.sendStatus(401); saveCatalogue(req, res, w); });

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
  require('./archive').mountArchive(app, { db, C, q, V, mk, originalPath, images, isStudio, makerOf: req => app.locals.accounts.makerOf(req), heldBy, mail, upload: () => upload, copyrightState: w => (app.locals.copyrightState ? app.locals.copyrightState(w) : null) });
  require('./drop').mountDrop(app, { db, C, V, mail, ledger, buyerOf, setBuyer, mk });
  app.locals.vr = require('./vr').mountVR(app, { db, V });
  app.locals.opening = require('./opening').mountOpening(app, { db, C, V, mail, buyerOf, isStudio });
  require('./deliveries').mountDeliveries(app, { db, C, V, I: require('./icons'), mail, ledger, grant, nextRef, mk, q, makerOf: req => app.locals.accounts.makerOf(req), isStudio, originalPath, images, cache, marked, fileName, buyerOf, setBuyer });
  app.locals.clients = require('./clients').mountClients(app, { db, C, V, ledger, grant, nextRef, mk, q, images, originalPath, cache, studioOnly, isStudio });
  app.get('/studio/fixity', studioOnly, (req, res) => res.send(S.fixity({ sum: app.locals.archive.summary(), failing: db.prepare("SELECT w.slug, w.title, w.accession, f.checked_at, f.note FROM works w JOIN fixity f ON f.id=(SELECT MAX(id) FROM fixity WHERE work_id=w.id) WHERE f.ok=0").all(), ok: req.query.ok || null })));
  app.post('/studio/fixity/run', studioOnly, async (req, res) => { const r = await app.locals.archive.fixity(Number(req.body.n) || 50); res.redirect(`/studio/fixity?ok=${encodeURIComponent(`Checked ${r.ran}: ${r.ok} whole, ${r.bad} failing.`)}`); });
  require('./open').mountOpen(app, { db, V, mk, originalPath, images, cache, ledger, isStudio, makerOf: req => app.locals.accounts.makerOf(req) });
  require('./payouts').mountPayouts(app, { db, C, stripe, makerOf: req => app.locals.accounts.makerOf(req), isStudio, ledger, mail });
  require('./pocket').mountPocket(app, { db, C, stripe, buyerOf, setBuyer, ledger });
  require('./api').mountApi(app, { db, C, V, q, mk, R, listed, offered, priced, shieldOf, ledger, limiter: require('./guardrails').limiter, verifyBuffer: (...a) => app.locals.archive.verifyBuffer(...a), upload: () => upload, makerBySlug: s => [maker, ...db.prepare('SELECT * FROM makers').all()].find(m => V.makerSlug(m) === s || m.handle === s) || null, regard: RG });
  require('./splits').mountSplits(app, { db, V, ledger, isStudio, makerOf: app.locals.accounts.makerOf, mk });
  require('./bridge').mountBridge(app, { db, C, V, ledger, isStudio, studioOnly, makerOf: app.locals.accounts.makerOf, mk });
  require('./atelier').mountAtelier(app, { db, isStudio, makerOf: req => app.locals.accounts.makerOf(req), V });
  require('./introductions').mountIntroductions(app, { db, C, mail, ledger, V, isStudio, makerOf: req => app.locals.accounts.makerOf(req), buyerOf, setMaker: app.locals.accounts.setMaker, setBuyer, slugify, DEFAULT_USES });
  require('./cabinet').mountCabinet(app, { db, C, mail, ledger, store, images, buyerOf, setBuyer });
  require('./looking').mountLooking(app, { db, C, buyerOf, mail, fetchImpl: cfg.fetchImpl });
  require('./walk').mountWalk(app, { db, V, SERIES: require('./series') });
  require('./frame').mountFrame(app, { db, C, V, stripe, buyerOf, ledger, pocket: app.locals.pocket, nextRef, grant, SERIES: require('./series'), collectUse: w => { if (!w) return null; const m = mk(w); const u = q.uses.all(m.id).find(x => x.key === 'social'); return u && u.price_cents > 0 && offered(R.parse(w.rules), 'social', w) ? u : null; } });
  require('./hangs').mountHangs(app, { db, C, V, stripe, buyerOf, setBuyer, ledger, pocket: app.locals.pocket, mk, isStudio, houseMaker: () => db.prepare('SELECT * FROM makers WHERE id=?').get(maker.id) });
  require('./tours').mountTours(app, { db, C, V, store, buyerOf, ledger, isStudio }); // a guide's voice on a wall: /tour/:slug, /guides
  require('./keys').mountKeys(app, { db, V, C, ledger, buyerOf, makerOf: req => app.locals.accounts.makerOf(req), isStudio }); // The Keys: the club; every maker, collector and curator holds keys
  require('./bench').mountBench(app, { db, V, C, buyerOf, makerOf: req => app.locals.accounts.makerOf(req), isStudio, mk, notify: app.locals.notify }); // the benches under works and walls: the talk, one door from the wall
  app.locals.noTimers = !!cfg.noTimers;
  require('./balcony').mountBalcony(app, { db, V, C, ledger, buyerOf, makerOf: req => app.locals.accounts.makerOf(req), isStudio }); // the balcony: the Keys' room, open at hours; nothing said is kept
  require('./clock').mountClock(app, { db, V, C, buyerOf }); // the programme by the visitor's hour; the kids' corner
  require('./hosts').mountHosts(app, { db, V, C, mail, ledger, isStudio, buyerOf, makerOf: req => app.locals.accounts.makerOf(req), notify: app.locals.notify && app.locals.notify.tell ? app.locals.notify.tell : null }); // the host's chair as a job: the rota, paid from the house's side
  require('./screening').mountScreening(app, { db, V, C, ledger, isStudio, buyerOf, makerOf: req => app.locals.accounts.makerOf(req) });
  require('./rows').mountRows(app, { db, V, C }); // the front door's rows (Apple TV as a museum)
  require('./listening').mountListening(app, { db, V, C, ledger, isStudio, buyerOf, makerOf: req => app.locals.accounts.makerOf(req), fetchImpl: cfg.fetchImpl });
  { const multer = require('multer'); const mUp = multer({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: (+process.env.MUSIC_MAX_MB || 400) * 1024 * 1024, files: 1 }, fileFilter: (req, f, cb) => cb(null, /^audio\//.test(f.mimetype) || /\.(wav|flac|aiff?|mp3|m4a|ogg)$/i.test(f.originalname || '')) }); require('./music').mountMusic(app, { db, V, C, store, ledger, isStudio, makerOf: req => app.locals.accounts.makerOf(req), dataDir: C.dataDir, bagcheck: BAG, upload: mUp }); } // the makers' own music: masters in the vault, sides streamed to keyholders // the Keys' room for sound: records from the Archive, cleared at the door, played whole // the Screening Room: films chosen, shown whole at an hour
  require('./edition').mountEdition(app, { db, V, C, isStudio, buyerOf, makerOf: req => app.locals.accounts && app.locals.accounts.makerOf ? app.locals.accounts.makerOf(req) : null }); // the house's edition as a printable book (PDF); before /read/:slug so .pdf is its own door
  require('./reading').mountReading(app, { db, V, C, isStudio, ledger, fetchImpl: cfg.fetchImpl });
  require('./press').mountPress(app, { db, V, C, ledger, isStudio, makerOf: req => app.locals.accounts && app.locals.accounts.makerOf ? app.locals.accounts.makerOf(req) : null }); // the printing house: every maker publishes words
  require('./bookshop').mountBookshop(app, { db, V, C, buyerOf, setBuyer, mail, ledger, isStudio, stripe, makerOf: req => app.locals.accounts && app.locals.accounts.makerOf ? app.locals.accounts.makerOf(req) : null }); // first editions, signed copies, reprints // the public domain shelf (Gutenberg) and the reading room /read/:slug
  require('./season').mountSeason(app, { db, V, C, ledger, stripe, buyerOf, setBuyer, makerOf: req => app.locals.accounts.makerOf(req), isStudio, notify: app.locals.notify }); // the season (the nights), the Circle (the young members), the cards (how people meet)
  require('./standing').mountStanding(app, { db, V, C, ledger, stripe, buyerOf, setBuyer, mail, notify: app.locals.notify, grant, nextRef, stampHouse, collectFor, mk }); // a piece a month: the house chooses, the collector keeps
  require('./desk-api').mountDeskApi(app, { db, C, ledger, stripe }); // the desk's window: one JSON summary for fullerton.cloud, by DESK_KEY
  if (!cfg.noTimers) setInterval(() => { try { const n = app.locals.keys.backfill(); if (n) console.log('[keys]', n, 'keys given'); } catch (e) { console.error('[keys]', e.message); } }, 10 * 60e3).unref();
  require('./galleries').mountGalleries(app, { db, C, V, mail, ledger, makerOf: req => app.locals.accounts.makerOf(req), buyerOf, isStudio });
  require('./trade').mountTrade(app, { db, C, V, I: require('./icons'), mk, mail, ledger, buyerOf });
  require('./curate').mountCurate(app, { db, C, V, I: require('./icons'), mail, ledger, buyerOf, setBuyer, makerOf: req => app.locals.accounts.makerOf(req) });
  require('./library').mountLibrary(app, { db, C, store, stripe, isStudio, studioOnly, buyerOf, setBuyer, ledger, mail, upload: () => upload, V, S: { library: require('./library').libraryDesk, libraryEdit: require('./library').libraryEdit } });
  require('./disputes').mountDisputes(app, { db, C, mail, ledger, V, isStudio, makerOf: req => app.locals.accounts.makerOf(req), mk, shieldOf });
  require('./requests').mountRequests(app, { db, C, q, mail, ledger, V, stripe, checkoutUrl, grant, isStudio, makerOf: req => app.locals.accounts.makerOf(req), upload: () => upload, images, replaceMaster, meets, MIN_MP });
  app.get('/studio/works', studioOnly, (req, res) => res.send(S.works({ list: q.allWorks.all(), notice: req.query.ok, rooms: db.prepare('SELECT id, title FROM collections ORDER BY sort, id').all() })));
  app.post('/studio/works', studioOnly, upload.single('file'), BAG.gate('image'), async (req, res) => {
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
  app.post('/studio/works/one', studioOnly, upload.single('file'), BAG.gate('image', { json: true }), async (req, res) => {
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
  // A better file for a work already held: it becomes the original; derivatives are rebuilt; the record notes it.
  async function replaceMaster(w, f, info, h) {
    const file = f.path;
        const ext = (path.extname(f.originalname) || '.jpg').toLowerCase();
        const name = `${w.slug}-master${ext}`, dest = path.join(originals, name);
        fs.mkdirSync(originals, { recursive: true });
        try { fs.renameSync(file, dest); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(file, dest); fs.unlinkSync(file); }
        await store.put('originals/' + name, dest, /\.png$/.test(ext) ? 'image/png' : /\.tiff?$/.test(ext) ? 'image/tiff' : 'image/jpeg');
        db.prepare('UPDATE works SET bytes=? WHERE id=?').run((() => { try { return fs.statSync(dest).size; } catch (e) { return null; } })(), w.id);
        db.prepare(`UPDATE works SET original_file=?, sha256=?, width=?, height=?, dhash=?, master_at=datetime('now'),
          camera=COALESCE(?, camera), lens=COALESCE(?, lens), taken_at=COALESCE(?, taken_at) WHERE id=?`)
          .run(name, info.sha256, info.width, info.height, h, info.camera, info.lens, info.taken_at, w.id);
        for (const sz of Object.keys(images.SIZES)) for (const f of Object.keys(images.FORMATS)) for (const c of [path.join(cache, `${w.slug}-${sz}.${f}`), images.fileOf(cache, w.slug, sz, f)]) { if (fs.existsSync(c)) fs.unlinkSync(c); }
        const old = path.join(originals, w.original_file); if (w.original_file !== name && fs.existsSync(old)) fs.unlinkSync(old);
        const cred = await CR.inspect(dest); db.prepare('UPDATE works SET credentials=? WHERE id=?').run(cred ? JSON.stringify(cred) : null, w.id);
        // (21 Oct) the local copy stays as the cache: the display copies are rebuilt from it at once
        ledger.append(db, 'work.master', w.slug, { fingerprint: info.sha256, previous: w.sha256, width: info.width, height: info.height, camera: info.camera, taken: info.taken_at });
    return w;
  }
  // The maker's portal for one photograph: upload its full-resolution master. It must be the same picture (by
  // its visual fingerprint) and larger than what is held.
  // One master at a time (20 Oct): a sixty-megapixel file is decoded, fingerprinted, hashed and put in the vault; two
  // or three at once on a small server run it out of memory. Every arrival waits its turn in the lane.
  let lane = Promise.resolve(); const inLane = fn => { const run = lane.then(fn, fn); lane = run.catch(() => {}); return run; };
  app.post('/studio/works/:slug/master', studioOnly, upload.single('file'), BAG.gate('image'), (req, res) => inLane(async () => {
    const w = q.work.get(req.params.slug); const back = m => res.redirect('/studio/masters?ok=' + encodeURIComponent(m) + '#need');
    if (!w) return res.sendStatus(404); if (!req.file) return back('Choose an image file.');
    const gone = () => { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); };
    try {
      const info = await images.inspect(req.file.path), h = await images.dhash(req.file.path);
      if (w.dhash && images.hamming(h, w.dhash) > 12) { gone(); return back(`That file does not look like ${tidyT(w.title)}. Nothing was changed.`); }
      if ((w.width || 0) * (w.height || 0) >= info.width * info.height) { gone(); return back(`That file is no larger than the one held for ${tidyT(w.title)}.`); }
      await replaceMaster(w, req.file, info, h);
      back(`${tidyT(w.title)} is now held at ${Math.round(info.width * info.height / 1e6)} megapixels.`);
    } catch (e) { gone(); console.error('[master]', e.message); back('That file could not be read.'); }
  }));
  const tidyT = t => String(t || '').replace(/[.\s]+$/, '');
  // One file into the house: a master for a work already held (matched by look, larger), a known file, a smaller
  // one, or a new frame into a private archive room. Shared by the Masters desk (one request a file) and the
  // arrivals queue (files that came straight into the vault). The file is consumed either way.
  async function takeMaster(file, originalname, folder) {
    await BAG.throwIfBad(file, { name: originalname || path.basename(file), where: 'takeMaster', who: 'studio' });
    const gone = () => { if (fs.existsSync(file)) fs.unlinkSync(file); };
    try {
      await ensureHashes();
      const info = await images.inspect(file);
      const held = db.prepare('SELECT slug FROM works WHERE sha256=?').get(info.sha256);
      if (held) { gone(); return { ok: true, outcome: 'known', slug: held.slug }; }
      const h = await images.dhash(file);
      let best = null, bestD = 99;
      for (const w of db.prepare('SELECT id, slug, dhash, width, height FROM works WHERE dhash IS NOT NULL').all()) {
        const d = images.hamming(h, w.dhash);
        if (d < bestD && (w.width / w.height > 1) === (info.width / info.height > 1)) { best = w; bestD = d; }
      }
      if (best && bestD <= 6) {
        if ((best.width || 0) >= info.width) { gone(); return { ok: true, outcome: 'smaller', slug: best.slug }; }
        const w = await replaceMaster(q.work.get(best.slug), { path: file, originalname }, info, h);
        return { ok: true, outcome: 'master', slug: w.slug, title: w.title, distance: bestD, mp: Math.round(info.width * info.height / 1e6) };
      }
      // Not yet published anywhere: into the archive, private.
      const place = placeFromFolder(folder);
      const frame = (String(originalname || '').match(/(\d+)\.[a-z]+$/i) || [])[1];
      const nw = await registerWork({ file, originalName: originalname, title: `${place ? place.split(',')[0] : 'Archive'}${frame ? `, frame ${frame}` : ''}`, place });
      db.prepare("UPDATE works SET status='hidden', credit=COALESCE(credit, 'Krafft Studios') WHERE id=?").run(nw.id);
      const roomSlug = 'archive-' + slugify(place ? place.split(',')[0] : 'unsorted');
      let c = db.prepare('SELECT id FROM collections WHERE slug=?').get(roomSlug);
      if (!c) { db.prepare('INSERT INTO collections (slug,title,note,public,sort) VALUES (?,?,?,0,900)').run(roomSlug, `Archive · ${place ? place.split(',')[0] : 'Unsorted'}`, 'Full-resolution frames from the archive, held privately.'); c = db.prepare('SELECT id FROM collections WHERE slug=?').get(roomSlug); }
      db.prepare('INSERT OR IGNORE INTO collection_works (collection_id, work_id) VALUES (?,?)').run(c.id, nw.id);
      return { ok: true, outcome: 'archive', slug: nw.slug, title: nw.title };
    } catch (e) {
      gone(); console.error('[masters]', e.message);
      return { ok: false, status: e.user ? 409 : 400, error: e.user ? e.message : 'Could not be read as a photograph.' };
    }
  }
  app.locals.takeMaster = (file, name, folder) => inLane(() => takeMaster(file, name, folder));
  // A better file on top of one already held (Will, 21 Oct: "allow a higher resolution version to come in on top of
  // a small one and replace"): the maker's own vault matches a new file to the maker's own works by look (dhash,
  // same orientation, distance 6 or under); a larger file becomes the master of that record (the slug, deed, licences
  // and register entries stay), a smaller or equal one is declined with the record named; no match → null, and the
  // file is registered as new by the caller. The file is consumed only when it becomes a master.
  // Twins (21 Oct): full frames sent before the vault knew to put a better file on top were registered as new works
  // beside the small ones (eighteen, at 16:0x). `mergeTwins` finds, per maker, a newer hidden work with no licence,
  // no wall and no edition that matches an older work by look (dhash ≤ 6, same orientation) and is larger, makes its
  // file the older record's master, and retires the twin (status 'merged': in no listing, never deleted; `work.merged`
  // hidden on the register). Run once a minute after start, then on demand (app.locals.mergeTwins).
  async function mergeTwins() {
    await ensureHashes(); let merged = 0;
    const twins = db.prepare(`SELECT w.* FROM works w WHERE w.status='hidden' AND w.dhash IS NOT NULL AND w.original_file IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM licenses l WHERE l.work_id=w.id) AND NOT EXISTS (SELECT 1 FROM hang_works h WHERE h.work_id=w.id)
      AND NOT EXISTS (SELECT 1 FROM print_editions e WHERE e.work_id=w.id) ORDER BY w.id`).all();
    for (const t of twins) {
      let best = null, bestD = 99;
      for (const w of db.prepare('SELECT id, slug, title, dhash, width, height FROM works WHERE maker_id=? AND id<? AND dhash IS NOT NULL AND status IN (\'held\',\'hidden\')').all(t.maker_id, t.id)) {
        const d = images.hamming(t.dhash, w.dhash); if (d < bestD && (w.width / w.height > 1) === (t.width / t.height > 1)) { best = w; bestD = d; }
      }
      if (!best || bestD > 6 || (best.width || 0) * (best.height || 0) >= t.width * t.height) continue;
      try {
        const file = await originalPath(t); const tmp = path.join(originals, `twin-${t.id}${path.extname(t.original_file)}`); fs.copyFileSync(file, tmp);
        const info = await images.inspect(tmp);
        await inLane(() => replaceMaster(q.work.get(best.slug), { path: tmp, originalname: t.original_file }, info, t.dhash));
        db.prepare("UPDATE works SET status='merged', status_before='hidden' WHERE id=?").run(t.id);
        ledger.append(db, 'work.merged', t.slug, { into: best.slug, maker: (mk(t) || {}).handle, width: info.width, height: info.height });
        if (app.locals.findIndexDirty) app.locals.findIndexDirty(); merged++;
        console.log('[twins]', t.slug, '→ the master of', best.slug);
      } catch (e) { console.error('[twins]', t.slug, e.message); }
    }
    return merged;
  }
  app.locals.mergeTwins = mergeTwins;
  if (!cfg.noTimers) setTimeout(() => mergeTwins().catch(e => console.error('[twins]', e.message)), 60e3).unref();
  app.locals.upgradeIfHeld = (file, originalname, makerId) => inLane(async () => {
    const info = await images.inspect(file);
    if (db.prepare('SELECT 1 FROM works WHERE sha256=?').get(info.sha256)) return null; // the same bytes: registerWork answers (held, or come home)
    const h = await images.dhash(file); let best = null, bestD = 99;
    for (const w of db.prepare('SELECT id, slug, title, dhash, width, height FROM works WHERE maker_id=? AND dhash IS NOT NULL').all(makerId)) {
      const d = images.hamming(h, w.dhash);
      if (d < bestD && (w.width / w.height > 1) === (info.width / info.height > 1)) { best = w; bestD = d; }
    }
    if (!best || bestD > 6) return null;
    if ((best.width || 0) * (best.height || 0) >= info.width * info.height) { try { fs.unlinkSync(file); } catch (e) { /* gone */ } return { ok: false, status: 409, outcome: 'smaller', slug: best.slug, error: `This looks like ${tidyT(best.title)}, already held at ${Math.round((best.width || 0) * (best.height || 0) / 1e6)} megapixels; this file is no larger. Nothing was changed.` }; }
    const w = await replaceMaster(q.work.get(best.slug), { path: file, originalname }, info, h);
    return { ok: true, outcome: 'master', slug: w.slug, title: w.title, distance: bestD, mp: Math.round(info.width * info.height / 1e6), width: info.width, height: info.height, fingerprint: info.sha256.slice(0, 12) };
  });
  require('./arrivals').mountArrivals(app, { db, C, store, studioOnly, incoming: path.join(C.dataDir, 'incoming'), makerOf: req => (app.locals.accounts ? app.locals.accounts.makerOf(req) : null), takeWork: (f, a) => app.locals.takeWork(f, a) }); // straight into the vault in parts, taken in by a queue; the Studio's masters and every maker's own vault
  app.post('/studio/masters/one', studioOnly, upload.single('file'), BAG.gate('image', { json: true }), (req, res) => inLane(async () => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Not an image file.' });
    const r = await takeMaster(req.file.path, req.file.originalname, req.body.folder);
    res.status(r.ok ? 200 : r.status).json(r);
  }));
  // Read the Content Credentials of every original already held (once; new arrivals are read as they come).
  let crScan = null;
  app.post('/studio/credentials/scan', studioOnly, (req, res) => {
    if (!crScan) crScan = (async () => {
      for (const w of db.prepare('SELECT * FROM works WHERE credentials IS NULL ORDER BY id').all()) {
        try { const f = await originalPath(w); const c = await CR.inspect(f); db.prepare('UPDATE works SET credentials=? WHERE id=?').run(JSON.stringify(c || { none: true }), w.id); if (store.kind === 's3' && f.startsWith(originals)) fs.rmSync(f, { force: true }); }
        catch (e) { /* missing original: try again next time */ }
      }
    })().finally(() => { crScan = null; });
    res.redirect('/studio/masters?ok=' + encodeURIComponent('Reading Content Credentials from every original. It runs in the background.'));
  });
  app.get('/studio/masters', studioOnly, (req, res) => res.send(S.masters({
    upgraded: db.prepare('SELECT COUNT(*) n FROM works WHERE master_at IS NOT NULL').get().n,
    web: db.prepare('SELECT COUNT(*) n FROM works WHERE master_at IS NULL').get().n,
    need: db.prepare("SELECT slug, title, width, height, status FROM works WHERE status='held' ORDER BY id").all().filter(w => !meets(w, 'campaign'))
      .map(w => ({ ...w, mp: mpOf(w), waiting: Object.keys(MIN_MP).filter(k => !meets(w, k)) })), min: MIN_MP, ok: req.query.ok })));

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
      credit: require('./object').by(w, maker.name), kind: require('./object').kindOf(w), fingerprint: w.sha256, conditions: R.conditions(rules) || null, expires, license: `${C.base}/license/${w.slug}`, sealed: new Date().toISOString() };
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
  function workDesk(req, res, w) {
    const seen = db.prepare('SELECT * FROM sightings WHERE work_id=? ORDER BY id DESC').all(w.id);
    const lic = db.prepare("SELECT l.*, u.name AS use_name FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=? ORDER BY l.id DESC").all(w.id);
    const seals = db.prepare('SELECT * FROM seals WHERE work_id=? ORDER BY created_at DESC').all(w.id);
    const rooms = db.prepare('SELECT c.*, EXISTS(SELECT 1 FROM collection_works cw WHERE cw.collection_id=c.id AND cw.work_id=?) AS has FROM collections c ORDER BY sort, id').all(w.id);
    const views = db.prepare("SELECT host, kind, SUM(count) n, MIN(day) first, MAX(day) last FROM views WHERE work_id=? GROUP BY host, kind ORDER BY n DESC").all(w.id);
    const studio = !req.path.startsWith('/account');
    res.send(S.workTerms({ editionsBlock: app.locals.editionsBlock ? app.locals.editionsBlock(w, `${deskBase(req)}/${encodeURIComponent(w.slug)}`) : '', objectBlock: OB.block(w, `${deskBase(req)}/${encodeURIComponent(w.slug)}/object`), zoneBlock: zone.block(w, `${deskBase(req)}/${encodeURIComponent(w.slug)}/zone`), makerName: mk(w).name, rooms, views, w, rules: R.parse(w.rules), uses: q.uses.all(mk(w).id), NEVER: R.NEVER, seen, lic, seals, notice: req.query.ok, base: deskBase(req), studio }));
  }
  app.get('/studio/works/:slug', studioOnly, (req, res) => { const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404); workDesk(req, res, w); });
  app.get('/account/works/:slug', (req, res) => { const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404); if (!mayEdit(req, w)) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl)); workDesk(req, res, w); });
  function saveTerms(req, res, w) {
    const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
    const all = q.uses.all(mk(w).id).map(u => u.key);
    const open = arr(req.body.uses).filter(k => all.includes(k));
    const rules = { uses: open.length === all.length ? null : open, approve: req.body.approve === '1', never: arr(req.body.never).filter(k => R.NEVER[k]), credit: req.body.credit === '1', showEarned: req.body.showEarned === '1', ...(open.includes('social') ? {} : { social: false }) };
    db.prepare('UPDATE works SET rules=? WHERE id=?').run(JSON.stringify(rules), w.id);
    ledger.append(db, 'work.terms', w.slug, { open: rules.uses || 'all', approve: rules.approve, never: rules.never });
    res.redirect(`${deskBase(req)}/${w.slug}?ok=${encodeURIComponent('Your terms are saved. They apply to every new license.')}`);
  }
  app.post('/studio/works/:slug', studioOnly, (req, res) => { const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404); saveTerms(req, res, w); });
  app.post('/account/works/:slug', (req, res) => { const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404); if (!mayEdit(req, w)) return res.sendStatus(401); saveTerms(req, res, w); });
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

  app.get('/studio/licenses', studioOnly, (req, res) => res.send(S.licenses({ list: db.prepare('SELECT l.*, w.title, w.slug, u.name AS use_name FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id ORDER BY l.id DESC').all() })));
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
    const r = app.locals.requests.decline(req.params.ref, String((req.body || {}).word || '').trim().slice(0, 600) || null, 'studio');
    res.redirect(`/studio/licenses/${req.params.ref}?ok=${encodeURIComponent(r.ok ? r.note : r.why)}`);
  });

  app.get('/studio/uses', studioOnly, (req, res) => res.send(S.uses({ list: q.uses.all(maker.id), notice: req.query.ok })));
  app.get('/account/prices', (req, res) => { const m = app.locals.accounts.asMaker(req); if (!m) return res.redirect('/signin?next=/account/prices'); res.send(S.uses({ list: q.uses.all(m.id), notice: req.query.ok, base: '/account/prices', studio: false, simply: app.locals.saidSimply ? app.locals.saidSimply(m, q.uses.all(m.id)) : '' })); });
  app.post('/account/prices/:key', (req, res) => { const m = app.locals.accounts.makerOf(req); if (!m) return res.sendStatus(401); savePrice(req, res, m, '/account/prices'); });
  app.post('/studio/uses/:key', studioOnly, (req, res) => savePrice(req, res, maker, '/studio/uses'));
  function savePrice(req, res, maker, back) {
    const v = String(req.body.price || '').trim();
    // Whole dollars only. Share it has a floor: below $3 the card fee eats the maker's share.
    let cents = v === '' ? null : Math.round(Number(v)) * 100;
    if (cents !== null && !(cents >= 0)) return res.redirect(back);
    if (req.params.key === 'social' && cents !== null && cents < 300) cents = 300;
    db.prepare('UPDATE uses SET price_cents=? WHERE maker_id=? AND key=?').run(cents, maker.id, req.params.key);
    res.redirect(back + '?ok=Saved');
  }

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
  // The renditions are made ahead of the first visitor: every held work, every size, JPEG and WebP, one at a time.
  let warming = false;
  async function warmAll() {
    if (warming) return 0; warming = true; let n = 0;
    try { for (const w of db.prepare("SELECT * FROM works WHERE status='held' ORDER BY curated DESC, stars DESC, id DESC").all()) { if (images.warmed(cache, w.slug)) continue; try { await images.warm(await originalPath(w), cache, w.slug); n++; } catch (e) { /* missing original: the route will say so */ } await new Promise(r => setTimeout(r, 150)); } }
    finally { warming = false; }
    return n;
  }
  app.locals.warmAll = warmAll;
  if (!cfg.noTimers) { setTimeout(() => warmAll().then(n => { if (n) console.log('[warm]', n, 'works'); }).catch(e => console.error('[warm]', e.message)), 15e3).unref(); setInterval(() => warmAll().catch(() => {}), 3600e3).unref(); }
  if (!cfg.noTimers) { const wall = () => app.locals.wallLetters && app.locals.wallLetters().then(n => { if (n) console.log('[wall]', n, 'letters'); }).catch(e => console.error('[wall]', e.message)); setTimeout(wall, 90e3).unref(); setInterval(wall, 24 * 3600e3).unref(); }
  if (!cfg.noTimers) { const su = () => app.locals.standingOrders && app.locals.standingOrders.catchUp().then(n => { if (n) console.log('[standing]', n, 'caught up'); }).catch(e => console.error('[standing]', e.message)); setTimeout(su, 150e3).unref(); setInterval(su, 24 * 3600e3).unref(); }
  if (!cfg.noTimers) { const letters = () => app.locals.looking && app.locals.looking.letters().then(n => { if (n) console.log('[letters]', n); }).catch(e => console.error('[letters]', e.message)); setTimeout(letters, 60e3).unref(); setInterval(letters, 24 * 3600e3).unref(); }
  // Back the database up to the vault every six hours, and once shortly after start.
  const BK = require('./backup').mountBackup(app, { db, C, store, ledger, mail, isStudio, V }); // nightly to the vault, a weekly restore drill, Studio → Backups
  if (!cfg.noTimers) BK.schedule();
  app.post('/studio/backup', studioOnly, async (req, res) => { try { const k = await backupDb(); res.redirect(`/studio/activity?ok=${encodeURIComponent('Backed up to the vault: ' + k)}`); } catch (e) { res.redirect(`/studio/activity?ok=${encodeURIComponent('Backup failed: ' + e.message)}`); } });
  // Studios → Watermark: every photograph published on Krafft Studios is held here (see studios-sync.js).
  const sync = require('./studios-sync').createSync({ db, registerWork, slugify, fetchImpl: cfg.fetchImpl || fetch, stageDir: path.join(C.dataDir, 'incoming') });
  if (!cfg.noTimers && process.env.STUDIOS_SYNC !== 'off') { setTimeout(() => sync.run().catch(e => console.error('[studios-sync]', e.message)), 20e3).unref(); setInterval(() => sync.run().catch(e => console.error('[studios-sync]', e.message)), 6 * 3600e3).unref(); }
  app.post('/studio/sync', studioOnly, (req, res) => { sync.run().catch(e => console.error('[studios-sync]', e.message)); res.redirect('/studio?ok=' + encodeURIComponent('Pulling new photographs from Krafft Studios. They appear as they arrive.')); });
  app.post('/studio/renewals', studioOnly, (req, res) => res.redirect(`/studio/activity?ok=${encodeURIComponent(sweep() + ' renewal notices sent.')}`));

  // Readiness, names only: which services are switched on. No values ever.
  // The desk's status line: the vault, the chain, the mail, the day. Cached a minute.
  let deskAt = 0, deskLine = '';
  V.setDeskStatus(() => {
    if (Date.now() - deskAt > 60000) {
      const chk = ledger.verify(db), held = db.prepare("SELECT COUNT(*) n FROM works WHERE status='held'").get().n, priv = db.prepare("SELECT COUNT(*) n FROM works WHERE status<>'held'").get().n;
      const day = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
      deskLine = `<span>${day}</span><span>Vault: <b>${held}</b> held, <b>${priv}</b> private</span><span>Register: <b>${chk.ok ? `intact, ${chk.checked} entries` : `broken at ${chk.broken_at}`}</b></span><span>Mail: <b>${mail.on() ? 'on' : 'off'}</b></span><span>Guides: <b>${process.env.ANTHROPIC_API_KEY ? 'on' : 'off'}</b></span><span>Payments: <b>${stripe ? (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live') ? 'live' : 'test' : 'off'}</b></span><span>Signing: <b>${process.env.C2PA_CERT && process.env.C2PA_KEY ? 'on' : 'off'}</b></span>`;
      deskAt = Date.now();
    }
    return deskLine;
  });
  // /healthz (22 Oct): the public answer says only whether the house is up and the register sound, with counts; the
  // full report (paths, the vault's last error, lost slugs, mail and Stripe state, backups) is for the Studio or a
  // caller with HEALTH_KEY (`x-health-key` or ?key=), so the house's insides are not read from the street.
  app.get('/healthz', (req, res) => {
    const key = process.env.HEALTH_KEY || process.env.DESK_KEY || '';
    const given = String(req.get('x-health-key') || req.query.key || '');
    const full = (key && given && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key))) || isStudio(req);
    const unvaulted = db.prepare('SELECT COUNT(*) n FROM works WHERE vaulted=0').get().n, works = db.prepare("SELECT COUNT(*) n FROM works WHERE status IN ('held','hidden','restoring')").get().n;
    const brief = { ok: true, ledger: ledger.verify(db).ok, works, vault: { unvaulted, lost: vaultState.lost.length }, mail: mail.on(), stripe: stripe ? (/^[sr]k_live_/.test(C.stripeKey || '') ? 'live' : 'test') : false };
    res.set('Cache-Control', 'no-store');
    if (!full) return res.json(brief);
    res.json({ ...brief, vault: { kind: store.kind, cors: app.locals.vaultCors, unvaulted, vaulting, ...vaultState, originalsOnDisk: (() => { try { return fs.readdirSync(originals).length; } catch (e) { return null; } })(), dataDir: C.dataDir }, mailState: mail.state || null, connect: app.locals.connectState ? app.locals.connectState() : null, closer: !!process.env.ANTHROPIC_API_KEY, speech: app.locals.speech && app.locals.speech.on() ? app.locals.speech.provider() : false, signing: !!(process.env.C2PA_CERT && process.env.C2PA_KEY), fixity: app.locals.archive ? app.locals.archive.summary() : null, backup: app.locals.backup ? app.locals.backup.summary() : null, conservation: app.locals.conservation ? app.locals.conservation.summary() : null });
  });
  // security.txt (RFC 9116): where a researcher writes, and the house's claims page.
  app.get('/.well-known/security.txt', (req, res) => { const exp = new Date(Date.now() + 365 * 864e5).toISOString(); res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send(`Contact: mailto:${process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com'}\nExpires: ${exp}\nPreferred-Languages: en\nCanonical: ${C.base}/.well-known/security.txt\nPolicy: ${C.base}/legal/claims\n`); });

  Object.assign(app.locals, { backupDb, store, fillBuyer, db, registerWork, grant, maker, C, sweep, sync });
  // Nothing at this address: said in the house's voice, with a way back in and a photograph to look at.
  app.use((req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/img/') || req.path.startsWith('/static/')) return res.sendStatus(404);
    const w = db.prepare("SELECT slug, title, place, width, height FROM works WHERE status='held' AND width > height * 1.2 ORDER BY curated DESC, RANDOM() LIMIT 1").get();
    res.status(404).send(V.sign({ code: 404, cover: w ? { ...w, maker: (mk(w) || {}).name } : coverFor() }));
  });
  // The last sign: anything that gives way is told to the house and shown as a closed gallery, not a trace.
  app.use((err, req, res, next) => {
    const code = err && (err.status || err.statusCode) >= 400 ? (err.status || err.statusCode) : 500;
    if (code >= 500) console.error('[house]', req.method, req.path, err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err);
    if (res.headersSent) return next(err);
    if (wantsSign(req) || (req.accepts('html') && !req.xhr && !/^\/(api|img|cab)/.test(req.path))) return res.status(code).send(V.sign({ code, cover: coverFor(), detail: code === 413 ? 'The file is larger than the vault takes in one piece.' : null }));
    res.status(code).json({ ok: false, code });
  });
  return app;
}

module.exports = { createApp, slugify };
