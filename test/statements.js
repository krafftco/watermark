// The makers' statements, asked for many makers at once (#85, the scale gate). /studio and /studio/payouts asked ~24
// questions per maker (7,300 on the Studio's front page at 300 makers); now each sum is one question grouped by maker
// (payouts.statements). Money: this holds the grouped path to the per-maker questions it replaced (kept below verbatim
// as REF), maker by maker, field by field, on every kind of money the statement adds (licences with and without the
// house's part, each maker's own share, prints delivered and not, tips, royalties, payouts, words, copies, a gallery's
// cut both ways, collaborators' splits, sitters, the press, briefs, the Gazette), inside the hold and out of it; with the
// house's share on the maker's side, then again on the collector's (FEE_SIDE=collector, a second process).
//   NODE_ENV=test node test/statements.js
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { spawnSync } = require('child_process');
const { createApp } = require('../src/app');
const FEE = require('../src/fee');

// The per-maker statement as it stood before #85 (payouts.js, 16 Nov), its questions copied as they were.
function REF(app, db, m) {
  const HOLD_DAYS = Math.max(0, Number(process.env.PAYOUT_HOLD_DAYS || 7));
  const q = {
    licensed: { get: (id, pct) => db.prepare(`SELECT COALESCE(SUM(l.price_cents),0) s, COALESCE(SUM(${FEE.sqlMaker(pct)}),0) m, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0`).get(id) },
    thanks: db.prepare("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM tips WHERE maker_id=? AND status='paid'"),
    royalties: db.prepare("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM payouts WHERE maker_id=? AND kind='royalty' AND status IN ('owed','paid','house')"),
    paid: db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM maker_payouts WHERE maker_id=? AND status='paid'"),
    words: (id, pct) => { try { return db.prepare(`SELECT COALESCE(SUM(o.price_cents),0) s, COALESCE(SUM(CASE WHEN ${FEE.on() ? '1' : '0'}=1 THEN t.price_cents ELSE CAST(o.price_cents * ? / 100.0 AS INTEGER) END),0) m, COUNT(*) n FROM text_orders o JOIN texts t ON t.id=o.text_id WHERE t.maker_id=? AND o.status='paid' AND o.price_cents>0`).get(pct, id); } catch (e) { return { s: 0, m: 0, n: 0 }; } },
    copies: id => { try { return db.prepare("SELECT COALESCE(SUM(c.price_cents),0) s, COUNT(*) n FROM copy_orders o JOIN copies c ON c.id=o.copy_id WHERE c.seller_kind='maker' AND c.seller_id=? AND o.paid=1").get(id); } catch (e) { return { s: 0, n: 0 }; } },
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
      try { if (app.locals.gazette) add(app.locals.gazette.clearing(id, since)); } catch (e) { /* */ }
      return { s, n };
    },
  };
  const pct = m.share_pct || 85;
  const L = q.licensed.get(m.id, pct), T = q.thanks.get(m.id), R = q.royalties.get(m.id), P = q.paid.get(m.id).s;
  const share = L.m;
  const G = app.locals.galleries ? { out: app.locals.galleries.cutsOut(m), in: app.locals.galleries.cutsIn(m) } : { out: { s: 0, n: 0 }, in: { s: 0, n: 0 } };
  const S = app.locals.splits ? app.locals.splits.owedOut(m) : { s: 0, n: 0, by: {} };
  const Si = app.locals.sitters ? app.locals.sitters.owedOut(m) : { s: 0, n: 0, by: {} };
  const W = q.words(m.id, pct), Cp = q.copies(m.id);
  const Pr = app.locals.printShops ? app.locals.printShops.earned(m.id) : { s: 0, n: 0 };
  const Bf = app.locals.briefs ? app.locals.briefs.earned(m.id) : { s: 0, n: 0 };
  const Gz = app.locals.gazette ? app.locals.gazette.earned(m.id) : { s: 0, n: 0 };
  const earned = share + T.s + R.s + W.m + Cp.s + Pr.s + Bf.s + Gz.s - G.out.s + G.in.s - S.s - Si.s;
  const owed = Math.max(0, earned - P);
  const Cl = q.clearing(m.id, pct); const clearing = Math.min(owed, Math.max(0, Cl.s)); const cleared = owed - clearing;
  return { pct, licensed: L, share, thanks: T, royalties: R, words: W, copies: Cp, printing: Pr, commissions: Bf, gazette: Gz, gallery: G, splits: S, sitters: Si, earned, paid: P, owed, clearing, clearingN: Cl.n, cleared };
}
const plain = o => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== 'rows' && kk !== 'friday' && kk !== 'holdDays').sort()) : v)));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-stm-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'stm', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  // A row into any table: the columns given, and something for every other column that must have one.
  let k = 0;
  const ins = (t, o) => {
    const cols = db.prepare(`SELECT name, type, "notnull" nn, dflt_value d, pk FROM pragma_table_info('${t}')`).all();
    const v = { ...o };
    for (const c of cols) if (c.nn && c.d == null && !c.pk && !(c.name in v)) v[c.name] = /INT|REAL|NUM/i.test(c.type) ? 1 : `${t}-${c.name}-${++k}`;
    const ks = Object.keys(v);
    return Number(db.prepare(`INSERT INTO ${t} (${ks.join(', ')}) VALUES (${ks.map(() => '?').join(', ')})`).run(...ks.map(x => v[x])).lastInsertRowid);
  };
  const house = app.locals.maker.id;
  // The makers: each share the statement can meet (the default, 0, 70, 90), a gallery, a maker with nothing at all.
  const mk = (h, pct, kind = 'maker') => ins('makers', { handle: h, name: h, email: h + '@example.com', kind, ...(pct == null ? {} : { share_pct: pct }) }); // share_pct: the column's default, or 0, 70, 90
  const A = mk('ann', null), B = mk('ben', 0), C = mk('cy', 70), D = mk('di', 90), G = mk('gal', null, 'gallery'), E = mk('empty', 80);
  const makers = [house, A, B, C, D, G, E];
  // A real work for its row's shape; the rest are its clones, two a maker.
  const f = path.join(dir, 'w.jpg'); fs.copyFileSync(path.join(__dirname, 'fixture.jpg'), f);
  const w0 = await app.locals.registerWork({ file: f, originalName: 'w.jpg', title: 'Seed' });
  const wcols = Object.keys(db.prepare('SELECT * FROM works WHERE id=?').get(w0.id)).filter(c => c !== 'id');
  const work = (maker, i) => { db.prepare(`INSERT INTO works (${wcols.join(', ')}) SELECT ${wcols.map(c => c === 'maker_id' ? '?' : c === 'slug' ? '?' : c === 'sha256' ? '?' : c).join(', ')} FROM works WHERE id=?`).run(...wcols.filter(c => ['maker_id', 'slug', 'sha256'].includes(c)).map(c => (c === 'maker_id' ? maker : c === 'slug' ? `st-${maker}-${i}` : `${maker}x${i}`)), w0.id); return db.prepare('SELECT id FROM works WHERE slug=?').get(`st-${maker}-${i}`).id; };
  const use = (maker, key) => (db.prepare('SELECT id FROM uses WHERE maker_id=? AND key=?').get(maker, key) || {}).id || ins('uses', { maker_id: maker, key, name: key, description: key });
  const days = n => `datetime('now', '-${n} days')`;
  for (const [mi, m] of makers.entries()) {
    if (m === E) continue;
    const a = work(m, 1), b = work(m, 2);
    const lic = (wk, key, price, status, ago, house_cents = null) => { const id = ins('licenses', { work_id: wk, use_id: use(m, key), licensee_name: 'L', licensee_email: 'l@example.com', ref: `R-${m}-${++k}`, price_cents: price, status, house_cents }); db.prepare(`UPDATE licenses SET created_at=${days(ago)}, starts_at=${days(ago)} WHERE id=?`).run(id); return id; };
    lic(a, 'social', 500 + mi, 'active', 2); lic(a, 'social', 700, 'active', 30, 200); lic(b, 'editorial', 35000 + mi * 7, 'expired', 40);
    lic(b, 'editorial', 9999, 'requested', 1); lic(b, 'editorial', 0, 'active', 1); lic(a, 'editorial', 12345, 'declined', 1);
    const p1 = lic(a, 'print', 18000, 'active', 20), p2 = lic(b, 'print', 24000 + mi, 'active', 60, 3000);
    ins('print_orders', { license_id: p1, status: 'delivered' }); ins('print_orders', { license_id: p2, status: 'asked' });
    ins('tips', { grp: 'g', maker_id: m, amount_cents: 300 + mi, status: 'paid' }); ins('tips', { grp: 'g', maker_id: m, amount_cents: 999, status: 'pending' });
    db.prepare(`UPDATE tips SET created_at=${days(20)}, paid_at=${days(20)} WHERE maker_id=? AND amount_cents=?`).run(m, 300 + mi); ins('tips', { grp: 'g', maker_id: m, amount_cents: 150, status: 'paid' });
    ins('payouts', { trade_id: 1, kind: 'royalty', maker_id: m, amount_cents: 410 + mi, status: 'owed' }); ins('payouts', { trade_id: 1, kind: 'fee', maker_id: m, amount_cents: 77, status: 'owed' });
    ins('maker_payouts', { maker_id: m, amount_cents: 1000 + mi, status: 'paid' }); ins('maker_payouts', { maker_id: m, amount_cents: 5, status: 'failed' });
    const t = ins('texts', { slug: `t-${m}`, kind: 'essay', title: 'T', maker_id: m, price_cents: 800 });
    ins('text_orders', { ref: `TO-${m}-1`, text_id: t, status: 'paid', price_cents: 999 + mi }); ins('text_orders', { ref: `TO-${m}-2`, text_id: t, status: 'pending', price_cents: 999 });
    db.prepare(`UPDATE text_orders SET created_at=${days(30)}, paid_at=${days(30)} WHERE ref=?`).run(`TO-${m}-1`); ins('text_orders', { ref: `TO-${m}-3`, text_id: t, status: 'paid', price_cents: 1234 });
    const cp = ins('copies', { text_id: t, seller_kind: 'maker', seller_id: m, price_cents: 2500 + mi });
    ins('copy_orders', { ref: `CO-${m}-1`, copy_id: cp, cents: 2600, paid: 1 }); ins('copy_orders', { ref: `CO-${m}-2`, copy_id: cp, cents: 2600, paid: 0 });
    if (m !== G) ins('gallery_cuts', { license_ref: `R-${m}`, gallery_id: G, maker_id: m, cents: 120 + mi });
    ins('work_splits', { work_id: a, name: 'Second shooter', pct: 10 }); ins('work_splits', { work_id: a, name: 'Assistant', pct: 2.5 + mi });
    const sit = ins('sitters', { buyer_id: ins('buyers', { customer: `cus-${m}`, email: `s${m}@example.com` }), name: mi % 2 ? null : 'Sitter ' + mi });
    ins('sitter_pay', { sitter_id: sit, maker_id: m, license_ref: `R-${m}`, cents: 90 + mi }); ins('sitter_pay', { sitter_id: sit, maker_id: m, license_ref: `R2-${m}`, cents: 11 });
    const shop = ins('print_shops', { maker_id: m, house: 0, lab: null });
    ins('print_jobs', { order_id: 1, shop_id: shop, token: `pj-${m}-1`, status: 'delivered', cents: 4000 + mi, done_at: null }); ins('print_jobs', { order_id: 1, shop_id: shop, token: `pj-${m}-2`, status: 'offered', cents: 999 });
    db.prepare(`UPDATE print_jobs SET done_at=${days(2)} WHERE token=?`).run(`pj-${m}-1`); ins('print_jobs', { order_id: 1, shop_id: shop, token: `pj-${m}-3`, status: 'delivered', cents: 500 });
    db.prepare(`UPDATE print_jobs SET done_at=${days(40)} WHERE token=?`).run(`pj-${m}-3`);
    const br = ins('briefs', { ref: `B-${m}`, token: `bt-${m}`, company: 'Co', email: 'co@example.com', title: 'A brief', status: 'done', paid: 1 });
    const ans = ins('brief_answers', { brief_id: br, maker_id: m, fee_cents: 50000 + mi }); db.prepare(`UPDATE briefs SET proposal_id=?, approved_at=${days(3)} WHERE id=?`).run(ans, br);
    ins('gazette_payments', { sub_id: 1, maker_id: m, cents: 600, maker_cents: 480 + mi, house_cents: 120 }); ins('gazette_payments', { sub_id: 1, maker_id: m, cents: 600, maker_cents: 480, house_cents: 120 });
    db.prepare(`UPDATE gazette_payments SET at=${days(25)} WHERE maker_id=? AND maker_cents=480`).run(m);
  }
  const rows = makers.map(id => db.prepare('SELECT * FROM makers WHERE id=?').get(id));
  const P = app.locals.payouts;
  const all = P.statements(rows), few = P.statements([rows[2], rows[4]]);
  let checked = 0;
  for (const m of rows) {
    const ref = plain(REF(app, db, m));
    assert.deepStrictEqual(plain(all.get(m.id)), ref, `${m.handle}: the grouped statement (all makers) is the per-maker one`);
    assert.deepStrictEqual(plain(P.statement(m)), ref, `${m.handle}: one maker's statement is the per-maker one`);
    if (few.has(m.id)) assert.deepStrictEqual(plain(few.get(m.id)), ref, `${m.handle}: asked among a few`);
    checked++;
  }
  // The fixture means something: money of every kind, some inside the hold, a sitter's by, a split's by, a gallery both ways.
  const a = all.get(A), g = all.get(G);
  assert.ok(a.share > 0 && a.thanks.s > 0 && a.royalties.s > 0 && a.words.m > 0 && a.copies.s > 0 && a.printing.s > 0 && a.commissions.s > 0 && a.gazette.s > 0 && a.splits.s > 0 && a.sitters.s > 0 && a.gallery.out.s > 0 && a.paid > 0, 'every kind of money is in the fixture');
  assert.ok(a.clearing > 0 && a.cleared > 0 && Object.keys(a.splits.by).length === 2 && Object.keys(a.sitters.by).length === 1, 'some of it inside the hold; who is owed, by name');
  assert.ok(g.gallery.in.n === makers.length - 2, 'the gallery’s cuts come in');
  assert.deepStrictEqual(plain(all.get(E)), plain(REF(app, db, rows[makers.indexOf(E)])), 'a maker with nothing');
  assert.ok(P.statements([]).size === 0, 'no makers, no statements');
  // the many-makers road (everyone, filtered after) agrees with the few-makers road
  const many = [...rows]; for (let i = 0; i < 401; i++) many.push(rows[i % rows.length]);
  const big = P.statements(many); for (const m of rows) assert.deepStrictEqual(plain(big.get(m.id)), plain(all.get(m.id)), `${m.handle}: past STATEMENTS_IN, the same`);
  console.log(`statements: ${checked} makers, every field, as the per-maker questions had it (house's share on the ${FEE.on() ? 'collector' : 'maker'}'s side)`);
  fs.rmSync(dir, { recursive: true, force: true });
  if (!process.env.STM_SECOND) {
    const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, FEE_SIDE: 'collector', STM_SECOND: '1' }, stdio: 'inherit' });
    if (r.status !== 0) { console.error('statements: the collector side failed'); process.exit(1); }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
