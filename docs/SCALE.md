# Scale: the house at any number

20 November 2026. Will's order: "build the mechanism to allow this site to run at any number… capable of 10 million
objects." The CTO session leads; workers take one issue each (docs/WORKERS.md, agents/NOTES.md). This page is the plan
and its proof. It is changed when a stage is proved, never before.

## Why the house stops today (measured in the code, 20 Nov)

- The website is one process with one thread. It asks Postgres through `src/pgsync.js`, which holds that thread until
  the answer comes (Atomics.wait). There are 3,796 such askings in 183 files.
- A question may hold the thread for DB_WAIT_MS: 20 seconds on the website. The watchdog ends a process that misses
  three answers of eight seconds. So one slow question is an outage for every visitor (13, 18 and 20 Nov).
- The live database is Render Postgres with 2 CPU and 8 GB of memory (read from Render on 20 Nov; this page said 1 GB, which was stale).
- The scale gate (`scripts/big-house.js`) walks the house on SQLite. A room quick there is not shown quick on Postgres
  through the bridge; that is how the numbers desk passed the gate and stopped the house.

## The rule every stage serves

No visitor waits on another visitor's question. A page reads a bounded number of rows by an index, whatever the house
holds. Whatever walks the collection runs in the back room and leaves its answer for the website to read.

## The stages (each ends with a proof on Postgres, on the test house, before live)

| Stage | Holds | What changes | Proof |
|---|---|---|---|
| 0 Guard | today's 62,000 | Every website question limited to a few seconds, and a page that runs over says so; the numbers and the health made by the worker and only read by the website (#114, #115) | A test that asks a slow question and then loads the front page; Will opens the numbers desk on live |
| 1 Truth | 100,000 | The scale gate runs on Postgres through the bridge, as live does, at 100,000 and at 1,000,000 synthetic works; every room over budget is fixed or shut | CI job green at 100,000; the list of rooms that fail at 1,000,000 |
| 2 Many hands | 250,000 | The website asks without waiting (an async pool beside the bridge), first for the rooms strangers use: Wander, a work's page, Find, the hall, the collection. Several copies of the website run side by side | Load run: a slow desk open while 200 visitors wander, none delayed |
| 3 Million | 1,000,000 | Every public room on the async path; Find on its own index; the visit log and the register kept by month; every list paged by key | The gate at 1,000,000 on Postgres, every public room within budget |
| 4 Ten million | 10,000,000 | Read copies of the database; the edge answers most pages without the website; arrivals in bulk through a queue | The gate at 10,000,000 (records without pictures), and a costed storage plan |

A billion is not planned here. It is a different company's infrastructure and is decided when ten million is real.

## What costs money (for Will; every figure is an estimate until checked against the bill)

- The database: more memory is the cheapest speed there is. At 8 GB the memory is not the present limit; the one thread of the website is.
- The website: two or more copies from stage 2.
- The pictures: storage grows with every master kept. At ten million objects, whether the house keeps a master of
  every open-access museum picture or keeps the record and its display copies is the largest cost decision in the plan.
- The reading of each arrival by a model (the guide, the bag check): a cost per work, met by `src/spend.js`.
- The workers who build this: sessions on Will's plan.

## Lanes open now

- Guard: #115 (the limit), #114 (the numbers by the worker).
- Truth: the gate on Postgres.
- Many hands: the async path and its first rooms.

## Stage 2: how a room is moved

20 November 2026, #117. Measured in this lane on the shell's Postgres 16 (a client in its own process, so the client
is not frozen with the server). Every number here is from that machine, not from the test house or live.

### What the measurement changed in the plan

- A statement on the bridge holds the website's one thread (Atomics.wait). While it waits, Node reads no request at
  all, on either path. With `SELECT pg_sleep(2)` on the bridge, a route that asks only the async pool answered in
  1,858 ms; a route on the bridge, the same. With the same sleep on the async pool, a bridge route answered in 3 ms
  and a pool route in 12 ms.
- So moving a room's quick statements to the pool does not keep a slow statement elsewhere from stopping the house.
  What protects visitors is that the statements that can be slow leave the bridge, wherever they are, and that the
  website runs as several copies, so a held thread is one copy of several and not the house.
- The order of work is therefore by the cost of statements first and visitors served second: the `[pg slow]` log
  and /healthz `pgSlow` (live), the scale gate's statements over 250 ms, and any count or list that grows with the
  house. A room that only asks one row by key gains throughput from moving, not safety.
- What a stranger's rooms ask today (12 works, SQLite): a work's page 42 statements in about 20 modules, every one
  by key; Wander's open feed 18, a word's feed 12, the side doors 12, the Wander page 1 (kept 15 s).

### The pool (src/adb.js)

- `app.locals.adb`: `get(sql, ...params)`, `all(sql, ...params)`, `run(sql, ...params)`, each a promise of what the
  bridge returns (a row or undefined; rows; `{ changes, lastInsertRowid }`). Parameters as the bridge takes them
  (`?` positional, one array, or `@name` with one object).
- The SQL is the house's own: every statement passes through `dialect.toPg` exactly as on the bridge, with the same
  cache, the same RETURNING for an INSERT, int8 and numeric read as numbers, and each row made plain the way the
  bridge's JSON makes it (a Date becomes its ISO string), so a moved statement returns what it returned before.
- On SQLite (tests and the scale gate) `adb` runs the same statement on the same better-sqlite3 connection and
  resolves with it; an error rejects. Every test runs unchanged on both engines.
