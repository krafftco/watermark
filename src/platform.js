// The platform door (Will, 28 Oct: "the vault behind a platform's creator payments, their images, their infrastructure";
// "the watermark brand so strong it is simply incorporated: 'oh, that's the watermark on X', and then 'watermark.com,
// obviously'"). A platform is a partner (src/bridge.js: a key, a webhook, a secret) and through this door it can
//   open a studio for one of its creators (the record: free, deeded, nothing shown until the maker publishes),
//   put a work in on the creator's behalf by address (the same registerWork as every other door: the bag check, the
//     fingerprint, the deed, the register entry; held back until the maker publishes, since the house is curated),
//   resolve any picture to its record (by fingerprint, or by a copy that left the house),
//   and sell from its own surface: a Collect link that carries ?via=p:<slug>, so the sale is the platform's and the
//     platform's share (PLATFORM_PCT, from the house's side, never the maker's, like a curator's) is recorded.
// Every record carries the badge: the wave and the word, in the platform's dark or light, linking to the record. The
// badge is the brand. No partner is named in code or public copy; the terms are the same for every platform.
const path = require('path');
const fs = require('fs');
const I = require('./icons');

const PLATFORM_PCT = Number(process.env.PLATFORM_PCT || 5); // of the price, from the house's side; a draft for counsel

