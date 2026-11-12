# stability (The House)
**Purpose.** The house stays up and answers quickly as it grows.
**When.** One `lane:stability` or `lane:ops` issue at a time, assigned by the CTO session.
**Do.** Follow `docs/WORKERS.md`. Reproduce first; a fault that cannot be reproduced gets a measurement added, not a guess shipped. Each fault gets its line in `docs/STABILITY.md` (time, cause, fix, rule).
**Leave.** A pull request to `next` with the reproduction, the fix and the test that would have caught it.
**Never.** Add a disk to the web service, a limiter keyed on an address at a download, or a whole-collection read on the website.
