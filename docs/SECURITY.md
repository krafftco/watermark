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
- SQLite in WAL on the disk; log retention; no PII in logs (none today by design).
- A threat model and an incident runbook in this file.
