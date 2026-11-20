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
- Jobs: `test`, `postgres`, `load`, `a11y` (also runs `test/wayback.js`), `reach`, `reach-webkit`. All must be green before `main` moves (promote.yml names each in `NEEDS`; rename one, rename it there).
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
