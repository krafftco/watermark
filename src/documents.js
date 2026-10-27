// The document kind (Will, 27 Oct: "a PDF or a folder of page scans comes in as a book"; the exhibition catalogue, the
// finding aid, the monograph: the thing every institution has boxes of). A PDF, or a set of page images, becomes a `texts`
// row of kind 'document': every page kept as a picture (`texts.pictures`, each with `page: n`, 1600 px, in the vault
// under texts/<slug>/), the text read from the file's own layer (pdftotext) or, when a page has none, by OCR (tesseract),
// set into paragraphs and chapters the reading room's way (reading.js `chapters`, `polish`), so it reads, searches, shares
// and faces a translation like any book; the original file kept byte for byte (documents/<slug>.pdf) and served at
// /read/<slug>/original.pdf. The reader shows it two ways: the text, and the pages (?pages=1), one page a screen.
// Doors: Studio → Back office → Documents (/studio/documents: a PDF or page images, or a PDF by address), and Feeds in
// (a CSV with a `pdf` column). Tools: poppler (pdfinfo, pdftoppm, pdftotext) and tesseract, in the Dockerfile; without them
// the desk says so and takes images only.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { execFile } = require('child_process');

const MAX_PAGES = +process.env.DOC_MAX_PAGES || 600;       // a run's cap; longer books come in to here
const OCR_PAGES = +process.env.DOC_OCR_PAGES || 400;       // OCR is slow (a second or two a page); past this the rest is pages only
const OCR_ON = process.env.DOC_OCR !== '0';
const PAGE_PX = 1600;
const MAX_MB = +process.env.DOC_MAX_MB || 300;

