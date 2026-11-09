'use strict';
// Built ahead (9 Nov; the scale test: after a restart the first visitor to the artists page, the old front and
// Discover waited two to three seconds while the website built a list the worker could have had ready).
// `register(key, { ms, build })` names a piece of plain data any process can build; `get(key)` answers it.
// In a split house the worker builds each one every `ms` and writes it to `kept_data`; the website reads the row
// (one small question, re-read only when the worker has written a newer one) and builds for itself only when there
// is no row, or the row is older than six times `ms` (the worker is down). In a one-process house, and under test
// (where nothing is kept), `get` is `build` with a memory of `ms`.
function mountShared(app, { db, ROLE, cfg = {} }) {
  const off = process.env.NODE_ENV === 'test' || cfg.noKeep;
  db.exec('CREATE TABLE IF NOT EXISTS kept_data (k TEXT PRIMARY KEY, v TEXT, at INTEGER)');
  const reg = new Map(), mem = new Map();
  const POLL = 30e3; // how often the website looks for a newer row
  const write = (key, v, at) => { try { db.prepare('INSERT INTO kept_data (k, v, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at=excluded.at').run(key, JSON.stringify(v), at); } catch (e) { console.error('[shared]', key, e.message.split('\n')[0]); } };
  function buildNow(key, r, save) { const at = Date.now(); const v = r.build(); mem.set(key, { v, at, seen: at, rowAt: at }); if (save) write(key, v, at); return v; }
  function get(key) {
    const r = reg.get(key); if (!r) throw new Error('shared: no such key ' + key);
    if (off) return r.build();
    const now = Date.now(), h = mem.get(key);
    const reader = ROLE.split && ROLE.web;
    if (!reader) return h && now - h.at < r.ms ? h.v : buildNow(key, r, false);
    if (h && now - h.seen < POLL) return h.v;
    let row = null; try { row = db.prepare('SELECT at FROM kept_data WHERE k=?').get(key); } catch (e) { row = null; }
    const rowAt = row ? Number(row.at) : 0;
    if (rowAt && now - rowAt < r.ms * 6) {
      if (h && h.rowAt === rowAt) { h.seen = now; return h.v; }
      try { const full = db.prepare('SELECT v FROM kept_data WHERE k=?').get(key); const v = JSON.parse(full.v); mem.set(key, { v, at: rowAt, seen: now, rowAt }); return v; } catch (e) { /* a bad row: build */ }
    }
    if (h && now - h.at < r.ms) { h.seen = now; return h.v; } // built here not long ago; the worker is behind
    return buildNow(key, r, true);
  }
  function register(key, { ms, build }) { reg.set(key, { ms, build }); }
  // The worker's round: anything due is built and written, one a tick so no round is long.
  function round() {
    for (const [key, r] of reg) {
      let at = 0; try { const row = db.prepare('SELECT at FROM kept_data WHERE k=?').get(key); at = row ? Number(row.at) : 0; } catch (e) { /* */ }
      if (Date.now() - at < r.ms * 0.8) continue;
      try { const t = Date.now(); buildNow(key, r, true); const d = Date.now() - t; if (d > 2000) console.log('[shared]', key, 'built in', d, 'ms'); } catch (e) { console.error('[shared]', key, e.message.split('\n')[0]); }
      return key;
    }
    return null;
  }
  if (!off && !cfg.noTimers && ROLE.split && ROLE.chores) { setTimeout(round, 20e3).unref(); setInterval(round, 15e3).unref(); }
  app.locals.shared = { register, get, round, keys: () => [...reg.keys()] };
  return app.locals.shared;
}
module.exports = { mountShared };
