# Scale: the house at any number

20 November 2026. Will's order: "build the mechanism to allow this site to run at any number… capable of 10 million
objects." The CTO session leads; workers take one issue each (docs/WORKERS.md, agents/NOTES.md). This page is the plan
and its proof. It is changed when a stage is proved, never before.

## Why the house stops today (measured in the code, 20 Nov)

- The website is one process with one thread. It asks Postgres through `src/pgsync.js`, which holds that thread until
  the answer comes (Atomics.wait). There are 3,796 such askings in 183 files.
- A question may hold the thread for DB_WAIT_MS: 20 seconds on the website. The watchdog ends a process that misses
  three answers of eight seconds. So one slow question is an outage for every visitor (13, 18 and 20 Nov).
- The live database is Render Postgres with 1 GB of memory.
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

- The database: more memory is the cheapest speed there is. 1 GB is too small for what is asked of it now.
- The website: two or more copies from stage 2.
- The pictures: storage grows with every master kept. At ten million objects, whether the house keeps a master of
  every open-access museum picture or keeps the record and its display copies is the largest cost decision in the plan.
- The reading of each arrival by a model (the guide, the bag check): a cost per work, met by `src/spend.js`.
- The workers who build this: sessions on Will's plan.

## Stage 2: several copies

20 November 2026, #123. The bridge holds the website's one thread for every answer, so a slow statement holds every
visitor of that process. Several copies of the website side by side (Render: service `watermark` → Instances) make one
held thread one copy in N. This is what a copy keeps in its own process, and what each piece needs for N copies to be
one house. Proved by `test/instances.js` (two `ROLE=web` processes, one Postgres, CI's `postgres` job) and measured by
`scripts/copies.js` (N copies behind a round-robin, `scripts/load.js` through it). Nothing here was run on the test
house or live.

### How the copies know each other (src/instances.js)

- `ME`: Render's `RENDER_INSTANCE_ID`, else host and process. `/healthz` says `instance` (which copy answered) and
  `instances` (how many website copies were seen in the last 90 s).
- `house_instances`: each process (web, worker, scribe) writes a row every 15 s (INSTANCE_BEAT_S); unseen for 90 s
  (INSTANCE_STALE_S) is gone.
- `leases`: `lease(k, ms)` is one statement on both engines (INSERT … ON CONFLICT (k) DO UPDATE … WHERE the lease ran
  out or is mine), so two processes cannot both take it. `pinned(name, every, fn)` is a timer that runs only where its
  lease is held (renewed each run; a dead holder's lease runs out in three rounds). `withLease(k, ms, fn)`.
- Boot: on Postgres each process takes `pg_try_advisory_lock` before its DDL (CREATE TABLE IF NOT EXISTS, ADD COLUMN)
  and gives it back when createApp returns; the bridge's own CREATE OR REPLACE FUNCTION (before any lock can be asked)
  is tried again on 'duplicate key' / 'tuple concurrently updated'. Measured: two copies on an empty database, the
  second waited 1.5–2.3 s and both came up; before this, the second died on `pg_proc_proname_args_nsp_index`.

### Every piece of state a copy keeps, and what it needs

Moved to the database (this PR):
- Passkey challenges (auth.js, was a Map): `passkey_challenges`, taken once by a DELETE. The options and the answer may
  reach different copies.
- Which copy holds an original not yet in the bucket: `works.vault_on`. The vault queue (vaultPending, every 30 s on
  every copy) skips a work whose holder is alive; before this, a second copy would have called every new arrival
  "lost" and taken it off view for conservation (the test shows it, with the fix removed).
- Which copy took an arrival in hand, or holds a file sent through it (the whole-file PUT, via 'house'):
  `arrivals.host`. Only that copy takes such a file in; if that copy is gone the arrival fails in words and is sent again.
- The host's chair on the balcony: `host_shifts.sat_at`, so the copy that closes the night pays a host who sat on another.

Claimed before acting (a conditional UPDATE whose count decides, or a lease):
- Money in: `grant` (licences; the webhook on one copy, the buyer's return on another, the settling timer), the market's
  settle (the listing moves to sold once; a session that sold it a moment ago on another copy is not refunded), and
  every webhook settle: the pocket, the bookshop, briefs, client bills, the franchise, friends, the Gazette, a hang's
  thanks, a proof, the Library, the copyright ask, patrons, the Club, seats, standing orders, tips.
- Money out: an owed share (market `payOwed`: lease `payout:<id>`, the row read again, Stripe idempotency key
  `wm-payout-<id>`), a maker's pay (lease `pay:maker-<id>`, the statement read after it), a person's cash-out and
  Friday pay (lease `pocket:buyer-<id>`), the host's pay (the shift's row). The market's refund carries
  `wm-refund-<session>`.
- The register: `ledger.append` takes `seq = head + 1`; two writers that read the same head collide on the key and the
  second reads the new head and links to it, so the chain never forks (before, the second append threw mid-grant).
- Sign-in: a code and a link are used once (`used_at IS NULL` in the UPDATE).
- Arrivals: the pump claims `arrived → working`; the sweep puts back only rows whose copy is gone or this copy's own
  that it is not working on (before, any copy's hourly sweep re-queued every other copy's work in hand).
- Imports: finished and told once.

Run on one process of the house (a lease, first to ask holds it):
- `settleAll` (every 5 min; it ran on the website and the worker alike): `timer:settle`. Grant's claim makes a second
  run harmless; the lease saves the Stripe calls.
- The screening's "told" pass and the sitters' sync (both ran on every process): `timer:screening-tell`, `timer:sitters-sync`.
- At boot: clearing the edge (`edge-boot`, once a deploy, not once a copy) and the Stripe domain (`stripe-domain`).
- Al's edit, per maker (`job:aledit:<id>`): a press on another copy finds it running and spends nothing.

Safe per copy, and why:
- Sessions and the visitor's own things are cookies: wm_s, wm_b, wm_m (signed with SESSION_SECRET, the same on every
  instance), the basket (wm_bk), a private gallery's tokens, wm_room, wm_v. Checked against the database where they name a row.
- Caches, each with its window: `kept`, pageCache and wanderBase (60 s), Wander's pools (120 s), the shelf, the find
  index (FIND_KEEP_S, 300 s), the hall's pages, walk (60 s), tenants (60 s), regard, sheets, scout, served files,
  pictures' rights and gamut. A dirty call (`wanderPoolDirty`, `shelfDirty`, `wanderBaseDirty`, `findIndexDirty`,
  `art.uncache`) reaches only the copy that made the change; the others show it late, by at most their window.
