// Child safety (29 Oct, Will: "we also need to screen and scan and make sure things aren't child pornography; we have
// to be super careful"; "make sure we don't get sued for anything like child or user accounts"). docs/CHILD-SAFETY.md.
// A work read as a child unclothed or in a sexual picture, or one the house's reader refuses to read, is quarantined
// at once: status 'quarantined' (the status before kept), kept back, served to no one (every public query asks for
// 'held'; /img and the files answer 404 for it, the maker included), the house written to without the picture, and
// told on the register as hidden. Nothing is deleted: the law asks a provider to preserve what it reports. A person
// at the house decides, at /studio/safety: Report (the NCMEC CyberTipline, by hand; the file kept a year), or Release
// (the reading was wrong: a work of art, a bath, a beach), each recorded. Hash matching against known images
// (Microsoft PhotoDNA, Thorn's Safer) is the industry's first line and is Will's to apply for; SAFETY_HASH names
// the provider once it is in. The house never builds face recognition.
'use strict';
function mountSafety(app, { db, V, ledger, studioOnly, originalPath }) {
  db.exec(`CREATE TABLE IF NOT EXISTS safety_holds (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, why TEXT, status TEXT NOT NULL DEFAULT 'held',
    decided_by TEXT, decided_at TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const esc = V.esc;
  function quarantine(w, why) {
    const f = db.prepare('SELECT * FROM works WHERE id=?').get(w.id); if (!f || f.status === 'quarantined') return false;
    db.prepare("UPDATE works SET status='quarantined', status_before=?, keep_back=1 WHERE id=?").run(f.status, f.id);
    db.prepare('INSERT INTO safety_holds (work_id, why) VALUES (?,?)').run(f.id, String(why || '').slice(0, 200));
    ledger.append(db, 'work.quarantined', f.slug, { why });
    if (app.locals.findIndexDirty) app.locals.findIndexDirty();
    const to = process.env.HOUSE_EMAIL; const base = process.env.BASE_URL || '';
    if (to) require('./mail').send({ to, subject: 'A work is held for the house’s look', text: `A work has been taken out of every room and held: ${why}.\n\nNo picture is in this letter. Look at it only at the Studio's safety desk, and follow the steps there.\n\n${base}/studio/safety\n\nWatermark` }).catch(() => {});
    console.log('[safety] held', f.slug, why);
    return true;
  }
  const isHeld = w => w && w.status === 'quarantined';

  const page = (title, inner) => V.layout({ title: `${title} · Watermark`, studio: true, body: `<section class="studio-wrap sfy">${inner}</section>` });
  app.get('/studio/safety', studioOnly, (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const rows = db.prepare(`SELECT h.*, w.slug, w.title, w.accession, w.created_at AS arrived, m.name AS maker, m.handle FROM safety_holds h JOIN works w ON w.id=h.work_id JOIN makers m ON m.id=w.maker_id ORDER BY (h.status='held') DESC, h.id DESC LIMIT 200`).all();
    res.send(page('Safety', `<p class="k"><a href="/studio">The house</a></p><h1>Held for the house’s look.</h1>
<p class="lede">Works the house will not show until a person has decided. No picture is shown on this page.</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<ol class="sfy-steps"><li>Open a held work only if you must decide on it, and only here.</li><li>If it is, or may be, a sexual picture of a child: <b>do not download, copy or forward it</b>. Report it to the NCMEC CyberTipline (report.cybertip.org), mark it Reported, and leave it held: the house keeps it, untouched, for a year, as the law asks. Tell counsel.</li><li>If the reading was simply wrong (a work of art, a family beach), Release it with a word.</li></ol>
<table class="tbl sfy-t"><thead><tr><th>Work</th><th>Maker</th><th>Why</th><th>Held</th><th>State</th><th></th></tr></thead><tbody>
${rows.map(r => `<tr><td>${esc(r.accession || r.slug)}</td><td>${esc(r.maker)}</td><td>${esc(r.why || '')}</td><td>${esc(String(r.created_at).slice(0, 16))}</td><td>${esc(r.status)}${r.decided_by ? ` · ${esc(r.decided_by)}` : ''}</td>
<td>${r.status === 'held' ? `<a href="/studio/safety/${r.id}">Decide</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing held.</td></tr>'}</tbody></table>`));
  });
  app.get('/studio/safety/:id', studioOnly, (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const h = db.prepare('SELECT * FROM safety_holds WHERE id=?').get(+req.params.id); if (!h) return res.sendStatus(404);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(h.work_id);
    const look = req.query.look === '1';
    if (look) ledger.append(db, 'safety.looked', w.slug, { hold: h.id });
    res.send(page('Decide', `<p class="k"><a href="/studio/safety">Safety</a></p><h1>${esc(w.accession || w.slug)}</h1><p class="lede">${esc(h.why || '')}</p>
${look ? `<figure class="sfy-look"><img src="/studio/safety/${h.id}/look.jpg" alt="" referrerpolicy="no-referrer"></figure>` : `<p><a class="btn ghost" href="/studio/safety/${h.id}?look=1">Look at it, here only</a> <span class="muted">Your look is recorded.</span></p>`}
<form method="post" action="/studio/safety/${h.id}" class="sfy-f"><label>A word<input name="note" maxlength="300"></label>
<button class="btn" name="do" value="reported">It is reported to NCMEC: keep it held</button> <button class="btn ghost" name="do" value="release">The reading was wrong: release it</button></form>`));
  });
  app.get('/studio/safety/:id/look.jpg', studioOnly, async (req, res) => {
    const h = db.prepare('SELECT * FROM safety_holds WHERE id=?').get(+req.params.id); if (!h) return res.sendStatus(404);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(h.work_id);
    try { const buf = await require('sharp')(await originalPath(w)).rotate().resize(900, 900, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer(); res.set('Cache-Control', 'private, no-store').set('Content-Disposition', 'inline').type('image/jpeg').send(buf); } catch (e) { res.sendStatus(404); }
  });
  app.post('/studio/safety/:id', studioOnly, (req, res) => {
    const h = db.prepare('SELECT * FROM safety_holds WHERE id=?').get(+req.params.id); if (!h || h.status !== 'held') return res.redirect('/studio/safety');
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(h.work_id); const note = String(req.body.note || '').slice(0, 300);
    if (req.body.do === 'release') {
      db.prepare("UPDATE works SET status=COALESCE(NULLIF(status_before,'quarantined'),'hidden'), keep_back=0 WHERE id=?").run(w.id);
      db.prepare("UPDATE safety_holds SET status='released', decided_by='studio', decided_at=datetime('now'), note=? WHERE id=?").run(note, h.id);
      ledger.append(db, 'safety.released', w.slug, { hold: h.id });
      return res.redirect('/studio/safety?ok=' + encodeURIComponent('Released.'));
    }
    db.prepare("UPDATE safety_holds SET status='reported', decided_by='studio', decided_at=datetime('now'), note=? WHERE id=?").run(note, h.id);
    ledger.append(db, 'safety.reported', w.slug, { hold: h.id });
    res.redirect('/studio/safety?ok=' + encodeURIComponent('Marked reported. It stays held and untouched.'));
  });
  const waiting = () => db.prepare("SELECT COUNT(*) n FROM safety_holds WHERE status='held'").get().n;
  app.locals.safety = { quarantine, isHeld, waiting };
  return app.locals.safety;
}
module.exports = { mountSafety };
