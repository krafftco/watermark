// The kept numbers (20 Nov, #114). Render's log of the two 502s: the numbers desk's statements over `hits` each held the
// website's one thread 9–13 s (COUNT(DISTINCT visitor) grouped over a span of every hit), ten in a row. Now:
//   - the hits are rolled up by day (`hits_days`: per day and dimension, the count and the day's distinct visitors;
//     `hits_vd`: one row per visitor a day, for the span's exact visitors and the views). A closed day is rolled once;
//     today is rolled again at each making. The report reads only the rollups, so even the worker's report is small.
//   - the worker (ROLE=worker) makes the report for today, 7d and 30d, the health, the desk's summary and the owner's
//     view every NUMBERS_EVERY_S (300) and keeps each as JSON in `kept_numbers` with the time it was made.
//   - the website (ROLE=web) reads a kept answer in ONE statement (`read`) and says when it was made. A kept answer older
//     than NUMBERS_FRESH_S (900) is not shown as current: the desk keeps its closed words until a fresh one exists.
// A house that is one process (no ROLE: the tests, a local house) makes its numbers in process when asked, as before: it
// has no back room to hand them to, and a clock there would hold the same thread every few minutes whether anyone looks
// or not. It still reads through the rollups, so the smoke proves the same arithmetic the worker runs.
'use strict';
const ROLE = require('./role');
const DAY = 86400;
const P = "kind='page' AND bot=0 AND status<400"; // a page view, as the report has always counted one

