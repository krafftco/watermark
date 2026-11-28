// The stroll (Will, 17 Oct: seeing photographs has to be as easy as Instagram, and as hard to put down, but the
// photographs have to be the most beautiful in the world). Watermark on a phone as a full-screen vertical scroll:
// one photograph fills the screen on the dark wall; a swipe brings the next; it never repeats what you have seen;
// the best work comes first and what you stand before shapes what comes next. Double-tap zooms in; the hat is on the rail. A rail
// of acts on the right; a plate at the foot; a search up top to stroll through one place or one maker.
const { esc } = require('./views');

const I = require('./icons');
let HOUSE = null; // the app, for the page's screens (strollPage is outside the mount)
function mountStroll(app, { db, V, wanderJSON, I }) {
  HOUSE = app;
  const PAGE = 8;
  // (20 Nov, #117) Wander's data doors and pages ask through the async path (src/adb.js, docs/SCALE.md stage 2): the
  // thread serves others while the database answers. Helpers from other modules (wanderJSON, buyerOf, the bench, the
  // pocket, looking) still ask on the bridge until their own modules move.
  const adb = app.locals.adb || require('./adb').open(db);
  // What comes next: never what this stroll has shown (up to 300 slugs carried by the client), the best first with a
  // little chance in it, and when there is a word, only what matches it (place, title, maker, keywords).
  // (9 Nov) By handle first, one row; a page slug that is not the handle is found in a light list kept a minute.
  let mkList = { at: 0, rows: Promise.resolve([]) };
  const makerBy = async key => { if (!key) return null; const h = await adb.get('SELECT * FROM makers WHERE handle=?', String(key)); if (h) return h;
    if (Date.now() - mkList.at > (process.env.NODE_ENV === 'test' ? 0 : 60e3)) mkList = { at: Date.now(), rows: adb.all('SELECT id, name, handle FROM makers').catch(() => []) };
    const m = (await mkList.rows).find(x => V.makerSlug(x) === key); return m ? adb.get('SELECT * FROM makers WHERE id=?', m.id) : null; };
  // (16 Nov, #70) POOL_MAX 4,000 (it was 20,000: a slice of 16,000 rows read on the website every two minutes at the
  // scale gate's size). The open wander's pool, the one every stranger draws from, is built by the worker (shared.js)
  // and read here as one kept row; a word's or a maker's pool is built here, its POOL_MAX best.
  const POOL_MAX = Number(process.env.WANDER_POOL_MAX || 4000);
  const POOL = new Map(); const POOL_MS = process.env.NODE_ENV === 'test' ? 0 : Number(process.env.WANDER_POOL_S || 120) * 1000; app.locals.wanderPoolDirty = () => POOL.clear();
  // A pool: id, slug and the two weights. The open wander's (sliced, on the worker) takes every Kth work past POOL_MAX,
  // a different slice each time it is remade, so the whole wall comes round; a word's or a maker's is their POOL_MAX
  // best by the maker's grade (in an index's order, so a museum of 60,000 is not read whole on the website).
  function poolRows(where, params, sliced) {
    let slice = '';
    if (sliced) { let total = 0; try { total = Number(db.prepare(`SELECT COUNT(*) n FROM works w JOIN makers m ON m.id=w.maker_id WHERE ${where}`).get(...params).n); } catch (e) { total = 0; } const K = Math.ceil(total / POOL_MAX); if (K > 1) slice = ` AND (w.id % ${K}) = ${Math.floor(Math.random() * K)}`; }
    return db.prepare(`SELECT w.id, w.slug, w.curated, w.stars FROM works w JOIN makers m ON m.id=w.maker_id WHERE ${where}${slice}${sliced ? '' : ' ORDER BY w.curated DESC, w.stars DESC, w.id DESC'} LIMIT ${POOL_MAX}`).all(...params);
  }
  const openWhere = zoneOpen => "w.status='held'" + (zoneOpen ? '' : " AND COALESCE(w.zone,'all')='all'") + (app.locals.editSql ? app.locals.editSql('w') : '');
  // (28 Nov, #238; Will: the open Wander honours the makers of the past as well as the living, "get people interested
  // in Monet and Leonardo and Vincent van Gogh") The past among the living: WANDER_PAST_SHARE of the open Wander's
  // pictures (a draft, one in three; '1/3' or 0.33; 0 is the open Wander as it was) are works held by the museums
  // and the public domain (makers.kind 'institution'), graded or not, that pass the hall rule and the wall standard.
  // The living's pool is the edit without them, so the share is the share. The past's pool is built ahead beside it,
  // by the worker: PAST_RUNS short runs of neighbours, each begun at a place chosen afresh in one museum's wall (a
  // museum is chosen by the length of its wall), read in the order of works_maker_id and never further than PAST_FAR
  // rows on, so no statement walks a museum and the whole comes round. Works with an artist's name are kept alone
  // when there are enough of them (a visitor's memory of 300, or a pool if smaller).
  const PAST = (() => { const v = String(process.env.WANDER_PAST_SHARE == null ? '1/3' : process.env.WANDER_PAST_SHARE).trim(); const m = /^(\d+)\s*\/\s*(\d+)$/.exec(v); const x = m ? (+m[2] ? +m[1] / +m[2] : 0) : Number(v); return Number.isFinite(x) ? Math.max(0, Math.min(0.9, x)) : 1 / 3; })();
  const PAST_RUNS = 32, PAST_FAR = 20, PAST_ENOUGH = Math.min(300, POOL_MAX);
  const LIVING = PAST ? " AND COALESCE(m.kind,'')<>'institution'" : '';
  function pastRows(zoneOpen) {
    if (!PAST) return [];
    const each = Math.max(1, Math.floor(POOL_MAX / PAST_RUNS)); const walls = [];
    for (const m of db.prepare("SELECT id FROM makers WHERE kind='institution' ORDER BY id LIMIT 200").all()) {
      const lo = db.prepare('SELECT id FROM works WHERE maker_id=? ORDER BY id LIMIT 1').get(m.id), hi = lo && db.prepare('SELECT id FROM works WHERE maker_id=? ORDER BY id DESC LIMIT 1').get(m.id);
      if (lo && hi) walls.push({ id: Number(m.id), lo: Number(lo.id), n: Number(hi.id) - Number(lo.id) + 1 });
    }
    const all = walls.reduce((a, x) => a + x.n, 0); if (!all) return [];
    const run = db.prepare(`SELECT w.id, w.slug, w.curated, w.stars, w.artist_id FROM works w WHERE w.maker_id=? AND w.id >= ? AND w.id < ? AND w.status='held'${zoneOpen ? '' : " AND COALESCE(w.zone,'all')='all'"}${app.locals.museums ? app.locals.museums.hallSql('w') : require('./wall').sql('w')} ORDER BY w.id LIMIT ${each}`);
    const got = new Map();
    for (let i = 0; i < PAST_RUNS; i++) { let r = Math.random() * all, m = walls[0]; for (const x of walls) { if (r < x.n) { m = x; break; } r -= x.n; } const from = m.lo + Math.floor(Math.random() * m.n); for (const w of run.all(m.id, from, from + each * PAST_FAR)) got.set(Number(w.id), w); }
    const rows = [...got.values()], named = rows.filter(w => w.artist_id != null);
    return (named.length >= PAST_ENOUGH ? named : rows).map(w => ({ id: w.id, slug: w.slug, curated: w.curated, stars: w.stars }));
  }
  if (app.locals.shared) for (const zoneOpen of [false, true]) {
    app.locals.shared.register(`wander-pool${zoneOpen ? '-open' : ''}`, { ms: POOL_MS || 120e3, build: () => poolRows(openWhere(zoneOpen) + LIVING, [], true) });
    app.locals.shared.register(`wander-past${zoneOpen ? '-open' : ''}`, { ms: POOL_MS || 120e3, build: () => pastRows(zoneOpen) });
  }
  // (28 Nov, #238) A museum's wander comes round the whole of what it holds. A maker's pool was their POOL_MAX best by
  // grade, then newest: a museum of 60,000 ungraded works only ever showed its newest 4,000. For an institution with
  // more held than one pool, the pool is WINDOWS runs of neighbours begun at places chosen afresh each time it is
  // remade (every two minutes), each read in the order of works_maker_id (maker_id, id): POOL_MAX rows at most, a few
  // hundred a statement, and never a walk of the museum. Whether it is that large (one bounded step down
  // works_maker_best) and where its wall begins and ends are kept ten minutes. Anyone else's pool is as it was.
  const WINDOWS = 8, SPAN = new Map(), SPAN_MS = process.env.NODE_ENV === 'test' ? 0 : 600e3;
  async function wallSpan(makerId) {
    const hit = SPAN.get(makerId); if (hit && Date.now() - hit.at < SPAN_MS) return hit.v;
    let v = null;
    try {
      const past = await adb.get(`SELECT w.id FROM works w WHERE w.maker_id=? AND w.status='held' ORDER BY w.curated, w.stars, w.id LIMIT 1 OFFSET ${POOL_MAX}`, makerId);
      if (past) { const [lo, hi] = await Promise.all([adb.get('SELECT w.id FROM works w WHERE w.maker_id=? ORDER BY w.id LIMIT 1', makerId), adb.get('SELECT w.id FROM works w WHERE w.maker_id=? ORDER BY w.id DESC LIMIT 1', makerId)]); if (lo && hi) v = { lo: Number(lo.id), hi: Number(hi.id) }; }
    } catch (e) { v = null; }
    SPAN.set(makerId, { at: Date.now(), v }); if (SPAN.size > 200) SPAN.delete(SPAN.keys().next().value);
    return v;
  }
  async function windows(where, params, span) {
    const each = Math.max(1, Math.floor(POOL_MAX / WINDOWS)); const got = new Map();
    const runs = await Promise.all(Array.from({ length: WINDOWS }, () => adb.all(`SELECT w.id, w.slug, w.curated, w.stars FROM works w JOIN makers m ON m.id=w.maker_id WHERE ${where} AND w.id >= ? ORDER BY w.id LIMIT ${each}`, ...params, span.lo + Math.floor(Math.random() * (span.hi - span.lo + 1)))));
    for (const run of runs) for (const r of run) got.set(Number(r.id), r);
    return [...got.values()];
  }
  async function next(req, { seen = [], q = '', maker = '', n = PAGE } = {}) {
    const not = seen.slice(-300); const params = [];
    let where = "w.status='held'" + (app.locals.zone ? app.locals.zone.sql(req) : '') + (!q && !maker && app.locals.editSql ? app.locals.editSql('w') : '');
    // A word (5 Nov: a place, a title, a maker, an artist, a movement or a year). (9 Nov) Asked of the work's own words
    // under the search index, and of the makers and artists by their ids: seven LIKEs across every row took 1.7 s at
    // 500,000 works.
    // (20 Nov, #179) The words are read as Find reads them ("the seine by will fullerton", a phrase, a year, a holder):
    // what Find shows, Wander walks. Without Find, the old way: the whole of what was typed, as one word.
    const asked = q && app.locals.find && app.locals.find.whereFor ? app.locals.find.whereFor(q, req) : null;
    if (asked) where += ` AND ${asked}`;
    else if (q) { const t = q.replace(/[%_]/g, ''); const like = `%${t}%`; const W = app.locals.find && app.locals.find.WORDS ? app.locals.find.WORDS : "lower(coalesce(w.title,'') || ' ' || coalesce(w.place,'') || ' ' || coalesce(w.keywords,''))";
      const [mids, aids] = await Promise.all([adb.all('SELECT id FROM makers WHERE name LIKE ? LIMIT 60', like).then(r => r.map(x => Number(x.id)), () => []), adb.all('SELECT id FROM artists WHERE name LIKE ? OR movement LIKE ? LIMIT 300', like, like).then(r => r.map(x => Number(x.id)), () => [])]);
      const lit = t.toLowerCase().replace(/[^\p{L}\p{N} .,&-]/gu, ' ').trim(); // set into the question itself (no quote, no wildcard can remain), so the planner sees the word: a parameter gave a common word a blind plan
      where += ` AND (${W} LIKE '%${lit}%'${mids.length ? ` OR w.maker_id IN (${mids.join(',')})` : ''}${aids.length ? ` OR w.artist_id IN (${aids.join(',')})` : ''})`; }
    const mk = await makerBy(maker); if (mk) { where += ' AND w.maker_id=?'; params.push(mk.id); }
    const span = mk && !q && mk.kind === 'institution' ? await wallSpan(mk.id) : null; // (#238) a museum larger than a pool: its whole wall comes round
    // The pool (28 Oct; light since 9 Nov): id, slug and the two weights, kept two minutes, for the open wander and now
    // for a word or a maker too. Never more than POOL_MAX rows: past that the open wander takes every Kth work, a
    // different slice each time the pool is remade, so the whole collection comes round and the website holds a
    // fixed amount whatever the collection's size.
    const key = where + '|' + JSON.stringify(params); let pool = POOL.get(key);
    const zs = app.locals.zone ? app.locals.zone.sql(req) : '';
    let past = [];
    if (!q && !mk && app.locals.shared && where === openWhere(!zs)) { pool = { rows: app.locals.shared.get(`wander-pool${zs ? '' : '-open'}`) }; if (PAST) try { past = app.locals.shared.get(`wander-past${zs ? '' : '-open'}`) || []; } catch (e) { past = []; } } // the open wander: built ahead
    else if (!pool || Date.now() - pool.at > POOL_MS) { // the promise is kept, so everyone arriving while it is asked shares one question
      const p = span ? windows(where, params, span) : adb.all(`SELECT w.id, w.slug, w.curated, w.stars FROM works w JOIN makers m ON m.id=w.maker_id WHERE ${where} ORDER BY w.curated DESC, w.stars DESC, w.id DESC LIMIT ${POOL_MAX}`, ...params);
      pool = { at: Date.now(), rows: p }; const mine0 = pool; p.catch(() => { if (POOL.get(key) === mine0) POOL.delete(key); });
      POOL.set(key, pool); if (POOL.size > 24) POOL.delete(POOL.keys().next().value); }
    const poolRowsNow = await pool.rows;
    const notSet0 = new Set(not); const cands = []; for (const r of poolRowsNow) if (!notSet0.has(r.slug)) cands.push({ id: r.id, k: (r.curated ? 4 : r.stars >= 4 ? 3 : r.stars >= 3 ? 1.5 : 1) * (0.5 + Math.random()) });
    cands.sort((x, y) => y.k - x.k); let ids = cands.slice(0, n).map(x => x.id);
    // (#238) The past among the living: its share of this page, set evenly through it and never on the first two
    // screens (the living come first); where one side has run out, the other carries on.
    if (past.length) {
      const pc = []; for (const r of past) if (!notSet0.has(r.slug)) pc.push({ id: r.id, k: (r.curated ? 4 : r.stars >= 4 ? 3 : r.stars >= 3 ? 1.5 : 1) * (0.5 + Math.random()) }); pc.sort((x, y) => y.k - x.k);
      const want = n * PAST; let k = Math.floor(want) + (Math.random() < want - Math.floor(want) ? 1 : 0); k = Math.min(pc.length, Math.max(k, n - cands.length));
      const live = cands.slice(0, n - k).map(x => x.id), old = pc.slice(0, k).map(x => x.id); ids = [];
      const at = new Set(old.map((_, j) => Math.floor((j + 1) * n / (k + 1))));
      for (let i = 0; ids.length < live.length + old.length; i++) { if ((at.has(i) || !live.length) && old.length) ids.push(old.shift()); else if (live.length) ids.push(live.shift()); else if (old.length) ids.push(old.shift()); }
    }
    const full = ids.length ? await adb.all(`SELECT * FROM works WHERE id IN (${ids.map(() => '?').join(',')}) AND status='held'`, ...ids) : []; const byId = new Map(full.map(w => [Number(w.id), w]));
    const rows = ids.map(i => byId.get(Number(i))).filter(Boolean);
    // For you: when the house knows what held this visitor, a few of the eye's picks are set among the rest.
    let picks = [];
    if (!q && !mk && app.locals.looking && app.locals.buyerOf) {
      try { const b = app.locals.buyerOf(req), v = req.cookies && req.cookies.wm_v; if (b || v) { const c = app.locals.looking.candidates(b, v, 24, 8); const notSet = new Set(not); const pk = c.picks.filter(x => !notSet.has(x.slug) && !rows.find(r => r.slug === x.slug)).slice(0, 3).map(x => Number(x.id)); const got = pk.length ? await adb.all(`SELECT * FROM works WHERE id IN (${pk.map(() => '?').join(',')})`, ...pk) : []; const gotBy = new Map(got.map(w => [Number(w.id), w])); picks = pk.map(i => gotBy.get(i)).filter(Boolean); } } catch (e) { picks = []; }
    }
    const out = []; let pi = 0;
    for (let i = 0; i < rows.length && out.length < n; i++) { if (pi < picks.length && i % 3 === 1) out.push(picks[pi++]); out.push(rows[i]); }
    while (pi < picks.length && out.length < n) out.push(picks[pi++]);
    const items = out.slice(0, n).map(w => wanderJSON(w, req));
    // Wander across everything (Will, 24 Oct, after StumbleUpon): in the open wander, every sixth screen or so is a
    // page from the shelf, a chapter's opening set on the wall, with Read on. Never in a set, a word or a maker's walk.
    if (!q && !mk && items.length >= 4 && !require('./views').isQuiet()) { const r0 = Math.random(); let t = null; try { t = (r0 < 0.3 && app.locals.sheets && process.env.SHEETS_IN_WANDER === '1' ? app.locals.sheets.screen(seen) : null) || (r0 < 0.65 ? await textScreen(seen) : await recordScreen(seen)); } catch (e) { screenFault(e); } if (t) items.splice(3 + Math.floor(Math.random() * Math.min(3, items.length - 3)), 0, t); }
    return items;
  }
  // A page from the shelf: a public book with a body, a chapter at random, its first paragraphs.
  const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x; };
  const CLOTH = ['#2f4a3a', '#5a1f22', '#23304d', '#6b4b2a', '#8a7a52', '#3b4a5a', '#4a3350', '#7a5a2a']; const hashOf = x => { let h = 7; for (const ch of String(x)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  // A record from the Listening Room (Will, 24 Oct: Wander across everything): the disc on the wall, one side to play here.
  async function recordScreen(seen) {
    let r; try { r = await adb.get("SELECT slug, title, performer, composer, year, line, files, cover_slug, cover_url FROM recordings WHERE status='playing' ORDER BY RANDOM() LIMIT 1"); } catch (e) { return null; }
    if (!r) return null; const slug = `r:${r.slug}`; if (seen.includes(slug)) return null;
    let files = []; try { files = JSON.parse(r.files || '[]'); } catch (e) { /* */ } if (!files.length) return null;
    const img = r.cover_slug ? `/img/${r.cover_slug}/screen` : r.cover_url || `/listening/${encodeURIComponent(r.slug)}/label.svg`;
    return { kind: 'record', slug, record: r.slug, title: r.title, by: r.performer || r.composer || '', composer: r.composer && r.composer !== r.performer ? r.composer : '', year: r.year || '', line: r.line || '', img, url: files[0].url, side: files[0].title || 'Side A', href: `/listening/${r.slug}?play=1`, n: files.length };
  }
  // The shelf is read once in five minutes (28 Oct, for an audience: each feed page had sorted every book at random and
  // read a whole body); one book's chapters are cut once and kept, the first two hundred books at a time.
  const SHELF = { at: 0, ids: [] }; const CHAPTERS = new Map();
  async function shelfBook() {
    if (Date.now() - SHELF.at > 300e3) { SHELF.at = Date.now(); SHELF.ask = adb.all("SELECT t.id FROM texts t WHERE t.status='held' AND t.public=1 AND COALESCE(t.subscribers_only,0)=0 AND t.kind IN ('book','essay') AND t.body IS NOT NULL AND length(t.body) > 3000 ORDER BY t.id DESC LIMIT 2000").then(r => r.map(x => x.id), () => []); }
    if (SHELF.ask) SHELF.ids = await SHELF.ask;
    if (!SHELF.ids.length) return null;
    const id = SHELF.ids[Math.floor(Math.random() * SHELF.ids.length)]; const kept = CHAPTERS.get(id); if (kept && Date.now() - kept.at < 3600e3) return kept;
    const t = await adb.get("SELECT t.slug, t.title, t.author, t.body, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.id=?", id); if (!t) return null;
    const chs = []; let cur = { head: null, paras: [] };
    for (const p of String(t.body).split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) { if (/^##?\s/.test(p)) { if (cur.head || cur.paras.length) chs.push(cur); cur = { head: p.replace(/^#+\s*/, ''), paras: [] }; } else if (p !== '* * *') cur.paras.push(p); }
    if (cur.head || cur.paras.length) chs.push(cur);
    const good = chs.map((c, i) => ({ head: c.head, paras: c.paras.slice(0, 6), i })).filter(c => c.paras.join(' ').length > 400);
    const out = { at: Date.now(), t: { slug: t.slug, title: t.title, author: t.author, cover: t.cover }, chs: good, n: chs.length };
    CHAPTERS.set(id, out); if (CHAPTERS.size > 200) CHAPTERS.delete(CHAPTERS.keys().next().value); return out;
  }
  app.locals.shelfDirty = () => { SHELF.at = 0; CHAPTERS.clear(); };
  async function textScreen(seen) {
    const book = await shelfBook(); if (!book) return null; const { t, chs, n } = book;
    const good = chs; if (!good.length) return null;
    const c = good[Math.floor(Math.random() * good.length)]; const slug = `t:${t.slug}:${c.i}`; if (seen.includes(slug)) return null;
    const ex = []; let len = 0; for (const p of c.paras) { if (len > 520) break; ex.push(p); len += p.length; }
    return { kind: 'text', slug, book: t.slug, title: t.title, author: byName(t.author), cloth: CLOTH[(hashOf(t.title || t.slug) >>> 7) % CLOTH.length], head: c.head || null, c: c.i, excerpt: ex.map(p => p.replace(/\*([^*\n]{1,200}?)\*/g, '$1')), href: `/read/${t.slug}?c=${c.i}`, cover: t.cover ? `/img/${t.cover}/screen` : null, n };
  }
  // A set (Will, 18 Oct: the stroll everywhere): tapping a photograph in the collection, an artist, a gallery, a wall or a
  // series on a phone strolls through that set alone, in its own order, from the photograph tapped; the end says so.
  const setOf = key => (key && app.locals.walk ? app.locals.walk.list(String(key).slice(0, 80)) : null);
  // 'mine' (Will, 19 Oct: flip through your own gallery as beautifully as the archive, and get there fast): the
  // signed-in person's gallery, in collector order; private to them. A maker's own held work is 'studio'.
  function mine(req, key) {
    if (key === 'mine') {
      const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null; if (!b) return null;
      const v = setOf('gallery:' + b.code) || { works: [] };
      // Rembrandt's room first: a maker's own five-star work hangs in their gallery, then what they collect.
      let hand = []; try { hand = app.locals.ownHand ? app.locals.ownHand(b, req) : []; } catch (e) { hand = []; }
      const seen = new Set(); const works = [...hand, ...v.works].filter(w => !seen.has(w.slug) && seen.add(w.slug));
      return { label: 'Your gallery', href: '/yours', works };
    }
    if (key === 'following') return app.locals.museums ? app.locals.museums.set(req) : null; // 29 Oct: what the people you follow did lately
    if (key === 'studio') { const m = app.locals.accounts ? app.locals.accounts.makerOf(req) : null; if (!m) return null; const v = setOf('maker:' + m.handle); return v ? Object.assign({}, v, { label: 'Your work', href: '/account' }) : null; }
    // A delivery (Will, 21 Oct: the friend wanders the album as one wanders the house; the work stays the maker's):
    // the album's photographs, held or kept back, in the album's order, for as long as the link is live.
    if (key.startsWith('delivery:')) return app.locals.deliveries && app.locals.deliveries.set ? app.locals.deliveries.set(key.slice(9)) : null;
    if (key.startsWith('album:')) return app.locals.deliveries && app.locals.deliveries.set ? app.locals.deliveries.set(key.slice(6), true, req) : null;
    return setOf(key);
  }
  const isDelivery = key => /^(delivery|album):/.test(String(key || ''));
  const carried = (j, tq) => (tq && j ? Object.assign({}, j, { img: j.img + tq, thumb: j.thumb + tq }) : j);
  async function inSet(req, key, { seen = [], at = '', n = PAGE } = {}) {
    const v = mine(req, key); if (!v || !v.works.length) return null;
    const slugs = v.works.map(w => w.slug), not = new Set(seen);
    let i = slugs.indexOf(at || seen[seen.length - 1]); if (i < 0) i = -1;
    const out = [];
    for (let k = 1; k <= slugs.length && out.length < n; k++) { const sl = slugs[(i + k) % slugs.length]; if (!not.has(sl) && sl !== at) { out.push(sl); not.add(sl); } }
    // One question for the page's few (it was one a slug), set back in the set's order.
    const got = out.length ? await adb.all(`SELECT * FROM works WHERE slug IN (${out.map(() => '?').join(',')}) AND ${isDelivery(key) ? "status IN ('held','hidden')" : "status='held'"}`, ...out) : [];
    // (#198) An album's pictures carry its own address (?token=); in any other set a work off view shows only to those it is for.
    const OV = app.locals.offView, tq = isDelivery(key) && v.via ? '?token=' + encodeURIComponent(v.via) : '';
    const bySlug = new Map(got.map(w => [w.slug, w])); const rows = out.map(sl => bySlug.get(sl)).filter(Boolean).filter(w => tq || !OV || !OV.off(w) || OV.may(req, w));
    return { label: v.label, href: v.href, n: slugs.length, via: v.via || null, files: v.files || null, has: new Set(slugs), tq, items: rows.map(w => carried(wanderJSON(w, req), tq)) };
  }
  app.get('/api/stroll', async (req, res) => {
    const seen = String(req.query.seen || '').split(',').filter(Boolean);
    const q = String(req.query.q || '').trim().slice(0, 60), maker = String(req.query.maker || '').slice(0, 60);
    const n = Math.max(1, Math.min(16, parseInt(req.query.n, 10) || PAGE));
    if (req.query.in === 'shelf') { const CP = app.locals.commonplace; let items = []; try { items = CP ? CP.passages(seen, n) : []; } catch (e) { console.error('[shelf]', e.message); /* (#126) the shelf never fails Wander */ } return res.set('Cache-Control', 'no-store').json({ items, end: items.length < n, label: 'The shelf', href: '/library' }); }
    if (req.query.in) { const r = await inSet(req, req.query.in, { seen, n }); if (r) return res.set('Cache-Control', 'no-store').json({ items: r.items, end: r.items.length < n, label: r.label, href: r.href }); }
    const items = await next(req, { seen, q, maker, n });
    res.set('Cache-Control', 'no-store').json({ items, q, maker });
  });
  // The ways in (18 Oct: Find should never be an empty box): the places, the makers and the series held, with counts.
  app.get('/api/stroll/ways', (req, res) => {
    const places = db.prepare("SELECT place AS name, COUNT(*) n FROM works WHERE status='held' AND place IS NOT NULL AND place!='' GROUP BY place ORDER BY n DESC, place LIMIT 24").all();
    const makers = db.prepare("SELECT m.id, m.name, COUNT(*) n FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND COALESCE(m.kind,'') NOT IN ('writer','gallery') GROUP BY m.id, m.name ORDER BY n DESC LIMIT 12").all().map(m => ({ name: m.name, slug: V.makerSlug(m), n: m.n }));
    let series = []; try { series = db.prepare("SELECT s.slug, s.title, COUNT(sw.work_id) n FROM series s JOIN series_works sw ON sw.series_id=s.id JOIN works w ON w.id=sw.work_id AND w.status='held' WHERE s.public=1 GROUP BY s.id ORDER BY n DESC LIMIT 12").all(); } catch (e) { series = []; }
    res.set('Cache-Control', 'public, max-age=300').json({ places, makers, series });
  });
  // The doors beside the stroll (Will, 19 Oct: swipe left and right must bring you somewhere meaningful: into the Keys,
  // and from there your gallery and the collection; and into your wallet, as a maker or a collector, with a switch).
  // One answer per work, rendered for whoever is signed in: `keys` (the right-hand door) and `yours` (the left-hand).
  app.get('/stroll/side/:slug', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const w = await adb.get("SELECT w.*, m.name AS maker_name, m.handle AS maker_handle, m.portrait AS maker_portrait, m.kind AS maker_kind FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.slug=? AND w.status='held'", String(req.params.slug));
    const isInst = !!w && ['institution', 'company'].includes(String(w.maker_kind || '')); // once, from the work's own row (it was asked three times)
    const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null, m = app.locals.accounts ? app.locals.accounts.makerOf(req) : null;
    const K = app.locals.keys, B = app.locals.bench, R = app.locals.balcony, P = app.locals.pocket;
    const held = K ? K.holds(req) : {}; const kinds = Object.keys(held).filter(k => k !== 'house');
    const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
    const door = (href, kicker, title, line, img) => `<a class="sd-door" href="${esc(href)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}<span><small>${esc(kicker)}</small><b>${esc(title)}</b>${line ? `<i>${esc(line)}</i>` : ''}</span>${I.next || ''}</a>`;
    // The Keys' door.
    let keys = '';
    if (w) {
      const n = B ? B.count('work', w.id) : 0, ls = B ? B.lines('work', w.id).slice(0, 2) : [];
      const st = R ? R.state() : null; const open = st && st.open;
      keys = `<header class="sd-h sd-keys-h">${K && K.MARK ? K.MARK.mark : ''}<p>${kinds.length ? `You hold ${kinds.map(k => `the ${k}’s key, No. ${held[k].no}`).join(' and ')}.` : 'Keys are earned, never bought.'}</p></header>
<section class="sd-sec"><p class="k">Under this work</p><h3>The bench</h3>${ls.length ? `<ol class="sd-lines">${ls.map(l => `<li><b>${esc(l.name)}</b> ${esc(l.body.length > 140 ? l.body.slice(0, 137) + '…' : l.body)}</li>`).join('')}</ol>` : '<p class="sd-m">No one has spoken yet. Stand before it a minute, then sit.</p>'}<a class="sd-go" href="/bench/${esc(w.slug)}">${n ? `${n} line${n === 1 ? '' : 's'} · Sit on the bench` : 'Sit on the bench'} →</a></section>
<section class="sd-sec"><p class="k">The Keys’ room</p><h3>The balcony</h3><p class="sd-m">${open ? `Open now${st.present && st.present.n ? ` · ${st.present.n} here` : ''}${st.host ? ` · ${esc(st.host.name)} hosting` : ''}. Nothing said is kept.` : 'Opens at nine in the evening, New York time, and closes at midnight.'}</p><a class="sd-go" href="/balcony">${open ? 'Go up' : 'Look in'} →</a></section>
${(() => { const S = app.locals.season, nx = S ? S.next() : null; return nx ? `<section class="sd-sec sd-night"><p class="k">The season · next</p><h3><a href="/season/${esc(nx.slug)}">${esc(nx.title)}</a></h3><p class="sd-m">${esc(S.when(nx.at))}${nx.city ? ` · ${esc(nx.city)}` : ''}. In the real world. <a href="/season">The season →</a></p></section>` : `<section class="sd-sec sd-night"><p class="k">The season</p><p class="sd-m">The nights the house throws, in the real world. <a href="/season">The season</a> · <a href="/club">The Club</a></p></section>`; })()}
<div class="sd-doors">${door('/m/' + w.maker_handle, 'The maker', w.maker_name, 'Their page, their archive, their studio', w.maker_portrait ? '/portrait/' + w.maker_handle : '/img/' + w.slug + '/thumb')}${door(b ? '/yours' : '/signin?next=/yours', 'Yours', 'Your gallery', b ? 'What you hold, your walls, your papers' : 'Sign in to open it')}${door('/collection', 'The museum', 'The collection', 'Every work, the wings, the masterworks')}${door('/keys', 'The house', 'The Keys', 'The club, its rules, and the story since 1947')}</div>`;
    }
    // Your door: the wallet, as a maker or a collector.
    let yours = '';
    if (!b && !m) yours = `<header class="sd-h"><p class="k">Yours</p><h3>Your gallery, your wallet.</h3><p class="sd-m">Sign in and what you hold, your pocket and your walls are one swipe away.</p><a class="buy-btn" href="/signin?next=/wander">Sign in</a></header>`;
    else {
      const bal = P && b ? P.balance(b) : 0, cash = P && b ? P.cashable(b) : 0;
      const [pieces, nHeld, walls] = b ? await Promise.all([adb.all("SELECT w.slug, w.title FROM licenses l JOIN works w ON w.id=l.work_id WHERE l.buyer_id=? AND l.status='active' AND w.status='held' ORDER BY l.id DESC LIMIT 6", b.id), adb.get("SELECT COUNT(*) n FROM licenses WHERE buyer_id=? AND status='active'", b.id).then(r => r.n), adb.get('SELECT COUNT(*) n FROM hangs WHERE buyer_id=?', b.id).then(r => r.n)]) : [[], 0, 0];
      const basket = String((req.cookies && req.cookies.wm_bk) || '').split(',').filter(Boolean).length;
      const collector = `<div class="sd-pane" data-sd-as="collector">
<section class="sd-wallet"><p class="k">Your pocket</p><p class="sd-sum">${money(bal)}</p><p class="sd-m">${cash >= 100 ? `${money(cash)} earned, yours to cash out.` : 'One tap collects from it.'}</p><div class="sd-row"><a href="/yours?tab=settings#pocket">Top up</a>${cash >= 100 ? '<a href="/yours?tab=settings#pocket">Cash out</a>' : ''}</div></section>
<section class="sd-sec"><p class="k">Your gallery · ${nHeld}</p>${pieces.length ? `<a class="sd-stroll" href="/wander?in=mine${w ? '' : ''}">${I.wave || ''}<b>Wander your gallery</b><i>Your pieces, one at a time, edge to edge</i></a><div class="sd-th">${pieces.map(p => `<a href="/yours" title="${esc(p.title)}"><img src="/img/${esc(p.slug)}/thumb" alt=""></a>`).join('')}</div>` : '<p class="sd-m">Nothing yet. Collect what stops you.</p>'}<a class="sd-go" href="/yours">Open your gallery →</a></section>
<div class="sd-doors">${door('/yours?tab=walls', 'Yours', walls ? `${walls} wall${walls === 1 ? '' : 's'}` : 'Your walls', 'Hang what you love, show it')}${basket ? door('/basket', 'Yours', `Basket · ${basket}`, 'Collect them all at once') : ''}${door('/yours?tab=papers', 'Yours', 'Your papers', 'Licenses, certificates, the register')}${door('/collection', 'The museum', 'The collection', 'Every work, the wings, the masterworks')}</div></div>`;
      let maker = '';
      if (m) {
        const st = app.locals.payouts ? app.locals.payouts.statement(m) : null;
        const [waiting, nw, np, month] = await Promise.all([adb.get("SELECT COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status='requested'", m.id).then(r => r.n), adb.get("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status IN ('held','hidden')", m.id).then(r => r.n), adb.get("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'", m.id).then(r => r.n), adb.get("SELECT COALESCE(SUM(price_cents),0) s, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0 AND l.starts_at >= date('now','start of month')", m.id)]);
        maker = `<div class="sd-pane" data-sd-as="maker" hidden>
<section class="sd-wallet"><p class="k">Owed to you</p><p class="sd-sum">${money(st ? st.owed : 0)}</p><p class="sd-m">${month.n ? `${month.n} sale${month.n === 1 ? '' : 's'} this month, ${money(Math.round(month.s * (st ? st.pct : 85) / 100))} yours.` : 'No sales yet this month.'}${m.stripe_account ? '' : ' Add a bank to be paid.'}</p><div class="sd-row"><a href="/account/payouts">The statement</a>${m.stripe_account ? '' : '<a href="/account/payouts">Your bank</a>'}</div></section>
<div class="sd-doors">${door('/account/requests', 'Your desk', waiting ? `${waiting} waiting` : 'Requests', waiting ? 'Answer them in a minute each' : 'All clear')}${door('/account', 'Your studio', `${np} of ${nw} shown`, 'The edit is the work')}${door('/account/upload', 'The vault', 'Add work', 'Put work in')}${door('/m/' + m.handle, 'Your page', m.name, 'As the house shows you')}</div></div>`;
      }
      yours = `<header class="sd-h"><p class="k">Yours</p><h3>${esc((m && m.name) || (b && b.name) || 'Your wallet')}</h3>${m ? `<div class="sd-sw" role="tablist"><button type="button" data-sd-switch="collector" aria-selected="true">Collector</button><button type="button" data-sd-switch="maker" aria-selected="false">Maker</button></div>` : ''}</header>${collector}${maker}`;
    }
    // The house, from inside Wander (Will, 26 Oct: "you have to be able to access Read and Listen"): the five verbs at the top of the Yours door.
    let reading = 0; try { reading = b ? (await adb.get("SELECT COUNT(*) n FROM reading_list WHERE buyer_id=? AND status='reading'", b.id)).n : 0; } catch (e) { reading = 0; }
    const verbs = `<nav class="sd-verbs" aria-label="The house">${[
      ...(() => { const F = app.locals.museums; const n = F && F.meOf(req) ? F.followed(req).length : 0; return [n ? ['/wander?in=following', 'Look', `Following · ${n}`, I.wave || ''] : ['/wander', 'Look', 'Wander everything', I.wave || '']]; })(),
      ...(require('./views').isQuiet() ? [] : [[reading ? '/yours/reading' : '/wander?in=shelf', 'Read', reading ? `${reading} book${reading === 1 ? '' : 's'} open` : 'Wander the shelf', I.facing || I.page || ''],
      ['/listening', 'Listen', 'The Listening Room', I.play || '']]),
      ['/collection', 'Collect', 'The collection', I.collect || ''],
      [m ? '/account' : '/makers', 'Make', m ? 'Your studio' : 'For those who make', I.pencil || I.plus || '']
    ].map(([h, v, l, ic]) => `<a href="${h}"><span class="sd-vi">${ic}</span><b>${v}</b><i>${esc(l)}</i></a>`).join('')}</nav>`;
    yours = yours.replace(/<\/header>/, '</header>' + verbs);
    // Who made it (Will, 5 Nov): the swipe left opens the person behind the picture, as TikTok trained everyone to
    // expect; their face first, so it is plainly someone, then their work, Follow, and the way into all of it.
    let who = '';
    if (w) {
      const A = app.locals.art; const LL = app.locals.lifeline;
      const art = w.artist_id && A ? await adb.get('SELECT * FROM artists WHERE id=?', w.artist_id) : null;
      const strip = (ws, key) => ws.length ? `<div class="whp-strip">${ws.map(x => `<a href="/wander?at=${esc(x.slug)}&in=${esc(key)}" aria-label="${esc(V.tidy(x.title))}"><img src="/img/${esc(x.slug)}/thumb" alt="" loading="lazy"></a>`).join('')}</div>` : '';
      const first = t => { const p = String(t || '').split(/\n{2,}/)[0].trim(); return p.length > 280 ? p.slice(0, 277).replace(/\s\S*$/, '') + '…' : p; };
      if (art && isInst) {
        const [ws, n] = await Promise.all([adb.all("SELECT slug, title FROM works WHERE artist_id=? AND status='held' AND slug<>? ORDER BY curated DESC, stars DESC, id LIMIT 9", art.id, w.slug), adb.get("SELECT COUNT(*) n FROM works WHERE artist_id=? AND status='held'", art.id).then(r => r.n)]);
        const dates = LL ? LL.dateWords(art) : null;
        const face = ws[0] ? `/img/${ws[0].slug}/thumb` : `/img/${w.slug}/thumb`;
        who = `<header class="whp-h"><img class="whp-face whp-face-w" src="${esc(face)}" alt=""><div><p class="k">The artist</p><h3>${esc(art.name)}</h3><p class="whp-l">${[dates, art.nationality, art.movement].filter(Boolean).map(esc).join(' · ')}</p></div></header>
${art.bio ? `<p class="whp-bio">${esc(first(art.bio))}</p>` : ''}
<p class="whp-n">${n} work${n === 1 ? '' : 's'} in the house</p>${strip(ws, 'artist:' + art.slug)}
<div class="whp-acts"><a class="whp-go" href="/wander/art/${esc(art.slug)}">${I.wave || ''}<b>Wander their work</b></a><a class="whp-pg" href="/art/${esc(art.slug)}">Their page ${I.next}</a></div>
${isInst ? `<p class="whp-by">Photographed for the house by <a href="/m/${esc(V.makerSlug({ handle: w.maker_handle, name: w.maker_name }))}">${esc(w.maker_name)}</a>.</p>` : ''}`;
      } else {
        const mk = await adb.get('SELECT * FROM makers WHERE id=?', w.maker_id);
        const slugM = V.makerSlug(mk);
        const [ws, n] = await Promise.all([adb.all("SELECT slug, title FROM works WHERE maker_id=? AND status='held' AND slug<>? ORDER BY curated DESC, stars DESC, id DESC LIMIT 9", mk.id, w.slug), adb.get("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'", mk.id).then(r => r.n)]);
        const lt = LL ? LL.text(mk) : null;
        const line = lt ? [lt.years, lt.atWork ? 'at work' : null, lt.verified ? 'Verified' : null].filter(Boolean).join(' · ') : (mk.place || '');
        const fol = app.locals.museums && !isInst ? app.locals.museums.button('maker:' + mk.id) : '';
        const face = mk.portrait ? `/portrait/${esc(mk.handle)}` : `/img/${esc(w.slug)}/thumb`;
        who = `<header class="whp-h"><img class="whp-face${mk.portrait ? '' : ' whp-face-w'}" src="${face}" alt=""><div><p class="k">${isInst ? 'The collection' : 'The maker'}</p><h3>${esc(mk.name)}</h3>${line ? `<p class="whp-l">${esc(line)}</p>` : ''}</div></header>
${mk.bio ? `<p class="whp-bio">${esc(first(mk.bio))}</p>` : ''}
<p class="whp-n">${n} work${n === 1 ? '' : 's'} on view</p>${strip(ws, 'maker:' + mk.handle)}
<div class="whp-acts">${fol}<a class="whp-go" href="/wander?maker=${esc(slugM)}">${I.wave || ''}<b>Wander their work</b></a><a class="whp-pg" href="/m/${esc(slugM)}">Their page ${I.next}</a></div>`;
      }
    }
    // About (Will, 6 Nov: "it should get you more about the work"; 28 Nov, #241: the side, the shield and the record
    // said the same work three times). One scroll, said once: the work, who made it, then the Watermark record (what
    // the shield's sheet showed: its number, the copyright, how the maker is paid, who holds it, its terms, the proof).
    // The shield on the plate opens this side at the record (`data-st-rec`).
    let about = '';
    if (w) {
      const A = app.locals.art; const art = A && A.ofWork ? (() => { try { return A.ofWork(w); } catch (e) { return null; } })() : null;
      const by = art && isInst ? art.name : w.maker_name;
      const year = String(w.obj_made || '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[1] || (w.taken_at || '').slice(0, 4) || '';
      const c = app.locals.closerOf ? app.locals.closerOf(w) : null;
      const para = t => { const p = String(t || '').split(/\n{2,}/).map(x => x.trim()).filter(Boolean)[0] || ''; return p.length > 520 ? p.slice(0, 517).replace(/\s\S*$/, '') + '…' : p; };
      const words = c && c.text ? para(c.text) : para(w.caption);
      const look = c && c.study && !c.studyHidden && Array.isArray(c.study.look) ? c.study.look.slice(0, 3) : [];
      const ovw = app.locals.onview ? await app.locals.onview.plate(w, req).catch(() => '') : ''; // (#166) where a living maker's object is on view
      let kept = null; try { const CT = app.locals.catalogue; const r = CT && CT.rowOfWork ? CT.rowOfWork(w) : null; if (r && r.collection) { const k = r.collection_qid && CT.keeper ? CT.keeper(r.collection_qid) : null; kept = { name: r.collection, where: [k && k.city, k && k.country].filter(Boolean).join(', '), qid: r.collection_qid }; } } catch (e) { kept = null; }
      const facts = [['Made', [year, w.place].filter(Boolean).join(' · ')], ['Medium', w.medium], ['Size', w.obj_dims], ['Kept at', kept ? [kept.name, kept.where].filter(Boolean).join(', ') : ''], ['Accession', w.accession]].filter(f => f[1]);
      const rec = `/m/${esc(V.makerSlug({ handle: w.maker_handle, name: w.maker_name }))}/${esc(w.slug)}?from=wander`;
      const openW = ['pd', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc'].includes(w.open || '');
      about = `<header class="wka-h"><p class="k">The work</p><h3>${esc(V.tidy(w.title))}</h3><p class="wka-by">${esc(by)}${year ? `, ${esc(year)}` : ''}</p></header>
${facts.length ? `<dl class="wka-f">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
${words ? `<section class="wka-s"><p class="k">${c && c.text ? 'Look closer' : 'About it'}</p><p class="wka-t">${esc(words)}</p></section>` : ''}
${look.length ? `<section class="wka-s"><p class="k">What to look for</p><ol class="wka-l">${look.map(x => `<li><b>${esc(x.what)}</b>${x.why ? ` <span>${esc(x.why)}</span>` : ''}</li>`).join('')}</ol></section>` : ''}
${kept && kept.qid ? `<p class="wka-m">The original hangs at ${esc(kept.name)}. <a href="/art/visit/${esc(kept.qid)}">See it in person</a></p>` : ''}
${ovw}${c && c.study && !c.studyHidden ? `<div class="wka-acts"><a class="whp-pg" href="${rec.replace('?from=wander', '')}#study">The study ${I.next}</a></div>` : ''}
<p class="k wka-who">Who made it</p>`;
      // The record: one reading (eye.js), the same the sheet on a work's own page gives. The title, the maker, the place
      // and the year are above and are not said again.
      let d = null; try { d = app.locals.eye ? app.locals.eye.of(w) : null; } catch (e) { console.error('[wander record]', e.message); d = null; }
      const row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '');
      const record = `<section class="wka-rec" data-st-rec tabindex="-1" aria-label="The Watermark record"><p class="k">The Watermark record</p>
<p class="wka-rl">${openW ? 'In the public domain: free for everyone to look at, share and print.' : 'A registered work: numbered, fingerprinted, on the house’s register, held under lock and key and shown in the open. Look as long as you like. To use it, in a story, a campaign, a product or on a wall, license it here: the maker is paid, and the licence travels inside the file.'}</p>
${d ? `<dl class="wka-rd">${row('Its number', `<span class="wka-no">${esc(d.number)}</span>`)}${row('Copyright', esc(d.copyright))}${row('The maker is paid', esc(d.paid))}${row('Held', esc(d.held))}${d.open ? row('Free to use', 'Open to everyone, with the credit.') : row('To use it, license it', (d.uses || []).map(u => `<a class="wka-u" href="${esc(u.href)}"><b>${esc(u.name)}</b><i>${esc(u.price)}</i></a>`).join(''))}${row('Never', (d.never || []).map(esc).join(' · '))}${row('Proof', `${esc(d.proof)} <a href="${esc(d.life)}">Its life</a> · <a href="${esc(d.verify)}">Check a copy</a>`)}</dl>` : ''}
<div class="wka-acts"><a class="whp-go" href="${rec}">${I.shield || ''}<b>The full record</b></a></div></section>`;
      who = about + who + record + `<p class="whp-x">Swipe right to go back to the picture.</p>`;
    }
    // Where next (#241; Will, 28 Nov: "nothing in Wander shows where one could go next"): the left-hand side. From the
    // picture on screen, at most six ways onward, each a tile (a cover, a name, a count) and one press into that Wander:
    // the same hand, the same collection, the same movement, the same time, the same place, the same kind; then the
    // standing doors. A way is shown only when it holds FEW or more. Nothing here walks the collection: the names, the
    // counts and the covers are Find's index (find.js, built ahead); a small set (under SMALL by the index) is counted
    // as its own Wander counts it (walk.js's list, the wall standard with it), kept ten minutes, so the tile's number is
    // what the press lands in. What More like this had (6 Nov) and is kept: the strip by the same hand, under its tile.
    let like = '';
    {
      const kept = app.locals.kept || ((k, ms, f) => f()); const SAFE0 = "status='held' AND COALESCE(zone,'all')!='mature'";
      const FEW = 4, SMALL = 400, nf = n => Number(n).toLocaleString('en-US');
      let ix = null; try { ix = app.locals.find && app.locals.find.index ? app.locals.find.index() : null; } catch (e) { console.error('[where next]', e.message); ix = null; }
      const ways = []; let strip = '';
      if (w && ix) {
        const WK = app.locals.walk;
        // A set as its Wander holds it: how many, and two covers (so the tile need not show the picture you are on).
        const held = key => kept('next-n|' + key, 600e3, () => { try { const v = WK ? WK.list(key) : null; return v ? { n: v.works.length, covers: v.works.slice(0, 2).map(x => x.slug) } : { n: 0, covers: [] }; } catch (e) { return { n: 0, covers: [] }; } });
        // A cover from the index is shown only if it is on view and not behind the door (one row by its slug, kept).
        const fine = slug => (slug ? kept('next-c|' + slug, 600e3, () => adb.get(`SELECT slug FROM works WHERE slug=? AND ${SAFE0}`, slug).then(r => !!r, () => false)) : false);
        const setWay = async (k, name, key, n0, cover0) => {
          if (!(n0 >= FEW)) return;
          if (n0 <= SMALL) { const h = held(key); if (h.n < FEW) return; ways.push({ k, name, n: h.n, cover: h.covers.find(x => x !== w.slug) || h.covers[0], href: `/wander?in=${encodeURIComponent(key)}` }); return; }
          ways.push({ k, name, n: n0, cover: cover0 && cover0 !== w.slug && await fine(cover0) ? cover0 : null, href: `/wander?in=${encodeURIComponent(key)}` });
        };
        const art = w.artist_id ? (ix.artists || []).find(a => Number(a.id) === Number(w.artist_id)) : null;
        // The same hand: the artist of a museum's object, or the living maker. Its strip is the first row.
        let hand = null;
        if (art) { await setWay('By the same hand', art.name, 'artist:' + art.slug, art.n, art.cover); if (ways.length) hand = ['artist:' + art.slug, 'artist_id=?', art.id]; }
        else if (!isInst) { const mk = (ix.makers || []).find(x => Number(x.id) === Number(w.maker_id)); if (mk && mk.n >= FEW) { ways.push({ k: 'By the same hand', name: w.maker_name, n: mk.n, cover: mk.cover && mk.cover !== w.slug && await fine(mk.cover) ? mk.cover : null, href: `/wander?maker=${encodeURIComponent(V.makerSlug({ handle: w.maker_handle, name: w.maker_name }))}` }); hand = ['maker:' + w.maker_handle, 'maker_id=?', w.maker_id]; } }
        if (hand) {
          const ws = (await kept('like-r|' + hand[1] + '|' + hand[2], 600e3, () => adb.all(`SELECT slug, title FROM works WHERE ${SAFE0} AND ${hand[1]} ORDER BY curated DESC, stars DESC, id DESC LIMIT 9`, hand[2]).catch(() => []))).filter(x => x.slug !== w.slug).slice(0, 4);
          if (!ways[0].cover && ws[0]) ways[0].cover = ws[0].slug;
          if (ws.length === 4) strip = `<div class="lk-s"><div class="whp-strip">${ws.map(x => `<a href="/wander?at=${esc(x.slug)}&in=${encodeURIComponent(hand[0])}" aria-label="${esc(V.tidy(x.title))}"><img src="/img/${esc(x.slug)}/thumb" alt="" loading="lazy"></a>`).join('')}</div></div>`;
        }
        // The same collection: a museum's or a company's own work in the house.
        if (isInst) { const mu = (ix.museums || []).find(x => x.id && Number(x.id) === Number(w.maker_id) && x.stroll); if (mu && mu.n >= FEW) { const cv = mu.img ? mu.img.replace(/^\/img\/|\/thumb$/g, '') : null; ways.push({ k: 'The same collection', name: mu.name, n: mu.n, cover: cv && cv !== w.slug && await fine(cv) ? cv : null, href: mu.stroll }); } }
        if (art && art.movement) { const mv = (ix.movements || []).find(x => x.name === art.movement); if (mv) await setWay('The same movement', mv.name, 'movement:' + mv.name, mv.n, mv.cover); }
        // The same time: the decade, or the century when the decade holds too few.
        const yr = String(w.taken_at || '').match(/^(\d{3})\d/);
        if (yr && ix.years) {
          const span = (y0, len) => { let n = 0, cover = null; for (let y = y0; y < y0 + len; y++) { const e = ix.years.get(y); if (e) { n += e.n; if (!cover) cover = e.cover; } } return { n, cover }; };
          const d0 = +yr[1] * 10, c0 = Math.floor(d0 / 100) * 100; const before = ways.length;
          const dec = span(d0, 10); await setWay('The same time', `The ${d0}s`, 'decade:' + String(d0).padStart(4, '0'), dec.n, dec.cover);
          if (ways.length === before && c0 >= 100) { const cen = span(c0, 100); const c = c0 / 100 + 1; const sfx = [11, 12, 13].includes(c % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][c % 10] || 'th'; await setWay('The same time', `The ${c}${sfx} century`, 'century:' + c0, cen.n, cen.cover); }
        }
        if (w.place) { const pl = (ix.places || []).find(x => x.name === w.place); if (pl) await setWay('The same place', pl.name, 'place:' + pl.name, pl.n, pl.cover); }
        { const kd = (ix.kinds || []).find(x => x.k === (w.kind || 'photograph')); if (kd) await setWay('The same kind', kd.name, 'kind:' + kd.k, kd.n, String(kd.img || '').replace(/^\/img\/|\/thumb$/g, '')); }
      }
      const tile = (x, i) => `<a class="wnx-t${i === 0 ? ' wnx-w' : ''}" href="${esc(x.href)}">${x.cover ? `<img src="/img/${esc(x.cover)}/${i === 0 ? 'screen' : 'thumb'}" alt="" loading="lazy">` : '<span class="wnx-e"></span>'}<span class="wnx-c"><small>${esc(x.k)}</small><b>${esc(x.name)}</b><i>${nf(x.n)} work${x.n === 1 ? '' : 's'}</i></span></a>`;
      // The standing doors: the same four whatever the picture, each only if the house has it.
      const nMus = ix ? (ix.museums || []).filter(x => !x.known && !/the public domain/i.test(x.name)).length : 0, nArt = ix ? (ix.artists || []).filter(a => a.n).length : 0;
      const doors = [nMus ? ['/look#museums', 'Museums', nf(nMus)] : null, nArt ? ['/art', 'Artists', nf(nArt)] : null, ix && ix.years && ix.years.size ? ['/look#time', 'In time', ''] : null, ['/look', 'Discover', '']].filter(Boolean);
      like = `<header class="wka-h">${w ? `<p class="k">From ${esc(V.tidy(w.title))}</p>` : ''}<h3>Where next</h3></header>
${ways.length ? `<nav class="wnx" aria-label="Ways on from this work">${ways.slice(0, 6).map((x, i) => tile(x, i) + (i === 0 ? strip : '')).join('')}</nav>` : ''}
<nav class="wnx-d" aria-label="Elsewhere in the house"><p class="k">Elsewhere in the house</p>${doors.map(([h, name, n]) => `<a class="wnx-door" href="${h}"><b>${name}</b>${n ? `<i>${n}</i>` : ''}${I.next || ''}</a>`).join('')}</nav>
<p class="whp-x">Swipe left to go back to the picture.</p>`;
    }
    res.json({ keys, yours, who, like });
  });

  // The old address: one word, Wander (Will, 21 Oct). Links in the wild and the app's cache still say /stroll.
  app.get('/stroll', (req, res) => res.redirect(301, '/wander' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));
  // The front door is Wander (Will, 26 Oct, the Jobs cut: one name on the door; `/` opens on the picture; the page
  // about the house is /house). A tenant's `/` was rewritten to its maker's page before this.
  // A stranger's first page of Wander is built once every fifteen seconds (28 Oct, for an audience); anyone the house knows is built fresh.
  const brief = h => (req, res, next) => (app.locals.minute ? app.locals.minute(h, 15e3) : h)(req, res, next);
  app.get('/', brief((req, res) => wander(req, res, { front: true })));
  app.get('/wander', brief((req, res) => wander(req, res, {})));
  // An artist's wander, at an address worth sending (Will, 2 Nov: "make it where you can share an artist wander"):
  // /wander/art/<slug> walks the artist's wall, in the order made, and unfurls as the artist's own card.
  app.get('/wander/art/:slug', brief((req, res) => {
    const A = app.locals.art; const a = A && A.bySlug ? A.bySlug(String(req.params.slug)) : null; if (!a) return res.redirect('/art');
    // The show first, when one is open (5 Nov: a tight show, not twelve thousand works); ?all=1 walks everything.
    const sh = req.query.all === '1' || !app.locals.shows ? null : app.locals.shows.showOf(a);
    const h = sh || (A.wall ? A.wall(a) : null); if (!h) return res.redirect(`/art/${a.slug}`);
    // What is sent is the artist's own page (Will, 2 Nov): the life, the dates, the work in order; never the wall.
    return wander(req, res, { key: `hang:${h.slug}`, as: { label: a.name, href: `/art/${a.slug}` }, share: { url: `/art/${a.slug}`, image: `/art/${a.slug}/card.png`, title: a.name, text: `${a.name}${a.born || a.died ? ` (${a.born || ''}–${a.died || ''})` : ''}: the life and the work, in the order it was made.` } });
  }));
  // A set worth sending: public walls, a maker's work, a series, the collection; never a private room or an album.
  const SHAREABLE = k => /^(hang|maker|series|year|decade|century|place|movement|kind|artist):[^\s]+$/.test(k) || /^(collection|arrived|open|stood|living)$/.test(k);
  // The first name of whoever is signed in, for a flower's card; nothing else of them.
  const meFirst = req => { try { const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null; const m = app.locals.accounts ? app.locals.accounts.makerOf(req) : null; const n = String((m && m.name) || (b && b.name && !/collection$/i.test(b.name) ? b.name : '') || '').trim().split(/\s+/)[0] || ''; return /^[\p{L}'’.-]{1,24}$/u.test(n) ? n : ''; } catch (e) { return ''; } };
  // Sent (Will, 5 Nov: "when someone gets a link they open it and are stunned at the beauty, then can do more"; "here,
  // I found something for you"; "whatever is right for Watermark and Krafft"). A work sent to someone opens alone, in
  // the dark, with the giver's first name and, if they wrote one, their line; then the house. The recipient may send one
  // back, and only then is the giver told. Nothing is counted or followed; a sending is a row so the link stays short
  // and the line stays out of the address.
  db.exec(`CREATE TABLE IF NOT EXISTS sendings (id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, work_id INTEGER NOT NULL, from_name TEXT, note TEXT, buyer_id INTEGER, maker_id INTEGER, reply_to INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const okName = n => { const x = String(n || '').trim().split(/\s+/)[0].slice(0, 24); return /^[\p{L}'’.-]{1,24}$/u.test(x) ? x : ''; };
  const okNote = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 160).replace(/https?:\/\/\S+/gi, '').trim();
  const sendSlow = new Map();
  // The only word back to a giver: someone they sent a work to chose to send one in return.
  function tellBack(back, workId, _u, { from, note, token }) {
    if (!back || !(back.buyer_id || back.maker_id) || !app.locals.notify) return;
    const w = db.prepare('SELECT slug, title FROM works WHERE id=?').get(workId); if (!w) return;
    try { app.locals.notify.tell({ buyer_id: back.buyer_id || null, maker_id: back.buyer_id ? null : back.maker_id, kind: 'found', slug: w.slug, href: `/found/${token}`, title: `${from || 'Someone'} sent you one back`, body: `${V.tidy(w.title)}${note ? ` · “${note}”` : ''}` }); } catch (e) { /* the sending stands */ }
  }
  app.post('/send', (req, res) => {
    const b = req.body || {}; const w = db.prepare("SELECT id, slug, title, zone FROM works WHERE slug=? AND status='held'").get(String(b.slug || ''));
    if (!w) return res.status(404).json({ error: 'not held' });
    const n = (sendSlow.get(req.ip) || 0) + 1; sendSlow.set(req.ip, n); if (n > 60) return res.status(429).json({ error: 'slow' }); if (sendSlow.size > 5000) sendSlow.clear();
    const buyer = app.locals.buyerOf ? app.locals.buyerOf(req) : null, mk = app.locals.accounts ? app.locals.accounts.makerOf(req) : null;
    const from = okName(b.name) || meFirst(req); const note = okNote(b.note);
    const back = b.reply ? db.prepare('SELECT * FROM sendings WHERE token=?').get(String(b.reply).slice(0, 40)) : null;
    const token = require('crypto').randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO sendings (token, work_id, from_name, note, buyer_id, maker_id, reply_to) VALUES (?,?,?,?,?,?,?)').run(token, w.id, from || null, note || null, buyer ? buyer.id : null, mk ? mk.id : null, back ? back.id : null);
    if (back) tellBack(back, w.id, null, { from, note, token });
    const url = `${(process.env.BASE_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`}/found/${token}`;
    res.set('Cache-Control', 'no-store').json({ url, title: V.tidy(w.title), text: note ? `${note}` : 'I found something for you.' });
  });
  app.post('/send/:token/note', (req, res) => {
    const s = db.prepare('SELECT * FROM sendings WHERE token=?').get(String(req.params.token).slice(0, 40)); if (!s) return res.sendStatus(404);
    if (Date.now() - Date.parse(String(s.at).replace(' ', 'T') + 'Z') > 30 * 60e3) return res.sendStatus(409); // only while it is being sent
    const b = req.body || {}; const note = okNote(b.note), name = okName(b.name);
    db.prepare('UPDATE sendings SET note=COALESCE(?, note), from_name=COALESCE(?, from_name) WHERE id=?').run(note || null, name || null, s.id);
    const back = b.reply && !s.reply_to ? db.prepare('SELECT * FROM sendings WHERE token=?').get(String(b.reply).slice(0, 40)) : null;
    if (back) { db.prepare('UPDATE sendings SET reply_to=? WHERE id=?').run(back.id, s.id); tellBack(back, s.work_id, token => token, { from: name || s.from_name, note: note || s.note, token: s.token }); }
    res.sendStatus(204);
  });
  const openSent = (req, res, next, s) => {
    const w = db.prepare("SELECT slug, zone FROM works WHERE id=? AND status='held'").get(s.work_id); if (!w) return next();
    if (w.zone === 'mature' && app.locals.zone && !app.locals.zone.open(req)) return res.redirect(`/w/${w.slug}`); // the door first
    res.set('Cache-Control', 'private, no-store'); // (req.query cannot be written in Express 5: the work goes in by hand)
    return wander(req, res, { at: w.slug, gift: { from: s.from_name || '', note: s.note || '', token: s.token || '' } });
  };
  app.get('/found/:token', (req, res, next) => { const s = db.prepare('SELECT * FROM sendings WHERE token=?').get(String(req.params.token).slice(0, 40)); if (!s) return next(); return openSent(req, res, next, s); });
  // The first links of 5 Nov: /flower/<slug>?from=<name> still opens the same way.
  app.get('/flower/:slug', (req, res, next) => { const w = db.prepare("SELECT id FROM works WHERE slug=? AND status='held'").get(String(req.params.slug)); if (!w) return next(); return openSent(req, res, next, { work_id: w.id, from_name: okName(req.query.from) }); });
  async function wander(req, res, { front = false, key: keyIn = null, share = null, as = null, gift = null, at: atIn = null }) {
    const q = String(req.query.q || '').trim().slice(0, 60); let maker = String(req.query.maker || '').slice(0, 60);
    const key = String(keyIn || req.query.in || '').slice(0, 80);
    const atSlug = atIn || req.query.at;
    let at = atSlug ? await (isDelivery(key) ? adb.get("SELECT * FROM works WHERE slug=? AND status IN ('held','hidden')", String(atSlug)) : adb.get("SELECT * FROM works WHERE slug=? AND status='held'", String(atSlug))) : null;
    // The readers' feed (Will, 27 Oct): Wander, for words. One passage a screen, on the paper.
    if (key === 'shelf') { const CP = app.locals.commonplace; let items = []; try { items = CP ? CP.passages([], 6) : []; } catch (e) { console.error('[shelf]', e.message); /* (#126) the shelf never fails Wander: the room opens without it */ } res.set('Cache-Control', 'private, no-store'); return res.send(strollPage({ items, set: { key, label: 'The shelf', href: '/library', n: 0, via: null }, I, front, shelf: true })); }
    const set = key ? await inSet(req, key, { at: at ? at.slug : '', n: 6 }) : null;
    if (isDelivery(key) && !set) return res.redirect(key.startsWith('album:') ? '/a/' + encodeURIComponent(key.slice(6).replace(/\.guests$/, '')) : '/deliver/' + encodeURIComponent(key.slice(9).replace(/\.guests$/, ''))); /* (#203) the guests' walk is part of its album */ // closed, or not an album: its own door says so
    // (#198) Opened at a work not on view: only through the album that holds it, or for those it is for.
    const inAlbum = !!(at && set && set.tq && set.has.has(at.slug)), OV = app.locals.offView;
    if (at && !inAlbum && OV && OV.off(at) && !OV.may(req, at)) at = null;
    // (22 Nov, Will) In an album, the album's own acts for the photograph on screen, as its rules allow this viewer.
    const album = isDelivery(key) && set && app.locals.deliveries && app.locals.deliveries.acts ? app.locals.deliveries.acts(key, req) : null;
    // (28 Nov, #238; Will: "one swipe takes you right back to my pictures") Opened at a museum's work with no room
    // named (Find's rows, the record's way back, a link sent): the walk goes on in that museum, as if its own Wander
    // had been asked for; its name is on the chip, and the chip leaves for the open Wander. A set, a word or a maker
    // asked for is left as asked.
    let arrived = false; // (the open Wander now holds museums' works too: `all=1` is the open Wander at one of them, see public/stroll.js)
    if (at && !set && !q && !maker && req.query.all !== '1') { const inst = await adb.get("SELECT id, name, handle FROM makers WHERE id=? AND kind='institution'", at.maker_id); if (inst) { maker = V.makerSlug(inst); arrived = true; } }
    let items = set ? set.items : await next(req, { q, maker, n: 6, seen: at ? [at.slug] : [] });
    if (q && !set && app.locals.find) try { app.locals.find.search(q, 1, req, { log: !req.get('x-wm-prepare') }); } catch (e) { /* (#179) words that found nothing are kept for the Studio; never in the walk's way */ }
    if (at) items = [carried(wanderJSON(at, req), inAlbum ? set.tq : ''), ...items];
    const mk = set ? null : await makerBy(maker);
    res.set('Cache-Control', 'private, no-store');
    const sh = share || (set && SHAREABLE(key) ? { url: `/wander?in=${encodeURIComponent(key)}`, title: `${set.label} · Wander`, text: `${set.label}: one work at a time, on Watermark.` } : null);
    // A flower (Will, 5 Nov: "when we send someone a link it opens like a present; here, I found something for you"):
    // the card is the picture itself; the page opens on it alone, in the dark, and the chrome comes after.
    const giftLine = gift ? `${gift.from ? `${gift.from} found this for you.` : 'Someone found this for you.'}` : '';
    const giftNote = gift && gift.note ? gift.note : '';
    res.send(strollPage({ items, q: set ? '' : q, maker: mk ? { name: mk.name, slug: V.makerSlug(mk) } : null, set: set ? { key, label: (as && as.label) || set.label, href: (as && as.href) || set.href, n: set.n, via: set.via || null, files: set.files || null, album } : null, I , front, share: sh, gift: gift ? { from: gift.from || '', line: giftLine, note: giftNote, token: gift.token || '' } : null, me: meFirst(req), arrived }));
  }
}

// The page: the first photographs are in the HTML, so the stroll begins the instant it opens; the script carries on.
const isDeliveryKey = key => /^(delivery|album):/.test(String(key || ''));
function strollPage({ items, q = '', maker = null, set = null, I, front = false, shelf = false, share = null, gift = null, me = '', arrived = false }) {
  const giftLine = gift ? gift.line : '';
  const V = require('./views');
  const BUNCH = (() => { try { return require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'keys', 'bunch.svg'), 'utf8').replace('<svg ', '<svg class="kmk kmk-bunch" aria-hidden="true" '); } catch (e) { return I.key || ''; } })();
  const bookObj = w => `<a class="st-bk${w.cover ? '' : ' st-bound'}" href="/read/${esc(w.book)}"><img src="${esc(w.cover || `/binding/${encodeURIComponent(w.book)}.svg`)}" alt=""><span class="bk3-e"></span></a>`;
  const recordCard = w => `<section class="st-i st-rec" data-slug="${esc(w.slug)}" data-kind="record"><article class="st-rc"><a class="st-rdisc" href="${esc(w.href)}"><img src="${esc(w.img)}" alt="" loading="lazy"></a><p class="k">From the Listening Room</p><h2>${esc(w.title)}</h2><p class="st-rby">${esc(w.by)}${w.composer ? ` · ${esc(w.composer)}` : ''}${w.year ? ` · ${esc(w.year)}` : ''}</p>${w.line ? `<p class="st-rline">${esc(w.line)}</p>` : ''}<div class="st-racts"><button type="button" class="st-rplay" data-st-rplay data-src="${esc(w.url)}">${I.play}${I.pause}<span>Play ${esc(w.side)}</span></button><a class="st-rgo" href="${esc(w.href)}">Into the room${w.n > 1 ? ` · ${w.n} sides` : ''}</a></div></article></section>`;
  const textCard = w => w.passage
    ? `<section class="st-i st-txt st-pas" data-slug="${esc(w.slug)}" data-kind="text"><article class="st-tx"><p class="k">A passage</p><div class="st-txb st-pasb">${w.excerpt.map(p => `<p>${esc(p)}</p>`).join('')}</div><p class="st-pasrc">— ${w.author ? `${esc(w.author)}, ` : ''}<i>${esc(w.title)}</i>${w.head ? `<span>${esc(w.head)}</span>` : ''}</p><div class="st-pasfoot">${bookObj(w)}<div><a class="st-txgo" href="${esc(w.href)}">Open the book here</a><p class="st-txacts"><button type="button" data-st-cp title="Keep it in your commonplace book: passages copied out of what you read, in your own hand">${I.plus}<span>Keep</span></button><button type="button" data-st-share title="Send the passage to someone, on its card">${I.share}<span>Share</span></button></p></div></div></article></section>`
    : `<section class="st-i st-txt" data-slug="${esc(w.slug)}" data-kind="text">${bookObj(w)}<article class="st-tx"><p class="k">From the shelf</p><h2>${esc(w.title)}</h2>${w.author ? `<p class="st-txa">${esc(w.author)}</p>` : ''}${w.head ? `<p class="st-txh">${esc(w.head)}</p>` : ''}<div class="st-txb">${w.excerpt.map(p => `<p>${esc(p)}</p>`).join('')}</div><a class="st-txgo" href="${esc(w.href)}">Read on${w.n ? ` · ${w.n} chapters` : ''}</a><p class="st-txacts"><button type="button" data-st-keep title="Keep it on your shelf: among your books, to read when you like">${I.plus}<span>Keep</span></button><button type="button" data-st-share title="Send the book to someone">${I.share}<span>Share</span></button></p></article></section>`;
  // A screen from the shelf, the turntable or a contact sheet never takes the wall down with it (30 Oct: a third of
  // Wander's first loads answered 500); the fault is kept for /healthz and the screen left out.
  function screenFault(e) { HOUSE.locals.screenFault = { at: new Date().toISOString(), message: String(e && e.message || e).slice(0, 300), stack: String(e && e.stack || '').split('\n').slice(0, 6).join(' | ') }; console.error('[wander] screen', e); }
  const card = (w, i) => { if (w.kind === 'sheet' || w.kind === 'text' || w.kind === 'record') { try { return w.kind === 'sheet' ? (HOUSE.locals.sheets ? HOUSE.locals.sheets.card(w) : '') : w.kind === 'text' ? textCard(w) : recordCard(w); } catch (e) { screenFault(e); return ''; } } return cardOf(w, i); };
  const cardOf = (w, i) => `<section class="st-i" data-slug="${esc(w.slug)}">
<img class="st-im" src="${esc(w.img)}" alt="${esc(w.title)}" draggable="false" decoding="async"${i === 0 ? ' fetchpriority="high"' : i <= 2 ? ' fetchpriority="low"' : ' loading="lazy"'}${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}>
<div class="st-plate"><a class="st-by" href="${w.artist ? esc(w.artist.href) : `/wander?maker=${esc(w.makerSlug)}&at=${esc(w.slug)}`}"${w.artist ? '' : ' data-st-maker'}>${esc(w.maker)}</a>${w.life && (w.life.years || w.life.atWork || w.life.verified) ? `<span class="st-life">${w.life.years ? `<i>${esc(w.life.years)}</i>` : ''}${w.life.atWork ? '<b class="lfl-w" title="Put up new work in the last month">at work</b>' : ''}${w.life.verified ? '<b class="lfl-v" title="A real person, checked">Verified</b>' : ''}</span>` : ''}<a class="st-t" href="/m/${esc(w.makerSlug)}/${esc(w.slug)}?from=wander">${esc(w.title)}</a><span class="st-k">${w.place ? `<a href="/wander?q=${encodeURIComponent(w.place)}">${esc(w.place)}</a>` : ''}${w.place && w.year ? ' · ' : ''}${esc(w.year || '')}</span><a class="st-tog" href="/m/${esc(w.makerSlug)}/${esc(w.slug)}?from=wander" title="Watermark: the asset under the picture; its number, its terms, its papers, the licence to use it"><b>${I.wave}Wander</b><span>${I.shield}Watermark</span></a></div>
<button type="button" class="st-eye" data-st-about="record" aria-label="The Watermark: the asset, its number, its terms">${I.shield}</button>
<nav class="st-rail" aria-label="Acts">
<button type="button" class="st-b" data-st-hat aria-pressed="${w.hat && w.hat.mine ? 'true' : 'false'}" title="Hat: a nod, I saw it. Free, as many as you like.">${I.hat}<span data-st-hat-n>Hat</span></button><button type="button" class="st-b st-bv" data-st-bravo aria-pressed="${w.bravo && w.bravo.mine ? 'true' : 'false'}" title="Bravo: it floored me. Three a month.">${I.bravo}<span>Bravo</span></button>
<button type="button" class="st-b" data-st-hang title="Save it to a wall of yours, like a pin. Find it again in Yours.">${I.hang}<span>Save</span></button>
<button type="button" class="st-b" data-st-share title="Send it to someone. It opens for them on its own, with your name and a line from you.">${I.send}<span>Send</span></button><a class="st-b st-study" data-st-easel href="/easel/${esc(w.slug)}?back=${encodeURIComponent(`/wander?${set && isDeliveryKey(set.key) ? `in=${encodeURIComponent(set.key)}&` : ''}at=${w.slug}`)}${set && isDeliveryKey(set.key) && set.via ? `&amp;token=${encodeURIComponent(set.via)}` : ''}" title="Study it: the work large on the easel, with values, notan, squint, a grid and a timer. Set your phone on a stand and draw from it.">${I.easel}<span>Study</span></a>
<button type="button" class="st-b st-moreb" data-st-more aria-expanded="false" aria-label="More">${I.more}<span>More</span></button>
<div class="st-more" data-st-morebox hidden>${w.slug && !String(w.slug).includes(':') ? `<a class="st-b" href="/w/${esc(w.slug)}/frame" title="Frame a detail: the part you love, kept with its own address">${I.look}<span>Frame</span></a><button type="button" class="st-b" data-note="${esc(w.slug)}" title="Keep a thought: write a line, or say it aloud. Yours alone unless you share it.">${I.pencil}<span>Note</span></button>` : ''}${w.sheet ? `<a class="st-b" data-st-sheet href="${esc(w.sheet.href)}?back=${encodeURIComponent(`/wander?at=${w.slug}`)}" title="The contact sheet: every frame around this one, as it was shot.">${I.page}<span>Contact sheet</span></a>` : ''}<a class="st-b" data-st-record href="/m/${esc(w.makerSlug)}/${esc(w.slug)}?from=wander" title="Watermark: the asset under the picture; its number, its terms, the licence to use it.">${I.page}<span>Watermark</span></a>${w.guide ? `<button type="button" class="st-b" data-st-guide title="Look closer: what to see in it, read by Al.">${I.guide}<span>Look closer</span></button>` : ''}<button type="button" class="st-b" data-st-card title="A thank-you card to the maker, from 99¢.">${I.card}<span>Thank</span></button><button type="button" class="st-b" data-st-settings title="Sit a while: each work held a minute and a half, the guide read, quiet music.">${I.stand}<span>Sit</span></button></div>
${w.held ? `<span class="st-b st-held">${I.collect}<span>Yours</span></span>` : w.collect ? `<button type="button" class="st-b st-buy" data-st-buy data-url="${esc(w.collect.url)}" data-pocket="${w.collect.pocket ? 1 : 0}" title="Collect it: yours to keep, numbered, with the papers. ${esc(w.collect.price)}.">${I.collect}<span>Collect<b>${esc(w.collect.price)}</b></span><em>Yours to keep</em></button>` : w.printOpen ? `<a class="st-b st-buy st-print" href="${esc(w.printOpen.url)}" title="Print it: archival pigment on cotton paper, sent to your door. From ${esc(w.printOpen.from)}.">${I.hang}<span>Print it<b>from ${esc(w.printOpen.from)}</b></span></a>` : ''}
</nav>
<div class="st-hat-fly" aria-hidden="true">${I.hat}</div>
</section>`;
  const g0 = gift && items[0] ? items[0] : null;
  return V.layout({ title: g0 ? `${V.tidy(g0.title)} · ${g0.maker}` : front ? 'Watermark · For photographers' : share ? `${share.title} · Watermark` : `${q ? `${V.tidy(q)} · ` : ''}Wander · Watermark`, desc: g0 ? (gift.note ? `“${gift.note}” ${giftLine}` : giftLine) : front ? 'Watermark takes art and copyright seriously. Photographers keep their work here, show it properly, and are paid when it is used or collected.' : share ? share.text : 'Watermark on a phone: the finest work, one at a time, edge to edge. Swipe for the next.', path: g0 ? (gift.token ? `/found/${gift.token}` : `/w/${g0.slug}`) : front ? '/' : share ? share.url : '/wander', bare: true, image: g0 ? `/img/${g0.slug}/large?f=jpg` : share && share.image ? share.image : items[0] ? items[0].img : null, body: `<main class="st${front ? ' st-front' : ''}${gift ? ' st-gift st-gifting' : ''}" data-stroll${front ? ' data-front="1"' : ''}${gift ? ` data-gift="1" data-from="${esc(gift.from || '')}" data-found="${esc(gift.token || '')}"` : ''} data-q="${esc(q)}" data-maker="${esc(maker ? maker.slug : '')}"${arrived ? ' data-arrived="1"' : ''} data-me="${esc(me)}">
<header class="st-top"><a class="st-home" href="${front ? '/house' : '/'}" aria-label="Watermark">${V.WAVE_MARK || ''}<span>Watermark</span></a><a class="st-look" href="/look" title="Every collection in the house: the Met, the masters, the makers">Look around</a>${maker ? `<a class="st-chip" href="/wander" title="Everything again">${esc(maker.name)}<i>${I.close}</i></a>` : ''}${set ? `<a class="st-chip st-set" href="${esc(set.href)}" title="Back to ${esc(set.label)}">${esc(set.label)}<i>${I.close}</i></a>` : ''}${q && !maker && !set ? `<a class="st-chip" href="/wander" title="Everything again">${esc(q)}<i>${I.close}</i></a>` : ''}<span class="st-sp"></span>${share ? `<button type="button" class="st-gon" data-st-setshare data-url="${esc(share.url)}" data-title="${esc(share.title)}" data-text="${esc(share.text)}" aria-label="Share this wander" title="Send this wander: the whole walk, from the first work">${I.share || I.send}<span>Share</span></button>` : ''}<button type="button" class="st-gon" data-find-open="stroll" aria-label="Find" title="Find a work, a place, a maker: straight to it">${I.find || I.eye}<span>Find</span></button><button type="button" class="st-gon st-full" data-st-fs hidden aria-label="Full screen" title="Full screen (F)">${I.full || ''}<span>Full screen</span></button><a class="st-x" href="${set ? esc(set.href) : front ? '/house' : '/collection'}" aria-label="Close" data-st-close>${I.close}</a></header>
<div class="st-sheet st-ss" data-st-ssheet hidden><div class="st-scard"><button type="button" class="st-gx" data-st-sx2 aria-label="Close">${I.close}</button><p class="k">Settings</p>
<button type="button" class="st-sit1" data-st-sit aria-pressed="false">${I.stand}<b>Sit a while</b><span>Each work held a minute and a half, the guide read, quiet music. Tap again to stand.</span></button>
<p class="st-skeys">Keys: arrows or space move · H hat · B bravo · S hang · G guide · C collect · Esc leaves.</p></div></div>
<button type="button" class="st-hld" data-st-held hidden title="Release (L or Esc)">${I.full}<b>Held</b><span data-st-heldfs>full screen</span><i>${I.close}</i></button>
<div class="st-scroll" data-st-scroll>${items.map(card).join('')}${items.length ? '' : `<section class="st-i st-none"><p>Nothing by that word yet.</p><a href="/wander">Wander on</a></section>`}</div>
<div class="st-guide" data-st-guide-sheet hidden><div class="st-gcard"><button type="button" class="st-gx" data-st-gx aria-label="Close">${I.close}</button><p class="k st-wil">${I.guide}Look closer &middot; Al</p>${V.GUIDE_SWITCH || ''}<div class="st-gt" data-st-gt></div><p class="st-gby" data-st-gby></p></div></div>
${gift ? `<div class="st-flower" data-st-flower>${gift.note ? `<p class="st-fl-note">“${esc(gift.note)}”</p>` : ''}<p class="st-fl-line">${esc(giftLine)}</p><p class="st-fl-sub">${items[0] ? `<b>${esc(V.tidy(items[0].title))}</b> · ${esc(items[0].maker)}` : ''}</p></div>` : ''}${front ? `<div class="st-hello" data-st-hello><p><b>Watermark takes art and copyright seriously.</b> Photographers keep their work here, show it properly, and are paid when it is used or collected.</p><a href="/house">What this is &rarr;</a></div>` : ''}<p class="st-toast" data-st-toast hidden></p>${['find','close','next','wave'].map(k => `<template data-ic="${k}">${I[k]}</template>`).join('')}
<button type="button" class="st-tab st-tab-l" data-st-doors="yours" aria-label="Where next">${I.look || I.wave}<span>Next</span></button><aside class="st-side st-side-l st-who st-like" data-st-side="yours" aria-label="Where next" tabindex="-1"><div class="sdr" data-sd-body></div></aside><button type="button" class="st-tab st-tab-r" data-st-doors="keys" aria-label="About this work">${I.page || I.look}<span>About</span></button>
<aside class="st-side st-side-r st-who" data-st-side="keys" aria-label="About this work" tabindex="-1"><div class="sdr" data-sd-body></div></aside><script src="/static/follow.js" defer></script><div class="st-shade" data-st-shade hidden></div>
<template data-st-ic="wave">${I.wave}</template><template data-st-ic="look">${I.look}</template><template data-st-ic="pencil">${I.pencil}</template><template data-st-ic="in">${I.in || ''}</template><template data-st-ic="card">${I.card || ''}</template><template data-st-ic="play">${I.play}</template><template data-st-ic="pause">${I.pause}</template><template data-st-ic="plus">${I.plus}</template><template data-st-ic="share">${I.share}</template><template data-st-ic="print">${I.print || ''}</template>
<div class="st-sitbar" data-st-sitbar hidden><button type="button" data-st-stand>Stand up</button></div>
<p class="st-stay" data-st-stay hidden>Stay with this one.</p>
<p class="st-swipe" data-st-swipe hidden><span>Swipe up for the next</span><i></i></p>
</main>
<script>window.__WM_STROLL=${JSON.stringify({ items, q, maker: maker ? maker.slug : '', set }).replace(/</g, '\\u003c')};</script>
<script src="/static/stay.js?v=${V.VER || ''}" defer></script><script src="/static/stroll.js?v=${V.VER || ''}" defer></script><script src="/static/eye.js?v=${V.VER || ''}" defer></script>` });
}

module.exports = { mountStroll, strollPage };
