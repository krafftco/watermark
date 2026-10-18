# The bridge: Watermark and its partners

Draft, 18 October 2026. Written for a first conversation between Will Fullerton (Watermark) and Cole Davis (Switchchord); for Will to confirm before it is shared.

## The idea

Switchchord starts from the papers: contracts, splits, who owns and who administers a work, made checkable. Watermark starts from the work itself: held at the source, shown well, sold in a tap, and carrying its information wherever it goes. Each needs the other. A rights platform needs a place where works are seen, licensed and paid for; a house that sells rights needs to know, with certainty, what has already been agreed.

The bridge joins them on open standards only (W3C Decentralized Identifiers and Verifiable Credentials), so neither side runs the other's private software, and either could later join others. Nothing of a maker's flows to a partner until the maker turns it on.

## What Watermark offers a partner today

**Identity.** The house is `did:web:watermark.krafftco.com` (document at `/.well-known/did.json`, an Ed25519 key published as Multikey, the same key that signs the register). Each maker is `did:web:watermark.krafftco.com:m:<slug>`, listing the identities the maker has linked: their own DID (for example one issued by Switchchord), ISNI, IPI and site.

**Credentials anyone can check.** Every license is a W3C Verifiable Credential (`/c/<ref>/credential`, type `WatermarkLicense`, Data Integrity proof `eddsa-jcs-2022`): the work (accession, title, fingerprint, maker DID), the use, the rights, the term, the number, whether it may pass on, and the fingerprint of the agreement accepted. Every held work has a credential of authorship of record (`/w/<slug>/credential`). `POST /api/v1/credentials/verify` checks any credential from a did:web issuer. No person's name is ever in a credential; a company may be.

**A partner key.** The Studio issues each partner a key (shown once). With it:
- `GET /api/partner/v1`: the makers who have connected the partner.
- `GET /api/partner/v1/makers/<slug>/works`: a connected maker's catalogue, with shares (who shares in each work, and how much of the maker's side) and accepted claims.
- `POST /api/partner/v1/claims`: a rights claim about a work, as a signed credential plus a plain summary: `exclusive`, `administration`, `co-ownership`, `prior-license`, `release`, `other`; the party, the uses, the dates. The maker is told and accepts or declines. An accepted exclusive stops Watermark selling the uses it covers while it runs.
- Sale notices: each paid license of a connected maker's work is posted to the partner's webhook, signed (`x-watermark-signature: sha256=<HMAC>`), with the license credential and the price. Never a buyer's name or email.

**Shares and releases.** A maker records who shares in a work (a second shooter, an estate, a co-writer) and the releases that let it be shown. Shares are paid from the maker's side; the house's part is never touched. Releases stay private to the maker and the house.

## What Switchchord could bring

1. Its verified identities: a maker's Switchchord DID linked in Watermark, so one identity runs across both houses.
2. Its contract reading: a maker's existing agreements read and verified once, posted to Watermark as claims, so the house never sells what is already promised.
3. Its splits, agreed before release, posted as shares.
4. When Watermark opens to music, Switchchord as its rights layer: the papers there, the public, the sale and the payment here.

## What is still to settle (with counsel)

- How a claim from a partner binds Watermark and the maker, and who is liable if it is wrong.
- Payment of shares to collaborators directly (needs Stripe Connect).
- Whether, and how, licenses and claims flow back into Switchchord's records of ownership and administration.
- Commercial terms between the two houses.
