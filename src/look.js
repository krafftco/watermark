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
      body = `<section class="met-hero">${hero ? `<img src="/img/${esc(hero.slug)}/large" alt="${esc(tidy(hero.title))}" fetchpriority="high">` : ''}<div class="met-ht"><p class="k">The Metropolitan Museum of Art · open access</p><h1>The Met, open to everyone.</h1>
<p>The Met gives a great part of its collection to the public, free for anyone to see and use. ${n.toLocaleString('en-US')} of those works are here so far, more every day.</p>
<p class="met-acts"><a class="buy-btn" href="/wander?maker=${esc(wslug)}">Wander the collection</a><a class="met-alt" href="#kinds">Browse by room</a></p></div></section>
<section class="met-body">${search('')}
<nav class="met-nav" id="kinds">${byKind.map(([k, name, l]) => `<a href="#${k}">${esc(name)} <small>${l.length.toLocaleString('en-US')}</small></a>`).join('')}${cents.length ? '<a href="#centuries">By century</a>' : ''}</nav>
${byKind.map(([k, name, l]) => row(k, name, l, null)).join('')}
${cents.length ? `<h2 class="met-h" id="centuries">By century</h2>${cents.map(([c, o]) => row('c' + o.y, c, o.list, null)).join('')}` : ''}
<p class="note met-note">These are works from The Metropolitan Museum of Art’s Open Access program, released into the public domain (CC0), shown on Watermark and credited to the Met and to each artist. This is not the Met’s own site and has no connection with the museum; for visits, exhibitions and the full collection, go to <a href="https://www.metmuseum.org" rel="noopener">metmuseum.org</a>.</p></section>`;
    }
    const html = V.layout({ title: q ? `“${q}” in the Met’s open access · Watermark` : 'The Met, open to everyone · Watermark', path: '/look', desc: 'The Metropolitan Museum of Art’s open-access works, to look at a room at a time, on Watermark.', body: `<div class="met">${body}</div>` });
    if (!q) cache = { at: Date.now(), key: 'room', html };
    res.send(html);
  });
  const search = q => `<form class="met-s" action="/met" method="get"><input name="q" value="${esc(q)}" placeholder="Search the Met’s works here: a word, an artist, a place" aria-label="Search the Met’s open-access works"><button class="buy-btn">Search</button></form>`;

  // The hub: every way to look, in one place.
  app.get('/look', (req, res) => {
    const pick = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch (e) { return null; } };
    const m = met();
    const doors = [];
    if (m) { const w = pick("SELECT slug FROM works WHERE maker_id=? AND status='held' AND width>height ORDER BY curated DESC, stars DESC, id LIMIT 1", m.id); const n = pick("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'", m.id); if (n && n.n) doors.push({ href: '/met', img: w && w.slug, k: 'A museum', name: 'The Met, open access', line: `${n.n.toLocaleString('en-US')} works from The Metropolitan Museum of Art, free to everyone` }); }
    const art = pick("SELECT COUNT(DISTINCT artist_id) n FROM works WHERE artist_id IS NOT NULL AND status='held'"); const aw = pick("SELECT w.slug FROM works w WHERE w.artist_id IS NOT NULL AND w.status='held' AND w.width>w.height ORDER BY w.curated DESC, w.stars DESC, w.id DESC LIMIT 1");
    if (art && art.n) doors.push({ href: '/art', img: aw && aw.slug, k: 'The hall', name: 'The masters', line: `${art.n.toLocaleString('en-US')} artists, each life's work in order: Van Gogh, Leonardo and the rest` });
    const hw = pick("SELECT w.slug FROM works w JOIN makers mk ON mk.id=w.maker_id WHERE w.status='held' AND COALESCE(mk.kind,'maker') IN ('maker','estate') AND (w.curated=1 OR w.stars>=4) AND w.width>w.height ORDER BY w.curated DESC, w.stars DESC, w.id DESC LIMIT 1");
    doors.push({ href: '/collection', img: hw && hw.slug, k: 'The house', name: 'Living makers', line: 'Photographs and work by the makers who keep it here, and the collection they hang' });
    const co = pick("SELECT COUNT(*) n FROM makers mk WHERE mk.kind='company' AND EXISTS (SELECT 1 FROM works w WHERE w.maker_id=mk.id AND w.status='held')");
    if (co && co.n) doors.push({ href: '/companies', img: null, k: 'Companies', name: 'Company collections', line: 'Products, the making, the machines and the people' });
    doors.push({ href: '/wander', img: null, k: 'Or simply', name: 'Wander', line: 'One work at a time, full screen, across all of it', wander: true });
    res.send(V.layout({ title: 'Look · Watermark', path: '/look', desc: 'Every collection in the house, in one place.', body: `<section class="lok"><p class="k">Look</p><h1>Where would you like to look?</h1>
<div class="lok-doors">${doors.map((d, i) => `<a class="lok-d${i === 0 ? ' lok-first' : ''}${d.wander ? ' lok-w' : ''}" href="${d.href}">${d.img ? `<img src="/img/${esc(d.img)}/${i === 0 ? 'large' : 'screen'}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}">` : `<span class="lok-blank">${d.wander ? (V.WAVE_MARK || '') : ''}</span>`}<span class="lok-t"><small>${esc(d.k)}</small><b>${esc(d.name)}</b><em>${esc(d.line)}</em></span></a>`).join('')}</div>
<p class="lok-more">Or find one thing: <button type="button" class="link" data-find-open="page">search everything</button> · <a href="/library">books</a> · <a href="/listening">records</a> · <a href="/artists">every maker</a></p></section>` }));
  });
  app.locals.look = { met };
}
module.exports = { mountLook };