- Limiters (guardrails, the sending limit, resend, bench, Gazette, keep, opening, own, rights, season, sharebook,
  deliveries, editions, details, copies' picture reports, beta, the agents' door): a count per copy, so N copies allow
  up to N times as much. Looser, never stricter: people are never refused. The sign-in code limit counts rows in
  `signins`, so it is one count for the house.
- The hits buffer: each copy writes its own every 5 s. The kept numbers (#114): made by the worker, read from the table.
- The governor (memory line, lane, visitors a second) and the heavy lanes: per copy, which is what they guard (one
  copy's memory); N copies allow N masters at once.
- The watchdog: each copy restarts itself. Its slow logs (`pgSlow`, `adbSlow`), `lastFault`, `vaultState`, `faults`:
  /healthz reports the copy that answered.
- Disks: display copies, the originals' cache, `incoming`, clearDisk, the renditions pushed at boot: each copy's own.
- Mail: the daily count of automatic letters is in `settings` (shared); the in-memory state is only what /healthz shows.
- Uploads in parts: on live the parts go straight to the bucket (S3 multipart), so any copy signs a part and any copy
  completes it. The whole-file fallback is one request, on one copy, taken in by that copy (above).
- Service worker and version: `VER` is the commit (RENDER_GIT_COMMIT), the same on every instance of a deploy.

Not safe yet, said plainly:
- The balcony (balcony.js): the room (who is present, the lines, a word, the wall, the piano) lives in one process.
  With N copies there are N rooms; a visitor sees only those on the same copy. Its money is safe (the host is paid
  once); each copy also opens and closes its own night (a row in balcony_nights and a line on the register each).
  Needs LISTEN/NOTIFY between copies (what is said is not kept, so not a table): #141.
- Who is here now (analytics.js `present`, `alive`) is per copy, so the desk's live count is one copy's. The day's salt
  for a visitor without a cookie is per process, so such a visitor is counted once per copy reached. analytics.js is
  #120's: #142.
- Progress of the Studio's own long passes (frick, tidy, hands, hang your best): kept per copy; a press on another copy
  can start a second pass. Studio-only, bounded (hang your best reads at most forty): #143.
- During a deploy old and new instances overlap (true with one instance too, since the disk came off): an old copy can
  answer `/static/…?v=<new>` with old bytes, kept an hour.

### The database's connections

| Process | Opens | Each |
|---|---|---|
| a website copy | the bridge (1; a second for a moment when it is remade after a statement that never answered); the async pool (#122: ADB_POOL, 4, opened on first use) | 5 (6 at a remake) |
| the worker | the bridge (1); pg_dump at the nightly backup (1); the Sunday restore drill (pg_restore into a scratch database, 1) | 1, 3 at most |
| a scribe | the bridge (1) | 1 |
| the test house | its own database | none here |

N copies need N × 5 + 3 (worker) + scribes + a few for Will's shell, the Render dashboard and backups:
3 copies and 2 scribes ≈ 15 + 3 + 2 + 5 = 25; 10 copies ≈ 60. Render's documentation (render.com/docs/databases, read
20 Nov) gives 200 connections for a database of 8 GB to under 16 GB (197 on a legacy instance type), 100 under 8 GB.
Assumed, not read on live: `SHOW max_connections` cannot be asked of live from here. Will reads the real number in
Render → watermark-db → Info (or `SHOW max_connections;` in its shell). Connection pooling stays off; it is not needed
below about 30 copies.

### What a visitor feels (scripts/copies.js, this machine: 2 CPUs shared by every copy, the load client and Postgres 16)

load.js through the proxy, 20 visitors for 20 s over 30 works; p50 / p95 / max in ms of the page doors (wander, a
work, find, the collection), and how many answers in the 20 s. "Held": copy 0's bridge asks `pg_sleep(2)` every 3 s
(a hard case: the thread held two seconds in three) or every 10 s. Every answer was a 2xx.

| Held | Balancer | N=1 | N=2 | N=3 |
|---|---|---|---|---|
| nobody | round-robin | 91–175 / 220–315 / ~580; 4,298 answers | | 65–190 / 277–495 / ~760; 4,136 |
| 2 s in 3 | round-robin | 80–155 / 2,130–2,210 / ~2,290; 2,586 | 77–157 / 2,070–2,220 / ~2,440; 2,130 | 56–172 / 2,270–3,560 / ~5,760; 1,664 |
| 2 s in 3 | least in hand | 91–159 / 190–2,230 / ~2,370; 2,226 | 52–116 / 176–442 / ~2,330; 4,209 | 44–118 / 175–261 / ~2,450; 5,249 |
| 2 s in 10 | round-robin | 80–171 / 199–383 / ~2,350; 3,827 | | 46–170 / 237–510 / ~2,330; 3,977 |
| 2 s in 10 | least in hand | | | 63–204 / 288–448 / ~2,330; 3,772 |

What it says:
- Copies help only as much as the balancer avoids the held copy. A round-robin keeps handing it one request in N, and
  every visitor reaches it in turn: with a hard hold the 95th stays at the hold (2.1–3.6 s) whatever N. A balancer that
  sends to the copy with least in hand passes the held copy over: with two copies the 95th fell from 2.2 s to under
  0.45 s and the house answered almost twice as many. The worst single answer is still the hold (~2.3 s): the visitors
  already waiting on that copy wait it out.
- With three copies on two CPUs the copies compete for the machine (nobody held: the 95th rose from ~0.3 s to ~0.5 s);
  on Render each instance has its own CPU.
- How Render's balancer chooses an instance is not documented (render.com/docs/health-checks, read 20 Nov: checks
  "every few seconds", a check failing past five seconds; an unresponsive instance is restarted; the page does not say
  how requests are spread). So the safety is two things together: copies, and the website's statement limit (#115,
  4 s a statement, 8 s a hold) so no copy is held long enough to matter; and /healthz, which asks the database, fails
  on a held copy so Render takes it out of rotation.
