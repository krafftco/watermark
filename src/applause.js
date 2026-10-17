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
  const work = slug => db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(slug));
  const count = id => db.prepare('SELECT COUNT(*) n FROM applause WHERE work_id=?').get(id).n;
  const mine = (id, b) => !!(b && db.prepare('SELECT 1 FROM applause WHERE work_id=? AND buyer_id=?').get(id, b.id));
  // A line in the book is signed by a person: when their collection is public, the signature opens it.
  const notesOf = id => db.prepare('SELECT n.*, b.code, b.public, (SELECT COUNT(*) FROM notes x WHERE x.buyer_id=n.buyer_id AND x.seen_at IS NOT NULL AND x.removed_at IS NULL) AS regard FROM notes n LEFT JOIN buyers b ON b.id=n.buyer_id WHERE n.work_id=? AND n.removed_at IS NULL ORDER BY n.id DESC LIMIT 40').all(id);
  // What a person has written in the books, for their collection page.
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
