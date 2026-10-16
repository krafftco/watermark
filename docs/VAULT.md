# The vault

Watermark holds other people's life's work, so the storage is built like a vault, not a folder.

## What lives where

| Thing | Where | Why |
|---|---|---|
| Originals (full resolution) | S3 bucket, `originals/` | Durable (S3 is designed for 99.999999999% durability), sealed with Watermark's own key, never public |
| Sealed files (.wmk) | S3 bucket, `seals/` | Re-downloadable from any server |
| Database backups | S3 bucket, `backups/db/` | A consistent SQLite copy every 6 hours and on demand from the Studio |
| Database (live) | Server disk | Fast; restorable from the vault with `scripts/restore.js` |
| Display sizes (600 / 1600 / 2400 px) | Server disk cache | Rebuilt from the original on demand |

Lose the server and nothing is lost: a new server restores the latest database backup and pulls each original from the vault the first time it is needed.

## The rules the vault enforces

1. **Private.** Block Public Access is on for the whole bucket. No file in it has a public link. Originals reach a buyer only through a license, stamped with its terms.
2. **Sealed with Watermark's own key.** Before any original, sealed file or backup leaves the server, the app encrypts it with AES-256-GCM using `VAULT_KEY`. The storage provider holds only bytes it cannot read; S3's own encryption (SSE-S3) sits underneath as a second layer. On start, the app checks the key against a probe object in the vault and refuses to run with the wrong one, so nothing is ever written under a mistaken key.
   - Render generates `VAULT_KEY` on first deploy. **Copy it at once into two safe places** (a password manager and a printed copy in a safe). Without it the vault cannot be read by anyone, including Watermark.
   - Never change the key on a vault that already holds files.
3. **Write, never erase.** The app's credentials can put, get and list. They cannot delete. With versioning on, an overwrite keeps the earlier version. A stolen server key cannot destroy the collection.
4. **Locked.** Object Lock is switched on when the bucket is created (it can only be enabled then), so retention can be applied to originals and backups later without moving anything.
5. **Every access accounted for.** CloudTrail data events (optional) record each read and write of the vault, alongside Watermark's own ledger.

## Setting it up (AWS, about 15 minutes)

1. **Bucket.** S3 → Create bucket → name `watermark-vault-collection` (names are global; add a suffix if taken), region `us-east-1`. Keep **Block all public access** on. **Bucket Versioning: Enable.** **Default encryption: SSE-S3.** Advanced → **Object Lock: Enable**. Create.
2. **Lifecycle (backups).** Bucket → Management → Create lifecycle rule `expire-old-backups`, prefix `backups/db/`, expire current versions after 90 days and noncurrent versions after 30.
3. **A user for the app.** IAM → Users → Create user `watermark-app` (no console access). Attach this inline policy, with the bucket name filled in:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ReadWriteNoDelete", "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::watermark-vault-collection/*" },
    { "Sid": "List", "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::watermark-vault-collection" }
  ]
}
```

4. **Keys.** (`VAULT_KEY` is separate: Render generates it.) That user → Security credentials → Create access key (application running outside AWS). Put the two values **directly into Render** (never into chat or the code): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Also set `S3_BUCKET=watermark-vault-collection` and `AWS_REGION=us-east-1`.
5. **Root account.** Turn on multi-factor sign-in for the AWS root user and use a separate admin user day to day.

Cloudflare R2 works the same way (it speaks the S3 protocol, with no charge for downloads): set `S3_ENDPOINT` to the R2 endpoint and use an R2 API token with object read and write.

## Owning it

Built on open standards so Watermark can move to its own hardware without a rewrite: the app is a standard container; the vault speaks the S3 protocol (self-hosted MinIO or Ceph speak it too); the database is a portable file today and Postgres later. Next steps toward ownership, in order: a second copy of the vault at a different provider (Backblaze B2 or Cloudflare R2) and the masters on Krafft's NAS (three copies, two kinds of storage, one off-site); then colocated servers when the bills justify it.

## Growing

- **Now:** one app server, SQLite on its disk, everything that matters in the vault. Comfortably handles a large collection and thousands of sales a day.
- **When there are many makers and traffic:** serve display sizes through a CDN (CloudFront or Cloudflare) in front of a `display/` prefix; move the database to managed Postgres so several app servers can run side by side; Stripe Connect for paying each maker directly.
- **Provenance at scale:** C2PA content credentials on delivered files; the ledger's latest hash published daily, so the record can be checked by anyone outside Watermark.
