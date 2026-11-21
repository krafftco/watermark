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

## The rules the house keeps (the trade's own, kept by the machine)

| The rule | What the house does | Today |
|---|---|---|
| An edition, once stated, is never exceeded | The size is fixed at the first sale; it can be made smaller, never larger; the register says so | **fault**: `print_editions.edition_n` and `works.edition_size` can be raised after sales (only held at or above what is sold) |
| Prices go up, never down in public; one price everywhere | A public price; a step up as an edition sells; no private discount that the record cannot see | prices are public and fixed; **no steps**; discounts not audited |
| A fast resale harms a young market | A holding time before a piece may be offered again; the maker and their gallery are told first | **none**; the market is brokered from the Studio until counsel and `MARKET_SETTLEMENT=stripe` |
| The artist earns nothing on resale in the United States | A royalty to the maker on every resale inside the house | **holds** in code (10%, a draft; the house's fee 5%, a draft) |
| A weak public result can stall a career | A resale price is shown to the maker, the holder and the buyer; never a public tape, a total or a chart | **fault**: `/market` shows the last 24 trades with prices and the total traded |
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
