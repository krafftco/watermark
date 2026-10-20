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
  app.get('/api/desk', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!KEY || String(req.query.key || req.get('x-desk-key') || '') !== KEY) return res.status(403).json({ error: 'no' });
    try { res.json(summary()); } catch (e) { console.error('[desk]', e.message); res.status(500).json({ error: 'desk' }); }
  });
  app.locals.deskSummary = summary;
}
module.exports = { mountDeskApi };
