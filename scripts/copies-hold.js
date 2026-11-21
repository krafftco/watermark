'use strict';
// For scripts/copies.js only (#123): loaded with --require into ONE copy of the website, it holds that copy's thread the
// way a slow statement does: every COPIES_HOLD_EVERY_MS (3000) the copy's own bridge asks SELECT pg_sleep(COPIES_HOLD_S)
// (2), and Atomics.wait keeps every visitor of that copy waiting until it answers. Nothing in src is changed for it.
if (process.env.COPIES_HOLD_ON === '1') {
  const pg = require('../src/pgsync'); const open = pg.open;
  pg.open = (...a) => {
    const db = open(...a); const s = +process.env.COPIES_HOLD_S || 2, every = +process.env.COPIES_HOLD_EVERY_MS || 3000;
    setTimeout(() => setInterval(() => { try { db.prepare(`SELECT pg_sleep(${s}) AS z`).get(); } catch (e) { console.error('[hold]', e.message); } }, every).unref(), 5000).unref();
    console.log(`[hold] this copy's thread is held ${s} s every ${every} ms`);
    return db;
  };
}
