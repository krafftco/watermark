// The desk's window (Will, 19 Oct: "a dashboard where I can see into everything … my own site, separate, secret").
// GET /api/desk?key=DESK_KEY answers one JSON summary of the house for the desk at fullerton.cloud (desk/ in this
// repo, its own service). Off unless DESK_KEY is set; never cached; nothing a visitor can reach without the key.
function mountDeskApi(app, { db, C, ledger, stripe }) {
  const KEY = process.env.DESK_KEY || '';
  const money = c => Math.round(c || 0);
  const day = n => new Date(Date.now() - n * 86400000).toISOString();
  const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  function summary() {
    const sales = (since) => db.prepare("SELECT COUNT(*) n, COALESCE(SUM(price_cents),0) c FROM licenses WHERE status IN ('active','expired') AND price_cents > 0 AND starts_at >= ?").get(since);
    const S = { today: sales(day(1)), week: sales(day(7)), month: sales(monthStart()), all: sales('2000-01-01') };
    const makers = db.prepare("SELECT m.name, m.handle, m.kind, (SELECT COUNT(*) FROM works w WHERE w.maker_id=m.id AND w.status='held') held FROM makers m WHERE m.standing IS NULL OR m.standing='open' ORDER BY held DESC").all();
    const needs = {
      requests: db.prepare("SELECT COUNT(*) n FROM licenses WHERE status='requested'").get().n,
      claims: db.prepare("SELECT COUNT(*) n FROM disputes WHERE status='open'").get().n,
      feedback: (() => { try { return db.prepare('SELECT COUNT(*) n FROM feedback WHERE done=0').get().n; } catch (e) { return 0; } })(),
      prints: (() => { try { return db.prepare("SELECT COUNT(*) n FROM print_orders WHERE status IN ('asked','printing')").get().n; } catch (e) { return 0; } })(),
      applications: (() => { try { return db.prepare("SELECT COUNT(*) n FROM applications WHERE status IS NULL OR status='new'").get().n; } catch (e) { return 0; } })(),
      dinnerNames: (() => { try { return db.prepare("SELECT COUNT(*) n FROM night_guests WHERE status='asked'").get().n; } catch (e) { return 0; } })(),
      owed: (() => { try { let t = 0; for (const m of db.prepare('SELECT * FROM makers').all()) { const st = app.locals.payouts ? app.locals.payouts.statement(m) : null; if (st) t += st.owed; } return t; } catch (e) { return 0; } })(),
    };
    const nights = (() => { try { return db.prepare("SELECT slug, title, kind, at, city, capacity, (SELECT COALESCE(SUM(1+plus),0) FROM night_guests g WHERE g.night_id=n.id AND g.status='going') going, (SELECT COUNT(*) FROM night_guests g WHERE g.night_id=n.id AND g.status='asked') asked FROM nights n WHERE status='open' AND at >= datetime('now','-6 hours') ORDER BY at LIMIT 5").all(); } catch (e) { return []; } })();
    const circle = (() => { try { return db.prepare("SELECT COUNT(*) n, COALESCE(SUM(cents),0) c FROM circle WHERE status IN ('active','ending')").get(); } catch (e) { return { n: 0, c: 0 }; } })();
    const friends = (() => { try { return db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount_cents),0) c FROM friends WHERE kind='friend' AND status='active' AND recurring=1").get(); } catch (e) { return { n: 0, c: 0 }; } })();
    const lately = (app.locals.lately ? app.locals.lately(12) : []).map(({ e, line }) => ({ at: e.at, text: String(line.text || '').replace(/<[^>]*>/g, ''), kind: line.kind, slug: line.work && line.work.slug }));
    const recent = db.prepare("SELECT l.ref, l.price_cents, l.starts_at, l.licensee_name, l.licensee_company, w.title, w.slug, u.key AS use_key FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE l.status IN ('active','expired') AND l.price_cents > 0 ORDER BY l.starts_at DESC LIMIT 10").all();
    const stood = (() => { try { return { today: db.prepare("SELECT COUNT(DISTINCT viewer) n FROM stood WHERE at >= ?").get(day(1)).n, week: db.prepare("SELECT COUNT(DISTINCT viewer) n FROM stood WHERE at >= ?").get(day(7)).n }; } catch (e) { return { today: 0, week: 0 }; } })();
    return {
      at: new Date().toISOString(), base: C.base,
      house: { works: db.prepare("SELECT COUNT(*) n FROM works WHERE status='held'").get().n, hidden: db.prepare("SELECT COUNT(*) n FROM works WHERE status='hidden'").get().n, makers: makers.length, collectors: db.prepare("SELECT COUNT(DISTINCT buyer_id) n FROM licenses WHERE buyer_id IS NOT NULL AND collector_no IS NOT NULL AND status IN ('active','expired')").get().n, licenses: db.prepare("SELECT COUNT(*) n FROM licenses WHERE status='active'").get().n, register: db.prepare('SELECT COUNT(*) n FROM ledger').get().n, registerOk: ledger.verify(db).ok, launched: !!(db.prepare("SELECT v FROM settings WHERE k='launched'").get() || {}).v, stripe: stripe ? (/^[sr]k_live_/.test(C.stripeKey || '') ? 'live' : 'test') : 'off', mail: require('./mail').on() },
      sales: { today: S.today, week: S.week, month: S.month, all: S.all, recent: recent.map(r => ({ ...r, price_cents: money(r.price_cents) })) },
      needs, nights, circle, friends, stood, makers: makers.slice(0, 12), lately,
    };
  }
  // The owner's view (Will, 28 Oct: "what would Elon want eyes into"): one object a serious owner reads in a minute and
  // trusts. Every figure is the house's own, computed here, never typed in. The costs come from COSTS_MONTHLY (JSON,
  // dollars by vendor, in Render) so cost per thousand visitors is a line, not a guess.
  function owner() {
    const L = app.locals; const t = f => { try { return f(); } catch (e) { return null; } };
    const A = L.analytics; const r7 = t(() => A.report('7d')), r30 = t(() => A.report('30d')), rt = t(() => A.report('today'));
    const ST = t(() => L.strangers()) || { week: 0, last: 0 }; const BZ = t(() => L.business()) || {};
    const FEE = require('./fee'); const d7 = day(7), d30 = day(30);
    const paid = (since) => db.prepare("SELECT l.*, u.key use_key FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.status IN ('active','expired') AND l.price_cents > 0 AND l.starts_at >= ?").all(since);
    const split = rows => { let total = 0, makers = 0; for (const l of rows) { total += l.price_cents; makers += FEE.makerOf(l, (db.prepare('SELECT share_pct FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.id=?').get(l.work_id) || {}).share_pct || 85); } return { total, makers, house: total - makers, n: rows.length }; };
    const week = split(paid(d7)), month = split(paid(monthStart())), all = split(paid('2000-01-01'));
    const byDay = t(() => db.prepare("SELECT substr(starts_at,1,10) d, COUNT(*) n, COALESCE(SUM(price_cents),0) c FROM licenses WHERE status IN ('active','expired') AND price_cents > 0 AND starts_at >= ? GROUP BY substr(starts_at,1,10) ORDER BY d").all(d30)) || [];
    const friday = t(() => db.prepare("SELECT at, data FROM ledger WHERE type='friday.paid' ORDER BY seq DESC LIMIT 1").get()); let fridayLast = null; if (friday) { try { const d = JSON.parse(friday.data); fridayLast = { at: friday.at, makers: d.makers || 0, amount: d.amount || 0, people: d.people || 0, people_amount: d.people_amount || 0 }; } catch (e) { fridayLast = { at: friday.at }; } }
    const since = (table, col, s) => t(() => db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${col} >= ?`).get(s).n) || 0;
    const growth = {
      works: { n: db.prepare("SELECT COUNT(*) n FROM works WHERE status='held'").get().n, week: since('works', 'created_at', d7) },
      makers: { n: db.prepare("SELECT COUNT(*) n FROM makers WHERE kind IN ('maker','institution','gallery','writer')").get().n, week: since('makers', 'joined_at', d7) },
      collectors: { n: db.prepare("SELECT COUNT(DISTINCT buyer_id) n FROM licenses WHERE buyer_id IS NOT NULL AND price_cents > 0 AND status IN ('active','expired')").get().n, week: r7 ? r7.cur.firstTimers : null },
      visitorsByDay: r30 ? r30.byDay.map(d => ({ d: new Date(d.d * 1000).toISOString().slice(0, 10), visitors: d.visitors, views: d.views })) : [],
      collectsByDay: byDay, comeBack: BZ.again || null, firstSale: BZ.firstSale || null,
      standing: t(() => L.standingOrders && L.standingOrders.summary()) || null,
    };
    const vault = {
      works: growth.works.n, bytes: t(() => db.prepare("SELECT COALESCE(SUM(bytes),0) b FROM works WHERE status IN ('held','hidden','private')").get().b) || 0,
      institutions: t(() => db.prepare("SELECT COUNT(*) n FROM makers WHERE kind='institution'").get().n) || 0,
      books: t(() => db.prepare("SELECT COUNT(*) n FROM texts WHERE status='held' AND public=1").get().n) || 0,
      records: t(() => db.prepare("SELECT COUNT(*) n FROM recordings WHERE status='playing'").get().n) || 0,
      films: t(() => db.prepare("SELECT COUNT(*) n FROM films WHERE status='showing'").get().n) || 0,
      unvaulted: t(() => L.vaultState && L.vaultState().unvaulted) || 0, lost: t(() => (L.vaultState && L.vaultState().lost || []).length) || 0,
    };
    const register = { entries: db.prepare('SELECT COUNT(*) n FROM ledger').get().n, ok: t(() => ledger.verify(db).ok), anchors: t(() => L.anchor && L.anchor.latest()) || null };
    const H = t(() => A.health()) || {};
    const live = { now: rt ? rt.now.people : null, lastHour: rt ? rt.now.lastHour : null, speed: r7 ? r7.speed : null, errors7d: r7 ? r7.cur.errors : null, faults: process.faults || null, up: Math.round(process.uptime()), ver: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 8) || null, role: process.env.ROLE || 'all', worker: t(() => L.workerState && L.workerState()) || null, mem: H.mem || null, backup: H.backup || null, conservation: H.conservation || null, mail: H.mail || null, stripe: H.stripe || null };
    let costs = null; try { const c = JSON.parse(process.env.COSTS_MONTHLY || 'null'); if (c && typeof c === 'object') { const total = Object.values(c).reduce((a, v) => a + Number(v || 0), 0); const v30 = r30 ? r30.cur.visitors : 0; costs = { byVendor: c, monthly: total, per1kVisitors: v30 ? Math.round(100 * total * 1000 / v30) / 100 : null, visitors30d: v30, grossMargin: month.total ? Math.round(100 * (month.house - total * 100) / month.total) : null }; } } catch (e) { costs = null; }
    const releases = t(() => L.releases && L.releases.releases()) || []; const weekAgo = Date.now() - 7 * 864e5;
    const velocity = { version: t(() => L.releases && L.releases.current() && L.releases.current().version) || null, releasesThisWeek: releases.filter(r => r.date && new Date(r.date).getTime() >= weekAgo).length, releases: releases.length };
    return {
      at: new Date().toISOString(), base: C.base,
      theNumber: { strangersThisWeek: ST.week, strangersLastWeek: ST.last },
      people: r7 ? { visitors7d: r7.cur.visitors, visitorsPrior: r7.prev.visitors, views7d: r7.cur.views, stood7d: r7.cur.stood, hats7d: r7.cur.hats, bravos7d: r7.cur.bravos, signins7d: r7.cur.signins, visitors30d: r30 ? r30.cur.visitors : null } : null,
      money: { week, month, all, fridayLast, owed: t(() => { let o = 0; for (const m of db.prepare('SELECT * FROM makers').all()) { const st = L.payouts ? L.payouts.statement(m) : null; if (st) o += st.owed; } return o; }) || 0, feeSide: FEE.on() ? 'collector' : 'maker' },
      live, growth, vault, register, costs, velocity,
    };
  }
  app.get('/api/desk/owner', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!KEY || String(req.query.key || req.get('x-desk-key') || '') !== KEY) return res.status(403).json({ error: 'no' });
    try { res.json(owner()); } catch (e) { console.error('[desk owner]', e.message); res.status(500).json({ error: 'desk' }); }
  });
  app.locals.deskOwner = owner;
  app.get('/api/desk', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!KEY || String(req.query.key || req.get('x-desk-key') || '') !== KEY) return res.status(403).json({ error: 'no' });
    try { res.json(summary()); } catch (e) { console.error('[desk]', e.message); res.status(500).json({ error: 'desk' }); }
  });
  app.locals.deskSummary = summary;
}
module.exports = { mountDeskApi };