- Boot: N copies started together came up in 1.6–2.2 s (1), 3.2–3.4 s (2), 4.4–5.5 s (3): the boot lock lines them up.

### What Will presses (draft)

1. Render → service `watermark` → Scaling (left menu; the instance count) → Manual scaling → Instances: 2 →
   Save. Render starts a second instance from the same deploy; no new deploy is needed. Cost: two instances of the
   `watermark` plan (Pro) instead of one; nothing changes on the worker, the scribes or the database.
2. In the first hour, watch:
   - `https://watermark.krafftco.com/healthz` a few times: `instance` changes between answers (two copies answering),
     `instances` says 2, `worker.stale` false.
   - Render → watermark → Logs: `[boot] waited … for another process's boot` once per deploy (normal);
     `[pg limit]` (#115) and `[pg slow]` (which copy and which statement); any `[instances]`, `[payout]`, `[settle]` error.
   - Render → watermark → Metrics: both instances' CPU and memory; the database's connections (Render →
     watermark-db → Metrics) under 200 (expected about 12: 2 × 5 + the worker and the scribe).
   - If he wants the money path seen on live: one Collect paid with a real card and refunded: one letter, one line on the
     register, the work's page names the collector once.
3. To go back to one: the same page, set 1, Save. Nothing in the database depends on the number: leases run out, and
   a copy that is gone is seen as gone in 90 s (an arrival sent through it, if any, asks to be sent again).

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
- The limit: ADB_LIMIT_MS (5,000 on the website, 120,000 elsewhere) as `statement_timeout` on every connection of the
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

(#123 took this list further: "Stage 2: several copies" above gives every piece of state and what each needs.)

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
