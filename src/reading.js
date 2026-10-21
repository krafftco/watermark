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
//   The reader: /read/:slug, the house's reading room (`.rd`): the text set in Newsreader at a measure of 34em, a
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
const GUTENDEX = process.env.GUTENDEX || 'https://gutendex.com/books';
function mountReading(app, { db, V, C, isStudio, ledger, fetchImpl }) {
  const { esc, tidy } = V;
  const doFetch = (...a) => (fetchImpl || fetch)(...a);
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
  const toBody = chs => chs.map(c => (c.head ? `## ${c.head}\n\n` : '') + c.paras.join('\n\n')).join('\n\n');
  // A Gutenberg book, by number: metadata from Gutendex, the text from gutenberg.org.
  async function bring(id, { why = null, by = 'the house' } = {}) {
    id = +id; if (!id) throw new Error('a number');
    const had = db.prepare("SELECT slug FROM texts WHERE source LIKE ?").get(`%gutenberg.org/ebooks/${id}%`); if (had) return { slug: had.slug, already: true };
    const mr = await doFetch(`${GUTENDEX}/${id}`); if (!mr.ok) throw new Error(`Gutendex ${mr.status}`); const meta = await mr.json();
    const f = meta.formats || {}; const url = Object.keys(f).filter(k => /^text\/plain/.test(k) && !/\.zip$/.test(f[k])).map(k => f[k]).sort((a, b) => (/utf-8/.test(b) ? 1 : 0) - (/utf-8/.test(a) ? 1 : 0))[0];
    if (!url) throw new Error('no plain text');
    const tr = await doFetch(url); if (!tr.ok) throw new Error(`gutenberg ${tr.status}`); const raw = await tr.text();
    const text = strip(raw); if (text.length < 2000) throw new Error('too little text');
    const chs = chapters(text); const body = toBody(chs);
    const author = (meta.authors && meta.authors[0] && meta.authors[0].name) || null; const title = tidy(String(meta.title || `Gutenberg ${id}`).split(/\r?\n/)[0].slice(0, 160));
    let slug = slugify(title); if (db.prepare('SELECT 1 FROM texts WHERE slug=?').get(slug)) slug = `${slug}-${id}`;
    const year = (meta.authors && meta.authors[0] && meta.authors[0].death_year) ? null : null;
    db.prepare("INSERT INTO texts (slug, kind, title, author, year, summary, body, public, price_cents, terms, source, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,'held')").run(slug, 'book', title, author, year, why || `From Project Gutenberg, No. ${id}. Public domain; set by the house.`, body, 1, null, 'Public domain. Read freely; the house asks only that you credit the author.', `https://www.gutenberg.org/ebooks/${id}`);
    try { ledger.append(db, 'text.shelved', slug, { title, author, from: 'gutenberg', by }); } catch (e) { /* */ }
    return { slug, title, author, chapters: chs.length, words: body.split(/\s+/).length };
  }
  async function search(q) { const r = await doFetch(`${GUTENDEX}?search=${encodeURIComponent(q)}`); if (!r.ok) throw new Error(`Gutendex ${r.status}`); const j = await r.json(); return (j.results || []).slice(0, 12).map(b => ({ id: b.id, title: b.title, author: (b.authors[0] || {}).name || '', downloads: b.download_count, languages: b.languages })); }
  // The reader.
  app.get('/read/:slug', (req, res) => {
    const t = db.prepare("SELECT t.*, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.slug=?").get(String(req.params.slug));
    if (!t || !t.body || (!t.public && !isStudio(req)) || t.status !== 'held') return res.sendStatus(404);
    const chs = []; let cur = { head: null, paras: [] };
    for (const p of String(t.body).split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) { if (/^##?\s/.test(p)) { if (cur.head || cur.paras.length) chs.push(cur); cur = { head: p.replace(/^#+\s*/, ''), paras: [] }; } else cur.paras.push(p); }
    if (cur.head || cur.paras.length) chs.push(cur);
    const at = Math.max(0, Math.min(chs.length - 1, +(req.query.c || 0) || 0));
    const words = String(t.body).split(/\s+/).length;
    res.send(V.layout({ title: `${t.title} · Watermark`, path: `/read/${t.slug}`, desc: `${t.title}${t.author ? ', ' + t.author : ''}. Read in the house.`, bare: true, body: `<main class="rd" data-read='${esc(JSON.stringify({ slug: t.slug, n: chs.length, at }))}'>
<header class="rd-bar"><a class="rd-back" href="/library/${esc(t.slug)}">${require('./icons').back}<span>The Library</span></a><p class="rd-run"><b>${esc(t.title)}</b>${t.author ? `<span>${esc(t.author)}</span>` : ''}</p><div class="rd-ctl"><button type="button" data-rd-toc aria-label="Chapters">${require('./icons').page}<span>Chapters</span></button><button type="button" data-rd-size="-" aria-label="Smaller">A−</button><button type="button" data-rd-size="+" aria-label="Larger">A+</button><button type="button" data-rd-theme aria-label="Paper, sepia or night">${require('./icons').dial || ''}<span>Light</span></button></div></header>
<nav class="rd-toc" data-rd-toc-panel hidden><p class="k">Chapters · ${chs.length}</p><ol>${chs.map((c, i) => `<li><a href="?c=${i}" data-c="${i}"${i === at ? ' aria-current="page"' : ''}>${esc(c.head || (i === 0 ? 'The beginning' : `Part ${i + 1}`))}</a></li>`).join('')}</ol><p class="rd-src">${esc(words.toLocaleString('en-US'))} words${t.source ? ` · <a href="${esc(t.source)}" rel="noopener">the source</a>` : ''} · ${esc(t.terms || 'Public domain')}</p></nav>
<article class="rd-page">${chs.map((c, i) => `<section class="rd-ch" data-ch="${i}"${i === at ? '' : ' hidden'}>${c.head ? `<p class="rd-no">${i === 0 && chs.length > 1 && !/\d|[IVXLC]/.test(c.head) ? '' : `${i + 1} of ${chs.length}`}</p><h2>${esc(c.head)}</h2>` : (i === 0 ? `<h1 class="rd-title">${esc(t.title)}</h1>${t.author ? `<p class="rd-author">${esc(t.author)}</p>` : ''}` : `<p class="rd-no">${i + 1} of ${chs.length}</p>`)}${c.paras.map((p, j) => `<p${j === 0 ? ' class="rd-first"' : ''}>${esc(p)}</p>`).join('')}<footer class="rd-foot">${i > 0 ? `<a href="?c=${i - 1}" data-c="${i - 1}" class="rd-prev">← ${esc(chs[i - 1].head || 'Before')}</a>` : '<span></span>'}${i < chs.length - 1 ? `<a href="?c=${i + 1}" data-c="${i + 1}" class="rd-next">${esc(chs[i + 1].head || 'On')} →</a>` : `<a href="/library" class="rd-next">The end. The Library →</a>`}</footer></section>`).join('')}</article>
</main><script src="/static/read.js?v=${esc(V.VER)}" defer></script>` }));
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
<h2>Franklin’s shelf</h2><p class="note">The books Franklin names in the Autobiography as the ones that made him, and his own. Each press searches Gutenberg by title and author and shows what it finds; the house never guesses a number.</p>
<table class="tbl"><tr><th>Book</th><th>Why</th><th></th></tr>${FRANKLIN.map(b => { const h = shelved(b); return `<tr><td><b>${esc(b.title)}</b><br><small>${esc(b.author)}</small></td><td><small>${esc(b.why)}</small></td><td>${h ? `<a href="/read/${esc(h.slug)}">On the shelf</a>` : `<a href="?q=${encodeURIComponent(b.title + ' ' + b.author.split(',')[0])}">Find it</a>`}</td></tr>`; }).join('')}</table>
${have.length ? `<h2>On the shelf from Gutenberg</h2><ul>${have.map(h => `<li><a href="/read/${esc(h.slug)}">${esc(h.title)}</a>${h.author ? ` <small>${esc(h.author)}</small>` : ''}</li>`).join('')}</ul>` : ''}</section>` }));
  });
  app.post('/studio/reading/bring', async (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    try { const r = await bring(req.body.id, { by: 'the house' }); res.redirect('/studio/reading?ok=' + encodeURIComponent(r.already ? 'Already on the shelf.' : `${r.title} is on the shelf: ${r.chapters} chapters, ${r.words.toLocaleString('en-US')} words.`)); }
    catch (e) { res.redirect('/studio/reading?ok=' + encodeURIComponent('Could not bring it in: ' + e.message)); }
  });
  app.locals.reading = { bring, search, strip, chapters, FRANKLIN };
  return app.locals.reading;
}
module.exports = { mountReading, FRANKLIN };
