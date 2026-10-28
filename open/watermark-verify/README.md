# watermark-verify

Check a Watermark work without asking Watermark. No dependencies; Node 18 or later; MIT.

    npx watermark-verify photograph.jpg          the papers inside: fingerprint, number, licence, maker
    npx watermark-verify ledger.json             the register: each entry linked and signed
    npx watermark-verify register-4384.ots <head> the anchor: is this head in Bitcoin, and in which block
    npx watermark-verify archive.wmark           the archival master: the original matches its papers, the papers are signed

Each answers JSON and exits 0 when everything holds. The standard is at https://watermark.krafftco.com/standard.

Built only from public standards: SHA-256, Ed25519, XMP, EXIF, OpenTimestamps, zip. The house key to check against is published at `/.well-known/did.json` and `/ledger.json`; take it from there, not from the file you are checking.
