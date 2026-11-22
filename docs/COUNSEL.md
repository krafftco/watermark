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

### What a collector holds, said in one statement (#176, `src/holds.js`)
Questions only. The house now says in one form, before paying, on the papers and at resale, what a collector holds, what they may do, what stays with the maker and what happens when it is passed on. Each clause restates the Standard Content License as assembled for the order or the terms of the house; where the two differ or are silent the clause was left out and the question is here. The wording is a draft for Will.
44. Printing a collected piece. The terms of the house say Collect is "to print for your own wall", Prints and proofs says "a personal licence (Collect, the Reference) lets you print the work for your own display, in any number", the holder's room offers "Print it", and the certificate's list says of the Reference "Print it large for your own walls". The license as assembled (2.1, personal) says only "on your own personal social media accounts and devices". The statement leaves printing out. Which governs, and should 2.1 say what the terms say? (Beside question 27.)
45. Passing on, on the certificate. The certificate's list said, for every license but a print, "You can't: pass the license to someone else", while 9.3 as assembled and the terms of the house let a numbered personal piece pass, whole, to one other person through the house. The list now follows the terms stored with the order (`licenses.rights.transferable`); a license made before that was stored is judged by its use, as `canTransfer` already did. Is that right for those older licenses, whose holders accepted a text that may not have carried the 9.3 wording?
46. "Yours", "owns", "holds". The house's pages say a collected piece "is yours", that a collector "owns this print", and the terms say a numbered piece is "a license to a copy of a work, kept in your name". The statement says "You hold a numbered, personal copy of this work, kept in your name and recorded on the register" (the public register never names a collector; the house's own records do). What may the house call what a collector has, and is "kept in your name and recorded on the register" accurate as said?
47. A print that is sold on. 2.1 for a print says the holder "may sell or give the print itself"; 9.3 lets the license pass only by a transfer recorded on the register. When the object is sold or given outside the house, what becomes of its record and its number, and do the house's royalty and holding time reach a print at all? (The market takes numbered pieces of a work's edition; a print edition's numbers are kept on the print order.) The statement says only that the print itself is the holder's to sell or to give.
48. The royalty, the fee and the holding time, told before paying. The statement now says, before a first Collect and on the market's offer page, that on the house's market 10% of the price goes to the maker and 5% to the house and that a piece is not offered there until 365 days after it was last sold (all drafts). The license does not state them, and the terms say only that the royalty and fee are "stated on the market page". Is the page enough, or must the agreement the buyer accepts carry them; and may they change for a piece already held? (Beside question 43.)
49. A print of an open work. The order for a print of a public-domain or CC0 work is assembled as the same license as any print: it names the desk that keeps the work as "Licensor", "the creator of the content", and says "No right to reproduce the Content is granted", while the page and the statement say the picture is in the public domain, free to everyone, and that no copyright is claimed here. Should a print of an open work carry the Standard Content License at all, and if not, what are its papers?

### A license written from the use chosen (#183, `src/contract.js`)
Question only. The Standard Content License can now carry a territory and a size of use (first drafts, listed in docs/CONTRACT.md as ADDED with their questions); it is still one agreement for every kind of order.
50. Three papers, or one license stretched? The same agreement is assembled today for a collected piece (a numbered, personal copy that may pass on), a print of a work (an object; 2.1 grants no right to reproduce), a print of an open work (question 49) and a working license (uses, a term, now a territory and a size). Should a collected piece, a print and a working license be three documents, each with its own grant, rather than one license whose clauses are switched on and off? (Beside questions 44 to 49.)

### The reply link, credit only, and a license the maker writes (#184, `src/requests.js`, `src/contract.js`)

51. Counsel's license text for deals the house did not arrange. A photographer may now write the Standard Content License on the house for a deal that began elsewhere (a comment, a message, an email): they answer the license page's questions, name a fee or none, and send the other side a link; the other side gives their name and address, ticks "I accept the license agreement" and presses Accept (or pays the named fee through the house, all of it the photographer's). May the house hand counsel's text to photographers for deals it did not arrange, and on what footing: is the house a party, a third-party beneficiary (9.6) or only the place where it was signed? Is a tick and a press enough acceptance here, and does the preamble ("By copying or downloading content … through the content licensing platform") need a sentence for this case? The house takes no share of such a fee; Will has not decided otherwise.
52. "A form, not advice." Every page that hands over the agreement now says: "The agreement is a standard form. The house does not give legal advice; for advice about your own case, ask a lawyer." Is that sentence right, and is it enough where the photographer, not the house, chose the terms?
53. Credit only. A photographer may price a use at nothing ("credit only"), grant a request for credit only, or write a license at no fee. Such an order replaces Section 3 with a first draft: "No fee is payable for the rights granted herein. As consideration in full for those rights, you shall credit Licensor by name with each use of the Content, wherever the use allows, in the form specified by Licensor or, where none is specified, as “Photograph by” followed by Licensor’s name. A use without that credit, where the use allows it, is not permitted by this Agreement." Is credit alone sufficient consideration, and does the last sentence make a missing credit a breach (7.2) rather than a use outside the license? Every other order keeps Section 3 as it was.

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