const run = (cmd, args, opts = {}) => new Promise((ok, no) => execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 120000, ...opts }, (e, out, err) => e ? no(new Error(`${cmd}: ${(err || e.message || '').toString().trim().slice(0, 200)}`)) : ok(out)));
const has = cmd => { try { require('child_process').execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch (e) { return false; } };

function mountDocuments(app, { db, V, C, store, isStudio, studioOnly, ledger, upload, doFetch }) {
  const { esc, tidy } = V;
  try { db.exec('ALTER TABLE texts ADD COLUMN doc TEXT'); } catch (e) { /* has it */ }
  const dir = path.join(C.dataDir, 'texts'); fs.mkdirSync(dir, { recursive: true });
  const originals = path.join(C.dataDir, 'documents'); fs.mkdirSync(originals, { recursive: true });
  const incoming = path.join(C.dataDir, 'incoming'); fs.mkdirSync(incoming, { recursive: true });
  const sharp = require('sharp');
  const TOOLS = { pdf: has('pdfinfo') && has('pdftoppm') && has('pdftotext'), ocr: OCR_ON && has('tesseract') };
  const R = () => app.locals.reading;
  const slugify = t => String(t).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'document';
  const norm = x => String(x || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const docOf = t => { try { return t && t.doc ? JSON.parse(t.doc) : null; } catch (e) { return null; } };
  const pagesOf = t => { try { return (t && t.pictures ? JSON.parse(t.pictures) : []).filter(p => p.page); } catch (e) { return []; } };

  // The words of a page, set into paragraphs: a line ending in a hyphen joins the next, a blank line ends a paragraph,
  // a short line ending in a full stop ends one too, and a page's running head or number alone is let go.
  function paragraphs(text) {
    const t = String(text || '').replace(/\r/g, '').replace(/\f/g, '\n').replace(/[ \t]+$/gm, '').replace(/(\w)-\n(?=[a-z])/g, '$1');
    const lines = t.split('\n'); const out = []; let cur = [];
    const flush = () => { const p = cur.join(' ').replace(/\s{2,}/g, ' ').trim(); if (p && !/^\d{1,4}$/.test(p) && !/^[ivxlc]{1,6}$/i.test(p)) out.push(p); cur = []; };
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) { flush(); continue; }
      cur.push(l);
      if (/[.!?”’"')\]]$/.test(l) && l.length < 48 && cur.length > 1) flush();
    }
    flush();
    return out.filter(p => /[a-zA-Z]{2}/.test(p));
  }
  const wordy = s => (String(s || '').match(/[A-Za-z]{2,}/g) || []).length;

  async function pdfPages(file) {
    const info = await run('pdfinfo', [file]); const n = +((info.match(/Pages:\s+(\d+)/) || [])[1] || 0);
    if (!n) throw new Error('the PDF has no pages the house can read');
    return Math.min(n, MAX_PAGES);
  }
  // Render a PDF's pages to the folder as pl-<n>.jpg (1600 px on the long side).
  async function renderPdf(file, outDir, n) {
    fs.mkdirSync(outDir, { recursive: true });
    const prefix = path.join(outDir, 'pg');
    await run('pdftoppm', ['-jpeg', '-jpegopt', 'quality=88', '-r', '110', '-scale-to', String(PAGE_PX), '-f', '1', '-l', String(n), file, prefix], { timeout: 20 * 60 * 1000 });
    const made = fs.readdirSync(outDir).filter(f => /^pg-\d+\.jpg$/.test(f)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    const out = [];
    for (let i = 0; i < made.length; i++) { const to = path.join(outDir, `pl-${i + 1}.jpg`); fs.renameSync(path.join(outDir, made[i]), to); out.push(to); }
    return out;
  }
  async function layerText(file, i) { try { return await run('pdftotext', ['-layout', '-f', String(i), '-l', String(i), file, '-']); } catch (e) { return ''; } }
  async function ocr(img) { try { return await run('tesseract', [img, 'stdout', '--psm', '3', '-l', 'eng'], { timeout: 180000 }); } catch (e) { return ''; } }

  // Take a document in: `src` = { pdf } or { images: [files] }; `meta` = title, author, year, source, terms, public, summary, lang, illustrator.
  async function take(src, meta, { by = 'the house' } = {}) {
    const title = tidy(String(meta.title || '').trim().slice(0, 160)); if (!title) throw new Error('a title');
    if (meta.source) { const had = db.prepare('SELECT slug FROM texts WHERE source=?').get(meta.source); if (had) return { slug: had.slug, already: true }; }
    let slug = slugify(title); if (db.prepare('SELECT 1 FROM texts WHERE slug=?').get(slug)) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
    const pdir = path.join(dir, slug); fs.mkdirSync(pdir, { recursive: true });
    let files = [], layer = [], sha = null, kept = null, n = 0;
    if (src.pdf) {
      if (!TOOLS.pdf) throw new Error('the house cannot read a PDF here (poppler is not installed)');
      const st = fs.statSync(src.pdf); if (st.size > MAX_MB * 1024 * 1024) throw new Error(`over ${MAX_MB} MB`);
      sha = crypto.createHash('sha256').update(fs.readFileSync(src.pdf)).digest('hex');
      n = await pdfPages(src.pdf);
      files = await renderPdf(src.pdf, pdir, n);
      for (let i = 1; i <= files.length; i++) layer.push(await layerText(src.pdf, i));
      kept = path.join(originals, `${slug}.pdf`); fs.copyFileSync(src.pdf, kept);
      try { if (store && store.kind === 's3') await store.put(`documents/${slug}.pdf`, kept, 'application/pdf'); } catch (e) { /* the local copy serves */ }
    } else if (src.images && src.images.length) {
      const list = src.images.slice(0, MAX_PAGES);
      for (let i = 0; i < list.length; i++) {
        const to = path.join(pdir, `pl-${i + 1}.jpg`);
        try { await sharp(list[i], { failOn: 'error' }).rotate().resize({ width: PAGE_PX, height: Math.round(PAGE_PX * 1.45), fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(to); files.push(to); layer.push(''); } catch (e) { /* a page that does not decode is left out */ }
      }
      n = files.length;
    } else throw new Error('a PDF or page images');
    if (!files.length) throw new Error('no pages could be read');
    // The text: the layer where there is one, OCR where there is none (to the cap), and the pages' first lines remembered.
    let ocrN = 0; const pageText = [];
    for (let i = 0; i < files.length; i++) {
      let tx = layer[i] || '';
      if (wordy(tx) < 12 && TOOLS.ocr && ocrN < OCR_PAGES) { tx = await ocr(files[i]); ocrN++; }
      pageText.push(paragraphs(tx));
    }
    const words = pageText.reduce((a, ps) => a + ps.reduce((b, p) => b + wordy(p), 0), 0);
    let body = null; const where = [];
    if (words >= 40 && R()) {
      const full = pageText.map(ps => ps.join('\n\n')).filter(Boolean).join('\n\n');
      const chs = R().chapters(full);
      // Where each page begins, as the reader's chapter and paragraph: its first paragraph found in order.
      const idx = []; chs.forEach((c, ci) => { if (c.head) idx.push({ c: ci, p: 0, n: norm(c.head), head: true }); c.paras.forEach((p, pj) => idx.push({ c: ci, p: pj, n: norm(p) })); });
      let ptr = 0;
      for (let i = 0; i < pageText.length; i++) {
        const first = pageText[i][0]; if (!first) { where.push(null); continue; }
        const probe = norm(first).slice(0, 60); let hit = -1;
        for (let k = ptr; k < idx.length && k < ptr + 400; k++) { if (idx[k].n.startsWith(probe) || (probe.length > 30 && idx[k].n.includes(probe.slice(0, 40)))) { hit = k; break; } }
        if (hit >= 0) { where.push({ c: idx[hit].c, p: idx[hit].p }); ptr = hit; } else where.push(null);
      }
      body = toBody(chs);
    }
    const pics = [];
    for (let i = 0; i < files.length; i++) {
      let m = {}; try { m = await sharp(files[i]).metadata(); } catch (e) { /* */ }
      try { if (store && store.kind === 's3') await store.put(`texts/${slug}/pl-${i + 1}.jpg`, files[i], 'image/jpeg'); } catch (e) { /* retried by hand; the local copy serves */ }
      const w = where[i];
      pics.push({ n: i + 1, page: i + 1, w: m.width || 0, h: m.height || 0, caption: `Page ${i + 1}`, cover: i === 0, ...(w ? { c: w.c, p: w.p, at: 'before' } : { c: -1, p: -1, at: 'end' }) });
    }
    const terms = String(meta.terms || '').trim().slice(0, 400) || 'Public domain. Read freely; the house asks only that you credit the author and the source.';
    const doc = { pages: files.length, text: body ? (ocrN ? (ocrN === files.length ? 'ocr' : 'mixed') : 'layer') : 'none', ocr: ocrN, words, sha256: sha, pdf: kept ? path.basename(kept) : null, by, at: new Date().toISOString() };
    db.prepare("INSERT INTO texts (slug, kind, title, author, year, summary, body, public, price_cents, terms, source, status, pictures, illustrator, doc, lang) VALUES (?,?,?,?,?,?,?,?,?,?,?,'held',?,?,?,?)")
      .run(slug, 'document', title, String(meta.author || '').trim().slice(0, 160) || null, String(meta.year || '').trim().slice(0, 12) || null, String(meta.summary || '').trim().slice(0, 1000) || null, body, meta.public === false || meta.public === 0 || meta.public === '0' ? 0 : 1, null, terms, String(meta.source || '').trim().slice(0, 300) || null, JSON.stringify(pics), String(meta.illustrator || '').trim().slice(0, 120) || null, JSON.stringify(doc), String(meta.lang || 'en').slice(0, 5));
    try { const SH = require('./shelves'); db.prepare('UPDATE texts SET shelf=? WHERE slug=?').run(meta.shelf || SH.classify({ kind: 'document', title, source: meta.source || '' }) || 'history', slug); } catch (e) { /* */ }
    try { ledger.append(db, 'text.shelved', slug, { title, author: meta.author || null, from: 'document', pages: files.length, words, by }); } catch (e) { /* */ }
    if (app.locals.findIndexDirty) app.locals.findIndexDirty();
    return { slug, pages: files.length, words, ocr: ocrN, text: doc.text };
  }
  function toBody(chs) { const Rd = R(); return chs.map(c => (c.head ? `## ${/^[A-Z0-9 .,:;'’—-]+$/.test(c.head) && /[A-Z]{3}/.test(c.head) ? Rd.titleCase(c.head) : c.head}\n\n` : '') + c.paras.map(p => /^[\s*\-_—·]{3,}$/.test(p) ? '* * *' : Rd.polish(p)).join('\n\n')).join('\n\n'); }

  // A PDF by address (a feed's row, or the desk): fetched to incoming/, taken, the file dropped.
  async function bringUrl(meta, { by = 'feed' } = {}) {
    const url = String(meta.pdf || meta.url || '').trim(); if (!/^https?:\/\//.test(url)) throw new Error('an https address of a PDF');
    const source = meta.source || url;
    const had = db.prepare('SELECT slug FROM texts WHERE source=?').get(source); if (had) return { slug: had.slug, already: true };
    const r = await doFetch(url); if (!r.ok) throw new Error(`pdf ${r.status}`);
    const ct = String(r.headers.get('content-type') || ''); const buf = Buffer.from(await r.arrayBuffer());
    if (!/^%PDF/.test(buf.slice(0, 5).toString('latin1')) && !/pdf/i.test(ct)) throw new Error('not a PDF');
    if (buf.length > MAX_MB * 1024 * 1024) throw new Error(`over ${MAX_MB} MB`);
    const tmp = path.join(incoming, `doc-${crypto.randomBytes(6).toString('hex')}.pdf`); fs.writeFileSync(tmp, buf);
    try { return await take({ pdf: tmp }, { ...meta, title: meta.title || path.basename(url).replace(/\.pdf$/i, '').replace(/[-_]+/g, ' '), source }, { by }); } finally { try { fs.unlinkSync(tmp); } catch (e) { /* */ } }
  }

  // The queue: one document at a time in the background; the desk shows each as it lands.
  const q = []; let on = false; const job = { on: false, at: 0, of: 0, now: null, done: [], missed: [] };
  async function pump() {
    if (on) return; on = true; job.on = true;
    while (q.length) {
      const it = q.shift(); job.at++; job.now = it.meta.title || it.meta.pdf || 'a document';
      try { const r = it.src.url ? await bringUrl({ ...it.meta, pdf: it.src.url }, { by: 'desk' }) : await take(it.src, it.meta, { by: 'desk' }); job.done.push(`${it.meta.title || r.slug}: ${r.pages || ''} pages${r.words ? `, ${r.words} words${r.ocr ? ` (${r.ocr} by OCR)` : ''}` : ', pages only'}`); }
      catch (e) { job.missed.push(`${it.meta.title || it.src.url || 'a document'}: ${e.message}`); }
      finally { for (const f of [it.src.pdf, ...(it.src.images || [])].filter(Boolean)) { try { fs.unlinkSync(f); } catch (e) { /* */ } } }
      job.now = null;
    }
    on = false; job.on = false;
  }
  function queue(src, meta) { q.push({ src, meta }); job.of++; setTimeout(pump, app.locals.noTimers ? 0 : 200); }

  // The original file.
  app.get('/read/:slug/original.pdf', (req, res) => {
    const t = db.prepare("SELECT slug, title, public, status, doc FROM texts WHERE slug=?").get(String(req.params.slug)); const d = docOf(t);
    if (!t || t.status !== 'held' || (!t.public && !isStudio(req)) || !d || !d.pdf) return res.sendStatus(404);
    const f = path.join(originals, d.pdf); if (!fs.existsSync(f)) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=86400'); res.type('pdf'); res.set('Content-Disposition', `inline; filename="${encodeURIComponent(t.title)}.pdf"`); fs.createReadStream(f).pipe(res);
  });

  // The desk.
  const list = () => db.prepare("SELECT slug, title, author, year, public, status, doc, pictures, source FROM texts WHERE kind='document' ORDER BY id DESC").all();
  app.get('/studio/documents', studioOnly, (req, res) => {
    const rows = list();
    res.send(V.layout({ studio: true, title: 'Documents · Studio', path: '/studio/documents', desc: '', body: `${job.on ? '<script>setTimeout(function(){location.reload()},5000)</script>' : ''}<main class="wrap dc"><p class="k">The Studio · Back office</p><h1>Documents.</h1>
<p class="lede">A PDF, or the pages of a book as images, comes in as a book: every page kept, the text read from the file or by OCR, set for the reading room; the original kept untouched. ${TOOLS.pdf ? '' : '<b>The house cannot read a PDF on this box (poppler is not installed): pages as images only.</b> '}${TOOLS.ocr ? 'OCR is on for pages with no text of their own.' : 'OCR is off: a scan without a text layer comes in as pages alone.'}</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<section class="dc-form"><h2>Bring one in</h2><form method="post" action="/studio/documents" enctype="multipart/form-data" class="dc-f">
<label>Title<input name="title" required maxlength="160" placeholder="The title as it stands on the page"></label>
<label>Author or institution<input name="author" maxlength="160"></label>
<label>Year<input name="year" maxlength="12" placeholder="1911"></label>
<label>Source (an address, kept as the record)<input name="source" maxlength="300" placeholder="https://…"></label>
<label>Terms<input name="terms" maxlength="400" placeholder="Public domain · CC0 · CC BY (the Met)…"></label>
<label>A line about it<input name="summary" maxlength="400"></label>
<label>The file: a PDF, or the pages as images (JPEG, PNG, TIFF), in order<input type="file" name="files" multiple accept="application/pdf,image/jpeg,image/png,image/tiff,image/webp"></label>
<label>Or a PDF by address<input name="url" placeholder="https://…/catalogue.pdf"></label>
<label class="dc-ck"><input type="checkbox" name="public" value="1" checked> Shown at once</label>
<button class="buy-btn" type="submit">Bring it in</button></form>
<p class="note">A run reads up to ${MAX_PAGES} pages; OCR to ${OCR_PAGES}. Many at once: Feeds in takes a CSV with a <code>pdf</code> column (title, author, pdf, year, source, terms).</p></section>
<section><h2>The queue</h2><p class="note">${job.on ? `Reading now: ${esc(job.now || '')} · ${job.at} of ${job.of}` : (job.of ? `Done: ${job.at} of ${job.of}.` : 'Nothing waiting.')}${job.done.length ? `<br>${esc(job.done.slice(-8).join(' · '))}` : ''}${job.missed.length ? `<br><b>Not taken:</b> ${esc(job.missed.slice(-8).join(' · '))}` : ''}</p></section>
<section><h2>On the shelf · ${rows.length}</h2>${rows.length ? `<table class="tbl"><tr><th>Title</th><th>Pages</th><th>Text</th><th>Shown</th><th></th></tr>${rows.map(t => { const d = docOf(t) || {}; return `<tr><td><a href="/library/${esc(t.slug)}">${esc(t.title)}</a>${t.author ? `<br><small>${esc(t.author)}${t.year ? `, ${esc(t.year)}` : ''}</small>` : ''}</td><td>${d.pages || pagesOf(t).length}</td><td>${d.text === 'layer' ? 'the file’s own' : d.text === 'ocr' ? `OCR` : d.text === 'mixed' ? `the file’s and OCR` : 'pages only'}${d.words ? ` · ${d.words.toLocaleString('en-US')} words` : ''}</td><td>${t.public ? 'yes' : 'held'}</td><td><a href="/read/${esc(t.slug)}?pages=1">Pages</a>${d.pdf ? ` · <a href="/read/${esc(t.slug)}/original.pdf">Original</a>` : ''} · <a href="/studio/library/${esc(t.slug)}">Edit</a></td></tr>`; }).join('')}</table>` : '<p class="note">No document yet.</p>'}</section></main>` }));
  });
  app.post('/studio/documents', studioOnly, upload.array('files', MAX_PAGES), (req, res) => {
    const b = req.body || {}; const files = req.files || [];
    const meta = { title: b.title, author: b.author, year: b.year, source: b.source, terms: b.terms, summary: b.summary, public: b.public ? 1 : 0 };
    const pdf = files.find(f => /pdf/i.test(f.mimetype) || /\.pdf$/i.test(f.originalname));
    const images = files.filter(f => f !== pdf && /^image\//.test(f.mimetype)).sort((x, y) => x.originalname.localeCompare(y.originalname, undefined, { numeric: true })).map(f => f.path);
    const url = String(b.url || '').trim();
    if (!b.title && !url) { for (const f of files) { try { fs.unlinkSync(f.path); } catch (e) { /* */ } } return res.redirect('/studio/documents?ok=' + encodeURIComponent('A title, please.')); }
    if (pdf) { for (const f of files) if (f !== pdf) { try { fs.unlinkSync(f.path); } catch (e) { /* */ } } queue({ pdf: pdf.path }, meta); }
    else if (images.length) queue({ images }, meta);
    else if (url) queue({ url }, meta);
    else return res.redirect('/studio/documents?ok=' + encodeURIComponent('A PDF, page images, or an address.'));
    res.redirect('/studio/documents?ok=' + encodeURIComponent(`Taking it in: the pages are rendered and read in the background; this page shows it when it lands.`));
  });

  // For the reader: the pages as chapters (one a screen) and the toggle between the text and the pages.
  function pageChapters(t) { return pagesOf(t).map(p => ({ head: null, paras: [], page: p })); }
  function pageFigure(t, p, total) { return `<figure class="rdr-pl rdr-pgf"><img src="/read/${esc(t.slug)}/pic/${p.n}" alt="Page ${p.page}" width="${p.w}" height="${p.h}" loading="lazy"><figcaption><b>Page ${p.page}</b><span>of ${total}</span></figcaption></figure>`; }
  app.locals.documents = { take, bringUrl, queue, job, docOf, pagesOf, pageChapters, pageFigure, TOOLS, paragraphs, MAX_PAGES };
  return app.locals.documents;
}

module.exports = { mountDocuments };
