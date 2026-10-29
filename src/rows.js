// The rows (Will, 24 Oct: "rather than show the entire list of everything, order it better; a better presentation,
// like Spotify's playlists; the most beautiful buckets and folders; the quickest, easiest menu; what if Apple TV
// was a museum"). The front door under the hero is no longer a board, a band and a list: it is rows of large
// tiles, each row a bucket of the house, scrolling sideways, a name and one line on each tile, nothing else.
// A row is { k, title, href, tiles: [{ href, img, title, line, wide }] }. Arrows move between tiles on a keyboard
// (public/rows.js), a swipe on a phone; the first tile of each row sits at the left margin like a television's.
function mountRows(app, { db, V, C }) {
  const { esc, tidy } = V; const I = require('./icons');
  const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x; };
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { return []; } };
  const img = s => `/img/${encodeURIComponent(s)}/screen`;
  const CLOTH = ['#2f4a3a', '#5a1f22', '#23304d', '#6b4b2a', '#8a7a52', '#3b4a5a', '#4a3350', '#7a5a2a']; const hash = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const cloth = t => `<span class="rw-cloth rw-bound">${require('./binding').svg(t, { w: 300 })}</span>`; // bound as the house binds (binding.js)
  function rowsFor(req, { works = [], hangs = [], shows = [], rooms = [], today = null, cover = null } = {}) {
    const rows = [];
    // Continue reading (25 Oct): the book you are in, first, with how far you are; only for the person reading it.
    try { const RL = app.locals.readingList, b = app.locals.buyerOf ? app.locals.buyerOf(req) : null; if (RL && b) { const sh = RL.shelf(b); if (sh.reading.length) rows.push({ k: 'Continue reading', title: 'Continue reading', href: '/yours/reading', tiles: sh.reading.slice(0, 8).map(r => ({ href: r.href, img: r.cover ? img(r.cover) : null, html: r.cover ? null : cloth({ title: r.title, author: r.author, slug: r.slug }), title: tidy(r.title), line: r.progress ? `${r.progress}% · ${r.chapters > 1 ? `chapter ${r.chapter + 1} of ${r.chapters}` : 'reading'}` : r.by, book: true })) }); } } catch (e) { /* the shelf is a nicety */ }
    // Where to: three doors, by who you are.
    const best = works.filter(w => w.zone !== 'mature').slice(0, 12);
    const pic = w => (w ? img(w.slug) : null);
    // The three doors now stand in 'What this is' above the rows (25 Oct); Today keeps a tile at the head of the makers' row.
    if (false) rows.push({ k: 'Where to?', title: 'Where to?', tiles: [
      { href: `/wander${cover ? `?at=${encodeURIComponent(cover.slug)}` : ''}`, img: pic(today || best[0]), title: 'Wander', line: 'One work at a time, edge to edge. Start here.', wide: true, wander: true },
      { href: '/yours', img: pic(best[1] || best[0]), title: 'Your gallery', line: 'What you hold, your walls, your pocket.', wide: true },
      { href: '/makers#ready', img: pic(best[2] || best[0]), title: 'For those who make', line: 'The record is free and yours; the walls by invitation.', wide: true },
      ...(today ? [{ href: `/w/${encodeURIComponent(today.slug)}?today=1`, img: img(today.slug), title: `Today: ${tidy(today.title)}`, line: `${today.maker ? today.maker + '. ' : ''}Stand before it. One work a day, at nine.`, wide: true }] : []),
    ] });
    // On view: shows first, then walls.
    const onView = [...shows.map(h => ({ ...h, show: true })), ...hangs.filter(h => !shows.find(s => s.id === h.id))].slice(0, 12);
    if (onView.length) rows.push({ k: 'On view', title: 'On view', href: '/collectors', tiles: onView.map(h => ({ href: h.href || `/hang/${h.slug}`, img: h.cover ? img(h.cover) : h.thumb || null, title: tidy(h.title), line: h.show ? `A show${h.venue ? ' · ' + h.venue : ''}` : `A wall${h.curator ? ' hung by ' + h.curator : ''}${h.n ? ` · ${h.n} works` : ''}` })) });
    // The wings: the rooms by place, with the best work in each as its picture.
    const wingTiles = rooms.filter(r => (r.ids || []).length >= 3).slice(0, 12).map(r => { const w = works.find(x => (r.ids || []).includes(x.id)); return { href: `/collection?room=${encodeURIComponent(r.slug)}#archive`, img: w ? img(w.slug) : null, title: tidy(r.title), line: `${(r.ids || []).length} works` }; });
    if (wingTiles.length) rows.push({ k: 'The wings', title: 'The wings', href: '/collection#wings', tiles: wingTiles });
    // The makers, by the house's regard (the order works arrive in is the regard order).
    const seen = new Set(); const makers = [];
    for (const w of works) { const m = w.maker; if (m && !seen.has(m.id)) { seen.add(m.id); makers.push({ m, w }); } if (makers.length >= 12) break; }
    const makerTiles = makers.map(({ m, w }) => ({ href: `/m/${m.handle}`, img: m.portrait ? `/portrait/${m.handle}` : img(w.slug), title: m.name, line: m.place || m.house || (m.kind === 'institution' ? 'Institution' : 'Maker'), square: !!m.portrait }));
    const makersRow = makers.length ? { k: 'The makers', title: 'The makers', href: '/artists', tiles: makerTiles } : null;
    // The makers come first (Will, 25 Oct: other people are what make a house, not a portfolio), today's work beside them.
    if (makersRow) { if (today) makersRow.tiles.unshift({ href: `/w/${encodeURIComponent(today.slug)}?today=1`, img: img(today.slug), title: `Today: ${tidy(today.title)}`, line: `${today.maker ? today.maker + '. ' : ''}One work a day, at nine.`, wide: true }); rows.unshift(makersRow); }
    // Latest from the makers (25 Oct, the house's own Gazette): the newest across every maker's works, writing and records, by the day it came out; never a mature work, never the same maker twice in a row.
    try {
      const mature = app.locals.zone && app.locals.zone.sql ? app.locals.zone.sql(req, 'w') : '';
      const lw = all(`SELECT w.slug, w.title, w.place, w.created_at AS at, w.kind, m.name AS maker, m.handle FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held'${mature}${app.locals.museums ? app.locals.museums.hallSql('w') : ''} ORDER BY w.created_at DESC, w.id DESC LIMIT 24`).map(w => ({ at: w.at, maker: w.maker, kind: w.kind && w.kind !== 'photograph' ? w.kind[0].toUpperCase() + w.kind.slice(1) : 'A photograph', t: { href: `/m/${encodeURIComponent(w.handle)}/${encodeURIComponent(w.slug)}`, img: img(w.slug), title: tidy(w.title) } }));
      const lt = all("SELECT t.slug, t.title, t.author, t.kind, t.created_at AS at, t.body, t.file, m.name AS maker, w.slug AS cover FROM texts t JOIN makers m ON m.id=t.maker_id LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 ORDER BY t.created_at DESC LIMIT 8").map(t => ({ at: t.at, maker: t.maker, kind: t.kind === 'photobook' ? 'A photo book' : t.kind === 'almanack' ? 'An almanack' : t.kind ? t.kind[0].toUpperCase() + t.kind.slice(1) : 'Writing', t: { href: t.body && !t.file ? `/read/${t.slug}` : `/library/${t.slug}`, img: t.cover ? img(t.cover) : null, html: t.cover ? null : cloth(t), title: tidy(t.title), book: true } }));
      const lr = all("SELECT r.slug, r.title, r.at, r.cover_slug, r.cover_url, m.name AS maker FROM recordings r JOIN makers m ON m.id=r.maker_id WHERE r.source='maker' AND r.status='playing' ORDER BY r.at DESC LIMIT 6").map(r => ({ at: r.at, maker: r.maker, kind: 'A record', t: { href: `/listening/${r.slug}`, img: r.cover_slug ? img(r.cover_slug) : r.cover_url || `/listening/${encodeURIComponent(r.slug)}/label.svg`, title: tidy(r.title), disc: true } }));
      const latest = [...lw, ...lt, ...lr].filter(x => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
      // Every maker's newest first (one each, by date), then the rest by date: a house of many hands, not one.
      const seen = new Set(); const firsts = latest.filter(x => !seen.has(x.maker) && seen.add(x.maker)); const rest = latest.filter(x => !firsts.includes(x));
      const picked = [...firsts, ...rest].slice(0, 14);
      if (picked.length >= 3) rows.push({ k: 'Latest', title: 'Latest from the makers', href: '/ledger', tiles: picked.map((x, i) => ({ ...x.t, wide: i === 0, line: `${x.maker} · ${x.kind} · ${V.date(String(x.at).replace(' ', 'T'))}` })) });
    } catch (e) { /* the news is a nicety */ }
    // Tonight in the Keys: the clock's programme for this hour.
    try { const prog = app.locals.clock ? app.locals.clock.programme(req) : null; if (prog && prog.items && prog.items.length) rows.push({ k: 'The Keys', title: `${prog.slot && prog.slot.name ? prog.slot.name : 'Tonight'} in the Keys`, href: '/keys', tiles: prog.items.slice(0, 8).map(it => ({ href: it.href, img: it.img || null, title: it.title, line: it.why || it.line || '', dark: !it.img })) }); } catch (e) { /* the clock is optional */ }
    // On the turntable.
    const recs = all("SELECT slug, title, performer, composer, year, cover_slug, cover_url FROM recordings WHERE status='playing' ORDER BY id DESC LIMIT 12");
    if (recs.length) rows.push({ k: 'The Listening Room', title: 'The Listening Room', href: '/listening', tiles: recs.map(r => ({ href: `/listening/${r.slug}`, img: r.cover_slug ? img(r.cover_slug) : r.cover_url || `/listening/${encodeURIComponent(r.slug)}/label.svg`, title: tidy(r.title), line: `${r.performer || r.composer || ''}${r.year ? ' · ' + r.year : ''}`, disc: true })) });
    // From the shelf.
    const books = all("SELECT t.slug, t.title, t.author, t.kind, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 AND (t.body IS NOT NULL OR t.plates IS NOT NULL) ORDER BY t.id DESC LIMIT 12");
    if (books.length) rows.push({ k: 'The Library', title: 'The Library', href: '/library', tiles: books.map(t => ({ href: `/read/${t.slug}`, img: t.cover ? img(t.cover) : null, html: t.cover ? null : cloth(t), title: tidy(t.title), line: byName(t.author) || (t.kind === 'photobook' ? 'A photo book' : 'A book'), book: true })) });
    // The Screening Room, when something is on the bill.
    const films = all("SELECT f.slug, f.title, f.filmmaker, f.poster_slug, f.poster_url FROM films f WHERE f.status='showing' ORDER BY f.id DESC LIMIT 8");
    if (films.length) rows.push({ k: 'The Screening Room', title: 'The Screening Room', href: '/screening', tiles: films.map(f => ({ href: `/screening/${f.slug}`, img: f.poster_slug ? img(f.poster_slug) : f.poster_url, title: tidy(f.title), line: f.filmmaker || '' })) });
    return rows;
  }
  const tile = t => `<a class="rw-t${t.wide ? ' rw-wide' : ''}${t.square ? ' rw-sq' : ''}${t.disc ? ' rw-disc' : ''}${t.book ? ' rw-book' : ''}${t.dark ? ' rw-dark' : ''}" href="${esc(t.href)}"${t.wander ? ' data-nv-wander' : ''} tabindex="0">${t.img ? `<img src="${esc(t.img)}" alt="" loading="lazy" decoding="async" draggable="false">` : t.html || `<span class="rw-blank">${I.wave}</span>`}<span class="rw-tt"><b>${esc(t.title)}</b>${t.line ? `<i>${esc(t.line)}</i>` : ''}</span></a>`;
  const row = r => `<section class="rw" data-rw><header class="rw-h"><h2>${esc(r.title)}</h2>${r.href ? `<a href="${esc(r.href)}">All</a>` : ''}</header><div class="rw-s" data-rw-s>${r.tiles.map(tile).join('')}</div></section>`;
  // The maker's own front page (Will, 25 Oct: "each page can become their own media company's newspaper"; the
  // Apple Books author page as the model: seamless, the work as objects, a sort that is one tap): shelves of the
  // maker's work, series, books, records, stories and what they collect, each a row of large tiles.
  const SORTS = [['regarded', 'Most regarded'], ['newest', 'Newest'], ['year', 'By year'], ['place', 'By place']];
  function maker(req, { m, works = [], sort = 'regarded', years = [], texts = [], records = [], series = [], stories = [], collects = null, hangs = [] }) {
    const rows = []; const first = String(m.name || '').split(' ')[0]; const slug = `/m/${encodeURIComponent(m.handle)}`;
    const wt = w => ({ href: `/m/${encodeURIComponent(m.handle)}/${encodeURIComponent(w.slug)}`, img: img(w.slug), title: tidy(w.title), line: [w.place, (w.taken_at || '').slice(0, 4)].filter(Boolean).join(' · ') || undefined, wide: (w.width || 0) > (w.height || 0) * 1.3 });
    // The Gazette (Will, 25 Oct: "each page can become their own media company's newspaper"; Franklin's paper): a
    // masthead in the maker's name with the day's dateline, then Latest, one stream across works, writing, records
    // and stories by the day each came out, the newest leading. The issue number is how much has been put out.
    const when = s => (s ? String(s).replace(' ', 'T') : '');
    const latest = [
      ...works.map(w => ({ at: when(w.created_at), kind: w.kind && w.kind !== 'photograph' ? w.kind[0].toUpperCase() + w.kind.slice(1) : 'A photograph', t: wt(w) })),
      ...texts.map(t => ({ at: when(t.created_at), kind: t.kind === 'photobook' ? 'A photo book' : t.kind ? t.kind[0].toUpperCase() + t.kind.slice(1) : 'Writing', t: { href: t.body && !t.file ? `/read/${t.slug}` : `/library/${t.slug}`, img: t.cover ? img(t.cover) : null, html: t.cover ? null : cloth({ title: tidy(t.title), author: m.name, slug: t.slug }), title: tidy(t.title), book: true } })),
      ...records.map(r => ({ at: when(r.at), kind: 'A record', t: { href: `/listening/${r.slug}`, img: r.cover_slug ? img(r.cover_slug) : r.cover_url || `/listening/${encodeURIComponent(r.slug)}/label.svg`, title: tidy(r.title), disc: true } })),
      ...stories.map(p => ({ at: when(p.published_at), kind: 'From Studios', t: { href: p.url, img: p.feature_image || null, title: tidy(p.title), wide: true } })),
    ].filter(x => x.at).sort((a, b) => b.at.localeCompare(a.at));
    const issue = works.length + texts.length + records.length + stories.length;
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const mast = `<header class="gz"><p class="gz-k">${esc(first)}’s own paper</p><h2 class="gz-m">${esc(m.name)}</h2><p class="gz-d"><span>${esc(today)}</span>${m.place ? `<span>${esc(m.place)}</span>` : ''}<span>No. ${issue}</span><span>Made with Watermark</span></p></header>`;
    if (latest.length) rows.push({ k: 'latest', id: 'latest', title: 'Latest', line: `the newest, across everything`, mast, tiles: latest.slice(0, 12).map((x, i) => ({ ...x.t, wide: i === 0 ? true : x.t.wide, line: `${x.kind} · ${V.date(x.at)}` })) });
    const sortBar = `<nav class="rw-sort" aria-label="Sort">${SORTS.map(([k, l]) => `<a href="${slug}?sort=${k}#work"${sort === k ? ' aria-current="true"' : ''}>${l}</a>`).join('')}</nav>`;
    const byDate = [...works].sort((a, b) => String(b.taken_at || b.created_at || '').localeCompare(String(a.taken_at || a.created_at || '')));
    if (sort === 'year') {
      years.forEach((y, i) => rows.push({ k: 'work', id: i === 0 ? 'work' : null, title: y.year, line: `${y.n} work${y.n === 1 ? '' : 's'}`, sort: i === 0 ? sortBar : null, href: `/wander?maker=${encodeURIComponent(m.handle)}&q=${encodeURIComponent(y.year)}`, tiles: y.works.slice(0, 24).map(wt) }));
    } else if (sort === 'place') {
      const places = new Map(); for (const w of works) { const pl = w.place || 'Unplaced'; if (!places.has(pl)) places.set(pl, []); places.get(pl).push(w); }
      [...places.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([pl, ws], i) => rows.push({ k: 'work', id: i === 0 ? 'work' : null, title: pl, line: `${ws.length} work${ws.length === 1 ? '' : 's'}`, sort: i === 0 ? sortBar : null, href: `/wander?q=${encodeURIComponent(pl)}`, tiles: ws.slice(0, 24).map(wt) }));
    } else {
      const list = sort === 'newest' ? byDate : works;
      rows.push({ k: 'work', id: 'work', title: 'The work', line: `${works.length} held`, sort: sortBar, href: `/wander?maker=${encodeURIComponent(m.handle)}`, tiles: list.slice(0, 30).map(wt) });
    }
    if (series.length) rows.push({ k: 'series', title: 'Series', href: '/collection', tiles: series.map(x => { const w = works.find(k => (x.works || []).includes(k.slug)) || null; return { href: `/series/${x.slug}`, img: w ? img(w.slug) : null, title: tidy(x.title), line: x.note || `${(x.works || []).length} works`, wide: true }; }) });
    if (texts.length) rows.push({ k: 'books', title: `Books and writing`, line: `${first}’s press`, href: `/library?maker=${encodeURIComponent(m.handle)}`, tiles: texts.map(t => ({ href: t.body && !t.file ? `/read/${t.slug}` : `/library/${t.slug}`, img: t.cover ? img(t.cover) : null, html: t.cover ? null : cloth({ title: tidy(t.title), author: m.name, slug: t.slug }), title: tidy(t.title), line: t.kind === 'photobook' ? 'A photo book' : (t.kind ? t.kind[0].toUpperCase() + t.kind.slice(1) : 'Writing'), book: true })) });
    if (records.length) rows.push({ k: 'records', title: 'Records', line: `${first}’s music`, href: '/listening', tiles: records.map(r => ({ href: `/listening/${r.slug}`, img: r.cover_slug ? img(r.cover_slug) : r.cover_url || `/listening/${encodeURIComponent(r.slug)}/label.svg`, title: tidy(r.title), line: r.performer || r.composer || 'A record', disc: true })) });
    if (hangs.length) rows.push({ k: 'shows', title: 'Shows and walls', href: '/collectors', tiles: hangs.map(h => ({ href: h.href, img: h.cover ? img(h.cover) : null, title: tidy(h.title), line: h.line, wide: true })) });
    if (stories.length) rows.push({ k: 'stories', title: 'From Studios', line: 'The magazine', href: `https://studios.krafftco.com/author/${encodeURIComponent(V.makerSlug(m))}/`, tiles: stories.slice(0, 12).map(p => ({ href: p.url, img: p.feature_image || null, title: tidy(p.title), line: p.excerpt ? String(p.excerpt).slice(0, 90) : 'A story', wide: true })) });
    if (collects && collects.n) rows.push({ k: 'collects', title: `What ${first} collects`, line: `${collects.n} by other makers`, href: `/g/${collects.code}`, tiles: collects.works.map(w => ({ href: `/w/${encodeURIComponent(w.slug)}`, img: img(w.slug), title: tidy(w.title), line: w.maker })) });
    return `<div class="rws rws-mk" data-rws>${rows.map(r => `${r.mast || ''}<section class="rw"${r.id ? ` id="${r.id}"` : ''} data-rw><header class="rw-h"><h2>${esc(r.title)}</h2>${r.line ? `<span class="rw-l">${esc(r.line)}</span>` : ''}${r.href ? `<a href="${esc(r.href)}">All</a>` : ''}</header>${r.sort || ''}<div class="rw-s" data-rw-s>${r.tiles.map(tile).join('')}</div></section>`).join('')}</div><script src="/static/rows.js?v=${esc(V.VER)}" defer></script>`;
  }
  const html = (req, data) => { const rows = rowsFor(req, data); return `<div class="rws" data-rws>${rows.map(row).join('')}</div><script src="/static/rows.js?v=${esc(V.VER)}" defer></script>`; };
  app.locals.rows = { rowsFor, html, maker, SORTS };
  return app.locals.rows;
}
module.exports = { mountRows };
