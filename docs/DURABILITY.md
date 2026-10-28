# Durability, and the development room

Draft, 27 October 2026, after the house went down for half an hour under two of its own chores. Will: "build for
durability; learn from this; build the systems that allow us to make these edits and changes; the most stable
system, but allow us to continuously innovate; a development room constantly running; we have to outrun everybody."

## What holds the house up today

1. **The governor** (`src/governor.js`). Every chore the house runs for itself takes one lane, one item at a time,
   and waits between items while a visitor is served or memory is high. A feed that ran through two restarts is
   paused, not resumed. `CHORES=0` in the environment boots the house with every chore off: the way back when a
   chore is the trouble.
2. **The edge cleared after every boot** (`src/edge.js`). CloudFront is told to drop every copy 25 s after the house
   is up, so a recovered house is never hidden behind a cached cold page. By hand: POST /studio/edge/clear.
3. **The watch** (`.github/workflows/watch.yml`). Every ten minutes GitHub asks the origin and the edge. A failure
   mails the repository's owner. The origin sound and the edge failing is named as the edge's fault.
4. **The gate** (`.github/workflows/test.yml`). Every push runs the suite; Render waits for it when "Wait for CI"
   is on (Will's switch in Render).
5. **The walk after a deploy** (`.github/workflows/live.yml`). When the tests pass, GitHub waits for the commit
   to be live (`/healthz` carries `ver`) and opens twelve doors. A door that fails mails.
6. **Rollback** (`scripts/rollback.sh`). One command reverts the last commit and pushes; Render deploys it.
7. The older measures: nightly sealed backups with a restore drill, the restoration room, fixity, the bag check,
   the Studio door, the audit, the limiters, the CSP.

## The development room

Two houses from one repository:

- **`next`** → `watermark-next` (`render.staging.yaml`, applied once by hand in Render): STAGING=1, test money,
  mail only to MAIL_ALLOW, its own disk and database. Every change lands here first and is walked here.
- **`main`** → the public house. Promoted from `next` by a merge when the walk is clean; one push, batched, never
  during an event, never while a long chore runs on the live house.

The rhythm: build on `next` all day at the speed we build now; the public house takes one or two promotions a day
(each is a minute of the cold page at the edge) and nothing it has not already run.

Opened 27 Oct 2026, 9:47 pm ET: the service `watermark-next` (srv-dbgl85uc6qcc73c06mp0, Oregon, Starter, a 5 GB
disk at /data, health check /healthz) was made by hand from the dashboard (not a blueprint), with the non-secret
values of `render.staging.yaml` and generated SESSION_SECRET and VAULT_KEY. Will's hands, still: ADMIN_PASSWORD,
MAIL_ALLOW, RESEND_API_KEY, the test Stripe keys and STRIPE_WEBHOOK_SECRET in its Environment; a CNAME
`next.watermark` → its Render address in Route 53. Without the secrets it runs with mail and Stripe off, which is
enough to walk a change. The branch flow begins now: build on `next`, walk it there, promote to `main`.

## The database: two engines, one shape (27 Oct 2026)

Built the night the development room opened. `DATABASE_URL` names a Postgres server and the house runs on it;
without it, SQLite in one file as before. Nothing in the rooms changed: every `db.prepare(sql).get/all/run`,
`db.exec` and `db.transaction` goes through the bridge (`src/pgsync.js`), a worker thread that holds the one
connection and answers through shared memory while the main thread waits (`Atomics.wait`), and the dialect
(`src/dialect.js`) turns SQLite's idiom into Postgres's on the way: `?` → `$n`, `datetime('now', …)` with every
modifier the house uses, `INSERT OR IGNORE`, `pragma_table_info`, `sqlite_master`, `LIKE` → `ILIKE` (SQLite's is
case-blind), `IS ?`, two-argument `MAX/MIN` → `greatest/least`, `total`, `group_concat`, `json_extract`, `instr`,
`@named` parameters, camelCase aliases quoted, and in DDL `INTEGER PRIMARY KEY` → an identity column and every
`INTEGER` → `BIGINT` (SQLite's is 64-bit; millisecond clocks and byte counts live in it). Three statements the
rules could not reach were rewritten in words both engines accept (`INSERT OR REPLACE` → `ON CONFLICT … DO
UPDATE`, an alias in `HAVING`, `SUM(a=b)` → `SUM(CASE …)`, `COLLATE NOCASE` → `lower()`).

Proof: `scripts/sql-check.js` prepares every statement in the source (2,444 of them) against a real Postgres,
and the smoke suite and the other tests pass on both engines; CI runs both (`.github/workflows/test.yml`,
`postgres` job). `test/dialect.js` holds the rules. The cost of the bridge is one blocked round trip per
statement, a few hundred microseconds on Render's private network; rooms can move to the async form later, one at
a time, as a performance pass, and the bridge stays for the rest.

Backups on Postgres: `pg_dump` (custom format) gzipped and sealed into the vault as before; the drill restores the
copy into a scratch database on the same server (`wm_drill_…`), checks the register against the live one and
verifies the chain, then drops it; `scripts/restore.js` fetches a copy and names the `pg_restore` to run. The
Dockerfile carries `postgresql-client-17` from PGDG.

Moving a house: `DATABASE_URL=… node scripts/to-postgres.js /data/watermark.db` with the old house stopped: the
schema is made by the house itself, tables copied in dependency order, identity sequences set, every count
compared and the register's chain verified on the new side. Rehearsed on the test house first; the live move is a
short freeze (the showing switch), the script, `DATABASE_URL` set in Render, one deploy, and the disk kept for a
week before it is removed. Postgres is portable: Render's now, a dump and a restore to Neon or RDS later.

## The next three, in order

1. **Postgres.** (The code is done, above; what remains is the move itself: the test house first, then the live
   house.) The database on the disk is why every deploy is a minute of 502 (Render cannot run two copies of
   a service with a disk) and why the chores cannot move to a second machine. A managed Postgres makes deploys
   zero-downtime and lets a worker run the chores on its own box. A large change (every query), a week's work,
   the biggest single step toward durability. Not before the test house exists to prove it on.
2. **The worker.** With the database off the disk, the chores (feeds, pictures, documents, guides, speech, the
   fills, conservation, backups) move to a worker service; the web box only serves people.
3. **A second origin.** A standby copy of the service in another region behind the edge, failing over when the
   first is unhealthy. Last, because the first two make it cheap.

## Rules kept

- One heavy chore on the live house at a time; watch `/healthz` (`governor`, `vault`) while it runs.
- Never push while a canon run or a feed is on the live house.
- Read `x-cache` and `age` before blaming the house: "Error from cloudfront" with a large Age is the edge.
