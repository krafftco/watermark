const ROLE = require('./role');
// Getting paid. What a maker is owed: their share of every license sold, every thank-you card and tip sent to
// them, every royalty from a resale, their words and their copies; less what has been paid out. The statement
// is always exact and always theirs to see. Paying it: the maker adds a bank through Stripe (Connect Express;
// the house never sees the account), and once PAYOUTS=stripe is set in the host's settings the house keeps
// Friday pay (Will, 25 Oct: "the best, and the one people will celebrate, but makes sense as well"; after
// Southwest's bags-fly-free: one plain promise, named, kept): every Friday, every dollar that has cleared goes
// to the maker's bank, from a dollar up, no fee, no minimum to wait for. A sale clears HOLD_DAYS (7) after it is
// paid, the window in which almost every refund or dispute lands, so the house never pays out money it then
// returns; a print's share clears when the print is delivered, since the house carries the printing. 'Send it
// now' pays the cleared amount any day. Until Stripe pays, the house pays by hand from the same statement.
const { layout, esc, money, date, setDeskPath } = require('./views');

const FEE = require('./fee');
function mountPayouts(app, { db, C, stripe, makerOf, isStudio, ledger, mail }) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('makers') WHERE name='stripe_account'").get()) db.exec('ALTER TABLE makers ADD COLUMN stripe_account TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS maker_payouts (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'paid', how TEXT NOT NULL DEFAULT 'stripe',
    stripe_transfer TEXT, note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const ON = () => !!stripe && process.env.PAYOUTS === 'stripe';
  const HOLD_DAYS = Math.max(0, Number(process.env.PAYOUT_HOLD_DAYS || 7));
  const PAY_TZ = process.env.PAYOUT_TZ || 'America/New_York';
  const nyDay = (d = new Date()) => new Intl.DateTimeFormat('en-US', { timeZone: PAY_TZ, weekday: 'short' }).format(d);
  const nyHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: PAY_TZ, hour: 'numeric', hour12: false }).format(d));
  // The next Friday, as a person says it ('this Friday', 'Friday the 31st').
  function nextFriday(d = new Date()) { const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; const i = names.indexOf(nyDay(d)); let add = (5 - i + 7) % 7; if (add === 0 && nyHour(d) >= 12) add = 7; const f = new Date(d.getTime() + add * 864e5); return new Intl.DateTimeFormat('en-US', { timeZone: PAY_TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(f); }
  const q = {
    licensed: { get: (id, pct) => db.prepare(`SELECT COALESCE(SUM(l.price_cents),0) s, COALESCE(SUM(${FEE.sqlMaker(pct)}),0) m, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0`).get(id) },
    thanks: db.prepare("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM tips WHERE maker_id=? AND status='paid'"),
    royalties: db.prepare("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM payouts WHERE maker_id=? AND kind='royalty' AND status IN ('owed','paid','house')"),
    paid: db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM maker_payouts WHERE maker_id=? AND status='paid'"),
    rows: db.prepare('SELECT * FROM maker_payouts WHERE maker_id=? ORDER BY id DESC LIMIT 60'),
    // The printing house (24 Oct): words sold from the Library (the maker's price, the house's share having ridden on top; else the share) and copies sold from the shelf (the seller's price, whole).
    words: (id, pct) => { try { return db.prepare(`SELECT COALESCE(SUM(o.price_cents),0) s, COALESCE(SUM(CASE WHEN ${FEE.on() ? '1' : '0'}=1 THEN t.price_cents ELSE CAST(o.price_cents * ? / 100.0 AS INTEGER) END),0) m, COUNT(*) n FROM text_orders o JOIN texts t ON t.id=o.text_id WHERE t.maker_id=? AND o.status='paid' AND o.price_cents>0`).get(pct, id); } catch (e) { return { s: 0, m: 0, n: 0 }; } },
    copies: id => { try { return db.prepare("SELECT COALESCE(SUM(c.price_cents),0) s, COUNT(*) n FROM copy_orders o JOIN copies c ON c.id=o.copy_id WHERE c.seller_kind='maker' AND c.seller_id=? AND o.paid=1").get(id); } catch (e) { return { s: 0, n: 0 }; } },
    // What has not cleared yet: the maker's side of sales inside the hold, and of prints not yet delivered.
    clearing: (id, pct) => {
      const since = `-${HOLD_DAYS} days`; let s = 0, n = 0;
      const add = r => { if (r) { s += r.s || 0; n += r.n || 0; } };
      try { add(db.prepare(`SELECT COALESCE(SUM(${FEE.sqlMaker(pct)}),0) s, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0 AND u.key<>'print' AND l.created_at > datetime('now', ?)`).get(id, since)); } catch (e) { /* */ }
      try { add(db.prepare(`SELECT COALESCE(SUM(${FEE.sqlMaker(pct)}),0) s, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0 AND u.key='print' AND NOT EXISTS (SELECT 1 FROM print_orders o WHERE o.license_id=l.id AND o.status IN ('sent','done','delivered'))`).get(id)); } catch (e) { /* */ }
      try { add(db.prepare("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM tips WHERE maker_id=? AND status='paid' AND COALESCE(paid_at, created_at) > datetime('now', ?)").get(id, since)); } catch (e) { /* */ }
      try { add(db.prepare("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM payouts WHERE maker_id=? AND kind='royalty' AND status IN ('owed','paid','house') AND created_at > datetime('now', ?)").get(id, since)); } catch (e) { /* */ }
      try { add(db.prepare(`SELECT COALESCE(SUM(CASE WHEN ${FEE.on() ? '1' : '0'}=1 THEN t.price_cents ELSE CAST(o.price_cents * ? / 100.0 AS INTEGER) END),0) s, COUNT(*) n FROM text_orders o JOIN texts t ON t.id=o.text_id WHERE t.maker_id=? AND o.status='paid' AND o.price_cents>0 AND COALESCE(o.paid_at, o.created_at) > datetime('now', ?)`).get(pct, id, since)); } catch (e) { /* */ }
      try { add(db.prepare("SELECT COALESCE(SUM(c.price_cents),0) s, COUNT(*) n FROM copy_orders o JOIN copies c ON c.id=o.copy_id WHERE c.seller_kind='maker' AND c.seller_id=? AND o.paid=1 AND COALESCE(o.paid_at, o.created_at) > datetime('now', ?)").get(id, since)); } catch (e) { /* */ }
      try { if (app.locals.printShops) add(app.locals.printShops.clearing(id, since)); } catch (e) { /* */ }
      try { if (app.locals.briefs) add(app.locals.briefs.clearing(id, since)); } catch (e) { /* */ }
      return { s, n };
    },
  };
  // The statement: gross by kind, the maker's share, what has gone out, what is owed.
  function statement(m) {
    const pct = m.share_pct || 85;
    const L = q.licensed.get(m.id, pct), T = q.thanks.get(m.id), R = q.royalties.get(m.id), P = q.paid.get(m.id).s;
    const share = L.m;
    const G = app.locals.galleries ? { out: app.locals.galleries.cutsOut(m), in: app.locals.galleries.cutsIn(m) } : { out: { s: 0, n: 0 }, in: { s: 0, n: 0 } };
    const S = app.locals.splits ? app.locals.splits.owedOut(m) : { s: 0, n: 0, by: {} };
    const W = q.words(m.id, pct), Cp = q.copies(m.id);
    const Pr = app.locals.printShops ? app.locals.printShops.earned(m.id) : { s: 0, n: 0 }; // the press (26 Oct): prints made for the house
    const Bf = app.locals.briefs ? app.locals.briefs.earned(m.id) : { s: 0, n: 0 }; // commissions (29 Oct): briefs approved
    const earned = share + T.s + R.s + W.m + Cp.s + Pr.s + Bf.s - G.out.s + G.in.s - S.s;
    const owed = Math.max(0, earned - P);
    const Cl = q.clearing(m.id, pct); const clearing = Math.min(owed, Math.max(0, Cl.s)); const cleared = owed - clearing;
    return { pct, licensed: L, share, thanks: T, royalties: R, words: W, copies: Cp, printing: Pr, commissions: Bf, gallery: G, splits: S, earned, paid: P, owed, clearing, clearingN: Cl.n, cleared, holdDays: HOLD_DAYS, friday: nextFriday(), rows: q.rows.all(m.id) };
  }
  // Pay what has cleared, when the maker can be paid and the house is set to pay. From a dollar up.
  async function pay(m, { by = 'house' } = {}) {
    const st = statement(m); const amt = st.cleared;
    if (!ON() || !m.stripe_account || amt < 100) return { ok: false, why: !ON() ? 'off' : !m.stripe_account ? 'nobank' : st.owed >= 100 ? 'clearing' : 'small', owed: st.owed, cleared: amt };
    try {
      const a = await stripe.accounts.retrieve(m.stripe_account); if (!a.payouts_enabled) return { ok: false, why: 'notready', owed: st.owed };
      const tr = await stripe.transfers.create({ amount: amt, currency: 'usd', destination: m.stripe_account, metadata: { maker: m.handle, by } });
      const id = db.prepare("INSERT INTO maker_payouts (maker_id, amount_cents, status, how, stripe_transfer, note) VALUES (?,?,'paid','stripe',?,?)").run(m.id, amt, tr.id, by === 'friday' ? 'Friday pay' : null).lastInsertRowid;
      ledger.append(db, 'maker.paid', m.handle, { amount: amt, transfer: tr.id, by });
      if (m.email) mail.send({ to: m.email, subject: by === 'friday' ? `Friday pay: ${money(amt)} is on its way` : `${money(amt)} on its way to you`, text: `${m.name.split(' ')[0]},\n\n${money(amt)} has been sent to your bank through Stripe${by === 'friday' ? ': every Friday, every dollar that has cleared' : ''}. The statement is at ${C.base}/account/payouts.\n\nThank you for making work worth keeping.\n\nWatermark` });
      return { ok: true, amount: amt, id };
    } catch (e) { console.error('[payouts]', m.handle, e.message); return { ok: false, why: 'failed', owed: st.owed }; }
  }
  // Paid by hand (the Studio records it): the statement stays exact either way.
  function record(m, cents, note) {
    db.prepare("INSERT INTO maker_payouts (maker_id, amount_cents, status, how, note) VALUES (?,?,'paid','hand',?)").run(m.id, cents, note || null);
    ledger.append(db, 'maker.paid', m.handle, { amount: cents, by: 'hand' });
  }

  app.get('/account/payouts', async (req, res) => {
    const m = makerOf(req) || (req.query.maker && isStudio(req) ? db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.query.maker)) : null); if (!m) return res.redirect('/signin?next=/account/payouts');
    let ready = false; if (m.stripe_account && stripe) { try { const a = await stripe.accounts.retrieve(m.stripe_account); ready = !!a.payouts_enabled; } catch (e) { /* not ready */ } }
    res.send(payoutsPage({ m, st: statement(m), ready, on: ON(), ok: req.query.ok || null, viewing: !makerOf(req), why: connectState.byMaker.get(m.id) || null }));
  });
  // What Stripe said the last time a bank could not be added (18 Oct: the reason was hidden behind 'could not be
  // reached'). Shown to the maker on the page and to the house on /healthz; never a key or a bank detail.
  const connectState = { last: null, byMaker: new Map() };
  app.locals.connectState = () => connectState.last;
  app.post('/account/payouts/connect', async (req, res) => {
    const m = makerOf(req); if (!m || !stripe) return res.redirect('/account/payouts?ok=off');
    try {
      let acct = m.stripe_account;
      if (!acct) { const a = await stripe.accounts.create({ type: 'express', email: m.email || undefined, capabilities: { transfers: { requested: true } }, business_profile: { name: m.name, product_description: 'Photographs licensed through Watermark' }, metadata: { maker: m.handle } }); acct = a.id; db.prepare('UPDATE makers SET stripe_account=? WHERE id=?').run(acct, m.id); }
      const link = await stripe.accountLinks.create({ account: acct, type: 'account_onboarding', refresh_url: `${C.base}/account/payouts`, return_url: `${C.base}/account/payouts?ok=bank` });
      res.redirect(303, link.url);
    } catch (e) { console.error('[connect]', e.message); connectState.last = { at: new Date().toISOString(), error: String(e.message).slice(0, 300), code: e.code || null }; connectState.byMaker.set(m.id, connectState.last.error); res.redirect('/account/payouts?ok=connect'); }
  });
  // Keep the money in the house: what is owed goes into the maker's pocket instead of to a bank, to collect
  // other makers' work, take Library copies, send cards. Recorded as paid, how 'pocket'.
  app.post('/account/payouts/pocket', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const st = statement(m); if (st.owed < 100) return res.redirect('/account/payouts?ok=small');
    const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null; if (!b || !app.locals.pocket) return res.redirect('/account/payouts?ok=err');
    db.prepare("INSERT INTO pocket (buyer_id, cents, kind, note) VALUES (?,?,'earnings',?)").run(b.id, st.owed, 'Your earnings, kept in the house');
    db.prepare("INSERT INTO maker_payouts (maker_id, amount_cents, status, how, note) VALUES (?,?,'paid','pocket','Into your pocket')").run(m.id, st.owed);
    ledger.append(db, 'maker.paid', m.handle, { amount: st.owed, by: 'pocket' });
    res.redirect(`/account/payouts?ok=pocket&n=${st.owed}`);
  });
  app.post('/account/payouts/pay', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const r = await pay(m, { by: 'maker' });
    res.redirect(`/account/payouts?ok=${r.ok ? 'paid' : r.why}`);
  });
  // What the house owes its makers, one screen (30 Oct: the house desk's 'Pay the makers' had led nowhere). Every maker
  // owed money: what has cleared, what is still inside the week's hold, whether a bank is connected; Send it now (a
  // Connect transfer of what has cleared) or record a payment made by hand.
  app.get('/studio/payouts', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const V = require('./views'); const esc = V.esc;
    const rows = db.prepare("SELECT * FROM makers WHERE COALESCE(kind,'maker')<>'institution' ORDER BY name").all().map(m => ({ m, st: statement(m) })).filter(x => x.st.owed > 0 || x.st.paid > 0).sort((a, b) => b.st.owed - a.st.owed);
    const owed = rows.reduce((n, x) => n + x.st.owed, 0), cleared = rows.reduce((n, x) => n + x.st.cleared, 0);
    const why = { off: 'Payouts are not switched on (PAYOUTS=stripe)', nobank: 'No bank connected yet', clearing: 'Still inside the hold', small: 'Under a dollar', notready: 'Stripe has not finished the account' };
    const ok = req.query.ok ? `<p class="ok">${esc(String(req.query.ok))}</p>` : '';
    res.set('Cache-Control', 'private, no-store').send(V.layout({ title: 'Pay the makers · Watermark', studio: true, path: '/studio/payouts', body: `<section class="wrap"><p class="k">Money</p><h1>Pay the makers.</h1>
<p class="lede">${money(owed)} owed in all; ${money(cleared)} has cleared and can go now. Friday pay sends what has cleared to every connected bank on ${esc(nextFriday())}${ON() ? '' : ' (payouts are not switched on: pay by hand and record it here)'}.</p>${ok}
<table class="tbl"><thead><tr><th>Maker</th><th>Owed</th><th>Cleared</th><th>Clearing</th><th>Paid in all</th><th>Bank</th><th></th></tr></thead><tbody>${rows.map(({ m, st }) => `<tr><td><a href="/account?maker=${esc(m.handle)}">${esc(m.name)}</a></td><td>${money(st.owed)}</td><td>${money(st.cleared)}</td><td>${money(st.clearing)}</td><td>${money(st.paid)}</td><td>${m.stripe_account ? 'Connected' : 'None yet'}</td><td>${st.cleared >= 100 && m.stripe_account && ON() ? `<form method="post" action="/studio/payouts/${esc(m.handle)}/send"><button>Send ${money(st.cleared)} now</button></form>` : ''}<form method="post" action="/studio/payouts/${esc(m.handle)}" class="inline"><input name="amount" inputmode="decimal" placeholder="$ paid by hand" size="10" aria-label="Amount paid by hand"><input name="note" placeholder="How (cheque, Zelle…)" size="14" aria-label="How"><button>Record</button></form></td></tr>`).join('') || '<tr><td colspan="7">Nothing owed. Every maker is paid.</td></tr>'}</tbody></table>
<p class="note">${Object.entries(why).map(([k, v]) => `<b>${k}</b>: ${v}`).join(' · ')}</p></section>` }));
  });
  app.post('/studio/payouts/:handle/send', async (req, res) => {
    if (!isStudio(req)) return res.sendStatus(401);
    const m = db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.params.handle)); if (!m) return res.sendStatus(404);
    const r = await pay(m, { by: 'house' });
    res.redirect(`/studio/payouts?ok=${encodeURIComponent(r.ok ? `${money(r.amount)} sent to ${m.name}.` : `Not sent: ${r.why}.`)}`);
  });
  // The Studio records a payment made by hand.
  app.post('/studio/payouts/:handle', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(401);
    const m = db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.params.handle)); if (!m) return res.sendStatus(404);
    const cents = Math.round(Number((req.body || {}).amount) * 100); if (!(cents > 0)) return res.redirect('/studio/payouts');
    record(m, cents, String((req.body || {}).note || '').slice(0, 200));
    res.redirect(`/studio/payouts?ok=${encodeURIComponent(`${money(cents)} recorded as paid to ${m.name}.`)}`);
  });
  // Friday pay (every Friday from ten in the morning, New York, once), and when a bank is added.
  const prev = app.locals.patronEvent;
  // The bank connected, said by letter once (27 Oct, SECURITY.md): a change to where the money goes is always written to the maker.
  function bankTold(m, acct) {
    try {
      db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)'); const k = `bank_told_${m.id}_${acct.id}`; if (db.prepare('SELECT 1 FROM settings WHERE k=?').get(k)) return;
      db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, new Date().toISOString());
      const ext = acct.external_accounts && acct.external_accounts.data && acct.external_accounts.data[0]; const where = ext ? `${ext.bank_name || 'a bank'}${ext.last4 ? `, account ending ${ext.last4}` : ''}` : 'your bank';
      if (m.email && mail.on()) mail.send({ to: m.email, subject: 'Your bank is connected to Watermark', cta: { label: 'Getting paid', url: `${C.base}/account/payouts` }, text: `${m.name.split(' ')[0]},\n\nYour bank is connected: from now on Friday pay goes to ${where}.\n\nIf you did not do this, open Your devices and press Sign out everywhere, then write to the house at ${process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com'}.\n\n${C.base}/yours/devices\n\nWatermark, a Krafft company` }).catch(() => {});
    } catch (e) { console.error('[payouts] bank letter', e.message); }
  }
  app.locals.patronEvent = event => { if (prev) prev(event); if (event.type === 'account.updated' && event.data.object.payouts_enabled) { const m = db.prepare('SELECT * FROM makers WHERE stripe_account=?').get(event.data.object.id); if (m) { bankTold(m, event.data.object); pay(m, { by: 'bank' }).catch(() => {}); } } };
  db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)');
  const weekKey = () => { const d = new Date(); const day = new Intl.DateTimeFormat('en-CA', { timeZone: PAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); return `friday_pay_${day}`; };
  async function friday({ force = false } = {}) {
    if (!ON()) return { ok: false, why: 'off' };
    if (!force && (nyDay() !== 'Fri' || nyHour() < 10)) return { ok: false, why: 'notfriday' };
    const key = weekKey(); if (!force && db.prepare('SELECT 1 FROM settings WHERE k=?').get(key)) return { ok: false, why: 'done' };
    db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, new Date().toISOString());
    let n = 0, cents = 0;
    for (const m of db.prepare('SELECT * FROM makers WHERE stripe_account IS NOT NULL').all()) { const r = await pay(m, { by: 'friday' }); if (r.ok) { n++; cents += r.amount; } }
    // And everyone else who works for the house: curators, guides, hosts, from their pockets.
    let people = 0, pcents = 0; try { if (app.locals.pocket && app.locals.pocket.friday) { const r = await app.locals.pocket.friday(); people = r.n; pcents = r.cents; } } catch (e) { console.error('[friday pocket]', e.message); }
    if (n || people) ledger.append(db, 'friday.paid', 'house', { makers: n, amount: cents, people, people_amount: pcents });
    return { ok: true, makers: n, amount: cents, people, people_amount: pcents };
  }
  // The Friday letter, nine in the morning New York, before the pay: the maker's week. `letterFor(m)` builds it;
  // `fridayLetters()` sends one to every maker with an email who sold something, was paid, or asked (makers.friday_letter, on by default).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('makers') WHERE name='friday_letter'").get()) db.exec('ALTER TABLE makers ADD COLUMN friday_letter INTEGER NOT NULL DEFAULT 1');
  function letterFor(m) {
    const st = statement(m); const pct = st.pct;
    const sales = db.prepare(`SELECT l.id, l.price_cents, l.house_cents, l.created_at, w.title, w.slug, substr(w.taken_at,1,4) AS year, l.collector_no, u.name AS label, u.key FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0 AND l.created_at > datetime('now','-7 days') ORDER BY l.id DESC`).all(m.id);
    const how = r => (r.key === 'social' ? 'collected' : r.key === 'reference' ? 'the Reference' : r.key === 'print' ? 'a print' : `licensed: ${r.label || r.key}`);
    const mk = r => (FEE.on() && r.house_cents != null ? r.price_cents - r.house_cents : Math.round(r.price_cents * pct / 100));
    let stood = 0; try { stood = db.prepare("SELECT COUNT(*) n FROM stood s JOIN works w ON w.id=s.work_id WHERE w.maker_id=? AND s.at > datetime('now','-7 days')").get(m.id).n; } catch (e) { /* */ }
    const top = sales[0]; const date = new Intl.DateTimeFormat('en-US', { timeZone: PAY_TZ, month: 'long', day: 'numeric' }).format(new Date());
    return { base: C.base, money, date, on: ON(), maker: m.name, cleared: st.cleared, clearing: st.clearing, earned: st.earned, sold: sales.length, stood,
      sales: sales.map(r => ({ title: r.title, how: how(r), cents: mk(r) })),
      img: top ? `${C.base}/img/${encodeURIComponent(top.slug)}/screen?f=jpg` : null, workUrl: top ? `${C.base}/w/${encodeURIComponent(top.slug)}` : null, title: top ? top.title : '', year: top ? top.year : '', no: top ? top.collector_no : null,
      statementUrl: `${C.base}/account/payouts` };
  }
  async function fridayLetters({ force = false } = {}) {
    if (!force && (nyDay() !== 'Fri' || nyHour() < 9)) return { ok: false, why: 'notfriday' };
    const key = `friday_letter_${weekKey().slice(11)}`; if (!force && db.prepare('SELECT 1 FROM settings WHERE k=?').get(key)) return { ok: false, why: 'done' };
    db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, new Date().toISOString());
    let n = 0;
    for (const m of db.prepare("SELECT * FROM makers WHERE email IS NOT NULL AND email<>'' AND COALESCE(friday_letter,1)=1").all()) {
      const c = letterFor(m); if (!c.sold && !c.cleared && !c.stood) continue;
      try { const L = require('./mail-letters').friday(c); await mail.send({ to: m.email, subject: L.subject, text: L.text, html: L.html }); n++; } catch (e) { console.error('[friday letter]', m.handle, e.message); }
    }
    return { ok: true, sent: n };
  }
  app.locals.fridayLetterFor = letterFor;
  if (process.env.NODE_ENV !== 'test' && ROLE.chores) { setInterval(() => friday().catch(() => {}), 30 * 60 * 1000).unref(); setInterval(() => fridayLetters().catch(() => {}), 30 * 60 * 1000).unref(); }
  app.locals.payouts = { statement, pay, record, ON, friday, fridayLetters, letterFor, HOLD_DAYS, nextFriday };
  return app.locals.payouts;
}

