'use strict';
// Prepared copies for strangers (20 Nov 2026, #139; docs/SCALE.md, stage 3). Most visitors are strangers looking at pages
// that change a few times an hour, and every one of those pages was built by the website's one thread from the database.
// Now the worker builds them ahead: it asks its own house for each door as a stranger (no cookie, no query) and writes
// the page into `prepared_pages`, one row a door. Every copy of the website keeps a mirror of those rows in memory, read
// on a timer through the async path (a few small statements a few seconds apart, never in a request), so a stranger's
// request for a prepared door is answered from memory with no statement on the database. The rows outlive a restart and
// are shared by every copy of the website; the website has no disk and gets none.
//
// Who is a stranger: a request with no house cookie that marks a person, no tenant and no query. The house's cookies are
// all `wm_*`; only three say nothing about who is asking: `wm_in=1` (set by the layout's script), `wm_tz` and
// `wm_zone=all`. `wm_tz` is the visitor's own time zone, which the clock reads (clock.js `programme`, on /house's rows
// when the house is not quiet, and the Keys): a copy whose making asked the clock is marked `zoned` (X-Wm-Zoned from the
// worker's own request), and a visitor who carries a zone is built fresh for it; a zoned copy is never public to a cache
// in front, which does not know the zone. Every other `wm_*` cookie (a sign-in, the visitor's own looking
// `wm_v`, the basket, a walk `wm_in=<list>`, a show `wm_via`, the adult rooms…) is a person, whose page is built fresh
// and sent `private, no-store`; on the hall's doors, which read none of the visitor's own cookies, see HALL_INERT. A copy is only ever made from the worker's own cookieless request, so no copy can hold
// anything of a person. Rule: a new `wm_*` cookie is a person until it is added to INERT here.
//
// When a copy is made new: the doors every DOOR_MS; a work's or an artist's page every PAGE_MS; at once when the register
// names the work (or its maker), or when the picture copies are told (`forget`: conservation, pairs); and a work that is
// no longer held, or is kept back, loses its copy on the worker's next round (ROUND_MS). A copy older than STALE_MS (the
// worker down) is not served. Which works and artists: those strangers asked for in the last LOOK_MS (the visit log), at
// most MAX of them.
//
// The visit: a page sent from a copy (by the website, or one day by the edge) is not written to `hits` when it is sent;
// the copy carries one line that tells the house it was seen (POST /api/arrived, analytics.js), from the visitor's browser,
// so it is counted once wherever it was served, inside the house, by no outside service.
const crypto = require('crypto');
const http = require('http');
const zlib = require('zlib');
const ROLE = require('./role');

const num = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);
const DOOR_MS = () => num('PREPARED_DOOR_MS', 60e3);
const PAGE_MS = () => num('PREPARED_PAGE_MS', 600e3);
const ROUND_MS = () => num('PREPARED_ROUND_MS', 10e3);
const POLL_MS = () => num('PREPARED_POLL_MS', 3e3);
const STALE_MS = () => num('PREPARED_STALE_MS', 1800e3);
const LOOK_MS = () => num('PREPARED_LOOK_MS', 900e3);
const KEEP_MS = () => num('PREPARED_KEEP_MS', 86400e3);
const MAX = () => num('PREPARED_MAX', 3000);
const PER_ROUND = () => num('PREPARED_PER_ROUND', 40);
const MEM_MB = () => num('PREPARED_MEM_MB', 64);
const BODIES = 50; // bodies read in one question by the website's poll
const LAG_MS = 30e3; // how far back each poll looks again (clocks of several processes; a late commit)
// What a copy tells a cache in front (the edge, today CachingDisabled for pages): the browser always asks again
// (max-age=0, so a person who signs in never sees their own browser's stranger copy); a shared cache may keep it EDGE_S.
const EDGE_S = () => num('PREPARED_EDGE_S', 60);
const SWR_S = () => num('PREPARED_SWR_S', 300);

// The process's own key for its own requests: a visitor who sends the header without it is a visitor.
const TOKEN = crypto.randomBytes(24).toString('hex');
const isPrepare = req => { const h = req && req.headers && req.headers['x-wm-prepare']; if (!h || h.length !== TOKEN.length) return false; try { return crypto.timingSafeEqual(Buffer.from(String(h)), Buffer.from(TOKEN)); } catch (e) { return false; } };

