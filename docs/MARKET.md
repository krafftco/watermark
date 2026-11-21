# How the house treats an artist's market

20 November 2026. A draft for Will: nothing here is the house's word until he confirms it, and every rate and number
is a draft. Questions of law (resale rights abroad, tax, export, money between people) go to counsel (docs/COUNSEL.md).
Source for the trade's own rules: Will's notes, "Introduction to Art Business" (20 Nov).

## What the house is for

Will, 20 Nov: "We never want to be cheap. We want to be Frick, Met. Blue chip." "Watermark needs to be the place where
artists put their work and galleries find their work, curators, collectors, and they are able to go to buy it." "See
the work: it is on display here. It could be a gallery in Chelsea." "We want to create an international art market."
"The platform that everyone accepts."

So the house is three things, in this order:

1. **The place of record.** Every work shown as a museum would show it, with its edition, its history and its papers.
2. **The place it is found.** Gallerists, curators and collectors look here, because the work and its record are here.
3. **The way to it.** The page says where the object is on view and who sells it. When a gallery represents the work,
   the way to buy runs through the gallery. When no one does, it runs through the house.

The house is not a dealer and does not compete with one. It earns when a sale is made through it and when the trade
uses its record.

## What the house is measured on (a draft for Will, #176)

Three numbers, and no others: **works placed** (a work that has found its holder), **makers paid** (what reached them,
and how many of them), and **collectors who return** (who collects a second time, and a third). Never trading volume:
the house does not count, show or celebrate how much has changed hands, to the public or to itself as a goal. A resale
is recorded because the record must be whole, and the maker is paid on it; it is not what the house is for.

**The right first, the trade after.** The record is of rights: who made a work, who may use it and how, who holds a
numbered piece. Ownership is one of those rights, not the whole of them. So every page that offers a work says first
what is held, what may be done with it and what stays with the maker, and only then what it costs or how it may pass
on. The one statement is built in `src/holds.js` and read before paying, on the papers and at resale
(`test/holds.js`); its open questions are counsel's (docs/COUNSEL.md, 44 to 49).

What this changed on the market's pages (#176): a stranger is shown what is offered and what is asked, and no count or
sum of what has sold (the maker and the Studio still see their own, as #165 set); the pages say "the maker" and "the
register", and say what the house does in a resale (it takes the payment, moves the piece with its number, pays its
collector and its maker) in place of the language of an exchange. The Studio's and the maker's own views keep their
older words ("traded", "last traded") until Will says what they should be.

## The rules the house keeps (the trade's own, kept by the machine)

