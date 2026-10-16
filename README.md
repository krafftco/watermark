# Watermark v0

Hold, show and license photographs at the source. A Krafft company.

Watermark v0 is the first working version of the licensing system described in the 2025 master draft. Krafft is its first customer, and the Krafft Studios collection is the seed.

## What it does

- **Vault.** A maker uploads a full-resolution photograph in the Studio. Watermark reads the camera, lens and time, fingerprints the original with SHA-256, and writes the registration to the ledger. Duplicates are refused. The original is never served publicly.
- **Show.** Every work gets its own page with a full-screen viewer: real zoom (to 8×), pan, pinch and keyboard. Only fixed screen sizes reach the browser (600, 1600 and 2400 px), each tagged "Held on Watermark".
- **Embed.** Two lines place a work on any site with its credit and license button attached: `<script src="BASE/embed.js" defer></script>` then `<watermark-image work="slug"></watermark-image>`. Every placement and every open is counted by site.
- **License.** One photograph, four uses, every price in plain sight: In a story, For a company, Before an audience, On a wall. Pick one, tap once, pay with Apple Pay, Google Pay or a card on Stripe Checkout. There is no form: Stripe collects the buyer's name and email. The moment payment clears, the buyer lands on "It's yours" with the full file, the certificate and a receipt by email, and the maker gets a "Sold" email. Anything bespoke (exclusivity, a longer term) goes to the maker in three fields.
- **Certificate.** Every license has a reference (WM-2026-000001), a plain-language certificate page, and a public verify page. When it is granted, the licensee gets a private link to the full file, valid for the term.
- **Ledger.** Every registration, request, quote, grant, decline and delivery is appended to a hash-chained ledger. Each entry carries the hash of the one before, so any edit to history shows as a broken chain at /ledger. No personal details are published.
- **Provenance.** The delivered JPEG carries its license: the maker, licensee, reference, term and the original's fingerprint are written into its EXIF without re-encoding the image (pixels are untouched). Every active license also has a PDF certificate at /c/REF.pdf.
- **Renewals.** Licenses end on their date and stop delivering the file. Thirty days before the end the licensee is offered a one-tap renewal; the Studio lists everything ending in the next 60 days.
- **Email.** With `RESEND_API_KEY` set, Watermark emails the maker on every request and the licensee on receipt, quote (with the payment link), grant (certificate and download) and renewal. Without it, everything works and the Studio shows what to send.
- **Studio.** Password sign-in. Overview (works, active licenses, requests, revenue, where the work was seen), Vault (upload, hide or show), Licenses (quote, grant, decline), Uses and prices.

- **The maker's say.** Each work has its own terms in the Studio: which uses are open, whether every license needs the maker's approval, what it may never be used for (AI training, political campaigns, alteration, sensitive categories), and whether credit is required. The terms are copied into each license at the moment of sale and written into its certificate, its PDF and the delivered file.
- **Protection.** Every public page and image carries `noai` and TDM-reservation signals; `/robots.txt` closes the site to known AI crawlers and keeps `/img` out of search indexes; `/.well-known/tdmrep.json` states the reservation. Anyone can report a sighting from a work page; the maker sees it under Sightings and decides: offer a license (pre-written email), mark it licensed, or let it be.
- **The life of a photograph.** `/w/:slug/life` is the public record of a work: registered, then every license by use and date (licensees unnamed). The maker can choose to show what it has earned. The Studio shows the full life with licensees, fees and sightings.
- **Sealed files (.wmk).** The maker can seal a full-resolution copy for a client, editor or printer. The file travels anywhere but opens only in the Watermark viewer (`/view`), which asks Watermark for the key each time. The maker sees every opening and can close the file at any moment. Design and independent-development record: `docs/SEALED.md`.
- **For makers.** The home page is written for image makers, with an application form; applications arrive in Studio → Makers.

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
- Email: create a Resend account, verify the sending domain (krafftco.com) and set `RESEND_API_KEY` and `MAIL_FROM`.

## Roadmap

1. Point krafftco.com/license and the Studios theme's license links at Watermark work pages.
2. Multiple makers: the schema already has makers; add sign-up and per-maker Stripe Connect payouts.
3. Provenance: add C2PA content credentials alongside the EXIF stamp.
4. Machines: an opt-in, licensed dataset export for AI companies on the maker's terms.
