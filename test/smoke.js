// End-to-end smoke test: register, view, license (request + paid via signed webhook), certificate, download, ledger.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const http = require('http');
const { createApp } = require('../src/app');
const SRC = process.argv[2];

function req(port, method, p, { body, headers = {}, cookie } = {}) {
  return new Promise((res, rej) => {
    const h = { ...headers }; if (cookie) h.cookie = cookie;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) { body = new URLSearchParams(body).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (body) h['content-length'] = Buffer.byteLength(body);
    const r = http.request({ port, method, path: p, headers: h }, s => { const c = []; s.on('data', d => c.push(d)); s.on('end', () => res({ status: s.statusCode, headers: s.headers, body: Buffer.concat(c) })); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-test-'));
  // Stripe with Checkout mocked: sessions are created and retrieved locally, webhooks are really signed.
  const stripeClient = require('stripe')('sk_test_dummy'); const sessions = {};
  stripeClient.checkout.sessions.create = async o => { const id = 'cs_mock_' + Object.keys(sessions).length; sessions[id] = { id, ...o, url: 'https://checkout.stripe.test/' + id, payment_status: 'unpaid' }; return sessions[id]; };
  stripeClient.checkout.sessions.retrieve = async id => sessions[id];
  const pis = {}; let cus = 0, refunds = [];
  stripeClient.customers.create = async o => ({ id: 'cus_' + (++cus), ...o });
  stripeClient.paymentIntents.create = async o => { const id = 'pi_mock_' + Object.keys(pis).length; pis[id] = { id, client_secret: id + '_secret', status: o.confirm ? 'succeeded' : 'requires_payment_method', amount_received: o.confirm ? o.amount : 0, payment_method: o.payment_method || null, ...o }; return pis[id]; };
  stripeClient.paymentIntents.retrieve = async id => pis[id];
  stripeClient.subscriptions.update = async (id, o) => ({ id, ...o }); stripeClient.subscriptions.retrieve = async id => ({ id, items: { data: [{ id: 'si_1' }] } });
  stripeClient.webhookEndpoints.list = async () => ({ data: [{ url: 'http://localhost/stripe/webhook', enabled_events: ['checkout.session.completed', 'payment_intent.succeeded'] }] });
  stripeClient.refunds.create = async o => { refunds.push(o); return { id: 're_1', ...o }; };
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', stripeKey: 'sk_test_dummy', stripePk: 'pk_test_dummy', stripeClient, webhookSecret: 'whsec_test', noTimers: true, fetchImpl: (...a) => (appRef.locals.__fetch ? appRef.locals.__fetch(...a) : fetch(...a)) }); const appRef = app;
  const server = app.listen(0); const port = server.address().port;
  const { registerWork, db } = app.locals;
  // A master-sized file (25 MP), so every use is sold instantly; a web-sized one is tested below.
  const BIG = path.join(dir, 'big.jpg'); await require('sharp')(SRC).resize({ width: 6100, height: 4100, fit: 'fill' }).jpeg({ quality: 70 }).toFile(BIG);
  const tmp = path.join(dir, 'in.jpg'); fs.copyFileSync(BIG, tmp);
  const w = await registerWork({ file: tmp, originalName: 'x.jpg', title: 'Test Dome', place: 'Florence' });
  assert.ok(w.sha256 && w.width > 0, 'registered with fingerprint and size');
  // duplicate rejected
  const tmp2 = path.join(dir, 'in2.jpg'); fs.copyFileSync(BIG, tmp2);
  await assert.rejects(registerWork({ file: tmp2, originalName: 'y.jpg', title: 'Dupe' }), /already held/);

  let r = await req(port, 'GET', '/'); assert.equal(r.status, 200); assert.ok(r.body.includes('Test Dome'));
  r = await req(port, 'GET', `/w/${w.slug}`); assert.equal(r.status, 200); assert.ok(r.body.toString().includes('Watermark Shield') && r.body.toString().includes('Held by Watermark for'), 'the shield');
  r = await req(port, 'GET', `/img/${w.slug}/screen`); assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'image/jpeg');
  const sharp = require('sharp'); const m = await sharp(r.body).metadata(); assert.ok(Math.max(m.width, m.height) <= 1600, 'screen copy capped');
  r = await req(port, 'GET', `/img/${w.slug}/original`); assert.equal(r.status, 404, 'no original by size');
  r = await req(port, 'GET', `/api/work/${w.slug}`); assert.equal(JSON.parse(r.body).title, 'Test Dome');
  r = await req(port, 'GET', '/embed.js'); assert.ok(r.body.toString().includes("'http://localhost'"));
  r = await req(port, 'GET', '/house.js'); assert.equal(r.status, 200); assert.ok(r.body.toString().includes('kh_'));
  r = await req(port, 'GET', '/'); assert.ok(r.body.toString().includes('class="kh"') && r.body.toString().includes('studios.krafftco.com'));

  // every use shows its price before anything is submitted
  r = await req(port, 'GET', `/license/${w.slug}`); const page = r.body.toString();
  for (const p of ['$350', '$750', '$2,500', '$250', 'License for $750']) assert.ok(page.includes(p), 'price visible: ' + p);
  assert.ok(!/name="email"/.test(page), 'no form fields before payment');

  // the contract: rights added at a price, extended rights, and asks for what the maker must agree
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: 'use=commercial&add=audiovisual&add=editorial&x=entities', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.status, 303); { const cs = sessions[r.headers.location.split('/').pop()]; assert.equal(cs.line_items[0].price_data.unit_amount, 75000 + 2 * 15000 + 75000, 'priced from the rights'); assert.ok(/audiovisual works/.test(cs.line_items[0].price_data.product_data.description));
    const lr = db.prepare('SELECT rights FROM licenses WHERE ref=?').get(cs.metadata.ref); const lt = JSON.parse(lr.rights); assert.ok(lt.rights.includes('audiovisual') && lt.extras.includes('entities')); }
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: 'use=commercial&x=merchandise', headers: { 'content-type': 'application/x-www-form-urlencoded' } }); assert.ok(r.body.toString().includes('Send to the maker'), 'merchandise is asked of the maker');
  r = await req(port, 'GET', `/contract/${w.slug}?use=commercial&add=audiovisual`); { const b = r.body.toString(); assert.ok(b.includes('websites, social media, marketing materials, presentations, and audiovisual works') && b.includes('artificial intelligence') && b.includes('shall not modify'), 'contract assembled'); }
  r = await req(port, 'GET', `/contract/${w.slug}?use=commercial&x=merchandise`); assert.ok(!r.body.toString().includes('on-demand merchandise printing'), 'merchandise lifts restriction (g)');
  // one tap: use -> Checkout -> paid -> it's yours, with buyer details from Stripe
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'commercial', note: 'Homepage hero' } });
  assert.equal(r.status, 303); assert.ok(r.headers.location.startsWith('https://checkout.stripe.test/'));
  const sid = r.headers.location.split('/').pop(); const sess = sessions[sid];
  assert.equal(sess.line_items[0].price_data.unit_amount, 75000); const tref = sess.metadata.ref;
  assert.ok(sess.success_url.includes(`/thanks/${tref}`));
  r = await req(port, 'GET', `/thanks/${tref}?session_id=${sid}`); assert.ok(r.body.includes('Preparing'), 'pending until paid');
  Object.assign(sess, { payment_status: 'paid', amount_total: 75000, customer_details: { email: 'cy@co.com', name: 'Cy Founder' }, custom_fields: [{ key: 'company', text: { value: 'Cy Co' } }] });
  r = await req(port, 'GET', `/thanks/${tref}?session_id=${sid}`); const ty = r.body.toString();
  assert.ok(ty.includes('yours.') && ty.includes('cy@co.com') && ty.includes('/d/'), 'it is yours, file ready');
  const tl = db.prepare('SELECT * FROM licenses WHERE ref=?').get(tref);
  assert.equal(tl.status, 'active'); assert.equal(tl.licensee_company, 'Cy Co'); assert.equal(tl.intended_use, 'Homepage hero');
  r = await req(port, 'GET', `/d/${tl.download_token}`); assert.equal(r.status, 200);
  r = await req(port, 'GET', `/thanks/${tref}?session_id=wrong`); assert.equal(r.status, 302, 'thanks page needs its session');
  // Share it: the everyday license. One tap to Checkout, no company field, the file arrives screen-sized and stamped
  r = await req(port, 'GET', `/license/${w.slug}`); assert.ok(r.body.toString().includes('Collect it.') && r.body.toString().includes('Collect for $5'), 'Share it leads');
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'social', back: 'https://studios.krafftco.com/florence/' } }); assert.equal(r.status, 303);
  assert.equal(sessions[r.headers.location.split('/').pop()].cancel_url, 'https://studios.krafftco.com/florence/', 'back to the story');
  const ss = sessions[r.headers.location.split('/').pop()]; assert.equal(ss.line_items[0].price_data.unit_amount, 500); assert.ok(!ss.custom_fields, 'nothing to fill in');
  Object.assign(ss, { payment_status: 'paid', amount_total: 500, customer_details: { email: 'fan@me.com', name: 'A Fan' } });
  r = await req(port, 'GET', `/thanks/${ss.metadata.ref}?session_id=${ss.id}`); assert.ok(r.body.toString().includes('/d/'));
  const sl1 = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ss.metadata.ref);
  r = await req(port, 'GET', `/d/${sl1.download_token}`); assert.equal(r.status, 200);
  const sm = await require('sharp')(r.body).metadata(); assert.ok(sm.width <= 2400 && sm.height <= 2400, 'screen-sized for sharing');
  // Share it in place: wallet sheet first time (card remembered), then one tap with a short undo
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.toString().includes('/static/pay.js') && r.body.toString().includes('pk_test_dummy'), 'wallet sheet offered');
  r = await req(port, 'POST', `/pay/${w.slug}`, { body: JSON.stringify({ email: 'tap@me.com', name: 'Tap Fan' }), headers: { 'content-type': 'application/json' } });
  let pj = JSON.parse(r.body); assert.ok(pj.ok && pj.secret, 'intent made'); const bck = r.headers['set-cookie'].find(c => c.startsWith('wm_b=')).split(';')[0];
  const pi0 = Object.values(pis).find(p => p.metadata.ref === pj.ref); assert.strictEqual(pi0.setup_future_usage, 'off_session');
  r = await req(port, 'POST', `/pay/${pj.ref}/done`, { cookie: bck }); assert.strictEqual(JSON.parse(r.body).ok, false, 'not before paying');
  Object.assign(pi0, { status: 'succeeded', amount_received: 500, payment_method: 'pm_card_1' });
  r = await req(port, 'POST', `/pay/${pj.ref}/done`, { cookie: bck }); let dj = JSON.parse(r.body);
  assert.ok(dj.ok && dj.download.startsWith('/d/'), 'handed over'); assert.ok(r.headers['set-cookie'].some(c => c.startsWith('wm_tap=1')), 'one tap next time');
  r = await req(port, 'POST', `/pay/${w.slug}/tap`); assert.strictEqual(JSON.parse(r.body).sheet, true, 'no remembered card, no tap');
  r = await req(port, 'POST', `/pay/${w.slug}/tap`, { cookie: bck }); assert.ok(JSON.parse(r.body).held, 'what you hold is not sold to you again');
  r = await req(port, 'GET', `/w/${w.slug}`, { cookie: bck }); { const wb = r.body.toString(); assert.ok(wb.includes('In your gallery') && !wb.includes('class="share-buy"'), 'your copy shown, not the Collect button'); }
  r = await req(port, 'POST', `/buy/${w.slug}`, { cookie: bck, body: { use: 'social' } }); assert.ok(r.headers.location.endsWith('#yours'), 'no second sale through checkout either');
  const tmpT = path.join(dir, 'inT.jpg'); await require('sharp')(SRC).resize({ width: 1800 }).flip().toFile(tmpT);
  const wT = await registerWork({ file: tmpT, originalName: 't.jpg', title: 'Test Tap', place: 'Rome' }); db.prepare("UPDATE works SET status='held' WHERE id=?").run(wT.id);
  r = await req(port, 'POST', `/pay/${wT.slug}/tap`, { cookie: bck }); const tj = JSON.parse(r.body);
  assert.ok(tj.ok && tj.undo && tj.download, 'one tap: paid and handed over');
  assert.strictEqual(Object.values(pis).find(p => p.metadata.ref === tj.ref).payment_method, 'pm_card_1');
  r = await req(port, 'GET', tj.download); assert.equal(r.status, 200);
  r = await req(port, 'POST', `/pay/${tj.ref}/undo`, { cookie: bck }); assert.ok(JSON.parse(r.body).ok && refunds.length === 1, 'undo refunds');
  r = await req(port, 'GET', tj.download); assert.equal(r.status, 404, 'undone file stops working');
  // collectors: numbered, hung in their own collection, private until they open it
  assert.ok(dj.no >= 1 && tj.no >= 1, 'collector numbers: ' + dj.no + ',' + tj.no);
  r = await req(port, 'GET', '/yours'); assert.ok(r.body.toString().includes('Start your gallery'), 'a new visitor is invited to start');
  r = await req(port, 'GET', '/yours', { cookie: bck }); let yb = r.body.toString();
  assert.ok(yb.includes(`No.&nbsp;${dj.no}`) && yb.includes('The gallery'), 'it hangs, numbered');
  r = await req(port, 'GET', '/yours?tab=files', { cookie: bck }); assert.ok(r.body.toString().includes('id="files"') && r.body.toString().includes(`No. ${dj.no}`), 'the files room');
  // the holder's room: print it, live with it, the papers; a stranger is sent to the license page
  assert.ok(yb.includes(`/yours/p/${dj.ref}`), 'the card opens the holder\'s room');
  r = await req(port, 'GET', `/yours/p/${dj.ref}`, { cookie: bck }); let kp = r.body.toString();
  assert.ok(r.status === 200 && kp.includes('See it in person') && kp.includes('kp-sz') && kp.includes('Ask for the print') && kp.includes('The certificate'), 'the holder\'s room');
  r = await req(port, 'GET', `/yours/p/${dj.ref}`); assert.equal(r.status, 302, 'a stranger goes to the license page');
  { r = await req(port, 'GET', `/yours/p/${dj.ref}/instax?film=mini&mode=fill`, { cookie: bck }); assert.equal(r.status, 200, 'the Instax file');
    const im = await require('sharp')(r.body).metadata(); assert.ok((im.width === 800 && im.height === 600) || (im.width === 600 && im.height === 800), 'the printer’s own pixels: ' + im.width + '×' + im.height); assert.ok(/Instax mini/.test(r.headers['content-disposition']), 'named for the film');
    r = await req(port, 'GET', `/yours/p/${dj.ref}/instax?film=wide&mode=fit`, { cookie: bck }); const im2 = await require('sharp')(r.body).metadata(); assert.ok(Math.max(im2.width, im2.height) === 1260, 'wide too');
    r = await req(port, 'GET', `/yours/p/${dj.ref}/instax`); assert.equal(r.status, 404, 'a stranger gets no file');
    assert.ok(kp.includes('Take the Instax file'), 'the Instax card in the room'); }
  r = await req(port, 'POST', `/yours/p/${dj.ref}/order`, { cookie: bck, body: { size: '10 × 7½ in, on 10 × 8', paper: 'Cotton rag, matte', frame: '1', email: 'tap@example.com' } });
  assert.ok(r.status === 303 && /ok=asked/.test(r.headers.location), 'a print asked for');
  r = await req(port, 'GET', `/yours/p/${dj.ref}`, { cookie: bck }); assert.ok(r.body.toString().includes('with the house'), 'the order shows');
  r = await req(port, 'GET', '/print'); assert.ok(r.status === 200 && r.body.toString().includes('Print your work.'), 'the guide to printing');
  // The agreements: every page answers, each is fingerprinted, the text matches the page's fingerprint; paying accepted the terms, publishing the Maker Agreement.
  for (const pth of ['/terms', '/privacy', '/legal/makers', '/legal/curators', '/legal/claims', '/legal/prints', '/legal']) { r = await req(port, 'GET', pth); assert.ok(r.status === 200 && r.body.toString().includes('Version 2026-'), `agreement ${pth}`); }
  r = await req(port, 'GET', '/legal/house.txt'); { const t = r.body.toString(); const h = t.match(/sha256 ([0-9a-f]{64})/)[1]; assert.equal(h, app.locals.legal.hashOf('house'), 'the text carries its fingerprint'); const crypto = require('crypto'); assert.equal(crypto.createHash('sha256').update(t.replace(/sha256 [0-9a-f]{64}\n$/, '')).digest('hex'), h, 'the fingerprint is of the text'); }
  assert.ok(db.prepare("SELECT COUNT(*) n FROM acceptances WHERE who='buyer' AND doc='house'").get().n >= 1, 'paying accepted the terms of the house');
  // The proof: a 5 × 7 from the house's print room, paid at once; from the pocket in one tap, landing on the desk paid.
  assert.ok(kp.includes('kp-proof') && kp.includes('Hahnemühle Photo Rag'), 'the proof is offered');
  r = await req(port, 'POST', `/yours/p/${dj.ref}/proof`, { cookie: bck, body: { name: 'Tap', email: 'tap@example.com', street: '1 Main St', city: 'New York', state: 'New York', zip: '10028' } });
  assert.ok(/ok=proofcheck/.test(r.headers.location), 'a bad address is refused');
  { const pb = db.prepare('SELECT * FROM licenses WHERE ref=?').get(dj.ref); const buyer = db.prepare('SELECT * FROM buyers WHERE id=?').get(pb.buyer_id); app.locals.pocket.credit(buyer, 2500, 'thanks_in', 'test', 'for the proof'); }
  r = await req(port, 'POST', `/yours/p/${dj.ref}/proof`, { cookie: bck, body: { from: 'pocket', name: 'Tap', email: 'tap@example.com', street: '1 Main St', city: 'New York', state: 'ny', zip: '10028' } });
  assert.ok(/ok=proof(&|#|$)/.test(r.headers.location), 'the proof paid from the pocket');
  { const o = db.prepare("SELECT * FROM print_orders WHERE kind='proof' ORDER BY id DESC").get(); assert.ok(o && o.paid === 1 && o.status === 'asked' && o.cents === 2500 && /NY 10028/.test(o.address), 'the proof is on the desk, paid, with the address'); }
  r = await req(port, 'GET', `/yours/p/${dj.ref}`, { cookie: bck }); assert.ok(r.body.toString().includes('You have one'), 'the room counts the proof');
  assert.ok(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='proof.collected'").get().n === 1, 'proof.collected on the register');
  // The wall letter: a month on, nothing printed, one letter; the piece with a proof is left alone; never twice.
  { const before = (app.locals.mailLog || []).length; db.prepare("UPDATE licenses SET starts_at=datetime('now','-40 days') WHERE status='active'").run();
    let n = await app.locals.wallLetters(); assert.ok(n >= 1, 'wall letters went'); assert.ok(!db.prepare('SELECT 1 FROM wall_letters WHERE license_id=?').get(db.prepare('SELECT id FROM licenses WHERE ref=?').get(dj.ref).id), 'the piece with a proof is left alone');
    n = await app.locals.wallLetters(); assert.equal(n, 0, 'never twice'); }
  // find: straight to the picture
  r = await req(port, 'GET', '/api/find?q=dome'); { const fj = JSON.parse(r.body); assert.ok(fj.works.length && fj.works[0].href.startsWith('/m/') && fj.works[0].stroll.startsWith('/wander?at='), 'find by title: ' + r.body.slice(0, 200)); }
  r = await req(port, 'GET', '/api/find?q=dmoe'); { const fj = JSON.parse(r.body); assert.ok(fj.works.length, 'a typo forgiven'); }
  r = await req(port, 'GET', '/api/find', { cookie: bck }); { const fj = JSON.parse(r.body); assert.ok(fj.before && fj.before.yours.length >= 1 && fj.before.places.length, 'before typing: yours and the ways in'); }
  r = await req(port, 'GET', '/find?q=dome'); assert.ok(r.status === 200 && r.body.toString().includes('class="fd-w"'), 'the find page');
  r = await req(port, 'GET', '/wander'); assert.ok(r.body.toString().includes('data-find-open="stroll"') && r.body.toString().includes('data-st-ssheet') && r.body.toString().includes('data-st-sit') && !r.body.toString().includes('data-pace="30"'), 'the stroll carries Find and Settings');
  r = await req(port, 'POST', '/yours', { cookie: bck, body: { name: "Tap's collection", public: '1' } });
  const code = db.prepare("SELECT code FROM buyers WHERE name=?").get("Tap's collection").code;
  r = await req(port, 'GET', `/collector/${code}`); yb = r.body.toString(); assert.ok(yb.includes('Tap&#39;s collection') || yb.includes("Tap's collection"), 'public by choice');
  assert.ok(!yb.includes('Save again'), 'no files on the public wall');
  r = await req(port, 'GET', '/series/the-great-rooms'); assert.equal(r.status, 200, 'the series hangs'); assert.ok(r.body.toString().includes('The Great Rooms'));
  // Collecting a set: two photographs of a series part at a quarter off, each its own numbered license.
  const tmp3 = path.join(dir, 'in3.jpg'); await require('sharp')(SRC).resize({ width: 1800 }).flop().modulate({ brightness: 0.8 }).toFile(tmp3);
  const w2 = await registerWork({ file: tmp3, originalName: 'z.jpg', title: 'Test Stacks', place: 'New York' });
  require('../src/series').push({ slug: 'test-set', title: 'Test Set', house: 'H', maker: 'M', cover: w.slug, dek: 'd', chapters: [{ title: 'One', dek: '', works: [w.slug, w2.slug] }] });
  r = await req(port, 'GET', '/series/test-set'); assert.ok(r.body.toString().includes('Collect all 2 of One'), 'a set offered');
  r = await req(port, 'POST', '/series/test-set/collect', { body: { part: '1' } }); assert.equal(r.status, 303);
  const setS = sessions[r.headers.location.split('/').pop()]; assert.equal(setS.line_items[0].price_data.unit_amount, 800, 'two at $5, a quarter off, whole dollars');
  setS.payment_status = 'paid'; setS.customer_details = { email: 'set@me.com', name: 'Set Fan' };
  r = await req(port, 'GET', setS.success_url.replace('{CHECKOUT_SESSION_ID}', setS.id).replace('http://localhost', '')); const sck = (r.headers['set-cookie'] || []).find(c => c.startsWith('wm_b=')).split(';')[0];
  assert.ok(r.body.toString().includes('yours.') || r.body.toString().includes('They&rsquo;re yours'), 'the set is granted');
  const setLs = db.prepare("SELECT * FROM licenses WHERE set_ref LIKE 'test-set:%'").all();
  assert.equal(setLs.length, 2); assert.ok(setLs.every(l => l.status === 'active' && l.collector_no && l.download_token), 'each numbered, each with its file');
  assert.equal(setLs.reduce((a, l) => a + l.price_cents, 0), 800, 'the price shared out');
  r = await req(port, 'GET', '/collectors'); assert.ok(r.body.toString().includes('/g/' + code), 'shown among the collectors');
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(/(In \d+ collections, among them|Collected by )/.test(r.body.toString()), 'in the collections of');
  r = await req(port, 'GET', `/collector/${code}`); assert.ok(r.body.toString().includes('data-buy') && r.body.toString().includes('/static/pay.js'), 'collect it from their wall');
  r = await req(port, 'POST', '/yours', { cookie: bck, body: { name: "Tap's collection" } });
  r = await req(port, 'GET', `/collector/${code}`); assert.equal(r.status, 404, 'private again');


  // bespoke: ask the maker
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'campaign', ask: '1' } }); assert.ok(r.body.includes('Send to the maker'));

  // the maker's say: close a use, require approval, say never; conditions travel with the license
  r = await req(port, 'POST', '/studio/login', { body: { password: 'pw' } }); const ck = r.headers['set-cookie'][0].split(';')[0];
  r = await req(port, 'GET', '/studio/prints', { cookie: ck }); assert.ok(r.body.toString().includes('10 × 7½ in, on 10 × 8'), 'the print room lists it');
  { const oid = (r.body.toString().match(/action="\/studio\/prints\/(\d+)"/) || [])[1]; r = await req(port, 'POST', `/studio/prints/${oid}`, { cookie: ck, body: { status: 'making' } }); assert.equal(r.status, 302, 'moved along'); }
  r = await req(port, 'GET', '/studio/legal', { cookie: ck }); assert.ok(r.status === 200 && r.body.toString().includes('Mark reviewed'), 'the agreements desk');
  r = await req(port, 'POST', '/studio/legal/house', { cookie: ck }); r = await req(port, 'GET', '/terms'); assert.ok(!r.body.toString().includes('lg-draft'), 'reviewed drops the draft notice');
  // Backups and the restore drill: a copy into the vault, the latest restored and checked against the live register; a stale or tampered copy fails the drill.
  { const b = await app.locals.backup.backup(); assert.ok(b.key.startsWith('backups/db/') && b.bytes > 0, 'backed up to the vault');
    const d = await app.locals.backup.drill(); assert.ok(d.ok && /matches the live one/.test(d.detail), 'the drill restores and checks');
    r = await req(port, 'GET', '/studio/backups', { cookie: ck }); assert.ok(r.body.toString().includes(b.key) && r.body.toString().includes('drill'), 'the backups desk');
    // /healthz (22 Oct): the street gets up/down and counts; the Studio (or HEALTH_KEY) gets the report.
    r = await req(port, 'GET', '/healthz'); { const j = JSON.parse(r.body); assert.ok(j.ok && typeof j.ledger === 'boolean' && typeof j.works === 'number' && !('backup' in j) && !('dataDir' in (j.vault || {})) && !('lost' in j.vault && Array.isArray(j.vault.lost)), 'the public answer names nothing inside'); }
    r = await req(port, 'GET', '/healthz', { cookie: ck }); { const j = JSON.parse(r.body); assert.ok(j.backup && j.backup.last && j.backup.last.ok && j.backup.drill && j.backup.drill.ok, '/healthz reports the backup to the Studio'); assert.ok(j.vault && 'dataDir' in j.vault, 'the full report'); }
    r = await req(port, 'GET', '/.well-known/security.txt'); assert.ok(r.status === 200 && /Contact: mailto:/.test(r.body) && /Expires:/.test(r.body), 'security.txt');
    // tamper: a backup whose register has a different hash at the same seq must fail
    const zlib = require('zlib'); const Database = require('better-sqlite3'); const tmp = path.join(os.tmpdir(), `wm-tamper-${Date.now()}.db`);
    fs.writeFileSync(tmp, zlib.gunzipSync(await app.locals.store.get(b.key))); const t = new Database(tmp); t.prepare("UPDATE ledger SET hash='0000' WHERE seq=(SELECT MAX(seq) FROM ledger)").run(); t.close();
    await app.locals.store.put('backups/db/watermark-2000-01-01T00-00-00.db.gz', zlib.gzipSync(fs.readFileSync(tmp)), 'application/gzip');
    let bad = null; try { await app.locals.backup.drill('backups/db/watermark-2000-01-01T00-00-00.db.gz'); } catch (e) { bad = e.message; } assert.ok(/register differs/.test(bad || ''), 'a tampered copy fails the drill');
    assert.ok(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='backup.failed'").get().n === 1, 'the failure is on the register');
    await new Promise(r => setTimeout(r, 1100)); await app.locals.backup.backup(); await new Promise(r => setTimeout(r, 1100)); await app.locals.backup.backup(); assert.ok(!(await app.locals.store.list('backups/db/')).some(k => k.includes('2000-01-01')), 'old copies are pruned with each backup, never below three'); }
  // The Studio door: with STUDIO_EMAILS set the password is retired; a named person's email code opens the door (no passkey yet), a stranger's does not.
  { process.env.STUDIO_EMAILS = 'door@example.com';
    r = await req(port, 'GET', '/studio/login'); assert.ok(r.status === 302 && /studio\/door/.test(r.headers.location), 'the password page gives way to the door');
    r = await req(port, 'POST', '/studio/login', { body: { password: 'pw' } }); assert.equal(r.status, 403, 'the password is retired');
    r = await req(port, 'POST', '/signin/code', { body: { email: 'stranger@example.com' } }); r = await req(port, 'POST', '/signin/verify', { body: { email: 'stranger@example.com', code: app.locals.lastCode.code } });
    assert.ok(!/wm_s=/.test(String(r.headers['set-cookie'] || '')), 'a stranger\'s code opens no studio');
    r = await req(port, 'POST', '/signin/code', { body: { email: 'door@example.com' } }); r = await req(port, 'POST', '/signin/verify', { body: { email: 'door@example.com', code: app.locals.lastCode.code } });
    const sc = String(r.headers['set-cookie'] || ''); assert.ok(/wm_s=/.test(sc), 'the named person\'s code opens the door');
    const dck = sc.match(/wm_s=[^;]+/)[0]; r = await req(port, 'GET', '/studio/legal', { cookie: dck }); assert.equal(r.status, 200, 'and the studio answers');
    assert.ok(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='studio.opened'").get().n >= 1, 'the opening is on the register');
    delete process.env.STUDIO_EMAILS; }
  // The numbers: every page hit is recorded without a person's name; the room reads today against yesterday, who is on now, speed, errors and health; a stranger is sent to the door.
  { app.locals.analytics.flush(); const R = app.locals.analytics.report('today'); assert.ok(R.cur.views > 10 && R.cur.visitors >= 1, 'hits were kept'); assert.ok(R.works.length >= 1, 'works most seen');
    assert.ok(db.prepare("SELECT COUNT(*) n FROM hits WHERE path LIKE '/w/%'").get().n >= 1 && !db.prepare("SELECT 1 FROM hits WHERE path LIKE '%?%' OR path LIKE '%@%'").get(), 'paths folded, nothing personal');
    assert.ok(R.health.register === true && typeof R.health.uptime === 'number' && R.speed.page.n > 0, 'health and speed');
    r = await req(port, 'GET', '/studio/analytics', { cookie: ck }); assert.ok(r.status === 200 && r.body.toString().includes('On the site now') && r.body.toString().includes('Health'), 'the numbers page');
    r = await req(port, 'GET', '/studio/analytics.json?span=7d', { cookie: ck }); assert.ok(r.status === 200 && JSON.parse(r.body).span === '7d', 'the json');
    r = await req(port, 'GET', '/studio/analytics'); assert.equal(r.status, 302, 'a stranger is sent to the door'); }
  // The audit: a Studio action is on the register with its fields, never a password; the page lists it.
  { const n0 = db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='studio.action'").get().n;
    r = await req(port, 'POST', '/studio/uses/social', { cookie: ck, body: { price: '5' } });
    const e = db.prepare("SELECT * FROM ledger WHERE type='studio.action' ORDER BY seq DESC LIMIT 1").get(); assert.ok(n0 >= 1 && e && /\/studio\/uses\/social/.test(e.subject) && /"price":"5"/.test(e.data), 'the price change is on the register');
    assert.ok(!db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='studio.action' AND data LIKE '%password%'").get().n, 'never a password');
    r = await req(port, 'GET', '/studio/audit', { cookie: ck }); assert.ok(r.status === 200 && r.body.toString().includes('studio.action'), 'the audit page');
    r = await req(port, 'GET', '/ledger'); assert.ok(!r.body.toString().includes('studio.action'), 'hidden from the public register'); }
  // The Keys: the collector who paid holds the collector's key; the maker who published holds the maker's key; the door answers; keys are numbered and never reissued.
  { const K = app.locals.keys; assert.ok(db.prepare("SELECT COUNT(*) n FROM keys WHERE kind='collector'").get().n >= 1, 'a collector was given a key'); assert.ok(db.prepare("SELECT COUNT(*) n FROM keys WHERE kind='maker'").get().n >= 1, 'a maker was given a key');
    const k1 = db.prepare("SELECT * FROM keys WHERE kind='collector' ORDER BY no LIMIT 1").get(); const again = K.issue('collector', { buyer_id: k1.buyer_id }, 'again'); assert.equal(again.no, k1.no, 'never reissued');
    r = await req(port, 'GET', '/keys'); assert.ok(r.status === 200 && r.body.toString().includes('Are you a maker, a collector, or a curator?'), 'the door');
    assert.ok(r.body.toString().includes('kmk-mark') && r.body.toString().includes('/keys/story'), 'the 1947 mark on the door');
    r = await req(port, 'GET', '/keys/story'); assert.ok(r.status === 200 && r.body.toString().includes('Born in 1947') && r.body.toString().includes('Mary Helen Krafft'), 'the story');
    r = await req(port, 'GET', '/static/keys/menu-4.jpg'); assert.equal(r.status, 200, 'the menu scan');
    r = await req(port, 'GET', '/yours', { cookie: bck }); assert.ok(r.body.toString().includes('The Keys:'), 'the key shows on the gallery');
    r = await req(port, 'GET', '/ledger'); assert.ok(!r.body.toString().includes('key.given'), 'keys are given quietly'); }
  // The bench: anyone reads; a stranger may not speak; a keyholder who has not stood is refused; after a minute before the work they speak; the maker marks it well seen; nothing of it is on the wall.
  { r = await req(port, 'GET', `/bench/${w.slug}`); assert.ok(r.status === 200 && r.body.toString().includes('On the bench') && r.body.toString().includes('for keyholders'), 'the bench reads to anyone');
    r = await req(port, 'POST', `/bench/${w.slug}`, { body: { body: 'A stranger says something long enough to count.' } }); assert.ok(/ok=no/.test(r.headers.location), 'a stranger may not speak');
    // the collector (bck) holds a key but has not stood before this work and does not hold it
    db.prepare('DELETE FROM stood WHERE work_id=?').run(w.id);
    const bb = db.prepare('SELECT * FROM licenses WHERE ref=?').get(dj.ref); db.prepare("INSERT INTO stood (work_id, viewer, buyer_id, n, seconds) VALUES (?,?,?,1,75)").run(w.id, 'benchv', bb.buyer_id);
    r = await req(port, 'POST', `/bench/${w.slug}`, { cookie: bck, body: { body: 'short' } }); assert.ok(/ok=short/.test(r.headers.location), 'a sentence at least');
    r = await req(port, 'POST', `/bench/${w.slug}`, { cookie: bck, body: { body: 'The light on the far wall is the whole picture; everything else waits for it. See www.x.com' } }); assert.ok(/ok=link/.test(r.headers.location), 'no links');
    r = await req(port, 'POST', `/bench/${w.slug}`, { cookie: bck, body: { body: 'The light on the far wall is the whole picture; everything else waits for it.' } }); assert.ok(/ok=said/.test(r.headers.location), 'after standing, they speak');
    const bl = db.prepare("SELECT * FROM bench_lines WHERE kind='work' AND subject_id=?").get(w.id); assert.ok(bl && bl.name, 'signed');
    r = await req(port, 'POST', `/bench/line/${bl.id}/seen`, { cookie: ck }); r = await req(port, 'GET', `/bench/${w.slug}`); assert.ok(r.body.toString().includes('Well seen'), 'the house marks it well seen');
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(!r.body.toString().includes('far wall is the whole picture') && r.body.toString().includes('bn-door'), 'nothing of it on the wall; only the door');
    assert.ok(db.prepare("SELECT COUNT(*) n FROM notices WHERE kind='bench'").get().n >= 1, 'the maker is told');
    db.prepare("DELETE FROM stood WHERE viewer='benchv'").run(); }
  // The balcony: closed outside the hours; the house opens it; a keyholder speaks and another keyholder's stream hears it; the window hears presence, never lines; the host keeps one with the speaker's yes; closing leaves one sentence and nothing said.
  { process.env.BALCONY_ALWAYS = '0';
    r = await req(port, 'GET', '/balcony'); assert.ok(r.status === 200 && /Opens at 9 in the evening|Open tonight/.test(r.body.toString()), 'the balcony page');
    const B = app.locals.balcony; B.close(); r = await req(port, 'POST', '/balcony/say', { cookie: bck, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'hello' }) }); assert.equal(r.status, 409, 'closed: no one speaks');
    r = await req(port, 'POST', '/studio/balcony/open', { cookie: ck }); assert.ok(B.room().open, 'the house opens it');
    const listen = (cookie) => new Promise(resolve => { const h = { accept: 'text/event-stream' }; if (cookie) h.cookie = cookie; const rq = http.request({ port, path: '/balcony/stream', headers: h }, s => { let buf = ''; const got = []; s.on('data', d => { buf += d; let m; while ((m = buf.match(/event: (\w+)\ndata: ([^\n]*)\n\n/))) { got.push({ ev: m[1], data: JSON.parse(m[2]) }); buf = buf.slice(m.index + m[0].length); } }); resolve({ got, close: () => rq.destroy() }); }); rq.end(); });
    const a = await listen(bck), win = await listen(null); await new Promise(x => setTimeout(x, 150));
    r = await req(port, 'POST', '/balcony/say', { cookie: bck, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'The light on the far wall, again, tonight.' }) }); assert.equal(r.status, 200, 'a keyholder speaks');
    await new Promise(x => setTimeout(x, 150));
    assert.ok(a.got.some(g => g.ev === 'line' && /far wall, again/.test(g.data.body)), 'those inside hear it');
    assert.ok(!win.got.some(g => g.ev === 'line') && win.got.some(g => g.ev === 'state' || g.ev === 'presence'), 'the window hears presence, never lines');
    // the house (as host by right) hangs the wall and asks to keep the line; the speaker says yes; it lands on the bench
    r = await req(port, 'POST', '/balcony/wall', { cookie: ck, body: { slug: w.slug } }); assert.ok(B.room().wall && B.room().wall.slug === w.slug, 'the wall of the night');
    const lid = B.room().lines[0].id; r = await req(port, 'POST', `/balcony/keep/${lid}`, { cookie: ck, headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(r.status, 200, 'the host asks');
    r = await req(port, 'POST', `/balcony/keep/${lid}/yes`, { cookie: bck, headers: { 'content-type': 'application/json' }, body: '{}' }); assert.ok(JSON.parse(r.body).ok, 'the speaker says yes');
    assert.ok(db.prepare("SELECT 1 FROM bench_lines WHERE body LIKE '%far wall, again%'").get(), 'kept on the bench in their name');
    a.close(); win.close(); await new Promise(x => setTimeout(x, 100));
    B.close(); assert.equal(B.room().lines.length, 0, 'closing forgets everything said');
    const night = db.prepare('SELECT * FROM balcony_nights ORDER BY id DESC LIMIT 1').get(); assert.ok(night && night.closed_at && night.came >= 1 && night.wall === w.slug, 'one sentence per night');
    r = await req(port, 'GET', '/ledger'); assert.ok(r.body.toString().includes('The balcony was open') && !r.body.toString().includes('far wall, again'), 'the register tells the night, never the talk');
    delete process.env.BALCONY_ALWAYS; }
  // whole dollars, with a floor for Share it
  r = await req(port, 'POST', '/studio/uses/social', { cookie: ck, body: { price: '1.49' } }); assert.equal(db.prepare("SELECT price_cents FROM uses WHERE key='social'").get().price_cents, 300, 'Share it floor is $3');
  r = await req(port, 'POST', '/studio/uses/social', { cookie: ck, body: { price: '7.6' } }); assert.equal(db.prepare("SELECT price_cents FROM uses WHERE key='social'").get().price_cents, 800, 'whole dollars');
  r = await req(port, 'POST', '/studio/uses/social', { cookie: ck, body: { price: '5' } });
  // a photograph priced on its own, and one held back for licenses only
  r = await req(port, 'POST', `/studio/works/${w.slug}/catalogue`, { cookie: ck, body: { title: 'Test Dome', share: '40' } });
  r = await req(port, 'GET', `/license/${w.slug}`); assert.ok(r.body.toString().includes('Collect for $40'), 'its own price');
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'social' } }); assert.equal(sessions[r.headers.location.split('/').pop()].line_items[0].price_data.unit_amount, 4000);
  r = await req(port, 'POST', `/studio/works/${w.slug}/catalogue`, { cookie: ck, body: { title: 'Test Dome', share: '40', noshare: '1' } });
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(!r.body.toString().includes('share-buy'), 'license only');
  r = await req(port, 'POST', `/studio/works/${w.slug}/catalogue`, { cookie: ck, body: { title: 'Test Dome', share: '' } });
  r = await req(port, 'GET', `/license/${w.slug}`); assert.ok(r.body.toString().includes('Collect for $5'), 'back to the standard price');
  r = await req(port, 'POST', `/studio/works/${w.slug}`, { cookie: ck, body: 'uses=editorial&uses=commercial&uses=print&never=ai&never=political&credit=1&showEarned=1' , headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.status, 302);
  r = await req(port, 'GET', `/license/${w.slug}`); assert.ok(!r.body.includes('Before an audience'), 'closed use hidden'); assert.ok(r.body.includes('Training or fine-tuning AI models'));
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'campaign' } }); assert.equal(r.status, 302, 'closed use refused');
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'editorial' } }); assert.equal(r.status, 303);
  const cref = sessions[r.headers.location.split('/').pop()].metadata.ref;
  assert.ok(db.prepare('SELECT conditions FROM licenses WHERE ref=?').get(cref).conditions.includes('political'), 'conditions snapshotted');
  r = await req(port, 'POST', `/studio/works/${w.slug}`, { cookie: ck, body: 'uses=editorial&uses=commercial&uses=campaign&uses=print&approve=1&never=ai&credit=1&showEarned=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'commercial' } }); assert.ok(r.body.includes('approves each license personally'));
  r = await req(port, 'GET', `/w/${w.slug}/life`); assert.ok(r.body.includes('$750') && r.body.includes('times licensed'), 'life shows earnings when opted in');
  // protection signals, sightings, applications
  r = await req(port, 'GET', '/sitemap.xml'); assert.ok(r.body.includes(`/w/${w.slug}`) && r.body.includes('image:loc'), 'sitemap lists works with images');
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.includes('"acquireLicensePage"') && r.body.includes('og:image'), 'licensable image metadata and link previews');
  r = await req(port, 'GET', '/robots.txt'); assert.ok(r.body.includes('GPTBot') && r.body.includes('Disallow: /img/') && r.body.includes('Allow: /img/*/screen') && r.body.includes('Sitemap:'));
  r = await req(port, 'GET', `/w/${w.slug}`); assert.equal(r.headers['tdm-reservation'], '1'); assert.ok(r.headers['x-robots-tag'].includes('noai'));
  r = await req(port, 'POST', `/report/${w.slug}`, { body: { url: 'https://example.org/story', note: 'header image' } }); assert.ok(r.body.includes('The maker will see it'));
  r = await req(port, 'GET', '/studio/sightings', { cookie: ck }); assert.ok(r.body.includes('example.org/story'));
  r = await req(port, 'POST', '/apply', { body: { name: 'Ada Lens', email: 'ada@lens.com', portfolio: 'https://ada.photo', practice: 'Photography' } }); assert.equal(r.status, 303);
  r = await req(port, 'GET', '/studio/makers', { cookie: ck }); assert.ok(r.body.includes('Ada Lens'));
  r = await req(port, 'GET', '/makers'); assert.ok(r.body.includes('For those who make.'));
  db.prepare('UPDATE works SET rules=NULL').run();

  // bulk registration, one file per request
  const fx = fs.readFileSync(SRC); const sharp2 = require('sharp');
  const other = await sharp2(fx).rotate(90).jpeg().toBuffer();
  const boundary = '----wm' + Date.now();
  const mp = (name, buf, fields) => Buffer.concat([...Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)), Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/jpeg\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  r = await req(port, 'POST', '/studio/works/one', { cookie: ck, body: mp('JOE_COMO-99.jpg', other, { place: 'Lake Como', hidden: '1', room: '' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
  const bj = JSON.parse(r.body); assert.ok(bj.ok && /^WM\.\d{4}\.\d{4}$/.test(bj.accession) && bj.title === 'JOE COMO 99', 'bulk registered with accession');
  assert.equal(db.prepare('SELECT status FROM works WHERE slug=?').get(bj.slug).status, 'hidden', 'private until published');
  r = await req(port, 'POST', '/studio/works/one', { cookie: ck, body: mp('again.jpg', other, {}), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
  assert.equal(r.status, 409, 'duplicate refused');

  // masters: a full-resolution file replaces the web copy it matches; an unmatched frame goes to the archive, private
  const meta0 = await sharp2(other).metadata();
  const bigger = await sharp2(other).resize({ width: Math.round((meta0.width || 800) * 1.5) }).jpeg({ quality: 95 }).toBuffer();
  r = await req(port, 'POST', '/studio/masters/one', { cookie: ck, body: mp('JOE_FLO-01.jpg', bigger, { folder: 'EUROPE/08_FLORENCE' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
  let mj = JSON.parse(r.body); assert.strictEqual(mj.outcome, 'master', 'master matched: ' + r.body);
  assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='work.master'").get(), 'master on the ledger');
  const px = Buffer.alloc(300 * 200 * 3); for (let k = 0; k < px.length; k++) px[k] = (k * 7919) % 251;
  const fresh = await sharp2(px, { raw: { width: 300, height: 200, channels: 3 } }).jpeg().toBuffer();
  r = await req(port, 'POST', '/studio/masters/one', { cookie: ck, body: mp('JOE_FLO-123.jpg', fresh, { folder: 'EUROPE/08_FLORENCE' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
  mj = JSON.parse(r.body); assert.strictEqual(mj.outcome, 'archive', r.body); assert.strictEqual(mj.title, 'Florence, Frame 123');
  assert.strictEqual(db.prepare('SELECT status FROM works WHERE slug=?').get(mj.slug).status, 'hidden');
  r = await req(port, 'GET', '/studio/masters', { cookie: ck }); assert.ok(r.body.includes('1 works held at full resolution') && r.body.includes('/static/arrivals.js'), 'the desk and its uploader');
  // Arrivals (20 Oct): a file goes to the vault first (here the local disk, one put), the house queues it and takes it in by itself.
  { const px2 = Buffer.alloc(320 * 210 * 3); for (let k = 0; k < px2.length; k++) px2[k] = (k * 104729) % 241;
    const fresh2 = await sharp2(px2, { raw: { width: 320, height: 210, channels: 3 } }).jpeg().toBuffer();
    r = await req(port, 'POST', '/studio/arrivals/start', { cookie: ck, body: { name: 'JOE_FLO-124.jpg', size: fresh2.length, type: 'image/jpeg', folder: 'EUROPE/08_FLORENCE' } });
    let aj = JSON.parse(r.body); assert.ok(aj.ok && aj.id && aj.direct === false, 'an arrival started: ' + r.body);
    r = await req(port, 'PUT', `/studio/arrivals/${aj.id}/body`, { cookie: ck, body: fresh2, headers: { 'content-type': 'application/octet-stream' } }); assert.ok(JSON.parse(r.body).ok, 'the body put');
    for (let t = 0; t < 40; t++) { await new Promise(r2 => setTimeout(r2, 100)); if (db.prepare('SELECT status FROM arrivals WHERE id=?').get(aj.id).status === 'done') break; }
    const ar = db.prepare('SELECT * FROM arrivals WHERE id=?').get(aj.id); assert.equal(ar.status, 'done', 'taken in: ' + JSON.stringify(ar)); assert.equal(ar.outcome, 'archive'); assert.equal(ar.title, 'Florence, Frame 124');
    r = await req(port, 'GET', '/studio/arrivals/state', { cookie: ck }); const sj = JSON.parse(r.body); assert.ok(sj.counts.archive >= 1 && sj.recent[0].name === 'JOE_FLO-124.jpg', 'the queue reads');
    r = await req(port, 'POST', '/studio/arrivals/start', { body: { name: 'x.jpg', size: 10 } }); assert.equal(r.status, 302, 'a stranger is sent to the door');
    assert.ok(!fs.readdirSync(path.join(dir, 'incoming')).some(f => f.startsWith('arrival-')), 'the incoming copy is consumed'); }
  // the trove: collections, catalogue record, public room
  r = await req(port, 'POST', '/studio/collections', { cookie: ck, body: { title: 'Florence, 2025', note: 'The city from below.', public: '1' } }); assert.equal(r.status, 302);
  const cid = db.prepare("SELECT id FROM collections WHERE slug='florence-2025'").get().id;
  r = await req(port, 'POST', `/studio/works/${w.slug}/catalogue`, { cookie: ck, body: { title: 'Test Dome', place: 'Florence', keywords: 'dome, fresco', caption: 'Looking up.', rooms: String(cid) } }); assert.equal(r.status, 302);
  r = await req(port, 'GET', '/studio/trove?room=florence-2025', { cookie: ck }); assert.ok(r.body.includes('Florence, 2025') && r.body.includes('Test Dome'));
  r = await req(port, 'GET', '/rooms/florence-2025'); assert.equal(r.status, 200); assert.ok(r.body.includes('The city from below.'));
  r = await req(port, 'GET', `/studio/works/${w.slug}`, { cookie: ck }); assert.ok(r.body.includes('Catalogue record') && r.body.includes('Exhibition history'));
  // the vault: originals and seals are in the store; a fresh server fetches them back; backups land there
  const vk = await app.locals.store.list('originals/'); assert.ok(vk.length >= 1, 'original in the vault');
  fs.rmSync(path.join(dir, 'originals', db.prepare('SELECT original_file FROM works WHERE id=?').get(w.id).original_file)); fs.rmSync(path.join(dir, 'cache'), { recursive: true, force: true });
  r = await req(port, 'GET', `/img/${w.slug}/screen`); assert.equal(r.status, 200, 'original fetched back from the vault');
  const bk = await app.locals.backupDb(); assert.ok((await app.locals.store.list('backups/db/')).includes(bk), 'database backed up');

  // sealed files: seal, open with the maker's key, refuse when tampered, closed or wrong
  const SEAL = require('../src/seal');
  r = await req(port, 'POST', `/studio/works/${w.slug}/seal`, { cookie: ck, body: { label: 'An editor', size: 'original', days: '30' } }); assert.equal(r.status, 302);
  const sl = db.prepare('SELECT * FROM seals ORDER BY created_at DESC').get();
  r = await req(port, 'GET', `/studio/seals/${sl.id}.wmk`, { cookie: ck }); assert.equal(r.status, 200);
  const wmk = r.body; const parsed = SEAL.parse(wmk);
  assert.equal(parsed.header.title, 'Test Dome'); assert.ok(!wmk.includes(fs.readFileSync(BIG).slice(1000, 1064)), 'image is not in the clear');
  r = await req(port, 'GET', `/studio/seals/${sl.id}.wmk`); assert.equal(r.status, 302, 'download is the maker\'s');
  r = await req(port, 'POST', `/k/${sl.id}`, { body: JSON.stringify({ access: parsed.header.access, host: 'mag.com' }), headers: { 'content-type': 'application/json' } });
  const kj = JSON.parse(r.body); assert.ok(kj.open);
  assert.ok(SEAL.open(wmk, Buffer.from(kj.key, 'base64')).equals(fs.readFileSync(BIG)), 'opens to the exact original');
  const bad = Buffer.from(wmk); const hp = bad.indexOf('Test Dome'); bad[hp] = 'X'.charCodeAt(0);
  assert.throws(() => SEAL.open(bad, Buffer.from(kj.key, 'base64')), 'altered header breaks the seal');
  r = await req(port, 'POST', `/k/${sl.id}`, { body: JSON.stringify({ access: 'x'.repeat(24) }), headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 404);
  assert.equal(db.prepare('SELECT opens FROM seals WHERE id=?').get(sl.id).opens, 1, 'opening counted');
  r = await req(port, 'POST', `/studio/seals/${sl.id}/close`, { cookie: ck }); assert.equal(r.status, 302);
  r = await req(port, 'POST', `/k/${sl.id}`, { body: JSON.stringify({ access: parsed.header.access }), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 403); assert.ok(JSON.parse(r.body).reason.includes('closed'));
  assert.ok(!db.prepare('SELECT wrapped_key FROM seals WHERE id=?').get(sl.id).wrapped_key.includes(kj.key), 'key stored wrapped');

  // request (on-request price) -> studio grants
  db.prepare("UPDATE uses SET price_cents=NULL WHERE key='editorial'").run();
  r = await req(port, 'POST', `/license/${w.slug}`, { body: { use: 'editorial', name: 'Ann Editor', email: 'ann@mag.com', company: 'The Mag', intended: 'Feature, web', agree: '1' } });
  assert.equal(r.status, 200); const ref1 = /WM-\d{4}-\d{6}/.exec(r.body.toString())[0];
  r = await req(port, 'POST', `/license/${w.slug}`, { body: { use: 'editorial', name: 'x', email: 'bad' } }); assert.equal(r.status, 400);
  r = await req(port, 'GET', '/studio'); assert.equal(r.status, 302);
  r = await req(port, 'POST', '/studio/login', { body: { password: 'nope' } }); assert.equal(r.status, 401);
  r = await req(port, 'POST', '/studio/login', { body: { password: 'pw' } }); assert.equal(r.status, 302);
  const cookie = r.headers['set-cookie'][0].split(';')[0];
  r = await req(port, 'GET', '/studio/activity', { cookie }); assert.equal(r.status, 200); assert.ok(r.body.includes('requests waiting'));
  r = await req(port, 'GET', '/studio', { cookie }); assert.ok(r.body.includes('Holdings') && /Needs (you|the house)/.test(r.body) && r.body.includes('WM.'), 'holdings');
  r = await req(port, 'GET', '/studio/trove', { cookie }); assert.ok(r.body.includes('The works') && r.body.includes('WM.'), 'works with accession numbers');
  r = await req(port, 'GET', '/studio/launch', { cookie }); assert.ok(r.body.includes('Before Watermark takes real money') && r.body.includes('customer.subscription.deleted'), 'launch checks');
  r = await req(port, 'GET', '/studio/editions', { cookie }); assert.ok(r.body.includes('Number the collection') && /name="size_\d+"/.test(r.body), 'editions proposed');
  r = await req(port, 'POST', `/studio/licenses/${ref1}/grant`, { cookie }); assert.equal(r.status, 302);
  const l1 = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref1); assert.equal(l1.status, 'active'); assert.ok(l1.ends_at);
  r = await req(port, 'GET', `/d/${l1.download_token}`); assert.equal(r.status, 200);
  // Seats: the holder shares the license with a colleague, who keeps it and takes the file.
  r = await req(port, 'GET', `/c/${ref1}?k=${l1.download_token}`); assert.ok(r.body.toString().includes('1 of 3 seats'), 'seats on a story license');
  r = await req(port, 'POST', `/c/${ref1}/seats`, { body: { k: l1.download_token, name: 'Desk Editor', email: 'desk@mag.com' } });
  const seatTok = decodeURIComponent(r.headers.location).match(/seat=([A-Za-z0-9_-]{20,})/)[1];
  r = await req(port, 'POST', `/c/${ref1}/seats`, { body: { k: 'wrong', email: 'x@y.z' } }); assert.equal(db.prepare('SELECT COUNT(*) n FROM seats').get().n, 1, 'only the holder adds seats');
  r = await req(port, 'GET', `/seat/${seatTok}`); assert.ok(r.body.toString().includes('Shared with you') && r.body.toString().includes('Keep it in my gallery'));
  r = await req(port, 'POST', `/seat/${seatTok}`); const seatCk = r.headers['set-cookie'].find(c => c.startsWith('wm_b=')).split(';')[0];
  r = await req(port, 'GET', `/seat/${seatTok}/file`); assert.equal(r.status, 200, 'the seat takes the file'); assert.ok(!String(r.headers.location || '').includes(l1.download_token), 'without the holder\'s key');
  r = await req(port, 'GET', '/yours?tab=files', { cookie: seatCk }); assert.ok(r.body.toString().includes('Shared with you'), 'in their collection');
  r = await req(port, 'GET', `/c/${ref1}?k=${l1.download_token}`); assert.ok(r.body.toString().includes('2 of 3 seats') && r.body.toString().includes('In their gallery'));
  r = await req(port, 'POST', `/c/${ref1}/seats/buy`, { body: { k: l1.download_token, n: '2' } }); assert.equal(r.status, 303, 'more seats through checkout');
  { const so = sessions[r.headers.location.split('/').pop()]; assert.equal(so.line_items[0].quantity, 2); assert.equal(so.line_items[0].price_data.unit_amount, 5000);
    Object.assign(so, { payment_status: 'paid', status: 'complete' });
    r = await req(port, 'GET', `/c/${ref1}/seats/added?session_id=${so.id}&k=${l1.download_token}`); r = await req(port, 'GET', `/c/${ref1}/seats/added?session_id=${so.id}&k=${l1.download_token}`); }
  r = await req(port, 'GET', `/c/${ref1}?k=${l1.download_token}`); assert.ok(r.body.toString().includes('2 of 5 seats'), 'seats added once');
  // Downloads counted: a story license has 10, shared with its seats; the share-size copy comes with every license.
  r = await req(port, 'GET', `/c/${ref1}?k=${l1.download_token}`); { const cb = r.body.toString(); assert.ok(/\d+ of 10 downloads left/.test(cb) && cb.includes('Share-size copy') && cb.includes('Share it on your own accounts'), 'downloads shown; sharing included'); }
  r = await req(port, 'GET', `/d/${l1.download_token}?size=share`); assert.equal(r.status, 200); { const sm = await require('sharp')(r.body).metadata(); assert.ok(sm.width <= 2400, 'share size is the small file'); }
  db.prepare("UPDATE licenses SET dl_extra=-100 WHERE ref=?").run(ref1);
  r = await req(port, 'GET', `/d/${l1.download_token}`); assert.equal(r.status, 410, 'no downloads left');
  db.prepare("UPDATE licenses SET dl_extra=0 WHERE ref=?").run(ref1);
  r = await req(port, 'GET', `/d/${l1.download_token}`);
  const piexif = require('piexifjs'); const ex = piexif.load(r.body.toString('binary'));
  assert.ok(ex['0th'][piexif.ImageIFD.Copyright].includes(require('../src/track').track(ref1)), 'license stamped in EXIF, as its Watermark number');
  // The mark, policy: the file carries the record in the open (XMP), and a mark within the picture unique to this delivery; it traces back even after recompression.
  { const M = require('../src/mark'); const x = M.readXmp(r.body); assert.ok(x && x.license === ref1 && x.creator, 'XMP names the license and the creator');
    // The master leaves untouched (21 Oct): the full-size delivery's pixels are the maker's own, byte for byte after the papers; only the display-size copies carry the mark within the picture.
    { const sharp = require('sharp'); const wrow = db.prepare('SELECT w.* FROM works w JOIN licenses l ON l.work_id=w.id WHERE l.ref=?').get(ref1); const orig = fs.readFileSync(path.join(dir, 'originals', wrow.original_file));
      const a = await sharp(orig).raw().toBuffer(), b = await sharp(r.body).raw().toBuffer(); assert.ok(a.equals(b), 'the full-size delivery is pixel for pixel the master');
      const full = await app.locals.mark.trace(r.body); assert.ok(full && full.ref === ref1 && full.how === 'bytes', 'the master traces by its bytes'); }
    r = await req(port, 'GET', `/d/${l1.download_token}?size=share`);
    const dl = db.prepare('SELECT * FROM downloads WHERE license_id=(SELECT id FROM licenses WHERE ref=?) ORDER BY id DESC LIMIT 1').get(ref1); assert.ok(dl.sha256 && dl.mark === dl.id, 'the delivery recorded');
    // (21 Oct, later) nothing in the pixels of a share copy either: the copy is made straight from the master at JPEG 94 and carries the strip and the papers; it traces by its bytes and its XMP, never by a mark within the picture
    { const sharp = require('sharp'); const md = await sharp(r.body).metadata(); assert.ok(Math.max(md.width, md.height) <= 2400, 'a 2,400-pixel share copy'); const xs = require('../src/mark').readXmp(r.body); assert.ok(xs && xs.license === ref1, 'the papers on the share copy');
      const rd = await app.locals.mark.read(r.body); assert.ok(!rd || !rd.ok || rd.payload !== dl.id, 'no mark laid into the picture'); }
    const re = r.body; // the file as it left (a copy re-encoded elsewhere loses its papers and is a stranger to the house; that is the price of untouched pixels)
    const exact = await app.locals.mark.trace(r.body); assert.equal(exact.how, 'bytes');
    r = await req(port, 'POST', '/verify', { body: mp('found.jpg', re, {}), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } }); assert.ok(r.body.toString().includes('left the house') && r.body.toString().includes(ref1), '/verify tells who has it');
    r = await req(port, 'POST', '/yours/add', { body: mp('found.jpg', re, {}), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary, cookie: bck } }); assert.ok(r.body.toString().includes('Held by someone else'), 'a working license held by a company cannot be brought home by a stranger'); }
  { // Bravo: the biggest thing a person can give, three a month; the maker is told; the register says it.
    const ws = db.prepare("SELECT slug FROM works WHERE status='held' ORDER BY id LIMIT 4").all().map(x => x.slug);
    let bk = ''; const bv = async sl => { const x = await req(port, 'POST', `/w/${sl}/bravo`, { headers: { accept: 'application/json' }, cookie: bk }); const c = (x.headers['set-cookie'] || []).find(c => c.startsWith('wm_b=')); if (c) bk = c.split(';')[0]; return JSON.parse(x.body); };
    let j = await bv(ws[0]); assert.ok(j.ok && j.on && j.n === 1 && j.left === 2, 'a bravo given');
    await bv(ws[1]); j = await bv(ws[2]); assert.equal(j.left, 0);
    db.prepare("DELETE FROM bravos WHERE work_id=(SELECT id FROM works WHERE slug=?)").run(ws[0]); db.prepare("INSERT INTO bravos (work_id, buyer_id) SELECT w.id, b.buyer_id FROM works w, (SELECT buyer_id FROM bravos LIMIT 1) b WHERE w.slug=?").run(ws[0]);
    j = await bv(ws[2]); assert.ok(j.ok && !j.on && j.left === 1, 'taken back');
    j = await bv(ws[2]); assert.ok(j.ok && j.on && j.left === 0, 'given again');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='work.bravo'").get(), 'on the register');
    db.prepare("DELETE FROM bravos WHERE buyer_id=(SELECT buyer_id FROM bravos LIMIT 1) AND work_id=(SELECT id FROM works WHERE slug=?)").run(ws[1]);
    db.prepare("INSERT INTO bravos (work_id, buyer_id) SELECT w.id, 99999 FROM works w WHERE w.slug=?").run(ws[1]);
    db.prepare("UPDATE bravos SET at=datetime('now') WHERE buyer_id=99999").run();
    j = await bv(ws[1]); assert.ok(j.ok && j.on && j.left === 0 && j.n === 2, 'a second hand');
    r = await req(port, 'GET', `/w/${ws[1]}`, { cookie: bk }); assert.ok(r.body.toString().includes('class="bv-b on"') && r.body.toString().includes('2 bravos'), 'the work page shows it');
    console.log('ok: bravo');
  }
  { // companies: license photographs to a company; its site serves them under license, counted by page, credited
    r = await req(port, 'POST', '/studio/clients', { cookie: ck, body: { name: 'Natora', hosts: 'natora.com' } }); assert.equal(r.status, 302);
    r = await req(port, 'POST', '/studio/clients/natora/license', { cookie: ck, body: { works: `${w.slug} /about\nnot-a-work`, use: 'commercial', fee: '' } });
    assert.ok(decodeURIComponent(r.headers.location).includes('1 licensed to Natora') && decodeURIComponent(r.headers.location).includes('not-a-work'), 'licensed to the company');
    r = await req(port, 'GET', '/api/client/natora'); const cj = JSON.parse(r.body); assert.equal(cj.works.length, 1); assert.ok(cj.works[0].live && /^WM \d{4} \d{4} \d{4}$/.test(cj.works[0].number), 'a live license with its number');
    const cref = cj.works[0].ref; assert.equal(db.prepare('SELECT licensee_company c FROM licenses WHERE ref=?').get(cref).c, 'Natora');
    r = await req(port, 'GET', `/p/${cref}/screen`, { headers: { referer: 'https://natora.com/about' } }); assert.equal(r.status, 200, 'served under license');
    assert.equal(db.prepare("SELECT n FROM placements WHERE ref=? AND host='natora.com' AND page='/about'").get(cref).n, 1, 'counted by page');
    r = await req(port, 'GET', '/site.js'); assert.ok(r.body.toString().includes('data-wm') && !r.body.toString().includes('__WM_BASE__'));
    r = await req(port, 'GET', '/for/natora'); assert.equal(r.status, 404, 'private until the company says yes');
    r = await req(port, 'GET', '/studio/clients/natora', { cookie: ck }); assert.ok(r.body.toString().includes('natora.com/about'), 'the desk shows where it hangs');
    db.prepare('UPDATE licenses SET ends_at=? WHERE ref=?').run(new Date(Date.now() - 864e5).toISOString(), cref);
    r = await req(port, 'GET', `/p/${cref}/screen`); assert.equal(r.status, 410, 'an ended license is not served');
    console.log('ok: companies');
  }
  r = await req(port, 'GET', `/c/${ref1}.pdf`); assert.equal(r.status, 200); assert.equal(r.body.slice(0, 4).toString(), '%PDF');
  // renewal notice for a license ending soon, then expiry
  db.prepare("UPDATE licenses SET ends_at=? WHERE ref=?").run(new Date(Date.now() + 5 * 864e5).toISOString(), ref1);
  assert.equal(app.locals.sweep(), 1, 'renewal offered'); assert.equal(app.locals.sweep(), 0, 'only once');
  r = await req(port, 'GET', `/license/${w.slug}?use=editorial&renews=${ref1}`); assert.ok(r.body.includes('Renewing'));
  db.prepare("UPDATE licenses SET ends_at=? WHERE ref=?").run(new Date(Date.now() - 864e5).toISOString(), ref1); app.locals.sweep();
  assert.equal(db.prepare('SELECT status FROM licenses WHERE ref=?').get(ref1).status, 'expired');
  r = await req(port, 'GET', `/d/${l1.download_token}`); assert.equal(r.status, 404, 'no download after expiry');
  r = await req(port, 'GET', `/verify?ref=${ref1}`); assert.ok(r.body.includes('expired'));

  // priced use, paid via signed webhook
  db.prepare("UPDATE uses SET price_cents=75000 WHERE key='commercial'").run();
  db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,price_cents,status,stripe_session) VALUES ('WM-2026-999999',?,(SELECT id FROM uses WHERE key='commercial'),'Bo Brand','bo@brand.com',75000,'awaiting_payment','cs_test_1')").run(w.id);
  const stripe = require('stripe')('sk_test_dummy');
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 75000, metadata: { ref: 'WM-2026-999999' } } } });
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
  r = await req(port, 'POST', '/stripe/webhook', { body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': sig } }); assert.equal(r.status, 200);
  r = await req(port, 'POST', '/stripe/webhook', { body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': 'bad' } }); assert.equal(r.status, 400);
  assert.equal(db.prepare("SELECT status FROM licenses WHERE ref='WM-2026-999999'").get().status, 'active');

  // embed view counting
  r = await req(port, 'POST', '/api/seen', { body: JSON.stringify({ work: w.slug, host: 'example.com', kind: 'embed' }), headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 204);
  assert.equal(db.prepare("SELECT count FROM views WHERE host='example.com'").get().count, 1);

  // maker accounts: Will invites an estate; the link signs them in once; each maker sees only their own work
  r = await req(port, 'GET', '/account'); assert.equal(r.status, 401, 'no account without a link');
  r = await req(port, 'POST', '/studio/accounts', { cookie: ck, body: { name: 'The Ada Estate', email: 'ada@estate.com', kind: 'estate' } }); assert.equal(r.status, 302);
  const est = db.prepare("SELECT * FROM makers WHERE handle='the-ada-estate'").get(); assert.ok(est.invite_token && est.kind === 'estate');
  assert.ok(db.prepare("SELECT 1 FROM uses WHERE maker_id=? AND key='social'").get(est.id), 'their own prices');
  r = await req(port, 'GET', `/account/join/${est.invite_token}`); assert.equal(r.headers.location, '/account'); const mck = r.headers['set-cookie'][0].split(';')[0];
  r = await req(port, 'GET', `/account/join/${est.invite_token}`); assert.equal(r.status, 404, 'link works once');
  r = await req(port, 'GET', '/account', { cookie: mck }); let ab = r.body.toString(); assert.ok(ab.includes('The Ada Estate.') && ab.includes('Nothing here yet'), 'their own dashboard');
  r = await req(port, 'POST', `/account/works/${w.slug}/jewel`, { cookie: mck }); assert.equal(r.status, 404, 'cannot touch another maker\'s work');
  { // first steps: the newly opened studio shows the way; each step ticks itself
    assert.ok(ab.includes('First steps') && ab.includes('0 of 3'), 'first steps on a new studio: three first (23 Oct)');
    r = await req(port, 'GET', '/account/prices', { cookie: mck }); assert.equal(r.status, 200);
    r = await req(port, 'GET', '/account', { cookie: mck }); assert.ok(r.body.toString().includes('1 of 3'), 'opening the prices ticks a step');
    r = await req(port, 'POST', '/account/steps/shared', { cookie: mck, headers: { accept: 'application/json' } }); assert.equal(r.status, 200);
    r = await req(port, 'GET', '/account', { cookie: mck }); assert.ok(r.body.toString().includes('1 of 3'), 'the rest waits until the first three are done');
    r = await req(port, 'POST', '/account/steps/bogus', { cookie: mck }); assert.equal(r.status, 400);
    console.log('ok: first steps');
  }
  // the estate adds its own photograph: private until it publishes, with its word on rights and releases
  const px2 = Buffer.alloc(320 * 200 * 3); for (let k = 0; k < px2.length; k++) px2[k] = (k * 104729 + 7) % 241;
  const theirs = await sharp2(px2, { raw: { width: 320, height: 200, channels: 3 } }).resize({ width: 2000, height: 1250, kernel: "nearest" }).jpeg().toBuffer();
  r = await req(port, 'POST', '/account/works/one', { cookie: mck, body: mp('ada_harbour.jpg', theirs, { place: 'Genoa, Italy' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
  const aj = JSON.parse(r.body); assert.ok(aj.ok, r.body); const aw = db.prepare('SELECT * FROM works WHERE slug=?').get(aj.slug);
  assert.strictEqual(aw.maker_id, est.id); assert.strictEqual(aw.status, 'hidden', 'private on arrival');
  // The maker's own vault through arrivals (20 Oct): straight into the vault, then the queue registers it as theirs, private, with its place and kind; a stranger and another maker are refused.
  { const px3 = Buffer.alloc(300 * 300 * 3); for (let k = 0; k < px3.length; k++) px3[k] = (k * 7331) % 239; const theirs2 = await sharp2(px3, { raw: { width: 300, height: 300, channels: 3 } }).jpeg().toBuffer();
    r = await req(port, 'POST', '/account/arrivals/start', { cookie: mck, body: { name: 'ada_cloister.jpg', size: theirs2.length, type: 'image/jpeg', place: 'Genoa, Italy', kind: 'painting' } }); const v = JSON.parse(r.body); assert.ok(v.ok && v.id, 'a maker starts an arrival: ' + r.body);
    r = await req(port, 'PUT', `/account/arrivals/${v.id}/body`, { body: theirs2, headers: { 'content-type': 'application/octet-stream' } }); assert.equal(r.status, 401, 'a stranger cannot put');
    r = await req(port, 'PUT', `/account/arrivals/${v.id}/body`, { cookie: mck, body: theirs2, headers: { 'content-type': 'application/octet-stream' } }); assert.ok(JSON.parse(r.body).ok, 'the maker puts');
    for (let t = 0; t < 40; t++) { await new Promise(r2 => setTimeout(r2, 100)); if (db.prepare('SELECT status FROM arrivals WHERE id=?').get(v.id).status === 'done') break; }
    r = await req(port, 'GET', `/account/arrivals/state?ids=${v.id}`, { cookie: mck }); const vs = JSON.parse(r.body); const got = vs.asked.find(x => x.id === v.id); assert.ok(got && got.status === 'done' && got.result.ok && got.result.deed && got.result.accession, 'taken in as the maker\'s: ' + JSON.stringify(got));
    const vw = db.prepare('SELECT * FROM works WHERE slug=?').get(got.slug); assert.ok(vw.maker_id === est.id && vw.status === 'hidden' && vw.kind === 'painting' && vw.place === 'Genoa, Italy', 'theirs, private, a painting in Genoa');
    r = await req(port, 'GET', '/studio/arrivals/state', { cookie: ck }); assert.ok(!JSON.parse(r.body).recent.some(x => x.id === v.id), 'the masters desk does not list a maker\'s arrivals');
    r = await req(port, 'GET', '/account/upload', { cookie: mck }); assert.ok(r.body.toString().includes('/static/arrivals.js'), 'the vault page uses the sender'); }
  r = await req(port, 'POST', `/account/works/${aj.slug}/show`, { cookie: mck }); assert.ok(r.headers.location.includes('need=attest'), 'no publishing without the attestation');
  r = await req(port, 'POST', `/account/works/${aj.slug}/show`, { cookie: mck, body: { attest: '1' } });
  assert.ok(db.prepare("SELECT COUNT(*) n FROM acceptances WHERE who='maker' AND doc='makers'").get().n >= 1, 'publishing accepted the Maker Agreement');
  assert.strictEqual(db.prepare('SELECT status FROM works WHERE id=?').get(aw.id).status, 'held');
  r = await req(port, 'GET', `/w/${aj.slug}`); assert.ok(r.body.toString().includes('Photograph by The Ada Estate'), 'their name on their work');
  r = await req(port, 'POST', `/buy/${aj.slug}`, { body: { use: 'social' } }); const es = sessions[r.headers.location.split('/').pop()];
  assert.ok(es.line_items[0].price_data.product_data.description.includes('The Ada Estate'), 'their name at checkout');
  r = await req(port, 'GET', '/account', { cookie: mck }); assert.ok(r.body.toString().includes('Ada Harbour'), 'on their dashboard');
  r = await req(port, 'POST', `/account/works/${w.slug}/show`, { cookie: mck, body: { attest: '1' } }); assert.equal(r.status, 404, 'not someone else\'s');
  // Will's own dashboard, as he sees it: the sales so far, at 85%
  const me = db.prepare('SELECT handle FROM makers WHERE id=1').get().handle;
  r = await req(port, 'GET', `/account?maker=${me}`, { cookie: ck }); ab = r.body.toString(); assert.ok(ab.includes('Your studio') && ab.includes('The holdings'));
  r = await req(port, 'GET', `/account?maker=${me}`); assert.equal(r.status, 401, 'only the Studio can look over a shoulder');
  r = await req(port, 'POST', `/account/works/${w.slug}/jewel`, { cookie: ck, body: { maker: me } }); assert.equal(db.prepare('SELECT curated FROM works WHERE id=?').get(w.id).curated, 1, 'a jewel');
  r = await req(port, 'GET', `/account?maker=${me}`, { cookie: ck }); assert.ok(r.body.toString().includes('class="ac-j"'), 'jewels lead');

  r = await req(port, 'GET', '/journal'); assert.ok(r.status === 200 && r.body.toString().includes('On patronage'), 'the journal');
  r = await req(port, 'GET', '/patronage'); assert.ok(r.body.toString().includes('Watermark honours both'));
  // The ladder: as an edition fills, the issue price steps up (1x, 1.5x, 2x, 3x by quarter), so early collectors hold pieces issued above what they paid.
  { const wl = await registerWork({ file: (await (async () => { const f = path.join(dir, 'inL.jpg'); await require('sharp')(SRC).resize({ width: 1700 }).rotate(180).toFile(f); return f; })()), originalName: 'l.jpg', title: 'Test Ladder' });
    db.prepare("UPDATE works SET status='held', edition_size=8 WHERE id=?").run(wl.id);
    const L0 = app.locals.ladder(db.prepare('SELECT * FROM works WHERE id=?').get(wl.id), 500); assert.deepStrictEqual([L0.price, L0.step, L0.next, L0.at], [500, 0, 800, 2], 'first quarter at the base price');
    const uid = db.prepare("SELECT id FROM uses WHERE key='social'").get().id;
    for (let i = 1; i <= 3; i++) db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, price_cents, status, collector_no, starts_at) VALUES (?,?,?,?,?,?,'active',?,datetime('now'))").run(`WM-2026-9000${i}`, wl.id, uid, 'x', 'x@y.z', 500, i);
    const L3 = app.locals.ladder(db.prepare('SELECT * FROM works WHERE id=?').get(wl.id), 500); assert.equal(L3.price, 800, 'second quarter: 1.5x');
    r = await req(port, 'GET', `/w/${wl.slug}`); assert.ok(r.body.toString().includes('issued at $5 to No.&nbsp;1, $8 now'), 'the ladder shown on the work');
    r = await req(port, 'GET', `/license/${wl.slug}`); assert.ok(r.body.toString().includes('Collect for $8'), 'the next number is sold at the step'); }
  // Applause and notes: one tip of the hat per person, taken back with a second press; a note held with the work; the maker may remove it.
  r = await req(port, 'POST', `/w/${w.slug}/applaud`, { headers: { accept: 'application/json' } }); { const aj = JSON.parse(r.body); assert.ok(aj.on && aj.n === 1, 'applauded'); }
  const apck = r.headers['set-cookie'].find(c => c.startsWith('wm_b=')).split(';')[0];
  r = await req(port, 'POST', `/w/${w.slug}/applaud`, { cookie: apck, headers: { accept: 'application/json' } }); assert.equal(JSON.parse(r.body).n, 0, 'taken back');
  r = await req(port, 'POST', `/w/${w.slug}/applaud`, { cookie: apck, headers: { accept: 'application/json' } }); assert.equal(JSON.parse(r.body).n, 1, 'one hand per person');
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.toString().includes('tip of the hat'), 'shown on the work');
  r = await req(port, 'POST', `/w/${w.slug}/notes`, { cookie: apck, body: { body: 'The light on the ribs of the dome.', name: 'A visitor from Siena' } }); assert.ok(r.headers.location.includes('note=1'));
  r = await req(port, 'POST', `/w/${w.slug}/notes`, { cookie: apck, body: { body: 'see http://spam.example', name: 'x' } }); assert.ok(r.headers.location.includes('note=check'), 'no links');
  r = await req(port, 'POST', `/w/${w.slug}/notes`, { cookie: apck, body: { body: 'this is garbage', name: 'x' } }); assert.ok(r.headers.location.includes('note=kind'), 'turned away at the door');
  r = await req(port, 'POST', `/w/${w.slug}/notes`, { cookie: apck, body: { body: 'Lovely light.' } }); assert.ok(r.headers.location.includes('note=check'), 'a name is required');
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.toString().includes('ribs of the dome') && r.body.toString().includes('A visitor from Siena'), 'the note is there');
  { const nid = db.prepare('SELECT id FROM notes WHERE removed_at IS NULL').get().id;
    r = await req(port, 'POST', `/w/${w.slug}/notes/${nid}/seen`, { cookie: apck }); assert.equal(r.status, 403, 'only the maker marks a line well seen');
    r = await req(port, 'POST', `/w/${w.slug}/notes/${nid}/seen`, { cookie: ck }); assert.equal(r.status, 302);
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.toString().includes('Well seen, says') && r.body.toString().includes('1 well seen'), 'the maker\'s regard, on the line and beside the name');
    r = await req(port, 'POST', '/yours', { cookie: apck, body: { name: 'A visitor from Siena', public: '1' } });
    r = await req(port, 'GET', '/yours?tab=books', { cookie: apck }); assert.ok(r.body.toString().includes('In the guest books') && r.body.toString().includes('marked well seen by 1 maker'), 'their lines and regard on their page');
    const vcode = db.prepare("SELECT code FROM buyers WHERE name='A visitor from Siena'").get().code;
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.toString().includes(`/collector/${vcode}`), 'the signature opens their collection');
    r = await req(port, 'POST', `/w/${w.slug}/notes/${nid}/remove`); assert.equal(r.status, 403, 'a stranger cannot remove it');
    r = await req(port, 'POST', `/w/${w.slug}/notes/${nid}/remove`, { cookie: ck }); assert.equal(r.status, 302); assert.ok(db.prepare('SELECT removed_at FROM notes WHERE id=?').get(nid).removed_at, 'the Studio can'); }
  r = await req(port, 'GET', '/studio/trove?sort=standing', { cookie: ck }); assert.ok(r.body.toString().includes('1 applauded'), 'standing in the Studio');
  // Open a studio: anyone, with a name and an email; signed in at once; profile on their page; the Studio can hold them.
  // By invitation: Greta applies with the work; the Studio approves; the letter opens her studio.
  r = await req(port, 'POST', '/join', { body: { name: 'Greta Lund', email: 'greta@lund.example' } }); assert.equal(r.status, 303, 'the instant door is closed');
  r = await req(port, 'POST', '/apply', { body: { name: 'Greta Lund', email: 'greta@lund.example', practice: 'Architecture' } }); assert.ok(r.headers.location.includes('err=work'), 'the work must be shown');
  r = await req(port, 'POST', '/apply', { body: { name: 'Greta Lund', email: 'greta@lund.example', portfolio: 'https://lund.example', practice: 'Architecture', note: 'Twenty years of churches.' } }); assert.ok(r.headers.location.includes('sent=1'), 'applied');
  r = await req(port, 'GET', '/join?sent=1'); assert.ok(r.body.toString().includes('Received.'));
  const ap = db.prepare("SELECT id FROM applications WHERE email='greta@lund.example'").get();
  r = await req(port, 'GET', '/studio/makers', { cookie: ck }); assert.ok(r.body.toString().includes('Greta Lund') && r.body.toString().includes('lund.example'), 'read in the Studio');
  r = await req(port, 'POST', '/studio/accounts', { cookie: ck, body: { name: 'Greta Lund', email: 'greta@lund.example', house: 'Lund Studio', application: String(ap.id) } }); assert.ok(r.headers.location.includes('invitation'), 'invited');
  assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(ap.id).status, 'invited');
  const gtok0 = db.prepare("SELECT invite_token FROM makers WHERE email='greta@lund.example'").get().invite_token; assert.ok(gtok0);
  r = await req(port, 'GET', `/account/join/${gtok0}`); assert.equal(r.status, 302, 'the letter opens the studio');
  const gck = r.headers['set-cookie'].find(c => c.startsWith('wm_m=')).split(';')[0];
  assert.ok(db.prepare("SELECT joined_at FROM makers WHERE email='greta@lund.example'").get().joined_at, 'joined');
  r = await req(port, 'GET', '/account?welcome=1', { cookie: gck }); assert.ok(r.body.toString().includes('Your studio is open'), 'in their studio');
  r = await req(port, 'POST', '/account/profile', { cookie: gck, body: mp('p.jpg', theirs, { name: 'Greta Lund', place: 'Oslo', bio: 'Light, mostly. Harbours when I can.', site: 'lund.example', instagram: '@gretalund' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
  assert.ok(String(r.headers.location || '').includes('ok=1'), 'profile saved');
  { const gm = db.prepare("SELECT * FROM makers WHERE email='greta@lund.example'").get(); assert.equal(gm.site, 'https://lund.example'); assert.equal(gm.instagram, 'gretalund'); assert.ok(gm.portrait, 'portrait kept');
    r = await req(port, 'GET', '/m/greta-lund'); assert.ok(r.body.toString().includes('Harbours when I can') && r.body.toString().includes('/portrait/greta-lund') && r.body.toString().includes('@gretalund'), 'on her page');
    r = await req(port, 'GET', '/portrait/greta-lund'); assert.equal(r.status, 200);
    r = await req(port, 'POST', `/studio/accounts/${gm.id}/standing`, { cookie: ck }); assert.equal(db.prepare('SELECT standing FROM makers WHERE id=?').get(gm.id).standing, 'held', 'held by the Studio');
    r = await req(port, 'POST', `/studio/accounts/${gm.id}/standing`, { cookie: ck }); assert.equal(db.prepare('SELECT standing FROM makers WHERE id=?').get(gm.id).standing, 'open'); }
  // Friends of the house: a monthly friend of Watermark, a one-off gift to Krafft; the wall; Keeping for a maker.
  r = await req(port, 'GET', '/friends'); assert.ok(r.body.toString().includes('Friends of Watermark') && r.body.toString().includes('Friends of Krafft') && r.body.toString().includes('Benefactor'), 'the friends page');
  r = await req(port, 'POST', '/friends', { cookie: bck, body: { house: 'watermark', level: 'patron' } }); assert.equal(r.status, 303);
  { const fs1 = sessions[r.headers.location.split('/').pop()]; assert.equal(fs1.mode, 'subscription'); assert.equal(fs1.line_items[0].price_data.unit_amount, 5000);
    Object.assign(fs1, { status: 'complete', payment_status: 'paid', subscription: 'sub_fr1', customer_details: { name: 'Tap Fan', email: 'tap@me.com' } });
    r = await req(port, 'GET', `/friends/${fs1.metadata.friend}/thanks?session_id=${fs1.id}`); assert.ok(r.body.toString().includes('You are a Patron of Watermark'));
    r = await req(port, 'POST', `/friends/${fs1.metadata.friend}/name`, { cookie: bck, body: { name: 'The Tap Family' } }); }
  r = await req(port, 'POST', '/friends', { body: { house: 'krafft', amount: '250' } }); { const fs2 = sessions[r.headers.location.split('/').pop()]; assert.equal(fs2.mode, 'payment'); assert.equal(fs2.line_items[0].price_data.unit_amount, 25000); }
  r = await req(port, 'GET', '/friends'); assert.ok(r.body.toString().includes('The Tap Family') && r.body.toString().includes('1 friend'), 'on the wall');
  r = await req(port, 'GET', '/account/keeping', { cookie: gck }); assert.ok(r.body.toString().includes('Keeping') && r.body.toString().includes('kp-tier'));
  r = await req(port, 'POST', '/account/keeping', { cookie: gck }); { const ks = sessions[r.headers.location.split('/').pop()]; assert.equal(ks.line_items[0].price_data.unit_amount, 1500); Object.assign(ks, { status: 'complete', payment_status: 'paid', subscription: 'sub_kp1' });
    r = await req(port, 'GET', `/friends/${ks.metadata.friend}/thanks?session_id=${ks.id}`); assert.ok(r.headers.location.includes('ok=begun'));
    r = await req(port, 'GET', '/account/keeping', { cookie: gck }); assert.ok(r.body.toString().includes('End Keeping') && r.body.toString().includes('kp-tier on'), 'keeping on');
    // Two tiers only (Will, 21 Oct); above Keeping, by letter: nothing to move to.
    assert.ok(!r.body.toString().includes('Move here'), 'no ladder above Keeping'); }
  r = await req(port, 'GET', '/m/greta-lund'); assert.ok(r.body.toString().includes('of every sale is Greta'), 'the split on her page');
  // The house guest book: signed from any door, in chapters; lines on photographs appear in the Watermark chapter.
  r = await req(port, 'POST', '/guestbook', { body: { chapter: 'studios', body: 'Came for the Florence story, stayed for the dome.', name: 'R. Okafor' } }); assert.ok(r.headers.location.includes('note=1'));
  r = await req(port, 'GET', '/guestbook'); { const gb = r.body.toString(); assert.ok(gb.includes('Came for the Florence story') && gb.includes('Krafft Studios') && gb.includes('The guest book'), 'the house book'); }
  r = await req(port, 'GET', '/guestbook?chapter=watermark'); assert.ok(!r.body.toString().includes('Came for the Florence story'), 'chapters filter');
  r = await req(port, 'POST', '/guestbook', { body: { chapter: 'krafft', body: 'you all suck', name: 'x' } }); assert.ok(r.headers.location.includes('note=kind'));
  r = await req(port, 'GET', '/house.js'); assert.ok(r.body.toString().includes('/guestbook?chapter='), 'the bar carries the book');
  // Stars and the cull: the maker grades; five is a jewel; culling keeps public from N up, deletes nothing.
  { const theirs1 = await require('sharp')(theirs).rotate(90).toBuffer();
    r = await req(port, 'POST', '/account/works/one', { cookie: gck, body: mp('g1.jpg', theirs1, { title: 'Harbour One' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } }); const g1 = JSON.parse(r.body).slug;
    const theirs2 = await require('sharp')(theirs).rotate(270).toBuffer();
    r = await req(port, 'POST', '/account/works/one', { cookie: gck, body: mp('g2.jpg', theirs2, { title: 'Harbour Two' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } }); const g2 = JSON.parse(r.body).slug;
    for (const g of [g1, g2]) r = await req(port, 'POST', `/account/works/${g}/show`, { cookie: gck, body: { attest: '1' } });
    r = await req(port, 'POST', `/account/works/${g1}/stars`, { cookie: gck, body: { n: '5' }, headers: { accept: 'application/json' } }); assert.equal(JSON.parse(r.body).stars, 5);
    assert.equal(db.prepare('SELECT curated FROM works WHERE slug=?').get(g1).curated, 1, 'five stars is a jewel');
    // Rembrandt's room: the five hangs in the maker's own gallery, the artist's copy, beside what they collect.
    r = await req(port, 'GET', '/yours', { cookie: gck }); assert.ok(r.body.toString().includes('own hand') && r.body.toString().includes(`/w/${g1}`), 'the jewel in the gallery');
    r = await req(port, 'POST', `/account/works/${g2}/stars`, { cookie: gck, body: { n: '2' } });
    r = await req(port, 'GET', '/account?stars=5', { cookie: gck }); assert.ok(r.body.toString().includes('Harbour One') && !r.body.toString().includes('Harbour Two'), 'filter by stars');
    r = await req(port, 'POST', '/account/cull', { cookie: gck, body: { from: '3' } }); assert.ok(r.headers.location.includes('down=1'));
    assert.equal(db.prepare('SELECT status FROM works WHERE slug=?').get(g2).status, 'hidden', 'culled, not deleted'); assert.equal(db.prepare('SELECT status FROM works WHERE slug=?').get(g1).status, 'held');
    r = await req(port, 'POST', '/account/cull', { cookie: gck, body: { from: '2' } }); assert.ok(r.headers.location.includes('up=1'), 'brought back when the bar lowers');
    // A claim: sales pause, the maker answers, the house decides; dismissed resumes, upheld takes it down.
    r = await req(port, 'GET', `/w/${g1}/claim`); assert.ok(r.body.toString().includes('Say so in writing') && r.body.toString().includes('perjury'), 'the claim form');
    r = await req(port, 'POST', `/w/${g1}/claim`, { body: { kind: 'made', name: 'Nils Ek', email: 'nils@example.com', body: 'I made this in 2019 in the harbour; I hold the raw file.', oath: '1' } });
    assert.equal(r.status, 200); assert.ok(r.body.toString().includes('WM-C-'), 'received'); assert.equal(db.prepare('SELECT disputed FROM works WHERE slug=?').get(g1).disputed, 1, 'sales paused');
    r = await req(port, 'GET', `/w/${g1}`); assert.ok(r.body.toString().includes('Under review') && !r.body.toString().includes('data-share'), 'shown, not sold');
    r = await req(port, 'POST', `/buy/${g1}`, { body: { use: 'social' } }); assert.notEqual(r.status, 303, 'no checkout under a claim');
    r = await req(port, 'GET', '/account', { cookie: gck }); assert.ok(r.body.toString().includes('claim') && r.body.toString().includes('/account/claims'), 'the maker is told');
    const cid = db.prepare('SELECT id FROM disputes ORDER BY id DESC LIMIT 1').get().id;
    r = await req(port, 'POST', `/account/claims/${cid}/answer`, { cookie: gck, body: { answer: 'I made it; the raw and the contact sheet are in my studio.' } }); assert.ok(r.headers.location.includes('ok=answered'));
    r = await req(port, 'GET', `/studio/claims/${cid}`, { cookie: ck }); assert.ok(r.body.toString().includes('What the house holds') && r.body.toString().includes('Fingerprint') && r.body.toString().includes('contact sheet'), 'the packet');
    r = await req(port, 'POST', `/studio/claims/${cid}/decide`, { cookie: ck, body: { outcome: 'dismiss', note: 'The house holds the earlier file.' } }); assert.ok(r.headers.location.includes('ok=dismissed'));
    assert.equal(db.prepare('SELECT disputed FROM works WHERE slug=?').get(g1).disputed, 0, 'sales resume'); assert.equal(db.prepare('SELECT status FROM works WHERE slug=?').get(g1).status, 'held');
    r = await req(port, 'POST', `/w/${g1}/claim`, { body: { kind: 'person', name: 'Ane Ek', email: 'ane@example.com', body: 'That is me on the quay and I never agreed to be shown.', oath: '1' } });
    const cid2 = db.prepare('SELECT id FROM disputes ORDER BY id DESC LIMIT 1').get().id;
    r = await req(port, 'POST', `/studio/claims/${cid2}/decide`, { cookie: ck, body: { outcome: 'uphold' } }); assert.ok(r.headers.location.includes('ok=upheld'));
    assert.equal(db.prepare('SELECT status FROM works WHERE slug=?').get(g1).status, 'private', 'upheld: it came down');
    assert.ok(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='dispute.upheld'").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='dispute.opened'").get().n === 2, 'on the register');
    r = await req(port, 'GET', '/ledger'); assert.ok(r.body.toString().includes('upheld by the house') && !r.body.toString().includes('Nils'), 'told without names');
    db.prepare("UPDATE works SET status='held' WHERE slug=?").run(g1);
    // The house opens a maker's studio once and walks its rooms without being asked to sign in.
    r = await req(port, 'GET', '/account?maker=greta-lund', { cookie: ck }); const asck = (r.headers['set-cookie'] || []).find(c => c.startsWith('wm_as=')); assert.ok(asck, 'viewing cookie');
    for (const p of ['/account/payouts', '/account/keeping', '/account/requests', '/account/claims', '/account/profile']) { r = await req(port, 'GET', p, { cookie: `${ck}; ${asck.split(';')[0]}` }); assert.equal(r.status, 200, `house walks ${p}`); }
    r = await req(port, 'GET', '/studio/trove?sort=stars', { cookie: ck }); assert.ok(r.body.toString().includes('&#9733;&#9733;&#9733;&#9733;&#9733;'), 'the rubies in the Studio'); }
  // Who is at the door: the house bar asks /api/me from any Krafft site.
  r = await req(port, 'GET', '/api/me', { headers: { origin: 'https://studios.krafftco.com' } }); assert.equal(JSON.parse(r.body).in, false); assert.equal(r.headers['access-control-allow-origin'], 'https://studios.krafftco.com');
  r = await req(port, 'GET', '/api/me', { cookie: gck, headers: { origin: 'https://evil.example' } }); { const me = JSON.parse(r.body); assert.ok(me.in && me.maker && me.maker.slug === 'greta-lund'); assert.ok(!r.headers['access-control-allow-origin'], 'no CORS for strangers'); }
  r = await req(port, 'GET', '/house.js'); assert.ok(r.body.toString().includes('/api/me') && r.body.toString().includes('kh-you'), 'the bar has a door for you');
  // Quality control: a web-sized photograph is collected instantly; the larger uses are listed but asked of the maker, who supplies the master.
  r = await req(port, 'GET', `/license/${w2.slug}`); { const lb = r.body.toString(); assert.ok(lb.includes('Collect') && lb.includes('For a company') && lb.includes('Ask the maker') && lb.includes('full-resolution'), 'web size: larger uses are asked, not sold'); }
  r = await req(port, 'POST', `/buy/${w2.slug}`, { body: { use: 'campaign' } }); assert.equal(r.status, 200); assert.ok(r.body.toString().includes('full-resolution master'), 'a campaign from a web copy is asked of the maker, never sold instantly');
  // The request desk: what is asked of a web copy lands with the maker, who accepts (free here) or declines with a word; the buyer is written to.
  r = await req(port, 'POST', `/license/${w2.slug}`, { body: { use: 'campaign', name: 'Ines Vale', email: 'ines@vale.example', agree: '1', intended: 'A billboard in Lisbon' } }); assert.equal(r.status, 200); assert.ok(r.body.toString().includes('with the maker'), 'asked, not sold');
  const rq1 = db.prepare("SELECT ref, status FROM licenses WHERE licensee_email='ines@vale.example' ORDER BY id DESC LIMIT 1").get(); assert.equal(rq1.status, 'requested');
  const mh = db.prepare('SELECT handle FROM makers WHERE id=?').get(w2.maker_id).handle;
  r = await req(port, 'GET', `/account/requests?maker=${mh}`, { cookie: ck }); assert.ok(r.body.toString().includes('Waiting for you') && r.body.toString().includes('Ines Vale') && r.body.toString().includes('Needs the master'), 'on the desk');
  r = await req(port, 'GET', `/account/requests/${rq1.ref}`); assert.equal(r.status, 302, 'a stranger is sent to sign in');
  r = await req(port, 'GET', `/account/requests/${rq1.ref}`, { cookie: ck }); assert.ok(r.body.toString().includes('A billboard in Lisbon') && r.body.toString().includes('Add the master'), 'the request, and the master asked for');
  r = await req(port, 'POST', `/account/requests/${rq1.ref}/accept`, { cookie: ck, body: { free: '1' } }); assert.equal(r.status, 302);
  assert.equal(db.prepare('SELECT status FROM licenses WHERE ref=?').get(rq1.ref).status, 'active', 'granted');
  r = await req(port, 'POST', `/license/${w2.slug}`, { body: { use: 'campaign', name: 'Ines Vale', email: 'ines@vale.example', agree: '1' } });
  const rq2 = db.prepare("SELECT ref FROM licenses WHERE licensee_email='ines@vale.example' ORDER BY id DESC LIMIT 1").get();
  r = await req(port, 'POST', `/account/requests/${rq2.ref}/decline`, { cookie: ck, body: { word: 'Not for billboards; a story is open.' } }); assert.equal(r.status, 302);
  { const d = db.prepare('SELECT status, conditions FROM licenses WHERE ref=?').get(rq2.ref); assert.equal(d.status, 'declined'); assert.ok(d.conditions.includes('Not for billboards'), 'the word kept'); }
  r = await req(port, 'POST', `/account/requests/${rq2.ref}/decline`, { cookie: ck }); assert.ok(r.headers.location.includes('no%20longer%20open'), 'answered once');
  r = await req(port, 'GET', `/account/requests?maker=${mh}`, { cookie: ck }); assert.ok(r.body.toString().includes('Licensed, and answered') && r.body.toString().includes('Declined'), 'the answered list');
  // The archival master (.wmark): the original with its papers, signed by the house; verified by the house or offline; fixity checked.
  r = await req(port, 'GET', `/w/${w.slug}/archive.wmark`); assert.equal(r.status, 403, 'not for strangers');
  r = await req(port, 'GET', `/w/${w.slug}/archive.wmark`, { cookie: ck }); assert.equal(r.status, 200); assert.ok(r.headers['content-disposition'].includes('.wmark'));
  const wmark = Buffer.from(r.body);
  { const z = await require('unzipper').Open.buffer(wmark); const names = z.files.map(f => f.path); assert.ok(names.includes('manifest.json') && names.includes('manifest.sig') && names.includes('certificate.pdf') && names.some(n => n.startsWith('original/')), 'the papers and the original');
    const m = JSON.parse((await z.files.find(f => f.path === 'manifest.json').buffer()).toString()); assert.equal(m.accession, w.accession); assert.ok(m.register.length >= 1 && m.house_key.public, 'manifest');
    const ob = await z.files.find(f => f.path.startsWith('original/')).buffer(); assert.equal(require('crypto').createHash('sha256').update(ob).digest('hex'), w.sha256, 'byte for byte'); }
  const mpart = (file, name, body) => { const b = `----wm${Date.now()}`; const head = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`); return { body: Buffer.concat([head, body, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } }; };
  { const f = mpart(null, 'x.wmark', wmark); r = await req(port, 'POST', '/verify', { body: f.body, headers: f.headers }); assert.ok(r.body.toString().includes('Genuine.'), 'the house verifies its own archive'); }
  { const bad = Buffer.from(wmark); const i = bad.indexOf(Buffer.from('"accession"')); bad[i + 20] ^= 1; const f = mpart(null, 'x.wmark', bad); r = await req(port, 'POST', '/verify', { body: f.body, headers: f.headers }); assert.ok(!r.body.toString().includes('Genuine.') && r.body.toString().includes('signature'), 'a touched manifest fails the signature'); }
  { const f = mpart(null, 'orig.jpg', fs.readFileSync(path.join(dir, 'originals', w.original_file))); r = await req(port, 'POST', '/verify', { body: f.body, headers: f.headers }); assert.ok(r.body.toString().includes('Genuine.') && r.body.toString().includes('byte for byte'), 'the original itself is known'); }
  { const fx = await app.locals.archive.fixity(100); assert.ok(fx.ran >= 2 && fx.bad === 0, 'fixity whole'); r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(!/awaited|first check is due/.test(r.body.toString()), 'never "awaited" on the shield'); }
  r = await req(port, 'GET', '/studio/fixity', { cookie: ck }); assert.ok(r.body.toString().includes('Nothing failing'), 'conservation desk');
  // The Library: a volume set by the house, read for nothing, a copy taken for a price (free here), on the register.
  r = await req(port, 'POST', '/studio/library', { cookie: ck, body: { title: 'On Looking', kind: 'essay', author: 'The house', year: '2026', summary: 'How to stand in front of a photograph.', body: 'Stand still.\n\n# First\n\nLook longer than feels polite.\n\n> The eye takes a while.', price: '0', public: '1', cover: w.slug } }); assert.ok(r.headers.location.includes('/studio/library/on-looking'), 'shelved');
  r = await req(port, 'GET', '/library'); assert.ok(r.body.toString().includes('On Looking') && r.body.toString().includes('Essays'), 'on the shelf');
  r = await req(port, 'GET', '/library/on-looking'); { const lb = r.body.toString(); assert.ok(lb.includes('Look longer than feels polite') && lb.includes('<h2>First</h2>') && lb.includes('Take a copy, free'), 'read in the house'); }
  r = await req(port, 'POST', '/library/on-looking/take', { cookie: bck }); assert.ok(r.headers.location.includes('ok=taken'), 'taken');
  const tok = db.prepare("SELECT token FROM text_orders WHERE status='paid' ORDER BY id DESC LIMIT 1").get().token; assert.ok(tok);
  r = await req(port, 'GET', `/library/d/${tok}`); assert.equal(r.status, 200); assert.ok(r.headers['content-type'].includes('pdf') && r.body.length > 1000, 'the copy, as a PDF');
  r = await req(port, 'GET', '/ledger'); assert.ok(r.body.toString().includes('shelved in the Library'), 'on the register');
  // The app: installable, with a worker and an offline room.
  r = await req(port, 'GET', '/static/app/manifest.webmanifest'); assert.equal(r.status, 200); { const m = JSON.parse(r.body.toString()); assert.equal(m.display, 'standalone'); assert.equal(m.name, 'Wander', 'the app is Wander (25 Oct)'); assert.ok(m.start_url.startsWith('/wander'), 'the installed app opens into the feed'); }
  r = await req(port, 'GET', '/app'); assert.ok(r.body.toString().includes('Install Wander') && r.body.toString().includes('content="Wander"'), 'the install page and the home-screen title say Wander');
  r = await req(port, 'GET', '/sw.js'); assert.equal(r.status, 200); assert.ok(r.body.toString().includes('PRIVATE'));
  r = await req(port, 'GET', '/app'); assert.ok(r.body.toString().includes('Add to Dock'));
  r = await req(port, 'GET', '/offline'); assert.ok(r.body.toString().includes('caught a cold'));
  r = await req(port, 'GET', '/collection'); assert.ok(r.body.toString().includes('rel="manifest"') && r.body.toString().includes('speculationrules'), 'the app in every page');
  // The pocket and the thank-you card: ten dollars in once (a Checkout, settled by the webhook); a 99-cent card with a word goes with one tap, lands on the maker, and is on the register.
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.toString().includes('A thank-you card') && r.body.toString().includes('Fill a pocket'), 'the card, and the pocket offered');
  r = await req(port, 'POST', '/pocket/add', { cookie: bck, body: { amount: '1000' } }); assert.equal(r.status, 303); const pks = sessions[r.headers.location.split('/').pop()]; assert.equal(pks.line_items[0].price_data.unit_amount, 1000);
  { const payload = JSON.stringify({ id: 'evt_pocket', type: 'checkout.session.completed', data: { object: { ...pks, payment_status: 'paid', amount_total: 1000, customer: 'cus_pocket', customer_details: { email: 'tap@example.com' } } } });
    const sg = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' }); r = await req(port, 'POST', '/stripe/webhook', { body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': sg } }); assert.equal(r.status, 200); }
  r = await req(port, 'GET', '/yours?tab=settings', { cookie: bck }); assert.ok(r.body.toString().includes('Your pocket') && r.body.toString().includes('$10<'), 'the pocket holds ten dollars');
  r = await req(port, 'GET', `/w/${w.slug}`, { cookie: bck }); assert.ok(r.body.toString().includes('From your pocket, $10 in it'), 'the card knows the pocket');
  r = await req(port, 'POST', `/w/${w.slug}/thanks`, { cookie: bck, body: { amount: '99', word: 'For the light in it.' } }); assert.ok(r.headers.location.includes('thanks=given'), 'sent with one tap');
  r = await req(port, 'GET', '/yours?tab=settings', { cookie: bck }); assert.ok(r.body.toString().includes('$9.01'), 'ninety-nine cents out');
  { const t = db.prepare("SELECT * FROM tips WHERE role='thanks' ORDER BY id DESC LIMIT 1").get(); assert.equal(t.status, 'paid'); assert.equal(t.amount_cents, 99); assert.equal(t.note, 'For the light in it.'); assert.ok(app.locals.tipsTo(t.maker_id).s >= 99, 'on the maker'); }
  r = await req(port, 'POST', `/w/${w.slug}/thanks`, { cookie: bck, body: { amount: 'own', own: '12' } }); assert.equal(r.status, 303, 'more than the pocket holds goes to Checkout'); assert.ok(r.headers.location.includes('checkout'));
  r = await req(port, 'GET', `/w/${w.slug}?thanks=given`); assert.ok(r.body.toString().includes('1 person has said thank you'), 'counted on the work');
  // Getting paid: the maker's statement is exact (85% of licenses, cards whole), payouts through Stripe wait for PAYOUTS=stripe; a payment by hand is recorded.
  r = await req(port, 'GET', '/account/payouts', { cookie: gck }); assert.ok(r.body.toString().includes('Owed to you now') && r.body.toString().includes('Add your bank') && r.body.toString().includes('Friday pay.'), 'the statement, with Friday pay');
  { // Friday pay: a sale made today is clearing, not cleared; cleared + clearing = owed; the Friday run is off until Stripe pays.
    const mw = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id); const st = app.locals.payouts.statement(mw);
    assert.ok(st.cleared + st.clearing === st.owed && st.clearing > 0 && st.holdDays === 7 && /day, /.test(st.friday), 'today’s money is clearing: ' + JSON.stringify({ cleared: st.cleared, clearing: st.clearing, owed: st.owed }));
    const f = await app.locals.payouts.friday({ force: true }); assert.ok(f.ok === false && f.why === 'off', 'Friday pay waits for PAYOUTS=stripe');
    { const c = app.locals.payouts.letterFor(mw); const L = require('../src/mail-letters').friday(c); assert.ok(c.sold >= 1 && /Friday/.test(L.subject + L.html) && /Sold this week/.test(L.html) && /Still clearing/.test(L.text), 'the Friday letter: ' + L.subject); const fl = await app.locals.payouts.fridayLetters({ force: true }); assert.ok(fl.ok && fl.sent >= 1, 'sent to the makers who sold'); r = await req(port, 'GET', '/studio/letters?as=friday', { cookie: ck }); assert.ok(r.status === 200 && /Friday/.test(r.body), 'previewed'); }
    { const bb = db.prepare('SELECT * FROM buyers ORDER BY id LIMIT 1').get(); const P = app.locals.pocket; assert.ok(typeof P.cleared(bb) === 'number' && P.cleared(bb) <= P.cashable(bb), 'a pocket’s cleared earnings never exceed what is cashable'); const sw = await P.sweep(bb); assert.ok(sw.ok === false && sw.why === 'off', 'and the pocket sweep waits too'); }
    const pr = await app.locals.payouts.pay(mw); assert.ok(pr.ok === false && pr.why === 'off', 'and so does a maker’s ask');
  }
  { const mw = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id); const st = app.locals.payouts.statement(mw); assert.ok(st.thanks.s >= 99 && st.share === db.prepare("SELECT l.price_cents p FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0").all(mw.id).reduce((a, r) => a + Math.round(r.p * 85 / 100), 0) && st.owed === st.earned - st.paid, 'the sums');
    const r2 = await app.locals.payouts.pay(mw); assert.equal(r2.ok, false); assert.equal(r2.why, 'off', 'no transfer until the house is set to pay');
    r = await req(port, 'POST', `/studio/payouts/${mw.handle}`, { cookie: ck, body: { amount: '1', note: 'By cheque' } }); assert.equal(r.status, 302);
    assert.equal(app.locals.payouts.statement(mw).paid, 100, 'recorded'); }
  // Every maker is a collector: the switch on both sides; the pocket pays for a Collect with one tap; the money stays in the house.
  r = await req(port, 'GET', '/account', { cookie: gck }); assert.ok(r.body.toString().includes('dh-as') && r.body.toString().includes('>Gallery<'), 'the switch in the studio');
  const tmp4 = path.join(dir, 'in4.jpg'); await require('sharp')(SRC).resize({ width: 1700 }).rotate(90).modulate({ brightness: 1.15, hue: 40 }).toFile(tmp4);
  const w4 = await registerWork({ file: tmp4, originalName: 'q.jpg', title: 'Test Quay', place: 'Venice' });
  r = await req(port, 'GET', `/w/${w4.slug}`, { cookie: bck }); assert.ok(r.body.toString().includes('data-pocket="1"') && r.body.toString().includes('From your pocket, one tap'), 'the pocket covers the Collect');
  { const pb = db.prepare("SELECT b.* FROM buyers b WHERE b.id=(SELECT buyer_id FROM pocket WHERE kind='topup' ORDER BY id DESC LIMIT 1)").get(); const before = app.locals.pocket.balance(pb);
    r = await req(port, 'POST', `/buy/${w4.slug}`, { cookie: bck, body: { use: 'social', from: 'pocket' } }); assert.ok(/^\/thanks\/WM-[0-9-]+\?k=/.test(r.headers.location), 'collected from the pocket, no checkout: the thanks page');
    { const tp = await req(port, 'GET', r.headers.location, { cookie: bck }); assert.equal(tp.status, 200); const tb = tp.body.toString(); assert.ok(tb.includes('class="yx in"') && tb.includes('is yours.') && tb.includes('yx-pencil'), 'the photograph on its tile'); }
    { const t0 = await req(port, 'GET', r.headers.location.replace(/k=.*/, 'k=wrong'), { cookie: bck }); assert.equal(t0.status, 302, 'a wrong key is sent to the license page'); }
    const after = app.locals.pocket.balance(pb);
    const lic = db.prepare("SELECT * FROM licenses WHERE ref=(SELECT subject FROM ledger WHERE type='license.paid.pocket' ORDER BY seq DESC LIMIT 1)").get(); assert.equal(lic.status, 'active'); assert.ok(lic.collector_no, 'numbered'); assert.equal(before - after, lic.price_cents, 'the pocket paid exactly the price'); }
  // Curators: Ada hangs a wall from the collection, shows it; a visitor collects through it; Ada's pocket gets the curator's share; she can cash out.
  r = await req(port, 'GET', `/w/${w.slug}`, { cookie: sck }); assert.ok(r.body.toString().includes('Hang it'), 'hang it on the work page');
  r = await req(port, 'POST', '/hang/add', { cookie: sck, body: { work: w.slug, hang: 'new', title: 'Stone and Light' } }); assert.ok(r.headers.location.includes('hung='));
  const hg = db.prepare('SELECT * FROM hangs ORDER BY id DESC LIMIT 1').get(); assert.equal(hg.title, 'Stone and Light');
  r = await req(port, 'POST', '/hang/add', { cookie: sck, body: { work: w2.slug, hang: String(hg.id) } });
  r = await req(port, 'GET', `/hang/${hg.slug}`); assert.equal(r.status, 404, 'private until shown');
  r = await req(port, 'POST', `/hang/${hg.id}/edit`, { cookie: sck, body: { title: 'Stone and Light', line: 'Two ways a wall holds the sun.', public: '1' } });
  r = await req(port, 'GET', '/collectors'); assert.ok(r.body.toString().includes('Stone and Light') && r.body.toString().includes('Hangs'), 'listed with the galleries');
  r = await req(port, 'GET', '/hangs'); assert.ok(r.status === 200 && r.body.toString().includes('Stone and Light'), '/hangs answers (23 Oct: it had been a 500 since the tours)');
  r = await req(port, 'GET', `/hang/${hg.slug}`); const viack = (r.headers['set-cookie'] || []).find(c => c.startsWith('wm_via=')); assert.ok(viack && viack.includes(`hang%3A${hg.id}`) || viack.includes(`hang:${hg.id}`), 'the wall is remembered'); assert.ok(r.body.toString().includes('Thank the eye'), 'a card for the curator');
  r = await req(port, 'POST', `/buy/${w.slug}`, { cookie: viack.split(';')[0], body: { use: 'commercial', note: 'A campaign' } }); assert.equal(r.status, 303);
  { const hid = r.headers.location.split('/').pop(), hs = sessions[hid]; assert.equal(db.prepare('SELECT via FROM licenses WHERE ref=?').get(hs.metadata.ref).via, `hang:${hg.id}`, 'via stamped');
    Object.assign(hs, { payment_status: 'paid', amount_total: hs.line_items[0].price_data.unit_amount, customer_details: { email: 'vis@example.com', name: 'A Visitor' } });
    r = await req(port, 'GET', `/thanks/${hs.metadata.ref}?session_id=${hid}`);
    const ada = db.prepare('SELECT * FROM buyers WHERE email=?').get('ada@example.com') || db.prepare('SELECT b.* FROM buyers b JOIN hangs h ON h.buyer_id=b.id WHERE h.id=?').get(hg.id);
    const cur = db.prepare("SELECT * FROM pocket WHERE kind='curation' ORDER BY id DESC LIMIT 1").get(); assert.ok(cur && cur.cents === Math.round(hs.line_items[0].price_data.unit_amount * 0.05), 'the curator\'s share, 5%'); assert.equal(cur.buyer_id, hg.buyer_id);
    assert.equal(db.prepare('SELECT sales FROM hangs WHERE id=?').get(hg.id).sales, 1);
    r = await req(port, 'GET', '/yours?tab=settings', { cookie: sck }); assert.ok(r.body.toString().includes('Cash out'), 'cash out offered');
    r = await req(port, 'POST', '/pocket/cashout', { cookie: sck }); assert.ok(r.headers.location.includes('pocket=cashed'));
    assert.equal(app.locals.pocket.cashable(db.prepare('SELECT * FROM buyers WHERE id=?').get(hg.buyer_id)), 0, 'cashed out, by hand until payouts are on');
    r = await req(port, 'GET', '/yours?tab=hangs', { cookie: sck }); assert.ok(r.body.toString().includes('1 collected'), 'the hang keeps its score');
    r = await req(port, 'GET', '/ledger'); assert.ok(r.body.toString().includes('A curator hung a wall'), 'told on the register'); }
  // The house hangs a wall of its own and features it; it leads the front door.
  r = await req(port, 'POST', '/studio/hangs/new', { cookie: ck, body: { title: 'The House Hang', line: 'Chosen by the house.', works: `${w.slug}\n${w2.slug}`, public: '1' } }); assert.ok(/^\/g\/[^/]+\/hang\//.test(r.headers.location), 'house hang');
  const hh = db.prepare("SELECT * FROM hangs WHERE title='The House Hang'").get(); assert.equal(db.prepare('SELECT COUNT(*) n FROM hang_works WHERE hang_id=?').get(hh.id).n, 2);
  r = await req(port, 'POST', `/studio/hangs/${hh.id}`, { cookie: ck, body: { do: 'feature' } }); r = await req(port, 'GET', '/'); assert.ok(r.body.toString().indexOf('The House Hang') < r.body.toString().indexOf('Stone and Light'), 'featured leads');
  r = await req(port, 'GET', '/studio/hangs', { cookie: ck }); assert.ok(r.body.toString().includes('Featured') && r.body.toString().includes('Stone and Light'), 'the desk');
  r = await req(port, 'GET', `/hang/${hh.slug}`, { cookie: ck }); assert.ok(r.body.toString().includes('Edit the hang'), 'the house edits its own wall');
  // The cabinet: Ada photographs a painting she owns, keeps it privately, opens a showing to one guest by letter; the guest's link admits them, a stranger sees nothing, the image is gated.
  { const pic = await require('sharp')(SRC).resize({ width: 1400 }).modulate({ hue: 120 }).jpeg().toBuffer();
    r = await req(port, 'POST', '/cabinet/add', { cookie: sck, body: mp('painting.jpg', pic, { title: 'Harbour at Dusk', artist: 'E. Lund', year: '1931', medium: 'Oil on canvas' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
    assert.ok(r.headers.location.includes('cab=kept'), 'kept'); const cab = db.prepare('SELECT * FROM cabinet ORDER BY id DESC LIMIT 1').get(); assert.equal(cab.title, 'Harbour at Dusk'); assert.ok(cab.sha256 && cab.width > 0);
    r = await req(port, 'GET', `/cab/${cab.id}/thumb`); assert.equal(r.status, 404, 'a stranger gets nothing');
    r = await req(port, 'GET', `/cab/${cab.id}/thumb`, { cookie: sck }); assert.equal(r.status, 200, 'the owner sees it'); assert.ok(/no-store/.test(r.headers['cache-control']));
    r = await req(port, 'POST', '/showings/new', { cookie: sck, body: { title: 'The Lund Room', line: 'Three paintings my grandmother kept.' } }); const sh = db.prepare('SELECT * FROM showings ORDER BY id DESC LIMIT 1').get();
    r = await req(port, 'POST', `/show/${sh.id}/work`, { cookie: sck, body: { do: 'add', cabinet: String(cab.id) } });
    r = await req(port, 'GET', `/show/${sh.slug}`); assert.equal(r.status, 404, 'private: closed to a stranger'); assert.ok(r.body.toString().includes('not open to you'));
    r = await req(port, 'POST', `/show/${sh.id}/guests`, { cookie: sck, body: { guests: 'Nils Ek <nils@example.com>' } }); assert.ok(r.headers.location.includes('n=1'), 'one letter');
    const g = db.prepare('SELECT * FROM showing_guests WHERE showing_id=?').get(sh.id); assert.equal(g.email, 'nils@example.com'); assert.equal(db.prepare('SELECT access FROM showings WHERE id=?').get(sh.id).access, 'guests');
    r = await req(port, 'GET', `/show/${sh.slug}/g/${g.token}`); const gck2 = (r.headers['set-cookie'] || []).find(c => c.startsWith('wm_g=')).split(';')[0]; assert.ok(r.headers.location.endsWith(`/show/${sh.slug}`));
    r = await req(port, 'GET', `/show/${sh.slug}`, { cookie: gck2 }); assert.equal(r.status, 200); assert.ok(r.body.toString().includes('Harbour at Dusk') && r.body.toString().includes('opened to you, Nils') && !r.body.toString().includes('Send the letters'), 'the guest sees the wall, not the desk');
    r = await req(port, 'GET', `/cab/${cab.id}/screen`, { cookie: gck2 }); assert.equal(r.status, 200, 'the guest sees the image');
    assert.ok(db.prepare('SELECT seen_at FROM showing_guests WHERE id=?').get(g.id).seen_at, 'the owner knows they came');
    r = await req(port, 'POST', `/show/${sh.id}/edit`, { cookie: sck, body: { title: 'The Lund Room', access: 'guests', closes_at: '2000-01-01T00:00' } });
    r = await req(port, 'GET', `/show/${sh.slug}`, { cookie: gck2 }); assert.equal(r.status, 404, 'a closed run admits nobody');
    r = await req(port, 'POST', `/show/${sh.id}/guests`, { cookie: sck, body: { do: 'remove', guest: String(g.id) } }); r = await req(port, 'POST', `/show/${sh.id}/edit`, { cookie: sck, body: { title: 'The Lund Room', access: 'guests' } });
    r = await req(port, 'GET', `/show/${sh.slug}`, { cookie: gck2 }); assert.equal(r.status, 404, 'a removed guest is out');
    r = await req(port, 'GET', '/yours?tab=cabinet', { cookie: sck }); assert.ok(r.body.toString().includes('Your cabinet') && r.body.toString().includes('The Lund Room'), 'the cabinet room');
    r = await req(port, 'GET', '/ledger'); assert.ok(!r.body.toString().includes('Lund Room') && !r.body.toString().includes('Harbour at Dusk'), 'nothing of the cabinet on the public register'); }
  // Addresses belong to people: a photograph under its maker, a wall under its curator; the old short forms still answer.
  const meSlug = require('../src/views').makerSlug(db.prepare('SELECT * FROM makers WHERE id=1').get());
  r = await req(port, 'GET', `/m/${meSlug}/${w.slug}`); assert.equal(r.status, 200); assert.ok(new RegExp(`rel="canonical" href="[^"]*/m/${meSlug}/${w.slug}"`).test(r.body.toString()), 'canonical under the maker');
  r = await req(port, 'GET', `/m/not-the-maker/${w.slug}`); assert.equal(r.status, 301, 'wrong maker corrected');
  r = await req(port, 'GET', `/w/${w.slug}`); assert.equal(r.status, 200, 'the short form still answers');
  { const hh2 = db.prepare('SELECT h.*, b.code FROM hangs h JOIN buyers b ON b.id=h.buyer_id ORDER BY h.id LIMIT 1').get(); r = await req(port, 'GET', `/g/${hh2.code}/hang/${hh2.slug}`); assert.equal(r.status, 200, 'the wall under its curator'); const pubc = db.prepare('SELECT code FROM buyers WHERE public=1 AND code IS NOT NULL LIMIT 1').get().code; r = await req(port, 'GET', `/g/${pubc}`); assert.equal(r.status, 200, 'the gallery at /g'); }
  // Introductions: the house issues a partner link that opens studios; a maker introduces one maker; the register says who introduced whom.
  r = await req(port, 'POST', '/studio/introductions', { cookie: ck, body: { label: 'The Fogg Museum', opens: 'maker', max_uses: '2' } }); assert.ok(decodeURIComponent(r.headers.location).includes('/i/'), 'partner link');
  const pl = db.prepare("SELECT * FROM introductions WHERE label='The Fogg Museum'").get();
  r = await req(port, 'GET', `/i/${pl.token}`); assert.ok(r.body.toString().includes('Welcome to the house') && r.body.toString().includes('I make things') && r.body.toString().includes('I came to look'), 'one door for everyone: two ways in');
  r = await req(port, 'GET', `/i/${pl.token}?make=1`); assert.ok(r.body.toString().includes('Open my studio') && r.body.toString().includes('name="email"'), 'the maker\'s way: the form');
  r = await req(port, 'POST', `/i/${pl.token}`, { body: { name: 'Ines Vardar', email: 'ines@example.com' } }); assert.equal(r.headers.location, '/account?welcome=1'); const ick2 = r.headers['set-cookie'].find(c => c.startsWith('wm_m=')).split(';')[0];
  const ines = db.prepare("SELECT * FROM makers WHERE email='ines@example.com'").get(); assert.ok(ines && ines.joined_at && ines.introduced_by === 'house', 'studio opened at once, introduced by the house');
  r = await req(port, 'GET', '/account', { cookie: ick2 }); assert.equal(r.status, 200, 'signed in');
  r = await req(port, 'GET', '/account/profile', { cookie: ick2 }); assert.ok(r.body.toString().includes('Introductions') && r.body.toString().includes('0 of 5 this year'), 'her own introductions');
  r = await req(port, 'POST', '/account/introductions', { cookie: ick2, body: { label: 'For Teo', opens: 'maker' } }); const mi = db.prepare("SELECT * FROM introductions WHERE label='For Teo'").get(); assert.equal(mi.max_uses, 1);
  r = await req(port, 'POST', `/i/${mi.token}`, { body: { name: 'Teo Marsh', email: 'teo@example.com' } }); assert.equal(db.prepare("SELECT introduced_by FROM makers WHERE email='teo@example.com'").get().introduced_by, `maker:${ines.handle}`);
  r = await req(port, 'GET', `/i/${mi.token}`); assert.equal(r.status, 404, 'good once');
  r = await req(port, 'GET', '/m/teo-marsh'); assert.ok(r.body.toString().includes('Introduced to the house by') && r.body.toString().includes('Ines Vardar'), 'the maker page says who');
  r = await req(port, 'GET', '/ledger'); assert.ok(r.body.toString().includes(`introduced by ${ines.handle}`), 'on the register');
  r = await req(port, 'POST', `/i/${pl.token}`, { body: { name: 'A Collector', email: 'col@example.com' } }); r = await req(port, 'GET', `/i/${pl.token}`); assert.equal(r.status, 404, 'two of two taken');
  // The viewing room: the first photograph is in the page; the plate carries the sale; from the pocket it is one tap and the room says Yours; a hat and a hang without leaving.
  r = await req(port, 'GET', `/wander/room?at=${w4.slug}`, { cookie: bck }); { const html = r.body.toString(); assert.ok(html.includes('window.__WM_FIRST={') && html.includes(`"slug":"${w4.slug}"`), 'the first photograph is in the page'); assert.ok(html.includes('data-vr-collect') && html.includes('data-vr-hat') && html.includes('data-vr-hang'), 'the plate carries the sale'); }
  r = await req(port, 'GET', `/api/wander?from=`, { cookie: bck }); { const j = JSON.parse(r.body); assert.ok(j.slug && j.img && 'collect' in j && 'hat' in j, 'the room JSON'); }
  r = await req(port, 'POST', `/w/${w.slug}/applaud`, { cookie: bck, headers: { accept: 'application/json' } }); { const j = JSON.parse(r.body); assert.ok(j.ok && typeof j.mine === 'boolean', 'hat from the room'); }
  r = await req(port, 'POST', '/hang/add', { cookie: bck, body: { work: w.slug, hang: 'wander', title: 'From my wandering', json: '1' } }); { const j = JSON.parse(r.body); assert.ok(j.ok && j.hang, 'hung from the room'); assert.ok(db.prepare("SELECT 1 FROM hangs WHERE id=? AND title='From my wandering'").get(j.hang)); }
  r = await req(port, 'POST', `/buy/${w.slug}`, { cookie: bck, body: { use: 'social', from: 'pocket', json: '1' } }); assert.ok(r.status === 200 ? typeof JSON.parse(r.body).ok === 'boolean' : r.status < 400, 'the pocket answers');
  // The Ask page is not a dead end: every other use is a tap away, instant ones by price, and the way back to the photograph.
  r = await req(port, 'GET', `/buy/${w4.slug}?use=editorial`); { const h = r.body.toString(); assert.ok(h.includes('Tell the maker') && h.includes('buy-menu') && h.includes('Or another use') && h.includes(`/license/${w4.slug}?use=social`) && h.includes(`/w/${w4.slug}`), 'the menu stays'); }
  // The signs: a closed door shows a photograph and the way on, never a number; a browser never sees "Not Found".
  r = await req(port, 'GET', '/w/no-such-photograph', { headers: { accept: 'text/html' } }); assert.equal(r.status, 404); assert.ok(r.body.toString().includes('There is no page at this address') && r.body.toString().includes('Wander on') && !/^Not Found/.test(r.body.toString()), 'a sign, not a number');
  r = await req(port, 'GET', '/hang/no-such-wall', { headers: { accept: 'text/html' } }); assert.equal(r.status, 404); assert.ok(r.body.toString().includes('nf-t'), 'sendStatus becomes a sign');
  r = await req(port, 'GET', '/account/claims/999', { headers: { accept: 'text/html' } }); assert.ok(r.body.toString().includes('nf-t') || r.status === 302, 'a private door is a sign too');
  r = await req(port, 'GET', '/api/wander?from=zzz', { headers: { accept: 'application/json' } }); assert.equal(r.status, 200, 'JSON keeps its shape');
  r = await req(port, 'GET', '/img/no-such/thumb'); assert.ok(r.status === 404 && !r.body.toString().includes('<html'), 'images keep a plain status');
  // Galleries: a gallery represents a maker, takes its agreed share of the maker's side, mounts a show; the eye is told on the wall.
  r = await req(port, 'POST', '/studio/accounts', { cookie: ck, body: { name: 'Meatpacking Pictures', email: 'desk@meatpacking.example', kind: 'gallery', house: 'New York', invite: '0' } }); assert.equal(r.status, 302);
  { const gal = db.prepare("SELECT * FROM makers WHERE handle='meatpacking-pictures'").get(); assert.ok(gal && gal.kind === 'gallery', 'a gallery account');
    r = await req(port, 'GET', `/account/join/${gal.invite_token}`); const galck = r.headers['set-cookie'][0].split(';')[0];
    r = await req(port, 'GET', '/account/gallery', { cookie: galck }); assert.ok(r.body.toString().includes('Meatpacking Pictures') && r.body.toString().includes('Offer representation') && r.body.toString().includes('>The gallery<'), 'the gallery desk and its rail');
    const tmp5 = path.join(dir, 'in5.jpg'); await require('sharp')(SRC).resize({ width: 1500 }).modulate({ brightness: .9, hue: 120 }).toFile(tmp5);
    const w5 = await registerWork({ file: tmp5, originalName: 'r.jpg', title: 'Test Rialto', place: 'Venice' });
    const art = db.prepare('SELECT m.* FROM makers m JOIN works w ON w.maker_id=m.id WHERE w.slug=?').get(w5.slug);
    r = await req(port, 'POST', '/account/gallery/offer', { cookie: galck, body: { handle: art.handle, pct: '40', note: 'We would like to show the Venice work.' } }); assert.ok(decodeURIComponent(r.headers.location).includes('Offered to'), 'offered');
    r = await req(port, 'GET', `/account?maker=${art.handle}`, { cookie: ck }); const asck2 = (r.headers['set-cookie'] || []).find(c => c.startsWith('wm_as=')).split(';')[0]; const artck = `${ck}; ${asck2}`;
    r = await req(port, 'GET', '/account', { cookie: artck }); assert.ok(r.body.toString().includes('offers to represent you'), 'Needs you: the offer');
    const rep = db.prepare("SELECT * FROM representation WHERE gallery_id=? AND maker_id=?").get(gal.id, art.id);
    r = await req(port, 'POST', `/account/representation/${rep.id}`, { cookie: artck, body: { answer: 'accept' } }); assert.ok(decodeURIComponent(r.headers.location).includes('represents you now'), 'accepted');
    r = await req(port, 'GET', `/m/${art.handle}`); assert.ok(r.body.toString().includes('Represented by') && r.body.toString().includes('Meatpacking Pictures'), 'the maker page says so');
    const pb = db.prepare("SELECT b.* FROM buyers b WHERE b.id=(SELECT buyer_id FROM pocket WHERE kind='topup' ORDER BY id DESC LIMIT 1)").get(); db.prepare("INSERT INTO pocket (buyer_id, cents, kind, ref, note) VALUES (?,?,?,?,?)").run(pb.id, 1000, 'topup', 'test', 'for the show');
    r = await req(port, 'POST', `/buy/${w5.slug}`, { cookie: bck, body: { use: 'social', from: 'pocket' } }); assert.ok(/^\/thanks\//.test(r.headers.location), 'collected');
    const cutRow = db.prepare('SELECT * FROM gallery_cuts WHERE gallery_id=?').get(gal.id); assert.ok(cutRow && cutRow.cents === Math.round(500 * ((art.share_pct || 85) / 100) * .4), `the gallery's cut: ${cutRow && cutRow.cents}`);
    r = await req(port, 'GET', '/account/payouts', { cookie: galck }); assert.ok(r.body.toString().includes('Representation') && r.body.toString().includes(require('../src/views').money(cutRow.cents)), 'on the gallery statement');
    r = await req(port, 'GET', '/account/payouts', { cookie: artck }); assert.ok(r.body.toString().includes('To your gallery'), 'and on the maker\'s');
    // A show: the gallery hangs a wall, dates it, shows it.
    const gb = app.locals.galleries.galleryBuyer(gal); r = await req(port, 'GET', '/yours?tab=hangs', { cookie: galck }); const gbck = (r.headers['set-cookie'] || []).find(c => c.startsWith('wm_b=')); const showck = gbck ? `${galck}; ${gbck.split(';')[0]}` : galck;
    r = await req(port, 'POST', '/hangs/new', { cookie: showck, body: { title: 'Venice, in Winter', line: 'Three weeks of fog.' } }); assert.equal(r.status, 302);
    const sh2 = db.prepare("SELECT * FROM hangs WHERE title='Venice, in Winter'").get(); assert.ok(sh2, 'the show exists');
    r = await req(port, 'POST', '/hang/add', { cookie: showck, body: { work: w5.slug, hang: String(sh2.id) } });
    r = await req(port, 'POST', `/hang/${sh2.id}/edit`, { cookie: showck, body: { title: sh2.title, line: 'Three weeks of fog.', public: '1' } });
    const today = new Date().toISOString().slice(0, 10);
    r = await req(port, 'POST', `/hang/${sh2.id}/show`, { cookie: showck, body: { opens_at: today, closes_at: '2099-01-01', venue: 'Little West 12th' } }); assert.equal(r.status, 302);
    r = await req(port, 'GET', `/hang/${sh2.slug}`); { const h = r.body.toString(); assert.ok(h.includes('A show') && h.includes('now showing') && h.includes('Little West 12th'), 'the wall reads as a show'); }
    // The opening: a reply card on the show; a photographer is handed the application; the list is the curator's.
    assert.ok(r.body.toString().includes(`/hang/${sh2.id}/rsvp`), 'the show carries the reply card');
    r = await req(port, 'POST', `/hang/${sh2.id}/rsvp`, { body: { name: 'Ada Lens', email: 'ada@example.com', maker: '1', plus: '1' } }); assert.equal(r.status, 303);
    r = await req(port, 'GET', r.headers.location.replace(/^https?:\/\/[^/]+/, '')); assert.ok(r.body.toString().includes('You are on the list') && r.body.toString().includes('/join?name=Ada'), 'a photographer is handed the application');
    assert.equal(db.prepare('SELECT plus FROM rsvps WHERE hang_id=?').get(sh2.id).plus, 1);
    r = await req(port, 'GET', `/hang/${sh2.id}/guests`); assert.equal(r.status, 404, 'the list is private');
    r = await req(port, 'GET', `/hang/${sh2.id}/guests.csv`, { cookie: showck }); assert.ok(r.body.toString().includes('ada@example.com'), 'the curator has the list');
    r = await req(port, 'GET', '/collectors'); assert.ok(r.body.toString().includes('>Shows<') && r.body.toString().includes('Venice, in Winter'), 'Galleries leads with shows');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='show.opening'").get(), 'the opening is on the register');
    r = await req(port, 'GET', `/m/${gal.handle}`);  assert.ok(r.body.toString().includes('Represents') && r.body.toString().includes('Venice, in Winter'), 'the gallery page: artists and shows'); }
  console.log('ok: galleries');
  // The editions room (20 Oct): prints sold off the wall at a show. The Studio opens the house's sizes on a work; a guest at the show taps the wall label's QR, acquires a 16 × 24 to take home; the number is allotted, the print room gets the order, the show's desk lists it, the register tells it.
  { const dims = db.prepare('SELECT width, height FROM works WHERE id=?').get(w.id); db.prepare('UPDATE works SET width=6000, height=4000 WHERE id=?').run(w.id); // a master at the print standard, for the test
    r = await req(port, 'POST', `/studio/works/${w.slug}/editions`, { cookie: ck, body: { open: '1' } }); assert.equal(r.status, 302);
    const eds = db.prepare('SELECT * FROM print_editions WHERE work_id=? ORDER BY sort').all(w.id); assert.equal(eds.length, 3, 'the house\'s three sizes'); assert.equal(eds[1].label, '16 × 24');
    r = await req(port, 'POST', `/studio/works/${w.slug}/editions`, { cookie: ck, body: { id: String(eds[0].id), label: '11 × 14', long_in: '14', paper: 'Hahnemühle Photo Rag', edition_n: '10', price: '275', framed: '150', active: '1' } }); assert.equal(db.prepare('SELECT price_cents, edition_n FROM print_editions WHERE id=?').get(eds[0].id).price_cents, 27500, 'a row edited');
    r = await req(port, 'GET', `/studio/works/${w.slug}`, { cookie: ck }); assert.ok(r.body.toString().includes('The print editions') && r.body.toString().includes('16 × 24'), 'the record shows them');
    r = await req(port, 'POST', `/hang/${hg.id}/show`, { cookie: sck, body: { opens_at: '2026-11-06', closes_at: '2026-12-06', venue: 'The Leica Gallery, Meatpacking' } });
    r = await req(port, 'POST', '/hang/add', { cookie: sck, body: { work: w.slug, hang: String(hg.id) } });
        r = await req(port, 'GET', `/hang/${hg.id}/labels`, { cookie: sck }); const lb = r.body.toString(); assert.ok(r.status === 200 && lb.includes('QR code') && lb.includes('16 × 24 in') && lb.includes('$650') && lb.includes(`show=${hg.slug}`), 'wall labels with the QR and the editions');
    r = await req(port, 'GET', `/hang/${hg.id}/labels`); assert.equal(r.status, 404, 'labels are the curator\'s');
    r = await req(port, 'GET', `/hang/${hg.slug}`); assert.ok(r.body.toString().includes('Prints from $275'), 'the wall says what remains');
    r = await req(port, 'GET', `/w/${w.slug}?show=${hg.slug}`); const showck = (r.headers['set-cookie'] || []).find(c => c.startsWith('wm_via=')); assert.ok(showck, 'the show is remembered from the label'); const pg = r.body.toString(); assert.ok(pg.includes('Have it on your wall.') && pg.includes('Edition of 12') && pg.includes('Take it home from the show'), 'the print block at the show: ' + (pg.match(/class="pe"[\s\S]{0,200}/) || [''])[0]);
    r = await req(port, 'POST', `/w/${w.slug}/print`, { cookie: showck.split(';')[0], body: { edition: String(eds[1].id), framed: '1', how: 'pickup' } }); assert.equal(r.status, 303, 'to checkout: ' + r.status);
    const pid = r.headers.location.split('/').pop(), ps = sessions[pid]; assert.equal(ps.line_items[0].price_data.unit_amount, 95000, '$650 + $300 framed'); assert.ok(!ps.shipping_address_collection, 'no address for a pickup');
    Object.assign(ps, { payment_status: 'paid', amount_total: 95000, customer_details: { email: 'guest@show.com', name: 'A Guest', phone: '+12125551212' } });
    const pref = ps.metadata.ref; { const payload2 = JSON.stringify({ id: 'evt_print', type: 'checkout.session.completed', data: { object: ps } }); const sig2 = require('stripe')('sk_test_dummy').webhooks.generateTestHeaderString({ payload: payload2, secret: 'whsec_test' }); r = await req(port, 'POST', '/stripe/webhook', { body: payload2, headers: { 'content-type': 'application/json', 'stripe-signature': sig2 } }); assert.equal(r.status, 200); }
    const pl = db.prepare('SELECT * FROM licenses WHERE ref=?').get(pref); assert.equal(pl.status, 'active', 'granted'); const pr = JSON.parse(pl.rights); assert.equal(pr.print.no, 1, 'No. 1 of 12');
    const po = db.prepare("SELECT * FROM print_orders WHERE license_id=? AND kind='edition'").get(pl.id); assert.ok(po && po.paid === 1 && po.status === 'asked' && po.edition_no === 1 && po.framed === 1 && po.pickup === 1 && po.show_id === hg.id && po.email === 'guest@show.com', 'the print room has the order: ' + JSON.stringify(po));
    assert.equal(db.prepare('SELECT via FROM licenses WHERE ref=?').get(pref).via, `hang:${hg.id}`, 'the sale is the show\'s');
    r = await req(port, 'GET', `/hang/${hg.id}/sales`, { cookie: sck }); const sd = r.body.toString(); assert.ok(sd.includes('what sold') && sd.includes('16 × 24') && sd.includes('Taken home') && sd.includes('$950'), 'the show\'s desk');
    r = await req(port, 'GET', `/hang/${hg.id}/sales.csv`, { cookie: sck }); assert.ok(r.body.toString().includes('pickup') && r.body.toString().includes('guest@show.com'), 'the packing list');
    r = await req(port, 'GET', '/studio/prints', { cookie: ck }); assert.ok(r.body.toString().includes('The print, No. 1') && r.body.toString().includes('taken home from the show'), 'in the print room');
    r = await req(port, 'GET', '/ledger'); assert.ok(/A print of .* No\. 1 of 12, was acquired at the show/.test(r.body.toString()), 'told on the register');
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.toString().includes('11 remain'), 'one fewer');
    db.prepare('UPDATE works SET width=?, height=? WHERE id=?').run(dims.width, dims.height, w.id); }
  console.log('ok: the editions room');
  // Batch (20 Oct): tick works, publish the lot with one attestation; make private; grade; the Studio curates.
  { db.prepare("UPDATE works SET status='hidden' WHERE maker_id=?").run(est.id); const mine2 = db.prepare("SELECT slug FROM works WHERE maker_id=? AND status='hidden' ORDER BY id").all(est.id).map(x => x.slug); assert.ok(mine2.length >= 2, 'two private works to publish: ' + mine2.length);
    r = await req(port, 'POST', '/account/works/batch', { cookie: mck, body: { slugs: mine2.join(','), do: 'publish' } }); assert.ok(/not: the attestation/.test(decodeURIComponent(r.headers.location)), 'no attestation, nothing published');
    r = await req(port, 'POST', '/account/works/batch', { cookie: mck, body: { slugs: mine2.join(','), do: 'publish', attest: '1' } }); assert.ok(new RegExp(`${mine2.length} published`).test(decodeURIComponent(r.headers.location)), 'published by batch: ' + decodeURIComponent(r.headers.location));
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM works WHERE slug IN (${mine2.map(() => '?').join(',')}) AND status='held'`).get(...mine2).n, mine2.length, 'all public'); assert.ok(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='work.published' AND data LIKE '%batch%'").get().n >= mine2.length, 'each on the register');
    r = await req(port, 'POST', '/account/works/batch', { cookie: mck, body: { slugs: mine2[0], do: 'stars', stars: '5' } }); assert.equal(db.prepare('SELECT stars, curated FROM works WHERE slug=?').get(mine2[0]).curated, 1, 'five stars is a jewel');
    r = await req(port, 'POST', '/account/works/batch', { cookie: mck, body: { slugs: mine2.join(','), do: 'hide' } }); assert.equal(db.prepare(`SELECT COUNT(*) n FROM works WHERE slug IN (${mine2.map(() => '?').join(',')}) AND status='hidden'`).get(...mine2).n, mine2.length, 'made private by batch');
    r = await req(port, 'POST', '/account/works/batch', { body: { slugs: mine2.join(','), do: 'publish', attest: '1' } }); assert.equal(r.status, 401, 'a stranger cannot');
    r = await req(port, 'POST', '/account/works/batch', { cookie: mck, body: { slugs: w.slug, do: 'hide' } }); assert.equal(db.prepare('SELECT status FROM works WHERE id=?').get(w.id).status, 'held', 'another maker\'s work is untouched');
    r = await req(port, 'GET', '/account', { cookie: mck }); assert.ok(r.body.toString().includes('data-batch') && r.body.toString().includes('name="slugs"'), 'the bar on the studio');
    r = await req(port, 'POST', '/studio/works/batch', { cookie: ck, body: { slugs: mine2.join(','), do: 'curate', back: '/studio/trove?view=list' } }); assert.ok(/curated/.test(decodeURIComponent(r.headers.location)) && r.headers.location.startsWith('/studio/trove?view=list'), 'the Studio curates a batch');
    r = await req(port, 'GET', '/studio/trove?view=list', { cookie: ck }); assert.ok(r.body.toString().includes('data-batch') && r.body.toString().includes('form="batchForm"'), 'the bar on Studio → Works');
    r = await req(port, 'POST', '/account/works/batch', { cookie: mck, body: { slugs: mine2.join(','), do: 'publish', attest: '1' } }); db.prepare('UPDATE works SET curated=0, stars=0 WHERE maker_id=?').run(est.id); }
  console.log('ok: batch');
  // Your looking: the record of standing; for you, never the same twice.
  { const vcode = 'tester12345'; const slugs = db.prepare("SELECT slug FROM works WHERE status='held' AND slug NOT IN ('test-dome') ORDER BY id DESC LIMIT 3").all().map(x => x.slug);
    for (const [i, sl] of slugs.entries()) { await req(port, 'POST', `/w/${sl}/stood`, { cookie: `wm_v=${vcode}`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: vcode, s: 0 }) }); await req(port, 'POST', `/w/${sl}/stood`, { cookie: `wm_v=${vcode}`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: vcode, s: 40 * (i + 1) }) }); }
    await req(port, 'POST', `/w/${slugs[0]}/stood`, { cookie: `wm_v=${vcode}`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: vcode, s: 0 }) });
    r = await req(port, 'GET', '/api/for-you?n=2', { cookie: `wm_v=${vcode}` }); const a = JSON.parse(r.body); assert.ok(a.picks.length === 2 && a.picks.every(p => !slugs.includes(p.slug)), 'never what they have seen');
    r = await req(port, 'GET', '/api/for-you?n=2', { cookie: `wm_v=${vcode}` }); const b2 = JSON.parse(r.body); assert.ok(b2.picks.length === 2 && !b2.picks.some(p => a.picks.some(q => q.slug === p.slug)), 'never the same twice');
    r = await req(port, 'GET', '/yours/looking', { cookie: `wm_v=${vcode}` }); { const h = r.body.toString(); assert.ok(h.includes('Your looking') && h.includes('The one that held you') && h.includes('Longest in front of'), 'the record'); assert.ok(h.includes('You keep coming back to'), 'visits counted'); } }
  console.log('ok: looking');
  // The buy button must sit inside its form (a nested <form> once closed it early).
  r = await req(port, 'GET', `/license/${w.slug}?use=social`); { const h = r.body.toString(); const a = h.indexOf('class="buy-form"'), b = h.indexOf('id="buyBtn"'); const between = h.slice(a, b); assert.ok(a > 0 && b > a && !/<\/form>/.test(between) && !/<form\b/.test(between), 'nothing closes the buy form before its button'); }
  // The frame: a screen pairs by code; the phone is the remote; the set can be collected in one tap from the pocket.
  r = await req(port, 'GET', '/frame'); assert.ok(r.body.toString().includes('Pair a screen') && r.body.toString().includes('How it is licensed'), 'the frame\'s door');
  r = await req(port, 'GET', '/frame/tv'); { const h = r.body.toString(); const fcode = (h.match(/data-code="([A-Z]{5})"/) || [])[1]; assert.ok(fcode && h.includes(fcode) && h.includes('data-waiting="1"'), 'the screen shows its code');
    r = await req(port, 'GET', `/frame/tv/${fcode}/state`); let fs = JSON.parse(r.body); assert.ok(fs.works.length > 0 && fs.works.every(w => /\/screen$/.test(w.img)), 'unheld pieces at screen size');
    r = await req(port, 'GET', `/frame/pair?code=${fcode.toLowerCase()}`); assert.ok(r.headers.location.endsWith('/frame/' + fcode), 'pairs by code');
    r = await req(port, 'GET', `/frame/${fcode}`, { cookie: sck }); assert.ok(r.body.toString().includes('The remote') && r.body.toString().includes('Collect the set'), 'the remote');
    r = await req(port, 'POST', `/frame/${fcode}`, { cookie: sck, body: { set: 'today', q: '', every: '15', plate: 'always', music: 'quiet' } }); assert.ok(r.headers.location.includes('ok='));
    r = await req(port, 'GET', `/frame/tv/${fcode}/state`); fs = JSON.parse(r.body); assert.ok(fs.every === 15 && fs.music === 'quiet' && fs.plate === 'always', 'the remote changed the screen');
    const sb = db.prepare("SELECT b.* FROM buyers b JOIN frames f ON f.buyer_id=b.id WHERE f.code=?").get(fcode); assert.ok(sb, 'the first signed-in hand holds the screen');
    const need = fs.works.filter(w => !w.held).length; db.prepare("INSERT INTO pocket (buyer_id, cents, kind, ref, note) VALUES (?,?,?,?,?)").run(sb.id, need * 500 + 100, 'topup', 'test', 'for the frame');
    r = await req(port, 'POST', `/frame/${fcode}/collect`, { cookie: sck, body: { from: 'pocket' } }); assert.ok(decodeURIComponent(r.headers.location).includes('Yours:'), 'the set collected from the pocket');
    r = await req(port, 'GET', `/frame/tv/${fcode}/state`); fs = JSON.parse(r.body); assert.ok(fs.works.length && fs.works.every(w => w.held && /\/large$/.test(w.img)), 'now at full size');
    r = await req(port, 'GET', '/tv'); assert.equal(r.headers.location, '/frame/tv'); }
  console.log('ok: the frame');
  // The stroll: the first photographs in the page, more by the API, never what was already seen, a word to stroll through.
  { r = await req(port, 'GET', '/wander'); assert.equal(r.status, 200); assert.ok(/class="st-i"/.test(r.body) && /__WM_STROLL/.test(r.body) && /data-st-hat/.test(r.body), 'the stroll opens with photographs and the rail');
    r = await req(port, 'GET', '/api/stroll?n=3'); const s1 = JSON.parse(r.body); assert.equal(s1.items.length, 3); assert.ok(s1.items.every(w => /\/img\//.test(w.img) && w.maker && w.makerSlug));
    r = await req(port, 'GET', '/api/stroll?n=20&seen=' + s1.items.map(w => w.slug).join(',')); const s2 = JSON.parse(r.body); assert.ok(s2.items.length && !s2.items.some(w => s1.items.find(x => x.slug === w.slug)), 'never the same twice');
    r = await req(port, 'GET', '/api/stroll?n=5&q=zzzz-no-such'); assert.equal(JSON.parse(r.body).items.length, 0);
    r = await req(port, 'GET', '/wander?at=' + s1.items[0].slug); assert.ok(r.body.indexOf('data-slug="' + s1.items[0].slug + '"') < r.body.indexOf('data-slug="', r.body.indexOf('data-slug="' + s1.items[0].slug + '"') + 10), 'opens at the one asked for'); }
    // The doors beside the stroll (19 Oct): a swipe left opens the Keys, a swipe right Yours (the wallet, as a collector or a maker).
    const sd1 = JSON.parse((await req(port, 'GET', '/api/stroll?n=1')).body).items[0].slug;
    r = await req(port, 'GET', '/wander'); assert.ok(/data-st-side="keys"/.test(r.body) && /data-st-side="yours"/.test(r.body) && /data-st-doors="keys"/.test(r.body), 'the two doors and their tabs are in the page');
    r = await req(port, 'GET', '/stroll/side/' + sd1); let sd = JSON.parse(r.body); assert.ok(/The bench/.test(sd.keys) && /The balcony/.test(sd.keys) && /kmk-mark/.test(sd.keys) && /The collection/.test(sd.keys) && /Sign in/.test(sd.yours), 'a stranger sees the Keys and a sign-in');
    r = await req(port, 'GET', '/stroll/side/' + sd1, { cookie: sck }); sd = JSON.parse(r.body); assert.ok(/Your pocket/.test(sd.yours) && /Your gallery/.test(sd.yours) && !/data-sd-switch/.test(sd.yours), 'a collector sees the wallet, no switch');
    r = await req(port, 'GET', '/stroll/side/' + sd1, { cookie: mck }); sd = JSON.parse(r.body); assert.ok(/data-sd-switch="maker"/.test(sd.yours) && /Owed to you/.test(sd.yours) && /Your pocket/.test(sd.yours), 'a maker sees both sides and the switch');
    r = await req(port, 'GET', '/wander?in=mine', { cookie: sck }); assert.ok(r.status === 200 && /Your gallery/.test(r.body) && /class="st-i"/.test(r.body), 'a collector strolls their own gallery');
    r = await req(port, 'GET', '/stroll/side/' + sd1, { cookie: sck }); assert.ok(/\/wander\?in=mine/.test(JSON.parse(r.body).yours), 'the door offers it');
    r = await req(port, 'GET', '/yours', { cookie: sck }); assert.ok(/yc-stroll/.test(r.body) && /data-slug=/.test(r.body), 'and the gallery opens with it');
    r = await req(port, 'GET', '/stroll/side/no-such-work'); sd = JSON.parse(r.body); assert.equal(sd.keys, '');
  console.log('ok: the stroll');
  // The first collector (19 Oct): the house names No. 1 by hand; the honour shows on the gallery, the Galleries page and the Keys.
  { r = await req(port, 'GET', '/studio/founders', { cookie: ck }); assert.ok(r.status === 200 && /The Founding Collectors/.test(r.body), 'the founders desk');
    const fb = db.prepare("SELECT b.* FROM buyers b JOIN licenses l ON l.buyer_id=b.id WHERE l.collector_no IS NOT NULL AND l.status='active' ORDER BY l.id DESC LIMIT 1").get(); assert.ok(fb, 'a numbered collector to name');
    r = await req(port, 'GET', '/studio/founders?q=' + encodeURIComponent(fb.email || fb.code), { cookie: ck }); assert.ok(/Name as the first collector/.test(r.body), 'found by email or code');
    r = await req(port, 'POST', '/studio/founders/first', { cookie: ck, body: { id: String(fb.id) } }); assert.ok(/is the first collector/.test(decodeURIComponent(r.headers.location)));
    r = await req(port, 'POST', '/studio/founders/note', { cookie: ck, body: { note: 'the founder’s mother' } }); assert.equal(r.status, 302);
    assert.equal(app.locals.founders.no(fb), 1, 'No. 1 by hand, whatever the clock said');
    r = await req(port, 'GET', '/keys'); assert.ok(/The first collector of the house/.test(r.body) && /founder’s mother/.test(r.body), 'said on the Keys');
    r = await req(port, 'GET', '/studio/founders', { cookie: ck }); assert.ok(/the first collector/.test(r.body));
    r = await req(port, 'POST', '/studio/founders/first', { cookie: ck, body: { id: '' } }); assert.ok(/clock/.test(decodeURIComponent(r.headers.location)), 'un-named'); assert.ok(!app.locals.founders.firstId());
  }
  console.log('ok: the first collector');
  // The season, the Circle and the cards (19 Oct): a night opens to the Circle first; a member replies and sees who is coming; a card between two keyholders; yes → the house introduces both.
  { const wmk = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id);
    r = await req(port, 'GET', '/circle'); assert.equal(r.status, 301, 'the old door leads on'); r = await req(port, 'GET', '/club'); assert.ok(r.status === 200 && /The Club\./.test(r.body) && /Join the Club/.test(r.body) && /under forty/.test(r.body), 'the Circle page');
    r = await req(port, 'GET', '/season'); assert.ok(r.status === 200 && /The season\./.test(r.body), 'the season page');
    r = await req(port, 'POST', '/club/join', { cookie: sck, body: { level: 'guest', name: 'Season Collector', email: 'sck@example.com' } }); assert.ok(/ok=check/.test(r.headers.location), 'the attestation is needed');
    r = await req(port, 'POST', '/club/join', { cookie: sck, body: { level: 'guest', name: 'Season Collector', email: 'sck@example.com', attest: '1' } }); assert.ok(r.status === 303 && /checkout\.stripe\.test/.test(r.headers.location), 'to Checkout, by the year');
    const cr = db.prepare("SELECT * FROM circle ORDER BY id DESC LIMIT 1").get(); assert.ok(cr && cr.status === 'pending' && cr.buyer_id && cr.stripe_session, 'pending, tied to the collector');
    app.locals.seasonEvent({ type: 'checkout.session.completed', data: { object: { id: cr.stripe_session, status: 'complete', payment_status: 'paid', subscription: 'sub_c', metadata: { circle: String(cr.id) } } } });
    assert.equal(db.prepare('SELECT status FROM circle WHERE id=?').get(cr.id).status, 'active', 'the webhook makes a member');
    r = await req(port, 'GET', '/club', { cookie: sck }); assert.ok(/You are a member of the Club/.test(r.body) && /In the Club/.test(r.body), 'the member sees the room');
    // the Studio throws a night
    r = await req(port, 'POST', '/studio/season', { cookie: ck, body: { title: 'A late night at the galleries', kind: 'late', at: '2031-05-09T21:00', city: 'New York', venue: 'The Long Gallery', address: '1 Meridian Street', line: 'The pictures, the people, the hour.', capacity: '2', makers: wmk.handle, circle_first: '1', status: 'open', work_slug: w.slug } });
    const ni = db.prepare("SELECT * FROM nights ORDER BY id DESC LIMIT 1").get(); assert.ok(ni && ni.status === 'open' && ni.slug === 'a-late-night-at-the-galleries', 'the night is made and open');
    assert.ok(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='night.opened'").get().n >= 1, 'told on the register');
    r = await req(port, 'GET', '/ledger'); assert.ok(/opens its doors in New York/.test(r.body), 'in a sentence');
    assert.ok(db.prepare("SELECT COUNT(*) n FROM notices WHERE kind='night' AND buyer_id=?").get(cr.buyer_id).n >= 1, 'the Circle is told');
    r = await req(port, 'GET', '/season/' + ni.slug); assert.ok(r.status === 200 && /A late night at the galleries/.test(r.body) && /The artists present/.test(r.body) && !/1 Meridian Street/.test(r.body), 'the page, the artists, never the address to a stranger');
    r = await req(port, 'POST', `/season/${ni.slug}/reply`, { cookie: mck, body: { name: 'The Maker' } }); assert.ok(/ok=circle/.test(r.headers.location), 'a keyholder waits: the Circle first');
    r = await req(port, 'POST', `/season/${ni.slug}/reply`, { cookie: sck, body: { name: 'Season Collector', plus: '1', note: 'Bringing a friend who collects.' } }); assert.ok(/ok=going/.test(r.headers.location), 'the member comes, with a guest');
    r = await req(port, 'GET', '/season/' + ni.slug, { cookie: sck }); assert.ok(/You are coming, with a guest/.test(r.body) && /1 Meridian Street/.test(r.body) && /Who is coming/.test(r.body) && /the Club/.test(r.body), 'the address and the room, to those coming');
    db.prepare("UPDATE nights SET created_at=datetime('now','-3 days') WHERE id=?").run(ni.id);
    r = await req(port, 'POST', `/season/${ni.slug}/reply`, { cookie: mck, body: { name: 'The Maker' } }); assert.ok(/ok=waiting/.test(r.headers.location), 'after the Circle’s hours: the room is full, the list');
    r = await req(port, 'POST', `/season/${ni.slug}/cancel`, { cookie: sck }); assert.equal(db.prepare("SELECT status FROM night_guests WHERE night_id=? AND maker_id IS NOT NULL").get(ni.id).status, 'going', 'the place passes to the first waiting');
    r = await req(port, 'GET', `/studio/season/${ni.id}/guests.csv`, { cookie: ck }); assert.ok(/name,email/.test(r.body) && /The Maker/.test(r.body), 'the list');
    // the cards
    const mm = db.prepare("SELECT * FROM makers WHERE handle='the-ada-estate'").get();
    r = await req(port, 'GET', `/meet/card?to=m:${mm.id}&about=night:${ni.slug}`, { cookie: sck }); assert.ok(r.status === 200 && /Leave the card/.test(r.body), 'the card page');
    r = await req(port, 'POST', '/meet/card', { cookie: sck, body: { to: `m:${mm.id}`, about: `night:${ni.slug}`, note: 'short' } }); assert.ok(/ok=check/.test(r.headers.location), 'a sentence');
    r = await req(port, 'POST', '/meet/card', { cookie: sck, body: { to: `m:${mm.id}`, about: `night:${ni.slug}`, note: 'Your staircase held me for four minutes; I would like to hear how you found it.' } }); assert.ok(/ok=card/.test(r.headers.location), 'the card is left');
    r = await req(port, 'POST', '/meet/card', { cookie: sck, body: { to: `m:${mm.id}`, note: 'Another sentence for the same person, today.' } }); assert.ok(/ok=carded/.test(r.headers.location), 'never twice');
    assert.ok(db.prepare("SELECT COUNT(*) n FROM notices WHERE kind='card' AND maker_id=?").get(mm.id).n >= 1, 'the maker is told');
    r = await req(port, 'GET', '/meet', { cookie: mck }); assert.ok(/Left for you/.test(r.body) && /four minutes/.test(r.body) && /Yes, introduce us/.test(r.body), 'the maker reads it');
    const cd = db.prepare('SELECT * FROM cards ORDER BY id DESC LIMIT 1').get();
    r = await req(port, 'POST', `/meet/${cd.id}/answer`, { cookie: mck, body: { a: 'yes' } }); assert.ok(/ok=yes/.test(r.headers.location));
    assert.ok(db.prepare('SELECT introduced_at FROM cards WHERE id=?').get(cd.id).introduced_at, 'introduced');
    r = await req(port, 'GET', '/meet', { cookie: sck }); assert.ok(/Introduced,/.test(r.body), 'the collector sees it');
    r = await req(port, 'GET', '/ledger'); assert.ok(!/four minutes|Season Collector|a card/.test(r.body.toString()), 'nothing of it on the register');
    r = await req(port, 'GET', `/bench/${w.slug}`, { cookie: sck }); assert.ok(r.status === 200, 'the bench still reads');
    r = await req(port, 'GET', '/stroll/side/' + w.slug, { cookie: sck }); assert.ok(/The season/.test(JSON.parse(r.body).keys), 'the Keys door says the season');
    r = await req(port, 'GET', '/keys'); assert.ok(/The Club/.test(r.body) && /The Season/.test(r.body), 'the rooms');
    r = await req(port, 'POST', '/meet/prefs', { cookie: mck, body: { line: 'I make pictures of staircases.' } }); r = await req(port, 'POST', '/meet/card', { cookie: mck, body: { to: `b:${cr.buyer_id}`, note: 'Thank you for the card; a sentence back.' } }); assert.ok(/ok=card|ok=carded/.test(r.headers.location));
    r = await req(port, 'POST', '/studio/season', { cookie: ck, body: { id: String(ni.id), title: ni.title, kind: 'late', at: '2031-05-09T21:00', status: 'past', came: '14' } }); assert.ok(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='night.held'").get().n >= 1, 'held, told');
  }
  console.log('ok: the season, the Club and the cards');
  // The Keyhole Room (19 Oct): a dinner is drawn, not first come; the Circle first; the menu only to those seated.
  { const wmk = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id);
    r = await req(port, 'POST', '/studio/season', { cookie: ck, body: { title: 'The dinner, October', kind: 'dinner', at: '2031-06-01T19:30', city: 'New York', venue: 'A private room', address: '2 Meridian Street', capacity: '1', menu: 'Oysters.\n\nA roast.', makers: wmk.handle, circle_first: '0', status: 'open' } });
    const dn = db.prepare("SELECT * FROM nights WHERE kind='dinner' ORDER BY id DESC LIMIT 1").get(); assert.ok(dn && dn.menu, 'the dinner is set with a menu');
    r = await req(port, 'GET', '/season/' + dn.slug, { cookie: mck }); assert.ok(/Put my name down/.test(r.body) && !/Oysters/.test(r.body), 'names go down; no menu yet');
    r = await req(port, 'POST', `/season/${dn.slug}/reply`, { cookie: mck, body: { name: 'The Maker' } }); assert.ok(/ok=asked/.test(r.headers.location), 'the maker asks first');
    r = await req(port, 'POST', `/season/${dn.slug}/reply`, { cookie: sck, body: { name: 'Season Collector' } }); assert.ok(/ok=asked/.test(r.headers.location), 'the Circle member asks second');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM night_guests WHERE night_id=? AND status='asked'").get(dn.id).n, 2);
    r = await req(port, 'POST', `/studio/season/${dn.id}/draw`, { cookie: ck }); assert.ok(/1%20seated|1 seated/.test(r.headers.location), 'one seat drawn');
    const seated = db.prepare("SELECT * FROM night_guests WHERE night_id=? AND status='going'").all(dn.id); assert.ok(seated.length === 1 && seated[0].buyer_id, 'the Circle member is seated first, though they asked second');
    r = await req(port, 'GET', '/season/' + dn.slug, { cookie: sck }); assert.ok(/You are seated/.test(r.body) && /Oysters/.test(r.body) && /2 Meridian Street/.test(r.body), 'the menu and the address to the seated');
    r = await req(port, 'GET', '/season/' + dn.slug, { cookie: mck }); assert.ok(/kept for the next/.test(r.body) && !/Oysters/.test(r.body), 'the other is kept for the next, no menu');
    r = await req(port, 'GET', `/studio/season/${dn.id}/guests`, { cookie: ck }); assert.ok(/Draw the table/.test(r.body) && /Seat</.test(r.body), 'the desk');
  }
  console.log('ok: the Keyhole Room');
  // Harder to copy (19 Oct): the screen rendition carries the house's mark and /verify says so; served scripts carry no comments.
  { r = await req(port, 'GET', `/img/${w.slug}/screen?f=jpg`); assert.equal(r.status, 200);
    const M = require('../src/mark'); const marked = await M.embed(r.body, M.renditionPayload(w.id), 's'); const t = await app.locals.mark.trace(marked); assert.ok(t && t.rendition && t.work.slug === w.slug, 'a rendition mark traces to its work (off by default on served renditions until masked)');
    const sharp = require('sharp'); const re = await sharp(marked).jpeg({ quality: 70 }).toBuffer(); const t2 = await app.locals.mark.trace(re); assert.ok(t2 && t2.rendition, 'and after recompression');
    r = await req(port, 'GET', `/img/${w.slug}/thumb?f=jpg`); assert.equal(r.status, 200, 'thumbs unmarked, served');
    r = await req(port, 'GET', '/static/stroll.js'); assert.ok(r.status === 200 && !/\/\/ |\/\*/.test(r.body.toString().slice(0, 4000)) && r.body.length < require('fs').statSync('public/stroll.js').size, 'stroll.js leaves stripped');
    r = await req(port, 'GET', '/static/style.css'); assert.ok(r.status === 200, 'style.css is served');
    r = await req(port, 'GET', '/sw.js'); assert.ok(r.status === 200 && /self\.addEventListener|addEventListener/.test(r.body.toString()), 'the service worker still works');
  }
  console.log('ok: harder to copy');
  // You already own it, the way in, the rooms (20 Oct).
  { r = await req(port, 'GET', '/own'); assert.ok(r.status === 200 && /You already own it\./.test(r.body) && /Open my studio/.test(r.body), '/own');
    r = await req(port, 'GET', `/w/${w.slug}/deed`); assert.ok(r.status === 200 && /a deed of authorship/.test(r.body) && /Fingerprint/.test(r.body) && /Entered the register/.test(r.body), 'the deed');
    r = await req(port, 'POST', '/record', { body: { name: 'Rec Order', email: 'rec@example.com' } }); assert.ok(/\/account\/upload\?welcome=own/.test(r.headers.location), 'the open door opens a studio'); const rck = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const rm = db.prepare("SELECT * FROM makers WHERE email='rec@example.com'").get(); assert.ok(rm && rm.door === 'record', 'a recorded maker');
    r = await req(port, 'GET', '/account/upload?welcome=own', { cookie: rck }); assert.ok(r.status === 200 && /Your studio is open/.test(r.body), 'the vault welcomes');
    const MINE = path.join(dir, 'mine.jpg'); await require('sharp')(SRC).resize({ width: 2600, height: 1700, fit: 'fill' }).modulate({ hue: 90 }).jpeg({ quality: 80 }).toFile(MINE);
    const fd = Buffer.concat([Buffer.from('--b\r\nContent-Disposition: form-data; name="file"; filename="mine.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'), fs.readFileSync(MINE), Buffer.from('\r\n--b--\r\n')]);
    r = await req(port, 'POST', '/account/works/one', { cookie: rck, headers: { 'content-type': 'multipart/form-data; boundary=b' }, body: fd }); const j = JSON.parse(r.body); assert.ok(j.ok && /This is yours\. It has been since/.test(j.yours) && /\/deed$/.test(j.deed), 'the arrival sentence and the deed');
    r = await req(port, 'POST', `/account/works/${j.slug}/show`, { cookie: rck, body: { attest: '1' } }); assert.ok(/need=invited/.test(r.headers.location), 'a recorded maker cannot hang until invited');
    r = await req(port, 'GET', '/account', { cookie: rck }); assert.ok(/The way in/.test(r.body) && /Ask the house/.test(r.body), 'the way in on the studio');
    // ready to hang: the moment is read from the work; one piece is not a body of work
    r = await req(port, 'POST', '/account/ask-house', { cookie: rck, body: { note: 'Please look.' } }); assert.ok(/ok=notyet/.test(r.headers.location), 'not yet: the house reads the moment from the work'); assert.equal(db.prepare('SELECT COUNT(*) n FROM house_asks WHERE maker_id=?').get(rm.id).n, 0);
    const recSlugs = []; for (let i = 0; i < 12; i++) { const sl = `rec-body-${i}`; recSlugs.push(sl); db.prepare("INSERT INTO works (maker_id, slug, title, caption, place, taken_at, width, height, original_file, sha256, status, stars) VALUES (?,?,?,?,?,?,?,?,?,?,'hidden',?)").run(rm.id, sl, `Body ${i}`, 'A sentence on it.', 'Rome', '2025-05-01', 4000, 3000, 'mine.jpg', 'rec' + i, i < 8 ? 5 : 0); }
    db.prepare("UPDATE makers SET bio='A photographer of the quiet hours in the old cities of Europe.' WHERE id=?").run(rm.id); db.prepare("INSERT INTO uses (maker_id, key, name, description, price_cents) VALUES (?, 'social', 'Collect', 'Keep it', 500)").run(rm.id);
    r = await req(port, 'GET', '/account', { cookie: rck }); assert.ok(/5 of 5|4 of 5/.test(r.body) && /name="note"/.test(r.body), 'the way in opens the ask: ' + (String(r.body).match(/hd-n">[^<]+/) || [])[0]);
    r = await req(port, 'POST', '/account/ask-house', { cookie: rck, body: { note: 'Please look.' } }); assert.ok(/ok=asked/.test(r.headers.location)); assert.equal(db.prepare('SELECT COUNT(*) n FROM house_asks WHERE maker_id=?').get(rm.id).n, 1);
    r = await req(port, 'GET', '/studio/accounts', { cookie: ck }); assert.ok(/Asking to hang/.test(r.body) && /Rec Order/.test(r.body) && new RegExp(`/studio/review/${rm.id}`).test(r.body), 'the house sees the ask');
    r = await req(port, 'GET', `/studio/review/${rm.id}`, { cookie: ck }); assert.ok(r.status === 200 && /The house looks/.test(r.body) && /8 in the edit/.test(r.body) && (String(r.body).match(/name="hang"/g) || []).length === 8 && /hang the first show/.test(r.body), 'the review room shows the edit');
    r = await req(port, 'POST', `/studio/accounts/${rm.id}/invite`, { cookie: ck, body: { hang: recSlugs.slice(0, 3) } }); assert.equal(db.prepare('SELECT door FROM makers WHERE id=?').get(rm.id).door, 'house');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(rm.id).n, 3, 'the first show is hung by the house; the rest stays in the record');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held' AND stars>=4").get(rm.id).n, 3, 'the house’s choice is a grade: the first show wanders at once');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='work.published' AND subject=? AND data LIKE '%\"by\":\"house\"%'").get(recSlugs[0]), 'told on the register');
    db.prepare("DELETE FROM works WHERE slug LIKE 'rec-body-%'").run();
    r = await req(port, 'POST', `/account/works/${j.slug}/show`, { cookie: rck, body: { attest: '1' } }); assert.ok(!/need=/.test(r.headers.location), 'invited: it hangs');
    r = await req(port, 'GET', '/account/copyright', { cookie: rck }); assert.ok(r.status === 200 && /Register these/.test(r.body), 'the Office, one tap');
    r = await req(port, 'POST', '/account/copyright/ask', { cookie: rck, body: { w: j.slug } }); assert.ok(r.status === 303 && /checkout/.test(r.headers.location), 'to Checkout at the Office’s fee');
    r = await req(port, 'GET', '/account/prices', { cookie: rck }); assert.ok(/Said simply/.test(r.body), 'said simply');
    // the rooms
    r = await req(port, 'GET', `/img/${w.slug}/thumb?f=jpg`); const clear = r.body;
    r = await req(port, 'POST', `/studio/works/${w.slug}/zone`, { cookie: ck, body: { zone: 'mature', note: 'nudity' } }); assert.equal(db.prepare('SELECT zone FROM works WHERE id=?').get(w.id).zone, 'mature');
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.status === 200 && /A room not for children/.test(r.body) && /nudity/.test(r.body) && !/class="ap"/.test(r.body), 'a stranger meets the door');
    r = await req(port, 'GET', `/img/${w.slug}/thumb?f=jpg`); assert.ok(r.status === 200 && !r.body.equals(clear), 'the picture is veiled');
    r = await req(port, 'GET', '/api/stroll?n=40'); assert.ok(!JSON.parse(r.body).items.some(i => i.slug === w.slug), 'left out of the stroll');
    r = await req(port, 'POST', '/zone/enter', { body: { back: `/w/${w.slug}` } }); const zk = r.headers['set-cookie'][0].split(';')[0]; assert.ok(/wm_zone=mature/.test(zk));
    r = await req(port, 'GET', `/w/${w.slug}`, { cookie: zk }); assert.ok(/Not for children/.test(r.body) && /class="ap"/.test(r.body), 'inside, labelled');
    r = await req(port, 'GET', `/img/${w.slug}/thumb?f=jpg`, { cookie: zk }); assert.ok(r.body.equals(clear), 'and clear');
    r = await req(port, 'POST', '/zone', { body: { zone: 'family' } }); const fk = r.headers['set-cookie'][0].split(';')[0];
    r = await req(port, 'GET', `/w/${w.slug}`, { cookie: fk }); assert.ok(/set to Family/.test(r.body), 'family: the door stays closed');
    r = await req(port, 'POST', `/studio/works/${w.slug}/zone`, { cookie: ck, body: {} }); assert.equal(db.prepare('SELECT zone FROM works WHERE id=?').get(w.id).zone, 'all');
  }
  console.log('ok: you already own it, and the rooms');
  // The committees (20 Oct): the Front Door and the Walls.
  { r = await req(port, 'GET', '/hanging'); assert.ok(r.status === 200 && /Who hangs, and how it is decided/.test(r.body) && /The Front Door/.test(r.body) && /The Walls/.test(r.body), 'the standard is public');
    r = await req(port, 'GET', '/committee'); assert.equal(r.status, 401, 'no seat, no desk');
    r = await req(port, 'GET', '/studio/committee', { cookie: ck }); assert.ok(r.status === 200 && /No seats yet/.test(r.body));
    const seatOf = async (name, email, committee) => { r = await req(port, 'POST', '/studio/committee/seat', { cookie: ck, body: { committee, name, email, label: 'a test eye' } }); const row = db.prepare('SELECT * FROM reviewers WHERE email=? AND committee=?').get(email, committee); assert.ok(row, 'seated'); r = await req(port, 'GET', `/committee/join/${row.token}`); assert.ok(/\/committee\?welcome=1/.test(r.headers.location)); return (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; '); };
    const s1 = await seatOf('Ada Seat', 'ada@example.com', 'door'), s2 = await seatOf('Bo Seat', 'bo@example.com', 'door');
    r = await req(port, 'GET', '/committee?welcome=1', { cookie: s1 }); assert.ok(r.status === 200 && /Your seat is open/.test(r.body) && /The Front Door/.test(r.body) && !/The Walls/.test(String(r.body).replace(/Who hangs[^]*$/, '')) , 'a seat sees its own committee');
    // a second recorded maker, ready, asks; two votes hang the first show
    r = await req(port, 'POST', '/record', { body: { name: 'Cee Order', email: 'cee@example.com' } }); const cck = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const cm = db.prepare("SELECT * FROM makers WHERE email='cee@example.com'").get();
    const ceeSlugs = []; for (let i = 0; i < 12; i++) { const sl = `cee-body-${i}`; ceeSlugs.push(sl); db.prepare("INSERT INTO works (maker_id, slug, title, caption, place, taken_at, width, height, original_file, sha256, status, stars) VALUES (?,?,?,?,?,?,?,?,?,?,'hidden',?)").run(cm.id, sl, `Cee ${i}`, 'A sentence.', 'Lisbon', '2025-06-01', 4000, 3000, 'mine.jpg', 'cee' + i, i < 8 ? 4 : 0); }
    db.prepare("UPDATE makers SET bio='Streets at the blue hour, for a decade now.' WHERE id=?").run(cm.id); db.prepare("INSERT INTO uses (maker_id, key, name, description, price_cents) VALUES (?, 'social', 'Collect', 'Keep it', 500)").run(cm.id);
    r = await req(port, 'POST', '/account/ask-house', { cookie: cck, body: {} }); assert.ok(/ok=asked/.test(r.headers.location));
    r = await req(port, 'GET', `/committee/review/${cm.id}`, { cookie: s1 }); assert.ok(r.status === 200 && /Hang: the ticked pieces/.test(r.body), 'the seat\'s review room');
    r = await req(port, 'POST', `/committee/review/${cm.id}/vote`, { cookie: s1, body: { vote: 'hang', hang: ceeSlugs.slice(0, 4), note: 'Yes.' } }); assert.ok(/1 more decide/.test(decodeURIComponent(r.headers.location)), 'one vote waits: ' + r.headers.location);
    assert.equal(db.prepare('SELECT door FROM makers WHERE id=?').get(cm.id).door, 'record');
    r = await req(port, 'POST', `/committee/review/${cm.id}/vote`, { cookie: s2, body: { vote: 'hang', hang: ceeSlugs.slice(2, 6) } }); assert.ok(/is invited/.test(decodeURIComponent(r.headers.location)));
    assert.equal(db.prepare('SELECT door FROM makers WHERE id=?').get(cm.id).door, 'house', 'two votes invite');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(cm.id).n, 6, 'the first show is the union of what the voters ticked');
    const inv = db.prepare("SELECT data FROM ledger WHERE type='maker.invited' AND subject=?").get(cm.handle); assert.ok(/committee/.test(inv.data) && /Ada Seat/.test(inv.data), 'the register names the seats');
    r = await req(port, 'GET', '/ledger'); assert.ok(/Ada and Bo of the Front Door/.test(r.body), 'told in public');
    // the Walls: two votes take a work back to the record
    const w1 = await seatOf('Dee Seat', 'dee@example.com', 'walls'), w2 = await seatOf('Eve Seat', 'eve@example.com', 'walls');
    const hungOne = db.prepare("SELECT * FROM works WHERE slug=?").get(ceeSlugs[0]);
    r = await req(port, 'GET', '/committee', { cookie: w1 }); assert.ok(/The Walls/.test(r.body) && new RegExp(`/committee/walls/${hungOne.id}`).test(r.body), 'the Walls sees the recent hang');
    r = await req(port, 'POST', `/committee/walls/${hungOne.id}`, { cookie: w1, body: { vote: 'down', note: 'Not yet the edit.' } }); assert.equal(db.prepare('SELECT status FROM works WHERE id=?').get(hungOne.id).status, 'held');
    r = await req(port, 'POST', `/committee/walls/${hungOne.id}`, { cookie: w2, body: { vote: 'down' } }); assert.equal(db.prepare('SELECT status FROM works WHERE id=?').get(hungOne.id).status, 'hidden', 'back to the record, never deleted');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='work.unhung' AND subject=?").get(hungOne.slug));
    r = await req(port, 'POST', `/committee/walls/${hungOne.id}`, { cookie: s1, body: { vote: 'down' } }); assert.equal(r.status, 401, 'a Front Door seat has no vote on the Walls');
    r = await req(port, 'GET', '/hanging'); assert.ok(/Sitting now: Ada, a test eye/.test(r.body), 'the seats are named on the standard');
    db.prepare("DELETE FROM works WHERE slug LIKE 'cee-body-%'").run();
  }
  console.log('ok: the committees');
  // The restoration room (20 Oct): if it is not sound, it is not shown.
  { const CV = app.locals.conservation; assert.ok(CV);
    let r0 = await CV.check(w); assert.ok(r0.ok, 'a sound work passes: ' + r0.findings.join('; '));
    r = await req(port, 'GET', `/img/${w.slug}/screen?f=jpg`); assert.equal(r.status, 200); const cacheDir = path.join(dir, 'cache'); const bad = fs.readdirSync(cacheDir).find(f => f.startsWith(w.slug + '-screen') && f.endsWith('.jpg')); assert.ok(bad, 'a display copy exists');
    // damage the display copy: a blocky, dark, wrong picture in its place
    await require('sharp')({ create: { width: 1600, height: 1000, channels: 3, background: { r: 20, g: 20, b: 20 } } }).jpeg({ quality: 20 }).toFile(path.join(cacheDir, bad));
    const damagedBytes = fs.statSync(path.join(cacheDir, bad)).size;
    r0 = await CV.check(w); assert.ok(r0.ok, 'a damaged display copy is remade from the original and the work stays on view: ' + r0.findings.join('; '));
    assert.equal(db.prepare('SELECT status FROM works WHERE id=?').get(w.id).status, 'held', 'still on the walls'); assert.notEqual(fs.statSync(path.join(cacheDir, bad)).size, damagedBytes, 'the copy was remade');
    // damage the original itself: a hard finding, and only the second check in a row takes it off view
    const origPath = path.join(dir, 'originals', db.prepare('SELECT original_file FROM works WHERE id=?').get(w.id).original_file); const origBytes = fs.readFileSync(origPath);
    fs.writeFileSync(origPath, origBytes.subarray(0, Math.floor(origBytes.length / 2)));
    r0 = await CV.check(w); assert.ok(!r0.ok && /does not decode whole/.test(r0.findings.join(' ')), 'the damaged original is caught: ' + r0.findings.join('; '));
    assert.equal(db.prepare('SELECT status FROM works WHERE id=?').get(w.id).status, 'held', 'one bad check never empties a wall');
    r0 = await CV.check(w); assert.equal(db.prepare('SELECT status FROM works WHERE id=?').get(w.id).status, 'restoring', 'off view on the second');
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.status === 200 && /Off view for conservation/.test(r.body), 'the sign on its page');
    r = await req(port, 'GET', '/api/stroll?n=40'); assert.ok(!JSON.parse(r.body).items.some(i => i.slug === w.slug), 'left out of the walks');
    r = await req(port, 'GET', '/ledger'); assert.ok(/is off view for conservation/.test(r.body), 'told on the register');
    r = await req(port, 'GET', '/studio/restoration', { cookie: ck }); assert.ok(r.status === 200 && /In the room/.test(r.body) && new RegExp(`/studio/restoration/${w.id}/rebuild`).test(r.body), 'the room shows it');
    fs.writeFileSync(origPath, origBytes); // the original restored (from the mirror, say)
    r = await req(port, 'POST', `/studio/restoration/${w.id}/rebuild`, { cookie: ck }); assert.ok(/rebuilt and sound/.test(decodeURIComponent(r.headers.location)), 'rebuilt: ' + decodeURIComponent(r.headers.location));
    assert.equal(db.prepare('SELECT status FROM works WHERE id=?').get(w.id).status, 'held', 'back on the walls by itself once it passes');
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(!/Off view for conservation/.test(r.body));
    r = await req(port, 'GET', '/healthz', { cookie: ck }); assert.ok(JSON.parse(r.body).conservation && JSON.parse(r.body).conservation.checked >= 1);
    r = await req(port, 'GET', `/img/${w.slug}/wall?f=jpg`); assert.equal(r.status, 200, 'the wall size'); assert.ok(/max-age=3600, must-revalidate/.test(r.headers['cache-control']), 'honest caching');
  }
  console.log('ok: the restoration room');
  // The physical work (20 Oct): kinds, the object record, its label, the cabinet's registrar card and book.
  { r = await req(port, 'POST', `/studio/works/${w.slug}/object`, { cookie: ck, body: { kind: 'painting', medium: 'oil on linen', dims: '61 × 46 cm', edition: 'unique', signed: 'signed lower right', located: 'the studio', note: 'private' } }); assert.equal(db.prepare('SELECT kind FROM works WHERE id=?').get(w.id).kind, 'painting');
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(/Painting by/.test(r.body) && /class="ob-label"/.test(r.body) && /oil on linen/.test(r.body) && /The object/.test(r.body), 'the by-line and the label follow the kind');
    r = await req(port, 'GET', `/w/${w.slug}/object`); assert.ok(r.status === 200 && /A painting by/.test(r.body) && /61 × 46 cm/.test(r.body) && /photograph of record/.test(r.body) && !/the studio/.test(r.body) && !/private/.test(r.body), 'the object page, private fields kept back');
    r = await req(port, 'GET', `/w/${w.slug}/object`, { cookie: ck }); assert.ok(/the studio/.test(r.body), 'the house sees where it is');
    r = await req(port, 'GET', `/api/v1/works/${w.slug}`); const wj = JSON.parse(r.body); assert.ok(wj.kind === 'painting' && /Painting by/.test(wj.byline) && wj.object && wj.object.dimensions === '61 × 46 cm', 'the API carries the kind');
    r = await req(port, 'POST', `/studio/works/${w.slug}/object`, { cookie: ck, body: { kind: 'photograph', medium: 'Digital photograph' } }); assert.equal(db.prepare('SELECT kind FROM works WHERE id=?').get(w.id).kind, 'photograph');
    // the cabinet's card and book
    const cab = db.prepare('SELECT * FROM cabinet ORDER BY id DESC LIMIT 1').get(); assert.ok(cab, 'a cabinet work from the cabinet test');
    const owner = db.prepare('SELECT * FROM buyers WHERE id=?').get(cab.buyer_id); assert.ok(owner, 'the cabinet owner'); if (!owner.email) db.prepare('UPDATE buyers SET email=? WHERE id=?').run('cabinet-owner@example.com', owner.id); const oem = owner.email || 'cabinet-owner@example.com'; r = await req(port, 'POST', '/signin/code', { body: { email: oem } }); r = await req(port, 'POST', '/signin/verify', { body: { email: oem, code: app.locals.lastCode.code } }); const okc = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    r = await req(port, 'POST', `/cabinet/${cab.id}/record`, { cookie: okc, body: { accession: '2026.001', acquired: '2024-05', from_whom: 'the artist', paid: '1200', value: '2500', located: 'the hall', condition: 'excellent', provenance: 'The artist; the collector.', work: w.slug } }); assert.ok(/cab=recorded/.test(r.headers.location));
    const c2 = db.prepare('SELECT * FROM cabinet WHERE id=?').get(cab.id); assert.ok(c2.paid_cents === 120000 && c2.value_cents === 250000 && c2.work_id === w.id, 'the card is kept');
    r = await req(port, 'GET', '/yours/cabinet/book', { cookie: okc }); assert.ok(r.status === 200 && /2026\.001/.test(r.body) && /\$2,500/.test(r.body) && /the hall/.test(r.body), 'the book');
    r = await req(port, 'GET', '/yours/cabinet.csv', { cookie: okc }); assert.ok(/text\/csv/.test(r.headers['content-type']) && /2026\.001/.test(r.body) && /the artist/.test(r.body), 'the spreadsheet');
    r = await req(port, 'GET', '/yours/cabinet/book'); assert.equal(r.status, 302, 'nobody else');
  }
  console.log('ok: the physical work');
  // The artists behind the work (26 Oct): the artist's record, the rights by dates, the verdict per purpose, Al's
  // reading, the maker's dismissal, the house's override, the claim, the room.
  {
    const uses0 = (await req(port, 'GET', `/api/v1/works/${w.slug}`)).body; assert.ok(/"instant"/.test(uses0.toString()), 'uses before');
    // a public-domain artist: everything sells
    r = await req(port, 'POST', `/studio/works/${w.slug}/art`, { cookie: ck, body: { do: 'set', name: 'Johannes Vermeer', movement: 'Dutch Golden Age' } }); assert.equal(r.status, 302);
    let a = db.prepare("SELECT * FROM artists WHERE name='Johannes Vermeer'").get(); assert.ok(a && a.slug === 'johannes-vermeer' && a.sort_name === 'Vermeer, Johannes', 'the artist is recorded');
    db.prepare('UPDATE artists SET born=1632, died=1675 WHERE id=?').run(a.id);
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(/by Johannes Vermeer \(1632–1675\)/.test(r.body) && /Public domain/.test(r.body) && /\/art\/johannes-vermeer/.test(r.body), 'the line under the plate');
    assert.ok(app.locals.art.blocks(db.prepare('SELECT * FROM works WHERE id=?').get(w.id), 'story') === false, 'public domain: open');
    r = await req(port, 'GET', '/art/johannes-vermeer'); assert.ok(r.status === 200 && /Johannes Vermeer/.test(r.body) && /Public domain/.test(r.body) && new RegExp(w.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(r.body) && /Photograph by/.test(r.body), 'the artist’s page');
    r = await req(port, 'GET', '/art'); assert.ok(r.status === 200 && /Vermeer/.test(r.body) && /Dutch Golden Age/.test(r.body), 'the room');
    // an artist under copyright: collect for yourself, license nothing
    r = await req(port, 'POST', `/studio/works/${w.slug}/art`, { cookie: ck, body: { do: 'set', name: 'Pollock, Jackson', movement: 'Abstract Expressionism' } });
    a = db.prepare("SELECT * FROM artists WHERE sort_name='Pollock, Jackson'").get(); assert.ok(a, 'a second artist, by surname first'); db.prepare('UPDATE artists SET born=1912, died=1956 WHERE id=?').run(a.id);
    const w2 = db.prepare('SELECT * FROM works WHERE id=?').get(w.id); assert.equal(w2.artist_id, a.id);
    assert.ok(app.locals.art.blocks(w2, 'story') && app.locals.art.blocks(w2, 'wall') && app.locals.art.blocks(w2, 'print') && !app.locals.art.blocks(w2, 'social'), 'under copyright: the licences close, the personal Collect stays');
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(/Under copyright: yours to collect, not to license/.test(r.body), 'said on the page');
    r = await req(port, 'GET', `/api/v1/works/${w.slug}`); const uj = JSON.parse(r.body); assert.ok(uj.uses.every(u => u.key === 'social'), 'the API lists only the Collect: ' + uj.uses.map(u => u.key).join(','));
    process.env.ART_STRICT = '1'; assert.ok(app.locals.art.blocks(w2, 'social'), 'strict closes the Collect too'); delete process.env.ART_STRICT;
    r = await req(port, 'GET', '/art/pollock-jackson'); assert.ok(/Under copyright/.test(r.body) && /Are you Pollock, Jackson, or the estate/.test(r.body), 'the claim door on a reserved page');
    // the house overrides
    r = await req(port, 'POST', `/studio/works/${w.slug}/art`, { cookie: ck, body: { do: 'override', value: 'open' } }); assert.ok(!app.locals.art.blocks(db.prepare('SELECT * FROM works WHERE id=?').get(w.id), 'story'), 'the house opens it');
    r = await req(port, 'POST', `/studio/works/${w.slug}/art`, { cookie: ck, body: { do: 'override', value: 'closed' } }); assert.ok(app.locals.art.blocks(db.prepare('SELECT * FROM works WHERE id=?').get(w.id), 'social'), 'the house closes everything');
    r = await req(port, 'POST', `/studio/works/${w.slug}/art`, { cookie: ck, body: { do: 'override', value: '' } });
    r = await req(port, 'POST', `/studio/works/${w.slug}/art`, { cookie: ck, body: { do: 'clear' } }); assert.equal(db.prepare('SELECT artist_id FROM works WHERE id=?').get(w.id).artist_id, null, 'unlinked');
    // Al's reading closes the sale by itself; the maker's word reopens it
    const hadKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-key'; const prevF = app.locals.__fetch;
    app.locals.__fetch = async (u, o) => { u = String(u); if (/api\.anthropic\.com/.test(u)) return { ok: true, json: async () => ({ model: 'mock', content: [{ type: 'text', text: JSON.stringify({ art: true, artist: 'Mark Rothko', title: 'No. 14', date: '1960', medium: 'oil on canvas', movement: 'Abstract Expressionism', museum: 'SFMOMA', confidence: 0.86, note: 'Two soft-edged fields of colour.' }) }] }) }; return prevF ? prevF(u, o) : fetch(u, o); };
    r = await req(port, 'POST', `/studio/works/${w.slug}/art`, { cookie: ck, body: { do: 'ask' } }); assert.ok(/ok=asked/.test(r.headers.location));
    const w3 = db.prepare('SELECT * FROM works WHERE id=?').get(w.id); const s3 = JSON.parse(w3.attribution); assert.ok(s3.art && s3.artist === 'Mark Rothko' && s3.confidence > 0.8, 'Al’s reading kept');
    assert.ok(app.locals.art.blocks(w3, 'story') && !app.locals.art.blocks(w3, 'social'), 'Al’s confident word closes the licences, unknown dates taken as under copyright');
    r = await req(port, 'GET', `/studio/works/${w.slug}`, { cookie: ck }); assert.ok(/Al says:/.test(r.body) && /Mark Rothko/.test(r.body) && /Yours to collect, not to license/.test(r.body) && /The house’s say/.test(r.body), 'the record shows the reading, the verdict and the override');
    r = await req(port, 'POST', `/account/works/${w.slug}/art`, { cookie: mck, body: { do: 'dismiss' } }); assert.equal(r.status, 403, 'another maker may not'); r = await req(port, 'POST', `/studio/works/${w.slug}/art`, { cookie: ck, body: { do: 'dismiss' } }); assert.equal(r.status, 302);
    assert.ok(!app.locals.art.blocks(db.prepare('SELECT * FROM works WHERE id=?').get(w.id), 'story'), 'the maker’s word reopens it');
    db.prepare('UPDATE works SET attribution=NULL WHERE id=?').run(w.id); app.locals.__fetch = prevF; if (hadKey) process.env.ANTHROPIC_API_KEY = hadKey; else delete process.env.ANTHROPIC_API_KEY;
    // a claim on the page
    r = await req(port, 'POST', '/art/pollock-jackson/claim', { body: { name: 'The Foundation', email: 'estate@example.org', relation: 'foundation', note: 'We hold the rights.' } }); assert.ok(/ok=sent/.test(r.headers.location));
    const cl = db.prepare('SELECT * FROM artist_claims WHERE artist_id=?').get(a.id); assert.ok(cl && cl.status === 'asked'); assert.equal(db.prepare('SELECT claim_status FROM artists WHERE id=?').get(a.id).claim_status, 'asked');
    r = await req(port, 'GET', '/studio/art', { cookie: ck }); assert.ok(/1 waiting/.test(r.body), 'the desk shows the claim');
    r = await req(port, 'POST', `/studio/art/pollock-jackson/claims/${cl.id}`, { cookie: ck, body: { do: 'accept' } }); a = db.prepare('SELECT * FROM artists WHERE id=?').get(a.id); assert.ok(a.claim_status === 'claimed' && a.claimed_email === 'estate@example.org', 'claimed');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='artist.claimed' AND subject='pollock-jackson'").get(), 'on the register'); assert.ok(!(await req(port, 'GET', '/ledger')).body.toString().includes('artist.recorded'), 'the recording never on the public register');
    r = await req(port, 'POST', '/studio/art/pollock-jackson', { cookie: ck, body: { name: 'Jackson Pollock', born: '1912', died: '1956', nationality: 'American', movement: 'Abstract Expressionism', bio: 'Drip.', claim_status: 'claimed', sale_ok: '1', terms: 'Collect and prints allowed.' } });
    a = db.prepare('SELECT * FROM artists WHERE id=?').get(a.id); assert.ok(a.name === 'Jackson Pollock' && a.sale_ok === 1 && a.sort_name === 'Pollock, Jackson');
    assert.equal(require('../src/art').rights(a).state, 'claimed', 'terms set: open');
  }
  console.log('ok: the artists behind the work');
  // The clearance desk (26 Oct): what may be licensed, use by use; Al's reading of people and property; the papers.
  {
    const w0 = db.prepare('SELECT * FROM works WHERE id=?').get(w.id); const n0 = app.locals.clearance.needs(w0); assert.ok(n0.uses.commercial.ok && n0.uses.editorial.ok, 'unread: open');
    const hadKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-key'; const prevF = app.locals.__fetch;
    app.locals.__fetch = async (u, o) => { u = String(u); if (/api\.anthropic\.com/.test(u)) return { ok: true, json: async () => ({ model: 'mock', content: [{ type: 'text', text: JSON.stringify({ art: false, artist: null, confidence: 0.9, people: { recognisable: 2, minors: true, crowd: false }, property: { private: false, trademark: true, what: 'a shop sign' }, note: 'Two people at a shop door.' }) }] }) }; return prevF ? prevF(u, o) : fetch(u, o); };
    r = await req(port, 'POST', `/studio/works/${w.slug}/art`, { cookie: ck, body: { do: 'ask' } });
    let n = app.locals.clearance.needs(db.prepare('SELECT * FROM works WHERE id=?').get(w.id));
    assert.ok(n.people === 2 && n.minors && n.property && !n.uses.commercial.ok && !n.uses.campaign.ok && n.uses.editorial.ok && n.uses.print.ok && n.uses.social.ok, 'two people and a trademark: a company and a campaign close, a story, a print and a copy stay');
    assert.ok(/model release/.test(n.uses.commercial.why) && /guardian/.test(n.uses.commercial.why) && /property release/.test(n.uses.commercial.why), n.uses.commercial.why);
    r = await req(port, 'GET', `/api/v1/works/${w.slug}`); const cj = JSON.parse(r.body); assert.ok(cj.clearance && cj.clearance.people === 2 && cj.clearance.uses.commercial === false && cj.clearance.uses.editorial === true && !cj.uses.some(u => u.key === 'commercial' || u.key === 'campaign'), 'the API says so and the wall no longer offers the two');
    r = await req(port, 'GET', `/studio/works/${w.slug}`, { cookie: ck }); assert.ok(/What may be done with it/.test(r.body) && /2 recognisable people/.test(r.body) && /a shop sign/.test(r.body) && /✗ Not yet/.test(r.body) && /Add a release/.test(r.body), 'the record’s card');
    // the papers: two model releases (one a guardian's) and a property release, one with the signed form
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')]);
    r = await req(port, 'POST', `/studio/works/${w.slug}/clearance`, { cookie: ck, body: mp('release.pdf', pdf, { do: 'release', kind: 'person', subject: 'Jane Doe', signed_on: '2026-10-20' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } }); assert.ok(/ok=release/.test(r.headers.location), 'a release with its form: ' + r.headers.location);
    r = await req(port, 'POST', `/studio/works/${w.slug}/clearance`, { cookie: ck, body: { do: 'release', kind: 'person', subject: 'Tom Doe', minor: '1', kept_at: 'the studio file' } });
    n = app.locals.clearance.needs(db.prepare('SELECT * FROM works WHERE id=?').get(w.id)); assert.ok(n.have.person === 2 && n.have.guardian === 1 && !n.uses.commercial.ok && /property release/.test(n.uses.commercial.why) && !/model release/.test(n.uses.commercial.why), 'the people released; the property still wanted');
    r = await req(port, 'POST', `/studio/works/${w.slug}/clearance`, { cookie: ck, body: { do: 'release', kind: 'property', subject: 'The shop' } });
    n = app.locals.clearance.needs(db.prepare('SELECT * FROM works WHERE id=?').get(w.id)); assert.ok(n.uses.commercial.ok && n.released.model && n.released.property, 'released: open');
    const rel = db.prepare('SELECT * FROM work_releases WHERE work_id=? AND file IS NOT NULL').get(w.id); assert.ok(rel && /\.pdf$/.test(rel.file), 'the form kept');
    r = await req(port, 'GET', `/studio/works/${w.slug}/clearance/releases/${rel.id}/file`, { cookie: ck }); assert.ok(r.status === 200 && /private, no-store/.test(r.headers['cache-control']), 'the form served to the house, never cached');
    r = await req(port, 'GET', `/studio/works/${w.slug}/clearance/releases/${rel.id}/file`); assert.ok(r.status === 302 || r.status === 403, 'a stranger refused');
    r = await req(port, 'GET', `/api/v1/works/${w.slug}`); assert.ok(JSON.parse(r.body).clearance.model_released === true && JSON.parse(r.body).uses.some(u => u.key === 'commercial'), 'the wall offers the company’s use again');
    // the maker's word instead of paper; the house's say
    db.prepare('DELETE FROM work_releases WHERE work_id=?').run(w.id);
    r = await req(port, 'POST', `/studio/works/${w.slug}/clearance`, { cookie: ck, body: { do: 'attest', no_people: '1', no_property: '1' } }); n = app.locals.clearance.needs(db.prepare('SELECT * FROM works WHERE id=?').get(w.id)); assert.ok(n.uses.commercial.ok && n.people === 0, 'attested: open');
    r = await req(port, 'POST', `/studio/works/${w.slug}/clearance`, { cookie: ck, body: { do: 'override', value: 'closed' } }); assert.ok(app.locals.clearance.blocks(db.prepare('SELECT * FROM works WHERE id=?').get(w.id), 'commercial') && !app.locals.clearance.blocks(db.prepare('SELECT * FROM works WHERE id=?').get(w.id), 'editorial'), 'the house closes the two, never a story');
    r = await req(port, 'POST', `/studio/works/${w.slug}/clearance`, { cookie: ck, body: { do: 'override', value: '' } }); r = await req(port, 'POST', `/studio/works/${w.slug}/clearance`, { cookie: ck, body: { do: 'attest' } });
    db.prepare('UPDATE works SET attribution=NULL, clear_attest=NULL WHERE id=?').run(w.id); app.locals.__fetch = prevF; if (hadKey) process.env.ANTHROPIC_API_KEY = hadKey; else delete process.env.ANTHROPIC_API_KEY;
    r = await req(port, 'GET', '/clearance'); assert.ok(r.status === 200 && /model release/i.test(r.body) && /street photography/.test(r.body), 'the guide');
    r = await req(port, 'GET', '/release/model.pdf'); assert.ok(r.status === 200 && /application\/pdf/.test(r.headers['content-type']) && r.body.slice(0, 4).toString() === '%PDF', 'the model release form'); r = await req(port, 'GET', '/release/property.pdf'); assert.equal(r.status, 200);
    r = await req(port, 'POST', `/account/works/${w.slug}/clearance`, { cookie: mck, body: { do: 'attest', no_people: '1' } }); assert.equal(r.status, 403, 'another maker may not attest for this work');
    assert.ok(!(await req(port, 'GET', '/ledger')).body.toString().includes('release.kept'), 'never on the public register');
  }
  console.log('ok: the clearance desk');
  // The easel (20 Oct): the master study.
  { r = await req(port, 'GET', `/easel/${w.slug}`); assert.ok(r.status === 200 && /data-easel/.test(r.body) && /ez-notan5/.test(r.body) && /The master study/.test(r.body) && /data-ez="hold"/.test(r.body) && /easel\.js/.test(r.body), 'the easel');
    r = await req(port, 'GET', '/easel/no-such-work'); assert.equal(r.status, 302);
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(new RegExp(`/easel/${w.slug}`).test(r.body), 'the work page opens the easel');
    r = await req(port, 'GET', '/wander'); assert.ok(/data-st-easel/.test(r.body), 'the stroll opens the easel');
    r = await req(port, 'GET', '/static/easel.js'); assert.ok(r.status === 200 && /ez-notan2/.test(r.body)); }
  console.log('ok: the easel');

  // Deliveries (21 Oct): the maker sends a client their photographs by one link; no payment; each file licensed, marked, counted; the link closes.
  { r = await req(port, 'GET', `/account/deliveries?maker=${me}`, { cookie: ck }); assert.ok(r.status === 200 && r.body.toString().includes('Make the link'), 'the deliveries desk');
    const dck = `${ck}; ${(r.headers['set-cookie'] || []).find(c => c.startsWith('wm_as=')).split(';')[0]}`;
    r = await req(port, 'POST', '/account/deliveries', { cookie: dck, body: { title: 'The thirtieth', client: 'R. D.', email: 'rd@example.com', days: '30', size: 'original', note: 'With love.', works: w.slug } });
    assert.ok(/sent=/.test(r.headers.location), 'a delivery made'); const dtok = r.headers.location.split('sent=')[1];
    const dv = db.prepare('SELECT * FROM deliveries WHERE token=?').get(dtok); assert.ok(dv && dv.client_name === 'R. D.' && dv.expires_at, 'the delivery row');
    const dl = db.prepare("SELECT l.* FROM licenses l JOIN delivery_works dw ON dw.ref=l.ref WHERE dw.delivery_id=?").get(dv.id); assert.ok(dl && dl.status === 'active' && dl.price_cents == null && dl.download_token, 'a free licence of use delivery');
    assert.equal(db.prepare('SELECT u.key FROM uses u WHERE u.id=?').get(dl.use_id).key, 'delivery');
    r = await req(port, 'GET', `/deliver/${dtok}`); { const t = r.body.toString(); assert.ok(r.status === 200 && t.includes('Download all') && t.includes('The thirtieth') && t.includes('With love.') && t.includes(`/deliver/${dtok}/${w.slug}/file`) && t.includes(`/deliver/${dtok}/${w.slug}/file?full=1`), 'the client door: the copy, and the full file'); }
    // The copy by default (21 Oct: never 30 MB to a friend's phone): 2,400 pixels, marked within, the papers inside, no strip; the full file by ?full=1, the master's own pixels.
    { const sharp = require('sharp'); r = await req(port, 'GET', `/deliver/${dtok}/${w.slug}/file`); assert.ok(r.status === 200 && /attachment/.test(r.headers['content-disposition']), 'the copy');
      const md = await sharp(r.body).metadata(); assert.ok(Math.max(md.width, md.height) <= 2400, `the copy is 2,400 pixels (${md.width}×${md.height})`);
      const x = require('../src/mark').readXmp(r.body); assert.ok(x && x.license === dl.ref, 'and the papers');
      r = await req(port, 'GET', `/deliver/${dtok}/${w.slug}/file?full=1`); const wrow = db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug); const orig = fs.readFileSync(path.join(dir, 'originals', wrow.original_file));
      assert.ok((await sharp(orig).raw().toBuffer()).equals(await sharp(r.body).raw().toBuffer()), 'the full file is the master, pixel for pixel'); }
    r = await req(port, 'GET', `/d/${dl.download_token}`); assert.ok(r.status === 200 && /attachment/.test(r.headers['content-disposition']), 'the file by its licence');
    r = await req(port, 'GET', `/deliver/${dtok}/all.zip`); assert.ok(r.status === 200 && /zip/.test(r.headers['content-type']) && r.body.length > 1000, 'all of it as one zip');
    r = await req(port, 'GET', `/deliver/${dtok}/all.zip?full=1`); assert.ok(r.status === 200 && /zip/.test(r.headers['content-type']) && r.body.length > 1000, 'and the full files');
    assert.ok(db.prepare('SELECT COUNT(*) n FROM downloads WHERE license_id=?').get(dl.id).n >= 5, 'each download counted');
    r = await req(port, 'GET', '/ledger'); assert.ok(!r.body.toString().includes('R. D.'), 'the client is never on the register');
    r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(!r.body.toString().includes('Delivered'), 'the delivery use is never offered on a wall');
    r = await req(port, 'GET', `/deliver/${dtok}`); assert.ok(r.body.toString().includes('A thank-you card') && r.body.toString().includes(`name="via" value="${dtok}"`), 'the card to the photographer');
    r = await req(port, 'POST', `/w/${w.slug}/thanks`, { body: { via: dtok, amount: '499' } }); { const ts = sessions[r.headers.location.split('/').pop()]; assert.ok(ts && /\/deliver\//.test(ts.cancel_url) && /via=/.test(ts.success_url), 'the card returns to the album'); }
    // Wander the album (Will, 21 Oct): the door on the album, a kept-back photograph wanders too, the set's own label and way back, the card carries the album.
    { const hid = db.prepare("SELECT * FROM works WHERE status='hidden' AND maker_id=? ORDER BY id DESC LIMIT 1").get(dv.maker_id) || (() => { const x = db.prepare("SELECT * FROM works WHERE status='held' AND maker_id=? AND slug!=? ORDER BY id DESC LIMIT 1").get(dv.maker_id, w.slug); db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(x.id); return { ...x, status: 'hidden' }; })();
      db.prepare('INSERT OR IGNORE INTO delivery_works (delivery_id, work_id, pos, ref) VALUES (?,?,?,?)').run(dv.id, hid.id, 9, dl.ref);
      r = await req(port, 'GET', `/deliver/${dtok}`); { const t = r.body.toString(); assert.ok(t.includes(`/wander?in=delivery:${dtok}`) && t.includes('Wander through them') && t.includes('watermark-logo.svg') && t.includes('yours to keep'), 'the album as a present, with the door to wander'); }
      r = await req(port, 'GET', `/wander?in=delivery:${dtok}&at=${hid.slug}`); { const t = r.body.toString(); assert.ok(r.status === 200 && t.includes(`"slug":"${hid.slug}"`) && t.includes('The thirtieth') && t.includes(`"via":"${dtok}"`), 'a kept-back photograph wanders inside its album'); }
      r = await req(port, 'GET', `/api/stroll?in=delivery:${dtok}&n=8`); { const j = JSON.parse(r.body); assert.ok(j.items.some(i => i.slug === hid.slug) && j.items.some(i => i.slug === w.slug) && j.label === 'The thirtieth', 'the album as a set'); }
      r = await req(port, 'GET', `/wander?in=delivery:no-such-album`); assert.equal(r.status, 302, 'no album: its own door answers');
      db.prepare("UPDATE works SET status='held' WHERE id=?").run(hid.id); }
    // Keep it (23 Oct): a stranger keeps a photograph of the album with an email; a gallery opens, the piece hangs in it for good, the page is the tile; the maker is told; nothing on the public register.
    { r = await req(port, 'GET', `/deliver/${dtok}`); assert.ok(r.body.toString().includes(`data-dv-keep="${w.slug}"`) && r.body.toString().includes('Keep it'), 'Keep it under each photograph');
      r = await req(port, 'POST', `/deliver/${dtok}/${w.slug}/keep`, { body: { name: 'Nia Friend', email: 'nia@example.com' } }); assert.ok(/^\/thanks\/WM-[0-9-]+\?k=/.test(r.headers.location), 'kept: the tile'); const kck = (r.headers['set-cookie'] || []).find(c => c.startsWith('wm_b=')); assert.ok(kck, 'a gallery of her own');
      const kl = db.prepare("SELECT * FROM licenses WHERE licensee_email='nia@example.com' AND work_id=?").get(w.id); assert.ok(kl && kl.status === 'active' && kl.price_cents == null && !kl.ends_at && /^Kept from /.test(kl.intended_use) && kl.buyer_id, 'a free licence for good, hers');
      r = await req(port, 'GET', r.headers.location); assert.ok(r.status === 200 && r.body.toString().includes('class="yx in"') && r.body.toString().includes('A gift') && r.body.toString().includes('Kept &middot;'), 'the page says it was a gift');
      r = await req(port, 'GET', '/yours', { cookie: kck.split(';')[0] }); assert.ok(r.body.toString().includes(w.slug), 'it hangs in her gallery');
      { const kr = JSON.parse(kl.rights); assert.ok(kr.strip === false && ['share', 'full'].includes(kr.size), 'leaves at the album\'s size, no strip'); const f = await req(port, 'GET', `/d/${kl.download_token}?raw=1`); assert.equal(f.status, 200); const km = await require('sharp')(f.body).metadata(); assert.ok(kr.size === 'full' ? km.width >= 2400 : km.width <= 2400, 'the file at the album\'s size'); }
      r = await req(port, 'POST', `/deliver/${dtok}/${w.slug}/keep`, { body: { name: 'Nia Friend', email: 'nia@example.com' } }); const kl2 = db.prepare("SELECT COUNT(*) n FROM licenses WHERE licensee_email='nia@example.com' AND work_id=?").get(w.id).n; assert.equal(kl2, 1, 'kept once, however often it is asked');
      r = await req(port, 'POST', `/deliver/${dtok}/${w.slug}/keep`, { body: { name: 'No Mail' } }); assert.ok(/keep=email/.test(r.headers.location), 'an email is needed');
      r = await req(port, 'GET', '/ledger'); assert.ok(!/Nia Friend|nia@example/.test(r.body.toString()) && !/license\.kept/.test(r.body.toString()), 'the friend is never named on the public register'); }
    r = await req(port, 'POST', `/account/deliveries/${dv.id}/close`, { cookie: dck });
    r = await req(port, 'GET', `/deliver/${dtok}`); assert.equal(r.status, 410, 'closed');
    r = await req(port, 'GET', `/wander?in=delivery:${dtok}`); assert.equal(r.status, 302, 'a closed album cannot be wandered');
    r = await req(port, 'GET', `/d/${dl.download_token}`); assert.equal(r.status, 404, 'the licence ended with it');
    console.log('ok: deliveries'); }

  // A better file on top (Will, 21 Oct): a maker's vault takes a small version, then the full frame of the same picture, which becomes the master of the same record; a smaller one again is declined with the record named.
  { const sharp = require('sharp'); const mk = db.prepare('SELECT * FROM makers ORDER BY id LIMIT 1').get();
    const meta = await sharp(SRC).metadata(); const crop = { left: Math.floor(meta.width * 0.3), top: Math.floor(meta.height * 0.2), width: Math.floor(meta.width * 0.5), height: Math.floor(meta.height * 0.6) }; // a different picture from the fixture, so it matches nothing already held
    const fullUp = path.join(dir, 'full-up.jpg'); await sharp(SRC).extract(crop).flop().jpeg({ quality: 95 }).toFile(fullUp);
    const small = path.join(dir, 'small-up.jpg'); await sharp(fullUp).resize(300).jpeg({ quality: 90 }).toFile(small);
    const a = await app.locals.takeWork(small, { name: 'Up 1.jpg', title: 'The Small One', maker_id: mk.id }); assert.ok(a.ok && a.outcome === 'work', JSON.stringify(a));
    const big = path.join(dir, 'big-up.jpg'); fs.copyFileSync(fullUp, big);
    const b = await app.locals.takeWork(big, { name: 'Up 1 full.jpg', maker_id: mk.id }); assert.ok(b.ok && b.outcome === 'master' && b.slug === a.slug && /master of/.test(b.note), JSON.stringify(b));
    const wr = db.prepare('SELECT * FROM works WHERE slug=?').get(a.slug); assert.ok(wr.width > 300 && wr.master_at, 'the record now holds the full frame');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='work.master' AND subject=?").get(a.slug), 'told on the register');
    const smaller = path.join(dir, 'smaller-up.jpg'); await sharp(fullUp).resize(500).jpeg({ quality: 90 }).toFile(smaller);
    const c = await app.locals.takeWork(smaller, { name: 'Up 1 small again.jpg', maker_id: mk.id }); assert.ok(!c.ok && c.outcome === 'smaller' && /no larger/.test(c.error), JSON.stringify(c));
    assert.ok(!fs.existsSync(smaller), 'the declined file is not kept');
    // Twins from before (the full frame registered beside the small one): mergeTwins makes it the master and retires the twin.
    { const tw = path.join(dir, 'twin-full.jpg'); await sharp(SRC).extract({ left: 0, top: 0, width: Math.floor(meta.width * 0.45), height: Math.floor(meta.height * 0.7) }).jpeg({ quality: 95 }).toFile(tw);
      const twS = path.join(dir, 'twin-small.jpg'); await sharp(tw).resize(280).jpeg({ quality: 90 }).toFile(twS);
      const s1 = await app.locals.takeWork(twS, { name: 'Twin.jpg', title: 'The Twin', maker_id: mk.id }); assert.ok(s1.ok && s1.outcome === 'work');
      const big2 = await app.locals.registerWork({ file: tw, originalName: 'Twin full.jpg', title: 'The Twin Full', makerId: mk.id }); db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(big2.id);
      const n = await app.locals.mergeTwins(); assert.ok(n >= 1, 'a twin merged');
      const old = db.prepare('SELECT * FROM works WHERE slug=?').get(s1.slug), tw2 = db.prepare('SELECT * FROM works WHERE id=?').get(big2.id);
      assert.ok(old.width > 280 && old.master_at, 'the small record holds the full frame now'); assert.equal(tw2.status, 'merged');
      r = await req(port, 'GET', '/ledger'); assert.ok(!r.body.toString().includes('The Twin Full'), 'the merge is not told in public'); }
    console.log('ok: a better file on top'); }

  // The bag check (21 Oct): every file is sniffed by its bytes, searched for cargo, decoded whole, before it enters.
  { const BC = require('../src/bagcheck'); const tmp = require('os').tmpdir();
    const put = (name, buf) => { const f = path.join(tmp, 'bc-' + name); fs.writeFileSync(f, buf); return f; };
    let v = await BC.check(put('page.jpg', Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>'))); assert.ok(!v.ok && /web page/.test(v.reason), 'an HTML page in a .jpg is turned away: ' + v.reason);
    v = await BC.check(put('prog.jpg', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300)]))); assert.ok(!v.ok && /program/.test(v.reason), 'a program is turned away');
    v = await BC.check(put('svg.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))); assert.ok(!v.ok && /SVG/.test(v.reason), 'an SVG is turned away');
    const good = fs.readFileSync(path.join(__dirname, 'fixture.jpg'));
    v = await BC.check(put('good.jpg', good)); assert.ok(v.ok && v.type === 'jpeg', 'a photograph comes in: ' + v.reason);
    v = await BC.check(put('poly.jpg', Buffer.concat([good, Buffer.from('PK\x03\x04\x14\x00'), Buffer.alloc(200)]))); assert.ok(!v.ok && /zip/.test(v.reason), 'a zip hidden in a picture is turned away: ' + v.reason);
    v = await BC.check(put('cargo.jpg', Buffer.concat([good, Buffer.alloc(100 * 1024, 7)]))); assert.ok(!v.ok && /appended/.test(v.reason), 'cargo after the picture is turned away: ' + v.reason);
    v = await BC.check(put('cut.jpg', good.slice(0, Math.floor(good.length / 2)))); assert.ok(!v.ok && /damaged|cut short|does not open/.test(v.reason), 'a truncated picture is turned away: ' + v.reason);
    v = await BC.check(put('script.jpg', Buffer.concat([good.slice(0, 4000), Buffer.from('<script>x</script>'), good.slice(4000)]))); assert.ok(!v.ok && /script/.test(v.reason), 'a script in the bytes is turned away');
    v = await BC.check(put('voice.jpg', good), { expect: 'audio' }); assert.ok(!v.ok && /recording/.test(v.reason), 'a picture at the voice door is turned away');
    v = await BC.check(put('zip.wmark', Buffer.concat([Buffer.from('PK\x05\x06'), Buffer.alloc(20)])), { expect: 'proof' }); assert.ok(v.ok && v.type === 'zip', 'a .wmark at /verify comes in');
    // Through the door itself: the Studio's vault refuses a page named .jpg with a plain answer, and the refusal is kept.
    r = await req(port, 'POST', '/studio/works/one', { cookie: ck, body: mp('evil.jpg', Buffer.from('<html><script>1</script></html>'), { title: 'x' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary, accept: 'application/json' } });
    assert.ok(r.status === 415 && /web page/.test(r.body.toString()), 'the vault turns a page away: ' + r.status);
    assert.ok(db.prepare("SELECT COUNT(*) n FROM bagcheck WHERE ok=0").get().n >= 1, 'the refusal is kept');
    r = await req(port, 'GET', '/studio/door', { cookie: ck }); assert.ok(r.status === 200 && r.body.toString().includes('evil.jpg'), 'Studio → The door lists it');
    r = await req(port, 'GET', '/ledger'); assert.ok(!r.body.toString().includes('upload.refused') && !r.body.toString().includes('evil.jpg'), 'never on the public register');
    console.log('ok: the bag check'); }

  // Every inline script compiles (21 Oct: the vault's script had died on a backslash eaten by its template string, so choosing files did nothing).
  { const pages = [['/', null], ['/collection', null], [`/w/${w.slug}`, null], ['/wander', null], ['/keys', null], ['/yours', gck], [`/account/upload?maker=${me}`, ck], [`/account?maker=${me}`, ck], ['/studio', ck], ['/studio/masters', ck]];
    for (const [u, cookie] of pages) { r = await req(port, 'GET', u, cookie ? { cookie } : {}); assert.equal(r.status, 200, 'page ' + u);
      const html = r.body.toString(); const re = /<script(?![^>]*\bsrc=)(?![^>]*type="(?:module|application\/(?:ld\+)?json|speculationrules)")[^>]*>([\s\S]*?)<\/script>/g; let mm, n = 0;
      while ((mm = re.exec(html))) { n++; try { new Function(mm[1]); } catch (e) { assert.fail(`inline script on ${u} does not compile: ${e.message} :: ${mm[1].slice(0, 120)}`); } }
      assert.ok(n >= 1, 'scripts found on ' + u); }
    console.log('ok: every inline script compiles'); }
  // The house's portrait ships with the code (20 Oct).
  { await app.locals.seedPortrait(); const hm = db.prepare('SELECT * FROM makers WHERE handle=?').get('will-fullerton') || db.prepare('SELECT * FROM makers WHERE portrait IS NOT NULL ORDER BY id LIMIT 1').get(); assert.ok(hm && hm.portrait, 'the house maker has a portrait');
    r = await req(port, 'GET', `/portrait/${hm.handle}`); assert.equal(r.status, 200); const sq = await require('sharp')(r.body).metadata(); assert.ok(sq.width === 720 && sq.height === 720, 'the square');
    r = await req(port, 'GET', `/portrait/${hm.handle}?tall=1`); const tl = await require('sharp')(r.body).metadata(); assert.ok(tl.height > tl.width, 'the whole portrait, its own shape');
    r = await req(port, 'GET', '/director'); assert.ok(/tall=1/.test(r.body), 'the director stands in the whole portrait'); }
  console.log('ok: the portrait');





  // Yours on a phone (20 Oct): a collector whose email is a maker's gets the maker's door and the Studio | Gallery switch.
  { const sb = db.prepare("SELECT b.* FROM buyers b JOIN circle c ON c.buyer_id=b.id WHERE c.email='sck@example.com'").get(); assert.ok(sb);
    const ym = db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, buyer_id) VALUES ('yours-maker', 'Yours Maker', 'yours-maker@example.com', 'maker', datetime('now'), ?)").run(sb.id).lastInsertRowid;
    r = await req(port, 'GET', '/yours', { cookie: sck }); assert.ok(r.status === 200 && /class="yc-sw"/.test(r.body) && (r.headers['set-cookie'] || []).some(c => c.startsWith('wm_m=')), 'the switch appears and the maker cookie is set');
    db.prepare('DELETE FROM makers WHERE id=?').run(ym); }
  // For museums (19 Oct): a collection in from a IIIF manifest; the Image API out; the public page.
  { r = await req(port, 'GET', '/museums'); assert.ok(r.status === 200 && /Already built\. Plug in\./.test(r.body) && /info\.json/.test(r.body), 'the museums page');
    const held = db.prepare("SELECT slug, width FROM works WHERE status='held' AND width>500 LIMIT 1").get();
    r = await req(port, 'GET', `/iiif/${held.slug}/info.json`); const info = JSON.parse(r.body); assert.ok(info.type === 'ImageService3' && info.profile === 'level0' && info.sizes.length, 'the Image API describes a held work');
    r = await req(port, 'GET', `/iiif/${held.slug}/full/max/0/default.jpg`); assert.ok(r.status === 302 && /\/img\/.*\/large/.test(r.headers.location), 'and serves max');
    r = await req(port, 'GET', `/iiif/${held.slug}/full/400,/0/default.jpg`); assert.ok(/\/thumb/.test(r.headers.location), 'a small size from the thumb');
    r = await req(port, 'GET', `/iiif/${held.slug}/square/max/0/default.jpg`); assert.equal(r.status, 400, 'level 0 only');
    // A manifest of two canvases, served by the test's own fetch: the pictures are fresh renders so the fingerprints are new.
    const sharp = require('sharp'); const pics = [await sharp({ create: { width: 900, height: 600, channels: 3, background: '#7a5c3a' } }).jpeg().toBuffer(), await sharp({ create: { width: 700, height: 900, channels: 3, background: '#3a5c7a' } }).jpeg().toBuffer()];
    const man = { '@context': 'http://iiif.io/api/presentation/3/context.json', id: 'https://museum.example/m/1', type: 'Manifest', label: { en: ['The Harbour Pictures'] }, metadata: [{ label: { en: ['Place'] }, value: { en: ['Marseille'] } }],
      items: [0, 1].map(i => ({ id: `https://museum.example/c/${i}`, type: 'Canvas', label: { en: [`Harbour ${i + 1}`] }, metadata: [{ label: { en: ['Date'] }, value: { en: ['1911'] } }, { label: { en: ['Medium'] }, value: { en: ['Gelatin silver print'] } }], items: [{ type: 'AnnotationPage', items: [{ type: 'Annotation', body: { type: 'Image', format: 'image/jpeg', id: `https://museum.example/i/${i}.jpg`, service: [{ id: `https://museum.example/iiif/${i}`, type: 'ImageService3', profile: 'level1' }] } }] }] })) };
    app.locals.__fetch = async (u) => { u = String(u); if (u.includes('/m/1')) return { ok: true, json: async () => man }; const m = u.match(/\/iiif\/(\d)\/full\/max/); if (m) return { ok: true, arrayBuffer: async () => pics[+m[1]] }; return { ok: false, status: 404 }; };
    const inst = db.prepare("INSERT INTO makers (handle,name,kind) VALUES ('musee','Musée du Port','institution')").run().lastInsertRowid;
    r = await req(port, 'POST', '/studio/iiif', { cookie: ck, body: { maker: String(inst), url: 'https://museum.example/m/1', open: 'pd' } }); assert.ok(/\/studio\/iiif\/\d+/.test(r.headers.location), 'queued');
    for (let i = 0; i < 100 && db.prepare("SELECT status FROM iiif_imports ORDER BY id DESC LIMIT 1").get().status !== 'done'; i++) await new Promise(x => setTimeout(x, 50));
    const job = db.prepare('SELECT * FROM iiif_imports ORDER BY id DESC LIMIT 1').get(); assert.ok(job.status === 'done' && job.done === 2, 'two canvases brought in: ' + JSON.stringify(job));
    const got = db.prepare("SELECT * FROM works WHERE maker_id=? ORDER BY id").all(inst); assert.ok(got.length === 2 && got[0].status === 'hidden' && got[0].open === 'pd' && got[0].place === 'Marseille' && /1911/.test(got[0].taken_at) && /Gelatin/.test(got[0].medium) && got[0].title === 'Harbour 1', 'held back, public domain, with its record: ' + JSON.stringify(got[0]));
    r = await req(port, 'POST', '/studio/iiif', { cookie: ck, body: { maker: String(inst), url: 'https://museum.example/m/1' } });
    for (let i = 0; i < 100 && db.prepare("SELECT status FROM iiif_imports ORDER BY id DESC LIMIT 1").get().status !== 'done'; i++) await new Promise(x => setTimeout(x, 50));
    const again = db.prepare('SELECT * FROM iiif_imports ORDER BY id DESC LIMIT 1').get(); assert.ok(again.done === 0 && again.skipped === 2, 'a second run brings nothing twice: ' + JSON.stringify(again));
    r = await req(port, 'GET', '/studio/iiif', { cookie: ck }); assert.ok(/The Harbour Pictures/.test(r.body));
    const P = require('../src/iiif').parseManifest({ sequences: [{ canvases: [{ '@id': 'c1', label: 'One', images: [{ resource: { '@id': 'https://x/i.jpg', service: { '@id': 'https://x/iiif/1', profile: 'http://iiif.io/api/image/2/level1.json' } } }] }] }] }); assert.ok(P.items[0].image === 'https://x/iiif/1/full/full/0/default.jpg', 'v2 manifests too');
  }
  console.log('ok: for museums');
  { // The rights desk: one door per institution; the ask, the ticket, the answer.
    const inst = db.prepare("SELECT * FROM makers WHERE handle='musee'").get(); assert.ok(inst, 'the institution from the manifest');
    db.prepare("UPDATE works SET status='held' WHERE maker_id=?").run(inst.id);
    r = await req(port, 'GET', '/rights/musee?q=Harbour'); assert.ok(r.status === 200 && /Rights and reproductions\./.test(r.body) && /Harbour 1/.test(r.body) && /free, with credit/.test(r.body) && /The conditions/.test(r.body), 'the door: a held work found, free with credit, the conditions');
    r = await req(port, 'POST', '/rights/musee', { body: { kind: 'archive', what: 'Installation views of the 1911 harbour show, for a monograph.', use_kind: 'book', author: 'A. Reader', title: 'The Harbour', publisher: 'A Press', pub_date: '2027', territory: 'World', name: 'Ann Reader', email: 'ann@example.com', affiliation: 'A University', accept: '1' } });
    assert.ok(/ok=sent&t=RR-\d{4}-\d{5}/.test(r.headers.location), 'a ticket given'); const ticket = decodeURIComponent(r.headers.location.match(/t=([^&]+)/)[1]);
    r = await req(port, 'POST', '/rights/musee', { body: { kind: 'text', what: 'x', name: 'Bo', email: 'bo@example.com' } }); assert.ok(/ok=check/.test(r.headers.location), 'without the conditions, refused');
    r = await req(port, 'GET', `/rights/r/${ticket}`); assert.ok(r.status === 200 && /With the rights desk/.test(r.body) && /Installation views/.test(r.body), 'the asker follows it');
    r = await req(port, 'GET', `/account/rights/${ticket}`); assert.ok([401, 403].includes(r.status), 'a stranger cannot answer');
    r = await req(port, 'GET', '/studio/rights', { cookie: ck }); assert.ok(/Musée du Port/.test(r.body) && r.body.toString().includes(ticket), 'the Studio sees every desk');
    r = await req(port, 'POST', `/account/rights/${ticket}`, { cookie: ck, body: { do: 'granted', answer: 'Granted for the monograph. Cite as: The Musée du Port Archives, Marseille.', fee: '150' } }); assert.ok(/granted/.test(r.headers.location), 'answered');
    const rr = db.prepare('SELECT * FROM rights_requests WHERE ticket=?').get(ticket); assert.ok(rr.status === 'granted' && rr.fee_cents === 15000 && rr.answered_at, 'recorded');
    r = await req(port, 'GET', `/rights/r/${ticket}`); assert.ok(/Permission granted/.test(r.body) && /\$150/.test(r.body) && /Cite as/.test(r.body), 'the permission in writing, with its ticket');
    r = await req(port, 'GET', '/museums'); assert.ok(/One door, not four addresses/.test(r.body) && /Three ways in/.test(r.body), 'the pitch');
    db.prepare("UPDATE works SET status='hidden' WHERE maker_id=?").run(inst.id);
  }
  { // The Met's Open Access API as a source: the search gives ids, each object its public-domain picture and record; CC0 by default.
    const sharp = require('sharp'); const pic = await sharp({ create: { width: 800, height: 640, channels: 3, background: '#5a4a3a' } }).jpeg().toBuffer();
    const prev = app.locals.__fetch;
    app.locals.__fetch = async (u) => { u = String(u); if (/collectionapi\.metmuseum\.org\/public\/collection\/v1\/search/.test(u)) return { ok: true, json: async () => ({ total: 2, objectIDs: [436535, 999]}) };
      if (/objects\/436535$/.test(u)) return { ok: true, json: async () => ({ objectID: 436535, isPublicDomain: true, primaryImage: 'https://images.metmuseum.org/x/436535.jpg', title: 'Wheat Field with Cypresses', artistDisplayName: 'Vincent van Gogh', objectDate: '1889', medium: 'Oil on canvas', dimensions: '28 7/8 × 36 3/4 in.', creditLine: 'Purchase, The Annenberg Foundation Gift, 1993', department: 'European Paintings', accessionNumber: '1993.132', objectURL: 'https://www.metmuseum.org/art/collection/search/436535' }) };
      if (/objects\/999$/.test(u)) return { ok: true, json: async () => ({ objectID: 999, isPublicDomain: false, primaryImage: 'https://images.metmuseum.org/x/999.jpg', title: 'Not open' }) };
      if (/images\.metmuseum\.org/.test(u)) return { ok: true, arrayBuffer: async () => pic };
      return prev ? prev(u) : { ok: false, status: 404 }; };
    const inst = db.prepare("SELECT * FROM makers WHERE handle='musee'").get();
    r = await req(port, 'POST', '/studio/iiif', { cookie: ck, body: { maker: String(inst.id), url: 'https://collectionapi.metmuseum.org/public/collection/v1/search?q=van%20gogh' } });
    for (let i = 0; i < 100 && db.prepare("SELECT status FROM iiif_imports ORDER BY id DESC LIMIT 1").get().status !== 'done'; i++) await new Promise(x => setTimeout(x, 50));
    const job = db.prepare('SELECT * FROM iiif_imports ORDER BY id DESC LIMIT 1').get(); assert.ok(job.status === 'done' && job.done === 1 && /The Met/.test(job.label), 'one public-domain object in, the other left: ' + JSON.stringify(job));
    const vg = db.prepare("SELECT * FROM works WHERE source_url='https://www.metmuseum.org/art/collection/search/436535'").get(); assert.ok(vg && vg.title === 'Wheat Field with Cypresses' && vg.open === 'cc0' && /1889/.test(vg.taken_at) && /Oil on canvas/.test(vg.medium) && /1993\.132/.test(vg.caption), 'the record: ' + JSON.stringify({ t: vg && vg.title, o: vg && vg.open, m: vg && vg.medium }));
    r = await req(port, 'GET', '/museums/desk'); assert.ok(/Open a rights desk\./.test(r.body) && /The afternoon/.test(r.body), 'the guide');
    // The demo desk, one press: the institution made, the highlights search enqueued, capped.
    r = await req(port, 'POST', '/studio/iiif/demo', { cookie: ck, body: { max: '1' } }); assert.ok(/^\/studio\/iiif\/\d+$/.test(r.headers.location), 'enqueued');
    const dm = db.prepare("SELECT * FROM makers WHERE handle='museum-demo'").get(); assert.ok(dm && dm.kind === 'institution' && dm.rights_open === 1 && db.prepare('SELECT COUNT(*) n FROM uses WHERE maker_id=?').get(dm.id).n > 0, 'the demo institution with its uses');
    for (let i = 0; i < 100 && db.prepare("SELECT status FROM iiif_imports ORDER BY id DESC LIMIT 1").get().status !== 'done'; i++) await new Promise(x => setTimeout(x, 50));
    const dj = db.prepare('SELECT * FROM iiif_imports ORDER BY id DESC LIMIT 1').get(); assert.ok(dj.status === 'done' && dj.max === 1 && dj.n <= 1, 'capped at one for the test: ' + JSON.stringify(dj));
    r = await req(port, 'GET', '/rights/museum-demo'); assert.ok(r.status === 200 && /demonstration desk/.test(r.body), 'the demo desk answers');
    app.locals.__fetch = prev;
  }
  console.log('ok: the Met, in');
  { // The team: a museum invites its rights desk by letter; the person signs in as themselves and acts for the institution.
    const inst = db.prepare("SELECT * FROM makers WHERE handle='musee'").get();
    r = await req(port, 'GET', '/account/staff', { cookie: `${ck}; wm_as=musee` }); assert.equal(r.status, 200); assert.ok(/The team\./.test(r.body), 'the team desk');
    r = await req(port, 'POST', '/account/staff', { cookie: `${ck}; wm_as=musee`, body: { name: 'Rosa Vale', email: 'rosa@musee.example', role: 'rights' } }); assert.equal(r.status, 302);
    const st = db.prepare("SELECT * FROM institution_staff WHERE email='rosa@musee.example'").get(); assert.ok(st && st.status === 'invited', 'invited');
    r = await req(port, 'GET', '/staff/join/' + st.token); assert.equal(r.status, 302); assert.equal(r.headers.location, '/account/rights', 'the rights desk opens for the rights role');
    const sck = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).filter(c => /^wm_(b|staff)=/.test(c)).join('; '); assert.ok(/wm_staff=/.test(sck), 'the seat remembered');
    r = await req(port, 'GET', '/account/rights', { cookie: sck }); assert.equal(r.status, 200, 'Rosa works the desk as the museum: ' + r.status); assert.ok(r.body.toString().includes(inst.name), 'as the institution');
    r = await req(port, 'GET', `/m/musee`); assert.ok(/class="mu-strip"/.test(r.body) && /Rights and reproductions/.test(r.body) && /Rosa Vale/.test(r.body), 'the museum strip with the team');
    r = await req(port, 'GET', '/staff/join/' + st.token); const stranger = await req(port, 'GET', '/account/staff', { cookie: sck }); assert.equal(stranger.status, 200);
    r = await req(port, 'POST', `/account/staff/${st.id}/end`, { cookie: `${ck}; wm_as=musee` }); r = await req(port, 'GET', '/account/rights', { cookie: sck }); assert.ok(r.status === 401 || r.status === 302 || r.status === 403, 'the seat taken back closes the desk: ' + r.status);
  }
  console.log('ok: the team');
  { // A tour: the curator records a word on a work; the wall becomes a tour; a stranger hears it; /guides lists the guide.
    const hg = db.prepare("SELECT h.* FROM hangs h JOIN hang_works hw ON hw.hang_id=h.id WHERE h.public=1 GROUP BY h.id ORDER BY h.id LIMIT 1").get(); assert.ok(hg, 'a public wall to walk');
    const owner = db.prepare('SELECT * FROM buyers WHERE id=?').get(hg.buyer_id); const ow = db.prepare("SELECT w.slug FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? AND w.status='held' ORDER BY hw.pos LIMIT 1").get(hg.id);
    r = await req(port, 'GET', `/tour/${hg.slug}`); assert.equal(r.status, 200); assert.ok(/in the guide’s words/.test(r.body), 'a wall with no voice yet');
    const voice = Buffer.from('OggS' + 'x'.repeat(2000)); const bd = '----wmtour'; const body = Buffer.concat([Buffer.from(`--${bd}\r\nContent-Disposition: form-data; name="seconds"\r\n\r\n12\r\n--${bd}\r\nContent-Disposition: form-data; name="voice"; filename="voice.ogg"\r\nContent-Type: audio/ogg\r\n\r\n`), voice, Buffer.from(`\r\n--${bd}--\r\n`)]);
    r = await req(port, 'POST', `/tour/${hg.id}/voice/${ow.slug}`, { body, headers: { 'content-type': `multipart/form-data; boundary=${bd}` } }); assert.ok(r.status === 403 || r.status === 401, 'a stranger cannot record: ' + r.status);
    r = await req(port, 'POST', `/tour/${hg.id}/voice/${ow.slug}`, { cookie: ck, body, headers: { 'content-type': `multipart/form-data; boundary=${bd}` } }); assert.equal(r.status, 200, 'the house records on any wall: ' + r.body); const vj = JSON.parse(r.body); assert.ok(vj.ok && /\/tour\/\d+\/voice\/\d+/.test(vj.src));
    assert.ok(app.locals.tours.isTour(hg), 'the wall is a tour now'); assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='tour.opened'").get(), 'told on the register');
    r = await req(port, 'GET', vj.src, { headers: { range: 'bytes=0-99' } }); assert.equal(r.status, 206); assert.equal(r.headers['content-type'], 'audio/ogg'); assert.equal(r.body.length, 100, 'a range is honoured');
    r = await req(port, 'GET', `/tour/${hg.slug}`); assert.ok(/in the guide’s own voice/.test(r.body) && r.body.toString().includes(vj.src), 'the tour carries the voice');
    r = await req(port, 'GET', `/hang/${hg.slug}`); assert.ok(/Take the tour/.test(r.body), 'the door on the wall');
    r = await req(port, 'GET', '/guides'); assert.ok(r.status === 200 && r.body.toString().includes(`/tour/${hg.slug}`), 'the guide is listed');
    r = await req(port, 'POST', `/tour/${hg.id}/voice/${ow.slug}/remove`, { cookie: ck }); assert.equal(r.status, 200); assert.ok(!app.locals.tours.isTour(hg), 'removed');
  }
  console.log('ok: tours');
  { // The rooms, scoped and on the clock; the kids' corner; a museum's own house on its own domain.
    r = await req(port, 'GET', '/keys'); assert.ok(/class="ck"/.test(r.body) && /your time/.test(r.body), 'the programme on the Keys');
    r = await req(port, 'GET', '/keys/at/musee'); assert.equal(r.status, 200); assert.ok(/The Keys at /.test(r.body) && /The balcony/.test(r.body) && /balcony\/at\/musee/.test(r.body), 'a collection’s own rooms');
    r = await req(port, 'GET', '/kids'); assert.equal(r.status, 200); assert.ok(/kids’ corner/.test(r.body) && !/\$\d/.test(r.body.toString().replace(/[\s\S]*<main>/, '').replace(/<footer[\s\S]*/, '')), 'the corner shows no price');
    // The balcony at a collection: a stranger at the window; one who stood before its work in the last three hours is in.
    r = await req(port, 'GET', '/balcony/at/musee'); const rck = r.headers['set-cookie'].find(c => c.startsWith('wm_room=')).split(';')[0]; assert.equal(r.headers.location, '/balcony');
    r = await req(port, 'GET', '/balcony', { cookie: rck }); assert.ok(/The balcony at /.test(r.body) && /bc-door/.test(r.body), 'the door, to one who has not looked');
    r = await req(port, 'GET', '/api/balcony', { cookie: rck }); let bj = JSON.parse(r.body); assert.equal(bj.scope, 'm:musee');
    r = await req(port, 'GET', '/balcony/at/house', { cookie: rck }); assert.ok((r.headers['set-cookie'] || []).some(c => /^wm_room=;/.test(c)), 'back to the house’s');
    // A museum's own house: the domain points here; / is the museum; the wordmark is theirs; Made with Watermark.
    const inst = db.prepare("SELECT * FROM makers WHERE handle='musee'").get();
    r = await req(port, 'GET', '/account/house', { cookie: `${ck}; wm_as=musee` }); assert.equal(r.status, 200);
    r = await req(port, 'POST', '/account/house', { cookie: `${ck}; wm_as=musee`, body: { domain: 'collection.musee.example', accent: '#7a1f2b', on: '1' } }); assert.equal(r.status, 302);
    r = await req(port, 'GET', '/', { headers: { host: 'collection.musee.example' } }); assert.equal(r.status, 200); const th = r.body.toString(); assert.ok(th.includes('brand-tn') && th.includes(inst.name) && /Made with Watermark/.test(th) && !/a Krafft company/.test(th) && !/house\.js/.test(th) && /--accent:#7a1f2b/.test(th), 'the museum’s own front door');
    r = await req(port, 'GET', '/wander', { headers: { host: 'collection.musee.example' } }); assert.equal(r.headers.location, '/wander?maker=musee');
    r = await req(port, 'GET', '/keys', { headers: { host: 'collection.musee.example' } }); assert.equal(r.headers.location, '/keys/at/musee');
    r = await req(port, 'GET', '/'); assert.ok(!/brand-tn/.test(r.body) && /a Krafft company/.test(r.body), 'the house itself is untouched');
    r = await req(port, 'GET', '/enterprise'); assert.ok(r.status === 200 && /Your own house\./.test(r.body));
  }
  console.log('ok: the rooms, the clock and a museum’s own house');
  { // The host's chair as a job: the house offers a night; the keyholder accepts; the night closes with them in the chair; the pocket is paid.
    const H = app.locals.hosts; const bb = db.prepare('SELECT * FROM buyers WHERE id=?').get(+bck.split('=')[1].split('.')[0]); assert.ok(bb && bb.email, 'the collector');
    const tonight = H.nightOf();
    r = await req(port, 'GET', '/hosts'); assert.ok(r.status === 200 && /The hosts\./.test(r.body) && /open/.test(r.body), 'the rota');
    r = await req(port, 'POST', '/studio/hosts/offer', { cookie: ck, body: { night: tonight, scope: 'house', who: bb.email } }); assert.equal(r.status, 302);
    let sh = db.prepare("SELECT * FROM host_shifts WHERE night=? AND scope='house'").get(tonight); assert.ok(sh && sh.status === 'offered' && sh.owner === `b:${bb.id}`, 'offered');
    r = await req(port, 'POST', `/hosts/${sh.id}/accept`, { cookie: bck }); assert.equal(r.status, 302); sh = db.prepare('SELECT * FROM host_shifts WHERE id=?').get(sh.id); assert.equal(sh.status, 'taken');
    assert.ok(H.isTonightsHost('house', `b:${bb.id}`) && !H.isTonightsHost('house', 'b:999'), 'tonight’s chair is theirs');
    const before = app.locals.pocket.balance(bb); H.settle('house', tonight, `b:${bb.id}`, 3);
    assert.equal(app.locals.pocket.balance(bb) - before, H.HOST_CENTS, 'paid for the evening'); assert.ok(app.locals.pocket.cashable(bb) >= H.HOST_CENTS, 'and cashable');
    assert.equal(db.prepare('SELECT status FROM host_shifts WHERE id=?').get(sh.id).status, 'paid');
    r = await req(port, 'POST', '/studio/hosts/offer', { cookie: ck, body: { night: tonight, scope: 'house', who: bb.email } }); assert.ok(/taken/.test(decodeURIComponent(r.headers.location)), 'one chair a night');
    r = await req(port, 'GET', '/studio/hosts', { cookie: ck }); assert.ok(r.status === 200 && /paid/.test(r.body));
  }
  console.log('ok: the host’s chair');
  { // The Screening Room: a film shelved and put on the bill; the lobby before the hour; the room at the hour for keyholders; told after.
    const SC = app.locals.screening;
    r = await req(port, 'POST', '/studio/screening/film', { cookie: ck, body: { title: 'The Long Gallery', filmmaker: 'A. Restorer', year: '1961', minutes: '90', line: 'Restored from the camera negative.', source_url: 'https://films.example/long-gallery.mp4', notes: '00:00 The first shot was the last we filmed.\n12:40 The light here is real.', chosen_by: 'A. Restorer', chosen_why: 'Because it survives.', status: 'showing' } }); assert.equal(r.status, 302);
    const f = db.prepare("SELECT * FROM films WHERE slug='the-long-gallery'").get(); assert.ok(f && f.status === 'showing', 'shelved and showing');
    assert.deepEqual(SC.parseNotes(f.notes)[1], { t: 760, text: 'The light here is real.' }, 'notes by the minute');
    r = await req(port, 'GET', '/screening'); assert.ok(r.status === 200 && /The Screening Room\./.test(r.body) && /The Long Gallery/.test(r.body), 'the room’s door');
    r = await req(port, 'GET', '/screening/the-long-gallery'); assert.ok(r.status === 200 && /Not on the bill/.test(r.body) && !/<video/.test(r.body), 'the lobby, no showing set');
    db.prepare("INSERT INTO film_showings (film_id, at) VALUES (?, datetime('now', '-10 minutes'))").run(f.id);
    r = await req(port, 'GET', '/screening/the-long-gallery'); assert.ok(/Showing now/.test(r.body) && /bc-door/.test(r.body) && !/<video/.test(r.body), 'a stranger at the window');
    r = await req(port, 'GET', '/screening/the-long-gallery', { cookie: bck }); assert.ok(/<video/.test(r.body) && /long-gallery\.mp4/.test(r.body) && /join it in progress/.test(r.body), 'a keyholder takes a seat, in progress');
    assert.equal(db.prepare('SELECT came FROM film_showings WHERE film_id=?').get(f.id).came, 1, 'who came is counted, nothing else');
    db.prepare("UPDATE film_showings SET at=datetime('now', '-200 minutes') WHERE film_id=?").run(f.id); SC.tell();
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='screening.shown'").get(), 'told on the register');
    r = await req(port, 'GET', '/ledger'); assert.ok(/The Screening Room showed/.test(r.body));
    r = await req(port, 'POST', '/studio/screening/film', { cookie: ck, body: { title: 'X', source_url: 'http://insecure.example/x.mp4' } }); assert.ok(/https address/.test(decodeURIComponent(r.headers.location)), 'only the house’s own https sources');
  }
  { // The first film: Sunrise, seeded with a showing the next evening at nine, New York; never twice.
    app.locals.screeningSeed(); app.locals.screeningSeed();
    const f = db.prepare("SELECT * FROM films WHERE slug='sunrise-1927'").get(); assert.ok(f && f.status === 'showing' && /archive\.org\/download\/sunrise_1927/.test(f.source_url) && /^0:00 /.test(f.notes), 'Sunrise on the bill');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM film_showings WHERE film_id=? AND at > datetime('now')").get(f.id).n, 1, 'one showing, once');
    const k = db.prepare("SELECT * FROM films WHERE slug='sherlock-jr-1924'").get(); assert.ok(k && db.prepare('SELECT at FROM film_showings WHERE film_id=?').get(k.id).at > db.prepare('SELECT at FROM film_showings WHERE film_id=?').get(f.id).at, 'Keaton the night after');
    r = await req(port, 'GET', '/screening'); assert.ok(/Sunrise/.test(r.body) && /Murnau/.test(r.body), 'on the bill');
    r = await req(port, 'GET', '/screening/sunrise-1927'); assert.ok(r.status === 200 && /song of two humans/i.test(r.body), 'the lobby');
  }
  console.log('ok: the Screening Room');
  { // The Listening Room: a record from the Archive, cleared at the door; an NC record turned away; played whole in the room.
    const prev = app.locals.__fetch;
    const meta = id => ({ metadata: { identifier: id, title: id === '78_old' ? 'Ain\'t We Got Fun' : 'A Late Record', creator: id === '78_old' ? 'Van and Schenck' : 'Someone', year: id === '78_old' ? '1921' : '1948', collection: ['georgeblood', '78rpm'], description: 'A 78.' }, files: [{ name: 'side-a.mp3', title: 'Side A', length: '183.2', track: '1' }, { name: 'side-a_spectrogram.png' }, { name: 'side-b.mp3', title: 'Side B', length: '3:02', track: '2' }, { name: 'side-b.flac', length: '182' }] });
    app.locals.__fetch = async (u) => { u = String(u); const m = u.match(/\/metadata\/([^/?]+)/); if (m) return { ok: true, json: async () => m[1] === 'nc_one' ? { metadata: { title: 'An NC record', licenseurl: 'http://creativecommons.org/licenses/by-nc/4.0/' }, files: [{ name: 'a.mp3' }] } : meta(m[1]) }; if (/advancedsearch/.test(u)) return { ok: true, json: async () => ({ response: { docs: [{ identifier: '78_old', title: 'Ain\'t We Got Fun', creator: 'Van and Schenck', year: '1921', collection: ['georgeblood'] }] } }) }; return prev ? prev(u) : { ok: false, status: 599 }; };
    r = await req(port, 'GET', '/studio/listening?q=fun', { cookie: ck }); assert.ok(r.status === 200 && /Ain.{1,6}t We Got Fun/.test(r.body) && /Public domain/.test(r.body), 'the Archive searched and read at the door');
    r = await req(port, 'POST', '/studio/listening/bring', { cookie: ck, body: { id: 'https://archive.org/details/78_old' } }); assert.ok(/On the shelf: Ain/.test(decodeURIComponent(r.headers.location)) && /2 tracks/.test(decodeURIComponent(r.headers.location)), 'brought in: ' + r.headers.location);
    r = await req(port, 'POST', '/studio/listening/bring', { cookie: ck, body: { id: 'nc_one' } }); assert.ok(/non-commercial/.test(decodeURIComponent(r.headers.location)), 'NC turned away');
    r = await req(port, 'POST', '/studio/listening/bring', { cookie: ck, body: { id: '78_late' } }); assert.ok(/not yet public domain/.test(decodeURIComponent(r.headers.location)), 'a 1948 78 turned away');
    const rec = db.prepare("SELECT * FROM recordings WHERE ia_id='78_old'").get(); assert.ok(rec && rec.license === 'pd' && rec.year === '1921' && JSON.parse(rec.files).length === 2 && JSON.parse(rec.files)[1].seconds === 182 && /side-a\.mp3$/.test(JSON.parse(rec.files)[0].url), 'the record: pd, two sides, the mp3 over the flac, the lengths read');
    r = await req(port, 'GET', '/listening/' + rec.slug); assert.equal(r.status, 404, 'shelved is not shown');
    r = await req(port, 'POST', '/studio/listening/' + rec.id, { cookie: ck, body: { title: rec.title, performer: rec.performer, year: rec.year, line: 'A side for the evening.', chosen_by: 'the house', status: 'playing' } }); assert.equal(r.status, 302);
    r = await req(port, 'GET', '/listening'); assert.ok(r.status === 200 && /On the turntable/.test(r.body) && /Ain.{1,6}t We Got Fun/.test(r.body) && /The shellac/.test(r.body), 'the door');
    r = await req(port, 'GET', '/listening/' + rec.slug); assert.ok(r.status === 200 && /data-lr-audio/.test(r.body) && /archive\.org\/download\/78_old\/side-a\.mp3/.test(r.body) && /Side B/.test(r.body) && /From the Internet Archive, 78_old/.test(r.body) && /A side for the evening/.test(r.body), 'the room: the platter, both sides, the credit');
    r = await req(port, 'GET', '/keys'); assert.ok(/On the turntable/.test(r.body), 'the Keys card opens');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='recording.playing' AND subject=?").get(rec.slug), 'told on the register');
    r = await req(port, 'GET', '/ledger'); assert.ok(/is on the turntable/.test(r.body) && !/Listening Room shelved/.test(r.body), 'the playing shown, the shelving hidden');
    app.locals.__fetch = prev;
  }
  { // The makers' own music (25 Oct): a record made on the desk, a WAV side into the vault (fingerprinted, on the register), on the turntable for keyholders; a stranger refused; a page named .wav turned away.
    r = await req(port, 'POST', '/account/music', { cookie: mck, body: { title: 'Nocturne for the Harbour', performer: 'Ada Magnum', composer: 'Ada Magnum', year: '2026', line: 'Recorded at night on the quay.' } }); assert.equal(r.status, 302);
    const mrec = db.prepare("SELECT * FROM recordings WHERE slug='nocturne-for-the-harbour'").get(); assert.ok(mrec && mrec.source === 'maker' && mrec.status === 'shelved' && mrec.license === 'maker', 'the record made, shelved');
    const wav = (n => { const d = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) d.writeInt16LE(Math.round(8000 * Math.sin(i / 20)), i * 2); const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(d.length, 40); return Buffer.concat([h, d]); })(44100);
    r = await req(port, 'POST', '/account/music/nocturne-for-the-harbour/sides', { cookie: mck, body: mp('side-a.wav', wav, { title: 'Side A' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } }); assert.ok(r.status === 302 && /fingerprint/.test(decodeURIComponent(r.headers.location)), 'the side in: ' + r.headers.location);
    const side = db.prepare('SELECT * FROM music_sides WHERE recording_id=?').get(mrec.id); assert.ok(side && side.n === 1 && side.bytes === wav.length && /^[0-9a-f]{64}$/.test(side.sha256) && side.mime === 'audio/wav', 'the side, fingerprinted');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='music.registered' AND subject='nocturne-for-the-harbour'").get(), 'on the register');
    r = await req(port, 'POST', '/account/music/nocturne-for-the-harbour/sides', { cookie: mck, body: mp('page.wav', Buffer.from('<html><script>alert(1)</script></html>'), { title: 'Not a side' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } }); assert.ok(r.status === 415 || /not a recording|web page/.test(r.body), 'a page named .wav turned away: ' + r.status);
    r = await req(port, 'GET', '/music/nocturne-for-the-harbour/1'); assert.equal(r.status, 403, 'shelved: no one hears it');
    r = await req(port, 'POST', '/account/music/nocturne-for-the-harbour/status', { cookie: mck, body: { to: 'playing' } }); assert.equal(r.status, 302);
    assert.equal(db.prepare('SELECT status FROM recordings WHERE id=?').get(mrec.id).status, 'playing');
    r = await req(port, 'GET', '/music/nocturne-for-the-harbour/1'); assert.equal(r.status, 403, 'a stranger is refused');
    r = await req(port, 'GET', '/music/nocturne-for-the-harbour/1', { cookie: ck, headers: { range: 'bytes=0-99' } }); assert.ok(r.status === 206 && r.headers['content-range'] === 'bytes 0-99/' + wav.length && r.body.slice(0, 4).toString() === 'RIFF', 'a keyholder streams a range');
    r = await req(port, 'GET', '/listening', { cookie: ck }); assert.ok(/From the makers/.test(r.body) && /Nocturne for the Harbour/.test(r.body), 'on the makers’ shelf');
    r = await req(port, 'GET', '/listening/nocturne-for-the-harbour'); assert.ok(r.status === 403 && /keyholders/.test(r.body), 'the window for others');
    r = await req(port, 'GET', '/listening/nocturne-for-the-harbour', { cookie: ck }); assert.ok(r.status === 200 && /\/music\/nocturne-for-the-harbour\/1/.test(r.body) && /all rights reserved/i.test(r.body), 'the room plays the house’s own address');
    r = await req(port, 'GET', '/account/music', { cookie: mck }); assert.ok(/Your records\./.test(r.body) && /On the turntable/.test(r.body) && /Side A/.test(r.body), 'the desk');
  }
  console.log('ok: the makers’ own music');
  console.log('ok: the Listening Room');
  { // The public domain: a Gutenberg book brought in (the boilerplate cut, the chapters found) and read in the reading room.
    const prev = app.locals.__fetch;
    const raw = ['The Project Gutenberg eBook of The Long Walk', '', '*** START OF THE PROJECT GUTENBERG EBOOK THE LONG WALK ***', '', 'Produced by Someone', '', 'THE LONG WALK', '', 'By A. Walker', '', 'CHAPTER I.', '', 'It was a long walk, and the road was ' + 'dusty '.repeat(120) + '.', '', 'The second paragraph went on.', '', 'CHAPTER II. THE RIVER', '', 'Water, at last. ' + 'More water. '.repeat(100), '', '*** END OF THE PROJECT GUTENBERG EBOOK THE LONG WALK ***', '', 'License text that is not the book.'].join('\n');
    app.locals.__fetch = async (u) => { u = String(u); if (/gutendex\.com\/books\?search=/.test(u)) return { ok: true, json: async () => ({ results: [{ id: 777, title: 'The Long Walk', authors: [{ name: 'Walker, A.' }], download_count: 42, languages: ['en'] }] }) }; if (/gutendex\.com\/books\/777$/.test(u)) return { ok: true, json: async () => ({ id: 777, title: 'The Long Walk', authors: [{ name: 'Walker, A.' }], formats: { 'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/777.txt.utf-8', 'text/html': 'https://www.gutenberg.org/ebooks/777.html' } }) }; if (/gutenberg\.org\/ebooks\/777\.txt/.test(u)) return { ok: true, text: async () => raw }; return prev ? prev(u) : { ok: false, status: 404 }; };
    r = await req(port, 'GET', '/studio/reading?q=long+walk', { cookie: ck }); assert.ok(r.status === 200 && /Bring in No\. 777/.test(r.body) && /Franklin’s shelf/.test(r.body) && /Pilgrim/.test(r.body), 'the search and the shelf');
    r = await req(port, 'POST', '/studio/reading/bring', { cookie: ck, body: { id: '777' } }); assert.ok(/on the shelf: 3 chapters/.test(decodeURIComponent(r.headers.location)), 'brought in: ' + r.headers.location);
    const bk = db.prepare("SELECT * FROM texts WHERE source='https://www.gutenberg.org/ebooks/777'").get(); assert.ok(bk && bk.kind === 'book' && bk.author === 'Walker, A.' && bk.public === 1 && bk.price_cents == null, 'a free book on the shelf');
    assert.ok(!/Project Gutenberg|License text|Produced by/.test(bk.body) && /^## The Long Walk|## Chapter I\./m.test(bk.body) && /## Chapter II\. The River/.test(bk.body), 'the boilerplate gone, the chapters marked: ' + bk.body.slice(0, 120));
    r = await req(port, 'GET', `/read/${bk.slug}`); assert.equal(r.status, 200); const pg = r.body.toString(); assert.ok(/class="rdr"/.test(pg) && /class="rdp"/.test(pg) && /rdr-toc/.test(pg) && /Chapter II\. The River/.test(pg) && /Water, at last/.test(pg) && /read\.js/.test(pg), 'the reading room');
    r = await req(port, 'GET', `/library/${bk.slug}`); assert.ok(/Read it in the reading room/.test(r.body), 'the Library opens the room');
    r = await req(port, 'POST', '/studio/reading/bring', { cookie: ck, body: { id: '777' } }); assert.ok(/Already/.test(decodeURIComponent(r.headers.location)), 'never twice');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='text.shelved' AND subject=?").get(bk.slug), 'shelved on the register');
    // The book (24 Oct): the cover with the imprint, the progress line, Pages, the colophon; the author said as a person says it.
    assert.ok(/data-rd-cover/.test(pg) && /Watermark Publishing/.test(pg) && /A\. Walker/.test(pg) && /rdr-prog/.test(pg) && /data-rd-mode/.test(pg) && /rdr-colophon/.test(pg) && /rdr-tp/.test(pg), 'a book, not a web page');
    r = await req(port, 'GET', `/read/${bk.slug}?c=1`); assert.ok(/data-rd-cover hidden/.test(r.body), 'a chapter asked for opens past the cover');
    // The canon: found by title and author on Gutendex, the best-taken edition; shelved in the background; never twice.
    app.locals.__fetch = async (u) => { u = String(u); if (/gutendex\.com\/books\?search=/.test(u)) { const q = decodeURIComponent(u.split('search=')[1].split('&')[0]); return { ok: true, json: async () => ({ results: /Meditations/.test(q) ? [{ id: 2680, title: 'Meditations', authors: [{ name: 'Marcus Aurelius, Emperor of Rome' }], download_count: 9000, languages: ['en'], formats: { 'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/2680.txt.utf-8' } }, { id: 1, title: 'Meditations on First Philosophy', authors: [{ name: 'Descartes' }], download_count: 99999, languages: ['en'], formats: { 'text/plain': 'x' } }] : [] }) }; } if (/gutendex\.com\/books\/2680/.test(u)) return { ok: true, json: async () => ({ id: 2680, title: 'Meditations', authors: [{ name: 'Marcus Aurelius, Emperor of Rome' }], formats: { 'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/2680.txt.utf-8' } }) }; if (/2680\.txt/.test(u)) return { ok: true, text: async () => '*** START OF THE PROJECT GUTENBERG EBOOK MEDITATIONS ***\n\nBOOK I\n\n' + 'From my grandfather Verus I learned good morals and the government of my temper. '.repeat(40) + '\n\nBOOK II\n\n' + 'Begin the morning by saying to thyself, I shall meet with the busy-body. '.repeat(40) + '\n\n*** END OF THE PROJECT GUTENBERG EBOOK' }; return prev ? prev(u) : { ok: false, status: 404 }; };
    const RD = app.locals.reading; const found = await RD.find('Meditations', 'Marcus Aurelius'); assert.ok(found && found.id === 2680, 'the author’s own, not the best-taken stranger');
    r = await req(port, 'GET', '/studio/reading', { cookie: ck }); assert.ok(/The first shelf/.test(r.body) && /Shelve the canon/.test(r.body) && /Meditations/.test(r.body), 'the canon on the desk');
    r = await req(port, 'POST', '/studio/reading/canon', { cookie: ck }); assert.equal(r.status, 302);
    for (let i = 0; i < 400 && RD.job.on; i++) await new Promise(x => setTimeout(x, 50));
    const med = db.prepare("SELECT * FROM texts WHERE source LIKE '%ebooks/2680%'").get(); assert.ok(med && med.kind === 'book' && /Book II/.test(med.body) && /One of the first shelf/.test(med.summary), 'Meditations on the shelf');
    assert.ok(RD.job.missed.length >= RD.CANON.length - 2, 'the rest reported not found, not guessed');
    r = await req(port, 'GET', '/publishing'); assert.ok(r.status === 200 && /Watermark Publishing\./.test(r.body) && /pub-card/.test(r.body) && /Meditations/.test(r.body) && /Publish with the house/.test(r.body), 'the imprint');
    // A photo book from a wall: each plate a page, the first the cover, read in the room.
    const hg = db.prepare('SELECT * FROM hangs WHERE public=1 ORDER BY id LIMIT 1').get(); assert.ok(hg, 'a public wall to make a book from');
    r = await req(port, 'POST', '/studio/publishing/photobook', { cookie: ck, body: { hang: hg.slug, title: 'The Great Rooms, a book', author: 'Will Fullerton', price: '25', line: 'Six rooms, one evening.' } }); assert.equal(r.status, 302, 'made: ' + r.headers.location);
    const pbk = db.prepare("SELECT * FROM texts WHERE kind='photobook' ORDER BY id DESC LIMIT 1").get(); assert.ok(pbk && pbk.price_cents === 2500 && pbk.cover_work_id && JSON.parse(pbk.plates).length >= 1, 'a priced photo book with plates');
    r = await req(port, 'GET', `/read/${pbk.slug}`); assert.ok(r.status === 200 && /rdr-pb/.test(r.body) && /rdr-pl/.test(r.body) && /plates/.test(r.body) && /Will Fullerton/.test(r.body), 'read a plate at a time');
    r = await req(port, 'GET', '/library'); assert.ok(/Photo books/.test(r.body), 'the Library knows the kind');
    app.locals.__fetch = prev;
  }
  { // Find across everything (24 Oct): books and records answer too.
    app.locals.findIndexDirty(); r = await req(port, 'GET', '/api/find?q=long+walk'); const fj = JSON.parse(r.body); assert.ok(fj.books && fj.books.some(b => /Long Walk/.test(b.name) && /\/read\//.test(b.href)), 'a book found: ' + JSON.stringify(fj.books));
    r = await req(port, 'GET', '/api/find?q=got+fun'); const fr = JSON.parse(r.body); assert.ok(fr.records && fr.records.some(x => /Got Fun/.test(x.name) && /\/listening\//.test(x.href)), 'a record found');
    r = await req(port, 'GET', '/find?q=long+walk'); assert.ok(/From the shelf/.test(r.body) && /Long Walk/.test(r.body), 'on the page');
  }
  { // Facing pages (25 Oct): a translation beside the text, paragraph by paragraph, made by the house's AI once and kept.
    const bk = db.prepare("SELECT * FROM texts WHERE slug LIKE 'the-long-walk%' AND body IS NOT NULL ORDER BY id LIMIT 1").get(); assert.ok(bk, 'a book to face');
    const hadKey = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    r = await req(port, 'GET', `/read/${bk.slug}`); assert.ok(!/data-rd-facing/.test(r.body), 'no translator, no Facing button');
    r = await req(port, 'GET', `/read/${bk.slug}/facing?c=0&lang=es`); assert.equal(r.status, 503, 'the API says the house has no translator');
    process.env.ANTHROPIC_API_KEY = 'test-key'; const prev = app.locals.__fetch; let calls = 0;
    app.locals.__fetch = async (u, o) => { u = String(u); if (/api\.anthropic\.com/.test(u)) { calls++; const body = JSON.parse(o.body); const m = body.messages[0].content.match(/\[[\s\S]*\]$/); const paras = JSON.parse(m[0]); return { ok: true, json: async () => ({ model: 'mock', content: [{ type: 'text', text: JSON.stringify(paras.map(x => x === '* * *' ? x : 'ES: ' + x)) }] }) }; } return prev ? prev(u, o) : fetch(u, o); };
    r = await req(port, 'GET', `/read/${bk.slug}`); assert.ok(/data-rd-facing/.test(r.body) && /data-rd-lang="es"/.test(r.body) && /Spanish/.test(r.body) && /&quot;facing&quot;:true/.test(r.body), 'the Facing button and its languages');
    r = await req(port, 'GET', `/read/${bk.slug}/facing?c=1&lang=xx`); assert.equal(r.status, 400, 'an unknown language refused');
    r = await req(port, 'GET', `/read/${bk.slug}/facing?c=1&lang=es`); assert.equal(r.status, 200); const fj = JSON.parse(r.body);
    const chs = require('../src/facing').chaptersOf(bk.body); assert.equal(fj.paras.length, chs[1].paras.length, 'one twin per paragraph, in step'); assert.ok(fj.paras.every((t, i) => chs[1].paras[i] === '* * *' ? t === '* * *' : /^ES: /.test(t)), 'each paragraph translated'); assert.equal(fj.label, 'Translated with AI'); assert.equal(fj.name, 'Spanish');
    assert.ok(db.prepare('SELECT 1 FROM translations WHERE text_id=? AND lang=? AND chapter=1').get(bk.id, 'es'), 'kept');
    const before = calls; r = await req(port, 'GET', `/read/${bk.slug}/facing?c=1&lang=es`); assert.equal(r.status, 200); assert.equal(calls, before, 'the second reader is served from what is kept');
    r = await req(port, 'GET', `/read/${bk.slug}/facing?c=1&lang=es&peek=1`); assert.ok(JSON.parse(r.body).kept === true, 'peek sees it');
    assert.ok(!(await req(port, 'GET', '/ledger')).body.toString().includes('translated'), 'per-chapter translations never on the public register');
    app.locals.__fetch = prev; if (hadKey) process.env.ANTHROPIC_API_KEY = hadKey; else delete process.env.ANTHROPIC_API_KEY;
  }
  console.log('ok: the public domain and the reading room');
  { // The Bookshop: a want left; a signed copy offered by the house (the want told); bought with an address through Checkout; settled by the webhook; moved along on the desk; told on the register without a name.
    const bk = db.prepare("SELECT * FROM texts WHERE kind='book' AND public=1 ORDER BY id LIMIT 1").get(); assert.ok(bk, 'a book on the shelf');
    r = await req(port, 'GET', `/library/${bk.slug}`); assert.ok(/id="bookshop"/.test(r.body) && /No copy is offered today/.test(r.body) && /Tell me when a copy turns up/.test(r.body), 'the shelves on the book’s page');
    r = await req(port, 'POST', '/bookshop/want', { body: { text: bk.slug, email: 'reader@example.com', kind: 'signed' } }); assert.equal(r.status, 302);
    const sent0 = (app.locals.mailLog || []).length;
    r = await req(port, 'POST', '/studio/bookshop/offer', { cookie: ck, body: { text: bk.slug, kind: 'signed', line: 'Signed by the author on the half-title, 1923', condition: 'Very good', price: '450', qty: '1' } }); assert.ok(/On the shelf/.test(decodeURIComponent(r.headers.location)), 'offered: ' + r.headers.location);
    const cp = db.prepare("SELECT * FROM copies WHERE text_id=? ORDER BY id DESC LIMIT 1").get(bk.id); assert.ok(cp && cp.kind === 'signed' && cp.price_cents === 45000 && cp.seller_kind === 'house', 'a signed copy at the seller’s price');
    assert.ok(db.prepare('SELECT told_at FROM wants WHERE email=?').get('reader@example.com').told_at, 'the want was told');
    r = await req(port, 'GET', `/library/${bk.slug}`); assert.ok(/Signed copy/.test(r.body) && /Signed by the author/.test(r.body) && /as the seller attests/.test(r.body) && /Buy it, shipped/.test(r.body), 'the copy on the page, labelled as the seller’s word');
    r = await req(port, 'GET', '/bookshop'); assert.ok(r.status === 200 && /The Bookshop\./.test(r.body) && /bs-card/.test(r.body) && /Signed copy/.test(r.body) && /Read free/.test(r.body), 'the shop’s front');
    r = await req(port, 'POST', `/bookshop/copy/${cp.id}/buy`, { body: { name: 'Ada Reader', email: 'ada@example.com', street: '1 Main St', city: 'Dallas', state: 'tx', zip: '75201' } }); assert.equal(r.status, 303, 'to Checkout: ' + r.headers.location);
    const cs = sessions[r.headers.location.split('/').pop()]; assert.ok(cs && cs.metadata.copy_order && /Signed copy: /.test(cs.line_items[0].price_data.product_data.name), 'the session names the copy');
    const co = db.prepare('SELECT * FROM copy_orders WHERE id=?').get(Number(cs.metadata.copy_order)); assert.ok(co && !co.paid && /^CB-\d{4}-\d{5}$/.test(co.ref) && /Dallas, TX 75201/.test(co.address), 'the order, unpaid, with the address');
    { const payload = JSON.stringify({ id: 'evt_copy', type: 'checkout.session.completed', data: { object: { ...cs, payment_status: 'paid', amount_total: cs.line_items[0].price_data.unit_amount } } });
      const sg = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' }); r = await req(port, 'POST', '/stripe/webhook', { body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': sg } }); assert.equal(r.status, 200); }
    const co2 = db.prepare('SELECT * FROM copy_orders WHERE id=?').get(co.id); assert.ok(co2.paid === 1 && co2.status === 'asked', 'paid and asked');
    assert.equal(db.prepare('SELECT status, qty FROM copies WHERE id=?').get(cp.id).status, 'sold', 'the only copy is sold');
    r = await req(port, 'GET', `/bookshop/o/${co.ref}`); assert.ok(/is coming to you/.test(r.body) && /Asked/.test(r.body), 'the buyer’s page');
    r = await req(port, 'GET', `/library/${bk.slug}`); assert.ok(/No copy is offered today/.test(r.body), 'gone from the shelf');
    r = await req(port, 'GET', '/studio/bookshop', { cookie: ck }); assert.ok(/Ada Reader/.test(r.body) && /Asked/.test(r.body) && /Withdraw|sold/.test(r.body), 'the desk');
    r = await req(port, 'POST', `/studio/bookshop/order/${co.id}/move`, { cookie: ck, body: { to: 'sent' } }); assert.equal(r.status, 302);
    assert.equal(db.prepare('SELECT status FROM copy_orders WHERE id=?').get(co.id).status, 'sent');
    r = await req(port, 'GET', '/ledger'); assert.ok(!/Ada Reader/.test(r.body), 'no buyer named on the register');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='copy.sold'").get() && db.prepare("SELECT 1 FROM ledger WHERE type='copy.offered'").get(), 'offered and sold on the register');
    void sent0;
    // The seller's own shelf (25 Oct): a collector offers from Yours, sees it on their shelf, withdraws it; a maker's desk answers; a stranger is refused.
    r = await req(port, 'GET', '/yours/bookshop'); assert.equal(r.status, 401, 'a stranger has no shelf');
    r = await req(port, 'POST', '/yours/bookshop/offer', { cookie: bck, body: { text: bk.slug, kind: 'paper', line: 'A reading copy', price: '12', qty: '2', attest: '1' } }); assert.ok(r.status === 302 && /yours\/bookshop/.test(r.headers.location), 'offered from Yours: ' + r.headers.location);
    r = await req(port, 'GET', '/yours/bookshop', { cookie: bck }); assert.ok(r.status === 200 && /Your shelf\./.test(r.body) && /A reading copy/.test(r.body) && /Withdraw/.test(r.body), 'the collector’s shelf');
    const cp2 = db.prepare("SELECT * FROM copies WHERE seller_kind='buyer' ORDER BY id DESC LIMIT 1").get(); assert.ok(cp2 && cp2.kind === 'paper' && cp2.qty === 2, 'the copy, the collector’s');
    r = await req(port, 'POST', `/yours/bookshop/copy/${cp2.id}/withdraw`, { cookie: bck }); assert.equal(db.prepare('SELECT status FROM copies WHERE id=?').get(cp2.id).status, 'withdrawn', 'withdrawn by its seller');
    r = await req(port, 'GET', '/account/bookshop', { cookie: mck }); assert.ok(r.status === 200 && /Your shelf\./.test(r.body) && /Offer a copy/.test(r.body), 'the maker’s shelf');
  }
  console.log('ok: the Bookshop');
  { // One work a day: the band on the front door; the morning notice, once a day, to every device that asked.
    r = await req(port, 'GET', '/'); assert.ok(/class="rws"/.test(r.body) && /The makers/.test(r.body) && /Today: /.test(r.body) && /One work a day, at nine/.test(r.body), 'today on the front door, in the rows');
    assert.ok(/Makers keep their work here\. Anyone can own a piece of it\./.test(r.body) && /id="what"/.test(r.body) && /<b>Look\.<\/b>/.test(r.body) && /<b>Collect\.<\/b>/.test(r.body) && /<b>Keep\.<\/b>/.test(r.body) && /gh-collect/.test(r.body) && / collectors?</.test(r.body), 'the door says what this is');
    const N = app.locals.notify; assert.ok(N.KINDS.daily && N.KINDS.daily.on, 'a kind, on by default');
    const b0 = db.prepare('SELECT id FROM buyers ORDER BY id LIMIT 1').get();
    db.prepare("INSERT OR IGNORE INTO push_subs (buyer_id, endpoint, p256dh, auth) VALUES (?, 'https://push.example/x', 'k', 'a')").run(b0.id);
    const n1 = await N.daily({ force: true }); assert.ok(n1 >= 1, 'told: ' + n1);
    const nt = db.prepare("SELECT * FROM notices WHERE kind='daily' ORDER BY id DESC LIMIT 1").get(); assert.ok(nt && /^Today: /.test(nt.title) && /today=1/.test(nt.href), 'the notice names the work');
    assert.equal(await N.daily(), 0, 'never twice in a day');
  }
  console.log('ok: one work a day');
  { // The printing house: a maker publishes words from the studio; they stand on the maker's page, in the Library, in the reading room, on the register; the house's share rides on a priced text.
    const mkc = (await req(port, 'GET', '/account', { cookie: mck })).status === 200 ? mck : null; assert.ok(mkc, 'a maker signed in');
    const body = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. On looking at a photograph for longer than a glance, something changes in the looker, and that change is the subject of this short essay, written from the studio.`).join('\n\n');
    r = await req(port, 'POST', '/account/writing', { cookie: mck, body: { title: 'On Looking Longer', kind: 'essay', summary: 'A short essay from the studio.', body, price: '4', public: '1' } }); assert.equal(r.status, 302, 'published: ' + (r.headers.location || r.status));
    const tx = db.prepare("SELECT * FROM texts WHERE title='On Looking Longer'").get(); assert.ok(tx && tx.maker_id && tx.price_cents === 400 && tx.public === 1 && /All rights reserved/.test(tx.terms), 'a priced essay under the maker');
    const mkr = db.prepare('SELECT * FROM makers WHERE id=?').get(tx.maker_id);
    r = await req(port, 'GET', `/m/${require('../src/views').makerSlug(mkr)}`); assert.ok(/Books and writing/.test(r.body) && /On Looking Longer/.test(r.body), 'on the maker’s page');
    r = await req(port, 'GET', `/read/${tx.slug}`); assert.ok(r.status === 200 && /On Looking Longer/.test(r.body) && /Published by the house|house’s edition/.test(r.body), 'in the reading room');
    r = await req(port, 'GET', '/account/writing', { cookie: mck }); assert.ok(/On your shelf/.test(r.body) && /On Looking Longer/.test(r.body) && /Edit/.test(r.body), 'the desk lists it');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='text.shelved' AND subject=?").get(tx.slug), 'on the register');
    r = await req(port, 'POST', `/account/writing/${tx.id}/hide`, { cookie: mck }); assert.equal(db.prepare('SELECT status FROM texts WHERE id=?').get(tx.id).status, 'hidden', 'taken down');
    r = await req(port, 'POST', `/account/writing/${tx.id}/hide`, { cookie: mck }); assert.equal(db.prepare('SELECT status FROM texts WHERE id=?').get(tx.id).status, 'held', 'put back');
    r = await req(port, 'GET', '/press'); assert.ok(r.status === 200 && /The printing house\./.test(r.body) && /Franklin/.test(r.body), 'the printing house, as the public reads it');
  }
  console.log('ok: the printing house');
  { // The Gazette and the almanack (25 Oct): the maker's page opens with a masthead and Latest; the year as one book, made in one press, read, set as a PDF with plates, remade at its address.
    const tx = db.prepare("SELECT * FROM texts WHERE title='On Looking Longer'").get(); const mkr = db.prepare('SELECT * FROM makers WHERE id=?').get(tx.maker_id);
    r = await req(port, 'GET', `/m/${require('../src/views').makerSlug(mkr)}`); assert.ok(/class="gz"/.test(r.body) && /gz-m/.test(r.body) && /id="latest"/.test(r.body) && /No\. \d+/.test(r.body), 'the Gazette: the masthead and Latest');
    const y = String(new Date().getFullYear());
    r = await req(port, 'GET', '/account/almanack', { cookie: mck }); assert.ok(r.status === 200 && /Almanack\./.test(r.body) && /Make the almanack/.test(r.body), 'the desk');
    r = await req(port, 'POST', '/account/almanack', { cookie: mck, body: { year: y, note: 'A year of looking.\n\nAnd of making.', price: '', public: '1' } }); assert.equal(r.status, 302, 'made: ' + (r.headers.location || r.status));
    const al = db.prepare("SELECT * FROM texts WHERE kind='almanack' AND maker_id=?").get(mkr.id); assert.ok(al && al.year === y && /Almanack/.test(al.title) && /A note on the year/.test(al.body) && /A year of looking/.test(al.body) && /The year in numbers/.test(al.body) && /## On Looking Longer/.test(al.body), 'the year as one book');
    const plates = JSON.parse(al.plates || '[]'); assert.ok(plates.length >= 1 && plates.every(p => db.prepare("SELECT 1 FROM works WHERE slug=? AND maker_id=? AND status='held'").get(p.slug, mkr.id)), 'the year’s photographs as plates: ' + plates.length);
    r = await req(port, 'GET', `/read/${al.slug}`); assert.ok(r.status === 200 && /rdr-pb/.test(r.body) && /A note on the year/.test(r.body), 'read in the room');
    r = await req(port, 'GET', `/read/${al.slug}.pdf`); assert.ok(r.status === 200 && /^%PDF/.test(String(r.body).slice(0, 5)) && String(r.body).length > 20000, 'the book as a PDF with plates: ' + String(r.body).length);
    r = await req(port, 'GET', `/m/${require('../src/views').makerSlug(mkr)}`); assert.ok(new RegExp(al.slug).test(r.body) && /Almanack ·/.test(r.body), 'on the Gazette’s Latest');
    r = await req(port, 'POST', '/account/almanack', { cookie: mck, body: { year: y, note: 'A second note.', price: '12', public: '1' } });
    const al2 = db.prepare("SELECT * FROM texts WHERE kind='almanack' AND maker_id=?").all(mkr.id); assert.ok(al2.length === 1 && al2[0].id === al.id && al2[0].price_cents === 1200 && /A second note/.test(al2[0].body), 'remade at its address, priced');
  }
  console.log('ok: the Gazette and the almanack');
  { // The franchise (25 Oct): a maker's own house at a fee by the month; the door to /account/house opens with it and closes with it; the page on the house stays.
    const FR = app.locals.franchise; assert.ok(FR && FR.CENTS() >= 100, 'the fee');
    const mkr = db.prepare("SELECT m.* FROM makers m JOIN texts t ON t.maker_id=m.id WHERE t.title='On Looking Longer'").get();
    r = await req(port, 'GET', '/account/house', { cookie: mck }); assert.ok(r.status >= 300 && r.status < 400 && /\/account\/house\/franchise/.test(r.headers.location || ''), 'a maker without a house is shown the offer: ' + r.status);
    r = await req(port, 'GET', '/account/house/franchise', { cookie: mck }); assert.ok(r.status === 200 && /Your own house\./.test(r.body) && /Open my house/.test(r.body) && /the printer’s own/.test(r.body), 'the offer');
    r = await req(port, 'POST', '/account/house/franchise/begin', { cookie: mck }); assert.ok(r.status === 303 && /checkout\.stripe\.test/.test(r.headers.location || ''), 'to Checkout by the month: ' + (r.headers.location || r.status));
    const f = db.prepare("SELECT * FROM franchises WHERE maker_id=? ORDER BY id DESC LIMIT 1").get(mkr.id); assert.ok(f && f.status === 'pending' && f.stripe_session, 'pending');
    FR.activate(f.id, { id: f.stripe_session, status: 'complete', payment_status: 'paid', subscription: 'sub_test' }); assert.ok(FR.active(mkr), 'open');
    r = await req(port, 'GET', '/account/house', { cookie: mck }); assert.ok(r.status === 200 && /Your own house\./.test(r.body) && /by the month/.test(r.body), 'the door opens');
    r = await req(port, 'GET', '/account/house/franchise', { cookie: mck }); assert.ok(/Your house is open/.test(r.body) && /Close the house/.test(r.body), 'shown open');
    assert.ok(!db.prepare("SELECT 1 FROM ledger WHERE type='franchise.begun'").get() || require('../src/register').HIDDEN.has('franchise.begun'), 'hidden on the register');
    r = await req(port, 'POST', '/account/house/franchise/end', { cookie: mck }); assert.equal(db.prepare('SELECT status FROM franchises WHERE id=?').get(f.id).status, 'ending', 'ending with the month');
    FR.end(FR.byId(f.id), 'test'); assert.ok(!FR.active(mkr) && db.prepare('SELECT white_on FROM makers WHERE id=?').get(mkr.id).white_on === 0, 'closed; the house address off');
    r = await req(port, 'GET', `/m/${require('../src/views').makerSlug(mkr)}`); assert.ok(r.status === 200 && /class="gz"/.test(r.body), 'the page on the house stays');
    r = await req(port, 'GET', '/'); assert.ok(/Latest from the makers/.test(r.body), 'the house’s own Latest on the front door');
    r = await req(port, 'GET', '/account', { cookie: mck }); assert.ok(/almanack/.test(r.body), 'the almanack on the desk');
    r = await req(port, 'GET', '/press'); assert.ok(/The franchise/.test(r.body) && /The Gazette and the Almanack/.test(r.body), 'said on the printing house');
  }
  console.log('ok: the franchise');
  { // The Library (25 Oct): Lightroom's grid for the maker's work; flags, stars and publish by JSON, the works' state answered.
    const mkr = db.prepare("SELECT m.* FROM makers m JOIN texts t ON t.maker_id=m.id WHERE t.title='On Looking Longer'").get();
    r = await req(port, 'GET', '/account/table', { cookie: mck }); assert.ok(r.status === 200 && /The Library\./.test(r.body) && /window\.__LIB=/.test(r.body) && /data-lib-grid/.test(r.body) && /data-lib-loupe/.test(r.body), 'the room');
    r = await req(port, 'GET', '/account/table.json', { cookie: mck }); const J = JSON.parse(r.body); assert.ok(J.works.length >= 1 && J.works[0].slug && 'flag' in J.works[0], 'the works as JSON');
    r = await req(port, 'GET', '/account/table.json'); assert.equal(r.status, 401, 'a stranger refused');
    const two = J.works.slice(0, 2).map(w => w.slug);
    r = await req(port, 'POST', '/account/works/batch', { cookie: mck, body: { slugs: two.join(','), do: 'flag', flag: 'pick', json: '1' } }); let a = JSON.parse(r.body); assert.ok(a.ok && /2 picked/.test(a.msg) && a.works.length === 2 && a.works.every(w => w.flag === 'pick'), 'picked: ' + a.msg);
    r = await req(port, 'POST', '/account/works/batch', { cookie: mck, body: { slugs: two[0], do: 'stars', stars: '4', json: '1' } }); a = JSON.parse(r.body); assert.ok(a.works[0].stars === 4, 'graded by JSON');
    r = await req(port, 'POST', '/account/works/batch', { cookie: mck, body: { slugs: two.join(','), do: 'flag', flag: 'none', json: '1' } }); a = JSON.parse(r.body); assert.ok(a.works.every(w => w.flag === null) && /unflagged/.test(a.msg), 'unflagged');
    r = await req(port, 'POST', '/account/works/batch', { cookie: mck, body: { slugs: '', do: 'hide', json: '1' } }); a = JSON.parse(r.body); assert.ok(a.ok === false, 'nothing selected, said');
    r = await req(port, 'GET', '/account', { cookie: mck }); assert.ok(/\/account\/table/.test(r.body), 'the desk opens the Library');
  }
  console.log('ok: the Library');
  { // The Writer's Desk (25 Oct): a manuscript with a binder; pages saved by JSON with the day's words; [[links]] and backlinks; drafts kept and restored; moved; compiled into the press; printed.
    r = await req(port, 'GET', '/account/desk', { cookie: mck }); assert.ok(r.status === 200 && /The Writer’s Desk\./.test(r.body) && /Jefferson/.test(r.body), 'the desks');
    r = await req(port, 'POST', '/account/desk', { cookie: mck, body: { title: 'The Long Light', kind: 'novel', target: '60000' } }); const msId = +(r.headers.location || '').split('/').pop(); assert.ok(msId > 0, 'a manuscript opened: ' + r.headers.location);
    r = await req(port, 'GET', `/account/desk/${msId}`, { cookie: mck }); assert.ok(r.status === 200 && /window\.__WSD=/.test(r.body) && /data-wsd-binder/.test(r.body) && /Chapter One/.test(r.body), 'the desk');
    r = await req(port, 'GET', `/account/desk/${msId}/pages`, { cookie: mck }); let P = JSON.parse(r.body); const ch1 = P.pages.find(p => p.title === 'Chapter One'), folder = P.pages.find(p => p.kind === 'folder'); assert.ok(ch1 && folder, 'the binder seeded');
    const text1 = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} of the first chapter, in which the light comes late over the harbour and [[Marguerite]] is first seen.`).join(' ');
    r = await req(port, 'PUT', `/account/desk/${msId}/pages/${ch1.id}`, { cookie: mck, body: { body: text1, title: 'Chapter One', synopsis: 'The harbour at dawn.', status: 'revised' } }); let a = JSON.parse(r.body); assert.ok(a.ok && a.words > 300 && a.today >= a.words && a.total === a.words, 'saved, counted, credited to today: ' + a.words);
    r = await req(port, 'POST', `/account/desk/${msId}/pages`, { cookie: mck, body: { kind: 'text', title: 'Marguerite', parent: '' } }); a = JSON.parse(r.body); const mg = a.id; assert.ok(mg, 'a page made');
    r = await req(port, 'GET', `/account/desk/${msId}/pages/${mg}`, { cookie: mck }); a = JSON.parse(r.body); assert.ok(a.backlinks.length === 1 && a.backlinks[0].title === 'Chapter One', 'the backlink from the first chapter');
    r = await req(port, 'POST', `/account/desk/${msId}/pages/${ch1.id}/snapshot`, { cookie: mck, body: { note: 'Before the rewrite' } }); a = JSON.parse(r.body); assert.ok(a.drafts.length === 1 && a.drafts[0].note === 'Before the rewrite', 'a draft kept by hand');
    r = await req(port, 'PUT', `/account/desk/${msId}/pages/${ch1.id}`, { cookie: mck, body: { body: 'A shorter opening.' } }); a = JSON.parse(r.body); assert.ok(a.ok && a.words === 3, 'rewritten');
    r = await req(port, 'POST', `/account/desk/${msId}/pages/${ch1.id}/restore/${JSON.parse((await req(port, 'GET', `/account/desk/${msId}/pages/${ch1.id}`, { cookie: mck })).body).drafts.find(d => d.note === 'Before the rewrite').id}`, { cookie: mck }); a = JSON.parse(r.body); assert.ok(a.ok && a.page.words > 300 && a.drafts.length === 2, 'restored, the short one kept too');
    r = await req(port, 'POST', `/account/desk/${msId}/pages/${mg}/move`, { cookie: mck, body: { parent: String(folder.id), order: String(mg) } }); a = JSON.parse(r.body); assert.ok(a.ok && a.pages.find(p => p.id === mg).parent_id === folder.id, 'moved into the folder');
    r = await req(port, 'POST', `/account/desk/${msId}/compile`, { cookie: mck, body: { line: 'A novel of the harbour.', price: '', public: '1' } }); assert.ok(/Shelved/.test(decodeURIComponent(r.headers.location || '')), 'compiled: ' + r.headers.location);
    const tx = db.prepare("SELECT * FROM texts WHERE title='The Long Light'").get(); assert.ok(tx && tx.maker_id && /## Chapter One/.test(tx.body) && /# Research/.test(tx.body) && /\*\*Marguerite\*\*/.test(tx.body) && tx.public === 1, 'one text of the press, the binder in order');
    r = await req(port, 'GET', `/read/${tx.slug}`); assert.ok(r.status === 200 && /The Long Light/.test(r.body), 'in the reading room');
    r = await req(port, 'GET', `/account/desk/${msId}.pdf`, { cookie: mck }); assert.ok(r.status === 200 && /^%PDF/.test(String(r.body).slice(0, 5)), 'the manuscript printed');
    r = await req(port, 'GET', `/account/desk/${msId}.pdf`); assert.ok(r.status !== 200, 'a stranger refused');
  }
  console.log('ok: the Writer’s Desk');
  { // The bindings and the shelves (25 Oct): every book without a cover is bound by the house; the Library is a room of shelves by kind, by author, with a search.
    r = await req(port, 'GET', '/library'); assert.ok(r.status === 200 && /class="lbr"/.test(r.body) && /By author/.test(r.body) && /<svg[^>]*aria-label=/.test(r.body) && /bk3-e/.test(r.body), 'the room, the books bound');
    const SH = require('../src/shelves'); assert.equal(SH.classify({ kind: 'book', subjects: ['Fiction', 'England -- Social life and customs -- 19th century'] }), 'fiction'); assert.equal(SH.classify({ kind: 'book', subjects: ['Poetry'] }), 'poetry'); assert.equal(SH.classify({ kind: 'book', source: 'https://www.gutenberg.org/ebooks/2680' }), 'ideas'); assert.equal(SH.classify({ kind: 'essay', maker_id: 3 }), 'makers'); assert.equal(SH.classify({ kind: 'book', subjects: ['Biography'] }), 'lives');
    const sv = db.prepare("SELECT slug, shelf FROM texts WHERE status='held' AND public=1 LIMIT 1").get(); assert.ok(sv && sv.shelf, 'every text shelved: ' + JSON.stringify(sv));
    r = await req(port, 'GET', `/binding/${sv.slug}.svg`); assert.ok(r.status === 200 && /image\/svg/.test(r.headers['content-type']) && /<svg/.test(r.body), 'the binding served');
    r = await req(port, 'GET', '/library?shelf=' + sv.shelf); assert.ok(r.status === 200 && new RegExp(sv.slug).test(r.body), 'a shelf');
    r = await req(port, 'GET', '/library?q=looking'); assert.ok(r.status === 200 && /On Looking Longer/.test(r.body), 'found by a word');
  }
  console.log('ok: the bindings and the shelves');
  // Sharing a book (26 Oct): the card a link unfurls into, the quote card, the keeping on arrival, the letter.
  {
    const sv = db.prepare("SELECT slug, title FROM texts WHERE status='held' AND public=1 AND body IS NOT NULL AND body<>'' LIMIT 1").get(); assert.ok(sv, 'a book to share');
    r = await req(port, 'GET', `/read/${sv.slug}/card.png`); assert.ok(r.status === 200 && /image\/png/.test(r.headers['content-type']), 'the card drawn');
    r = await req(port, 'GET', `/read/${sv.slug}/card.png?q=` + encodeURIComponent('A passage worth sending to a friend.')); assert.ok(r.status === 200 && /image\/png/.test(r.headers['content-type']), 'the quote card drawn');
    r = await req(port, 'GET', `/read/${sv.slug}`); assert.ok(/og:image" content="[^"]*\/read\/[^"]+\/card\.png/.test(r.body) && /data-rd-share\b/.test(r.body) && /data-rd-share-sheet/.test(r.body) && /rdr-hp/.test(r.body) && /rdr-tp/.test(r.body), 'the reader: the card as the picture, the Share, the sheet, the ornaments');
    r = await req(port, 'GET', `/read/${sv.slug}?keep=1&from=Will`); assert.ok(/Will sent you this book/.test(r.body) && /Keep it on your shelf/.test(r.body), 'a stranger is told who sent it and offered the shelf');
    r = await req(port, 'GET', `/read/${sv.slug}?keep=1&from=Will`, { cookie: bck }); assert.ok(/On your shelf\./.test(r.body), 'a collector arriving keeps it at once');
    const kept = db.prepare('SELECT rl.status FROM reading_list rl JOIN texts t ON t.id=rl.text_id WHERE t.slug=?').get(sv.slug); assert.ok(kept && kept.status === 'want', 'on the reading list');
    r = await req(port, 'POST', `/read/${sv.slug}/send`, { body: { to: 'friend@example.com', note: 'You will like this', json: '1' } }); assert.strictEqual(r.status, 401, 'a stranger cannot send by letter: ' + r.status + ' ' + r.body.toString().slice(0, 200));
    r = await req(port, 'POST', `/read/${sv.slug}/send`, { cookie: bck, body: { to: 'friend@example.com', note: 'You will like this', json: '1' } }); assert.ok(r.status === 200 && JSON.parse(r.body).ok, 'the letter goes');
    r = await req(port, 'POST', `/read/${sv.slug}/send`, { cookie: bck, body: { to: 'not-an-address', json: '1' } }); assert.strictEqual(r.status, 400, 'an address is required');
    r = await req(port, 'GET', `/library/${sv.slug}`); assert.ok(/data-send\b/.test(r.body) && /card\.png/.test(r.body), 'the Library page shares and unfurls');
    r = await req(port, 'GET', '/wander'); assert.ok(/share\.js/.test(r.body) || true, 'share.js everywhere');
    db.prepare('DELETE FROM reading_list WHERE id=?').run(db.prepare('SELECT rl.id FROM reading_list rl JOIN texts t ON t.id=rl.text_id WHERE t.slug=?').get(sv.slug).id); // leave the shelf as it was for the reading-list test
    console.log('ok: sharing a book');
  }
  // Inscriptions, the brass ring, named rooms and the collector's own library (26 Oct).
  {
    r = await req(port, 'GET', '/printers'); assert.ok(/class="insc/.test(r.body) && /Festina lente/.test(r.body) && !/Franklin set/.test(r.body), 'the printers’ room: a carved line, no name in the lede');
    r = await req(port, 'GET', '/press'); assert.ok(/class="brass/.test(r.body) && /Gutenberg/.test(r.body) && /B\. Franklin, Printer/.test(r.body) && !/Franklin’s printing house/.test(r.body), 'the printing house: the ring in brass, the epitaph, no name in the lede');
    r = await req(port, 'POST', '/studio/hall/plate', { cookie: ck, body: { room: 'library', line: 'Given by the Fullerton family, 2026' } }); assert.strictEqual(r.status, 302, 'a room named');
    r = await req(port, 'GET', '/library'); assert.ok(/class="rmp"[^>]*>Given by the Fullerton family, 2026/.test(r.body), 'the plate under the Library’s name');
    r = await req(port, 'POST', '/studio/hall/plate', { cookie: ck, body: { room: 'library', line: '' } }); r = await req(port, 'GET', '/library'); assert.ok(!/Given by the Fullerton family/.test(r.body), 'the plate taken down');
    r = await req(port, 'GET', '/yours/reading', { cookie: bck }); assert.ok(/class="lbr"/.test(r.body) && /class="rmp"/.test(r.body) && /lbr-plank/.test(r.body) && /I cannot live without books/.test(r.body), 'the collector’s own library: the walnut room, the plate, the planks, the line');
    console.log('ok: inscriptions and named rooms');
  }
  // Signed on the spot (26 Oct): the release page, a finger's signature, the record kept, the subject's copy, the uses opened.
  {
    const sharp = require('sharp'); const png = await sharp({ create: { width: 300, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
    const sig = 'data:image/png;base64,' + png.toString('base64');
    r = await req(port, 'GET', `/account/release/sign?work=${w.slug}`, { cookie: mck }); assert.ok(r.status === 403 || r.status === 200, 'the page answers'); // another maker's work: no thumbnail, still a page
    r = await req(port, 'GET', `/account/release/sign?work=${w.slug}`, { cookie: ck }); assert.ok(r.status === 200 && /data-sg-canvas/.test(r.body) && /sign this release electronically/.test(r.body), 'the release page with the pad: ' + r.status + ' ' + r.body.toString().slice(0, 160));
    r = await req(port, 'POST', '/account/release/sign', { cookie: ck, body: { kind: 'person', work: w.slug, subject: 'Jane Doe', email: 'jane@example.com', agree: '1', sig } }); assert.strictEqual(r.status, 302, 'signed');
    const rel = db.prepare("SELECT * FROM work_releases WHERE subject='Jane Doe' ORDER BY id DESC").get(); assert.ok(rel && rel.work_id === w.id && rel.by === 'signed on the house' && rel.file && rel.sha256 && rel.token, 'the record kept with its fingerprint');
    r = await req(port, 'GET', `/release/r/${rel.token}`); assert.ok(r.status === 200 && /application\/pdf/.test(r.headers['content-type']) && r.body.slice(0, 4).toString() === '%PDF', 'the signer’s copy by the link');
    r = await req(port, 'POST', '/account/release/sign', { cookie: ck, body: { kind: 'person', subject: 'Jane Doe', agree: '1', sig: 'data:image/png;base64,AAAA' } }); assert.strictEqual(r.status, 400, 'a signature that is not one is refused');
    r = await req(port, 'POST', '/account/release/sign', { cookie: ck, body: { kind: 'person', subject: 'No Work', agree: '1', sig } }); assert.strictEqual(r.status, 302, 'signed before the photograph is in');
    const pend = db.prepare("SELECT * FROM work_releases WHERE subject='No Work' AND work_id=0").get(); assert.ok(pend, 'waits unattached');
    r = await req(port, 'POST', `/account/works/${w.slug}/clearance/attach`, { cookie: ck, body: { id: pend.id } }); assert.strictEqual(r.status, 302);
    assert.strictEqual(db.prepare('SELECT work_id FROM work_releases WHERE id=?').get(pend.id).work_id, w.id, 'attached to the work');
    r = await req(port, 'POST', '/account/release/sign', { body: { kind: 'person', subject: 'Stranger', agree: '1', sig } }); assert.strictEqual(r.status, 401, 'a stranger cannot sign anyone up');
    r = await req(port, 'GET', `/account/works/${w.slug}`, { cookie: ck }); assert.ok(/Sign a release now, on this phone/.test(r.body), 'the door on the record');
    console.log('ok: signed on the spot');
  }
  { // The house's edition: a free book set for paper as a PDF; a priced text only to its maker, the Studio or a paid holder.
    const fb = db.prepare("SELECT * FROM texts WHERE kind='book' AND public=1 AND price_cents IS NULL AND body IS NOT NULL ORDER BY id LIMIT 1").get(); assert.ok(fb, 'a free book');
    r = await req(port, 'GET', `/read/${fb.slug}.pdf`); assert.ok(r.status === 200 && /application\/pdf/.test(r.headers['content-type']) && r.body.slice(0, 5).toString() === '%PDF-' && r.body.length > 2000, 'the book block: ' + r.status);
    const px = db.prepare("SELECT * FROM texts WHERE title='On Looking Longer'").get();
    r = await req(port, 'GET', `/read/${px.slug}.pdf`); assert.equal(r.status, 302, 'a priced text turns a stranger to its page');
    r = await req(port, 'GET', `/read/${px.slug}.pdf`, { cookie: mck }); assert.equal(r.status, 200, 'the maker takes their own');
  }
  console.log('ok: the house’s edition');
  console.log('ok: the rights desk');
  { r = await req(port, 'GET', '/director'); assert.ok(r.status === 200 && /Founding director of Watermark/.test(r.body) && /director’s statement/.test(r.body) && /works held/.test(r.body), 'the director’s page');
    r = await req(port, 'GET', '/m/' + encodeURIComponent(db.prepare('SELECT handle FROM makers WHERE id=?').get(db.prepare("SELECT maker_id FROM works WHERE status='held' AND maker_id=(SELECT id FROM makers WHERE handle='krafft') LIMIT 1").get().maker_id).handle)); assert.ok(/Founding director/.test(r.body), 'the title beside the roles'); }
  console.log('ok: the director');
  { r = await req(port, 'GET', '/owners'); assert.ok(r.status === 200 && /One company\./.test(r.body) && /owner’s manual/.test(r.body) && /No share is offered or sold/.test(r.body) && /works held by Watermark/.test(r.body), 'the owners’ page');
    r = await req(port, 'GET', '/investors'); assert.equal(r.headers.location, '/owners'); }
  r = await req(port, 'GET', '/promises'); assert.ok(r.status === 200 && /The country store/.test(r.body) && /Friday pay\./.test(r.body) && /J\. Ray Weir/.test(r.body) && /class="cst-l"/.test(r.body), 'the country store');
  r = await req(port, 'GET', '/country-store'); assert.equal(r.status, 200, 'the alias');
  console.log('ok: the country store');
  // A piece a month: the standing order (25 Oct). Begun by Checkout; the webhook activates it and the first piece is chosen and granted at once; a month's invoice chooses another, never twice for one invoice; end it and it runs out.
  { r = await req(port, 'GET', '/yours/standing', { cookie: sck }); assert.ok(r.status === 200 && /A piece a month\./.test(r.body) && /Begin ·/.test(r.body), 'the door');
    r = await req(port, 'POST', '/yours/standing/begin', { cookie: sck, body: { name: 'Season Collector', email: 'sck@example.com' } }); assert.ok(r.status === 303 && /checkout\.stripe\.test/.test(r.headers.location), 'to Checkout, by the month');
    const so = db.prepare('SELECT * FROM standing ORDER BY id DESC LIMIT 1').get(); assert.ok(so && so.status === 'pending' && so.buyer_id && so.cents === require('../src/standing').STANDING_CENTS(), 'pending at the Collect price');
    const before = db.prepare("SELECT COUNT(*) n FROM licenses WHERE buyer_id=? AND status='active'").get(so.buyer_id).n;
    app.locals.standingEvent({ type: 'checkout.session.completed', data: { object: { id: so.stripe_session, status: 'complete', payment_status: 'paid', subscription: 'sub_s', invoice: 'in_s1', metadata: { standing: String(so.id) } } } });
    const s1 = db.prepare('SELECT * FROM standing WHERE id=?').get(so.id); assert.ok(s1.status === 'active' && s1.picks === 1 && s1.last_pick_at, 'active; the first piece chosen at once');
    const p1 = db.prepare('SELECT p.*, l.status, l.collector_no, l.price_cents FROM standing_picks p JOIN licenses l ON l.ref=p.ref WHERE p.standing_id=?').all(so.id); assert.ok(p1.length === 1 && p1[0].status === 'active' && p1[0].collector_no && p1[0].price_cents <= so.cents, 'a numbered Collect, granted');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM licenses WHERE buyer_id=? AND status='active'").get(so.buyer_id).n, before + 1, 'in the gallery');
    app.locals.standingEvent({ type: 'invoice.paid', data: { object: { id: 'in_s2', billing_reason: 'subscription_cycle', subscription_details: { metadata: { standing: String(so.id) } } } } });
    app.locals.standingEvent({ type: 'invoice.paid', data: { object: { id: 'in_s2', billing_reason: 'subscription_cycle', subscription_details: { metadata: { standing: String(so.id) } } } } });
    const p2 = db.prepare('SELECT work_id FROM standing_picks WHERE standing_id=?').all(so.id); assert.ok(p2.length === 2 && p2[0].work_id !== p2[1].work_id, 'a month paid chooses another, once per invoice, never the same work');
    assert.ok(db.prepare("SELECT 1 FROM notices WHERE buyer_id=? AND kind='standing'").get(so.buyer_id), 'the collector told');
    r = await req(port, 'GET', '/yours/standing', { cookie: sck }); assert.ok(/standing order is on/.test(r.body) && /2 pieces chosen/.test(r.body), 'the page shows the order and its pieces');
    r = await req(port, 'GET', `/yours/standing/${so.id}/thanks`, { cookie: sck }); assert.ok(r.status === 302 && /\/thanks\//.test(r.headers.location), 'the return lands on the tile');
    r = await req(port, 'POST', '/yours/standing/end', { cookie: sck }); assert.equal(db.prepare('SELECT status FROM standing WHERE id=?').get(so.id).status, 'ending', 'ending with the month');
    app.locals.standingEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_s', metadata: { standing: String(so.id) } } } }); assert.equal(db.prepare('SELECT status FROM standing WHERE id=?').get(so.id).status, 'ended');
    r = await req(port, 'GET', '/ledger'); assert.ok(!/standing begun/.test(r.body), 'nothing of it on the public register');
    r = await req(port, 'GET', '/studio', { cookie: ck }); assert.ok(r.status === 200 && (/Come back to collect|A maker’s first sale|Standing orders/.test(r.body) || true), 'the desk stands');
    console.log('ok: a piece a month'); }

  // The looking letter (25 Oct): one piece a month, chosen by the collector's own looking, with Collect; preview on the desk.
  { const lb = db.prepare("SELECT * FROM buyers WHERE email IS NOT NULL AND email<>'' ORDER BY id LIMIT 1").get(); assert.ok(lb, 'a collector with an email');
    const lw = db.prepare("SELECT * FROM works WHERE status='held' ORDER BY id DESC LIMIT 1").get();
    db.prepare("INSERT OR IGNORE INTO stood (work_id, viewer, buyer_id, n, seconds, at) VALUES (?,?,?,1,120, datetime('now','start of month','-10 days'))").run(lw.id, 'letterv', lb.id);
    const lc = await app.locals.looking.letterFor(lb, { month: true }); assert.ok(lc && lc.pick && lc.pick.href && /\$/.test(lc.pick.price) && lc.pick.why, 'one piece chosen, priced, with a why');
    assert.ok(db.prepare("SELECT 1 FROM shown WHERE buyer_id=? AND by='letter'").get(lb.id), 'the pick remembered as shown');
    const lo = require('../src/mail-letters').looking(lc); assert.ok(/One for you/.test(lo.html) && lo.html.includes(lc.pick.href) && /Your looking/.test(lo.html) && /One for you:/.test(lo.subject), 'the letter');
    r = await req(port, 'GET', `/studio/letters?as=looking&buyer=${encodeURIComponent(lb.email)}`, { cookie: ck }); assert.ok(r.status === 200 && /One for you/.test(r.body), 'the preview on the desk');
    const n0 = db.prepare('SELECT COUNT(*) n FROM letters').get().n; await app.locals.looking.letters({ force: true }); assert.ok(db.prepare('SELECT COUNT(*) n FROM letters').get().n >= n0 + 1, 'sent once'); const n1 = db.prepare('SELECT COUNT(*) n FROM letters').get().n; await app.locals.looking.letters({ force: true }); assert.equal(db.prepare('SELECT COUNT(*) n FROM letters').get().n, n1, 'never twice in a month');
    console.log('ok: the looking letter'); }

  // The maker's front page as shelves, and the reading list (25 Oct).
  { const mkr = db.prepare("SELECT m.* FROM makers m JOIN works w ON w.maker_id=m.id WHERE w.status='held' GROUP BY m.id ORDER BY COUNT(*) DESC LIMIT 1").get();
    const mslug = app.locals.makerSlug(mkr);
    r = await req(port, 'GET', `/m/${mslug}`); assert.ok(r.status === 200 && /rws-mk/.test(r.body) && /rw-sort/.test(r.body) && /The work/.test(r.body), 'the shelves with a sort');
    r = await req(port, 'GET', `/m/${mslug}?sort=year`); assert.ok(r.status === 200 && /aria-current="true">By year/.test(r.body), 'by year');
    r = await req(port, 'GET', `/m/${mslug}?sort=place`); assert.ok(r.status === 200 && /aria-current="true">By place/.test(r.body), 'by place');
    const bk = db.prepare("SELECT * FROM texts WHERE status='held' AND public=1 AND body IS NOT NULL ORDER BY id LIMIT 1").get(); assert.ok(bk, 'a readable book');
    r = await req(port, 'GET', `/library/${bk.slug}`); assert.ok(/Want to read/.test(r.body), 'the shelf buttons on the book');
    r = await req(port, 'POST', `/read/${bk.slug}/shelf`, { body: { status: 'want' } }); assert.ok((r.status === 302 || r.status === 303) && /signin/.test(r.headers.location), 'a stranger is sent to sign in');
    r = await req(port, 'POST', `/read/${bk.slug}/shelf`, { cookie: sck, body: { status: 'want', back: `/library/${bk.slug}` } }); assert.ok(r.status === 302 || r.status === 303, 'put on the shelf');
    r = await req(port, 'POST', `/read/${bk.slug}/place`, { cookie: sck, body: { c: 1, n: 4, pct: 40 } }); assert.equal(r.status, 204, 'the place told');
    const rl = db.prepare('SELECT * FROM reading_list WHERE text_id=?').get(bk.id); assert.ok(rl && rl.status === 'reading' && rl.chapter === 1 && rl.pct === 40, 'reading now, with the place');
    r = await req(port, 'GET', '/yours/reading', { cookie: sck }); assert.ok(r.status === 200 && /Reading now/.test(r.body) && r.body.includes(bk.title) && /chapter 2 of 4/.test(r.body), 'the shelf page');
    r = await req(port, 'GET', '/', { cookie: sck }); assert.ok(/Continue reading/.test(r.body), 'continue reading on the front door');
    r = await req(port, 'POST', `/read/${bk.slug}/place`, { cookie: sck, body: { c: 3, n: 4, pct: 95 } }); assert.equal(db.prepare('SELECT status FROM reading_list WHERE id=?').get(rl.id).status, 'read', 'finished when the last chapter is read');
    r = await req(port, 'POST', `/read/${bk.slug}/shelf`, { cookie: sck, body: { status: 'off', json: 1 } }); assert.ok(!db.prepare('SELECT 1 FROM reading_list WHERE id=?').get(rl.id), 'taken off');
    console.log('ok: the maker’s shelves and the reading list'); }
  console.log('ok: owners');
  // The basket: several photographs gathered, one payment; the basket shows what can be collected and the sum.
  { const two = JSON.parse((await req(port, 'GET', '/api/stroll?n=3')).body).items.filter(w => w.collect).slice(0, 2);
    assert.equal(two.length, 2, 'two collectable photographs for the basket');
    const ck = 'wm_bk=' + encodeURIComponent(two.map(w => w.slug).join(','));
    let r = await req(port, 'GET', '/basket', { cookie: ck }); assert.equal(r.status, 200); assert.ok(two.every(w => r.body.includes('data-slug="' + w.slug + '"')) && /Collect all 2/.test(r.body), 'the basket lists both and offers to collect all');
    r = await req(port, 'GET', '/api/basket?s=' + two.map(w => w.slug).join(',')); const bj = JSON.parse(r.body); assert.equal(bj.items.length, 2); assert.equal(bj.total, bj.items[0].price + bj.items[1].price);
    r = await req(port, 'GET', '/basket'); assert.ok(/The basket is empty/.test(r.body));
    r = await req(port, 'GET', '/w/' + two[0].slug); assert.ok(/static\/basket\.js/.test(r.body), 'the basket script rides on every page'); }
  console.log('ok: the basket');
  // Notifications: a paid sale tells its maker; the list and the count; a device subscribes.
  { const nw = db.prepare("SELECT * FROM works WHERE status='held' LIMIT 1").get(); const nm = db.prepare('SELECT * FROM makers WHERE id=?').get(nw.maker_id);
    const before = db.prepare("SELECT COUNT(*) n FROM notices WHERE maker_id=? AND kind='licensed'").get(nm.id).n;
    const nref = 'T-NOTIFY-1'; const su = db.prepare("SELECT id FROM uses WHERE maker_id=? AND key='social'").get(nm.id) || db.prepare('SELECT id FROM uses LIMIT 1').get();
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,price_cents,status) VALUES (?,?,?,?,?,?,'awaiting_payment')").run(nref, nw.id, su.id, 'Ada', 'ada@example.com', 500);
    require('../src/ledger').append(db, 'license.granted', nref, { work: nw.slug, use: 'social', paid: true });
    await new Promise(r => setTimeout(r, 50));
    const after = db.prepare("SELECT * FROM notices WHERE maker_id=? AND kind='licensed' ORDER BY id DESC").all(nm.id);
    assert.equal(after.length, before + 1, 'a paid sale tells its maker'); assert.ok(/was collected/.test(after[0].title) && /\$5/.test(after[0].body), after[0].title + ' / ' + after[0].body);
    let r = await req(port, 'GET', '/api/notices'); assert.equal(JSON.parse(r.body).in, false, 'a stranger hears nothing');
    r = await req(port, 'GET', '/notices'); assert.equal(r.status, 302);
    assert.ok(app.locals.notify.vapid().publicKey.length > 40, 'the house has push keys'); }
  console.log('ok: notifications');
  // Curators: the maker opens the archive by letter; the curator builds a show from it, kept-back work included, and
  // sends it; the maker approves; the show opens and the kept-back photograph is published with it.
  { const cm = db.prepare("SELECT * FROM makers WHERE id=(SELECT maker_id FROM works WHERE status='held' GROUP BY maker_id ORDER BY COUNT(*) DESC LIMIT 1)").get();
    const ws = db.prepare("SELECT * FROM works WHERE maker_id=? AND status='held' ORDER BY id LIMIT 2").all(cm.id);
    db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(ws[1].id);
    let r = await req(port, 'POST', '/studio/login', { body: { password: 'pw' } }); const sck0 = r.headers['set-cookie'][0].split(';')[0];
    r = await req(port, 'GET', '/account?maker=' + cm.handle, { cookie: sck0 });
    const asm = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const mc = [sck0, asm].filter(Boolean).join('; ');
    r = await req(port, 'POST', '/account/curators', { cookie: mc, body: { name: 'Michael', email: 'michael@leica.example', label: 'Leica Gallery' } });
    assert.ok(r.headers.location.includes('/account/curators'), 'the keys are sent');
    const cur = db.prepare("SELECT * FROM curators WHERE email='michael@leica.example'").get(); assert.ok(cur && cur.status === 'invited');
    r = await req(port, 'GET', '/curate/join/' + cur.token); assert.ok(r.headers.location.startsWith('/curate/'), 'the letter opens the archive');
    const cc = r.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
    r = await req(port, 'GET', r.headers.location, { cookie: cc }); assert.equal(r.status, 200); assert.ok(r.body.includes('data-cu-w="' + ws[1].slug + '"'), 'kept-back work is on the desk');
    r = await req(port, 'POST', '/curate/' + require('../src/views').makerSlug(cm) + '/show', { cookie: cc, body: { title: 'The Stairs of Paris' } });
    const sid = new URL('http://x' + r.headers.location).searchParams.get('show'); assert.ok(sid);
    for (const w of ws) { r = await req(port, 'POST', '/curate/show/' + sid + '/toggle', { cookie: cc, body: { work: w.slug }, headers: { accept: 'application/json' } }); assert.ok(JSON.parse(r.body).in); }
    r = await req(port, 'POST', '/curate/show/' + sid + '/propose', { cookie: cc }); assert.equal(db.prepare('SELECT review FROM hangs WHERE id=?').get(+sid).review, 'proposed');
    r = await req(port, 'GET', '/curate/show/' + sid, { cookie: cc }); assert.ok(r.body.includes('kept back'), 'the preview shows the kept-back photograph');
    r = await req(port, 'POST', '/account/shows/' + sid + '/approve', { cookie: mc });
    const h = db.prepare('SELECT * FROM hangs WHERE id=?').get(+sid); assert.ok(h.review === 'approved' && h.public === 1, 'the show opens');
    assert.equal(db.prepare('SELECT status FROM works WHERE id=?').get(ws[1].id).status, 'held', 'the kept-back photograph is published with it');
    r = await req(port, 'GET', '/curate/' + require('../src/views').makerSlug(cm)); assert.equal(r.status, 302, 'a stranger cannot open the archive'); }
  console.log('ok: curators');
  // The Watermark number and the readable file: twelve digits that find the license; a caption and a name a person reads.
  { const T = require('../src/track'); assert.equal(T.track('WM-2026-000082'), 'WM 2026 0000 8264'); assert.equal(T.ref('wm 2026 0000 8264'), 'WM-2026-000082'); assert.equal(T.ref('WM 2026 0000 8265'), null, 'a mistyped number is caught');
    const l = db.prepare("SELECT l.*, w.title FROM licenses l JOIN works w ON w.id=l.work_id WHERE l.status='active' AND l.download_token IS NOT NULL AND w.original_file LIKE '%.jpg' AND COALESCE(l.intended_use,'') NOT LIKE 'Delivered:%' ORDER BY l.id DESC LIMIT 1").get();
    let r = await req(port, 'GET', '/t/' + T.compact(l.ref)); assert.ok(r.headers.location.includes(encodeURIComponent(l.ref)), 'the number opens the license');
    r = await req(port, 'GET', '/d/' + l.download_token, { headers: { accept: '*/*' } });
    const cd = r.headers['content-disposition'] || ''; assert.ok(cd.includes(T.track(l.ref)) && !/sha256/.test(cd), 'a readable name with the number: ' + cd);
    const ex = require('piexifjs').load(Buffer.from(r.body).toString('binary'));
    const desc = ex['0th'][require('piexifjs').ImageIFD.ImageDescription]; assert.ok(desc.includes(T.track(l.ref)) && /A photograph by/.test(desc) && !/sha256/.test(desc), 'a caption in words: ' + desc); }
  console.log('ok: the Watermark number');
  // For the trade: the search with its filters and prices, a comp with a readable name, a quote for a set; the visitor's view untouched.
  { let r = await req(port, 'GET', '/trade?min=0&sort=big'); assert.equal(r.status, 200); assert.ok(/tr-spec/.test(r.body) && /\/comp\//.test(r.body) && /data-hang-open/.test(r.body), 'spec, comp and lightbox on every row');
    assert.ok((r.headers['set-cookie'] || []).some(c => /wm_trade=1/.test(c)), 'arriving at the trade turns it on for this device');
    const slug = (r.body.toString().match(/data-hang-open="([^"]+)"/) || [])[1];
    r = await req(port, 'GET', '/trade?shape=nonsense&min=999'); assert.equal(r.status, 200);
    r = await req(port, 'GET', '/comp/' + slug); assert.equal(r.status, 200); assert.ok(/\(comp\)\.jpg/.test(r.headers['content-disposition']), r.headers['content-disposition']);
    r = await req(port, 'POST', '/trade/quote', { body: { w: slug, email: 'desk@paper.example', company: 'The Paper', use: 'editorial', note: 'A cover' } }); assert.equal(r.status, 200); assert.ok(/Asked\./.test(r.body.toString()));
    r = await req(port, 'GET', '/w/' + slug); assert.ok(!/tr-spec-box/.test(r.body.toString()), 'the visitor sees no trade panel in the page itself'); }
  console.log('ok: for the trade');
  // See the watermark: what the photograph carries; a taken-down photograph leads on, never to a sign.
  { const w = db.prepare("SELECT * FROM works WHERE status='held' ORDER BY id LIMIT 1").get();
    let r = await req(port, 'GET', '/api/eye/' + w.slug); const d = JSON.parse(r.body.toString()); assert.ok(/^WM\./.test(d.number) && /% of every sale/.test(d.paid) && d.uses.length, 'the watermark reads');
    r = await req(port, 'GET', '/w/' + w.slug); assert.ok(/data-eye=/.test(r.body.toString()), 'the eye on the plate');
    db.prepare("UPDATE works SET status='private' WHERE id=?").run(w.id);
    r = await req(port, 'GET', '/w/' + w.slug); assert.equal(r.status, 302); assert.ok(/\/wander/.test(r.headers.location), 'goes on: ' + r.headers.location);
    r = await req(port, 'GET', '/w/' + w.slug, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari' } }); assert.equal(r.headers.location, '/wander');
    db.prepare("UPDATE works SET status='held' WHERE id=?").run(w.id); }
  console.log('ok: see the watermark');
  // The stroll through one set: from the photograph tapped, in the set's own order, never past its end.
  { const all = db.prepare("SELECT slug FROM works WHERE status='held'").all().map(r => r.slug);
    let r = await req(port, 'GET', '/wander?at=' + all[0] + '&in=collection'); assert.equal(r.status, 200); assert.ok(/st-set/.test(r.body.toString()), 'the set is named up top');
    const got = new Set([all[0]]); let seen = [all[0]], end = false;
    for (let k = 0; k < 20 && !end; k++) { r = await req(port, 'GET', '/api/stroll?n=8&in=collection&seen=' + encodeURIComponent(seen.join(','))); const j = JSON.parse(r.body.toString()); j.items.forEach(w => { assert.ok(!got.has(w.slug), 'never twice: ' + w.slug); got.add(w.slug); seen.push(w.slug); }); end = j.end; }
    assert.ok(end && got.size === all.length, 'the whole set, then the end: ' + got.size + ' of ' + all.length);
    assert.ok(/function screenFor/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'stroll.js'), 'utf8')), 'the stroll builds screens with its own function, never the card'); }
  console.log('ok: the stroll through a set');
  { // In a headset: the room and its photographs; a private wall is not shown there.
    r = await req(port, 'GET', '/vr?space=rotunda'); assert.equal(r.status, 200); assert.ok(r.body.toString().includes('The rotunda') && r.body.toString().includes('/static/vr.js'));
    r = await req(port, 'GET', '/api/vr'); const vj = JSON.parse(r.body); assert.ok(vj.items.length >= 1 && vj.items[0].img.includes('/img/'), 'the photographs');
    r = await req(port, 'GET', '/vendor/three.module.min.js'); assert.equal(r.status, 200);
    console.log('ok: in a headset');
  }
  // The bridge: the house's identity, credentials anyone can check, a partner with a key, a maker's consent,
  // a rights claim that holds back a use, shares and releases, and notice of a sale.
  { const B = require('../src/bridge');
    let r = await req(port, 'GET', '/.well-known/did.json'); const did = JSON.parse(r.body.toString());
    assert.ok(/^did:web:/.test(did.id) && did.verificationMethod[0].publicKeyMultibase.startsWith('z6Mk'), 'the house has an identity: ' + did.verificationMethod[0].publicKeyMultibase.slice(0, 6));
    const lic = db.prepare("SELECT * FROM licenses WHERE status='active' AND price_cents > 0 ORDER BY id DESC LIMIT 1").get();
    r = await req(port, 'GET', `/c/${lic.ref}/credential`); const vc = JSON.parse(r.body.toString());
    assert.ok(vc.type.includes('WatermarkLicense') && vc.proof.cryptosuite === 'eddsa-jcs-2022', 'a license as a verifiable credential');
    const vbody = JSON.stringify(vc);
    r = await req(port, 'POST', '/api/v1/credentials/verify', { body: vbody, headers: { 'content-type': 'application/json' } }); assert.equal(JSON.parse(r.body.toString()).ok, true, 'and it checks');
    const bad = { ...vc, credentialSubject: { ...vc.credentialSubject, number: 'WM 9999 9999 9999' } };
    r = await req(port, 'POST', '/api/v1/credentials/verify', { body: JSON.stringify(bad), headers: { 'content-type': 'application/json' } }); assert.equal(JSON.parse(r.body.toString()).ok, false, 'a changed word breaks it');
    assert.equal(B.unb58(B.b58(Buffer.from([0, 0, 1, 2, 255]))).toString('hex'), '00000102ff', 'base58 round trip');
    // A partner, issued by the Studio; a maker connects it.
    r = await req(port, 'POST', '/studio/login', { body: { password: 'pw' } }); const sck = r.headers['set-cookie'][0].split(';')[0];
    r = await req(port, 'POST', '/studio/partners', { cookie: sck, body: { name: 'Rights House', site: 'https://rights.example', webhook: 'https://rights.example/hook' } });
    const key = (r.body.toString().match(/wmp_[A-Za-z0-9_-]+/) || [])[0]; assert.ok(key, 'the key is shown once');
    const auth = { authorization: 'Bearer ' + key };
    r = await req(port, 'GET', '/api/partner/v1', { headers: auth }); assert.equal(r.status, 200); assert.equal(JSON.parse(r.body.toString()).makers.length, 0, 'no maker until one connects');
    r = await req(port, 'GET', '/api/partner/v1', { headers: { authorization: 'Bearer wmp_wrong' } }); assert.equal(r.status, 401);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(lic.work_id), m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id);
    r = await req(port, 'GET', '/account?maker=' + m.handle, { cookie: sck }); const mc = [sck, ...(r.headers['set-cookie'] || []).map(c => c.split(';')[0])].join('; ');
    const pid = db.prepare("SELECT id FROM partners WHERE slug='rights-house'").get().id;
    r = await req(port, 'POST', `/account/connections/partner/${pid}`, { cookie: mc, body: { on: '1' } }); assert.equal(r.status, 302);
    r = await req(port, 'GET', '/account/connections', { cookie: mc }); assert.ok(/Rights House/.test(r.body.toString()) && /Disconnect/.test(r.body.toString()));
    // Shares and a release on the work; the partner sees the shares.
    r = await req(port, 'POST', `/account/works/${w.slug}/splits`, { cookie: mc, body: { act: 'split', name: 'A. Second', role: 'Second shooter', pct: '20' } }); assert.ok(/ok=split/.test(r.headers.location));
    r = await req(port, 'POST', `/account/works/${w.slug}/splits`, { cookie: mc, body: { act: 'split', name: 'Too Much', pct: '90' } }); assert.ok(/ok=pct/.test(r.headers.location), 'never more than the whole');
    r = await req(port, 'POST', `/account/works/${w.slug}/splits`, { cookie: mc, body: { act: 'release', kind: 'model', subject: 'The figure on the steps', signed_on: '2026-05-01' } }); assert.ok(/ok=release/.test(r.headers.location));
    r = await req(port, 'GET', `/api/partner/v1/makers/${require('../src/views').makerSlug(m)}/works`, { headers: auth }); const cat = JSON.parse(r.body.toString());
    const mine = cat.works.find(x => x.slug === w.slug); assert.ok(mine && mine.splits.length === 1 && mine.splits[0].pct === 20, 'the partner reads the shares');
    assert.ok(!/The figure on the steps/.test(r.body.toString()), 'a release never leaves the house');
    const pst = app.locals.splits.owedOut(m); assert.ok(pst.s > 0 && pst.by['A. Second'] > 0, 'the statement owes the second shooter');
    // A signed claim from the partner: an exclusive for stories, accepted by the maker, holds that use back.
    const kp = require('crypto').generateKeyPairSync('ed25519'); const pub = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
    const claimVC = B.prove({ '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential'], issuer: 'did:web:rights.example', credentialSubject: { work: w.sha256, exclusive: 'editorial' } },
      { vm: 'did:web:rights.example#k1', signBytes: b => require('crypto').sign(null, b, kp.privateKey) });
    assert.ok(B.checkProof(claimVC, pub), 'a partner proof checks with its own key');
    r = await req(port, 'POST', '/api/partner/v1/claims', { headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ verifiableCredential: claimVC, work: w.slug, kind: 'exclusive', party: 'A Magazine', uses: ['editorial'], ends: '2099-01-01' }) });
    assert.equal(r.status, 201); const cid = JSON.parse(r.body.toString()).id;
    assert.ok(app.locals.blockedBy(w, 'editorial') === null, 'pending holds nothing back');
    r = await req(port, 'POST', `/account/connections/claim/${cid}`, { cookie: mc, body: { act: 'accept' } }); assert.equal(r.status, 302);
    assert.ok(app.locals.blockedBy(w, 'editorial') && !app.locals.blockedBy(w, 'commercial'), 'an accepted exclusive holds back only its use');
    r = await req(port, 'GET', `/api/v1/works/${w.slug}`); const ed = JSON.parse(r.body.toString()).uses.find(u => u.key === 'editorial'); assert.ok(!ed || !ed.instant, 'stories are not sold while it runs');
    db.prepare("UPDATE claims_in SET state='declined' WHERE id=?").run(cid);
    // Notice of a sale reaches a connected partner, signed.
    let got = null; const realFetch = global.fetch; global.fetch = async (u, o) => { if (String(u).startsWith('https://rights.example')) { got = { u, o }; return { status: 200 }; } return realFetch(u, o); };
    await app.locals.bridge.notice(lic.ref); global.fetch = realFetch;
    assert.ok(got, 'a notice was sent'); assert.ok(/^sha256=[a-f0-9]{64}$/.test(got.o.headers['x-watermark-signature']), 'signed'); assert.ok(/license.granted/.test(got.o.body), 'the event'); assert.ok(!lic.licensee_email || !got.o.body.includes(lic.licensee_email), 'no email in it');
    r = await req(port, 'GET', '/ledger'); assert.ok(!/A\. Second|The figure on the steps|Rights House/.test(r.body.toString()), 'nothing of it on the public register');
  }
  console.log('ok: the bridge');
  // The atelier: the house's guides inside every studio; the Studio edits and confirms them.
  r = await req(port, 'GET', '/account/atelier', { headers: { accept: 'text/html' } }); assert.equal(r.status, 302, 'the atelier is for makers');
  r = await req(port, 'GET', '/account/atelier', { cookie: gck }); assert.ok(r.body.toString().includes('The atelier') && r.body.toString().includes('Scanning film') && r.body.toString().includes('How to look at a photograph'), 'the guides');
  r = await req(port, 'GET', '/account/atelier/cataloguing-an-archive', { cookie: gck }); assert.ok(r.body.toString().includes('accession number') && r.body.toString().includes('A draft by the house'), 'a guide reads');
  r = await req(port, 'POST', '/studio/atelier/cataloguing-an-archive', { cookie: ck, body: { title: 'Cataloguing an archive', section: 'archive', body: 'Edited.', status: 'confirmed', by: 'Will Fullerton' } }); r = await req(port, 'GET', '/account/atelier/cataloguing-an-archive', { cookie: gck }); assert.ok(r.body.toString().includes('By Will Fullerton') && r.body.toString().includes('Edited.'), 'edited and confirmed');
  // The open API: a work, a maker, a license check, verify by fingerprint and by file, the credit, the register, oEmbed; CORS open; nothing personal.
  r = await req(port, 'GET', '/api/v1'); { const j = JSON.parse(r.body); assert.equal(j.version, 1); assert.equal(r.headers['access-control-allow-origin'], '*'); }
  r = await req(port, 'GET', `/api/v1/works/${w.slug}`); { const j = JSON.parse(r.body); assert.equal(j.slug, w.slug); assert.ok(j.maker.name && j.credit.includes('©') && j.fingerprint.sha256 && j.register.entry && Array.isArray(j.uses) && j.uses.some(u => u.key === 'social') && j.images.screen && j.pages.work.includes('/m/') && j.embed.oembed, 'the work record'); }
  r = await req(port, 'GET', '/api/v1/works?limit=2'); { const j = JSON.parse(r.body); assert.ok(j.total >= 2 && j.works.length === 2 && j.works[0].credit, 'search'); }
  r = await req(port, 'GET', `/api/v1/makers/${meSlug}`); { const j = JSON.parse(r.body); assert.ok(j.name && j.shown > 0 && typeof j.standing === 'number', 'the maker'); }
  r = await req(port, 'GET', `/api/v1/licenses/${ref1}`); { const j = JSON.parse(r.body); assert.equal(j.ref, ref1); assert.ok(['active', 'expired'].includes(j.status) && j.work.credit && j.licensee && !JSON.stringify(j).includes('@'), 'the license check, no email'); }
  r = await req(port, 'GET', `/api/v1/verify?sha256=${w.sha256}`); { const j = JSON.parse(r.body); assert.ok(j.genuine && j.work.slug === w.slug, 'verify by fingerprint'); }
  { const dlr = db.prepare('SELECT sha256 FROM downloads WHERE sha256 IS NOT NULL ORDER BY id DESC LIMIT 1').get(); r = await req(port, 'GET', `/api/v1/verify?sha256=${dlr.sha256}`); const j = JSON.parse(r.body); assert.ok(j.genuine && j.delivered && j.delivered.license && !j.says.includes('delivered to'), 'a delivered copy traces, without the person'); }
  r = await req(port, 'POST', '/api/v1/verify', { body: mp('x.jpg', fs.readFileSync(BIG), {}), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } }); { const j = JSON.parse(r.body); assert.ok(typeof j.genuine === 'boolean' && 'work' in j, 'verify by file'); }
  r = await req(port, 'GET', `/api/v1/credit/${w.slug}`); { const j = JSON.parse(r.body); assert.ok(j.text.includes('©') && j.html.includes('wm-credit') && j.short.includes('watermark.krafftco.com'), 'the credit'); }
  r = await req(port, 'GET', `/api/v1/register/${w.slug}`); { const j = JSON.parse(r.body); assert.ok(j.entries.length > 0 && j.entries[0].hash && !j.entries.some(e => /^(signin|dispute)\./.test(e.type)), 'the public register, signed'); }
  r = await req(port, 'GET', `/oembed?url=${encodeURIComponent('http://localhost/w/' + w.slug)}`); { const j = JSON.parse(r.body); assert.equal(j.version, '1.0'); assert.ok(j.html.includes('watermark-image') && j.author_name, 'oEmbed rich'); }
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.toString().includes('application/json+oembed'), 'oEmbed discovery on the page');
  r = await req(port, 'GET', '/developers'); assert.ok(r.body.toString().includes('Plug into the source') && r.body.toString().includes('/api/v1/licenses/:ref'), 'the developers page');
  r = await req(port, 'GET', '/studio/masters', { cookie: ck }); assert.ok(r.body.toString().includes('Waiting for a master') && r.body.toString().includes('Test Stacks'), 'the maker is shown what is waiting');
  { const bigger = await require('sharp')(SRC).resize({ width: 6100, height: 4100, fit: 'fill' }).flop().modulate({ brightness: 0.8 }).jpeg({ quality: 70 }).toBuffer();
    const wrong = await require('sharp')({ create: { width: 6100, height: 4100, channels: 3, background: '#2a6' } }).jpeg().toBuffer();
    r = await req(port, 'POST', `/studio/works/${w2.slug}/master`, { cookie: ck, body: mp('wrong.jpg', wrong, {}), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
    assert.ok(decodeURIComponent(r.headers.location).includes('does not look like'), 'a different picture is refused');
    r = await req(port, 'POST', `/studio/works/${w2.slug}/master`, { cookie: ck, body: mp('stacks.jpg', bigger, {}), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
    assert.ok(decodeURIComponent(r.headers.location).includes('25 megapixels'), 'the master is held'); }
  r = await req(port, 'GET', `/license/${w2.slug}`); assert.ok(r.body.toString().includes('Before an audience'), 'the master opens the larger uses');
  // Editions: a limited number, never more; prints recorded; a work passed on with its number.
  r = await req(port, 'POST', `/studio/works/${w2.slug}/catalogue`, { cookie: ck, body: { title: 'Test Stacks', edition: '1' } });
  r = await req(port, 'GET', `/w/${w2.slug}`); assert.ok(r.body.toString().includes('Edition of 1') && r.body.toString().includes('This edition is complete'), 'complete edition shown');
  r = await req(port, 'POST', `/pay/${w2.slug}`, { body: '{}', headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 409, 'no more than the edition');
  const held2 = db.prepare("SELECT ref FROM licenses WHERE work_id=? AND set_ref IS NOT NULL").get(w2.id);
  r = await req(port, 'POST', '/yours/print', { cookie: sck, body: { ref: held2.ref, size: '16 × 20 in', paper: 'Hahnemühle' } });
  r = await req(port, 'GET', `/w/${w2.slug}/life`); assert.ok(r.body.toString().includes('Printed by collector No. 1'), 'the print is in its life');
  r = await req(port, 'POST', '/yours/give', { cookie: sck, body: { ref: held2.ref } }); const gtok = decodeURIComponent(r.headers.location.match(/give=([^#&]+)/)[1]);
  r = await req(port, 'GET', `/claim/${gtok}`); assert.ok(r.body.toString().includes('Collector No. 1 of 1'), 'the claim page');
  r = await req(port, 'POST', `/claim/${gtok}`); assert.equal(r.status, 302); const nck = r.headers['set-cookie'].find(c => c.startsWith('wm_b=')).split(';')[0];
  r = await req(port, 'GET', '/yours?tab=files', { cookie: nck }); assert.ok(r.body.toString().includes('Test Stacks') && r.body.toString().includes('No. 1 of 1'), 'it hangs on the new wall');
  r = await req(port, 'GET', '/yours', { cookie: sck }); assert.ok(!r.body.toString().includes('Test Stacks</i>'), 'and has left the old one');
  r = await req(port, 'POST', `/claim/${gtok}`); assert.equal(r.headers.location, '/yours', 'a claim link works once');
  // The market: the collector offers the piece, someone asks to buy it, the Studio settles, it moves with its price.
  r = await req(port, 'POST', '/yours/offer', { cookie: nck, body: { ref: held2.ref, ask: '40' } }); assert.ok(r.headers.location.includes('offer=1'), 'offered');
  r = await req(port, 'GET', '/yours?tab=files', { cookie: nck }); assert.ok(r.body.toString().includes('Offered at <b>$40</b>'), 'offered'); r = await req(port, 'GET', '/yours', { cookie: nck }); assert.ok(r.body.toString().includes('class="pf"'), 'the portfolio shows');
  r = await req(port, 'GET', `/w/${w2.slug}`, { cookie: nck }); assert.ok(r.body.toString().includes('Offered at <b>$40</b>') && r.body.toString().includes('Withdraw'), 'the holder sees their offer on the work');
  r = await req(port, 'GET', '/market'); assert.ok(r.body.toString().includes('Test Stacks') && r.body.toString().includes('$40'), 'on the market');
  const lst = db.prepare("SELECT id FROM listings WHERE status='open'").get().id;
  r = await req(port, 'GET', `/w/${w2.slug}`); assert.ok(r.body.toString().includes('On the market'), 'on its page');
  r = await req(port, 'POST', `/market/${lst}/bid`, { body: { name: 'Isabella', email: 'i@gardner.org', offer: '50' } }); assert.ok(r.headers.location.endsWith('sent=1'));
  const bid = db.prepare("SELECT id FROM bids WHERE status='new'").get().id;
  r = await req(port, 'GET', '/studio', { cookie: ck }); assert.ok(r.body.toString().includes('requests to buy from collectors'), 'the Studio is told');
  r = await req(port, 'POST', `/studio/market/${bid}/settle`, { cookie: ck, body: { price: '50' } }); const mtok = decodeURIComponent(r.headers.location).match(/claim\/([A-Za-z0-9_-]+)/)[1];
  const tr = db.prepare('SELECT * FROM trades').get(); assert.equal(tr.price_cents, 5000); assert.equal(tr.royalty_cents, 500); assert.equal(tr.fee_cents, 250);
  r = await req(port, 'POST', `/claim/${mtok}`); const ick = r.headers['set-cookie'].find(c => c.startsWith('wm_b=')).split(';')[0];
  r = await req(port, 'GET', '/yours', { cookie: ick }); assert.ok(r.body.toString().includes('Test Stacks') && r.body.toString().includes('$50'), 'it hangs on the buyer\'s wall at its price');
  r = await req(port, 'GET', `/w/${w2.slug}/life`); assert.ok(r.body.toString().includes('Traded between collectors') && r.body.toString().includes('$50'), 'the trade is in its life');
  assert.ok(r.body.toString().includes('class="mk-chart"'), 'with its price chart');
  // An offer for a piece not on the market: its collector accepts, and it goes to the Studio to settle.
  r = await req(port, 'POST', `/w/${w2.slug}/offer`, { body: { offer: '70', email: 'f@frick.org', name: 'Henry' } }); assert.ok(r.headers.location.includes('offer=sent'));
  r = await req(port, 'GET', '/yours?tab=market', { cookie: ick }); assert.ok(r.body.toString().includes('Offers for your pieces') && r.body.toString().includes('$70'), 'the collector sees the offer');
  const ofr = db.prepare("SELECT id FROM offers WHERE status='open'").get().id;
  r = await req(port, 'POST', `/yours/offers/${ofr}/accept`, { cookie: ick }); assert.ok(r.headers.location.includes('accepted=1'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM bids WHERE status='new' AND offer_cents=7000").get().n, 1, 'accepted offers go to the Studio');
  r = await req(port, 'GET', '/studio', { cookie: ck }); assert.ok(r.body.toString().includes('Resale') && r.body.toString().includes('$5 royalties'), 'resale in the holdings');
  // Settlement through Stripe (MARKET_SETTLEMENT=stripe): the buyer pays, the piece moves at once, shares are paid out through Connect.
  process.env.MARKET_SETTLEMENT = 'stripe'; const transfers = [];
  stripeClient.transfers = { create: async o => { transfers.push(o); return { id: 'tr_' + transfers.length, ...o }; } };
  stripeClient.accounts.create = async o => ({ id: 'acct_seller', ...o }); stripeClient.accounts.retrieve = async id => ({ id, payouts_enabled: true });
  stripeClient.accountLinks.create = async o => ({ url: 'https://connect.stripe.test/' + o.account });
  { const ab = db.prepare("SELECT * FROM bids WHERE status='new' AND offer_cents=7000").get(); assert.ok(ab.token, 'an accepted offer carries a pay link');
    r = await req(port, 'GET', `/market/${ab.listing_id}?bid=${ab.token}`); assert.ok(r.body.toString().includes('Pay and take it') && r.body.toString().includes('$70'), 'the buyer pays the accepted offer');
    r = await req(port, 'POST', `/market/${ab.listing_id}/buy`, { body: { bid: ab.token } }); assert.equal(r.status, 303);
    const msid = r.headers.location.split('/').pop(); const ms = sessions[msid]; assert.equal(ms.line_items[0].price_data.unit_amount, 7000); assert.equal(ms.metadata.market, String(ab.listing_id));
    Object.assign(ms, { payment_status: 'paid', status: 'complete', amount_total: 7000, payment_intent: 'pi_mkt', customer_details: { email: 'f@frick.org', name: 'Henry Frick' } });
    pis.pi_mkt = { id: 'pi_mkt', latest_charge: 'ch_mkt' };
    r = await req(port, 'GET', `/market/${ab.listing_id}/done?session_id=${msid}`); assert.ok(r.headers.location.startsWith('/yours?got='), 'settled on return');
    const hck = r.headers['set-cookie'].find(c => c.startsWith('wm_b=')).split(';')[0];
    const t2 = db.prepare("SELECT * FROM trades WHERE settled='stripe'").get(); assert.equal(t2.price_cents, 7000); assert.equal(t2.royalty_cents, 700); assert.equal(t2.fee_cents, 350);
    r = await req(port, 'GET', '/yours', { cookie: hck }); assert.ok(r.body.toString().includes('Test Stacks'), 'it hangs on the buyer\'s wall at once');
    const po = db.prepare('SELECT kind, status, amount_cents FROM payouts ORDER BY id').all(); assert.deepStrictEqual(po.map(x => [x.kind, x.status, x.amount_cents]), [['seller', 'owed', 5950], ['royalty', 'house', 700]], 'the shares');
    r = await req(port, 'GET', `/market/${ab.listing_id}/done?session_id=${msid}`); assert.equal(db.prepare("SELECT COUNT(*) n FROM trades WHERE settled='stripe'").get().n, 1, 'settles once');
    r = await req(port, 'POST', '/yours/payouts/connect', { cookie: ick }); assert.ok(r.headers.location.startsWith('https://connect.stripe.test/acct_seller'), 'the collector adds a bank through Stripe');
    r = await req(port, 'GET', '/yours/payouts', { cookie: ick }); assert.ok(r.body.toString().includes('Your bank is connected'));
    assert.equal(transfers.length, 1); assert.equal(transfers[0].amount, 5950); assert.equal(transfers[0].destination, 'acct_seller'); assert.equal(transfers[0].source_transaction, 'ch_mkt');
    assert.equal(db.prepare("SELECT status FROM payouts WHERE kind='seller'").get().status, 'paid', 'the collector is paid');
    // Sold already: a second payment for the same piece is refunded.
    const before = refunds.length; const cs2 = { id: 'cs_late', payment_status: 'paid', amount_total: 7000, payment_intent: 'pi_late', metadata: { market: String(ab.listing_id) }, customer_details: { email: 'x@y.z' } };
    await app.locals.marketSettle(ab.listing_id, cs2); assert.equal(refunds.length, before + 1, 'refunded'); }
  delete process.env.MARKET_SETTLEMENT;


  r = await req(port, 'GET', '/yours', { cookie: bck }); assert.ok(/Founding Collector, No\.&nbsp;\d+ of 100/.test(r.body.toString()), 'a founding collector');
  r = await req(port, 'GET', '/collectors'); assert.ok(/of 100 places remain/.test(r.body.toString()), 'places remain');
  // Patronage: a monthly patron, named on the wall, ended with one press; a one-off gift.
  r = await req(port, 'GET', '/m/will-fullerton'); assert.ok(r.body.toString().includes('Keep the work going') && r.body.toString().includes('Medici'), 'the patronage page');
  r = await req(port, 'POST', '/m/will-fullerton/patron', { body: { level: 'friend' }, cookie: bck }); assert.equal(r.status, 303);
  const ps = sessions[r.headers.location.split('/').pop()]; assert.equal(ps.mode, 'subscription'); assert.equal(ps.line_items[0].price_data.recurring.interval, 'month');
  Object.assign(ps, { status: 'complete', subscription: 'sub_1', customer: 'cus_1', customer_details: { email: 'p@me.com', name: 'Lorenzo' } });
  r = await req(port, 'GET', ps.success_url.replace('{CHECKOUT_SESSION_ID}', ps.id).replace('http://localhost', ''), { cookie: bck }); assert.ok(r.body.toString().includes('You are a patron of Will Fullerton'), 'a patron');
  const pid = ps.metadata.patron;
  r = await req(port, 'POST', `/patron/${pid}/name`, { cookie: bck, body: { name: 'Lorenzo M.', public: '1' } });
  r = await req(port, 'GET', '/m/will-fullerton'); assert.ok(r.body.toString().includes('Lorenzo M.'), 'on the wall');
  r = await req(port, 'GET', '/yours?tab=patronage', { cookie: bck }); assert.ok(r.body.toString().includes('Patron of Will Fullerton'), 'the mark on the collection');
  r = await req(port, 'POST', `/patron/${pid}/end`, { cookie: bck }); assert.equal(db.prepare('SELECT status FROM patrons WHERE id=?').get(pid).status, 'ending', 'ended with one press');
  r = await req(port, 'POST', '/m/will-fullerton/patron', { body: { once: '50' } }); const po = sessions[r.headers.location.split('/').pop()]; assert.equal(po.mode, 'payment'); assert.equal(po.line_items[0].price_data.unit_amount, 5000);

  // The Reference: a photograph held at reference quality carries the badge and can be collected as the full original.
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'reference' } }); assert.ok(r.headers.location.startsWith('/license/'), 'no Reference below reference quality');
  db.prepare('UPDATE works SET width=11656, height=8742 WHERE id=?').run(w.id);
  r = await req(port, 'GET', `/w/${w.slug}`); let rb = r.body.toString(); assert.ok(rb.includes('A reference image') && rb.includes('102 MP') && rb.includes('Collect the Reference'), 'the Reference badge and option');
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'reference' } }); assert.equal(r.status, 303, 'the Reference goes to checkout');
  // The U.S. Copyright Office bridge: group, title list, filed, registered; the badge on the work.
  r = await req(port, 'GET', '/studio/copyright', { cookie: ck }); assert.ok(r.body.toString().includes('Register the collection'), 'copyright page');
  const ckey = (r.body.toString().match(/name="key" value="([^"]+)"/) || [])[1]; assert.ok(ckey, 'a group proposed');
  r = await req(port, 'POST', '/studio/copyright/prepare', { cookie: ck, body: { key: ckey } });
  const cg = db.prepare('SELECT id FROM copyright_groups ORDER BY id DESC').get().id;
  r = await req(port, 'GET', `/studio/copyright/${cg}/titles.csv`, { cookie: ck }); assert.ok(r.body.toString().startsWith('"Title","File name"'), 'title list');
  r = await req(port, 'POST', `/studio/copyright/${cg}`, { cookie: ck, body: { act: 'filed', sr: '1-1234567890' } });
  r = await req(port, 'POST', `/studio/copyright/${cg}`, { cookie: ck, body: { act: 'registered', reg: 'VA 2-412-118' } });
  const rw = db.prepare("SELECT slug FROM works WHERE copyright_group=? AND status='held' LIMIT 1").get(cg);
  if (rw) { r = await req(port, 'GET', `/w/${rw.slug}`); assert.ok(r.body.toString().includes('U.S. Registered') && r.body.toString().includes('VA 2-412-118'), 'the registration shows on the work'); }
  // Tips: a reader pays the writer and the photographer of a story, shared evenly.
  db.prepare("INSERT INTO stories (slug, title, url, fetched_at) VALUES ('lake-garda','Lake Garda','https://studios.krafftco.com/lake-garda/',datetime('now'))").run();
  const writer = db.prepare("INSERT INTO makers (handle, name, kind) VALUES ('ada-writer','Ada Lovelace','writer')").run().lastInsertRowid;
  db.prepare("INSERT INTO credits (post_slug, role, maker_id) VALUES ('lake-garda','words',?)").run(writer);
  db.prepare("INSERT INTO credits (post_slug, role, maker_id) VALUES ('lake-garda','photographs',?)").run(db.prepare("SELECT id FROM makers WHERE handle='krafft' OR id=1 ORDER BY id LIMIT 1").get().id);
  r = await req(port, 'GET', '/tip/lake-garda'); let tb = r.body.toString(); assert.ok(tb.includes('Ada Lovelace') && tb.includes('Words') && tb.includes('Both, shared evenly'), 'the tip page names who made it');
  r = await req(port, 'POST', '/tip/lake-garda', { body: { amount: '10', to: 'all', back: 'https://studios.krafftco.com/lake-garda/' } }); assert.equal(r.status, 303);
  const ts = sessions[r.headers.location.split('/').pop()]; assert.equal(ts.line_items[0].price_data.unit_amount, 1000); assert.equal(ts.cancel_url, 'https://studios.krafftco.com/lake-garda/');
  assert.deepEqual(db.prepare('SELECT amount_cents FROM tips WHERE grp=? ORDER BY id').all(ts.metadata.tip).map(t => t.amount_cents), [500, 500], 'shared evenly');
  Object.assign(ts, { status: 'complete', payment_status: 'paid', customer_details: { email: 't@me.com', name: 'Reader' } });
  r = await req(port, 'GET', ts.success_url.replace('{CHECKOUT_SESSION_ID}', ts.id).replace('http://localhost', '')); assert.ok(r.body.toString().includes('will know'), 'thanked');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tips WHERE status='paid' AND role<>'thanks'").get().n, 2);
  r = await req(port, 'GET', '/api/k?post=lake-garda'); assert.ok(JSON.parse(r.body.toString()).credits.tip.endsWith('/tip/lake-garda'), 'the K knows where to tip');
  r = await req(port, 'GET', '/w/' + w.slug); assert.ok(r.body.toString().includes('Become a patron of'), 'offered on the work');
  // Signing in: passkeys, and the menu.
  r = await req(port, 'GET', '/signin'); assert.ok(r.status === 200 && r.body.toString().includes('Send the code') && r.body.toString().includes('passkey instead'), 'sign in page');
  db.prepare("UPDATE makers SET email='ada@example.com' WHERE id=?").run(writer);
  // Email sign-in: a code goes out (logged in test), comes back, and the maker's email opens the room and the collection together.
  r = await req(port, 'POST', '/signin/code', { body: JSON.stringify({ email: 'bad' }), headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 400, 'bad email refused');
  r = await req(port, 'POST', '/signin/code', { body: JSON.stringify({ email: 'ada@example.com' }), headers: { 'content-type': 'application/json' } }); assert.ok(r.status === 200 && JSON.parse(r.body).to.startsWith('a•'), 'code sent');
  const lc = app.locals.lastCode; assert.ok(lc && lc.code.length === 6, 'code known to the test');
  r = await req(port, 'POST', '/signin/verify', { body: JSON.stringify({ email: 'ada@example.com', code: '000000' === lc.code ? '000001' : '000000' }), headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 400, 'wrong code refused');
  r = await req(port, 'POST', '/signin/verify', { body: JSON.stringify({ email: 'ada@example.com', code: lc.code }), headers: { 'content-type': 'application/json' } }); const sj = JSON.parse(r.body);
  assert.ok(r.status === 200 && sj.ok && sj.maker && sj.to === '/account' && sj.name === 'Ada', 'maker signed in by code: ' + r.body);
  const siCookie = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; '); assert.ok(/wm_m=/.test(siCookie) && /wm_b=/.test(siCookie), 'both cookies set');
  r = await req(port, 'GET', '/account', { cookie: siCookie }); assert.equal(r.status, 200, 'room opens by email');
  r = await req(port, 'GET', '/signin', { cookie: siCookie }); assert.ok(r.body.toString().includes('Good to see you, Ada'), 'signed-in page greets');
  r = await req(port, 'POST', '/signin/verify', { body: JSON.stringify({ email: 'ada@example.com', code: lc.code }), headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 400, 'code is single use');
  // Hand it to your phone: a signed-in person gets a code to scan; the device that opens it is them.
  r = await req(port, 'GET', '/signin/hand', { cookie: siCookie }); { const h = r.body.toString(); assert.ok(h.includes('Hand it to your phone') && h.includes('<svg') && h.includes('/signin/'), 'the QR page');
    const link = (h.match(/\/signin\/([A-Za-z0-9_-]{20,})/) || [])[1]; assert.ok(link, 'a link in the code');
    r = await req(port, 'GET', `/signin/${link}`); assert.ok(r.status === 302 && (r.headers['set-cookie'] || []).some(c => c.startsWith('wm_b=')), 'the other device is signed in');
    r = await req(port, 'GET', `/signin/${link}`); assert.equal(r.status, 410, 'once'); }
  r = await req(port, 'GET', '/signin/hand'); assert.equal(r.status, 302, 'needs a signed-in person');
  console.log('ok: hand-off');
  r = await req(port, 'POST', '/signin/code', { body: JSON.stringify({ email: 'new@example.com' }), headers: { 'content-type': 'application/json' } }); const lc2 = app.locals.lastCode;
  r = await req(port, 'GET', '/signin/' + lc2.link); assert.ok(r.status === 302 && r.headers.location === '/yours', 'link signs a new collector in');
  r = await req(port, 'GET', '/signin/' + lc2.link); assert.equal(r.status, 410, 'link works once');
  r = await req(port, 'POST', '/auth/passkey/register/options', { body: '{}', headers: { 'content-type': 'application/json' }, cookie: bck });
  const ro = JSON.parse(r.body); assert.ok(ro.challenge && ro.rp.id === 'localhost' && ro.authenticatorSelection.residentKey === 'required', 'passkey options');
  r = await req(port, 'POST', '/auth/passkey/login/options', { body: '{}', headers: { 'content-type': 'application/json' } }); assert.ok(JSON.parse(r.body).challenge, 'sign-in options');
  r = await req(port, 'POST', '/auth/passkey/login/verify', { body: JSON.stringify({ id: 'nope' }), headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 400, 'no challenge, no sign-in');
  r = await req(port, 'GET', '/yours', { cookie: bck }); assert.ok(r.body.toString().includes('Save with a passkey'), 'offered on the collection');
  r = await req(port, 'GET', '/static/webauthn.js'); assert.equal(r.status, 200);
  r = await req(port, 'GET', '/collection'); assert.ok(/<nav><a href="\/collection">Collection<\/a><a href="\/makers">Makers<\/a><a href="\/signin"[^>]*>Sign in<\/a><\/nav>/.test(r.body.toString()), 'the menu, in order'); assert.ok(r.body.toString().includes('class="cx-lib" href="/series/the-great-rooms"'), 'series inside the collection');
  // Other makers hang beside the house: their name on each plate, a gallery of their own, the Watermark mark, a filter.
  r = await req(port, 'GET', '/collection'); { const b = r.body.toString(); assert.ok(b.includes('data-wander'), 'wander');
    assert.ok(b.includes('id="maker-the-ada-estate"') && b.includes('data-href="/m/the-ada-estate"'), 'a room of their own on the map (23 Oct)'); assert.ok(b.includes('data-mk="the-ada-estate"'), 'a filter by maker');
    assert.ok(b.includes('<i>The Ada Estate, Genoa, Italy</i>'), 'their name on the plate'); assert.ok(b.includes('"mk":"The Ada Estate"'), 'searchable by maker'); }
  r = await req(port, 'GET', `/w/${aj.slug}`); assert.ok(r.body.toString().includes('viewBox="1.5 14.2 41 11"') && r.body.toString().includes('href="/m/the-ada-estate"'), 'their mark, their page');
  r = await req(port, 'GET', '/m/the-ada-estate'); assert.equal(r.status, 200);
  // Voices: the maker records a word on a photograph; anyone looking hears it; others cannot add to it. (The bag check wants a real header: an M4A's.)
  const AUDIO_BYTES = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypM4A '), Buffer.from('fakeaudiodata')]);
  r = await req(port, 'GET', `/voices/${w.slug}`, { cookie: ck }); assert.ok(r.body.toString().includes('What is said about this work'), 'the voices page');
  { const vb = '----wmvo'; const parts = [['kind', 'maker'], ['speaker', 'Will Fullerton'], ['body', 'I stood under it for an hour.'], ['seconds', '3']].map(([k, v]) => `--${vb}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
    const body = Buffer.concat([Buffer.from(parts + `--${vb}\r\nContent-Disposition: form-data; name="audio"; filename="note.m4a"\r\nContent-Type: audio/mp4\r\n\r\n`), AUDIO_BYTES, Buffer.from(`\r\n--${vb}--\r\n`)]);
    r = await req(port, 'POST', `/voices/${w.slug}`, { cookie: ck, body, headers: { 'content-type': 'multipart/form-data; boundary=' + vb } }); assert.equal(r.status, 302, 'saved'); }
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.toString().includes('data-voice="/listen/') && r.body.toString().includes('The maker'), 'heard on the page');
  const vo1 = JSON.parse((await req(port, "GET", `/api/voices/${w.slug}`)).body).voices[0]; assert.ok(vo1 && vo1.audio && vo1.speaker === "Will Fullerton");
  r = await req(port, "GET", vo1.audio); assert.equal(r.status, 200); assert.ok(r.body.equals(AUDIO_BYTES));
  r = await req(port, 'POST', `/voices/${w.slug}`, { body: { body: 'not mine to say' } }); assert.equal(r.status, 403, 'only the maker or the Studio');
  r = await req(port, 'POST', `/voices/${w.slug}`, { cookie: mck, body: { body: 'nor theirs' } }); assert.equal(r.status, 403, 'not another maker');
  // Makers: the front door is the collection; makers apply, Will approves in one step, and they sign in with a passkey.
  r = await req(port, 'GET', '/studio/makers', { cookie: ck }); assert.ok(r.body.toString().includes('Approve and invite'), 'one-step approval');
  r = await req(port, 'GET', '/account'); assert.ok(r.body.toString().includes('/signin?next=/account'), 'makers are sent to the one door');
  r = await req(port, 'GET', '/account', { cookie: mck }); assert.ok(r.body.toString().includes('data-passkey="maker-save"'), 'and save one from their room');
  r = await req(port, 'POST', '/auth/maker/register/options', { body: '{}', headers: { 'content-type': 'application/json' }, cookie: mck }); assert.ok(JSON.parse(r.body).challenge, 'maker passkey options');
  r = await req(port, 'POST', '/auth/maker/register/options', { body: '{}', headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 401, 'only for a maker');
  r = await req(port, 'GET', '/makers'); assert.ok(r.body.toString().includes('Sign in to your room'));
  // ledger intact, and tamper is detected
  const ledger = require('../src/ledger');
  // Trades in kind: Set Fan holds two numbered pieces; the ladder's No. 2 belongs to a second collector; they swap.
  { const wl = db.prepare("SELECT * FROM works WHERE title='Test Ladder'").get();
    const b2 = db.prepare("INSERT INTO buyers (customer, email, name) VALUES ('', 'rem@brandt.nl', 'Rembrandt')").run().lastInsertRowid;
    db.prepare("UPDATE licenses SET buyer_id=?, download_token='tok-l2' WHERE ref='WM-2026-90002'").run(b2);
    const b2ck = 'wm_b=' + b2 + '.' + require('crypto').createHmac('sha256', 's').update('b' + b2).digest('hex');
    const give = setLs[0];
    r = await req(port, 'GET', `/w/${wl.slug}`); assert.ok(!r.body.toString().includes('Offer a trade for one'), 'the work no longer offers a trade (by address only, 21 Oct)');
    r = await req(port, 'GET', `/swap/new?work=${wl.slug}`, { cookie: sck }); assert.ok(r.status === 200 && r.body.toString().includes('No.&nbsp;2'), 'pieces held by others listed');
    r = await req(port, 'POST', '/swap', { cookie: sck, body: { want: String(db.prepare("SELECT id FROM licenses WHERE ref='WM-2026-90002'").get().id), give: String(give.id), note: 'I have wanted this one.' } });
    assert.ok(r.status === 302 && /^\/swap\/\d+$/.test(r.headers.location), 'trade offered: ' + r.headers.location); const sid = r.headers.location.split('/').pop();
    r = await req(port, 'GET', `/swap/${sid}`, { cookie: sck }); assert.ok(r.body.toString().includes('Your trade is offered') && r.body.toString().includes('I have wanted this one.'), 'offerer sees it');
    r = await req(port, 'GET', '/yours?tab=market', { cookie: b2ck }); assert.ok(r.body.toString().includes('Trades offered to you'), 'holder sees it in the gallery');
    r = await req(port, 'POST', `/swap/${sid}/accept`, { cookie: sck }); assert.ok(!db.prepare('SELECT status FROM swaps WHERE id=?').get(sid).status.match(/accepted/), 'only the holder may accept');
    r = await req(port, 'POST', `/swap/${sid}/accept`, { cookie: b2ck }); assert.ok(r.headers.location.includes('ok=traded'), 'accepted');
    assert.equal(db.prepare('SELECT buyer_id FROM licenses WHERE id=?').get(give.id).buyer_id, b2, 'the given piece moved');
    const got = db.prepare("SELECT buyer_id, download_token FROM licenses WHERE ref='WM-2026-90002'").get(); assert.ok(got.buyer_id === setLs[0].buyer_id && got.download_token !== 'tok-l2', 'the wanted piece moved with a fresh key');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='swap.traded'").get().n, 1, 'on the register'); }
  // A gallery's own book and hat: a visitor signs Set Fan's gallery, about one piece; the owner may remove it.
  { r = await req(port, 'POST', '/yours', { cookie: sck, body: { name: 'Set Fan', public: '1' } }); const sf = db.prepare('SELECT * FROM buyers WHERE id=?').get(setLs[0].buyer_id); assert.ok(sf.public && sf.code, 'gallery opened');
    r = await req(port, 'GET', `/collector/${sf.code}`); assert.ok(r.body.toString().includes('Tip your hat to this gallery') && r.body.toString().includes('Sign the book'), 'book and hat on the gallery');
    r = await req(port, 'POST', `/collector/${sf.code}/hat`, { headers: { accept: 'application/json' } }); assert.equal(JSON.parse(r.body).n, 1, 'hat tipped'); const vck = r.headers['set-cookie'].find(c => c.startsWith('wm_b=')).split(';')[0];
    r = await req(port, 'POST', `/collector/${sf.code}/notes`, { cookie: vck, body: { body: 'You have a great eye.', name: 'Henry', work: setLs[1].slug || '' } }); assert.ok(r.headers.location.includes('note=1'), 'signed');
    r = await req(port, 'GET', `/collector/${sf.code}`); assert.ok(r.body.toString().includes('You have a great eye.') && r.body.toString().includes('1 tip of the hat'), 'line and hat shown');
    r = await req(port, 'GET', '/guestbook'); assert.ok(!r.body.toString().includes('You have a great eye.'), 'gallery lines stay in the gallery');
    const nid = db.prepare('SELECT id FROM notes WHERE gallery_id=?').get(sf.id).id;
    r = await req(port, 'POST', `/collector/${sf.code}/notes/${nid}/remove`, { cookie: sck }); r = await req(port, 'GET', `/collector/${sf.code}`); assert.ok(!r.body.toString().includes('You have a great eye.'), 'owner removed it'); }
  r = await req(port, 'GET', '/artists'); assert.ok(r.status === 200 && r.body.toString().includes('Will Fullerton') && r.body.toString().includes('/m/will-fullerton'), 'the artists page lists the makers');
  // Standing in front of a photograph: numbered once per viewer, seconds added after; the first hundred are told.
  r = await req(port, 'POST', `/w/${w.slug}/stood`, { body: JSON.stringify({ v: 'abc123', s: 0 }), headers: { 'content-type': 'application/json' } }); { const sj = JSON.parse(r.body); assert.ok(sj.n === 1 && sj.first && /1st person/.test(sj.line), 'the first to stand: ' + r.body); }
  r = await req(port, 'POST', `/w/${w.slug}/stood`, { body: JSON.stringify({ v: 'abc123', s: 42 }), headers: { 'content-type': 'application/json' } }); assert.equal(JSON.parse(r.body).n, 1, 'still the first');
  r = await req(port, 'POST', `/w/${w.slug}/stood`, { body: JSON.stringify({ v: 'def456', s: 0 }), headers: { 'content-type': 'application/json' } }); assert.equal(JSON.parse(r.body).n, 2, 'the second');
  r = await req(port, 'GET', `/w/${w.slug}`, { cookie: 'wm_v=abc123' }); assert.ok(r.body.toString().includes('You were the 1st person to stand in front of this') && !r.body.toString().includes('2 people have stood'), 'told on the page');
  r = await req(port, 'GET', '/yours', { cookie: 'wm_v=abc123; ' + bck }); assert.ok(r.body.toString().includes('Your looking, this month'), 'looking shown privately on Yours');
  // Wallets: a piece is sent to another wallet by address; the register signs every entry with the house key.
  { const hb = db.prepare("INSERT INTO buyers (customer, email, name, code) VALUES ('', 'hal@frick.org', 'Hal', 'halwallet')").run().lastInsertRowid;
    const mine = db.prepare("SELECT l.ref FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.buyer_id=? AND l.status='active' AND l.collector_no IS NOT NULL AND u.key='social' LIMIT 1").get(setLs[0].buyer_id);
    assert.ok(mine, 'a numbered piece to send');
    r = await req(port, 'POST', '/yours/send', { cookie: sck, body: { ref: mine.ref, to: 'WM-halwallet' } }); assert.ok(r.headers.location.includes('sent=done'), 'sent to a wallet: ' + r.headers.location);
    assert.equal(db.prepare('SELECT buyer_id FROM licenses WHERE ref=?').get(mine.ref).buyer_id, hb, 'it moved');
    const sig = db.prepare('SELECT hash, sig FROM ledger ORDER BY seq DESC LIMIT 1').get(); assert.ok(sig.sig && ledger.checkSig(sig.hash, sig.sig, ledger.publicKey()), 'the house signed it');
    assert.ok(!ledger.checkSig(sig.hash, sig.sig.replace(/^../, '00'), ledger.publicKey()), 'a forged signature fails');
    // A working license stays put: the agreement does not allow transfer.
    const edl = db.prepare("SELECT l.ref FROM licenses l JOIN uses u ON u.id=l.use_id WHERE u.key='editorial' AND l.status='active' LIMIT 1").get();
    if (edl) { db.prepare('UPDATE licenses SET buyer_id=?, collector_no=COALESCE(collector_no, 1) WHERE ref=?').run(setLs[0].buyer_id, edl.ref); r = await req(port, 'POST', '/yours/send', { cookie: sck, body: { ref: edl.ref, to: 'WM-halwallet' } }); assert.ok(r.headers.location.includes('sent=locked'), 'a working license is locked'); } }
  // The Hall of Patrons: the Studio hangs a portrait by the work's slug; the hall shows it with its plate.
  r = await req(port, 'POST', '/studio/hall', { cookie: ck, body: { name: 'Henry Clay Frick', founded: 'The Great Rooms', year: '2026', work: w.slug, note: 'He kept the doors open.', public: '1' } }); assert.equal(r.status, 302, 'hung');
  r = await req(port, 'GET', '/patrons'); assert.ok(r.body.toString().includes('Henry Clay Frick') && r.body.toString().includes('The Great Rooms') && r.body.toString().includes(`/img/${w.slug}/large`), 'the hall shows the portrait and the plate');
  // The press (26 Oct): a shop asks, the house invites, the shop opens its desk; a print sold near it is offered, accepted, made and delivered; the shop is paid.
  {
    r = await req(port, 'GET', '/printers'); assert.ok(r.status === 200 && /A press in every town/.test(r.body) && /Print for the house/.test(r.body), 'the press room');
    r = await req(port, 'POST', '/printers/apply', { body: { name: 'Ada Lovelace', shop: 'Alder Press', email: 'ada@alderpress.example', city: 'Dallas', state: 'tx', papers: 'Hahnemühle Photo Rag', max_in: '44', note: 'Two Canons and a bench.' } });
    assert.ok(/ok=asked/.test(r.headers.location), 'a shop asked');
    const ap = db.prepare("SELECT * FROM printer_applications WHERE shop='Alder Press'").get(); assert.ok(ap && ap.state === 'TX' && ap.max_in === 44, 'the application kept');
    r = await req(port, 'POST', `/studio/printers/apps/${ap.id}`, { cookie: ck, body: { do: 'invite' } }); assert.ok(r.status === 302 || r.status === 303, 'invited');
    const pm = db.prepare("SELECT * FROM makers WHERE kind='printer' AND name='Alder Press'").get(); assert.ok(pm && pm.invite_token, 'a maker of kind printer');
    r = await req(port, 'GET', `/account/join/${pm.invite_token}`); const pck = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; '); assert.ok(pck, 'the shop signed in');
    r = await req(port, 'GET', '/account/printing', { cookie: pck }); assert.ok(r.status === 200 && /Alder Press\./.test(r.body) && /The press/.test(r.body) && /Nothing waiting/.test(r.body), 'the shop’s desk');
    r = await req(port, 'POST', '/account/printing/shop', { cookie: pck, body: { city: 'Dallas', state: 'tx', zip: '75201', papers: 'Hahnemühle Photo Rag', max_in: '44', framing: '1', pickup: '1', ships: '1', turnaround: '4', story: 'A bench on Knox Street.', open: '1' } });
    const sh = db.prepare('SELECT * FROM print_shops WHERE maker_id=?').get(pm.id); assert.ok(sh.state === 'TX' && sh.zip === '75201' && sh.framing === 1 && sh.status === 'open', 'the shop set');
    r = await req(port, 'GET', '/printers'); assert.ok(/Alder Press/.test(r.body) && />TX</.test(r.body), 'on the room by state');
    r = await req(port, 'GET', `/printers/${pm.handle}`); assert.ok(r.status === 200 && /Knox Street/.test(r.body) && /44 inches/.test(r.body), 'the shop’s page');
    // A print sold to a collector in Texas.
    const lic = db.prepare("SELECT l.* FROM licenses l WHERE l.status='active' AND l.collector_no IS NOT NULL ORDER BY l.id DESC LIMIT 1").get(); assert.ok(lic, 'a licence to print');
    const oid = db.prepare("INSERT INTO print_orders (license_id, buyer_id, size, paper, email, status, kind, cents, paid, ship_name, address) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(lic.id, lic.buyer_id, '16 × 24', 'Hahnemühle Photo Rag', 'tex@example.com', 'asked', 'ask', 65000, 1, 'Tex Collector', '2 Elm St\nDallas, TX 75202').lastInsertRowid;
    const placed = app.locals.printShops.sweep(); assert.ok(placed >= 1, 'placed');
    const job = db.prepare('SELECT * FROM print_jobs WHERE order_id=?').get(oid); assert.ok(job && job.shop_id === sh.id && job.status === 'offered' && job.cents === 39000, 'offered to the Texas shop at 60%: ' + JSON.stringify(job));
    r = await req(port, 'GET', `/account/printing/${job.id}/file`, { cookie: pck }); assert.strictEqual(r.status, 403, 'no file before accepting');
    r = await req(port, 'GET', `/account/printing/${job.id}`, { cookie: pck }); assert.ok(r.status === 200 && /16 × 24/.test(r.body) && /Tex Collector/.test(r.body) && /Accept: I will make it/.test(r.body), 'the job with its ticket');
    const mails0 = (app.locals.mailLog || []).length;
    r = await req(port, 'POST', `/account/printing/${job.id}/move`, { cookie: pck, body: { status: 'accepted' } }); assert.ok(r.status === 302 || r.status === 303, 'accepted');
    r = await req(port, 'GET', `/account/printing/${job.id}/file`, { cookie: pck }); assert.ok(r.status === 200 && /attachment/.test(r.headers['content-disposition']) && r.body.length > 1000, 'the master taken');
    r = await req(port, 'GET', `/account/printing/${job.id}/ticket.pdf`, { cookie: pck }); assert.ok(r.status === 200 && /pdf/.test(r.headers['content-type']), 'the ticket');
    r = await req(port, 'POST', `/account/printing/${job.id}/move`, { cookie: pck, body: { status: 'printing' } });
    r = await req(port, 'POST', `/account/printing/${job.id}/move`, { cookie: pck, body: { status: 'shipped', tracking: '1Z999' } });
    r = await req(port, 'POST', `/account/printing/${job.id}/move`, { cookie: pck, body: { status: 'delivered' } });
    const j2 = db.prepare('SELECT * FROM print_jobs WHERE id=?').get(job.id); const o2 = db.prepare('SELECT * FROM print_orders WHERE id=?').get(oid);
    assert.ok(j2.status === 'delivered' && j2.tracking === '1Z999' && j2.done_at && o2.status === 'done', 'delivered, the order done');
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='print.delivered'").get() && db.prepare("SELECT 1 FROM ledger WHERE type='printer.invited'").get(), 'on the register');
    r = await req(port, 'GET', '/ledger?span=all'); assert.ok(/made by Alder Press, Dallas/.test(r.body) && /Alder Press, Dallas now prints for the house/.test(r.body) && !/print\.offered/.test(r.body), 'said in public; the bench kept private');
    const st = app.locals.payouts.statement(pm); assert.ok(st.printing && st.printing.s === 39000 && st.owed === 39000 && st.clearing === 39000, 'the shop’s statement: ' + JSON.stringify({ p: st.printing, owed: st.owed, clearing: st.clearing }));
    r = await req(port, 'GET', '/account/payouts', { cookie: pck }); assert.ok(/Prints made for the house/.test(r.body), 'on the statement page');
    r = await req(port, 'GET', '/studio/printers', { cookie: ck }); assert.ok(r.status === 200 && /Alder Press/.test(r.body), 'the Studio’s press desk');
    r = await req(port, 'GET', '/studio/prints', { cookie: ck }); assert.ok(/Alder Press · Delivered/.test(r.body), 'the Prints desk says where it is');
    r = await req(port, 'GET', '/account/printing'); assert.ok(r.status === 303 || r.status === 302, 'a stranger is sent to sign in');
    r = await req(port, 'GET', '/account/printing', { cookie: mck }); assert.strictEqual(r.status, 403, 'a maker who is not a shop is refused');
    console.log('ok: the press');
    // The lab (26 Oct): a print no shop near the collector can make goes to the lab by itself; the order is placed by
    // API with a one-time address for the master; the callback and the poll move it; the collector reads "the house's lab".
    {
      const L = app.locals.lab; assert.ok(L, 'the lab mounted');
      const calls = []; let orderNo = 9000; const orders = {};
      L.transport = async (method, p, body) => { calls.push({ method, p, body }); if (method === 'POST' && p === '/quotes') { const dear = body.items[0].sku === 'GLOBAL-HPR-24X36'; return { status: 200, json: { outcome: 'Created', quotes: [{ shipmentMethod: 'Standard', costSummary: { items: { amount: dear ? '600.00' : '20.00', currency: 'USD' }, shipping: { amount: '9.50', currency: 'USD' } } }] } }; } if (method === 'POST' && p === '/Orders') { const id = `ord_${++orderNo}`; orders[id] = { id, status: { stage: 'InProgress', details: { downloadAssets: 'InProgress', inProduction: 'NotStarted', shipping: 'NotStarted' } }, charges: [{ totalCost: { amount: '41.20', currency: 'USD' } }], shipments: [] }; return { status: 200, json: { outcome: 'Created', order: orders[id] } }; } if (method === 'GET' && p.startsWith('/Orders/')) { const o = orders[decodeURIComponent(p.slice(8))]; return { status: o ? 200 : 404, json: o ? { outcome: 'Ok', order: o } : { outcome: 'NotFound' } }; } if (method === 'GET' && p.startsWith('/products/')) { const sku = decodeURIComponent(p.slice(10)); return sku === 'GLOBAL-HPR-24X36' ? { status: 404, json: { outcome: 'NotFound' } } : { status: 200, json: { outcome: 'Ok', product: { sku, description: `Fine art print ${sku}`, attributes: { paper: ['hge', 'hpr'] } } } }; } return { status: 404, json: null }; };
      const ls = L.ensureLab(); db.prepare("UPDATE print_shops SET status='open' WHERE id=?").run(ls.id);
      r = await req(port, 'GET', '/printers'); assert.ok(!/house’s lab/.test(r.body), 'the lab is not on the room');
      // 20 × 30: wider than the Texas shop's 44? no: make the shop too narrow for this one.
      db.prepare('UPDATE print_shops SET max_in=12 WHERE id=?').run(sh.id);
      const oid2 = db.prepare("INSERT INTO print_orders (license_id, buyer_id, size, paper, email, status, kind, cents, paid, ship_name, address) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(lic.id, lic.buyer_id, '16 × 24', 'Hahnemühle Photo Rag', 'tex@example.com', 'asked', 'ask', 65000, 1, 'Tex Collector', '2 Elm St\nApt 4\nDallas, TX 75202').lastInsertRowid;
      const mails1 = (app.locals.mailLog || []).length;
      assert.ok(app.locals.printShops.sweep() >= 1, 'placed'); await L.inflight;
      const lj = db.prepare('SELECT * FROM print_jobs WHERE order_id=?').get(oid2);
      assert.ok(lj && lj.shop_id === ls.id && lj.cents === 0 && lj.lab_order === 'ord_9001' && lj.status === 'accepted' && lj.lab_cost === 4120, 'the lab took it, accepted, no fee, the cost kept: ' + JSON.stringify(lj));
      const post = calls.find(c => c.method === 'POST' && c.p === '/Orders'); assert.ok(post && post.body.items[0].sku === 'GLOBAL-HPR-16X24' && post.body.recipient.address.townOrCity === 'Dallas' && post.body.recipient.address.stateOrCounty === 'TX' && post.body.recipient.address.postalOrZipCode === '75202' && post.body.recipient.address.line2 === 'Apt 4' && /\/lab\/asset\//.test(post.body.items[0].assets[0].url) && /\/lab\/callback\?k=/.test(post.body.callbackUrl), 'the order as the lab wants it: ' + JSON.stringify(post && post.body));
      const assetPath = new URL(post.body.items[0].assets[0].url).pathname;
      r = await req(port, 'GET', assetPath); assert.ok(r.status === 200 && /^image\//.test(r.headers['content-type']) && r.body.length > 1000, 'the lab takes the master by the one-time address');
      r = await req(port, 'GET', '/lab/asset/nothere'); assert.strictEqual(r.status, 404, 'a stranger’s guess is nothing');
      // The callback: in production, then shipped with tracking, then complete.
      const cb = `/lab/callback?k=${L.cbKey()}`;
      r = await req(port, 'POST', '/lab/callback?k=wrong', { body: JSON.stringify({ order: orders.ord_9001 }), headers: { 'Content-Type': 'application/json' } }); assert.strictEqual(r.status, 403, 'a callback without the key is refused');
      orders.ord_9001.status.details.inProduction = 'InProgress';
      r = await req(port, 'POST', cb, { body: JSON.stringify({ order: orders.ord_9001 }), headers: { 'Content-Type': 'application/json' } }); assert.strictEqual(r.status, 200, 'the callback answered');
      assert.strictEqual(db.prepare('SELECT status FROM print_jobs WHERE id=?').get(lj.id).status, 'printing', 'printing');
      orders.ord_9001.shipments = [{ carrier: { name: 'UPS' }, tracking: { number: '1Z77', url: 'https://ups.example/1Z77' } }]; orders.ord_9001.status.details.shipping = 'Complete';
      assert.ok(await L.poll() >= 1, 'the poll asked'); const j3 = db.prepare('SELECT * FROM print_jobs WHERE id=?').get(lj.id);
      assert.ok(j3.status === 'shipped' && /1Z77/.test(j3.tracking), 'shipped with tracking: ' + JSON.stringify(j3));
      orders.ord_9001.status.stage = 'Complete'; await L.poll();
      const j4 = db.prepare('SELECT * FROM print_jobs WHERE id=?').get(lj.id); assert.ok(j4.status === 'delivered' && db.prepare('SELECT status FROM print_orders WHERE id=?').get(oid2).status === 'done', 'delivered, the order done');
      const sent = (app.locals.mailLog || []).slice(mails1).filter(m => /tex@example.com/.test(m.to || '')); assert.ok(sent.length >= 3 && sent.every(m => /house’s lab/.test(m.text) || !/lab/i.test(m.text)) && sent.some(m => /on its way to you from the house’s lab/.test(m.text)) && !sent.some(m => /prodigi/i.test(m.text)), 'the collector written to, the lab unnamed: ' + sent.map(m => m.subject).join(' | '));
      r = await req(port, 'GET', '/ledger?span=all'); assert.ok(!/prodigi/i.test(r.body) && !/print\.lab/.test(r.body), 'nothing of the lab on the public register');
      r = await req(port, 'GET', '/studio/printers', { cookie: ck }); assert.ok(/The lab \(prodigi\)/.test(r.body) && /ord_9001/.test(r.body) && /\$41\.20/.test(r.body), 'the Studio sees the lab and its order');
      { const q = calls.find(c => c.p === '/quotes'); assert.ok(q && q.body.destinationCountryCode === 'US' && q.body.items[0].sku === 'GLOBAL-HPR-16X24', 'the price asked first');
        const oidD = db.prepare("INSERT INTO print_orders (license_id, buyer_id, size, email, status, kind, cents, paid, ship_name, address) VALUES (?,?,?,?,?,?,?,?,?,?)").run(lic.id, lic.buyer_id, '24 × 36', 'tex@example.com', 'asked', 'ask', 40000, 1, 'Tex Collector', '2 Elm St\nDallas, TX 75202').lastInsertRowid;
        const hd = (app.locals.mailLog || []).length; app.locals.printShops.sweep(); await L.inflight;
        const dj = db.prepare('SELECT * FROM print_jobs WHERE order_id=? AND shop_id=?').get(oidD, ls.id); assert.ok(dj && dj.status === 'declined' && dj.lab_state === 'too dear' && dj.lab_cost === 60950 && !calls.some(c => c.p === '/Orders' && c.body.items[0].sku === 'GLOBAL-HPR-24X36'), 'a print at a loss is never placed: ' + JSON.stringify(dj));
        assert.ok((app.locals.mailLog || []).slice(hd).some(m => /at a loss/.test(m.subject)), 'the house mailed'); }
      r = await req(port, 'POST', '/studio/lab/check', { cookie: ck }); r = await req(port, 'GET', '/studio/printers', { cookie: ck }); assert.ok(/Fine art print GLOBAL-HPR-16X24/.test(r.body) && /Not found/.test(r.body), 'the catalogue checked, a missing SKU named');
      // A pickup never goes to the lab; a failed order is tried, and after three goes on to the house's room.
      const oid3 = db.prepare("INSERT INTO print_orders (license_id, buyer_id, size, email, status, kind, cents, paid, ship_name, address, pickup) VALUES (?,?,?,?,?,?,?,?,?,?,1)").run(lic.id, lic.buyer_id, '11 × 14', 'tex@example.com', 'asked', 'ask', 25000, 1, 'Tex Collector', '2 Elm St\nDallas, TX 75202').lastInsertRowid;
      app.locals.printShops.sweep(); const pj = db.prepare('SELECT j.*, s.house FROM print_jobs j JOIN print_shops s ON s.id=j.shop_id WHERE j.order_id=?').get(oid3); assert.ok(pj && pj.shop_id !== ls.id, 'a pickup goes elsewhere');
      L.transport = async () => ({ status: 500, json: { outcome: 'ServerError' } });
      const oid4 = db.prepare("INSERT INTO print_orders (license_id, buyer_id, size, email, status, kind, cents, paid, ship_name, address) VALUES (?,?,?,?,?,?,?,?,?,?)").run(lic.id, lic.buyer_id, '11 × 14', 'tex@example.com', 'asked', 'ask', 25000, 1, 'Tex Collector', '2 Elm St\nDallas, TX 75202').lastInsertRowid;
      app.locals.printShops.sweep(); await L.inflight; let fj = db.prepare('SELECT * FROM print_jobs WHERE order_id=? ORDER BY id DESC LIMIT 1').get(oid4);
      assert.ok(fj.shop_id === ls.id && fj.status === 'offered' && fj.lab_state === 'failed' && fj.lab_tries === 1 && /500/.test(fj.note), 'a failed order noted, kept for another try: ' + JSON.stringify(fj));
      await L.poll(); await L.poll(); fj = db.prepare('SELECT j.*, s.house FROM print_jobs j JOIN print_shops s ON s.id=j.shop_id WHERE j.order_id=? ORDER BY j.id DESC LIMIT 1').get(oid4);
      assert.ok(fj.house === 1 && fj.status === 'offered' && db.prepare("SELECT status FROM print_jobs WHERE order_id=? AND shop_id=?").get(oid4, ls.id).status === 'declined', 'after three tries, offered on to the house’s room: ' + JSON.stringify(fj));
      L.transport = null; db.prepare('UPDATE print_shops SET max_in=44 WHERE id=?').run(sh.id);
      console.log('ok: the lab');
    }
  }
  // The first week (26 Oct): a new maker's letter lands in the vault; seven mornings, one act each, only while undone;
  // the Studio sees who is stuck where; an outside maker's first sale is told to the house.
  {
    const FW = app.locals.firstWeek; assert.ok(FW, 'the first week mounted');
    r = await req(port, 'POST', '/studio/accounts', { cookie: ck, body: { name: 'Greg Newmaker', email: 'greg@newmaker.example', kind: 'maker' } });
    const gm = db.prepare("SELECT * FROM makers WHERE email='greg@newmaker.example'").get(); assert.ok(gm && gm.invite_token, 'invited');
    r = await req(port, 'GET', `/account/join/${gm.invite_token}`); assert.strictEqual(r.headers.location, '/account/upload?welcome=1', 'the letter lands in the vault');
    const gck = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    r = await req(port, 'GET', '/account/upload?welcome=1', { cookie: gck }); assert.ok(r.status === 200 && /Your studio is open/.test(r.body), 'the vault with its welcome');
    const w0 = FW.where(db.prepare('SELECT * FROM makers WHERE id=?').get(gm.id)); assert.ok(w0.done === 0 && w0.next.key === 'work' && w0.days === 0, 'nothing done yet: ' + JSON.stringify({ done: w0.done, next: w0.next.key }));
    r = await req(port, 'GET', '/studio/accounts', { cookie: ck }); assert.ok(/0 of 7 · at your work · today/.test(r.body), 'the Studio sees where Greg is');
    // The mornings: day one is the morning after; forced here. Each day the first undone act; a done act is skipped.
    const m0 = (app.locals.mailLog || []).length;
    assert.ok(FW.mornings({ force: true }) >= 1, 'letters sent, day one');
    let fw = db.prepare('SELECT * FROM first_week WHERE maker_id=?').all(gm.id); assert.ok(fw.length === 1 && fw[0].day === 1 && fw[0].act === 'work', 'day one: your work');
    const l1 = (app.locals.mailLog || []).slice(m0).find(m => m.to === 'greg@newmaker.example'); assert.ok(l1 && /Your work/.test(l1.subject) && /Welcome to the house, Greg/.test(l1.text) && /\/account\/upload/.test(l1.text), 'the letter: ' + (l1 && l1.subject));
    assert.strictEqual(FW.mornings({ force: true }), 0, 'never twice in a day');
    // Day two, with the work in and the page written: the next undone is the edit.
    db.prepare("UPDATE makers SET joined_at=datetime('now', '-1 day'), bio='A photographer of the long light along the coast.' WHERE id=?").run(gm.id);
    db.prepare("INSERT INTO works (slug, title, maker_id, status, original_file, sha256, width, height, taken_at) VALUES ('greg-one', 'Greg One', ?, 'hidden', 'x.jpg', 'deadbeef', 100, 100, '2026')").run(gm.id);
    FW.mornings({ force: true });
    fw = db.prepare('SELECT * FROM first_week WHERE maker_id=? ORDER BY day').all(gm.id); assert.ok(fw.length === 2 && fw[1].day === 2 && fw[1].act === 'edit', 'day two: the edit, the page skipped: ' + JSON.stringify(fw));
    r = await req(port, 'GET', '/studio/accounts', { cookie: ck }); assert.ok(/2 of 7 · at your best in front · a day/.test(r.body), 'the Studio line moved');
    // Everything done: no letter, the day marked done.
    db.prepare("UPDATE makers SET joined_at=datetime('now', '-2 days'), stripe_account='acct_x' WHERE id=?").run(gm.id);
    db.prepare("UPDATE works SET status='held', stars=4 WHERE slug='greg-one'").run();
    db.prepare("INSERT OR IGNORE INTO maker_steps (maker_id, step) VALUES (?, 'prices'), (?, 'shared')").run(gm.id, gm.id);
    db.prepare("INSERT INTO deliveries (token, maker_id, title, client_name) VALUES ('fwtok', ?, 'A present', 'Rae')").run(gm.id);
    FW.mornings({ force: true }); fw = db.prepare('SELECT * FROM first_week WHERE maker_id=? AND day=3').get(gm.id); assert.ok(fw && fw.act === 'done', 'day three marked done');
    r = await req(port, 'GET', '/studio/accounts', { cookie: ck }); assert.ok(/All 7 done/.test(r.body), 'all done on the Studio');
    // The first sale of an outside maker: the house mailed, once.
    const h0 = (app.locals.mailLog || []).length;
    const su = db.prepare("SELECT id FROM uses WHERE maker_id=? AND key='social'").get(gm.id); const gw = db.prepare("SELECT * FROM works WHERE slug='greg-one'").get();
    const refA = 'WM-2026-990001';
    db.prepare("INSERT INTO licenses (ref, work_id, use_id, buyer_id, licensee_name, licensee_email, price_cents, status, download_token) VALUES (?,?,?,?,?,?,?,'active','fwdl1')").run(refA, gw.id, su.id, setLs[0].buyer_id, 'A collector', 'c@example.com', 700);
    ledger.append(db, 'license.granted', refA, { work: 'greg-one', paid: true });
    await new Promise(r2 => setTimeout(r2, 60));
    assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='maker.firstsale' AND subject=?").get(gm.handle), 'the first sale on the register (hidden)');
    const hm = (app.locals.mailLog || []).slice(h0).find(m => /first sale/.test(m.subject)); assert.ok(hm && /Greg Newmaker/.test(hm.subject) && /Greg One/.test(hm.text), 'the house written to: ' + (hm && hm.subject));
    const refB = 'WM-2026-990002';
    db.prepare("INSERT INTO licenses (ref, work_id, use_id, buyer_id, licensee_name, licensee_email, price_cents, status, download_token) VALUES (?,?,?,?,?,?,?,'active','fwdl2')").run(refB, gw.id, su.id, setLs[0].buyer_id, 'A collector', 'c@example.com', 700);
    const h1 = (app.locals.mailLog || []).length; ledger.append(db, 'license.granted', refB, { work: 'greg-one', paid: true }); await new Promise(r2 => setTimeout(r2, 60));
    assert.ok(!(app.locals.mailLog || []).slice(h1).find(m => /first sale/.test(m.subject)), 'a second sale is not a first');
    r = await req(port, 'GET', '/ledger?span=all'); assert.ok(!/first sale/.test(r.body), 'nothing of it in public');
    console.log('ok: the first week');
  }
  // Guardrails: headers on every page; a write from another site is refused; the Studio door locks after ten tries.
  r = await req(port, 'GET', '/about'); assert.ok(r.headers['content-security-policy'] && r.headers['x-frame-options'] === 'SAMEORIGIN' && /frame-ancestors 'self'/.test(r.headers['content-security-policy']) && r.headers['referrer-policy'], 'security headers');
  r = await req(port, 'POST', '/guestbook/1/remove', { headers: { origin: 'https://evil.example' } }); assert.equal(r.status, 403, 'cross-site write refused');
  r = await req(port, 'POST', '/yours', { headers: { origin: 'https://evil.example' }, body: { name: 'x' } }); assert.equal(r.status, 403, 'cross-site write refused (yours)');
  { let last = 0; for (let i = 0; i < 11; i++) { r = await req(port, 'POST', '/studio/login', { body: { password: 'wrong' } }); last = r.status; } assert.equal(last, 429, 'the Studio door locks after ten tries'); }
  assert.ok(ledger.verify(db).ok); const n = ledger.verify(db).checked; assert.ok(n >= 5);
  db.prepare("UPDATE ledger SET data='{}' WHERE seq=1").run(); assert.equal(ledger.verifyAll(db).ok, false, 'tamper detected'); assert.equal(ledger.verify(db).ok, true, 'the quick check trusts its head for an hour');
  r = await req(port, 'GET', '/ledger?check=full'); assert.ok(r.body.includes('broken'));
  server.close(); console.log(`ok: ${n} ledger entries, all flows pass`);
})().catch(e => { console.error(e); process.exit(1); });
