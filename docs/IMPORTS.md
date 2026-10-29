# Imports: how the house takes in an archive

*29 October 2026. Will: "we never can mess up; someday we're going to be entrusted with big, big, big imports; this has to be seamless; we have to make this easy."*

## The promise

Never lose a file. Never block the person. Always tell the truth about where every file is.

Every import, by any road, ends in the same place: one import with its page and its receipt, every file fingerprinted where it started and checked where it landed, every file with an answer (held, already in the vault, or needs you, with why), and the maker told when it is done.

## What stands today (1.5.2)

| | |
|---|---|
| The proof | SHA-256 taken on the person's computer, checked against the bytes that land; a mismatch keeps nothing |
| Ask before sending | bytes the house already holds are never sent again, at any scale |
| Once, never twice | Send runs once; the same file on its way in is handed back, not sent again |
| Imports | one per batch, with its page (/account/imports/:id), its receipt (CSV), a notice and a letter at the end |
| Resumable | parts go straight to the vault, 8 MB each; a dropped connection picks up where it stopped |
| The second look | two files are called one picture only when they look alike pixel for pixel, never on the quick hash alone |
| The fire drill | every night, a real import with everything a real day throws at it, checked file by file (test/drill.js) |

## The four roads, by size

| Size | Road | Speed is set by | State |
|---|---|---|---|
| A day's shoot (to ~50 GB) | **The browser**: the vault page | the person's upload bandwidth | built |
| An archive on a drive (50 GB to a few TB) | **The Mac app**: a folder or a drive, sent overnight, unattended | the person's upload bandwidth, but nobody waits | next |
| An institution or an agency (TB to PB) | **Bucket to bucket**: they grant us read access to their bucket; the house copies inside the cloud | the cloud: hundreds of MB/s | half built (the inbox) |
| Anything over ~10 TB where the line is slow | **Ship the drive**: AWS Snowball into the vault's region | a courier: days | by letter |

Rule of thumb for the browser and the Mac app: hours ≈ GB ÷ (upload Mbps × 0.45). Will's Philadelphia, 12.4 GB at about 18 Mbps up: about 90 minutes. The same on fibre at 500 Mbps: about three minutes.

## The Mac app (the .dmg)

**What it is.** *Watermark for Mac*: a small window and a menu-bar mark. You point it at folders (a Lightroom export folder, a drive, a card) and it keeps them in the vault: new files are fingerprinted, asked about, sent in parts and verified exactly as the browser does, through the same doors, as one import per batch with the same receipt. It runs overnight, survives sleep, a closed lid and a dropped Wi-Fi, and never touches the source files.

**What it is not, at first.** Not a second Watermark. It sends; the house shows. The darkroom, Wander and the walls stay on the web.

**How it signs in.** The same door as the phone hand-off: the app shows a code and a QR; you approve it from the house in a browser where you are already signed in; the app holds a device key, listed in Your devices, and can be signed out from there.

**How it is built, in order.**

1. **The command line first (days):** `watermark push <folder>`, one file of Node with no dependencies, speaking the import protocol (imports, start with the fingerprint, parts, done, the receipt). It is the engine the app wraps, the tool a museum's engineer runs on a server, and what the drill can drive.
2. **The app (weeks):** Tauri (a Rust core with a web window; a 10 MB app, low memory, Mac and Windows from one code base) wrapping the same engine; folders watched with the OS's own file events; the queue kept on disk so a restart resumes.
3. **Lightroom Classic (after):** a publish service plug-in, so 'Publish to Watermark' sends the export straight in, and a re-edit sends the new master on top of the old record.

**Distribution.** A signed and notarised .dmg from watermark.krafftco.com/mac, updating itself (Sparkle). This needs an Apple Developer Program membership in Krafftco LLC's name (a D-U-N-S number, $99 a year) and a Developer ID certificate: Will's hands, and the first step, since enrolment takes a week or two.

## The phone app (Wander)

Today Wander is installable from the browser (a PWA). A store app is a native shell around the same pages (Capacitor), adding the photo library, share sheets and push that a store app does better. The question is money: Apple takes 15 to 30 percent of digital goods sold inside an app and requires its own purchase system, unless the rules for linking out to pay on the web apply. Version one would sell nothing inside the app: look, hat, bravo, save, and Collect opens the house on the web. Whether a store app may link out to pay, and in which countries, is to be checked against Apple's guidelines as they stand at submission, and with counsel, before anything is built around it.

## Next, in order

1. **S3 versioning and object lock on the vault bucket, and the mirror switched on** (Will's hand in AWS; the most important item for "never").
2. Apple Developer enrolment for Krafftco LLC (Will's hand; it gates the .dmg).
3. The command line, then the Mac app.
4. Bucket to bucket as a first-class door (an institution names its bucket and a prefix; the house copies, fingerprints, imports and reports, with the same receipt).
5. One decode per arrival (the bag check, the fingerprint and the second look read each master once).
