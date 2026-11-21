// The sources (#170, 20 Nov; Will: "everything that we brought in is done in the most above-board way, in a way that they
// would feel honored"). A work that came from a museum's or a library's open collection says so on its own page, in their
// words: who they are and where, the credit line their record gives, and their own page for the object, one tap away and
// plainly theirs. The way each asks to be credited is read from its own published terms (docs/SOURCES.md, with the link
// and the date); nothing here claims or implies that any of them is connected with the house.
//   of(w)        the source of a held work, by the host of its source_url, or null
//   credit(w, a) the credit line as the source asks for it (the artist first when the house knows them)
//   line(w)      the line under the label on the work page
const { esc } = require('./views');

// host → who they are. `ask`: the credit as their own page asks for it (docs/SOURCES.md).
const KNOWN = [
  { re: /(^|\.)metmuseum\.org$/, name: 'The Metropolitan Museum of Art', place: 'New York', ask: (cl) => `The Metropolitan Museum of Art, New York${cl ? `, ${cl}` : ''}` },
  { re: /(^|\.)artic\.edu$/, name: 'The Art Institute of Chicago', place: 'Chicago', ask: (cl) => `The Art Institute of Chicago${cl ? `, ${cl}` : ''}` },
  { re: /(^|\.)clevelandart\.org$/, name: 'The Cleveland Museum of Art', place: 'Cleveland', ask: (cl) => `The Cleveland Museum of Art${cl ? `, ${cl}` : ''}` },
  { re: /(^|\.)nga\.gov$/, name: 'National Gallery of Art', place: 'Washington', ask: (cl) => `${cl ? `${cl}. ` : ''}Courtesy National Gallery of Art, Washington` },
  { re: /(^|\.)si\.edu$/, name: 'Smithsonian Institution', place: 'Washington', ask: (cl) => `Smithsonian Institution${cl ? `, ${cl}` : ''}` },
];
const hostOf = u => { try { return new URL(String(u)).hostname.toLowerCase(); } catch (e) { return ''; } };
// The record's own fields, as the importer kept them in the caption ('Label: value · Label: value').
const field = (w, label) => { const m = String((w && w.caption) || '').split(' · ').map(s => s.match(/^([^:]{2,40}):\s*(.+)$/)).find(x => x && x[1].toLowerCase() === label.toLowerCase()); return m ? m[2].trim() : null; };
function of(w) {
  if (!w || !w.source_url) return null; const h = hostOf(w.source_url); const k = KNOWN.find(x => x.re.test(h)); if (!k) return null;
  return { name: k.name, place: k.place, url: String(w.source_url), creditLine: (w.credit || field(w, 'Credit line') || '').trim() || null, ask: k.ask };
}
function credit(w, artist) {
  const s = of(w); if (!s) return null;
  const by = artist || field(w, 'Attribution') || field(w, 'Artist');
  const year = field(w, 'Date') || (w.taken_at ? String(w.taken_at).slice(0, 4) : '');
  return `${by ? `${by}, ` : ''}${String(w.title || 'Untitled').trim()}${year ? `, ${year}` : ''}. ${s.ask(s.creditLine)}.`.replace(/\.\./g, '.');
}
function line(w) {
  const s = of(w); if (!s) return '';
  return `<p class="ax-line ax-src">From the collection of ${esc(s.name)}, ${esc(s.place)}${s.creditLine ? ` · ${esc(s.creditLine)}` : ''} · <a href="${esc(s.url)}" rel="noopener" target="_blank">The object’s page at ${esc(s.name)}</a></p>`;
}
module.exports = { of, credit, line, field, KNOWN };
