// The shelves (Will, 25 Oct: "the way books should be sorted, stacked and organized, how you can find fiction,
// nonfiction, different things, and authors: make reading the easiest and most wonderful"). The Library as a room
// of the Morgan's kind: the books bound and standing, shelved the way a reader thinks (Fiction · Poetry · Drama ·
// History · Philosophy and ideas · Faith · Science and nature · Lives and letters · Essays · For children · Photo
// books · Almanacks · From the makers), by author (A–Z, every author's own shelf), the book you are in, a few to
// begin with, and one search over all of it. `texts.shelf` is set from the book's own subjects (Gutendex's, kept in
// `texts.subjects`, read at bring and backfilled quietly for what was shelved before), the canon by hand, and a
// maker's text by its kind; the maker may set it on the writing desk.
const SHELVES = [
  ['fiction', 'Fiction', 'Novels and stories.'], ['poetry', 'Poetry', 'Verse, the sonnets, the epics.'], ['drama', 'Drama', 'Plays, to be read aloud.'],
  ['history', 'History', 'What happened, and who was there.'], ['ideas', 'Philosophy and ideas', 'How to think, and how to live.'], ['faith', 'Faith', 'Scripture, confession, the mystics.'],
  ['science', 'Science and nature', 'The world looked at closely.'], ['lives', 'Lives and letters', 'Biography, memoir, correspondence, journals.'], ['essays', 'Essays', 'Short prose, thought through.'],
  ['children', 'For children', 'Fairy tales and first books.'], ['photobook', 'Photo books', 'Made from the walls of the house.'], ['almanack', 'Almanacks', 'A maker’s year as one book.'], ['makers', 'From the makers', 'Written here, published by the house.'],
];
const BY_ID = { // the canon's shelves, by Gutenberg number
  2680: 'ideas', 1727: 'poetry', 6130: 'poetry', 1497: 'ideas', 8438: 'ideas', 1232: 'ideas', 3600: 'essays', 1524: 'drama', 1532: 'drama', 1041: 'poetry', 996: 'fiction', 26: 'poetry', 18269: 'faith', 521: 'fiction', 829: 'fiction',
  3300: 'ideas', 1404: 'ideas', 1342: 'fiction', 158: 'fiction', 84: 'fiction', 1260: 'fiction', 768: 'fiction', 2701: 'fiction', 205: 'essays', 1322: 'poetry', 2944: 'essays', 1400: 'fiction', 98: 'fiction', 145: 'fiction', 1399: 'fiction',
  2600: 'fiction', 2554: 'fiction', 28054: 'fiction', 2413: 'fiction', 135: 'fiction', 1184: 'fiction', 76: 'fiction', 174: 'fiction', 219: 'fiction', 2814: 'fiction', 408: 'essays', 23: 'lives', 1228: 'science', 1998: 'ideas', 621: 'ideas',
  132: 'ideas', 216: 'faith', 3330: 'ideas', 8800: 'poetry', 21765: 'poetry', 3296: 'faith', 2130: 'ideas', 25344: 'fiction', 215: 'fiction', 541: 'fiction', 600: 'fiction', 2591: 'children', 11: 'children', 120: 'children', 35: 'fiction', 20203: 'lives',
};
function classify({ kind, subjects = [], bookshelves = [], title = '', source = '', maker_id = null } = {}) {
  if (kind === 'photobook') return 'photobook'; if (kind === 'almanack') return 'almanack';
  const id = +((String(source || '').match(/ebooks\/(\d+)/) || [])[1] || 0); if (id && BY_ID[id]) return BY_ID[id];
  if (maker_id) return 'makers';
  const s = [...subjects, ...bookshelves].join(' | ').toLowerCase();
  const has = re => re.test(s);
  if (has(/juvenile|children|fairy tales|nursery/)) return 'children';
  if (has(/poetry|poems|epic/)) return 'poetry';
  if (has(/drama|plays|tragedies|comedies/)) return 'drama';
  if (has(/fiction|novel|short stories|romance|adventure stories|detective|science fiction|fantasy/)) return 'fiction';
  if (has(/biography|autobiography|memoir|correspondence|letters|diaries|journals/)) return 'lives';
  if (has(/religion|bible|theology|christian|buddhis|hindu|islam|taois|mysticism|prayer/)) return 'faith';
  if (has(/philosophy|ethics|political science|economics|logic|psychology|education/)) return 'ideas';
  if (has(/science|natural history|evolution|physics|mathematics|astronomy|botany|zoology|medicine|geology/)) return 'science';
  if (has(/history|wars?\b|revolution|civilization|antiquities/)) return 'history';
  if (has(/essays/)) return 'essays';
  if (kind === 'essay' || kind === 'journal') return 'essays'; if (kind === 'history') return 'history'; if (kind === 'paper' || kind === 'document') return 'ideas';
  return /poems|sonnets|verses/i.test(title) ? 'poetry' : 'fiction';
}
function mountShelves(app, { db, V, C, isStudio, buyerOf, fetchImpl }) {
  const { esc, tidy } = V; const B = require('./binding');
  let migrated = false;
  function migrate() { // the texts table is library.js's, made after this mounts: so on first use
    if (migrated) return true; try { for (const [col, ddl] of [['shelf', 'TEXT'], ['subjects', 'TEXT']]) if (!db.prepare(`SELECT 1 FROM pragma_table_info('texts') WHERE name='${col}'`).get()) db.exec(`ALTER TABLE texts ADD COLUMN ${col} ${ddl}`); migrated = true; shelveAll(); return true; } catch (e) { return false; }
  }
  const J = s => { try { return JSON.parse(s || '[]'); } catch (e) { return []; } };
  // Every text without a shelf gets one now, from what is known; a Gutenberg book's subjects are fetched later.
  function shelveAll() {
    for (const t of db.prepare("SELECT id, kind, title, source, maker_id, subjects FROM texts WHERE shelf IS NULL").all()) { const sub = J(t.subjects); db.prepare('UPDATE texts SET shelf=? WHERE id=?').run(classify({ ...t, subjects: sub.subjects || sub, bookshelves: sub.bookshelves || [] }), t.id); }
  }
  setTimeout(migrate, 0);
  let job = null;
  async function backfill() { // the subjects of each Gutenberg book, one every 1.5 s, so the rules can shelve them
    if (!migrate()) return null; if (job) return job; const todo = db.prepare("SELECT id, source FROM texts WHERE subjects IS NULL AND source LIKE '%gutenberg.org/ebooks/%' ORDER BY id").all();
    job = (async () => { for (const t of todo) { const id = +((t.source.match(/ebooks\/(\d+)/) || [])[1] || 0); if (!id) continue; try { const r = await (fetchImpl || fetch)(`${process.env.GUTENDEX || 'https://gutendex.com/books'}/${id}`, { signal: AbortSignal.timeout(8000) }); if (r.ok) { const m = await r.json(); const sub = { subjects: m.subjects || [], bookshelves: m.bookshelves || [] }; const row = db.prepare('SELECT * FROM texts WHERE id=?').get(t.id); db.prepare('UPDATE texts SET subjects=?, shelf=? WHERE id=?').run(JSON.stringify(sub), classify({ ...row, ...sub }), t.id); } } catch (e) { /* next time */ } await new Promise(r => setTimeout(r, 1500)); } job = null; })();
    return job;
  }
  if (process.env.NODE_ENV !== 'test') app.locals.governor.boot('shelves backfill', () => backfill());
  const all = () => db.prepare("SELECT t.id, t.slug, t.kind, t.title, t.author, t.year, t.summary, t.shelf, t.maker_id, t.price_cents, t.body IS NOT NULL AS hasBody, t.plates IS NOT NULL AS hasPlates, t.file, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 ORDER BY t.title").all();
  const href = t => (((t.hasBody || t.hasPlates) && !t.file) ? `/read/${t.slug}` : `/library/${t.slug}`);
  const surname = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),/); return (m ? m[1] : x.split(' ').pop()).replace(/\s*\(.*\)$/, '').trim(); };
  const book = (t, cls = '') => B.html({ ...t, title: tidy(t.title) }, href(t), { cls, size: 240 });
  const shelfRow = (key, items, { all: more = null } = {}) => { const sh = SHELVES.find(s => s[0] === key) || [key, key, '']; return `<section class="lbr-shelf" id="shelf-${esc(key)}"><header class="lbr-h"><h2>${esc(sh[1])}</h2><span class="lbr-line">${esc(sh[2])}</span><span class="lbr-n">${items.length}</span>${more ? `<a href="${esc(more)}">All</a>` : ''}</header><div class="lbr-row"><div class="lbr-plank">${items.map(t => book(t)).join('')}</div></div></section>`; };
  // The room.
  app.get('/library', (req, res, next) => (app.locals.minute ? app.locals.minute(lib) : lib)(req, res, next)); // a stranger's Library once a minute (28 Oct)
  function lib(req, res) {
    migrate(); shelveAll(); const list = all(); /* anything shelved since is sorted on the way in */ const q = String(req.query.q || '').trim().toLowerCase(); const shelfQ = String(req.query.shelf || ''); const authorQ = String(req.query.author || '').trim();
    const b = buyerOf ? buyerOf(req) : null; const RL = app.locals.readingList; const reading = RL && b ? RL.shelf(b).reading : [];
    if (q) { const hits = list.filter(t => (t.title + ' ' + (t.author || '') + ' ' + (t.summary || '')).toLowerCase().includes(q)); return res.send(room({ title: `“${q}”`, lede: `${hits.length} book${hits.length === 1 ? '' : 's'} answer to that.`, rows: hits.length ? `<section class="lbr-shelf"><div class="lbr-grid">${hits.map(t => book(t)).join('')}</div></section>` : '<p class="note">Nothing by that word. <a href="/library">The shelves</a>.</p>', q })); }
    if (shelfQ) { const sh = SHELVES.find(s => s[0] === shelfQ); const items = list.filter(t => t.shelf === shelfQ); if (!sh) return res.redirect('/library'); return res.send(room({ title: sh[1], lede: sh[2], rows: `<section class="lbr-shelf"><div class="lbr-grid">${items.map(t => book(t)).join('')}</div></section>`, back: true })); }
    if (authorQ) { const items = list.filter(t => B.byName(t.author).toLowerCase() === authorQ.toLowerCase() || String(t.author || '').toLowerCase() === authorQ.toLowerCase()); if (!items.length) return res.redirect('/library'); return res.send(room({ title: B.byName(items[0].author), lede: `${items.length} book${items.length === 1 ? '' : 's'} on the shelf.`, rows: `<section class="lbr-shelf"><div class="lbr-grid">${items.map(t => book(t)).join('')}</div></section>`, back: true })); }
    // Begin here: six, by the day, from fiction, ideas, poetry, lives, science and history in turn.
    const day = Math.floor(Date.now() / 864e5); const begin = []; const pools = ['fiction', 'ideas', 'poetry', 'lives', 'science', 'history', 'essays', 'drama'];
    pools.forEach((k, i) => { const pool = list.filter(t => t.shelf === k); if (pool.length && begin.length < 6) begin.push(pool[(day + i) % pool.length]); });
    const continueRow = reading.length ? `<section class="lbr-shelf lbr-cont"><header class="lbr-h"><h2>You are in</h2><a href="/yours/reading">Your reading</a></header><div class="lbr-row"><div class="lbr-plank">${reading.slice(0, 8).map(r => `<span class="lbr-in">${book({ slug: r.slug, title: r.title, author: r.author, cover: r.cover, hasBody: 1 }, '')}<a class="lbr-go" href="${esc(r.href)}">Go on · ${r.progress ? r.progress + '%' : 'chapter ' + ((r.chapter || 0) + 1)}</a></span>`).join('')}</div></div></section>` : '';
    const rows = SHELVES.map(([k]) => { const items = list.filter(t => t.shelf === k); return items.length ? shelfRow(k, items.slice(0, 14), { all: items.length > 14 ? `/library?shelf=${k}` : null }) : ''; }).join('');
    // By author: A–Z.
    const byAuthor = {}; for (const t of list) { if (!t.author) continue; const k = B.byName(t.author); (byAuthor[k] = byAuthor[k] || { name: k, sur: surname(t.author), n: 0 }).n++; }
    const authors = Object.values(byAuthor).sort((a, b) => a.sur.localeCompare(b.sur) || a.name.localeCompare(b.name)); const letters = {}; authors.forEach(a => { const L = (a.sur[0] || '#').toUpperCase(); (letters[L] = letters[L] || []).push(a); });
    const az = `<section class="lbr-az" id="authors"><header class="lbr-h"><h2>By author</h2><span class="lbr-line">${authors.length} authors, A to Z</span></header><nav class="lbr-letters">${Object.keys(letters).sort().map(L => `<a href="#az-${L}">${L}</a>`).join('')}</nav>${Object.keys(letters).sort().map(L => `<div class="lbr-az-l" id="az-${L}"><b>${L}</b><ul>${letters[L].map(a => `<li><a href="/library?author=${encodeURIComponent(a.name)}">${esc(a.name)}</a><small>${a.n}</small></li>`).join('')}</ul></div>`).join('')}</section>`;
    const have = new Set(list.map(t => t.shelf));
    res.send(room({ have, title: 'The Library.', lede: `${list.length} books, bound and shelved: the public domain free to all, the makers’ own at their price. Read in the house, in the reading room; every book opens where you left it. <a class="lbr-wander" href="/wander?in=shelf">Or wander the shelf: one passage a screen, and keep the ones that stop you.</a>`, rows: continueRow + (app.locals.jewels ? app.locals.jewels.shelf() : '') + (begin.length ? `<section class="lbr-shelf lbr-begin"><header class="lbr-h"><h2>Begin here</h2><span class="lbr-line">Six for today, one from each shelf.</span></header><div class="lbr-row"><div class="lbr-plank">${begin.map(t => book(t)).join('')}</div></div></section>` : '') + rows + az, nav: true }));
  }
  function room({ title, lede, rows, q = '', back = false, nav = false, have = null, plate = '', path = '/library', kicker = null, foot = null, insc = '' }) {
    return V.layout({ title: `${title.replace(/\.$/, '')} · The Library · Watermark`, path, desc: 'The house’s library: the public domain bound and shelved, the makers’ books, read in the reading room.', body: `<main class="lbr">
<header class="lbr-top"><div class="lbr-tt"><p class="k">${kicker != null ? kicker : (back ? '<a href="/library">The Library</a>' : 'The house')}</p><h1>${esc(title)}</h1>${plate || (!back && app.locals.roomPlate ? app.locals.roomPlate('library') : '')}${insc}<p class="lede">${esc(lede)}</p></div>
<form class="lbr-find" action="/library" method="get"><input type="search" name="q" value="${esc(q)}" placeholder="A title, an author, a word" aria-label="Find a book"><button>Find</button></form>
${nav ? `<nav class="lbr-nav" aria-label="The shelves">${SHELVES.filter(([k]) => !have || have.has(k)).map(([k, n]) => `<a href="#shelf-${k}">${esc(n)}</a>`).join('')}<a href="#authors">By author</a><a href="/bookshop">The Bookshop</a><a href="/publishing">Publishing</a></nav>` : ''}</header>
${rows}
<footer class="lbr-foot"><p>${foot || `Every book here is kept as the photographs are kept: fingerprinted, on the register, read in the house. The public domain is free to all and always will be; a maker’s book is theirs, at their price, paid on Friday. <a href="/press">The printing house</a> · <a href="/account/desk">The Writer’s Desk</a> · <a href="/join">Open your museum</a>.`}</p></footer></main>` });
  }
  const plank = (h, items, { line = '', more = null, id = '' } = {}) => `<section class="lbr-shelf"${id ? ` id="${esc(id)}"` : ''}><header class="lbr-h"><h2>${esc(h)}</h2>${line ? `<span class="lbr-line">${esc(line)}</span>` : ''}<span class="lbr-n">${items.length}</span>${more ? `<a href="${esc(more)}">All</a>` : ''}</header><div class="lbr-row"><div class="lbr-plank">${items.length ? items.map(t => t.note ? `<span class="lbr-in">${book(t)}<span class="lbr-go">${esc(t.note)}</span></span>` : book(t)).join('') : '<span class="lbr-empty">Nothing on this shelf yet.</span>'}</div></div></section>`;
  app.locals.shelves = { SHELVES, classify, shelveAll, backfill, href, room, book, plank };
  return app.locals.shelves;
}
module.exports = { mountShelves, SHELVES, classify, BY_ID };
