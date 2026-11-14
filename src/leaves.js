'use strict';
// A leaf and its notes (#37; Will, 13–14 Nov: "even the codexes, how can we show them beautifully and help people
// understand what they are looking at"; "Go on book Leonardo").
//
// A page of a volume (volumes.js) is paired by hand with a manuscript leaf as Richter cites it in a book of numbered
// notes (outline.js): volume page ↔ { book, manuscript key, leaf }. Nothing is paired by the house: the codex pictures we
// hold are titled by a running number only, so no match is possible or honest without a person who has looked. A pairing
// may be marked unsure, and then says so wherever it shows. One page is paired with one leaf; one leaf may have several
// pages (recto and verso photographed apart).
//   Where a pairing exists: under the note's manuscript line, See the leaf (the volume at that page) and Study (the
//   easel); on the volume's page, Written on this leaf: the notes' numbers and headings, each into the book.
//   Cost: the volume page asks one indexed question by volume (LIMIT); the book's structure is the reader's cached one
//   (bookNotes.get). The reader asks one indexed question by book. Nothing walks the collection or the book per request.
const UNSURE_TITLE = 'Paired by hand; the house is not sure this page is that leaf.'; // DRAFT for Will

function mountLeaves(app, { db, V, studioOnly, ledger }) {
  const { esc, tidy } = V;
  const OL = require('./outline');
  db.exec(`CREATE TABLE IF NOT EXISTS leaf_pairs (id INTEGER PRIMARY KEY, volume_id INTEGER NOT NULL, work_id INTEGER NOT NULL, book TEXT NOT NULL, ms TEXT NOT NULL, leaf TEXT NOT NULL, unsure INTEGER NOT NULL DEFAULT 0, at TEXT, UNIQUE (volume_id, work_id))`);
  db.exec('CREATE INDEX IF NOT EXISTS leaf_pairs_book ON leaf_pairs (book, ms, leaf)');
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const bookOf = slug => (app.locals.bookNotes && app.locals.bookNotes.get ? app.locals.bookNotes.get(slug) : null);
  const withMs = b => !!(b && OL.hasMs(b.nb));
  const msOf = (b, key) => { const X = b && OL.byMs(b.nb); return X ? X.index.get(key) || null : null; };
  const un = u => (Number(u) === 1 ? ` <span class="vlf-un" title="${esc(UNSURE_TITLE)}">unsure</span>` : '');

  // The reader: for one book, the leaves that have a page in an open volume, keyed `${ms}\0${leaf}`; null when none.
  function forBook(slug) {
    const rows = db.prepare(`SELECT p.ms, p.leaf, p.unsure, v.slug AS vslug, w.slug AS wslug, (SELECT COUNT(*) FROM volume_pages q JOIN works x ON x.id=q.work_id WHERE q.volume_id=p.volume_id AND q.pos<vp.pos AND (x.status='held' OR (x.status='hidden' AND q.placed IS NOT NULL)) AND COALESCE(x.keep_back,0)=0) AS before FROM leaf_pairs p JOIN volumes v ON v.id=p.volume_id JOIN volume_pages vp ON vp.volume_id=p.volume_id AND vp.work_id=p.work_id JOIN works w ON w.id=p.work_id WHERE p.book=? AND v.status='open' AND (w.status='held' OR (w.status='hidden' AND vp.placed IS NOT NULL)) AND COALESCE(w.keep_back,0)=0 ORDER BY p.id LIMIT 2000`).all(String(slug));
    if (!rows.length) return null;
    const m = new Map();
    for (const r of rows) {
      const k = `${r.ms}\u0000${r.leaf}`; const p = Number(r.before) + 1; const href = `/volume/${r.vslug}?p=${p}`;
      if (!m.has(k)) m.set(k, []); m.get(k).push({ href, study: `/easel/${r.wslug}?back=${encodeURIComponent(href)}`, p, unsure: Number(r.unsure) === 1 });
    }
    return m;
  }

  // Pair and remove, at the Studio's word only.
  function pair(v, workId, { book, ms, leaf, unsure } = {}) {
    const wid = Number(workId) || 0;
    const page = db.prepare('SELECT w.slug FROM volume_pages vp JOIN works w ON w.id=vp.work_id WHERE vp.volume_id=? AND vp.work_id=?').get(v.id, wid);
    if (!page) return { no: 'Not a page of this volume.' };
    const had = db.prepare('SELECT ms, leaf FROM leaf_pairs WHERE volume_id=? AND work_id=?').get(v.id, wid);
    if (had) return { no: 'That page is paired already; remove it first.' };
    const b = bookOf(String(book || '').trim());
    if (!withMs(b)) return { no: 'No book of numbered notes with manuscript lines by that name.' };
    const m = OL.byMs(b.nb).find(ms);
    if (!m) return { no: 'The book cites no manuscript by that name.' };
    const lk = OL.leafKey(leaf);
    if (!lk) return { no: 'Type the leaf as Richter gives it, such as 172b.' };
    if (!m.leaves.some(L => L.leaf === lk)) return { no: `No note in the book is on ${m.abbr} ${lk}.` };
    db.prepare('INSERT INTO leaf_pairs (volume_id, work_id, book, ms, leaf, unsure, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(v.id, wid, b.slug, m.key, lk, unsure ? 1 : 0, now());
    try { ledger.append(db, 'leaf.paired', v.slug, { work: page.slug, book: b.slug, ms: m.key, leaf: lk, unsure: unsure ? true : undefined }); } catch (e) { /* */ }
    return { ok: `Paired with ${m.abbr} ${lk}${unsure ? ', marked unsure' : ''}.` };
  }
  function unpair(v, workId, why) {
    const wid = Number(workId) || 0;
    const r = db.prepare('SELECT book, ms, leaf FROM leaf_pairs WHERE volume_id=? AND work_id=?').get(v.id, wid);
    if (!r) return { no: 'That page is not paired.' };
    db.prepare('DELETE FROM leaf_pairs WHERE volume_id=? AND work_id=?').run(v.id, wid);
    const w = db.prepare('SELECT slug FROM works WHERE id=?').get(wid);
    try { ledger.append(db, 'leaf.unpaired', v.slug, { work: w && w.slug, book: r.book, ms: r.ms, leaf: r.leaf, why: why || undefined }); } catch (e) { /* */ }
    return { ok: 'Pairing removed.' };
  }

  // The books a volume's pages may be paired with: the artist's own books of numbered notes, and any already paired.
  function booksFor(v) {
    const slugs = new Set(db.prepare('SELECT book FROM leaf_pairs WHERE volume_id=? GROUP BY book LIMIT 20').all(v.id).map(r => r.book));
    const a = v.artist_id ? db.prepare('SELECT name FROM artists WHERE id=?').get(v.artist_id) : null;
    const toks = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter(Boolean);
    if (a) { const want = toks(a.name); for (const t of db.prepare("SELECT slug, author FROM texts WHERE status='held' AND kind='book' AND author IS NOT NULL ORDER BY id LIMIT 600").all()) { const have = new Set(toks(t.author)); if (want.length && want.every(x => have.has(x))) slugs.add(t.slug); } }
    return [...slugs].slice(0, 12).map(bookOf).filter(withMs);
  }
  // The desk: beside each page of the pages strip, its leaf, or the form to pair one.
  function desk(v, back) {
    const rows = db.prepare('SELECT work_id, book, ms, leaf, unsure FROM leaf_pairs WHERE volume_id=? ORDER BY id LIMIT 5000').all(v.id);
    const by = new Map(rows.map(r => [Number(r.work_id), r]));
    const books = booksFor(v); const one = books.length === 1 ? books[0] : null;
    const opts = one ? OL.byMs(one.nb).list.map(m => `<option value="${esc(m.key)}">${esc(m.abbr)} ${esc(m.name)}</option>`).join('') : '';
    return p => {
      const act = `/studio/volumes/${v.id}/pages/${p.id}`; const r = by.get(Number(p.id));
      if (r) { const m = msOf(bookOf(r.book), r.ms); return `<div class="vlf-dk"><span>Leaf ${esc(m ? m.abbr : r.ms)} ${esc(r.leaf)}${Number(r.unsure) === 1 ? ' · unsure' : ''}</span><form method="post" action="${act}/unleaf?${back}"><button class="link">Remove</button></form></div>`; }
      const id = `vlf-${v.id}-${p.id}`;
      return `<form class="vlf-dk" method="post" action="${act}/leaf?${back}">${one ? `<input type="hidden" name="book" value="${esc(one.slug)}"><label for="${id}-m">Manuscript</label><select id="${id}-m" name="ms">${opts}</select>` : `<label for="${id}-b">Book</label><input id="${id}-b" name="book" placeholder="The book’s page name"><label for="${id}-m">Manuscript</label><input id="${id}-m" name="ms" placeholder="C.A.">`}<label for="${id}-l">Leaf</label><input id="${id}-l" name="leaf" maxlength="12" placeholder="172b" required><label class="vlf-tk"><input type="checkbox" name="unsure" value="1"> Unsure</label><button>Pair</button></form>`;
    };
  }
  // The volume page: an About (the volume's own words, if the Studio wrote them) on the first page, and on each paired
  // page the notes written on its leaf. Returns null when there is neither: the page is then exactly as before.
  function panel(v, ps, at) {
    const about = String(v.about || '').trim(), source = String(v.source || '').trim();
    const rows = db.prepare('SELECT work_id, book, ms, leaf, unsure FROM leaf_pairs WHERE volume_id=? ORDER BY id LIMIT 2000').all(v.id);
    if (!about && !source && !rows.length) return null;
    const idx = new Map(ps.map((p, i) => [Number(p.id), i]));
    const secs = [];
    if (about || source) secs.push({ i: 0, about: true, h: `<section class="vlf-s" data-vlf-p="1" data-vlf-about aria-labelledby="vlf-ab"${at === 1 ? '' : ' hidden'}><h2 class="vlf-k" id="vlf-ab">About this volume</h2>${about ? `<div class="vlf-ab">${about.split(/\s*\n+\s*/).filter(Boolean).map(x => `<p>${esc(x)}</p>`).join('')}</div>` : ''}${source ? `<p class="vlf-so"><span>Source</span> ${esc(source)}</p>` : ''}</section>` });
    for (const r of rows) {
      const i = idx.get(Number(r.work_id)); if (i == null) continue;
      const b = bookOf(r.book); if (!withMs(b) || !b.public) continue;
      const hit = OL.byMs(b.nb).notesOn(r.ms, r.leaf); if (!hit) continue;
      const u = `/read/${encodeURIComponent(b.slug)}`;
      secs.push({ i, h: `<section class="vlf-s" data-vlf-p="${i + 1}" aria-labelledby="vlf-h${i + 1}"${at === i + 1 ? '' : ' hidden'}><h2 class="vlf-k" id="vlf-h${i + 1}">Written on this leaf</h2><p class="vlf-src">${esc(hit.m.name.charAt(0).toUpperCase() + hit.m.name.slice(1))}, ${esc(hit.L.label)} <span>(${esc(hit.m.abbr)} ${esc(hit.L.label)})</span>${un(r.unsure)}</p><ol class="vlf-ns">${hit.L.notes.map(x => `<li><a href="${u}?n=${x.n}"><b>${x.n}</b> <span class="${x.head ? 'vlf-h' : 'vlf-t'}">${esc(x.text || '')}</span></a></li>`).join('')}</ol><p class="vlf-bk">In <a href="${u}?by=ms&amp;ms=${esc(hit.m.key)}">${esc(tidy(b.title))}</a>, Richter’s translation</p></section>` });
    }
    if (!secs.length) return null;
    secs.sort((a, b) => a.i - b.i || (a.about ? -1 : 1));
    const any = secs.some(s => s.i + 1 === at);
    return { aside: `<aside class="vlf" data-vlf aria-label="This page"${any ? '' : ' hidden'}>${secs.map(s => s.h).join('')}</aside>`, aboutBtn: about || source ? '<button type="button" class="vlf-abt" data-vlf-abt aria-expanded="false">About</button>' : '' };
  }

  // The Studio's presses, beside each page on the Volumes desk.
  const toPages = (res, v, r) => res.redirect(`/studio/volumes?show=${encodeURIComponent(v.status)}&pages=${v.id}&ok=${encodeURIComponent(r.ok || r.no)}#pages-${v.id}`);
  const volOf = id => db.prepare('SELECT * FROM volumes WHERE id=?').get(Number(id) || 0);
  app.post('/studio/volumes/:id/pages/:work/leaf', studioOnly, (req, res) => {
    const v = volOf(req.params.id); if (!v) return res.redirect('/studio/volumes?ok=' + encodeURIComponent('No such volume.')); const b = req.body || {};
    toPages(res, v, pair(v, req.params.work, { book: b.book, ms: b.ms, leaf: b.leaf, unsure: b.unsure === '1' }));
  });
  app.post('/studio/volumes/:id/pages/:work/unleaf', studioOnly, (req, res) => {
    const v = volOf(req.params.id); if (!v) return res.redirect('/studio/volumes?ok=' + encodeURIComponent('No such volume.'));
    toPages(res, v, unpair(v, req.params.work));
  });
  app.locals.leaves = { forBook, pair, unpair, desk, panel, booksFor };
  return app.locals.leaves;
}
module.exports = { mountLeaves, UNSURE_TITLE };
