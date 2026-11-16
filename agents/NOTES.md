# What the workers know

The enterprise's memory. A worker starts with nothing but the issue and these files, so what one worker learns the hard
way is written here for the next. **Read it before you start. Before you finish, add what the next worker should know**
(a line or two, under the right heading, in your pull request). Facts, not stories; delete a line when it stops being true.
The CTO session keeps it honest.

## This machine
- Start with `bash scripts/worker-setup.sh <issue> <name>` from /home/claude/watermark. Never work in that clone itself.
- `npm ci` fails building from source (nodejs.org headers are blocked). `npm ci --ignore-scripts` works and the native
  modules load. The setup script does this.
- Playwright cannot download its own browser. Tests that need one drive the machine's Chrome: copy how
  `test/a11y.js` and `scripts/reach-walk.js` find it. So nothing here proves Safari's engine: say so.
- Safari's engine runs only in CI: the `reach-webkit` job (#55) walks reach and the way back with `WM_ENGINE=webkit`
  (`scripts/engine.js`; iPad (gen 7), iPad Mini, iPhone 13 from Playwright's `devices`). Here `WM_ENGINE=webkit` prints
  one line and exits 0; in CI a missing WebKit fails. Its findings come back as annotations titled `… webkit`
  (`scripts/engine-findings.js`, ≤1500 chars each, 10 a level a step) and whole in the job's `webkit-findings` artifact.
- WebKit in CI (#55): the job takes ~13 min (reach ~10). Playwright's WebKit does not let `route()` stand in for requests
  that go through the house's service worker, and the worker claims the page at once: a test that stubs answers runs
  with `serviceWorkers: 'block'`. WebKit likely holds Wander in its arrival state (bar hidden, pointer-events none,
  `st-arr`) where Chrome does not (#60). Allow lines seen only in WebKit go in `ALLOW_WEBKIT`, apart from `ALLOW`.
- Locally `test/wayback.js` needs `CHROME=/usr/bin/google-chrome` (Playwright's pinned Chromium is not on this machine).
- A local Postgres for `scripts/sql-check.js` and the Postgres half of a test: /var/lib/wmpg, port 5433, started as
  docs/HISTORY.md says ("Two engines, one shape"). Stop it when you are done if no one else is on it.
- The shell cannot reach the live house or the test house (the network allow-list). A worker never sees live data.
  The CTO session can read live pages through a browser and will hand you what the real page holds: ask.
- Other workers share /tmp. Remove only folders your own runs made; never `rm -rf /tmp/wm-*`.
- The machine is rebuilt without warning: packages and worktrees can vanish between days. Push your branch early.

## GitHub and CI
- `gh api` (REST) only. Issues, comments, pulls: `gh api -X POST repos/krafftco/watermark/…`. Bodies from a file: `-F body=@file`.
- CI runs on pull requests, on `next` and on `main`. Its logs cannot be read; a failed job's reason is in
  `gh api repos/krafftco/watermark/check-runs/<job id>/annotations`. A job that fails must publish why as an annotation.
- Jobs: `test`, `postgres`, `load`, `a11y` (also runs `test/wayback.js`), `reach`. All must be green before `main` moves.
- `public/sw.js`'s `V` is bumped by almost every change, so it conflicts on merge almost every time. That is expected;
  the CTO session resolves it. Do not rebase to chase it.
- `[skip render]` in a commit message stops the host deploying THAT push. If such a commit is the newest one when `main`
  moves, the code beneath it is not deployed either. Use it only for a push that carries no code at all; when in doubt, leave it out.
- `main` and `next` must share history. A hotfix made on `main` is merged back into `next` the same hour, or the next
  promote fails (12 Nov).

## What has gone wrong, and the rule each left behind
- **A page that reads the whole collection takes the house down** (9 Nov; 13 Nov, the Studio's front page: 62,000 works,
  nine counts each, every visitor waiting behind it). The Studio's desks run on the same process as the visitors. Any list
  from `works` names its columns and has a LIMIT; a count is asked of the database, never made by reading rows; say what
  your page costs at a million works. The settings table's columns are `k` and `v`.
- **Built on an invented fixture, wrong on the real thing** (14 Nov, the Leonardo book: 27 chapters in the test, 11 on live).
  When your work reads real content (a book, a museum's records, a maker's files), ask the CTO session for the real
  page's skeleton BEFORE you write the parser, build the fixture from it, and say in the pull request what you never saw.
- **A person silently turned away** (12 Nov, the sign-up guard's first version: a stale form got a fake success and no
  museum). Only a trap for machines may fail silently. A person is always told, and always has a next press.
- **A door that signed in whoever typed an address** (12 Nov). No door signs a device in as an address it has not proved.
- **A dead end in the installed app** (15 Nov): no browser bar there. A file is never navigated to; every page has a Back.
- **Controls too small or under another on an iPad upright** (15 Nov). 701–900 px wide is a real screen. The `reach` job
  walks it; if you add a bar or a row of controls, run `node scripts/reach-walk.js` yourself.
- **A bigger target that moved the page** (15 Nov, #48). Enlarge a control with padding and a negative margin of the same size, but read every rule that already pads it first (`.st-plate a` had 3 px: the margin takes back only what you add); an inline-block (a slider in a label) sits on the text line by its margin box, so a symmetric margin can still grow the line. Compare boxes before and after, never by eye. A panel with `display:grid|flex` ignores its `hidden` attribute unless it has a `[hidden]{display:none}` rule.
- **A worker's `rm -rf /tmp/wm-*` broke another's test run** (12 Nov). See "This machine".
- **A test's last line is not its result.** Read the exit code; a stray line after teardown fooled a merge check (14 Nov).

## How work is judged
- The issue's "done means" is the contract; its Proof is run, not described. "Not verified" in your report is as
  important as "passes": name the engine, the device and the data you did not have.
- Every sentence a person will read is a draft for Will: list each in the pull request. Restrained, plain, no hype;
  never "first", "only", "complete"; never a museum's or a partner's name as endorsing.
- Fix what is certain and shared; file the rest as issues, one per cause. Do not widen your job.
- Changes on a visitor's path, to pictures, to sign-in or to money are read by the `reviewer` seat before they merge.
  Expect it to try the case you did not test.

## Rooms, by what trips people
- **The reader** (/read): a book is one page of many `section.rdr-ch`; `?c=` moves between them. Books of numbered notes
  go through `src/outline.js` (and `outline-n1.js` for one day's old places). `app.locals.bookNotes.note(slug, n)`.
  What the Leonardo book taught (four rounds, 13–16 Nov): in the body a numeral alone, then a line in CAPITALS, is a part;
  a numeral alone, then anything else (one word, a quotation mark, a title over three short lines), is a section when it is
  above the last and within the contents' count. Never require "exactly the next" or a title match: one miss hid the rest.
- **Volumes** (/volume, /studio/volumes): `works.vol_page` (NULL, 0 for the first page of an open volume, else the
  volume's id) decides what leaves the open walls; keep it, `volume_pages.pos` and `volumes.n` true together.
- **Wander** (/wander): docs/WANDER.md's ten sentences, `scripts/wander-walk.js`. Sets are keys (`maker:`, `album:`,
  `delivery:`, `collection`); a private album's pictures answer only to those inside.
- **The sign-up door** (POST /record): a signed time on the form, a trap field, ceilings on letters not on people.
- **Downloads**: `public/save.js` decides what a download press does in the installed app. The heavy doors may answer
  "wait your turn" as a page: a fetch must check what it received.
