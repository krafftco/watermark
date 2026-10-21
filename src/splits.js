// Splits and releases (Will, 18 Oct, after Switchchord: agree who shares in a work before it sells, and keep the
// consent that lets it be shown). A work's splits are shares of the maker's side (a second shooter, an assistant,
// an estate, a collaborator); the house's part is never touched. A release records the consent of someone pictured
// or a property; the person's name stays private to the maker and the house. Partners the maker has connected see
// the splits (src/bridge.js). The statement deducts what is owed to collaborators; the house pays them by hand
// until Connect is on.
function mountSplits(app, { db, V, ledger, isStudio, makerOf, mk }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_splits (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT, did TEXT, role TEXT, pct REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS work_releases (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, signed_on TEXT, kept_at TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  const of = workId => db.prepare('SELECT * FROM work_splits WHERE work_id=? ORDER BY id').all(workId);
  const releases = workId => db.prepare('SELECT * FROM work_releases WHERE work_id=? ORDER BY id').all(workId);
  const others = workId => of(workId).reduce((s, x) => s + x.pct, 0);
  // What the maker's paid sales owe to collaborators: each paid license × the maker's share × each split's share.
  function owedOut(m) {
    const pct = (m.share_pct || 85) / 100, FEE = require('./fee');
    const rows = db.prepare("SELECT l.price_cents, l.house_cents, l.work_id FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents > 0 AND l.work_id IN (SELECT work_id FROM work_splits)").all(m.id);
    let s = 0, n = 0; const by = {};
    for (const r of rows) for (const sp of of(r.work_id)) { const c = Math.round(FEE.makerOf(r, m.share_pct || 85) * sp.pct / 100); s += c; n++; by[sp.name] = (by[sp.name] || 0) + c; }
    return { s, n, by };
  }
  app.locals.splits = { of, releases, owedOut, others };

  const may = (req, w) => !!w && (isStudio(req) || (makerOf(req) || {}).id === w.maker_id);
  app.get('/account/works/:slug/splits', (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(String(req.params.slug)); if (!may(req, w)) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    res.send(V.splitsPage({ w, m: mk(w), splits: of(w.id), releases: releases(w.id), ok: req.query.ok }));
  });
  app.post('/account/works/:slug/splits', (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(String(req.params.slug)); if (!may(req, w)) return res.sendStatus(403);
    const b = req.body || {}, back = ok => res.redirect(`/account/works/${w.slug}/splits?ok=${ok}`);
    if (b.act === 'split') {
      const name = String(b.name || '').trim().slice(0, 120), pct = Math.round(parseFloat(b.pct) * 100) / 100;
      if (!name || !(pct > 0) || others(w.id) + pct > 100) return back('pct');
      db.prepare('INSERT INTO work_splits (work_id, name, email, did, role, pct) VALUES (?,?,?,?,?,?)').run(w.id, name, String(b.email || '').trim().slice(0, 160) || null, /^did:/.test(String(b.did || '').trim()) ? String(b.did).trim().slice(0, 200) : null, String(b.role || '').trim().slice(0, 60) || null, pct);
      ledger.append(db, 'work.split', w.slug, { role: String(b.role || '').slice(0, 60) || null, pct });
      return back('split');
    }
    if (b.act === 'unsplit') { db.prepare('DELETE FROM work_splits WHERE id=? AND work_id=?').run(Number(b.id), w.id); return back('split'); }
    if (b.act === 'release') {
      const kind = b.kind === 'property' ? 'property' : 'model', subject = String(b.subject || '').trim().slice(0, 160); if (!subject) return back('release-missing');
      db.prepare('INSERT INTO work_releases (work_id, kind, subject, signed_on, kept_at, note) VALUES (?,?,?,?,?,?)').run(w.id, kind, subject, /^\d{4}-\d{2}-\d{2}$/.test(b.signed_on || '') ? b.signed_on : null, String(b.kept_at || '').trim().slice(0, 300) || null, String(b.note || '').slice(0, 400) || null);
      ledger.append(db, 'work.released', w.slug, { kind });
      return back('release');
    }
    if (b.act === 'unrelease') { db.prepare('DELETE FROM work_releases WHERE id=? AND work_id=?').run(Number(b.id), w.id); return back('release'); }
    back('');
  });
  return app.locals.splits;
}
module.exports = { mountSplits };
