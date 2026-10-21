// The house's share, paid by the collector (Will, 20 Oct: "instead of charging the creator we charge the collector,
// like Airbnb"; "the price is the artist's"; the Collect is $7.11: "5 to the creator, 2 to the house, 7 is my favourite
// number", then 7.11). The art world's own convention: the auction house charges the buyer a premium on top of the
// hammer price; the seller's price is the seller's. So: the maker names a price and receives every dollar of it; the
// collector pays that price plus the house's share, shown as one number on the wall and split wherever anyone looks
// closer (the eye, the license page, the letter). Never 'a service fee': the house's share.
//   FEE_SIDE=collector turns it on (the default once set in Render); unset, the old way: the house keeps share_pct.
//   The Collect (use 'social'): a flat COLLECT_HOUSE_CENTS (211) on top of the maker's price: $5 → $7.11.
//   Every other use: HOUSE_PCT (15) of the maker's price on top, to the cent: $350 → $402.50.
//   `licenses.house_cents` records the house's part of a paid license; a license without it (before the switch, or a
//   company license set by the Studio) is split the old way, share_pct of the price. `makerOf(l, pct)` and
//   `sqlMaker(pct)` give the maker's side either way, so statements, the eye and the letters agree.
const SIDE = process.env.FEE_SIDE || 'maker';
const on = () => SIDE === 'collector';
const HOUSE_PCT = +process.env.HOUSE_PCT || 15;
const COLLECT_HOUSE_CENTS = process.env.COLLECT_HOUSE_CENTS != null ? +process.env.COLLECT_HOUSE_CENTS : 211;
// The house's share on top of a maker's price, for a use.
function house(useKey, makerCents) {
  if (!on() || makerCents == null) return 0;
  if (useKey === 'social') return COLLECT_HOUSE_CENTS;
  return Math.ceil(makerCents * HOUSE_PCT / 100);
}
const total = (useKey, makerCents) => (makerCents == null ? makerCents : makerCents + house(useKey, makerCents));
// The maker's side of a paid license: price less the house's part when recorded, else the old percentage.
// From a total paid with nothing recorded (a sale before the switch, a set): the maker's side by the rule.
const makerFromTotal = (useKey, total) => (useKey === 'social' ? Math.max(0, total - COLLECT_HOUSE_CENTS) : Math.round(total * 100 / (100 + HOUSE_PCT)));
const makerOf = (l, pct) => (l.house_cents != null ? (l.price_cents || 0) - l.house_cents : Math.round((l.price_cents || 0) * (pct || 85) / 100));
const sqlMaker = (pct, a = 'l') => `(${a}.price_cents - COALESCE(${a}.house_cents, CAST(ROUND(${a}.price_cents * (100 - ${+pct || 85}) / 100.0) AS INTEGER)))`;
// Said on the wall: how the money goes.
const said = (pct, first) => (on() ? `The price is ${first ? first + '’s' : 'the maker’s'}, every dollar of it; the house’s share is paid by the collector on top.` : `${pct || 85}% of every sale is ${first ? first + '’s' : 'the maker’s'}.`);
module.exports = { on, house, total, makerOf, makerFromTotal, sqlMaker, said, HOUSE_PCT, COLLECT_HOUSE_CENTS };
