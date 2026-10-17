// Standing in front of a photograph. The house remembers who stood in front of each work and when:
// the first hundred are told so ("you were the 7th person to stand in front of this"), and a person's
// own looking is kept for them alone on Yours: how many photographs this month, which ones, how long.
// A viewer is a quiet code the browser keeps (the same one the guard uses); when they sign in, the code
// joins their account, so the looking they did before follows them.
const FIRST = 100;

function mountFirsts(app, { db, buyerOf, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS stood (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, viewer TEXT NOT NULL, buyer_id INTEGER, n INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')), seconds INTEGER NOT NULL DEFAULT 0, UNIQUE (work_id, viewer))`);
  db.exec('CREATE INDEX IF NOT EXISTS stood_buyer ON stood (buyer_id, at)');
  const work = slug => db.prepare("SELECT id, slug, title FROM works WHERE slug=? AND status='held'").get(String(slug));
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th');

  // The page says: I am standing here. Once per viewer per work, it is numbered; every time, the seconds add up.
  app.post('/w/:slug/stood', require('express').text({ type: '*/*', limit: '2kb' }), (req, res) => {
    const w = work(req.params.slug); if (!w) return res.sendStatus(204);
    let b = req.body && typeof req.body === 'object' ? req.body : {}; if (typeof req.body === 'string') { try { b = JSON.parse(req.body || '{}'); } catch (e) { /* plain */ } }
    const v = String(b.v || '').replace(/[^a-z0-9]/gi, '').slice(0, 16); if (!v) return res.sendStatus(204);
    const buyer = buyerOf(req); const secs = Math.max(0, Math.min(3600, Math.round(Number(b.s) || 0)));
    const had = db.prepare('SELECT id, n FROM stood WHERE work_id=? AND viewer=?').get(w.id, v);
    if (had) { db.prepare('UPDATE stood SET seconds=seconds+?, buyer_id=COALESCE(buyer_id, ?) WHERE id=?').run(secs, buyer ? buyer.id : null, had.id); return res.json({ n: had.n }); }
    const n = db.prepare('SELECT COUNT(*) n FROM stood WHERE work_id=?').get(w.id).n + 1;
    db.prepare('INSERT OR IGNORE INTO stood (work_id, viewer, buyer_id, n, seconds) VALUES (?,?,?,?,?)').run(w.id, v, buyer ? buyer.id : null, n, secs);
    res.json({ n, first: n <= FIRST, line: n <= FIRST ? `You are the ${ord(n)} person to stand in front of this.` : null });
  });
  // When a viewer signs in, their earlier looking joins them.
  app.locals.claimStood = (res, req, buyer) => { const v = req.cookies && req.cookies.wm_v; if (v && buyer) db.prepare('UPDATE stood SET buyer_id=? WHERE viewer=? AND buyer_id IS NULL').run(buyer.id, String(v).slice(0, 16)); };
  // For the work page: how many have stood here, and whether this viewer was among the first.
  app.locals.stoodOf = (w, req) => {
    const v = req.cookies && req.cookies.wm_v; const n = db.prepare('SELECT COUNT(*) n FROM stood WHERE work_id=?').get(w.id).n;
    const mine = v ? db.prepare('SELECT n FROM stood WHERE work_id=? AND viewer=?').get(w.id, String(v).slice(0, 16)) : null;
    return { n, mine: mine ? mine.n : null, first: FIRST, ord };
  };
  // For Yours, private: this month's looking.
  app.locals.lookingOf = (b, req) => {
    const v = req.cookies && req.cookies.wm_v; const who = b ? 'buyer_id=? OR viewer=?' : 'viewer=?'; const args = b ? [b.id, String(v || '').slice(0, 16)] : [String(v || '').slice(0, 16)];
    if (!b && !v) return null;
    const month = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(seconds),0) s FROM stood WHERE (${who}) AND at > datetime('now','start of month')`).get(...args);
    const firsts = db.prepare(`SELECT COUNT(*) n FROM stood WHERE (${who}) AND n <= ${FIRST}`).get(...args).n;
    const longest = db.prepare(`SELECT w.slug, w.title, s.seconds FROM stood s JOIN works w ON w.id=s.work_id WHERE (${who}) AND w.status='held' ORDER BY s.seconds DESC LIMIT 3`).all(...args);
    return { month: month.n, seconds: month.s, firsts, longest };
  };
  return { FIRST };
}

module.exports = { mountFirsts, FIRST };
