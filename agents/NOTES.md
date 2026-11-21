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
