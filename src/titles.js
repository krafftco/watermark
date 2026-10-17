// Titles in title case, the way a catalogue or a gallery wall sets them: "The Dome of the Pantheon".
// Small words stay lower (a, of, the, in…) unless they open or close the title or follow a colon;
// words the maker already capitalised (McQueen, iPhone, NASA) are left as they are.
const SMALL = new Set('a an and as at but by en for from if in into nor of off on onto or over per so the to up via vs with yet'.split(' '));
function titleCase(s) {
  const str = String(s == null ? '' : s).trim(); if (!str) return str;
  const words = str.split(/(\s+)/);
  const idx = words.map((w, i) => (/\S/.test(w) ? i : -1)).filter(i => i >= 0);
  const first = idx[0], last = idx[idx.length - 1];
  return words.map((w, i) => {
    if (!/\S/.test(w)) return w;
    if (/[A-Z]/.test(w.slice(1)) || /^[^A-Za-z]*[A-Z]/.test(w) && w !== w.toLowerCase() && /[a-z]/.test(w) === false) return w; // mixed or all caps: keep
    const prev = words[i - 2] || '';
    const bare = w.toLowerCase().replace(/[^a-z]/g, '');
    const lead = i === first || i === last || /[:—–-]$/.test(prev) || /^[("“‘]/.test(w);
    if (!lead && SMALL.has(bare)) return w.toLowerCase();
    // Capitalise each part of a hyphenated word ("Late-Afternoon"), after any opening punctuation.
    return w.split('-').map(p => p.replace(/^([^A-Za-z]*)([a-z])/, (m, a, b) => a + b.toUpperCase())).join('-');
  }).join('');
}
// One pass over what is already held: the maker's wording is kept in title_given.
function retitle(db) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='title_given'").get()) db.exec('ALTER TABLE works ADD COLUMN title_given TEXT');
  const set = db.prepare('UPDATE works SET title_given=COALESCE(title_given, title), title=? WHERE id=?');
  let n = 0;
  for (const w of db.prepare('SELECT id, title FROM works').all()) { const t = titleCase(w.title); if (t !== w.title) { set.run(t, w.id); n++; } }
  return n;
}
module.exports = { titleCase, retitle };
