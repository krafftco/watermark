# Security of the house

What stands, what is next, and the hands that hold the keys. Plain, so it can be read in a hurry.

## Standing (22 Oct 2026)
- Headers and a content security policy on every HTML response (guardrails.js); no framing; HSTS; strict referrers.
- Cross-site writes refused: every POST must come from the house's own origin (or the Krafft sites for the few shared endpoints); cookies are SameSite=Lax, HttpOnly, Secure.
- Rates on every public door (sign-in codes, the Studio door, uploads, notes, the market, verification, quotes).
- The bag check: every upload sniffed by its bytes, searched for cargo and decoded whole before it enters, by every door.
- The Studio door: two factors (email code + passkey), STUDIO_EMAILS names who may enter; every Studio action audited on the register (hidden).
- Secrets only in the host's environment; the vault sealed at rest (VAULT_KEY) before anything leaves the server; nightly sealed backups with a restore drill that fails on a tampered copy.
- The register signed (Ed25519); Stripe webhooks checked by signature; sign-in codes one-time, five tries, ten minutes.
- Nothing laid into the pixels of any picture; files traced by bytes, XMP and Content Credentials.
- /healthz says only up/down and counts to the street; the full report needs the Studio or HEALTH_KEY.
- /.well-known/security.txt points a researcher at the house.
- Zero npm vulnerabilities; the suite runs on every push (.github/workflows/test.yml).

## Will's hands
1. Render → the service → Settings → "Wait for CI to pass before deploy": on.
2. Rotate, this weekend, every key that has been near a screen this week: the S3 access key, STRIPE_SECRET_KEY and the webhook secret, RESEND_API_KEY, ANTHROPIC_API_KEY, SESSION_SECRET (signs everyone out once), ADMIN_PASSWORD (retire it: set STUDIO_EMAILS). New values go only into Render's environment.
3. Least privilege: the S3 key limited to the one bucket (Get/Put/Delete/List, GetBucketCORS/PutBucketCORS); a Stripe restricted key for the desk; Resend scoped to the sending domain.
   Done 27 Oct: two AWS accounts serve the house. The vault (bucket `watermark-vault-collection`) is in the watermarkventures account (687415847626): IAM user `watermark-vault`, inline policy `watermark-vault-s3` (Get/Put/Delete/List, GetBucketCors/PutBucketCors, multipart), its key in Render as AWS_ACCESS_KEY_ID/SECRET; that account's two old root keys were deleted and MFA was on. The edge (CloudFront EUW7MFQLDRUTK) is in the wrkfullerton account (714560676112): IAM user `watermark-edge`, inline policy `watermark-edge-invalidate` (cloudfront:CreateInvalidation on that distribution only), its key in Render as CLOUDFRONT_ACCESS_KEY_ID/SECRET (src/edge.js). Never one key for both: a key from one account cannot read the other's bucket, and a deploy with the wrong pair dies at the vault's boot check (`Access Denied`, exit 1) while the running house keeps serving.
4. VAULT_KEY and REGISTER_SEED copied into the password manager. Losing VAULT_KEY is losing the vault.
5. Two-factor on Render, GitHub, AWS (root locked, no root access keys), Stripe, Resend; the repo private.
6. The mirror: S3_MIRROR_* at a second provider or region.
7. Cloudflare in front (DNS): DDoS, bot rules, a WAF, and the house's own page on a 502.
8. An uptime monitor on /healthz (ok and ledger) to the phone.