function payoutsPage({ m, st, ready, on, ok, viewing = false, why = null }) {
  setDeskPath('/account/payouts');
  const first = m.name.split(' ')[0];
  const notice = { pocket: 'Into your pocket. Spend it in the house: collect the artists you admire, take a volume from the Library, send a card.', bank: `Your bank is with Stripe. Friday pay begins: every Friday, every dollar that has cleared, from a dollar up.`, paid: 'Sent. It is on its way to your bank.', off: 'Payouts through Stripe are not switched on for the house yet; what you are owed is paid by hand each week, from this statement.', nobank: 'Add your bank first.', small: 'Under a dollar is carried to next Friday.', clearing: `Nothing has cleared yet: a sale clears ${st.holdDays} days after it is paid. It goes out on ${st.friday}.`, notready: 'Stripe has not finished with your bank details yet.', failed: 'The transfer could not be made; the house has been told.', err: 'Stripe could not be reached. Try again in a moment.', connect: `Stripe would not open the bank form yet${why ? `. Stripe said: “${why}”` : ''}. The house has been told.` }[ok];
  const row = (k, v, small) => `<div><dt>${k}</dt><dd>${v}${small ? `<small>${small}</small>` : ''}</dd></div>`;
  return layout({ title: 'Getting paid · Watermark', studio: true, body: `<section class="studio-wrap hd gp">${viewing ? `<p class="ac-viewing">You are the Studio, looking at ${esc(m.name)}'s statement. <a href="/studio/accounts">Back to Accounts</a></p>` : ''}<p class="k">${viewing ? esc(m.name) : 'Your studio'}</p><h1>Getting paid.</h1>
<p class="lede">Every dollar that reaches you, and where it came from. ${FEE.on() ? 'The price of every license is yours, every dollar of it; the house’s share is paid by the collector on top' : st.pct + '% of every license is yours'}; every thank-you card and tip is yours whole; every resale pays you a royalty. The house keeps the rest and pays for everything with it.</p>
${notice ? `<p class="${/paid|bank/.test(ok) ? 'ok' : 'note'}">${esc(notice)}</p>` : ''}
<div class="gp-cols"><div class="gp-main">
<div class="gp-big"><span>Owed to you now</span><b>${money(st.owed)}</b>${st.clearing > 0 ? `<i class="gp-clear">${money(st.cleared)} cleared, out on ${esc(st.friday)} &middot; ${money(st.clearing)} clearing (${st.clearingN} sale${st.clearingN === 1 ? '' : 's'} inside ${st.holdDays} days)</i>` : st.owed > 0 ? `<i class="gp-clear">All cleared. Out on ${esc(st.friday)}.</i>` : ''}</div>
<p class="gp-friday"><b>Friday pay.</b> Every Friday, every dollar that has cleared goes to your bank, from a dollar up, with no fee and nothing held back. A sale clears ${st.holdDays} days after it is paid (the week in which almost every refund lands); a print clears when it is delivered. Ask any day and the cleared amount goes at once.</p>
<dl class="facts gp-st">
${row('Licensed', money(st.licensed.s), `${st.licensed.n} sale${st.licensed.n === 1 ? '' : 's'}; your ${st.pct}% is ${money(st.share)}`)}
${row('Thank-you cards and tips', money(st.thanks.s), `${st.thanks.n}, yours whole`)}
${row('Royalties', money(st.royalties.s), `${st.royalties.n} resale${st.royalties.n === 1 ? '' : 's'}`)}
${st.words && st.words.n ? row('Writing sold', money(st.words.m), `${st.words.n} cop${st.words.n === 1 ? 'y' : 'ies'} from the Library${FEE.on() ? ', your price whole' : ''}`) : ''}
${st.copies && st.copies.n ? row('Copies from your shelf', money(st.copies.s), `${st.copies.n} shipped, yours whole`) : ''}
${st.printing && st.printing.n ? row('Prints made for the house', money(st.printing.s), `${st.printing.n} delivered`) : ''}
${st.commissions && st.commissions.n ? row('Commissions', money(st.commissions.s), `${st.commissions.n} approved`) : ''}
${st.splits && st.splits.n ? row('To your collaborators', '&minus;' + money(st.splits.s), Object.keys(st.splits.by).map(k => `${k} ${money(st.splits.by[k])}`).join(' · ')) : ''}
${st.gallery && st.gallery.out.n ? row('To your gallery', '&minus;' + money(st.gallery.out.s), `${st.gallery.out.n} sale${st.gallery.out.n === 1 ? '' : 's'}, their agreed share of your side`) : ''}
${st.gallery && st.gallery.in.n ? row('Representation', money(st.gallery.in.s), `${st.gallery.in.n} sale${st.gallery.in.n === 1 ? '' : 's'} of your artists' work`) : ''}
${row('Earned, all time', money(st.earned))}
${row('Paid out', money(st.paid))}
</dl>
${st.rows.length ? `<h2>Payments to you</h2><table class="tbl"><thead><tr><th>Date</th><th>Amount</th><th>How</th><th>Note</th></tr></thead><tbody>${st.rows.map(r => `<tr><td>${date(r.at)}</td><td>${money(r.amount_cents)}</td><td>${r.how === 'stripe' ? 'To your bank' : 'By hand'}</td><td>${esc(r.note || r.stripe_transfer || '')}</td></tr>`).join('')}</tbody></table>` : ''}
<p class="note gp-foot">${first}, this statement is yours to keep and to show an accountant: every line on it is on the register. <a href="/account/keeping">Keeping: what the archive holds, and the tiers.</a></p>
</div><aside class="gp-side">
<section class="gp-door"><p class="k">Keep it in the house</p><h2>Into your pocket.</h2><p>Every maker is a collector. Put what you are owed in your pocket and spend it here: on other makers' work, on the Library, on thank-you cards. Rembrandt collected; so can you.</p><form method="post" action="/account/payouts/pocket"><button class="jewel gp-pay" ${st.owed < 100 ? 'disabled' : ''}>Put ${money(st.owed)} in my pocket</button></form></section>
<section class="gp-door"><p class="k">Your bank</p><h2>${ready ? 'Connected.' : 'Out, to your bank.'}</h2>${ready ? `<p>Your bank is with Stripe; the house never sees it. ${on ? `Friday pay goes every Friday; ${money(st.cleared)} has cleared now.` : 'Payouts through Stripe open soon; until then the house pays by hand from this statement.'}</p>${on ? `<form method="post" action="/account/payouts/pay"><button class="jewel gp-pay" ${st.cleared < 100 ? 'disabled' : ''}>Send ${money(st.cleared)} to my bank now</button></form>` : ''}`
  : `<p>Add your bank through Stripe, a few minutes; the house never sees your details. ${on ? 'From then on, Friday pay: every Friday, every dollar that has cleared, or sooner when you ask.' : 'Until payouts through Stripe are switched on, the house pays by hand each week from this statement.'}</p><form method="post" action="/account/payouts/connect"><button class="jewel gp-pay">${m.stripe_account ? 'Finish adding your bank' : 'Add your bank, through Stripe'}</button></form>`}</section>
</aside></div>
</section>` });
}

module.exports = { mountPayouts, payoutsPage };
