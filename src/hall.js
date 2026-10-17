// The Hall of Patrons. The people who founded things here are honoured the way the great houses honour
// theirs: a portrait, made by the house, hung in a room of its own, with a brass plate beneath. Each
// portrait is a photograph held in the vault like any other, so it is on the register and in the
// collection. The Studio hangs a portrait by naming the work; the sitter's consent is the Studio's word.
function mountHall(app, { db, studioOnly, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS hall (id INTEGER PRIMARY KEY, name TEXT NOT NULL, founded TEXT, year INTEGER, work_id INTEGER, note TEXT, house TEXT NOT NULL DEFAULT 'watermark',
    sort INTEGER NOT NULL DEFAULT 0, public INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const rows = (all = false) => db.prepare(`SELECT h.*, w.slug, w.title, w.width, w.height, w.status FROM hall h LEFT JOIN works w ON w.id=h.work_id ${all ? '' : 'WHERE h.public=1'} ORDER BY h.sort, h.year, h.id`).all();
  app.get('/patrons', (req, res) => res.send(V.hall({ patrons: rows().map(p => ({ ...p, slug: p.status === 'held' ? p.slug : null })) })));

  app.get('/studio/hall', studioOnly, (req, res) => res.send(V.hallDesk({ patrons: rows(true), ok: req.query.ok || null })));
  app.post('/studio/hall', studioOnly, (req, res) => {
    const x = req.body || {}, t = (v, n) => String(v || '').trim().slice(0, n) || null;
    const w = x.work ? db.prepare('SELECT id FROM works WHERE slug=?').get(String(x.work).trim()) : null;
    if (!t(x.name, 120)) return res.redirect('/studio/hall?ok=name');
    if (x.id) db.prepare('UPDATE hall SET name=?, founded=?, year=?, work_id=?, note=?, house=?, sort=?, public=? WHERE id=?').run(t(x.name, 120), t(x.founded, 160), Number(x.year) || null, w ? w.id : null, t(x.note, 400), x.house === 'krafft' ? 'krafft' : 'watermark', Number(x.sort) || 0, x.public ? 1 : 0, Number(x.id));
    else db.prepare('INSERT INTO hall (name, founded, year, work_id, note, house, sort, public) VALUES (?,?,?,?,?,?,?,?)').run(t(x.name, 120), t(x.founded, 160), Number(x.year) || null, w ? w.id : null, t(x.note, 400), x.house === 'krafft' ? 'krafft' : 'watermark', Number(x.sort) || 0, x.public ? 1 : 0);
    res.redirect('/studio/hall?ok=' + encodeURIComponent(w || !x.work ? 'Hung.' : 'Saved, but no work by that slug; the portrait is empty.'));
  });
  app.post('/studio/hall/:id/remove', studioOnly, (req, res) => { db.prepare('DELETE FROM hall WHERE id=?').run(Number(req.params.id)); res.redirect('/studio/hall?ok=Taken+down.'); });
  app.locals.hallCount = () => db.prepare('SELECT COUNT(*) n FROM hall WHERE public=1').get().n;
}

module.exports = { mountHall };
