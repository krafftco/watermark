// Transparent, not cheap (#208; Will, 22 Nov: "Think Gagosian"). With COLLECT off (the default) no visitor path offers
// the Collect or the Reference, and no price sits on or over a picture; each work page carries its wall label (maker,
// title, year, the edition and what remains, the print's price in plain figures where a print is offered). What was
// collected before stays held: the holder's room, the papers and the register entry are unchanged. COLLECT=on brings
// the offer back. Every sentence asserted here is a draft for Will.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
const V = require('../src/views');
(async () => {
  delete process.env.COLLECT; process.env.COLLECT = 'on'; // the house before #208, to make a holder
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-collectoff-'));
  const stripeClient = require('stripe')('sk_test_dummy'); const sessions = {};
  stripeClient.checkout.sessions.create = async o => { const id = 'cs_' + Object.keys(sessions).length; sessions[id] = { id, ...o, url: 'https://checkout.stripe.test/' + id, payment_status: 'unpaid' }; return sessions[id]; };
  stripeClient.checkout.sessions.retrieve = async id => sessions[id];
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'collectoff', stripeKey: 'sk_test_dummy', stripePk: 'pk_test_dummy', stripeClient, webhookSecret: 'whsec_test', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, accept: 'text/html', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const page = async (jar, p) => { const r = await go(jar, p); assert.equal(r.status, 200, `${p} answers 200, not ${r.status}`); return r.text(); };
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const put = async (title) => { const f = path.join(dir, `c-${++k}.jpg`); await sharp(fx).resize({ width: 6100 + k * 10, height: 4100, fit: 'fill' }).modulate({ hue: k * 50 }).jpeg({ quality: 70 }).toFile(f); const w = await app.locals.registerWork({ file: f, title, originalName: path.basename(f) }); db.prepare("UPDATE works SET status='held', taken_at='2024-06-01' WHERE slug=?").run(w.slug); return db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug); };
  const wc = await put('The Dome at Noon'); db.prepare('UPDATE works SET edition_size=10 WHERE id=?').run(wc.id);
  const wp = await put('The River in Flood'); let r = await form(studio, `/studio/works/${wp.slug}/editions`, { open: '1' }); assert.equal(r.status, 302, 'the Studio opens its print editions');
  const maker = db.prepare('SELECT * FROM makers WHERE id=?').get(wc.maker_id);

  // ---- before: a stranger collects No. 1 (COLLECT=on) ------------------------------------------------------------------
  const anna = {};
  let t = await page(anna, `/w/${wc.slug}`); assert.ok(t.includes('class="share-buy"'), 'with COLLECT=on the work page offers the Collect, as before');
  r = await form(anna, `/buy/${wc.slug}`, { use: 'social' }); const loc = r.headers.get('location') || ''; assert.ok(/checkout\.stripe\.test/.test(loc), 'Collect goes to payment: ' + loc);
  const s = sessions[loc.split('/').pop()]; s.payment_status = 'paid'; s.amount_total = s.line_items[0].price_data.unit_amount; s.customer_details = { email: 'anna@example.com', name: 'Anna' };
  await page(anna, `/thanks/${s.metadata.ref}?session_id=${s.id}`);
  const held = db.prepare('SELECT * FROM licenses WHERE ref=?').get(s.metadata.ref); assert.equal(held.status, 'active'); assert.equal(held.collector_no, 1);
  const entries = db.prepare('SELECT COUNT(*) n FROM ledger').get().n;
  const before = { cert: await page(anna, `/c/${held.ref}?k=${held.download_token}`), yours: await page(anna, '/yours') };
  console.log('ok: a piece collected before the switch');

  // ---- the switch: COLLECT off ------------------------------------------------------------------------------------------
  delete process.env.COLLECT;
  const OFFER = [/class="share-buy"/, /data-st-buy/, /class="gh-collect"/, /name="use" value="social"/, /name="use" value="reference"/, /A few dollars/i, /Collect No\./, /action="\/basket\/collect"/, /action="\/series\/[^"]+\/collect"/, /Collect the Reference/, /Collect it ·/, /Scan to make it yours/];
  // A price under $100 written as dollars. Not counted: the thank-you card and patronage (gifts to the maker, not a price
  // on a work; both are named in the pull request for Will).
  const CHEAP = /\$\s?(\d{1,2})(?:\.\d\d)?(?![\d,])/g;
  const read = html => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<details class="lot-fold ty-fold"[\s\S]*?<\/details>/g, ' ').replace(/<section class="pat" id="patron">[\s\S]*?<\/section>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·');
  const bad = []; const stranger = {};
  const check = (p, html, prices) => {
    for (const re of OFFER) if (re.test(html)) bad.push(`${p}: ${re}`);
    if (prices) for (const m of read(html).matchAll(CHEAP)) bad.push(`${p}: a price under $100 beside a picture: ${m[0]}`);
  };
  // Every door, as a stranger, for any Collect offer.
  const doors = new Set(['/', '/house', '/collection', '/everything', '/wander', '/look', '/art', '/basket', '/yours/standing']);
  for (const [, list] of V.DOORS) for (const [h] of list) doors.add(h);
  for (const p of doors) { const x = await go(stranger, p); if (x.status === 200 && /html/.test(x.headers.get('content-type') || '')) check(p, await x.text(), false); }
  // Where a picture is: the work pages, Wander (page and feed), the front, the collection: no offer and no cheap price.
  for (const p of [`/w/${wc.slug}`, `/w/${wp.slug}`, `/m/${maker.handle}`, '/', '/collection', `/wander?at=${wc.slug}`, `/wander?maker=${maker.handle}`]) check(p, await page(stranger, p), true);
  for (const p of ['/api/wander', `/api/stroll?at=${wc.slug}`]) { const x = await go(stranger, p, { headers: { accept: 'application/json' } }); if (x.status !== 200) continue; const j = await x.text(); assert.ok(!/"collect":\{/.test(j), `${p}: no Collect in Wander's feed`); assert.ok(!/"printOpen":\{/.test(j), `${p}: no print price over a picture`); }
  assert.deepStrictEqual(bad, [], 'no Collect offer, no price under $100 beside a picture:\n  ' + bad.join('\n  '));
  console.log('ok: no Collect offer on any door, no price on or over a picture');

  // ---- the doors themselves refuse a new Collect -----------------------------------------------------------------------
  const ben = {};
  r = await form(ben, `/buy/${wc.slug}`, { use: 'social' }); assert.ok(!/checkout\.stripe\.test/.test(r.headers.get('location') || ''), 'POST /buy with Collect does not reach payment');
  r = await form(ben, `/buy/${wp.slug}`, { use: 'social' }); assert.ok(!/checkout\.stripe\.test/.test(r.headers.get('location') || ''), 'nor on another work');
  r = await go(ben, `/pay/${wc.slug}`, { method: 'POST', headers: { accept: 'application/json' } }); assert.equal(r.status, 404, 'the express Collect is closed');
  t = await page(ben, `/license/${wc.slug}`); { const m = t.match(/.{200}(name="use"[^>]*value="(social|reference)"|data-holds-for="(social|reference)").{100}/); assert.ok(!m, 'the licence check offers no Collect: ' + (m && m[0])); }
  assert.equal(app.locals.collectFor(null, wp.slug), null, 'the letter and the basket find nothing to collect');
  const wj = app.locals.workJSON(wc); assert.ok(!wj.uses.some(u => u.key === 'social' || u.key === 'reference'), 'the public record lists no Collect');
  console.log('ok: Collect is closed at /buy, /pay, the licence check, the basket and the record');

  // ---- the wall label ---------------------------------------------------------------------------------------------------
  const label = html => { const m = html.match(/<div class="wlb" id="label">([\s\S]*?)<\/div>/); return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : null; };
  t = await page(stranger, `/w/${wp.slug}`); let L = label(t);
  assert.ok(L, 'the work page carries its wall label');
  const eds = app.locals.editions.forWork(wp); const total = c => V.money(require('../src/fee').total('print', c));
  assert.ok(L.startsWith(maker.name) && L.includes('The River in Flood') && L.includes('2024'), 'the label: maker, title, year: ' + L);
  for (const e of eds) assert.ok(L.includes(`Edition of ${e.edition_n} · ${e.left} remain`) && L.includes(total(e.price_cents)), `the label carries the ${e.label} print, its edition and its price: ${L}`);
  assert.ok(!/on request/i.test(L), 'never "on request"');
  assert.ok(t.indexOf('class="wlb"') > t.indexOf('class="plate"') && !/<figure[^>]*>[^]*?class="wlb"[^]*?<\/figure>/.test(t.slice(t.indexOf('class="plate"') - 200, t.indexOf('class="wlb"'))), 'the label hangs under the picture, not over it');
  t = await page(stranger, `/w/${wc.slug}`); L = label(t);
  assert.ok(L.includes('Edition of 10 · 1 held'), 'the Collect edition: what is held, and no new issue: ' + L);
  assert.ok(!/\buse=(editorial|commercial|campaign)"[^>]*>[^<]*<span class="un">[^<]*<\/span><span class="up">/.test(t), 'a licence keeps its price inside the licence check');
  assert.ok(!t.includes('The first collector will be No.'), 'no invitation to be the first collector');
  console.log('ok: the label: ' + L);

  // ---- the holder: unchanged -------------------------------------------------------------------------------------------
  const after = { cert: await page(anna, `/c/${held.ref}?k=${held.download_token}`), yours: await page(anna, '/yours') };
  const now = db.prepare('SELECT * FROM licenses WHERE ref=?').get(held.ref);
  assert.deepStrictEqual({ ...now }, { ...held }, 'the licence row is unchanged');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ledger').get().n, entries, 'nothing was written to the register by the switch');
  const strip = h => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\b(nonce|data-t|data-at)="[^"]*"/g, '');
  assert.equal(strip(after.cert), strip(before.cert), 'the certificate (the papers) renders exactly as before');
  assert.ok(after.yours.includes(wc.slug) && after.yours.includes('No. 1'), "the holder's room still shows the piece");
  t = await page(anna, `/w/${wc.slug}`); assert.ok(t.includes('id="yours"') && t.includes(`/c/${held.ref}`), 'the work page still shows the holder their piece');
  r = await go(anna, `/d/${held.download_token}`); assert.ok([200, 302].includes(r.status), 'the holder still downloads: ' + r.status);
  console.log('ok: what was held stays held: the papers, the room, the register');

  // ---- reversible --------------------------------------------------------------------------------------------------------
  process.env.COLLECT = 'on';
  t = await page(stranger, `/w/${wp.slug}`); assert.ok(t.includes('class="share-buy"'), 'COLLECT=on brings the offer back');
  delete process.env.COLLECT;
  console.log('ok: COLLECT=on reverses it');
  srv.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