## Next in code
- Done 27 Oct (src/devices.js, 1.2): a letter on sign-in from a new device; /yours/devices with sign out one or everywhere (a session generation in the cookie's signature: buyers.sess, makers.sess, settings.studio_sess); letters when a bank is connected (account.updated) and when a studio's other addresses change.
- Done 27 Oct (src/digest.js, 1.2.1): the morning digest at DIGEST_HOUR (13 UTC) and the alarm (5xx over ALARM_5XX in an hour, a fault, the register failing, a stale backup, a lost original, mail failing; once an hour) to HOUSE_EMAIL; /studio/digest reads it, POST /studio/digest/send and /alarm send by hand.
- Done 27 Oct: SQLite is in WAL with busy_timeout 5 s and synchronous NORMAL (db.js); logs hold no PII by design (addresses are masked where they appear; the analytics never keep one). Log retention is Render's (seven days on the plan).
- Done 27 Oct: the threat model and the incident runbook below.


## The threat model (27 Oct 2026)

What the house holds that is worth taking, who would want it, and what stands in the way.

**The masters.** The original files, byte for byte, are the whole asset. They live in one S3 bucket in the watermarkventures account, sealed by VAULT_KEY before they leave the server, with a local cache on Render's disk. Threats: the bucket's key leaking (Render's environment, a laptop); a bug serving an original to a stranger; deletion by a mistaken chore. Standing: one IAM user with rights on that bucket only; the key never in the repo; originals served only through `originalPath` to the maker, the Studio and a Reference holder; `trimOriginals` never drops an unvaulted file; conservation never deletes; nightly sealed backups of the database beside them. Not yet: a second copy in another provider (the mirror is built, unset), object versioning or a deletion hold on the bucket (Will's, in the console), a rotation calendar for VAULT_KEY.

**The register.** The hash-chained, Ed25519-signed ledger is the house's word. Threats: a write to the table outside `ledger.append`; the signing seed leaking. Standing: `verify` on a schedule and at /ledger?check=full; the seed in the environment; the public key published. Not yet: an anchor of the head hash outside the house (a daily letter or a public post) so a rewritten chain is visible from outside.

**Money.** Stripe holds the cards; the house holds no card numbers. Threats: the restricted key in Render used to create transfers to the wrong account; a webhook forged. Standing: the webhook secret checked on every event; payouts go only to Connect accounts the maker opened themselves through Stripe's onboarding; Friday pay reads only cleared sales; the Studio's actions are audited. Not yet: a second person's eye on a payout above a line.

**The doors.** The Studio (two factors by email and passkey, STUDIO_EMAILS), a maker's studio and a collector's gallery (a six-digit code by mail or a passkey, signed cookies with a per-person generation), the API (read-only, public), partners (keys hashed at rest, webhooks HMAC-signed). Threats: a mailbox taken over (then the code is theirs); a cookie stolen from a device; a passkey on a shared machine. Standing: a letter on every new device; sign out everywhere; the Studio cookie's own generation; the audit of every Studio POST; rate limits on codes (five tries, ten minutes), on the public doors and on the API. Not yet: a hardware key for the Studio; a second email for a maker is itself a door (it is written about when it changes).

**The pictures on the walls.** Served copies are the house's own renditions; a copy taken from the wall is a stranger to the register. Threats: scraping (the API and /img are open by design); a copy passed off as licensed. Standing: nothing in the pixels (by policy); XMP and Content Credentials on every delivered file; the Watermark number on every licence; /verify. Accepted: anyone can right-click; the business is the papers, not the lock.

**Uploads.** Everything is read by its bytes at the door (the bag check); nothing is executed; files are kept under names the house makes. Standing: multer limits, the bag check, the decode on a copy; rate limits on the public doors.

**The box.** One Render service with a disk, behind CloudFront. Threats: a deploy that fails at boot; a chore that eats the memory; a dependency with a hole. Standing: the governor; CI with `npm audit` at high; the watch every ten minutes; the cold page; `CHORES=0`; the digest and the alarm. Not yet: Postgres and a worker (zero-downtime deploys, 2.0); a second origin.

**People.** Nothing of anyone's looking is told to anyone; the balcony keeps nothing; the analytics keep no address. The data the house keeps about a person: email, name if given, what they hold, what they stood before (to them only), devices (to them only).

## The incident runbook

Short, because the house should do most of it. The order is always: stop the harm, keep the evidence, tell the people, fix, write it down.

1. **The house is down or flapping.** Read /healthz at the origin (`up`, `faults`, `ver`). If `up` never grows, it is a crash loop: in Render, Rollback to the last good deploy (Events), or set `CHORES=0` and Manual Deploy. The edge shows the cold page meanwhile. Then read the deploy log for the first stack trace.
2. **A key may have leaked** (a laptop lost, a log pasted somewhere, a push with a secret). In this order: Stripe (roll the restricted key in the dashboard; the webhook secret too), the vault (make a new access key on `watermark-vault`, put it in Render, deploy, delete the old key), CloudFront (`watermark-edge`, the same), Resend, Anthropic, ElevenLabs, Prodigi, VAULT_KEY last and only with a plan (every sealed object must be re-sealed: not built; keep the old key until it is). Bump the Studio's generation (Sign out everywhere from a Studio session) and ask makers to do the same if their cookies could have been taken. Write it on the register as `house.incident` by hand (a Studio POST is audited).
3. **A wrong file went out** (an original to a stranger, a licence granted that should not have been). Keep the licence row and the download row (they are the evidence: who, when, which bytes); end the licence (`status='ended'`) so the file link dies; write to the holder; tell the maker. The file itself carries the number, so a copy that surfaces can be traced to this delivery.
4. **The register fails to verify.** Stop writing (set the showing on, which holds the chores; stop the Studio's desk work); take a backup by hand; find the first bad seq with /ledger?check=full; compare against the last good backup's chain (the restore drill does this); restore the database from the last good copy only if the bad entries are the house's own corruption and nothing real was recorded since; otherwise keep the live one and write the finding on the register.
5. **A claim or a takedown.** The disputes desk is the door; the work goes off sale on arrival by itself. Answer within the terms' time; the packet (deed, register entry, fingerprint, Content Credentials) is the house's side.
6. **Someone's account was taken.** Sign out everywhere for them from the Studio is not built; instead: bump `buyers.sess` / `makers.sess` by hand in the database (a one-line UPDATE), which voids every cookie; then write to the person's address of record with a fresh code path.
7. **After any of these**: a line in CHANGELOG under the repair, a line in this file if a standing measure changed, and the digest's next morning will carry the counts.
