// The house's share, paid by the collector (FEE_SIDE=collector): the maker names $5 and receives $5; the collector pays
// $7.11; a working use at $350 is paid at $402.50; the statement, the eye and the receipt all say the same split.
process.env.FEE_SIDE = 'collector';
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createApp } = require('../src/app');
const FEE = require('../src/fee');

(async () => {
  assert.ok(FEE.on()); assert.equal(FEE.total('social', 500), 711); assert.equal(FEE.total('editorial', 35000), 40250); assert.equal(FEE.makerFromTotal('social', 711), 500);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-fee-'));
  const stripeClient = require('stripe')('sk_test_dummy'); const sessions = {};
  stripeClient.checkout.sessions.create = async o => { const id = 'cs_' + Object.keys(sessions).length; sessions[id] = { id, ...o, url: 'https://checkout.stripe.test/' + id, payment_status: 'unpaid' }; return sessions[id]; };
  stripeClient.checkout.sessions.retrieve = async id => sessions[id];
  const app = createApp({ dataDir, adminPassword: 'pw', secret: 's', stripeKey: 'sk_test_dummy', stripePk: 'pk_test_dummy', stripeClient, webhookSecret: 'whsec_test', base: 'http://localhost', noTimers: true });
  const srv = app.listen(0); const port = srv.address().port, B = `http://localhost:${port}`;
  const form = o => new URLSearchParams(o).toString(), H = { 'content-type': 'application/x-www-form-urlencoded' };
  const { registerWork, db } = app.locals;
  const big = path.join(dataDir, 'big.jpg'); await require('sharp')(path.join(__dirname, 'fixture.jpg')).resize({ width: 6100, height: 4100, fit: 'fill' }).jpeg({ quality: 70 }).toFile(big);
  const tmp = path.join(dataDir, 'in.jpg'); fs.copyFileSync(big, tmp);
  const w = await registerWork({ file: tmp, originalName: 'x.jpg', title: 'Fee Dome', place: 'Florence' });
  db.prepare("UPDATE works SET status='held' WHERE id=?").run(w.id);
  // The wall shows the total; the API says the price and the split.
  let r = await fetch(B + `/w/${w.slug}`); let t = await r.text();
  assert.ok(t.includes('$7.11') && t.includes('The price is the photographer’s'), 'the Collect at $7.11, said plainly');
  r = await fetch(B + `/api/v1/works/${w.slug}`); const j = await r.json(); const col = j.uses.find(u => u.key === 'social'); assert.equal(col.price_cents, 711, 'the API carries what the collector pays');
  r = await fetch(B + `/api/eye/${w.slug}`); const eye = await r.json(); assert.ok(/every dollar/.test(eye.paid) && /\$2\.11/.test(eye.paid), 'the eye says the split');
  // A Collect paid by Checkout: the license is $7.11 with $2.11 the house's; the maker's statement says $5.
  r = await fetch(B + `/buy/${w.slug}`, { method: 'POST', headers: H, body: form({ use: 'social' }), redirect: 'manual' });
  const sid = r.headers.get('location').split('/').pop(); const s = sessions[sid]; assert.equal(s.line_items[0].price_data.unit_amount, 711, 'Checkout asks $7.11');
  const ref = s.metadata.ref; const l0 = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref); assert.equal(l0.house_cents, 211, 'the house’s part recorded at the sale');
  s.payment_status = 'paid'; s.amount_total = 711; s.customer_details = { email: 'c@example.com', name: 'Cora' };
  r = await fetch(B + `/thanks/${ref}?session_id=${sid}`); assert.equal(r.status, 200);
  const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref); assert.equal(l.status, 'active'); assert.equal(l.price_cents, 711); assert.equal(l.house_cents, 211);
  const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id); const st = app.locals.payouts.statement(m);
  assert.equal(st.share, 500, 'the maker’s statement: $5, every dollar of the price');
  // The receipt shows the split.
  r = await fetch(B + `/c/${ref}?k=${l.download_token}`); t = await r.text(); assert.ok(t.includes('$5 to the maker') && t.includes('$2.11 the house'), 'the receipt');
  // A working use: the maker's $350 is paid at $402.50.
  const u = db.prepare("SELECT * FROM uses WHERE maker_id=? AND key='editorial'").get(w.maker_id); assert.equal(u.price_cents, 35000);
  r = await fetch(B + `/buy/${w.slug}`, { method: 'POST', headers: H, body: form({ use: 'editorial' }), redirect: 'manual' });
  const s2 = sessions[r.headers.get('location').split('/').pop()]; assert.equal(s2.line_items[0].price_data.unit_amount, 40250, 'a story at $402.50');
  const l2 = db.prepare('SELECT * FROM licenses WHERE ref=?').get(s2.metadata.ref); assert.equal(l2.house_cents, 5250);
  // A license from before the switch (no house part recorded) still splits the old way, 85%.
  db.prepare("UPDATE licenses SET house_cents=NULL WHERE ref=?").run(ref); const st2 = app.locals.payouts.statement(m); assert.equal(st2.share, Math.round(711 * 85 / 100), 'an old license keeps its old split');
  srv.close(); console.log('ok: the house’s share, paid by the collector');
})().catch(e => { console.error(e); process.exit(1); });
