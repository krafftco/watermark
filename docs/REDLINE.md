# The legal documents: what reads wrong or risky (a redline for Will and Craig)

21 November 2026, from #188 (Will: "remove all things that could get us in trouble, and make sure everything is at least
correct"). The documents are counsel's and fingerprinted (`src/legal.js`, `src/contract.js`): none of their text was
changed. Each line names the document and its section, quotes what it says, says why it may be wrong or risky, and
offers words to consider. The offered words are drafts. This is a list of what we built and what we are unsure of. It is
not legal advice, and the decision on every line is counsel's.

## The terms of the house (/terms)

1. **The register.** "Each entry is hashed into the one before and signed with the house key, so the record cannot be
   quietly changed."
   - "Hashed" is a word the house does not use in reading copy. "Cannot be quietly changed" is a claim of security: the
     house holds the key, and what stops the house itself rewriting the chain is the outside anchoring (`src/anchor.js`),
     which the terms do not mention.
   - To consider: "Each entry is bound to the one before it and signed with the house key, so a change to an earlier
     entry would show."
2. **Collecting and licensing.** "Numbered pieces may be given, traded in kind, or sent wallet to wallet through the
   house, which records the transfer and issues a fresh key."
   - "Wallet" reads as a crypto-currency term. The house's own word for where a collector keeps a piece is the gallery.
   - To consider: "sent from one gallery to another through the house, which records the transfer and issues fresh
     papers."
3. **The market, trades and gifts.** "Until the house says otherwise, each trade is settled by hand by the house and
   recorded … Nothing here is a security, a token or an investment."
   - A sale can now be paid by card through Stripe, and the house moves the piece and pays the holder and the maker at
     once (`src/market.js`, the Checkout path). So "settled by hand" may no longer be true.
   - "Token": counsel may want the word in a disclaimer on purpose. If not, consider "Nothing here is a security or an
     investment."
   - The royalty (10%), the house's fee (5%) and the holding time (365 days) are drafts in the code (`src/market.js`,
     `src/rules-of-trade.js`). The terms point to "the market page" for them, which matches the code today.
4. **Looking.** "The collection is open to everyone, always, without an account."
   - "Always" is a promise. The same terms say a work can be withdrawn, and the house is offered as it is.
5. **Looking.** "Every delivered file carries its papers inside it."
   - The code does this: XMP and Content Credentials are written into the file. But the country store (/promises, in
     Will's voice) says "The papers ride beside the picture, not on it." The two should say the same thing.
6. **The particulars.** The operating entity is still "to be set". Every page says "Watermark is a Krafft company."

## Privacy (/privacy)

7. **Cookies.** "The house sets its own cookies and no one else's: `wm_b`, `wm_m`, `wm_s`, `wm_v`, `wm_bk`, `wm_in`,
   `wm_via`, `wm_g`, `wm_trade`, `wm_hi` …"
   - **The list is short of what the house sets.** The code also sets:
     - `wm_tz`: the visitor's time zone, for the clock
     - `wm_zone`: the rooms chosen at the door
     - `wm_tap`: a one-tap card is ready
     - `wm_ch`: a sign-in in progress
     - `wm_room`: the balcony
     - `wm_d`: a named device
     - `wm_dvh`: a heart left without an account
     - `wm_gg`: the showings admitted to
     - `wm_ph`: a peephole reader
     - `wm_as`: the Studio acting as a maker
     - `wm_staff`: a museum's staff

     Each one's purpose is listed in `test/public.js` (COOKIES).
   - **`wm_trade`** belongs to the trade desk. #178 retires the trade; if it is retired, the cookie and its line should
     go.
   - **"No one else's."** The payment step loads Stripe's script from js.stripe.com (`public/pay.js`), and Stripe sets
     its own cookies on the house's pages when it runs. Until 1.89.3, every page also asked Google for its fonts, so
     Google received each visitor's address. That has stopped: the fonts are now the house's own. Consider naming
     Stripe's script and its cookies, at the payment step only.
8. **What we keep.** Server logs are "kept for a short period".
   - The house also keeps its own count of visits (`src/analytics.js`, the `hits` table and its daily rollups): each
     page seen, with a visitor code, the device, the browser and the country. Privacy does not describe it beyond
     "server logs", and how long it is kept should be checked against "a short period".
   - The country store and About (Will's voice) say "Nothing counts you." See the list in the pull request.
9. **Children.** "The house is for adults."
   - The house has a kids' corner (/kids, "For young eyes"), and `docs/CHILD-SAFETY.md` covers children in the work.
     Privacy should say how the kids' corner fits.

## The Maker Agreement (/legal/makers)

10. **Money.** "Of the price of every license and Collect, 85% is yours and 15% is the house's."
    - With the house's share paid by the collector (`FEE_SIDE=collector`, `src/fee.js`), the maker receives the whole
      price, and the house's share is added on top. The agreement says 85/15 either way.
    - What the live house is set to is in Render's settings, and only Will can see them.
11. **Money.** "The house pays you … on the first of each month for the month before, or on request."
    - The code pays every Friday (`src/payouts.js`): what has cleared, from $1 up, once `PAYOUTS=stripe` is set.
      /promises and the maker's pages say Friday. The agreement and the house disagree.
    - A Friday "pay" is a Stripe transfer to the maker's connected account. When the money reaches the bank follows
      Stripe's payout schedule for that account, and that is not stated anywhere.

## The Curator and Gallery Agreement, Prints and proofs, Claims

12. **Prints and proofs.** "Every print is checked by eye before it leaves" is a promise the code cannot show. It is
    true only if the print room does it.
13. Nothing else found in these documents that conflicts with the code. Not read for: tax, export, or the law of
    resale abroad (docs/COUNSEL.md).

## The license (`src/contract.js`)

14. No banned word was found in the license text. The certificate's PDF has a row headed "Ledger entry"
    (`src/provenance.js`, which is under another worker's open pull request). It should say "Register entry".