- The limit: ADB_LIMIT_MS (4,000 on the website, 120,000 elsewhere) as `statement_timeout` on every connection of the
  pool. Postgres cancels a statement past it; that call rejects (code 57014); the connection is kept and serves the
  next. On SQLite a statement cannot be ended from its own thread: there is no limit, only the log.
- The slow log: ADB_SLOW_MS (500): `[adb slow] <ms> ms: <sql>`, the worst twenty kept for /healthz `adbSlow`, apart
  from the bridge's `pgSlow`.
- The pool: ADB_POOL connections (4), opened when first asked, closed by `adb.close()`; it never holds a test open.
  Each website copy uses 1 (the bridge) + ADB_POOL connections; the worker and each scribe 1. Check the database
  plan's connection limit before raising ADB_POOL or the number of copies.

### How a route is moved (Wander's side doors, /stroll/side/:slug)

Before: `app.get('/stroll/side/:slug', (req, res) => { … const n = db.prepare("SELECT COUNT(*) n FROM works WHERE
maker_id=? AND status='held'").get(mk.id).n; … })`. After: `app.get('/stroll/side/:slug', async (req, res) => { …
const n = (await adb.get("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'", mk.id)).n; … })`.

- The handler becomes async; the route's own statements become `await adb.…`; what it renders does not change.
- A helper from another module (wanderJSON, buyerOf, the bench, the pocket) stays on the bridge until its own
  module is moved, as an async twin beside the sync one; the sync one stays for its other callers.
- A cache that held a value now holds the promise (`app.locals.kept` keeps whatever it is given), so one question
  serves everyone who arrives while it is asked.
- Errors: Express 5 hands a rejected handler to the house's error page, as a throw did.
- The SQL gates read the new form: `scripts/sql-check.js` checks `adb.get/all/run(` literals; `test/listreads.js`
  counts `adb.get(` as one row.

### Reads and writes in one request

- Writes stay on the bridge. A bridge write outside a transaction is committed when it returns, so a pool read
  after it in the same request sees it: one primary, read committed.
- Inside `db.transaction`, a pool connection cannot see the uncommitted rows. `adb` checks `db.inTransaction()` and
  then asks the bridge instead (same connection, same answer, and it waits as before). Nothing moved here runs in one.
- Proposed for later, when a write path moves: `adb.tx(async t => …)` on one pool connection (BEGIN … COMMIT), with
  money paths last and each with its test. Read copies (stage 4) end read-your-writes: a read after a write in the
  same request must then go to the primary; the pool will need a `primary` handle for that.

### What is not moved yet, and why

- Transactions and every statement inside one (above). The money: licences, settling, payouts, the pocket: proved
  on the bridge by their tests; moved last.
- Builders that `app.locals.shared` calls synchronously (the open Wander pool, the hall, today): in a split house
  they run on the worker, where waiting holds no visitor.
- DDL at mount and `src/indexes.js`: the house is not serving yet.
- Shared helpers with many callers (wanderJSON, buyerOf, makerOf, closerOf, applause): each gets an async twin when
  a room that needs it moves.

### The order of rooms

1. The statements that can be slow on the paths strangers use (this issue: Wander's word and maker pools, the
   makers list behind a maker's wander, the side doors' counts of a maker's or an artist's works and their strips,
   the shelf's list of books). Then Find's question, `/art/:slug` and `/m/:maker` counts.
2. The desks' heavy statements, where #114 has not sent them to the worker: the Studio's front page, the numbers,
   a museum's desks. These have stopped the house; they move before any quick visitor read.
3. Wander's data doors and pages whole (done here for `/api/stroll`, `/stroll/side`, `/wander` and `/`, apart from
   the helpers named above). A work's page: 42 statements by key in about 20 modules; it moves module by module,
   for throughput. Then the collection, the hall, Find, `/m/:maker`.

### Several copies of the website: what is kept in the process today

Sessions are signed cookies (wm_s, wm_b, wm_m), read from the database or the secret: they work on any copy. What
does not:

- Rate limiters (guardrails.limiter, the sending limit in stroll.js, the sign-in code limit): a count per copy, so
  N copies allow N times as many. Looser, never stricter; acceptable at first, or kept in Postgres.
- The hits buffer (analytics.js): each copy flushes its own every five seconds, which is right; `present` and
  `alive` (who is here now) are per copy, so the numbers desk undercounts. Needs a row per visitor in Postgres.
- The balcony (balcony.js): the room, those present and its event streams live in one process. Two copies are two
  rooms. Needs one copy to own it (route /balcony to it) or Postgres LISTEN/NOTIFY between copies.
- Caches (pageCache, wanderBase, Wander's pools, `kept`, the shelf, the makers list, shared.js's copies, find.js,
  regard.js and the rest): each copy keeps its own. Correct, but N copies ask N times; the dirty calls
  (`wanderPoolDirty`, `shelfDirty`, `wanderBaseDirty`) reach only the copy that made the change: changes show
  late on the others, by at most each cache's window.
- Locks and lines: the heavy doors' lanes (heavy.js) and the governor's lane and visitor count are per copy, so the
  house allows N masters at once. Acceptable; the lane exists for one copy's memory.
- Timers on the web role (vaultPending, settleAll, clearDisk, the balcony clock, signins sweep): each copy runs its
  own. settleAll and vaultPending must claim their rows (UPDATE … WHERE … RETURNING) before acting, or two copies
  settle or vault the same item; to be checked one by one before a second copy runs.
- Uploads land in the copy's own `incoming` folder and are taken in by that copy in the same request: fine while a
  copy is not restarted mid-upload (as today).
- Render: a second web instance needs no disk (true now) and Will's hand on the instance count.
