# Where the house is exposed: a list for counsel

Prepared 12 November 2026 by the engineering session, for Will to send to Craig. This is not legal advice and makes no legal conclusions: it says what the house does, where that lives in the code, why it might matter, the question for counsel, and what the house does in the meantime. `docs/COUNSEL.md` holds the older packet of open questions; this list is ordered by what could hurt soonest.

Each item: **What we do** · **Where** · **Question** · **Meanwhile**.

## A. Read before more people arrive (this month)

1. **The agreements are all drafts.** Terms, Privacy, the Maker Agreement, the Curator and Gallery Agreement, Claims and notices, Prints and proofs are live, versioned and accepted at payment and at first publication, but none has been read by counsel. · `src/legal.js`, /legal, Studio → Agreements. · Are they enforceable as accepted (a tick, a button's wording, a line at Checkout)? What is missing? · Each page says it is a draft until marked reviewed.

2. **Copyright claims and the safe harbour.** The house hosts work uploaded by anyone (the open door, 29 Oct). A claims door exists on every work, with a good-faith statement; a work under claim is shown, not sold. No DMCA agent is registered with the Copyright Office. · `src/disputes.js`, /legal/claims. · Register the agent now? Is the notice-and-counter-notice flow and the repeat-infringer policy sufficient for §512? · The agent address is the house's email; registration is Will's to file.

3. **Accessibility.** A first WCAG 2.1 AA pass is live (skip link, focus, names, labels); known gaps remain (contrast in several rooms, a screen-reader pass over Wander and the pay sheet, no captions on recordings, no public statement). · Issues #3–#6. · What standard should the house state, and what should the statement say and not say? · Faults are tracked as issues and fixed in order.

4. **Privacy.** First-party analytics (no third parties, a daily-salted visitor hash, country at the edge), a record of how long a signed-in person stood before each work, email addresses, device records, voice notes, signatures on releases, addresses for prints. No cookie banner. No data-request or deletion flow beyond email. · `src/analytics.js`, `src/firsts.js`, `src/looking.js`, `src/devices.js`, `src/notebook.js`, /privacy. · Which state laws reach the house now (CCPA/CPRA thresholds, others)? Is a banner or a "do not sell/share" line needed? What must the deletion and access process be? Any exposure from visitors in the EU or UK? · Nothing is sold or shared; nothing of a person's looking is shown to anyone else.

5. **Children.** Accounts require "I am eighteen or older" (a tick, no check). A kids' corner exists with no accounts, prices or tracking. Uploads are read by an AI for a child with nudity or sexual content; such a work is quarantined unseen and the house mailed. No hash-matching service (PhotoDNA, Safer) and no NCMEC registration yet. · `src/safety.js`, `docs/CHILD-SAFETY.md`, /kids. · COPPA: is the kids' corner a "service directed to children"? What are the reporting duties (18 U.S.C. §2258A) and what must the house never do with a quarantined file? · Quarantined files are untouched and unviewed; the registration and a matching service are Will's to arrange.

6. **Money held for others.** The collector pays the house's Stripe account; the maker's side is owed and paid on Fridays by Connect transfer after a seven-day hold. Pocket balances (top-ups, curation earnings) are held too. Galleries take a cut of a represented maker's side. · `src/payouts.js`, `src/pocket.js`, `src/fee.js`, `src/galleries.js`. · Is the house holding client money in a way that needs a trust account, a money-transmitter analysis, or different Connect charge types (destination charges)? Refund and chargeback liability sits with the house: is that stated properly? · All movement is through Stripe; nothing is paid outside it except by hand, recorded.

7. **Sales tax.** The house sells digital licences ("Collect"), physical prints shipped in the US, books, subscriptions, and charges a buyer's premium on top of the maker's price. No tax is collected. · `src/fee.js`, `src/editions.js`, `src/bookshop.js`. · Where does the house have nexus, is it a marketplace facilitator, and how is the premium treated? · Volumes are small; the books (Zeni) get every event monthly.

## B. Read before these rooms are advertised

8. **Prints of public-domain works, and gifts to museums.** The house sells prints and board-mounted "pieces" of open-access museum photographs (CC0 or public domain), names the artist, says it is not connected with the museum, and records 10% of each print as a gift to the keeping museum or a cause the buyer names. · `src/editions.js` (open prints, the piece), `src/gifts.js`. · Confirm the basis (Bridgeman v. Corel; CC0 terms; each museum's open-access terms and trademark policies). Is naming a charity in a sale a commercial co-venture needing registration or the charity's consent? May the house say "a gift to the museum" before the museum agrees to take it? · A cause is listed only once it has said yes; gifts are recorded as owed and paid by hand.

9. **Artists under copyright shown in photographs.** A photograph of a painting by a living or recently dead artist may be uploaded; the house links the artist, closes licences on it, and by default still allows the $7 personal Collect. Companies may show their own collections with a tick. · `src/art.js` (`rights`, `blocks`, ART_STRICT), `src/companies.js`. · Is showing such a photograph defensible, and is the personal Collect on it a reproduction the house should not sell? Is the life-plus-70 and 1929/96-year logic right as coded? · ART_STRICT=1 closes the Collect too; it is off.

10. **People in pictures.** Street work and portraits may hang, be collected and printed without a release; a company's or campaign's use is blocked until a release is on file. Releases can be signed on a phone with a finger; the house keeps a PDF with an audit line. An AI reads whether a picture holds recognisable people or children; no face recognition is used. · `src/clearance.js`, `src/sign.js`. · Right of publicity by state (New York, Texas, California first): is selling a print or a Collect of a recognisable person "use for trade"? Are the release texts and the e-signature record sufficient (E-SIGN/UETA)? The rule for minors. · A person shown may ask for a picture to come down through the claims door.

11. **The house's share (the buyer's premium).** The maker's price is shown; the house's share is added on top and published at /share. · `src/fee.js`. · Is the display compliant with price-transparency and "junk fee" rules (FTC, California SB 478, New York)? Must the total be the first price shown everywhere? · The total is what every button and Checkout shows.

12. **Auction pages.** The house records a lot at an auction house by hand (facts and a link), using only its own or open photographs, with a line that it is not connected with the house. · `src/auction.js`. · Trademark and unfair-competition exposure in naming the houses and listing their sales; any issue showing estimates. · Not on the menus; nothing is fetched from their sites.

13. **Museum names and the Met demonstration.** Open-access works from the Met, the National Gallery, the Art Institute and Cleveland are shown under desks named for the museum or as a demonstration, with "not connected with" lines. · `src/iiif.js`, `src/look.js` (/met), `src/nga.js`. · Is the naming and the /met address acceptable use of their marks? · Pages say whose record it is and link to the museum.

14. **The marks.** "Watermark", "Wander" (the installed app's name), the wave, "The Keys" (after the family restaurant), "Al". · — · Clearance searches and filings; "Wander" in software is crowded. · No store listing yet.

15. **AI-written text.** Guides, studies and book jackets are written by an AI, labelled as such; translations are labelled; an AI grades and sorts a maker's own work at their request. · `src/closer.js`, `src/jacket.js`, `src/facing.js`, `src/aledit.js`. · Disclosure sufficiency; liability for a wrong statement about a living artist or a work; the terms of the AI provider. · Makers can correct, hide or rewrite; nothing identifies people.

## C. Read before these are turned on at all

16. **Originals, consignment and galleries.** Proposed, not built: galleries listing one-of-one works on consignment and selling through the house. · — · New York Arts and Cultural Affairs Law §12.01 (trust property), UCC consignment, who is the seller, insurance. · Not built.

17. **The private desk and the price book.** The house can introduce an owner and a buyer for a fee, and keeps an internal model of auction prices. · `src/privatedesk.js`, `src/pricebook.js`. · Art-dealer, broker and advisory lines; anti-money-laundering expectations for art market participants; appraisal claims. · Studio-only; no public offer.

18. **Resale of numbered pieces and the collector market.** Numbered Collects can be passed on and, when enabled, sold between collectors with a royalty to the maker. · `src/market.js`. · Is a numbered licence that changes hands for money a security or otherwise regulated? The licence text says non-transferable in places. · Settlement is off; trades are by hand.

19. **The registry.** Owners record physical works, provenance and papers; the house states it gives no guarantee of title. · `src/registry.js`. · Liability for a wrong or fraudulent record; defamation in provenance lines offered by the public. · Offered lines are reviewed by the house before they stand.

20. **Owners page.** /owners describes share classes of Krafft and says nothing is offered. · `src/owners.js`. · Is any of it a general solicitation? · Off the menus.

21. **The Club, events and the dinner.** Paid annual membership with an "under forty" attestation; hosted nights. · `src/season.js`. · Age-based membership and public-accommodation law; event liability and alcohol. · No night has been held through it.

22. **The Screening and Listening Rooms.** Public-domain films and recordings streamed from the Internet Archive; makers' own masters to members. · `src/screening.js`, `src/listening.js`. · The music on silent-film transfers; pre-1926 sound recordings; public performance. · One film is held back for its score; rooms are off the menus.

## D. Housekeeping the house should have regardless

- **Entities.** Money lands in Krafftco LLC's Stripe; the site says "Watermark, a Krafft company". Which entity contracts with makers and collectors, and is it in good standing?
- **Insurance.** Cyber, media liability, and coverage for prints in transit.
- **The Copyright Office bridge.** The house prepares group registrations for makers at cost: is that the practice of law, or a filing service needing its own terms?
- **Contractors.** Printers and hosts are paid through the house: 1099s and agreements.
- **Retention.** The vault locks masters for a year (governance mode) and replicates them; a deletion request or a takedown must be able to override. Is the stated policy right?

## What we would ask Craig to do first
A (1–7), in that order, then 8 and 10. Everything in C stays off until he has read it.
