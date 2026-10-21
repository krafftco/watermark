// A museum's own house (Will, 21 Oct: "a Watermark Enterprise product… that they can put their name on as a white label,
// and it's powered by Watermark"; "we earn their trust that way"). An institution (or any maker the Studio allows) turns
// on its own house at /account/house: a domain of theirs (collection.<museum>.org, CNAME to the house; the certificate
// is Render's), its name as the wordmark, an accent colour, its portrait as the mark. Requests arriving on that domain
// are the same house, scoped: `/` and `/collection` show the institution's page; `/stroll`, `/wander` and `/keys` go to
// its own; `/balcony` is its balcony; the header carries its name, the footer 'Made with Watermark' and nothing else of
// ours; every other address (a work, a tour, the rights desk, Yours) works as it does. One codebase, one database:
// `makers.white_domain`, `makers.white_on`, `makers.white_accent`. The map domain → maker is read once a minute.
// `V.setTenant(t)` paints the layout for this request (like setDeskAdmin); it is set in the middleware and cleared after.
// /enterprise: the offer, in words (prices by letter; every word a draft for Will and counsel).
function mountTenants(app, { db, V, C, isStudio, makerOf }) {
  const { esc } = V;
  for (const [col, ddl] of [['white_domain', 'TEXT'], ['white_on', 'INTEGER NOT NULL DEFAULT 0'], ['white_accent', 'TEXT']]) if (!db.prepare(`SELECT 1 FROM pragma_table_info('makers') WHERE name='${col}'`).get()) db.exec(`ALTER TABLE makers ADD COLUMN ${col} ${ddl}`);
  let map = new Map(), read = 0;
  const refresh = () => { if (Date.now() - read < 60e3) return; read = Date.now(); map = new Map(db.prepare("SELECT * FROM makers WHERE white_on=1 AND white_domain IS NOT NULL AND white_domain!=''").all().map(m => [m.white_domain.toLowerCase(), m])); };
  const houseHost = (() => { try { return new URL(C.base).hostname.toLowerCase(); } catch (e) { return ''; } })();
  const tenantOf = req => { refresh(); const h = String(req.hostname || '').toLowerCase(); if (!h || h === houseHost || h === 'localhost') return null; return map.get(h) || null; };
  // The middleware: resolve, paint, rewrite the few addresses that are the house's own front.
  app.use((req, res, next) => {
    const t = tenantOf(req); req.tenant = t; V.setTenant(t ? { name: t.name, handle: t.handle, accent: t.white_accent || null, portrait: t.portrait ? `/portrait/${t.handle}` : null } : null);
    res.on('finish', () => V.setTenant(null));
    if (!t || req.method !== 'GET') return next();
    const p = req.path;
    if (p === '/' || p === '/collection' || p === '/makers' || p === '/artists') { req.url = `/m/${t.handle}` + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''); return next(); }
    if ((p === '/stroll' || p === '/wander' || p === '/wander/room') && !req.query.maker && !req.query.in && !req.query.q) return res.redirect(`/stroll?maker=${t.handle}${req.query.at ? '&at=' + encodeURIComponent(req.query.at) : ''}`);
    if (p === '/keys') return res.redirect(`/keys/at/${t.handle}`);
    if (p === '/balcony' && !(req.cookies && req.cookies.wm_room)) return res.redirect(`/balcony/at/${t.handle}`);
    next();
  });
  // The institution's own settings.
  const may = (req, m) => !!m && (m.kind === 'institution' || m.white_on || isStudio(req));
  app.get('/account/house', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); if (!may(req, m)) return res.redirect('/account');
    res.send(V.layout({ title: 'Your own house · Watermark', path: '/account/house', studio: true, body: `<section class="studio-wrap wh"><p class="k">${esc(m.name)}</p><h1>Your own house.</h1>
<p class="lede">The same house, under your name and your address: <code>collection.yourmuseum.org</code> shows your collection, your team’s desk, your rights desk, your tours and your balcony, with your name as the wordmark and <i>Made with Watermark</i> in the footer. Everything else of ours stays out of sight.${req.query.ok ? ` <b>${esc(String(req.query.ok))}</b>` : ''}</p>
<form method="post" action="/account/house" class="cl-f"><label><span>Your address</span><input name="domain" value="${esc(m.white_domain || '')}" placeholder="collection.yourmuseum.org" maxlength="120" pattern="[a-z0-9.-]+"></label><label><span>An accent colour (optional)</span><input name="accent" value="${esc(m.white_accent || '')}" placeholder="#7a1f2b" maxlength="9"></label><label class="cl-oath"><input type="checkbox" name="on" value="1" ${m.white_on ? 'checked' : ''}> Open the house at this address</label><button class="buy-btn">Keep</button></form>
<h2>Pointing the address here</h2><ol class="wh-steps"><li>At your DNS, add a <b>CNAME</b> for the address above to <code>${esc(houseHost)}</code>.</li><li>Write to <a href="mailto:${esc(process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com')}">the house</a> with the address; the certificate is issued within the day.</li><li>Open the house above. Your mark is the portrait on <a href="/account/profile">your page</a>; your name is the wordmark.</li></ol>
<p class="note">What visitors see on your address: your page as the front door; the collection, the stroll and the Keys scoped to your work; your balcony. What stays the same: every work’s own page, the register, the deed, verification, the open API. Your data is yours; the standard is the house’s.</p></section>` }));
  });
  app.post('/account/house', (req, res) => {
    const m = makerOf(req); if (!m || !may(req, m)) return res.sendStatus(401);
    const b = req.body || {}; const domain = String(b.domain || '').trim().toLowerCase().slice(0, 120); const accent = /^#[0-9a-f]{3,8}$/i.test(String(b.accent || '').trim()) ? String(b.accent).trim() : null;
    if (domain && (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain === houseHost)) return res.redirect('/account/house?ok=' + encodeURIComponent('That address will not do.'));
    const taken = domain ? db.prepare('SELECT id FROM makers WHERE white_domain=? AND id!=?').get(domain, m.id) : null; if (taken) return res.redirect('/account/house?ok=' + encodeURIComponent('That address is already another house’s.'));
    db.prepare('UPDATE makers SET white_domain=?, white_accent=?, white_on=? WHERE id=?').run(domain || null, accent, b.on === '1' && domain ? 1 : 0, m.id); read = 0;
    res.redirect('/account/house?ok=' + encodeURIComponent(b.on === '1' && domain ? `Open at ${domain}.` : 'Kept.'));
  });
  // The offer.
  app.get('/enterprise', (req, res) => {
    res.send(V.layout({ title: 'Your own house · Watermark', path: '/enterprise', desc: 'Watermark for museums and institutions: your collection, your team, your rights desk, your tours and your rooms, under your name. Made with Watermark.', body: `<section class="cx-intro en"><p class="k">For museums and institutions</p><h1>Your own house.</h1>
<p class="lede">A museum does not want to join a platform; it wants its own. So the house is yours: your address, your name on the door, your collection alone on the walls, your team at the desk, your rights desk, your guides’ tours, your balcony for your visitors, your shop and your register. <i>Made with Watermark</i> in the footer, and nothing else of ours.</p></section>
<section class="en-grid"><article><h2>What you get</h2><ul><li>Your collection in from your own records (IIIF, the Met’s API, or a drive) and out again through IIIF, so Mirador and the UV show what is kept here.</li><li>A team by role: director, curators, rights, registrar, shop, editors; each signs in as themselves.</li><li>One rights desk for every request, with a ticket, conditions accepted by a tick, the grant in writing.</li><li>Guides: your own people and your visitors walk others through the work in their own voice.</li><li>The rooms: benches under the work, a balcony for those who have just looked, the kids’ corner, the programme by the hour.</li><li>Prints and proofs from the house’s print room; editions from your shows.</li><li>The register: every arrival, licence and sale, signed, checkable by anyone.</li></ul></article>
<article><h2>What stays yours</h2><ul><li>Your name, your address, your visitors. Nothing of ours in front of them.</li><li>Your data: export the whole collection and every record at any time; the deed of each work is public and signed.</li><li>Your prices. The maker’s price is the maker’s; the house’s share is paid by the buyer on top, by a published schedule (<a href="/share">the schedule</a>).</li></ul></article>
<article><h2>What you are trusting</h2><ul><li>The same standard as the house’s own walls: colour-managed pictures, nothing laid into the pixels, a conservation room that pulls a damaged copy by itself.</li><li>Two factors at every door, nightly sealed backups with a restore drill, an audit of every act at the desk.</li><li>Open standards only: IIIF, C2PA, did:web, W3C credentials. Nothing you cannot leave with.</li></ul></article></section>
<section class="cx-intro en-letter"><h2>By letter.</h2><p>The house is priced by the size of the collection and the share on sales, published before you sign; the first institutions set their terms with us. Write to <a href="mailto:${esc(process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com')}">the house</a>, or <a href="/museums/desk">open a rights desk this afternoon</a> and see.</p></section>` }));
  });
  app.locals.tenants = { tenantOf, refresh: () => { read = 0; refresh(); } };
  return app.locals.tenants;
}
module.exports = { mountTenants };
