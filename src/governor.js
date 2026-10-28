const ROLE = require('./role');
// The governor (Will, 27 Oct: "are we overwhelming the website; we need to be resourceful"; the house went down under two
// background jobs pressed at once on a 512 MB box). One rule for every heavy job the house runs for itself (feeds in, the
// pictures in the books, documents, the illustrations of an edition): they take turns, one item at a time through one lane;
// between items they wait while a visitor is being served or while memory is high; and a job that brought the house down
// twice is paused, not resumed, until a person says. Visitors are never governed; only the house's own chores are.
const os = require('os');

// The box's own limit (a container's cgroup), so the memory line follows the plan: 40% of what the box has, else 380 MB.
function boxMb() {
  try { for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) { const s = require('fs').readFileSync(f, 'utf8').trim(); if (/^\d+$/.test(s) && +s < 2 ** 50) return Math.round(+s / 1048576); } } catch (e) { /* no cgroup */ }
  return 0;
}

function mountGovernor(app, { memMb = +process.env.GOV_MEM_MB || (boxMb() ? Math.round(boxMb() * 0.4) : 380), busyN = +process.env.GOV_BUSY || 6, pauseMs = +process.env.GOV_PAUSE_MS || 600, bootQuietS = +process.env.BOOT_QUIET_S || 180, bootGapS = +process.env.BOOT_GAP_S || 15 } = {}) {
  const hits = []; // visitor requests (pages and API) in the last ten seconds
  const STATIC = /^\/(static|img|sw\.js|favicon|apple-touch|app\/|vendor|portrait|healthz)/;
  app.use((req, res, next) => { if (!STATIC.test(req.path)) { const now = Date.now(); hits.push(now); while (hits.length && hits[0] < now - 10000) hits.shift(); } next(); });
  const rssMb = () => Math.round(process.memoryUsage().rss / 1048576);
  const pressure = () => rssMb() > memMb;
  const busy = () => { const now = Date.now(); while (hits.length && hits[0] < now - 10000) hits.shift(); return hits.length > busyN; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const quiet = () => !!app.locals.noTimers;
  let waited = 0, held = 0;
  // Wait for the house to be free: a floor between items; longer while visitors are served or memory is high (at most a minute).
  async function settle(label = 'chore') {
    if (quiet()) return;
    await sleep(pauseMs);
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      if (pressure()) { held++; await sleep(3000); continue; }
      if (busy()) { waited++; await sleep(1500); continue; }
      return;
    }
    console.log(`[governor] ${label} went on after a minute's wait (rss ${rssMb()} MB, ${hits.length} visitors in ten seconds)`);
  }
  // One lane: heavy work one item at a time, whichever job it belongs to.
  let chain = Promise.resolve(); let holder = null;
  function turn(label, fn) {
    const p = chain.then(async () => { holder = label; try { return await fn(); } finally { holder = null; } });
    chain = p.then(() => settle(label), () => settle(label));
    return p;
  }
  // The quiet boot (27 Oct: a restart fired a dozen chores inside its first minute, on top of the deploy's own cold minute):
  // every chore the house runs for itself at start is scheduled through here instead of its own setTimeout: nothing before
  // BOOT_QUIET_S (three minutes), then one at a time, BOOT_GAP_S apart in the order registered, each through the lane and
  // skipped outright when the chores are held. Under test (noTimers) nothing is scheduled.
  // The boot chores take turns in a lane of their own (27 Oct, evening: the speech fill, reading every guide once the
  // voice was set, held the one lane for an hour and a book's pictures pressed by hand waited behind it): a hand-pressed
  // job (the pictures of one book, a feed, a re-cut) never queues behind the house's own housekeeping.
  const started = Date.now(); const boots = []; let bootChain = Promise.resolve(); let booting = null;
  function boot(label, fn, ms = 0, { always = false } = {}) { // always: a web process's own housekeeping (its renditions), run whatever the role or the showing
    if (quiet()) return;
    const at = Math.max(ms, bootQuietS * 1000 + boots.length * bootGapS * 1000); boots.push(label);
    setTimeout(() => { if (!chores() && !always) { if (ROLE.chores) console.log(`[governor] ${label} skipped: chores held`); return; } bootChain = bootChain.then(async () => { booting = label; try { await fn(); } catch (e) { console.error(`[${label}]`, e && e.message || e); } finally { booting = null; } await settle(label); }); }, at).unref();
  }
  const state = () => ({ rss: rssMb(), limit: memMb, pressure: pressure(), busy: busy(), visitors10s: hits.length, lane: holder, booting, waited, held, load: os.loadavg()[0], up: Math.round((Date.now() - started) / 1000), boots });
  // The kill switch: CHORES=0 in the environment boots the house with every background chore off (feeds, pictures, documents), so a troubled house can be brought back to serve visitors and nothing else.
  // The showing (27 Oct): while the house is being shown (Studio → Launch → 'Showing'), every chore holds too, so a demo never meets a feed.
  let shown = false;
  const chores = () => process.env.CHORES !== '0' && !shown && ROLE.chores; // a web process on a split house runs none of the house's chores
  const hold = on => { shown = !!on; };
  app.locals.governor = { settle, turn, boot, pressure, busy, state, sleep, chores, hold, showing: () => shown };
  return app.locals.governor;
}

module.exports = { mountGovernor };
