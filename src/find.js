// Find (Will, 18 Oct: finding art is always hard; you want to see this picture again and you should get to it fast,
// not the long walk up to the Leonardo). One search for the whole house, the same everywhere: in the header of every
// page, in the stroll's bar, on / or ⌘K, and at /find. As you type, the works themselves appear, with their pictures;
// Enter opens the first; a word with no single work strolls through everything that matches. Before you type: what
// you stood before lately and what is yours (the picture you want to see again), then the ways in (places, makers,
// rooms). Typos are forgiven (trigrams); nothing personal is searched.
const ASK = require('./findask'); const { JOIN } = ASK; const TRACK = require('./track');
function mountFind(app, { db, V, I }) {
  const { esc, tidy } = V;
  let index = { at: 0, works: [], makers: [], places: [], rooms: [], hangs: [] };
  const norm = ASK.norm; const KINDS = require('./object').KINDS;
  const grams = s => { const t = ` ${s} `; const g = new Set(); for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g; };
  // A slip of the fingers: one edit (two in a long word), a swapped pair included, still finds the word.
  const near = (a, b) => { if (a === b) return true; const la = a.length, lb = b.length; if (Math.abs(la - lb) > 2) return false; const max = Math.max(la, lb) >= 7 ? 2 : 1; const d = []; for (let i = 0; i <= la; i++) { d[i] = [i]; for (let j = 1; j <= lb; j++) d[i][j] = i === 0 ? j : 0; } for (let i = 1; i <= la; i++) for (let j = 1; j <= lb; j++) { const c = a[i - 1] === b[j - 1] ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c); if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); } return d[la][lb] <= max; };
  const sim = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.sqrt(a.size * b.size); };
  const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x; };
  const shape = w => { const year = (w.taken_at || '').slice(0, 4); const fields = { title: norm(tidy(w.title)), place: norm(w.place), maker: norm(w.maker), artist: norm(w.artist), kw: norm(w.keywords), cap: norm(w.caption).slice(0, 300), year, acc: norm(w.accession) }; fields.tw = fields.title.split(' ').filter(x => !JOIN.has(x)).join(' '); return { ...w, year, title: tidy(w.title), makerSlug: V.makerSlug({ name: w.maker, handle: w.handle }), own: w.maker_kind !== 'institution', accl: String(w.accession || '').toLowerCase(), all: Object.values(fields).join(' '), f: fields, g: grams(`${fields.title} ${fields.place} ${fields.maker} ${fields.artist}`) }; };
  const FIND_DB_OVER = Number(process.env.FIND_DB_OVER || 20000);
  const isBig = () => { if (process.env.FIND_DB === '1') return true; if (process.env.FIND_DB === '0') return false; try { const n = (app.locals.kept || ((k, ms, f) => f()))('find:held', 300e3, () => db.prepare("SELECT COUNT(*) n FROM works WHERE status='held'").get().n); return n > FIND_DB_OVER; } catch (e) { return false; } }; // the count kept five minutes (9 Nov: 70 ms a time at half a million)
  // What a search reads of a work, as the database holds it; the index `works_find` (indexes.js) is on these words.
  const WORDS = "lower(coalesce(w.title,'') || ' ' || coalesce(w.place,'') || ' ' || coalesce(w.keywords,'') || ' ' || coalesce(w.accession,'') || ' ' || coalesce(substr(w.taken_at,1,4),''))";
  const COLS = 'w.id, w.slug, w.zone, w.title, w.place, w.taken_at, w.keywords, w.caption, w.accession, w.width, w.height, w.stars, w.curated, w.kind, m.name AS maker, m.handle, m.id AS maker_id, m.kind AS maker_kind, a.name AS artist';
  const like = t => '%' + String(t).replace(/[%_\\]/g, ' ') + '%';
  // The candidates of an ask (#179): every word in the work's own words, its maker's or its artist's name; a kind or a
  // decade by its column; a phrase as a phrase; a holder by its id. The words are set into the question itself
  // (letters, digits and spaces only), so the planner sees them. First the ids alone, without order, to a ceiling: an
  // ask that few works meet (most asks of several words) is answered whole from there, and one nothing meets costs a
  // single pass with no join. When the ceiling is met the word is a common one: the best by the maker's choosing and
  // stars, then two small questions for what a ceiling of starred museum objects would bury: the works of makers who
  // are not institutions, and the works whose title is exactly what was typed (index works_title_lower).
  const LIMIT = Number(process.env.FIND_CANDIDATES || 400);
  function condsOf(P, { movement = false } = {}) {
    const mk = index.makers || [], ar = index.artists || []; const conds = [];
    const mids = f => mk.filter(f).slice(0, 40).map(m => Number(m.id)).filter(Boolean);
    const aids = f => ar.filter(x => x.id && f(x)).slice(0, movement ? 300 : 60).map(x => Number(x.id)).filter(Boolean);
    for (const tk of P.toks) {
      if (tk.role === 'holder') continue;
      const t = String(tk.t).replace(/[^a-z0-9]/g, ''); if (!t) continue;
      const parts = [`${WORDS} LIKE '%${t}%'`];
      const ids = mids(m => m.nm.split(' ').some(x => x.startsWith(t)) || (t.length >= 4 && m.nm.includes(t))); if (ids.length) parts.push(`w.maker_id IN (${ids.join(',')})`);
      const as = aids(x => ((movement ? x.nm : x.nn) || '').split(' ').some(y => y.startsWith(t))); if (as.length) parts.push(`w.artist_id IN (${as.join(',')})`); // (10 Nov) a word may be the artist's name: "leonardo trattato"
      if (tk.type === 'kind' && KINDS[tk.k]) parts.push(`COALESCE(w.kind,'photograph')='${tk.k}'`);
      if (tk.type === 'decade') parts.push(`(w.taken_at >= '${Number(tk.y0)}' AND w.taken_at < '${Number(tk.y0) + 10}')`);
      conds.push(`(${parts.join(' OR ')})`);
    }
    for (const ph of P.phrases) {
      const t = String(ph).replace(/[^a-z0-9 ]/g, ''); if (!t.trim()) continue;
      const parts = [`${WORDS} LIKE '%${t}%'`];
      const ids = mids(m => ` ${m.nm} `.includes(` ${t} `)); if (ids.length) parts.push(`w.maker_id IN (${ids.join(',')})`);
      const as = aids(x => ` ${x.nn || ''} `.includes(` ${t} `)); if (as.length) parts.push(`w.artist_id IN (${as.join(',')})`);
      conds.push(`(${parts.join(' OR ')})`);
    }
    if (P.holder && P.holder.ids.size) conds.push(`w.maker_id IN (${[...P.holder.ids].map(Number).filter(Boolean).join(',')})`);
    return conds;
  }
  const FROM = `FROM works w JOIN makers m ON m.id=w.maker_id LEFT JOIN artists a ON a.id=w.artist_id WHERE w.status='held'`;
  const zoned = open => (open ? '' : " AND COALESCE(w.zone,'all')<>'mature'");
  const kept = (k, ms, f) => (app.locals.kept || ((k2, ms2, f2) => f2()))(k, ms, f);
  function candidates(P, open) {
    const conds = condsOf(P); if (!conds.length) return [];
    const where = `w.status='held'${zoned(open)} AND ${conds.join(' AND ')}`; const BEST = 'ORDER BY w.curated DESC, w.stars DESC, w.id DESC';
    return kept('find|' + where + '|' + (P.titles || []).join(','), 120e3, () => { // kept by the whole question: two different asks never share an answer
      try {
        const ids = db.prepare(`SELECT w.id FROM works w WHERE ${where} LIMIT ${LIMIT + 1}`).all().map(r => Number(r.id)).filter(Boolean);
        if (!ids.length) return [];
        if (ids.length <= LIMIT) return db.prepare(`SELECT ${COLS} ${FROM} AND w.id IN (${ids.join(',')}) LIMIT ${LIMIT}`).all().map(shape);
        const rows = db.prepare(`SELECT ${COLS} ${FROM}${zoned(open)} AND ${conds.join(' AND ')} ${BEST} LIMIT ${LIMIT}`).all(); const have = new Set(rows.map(r => Number(r.id)));
        const more = q => { for (const r of db.prepare(q).all()) if (!have.has(Number(r.id))) { have.add(Number(r.id)); rows.push(r); } };
        const inst = (index.makers || []).filter(m => m.kind === 'institution').map(m => Number(m.id)).filter(Boolean);
        if (inst.length && !P.holder) more(`SELECT ${COLS} ${FROM}${zoned(open)} AND w.maker_id NOT IN (${inst.join(',')}) AND ${conds.join(' AND ')} ${BEST} LIMIT 100`);
        const titles = (P.titles || []).map(t => String(t).replace(/[^a-z0-9 ]/g, '').trim()).filter(Boolean).map(t => `'${t}'`).join(',');
        if (titles) more(`SELECT ${COLS} ${FROM}${zoned(open)} AND lower(w.title) IN (${titles}) ${BEST} LIMIT 40`);
        const out = rows.map(shape); out.capped = true; return out;
      } catch (e) { console.error('[find]', e.message); return []; }
    });
  }
  // Does anything carry this word? Asked of the house's names first (no question at all), then one row of the database.
  function carried(t, open, works) {
    const mk = index.makers || [], ar = index.artists || [];
    if (mk.some(m => m.nm.split(' ').some(x => x.startsWith(t)) || (t.length >= 4 && m.nm.includes(t)))) return true;
    if (ar.some(x => x.id && x.n && (x.nn || '').split(' ').some(y => y.startsWith(t)))) return true;
    if (!index.big) return works.some(w => ` ${w.all}`.includes(` ${t}`) || (t.length >= 4 && w.all.includes(t)));
    const lit = String(t).replace(/[^a-z0-9]/g, ''); if (!lit) return false;
    return kept(`find?|${open ? 1 : 0}|${lit}`, 600e3, () => { try { return db.prepare(`SELECT w.id FROM works w WHERE w.status='held'${zoned(open)} AND ${WORDS} LIKE '%${lit}%' LIMIT ${LIMIT + 1}`).all().length > 0; } catch (e) { console.error('[find carried]', e.message); return true; } }); // the ceiling, not LIMIT 1: asked for one row Postgres reads the whole table to find a word nothing carries (190 ms at 100,000 works); asked for the ceiling it takes the search index (2 ms)
  }
  // A slip in a name the house knows (a maker, a place, an artist with work here): the nearest word, the commonest first.
  function mend(t) {
    if (!index.vocab) { const v = new Set(); for (const m of index.makers || []) for (const x of m.nm.split(' ')) if (x.length >= 4) v.add(x); for (const p of index.places || []) for (const x of p.nm.split(' ')) if (x.length >= 4) v.add(x); for (const a of index.artists || []) if (a.n) for (const x of (a.nn || '').split(' ')) if (x.length >= 4) v.add(x); index.vocab = [...v]; }
    for (const x of index.vocab) if (x !== t && (x[0] === t[0] || x[1] === t[1]) && near(t, x)) return x;
    return null;
  }
  // A slip of the fingers at scale: the nearest words by trigram (Postgres); a small house keeps its own way.
  function nearCandidates(nq, open) {
    if (db.kind !== 'postgres') return [];
    try { return db.prepare(`SELECT ${COLS} FROM works w JOIN makers m ON m.id=w.maker_id LEFT JOIN artists a ON a.id=w.artist_id WHERE w.status='held'${open ? '' : " AND COALESCE(w.zone,'all')<>'mature'"} AND ? <% ${WORDS} ORDER BY ? <<-> ${WORDS} LIMIT 60`).all(nq, nq).map(shape); } catch (e) { console.error('[find near]', e.message); return []; }
  }
  const bySlugs = slugs => { if (!slugs.length) return []; const rows = db.prepare(`SELECT ${COLS} FROM works w JOIN makers m ON m.id=w.maker_id LEFT JOIN artists a ON a.id=w.artist_id WHERE w.status='held' AND w.slug IN (${slugs.map(() => '?').join(',')})`).all(...slugs).map(shape); const by = new Map(rows.map(r => [r.slug, r])); return slugs.map(x => by.get(x)).filter(Boolean); };
  // (9 Nov) A large house's index is counts alone, a second or two of counting questions: the worker builds it ahead
  // (shared.js) and the website reads it; a small house builds its own, as before.
  if (app.locals.shared) app.locals.shared.register('find', { ms: Number(process.env.FIND_KEEP_S || 300) * 1000, build: () => (isBig() ? buildNow() : { small: true, at: Date.now() }) });
  function build() {
    if (Date.now() - index.at < (process.env.NODE_ENV === 'test' ? 60e3 : Number(process.env.FIND_KEEP_S || 300) * 1000)) return index; // (9 Nov) five minutes: the build reads every held work (2.7 s at 60,000)
    if (app.locals.shared && process.env.NODE_ENV !== 'test' && isBig()) { try { const ix = app.locals.shared.get('find'); if (ix && !ix.small && ix.makers) { index = { ...ix, at: Date.now() }; return index; } } catch (e) { console.error('[find] shared', e.message); } }
    return buildNow();
  }
  function buildNow() {
    // (9 Nov, the scale test: at 500,000 works this list was over a gigabyte in the website's memory and four seconds to
    // read.) Past FIND_DB_OVER works on view the works stay in the database: a search asks it for candidates (the trigram
    // index `works_find`), and the counts by maker, place, medium and year are asked as counts.
    const big = isBig();
    const works = (big ? [] : db.prepare(`SELECT w.id, w.slug, w.zone, w.title, w.place, w.taken_at, w.keywords, w.caption, w.accession, w.width, w.height, w.stars, w.curated, w.kind, m.name AS maker, m.handle, m.id AS maker_id, m.kind AS maker_kind, a.name AS artist FROM works w JOIN makers m ON m.id=w.maker_id LEFT JOIN artists a ON a.id=w.artist_id WHERE w.status='held'`).all())
      .map(shape);
    const makers = []; const seenM = new Set(); for (const w of works) if (!seenM.has(w.maker_id)) { seenM.add(w.maker_id); makers.push({ id: w.maker_id, name: w.maker, kind: w.maker_kind, slug: w.makerSlug, n: works.filter(x => x.maker_id === w.maker_id).length, nm: norm(w.maker), cover: w.slug }); }
    if (big) { try { for (const r of db.prepare("SELECT m.id, m.name, m.handle, m.kind, COUNT(*) n, MIN(w.slug) cover FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' GROUP BY m.id, m.name, m.handle, m.kind ORDER BY n DESC LIMIT 5000").all()) makers.push({ id: r.id, name: r.name, kind: r.kind, slug: V.makerSlug({ name: r.name, handle: r.handle }), n: Number(r.n), nm: norm(r.name), cover: r.cover }); } catch (e) { console.error('[find makers]', e.message); } }
    const pc = new Map(); for (const w of works) if (w.place) { const k = w.place; const e = pc.get(k) || { name: k, n: 0, nm: norm(k), cover: w.slug }; e.n++; if (w.curated) e.cover = w.slug; pc.set(k, e); }
    if (big) { try { for (const r of db.prepare("SELECT w.place AS name, COUNT(*) n, MIN(CASE WHEN COALESCE(w.zone,'all')='mature' THEN NULL ELSE w.slug END) cover FROM works w WHERE w.status='held' AND w.place IS NOT NULL AND w.place<>'' GROUP BY w.place ORDER BY n DESC LIMIT 3000").all()) pc.set(r.name, { name: r.name, n: Number(r.n), nm: norm(r.name), cover: r.cover }); } catch (e) { console.error('[find places]', e.message); } }
    const places = [...pc.values()].sort((a, b) => b.n - a.n);
    let rooms = []; try { rooms = db.prepare("SELECT c.slug, c.title, COUNT(cw.work_id) n, (SELECT w2.slug FROM collection_works x JOIN works w2 ON w2.id=x.work_id WHERE x.collection_id=c.id AND w2.status='held' ORDER BY w2.curated DESC, x.sort LIMIT 1) cover FROM collections c JOIN collection_works cw ON cw.collection_id=c.id JOIN works w ON w.id=cw.work_id AND w.status='held' WHERE c.public=1 GROUP BY c.id ORDER BY n DESC").all().map(r => ({ ...r, title: tidy(r.title), nm: norm(r.title) })); } catch (e) { rooms = []; }
    let hangs = []; try { hangs = (app.locals.hangs ? app.locals.hangs.publicHangs() : []).map(h => ({ title: h.title, href: app.locals.hangs.href(h), n: h.n, curator: h.curator, nm: norm(h.title) })); } catch (e) { hangs = []; }
    // Books and records (24 Oct: Find across everything): the shelf and the turntable answer too.
    let books = []; try { books = db.prepare("SELECT t.slug, t.title, t.author, t.kind, (t.body IS NOT NULL OR t.plates IS NOT NULL) AS readable, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 ORDER BY t.id DESC").all().map(t => ({ title: t.title, author: byName(t.author), kind: t.kind, href: t.readable ? `/read/${t.slug}` : `/library/${t.slug}`, img: t.cover ? `/img/${t.cover}/thumb` : null, nm: norm(`${t.title} ${byName(t.author)}`) })); } catch (e) { books = []; }
    try { for (const v of (app.locals.volumes ? app.locals.volumes.forFind() : [])) books.unshift({ title: v.title, author: [v.artist, `${v.n} pages, bound`].filter(Boolean).join(' · '), kind: 'volume', href: `/volume/${v.slug}`, img: v.cover ? `/img/${v.cover}/thumb` : null, nm: norm(`${v.title} ${v.artist || ''} volume codex notebook`) }); } catch (e) { /* no volumes */ }
    let records = []; try { records = db.prepare("SELECT slug, title, performer, composer, year, cover_slug, cover_url FROM recordings WHERE status='playing' ORDER BY id DESC").all().map(r => ({ title: r.title, by: [r.performer, r.composer && r.composer !== r.performer ? r.composer : null].filter(Boolean).join(' · '), year: r.year, href: `/listening/${r.slug}`, img: r.cover_slug ? `/img/${r.cover_slug}/thumb` : r.cover_url || `/listening/${encodeURIComponent(r.slug)}/label.svg`, nm: norm(`${r.title} ${r.performer || ''} ${r.composer || ''} ${r.year || ''}`) })); } catch (e) { records = []; }
    // Discover (5 Nov: "you need to be able to find books, artist profiles, all sorts of things"): the artists of the
    // hall, the museums, the movements, the mediums, the films and the years, each with a picture and a count.
    let artists = []; try { artists = db.prepare(`SELECT a.id, a.slug, a.name, a.born, a.died, a.movement, a.nationality, (SELECT COUNT(*) FROM works w WHERE w.artist_id=a.id AND w.status='held') n, (SELECT COUNT(*) FROM catalogue c WHERE c.artist_id=a.id) known, (SELECT w.slug FROM works w WHERE w.artist_id=a.id AND w.status='held' AND COALESCE(w.zone,'all')!='mature' ORDER BY w.curated DESC, w.stars DESC, w.id LIMIT 1) cover FROM artists a WHERE EXISTS (SELECT 1 FROM works w WHERE w.artist_id=a.id AND w.status='held') OR EXISTS (SELECT 1 FROM catalogue c WHERE c.artist_id=a.id) ORDER BY n DESC, known DESC`).all().map(a => ({ ...a, nm: norm(`${a.name} ${a.movement || ''} ${a.nationality || ''}`), nn: norm(a.name), g: grams(norm(a.name)) })); } catch (e) { artists = []; }
    let museums = []; try { museums = db.prepare("SELECT m.id, m.handle, m.name, m.place, m.portrait, COUNT(*) n, (SELECT w.slug FROM works w WHERE w.maker_id=m.id AND w.status='held' AND COALESCE(w.zone,'all')!='mature' ORDER BY w.curated DESC, w.stars DESC, w.id LIMIT 1) cover FROM makers m JOIN works w ON w.maker_id=m.id AND w.status='held' WHERE m.kind='institution' AND m.handle<>'the-public-domain' GROUP BY m.id ORDER BY n DESC").all().map(m => ({ id: Number(m.id), name: m.name, place: m.place, n: m.n, href: `/m/${V.makerSlug(m)}`, stroll: `/wander?maker=${encodeURIComponent(V.makerSlug(m))}`, img: m.cover ? `/img/${m.cover}/thumb` : null, nm: norm(`${m.name} ${m.place || ''}`) })); } catch (e) { museums = []; }
    try { const kp = db.prepare("SELECT k.qid, k.name, k.city, k.country, COUNT(*) n FROM keepers k JOIN catalogue c ON c.collection_qid=k.qid GROUP BY k.qid ORDER BY n DESC LIMIT 400").all(); const have = new Set(museums.map(m => m.nm)); for (const k of kp) { const nm = norm(`${k.name} ${k.city || ''} ${k.country || ''}`); if (have.has(norm(k.name))) continue; museums.push({ name: k.name, place: [k.city, k.country].filter(Boolean).join(', '), n: k.n, known: true, href: `/art/visit/${encodeURIComponent(k.qid)}`, stroll: null, img: null, nm }); } } catch (e) { /* no catalogue */ }
    const movements = []; { const mc = new Map(); for (const a of artists) if (a.movement && a.n) { const e = mc.get(a.movement) || { name: a.movement, artists: 0, n: 0, cover: a.cover }; e.artists++; e.n += a.n; if (!e.cover) e.cover = a.cover; mc.set(a.movement, e); } for (const e of mc.values()) movements.push({ ...e, nm: norm(e.name), href: `/art?movement=${encodeURIComponent(e.name)}`, stroll: `/wander?in=movement:${encodeURIComponent(e.name)}`, img: e.cover ? `/img/${e.cover}/thumb` : null }); movements.sort((a, b) => b.n - a.n); }
    const kinds = []; try { const K = require('./object').KINDS; const kc = new Map(); if (big) for (const r of db.prepare("SELECT COALESCE(w.kind,'photograph') AS k, COUNT(*) n, MIN(CASE WHEN COALESCE(w.zone,'all')='mature' THEN NULL ELSE w.slug END) cover FROM works w WHERE w.status='held' GROUP BY COALESCE(w.kind,'photograph')").all()) kc.set(r.k, { k: r.k, n: Number(r.n), cover: r.cover }); for (const w of works) { const k = w.kind || 'photograph'; const e = kc.get(k) || { k, n: 0, cover: w.slug }; e.n++; if (w.curated && w.zone !== 'mature') e.cover = w.slug; kc.set(k, e); } for (const e of kc.values()) if (K[e.k]) kinds.push({ name: `${K[e.k]}s`, k: e.k, n: e.n, nm: norm(K[e.k] + 's'), href: `/wander?in=kind:${e.k}`, stroll: `/wander?in=kind:${e.k}`, img: `/img/${e.cover}/thumb` }); kinds.sort((a, b) => b.n - a.n); } catch (e) { /* kinds are a nicety */ }
    let films = []; try { films = db.prepare("SELECT slug, title, filmmaker, year, poster_slug, poster_url FROM films WHERE status='showing' ORDER BY id DESC").all().map(f => ({ name: f.title, by: [f.filmmaker, f.year].filter(Boolean).join(', '), href: `/screening/${f.slug}`, img: f.poster_slug ? `/img/${f.poster_slug}/thumb` : f.poster_url || null, nm: norm(`${f.title} ${f.filmmaker || ''} ${f.year || ''}`) })); } catch (e) { films = []; }
    const years = new Map(); for (const w of works) { const y = parseInt(w.year, 10); if (!y) continue; const e = years.get(y) || { y, n: 0, cover: w.slug }; e.n++; if (w.curated && w.zone !== 'mature') e.cover = w.slug; years.set(y, e); }
    if (big) { try { for (const r of db.prepare("SELECT substr(w.taken_at,1,4) AS y, COUNT(*) n, MIN(CASE WHEN COALESCE(w.zone,'all')='mature' THEN NULL ELSE w.slug END) cover FROM works w WHERE w.status='held' AND w.taken_at IS NOT NULL GROUP BY substr(w.taken_at,1,4)").all()) { const y = parseInt(r.y, 10); if (y) years.set(y, { y, n: Number(r.n), cover: r.cover }); } } catch (e) { console.error('[find years]', e.message); } }
    index = { at: Date.now(), big, works, makers, places, rooms, hangs, books, records, artists, museums, movements, kinds, films, years };
    return index;
  }
  app.locals.findIndexDirty = () => { index.at = 0; };
  const imgOf = w => `/img/${w.slug}/thumb`;
  const row = w => ({ kind: 'work', slug: w.slug, title: w.title, maker: w.maker, makerSlug: w.makerSlug, place: w.place || null, year: w.year || null, img: imgOf(w), href: `/m/${w.makerSlug}/${w.slug}`, stroll: `/wander?at=${encodeURIComponent(w.slug)}` });

  // The judge (#179), the same on both roads: every word, phrase and holder must be met; then a curator's order.
  //   a word      by where it is found: an accession 12, the title 10, the place 7, the maker, the artist or the year 6,
  //               a keyword 4, the caption 2 (less for the start of a word); a kind or a decade by its column 5
  //   a phrase    in the title 14, the place 9, a name 8, the keywords 6
  //   the title exactly as typed +30; a title and its maker ("X by Y", or the words split so) +12
  //   the maker's chosen work +2, and 0.3 a star
  //   a maker's own work +4 over a museum's object: at the same closeness of match the living maker stands first
  //   (4 is more than a chosen, five-starred object's 3.5), and a closer match still wins whoever made it.
  const wordHit = (w, t) => { let ts = 0; const hit = (field, pts, prefixPts) => { if (!field) return; if (field === t) ts = Math.max(ts, pts + 4); else if (field.split(' ').some(x => x === t)) ts = Math.max(ts, pts); else if (field.split(' ').some(x => x.startsWith(t))) ts = Math.max(ts, prefixPts); else if (t.length >= 4 && field.includes(t)) ts = Math.max(ts, prefixPts * 0.6); };
    hit(w.f.title, 10, 7); hit(w.f.place, 7, 5); hit(w.f.maker, 6, 4); hit(w.f.artist, 6, 4); hit(w.f.kw, 4, 2.5); hit(w.f.cap, 2, 1); hit(w.f.year, 6, 3); hit(w.f.acc, 12, 8); return ts; };
  const inWordsOf = (field, t) => !!field && field.split(' ').some(x => x.startsWith(t));
  function judge(pool, P) {
    const scored = []; const by = P.by; const C = P.toks.filter(t => t.role !== 'holder');
    for (const w of pool) {
      let s = 0, ok = true;
      for (const tk of P.toks) {
        let ts = 0;
        if (tk.role === 'holder') ts = P.holder && P.holder.ids.has(Number(w.maker_id)) ? 6 : 0;
        else { ts = wordHit(w, tk.t); if (tk.type === 'kind' && (w.kind || 'photograph') === tk.k) ts = Math.max(ts, 5); if (tk.type === 'decade') { const y = parseInt(w.year, 10); if (y >= tk.y0 && y < tk.y0 + 10) ts = Math.max(ts, 5); } }
        if (!ts) { ok = false; break; } s += ts;
      }
      if (!ok) continue;
      for (const ph of P.phrases) { const has = f => !!f && ` ${f} `.includes(` ${ph} `); const ps = has(w.f.title) ? 14 : has(w.f.place) ? 9 : has(w.f.maker) || has(w.f.artist) ? 8 : has(w.f.kw) ? 6 : 0; if (!ps) { ok = false; break; } s += ps; }
      if (!ok || !s) continue;
      const tw = w.f.title.split(' '); const inTitle = C.filter(t => tw.includes(t.t)), name = t => inWordsOf(w.f.maker, t.t) || inWordsOf(w.f.artist, t.t);
      if (w.f.tw && ((inTitle.length && inTitle.map(t => t.t).join(' ') === w.f.tw) || P.cores.has(w.f.tw))) s += 30;
      if (by ? (C.filter(t => t.role === 'title').every(t => inWordsOf(w.f.title, t.t)) && C.filter(t => t.role === 'maker').every(name)) : (C.length >= 2 && inTitle.length && C.some(t => !tw.includes(t.t)) && C.every(t => tw.includes(t.t) || name(t)))) s += 12;
      s += (w.curated ? 2 : 0) + (w.stars || 0) * 0.3 + (w.own ? 4 : 0);
      scored.push([s, w]);
    }
    return scored.sort((a, b) => (b[0] - a[0]) || (Number(b[1].id) - Number(a[1].id))).map(x => x[1]);
  }
  // A number typed exactly (an accession number, a Watermark number) is that work, first.
  function numbered(P, open, works) {
    let out = [];
    try {
      if (P.num) out = index.big ? kept(`find#|${P.num}`, 120e3, () => db.prepare(`SELECT ${COLS} ${FROM} AND w.accession IN (?, ?) LIMIT 3`).all(P.num, P.num.toUpperCase()).map(shape)) : works.filter(w => w.accl === P.num.toLowerCase()).slice(0, 3);
      if (!out.length && P.ref) { const r = db.prepare("SELECT w.slug FROM licenses l JOIN works w ON w.id=l.work_id WHERE l.ref=? AND w.status='held'").get(P.ref); if (r) out = index.big ? bySlugs([r.slug]) : works.filter(w => w.slug === r.slug); }
    } catch (e) { console.error('[find number]', e.message); }
    return open ? out : out.filter(w => w.zone !== 'mature');
  }
  // The ask, answered (#179). All the words together first; if nothing carries them all, the phrases apart, then each
  // word that nothing carries is mended (a slip in a known name) or set aside, then the least telling word of those
  // left; then the nearest by spelling. What was set aside is said (`note`). Kept two minutes by the words as typed.
  function resolve(q, open) { const key = String(q || '').trim().slice(0, 120); return kept(`find=|${open ? 1 : 0}|${key}`, 120e3, () => resolve0(key, open)); }
  function resolve0(q, open) {
    const ix0 = build(); const P = ASK.understand(q, { museums: ix0.museums || [], KINDS });
    const note = { aside: [], mended: [], without: [], apart: false, near: false };
    if (!P.toks.length && !P.phrases.length) return { P, final: P, works: [], exact: [], pool: [], note, strictNone: false, empty: true };
    const mine = ix0.big ? [] : open ? ix0.works : ix0.works.filter(w => w.zone !== 'mature');
    const pools = new Map(); const run = p => { const pool = ix0.big ? candidates(p, open) : mine; pools.set(p, pool); return { pool, works: judge(pool, p) }; };
    const exact = numbered(P, open, mine);
    // A number typed exactly is the whole answer: the words of a number are not searched beside it.
    let { pool, works } = exact.length ? { pool: [], works: [] } : run(P); let final = P; const strictNone = !works.length && !exact.length;
    if (strictNone) {
      let cur = P;
      if (cur.phrases.length) { cur = ASK.apart(cur); const r = run(cur); if (r.works.length) { works = r.works; final = cur; note.apart = true; } }
      if (!works.length) {
        const left = []; let probes = 0;
        for (const tk of cur.toks) {
          if (tk.role === 'holder' || tk.type || tk.t.length < 3 || (ix0.big && probes >= 5) || carried(tk.t, open, mine)) { left.push(tk); continue; } // two letters are below the search index: never asked alone
          probes++; const m = tk.t.length >= 4 ? mend(tk.t) : null;
          if (m) { note.mended.push([tk.t, m]); left.push({ ...tk, t: m }); } else note.aside.push(tk.t);
        }
        if (left.length && (note.aside.length || note.mended.length)) { cur = ASK.withToks(cur, left); const r = run(cur); if (r.works.length) { works = r.works; final = cur; } }
        if (!works.length && left.length > 1) {
          // Every word is carried, never together: one is set aside, the least telling first (a year, a kind, the holder, the shortest word).
          const units = []; for (const tk of left) { if (tk.role === 'holder') { const u = units.find(x => x.holder); if (u) u.toks.push(tk); else units.push({ holder: true, toks: [tk], rank: 2 }); } else units.push({ toks: [tk], rank: tk.type === 'year' || tk.type === 'decade' ? 0 : tk.type === 'kind' ? 1 : 3 + Math.min(tk.t.length, 20) }); }
          const order = units.slice().sort((a, b) => a.rank - b.rank);
          for (const u of order.slice(0, 6)) { const p = ASK.withToks(cur, left.filter(t => !u.toks.includes(t))); const r = run(p); if (r.works.length) { works = r.works; final = p; note.without = u.toks.map(t => t.t); break; } }
          if (!works.length) for (const u of order.slice().reverse().slice(0, 3)) { const p = ASK.withToks(cur, u.toks); const r = run(p); if (r.works.length) { works = r.works; final = p; note.without = left.filter(t => !u.toks.includes(t)).map(t => t.t); break; } }
        }
        if (!works.length) { note.aside = []; note.mended = []; note.apart = false; final = P; }
      }
      const nq = P.all;
      if (!works.length && nq.length >= 4) { // a typo forgiven: a near word in the title, place or maker, else the nearest by trigram
        const toks = P.toks.map(t => t.t).concat(P.phrases.flatMap(p => p.split(' ')));
        const words = w => `${w.f.title} ${w.f.place} ${w.f.maker}`.split(' ').filter(x => x.length >= 3);
        const pool2 = ix0.big ? nearCandidates(nq, open) : mine;
        const byWord = pool2.filter(w => toks.every(t => t.length < 4 || words(w).some(x => near(t, x))));
        if (byWord.length) works = byWord.sort((a, b) => (b.curated - a.curated) || ((b.stars || 0) - (a.stars || 0)));
        else { const g = grams(nq); works = pool2.map(w => [sim(g, w.g), w]).filter(x => x[0] > 0.28).sort((a, b) => b[0] - a[0]).map(x => x[1]); }
        if (works.length) note.near = true;
      }
    }
    if (exact.length) { const got = new Set(exact.map(w => w.slug)); works = [...exact, ...works.filter(w => !got.has(w.slug))]; }
    return { P, final, works, exact, pool, note, strictNone, whole: ix0.big ? !(pools.get(final) || []).capped : works.length <= 2000 };
  }
  // What is said when a word was set aside. Every sentence here is a draft for Will.
  function sayOf(R) {
    const n = R.note; if (!R.strictNone || !R.works.length) return null;
    const qt = s => `“${s}”`; const list = a => (a.length === 1 ? qt(a[0]) : `${a.slice(0, -1).map(qt).join(', ')} or ${qt(a[a.length - 1])}`);
    if (n.near) return `Nothing carries ${qt(ASK.shown(R.P) || R.P.all)}. Showing the nearest.`;
    const out = []; const showing = ASK.shown(R.P, [...n.aside, ...n.without], n.mended);
    if (n.apart) out.push(`Nothing carries ${list(R.P.phrases)} as written. Showing the words apart.`);
    if (n.mended.length) out.push(`Read ${n.mended.map(([a, b]) => `${qt(a)} as ${qt(b)}`).join(', ')}.`);
    if (n.aside.length) out.push(`Nothing carries ${list(n.aside)}.`);
    if (n.without.length) out.push(`Nothing carries ${n.aside.length ? 'the rest' : 'all of these words'} together. Showing ${qt(showing)}, without ${list(n.without)}.`);
    else if (n.aside.length) out.push(`Showing ${qt(showing)}.`);
    return out.join(' ') || null;
  }
  // Wander by the same words (stroll.js): the ask as a condition on `w`. What Find shows, Wander walks; a movement's
  // name is also a word there. A number, or a slip forgiven, is the works themselves.
  function whereFor(q, req) {
    try {
      const open = !(req && app.locals.zone && !app.locals.zone.open(req)); const R = resolve(q, open); if (R.empty) return null;
      // Few enough to name (a number, a slip forgiven, an ask under the ceiling): the works themselves, already judged.
      if (R.works.length && (R.exact.length || R.note.near || R.whole)) return `w.id IN (${R.works.slice(0, 2000).map(w => Number(w.id)).filter(Boolean).join(',') || '0'})`;
      const conds = condsOf(R.works.length ? R.final : R.P, { movement: true }); return conds.length ? conds.join(' AND ') : null;
    } catch (e) { console.error('[find where]', e.message); return null; }
  }
  // What found nothing (#179): the words, the day and a count; no person, no address, no cookie, nothing of the device.
  // One cheap upsert on the async path, never read on a visitor's path; the Studio reads it at /studio/feedback; ninety days.
  db.exec('CREATE TABLE IF NOT EXISTS find_misses (day TEXT NOT NULL, words TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (day, words))');
  const MISS_DAYS = 90; const missed = { day: '', n: 0 };
  function miss(P) {
    const words = P.all.slice(0, 80); const day = new Date().toISOString().slice(0, 10);
    if (words.length < 3 || P.raw.includes('@') || /\d{7,}/.test(P.raw.replace(/[\s().-]/g, ''))) return; // a letter's address or a telephone number is not a search the house keeps
    if (missed.day !== day) { missed.day = day; missed.n = 0; } if (++missed.n > Number(process.env.FIND_MISSES_A_DAY || 400)) return; // a ceiling a day on each copy: a machine cannot fill the table
    const sql = 'INSERT INTO find_misses (day, words, n) VALUES (?, ?, 1) ON CONFLICT (day, words) DO UPDATE SET n = find_misses.n + 1';
    try { if (app.locals.adb) app.locals.adb.run(sql, day, words).catch(e => console.error('[find miss]', e.message)); else db.prepare(sql).run(day, words); } catch (e) { console.error('[find miss]', e.message); }
  }
  const pruneMisses = () => { try { return db.prepare('DELETE FROM find_misses WHERE day < ?').run(new Date(Date.now() - MISS_DAYS * 86400e3).toISOString().slice(0, 10)).changes; } catch (e) { console.error('[find prune]', e.message); return 0; } };
  const misses = (days = 30) => { try { return db.prepare('SELECT words, SUM(n) AS n, MAX(day) AS last FROM find_misses WHERE day >= ? GROUP BY words ORDER BY SUM(n) DESC, MAX(day) DESC, words LIMIT 100').all(new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10)); } catch (e) { return []; } };
  if (require('./role').chores && !app.locals.noTimers) { setInterval(pruneMisses, 86400e3).unref(); setTimeout(pruneMisses, 90e3).unref(); }

  function search(q, n = 12, req = null, opts = {}) {
    const open = !(req && app.locals.zone && !app.locals.zone.open(req));
    const R = resolve(q, open); const P = R.P; const nq = P.all; if (R.empty) return { works: [], makers: [], places: [], rooms: [], hangs: [] };
    const ix = build(); // the works are judged in resolve (the zone with them); here only the ways in, which carry no work
    // The words the ways in are asked by: as typed (joining words aside); a maker by the words after "by", a place
    // without the year or the kind beside it.
    const toks = P.toks.map(t => t.t).concat(P.phrases.flatMap(p => p.split(' '))); const t0 = toks[0] || '';
    const nameToks = P.by ? P.toks.filter(t => t.role === 'maker').map(t => t.t) : toks;
    const placeToks = (() => { const x = P.toks.filter(t => !t.type && t.role !== 'holder' && t.role !== 'maker').map(t => t.t); return x.length && x.length < toks.length ? x : toks; })();
    const pool = R.pool; const works = R.works;
    const starts = (nm, t) => nm === t || nm.split(' ').some(x => x.startsWith(t)) || nm.includes(t);
    let makers = ix.makers.filter(m => nameToks.every(t => starts(m.nm, t))).slice(0, 4);
    let places = ix.places.filter(p => placeToks.every(t => starts(p.nm, t))).slice(0, 6);
    const guessed = new Set(); // the ways that are only the nearest by spelling: they do not make an ask found
    if (!makers.length && !places.length && nq.length >= 4) { guessed.add('makers').add('places'); const g = grams(nq); const near = (list, k) => list.map(x => [sim(g, grams(x.nm)), x]).filter(x => x[0] > 0.4).sort((a, b) => b[0] - a[0]).slice(0, k).map(x => x[1]); places = near(ix.places, 3); makers = near(ix.makers, 2); }
    const rooms = ix.rooms.filter(r => toks.every(t => starts(r.nm, t))).slice(0, 4);
    const hangs = ix.hangs.filter(h => toks.every(t => starts(h.nm, t))).slice(0, 4);
    const inWords = (nm, t) => starts(nm, t) || nm.split(' ').some(w => w.startsWith(t));
    // The artists of the hall: by name, movement or nationality; a slip forgiven; first when the word is their name.
    let artists = (ix.artists || []).filter(a => nameToks.every(t => inWords(a.nm, t)));
    if (!artists.length && nq.length >= 4) { guessed.add('artists'); const g = grams(nq); artists = (ix.artists || []).filter(a => a.nn.split(' ').some(x => toks.some(t => t.length >= 4 && near(t, x))) || sim(g, a.g) > 0.45); }
    artists.sort((a, b) => (b.nn.startsWith(nq) - a.nn.startsWith(nq)) || (b.n - a.n) || (b.known - a.known)); artists = artists.slice(0, 5);
    const artistsFirst = !!(artists[0] && (() => { const ws = artists[0].nn.split(' '); return toks.every(t => ws.includes(t)) || (toks.length === 1 && t0.length >= 4 && ws.some(x => x.startsWith(t0) && artists[0].nn.length - t0.length < 12 && !(pool || []).some(w => w.f.title.split(' ').includes(t0)))); })());
    const museums = (ix.museums || []).filter(m => (P.holder && m.id && P.holder.ids.has(m.id)) || toks.every(t => inWords(m.nm, t))).slice(0, 4);
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
    const out = { say: sayOf(R), aside: [...R.note.aside, ...R.note.without], artistsFirst, artists: artists.map(a => ({ kind: 'artist', name: a.name, by: [a.born || a.died ? (a.born && a.died ? `${a.born}–${a.died}` : a.died ? `d. ${a.died}` : `b. ${a.born}`) : null, a.movement].filter(Boolean).join(' · ') || null, n: a.n, known: a.known, href: `/art/${a.slug}`, stroll: a.n ? `/wander/art/${a.slug}` : null, img: a.cover ? imgOf({ slug: a.cover }) : null })), museums: museums.map(({ nm, id, ...m }) => ({ kind: 'museum', by: m.place || (m.known ? 'Keeps the originals' : null), ...m })), movements: movements.map(m => ({ kind: 'movement', name: m.name, by: `${m.artists} artist${m.artists === 1 ? '' : 's'}`, n: m.n, href: m.href, stroll: m.stroll, img: m.img })), kinds: kinds.map(({ nm, ...k }) => ({ kind: 'kind', ...k })), films: films.map(({ nm, ...f }) => ({ kind: 'film', ...f })), times: times.map(t => ({ kind: 'time', ...t })), doorsFirst: !!(doors[0] && doors[0].w === 2), doors: doors.slice(0, 5).map(({ w, ...d }) => d), works: works.slice(0, n).map(row), more: Math.max(0, works.length - n), makers: makers.map(m => ({ kind: 'maker', name: m.name, n: m.n, href: `/m/${m.slug}`, stroll: `/wander?maker=${encodeURIComponent(m.slug)}`, img: imgOf({ slug: m.cover }) })), places: places.map(p => ({ kind: 'place', name: p.name, n: p.n, href: `/wander?q=${encodeURIComponent(p.name)}`, stroll: `/wander?q=${encodeURIComponent(p.name)}`, img: imgOf({ slug: p.cover }) })), rooms: rooms.map(r => ({ kind: 'room', name: r.title, n: r.n, href: `/rooms/${r.slug}`, stroll: `/wander?in=series:${encodeURIComponent(r.slug)}`, img: r.cover ? imgOf({ slug: r.cover }) : null })), hangs: hangs.map(h => ({ kind: 'wall', name: h.title, n: h.n, by: h.curator, href: h.href, stroll: h.href })), books: books.map(b => ({ kind: 'book', name: b.title, by: b.author, href: b.href, img: b.img })), records: records.map(r => ({ kind: 'record', name: r.title, by: [r.by, r.year].filter(Boolean).join(', '), href: r.href, img: r.img })) };
    // Found nothing as asked, and no other way in: the house keeps the words (a deliberate ask only: the page, Wander's bar).
    if (opts.log && R.strictNone && !['artists', 'museums', 'movements', 'kinds', 'times', 'makers', 'places', 'rooms', 'hangs', 'films', 'books', 'records', 'doors'].some(k => !guessed.has(k) && (out[k] || []).length)) miss(P);
    return out;
  }
  // Before you type: lately (what you stood before, newest first), yours, then the ways in.
  function before(req) {
    const ix = build(); const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null; const v = String((req.cookies && req.cookies.wm_v) || '').slice(0, 16);
    let lately = [], yours = [];
    try { if (b || v) { const rows = db.prepare(`SELECT w.slug FROM stood s JOIN works w ON w.id=s.work_id AND w.status='held' WHERE ${b ? '(s.buyer_id=? OR s.viewer=?)' : 's.viewer=?'} ORDER BY s.at DESC LIMIT 8`).all(...(b ? [b.id, v] : [v])); lately = (ix.big ? bySlugs(rows.map(r => r.slug)) : rows.map(r => ix.works.find(w => w.slug === r.slug)).filter(Boolean)).map(row); } } catch (e) { lately = []; }
    try { if (b) { const rows = db.prepare(`SELECT w.slug FROM licenses l JOIN works w ON w.id=l.work_id AND w.status='held' WHERE l.buyer_id=? AND l.status='active' GROUP BY w.slug ORDER BY MAX(l.starts_at) DESC LIMIT 8`).all(b.id); yours = (ix.big ? bySlugs(rows.map(r => r.slug)) : rows.map(r => ix.works.find(w => w.slug === r.slug)).filter(Boolean)).map(row); } } catch (e) { yours = []; }
    const latelySet = new Set(lately.map(x => x.slug)); yours = yours.filter(x => !latelySet.has(x.slug));
    const decades = []; { const d = new Map(); for (const [y, e] of (ix.years || new Map())) { const k = Math.floor(y / 10) * 10; const x = d.get(k) || { y: k, n: 0 }; x.n += e.n; d.set(k, x); } decades.push(...[...d.values()].sort((a, b) => a.y - b.y).map(x => ({ name: `${x.y}s`, n: x.n, href: `/wander?in=decade:${x.y}` }))); }
    return { lately, yours, artists: (ix.artists || []).filter(a => a.n).slice(0, 10).map(a => ({ name: a.name, n: a.n, href: `/art/${a.slug}` })), movements: (ix.movements || []).slice(0, 8).map(m => ({ name: m.name, n: m.n, href: m.href })), kinds: (ix.kinds || []).slice(0, 8).map(k => ({ name: k.name, n: k.n, href: k.href })), decades: decades.slice(0, 16), museums: (ix.museums || []).filter(m => !m.known && m.stroll).slice(0, 6).map(m => ({ kind: 'museum', name: m.name, by: m.place || null, n: m.n, img: m.img, href: m.stroll, stroll: m.stroll })), /* (#238) near the top, each to its own Wander */ places: ix.places.slice(0, 14).map(p => ({ name: p.name, n: p.n, href: `/wander?q=${encodeURIComponent(p.name)}` })), makers: ix.makers.slice(0, 8).map(m => ({ name: m.name, n: m.n, href: `/wander?maker=${encodeURIComponent(m.slug)}` })), rooms: ix.rooms.slice(0, 8).map(r => ({ name: r.title, n: r.n, href: `/wander?in=series:${encodeURIComponent(r.slug)}` })) };
  }
  app.get('/api/find', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    res.set('Cache-Control', 'private, no-store');
    if (!q) return res.json({ q: '', before: before(req) });
    res.json({ q, ...search(q, Math.max(1, Math.min(24, parseInt(req.query.n, 10) || 12)), req) });
  });
  app.locals.find = { search, before, index: build, WORDS, whereFor, understand: q => ASK.understand(q, { museums: build().museums || [], KINDS }), misses, pruneMisses };
  // The page: the same search, for a typed address or no script.
  app.get('/find', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80); const r = q ? search(q, 48, req, { log: !req.get('x-wm-prepare') }) : null; const any = r && (r.works.length || ['artists', 'museums', 'movements', 'kinds', 'times', 'makers', 'places', 'rooms', 'films', 'books', 'records', 'doors'].some(k => (r[k] || []).length)); const bf = q && any ? null : before(req);
    const work = w => `<a class="fd-w" href="${esc(w.href)}"><img src="${esc(w.img)}" alt="" loading="lazy"><span><b>${esc(w.title)}</b><small>${esc(w.maker)}${w.place ? ` · ${esc(w.place)}` : ''}${w.year ? ` · ${esc(w.year)}` : ''}</small></span></a>`;
    const ways = (k, list) => list && list.length ? `<p class="fd-k">${k}</p><div class="fd-ways">${list.map(b => `<a class="fd-way" href="${esc(b.href)}">${b.img ? `<img src="${esc(b.img)}" alt="" loading="lazy">` : ''}<b>${esc(b.name)}</b><small>${esc([b.by, b.n ? `${b.n} work${b.n === 1 ? '' : 's'}` : null].filter(Boolean).join(' · '))}</small></a>`).join('')}</div>` : '';
    const chips = (k, list) => list && list.length ? `<p class="fd-k">${k}</p><div class="fd-chips">${list.map(x => `<a href="${esc(x.href)}">${esc(x.name)}<i>${x.n}</i></a>`).join('')}</div>` : '';
    res.set('Cache-Control', 'private, no-store').send(V.layout({ title: `${q ? `${esc(q)} · ` : ''}Find · Watermark`, path: '/find', desc: 'Find a work, a maker, a place: straight to the picture.', body: `<section class="narrow fd-page"><p class="k">Find</p><h1>Straight to the picture.</h1>
<form class="fd-form" action="/find" method="get" data-find-form><input type="search" name="q" value="${esc(q)}" placeholder="A work, an artist, a book, a place, a year, a word" aria-label="Find" autocomplete="off" autofocus enterkeyhint="go"><button>${I.next}<span>Find</span></button></form>
${r ? `${r.say ? `<p class="fd-none"><span>${esc(r.say)}</span></p>` : ''}${r.artistsFirst ? ways('Artists of the hall', r.artists) : ''}${r.works.length ? `<p class="fd-k">Works${r.more ? ` · ${r.works.length} of ${r.works.length + r.more}` : ''}</p><div class="fd-ws">${r.works.map(work).join('')}</div><p class="fd-go"><a class="buy-btn" href="/wander?q=${encodeURIComponent(q)}">Wander through “${esc(q)}”</a></p>` : (any ? '' : `<p class="fd-none"><span>Nothing by that word yet. Try a place, a maker, or a year; <a href="/wander">wander</a>; or see <a href="/everything">every room</a>.</span></p>${chips('Places', bf.places)}${chips('Makers', bf.makers)}${chips('In time', bf.decades)}`)}${r.doors && r.doors.length ? `<p class="fd-k">In the house</p><div class="fd-ways">${r.doors.map(b => `<a class="fd-way" href="${esc(b.href)}"><b>${esc(b.name)}</b><small>${esc(b.by)}</small></a>`).join('')}</div>` : ''}${r.artistsFirst ? '' : ways('Artists of the hall', r.artists)}${ways('Museums', r.museums)}${chips('Movements', r.movements)}${chips('Mediums', r.kinds)}${chips('In time', r.times)}${chips('Makers', r.makers)}${chips('Places', r.places)}${chips('Rooms', r.rooms)}${ways('The Screening Room', r.films)}${r.books && r.books.length ? `<p class="fd-k">From the shelf</p><div class="fd-ways">${r.books.map(b => `<a class="fd-way" href="${esc(b.href)}"><b>${esc(b.name)}</b><small>${esc(b.by || 'A book')}</small></a>`).join('')}</div>` : ''}${r.records && r.records.length ? `<p class="fd-k">On the turntable</p><div class="fd-ways">${r.records.map(b => `<a class="fd-way" href="${esc(b.href)}"><b>${esc(b.name)}</b><small>${esc(b.by || 'A record')}</small></a>`).join('')}</div>` : ''}` : `${ways('Museums', bf.museums)}${bf.lately.length ? `<p class="fd-k">Where you stood lately</p><div class="fd-ws">${bf.lately.map(work).join('')}</div>` : ''}${bf.yours.length ? `<p class="fd-k">Yours</p><div class="fd-ws">${bf.yours.map(work).join('')}</div>` : ''}${chips('Artists of the hall', bf.artists)}${chips('Movements', bf.movements)}${chips('Mediums', bf.kinds)}${chips('In time', bf.decades)}${chips('Places', bf.places)}${chips('Makers', bf.makers)}${chips('Rooms', bf.rooms)}`}</section>` }));
  });
}
module.exports = { mountFind };
