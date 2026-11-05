// Look (Will, 3 Nov: "a way to just look at the Met's collection that is obvious"; "I keep getting from people that
// the navigation is confusing; we need to clean it up"). Two doors:
//   /look  every collection in the house in one place, the Met first: the Met's open access, the masters (the hall),
//          the house's own collection, companies, Wander. The nav's first word.
//   /met   the Met's open-access works, a room at a time: by kind (paintings, drawings, prints, photographs,
//          sculpture, the rest) and by century, a search inside it, Wander it. Shown from the Met's Open Access
//          program (CC0) under the demonstration desk; said plainly that it is not the Met's own site.
const MET = () => process.env.MET_HANDLE || 'museum-demo';
const KINDS = [['painting', 'Paintings'], ['drawing', 'Drawings'], ['print', 'Prints'], ['photograph', 'Photographs'], ['sculpture', 'Sculpture'], ['textile', 'Textiles'], ['mixed', 'Mixed media'], ['design', 'Design and objects'], ['other', 'Objects and the rest']];
const century = y => { if (y == null) return null; if (y < 0) return `${Math.ceil(-y / 100)}th century BC`.replace(/^1th/, '1st').replace(/^2th/, '2nd').replace(/^3th/, '3rd'); const c = Math.floor(y / 100) + 1; const s = c % 10 === 1 && c !== 11 ? 'st' : c % 10 === 2 && c !== 12 ? 'nd' : c % 10 === 3 && c !== 13 ? 'rd' : 'th'; return `The ${c}${s} century`; };

