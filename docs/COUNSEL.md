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
34. The agents' door (`docs/SECURITY.md`, #28): may the house's own scheduled AI seats read the words of what guests write to it (feedback, reports on a work, claims and notices), to sort them and draft replies a person sends? Does the privacy notice need to say so, and does a claim's text (which can carry a name) need different handling? Until counsel answers, the door carries no words (`AGENT_LETTERS` off). If they are turned on, emails, phone numbers, street addresses and US/UK postcodes are masked (best-effort; `docs/SECURITY.md`); names in the words are not. Is best-effort masking enough, or must a person read first?

### The sources (#170, `docs/SOURCES.md`)
Questions only; the terms quoted are in SOURCES.md with their links and the date read (20 Nov 2026).
35. Museums' CC0 pictures sold as prints and boards (`/pieces`, open prints) and offered as cropped screen backgrounds: the Met, the Art Institute, Cleveland and the Gallery say CC0 allows commercial use and forbid implying endorsement or using their marks. Is the house's use of their names on these pages (a source line, the credit they ask for, "From the collection of …") within that, and does a sale of a print of their photograph need any further words?
36. A desk under a museum's own name (`art-institute-of-chicago`, `cleveland-museum-of-art`, kind institution, with a bio saying the house is not connected with the museum): is a page titled with a museum's name, which the museum did not make, a use of its mark that its terms forbid ("You must not use The Cleveland Museum of Art's trademarks"; the Art Institute's logo and building)? Would "The Art Institute of Chicago's open access, as read by Watermark" be better, or should the desk not be public until the museum claims it?
37. The demonstration desk, "A museum desk (demonstration)", built on the Met's open access and shown to the Met: may it be shown to anyone else?
38. Project Gutenberg: their robot policy says the site is "for human users only" and names a mirror, a harvest endpoint and the catalogue as the ways for machines. The house has read texts from the site itself. What follows for the texts already shelved, and what must the house keep or remove of the Project Gutenberg name and licence when it shelves or prints an edition made from their transcription (their permission and licence pages could not be read from here)?
39. The house writes an invisible mark and its own metadata into files it delivers. For a museum's CC0 photograph taken free from the house (`/open/:slug/take`), the file now says the licence and the museum's credit (1.89.0). Is any mark or metadata of the house's in a CC0 file a problem when the museum's terms are silent, and is "no copyright is claimed here" the right form of words?
40. MoMA's dataset: "MoMA requests that you actively acknowledge and give attribution to MoMA wherever possible" and the data is "for research purposes". The house uses it for the hall, the Work Master and its registry. Is a product use within "research purposes", and where must MoMA be named?
41. The Library of Congress: "we generally do not own the rights to materials in our collections" and users are responsible for "privacy and publicity rights". What check must the house make per item before it shelves a book or a photograph from loc.gov, and before anything from it is sold?
42. The Internet Archive: each item's rights are the uploader's word. Is the uploader's licence field enough for the Listening and Screening Rooms (members only), and what is owed when it proves wrong?

### The market's own rules (#165, `docs/MARKET.md`)
43. The holding time. The house now refuses to put a numbered piece on its market until a set time after it was last sold (`MARKET_HOLD_DAYS`, a draft of 365 days, counted from its issue or its last trade; a gift neither starts nor stops it), and the Studio may lift it for one piece with a reason written on the register. May the house limit the resale of a licence it sold this way, and on the house's own market only (a piece can still be given or sent)? Does that hold for pieces sold before the rule, whose papers say nothing of it? What must the licence and the house's terms say, and where must the buyer be told before paying? Any consumer-law or competition question in a seller of the first sale limiting the second. Related: may the house keep a resale's price from the public (shown to the maker, the holder and the house only) while its register, which anyone can check, has carried each trade's price since the market opened (see the note in the pull request for #165)?

### A maker's working papers (#182, `src/papers.js`)
Questions only. The house now prints, for a signed-in maker, papers made from their own record: an inventory, a price list, a consignment sheet, a checklist and an exhibition history. Nothing on them is kept or sent by the house; what the maker types on a sheet is printed and gone.
50. The consignment sheet. It is a blank form: the works (from the record), the two parties, the dates, and empty lines for the share, when the artist is paid, who insures, who pays carriage, what happens to unsold work and anything else agreed; the house supplies no term and no number. It says: "This is a form, not legal advice, and Watermark is not a party to what you write on it. The terms are yours and the other person's. Have a lawyer read any agreement before you sign it." Should the house offer such a form at all? If so, is that notice enough, and does New York's Arts and Cultural Affairs Law §12.01 (or another state's consignment statute) oblige a form of this kind to say anything (trust property, the artist's proceeds), or make the house's offering it a risk (see docs/LEGAL-EXPOSURE.md, 16)?
51. "Non-transferable" on the printed certificate. The certificate PDF said every licence was "non-exclusive, non-transferable". It now says "non-transferable" only when the licence's own stored terms (9.3 as assembled) do not let it pass, the same rule #176 gave the certificate's page (question 45), and it carries the one statement of what the holder holds (`src/holds.js`). Is the PDF's grant sentence right for a numbered personal piece that may pass through the house, and should the PDF and the agreement say it in the same words?

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
