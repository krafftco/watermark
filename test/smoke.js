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
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', stripeKey: 'sk_test_dummy', webhookSecret: 'whsec_test' });
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

  // request (on-request price) -> studio grants
  r = await req(port, 'POST', `/license/${w.slug}`, { body: { use: 'editorial', name: 'Ann Editor', email: 'ann@mag.com', company: 'The Mag', intended: 'Feature, web', agree: '1' } });
  assert.equal(r.status, 200); const ref1 = /WM-\d{4}-\d{6}/.exec(r.body.toString())[0];
  r = await req(port, 'POST', `/license/${w.slug}`, { body: { use: 'editorial', name: 'x', email: 'bad' } }); assert.equal(r.status, 400);
  r = await req(port, 'GET', '/studio'); assert.equal(r.status, 302);
  r = await req(port, 'POST', '/studio/login', { body: { password: 'nope' } }); assert.equal(r.status, 401);
  r = await req(port, 'POST', '/studio/login', { body: { password: 'pw' } }); assert.equal(r.status, 302);
  const cookie = r.headers['set-cookie'][0].split(';')[0];
  r = await req(port, 'GET', '/studio', { cookie }); assert.equal(r.status, 200); assert.ok(r.body.includes('requests waiting'));
  r = await req(port, 'POST', `/studio/licenses/${ref1}/grant`, { cookie }); assert.equal(r.status, 302);
  const l1 = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref1); assert.equal(l1.status, 'active'); assert.ok(l1.ends_at);
  r = await req(port, 'GET', `/d/${l1.download_token}`); assert.equal(r.status, 200); assert.equal(r.body.length, fs.statSync(SRC).size, 'original delivered intact');
  r = await req(port, 'GET', `/verify?ref=${ref1}`); assert.ok(r.body.includes('active'));

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
