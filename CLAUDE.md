# Watermark: the operating manual

Read this first. It is short on purpose. The dated record of how every room was built is `docs/HISTORY.md` (85,000 words): never read it whole; search it (`grep -n "<room or file name>" docs/HISTORY.md`) before touching a room.

Watermark is a Krafft company: a museum you can collect from. Makers keep their work here; anyone can own a piece of it. Live at watermark.krafftco.com. Will Fullerton is the CEO and decides. The CTO session (Claude) runs engineering and reports to him. Workers (other Claude sessions) take one issue each. How we work together: `docs/ENTERPRISE.md`. A worker's contract: `docs/WORKERS.md`.

## Rules from Will (never broken)
- Restrained, precise voice; no hype. Anything written in Will's voice, and every price, is a draft until he confirms.
- Never paste secrets (keys, passwords) into chat, code, issues or logs. They live in the host's environment settings, and only Will changes those.
- Sealed format: public standards only. Do NOT open, read or reuse anything from C-Hear / CHIF materials (00-INBOX/…/17-C-Hear). Will signed an NDA in May 2022.
- No face recognition, ever. Children get a look before hanging. Child safety: `docs/CHILD-SAFETY.md`.
- People in the work: street work and portraits may hang, be collected and printed without a release; a company's or a campaign's use waits for one (`src/clearance.js`). A maker may keep back any picture (`works.keep_back`).
- Never delete files in Will's folders; leftovers go to `_to_delete`.
- Never claim a museum's, an auction house's or a partner's endorsement. Nothing is fetched from an auction house's site. The price book and the private desk stay Studio-only.
- Never say blockchain; the ledger is "the register" in public copy.
- Legal questions go to counsel (Craig). We say what we built and what we are unsure of; we do not give legal advice.

## How change reaches the live house
1. Every job is a GitHub issue (`krafftco/watermark`) with "done means" and its proof. Lanes are labels: stability, pictures, onboarding, access-legal, ops. `needs:will` marks what ends with him.
2. Work happens on a branch, as a pull request to `next` (the test house, `watermark-next` on Render). CI must be green (`gh run list --limit 3`; a red `test` is a stop). CI's logs are read with `gh api repos/krafftco/watermark/check-runs/<job id>/annotations`. Use `gh api` (REST); GraphQL is closed to these sessions.
3. The CTO session reviews and merges to `next`.
4. `main` (the live house) moves only at the weekday 06:30 New York window (`promote.yml`), or as a hotfix on Will's word. Never while Studio → Launch says "being shown". A commit whose message carries `[skip render]` is not deployed (use it for docs and workflow changes).
5. After any push to `main`: watch `test`, then `live` (the walk through the edge). Say plainly what was and was not verified, and on what device.
6. Each fault gets its line in `docs/STABILITY.md` before its fix is promoted. Each release gets its lines in `CHANGELOG.md` and a version in `package.json` (second number for a room or a promise, third for repairs).

## The gates (a change that trips one does not ship)
- `npm test` (run as CI does, `NODE_ENV=test`; the smoke alone is `NODE_ENV=test node test/smoke.js test/fixture.jpg`, about fifteen minutes).
- Pictures: no change to `src/images.js` without `test/pictures.js` passing. Nothing is ever laid into the pixels of a served picture. The master is never re-encoded. Check zoom by the element's box, never its style.
- Wander: `docs/WANDER.md`'s ten sentences, proved by `scripts/wander-walk.js`.
- SQL: a new statement must pass `scripts/sql-check.js` (Postgres). Never `INSERT OR REPLACE`, an alias in HAVING, a bare integer as a boolean, or `SUM(a=b)`. Never `SELECT *` from `works` or `texts` for a list: name the columns and give it a LIMIT.
- Scale: nothing that walks the whole collection runs on the website; a visitor never waits on a master; no visitor path reads whole rows of the collection. `scripts/load.js` before promoting a change to app.js, images.js, stroll.js, the governor, the bridge or the vault.
- Classes: a new room's CSS prefix is checked against `public/style.css` first (`test/classes.js`).
- Rooms: a new public room goes into `DOORS` (views.js), a desk room into `ROOMS` (and `KEEP` if it stays on the quiet menu) the day it is built (`test/menus.js`). A route that opens a master, typesets or draws for a stranger goes into `DOORS` in `src/heavy.js`.
- People are never refused: no limiter on a download keys on the address, and no door a person can press answers a bare status.
- Money: no code path moves money without a test; the house never holds or mixes a maker's or a gallery's money outside Stripe.
- Bump `V` in `public/sw.js` when a script, style or the shell changes.

