# Operations

5 November 2026. How the house is run, now that it is two machines and has guests.

## The machines

- **watermark** (Render, Pro, 4 GB): the website. `ROLE=web`. Serves people and keeps only what must live beside them: payments settling, arrivals landing, the copy of a new original to the vault, push, the balcony, its own display copies.
- **watermark-worker** (Render, 2 GB): `ROLE=worker`. Every chore: feeds and imports, the fills, conservation, backups, the letters, Friday pay. It writes a heartbeat every thirty seconds; the website's `/healthz` reports it as `worker.stale`. Past 85% of its memory the chores hold; two minutes there and it restarts itself (the queues resume from the database).
- **watermark-scribe** (Render background worker, 2 GB, one or more instances): `ROLE=scribe`. One job: make every work's display copies (thumb, screen, large; JPEG and WebP) and put them in the bucket, best work first, three lanes each (`SCRIBE_LANES`). Scribes claim works from one queue, so any number may run side by side; the instance count is the speed dial. Each writes a heartbeat; `/studio/scribes` adds them up (ready, left, a minute, time to go). Set it up once: New → Background Worker, the same repository and branch `main`, Docker, this short environment and nothing else: DATABASE_URL, S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, VAULT_KEY, SESSION_SECRET, BASE_URL (and NODE_OPTIONS, S3_ENDPOINT, MARK_KEY when the worker has them), plus `ROLE=scribe`, `RENDITIONS_CACHE_GB=2` and `NO_SEED=1`; no disk. New work starts coming in only while fewer than SCRIBE_BEHIND (500) works wait for copies. When `/studio/scribes` says none are left, take it to one instance (new arrivals) or suspend it; while no scribe is seen the worker makes copies one at a time itself.
- **watermark-db** (Render Postgres 16, 2 CPU and 8 GB as read on 20 Nov). **The vault**: S3 (`watermark-vault-collection`, versioned, Object Lock, replicated to Oregon). **The edge**: CloudFront.
- **watermark-next** and **watermark-next-worker**: the test house, on branch `next`, its own database.

## The deploy window

One promotion a day, **06:30 New York, Monday to Friday** (GitHub starts scheduled runs late, often by an hour), by `.github/workflows/promote.yml`: `main` moves to `next` when the newest finished `test` run on `next`'s own push of that commit is green in every job, the newest commit does not carry `[skip render]` over code beneath it, and the house is not being shown. Render deploys `main` after CI: its check reads the checks on the commit, and a promoted commit already carries `next`'s green ones.

