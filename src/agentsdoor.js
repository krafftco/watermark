'use strict';
// The agents' door (15 Nov 2026, #28). The Floor (front-desk, concierge) and the analyst read the house's own desk
// here, without a person's sign-in: one read-only answer, GET /agents/desk.json, for the last N days (?days=, 7 by
// default, 1 to 31). Three lists, each from named columns under a LIMIT, each from an index on its day column:
//   letters  what came to the desk: its number at the desk, the day, its kind (feedback, report, notice, dispute),
//            the work's slug if any, whether it has been answered. Never the words, never a name, never an address.
//   makers   who joined: maker number, the public handle, the day, the door, works brought in, works on view,
//            whether they have shared their page, whether their address is proven. No address, no name.
//   counts   by day: visits (people whose browser answered, `here`), joins, works in, works hung (`work.published` on
//            the register), pieces collected (the analytics' own rule: paid licences by the day they began).
// The door is shut unless AGENT_KEY (the host's environment, 32 characters or more) is set, and then answers only to
// `Authorization: Bearer <AGENT_KEY>`, compared in constant time. Shut, or asked without the key, or with a wrong key,
// or with the key in the address, it answers exactly as an address the house does not have (it steps aside to the
// house's own 404). The key is never logged: nothing here writes a header, and the request trail keeps only the path.
//
// THE WORDS OF GUESTS' LETTERS: only on counsel's and Will's word. AGENT_LETTERS=1 adds each letter's words (with any
// address in them masked). Off (the default), the words are not even read from the database: the statements below do
// not name the column.
//
// Cost, at 100,000 makers and a million works: letters, three range reads on the day index of each desk table (rows in
// the window only, 500 at most each); makers, one range read on makers(created_at) for the window, then for each of at
// most 500 makers two counts on works(maker_id, status, …) and one lookup on maker_steps' key; counts, five grouped
// range reads on day indexes (here's key, makers(created_at), works(created_at), ledger(type, at), licenses(starts_at)),
// each touching only the window's rows. Nothing walks the collection. It runs on the web process, as every other
// machine-facing door does (/healthz, the API): the worker answers no one.
const crypto = require('crypto');

const MIN_KEY = 32;
const PER_HOUR = 60;
const LIMIT = 500;

