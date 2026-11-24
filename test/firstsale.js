// The first sale (#193): a photographer Will invites signs up from the letter, puts a master in, offers a print at their
// own price, and Will buys it. Two ways, each walked end to end through the house's own doors with Stripe stubbed:
//   - by hand: the print exists, signed, in the maker's hands (Roland at the store). Will pays on his phone, the maker is
//     told at once, the papers and the register entry are issued at payment, the maker keeps the print until the money
//     has reached them; the money clears on the week's hold from payment (never on the hand-over), Friday pay sends it,
//     the maker's desk says it went, and only then the maker marks it handed over;
//   - made and sent by the maker: the order lands on the maker's desk with the address and the number for the pencil
//     line; the money clears when it is marked sent; the collector is told at each step.
// Neither kind of print is ever offered to a print shop. With the house's share on the collector's side (render.yaml's
// FEE_SIDE=collector), the maker's $300 reaches them whole: the collector pays $360.
process.env.NODE_ENV = 'test';
process.env.FEE_SIDE = process.env.FEE_SIDE || 'collector';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp'); const crypto = require('crypto');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-firstsale-'));
  const stripeClient = require('stripe')('sk_test_dummy'); const sessions = {}; const transfers = []; const accounts = {};
  stripeClient.checkout.sessions.create = async o => { const id = 'cs_' + Object.keys(sessions).length; sessions[id] = { id, ...o, url: 'https://checkout.stripe.test/' + id, payment_status: 'unpaid' }; return sessions[id]; };
  stripeClient.checkout.sessions.retrieve = async id => sessions[id];
  stripeClient.accounts.create = async o => { const id = 'acct_' + (Object.keys(accounts).length + 1); accounts[id] = { id, ...o, payouts_enabled: false }; return accounts[id]; };
  stripeClient.accounts.retrieve = async id => accounts[id];
  stripeClient.accountLinks.create = async o => ({ url: `https://connect.stripe.test/${o.account}` });
  stripeClient.transfers.create = async (o, opt) => { const t = { id: 'tr_' + (transfers.length + 1), ...o, key: opt && opt.idempotencyKey }; transfers.push(t); return t; };
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'firstsale', stripeKey: 'sk_test_dummy', stripePk: 'pk_test_dummy', stripeClient, webhookSecret: 'whsec_test', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const page = async (jar, p) => { const r = await go(jar, p); assert.equal(r.status, 200, `${p} answers 200, not ${r.status} ${r.headers.get('location') || ''}`); return r.text(); };
  const text = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&times;/g, '×').replace(/\s+/g, ' ');
  const settle = () => new Promise(r => setTimeout(r, 60));
  const say = (...a) => console.log('firstsale:', ...a);
  const letters = to => (app.locals.mailLog || []).filter(m => m.to === to);

  // ---- 1. Will invites Roland; Roland opens the letter's link on his phone and lands in his vault ---------------------
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  let r = await form(studio, '/studio/accounts', { name: 'Roland Avery', email: 'roland@example.com' }); assert.equal(r.status, 302, 'the Studio invites a maker');
  const invite = letters('roland@example.com').find(m => /invitation/i.test(m.subject)); assert.ok(invite, 'the invitation is written to Roland');
  const link = (invite.text.match(/http:\/\/localhost(\/account\/join\/[\w-]+)/) || [])[1]; assert.ok(link, 'the letter carries the link that opens the studio');
  const roland = {}; r = await go(roland, link); assert.equal(r.status, 302); assert.match(r.headers.get('location'), /^\/account\/upload/, 'the link opens the vault, nothing to learn first');
  await page(roland, r.headers.get('location'));
  const M = db.prepare("SELECT * FROM makers WHERE email='roland@example.com'").get(); assert.ok(M.joined_at, 'Roland has joined');
  say('1. invited, joined, in the vault');

  // ---- 2. one master, through the vault's own doors (the page sends the file the same way) ---------------------------
  let pics = 0; const putMaster = async (name, w, h, q = 88) => {
    const k = pics++; let img = sharp(path.join(__dirname, 'fixture.jpg')).resize({ width: w, height: h, fit: 'fill' }); if (k % 2) img = img.flop().negate({ alpha: false }); if (k >= 2) img = img.flip().greyscale(); // each a different picture, or the fingerprint knows it
    const buf = await img.modulate({ hue: k * 90 }).jpeg({ quality: q }).toBuffer();
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const st = await form(roland, '/account/arrivals/start', { name, size: buf.length, type: 'image/jpeg', sha256: sha }).then(x => x.json()); assert.ok(st.ok, 'start: ' + JSON.stringify(st));
    if (!st.direct) { const b = await go(roland, `/account/arrivals/${st.id}/body`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buf }).then(x => x.json()); assert.ok(b.ok, 'body: ' + JSON.stringify(b)); }
    for (let k = 0; k < 600; k++) { const a = db.prepare('SELECT status, slug, error FROM arrivals WHERE id=?').get(st.id); if (a.status === 'done') return db.prepare('SELECT * FROM works WHERE slug=?').get(a.slug); if (a.status === 'failed') throw new Error('arrival failed: ' + a.error); await new Promise(x => setTimeout(x, 100)); }
    throw new Error('the arrival never finished');
  };
  const w = await putMaster('L1004321.jpg', 6000, 4000); assert.equal(w.maker_id, M.id, 'the master is Roland’s');
  r = await form(roland, `/account/works/${w.slug}/show`, { attest: '1' }); assert.equal(db.prepare('SELECT status FROM works WHERE id=?').get(w.id).status, 'held', 'published on his word: ' + r.headers.get('location'));
  say('2. one master in, on view');

  // ---- 3. the print he has: edition of one, $300, taken by hand ------------------------------------------------------
  let desk = await page(roland, `/account/works/${w.slug}`);
  assert.ok(/name="made_by"/.test(desk) && /I have it: they take it from me/.test(desk), 'the desk asks who makes the print');
  assert.ok(/<option value="maker" selected>/.test(desk.slice(desk.indexOf('class="pe-new"'))), 'on the maker’s desk a new print is the maker’s to make unless they say otherwise');
  r = await form(roland, `/account/works/${w.slug}/editions`, { new: '1', label: '16 × 20', paper: 'Hahnemühle Photo Rag', edition_n: '1', price: '300', made_by: 'hand' });
  assert.match(r.headers.get('location'), /ok=editions/, 'the print is offered');
  const ed = db.prepare('SELECT * FROM print_editions WHERE work_id=?').get(w.id);
  assert.deepStrictEqual([ed.edition_n, ed.price_cents, ed.made_by, ed.long_in], [1, 30000, 'hand', 20], 'edition of 1, his $300, in hand; the long edge read from the size');
  let wp = text(await page({}, `/w/${w.slug}`));
  assert.ok(wp.includes('$360') && wp.includes('Edition of 1 · 1 remain'), 'the wall shows the one print at $300 and the house’s share on top: ' + (wp.match(/The print[\s\S]{0,400}/) || [''])[0]);
  assert.ok(wp.includes('you take it from Roland by hand') && wp.includes('nothing is sent'), 'the wall says it is taken by hand, not sent');
  say('3. the print offered: edition of 1, $300 to Roland, $360 on the wall');

  // ---- 4. Will buys it on his phone ----------------------------------------------------------------------------------
  const will = {}; app.locals.lastCode = null; await form(will, '/signin/code', { email: 'will@example.com' }); await form(will, '/signin/verify', { email: 'will@example.com', code: app.locals.lastCode.code });
  r = await form(will, `/w/${w.slug}/print`, { edition: String(ed.id) });
  const loc = r.headers.get('location') || ''; assert.match(loc, /checkout\.stripe\.test/, 'the press goes to payment: ' + r.status + ' ' + loc);
  const s = sessions[loc.split('/').pop()];
  assert.equal(s.line_items[0].price_data.unit_amount, 36000, 'Will pays $360: Roland’s $300 and the house’s $60');
  assert.ok(!s.shipping_address_collection, 'no address is asked for a print taken by hand');
  assert.match(s.line_items[0].price_data.product_data.description, /Taken from Roland Avery by hand; nothing is sent/);
  s.payment_status = 'paid'; s.amount_total = 36000; s.customer_details = { email: 'will@example.com', name: 'Will Fullerton' };
  const ref = s.metadata.ref; await page(will, `/thanks/${ref}?session_id=${s.id}`); await settle();
  const L = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref); assert.equal(L.status, 'active', 'the papers are issued at payment'); assert.equal(L.house_cents, 6000, 'the house’s part is recorded: $60');
  const o = db.prepare('SELECT * FROM print_orders WHERE license_id=?').get(L.id);
  assert.deepStrictEqual([o.by_maker, o.pickup, o.edition_no, o.status, o.address], [1, 1, 1, 'asked', null], 'the order: the maker’s, taken by hand, No. 1, no address');
  assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='print.sold' AND subject=?").get(w.slug), 'the register records the sale');
  // ---- 5. Roland is told at once, and sees it on his studio ----------------------------------------------------------
  const n = db.prepare("SELECT * FROM notices WHERE maker_id=? AND kind='sold' ORDER BY id DESC").get(M.id); assert.ok(n && /takes it from you by hand/.test(n.body) && /\$300 to you/.test(n.body), 'the notice: ' + (n && n.body));
  const told = letters('roland@example.com').find(m => /was acquired/.test(m.subject)); assert.ok(told && /No\. 1\/1/.test(told.text) && /takes it from you by hand/.test(told.text) && /You may keep the print until it has reached you/.test(told.text), 'the letter to Roland: the pencil line, the hand-over, and that he may keep it till paid');
  assert.ok(!letters('roland@example.com').some(m => /has been licensed/.test(m.subject)), 'no letter tells Roland the print was "licensed" and there is nothing for him to do');
  const rec = letters('will@example.com').find(m => /^Your print of/.test(m.subject)); assert.ok(rec && /you take it from them by hand/.test(rec.text), 'Will’s letter names the print and where it is: ' + (rec && rec.subject));
  assert.equal(app.locals.printShops.sweep(), 0, 'the print is never offered to a print shop'); assert.equal(db.prepare('SELECT COUNT(*) n FROM print_jobs').get().n, 0);
  let studioHome = text(await page(roland, '/account')); assert.ok(studioHome.includes('1 print sold, waiting with you to hand over or send'), 'his studio says a print waits with him');
  desk = text(await page(roland, `/account/works/${w.slug}`));
  assert.ok(desk.includes('Kept by you.') && desk.includes('Will Fullerton takes it from you by hand') && desk.includes('No. 1 of 1') && desk.includes('In pencil: 1/1'), 'the order on his desk: ' + (desk.match(/Prints to hand over[\s\S]{0,700}/) || [''])[0]);
  assert.ok(desk.includes('$300 is yours. It clears on') && desk.includes('You may keep the print until it has reached you'), 'the desk says when the money clears, and that he may keep the print till then');
  let room = text(await page(will, `/yours/p/${ref}`)); assert.ok(room.includes('waiting with Roland Avery, to take by hand'), 'Will’s room says the print waits with Roland');
  say('4–5. paid $360; papers and register at once; Roland told by notice and letter; the print waits with him');

  // ---- 6. the money: $300 whole, cleared on the week's hold from payment, not on the hand-over ------------------------
  const P = app.locals.payouts; let st = P.statement(M);
  assert.deepStrictEqual([st.owed, st.clearing, st.cleared], [30000, 30000, 0], 'owed $300, inside the hold');
  r = await form(roland, '/account/payouts/connect', {}); assert.equal(r.status, 303); assert.match(r.headers.get('location'), /connect\.stripe\.test\/acct_1/, 'Add your bank opens Stripe’s own form');
  const acct = db.prepare('SELECT stripe_account FROM makers WHERE id=?').get(M.id).stripe_account; assert.equal(acct, 'acct_1');
  assert.equal((await P.pay(db.prepare('SELECT * FROM makers WHERE id=?').get(M.id))).why, 'off', 'nothing moves while PAYOUTS is not stripe');
  process.env.PAYOUTS = 'stripe';
  assert.equal((await P.pay(db.prepare('SELECT * FROM makers WHERE id=?').get(M.id))).why, 'clearing', 'nothing moves inside the hold');
  db.prepare("UPDATE licenses SET created_at=datetime('now','-8 days') WHERE id=?").run(L.id);
  st = P.statement(M); assert.deepStrictEqual([st.cleared, st.clearing], [30000, 0], 'eight days on, with the print still in his hands, the $300 has cleared');
  desk = text(await page(roland, `/account/works/${w.slug}`)); assert.ok(desk.includes('$300 is yours and has cleared. It goes out on'), 'the desk says it has cleared');
  assert.equal((await P.pay(db.prepare('SELECT * FROM makers WHERE id=?').get(M.id))).why, 'notready', 'nothing moves until Stripe has finished his account');
  accounts.acct_1.payouts_enabled = true;
  const fr = await P.friday({ force: true }); assert.equal(fr.makers, 1);
  assert.deepStrictEqual(transfers.map(t => [t.amount, t.destination]), [[30000, 'acct_1']], 'Friday pay sends $300, whole, to Roland’s Stripe account');
  assert.equal(P.statement(M).owed, 0, 'and he is owed nothing');
  desk = text(await page(roland, `/account/works/${w.slug}`)); assert.ok(desk.includes('Sent to your bank through Stripe on'), 'the desk says the money for this sale went out');
  say('6. $300 cleared on the hold with the print still kept; Friday pay sent $300 to his Stripe account');

  // ---- 7. Roland hands it over; Will is told ---------------------------------------------------------------------------
  r = await form(roland, `/account/works/${w.slug}/prints/${o.id}`, { do: 'handed', no: '1' }); assert.match(r.headers.get('location'), /ok=printhanded/);
  assert.equal(db.prepare('SELECT status FROM print_orders WHERE id=?').get(o.id).status, 'done');
  assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='print.handed' AND subject=?").get(ref), 'the register records the hand-over');
  assert.ok(letters('will@example.com').some(m => /Your print of/.test(m.subject) && /in your hands/.test(m.text)), 'Will is told');
  room = text(await page(will, `/yours/p/${ref}`)); assert.ok(room.includes('in your hands'));
  r = await form(roland, `/account/works/${w.slug}/prints/${o.id}`, { do: 'handed' }); assert.match(r.headers.get('location'), /ok=printmoved/, 'twice is said, not done twice');
  assert.equal(transfers.length, 1, 'and nothing is paid twice');
  say('7. handed over; Will told; the register has it');

  // ---- 8. the other way: made and sent by the maker, from a master under the house's print standard -------------------
  const w2 = await putMaster('L1004400.jpg', 4000, 3000); await form(roland, `/account/works/${w2.slug}/show`, { attest: '1' });
  await form(roland, `/account/works/${w2.slug}/editions`, { new: '1', label: '11 × 14', paper: 'Canson Platine', edition_n: '10', price: '300' });
  // (#223) The house's print room on a master under its standard is refused with the reason, never answered 'saved' and then not offered.
  r = await form(roland, `/account/works/${w2.slug}/editions`, { new: '1', label: '24 × 36', edition_n: '5', price: '900', made_by: 'house' });
  assert.ok(/ok=editionhouse/.test(r.headers.get('location') || ''), 'the print room from a 12 MP master is refused: ' + r.headers.get('location'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM print_editions WHERE work_id=?').get(w2.id).n, 1, 'and nothing is saved');
  let desk2 = await page(roland, r.headers.get('location'));
  assert.ok(/<p class="err"[^>]*>The house’s print room needs a master of 24 MP or more/.test(desk2), 'the desk says why, as a refusal');
  assert.ok(/<option value="house" disabled>The house’s print room \(needs a 24 MP master\)<\/option>/.test(desk2), 'and the choice is greyed, with the reason');
  r = await form(roland, `/account/works/${w2.slug}/editions`, { id: String(db.prepare('SELECT id FROM print_editions WHERE work_id=?').get(w2.id).id), label: '11 × 14', edition_n: '10', price: '300', active: '1', made_by: 'house' });
  assert.ok(/ok=editionhouse/.test(r.headers.get('location') || '') && db.prepare('SELECT made_by FROM print_editions WHERE work_id=?').get(w2.id).made_by === 'maker', 'a size cannot be moved to the print room either');
  // A size set to the print room before this (an older row) stays as it was, is not offered, and the desk says so.
  db.prepare("INSERT INTO print_editions (work_id, label, long_in, edition_n, price_cents, sort, made_by) VALUES (?, '24 × 36', 36, 5, 90000, 1, 'house')").run(w2.id);
  desk2 = await page(roland, `/account/works/${w2.slug}`); assert.ok(desk2.includes('24 × 36: set to the house’s print room, so not offered.'), 'the desk names the size that is not offered');
  const [e1, e2] = db.prepare('SELECT * FROM print_editions WHERE work_id=? ORDER BY sort, id').all(w2.id); assert.equal(e1.made_by, 'maker', 'a maker’s print is theirs to make by default'); assert.equal(e2.made_by, 'house');
  wp = await page({}, `/w/${w2.slug}`); assert.ok(wp.includes(`value="${e1.id}"`) && !wp.includes(`value="${e2.id}"`), 'from a 12 MP master the print he makes is offered; the house’s, which needs 24 MP, is not');
  assert.ok(text(wp).includes('Printed, signed and sent by Roland'));
  const anna = {}; r = await form(anna, `/w/${w2.slug}/print`, { edition: String(e1.id) }); const s2 = sessions[(r.headers.get('location') || '').split('/').pop()];
  assert.ok(s2 && s2.shipping_address_collection, 'a print to send asks for the address'); assert.equal(s2.line_items[0].price_data.unit_amount, 36000);
  s2.payment_status = 'paid'; s2.amount_total = 36000; s2.customer_details = { email: 'anna@example.com', name: 'Anna Berg' }; s2.collected_information = { shipping_details: { name: 'Anna Berg', address: { line1: '12 Orchard St', city: 'New York', state: 'NY', postal_code: '10002', country: 'US' } } }; // Stripe's shape since 2025; Cy below has the older one
  await page(anna, `/thanks/${s2.metadata.ref}?session_id=${s2.id}`); await settle();
  const L2 = db.prepare('SELECT * FROM licenses WHERE ref=?').get(s2.metadata.ref); const o2 = db.prepare('SELECT * FROM print_orders WHERE license_id=?').get(L2.id);
  assert.deepStrictEqual([o2.by_maker, o2.pickup, o2.edition_no], [1, 0, 1]); assert.match(o2.address, /12 Orchard St/);
  assert.equal(app.locals.printShops.sweep(), 0, 'never offered to a shop');
  desk = text(await page(roland, `/account/works/${w2.slug}`)); assert.ok(desk.includes('Send it to') && desk.includes('12 Orchard St') && desk.includes('It clears once you mark the print sent'), 'the address and the money on his desk');
  db.prepare("UPDATE licenses SET created_at=datetime('now','-30 days') WHERE id=?").run(L2.id);
  assert.equal(P.statement(M).cleared, 0, 'a print to send does not clear before it is sent, however long ago it was paid');
  r = await form(roland, `/account/works/${w2.slug}/prints/${o2.id}`, { do: 'sent', no: '11' }); assert.match(r.headers.get('location'), /ok=printno/, 'a number outside the edition is refused, and said');
  r = await form(roland, `/account/works/${w2.slug}/prints/${o2.id}`, { do: 'sent', no: '3', tracking: '1Z999' }); assert.match(r.headers.get('location'), /ok=printsent/);
  const o2b = db.prepare('SELECT * FROM print_orders WHERE id=?').get(o2.id); assert.deepStrictEqual([o2b.status, o2b.edition_no], ['sent', 3], 'sent, as No. 3, the number he wrote');
  assert.equal(JSON.parse(db.prepare('SELECT rights FROM licenses WHERE id=?').get(L2.id).rights).print.no, 3, 'the papers carry No. 3');
  assert.ok(letters('anna@example.com').some(m => /on its way to you from Roland Avery\. Tracking: 1Z999/.test(m.text)), 'the collector is told, with the tracking');
  assert.equal(P.statement(M).cleared, 30000, 'sent: his $300 has cleared');
  r = await form(roland, `/account/works/${w2.slug}/prints/${o2.id}`, { do: 'delivered' }); assert.equal(db.prepare('SELECT status FROM print_orders WHERE id=?').get(o2.id).status, 'done');
  say('8. made and sent by the maker: the address, No. 3 in pencil, tracking, cleared on sending');

  // ---- 9. the house's own prints are as before ---------------------------------------------------------------------
  const big = await putMaster('L1004500.jpg', 6100, 4100); await form(roland, `/account/works/${big.slug}/show`, { attest: '1' });
  r = await form(studio, `/studio/works/${big.slug}/editions`, { open: '1' }); assert.equal(r.status, 302);
  assert.ok(db.prepare('SELECT made_by FROM print_editions WHERE work_id=?').all(big.id).every(e => e.made_by === 'house'), 'editions the Studio opens are the house’s to make');
  const ce = db.prepare('SELECT * FROM print_editions WHERE work_id=? ORDER BY sort LIMIT 1').get(big.id);
  const cy = {}; r = await form(cy, `/w/${big.slug}/print`, { edition: String(ce.id) }); const s3 = sessions[(r.headers.get('location') || '').split('/').pop()];
  assert.ok(s3.shipping_address_collection && !JSON.parse(db.prepare('SELECT rights FROM licenses WHERE ref=?').get(s3.metadata.ref).rights).print.made, 'the house’s print: the address asked, the terms as before (no new field)');
  s3.payment_status = 'paid'; s3.amount_total = s3.line_items[0].price_data.unit_amount; s3.customer_details = { email: 'cy@example.com', name: 'Cy' }; s3.shipping_details = { name: 'Cy', address: { line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' } };
  await page(cy, `/thanks/${s3.metadata.ref}?session_id=${s3.id}`); await settle();
  assert.equal(db.prepare('SELECT by_maker FROM print_orders WHERE license_id=(SELECT id FROM licenses WHERE ref=?)').get(s3.metadata.ref).by_maker, 0);
  assert.equal(app.locals.printShops.sweep(), 1, 'the house’s print goes to the press as before');
  say('9. the house’s prints are placed with the press as before');

  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  say('ok'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
