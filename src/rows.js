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
  function rowsFor(req, { works = [], hangs = [], shows = [], rooms = [], today = null, cover = null } = {}) {
    const rows = [];
    // Where to: three doors, by who you are.
    const best = works.filter(w => w.zone !== 'mature').slice(0, 12);
    const pic = w => (w ? img(w.slug) : null);
    rows.push({ k: 'Where to?', title: 'Where to?', tiles: [
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
    if (makers.length) rows.push({ k: 'The makers', title: 'The makers', href: '/artists', tiles: makers.map(({ m, w }) => ({ href: `/m/${m.handle}`, img: m.portrait ? `/portrait/${m.handle}` : img(w.slug), title: m.name, line: m.place || m.house || (m.kind === 'institution' ? 'Institution' : 'Maker'), square: !!m.portrait })) });
    // Tonight in the Keys: the clock's programme for this hour.
    try { const prog = app.locals.clock ? app.locals.clock.programme(req) : null; if (prog && prog.items && prog.items.length) rows.push({ k: 'The Keys', title: `${prog.slot && prog.slot.name ? prog.slot.name : 'Tonight'} in the Keys`, href: '/keys', tiles: prog.items.slice(0, 8).map(it => ({ href: it.href, img: it.img || null, title: it.title, line: it.why || it.line || '', dark: !it.img })) }); } catch (e) { /* the clock is optional */ }
    // On the turntable.
    const recs = all("SELECT slug, title, performer, composer, year, cover_slug, cover_url FROM recordings WHERE status='playing' ORDER BY id DESC LIMIT 12");
    if (recs.length) rows.push({ k: 'The Listening Room', title: 'The Listening Room', href: '/listening', tiles: recs.map(r => ({ href: `/listening/${r.slug}`, img: r.cover_slug ? img(r.cover_slug) : r.cover_url, title: tidy(r.title), line: `${r.performer || r.composer || ''}${r.year ? ' · ' + r.year : ''}`, disc: true })) });
    // From the shelf.
    const books = all("SELECT t.slug, t.title, t.author, t.kind, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 AND (t.body IS NOT NULL OR t.plates IS NOT NULL) ORDER BY t.id DESC LIMIT 12");
    if (books.length) rows.push({ k: 'The Library', title: 'The Library', href: '/library', tiles: books.map(t => ({ href: `/read/${t.slug}`, img: t.cover ? img(t.cover) : null, title: tidy(t.title), line: byName(t.author) || (t.kind === 'photobook' ? 'A photo book' : 'A book'), book: true })) });
    // The Screening Room, when something is on the bill.
    const films = all("SELECT f.slug, f.title, f.filmmaker, f.poster_slug, f.poster_url FROM films f WHERE f.status='showing' ORDER BY f.id DESC LIMIT 8");
    if (films.length) rows.push({ k: 'The Screening Room', title: 'The Screening Room', href: '/screening', tiles: films.map(f => ({ href: `/screening/${f.slug}`, img: f.poster_slug ? img(f.poster_slug) : f.poster_url, title: tidy(f.title), line: f.filmmaker || '' })) });
    return rows;
  }
  const tile = t => `<a class="rw-t${t.wide ? ' rw-wide' : ''}${t.square ? ' rw-sq' : ''}${t.disc ? ' rw-disc' : ''}${t.book ? ' rw-book' : ''}${t.dark ? ' rw-dark' : ''}" href="${esc(t.href)}"${t.wander ? ' data-nv-wander' : ''} tabindex="0">${t.img ? `<img src="${esc(t.img)}" alt="" loading="lazy" decoding="async" draggable="false">` : `<span class="rw-blank">${I.wave}</span>`}<span class="rw-tt"><b>${esc(t.title)}</b>${t.line ? `<i>${esc(t.line)}</i>` : ''}</span></a>`;
  const row = r => `<section class="rw" data-rw><header class="rw-h"><h2>${esc(r.title)}</h2>${r.href ? `<a href="${esc(r.href)}">All</a>` : ''}</header><div class="rw-s" data-rw-s>${r.tiles.map(tile).join('')}</div></section>`;
  const html = (req, data) => { const rows = rowsFor(req, data); return `<div class="rws" data-rws>${rows.map(row).join('')}</div><script src="/static/rows.js?v=${esc(V.VER)}" defer></script>`; };
  app.locals.rows = { rowsFor, html };
  return app.locals.rows;
}
module.exports = { mountRows };