const keyOf = () => { const k = process.env.AGENT_KEY || ''; return k.length >= MIN_KEY ? k : null; };
const lettersOn = () => process.env.AGENT_LETTERS === '1';
const same = (a, b) => { const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest(); return crypto.timingSafeEqual(x, y) && a.length === b.length; };
const masked = s => (s == null ? null : String(s).replace(/[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+/g, '[address]'));
const dayOf = s => (s ? String(s).slice(0, 10) : null);
const slugOfPage = p => { const m = /^\/(?:w|m\/[^/]+)\/([a-z0-9-]+)/i.exec(String(p || '')); return m ? m[1] : null; };
const n = x => Number(x) || 0;

function mountAgentsDoor(app, { db }) {
  // The statements. Literals, so scripts/sql-check.js reads every one; the words' columns appear only in the *Words ones.
  const Q = {
    feedback: db.prepare('SELECT id, kind, page, done, at FROM feedback WHERE at >= ? ORDER BY id DESC LIMIT 500'),
    feedbackWords: db.prepare('SELECT id, kind, page, done, at, body FROM feedback WHERE at >= ? ORDER BY id DESC LIMIT 500'),
    reports: db.prepare('SELECT s.id, s.status, s.created_at, w.slug FROM sightings s JOIN works w ON w.id = s.work_id WHERE s.created_at >= ? ORDER BY s.id DESC LIMIT 500'),
    reportsWords: db.prepare('SELECT s.id, s.status, s.created_at, w.slug, s.note FROM sightings s JOIN works w ON w.id = s.work_id WHERE s.created_at >= ? ORDER BY s.id DESC LIMIT 500'),
    claims: db.prepare('SELECT d.id, d.kind, d.status, d.at, w.slug FROM disputes d JOIN works w ON w.id = d.work_id WHERE d.at >= ? ORDER BY d.id DESC LIMIT 500'),
    claimsWords: db.prepare('SELECT d.id, d.kind, d.status, d.at, w.slug, d.body FROM disputes d JOIN works w ON w.id = d.work_id WHERE d.at >= ? ORDER BY d.id DESC LIMIT 500'),
    makers: db.prepare(`SELECT m.id, m.handle, m.created_at, m.door, m.email_ok,
      (SELECT COUNT(*) FROM works w WHERE w.maker_id = m.id) AS works_in,
      (SELECT COUNT(*) FROM works w WHERE w.maker_id = m.id AND w.status = 'held') AS on_view,
      (SELECT COUNT(*) FROM maker_steps s WHERE s.maker_id = m.id AND s.step = 'shared') AS shared
      FROM makers m WHERE m.created_at >= ? AND m.kind IN ('maker', 'company') ORDER BY m.id DESC LIMIT 500`),
    visits: db.prepare('SELECT day AS d, COUNT(*) AS n FROM here WHERE day >= ? GROUP BY day ORDER BY day LIMIT 500'),
    joins: db.prepare("SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n FROM makers WHERE created_at >= ? AND kind IN ('maker', 'company') GROUP BY substr(created_at, 1, 10) LIMIT 500"),
    worksIn: db.prepare('SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n FROM works WHERE created_at >= ? GROUP BY substr(created_at, 1, 10) LIMIT 500'),
    hung: db.prepare("SELECT substr(at, 1, 10) AS d, COUNT(*) AS n FROM ledger WHERE type = 'work.published' AND at >= ? GROUP BY substr(at, 1, 10) LIMIT 500"),
    collected: db.prepare("SELECT substr(starts_at, 1, 10) AS d, COUNT(*) AS n FROM licenses WHERE starts_at >= ? AND status IN ('active', 'expired') AND price_cents > 0 GROUP BY substr(starts_at, 1, 10) LIMIT 500"),
  };

  // At most PER_HOUR answers an hour for a key, per process. This door is for machines, not people: the house's rule
  // that a person is never refused with a bare status does not apply here, so a plain 429 with Retry-After is right.
  const seen = new Map(); // sha256(key) → times answered in the last hour
  const limited = (key, now) => {
    const id = crypto.createHash('sha256').update(key).digest('hex');
    const t = (seen.get(id) || []).filter(x => now - x < 3600e3);
    if (t.length >= PER_HOUR) { seen.set(id, t); return Math.max(1, Math.ceil((t[0] + 3600e3 - now) / 1000)); }
    t.push(now); seen.set(id, t); return 0;
  };

  function letters(since, words) {
    const out = [];
    for (const r of (words ? Q.feedbackWords : Q.feedback).all(since)) out.push({ number: `F-${r.id}`, day: dayOf(r.at), kind: 'feedback', work: slugOfPage(r.page), answered: n(r.done) === 1, ...(words ? { words: masked(r.body) } : {}) });
    for (const r of (words ? Q.reportsWords : Q.reports).all(since)) out.push({ number: `R-${r.id}`, day: dayOf(r.created_at), kind: 'report', work: r.slug || null, answered: r.status !== 'new', ...(words ? { words: masked(r.note) } : {}) });
    // A claim that the photograph is theirs is a notice (17 U.S.C. §512 where it applies); any other claim is a dispute.
    for (const r of (words ? Q.claimsWords : Q.claims).all(since)) out.push({ number: `WM-C-${String(r.id).padStart(4, '0')}`, day: dayOf(r.at), kind: ['made', 'owns'].includes(r.kind) ? 'notice' : 'dispute', work: r.slug || null, answered: r.status !== 'open', ...(words ? { words: masked(r.body) } : {}) });
    return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)).slice(0, LIMIT);
  }
  function makers(since) {
    return Q.makers.all(since).map(r => ({ number: n(r.id), handle: /^[a-z0-9-]+$/i.test(r.handle || '') ? r.handle : null, day: dayOf(r.created_at), door: r.door || null, works_in: n(r.works_in), on_view: n(r.on_view), shared: n(r.shared) > 0, address_proven: r.email_ok == null ? null : n(r.email_ok) === 1 }));
  }
  function counts(since, days, today) {
    const by = st => { const m = new Map(); for (const r of st.all(since)) m.set(String(r.d), n(r.n)); return m; };
    const V = by(Q.visits), J = by(Q.joins), W = by(Q.worksIn), H = by(Q.hung), C = by(Q.collected);
    const out = [];
    for (let i = days - 1; i >= 0; i--) { const d = new Date(today - i * 864e5).toISOString().slice(0, 10); out.push({ day: d, visits: V.get(d) || 0, joins: J.get(d) || 0, works_in: W.get(d) || 0, works_hung: H.get(d) || 0, collected: C.get(d) || 0 }); }
    return out;
  }

  app.get('/agents/desk.json', (req, res, next) => {
    const key = keyOf(); if (!key) return next(); // shut: the house's own 404
    // Only the header. A key in the address is not a key (and the address is what logs keep).
    if (req.query && Object.keys(req.query).some(k => k !== 'days')) return next();
    const m = /^Bearer (\S+)$/.exec(req.get('authorization') || '');
    if (!m || !same(m[1], key)) return next();
    res.set('Cache-Control', 'private, no-store'); res.set('X-Robots-Tag', 'noindex');
    const wait = limited(key, Date.now());
    if (wait) { res.set('Retry-After', String(wait)); return res.status(429).type('text/plain').send('Too many requests.'); }
    const days = Math.min(31, Math.max(1, Math.floor(Number(req.query.days)) || 7));
    const now = Date.now(), today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
    const since = new Date(today - (days - 1) * 864e5).toISOString().slice(0, 10);
    const words = lettersOn();
    res.json({ at: new Date(now).toISOString(), days, since, words: words, letters: letters(since, words), makers: makers(since), counts: counts(since, days, today) });
  });
}

module.exports = { mountAgentsDoor, MIN_KEY, PER_HOUR };
