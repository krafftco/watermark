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
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', stripeKey: 'sk_test_dummy', stripePk: 'pk_test_dummy', stripeClient, webhookSecret: 'whsec_test', noTimers: true });
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
  r = await req(port, 'GET', `/w/${w.slug}`); assert.equal(r.status, 200); assert.ok(r.body.toString().includes('Watermark Shield') && r.body.toString().includes('Registered to'), 'the shield');
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
  r = await req(port, 'GET', '/collectors'); assert.ok(r.body.toString().includes('/collector/' + code), 'shown among the collectors');
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(/In \d+ collections?, among them/.test(r.body.toString()), 'in the collections of');
  r = await req(port, 'GET', `/collector/${code}`); assert.ok(r.body.toString().includes('data-buy') && r.body.toString().includes('/static/pay.js'), 'collect it from their wall');
  r = await req(port, 'POST', '/yours', { cookie: bck, body: { name: "Tap's collection" } });
  r = await req(port, 'GET', `/collector/${code}`); assert.equal(r.status, 404, 'private again');


  // bespoke: ask the maker
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'campaign', ask: '1' } }); assert.ok(r.body.includes('Send to the maker'));

  // the maker's say: close a use, require approval, say never; conditions travel with the license
  r = await req(port, 'POST', '/studio/login', { body: { password: 'pw' } }); const ck = r.headers['set-cookie'][0].split(';')[0];
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
  r = await req(port, 'GET', '/makers'); assert.ok(r.body.includes('For the people who make the pictures'));
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
  r = await req(port, 'GET', '/studio/masters', { cookie: ck }); assert.ok(r.body.includes('1 works held at full resolution'));
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
  r = await req(port, 'GET', '/studio', { cookie }); assert.ok(r.body.includes('Holdings') && r.body.includes('Needs you') && r.body.includes('WM.'), 'holdings');
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
  assert.ok(ex['0th'][piexif.ImageIFD.Copyright].includes(ref1), 'license stamped in EXIF');
  const sh = require('sharp'); const [a, b] = await Promise.all([sh(r.body).raw().toBuffer(), sh(fs.readFileSync(BIG)).raw().toBuffer()]);
  assert.ok(a.equals(b), 'pixels untouched by the stamp');
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
  // the estate adds its own photograph: private until it publishes, with its word on rights and releases
  const px2 = Buffer.alloc(320 * 200 * 3); for (let k = 0; k < px2.length; k++) px2[k] = (k * 104729 + 7) % 241;
  const theirs = await sharp2(px2, { raw: { width: 320, height: 200, channels: 3 } }).resize({ width: 2000, height: 1250, kernel: "nearest" }).jpeg().toBuffer();
  r = await req(port, 'POST', '/account/works/one', { cookie: mck, body: mp('ada_harbour.jpg', theirs, { place: 'Genoa, Italy' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
  const aj = JSON.parse(r.body); assert.ok(aj.ok, r.body); const aw = db.prepare('SELECT * FROM works WHERE slug=?').get(aj.slug);
  assert.strictEqual(aw.maker_id, est.id); assert.strictEqual(aw.status, 'hidden', 'private on arrival');
  r = await req(port, 'POST', `/account/works/${aj.slug}/show`, { cookie: mck }); assert.ok(r.headers.location.includes('need=attest'), 'no publishing without the attestation');
  r = await req(port, 'POST', `/account/works/${aj.slug}/show`, { cookie: mck, body: { attest: '1' } });
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
    r = await req(port, 'GET', '/account/keeping', { cookie: gck }); assert.ok(r.body.toString().includes('End Keeping') && r.body.toString().includes('Move here') && r.body.toString().includes('kp-tier on'), 'keeping on');
    // Moving up the ladder changes the standing subscription in place.
    r = await req(port, 'POST', '/account/keeping', { cookie: gck, body: { tier: 'archive' } }); assert.ok(r.headers.location.includes('ok=moved'), 'move');
    r = await req(port, 'GET', '/account/keeping?ok=moved', { cookie: gck }); assert.ok(r.body.toString().includes('Moved to The archive'), 'moved'); }
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
  { const fx = await app.locals.archive.fixity(100); assert.ok(fx.ran >= 2 && fx.bad === 0, 'fixity whole'); r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.toString().includes('Fixity verified'), 'said on the shield'); }
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
  r = await req(port, 'GET', '/static/app/manifest.webmanifest'); assert.equal(r.status, 200); assert.equal(JSON.parse(r.body.toString()).display, 'standalone');
  r = await req(port, 'GET', '/sw.js'); assert.equal(r.status, 200); assert.ok(r.body.toString().includes('PRIVATE'));
  r = await req(port, 'GET', '/app'); assert.ok(r.body.toString().includes('Add to Dock'));
  r = await req(port, 'GET', '/offline'); assert.ok(r.body.toString().includes('cannot be reached'));
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
  r = await req(port, 'GET', '/account/payouts', { cookie: gck }); assert.ok(r.body.toString().includes('Owed to you now') && r.body.toString().includes('Add your bank'), 'the statement');
  { const mw = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id); const st = app.locals.payouts.statement(mw); assert.ok(st.thanks.s >= 99 && st.share === Math.round(st.licensed.s * 85 / 100) && st.owed === st.earned - st.paid, 'the sums');
    const r2 = await app.locals.payouts.pay(mw); assert.equal(r2.ok, false); assert.equal(r2.why, 'off', 'no transfer until the house is set to pay');
    r = await req(port, 'POST', `/studio/payouts/${mw.handle}`, { cookie: ck, body: { amount: '1', note: 'By cheque' } }); assert.equal(r.status, 302);
    assert.equal(app.locals.payouts.statement(mw).paid, 100, 'recorded'); }
  // Every maker is a collector: the switch on both sides; the pocket pays for a Collect with one tap; the money stays in the house.
  r = await req(port, 'GET', '/account', { cookie: gck }); assert.ok(r.body.toString().includes('dk-sw') && r.body.toString().includes('>Gallery<'), 'the switch in the studio');
  const tmp4 = path.join(dir, 'in4.jpg'); await require('sharp')(SRC).resize({ width: 1700 }).rotate(90).modulate({ brightness: 1.15, hue: 40 }).toFile(tmp4);
  const w4 = await registerWork({ file: tmp4, originalName: 'q.jpg', title: 'Test Quay', place: 'Venice' });
  r = await req(port, 'GET', `/w/${w4.slug}`, { cookie: bck }); assert.ok(r.body.toString().includes('data-pocket="1"') && r.body.toString().includes('From your pocket, one tap'), 'the pocket covers the Collect');
  { const pb = db.prepare("SELECT b.* FROM buyers b WHERE b.id=(SELECT buyer_id FROM pocket WHERE kind='topup' ORDER BY id DESC LIMIT 1)").get(); const before = app.locals.pocket.balance(pb);
    r = await req(port, 'POST', `/buy/${w4.slug}`, { cookie: bck, body: { use: 'social', from: 'pocket' } }); assert.ok(r.headers.location.includes('collected=1'), 'collected from the pocket, no checkout');
    const after = app.locals.pocket.balance(pb);
    const lic = db.prepare("SELECT * FROM licenses WHERE ref=(SELECT subject FROM ledger WHERE type='license.paid.pocket' ORDER BY seq DESC LIMIT 1)").get(); assert.equal(lic.status, 'active'); assert.ok(lic.collector_no, 'numbered'); assert.equal(before - after, lic.price_cents, 'the pocket paid exactly the price'); }
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
  r = await req(port, 'POST', '/signin/code', { body: JSON.stringify({ email: 'new@example.com' }), headers: { 'content-type': 'application/json' } }); const lc2 = app.locals.lastCode;
  r = await req(port, 'GET', '/signin/' + lc2.link); assert.ok(r.status === 302 && r.headers.location === '/yours', 'link signs a new collector in');
  r = await req(port, 'GET', '/signin/' + lc2.link); assert.equal(r.status, 410, 'link works once');
  r = await req(port, 'POST', '/auth/passkey/register/options', { body: '{}', headers: { 'content-type': 'application/json' }, cookie: bck });
  const ro = JSON.parse(r.body); assert.ok(ro.challenge && ro.rp.id === 'localhost' && ro.authenticatorSelection.residentKey === 'required', 'passkey options');
  r = await req(port, 'POST', '/auth/passkey/login/options', { body: '{}', headers: { 'content-type': 'application/json' } }); assert.ok(JSON.parse(r.body).challenge, 'sign-in options');
  r = await req(port, 'POST', '/auth/passkey/login/verify', { body: JSON.stringify({ id: 'nope' }), headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 400, 'no challenge, no sign-in');
  r = await req(port, 'GET', '/yours', { cookie: bck }); assert.ok(r.body.toString().includes('Save with a passkey'), 'offered on the collection');
  r = await req(port, 'GET', '/static/webauthn.js'); assert.equal(r.status, 200);
  r = await req(port, 'GET', '/collection'); assert.ok(/<nav><a href="\/artists">Artists<\/a><a href="\/collection">Collection<\/a><a href="\/series\/the-great-rooms"[^>]*>Series<\/a><a href="\/collectors">Collectors<\/a><a href="\/market"[^>]*>Market<\/a><a href="\/journal">Journal<\/a><a href="\/yours"[^>]*>Yours<\/a>/.test(r.body.toString()), 'the menu, in order');
  // Other makers hang beside the house: their name on each plate, a gallery of their own, the Watermark mark, a filter.
  r = await req(port, 'GET', '/collection'); { const b = r.body.toString(); assert.ok(b.includes('data-wander'), 'wander');
    assert.ok(b.includes('<a href="/m/the-ada-estate">The Ada Estate</a>'), 'a gallery of their own'); assert.ok(b.includes('data-mk="the-ada-estate"'), 'a filter by maker');
    assert.ok(b.includes('<i>The Ada Estate, Genoa, Italy</i>'), 'their name on the plate'); assert.ok(b.includes('"mk":"The Ada Estate"'), 'searchable by maker'); }
  r = await req(port, 'GET', `/w/${aj.slug}`); assert.ok(r.body.toString().includes('viewBox="1.5 14.2 41 11"') && r.body.toString().includes('href="/m/the-ada-estate"'), 'their mark, their page');
  r = await req(port, 'GET', '/m/the-ada-estate'); assert.equal(r.status, 200);
  // Voices: the maker records a word on a photograph; anyone looking hears it; others cannot add to it.
  r = await req(port, 'GET', `/voices/${w.slug}`, { cookie: ck }); assert.ok(r.body.toString().includes('What is said about this photograph'), 'the voices page');
  { const vb = '----wmvo'; const parts = [['kind', 'maker'], ['speaker', 'Will Fullerton'], ['body', 'I stood under it for an hour.'], ['seconds', '3']].map(([k, v]) => `--${vb}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
    const body = Buffer.concat([Buffer.from(parts + `--${vb}\r\nContent-Disposition: form-data; name="audio"; filename="note.m4a"\r\nContent-Type: audio/mp4\r\n\r\n`), Buffer.from('fakeaudiodata'), Buffer.from(`\r\n--${vb}--\r\n`)]);
    r = await req(port, 'POST', `/voices/${w.slug}`, { cookie: ck, body, headers: { 'content-type': 'multipart/form-data; boundary=' + vb } }); assert.equal(r.status, 302, 'saved'); }
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(r.body.toString().includes('data-voice="/listen/') && r.body.toString().includes('The maker'), 'heard on the page');
  const vo1 = JSON.parse((await req(port, "GET", `/api/voices/${w.slug}`)).body).voices[0]; assert.ok(vo1 && vo1.audio && vo1.speaker === "Will Fullerton");
  r = await req(port, "GET", vo1.audio); assert.equal(r.status, 200); assert.equal(r.body.toString(), "fakeaudiodata");
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
    r = await req(port, 'GET', `/w/${wl.slug}`); assert.ok(r.body.toString().includes('Offer a trade for one'), 'the work offers a trade');
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
  r = await req(port, 'GET', `/w/${w.slug}`, { cookie: 'wm_v=abc123' }); assert.ok(r.body.toString().includes('You were the 1st person to stand in front of this') && r.body.toString().includes('2 people have stood'), 'told on the page');
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
  // Guardrails: headers on every page; a write from another site is refused; the Studio door locks after ten tries.
  r = await req(port, 'GET', '/about'); assert.ok(r.headers['content-security-policy'] && r.headers['x-frame-options'] === 'DENY' && r.headers['referrer-policy'], 'security headers');
  r = await req(port, 'POST', '/guestbook/1/remove', { headers: { origin: 'https://evil.example' } }); assert.equal(r.status, 403, 'cross-site write refused');
  r = await req(port, 'POST', '/yours', { headers: { origin: 'https://evil.example' }, body: { name: 'x' } }); assert.equal(r.status, 403, 'cross-site write refused (yours)');
  { let last = 0; for (let i = 0; i < 11; i++) { r = await req(port, 'POST', '/studio/login', { body: { password: 'wrong' } }); last = r.status; } assert.equal(last, 429, 'the Studio door locks after ten tries'); }
  assert.ok(ledger.verify(db).ok); const n = ledger.verify(db).checked; assert.ok(n >= 5);
  db.prepare("UPDATE ledger SET data='{}' WHERE seq=1").run(); assert.equal(ledger.verifyAll(db).ok, false, 'tamper detected'); assert.equal(ledger.verify(db).ok, true, 'the quick check trusts its head for an hour');
  r = await req(port, 'GET', '/ledger?check=full'); assert.ok(r.body.includes('broken'));
  server.close(); console.log(`ok: ${n} ledger entries, all flows pass`);
})().catch(e => { console.error(e); process.exit(1); });