| The rule | What the house does | Today |
|---|---|---|
| An edition, once stated, is never exceeded | The size is fixed at the first sale; it can be made smaller, never larger; the register says so | **holds** (#165): with a sale, a print edition's size and a work's `edition_size` stay or come down to what is sold, never up, never opened again, by the maker and the Studio alike (`src/rules-of-trade.js`); each change of size is on the register (`work.editions`, from and to) |
| Prices go up, never down in public; one price everywhere | A public price; a step up as an edition sells; no private discount that the record cannot see | a print edition's price and framed price with a sale stay or rise, never fall (#165); licence prices not held (audit in #165's pull request); **no steps** (design below); discounts not audited |
| A fast resale harms a young market | A holding time before a piece may be offered again; the maker and their gallery are told first | **holds** (#165): `MARKET_HOLD_DAYS` (draft 365) from a piece's issue or last trade; the holder is told the day; a gift is not held and does not start the clock; the Studio lifts it for one piece with a reason on the register; counsel question 35. Not yet: the maker and their gallery told first |
| The artist earns nothing on resale in the United States | A royalty to the maker on every resale inside the house | **holds** in code (10%, a draft; the house's fee 5%, a draft) |
| A weak public result can stall a career | A resale price is shown to the maker, the holder and the buyer; never a public tape, a total or a chart | **holds** (#165) on the pages: `/market`, the work page, its life, `/prices`, the register's words and the master record show a stranger only what is offered and its asking price. **Not yet**: `/ledger.json` (the whole register, for anyone to check) carries each trade's and each print's price in its signed entries (see #165's pull request) |
| Records a gallery can trust | The maker's full sales history, exportable, with each number, size, paper, date and holder | the register and the registry hold it; an export for a gallery is not built |
| The gallery is not gone around | A represented work names its gallery; an enquiry or a sale goes to the gallery on its terms; the house never undercuts | `galleries.js`, `gallerist.js`, `shows.js` exist; **not audited** against this line |
| Nothing made by a machine is passed as a maker's | The maker states how a work was made; the house does not sell machine-made images as art | not audited |

## What the house never does

- Looks or behaves like an open marketplace: no "deals", no sale banners, no "trending", no ranking of people or prices.
- Publishes a tape of resale prices or a value for a person's collection to anyone but that person.
- Sells a represented artist's work around their gallery, or at a price other than the gallery's.
- Says "disrupt", "democratise", "cut out the middleman", "invest", or anything that reads as speculation.
- Claims a museum's, a gallery's, an auction house's or a partner's endorsement (CLAUDE.md). "On view at" is a fact the
  maker or the gallery states, with dates; it is never "in partnership with".
- Floods: living makers' work is never discounted for volume. Volume comes from the public domain and museums.

## "On display here"

A public-domain work says where the object hangs. A living maker's work does the same: "On view at <gallery>, <street>,
<city>, until <date>", stated by the maker or claimed by the gallery, with the gallery's own way to enquire. It sends
the visitor to the room where the object is. This is the line that makes a gallery want its artists in the house.
Not built for living makers' works; a design is owed (after the freeze).

## An international market

The record is the same everywhere; the law is not. Each of these is counsel's before it is the house's: the artist's
resale right where it exists by law (the United Kingdom, the European Union) beside the house's own royalty; sales tax,
VAT and import duty; export licences and cultural property; money between people in more than one currency; the
languages of the papers. Order: the United States first, on rules that would also be right abroad; one more country
only when counsel has read its rules.

## The order of work

1. Now (repairs, inside the freeze): an edition cannot be enlarged once a print has sold; `/market` shows no prices or
   totals to the public. Each with its test.
2. Next (Will's decisions): the holding time; price steps; the royalty and the fee; who sees a resale price.
3. After the freeze (designs first): "on view at" for living makers; the gallery's own desk and the sales history
   export; the represented work's way to buy.
4. Later: a second country.

## Price steps for print editions (a design; no code; every number is Will's)

The trade's way: the price of an edition rises at fixed points as it sells, and never falls. The house already does this
for Collect (`LADDER` in `src/app.js`: the base price, then higher at each quarter of the edition sold, a draft). For a
print edition it would be stated by the maker, per size, before the first print sells.

- **What is stored.** On each print edition, its steps: a short list of (from number, price, framed price), the first
  step from No. 1 at the edition's price. A number's price is the price of the last step at or below it. Nothing else:
  what each print sold for is already on its licence and on the register (`print.sold`).
- **The rules, the same as the size and the price today.** Before the first sale the steps are the maker's to change.
  After it, a step at or below the next number to sell is fixed; a later step may be raised or moved earlier, never
  lowered or moved later; a step may be added above what is sold, never below. The Studio is held to the same. A change
  of steps goes on the register beside the change of size (`work.editions`, from and to).
- **Which price a buyer pays.** The price of the number they are given. The house numbers a print when it is paid
  (`onGrant`), so the checkout states the price of the next number; if two people pay at the same moment across a step,
  each pays what their checkout said, and the register shows it. (To decide: hold the number at checkout instead.)
- **What a collector is shown.** The price now, and the next step in plain words: "$X now; $Y from No. N." The whole
  ladder on the papers. Never how many remain at a price as a push to buy ("only two left at this price"), never a
  countdown. A holder sees what they paid; a stranger never sees what another print sold for.
- **What it needs from Will.** Whether steps are offered at all, the default shape (how many steps, at which numbers,
  by how much), whether framed prices step with the print, and whether the house's own sizes (`EDITION_DEFAULTS`)
  carry a ladder by default.

