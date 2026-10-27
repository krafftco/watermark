// The pictures in the books (Will, 27 Oct: "how can we also figure out pictures in these books"). Gutenberg's plain text
// drops the plates; its HTML edition keeps each picture in its place in the text: Tenniel's Alice, Rackham's Grimm and
// Peter Pan, Doré's Dante, Pyle's own Robin Hood, Beardsley's Morte d'Arthur, Shepard's Wind in the Willows. So for a
// book from Gutenberg the house also reads the HTML edition, takes each picture of any size into the vault
// (`texts/<slug>/pl-<n>.jpg`, resized to 1600 px, the ornaments and rules left behind), and places it where it fell:
// the words right after the picture are found in the book's own paragraphs, and the reading room sets the figure there,
// between the paragraphs, with its caption. What cannot be placed hangs at the end as the plates. The book's cover stays
// the house's binding (the bindings are the treasure); the reader's cover and the Library page carry a strip of the
// plates. `texts.pictures` keeps the list; `texts.illustrator` the credit when the house knows it (the Studio sets it).
// The illustrators of these editions are out of copyright with the books; the edition line names them.
const fs = require('fs');
const path = require('path');
const { esc } = require('./views');

const MAX_PICTURES = +process.env.BOOK_PLATES_MAX || 80;
const MAX_BYTES = 6 * 1024 * 1024;
const MIN_SIDE = 220;

