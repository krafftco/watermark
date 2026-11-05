# Operations

5 November 2026. How the house is run, now that it is two machines and has guests.

## The machines

- **watermark** (Render, Pro, 4 GB): the website. `ROLE=web`. Serves people and keeps only what must live beside them: payments settling, arrivals landing, the copy of a new original to the vault, push, the balcony, its own display copies.
- **watermark-worker** (Render, 2 GB): `ROLE=worker`. Every chore: feeds and imports, the fills, conservation, backups, the letters, Friday pay. It writes a heartbeat every thirty seconds; the website's `/healthz` reports it as `worker.stale`. Past 85% of its memory the chores hold; two minutes there and it restarts itself (the queues resume from the database).
- **watermark-db** (Render Postgres 16, 1 GB). **The vault**: S3 (`watermark-vault-collection`, versioned, Object Lock, replicated to Oregon). **The edge**: CloudFront.
- **watermark-next** and **watermark-next-worker**: the test house, on branch `next`, its own database.

## The deploy window

One promotion a day, **06:30 New York, Monday to Friday**, by `.github/workflows/promote.yml`: `main` moves to `next` when the latest `test` run on `next` is green and the house is not being shown. Render deploys `main` after CI. The live walk (`live.yml`) reads the doors afterwards; a fault mails the owner.

- Everything is built on `next`. The test house runs it the same day.
- A push to `main` by hand outside the window is a **hotfix**: the commit says `hotfix` and why. Rare.
- No deploy while the showing is on (Studio → Launch). Turn it on before a demonstration; turn it off after.
- A red `test` is a stop. Read `gh run list --limit 3` after every push.
- A deploy still costs about a minute of the cold page for first-time visitors until the website's disk comes off (next).

## The week

| When (New York) | What | Where |
|---|---|---|
| Mon–Fri 06:30 | the promotion, then the live walk | GitHub |
| every 10 min | the watch: origin and edge, four doors | GitHub |
| daily 03:00 | the nightly backup (BACKUP_HOUR 7 UTC) | the worker |
| Sunday 03:00 | the restore drill | the worker |
| daily 02:30 | the import fire drill | GitHub |
| daily 08:00 | the digest to the house (DIGEST_HOUR 13 UTC) | the worker |
| Friday 09:00 | the makers' Friday letters | the worker |
| Friday 10:00 | Friday pay | the worker |
| 1st of the month | the looking letters | the worker |
| 1 January | Public Domain Day | the worker |

## The rules

1. One heavy job at a time on the worker (a feed, an import, a catalogue). Watch `/healthz` (full, with the Studio cookie): `governor.rss`, `lane`, `booting`.
2. Every change ships with its test, in `npm test` and on CI's Postgres job.
3. Nothing is laid into the pixels of a served picture; `test/pictures.js` is the gate.
4. Never `SELECT *` from works or texts for a list on Postgres.
5. A new room goes into `ROOMS` and `DOORS` the day it is built; a new class prefix is checked against style.css.
6. Secrets live in Render's environment, never in chat or code.
7. Counsel reads a thing before it is advertised: the terms, the premium, releases, open prints, the registry, the price book, the gifts.

## When something is wrong

- `/healthz` (the street): `ok`, `ver`, `role`, `worker.stale`, `up` (a crash loop shows as `up` never growing), `faults`, `disk`.
- The edge answering the cold page with a large `age`: the edge, not the house; POST /studio/edge/clear.
- The worker stale: Render → watermark-worker → Logs; `[governor]` lines say why it held.
- A bad deploy: `scripts/rollback.sh` (revert HEAD and push), or Render → Rollback to the previous deploy.
- Closed for the moment (Studio → Launch) answers every write 503 for a move or a restore; GET pages keep serving.
- Backups: Studio → Back office → Backups; by hand `node scripts/restore.js`.

## Next, in order

1. Display copies to the bucket behind the edge, then the website's disk off: zero-downtime deploys.
2. An outside uptime monitor (30-second checks, a text to Will).
3. The second cut of the queue: hand-pressed jobs (a document, a read-aloud) to the worker.
4. A second web instance behind the edge once the disk is gone.
