// A book of numbered notes (#35): Leonardo's Notebooks, set by its own structure. The fixture is a made-up book built
// from the real lines of Richter's edition (the live page, read 13 Nov), shaped as the house stored it: the old '## '
// chapter heads at the wrong places, the front contents cut into chapters, a stray "X." at a chapter's end.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { createApp } = require('../src/app');
const OL = require('../src/outline');
const fill = (a, b, skip = []) => { const o = []; for (let n = a; n <= b; n++) { if (skip.includes(n)) continue; o.push(`${n}.`, `The text of note ${n}, in Leonardo's words, with (brackets) and dashes—as the source has them.`); } return o; };
const IX_SYN = "I. MORAL PRECEPTS FOR THE STUDENT OF PAINTING.—How to ascertain the dispositions for an artistic career (482).—The course of instruction for an artist (483—485).—The study of the antique (486. 487).—Industry and thoroughness the first conditions (491—493.)—II. THE ARTIST'S STUDIO.—The size of figures in a picture (538. 539).—The right position of the artist, when painting and of the spectator (540—547).—III. THE PRACTICAL METHODS OF LIGHT AND SHADE AND AERIAL PERSPECTIVE.—Gradations of light and shade (548).—On the choice of light for a picture (549—554).—The distribution of light and shade (555—559).—The juxtaposition of light and shade (560. 561).—On the lighting of the background (562—565).—On the lighting of white objects (566).—The methods of aerial perspective (567—570).—VI. THE ARTIST'S MATERIALS.—Of chalk and paper (612—617).—On chemical _materials (638—650).—VII. PHILOSOPHY AND HISTORY OF THE ART OF PAINTING.—The relation of art and nature (651. 652).—The painter's scope (662).";
const body = [
  'The Notebooks of Leonardo da Vinci, compiled and edited from the original manuscripts by Jean Paul Richter.',
  'PREFACE.',
  'A few conventions thus adopted (to keep the reader from doubt)—and some dashes—are explained here.',
  'CONTENTS.',
  "Prolegomena and General Introduction to the Book on Painting.",
  "The author's intention to publish his MSS. (1).—The preparation of the MSS. for publication (2).—Admonition to readers (3).—The disorder in the MSS. (4).—Suggestions for the arrangement of MSS. treated of in this division (5—8).",
  'II.',
  '## Linear Perspective',
  'General introduction (40).—The function of the eye (41—45).—Definition of perspective (46—49).—The perception of the object depends on the direction of the eye (50).',
  'IX.',
  '## The Practice of Painting',
  IX_SYN,
  'X.',
  // the body: section I has no numeral of its own
  "## The Author's Intention to Publish His Mss",
  ...fill(1, 14), '15. A note whose number was joined to its line, as the source has it in a few places.', ...fill(16, 28, [20]),
  '29.', 'Let the object in relief t be seen by both eyes; if you will look at the object with the right eye only, keeping the left eye shut, the object will appear in the space a.',
  '[Footnote: In the sketch, m is the left eye and n the right eye.]',
  '30.', 'The comparative size of the image depends on the amount of light (30-39).', 'The eye will hold and retain in itself the image of a luminous body better than that of a shaded object.',
  ...fill(31, 39),
  '_II.', 'Linear Perspective.', "Leonardo's theory of perspective is set out here in two paragraphs of Richter's, the italic", 'running across both of them, as the source has it._',
  ...fill(40, 60),
  'IX.', 'The Practice of Painting.', "_Leonardo's precepts for the painter, gathered by Richter._",
  'I.', 'MORAL PRECEPTS FOR THE STUDENT OF PAINTING.', 'How to ascertain the dispositions for an artistic career (482).',
  ...fill(482, 547),
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
  'Volume 2',
  'THE NOTEBOOKS OF LEONARDO DA VINCI. VOLUME 2.',
  'XIII.', 'Theoretical writings on Architecture.',
  'I. ON FISSURES IN WALLS.—Of cracks in walls (770—773).—Of the stability of buildings (774).',
  'XII.', 'Architectural Designs.', '_Richter on the designs, an italic that closes', 'later, on piers._',
  ...fill(741, 769),
  '_XIII.', 'Theoretical writings on Architecture.', "Leonardo's original writings on the theory of Architecture have come down to us only in a fragmentary state;_", '_The small number of chapters given under the fifth class is part of the plan._',
  'I.', 'ON FISSURES IN WALLS.',
  '770.', 'First write the treatise on the causes of the giving way of walls and then, separately, treat of the remedies.', '[Footnote: See Pl. CIV.]',
  '771.', 'The cracks in walls will never be parallel unless the part of the wall that separates remains vertical.', 'WHAT IS THE LAW BY WHICH BUILDINGS HAVE STABILITY.', 'The stability of a building is the result of the contrary law.',
  '[Footnote: Lines 1-5 refer to Pl. CV, No. 2. Line 9 alle due anteciedete, see on the same page.', 'Lines 16-18. The translation of this is doubtful.', 'Lines 19-23 are on the right hand margin close to the two sketches on Pl. CII, No. 3.]',
  '## C. A. 117a; 361a]',
  '772.', 'Why a wall gives way.', '1. That which gets wet increases in proportion to the moisture it imbibes.', '2. And a wet object shrinks, while drying, in proportion to the evaporation.',
  '[Footnote: The text of this passage is reproduced in facsimile on Pl. CVI to the left.]', 'C.A. 172b; 516b]',
  '773.', 'The text of note 773.', 'Leic. 9b]', '774.', 'The text of note 774.', 'B. 50b]', '775.', 'The text of note 775.', 'F1. Uff.]',
].join('\n\n');
const prose = ['## Chapter I: The River', 'It was a long road (and a longer river)—so they said—and the boat went down it.', 'He wrote *this* in his book; she wrote [nothing] at all.', '## Chapter II: The Sea', 'The sea began where the river ended—as seas do.'].join('\n\n');
module.exports = { body, prose };
if (require.main === module) (async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-outline-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'outline', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const add = (slug, title, b) => db.prepare("INSERT INTO texts (slug, kind, title, author, body, public, status, source, terms) VALUES (?,?,?,?,?,1,'held',?,?)").run(slug, 'book', title, 'Leonardo da Vinci', b, 'https://www.gutenberg.org/ebooks/5000', 'Public domain.');
  add('notebooks', 'The Notebooks of Leonardo da Vinci', body); add('river', 'The River', prose);
  const get = p => fetch(base + p).then(r => r.text().then(h => ({ status: r.status, h })));
  const secs = h => [...h.matchAll(/<section class="rdr-ch[^"]*" data-ch="(\d+)"[^>]*>([\s\S]*?)(?=<section class="rdr-ch|<\/article>)/g)].map(m => m[2]);
  const toc = h => [...h.match(/<nav class="rdr-toc"[\s\S]*?<\/nav>/)[0].matchAll(/<li><a [^>]*>([^<]*)<\/a><\/li>/g)].map(m => m[1]);
  try {
    // An ordinary book: byte for byte as it was.
    const r1 = await get('/read/river?c=1'); OL.OFF.off = true; const r0 = await get('/read/river?c=1'); OL.OFF.off = false;
    assert.equal(r1.status, 200); assert.equal(r1.h, r0.h, 'an ordinary book is set exactly as before');
    assert.ok(!/rdo-|data-rd-go|&l=/.test(r1.h), 'nothing of the outline on an ordinary book');
    console.log('ok: an ordinary book is unchanged, byte for byte');

    const r = await get('/read/notebooks?c=0&l=n1'); assert.equal(r.status, 200); const h = r.h; const S = secs(h).map(x => x.replace(/&#39;/g, "'"));
    // The chapters follow the structure.
    const T = toc(h).map(x => x.replace(/&#39;|&#x27;/g, "'"));
    assert.deepEqual(T, ['The beginning', 'Contents of Volume 1', 'I. Prolegomena and General Introduction to the Book on Painting', 'II. Linear Perspective', 'IX. The Practice of Painting', 'Volume 2', 'Contents of Volume 2', 'XII. Architectural Designs', 'XIII. Theoretical writings on Architecture'], 'the chapters: ' + JSON.stringify(T));
    console.log('ok: the chapters are the book\'s own: front, contents, sections, by volume');
    // The contents: one chapter, an outline: parts as headings, topics as lines, numbers linking across chapters.
    const con = S[1]; assert.ok(/<nav class="rdo rdo-con" aria-label="Contents of Volume 1">/.test(con));
    assert.ok(/<h3 id="rdo-e1-2"><a href="\?c=4&l=n1" data-c="4">IX\. The Practice of Painting<\/a><\/h3>/.test(con), 'an entry links to its section');
    assert.ok(/<h4 class="rdo-pt"><span>III<\/span> THE PRACTICAL METHODS OF LIGHT AND SHADE AND AERIAL PERSPECTIVE<\/h4>/.test(con), 'a part is a heading');
    assert.ok(/<span class="rdo-tp">Gradations of light and shade<\/span><span class="rdo-ns"><a class="rdo-n" href="\?c=4&l=n1#n548" data-rd-note="n548" data-rd-nc="4" aria-label="Note 548">548<\/a>/.test(con), 'a number goes to its note in another chapter');
    assert.ok(/aria-label="Notes 549 to 554">549–554<\/a>/.test(con), 'a range goes to its first note');
    assert.ok(/<span class="rdo-n">651<\/span>, <span class="rdo-n">652<\/span>/.test(con), 'a number with no note is plain text, never a dead link');
    assert.ok(/On chemical materials/.test(con) && !/_/.test(con.replace(/class="[^"]*"|aria-[a-z]+="[^"]*"|data-[a-z-]+="[^"]*"|id="[^"]*"/g, '')), 'no underscore in the contents');
    assert.ok(!/<p>X\.<\/p>/.test(h), 'the stray "X." is not on any page');
    console.log('ok: the contents are one chapter, an outline whose numbers go to their notes');
    // A section: its outline, its parts, topics, notes.
    const ix = S[4];
    assert.ok(/^[\s\S]*?<nav class="rdo" aria-label="In this section">/.test(ix), 'the section opens with its outline');
    assert.ok(/<li class="rdo-op"><span class="rdo-pn">III<\/span> THE PRACTICAL METHODS OF LIGHT AND SHADE AND AERIAL PERSPECTIVE<ul><li><a href="#n548" data-rd-note="n548" data-rd-nc="4">Gradations of light and shade<\/a><span class="rdo-ns">548<\/span><\/li><li><a href="#n549"[^>]*>On the choice of light for a picture<\/a><span class="rdo-ns">549–554<\/span>/.test(ix), 'the outline: parts, topics, ranges, links down the page');
    assert.ok(/<h3 class="rdo-pt"><span>III<\/span> THE PRACTICAL METHODS/.test(ix) && /<h4 class="rdo-th">Gradations of light and shade <span class="rdo-ns">548<\/span><\/h4>/.test(ix), 'part h3, topic h4 with its range');
    assert.ok(/<div class="rdo-note" id="n548"><p class="rdo-no">548<\/p><h5 class="rdo-lh">OF PAINTING: OF THE DARKNESS/.test(ix), 'a note: its number, Leonardo\'s heading in his own words');
    assert.ok(/<aside class="rdo-intro" aria-label="Richter’s note"><p class="rdo-lab" aria-hidden="true">Richter’s note<\/p><p><em>Leonardo’s precepts|<aside class="rdo-intro" aria-label="Richter’s note"><p class="rdo-lab" aria-hidden="true">Richter’s note<\/p><p><em>Leonardo's precepts/.test(ix), 'Richter\'s introduction is labelled, in italics');
    assert.ok(/<details class="rdo-fn"><summary>Richter’s note<\/summary><p>6: Compare the two diagrams under No\. 565\.<\/p><\/details>/.test(ix), 'a footnote folds under its note, closed');
    assert.ok(/id="n550"><p class="rdo-no">550<\/p>/.test(ix) && /<h5 class="rdo-lh">From Whence to Depict a Landscape<\/h5>/.test(ix), 'an old stray chapter head is back in the text as a heading');
    console.log('ok: a section opens with its outline; notes, Leonardo\'s headings, Richter\'s words labelled and folded');
    // Section I: the topic standing after its number, the run-on note, a missing number, the list line.
    const s1 = S[2];
    assert.ok(/<h3 class="rdo-th">The comparative size of the image depends on the amount of light <span class="rdo-ns">30–39<\/span><\/h3><div class="rdo-note" id="n30">/.test(s1), 'a topic after its number opens before the note');
    assert.ok(/id="n15"><p class="rdo-no">15<\/p><p>A note whose number was joined/.test(s1), 'a run-on number is its note');
    assert.ok(!/id="n20"/.test(h), 'a missing note has no anchor');
    // XII: italics across paragraphs; XIII: a three-paragraph footnote, list lines, the manuscripts.
    const s12 = S[7], s13 = S[8];
    assert.ok(/<p><em>Leonardo’s theory|<p><em>Leonardo's theory/.test(S[3]) && /<p><em>running across both of them, as the source has it\.<\/em><\/p>/.test(S[3]), 'an italic across two paragraphs is emphasis in both');
    assert.ok(/<p><em>later, on piers\.<\/em><\/p>/.test(s12), 'and closes where it closes');
    assert.ok(/<p><em>The small number of chapters/.test(s13) && /<p><em>Leonardo’s original writings|<p><em>Leonardo's original writings/.test(s13), 'Richter\'s italic introduction to XIII');
    assert.ok(/<details class="rdo-fn"><summary>Richter’s note<\/summary><p>Lines 1-5 refer to Pl\. CV, No\. 2\.[^<]*<\/p><p>Lines 16-18\.[^<]*<\/p><p>Lines 19-23[^<]*Pl\. CII, No\. 3\.<\/p><\/details>/.test(s13), 'a footnote of three paragraphs folds as one');
    assert.ok(/id="n772">[\s\S]*<p>1\. That which gets wet[\s\S]*<p>2\. And a wet object[\s\S]*id="n773"/.test(s13) && !/id="n1"[^0-9]/.test(s13) && !/id="n2"[^0-9]/.test(s13), 'a list line inside a note is not a note');
    assert.ok(/<p class="rdo-src"><span class="rdo-lab">Manuscript<\/span> Codex Atlanticus, 172b; 516b <span class="rdo-orig">\(C\.A\. 172b; 516b\)<\/span><\/p>/.test(s13), 'the manuscript spelled out, the original beside it');
    assert.ok(/Codex Leicester, 9b/.test(s13) && /Manuscript B \(Institut de France\), 50b/.test(s13) && /<p class="rdo-src"><span class="rdo-lab">Manuscript<\/span> F1\. Uff\.<\/p>/.test(s13), 'Leicester, Paris B; an unknown one left as written');
    assert.ok(/Codex Atlanticus, 117a; 361a/.test(s13), 'an old stray head that was a manuscript line is one again');
    console.log('ok: the topic after its number, the run-on note, the gap, italics across paragraphs, footnotes, list lines, manuscripts');
    // No underscore reaches the page.
    const text = h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
    assert.ok(!/_/.test(text.replace(/wm_read_/g, '')), 'no underscore on the page: ' + (text.match(/.{30}_.{30}/) || [''])[0]);
    // The line on the book's first page; the Go to note field.
    assert.ok(S[0].includes(`<p class="rdo-kind">${OL.KIND}</p>`), 'the line saying what kind of book this is');
    assert.ok(/<form class="rdo-go" method="get" data-rd-go><label for="rdo-go-n">Go to note<\/label><input id="rdo-go-n" name="n" type="number"/.test(h), 'Go to note');
    console.log('ok: the book says what kind it is; Go to note');
    // ?n= and an old ?c=.
    const n = await get('/read/notebooks?n=771'); const R = JSON.parse(n.h.match(/data-read='([^']*)'/)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
    assert.equal(R.at, 8); assert.equal(R.note, 'n771'); assert.ok(/<section class="rdr-ch" data-ch="8">/.test(n.h), 'note 771 opens its chapter');
    // The old chaptering: chapter 0 the title page, 1 "Linear Perspective" (contents), 2 "The Practice of Painting" (contents),
    // 3 "The Author's Intention…" (section I's text), 4 "From Whence to Depict a Landscape" (inside IX), 5 "C. A. 117a…" (XIII).
    const old = async c => JSON.parse((await get(`/read/notebooks?c=${c}`)).h.match(/data-read='([^']*)'/)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')).at;
    assert.deepEqual([await old(0), await old(1), await old(2), await old(3), await old(4), await old(5), await old(99)], [0, 1, 1, 2, 4, 8, 8], 'an old place is carried to where its chapter now stands: ' + JSON.stringify([await old(0), await old(1), await old(2), await old(3), await old(4), await old(5), await old(99)]));
    assert.equal(R.remap.length, 6); assert.equal(await old('x'), 0, 'anything else is the book\'s start, never an error');
    const q = await get(`/read/notebooks?c=2&q=${encodeURIComponent('The stability of a building is the result')}`); assert.ok(/<section class="rdr-ch" data-ch="8">/.test(q.h), 'a passage sent under the old chaptering opens where it now is');
    console.log('ok: ?n= opens a note; an old ?c= is carried, never an error');
    // The seam for the codices.
    assert.deepEqual(app.locals.bookNotes.note('notebooks', 772), { n: 772, chapter: 8, section: 'XIII', ms: [{ ms: 'C.A.', name: 'Codex Atlanticus', folio: '172b; 516b', line: 'C.A. 172b; 516b' }] });
    assert.equal(app.locals.bookNotes.note('river', 1), null); assert.equal(app.locals.bookNotes.note('notebooks', 20), null);
    console.log('ok: the seam: a note, its chapter and its manuscript and folio');
    // Recognition declines what does not fit.
    assert.equal(OL.parse('It was a long road (and a longer river)—so they said—and the boat (1850) went down it—slowly (twice).'), null);
    assert.ok(OL.parse(IX_SYN).length > 10);
    console.log('all outline checks pass');
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
