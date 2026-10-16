# Watermark v0: handoff for any Claude session working here

Watermark is a Krafft company: hold, show, license and protect photographs at the source. Krafft Studios' collection (Will Fullerton) is the first maker. This folder is the working app, built in a cloud session on 16 Oct 2026; the git history lives there (commits up to c9fc719). Files here are synced copies.

## Run it
- `npm install`, then `ADMIN_PASSWORD=... npm start` → http://localhost:3000 (Studio at /studio).
- `npm test` → end-to-end smoke test; must print "all flows pass".
- `node scripts/seed.js <path to TRIP_OUT_EAST_EXPORTS/EUROPE>` loads the first ten originals.

## Map
- `src/app.js` routes; `src/views.js` public pages; `src/studio-views.js` Studio; `src/rules.js` the maker's per-work terms; `src/seal.js` sealed .wmk format; `src/provenance.js` EXIF stamp + PDF certificate; `src/ledger.js` hash-chained ledger; `src/mail.js` Resend email; `public/seal-viewer.js` browser viewer for .wmk.
- Flows: one-tap license (/license/:slug → /buy → Stripe Checkout → webhook/thanks grants, emails file + certificate, maker gets "Sold"); ask-the-maker requests; renewals and expiry; sightings; maker applications; public life page /w/:slug/life; sealed files (Studio seals → /k/:id key desk → /view).
- Design record for the sealed format: `docs/SEALED.md`.

## Rules (from Will)
- Restrained, precise voice; no hype. Anything written in Will's voice is a draft until he confirms.
- Draft prices: In a story $350, For a company $750, Before an audience $2,500, On a wall $250. "85% to the maker" on the home page is a draft.
- Never paste secrets (Stripe keys, passwords) into chat or code; they go in the host's environment settings.
- Sealed format: built only from public standards. Do NOT open, read or reuse anything from C-Hear / CHIF materials (00-INBOX/…/17-C-Hear). Will signed an NDA with C-Hear in May 2022 that bars use and reverse engineering.
- Do not publish photographs with identifiable people without consent.
- Deleting files in Will's folders isn't permitted from the cloud session; leftovers go to `_to_delete`.

## Next
1. Deploy: private GitHub repo → Render Blueprint (render.yaml) → BASE_URL https://watermark.krafftco.com, ADMIN_PASSWORD, SESSION_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET → DNS CNAME.
2. Stripe test mode end to end; then Resend for email.
3. Load the full Krafft Studios collection; point krafftco.com/license at Watermark.
4. Sealed files bound to a recipient's email; seal licensed deliveries so they close at term end.
5. Transfers of rights (chain of title on the life page); counsel first on assignment formalities and securities questions.
