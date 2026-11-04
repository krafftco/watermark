// The price record (Will, 3 Nov: "put a market price to every single work"; "price the art market better than anyone
// ever"; built as the honest first layer: what was actually paid on Watermark, from the register, never a guess).
// Every work's page carries its record: each personal sale (a Collect, the Reference, a print) with its date and
// price, each resale in the market, what is asked now, a line drawn through them. The house's index (/prices) and
// each maker's (/prices/:handle) add the month by month. Never an appraisal, said on every page. Working licences
// (a story, a company, a campaign) are counted, never priced in public: their fees are negotiated and private.
// A maker may keep their record off the public pages (`makers.price_record` = 0, /account/price-record).
// Next (the plan): licensed auction comparables for physical works, as ranges with their basis and confidence.
const PERSONAL = ['social', 'reference', 'print'];
const WORD = { social: 'Collected', reference: 'Collected, the Reference', print: 'A print' };

function mountPrices(app, { db, V, makerOf, isStudio, ledger }) {
  const { esc, tidy } = V;
  if (!db.prepare("SELECT 1 FROM pragma_table_info('makers') WHERE name='price_record'").get()) db.exec('ALTER TABLE makers ADD COLUMN price_record INTEGER NOT NULL DEFAULT 1');
  const money = c => (c == null ? '' : '$' + (c % 100 ? (c / 100).toFixed(2) : (c / 100).toLocaleString('en-US')));
  const day = s => { const d = new Date(String(s || '').replace(' ', 'T') + (/Z$|[+-]\d\d:?\d\d$/.test(String(s)) ? '' : 'Z')); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }); };
  const IN = PERSONAL.map(() => '?').join(',');
  const PAID = "l.status IN ('active','expired') AND l.price_cents > 0";
  const open = m => { if (!m) return false; const r = m.id ? db.prepare('SELECT price_record FROM makers WHERE id=?').get(m.id) : null; return (r ? r.price_record : m.price_record) !== 0; }; // read fresh: the maker record may be cached

  // One work's record, oldest first.
  function record(w) {
    const sales = db.prepare(`SELECT l.price_cents, COALESCE(l.starts_at, l.created_at) at, l.collector_no, u.key FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=? AND ${PAID} AND u.key IN (${IN}) ORDER BY at, l.id`).all(w.id, ...PERSONAL)
      .map(s => ({ at: s.at, cents: s.price_cents, what: WORD[s.key] + (s.collector_no ? `, No. ${s.collector_no}` : ''), kind: 'sale' }));
    let resales = []; try { resales = db.prepare('SELECT t.price_cents, t.at, l.collector_no FROM trades t JOIN licenses l ON l.id=t.license_id WHERE l.work_id=? ORDER BY t.at, t.id').all(w.id).map(t => ({ at: t.at, cents: t.price_cents, what: `Resold${t.collector_no ? `, No. ${t.collector_no}` : ''}`, kind: 'resale' })); } catch (e) { resales = []; }
    const working = db.prepare(`SELECT COUNT(*) n FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.work_id=? AND ${PAID} AND u.key NOT IN (${IN}, 'delivery')`).get(w.id, ...PERSONAL).n;
    const events = [...sales, ...resales].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const mkt = app.locals.market ? app.locals.market.priceOf(w.id) : {};
    const cs = events.map(e => e.cents);
    return { events, working, ask: mkt.ask || null, asks: mkt.asks || 0, value: mkt.value || (cs.length ? cs[cs.length - 1] : null), low: cs.length ? Math.min(...cs) : null, high: cs.length ? Math.max(...cs) : null };
  }
  // A line through the prices, drawn as the house draws its glyphs.
  function spark(events, w = 260, h = 48) {
    if (events.length < 2) return '';
    const cs = events.map(e => e.cents), lo = Math.min(...cs), hi = Math.max(...cs), span = hi - lo || 1;
    const pts = events.map((e, i) => [Math.round((i / (events.length - 1)) * (w - 8) + 4), Math.round(h - 6 - ((e.cents - lo) / span) * (h - 12))]);
    return `<svg class="prc-sp" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" points="${pts.map(p => p.join(',')).join(' ')}"/>${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 3 : 2}" fill="${events[i].kind === 'resale' ? '#d9bc7c' : 'currentColor'}"/>`).join('')}</svg>`;
  }
  const NOTE = 'What was paid on Watermark, from the house’s register. Not an appraisal.';

  // The block on the work's page.
  function block(w, maker) {
    if (!w || w.open || !open(maker)) return '';
    const r = record(w);
    if (!r.events.length && !r.ask && !r.working) return '';
    const n = r.events.length;
    const line = n ? `${n === 1 ? 'Once' : `${n} times`} since ${esc(day(r.events[0].at))}${r.low !== r.high ? `, from ${money(r.low)} to ${money(r.high)}` : `, at ${money(r.low)}`}.` : 'Not yet sold on the register.';
    return `<section class="prc" id="price"><header><p class="k">The price record</p><h2 class="wk-h2">${n ? `Last paid ${money(r.events[n - 1].cents)}.` : 'No price yet.'}</h2><p class="prc-l">${line}${r.ask ? ` Asked now in the market: ${money(r.ask)}${r.asks > 1 ? ` (${r.asks} listed)` : ''}.` : ''}${r.working ? ` Licensed for work ${r.working === 1 ? 'once' : `${r.working} times`}; those fees stay private.` : ''}</p></header>
