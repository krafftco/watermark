// The house's share, paid by the collector (Will, 20 Oct: "instead of charging the creator we charge the collector,
// like Airbnb"; "the price is the artist's"; "is this how Sotheby's would do it"; "make it whatever is best"). The art
// world's own convention: the auction house charges the buyer a premium on top of the hammer price; the seller's price
// is the seller's; the schedule is published and the invoice itemised. So: the maker names a price and receives every
// dollar of it; the collector pays that price plus the house's share, shown as one number on the wall and split
// wherever anyone looks closer (the eye, the license page, the letter, /share). Never 'a service fee': the house's
// share. Small, published and plainly fair on every sale; the scale is the business.
//   FEE_SIDE=collector turns it on (set in Render); unset, the old way: the house keeps 100 − share_pct.
//   The Collect (use 'social'): a flat COLLECT_HOUSE_CENTS (200) on top of the maker's price: $5 → $7. A round number
//   reads as a price; cents read as a tax. After the card fee the house keeps about $1.50 of it.
//   Every other use: a marginal schedule like an auction house's premium, HOUSE_TIERS ('20:500000,15:5000000,10'):
//   20% of the maker's price to $5,000, 15% of the next to $50,000, 10% above, to the cent: $350 → $420;
//   $20,000 → $23,250; $100,000 → $112,750. The big buyer pays the smaller rate; the maker is paid in full either way.
//   `licenses.house_cents` records the house's part of a paid license; a license without it (before the switch, or a
//   company license set by the Studio) is split the old way, share_pct of the price. `makerOf(l, pct)` and
//   `sqlMaker(pct)` give the maker's side either way, so statements, the eye and the letters agree.
const SIDE = process.env.FEE_SIDE || 'maker';
const on = () => SIDE === 'collector';
// The schedule: 'pct:upto,pct:upto,pct' in cents; the last tier has no ceiling.
const TIERS = String(process.env.HOUSE_TIERS || '20:500000,15:5000000,10').split(',').map(t => { const [p, u] = t.split(':'); return { pct: +p, upto: u ? +u : Infinity }; });
const HOUSE_PCT = TIERS[0].pct; // the first rate, for copy
const COLLECT_HOUSE_CENTS = process.env.COLLECT_HOUSE_CENTS != null ? +process.env.COLLECT_HOUSE_CENTS : 200;
// The house's share on top of a maker's price, for a use: flat on a Collect, marginal by the schedule on the rest.
function premium(makerCents) {
  let left = makerCents, from = 0, sum = 0;
  for (const t of TIERS) { const band = Math.max(0, Math.min(left, t.upto - from)); sum += band * t.pct / 100; left -= band; from = t.upto; if (left <= 0) break; }
  return Math.ceil(sum);
}
function house(useKey, makerCents) {
  if (!on() || makerCents == null) return 0;
  if (useKey === 'social') return COLLECT_HOUSE_CENTS;
  return premium(makerCents);
}
const total = (useKey, makerCents) => (makerCents == null ? makerCents : makerCents + house(useKey, makerCents));
// The maker's side of a paid license: price less the house's part when recorded, else the old percentage.
// From a total paid with nothing recorded (a sale before the switch, a set): the maker's side by the rule.
const makerFromTotal = (useKey, total) => {
  if (useKey === 'social') return Math.max(0, total - COLLECT_HOUSE_CENTS);
  let lo = 0, hi = total; // the maker's price m with m + premium(m) = total, by bisection on whole cents
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (mid + premium(mid) <= total) lo = mid; else hi = mid - 1; }
  return lo;
};
// The schedule in words, for the page and the eye.
const schedule = () => TIERS.map((t, i) => `${t.pct}%${t.upto === Infinity ? (i ? ' above that' : '') : ` ${i ? 'of the next ' : 'to '}$${(t.upto / 100).toLocaleString('en-US')}`}`).join(', ');
const makerOf = (l, pct) => (l.house_cents != null ? (l.price_cents || 0) - l.house_cents : Math.round((l.price_cents || 0) * (pct || 85) / 100));
const sqlMaker = (pct, a = 'l') => `(${a}.price_cents - COALESCE(${a}.house_cents, CAST(ROUND(${a}.price_cents * (100 - ${+pct || 85}) / 100.0) AS INTEGER)))`;
// Said on the wall: how the money goes.
const said = (pct, first) => (on() ? `The price is ${first ? first + '’s' : 'the maker’s'}, every dollar of it; the house’s share is paid by the collector on top.` : `${pct || 85}% of every sale is ${first ? first + '’s' : 'the maker’s'}.`);
module.exports = { on, house, total, premium, makerOf, makerFromTotal, sqlMaker, said, schedule, TIERS, HOUSE_PCT, COLLECT_HOUSE_CENTS };
