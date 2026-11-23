// The first week (Will, 26 Oct: the Make verb's front end; the test every outside maker takes: from the invitation
// letter on a phone to a page, prices, a bank and a paid sale without anyone on the phone with them).
// (1) The letter lands them in the vault: a maker's first opening of the invitation goes to Add work, not a desk.
// (2) Seven mornings: one short letter a day for seven days after joining, each with one act and one tap, sent
//     only while that act is undone; nothing once everything is done. Kept in `first_week`, once per maker per day.
// (3) Who is stuck where, for the house: a line per maker on Studio → Accounts ('3 of 7 · stuck at your bank · 4 days').
// (4) The first sale: when an outside maker's work is paid for the first time, the house is mailed and told, so a
//     personal word can go out that day; `maker.firstsale` hidden on the register.
'use strict';
const ROLE = require('./role');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAY = 86400000;

function mountFirstWeek(app, { db, C, mail, ledger, steps }) {
  db.exec('CREATE TABLE IF NOT EXISTS first_week (maker_id INTEGER NOT NULL, day INTEGER NOT NULL, act TEXT, sent_at TEXT NOT NULL DEFAULT (datetime(\'now\')), PRIMARY KEY (maker_id, day))');
  const n = (sql, ...a) => { try { return db.prepare(sql).get(...a).n; } catch (e) { return 0; } };
  const has = (m, step) => !!db.prepare('SELECT 1 FROM maker_steps WHERE maker_id=? AND step=?').get(m.id, step);
  const first = m => String(m.name || '').split(/\s+/)[0] || 'there';

  // The seven acts, in the order of the week. Each is read from what the house can see, never a box ticked.
  // `k` (optional): the counts already asked for many makers at once (`lines`, #90); without it, asked for this one.
  function acts(m, k = null) {
    const works = k ? k.works : n('SELECT COUNT(*) n FROM works WHERE maker_id=?', m.id);
    const shown = k ? k.shown : n("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'", m.id);
    const graded = k ? k.graded : n('SELECT COUNT(*) n FROM works WHERE maker_id=? AND stars > 0', m.id);
    const albums = k ? k.albums : n('SELECT COUNT(*) n FROM deliveries WHERE maker_id=?', m.id);
    const alm = k ? k.alm : n("SELECT COUNT(*) n FROM texts WHERE maker_id=? AND kind='almanack'", m.id);
    const had = step => (k ? !!(k.steps && k.steps.has(step)) : has(m, step));
    return [
      { key: 'work', title: 'Your work', done: works > 0, href: '/account/upload', go: 'Put work in', line: 'Bring in what you made. Each file is fingerprinted, deeded and written to the register the moment it arrives; nothing is shown until you say so.' },
      { key: 'page', title: 'Your page', done: !!(m.portrait || (m.bio && m.bio.length > 20)), href: '/account/profile', go: 'Write it', line: 'A portrait and a few lines, in your own words. It is the first thing a collector reads.' },
      { key: 'edit', title: 'Your best in front', done: shown > 0 && graded > 0, href: '/account/table', go: 'Grade and publish', line: 'Grade with stars, then publish only what you would hang. A tight edit outranks a long wall; the rest stays kept.' },
      { key: 'prices', title: 'Your prices', done: had('prices'), href: '/account/prices', go: 'See your prices', line: 'The house has set fair drafts for each use. Look them over and change any; the price is yours.' },
      { key: 'paid', title: 'Your bank', done: !!m.stripe_account, href: '/account/payouts', go: 'Add your bank', line: 'Every dollar that clears goes to your bank on Friday. Add it once; it takes three minutes.' },
      { key: 'shared', title: 'Your page, sent', done: had('shared'), href: '/account', go: 'Copy your page', line: 'Send your page to the people who already follow your work. The first collectors are the ones who know you.' },
      { key: 'album', title: 'An album', done: albums > 0 || alm > 0, href: '/account/deliveries', go: 'Deliver an album', line: 'Deliver photographs to a friend or a client: a present, with your name inside every file, and a way for them to say thank you.' },
    ];
  }
  const where = (m, k = null) => { const a = acts(m, k); const done = a.filter(x => x.done).length; const next = a.find(x => !x.done) || null; const days = m.joined_at ? Math.max(0, Math.floor((Date.now() - new Date(m.joined_at + 'Z').getTime()) / DAY)) : null; return { acts: a, done, total: a.length, next, days }; };
  const line = (m, k = null) => { const w = where(m, k); if (!m.joined_at) return 'Not yet opened'; if (!w.next) return `All ${w.total} done`; return `${w.done} of ${w.total} · at ${w.next.title.toLowerCase()} · ${w.days === 0 ? 'today' : w.days === 1 ? 'a day' : w.days + ' days'}`; };

  // The morning letter: the day's act, one tap. Day n is the nth day after joining; the act is the first undone,
  // so a maker who races ahead is never told to do what they have done.
  function letter(m, day, act) {
    const open = { 1: `Welcome to the house, ${first(m)}.`, 2: `Good morning, ${first(m)}.`, 3: `Day three, ${first(m)}.`, 4: `${first(m)}, a short one.`, 5: `Nearly there, ${first(m)}.`, 6: `${first(m)}, one more thing.`, 7: `The last of the week, ${first(m)}.` }[day] || `Good morning, ${first(m)}.`;
    return { to: m.email, subject: `${act.title}`, feature: null, cta: { label: act.go, url: `${C.base}${act.href}` }, text: `${open}\n\n${act.title}. ${act.line}\n\n${C.base}${act.href}\n\nOne thing a day for a week, then the house leaves you to your work. Reply to this letter and a person answers.\n\nWatermark, a Krafft company.` };
  }
  function mornings({ now = Date.now(), force = false } = {}) {
    const makers = db.prepare("SELECT * FROM makers WHERE kind='maker' AND email IS NOT NULL AND email<>'' AND joined_at IS NOT NULL AND COALESCE(standing,'open')='open' AND joined_at > datetime('now', '-9 days')").all();
    let sent = 0;
    for (const m of makers) {
      if (C.maker && C.maker.handle === m.handle) continue; // the house's own maker
      if (m.email_ok === 0 && !db.prepare('SELECT 1 FROM works WHERE maker_id=? LIMIT 1').get(m.id)) continue; // (12 Nov) an address typed at the door and never proven gets no letters: it may not be theirs
      const day = Math.floor((now - new Date(m.joined_at + 'Z').getTime()) / DAY) + 1; if (day < 1 || day > 7) continue;
      if (db.prepare('SELECT 1 FROM first_week WHERE maker_id=? AND day=?').get(m.id, day)) continue;
      const w = where(m); if (!w.next) { db.prepare("INSERT OR IGNORE INTO first_week (maker_id, day, act) VALUES (?,?,'done')").run(m.id, day); continue; }
      if (!force && day === 1 && now - new Date(m.joined_at + 'Z').getTime() < 20 * 3600000) continue; // the first morning is the morning after, not the hour they joined
      if (mail.autoFull && mail.autoFull()) break; // (#24) past the day's ceiling the morning waits: nothing is marked sent
      db.prepare('INSERT OR IGNORE INTO first_week (maker_id, day, act) VALUES (?,?,?)').run(m.id, day, w.next.key);
      try { mail.send({ ...letter(m, day, w.next), kind: 'auto' }); sent++; } catch (e) { console.error('[firstweek]', e.message); }
    }
    return sent;
  }

  // The first sale of an outside maker: the house told at once.
  function heard(type, subject, d = {}) {
    if (type !== 'license.granted' || !d.paid) return;
    setImmediate(() => { try {
      const w = db.prepare('SELECT w.*, m.name AS maker_name, m.handle, m.email AS maker_email FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.slug=?').get(String(d.work || '')); if (!w) return;
      if (C.maker && C.maker.handle === w.handle) return;
      const paid = n("SELECT COUNT(*) n FROM licenses l JOIN works x ON x.id=l.work_id WHERE x.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0", w.maker_id); if (paid !== 1) return;
      if (db.prepare("SELECT 1 FROM ledger WHERE type='maker.firstsale' AND subject=?").get(w.handle)) return;
      const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(String(subject)) || {};
      ledger.append(db, 'maker.firstsale', w.handle, { work: w.slug, ref: subject, cents: l.price_cents || 0, hidden: true });
      mail.send({ to: require('./address').email(), subject: `${w.maker_name}’s first sale`, text: `${w.maker_name} just sold for the first time on the house: ${w.title}, ${require('./views').money ? require('./views').money(l.price_cents || 0) : ''}.\n\nA word from you today would mean something. ${w.maker_email ? `Their address: ${w.maker_email}` : ''}\n\n${C.base}/m/${w.handle}` });
      const hm = C.maker && C.maker.handle ? db.prepare('SELECT id FROM makers WHERE handle=?').get(C.maker.handle) : null;
      if (hm && app.locals.notify) try { app.locals.notify.tell({ maker_id: hm.id, kind: 'licensed', slug: w.slug, href: `/m/${w.handle}`, title: `${w.maker_name}’s first sale`, body: `${w.title}. Write to them today.` }); } catch (e) { /* */ }
    } catch (e) { console.error('[firstweek]', e.message); } });
  }
  const append = ledger.append; ledger.append = function (db_, type, subject, data) { const r = append.apply(this, arguments); try { heard(type, subject, data || {}); } catch (e) { /* */ } return r; };

  if (!app.locals.noTimers && ROLE.chores) { const t = setInterval(() => { try { mornings(); } catch (e) { console.error('[firstweek]', e.message); } }, 3600000); if (t.unref) t.unref(); setTimeout(() => { try { mornings(); } catch (e) { /* */ } }, 120000).unref(); }
  // (#90, the scale gate) Every maker's line on /studio/accounts: the counts acts() reads, grouped by maker in five
  // questions for each 400 of them (it asked seven a maker: 2,085 statements at 300 makers). The same acts, the same line.
  function lines(makers) {
    const GR = require('./grouped'); const W = new Map(), D = new Map(), T = new Map(), S = new Map();
    // at most one row per maker asked: the makers in chunks of 400, each question's LIMIT the chunk's size
    for (let c = 0; c < makers.length; c += 400) {
      const ids = makers.slice(c, c + 400).map(m => Number(m.id)), f = GR.inList('maker_id', ids), L = ids.length;
      const ask = sql => { try { return db.prepare(sql.replace('{F}', f.sql)).all(...f.args); } catch (e) { return []; } };
      for (const r of ask(`SELECT maker_id id, COUNT(*) n, SUM(CASE WHEN status='held' THEN 1 ELSE 0 END) shown, SUM(CASE WHEN stars > 0 THEN 1 ELSE 0 END) graded FROM works WHERE {F} GROUP BY maker_id LIMIT ${L}`)) W.set(Number(r.id), r);
      for (const r of ask(`SELECT maker_id id, COUNT(*) n FROM deliveries WHERE {F} GROUP BY maker_id LIMIT ${L}`)) D.set(Number(r.id), r);
      for (const r of ask(`SELECT maker_id id, COUNT(*) n FROM texts WHERE {F} AND kind='almanack' GROUP BY maker_id LIMIT ${L}`)) T.set(Number(r.id), r);
      for (const r of ask(`SELECT maker_id id, step FROM maker_steps WHERE {F} AND step IN ('prices','shared') LIMIT ${2 * L}`)) { const id = Number(r.id); if (!S.has(id)) S.set(id, new Set()); S.get(id).add(r.step); }
    }
    const out = new Map();
    for (const m of makers) { const id = Number(m.id), w = W.get(id) || {}; out.set(id, line(m, { works: Number(w.n) || 0, shown: Number(w.shown) || 0, graded: Number(w.graded) || 0, albums: Number((D.get(id) || {}).n) || 0, alm: Number((T.get(id) || {}).n) || 0, steps: S.get(id) || new Set() })); }
    return out;
  }
  app.locals.firstWeek = { acts, where, line, lines, mornings, letter };
  return app.locals.firstWeek;
}
module.exports = { mountFirstWeek };
