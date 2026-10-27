// Standard Ebooks (27 Oct, the survey's first target for texts: the finest modern editions of the public domain, typeset,
// proofed against scans, semantic XHTML, the editorial work CC0 and the texts US public domain). The house takes a book from
// its GitHub source (raw.githubusercontent.com/standardebooks/<repo>/master/src/epub/): the record from content.opf (title,
// author, the abstract and description, LCSH subjects, the Gutenberg transcription it was made from), the chapters from the
// spine's XHTML in order (front and back matter left out), every <p> set as a paragraph with its emphasis kept as *word*,
// a <hr> as a section break, every illustration (SVG or raster) kept as a picture placed before the paragraph it precedes.
// When the house already shelves the same book from Gutenberg (dc:source names the number), the Standard Ebooks text takes
// its place: the slug, the reading list and the commonplace stay; the edition line says so. The address kept as source is
// the ebook's own page on standardebooks.org. Feeds in kind 'se': a list of ebook addresses or repos a line, or the whole
// catalogue (the org's repositories through api.github.com, or the site's listing pages).
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');

const RAW = 'https://raw.githubusercontent.com/standardebooks';
const SKIP = /^(titlepage|imprint|halftitlepage|halftitle|colophon|uncopyright|toc|loi|dedication|epigraph|frontispiece)\b/i;
const MAX_PICTURES = 120;

const unx = x => String(x || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const untag = h => unx(String(h || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
// Inline XHTML to the house's paragraph form: emphasis as *word*, abbreviations and spans unwrapped, line breaks as spaces.
function inline(h) {
  return unx(String(h || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<(em|i|cite)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, t, x) => `*${x.replace(/<[^>]+>/g, '')}*`)
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ').replace(/\*\s+\*/g, ' ').trim();
}
// The repository name from an ebook's address, a repo name, or a GitHub address.
function repoOf(s) {
  s = String(s || '').trim();
  let m = s.match(/standardebooks\.org\/ebooks\/([a-z0-9-]+)\/([a-z0-9-]+)/i); if (m) return `${m[1]}_${m[2]}`;
  m = s.match(/github\.com\/standardebooks\/([a-z0-9_-]+)/i); if (m) return m[1];
  if (/^[a-z0-9-]+_[a-z0-9_-]+$/i.test(s)) return s;
  return null;
}
// content.opf → the record and the spine.
function parseOpf(xml) {
  const g = re => { const m = xml.match(re); return m ? unx(m[1]).trim() : ''; };
  const title = g(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/);
  const author = g(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/);
  const abstract = g(/<meta property="schema:abstract">([\s\S]*?)<\/meta>/);
  const description = untag(unx(g(/<dc:description>([\s\S]*?)<\/dc:description>/)));
  const lang = g(/<dc:language>([\s\S]*?)<\/dc:language>/).slice(0, 2) || 'en';
  const id = g(/<dc:identifier[^>]*>([\s\S]*?)<\/dc:identifier>/);
  const subjects = [...xml.matchAll(/<dc:subject[^>]*>([\s\S]*?)<\/dc:subject>/g)].map(m => unx(m[1]).trim());
  const sources = [...xml.matchAll(/<dc:source>([\s\S]*?)<\/dc:source>/g)].map(m => unx(m[1]).trim());
  const gutenberg = (sources.map(s => (s.match(/gutenberg\.org\/ebooks\/(\d+)/) || [])[1]).find(Boolean)) || null;
  const items = {}; for (const m of xml.matchAll(/<item\s+([^>]*)\/>/g)) { const a = m[1]; const href = (a.match(/href="([^"]+)"/) || [])[1], iid = (a.match(/id="([^"]+)"/) || [])[1]; if (href && iid) items[iid] = href; }
  const spine = [...xml.matchAll(/<itemref\s+idref="([^"]+)"/g)].map(m => items[m[1]]).filter(h => h && /^text\//.test(h));
  const words = +g(/<meta property="schema:wordCount">(\d+)<\/meta>/) || 0;
  return { title, author, abstract, description, lang, id, subjects, gutenberg, spine, words };
}
// A chapter's XHTML → { head, paras: [...], figures: [{ before: paraIndex, src, alt, caption }] }.
function parseChapter(xhtml) {
  const body = (xhtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, xhtml])[1];
  // The heading: the first h2–h4, its parts (an ordinal, a title) joined.
  let head = null; const hm = body.match(/<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/i);
  if (hm) { const parts = [...hm[2].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(m => untag(m[1])).filter(Boolean); head = (parts.length > 1 ? parts.join(': ') : untag(hm[2])) || null; }
  const paras = []; const figures = [];
  // Walk the block elements in order: p, blockquote > p, hr, figure/img.
  const re = /<(p|hr|figure|img|h[2-6])\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/gi; let m;
  while ((m = re.exec(body))) {
    const tag = m[1].toLowerCase(), attrs = m[2] || '', inner = m[4] || '';
    if (/^h[2-6]$/.test(tag)) { if (hm && m.index === hm.index) continue; const t = untag(inner); if (t && !paras.length && !head) head = t; else if (t) paras.push(`*${t}*`); continue; }
    if (tag === 'hr') { if (paras.length && paras[paras.length - 1] !== '* * *') paras.push('* * *'); continue; }
    if (tag === 'figure' || tag === 'img') {
      const src = (tag === 'img' ? attrs : inner).match(/src="([^"]+)"/); if (!src) continue;
      const alt = ((tag === 'img' ? attrs : inner).match(/alt="([^"]*)"/) || [])[1] || '';
      const cap = tag === 'figure' ? ((inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i) || [])[1]) : '';
      figures.push({ before: paras.length, src: src[1].replace(/^(\.\.\/)+/, ''), alt: untag(alt), caption: untag(cap || '') });
      continue;
    }
    if (tag === 'p') { if (/epub:type="[^"]*(?:se:|z3998:)?(?:title|ordinal)/.test(attrs) && !paras.length) continue; const t = inline(inner); if (t) paras.push(t); }
  }
  return { head, paras, figures };
}

