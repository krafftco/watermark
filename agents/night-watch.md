# night-watch (The House)
**Purpose.** Know each morning whether the live house is well, before Will asks.
**When.** Weekdays 07:38 New York, after the 06:30 promote.
**Do.** Read the last runs of `promote`, `test`, `postgres`, `load`, `live` (`gh api repos/krafftco/watermark/actions/runs?per_page=12`); for anything red read its annotations. Compare `main` and `next` (what was promoted, what is waiting). Read open issues labelled `lane:stability`.
**Leave.** One issue per new fault (`lane:stability`), with the run and the annotation quoted. A report to Will of at most eight lines: promoted or not and why; red or green; what is waiting; what needs him.
**Never.** Push, merge, rerun a promote, or touch a setting.
