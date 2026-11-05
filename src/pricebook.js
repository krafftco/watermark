// The price book (Will, 5 Nov: "the most valuable financial tool in the world … if I go to auction houses, I know exactly
// how much something should sell for; I know what to bid"). Private to the Studio. Every auction result the house can
// lawfully keep (entered from a catalogue or a sale attended, a spreadsheet, a licensed feed; never scraped), each price
// brought to dollars and to today's dollars, and for any lot: what it should sell for, from that artist's own sales
// (a fit of price on size, medium, period, the years since, and the weight of its provenance, exhibitions and
// literature), or from its nearest comparables when there are too few; the range, how sure, the sales it rests on, and
// the ceiling: the highest hammer to bid so that hammer plus the buyer's premium stays at the price.
// It is the house's own working tool. Shown to the public it would read as an appraisal; it is not shown.
// FX and CPI tables are the house's approximations (annual averages), drafts to be replaced by a licensed series.

const CPI = { 1990: 130.7, 1991: 136.2, 1992: 140.3, 1993: 144.5, 1994: 148.2, 1995: 152.4, 1996: 156.9, 1997: 160.5, 1998: 163.0, 1999: 166.6, 2000: 172.2, 2001: 177.1, 2002: 179.9, 2003: 184.0,
  2004: 188.9, 2005: 195.3, 2006: 201.6, 2007: 207.3, 2008: 215.3, 2009: 214.5, 2010: 218.1, 2011: 224.9, 2012: 229.6, 2013: 233.0, 2014: 236.7, 2015: 237.0, 2016: 240.0, 2017: 245.1, 2018: 251.1,
  2019: 255.7, 2020: 258.8, 2021: 271.0, 2022: 292.7, 2023: 304.7, 2024: 313.7, 2025: 322.0, 2026: 330.0 };
// US dollars to one unit, annual averages (approximate).
const FX = { USD: { 2000: 1 }, GBP: { 1990: 1.78, 1995: 1.58, 2000: 1.516, 2005: 1.82, 2008: 1.85, 2010: 1.546, 2012: 1.585, 2014: 1.648, 2015: 1.528, 2016: 1.355, 2017: 1.289, 2018: 1.335, 2019: 1.277, 2020: 1.284, 2021: 1.375, 2022: 1.237, 2023: 1.243, 2024: 1.278, 2025: 1.32 },
  EUR: { 1999: 1.066, 2000: 0.924, 2002: 0.945, 2005: 1.245, 2008: 1.471, 2010: 1.327, 2012: 1.286, 2014: 1.329, 2015: 1.11, 2016: 1.107, 2017: 1.13, 2018: 1.181, 2019: 1.12, 2020: 1.142, 2021: 1.183, 2022: 1.053, 2023: 1.081, 2024: 1.082, 2025: 1.13 },
  CHF: { 2000: 0.593, 2005: 0.804, 2010: 0.96, 2015: 1.04, 2018: 1.017, 2020: 1.067, 2022: 1.047, 2023: 1.113, 2024: 1.136, 2025: 1.2 },
  HKD: { 2000: 0.1283, 2025: 0.1283 }, JPY: { 2000: 0.0093, 2010: 0.0114, 2015: 0.0083, 2020: 0.0094, 2023: 0.0071, 2024: 0.0066, 2025: 0.0067 }, CNY: { 2005: 0.122, 2010: 0.148, 2015: 0.161, 2020: 0.145, 2023: 0.141, 2025: 0.139 } };
const near = (tab, y) => { const ks = Object.keys(tab).map(Number).sort((a, b) => a - b); if (!ks.length) return null; if (y <= ks[0]) return tab[ks[0]]; if (y >= ks[ks.length - 1]) return tab[ks[ks.length - 1]];
  for (let i = 1; i < ks.length; i++) if (y <= ks[i]) { const a = ks[i - 1], b = ks[i]; return tab[a] + (tab[b] - tab[a]) * (y - a) / (b - a); } return null; };
