# The archival master (.wmark)

Watermark's own file. The digital Met holds the object, not a picture of it: a `.wmark` is the original photograph exactly as the vault holds it, with its papers, in one container anyone can open and anyone can check.

## What is inside

A `.wmark` is a zip, **stored, never deflated**, so the original is byte-identical and any zip tool can slice it out.

| Entry | What it is |
|---|---|
| `original/<file>` | The master, byte for byte. A camera JPEG stays that JPEG; a TIFF stays a TIFF. |
| `manifest.json` | Accession, title (and the maker's wording), place, caption; maker and house; copyright holder, notice, U.S. Copyright Office line or registration number; the original's SHA-256, dHash, dimensions, bytes, camera, lens, date made, when the master arrived, Content Credentials seen on arrival; the last fixity check; the register's entries for the work (seq, time, type, hash, previous hash, signature); the house's public key and where the register is published. |
| `manifest.sig` | The house's Ed25519 signature, hex, over the bytes of `manifest.json`. |
| `register.json` | The same register entries as `/ledger.json` publishes them. |
| `certificate.pdf` | The certificate of deposit. |
| `README.txt` | How to verify without asking Watermark. |

Format tag: `wmark/1`. Media type on the wire: `application/vnd.watermark.archive+zip`.

## Verifying

Offline, with nothing but the file and the house's public key (in the manifest; also at `/ledger.json`):

1. `sha256(original/<file>)` must equal `manifest.original.sha256`.
2. `manifest.sig` must verify against the bytes of `manifest.json` with the house key.
3. Each register entry's hash is `sha256(seq|at|type|subject|data|prev_hash)`, and the entries chain.

Or drop the file on `/verify`. The house checks the same three things and a fourth: whether the vault holds that exact file today. An image file dropped there is matched to the vault byte for byte, or by its picture (dHash within 10 bits) as "a copy, not the original".

## Who may take it

The maker, the Studio, and whoever holds the Reference of the work (`/w/:slug/archive.wmark`). Each issue is recorded on the register (`archive.issued`).

## Conservation: fixity

Every original in the vault is re-hashed against the fingerprint taken on arrival, the least-recently-checked first, 25 at a time every six hours (`fixity` table). The Shield on the work page says "Fixity verified <date>". A failure is written to the register (`fixity.failed`, never shown publicly), mailed to the house, and listed at Studio → Conservation (`/studio/fixity`), where a check can be run by hand. A failing original is restored from the vault's earlier version (versioning is on; see VAULT.md) and checked again.

## What it is not

Not a sealed file: `.wmk` (SEALED.md) closes a delivery to one recipient; `.wmark` opens the object to anyone the house gives it to. Not a token: the register tracks the work in dollars and names.

## Kinds to come

The container does not care what the original is. A film master (a 4K ProRes, a DCP) or a recording would carry the same papers; `works.kind` already exists. Photographs first.
