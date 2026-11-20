// The numbers (Will, 20 Oct: "cold, hard analytics: who's on the site, how things are running, what the health of
// things is"). First-party, nothing sent anywhere, nothing that names a person: every page and API request is
// recorded as a hit (when, the path with the work's slug kept, the status, how long it took, the visitor's code,
// where they came from, the device, the browser, a bot or not) in `hits`; images and static files are counted in
// memory only. The visitor's code is the house's own `wm_v` cookie when there is one, else a hash of address and
// agent with a salt that changes every day, so nobody can be followed across days from this table. Addresses are
// never stored. Hits older than KEEP_DAYS (90) are pruned nightly.
//   Studio → Back office → Analytics (/studio/analytics): on the site now; today against yesterday (visitors,
//   views, stood, hats, bravos, collects and the money, sign-ins); the hours; top works, pages, where from, devices,
//   browsers, countries when the edge tells us; speed (p50/p95); errors; bots; and the health of the house (uptime,
//   memory, the database, the vault, the register, mail, Stripe, the queues). The page refreshes itself every
//   thirty seconds through /studio/analytics.json. Span: today | 7d | 30d.
const crypto = require('crypto');
const fs = require('fs');
const ROLE = require('./role');
const path = require('path');

const KEEP_DAYS = +(process.env.HITS_KEEP_DAYS || 30); // 30 days (5 Nov: 90 made the nightly dump 150 MB)
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|python-requests|curl\/|wget|go-http-client|okhttp|monitor|uptime|render\/|pingdom|betterstack/i;
const SKIP = /^\/(static|healthz|sw\.js|favicon|\.well-known|vendor|app\/)/;

