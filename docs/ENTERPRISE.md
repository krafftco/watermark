# How Watermark runs: people and agents

A draft for Will to amend. The aim: the work lives in the repository and its issues, not in a chat; any session can pick it up cold; people are asked only for what people must do, and asked well.

## Who does what
| Seat | Who | Holds |
|---|---|---|
| CEO | Will Fullerton | Direction, priorities, every word in his voice, prices, money, counsel, partners, production settings |
| CTO | A Claude session | The backlog, the gates, review and merge to `next`, the daily report, saying no |
| Workers | Claude sessions, one issue each | A pull request that meets its issue (`docs/WORKERS.md`) |
| Counsel | Craig Carpenter | Terms, the agreements, releases, the legal exposure list (`docs/COUNSEL.md`) |
| Books | Zeni | The month's files from Studio → The books |
| The house's people | Makers, collectors, curators, galleries, printers | Reached by the house's own letters and desks, never by an agent on its own |

## The lanes
Stability · Pictures · Onboarding · Accessibility and legal · Ops. Each is a label on the issues. One worker a lane at a time, so two workers never edit the same room.

## The rhythm
- **Each weekday morning (the morning run):** read CI, the watch, the live walk and the open issues; file what is wrong; three lines to Will: shipped, red, needs you.
- **06:30 New York, weekdays:** `next` is promoted to `main` when green and nothing is being shown.
- **Fridays:** the week's review with Will: what shipped (CHANGELOG), what broke (STABILITY), what is next (the issues), what he must decide.
- **Weekly:** the scale test and the dependency audit.

## Handoffs to people (the rule for every agent)
An agent never acts on a person outside the house by itself. It prepares, and a person sends.
- **To Will:** an issue tagged `needs:will` that says, in order: the decision or the press, where, what happens after, and what happens if he does nothing. One ask an issue.
- **To counsel:** a document, never a chat: what was built, where it is in the code, the exact question, what we do in the meantime. Will sends it.
- **To a maker, collector, gallery or museum:** a draft in the house's voice, marked a draft, with who it is for and why now. Will sends it, or approves the house's letter that does.
- **From people back in:** what a person decides is written on the issue in their words and dated, so the next session has it.

## What agents may do alone
Read anything in the repository; open issues and pull requests; run tests; merge to `next` (the CTO seat only) when the gates pass; promote at the window. Everything that spends money, changes production settings, signs, sends, deletes, or speaks for Will waits for Will.

## How we know it is working
- No change reaches `main` without an issue, a test and a review.
- The live walk is green after every promotion; a fault has its line in STABILITY the same day.
- Will's asks are few, clear, and answered in a tap.
- A fresh session, given only `CLAUDE.md` and an issue, opens a correct pull request.
