// The bridge to the U.S. Copyright Office. The Office has no public API for filing: registrations are
// made in its own system (eCO) by the author, the claimant or their authorised agent. So Watermark does
// everything around the filing: it groups the photographs the way the Office allows (up to 750 by one
// author, published in one calendar year; or unpublished), prepares the title list and the deposit
// copies, tracks each group from filed to registered, and once a registration number is entered it
// shows on every photograph in the group, with the badge, on the Shield and on the work's life.
// Fees as published by the Office (Oct 2026): $55 for a group of published or unpublished photographs.
const archiver = require('archiver');

const MAX = 750;
const FEE = 5500;

function mountCopyright(app, { db, C, maker, studioOnly, ledger, images, originalPath, cache, V, S }) {
  db.exec(`CREATE TABLE IF NOT EXISTS copyright_groups (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, year INTEGER, title TEXT, sr TEXT, reg TEXT,
    status TEXT NOT NULL DEFAULT 'prepared', created_at TEXT NOT NULL DEFAULT (datetime('now')), filed_at TEXT, registered_at TEXT)`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='copyright_group'").get()) db.exec('ALTER TABLE works ADD COLUMN copyright_group INTEGER');

  // Photographs not yet in any group, sorted into the groups the Office accepts.
  function proposals() {
    const rows = db.prepare("SELECT id, slug, title, status, created_at, taken_at FROM works WHERE maker_id=? AND copyright_group IS NULL AND (copyright_reg IS NULL OR copyright_reg='') ORDER BY created_at, id").all(maker.id);
    const out = [];
    const byYear = {};
    for (const w of rows) {
      const key = w.status === 'held' ? 'pub-' + String(w.created_at).slice(0, 4) : 'unpub';
      (byYear[key] = byYear[key] || []).push(w);
    }
    for (const [key, list] of Object.entries(byYear)) {
      for (let i = 0; i < list.length; i += MAX) {
        const chunk = list.slice(i, i + MAX);
        const pub = key !== 'unpub', year = pub ? Number(key.slice(4)) : null;
        out.push({ key: `${key}-${i / MAX + 1}`, kind: pub ? 'GRPPH' : 'GRUPH', year, works: chunk,
          label: pub ? `Published in ${year}` : 'Unpublished', part: list.length > MAX ? i / MAX + 1 : null });
      }
    }
    return out;
  }
  const groups = () => db.prepare('SELECT g.*, (SELECT COUNT(*) FROM works w WHERE w.copyright_group=g.id) n FROM copyright_groups g ORDER BY g.id DESC').all();

  app.get('/studio/copyright', studioOnly, (req, res) => {
    const reg = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND copyright_reg IS NOT NULL AND copyright_reg!=''").get(maker.id).n;
    res.send(S.copyright({ proposals: proposals(), groups: groups(), reg, fee: FEE, notice: req.query.ok }));
  });
  // Prepare a group: the photographs are set aside for this filing.
  app.post('/studio/copyright/prepare', studioOnly, (req, res) => {
    const p = proposals().find(x => x.key === String((req.body || {}).key)); if (!p) return res.redirect('/studio/copyright');
    const id = db.prepare('INSERT INTO copyright_groups (kind, year, title) VALUES (?,?,?)').run(p.kind, p.year, `${maker.name}: ${p.label}${p.part ? `, part ${p.part}` : ''}`).lastInsertRowid;
    const set = db.prepare('UPDATE works SET copyright_group=? WHERE id=?'); p.works.forEach(w => set.run(id, w.id));
    ledger.append(db, 'copyright.prepared', `group-${id}`, { kind: p.kind, year: p.year, works: p.works.length });
    res.redirect('/studio/copyright?ok=' + encodeURIComponent(`Group prepared: ${p.works.length} photograph${p.works.length === 1 ? "" : "s"}. Download the title list and the deposit, then file it in eCO.`));
  });
  // The title list, in the order and form the group application asks for.
  app.get('/studio/copyright/:id/titles.csv', studioOnly, (req, res) => {
    const g = db.prepare('SELECT * FROM copyright_groups WHERE id=?').get(Number(req.params.id)); if (!g) return res.sendStatus(404);
    const ws = db.prepare('SELECT * FROM works WHERE copyright_group=? ORDER BY created_at, id').all(g.id);
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [['Title', 'File name', g.kind === 'GRPPH' ? 'Publication date' : 'Date of creation', 'Accession'].map(q).join(',')]
      .concat(ws.map(w => [w.title, `${w.slug}.jpg`, g.kind === 'GRPPH' ? String(w.created_at).slice(0, 10) : String(w.taken_at || w.created_at).slice(0, 10), w.accession || ''].map(q).join(',')));
    res.set('Content-Disposition', `attachment; filename="copyright-group-${g.id}-titles.csv"`).type('text/csv').send(lines.join('\r\n'));
  });
  // The deposit: one JPEG for each photograph, named as in the title list.
  app.get('/studio/copyright/:id/deposit.zip', studioOnly, async (req, res) => {
    const g = db.prepare('SELECT * FROM copyright_groups WHERE id=?').get(Number(req.params.id)); if (!g) return res.sendStatus(404);
    const ws = db.prepare('SELECT * FROM works WHERE copyright_group=? ORDER BY created_at, id').all(g.id);
    res.set('Content-Disposition', `attachment; filename="copyright-group-${g.id}-deposit.zip"`).type('application/zip');
    const zip = archiver('zip', { zlib: { level: 0 } }); zip.on('error', e => { console.error('[copyright]', e.message); res.end(); }); zip.pipe(res);
    for (const w of ws) { try { zip.file(await images.derivative(await originalPath(w), cache, w.slug, 'screen'), { name: `${w.slug}.jpg` }); } catch (e) { /* missing original: left out */ } }
    zip.finalize();
  });
  app.post('/studio/copyright/:id', studioOnly, (req, res) => {
    const g = db.prepare('SELECT * FROM copyright_groups WHERE id=?').get(Number(req.params.id)); if (!g) return res.redirect('/studio/copyright');
    const b = req.body || {}, t = v => String(v || '').trim().slice(0, 40);
    if (b.act === 'filed' && t(b.sr)) {
      db.prepare("UPDATE copyright_groups SET sr=?, status='filed', filed_at=datetime('now') WHERE id=?").run(t(b.sr), g.id);
      ledger.append(db, 'copyright.filed', `group-${g.id}`, { sr: t(b.sr) });
    } else if (b.act === 'registered' && /^[A-Z]{1,4}\s?[A-Za-z0-9-]{3,}/i.test(t(b.reg))) {
      const reg = t(b.reg).toUpperCase();
      db.prepare("UPDATE copyright_groups SET reg=?, status='registered', registered_at=datetime('now') WHERE id=?").run(reg, g.id);
      db.prepare('UPDATE works SET copyright_reg=? WHERE copyright_group=?').run(reg, g.id);
      ledger.append(db, 'copyright.registered', `group-${g.id}`, { reg, works: db.prepare('SELECT COUNT(*) n FROM works WHERE copyright_group=?').get(g.id).n });
    } else if (b.act === 'release' && g.status === 'prepared') {
      db.prepare('UPDATE works SET copyright_group=NULL WHERE copyright_group=?').run(g.id);
      db.prepare('DELETE FROM copyright_groups WHERE id=?').run(g.id);
    }
    res.redirect('/studio/copyright');
  });
  return { proposals, groups };
}

module.exports = { mountCopyright, MAX, FEE };
