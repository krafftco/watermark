# Moving the house onto Postgres

The runbook for one evening, written 28 October 2026 after the test house moved. Read it through once, then do it
top to bottom. Nothing here is clever; the point is that nothing is forgotten.

## Before the evening

- [ ] The test house (`watermark-next`) has run on Postgres for a day with no faults on `/healthz` and a clean walk
      (sign-in, a Collect in test money, a backup and the drill, the Studio desk, Wander, the Library).
- [ ] A Render Postgres for the live house: **PostgreSQL 16** (the client in the image is 16; `ARG PG_VERSION` in the
      Dockerfile and the PGDG line in CI change together when the server moves), Oregon (the service's region, so the
      internal URL works), a plan with at least 1 GB of RAM (the house's register and `hits` are the big tables; the
      0.1 CPU / 256 MB plan is the test house's), storage with headroom over the SQLite file's size × 3.
- [ ] The database's **Networking**: remove `0.0.0.0/0` from the inbound rules once the move is done; the house talks on
      the internal network. Keep it open only while the shell needs the external URL (it does not: the shell runs inside
      Render).
- [ ] A fresh SQLite backup has run tonight (Studio → Back office → Backups → Back up now) and the drill passed.
- [ ] Nothing heavy is running: no feed, no canon run, no pictures run (Studio → Feeds in; `/healthz` full → `governor`).
- [ ] No event, no demonstration, no Friday morning (Friday pay runs from ten New York).

## The evening (about twenty minutes; the house is read-only for ten of them)

1. **Close for the moment.** Studio → Launch → Close for the moment (and the showing on, if a demonstration is near). Every chore holds and no write lands; the desk's line says so. Push nothing.
2. **The copy.** The SQLite file lives on the service's disk, and only the service's own Shell can see that disk (a
   one-off Job runs the image without it), so the copy runs from Render → `watermark` → **Shell**, with the house up
   and the chores held:
   ```
   cd /app && DATABASE_URL='<the live Postgres internal URL>' CHORES=0 NO_SEED=1 node scripts/to-postgres.js /data/watermark.db
   ```
   It prints each table's count on both sides, sets every identity sequence, and ends with the register verified or a
   named fault. A fault means stop: `psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'` on the
   new side, read the fault, the live house untouched.

   The gap: a write that lands between the copy's start and the deploy below lives only in SQLite. Note the register's
   head `seq` (`/ledger.json`) before the copy; after the deploy compare it with the SQLite file's (the Shell again: `node -e "console.log(require('better-sqlite3')('/data/watermark.db').prepare('SELECT MAX(seq) s FROM ledger').get().s)"`). Equal (the usual case
   at two in the morning) means nothing was lost; otherwise drop the schema and run the copy again before deploying.
   Since the move, the house has the switch: Studio → Launch → **Close for the moment** (`settings.readonly`): every
   write from the street is refused with the sign (reading goes on, the chores hold, Stripe's webhook is refused and
   Stripe retries it), so the copy runs with nothing landing. Close before the copy, open after the deploy, and the gap
   is gone.
3. **Switch.** Render → `watermark` → Environment → add `DATABASE_URL` (the internal URL) → Save, rebuild, and deploy.
   One deploy, the usual cold minute. `TRUST_PROXY=2` and everything else stay.
4. **Check.** `/healthz` → `"db":"postgres"`, `ledger: true`, `works` the same count as before. Sign in. Open a work.
   Studio → Back office → Backups → **Back up now** (the first `pg_dump`), then **Restore drill now** (needs CREATE
   DATABASE on the role; Render's default role has it). The register page. The numbers. A $7 Collect with a real card,
   refunded in Stripe after.
5. **Open again** (and the showing off). Chores resume; `warmAll` and the fills will touch Postgres for the first time under load. Watch
   `/healthz` full for ten minutes: `faults`, `governor`, the deploy's log for `[pg]` lines.

## After

- The disk stays mounted and `/data/watermark.db` untouched for **a week**. The way back inside that week: remove
  `DATABASE_URL`, deploy; the house is on SQLite as it was, missing only what happened on Postgres since.
- After the week: Render → `watermark` → Disks → remove the disk. With no disk, deploys are zero-downtime (Render runs
  the new copy beside the old) and the cold minute is gone. The vault was already S3; the local originals cache
  (`ORIGINALS_CACHE_GB`) and `cache/served/` and the renditions then live on the instance's ephemeral disk and are
  rebuilt after each deploy (`warmAll` 15 s after start; the first visitor to a picture may wait a second). If that
  shows, a small disk can come back for the caches alone, at the price of the cold minute.
- Backups: nightly `pg_dump` into the vault as before, plus Render's own daily snapshots of the Postgres (its plan's
  retention). `scripts/restore.js [key]` for a copy by hand.
- Then 2.0: the worker. With no disk, a second service (`render.yaml` worker, the same image, `WORKER=1`) runs the
  chores; the web process serves people only. Postgres is the only shared state, so the governor's lane becomes the
  worker's queue.

## The live move, as it went (28 Oct 2026, 7:31–7:47 am ET)

Done in the morning at Will's word, not at two in the morning; the gap was empty anyway (the register's head read
4384 before the copy and after the deploy). What the runbook had not foreseen:

- `founders.js` read `settings` at mount, before the room that makes it, and only when `FIRST_COLLECTOR` is set (live
  only, so the test house never tripped): the script fell at the schema. Fixed in the code; the copy was run with
  `FIRST_COLLECTOR=` blanked for the script alone.
- The Shell is a production door the guard keeps the assistant from: the copy is Will's hand. The variable is first
  set as `MOVE_DATABASE_URL`, so the house never boots onto the empty server; the script reads it by name
  (`DATABASE_URL="$MOVE_DATABASE_URL"`) and the value is never in the chat.
- The first `pg_dump` on the live house (151 MB, `hits` is most of it) ran synchronously and froze the house for half
  a minute; the edge showed the cold page. backup.js now runs the pg tools and gzip off the event loop. The drill on
  a dump that size is for the night.
- The bag check's desk had sat on `/studio/door` since 21 Oct and looped every signed-out visitor; found because the
  pane's Studio cookie did not survive the move. Moved to `/studio/bagcheck`.

## The test house's move (28 Oct 2026)

Rehearsed first on `watermark-next`: `DATABASE_URL` set to `watermark-next-db`'s internal URL, one rebuild, the house
made its schema on an empty Postgres (the test house's 510 SQLite works were not carried; it is a test house and was
re-seeded).
