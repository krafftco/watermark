// Applause: a tip of the hat for a photograph. One per person per work, quiet and honourable: no
// counts in the grid, no leaderboard, only "Applauded by 42" on the work itself. The point is the
// signal: what people hold in high regard shapes the archive (the Studio sorts by standing and sees the
// duds), and the makers hear it. Notes are the conversation: a name and a sentence, held with the
// work, which its maker may remove.
const { nanoid } = require('nanoid');

function mountApplause(app, { db, buyerOf, setBuyer, isStudio, makerOf, ledger, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS applause (work_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (work_id, buyer_id))`);
  db.exec(`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, buyer_id INTEGER, name TEXT, body TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), removed_at TEXT)`);
  const work = slug => db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(slug));
  const count = id => db.prepare('SELECT COUNT(*) n FROM applause WHERE work_id=?').get(id).n;
  const mine = (id, b) => !!(b && db.prepare('SELECT 1 FROM applause WHERE work_id=? AND buyer_id=?').get(id, b.id));
  const notesOf = id => db.prepare('SELECT * FROM notes WHERE work_id=? AND removed_at IS NULL ORDER BY id DESC LIMIT 40').all(id);
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
    if (body.length < 2 || /https?:\/\//i.test(body)) return res.redirect(`/w/${w.slug}?note=check#notes`);
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
