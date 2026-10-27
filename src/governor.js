// The governor (Will, 27 Oct: "are we overwhelming the website; we need to be resourceful"; the house went down under two
// background jobs pressed at once on a 512 MB box). One rule for every heavy job the house runs for itself (feeds in, the
// pictures in the books, documents, the illustrations of an edition): they take turns, one item at a time through one lane;
// between items they wait while a visitor is being served or while memory is high; and a job that brought the house down
// twice is paused, not resumed, until a person says. Visitors are never governed; only the house's own chores are.
const os = require('os');

function mountGovernor(app, { memMb = +process.env.GOV_MEM_MB || 380, busyN = +process.env.GOV_BUSY || 6, pauseMs = +process.env.GOV_PAUSE_MS || 600 } = {}) {
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
  const state = () => ({ rss: rssMb(), limit: memMb, pressure: pressure(), busy: busy(), visitors10s: hits.length, lane: holder, waited, held, load: os.loadavg()[0] });
  app.locals.governor = { settle, turn, pressure, busy, state, sleep };
  return app.locals.governor;
}

module.exports = { mountGovernor };