function device(ua) {
  if (/iPad|Tablet|Silk/i.test(ua)) return 'tablet';
  if (/iPhone|Android.*Mobile|Mobile/i.test(ua)) return 'phone';
  return 'computer';
}
function browser(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  if (/CriOS/.test(ua)) return 'Chrome';
  if (/FxiOS/.test(ua)) return 'Firefox';
  return 'Other';
}
// The path as a page: a work keeps its slug (/w/:slug, /m/:maker/:slug → /w/:slug), everything else keeps its first
// two parts, query dropped, ids and tokens folded, so the table stays small and the report reads.
function page(p) {
  p = String(p || '/').split('?')[0];
  let m;
  if ((m = p.match(/^\/w\/([^/]+)/))) return '/w/' + m[1];
  if ((m = p.match(/^\/m\/([^/]+)\/([^/]+)/))) return '/w/' + m[2];
  if ((m = p.match(/^\/(easel|closer|license|bench|stroll\/side)\/([^/]+)/))) return `/${m[1]}/${m[2]}`;
  if ((m = p.match(/^\/(c|t|d|k|seat|i|pass|signin|curate\/join|committee\/join|account\/join|show|g|collector|hang|yours\/p|p)\/[^/]+/))) return `/${m[1]}/…`;
  const parts = p.split('/').filter(Boolean);
  return '/' + parts.slice(0, 2).map(x => (/^\d+$/.test(x) || x.length > 24 ? '…' : x)).join('/');
}
function kindOf(p) {
  if (/^\/img\//.test(p)) return 'img';
  if (/^\/(api|oembed|iiif)\b/.test(p)) return 'api';
  if (/^\/(static|vendor|app)\//.test(p) || /\.(js|css|png|svg|webmanifest|ico)$/.test(p)) return 'static';
  return 'page';
}

function mountAnalytics(app, { db, V, C, studioOnly, isStudio = () => false, ledger, mailState }) {
  db.exec(`CREATE TABLE IF NOT EXISTS hits (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, status INTEGER NOT NULL, ms INTEGER NOT NULL,
    visitor TEXT, ref TEXT, device TEXT, browser TEXT, bot INTEGER NOT NULL DEFAULT 0, country TEXT, bytes INTEGER)`);
  db.exec('CREATE INDEX IF NOT EXISTS hits_at ON hits (at)');
  db.exec('CREATE INDEX IF NOT EXISTS hits_path ON hits (path, at)');
  const started = Date.now();
  // the day's salt, for visitors with no cookie: never kept, never the same tomorrow
  let saltDay = '', salt = '';
  const saltFor = () => { const d = new Date().toISOString().slice(0, 10); if (d !== saltDay) { saltDay = d; salt = crypto.randomBytes(16).toString('hex'); } return salt; };
  const visitorOf = req => {
    const v = req.cookies && req.cookies.wm_v; if (v) return String(v).slice(0, 16);
    const ip = (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
    return crypto.createHash('sha256').update(saltFor() + ip + (req.get('user-agent') || '')).digest('hex').slice(0, 16);
  };
  // in memory: the minute counters for images and static files, who is on the site now, the last errors
  const minute = { img: 0, static: 0, page: 0, api: 0, bot: 0 };
  const minutes = []; // last 60 { t, page, api, img, static, bot, ms[] }
  const present = new Map(); // visitor → { at, path, device }
  // People, not requests (Will, 1 Nov: "how do we have or know real users"): a visitor is counted as a person only when
  // their browser answers: every page sends /api/here after a second and a half in view and once a minute while it stays
  // in view (layout). A scraper fetches pages and runs nothing; a person's browser runs the page. Kept a day per visitor.
  db.exec('CREATE TABLE IF NOT EXISTS here (day TEXT NOT NULL, visitor TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (day, visitor))');
  db.exec('CREATE INDEX IF NOT EXISTS here_at ON here (at)');
  const alive = new Map(); // visitor → last ping (ms)
  const putHere = db.prepare('INSERT OR IGNORE INTO here (day, visitor, at) VALUES (?,?,?)');
  app.post('/api/here', (req, res) => {
    try {
      const ua = req.get('user-agent') || ''; if (BOT.test(ua) || isStudio(req)) return res.sendStatus(204);
      const v = visitorOf(req); const t = Date.now(); alive.set(v, t);
      putHere.run(new Date(t).toISOString().slice(0, 10), v, Math.floor(t / 1000));
      const p = present.get(v); if (p) p.human = true;
    } catch (e) { /* never in the way */ }
    res.sendStatus(204);
  });
  const errors = []; // last 40 { at, path, status, ms }
  let buf = [];
  const insert = db.prepare('INSERT INTO hits (at, path, kind, status, ms, visitor, ref, device, browser, bot, country, bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const flush = db.transaction(rows => { for (const r of rows) insert.run(...r); });
  const tick = () => { try { if (buf.length) { const rows = buf; buf = []; flush(rows); } } catch (e) { console.error('[analytics]', e.message); } };
  const flushTimer = setInterval(tick, 5000); flushTimer.unref();
  const minuteTimer = setInterval(() => {
    minutes.push({ t: Date.now(), ...minute, ms: minute.ms || [] }); if (minutes.length > 60) minutes.shift();
    for (const k of Object.keys(minute)) minute[k] = 0; minute.ms = [];
    const cut = Date.now() - 5 * 60000; for (const [k, v] of present) if (v.at < cut) present.delete(k);
    for (const [k, t] of alive) if (t < cut) alive.delete(k);
  }, 60000); minuteTimer.unref();
  minute.ms = [];
  // (#114) Pruned by the process that runs the chores (the worker in a split house), in batches, never by the website.
  const pruneQ = db.prepare('DELETE FROM hits WHERE id IN (SELECT id FROM hits WHERE at < ? ORDER BY id LIMIT 20000)');
  const prune = () => { try { const cut = Math.floor(Date.now() / 1000) - KEEP_DAYS * 86400; for (let i = 0; i < 100; i++) if (!pruneQ.run(cut).changes) break; } catch (e) { console.error('[analytics] prune', e.message); } };
  if (ROLE.chores && !app.locals.noTimers) { const pruneTimer = setInterval(prune, 86400000); pruneTimer.unref(); setTimeout(prune, 60000).unref(); }
  const rollup = require('./numbers').mountRollup(db);

  app.use((req, res, next) => {
    if (SKIP.test(req.path)) return next();
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
        const kind = kindOf(req.path); const ua = req.get('user-agent') || ''; const bot = BOT.test(ua) ? 1 : 0;
        minute[kind] = (minute[kind] || 0) + 1; if (bot) minute.bot++; if (kind === 'page' && !bot) minute.ms.push(ms);
        if (kind === 'img' || kind === 'static') return;
        const v = visitorOf(req);
        const kid = /^\/kids(\/|$)/.test(req.path); // the kids' corner keeps no one: counted, never a visitor, a referrer or a device (29 Oct)
        if (kind === 'page' && !bot && !kid && req.method === 'GET' && res.statusCode < 400 && !isStudio(req)) present.set(v, { at: Date.now(), path: page(req.path), device: device(ua), human: alive.has(v) });
        if (res.statusCode >= 400 && res.statusCode !== 404 || res.statusCode >= 500) { errors.unshift({ at: new Date().toISOString(), path: req.originalUrl.slice(0, 120), status: res.statusCode, ms }); if (errors.length > 40) errors.pop(); }
        let ref = null; try { const r = req.get('referer'); if (r) { const h = new URL(r).hostname; ref = h === new URL(C.base).hostname ? null : h.replace(/^www\./, ''); } } catch (e) { ref = null; }
        const country = (req.get('cloudfront-viewer-country') || req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || req.get('x-country') || '').toUpperCase().slice(0, 2) || null;
        const bytes = +(res.get('content-length') || 0) || null;
        buf.push([Math.floor(Date.now() / 1000), page(req.path), kind, res.statusCode, ms, bot || kid ? null : v, kid ? null : ref, kid ? null : device(ua), kid ? null : browser(ua), bot, kid ? null : country, bytes]);
      } catch (e) { /* never in the way of a request */ }
    });
    next();
  });

  // ---- the report
  const dayStart = (n = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000) - n * 86400; };
  const spanOf = s => (s === '7d' ? { from: dayStart(6), label: 'Seven days', prev: dayStart(13) } : s === '30d' ? { from: dayStart(29), label: 'Thirty days', prev: dayStart(59) } : { from: dayStart(0), label: 'Today', prev: dayStart(1) });
  // The tables written by SQL keep 'YYYY-MM-DD HH:MM:SS' (UTC); an ISO 'T' compared as text set every count a day out (1 Nov: 'stood 0, −100%').
  const iso = s => new Date(s * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const STEP = "CASE WHEN ms < 1000 THEN ms WHEN ms < 10000 THEN (ms / 50) * 50 ELSE (ms / 1000) * 1000 END";
  function speedOf(since) {
    const out = {}; for (const k of ['page', 'api']) out[k] = { n: 0, p50: 0, p95: 0, max: 0 };
    const tot = q("SELECT kind, COUNT(*) n, MAX(ms) mx FROM hits WHERE at>=? AND bot=0 AND kind IN ('page','api') GROUP BY kind", since);
    const steps = q(`SELECT kind, ${STEP} b, COUNT(*) n FROM hits WHERE at>=? AND bot=0 AND kind IN ('page','api') AND ms IS NOT NULL GROUP BY kind, ${STEP} ORDER BY kind, b`, since);
    for (const t of tot) { const o = out[t.kind]; if (!o) continue; o.n = Number(t.n) || 0; o.max = Number(t.mx) || 0;
      const mine = steps.filter(r => r.kind === t.kind); const all = mine.reduce((a, r) => a + Number(r.n), 0);
      const at = p => { const i = Math.min(all - 1, Math.floor(p * all)); let c = 0; for (const r of mine) { c += Number(r.n); if (c > i) return Number(r.b); } return 0; };
      if (all) { o.p50 = at(0.5); o.p95 = at(0.95); } }
    return out;
  }
  // (#114) Every span is read from the daily rollups (numbers.js): whole days from `spanOf`'s start, today included.
  // Over 7 or 30 days the views and the visitors in the head are exact (hits_vd); a list's "people" (a page's, a device's,
  // a referrer's) is each day's distinct visitors added, so a visitor on three days counts three times there.
  const D0 = s => Math.floor(s / 86400) * 86400;
  const num = rows => rows.map(r => { const o = { ...r }; for (const k of Object.keys(o)) if (!['k', 'path', 'ref', 'slug', 'title'].includes(k) && typeof o[k] === 'string' && /^-?\d+(\.\d+)?$/.test(o[k])) o[k] = Number(o[k]); return o; });
  function counts(from, to) {
    const f0 = D0(from), t0 = D0(to - 1) + 86400;
    const V = one("SELECT COALESCE(SUM(views),0) views, COUNT(DISTINCT CASE WHEN visitor<>'' THEN visitor END) visitors FROM hits_vd WHERE day>=? AND day<?", f0, t0) || {};
    const by = {}; for (const r of q("SELECT dim, SUM(n) n FROM hits_days WHERE dim IN ('api','bot','e5','nf') AND day>=? AND day<? GROUP BY dim", f0, t0)) by[r.dim] = Number(r.n) || 0;
    const t = (sql, ...a) => { try { return one(sql, ...a).n; } catch (e) { return 0; } };
    const f = iso(from), g = iso(to);
    return {
      visitors: Number(V.visitors) || 0, views: Number(V.views) || 0, people: t('SELECT COUNT(DISTINCT visitor) n FROM here WHERE at>=? AND at<?', from, to), api: by.api || 0, bots: by.bot || 0, errors: by.e5 || 0, notFound: by.nf || 0,
      stood: t('SELECT COUNT(*) n FROM stood WHERE at>=? AND at<?', f, g),
      hats: t('SELECT COUNT(*) n FROM applause WHERE at>=? AND at<?', f, g),
      bravos: t('SELECT COUNT(*) n FROM bravos WHERE at>=? AND at<?', f, g),
      collects: t("SELECT COUNT(*) n FROM licenses WHERE status IN ('active','expired') AND price_cents>0 AND starts_at>=? AND starts_at<?", f, g),
      cents: t("SELECT COALESCE(SUM(price_cents),0) n FROM licenses WHERE status IN ('active','expired') AND price_cents>0 AND starts_at>=? AND starts_at<?", f, g),
      // Strangers (23 Oct, the Magnum night's test: do strangers pay?): collectors whose first paid piece is in the span.
      firstTimers: t("SELECT COUNT(*) n FROM (SELECT buyer_id, MIN(starts_at) first FROM licenses WHERE status IN ('active','expired') AND price_cents>0 AND buyer_id IS NOT NULL GROUP BY buyer_id) WHERE first>=? AND first<?", f, g),
      newMakers: t("SELECT COUNT(*) n FROM makers WHERE joined_at>=? AND joined_at<?", f, g),
      asked: t("SELECT COUNT(*) n FROM licenses WHERE status='requested' AND created_at>=? AND created_at<?", f, g),
      signins: t('SELECT COUNT(*) n FROM signins WHERE used_at IS NOT NULL AND used_at>=? AND used_at<?', f, g),
      notes: t('SELECT COUNT(*) n FROM notes WHERE at>=? AND at<?', f, g),
      newWorks: t("SELECT COUNT(*) n FROM works WHERE created_at>=? AND created_at<?", f, g),
    };
  }
  // The part of the report the database answers: made by the worker in a split house, in process otherwise.
  function fromDb(span = 'today') {
    const S = spanOf(span); const now = Math.floor(Date.now() / 1000); const f0 = D0(S.from);
    const cur = counts(S.from, now + 1); const prev = counts(S.prev, S.from);
    const days = span === 'today' ? 1 : span === '7d' ? 7 : 30;
    const hours = num(q("SELECT CAST(k AS BIGINT) h, n views, u visitors FROM hits_days WHERE dim='hour' AND day>=? ORDER BY CAST(k AS BIGINT) LIMIT 800", f0));
    const byDay = days > 1 ? num(q("SELECT day d, n views, u visitors FROM hits_days WHERE dim='page' AND day>=? ORDER BY day LIMIT 400", f0)) : [];
    const top = (where, lim) => num(q(`SELECT k path, SUM(n) views, SUM(u) visitors FROM hits_days WHERE dim='path' AND day>=? AND ${where} GROUP BY k ORDER BY SUM(n) DESC LIMIT ${lim}`, f0));
    const works = top("k LIKE '/w/%'", 12); const pages = top("k NOT LIKE '/w/%'", 14);
    { const slugs = works.map(r => r.path.slice(3)); const T = new Map(slugs.length ? q(`SELECT slug, title FROM works WHERE slug IN (${slugs.map(() => '?').join(',')}) LIMIT 12`, ...slugs).map(r => [r.slug, r.title]) : []);
      for (const r of works) { const sl = r.path.slice(3); r.slug = T.has(sl) ? sl : null; r.title = T.get(sl) || null; } }
    const refs = num(q("SELECT k ref, SUM(u) visitors, SUM(n) views FROM hits_days WHERE dim='ref' AND day>=? GROUP BY k ORDER BY SUM(u) DESC LIMIT 12", f0));
    const direct = Number((one("SELECT COALESCE(SUM(u),0) n FROM hits_days WHERE dim='direct' AND day>=?", f0) || {}).n) || 0;
    const dim = d => num(q("SELECT k, SUM(u) n FROM hits_days WHERE dim=? AND day>=? GROUP BY k ORDER BY SUM(u) DESC LIMIT 12", d, f0));
    const devices = dim('device'), browsers = dim('browser'), countries = dim('country');
    const stoodTop = q("SELECT w.slug, w.title, COUNT(*) n, SUM(s.seconds) secs FROM stood s JOIN works w ON w.id=s.work_id WHERE s.at>=? GROUP BY w.id ORDER BY secs DESC LIMIT 8", iso(S.from));
    // (#92) the median and the 95th from the times counted in steps; the last 24 hours of hits, by their index.
    const speed = speedOf(Math.max(S.from, now - 86400));
    const slow = q("SELECT path, COUNT(*) n, AVG(ms) avg, MAX(ms) max FROM hits WHERE kind='page' AND bot=0 AND at>=? GROUP BY path HAVING COUNT(*)>=3 ORDER BY AVG(ms) DESC LIMIT 8", Math.max(S.from, now - 86400));
    const errs = num(q("SELECT CAST(k AS INTEGER) status, SUM(n) n FROM hits_days WHERE dim='status' AND day>=? GROUP BY k ORDER BY SUM(n) DESC LIMIT 20", f0));
    const bots = num(q("SELECT k path, SUM(n) n FROM hits_days WHERE dim='botpath' AND day>=? GROUP BY k ORDER BY SUM(n) DESC LIMIT 6", f0));
    return { span, label: S.label, days, cur, prev, hours, byDay, works, pages, refs, direct, devices, browsers, countries, stoodTop, speed, slow, errs, bots };
  }
  // The part only this process knows (memory, no statement): who is on the site now, the last minutes, the last errors.
  function liveOf() {
    const sinceMin = minutes.slice(-60);
    const lastHour = { page: sinceMin.reduce((a, m) => a + m.page, 0) + minute.page, img: sinceMin.reduce((a, m) => a + m.img, 0) + minute.img, api: sinceMin.reduce((a, m) => a + m.api, 0) + minute.api, bot: sinceMin.reduce((a, m) => a + m.bot, 0) + minute.bot };
    const onNow = [...present.values()].sort((a, b) => b.at - a.at);
    return { now: { people: alive.size, unconfirmed: [...present.keys()].filter(k => !alive.has(k)).length, where: onNow.filter(x => x.human || alive.size === 0).slice(0, 12), lastHour, minutes: sinceMin.map(m => ({ t: m.t, page: m.page, img: m.img, api: m.api, bot: m.bot })) }, errors: errors.slice(0, 12) };
  }
  // The health the database answers (the worker's) and the health of this process (no statement).
  function healthDb() {
    const dataDir = C.dataDir || process.env.DATA_DIR || '';
    let dbBytes = null, disk = null; if (db.kind === 'postgres') { try { dbBytes = db.prepare('SELECT pg_database_size(current_database()) n').get().n; } catch (e) { dbBytes = null; } } else try { dbBytes = fs.statSync(path.join(dataDir, 'watermark.db')).size; } catch (e) { try { dbBytes = fs.statSync(db.name).size; } catch (e2) { dbBytes = null; } }
    try { const s = fs.statfsSync(dataDir || '.'); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch (e) { disk = null; }
    const hits = one('SELECT COUNT(*) n, MIN(at) first FROM hits');
    const L = app.locals; const t = f => { try { return f(); } catch (e) { return null; } };
    return {
      db: dbBytes, disk, hits: Number(hits.n) || 0, hitsSince: hits.first ? iso(hits.first) : null,
      register: t(() => ledger.verify(db).ok),
      backup: t(() => L.backup && L.backup.summary()), fixity: t(() => L.archive && L.archive.summary()), conservation: t(() => L.conservation && L.conservation.summary()),
      works: one("SELECT COUNT(*) n FROM works WHERE status='held'").n, restoring: one("SELECT COUNT(*) n FROM works WHERE status='restoring'").n,
      waiting: { requests: one("SELECT COUNT(*) n FROM licenses WHERE status='requested'").n, unpaid: one("SELECT COUNT(*) n FROM licenses WHERE status='awaiting_payment' AND created_at >= datetime('now','-3 days')").n },
      fiveHour: t(() => one('SELECT COUNT(*) n FROM hits WHERE status>=500 AND at>=?', Math.floor(Date.now() / 1000) - 3600).n) || 0, // the alarm's count (the hits keep seconds)
    };
  }
  function healthLive() {
    const mem = process.memoryUsage(); const L = app.locals; const t = f => { try { return f(); } catch (e) { return null; } };
    return {
      uptime: Date.now() - started, node: process.version, pid: process.pid, mem: { rss: mem.rss, heap: mem.heapUsed, heapTotal: mem.heapTotal },
      mail: mailState ? mailState() : null, stripe: C.stripeKey ? (/^[sr]k_live_/.test(C.stripeKey) ? 'live' : 'test') : 'off',
      closer: !!process.env.ANTHROPIC_API_KEY, speech: t(() => L.speech && L.speech.on() ? L.speech.provider() : false), signing: !!(process.env.C2PA_CERT && process.env.C2PA_KEY),
      loadavg: t(() => require('os').loadavg().map(x => +x.toFixed(2))), staging: !!C.staging,
    };
  }
  // On the website (ROLE=web, read when asked so a test can stand as one) the report and the health are the worker's,
  // read in one statement; NUMBERS_DESK=1 makes them here as before (the switch of 20 Nov, for a house with no worker).
  const webNow = () => String(process.env.ROLE || '').toLowerCase() === 'web' && process.env.NUMBERS_DESK !== '1';
  const kept = k => (app.locals.numbers ? app.locals.numbers.read(k) : null);
  function report(span = 'today') {
    if (webNow()) {
      const K = kept('report:' + span); if (!K || !K.fresh) return null;
      return { ...K.v, at: new Date(K.at).toISOString(), made: K.at, ...liveOf(), health: { ...(K.v.health || {}), ...healthLive() } };
    }
    rollup.roll();
    return { at: new Date().toISOString(), ...fromDb(span), ...liveOf(), health: health() };
  }
  function health() {
    if (webNow()) { const K = kept('health'); return { ...(K && K.fresh ? K.v : {}), ...healthLive(), made: K && K.fresh ? K.at : null }; }
    return { ...healthDb(), ...healthLive() };
  }
  // (20 Nov, the second 502; #114) Shut on the website while no fresh kept report exists for the span; open when the
  // worker has made one. NUMBERS_DESK=0 shuts it anywhere, NUMBERS_DESK=1 opens it anywhere (and makes it in process).
  const shut = (span = 'today') => {
    if (process.env.NUMBERS_DESK === '0') return true;
    if (process.env.NUMBERS_DESK === '1') return false;
    if (!webNow()) return false;
    const K = kept('report:' + span); return !(K && K.fresh);
  };
  const SHUT_WORDS = 'The numbers are worked out in the back room every few minutes, and there is no recent set to show. Nothing is lost: every visit is still counted. Try again in a few minutes.';
  app.locals.analytics = { report, health, fromDb, healthDb, healthLive, liveOf, rollup, present: () => alive.size, shut, SHUT_WORDS };

  // ---- the page
  const { esc } = V;
  const n = x => (x == null ? '–' : Number(x).toLocaleString('en-US'));
  const money = c => '$' + (Math.round((c || 0) / 100)).toLocaleString('en-US');
  const bytes = b => (b == null ? '–' : b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(0) + ' MB' : Math.round(b / 1e3) + ' KB');
  const dur = ms => { const s = Math.floor(ms / 1000); if (s < 3600) return Math.floor(s / 60) + ' min'; if (s < 86400) return (s / 3600).toFixed(1) + ' h'; return Math.floor(s / 86400) + ' d ' + Math.floor((s % 86400) / 3600) + ' h'; };
  const delta = (a, b) => { if (!b && !a) return ''; if (!b) return '<i class="an-up">new</i>'; const d = Math.round((a - b) / b * 100); return `<i class="${d >= 0 ? 'an-up' : 'an-dn'}">${d >= 0 ? '+' : ''}${d}%</i>`; };
  const stat = (label, v, p, fmt = n) => `<div class="an-s"><b>${fmt(v)}</b><span>${esc(label)}</span>${p == null ? '' : delta(v, p)}</div>`;
  function bars(rows, keyT, keyV, labelFn) {
    const max = Math.max(1, ...rows.map(r => r[keyV])); const W = 100 / Math.max(rows.length, 1);
    return `<svg class="an-bars" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">${rows.map((r, i) => `<rect x="${(i * W).toFixed(2)}" y="${(32 - r[keyV] / max * 30).toFixed(2)}" width="${Math.max(W - 0.6, 0.4).toFixed(2)}" height="${(r[keyV] / max * 30).toFixed(2)}"><title>${esc(labelFn(r))}</title></rect>`).join('')}</svg>`;
  }
  function list(rows, cols) { return rows.length ? `<table class="an-t">${rows.map(r => `<tr>${cols.map(c => `<td>${c(r)}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="an-none">Nothing yet.</p>'; }
  function body(R) {
    const H = R.health; const c = R.cur, p = R.prev;
    const hourRows = (() => { if (R.days > 1) return R.byDay.map(d => ({ k: new Date(d.d * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), v: d.views, u: d.visitors })); const m = new Map(R.hours.map(h => [h.h, h])); const out = []; const d0 = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000); for (let i = 0; i < 24; i++) { const h = m.get(d0 + i * 3600); out.push({ k: `${i}:00`, v: h ? h.views : 0, u: h ? h.visitors : 0 }); } return out; })();
    const minuteRows = R.now.minutes.length ? R.now.minutes.map(m => ({ k: new Date(m.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), v: m.page + m.api, u: m.img })) : [];
    const flag = ok => `<i class="an-dot ${ok === null || ok === undefined ? 'an-na' : ok ? 'an-ok' : 'an-bad'}"></i>`;
    return `<section class="studio-wrap an" data-an>
<div class="an-head"><div><p class="k">Back office</p><h1>The numbers.</h1><p class="lede">${esc(R.label)} · as of ${new Date(R.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}${R.made ? ', worked out in the back room every few minutes' : ''} · nothing here names a person.</p></div>
<nav class="an-span">${[['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']].map(([k, t]) => `<a href="/studio/analytics?span=${k}"${R.span === k ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav></div>

<div class="an-grid">
<article class="an-card an-now"><h2>On the site now</h2><p class="an-big">${n(R.now.people)}<span>${R.now.people === 1 ? 'person' : 'people'} in the last five minutes, their browsers answering</span></p><p class="an-line">${n(R.now.unconfirmed)} more fetched pages and ran nothing: scrapers and crawlers that do not say so. The house in your own hands is not counted.</p>
<p class="an-line">Last hour: ${n(R.now.lastHour.page)} pages · ${n(R.now.lastHour.api)} API · ${n(R.now.lastHour.img)} pictures · ${n(R.now.lastHour.bot)} by bots</p>
${minuteRows.length ? bars(minuteRows, 'k', 'v', r => `${r.k}: ${r.v} requests, ${r.u} pictures`) : ''}
${R.now.where.length ? `<ul class="an-where">${R.now.where.map(w => `<li><span>${esc(w.path)}</span><i>${esc(w.device)}</i></li>`).join('')}</ul>` : ''}</article>

<article class="an-card an-wide"><h2>${esc(R.label)}<small> against the ${R.days === 1 ? 'day' : R.days === 7 ? 'seven days' : 'thirty days'} before</small></h2>
<div class="an-stats">${stat('people', c.people, p.people)}${stat('addresses that fetched pages', c.visitors, p.visitors)}${stat('page views', c.views, p.views)}${stat('stood before a work', c.stood, p.stood)}${stat('hats', c.hats, p.hats)}${stat('bravos', c.bravos, p.bravos)}${stat('collected & licensed', c.collects, p.collects)}${stat('first-time collectors', c.firstTimers, p.firstTimers)}${stat('makers joined', c.newMakers, p.newMakers)}${stat('taken', c.cents, p.cents, money)}${stat('asked the maker', c.asked, p.asked)}${stat('sign-ins', c.signins, p.signins)}${stat('guest-book lines', c.notes, p.notes)}${stat('works arrived', c.newWorks, p.newWorks)}${stat('API calls', c.api, p.api)}</div>
${bars(hourRows, 'k', 'v', r => `${r.k}: ${r.v} views, ${r.u} visitors`)}<p class="an-axis"><span>${esc(hourRows[0] ? hourRows[0].k : '')}</span><span>${esc(hourRows[hourRows.length - 1] ? hourRows[hourRows.length - 1].k : '')}</span></p></article>

<article class="an-card"><h2>Works, most seen</h2>${list(R.works, [r => `<a href="/w/${esc(r.slug || r.path.slice(3))}">${esc(r.title || r.path)}</a>`, r => n(r.views), r => `<i>${n(r.visitors)} people</i>`])}</article>
<article class="an-card"><h2>Works, longest stood before</h2>${list(R.stoodTop, [r => `<a href="/w/${esc(r.slug)}">${esc(r.title)}</a>`, r => `${Math.round((r.secs || 0) / 60)} min`, r => `<i>${n(r.n)} stood</i>`])}</article>
<article class="an-card"><h2>Pages</h2>${list(R.pages, [r => esc(r.path), r => n(r.views), r => `<i>${n(r.visitors)} people</i>`])}</article>
<article class="an-card"><h2>Where from</h2>${list([{ ref: 'direct, or no referrer', visitors: R.direct }, ...R.refs], [r => esc(r.ref), r => n(r.visitors), r => r.views ? `<i>${n(r.views)} views</i>` : ''])}</article>
<article class="an-card"><h2>Devices</h2>${list(R.devices, [r => esc(r.k), r => n(r.n)])}<h2>Browsers</h2>${list(R.browsers, [r => esc(r.k), r => n(r.n)])}${R.countries.length ? `<h2>Countries</h2>${list(R.countries, [r => esc(r.k), r => n(r.n)])}` : '<p class="an-none">Countries arrive once a CDN sits in front of the house.</p>'}</article>

<article class="an-card"><h2>Speed<small> last 24 h, server time</small></h2><div class="an-stats an-stats-3">${stat('pages, median', R.speed.page.p50, null, x => x + ' ms')}${stat('pages, 95th', R.speed.page.p95, null, x => x + ' ms')}${stat('slowest', R.speed.page.max, null, x => x + ' ms')}${stat('API, median', R.speed.api.p50, null, x => x + ' ms')}${stat('API, 95th', R.speed.api.p95, null, x => x + ' ms')}${stat('pages served', R.speed.page.n)}</div>
${R.slow.length ? `<h3>Slowest pages</h3>${list(R.slow, [r => esc(r.path), r => Math.round(r.avg) + ' ms avg', r => `<i>${n(r.n)} · max ${Math.round(r.max)}</i>`])}` : ''}</article>

<article class="an-card"><h2>Errors<small> ${esc(R.label.toLowerCase())}</small></h2>${list(R.errs, [r => `<b>${r.status}</b>`, r => n(r.n), r => `<i>${r.status === 404 ? 'not found' : r.status === 401 || r.status === 403 ? 'refused' : r.status === 429 ? 'rate-limited' : r.status >= 500 ? 'server' : ''}</i>`])}
${R.errors.length ? `<h3>Lately</h3>${list(R.errors, [r => `<b>${r.status}</b>`, r => esc(r.path), r => `<i>${new Date(r.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</i>`])}` : ''}
<h3>Bots</h3>${list(R.bots, [r => esc(r.path), r => n(r.n)])}</article>

<article class="an-card an-wide"><h2>Health</h2><div class="an-health">
<p>${flag(true)}Up ${dur(H.uptime)} · Node ${esc(H.node)} · memory ${bytes(H.mem.rss)} (heap ${bytes(H.mem.heap)} of ${bytes(H.mem.heapTotal)})${H.loadavg ? ` · load ${H.loadavg.join(' / ')}` : ''}</p>
<p>${flag(H.register)}The register ${H.register ? 'verifies' : H.register === false ? 'FAILS to verify' : 'unchecked'} · ${n(H.works)} works held${H.restoring ? ` · <b>${H.restoring} off view for conservation</b>` : ''}</p>
<p>${flag(H.disk ? H.disk.free > 2e9 : null)}Database ${bytes(H.db)} · disk ${H.disk ? `${bytes(H.disk.free)} free of ${bytes(H.disk.total)}` : 'unknown'} · ${n(H.hits)} hits kept${H.hitsSince ? ` since ${new Date(H.hitsSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</p>
<p>${flag(H.mail ? !(H.mail.failed > 0 && H.mail.sent === 0) : null)}Mail ${H.mail ? `${n(H.mail.sent)} sent, ${n(H.mail.failed)} failed${H.mail.last ? ` · last ${esc(String(H.mail.last).slice(0, 60))}` : ''}` : 'state unknown'}</p>
<p>${flag(H.stripe !== 'off')}Stripe ${esc(H.stripe)} · ${flag(H.closer)}guides ${H.closer ? 'on' : 'off'} · ${flag(!!H.speech)}voice ${H.speech ? esc(String(H.speech)) : 'off'} · ${flag(H.signing)}Content Credentials ${H.signing ? 'signing' : 'unsigned'}</p>
<p>${flag(H.backup ? !H.backup.stale : null)}Backups ${H.backup ? `last ${H.backup.last ? esc(String(H.backup.last.at).slice(0, 16)) + (H.backup.last.ok ? '' : ' (failed)') : 'never'}${H.backup.drill ? ` · drill ${esc(String(H.backup.drill.at).slice(0, 16))}${H.backup.drill.ok ? '' : ' (failed)'}` : ''}${H.backup.stale ? ' · <b>STALE</b>' : ''}` : 'unknown'} · ${flag(H.fixity ? !H.fixity.failing : null)}fixity ${H.fixity ? `${n(H.fixity.checked || 0)} checked${H.fixity.failing ? `, <b>${H.fixity.failing} failing</b>` : ''}` : 'unknown'} · conservation ${H.conservation ? `${n(H.conservation.checked || 0)} checked${H.conservation.unsound ? `, <b>${H.conservation.unsound} unsound</b>` : ''}` : 'unknown'}</p>
<p>${flag(!H.waiting.requests)}Waiting: ${n(H.waiting.requests)} requests for the maker · ${n(H.waiting.unpaid)} unpaid in the last three days${H.staging ? ' · <b>the test house</b>' : ''}</p>
</div></article>
</div></section>`;
  }
  // (18 Nov, the 502) The desk asked for the whole report again on every visit and every thirty seconds from every open
  // tab; each asking holds the website's one thread. One report a span is kept for REPORT_KEEP_MS and shared.
  // `report` itself stays fresh for the house's own callers (the digest, the tests); only the two doors below share.
  const REPORT_KEEP_MS = 30000; const kept_ = new Map();
  // (#114) On the website the report is the worker's, read in one statement each time: nothing to share.
  const reportKept = (span = 'today') => { if (webNow()) return report(span); const k = kept_.get(span); if (k && Date.now() - k.at < REPORT_KEEP_MS) return k.R; const R = report(span); kept_.set(span, { at: Date.now(), R }); return R; };
  const spanQ = req => (['today', '7d', '30d'].includes(req.query.span) ? req.query.span : 'today');
  app.get(['/studio/analytics', '/studio/analytics.json'], studioOnly, (req, res, next) => {
    const R = process.env.NUMBERS_DESK === '0' ? null : reportKept(spanQ(req)); if (R) { res.locals.numbers = R; return next(); } // on the website: the kept report or null, one statement
    res.set('Cache-Control', 'private, no-store');
    if (/\.json$/.test(req.path) || req.query.frag) return res.json({ ok: false, closed: true, why: SHUT_WORDS });
    res.send(V.layout({ studio: true, path: '/studio/analytics', title: 'The numbers · Studio', body: `<section class="an"><div class="an-head"><div><p class="k">Back office</p><h1>The numbers.</h1><p class="lede">${V.esc(SHUT_WORDS)}</p><p><a href="/studio">Back to the Studio</a></p></div></div></section>` }));
  });
  app.get('/studio/analytics', studioOnly, (req, res) => {
    const R = res.locals.numbers || reportKept(spanQ(req));
    if (req.query.frag) return res.set('Cache-Control', 'private, no-store').send(body(R));
    res.set('Cache-Control', 'private, no-store').send(V.layout({ studio: true, path: '/studio/analytics', title: 'The numbers · Studio', body: body(R) + `<script>(function(){var s=new URLSearchParams(location.search).get('span')||'today';var busy=false;setInterval(function(){if(document.hidden||busy)return;busy=true;fetch('/studio/analytics?span='+s+'&frag=1',{credentials:'same-origin'}).then(function(r){return r.ok?r.text():''}).then(function(h){if(!h)return;var d=document.createElement('div');d.innerHTML=h;var o=document.querySelector('[data-an]');if(o&&d.firstElementChild)o.replaceWith(d.firstElementChild)}).catch(function(){}).then(function(){busy=false})},60000)})();</script>` }));
  });
  app.get('/studio/analytics.json', studioOnly, (req, res) => { res.set('Cache-Control', 'private, no-store'); res.json(res.locals.numbers || reportKept(spanQ(req))); });
  return { report, health, fromDb, healthDb, healthLive, liveOf, rollup, present: () => alive.size, flush: tick, shut, SHUT_WORDS };
}
module.exports = { mountAnalytics, page, device, browser };