function mountStandard(app, { db, V, C, store, isStudio, ledger, doFetch }) {
  const { tidy } = V;
  const dir = path.join(C.dataDir, 'texts');
  const slugify = t => String(t).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'book';
  const R = () => app.locals.reading;
  const sharp = require('sharp');

  async function bring(ref, { by = 'the house', why = null } = {}) {
    const repo = repoOf(ref); if (!repo) throw new Error('a Standard Ebooks address (standardebooks.org/ebooks/<author>/<title>) or a repository name');
    const page = `https://standardebooks.org/ebooks/${repo.replace('_', '/')}`;
    const had = db.prepare("SELECT slug FROM texts WHERE source=?").get(page); if (had) return { slug: had.slug, already: true };
    const base = `${RAW}/${repo}/master/src/epub`;
    const r = await doFetch(`${base}/content.opf`); if (!r.ok) throw new Error(`content.opf ${r.status}`);
    const opf = parseOpf(await r.text()); if (!opf.title || !opf.spine.length) throw new Error('no title or no spine');
    const chs = []; const pics = [];
    for (const href of opf.spine) {
      const name = href.replace(/^text\//, '').replace(/\.xhtml$/, ''); if (SKIP.test(name)) continue;
      const cr = await doFetch(`${base}/${href}`); if (!cr.ok) continue;
      const ch = parseChapter(await cr.text()); if (!ch.paras.length && !ch.figures.length) continue;
      const ci = chs.length; chs.push({ head: ch.head, paras: ch.paras });
      for (const f of ch.figures) { if (pics.length >= MAX_PICTURES) break; pics.push({ ...f, c: ci, p: Math.min(f.before, Math.max(0, ch.paras.length - 1)), at: f.before >= ch.paras.length ? 'after' : 'before' }); }
    }
    if (!chs.length) throw new Error('no chapters read');
    const Rd = R(); const polish = Rd ? Rd.polish : x => x;
    const body = chs.map(c => (c.head ? `## ${c.head}\n\n` : '') + c.paras.map(p => p === '* * *' ? p : polish(p)).join('\n\n')).join('\n\n');
    const title = tidy(opf.title.slice(0, 160)); const author = opf.author || null;
    const terms = 'Public domain in the United States. The edition is Standard Ebooks’ (its work dedicated to the public domain, CC0); read freely, credit the author.';
    const summary = (opf.abstract || opf.description.split(/(?<=\.)\s/)[0] || '').slice(0, 1000) || null;
    // The same book from Gutenberg already on the shelf: the better edition takes its place at the same address.
    let t = opf.gutenberg ? db.prepare("SELECT * FROM texts WHERE source=? OR source LIKE ?").get(`https://www.gutenberg.org/ebooks/${opf.gutenberg}`, `%gutenberg.org/ebooks/${opf.gutenberg}`) : null;
    if (!t && author) t = db.prepare("SELECT * FROM texts WHERE status='held' AND kind='book' AND lower(title)=lower(?) AND author IS NOT NULL AND (lower(author) LIKE lower(?) OR lower(?) LIKE '%' || lower(substr(author, 1, instr(author || ',', ',') - 1)) || '%')").get(title, `%${author.split(' ').pop()}%`, author);
    let slug, replaced = false;
    if (t) {
      slug = t.slug; replaced = true;
      db.prepare("UPDATE texts SET title=?, author=?, summary=COALESCE(?, summary), body=?, terms=?, source=?, lang=?, pictures=NULL, updated_at=datetime('now') WHERE id=?").run(title, author, summary, body, terms, page, opf.lang, t.id);
      try { for (const f of fs.existsSync(path.join(dir, slug)) ? fs.readdirSync(path.join(dir, slug)) : []) if (/^pl-\d+\.jpg$/.test(f)) fs.unlinkSync(path.join(dir, slug, f)); } catch (e) { /* */ }
    } else {
      slug = slugify(title); if (db.prepare('SELECT 1 FROM texts WHERE slug=?').get(slug)) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
      db.prepare("INSERT INTO texts (slug, kind, title, author, year, summary, body, public, price_cents, terms, source, status, lang) VALUES (?,?,?,?,?,?,?,?,?,?,?,'held',?)").run(slug, 'book', title, author, null, why || summary, body, 1, null, terms, page, opf.lang);
      t = db.prepare('SELECT * FROM texts WHERE slug=?').get(slug);
    }
    try { const SH = require('./shelves'); db.prepare('UPDATE texts SET subjects=?, shelf=? WHERE slug=?').run(JSON.stringify({ subjects: opf.subjects, bookshelves: [] }), SH.classify({ kind: 'book', title, source: page, subjects: opf.subjects, bookshelves: [] }), slug); } catch (e) { /* */ }
    // The illustrations, kept as the book's pictures.
    const out = []; if (pics.length) fs.mkdirSync(path.join(dir, slug), { recursive: true });
    for (const f of pics) {
      try {
        const ir = await doFetch(`${base}/${f.src}`); if (!ir.ok) continue; const buf = Buffer.from(await ir.arrayBuffer()); if (buf.length < 60) continue;
        const n = out.length + 1; const file = path.join(dir, slug, `pl-${n}.jpg`);
        const info = await sharp(buf, { density: 200 }).flatten({ background: '#ffffff' }).resize({ width: 1600, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(file);
        try { if (store && store.kind === 's3') await store.put(`texts/${slug}/pl-${n}.jpg`, file, 'image/jpeg'); } catch (e) { /* the local copy serves */ }
        out.push({ n, w: info.width, h: info.height, caption: f.caption || f.alt || '', cover: n === 1, c: f.c, p: f.p, at: f.at });
      } catch (e) { /* an illustration that will not draw is left out */ }
    }
    if (out.length) db.prepare('UPDATE texts SET pictures=? WHERE slug=?').run(JSON.stringify(out), slug);
    try { ledger.append(db, replaced ? 'text.reedited' : 'text.shelved', slug, { title, author, from: 'standard-ebooks', by, pictures: out.length, words: opf.words || undefined }); } catch (e) { /* */ }
    if (app.locals.findIndexDirty) app.locals.findIndexDirty();
    return { slug, replaced, chapters: chs.length, pictures: out.length };
  }
  // The whole catalogue: the org's repositories (api.github.com, paged), else the site's listing pages.
  async function* catalogue({ from = 1, limit = 2000 } = {}) {
    let page = from, n = 0;
    while (n < limit) {
      const r = await doFetch(`https://api.github.com/orgs/standardebooks/repos?per_page=100&page=${page}&sort=full_name`, { headers: { accept: 'application/vnd.github+json', 'User-Agent': 'Watermark (watermark.krafftco.com)' } });
      if (!r.ok) { if (r.status === 403 || r.status === 429) throw new Error('GitHub asks us to wait (rate limit); the run resumes on the next look'); throw new Error(`github ${r.status}`); }
      const j = await r.json(); if (!Array.isArray(j) || !j.length) return;
      const repos = j.map(x => x.name).filter(x => /_/.test(x) && !/^(tools|manual|web|standardebooks\.github\.io)$/.test(x)); n += repos.length;
      yield { repos, page: page + 1 }; if (j.length < 100) return; page++;
    }
  }
  app.locals.standard = { bring, catalogue, repoOf, parseOpf, parseChapter };
  return app.locals.standard;
}

module.exports = { mountStandard, parseOpf, parseChapter, repoOf, inline };
