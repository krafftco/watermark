# The vault

Watermark holds other people's life's work, so the storage is built like a vault, not a folder.

## What lives where

| Thing | Where | Why |
|---|---|---|
| Originals (full resolution) | S3 bucket, `originals/` | Durable (S3 is designed for 99.999999999% durability), encrypted at rest, never public |
| Sealed files (.wmk) | S3 bucket, `seals/` | Re-downloadable from any server |
| Database backups | S3 bucket, `backups/db/` | A consistent SQLite copy every 6 hours and on demand from the Studio |
| Database (live) | Server disk | Fast; restorable from the vault with `scripts/restore.js` |
| Display sizes (600 / 1600 / 2400 px) | Server disk cache | Rebuilt from the original on demand |

Lose the server and nothing is lost: a new server restores the latest database backup and pulls each original from the vault the first time it is needed.

## The rules the vault enforces

1. **Private.** Block Public Access is on for the whole bucket. No file in it has a public link. Originals reach a buyer only through a license, stamped with its terms.
2. **Encrypted.** Every object is encrypted at rest (SSE-S3, AES-256; the app requests it on every write). Optional upgrade: SSE-KMS with a key Krafft controls.
3. **Write, never erase.** The app's credentials can put, get and list. They cannot delete. With versioning on, an overwrite keeps the earlier version. A stolen server key cannot destroy the collection.
4. **Locked.** Object Lock is switched on when the bucket is created (it can only be enabled then), so retention can be applied to originals and backups later without moving anything.
5. **Every access accounted for.** CloudTrail data events (optional) record each read and write of the vault, alongside Watermark's own ledger.

## Setting it up (AWS, about 15 minutes)

1. **Bucket.** S3 → Create bucket → name `krafft-watermark-vault` (names are global; add a suffix if taken), region `us-east-1`. Keep **Block all public access** on. **Bucket Versioning: Enable.** **Default encryption: SSE-S3.** Advanced → **Object Lock: Enable**. Create.
2. **Lifecycle (backups).** Bucket → Management → Create lifecycle rule `expire-old-backups`, prefix `backups/db/`, expire current versions after 90 days and noncurrent versions after 30.
3. **A user for the app.** IAM → Users → Create user `watermark-app` (no console access). Attach this inline policy, with the bucket name filled in:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ReadWriteNoDelete", "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::krafft-watermark-vault/*" },
    { "Sid": "List", "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::krafft-watermark-vault" }
  ]
}
```

4. **Keys.** That user → Security credentials → Create access key (application running outside AWS). Put the two values **directly into Render** (never into chat or the code): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Also set `S3_BUCKET=krafft-watermark-vault` and `AWS_REGION=us-east-1`.
5. **Root account.** Turn on multi-factor sign-in for the AWS root user and use a separate admin user day to day.

Cloudflare R2 works the same way (it speaks the S3 protocol, with no charge for downloads): set `S3_ENDPOINT` to the R2 endpoint and use an R2 API token with object read and write.

## Growing

- **Now:** one app server, SQLite on its disk, everything that matters in the vault. Comfortably handles a large collection and thousands of sales a day.
- **When there are many makers and traffic:** serve display sizes through a CDN (CloudFront or Cloudflare) in front of a `display/` prefix; move the database to managed Postgres so several app servers can run side by side; Stripe Connect for paying each maker directly.
- **Provenance at scale:** C2PA content credentials on delivered files; the ledger's latest hash published daily, so the record can be checked by anyone outside Watermark.