function mountBookplates(app, { db, V, C, store, isStudio, ledger, doFetch }) {
  try { db.exec('ALTER TABLE texts ADD COLUMN pictures TEXT'); } catch (e) { /* has it */ }
  try { db.exec('ALTER TABLE texts ADD COLUMN illustrator TEXT'); } catch (e) { /* has it */ }
  const dir = path.join(C.dataDir, 'texts'); fs.mkdirSync(dir, { recursive: true });
  const sharp = require('sharp');
  const norm = x => String(x || '').toLowerCase().replace(/[’']/g, '').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const untag = h => String(h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, '’').replace(/&mdash;/g, '—').replace(/\s+/g, ' ').trim();
  const picturesOf = t => { try { return t && t.pictures ? JSON.parse(t.pictures) : []; } catch (e) { return []; } };
  const fileOf = (t, n) => path.join(dir, t.slug, `pl-${n}.jpg`);
  const keyOf = (t, n) => `texts/${t.slug}/pl-${n}.jpg`;

  // The chapters as the reader builds them (reading.js), so a place found here is the reader's place.
  function chaptersOf(body) {
    const chs = []; let cur = { head: null, paras: [] };
    for (const p of String(body || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) { if (/^##?\s/.test(p)) { if (cur.head || cur.paras.length) chs.push(cur); cur = { head: p.replace(/^#+\s*/, ''), paras: [] }; } else cur.paras.push(p); }
    if (cur.head || cur.paras.length) chs.push(cur);
    return chs;
  }
  // Where a picture falls: the words after it (else before it) found at the head of one of the book's paragraphs.
  function place(chs, after, before) {
    const idx = []; chs.forEach((c, i) => c.paras.forEach((p, j) => idx.push({ i, j, n: norm(p) })));
    const find = (words, atStart) => { const w = norm(words); if (w.length < 24) return null; const probe = w.slice(0, 48); let hit = idx.find(x => atStart ? x.n.startsWith(probe) : x.n.includes(probe)); if (!hit) { const probe2 = w.split(' ').slice(0, 6).join(' '); if (probe2.length >= 24) hit = idx.find(x => x.n.includes(probe2)); } return hit || null; };
    const a = find(after, true) || find(after, false); if (a) return { c: a.i, p: a.j, at: 'before' };
    const b = find((before || '').split(' ').slice(-10).join(' '), false); if (b) return { c: b.i, p: b.j, at: 'after' };
    return null;
  }
  function htmlUrl(rec) {
    const f = (rec && rec.formats) || {}; const keys = Object.keys(f).filter(k => /^text\/html/.test(k) && !/\.zip$/.test(f[k]));
    keys.sort((x, y) => (/images/.test(f[y]) ? 1 : 0) - (/images/.test(f[x]) ? 1 : 0));
    if (keys.length) return f[keys[0]];
    const id = rec && rec.id; return id ? `https://www.gutenberg.org/ebooks/${id}.html.images` : null;
  }
  // Read the HTML edition for its pictures and keep them.
  async function bring(t, rec) {
    const url = htmlUrl(rec); if (!url) return { n: 0, why: 'no HTML edition' };
    const r = await doFetch(url); if (!r.ok) return { n: 0, why: `html ${r.status}` };
    const html = await r.text(); const base = (r.url && /^https?:/.test(r.url)) ? r.url : url;
    const chs = chaptersOf(t.body);
    const tags = [...html.matchAll(/<img\b[^>]*>/gi)]; const out = []; const seen = new Set(); let n = 0;
    fs.mkdirSync(path.join(dir, t.slug), { recursive: true });
    for (const m of tags) {
      if (out.length >= MAX_PICTURES) break;
      const tag = m[0]; const src = (tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i) || [])[1]; if (!src) continue;
      let abs; try { abs = new URL(src, base).href; } catch (e) { continue; }
      if (seen.has(abs)) continue; seen.add(abs);
      if (/gutenberg\.org\/(?:cache\/epub\/\d+\/)?(?:pg)?\d*\/?(?:images\/)?(?:gutenberg|pg-?logo)/i.test(abs) || /\/(?:gutenberg|logo|ornament|rule|deco|dingbat|border|bullet|sep)[^/]*\.(?:png|jpe?g|gif)$/i.test(abs)) continue;
      const alt = untag((tag.match(/\salt\s*=\s*["']([^"']*)["']/i) || [])[1] || '');
      const pos = m.index; const afterHtml = html.slice(pos + tag.length, pos + tag.length + 6000); const beforeHtml = html.slice(Math.max(0, pos - 3000), pos);
      // A caption: a figcaption or a <p class="caption"> right after the picture.
      const cap = (afterHtml.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i) || afterHtml.match(/^\s*(?:<\/a>)?\s*(?:<\/div>\s*)?<p[^>]*class="[^"]*(?:caption|figcenter|illus)[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || [])[1];
      const caption = untag(cap || '').slice(0, 300) || (alt && alt.length > 3 && !/^(image|illustration|picture)$/i.test(alt) ? alt.slice(0, 300) : '');
      let afterText = untag(afterHtml); if (caption && afterText.startsWith(caption)) afterText = afterText.slice(caption.length).trim();
      const beforeText = untag(beforeHtml);
      let buf; try { const ir = await doFetch(abs); if (!ir.ok) continue; buf = Buffer.from(await ir.arrayBuffer()); } catch (e) { continue; }
      if (!buf || buf.length < 1500 || buf.length > MAX_BYTES) continue;
      let meta; try { meta = await sharp(buf, { failOn: 'error' }).metadata(); } catch (e) { continue; }
      if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_SIDE) continue; // an ornament, a rule, a drop cap
      n++;
      const file = fileOf(t, n);
      let info; try { info = await sharp(buf).rotate().resize({ width: 1600, height: 2000, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(file); } catch (e) { n--; continue; }
      try { if (store && store.kind === 's3') await store.put(keyOf(t, n), file, 'image/jpeg'); } catch (e) { /* the local copy serves; the vault copy is retried on the next bring */ }
      const where = place(chs, afterText, beforeText);
      out.push({ n, w: info.width, h: info.height, caption, cover: /cover|frontis|title/i.test(abs) || out.length === 0, ...(where || { c: -1, p: -1, at: 'end' }) });
    }
    db.prepare("UPDATE texts SET pictures=? WHERE id=?").run(JSON.stringify(out), t.id);
    try { if (out.length) ledger.append(db, 'text.illustrated', t.slug, { title: t.title, pictures: out.length, placed: out.filter(x => x.c >= 0).length }); } catch (e) { /* */ }
    return { n: out.length, placed: out.filter(x => x.c >= 0).length };
  }
  // The record for a Gutenberg book, from the source address.
  async function recordOf(t) {
    const id = +((String(t.source || '').match(/ebooks\/(\d+)/) || [])[1]); if (!id) return null;
    if (app.locals.reading && app.locals.reading.meta) { try { return await app.locals.reading.meta(id); } catch (e) { return { id }; } }
    return { id };
  }
  // The queue: one book at a time in the background (after a bring on the shelf, and from the desk).
  const q = []; let on = false; const job = { on: false, done: [], missed: [], at: 0, of: 0 };
  async function pump() {
    if (on) return; if (app.locals.governor && !app.locals.governor.chores()) return; on = true; job.on = true;
    while (q.length) {
      const slug = q.shift(); job.at++;
      try { const t = db.prepare('SELECT * FROM texts WHERE slug=?').get(slug); if (!t || !t.body) continue; const rec = await recordOf(t); if (!rec) continue; const r = await (app.locals.governor ? app.locals.governor.turn('pictures', () => bring(t, rec)) : bring(t, rec)); if (r.n) job.done.push(`${t.title}: ${r.n}`); else job.missed.push(`${t.title}: ${r.why || 'none found'}`); } catch (e) { job.missed.push(`${slug}: ${e.message}`); }
      await new Promise(r => setTimeout(r, app.locals.noTimers ? 0 : 1200));
      if (app.locals.governor) await app.locals.governor.settle('pictures');
    }
    on = false; job.on = false;
  }
  function queue(slug) { if (!q.includes(slug)) { q.push(slug); job.of++; } setTimeout(pump, app.locals.noTimers ? 0 : 500); }
  function queueAll() { const rows = db.prepare("SELECT slug FROM texts WHERE status='held' AND source LIKE '%gutenberg.org/ebooks/%' AND body IS NOT NULL AND (pictures IS NULL OR pictures='')").all(); job.done = []; job.missed = []; job.at = 0; job.of = 0; for (const r of rows) queue(r.slug); return rows.length; }

  // The picture itself.
  app.get('/read/:slug/pic/:n', async (req, res) => {
    const t = db.prepare("SELECT id, slug, public, status, pictures FROM texts WHERE slug=?").get(String(req.params.slug)); const n = +req.params.n;
    if (!t || t.status !== 'held' || (!t.public && !isStudio(req)) || !n || !picturesOf(t).some(p => p.n === n)) return res.sendStatus(404);
    const file = fileOf(t, n);
    if (!fs.existsSync(file)) { try { if (store && store.kind === 's3') { const b = await store.get(keyOf(t, n)); if (b) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, b); } } } catch (e) { /* below */ } }
    if (!fs.existsSync(file)) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=86400'); res.type('jpeg'); fs.createReadStream(file).pipe(res);
  });
  // The desk: one book, or every Gutenberg book without pictures yet.
  app.post('/studio/reading/pictures', (req, res) => { if (!isStudio(req)) return res.sendStatus(403); const n = queueAll(); res.redirect('/studio/reading?ok=' + encodeURIComponent(n ? `Reading ${n} books for their pictures, one at a time; this page shows each as it is done.` : 'Every book on the shelf has been read for its pictures.')); });
  app.post('/studio/reading/:slug/pictures', (req, res) => { if (!isStudio(req)) return res.sendStatus(403); const t = db.prepare("SELECT slug, pictures FROM texts WHERE slug=?").get(String(req.params.slug)); if (!t) return res.sendStatus(404); db.prepare("UPDATE texts SET pictures=NULL WHERE slug=?").run(t.slug); queue(t.slug); res.redirect(`/library/${encodeURIComponent(t.slug)}?ok=` + encodeURIComponent('Reading the book for its pictures; a minute, then they are in the text.')); });
  app.post('/studio/reading/:slug/illustrator', (req, res) => { if (!isStudio(req)) return res.sendStatus(403); const t = db.prepare("SELECT slug FROM texts WHERE slug=?").get(String(req.params.slug)); if (!t) return res.sendStatus(404); db.prepare("UPDATE texts SET illustrator=? WHERE slug=?").run(String(req.body.illustrator || '').trim().slice(0, 120) || null, t.slug); res.redirect(`/library/${encodeURIComponent(t.slug)}`); });

  // For the reader: the figures placed by chapter and paragraph, and the end plates.
  function figure(t, p, { loading = 'lazy' } = {}) { return `<figure class="rdr-fig"><img src="/read/${esc(t.slug)}/pic/${p.n}" alt="${esc(p.caption || '')}" width="${p.w}" height="${p.h}" loading="${loading}">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`; }
  function forReader(t) {
    const ps = picturesOf(t); const byPlace = {}; const end = [];
    for (const p of ps) { if (p.c < 0) end.push(p); else { const k = `${p.c}:${p.p}:${p.at}`; (byPlace[k] = byPlace[k] || []).push(p); } }
    return { n: ps.length, before: (c, p) => (byPlace[`${c}:${p}:before`] || []).map(x => figure(t, x)).join(''), after: (c, p) => (byPlace[`${c}:${p}:after`] || []).map(x => figure(t, x)).join(''), end: end.map(x => figure(t, x)).join(''), strip: ps.slice(0, 5).map(p => `<a href="/read/${esc(t.slug)}?c=${Math.max(0, p.c)}"><img src="/read/${esc(t.slug)}/pic/${p.n}" alt="${esc(p.caption || '')}" loading="lazy"></a>`).join(''), credit: t.illustrator ? `Illustrated by ${t.illustrator}` : '' };
  }
  // The Library page: a strip of the plates and the Studio's acts.
  function strip(t, { studio = false } = {}) {
    const ps = picturesOf(t); if (!ps.length && !studio) return '';
    const isGut = /gutenberg\.org\/ebooks\//.test(String(t.source || ''));
    const isDoc = t.kind === 'document';
    return `<section class="lb-plates">${ps.length ? `<p class="k">${isDoc ? 'The pages' : 'The pictures'} · ${ps.length}${t.illustrator ? ` · illustrated by ${esc(t.illustrator)}` : ''}</p><div class="lb-pl-row">${ps.slice(0, 12).map(p => `<a href="/read/${esc(t.slug)}?${isDoc ? `pages=1&c=${p.page - 1}` : `c=${Math.max(0, p.c)}`}" title="${esc(p.caption || '')}"><img src="/read/${esc(t.slug)}/pic/${p.n}" alt="${esc(p.caption || '')}" loading="lazy"></a>`).join('')}</div>` : ''}${studio && isGut ? `<form method="post" action="/studio/reading/${esc(t.slug)}/pictures" class="lb-pl-desk"><button type="submit">${ps.length ? 'Read the book for its pictures again' : 'Bring the pictures'}</button></form><form method="post" action="/studio/reading/${esc(t.slug)}/illustrator" class="lb-pl-desk"><label>Illustrated by <input name="illustrator" value="${esc(t.illustrator || '')}" placeholder="John Tenniel"></label><button type="submit">Set</button></form>` : ''}</section>`;
  }
  app.locals.bookplates = { bring, queue, queueAll, job, picturesOf, forReader, strip, place, chaptersOf, htmlUrl };
  return app.locals.bookplates;
}

module.exports = { mountBookplates };
