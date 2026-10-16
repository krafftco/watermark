# Watermark v0

Hold, show and license photographs at the source. A Krafft company.

Watermark v0 is the first working version of the licensing system described in the 2025 master draft. Krafft is its first customer, and the Krafft Studios collection is the seed.

## What it does

- **Vault.** A maker uploads a full-resolution photograph in the Studio. Watermark reads the camera, lens and time, fingerprints the original with SHA-256, and writes the registration to the ledger. Duplicates are refused. The original is never served publicly.
- **Show.** Every work gets its own page with a full-screen viewer: real zoom (to 8×), pan, pinch and keyboard. Only fixed screen sizes reach the browser (600, 1600 and 2400 px), each tagged "Held on Watermark".
- **Embed.** Two lines place a work on any site with its credit and license button attached: `<script src="BASE/embed.js" defer></script>` then `<watermark-image work="slug"></watermark-image>`. Every placement and every open is counted by site.
- **License.** Editorial, Commercial, Campaign and A print to keep, each with a term. A use with a price goes straight to Stripe Checkout. A use without a price ("On request") becomes a request the maker quotes from the Studio; the quote produces a Stripe payment link.
- **Certificate.** Every license has a reference (WM-2026-000001), a plain-language certificate page, and a public verify page. When it is granted, the licensee gets a private link to the full file, valid for the term.
- **Ledger.** Every registration, request, quote, grant, decline and delivery is appended to a hash-chained ledger. Each entry carries the hash of the one before, so any edit to history shows as a broken chain at /ledger. No personal details are published.
- **Studio.** Password sign-in. Overview (works, active licenses, requests, revenue, where the work was seen), Vault (upload, hide or show), Licenses (quote, grant, decline), Uses and prices.

## Run it

```
npm install
cp .env.example .env   # set ADMIN_PASSWORD at least
ADMIN_PASSWORD=... npm start   # http://localhost:3000
npm test                       # end-to-end smoke test
node scripts/seed.js <folder>  # seed with the Krafft Studios originals
```

Storage is one SQLite file plus the originals folder, both under `DATA_DIR`. Back that folder up and you have everything.

## Deploy

The Dockerfile and `render.yaml` deploy to Render with a persistent disk at `/data`. Any host that runs a Docker container with a persistent volume works the same way: Fly.io, Railway, a small VPS.

1. Create the service and set `BASE_URL`, `ADMIN_PASSWORD` and `SESSION_SECRET`.
2. Point a domain at it (for example `watermark.krafftco.com`).
3. Stripe: add `STRIPE_SECRET_KEY` (test key first), create a webhook to `BASE_URL/stripe/webhook` for `checkout.session.completed`, and add its signing secret as `STRIPE_WEBHOOK_SECRET`. Without Stripe, every use works on request.
4. Sign in at `/studio` and upload, or run the seed script against the server's disk.

## Before taking real money

- The license terms at /terms are a plain-language draft. Have counsel review them.
- Decide which entity receives payments (Watermark Ventures Inc. or Krafftco LLC) and connect that entity's Stripe account.
- Email: v0 does not send email. The Studio shows requests and payment links; Will sends them. Add a mail provider (Postmark or Resend) next.

## Roadmap

1. Email notifications (request received, payment link, license granted, renewal due).
2. Point krafftco.com/license and the Studios theme's license links at Watermark work pages.
3. Multiple makers: the schema already has makers; add sign-up and per-maker Stripe Connect payouts.
4. Provenance: embed the license reference and fingerprint in the delivered file's metadata; add C2PA content credentials.
5. Renewals: a reminder 30 days before a license ends and one-tap renewal.
6. Machines: an opt-in, licensed dataset export for AI companies on the maker's terms.
