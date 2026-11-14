// By manuscript, a volume's own words, and a leaf paired with its notes (#37). The made-up notes book of test/outline.js,
// with more manuscript lines laid after its last note, and a small volume of six pages.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
const OL = require('../src/outline');
const { body } = require('./outline');
const more = [
  '776.', 'OF THE FLIGHT OF BIRDS.', 'The text of note 776.', 'C.A. 10a]',
  '777.', 'The text of note 777, on the second side.', 'C.A. 9b]',
  '778.', 'The text of note 778, on the same side.', 'C.A. 9b]',
  '779.', 'The text of note 779.', 'S.K.M. III. 1b]',
  '780.', 'The text of note 780.', 'S.K.M. I. 2a]',
  '781.', 'The text of note 781.', 'W.P.7.]',
  '782.', 'The text of note 782.', 'W. XII.]',
  '783.', 'The text of note 783.', 'Ash. II. 13b]',
  '784.', 'The text of note 784 <with a bracket> & an ampersand.', 'L. 53a]',
  '785.', 'The text of note 785.', 'W.A.II.5b]',
  '786.', 'The text of note 786.', 'C.A. 172b]',
].join('\n\n');
const full = body + '\n\n' + more;
const bare = full.split('\n\n').filter(p => !/\]$/.test(p) || /^\[|Footnote|Pl\./.test(p)).join('\n\n');

