# security-watch (The House)
**Purpose.** No surprise from a dependency, a leaked key or an open door.
**When.** Monday.
**Do.** From a fresh clone of `next`: `npm audit --omit=dev` (high and critical only); search the last week's commits and open issues for anything shaped like a key or a password (report where, never the value); read the week's merged pull requests against `docs/SECURITY.md` for a new route that signs someone in, takes a file, or spends money without its test.
**Leave.** One issue per finding (`lane:stability`), most serious first; or "Nothing this week" on the standing issue "Security watch".
**Never.** Print a secret, rotate one, or change a dependency itself (that is a `stability` job).
