# The packet for counsel

Watermark, a Krafft company. Prepared 19 October 2026 by the house for its counsel. Nothing in the app's agreements is legal advice; everything below is a draft written in plain words so that counsel corrects a complete set rather than drafting from nothing. Each document is versioned and fingerprinted (sha256 of its plain text); the version a person accepts is recorded with their acceptance (`acceptances` table; `terms.accepted` on the register, hidden). Plain-text copies for redlining: `/legal/<key>.txt` on the live site.

## The documents

| Key | Page | What it is | Accepted by | When |
|---|---|---|---|---|
| house | /terms | The terms of the house (platform terms of service) | collectors and licensees | at payment (Stripe Checkout's submit text names it; recorded on grant) |
| privacy | /privacy | Privacy policy | everyone | by use; linked at sign-in |
| makers | /legal/makers | The Maker Agreement (platform ↔ maker) | makers | at first publication (checkbox with the rights attestation) |
| curators | /legal/curators | The Curator and Gallery Agreement | curators, galleries | on sending a show to a maker (stated by the button) |
| claims | /legal/claims | Claims and notices (DMCA policy, consent claims) | — | — |
| prints | /legal/prints | Prints and proofs (physical goods) | buyers of prints | by order |
| contract | /contract/<slug>, /c/<ref>/contract | The Standard Content License (maker ↔ licensee), assembled per order | licensees | at payment; the accepted text's fingerprint is stored on the license (`licenses.rights.hash`) |

The Standard Content License is counsel's own 2021 draft; the notes on it are in `docs/CONTRACT.md` (four corrections, seven additions, six open questions) and at Studio → Contract.

## Questions, by document

### The entity and the parties
1. Which entity operates the house and contracts with everyone: Krafftco LLC (Texas) or Watermark Ventures, Inc. (Delaware, 2019; standing to confirm) or Watermark.com, Inc. (Delaware, 2022)? Every document's "particulars" waits on this. Related: the entity that receives Stripe funds, and whether Krafft is the Licensor for the Krafft Collection.
2. Governing law: the house's terms say New York; the 2021 Standard Content License says Texas and Dallas courts. Align.
3. Is the house the maker's **agent for payment** (as the Maker Agreement says), so that money held for makers is not the house's? Any money-transmission or escrow question in holding makers' and curators' balances (the "pocket") and paying out monthly?

### The terms of the house
4. Collect: a numbered, personal, non-commercial licence to a copy, transferable only through the house (gift, trade in kind, wallet-to-wallet send, the market). Is "a licence to a copy, kept in your name" the right characterisation, and does the no-token, dollars-only design keep numbered pieces clear of securities and consumer-financial law?
5. The market: hand-settled resale of numbered pieces with a royalty to the maker and a fee to the house. Securities question; consumer law on resale; the resale royalty (no US federal resale right; California's is unenforced). Automatic settlement via Stripe Connect waits on this.
6. Undo and refunds as drafted: a two-minute undo on Collect; seven days on working licences if undownloaded; subscriptions end at period end; made-to-order prints not returnable. Any consumer-law minimums (EU 14-day withdrawal and the digital-content exception; UK; California)?
7. Liability cap (twelve months' payments) and exclusions. The licence's own cap is $1,000 (`docs/CONTRACT.md` 8.2).
8. Click-through acceptance at Stripe Checkout (the submit text names the licence and the terms) and recorded acceptance: sufficient for ordinary orders; is a signature needed for exclusivity, merchandise, or anything above a threshold?
9. AI guides: the house writes a guide and a study per work with a model, labelled, correctable by the maker. Disclaimers adequate? Any right-of-publicity exposure if a guide describes a place with people (the prompt forbids identifying people).
10. The TDM / no-AI-training reservation (`X-Robots-Tag: noai`, `TDM-Reservation`, robots, Content Credentials "no AI training" assertion): enough to preserve the EU text-and-data-mining opt-out; anything to add for the US.

### Privacy
11. Controller identity and address; whether an EU/UK representative is needed before any EEA/UK traffic matters; California (CCPA thresholds not met today, but the policy promises the rights anyway).
12. "Your looking" (what a signed-in person stood before and for how long) is kept and shown only to them; makers see counts. Is the viewer-code cookie and this record adequately disclosed; any consent requirement for the cookie under ePrivacy for EEA visitors (the house sets only first-party functional cookies and no analytics).
13. Retention: seven years after the last licence for accounts (accounting); deletion keeps licence records against the number without a name. Confirm.
14. Processors listed: Stripe, Resend, Render, AWS (S3), Anthropic, OpenAI/ElevenLabs. DPAs to put in place; sub-processor list.

### The Maker Agreement
15. The licence a maker grants the house (hold, show screen copies, fingerprint, mark, license on the maker's terms, deliver, print for collectors, AI guide, show in curated shows). Non-exclusive, worldwide, for as long as the work is kept here; survival for licences already granted after the maker leaves. Confirm wording and survival.
16. The attestation on each publication (made it; holds rights; non-infringing; releases for identifiable people and property). Indemnity from the maker? The licence to licensees carries no releases statement and no indemnity (`docs/CONTRACT.md` §6); decide what the house offers licensees (Getty-style tiers or nothing).
17. The split (85/15, a draft) and whether Stripe's fee comes off the top. Collaborator shares and gallery shares paid from the maker's side on the maker's instruction.
18. Estates and institutions as makers (rights-holder of record, registrar logins, board reports, Alexandria open works under CC licences and public domain): any changes to the attestation or grant.
19. Keeping fees (a notice, never a block) and the promise to return originals in full.
20. Holds (the house may make a studio private while it looks at something). Reasonable-notice wording.

### The Curator and Gallery Agreement
21. The curation share (5% from the house's side) credited to a pocket and cashed out: any finder's-fee, agency or 1099 consequence for curators; the threshold for 1099-NEC.
22. Representation: a gallery's percentage of the maker's side, one gallery at a time, ended on notice; the gallery's standing in the Standard Content License; exclusivity. Confidentiality of kept-back work under keys.
23. Openings and reply cards: guest data held for the show only.

### Claims and notices
24. Register the DMCA agent (dmca.copyright.gov, $6) in the operating entity's name with the postal address; set it in the document. The procedure as drafted: pause-not-takedown on arrival, the maker's answer as counter-notification, decision within five working days, restoration 10–14 business days after a counter-notification unless a court order is sought, repeat-infringer policy (two upheld claims → held). Confirm it fits §512(c) and (g) safe-harbour conditions, or whether a strict take-down-on-notice is required to keep the harbour.
25. Consent claims (a person in a photograph): the same door, decided on the record. Right-of-publicity exposure by state (New York Civil Rights Law §§50–51; Texas; California Civil Code §3344); the attestation that makers hold releases.

### Prints and proofs
26. Physical goods: sales tax by state and nexus (the house prints in New York; the Mac and printer are there); whether to turn on Stripe Tax for goods; shipping damage and replacement; made-to-order non-returnable language and any state exceptions.
27. "No licence allows prints for sale": confirm the personal-licence print right (any number for own display) sits well with the Standard Content License's print clause.

### The Standard Content License (counsel's own)
28. See `docs/CONTRACT.md`: the four corrections, the seven additions (term, assembled uses, the never list, Content Credentials clause, exclusivity, the platform-hosting narrowing of 7.4), and the six questions (parties; 9.4 law; 8.2 cap; §6 releases and indemnity; 9.3 transfers carve-out for house-recorded transfers; acceptance by click-through).
29. Seats (named additional users inside the licensee, $50 each), download counts and the share-size copy with the right to share: confirm the licence language covers them.
30. Companies licensing by the page through `site.js` (Natora): the licence as granted to a company with no email and a fee set by the engagement; the credit and the number shown on their site; the 410 at term end. Any term to add for images served from the house's servers under licence.

### Intellectual property of the house
31. Trademarks: Watermark (wave logo, classes 42, 45), Krafft (35, 41, 42), Dallas Golf Club (25); the watermark.com domain question; the name "Watermark" is common and the house should expect pushback. Clearance search before filing.
32. The sealed format (`docs/SEALED.md`), the archival master (`docs/ARCHIVE.md`) and the bridge (`docs/PARTNERS.md`) are built from public standards only. The 2022 C-Hear NDA (May 2022) bars use of its materials and reverse engineering; the house's record of independent development is those three documents and the repository history. Confirm nothing further is needed.
33. The Watermark number (WM YYYY NNNN NNNN with check digits) and the house's marks on delivered files: nothing to register, but confirm the "look it up at" line and the EXIF/XMP copyright notice form.

## What the house has already built for this
- Every acceptance recorded with version, fingerprint, who, when, and the licence or show it came with; visible at Studio → Agreements, where each document is marked reviewed once counsel has read it (the page then drops its draft notice).
- The register: hash-chained, Ed25519-signed, public key at /ledger.json; private matters as hidden entries.
- Claims: the door on every work page, the packet for each claim (maker of record, arrival, fingerprint, Content Credentials, Copyright Office, fixity, holders), decisions recorded.
- Copyright Office group registration (GRPPH) prepared and tracked per work; U.S. Registered badge once numbered.
- Delivered files carry their papers (EXIF/XMP: maker, copyright, licence, number, the house's register) and an invisible mark that identifies the delivery.
- Mail: every letter of a sale carries the agreement, its fingerprint and how anyone can check the papers.

## For Will, before counsel reads this
- Decide the entity (task due 23 Oct) and the CPA's view on the split and sales tax.
- Register the DMCA agent.
- Say which of the draft numbers are confirmed: 85/15, the curator's 5%, the proof's $25, seats $50, the market's 10% royalty and 5% fee, Keeping's tiers.
