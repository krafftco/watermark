// The reply link (#184; Will, 21 Nov: "screenshot licences"). A photographer pastes one address under a brand's comment
// or into a message; the brand answers the license page's plain questions and the house does the rest. Walked here, as
// a person would, through the house's own doors:
//   1. the photographer's reply link (/rights/:handle) and each photograph's own (/license/:slug, on its desk);
//   2. a brand, a priced use: paid at once, the paper, the register;
//   3. a brand, a use with no price: one request to the photographer, answered with a price, paid at that price;
//      the same desk grants another for credit only, and declines a third;
//   4. a brand, a use the photographer prices at nothing: licensed for credit at once, no payment opened;
//   5. the photographer writes a license for a deal made elsewhere: for credit (France, 5,000 copies), accepted by the
//      link; and for a fee, paid through the house at exactly that fee, none of it the house's; withdrawn; declined.
// Every sentence is a draft for Will; the credit-only clause and acceptance by a link are questions for counsel.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const K = require('../src/contract'); const H = require('../src/holds'); const FEE = require('../src/fee');

(async () => {
  const { createApp } = require('../src/app'); const sharp = require('sharp');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-184-'));
  const stripeClient = require('stripe')('sk_test_dummy'); const sessions = {};
  stripeClient.checkout.sessions.create = async o => { const id = 'cs_' + Object.keys(sessions).length; sessions[id] = { id, ...o, url: 'https://checkout.stripe.test/' + id, payment_status: 'unpaid' }; return sessions[id]; };
  stripeClient.checkout.sessions.retrieve = async id => sessions[id];
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'reply184', stripeKey: 'sk_test_dummy', stripePk: 'pk_test_dummy', stripeClient, webhookSecret: 'whsec_test', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
    const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    const page = async (jar, p) => { const r = await go(jar, p); assert.equal(r.status, 200, `${p} answers 200, not ${r.status} ${r.headers.get('location') || ''}`); return r.text(); };
    const text = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
    const never = (h, where) => { const m = text(h).match(new RegExp(`\\b(${H.NEVER.join('|')})\\b`, 'i')); assert.ok(!m, `${where}: never says "${m && m[0]}"`); };
    const letters = to => (app.locals.mailLog || []).filter(m => m.to === to);
    const say = (...a) => console.log('replylink:', ...a);
    const n0 = () => Object.keys(sessions).length;
    const lic = ref => db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref);
    const entries = ref => db.prepare('SELECT type FROM ledger WHERE subject=? ORDER BY seq').all(ref).map(e => e.type);
    const pay = async (jar, ref) => { const l = lic(ref); const s = sessions[l.stripe_session]; Object.assign(s, { payment_status: 'paid', amount_total: s.line_items[0].price_data.unit_amount, customer_details: { email: l.licensee_email || 'pay@example.com', name: l.licensee_name } }); const r = await go(jar, `/c/${ref}?session_id=${s.id}`); assert.equal(r.status, 200); return { s, html: await r.text() }; };

    // ---- 0. a photographer, invited, with one photograph on view and three prices ------------------------------------
    const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
    let r = await form(studio, '/studio/accounts', { name: 'Ida Lens', email: 'ida@example.com' }); assert.equal(r.status, 302);
    const invite = letters('ida@example.com').find(m => /invitation/i.test(m.subject)); const join = (invite.text.match(/http:\/\/localhost(\/account\/join\/[\w-]+)/) || [])[1];
    const ida = {}; await go(ida, join); const M = db.prepare("SELECT * FROM makers WHERE email='ida@example.com'").get(); assert.ok(M && M.joined_at, 'Ida has joined');
    const f = path.join(dir, 'w.jpg'); await sharp(path.join(__dirname, 'fixture.jpg')).resize({ width: 6100, height: 4100, fit: 'fill' }).jpeg({ quality: 70 }).toFile(f);
    const w0 = await app.locals.registerWork({ file: f, title: 'Harbour at Dawn', originalName: 'w.jpg' });
    db.prepare("UPDATE works SET status='held', maker_id=? WHERE slug=?").run(M.id, w0.slug); const w = db.prepare('SELECT * FROM works WHERE slug=?').get(w0.slug);
    for (const [key, price] of [['editorial', '350'], ['commercial', '0'], ['campaign', '']]) { r = await form(ida, `/account/prices/${key}`, { price }); assert.equal(r.status, 302, 'the price is saved: ' + key); }
    const use = key => db.prepare('SELECT * FROM uses WHERE maker_id=? AND key=?').get(M.id, key);
    assert.deepStrictEqual([use('editorial').price_cents, use('commercial').price_cents, use('campaign').price_cents], [35000, 0, null], 'In a story $350; For a company credit only; Before an audience on request');
    say('0. Ida, one photograph on view: In a story $350, For a company credit only, Before an audience by request');

    // ---- 1. the reply links ------------------------------------------------------------------------------------------
    let h = await page(ida, '/account/requests');
    assert.ok(h.includes('Your reply link') && h.includes(`value="http://localhost/rights/${M.handle}"`), 'the requests desk shows the one address to paste');
    assert.ok(h.includes('Write a license for a deal made elsewhere') && h.includes('name="fee"') && h.includes(`value="${w.slug}"`), 'and the form for a deal made elsewhere');
    h = await page(ida, `/account/works/${w.slug}`); assert.ok(h.includes(`value="http://localhost/license/${w.slug}"`), 'each photograph’s own reply link is on its desk');
    const brand = {}; h = await page(brand, `/rights/${M.handle}`); never(h, '/rights');
    assert.ok(h.includes('Using a photograph.') && h.includes(`href="/license/${w.slug}"`) && h.includes('Harbour at Dawn'), 'the reply link opens on the photographs, each to its license page');
    assert.ok(h.includes(K.FORM_NOT_ADVICE), 'and says the agreement is a form, not advice');
    assert.ok(!/name="email"|name="name"/.test(h) && !/<textarea/.test(h), 'it holds no inbox: nothing to write to the photographer from here');
    assert.ok((await page(brand, `/rights/${M.handle}?q=harbour`)).includes('Harbour at Dawn'), 'found by a word');
    r = await go(brand, '/rights/no-such-person'); assert.equal(r.status, 404, 'no one else’s door');
    say('1. the reply link /rights/' + M.handle + ' and /license/' + w.slug);

    // ---- 2. a brand, a priced use: paid at once -----------------------------------------------------------------------
    h = await page(brand, `/license/${w.slug}?use=editorial`);
    for (const q of ['What is it for?', 'Where will it appear?', 'How many?', 'For how long?']) assert.ok(h.includes(q), 'the license page asks: ' + q);
    assert.ok(h.includes('Credit only') && h.includes('data-label="License it for credit"'), 'and shows the use Ida asks only credit for');
    assert.ok(!/name="email"/.test(h), 'nothing about the brand is asked before payment');
    let n = n0(); r = await form(brand, `/buy/${w.slug}`, { use: 'editorial' }); assert.equal(r.status, 303); assert.equal(n0(), n + 1, 'a priced use goes to payment at once');
    const pRef = sessions[r.headers.get('location').split('/').pop()].metadata.ref;
    let paid = await pay(brand, pRef); assert.equal(lic(pRef).status, 'active', 'paid, licensed'); assert.ok(paid.s.line_items[0].price_data.unit_amount >= 35000);
    h = await page(brand, `/c/${pRef}/contract?k=${lic(pRef).download_token}`); assert.ok(h.includes('Standard Content License Agreement') && h.includes('using the Watermark platform'), 'the paper: counsel’s Section 3, as before');
    assert.ok(entries(pRef).includes('license.granted'), 'recorded on the register');
    say('2. priced: /license → /buy → payment → /c/' + pRef + ' active, the agreement, the register');

    // ---- 3. a brand, a use with no price: one request, a price, payment ------------------------------------------------
    n = n0(); h = await (await form(brand, `/buy/${w.slug}`, { use: 'campaign', where: 'US', of: 'audience', many: '20000' })).text();
    assert.equal(n0(), n, 'no payment for a use with no price'); assert.ok(h.includes('Tell the maker') && h.includes('name="where" value="US"'), 'it goes to the photographer, with the answers');
    r = await form(brand, `/license/${w.slug}`, { use: 'campaign', name: 'Bea Brand', email: 'bea@brand.example', company: 'Brand Co', agree: '1', intended: 'A poster run', where: 'US', of: 'audience', many: '20000' });
    assert.equal(r.status, 200); assert.equal(n0(), n, 'a request, not a payment');
    const qRef = db.prepare("SELECT ref FROM licenses WHERE licensee_email='bea@brand.example' ORDER BY id DESC LIMIT 1").get().ref;
    assert.equal(lic(qRef).status, 'requested'); assert.ok(letters('ida@example.com').some(m => m.text && m.text.includes(qRef)), 'Ida is written to');
    h = await page(ida, '/account/requests'); assert.ok(h.includes(`/account/requests/${qRef}`) && h.includes('Waiting for you'), 'one request on her desk');
    h = await page(ida, `/account/requests/${qRef}`); assert.ok(h.includes('Accept and send for payment') && h.includes('Grant for credit only') && h.includes('Decline'), 'with three next steps: a price, credit only, or no');
    n = n0(); r = await form(ida, `/account/requests/${qRef}/accept`, { price: '900' }); assert.equal(r.status, 302); assert.equal(n0(), n + 1, 'her price opens one payment');
    assert.deepStrictEqual([lic(qRef).status, lic(qRef).price_cents], ['awaiting_payment', 90000]);
    paid = await pay(brand, qRef); assert.equal(lic(qRef).status, 'active', 'paid at her price, licensed');
    h = await page(brand, `/c/${qRef}/contract?k=${lic(qRef).download_token}`); assert.ok(h.includes('United States (the') && h.includes('20,000 people'), 'the paper carries the answers');
    // the same desk: credit only, and no
    await form(brand, `/license/${w.slug}`, { use: 'campaign', name: 'Cy Credit', email: 'cy@brand.example', agree: '1' });
    const cRef = db.prepare("SELECT ref FROM licenses WHERE licensee_email='cy@brand.example'").get().ref;
    n = n0(); r = await form(ida, `/account/requests/${cRef}/accept`, { price: '', free: '1' }); assert.equal(r.status, 302); assert.equal(n0(), n, 'credit only opens no payment');
    let L = lic(cRef), T = JSON.parse(L.rights); assert.deepStrictEqual([L.status, L.price_cents, T.credit], ['active', 0, true], 'granted for credit: a real license at no fee');
    assert.ok(letters('cy@brand.example').some(m => /credit only/i.test(m.text || '')), 'the paper goes to them, saying credit only');
    await form(brand, `/license/${w.slug}`, { use: 'campaign', name: 'Di No', email: 'di@brand.example', agree: '1' });
    const dRef = db.prepare("SELECT ref FROM licenses WHERE licensee_email='di@brand.example'").get().ref;
    await form(ida, `/account/requests/${dRef}/decline`, { word: 'Not for this one.' }); assert.equal(lic(dRef).status, 'declined'); assert.ok(letters('di@brand.example').length >= 2, 'told, kindly');
    say('3. unpriced: request ' + qRef + ' → Ida names $900 → paid → active; ' + cRef + ' granted for credit; ' + dRef + ' declined');

    // ---- 4. a brand, a use priced at nothing: credit only, at once ------------------------------------------------------
    h = await page(brand, `/contract/${w.slug}?use=commercial`); assert.ok(h.includes(K.CREDIT_ONLY) && h.includes('Credit only'), 'the agreement read before taking it carries the credit clause');
    n = n0(); h = await (await form(brand, `/buy/${w.slug}`, { use: 'commercial' })).text(); assert.equal(n0(), n, 'no payment is opened');
    assert.ok(h.includes('Ida Lens asks only to be credited.') && h.includes('Take the license') && h.includes('data-holds="license"'), 'the page says credit only, what they will hold, and asks who it is for');
    never(h, 'the credit-only page');
    r = await form(brand, `/license/${w.slug}`, { use: 'commercial', name: 'Eve Editor', email: 'eve@brand.example', company: 'Eve Co', agree: '1' }); assert.equal(r.status, 303);
    const eRef = db.prepare("SELECT ref FROM licenses WHERE licensee_email='eve@brand.example'").get().ref; L = lic(eRef); T = JSON.parse(L.rights);
    assert.equal(r.headers.get('location'), `/c/${eRef}?k=${L.download_token}`, 'straight to the paper');
    assert.deepStrictEqual([L.status, L.price_cents, L.house_cents, T.credit, n0()], ['active', 0, 0, true, n], 'licensed at once, no fee, nothing to the house, no payment');
    { const { version, hash, ...bare } = T; assert.equal(hash, require('crypto').createHash('sha256').update(JSON.stringify(K.assemble({ t: bare, work: w.title, maker: M.name, ref: eRef }))).digest('hex'), 'fingerprinted like any order'); }
    h = await page(brand, r.headers.get('location')); assert.ok(h.includes('None: credit only') && h.includes('accepted by Eve Co on Watermark'), 'the certificate: no fee, accepted on the house'); never(h, 'the certificate');
    h = await page(brand, `/c/${eRef}/contract?k=${L.download_token}`); assert.ok(h.includes(K.CREDIT_ONLY) && h.includes('Accepted on Watermark'), 'the agreement: Section 3 is the credit');
    assert.ok(letters('eve@brand.example').length && letters('ida@example.com').some(m => /Licensed for credit/.test(m.subject)), 'both are written to');
    assert.ok(entries(eRef).includes('license.granted'), 'recorded on the register');
    say('4. credit only: /buy → who → /c/' + eRef + ' active at $0, Section 3 the credit, no payment');

    // ---- 5. a deal made elsewhere: the photographer writes it -----------------------------------------------------------
    r = await form(ida, '/account/requests/write', { work: w.slug, use: 'editorial', where: 'FR', of: 'copies', many: '5,000', name: 'Gus Gallery', company: 'Revue', email: 'gus@revue.example', fee: '', intended: 'Agreed by message on Instagram' });
    assert.equal(r.status, 302); const gRef = r.headers.get('location').match(/requests\/(WM-[\d-]+)/)[1]; L = lic(gRef); T = JSON.parse(L.rights);
    assert.deepStrictEqual([L.status, L.price_cents, L.house_cents, T.written, T.credit, T.territory.name, T.limit.n], ['offered', 0, 0, true, true, 'France', 5000], 'written: credit only, France, 5,000 copies');
    assert.ok(entries(gRef).includes('license.written'), 'the writing is recorded');
    const link = `/c/${gRef}?k=${L.download_token}`;
    h = await page(ida, `/account/requests/${gRef}`); assert.ok(h.includes(`value="http://localhost${link}"`) && h.includes('Withdraw it'), 'Ida has the link to send');
    assert.ok(letters('gus@revue.example').some(m => m.text.includes(`http://localhost${link}`)), 'and it went to the address she gave');
    const gus = {}; assert.equal((await go(gus, `/c/${gRef}`)).status, 404, 'no key, no page'); assert.equal((await go(gus, `/c/${gRef}?k=nope`)).status, 404, 'a wrong key, no page');
    h = await page(gus, link); never(h, 'the offer');
    assert.ok(h.includes('Ida Lens has written you a license.') && h.includes('in one territory (France) and in no more than 5,000 copies') && h.includes('There is no fee.') && h.includes('>Accept<'), 'Gus reads what he will hold, and Accept');
    assert.ok(h.includes(K.FORM_NOT_ADVICE) && !h.includes('Agreed by message on Instagram'), 'a form, not advice; Ida’s own note is not shown');
    h = await page(gus, `/c/${gRef}/contract?k=${L.download_token}`); assert.ok(h.includes('France (the') && h.includes(K.CREDIT_ONLY) && h.includes('not yet accepted'), 'the agreement before accepting');
    h = await (await form(gus, `/c/${gRef}/accept`, { k: L.download_token, name: 'Gus', email: 'gus@revue.example' })).text(); assert.ok(h.includes('the tick that you accept'), 'without the tick, told, not refused'); assert.equal(lic(gRef).status, 'offered');
    n = n0(); r = await form(gus, `/c/${gRef}/accept`, { k: L.download_token, name: 'Gus Gallery', company: 'Revue', email: 'gus@revue.example', agree: '1' }); assert.equal(r.status, 303); assert.equal(n0(), n, 'credit only: no payment');
    L = lic(gRef); assert.deepStrictEqual([L.status, L.price_cents], ['active', 0]); assert.equal(r.headers.get('location'), `/c/${gRef}?k=${L.download_token}`);
    h = await page(gus, r.headers.get('location')); assert.ok(h.includes('Written by Ida Lens for a deal made between them') && h.includes('None: credit only'), 'the paper says who wrote it');
    assert.ok(letters('ida@example.com').some(m => /^Accepted:/.test(m.subject)) && letters('gus@revue.example').length >= 2, 'both are told; Gus has the papers');
    assert.ok(entries(gRef).includes('license.granted'));
    r = await form(gus, `/c/${gRef}/accept`, { k: L.download_token, name: 'Gus', email: 'gus@revue.example', agree: '1' }); assert.equal(r.status, 404, 'accepted once only');
    say('5a. written for credit: ' + gRef + ' → link → Gus accepts → active, the paper, the register');

    // for a fee: paid here, exactly that fee, all of it Ida's
    r = await form(ida, '/account/requests/write', { work: w.slug, use: 'commercial', name: 'Hal Hotel', fee: '250' }); const hRef = r.headers.get('location').match(/requests\/(WM-[\d-]+)/)[1]; L = lic(hRef);
    assert.deepStrictEqual([L.status, L.price_cents, L.house_cents, L.licensee_email], ['offered', 25000, 0, ''], 'written at $250, no address: Ida sends the link herself');
    assert.ok(!JSON.parse(L.rights).credit && !JSON.parse(L.rights).ask);
    const hal = {}; h = await page(hal, `/c/${hRef}?k=${L.download_token}`); assert.ok(h.includes('Accept and pay $250') && h.includes('all of it goes to Ida'), 'Hal sees the fee and that it is all Ida’s');
    n = n0(); r = await form(hal, `/c/${hRef}/accept`, { k: L.download_token, name: 'Hal', company: 'Hal Hotel', email: 'hal@hotel.example', agree: '1' }); assert.equal(r.status, 303); assert.equal(n0(), n + 1);
    assert.equal(sessions[lic(hRef).stripe_session].line_items[0].price_data.unit_amount, 25000, 'charged exactly the fee Ida named: no share on top');
    h = await page(hal, `/c/${hRef}?k=${L.download_token}`); assert.ok(h.includes('Accept and pay $250'), 'back from payment unpaid, the link still offers it');
    paid = await pay(hal, hRef); L = lic(hRef); assert.equal(L.status, 'active', 'paid, licensed');
    assert.equal(FEE.makerOf(L, M.share_pct || 85), 25000, 'all of it Ida’s');
    assert.equal(db.prepare(`SELECT ${FEE.sqlMaker(M.share_pct || 85)} v FROM licenses l WHERE ref=?`).get(hRef).v, 25000, 'and so on her statement');
    assert.equal(L.house_cents, 0, 'the house took nothing');
    say('5b. written at $250: ' + hRef + ' → Hal accepts and pays $250 exactly → active, $250 Ida’s');

    // withdrawn by her; declined by them
    r = await form(ida, '/account/requests/write', { work: w.slug, use: 'editorial', name: 'Ivy' }); const iRef = r.headers.get('location').match(/requests\/(WM-[\d-]+)/)[1]; const iKey = lic(iRef).download_token;
    await form(ida, `/account/requests/${iRef}/decline`, {}); assert.equal(lic(iRef).status, 'declined'); assert.equal((await go({}, `/c/${iRef}?k=${iKey}`)).status, 200); assert.ok(!(await (await go({}, `/c/${iRef}?k=${iKey}`)).text()).includes('>Accept<'), 'withdrawn: nothing to accept');
    r = await form(ida, '/account/requests/write', { work: w.slug, use: 'editorial', name: 'Jo' }); const jRef = r.headers.get('location').match(/requests\/(WM-[\d-]+)/)[1];
    h = await (await form({}, `/c/${jRef}/decline`, { k: lic(jRef).download_token, word: 'Changed our plans' })).text(); assert.ok(h.includes('Declined.')); assert.equal(lic(jRef).status, 'declined');
    assert.ok(letters('ida@example.com').some(m => /^Declined:/.test(m.subject) && m.text.includes('Changed our plans')), 'Ida is told, with their word');
    // what cannot be written: someone else's work, a junk fee, no name
    for (const [body, why] of [[{ work: 'nope', use: 'editorial', name: 'X' }, 'Choose one of your photographs'], [{ work: w.slug, use: 'editorial', name: 'X', fee: 'lots' }, 'A fee in dollars'], [{ work: w.slug, use: 'editorial', name: '' }, 'Say who']]) {
      r = await form(ida, '/account/requests/write', body); assert.equal(r.status, 302); const loc = r.headers.get('location'); assert.ok(loc.includes('#write'));
      assert.ok((await page(ida, loc.replace(/#.*/, ''))).includes(why), 'told: ' + why);
    }
    assert.equal((await form({}, '/account/requests/write', { work: w.slug, use: 'editorial', name: 'X' })).status, 302, 'a stranger is sent to sign in');
    say('5c. withdrawn ' + iRef + '; declined by them ' + jRef + '; a bad form is told, never refused');
    console.log('ok: the reply link, priced, unpriced, credit only, and a deal made elsewhere');
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
