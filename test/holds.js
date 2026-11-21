// What you hold (#176). A stranger walks collect, a license for a use, a print, a print of an open museum work and a
// resale, and at each of the three moments (before paying, on the papers, at resale) reads the one statement, built in
// src/holds.js and nowhere else: what you hold, what you may do, what stays with the maker, what happens when you pass
// it on. Also held here:
//   - none of the words a visitor never reads appears on those pages (src/holds.js NEVER);
//   - the market's pages show a stranger what is offered and what is asked, never a count or a sum of what has sold,
//     never "last traded" or "issued at" (#165's who()), and say "the maker" and "the register";
//   - the certificate's "You can / You can't" follows the agreement the holder accepted (9.3), not the other way.
// Every sentence asserted here is a draft for Will.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
const H = require('../src/holds');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-holds-'));
  const stripeClient = require('stripe')('sk_test_dummy'); const sessions = {};
  stripeClient.checkout.sessions.create = async o => { const id = 'cs_' + Object.keys(sessions).length; sessions[id] = { id, ...o, url: 'https://checkout.stripe.test/' + id, payment_status: 'unpaid' }; return sessions[id]; };
  stripeClient.checkout.sessions.retrieve = async id => sessions[id];
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'holds', stripeKey: 'sk_test_dummy', stripePk: 'pk_test_dummy', stripeClient, webhookSecret: 'whsec_test', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const walked = []; // every page a person read on this walk: [name, html]
  const page = async (jar, p, name) => { const r = await go(jar, p); assert.equal(r.status, 200, `${name || p} answers 200, not ${r.status}`); const t = await r.text(); if (name) walked.push([name, t]); return t; };
  const signin = async (jar, email) => { app.locals.lastCode = null; await form(jar, '/signin/code', { email }); await form(jar, '/signin/verify', { email, code: app.locals.lastCode.code }); };
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  // What a person reads: the words between the tags, and the words in the attributes that are read aloud or shown.
  const unesc = s => s.replace(/&rsquo;|&#8217;/g, '’').replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const read = html => { const h = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '); const attrs = [...h.matchAll(/\s(?:alt|title|aria-label|placeholder)="([^"]*)"/g)].map(m => m[1]).join(' '); return unesc(`${h.replace(/<[^>]+>/g, ' ')} ${attrs}`).replace(/\s+/g, ' '); };
  // The statement on a page: the element built by src/holds.js, by its kind.
  const said = (html, kind) => { const m = html.match(new RegExp(`<p class="holds[^"]*" data-holds="${kind}"[^>]*>([\\s\\S]*?)</p>`)); return m ? unesc(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : null; };
  const four = (s, name) => { for (const part of ['hold', 'may', 'stays', 'pass']) assert.ok(s[part] && s.text.includes(s[part]), `${name}: the ${part} sentence is in the statement`); };
  const has = (html, s, name) => { const t = said(html, s.kind); assert.ok(t, `${name}: the statement (${s.kind}) is on the page`); assert.ok(t.endsWith(s.text), `${name}: it is the one statement, word for word.\n  page: ${t}\n  code: ${s.text}`); };

  // ---- the house: a numbered edition, a work with a print edition, an open museum work ------------------------------
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const put = async (title, extra = {}) => { const f = path.join(dir, `h-${++k}.jpg`); await sharp(fx).resize({ width: 6100 + k * 10, height: 4100, fit: 'fill' }).modulate({ hue: k * 40 }).jpeg({ quality: 70 }).toFile(f); const w = await app.locals.registerWork({ file: f, title, originalName: path.basename(f), ...extra }); db.prepare("UPDATE works SET status='held' WHERE slug=?").run(w.slug); return db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug); };
  const wc = await put('The Dome at Noon'); db.prepare('UPDATE works SET edition_size=10 WHERE id=?').run(wc.id);
  const wp = await put('The River in Flood'); let r = await form(studio, `/studio/works/${wp.slug}/editions`, { open: '1' }); assert.equal(r.status, 302, 'the Studio opens its print editions');
  const wo = await put('A Vase of Flowers'); db.prepare("UPDATE works SET open='cc0' WHERE id=?").run(wo.id);
  const maker = db.prepare('SELECT * FROM makers WHERE id=?').get(wc.maker_id); const M = maker.name;
  const use = key => db.prepare('SELECT * FROM uses WHERE maker_id=? AND key=?').get(maker.id, key);
  const pay = async (r0, email, name) => { const loc = r0.headers.get('location') || ''; assert.ok(/checkout\.stripe\.test/.test(loc), 'the press goes to the payment page: ' + r0.status + ' ' + loc); const s = sessions[loc.split('/').pop()]; s.payment_status = 'paid'; s.amount_total = s.line_items[0].price_data.unit_amount; s.customer_details = { email, name }; return s; };

  // ---- the one statement, by kind (the code's own account of itself) -------------------------------------------------
  const S = {
    collectWill: H.statement({ use: use('social'), maker: M, edition: true, will: true }),
    licenseWill: H.statement({ use: use('editorial'), maker: M, will: true }),
    printWill: H.statement({ use: use('print'), maker: M, will: true }),
    openWill: H.statement({ use: { key: 'print', kind: 'print' }, open: 'cc0', will: true }),
  };
  for (const [n, s] of Object.entries(S)) four(s, n);
  assert.deepStrictEqual([S.collectWill.kind, S.licenseWill.kind, S.printWill.kind, S.openWill.kind], ['collect', 'license', 'print', 'open'], 'each kind of holding has its own sentence');
  assert.ok(/^You will hold a numbered, personal copy of this work/.test(S.collectWill.hold) && S.collectWill.stays.includes(`The copyright stays with ${M}`), 'collect: ' + S.collectWill.text);
  assert.ok(S.collectWill.pass.includes('whole to one other person through the house') && S.collectWill.pass.includes('10% of the price goes to') && S.collectWill.pass.includes('365 days'), 'collect, passed on: the register, the royalty, the holding time');
  assert.ok(/for 1 year from the day of your order/.test(S.licenseWill.hold) && S.licenseWill.may.includes('editorial works') && /^It is not passed on/.test(S.licenseWill.pass), 'a license for a use: ' + S.licenseWill.text);
  assert.ok(S.printWill.stays.includes('no right to copy the picture') && S.printWill.pass.includes('yours to sell or to give'), 'a print: ' + S.printWill.text);
  assert.ok(S.openWill.stays.includes('public domain') && !S.openWill.text.includes('copyright stays'), 'a print of an open work: ' + S.openWill.text);
  // The statement follows the order's own terms, never the other way: a working license the maker made transferable says so.
  assert.ok(H.statement({ use: use('editorial'), t: { transferable: true }, maker: M }).pass.includes('whole to one other person'), 'a license its terms make transferable');
  process.env.MARKET_HOLD_DAYS = '0'; assert.ok(!H.statement({ use: use('social'), maker: M, edition: true }).pass.includes('days'), 'no holding time, nothing said of it'); delete process.env.MARKET_HOLD_DAYS;
  console.log('ok: one statement, four kinds');

  // ---- 1. before paying ----------------------------------------------------------------------------------------------
  const anna = {}; // a stranger: no account
  let t = await page(anna, `/w/${wc.slug}`, 'the work page (Collect)'); has(t, S.collectWill, 'the work page');
  t = await page(anna, `/license/${wc.slug}?use=editorial`, 'the license page');
  for (const key of ['social', 'editorial', 'commercial', 'campaign']) { const m = t.match(new RegExp(`<p class="holds" data-holds="[a-z]+" data-holds-for="${key}"( hidden)?>`)); assert.ok(m, `the license page carries the statement for ${key}`); assert.equal(!!m[1], key !== 'editorial', `only the chosen use's statement shows (${key})`); }
  assert.ok(t.includes(`data-holds-for="editorial">`) && unesc(t).includes(S.licenseWill.text), 'the license page: the chosen use, word for word');
  anna.wm_bk = wc.slug; t = await page(anna, '/basket', 'the basket'); has(t, H.statement({ use: use('social'), maker: 'its maker', edition: true, will: true }), 'the basket'); delete anna.wm_bk;
  t = await page(anna, `/w/${wp.slug}`, 'the work page (a print)'); has(t, S.printWill, 'the print on the work page');
  t = await page(anna, `/w/${wo.slug}`, 'the work page (an open work)'); has(t, S.openWill, 'the print of an open work'); assert.ok(!said(t, 'collect'), 'an open work is not offered as a collected piece');
  console.log('ok: before paying');

  // ---- 2. on the papers ----------------------------------------------------------------------------------------------
  // Collect.
  r = await form(anna, `/buy/${wc.slug}`, { use: 'social' }); let s = await pay(r, 'anna@example.com', 'Anna'); const cref = s.metadata.ref;
  t = await page(anna, `/thanks/${cref}?session_id=${s.id}`, 'the thank-you page (Collect)');
  const cl = db.prepare('SELECT * FROM licenses WHERE ref=?').get(cref); assert.equal(cl.status, 'active'); assert.ok(cl.collector_no, 'numbered');
  const held = H.statement(H.ofLicense(cl, use('social'), db.prepare('SELECT * FROM works WHERE id=?').get(wc.id), M));
  assert.ok(held.hold.startsWith(`You hold No. ${cl.collector_no} of 10: a numbered, personal copy`), 'the papers say the number: ' + held.hold);
  has(t, held, 'the thank-you page');
  t = await page(anna, `/c/${cref}?k=${cl.download_token}`, 'the certificate (Collect)'); has(t, held, 'the certificate');
  assert.ok(t.includes('Pass it on, whole, to one other person through the house') && !t.includes('Pass the license to someone else'), 'the certificate\'s list follows the agreement (9.3): a collected piece may pass on');
  t = await page(anna, `/yours/p/${cref}?k=${cl.download_token}`, 'the holder’s room'); has(t, held, 'the holder’s room'); assert.ok(t.includes('What you hold, and the proof of it.'));
  t = await page(anna, `/c/${cref}/contract?k=${cl.download_token}`, 'the agreement'); assert.ok(t.includes('recorded on the register'), 'the agreement page says the register');
  assert.ok(t.includes('transfer recorded on the Watermark register'), 'and the agreement itself is where "pass it on" comes from (9.3)');
  const L = (app.locals.mailLog || []).find(m => m.to === 'anna@example.com' && /is yours/.test(m.subject || '')); assert.ok(L && L.text, 'the collector\'s letter was written');
  L.html = await page(studio, `/studio/letters?ref=${cref}`); // the same letter as it arrives, drawn by the house (nothing is sent)
  assert.ok(L.text.includes(`What you hold. ${held.text}`) && unesc(L.html).includes(held.text), 'the letter carries the statement, in words and in the page');
  walked.push(['the letter (Collect)', L.html]);
  // A license for a use.
  const ben = {}; r = await form(ben, `/buy/${wc.slug}`, { use: 'editorial' }); s = await pay(r, 'ben@example.com', 'Ben'); const lref = s.metadata.ref;
  t = await page(ben, `/thanks/${lref}?session_id=${s.id}`, 'the thank-you page (a license)'); const ll = db.prepare('SELECT * FROM licenses WHERE ref=?').get(lref); assert.equal(ll.status, 'active');
  const lheld = H.statement(H.ofLicense(ll, use('editorial'), wc, M)); assert.equal(lheld.kind, 'license'); has(t, lheld, 'the thank-you page (a license)');
  t = await page(ben, `/c/${lref}?k=${ll.download_token}`, 'the certificate (a license)'); has(t, lheld, 'the certificate (a license)');
  assert.ok(t.includes('Pass the license to someone else') && !t.includes('Pass it on, whole'), 'a working license stays with its holder, as its agreement says');
  // A print.
  const cy = {}; const ed = db.prepare('SELECT * FROM print_editions WHERE work_id=? ORDER BY sort LIMIT 1').get(wp.id);
  r = await form(cy, `/w/${wp.slug}/print`, { edition: String(ed.id) }); s = await pay(r, 'cy@example.com', 'Cy'); const pref = s.metadata.ref;
  t = await page(cy, `/thanks/${pref}?session_id=${s.id}`, 'the thank-you page (a print)'); const pl = db.prepare('SELECT * FROM licenses WHERE ref=?').get(pref); assert.equal(pl.status, 'active');
  const pheld = H.statement(H.ofLicense(pl, use('print'), wp, M)); assert.equal(pheld.kind, 'print'); has(t, pheld, 'the thank-you page (a print)');
  t = await page(cy, `/c/${pref}?k=${pl.download_token}`, 'the certificate (a print)'); has(t, pheld, 'the certificate (a print)');
  // A print of an open museum work.
  const di = {}; r = await form(di, `/w/${wo.slug}/openprint`, { size: '5x7' }); s = await pay(r, 'di@example.com', 'Di'); const oref = s.metadata.ref;
  t = await page(di, `/thanks/${oref}?session_id=${s.id}`, 'the thank-you page (an open print)'); const ol = db.prepare('SELECT * FROM licenses WHERE ref=?').get(oref); assert.equal(ol.status, 'active');
  const oheld = H.statement(H.ofLicense(ol, use('print'), db.prepare('SELECT * FROM works WHERE id=?').get(wo.id), M)); assert.equal(oheld.kind, 'open'); has(t, oheld, 'the thank-you page (an open print)');
  assert.ok(!said(t, 'print') && !oheld.text.includes('copyright stays'), 'an open work claims no copyright for anyone');
  console.log('ok: on the papers');

  // ---- 3. at resale --------------------------------------------------------------------------------------------------
  await signin(anna, 'anna@example.com'); const ab = db.prepare("SELECT * FROM buyers WHERE lower(email)='anna@example.com' ORDER BY id LIMIT 1").get();
  db.prepare('UPDATE licenses SET buyer_id=? WHERE ref=?').run(ab.id, cref);
  // Inside the holding time the holder is told the day; the piece is not listed.
  r = await form(anna, '/yours/offer', { ref: cref, ask: '900', back: `/w/${wc.slug}` }); assert.ok(r.headers.get('location').includes('up=held'), 'held: ' + r.headers.get('location'));
  db.prepare("UPDATE licenses SET starts_at=datetime('now','-400 days') WHERE ref=?").run(cref);
  t = await page(anna, `/w/${wc.slug}`, 'the work page (its holder, offering)'); assert.ok(unesc(t).includes(H.offering(M)), 'the offer form says what happens when it sells, from the one place');
  t = await page(anna, '/yours?tab=files'); assert.ok(unesc(t).includes(H.offering(M)), 'and in the gallery');
  assert.ok(H.offering(M).includes('10% of the price goes to') && H.offering(M).includes('5% to the house') && H.offering(M).includes('365 days'), 'the royalty, the fee, the holding time: ' + H.offering(M));
  r = await form(anna, '/yours/offer', { ref: cref, ask: '900' }); assert.ok(r.headers.get('location').includes('offer=1'), 'offered: ' + r.headers.get('location'));
  const lst = db.prepare("SELECT id FROM listings WHERE status='open' ORDER BY id DESC LIMIT 1").get().id;
  // Another piece of the same work has changed hands before, at a price: a stranger must not learn it.
  const other = db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, price_cents, status, starts_at, collector_no, download_token, rights) VALUES ('WM-2026-900001', ?, ?, 'O', 'o@example.com', 4321, 'active', datetime('now','-500 days'), 9, 'tok-o', ?)").run(wc.id, use('social').id, JSON.stringify({ transferable: true })).lastInsertRowid;
  db.prepare("INSERT INTO trades (license_id, price_cents, royalty_cents, fee_cents, at) VALUES (?, 77700, 7770, 3885, datetime('now','-30 days'))").run(other);
  const eve = {}; // a stranger at the market
  t = await page(eve, '/market', 'the market'); const mt = read(t);
  assert.ok(mt.includes('The Dome at Noon') && mt.includes('$900'), 'a stranger sees what is offered and what is asked');
  for (const bad of ['traded in all', ' traded ', 'last traded', 'issued at', '$777', '$43.21', 'Neither side', 'photographer', 'Buy it now', 'settles']) assert.ok(!mt.toLowerCase().includes(bad.toLowerCase()), `/market, a stranger: "${bad}" is not said`);
  assert.ok(/<p class="mk-stats"><span><b>1<\/b> offered<\/span><\/p>/.test(t), 'the head counts what is offered and nothing else');
  assert.ok(mt.includes('recorded on the register') && mt.includes('Prices here are what collectors ask. They are not valuations or advice.'), 'the register; and the line that stays');
  has(t, H.statement({ use: use('social'), maker: 'its maker', edition: true, will: true }), 'the market');
  t = await page(eve, `/market/${lst}`, 'the market’s offer page'); const lt = read(t);
  const resale = H.statement(H.ofLicense(db.prepare('SELECT * FROM licenses WHERE ref=?').get(cref), use('social'), db.prepare('SELECT * FROM works WHERE id=?').get(wc.id), M, { will: true }));
  has(t, resale, 'the offer page'); assert.ok(resale.hold.startsWith(`You will hold No. ${cl.collector_no} of 10`) && resale.pass.includes('365 days') && resale.pass.includes('10% of the price'), 'the same statement, the royalty, the holding time that will apply: ' + resale.text);
  for (const bad of ['last traded', 'issued at', '$777', '$43.21', 'photographer', 'Buy it now', 'settle']) assert.ok(!lt.toLowerCase().includes(bad.toLowerCase()), `/market/:id, a stranger: "${bad}" is not said`);
  assert.ok(lt.includes('To the maker') && lt.includes('$900'), 'the asking price, and the maker\'s part');
  // The maker and the Studio still see their own (#165), in the words they had.
  t = await page(studio, '/market'); assert.ok(t.includes('traded in all') && t.includes('$777'), 'the Studio sees the totals');
  t = await page(studio, `/market/${lst}`); assert.ok(t.includes('Last traded') && t.includes('$777'), 'and the offer page\'s history');
  console.log('ok: at resale');

  // ---- the words a visitor never reads ---------------------------------------------------------------------------------
  const never = new RegExp(`\\b(${H.NEVER.map(x => x.replace(/[-]/g, '[- ]?')).join('|')})(s|ed|ing)?\\b`, 'i');
  assert.ok(never.test('written to the ledger') && never.test('Send it to a wallet') && never.test('an NFT') && never.test('on chain') && !never.test('the register records it'), 'the check itself works');
  assert.ok(walked.length >= 18, 'the walk read its pages: ' + walked.length);
  const found = []; for (const [name, html] of walked) { const txt = read(html); for (const m of txt.matchAll(new RegExp(never.source, 'gi'))) found.push(`${name}: "${m[0]}" (… ${txt.slice(Math.max(0, m.index - 70), m.index + 50)} …)`); }
  assert.deepStrictEqual(found, [], 'a visitor reads a word the house never says:\n' + found.join('\n'));
  for (const s0 of [...Object.values(S), held, lheld, pheld, oheld, resale]) assert.ok(!never.test(s0.text) && !/—/.test(s0.text), 'the statement itself: ' + s0.text);
  console.log(`ok: none of the words, on ${walked.length} pages`);

  // ---- in a browser, when there is one: the statement has a box (it is on the page for eyes, not only in its source) ----
  let pw = null; try { pw = require('playwright'); } catch (e) { /* not here */ }
  let browser = null; if (pw) { try { browser = await pw.chromium.launch(); } catch (e) { try { browser = await pw.chromium.launch({ channel: 'chrome' }); } catch (e2) { browser = null; } } }
  if (!browser) console.log('holds: the browser walk skipped (no browser here)');
  else {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); const pg = await ctx.newPage();
    for (const [name, p] of [['the work page', `/w/${wc.slug}`], ['the license page', `/license/${wc.slug}?use=editorial`], ['the print', `/w/${wp.slug}`], ['the certificate', `/c/${cref}?k=${cl.download_token}`], ['the thank-you page', `/thanks/${cref}?k=${cl.download_token}`], ['the market', '/market'], ['the offer page', `/market/${lst}`]]) {
      await pg.goto(base + p, { waitUntil: 'domcontentloaded' });
      const box = await pg.evaluate(() => { const e = [...document.querySelectorAll('.holds')].find(x => !x.hidden); if (!e) return null; const b = e.getBoundingClientRect(); return { w: b.width, h: b.height, right: b.right, vw: document.documentElement.clientWidth, size: parseFloat(getComputedStyle(e).fontSize) }; });
      assert.ok(box && box.w > 200 && box.h > 40 && box.right <= box.vw + 1 && box.size >= 14, `${name} at 390 wide: the statement has a box a person can read: ${JSON.stringify(box)}`);
    }
    // On the license page the statement follows the use chosen.
    await pg.goto(base + `/license/${wc.slug}?use=editorial`, { waitUntil: 'load' });
    await pg.evaluate(() => { const i = document.querySelector('.bu input[value="commercial"]'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); });
    const shown = await pg.evaluate(() => [...document.querySelectorAll('[data-holds-for]')].filter(x => !x.hidden).map(x => x.getAttribute('data-holds-for')));
    assert.deepStrictEqual(shown, ['commercial'], 'the statement changes with the use chosen: ' + shown);
    await browser.close(); console.log('ok: in a browser at 390 wide, the statement has its box');
  }

  srv.close(); fs.rmSync(dir, { recursive: true, force: true }); console.log('what you hold: all hold'); process.exit(0);

})().catch(e => { console.error(e); process.exit(1); });
