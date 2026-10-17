// Applause: a tip of the hat for a photograph. One per person per work, quiet and honourable: no
// counts in the grid, no leaderboard, only "Applauded by 42" on the work itself. The point is the
// signal: what people hold in high regard shapes the archive (the Studio sorts by standing and sees the
// duds), and the makers hear it. Notes are the conversation: a name and a sentence, held with the
// work, which its maker may remove.
const { nanoid } = require('nanoid');
const UNKIND = /\b(fuck|shit|crap|garbage|trash|sucks?|ugly|stupid|idiot|loser|hate (it|this|you)|worst|pathetic|kill yourself|kys|retard\w*|bitch|asshole|dumb)\b/i;

function mountApplause(app, { db, buyerOf, setBuyer, isStudio, makerOf, ledger, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS applause (work_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (work_id, buyer_id))`);
  db.exec(`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, buyer_id INTEGER, name TEXT, body TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), removed_at TEXT)`);
  // The maker's regard: a line the maker marks "well seen". The only rating of a reviewer here is the regard of the people whose work they wrote about.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('notes') WHERE name='seen_at'").get()) db.exec('ALTER TABLE notes ADD COLUMN seen_at TEXT');
  // The house guest book: one book for the whole of Krafft, in chapters. Lines signed on a photograph are
  // a chapter of their own (watermark); lines signed from the other houses have no work.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('notes') WHERE name='chapter'").get()) { db.exec("ALTER TABLE notes ADD COLUMN chapter TEXT NOT NULL DEFAULT 'watermark'"); }
  const CHAPTERS = { krafft: 'Krafft', studios: 'Krafft Studios', advisory: 'Krafft Advisory', ventures: 'Krafft Ventures', watermark: 'Watermark', dgc: 'Dallas Golf Club' };
  const work = slug => db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(slug));
  const count = id => db.prepare('SELECT COUNT(*) n FROM applause WHERE work_id=?').get(id).n;
  const mine = (id, b) => !!(b && db.prepare('SELECT 1 FROM applause WHERE work_id=? AND buyer_id=?').get(id, b.id));
  // A line in the book is signed by a person: when their gallery is public, the signature opens it.
  const notesOf = id => db.prepare('SELECT n.*, b.code, b.public, (SELECT COUNT(*) FROM notes x WHERE x.buyer_id=n.buyer_id AND x.seen_at IS NOT NULL AND x.removed_at IS NULL) AS regard FROM notes n LEFT JOIN buyers b ON b.id=n.buyer_id WHERE n.work_id=? AND n.gallery_id IS NULL AND n.removed_at IS NULL ORDER BY n.id DESC LIMIT 40').all(id);
  // What a person has written in the books, for their gallery page.
  app.locals.linesBy = b => (b ? db.prepare('SELECT n.body, n.at, w.slug, w.title, m.name AS maker FROM notes n JOIN works w ON w.id=n.work_id JOIN makers m ON m.id=w.maker_id WHERE n.buyer_id=? AND n.removed_at IS NULL AND w.status=\'held\' ORDER BY n.id DESC LIMIT 60').all(b.id) : []);
  // A person's standing in the books: lines written, and how many makers marked them well seen.
  app.locals.regardOf = b => (b ? db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN seen_at IS NOT NULL THEN 1 ELSE 0 END) seen, COUNT(DISTINCT CASE WHEN n.seen_at IS NOT NULL THEN w.maker_id END) makers FROM notes n JOIN works w ON w.id=n.work_id WHERE n.buyer_id=? AND n.removed_at IS NULL").get(b.id) : { n: 0, seen: 0, makers: 0 });
  app.post('/w/:slug/notes/:id/seen', (req, res) => {
    const w = work(req.params.slug); if (!w) return res.sendStatus(404);
    const m = makerOf(req); if (!(isStudio(req) || (m && m.id === w.maker_id))) return res.sendStatus(403);
    const n = db.prepare('SELECT * FROM notes WHERE id=? AND work_id=?').get(Number(req.params.id), w.id); if (!n) return res.redirect(`/w/${w.slug}#notes`);
    db.prepare(n.seen_at ? 'UPDATE notes SET seen_at=NULL WHERE id=?' : "UPDATE notes SET seen_at=datetime('now') WHERE id=?").run(n.id);
    res.redirect(`/w/${w.slug}#notes`);
  });
  app.locals.applaudedBy = b => (b ? db.prepare('SELECT w.slug, w.title, w.width, w.height, m.name AS maker FROM applause a JOIN works w ON w.id=a.work_id JOIN makers m ON m.id=w.maker_id WHERE a.buyer_id=? AND w.status=\'held\' ORDER BY a.at DESC LIMIT 60').all(b.id) : []);
  // A visitor who applauds becomes a collector record on this device, so one person is one hand.
  const person = (req, res) => { let b = buyerOf(req); if (!b) { const id = db.prepare("INSERT INTO buyers (customer, email) VALUES ('', NULL)").run().lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); } return b; };
  // Captures: a Print Screen or a copy on a work's page, noted for the maker. Not a lock; a signal.
  db.exec(`CREATE TABLE IF NOT EXISTS captures (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, kind TEXT NOT NULL, viewer TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  app.post('/w/:slug/capture', require('express').text({ type: '*/*', limit: '2kb' }), (req, res) => {
    const w = work(req.params.slug); if (!w) return res.sendStatus(204);
    let b = {}; try { b = JSON.parse(req.body || '{}'); } catch (e) { /* plain */ }
    const kind = ['printscreen', 'copy'].includes(b.kind) ? b.kind : 'other';
    db.prepare('INSERT INTO captures (work_id, kind, viewer) VALUES (?,?,?)').run(w.id, kind, String(b.v || '').slice(0, 16) || null);
    res.sendStatus(204);
  });
  // The gallery's own book and hat. A collector's gallery is a home; visitors sign its book (a line for the
  // gallery, or for one piece in it) and tip the hat to the whole. The owner may remove a line.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('notes') WHERE name='gallery_id'").get()) db.exec('ALTER TABLE notes ADD COLUMN gallery_id INTEGER');
  db.exec(`CREATE TABLE IF NOT EXISTS gallery_hats (gallery_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (gallery_id, buyer_id))`);
  const gallery = code => db.prepare('SELECT * FROM buyers WHERE code=? AND public=1').get(String(code));
  app.locals.galleryBook = (g, req) => ({
    lines: db.prepare(`SELECT n.*, b.code, b.public, w.slug AS wslug, w.title AS wtitle FROM notes n LEFT JOIN buyers b ON b.id=n.buyer_id LEFT JOIN works w ON w.id=n.work_id AND w.status='held'
      WHERE n.gallery_id=? AND n.removed_at IS NULL ORDER BY n.id DESC LIMIT 60`).all(g.id),
    hats: db.prepare('SELECT COUNT(*) n FROM gallery_hats WHERE gallery_id=?').get(g.id).n,
    mine: !!(buyerOf(req) && db.prepare('SELECT 1 FROM gallery_hats WHERE gallery_id=? AND buyer_id=?').get(g.id, buyerOf(req).id)),
  });
  app.post('/collector/:code/hat', (req, res) => {
    const g = gallery(req.params.code); if (!g) return res.sendStatus(404);
    const b = person(req, res); if (b.id === g.id) return res.redirect(`/collector/${g.code}`);
    const had = db.prepare('SELECT 1 FROM gallery_hats WHERE gallery_id=? AND buyer_id=?').get(g.id, b.id);
    if (had) db.prepare('DELETE FROM gallery_hats WHERE gallery_id=? AND buyer_id=?').run(g.id, b.id); else db.prepare('INSERT OR IGNORE INTO gallery_hats (gallery_id, buyer_id) VALUES (?,?)').run(g.id, b.id);
    const n = db.prepare('SELECT COUNT(*) n FROM gallery_hats WHERE gallery_id=?').get(g.id).n;
    res.format({ json: () => res.json({ ok: true, on: !had, n }), html: () => res.redirect(`/collector/${g.code}#book`) });
  });
  app.post('/collector/:code/notes', (req, res) => {
    const g = gallery(req.params.code); if (!g) return res.sendStatus(404);
    const x = req.body || {}, body = String(x.body || '').trim().replace(/\s+/g, ' ').slice(0, 280), name = String(x.name || '').trim().slice(0, 60) || null;
    const back = q => res.redirect(`/collector/${g.code}?note=${q}#book`);
    if (body.length < 2 || !name || /https?:\/\/|www\./i.test(body)) return back('check');
    if (UNKIND.test(body) || UNKIND.test(name)) return back('kind');
    const b = person(req, res);
    if (db.prepare("SELECT COUNT(*) n FROM notes WHERE buyer_id=? AND at > datetime('now','-10 minutes')").get(b.id).n >= 3) return back('slow');
    // A line may be for one piece in the gallery: the work must hang there.
    const w = x.work ? db.prepare("SELECT w.id FROM works w JOIN licenses l ON l.work_id=w.id WHERE w.slug=? AND l.buyer_id=? AND l.status IN ('active','expired') AND l.price_cents>0 AND w.status='held'").get(String(x.work), g.id) : null;
    db.prepare("INSERT INTO notes (work_id, buyer_id, name, body, chapter, gallery_id) VALUES (?,?,?,?,'gallery',?)").run(w ? w.id : 0, b.id, name, body, g.id);
    if (!b.name) db.prepare('UPDATE buyers SET name=? WHERE id=?').run(name, b.id);
    ledger.append(db, 'gallery.signed', g.code, {});
    back('1');
  });
  app.post('/collector/:code/notes/:id/remove', (req, res) => {
    const g = gallery(req.params.code); if (!g) return res.sendStatus(404);
    const n = db.prepare('SELECT * FROM notes WHERE id=? AND gallery_id=?').get(Number(req.params.id), g.id); if (!n) return res.redirect(`/collector/${g.code}#book`);
    const b = buyerOf(req); if (!(isStudio(req) || (b && (b.id === g.id || b.id === n.buyer_id)))) return res.sendStatus(403);
    db.prepare("UPDATE notes SET removed_at=datetime('now') WHERE id=?").run(n.id);
    res.redirect(`/collector/${g.code}#book`);
  });
  app.locals.capturesOf = () => Object.fromEntries(db.prepare('SELECT work_id, COUNT(*) n FROM captures GROUP BY work_id').all().map(r => [r.work_id, r.n]));
  app.locals.applauseOf = (w, req) => ({ n: count(w.id), mine: mine(w.id, buyerOf(req)), notes: notesOf(w.id) });
  // Standing: the share of people who saw a work and applauded it, for the Studio's sort and the duds.
  app.locals.standing = () => Object.fromEntries(db.prepare('SELECT work_id, COUNT(*) n FROM applause GROUP BY work_id').all().map(r => [r.work_id, r.n]));

  app.post('/w/:slug/applaud', (req, res) => {
    const w = work(req.params.slug); if (!w) return res.status(404).json({ ok: false });
    const b = person(req, res);
    const had = mine(w.id, b);
    if (had) db.prepare('DELETE FROM applause WHERE work_id=? AND buyer_id=?').run(w.id, b.id);
    else { db.prepare('INSERT OR IGNORE INTO applause (work_id, buyer_id) VALUES (?,?)').run(w.id, b.id); ledger.append(db, 'work.applauded', w.slug, {}); }
    const n = count(w.id);
    if (req.accepts('json') && !req.accepts('html')) return res.json({ ok: true, on: !had, n });
    res.format({ json: () => res.json({ ok: true, on: !had, n }), html: () => res.redirect(`/w/${w.slug}#applause`) });
  });
  app.post('/w/:slug/notes', (req, res) => {
    const w = work(req.params.slug); if (!w) return res.sendStatus(404);
    const x = req.body || {}, body = String(x.body || '').trim().replace(/\s+/g, ' ').slice(0, 280), name = String(x.name || '').trim().slice(0, 60) || null;
    if (body.length < 2 || !name || /https?:\/\/|www\./i.test(body)) return res.redirect(`/w/${w.slug}?note=check#notes`);
    // A home, not a comment section: the plain insults are turned away at the door; the maker removes the rest.
    if (UNKIND.test(body) || UNKIND.test(name)) return res.redirect(`/w/${w.slug}?note=kind#notes`);
    const b = person(req, res);
    if (db.prepare("SELECT COUNT(*) n FROM notes WHERE buyer_id=? AND at > datetime('now','-10 minutes')").get(b.id).n >= 3) return res.redirect(`/w/${w.slug}?note=slow#notes`);
    db.prepare('INSERT INTO notes (work_id, buyer_id, name, body) VALUES (?,?,?,?)').run(w.id, b.id, name || b.name || null, body);
    if (name && !b.name) db.prepare('UPDATE buyers SET name=? WHERE id=?').run(name, b.id);
    res.redirect(`/w/${w.slug}?note=1#notes`);
  });
  // The maker (or the Studio) may remove a note; the writer may remove their own.
  // The house book, read and signed.
  const houseLines = () => db.prepare("SELECT n.*, b.code, b.public, w.slug AS wslug, w.title AS wtitle, m.name AS maker FROM notes n LEFT JOIN buyers b ON b.id=n.buyer_id LEFT JOIN works w ON w.id=n.work_id AND w.status='held' LEFT JOIN makers m ON m.id=w.maker_id WHERE n.removed_at IS NULL AND n.gallery_id IS NULL AND (n.work_id=0 OR w.id IS NOT NULL) ORDER BY n.id DESC LIMIT 200").all();
  app.get('/guestbook', (req, res) => res.send(V.guestbook({ lines: houseLines(), chapters: CHAPTERS, chapter: CHAPTERS[req.query.chapter] ? req.query.chapter : null, note: req.query.note || null, from: /^https:\/\/([a-z0-9-]+\.)?(krafftco|wrkfullerton)\.com\//.test(String(req.query.from || '')) ? String(req.query.from) : null, canModerate: isStudio(req), me: (buyerOf(req) || {}).id || null })));
  app.post('/guestbook', (req, res) => {
    const x = req.body || {}, body = String(x.body || '').trim().replace(/\s+/g, ' ').slice(0, 280), name = String(x.name || '').trim().slice(0, 60) || null;
    const chapter = CHAPTERS[x.chapter] ? x.chapter : 'krafft';
    const back = q => res.redirect(`/guestbook?chapter=${chapter}${q}#sign`);
    if (body.length < 2 || !name || /https?:\/\/|www\./i.test(body)) return back('&note=check');
    if (UNKIND.test(body) || UNKIND.test(name)) return back('&note=kind');
    const b = person(req, res);
    if (db.prepare("SELECT COUNT(*) n FROM notes WHERE buyer_id=? AND at > datetime('now','-10 minutes')").get(b.id).n >= 3) return back('&note=slow');
    db.prepare('INSERT INTO notes (work_id, buyer_id, name, body, chapter) VALUES (0,?,?,?,?)').run(b.id, name, body, chapter);
    if (!b.name) db.prepare('UPDATE buyers SET name=? WHERE id=?').run(name, b.id);
    ledger.append(db, 'house.signed', chapter, {});
    back('&note=1');
  });
  app.post('/guestbook/:id/remove', (req, res) => {
    const n = db.prepare('SELECT * FROM notes WHERE id=? AND work_id=0').get(Number(req.params.id)); if (!n) return res.redirect('/guestbook');
    const b = buyerOf(req); if (!(isStudio(req) || (b && n.buyer_id === b.id))) return res.sendStatus(403);
    db.prepare("UPDATE notes SET removed_at=datetime('now') WHERE id=?").run(n.id);
    res.redirect('/guestbook');
  });
  app.post('/w/:slug/notes/:id/remove', (req, res) => {
    const w = work(req.params.slug); if (!w) return res.sendStatus(404);
    const n = db.prepare('SELECT * FROM notes WHERE id=? AND work_id=?').get(Number(req.params.id), w.id); if (!n) return res.redirect(`/w/${w.slug}#notes`);
    const b = buyerOf(req), m = makerOf(req);
    if (!(isStudio(req) || (m && m.id === w.maker_id) || (b && n.buyer_id === b.id))) return res.sendStatus(403);
    db.prepare("UPDATE notes SET removed_at=datetime('now') WHERE id=?").run(n.id);
    res.redirect(`/w/${w.slug}#notes`);
  });
  return { count, notesOf };
}

module.exports = { mountApplause };