const INERT = { wm_in: v => v === '1', wm_tz: () => true, wm_zone: v => v === 'all' };
// The hall's doors (the collection, the makers, an artist, the Library…) read no visitor's own cookie: the only readers of
// the looking code (wm_v), the basket (wm_bk), a show (wm_via), a walk (wm_in=<list>) and an album's heart (wm_dvh) are
// Wander, the work page, Find, the bench, the balcony, the basket and the sale (every `cookies.wm_*` in src, 20 Nov).
// So on a hall door those say nothing about who is asking; on a looking door (Wander, a work) they are the person.
const HALL_INERT = { ...INERT, wm_in: () => true, wm_v: () => true, wm_bk: () => true, wm_via: () => true, wm_dvh: () => true };
const LOOKING = /^\/(?:$|wander(?:\/|$)|w\/|m\/[^/]+\/[^/]+$|stroll(?:\/|$))/;
const kindOfPath = p => (LOOKING.test(String(p || '')) ? 'looking' : 'hall');
// The cookie names as the browser sent them (the raw header, so nothing the parser dropped is missed).
function cookiesOf(req) {
  const out = []; const raw = String((req.headers && req.headers.cookie) || '');
  for (const part of raw.split(';')) { const i = part.indexOf('='); const k = (i < 0 ? part : part.slice(0, i)).trim(); if (!k) continue; let v = i < 0 ? '' : part.slice(i + 1).trim(); try { v = decodeURIComponent(v); } catch (e) { /* as sent */ } out.push([k, v]); }
  return out;
}
// `kind`: 'looking' (the strict rule) or 'hall'; by default from the path.
function isPerson(req, kind = kindOfPath(req.path)) {
  if (req.tenant) return true;
  if (req.headers && req.headers.authorization) return true;
  const inert = kind === 'hall' ? HALL_INERT : INERT;
  for (const [k, v] of cookiesOf(req)) { if (!/^wm_/i.test(k)) continue; const ok = Object.prototype.hasOwnProperty.call(inert, k) ? inert[k] : null; if (!ok || !ok(v)) return true; }
  return false;
}
// The doors a copy may answer, by path alone. `/m/<maker>/<slug>` is the work's own address; its copy is the work's.
const FIXED = ['/', '/wander', '/house', '/collection', '/makers'];
const SLUG = '[a-z0-9][a-z0-9-]{0,159}';
const RX = { w: new RegExp(`^/w/(${SLUG})$`), m: new RegExp(`^/m/(${SLUG})/(${SLUG})$`), art: new RegExp(`^/art/(${SLUG})$`) };
function doorOfPath(p) {
  if (FIXED.includes(p)) return { key: p, kind: 'door', who: kindOfPath(p) };
  let m = RX.w.exec(p); if (m) return { key: '/w/' + m[1], kind: 'work', slug: m[1], who: 'looking' };
  m = RX.m.exec(p); if (m) return { key: '/w/' + m[2], kind: 'work', slug: m[2], maker: m[1], who: 'looking' };
  m = RX.art.exec(p); if (m && m[1] !== 'visit') return { key: '/art/' + m[1], kind: 'art', slug: m[1], who: 'hall' };
  return null;
}
function doorOf(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  if (String(req.originalUrl || req.url).includes('?')) return null; // any query is built fresh
  return doorOfPath(req.path);
}