function mountPlatform(app, { db, C, V, ledger, registerWork, mail, fetchImpl = (...a) => fetch(...a) }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS partner_cuts (id INTEGER PRIMARY KEY, partner_id INTEGER NOT NULL, ref TEXT NOT NULL, work_id INTEGER, cents INTEGER NOT NULL, paid_at TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS partner_makers (partner_id INTEGER NOT NULL, maker_id INTEGER NOT NULL, external_id TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (partner_id, maker_id));
  `);
  const B = () => app.locals.bridge;
  const P = (req, res, next) => B().P(req, res, next);
  const json = require('express').json({ limit: '300kb' });
  const stage = path.join(C.dataDir, 'incoming'); fs.mkdirSync(stage, { recursive: true });
  const mk = id => db.prepare('SELECT * FROM makers WHERE id=?').get(id);
  const makerBy = s => db.prepare('SELECT * FROM makers').all().find(x => V.makerSlug(x) === s || x.handle === s) || null;
  const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'maker';
  const first = n => String(n || '').split(/\s+/)[0];

  // --- The badge: the wave and the word, for any surface. /w/:slug/badge.svg?theme=dark|light&size=sm|md
  function badge(w, { theme = 'dark', size = 'md' } = {}) {
    const dark = theme !== 'light'; const fg = dark ? '#f3efe6' : '#0b0a09', bg = dark ? '#0b0a09' : '#f3efe6';
    const h = size === 'sm' ? 20 : 28, wv = size === 'sm' ? 30 : 42, fs_ = size === 'sm' ? 10 : 13, pad = size === 'sm' ? 6 : 9;
    const label = 'Watermark', textW = Math.round(label.length * fs_ * 0.58), wdt = pad + wv + pad + textW + pad;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${wdt}" height="${h}" viewBox="0 0 ${wdt} ${h}" role="img" aria-label="${label}: a registered work, ${V.esc ? V.esc(w.accession || w.slug) : (w.accession || w.slug)}">` +
      `<rect width="${wdt}" height="${h}" rx="${Math.round(h / 2)}" fill="${bg}" stroke="${fg}" stroke-opacity=".25"/>` +
      `<svg x="${pad}" y="${Math.round((h - wv * 11 / 41) / 2)}" width="${wv}" height="${Math.round(wv * 11 / 41)}" viewBox="1.5 14.2 41 11"><path d="${I.WAVE_D}" fill="${fg}"/></svg>` +
      `<text x="${pad + wv + pad}" y="${Math.round(h / 2 + fs_ * 0.36)}" font-family="Georgia, 'Times New Roman', serif" font-size="${fs_}" letter-spacing=".04em" fill="${fg}">${label}</text></svg>`;
  }
  app.get(['/w/:slug/badge.svg', '/m/:maker/:slug/badge.svg'], (req, res) => {
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(req.params.slug); if (!w) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=86400').set('Access-Control-Allow-Origin', '*').type('image/svg+xml').send(badge(w, { theme: req.query.theme === 'light' ? 'light' : 'dark', size: req.query.size === 'sm' ? 'sm' : 'md' }));
  });
  const badgeOf = (w, p) => { const rec = `${C.base}/w/${w.slug}${p ? `?via=p:${p.slug}` : ''}`; const svg = `${C.base}/w/${w.slug}/badge.svg`; return { svg, light: svg + '?theme=light', record: rec, html: `<a href="${rec}" rel="noopener"><img src="${svg}" alt="Watermark: a registered work" height="28"></a>` }; };

  // --- The record a platform sees: the public record plus the doors that are the platform's own.
  function record(w, p) {
    const j = app.locals.workJSON(w); const m = mk(w.maker_id);
    return { ...j, status: w.status, badge: badgeOf(w, p), collect: `${C.base}/w/${w.slug}?via=p:${p.slug}`, license: `${C.base}/license/${w.slug}?via=p:${p.slug}`, deed: `${C.base}/w/${w.slug}/deed`, maker: { ...(j.maker || {}), slug: V.makerSlug(m), did: B().makerDid(m) } };
  }

  // --- Open a studio for a creator. The record is free and the house stays curated: nothing is shown until the maker
  // publishes and the house has invited them (mayHang). The creator is written to; the platform gets the slug.
  app.post('/api/partner/v1/makers', P, json, (req, res) => {
    const b = req.body || {}; const name = String(b.name || '').replace(/<[^>]*>/g, '').trim().slice(0, 80), email = String(b.email || '').trim().toLowerCase().slice(0, 160), ext = String(b.external_id || '').slice(0, 120) || null;
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Send { name, email, external_id? }.' });
    let m = db.prepare('SELECT * FROM makers WHERE email=?').get(email); let opened = false;
    if (!m) {
      let handle = slugify(name), i = 2; while (db.prepare('SELECT 1 FROM makers WHERE handle=?').get(handle)) handle = `${slugify(name)}-${i++}`;
      const id = db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES (?,?,?,'maker',datetime('now'),'record')").run(handle, name, email).lastInsertRowid;
      m = mk(id); opened = true;
      ledger.append(db, 'maker.recorded', m.handle, { by: 'platform', partner: req.partner.slug });
      try { mail.send({ to: email, subject: 'Your studio on Watermark is open', text: `${first(name)},\n\n${req.partner.name} opened a studio for you on Watermark. Each work you make is fingerprinted, written to the register with the day you made it, and given a deed that says it is yours; when a piece is collected, you are paid every Friday.\n\nSign in with this address to see it: ${C.base}/signin\n\nWatermark, a Krafft company` }); } catch (e) { /* mail off */ }
    }
    db.prepare('INSERT OR IGNORE INTO maker_partners (maker_id, partner_id) VALUES (?,?)').run(m.id, req.partner.id);
    db.prepare('INSERT INTO partner_makers (partner_id, maker_id, external_id) VALUES (?,?,?) ON CONFLICT (partner_id, maker_id) DO UPDATE SET external_id=excluded.external_id').run(req.partner.id, m.id, ext);
    if (opened) B().post(req.partner, 'maker.opened', m.handle, { maker: { slug: V.makerSlug(m), did: B().makerDid(m), external_id: ext } }).catch(() => {});
    res.status(opened ? 201 : 200).json({ maker: { slug: V.makerSlug(m), name: m.name, did: B().makerDid(m), external_id: ext, page: `${C.base}/m/${V.makerSlug(m)}`, studio: `${C.base}/account`, hangs: !!(app.locals.mayHang && app.locals.mayHang(m)) }, opened });
  });

  // --- Put a work in on the creator's behalf: by address (https), fetched by the house and taken through the same door.
  const fetching = new Set();
  app.post('/api/partner/v1/makers/:slug/works', P, json, async (req, res) => {
    const m = makerBy(req.params.slug); if (!m || !B().consenting(req.partner, m.id)) return res.status(404).json({ error: 'No maker by that name has connected you.' });
    const b = req.body || {}; const url = String(b.url || b.image || '').trim();
    if (!/^https:\/\/\S+$/.test(url)) return res.status(400).json({ error: 'Send { url: "https://…", title?, place?, caption?, external_id?, made? }.' });
    if (b.external_id) { const had = db.prepare('SELECT w.* FROM works w WHERE w.maker_id=? AND w.source_url=?').get(m.id, `${req.partner.slug}:${b.external_id}`); if (had) return res.json({ work: record(had, req.partner), known: true }); }
    if (fetching.size > 4) return res.status(429).json({ error: 'The door is busy; try again in a moment.' });
    const tmp = path.join(stage, `platform-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`); fetching.add(tmp);
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(30000), headers: { accept: 'image/*' } }); if (!r.ok) return res.status(422).json({ error: `The picture could not be fetched (${r.status}).` });
      const len = Number(r.headers.get('content-length') || 0); if (len > 250 * 1024 * 1024) return res.status(413).json({ error: 'Over 250 MB.' });
      fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
      const w = await registerWork({ file: tmp, title: String(b.title || 'Untitled').slice(0, 160), place: String(b.place || '').slice(0, 120) || null, caption: String(b.caption || '').slice(0, 1200) || null, source_url: b.external_id ? `${req.partner.slug}:${String(b.external_id).slice(0, 120)}` : null, originalName: path.basename(new URL(url).pathname) || 'platform.jpg', makerId: m.id, kind: b.kind || undefined });
      if (b.made && /^\d{4}(-\d\d){0,2}$/.test(String(b.made))) { try { db.prepare('UPDATE works SET taken_at=COALESCE(taken_at, ?) WHERE id=?').run(String(b.made), w.id); } catch (e) { /* column may differ */ } }
      if (!w.cameHome) db.prepare("UPDATE works SET status='hidden' WHERE id=? AND status='held'").run(w.id); // held back: the house is curated; the maker publishes, once invited
      const fresh = db.prepare('SELECT * FROM works WHERE id=?').get(w.id);
      B().post(req.partner, 'work.registered', fresh.slug, { work: { slug: fresh.slug, accession: fresh.accession, sha256: fresh.sha256, external_id: b.external_id || null, record: `${C.base}/w/${fresh.slug}`, badge: badgeOf(fresh, req.partner) } }).catch(() => {});
      res.status(201).json({ work: record(fresh, req.partner), known: !!w.cameHome });
    } catch (e) {
      const why = String(e.message || e); res.status(/turned away|bag check|refused|not a picture/i.test(why) ? 415 : 500).json({ error: why.slice(0, 300) });
    } finally { fetching.delete(tmp); try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) { /* taken */ } }
  });
  app.get('/api/partner/v1/makers/:slug/works/:work', P, (req, res) => {
    const m = makerBy(req.params.slug); if (!m || !B().consenting(req.partner, m.id)) return res.status(404).json({ error: 'No maker by that name has connected you.' });
    const w = db.prepare("SELECT * FROM works WHERE maker_id=? AND (slug=? OR accession=? OR source_url=?) AND status IN ('held','hidden','private')").get(m.id, req.params.work, req.params.work, `${req.partner.slug}:${req.params.work}`);
    w ? res.json({ work: record(w, req.partner) }) : res.status(404).json({ error: 'No work by that reference.' });
  });

  // --- Resolve a picture to its record: by fingerprint, or by a copy that left the house (downloads.sha256), or by a
  // Krafft image address. Public works only; nothing of a buyer. The platform's own doors on the answer.
  app.get('/api/partner/v1/resolve', P, (req, res) => {
    const s = String(req.query.sha256 || req.query.src || '').trim().toLowerCase();
    let w = null, how = null;
    if (/^[a-f0-9]{64}$/.test(s)) {
      w = db.prepare("SELECT * FROM works WHERE sha256=? AND status='held'").get(s); how = w ? 'original' : null;
      if (!w) { const d = db.prepare("SELECT d.*, w.slug FROM downloads d JOIN works w ON w.id=d.work_id WHERE d.sha256=? AND w.status='held' ORDER BY d.id DESC LIMIT 1").get(s); if (d) { w = db.prepare('SELECT * FROM works WHERE id=?').get(d.work_id); how = 'a copy that left the house'; } }
    }
    res.json({ work: w ? record(w, req.partner) : null, how });
  });

  // --- The platform's own door on a work: ?via=p:<slug> on a work page or /license sets the thirty-day cookie, and the
  // sale is the platform's. Mounted ahead of the /w routes by app.js.
  app.locals.rememberPlatform = (req, res, next) => {
    const v = req.query && String(req.query.via || ''); const m = v.match(/^p:([a-z0-9-]{1,40})$/);
    if (m && db.prepare('SELECT 1 FROM partners WHERE slug=? AND active=1').get(m[1])) res.cookie('wm_via', `partner:${m[1]}`, { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 30 * 86400e3 });
    next();
  };
  // The platform's share on a paid licence that came through its door, from the house's side (like a curator's).
  function reward(l, w) {
    if (!l || !l.via || !(l.price_cents > 0)) return null;
    const m = String(l.via).match(/^partner:([a-z0-9-]+)$/); if (!m) return null;
    const p = db.prepare('SELECT * FROM partners WHERE slug=? AND active=1').get(m[1]); if (!p) return null;
    if (db.prepare('SELECT 1 FROM partner_cuts WHERE ref=?').get(l.ref)) return null;
    const cents = Math.round(l.price_cents * PLATFORM_PCT / 100); if (cents < 1) return null;
    db.prepare('INSERT INTO partner_cuts (partner_id, ref, work_id, cents) VALUES (?,?,?,?)').run(p.id, l.ref, w ? w.id : l.work_id, cents);
    ledger.append(db, 'platform.earned', l.ref, { partner: p.slug, work: w ? w.slug : null, amount: cents }); // hidden
    return { partner: p, cents };
  }
  const earned = partnerId => db.prepare('SELECT COALESCE(SUM(cents),0) t, COALESCE(SUM(CASE WHEN paid_at IS NULL THEN cents ELSE 0 END),0) owed, COUNT(*) n FROM partner_cuts WHERE partner_id=?').get(partnerId);

  // --- The terms, published: the same for every platform (counsel reads them before the first is signed).
  app.get('/api/partner/v1/terms', (req, res) => res.json({
    share: { platform_pct: PLATFORM_PCT, side: 'the house', note: 'The platform\'s share is paid from the house\'s share, never the maker\'s. The price is the maker\'s; the house\'s share on top is published at /share.' },
    exclusivity: 'none', data: 'The house never sends a buyer\'s name. A licence is posted as a signed credential.', register: `${C.base}/ledger.json`, leave: 'A maker may disconnect a platform at any time and takes every work, deed and register entry with them.',
    doors: { open_studio: 'POST /api/partner/v1/makers', put_work: 'POST /api/partner/v1/makers/:slug/works { url, title, place, caption, external_id, made }', work: 'GET /api/partner/v1/makers/:slug/works/:slug|accession|external_id', resolve: 'GET /api/partner/v1/resolve?sha256=', collect: '/w/:slug?via=p:<partner>', badge: '/w/:slug/badge.svg?theme=dark|light&size=sm|md', webhooks: ['maker.opened', 'work.registered', 'license.granted'] } }));

  app.locals.platform = { badge, badgeOf, record, reward, earned, PLATFORM_PCT };
}

module.exports = { mountPlatform, PLATFORM_PCT };