## Run it
- `npm install`, then `ADMIN_PASSWORD=... npm start` → http://localhost:3000 (Studio at /studio).
- A test house in process for a walk: see any `test/*.js` (`createApp({ dataDir, base, adminPassword: 'pw', secret, noTimers: true, vaultNow: true })`), Playwright is installed.
- Clear `/tmp/wm-*` when the shell's disk runs low; the tests leave their houses there.
- Local Postgres for the shell: `docs/HISTORY.md`, search "Two engines, one shape".

## The map
- `src/app.js` routes and the core (works, licences, grant, images route); `src/views.js` public pages, layout, `DOORS`, `ROOMS`; `src/studio-views.js`, `src/account-views.js` the desks.
- Looking: `src/stroll.js` + `public/stroll.js` (Wander), `src/look.js` (Discover), `src/find.js`, `src/walk.js`, `src/wall.js` (the wall standard), `src/art.js` + `src/artistpage.js` (the hall), `src/easel.js`.
- Pictures: `src/images.js` (copies), `src/copies.js` (tickets, scribes), `src/frick.js` (the standard), `src/conservation.js`, `src/bagcheck.js` (every upload), `src/storage.js` (the vault), `src/arrivals.js` + `src/imports.js` (uploads).
- Makers: `src/accounts.js`, `src/table.js` (the Library), `src/cull.js`, `src/hangbest.js`, `src/deliveries.js` (albums), `src/postit.js` (Instagram cards, the placard), `src/payouts.js` (Friday pay), `src/own.js`, `src/museums.js`.
- Collectors: `src/you.js`, `src/keep.js` (the holder's room, prints), `src/editions.js`, `src/printshops.js` + `src/lab.js` (the press), `src/fee.js` (the house's share).
- The record: `src/ledger.js` (the register), `src/registry.js`, `src/legal.js`, `src/disputes.js`, `src/copyright.js`.
- Running the house: `src/role.js` (web | worker | scribe), `src/governor.js`, `src/heavy.js`, `src/watchdog.js`, `src/pgsync.js` (the Postgres bridge), `src/backup.js`, `src/digest.js`, `src/analytics.js`, `src/spend.js` (the meter on AI calls).
- The house in production: Render services `watermark` (web, no disk: never add one), `watermark-worker`, `watermark-scribe`, `watermark-next` (the test house); Postgres; the vault in S3; CloudFront in front. Detail: `docs/OPERATIONS.md`, `docs/STABILITY.md`, `docs/SECURITY.md`.
- The standards: `docs/HOUSE.md` (what the house is), `docs/DESIGN.md`, `docs/PICTURES.md`, `docs/WANDER.md`, `docs/COUNSEL.md` (open questions for counsel).

## What only Will can do
Render and AWS settings, DNS, Stripe and bank, counsel, anything signed, a check on a real phone, and every word in his voice. When a job ends there, say exactly what to press and where, and tag the issue `needs:will`.

## The current order (12 Nov 2026)
New rooms are frozen for two weeks. The lanes tighten what exists: the photographer's first ten minutes, the pictures, stability at scale, accessibility. The house is quiet (`QUIET` in views.js): rooms not on the short menus are still reachable through Find and /everything.

Commit trailers for sessions: follow the attribution lines the session gives; never add others.