The promotion walks what it promoted (#66): its push, made with the workflow's own token, starts nothing by itself, so promote.yml then starts `test` on `main` and, once green, the live walk (`live.yml`, which waits for /healthz to report the commit, then opens the doors), each by workflow_dispatch, and waits for both. Their runs are on `main` at the promoted commit (`gh api "repos/krafftco/watermark/actions/runs?branch=main"`); a red one turns the promote run red with an annotation naming the run. The mail for a red scheduled run goes to whoever last changed the cron line in promote.yml. A promotion with nothing to promote starts nothing. `dry_run: true` (Actions → promote → Run workflow) does everything but the push and walks `main` as it stands. A push by hand to `main` is walked as before: `test` on push, then `live` on its completion.

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

## Moving the house's address

23 November 2026 (#215). The house is to stand at `watermark.world`; today it stands at `watermark.krafftco.com`. The code is ready from 1.94.0 and changes nothing by itself: the address is two settings, and every step below is Will's hand (Render, AWS, DNS, Stripe, mail, Google). Nothing here has been run; where a step rests on a guess it says so.

**The two settings** (`src/address.js`)

- `BASE_URL`: where the house stands. Every page, letter, card, paper, feed and file reads it.
- `OLD_HOSTS`: the hosts the house has left, comma-separated. A GET or HEAD arriving on one is answered 308 to the same path and query at `BASE_URL`. Not turned: anything posted (Stripe's webhook, the lab's callback, the Krafft sites' calls), a read that carries a key (push, the Lightroom plug-in, a partner), and `/healthz`. Unset, it means `watermark.krafftco.com`; the host named in `BASE_URL` is never treated as old.
- Beside them: `HOUSE_EMAIL` and `MAIL_FROM` do not follow `BASE_URL` (step 8), and `LIVE_URL` is for the test house only (step 10).

**The order, and why.** The new address answers first (steps 1 to 5). Then the house is told its address (step 6). Only then does the old address begin to redirect (step 7). At every moment both names reach the same house, so no step leaves it unreachable, and each of 6 and 7 is undone by putting the setting back. Do steps 6 and 7 with Studio → Launch not "being shown": each saves a setting, and Render restarts the service.

**1. The zone.** Route 53 → Hosted zones → `watermark.world`.
- Unsure: this repository does not record where `watermark.world` is registered or which AWS account holds its zone. The edge is in the wrkfullerton account (714560676112), and `krafftco.com`'s zone is in Will's AWS account. If the zone is in another account, the alias records of step 5 are still possible but are typed by hand; if the name is registered elsewhere, its nameservers must be the four the hosted zone lists.
- Check: `dig +short NS watermark.world` lists the zone's four nameservers.

**2. Render knows the name.** Render → `watermark` (the web service) → Settings → Custom Domains → Add `watermark.world`, then `www.watermark.world`.
- Why: the edge passes the visitor's Host header through to Render (the default behaviour's origin request policy, AllViewer), and Render serves only the names it has been given. On 25 October the old name was already on the service when the edge went in front, and it was left there.
- Unsure: whether Render will verify the name and issue its own certificate while DNS points at the edge and not at Render. If Render shows the name unverified after step 5, point the name at Render first as Render's own page instructs, wait for "Verified" and "Certificate issued", and then do step 5. A visitor reaching Render directly in that window is served the same house (TRUST_PROXY stays 2; keep the window short). Also unproven: whether Render renews that certificate once the name is behind the edge. The old name's certificate dates from before 25 October and has not yet come up for renewal with the edge in front; watch both names' dates on that page.
- Check, once the name is added: `curl -s -H 'Host: watermark.world' https://watermark-3a4z.onrender.com/healthz` answers the house's JSON. Unsure that this check is conclusive, since the certificate offered on that connection is for the onrender name.

**3. The certificate.** AWS console, the wrkfullerton account, region **US East (N. Virginia) us-east-1** → Certificate Manager → Request → public certificate. Names, all three on one certificate: `watermark.world`, `www.watermark.world`, `watermark.krafftco.com`. DNS validation.
- Why three: a distribution carries one certificate. The old name must stay on it, or the old address stops answering the moment the certificates are swapped and nothing is left to redirect.
- Validation: each name gets a CNAME. "Create records in Route 53" writes them where the zone is in the same account; otherwise copy each into its zone by hand. The old name's record goes in the `krafftco.com` zone.
- Check: the certificate's status is "Issued" and all three names show "Success". Do not go on until it is.

**4. The edge.** CloudFront → distribution `EUW7MFQLDRUTK` → General → Settings → Edit. Alternate domain names: add `watermark.world` and `www.watermark.world`, keeping `watermark.krafftco.com`. Custom SSL certificate: choose the new three-name certificate. Save, and wait for "Deployed".
- Nothing else at the edge changes. The Host header already reaches the house on every behaviour. The cache key of `/img/*` and `/static/*` (policy `watermark-pictures`) does not include the host and should not: the redirect is sent `no-store`, so the edge never keeps one, and a picture already at the edge is simply served under either name.
- Unsure: whether the default behaviour's origin request policy is still AllViewer or has since become AllViewerAndCloudFrontHeaders. Either passes the Host header; leave it as it is.
- Check: `curl -sI https://watermark.krafftco.com/healthz` still answers 200 (the old name survived the swap), and the General tab lists three alternate names.

**5. DNS.** Route 53 → `watermark.world` → Create record, four times: an **A** and an **AAAA** record for the bare name, each an Alias to the CloudFront distribution `d1wj8xafp4wtz7.cloudfront.net`; the same pair for `www`.
- Check: `curl -s https://watermark.world/healthz` answers `"ok":true` with the same `ver` as `curl -s https://watermark.krafftco.com/healthz`; `curl -sI https://watermark.world/` shows `via: … cloudfront`; the same for `www`. Open `https://watermark.world/wander` on a real phone. At this point the pages work at the new name but still call themselves by the old one (links in letters, the sitemap, the address drawn on a shared picture), and a passkey will not open there. That is right for this step.
- If it does not answer: nothing has changed for visitors. Fix it before going on.

**6. Tell the house.** Render → Environment, on three services, in this order: `watermark-scribe`, `watermark-worker`, then `watermark`:
- `BASE_URL` = `https://watermark.world`
- `OLD_HOSTS` = `none` (a word that matches no host: the old address keeps serving pages for now, so the new one can be tried first)

  Then, by itself and with no help needed from Will, the house registers the new name with Stripe for Apple Pay and Google Pay (`registerDomain`, about a minute after start) and sets the vault's upload permission for the new origin.
- Check: `curl -s https://watermark.world/sitemap.xml | head -c 400` names `watermark.world`. Sign in at the new address with the email code. Open a work and an album. On an iPhone, a work's price shows Apple Pay (if not, Stripe → Settings → Payments → Payment method domains → `watermark.world` → verify). Studio → Masters: add one picture (the vault's door from the new origin). A real phone, start to finish.
- GitHub → the repository → Settings → Secrets and variables → Actions → Variables → New: `HOUSE_URL` = `https://watermark.world`. The watch, the live walk and the promotion read it. Check: the next `watch` run is green.
- Back out: put `BASE_URL` back on all three and delete `HOUSE_URL`.

**7. The old address sends people on.** Render → `watermark` → Environment: `OLD_HOSTS` = `watermark.krafftco.com,www.watermark.world`. (The same value on the worker and the scribe keeps the three alike; only the website acts on it.)
- Check: `curl -sI 'https://watermark.krafftco.com/wander?at=x'` answers `308` with `location: https://watermark.world/wander?at=x`; `curl -sI https://www.watermark.world/` answers 308 to the bare name; an album link from an old letter opens the album; `curl -s https://watermark.krafftco.com/healthz` still answers 200 itself. A picture address on the old name may answer with the picture from the edge and no redirect; that is expected.
- Back out: `OLD_HOSTS` = `none`.

**8. Stripe.** Not urgent: the old webhook address keeps working, because a POST is never redirected.
- Stripe → Developers → Webhooks → the endpoint at `https://watermark.krafftco.com/stripe/webhook` → **edit its URL** to `https://watermark.world/stripe/webhook`. Do not add a second endpoint: a new endpoint has a new signing secret, and the house holds one (`STRIPE_WEBHOOK_SECRET`).
- Check: "Send test webhook" answers 200; after the next real sale the endpoint shows a 200 and the work is granted.
- Apple Pay: nothing to press if step 6's check passed. Unsure: any place in the Stripe dashboard that shows the business's website (public details, Connect branding) is not known to this repository; change it where you find it.

**9. Mail.** Letters keep going out, from the old sending domain with links to the new address, until this step. It can wait.
- The mail service is Resend, and it has verified only `watermark.krafftco.com`. Resend → Domains → Add `watermark.world` → put its records (DKIM, SPF, the return path) into the `watermark.world` zone → wait for "Verified".
- Then Render, on the web service and the worker: `MAIL_FROM` = `Watermark <house@watermark.world>`. If Resend refuses a sender, the house falls back to the old verified address by itself, so a mistake here delays nothing.
- `HOUSE_EMAIL` is where people write to the house and where the digest and the alarm go. Unsure: this repository does not record where `house@watermark.krafftco.com` is received. Set `HOUSE_EMAIL` to a new address only after a letter sent to it from outside has arrived; until then the house keeps printing the old one, which still works.
- Check: sign in with an email code at the new address; the letter's sender, its links and its foot name `watermark.world`.

**10. Google, and the names written elsewhere.**
- Search Console → Add property → Domain → `watermark.world` (a TXT record in the zone) → Sitemaps → `https://watermark.world/sitemap.xml`. Then, in the old property if one exists (unsure), Settings → Change of address → `watermark.world`. Check: the tool accepts the move (it looks for the redirect of step 7).
- The Krafft sites load `house.js` and `k.js` from the old address; the redirect serves them. When convenient, change those script addresses on krafftco.com and studios.krafftco.com to `https://watermark.world/house.js` and `/k.js`.
- The desk at fullerton.cloud: its `WATERMARK_BASE`. Instagram bios and printed cards: by hand; the old links keep working.
- The test house, when it has `LIVE_URL` = `https://watermark.world`, names the new address on its banner.
- `CLAUDE.md`, `README.md` and the agents' notes say where the house is live: a line each, after the move.

**What changes for people**

- Signed in at the old address, a person arrives at the new one signed out, because a browser keeps a sign-in per host. They are asked to sign in once, by email code; nothing is refused, and what they hold is as they left it. A basket kept in the browser at the old address starts empty at the new one.
- Passkeys were made for the old host and do not open the new one. The email code does; a new passkey can be added afterwards. This includes the Studio's.
- The Krafft house bar on krafftco.com and studios.krafftco.com can no longer tell that a visitor is signed in to Watermark (the browser sent the sign-in across `*.krafftco.com`; it will not send it to another site). The bar shows "Sign in" there; on Watermark itself it knows the visitor as before. The bar's links, the guest book and the K lead to the new address.
- A phone that has the app on its home screen, or has allowed notifications, did so at the old address. Unsure how each browser carries that across; expect to add the app again from the new address. Not verified on a device.
- The push command and the Lightroom plug-in already installed keep working against the old address. A newly downloaded push command names the new one. The plug-in's default (`lightroom/watermark.lrplugin/WatermarkAPI.lua`) still names the old address on purpose: it keeps its key under the house's address, so changing it signs every photographer's Lightroom out. A decision for another day.

**What is not rewritten**

- Papers already issued, licences and register entries name the old address in their text and are left as they are; the redirect keeps their links alive. New ones carry the new address.
- The two namespaces written inside files and credentials (`NS` in `src/address.js`) are names, not addresses, and never change.
- For counsel (Craig), before step 6: the terms say which address they cover, so their text, and with it their fingerprint, changes when `BASE_URL` does, with no change of version. Acceptances already recorded keep the fingerprint they were given.
- Open, and not solved here: the house's identity for credentials is `did:web:` followed by its host (`src/bridge.js`), so it changes with the address, and a credential issued under the old identity is checked against a document that now redirects. Whether that matters to anyone holding one is a question for the CTO session before step 7.

**If the test house moves later.** Not now. `watermark-next` would need its own name on its Render service, a certificate and (if it goes behind an edge) a distribution of its own, `BASE_URL` on `watermark-next` and `watermark-next-worker`, `LIVE_URL`, the test-mode webhook's address edited in Stripe, and the addresses in `load.yml` and `PLAYHOUSE_BASE`. Until then it stays at its onrender name and nothing here touches it.

## Next, in order

1. Display copies to the bucket behind the edge, then the website's disk off: zero-downtime deploys.
2. An outside uptime monitor (30-second checks, a text to Will).
3. The second cut of the queue: hand-pressed jobs (a document, a read-aloud) to the worker.
4. A second web instance behind the edge once the disk is gone.
