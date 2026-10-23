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
const path = require('path');

const KEEP_DAYS = +(process.env.HITS_KEEP_DAYS || 90);
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

function mountAnalytics(app, { db, V, C, studioOnly, ledger, mailState }) {
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
  }, 60000); minuteTimer.unref();
  minute.ms = [];
  const prune = () => { try { db.prepare('DELETE FROM hits WHERE at < ?').run(Math.floor(Date.now() / 1000) - KEEP_DAYS * 86400); } catch (e) { /* later */ } };
  const pruneTimer = setInterval(prune, 86400000); pruneTimer.unref(); setTimeout(prune, 60000).unref();

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
        if (kind === 'page' && !bot && req.method === 'GET' && res.statusCode < 400) present.set(v, { at: Date.now(), path: page(req.path), device: device(ua) });
        if (res.statusCode >= 400 && res.statusCode !== 404 || res.statusCode >= 500) { errors.unshift({ at: new Date().toISOString(), path: req.originalUrl.slice(0, 120), status: res.statusCode, ms }); if (errors.length > 40) errors.pop(); }
        let ref = null; try { const r = req.get('referer'); if (r) { const h = new URL(r).hostname; ref = h === new URL(C.base).hostname ? null : h.replace(/^www\./, ''); } } catch (e) { ref = null; }
        const country = (req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || req.get('x-country') || '').toUpperCase().slice(0, 2) || null;
        const bytes = +(res.get('content-length') || 0) || null;
        buf.push([Math.floor(Date.now() / 1000), page(req.path), kind, res.statusCode, ms, bot ? null : v, ref, device(ua), browser(ua), bot, country, bytes]);
      } catch (e) { /* never in the way of a request */ }
    });
    next();
  });

  // ---- the report
  const dayStart = (n = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000) - n * 86400; };
  const spanOf = s => (s === '7d' ? { from: dayStart(6), label: 'Seven days', prev: dayStart(13) } : s === '30d' ? { from: dayStart(29), label: 'Thirty days', prev: dayStart(59) } : { from: dayStart(0), label: 'Today', prev: dayStart(1) });
  const iso = s => new Date(s * 1000).toISOString();
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  function counts(from, to) {
    const H = one('SELECT COUNT(*) views, COUNT(DISTINCT visitor) visitors FROM hits WHERE kind=\'page\' AND bot=0 AND status<400 AND at>=? AND at<?', from, to);
    const A = one('SELECT COUNT(*) n FROM hits WHERE kind=\'api\' AND at>=? AND at<?', from, to).n;
    const B = one('SELECT COUNT(*) n FROM hits WHERE bot=1 AND at>=? AND at<?', from, to).n;
    const E = one('SELECT COUNT(*) n FROM hits WHERE status>=500 AND at>=? AND at<?', from, to).n;
    const N4 = one('SELECT COUNT(*) n FROM hits WHERE status=404 AND kind=\'page\' AND at>=? AND at<?', from, to).n;
    const t = (sql, ...a) => { try { return one(sql, ...a).n; } catch (e) { return 0; } };
    const f = iso(from), g = iso(to);
    return {
      visitors: H.visitors, views: H.views, api: A, bots: B, errors: E, notFound: N4,
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
  function report(span = 'today') {
    const S = spanOf(span); const now = Math.floor(Date.now() / 1000);
    const cur = counts(S.from, now + 1); const prev = counts(S.prev, S.from);
    const days = span === 'today' ? 1 : span === '7d' ? 7 : 30;
    const hours = q("SELECT (at/3600)*3600 h, COUNT(*) views, COUNT(DISTINCT visitor) visitors FROM hits WHERE kind='page' AND bot=0 AND status<400 AND at>=? GROUP BY h ORDER BY h", S.from);
    const byDay = days > 1 ? q("SELECT (at/86400)*86400 d, COUNT(*) views, COUNT(DISTINCT visitor) visitors FROM hits WHERE kind='page' AND bot=0 AND status<400 AND at>=? GROUP BY d ORDER BY d", S.from) : [];
    const works = q("SELECT h.path, COUNT(*) views, COUNT(DISTINCT h.visitor) visitors, w.title, w.slug FROM hits h LEFT JOIN works w ON w.slug=substr(h.path,4) WHERE h.kind='page' AND h.bot=0 AND h.status<400 AND h.path LIKE '/w/%' AND h.at>=? GROUP BY h.path ORDER BY views DESC LIMIT 12", S.from);
    const pages = q("SELECT path, COUNT(*) views, COUNT(DISTINCT visitor) visitors FROM hits WHERE kind='page' AND bot=0 AND status<400 AND path NOT LIKE '/w/%' AND at>=? GROUP BY path ORDER BY views DESC LIMIT 14", S.from);
    const refs = q("SELECT ref, COUNT(DISTINCT visitor) visitors, COUNT(*) views FROM hits WHERE kind='page' AND bot=0 AND ref IS NOT NULL AND at>=? GROUP BY ref ORDER BY visitors DESC LIMIT 12", S.from);
    const direct = one("SELECT COUNT(DISTINCT visitor) n FROM hits WHERE kind='page' AND bot=0 AND ref IS NULL AND at>=?", S.from).n;
    const devices = q("SELECT device k, COUNT(DISTINCT visitor) n FROM hits WHERE kind='page' AND bot=0 AND at>=? GROUP BY device ORDER BY n DESC", S.from);
    const browsers = q("SELECT browser k, COUNT(DISTINCT visitor) n FROM hits WHERE kind='page' AND bot=0 AND at>=? GROUP BY browser ORDER BY n DESC", S.from);
    const countries = q("SELECT country k, COUNT(DISTINCT visitor) n FROM hits WHERE kind='page' AND bot=0 AND country IS NOT NULL AND at>=? GROUP BY country ORDER BY n DESC LIMIT 12", S.from);
    const stoodTop = q("SELECT w.slug, w.title, COUNT(*) n, SUM(s.seconds) secs FROM stood s JOIN works w ON w.id=s.work_id WHERE s.at>=? GROUP BY w.id ORDER BY secs DESC LIMIT 8", iso(S.from));
    const speedRows = q("SELECT kind, ms FROM hits WHERE at>=? AND bot=0", Math.max(S.from, now - 86400));
    const speed = {}; for (const k of ['page', 'api']) { const a = speedRows.filter(r => r.kind === k).map(r => r.ms); speed[k] = { n: a.length, p50: pct(a, .5), p95: pct(a, .95), max: a.length ? Math.max(...a) : 0 }; }
    const slow = q("SELECT path, COUNT(*) n, AVG(ms) avg, MAX(ms) max FROM hits WHERE kind='page' AND bot=0 AND at>=? GROUP BY path HAVING n>=3 ORDER BY avg DESC LIMIT 8", Math.max(S.from, now - 86400));
    const errs = q("SELECT status, COUNT(*) n FROM hits WHERE status>=400 AND at>=? GROUP BY status ORDER BY n DESC", S.from);
    const bots = q("SELECT path, COUNT(*) n FROM hits WHERE bot=1 AND at>=? GROUP BY path ORDER BY n DESC LIMIT 6", S.from);
    const sinceMin = minutes.slice(-60);
    const lastHour = { page: sinceMin.reduce((a, m) => a + m.page, 0) + minute.page, img: sinceMin.reduce((a, m) => a + m.img, 0) + minute.img, api: sinceMin.reduce((a, m) => a + m.api, 0) + minute.api, bot: sinceMin.reduce((a, m) => a + m.bot, 0) + minute.bot };
    const onNow = [...present.values()].sort((a, b) => b.at - a.at);
    return { at: new Date().toISOString(), span, label: S.label, days, now: { people: present.size, where: onNow.slice(0, 12), lastHour, minutes: sinceMin.map(m => ({ t: m.t, page: m.page, img: m.img, api: m.api, bot: m.bot })) },
      cur, prev, hours, byDay, works, pages, refs, direct, devices, browsers, countries, stoodTop, speed, slow, errs, errors: errors.slice(0, 12), bots, health: health() };
  }
  function health() {
    const mem = process.memoryUsage(); const dataDir = C.dataDir || process.env.DATA_DIR || '';
    let dbBytes = null, disk = null; try { dbBytes = fs.statSync(path.join(dataDir, 'watermark.db')).size; } catch (e) { try { dbBytes = fs.statSync(db.name).size; } catch (e2) { dbBytes = null; } }
    try { const s = fs.statfsSync(dataDir || '.'); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch (e) { disk = null; }
    const hits = one('SELECT COUNT(*) n, MIN(at) first FROM hits');
    const L = app.locals; const t = f => { try { return f(); } catch (e) { return null; } };
    return {
      uptime: Date.now() - started, node: process.version, pid: process.pid, mem: { rss: mem.rss, heap: mem.heapUsed, heapTotal: mem.heapTotal }, db: dbBytes, disk, hits: hits.n, hitsSince: hits.first ? iso(hits.first) : null,
      register: t(() => ledger.verify(db).ok), mail: mailState ? mailState() : null, stripe: C.stripeKey ? (/^[sr]k_live_/.test(C.stripeKey) ? 'live' : 'test') : 'off',
      closer: !!process.env.ANTHROPIC_API_KEY, speech: t(() => L.speech && L.speech.on() ? L.speech.provider() : false), signing: !!(process.env.C2PA_CERT && process.env.C2PA_KEY),
      backup: t(() => L.backup && L.backup.summary()), fixity: t(() => L.archive && L.archive.summary()), conservation: t(() => L.conservation && L.conservation.summary()),
      works: one("SELECT COUNT(*) n FROM works WHERE status='held'").n, restoring: one("SELECT COUNT(*) n FROM works WHERE status='restoring'").n,
      waiting: { requests: one("SELECT COUNT(*) n FROM licenses WHERE status='requested'").n, unpaid: one("SELECT COUNT(*) n FROM licenses WHERE status='awaiting_payment' AND created_at >= datetime('now','-3 days')").n },
      loadavg: t(() => require('os').loadavg().map(x => +x.toFixed(2))), staging: !!C.staging,
    };
  }
  app.locals.analytics = { report, health, present: () => present.size };

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
<div class="an-head"><div><p class="k">Back office</p><h1>The numbers.</h1><p class="lede">${esc(R.label)} · ${new Date(R.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · refreshes every thirty seconds · nothing here names a person.</p></div>
<nav class="an-span">${[['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']].map(([k, t]) => `<a href="/studio/analytics?span=${k}"${R.span === k ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav></div>

<div class="an-grid">
<article class="an-card an-now"><h2>On the site now</h2><p class="an-big">${n(R.now.people)}<span>${R.now.people === 1 ? 'person' : 'people'} in the last five minutes</span></p>
<p class="an-line">Last hour: ${n(R.now.lastHour.page)} pages · ${n(R.now.lastHour.api)} API · ${n(R.now.lastHour.img)} pictures · ${n(R.now.lastHour.bot)} by bots</p>
${minuteRows.length ? bars(minuteRows, 'k', 'v', r => `${r.k}: ${r.v} requests, ${r.u} pictures`) : ''}
${R.now.where.length ? `<ul class="an-where">${R.now.where.map(w => `<li><span>${esc(w.path)}</span><i>${esc(w.device)}</i></li>`).join('')}</ul>` : ''}</article>

<article class="an-card an-wide"><h2>${esc(R.label)}<small> against the ${R.days === 1 ? 'day' : R.days === 7 ? 'seven days' : 'thirty days'} before</small></h2>
<div class="an-stats">${stat('visitors', c.visitors, p.visitors)}${stat('page views', c.views, p.views)}${stat('stood before a work', c.stood, p.stood)}${stat('hats', c.hats, p.hats)}${stat('bravos', c.bravos, p.bravos)}${stat('collected & licensed', c.collects, p.collects)}${stat('first-time collectors', c.firstTimers, p.firstTimers)}${stat('makers joined', c.newMakers, p.newMakers)}${stat('taken', c.cents, p.cents, money)}${stat('asked the maker', c.asked, p.asked)}${stat('sign-ins', c.signins, p.signins)}${stat('guest-book lines', c.notes, p.notes)}${stat('works arrived', c.newWorks, p.newWorks)}${stat('API calls', c.api, p.api)}</div>
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
  app.get('/studio/analytics', studioOnly, (req, res) => {
    const R = report(['today', '7d', '30d'].includes(req.query.span) ? req.query.span : 'today');
    if (req.query.frag) return res.set('Cache-Control', 'private, no-store').send(body(R));
    res.set('Cache-Control', 'private, no-store').send(V.layout({ studio: true, path: '/studio/analytics', title: 'The numbers · Studio', body: body(R) + `<script>(function(){var s=new URLSearchParams(location.search).get('span')||'today';setInterval(function(){if(document.hidden)return;fetch('/studio/analytics?span='+s+'&frag=1',{credentials:'same-origin'}).then(function(r){return r.ok?r.text():''}).then(function(h){if(!h)return;var d=document.createElement('div');d.innerHTML=h;var o=document.querySelector('[data-an]');if(o&&d.firstElementChild)o.replaceWith(d.firstElementChild)}).catch(function(){})},30000)})();</script>` }));
  });
  app.get('/studio/analytics.json', studioOnly, (req, res) => { res.set('Cache-Control', 'private, no-store'); res.json(report(['today', '7d', '30d'].includes(req.query.span) ? req.query.span : 'today')); });
  return { report, health, flush: tick };
}
module.exports = { mountAnalytics, page, device, browser };
