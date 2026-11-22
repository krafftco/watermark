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
  const STATIC = /^\/(static|img|sw\.js|favicon|apple-touch|app\/|vendor|portrait|healthz|api\/here)|\/stood$/; // beacons are not people waiting
  // (22 Nov, #196) The worker asks its own house for the prepared copies of the stranger's doors (prepared.js: up to
  // PREPARED_PER_ROUND (40) pages every PREPARED_ROUND_MS (10 s), on 127.0.0.1, signed `x-wm-prepare`), and the governor
  // counted each as a visitor: "40 visitors in ten seconds" on a process no visitor reaches, so every copy ask and every
  // chore waited out the full minute. On a process that runs the round (the worker, a one-process house) or a scribe,
  // the house's own requests are not counted. The website (ROLE=web) never runs the round and counts exactly as before.
  const own = (ROLE.chores || ROLE.scribe) ? require('./prepared').isPrepare : () => false;
  const mine = []; // the house's own requests in the last ten seconds, said on /healthz beside the visitors
  app.use((req, res, next) => { if (!STATIC.test(req.path)) { const now = Date.now(); const into = own(req) ? mine : hits; into.push(now); while (into.length && into[0] < now - 10000) into.shift(); } next(); });
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
    setTimeout(() => { if (!chores() && !always) { if (ROLE.chores) console.log(`[governor] ${label} skipped: chores held`); return; } bootChain = bootChain.then(async () => { booting = label; const t0 = Date.now(), r0 = rssMb(); if (ROLE.chores) console.log(`[boot] ${label} begins at ${r0} MB`); /* a chore the process does not survive is named by its beginning */ try { await fn(); } catch (e) { console.error(`[${label}]`, e && e.message || e); } finally { booting = null; /* (20 Nov) each start-up chore says how long it took and what it did to the memory: the worker was ended for memory every seven minutes for three days and no line said which chore */ if (ROLE.chores) console.log(`[boot] ${label}: ${Date.now() - t0} ms, ${r0} to ${rssMb()} MB`); } await settle(label); }); }, at).unref();
  }
  const state = () => ({ rss: rssMb(), limit: memMb, hard: hardMb, pressure: pressure(), busy: busy(), visitors10s: hits.length, own10s: (() => { const t = Date.now() - 10000; while (mine.length && mine[0] < t) mine.shift(); return mine.length; })(), lane: holder, booting, waited, held, load: os.loadavg()[0], up: Math.round((Date.now() - started) / 1000), boots });
  // The kill switch: CHORES=0 in the environment boots the house with every background chore off (feeds, pictures, documents), so a troubled house can be brought back to serve visitors and nothing else.
  // The showing (27 Oct): while the house is being shown (Studio → Launch → 'Showing'), every chore holds too, so a demo never meets a feed.
  let shown = false;
  const chores = () => process.env.CHORES !== '0' && !shown && ROLE.chores && !(app.locals.readonly && app.locals.readonly()); // and never while the house is closed for a move // a web process on a split house runs none of the house's chores
  const hold = on => { shown = !!on; };
  // The hard line (5 Nov, the worker on its own 2 GB box: a Commons feed decoding several big files at once can pass the
  // box's limit and be killed mid-write by the kernel): on a worker, past GOV_MEM_HARD_MB (85% of the box, else 1700 MB)
  // the chores hold at once and, when the memory stays there two minutes, the process leaves cleanly (exit 1) so Render
  // brings it back fresh with its queues resumed from the database. Never on the web, which serves people.
  const hardMb = +process.env.GOV_MEM_HARD_MB || (boxMb() ? Math.round(boxMb() * 0.85) : 1700);
  let hardSince = 0, hardHeld = false;
  // (20 Nov) The memory's own line: on a process that does the chores, a rise of GOV_MEM_JUMP_MB (150) inside five
  // seconds is logged at once with what was running: the lane, the start-up chore, the last large answers from the
  // database and what the process holds outside the heap (pictures are decoded there). Read once a second: the worker
  // went from 275 to 769 MB in one second, between two chores, and nothing said why.
  if ((ROLE.worker || ROLE.scribe) && !quiet()) { const jump = +process.env.GOV_MEM_JUMP_MB || 150; const seen = []; let told = 0;
    setInterval(() => {
      const now = Date.now(), r = rssMb(); seen.push([now, r]); while (seen.length && now - seen[0][0] > 5000) seen.shift();
      if (r - seen[0][1] < jump || now - told < 5000) return; told = now;
      const m = process.memoryUsage(); let bigs = []; try { bigs = require('./pgsync').big().filter(b => now - b.at < 60e3).map(b => `${b.mb} MB ${b.sql}`); } catch (e) { /* SQLite */ }
      let hands = ''; try { const C = app.locals.copies; hands = C && C.inHand ? C.inHand().join(',') : ''; } catch (e) { /* none */ }
      console.error(`[mem] ${seen[0][1]} to ${r} MB in ${Math.round((now - seen[0][0]) / 1000)} s; heap ${Math.round(m.heapUsed / 1048576)}, outside ${Math.round(m.external / 1048576)}, buffers ${Math.round((m.arrayBuffers || 0) / 1048576)} MB; lane ${holder || 'free'}; chore ${booting || 'none'}; scribes ${hands || 'idle'}; large answers: ${bigs.join(' | ') || 'none'}`);
    }, 1000).unref(); }
  if ((ROLE.worker || ROLE.scribe) && !quiet()) setInterval(() => {
    const r = rssMb();
    if (r < hardMb) { if (hardHeld) { hardHeld = false; console.log(`[governor] memory back under the line (${r} MB)`); } hardSince = 0; return; }
    if (!hardSince) { hardSince = Date.now(); hardHeld = true; console.error(`[governor] memory over the hard line: ${r} MB of ${hardMb}; chores hold`); }
    if (Date.now() - hardSince > 120e3) { console.error(`[governor] memory stayed over the line two minutes (${r} MB); the worker restarts itself`); setTimeout(() => process.exit(1), 500); }
  }, 10e3).unref();
  // The website's own line (7 Nov, the warm had held the web at 3.8 GB for a morning with nothing to say so): past
  // GOV_WEB_LINE_MB (60% of the box, else 1200 MB) /healthz says `mem.over`, the watch fails and the alarm writes the house.
  // The website never exits itself: it serves people; a restart is a person's call (and, with the disk off, costs nothing).
  const webLineMb = +process.env.GOV_WEB_LINE_MB || (boxMb() ? Math.round(boxMb() * 0.6) : 1200);
  const over = () => rssMb() > webLineMb;
  const choresBase = chores;
  const choresHard = () => choresBase() && !hardHeld;
  app.locals.governor = { settle, turn, boot, pressure, busy, state, sleep, chores: choresHard, hold, showing: () => shown, overHard: () => hardHeld, hardMb, webLineMb, over };
  return app.locals.governor;
}

module.exports = { mountGovernor };
