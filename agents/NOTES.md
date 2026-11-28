# What the workers know

The enterprise's memory. A worker starts with nothing but the issue and these files, so what one worker learns the hard
way is written here for the next. **Read it before you start. Before you finish, add what the next worker should know**
(a line or two, under the right heading, in your pull request). Facts, not stories; delete a line when it stops being true.
The CTO session keeps it honest.

## This machine
- Start with `bash scripts/worker-setup.sh <issue> <name>` from /home/claude/watermark. Never work in that clone itself.
- `npm ci` fails building from source (nodejs.org headers are blocked). `npm ci --ignore-scripts` works and the native
  modules load. The setup script does this.
- Playwright cannot download its own browser. Tests that need one drive the machine's Chrome: copy how
  `test/a11y.js` and `scripts/reach-walk.js` find it. So nothing here proves Safari's engine: say so.
- Safari's engine runs only in CI: the `reach-webkit` job (#55) walks reach and the way back with `WM_ENGINE=webkit`
  (`scripts/engine.js`; iPad (gen 7), iPad Mini, iPhone 13 from Playwright's `devices`). Here `WM_ENGINE=webkit` prints
  one line and exits 0; in CI a missing WebKit fails. Its findings come back as annotations titled `… webkit`
  (`scripts/engine-findings.js`, ≤1500 chars each, 10 a level a step) and whole in the job's `webkit-findings` artifact.
- The reach walk calls a finding only when a second look agrees (#109): each door (a page at a size as a person, or one
  edge of the presses) found with anything is visited again once in a fresh page; what one look of two saw is `flaky`,
  kept in REACH_JSON and raised as notices (`reach webkit flaky`), never an error. A door that throws (a navigation under
  the walk, a press that cannot be brought into view in 8 s) is a finding of kind `error`, looked at twice the same way.
  Each finding carries `diag` (Wander's classes, running animations, opacity, ms since load) and an invisible control is
  re-read 1.5 s later (`STILL`/`no longer invisible`): read those before calling a WebKit finding a flake or a fault.
  Playwright's WebKit is not on this machine: a lab is a temporary job in test.yml on your PR (dispatch more runs with
  `gh api -X POST repos/krafftco/watermark/actions/workflows/test.yml/dispatches -f ref=<branch>`). A PR that conflicts
  with `next` runs no CI at all: merge `next` in when `mergeable_state` is `dirty`.
- WebKit in CI (#55): the job takes ~13 min (reach ~10). Playwright's WebKit does not let `route()` stand in for requests
  that go through the house's service worker, and the worker claims the page at once: a test that stubs answers runs
  with `serviceWorkers: 'block'`. WebKit likely holds Wander in its arrival state (bar hidden, pointer-events none,
  `st-arr`) where Chrome does not (#60). Allow lines seen only in WebKit go in `ALLOW_WEBKIT`, apart from `ALLOW`.
- Locally `test/wayback.js` needs `CHROME=/usr/bin/google-chrome` (Playwright's pinned Chromium is not on this machine).
- A local Postgres for `scripts/sql-check.js` and the Postgres half of a test: /var/lib/wmpg, port 5433, started as
  docs/HISTORY.md says ("Two engines, one shape"). Stop it when you are done if no one else is on it.
- The shell cannot reach the live house or the test house (the network allow-list). A worker never sees live data.
  The CTO session can read live pages through a browser and will hand you what the real page holds: ask.
- Other workers share /tmp. Remove only folders your own runs made; never `rm -rf /tmp/wm-*`.
- The machine is rebuilt without warning: packages and worktrees can vanish between days. Push your branch early.

## GitHub and CI
- `gh api` (REST) only. Issues, comments, pulls: `gh api -X POST repos/krafftco/watermark/…`. Bodies from a file: `-F body=@file`.
- CI runs on pull requests, on `next` and on `main`. Its logs cannot be read; a failed job's reason is in
  `gh api repos/krafftco/watermark/check-runs/<job id>/annotations`. A job that fails must publish why as an annotation.
- Jobs: `test`, `postgres`, `load`, `scale`, `scale-postgres` (#116, about 3 min), `a11y` (also runs `test/wayback.js`), `reach`, `reach-webkit`. All must be green before `main` moves (promote.yml names each in `NEEDS`; rename one, rename it there).
- `public/sw.js`'s `V` is bumped by almost every change, so it conflicts on merge almost every time. That is expected;
  the CTO session resolves it. Do not rebase to chase it.
- `[skip render]` in a commit message stops the host deploying THAT push. If such a commit is the newest one when `main`
  moves, the code beneath it is not deployed either. Use it only for a push that carries no code at all; when in doubt, leave it out.
- A push made with `secrets.GITHUB_TOKEN` starts no workflow; only `workflow_dispatch` (and `repository_dispatch`) by that
  token does. So promote.yml dispatches `test` and `live` on `main` itself (`scripts/ci-dispatch.sh`, #66). Checks belong
  to a commit, not a branch: a promoted commit shows (and Render sees) the green checks of its push to `next`.
- A scheduled or dispatched workflow runs the files on `main`: a change to promote.yml, test.yml, live.yml or
  `scripts/ci-dispatch.sh` does nothing until it is promoted, and the promotion that carries it runs the old one.
- `main` and `next` must share history. A hotfix made on `main` is merged back into `next` the same hour, or the next
  promote fails (12 Nov).

## What has gone wrong, and the rule each left behind
- **A page that reads the whole collection takes the house down** (9 Nov; 13 Nov, the Studio's front page: 62,000 works,
  nine counts each, every visitor waiting behind it). The Studio's desks run on the same process as the visitors. Any list
  from `works` names its columns and has a LIMIT; a count is asked of the database, never made by reading rows; say what
  your page costs at a million works. The settings table's columns are `k` and `v`.
- **Built on an invented fixture, wrong on the real thing** (14 Nov, the Leonardo book: 27 chapters in the test, 11 on live).
  When your work reads real content (a book, a museum's records, a maker's files), ask the CTO session for the real
  page's skeleton BEFORE you write the parser, build the fixture from it, and say in the pull request what you never saw.
- **A person silently turned away** (12 Nov, the sign-up guard's first version: a stale form got a fake success and no
  museum). Only a trap for machines may fail silently. A person is always told, and always has a next press.
- **A door that signed in whoever typed an address** (12 Nov).
- **A proving link handed to the wrong person** (16 Nov, #65: with mail off the curator invitation showed the inviter the
  join link, which signs its opener in as the invited address). A link or code that proves an address travels only by
  mail to that address; with mail off the page says the letter could not be sent. Tests read it from
  `app.locals.mailLog` / `app.locals.lastCode`, which exist only under NODE_ENV=test; production logs never carry one.
  A request in the smoke that needs its own limiter count sends `x-forwarded-for` (trust proxy is 1): `/signin/code`
  allows eight a quarter-hour per address across the whole smoke. No door signs a device in as an address it has not proved.
- **A dead end in the installed app** (15 Nov): no browser bar there. A file is never navigated to; every page has a Back.
- **Controls too small or under another on an iPad upright** (15 Nov). 701–900 px wide is a real screen. The `reach` job
  walks it; if you add a bar or a row of controls, run `node scripts/reach-walk.js` yourself.
- **A bigger target that moved the page** (15 Nov, #48). Enlarge a control with padding and a negative margin of the same size, but read every rule that already pads it first (`.st-plate a` had 3 px: the margin takes back only what you add); an inline-block (a slider in a label) sits on the text line by its margin box, so a symmetric margin can still grow the line. Compare boxes before and after, never by eye. A panel with `display:grid|flex` ignores its `hidden` attribute unless it has a `[hidden]{display:none}` rule.
- **A "public" field that was not** (16 Nov, #28): `makers.handle` is `slugify(name)` as typed at joining, not the public
  page's slug, and the test house turns peephole readers into `kind='maker'` rows (now `door='play'`). Before you call
  anything about a person public, find every door that writes it. Exclude rows by their own mark, never by name.
- **A secret in an address reaches the `[lag]` trail** (16 Nov, #28): app.js keeps only the path for any query naming
  key/token/code/secret/authorization. Express routes ignore case (`/AGENTS/…` opens `/agents/…`): test a path with `/i`.
- **Postgres index builds hold writes** (16 Nov, #28): `src/indexes.js` builds CONCURRENTLY on Postgres (one statement per
  exec, never inside `db.transaction`) and drops and rebuilds any of its names left INVALID. Add new indexes to its LIST.
- **A Postgres test run leaves its schema behind**: give each run a fresh database (`createdb`, drop after), or the second
  run fails on a unique handle.
- **A worker's `rm -rf /tmp/wm-*` broke another's test run** (12 Nov). See "This machine".
- **A test's last line is not its result.** Read the exit code; a stray line after teardown fooled a merge check (14 Nov).

- **A bare status a person met** (20 Nov, #149). `res.sendStatus` is the house's own for every room (`app.response` in
  `src/breaks.js`, so order of mounting does not matter): a navigation (`Sec-Fetch-Mode: navigate`, any method) gets the
  sign, a script (`/api/`, `Sec-Fetch-Dest: empty`, JSON asked) gets `{ok:false, code, why, error}`, an image or file its
  status. A room that catches its own error answers `res.fault(e)` / `res.fault(e, 503)`, never `sendStatus(500)`: the
  fault is kept with its room and its copy (`instance`, src/instances.js ME) in `app.locals.lastFault` and `recentFaults`
  (Studio's /healthz; per process, so ask each copy) and a `[break] <instance> …` line. src/adb.js marks its 57014 like
  the bridge does (`status 503`, `limit`, `sql`).
  Every word on a break page is in `COPY` there. The one-moment page is `/static/cold.html` (self-contained; the edge's
  copy is uploaded by `scripts/edge-page.js`); `scripts/breaks-walk.js` stops a house mid-visit behind a stand-in edge.

## The scale gate (#8)
- `node scripts/big-house.js` builds a house of 100,000 works from rows (about 10 s here: real pictures for six works,
  every other row a clone pointing at their files) and walks every room once as visitor, maker `mk`, museum `museum-a`
  (60,000 works) and the Studio, timing every SQLite statement (better-sqlite3's prototype is wrapped in the walk's
  process). `BIG_KEEP=1` keeps the house; `BIG_DIR=<it>` walks it again without building; `BIG_ONLY='studio /studio$'`
  walks the rooms matching; `BIG_TABLE=x.md` writes every room's numbers. The whole run is about 40 s here.
- What it finds first: a desk that lists every work of its maker (fine for 400, 72 MB for a museum), a count asked
  per work or per maker inside a loop (`/account/copyright` asked one maker-wide aggregate 3,000 times: 9.7 s), and a
  pool read whole to choose a few. Count in one grouped question; let the database choose and LIMIT.
- A page's cost depends on who asks: walk your room as a museum (`museum` in the table), not only as `mk`.
- Wander's pools are kept two minutes, so the room that builds one changes with the walk's timing: allow a statement
  that moves like that by its text (`room: '*'`, `sql`).
- `test/listreads.js` is CLAUDE.md's SQL gate as a test; `test/listreads-allow.json` only shrinks (a stale line fails).
- A cache that one room fills can hide another room's cost (#70, 16 Nov): when Wander stopped building a museum's
  sheets, the museum's sheets desk showed its own 60,000 rows. Fix a shared cache's first caller and walk the whole gate.
- A page's slowest statements on this machine vary 3× between runs (disk cache): a statement at 50 ms warm can read
  240 ms on the walk's first visit. Look at the plan, not one timing; keep what you add well under half its line.
- Postgres plans by cost: on a 100,000-row house a question for the maker holding 60% of it is a (parallel) seq scan
  and a top-N sort even with the index there (45–65 ms), and `x IN (SELECT …)` is flattened into a join; `NOT IN
  (SELECT …)` keeps works in its own index's order. Get plans from the local Postgres: move a kept big house with
  `scripts/to-postgres.js` after `DELETE FROM hits` (the gate's hits are text times; Postgres wants numbers).
- SQLite takes a partial index only when it beats an equality on another index: `works (status, stars DESC, id) WHERE
  closer IS NOT NULL` is used, `works (stars DESC, id) WHERE …` is passed over for works_status_best. Check the plan.
- Regard: `RG.byRegard`/`chronology` ask for the works given (`regardFor`, 500 ids a question); `regardMap` (the whole
  house) is for a maker's standing and is built by the worker in a split house. Never sort a page through regardMap.
- A desk's list (#78–#93): `src/deskpage.js` gives a page (the newest 200 by id, `?before=`/`?after=` keyset, never OFFSET),
  a search that asks the database (`?q=`, the words find.js reads, so Postgres uses `works_find`) and the controls; `find()`
  is a picker's search (20, as you type). A sum per maker is one GROUP BY with `src/grouped.js` (`inList`, `byId`); a
  per-row count is asked with `IN (…)` for the rows shown. A count over a museum is still a walk of its index: say its cost.
- A maker's money is `payouts.statements(makers)` (one grouped question a sum); `statement(m)` is the same path for one.
  `test/statements.js` holds it to the old per-maker questions, both engines, both sides of the fee: change the
  arithmetic in one place and run it.
- The gate cannot see what its fixture leaves empty: readings (`works.frick`), notes, stood above the floor. A loop
  per row over an empty list costs nothing there and everything on live: read the room's code, not only its numbers.
- Walk your own rooms on a kept house: `BIG_KEEP=1` once, then `BIG_DIR=<it> BIG_ONLY='<who> <room>'`; after adding an
  index, run `indexes.ensure` and `ANALYZE` on that house first (the build does it; the re-walk does not).
- An inline `// comment` added at the end of a long one-line statement in app.js swallows the rest of the line: use `/* */`.
- `test/a11y.js` launches Playwright's own Chromium, which this machine lacks: run it with a preload that falls back to
  `channel: 'chrome'` (as reach-walk does). The reach walk's Wander faults at ipadL come and go with the machine's load.
- Someone's `/tmp/wm-*` sweep removed a running house's folder here once (16 Nov): the walk writes its result beside
  the folder, and a vanished folder is said in the log.

- The gate on Postgres (#116): `BIG_PG='postgres://postgres@localhost:5433/postgres?host=/tmp' node scripts/big-house.js`
  (start the local server first: "This machine"). It builds on SQLite, moves the house into a fresh `wm_big_<pid>` by
  `scripts/to-postgres.js`, VACUUM ANALYZEs, runs the worker's round and walks through the bridge, then EXPLAINs every
  statement over a line (`BIG_PLANS=x.md`) and drops the database. At 100,000 works here: build 19 s, move 70 s
  (3.95 M rows), walk 46 s, about 3.5 min all told. `BIG_KEEP=1` keeps folder and database (drop it yourself).
  Judged by `ALLOW_PG`, apart from the SQLite `ALLOW`. The fixture needs BIG_WORKS ≥ 90,000 (its rooms and applause
  assume it); below that the build fails on a key.
- Times through the bridge are the time the thread was held (round trip and JSON included): expect 2–5× the SQLite
  figure for the same statement, and far more for anything that sorts or counts DISTINCT over many rows.
- The visit log decides the numbers desk's cost. Its statements (COUNT(DISTINCT visitor) by device, browser, country,
  path; the /w/ paths joined on substr) at 30 days, Postgres 16 defaults here: 3 M hits a month 1.3–1.6 s each,
  10 M 3.4–5.6 s, 30 M about 12 s (live measured 9–13 s, 20 Nov). Growing `hits` in a kept database by SQL is faster
  than rebuilding (generate_series; cast g to bigint before multiplying).
- `BIG_READ` (4 MB a page, summed over statements) catches a list that reads whole text bodies; `rssMB` in BIG_JSON
  shows how far the process grew on a page (not judged: the garbage collector makes it noisy).
- At 1,000,000 works: build 2 min (4.3 GB of SQLite), move 4.5–7 min (11.4 M rows), worker's round 25–76 s, walk
  80–110 s; 17–27 min all told, about 13 GB of disk while it runs. Since #120 the walk reads the numbers the worker kept
  (as live); `BIG_NUMBERS_DESK=1` walks the website making its own report. The gate times the bridge only: a question
  on the async path (`adb`, #117) holds no thread and is not counted.

## The async path (#117, docs/SCALE.md stage 2)
- `app.locals.adb.get/all/run(sql, ...params)` are promises: a `pg` Pool beside the bridge on Postgres, the same
  better-sqlite3 connection on SQLite. Same SQL, same dialect, same row shape as the bridge. `scripts/sql-check.js`
  checks `adb.` literals; `test/listreads.js` counts `adb.get(` as one row.
- The bridge's Atomics.wait freezes the whole process: no request is read, on either path, while any statement waits
  there. Moving a quick read does not protect anyone; moving the slow statement does. Measure with the client in a
  child process: a client in the server's own process is frozen with it and reports nonsense (test/manyhands.js).
- ADB_LIMIT_MS and ADB_POOL are read when adb is opened (the pool itself opens on the first question): set them
  before `open`, not before the first query. On SQLite there is no limit (a statement cannot be ended from its thread).
- To compare against `next`: `git worktree add <scratch>/base origin/next`, symlink this worktree's node_modules into
  it, and run the same script there (big-house with BIG_TABLE, load.js, a walk house on another port).
- `scripts/wander-walk.js` locally: preload a shim that launches with `channel: 'chrome'`, and give it a house of at
  least 40 held works with pictures over 3,000 px (14 small ones fail sentences 2 and 9 on `next` too). Sentence 8
  on the desk ("← opens nothing") fails on `next` as it stands (20 Nov, #121).

## The website's limits and the kept numbers (#115, #114)
- On ROLE=web the bridge refuses a statement after 8 s without the event loop turning (DB_HOLD_MS) and Postgres stops any
  statement at 4 s (DB_LIMIT_MS). A room that asks many quick statements in one synchronous stretch can now be cut with
  a 503: an `await` or a page split does not help unless the loop actually turns (setImmediate). Look for `[pg limit]`.
- A named long write on the website: `db.longer(ms, fn)` (SQLite runs fn as is). Never inside a request that already held the thread.
- The worker's SET of statement_timeout inside a transaction is undone by its rollback: pgworker.js re-sets it after
  such a transaction. Transaction words (BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE) are never refused or limited.
- Figures over the visit log come from the daily rollups (`hits_days` dims, `hits_vd`), never from `hits` on a page.
  A list's visitors over several days are each day's distinct visitors added; the head's visitors are exact.
- To test the website's kept path in one process: set `process.env.ROLE='web'` after createApp (the doors read it when
  asked), call `app.locals.numbers.makeAll()` as the worker would. test/numbers-shut.js counts every SQLite statement.
- On Postgres, COUNT(DISTINCT x) over millions of rows spills to disk under the default work_mem (4 MB): EXPLAIN (ANALYZE,
  BUFFERS) shows `Sort Method: external merge`. Roll it up by day instead.
- `express` 5: a test-only route goes first with `app.router.stack.unshift(app.router.stack.pop())` (test/pglimit.js).

## Prepared copies (#139)
- `src/prepared.js`: the worker asks its own house (a port of its own on 127.0.0.1, header `x-wm-prepare` with a key made
  per process) for each stranger door and writes the page to `prepared_pages`; every website mirrors the rows in memory
  by a poll on the async path; a stranger's door is answered from memory with no statement. `PREPARED=0` turns it off;
  under test it is off unless `createApp({ prepared: true })`; call `prepared.round()` then `prepared.sync()` yourself.
- Who is a person is `isPerson(req)` there, also used by `minute()`. Any `wm_*` cookie not in INERT (or, on the hall's
  doors, HALL_INERT) is a person: a cookie you add is a person until you prove the doors do not read it and add it there.
- `wm_tz` is the visitor's zone and the clock reads it (clock.js `programme`: /house's rows when not quiet, the Keys).
  The worker's request marks a copy that asked the clock (`X-Wm-Zoned` → `prepared_pages.zoned`); a visitor with a
  zone is built fresh for a zoned copy, and a zoned copy is `private, max-age=0`. Test anything that reads the hour with
  `V.setQuiet(false)` too: quiet hides the clock's rows, so a quiet-only test proves nothing about them.
- A page sent from a copy is not written to `hits` when sent: the copy's own line posts `/api/arrived` from the browser, and
  that is the visit (with the work's view, `app.locals.viewLater`). A test that counts hits flushes first
  (`app.locals.analytics.flush()`, `app.locals.flushViews()`).
- Counting Postgres statements in process: patch `require('src/pgsync').open` before `createApp` to wrap each statement's
  get/all/run (the async path's statements are not counted that way; on SQLite the prototype wrap counts both).
- Two processes booting at once against one Postgres can fail with `tuple concurrently updated` on the dialect's
  `CREATE OR REPLACE FUNCTION wm_mod`: start the second when the first answers /healthz.

## The copies and the scribes (#196)
- A maker's upload lands `status='hidden'` (accounts.js `takeWork`); "kept back" to a photographer is that, or `held` with
  `keep_back=1`. Anything that serves a maker's own pictures must take both. The scribes take a living maker's own works
  of the last SCRIBE_NEW_DAYS first (`FRESH` in copies.js, through `works_status_created`), then `WANT` as before.
- The worker's prepared round asks its own house (up to 40 pages a round, every 10 s, header `x-wm-prepare`). Anything
  on a chores process that counts "people" must skip `require('./prepared').isPrepare(req)`; the governor does, and says
  `own10s` beside `visitors10s` on /healthz. test/governor.js runs one process per role (the role is read at require).
- Many distinct test pictures: a field of noise each (`sharp({ create: { …, noise } })`) passes the fingerprint; hue or
  brightness alone does not. test/keptcopies.js (KEPT_N) uploads through the arrivals doors and walks the album picker.
- (#198) A work not on view (not held, or kept back) is guarded in one place: `app.locals.offView` in app.js (`off(w)`,
  `may(req, w)`, `keepPrivate(res)`), asked by a gate before every door in `OFF_DOORS` and by /img, Wander and the easel.
  A new door that names a work by slug goes into `OFF_DOORS`; a new place a hidden work is shown on purpose goes into
  `shownAnyway` (volumes, opened contact sheets). A page that shows an album's pictures carries the album's token on each
  (`?token=`, deliveries.js `carry`/`withToken`, album.js `data-dv-q`); a cookie alone never opens a stranger's picture.
  A test that fetches a maker's own upload must do it as the maker (test/pairs.js once did it as a stranger).
- An AI call's failure goes through `app.locals.spend.heard(e, module)` in its catch: out of credit it stops the
  background for AL_CREDIT_WAIT_MIN and the Studio's desk says it once (settings `credit_low`).

## How work is judged
- The issue's "done means" is the contract; its Proof is run, not described. "Not verified" in your report is as
  important as "passes": name the engine, the device and the data you did not have.
- Every sentence a person will read is a draft for Will: list each in the pull request. Restrained, plain, no hype;
  never "first", "only", "complete"; never a museum's or a partner's name as endorsing.
- Fix what is certain and shared; file the rest as issues, one per cause. Do not widen your job.
- Changes on a visitor's path, to pictures, to sign-in or to money are read by the `reviewer` seat before they merge.
  Expect it to try the case you did not test.

## Several copies of the website (#123, docs/SCALE.md "Stage 2: several copies")
- The website runs as N instances on Render. Anything a request starts must finish on any copy; anything a timer does
  must be done once. A new timer on the web role: `app.locals.instances.pinned(name, every, fn)`, or claim each row
  (`UPDATE … WHERE status=<from>` and act only when `.changes` is 1). Money also gets a lease (`withLease`) and a
  Stripe idempotency key. A Map in the process is a cache, a limiter or a bug: say which in docs/SCALE.md.
- A file on a copy's disk is that copy's alone (no shared disk): record the copy (`IN.ME`) on the row, and let other
  copies skip it while `alive(holder)`.
- `test/instances.js` (CI's postgres job) forks two `ROLE=web` processes (test/instances-copy.js) that share Stripe and
  the bucket through files; ask a copy over IPC (`c.call('payouts.pay', row)`, `c.sql(...)`). Locally it needs a fresh
  database each run (`CREATE DATABASE`), about a minute. Negative proof: remove a claim and it fails in words.
- `scripts/copies.js` (needs an empty Postgres): N copies of server.js behind a round-robin (or `COPIES_BALANCE=least`)
  with load.js through it; `COPIES_HOLD=1` holds copy 0 with pg_sleep through a preload (scripts/copies-hold.js).
  Never `spawnSync` a client of a server that lives in your own process: the server stops answering.
- An INSERT through the bridge gets its RETURNING from dialect.js: take the id from `.run(...).lastInsertRowid` (the same on both engines).

## The market's rules (#165)
- Who may see a past price is asked once: `app.locals.market.who(req, w)` → `{ all }` for the Studio and the work's maker,
  `{ own: Set of licence ids }` for a holder. `market.asked(p)` is what a stranger may know of `priceOf` (the ask). Any new
  surface that draws a sale price, a total, a line or a value goes through it; test it as a stranger, a holder, the maker.
- A size or a price with a sale goes through `src/rules-of-trade.js` (`size`, `price`), never `Math.max(want, sold)`.
- `market.holdOf(licence)` is the holding time; a listing is made at `/yours/offer` and by accepting an offer
  (`/yours/offers/:id/accept`): both check it. `src/trade.js` is the trade desk (picture editors), not the market.

## Rooms, by what trips people
- **The reader** (/read): a book is one page of many `section.rdr-ch`; `?c=` moves between them. Books of numbered notes
  go through `src/outline.js` (and `outline-n1.js` for one day's old places). `app.locals.bookNotes.note(slug, n)`.
  What the Leonardo book taught (four rounds, 13–16 Nov): in the body a numeral alone, then a line in CAPITALS, is a part;
  a numeral alone, then anything else (one word, a quotation mark, a title over three short lines), is a section when it is
  above the last and within the contents' count. Never require "exactly the next" or a title match: one miss hid the rest.
- **Volumes** (/volume, /studio/volumes): `works.vol_page` (NULL, 0 for the first page of an open volume, else the
  volume's id) decides what leaves the open walls; keep it, `volume_pages.pos` and `volumes.n` true together.
- **Wander** (/wander): docs/WANDER.md's ten sentences, `scripts/wander-walk.js`. Sets are keys (`maker:`, `album:`,
  `delivery:`, `collection`); a private album's pictures answer only to those inside.
  In an album set the page carries `set.album` (`deliveries.acts(key, req)`: the caps, the viewer's hearts, Print links
  on the client's link); public/stroll.js adds the heart to the plate and Album to the rail, and the album's sheet is
  appended to `body` (inside `main.st` nothing rises above the house's tab bar, z-index 60). Each extra rail button costs
  about 63 px on a phone: at 390 × 664 two more ran the rail into the top bar. `test/albumwander.js` (CI's a11y job).
- **Album guests** (#203, `src/albumguests.js`; `src/guests.js` is another room, a collector's guest list): a guest's
  picture is a work of the guest's own studio (`hidden`), linked to the album only by `delivery_guest_works` (state
  waiting | in | no | out), never by `delivery_works`, so `worksOf`, the cover, the card, the film and Wander's album walk
  stay the photographer's. Anything that must also answer for a shown guest picture asks `findIn(d, slug)`; the guests'
  walk is the key `album:<share>.guests` (`keyOf` in deliveries.js). A guest's studio is `makers.door='album'`,
  `email_ok=0` until `/added/:token` (the letter) runs `app.locals.admit`. With #198's `passes(?token=)` the guest table
  must be asked too (`G.mayView`). `test/albumguests.js` (a11y job and the Postgres loop).
- A panel with `display:grid` and the `hidden` attribute shows anyway: the album's "That's me" form stood on every album
  until 1.92.0. A full-page screenshot at 390 is the quickest way to see one.
- **Albums' order**: `worksOf` sorts by `taken_at`, then the file name read numerically, then `pos` (the picker's order,
  newest upload first). There is no hand order yet; one would come before this sort. The link card's file is named by
  its three slugs (`cardOf`).
- **Story and post cards** (#210, `src/cardface.js`): one drawing for the album's cards and the work's own. A story draws
  only between y=250 and y=1590 (Instagram's bars), a post keeps 60 px of dark; the picture box is 940 wide, since a JPEG's
  edge rings a pixel or two past a 960 box. The cache name carries a hash of what is drawn: change the face, change the
  suffix (`story2-`, `-c3`). `test/cardface.js` checks the bands by pixel rows; `CARDS=<dir>` keeps PNGs to look at.
- **The sign-up door** (POST /record): a signed time on the form, a trap field, ceilings on letters not on people.
- **Downloads**: `public/save.js` decides what a download press does in the installed app. The heavy doors may answer
  "wait your turn" as a page: a fetch must check what it received.
- **On view at** (#166, `src/onview.js`): `onview_places` (a place stated once) and `onview_works` (one line a work).
  `showings` is already cabinet.js's table (a collector's showings): grep `CREATE TABLE IF NOT EXISTS <name>` before
  naming one; a clash shows only as a 500 on another room (test/menus.js found it). What the house offers on a work is
  decided in one place, `listed()`/`offered()` in app.js: a key closed there (as `viewClosed`, `clearClosed`) closes
  the page, /buy, /license, the print editions and Wander's Collect at once.

## The sources (#170, docs/SOURCES.md)
- WebFetch reaches a museum's terms page only if a WebSearch result named that address first; search, then fetch the
  result's link. Several sites fail from here (si.edu terms, nga.gov terms, Commons' reuse page, Gutenberg's licence
  pages: their robots file cannot be read). Write "not read"; never fill a term from memory.
- Bash cannot reach the museums' APIs or the live house. A walk of a museum's work page is done in process: the item in
  the importer's own shape through `app.locals.iiif.take` (each item a different picture, or the fingerprint skips it).
- An open work is shown through forms made for a photographer's own work (the deed, "the maker says never", the thank-you
  card, the guest book, the JSON-LD, the file's XMP). Any change to those forms: check an open museum work too
  (test/sources.js has one from the Gallery and one from the Met).
- A source the house reads gets a row in docs/SOURCES.md and a line in `src/sources.js` (KNOWN) the day it is added.

## What you hold (#176)
- What a collector holds is said in one place: `src/holds.js` (`statement`, `block`, `ofLicense`, `offering`). A page that
  offers, confirms or resells a work calls it; never write a sentence about a right into a page. Each clause names its
  source in the license (src/contract.js) or the terms (src/legal.js); a clause with no source is a question for
  docs/COUNSEL.md, not a sentence. `test/holds.js` walks collect, a license, a print, an open print and a resale.
- `H.NEVER` is the list of words a visitor never reads; `test/holds.js` checks the words between the tags and in
  alt/title/aria-label/placeholder on every page it walks. Still said elsewhere (not walked): "wallet" in the gallery's
  files tab and in the terms of the house, "token" and "hashed" in the terms (their text is fingerprinted: a change is
  Will's and counsel's).
- A page's own rules restyle a bare `<b>` or `<p>` (the work page made the label 30 px): look at a new block on each
  page at 390 wide, do not trust one.


## A license written from the use (#183)
- `licenses.rights` (JSON) is the order's terms. An optional field must be absent, not null, when unset, or every old
  fingerprint (`rights.hash`, a sha256 of `K.assemble`) changes: `terms()` spreads `territory`/`limit` in only when
  set. `test/licence-by-use.js` holds today's text to fingerprints taken before #183; never regenerate them to pass.
- `rights.size` already means a kept album picture's file size (src/deliveries.js); the size of use is `rights.limit`.
- A narrowed license (territory or limit) has no price: `t.ask` is true, `/buy` shows the ask page with the answers
  as hidden fields, `POST /license` stores the narrowed terms with `price_cents` null and `requested`, and the Studio's
  quote sets the fee. A request that narrows nothing is stored exactly as before (`rights` null).
- The license page may carry selects and inputs about the use; the smoke forbids a field for the buyer (`name="email"`)
  before payment. The answers refresh the statement through `/contract/:slug?holds=1` (no new route).
## Find (#179)
- `src/findask.js` reads the ask (a phrase, a number, "X by Y", a year or decade, a kind, a holder) and touches no
  database; `src/find.js` runs it. One judge (`judge`) scores both roads, so a change to ranking is made once; the
  database road only chooses which works the judge sees (`candidates`), and Wander asks through `find.whereFor`.
- The database road asks for ids first, unordered, to the ceiling (FIND_CANDIDATES, 400): an ask few works meet is one
  pass with no join (about 50 ms on SQLite at 100,000 works, where the ordered question walked the index for 130 ms).
  Only a common word goes on to the ordered question and its two small ones (makers who are not institutions; the exact
  title, index `works_title_lower`). Test the ceiling by setting FIND_CANDIDATES low before `createApp` (test/findask.js).
- On SQLite a word nothing carries is a pass over every held work (no trigram index there); Postgres answers from
  `works_find`. A slip in a title is forgiven on the list road and on Postgres, not on SQLite's database road.
- A caption's words and an accented letter are read on the list road and not by the database's candidates (`WORDS`
  holds neither): the two roads differ there, as they did before #179.
- `find_misses` (day, words, n) is written only by a deliberate ask (the /find page, Wander's page), never by the box
  as it is typed, and read only by /studio/feedback. Each copy stops at FIND_MISSES_A_DAY (400) writes a day.
- Give your own runs their own temp root (`TMPDIR=/tmp/wm-<issue>-tmp node test/x.js`): every house they make is
  under it, and clearing up is one folder that is certainly yours.

## The public house (#188)
- `test/public.js` walks every door, both footers and one link deep (about 270 pages, 15 s) as a stranger. A new reading word on a public page goes through it: the words a reader never meets (BANNED), "museum" for the house (SELF_MUSEUM), a share offered (OFFER). Machine addresses and /standard keep technical words (MACHINE); the legal documents are counsel's (LEGAL, docs/REDLINE.md). `PUBLIC_DUMP=<dir>` writes each page's readable text, one file a page: grep it before you call a page clean.
- Words in a file another PR holds go in its PENDING (page, phrase, file and PR); a stale line fails.
- A new cookie goes in its COOKIES and in the privacy page's list (counsel's). A font, script, stylesheet or picture comes from the house (`/static/fonts.css`, `public/fonts/`); the CSP names no font host.
- Taking a page off the public house: Studio-only, a stranger 302 to /about, `noindex`, its links out of DOORS, FOOT, /about and the peephole; nothing deleted.
- The repository krafftco/watermark is public (`gh api repos/krafftco/watermark --jq .private` is false): comments, docs and HISTORY are readable by anyone.

## The first sale (#193)
- Who makes a print is per edition: `print_editions.made_by` ('house' | 'maker' | 'hand'); the order carries `print_orders.by_maker` (and `pickup` for 'hand'). The press's `sweep()` never offers a `by_maker` order to a shop. `t.print.made` is set only when not the house's, so the house's terms (and their fingerprints) read as before.
- A print's money clears when its order is sent; a print taken by hand (`by_maker=1 AND pickup=1`) clears on the hold from payment like any sale. Change that in `src/payouts.js` and in `test/statements.js`'s per-maker questions together.
- Checkout sessions: Stripe v23's API keeps the address at `collected_information.shipping_details`. A grant from `/thanks` must pass `session: s`, or the print's address is lost.
- `.cat` is two things (the Studio's works table and the record's catalogue grid): scope a table rule to `table.cat`. A work's record at 390: probe without `isMobile` too; with it, Chrome widens the layout to the widest thing and every box looks guilty.
- `public/desk-tabs.js`: a hash naming an element inside a panel opens that panel (`#prints`, `#editions`); tab ids come from heading text, so never link to `#t-…`.
- `test/firstsale.js` uploads through the vault's own doors; two test pictures that differ only in size or hue are the same picture to the fingerprint (flip, negate or greyscale one).

## The reply link (#184)
- A license the maker writes is `status='offered'`, `rights.written`, `house_cents=0`; its accept link is `/c/:ref?k=<download_token>` (grant replaces the token, so the link stops opening the offer). `app.locals.requests.waitingOther(l)` decides whether /c/:ref shows the offer page; a written license sent to payment and back unpaid is `awaiting_payment` and still shows it.
- Credit only is `uses.price_cents = 0` (or `rights.credit`): never sent to Stripe (Stripe refuses 0). `rights.credit` swaps Section 3 for `K.CREDIT_ONLY`; absent otherwise, so every old fingerprint holds. `K.seal(t, {work, maker, ref})` is the one way to fingerprint an order. On the visitor's pages a price of 0 reads through `useFee` in views.js ("Credit only"), never `money(0)`.
- /rights/:handle is an institution's desk or, for a photographer (`kind='maker'`, not `door='play'`), their reply link; the photographer's page holds no form. `test/replylink.js` walks all of it (also run it with DATABASE_URL on the local Postgres).

## Collect retired (#208)
- `src/collect.js`: `COLLECT=on` (env) offers the Collect ('social') and the Reference again; unset, both are closed in
  `listed()`/`offered()` (app.js), which closes every door that asks them. `offered0` is the gate without it, used only
  by a standing order already running (`collectFor(b, slug, true)`). Read `COL.on()` at call time, never at require.
- A test that walks the Collect's own code sets `process.env.COLLECT = 'on'` at its top (smoke, holds, fee, onview,
  sitters, instances); `test/collectoff.js` walks the house as it is (off): no offer on any door, no price under $100
  beside a picture, the wall label (`.wlb`, `labelOf` in app.js), the holder's papers unchanged byte for byte.
- A `${}` inside a single-quoted string in a view is printed as written: turn the string into a template literal.

## The house's address (#215)
- No file spells the house's host but `src/address.js` (`test/address.js` fails on one in src, public, test, scripts or bin).
  A link or a bare host: `require('./address').base()` / `.host()`; the letterbox: `.email()` (it does not follow BASE_URL).
  In app.js routes `C.base` is the same thing with the test house's own base.
- `public/house.js`, `public/k.js` and `bin/watermark.js` run away from the house: they carry `{{HOUSE}}`, written in as
  they are served (`/house.js`, `/k.js`, `/push/watermark.js`). Read raw they fall back to where the script came from.
- The settings are read as modules load (`legal.js`, the UA strings): a test of another address sets `process.env.BASE_URL`
  before its first `require`, and proves "unset" in a child process.
- The old-host redirect (app.js, after `trust proxy`) turns only GET and HEAD, never `/healthz`, `/stripe/webhook` or a
  request with a Bearer key, and answers `no-store`: the edge's picture cache is not keyed on the host. A new machine
  door that is read with GET and no key on the old host needs a line in `STAY`.
- The namespaces in `ADDR.NS` are names inside issued files; they never follow the address.
- The identity (#220): `did:web` is a host, so the house has one identity per address it has had (`C.left`, from
  `ADDR.leftHosts`: the old hosts and the first host, even with `OLD_HOSTS=none`; empty with no address set and on the
  test house). `/.well-known/did.json` and `/m/<slug>/did.json` answer on the host asked, never redirected; issuing uses
  `HOUSE()`, checking accepts `OWN()` (bridge.js). `test/identity.js` runs several houses in one process: each needs its
  own folder, and the same `secret` gives the same signing key (the ledger's key is one per process).
- A credential is built when it is asked for, never stored: there is no table of issued credentials to count or re-sign.
- The workflows read the live address from the repository variable `HOUSE_URL` (unset: where the house first stood).

## Curators and shows (#225)
- 'Kept back' is two things: `works.status='hidden'` (not public yet; the curator's desk marks these 'kept back') and `works.keep_back=1` (the maker's own word, also the tidy's and a safety hold's). An approval may publish the first, only by name (`with=all` + `seen`), and never the second.
- A show's `hangs.slug` moves with its title; the addresses it left are in `hang_was`. Link a show by `app.locals.hangs.href(h)`, never by a slug you stored; a new door keyed on a hang's slug needs the old-address line in hangs.js (`wasAt`).
- What a curator is paid is one sentence, `curatorShare()` in hangs.js; a page or letter that speaks of the share reads it. test/curators.js holds the sentence against `reward()`.
- The letters in `src/mail-letters.js` have a plain-text twin; write the sentence once as a string and put it in both (`esc` it in the HTML).

## A bought print, and who reads a certificate (#224)
- A print's licence has no `download_token`: any door that proves the holder by `?k=` is shut to a print buyer. Prove them by `buyerOf(req)` as well. A print's number is `rights.print.no` / `print_orders.edition_no`, never `collector_no`.
- Say a print's number, where it is and when its maker is paid from `src/printpapers.js` only. `/c/:ref` takes `pub`: add nothing about the holder or the money outside `!pub`.
- A kept picture's `licenses.rights` is `{ size, strip }` with no `rights`/`added`/`extras`: read terms through `holds.termsOf`, never `t.added.includes`.
- `test/printpapers.js` takes `SHOTS=<dir>` and writes the letters and the buyer's pages at 390.

## The photographer's first ten minutes (#223)
- A work's own desk is `/account/works/:slug` (the Studio's is `/studio/works/:slug`); the studio's holdings, the Library's loupe and Enter, and `/w/:slug` for its maker (`edit` in views.work) all lead there. `/w/:slug` is the page a collector sees.
- `public/table.js` and the vault page's inline script are a few very long lines: a `//` comment added at the end of one swallows the rest of the line, and the page dies silently with nothing on it. Use `/* */`; `test/firstminutes.js` parses both.
- The vault's page takes JPEG, TIFF and PNG; the server's raw door (src/raw.js) is for the arrivals a DNG reaches by other roads. The page names a raw file by its extension and leaves it out (`RAW` in account-views.js upload).
- A walk in a browser: `.lib-tk` (a tile's tick) is under the picture for Playwright's pointer; `dispatchEvent('click')` on it selects. An album's `share_token` is made when its desk page is first opened.
- A test house has no Stripe: `/w/:slug` offers no print there (editions.js `canSell`), so prove an offer with test/firstsale.js's stub.

## The shelf's passages (#126)
- Wander's shelf reads `passages` (kept paragraphs, 48 a book at most) and `passage_marks` (one line a book: how many,
  the book's stamp). `app.locals.commonplace.gather()` is the worker's round that fills them; a test house has no
  timers, so a test that shelves a book calls `gather()` before it asks the shelf for it. A book whose body changes
  must move `updated_at` (the stamp): the shelf drops its passages until the next round reads it again.
- The gate's fixture carries 400 shelf books (`BIG_BOOKS`, `BIG_BOOK_KB`): `BIG_BOOKS=200 BIG_BOOK_KB=1000` is a
  library of whole books (200 MB of text; the build is 1.6 GB on disk, the move to Postgres a few minutes). A desk
  that lists texts will show in the gate when you add books: that is the fixture working, not your change.
- SQLite reads a row's overflow pages to reach a column that sits after `body` (`updated_at`, `subscribers_only`);
  Postgres does not open the body for them. A time on SQLite for a texts statement that never names `body` can
  still grow with the book's size; judge those on Postgres (BIG_PG).

## Backups and the drill (#162)
- The vault has two roads: `put`/`get` hold the object whole (masters, small things); `putFile`/`readStream` are streams
  in the same sealed format (`WMV1`, nonce, body, tag), for the database's copies. What `readStream` passes on is proven
  only at its end (the tag): write it to a file and trust the file after the pipeline resolves, never before.
- A bucket takes a stream in parts of `VAULT_PART_MB` (16; 5 in `test/backup.js`). The stand-in clients in `test/s3.js`
  and `test/vault.js` know no part commands; `test/backup.js` has one that does.
- A drill is a `backup_runs` line from its start (`step='begun'`, `ok=0`) and is updated when it ends. A reader that
  asks "did the last drill fail" must allow for one under way (`summary().drill.running`).
- The drill never begins unless the scratch restore is known to fit on the database server (`room()` in backup.js).
  A server not on the test's machine (CI's container, Render) needs `DRILL_MIN_FREE_MB`; CI's `postgres` job sets it,
  `test/backup.js` sets its own. A smoke run against a remote Postgres without it fails at "the drill restores".
- The drill is due only after a copy made in the night (`drillDue(now, { copied })`); nothing starts one by the clock.
- Memory in a test: the kernel's high-water mark (`resourceUsage().maxRSS`) of a child begins at its parent's size.
  Sample `process.memoryUsage().rss` inside the child instead.
- `test/backup.js` writes about four times `BACKUP_TEST_MB` (256) to TMPDIR and, on Postgres, as much again on the
  server. A full-size run (660 MB) wants 5 GB free; this machine had 3.6 GB on 27 Nov and it was not run.

## The presses, counted (#242)
- `CHROME=<chrome> node scripts/taps.js` walks a small house on an iPhone 13 as a stranger and counts the fewest presses
  from `/` to each thing in its `THINGS` (`TAPS_MD=file` writes the table, `TAPS_DEBUG=1` every screen read). About two
  and a half minutes here, so it is not a CI job. It fails over four presses; `ALLOW` names an issue per exception.
- Its house is small: every list holds the thing looked for. On the live house Find's opening state shows only the first
  10 artists, 8 movements, 8 mediums, 16 decades, 6 museums, 14 places and 8 makers (`before()` in src/find.js), so a
  count that passes there says the door exists, not that a given artist is on it.
- `/` on a phone is Wander with a picture chosen afresh each visit: a walk that must return to "the first screen" cannot
  count on the same picture. A link on that picture's plate is found by its class, not its words.
- Wander puts the tab bar away after a few seconds still (#235): read the screen within a second of arriving, or touch
  the picture first. A room fades in: a control read in the first half-second can be under the fade.
- A new context for each read keeps the walker a stranger: Find's opening state and `/yours` change once the house has
  seen the visitor stand before a work.
