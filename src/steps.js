// First steps (Will, 18 Oct: everything we do for ourselves should be doable by other people; the test is an
// outside maker who gets from the invitation letter to a page, prices and a paid sale without anyone's help).
// A short card on the maker's studio, each step ticked by what the house can see, never by a box they tick:
//   your page (a portrait or a few lines) · your work put in · your best shown (graded, published) ·
//   your prices looked over · a passkey saved · your bank for getting paid · your page sent to someone.
// It folds away when every step is done, or when the maker puts it away. Nothing of it is on the register.
function mountSteps(app, { db, makerOf, V, base = '' }) {
  db.exec(`CREATE TABLE IF NOT EXISTS maker_steps (maker_id INTEGER NOT NULL, step TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (maker_id, step))`);
  const mark = (m, step) => db.prepare('INSERT OR IGNORE INTO maker_steps (maker_id, step) VALUES (?,?)').run(m.id, step);
  const has = (m, step) => !!db.prepare('SELECT 1 FROM maker_steps WHERE maker_id=? AND step=?').get(m.id, step);
  // The prices page counts as looked over once the maker opens it (seen before the route that answers it).
  app.use('/account/prices', (req, res, next) => { if (req.method === 'GET') { const m = makerOf(req); if (m) mark(m, 'prices'); } next(); });
  app.post('/account/steps/:step', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const step = String(req.params.step); if (!['shared', 'away'].includes(step)) return res.sendStatus(400);
    mark(m, step);
    if (req.accepts(['json', 'html']) === 'json') return res.json({ ok: true });
    res.redirect('/account');
  });
  function of(m, keyed) {
    if (!m || has(m, 'away') || m.kind === 'gallery') return null;
    const n = sql => db.prepare(sql).get(m.id).n;
    const works = n('SELECT COUNT(*) n FROM works WHERE maker_id=?');
    const shown = n("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'");
    const graded = n('SELECT COUNT(*) n FROM works WHERE maker_id=? AND stars > 0');
    const slug = V.makerSlug(m);
    const steps = [
      { key: 'page', done: !!(m.portrait || (m.bio && m.bio.length > 20)), title: 'Your page', line: 'A portrait and a few lines: who you are and what you make.', href: '/account/profile', go: 'Write it' },
      { key: 'work', done: works > 0, title: 'Your work', line: 'Put in the originals. Each is fingerprinted and entered on the register as it arrives.', href: '/account/upload', go: 'Put work in' },
      { key: 'edit', done: shown > 0 && graded > 0, title: 'Your best in front', line: 'Grade with stars, then publish what you would hang. The rest stays kept, never lost.', href: '/account#holdings', go: 'Grade and publish' },
      { key: 'prices', done: has(m, 'prices'), title: 'Your prices', line: 'The house sets fair drafts for each use. Look them over and change any.', href: '/account/prices', go: 'See your prices' },
      { key: 'key', done: !!keyed, title: 'Your key', line: 'Save a passkey so your studio opens from any device, with no password.', href: '/account#passkey', go: 'Save a passkey' },
      { key: 'paid', done: !!m.stripe_account, title: 'Getting paid', line: `${require('./fee').said(m.share_pct, null).replace(/^The price is the maker’s/, 'The price is yours')} Add your bank and it is paid to you.`, href: '/account/payouts', go: 'Add your bank' },
      { key: 'shared', done: has(m, 'shared'), title: 'Your page, sent', line: 'Send your page to the people who already follow your work.', href: `/m/${slug}`, go: 'Copy your page', copy: `${base}/m/${slug}` },
    ];
    // Three first (23 Oct, for a photographer with a phone in a gallery): one photograph in, graded and shown, a price.
    // The other four come once those are done. Nothing is dropped; the order is the night's.
    const first = ['work', 'edit', 'prices'].map(k => steps.find(s => s.key === k)), rest = steps.filter(s => !first.includes(s));
    const list = first.some(s => !s.done) ? first : rest;
    const done = list.filter(s => s.done).length;
    if (done === list.length) return null;
    return { steps: list, done, total: list.length, next: list.find(s => !s.done), phase: list === first ? 'first' : 'rest' };
  }
  return { of, mark };
}
module.exports = { mountSteps };
