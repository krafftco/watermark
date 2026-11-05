// Find (Will, 18 Oct: finding art is always hard; you want to see this picture again and you should get to it fast,
// not the long walk up to the Leonardo). One search for the whole house, the same everywhere: in the header of every
// page, in the stroll's bar, on / or ⌘K, and at /find. As you type, the works themselves appear, with their pictures;
// Enter opens the first; a word with no single work strolls through everything that matches. Before you type: what
// you stood before lately and what is yours (the picture you want to see again), then the ways in (places, makers,
// rooms). Typos are forgiven (trigrams); nothing personal is searched.
function mountFind(app, { db, V, I }) {
  const { esc, tidy } = V;
  let index = { at: 0, works: [], makers: [], places: [], rooms: [], hangs: [] };
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const grams = s => { const t = ` ${s} `; const g = new Set(); for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g; };
  // A slip of the fingers: one edit (two in a long word), a swapped pair included, still finds the word.
  const near = (a, b) => { if (a === b) return true; const la = a.length, lb = b.length; if (Math.abs(la - lb) > 2) return false; const max = Math.max(la, lb) >= 7 ? 2 : 1; const d = []; for (let i = 0; i <= la; i++) { d[i] = [i]; for (let j = 1; j <= lb; j++) d[i][j] = i === 0 ? j : 0; } for (let i = 1; i <= la; i++) for (let j = 1; j <= lb; j++) { const c = a[i - 1] === b[j - 1] ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c); if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); } return d[la][lb] <= max; };
  const sim = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.sqrt(a.size * b.size); };
  const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x; };
  function build() {
    if (Date.now() - index.at < 60e3) return index;
    const works = db.prepare(`SELECT w.id, w.slug, w.zone, w.title, w.place, w.taken_at, w.keywords, w.caption, w.accession, w.width, w.height, w.stars, w.curated, w.kind, m.name AS maker, m.handle, m.id AS maker_id FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held'`).all()
      .map(w => { const year = (w.taken_at || '').slice(0, 4); const fields = { title: norm(tidy(w.title)), place: norm(w.place), maker: norm(w.maker), kw: norm(w.keywords), cap: norm(w.caption).slice(0, 300), year, acc: norm(w.accession) }; return { ...w, year, title: tidy(w.title), makerSlug: V.makerSlug({ name: w.maker, handle: w.handle }), f: fields, g: grams(`${fields.title} ${fields.place} ${fields.maker}`) }; });
    const makers = []; const seenM = new Set(); for (const w of works) if (!seenM.has(w.maker_id)) { seenM.add(w.maker_id); makers.push({ name: w.maker, slug: w.makerSlug, n: works.filter(x => x.maker_id === w.maker_id).length, nm: norm(w.maker), cover: w.slug }); }
    const pc = new Map(); for (const w of works) if (w.place) { const k = w.place; const e = pc.get(k) || { name: k, n: 0, nm: norm(k), cover: w.slug }; e.n++; if (w.curated) e.cover = w.slug; pc.set(k, e); }
    const places = [...pc.values()].sort((a, b) => b.n - a.n);
    let rooms = []; try { rooms = db.prepare("SELECT c.slug, c.title, COUNT(cw.work_id) n, (SELECT w2.slug FROM collection_works x JOIN works w2 ON w2.id=x.work_id WHERE x.collection_id=c.id AND w2.status='held' ORDER BY w2.curated DESC, x.sort LIMIT 1) cover FROM collections c JOIN collection_works cw ON cw.collection_id=c.id JOIN works w ON w.id=cw.work_id AND w.status='held' WHERE c.public=1 GROUP BY c.id ORDER BY n DESC").all().map(r => ({ ...r, title: tidy(r.title), nm: norm(r.title) })); } catch (e) { rooms = []; }
    let hangs = []; try { hangs = (app.locals.hangs ? app.locals.hangs.publicHangs() : []).map(h => ({ title: h.title, href: app.locals.hangs.href(h), n: h.n, curator: h.curator, nm: norm(h.title) })); } catch (e) { hangs = []; }
    // Books and records (24 Oct: Find across everything): the shelf and the turntable answer too.
    let books = []; try { books = db.prepare("SELECT t.slug, t.title, t.author, t.kind, (t.body IS NOT NULL OR t.plates IS NOT NULL) AS readable, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 ORDER BY t.id DESC").all().map(t => ({ title: t.title, author: byName(t.author), kind: t.kind, href: t.readable ? `/read/${t.slug}` : `/library/${t.slug}`, img: t.cover ? `/img/${t.cover}/thumb` : null, nm: norm(`${t.title} ${byName(t.author)}`) })); } catch (e) { books = []; }
    let records = []; try { records = db.prepare("SELECT slug, title, performer, composer, year, cover_slug, cover_url FROM recordings WHERE status='playing' ORDER BY id DESC").all().map(r => ({ title: r.title, by: [r.performer, r.composer && r.composer !== r.performer ? r.composer : null].filter(Boolean).join(' · '), year: r.year, href: `/listening/${r.slug}`, img: r.cover_slug ? `/img/${r.cover_slug}/thumb` : r.cover_url || `/listening/${encodeURIComponent(r.slug)}/label.svg`, nm: norm(`${r.title} ${r.performer || ''} ${r.composer || ''} ${r.year || ''}`) })); } catch (e) { records = []; }
    // Discover (5 Nov: "you need to be able to find books, artist profiles, all sorts of things"): the artists of the
    // hall, the museums, the movements, the mediums, the films and the years, each with a picture and a count.
    let artists = []; try { artists = db.prepare(`SELECT a.slug, a.name, a.born, a.died, a.movement, a.nationality, (SELECT COUNT(*) FROM works w WHERE w.artist_id=a.id AND w.status='held') n, (SELECT COUNT(*) FROM catalogue c WHERE c.artist_id=a.id) known, (SELECT w.slug FROM works w WHERE w.artist_id=a.id AND w.status='held' AND COALESCE(w.zone,'all')!='mature' ORDER BY w.curated DESC, w.stars DESC, w.id LIMIT 1) cover FROM artists a WHERE EXISTS (SELECT 1 FROM works w WHERE w.artist_id=a.id AND w.status='held') OR EXISTS (SELECT 1 FROM catalogue c WHERE c.artist_id=a.id) ORDER BY n DESC, known DESC`).all().map(a => ({ ...a, nm: norm(`${a.name} ${a.movement || ''} ${a.nationality || ''}`), nn: norm(a.name), g: grams(norm(a.name)) })); } catch (e) { artists = []; }
    let museums = []; try { museums = db.prepare("SELECT m.handle, m.name, m.place, m.portrait, COUNT(*) n, (SELECT w.slug FROM works w WHERE w.maker_id=m.id AND w.status='held' AND COALESCE(w.zone,'all')!='mature' ORDER BY w.curated DESC, w.stars DESC, w.id LIMIT 1) cover FROM makers m JOIN works w ON w.maker_id=m.id AND w.status='held' WHERE m.kind='institution' AND m.handle<>'the-public-domain' GROUP BY m.id ORDER BY n DESC").all().map(m => ({ name: m.name, place: m.place, n: m.n, href: `/m/${V.makerSlug(m)}`, stroll: `/wander?maker=${encodeURIComponent(V.makerSlug(m))}`, img: m.cover ? `/img/${m.cover}/thumb` : null, nm: norm(`${m.name} ${m.place || ''}`) })); } catch (e) { museums = []; }
    try { const kp = db.prepare("SELECT k.qid, k.name, k.city, k.country, COUNT(*) n FROM keepers k JOIN catalogue c ON c.collection_qid=k.qid GROUP BY k.qid ORDER BY n DESC LIMIT 400").all(); const have = new Set(museums.map(m => m.nm)); for (const k of kp) { const nm = norm(`${k.name} ${k.city || ''} ${k.country || ''}`); if (have.has(norm(k.name))) continue; museums.push({ name: k.name, place: [k.city, k.country].filter(Boolean).join(', '), n: k.n, known: true, href: `/art/visit/${encodeURIComponent(k.qid)}`, stroll: null, img: null, nm }); } } catch (e) { /* no catalogue */ }
    const movements = []; { const mc = new Map(); for (const a of artists) if (a.movement && a.n) { const e = mc.get(a.movement) || { name: a.movement, artists: 0, n: 0, cover: a.cover }; e.artists++; e.n += a.n; if (!e.cover) e.cover = a.cover; mc.set(a.movement, e); } for (const e of mc.values()) movements.push({ ...e, nm: norm(e.name), href: `/art?movement=${encodeURIComponent(e.name)}`, stroll: `/wander?in=movement:${encodeURIComponent(e.name)}`, img: e.cover ? `/img/${e.cover}/thumb` : null }); movements.sort((a, b) => b.n - a.n); }
    const kinds = []; try { const K = require('./object').KINDS; const kc = new Map(); for (const w of works) { const k = w.kind || 'photograph'; const e = kc.get(k) || { k, n: 0, cover: w.slug }; e.n++; if (w.curated && w.zone !== 'mature') e.cover = w.slug; kc.set(k, e); } for (const e of kc.values()) if (K[e.k]) kinds.push({ name: `${K[e.k]}s`, k: e.k, n: e.n, nm: norm(K[e.k] + 's'), href: `/wander?in=kind:${e.k}`, stroll: `/wander?in=kind:${e.k}`, img: `/img/${e.cover}/thumb` }); kinds.sort((a, b) => b.n - a.n); } catch (e) { /* kinds are a nicety */ }
    let films = []; try { films = db.prepare("SELECT slug, title, filmmaker, year, poster_slug, poster_url FROM films WHERE status='showing' ORDER BY id DESC").all().map(f => ({ name: f.title, by: [f.filmmaker, f.year].filter(Boolean).join(', '), href: `/screening/${f.slug}`, img: f.poster_slug ? `/img/${f.poster_slug}/thumb` : f.poster_url || null, nm: norm(`${f.title} ${f.filmmaker || ''} ${f.year || ''}`) })); } catch (e) { films = []; }
    const years = new Map(); for (const w of works) { const y = parseInt(w.year, 10); if (!y) continue; const e = years.get(y) || { y, n: 0, cover: w.slug }; e.n++; if (w.curated && w.zone !== 'mature') e.cover = w.slug; years.set(y, e); }
    index = { at: Date.now(), works, makers, places, rooms, hangs, books, records, artists, museums, movements, kinds, films, years };
    return index;
  }
  app.locals.findIndexDirty = () => { index.at = 0; };
  const imgOf = w => `/img/${w.slug}/thumb`;
  const row = w => ({ kind: 'work', slug: w.slug, title: w.title, maker: w.maker, makerSlug: w.makerSlug, place: w.place || null, year: w.year || null, img: imgOf(w), href: `/m/${w.makerSlug}/${w.slug}`, stroll: `/wander?at=${encodeURIComponent(w.slug)}` });

  function search(q, n = 12, req = null) {
    const ix0 = build(); const ix = req && app.locals.zone && !app.locals.zone.open(req) ? { ...ix0, works: ix0.works.filter(w => w.zone !== 'mature') } : ix0; const nq = norm(q); if (!nq) return { works: [], makers: [], places: [], rooms: [], hangs: [] };
    const toks = nq.split(' ').filter(Boolean); const t0 = toks[0] || '';
    const scored = [];
    for (const w of ix.works) {
      let s = 0, all = true;
      for (const t of toks) {
        let ts = 0;
        const hit = (field, pts, prefixPts) => { if (!field) return; if (field === t) ts = Math.max(ts, pts + 4); else if (field.split(' ').some(x => x === t)) ts = Math.max(ts, pts); else if (field.split(' ').some(x => x.startsWith(t))) ts = Math.max(ts, prefixPts); else if (t.length >= 4 && field.includes(t)) ts = Math.max(ts, prefixPts * 0.6); };
        hit(w.f.title, 10, 7); hit(w.f.place, 7, 5); hit(w.f.maker, 6, 4); hit(w.f.kw, 4, 2.5); hit(w.f.cap, 2, 1); hit(w.f.year, 6, 3); hit(w.f.acc, 12, 8);
        if (!ts) { all = false; } s += ts;
      }
      if (!all || !s) continue;
      s += (w.curated ? 2 : 0) + (w.stars || 0) * 0.3;
      scored.push([s, w]);
    }
    let works = scored.sort((a, b) => b[0] - a[0]).map(x => x[1]);
    if (!works.length && nq.length >= 4) { // a typo forgiven: a near word in the title, place or maker, else the nearest by trigram
      const words = w => `${w.f.title} ${w.f.place} ${w.f.maker}`.split(' ').filter(x => x.length >= 3);
      const byWord = ix.works.filter(w => toks.every(t => t.length < 4 || words(w).some(x => near(t, x))));
      if (byWord.length) works = byWord.sort((a, b) => (b.curated - a.curated) || ((b.stars || 0) - (a.stars || 0)));
      else { const g = grams(nq); works = ix.works.map(w => [sim(g, w.g), w]).filter(x => x[0] > 0.28).sort((a, b) => b[0] - a[0]).map(x => x[1]); }
    }
    const starts = (nm, t) => nm === t || nm.split(' ').some(x => x.startsWith(t)) || nm.includes(t);
    let makers = ix.makers.filter(m => toks.every(t => starts(m.nm, t))).slice(0, 4);
    let places = ix.places.filter(p => toks.every(t => starts(p.nm, t))).slice(0, 6);
    if (!makers.length && !places.length && nq.length >= 4) { const g = grams(nq); const near = (list, k) => list.map(x => [sim(g, grams(x.nm)), x]).filter(x => x[0] > 0.4).sort((a, b) => b[0] - a[0]).slice(0, k).map(x => x[1]); places = near(ix.places, 3); makers = near(ix.makers, 2); }
    const rooms = ix.rooms.filter(r => toks.every(t => starts(r.nm, t))).slice(0, 4);
    const hangs = ix.hangs.filter(h => toks.every(t => starts(h.nm, t))).slice(0, 4);
    const inWords = (nm, t) => starts(nm, t) || nm.split(' ').some(w => w.startsWith(t));
    // The artists of the hall: by name, movement or nationality; a slip forgiven; first when the word is their name.
    let artists = (ix.artists || []).filter(a => toks.every(t => inWords(a.nm, t)));
    if (!artists.length && nq.length >= 4) { const g = grams(nq); artists = (ix.artists || []).filter(a => a.nn.split(' ').some(x => toks.some(t => t.length >= 4 && near(t, x))) || sim(g, a.g) > 0.45); }
    artists.sort((a, b) => (b.nn.startsWith(nq) - a.nn.startsWith(nq)) || (b.n - a.n) || (b.known - a.known)); artists = artists.slice(0, 5);
    const artistsFirst = !!(artists[0] && (() => { const ws = artists[0].nn.split(' '); return toks.every(t => ws.includes(t)) || (toks.length === 1 && t0.length >= 4 && ws.some(x => x.startsWith(t0) && artists[0].nn.length - t0.length < 12 && !(ix.works || []).some(w => w.f.title.split(' ').includes(t0)))); })());
    const museums = (ix.museums || []).filter(m => toks.every(t => inWords(m.nm, t))).slice(0, 4);
    const movements = (ix.movements || []).filter(m => toks.every(t => inWords(m.nm, t))).slice(0, 4);
    const kinds = (ix.kinds || []).filter(k => toks.every(t => inWords(k.nm, t))).slice(0, 3);
    const films = (ix.films || []).filter(f => toks.every(t => inWords(f.nm, t))).slice(0, 4);
    // A time: a year (1889), a decade (1880s), a century (19th century, 1800s) read from the words and counted.
    const times = []; { const Y = ix.years || new Map(); const m1 = nq.match(/^(\d{4})$/), m2 = nq.match(/^(\d{3})0s$/), m3 = nq.match(/^(\d{1,2})(?:st|nd|rd|th) century$/) || nq.match(/^(\d{2})00s$/);
      const count = (a, b) => { let n = 0, cover = null; for (const [y, e] of Y) if (y >= a && y < b) { n += e.n; if (!cover || e.cover) cover = cover || e.cover; } return { n, cover }; };
      if (m1 && Y.get(+m1[1])) { const e = Y.get(+m1[1]); times.push({ name: `The year ${m1[1]}`, n: e.n, href: `/wander?in=year:${m1[1]}`, stroll: `/wander?in=year:${m1[1]}`, img: `/img/${e.cover}/thumb` }); }
      else if (m2) { const y = +m2[1] * 10; const c = count(y, y + 10); if (c.n) times.push({ name: `The ${y}s`, n: c.n, href: `/wander?in=decade:${y}`, stroll: `/wander?in=decade:${y}`, img: c.cover ? `/img/${c.cover}/thumb` : null }); }
      else if (m3) { const c0 = nq.endsWith('century') ? (+m3[1] - 1) * 100 : +m3[1] * 100; const c = count(c0, c0 + 100); if (c.n) { const ds = []; for (let d = c0; d < c0 + 100; d += 10) { const k = count(d, d + 10); if (k.n) ds.push({ name: `The ${d}s`, n: k.n, href: `/wander?in=decade:${d}`, stroll: `/wander?in=decade:${d}`, img: k.cover ? `/img/${k.cover}/thumb` : null }); } times.push(...ds.slice(0, 6)); } }
    }
    const books = (ix.books || []).filter(b => toks.every(t => inWords(b.nm, t))).slice(0, 5);
    const records = (ix.records || []).filter(r => toks.every(t => inWords(r.nm, t))).slice(0, 5);
    // The rooms of the house by name (4 Nov, the quiet house: off the menus, never out of reach).
    const doors = []; (V.DOORS || []).forEach(([g, list]) => list.forEach(([h, t, line, w]) => { const nm = norm(`${t} ${line} ${w || ''}`); if (toks.every(tk => nm.includes(tk))) doors.push({ kind: 'door', name: t, by: line, href: h, w: norm(t).replace(/^the /, '').startsWith(nq) || norm(t).startsWith(nq) ? 2 : norm(t).includes(nq) ? 1 : 0 }); }));
    doors.sort((a, b) => b.w - a.w);
    return { artistsFirst, artists: artists.map(a => ({ kind: 'artist', name: a.name, by: [a.born || a.died ? (a.born && a.died ? `${a.born}–${a.died}` : a.died ? `d. ${a.died}` : `b. ${a.born}`) : null, a.movement].filter(Boolean).join(' · ') || null, n: a.n, known: a.known, href: `/art/${a.slug}`, stroll: a.n ? `/wander/art/${a.slug}` : null, img: a.cover ? imgOf({ slug: a.cover }) : null })), museums: museums.map(({ nm, ...m }) => ({ kind: 'museum', by: m.place || (m.known ? 'Keeps the originals' : null), ...m })), movements: movements.map(m => ({ kind: 'movement', name: m.name, by: `${m.artists} artist${m.artists === 1 ? '' : 's'}`, n: m.n, href: m.href, stroll: m.stroll, img: m.img })), kinds: kinds.map(({ nm, ...k }) => ({ kind: 'kind', ...k })), films: films.map(({ nm, ...f }) => ({ kind: 'film', ...f })), times: times.map(t => ({ kind: 'time', ...t })), doorsFirst: !!(doors[0] && doors[0].w === 2), doors: doors.slice(0, 5).map(({ w, ...d }) => d), works: works.slice(0, n).map(row), more: Math.max(0, works.length - n), makers: makers.map(m => ({ kind: 'maker', name: m.name, n: m.n, href: `/m/${m.slug}`, stroll: `/wander?maker=${encodeURIComponent(m.slug)}`, img: imgOf({ slug: m.cover }) })), places: places.map(p => ({ kind: 'place', name: p.name, n: p.n, href: `/wander?q=${encodeURIComponent(p.name)}`, stroll: `/wander?q=${encodeURIComponent(p.name)}`, img: imgOf({ slug: p.cover }) })), rooms: rooms.map(r => ({ kind: 'room', name: r.title, n: r.n, href: `/rooms/${r.slug}`, stroll: `/wander?in=series:${encodeURIComponent(r.slug)}`, img: r.cover ? imgOf({ slug: r.cover }) : null })), hangs: hangs.map(h => ({ kind: 'wall', name: h.title, n: h.n, by: h.curator, href: h.href, stroll: h.href })), books: books.map(b => ({ kind: 'book', name: b.title, by: b.author, href: b.href, img: b.img })), records: records.map(r => ({ kind: 'record', name: r.title, by: [r.by, r.year].filter(Boolean).join(', '), href: r.href, img: r.img })) };
  }
  // Before you type: lately (what you stood before, newest first), yours, then the ways in.
  function before(req) {
    const ix = build(); const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null; const v = String((req.cookies && req.cookies.wm_v) || '').slice(0, 16);
    let lately = [], yours = [];
    try { if (b || v) { const rows = db.prepare(`SELECT w.slug FROM stood s JOIN works w ON w.id=s.work_id AND w.status='held' WHERE ${b ? '(s.buyer_id=? OR s.viewer=?)' : 's.viewer=?'} ORDER BY s.at DESC LIMIT 8`).all(...(b ? [b.id, v] : [v])); lately = rows.map(r => ix.works.find(w => w.slug === r.slug)).filter(Boolean).map(row); } } catch (e) { lately = []; }
    try { if (b) { const rows = db.prepare(`SELECT w.slug FROM licenses l JOIN works w ON w.id=l.work_id AND w.status='held' WHERE l.buyer_id=? AND l.status='active' GROUP BY w.slug ORDER BY MAX(l.starts_at) DESC LIMIT 8`).all(b.id); yours = rows.map(r => ix.works.find(w => w.slug === r.slug)).filter(Boolean).map(row); } } catch (e) { yours = []; }
    const latelySet = new Set(lately.map(x => x.slug)); yours = yours.filter(x => !latelySet.has(x.slug));
    const decades = []; { const d = new Map(); for (const [y, e] of (ix.years || new Map())) { const k = Math.floor(y / 10) * 10; const x = d.get(k) || { y: k, n: 0 }; x.n += e.n; d.set(k, x); } decades.push(...[...d.values()].sort((a, b) => a.y - b.y).map(x => ({ name: `${x.y}s`, n: x.n, href: `/wander?in=decade:${x.y}` }))); }
    return { lately, yours, artists: (ix.artists || []).filter(a => a.n).slice(0, 10).map(a => ({ name: a.name, n: a.n, href: `/art/${a.slug}` })), movements: (ix.movements || []).slice(0, 8).map(m => ({ name: m.name, n: m.n, href: m.href })), kinds: (ix.kinds || []).slice(0, 8).map(k => ({ name: k.name, n: k.n, href: k.href })), decades: decades.slice(0, 16), museums: (ix.museums || []).filter(m => !m.known).slice(0, 6).map(m => ({ name: m.name, n: m.n, href: m.href })), places: ix.places.slice(0, 14).map(p => ({ name: p.name, n: p.n, href: `/wander?q=${encodeURIComponent(p.name)}` })), makers: ix.makers.slice(0, 8).map(m => ({ name: m.name, n: m.n, href: `/wander?maker=${encodeURIComponent(m.slug)}` })), rooms: ix.rooms.slice(0, 8).map(r => ({ name: r.title, n: r.n, href: `/wander?in=series:${encodeURIComponent(r.slug)}` })) };
  }
  app.get('/api/find', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    res.set('Cache-Control', 'private, no-store');
    if (!q) return res.json({ q: '', before: before(req) });
    res.json({ q, ...search(q, Math.max(1, Math.min(24, parseInt(req.query.n, 10) || 12)), req) });
  });
  app.locals.find = { search, before, index: build };
  // The page: the same search, for a typed address or no script.
  app.get('/find', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80); const r = q ? search(q, 48, req) : null; const bf = q ? null : before(req);
    const work = w => `<a class="fd-w" href="${esc(w.href)}"><img src="${esc(w.img)}" alt="" loading="lazy"><span><b>${esc(w.title)}</b><small>${esc(w.maker)}${w.place ? ` · ${esc(w.place)}` : ''}${w.year ? ` · ${esc(w.year)}` : ''}</small></span></a>`;
    const ways = (k, list) => list && list.length ? `<p class="fd-k">${k}</p><div class="fd-ways">${list.map(b => `<a class="fd-way" href="${esc(b.href)}">${b.img ? `<img src="${esc(b.img)}" alt="" loading="lazy">` : ''}<b>${esc(b.name)}</b><small>${esc([b.by, b.n ? `${b.n} work${b.n === 1 ? '' : 's'}` : null].filter(Boolean).join(' · '))}</small></a>`).join('')}</div>` : '';
    const chips = (k, list) => list && list.length ? `<p class="fd-k">${k}</p><div class="fd-chips">${list.map(x => `<a href="${esc(x.href)}">${esc(x.name)}<i>${x.n}</i></a>`).join('')}</div>` : '';
    res.set('Cache-Control', 'private, no-store').send(V.layout({ title: `${q ? `${esc(q)} · ` : ''}Find · Watermark`, path: '/find', desc: 'Find a work, a maker, a place: straight to the picture.', body: `<section class="narrow fd-page"><p class="k">Find</p><h1>Straight to the picture.</h1>
<form class="fd-form" action="/find" method="get" data-find-form><input type="search" name="q" value="${esc(q)}" placeholder="A work, an artist, a book, a place, a year, a word" aria-label="Find" autocomplete="off" autofocus enterkeyhint="go"><button>${I.next}<span>Find</span></button></form>
${r ? `${r.artistsFirst ? ways('Artists of the hall', r.artists) : ''}${r.works.length ? `<p class="fd-k">Works${r.more ? ` · ${r.works.length} of ${r.works.length + r.more}` : ''}</p><div class="fd-ws">${r.works.map(work).join('')}</div><p class="fd-go"><a class="buy-btn" href="/wander?q=${encodeURIComponent(q)}">Wander through “${esc(q)}”</a></p>` : (['artists', 'museums', 'movements', 'kinds', 'times', 'makers', 'places', 'rooms', 'films', 'books', 'records', 'doors'].some(k => (r[k] || []).length) ? '' : `<p class="fd-none">Nothing by that word yet. Try a place, a maker, or a year; or see <a href="/everything">every room</a>.</p>`)}${r.doors && r.doors.length ? `<p class="fd-k">In the house</p><div class="fd-ways">${r.doors.map(b => `<a class="fd-way" href="${esc(b.href)}"><b>${esc(b.name)}</b><small>${esc(b.by)}</small></a>`).join('')}</div>` : ''}${r.artistsFirst ? '' : ways('Artists of the hall', r.artists)}${ways('Museums', r.museums)}${chips('Movements', r.movements)}${chips('Mediums', r.kinds)}${chips('In time', r.times)}${chips('Makers', r.makers)}${chips('Places', r.places)}${chips('Rooms', r.rooms)}${ways('The Screening Room', r.films)}${r.books && r.books.length ? `<p class="fd-k">From the shelf</p><div class="fd-ways">${r.books.map(b => `<a class="fd-way" href="${esc(b.href)}"><b>${esc(b.name)}</b><small>${esc(b.by || 'A book')}</small></a>`).join('')}</div>` : ''}${r.records && r.records.length ? `<p class="fd-k">On the turntable</p><div class="fd-ways">${r.records.map(b => `<a class="fd-way" href="${esc(b.href)}"><b>${esc(b.name)}</b><small>${esc(b.by || 'A record')}</small></a>`).join('')}</div>` : ''}` : `${bf.lately.length ? `<p class="fd-k">Where you stood lately</p><div class="fd-ws">${bf.lately.map(work).join('')}</div>` : ''}${bf.yours.length ? `<p class="fd-k">Yours</p><div class="fd-ws">${bf.yours.map(work).join('')}</div>` : ''}${chips('Artists of the hall', bf.artists)}${chips('Movements', bf.movements)}${chips('Mediums', bf.kinds)}${chips('In time', bf.decades)}${chips('Museums', bf.museums)}${chips('Places', bf.places)}${chips('Makers', bf.makers)}${chips('Rooms', bf.rooms)}`}</section>` }));
  });
}
module.exports = { mountFind };
