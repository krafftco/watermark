// For the trade (Will, 18 Oct: "the best version of Getty, integrated into Watermark almost invisibly; an art-world
// person and someone just coming to look both do business in the same place, each to their delight"). The house has
// two ways in. The visitor sees the wall and nothing else. A picture editor, an art buyer, an agency turns on the
// trade (one quiet switch, remembered on the device): the same house then shows its working side: a dense search
// with the filters a professional uses, the spec of every photograph, every use with its price, a comp for layouts,
// a lightbox to share with a client, and a quote for a set. Nothing of it reaches the visitor's view.
const ORIENT = { landscape: 'Landscape', portrait: 'Portrait', square: 'Square', pano: 'Panoramic' };
const orient = w => { if (!w.width || !w.height) return null; const r = w.width / w.height; return r >= 2 ? 'pano' : r > 1.08 ? 'landscape' : r < 0.93 ? 'portrait' : 'square'; };
const mp = w => (w.width && w.height ? Math.round(w.width * w.height / 1e5) / 10 : null);

function mountTrade(app, { db, C, V, I, mk, mail, ledger, buyerOf }) {
  const esc = V.esc, tidy = V.tidy;
  const on = req => /(?:^|;\s*)wm_trade=1/.test(req.headers.cookie || '');
  app.locals.tradeOn = on;
  const set = (res, v) => res.cookie('wm_trade', v ? '1' : '', { maxAge: v ? 365 * 864e5 : 0, sameSite: 'lax', path: '/', secure: C.base.startsWith('https') });
  app.get('/trade/on', (req, res) => { set(res, true); res.redirect(safe(req.query.back) || '/trade'); });
  app.get('/trade/off', (req, res) => { set(res, false); res.redirect(safe(req.query.back) || '/collection'); });
  const safe = b => { b = String(b || ''); return /^\/[^/\\]/.test(b) ? b.slice(0, 300) : null; };

  // The search a professional runs: a word, a maker, a shape, a size, a use, a ceiling.
  const jcache = new Map();
  app.get('/trade', (req, res) => {
    const Q = { q: String(req.query.q || '').trim().slice(0, 80), maker: String(req.query.maker || '').slice(0, 80), shape: ORIENT[req.query.shape] ? req.query.shape : '', min: [12, 24, 40].includes(+req.query.min) ? +req.query.min : 0, use: String(req.query.use || '').slice(0, 30), max: Math.max(0, parseInt(req.query.max, 10) || 0), sort: ['best', 'new', 'big'].includes(req.query.sort) ? req.query.sort : 'best' };
    // (16 Nov, #75) Asked of the database: the same TRADE_MAX best held works (by the maker's grade) as before, filtered,
    // sorted and paged there; only the ids of the page come back, and the page's works are read whole in one question
    // (the page read 6,000 rows of every light column and filtered them here, then asked for each shown work by itself).
    const makers = db.prepare("SELECT m.* FROM makers m WHERE EXISTS (SELECT 1 FROM works w WHERE w.maker_id=m.id AND w.status='held') ORDER BY m.id LIMIT 2000").all();
    const where = [], args = [];
    if (Q.q) { const t = `%${Q.q.toLowerCase().replace(/[%_\\]/g, '')}%`; where.push(`(${['x.title', 'x.place', 'x.keywords', 'x.caption', 'x.camera', 'x.maker_name', 'x.accession'].map(c => `lower(COALESCE(${c},'')) LIKE ?`).join(' OR ')})`); args.push(t, t, t, t, t, t, t); }
    if (Q.maker) { const mm = makers.find(m => V.makerSlug(m) === Q.maker); where.push('x.maker_id=?'); args.push(mm ? mm.id : -1); }
    const R = 'x.width*1.0/x.height';
    if (Q.shape) where.push(`x.width>0 AND x.height>0 AND ${{ pano: `${R} >= 2`, landscape: `${R} > 1.08 AND ${R} < 2`, portrait: `${R} < 0.93`, square: `${R} >= 0.93 AND ${R} <= 1.08` }[Q.shape]}`);
    if (Q.min) { where.push('ROUND(COALESCE(x.width,0)*COALESCE(x.height,0)/100000.0)/10.0 >= ?'); args.push(Q.min); }
    const best = 'x.curated DESC, COALESCE(x.stars,0) DESC, x.id DESC';
    const orderSql = Q.sort === 'new' ? `COALESCE(x.taken_at,'') DESC, ${best}` : Q.sort === 'big' ? `COALESCE(x.width*x.height,0) DESC, ${best}` : best;
    // (the makers held apart by NOT IN, so the best are read in works_status_best's order and the makers joined after)
    const pool = `(SELECT w.id, w.title, w.place, w.keywords, w.caption, w.camera, w.accession, w.maker_id, w.width, w.height, w.taken_at, w.curated, w.stars, m.name AS maker_name FROM (SELECT w.id, w.title, w.place, w.keywords, w.caption, w.camera, w.accession, w.maker_id, w.width, w.height, w.taken_at, w.curated, w.stars FROM works w WHERE w.status='held' AND COALESCE(w.disputed,0)=0 AND w.maker_id NOT IN (SELECT id FROM makers WHERE COALESCE(standing,'open')<>'open') ORDER BY w.curated DESC, w.stars DESC, w.id DESC LIMIT ${Number(process.env.TRADE_MAX || 6000)}) w JOIN makers m ON m.id=w.maker_id) x${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
    const J = app.locals.workJSON;
    const rel = u => String(u || '').replace(C.base, '') || '/';
    // Each work's record costs a dozen lookups, so make it only for what is shown (30 Oct: /trade made every
    // held work's record before paging and took ten seconds). A filter on use or price needs the records;
    // those are kept a minute.
    const make = w => { const k = w.slug + ':' + (w.updated_at || '') + ':' + (w.stars || 0); const hit = jcache.get(w.slug); if (hit && hit.k === k && Date.now() - hit.at < 60000) return hit.j; const j = J(w, memo); j.pages.work = rel(j.pages.work); j.uses.forEach(u => { u.url = rel(u.url); }); jcache.set(w.slug, { k, j, at: Date.now() }); if (jcache.size > 5000) jcache.delete(jcache.keys().next().value); return j; };
    const memo = (() => { const M = new Map(), U = new Map(); return { mk: w => { if (!M.has(w.maker_id)) M.set(w.maker_id, mk(w)); return M.get(w.maker_id); }, uses: id => { if (!U.has(id)) U.set(id, db.prepare("SELECT * FROM uses WHERE maker_id=? AND kind!='delivery' ORDER BY sort").all(id)); return U.get(id); } }; })();
    const whole = ids => app.locals.wholeWorks(ids.map(r => ({ id: r.id }))); // the works of a page, whole, in one question
    const page = Math.max(0, Math.min(Math.floor(Number(process.env.TRADE_MAX || 6000) / 48), parseInt(req.query.page, 10) || 0)), per = 48;
    let items, total;
    if (Q.use || Q.max) {
      // A use or a ceiling needs each work's record (its uses and prices): made for the first TRADE_SCAN in this order
      // alone, never for all six thousand (each record is a few questions).
      const scan = Number(process.env.TRADE_SCAN || 480);
      items = whole(db.prepare(`SELECT x.id FROM ${pool} ORDER BY ${orderSql} LIMIT ${scan}`).all(...args)).map(w => ({ w, j: make(w) }));
      if (Q.use) items = items.filter(x => x.j.uses.some(u => u.key === Q.use));
      if (Q.max) items = items.filter(x => x.j.uses.some(u => (!Q.use || u.key === Q.use) && u.instant && u.price_cents != null && u.price_cents <= Q.max * 100));
      total = items.length; items = items.slice(page * per, page * per + per);
    } else {
      total = Number(db.prepare(`SELECT COUNT(*) n FROM ${pool}`).get(...args).n);
      items = whole(db.prepare(`SELECT x.id FROM ${pool} ORDER BY ${orderSql} LIMIT ${per} OFFSET ${page * per}`).all(...args)).map(w => ({ w, j: make(w) }));
    }
    const useKeys = [...new Map(db.prepare("SELECT key, name FROM uses WHERE kind!='delivery' ORDER BY id").all().map(u => [u.key, u.key === 'social' ? 'Collect' : u.name])).entries()];
    const qs = o => '?' + new URLSearchParams(Object.entries({ ...Q, ...o }).filter(([, v]) => v !== '' && v != null && v !== 0)).toString();
    if (!on(req)) set(res, true); // to arrive here is to ask for the trade
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'For the trade · Watermark', desc: 'Search, comp, license: every photograph held on Watermark with its spec and its price, for picture editors, art buyers and agencies.', path: '/trade', body: `<section class="tr">
<header class="tr-h"><div><p class="k">For the trade</p><h1>Every photograph, with its spec and its price.</h1><p class="tr-sub">${total} held. Comp anything for a layout; license it in one step, or ask for a quote on a set. <a href="/trade/off?back=/collection">Back to the gallery</a></p></div></header>
<form class="tr-f" method="get" action="/trade">
<input name="q" value="${esc(Q.q)}" placeholder="A place, a subject, a camera, an accession" aria-label="Search">
<select name="maker" aria-label="Maker"><option value="">Every maker</option>${makers.map(m => `<option value="${esc(V.makerSlug(m))}"${Q.maker === V.makerSlug(m) ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
<select name="shape" aria-label="Shape"><option value="">Any shape</option>${Object.entries(ORIENT).map(([k, v]) => `<option value="${k}"${Q.shape === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
<select name="min" aria-label="Size"><option value="">Any size</option>${[12, 24, 40].map(n => `<option value="${n}"${Q.min === n ? ' selected' : ''}>${n} MP and up</option>`).join('')}</select>
<select name="use" aria-label="Use"><option value="">Any use</option>${useKeys.map(([k, n]) => `<option value="${esc(k)}"${Q.use === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
<input name="max" type="number" min="0" step="50" value="${Q.max || ''}" placeholder="Up to $" aria-label="Most you'll pay">
<select name="sort" aria-label="Order"><option value="best"${Q.sort === 'best' ? ' selected' : ''}>The best first</option><option value="new"${Q.sort === 'new' ? ' selected' : ''}>Newest</option><option value="big"${Q.sort === 'big' ? ' selected' : ''}>Largest files</option></select>
<button class="buy-btn">Search</button></form>
<form method="post" action="/trade/quote" class="tr-qf" data-tr-quote>
<ol class="tr-list">${items.map(({ w, j }) => { const d = j.dimensions; return `<li class="tr-it"><label class="tr-pick" title="Add to a quote"><input type="checkbox" name="w" value="${esc(w.slug)}"></label>
<a class="tr-th" href="${esc(j.pages.work)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy" draggable="false"></a>
<div class="tr-t"><a href="${esc(j.pages.work)}"><b>${esc(j.title)}</b></a><span>${esc(j.maker.name)}${j.place ? ` &middot; ${esc(j.place)}` : ''}${j.year ? ` &middot; ${esc(j.year)}` : ''}</span>
<small class="tr-spec">${d ? `${d.width.toLocaleString()} &times; ${d.height.toLocaleString()} px &middot; ${d.megapixels} MP &middot; ${ORIENT[orient(w)] || ''}` : ''}${w.camera ? ` &middot; ${esc(w.camera)}` : ''}${w.accession ? ` &middot; ${esc(w.accession)}` : ''}${j.copyright.registered ? ' &middot; U.S. registered' : ''}</small></div>
<ul class="tr-uses">${j.uses.map(u => `<li${Q.use === u.key ? ' class="hit"' : ''}><a href="${esc(u.url)}"><span>${esc(u.name)}</span><b>${u.instant && u.price_cents != null ? V.money(u.price_cents) : 'Ask'}</b></a></li>`).join('')}</ul>
<div class="tr-act"><a href="/comp/${esc(w.slug)}" download>Comp</a><button type="button" class="hg-open tr-lb" data-hang-open="${esc(w.slug)}">Lightbox</button></div></li>`; }).join('') || '<li class="tr-none">Nothing matches. Loosen a filter.</li>'}</ol>
<div class="tr-qbar" data-tr-qbar hidden><span><b data-tr-n>0</b> chosen</span><select name="use" aria-label="For"><option value="">For which use?</option>${useKeys.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('')}</select><input name="company" placeholder="Company" maxlength="120"><input name="email" type="email" placeholder="Email" required maxlength="160"><input name="note" placeholder="The job, the run, the territory" maxlength="600"><button class="buy-btn">Ask for a quote</button></div>
</form>
<nav class="tr-pg">${page > 0 ? `<a href="${qs({ page: page - 1 })}">Earlier</a>` : ''}${(page + 1) * per < total ? `<a href="${qs({ page: page + 1 })}">More</a>` : ''}</nav>
<p class="note tr-foot">Prices are for the use named; extended rights (exclusive, merchandise, more than one company) are added on each license page. Every license is written in plain words, carries a Watermark number, and is recorded in the register. Comps are free for layouts and carry a mark; they are not for publication. Agencies and publishers who need terms on account, an API key or volume pricing: <a href="mailto:${esc(process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com')}">write to the house</a>, or see <a href="/developers">the API</a>.</p>
</section><script src="/static/hang.js?v=${V.VER}" defer></script><script src="/static/trade.js?v=${V.VER}" defer></script>` }));
  });

  // A quote for a set: one letter to the house and to each maker, with the list, the use and the job.
  app.post('/trade/quote', (req, res) => {
    const x = req.body || {}; const slugs = [].concat(x.w || []).slice(0, 60);
    const email = String(x.email || '').trim().slice(0, 160); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !slugs.length) return res.redirect('/trade');
    const works = slugs.map(s => db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(s))).filter(Boolean);
    const use = String(x.use || '').slice(0, 30), company = String(x.company || '').trim().slice(0, 120), note = String(x.note || '').trim().slice(0, 600);
    const lines = works.map(w => `- ${tidy(w.title)}, ${mk(w).name} (${w.accession || w.slug}): ${C.base}/w/${w.slug}`).join('\n');
    const text = `A quote is asked for ${works.length} photograph${works.length === 1 ? '' : 's'}.\n\nFrom: ${email}${company ? `, ${company}` : ''}\nUse: ${use || 'not said'}\nThe job: ${note || 'not said'}\n\n${lines}\n\nAnswer from the Studio, or reply to ${email}.`;
    ledger.append(db, 'trade.quote', `quote-${Date.now().toString(36)}`, { n: works.length, use });
    if (mail.on()) {
      mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `A quote for ${works.length} photograph${works.length === 1 ? '' : 's'}${company ? `, ${company}` : ''}`, text, replyTo: email });
      for (const mid of [...new Set(works.map(w => w.maker_id))]) { const m = db.prepare('SELECT * FROM makers WHERE id=?').get(mid); if (m && m.email) mail.send({ to: m.email, subject: `A quote is asked for your work${company ? `, ${company}` : ''}`, text }); }
      mail.send({ to: email, subject: 'Your quote request to Watermark', text: `Thank you. We have your request for ${works.length} photograph${works.length === 1 ? '' : 's'} and will answer within one working day, with a price for the use and the job you describe.\n\n${lines}\n\nWatermark` });
    }
    for (const mid of [...new Set(works.map(w => w.maker_id))]) if (app.locals.notify) app.locals.notify.tell({ maker_id: mid, kind: 'requested', slug: works.find(w => w.maker_id === mid).slug, href: '/account/requests', title: `A quote is asked${company ? ` by ${company}` : ''}`, body: `${works.filter(w => w.maker_id === mid).length} of your works${use ? `, for ${use}` : ''}.` }).catch(() => {});
    res.send(V.layout({ title: 'Quote asked · Watermark', body: `<section class="narrow"><p class="k">For the trade</p><h1>Asked.</h1><p class="lede">${works.length} photograph${works.length === 1 ? '' : 's'}. The house answers within one working day${mail.on() ? `, to ${esc(email)}` : ''}.</p><p><a class="buy-btn" href="/trade">Back to the search</a></p></section>` }));
  });
}

module.exports = { mountTrade, orient, mp, ORIENT };
