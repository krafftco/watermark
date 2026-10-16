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
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', stripeKey: 'sk_test_dummy', stripeClient, webhookSecret: 'whsec_test', noTimers: true });
  const server = app.listen(0); const port = server.address().port;
  const { registerWork, db } = app.locals;
  const tmp = path.join(dir, 'in.jpg'); fs.copyFileSync(SRC, tmp);
  const w = await registerWork({ file: tmp, originalName: 'x.jpg', title: 'Test Dome', place: 'Florence' });
  assert.ok(w.sha256 && w.width > 0, 'registered with fingerprint and size');
  // duplicate rejected
  const tmp2 = path.join(dir, 'in2.jpg'); fs.copyFileSync(SRC, tmp2);
  await assert.rejects(registerWork({ file: tmp2, originalName: 'y.jpg', title: 'Dupe' }), /already held/);

  let r = await req(port, 'GET', '/'); assert.equal(r.status, 200); assert.ok(r.body.includes('Test Dome'));
  r = await req(port, 'GET', `/w/${w.slug}`); assert.equal(r.status, 200);
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
  // bespoke: ask the maker
  r = await req(port, 'POST', `/buy/${w.slug}`, { body: { use: 'campaign', ask: '1' } }); assert.ok(r.body.includes('Send to the maker'));

  // the maker's say: close a use, require approval, say never; conditions travel with the license
  r = await req(port, 'POST', '/studio/login', { body: { password: 'pw' } }); const ck = r.headers['set-cookie'][0].split(';')[0];
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
  r = await req(port, 'GET', '/'); assert.ok(r.body.includes('For the people who make the pictures'));
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
  // the trove: collections, catalogue record, public room
  r = await req(port, 'POST', '/studio/collections', { cookie: ck, body: { title: 'Florence, 2025', note: 'The city from below.', public: '1' } }); assert.equal(r.status, 302);
  const cid = db.prepare("SELECT id FROM collections WHERE slug='florence-2025'").get().id;
  r = await req(port, 'POST', `/studio/works/${w.slug}/catalogue`, { cookie: ck, body: { title: 'Test Dome', place: 'Florence', keywords: 'dome, fresco', caption: 'Looking up.', rooms: String(cid) } }); assert.equal(r.status, 302);
  r = await req(port, 'GET', '/studio?room=florence-2025', { cookie: ck }); assert.ok(r.body.includes('Florence, 2025') && r.body.includes('Test Dome'));
  r = await req(port, 'GET', '/rooms/florence-2025'); assert.equal(r.status, 200); assert.ok(r.body.includes('The city from below.'));
  r = await req(port, 'GET', `/studio/works/${w.slug}`, { cookie: ck }); assert.ok(r.body.includes('Catalogue record') && r.body.includes('Exhibition history'));
  // the vault: originals and seals are in the store; a fresh server fetches them back; backups land there
  const vk = await app.locals.store.list('originals/'); assert.ok(vk.length >= 1, 'original in the vault');
  fs.rmSync(path.join(dir, 'originals', w.original_file)); fs.rmSync(path.join(dir, 'cache'), { recursive: true, force: true });
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
  r = await req(port, 'GET', '/studio', { cookie }); assert.ok(r.body.includes('The trove') && r.body.includes('WM.'), 'trove with accession numbers');
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

  // ledger intact, and tamper is detected
  const ledger = require('../src/ledger');
  assert.ok(ledger.verify(db).ok); const n = ledger.verify(db).checked; assert.ok(n >= 5);
  db.prepare("UPDATE ledger SET data='{}' WHERE seq=1").run(); assert.equal(ledger.verify(db).ok, false, 'tamper detected');
  r = await req(port, 'GET', '/ledger'); assert.ok(r.body.includes('broken'));
  server.close(); console.log(`ok: ${n} ledger entries, all flows pass`);
})().catch(e => { console.error(e); process.exit(1); });