(async () => {
  // The leaf of a manuscript line, read from stage 1's parsing.
  const L = s => OL.leafOf(OL.manuscript(s));
  assert.deepStrictEqual((({ key, leaf, label, also }) => ({ key, leaf, label, also }))(L('C.A. 172b; 516b]')), { key: 'ca', leaf: '172b', label: '172b', also: ['516b'] });
  assert.strictEqual(L('Leic. 9b]').key, 'leic'); assert.strictEqual(L('B. 50b]').key, 'b'); assert.strictEqual(L('L. 53a]').leaf, '53a');
  assert.strictEqual(L('Ash. II. 13b]').key, 'ash-ii'); assert.strictEqual(L('S.K.M. III. 1b]').key, 'skm-iii'); assert.strictEqual(L('S.K.M. I. 1b]').key, 'skm-i');
  assert.deepStrictEqual([L('W.P.7.]').key, L('W.P.7.]').leaf], ['w-p', '7']); assert.deepStrictEqual([L('W.A.II.5b]').key, L('W.A.II.5b]').leaf], ['w-a-ii', '5b']);
  for (const x of ['F1. Uff.]', 'W. XII.]', 'L. Ib]', 'L. o"]', 'C.A. 12b and 13a]']) assert.strictEqual(L(x), null, x + ' is Other, never guessed');
  console.log('ok: manuscript lines keyed (Forster III is not Forster I); what does not read is Other');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-leaves-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'leaves', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const add = (slug, b) => db.prepare("INSERT INTO texts (slug, kind, title, author, body, public, status, source, terms) VALUES (?,?,?,?,?,1,'held',?,?)").run(slug, 'book', 'The Notebooks of Leonardo da Vinci', 'Leonardo da Vinci', b, 'https://www.gutenberg.org/ebooks/5000', 'Public domain.');
    add('notebooks', full); add('bare-notes', bare);
    const get = p => fetch(base + p).then(r => r.text().then(h => ({ status: r.status, h })));
    // 1. By manuscript.
    let r = await get('/read/notebooks?by=ms'); assert.strictEqual(r.status, 200);
    assert.ok(/<main class="rdr rdm">/.test(r.h) && r.h.includes(OL.MS_LEDE), 'the index, in the reader');
    const ix = [...r.h.matchAll(/<li><a href="\/read\/notebooks\?by=ms&amp;ms=([a-z0-9-]+)"><b>([^<]+)<\/b> <span class="rdm-ab">([^<]+)<\/span><\/a><span class="rdm-ct">([^<]+)<\/span>/g)].map(m => [m[1], m[3], m[4]]);
    assert.deepStrictEqual(ix.map(x => x[0]), ['ash-ii', 'ca', 'leic', 'skm-i', 'skm-iii', 'b', 'l', 'w-a-ii', 'w-p'], 'every manuscript, spelled out, in order of name: ' + JSON.stringify(ix));
    assert.deepStrictEqual(ix.find(x => x[0] === 'ca'), ['ca', 'C.A.', '4 leaves · 6 notes'], 'C.A.: 9b, 10a, 117a, 172b');
    assert.ok(/<b>Codex Atlanticus<\/b>/.test(r.h) && /<b>The Forster codices \(South Kensington Museum\), III<\/b>/.test(r.h), 'spelled out with the abbreviation');
    assert.ok(/ms=other"><b>Other<\/b><\/a><span class="rdm-ct">2 lines<\/span>/.test(r.h), 'Other: F1. Uff. and W. XII.');
    r = await get('/read/notebooks?by=ms&ms=ca');
    const leaves = [...r.h.matchAll(/<h2 id="rdm-l\d+"><span class="rdm-lk">Leaf<\/span> ([^<]+)<\/h2>/g)].map(m => m[1]);
    assert.deepStrictEqual(leaves, ['9b', '10a', '117a', '172b'], 'leaves in natural order: ' + JSON.stringify(leaves));
    const nine = r.h.match(/Leaf<\/span> 9b<\/h2>([\s\S]*?)<\/section>/)[1];
    assert.ok(/href="\/read\/notebooks\?n=777"><b class="rdm-n">777<\/b> <span class="rdm-t">The text of note 777, on the second side\.<\/span>/.test(nine) && /\?n=778"/.test(nine), 'the notes on a leaf, linked into the book');
    const one72 = r.h.match(/Leaf<\/span> 172b<\/h2>([\s\S]*?)<\/section>/)[1];
    assert.ok(/\?n=772"[\s\S]*<span class="rdm-also">with 516b<\/span>[\s\S]*\?n=786"/.test(one72), 'C.A. 172b; 516b keyed by the first, the second kept as written');
    r = await get('/read/notebooks?by=ms&ms=skm-iii'); assert.ok(r.h.includes('Leaf</span> 1b</h2>') && r.h.includes('?n=779"') && !r.h.includes('?n=780"'), 'Forster III holds 779, not 780');
    r = await get('/read/notebooks?by=ms&ms=other'); assert.ok(/<span class="rdm-line">F1\. Uff\.<\/span><span class="rdm-on"><a href="\/read\/notebooks\?n=775"/.test(r.h) && r.h.includes('W. XII.'), 'Other lists each line with its notes');
    r = await get('/read/notebooks?by=ms&ms=leic'); assert.ok(/class="rdm-h">OF THE FLIGHT|rdm-t">The text of note 773/.test(r.h));
    r = await get('/read/notebooks?by=ms&ms=l'); assert.ok(r.h.includes('The text of note 784 &lt;with a bracket&gt; &amp; an ampersand.'), 'escaped');
    r = await get('/read/notebooks?by=ms&ms=nope'); assert.strictEqual(r.status, 200); assert.ok(r.h.includes(OL.MS_LEDE), 'an unknown key is the index, never an error');
    r = await get('/read/notebooks?c=0&l=n1'); assert.ok(/<p class="rdm-to"><a href="\?by=ms">By manuscript<\/a>/.test(r.h), 'reached from the contents');
    const con = r.h.match(/<section class="rdr-ch" data-ch="1"[\s\S]*?<\/section>\s*<section/)[0]; assert.ok(con.includes('href="?by=ms"'), 'and from the contents chapter');
    // A book without manuscript lines: no By manuscript, and ?by=ms is the book as ever.
    r = await get('/read/bare-notes?c=0&l=n1'); assert.ok(/rdo-note/.test(r.h), 'still a book of numbered notes'); assert.ok(!r.h.includes('by=ms'), 'no By manuscript');
    r = await get('/read/bare-notes?by=ms'); assert.ok(!r.h.includes('rdm') && /<main class="rdr/.test(r.h), 'the address is the book');
    console.log('ok: by manuscript: the index, leaves in natural order, notes under each, Other; none for a book without manuscript lines');

    // 2. A small volume, its about and source.
    const a = app.locals.art.ensure('Leonardo da Vinci', { born: 1452, died: 1519 });
    const mk = async (t, i) => { const f = path.join(dir, 'f' + i + '.jpg'); await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 200, g: 190 - i * 10, b: 160 } } }).jpeg().toFile(f); const w = await app.locals.registerWork({ file: f, title: t, originalName: 'f' + i + '.jpg', kind: 'drawing' }); db.prepare("UPDATE works SET status='held', artist_id=?, kind='drawing', open='pd', hall=1 WHERE id=?").run(a.id, w.id); return db.prepare('SELECT id, slug FROM works WHERE id=?').get(w.id); };
    const ws = []; for (let i = 1; i <= 6; i++) ws.push(await mk('Codex Atlanticus, folio ' + i, i));
    const V = app.locals.volumes; V.propose({ artistId: a.id }); let v = db.prepare('SELECT * FROM volumes').get(); assert.ok(v, 'proposed');
    const jar = (await fetch(base + '/studio/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' })).headers.get('set-cookie').split(';')[0];
    const post = (p, b, cookie = jar) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: new URLSearchParams(b).toString() });
    const okOf = x => decodeURIComponent(new URL(x.headers.get('location'), base).searchParams.get('ok') || '');
    // No about, no pairing: the volume page is as it was.
    await post('/studio/volumes/' + v.id, { title: 'Codex Atlanticus', do: 'open' }); v = V.byId(v.id); assert.strictEqual(v.status, 'open');
    r = await get('/volume/' + v.slug); assert.ok(!/vlf/.test(r.h), 'nothing added to a volume without about or pairings');
    assert.strictEqual(v.about, null, 'the house writes nothing by itself');
    let h = await (await fetch(base + '/studio/volumes?show=open', { headers: { cookie: jar } })).text(); assert.ok(/<textarea name="about"/.test(h) && /name="source"/.test(h), 'the desk edits about and source');
    await post('/studio/volumes/' + v.id + '?show=open', { title: 'Codex Atlanticus', keeper: 'A library', about: 'A bound book of sheets <b>gathered</b> late.\r\n\r\nIts leaves are numbered twice & more.', source: 'Pictures from a public collection <i>online</i>', do: 'save' });
    v = V.byId(v.id); assert.strictEqual(v.about, 'A bound book of sheets <b>gathered</b> late.\n\nIts leaves are numbered twice & more.');
    r = await get('/volume/' + v.slug);
    assert.ok(r.h.includes('<section class="vlf-s" data-vlf-p="1" data-vlf-about aria-labelledby="vlf-ab"><h2 class="vlf-k" id="vlf-ab">About this volume</h2><div class="vlf-ab"><p>A bound book of sheets &lt;b&gt;gathered&lt;/b&gt; late.</p><p>Its leaves are numbered twice &amp; more.</p></div><p class="vlf-so"><span>Source</span> Pictures from a public collection &lt;i&gt;online&lt;/i&gt;</p></section>'), 'about and source shown, escaped, paragraphs kept');
    assert.ok(r.h.includes('data-vlf-abt') && /<div class="vlf-row">/.test(r.h), 'at the head: About');
    r = await get('/volume/' + v.slug + '?p=3'); assert.ok(/<aside class="vlf" data-vlf aria-label="This page" hidden>/.test(r.h), 'on another page the about waits for its button');
    console.log('ok: a volume\'s about and source: written on the desk, escaped, shown at its head and on its first page');

    // 3. Pairing by hand.
    h = await (await fetch(base + '/studio/volumes?show=open&pages=' + v.id, { headers: { cookie: jar } })).text();
    assert.ok(/<form class="vlf-dk" method="post" action="\/studio\/volumes\/\d+\/pages\/\d+\/leaf\?show=open">/.test(h) && /<input type="hidden" name="book" value="notebooks">/.test(h), 'beside each page: the one notes-book chosen');
    assert.ok(/<select id="vlf-\d+-\d+-m" name="ms"><option value="ash-ii">Ash\. II\. Ashburnham, II<\/option>/.test(h) && h.includes('<option value="ca">C.A. Codex Atlanticus</option>'), 'a select of the manuscripts the book cites');
    // A stranger cannot pair.
    let x = await post('/studio/volumes/' + v.id + '/pages/' + ws[2].id + '/leaf', { book: 'notebooks', ms: 'ca', leaf: '9b' }, null);
    assert.ok(x.status === 302 && /\/studio\/login/.test(x.headers.get('location')), 'a stranger is sent to sign in');
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM leaf_pairs').get().n, 0, 'and nothing is paired');
    // Refusals.
    x = await post('/studio/volumes/' + v.id + '/pages/' + ws[2].id + '/leaf', { book: 'notebooks', ms: 'ca', leaf: 'nine' }); assert.strictEqual(okOf(x), 'Type the leaf as Richter gives it, such as 172b.');
    x = await post('/studio/volumes/' + v.id + '/pages/' + ws[2].id + '/leaf', { book: 'notebooks', ms: 'ca', leaf: '11a' }); assert.strictEqual(okOf(x), 'No note in the book is on C.A. 11a.');
    x = await post('/studio/volumes/' + v.id + '/pages/' + ws[2].id + '/leaf', { book: 'river', ms: 'ca', leaf: '9b' }); assert.strictEqual(okOf(x), 'No book of numbered notes with manuscript lines by that name.');
    x = await post('/studio/volumes/' + v.id + '/pages/' + ws[2].id + '/leaf', { book: 'bare-notes', ms: 'ca', leaf: '9b' }); assert.strictEqual(okOf(x), 'No book of numbered notes with manuscript lines by that name.');
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM leaf_pairs').get().n, 0);
    // Page 3 is C.A. 9b, unsure; page 4 its other side (the abbreviation typed, not the key).
    x = await post('/studio/volumes/' + v.id + '/pages/' + ws[2].id + '/leaf', { book: 'notebooks', ms: 'ca', leaf: '9 b', unsure: '1' }); assert.strictEqual(okOf(x), 'Paired with C.A. 9b, marked unsure.');
    x = await post('/studio/volumes/' + v.id + '/pages/' + ws[3].id + '/leaf', { book: 'notebooks', ms: 'C.A.', leaf: '9b' }); assert.strictEqual(okOf(x), 'Paired with C.A. 9b.');
    x = await post('/studio/volumes/' + v.id + '/pages/' + ws[3].id + '/leaf', { book: 'notebooks', ms: 'ca', leaf: '10a' }); assert.strictEqual(okOf(x), 'That page is paired already; remove it first.');
    x = await post('/studio/volumes/' + v.id + '/pages/' + ws[4].id + '/leaf', { book: 'notebooks', ms: 'S.K.M. III', leaf: '1b' }); assert.strictEqual(okOf(x), 'Paired with S.K.M. III. 1b.');
    h = await (await fetch(base + '/studio/volumes?show=open&pages=' + v.id, { headers: { cookie: jar } })).text(); assert.ok(h.includes('Leaf C.A. 9b · unsure') && /\/unleaf\?show=open"><button class="link">Remove<\/button>/.test(h), 'the desk shows the pairing and Remove');
    // Under the note.
    r = await get('/read/notebooks?n=777');
    const n777 = r.h.match(/<div class="rdo-note" id="n777">[\s\S]*?<\/div>/)[0];
    assert.ok(n777.includes(`<span class="rdm-see"><a href="/volume/${v.slug}?p=3">See the leaf</a> · <a href="/easel/${ws[2].slug}?back=${encodeURIComponent('/volume/' + v.slug + '?p=3')}">Study</a> · <span class="rdm-un">unsure</span> · <a href="/volume/${v.slug}?p=4">also page 4</a></span></p>`), 'See the leaf, Study, unsure; its other side: ' + n777);
    assert.ok(!r.h.match(/<div class="rdo-note" id="n776">[\s\S]*?<\/div>/)[0].includes('See the leaf'), 'an unpaired leaf says nothing');
    r = await get('/read/notebooks?by=ms&ms=ca'); assert.ok(/Leaf<\/span> 9b<\/h2><p class="rdm-sl"><span class="rdm-see"><a href="\/volume\//.test(r.h), 'and on the by-manuscript page');
    // On the leaf.
    r = await get('/volume/' + v.slug + '?p=3');
    const p3 = r.h.match(/<section class="vlf-s" data-vlf-p="3"[^>]*>[\s\S]*?<\/section>/)[0];
    assert.ok(/aria-labelledby="vlf-h3">/.test(p3) && p3.includes('<h2 class="vlf-k" id="vlf-h3">Written on this leaf</h2><p class="vlf-src">Codex Atlanticus, 9b <span>(C.A. 9b)</span> <span class="vlf-un" title='), 'Written on this leaf, unsure: ' + p3);
    assert.ok(p3.includes('<li><a href="/read/notebooks?n=777"><b>777</b> <span class="vlf-t">The text of note 777, on the second side.</span></a></li><li><a href="/read/notebooks?n=778">'), 'its notes, linked into the book');
    assert.ok(/<aside class="vlf" data-vlf aria-label="This page">/.test(r.h), 'shown on its page');
    r = await get('/volume/' + v.slug + '?p=5'); assert.ok(r.h.includes('The Forster codices (South Kensington Museum), III, 1b') && r.h.includes('?n=779"') && !/data-vlf-p="5"[^>]*>[\s\S]*?vlf-un[\s\S]*?<\/section>/.test(r.h.match(/data-vlf-p="5"[\s\S]*?<\/section>/)[0]), 'a sure pairing says no unsure');
    // Removed.
    x = await post('/studio/volumes/' + v.id + '/pages/' + ws[2].id + '/unleaf?show=open', {}); assert.strictEqual(okOf(x), 'Pairing removed.');
    r = await get('/read/notebooks?n=777'); assert.ok(r.h.match(/<div class="rdo-note" id="n777">[\s\S]*?<\/div>/)[0].includes(`<a href="/volume/${v.slug}?p=4">See the leaf</a>`) && !r.h.includes('rdm-un'), 'removed: only page 4 stays');
    // A page taken out of the volume takes its pairing with it.
    await post('/studio/volumes/' + v.id + '/pages/' + ws[0].id + '/out', {});
    r = await get('/read/notebooks?n=777'); assert.ok(r.h.includes(`<a href="/volume/${v.slug}?p=3">See the leaf</a>`), 'the page number follows the volume');
    await post('/studio/volumes/' + v.id + '/pages/' + ws[3].id + '/out', {});
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM leaf_pairs WHERE work_id=?').get(ws[3].id).n, 0, 'taken out: unpaired');
    r = await get('/read/notebooks?n=777'); assert.ok(!r.h.match(/<div class="rdo-note" id="n777">[\s\S]*?<\/div>/)[0].includes('See the leaf'));
    // Closed: the leaf links go, the pairings are kept for when it opens again.
    await post('/studio/volumes/' + v.id, { title: 'Codex Atlanticus', do: 'close' });
    r = await get('/read/notebooks?n=779'); assert.ok(!r.h.includes('See the leaf'), 'a closed volume is not linked');
    // 5. The register keeps each, off the public stream.
    for (const t of ['leaf.paired', 'leaf.unpaired']) assert.ok(db.prepare('SELECT 1 x FROM ledger WHERE type=? LIMIT 1').get(t), t);
    h = await (await fetch(base + '/register')).text(); assert.ok(!/leaf\.|paired/i.test(h), 'hidden from the register');
    console.log('ok: a leaf paired by hand: shown under the note and on the leaf, unsure said, removed; a stranger cannot pair; the register keeps it, hidden');
    console.log('all leaves checks pass');
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
