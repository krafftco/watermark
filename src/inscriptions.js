// Inscriptions (Will, 26 Oct: "not make the Franklin connection so obvious, but do it where it is best; we want people
// inspired by the greats"; "like Old Parkland": the greats stand in the stone there, a line carved over a door, the
// names inlaid in brass around the courtyard, a figure at the entrance, and nothing explained). The house does the
// same: the copy of a room never names its ancestor in the lede; the room carries one carved line, signed and dated,
// and the printing house a ring of names in brass. Every line is the person's own and out of copyright.
'use strict';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LINES = {
  printers: { text: 'Festina lente.', by: 'Aldus Manutius, printer', where: 'Venice, 1501', note: 'Make haste slowly: the mark of the Aldine press, an anchor and a dolphin.' },
  press: { text: 'The work shall not be lost; for it will, as he believed, appear once more in a new and more elegant edition, corrected and improved by the author.', by: 'B. Franklin, Printer', where: 'his epitaph, written at 22, 1728' },
  library: { text: 'I cannot live without books.', by: 'Thomas Jefferson', where: 'to John Adams, 1815' },
  reading: { text: 'A good book is the precious life-blood of a master spirit, embalmed and treasured up on purpose to a life beyond life.', by: 'John Milton', where: 'Areopagitica, 1644' },
  desk: { text: 'Either write something worth reading or do something worth writing.', by: 'Poor Richard', where: '1738' },
  keys: { text: 'We must, indeed, all hang together, or, most assuredly, we shall all hang separately.', by: 'B. Franklin', where: 'Philadelphia, 1776' },
  art: { text: 'Learning never exhausts the mind.', by: 'Leonardo da Vinci', where: 'the notebooks' },
  makers: { text: 'Art is long, life short, judgement difficult, opportunity transient.', by: 'Goethe', where: 'Wilhelm Meister, 1796' },
  collect: { text: 'The love of learning, the sequestered nooks, and all the sweet serenity of books.', by: 'Longfellow', where: '1874' },
};
// The ring in brass: the printers of the line, Mainz to Hammersmith, around the printing house.
const RING = ['Gutenberg', 'Manutius', 'Plantin', 'Caslon', 'Baskerville', 'Bodoni', 'Franklin', 'Morris'];

function insc(room, { cls = '' } = {}) {
  const l = LINES[room]; if (!l) return '';
  return `<figure class="insc ${cls}"><blockquote>${esc(l.text)}</blockquote><figcaption>${esc(l.by)}${l.where ? ` · ${esc(l.where)}` : ''}</figcaption></figure>`;
}
function ring(names = RING, { cls = '' } = {}) {
  return `<p class="brass ${cls}" aria-label="The printers of the line">${names.map(n => `<span>${esc(n)}</span>`).join('<i>·</i>')}</p>`;
}
module.exports = { insc, ring, LINES, RING };
