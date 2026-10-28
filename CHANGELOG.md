# What's new at the house

Watermark is a shipped product. Each release is named and dated here, in plain words; the house shows this page at /releases.
The version is the house's own: the first number changes when the house itself changes shape, the second when a room is
added or a promise made, the third for repairs. Nothing is announced that is not already running.

## 1.4 · The worker · 28 October 2026
- The live house moved onto Postgres (docs/MOVE.md), with the register's head the same before and after.
- `ROLE` (web | worker | all) splits the house into a process that serves people and one that runs its chores, from one image; the worker's heartbeat on /healthz and in the watch (docs/WORKER.md). Nothing changes until it is set.
- Closed for the moment: a read-only switch for a move or a restore (Studio → Launch).
- Backups run off the event loop; the Studio door answers again (the bag check's desk had shadowed it); founders.js makes the settings table it reads at mount.

## 1.3 · Two engines · 27 October 2026
- The house runs on Postgres when DATABASE_URL names a server, SQLite otherwise, with no room rewritten: the bridge (a worker thread the main thread waits on) and the dialect (SQLite's idiom into Postgres's, by rule), proven by every statement in the source prepared against a real Postgres and the whole suite passing on both.
- Backups and the restore drill on Postgres (pg_dump, a scratch-database restore, the register verified); `scripts/to-postgres.js` moves a house and proves the move; CI runs the suite on both engines.
- Launch checks the Stripe webhook for all six events the house listens for.

## 1.2.1 · The morning digest · 27 October 2026

One letter a day to the house: the week in numbers, what went wrong, how fast, the state of the keeping (vault, backups, fixity, conservation, mail), what needs the house. And an alarm, at most once an hour, only when something is wrong.

## 1.2 · Your devices · 27 October 2026

Every phone and computer signed in as you, on one page (Yours → Settings → Your devices). The house writes to you when a sign-in comes from a device it has not seen; you can sign one out, or everywhere at once, and only a fresh code to your email gets back in. A letter when a bank is connected, and when another address is given the keys to a studio.

- The house boots quietly: its own chores wait three minutes and take turns in a lane of their own; a book's pictures or a feed pressed by hand never wait behind them.
- Two AWS accounts, two scoped keys; no root keys; the cold page lives a minute, not a day.
- Carnegie whole: numbered chapters joined to their titles, the apparatus dropped, the binding's wave drawn complete.

## 1.1 · Editions of the house · 27 October 2026

A jewel is one book given everything. The shelf at the head of the Library; the mark on a book; plates brought by hand from Commons or any address; every chapter read aloud in the house voice into the Listening Room; an introduction in someone's own voice. The twelve on the Studio's desk, Franklin first.

- The gate green at last, and a push Render skips (`[skip render]`).
- The worker keeps only what fits; the page heals itself; the watch knows the cold page.

## 1.0 · The house opens · 27 October 2026

The first release. Built in twelve days (16–27 October 2026), 500 commits, and now run as a product: a development
room, a gate, a watch, a walk after every deploy, and the showing switch.

- **Wander.** The house's front door and its app: one work a screen, whole and true; two fingers to look closer; the
  shelf (a passage, a book, a record) among the pictures; the Keys and Yours a swipe to either side; it keeps going
  without a signal.
- **Watermark.** Under every picture the record: the number, the deed, the register, the Shield, the licence to use it.
  Collect for a few dollars; the maker is paid every Friday; the house's share is on top and published.
- **Read.** The reading room and the Library: 245 books of the public domain in the finest editions, bound by the house,
  with their pictures, facing translations, a commonplace book and a reading list.
- **Listen.** The Listening Room: the shellac and the open repertoire, a turntable that plays through the whole house.
- **Collect.** A collector's house: the gallery, the holder's room, prints and the proof, the cabinet, the papers, a
  tour in your own voice, guests of the house.
- **Make.** The vault, the Library module, the darkroom, the Writer's Desk, Draw, the album, releases signed on the
  spot, the clearance desk, the artists behind the work, the editions room, the press and the lab.
- **For museums.** One door for rights; a collection in from IIIF, the Met's API, OAI-PMH, CSV, Smithsonian Open
  Access, Wikimedia Commons, the Library of Congress, the Internet Archive, Standard Ebooks; audio guides as objects;
  a museum's own house.
- **The Keys.** The members' club: the benches, the balcony, the season, the Club, the Screening Room, the rooms by
  the clock, the host's chair.
- **The house itself.** The register, nightly sealed backups with a restore drill, the restoration room, the bag check,
  the Studio door, the audit, the governor, the edge.
