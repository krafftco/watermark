// The role (28 Oct 2026, the morning the house moved onto Postgres): one image, two kinds of process. ROLE in the
// environment: unset (or 'all') is the house as it always ran, everything in one process; 'web' serves people and runs
// only what must live beside them (payments settling, arrivals from its own disk, the vault copy of what it took in,
// push, the balcony's clock, its own caches); 'worker' runs every chore of the house (the fills, feeds, pictures,
// documents, conservation, fixity, backups, the letters, Friday pay, the lab) and serves no one. Both talk to the one
// Postgres; the worker writes a heartbeat the web's /healthz reports. Nothing changes until ROLE is set.
'use strict';
const ROLE = (process.env.ROLE || 'all').toLowerCase();
module.exports = {
  role: ROLE,
  web: ROLE !== 'worker',      // this process answers visitors
  chores: ROLE !== 'web',      // this process runs the house's own chores
  worker: ROLE === 'worker',   // this process is the worker alone
  split: ROLE === 'web' || ROLE === 'worker',
};
