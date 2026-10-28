# The worker

28 October 2026, the morning the house moved onto Postgres. Two processes from one image; `ROLE` decides.

## What it is

- **`ROLE` unset** (or `all`): the house as it has always run, everything in one process. This is the live house today
  and every test.
- **`ROLE=web`**: serves people. Runs only what must live beside them: payments settling (the webhook lands here), the
  arrivals pump (files land on this disk), the copy of a new original to the vault (`vaultPending`: the file is here),
  push, the balcony's clock, the renditions warmed for its own cache, the in-memory sweeps. Every other chore is off,
  the governor's `chores()` answers false, and a feed or a pictures run pressed in the Studio is queued in the
  database for the worker.
- **`ROLE=worker`**: every chore of the house (the fills: guides, studies, jackets, speech, art; feeds and the pictures
  of the books; documents; conservation, fixity, the mirror; backups and the drill; the letters: wall, looking, first
  week, Friday; Friday pay; the lab's poll; the press's sweep; the renewals; the Studios sync; the digest and the alarm)
  and no visitor. It writes a heartbeat to `settings.worker_beat` every thirty seconds; the web's `/healthz` reports
  `worker: { seen, stale }` and the GitHub watch fails when the heartbeat is older than three minutes. It re-reads the
  showing switch every half minute, since the switch is pressed on the web.

What stays with whichever process presses it (first cut): a document brought in by hand, a book's edition read aloud,
a re-cut, a single feed's retry: these run through the governor's lane in the process that took the press, which on a
split house is the web. They are short. The second cut moves them to the worker through the same queue as feeds.

`src/role.js` is the switch; every chore timer asks it. `test/role.js` proves the three roles.

## Opening it (Will's hands, from the dashboard; never a blueprint sync on the live house)

1. Render → New → **Background Worker** → the `krafftco/watermark` repo, branch `main`, runtime Docker, Oregon,
   name `watermark-worker`, plan Standard (2 GB; the fills decode pictures and the speech fill holds audio). No disk.
2. Environment: every variable of `watermark` except `TRUST_PROXY`, `PORT` and the disk's `ORIGINALS_CACHE_GB`
   (Render's "copy from service" or by hand), plus **`ROLE=worker`**. `DATABASE_URL` the same internal URL. Leave
   `DATA_DIR` unset (the image's `/app/data`, ephemeral: the worker keeps only caches there).
3. Deploy it; its log says `[governor]` lines and no `Watermark listening` matters. On the web's `/healthz`, nothing
   yet (`worker` is reported only once the web is `ROLE=web`).
4. `watermark` → Environment → add **`ROLE=web`** → Save, rebuild, and deploy (a cold minute, the last one before the
   disk comes off). `/healthz` now says `"role":"web","worker":{"seen":…,"stale":false}`.
5. Watch a day: the digest arrives from the worker; `/healthz` stays `stale: false`; Studio → The numbers' Health
   still reads (its register, mail, Stripe lines are the web's; backups, fixity and conservation summaries are read
   from the shared tables).

The way back: remove `ROLE` from `watermark` (everything in one process again) and suspend the worker.

## Then

- The disk off `watermark` (a week after the move, `docs/MOVE.md`): deploys become zero-downtime.
- The second cut of the queue (hand-pressed jobs to the worker).
- A second web instance behind the edge once the disk is gone (Render scaling), since nothing is on the box.