function mountPrepared(app, { db, V, C, cfg = {} }) {
  const test = process.env.NODE_ENV === 'test';
  // Off under test unless the test asks (cfg.prepared), and anywhere with PREPARED=0.
  const on = process.env.PREPARED === '0' ? false : (test ? !!cfg.prepared : true);
  db.exec('CREATE TABLE IF NOT EXISTS prepared_pages (k TEXT PRIMARY KEY, body TEXT, at INTEGER NOT NULL, made INTEGER NOT NULL, work_id INTEGER, maker TEXT, cookies TEXT, etag TEXT, seen INTEGER, gone INTEGER NOT NULL DEFAULT 0, zoned INTEGER NOT NULL DEFAULT 0)');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('prepared_pages') WHERE name='zoned'").get()) db.exec('ALTER TABLE prepared_pages ADD COLUMN zoned INTEGER NOT NULL DEFAULT 0');
  // the async path (#117) when it is there; else the bridge, from a timer, never a request
  const ask = () => app.locals.adb || { all: async (sql, ...a) => db.prepare(sql).all(...a), get: async (sql, ...a) => db.prepare(sql).get(...a), run: async (sql, ...a) => db.prepare(sql).run(...a) };
  const state = { served: 0, missed: 0, persons: 0, made: 0, refused: 0, forgot: 0, polls: 0, lastPoll: null, lastRound: null, error: null };

  // ---------- the website: the mirror and the door ----------
  const index = new Map(); // k → { at, made, workId, maker, gone }: every row, small
  const mem = new Map();   // k → { at, made, body, gz, etag, maker, workId, cookies, bytes }: the bodies, newest used last
  const want = new Set();  // keys a stranger asked for whose body is not in memory yet: fetched on the next poll
  let bytes = 0, mark = { at: 0, k: '' };
  const drop = k => { const h = mem.get(k); if (h) { bytes -= h.bytes; mem.delete(k); } };
  function keep(k, row) {
    drop(k);
    const body = String(row.body || ''); const gz = zlib.gzipSync(body, { level: 6 });
    const h = { at: Number(row.at), made: Number(row.made), body, gz, etag: row.etag || `W/"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 20)}"`, maker: row.maker || null, workId: row.work_id ? Number(row.work_id) : null, cookies: (() => { try { return row.cookies ? JSON.parse(row.cookies) : []; } catch (e) { return []; } })(), zoned: !!Number(row.zoned || 0), bytes: body.length + gz.length };
    mem.set(k, h); bytes += h.bytes;
    const cap = MEM_MB() * 1048576; for (const key of mem.keys()) { if (bytes <= cap) break; if (FIXED.includes(key)) continue; drop(key); }
  }
  // One poll: what changed since the mark (keys and stamps only), then the bodies wanted, fifty at most.
  let polling = false;
  async function sync() {
    if (polling) return 0; polling = true; let n = 0;
    try {
      // (#150) Rows are written by more than one process (the worker's copies; a website's `forget`), each stamping `at`
      // by its own clock, and a row can commit after a later stamp was read. So every poll reads again the last LAG_MS
      // before its mark (keys and stamps only) and takes only what it has not already taken.
      let cur = { at: Math.max(0, mark.at - LAG_MS), k: '' }, top = mark.at;
      for (let page = 0; page < 50; page++) {
        const rows = await ask().all('SELECT k, at, made, work_id, maker, gone FROM prepared_pages WHERE (at, k) > (?, ?) ORDER BY at, k LIMIT 500', cur.at, cur.k);
        for (const r of rows) {
          const at = Number(r.at); cur = { at, k: r.k }; if (at > top) top = at;
          const ix = index.get(r.k); if (Number(r.gone) ? !ix && !mem.has(r.k) : ix && ix.at === at) continue; // already taken
          n++;
          if (Number(r.gone)) { index.delete(r.k); drop(r.k); continue; }
          index.set(r.k, { at, made: Number(r.made), workId: r.work_id ? Number(r.work_id) : null, maker: r.maker || null });
          // a body changed is read again; a new one is read while there is room (the doors always)
          const h = mem.get(r.k); if (h && h.at !== at) { drop(r.k); want.add(r.k); } else if (!h && (FIXED.includes(r.k) || bytes < MEM_MB() * 1048576 * 0.8)) want.add(r.k);
        }
        if (rows.length < 500) break;
      }
      mark = { at: top, k: '' };
      // the bodies, BODIES a question, the doors first; what is left waits for the next poll
      const all = [...want].filter(k => index.has(k)).sort((a, b) => FIXED.includes(b) - FIXED.includes(a)); want.clear();
      for (let i = 0; i < all.length && i < BODIES * 4; i += BODIES) {
        const ks = all.slice(i, i + BODIES);
        const rows = await ask().all(`SELECT k, body, at, made, work_id, maker, cookies, etag, zoned FROM prepared_pages WHERE gone=0 AND k IN (${ks.map(() => '?').join(',')}) LIMIT ${BODIES}`, ...ks);
        for (const r of rows) { const ix = index.get(r.k); if (ix && Number(r.at) >= ix.at && r.body) keep(r.k, r); }
        await new Promise(f => setImmediate(f)); // the loop turns between batches
      }
      for (const k of all.slice(BODIES * 4)) want.add(k);
      state.polls++; state.lastPoll = new Date().toISOString(); state.error = null;
    } catch (e) { state.error = String(e.message || e).split('\n')[0]; console.error('[prepared] poll', state.error); } finally { polling = false; }
    return n;
  }
  // The door: in front of the rooms. A stranger's door with a copy in memory is answered here; anyone else goes on.
  function serve(req, res, next) {
    if (isPrepare(req)) { req.preparing = true; return next(); }
    if (!on) return next();
    const d = doorOf(req); if (!d) return next();
    if (isPerson(req, d.who)) { state.persons++; res.set('Cache-Control', 'private, no-store'); return next(); }
    const h = mem.get(d.key); const now = Date.now();
    const ownZone = h && h.zoned && cookiesOf(req).some(([k, v]) => k === 'wm_tz' && v); // the hour in their own zone
    if (!h || ownZone || now - h.made > STALE_MS() || (d.maker && h.maker !== d.maker) || res.getHeader('set-cookie')) {
      if (!h && index.has(d.key)) want.add(d.key);
      state.missed++; res.set('Cache-Control', 'private, no-store'); return next();
    }
    mem.delete(d.key); mem.set(d.key, h); // most recently used last
    state.served++; res.locals.fromCopy = true;
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', h.zoned ? 'private, max-age=0' : `public, max-age=0, s-maxage=${EDGE_S()}, stale-while-revalidate=${SWR_S()}`); // a cache in front cannot tell the zone
    res.set('ETag', h.etag); res.set('X-Prepared', String(Math.round((now - h.made) / 1000))); res.vary('Accept-Encoding');
    for (const c of h.cookies) res.cookie(c.name, c.value, c.opts || {});
    if (req.headers['if-none-match'] === h.etag) return res.status(304).end();
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { res.set('Content-Encoding', 'gzip'); return res.end(req.method === 'HEAD' ? undefined : h.gz); }
    return res.send(h.body);
  }

  // ---------- the worker: making copies ----------
  let local = null; // the house asked as a stranger, on a port of its own on 127.0.0.1
  const listen = () => local || (local = new Promise((ok, no) => { const s = http.createServer(app); s.on('error', no); s.listen(0, '127.0.0.1', () => { s.unref(); ok(s.address().port); }); }));
  const hostOf = () => { try { return new URL(C.base).host; } catch (e) { return 'localhost'; } };
  async function fetchAsStranger(p) {
    const port = await listen();
    return new Promise((ok, no) => {
      const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { host: hostOf(), 'x-wm-prepare': TOKEN, 'user-agent': 'Mozilla/5.0 (Watermark; a prepared copy)', accept: 'text/html' } }, res => {
        const parts = []; res.on('data', c => parts.push(c)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }));
      });
      r.setTimeout(60e3, () => r.destroy(new Error('no answer in 60 s'))); r.on('error', no); r.end();
    });
  }
  // A Set-Cookie on a stranger's page is kept with the copy only when it is the walk's own list cookie (the collection
  // sets `wm_in=collection` for the work pages after it): the same for every stranger. Anything else: no copy.
  function cookiesFrom(headers) {
    const sc = [].concat(headers['set-cookie'] || []); const out = [];
    for (const line of sc) {
      const m = /^wm_in=([a-z:-]{1,40});/.exec(line); if (!m || m[1] !== 'collection') return null;
      out.push({ name: 'wm_in', value: m[1], opts: { httpOnly: true, sameSite: 'lax', maxAge: 2 * 3600e3, path: '/' } });
    }
    return out;
  }
  // The line that counts the visit from the visitor's browser (analytics.js, POST /api/arrived): the page, where they came
  // from and how long the page took to arrive. First-party; sent once; nothing else.
  const SEEN = '<script>(function(){try{var n=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0],t=n?Math.round(n.responseEnd-n.requestStart):0,r="";try{r=document.referrer?new URL(document.referrer).hostname:""}catch(e){}navigator.sendBeacon&&navigator.sendBeacon("/api/arrived?p="+encodeURIComponent(location.pathname)+"&t="+t+"&r="+encodeURIComponent(r),"")}catch(e){}})()</script>';
  let lastAt = 0; const stamp = () => { lastAt = Math.max(Date.now(), lastAt + 1); return lastAt; };
  const put = (k, row) => db.prepare('INSERT INTO prepared_pages (k, body, at, made, work_id, maker, cookies, etag, seen, gone, zoned) VALUES (?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT(k) DO UPDATE SET body=excluded.body, at=excluded.at, made=excluded.made, work_id=excluded.work_id, maker=excluded.maker, cookies=excluded.cookies, etag=excluded.etag, seen=COALESCE(excluded.seen, prepared_pages.seen), gone=0, zoned=excluded.zoned')
    .run(k, row.body, row.at, row.made, row.work_id, row.maker, row.cookies, row.etag, row.seen || null, row.zoned ? 1 : 0);
  const tomb = k => db.prepare('UPDATE prepared_pages SET gone=1, body=NULL, at=? WHERE k=? AND gone=0').run(stamp(), k).changes;
  // Make one door's copy now. A work that is not held, or is kept back, is never copied (and loses any copy it had).
  async function make(key, { seen = null } = {}) {
    const d = doorOfPath(key); if (!d) return false;
    let workId = null, maker = null;
    if (d.kind === 'work') {
      const w = db.prepare('SELECT id, status, keep_back, maker_id FROM works WHERE slug=? LIMIT 1').get(d.slug);
      if (!w || w.status !== 'held' || Number(w.keep_back || 0)) { tomb(key); state.refused++; return false; }
      workId = Number(w.id); const m = db.prepare('SELECT id, name FROM makers WHERE id=? LIMIT 1').get(w.maker_id); maker = m ? V.makerSlug(m) : null;
    }
    const r = await fetchAsStranger(key);
    const ct = String(r.headers['content-type'] || ''); const cookies = cookiesFrom(r.headers);
    if (r.status !== 200 || !/text\/html/.test(ct) || cookies === null || !r.body) { tomb(key); state.refused++; return false; }
    let body = r.body; body = body.includes('</body>') ? body.replace(/<\/body>(?![\s\S]*<\/body>)/, SEEN + '</body>') : body + SEEN;
    const etag = `W/"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 20)}"`; // weak: the same page sent plain or gzipped
    const now = Date.now();
    put(key, { body, at: stamp(), made: now, work_id: workId, maker, cookies: cookies.length ? JSON.stringify(cookies) : null, etag, seen, zoned: r.headers['x-wm-zoned'] === '1' });
    state.made++;
    return true;
  }
  // The register since the last round: the works it names (subject, data.work, data.works, data.slug) are made new at once;
  // anything a maker or a wall did makes the doors new.
  let seq = null;
  function fromRegister() {
    const works = new Set(); let doors = false;
    if (seq === null) { const h = db.prepare('SELECT MAX(seq) s FROM ledger').get(); seq = Number((h && h.s) || 0); return { works, doors }; }
    const rows = db.prepare('SELECT seq, type, subject, data FROM ledger WHERE seq > ? ORDER BY seq LIMIT 2000').all(seq);
    for (const e of rows) {
      seq = Math.max(seq, Number(e.seq));
      let x = {}; try { x = e.data ? JSON.parse(e.data) : {}; } catch (er) { x = {}; }
      const names = [e.subject, x.work, x.slug, ...(Array.isArray(x.works) ? x.works : [])].filter(s => typeof s === 'string' && new RegExp(`^${SLUG}$`).test(s));
      for (const s of names) works.add(s);
      if (/^(work|maker|wall|hang|collection|artist)\./.test(e.type)) doors = true;
    }
    return { works, doors };
  }
  const told = new Set(); // keys told by `forget` in this process, made at the next round
  let rounding = false;
  // The worker's round: tombstones for what may no longer be shown, then the most needed copies, PER_ROUND at most.
  async function round({ all = false } = {}) {
    if (rounding) return null; rounding = true; const out = { made: 0, gone: 0 };
    try {
      const now = Date.now();
      // 1. Nothing that is not held, or is kept back, keeps a copy.
      const lost = db.prepare("SELECT p.k FROM prepared_pages p WHERE p.gone=0 AND p.work_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM works w WHERE w.id=p.work_id AND w.status='held' AND COALESCE(w.keep_back,0)=0) LIMIT 1000").all();
      for (const r of lost) out.gone += tomb(r.k);
      // 2. What is due.
      const reg = fromRegister();
      const rows = db.prepare('SELECT k, made, seen FROM prepared_pages WHERE gone=0 ORDER BY made LIMIT 5000').all();
      const had = new Map(rows.map(r => [r.k, r]));
      const due = []; const add = (k, why, seen) => { if (!due.some(x => x.k === k)) due.push({ k, why, seen }); };
      for (const k of told) add(k, 0); told.clear();
      for (const s of reg.works) if (had.has('/w/' + s)) add('/w/' + s, 0);
      for (const k of FIXED) { const h = had.get(k); if (all || reg.doors || !h || now - Number(h.made) > DOOR_MS()) add(k, 1); }
      // what strangers asked for lately, most asked first
      const since = Math.floor((now - LOOK_MS()) / 1000);
      const asked = db.prepare("SELECT path, COUNT(*) n FROM hits WHERE at >= ? AND kind='page' AND status=200 AND bot=0 AND (path LIKE '/w/%' OR path LIKE '/art/%') GROUP BY path ORDER BY COUNT(*) DESC LIMIT ?").all(since, MAX());
      const seenNow = Math.floor(now / 1000);
      for (const a of asked) { const d = doorOfPath(a.path); if (!d) continue; const h = had.get(d.key); if (!h) add(d.key, 2, seenNow); else if (all || now - Number(h.made) > PAGE_MS()) add(d.key, 3, seenNow); else if (!h.seen || seenNow - Number(h.seen) > 300) db.prepare('UPDATE prepared_pages SET seen=? WHERE k=?').run(seenNow, d.key); }
      for (const r of rows) if (!FIXED.includes(r.k) && (all || now - Number(r.made) > PAGE_MS()) && r.seen && seenNow - Number(r.seen) < KEEP_MS() / 1000) add(r.k, 4);
      due.sort((a, b) => a.why - b.why);
      const n = all ? due.length : Math.min(due.length, PER_ROUND());
      for (const x of due.slice(0, n)) { try { if (await make(x.k, { seen: x.seen })) out.made++; } catch (e) { console.error('[prepared] make', x.k, String(e.message || e).split('\n')[0]); } }
      // 3. Copies no stranger asked for in KEEP_MS go; beyond MAX the least asked go; tombstones older than an hour are swept.
      const old = db.prepare('SELECT k FROM prepared_pages WHERE gone=0 AND work_id IS NOT NULL AND (seen IS NULL OR seen < ?) LIMIT 500').all(seenNow - Math.round(KEEP_MS() / 1000));
      for (const r of old) out.gone += tomb(r.k);
      const live = db.prepare('SELECT COUNT(*) n FROM prepared_pages WHERE gone=0').get().n;
      if (Number(live) > MAX()) for (const r of db.prepare(`SELECT k FROM prepared_pages WHERE gone=0 AND k NOT IN (${FIXED.map(() => '?').join(',')}) ORDER BY seen, made LIMIT ?`).all(...FIXED, Number(live) - MAX())) out.gone += tomb(r.k);
      db.prepare('DELETE FROM prepared_pages WHERE gone=1 AND at < ?').run(now - 3600e3);
      state.lastRound = new Date().toISOString();
    } catch (e) { state.error = String(e.message || e).split('\n')[0]; console.error('[prepared] round', state.error); } finally { rounding = false; }
    return out;
  }
  // Told at the moments the picture copies are told (a new master, a rebuild, a pair): the copy stops being served at
  // once on every website (its tombstone), and is made again on the worker's next round.
  function forget(slugOrKey) {
    const key = String(slugOrKey || '').startsWith('/') ? String(slugOrKey) : '/w/' + slugOrKey;
    drop(key); index.delete(key); told.add(key); state.forgot++;
    try { tomb(key); } catch (e) { /* a write the round repeats */ }
  }

  // (#150) The round runs on one process of the house: whichever holds the lease `timer:prepared` (instances.js), so
  // two workers never make the same copies twice; if that process ends, the lease runs out and another takes it.
  const tick = () => (app.locals.instances ? app.locals.instances.pinned('prepared', ROUND_MS(), () => round()) : () => round())();
  if (on && !cfg.noTimers && !test) {
    if (ROLE.web) { setTimeout(sync, 500).unref(); setInterval(sync, POLL_MS()).unref(); }
    if (ROLE.chores) { setTimeout(tick, 15e3).unref(); setInterval(tick, ROUND_MS()).unref(); }
  }
  app.locals.prepared = { serve, sync, round, tick, make, forget, isPerson, doorOf, doorOfPath, state: () => ({ on, ...state, inMemory: mem.size, memMB: Math.round(bytes / 1048576 * 10) / 10, indexed: index.size }), on: () => on };
  return app.locals.prepared;
}

module.exports = { mountPrepared, isPerson, isPrepare, doorOf, doorOfPath, kindOfPath, FIXED };
