// The bridge (Will, 18 Oct: the connection point between Watermark and Switchchord, Cole Davis's rights platform,
// built so the two houses work as one, and so that one day they could be one). Built only on open standards, so
// it joins any partner who speaks them, and no partner is named in code or in public until Will adds them:
//   - did:web identities: the house at /.well-known/did.json; each maker at /m/<slug>/did.json, listing the
//     identities the maker has linked (their own DID, ISNI, IPI, site), never anything private.
//   - Verifiable Credentials (W3C VC 2.0, Data Integrity proof eddsa-jcs-2022, signed with the register's key):
//     a license (/c/:ref/credential) and authorship of record (/w/:slug/credential), which anyone can check.
//   - Partners, issued by the Studio with a key: read a consenting maker's catalogue with splits and claims;
//     post rights claims about a work as signed credentials; receive signed notice of each sale of that maker's
//     work by webhook. A maker connects or disconnects each partner from their studio; nothing flows without it.
// Design record: docs/PARTNERS.md.
const crypto = require('crypto');

// --- Encodings: base58btc, multibase Ed25519 keys, JSON canonicalization (RFC 8785, for the values we sign).
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(buf) {
  let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0')), out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}
function unb58(str) {
  let n = 0n; for (const c of str) { const i = B58.indexOf(c); if (i < 0) throw new Error('base58'); n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex; if (n === 0n) hex = '';
  const lead = (str.match(/^1*/) || [''])[0].length;
  return Buffer.concat([Buffer.alloc(lead), Buffer.from(hex, 'hex')]);
}
const multikey = pubHex => 'z' + b58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(pubHex, 'hex')]));
const fromMultikey = mk => { const b = unb58(String(mk).replace(/^z/, '')); if (b[0] !== 0xed || b[1] !== 0x01) throw new Error('not an Ed25519 key'); return b.subarray(2).toString('hex'); };
function jcs(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
}
const sha = s => crypto.createHash('sha256').update(s).digest();
const spki = pubHex => crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pubHex, 'hex')]), format: 'der', type: 'spki' });

