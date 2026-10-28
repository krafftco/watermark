'use strict';
// The books (Will, 28 Oct: "spin it up so that we can get them everything we need": Zeni, the finance back office,
// keeps the books for Krafftco LLC, the Texas entity; it reads Stripe and the bank itself, and needs from the house
// what Stripe cannot tell it: what each charge was, whose money it is, and what the house holds for others).
// Studio → Back office → The books (/studio/books): a month at a time, three files a month, and the one-pager.
//   /studio/books/<YYYY-MM>.csv           every money event of the month, one a line, keyed on the Stripe id where there is one
//   /studio/books/<YYYY-MM>/balances.csv  the month-end snapshot: owed to makers, pockets held, prepaid memberships
//   /studio/books/<YYYY-MM>/summary.csv   the month in totals by revenue class
//   /studio/books/how.txt                 how Watermark makes money, in one page, for the bookkeeper
// Nothing here moves money or touches Stripe; it reads the house's own tables. The register is the record; this is
// the record told the way a bookkeeper files it.
const FEE = require('./fee');

const ENTITY = process.env.BOOKS_ENTITY || 'Krafftco LLC (Texas)';

const csv = rows => rows.map(r => r.map(v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n') + '\n';
const dollars = c => (Math.round(c || 0) / 100).toFixed(2);
const monthOf = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '') ? s : null;
const range = ym => { const [y, m] = ym.split('-').map(Number); const a = new Date(Date.UTC(y, m - 1, 1)); const b = new Date(Date.UTC(y, m, 1)); return [a.toISOString().slice(0, 19).replace('T', ' '), b.toISOString().slice(0, 19).replace('T', ' ')]; };

// Revenue classes, the words Zeni files by. Every money event carries one.
const CLASS = { social: 'collect', reference: 'collect', print: 'print', delivery: 'delivery', story: 'license', company: 'license', audience: 'license', wall: 'license', commercial: 'license', editorial: 'license' };
const classOf = key => CLASS[key] || 'license';

function mountBooks(app, { db, V, studioOnly }) {
  const has = (t, c) => { try { return !!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name='${c}'`).get(); } catch (e) { return false; } }; // t and c are the house's own names, never input
  const table = t => { try { db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get(); return true; } catch (e) { return false; } };
  const safe = (fn, d = []) => { try { return fn(); } catch (e) { console.error('[books]', e.message); return d; } };
  const pct = db.prepare('SELECT m.share_pct FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.id=?');
  const makerName = db.prepare('SELECT m.name, m.handle FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.id=?');

  // Every money event of a month. Columns are fixed so a bookkeeper's rules can rely on them.
  const HEAD = ['date', 'kind', 'revenue_class', 'ref', 'stripe_id', 'gross', 'house', 'owed_to', 'owed_name', 'owed_amount', 'payer', 'work', 'note'];
  function events(ym) {
    const [a, b] = range(ym); const out = [];
    // Licences paid: every Collect, licence, print edition, Reference. gross = what the collector paid; house = the house's part;
    // the rest is owed to the maker (a liability until Friday pay clears it).
    for (const l of safe(() => db.prepare("SELECT l.*, u.key use_key, w.title, w.slug, w.id wid FROM licenses l JOIN uses u ON u.id=l.use_id JOIN works w ON w.id=l.work_id WHERE l.status IN ('active','expired') AND l.price_cents > 0 AND l.starts_at >= ? AND l.starts_at < ? ORDER BY l.starts_at").all(a, b))) {
      const share = (pct.get(l.wid) || {}).share_pct || 85; const maker = FEE.makerOf(l, share); const m = makerName.get(l.wid) || {};
      const how = l.set_ref ? String(l.set_ref).split(':')[0] : (l.stripe_session ? 'checkout' : 'pocket');
      out.push([l.starts_at, 'license', classOf(l.use_key), l.ref, l.stripe_session || '', dollars(l.price_cents), dollars(l.price_cents - maker), m.handle ? `maker:${m.handle}` : '', m.name || '', dollars(maker), l.licensee_company || l.licensee_name || '', l.title || l.slug, `${l.use_key} · ${how}`]);
    }
    // Thank-you cards and tips: the house keeps none; all owed to the maker.
    if (table('tips')) for (const t of safe(() => db.prepare("SELECT t.*, m.name mname, m.handle FROM tips t JOIN makers m ON m.id=t.maker_id WHERE t.status='paid' AND t.paid_at >= ? AND t.paid_at < ? ORDER BY t.paid_at").all(a, b))) {
      out.push([t.paid_at, 'tip', 'tip', `tip:${t.id}`, t.stripe_session || '', dollars(t.amount_cents), '0.00', `maker:${t.handle}`, t.mname, dollars(t.amount_cents), t.name || '', t.post_slug || '', t.role || 'thanks']);
    }
    // Friends, Patrons, Keeping: the house's own revenue (not tax-deductible; said on the page).
    if (table('friends')) for (const f of safe(() => db.prepare("SELECT * FROM friends WHERE status IN ('active','given') AND started_at >= ? AND started_at < ? ORDER BY started_at").all(a, b))) {
      out.push([f.started_at, f.kind === 'keeping' ? 'keeping' : 'friend', 'subscription', `friend:${f.id}`, f.stripe_sub || f.stripe_session || '', dollars(f.amount_cents), dollars(f.amount_cents), '', '', '0.00', f.name || f.email || '', '', `${f.level}${f.recurring ? ' · monthly' : ' · once'} · ${f.house}`]);
    }
    // The Club.
    if (table('circle')) for (const c of safe(() => db.prepare("SELECT * FROM circle WHERE status IN ('active','ending') AND started_at >= ? AND started_at < ? ORDER BY started_at").all(a, b))) {
      out.push([c.started_at, 'club', 'subscription', `club:${c.id}`, c.stripe_sub || c.stripe_session || '', dollars(c.cents), dollars(c.cents), '', '', '0.00', c.name || c.email || '', '', `${c.level} · yearly`]);
    }
    // Franchises (a maker's own house at a fee).
    if (table('franchises')) for (const f of safe(() => db.prepare("SELECT f.*, m.handle FROM franchises f JOIN makers m ON m.id=f.maker_id WHERE f.status IN ('active','ending','ended') AND f.started_at >= ? AND f.started_at < ? ORDER BY f.started_at").all(a, b))) {
      out.push([f.started_at, 'franchise', 'subscription', `franchise:${f.id}`, f.stripe_sub || f.stripe_session || '', dollars(f.cents), dollars(f.cents), '', '', '0.00', `maker:${f.handle}`, '', 'monthly']);
    }
    // Pocket top-ups: money held for a collector, a liability, not revenue, until it is spent.
    if (table('pocket')) for (const p of safe(() => db.prepare("SELECT p.*, b.email, b.code FROM pocket p LEFT JOIN buyers b ON b.id=p.buyer_id WHERE p.kind='topup' AND p.status='posted' AND p.at >= ? AND p.at < ? ORDER BY p.at").all(a, b))) {
      out.push([p.at, 'topup', 'liability', `pocket:${p.id}`, p.stripe_session || '', dollars(p.cents), '0.00', `collector:${p.code || p.buyer_id}`, '', dollars(p.cents), p.email || '', '', 'held in the pocket until spent']);
    }
    // Print orders paid directly (proofs; editions are licences above): gross to the house, the lab's cost is the house's expense.
    if (table('print_orders') && has('print_orders', 'cents')) for (const o of safe(() => db.prepare("SELECT * FROM print_orders WHERE paid=1 AND cents > 0 AND kind IN ('proof','ask') AND at >= ? AND at < ? ORDER BY at").all(a, b))) {
      out.push([o.at, 'print', 'print', `print:${o.id}`, o.stripe_session || '', dollars(o.cents), dollars(o.cents), '', '', '0.00', o.ship_name || o.email || '', '', `${o.kind} · ${o.size || ''}`]);
    }
    // The Bookshop: a copy sold; the seller's side is owed out.
    if (table('copy_orders')) for (const o of safe(() => db.prepare("SELECT o.*, c.seller_kind, c.seller_id FROM copy_orders o JOIN copies c ON c.id=o.copy_id WHERE o.paid=1 AND o.paid_at >= ? AND o.paid_at < ? ORDER BY o.paid_at").all(a, b))) {
      const owed = o.seller_kind === 'house' ? 0 : Math.max(0, o.cents - o.house_cents);
      out.push([o.paid_at, 'copy', 'book', o.ref, o.stripe_session || '', dollars(o.cents), dollars(o.cents - owed), owed ? `${o.seller_kind}:${o.seller_id}` : '', '', dollars(owed), o.ship_name || o.email || '', '', o.status]);
    }
    // Texts taken (the Library): a maker's price is theirs; the house's premium when the fee is on.
    if (table('text_orders')) for (const o of safe(() => db.prepare("SELECT o.*, t.title, t.maker_id, m.handle, m.name mname FROM text_orders o JOIN texts t ON t.id=o.text_id LEFT JOIN makers m ON m.id=t.maker_id WHERE o.status='paid' AND o.paid_at >= ? AND o.paid_at < ? ORDER BY o.paid_at").all(a, b))) {
      const total = o.price_cents || 0; const maker = o.maker_id ? (FEE.on() ? FEE.makerFromTotal('text', total) : total) : 0;
      out.push([o.paid_at, 'text', 'book', o.ref, o.stripe_session || '', dollars(total), dollars(total - maker), o.handle ? `maker:${o.handle}` : '', o.mname || '', dollars(maker), o.email || '', o.title, 'a text from the Library']);
    }
    // Money out: Friday pay and other transfers to makers, cash-outs from pockets. Negative gross; these clear the liability.
    if (table('maker_payouts')) for (const p of safe(() => db.prepare("SELECT p.*, m.name, m.handle FROM maker_payouts p JOIN makers m ON m.id=p.maker_id WHERE p.status='paid' AND p.at >= ? AND p.at < ? ORDER BY p.at").all(a, b))) {
      out.push([p.at, 'payout', 'payout', `payout:${p.id}`, p.stripe_transfer || '', dollars(-p.amount_cents), '0.00', `maker:${p.handle}`, p.name, dollars(-p.amount_cents), '', '', `${p.how}${p.note ? ' · ' + p.note : ''}`]);
    }
    if (table('pocket')) for (const p of safe(() => db.prepare("SELECT p.*, b.code FROM pocket p LEFT JOIN buyers b ON b.id=p.buyer_id WHERE p.kind='cashout' AND p.status IN ('posted','paid') AND p.at >= ? AND p.at < ? ORDER BY p.at").all(a, b))) {
      out.push([p.at, 'cashout', 'payout', `pocket:${p.id}`, p.stripe_session || '', dollars(p.cents), '0.00', `collector:${p.code || p.buyer_id}`, '', dollars(p.cents), '', '', p.note || 'cashed out']);
    }
    // The lab's charges: the house's cost of goods on prints it sold.
    if (table('print_jobs') && has('print_jobs', 'lab_cost')) for (const j of safe(() => db.prepare("SELECT j.*, s.lab FROM print_jobs j JOIN print_shops s ON s.id=j.shop_id WHERE s.lab IS NOT NULL AND j.lab_cost > 0 AND j.status IN ('accepted','printing','shipped','delivered') AND j.offered_at >= ? AND j.offered_at < ? ORDER BY j.offered_at").all(a, b))) {
      out.push([j.offered_at, 'lab', 'cost', `job:${j.id}`, j.lab_order || '', dollars(-j.lab_cost), dollars(-j.lab_cost), '', '', '0.00', 'the house’s lab', '', 'cost of a print sold']);
    }
    out.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    return out;
  }

  // The month in totals by class.
  function summary(ym) {
    const by = {}; let gross = 0, house = 0, owed = 0;
    for (const r of events(ym)) {
      const k = r[2]; const g = Math.round(Number(r[5]) * 100), h = Math.round(Number(r[6]) * 100), o = Math.round(Number(r[9]) * 100);
      by[k] = by[k] || { n: 0, gross: 0, house: 0, owed: 0 }; by[k].n++; by[k].gross += g; by[k].house += h; by[k].owed += o;
      if (k !== 'payout' && k !== 'cost' && k !== 'liability') { gross += g; house += h; owed += o; }
    }
    return { by, gross, house, owed };
  }

  // The month-end snapshot: what the house holds for others. Computed as of now (the live tables carry no history),
  // so the right moment to take it is the first days of the next month.
  function balances() {
    const rows = [['as_of', 'liability', 'owed_to', 'name', 'amount', 'note']]; const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const P = app.locals.payouts; const K = app.locals.pocket;
    if (P) for (const m of safe(() => db.prepare("SELECT * FROM makers WHERE kind IS NULL OR kind NOT IN ('institution','gallery','printer') ORDER BY handle").all())) {
      const st = safe(() => P.statement(m), null); if (!st || !st.owed) continue;
      rows.push([now, 'owed to maker', `maker:${m.handle}`, m.name, dollars(st.owed), `cleared ${dollars(st.cleared)} · clearing ${dollars(st.clearing)} · bank ${m.stripe_account ? 'connected' : 'none'}`]);
    }
    if (K) for (const b of safe(() => db.prepare('SELECT * FROM buyers ORDER BY id').all())) {
      const bal = safe(() => K.balance(b), 0); if (!bal) continue;
      rows.push([now, 'pocket held', `collector:${b.code || b.id}`, b.name || '', dollars(bal), `earned ${dollars(safe(() => K.earned(b), 0))} (cashable) · the rest top-ups`]);
    }
    if (table('circle')) { const c = safe(() => db.prepare("SELECT COUNT(*) n, COALESCE(SUM(cents),0) s FROM circle WHERE status IN ('active','ending')").get(), { n: 0, s: 0 }); if (c.n) rows.push([now, 'prepaid memberships', 'club', `${c.n} members`, dollars(c.s), 'paid by the year; recognise monthly']); }
    if (table('friends')) { const f = safe(() => db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount_cents),0) s FROM friends WHERE status='active' AND recurring=1").get(), { n: 0, s: 0 }); if (f.n) rows.push([now, 'recurring friends', 'friends', `${f.n} standing`, dollars(f.s), 'a month’s run rate']); }
    return rows;
  }

  // Months the house has money in.
  function months() {
    const set = new Set();
    for (const r of safe(() => db.prepare("SELECT DISTINCT substr(starts_at,1,7) m FROM licenses WHERE status IN ('active','expired') AND price_cents > 0 AND starts_at IS NOT NULL").all())) if (monthOf(r.m)) set.add(r.m);
    set.add(new Date().toISOString().slice(0, 7));
    return [...set].sort().reverse();
  }

  const HOW = () => `HOW WATERMARK MAKES MONEY
For the bookkeeper. ${ENTITY}. Prepared by the house on ${new Date().toISOString().slice(0, 10)}.

WHAT IT IS
Watermark (watermark.krafftco.com) is a museum for the web with an engine under it. Makers keep their work
there; anyone can own a piece of it. Every sale is a licence to a work, recorded on the house's register.

WHO IS PAID, AND WHEN
1. A collector pays a total through Stripe (Checkout, Apple Pay/Google Pay in place, or from a prepaid pocket).
2. Of that total the house keeps its share (the column "house" in the export); the rest is the maker's
   and is a LIABILITY to the maker from the moment of sale, not the house's revenue.
   ${FEE.on() ? 'The house’s share is paid by the collector on top of the maker’s price: the Collect is $5 + $2; other uses carry a published schedule (20% to $5,000, 15% to $50,000, 10% above). See /share.' : 'The maker’s share is 85% of the price; the house keeps 15%.'}
3. Every Friday from 10 am New York, everything cleared (PAYOUT_HOLD_DAYS, 7 days after the sale) goes to each
   maker's bank by Stripe Connect transfer ("Friday pay"). Those transfers appear in Stripe as transfers, never as
   expenses: they clear the liability in 2. Makers without a bank connected are paid by hand and recorded the same way.
4. Thank-you cards and tips go to the maker whole; the house keeps nothing.
5. Friends of the house, Keeping, the Club and a maker's franchise are subscriptions and are the house's own revenue.
   The Club is paid by the year: recognise it monthly.
6. A pocket top-up is money held for a collector (a liability) until spent on a Collect or a card; cash-outs return it.
7. Prints: the collector pays the house; the house pays its lab (cost of goods) or a local print shop (a fee, 60% of
   the print's price, owed to that shop as to a maker). Editions pay the maker as any licence.
8. Curators, guides and hosts earn a share into their pocket (5% curation from the house's side; hosting);
   cleared earnings go out on Friday pay with the makers'.

WHERE THE RECORD IS
- The register (watermark.krafftco.com/ledger) is the signed, anchored record of every event.
- /studio/books/<month>.csv: every money event, one a line, with the Stripe session or transfer id where one exists,
  gross, the house's part, who the rest is owed to, and a revenue class:
  collect · license · print · delivery · tip · subscription · book · liability · payout · cost.
- /studio/books/<month>/balances.csv: what the house holds for others at month end (owed to makers, pockets,
  prepaid memberships). Take it in the first days of the following month.
- /studio/books/<month>/summary.csv: the month in totals by class.

STRIPE
One live account under ${ENTITY}; Connect (Express) for makers' banks. Card fees come out of the house's share,
never the maker's. Refunds reverse the sale and, if already paid out, are recovered from the maker's next statement.

SALES TAX
Not yet collected. Counsel is deciding the character of the house's share (a buyer's premium); Stripe Tax is the
intended road. Flag any state nexus questions to the house.

PEOPLE
Owner: Will Fullerton (will@krafftco.com). Questions on any line: house@watermark.krafftco.com.
`;

  // Routes.
  app.get('/studio/books', studioOnly, (req, res) => {
    const ms = months(); const ym = monthOf(req.query.m) || ms[0]; const S = summary(ym); const B = balances();
    const row = (k, v) => `<tr><td>${V.esc(k)}</td><td class=n>${v.n}</td><td class=n>$${dollars(v.gross)}</td><td class=n>$${dollars(v.house)}</td><td class=n>$${dollars(v.owed)}</td></tr>`;
    const body = `
<section class="bks-room"><p class="kicker">Back office · The books</p><h1>The books</h1>
<p class="muted">What the bookkeeper needs that Stripe cannot tell them: what each charge was, whose money it is, and what the house holds for others. ${V.esc(ENTITY)}.</p>
<form method="get" class="bks-pick">${ms.map(m => `<a href="/studio/books?m=${m}" class="${m === ym ? 'on' : ''}">${m}</a>`).join(' ')}</form>
<h2>${ym}</h2>
<p class="bks-files"><a class="btn" href="/studio/books/${ym}.csv">Every money event (.csv)</a> <a class="btn" href="/studio/books/${ym}/summary.csv">The month by class (.csv)</a> <a class="btn" href="/studio/books/${ym}/balances.csv">Month-end balances (.csv)</a> <a class="btn" href="/studio/books/how.txt">How Watermark makes money (.txt)</a></p>
<table class="tbl bks-tbl"><thead><tr><th>Class</th><th class=n>N</th><th class=n>Gross</th><th class=n>House</th><th class=n>Owed out</th></tr></thead><tbody>
${Object.entries(S.by).sort().map(([k, v]) => row(k, v)).join('')}
<tr class="bks-sum"><td>Revenue classes together</td><td></td><td class=n>$${dollars(S.gross)}</td><td class=n>$${dollars(S.house)}</td><td class=n>$${dollars(S.owed)}</td></tr></tbody></table>
<h2>Held for others, now</h2>
<table class="tbl bks-tbl"><thead><tr><th>Liability</th><th>Owed to</th><th class=n>Amount</th><th>Note</th></tr></thead><tbody>
${B.slice(1).map(r => `<tr><td>${V.esc(r[1])}</td><td>${V.esc(r[3] || r[2])}</td><td class=n>$${r[4]}</td><td class="muted">${V.esc(r[5])}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">Nothing held.</td></tr>'}
</tbody></table>
<p class="muted">The balances are as of this moment; take them in the first days of the month that follows. Payouts and the lab's costs are negative lines in the event file and clear the liabilities above.</p>
</section>`;
    res.send(V.layout({ title: 'The books · Studio', body, path: '/studio/books', studio: true }));
  });
  app.get('/studio/books/how.txt', studioOnly, (req, res) => { res.type('text/plain; charset=utf-8').send(HOW()); });
  app.get('/studio/books/:ym.csv', studioOnly, (req, res) => {
    const ym = monthOf(req.params.ym); if (!ym) return res.sendStatus(404);
    res.setHeader('Content-Disposition', `attachment; filename="watermark-${ym}-events.csv"`);
    res.type('text/csv; charset=utf-8').send(csv([HEAD, ...events(ym)]));
  });
  app.get('/studio/books/:ym/summary.csv', studioOnly, (req, res) => {
    const ym = monthOf(req.params.ym); if (!ym) return res.sendStatus(404); const S = summary(ym);
    const rows = [['month', 'revenue_class', 'n', 'gross', 'house', 'owed_out']];
    for (const [k, v] of Object.entries(S.by).sort()) rows.push([ym, k, v.n, dollars(v.gross), dollars(v.house), dollars(v.owed)]);
    rows.push([ym, 'TOTAL (revenue classes)', '', dollars(S.gross), dollars(S.house), dollars(S.owed)]);
    res.setHeader('Content-Disposition', `attachment; filename="watermark-${ym}-summary.csv"`);
    res.type('text/csv; charset=utf-8').send(csv(rows));
  });
  app.get('/studio/books/:ym/balances.csv', studioOnly, (req, res) => {
    const ym = monthOf(req.params.ym); if (!ym) return res.sendStatus(404);
    res.setHeader('Content-Disposition', `attachment; filename="watermark-${ym}-balances.csv"`);
    res.type('text/csv; charset=utf-8').send(csv(balances()));
  });

  app.locals.books = { events, summary, balances, months, HOW, ENTITY };
}

module.exports = { mountBooks, csv };
