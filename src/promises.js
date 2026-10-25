// The country store (Will, 25 Oct: "we have to see it as the country store; our beloved employees; a small family
// business; we do right by our employees and our people"; after Southwest's bags-fly-free and Franklin's giving the
// useful things away: a few plain promises, named, kept, told in the founder's own voice). The store is the one
// inside Weir's on Knox Street, where Will's grandfather began in 1947 and Will played checkers with bottle tops as a
// boy. Every promise on this page is a thing the house already does; none is a plan. Every word a draft for Will.
function mountPromises(app, { V, C }) {
  const { esc, layout } = V;
  const FEE = require('./fee');
  const PROMISES = [
    ['Friday pay.', 'Every Friday, every dollar that has cleared goes to the maker’s bank, from a dollar up, with no fee and nothing held back. A sale clears in seven days; a print when it is delivered.', '/account/payouts'],
    ['The price is the maker’s.', FEE.on() ? 'Every dollar of it. The house’s share is paid by the collector, on top, on a schedule anyone can read.' : 'The maker sets it and keeps the larger part; the house’s share is on a schedule anyone can read.', '/share'],
    ['No advertisements, ever.', 'Nothing here is paid for by interrupting you. The house is kept by the people who use it.', '/about'],
    ['The master leaves untouched.', 'A delivered file is the maker’s own pixels, never re-encoded, never marked within. The papers ride beside the picture, not on it.', '/verify'],
    ['Nothing counts you.', 'Your looking is yours. No numbers on the wall, no feed, no ranking of people; the only rating in the house is a maker’s regard.', '/privacy'],
    ['The record is free, forever.', 'Any work can be deeded, fingerprinted and written to the register at no cost, the day it is made, and it stays the maker’s.', '/own'],
    ['Your work is yours to take.', 'Leave any day with every file and every paper. Nothing is held hostage, and the deed goes with you.', '/legal/makers'],
    ['We answer.', 'A letter to the house is read by a person and answered by one. There is no ticket.', `mailto:${process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com'}`],
  ];
  const page = () => layout({
    title: 'The country store · Watermark', desc: 'How Watermark does business: a few plain promises, named and kept.', path: '/promises',
    body: `<section class="narrow prose cst"><p class="k">The country store</p><h1>How we do business.</h1>
<p class="lede">In 1948 my great-grandfather J. Ray Weir and his wife Bea opened a shop twenty feet wide and seventy deep on Knox Street in Dallas and called it Weir’s Early American Shop. He sold furniture at thin margins before anyone discounted, on three rules he never wrote down and never broke: courtesy, respect, and an honest, up-front price. In the middle of the store was a country store, with a working post office and sweets on the counter, where I played checkers with bottle tops as a boy. Everybody loved it, because everybody was treated the same way there, and the people who worked in it were family.</p>
<p>Weir’s kept those rules for seventy-eight years, through every recession and the whole of the internet, and when it closed its doors this year it closed them with its people looked after to the last. Watermark is run like that store, and carries it on. These are the promises it keeps.</p>
<ol class="cst-l">${PROMISES.map(([h, line, href]) => `<li><b>${esc(h)}</b><span>${esc(line)}</span>${href ? `<a href="${esc(href)}">${/^mailto:/.test(href) ? 'Write to the house' : 'See it'} &rarr;</a>` : ''}</li>`).join('')}</ol>
<h2>J. Ray’s rules, kept</h2>
<p><b>Courtesy.</b> Every visitor is a guest in the house, and the house says thank you and means it. <b>Respect.</b> The maker’s work is shown as the maker made it, with the maker’s name on it, and nothing laid over it. <b>An honest, up-front price.</b> The price on the wall is the price; the house’s share is published; there is no fee you find out about later.</p>
<h2>Our people</h2>
<p>The house has four constituencies and keeps them in this order: the makers, whose work it is; the collectors, who keep it; the curators, guides and hosts, who make a career here on the same terms; and the owners, who are told the truth. Everyone who works for the house is paid on the same Friday the makers are, from the same statement.</p>
<p>If the house ever breaks one of these promises, say so, and it will be put right and said on the <a href="/ledger">register</a>.</p>
<p class="ab-sig"><a href="/director">Will Fullerton</a><br><small>Founding director</small></p></section>`,
  });
  app.get(['/promises', '/country-store'], (req, res) => res.send(page()));
  app.locals.promises = PROMISES;
}
module.exports = { mountPromises };
