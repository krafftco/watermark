// Several copies of the website (20 Nov 2026, #123, docs/SCALE.md "Stage 2: several copies"). The website is one
// process with one thread, and the bridge (pgsync.js) holds that thread for every answer, so the house is safe at scale
// only as several copies side by side behind Render's balancer (Render calls each an instance). Three things here, each
// in the database so every copy (and the worker, and the scribes) sees the same:
//   - who I am: `ME`, Render's own instance id when it gives one, else the host and the process. Kept on the rows a copy
//     alone can finish (an original on its own disk: works.vault_on; a file sent through it: arrivals.host).
//   - who is alive: each process writes `house_instances` every INSTANCE_BEAT_S (15) seconds; a copy unseen for
//     INSTANCE_STALE_S (90) is gone (Render replaces a copy with a new one and a new disk: what was on the old disk is gone).
//   - a lease: `lease(k, ms)` takes the row `leases.k` for this process for ms, or renews it; false while another
//     process holds it. One statement on both engines (INSERT … ON CONFLICT DO UPDATE … WHERE), so two copies asking at
//     the same moment cannot both take it. `pinned(name, every, fn)` is a timer that runs on whichever process holds its
//     lease (the first to ask; it renews it at each run; if that process dies the lease runs out and another takes it).
//     `withLease(k, ms, fn)` runs fn while holding k, or answers `BUSY` without running it.
// A house that is one process (the tests, a local house) is the only holder of everything and nothing changes for it.
'use strict';
const os = require('os');

const ME = String(process.env.RENDER_INSTANCE_ID || `${os.hostname()}:${process.pid}`).slice(0, 120);
const BEAT_MS = () => 1000 * (+process.env.INSTANCE_BEAT_S || 15);
const STALE_MS = () => 1000 * (+process.env.INSTANCE_STALE_S || 90);
const BUSY = Object.freeze({ busy: true });

function mount(app, { db, cfg = {}, role = 'all' }) {
  db.exec(`CREATE TABLE IF NOT EXISTS leases (k TEXT PRIMARY KEY, holder TEXT NOT NULL, until_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS house_instances (id TEXT PRIMARY KEY, role TEXT NOT NULL, started_ms INTEGER NOT NULL, at_ms INTEGER NOT NULL)`);
  const S = {
    take: db.prepare('INSERT INTO leases (k, holder, until_ms) VALUES (?,?,?) ON CONFLICT (k) DO UPDATE SET holder=excluded.holder, until_ms=excluded.until_ms WHERE leases.until_ms < ? OR leases.holder=excluded.holder'),
    drop: db.prepare('DELETE FROM leases WHERE k=? AND holder=?'),
    holder: db.prepare('SELECT holder, until_ms FROM leases WHERE k=?'),
    beat: db.prepare('INSERT INTO house_instances (id, role, started_ms, at_ms) VALUES (?,?,?,?) ON CONFLICT (id) DO UPDATE SET role=excluded.role, at_ms=excluded.at_ms'),
    seen: db.prepare('SELECT at_ms FROM house_instances WHERE id=?'),
    live: db.prepare('SELECT id, role, started_ms, at_ms FROM house_instances WHERE at_ms > ? ORDER BY id LIMIT 50'),
    prune: db.prepare('DELETE FROM house_instances WHERE at_ms < ?'),
  };
  const started = Date.now();
  function beat() { try { const now = Date.now(); S.beat.run(ME, role, started, now); S.prune.run(now - 86400e3); } catch (e) { console.error('[instances] beat', String(e.message || e).slice(0, 160)); } }
  beat();
  if (!cfg.noTimers) setInterval(beat, BEAT_MS()).unref();

  // Is the process `id` alive? This one always; one never seen (a row from before #123) is not.
  function alive(id) {
    if (!id) return false; if (id === ME) return true;
    const r = S.seen.get(String(id)); return !!(r && Number(r.at_ms) > Date.now() - STALE_MS());
  }
  function lease(k, ms) { const now = Date.now(); return S.take.run(String(k), ME, now + Math.max(1000, +ms || 60e3), now).changes > 0; }
  function release(k) { try { S.drop.run(String(k), ME); } catch (e) { /* it runs out by itself */ } }
  async function withLease(k, ms, fn) {
    if (!lease(k, ms)) return BUSY;
    try { return await fn(); } finally { release(k); }
  }
  // A timer for one process of the house: fn runs only where the lease is held (taken for three rounds, renewed each run).
  function pinned(name, everyMs, fn) {
    return () => { let mine = false; try { mine = lease('timer:' + name, everyMs * 3); } catch (e) { console.error('[instances] lease', name, String(e.message || e).slice(0, 160)); } return mine ? fn() : undefined; };
  }
  const live = () => S.live.all(Date.now() - STALE_MS()).map(r => ({ id: r.id, role: r.role, up: Math.round((Date.now() - Number(r.started_ms)) / 1000), seen: Math.round((Date.now() - Number(r.at_ms)) / 1000) }));
  const holderOf = k => { const r = S.holder.get(String(k)); return r && Number(r.until_ms) > Date.now() ? r.holder : null; };
  app.locals.instances = { ME, alive, lease, release, withLease, pinned, live, holderOf, beat, BUSY };
  return app.locals.instances;
}

// Boot's DDL, one process at a time (#123). Every process runs CREATE TABLE IF NOT EXISTS and ALTER TABLE … ADD COLUMN
// as it starts; two at once on Postgres can fail on each other (a duplicate type, a column that just appeared), and a
// process that fails at boot is restarted by Render. So on Postgres the boot holds a session lock on the bridge's
// connection, asked with pg_try_advisory_lock (never waiting on the database: its lock_timeout is fifteen seconds) for
// up to BOOT_LOCK_WAIT_S (120), and gives it back on the next turn of the event loop, when createApp has returned.
const BOOT_KEY = 72310123; // any constant; the house's only advisory lock at boot
function bootLock(db) {
  if (!db || db.kind !== 'postgres') return;
  const until = Date.now() + 1000 * (+process.env.BOOT_LOCK_WAIT_S || 120); const nap = new Int32Array(new SharedArrayBuffer(4));
  let got = false, waited = 0;
  for (;;) {
    try { got = !!db.prepare(`SELECT pg_try_advisory_lock(${BOOT_KEY}) AS got`).get().got; } catch (e) { console.error('[boot] lock', String(e.message || e).slice(0, 160)); break; }
    if (got || Date.now() > until) break;
    Atomics.wait(nap, 0, 0, 250); waited += 250; // the process is not serving yet: nothing else is held by this wait
  }
  if (waited) console.log(`[boot] ${got ? 'waited' : 'gave up waiting'} ${waited} ms for another process's boot`);
  if (got) setImmediate(() => { try { db.prepare(`SELECT pg_advisory_unlock(${BOOT_KEY}) AS done`).get(); } catch (e) { /* the session's end gives it back */ } });
}

module.exports = { mount, bootLock, ME, BUSY };