const fxOf = (cur, y) => { const t = FX[String(cur || 'USD').toUpperCase()]; return t ? near(t, y) : null; };
const cpiNow = () => CPI[Math.max(...Object.keys(CPI).map(Number))];
const real = (usd, y) => Math.round(usd * cpiNow() / (near(CPI, y) || cpiNow()));
const MCLASS = ['painting', 'paper', 'print', 'photograph', 'sculpture', 'other'];
const mclassOf = s => { s = String(s || '').toLowerCase(); if (MCLASS.includes(s)) return s;
  if (/oil|acrylic|tempera|canvas|panel|board|painting/.test(s) && !/paper/.test(s)) return 'painting';
  if (/lithograph|etching|screenprint|woodcut|engraving|aquatint|print/.test(s)) return 'print';
  if (/photograph|gelatin|chromogenic|pigment print|albumen|platinum/.test(s)) return 'photograph';
  if (/bronze|marble|wood carving|sculpture|steel|cast/.test(s)) return 'sculpture';
  if (/paper|gouache|watercolou?r|pastel|charcoal|pencil|graphite|ink|drawing|crayon/.test(s)) return 'paper'; return 'other'; };
// The buyer's premium, tiers as "pct:up to cents,…,pct" (the last above). Set to each house's published schedule.
const DEFAULT_PREMIUM = process.env.BUYERS_PREMIUM || '27:100000000,22:450000000,15';
const tiersOf = s => String(s || DEFAULT_PREMIUM).split(',').map(x => { const [p, cap] = x.split(':'); return { pct: Number(p), cap: cap ? Number(cap) : Infinity }; });
function premium(hammer, tiers) { let left = hammer, prev = 0, p = 0; for (const t of tiers) { const span = Math.min(left, t.cap - prev); if (span <= 0) { prev = t.cap; continue; } p += span * t.pct / 100; left -= span; prev = t.cap; if (left <= 0) break; } return Math.round(p); }
// The highest hammer so that hammer + premium <= price.
function ceiling(price, tiers) { let lo = 0, hi = price; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (m + premium(m, tiers) > price) hi = m; else lo = m; } return Math.floor(lo); }

// Ridge regression: (X'X + λI) b = X'y, solved by elimination.
function ridge(X, y, lambda = 1) {
  const k = X[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < X.length; r++) for (let i = 0; i < k; i++) { A[i][k] += X[r][i] * y[r]; for (let j = 0; j < k; j++) A[i][j] += X[r][i] * X[r][j]; }
  for (let i = 1; i < k; i++) A[i][i] += lambda; // the intercept is not shrunk
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; const d = A[c][c] || 1e-9;
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / d; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; } }
  return A.map((row, i) => row[k] / (row[i] || 1e-9));
}
const feats = (r, ref) => [1, Math.log(Math.max(1, (r.h_cm || ref.h) * (r.w_cm || ref.w))), ...MCLASS.slice(1).map(m => (r.mclass === m ? 1 : 0)), ((r.sale_year || ref.year) - 2015) / 10,
  ((r.made_year || ref.made) - ref.made) / 10, Math.log1p(r.prov_n || 0), Math.log1p(r.exh_n || 0), Math.log1p(r.lit_n || 0), r.signed ? 1 : 0];

const ncdf = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
// Where a price sits against the market for that lot: the share of comparable sales it would beat.
function versus(e, cents) { if (!e || !e.ok || !cents) return null; const z = (Math.log(cents) - Math.log(e.likely)) / e.sd; const pct = Math.round(ncdf(z) * 100), off = Math.round((cents / e.likely - 1) * 100);
  return { z, pct, off, word: z < -0.674 ? 'below market' : z > 0.674 ? 'above market' : 'at market' }; }
