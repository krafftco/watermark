'use strict';
// The watchdog (9 Nov, the stall: the website alive and logging but answering no one, for an hour at a time, until a
// person noticed and pressed Restart). On the website the house asks itself for /healthz over loopback every
// WATCHDOG_EVERY_S (15); WATCHDOG_MISSES (3) answers missed in a row (each given WATCHDOG_TIMEOUT_S, 8) and it exits,
// so Render brings a fresh one at once. Memory past the web's line (governor.webLineMb) for WATCHDOG_MEM_S (120) does
// the same. A second thread keeps time too: if the main thread itself stops beating for WATCHDOG_FROZEN_S (60), the
// thread ends the process from outside. Every exit is logged as [watchdog] with the reason. WATCHDOG=0 turns it off.
const http = require('http');
const { Worker } = require('worker_threads');

// (#115) The arithmetic: one hold of the thread for holdMs can make at most this many asks in a row miss (an ask every
// `every` ms, each given `timeout` ms). The bridge's longest hold on the website (pgsync.maxHold: the hold, one long
// statement and the grace) must make fewer than `misses`, and be under the frozen-thread line, or one slow page would
// look like a dead house. `patience` says whether it does; start() widens the count of misses when it does not.
const missesFor = (holdMs, every, timeout) => (holdMs < timeout ? 0 : Math.floor((holdMs - timeout) / every) + 1);
function patience({ holdMs, every = 15000, timeout = 8000, misses = 3, frozenS = 60 }) {
  const worst = missesFor(holdMs, every, timeout);
  return { holdMs, worst, misses, ok: worst < misses && holdMs < frozenS * 1000, needMisses: worst + 1 };
}
function start({ port, governor, role }) {
  if (process.env.WATCHDOG === '0' || process.env.NODE_ENV === 'test') return null;
  if (role && !role.web) return null; // the worker and the scribes have their own hard line
  const every = 1000 * (+process.env.WATCHDOG_EVERY_S || 15);
  const timeout = 1000 * (+process.env.WATCHDOG_TIMEOUT_S || 8);
  let misses = +process.env.WATCHDOG_MISSES || 3;
  const memMs = 1000 * (+process.env.WATCHDOG_MEM_S || 120);
  const frozenS = +process.env.WATCHDOG_FROZEN_S || 60;
  { const P = patience({ holdMs: require('./pgsync').maxHold(), every, timeout, misses, frozenS });
    if (P.worst >= misses) { console.error(`[watchdog] the database's longest hold (${P.holdMs} ms) could miss ${P.worst} answers in a row; counting ${P.needMisses} before a restart`); misses = P.needMisses; }
    if (P.holdMs >= frozenS * 1000) console.error(`[watchdog] the database's longest hold (${P.holdMs} ms) is over the frozen-thread line (${frozenS} s): lower DB_HOLD_MS or DB_LIMIT_MAX_MS`); }
  const state = { missed: 0, overSince: 0, lastOk: null, started: Date.now() };
  const leave = why => { console.error(`[watchdog] ${why}; the website restarts itself`); setTimeout(() => process.exit(1), 300); };

  // The beat a second thread watches: if the main thread blocks, the beat stops.
  const beat = new Int32Array(new SharedArrayBuffer(4));
  setInterval(() => { Atomics.store(beat, 0, Math.floor(Date.now() / 1000) & 0x7fffffff); }, 1000).unref();
  Atomics.store(beat, 0, Math.floor(Date.now() / 1000) & 0x7fffffff);
  try {
    const w = new Worker(`
      const { workerData } = require('worker_threads');
      const beat = workerData.beat, limit = workerData.frozenS;
      setInterval(() => {
        const now = Math.floor(Date.now() / 1000) & 0x7fffffff;
        const last = Atomics.load(beat, 0);
        if (now - last > limit) { console.error('[watchdog] the main thread has not beaten for ' + (now - last) + ' s; the website restarts itself'); process.kill(process.pid, 'SIGKILL'); }
      }, 5000);
    `, { eval: true, workerData: { beat, frozenS } });
    w.unref();
  } catch (e) { console.error('[watchdog] no second thread:', e.message); }

  // Grace after start: the boot is not judged.
  const ask = () => new Promise(resolve => {
    const r = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout, headers: { 'x-watchdog': '1' } }, res => { res.resume(); resolve(res.statusCode > 0 && res.statusCode < 500); });
    r.on('timeout', () => { r.destroy(); resolve(false); });
    r.on('error', () => resolve(false));
  });
  setInterval(async () => {
    if (Date.now() - state.started < 1000 * (process.env.WATCHDOG_GRACE_S != null ? +process.env.WATCHDOG_GRACE_S : 90)) return;
    const ok = await ask();
    if (ok) { state.missed = 0; state.lastOk = Date.now(); } else { state.missed++; console.error(`[watchdog] /healthz missed (${state.missed} of ${misses})`); if (state.missed >= misses) leave(`/healthz missed ${misses} times in a row`); }
    if (governor && governor.over && governor.over()) { if (!state.overSince) { state.overSince = Date.now(); console.error(`[watchdog] memory over the website's line (${Math.round(process.memoryUsage().rss / 1048576)} MB of ${governor.webLineMb})`); } else if (Date.now() - state.overSince > memMs) leave(`memory over the line for ${Math.round(memMs / 1000)} s`); } else state.overSince = 0;
  }, every).unref();
  return state;
}
module.exports = { start, patience, missesFor };
