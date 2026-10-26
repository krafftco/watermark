// The reading list (Will, 25 Oct: "how do we get people to read more, collect books and add them to their reading
// list"): what every good bookshop and reader does, done the house's way. A shelf of your own (Want to read ·
// Reading · Read), one tap from any book; the place you reached kept on the house as well as the device, so
// 'Continue reading' can meet you on the front door and in Yours with how far you are; the book shown as an
// object; finishing marked. Nothing of anyone's reading is told to anyone else.
function mountReadingList(app, { db, V, C, buyerOf }) {
  const { esc, tidy } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS reading_list (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL, text_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'want', chapter INTEGER NOT NULL DEFAULT 0, chapters INTEGER NOT NULL DEFAULT 0, pct INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT, UNIQUE (buyer_id, text_id))`);
  const STATUSES = ['want', 'reading', 'read'];
  const textBy = slug => db.prepare("SELECT t.*, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.slug=? AND t.status='held' AND t.public=1").get(String(slug));
  const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x; };
  const readable = t => !!(t.body || t.plates);
  const href = t => (readable(t) && !t.file ? `/read/${t.slug}` : `/library/${t.slug}`);
  const row = (b, t) => (b && t ? db.prepare('SELECT * FROM reading_list WHERE buyer_id=? AND text_id=?').get(b.id, t.id) : null);
  function set(b, t, status) {
    const r = row(b, t);
    if (!r) db.prepare('INSERT INTO reading_list (buyer_id, text_id, status, finished_at) VALUES (?,?,?,?)').run(b.id, t.id, status, status === 'read' ? new Date().toISOString() : null);
    else db.prepare("UPDATE reading_list SET status=?, updated_at=datetime('now'), finished_at=CASE WHEN ?='read' THEN COALESCE(finished_at, datetime('now')) ELSE NULL END WHERE id=?").run(status, status, r.id);
    return row(b, t);
  }
  function place(b, t, chapter, chapters, pct) {
    const r = row(b, t); const done = chapters > 0 && chapter >= chapters - 1 && pct >= 90;
    if (!r) db.prepare('INSERT INTO reading_list (buyer_id, text_id, status, chapter, chapters, pct, finished_at) VALUES (?,?,?,?,?,?,?)').run(b.id, t.id, done ? 'read' : 'reading', chapter, chapters, pct, done ? new Date().toISOString() : null);
    else if (r.status !== 'read' || !done) db.prepare("UPDATE reading_list SET status=CASE WHEN ?=1 THEN 'read' ELSE 'reading' END, chapter=?, chapters=?, pct=?, updated_at=datetime('now'), finished_at=CASE WHEN ?=1 THEN COALESCE(finished_at, datetime('now')) ELSE finished_at END WHERE id=?").run(done ? 1 : 0, chapter, chapters, pct, done ? 1 : 0, r.id);
  }
  // The shelf, as rows of books: reading now first (with how far), then want to read, then read.
  function shelf(b) {
    if (!b) return { reading: [], want: [], read: [] };
    const rows = db.prepare("SELECT r.*, t.slug, t.title, t.author, t.kind, t.body IS NOT NULL AS hasBody, t.plates IS NOT NULL AS hasPlates, t.file, w.slug AS cover FROM reading_list r JOIN texts t ON t.id=r.text_id LEFT JOIN works w ON w.id=t.cover_work_id WHERE r.buyer_id=? AND t.status='held' AND t.public=1 ORDER BY r.updated_at DESC").all(b.id);
    const out = { reading: [], want: [], read: [] };
    for (const r of rows) { const t = { ...r, body: r.hasBody, plates: r.hasPlates }; out[r.status === 'read' ? 'read' : r.status === 'reading' ? 'reading' : 'want'].push({ ...r, href: href(t) + (r.status === 'reading' && r.chapter ? `?c=${r.chapter}` : ''), by: byName(r.author), progress: r.chapters ? Math.round(100 * (r.chapter + (r.pct / 100)) / r.chapters) : 0 }); }
    return out;
  }
  // The buttons under a book, wherever it is shown: one tap, the state shown.
  function buttons(req, t, { back = null } = {}) {
    const b = buyerOf(req); const r = b ? row(b, t) : null; const st = r ? r.status : null;
    const btn = (s, label) => `<button type="submit" name="status" value="${s}" class="rl-b${st === s ? ' rl-on' : ''}"${st === s ? ' aria-pressed="true"' : ''}>${label}</button>`;
    return `<form method="post" action="/read/${esc(t.slug)}/shelf" class="rl"${back ? ` data-back="${esc(back)}"` : ''}>${back ? `<input type="hidden" name="back" value="${esc(back)}">` : ''}<span class="k">Your shelf</span><button type="button" class="rl-b rl-share" data-send data-send-url="/read/${esc(t.slug)}" data-send-title="${esc(t.title)}" data-send-text="${esc(t.title)}${t.author ? `, by ${esc(byName(t.author))}` : ''}. Read it in the house, free, and keep it on your shelf.">Share</button>${btn('want', st === 'want' ? 'On your shelf' : 'Want to read')}${btn('reading', st === 'reading' ? `Reading${r && r.chapters ? ` · ${Math.round(100 * (r.chapter + r.pct / 100) / r.chapters)}%` : ''}` : 'Reading')}${btn('read', st === 'read' ? 'Read' : 'Finished')}${st ? `<button type="submit" name="status" value="off" class="rl-x" title="Take it off your shelf">×</button>` : ''}</form>`;
  }
  app.post('/read/:slug/shelf', (req, res) => {
    const t = textBy(req.params.slug); if (!t) return res.sendStatus(404);
    const b = buyerOf(req); const back = String((req.body && req.body.back) || `/library/${t.slug}`).replace(/[\r\n]/g, '');
    if (!b) return res.redirect(`/signin?next=${encodeURIComponent(back)}&why=shelf`);
    const status = String((req.body && req.body.status) || 'want');
    if (status === 'off') { const r = row(b, t); if (r) db.prepare('DELETE FROM reading_list WHERE id=?').run(r.id); }
    else if (STATUSES.includes(status)) set(b, t, status);
    if (req.body && req.body.json) return res.json({ ok: true, status: (row(b, t) || {}).status || null });
    res.redirect(back.startsWith('/') ? back : `/library/${t.slug}`);
  });
  // The place you reached, from the reader (a beacon; nothing when no one is signed in).
  app.post('/read/:slug/place', (req, res) => {
    const b = buyerOf(req); const t = textBy(req.params.slug); if (!b || !t) return res.sendStatus(204);
    const c = Math.max(0, +(req.body && req.body.c) || 0), n = Math.max(0, +(req.body && req.body.n) || 0), pct = Math.max(0, Math.min(100, +(req.body && req.body.pct) || 0));
    place(b, t, c, n, pct); res.sendStatus(204);
  });
  // Yours → Reading: the shelf as a page.
  app.get('/yours/reading', (req, res) => {
    const b = buyerOf(req); if (!b) return res.redirect('/signin?next=/yours/reading');
    const s = shelf(b); const I = require('./icons');
    const book = r => `<a class="rl-bk" href="${esc(r.href)}">${r.cover ? `<img src="/img/${esc(r.cover)}/screen" alt="" loading="lazy">` : `<span class="rl-cloth rl-bound">${require('./binding').svg({ title: tidy(r.title), author: r.author, slug: r.slug }, { w: 240 })}</span>`}<span class="rl-t"><b>${esc(tidy(r.title))}</b>${r.by ? `<i>${esc(r.by)}</i>` : ''}${r.status === 'reading' && r.chapters ? `<span class="rl-pg"><i style="width:${r.progress}%"></i></span><small>${r.progress}% · ${r.chapters > 1 ? `chapter ${r.chapter + 1} of ${r.chapters}` : 'reading'}</small>` : r.status === 'read' && r.finished_at ? `<small>Finished ${V.date(r.finished_at)}</small>` : ''}</span></a>`;
    const sec = (h, line, items) => `<section class="rl-sec"><header class="gh"><h2>${h}</h2><span>${line}</span></header>${items.length ? `<div class="rl-row">${items.map(book).join('')}</div>` : `<p class="note">Nothing here yet.</p>`}</section>`;
    // The collector's own library (Will, 26 Oct: "make people feel rich, because they are, when they have access to art,
    // culture, books, history"): the Library's walnut room under their own name, a brass plate with their number, the
    // bindings standing on the planks. Everything on it is theirs to read, free, for good.
    const SH = app.locals.shelves; const first = String(b.name || b.given_name || '').trim();
    if (SH && SH.room) {
      const no = app.locals.founders ? app.locals.founders.no(b) : null; const n = s.reading.length + s.want.length + s.read.length;
      const asBook = r => ({ slug: r.slug, title: r.title, author: r.author, cover: r.cover, hasBody: r.hasBody, hasPlates: r.hasPlates, file: r.file, body: r.hasBody, plates: r.hasPlates, note: r.status === 'reading' && r.chapters ? `chapter ${(r.chapter || 0) + 1} of ${r.chapters}${r.pct ? ` · ${r.pct}%` : ''}` : (r.status === 'read' && r.finished_at ? `read ${String(r.finished_at).slice(0, 10)}` : '') });
      const est = (db.prepare('SELECT MIN(at) AS a FROM reading_list WHERE buyer_id=?').get(b.id) || {}).a || new Date().toISOString();
      const plate = `<p class="rmp">${no ? `Founding Collector, No. ${no}` : 'A library of the house'} · est. ${String(est).slice(0, 4)}</p>`;
      const INS = require('./inscriptions');
      return res.set('Cache-Control', 'private, no-store').send(SH.room({ title: first ? `${first}’s library.` : 'Your library.', path: '/yours/reading', kicker: '<a href="/yours">Yours</a>', plate, insc: INS.insc('library'),
        lede: n ? `${n} book${n === 1 ? '' : 's'} on your shelves, yours to read for good: the ones you are in, the ones kept for later, the ones read. Every book opens where you left it.` : 'Your shelves are empty for now. Keep a book from the Library, or from a friend who sends you one, and it stands here.',
        rows: SH.plank('Reading now', s.reading.map(asBook), { line: 'open where you left them', id: 'reading' }) + SH.plank('Kept for later', s.want.map(asBook), { line: 'yours when you are ready', id: 'want' }) + SH.plank('Read', s.read.map(asBook), { line: 'finished, and kept', id: 'read' }),
        foot: 'A private room: nothing of your reading is told to anyone. <a href="/library">The Library</a> · <a href="/publishing">Watermark Publishing</a> · <a href="/yours">Your gallery</a>.' }));
    }
    res.set('Cache-Control', 'private, no-store').send(V.layout({ title: 'Your reading · Watermark', path: '/yours/reading', body: `<section class="cx-intro rl-page"><p class="k">Yours</p><h1>Your reading.</h1><p class="lede">The books you are in, the ones you mean to read, and the ones you have finished. The place you reached is kept, so a book opens where you left it. Nothing of your reading is told to anyone.</p>
${sec('Reading now', `${s.reading.length} book${s.reading.length === 1 ? '' : 's'}`, s.reading)}
${sec('Want to read', `${s.want.length}`, s.want)}
${sec('Read', `${s.read.length}`, s.read)}
<p class="sr-also"><a href="/library">The Library</a> &middot; <a href="/publishing">Watermark Publishing</a> &middot; <a href="/yours">Your gallery</a></p></section>` }));
  });
  app.locals.readingList = { shelf, buttons, row, set, place, href, byName };
  return app.locals.readingList;
}
module.exports = { mountReadingList };