// Data Integrity, eddsa-jcs-2022: hash(JCS(proof config)) ‖ hash(JCS(document)), signed with Ed25519.
function prove(doc, { vm, signBytes, created = new Date().toISOString() }) {
  const config = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created, verificationMethod: vm, proofPurpose: 'assertionMethod', '@context': doc['@context'] };
  const sig = signBytes(Buffer.concat([sha(jcs(config)), sha(jcs(doc))]));
  if (!sig) return null;
  const proof = { ...config }; delete proof['@context']; proof.proofValue = 'z' + b58(sig);
  return { ...doc, proof };
}
function checkProof(vc, pubHex) {
  try {
    const { proof, ...doc } = vc; if (!proof || proof.cryptosuite !== 'eddsa-jcs-2022') return false;
    const { proofValue, ...cfg } = proof; const config = { ...cfg, '@context': doc['@context'] };
    return crypto.verify(null, Buffer.concat([sha(jcs(config)), sha(jcs(doc))]), spki(pubHex), unb58(String(proofValue).replace(/^z/, '')));
  } catch (e) { return false; }
}
// did:web → the document's address (did:web:host[:path…] → https://host/.well-known/did.json or /path/did.json).
function didUrl(did) {
  const m = /^did:web:([^:#]+)((?::[^:#]+)*)/.exec(String(did || '')); if (!m) return null;
  const host = decodeURIComponent(m[1]), path = m[2] ? m[2].split(':').filter(Boolean).map(decodeURIComponent).join('/') : '';
  return path ? `https://${host}/${path}/did.json` : `https://${host}/.well-known/did.json`;
}

function mountBridge(app, { db, C, V, ledger, isStudio, studioOnly, makerOf, mk, fetchImpl = (...a) => fetch(...a) }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS partners (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, site TEXT, did TEXT, key_hash TEXT NOT NULL,
      webhook TEXT, secret TEXT NOT NULL, note TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS maker_partners (maker_id INTEGER NOT NULL, partner_id INTEGER NOT NULL, since TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (maker_id, partner_id));
    CREATE TABLE IF NOT EXISTS claims_in (id INTEGER PRIMARY KEY, partner_id INTEGER NOT NULL, work_id INTEGER, maker_id INTEGER, kind TEXT NOT NULL, summary TEXT,
      party TEXT, uses TEXT, starts_at TEXT, ends_at TEXT, vc TEXT NOT NULL, signed INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT);
    CREATE TABLE IF NOT EXISTS partner_sends (id INTEGER PRIMARY KEY, partner_id INTEGER NOT NULL, event TEXT NOT NULL, ref TEXT, status INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  for (const [c, t] of [['did', 'TEXT'], ['ids', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('makers') WHERE name=?").get(c)) db.exec(`ALTER TABLE makers ADD COLUMN ${c} ${t}`);

  const host = () => { try { return new URL(C.base).host; } catch (e) { return 'watermark.krafftco.com'; } };
  const HOUSE = () => `did:web:${encodeURIComponent(host())}`;
  const VM = () => `${HOUSE()}#register`;
  const makerDid = m => `${HOUSE()}:m:${V.makerSlug(m)}`;
  const ids = m => { try { return JSON.parse(m.ids || '{}') || {}; } catch (e) { return {}; } };
  const CTX = ['https://www.w3.org/ns/credentials/v2', { wm: 'https://watermark.krafftco.com/ns#', WatermarkLicense: 'wm:WatermarkLicense', WatermarkAuthorship: 'wm:WatermarkAuthorship' }];

  // --- Identity documents.
  app.get('/.well-known/did.json', (req, res) => {
    const pub = ledger.publicKey(); if (!pub) return res.status(503).json({ error: 'The house key is not set.' });
    res.set('Cache-Control', 'public, max-age=300').json({ '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'], id: HOUSE(),
      alsoKnownAs: [C.base], verificationMethod: [{ id: VM(), type: 'Multikey', controller: HOUSE(), publicKeyMultibase: multikey(pub) }],
      assertionMethod: [VM()], authentication: [VM()], service: [{ id: `${HOUSE()}#register`, type: 'LinkedDomains', serviceEndpoint: C.base }, { id: `${HOUSE()}#api`, type: 'WatermarkAPI', serviceEndpoint: `${C.base}/api/v1` }] });
  });
  app.get('/m/:slug/did.json', (req, res) => {
    const m = db.prepare('SELECT * FROM makers').all().find(x => V.makerSlug(x) === req.params.slug || x.handle === req.params.slug); if (!m) return res.sendStatus(404);
    const i = ids(m), aka = [`${C.base}/m/${V.makerSlug(m)}`, m.did, i.isni && `https://isni.org/isni/${i.isni.replace(/\s/g, '')}`, i.site, i.ipi && `urn:ipi:${i.ipi}`].filter(Boolean);
    res.set('Cache-Control', 'public, max-age=300').json({ '@context': ['https://www.w3.org/ns/did/v1'], id: makerDid(m), controller: HOUSE(), alsoKnownAs: aka,
      service: [{ id: `${makerDid(m)}#works`, type: 'WatermarkCatalogue', serviceEndpoint: `${C.base}/api/v1/works?maker=${V.makerSlug(m)}` }] });
  });

  // --- Credentials.
  function licenseVC(l) {
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id), m = mk(w), u = db.prepare('SELECT * FROM uses WHERE id=?').get(l.use_id);
    let t = null; try { t = l.rights ? JSON.parse(l.rights) : null; } catch (e) { t = null; }
    const T = require('./track');
    const doc = { '@context': CTX, id: `${C.base}/c/${l.ref}`, type: ['VerifiableCredential', 'WatermarkLicense'], issuer: { id: HOUSE(), name: 'Watermark' },
      validFrom: l.starts_at || l.created_at, ...(l.ends_at ? { validUntil: l.ends_at } : {}), name: `License ${l.ref}`,
      credentialSubject: { id: `urn:watermark:license:${l.ref}`, number: T.track(l.ref) || l.ref, holder: l.licensee_company ? { company: l.licensee_company } : { person: true },
        use: { key: u.key, name: u.key === 'social' ? 'Collect' : u.name, kind: u.kind }, rights: t ? t.rights : [], extras: t ? t.extras : [], never: t ? t.never : [],
        transferable: t ? !!t.transferable : null, collectorNo: l.collector_no || null, agreementFingerprint: t && t.hash || null,
        work: { id: w.accession, title: V.tidy(w.title), page: `${C.base}/m/${V.makerSlug(m)}/${w.slug}`, sha256: w.sha256, maker: { id: makerDid(m), name: m.name } } } };
    return prove(doc, { vm: VM(), signBytes: ledger.signBytes, created: l.starts_at || undefined });
  }
  function authorshipVC(w) {
    const m = mk(w); const e = db.prepare("SELECT seq, hash, at FROM ledger WHERE type='work.registered' AND subject=? ORDER BY seq LIMIT 1").get(w.slug) || {};
    const doc = { '@context': CTX, id: `${C.base}/w/${w.slug}/credential`, type: ['VerifiableCredential', 'WatermarkAuthorship'], issuer: { id: HOUSE(), name: 'Watermark' },
      validFrom: e.at || w.created_at, name: `Authorship of record: ${V.tidy(w.title)}`,
      credentialSubject: { id: `urn:watermark:work:${w.accession}`, title: V.tidy(w.title), maker: { id: makerDid(m), name: m.name, ...(m.did ? { sameAs: m.did } : {}) },
        sha256: w.sha256, made: w.taken_at || null, place: w.place || null, copyrightRegistration: w.copyright_reg || null, register: e.seq ? { entry: e.seq, hash: e.hash } : null } };
    return prove(doc, { vm: VM(), signBytes: ledger.signBytes, created: e.at || undefined });
  }
  const send = (res, vc) => vc ? res.set('Cache-Control', 'no-store').type('application/vc+ld+json').send(JSON.stringify(vc, null, 2)) : res.status(503).json({ error: 'The house key is not set.' });
  app.get('/c/:ref/credential', (req, res) => { const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(String(req.params.ref).toUpperCase()); if (!l || !['active', 'expired'].includes(l.status)) return res.sendStatus(404); send(res, licenseVC(l)); });
  app.get('/w/:slug/credential', (req, res) => { const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(req.params.slug)); if (!w) return res.sendStatus(404); send(res, authorshipVC(w)); });
  // Check a credential: the house's own, or any did:web issuer's (fetched, with a short timeout).
  async function keyFor(vm) {
    const did = String(vm || '').split('#')[0];
    if (did === HOUSE()) return ledger.publicKey();
    const url = didUrl(did); if (!url) return null;
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/did+json, application/json' } }); if (!r.ok) return null;
    const d = await r.json(); const k = (d.verificationMethod || []).find(x => x.id === vm || x.id === '#' + String(vm).split('#')[1]);
    return k && k.publicKeyMultibase ? fromMultikey(k.publicKeyMultibase) : null;
  }
  async function verifyVC(vc) {
    try { if (!vc || !vc.proof) return { ok: false, why: 'No proof.' }; const pub = await keyFor(vc.proof.verificationMethod); if (!pub) return { ok: false, why: 'The issuer could not be found.' };
      const ok = checkProof(vc, pub); const exp = vc.validUntil && new Date(vc.validUntil) < new Date();
      return { ok, issuer: typeof vc.issuer === 'string' ? vc.issuer : vc.issuer && vc.issuer.id, expired: !!exp, why: ok ? null : 'The signature does not match.' };
    } catch (e) { return { ok: false, why: e.message }; }
  }
  app.post('/api/v1/credentials/verify', require('express').json({ limit: '200kb' }), async (req, res) => res.json(await verifyVC(req.body && (req.body.verifiableCredential || req.body))));

  // --- Partners: the Studio issues a key; the key opens the partner door.
  const keyHash = k => crypto.createHash('sha256').update(String(k)).digest('hex');
  const partnerOf = req => { const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || ''); if (!m) return null; return db.prepare('SELECT * FROM partners WHERE key_hash=? AND active=1').get(keyHash(m[1])) || null; };
  const consenting = (p, makerId) => !!db.prepare('SELECT 1 FROM maker_partners WHERE partner_id=? AND maker_id=?').get(p.id, makerId);
  const P = (req, res, next) => { const p = partnerOf(req); if (!p) return res.status(401).json({ error: 'A partner key is needed: Authorization: Bearer <key>.' }); req.partner = p; next(); };

  app.get('/api/partner/v1', P, (req, res) => res.json({ partner: { slug: req.partner.slug, name: req.partner.name }, house: HOUSE(),
    makers: db.prepare('SELECT m.* FROM makers m JOIN maker_partners mp ON mp.maker_id=m.id WHERE mp.partner_id=?').all(req.partner.id).map(m => ({ slug: V.makerSlug(m), name: m.name, did: makerDid(m), ownDid: m.did || null, ids: ids(m) })),
    endpoints: { catalogue: '/api/partner/v1/makers/:slug/works', claims: 'POST /api/partner/v1/claims', claim: '/api/partner/v1/claims/:id', verify: 'POST /api/v1/credentials/verify' } }));
  app.get('/api/partner/v1/makers/:slug/works', P, (req, res) => {
    const m = db.prepare('SELECT * FROM makers').all().find(x => V.makerSlug(x) === req.params.slug || x.handle === req.params.slug);
    if (!m || !consenting(req.partner, m.id)) return res.status(404).json({ error: 'No maker by that name has connected you.' });
    const splits = app.locals.splits ? app.locals.splits.of : () => [];
    res.json({ maker: { slug: V.makerSlug(m), name: m.name, did: makerDid(m) }, works: db.prepare("SELECT * FROM works WHERE maker_id=? AND status='held' ORDER BY id").all(m.id).map(w => ({
      ...app.locals.workJSON(w), splits: splits(w.id).map(s => ({ name: s.name, role: s.role, pct: s.pct, did: s.did || null })),
      claims: db.prepare("SELECT id, kind, party, uses, starts_at, ends_at, state FROM claims_in WHERE work_id=? AND state='accepted'").all(w.id), credential: `${C.base}/w/${w.slug}/credential` })) });
  });
  // A rights claim, as a signed credential: who holds what in a work (an exclusive, an administration, a co-ownership,
  // a prior license). Kept pending until the maker (or the Studio) accepts it; an accepted exclusive stops conflicting sales.
  const KINDS = ['exclusive', 'administration', 'co-ownership', 'prior-license', 'release', 'other'];
  app.post('/api/partner/v1/claims', P, require('express').json({ limit: '200kb' }), async (req, res) => {
    const b = req.body || {}, vc = b.verifiableCredential || b.vc;
    if (!vc || typeof vc !== 'object') return res.status(400).json({ error: 'Send { verifiableCredential: {...}, work: "<slug or sha256>", kind, summary, party, uses: [...], starts, ends }.' });
    const w = db.prepare("SELECT * FROM works WHERE (slug=? OR sha256=? OR accession=?) AND status IN ('held','private')").get(String(b.work || ''), String(b.work || '').toLowerCase(), String(b.work || ''));
    if (!w) return res.status(404).json({ error: 'No work by that reference.' });
    if (!consenting(req.partner, w.maker_id)) return res.status(403).json({ error: 'This maker has not connected you.' });
    const kind = KINDS.includes(b.kind) ? b.kind : 'other', chk = await verifyVC(vc);
    const r = db.prepare('INSERT INTO claims_in (partner_id, work_id, maker_id, kind, summary, party, uses, starts_at, ends_at, vc, signed) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(req.partner.id, w.id, w.maker_id, kind, String(b.summary || '').slice(0, 600), String(b.party || '').slice(0, 160) || null, JSON.stringify([].concat(b.uses || []).map(String).slice(0, 12)), b.starts || null, b.ends || null, JSON.stringify(vc).slice(0, 200000), chk.ok ? 1 : 0);
    ledger.append(db, 'claim.received', w.slug, { partner: req.partner.slug, kind, signed: chk.ok });
    if (app.locals.notify) app.locals.notify.tell({ maker_id: w.maker_id, kind: 'requested', slug: w.slug, href: '/account/connections', title: `${req.partner.name} sent a rights claim on ${V.tidy(w.title)}`, body: `${kind.replace('-', ' ')}${b.party ? `, ${b.party}` : ''}. Accept or decline it in your studio.` }).catch(() => {});
    res.status(201).json({ id: r.lastInsertRowid, state: 'pending', signed: chk.ok, why: chk.why || null });
  });
  app.get('/api/partner/v1/claims/:id', P, (req, res) => { const c = db.prepare('SELECT id, kind, state, signed, created_at, decided_at FROM claims_in WHERE id=? AND partner_id=?').get(Number(req.params.id), req.partner.id); c ? res.json(c) : res.sendStatus(404); });

  // An accepted exclusive blocks the uses it covers while it runs (`offered` and `listed` consult this).
  app.locals.blockedBy = (w, useKey) => {
    const now = new Date().toISOString();
    return db.prepare("SELECT c.*, p.name partner FROM claims_in c JOIN partners p ON p.id=c.partner_id WHERE c.work_id=? AND c.state='accepted' AND c.kind='exclusive' AND (c.starts_at IS NULL OR c.starts_at <= ?) AND (c.ends_at IS NULL OR c.ends_at >= ?)").all(w.id, now, now)
      .find(c => { const u = JSON.parse(c.uses || '[]'); return !u.length || u.includes(useKey); }) || null;
  };

  // Notice of each sale, signed, to every partner the maker has connected (the use, the term, the price; never a person's name).
  async function notice(ref) {
    const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref); if (!l || !(l.price_cents > 0)) return;
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id); if (!w) return;
    const ps = db.prepare('SELECT p.* FROM partners p JOIN maker_partners mp ON mp.partner_id=p.id WHERE mp.maker_id=? AND p.active=1 AND p.webhook IS NOT NULL').all(w.maker_id); if (!ps.length) return;
    const vc = licenseVC(l);
    for (const p of ps) await post(p, 'license.granted', l.ref, { ref: l.ref, price_cents: l.price_cents, currency: l.currency, credential: vc });
  }
  // One signed post to a partner's webhook (HMAC over the body, `x-watermark-signature`), recorded whatever the answer.
  async function post(p, event, ref, payload) {
    if (!p.webhook) return 0;
    const body = JSON.stringify({ event, at: new Date().toISOString(), ...payload });
    const sig = crypto.createHmac('sha256', p.secret).update(body).digest('hex');
    let status = 0; try { const r = await fetchImpl(p.webhook, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'content-type': 'application/json', 'x-watermark-signature': `sha256=${sig}` }, body }); status = r.status; } catch (e) { status = 0; }
    db.prepare('INSERT INTO partner_sends (partner_id, event, ref, status) VALUES (?,?,?,?)').run(p.id, event, ref || null, status);
    return status;
  }
  app.locals.bridge = { notice, post, licenseVC, authorshipVC, verifyVC, HOUSE, makerDid, partnerOf, P, consenting, keyHash };

  // --- The maker's side: connections (identity, partners, claims).
  app.get('/account/connections', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/connections');
    const fresh = db.prepare('SELECT * FROM makers WHERE id=?').get(m.id);
    const partners = db.prepare('SELECT p.*, (SELECT 1 FROM maker_partners WHERE maker_id=? AND partner_id=p.id) on_ FROM partners p WHERE p.active=1 ORDER BY p.name').all(m.id);
    const claims = db.prepare("SELECT c.*, p.name partner, w.title, w.slug FROM claims_in c JOIN partners p ON p.id=c.partner_id LEFT JOIN works w ON w.id=c.work_id WHERE c.maker_id=? ORDER BY c.state='pending' DESC, c.id DESC LIMIT 60").all(m.id);
    res.send(V.connections({ m: fresh, ids: ids(fresh), did: makerDid(fresh), partners, claims, ok: req.query.ok }));
  });
  app.post('/account/connections/identity', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); const b = req.body || {};
    const did = /^did:[a-z0-9]+:[\w.%:-]{3,200}$/i.test(String(b.did || '').trim()) ? String(b.did).trim() : null;
    const clean = (v, re) => (re.test(String(v || '').trim()) ? String(v).trim() : null);
    const next = { isni: clean(b.isni, /^[0-9X ]{16,19}$/i), ipi: clean(b.ipi, /^\d{9,11}$/), site: clean(b.site, /^https:\/\/\S{3,200}$/) };
    db.prepare('UPDATE makers SET did=?, ids=? WHERE id=?').run(did, JSON.stringify(next), m.id);
    res.redirect('/account/connections?ok=identity');
  });
  app.post('/account/connections/partner/:id', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); const p = db.prepare('SELECT * FROM partners WHERE id=? AND active=1').get(Number(req.params.id)); if (!p) return res.sendStatus(404);
    if (req.body.on === '1') { db.prepare('INSERT OR IGNORE INTO maker_partners (maker_id, partner_id) VALUES (?,?)').run(m.id, p.id); ledger.append(db, 'partner.connected', p.slug, { maker: m.handle }); }
    else { db.prepare('DELETE FROM maker_partners WHERE maker_id=? AND partner_id=?').run(m.id, p.id); ledger.append(db, 'partner.disconnected', p.slug, { maker: m.handle }); }
    res.redirect('/account/connections?ok=partner');
  });
  app.post('/account/connections/claim/:id', (req, res) => {
    const m = makerOf(req); const c = db.prepare('SELECT * FROM claims_in WHERE id=?').get(Number(req.params.id));
    if (!c || (!isStudio(req) && (!m || m.id !== c.maker_id))) return res.sendStatus(403);
    const state = req.body.act === 'accept' ? 'accepted' : req.body.act === 'decline' ? 'declined' : null; if (!state) return res.sendStatus(400);
    db.prepare("UPDATE claims_in SET state=?, decided_at=datetime('now') WHERE id=?").run(state, c.id);
    const w = c.work_id ? db.prepare('SELECT slug FROM works WHERE id=?').get(c.work_id) : null;
    ledger.append(db, `claim.${state}`, w ? w.slug : String(c.id), { kind: c.kind });
    res.redirect('/account/connections?ok=claim');
  });

  // --- The Studio's side: partners (issue a key once; set the webhook; pause).
  app.get('/studio/partners', studioOnly, (req, res) => {
    const rows = db.prepare('SELECT p.*, (SELECT COUNT(*) FROM maker_partners WHERE partner_id=p.id) makers, (SELECT COUNT(*) FROM claims_in WHERE partner_id=p.id) claims, (SELECT COUNT(*) FROM partner_sends WHERE partner_id=p.id) sends FROM partners p ORDER BY p.id').all();
    res.send(V.partnersDesk({ rows, key: req.query.key || null, house: HOUSE(), base: C.base }));
  });
  app.post('/studio/partners', studioOnly, (req, res) => {
    const b = req.body || {}; const name = String(b.name || '').trim().slice(0, 80); if (!name) return res.redirect('/studio/partners');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'partner';
    const key = 'wmp_' + crypto.randomBytes(24).toString('base64url'), secret = crypto.randomBytes(24).toString('hex');
    const hook = /^https:\/\/\S+$/.test(String(b.webhook || '').trim()) ? String(b.webhook).trim() : null;
    try { db.prepare('INSERT INTO partners (slug, name, site, did, key_hash, webhook, secret, note) VALUES (?,?,?,?,?,?,?,?)').run(slug, name, String(b.site || '').trim() || null, String(b.did || '').trim() || null, keyHash(key), hook, secret, String(b.note || '').slice(0, 400) || null); }
    catch (e) { return res.redirect('/studio/partners?ok=exists'); }
    ledger.append(db, 'partner.added', slug, {});
    // The key is shown once, on this page, and never stored in the clear. The Studio hands it over by letter.
    res.send(V.partnersDesk({ rows: db.prepare('SELECT p.*, 0 makers, 0 claims, 0 sends FROM partners p ORDER BY p.id').all(), key, secret, newSlug: slug, house: HOUSE(), base: C.base }));
  });
  app.post('/studio/partners/:id', studioOnly, (req, res) => {
    const p = db.prepare('SELECT * FROM partners WHERE id=?').get(Number(req.params.id)); if (!p) return res.sendStatus(404); const b = req.body || {};
    if (b.act === 'pause') db.prepare('UPDATE partners SET active=0 WHERE id=?').run(p.id);
    else if (b.act === 'resume') db.prepare('UPDATE partners SET active=1 WHERE id=?').run(p.id);
    else if (b.act === 'webhook') db.prepare('UPDATE partners SET webhook=? WHERE id=?').run(/^https:\/\/\S+$/.test(String(b.webhook || '').trim()) ? String(b.webhook).trim() : null, p.id);
    res.redirect('/studio/partners');
  });
  return app.locals.bridge;
}

module.exports = { mountBridge, prove, checkProof, jcs, b58, unb58, multikey, fromMultikey, didUrl };
