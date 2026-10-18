# The test house

Draft, 18 October 2026. A second copy of Watermark for trying every flow before it reaches the public: collecting,
licensing, the basket, the pocket, the market, sign-in, the letters, curators, the frame. Same code, its own
database and disk, test money only.

## What the code does when `STAGING=1`

- A band on every page: "The test house. Nothing here is real and no money moves."
- Never indexed: robots.txt disallows everything; every page says noindex.
- Never takes real money: a live Stripe key is refused at start (logged as `[staging]`); use the Stripe test keys.
- Mails only testers: `MAIL_ALLOW` is a comma list of addresses or domains (`will@krafftco.com, @krafftco.com`);
  anything else is held back and logged. Subjects begin "[Test house]".

## Will's steps (about fifteen minutes; Render bills a second small service and disk)

1. Render → New → Web Service → the same repository, branch `main` (or a `staging` branch if you want to try
   changes before the public sees them), runtime Docker, plan Starter, a 1 GB disk at `/data`.
2. Environment, in Render only (never in chat or code):
   - `STAGING` = `1`
   - `BASE_URL` = `https://test.watermark.krafftco.com` (or the onrender.com address Render gives)
   - `ADMIN_PASSWORD` (a different one from the live house), `SESSION_SECRET`, `VAULT_KEY` (Render can generate)
   - `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`: the **test** keys from Stripe (Developers → API keys, test mode)
   - `STRIPE_WEBHOOK_SECRET`: from a test-mode webhook endpoint at `<BASE_URL>/stripe/webhook`
   - `RESEND_API_KEY`, `MAIL_FROM` as on the live house; `MAIL_ALLOW` = the testers
   - `ANTHROPIC_API_KEY` optional (guides cost credits; leave it off unless testing guides)
3. DNS (optional): a CNAME `test.watermark` → the Render address.
4. Photographs: sign in to the test Studio and add a dozen from Studio → Add photographs, or let the Studios sync
   bring in the stories' photographs on its own.
5. Pay with Stripe's test cards (4242 4242 4242 4242, any future date, any CVC). Nothing is charged.

## How to use it

- Every change can go to the test house first: push to `staging`, try it there, then merge to `main`.
- Testers get the test address and their sign-in; what they find goes to /feedback, read at Studio → Feedback.
