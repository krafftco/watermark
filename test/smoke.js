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
  stripeClient.subscriptions.update = async (id, o) => ({ id, ...o });
  stripeClient.refunds.create = async o => { refunds.push(o); return { id: 're_1', ...o }; };
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', stripeKey: 'sk_test_dummy', stripePk: 'pk_test_dummy', stripeClient, webhookSecret: 'whsec_test', noTimers: true });
  const server = app.listen(0); const port = server.address().port;
  const { registerWork, db } = app.locals;
  const tmp = path.join(dir, 'in.jpg'); fs.copyFileSync(SRC, tmp);
  const w = await registerWork({ file: tmp, originalName: 'x.jpg', title: 'Test Dome', place: 'Florence' });
  assert.ok(w.sha256 && w.width > 0, 'registered with fingerprint and size');
  // duplicate rejected
  const tmp2 = path.join(dir, 'in2.jpg'); fs.copyFileSync(SRC, tmp2);
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
  r = await req(port, 'GET', `/license/${w.slug}`); assert.ok(r.body.toString().includes('Share it.') && r.body.toString().includes('Share it for $5'), 'Share it leads');
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
  r = await req(port, 'POST', `/pay/${w.slug}/tap`, { cookie: bck }); const tj = JSON.parse(r.body);
  assert.ok(tj.ok && tj.undo && tj.download, 'one tap: paid and handed over');
  assert.strictEqual(Object.values(pis).find(p => p.metadata.ref === tj.ref).payment_method, 'pm_card_1');
  r = await req(port, 'GET', tj.download); assert.equal(r.status, 200);
  r = await req(port, 'POST', `/pay/${tj.ref}/undo`, { cookie: bck }); assert.ok(JSON.parse(r.body).ok && refunds.length === 1, 'undo refunds');
  r = await req(port, 'GET', tj.download); assert.equal(r.status, 404, 'undone file stops working');
  // collectors: numbered, hung in their own collection, private until they open it
  assert.ok(dj.no >= 1 && tj.no === dj.no + 1, 'collector numbers count up: ' + dj.no + ',' + tj.no);
  r = await req(port, 'GET', '/yours'); assert.ok(r.body.toString().includes('Start your collection'), 'a new visitor is invited to start');
  r = await req(port, 'GET', '/yours', { cookie: bck }); let yb = r.body.toString();
  assert.ok(yb.includes(`No. ${dj.no}`) && yb.includes('The collection'), 'it hangs, numbered');
  r = await req(port, 'POST', '/yours', { cookie: bck, body: { name: "Tap's collection", public: '1' } });
  const code = db.prepare("SELECT code FROM buyers WHERE name=?").get("Tap's collection").code;
  r = await req(port, 'GET', `/collector/${code}`); yb = r.body.toString(); assert.ok(yb.includes('Tap&#39;s collection') || yb.includes("Tap's collection"), 'public by choice');
  assert.ok(!yb.includes('Save again'), 'no files on the public wall');
  r = await req(port, 'GET', '/series/the-great-rooms'); assert.equal(r.status, 200, 'the series hangs'); assert.ok(r.body.toString().includes('The Great Rooms'));
  // Collecting a set: two photographs of a series part at a quarter off, each its own numbered license.
  const tmp3 = path.join(dir, 'in3.jpg'); await require('sharp')(SRC).flop().modulate({ brightness: 0.8 }).toFile(tmp3);
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
  r = await req(port, 'GET', `/license/${w.slug}`); assert.ok(r.body.toString().includes('Share it for $40'), 'its own price');
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'social' } }); assert.equal(sessions[r.headers.location.split('/').pop()].line_items[0].price_data.unit_amount, 4000);
  r = await req(port, 'POST', `/studio/works/${w.slug}/catalogue`, { cookie: ck, body: { title: 'Test Dome', share: '40', noshare: '1' } });
  r = await req(port, 'GET', `/w/${w.slug}`); assert.ok(!r.body.toString().includes('share-buy'), 'license only');
  r = await req(port, 'POST', `/studio/works/${w.slug}/catalogue`, { cookie: ck, body: { title: 'Test Dome', share: '' } });
  r = await req(port, 'GET', `/license/${w.slug}`); assert.ok(r.body.toString().includes('Share it for $5'), 'back to the standard price');
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
  mj = JSON.parse(r.body); assert.strictEqual(mj.outcome, 'archive', r.body); assert.strictEqual(mj.title, 'Florence, frame 123');
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
  assert.equal(parsed.header.title, 'Test Dome'); assert.ok(!wmk.includes(fs.readFileSync(SRC).slice(1000, 1064)), 'image is not in the clear');
  r = await req(port, 'GET', `/studio/seals/${sl.id}.wmk`); assert.equal(r.status, 302, 'download is the maker\'s');
  r = await req(port, 'POST', `/k/${sl.id}`, { body: JSON.stringify({ access: parsed.header.access, host: 'mag.com' }), headers: { 'content-type': 'application/json' } });
  const kj = JSON.parse(r.body); assert.ok(kj.open);
  assert.ok(SEAL.open(wmk, Buffer.from(kj.key, 'base64')).equals(fs.readFileSync(SRC)), 'opens to the exact original');
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
  r = await req(port, 'POST', `/studio/licenses/${ref1}/grant`, { cookie }); assert.equal(r.status, 302);
  const l1 = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref1); assert.equal(l1.status, 'active'); assert.ok(l1.ends_at);
  r = await req(port, 'GET', `/d/${l1.download_token}`); assert.equal(r.status, 200);
  const piexif = require('piexifjs'); const ex = piexif.load(r.body.toString('binary'));
  assert.ok(ex['0th'][piexif.ImageIFD.Copyright].includes(ref1), 'license stamped in EXIF');
  const sh = require('sharp'); const [a, b] = await Promise.all([sh(r.body).raw().toBuffer(), sh(fs.readFileSync(SRC)).raw().toBuffer()]);
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
  const theirs = await sharp2(px2, { raw: { width: 320, height: 200, channels: 3 } }).jpeg().toBuffer();
  r = await req(port, 'POST', '/account/works/one', { cookie: mck, body: mp('ada_harbour.jpg', theirs, { place: 'Genoa, Italy' }), headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
  const aj = JSON.parse(r.body); assert.ok(aj.ok, r.body); const aw = db.prepare('SELECT * FROM works WHERE slug=?').get(aj.slug);
  assert.strictEqual(aw.maker_id, est.id); assert.strictEqual(aw.status, 'hidden', 'private on arrival');
  r = await req(port, 'POST', `/account/works/${aj.slug}/show`, { cookie: mck }); assert.ok(r.headers.location.includes('need=attest'), 'no publishing without the attestation');
  r = await req(port, 'POST', `/account/works/${aj.slug}/show`, { cookie: mck, body: { attest: '1' } });
  assert.strictEqual(db.prepare('SELECT status FROM works WHERE id=?').get(aw.id).status, 'held');
  r = await req(port, 'GET', `/w/${aj.slug}`); assert.ok(r.body.toString().includes('Photograph by The Ada Estate'), 'their name on their work');
  r = await req(port, 'POST', `/buy/${aj.slug}`, { body: { use: 'social' } }); const es = sessions[r.headers.location.split('/').pop()];
  assert.ok(es.line_items[0].price_data.product_data.description.includes('The Ada Estate'), 'their name at checkout');
  r = await req(port, 'GET', '/account', { cookie: mck }); assert.ok(r.body.toString().includes('ada harbour'), 'on their dashboard');
  r = await req(port, 'POST', `/account/works/${w.slug}/show`, { cookie: mck, body: { attest: '1' } }); assert.equal(r.status, 404, 'not someone else\'s');
  // Will's own dashboard, as he sees it: the sales so far, at 85%
  const me = db.prepare('SELECT handle FROM makers WHERE id=1').get().handle;
  r = await req(port, 'GET', `/account?maker=${me}`, { cookie: ck }); ab = r.body.toString(); assert.ok(ab.includes('Your studio') && ab.includes('The holdings'));
  r = await req(port, 'GET', `/account?maker=${me}`); assert.equal(r.status, 401, 'only the Studio can look over a shoulder');
  r = await req(port, 'POST', `/account/works/${w.slug}/jewel`, { cookie: ck, body: { maker: me } }); assert.equal(db.prepare('SELECT curated FROM works WHERE id=?').get(w.id).curated, 1, 'a jewel');
  r = await req(port, 'GET', `/account?maker=${me}`, { cookie: ck }); assert.ok(r.body.toString().includes('class="ac-j"'), 'jewels lead');

  r = await req(port, 'GET', '/journal'); assert.ok(r.status === 200 && r.body.toString().includes('On patronage'), 'the journal');
  r = await req(port, 'GET', '/patronage'); assert.ok(r.body.toString().includes('Watermark honours both'));
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
  r = await req(port, 'GET', '/yours', { cookie: nck }); assert.ok(r.body.toString().includes('Test Stacks') && r.body.toString().includes('No. 1 of 1'), 'it hangs on the new wall');
  r = await req(port, 'GET', '/yours', { cookie: sck }); assert.ok(!r.body.toString().includes('Test Stacks</i>'), 'and has left the old one');
  r = await req(port, 'POST', `/claim/${gtok}`); assert.equal(r.headers.location, '/yours', 'a claim link works once');
  // The market: the collector offers the piece, someone asks to buy it, the Studio settles, it moves with its price.
  r = await req(port, 'POST', '/yours/offer', { cookie: nck, body: { ref: held2.ref, ask: '40' } }); assert.ok(r.headers.location.includes('offer=1'), 'offered');
  r = await req(port, 'GET', '/yours', { cookie: nck }); assert.ok(r.body.toString().includes('Offered at <b>$40</b>') && r.body.toString().includes('class="pf"'), 'offered, and the portfolio shows');
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
  r = await req(port, 'GET', '/yours', { cookie: ick }); assert.ok(r.body.toString().includes('Offers for your pieces') && r.body.toString().includes('$70'), 'the collector sees the offer');
  const ofr = db.prepare("SELECT id FROM offers WHERE status='open'").get().id;
  r = await req(port, 'POST', `/yours/offers/${ofr}/accept`, { cookie: ick }); assert.ok(r.headers.location.includes('accepted=1'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM bids WHERE status='new' AND offer_cents=7000").get().n, 1, 'accepted offers go to the Studio');
  r = await req(port, 'GET', '/studio', { cookie: ck }); assert.ok(r.body.toString().includes('Resale') && r.body.toString().includes('$5 royalties'), 'resale in the holdings');


  r = await req(port, 'GET', '/yours', { cookie: bck }); assert.ok(/Founding Collector &middot; No\. \d+ of 100/.test(r.body.toString()), 'a founding collector');
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
  r = await req(port, 'GET', '/yours', { cookie: bck }); assert.ok(r.body.toString().includes('Patron of Will Fullerton'), 'the mark on the collection');
  r = await req(port, 'POST', `/patron/${pid}/end`, { cookie: bck }); assert.equal(db.prepare('SELECT status FROM patrons WHERE id=?').get(pid).status, 'ending', 'ended with one press');
  r = await req(port, 'POST', '/m/will-fullerton/patron', { body: { once: '50' } }); const po = sessions[r.headers.location.split('/').pop()]; assert.equal(po.mode, 'payment'); assert.equal(po.line_items[0].price_data.unit_amount, 5000);

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
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tips WHERE status='paid'").get().n, 2);
  r = await req(port, 'GET', '/api/k?post=lake-garda'); assert.ok(JSON.parse(r.body.toString()).credits.tip.endsWith('/tip/lake-garda'), 'the K knows where to tip');
  r = await req(port, 'GET', '/w/' + w.slug); assert.ok(r.body.toString().includes('Become a patron of'), 'offered on the work');
  // Signing in: passkeys, and the menu.
  r = await req(port, 'GET', '/signin'); assert.ok(r.status === 200 && r.body.toString().includes('Sign in with a passkey'), 'sign in');
  r = await req(port, 'POST', '/auth/passkey/register/options', { body: '{}', headers: { 'content-type': 'application/json' }, cookie: bck });
  const ro = JSON.parse(r.body); assert.ok(ro.challenge && ro.rp.id === 'localhost' && ro.authenticatorSelection.residentKey === 'required', 'passkey options');
  r = await req(port, 'POST', '/auth/passkey/login/options', { body: '{}', headers: { 'content-type': 'application/json' } }); assert.ok(JSON.parse(r.body).challenge, 'sign-in options');
  r = await req(port, 'POST', '/auth/passkey/login/verify', { body: JSON.stringify({ id: 'nope' }), headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 400, 'no challenge, no sign-in');
  r = await req(port, 'GET', '/yours', { cookie: bck }); assert.ok(r.body.toString().includes('Save with a passkey'), 'offered on the collection');
  r = await req(port, 'GET', '/static/webauthn.js'); assert.equal(r.status, 200);
  r = await req(port, 'GET', '/collection'); assert.ok(/<nav><a href="\/collection">Collection<\/a><a href="\/series\/the-great-rooms"[^>]*>Series<\/a><a href="\/collectors">Collectors<\/a><a href="\/market"[^>]*>Market<\/a><a href="\/journal">Journal<\/a><a href="\/yours"[^>]*>Yours<\/a>/.test(r.body.toString()), 'the menu, in order');
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
  r = await req(port, 'GET', '/account'); assert.ok(r.body.toString().includes('data-passkey="maker-signin"'), 'makers sign in with a passkey');
  r = await req(port, 'GET', '/account', { cookie: mck }); assert.ok(r.body.toString().includes('data-passkey="maker-save"'), 'and save one from their room');
  r = await req(port, 'POST', '/auth/maker/register/options', { body: '{}', headers: { 'content-type': 'application/json' }, cookie: mck }); assert.ok(JSON.parse(r.body).challenge, 'maker passkey options');
  r = await req(port, 'POST', '/auth/maker/register/options', { body: '{}', headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 401, 'only for a maker');
  r = await req(port, 'GET', '/makers'); assert.ok(r.body.toString().includes('Sign in to your room'));
  // ledger intact, and tamper is detected
  const ledger = require('../src/ledger');
  assert.ok(ledger.verify(db).ok); const n = ledger.verify(db).checked; assert.ok(n >= 5);
  db.prepare("UPDATE ledger SET data='{}' WHERE seq=1").run(); assert.equal(ledger.verify(db).ok, false, 'tamper detected');
  r = await req(port, 'GET', '/ledger'); assert.ok(r.body.includes('broken'));
  server.close(); console.log(`ok: ${n} ledger entries, all flows pass`);
})().catch(e => { console.error(e); process.exit(1); });
