# The house, anywhere

Watermark runs whole on any machine that runs Docker: the web, the worker, Postgres 16 and an S3-compatible vault
(MinIO), from one file. This is the answer to "run it in our data center": the same image Render runs, with nothing
of Render in it.

    cp .env.example .env            # make SESSION_SECRET, VAULT_KEY and REGISTER_SEED with `openssl rand -hex 32`
    docker compose up -d --build
    open http://localhost:3000      # the house; /studio with ADMIN_PASSWORD; MinIO's console on :9001

What stays the house's: the register's signing key (REGISTER_SEED) and the vault's seal (VAULT_KEY). A partner running the
image holds the machine; the house holds the keys; the register it writes is signed by whoever holds the seed, and
`/ledger.json` publishes the public half, so a copy run elsewhere is a different house with its own book (see
/standard, the register protocol). To move a house: `pg_dump` the database, copy the bucket, carry the two keys.

In production put a TLS proxy in front (Caddy, nginx, a cloud edge), set BASE_URL to the public address and
TRUST_PROXY to the number of proxies, and point the vault at a real bucket if you have one (S3_BUCKET, S3_ENDPOINT,
AWS_REGION, the key pair). The worker runs every chore; the web serves people (docs/WORKER.md). Backups: nightly pg_dump
into the vault, a weekly restore drill (docs/SECURITY.md).

Not in the compose file: the edge (CloudFront), the lab (Prodigi), the desk (fullerton.cloud).