${spark(r.events)}${n ? `<ol class="prc-ev">${r.events.slice(-12).reverse().map(e => `<li${e.kind === 'resale' ? ' class="prc-re"' : ''}><span>${esc(day(e.at))}</span><b>${esc(e.what)}</b><em>${money(e.cents)}</em></li>`).join('')}</ol>` : ''}
<p class="note">${NOTE} <a href="/prices/${esc(maker.handle)}">${esc(maker.name)}’s prices</a> · <a href="/prices">The house’s index</a></p></section>`;
  }

  // Month by month, for the house or one maker.
  function index(makerId) {
    const where = makerId ? 'AND w.maker_id=?' : ''; const args = makerId ? [makerId] : [];
    const rows = db.prepare(`SELECT l.price_cents c, COALESCE(l.starts_at, l.created_at) at, w.slug, w.title, w.maker_id, u.key FROM licenses l JOIN uses u ON u.id=l.use_id JOIN works w ON w.id=l.work_id JOIN makers m ON m.id=w.maker_id WHERE ${PAID} AND u.key IN (${IN}) AND m.price_record<>0 ${where} ORDER BY at`).all(...PERSONAL, ...args);
    let trades = []; try { trades = db.prepare(`SELECT t.price_cents c, t.at, w.slug, w.title, w.maker_id FROM trades t JOIN licenses l ON l.id=t.license_id JOIN works w ON w.id=l.work_id JOIN makers m ON m.id=w.maker_id WHERE m.price_record<>0 ${where} ORDER BY t.at`).all(...args); } catch (e) { trades = []; }
    const months = {}; for (const r of rows.concat(trades)) { const k = String(r.at).slice(0, 7); const o = months[k] = months[k] || { n: 0, cents: 0, list: [] }; o.n++; o.cents += r.c; o.list.push(r.c); }
    const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const byWork = {}; for (const r of rows.concat(trades)) { const o = byWork[r.slug] = byWork[r.slug] || { slug: r.slug, title: r.title, n: 0, cents: 0, last: 0, maker_id: r.maker_id }; o.n++; o.cents += r.c; o.last = r.c; }
    const all = rows.concat(trades);
    return { n: all.length, cents: all.reduce((s, r) => s + r.c, 0), median: median(all.map(r => r.c)), resales: trades.length, works: Object.keys(byWork).length,
      months: Object.entries(months).map(([k, o]) => ({ month: k, n: o.n, cents: o.cents, median: median(o.list) })),
      top: Object.values(byWork).sort((a, b) => b.n - a.n || b.cents - a.cents).slice(0, 12),
      latest: all.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30) };
  }
  const bars = months => { if (!months.length) return ''; const hi = Math.max(...months.map(m => m.cents)) || 1; return `<div class="prc-bars">${months.slice(-18).map(m => `<span title="${esc(m.month)}: ${m.n} · ${money(m.cents)}" style="--h:${Math.max(4, Math.round((m.cents / hi) * 100))}%"><i></i><small>${esc(new Date(m.month + '-01T12:00:00Z').toLocaleDateString('en-US', { month: 'short' }))}</small></span>`).join('')}</div>`; };
  const nameOf = id => { const m = db.prepare('SELECT name, handle FROM makers WHERE id=?').get(id); return m || { name: '', handle: '' }; };
  function page(req, res, m) {
    const ix = index(m ? m.id : null);
    const title = m ? `${m.name}’s prices` : 'The price record';
    res.send(V.layout({ title: `${title} · Watermark`, path: '/prices', desc: 'What was paid for work on Watermark, from the house’s register.', body: `<section class="prc-ix"><p class="k">${m ? `<a href="/m/${esc(m.handle)}">${esc(m.name)}</a>` : 'The house'}</p><h1>${esc(title)}.</h1>
