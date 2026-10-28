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

## The next three, in order

1. **Postgres.** The database on the disk is why every deploy is a minute of 502 (Render cannot run two copies of
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
