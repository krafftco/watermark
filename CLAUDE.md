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
- Krafft integration (one place, served by Watermark): `public/house.js` (house bar on every site; also joins krafftco.com/license and /watermark to Watermark) and `public/k.js` (the K seal on every Krafft Studios photograph, loaded in Ghost's Code injection; matched via `/api/k` and `/api/match` from `studios_imports`). Patronage: `src/patronage.js` (/m/:slug). Series: `src/series.js`.
- The Watermark Shield: `src/credentials.js` reads Content Credentials (C2PA) on arrival and signs every delivered file (maker, copyright holder, license, no AI training; original kept as parent ingredient). Signing needs C2PA_CERT + C2PA_KEY in Render (a certificate from a CA on the C2PA trust list); without them files go out unsigned. Shield panel: `shieldBlock` in views.js (work page, life page); shield drawn on the license PDF. Test: `test/credentials.js`.
- Tips: `src/tips.js` (/tip/:post). Every Studios story carries credits (words from Ghost's author, photographs from Watermark; narration, film, music can be added in the `credits` table); a tip is shared evenly or sent to one person. Writers are maker records of kind 'writer'. The K's end band on each story shows the credits and a Tip button. Money lands in Krafft's Stripe and is recorded per person; direct payouts need Stripe Connect.
- The market: `src/market.js` (/market, /market/:id, /studio/market). Collectors offer numbered limited-edition pieces from Yours; buyers ask to buy (no charge); the Studio settles each trade by hand and records it (price, 10% royalty to the maker, 5% fee, drafts), and the buyer takes the piece through a claim link. Work price = last trade, else issue price; /yours shows the collection's value. Automatic settlement needs counsel + Stripe Connect; the licence terms say non-transferable and need revising with counsel.
- Reference: a photograph at 40 MP or more (Leica Q3 60, Hasselblad X2D 100) carries the Reference badge (`refTag` in views.js; on plates and the work page) and can be bought as 'Collect the Reference' (use key `reference`, draft $25), which delivers the full original. Ordinary Collect delivers the 2400px version. Studio → Editions proposes edition sizes for approval.
- U.S. Copyright Office bridge: `src/copyright.js` (/studio/copyright). No public filing API exists, so Watermark groups works the Office's way (GRPPH: up to 750 by one author published in one year; GRUPH unpublished; $55 each), exports the title list CSV and deposit ZIP, tracks filed (service request) and registered (VA number), and writes the number onto every work in the group: 'U.S. Registered' badge (`regTag`) on plates, the work page and the Shield.
- Look closer: `src/closer.js` (/closer/:slug; `closerBlock` in views.js; `public/closer.js` reads it aloud with the browser's voice). A guide written by Claude from each held photograph and its record, filled in the background (needs ANTHROPIC_API_KEY; model CLOSER_MODEL, default claude-sonnet-5-5). Always labelled as AI; never identifies people. The maker can correct and approve (labelled approved), hide, or rewrite. Test: `test/closer.js`.
- Titles are set in title case (`src/titles.js`) on arrival and once over what is held; the maker's wording is kept in `works.title_given`. Slugs don't change.
- The contract: `src/contract.js`. Counsel's 2021 Standard Content License Agreement, assembled per order from the rights paid for (the nine permitted uses of clause 2.1; Adapt it, More than one company, On merchandise, Exclusively; the maker's never list as restrictions). Each use carries a bundle; added uses +$150, extended rights priced or asked of the maker (drafts). Buyer chooses on /license (`rightsPanel`, `public/rights.js`), reads it live (/contract/:slug), keeps it (/c/:ref/contract). Stored on `licenses.rights`. Review notes for counsel: `docs/CONTRACT.md` and /studio/contract. Old pattern came from ARCHIVE_DEV/watermark-prod license-sections.
- Market settlement: `src/market.js`. With MARKET_SETTLEMENT=stripe (after counsel, with Connect on): Buy it now / pay an accepted offer via Checkout; the piece moves at once; `payouts` (collector share, photographer royalty; the house keeps its own) paid by Connect transfers once the owner adds a bank (/yours/payouts); a second payment for a sold piece is refunded. Webhook events used: checkout.session.completed, checkout.session.expired, account.updated. Off = brokered by hand as before.
- The licence page (/c/:ref, `certificate` in views.js): a receipt in plain words: what you can and can't do (from the contract), term bar, certificate of authenticity with the maker's signature, acceptance at payment, Licensing simply. Hashes only under "How we know it's genuine". Never say blockchain; the ledger is called the register in public copy (URL /ledger stays). Checkout states acceptance of the agreement; the accepted text's fingerprint is stored in licenses.rights.hash.

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