<p class="lede">Every sale and every resale on Watermark, as the register keeps it: real prices, paid for real works, each tied to its number. Not an appraisal and not advice; a record.</p>
<div class="prc-nums"><span><b>${ix.n.toLocaleString('en-US')}</b> sales</span><span><b>${money(ix.cents) || '$0'}</b> paid in all</span><span><b>${ix.median != null ? money(ix.median) : '—'}</b> the middle price</span><span><b>${ix.works}</b> works sold</span><span><b>${ix.resales}</b> resales</span></div>
${bars(ix.months)}
${ix.top.length ? `<h2>Most collected</h2><ol class="prc-top">${ix.top.map(t => { const mk = nameOf(t.maker_id); return `<li><a href="/w/${esc(t.slug)}#price"><img src="/img/${esc(t.slug)}/thumb" alt="" loading="lazy"><b>${esc(tidy(t.title))}</b><small>${m ? '' : esc(mk.name) + ' · '}${t.n} sale${t.n === 1 ? '' : 's'} · last ${money(t.last)}</small></a></li>`; }).join('')}</ol>` : '<p class="note">Nothing sold yet.</p>'}
${ix.latest.length ? `<h2>Lately</h2><ol class="prc-ev">${ix.latest.map(e => `<li><span>${esc(day(e.at))}</span><b><a href="/w/${esc(e.slug)}#price">${esc(tidy(e.title))}</a>${m ? '' : ` · ${esc(nameOf(e.maker_id).name)}`}</b><em>${money(e.c)}</em></li>`).join('')}</ol>` : ''}
<p class="note">${NOTE} Licences for a story, a company or a campaign are negotiated and kept private, so they are not here. ${m ? '' : 'A maker may keep their record off these pages.'}</p></section>` }));
  }
  app.get('/prices', (req, res) => page(req, res, null));
  app.get('/prices/:handle', (req, res, next) => {
    const m = db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.params.handle)); if (!m) return next();
    if (!open(m) && !isStudio(req) && !((makerOf(req) || {}).id === m.id)) return res.redirect('/prices');
    page(req, res, m);
  });
  // The maker's say.
  app.get('/account/price-record', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/price-record');
    const ix = index(m.id);
    res.send(V.layout({ title: 'Your price record · Watermark', path: '/account/price-record', body: `<section class="studio-wrap"><p class="k">Your page and store</p><h1>Your price record</h1>
<p class="lede">Every work you sell on Watermark carries its record: when it was collected and for how much, and every resale. It is the plain truth of your market, and it helps collectors trust what they pay. You may keep it to yourself.</p>
<p>${ix.n} sales · ${money(ix.cents) || '$0'} · the middle price ${ix.median != null ? money(ix.median) : '—'}. <a href="/prices/${esc(m.handle)}">See it</a></p>
<form method="post" action="/account/price-record"><label><input type="checkbox" name="on" value="1"${open(m) ? ' checked' : ''}> Show my price record on my works and in the house’s index</label> <button class="buy-btn">Keep</button></form></section>` }));
  });
  app.post('/account/price-record', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const on = (req.body || {}).on === '1' ? 1 : 0;
    db.prepare('UPDATE makers SET price_record=? WHERE id=?').run(on, m.id);
    ledger.append(db, 'maker.prices', m.handle, { on: !!on });
    res.redirect(303, '/account/price-record');
  });
  app.locals.prices = { record, block, index };
  return app.locals.prices;
}
module.exports = { mountPrices, PERSONAL };
