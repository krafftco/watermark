# Stability: the freeze, the gates, the rhythm

Will, 7 November 2026: "we need to stabilize this build and we need to make this company secure and have legitimate
process." This is the process. It is short on purpose; every line is something the house does or a person does on a day.

## What broke this week, and why

| When | What people saw | Cause | Fixed by |
|---|---|---|---|
| 5 Nov, 6 pm | one request in thirty-five answered 502 at the edge | Node closed idle connections before the proxy did (keepAliveTimeout 5 s) | 1.68.2: keepAliveTimeout 65 s |
| 6 Nov, evening → 7 Nov, morning | pages and pictures failing at random; the cold page | the warm (every work's display copies) ran on the website beside visitors; 3.8 GB of 4 GB inside two hours of every restart | 1.71.3: the warm on the worker only |
| 7 Nov, 9:38 | the cold page for a minute | a deploy (the hotfix above); the service still has a disk, so a deploy restarts it | Will: remove the disk (OPERATIONS.md); deploys are then zero-downtime |
| 7 Nov, the load test | a missing picture copy took seconds under load and held every other picture behind it (one sharp thread) | a WebP miss beside a finished JPEG; a thumb made from a 60 MP master | 1.72.0: copies made from the copy above; a stand-in served at once |
| 8 Nov, 9:50 pm and 9 Nov, 11:38 am | the website alive and logging but answering no one (Render's 'service unavailable') until Will pressed Restart | picture work on the website (re-encodes and resizes in native memory, 1.5 GB with a 300 MB heap) and every database question waiting on the main thread (up to 120 s each) | 1.76.1: the website does no picture work (the nearest finished file or the dark, and a ticket); a website question waits 20 s at most; slow questions logged; the watchdog restarts a website that stops answering |

The pattern: the house grew from 400 works to 20,000 in a week (the Met, MoMA, the Gallery) on settings made for October. Each fault was the website doing a whole-collection job, or a cold job, in front of visitors.

## The rules

1. **Nothing that walks the whole collection runs on the website.** Warms, fills, feeds, reads, plans, tidies: the worker. The website serves people and makes a single copy when asked, from the nearest copy it has.
2. **A visitor never waits on a master.** A missing copy is answered by the nearest smaller copy at once (uncached) and the real one is made behind. The load test proves it on every promotion.
3. **One heavy job at a time on the live house**, and none while the showing is on.
4. **The freeze.** Until the checklist below is green, `next` takes repairs, measurements and the items on this page; no new rooms. A new room waits in a branch.
5. **`main` moves at the window** (06:30 New York, weekdays, when `test` is green on `next` and the showing is off). A push to `main` outside the window is a hotfix: the promote workflow is dispatched by hand with a reason that names the fault, and the deploy's cold minute is accepted knowingly. Never while people are being shown the house.
6. **A red test is a stop.** After every push: `gh run list --limit 3`. Nothing is promoted on a red.
7. **The watch is the pager.** `watch.yml` every ten minutes: the origin, the edge, the worker's heartbeat, the website's memory line, four doors. A failure mails the repository's owner. The morning digest (13 UTC) carries the night; the alarm writes within the hour of anything in `wrongs()`.
8. **Every fault gets a line in the table above** before its fix is promoted: when, what people saw, the cause, the fix.

## The gates (before a promotion that touches app.js, images.js, stroll.js, the governor, the bridge or the vault)

- `npm test` green on `next` (CI).
- `node scripts/load.js` holds: forty visitors for forty-five seconds over sixty works of four sizes (one at 6,000 px); p95 of every page under 1.5 s, no errors, the stand-in answering in under 800 ms, memory growth under 300 MB.
- `node scripts/wander-walk.js` against the test house: all ten hold.
- `/healthz` on the test house after an hour: `mem.over` false, `faults` 0, `worker.stale` false.

## The lines the house watches itself

- The website: `GOV_WEB_LINE_MB` (60% of the box). Over it, `/healthz` says `mem.over`, the watch fails, the alarm writes. The website never exits itself; a restart is a person's call (free once the disk is off).
- The worker: `GOV_MEM_HARD_MB` (85% of the box). Over it the chores hold, and after two minutes the worker restarts itself and resumes its queues.
- The governor: one lane for pressed work, one for the boot chores; every chore yields to visitors; `CHORES=0` is the kill switch; the showing holds every chore.

## The checklist to leave the freeze

- [ ] The disk off the website (Will, Render → watermark → Disk; OPERATIONS.md). Deploys zero-downtime; the cold page gone from deploys.
- [ ] The worker's warm through the whole collection once (the bucket holds every copy; `/healthz` `renditions.done`).
- [ ] Seven days of the watch green, no restart that was not a deploy.
- [ ] The load test in CI against a seeded house on every push to `next` (today it is run by hand).
- [ ] The staging house exercised by the Wander walk and the load test before each window.
- [ ] A restore drill passed on the live database's copy this week (Studio → Backups).
- [ ] Will's security hands from SECURITY.md: 2FA on Render, GitHub, Stripe, Resend, AWS; STUDIO_EMAILS set; the vault's IAM user's old key deleted.

## The rhythm

- **Daily**: the watch (automatic); the digest at 9 am New York read by a person; the house desk's Needs.
- **Weekdays 06:30**: the window. What is on `next` and green goes to `main`.
- **Friday**: pay runs at ten; the week's faults table reviewed; the checklist above walked.
- **Sunday**: the restore drill; the Wander walk and the load test against the test house.

## Who does what

- The house (code): the watch, the digest, the alarm, the lines, the gates in CI, the promotion at the window.
- Claude, in this repo: repairs on `next`, the load test before a promotion, the fault table, this page.
- Will: the Render hands (the disk, settings, restarts), the AWS and Stripe consoles, the showing switch, 2FA everywhere, counsel.

- 9 Nov, 15:14 ET: the website over its memory line and restarted twice. Cause: /collection, /house, /makers and /api/index.json read `SELECT * FROM works` for every hall work (48,000 rows with guides and readings; 5–6 s on the bridge and ~800 MB of heap a request; three in twenty seconds). Fix (1.77.2): `hallList()` in app.js, the best COLLECTION_MAX (1200) without the heavy columns, kept two minutes; the page takes the true total apart. Rule restated: no page reads the whole collection.

- 9 Nov, 15:58 ET: Wander's first byte at 14 s through the edge, then 502/503 and a watchdog restart. Cause: the open wander's pool was `SELECT w.*` of every work on the open walls (50,000 whole rows, ~800 MB, six seconds on the bridge), keyed on the register's head and the copies made, twenty pools kept; with scribes making eighty copies a minute every request rebuilt it. Fix (1.77.4): the pool is id, slug, curated, stars, kept two minutes by the clock (WANDER_POOL_S), four pools at most; the screens shown are read by id. The load test must run at the live collection's size.

## The scale plan (Will, 9 Nov: "we are only going to get bigger")

Every fault of 9 Nov was one pattern: a page or a timer on the website reading the whole collection. Fine at 5,000 works, painful at 60,000. The plan, tracked as tasks "Scale 1/5 … 5/5" in Notion (Operations → Tasks, project Watermark):

1. Sweep every visitor path and every website timer for whole-collection reads; each gets a LIMIT, named columns, or moves to the worker. Done when an hour of the live web log shows no `[pg slow]` line.
2. The load test builds a house at the live size (100,000 works, then a million) with page-time budgets, in CI on next.
3. A slow-question budget the house enforces: CI fails on one in the load test; the live list rides in the morning digest.
4. Indexes, and Postgres choosing and sorting instead of the house reading everything.
5. Public pages cached at the edge; via-house arrivals off one machine's disk; a second website instance.

Rule for every new room from here: say how it behaves at a million works before it ships.
