// Owners (Will, 20 Oct: "I want one company that people can invest in"; Krafft structured after Berkshire Hathaway,
// built like Hillwood; "let's make an investors page"). /owners (and /investors): how Krafft is owned and run, for the
// people who may one day hold a share of it: one company at the top; its businesses, Watermark the largest, with the
// numbers the house can vouch for; two classes of stock and the founder's trust; no dividend while a dollar reinvested
// earns more; the owner's manual; the letter and the meeting; what is never touched (client money); a letter door.
// It describes the company. It offers nothing: no share is for sale on this page, and it says so plainly. Every word a
// draft for Will and for counsel (docs in the Krafft project: "Krafft: one company").
function mountOwners(app, { db, V, C }) {
  const { esc } = V;
  const EMAIL = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  const MANUAL = [
    ['One company.', 'Krafft owns its businesses outright and lets them run themselves. People own Krafft; no subsidiary ever sells a share of its own.'],
    ['Owned for life, run as a stewardship.', 'The founder’s owner shares are held in a trust whose purpose is written: keep the work, keep the maker’s share, never sell the company. The votes belong to the purpose; the economics are shared.'],
    ['Two classes, one deal.', 'Class A owner shares carry ten votes each and are never sold; they convert into B one way only, so the owner class only shrinks. Class B shares, which anyone may hold, carry one vote each and the same share of the profit. What you own is the same company the founder owns.'],
    ['We love our owners.', 'The house has four constituencies: makers, collectors, curators, and the people who own it. Owners are treated as the first three are: thanked, written to in plain words, answered in person, and never surprised.'],
    ['No dividend while a dollar kept earns more than a dollar paid.', 'Cash comes to the centre and goes where it earns most. A dividend begins the year that stops being true, and the letter will say so.'],
    ['Stock is issued only when what is received is worth more than what is given.', 'Krafft pays in cash when it can, buys back its shares when they trade below what the company is worth, and never issues owner shares.'],
    ['Other people’s money is not ours.', 'The maker’s share of every sale, a collector’s pocket, a curator’s earnings: held apart, paid on schedule, never invested while owed.'],
    ['The work is never trained on without a yes.', 'Every work the house holds is reserved. That promise is the company’s, not one subsidiary’s.'],
    ['Small at the centre.', 'The businesses run themselves; headquarters stays a handful of people who choose leaders and allocate capital.'],
    ['Plain words, once a year.', 'The letter reports each business, what it earned, what went wrong and what will be done with the cash. The meeting answers questions for as long as they last.'],
  ];
  // The house's share, published (Will, 20 Oct: the institution people trust publishes its schedule). One page, one
  // paragraph each: what the maker receives, what the collector pays on top, what the house does with it.
  app.get('/share', (req, res) => {
    const FEE = require('./fee'); const on = FEE.on();
    res.send(V.layout({ title: 'The house’s share · Watermark', path: '/share', desc: 'What the maker receives, what the collector pays on top, and what the house does with its share.', body: `<article class="dr ow ow-share">
<header class="dr-h"><div class="dr-hd"><p class="k">The house</p><h1>The house’s share.</h1>
<p class="lede">${on ? 'The price of a work is the maker’s, every dollar of it. The house’s share is paid by the collector on top, shown in the one number on the wall and itemised on every receipt. This is the whole schedule; there is no other fee.' : `Of every sale, ${85}% is the maker’s and the rest is the house’s. This is the whole schedule; there is no other fee.`}</p></div></header>
${on ? `<section class="dr-st"><p class="k">The schedule</p>
<p><b>Collect.</b> The maker’s price plus $${(FEE.COLLECT_HOUSE_CENTS / 100).toFixed(0)}. A $5 Collect is $${((500 + FEE.COLLECT_HOUSE_CENTS) / 100).toFixed(0)}: $5 to the maker, $${(FEE.COLLECT_HOUSE_CENTS / 100).toFixed(0)} to the house.</p>
<p><b>Every other use, and every print.</b> ${esc(FEE.schedule())} of the maker’s price, on top, by the band, as an auction house’s premium is reckoned. ${(() => { const ex = [35000, 2000000, 10000000].map(m => `$${(m / 100).toLocaleString('en-US')} is paid at $${((m + FEE.premium(m)) / 100).toLocaleString('en-US')}`); return `A price of ${ex[0]}; ${ex[1]}; ${ex[2]}.`; })()}</p>
<p><b>Memberships</b> (the Club, Keeping, Friends of the house) are dues, not a share, and are priced on their own pages.</p></section>
<section class="dr-st"><p class="k">What the share pays for</p>
<p>The card fees, which the house pays out of its share, never the maker’s. The vault, the register, the papers, the delivery, the print room, the guide, the Keys, and the people who keep them. The rest is kept and put back into the house.</p></section>
<section class="dr-line"><p class="k">What is never touched</p><p>The maker’s price, a collector’s pocket and a curator’s earnings are held apart from the house’s money and paid on schedule. The receipt on every license says what went where; anyone can check a license by its Watermark number.</p></section>` : ''}
<section class="dr-ask"><p class="k">By letter</p><p>Questions about a particular sale: <a href="mailto:${esc(process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com')}">${esc(process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com')}</a>. <a href="/owners">How the company is owned</a> · <a href="/terms">The terms of the house</a>.</p></section>
</article>` }));
  });
  app.get('/investors', (req, res) => res.redirect(301, '/owners'));
  app.get('/owners', (req, res) => {
    const n = {
      works: db.prepare("SELECT COUNT(*) n FROM works WHERE status='held'").get().n,
      makers: db.prepare("SELECT COUNT(DISTINCT maker_id) n FROM works WHERE status='held'").get().n,
      collectors: db.prepare("SELECT COUNT(DISTINCT buyer_id) n FROM licenses WHERE buyer_id IS NOT NULL AND collector_no IS NOT NULL AND status IN ('active','expired')").get().n,
      register: db.prepare('SELECT COUNT(*) n FROM ledger').get().n,
      since: (db.prepare('SELECT MIN(at) a FROM ledger').get().a || '').slice(0, 4),
    };
    const house = db.prepare('SELECT * FROM makers WHERE handle=?').get(C.maker.handle);
    const hero = db.prepare("SELECT * FROM works WHERE status='held' AND width >= height ORDER BY curated DESC, stars DESC, id ASC LIMIT 1").get();
    res.send(V.layout({ title: 'Owners · Krafft', path: '/owners', desc: 'How Krafft, the company that owns Watermark, is owned and run: one company, held for life as a stewardship, after Berkshire Hathaway.', image: hero ? `/img/${hero.slug}/screen` : null, body: `<article class="dr ow">
<header class="dr-h">${hero ? `<img class="dr-por dr-por-w" src="/img/${esc(hero.slug)}/screen" alt="">` : ''}<div class="dr-hd"><p class="k">Krafft</p><h1>One company.</h1>
<p class="lede">Krafft is the company that owns Watermark, Krafft Studios, Krafft Design and Krafft Ventures. It is one company that people can own, run for life by its founder as a stewardship and allocated from the centre, after Berkshire Hathaway: the businesses run themselves; cash comes home and goes where it earns most; nothing is for sale.</p></div></header>

<section class="dr-st"><p class="k">The companies</p>
<p><b>Watermark</b> holds, shows, licenses and protects works of art at the source: the maker’s own deed and vault, the collector’s gallery, the register that cannot be quietly changed, and the Keys, its members’ club. It is the largest of Krafft’s companies and the one the others feed. <a href="/about">Why it exists →</a></p>
<p><b>Krafft Studios</b> makes the house’s media: the founding collection, the stories, the films of its nights. <b>Krafft Design</b> builds brand systems for clients; its fees fund the rest today. <b>Krafft Ventures</b> holds the brands of its own, Dallas Golf Club among them.</p></section>

<section class="dr-nums"><div><b>${n.works.toLocaleString('en-US')}</b><span>works held by Watermark</span></div><div><b>${n.makers}</b><span>maker${n.makers === 1 ? '' : 's'}</span></div><div><b>${n.collectors}</b><span>collector${n.collectors === 1 ? '' : 's'}</span></div><div><b>${n.register.toLocaleString('en-US')}</b><span>entries on the register${n.since ? `, since ${esc(n.since)}` : ''}</span></div></section>
<p class="note ow-note">The numbers are the house’s own, counted from its register at this moment, and they are small. The letter will report them each year as they are.</p>

<section class="dr-st"><p class="k">How Krafft is owned</p>
<p>Two classes of stock. <b>Class A</b>, the owner shares, carry the votes and are held by the founder through a trust whose purpose is written down: keep the work, keep the maker’s share, never sell the company. They are never sold and never pledged. <b>Class B</b> shares, which anyone may one day hold, carry one vote each and the same share of the profit. A holder of either owns the same company. Owner shares convert into B one way only, as Berkshire’s do, so no one can buy their way into the owner class and the stewardship cannot be bought out.</p>
<p>No dividend, by policy, while a dollar reinvested is worth more than a dollar paid out. Cash from the businesses comes to the centre and is put where it earns most: into Watermark first, then into the next company worth owning. The letter records every dollar moved, its reason and its return.</p>
<p>The model is Berkshire Hathaway for the shareholder and Hillwood for the builder: one anchor asset (Alliance, for Hillwood; Watermark, for Krafft) that the other businesses grow around, built patiently from Dallas over decades, and never sold.</p></section>

<section class="ow-man"><p class="k">The owner’s manual</p><ol class="ow-ol">${MANUAL.map(([h, p]) => `<li><b>${esc(h)}</b> ${esc(p)}</li>`).join('')}</ol><p class="note">A draft, after Berkshire’s owner-related principles, until the founder confirms it.</p></section>

<section class="dr-st"><p class="k">The letter and the meeting</p>
<p>Owners are the house’s fourth constituency, beside makers, collectors and curators, and are treated as they are: as honoured guests of a house that is partly theirs. Once a year the founder writes to the owners in plain words: what Krafft owns, what each business earned, what went wrong, what will be done with the cash. Once a year the owners, the makers and the collectors sit in one room, a Keys night, and questions are answered for as long as they last. The first letter is for ${new Date().getFullYear()}; the first meeting is in Dallas.</p></section>

<section class="dr-line"><p class="k">What is never touched</p><p>The maker’s share of every sale, a collector’s pocket and a curator’s earnings are other people’s money. They are held apart from the company’s, paid on schedule, and never invested while owed. A company that invested them would not deserve the work it keeps.</p></section>

<section class="dr-ask"><p class="k">By letter</p><p>Krafft is privately held. No share is offered or sold on this page or anywhere on this site; this page describes how the company is owned and run, nothing more. Those who would like to be kept informed, or to receive the letter, may write: <a href="mailto:${esc(EMAIL)}">${esc(EMAIL)}</a>.</p>
<p><a href="/director">The founding director</a> · <a href="/about">Krafft and Watermark</a> · <a href="/keys">The Keys</a></p></section>
</article>` }));
  });
  return { MANUAL };
}
module.exports = { mountOwners };
