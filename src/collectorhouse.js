// The collector's house (Will, 26 Oct: "our collect experience needs to be thought of completely: an overall of what
// you can do and how you can interact with your collection"; for people like Annie B. Taylor and Harlan Crow, who
// would show it). A collection is a house: the head of /yours and of a public gallery is the collector's best piece
// on the wall with their name and their standing, their eye in a line, and four rows of doors: Show it, Live with
// it, Keep the record, Grow it. Every door already exists in the house; this gathers them under the collector's name.
'use strict';
const { esc, tidy, money } = require('./views');

function byName(b, own) { return b && b.name ? b.name : own ? 'Your house' : 'A collector'; }

// o: { b, items, hand, own, founding, first, keys, eye, hangs, cabinetN, showingsN, pf, base, unprinted, hasOrder }
function head(o) {
  const { b, items = [], hand = [], own = false } = o;
  const best = hand[0] || items[0]; if (!best) return '';
  const works = items.length, makers = o.makers || 0;
  const earliest = items.reduce((a, i) => (i.collector_no && (!a || i.collector_no < a) ? i.collector_no : a), null);
  const since = items.map(i => String(i.starts_at || '').slice(0, 4)).filter(Boolean).sort()[0] || null;
  const key = (o.keys || []).find(k => k.kind === 'collector');
  const plate = [
    o.first && o.first.is ? `The first collector${o.first.note ? `: ${esc(o.first.note)}` : ''}` : o.founding ? `Founding Collector, No.&nbsp;${o.founding} of 100` : null,
    key ? `<a href="/keys">The Keys: the collector’s key, No. ${key.no}</a>` : null,
    `${works} piece${works === 1 ? '' : 's'}${makers ? ` by ${makers} maker${makers === 1 ? '' : 's'}` : ''}${hand.length ? `, and ${hand.length} of ${own ? 'your' : 'their'} own hand` : ''}`,
    earliest ? `Earliest number: No. ${earliest}` : null,
    since ? `Collecting since ${since}` : null,
    o.eye && o.eye.line ? esc(o.eye.line) : null
  ].filter(Boolean);
  const name = byName(b, own);
  const eyeLine = b && b.statement ? `<p class="ch-eye">${esc(b.statement)}</p>` : own ? `<form method="post" action="/yours/statement" class="ch-eyef"><input name="statement" maxlength="400" placeholder="Your eye, in a line: what you look for" aria-label="Your eye, in a line"><button class="link">Keep</button></form>` : '';
  const door = (href, verb, line, { gold = false, soon = false } = {}) => `<a class="ch-d${gold ? ' ch-gold' : ''}${soon ? ' ch-soon' : ''}" href="${esc(href)}"><b>${verb}</b><i>${line}</i></a>`;
  const code = b && b.code ? b.code : null, pub = !!(b && b.public && code);
  const rows = own ? `<div class="ch-rows">
<section class="ch-row"><h2>Show it</h2><div class="ch-ds">
${door(`/wander?in=mine&at=${esc(best.slug)}`, 'Wander your gallery', 'Your pieces one at a time, full screen, the way the house shows its own.', { gold: true })}
${pub ? door(`/g/${esc(code)}`, 'Your address', `${esc(o.base.replace(/^https?:\/\//, ''))}/g/${esc(code)}: the gallery under your name, open to anyone you send there.`) : door('/yours?tab=more#settings', 'Open the doors', 'Give the gallery your name and an address, and it can be seen by anyone you send there. Private until you do.')}
${door('/frame', 'On your television', 'The whole collection on the wall at home, changing slowly, with the plate for a moment.')}
${door(code ? `/vr?in=gallery:${esc(code)}` : '/vr', 'In a headset', 'Walk the long gallery with your pieces on its walls: Quest, Vision Pro, any headset.')}
${door('/yours?tab=hangs', 'Hang a wall', `A titled wall of your own, in your order with a line on each${o.hangs ? ` · ${o.hangs} hung` : ''}. A wall can be a tour in your voice.`)}
${door('/yours?tab=cabinet', 'A show, by invitation', `The works you own in the world, shown to the guests you name, for the run you set${o.showingsN ? ` · ${o.showingsN} showing${o.showingsN === 1 ? '' : 's'}` : ''}.`)}
</div></section>
<section class="ch-row"><h2>Live with it</h2><div class="ch-ds">
${o.unprinted ? door(`/yours/p/${esc(o.unprinted.ref)}#print`, 'Print it', `<em>${esc(tidy(o.unprinted.title))}</em> is not yet on paper. The sizes its file prints well at, the house’s print room, or a lab.`, { gold: true }) : door('/print', 'Print it', 'The house’s guide to printing: file, paper, size, lab, frame.')}
${door(`/yours/p/${esc(best.ref || '')}`, 'The proof', 'A 5 × 7 pigment print of any piece from the house’s print room, the number in pencil, posted.')}
${door(`/yours/p/${esc(best.ref || '')}/instax?film=mini`, 'Instax', 'The exact pixels an instant printer lays down. Save it to Photos and print it from the camera’s app.')}
${door(`/yours/p/${esc(best.ref || '')}`, 'The holder’s room', 'Every piece has a room: the file, the papers, the ways to live with it.')}
</div></section>
<section class="ch-row"><h2>Keep the record</h2><div class="ch-ds">
${door('/yours?tab=files', 'The papers', 'Every licence, certificate and agreement, and the Watermark number anyone can check.')}
${door('/yours?tab=cabinet', 'The cabinet', `The works you own that are not on Watermark: photographed, catalogued, insured value, provenance${o.cabinetN ? ` · ${o.cabinetN} kept` : ''}.`)}
${door('/yours/cabinet/book', 'The catalogue', 'Your collection as a registrar’s book: acquired, from whom, paid, value, where it hangs. Yours to export.')}
${o.pf ? door('/yours?tab=market', 'What it is worth', `${money(o.pf.value)} today, ${money(o.pf.paid)} paid. Numbered pieces can be sold on through the market.`) : door('/yours?tab=market', 'The market', 'Numbered pieces can be offered and sold on; the maker is paid a royalty on every trade.')}
</div></section>
<section class="ch-row"><h2>Grow it</h2><div class="ch-ds">
${door('/yours/standing', 'A piece a month', o.hasOrder ? 'Your standing order is on: the house chooses one piece for you each month.' : 'The house chooses one piece for you each month, at the price of a Collect, and hangs it here.')}
${door('/yours/looking', 'Your looking', 'A year of looking, told back: what held you, who you lean toward, your hour.')}
${door('/basket', 'The basket', 'Gather pieces as you wander and collect them all at once.')}
${door('/keys', 'The Keys', 'The members’ club of the house: the benches, the balcony, the season’s nights, the Club. The collector’s key is earned by collecting.')}
</div></section>
</div>` : '';
  return `<section class="ch${own ? ' ch-own' : ''}">
<div class="ch-hero"><a class="ch-pic" href="${own && best.ref ? `/yours/p/${esc(best.ref)}` : `/w/${esc(best.slug)}`}"><img src="/img/${esc(best.slug)}/large" alt="${esc(tidy(best.title))}" draggable="false"></a>
<div class="ch-t"><p class="k">${own ? 'Your house' : 'A collector’s house'}</p><h1 class="ch-name">${esc(name)}</h1><p class="ch-plate">${plate.join(' <span>·</span> ')}</p>${eyeLine}<p class="ch-cap">${esc(tidy(best.title))}${best.maker ? ` · ${esc(best.maker)}` : ''}${best.collector_no ? ` · No. ${best.collector_no}` : ''}</p></div></div>
${rows}</section>`;
}

module.exports = { head };
