// Companies on Watermark (Will, 18 Oct: Natora is the first corporation licensing and using our photographs, and
// Watermark's images are linked into their site: a benefit we can sell). A client is a company with its sites.
// The Studio licenses photographs to it in one pass (Studio → Companies); each becomes an ordinary license
// (licensee_company = the client, use 'commercial' by default), granted and told on the register.
// On the client's own site one script does the rest:
//   <script src="BASE/site.js" data-client="natora" defer></script>
//   <img data-wm="the-staircase" alt="…">            (a slug, a ref WM-2026-000123, or a Watermark number)
// The image is served from the house under its license (/p/:ref/:size), so every placement is counted by page,
// and the credit sits with it: © maker · Licensed to <client> · the Watermark number, which anyone can check (/t/).
// When a license ends the image is no longer served: the script shows the credit and "Renew" in its place.
// Nothing is mailed to the client from here: the Studio sends the papers when Will says.
const T = require('./track');

function mountClients(app, { db, C, V, ledger, grant, nextRef, mk, q, images, originalPath, cache, studioOnly, isStudio }) {
  db.exec(`CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, hosts TEXT, email TEXT,
      note TEXT, public INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS client_licenses (client_id INTEGER NOT NULL, ref TEXT NOT NULL, place TEXT, PRIMARY KEY (client_id, ref));
    CREATE TABLE IF NOT EXISTS placements (ref TEXT NOT NULL, host TEXT NOT NULL, page TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
      first_at TEXT NOT NULL DEFAULT (datetime('now')), last_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (ref, host, page));`);
  const esc = V.esc, tidy = V.tidy || (s => s);
  const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const client = s => db.prepare('SELECT * FROM clients WHERE slug=?').get(String(s || ''));
  const hostsOf = c => String(c.hosts || '').split(/[\s,]+/).map(h => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  const live = l => l && l.status === 'active' && (!l.ends_at || new Date(l.ends_at) > new Date());
  const rows = c => db.prepare(`SELECT l.*, w.slug, w.title, w.width, w.height, w.status wstatus, cl.place, u.key ukey, u.name uname,
      (SELECT COALESCE(SUM(n),0) FROM placements p WHERE p.ref=l.ref) shown, (SELECT COUNT(*) FROM placements p WHERE p.ref=l.ref) pages
    FROM client_licenses cl JOIN licenses l ON l.ref=cl.ref JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id
    WHERE cl.client_id=? ORDER BY l.id`).all(c.id);
  const item = (c, r) => {
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(r.work_id), m = mk(w);
    return { slug: r.slug, ref: r.ref, number: T.track(r.ref), title: tidy(r.title), maker: m.name, year: w.year || null, place: w.place || null,
      width: r.width, height: r.height, use: r.uname, live: live(r), ends: r.ends_at || null,
      image: { screen: `${C.base}/p/${r.ref}/screen`, large: `${C.base}/p/${r.ref}/large` },
      credit: `© ${m.name}. Licensed to ${c.name}.`, check: `${C.base}/t/${T.compact(r.ref)}`, renew: `${C.base}/license/${r.slug}?use=${r.ukey}` };
  };

  // --- on the client's site ---
  app.get('/api/client/:slug', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*').set('Cache-Control', 'public, max-age=300');
    const c = client(req.params.slug); if (!c) return res.status(404).json({ error: 'not found' });
    res.json({ client: c.name, hosts: hostsOf(c), works: rows(c).map(r => item(c, r)) });
  });
  app.get('/site.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=300').set('Access-Control-Allow-Origin', '*');
    res.send(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'site.js'), 'utf8').replace(/__WM_BASE__/g, C.base));
  });
  // The photograph, served under its license. Counted by the page it hangs on (the Referer), never by person.
  app.get('/p/:ref/:size', async (req, res) => {
    const l = q.lic.get(req.params.ref);
    const size = images.SIZES[req.params.size] ? req.params.size : null;
    res.set('Access-Control-Allow-Origin', '*').set('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!l || !size || !db.prepare('SELECT 1 FROM client_licenses WHERE ref=?').get(l.ref)) return res.sendStatus(404);
    if (!live(l)) return res.set('Cache-Control', 'no-store').sendStatus(410);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    if (!w || w.status !== 'held') return res.sendStatus(410);
    try {
      const r = new URL(String(req.get('referer') || ''));
      const host = r.hostname.toLowerCase().slice(0, 120), page = (r.pathname || '/').slice(0, 200);
      if (host && host !== new URL(C.base).hostname) db.prepare(`INSERT INTO placements (ref, host, page, n) VALUES (?,?,?,1)
        ON CONFLICT(ref, host, page) DO UPDATE SET n=placements.n+1, last_at=datetime('now')`).run(l.ref, host, page);
    } catch (e) { /* no referer: served, not counted */ }
    try {
      const fmt = req.query.f === 'jpg' ? 'jpg' : images.pick(req.headers.accept);
      const file = await images.derivativeOf(() => originalPath(w), cache, w.slug, size, fmt);
      res.set('Cache-Control', 'public, max-age=3600').set('Vary', 'Accept'); // an hour: an ended license stops showing the same day
      res.type(images.FORMATS[fmt][1]).sendFile(file);
    } catch (e) { res.sendStatus(500); }
  });

  // --- the public account (only when the Studio turns it on: a company's name is theirs to show) ---
  app.get('/for/:slug', (req, res) => {
    const c = client(req.params.slug);
    if (!c || (!c.public && !isStudio(req))) return res.sendStatus(404);
    const list = rows(c).map(r => item(c, r));
    res.send(V.layout({ title: `Photographs licensed to ${c.name} · Watermark`, path: '/for', body: `<section class="narrow cl">
<p class="k">Licensed on Watermark</p><h1>Photographs licensed to ${esc(c.name)}.</h1>
<p class="lede">Each photograph on ${hostsOf(c).length ? esc(hostsOf(c).join(', ')) : 'their site'} is held on Watermark under its own license, with its maker named and paid. Anyone can check a license by its number.</p>
<ul class="cl-g">${list.map(x => `<li><a href="/w/${esc(x.slug)}"><img src="/img/${esc(x.slug)}/thumb" alt="${esc(x.title)}" loading="lazy"></a><p><b>${esc(x.title)}</b><span>${esc(x.maker)}</span><a class="wm-no" href="${esc(x.check)}">${esc(x.number)}</a><small>${x.live ? (x.ends ? `Covered until ${esc(String(x.ends).slice(0, 10))}` : 'Covered') : 'Ended'}</small></p></li>`).join('')}</ul>
${c.public ? '' : '<p class="note">Only the Studio sees this page until it is made public.</p>'}</section>` }));
  });

  // --- Studio → Companies ---
  const desk = (inner, ok) => V.layout({ studio: true, path: '/studio/clients', title: 'Companies · Watermark', body: `<section class="studio-wrap cl-d"><p class="k">Back office</p>${ok ? `<p class="ok">${esc(ok)}</p>` : ''}${inner}</section>` });
  app.get('/studio/clients', studioOnly, (req, res) => {
    const cs = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM client_licenses x WHERE x.client_id=c.id) n FROM clients c ORDER BY c.id`).all();
    res.send(desk(`<h1>Companies.</h1><p class="lede">A company licenses photographs for its own site. License them here in one pass; the site loads one script and every photograph carries its maker, its license and its number.</p>
${cs.length ? `<ul class="cl-l">${cs.map(c => `<li><a href="/studio/clients/${esc(c.slug)}"><b>${esc(c.name)}</b></a> &middot; ${esc(hostsOf(c).join(', ') || 'no site yet')} &middot; ${c.n} photograph${c.n === 1 ? '' : 's'}${c.public ? ' &middot; public' : ''}</li>`).join('')}</ul>` : '<p>No companies yet.</p>'}
<h2>A new company</h2><form method="post" action="/studio/clients" class="cl-f"><label>Name <input name="name" required maxlength="120" placeholder="Natora"></label>
<label>Sites <input name="hosts" maxlength="300" placeholder="natora.com, www.natora.com"></label><label>Who to write to <input name="email" type="email" maxlength="160"></label>
<label>A note (private) <input name="note" maxlength="300"></label><button>Add the company</button></form>`, req.query.ok));
  });
  app.post('/studio/clients', studioOnly, (req, res) => {
    const b = req.body || {}, name = String(b.name || '').trim().slice(0, 120); if (!name) return res.redirect('/studio/clients');
    let slug = slugify(b.slug || name) || 'company'; while (client(slug)) slug += '-2';
    db.prepare('INSERT INTO clients (slug, name, hosts, email, note) VALUES (?,?,?,?,?)').run(slug, name, String(b.hosts || '').slice(0, 300) || null, String(b.email || '').slice(0, 160) || null, String(b.note || '').slice(0, 300) || null);
    res.redirect(`/studio/clients/${slug}?ok=${encodeURIComponent(`${name} is on the books.`)}`);
  });
  app.get('/studio/clients/:slug', studioOnly, (req, res) => {
    const c = client(req.params.slug); if (!c) return res.sendStatus(404);
    const list = rows(c), base = C.base;
    const pl = db.prepare(`SELECT p.* FROM placements p JOIN client_licenses x ON x.ref=p.ref WHERE x.client_id=? ORDER BY p.n DESC LIMIT 60`).all(c.id);
    const uses = db.prepare("SELECT key, name FROM uses WHERE kind NOT IN ('print','delivery') GROUP BY key, name ORDER BY MIN(sort)").all();
    const snippet = `&lt;script src="${esc(base)}/site.js" data-client="${esc(c.slug)}" defer&gt;&lt;/script&gt;\n&lt;img data-wm="${esc((list[0] && list[0].slug) || 'the-staircase')}" alt="…"&gt;`;
    res.send(desk(`<h1>${esc(c.name)}.</h1><p class="lede">${esc(hostsOf(c).join(', ') || 'No site on the books yet.')}${c.note ? ` &middot; ${esc(c.note)}` : ''}</p>
<h2>Licensed</h2>${list.length ? `<table class="tbl"><tr><th></th><th>Photograph</th><th>Use</th><th>Number</th><th>Covered</th><th>Shown</th></tr>${list.map(r => `<tr><td><img class="cat-th" src="/img/${esc(r.slug)}/thumb" alt=""></td><td><a href="/w/${esc(r.slug)}">${esc(tidy(r.title))}</a>${r.place ? `<br><small>${esc(r.place)}</small>` : ''}</td><td>${esc(r.uname)}${r.price_cents ? ` &middot; ${V.money(r.price_cents)}` : ''}</td><td><a href="/c/${esc(r.ref)}">${esc(T.track(r.ref))}</a></td><td>${live(r) ? (r.ends_at ? `until ${esc(String(r.ends_at).slice(0, 10))}` : 'yes') : 'ended'}</td><td>${r.shown} on ${r.pages} page${r.pages === 1 ? '' : 's'}</td></tr>`).join('')}</table>` : '<p>Nothing licensed yet.</p>'}
<h2>License photographs</h2><form method="post" action="/studio/clients/${esc(c.slug)}/license" class="cl-f">
<label>Photographs (one slug or address a line; a line may add where it hangs after a space: <code>the-staircase /about</code>)<textarea name="works" rows="6" required></textarea></label>
<label>Use <select name="use">${uses.map(u => `<option value="${esc(u.key)}"${u.key === 'commercial' ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
<label>Fee for each, in dollars (leave empty when it is part of the engagement) <input name="fee" inputmode="decimal" maxlength="10"></label>
<button>License them to ${esc(c.name)}</button></form>
<h2>On their site</h2><p>Once in the site's head or footer, then <code>data-wm</code> on each image (a slug, or the license number). Their own image file may stay as it is; add <code>data-wm-keep</code> to keep it.</p><pre class="cl-s">${snippet}</pre>
${pl.length ? `<h2>Where they hang</h2><ul class="cl-l">${pl.map(p => `<li>${esc(p.host)}${esc(p.page)} &middot; ${esc(T.track(p.ref))} &middot; ${p.n} time${p.n === 1 ? '' : 's'} &middot; last ${esc(String(p.last_at).slice(0, 10))}</li>`).join('')}</ul>` : ''}
<h2>The company</h2><form method="post" action="/studio/clients/${esc(c.slug)}" class="cl-f"><label>Sites <input name="hosts" value="${esc(c.hosts || '')}" maxlength="300"></label>
<label>Who to write to <input name="email" type="email" value="${esc(c.email || '')}" maxlength="160"></label>
<label class="cl-c"><input type="checkbox" name="public" value="1"${c.public ? ' checked' : ''}> Show the public account at <a href="/for/${esc(c.slug)}">/for/${esc(c.slug)}</a> (with ${esc(c.name)}'s yes)</label><button>Save</button></form>`, req.query.ok));
  });
  app.post('/studio/clients/:slug', studioOnly, (req, res) => {
    const c = client(req.params.slug); if (!c) return res.sendStatus(404);
    const b = req.body || {};
    db.prepare('UPDATE clients SET hosts=?, email=?, public=? WHERE id=?').run(String(b.hosts || '').slice(0, 300) || null, String(b.email || '').slice(0, 160) || null, b.public === '1' ? 1 : 0, c.id);
    res.redirect(`/studio/clients/${c.slug}?ok=Saved`);
  });
  app.post('/studio/clients/:slug/license', studioOnly, (req, res) => {
    const c = client(req.params.slug); if (!c) return res.sendStatus(404);
    const b = req.body || {}, key = String(b.use || 'commercial');
    const fee = Math.round(parseFloat(String(b.fee || '').replace(/[^0-9.]/g, '')) * 100) || null;
    const done = [], missed = [];
    for (const line of String(b.works || '').split(/\n/).map(s => s.trim()).filter(Boolean).slice(0, 200)) {
      const [first, ...rest] = line.split(/\s+/);
      const slug = first.replace(/^https?:\/\/[^/]+/, '').replace(/^\/(?:m\/[^/]+|w)\//, '').replace(/[/?#].*$/, '');
      const w = q.work.get(slug), m = w && mk(w), u = m && q.use.get(m.id, key);
      if (!w || w.status !== 'held' || !u) { missed.push(first); continue; }
      const ref = nextRef();
      db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,licensee_company,intended_use,price_cents,status) VALUES (?,?,?,?,?,?,?,?,'requested')")
        .run(ref, w.id, u.id, c.name, '', c.name, `On ${hostsOf(c).join(', ') || "the company's site"}${rest.length ? ` (${rest.join(' ')})` : ''}`.slice(0, 400), fee);
      db.prepare('INSERT INTO client_licenses (client_id, ref, place) VALUES (?,?,?)').run(c.id, ref, rest.join(' ').slice(0, 200) || null);
      grant(ref, { paid: false, price_cents: fee });
      done.push(ref);
    }
    if (done.length) ledger.append(db, 'client.licensed', c.slug, { n: done.length, use: key });
    res.redirect(`/studio/clients/${c.slug}?ok=${encodeURIComponent(`${done.length} licensed to ${c.name}.${missed.length ? ` Not found or not held: ${missed.join(', ')}.` : ''}`)}`);
  });
  return { client, rows };
}
module.exports = { mountClients };
