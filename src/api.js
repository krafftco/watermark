// The open API. Watermark is the place a platform, a publisher or a tool plugs into to know what a photograph
// is, who made it, whether a copy is licensed, and how to credit it: read-only, no key needed, CORS open,
// rate-limited, and never personal (a licensee's company may be named; a person never is). Everything here is
// what the house already says in public, said in JSON so a machine can honour the maker the way a person would.
// Writes (registering work, buying a license on a person's behalf) come with partner keys, by letter to the house.
const crypto = require('crypto');
const { layout, esc } = require('./views');

function mountApi(app, { db, C, V, q, mk, R, listed, offered, priced, shieldOf, ledger, limiter, verifyBuffer, upload, makerBySlug, regard }) {
  const cors = (req, res, next) => { res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Cache-Control': 'public, max-age=60', 'X-Watermark-Api': 'v1' }); if (req.method === 'OPTIONS') return res.sendStatus(204); next(); };
  const L = limiter({ name: 'api', max: 600, windowMs: 60000 });
  app.use('/api/v1', cors, L);
  const base = C.base;
  const img = w => ({ thumb: `${base}/img/${w.slug}/thumb`, screen: `${base}/img/${w.slug}/screen`, large: `${base}/img/${w.slug}/large` });
  const pages = (w, m) => ({ work: `${base}/m/${V.makerSlug(m)}/${w.slug}`, maker: `${base}/m/${V.makerSlug(m)}`, license: `${base}/license/${w.slug}`, life: `${base}/w/${w.slug}/life`, verify: `${base}/verify` });
  const creditOf = (w, m) => `${V.tidy(w.title)}, ${m.name}${w.taken_at ? `, ${String(w.taken_at).slice(0, 4)}` : ''}. © ${m.name}. Held and licensed at the source on Watermark.`;
  // A work, as the house says it in public.
  function workJSON(w) {
    const m = mk(w), rules = R.parse(w.rules), sh = shieldOf(w, m), office = app.locals.copyrightState ? app.locals.copyrightState(w) : null, open = app.locals.openOf ? app.locals.openOf(w) : null;
    const OBJ = require('./object');
    return { id: w.accession, slug: w.slug, title: V.tidy(w.title), kind: OBJ.kindOf(w), medium: w.medium || null, object: OBJ.physical(w) ? { dimensions: w.obj_dims || null, edition: w.obj_edition || null, made: w.obj_made || null, signed: w.obj_signed || null, label: `${base}/w/${w.slug}/object` } : null, byline: OBJ.by(w, m.name), clearance: (() => { if (!app.locals.clearance) return null; const n = app.locals.clearance.needs(w); return { model_released: n.released.model, property_released: n.released.property, people: n.people, uses: Object.fromEntries(Object.entries(n.uses).map(([k, u]) => [k, u.ok])) }; })(), artist: (() => { const a = app.locals.art && app.locals.art.ofWork(w); if (!a) return null; const r = app.locals.art.rights(a, w); return { name: a.name, born: a.born || null, died: a.died || null, movement: a.movement || null, page: `${base}/art/${a.slug}`, rights: r.state, photographer: m.name }; })(), maker: { name: m.name, slug: V.makerSlug(m), kind: m.kind || 'maker' }, year: (w.taken_at || '').slice(0, 4) || null, place: w.place || null, medium: w.medium || null,
      dimensions: w.width && w.height ? { width: w.width, height: w.height, megapixels: Math.round(w.width * w.height / 1e5) / 10 } : null,
      credit: creditOf(w, m), copyright: { holder: m.name, registered: !!w.copyright_reg, registration: w.copyright_reg || null, statement: office ? office.line : null },
      fingerprint: { sha256: w.sha256 }, register: { entry: sh.seq || null, hash: sh.hash || null, registered_at: sh.registered || null, url: `${base}/ledger` },
      content_credentials: sh.cred && !sh.cred.none ? { present: true, issuer: sh.cred.issuer || null, captured: !!sh.cred.captured } : { present: false },
      rules: { never: rules.never || [], ai_training: !(rules.never || []).includes('ai') ? 'not permitted without a license' : 'never', transfer: !!rules.transfer },
      open: open ? { licence: open.key, name: open.name, url: open.url, take: `${base}/open/${w.slug}/take` } : null,
      uses: open ? [] : q.uses.all(m.id).filter(u => listed(rules, u.key, w)).map(u => { const p = priced(u, w); const now = offered(rules, u.key, w) && p.price_cents != null; return { key: u.key, name: u.key === 'social' ? 'Collect' : u.name, price_cents: p.price_cents != null && !(rules && rules.approve) ? p.price_cents : null, currency: 'usd', instant: now, ask: !now, url: `${base}/license/${w.slug}?use=${u.key}` }; }),
      images: img(w), pages: pages(w, m), embed: { oembed: `${base}/oembed?url=${encodeURIComponent(`${base}/w/${w.slug}`)}`, html: `<script src="${base}/embed.js" defer></script><watermark-image work="${w.slug}"></watermark-image>` } };
  }
  const held = slug => { const w = q.work.get(String(slug)); return w && w.status === 'held' ? w : null; };
  app.locals.workJSON = workJSON;

  app.get('/api/v1', (req, res) => res.json({ name: 'Watermark', version: 1, docs: `${base}/developers`, endpoints: ['/api/v1/works/:slug', '/api/v1/works?q=&maker=&limit=', '/api/v1/makers/:slug', '/api/v1/licenses/:ref', '/api/v1/verify (POST a file, or ?sha256=)', '/api/v1/match?src=', '/api/v1/credit/:slug', '/api/v1/register/:slug', '/oembed?url='], house: { key: ledger.publicKey ? ledger.publicKey() : null, register: `${base}/ledger.json` } }));
  // The list is read once a minute (28 Oct, for an audience), not for every call.
  let heldAt = 0, heldRows = [];
  const heldList = () => { if (Date.now() - heldAt > 60e3) { heldRows = db.prepare("SELECT w.* FROM works w WHERE w.status='held' ORDER BY w.curated DESC, w.stars DESC, w.id DESC").all(); heldAt = Date.now(); } return heldRows; };
  app.get('/api/v1/works', (req, res) => {
    const qs = String(req.query.q || '').trim().slice(0, 80), mkr = String(req.query.maker || '').trim().slice(0, 80), limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24)), offset = Math.max(0, Number(req.query.offset) || 0);
    let rows = heldList();
    if (mkr) rows = rows.filter(w => V.makerSlug(mk(w)) === mkr);
    if (qs) { const t = qs.toLowerCase(); rows = rows.filter(w => `${w.title} ${w.place || ''} ${w.keywords || ''} ${mk(w).name}`.toLowerCase().includes(t)); }
    res.json({ total: rows.length, offset, limit, works: rows.slice(offset, offset + limit).map(w => { const j = workJSON(w); return { id: j.id, slug: j.slug, title: j.title, maker: j.maker, year: j.year, place: j.place, credit: j.credit, images: j.images, pages: j.pages, open: j.open ? j.open.licence : null, collect: (j.uses.find(u => u.key === 'social') || {}).price_cents || null }; }) });
  });
  app.get('/api/v1/works/:slug', (req, res) => { const w = held(req.params.slug); if (!w) return res.status(404).json({ error: 'No photograph at this address.' }); res.json(workJSON(w)); });
  app.get('/api/v1/makers/:slug', (req, res) => {
    const m = makerBySlug(String(req.params.slug)); if (!m || m.standing === 'held') return res.status(404).json({ error: 'No maker at this address.' });
    const works = db.prepare("SELECT * FROM works WHERE maker_id=? AND status='held' ORDER BY curated DESC, stars DESC, id DESC").all(m.id);
    const st = regard ? regard.standing(db, m.id) : null;
    res.json({ name: m.name, slug: V.makerSlug(m), kind: m.kind || 'maker', house: m.house || null, place: m.place || null, bio: m.bio || null, site: m.site || null, page: `${base}/m/${V.makerSlug(m)}`, shown: works.length, held: st ? st.held : works.length, standing: st ? st.standing : null,
      works: works.slice(0, 50).map(w => ({ id: w.accession, slug: w.slug, title: V.tidy(w.title), year: (w.taken_at || '').slice(0, 4) || null, images: img(w), page: `${base}/m/${V.makerSlug(m)}/${w.slug}` })) });
  });
  // Is this license good? A platform asks before it shows a copy; the answer names the work, the use and the term, and a company, never a person.
  app.get('/api/v1/licenses/:ref', (req, res) => {
    const l = db.prepare('SELECT l.*, u.name AS use_name, u.key AS use_key, u.kind AS use_kind FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.ref=?').get(String(req.params.ref).toUpperCase());
    if (!l) return res.status(404).json({ error: 'No license with that reference.' });
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id), m = mk(w);
    const live = l.status === 'active' && (!l.ends_at || new Date(l.ends_at) > new Date());
    res.set('Cache-Control', 'no-store').json({ ref: l.ref, status: live ? 'active' : l.status === 'active' ? 'expired' : l.status, use: { key: l.use_key, name: l.use_key === 'social' ? 'Collect' : l.use_name, kind: l.use_kind }, starts: l.starts_at || null, ends: l.ends_at || null,
      licensee: l.licensee_company ? { company: l.licensee_company } : { person: true }, collector_no: l.collector_no || null, edition: w.edition_size || null,
      work: { id: w.accession, slug: w.slug, title: V.tidy(w.title), maker: m.name, credit: creditOf(w, m), page: `${base}/m/${V.makerSlug(m)}/${w.slug}` }, certificate: `${base}/c/${l.ref}`, verify: `${base}/verify?ref=${l.ref}` });
  });
  // Verify a file: the original, a delivered copy (and whose, by license), a copy of a held work, or nothing.
  const tell = r => ({ genuine: !!r.genuine, kind: r.kind, says: String(r.say || '').replace(/, delivered to [^.,]+/, ''), work: r.w ? { id: r.w.accession, slug: r.w.slug, title: V.tidy(r.w.title), maker: mk(r.w).name, page: `${base}/m/${V.makerSlug(mk(r.w))}/${r.w.slug}` } : null, delivered: r.trace ? { license: r.trace.ref || null, date: String(r.trace.at).slice(0, 10), size: r.trace.size, read_from: r.trace.how } : null });
  app.get('/api/v1/verify', (req, res) => {
    const h = String(req.query.sha256 || '').toLowerCase(); if (!/^[a-f0-9]{64}$/.test(h)) return res.status(400).json({ error: 'Give sha256=<hex>, or POST the file.' });
    const w = db.prepare('SELECT * FROM works WHERE sha256=?').get(h); if (w) return res.json(tell({ kind: 'image', genuine: true, w, say: 'This fingerprint is an original held in the vault.' }));
    const d = db.prepare('SELECT d.*, l.ref FROM downloads d LEFT JOIN licenses l ON l.id=d.license_id WHERE d.sha256=?').get(h);
    if (d) return res.json(tell({ kind: 'image', genuine: true, w: d.work_id ? db.prepare('SELECT * FROM works WHERE id=?').get(d.work_id) : null, trace: { ...d, how: 'bytes' }, say: `This file left the house on ${String(d.at).slice(0, 10)}${d.ref ? `, under license ${d.ref}` : ', free and clear'}.` }));
    res.json({ genuine: false, kind: 'image', says: 'Nothing held here matches this fingerprint.', work: null, delivered: null });
  });
  app.post('/api/v1/verify', (req, res, next) => upload().single('file')(req, res, e => (e ? res.status(400).json({ error: 'The file could not be taken.' }) : next())), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'POST a file as "file".' });
    let buf; try { buf = require('fs').readFileSync(req.file.path); } finally { try { require('fs').unlinkSync(req.file.path); } catch (e) { /* gone */ } }
    try { res.json(tell(await verifyBuffer(buf, req.file.originalname))); } catch (e) { res.status(422).json({ error: 'The file could not be read.' }); }
  });
  app.get('/api/v1/match', (req, res) => {
    const src = String(req.query.src || ''); const p = (src.split('?')[0].match(/\/content\/images\/.+$/) || [])[0];
    let r = null; if (p) { try { r = db.prepare("SELECT w.* FROM studios_imports s JOIN works w ON w.id=s.work_id WHERE w.status='held' AND s.src LIKE ?").get('%' + p.replace(/\/size\/w\d+(\/format\/\w+)?\//, '/')); } catch (e) { /* none */ } }
    if (!r && /^[a-f0-9]{64}$/i.test(src)) r = db.prepare("SELECT * FROM works WHERE sha256=? AND status='held'").get(src.toLowerCase());
    res.json({ work: r ? workJSON(r) : null });
  });
  app.get('/api/v1/credit/:slug', (req, res) => { const w = held(req.params.slug); if (!w) return res.status(404).json({ error: 'No photograph at this address.' }); const m = mk(w); const text = creditOf(w, m); res.json({ text, html: `<span class="wm-credit"><i>${esc(V.tidy(w.title))}</i>, <a href="${base}/m/${V.makerSlug(m)}">${esc(m.name)}</a>${w.taken_at ? `, ${String(w.taken_at).slice(0, 4)}` : ''}. © ${esc(m.name)}. <a href="${base}/m/${V.makerSlug(m)}/${w.slug}">Watermark</a></span>`, short: `© ${m.name} · watermark.krafftco.com/w/${w.slug}` }); });
  app.get('/api/v1/register/:slug', (req, res) => {
    const w = held(req.params.slug); if (!w) return res.status(404).json({ error: 'No photograph at this address.' });
    const HIDE = require('./register').HIDDEN || new Set();
    const rows = db.prepare("SELECT seq, type, at, hash, sig FROM ledger WHERE (subject=? OR data LIKE ?) ORDER BY seq").all(w.slug, `%"work":"${w.slug}"%`).filter(e => !HIDE.has(e.type) && !/^(signin|dispute|cabinet|curation|pocket|fixity)\./.test(e.type));
    res.json({ work: w.accession, slug: w.slug, entries: rows.map(e => ({ seq: e.seq, type: e.type, at: e.at, hash: e.hash, signature: e.sig || null })), house_key: ledger.publicKey ? ledger.publicKey() : null });
  });
  // oEmbed, so a link to a photograph unfurls as the photograph with its credit, the way the big platforms ask for.
  app.get('/oembed', cors, (req, res) => {
    const u = String(req.query.url || ''); const m = u.match(/\/(?:w|m\/[^/]+)\/([a-z0-9-]+)/i); const w = m ? held(m[1]) : null;
    if (!w) return res.status(404).json({ error: 'Not a Watermark photograph.' });
    const mk0 = mk(w); const maxw = Math.min(1600, Number(req.query.maxwidth) || 800); const h = w.width && w.height ? Math.round(maxw * w.height / w.width) : Math.round(maxw * 0.667);
    const body = { version: '1.0', type: req.query.format === 'photo' ? 'photo' : 'rich', provider_name: 'Watermark', provider_url: base, title: V.tidy(w.title), author_name: mk0.name, author_url: `${base}/m/${V.makerSlug(mk0)}`, width: maxw, height: h, thumbnail_url: `${base}/img/${w.slug}/thumb`, thumbnail_width: 600, thumbnail_height: Math.round(600 * (h / maxw)) };
    if (body.type === 'photo') body.url = `${base}/img/${w.slug}/screen`; else body.html = `<script src="${base}/embed.js" defer></script><watermark-image work="${esc(w.slug)}" style="max-width:${maxw}px"></watermark-image>`;
    res.json(body);
  });
  // The developers' page: plain, with the endpoints and the rule.
  app.get('/developers', (req, res) => res.send(layout({ title: 'For developers · Watermark', desc: 'Read a photograph, its maker, its license and its credit from the source. No key needed.', path: '/developers', body: `<section class="narrow prose dev"><p class="k">For developers</p><h1>Plug into the source.</h1>
<p class="lede">Watermark holds photographs at the source: the maker, the copyright, the register, the license and the credit, all in one place. Any platform, publisher or tool can read it. No key is needed to read; nothing personal is ever returned; a licensee's company may be named, a person never. Six hundred requests a minute from one address.</p>
<h2>Endpoints</h2>
<dl class="dev-dl">
<div><dt><code>GET /api/v1/works/:slug</code></dt><dd>A photograph: maker, year, place, credit line, copyright and registration, fingerprint, register entry, Content Credentials, what it never allows, the uses offered with prices, image and page addresses, embed code.</dd></div>
<div><dt><code>GET /api/v1/works?q=&amp;maker=&amp;limit=&amp;offset=</code></dt><dd>Search what is shown.</dd></div>
<div><dt><code>GET /api/v1/makers/:slug</code></dt><dd>A maker and their shown work.</dd></div>
<div><dt><code>GET /api/v1/licenses/:ref</code></dt><dd>Is this license good: status, use, term, the work; a company, never a person. Ask before you show a copy.</dd></div>
<div><dt><code>POST /api/v1/verify</code> (a file) · <code>GET /api/v1/verify?sha256=</code></dt><dd>What a file is: the original, a copy the house delivered (and under which license, on which day), a copy of a held work, or nothing. Reads the bytes, the record in the file, and the mark within the picture.</dd></div>
<div><dt><code>GET /api/v1/match?src=</code></dt><dd>A Krafft image address or a sha256 → the work.</dd></div>
<div><dt><code>GET /api/v1/credit/:slug</code></dt><dd>The credit line as text, HTML and a short form.</dd></div>
<div><dt><code>GET /api/v1/register/:slug</code></dt><dd>The public register entries of a work, each signed; the house's public key is at <code>/ledger.json</code>.</dd></div>
<div><dt><code>GET /oembed?url=</code></dt><dd>oEmbed, rich or photo, so a link unfurls as the photograph with its maker.</dd></div>
</dl>
<h2>What every file carries</h2><p>Every image that leaves the house carries its maker, its copyright, its license and the way back to the register: in the open as IPTC and PLUS metadata (XMP), sealed as Content Credentials, and within the picture as a mark unique to that delivery. Read the XMP and you have the credit; post the file to verify and you have the rest.</p>
<h2>The rule</h2><p>Show the credit. Keep the metadata. Honour the never list. Ask the license endpoint before you show a licensed copy. That is all the house asks, and it is what the makers are owed.</p>
<h2>Writing</h2><p>Registering work, licensing on a person's behalf, and partner embeds that carry a curator's share come with a partner key. Write to <a href="mailto:house@watermark.krafftco.com">house@watermark.krafftco.com</a>.</p>
<p class="note">Try it: <a href="/api/v1">/api/v1</a> · <a href="/api/v1/works?limit=3">/api/v1/works?limit=3</a>.</p></section>` })));
}

module.exports = { mountApi };
