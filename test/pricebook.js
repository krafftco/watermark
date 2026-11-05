// The price book (5 Nov): results kept, prices to today's dollars, an artist's own model, the comparables when few,
// the ceiling under the buyer's premium, above or below market; the Studio's alone.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { createApp } = require('../src/app');
const PB = require('../src/pricebook');
(async () => {
  const t = PB.tiersOf('25:100000000,20:400000000,15');
  assert.equal(PB.premium(100000000, t), 25000000, 'a quarter on the first million');
  assert.equal(PB.premium(200000000, t), 25000000 + 20000000, 'tiers add');
  const c = PB.ceiling(125000000, t); assert.ok(c <= 100000000 && c + PB.premium(c, t) <= 125000000 && c > 99990000, 'the ceiling: hammer plus premium stays at the price, ' + c);
  assert.ok(Math.abs(PB.fxOf('GBP', 2024) - 1.278) < 1e-6 && PB.fxOf('XYZ', 2020) === null, 'rates');
  assert.ok(PB.real(1000000, 2000) > 1800000, 'to today’s dollars');
  assert.equal(PB.mclassOf('Oil on canvas'), 'painting'); assert.equal(PB.mclassOf('Gouache on paper'), 'paper'); assert.equal(PB.mclassOf('Screenprint'), 'print');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-pb-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'pb', noTimers: true, vaultNow: true });
  const { db } = app.locals; const B = app.locals.pricebook; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c2 of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c2.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const studio = {}; await go(studio, '/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  // A painter whose price rises with size (square root of the area) and with provenance, in today's dollars.
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const truth = (h, w, prov) => 400000 * Math.sqrt(h * w / 3000) * (1 + 0.25 * prov);
  for (let i = 0; i < 40; i++) { const h = 30 + Math.round(rnd() * 120), w = 30 + Math.round(rnd() * 120), prov = Math.floor(rnd() * 4), y = 2025;
    const price = truth(h, w, prov) * Math.exp((rnd() - 0.5) * 0.3);
    B.add({ artist: 'Agnes Example', title: `Study ${i}`, made_year: 1960 + (i % 20), medium: 'Oil on canvas', h_cm: h, w_cm: w, sale_date: `${y}-05-1${i % 9}`, house: 'A House', currency: 'USD', premium_price: (price / 100).toFixed(2), prov_n: prov }); }
  const lot = { artist: 'Agnes Example', medium: 'Oil on canvas', h_cm: 100, w_cm: 80, made_year: 1968, prov_n: 2, sale_year: 2025 };
  const e = B.ask(lot), want = truth(100, 80, 2) * (B.real(100, 2025) / 100);
  assert.ok(e.ok && e.how === 'model' && e.n === 40, 'the artist’s own model: ' + JSON.stringify({ ok: e.ok, how: e.how, n: e.n, why: e.why }));
  assert.ok(Math.abs(e.likely / want - 1) < 0.25, `likely near the truth: ${e.likely} vs ${Math.round(want)}`);
  assert.ok(e.low < e.likely && e.likely < e.high && e.ceiling.likely < e.likely && e.comps.length === 8, 'a range, a ceiling under it, the sales it rests on');
  const cheap = PB.versus(e, Math.round(e.likely * 0.5)), dear = PB.versus(e, Math.round(e.likely * 1.8)), fair = PB.versus(e, e.likely);
  assert.ok(cheap.word === 'below market' && dear.word === 'above market' && fair.word === 'at market' && fair.pct === 50, 'above, at and below market');
  // few sales: the comparables; none: said so
  for (let i = 0; i < 5; i++) B.add({ artist: 'Ben Few', title: `P${i}`, medium: 'Gouache on paper', h_cm: 40 + i * 10, w_cm: 30 + i * 10, sale_date: '2024-11-0' + (i + 1), currency: 'GBP', hammer: String(20000 + i * 5000) });
  const f = B.ask({ artist: 'Ben Few', medium: 'Gouache on paper', h_cm: 60, w_cm: 50 }); assert.ok(f.ok && f.how === 'comparables' && f.sure === 'low', 'few sales: the comparables, low certainty');
  const gbp = db.prepare("SELECT * FROM auction_results WHERE artist_name='Ben Few' ORDER BY id LIMIT 1").get(); assert.ok(gbp.premium_price > gbp.hammer && gbp.usd > gbp.premium_price, 'premium added, pounds to dollars');
  assert.ok(!B.ask({ artist: 'Nobody Sold' }).ok, 'no sales: said so');
  // the pages: the Studio's alone; a spreadsheet in; the ask with a price judged
  assert.equal((await go({}, '/studio/pricebook')).status, 302, 'a stranger is sent away');
  let r = await go(studio, '/studio/pricebook/import', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csv: 'artist,title,medium,dims,sale_date,house,currency,hammer,sold\nCara Sheet,One,Oil on canvas,"24 x 18 in.",2023-03-01,B House,EUR,50000,1\nCara Sheet,Two,Oil on canvas,"30 x 20 in.",2023-03-01,B House,EUR,,0\n' }).toString() });
  assert.ok(decodeURIComponent(r.headers.get('location')).includes('2 kept'), 'the spreadsheet: ' + r.headers.get('location'));
  const cs = db.prepare("SELECT * FROM auction_results WHERE artist_name='Cara Sheet' ORDER BY id").all(); assert.ok(cs[0].h_cm > 60 && cs[0].sold === 1 && cs[1].sold === 0, 'size from the printed dimensions; a lot bought in');
  const page = await (await go(studio, `/studio/pricebook/ask?artist=Agnes+Example&medium=Oil+on+canvas&h_cm=100&w_cm=80&prov_n=2&price=${Math.round(e.likely / 200)}`)).text();
  assert.ok(page.includes('Your ceiling') && page.includes('below market') && page.includes('The sales it rests on'), 'the ask page, a price judged');
  const book = await (await go(studio, '/studio/pricebook?q=agnes')).text(); assert.ok(book.includes('vs market') && /pbk-(below|at|above)/.test(book), 'each result judged against the artist’s other sales');
  srv.close(); console.log('pricebook: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
