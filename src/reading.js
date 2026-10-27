// The public domain, and the reader (Will, 21 Oct: "what can we go find in the public domain and start putting into
// Watermark? great books, the books Benjamin Franklin was interested in; we just download it and put it on our site";
// "what is the internet waiting for us to bring? one of the greatest resources in the world sits unused: Gutenberg, and
// how shitty their viewer is; we need to create the viewer for text and reading to be the most beautiful"; "build out the
// platform, music, screening and text with the public domain, and go get the best version of it"). Two things:
//   The shelf: a book comes in from Project Gutenberg by its number or a search (Gutendex, gutendex.com, the open index
//   of Gutenberg's catalogue; the text itself from gutenberg.org): the plain text is fetched, Gutenberg's header and
//   licence boilerplate are cut away (the book is public domain; the boilerplate is theirs and goes), the chapters are
//   found (CHAPTER / BOOK / PART / LETTER / roman numerals / short capitals lines), and the book is shelved in the
//   Library as a `texts` row (kind 'book', body in the house's own paragraph form with '## ' chapter heads, source the
//   Gutenberg address, free). Franklin's shelf (`FRANKLIN`): the books Franklin names in the Autobiography as the ones
//   that made him (Bunyan, Plutarch, Defoe's Essay upon Projects, Mather's Essays to Do Good, the Spectator, Locke,
//   Xenophon, Shaftesbury) and his own, as a first shelf the Studio brings in by a press each (searched by title and
//   author; never a number guessed). Studio → Library → The public domain (/studio/reading).
//   The reader: /read/:slug, the house's reading room (`.rdr`): the text set in Newsreader at a measure of 34em, a
//   running head, the chapter's number as a small capital line, a drop cap, paper | sepia | night, the size, the
//   chapters as a drawer, keys (← → chapters, j/k a screen), the place kept on the device (chapter and depth in
//   localStorage, `wm_read_<slug>`), nothing of the reading told to anyone. Every public text with a body reads here.
//   Next: Standard Ebooks (the best-set editions) by their OPDS feed and single-page HTML; music and film from the public
//   domain through the same door (the Listening Room, the Screening Room); the house voice reading a chapter.
const FRANKLIN = [
  { title: 'The Autobiography of Benjamin Franklin', author: 'Franklin, Benjamin', why: 'His own account; the shelf below is the one he gives in it.' },
  { title: 'The Pilgrim\'s Progress', author: 'Bunyan, John', why: 'The first book he owned; sold it to buy Burton’s Historical Collections.' },
  { title: 'Plutarch\'s Lives', author: 'Plutarch', why: '“Which I read abundantly, and I still think that time spent to great advantage.”' },
  { title: 'An Essay upon Projects', author: 'Defoe, Daniel', why: 'With Mather, “gave me a turn of thinking that had an influence on some of the principal future events of my life.”' },
  { title: 'Bonifacius: Essays to Do Good', author: 'Mather, Cotton', why: 'The other of the two.' },
  { title: 'The Spectator', author: 'Addison, Joseph', why: 'The volume he took apart and rewrote to teach himself to write.' },
  { title: 'An Essay Concerning Humane Understanding', author: 'Locke, John', why: 'Read at sixteen, with the Port-Royal Art of Thinking.' },
  { title: 'The Memorabilia', author: 'Xenophon', why: 'Where he learned the Socratic method he practised on his friends.' },
  { title: 'Characteristics of Men, Manners, Opinions, Times', author: 'Shaftesbury, Anthony Ashley Cooper', why: 'With Collins, the books that made him a doubter.' },
  { title: 'Poor Richard\'s Almanack', author: 'Franklin, Benjamin', why: 'The sayings, as he gathered them.' },
];
// The canon (Will, 24 Oct: "start importing books of public record"; the Library of Alexandria): the house's first
// shelf, the books a curious person is handed first. Each carries the Gutenberg number the house believes is the
// author's own edition; that number is checked against the book's record (title and author must match) before anything
// is shelved, and a wrong or missing one falls back to a search by title and author. Never shelved unverified.
// `shelveCanon()` brings them in one at a time in the background.
const CANON = [
  ['Meditations', 'Marcus Aurelius', 2680], ['The Odyssey', 'Homer', 1727], ['The Iliad', 'Homer', 6130], ['The Republic', 'Plato', 1497], ['Nicomachean Ethics', 'Aristotle', 8438],
  ['The Prince', 'Machiavelli', 1232], ['Essays of Michel de Montaigne', 'Montaigne', 3600], ['Hamlet', 'Shakespeare', 1524], ['King Lear', 'Shakespeare', 1532], ['The Sonnets', 'Shakespeare', 1041, ['Shakespeare\'s Sonnets']],
  ['Don Quixote', 'Cervantes', 996], ['Paradise Lost', 'Milton', 26], ['Pensées', 'Pascal', 18269], ['Robinson Crusoe', 'Defoe', 521], ['Gulliver\'s Travels', 'Swift', 829],
  ['The Wealth of Nations', 'Smith, Adam', 3300], ['The Federalist Papers', 'Hamilton', 1404], ['Pride and Prejudice', 'Austen', 1342], ['Emma', 'Austen', 158], ['Frankenstein', 'Shelley, Mary', 84],
  ['Jane Eyre', 'Brontë, Charlotte', 1260], ['Wuthering Heights', 'Brontë, Emily', 768], ['Moby Dick', 'Melville', 2701], ['Walden', 'Thoreau', 205], ['Leaves of Grass', 'Whitman', 1322],
  ['Essays, First Series', 'Emerson', 2944], ['Great Expectations', 'Dickens', 1400], ['A Tale of Two Cities', 'Dickens', 98], ['Middlemarch', 'Eliot, George', 145], ['Anna Karenina', 'Tolstoy', 1399],
  ['War and Peace', 'Tolstoy', 2600], ['Crime and Punishment', 'Dostoyevsky', 2554], ['The Brothers Karamazov', 'Dostoyevsky', 28054], ['Madame Bovary', 'Flaubert', 2413], ['Les Misérables', 'Hugo', 135],
  ['The Count of Monte Cristo', 'Dumas', 1184], ['Adventures of Huckleberry Finn', 'Twain', 76], ['The Picture of Dorian Gray', 'Wilde', 174], ['Heart of Darkness', 'Conrad', 219], ['Dubliners', 'Joyce', 2814],
  ['The Souls of Black Folk', 'Du Bois', 408], ['Narrative of the Life of Frederick Douglass', 'Douglass', 23], ['The Origin of Species', 'Darwin', 1228, ['On the Origin of Species']], ['Thus Spake Zarathustra', 'Nietzsche', 1998], ['The Varieties of Religious Experience', 'James, William', 621],
  ['The Art of War', 'Sunzi', 132], ['Tao Teh King', 'Laozi', 216], ['The Analects of Confucius', 'Confucius', 3330], ['The Divine Comedy', 'Dante', 8800], ['Metamorphoses', 'Ovid', 21765],
  ['The Confessions of St. Augustine', 'Augustine', 3296], ['Utopia', 'More, Thomas', 2130], ['The Scarlet Letter', 'Hawthorne', 25344], ['The Call of the Wild', 'London', 215], ['The Age of Innocence', 'Wharton', 541],
  ['Notes from the Underground', 'Dostoyevsky', 600], ['Grimms\' Fairy Tales', 'Grimm', 2591], ['Alice\'s Adventures in Wonderland', 'Carroll', 11], ['Treasure Island', 'Stevenson', 120], ['The Time Machine', 'Wells', 35],
  // The second shelf (26 Oct): wider, by room. A number is a hint checked against the record; a null is found by title and author.
  // Fiction
  ['David Copperfield', 'Dickens', 766], ['Oliver Twist', 'Dickens', 730], ['Bleak House', 'Dickens', 1023], ['Sense and Sensibility', 'Austen', 161], ['Persuasion', 'Austen', 105],
  ['Mansfield Park', 'Austen', 141], ['Northanger Abbey', 'Austen', 121], ['Vanity Fair', 'Thackeray', 599], ['Tess of the d\'Urbervilles', 'Hardy', 110], ['Far from the Madding Crowd', 'Hardy', 107],
  ['Jude the Obscure', 'Hardy', 153], ['The Mayor of Casterbridge', 'Hardy', 143], ['Tom Jones', 'Fielding', 6593], ['Tristram Shandy', 'Sterne', 1079], ['Moll Flanders', 'Defoe', 370],
  ['Ivanhoe', 'Scott', 82], ['The Moonstone', 'Collins, Wilkie', 155], ['The Woman in White', 'Collins, Wilkie', 583], ['The Adventures of Sherlock Holmes', 'Doyle', 1661], ['The Hound of the Baskervilles', 'Doyle', 2852],
  ['A Study in Scarlet', 'Doyle', 244], ['Dracula', 'Stoker', 345], ['The Strange Case of Dr. Jekyll and Mr. Hyde', 'Stevenson', 43], ['Kidnapped', 'Stevenson', 421], ['The Portrait of a Lady', 'James, Henry', 2833],
  ['The Turn of the Screw', 'James, Henry', 209], ['The House of the Seven Gables', 'Hawthorne', 77], ['The Adventures of Tom Sawyer', 'Twain', 74], ['The Innocents Abroad', 'Twain', 3176], ['Uncle Tom\'s Cabin', 'Stowe', 203],
  ['The Awakening', 'Chopin, Kate', 160], ['The Yellow Wallpaper', 'Gilman', 1952], ['The Red Badge of Courage', 'Crane', 73], ['Sister Carrie', 'Dreiser', 233], ['The Jungle', 'Sinclair', 140],
  ['Main Street', 'Lewis, Sinclair', 543], ['Babbitt', 'Lewis, Sinclair', 1156], ['O Pioneers!', 'Cather', 24], ['My Ántonia', 'Cather', 242], ['Ethan Frome', 'Wharton', 4517],
  ['The House of Mirth', 'Wharton', 284], ['The Great Gatsby', 'Fitzgerald', 64317], ['This Side of Paradise', 'Fitzgerald', 805], ['A Portrait of the Artist as a Young Man', 'Joyce', 4217], ['Ulysses', 'Joyce', 4300],
  ['Sons and Lovers', 'Lawrence', 217], ['Women in Love', 'Lawrence', 4240], ['Howards End', 'Forster', 2891], ['A Room with a View', 'Forster', 2641], ['Lord Jim', 'Conrad', 5658],
  ['Nostromo', 'Conrad', 2021], ['The Secret Agent', 'Conrad', 974, ['The Secret Agent: A Simple Tale']], ['The Good Soldier', 'Ford', 2775], ['Of Human Bondage', 'Maugham', 351], ['The Way of All Flesh', 'Butler', 2084],
  ['Three Men in a Boat', 'Jerome', 308], ['The Phantom of the Opera', 'Leroux', 175], ['The Metamorphosis', 'Kafka', 5200], ['The Trial', 'Kafka', 7849], ['Siddhartha', 'Hesse', 2500],
  ['The Idiot', 'Dostoyevsky', 2638], ['The Gambler', 'Dostoyevsky', 2197], ['Poor Folk', 'Dostoyevsky', 2302], ['The Death of Ivan Ilych', 'Tolstoy', 59345, ['The Death of Ivan Ilyich', 'Ivan Ilyitch']], ['Fathers and Sons', 'Turgenev', 30723, ['Fathers and Children']],
  ['Dead Souls', 'Gogol', 1081], ['Swann\'s Way', 'Proust', 7178], ['Père Goriot', 'Balzac', 1237, ['Father Goriot', 'Pere Goriot']], ['The Red and the Black', 'Stendhal', 44747], ['Germinal', 'Zola', 5711],
  ['Candide', 'Voltaire', 19942], ['The Hunchback of Notre Dame', 'Hugo', 2610, ['Notre-Dame de Paris', 'Notre Dame de Paris']], ['The Three Musketeers', 'Dumas', 1257], ['Cyrano de Bergerac', 'Rostand', 1254], ['The Decameron', 'Boccaccio', 23700],
  ['The Sorrows of Young Werther', 'Goethe', 2527], ['Faust', 'Goethe', 14591], ['The Last of the Mohicans', 'Cooper', 27681], ['Around the World in Eighty Days', 'Verne', 103], ['Twenty Thousand Leagues Under the Sea', 'Verne', 164],
  ['A Journey to the Centre of the Earth', 'Verne', 18857], ['The War of the Worlds', 'Wells', 36], ['The Island of Doctor Moreau', 'Wells', 159], ['The Invisible Man', 'Wells', 5230], ['Flatland', 'Abbott', 97],
  ['The Works of Edgar Allan Poe', 'Poe', 2147], ['White Fang', 'London', 910], ['The Sea-Wolf', 'London', 1074], ['Kim', 'Kipling', 2226], ['The Man Who Would Be King', 'Kipling', null, ['The Man Who Would Be King, and Other Stories', 'The Phantom Rickshaw']],
  // Poetry
  ['Songs of Innocence and of Experience', 'Blake', 1934], ['The Rime of the Ancient Mariner', 'Coleridge', 151], ['Poems by Emily Dickinson', 'Dickinson', 12242], ['The Raven', 'Poe', 1065], ['Idylls of the King', 'Tennyson', 610],
  ['Rubáiyát of Omar Khayyám', 'Anonymous', 246, ['Rubaiyat of Omar Khayyam']], ['Beowulf', 'Anonymous', 16328, ['Beowulf: An Anglo-Saxon Epic Poem']], ['The Canterbury Tales', 'Chaucer', 2383], ['The Song of Roland', 'Anonymous', 391], ['The Kalevala', 'Lönnrot', 5186],
  ['The Poems of John Keats', 'Keats', 23684, ['Poems', 'Keats: Poems Published in 1820', 'Endymion']], ['Lyrical Ballads', 'Wordsworth', 9622, ['Lyrical Ballads, 1798', 'Lyrical Ballads, with a Few Other Poems']], ['The Poetical Works of Robert Burns', 'Burns', 18500, ['Poems and Songs of Robert Burns', 'The Complete Works of Robert Burns']], ['The Waste Land', 'Eliot, T. S.', 1321], ['Spoon River Anthology', 'Masters', 1280],
  // Drama
  ['Romeo and Juliet', 'Shakespeare', 1513], ['Macbeth', 'Shakespeare', 1533], ['Othello', 'Shakespeare', 1531], ['The Tempest', 'Shakespeare', 1540], ['A Midsummer Night\'s Dream', 'Shakespeare', 1514],
  ['The Oedipus Trilogy', 'Sophocles', 31], ['Medea', 'Euripides', 35451], ['The Importance of Being Earnest', 'Wilde', 844], ['A Doll\'s House', 'Ibsen', 2542], ['Hedda Gabler', 'Ibsen', 4093],
  ['Doctor Faustus', 'Marlowe', 779], ['Pygmalion', 'Shaw', 3825], ['The Cherry Orchard', 'Chekhov', 7986], ['Tartuffe', 'Molière', 2027], ['Le Morte d\'Arthur', 'Malory', 1251],
  // History and lives
  ['The History of the Decline and Fall of the Roman Empire', 'Gibbon', 25717], ['The History of Herodotus', 'Herodotus', 2707], ['The History of the Peloponnesian War', 'Thucydides', 7142], ['Plutarch\'s Lives', 'Plutarch', 674], ['Commentaries on the Gallic War', 'Caesar', 10657],
  ['Democracy in America', 'Tocqueville', 815], ['Two Years Before the Mast', 'Dana', 2055], ['Up from Slavery', 'Washington, Booker T.', 2376], ['Twelve Years a Slave', 'Northup', 45631], ['Incidents in the Life of a Slave Girl', 'Jacobs', 11030],
  ['The Education of Henry Adams', 'Adams, Henry', 2044], ['Personal Memoirs of U. S. Grant', 'Grant', 4367], ['Autobiography of Andrew Carnegie', 'Carnegie', 17976], ['The Autobiography of Benjamin Franklin', 'Franklin', 20203], ['Life of Johnson', 'Boswell', 1564],
  ['Autobiography of Benvenuto Cellini', 'Cellini', 4028], ['Autobiography', 'Mill, John Stuart', 10378], ['The Autobiography of Charles Darwin', 'Darwin', 2010], ['The Story of My Life', 'Keller', 2397], ['Lives of the Most Eminent Painters', 'Vasari', null],
  ['The Interesting Narrative of the Life of Olaudah Equiano', 'Equiano', 15399], ['Memoirs of General W. T. Sherman', 'Sherman', 4361], ['The Diary of Samuel Pepys', 'Pepys', 4200], ['Eminent Victorians', 'Strachey', 2447], ['The Life of Charlotte Brontë', 'Gaskell', 1827],
  // Ideas
  ['Apology', 'Plato', 1656], ['Symposium', 'Plato', 1600], ['The Enchiridion', 'Epictetus', 45109], ['The Consolation of Philosophy', 'Boethius', 14328], ['Discourse on the Method', 'Descartes', 59],
  ['Leviathan', 'Hobbes', 3207], ['Second Treatise of Government', 'Locke', 7370], ['A Treatise of Human Nature', 'Hume', 4705], ['The Social Contract', 'Rousseau', 46333], ['The Critique of Pure Reason', 'Kant', 4280],
  ['Common Sense', 'Paine', 147], ['Rights of Man', 'Paine', 3742], ['Reflections on the Revolution in France', 'Burke', 15679], ['A Vindication of the Rights of Woman', 'Wollstonecraft', 3420], ['On Liberty', 'Mill, John Stuart', 34901],
  ['Utilitarianism', 'Mill, John Stuart', 11224], ['Beyond Good and Evil', 'Nietzsche', 4363], ['The Problems of Philosophy', 'Russell', 5827], ['Civil Disobedience', 'Thoreau', 71], ['Sesame and Lilies', 'Ruskin', 1293],
  ['The Essays of Francis Bacon', 'Bacon', 575], ['Essays of Elia', 'Lamb', 10343], ['The Communist Manifesto', 'Marx', 61], ['Pragmatism', 'James, William', 5116], ['The Theory of the Leisure Class', 'Veblen', 833],
  // Faith
  ['The King James Bible', 'Anonymous', 10], ['The Imitation of Christ', 'Kempis', 1653], ['The Pilgrim\'s Progress', 'Bunyan', 131], ['The Bhagavad-Gita', 'Anonymous', 2388], ['The Dhammapada', 'Anonymous', 2017],
  ['The Upanishads', 'Anonymous', null], ['The Interior Castle', 'Teresa of Avila', null], ['The Cloud of Unknowing', 'Anonymous', null], ['Revelations of Divine Love', 'Julian of Norwich', null], ['The Book of Tea', 'Okakura', 769],
  // Science
  ['The Voyage of the Beagle', 'Darwin', 944], ['The Chemical History of a Candle', 'Faraday', 14474], ['Micrographia', 'Hooke', 15491], ['Opticks', 'Newton', 33504], ['Relativity: The Special and General Theory', 'Einstein', 30155],
  ['The Notebooks of Leonardo da Vinci', 'Leonardo da Vinci', 5000], ['On the Nature of Things', 'Lucretius', 785], ['Dialogues Concerning Two New Sciences', 'Galilei', 37729], ['The Descent of Man', 'Darwin', 2300], ['An Introduction to Mathematics', 'Whitehead', 41568],
  // Children and the young
  ['Peter Pan', 'Barrie', 16], ['The Wonderful Wizard of Oz', 'Baum', 55], ['The Secret Garden', 'Burnett', 113], ['The Wind in the Willows', 'Grahame', 289], ['The Jungle Book', 'Kipling', 236],
  ['A Christmas Carol', 'Dickens', 46], ['Through the Looking-Glass', 'Carroll', 12], ['Anne of Green Gables', 'Montgomery', 45], ['Little Women', 'Alcott', 514], ['Black Beauty', 'Sewell', 271],
  ['Just So Stories', 'Kipling', 2781], ['The Adventures of Pinocchio', 'Collodi', 500], ['Aesop\'s Fables', 'Aesop', 21], ['Five Children and It', 'Nesbit', 778], ['Heidi', 'Spyri', 1448],
  ['Andersen\'s Fairy Tales', 'Andersen', 1597], ['The Swiss Family Robinson', 'Wyss', null], ['The Merry Adventures of Robin Hood', 'Pyle', 964], ['A Little Princess', 'Burnett', 146], ['The Railway Children', 'Nesbit', 1874],
];
const GUTENDEX = process.env.GUTENDEX || 'https://gutendex.com/books';
function mountReading(app, { db, V, C, isStudio, ledger, fetchImpl }) {
  const { esc, tidy } = V;
  try { db.exec('ALTER TABLE texts ADD COLUMN plates TEXT'); } catch (e) { /* has it */ }
  // Gutendex sits behind a gate that turns a bare server away (403, 24 Oct); the house asks as a browser would, and if
  // the index still refuses, reads Gutenberg's own OPDS search (Atom) instead. The text always comes from gutenberg.org.
  const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 Watermark/1 (+https://watermark.krafftco.com)', 'Accept': 'application/json, text/xml;q=0.9, */*;q=0.5' };
  const doFetch = (u, o) => (fetchImpl || fetch)(u, { signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined, ...(o || {}), headers: { ...UA, ...((o && o.headers) || {}) } });
  const unx = x => String(x || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  async function opds(q) {
    const r = await doFetch(`https://www.gutenberg.org/ebooks/search.opds/?query=${encodeURIComponent(q)}`); if (!r.ok) throw new Error(`gutenberg ${r.status}`);
    const xml = await r.text(); const out = [];
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      const e = m[1]; const id = (e.match(/\/ebooks\/(\d+)/) || [])[1]; if (!id) continue;
      const title = unx((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]).trim(); const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(a => ({ name: unx(a[1]).trim() }));
      const dl = +((e.match(/Downloads:\s*([\d,]+)/) || ['', '0'])[1].replace(/,/g, ''));
      out.push({ id: +id, title, authors, download_count: dl, languages: /<dcterms:language>en<|Language: English/i.test(e) ? ['en'] : [], formats: { 'text/plain; charset=utf-8': `https://www.gutenberg.org/ebooks/${id}.txt.utf-8` } });
    }
    return out;
  }
  const slugify = t => String(t).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'book';
  // Gutenberg's text, cut to the book.
  function strip(raw) {
    let t = String(raw).replace(/\r\n?/g, '\n');
    const a = t.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i); if (a >= 0) t = t.slice(t.indexOf('\n', a) + 1);
    const z = t.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i); if (z >= 0) t = t.slice(0, z);
    t = t.replace(/^\s*Produced by[^\n]*\n(?:[^\n]*\n){0,3}/i, '').replace(/\n{3,}/g, '\n\n\n');
    return t.trim();
  }
  // Chapters: a heading is a short line, alone, that looks like one.
  const HEAD = /^\s*(CHAPTER|BOOK|PART|LETTER|SECTION|CANTO|ACT|VOLUME)\b[^\n]{0,80}$|^\s*[IVXLC]+\.?\s*$|^\s*[IVXLC]+\.\s+[^\n]{1,70}$|^\s*[A-Z][A-Z0-9 ,.'’:;\-]{3,70}$/;
  function chapters(text) {
    const paras = text.split(/\n\s*\n/).map(p => p.replace(/[ \t]+\n/g, '\n').trim()).filter(Boolean);
    const out = []; let cur = { head: null, paras: [] };
    for (const p of paras) {
      const isHead = p.length <= 90 && !/\n/.test(p) && HEAD.test(p) && !/[.!?]\s*$/.test(p.replace(/^\s*[IVXLC]+\.\s*/, '')) && !/^[IVXLC]+\.$/.test(p) ? true : (/^\s*(CHAPTER|BOOK|PART|LETTER)\b/i.test(p) && p.length <= 90 && !/\n/.test(p));
      if (isHead) { if (cur.head || cur.paras.length) out.push(cur); cur = { head: p.replace(/\s+/g, ' '), paras: [] }; } else cur.paras.push(p.replace(/\n/g, ' ').replace(/\s{2,}/g, ' '));
    }
    if (cur.head || cur.paras.length) out.push(cur);
    // Too fine a cut (every capital line a chapter) → merge chapters under 60 words into the one before.
    const merged = []; for (const c of out) { const w = c.paras.join(' ').split(/\s+/).length; if (merged.length && w < 60 && !/^(CHAPTER|BOOK|PART|LETTER)/i.test(c.head || '')) { const last = merged[merged.length - 1]; if (c.head) last.paras.push(c.head); last.paras.push(...c.paras); } else merged.push(c); }
    return merged;
  }
  // Set beautifully (Will, 24 Oct: "format them beautifully"): Gutenberg's typewriter habits become type. Straight quotes
  // curl, two hyphens become an em dash, three dots an ellipsis, _underscored_ words keep their italic as *word*,
  // a shouted heading (CHAPTER IV. THE RIVER) is set in title case, and a line of asterisks or dashes is a section break.
  const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'of', 'in', 'on', 'at', 'to', 'by', 'for', 'with', 'from', 'as', 'is']);
  const titleCase = h => h.split(/((?:[.:;—]|\s-)\s+)/).map((seg, k) => k % 2 ? seg : seg.toLowerCase().replace(/\b([ivxlc]+)\b/g, m => m.toUpperCase()).replace(/(^|[\s(—-])([a-z])([^\s]*)/g, (m, pre, c, rest, off) => { const w = c + rest; return pre + ((off > 0 && SMALL.has(w.replace(/[.,:;]$/, ''))) ? w : c.toUpperCase() + rest); })).join('');
  function polish(t) {
    return String(t)
      .replace(/(^|[\s(\[—])"/g, '$1“').replace(/"/g, '”')
      .replace(/(^|[\s(\[—])'/g, '$1‘').replace(/'/g, '’')
      .replace(/\s*--\s*/g, '—').replace(/\.\.\./g, '…')
      .replace(/(^|[^\w])_([^_\n]{1,200}?)_(?=[^\w]|$)/g, '$1*$2*');
  }
  const toBody = chs => chs.map(c => (c.head ? `## ${/^[A-Z0-9 .,:;'’—-]+$/.test(c.head) && /[A-Z]{3}/.test(c.head) ? titleCase(c.head) : c.head}\n\n` : '') + c.paras.map(p => /^[\s*\-_—·]{3,}$/.test(p) ? '* * *' : polish(p)).join('\n\n')).join('\n\n');
  // A Gutenberg book, by number: metadata from Gutendex, the text from gutenberg.org.
  async function bring(id, { why = null, by = 'the house', meta: given = null } = {}) {
    id = +id; if (!id) throw new Error('a number');
    const had = db.prepare("SELECT slug FROM texts WHERE source LIKE ?").get(`%gutenberg.org/ebooks/${id}%`); if (had) return { slug: had.slug, already: true };
    const rec = given || await meta(id);
    const f = rec.formats || {}; const url = Object.keys(f).filter(k => /^text\/plain/.test(k) && !/\.zip$/.test(f[k])).map(k => f[k]).sort((a, b) => (/utf-8/.test(b) ? 1 : 0) - (/utf-8/.test(a) ? 1 : 0))[0] || `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`;
    const tr = await doFetch(url); if (!tr.ok) throw new Error(`gutenberg ${tr.status}`); const raw = await tr.text();
    const text = strip(raw); if (text.length < 2000) throw new Error('too little text');
    const chs = chapters(text); const body = toBody(chs);
    const author = (rec.authors && rec.authors[0] && rec.authors[0].name) || null; const title = tidy(String(rec.title || `Gutenberg ${id}`).split(/\r?\n/)[0].slice(0, 160));
    let slug = slugify(title); if (db.prepare('SELECT 1 FROM texts WHERE slug=?').get(slug)) slug = `${slug}-${id}`;
    const year = (rec.authors && rec.authors[0] && rec.authors[0].death_year) ? null : null;
    db.prepare("INSERT INTO texts (slug, kind, title, author, year, summary, body, public, price_cents, terms, source, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,'held')").run(slug, 'book', title, author, year, why || `From Project Gutenberg, No. ${id}. Public domain; set by the house.`, body, 1, null, 'Public domain. Read freely; the house asks only that you credit the author.', `https://www.gutenberg.org/ebooks/${id}`);
    try { const SH = require('./shelves'); const sub = { subjects: rec.subjects || [], bookshelves: rec.bookshelves || [] }; db.prepare('UPDATE texts SET subjects=?, shelf=? WHERE slug=?').run(JSON.stringify(sub), SH.classify({ kind: 'book', title, source: `https://www.gutenberg.org/ebooks/${id}`, ...sub }), slug); } catch (e) { /* the shelf can wait */ }
    try { ledger.append(db, 'text.shelved', slug, { title, author, from: 'gutenberg', by }); } catch (e) { /* */ }
    return { slug, title, author, chapters: chs.length, words: body.split(/\s+/).length };
  }
  // A book by title and author: Gutendex's search, the best-taken English edition whose author matches.
  const norm = x => String(x || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  // A book's record by number: Gutendex, else Gutenberg's own page.
  async function meta(id) {
    try { const mr = await doFetch(`${GUTENDEX}/${id}`); if (mr.ok) return await mr.json(); } catch (e) { /* below */ }
    const pr = await doFetch(`https://www.gutenberg.org/ebooks/${id}`); if (!pr.ok) throw new Error(`gutenberg ${pr.status}`); const h = await pr.text();
    return { id, title: unx((h.match(/<meta name="title" content="([^"]*)"/) || h.match(/<title>([^<|]*)/) || ['', `Gutenberg ${id}`])[1]).replace(/\s+by\s+[^|]+$/i, '').trim(), authors: [...h.matchAll(/<a href="\/ebooks\/author\/\d+"[^>]*>([^<]+)</g)].map(m => ({ name: unx(m[1]).replace(/,\s*\d{3,4}-\d{0,4}$/, '').trim() })), formats: { 'text/plain; charset=utf-8': `https://www.gutenberg.org/ebooks/${id}.txt.utf-8` } };
  }
  // The number the house believes, checked against the record before it is trusted.
  async function verify(id, title, author, aliases = []) {
    const m = await meta(id); const sur = norm(author.split(',')[0]).split(' ').pop();
    for (const t of [title, ...(aliases || [])]) { const r = verifyTitle(m, t, author, sur); if (r) return r; }
    return null;
  }
  function verifyTitle(m, title, author, sur) {
    const want = norm(title);
    const stop = new Set(['the', 'a', 'an', 'of']); const core = x => norm(x).split(' ').filter(w => !stop.has(w)).slice(0, 3).join(' ');
    const okT = norm(m.title).includes(want.split(' ').slice(0, 3).join(' ')) || want.includes(norm(m.title).split(' ').slice(0, 3).join(' ')) || (core(want) && norm(m.title).includes(core(want)));
    const okA = anon(author) || (m.authors || []).some(a => norm(a.name).includes(sur));
    return okT && okA ? m : null;
  }
  // Aliases (27 Oct): Gutenberg names a book its own way (Father Goriot; Notre-Dame de Paris; Fathers and Children); each title is tried in turn, and 'Anonymous' asks nothing of the author line.
  const anon = a => /^anonymous$/i.test(String(a || '').trim());
  async function find(title, author, aliases = []) {
    for (const t of [title, ...(aliases || [])]) { const b = await findOne(t, author); if (b) return b; }
    return null;
  }
  async function findOne(title, author) {
    const q = anon(author) ? title : `${title} ${author.split(',')[0]}`; let results = null;
    try { const r = await doFetch(`${GUTENDEX}?search=${encodeURIComponent(q)}&languages=en`); if (r.ok) results = (await r.json()).results || []; } catch (e) { /* the index is down; Gutenberg's own search below */ }
    if (!results) results = await opds(q);
    const j = { results }; const want = norm(title), sur = norm(author.split(',')[0]).split(' ').pop();
    const ok = (j.results || []).filter(b => (anon(author) || (b.authors || []).some(a => norm(a.name).includes(sur))) && norm(b.title).includes(want.split(' ').slice(0, 3).join(' ')) && Object.keys(b.formats || {}).some(k => /^text\/plain/.test(k)));
    ok.sort((a, b) => (b.download_count || 0) - (a.download_count || 0));
    return ok[0] || null;
  }
  const shelvedBy = (title, author, aliases = []) => { const held = db.prepare("SELECT slug, title, author FROM texts WHERE status='held'").all(); const sur = norm(author.split(',')[0]).split(' ').pop(); for (const t of [title, ...(aliases || [])]) { const want = norm(t).slice(0, 18); const h = held.find(h => norm(h.title).startsWith(want) || (h.author && norm(h.author).includes(sur) && norm(h.title).includes(want.split(' ')[0]) && want.split(' ')[0].length > 3)); if (h) return h; } return null; };
  const job = { on: false, at: 0, done: [], missed: [], startedAt: null };
  async function shelveCanon({ by = 'the house' } = {}) {
    if (job.on) return job; job.on = true; job.at = 0; job.done = []; job.missed = []; job.startedAt = new Date().toISOString();
    (async () => {
      for (const [title, author, hint, aliases] of CANON) {
        job.at++; if (shelvedBy(title, author, aliases)) continue;
        try { let b = null; if (hint) { try { b = await verify(hint, title, author, aliases); } catch (e) { b = null; } } if (!b) b = await find(title, author, aliases); if (!b) { job.missed.push(`${title}: not found`); continue; } const r = await bring(b.id, { by, why: `${title}, ${author.split(',').reverse().join(' ').trim()}. One of the first shelf. From Project Gutenberg, No. ${b.id}.`, meta: b.formats ? b : null }); job.done.push(r.title || title); }
        catch (e) { job.missed.push(`${title}: ${e.message}`); }
        await new Promise(r => setTimeout(r, app.locals.noTimers ? 0 : 1500));
      }
      job.on = false;
    })();
    return job;
  }
  app.post('/studio/reading/canon', (req, res) => { if (!isStudio(req)) return res.sendStatus(403); shelveCanon(); res.redirect('/studio/reading?ok=' + encodeURIComponent('The canon is coming in, one book every few seconds. This page shows each as it lands.')); });
  async function search(q) { let results = null; try { const r = await doFetch(`${GUTENDEX}?search=${encodeURIComponent(q)}`); if (r.ok) results = (await r.json()).results || []; } catch (e) { /* below */ } if (!results) results = await opds(q); const j = { results }; return (j.results || []).slice(0, 12).map(b => ({ id: b.id, title: b.title, author: (b.authors[0] || {}).name || '', downloads: b.download_count, languages: b.languages })); }
  // The reader.
  // Authors come from the catalogue as 'Last, First'; the page says them the way a person does.
  const byName = a => { const x = String(a || '').trim(); if (!x) return ''; const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}`.replace(/\s+/g, ' ') : x; };
  const IMPRINT = 'Watermark Publishing';
  // Read next (24 Oct): at the end of a book, two more from the shelf, as objects, the pair chosen by the day.
  function readNext(t) {
    let others = []; try { others = db.prepare("SELECT t.slug, t.title, t.author, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 AND t.id<>? AND (t.body IS NOT NULL OR t.plates IS NOT NULL) ORDER BY t.id").all(t.id); } catch (e) { others = []; }
    if (!others.length) return '';
    const day = Math.floor(Date.now() / 86400e3); const a = others[day % others.length], b = others.length > 1 ? others[(day * 7 + 3) % others.length] : null; const pair = [a, b && b.slug !== a.slug ? b : null].filter(Boolean);
    const SH = require('./shelf');
    return `<div class="rdr-nextbk"><p class="k">Read next</p><div class="rdr-nextrow">${pair.map(x => SH.book(x, `/read/${x.slug}`)).join('')}<div class="rdr-nextt">${pair.map(x => `<a href="/read/${esc(x.slug)}"><b>${esc(tidy(x.title))}</b>${x.author ? `<i>${esc(byName(x.author))}</i>` : ''}</a>`).join('')}</div></div></div>`;
  }
  app.get('/read/:slug', (req, res) => {
    const t = db.prepare("SELECT t.*, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.slug=?").get(String(req.params.slug));
    if (!t || (!t.body && !t.plates) || (!t.public && !isStudio(req)) || t.status !== 'held') return res.sendStatus(404);
    const I = require('./icons');
    const chs = []; let cur = { head: null, paras: [] };
    for (const p of String(t.body || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) { if (/^##?\s/.test(p)) { if (cur.head || cur.paras.length) chs.push(cur); cur = { head: p.replace(/^#+\s*/, ''), paras: [] }; } else cur.paras.push(p); }
    if (cur.head || cur.paras.length) chs.push(cur);
    // A photo book: each plate is a page of its own, the picture alone with its line beneath.
    let plates = []; try { plates = t.plates ? JSON.parse(t.plates) : []; } catch (e) { plates = []; }
    for (const pl of plates) { const w = db.prepare("SELECT slug, title, place, taken_at FROM works WHERE slug=? AND status='held'").get(pl.slug); if (w) chs.push({ head: null, paras: [], plate: { ...w, note: pl.note || '' } }); }
    if (!chs.length) return res.sendStatus(404);
    const asked = /[?&]c=/.test(req.url); const at = Math.max(0, Math.min(chs.length - 1, +(req.query.c || 0) || 0));
    // A book that was sent (sharebook.js): who sent it, the passage they marked, and the keeping on arrival.
    const from = String(req.query.from || '').replace(/[<>]/g, '').trim().slice(0, 40); const q = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 420);
    const me = app.locals.buyerOf ? app.locals.buyerOf(req) : null; let kept = null;
    if (req.query.keep && app.locals.readingList) { if (me) { const r = app.locals.readingList.row(me, t); if (!r) app.locals.readingList.set(me, t, 'want'); kept = (app.locals.readingList.row(me, t) || {}).status || 'want'; } }
    const ok = String(req.query.ok || '');
    const ORN = require('./ornaments');
    const words = String(t.body || '').split(/\s+/).filter(Boolean).length, mins = Math.max(1, Math.round(words / 230));
    const author = byName(t.author); const edition = t.source && /gutenberg/.test(t.source) ? 'The house’s edition, set from the Project Gutenberg text' : t.maker_id ? 'Published by the house' : 'The house’s edition';
    const chapterTitle = (c, i) => c.plate ? (c.plate.title || `Plate ${i + 1}`) : (c.head || (i === 0 ? 'The beginning' : `Part ${i + 1}`));
    res.send(V.layout({ title: `${q ? `“${q.slice(0, 80)}${q.length > 80 ? '…' : ''}” · ` : ''}${t.title} · Watermark`, path: `/read/${t.slug}${q ? `?c=${at}&q=${encodeURIComponent(q)}` : ''}`, desc: q ? `${author ? author + ', ' : ''}${t.title}. Read it in the house, free.` : `${t.title}${author ? ', ' + author : ''}.${t.summary ? ' ' + t.summary : ''} Read it in the house, free, and keep it on your shelf.`, image: `/read/${t.slug}/card.png${q ? `?q=${encodeURIComponent(q)}` : ''}`, type: 'book', bare: true, body: `<main class="rdr${plates.length ? ' rdr-pb' : ''}" data-read='${esc(JSON.stringify({ slug: t.slug, n: chs.length, at, cover: !asked, text: chs.filter(c => !c.plate).length, lang: t.lang || 'en', q: q || '', from: from || '', author, kept: kept || null, me: !!me, facing: !!(app.locals.facing && app.locals.facing.on()), langs: app.locals.facing ? app.locals.facing.LANGS : [] }))}'>
<div class="rdr-prog" aria-hidden="true"><i data-rd-prog style="width:${Math.round(100 * (at + 1) / chs.length)}%"></i></div>
<header class="rdr-bar"><a class="rdr-back" href="/library/${esc(t.slug)}">${I.back}<span>The Library</span></a><p class="rdr-run"><b>${esc(t.title)}</b>${author ? `<span>${esc(author)}</span>` : ''}</p><div class="rdr-ctl"><button type="button" data-rd-share aria-label="Share the book" title="Send the book, or a passage, to someone (S)">${I.share}<span>Share</span></button><button type="button" data-rd-rib aria-pressed="false" aria-label="Ribbon" title="Lay the ribbon here (R)"><span class="rdr-ribg"></span><span>Ribbon</span></button><button type="button" data-rd-toc aria-label="Contents">${I.page}<span>Contents</span></button>${app.locals.facing && app.locals.facing.on() && !plates.length ? `<button type="button" data-rd-facing aria-label="Facing pages: a translation beside the text" title="Facing pages: the book beside its translation, paragraph by paragraph">${I.facing}<span data-rd-facing-word>Facing</span></button>` : ''}<button type="button" data-rd-mode aria-label="Pages or scroll">${I.full}<span>Pages</span></button><button type="button" data-rd-size="-" aria-label="Smaller">A−</button><button type="button" data-rd-size="+" aria-label="Larger">A+</button><button type="button" data-rd-theme aria-label="Paper, sepia or night">${I.dial || ''}<span>Light</span></button></div></header>
${app.locals.facing && app.locals.facing.on() && !plates.length ? `<nav class="rdr-fmenu" data-rd-fmenu hidden><p class="k">Facing pages</p><p class="rdr-fm-l">The book on one page, its translation on the other, paragraph beside paragraph. Read one and glance at the other: the oldest way to learn a language. The translation is the house’s, made with AI the first time anyone asks, and says so.</p><div class="rdr-fm-langs">${app.locals.facing.LANGS.filter(([k]) => k !== (t.lang || 'en')).map(([k, n]) => `<button type="button" data-rd-lang="${k}">${esc(n)}</button>`).join('')}</div><p class="rdr-fm-foot"><button type="button" data-rd-lang="">Just the book</button> · <button type="button" data-rd-swap>Swap the pages</button></p></nav>` : ''}<aside class="rdr-sh" data-rd-share-sheet hidden><button type="button" class="rdr-sh-x" data-rd-share-close aria-label="Close">${I.close}</button><p class="k">Share the book</p><div class="rdr-sh-card"><div class="rdr-sh-bk">${t.cover ? `<img src="/img/${esc(t.cover)}/screen" alt="">` : require('./binding').svg(t, { w: 120 })}</div><div class="rdr-sh-t"><h2>${esc(t.title)}</h2>${author ? `<p>${esc(author)}</p>` : ''}<p class="rdr-sh-l">Free, in the house. Whoever opens it may keep it on their shelf.</p></div></div><blockquote class="rdr-sh-q" data-rd-sh-q hidden></blockquote><p class="rdr-sh-acts"><button type="button" class="buy-btn" data-rd-sh-send>${I.share}<span>Send it</span></button><button type="button" data-rd-sh-copy>${I.page}<span>Copy the link</span></button><button type="button" data-rd-sh-unquote hidden>Just the book</button></p><form class="rdr-sh-mail" method="post" action="/read/${esc(t.slug)}/send" data-rd-sh-mail><p class="k">Or by letter, from the house</p>${me || isStudio(req) ? `<label><span>To</span><input type="email" name="to" required placeholder="their address" autocomplete="off"></label><label><span>A note, in your words</span><textarea name="note" rows="3" maxlength="600" placeholder="Why this one."></textarea></label><input type="hidden" name="q" data-rd-sh-qf><input type="hidden" name="c" data-rd-sh-cf value="${at}"><button type="submit" class="buy-btn">Send the letter</button><p class="rdr-sh-fine">The house writes it: the book on its card, your note, and one tap that keeps it on their shelf.</p>` : `<p class="rdr-sh-fine"><a href="/signin?next=${encodeURIComponent(`/read/${t.slug}`)}">Sign in</a> and the house will write the letter for you: the book on its card, your note, one tap that keeps it on their shelf.</p>`}</form></aside><button type="button" class="rdr-qp" data-rd-qp hidden>${I.share}<span>Share this passage</span></button>
<nav class="rdr-toc" data-rd-toc-panel hidden><p class="k">Contents · ${chs.length}</p><ol>${chs.map((c, i) => `<li><a href="?c=${i}" data-c="${i}"${i === at ? ' aria-current="page"' : ''}>${esc(chapterTitle(c, i))}</a></li>`).join('')}</ol><p class="rdr-src">${words ? `${esc(words.toLocaleString('en-US'))} words · about ${mins} min` : `${plates.length} plates`}${t.source ? ` · <a href="${esc(t.source)}" rel="noopener">the source</a>` : ''} · ${esc(t.terms || 'Public domain')}</p></nav>
<section class="rdr-cover" data-rd-cover${asked ? ' hidden' : ''}>${t.cover ? `<figure class="rdr-cover-pic"><img src="/img/${esc(t.cover)}/large" alt=""></figure>` : `<figure class="rdr-cover-pic rdr-cover-bound">${require('./binding').svg(t, { w: 360 })}</figure>`}<div class="rdr-cover-t">${from ? `<p class="rdr-sent"><span class="rdr-sent-w">${I.wave}</span>${esc(from)} sent you this book.${kept ? ` <b>On your shelf.</b>` : (req.query.keep ? ` <a href="/signin?next=${encodeURIComponent(`/read/${t.slug}?keep=1&from=${encodeURIComponent(from)}`)}&why=shelf">Keep it on your shelf</a>` : '')}</p>` : (kept ? `<p class="rdr-sent"><span class="rdr-sent-w">${I.wave}</span><b>On your shelf.</b></p>` : (ok === 'sent' ? `<p class="rdr-sent"><span class="rdr-sent-w">${I.wave}</span><b>Sent.</b> The house has written the letter.</p>` : ''))}<p class="k">${esc(IMPRINT)}</p><h1>${esc(t.title)}</h1>${author ? `<p class="rdr-cover-by">${esc(author)}</p>` : ''}${(app.locals.jacket && app.locals.jacket.line(t)) || t.summary ? `<p class="rdr-cover-line">${esc((app.locals.jacket && app.locals.jacket.line(t)) || t.summary)}${app.locals.jacket && app.locals.jacket.line(t) ? ` <a class="rdr-cover-jk" href="/library/${esc(t.slug)}">About this book</a>` : ''}</p>` : ''}<p class="rdr-cover-meta">${plates.length ? `${plates.length} plates${chs.length > plates.length ? ` · ${chs.length - plates.length} chapter${chs.length - plates.length === 1 ? '' : 's'}` : ''}` : `${chs.length} chapter${chs.length === 1 ? '' : 's'}`}${words ? ` · about ${mins} minute${mins === 1 ? '' : 's'}` : ''} · ${esc(t.terms || 'Public domain')}</p><button type="button" class="buy-btn" data-rd-begin>Begin</button><button type="button" class="rdr-cover-rib" data-rd-torib hidden><span class="rdr-ribg"></span>Go to the ribbon</button>${app.locals.facing && app.locals.facing.on() && !plates.length ? `<p class="rdr-cover-face"><span>Or read it facing a translation, to learn the language:</span> ${app.locals.facing.LANGS.filter(([k]) => k !== (t.lang || 'en')).slice(0, 6).map(([k, n]) => `<button type="button" data-rd-lang="${k}">${esc(n)}</button>`).join(' · ')} · <button type="button" data-rd-facing>more</button></p>` : ''}<p class="rdr-cover-ed">${esc(edition)}.</p>${app.locals.readingList ? app.locals.readingList.buttons(req, t, { back: `/read/${t.slug}` }) : ''}</div></section>
<div class="rdr-head" aria-hidden="true"><span data-rd-head-l>${esc(t.title)}</span><span data-rd-head-r></span></div><p class="rdr-foot-no" aria-hidden="true" data-rd-foot></p>
<article class="rdr-page" data-rd-page>${chs.map((c, i) => `<section class="rdr-ch${c.plate ? ' rdr-plate' : ''}" data-ch="${i}"${i === at && asked ? '' : ' hidden'}>${c.plate ? `<figure class="rdr-pl"><img src="/img/${esc(c.plate.slug)}/large" alt="${esc(c.plate.title || '')}" loading="lazy"><figcaption><b>${esc(c.plate.title || '')}</b>${c.plate.place ? `<span>${esc(c.plate.place)}</span>` : ''}${c.plate.note ? `<p>${esc(c.plate.note)}</p>` : ''}</figcaption></figure>` : (c.head ? `${ORN.headpiece(t)}<p class="rdr-no">${i === 0 && chs.length > 1 && !/\d|[IVXLC]/.test(c.head) ? '' : `${i + 1} of ${chs.length}`}</p><h2>${esc(c.head)}</h2>` : (i === 0 ? `${ORN.headpiece(t)}<h1 class="rdr-title">${esc(t.title)}</h1>${author ? `<p class="rdr-author">${esc(author)}</p>` : ''}` : `<p class="rdr-no">${i + 1} of ${chs.length}</p>`))}${c.paras.map((p, j) => p === '* * *' ? '<p class="rdr-break" aria-hidden="true">⁂</p>' : `<p${j === 0 ? ' class="rdr-first"' : ''}>${esc(p).replace(/\*([^*\n]{1,200}?)\*/g, '<em>$1</em>')}</p>`).join('')}${c.plate ? '' : `<p class="rdr-orn" aria-hidden="true">${ORN.tailpiece(t)}</p>`}<footer class="rdr-foot">${i > 0 ? `<a href="?c=${i - 1}" data-c="${i - 1}" class="rdr-prev">← ${esc(chapterTitle(chs[i - 1], i - 1))}</a>` : '<span></span>'}${i < chs.length - 1 ? `<a href="?c=${i + 1}" data-c="${i + 1}" class="rdr-next">${esc(chapterTitle(chs[i + 1], i + 1))} →</a>` : `<a href="/library" class="rdr-next">The end. The Library →</a>`}</footer>${i === chs.length - 1 ? `<aside class="rdr-colophon"><p class="k">Colophon</p><p>${esc(t.title)}${author ? `, by ${esc(author)}` : ''}. ${esc(edition)}, in Newsreader, for the house’s reading room. ${esc(t.terms || 'Public domain')}: read it freely, keep it, pass it on.</p><p><a href="/read/${esc(t.slug)}.pdf">The book, set for paper (PDF)</a> · <a href="/publishing">${esc(IMPRINT)}</a> · <a href="/library">The Library</a></p>${readNext(t)}</aside>` : ''}</section>`).join('')}</article>
<button type="button" class="rdr-turn rdr-turn-l" data-rd-turn="-1" aria-label="Previous page" hidden></button><button type="button" class="rdr-turn rdr-turn-r" data-rd-turn="1" aria-label="Next page" hidden></button>
</main><script src="/static/read.js?v=${esc(V.VER)}" defer></script>` }));
  });
// Watermark Publishing (Will, 24 Oct: "we need to make Krafft Publishing or Watermark Publishing"; "books and photo
  // books, for sale and also available"): the house's imprint. Three shelves: the public domain, set beautifully and
  // free; the house's editions and the work of its writers, priced or free as the author says; photo books, a maker's
  // sequence of held work with a line on each, made from a wall. Every word a draft for Will.
  app.get('/publishing', (req, res) => {
    const all = db.prepare("SELECT t.*, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.status='held' AND t.public=1 ORDER BY t.id DESC").all();
    const pd = all.filter(t => t.kind === 'book' && (!t.price_cents) && /gutenberg|public domain/i.test(`${t.source || ''} ${t.terms || ''}`)), pbs = all.filter(t => t.kind === 'photobook'), eds = all.filter(t => !pd.includes(t) && !pbs.includes(t));
    const FEE = require('./fee');
    const card = t => `<a class="pub-card" href="${t.kind === 'photobook' || (t.body && !t.file) ? `/read/${esc(t.slug)}` : `/library/${esc(t.slug)}`}">${t.cover ? `<img src="/img/${esc(t.cover)}/screen" alt="" loading="lazy">` : `<span class="pub-spine"><b>${esc(t.title)}</b></span>`}<span class="pub-t"><b>${esc(t.title)}</b>${t.author ? `<i>${esc(byName(t.author))}</i>` : ''}<small>${t.price_cents ? V.money(t.price_cents) : 'Free'}</small></span></a>`;
    const shelf = (k, h, line, list, more) => `<section class="pub-shelf"><header><p class="k">${k}</p><h2>${h}</h2><p class="lede">${line}</p></header>${list.length ? `<div class="pub-row">${list.slice(0, 12).map(card).join('')}</div>` : `<p class="note">${more}</p>`}</section>`;
    const SHELF = require('./shelf'); const hero = SHELF.band({ books: [...pbs, ...eds, ...pd].slice(0, 8), href: t => t.kind === 'photobook' || (t.body && !t.file) ? `/read/${t.slug}` : `/library/${t.slug}`, k: 'Watermark Publishing', line: 'Publish with the house.', act: { href: '#publish', text: 'How it works' } });
    res.send(V.layout({ title: 'Watermark Publishing', path: '/publishing', desc: 'The house’s imprint: the public domain set beautifully and free, the house’s editions, and photo books made from the work it holds.', body: `<section class="pub">${hero}<header class="pub-h"><p class="k">The house’s imprint</p><h1>Watermark Publishing.</h1><p class="lede">Books set the way a great library would set them, read in a room made for reading. The public domain, free to all; the house’s own editions; and photo books made from the work the house holds. ${FEE.yours(85, 'the author’s').replace(/^the/, 'The')}.</p></header>
${shelf('The first shelf', 'The public domain.', 'The books a curious person is handed first, brought in from the public record, the boilerplate cut away, the chapters found, and set in the reading room. Free, always.', pd, 'The first shelf is being set. Come back in an hour.')}
${shelf('Photo books', 'A sequence, with a line on each.', 'A maker’s photographs in the order they chose, each with its words, read a plate at a time. Made from a wall in the house.', pbs, 'The first photo book is being made.')}
${shelf('Editions', 'The house’s own.', 'Essays, journals and books from the house and its writers. Priced as the author says, or free.', eds, 'Nothing yet beyond the public domain.')}
<section class="pub-for" id="publish"><h2>Publish with the house.</h2><p>Writers and photographers publish here by invitation, as makers do. A book is held like a photograph: deeded, entered on the register, yours. Read it in the room, sell it from the Library, keep every dollar of the price. <a href="/join">Apply with the work</a>, or write to the house.</p><p><a class="buy-btn" href="/bookshop">The Bookshop: first editions, signed copies, reprints</a></p></section></section>` }));
  });
  // A photo book from a wall: the wall's works in its order, each with its line, the first as the cover.
  app.post('/studio/publishing/photobook', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    const b = req.body || {}; const h = db.prepare('SELECT * FROM hangs WHERE slug=?').get(String(b.hang || '').trim());
    if (!h) return res.redirect('/studio/reading?ok=' + encodeURIComponent('No wall by that address.'));
    const rows = db.prepare('SELECT w.slug, hw.note FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? AND w.status=\'held\' ORDER BY hw.pos, hw.rowid').all(h.id);
    if (!rows.length) return res.redirect('/studio/reading?ok=' + encodeURIComponent('That wall holds nothing shown.'));
    const title = String(b.title || h.title).trim().slice(0, 160); let slug = slugify(title); if (db.prepare('SELECT 1 FROM texts WHERE slug=?').get(slug)) slug = `${slug}-${Date.now().toString(36)}`;
    const cover = db.prepare('SELECT id FROM works WHERE slug=?').get(rows[0].slug);
    const author = String(b.author || '').trim().slice(0, 120) || null; const price = b.price ? Math.round(parseFloat(b.price) * 100) || null : null;
    db.prepare("INSERT INTO texts (slug, kind, title, author, summary, body, public, price_cents, terms, source, cover_work_id, status, plates) VALUES (?,?,?,?,?,?,?,?,?,?,?,'held',?)").run(slug, 'photobook', title, author, String(b.line || h.line || '').trim().slice(0, 400) || null, String(b.body || '').trim() || null, 1, price, 'All rights reserved', `/hang/${h.slug}`, cover ? cover.id : null, JSON.stringify(rows.map(r => ({ slug: r.slug, note: r.note || '' }))));
    try { ledger.append(db, 'text.shelved', slug, { title, kind: 'photobook', from: 'wall', plates: rows.length }); } catch (e) { /* */ }
    res.redirect(`/read/${slug}`);
  });
  // The Studio: the public domain comes in.
  app.get('/studio/reading', async (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403); V.setDeskPath('/studio/reading');
    let found = [], err = null; if (req.query.q) { try { found = await search(String(req.query.q)); } catch (e) { err = e.message; } }
    const have = db.prepare("SELECT slug, title, author, source FROM texts WHERE source LIKE '%gutenberg.org%' ORDER BY id DESC").all();
    const shelved = t => have.find(h => h.title.toLowerCase().startsWith(t.title.toLowerCase().slice(0, 18)) || (h.author && t.author && h.author.toLowerCase().split(',')[0] === t.author.toLowerCase().split(',')[0] && h.title.toLowerCase().includes(t.title.toLowerCase().split(' ').slice(-2).join(' '))));
    res.send(V.layout({ title: 'The public domain · Watermark', studio: true, body: `<section class="studio-wrap pd"><p class="k">The Library</p><h1>The public domain.</h1>
<p class="lede">The greatest shelf in the world sits in plain text behind a bad viewer. Bring a book in by its Project Gutenberg number or a search; the house cuts the boilerplate away, finds the chapters, and sets it in the reading room at <code>/read/&lt;slug&gt;</code>, free, credited to its author. Gutenberg’s own index is read through Gutendex.${req.query.ok ? ` <b>${esc(String(req.query.ok))}</b>` : ''}${err ? ` <b class="err">${esc(err)}</b>` : ''}</p>
<form method="get" class="cl-f pd-s"><label><span>Search Gutenberg</span><input name="q" value="${esc(String(req.query.q || ''))}" placeholder="a title, an author"></label><button class="buy-btn">Look</button></form>
<form method="post" action="/studio/reading/bring" class="cl-f pd-s"><label><span>Or a Gutenberg number</span><input name="id" inputmode="numeric" placeholder="20203"></label><button class="buy-btn">Bring it in</button></form>
${found.length ? `<table class="tbl"><tr><th>Title</th><th>Author</th><th>Taken</th><th></th></tr>${found.map(b => `<tr><td>${esc(b.title)}</td><td>${esc(b.author)}</td><td>${(b.downloads || 0).toLocaleString('en-US')}</td><td><form method="post" action="/studio/reading/bring"><input type="hidden" name="id" value="${b.id}"><button class="link">Bring in No. ${b.id}</button></form></td></tr>`).join('')}</table>` : ''}
<h2>A photo book from a wall</h2><form method="post" action="/studio/publishing/photobook" class="cl-f pd-s"><label><span>The wall’s address (its slug)</span><input name="hang" placeholder="the-great-rooms"></label><label><span>Title (else the wall’s)</span><input name="title"></label><label><span>By</span><input name="author" placeholder="Will Fullerton"></label><label><span>Price, $ (blank: free)</span><input name="price" inputmode="decimal" placeholder="25"></label><label><span>A line</span><input name="line"></label><button class="buy-btn">Make the book</button></form>
<h2>The first shelf</h2><p class="note">${CANON.length} books a curious person is handed first. ${job.on ? `Coming in now: ${job.at} of ${CANON.length} looked at, ${job.done.length} shelved${job.missed.length ? `, ${job.missed.length} not found` : ''}.` : `<form method="post" action="/studio/reading/canon" style="display:inline"><button class="buy-btn">Shelve the canon</button></form> Each is found on Gutenberg by title and author; already-shelved books are skipped.`}</p>
${job.missed.length ? `<p class="note">Not found: ${job.missed.map(esc).join(' · ')}</p>` : ''}
<table class="tbl"><tr><th>Book</th><th></th></tr>${CANON.map(([t, a, , al]) => { const h = shelvedBy(t, a, al); return `<tr><td><b>${esc(t)}</b> <small>${esc(a)}</small></td><td>${h ? `<a href="/read/${esc(h.slug)}">On the shelf</a>` : '<small>Not yet</small>'}</td></tr>`; }).join('')}</table>
<h2>Franklin’s shelf</h2><p class="note">The books Franklin names in the Autobiography as the ones that made him, and his own. Each press searches Gutenberg by title and author and shows what it finds; the house never guesses a number.</p>
<table class="tbl"><tr><th>Book</th><th>Why</th><th></th></tr>${FRANKLIN.map(b => { const h = shelved(b); return `<tr><td><b>${esc(b.title)}</b><br><small>${esc(b.author)}</small></td><td><small>${esc(b.why)}</small></td><td>${h ? `<a href="/read/${esc(h.slug)}">On the shelf</a>` : `<a href="?q=${encodeURIComponent(b.title + ' ' + b.author.split(',')[0])}">Find it</a>`}</td></tr>`; }).join('')}</table>
${have.length ? `<h2>On the shelf from Gutenberg</h2><ul>${have.map(h => `<li><a href="/read/${esc(h.slug)}">${esc(h.title)}</a>${h.author ? ` <small>${esc(h.author)}</small>` : ''}</li>`).join('')}</ul>` : ''}</section>` }));
  });
  app.post('/studio/reading/bring', async (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    try { const r = await bring(req.body.id, { by: 'the house' }); res.redirect('/studio/reading?ok=' + encodeURIComponent(r.already ? 'Already on the shelf.' : `${r.title} is on the shelf: ${r.chapters} chapters, ${r.words.toLocaleString('en-US')} words.`)); }
    catch (e) { res.redirect('/studio/reading?ok=' + encodeURIComponent('Could not bring it in: ' + e.message)); }
  });
  app.locals.reading = { bring, search, strip, chapters, find, verify, meta, shelveCanon, job, polish, titleCase, FRANKLIN, CANON };
  return app.locals.reading;
}
module.exports = { mountReading, FRANKLIN, CANON };
