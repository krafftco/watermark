// The beta (Will, 18 Oct: it is live, but it is still a beta; test it, then launch it properly).
// Anyone can tell the house what they found (/feedback); the Studio reads it at /studio/feedback and marks it done.
// The house is in beta until the Studio says it has launched (settings 'launched'); then the word and the
// footer line go, and the feedback page stays for whoever finds it.
function mountBeta(app, { db, V, mail, studioOnly, C }) {
  db.exec(`CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY, kind TEXT, body TEXT NOT NULL, email TEXT, page TEXT, device TEXT, ip TEXT, done INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const launched = () => { const r = db.prepare("SELECT v FROM settings WHERE k='launched'").get(); return !!(r && r.v === '1'); };
  V.setLaunched(launched());
  const recent = new Map();
  const local = u => { const s = String(u || ''); return s.startsWith('/') && !s.startsWith('//') ? s.slice(0, 300) : ''; };
  app.get('/feedback', (req, res) => res.send(V.feedbackPage({ from: local(req.query.from || (req.get('referer') || '').replace(/^https?:\/\/[^/]+/, '')), sent: req.query.sent === '1' })));
  app.post('/feedback', (req, res) => {
    const b = req.body || {}, from = local(b.from);
    if (b.website) return res.redirect('/feedback?sent=1'); // the field people cannot see
    const body = String(b.body || '').trim().slice(0, 4000);
    if (body.length < 3) return res.send(V.feedbackPage({ from, err: 'A line about what happened, please.' }));
    const ip = req.ip || '', now = Date.now(), seen = (recent.get(ip) || []).filter(t => now - t < 600e3);
    if (seen.length >= 6) return res.send(V.feedbackPage({ from, err: 'Thank you; that is plenty for now. Try again in a few minutes.' }));
    recent.set(ip, seen.concat(now));
    const kind = ['broke', 'confusing', 'idea', 'loved'].includes(b.kind) ? b.kind : 'idea';
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email || '').trim()) ? String(b.email).trim().slice(0, 160) : null;
    const ua = String(req.get('user-agent') || ''), device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other';
    const id = db.prepare('INSERT INTO feedback (kind, body, email, page, device, ip) VALUES (?,?,?,?,?,?)').run(kind, body, email, from || null, device, ip.slice(0, 60)).lastInsertRowid;
    mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `Beta: ${kind}${from ? ' on ' + from : ''}`, text: `${body}\n\n${email ? `From ${email}. ` : ''}${device}${from ? `, on ${C.base}${from}` : ''}.\n\n${C.base}/studio/feedback`, cta: { label: 'Read it in the Studio', url: `${C.base}/studio/feedback` } });
    if (app.locals.notify && app.locals.notify.house) try { app.locals.notify.house('feedback', { id, kind }); } catch (e) {}
    res.redirect('/feedback?sent=1' + (from ? '&from=' + encodeURIComponent(from) : ''));
  });
  app.get('/studio/feedback', studioOnly, (req, res) => res.send(V.feedbackDesk({ rows: db.prepare('SELECT * FROM feedback ORDER BY done, id DESC LIMIT 300').all(), ok: req.query.ok })));
  app.post('/studio/feedback/:id', studioOnly, (req, res) => { db.prepare('UPDATE feedback SET done=1-done WHERE id=?').run(Number(req.params.id)); res.redirect('/studio/feedback'); });
  // The launch switch, on Studio → Launch.
  app.post('/studio/launch/state', studioOnly, (req, res) => {
    const on = (req.body || {}).launched === '1';
    db.prepare("INSERT INTO settings (k, v) VALUES ('launched', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(on ? '1' : '0');
    V.setLaunched(on);
    res.redirect('/studio/launch?ok=' + encodeURIComponent(on ? 'Launched. The beta word and the footer line are gone.' : 'Back in beta.'));
  });
  return { launched, open: () => db.prepare('SELECT COUNT(*) n FROM feedback WHERE done=0').get().n };
}
module.exports = { mountBeta };