function mountLook(app, { db, V }) {
  const { esc, tidy } = V;
  const met = () => db.prepare('SELECT * FROM makers WHERE handle=?').get(MET());
  const r = w => (w.width && w.height ? (w.width / w.height).toFixed(3) : 1.33);
  const yearOf = w => { const m = String(w.taken_at || '').match(/^(-?\d{1,4})/); return m ? +m[1] : null; };
  const tile = w => `<a class="met-t" href="/w/${esc(w.slug)}" style="--r:${r(w)}"><span class="met-f"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="lazy" draggable="false"></span><span class="met-c"><b>${esc(tidy(w.title))}</b><small>${esc([w.artist, yearOf(w)].filter(x => x != null && x !== '').join(' · '))}</small></span></a>`;
  const SEL = "SELECT w.slug, w.title, w.width, w.height, w.taken_at, w.kind, w.curated, w.stars, a.name AS artist FROM works w LEFT JOIN artists a ON a.id=w.artist_id WHERE w.maker_id=? AND w.status='held' AND COALESCE(w.zone,'all')!='mature'";
  // A minute's cache: the room is the same for everyone, and the Met is thousands of works.
  let cache = { at: 0, key: '', html: '' };

  app.get('/met', (req, res, next) => {
    const m = met(); if (!m) return next();
    const q = String(req.query.q || '').trim().slice(0, 60);
    const wslug = V.makerSlug(m);
    if (!q && cache.key === 'room' && Date.now() - cache.at < 60000) return res.send(cache.html);
    const n = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(m.id).n;
    let body;
    if (q) {
      const like = `%${q.toLowerCase()}%`;
      const found = db.prepare(`${SEL} AND (lower(w.title) LIKE ? OR lower(COALESCE(w.caption,'')) LIKE ? OR lower(COALESCE(w.place,'')) LIKE ? OR lower(COALESCE(a.name,'')) LIKE ? OR lower(COALESCE(w.medium,'')) LIKE ?) ORDER BY w.curated DESC, w.stars DESC, w.id LIMIT 120`).all(m.id, like, like, like, like, like);
      body = `<section class="met-q"><p class="k"><a href="/met">The Met’s open-access collection</a></p><h1>${found.length ? `${found.length === 120 ? 'The first 120' : found.length} for “${esc(q)}”.` : `Nothing for “${esc(q)}” yet.`}</h1>${search(q)}<div class="met-grid">${found.map(tile).join('')}</div>${found.length ? `<p><a class="buy-btn" href="/wander?maker=${esc(wslug)}&q=${encodeURIComponent(q)}">Wander these</a></p>` : ''}</section>`;
    } else {
      const all = db.prepare(`${SEL} ORDER BY w.curated DESC, w.stars DESC, w.id LIMIT 4000`).all(m.id);
      const hero = all.find(w => w.width > w.height && (w.width || 0) >= 1600) || all[0];
      const byKind = KINDS.map(([k, name]) => [k, name, all.filter(w => (w.kind || 'other') === k || (k === 'other' && !KINDS.some(x => x[0] === w.kind && x[0] !== 'other')))]).filter(x => x[2].length);
      const cent = {}; for (const w of all) { const y = yearOf(w); const c = century(y); if (!c) continue; (cent[c] = cent[c] || { y: Math.floor(y / 100), list: [] }).list.push(w); }
      const cents = Object.entries(cent).sort((a, b) => a[1].y - b[1].y);
      const row = (id, name, list, more) => `<section class="met-row" id="${esc(id)}"><header><h2>${esc(name)}</h2><span>${list.length.toLocaleString('en-US')}</span>${more ? `<a href="${more}">Wander them</a>` : ''}</header><div class="met-strip">${list.slice(0, 18).map(tile).join('')}</div></section>`;
      body = `<section class="met-hero">${hero ? `<img src="/img/${esc(hero.slug)}/large" alt="${esc(tidy(hero.title))}" fetchpriority="high">` : ''}<div class="met-ht"><p class="k">Shown on Watermark · CC0</p><h1>Open access works from The Metropolitan Museum of Art.</h1>
<p>The Met gives a great part of its collection to the public, free for anyone to see and use. ${n.toLocaleString('en-US')} of those works are here so far, more every day.</p>
<p class="met-acts"><a class="buy-btn" href="/wander?maker=${esc(wslug)}">Wander the collection</a><a class="met-alt" href="#kinds">Browse by room</a></p></div></section>
<section class="met-body">${search('')}
<nav class="met-nav" id="kinds">${byKind.map(([k, name, l]) => `<a href="#${k}">${esc(name)} <small>${l.length.toLocaleString('en-US')}</small></a>`).join('')}${cents.length ? '<a href="#centuries">By century</a>' : ''}</nav>
${byKind.map(([k, name, l]) => row(k, name, l, null)).join('')}
${cents.length ? `<h2 class="met-h" id="centuries">By century</h2>${cents.map(([c, o]) => row('c' + o.y, c, o.list, null)).join('')}` : ''}
<p class="note met-note">These are works from The Metropolitan Museum of Art’s Open Access program, released into the public domain (CC0), shown on Watermark and credited to the Met and to each artist. This is not the Met’s own site and has no connection with the museum; for visits, exhibitions and the full collection, go to <a href="https://www.metmuseum.org" rel="noopener">metmuseum.org</a>.</p></section>`;
    }
    const html = V.layout({ title: q ? `“${q}” in the Met’s open access · Watermark` : 'Open access works from The Metropolitan Museum of Art · Watermark', path: '/look', desc: 'The Metropolitan Museum of Art’s open-access works, to look at a room at a time, on Watermark.', body: `<div class="met">${body}</div>` });
    if (!q) cache = { at: Date.now(), key: 'room', html };
    res.send(html);
  });
  const search = q => `<form class="met-s" action="/met" method="get"><input name="q" value="${esc(q)}" placeholder="Search the Met’s works here: a word, an artist, a place" aria-label="Search the Met’s open-access works"><button class="buy-btn">Search</button></form>`;

  // Discover (Will, 5 Nov: "what is a discover page that's worthy of a platform like this? better than Instagram";
  // "you need to be able to find books, artist profiles, all sorts of things"). One search that finds everything;
  // the ways in (by artist, place, time, medium, museum; on view, just arrived, the public domain, living makers,
  // longest stood before); then walls chosen for discovery, each a row of large tiles on the dark, every tile a
  // record and a way into Wander at that work in that set. Nothing ranked by engagement, no infinite grid, no tags.
  const esc2 = esc; const img = (slug, size = 'screen') => `/img/${encodeURIComponent(slug)}/${size}`;
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { return []; } };
  const dates = a => (a.born && a.died ? `${a.born}–${a.died}` : a.died ? `d. ${a.died}` : a.born ? `b. ${a.born}` : '');
  const SAFE = "w.status='held' AND COALESCE(w.zone,'all')!='mature'";
  const wt = (w, set) => ({ href: set ? `/wander?in=${set}&at=${encodeURIComponent(w.slug)}` : `/w/${encodeURIComponent(w.slug)}`, img: img(w.slug), title: tidy(w.title), line: [w.artist || w.maker, w.year || (w.taken_at || '').slice(0, 4)].filter(Boolean).join(' · '), wide: (w.width || 0) > (w.height || 0) * 1.3 });
  const WSEL = "SELECT w.slug, w.title, w.width, w.height, w.taken_at, m.name AS maker, a.name AS artist FROM works w JOIN makers m ON m.id=w.maker_id LEFT JOIN artists a ON a.id=w.artist_id";
  let dcache = { at: 0, html: '' };
  function discover(req) {
    const R = app.locals.rows; const F = app.locals.find; const ix = F && F.index ? F.index() : {};
    const rows = [];
    // The collections: the Met first, the hall, the house, companies.
    const m = met(); const doors = [];
    if (m) { const w = db.prepare(`SELECT slug FROM works w WHERE maker_id=? AND ${SAFE} AND width>height ORDER BY curated DESC, stars DESC, id LIMIT 1`).get(m.id); const n = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(m.id); if (n && n.n) doors.push({ href: '/met', img: w ? img(w.slug) : null, title: 'The Met, open access', line: `${n.n.toLocaleString('en-US')} works, free to everyone`, wide: true }); }
    const art = db.prepare("SELECT COUNT(DISTINCT artist_id) n FROM works WHERE artist_id IS NOT NULL AND status='held'").get(); const aw = db.prepare(`SELECT w.slug FROM works w WHERE w.artist_id IS NOT NULL AND ${SAFE} AND w.width>w.height ORDER BY w.curated DESC, w.stars DESC, w.id DESC LIMIT 1`).get();
    if (art && art.n) doors.push({ href: '/art', img: aw ? img(aw.slug) : null, title: 'The hall', line: `${art.n.toLocaleString('en-US')} artists, each life’s work in order`, wide: true });
    const hw = db.prepare(`SELECT w.slug FROM works w JOIN makers mk ON mk.id=w.maker_id WHERE ${SAFE} AND COALESCE(mk.kind,'maker') IN ('maker','estate') AND (w.curated=1 OR w.stars>=4) AND w.width>w.height ORDER BY w.curated DESC, w.stars DESC, w.id DESC LIMIT 1`).get();
    const hw2 = hw || db.prepare(`SELECT w.slug FROM works w JOIN makers mk ON mk.id=w.maker_id WHERE ${SAFE} AND COALESCE(mk.kind,'maker') IN ('maker','estate') AND w.width>w.height ORDER BY w.stars DESC, w.id DESC LIMIT 1`).get(); doors.push({ href: '/collection', img: hw2 ? img(hw2.slug) : null, title: 'Living makers', line: 'The makers who keep their work here', wide: true });
    const co = db.prepare("SELECT COUNT(*) n FROM makers mk WHERE mk.kind='company' AND EXISTS (SELECT 1 FROM works w WHERE w.maker_id=mk.id AND w.status='held')").get();
    if (co && co.n) doors.push({ href: '/companies', img: null, title: 'Companies', line: 'Products, the making, the people', wide: true, dark: true });
    doors.push({ href: '/wander', img: null, title: 'Wander', line: 'One work at a time, across all of it', wide: true, wander: true, dark: true });
    rows.push({ k: 'collections', id: 'collections', title: 'The collections', tiles: doors });
    // This week: shows and walls opened lately, else what is on view.
    try { const H = app.locals.hangs; const hs = (H ? H.publicHangs() : []).filter(h => h.n).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); if (hs.length) rows.push({ k: 'onview', id: 'onview', title: 'On view', href: '/collectors', tiles: hs.slice(0, 12).map(h => ({ href: H.href(h), img: h.cover ? img(h.cover) : h.thumb || null, title: tidy(h.title), line: h.opens_at ? `A show${h.venue ? ' · ' + h.venue : ''}` : `A wall${h.curator ? ' hung by ' + h.curator : ''} · ${h.n} works` })) }); } catch (e) { /* walls are a nicety */ }
    // Longest stood before: what held people.
    const stood = all(`${WSEL} JOIN (SELECT work_id, SUM(seconds) s, COUNT(*) p FROM stood GROUP BY work_id) st ON st.work_id=w.id WHERE ${SAFE} AND st.s>=60 ORDER BY st.s DESC, w.id DESC LIMIT 12`);
    if (stood.length) rows.push({ k: 'stood', id: 'stood', title: 'Longest stood before', href: '/wander?in=stood', tiles: stood.map(w => wt(w, 'stood')) });
    // Entering the public domain this January.
    try { const PD = app.locals.pdDay; if (PD) { const j = PD.nextDay(); const list = PD.entering(j, 12).filter(a => a.cover); if (list.length) rows.push({ k: 'pd', id: 'pd', title: `Entering the public domain on January 1, ${j}`, href: '/public-domain', tiles: list.map(a => ({ href: `/art/${a.slug}`, img: img(a.cover), title: a.name, line: [dates(a), a.movement].filter(Boolean).join(' · ') })) }); } } catch (e) { /* the day is a nicety */ }
    // Just arrived: the newest in the halls.
    const arrived = all(`${WSEL} WHERE ${SAFE}${app.locals.museums ? app.locals.museums.hallSql('w') : ''} ORDER BY w.created_at DESC, w.id DESC LIMIT 12`);
    if (arrived.length) rows.push({ k: 'arrived', id: 'arrived', title: 'Just arrived', href: '/wander?in=arrived', tiles: arrived.map(w => wt(w, 'arrived')) });
    // Artists of the hall.
    const artists = (ix.artists || []).filter(a => a.n && a.cover).slice(0, 16);
    if (artists.length) rows.push({ k: 'artists', id: 'artists', title: 'Artists of the hall', href: '/art', tiles: artists.map(a => ({ href: `/art/${a.slug}`, img: img(a.cover), title: a.name, line: [dates(a), a.movement].filter(Boolean).join(' · ') })) });
    if ((ix.movements || []).length) rows.push({ k: 'movements', id: 'movements', title: 'Movements', href: '/art', tiles: ix.movements.slice(0, 14).map(mv => ({ href: `/wander?in=movement:${encodeURIComponent(mv.name)}`, img: mv.cover ? img(mv.cover) : null, title: mv.name, line: `${mv.artists} artist${mv.artists === 1 ? '' : 's'} · ${mv.n} works` })) });
    // In time: the decades, oldest first.
    { const d = new Map(); for (const [y, e] of (ix.years || new Map())) { const k = Math.floor(y / 10) * 10; const x = d.get(k) || { y: k, n: 0, cover: e.cover }; x.n += e.n; d.set(k, x); } const decades = [...d.values()].sort((a, b) => a.y - b.y); if (decades.length) rows.push({ k: 'time', id: 'time', title: 'In time', tiles: decades.map(x => ({ href: `/wander?in=decade:${x.y}`, img: img(x.cover), title: `The ${x.y}s`, line: `${x.n} works` })) }); }
    if ((ix.kinds || []).length >= 2) rows.push({ k: 'mediums', id: 'mediums', title: 'Mediums', tiles: ix.kinds.slice(0, 12).map(k => ({ href: k.href, img: k.img ? k.img.replace('/thumb', '/screen') : null, title: k.name, line: `${k.n} works` })) });
    if ((ix.places || []).length) rows.push({ k: 'places', id: 'places', title: 'Places', tiles: ix.places.slice(0, 16).map(p => ({ href: `/wander?in=place:${encodeURIComponent(p.name)}`, img: img(p.cover), title: p.name, line: `${p.n} works` })) });
    const museums = (ix.museums || []).filter(x => !x.known); if (museums.length) rows.push({ k: 'museums', id: 'museums', title: 'Museums', href: '/museums', tiles: museums.slice(0, 12).map(x => ({ href: x.href, img: x.img ? x.img.replace('/thumb', '/screen') : null, title: x.name, line: `${x.n.toLocaleString('en-US')} works` })) });
    // The shelf, the turntable, the bill.
    const books = all("SELECT t.slug, t.title, t.author, t.kind, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 AND (t.body IS NOT NULL OR t.plates IS NOT NULL) ORDER BY t.edition='jewel' DESC, t.id DESC LIMIT 14");
    if (books.length) rows.push({ k: 'books', id: 'books', title: 'The Library', href: '/library', tiles: books.map(t => ({ href: `/read/${t.slug}`, img: t.cover ? img(t.cover) : null, html: t.cover ? null : R.cloth(t), title: tidy(t.title), line: byName(t.author) || 'A book', book: true })) });
    const recs = all("SELECT slug, title, performer, composer, year, cover_slug, cover_url FROM recordings WHERE status='playing' ORDER BY id DESC LIMIT 12");
    if (recs.length) rows.push({ k: 'records', id: 'records', title: 'The Listening Room', href: '/listening', tiles: recs.map(r => ({ href: `/listening/${r.slug}`, img: r.cover_slug ? img(r.cover_slug) : r.cover_url || `/listening/${encodeURIComponent(r.slug)}/label.svg`, title: tidy(r.title), line: `${r.performer || r.composer || ''}${r.year ? ' · ' + r.year : ''}`, disc: true })) });
    const films = all("SELECT slug, title, filmmaker, poster_slug, poster_url FROM films WHERE status='showing' ORDER BY id DESC LIMIT 8");
    if (films.length) rows.push({ k: 'films', id: 'films', title: 'The Screening Room', href: '/screening', tiles: films.map(f => ({ href: `/screening/${f.slug}`, img: f.poster_slug ? img(f.poster_slug) : f.poster_url, title: tidy(f.title), line: f.filmmaker || '' })) });
    const WAYS = [['/art', 'By artist', !!(art && art.n)], ['#places', 'By place', (ix.places || []).length > 0], ['#time', 'In time', rows.some(r => r.k === 'time')], ['#mediums', 'By medium', rows.some(r => r.k === 'mediums')], ['#museums', 'By museum', rows.some(r => r.k === 'museums')], ['/collectors', 'On view', rows.some(r => r.k === 'onview')], ['/wander?in=arrived', 'Just arrived', rows.some(r => r.k === 'arrived')], ['/wander?in=open', 'The public domain', !!db.prepare(`SELECT 1 FROM works w WHERE ${SAFE} AND w.open IN ('pd','cc0','cc-by','cc-by-sa') LIMIT 1`).get()], ['/pieces', 'The pieces', !!(app.locals.openPrints && app.locals.openPrints.PIECE && db.prepare(`SELECT 1 FROM works w WHERE ${SAFE} AND w.open IN ('pd','cc0','cc-by','cc-by-sa') AND MAX(w.width, w.height) >= ? LIMIT 1`).get(app.locals.openPrints.PIECE.long_in * +(process.env.OPEN_PRINT_PPI || 150)))], ['/wander?in=living', 'Living makers', true], ['/wander?in=stood', 'Longest stood before', rows.some(r => r.k === 'stood')], ['/library', 'Books', books.length > 0], ['/listening', 'Records', recs.length > 0]].filter(x => x[2]);
    const head = `<header class="dsc-h"><p class="k">Discover</p><h1>What would you like to see?</h1>
<form class="dsc-s" action="/find" method="get" data-find-form><span class="dsc-ic">${require('./icons').find || ''}</span><input type="search" name="q" placeholder="A work, an artist, a book, a place, a year, a word" aria-label="Find anything in the house" autocomplete="off" enterkeyhint="search" data-dsc-q><button class="buy-btn">Find</button></form>
<nav class="dsc-ways" aria-label="Ways in">${WAYS.map(([h, t]) => `<a href="${esc2(h)}">${esc2(t)}</a>`).join('')}</nav></header>`;
    return `<div class="dsc">${head}<div class="rws rws-dsc" data-rws>${rows.map(r => `<section class="rw" id="${esc2(r.id)}" data-rw><header class="rw-h"><h2>${esc2(r.title)}</h2>${r.href ? `<a href="${esc2(r.href)}">All</a>` : ''}</header><div class="rw-s" data-rw-s>${r.tiles.map(R.tile).join('')}</div></section>`).join('')}</div><script src="/static/rows.js?v=${esc2(V.VER)}" defer></script><script>(function(){var i=document.querySelector('[data-dsc-q]');if(!i)return;i.addEventListener('focus',function(){if(window.WMFind){WMFind.open({mode:'page',q:i.value});i.blur();}});})();</script></div>`;
  }
  const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x; };
  app.get('/look', (req, res) => {
    const q = String(req.query.q || '').trim(); if (q) return res.redirect(302, `/find?q=${encodeURIComponent(q)}`);
    const t = String(req.query.time || '').trim(); if (t) { const m = t.match(/^(\d{3})0s$/); return res.redirect(302, m ? `/wander?in=decade:${m[1]}0` : `/wander?in=year:${encodeURIComponent(t)}`); }
    const stranger = !(app.locals.buyerOf && app.locals.buyerOf(req)) && !(app.locals.accounts && app.locals.accounts.makerOf(req));
    const ixAt = app.locals.find && app.locals.find.index ? app.locals.find.index().at : 0; // the page is new whenever Find's index is (a minute, or a change)
    if (stranger && dcache.ixAt === ixAt && Date.now() - dcache.at < 60000) return res.send(dcache.html);
    const html = V.layout({ title: 'Discover · Watermark', path: '/look', desc: 'Find anything in the house: works, artists, books, records, places, museums, movements, years.', body: discover(req) });
    if (stranger) dcache = { at: Date.now(), ixAt, html };
    res.send(html);
  });
  app.locals.look = { met };
}
module.exports = { mountLook };
