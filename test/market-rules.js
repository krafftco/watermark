// The house keeps the trade's rules (#165, docs/MARKET.md). Each rule, by the maker and by the Studio:
//   1. an edition with a sale is never enlarged (print editions and works.edition_size), and can come down to what is sold;
//      the register records the change of size, from and to;
//   2. a print edition's price and framed price with a sale may stay or rise, never fall;
//   3. no public tape: a stranger sees what is offered and its asking price, never a past sale price, a total, a volume,
//      a chart or a value; the holder sees their own, the maker their work's, the Studio all;
//   4. a piece inside the holding time cannot be offered (nor an offer for it accepted), is told when it can be; a gift
//      is not a sale and is not held; a trade starts the clock again; the Studio lifts it for one piece with a reason
//      that goes on the register.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-mrules-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'mrules', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const page = async (jar, p) => (await go(jar, p)).text();
  const signin = async (jar, email) => { app.locals.lastCode = null; await form(jar, '/signin/code', { email }); await form(jar, '/signin/verify', { email, code: app.locals.lastCode.code }); };
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const put = async (title, makerId) => { const f = path.join(dir, `m-${++k}.jpg`); fs.writeFileSync(f, await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: (k * 61) % 255, g: (k * 37) % 255, b: (k * 89) % 255 } } }).composite([{ input: await sharp(fx).resize(300 + k * 40).toBuffer(), left: k * 50, top: k * 30 }]).jpeg().toBuffer()); const w = await app.locals.registerWork({ file: f, title, makerId, originalName: path.basename(f) }); db.prepare("UPDATE works SET status='held' WHERE slug=?").run(w.slug); return db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug); };
  const reg = (type, subject) => db.prepare('SELECT data FROM ledger WHERE type=? AND subject=? ORDER BY seq DESC LIMIT 1').get(type, subject);

  // A maker with a studio of their own, signed in; the uses copied from the house's.
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door, email_ok) VALUES ('ruth-orkin', 'Ruth Orkin', 'ruth@example.com', 'maker', datetime('now'), 'house', 1)").run();
  const ruth = db.prepare("SELECT * FROM makers WHERE handle='ruth-orkin'").get();
  const house = db.prepare("SELECT maker_id FROM uses WHERE key='social' ORDER BY id LIMIT 1").get().maker_id;
  if (!db.prepare('SELECT 1 FROM uses WHERE maker_id=?').get(ruth.id)) for (const u of db.prepare('SELECT key, name, description, term_months, kind, sort, price_cents FROM uses WHERE maker_id=?').all(house)) db.prepare('INSERT INTO uses (maker_id,key,name,description,term_months,kind,sort,price_cents) VALUES (?,?,?,?,?,?,?,?)').run(ruth.id, u.key, u.name, u.description, u.term_months, u.kind, u.sort, u.price_cents);
  const maker = {}; await signin(maker, 'ruth@example.com');
  assert.equal(app.locals.accounts.makerOf({ cookies: maker, query: {} }).id, ruth.id, 'the maker is signed in');
  const social = db.prepare("SELECT id FROM uses WHERE maker_id=? AND key='social'").get(ruth.id).id;
  let n = 0; const sell = (w, no, cents, at, buyer = null) => { const ref = `WM-2026-8${String(++n).padStart(5, '0')}`; db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, price_cents, status, starts_at, collector_no, buyer_id, download_token, rights) VALUES (?,?,?,?,?,?, 'active', ?, ?, ?, ?, ?)").run(ref, w.id, social, 'A', 'a@example.com', cents, at, no, buyer, 'tok' + n, JSON.stringify({ transferable: true })); return db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref); };

  // ---- 1 and 2: the print editions -------------------------------------------------------------------------
  const wp = await put('American Girl in Italy', ruth.id);
  let r = await form(studio, `/studio/works/${wp.slug}/editions`, { open: '1' }); assert.equal(r.status, 302);
  const [e0, e1] = db.prepare('SELECT * FROM print_editions WHERE work_id=? ORDER BY sort').all(wp.id); assert.equal(e0.edition_n, 12);
  const pl = sell(wp, null, 25000, '2026-11-01 12:00:00');
  db.prepare("INSERT INTO print_orders (license_id, kind, size, cents, paid, status, edition_id, edition_no, work_id) VALUES (?, 'edition', '11 × 14 in', 25000, 1, 'asked', ?, 1, ?)").run(pl.id, e0.id, wp.id);
  const ed = id => db.prepare('SELECT edition_n, price_cents, framed_cents FROM print_editions WHERE id=?').get(id);
  const row = (e, o) => ({ id: String(e.id), label: e.label, long_in: String(e.long_in), paper: e.paper, edition_n: String(e.edition_n), price: String(e.price_cents / 100), framed: String(e.framed_cents / 100), active: '1', ...o });
  r = await form(maker, `/account/works/${wp.slug}/editions`, row(e0, { edition_n: '20' }));
  assert.equal(ed(e0.id).edition_n, 12, 'the maker cannot enlarge an edition with a sale'); assert.ok(r.headers.get('location').includes('ok=editionheld'), 'and is told');
  await form(studio, `/studio/works/${wp.slug}/editions`, row(e0, { edition_n: '15' })); assert.equal(ed(e0.id).edition_n, 12, 'nor can the Studio');
  await form(maker, `/account/works/${wp.slug}/editions`, row(e0, { edition_n: '5' })); assert.equal(ed(e0.id).edition_n, 5, 'it can be made smaller');
  let d = JSON.parse(reg('work.editions', wp.slug).data); assert.deepStrictEqual([d.from, d.to, d.edition], [12, 5, '11 × 14'], 'the register records the change of size: ' + JSON.stringify(d));
  await form(studio, `/studio/works/${wp.slug}/editions`, row(e0, { edition_n: '1' })); assert.equal(ed(e0.id).edition_n, 1, 'down to what is sold');
  await form(maker, `/account/works/${wp.slug}/editions`, row(e0, { edition_n: '3' })); assert.equal(ed(e0.id).edition_n, 1, 'and never up again');
  await form(maker, `/account/works/${wp.slug}/editions`, row(e0, { edition_n: '1', price: '200' })); assert.equal(ed(e0.id).price_cents, 25000, 'a price with a sale is not lowered by the maker');
  await form(studio, `/studio/works/${wp.slug}/editions`, row(e0, { edition_n: '1', price: '200', framed: '100' })); assert.deepStrictEqual([ed(e0.id).price_cents, ed(e0.id).framed_cents], [25000, 15000], 'nor by the Studio, nor its framed price');
  await form(maker, `/account/works/${wp.slug}/editions`, row(e0, { edition_n: '1', price: '300', framed: '' })); assert.deepStrictEqual([ed(e0.id).price_cents, ed(e0.id).framed_cents], [30000, 15000], 'it may rise; the framed price is not taken away');
  await form(maker, `/account/works/${wp.slug}/editions`, row(e1, { edition_n: '20', price: '500' })); assert.deepStrictEqual([ed(e1.id).edition_n, ed(e1.id).price_cents], [20, 50000], 'a size with no sale is the maker\'s to change');
  let t = await page(maker, `/account/works/${wp.slug}`); assert.ok(t.includes('never larger; its price and its framed price can stay or rise, never fall'), 'the form says so');
  console.log('ok: print editions keep their size and their price');

  // ---- 1: works.edition_size, from the catalogue form and from the Studio's editions ----------------------------------
  const ws = await put('The Cigar', ruth.id); db.prepare('UPDATE works SET edition_size=10 WHERE id=?').run(ws.id);
  sell(ws, 1, 500, '2026-11-01 12:00:00'); sell(ws, 2, 500, '2026-11-02 12:00:00');
  const size = () => db.prepare('SELECT edition_size FROM works WHERE id=?').get(ws.id).edition_size;
  r = await form(maker, `/account/works/${ws.slug}/catalogue`, { title: 'The Cigar', edition: '20' }); assert.equal(size(), 10, 'the maker cannot enlarge it');
  assert.ok(decodeURIComponent(r.headers.get('location')).includes('never larger'), 'and is told in words');
  await form(maker, `/account/works/${ws.slug}/catalogue`, { title: 'The Cigar', edition: '' }); assert.equal(size(), 10, 'nor open it');
  await form(studio, `/studio/works/${ws.slug}/catalogue`, { title: 'The Cigar', edition: '30' }); assert.equal(size(), 10, 'nor can the Studio');
  await form(maker, `/account/works/${ws.slug}/catalogue`, { title: 'The Cigar', edition: '5' }); assert.equal(size(), 5, 'smaller');
  d = JSON.parse(reg('work.editions', ws.slug).data); assert.deepStrictEqual([d.from, d.to, d.by], [10, 5, 'ruth-orkin'], 'on the register, from and to');
  await form(studio, `/studio/works/${ws.slug}/catalogue`, { title: 'The Cigar', edition: '1' }); assert.equal(size(), 2, 'down to what is sold, no further');
  t = await page({}, '/ledger'); assert.ok(t.includes('was made smaller, to 5, from 10'), 'the register tells it');
  t = await page(studio, `/studio/works/${ws.slug}`); assert.ok(t.includes('Once one is collected, it can stay or be made smaller, never larger.'), 'the catalogue form says so');
  // The Studio's editions desk is the house's own maker's: a work of the house with a sale is held the same way.
  const wh = await put('The House Work', house); db.prepare('UPDATE works SET edition_size=4 WHERE id=?').run(wh.id); sell(wh, 1, 500, '2026-11-01 12:00:00');
  await form(studio, '/studio/editions', { [`on_${wh.id}`]: '1', [`size_${wh.id}`]: '50' });
  assert.equal(db.prepare('SELECT edition_size FROM works WHERE id=?').get(wh.id).edition_size, 4, 'the editions desk cannot enlarge it');
  await form(studio, '/studio/editions', { [`on_${wh.id}`]: '1', [`size_${wh.id}`]: '3' });
  assert.equal(db.prepare('SELECT edition_size FROM works WHERE id=?').get(wh.id).edition_size, 3, 'and can make it smaller');
  console.log('ok: an edition with a sale is never enlarged');

  // ---- 3: no public tape ----------------------------------------------------------------------------------------
  const holder = {}; await signin(holder, 'holder@example.com'); const hb = db.prepare("SELECT * FROM buyers WHERE email='holder@example.com'").get();
  const other = {}; await signin(other, 'other@example.com'); const ob = db.prepare("SELECT * FROM buyers WHERE email='other@example.com'").get();
  const wm = await put('Comic Book Readers', ruth.id); db.prepare('UPDATE works SET edition_size=10 WHERE id=?').run(wm.id);
  const old = "datetime('now','-400 days')";
  const l1 = sell(wm, 1, 4321, '2025-01-01 12:00:00', ob.id), l2 = sell(wm, 2, 5432, '2025-01-02 12:00:00', hb.id);
  db.prepare(`UPDATE licenses SET starts_at=${old} WHERE id IN (?,?)`).run(l1.id, l2.id);
  db.prepare("INSERT INTO trades (license_id, seller, price_cents, royalty_cents, fee_cents, at) VALUES (?, ?, 77700, 7770, 3885, datetime('now','-30 days'))").run(l1.id, ob.id);
  db.prepare("INSERT INTO listings (license_id, seller, ask_cents) VALUES (?,?,99900)").run(l2.id, hb.id); const lst = db.prepare('SELECT id FROM listings WHERE license_id=?').get(l2.id).id;
  const none = (txt, what, ...bad) => { for (const b of bad) assert.ok(!txt.includes(b), `${what}: a stranger must not see ${b}`); };
  // The stranger.
  t = await page({}, '/market'); assert.ok(t.includes('Comic Book Readers') && t.includes('$999'), 'a stranger sees what is offered and its asking price');
  none(t, '/market', '$777', 'traded in all', 'last traded', 'issued at', '$43.21', '$54.32', 'Traded</h2>');
  t = await page({}, `/market/${lst}`); assert.ok(t.includes('$999')); none(t, '/market/:id', '$777', 'Last traded', 'Issued at', '$54.32');
  t = await page({}, `/w/${wm.slug}`); assert.ok(t.includes('$999'), 'the work page shows the offer'); none(t, 'the work page', '$777', 'Last traded', 'The price record', '$43.21', '$54.32', 'placeholder="777"');
  t = await page({}, `/w/${wm.slug}/life`); assert.ok(t.includes('Traded between collectors') && t.includes('Passed on'), 'the life tells the trade'); none(t, 'the life', '$777', 'mk-chart', '$43.21');
  t = await page({}, '/prices'); assert.ok(t.includes('never published as a list'), 'the index says the record is kept'); none(t, '/prices', '$777', '$43.21', 'sales</span>', 'prc-bars');
  t = await page({}, '/prices/ruth-orkin'); none(t, '/prices/:handle', '$777', '$43.21', 'Comic Book Readers');
  t = await page({}, '/ledger'); none(t, 'the register', '$777');
  db.prepare("UPDATE buyers SET public=1, code=COALESCE(code,'hold3r') WHERE id=?").run(hb.id); const code = db.prepare('SELECT code FROM buyers WHERE id=?').get(hb.id).code;
  t = await page({}, `/collector/${code}`); assert.ok(t.includes('Comic Book Readers'), 'the collection is public'); none(t, 'a collection', '$777', '$54.32', 'tc-val', 'What it is worth', 'Value of your gallery');
  t = await page(other, `/collector/${code}`); none(t, 'another collector at a collection', '$777', '$54.32', 'tc-val');
  // Another collector of the same work, not the holder of No. 2, sees their own piece only.
  t = await page(other, `/w/${wm.slug}`); assert.ok(t.includes('The price record') && t.includes('$777') && t.includes('$43.21'), 'a holder sees their own piece: its sale and its resale'); none(t, 'a holder of another number', '$54.32');
  // The holder of No. 2.
  t = await page(holder, `/w/${wm.slug}`); assert.ok(t.includes('$54.32') && t.includes('Your own pieces only'), 'the holder sees what they paid'); none(t, 'the holder', '$777', '$43.21', 'Last traded');
  t = await page(holder, '/yours?tab=gallery'); assert.ok(/class="pf"|What it is worth|Paid \$54\.32/.test(t), 'the holder sees their own value');
  // The maker.
  t = await page(maker, `/w/${wm.slug}`); assert.ok(t.includes('Last traded at $777') && t.includes('The price record') && t.includes('$43.21') && t.includes('$54.32'), 'the maker sees their work\'s');
  t = await page(maker, `/w/${wm.slug}/life`); assert.ok(t.includes('$777') && t.includes('mk-chart'), 'and its life');
  t = await page(maker, '/prices/ruth-orkin'); assert.ok(t.includes('Comic Book Readers') && t.includes('$777'), 'and their own index');
  t = await page(maker, '/prices'); none(t, 'a maker at the house index', '$777', 'sales</span>');
  t = await page(maker, '/market'); assert.ok(t.includes('$777') && t.includes('of your work'), 'the maker sees their own trades on the market');
  // The Studio.
  t = await page(studio, '/market'); assert.ok(t.includes('$777') && t.includes('traded in all'), 'the Studio sees every trade and the total');
  t = await page(studio, `/w/${wm.slug}/life`); assert.ok(t.includes('$777') && t.includes('mk-chart'), 'and the life with its line');
  t = await page(studio, '/prices'); assert.ok(t.includes('$777') && t.includes('sales</span>'), 'and the house index');
  t = await page(studio, `/market/${lst}`); assert.ok(t.includes('Last traded') && t.includes('$777'), 'and the listing\'s history');
  console.log('ok: no public tape');

  // ---- 4: the holding time ---------------------------------------------------------------------------------------
  const l3 = sell(wm, 3, 500, null, hb.id); db.prepare("UPDATE licenses SET starts_at=datetime('now','-10 days') WHERE id=?").run(l3.id);
  const listings = id => db.prepare("SELECT COUNT(*) n FROM listings WHERE license_id=? AND status='open'").get(id).n;
  r = await form(holder, '/yours/offer', { ref: l3.ref, ask: '100' }); assert.ok(r.headers.get('location').includes('offer=held'), 'a piece inside the holding time cannot be listed: ' + r.headers.get('location')); assert.equal(listings(l3.id), 0);
  r = await form(holder, '/yours/offer', { ref: l3.ref, ask: '100', back: `/w/${wm.slug}` }); assert.ok(r.headers.get('location').includes('up=held'), 'nor from its page');
  const until = app.locals.market.holdOf(l3); assert.ok(until && Math.abs(until - (Date.now() + 355 * 864e5)) < 864e5, 'held 365 days from its sale: ' + until);
  const day = until.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  t = await page(holder, '/yours?tab=files'); assert.ok(t.includes(`It can be offered on the market from ${day}`), 'the holder is told when, in words');
  t = await page(holder, `/w/${wm.slug}?up=held`); assert.ok(t.includes(`It can be offered on the market from ${day}`) && t.includes('Not yet: the house holds a piece'), 'on the work page too');
  // An offer for it cannot be accepted (that would list it).
  db.prepare("INSERT INTO offers (license_id, name, email, offer_cents) VALUES (?, 'Someone', 's@example.com', 12000)").run(l3.id); const ofr = db.prepare('SELECT id FROM offers WHERE license_id=?').get(l3.id).id;
  r = await form(holder, `/yours/offers/${ofr}/accept`, {}); assert.ok(r.headers.get('location').includes('offer=held'), 'an offer for a held piece is not accepted'); assert.equal(listings(l3.id), 0);
  // A gift is not a sale and is not held.
  r = await form(holder, '/yours/give', { ref: l3.ref }); assert.ok(/give=/.test(r.headers.get('location') || ''), 'a held piece can still be given: ' + r.headers.get('location'));
  db.prepare('DELETE FROM transfers WHERE license_id=? AND claimed_at IS NULL').run(l3.id);
  const l4 = sell(wm, 4, 500, null, hb.id); db.prepare(`UPDATE licenses SET starts_at=${old} WHERE id=?`).run(l4.id);
  r = await form(holder, '/yours/give', { ref: l4.ref }); const gtok = decodeURIComponent(r.headers.get('location').match(/give=([^#&]+)/)[1]);
  const friend = {}; await go(friend, `/claim/${gtok}`); await form(friend, `/claim/${gtok}`, {});
  assert.ok(db.prepare('SELECT buyer_id FROM licenses WHERE id=?').get(l4.id).buyer_id !== hb.id, 'the gift was taken');
  r = await form(friend, '/yours/offer', { ref: l4.ref, ask: '100' }); assert.ok(r.headers.get('location').includes('offer=1'), 'a gift does not start the clock: ' + r.headers.get('location'));
  // A trade does: No. 1 was issued 400 days ago and traded 30 days ago.
  assert.ok(app.locals.market.holdOf(l1), 'a trade starts the holding time again');
  r = await form(other, '/yours/offer', { ref: l1.ref, ask: '900' }); assert.ok(r.headers.get('location').includes('offer=held'));
  // The Studio lifts it for one piece, with a reason, on the register.
  r = await form(studio, '/studio/market/hold', { ref: l3.ref, reason: '' }); assert.ok(decodeURIComponent(r.headers.get('location')).includes('A reason'), 'a reason is asked for'); assert.ok(app.locals.market.holdOf(l3), 'still held');
  t = await page(studio, '/studio/market'); assert.ok(t.includes('Lift it for this piece') && t.includes('The reason is written on the register'), 'the Studio\'s desk');
  r = await form(studio, '/studio/market/hold', { ref: l3.ref, reason: 'The estate of its collector is being settled' }); assert.equal(app.locals.market.holdOf(l3), null, 'lifted');
  d = JSON.parse(reg('market.hold_lifted', l3.ref).data); assert.equal(d.reason, 'The estate of its collector is being settled', 'the reason is on the register');
  t = await page({}, '/ledger'); assert.ok(t.includes('lifted the holding time') && t.includes('The estate of its collector is being settled'), 'and the register tells it');
  r = await form(holder, '/yours/offer', { ref: l3.ref, ask: '100' }); assert.ok(r.headers.get('location').includes('offer=1'), 'then it can be offered'); assert.equal(listings(l3.id), 1);
  await form(maker, '/studio/market/hold', { ref: l1.ref, reason: 'x' }); assert.ok(app.locals.market.holdOf(l1), 'only the Studio lifts it');
  // The time is a setting (MARKET_HOLD_DAYS, a draft).
  process.env.MARKET_HOLD_DAYS = '0'; assert.equal(app.locals.market.holdOf(l1), null, 'no holding time at 0'); process.env.MARKET_HOLD_DAYS = '20'; assert.equal(app.locals.market.holdOf(l1), null, '30 days ago is outside 20'); delete process.env.MARKET_HOLD_DAYS;
  console.log('ok: the holding time');

  srv.close(); fs.rmSync(dir, { recursive: true, force: true }); console.log('market rules: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
