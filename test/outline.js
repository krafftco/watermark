// A book of numbered notes (#35, #40): Leonardo's Notebooks, set by its own structure. The fixture is a made-up book
// built from the real lines of Richter's edition as the live page showed them (13–14 Nov), shaped as the house stored
// it: old '## ' heads at the wrong places, each volume's contents (numeral, title, synopsis), sections with a plain and
// with an underscored numeral, parts restarting in each section, bare range lines, line-notes that begin with a number,
// a footnote left unclosed, manuscript lines with and without spaces, bracketed titles, and the second volume's title
// page and contents between two notes.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const OL = require('../src/outline');
const fill = (a, b, skip = []) => { const o = []; for (let n = a; n <= b; n++) { if (skip.includes(n)) continue; o.push(`${n}.`, `The text of note ${n}, in Leonardo's words, with (brackets) and dashes—as the source has them.`); } return o; };
const IX_SYN = "I. MORAL PRECEPTS FOR THE STUDENT OF PAINTING.—How to ascertain the dispositions for an artistic career (482).—The course of instruction for an artist (483—485).—The study of the antique (486. 487).—Industry and thoroughness the first conditions (491—493.)—II. THE ARTIST'S STUDIO.—The size of figures in a picture (538. 539).—The right position of the artist, when painting and of the spectator (540—547).—III. THE PRACTICAL METHODS OF LIGHT AND SHADE AND AERIAL PERSPECTIVE.—Gradations of light and shade (548).—On the choice of light for a picture (549—554).—The distribution of light and shade (555—559).—The juxtaposition of light and shade (560. 561).—IV. OF PORTRAIT AND FIGURE PAINTING.—Of sketching figures and portraits (571. 572).—The position of the head (573).—VI. THE ARTIST'S MATERIALS.—On chemical _materials (638—650).—VII. PHILOSOPHY AND HISTORY OF THE ART OF PAINTING.—The relation of art and nature (651. 652).—The painter's scope (662).";
const body = [
  'The Notebooks of Leonardo da Vinci, compiled and edited from the original manuscripts by Jean Paul Richter.',
  'Volume 1',
  'PREFACE.',
  'A few conventions thus adopted (to keep the reader from doubt)—and some dashes—are explained here.',
  // Volume 1's contents: section I's synopsis opens with its title in capitals; the others numeral, title, synopsis.
  'CONTENTS OF VOLUME I.',
  "PROLEGOMENA AND GENERAL INTRODUCTION TO THE BOOK ON PAINTING.—The author's intention to publish his MSS. (1).—The preparation of the MSS. for publication (2).—Admonition to readers (3).—The disorder in the MSS. (4).—Suggestions for the arrangement of MSS. treated of in this division (5—8).",
  'II.', '## Linear Perspective',
  'General introduction (40).—The function of the eye (41—45).—Definition of perspective (46—49).—The perception of the object depends on the direction of the eye (50).',
  'III.', 'Six Books on Light and Shade.', 'General introduction (110).—Prolegomena (111).—Scheme of the books on light and shade (112).—Different principles and plans of treatment (113—116).',
  'IV.', 'Perspective of Disappearance.', 'Definition (222).—An illustration by experiment (223).—A guiding rule (224).—An experiment (225).',
  'V.', 'Theory of colours.', 'The reciprocal effects of colours on objects placed opposite each other (263—271).—Combination of different colours in cast shadows (279. 280).—The effect of colours in the camera obscura (281—283).—On the colours of derived shadows (284).',
  'VI.', "'Prospettiva de' colri' (Perspective of Colour) and Aerial Perspective.", 'General rules (289—291).—An exceptional case (292).—An experiment (293).—The practice of the Perspective of Colour (294—300).',
  'VII.', 'On the Proportions and on the Movements of the Human Figure.', 'Preliminary observations (308).—Proportions of the head and face (310—318).—Proportions of the arm (350—361).—The movement of the arm (362).',
  'VIII.', 'Botany for Painters and Elements of Landscape Painting.', 'Classification of trees (393).—The relative position of leaves (394—400).—Light and shade on groups of trees (453—457).—On the treatment of light for landscapes (458—470).',
  'IX.', '## The Practice of Painting', IX_SYN,
  'X.', 'Studies and Sketches for Pictures and Decorations.', 'On pictures of the Madonna (663).—Bernardo di Bandino\'s portrait (664).—Notes on the Last Supper (665—668).—On the battle of Anghiari (669).',
  // The body. Section I has no numeral of its own; its first topic was taken for a chapter head on import.
  "## The Author's Intention to Publish His Mss",
  ...fill(1, 11),
  '12.', 'The text of note 12.', '[Footnote: In the original the lines run on the margin.]', '13. From the character of the writing it may be inferred that this was written at Milan.',
  ...fill(13, 14), '15. A note whose number was joined to its line, as the source has it in a few places.', ...fill(16, 28, [20]),
  '29.', 'Let the object in relief t be seen by both eyes; if you will look at the object with the right eye only, keeping the left eye shut, the object will appear in the space a.',
  '[Footnote: In the sketch, m is the left eye and n the right eye.]',
  '30.', 'The comparative size of the image depends on the amount of light (30-39).', 'The eye will hold and retain in itself the image of a luminous body better than that of a shaded object.',
  ...fill(31, 39),
  // II: a plain numeral; Richter's italic introduction across two paragraphs.
  'II.', 'Linear Perspective.', "_Leonardo's theory of perspective is set out here in two paragraphs of Richter's, the italic", 'running across both of them, as the source has it._',
  '40.', 'The text of note 40.', '[Footnote: Compare the diagram.]', '40. Compare 53, 2.', ...fill(41, 60),
  // III: a numeral with a leading underscore, as the source has XIII and XVI.
  // III (#59, the real sequence): a note with a capital heading and its text, then the bare numeral, then the title.
  '109.', 'OF A MIXTURE OF NATURAL AND ARTIFICIAL PERSPECTIVE.', 'This diagram distinguishes natural from artificial perspective.',
  'III.', 'Six books on Light and Shade.', '_Linear Perspective cannot be immediately followed by the books on light and shade.', 'and its second paragraph._', ...fill(110, 125),
  'IV.', 'Perspective of Disappearance.', ...fill(222, 230),
  // V: bare range lines; "(281-283)." opens 281 and 283, 282 keeps its own line.
  'V.', 'Theory of colours.', ...fill(263, 278),
  '(279. 280).', 'OF THE COLOURS OF SHADOWS.', 'The text of notes 279 and 280.',
  '(281-283).', 'OF THE CAMERA OBSCURA.', 'The text of note 281.', '282.', 'The text of note 282.', ...fill(284, 288),
  // VI: a range written backwards before its note: nothing is missing, so it stays a line.
  'VI.', "'Prospettiva de' colri' (Perspective of Colour) and Aerial Perspective.", ...fill(289, 297), '(298—290).', ...fill(298, 300),
  'VII.', 'On the Proportions and on the Movements of the Human Figure.', ...fill(308, 313), ...fill(315, 318), ...fill(350, 354),
  '(355-361).', 'OF THE ARM.', 'The text that opens at 355.', '357.', 'The text of note 357.', ...fill(358, 362),
  // VIII: a topic whose later numbers have no line of their own.
  'VIII.', 'Botany for Painters and Elements of Landscape Painting.', ...fill(393, 400),
  'Light and shade on groups of trees (453-457).', '453.', 'OF TREES IN LIGHT.', 'The text of note 453, which runs on.', 'OF TREES IN SHADOW.', 'More of note 453.', ...fill(458, 470),
  // IX: parts I, II, III, IV; part III after two notes with capital headings and a footnote left unclosed.
  'IX.', 'The Practice of Painting.', "_Leonardo's precepts for the painter, gathered by Richter._",
  'I.', 'MORAL PRECEPTS FOR THE STUDENT OF PAINTING.', 'How to ascertain the dispositions for an artistic career (482).', ...fill(482, 493),
  'II.', "THE ARTIST'S STUDIO.", ...fill(538, 543),
  '544.', 'OF THE LIGHT IN THE STUDIO.', 'The text of note 544.',
  '545.', 'OF THE WINDOW.', 'The text of note 545.', '[Footnote: Compare the drawing on Pl. XXXI, No. 1; the bracket was never closed in the source',
  '546.', 'OF THE SIZE OF THE STUDIO.', 'The text of note 546.', '547.', 'OF THE PLACE OF THE SPECTATOR.', 'The text of note 547.',
  'III.', 'THE PRACTICAL METHODS OF LIGHT AND SHADE AND AERIAL PERSPECTIVE.', 'Gradations of light and shade.',
  '548.', 'OF PAINTING: OF THE DARKNESS OF THE SHADOWS, OR I MAY SAY, THE BRIGHTNESS OF THE LIGHTS.', 'Although practical painters attribute to all shaded objects—trees, fields, hair, beards and skin—four degrees of darkness in each colour they use.',
  'On the choice of light for a picture (549-554).',
  '549.', 'HOW THE PAINTER MUST PLACE HIMSELF WITH REFERENCE TO THE LIGHT, TO GIVE THE EFFECT OF RELIEF.', 'Let a b be the window, m the point of light.',
  '## From Whence to Depict a Landscape',
  '550.', 'THAT SHADOWS CAST BY A PARTICULAR LIGHT SHOULD BE AVOIDED.', 'The shadows cast by the sun or any other particular light have not a pleasing effect.',
  '551.', 'The text of note 551.',
  '552.', 'OF HELPING THE APPARENT RELIEF OF A PICTURE BY GIVING IT ARTIFICIAL LIGHT AND SHADE.', 'To increase relief of a picture you may place a strip of light.', '[Footnote 6: Compare the two diagrams under No. 565.]',
  '553.', 'OF SITUATION.', 'The text of note 553.', '554.', 'The text of note 554.', '555.', 'The text of note 555.',
  'The distribution of light and shade (556-559)', '556.', 'OF SHADOWS ON BODIES.', 'The text of note 556.', ...fill(557, 559),
  'IV.', 'OF PORTRAIT AND FIGURE PAINTING.', ...fill(571, 575),
  // X: a line-note after a footnote, with the next note's number.
  'X.', 'Studies and Sketches for Pictures and Decorations.', ...fill(663, 667),
  '668.', 'The text of note 668.', '[Footnote: The drawing is at Windsor.]', '669. This passage does not occur in the Codex.', ...fill(669, 670), ...fill(700, 705),
  // Volume 2's title page and contents, between notes 705 and 707 (no "Contents" line of its own).
  'Volume 2',
  'THE NOTEBOOKS OF LEONARDO DA VINCI. VOLUME 2.',
  'XI.', 'The notes on Sculpture.', 'Compositions for the monument to Francesco Sforza (707—709).—Notes on the casting (710—715).',
  'XII.', 'Architectural Designs.', 'Plans for towns (741—744).—Plans for canals (745—750).',
  'XIII.', 'Theoretical writings on Architecture.', 'I. ON FISSURES IN WALLS.—Of cracks in walls (770—773).—Of the stability of buildings (774).',
  'XIV.', 'Anatomy, Zoology and Physiology.', 'Plans of anatomical studies (796—800).',
  'XV.', 'Astronomy.', 'The earth as a planet (857—860).',
  'XVI.', 'Physical Geography.', 'I. INTRODUCTION.—The nature of water (919).—II. OF THE OCEAN.—The tides (920—925).',
  'XVII.', 'Topographical Notes.', 'Notes on Italy (1001—1005).',
  'XVIII.', 'Naval Warfare.—Mechanical Appliances.—Music.', 'Naval warfare (1113—1116).',
  'XIX.', 'Philosophical Maxims. Morals. Polemics and Speculations.', 'Philosophical maxims (1132—1135).',
  'XX.', 'Humorous Writings.', 'I. STUDIES ON THE LIFE AND HABITS OF ANIMALS.—The cardinal virtues (1220—1222).—III. JESTS AND TALES.—A jest (1280).—IV. PROPHECIES.—Of dreaming (1293).',
  'XXI.', 'Letters. Personal Records. Dated Notes.', 'Drafts of letters (1336—1347).',
  'XXII.', 'Miscellaneous Notes.', 'Miscellaneous notes (1379—1566).',
  'XI.', 'The notes on Sculpture.', '707.', 'The text of note 707.', ...fill(708, 715), 'HENRY DE GEYMULLER.',
  'XI.', 'This numeral is not a section: XI is already open.',
  'XII.', 'Architectural Designs.', '_Richter on the designs, an italic that closes', 'later, on piers._',
  'I. Plans for towns.', 'II. Plans for canals.', 'III. Castles and Villas.', 'IV. Ecclesiastical Architecture.', 'V. Palace architecture.', ...fill(741, 750),
  '_XIII.', 'Theoretical writings on Architecture.', "Leonardo's original writings on the theory of Architecture have come down to us only in a fragmentary state;_", '_The small number of chapters given under the fifth class is part of the plan._',
  'I.', 'ON FISSURES IN WALLS.',
  '770.', 'First write the treatise on the causes of the giving way of walls and then, separately, treat of the remedies.', '[Footnote: See Pl. CIV.]',
  '771.', 'The cracks in walls will never be parallel unless the part of the wall that separates remains vertical.', 'WHAT IS THE LAW BY WHICH BUILDINGS HAVE STABILITY.', 'The stability of a building is the result of the contrary law.',
  '[Footnote: Lines 1-5 refer to Pl. CV, No. 2. Line 9 alle due anteciedete, see on the same page.', 'Lines 16-18. The translation of this is doubtful.', 'Lines 19-23 are on the right hand margin close to the two sketches on Pl. CII, No. 3.]',
  '## C. A. 117a; 361a]',
  '772.', 'Why a wall gives way.', '1. That which gets wet increases in proportion to the moisture it imbibes.', '2. And a wet object shrinks, while drying, in proportion to the evaporation.',
  '[Footnote: The text of this passage is reproduced in facsimile on Pl. CVI to the left.]', 'C.A. 172b; 516b]',
  '773.', 'The text of note 773.', 'Leic. 9b]', '774.', 'The text of note 774.', 'B. 50b]', '775.', 'The text of note 775.', 'F1. Uff.]',
  'XIV.', 'Anatomy, Zoology and Physiology.', ...fill(796, 800),
  'XV.', 'Astronomy.', ...fill(857, 860),
  'XVI.', 'Physical Geography.', 'I.', 'INTRODUCTION.', ...fill(919, 919), 'Book 1 of water in itself.', 'Book 2 of the sea.', 'II.', 'OF THE OCEAN.', ...fill(920, 925),
  'XVII.', 'Topographical Notes.', ...fill(1001, 1005),
  'XVIII.', 'Naval Warfare.—Mechanical Appliances.—Music.', ...fill(1113, 1116),
  'XIX.', 'Philosophical Maxims. Morals. Polemics and Speculations.', ...fill(1132, 1135),
  'XX.', 'Humorous Writings.', 'I.', 'STUDIES ON THE LIFE AND HABITS OF ANIMALS.', ...fill(1220, 1222),
  'III.', 'JESTS AND TALES.', '1280.', 'A jest of a priest and a painter.', 'C. A. 117a; 361a]',
  'IV.', 'PROPHECIES.', '1293.', '[Of Dreaming.]', 'Men will seem to see new destructions in the sky.', '1294.', '[Of Christians.]', 'Many who hold the faith of the Son only build temples in the name of the Mother.', 'L. o\']',
  '1295.', '[Wednesday morning 1 fl. to Tommaso.]', 'De ponderibus, compare No. 1436, 3.]',
  'XXI.', 'Letters. Personal Records. Dated Notes.', ...fill(1336, 1341), '1342.', 'The text of note 1342.', '[Footnote: Two notes on one leaf.]', '1342. 1343. These two notes are written on one leaf.', '1343.', 'The text of note 1343.', ...fill(1344, 1345), '(1346. 1347).', 'The text of notes 1346 and 1347.', 'L. Ia]',
  'XXII.', 'Miscellaneous Notes.', '(1379-l413).', 'The text that opens the miscellaneous notes.', ...fill(1414, 1420), ...fill(1490, 1492),
  '1493. On the 1st day of November 1493 I settled the account.', ...fill(1493, 1504), '1504. On the 9th day of August 1504 I went to Fiesole.', ...fill(1505, 1506),
].join('\n\n');
const prose = ['## Chapter I: The River', 'It was a long road (and a longer river)—so they said—and the boat went down it.', 'He wrote *this* in his book; she wrote [nothing] at all.', '## Chapter II: The Sea', 'The sea began where the river ended—as seas do.'].join('\n\n');
module.exports = { body, prose };
if (require.main === module) (async () => {
  const { createApp } = require('../src/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-outline-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'outline', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const add = (slug, title, b) => db.prepare("INSERT INTO texts (slug, kind, title, author, body, public, status, source, terms) VALUES (?,?,?,?,?,1,'held',?,?)").run(slug, 'book', title, 'Leonardo da Vinci', b, 'https://www.gutenberg.org/ebooks/5000', 'Public domain.');
  add('notebooks', 'The Notebooks of Leonardo da Vinci', body); add('river', 'The River', prose);
  const get = p => fetch(base + p).then(r => r.text().then(h => ({ status: r.status, h })));
  const dq = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const secs = h => [...h.matchAll(/<section class="rdr-ch[^"]*" data-ch="(\d+)"[^>]*>([\s\S]*?)(?=<section class="rdr-ch|<\/article>)/g)].map(m => m[2].replace(/&#39;/g, "'"));
  const toc = h => [...h.match(/<nav class="rdr-toc"[\s\S]*?<\/nav>/)[0].matchAll(/<li><a [^>]*>([^<]*)<\/a><\/li>/g)].map(m => m[1].replace(/&#39;/g, "'"));
  const R = h => JSON.parse(dq(h.match(/data-read='([^']*)'/)[1]));
  try {
    // An ordinary book: byte for byte as it was.
    const r1 = await get('/read/river?c=1'); OL.OFF.off = true; const r0 = await get('/read/river?c=1'); OL.OFF.off = false;
    assert.equal(r1.status, 200); assert.equal(r1.h, r0.h, 'an ordinary book is set exactly as before');
    assert.ok(!/rdo-|data-rd-go|&l=/.test(r1.h), 'nothing of the outline on an ordinary book');
    console.log('ok: an ordinary book is unchanged, byte for byte');

    const r = await get('/read/notebooks?c=0&l=n2'); assert.equal(r.status, 200); const h = r.h; const S = secs(h); const T = toc(h);
    // The chapters: front, each volume's title page and contents, one chapter per section under its own title.
    assert.deepEqual(T, ['The beginning', 'Volume 1', 'Contents of Volume 1',
      'I. Prolegomena and General Introduction to the Book on Painting', 'II. Linear Perspective', 'III. Six books on Light and Shade', 'IV. Perspective of Disappearance', 'V. Theory of colours',
      "VI. 'Prospettiva de' colri' (Perspective of Colour) and Aerial Perspective", 'VII. On the Proportions and on the Movements of the Human Figure', 'VIII. Botany for Painters and Elements of Landscape Painting',
      'IX. The Practice of Painting', 'X. Studies and Sketches for Pictures and Decorations', 'Volume 2', 'Contents of Volume 2',
      'XI. The notes on Sculpture', 'XII. Architectural Designs', 'XIII. Theoretical writings on Architecture', 'XIV. Anatomy, Zoology and Physiology', 'XV. Astronomy', 'XVI. Physical Geography',
      'XVII. Topographical Notes', 'XVIII. Naval Warfare.—Mechanical Appliances.—Music', 'XIX. Philosophical Maxims. Morals. Polemics and Speculations', 'XX. Humorous Writings', 'XXI. Letters. Personal Records. Dated Notes', 'XXII. Miscellaneous Notes'],
      'the chapters: ' + JSON.stringify(T));
    const C = Object.fromEntries(T.map((x, i) => [x.split('.')[0], i]));
    console.log(`ok: ${T.length} chapters: front, Volume 1, its contents, I–X, Volume 2, its contents, XI–XXII; section I titled from the contents`);
    // The contents: numerals are entries, never sections; one outline chapter per volume; numbers go to their notes.
    const con = S[2]; assert.ok(/<nav class="rdo rdo-con" aria-label="Contents of Volume 1">/.test(con));
    assert.ok(con.includes(`<a href="?c=${C.IX}&l=n2" data-c="${C.IX}">IX. The Practice of Painting</a>`), 'an entry links to its section');
    assert.ok(/<h4 class="rdo-pt"><span>III<\/span> THE PRACTICAL METHODS OF LIGHT AND SHADE AND AERIAL PERSPECTIVE<\/h4>/.test(con), 'a part is a heading');
    assert.ok(con.includes(`<a class="rdo-n" href="?c=${C.IX}&l=n2#n548" data-rd-note="n548" data-rd-nc="${C.IX}" aria-label="Note 548">548</a>`), 'a number goes to its note in another chapter');
    assert.ok(con.includes(`href="?c=${C.VIII}&l=n2#n453" data-rd-note="n453" data-rd-nc="${C.VIII}" aria-label="Notes 453 to 457">453–457</a>`), 'a range to its first note');
    assert.ok(/aria-label="Note 651">|<span class="rdo-n">651<\/span>/.test(con) && !/aria-label="Note 651"/.test(con), 'a number far from any note is plain text');
    assert.ok(/On chemical materials/.test(con), 'no underscore in the contents');
    assert.ok(S[C['Contents of Volume 2'.split('.')[0]]].includes('XX. Humorous Writings') && /<h4 class="rdo-pt"><span>III<\/span> JESTS AND TALES<\/h4>/.test(S[14]), 'volume 2\'s contents, from its title page');
    assert.ok(/THE NOTEBOOKS OF LEONARDO DA VINCI\. VOLUME 2\./.test(S[13]) && !/rdo-note/.test(S[13]), 'volume 2\'s title page is its own chapter');
    console.log('ok: each volume\'s contents is one outline chapter; numerals in it are entries');
    // Every section its own chapter with its own outline; parts restart; a part list does not leak.
    const ix = S[C.IX];
    for (const [no, t] of [['I', 'MORAL PRECEPTS FOR THE STUDENT OF PAINTING'], ['II', "THE ARTIST'S STUDIO"], ['III', 'THE PRACTICAL METHODS OF LIGHT AND SHADE AND AERIAL PERSPECTIVE'], ['IV', 'OF PORTRAIT AND FIGURE PAINTING']]) assert.ok(ix.includes(`<h3 class="rdo-pt"><span>${no}</span> ${t}</h3>`), `IX part ${no}`);
    assert.ok(/<li class="rdo-op"><span class="rdo-pn">III<\/span> THE PRACTICAL METHODS[^<]*<ul><li><a href="#n548"/.test(ix), 'IX\'s outline holds part III');
    for (const n of [544, 545, 546, 547, 548]) assert.ok(ix.includes(`<div class="rdo-note" id="n${n}">`), `note ${n} anchored`);
    assert.ok(/<details class="rdo-fn"><summary>Richter’s note<\/summary><p>Compare the drawing on Pl\. XXXI, No\. 1; the bracket was never closed in the source<\/p><\/details><\/div><div class="rdo-note" id="n546">/.test(ix), 'an unclosed footnote stops at the next note');
    const xvi = S[C.XVI], xx = S[C.XX];
    assert.ok(/<nav class="rdo"[\s\S]*INTRODUCTION[\s\S]*OF THE OCEAN[\s\S]*<\/nav>/.test(xvi) && !/STUDIES ON THE LIFE|JESTS AND TALES|PROPHECIES/.test(xvi), 'XVI\'s outline is XVI\'s alone');
    assert.ok(/<nav class="rdo"[\s\S]*STUDIES ON THE LIFE AND HABITS OF ANIMALS[\s\S]*JESTS AND TALES[\s\S]*PROPHECIES[\s\S]*<\/nav>/.test(xx), 'XX\'s parts in XX');
    for (const k of ['II', 'III', 'V', 'IX', 'XII', 'XIII', 'XVI', 'XX']) assert.ok(/<nav class="rdo" aria-label="In this section">/.test(S[C[k]]) || !/rdo-pt|rdo-th/.test(S[C[k]]), `section ${k} has its outline`);
    assert.ok(S[C.II].includes('<aside class="rdo-intro"') && /<p><em>running across both of them, as the source has it\.<\/em><\/p>/.test(S[C.II]), 'II: Richter\'s italic introduction');
    assert.ok(S[C.III].includes('<aside class="rdo-intro"') && /<p><em>and its second paragraph\.<\/em><\/p>/.test(S[C.III]), 'III: after a note with a capital heading, the bare numeral opens the section');
    assert.ok(!/<h\d class="rdo-lh">[IVXL_*]+\.?<\/h\d>/.test(h), 'a bare numeral is never set as Leonardo\'s heading');
    assert.ok(/<p class="rdo-lh"|<h\d class="rdo-lh">HENRY DE GEYMULLER\.<\/h\d>/.test(S[C.XI]) && S[C.XII].includes('III. Castles and Villas.'), 'the signature stays in XI; XII\'s one-line list stays in XII');
    // Each section holds only its own notes (the real ranges).
    const RANGES = { I: [1, 39], II: [40, 109], III: [110, 221], IV: [222, 262], V: [263, 288], VI: [289, 307], VII: [308, 392], VIII: [393, 481], IX: [482, 662], X: [663, 706], XI: [707, 740], XII: [741, 769], XIII: [770, 795], XIV: [796, 856], XV: [857, 918], XVI: [919, 1000], XVII: [1001, 1112], XVIII: [1113, 1131], XIX: [1132, 1219], XX: [1220, 1335], XXI: [1336, 1378], XXII: [1379, 1566] };
    for (const [k, [a, b]] of Object.entries(RANGES)) { const ns = [...S[C[k]].matchAll(/<div class="rdo-note" id="n(\d+)"/g)].map(m => +m[1]); assert.ok(ns.length && ns.every(x => x >= a && x <= b), `${k} holds ${ns[0]}–${ns[ns.length - 1]}, not within ${a}–${b}`); }
    assert.ok(S[C.XI].includes('<p>XI.</p>') || S[C.XI].includes('This numeral is not a section'), 'a numeral that is not the next section stays text');
    console.log('ok: every section its own chapter and outline; parts restart; IX part III found; no part leaks');
    // Anchors: which numbers have one, and where the others land.
    const ids = new Set([...h.matchAll(/ id="n(\d+)"/g)].map(m => +m[1]));
    for (const n of [12, 13, 15, 279, 280, 281, 282, 283, 355, 356, 357, 453, 669, 1342, 1343, 1346, 1347, 1379, 1413, 1493, 1504]) assert.ok(ids.has(n), `note ${n} has an anchor`);
    for (const n of [20, 454, 455, 456, 457, 314]) assert.ok(!ids.has(n), `note ${n} has no line and no anchor`);
    assert.ok(/<div class="rdo-note" id="n279"><span class="rdo-al" id="n280"><\/span><p class="rdo-no">279, 280<\/p><h\d class="rdo-lh">OF THE COLOURS OF SHADOWS/.test(S[C.V]), 'a bare range line opens its notes');
    assert.ok(/<div class="rdo-note" id="n281"><span class="rdo-al" id="n283"><\/span><p class="rdo-no">281–283<\/p>/.test(S[C.V]) && S[C.V].includes('<div class="rdo-note" id="n282">'), '(281-283): 281 and 283 here, 282 its own');
    assert.ok(/<p>\(298—290\)\.<\/p>/.test(S[C.VI]), 'a range with nothing missing stays a line');
    assert.ok(/id="n1379">(<span class="rdo-al" id="n\d+"><\/span>){34}<p class="rdo-no">1379–1413<\/p>/.test(S[C.XXII]), '(1379-l413): an l read as 1, under the section title');
    assert.ok(/<p>13\. From the character of the writing/.test(S[C.I]) && /<p>669\. This passage does not occur/.test(S[C.X]) && /<p>1342\. 1343\. These two notes/.test(S[C.XXI]) && /<p>40\. Compare 53, 2\.<\/p>/.test(S[C.II]), 'line-notes are never notes');
    assert.ok(/id="n1492">[\s\S]*?<p>1493\. On the 1st day of November 1493/.test(S[C.XXII]) && /<p>1504\. On the 9th day of August 1504/.test(S[C.XXII]), 'a dated line is not a note');
    assert.ok(/id="n15"><p class="rdo-no">15<\/p><p>A note whose number was joined/.test(S[C.I]), 'a number joined to its line, exactly the next, is its note');
    let n = await get('/read/notebooks?n=455'); let D = R(n.h); assert.deepEqual([D.at, D.note, D.within], [C.VIII, 'n453', 'Note 455 is within 453–457.'], '?n=455 lands on 453 and says so');
    n = await get('/read/notebooks?n=280'); D = R(n.h); assert.deepEqual([D.at, D.note], [C.V, 'n280']);
    n = await get('/read/notebooks?n=548'); D = R(n.h); assert.deepEqual([D.at, D.note], [C.IX, 'n548']);
    n = await get('/read/notebooks?n=20'); D = R(n.h); assert.deepEqual([D.at, D.note, D.within], [C.I, 'n19', 'Note 20 is within 19–20.']);
    n = await get('/read/notebooks?n=15'); D = R(n.h); assert.deepEqual([D.at, D.note], [C.I, 'n15']);
    assert.ok(S[C.VIII].includes('<a href="#n453" data-rd-note="n453"'), 'the outline links down the page');
    console.log('ok: range lines open their notes; line-notes are not notes; ?n= falls to the nearest lower note and says so');
    // Manuscript lines by shape; bracketed titles are not manuscripts.
    const src = [...h.matchAll(/<p class="rdo-src">([\s\S]*?)<\/p>/g)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/&#39;/g, "'"));
    assert.equal(src.length, 8, 'source lines: ' + JSON.stringify(src));
    assert.ok(src.some(x => x === 'Manuscript Codex Atlanticus, 117a; 361a (C. A. 117a; 361a)'), 'C. A. with spaces');
    assert.ok(src.some(x => /L\. o'/.test(x)) && src.some(x => /L\. Ia/.test(x)), "L. o' and L. Ia are manuscript lines");
    for (const x of ['[Of Dreaming.]', '[Of Christians.]', '[Wednesday morning 1 fl. to Tommaso.]', 'De ponderibus, compare No. 1436, 3.]']) assert.ok(!src.some(y => y.includes(x.replace(/[[\]]/g, ''))), x + ' is not a manuscript');
    assert.ok(/<p>\[Of Dreaming\.\]<\/p>/.test(S[C.XX]), 'a bracketed title stays as written');
    console.log('ok: 8 manuscript lines read by shape, spaces and all; bracketed titles are not manuscripts');
    // No underscore reaches the page; the line on the first page; Go to note.
    const text = h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
    assert.ok(!/_/.test(text.replace(/wm_read_/g, '')), 'no underscore on the page: ' + (text.match(/.{30}_.{30}/) || [''])[0]);
    assert.ok(S[0].includes(`<p class="rdo-kind">${OL.KIND}</p>`) && /data-rd-go/.test(h));
    // Old places: under the import's chaptering (no &l), and under 13 Nov's (&l=n1): never an error.
    const at = async q => R((await get('/read/notebooks' + q)).h).at;
    const pre = []; for (let c = 0; c <= 9; c++) pre.push(await at(`?c=${c}`));
    assert.ok(pre.every(x => x >= 0 && x < T.length), 'old places land inside the book: ' + pre);
    assert.equal(await at('?c=4'), C.IX, 'the import\'s chapter "From Whence to Depict a Landscape" is in IX');
    assert.equal(await at('?c=x'), 0); const far = await at('?c=99&l=n1'); assert.ok(far >= 0 && far < T.length);
    const n1 = []; for (let c = 0; c <= 12; c++) n1.push(await at(`?c=${c}&l=n1`)); assert.ok(n1.every(x => x >= 0 && x < T.length), '13 Nov\'s places land inside: ' + n1);
    assert.equal(R(r.h).remap1.length > 0, true, 'the 13 Nov chaptering is carried');
    const q = await get(`/read/notebooks?c=2&l=n1&q=${encodeURIComponent('The stability of a building is the result')}`); assert.equal(R(q.h).at, C.XIII, 'a passage sent opens where it now is');
    console.log('ok: old places (the import\'s and 13 Nov\'s) land inside the book, never an error');
    // One miss must not cascade (#59): with IV's numeral lost, the body's own reading would leave III holding III–XXII;
    // the contents' own numbering finds every other section again, and the host's log says so.
    const lost = body.replace('\n\nIV.\n\nPerspective of Disappearance.\n\n222.', '\n\nPerspective of Disappearance.\n\n222.'); assert.notEqual(lost, body);
    add('notebooks-lost', 'The Notebooks of Leonardo da Vinci', lost);
    const logs = []; const log0 = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
    let L2; try { L2 = await get('/read/notebooks-lost?c=0&l=n2'); } finally { console.log = log0; }
    const T2 = toc(L2.h);
    assert.ok(logs.includes('[outline] notebooks-lost: sections 21 of 22 matched (by the contents; the body\'s own reading gave 3)'), 'the log line: ' + JSON.stringify(logs.filter(x => x.startsWith('[outline]'))));
    assert.deepEqual(T2.filter(x => /^[IVXL]+\. /.test(x)).map(x => x.split('.')[0]), ['I', 'II', 'III', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII'], 'every other section found: ' + JSON.stringify(T2));
    console.log('ok: a lost numeral does not cascade: the sections are found by the contents, and the log says 21 of 22');
    // The seam for the codices.
    assert.deepEqual(app.locals.bookNotes.note('notebooks', 772), { n: 772, chapter: C.XIII, section: 'XIII', ms: [{ ms: 'C.A.', name: 'Codex Atlanticus', folio: '172b; 516b', line: 'C.A. 172b; 516b' }] });
    assert.equal(app.locals.bookNotes.note('river', 1), null); assert.equal(app.locals.bookNotes.note('notebooks', 20), null);
    assert.equal(app.locals.bookNotes.note('notebooks', 280).n, 280);
    console.log('ok: the seam: a note, its chapter and its manuscript and folio');
    assert.equal(OL.parse('It was a long road (and a longer river)—so they said—and the boat (1850) went down it—slowly (twice).'), null);
    console.log('all outline checks pass');
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