function mountRollup(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS hits_days (day INTEGER NOT NULL, dim TEXT NOT NULL, k TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, u INTEGER, PRIMARY KEY (day, dim, k));
    CREATE TABLE IF NOT EXISTS hits_vd (day INTEGER NOT NULL, visitor TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, visitor));
    CREATE INDEX IF NOT EXISTS hits_days_dim ON hits_days (dim, day)`);
  const KEEP = +(process.env.ROLLUP_KEEP_DAYS || 400); // the rollups are small: kept beyond the hits themselves
  const BACKFILL = +(process.env.ROLLUP_BACKFILL || 8); // closed days rolled in one making, besides today (a day of 100,000 hits is 2–4 s on the worker; a first backfill spreads over rounds)
  const W = 'FROM hits WHERE at>=? AND at<?';
  const S = {
    clearD: db.prepare('DELETE FROM hits_days WHERE day=?'),
    clearV: db.prepare('DELETE FROM hits_vd WHERE day=?'),
    vd: db.prepare(`INSERT INTO hits_vd (day, visitor, views) SELECT CAST(? AS BIGINT), COALESCE(visitor,''), COUNT(*) ${W} AND ${P} GROUP BY COALESCE(visitor,'')`),
    hour: db.prepare(`INSERT INTO hits_days (day, dim, k, n, u) SELECT CAST(? AS BIGINT), 'hour', CAST((at/3600)*3600 AS TEXT), COUNT(*), COUNT(DISTINCT visitor) ${W} AND ${P} GROUP BY (at/3600)*3600`),
    path: db.prepare(`INSERT INTO hits_days (day, dim, k, n, u) SELECT CAST(? AS BIGINT), 'path', path, COUNT(*), COUNT(DISTINCT visitor) ${W} AND ${P} GROUP BY path`),
    ref: db.prepare(`INSERT INTO hits_days (day, dim, k, n, u) SELECT CAST(? AS BIGINT), 'ref', ref, COUNT(*), COUNT(DISTINCT visitor) ${W} AND kind='page' AND bot=0 AND ref IS NOT NULL GROUP BY ref`),
    device: db.prepare(`INSERT INTO hits_days (day, dim, k, n, u) SELECT CAST(? AS BIGINT), 'device', device, COUNT(*), COUNT(DISTINCT visitor) ${W} AND kind='page' AND bot=0 AND device IS NOT NULL GROUP BY device`),
    browser: db.prepare(`INSERT INTO hits_days (day, dim, k, n, u) SELECT CAST(? AS BIGINT), 'browser', browser, COUNT(*), COUNT(DISTINCT visitor) ${W} AND kind='page' AND bot=0 AND browser IS NOT NULL GROUP BY browser`),
    country: db.prepare(`INSERT INTO hits_days (day, dim, k, n, u) SELECT CAST(? AS BIGINT), 'country', country, COUNT(*), COUNT(DISTINCT visitor) ${W} AND kind='page' AND bot=0 AND country IS NOT NULL GROUP BY country`),
    botpath: db.prepare(`INSERT INTO hits_days (day, dim, k, n, u) SELECT CAST(? AS BIGINT), 'botpath', path, COUNT(*), 0 ${W} AND bot=1 GROUP BY path`),
    status: db.prepare(`INSERT INTO hits_days (day, dim, k, n, u) SELECT CAST(? AS BIGINT), 'status', CAST(status AS TEXT), COUNT(*), 0 ${W} AND status>=400 GROUP BY status`),
    singles: db.prepare(`SELECT COUNT(CASE WHEN ${P} THEN 1 END) views, COUNT(DISTINCT CASE WHEN ${P} THEN visitor END) visitors, COUNT(CASE WHEN kind='page' AND bot=0 AND ref IS NULL THEN 1 END) dn, COUNT(DISTINCT CASE WHEN kind='page' AND bot=0 AND ref IS NULL THEN visitor END) du, COUNT(CASE WHEN kind='api' THEN 1 END) api, COUNT(CASE WHEN bot=1 THEN 1 END) bots, COUNT(CASE WHEN status>=500 THEN 1 END) e5, COUNT(CASE WHEN status=404 AND kind='page' THEN 1 END) nf ${W}`),
    put: db.prepare('INSERT INTO hits_days (day, dim, k, n, u) VALUES (?,?,?,?,?)'),
    rolled: db.prepare("SELECT day FROM hits_days WHERE dim='rolled' AND n=1 AND day>=? LIMIT 2000"),
    first: db.prepare('SELECT MIN(at) t FROM hits'),
    pruneD: db.prepare('DELETE FROM hits_days WHERE day<?'),
    pruneV: db.prepare('DELETE FROM hits_vd WHERE day<?'),
  };
  const rollDay = db.transaction((d, closed) => {
    const a = [d, d, d + DAY];
    S.clearD.run(d); S.clearV.run(d);
    S.vd.run(...a); S.hour.run(...a); S.path.run(...a); S.ref.run(...a); S.device.run(...a); S.browser.run(...a); S.country.run(...a); S.botpath.run(...a); S.status.run(...a);
    const x = S.singles.get(d, d + DAY) || {};
    S.put.run(d, 'page', '', +x.views || 0, +x.visitors || 0); S.put.run(d, 'direct', '', +x.dn || 0, +x.du || 0);
    S.put.run(d, 'api', '', +x.api || 0, 0); S.put.run(d, 'bot', '', +x.bots || 0, 0); S.put.run(d, 'e5', '', +x.e5 || 0, 0); S.put.run(d, 'nf', '', +x.nf || 0, 0);
    S.put.run(d, 'rolled', '', closed ? 1 : 0, 0);
  });
  // Today again; any closed day not yet rolled (BACKFILL at most), oldest first; a day is closed ten minutes after it ends
  // (the website writes its hits every five seconds).
  function roll(now = Math.floor(Date.now() / 1000)) {
    const today = Math.floor(now / DAY) * DAY; const t0 = Date.now();
    const first = (S.first.get() || {}).t; const from = Math.max(first ? Math.floor(Number(first) / DAY) * DAY : today, today - KEEP * DAY);
    const done = new Set(S.rolled.all(from).map(r => Number(r.day)));
    let n = 0;
    for (let d = from; d < today && n < BACKFILL; d += DAY) if (!done.has(d)) { rollDay(d, now >= d + DAY + 600); n++; }
    rollDay(today, false);
    return { days: n + 1, ms: Date.now() - t0 };
  }
  function prune(now = Math.floor(Date.now() / 1000)) { const cut = Math.floor(now / DAY) * DAY - KEEP * DAY; S.pruneD.run(cut); S.pruneV.run(cut); }
  return { roll, rollDay, prune };
}

function mountNumbers(app, { db, cfg = {} }) {
  db.exec('CREATE TABLE IF NOT EXISTS kept_numbers (k TEXT PRIMARY KEY, at INTEGER NOT NULL, v TEXT NOT NULL)');
  const EVERY = 1000 * (+process.env.NUMBERS_EVERY_S || 300);
  const FRESH = 1000 * (+process.env.NUMBERS_FRESH_S || 900);
  const get = db.prepare('SELECT at, v FROM kept_numbers WHERE k=?');
  const put = db.prepare('INSERT INTO kept_numbers (k, at, v) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET at=excluded.at, v=excluded.v');
  // One statement: the kept answer and when it was made, or null.
  function read(k) { const r = get.get(k); if (!r) return null; try { const at = Number(r.at); return { at, v: JSON.parse(r.v), fresh: Date.now() - at < FRESH }; } catch (e) { return null; } }
  const keep = (k, v) => { put.run(k, Date.now(), JSON.stringify(v)); };
  // The worker's round: the rollups, then each answer, each on its own so one fault does not stop the rest.
  let running = false, last = null;
  function makeAll() {
    if (running) return last; running = true; const t0 = Date.now(); const done = [], failed = [];
    const A = app.locals.analytics, L = app.locals;
    const step = (k, fn) => { try { const v = fn(); if (v !== undefined) keep(k, v); done.push(k); return v; } catch (e) { failed.push(k); console.error(`[numbers] ${k}:`, String(e && e.message || e).slice(0, 200)); return null; } };
    try {
      if (A && A.rollup) step('rollup', () => { A.rollup.roll(); A.rollup.prune(); return undefined; });
      const H = A ? step('health', () => A.healthDb()) : null;
      const R = {};
      for (const span of ['today', '7d', '30d']) R[span] = A ? step('report:' + span, () => ({ ...A.fromDb(span), health: H || {} })) : null;
      if (L.deskSummary && L.deskSummary.make) step('desk', () => L.deskSummary.make());
      if (L.deskOwner && L.deskOwner.make) step('owner', () => { const live = A ? A.liveOf() : {}; const w = r => (r ? { ...r, ...live, health: H || {} } : null); return L.deskOwner.make({ rt: w(R.today), r7: w(R['7d']), r30: w(R['30d']), H }); });
    } finally { running = false; }
    last = { at: Date.now(), ms: Date.now() - t0, done, failed };
    console.log(`[numbers] made in ${last.ms} ms: ${done.join(', ')}${failed.length ? ' · failed: ' + failed.join(', ') : ''}`);
    return last;
  }
  if (!cfg.noTimers && ROLE.worker) { setTimeout(makeAll, 30e3).unref(); setInterval(makeAll, EVERY).unref(); }
  app.locals.numbers = { read, makeAll, keep, last: () => last, FRESH, EVERY };
  return app.locals.numbers;
}

module.exports = { mountRollup, mountNumbers };