function estimate(rows, lot) {
  const sold = rows.filter(r => r.sold && r.usd_real > 0);
  if (sold.length < 3) return { ok: false, why: sold.length ? `Only ${sold.length} sale${sold.length === 1 ? '' : 's'} of this artist in the book; three at least.` : 'No sales of this artist in the book yet.', n: sold.length };
  const med = a => { const s = a.filter(v => v != null && !isNaN(v)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const ref = { h: med(sold.map(r => r.h_cm)) || 60, w: med(sold.map(r => r.w_cm)) || 50, made: med(sold.map(r => r.made_year)) || 1950, year: new Date().getFullYear() };
  const L = { ...lot, sale_year: lot.sale_year || new Date().getFullYear(), mclass: mclassOf(lot.mclass || lot.medium) };
  const area = r => Math.max(1, (r.h_cm || ref.h) * (r.w_cm || ref.w));
  const dist = r => Math.abs(Math.log(area(r)) - Math.log(area(L))) + (r.mclass === L.mclass ? 0 : 1.2) + Math.abs((r.made_year || ref.made) - (L.made_year || ref.made)) / 15 + Math.abs((r.sale_year || ref.year) - L.sale_year) / 12;
  const comps = sold.map(r => ({ r, d: dist(r) })).sort((a, b) => a.d - b.d).slice(0, 8);
  let pred, sd, how;
  if (sold.length >= 12) {
    const X = sold.map(r => feats(r, ref)), y = sold.map(r => Math.log(r.usd_real)), b = ridge(X, y, 1.5);
    const fit = X.map(x => x.reduce((s, v, i) => s + v * b[i], 0)), res = y.map((v, i) => v - fit[i]);
    sd = Math.sqrt(res.reduce((s, v) => s + v * v, 0) / Math.max(1, res.length - b.length)); pred = feats(L, ref).reduce((s, v, i) => s + v * b[i], 0); how = 'model';
  } else {
    // The nearest comparables, each scaled to this lot's size by the square root of the area (a size twice as large
    // sells for about 1.4 times), weighted by nearness.
    const ws = comps.map(c => 1 / (0.3 + c.d)), vs = comps.map(c => Math.log(c.r.usd_real) + 0.5 * (Math.log(area(L)) - Math.log(area(c.r))));
    pred = vs.reduce((s, v, i) => s + v * ws[i], 0) / ws.reduce((a, b) => a + b, 0);
    const all = sold.map(r => Math.log(r.usd_real)), mean = all.reduce((a, b) => a + b, 0) / all.length; sd = Math.max(0.35, Math.sqrt(all.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, all.length - 1)) * 0.8); how = 'comparables';
  }
  sd = Math.min(Math.max(sd, 0.18), 1.5);
  const likely = Math.round(Math.exp(pred)), low = Math.round(Math.exp(pred - 0.674 * sd)), high = Math.round(Math.exp(pred + 0.674 * sd));
  const sure = sold.length >= 30 && sd < 0.45 ? 'high' : sold.length >= 12 && sd < 0.7 ? 'fair' : 'low';
  return { ok: true, how, n: sold.length, sd, likely, low, high, sure, comps: comps.map(c => c.r) };
}

function mountPricebook(app, { db, V, studioOnly }) {
  const esc = V.esc, money = c => (c == null ? '' : '$' + Math.round(c / 100).toLocaleString('en-US'));
  db.exec(`CREATE TABLE IF NOT EXISTS auction_results (id INTEGER PRIMARY KEY, artist_id INTEGER, artist_name TEXT NOT NULL, title TEXT, made_year INTEGER, medium TEXT, mclass TEXT, h_cm REAL, w_cm REAL,
    sale_date TEXT, sale_year INTEGER, house TEXT, sale TEXT, lot TEXT, currency TEXT NOT NULL DEFAULT 'USD', fx REAL, est_low INTEGER, est_high INTEGER, hammer INTEGER, premium_price INTEGER,
    usd INTEGER, usd_real INTEGER, sold INTEGER NOT NULL DEFAULT 1, prov_n INTEGER NOT NULL DEFAULT 0, exh_n INTEGER NOT NULL DEFAULT 0, lit_n INTEGER NOT NULL DEFAULT 0, signed INTEGER NOT NULL DEFAULT 0,
    source TEXT, source_kind TEXT NOT NULL DEFAULT 'hand', object_id INTEGER, note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS auction_artist ON auction_results(artist_id)`);
  const A = () => app.locals.art;
  const cents = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };
  const int = v => { const n = parseInt(String(v || '').replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n : null; };
  const real1 = v => { const n = Number(String(v || '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
  // One result in: the artist matched to the hall, the price to dollars and to today's dollars.
  function add(b, kind = 'hand') {
    const name = String(b.artist || b.artist_name || '').trim(); if (!name) throw new Error('the artist');
    const a = A() && A().ensure ? A().ensure(name) : null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.sale_date || '')) ? b.sale_date : (/^\d{4}$/.test(String(b.sale_date || '')) ? `${b.sale_date}-06-30` : null);
    const year = date ? Number(date.slice(0, 4)) : int(b.sale_year); if (!year) throw new Error('the sale date');
    const cur = String(b.currency || 'USD').toUpperCase().slice(0, 3), fx = real1(b.fx) || fxOf(cur, year); if (!fx) throw new Error(`no rate for ${cur}; give fx`);
    const hammer = cents(b.hammer), full = cents(b.premium_price) || (hammer ? hammer + premium(hammer, tiersOf()) : null);
    const sold = String(b.sold == null ? '1' : b.sold).toLowerCase(); const isSold = !/^(0|no|false|bought in|unsold|passed|withdrawn)$/.test(sold) && !!full;
    const usd = full ? Math.round(full * fx) : null;
    let h = real1(b.h_cm), w = real1(b.w_cm);
    if ((!h || !w) && b.dims && app.locals.registry && app.locals.registry.cmOf) { const c = app.locals.registry.cmOf(b.dims); if (c) { h = h || c.h; w = w || c.w; } }
    const row = { artist_id: a ? a.id : null, artist_name: a ? a.name : name, title: String(b.title || '').slice(0, 300) || null, made_year: int(b.made_year), medium: String(b.medium || '').slice(0, 300) || null, mclass: mclassOf(b.mclass || b.medium),
      h_cm: h, w_cm: w, sale_date: date, sale_year: year, house: String(b.house || '').slice(0, 120) || null, sale: String(b.sale || '').slice(0, 200) || null, lot: String(b.lot || '').slice(0, 40) || null, currency: cur, fx,
      est_low: cents(b.est_low), est_high: cents(b.est_high), hammer, premium_price: full, usd, usd_real: usd ? real(usd, year) : null, sold: isSold ? 1 : 0, prov_n: int(b.prov_n) || 0, exh_n: int(b.exh_n) || 0, lit_n: int(b.lit_n) || 0,
      signed: /^(1|y|yes|true|signed)$/i.test(String(b.signed || '')) ? 1 : 0, source: String(b.source || '').slice(0, 500) || null, source_kind: kind, object_id: int(b.object_id), note: String(b.note || '').slice(0, 1000) || null };
    const ks = Object.keys(row); return db.prepare(`INSERT INTO auction_results (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`).run(...ks.map(k => row[k])).lastInsertRowid;
  }
  const rowsOf = artistId => db.prepare('SELECT * FROM auction_results WHERE artist_id=? ORDER BY sale_date, id').all(artistId);
  function ask(lot) {
    const a = lot.artist_id ? db.prepare('SELECT * FROM artists WHERE id=?').get(lot.artist_id) : (lot.artist && A() ? A().ensure(lot.artist) : null);
    if (!a) return { ok: false, why: 'Name the artist.' };
    const e = estimate(rowsOf(a.id), lot); if (!e.ok) return { ...e, artist: a };
    const tiers = tiersOf(lot.premium || null);
    const price = lot.price ? Math.round(Number(String(lot.price).replace(/[^0-9.]/g, '')) * 100) : null;
    return { ...e, artist: a, ceiling: { likely: ceiling(e.likely, tiers), low: ceiling(e.low, tiers) }, premium: lot.premium || DEFAULT_PREMIUM, versus: price ? { price, ...versus(e, price) } : null };
  }
  // Each sold result judged against the artist's other sales (left out of its own model).
  function judged(list) { const by = new Map(); return list.map(r => { if (!r.sold || !r.usd_real || !r.artist_id) return r; if (!by.has(r.artist_id)) by.set(r.artist_id, rowsOf(r.artist_id));
    const rest = by.get(r.artist_id).filter(x => x.id !== r.id); const e = estimate(rest, r); return { ...r, vs: e.ok ? versus(e, r.usd_real) : null }; }); }
  const MED = { painting: 'Painting', paper: 'Work on paper', print: 'Print', photograph: 'Photograph', sculpture: 'Sculpture', other: 'Other' };
  const row = r => `<tr><td>${esc(r.sale_date || '')}</td><td>${esc(r.artist_name)}</td><td>${esc(r.title || '')}${r.made_year ? `, ${r.made_year}` : ''}</td><td>${esc(MED[r.mclass] || '')}${r.h_cm && r.w_cm ? ` · ${Math.round(r.h_cm)}×${Math.round(r.w_cm)} cm` : ''}</td><td>${esc([r.house, r.lot ? `lot ${r.lot}` : ''].filter(Boolean).join(', '))}</td><td>${r.est_low ? `${esc(r.currency)} ${(r.est_low / 100).toLocaleString()}–${((r.est_high || r.est_low) / 100).toLocaleString()}` : ''}</td><td>${r.sold ? `<b>${money(r.usd)}</b>${r.usd_real !== r.usd ? ` <small>${money(r.usd_real)} today</small>` : ''}${r.vs ? ` <span class="pbk-v pbk-${r.vs.word.split(' ')[0]}">${r.vs.off >= 0 ? '+' : ''}${r.vs.off}%</span>` : ''}` : '<i>bought in</i>'}</td><td>${r.prov_n || r.exh_n || r.lit_n ? `${r.prov_n}/${r.exh_n}/${r.lit_n}` : ''}</td></tr>`;
  const FIELDS = `<label>Artist<input name="artist" required></label><label>Title<input name="title"></label><label>Year made<input name="made_year" inputmode="numeric"></label><label>Medium<input name="medium" placeholder="Oil on canvas"></label>
<label>Height cm<input name="h_cm" inputmode="decimal"></label><label>Width cm<input name="w_cm" inputmode="decimal"></label><label>Or the dimensions as printed<input name="dims" placeholder="24 x 18 1/2 in."></label>`;
  const page = (body, title) => V.layout({ studio: true, title: `${title} · The price book · Watermark`, path: '/studio/pricebook', body: `<section class="studio-wrap hd pbk">${require('./studio-views').nav('/studio/pricebook')}${body}
<p class="note">Private to the Studio: the house's working tool, never shown to the public, never an appraisal. Prices to dollars at annual average rates, to today's dollars by the consumer price index; both approximate.</p></section>` });

  app.get('/studio/pricebook', studioOnly, (req, res) => {
    const n = db.prepare('SELECT COUNT(*) n, SUM(sold) s, COUNT(DISTINCT artist_id) a FROM auction_results').get();
    const q = String(req.query.q || '').trim();
    const list = q ? db.prepare('SELECT * FROM auction_results WHERE lower(artist_name) LIKE ? OR lower(title) LIKE ? ORDER BY sale_date DESC, id DESC LIMIT 200').all(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`) : db.prepare('SELECT * FROM auction_results ORDER BY id DESC LIMIT 60').all();
    const top = db.prepare('SELECT artist_id, artist_name, COUNT(*) n, SUM(sold) s, MAX(usd) hi FROM auction_results GROUP BY artist_id, artist_name ORDER BY COUNT(*) DESC LIMIT 30').all();
    res.send(page(`<p class="k">The house · Private</p><h1>The price book.</h1>
<p class="lede">Every auction result the house keeps, and for any lot, what it should sell for and the most to bid. ${n.n.toLocaleString()} results (${(n.s || 0).toLocaleString()} sold) across ${n.a} artists.</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<p><a class="buy-btn" href="/studio/pricebook/ask">What should it sell for?</a></p>
${top.length ? `<section class="hd-list"><div class="hd-h"><h2>By artist</h2></div><p>${top.map(t => `<a href="/studio/pricebook/ask?artist_id=${t.artist_id}">${esc(t.artist_name)}</a> ${t.s}/${t.n}`).join(' · ')}</p></section>` : ''}
<section class="hd-list"><div class="hd-h"><h2>Add a result</h2></div><form method="post" action="/studio/pricebook/add" class="form pbk-f">${FIELDS}
<label>Sale date<input name="sale_date" type="date" required></label><label>House<input name="house" placeholder="Christie's New York"></label><label>Sale<input name="sale"></label><label>Lot<input name="lot"></label>
<label>Currency<select name="currency">${['USD', 'GBP', 'EUR', 'CHF', 'HKD', 'CNY', 'JPY'].map(c => `<option>${c}</option>`).join('')}</select></label><label>Estimate low<input name="est_low"></label><label>Estimate high<input name="est_high"></label>
<label>Hammer<input name="hammer"></label><label>Price with premium<input name="premium_price"></label><label>Sold<select name="sold"><option value="1">Sold</option><option value="0">Bought in</option></select></label>
<label>Provenance lines<input name="prov_n" inputmode="numeric"></label><label>Exhibitions<input name="exh_n" inputmode="numeric"></label><label>Literature<input name="lit_n" inputmode="numeric"></label><label><input type="checkbox" name="signed" value="1"> Signed</label>
<label>Source (the catalogue or the results page)<input name="source"></label><button>Keep it</button></form></section>
<section class="hd-list"><div class="hd-h"><h2>Bring in a spreadsheet</h2></div><form method="post" action="/studio/pricebook/import" class="form"><p class="note">CSV with a header: artist, title, made_year, medium, h_cm, w_cm (or dims), sale_date, house, sale, lot, currency, est_low, est_high, hammer, premium_price, sold, prov_n, exh_n, lit_n, signed, source, fx. From your own records or a licensed export; never scraped.</p><textarea name="csv" rows="6" required></textarea><button>Bring them in</button></form></section>
<section class="hd-list"><div class="hd-h"><h2>${q ? `Results for “${esc(q)}”` : 'Lately kept'}</h2><form method="get" class="inline"><input name="q" value="${esc(q)}" placeholder="Artist or title"><button class="link">Find</button></form></div>
${list.length ? `<table class="tbl pbk-t"><tr><th>Sold</th><th>Artist</th><th>Work</th><th>What</th><th>Where</th><th>Estimate</th><th>Price · vs market</th><th>P/E/L</th></tr>${judged(list).map(row).join('')}</table>` : '<p class="hd-calm">Nothing yet.</p>'}</section>`, 'The price book'));
  });
  app.post('/studio/pricebook/add', studioOnly, (req, res) => {
    try { add(req.body || {}); res.redirect('/studio/pricebook?ok=' + encodeURIComponent('Kept.')); } catch (e) { res.redirect('/studio/pricebook?ok=' + encodeURIComponent('Not kept: ' + e.message)); }
  });
  app.post('/studio/pricebook/import', studioOnly, (req, res) => {
    const F = app.locals.feeds; const rows = F && F.parseCSV ? F.parseCSV(String((req.body || {}).csv || '')) : [];
    let ok = 0; const bad = [];
    const head = rows.length ? rows[0].map(h => String(h).trim().toLowerCase()) : [];
    for (const r of rows.slice(1)) { const b = {}; head.forEach((h, i) => { b[h] = r[i]; }); try { add(b, 'import'); ok++; } catch (e) { bad.push(e.message); } }
    res.redirect('/studio/pricebook?ok=' + encodeURIComponent(`${ok} kept${bad.length ? `; ${bad.length} not (${[...new Set(bad)].slice(0, 3).join('; ')})` : ''}.`));
  });
  app.get('/studio/pricebook/ask', studioOnly, (req, res) => {
    const b = req.query || {}; let lot = { ...b };
    const RG = app.locals.registry;
    if (b.object && RG) { const o = db.prepare('SELECT * FROM objects WHERE id=?').get(Number(b.object)); if (o) { const c = RG.cmOf ? RG.cmOf(o.dims) : null; let cm = null; try { cm = o.cm ? JSON.parse(o.cm) : null; } catch (e) { /* */ }
      const ev = RG.standing ? RG.standing(RG.events(o)) : [];
      lot = { artist_id: o.artist_id, artist: o.artist, title: o.title, made_year: o.made_year, medium: o.medium, h_cm: (cm && cm.h) || (c && c.h), w_cm: (cm && cm.w) || (c && c.w),
        prov_n: ev.filter(e => e.kind === 'provenance' || e.kind === 'acquired').length, exh_n: ev.filter(e => e.kind === 'exhibited').length, lit_n: ev.filter(e => e.kind === 'published').length, ...b }; } }
    if ((!lot.h_cm || !lot.w_cm) && lot.dims && RG && RG.cmOf) { const c = RG.cmOf(lot.dims); if (c) { lot.h_cm = c.h; lot.w_cm = c.w; } }
    ['made_year', 'h_cm', 'w_cm', 'prov_n', 'exh_n', 'lit_n', 'artist_id', 'sale_year'].forEach(k => { if (lot[k] != null && lot[k] !== '') lot[k] = Number(lot[k]); else delete lot[k]; });
    lot.signed = /^(1|yes|on)$/.test(String(lot.signed || '')) ? 1 : 0;
    const asked = lot.artist || lot.artist_id; const e = asked ? ask(lot) : null;
    const v = k => esc(lot[k] == null ? '' : lot[k]);
    const fields = `<label>Artist<input name="artist" value="${esc(e && e.artist ? e.artist.name : lot.artist || '')}" required></label><label>Title<input name="title" value="${v('title')}"></label><label>Year made<input name="made_year" value="${v('made_year')}"></label>
<label>Medium<input name="medium" value="${v('medium')}" placeholder="Oil on canvas"></label><label>Height cm<input name="h_cm" value="${v('h_cm')}"></label><label>Width cm<input name="w_cm" value="${v('w_cm')}"></label><label>Or as printed<input name="dims" value="${v('dims')}"></label>
<label>Provenance lines<input name="prov_n" value="${v('prov_n')}"></label><label>Exhibitions<input name="exh_n" value="${v('exh_n')}"></label><label>Literature<input name="lit_n" value="${v('lit_n')}"></label><label><input type="checkbox" name="signed" value="1"${lot.signed ? ' checked' : ''}> Signed</label>
<label>A price to judge (an asking price or an estimate, USD)<input name="price" value="${v('price')}"></label><label>The house's premium (pct:up to cents,…)<input name="premium" value="${esc(lot.premium || DEFAULT_PREMIUM)}"></label>${lot.object ? `<input type="hidden" name="object" value="${esc(lot.object)}">` : ''}`;
    const SURE = { high: 'High: many sales, a tight fit', fair: 'Fair: enough sales, a looser fit', low: 'Low: few sales or a wide spread' };
    const out = !e ? '' : !e.ok ? `<p class="note">${esc(e.why)} <a href="/studio/pricebook">Add results</a>.</p>` : `<section class="pbk-a">
<p class="k">${esc(e.artist.name)} · from ${e.n} sale${e.n === 1 ? '' : 's'}, by ${e.how === 'model' ? 'the artist’s own model' : 'the nearest comparables'}</p>
<div class="pbk-r"><div><small>Low</small><b>${money(e.low)}</b></div><div class="pbk-lk"><small>Likely</small><b>${money(e.likely)}</b></div><div><small>High</small><b>${money(e.high)}</b></div></div>
${e.versus ? `<p class="pbk-v pbk-${e.versus.word.split(' ')[0]}">${money(e.versus.price)} is <b>${esc(e.versus.word)}</b>: ${e.versus.off >= 0 ? '+' : ''}${e.versus.off}% against the likely price; it would beat ${e.versus.pct}% of sales like it.</p>` : ''}
<p class="pbk-c">Your ceiling: bid up to a hammer of <b>${money(e.ceiling.likely)}</b> to pay the likely price with the premium; <b>${money(e.ceiling.low)}</b> to buy at the low.</p>
<p class="note">How sure: ${SURE[e.sure]} (spread ${(e.sd).toFixed(2)} in the log of the price). The range is the middle half of where a sale like this lands.</p>
<h2>The sales it rests on</h2><table class="tbl pbk-t"><tr><th>Sold</th><th>Artist</th><th>Work</th><th>What</th><th>Where</th><th>Estimate</th><th>Price</th><th>P/E/L</th></tr>${e.comps.map(row).join('')}</table></section>`;
    res.send(page(`<p class="k"><a href="/studio/pricebook">The price book</a></p><h1>What should it sell for?</h1>${out}
<form method="get" class="form pbk-f">${fields}<button>Ask the book</button></form>`, 'What should it sell for'));
  });
  app.locals.pricebook = { add, ask, versus, estimate, premium, ceiling, tiersOf, fxOf, real, mclassOf, rowsOf };
}

module.exports = { mountPricebook, versus, estimate, premium, ceiling, tiersOf, fxOf, real, mclassOf, ridge };
