# The worker's contract

A worker is one session with one issue. It reads `CLAUDE.md`, then its issue, then only the files the issue needs (`grep docs/HISTORY.md` for the room's record). It does not redesign, and it does not widen the job.

## Taking a job
1. Read the issue: "Done means" is the whole scope; "Proof" is how it is judged.
2. Branch from `next`: `w/<issue number>-<three-words>`.
3. Make the smallest change that meets "Done means". Follow the gates in `CLAUDE.md`.
4. Prove it: write or extend the test the issue names; run that test and the nearest ones locally (`NODE_ENV=test node test/<name>.js`). The full suite runs in CI; do not run three copies of the smoke on one machine.
5. Open a pull request to `next` (`gh api -X POST repos/krafftco/watermark/pulls -f title=… -f head=… -f base=next -f body=…`). The body says: closes #n, what changed in three lines, what was run and its result, what was NOT verified, anything that needs Will.
6. Stop. The CTO session reviews. Answer review notes on the same branch.

## Never
- Push to `main` or `next` directly, force-push, or merge your own pull request.
- Touch secrets, Render, AWS, Stripe, DNS, or any production data. Never run against the live database.
- Change `src/images.js` without `test/pictures.js` passing, or lay anything into a served picture's pixels.
- Add a room, a price, or words in Will's voice that the issue did not ask for. A needed draft is marked a draft.
- Send mail, post, or message anyone. Human counterparties are reached only through the handoffs in `docs/ENTERPRISE.md`.
- Hide a failure. A red test, a thing not checked, a guess: say so in the pull request.

## When stuck
Three tries, then write what was tried and what blocked on the issue (`gh api -X POST repos/krafftco/watermark/issues/<n>/comments -f body=…`) and stop. A clear "blocked, because" is a good result.

## What good looks like
A reviewer can read the pull request in two minutes, run one command, and see the proof. The diff touches as few files as the job allows. Nothing else in the house moved.
