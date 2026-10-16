# The Watermark sealed image (.wmk)

Design record. First written 16 October 2026 by Will Fullerton with Claude, as part of Watermark v0.

## Independent development

Watermark's sealed image was designed and built independently, from public standards and public, general knowledge of how content protection works. It does not use, refer to or derive from any third party's confidential information, software, file formats or documentation, including materials received under any nondisclosure agreement. Nobody involved in this design opened or examined such materials while designing it. This record and the repository history (git) document the work as it was done.

Public foundations:
- AES-256-GCM authenticated encryption (NIST SP 800-38D), with the file's header as additional authenticated data.
- Envelope encryption: a random data key per file, stored only wrapped under a server key.
- The W3C Web Cryptography API (`crypto.subtle.decrypt`) to open the file in the browser.
- The general license-server pattern used across the industry: the content travels encrypted and a server decides, each time, whether to release the key.

## What it is

A single file that carries a photograph and its terms together:

| Part | Visible to anyone | Purpose |
|---|---|---|
| Magic `WMK1` | yes | Identifies the format and version |
| Header (JSON) | yes | Title, maker, credit, conditions, fingerprint of the original, seal id, access code, key-desk address, expiry, where to license it |
| Preview (JPEG, 600 px) | yes | What anyone sees before the maker's permission arrives |
| IV + ciphertext + tag | no | The photograph (2400 px or the full original), encrypted |

The header is bound to the ciphertext, so changing the credit, the terms or the address breaks the seal.

## How it opens

1. The viewer (`/view`) reads the header and shows the blurred preview, title, credit and conditions.
2. It asks Watermark's key desk (`POST /k/:id`) for the key, presenting the access code from the file. The viewer only ever asks its own Watermark, never an address written in a file.
3. Watermark checks that the seal exists, is open and has not expired; counts the opening (day and site); and releases the key, or explains why not and offers a license.
4. The viewer decrypts in memory and draws to a canvas for close viewing (zoom to 8×). No image file is created. Hiding the tab clears the canvas.

## What the maker controls

From the Studio, per work: seal a copy for someone (size, how long it stays open), download the `.wmk`, see how many times and when it was opened, and close or reopen it at any moment. Every seal, close and reopen is written to the ledger.

## What it does not do

It does not stop someone photographing their screen. No system can. Its value is control of the master file: a full-resolution photograph can travel without being given away, every opening is known, and access can end when the maker says so.

## Next

- Bind a seal to a recipient (sign-in by email link) in addition to the access code.
- A native viewer for iPad and Mac, and a Quick Look preview that shows the cover and credit.
- Seal licensed deliveries, so a license's file closes itself when the term ends.
- Fold seals into the life of a photograph and, later, transfers of rights.
