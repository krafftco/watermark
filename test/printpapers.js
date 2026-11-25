// A print buyer's papers match what they bought (#224), and the public certificate shows only what proves the piece
// (Will, 24 Nov). Walked through the house's own doors with the payment provider stood in for, as test/firstsale.js does:
//   - Cora buys a print its maker makes and sends. The thank-you page, her room, the certificate, the PDF and the receipt
//     letter speak of a print: where the order is, the papers, "What you hold", when the maker is paid. None of them
//     speaks of a file, downloads, printing it yourself, a proof, or "is licensed to";
//   - signed out, the certificate names no holder, no price and no split; the holder and the maker see all of it; the
//     holder may tick to show their name (never the price);
//   - the work page offers the print once (the "On a wall" way leads to the edition); the license page says the total
//     and both parts of it; letters wrap their links and say "Type it, or tap it." only beside a code.
process.env.NODE_ENV = 'test';
process.env.FEE_SIDE = process.env.FEE_SIDE || 'collector';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp'); const crypto = require('crypto');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-printpapers-'));
  const stripeClient = require('stripe')('sk_test_dummy'); const sessions = {};
  stripeClient.checkout.sessions.create = async o => { const id = 'cs_' + Object.keys(sessions).length; sessions[id] = { id, ...o, url: 'https://checkout.stripe.test/' + id, payment_status: 'unpaid' }; return sessions[id]; };
  stripeClient.checkout.sessions.retrieve = async id => sessions[id];
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'printpapers', stripeKey: 'sk_test_dummy', stripePk: 'pk_test_dummy', stripeClient, webhookSecret: 'whsec_test', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const page = async (jar, p) => { const r = await go(jar, p); assert.equal(r.status, 200, `${p} answers 200, not ${r.status} ${r.headers.get('location') || ''}`); return r.text(); };
  const text = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&times;/g, '×').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const main = h => { const t = text(h); const i = t.indexOf('We recommend you wander'); return i > 0 ? t.slice(0, i) : t; }; // the page, without the house's footer ("Print your work")
  const settle = () => new Promise(r => setTimeout(r, 60));
  const say = (...a) => console.log('printpapers:', ...a);
  const letters = to => (app.locals.mailLog || []).filter(m => m.to === to);
  // What a print buyer never reads about their print.
  const FILE = [/your file/i, /downloads? left/i, /download the/i, /take the (print )?file/i, /print it yourself/i, /the proof[,:] /i, /hold it in your hand/i, /ask for the proof/i, /is licensed to/i, /licensed to/i, /license page/i, /carries its license inside/i, /save the photograph/i, /instax/i, /has been paid/i];
  const clean = (t, where) => { for (const re of FILE) assert.ok(!re.test(t), `${where} never says ${re}: “${(t.match(new RegExp(`.{0,60}${re.source}.{0,60}`, 'i')) || [''])[0]}”`); for (const w of require('../src/holds').NEVER) assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(t.replace(/Text fingerprint|Fingerprint/g, '')), `${where} never says “${w}”`); };

  // ---- the maker, a master, a print they make and send -------------------------------------------------------------
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  await form(studio, '/studio/accounts', { name: 'Mara Lind', email: 'mara@example.com' });
  const link = (letters('mara@example.com').find(m => /invitation/i.test(m.subject)).text.match(/http:\/\/localhost(\/account\/join\/[\w-]+)/) || [])[1];
  const mara = {}; let r = await go(mara, link); await page(mara, r.headers.get('location'));
  const M = db.prepare("SELECT * FROM makers WHERE email='mara@example.com'").get();
  const buf = await sharp(path.join(__dirname, 'fixture.jpg')).resize({ width: 6000, height: 4000, fit: 'fill' }).jpeg({ quality: 88 }).toBuffer();
  const st = await form(mara, '/account/arrivals/start', { name: 'ferry.jpg', size: buf.length, type: 'image/jpeg', sha256: crypto.createHash('sha256').update(buf).digest('hex') }).then(x => x.json()); assert.ok(st.ok, JSON.stringify(st));
  if (!st.direct) await go(mara, `/account/arrivals/${st.id}/body`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buf });
  let w = null; for (let k = 0; k < 600 && !w; k++) { const a = db.prepare('SELECT status, slug, error FROM arrivals WHERE id=?').get(st.id); if (a.status === 'done') w = db.prepare('SELECT * FROM works WHERE slug=?').get(a.slug); else if (a.status === 'failed') throw new Error(a.error); else await new Promise(x => setTimeout(x, 100)); }
  assert.ok(w, 'the master arrived');
  await form(mara, `/account/works/${w.slug}/show`, { attest: '1' });
  await form(mara, `/account/works/${w.slug}/editions`, { new: '1', label: '16 × 20', paper: 'Hahnemühle Photo Rag', edition_n: '10', price: '300' });
  const ed = db.prepare('SELECT * FROM print_editions WHERE work_id=?').get(w.id); assert.equal(ed.made_by, 'maker');

  // ---- one print, one price on the work's page (item 3); the total said right on the license page (item 2) ---------
  const wp = await page({}, `/w/${w.slug}`);
  assert.ok(!new RegExp(`/license/${w.slug}\\?use=print`).test(wp), 'with an edition on offer, the work page has no second door to a print at another price');
  if (/class="use /.test(wp) || /class="use"/.test(wp)) assert.ok(/class="use use-ed" href="#print"/.test(wp), 'the "On a wall" way leads to the edition');
  r = await go({}, `/license/${w.slug}`);
  if (r.status === 200) { const lp = text(await r.text());
    assert.ok(!/Every dollar of it is Mara’s; the house’s share[^.]*is paid on top/.test(lp), 'the license page no longer says the total is all the maker’s with the share on top');
    const m = lp.match(/Of \$([\d,]+) [a-z ]+, \$([\d,]+) is Mara’s and \$([\d,]+) is the house’s share\./); assert.ok(m, 'it says the total and both parts: ' + (lp.match(/Mara says[\s\S]{0,400}/) || [''])[0]);
    const n = x => Number(x.replace(/,/g, '')); assert.equal(n(m[1]), n(m[2]) + n(m[3]), 'and the parts add up to the total'); assert.ok(lp.includes(`$${m[1]}`)); }
  say('1. the work page offers the print once; the license page says the total, the maker’s part and the house’s share');

  // ---- Cora buys it --------------------------------------------------------------------------------------------------
  const cora = {}; app.locals.lastCode = null; await form(cora, '/signin/code', { email: 'cora@example.com' }); await form(cora, '/signin/verify', { email: 'cora@example.com', code: app.locals.lastCode.code });
  r = await form(cora, `/w/${w.slug}/print`, { edition: String(ed.id) });
  const s = sessions[(r.headers.get('location') || '').split('/').pop()]; assert.ok(s, 'the press goes to payment');
  const paidBefore = s.line_items[0].price_data.unit_amount; assert.equal(paidBefore, 36000, 'the price is as it was: $300 and the house’s $60');
  s.payment_status = 'paid'; s.amount_total = 36000; s.customer_details = { email: 'cora@example.com', name: 'Cora Bell' }; s.collected_information = { shipping_details: { name: 'Cora Bell', address: { line1: '12 Orchard St', city: 'New York', state: 'NY', postal_code: '10002', country: 'US' } } };
  const ref = s.metadata.ref; const thanks = await page(cora, `/thanks/${ref}?session_id=${s.id}`); await settle();
  const L = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref); assert.equal(L.status, 'active'); assert.equal(L.download_token, null, 'a print has no file key');
  assert.deepStrictEqual([L.price_cents, L.house_cents], [36000, 6000], 'no price, share or fee changed');
  const o = db.prepare('SELECT * FROM print_orders WHERE license_id=?').get(L.id);
  const PAID = 'Mara Lind’s part clears when the print is sent, and goes to them on the Friday after.';

  // the thank-you page
  let t = main(thanks); clean(t, 'the thank-you page');
  assert.ok(t.includes('No. 1 of 10') && t.includes('Its papers are in your gallery.'), 'the print’s own number, and where its papers are');
  assert.ok(t.includes('What you hold. You hold a print of this work: an object that is yours.'), 'What you hold');
  assert.ok(t.includes('Mara Lind makes it and sends it; you will be told when it is on its way.') && t.includes(PAID), 'where it is, and when the maker is paid');
  assert.ok(thanks.includes(`href="/yours/p/${ref}"`) && t.includes('Your print, and where it is') && t.includes('The papers'), 'the way to the order and the papers');

  // her room
  const roomH = await page(cora, `/yours/p/${ref}`); t = main(roomH); clean(t, 'the room');
  assert.ok(t.includes('It is with Mara Lind, who makes and sends it.'), 'the order’s status: ' + t.slice(0, 600));
  assert.ok(t.indexOf('It is with Mara Lind') < t.indexOf('What you hold, and the proof of it'), 'the status is above the papers');
  assert.ok(t.includes('16 × 20 in, Hahnemühle Photo Rag, No. 1 of 10.') && t.includes(PAID), 'the print, its number, and when the maker is paid');
  assert.ok(t.includes('What you hold. You hold a print of this work') && t.includes('the print carries no right to copy the picture'), 'What you hold, from src/holds.js');
  assert.ok(t.includes('The certificate') && t.includes('The agreement') && t.includes('The Watermark number'), 'the papers');
  assert.ok(!/kp-print|kp-file|kp-proof|kp-rec|kp-live/.test(roomH) && !/\/d\//.test(roomH) && !/\/proof"/.test(roomH), 'no file, print-it-yourself, proof or record-a-print block');
  r = await go(cora, `/c/${ref}/contract`); assert.equal(r.status, 200, 'the holder can read the agreement they accepted (a print has no file key)');
  r = await go({}, `/c/${ref}/contract`); assert.equal(r.status, 302, 'a stranger cannot');
  // the line on You
  t = text(await page(cora, '/yours')); assert.ok(t.includes('is with Mara Lind, who makes and sends it') && !t.includes('with the print room'), 'You says the print is with its maker, not the print room');
  const you = await page(cora, '/yours?k=collected'); assert.ok(!new RegExp(`/yours/p/${ref}#print`).test(you) && !new RegExp(`/yours/p/${ref}/instax`).test(you), 'the piece’s menu offers no file to print from');
  const files = await page(cora, '/yours?tab=files'); assert.ok(!/wallet/i.test(text(files)), '(#176) the papers tab never says wallet'); assert.ok(!new RegExp(`name="ref" value="${ref}"><input name="size"`).test(files), 'no "record a print" for a bought print');
  say('2. bought: the thank-you page and the room show the order, the papers and What you hold; nothing about a file');

  // ---- the certificate: the holder's, and the public one --------------------------------------------------------------
  const certH = await page(cora, `/c/${ref}`); t = main(certH); clean(t, 'the certificate (holder)');
  assert.ok(t.includes('Acquired') && t.includes('Held by Cora Bell') && t.includes('$360') && t.includes('$300 to the maker') && t.includes('$60 the house’s share'), 'the holder sees their name, the price and the split');
  assert.ok(t.includes('Your print. It is with Mara Lind, who makes and sends it.') && t.includes(PAID), 'and the order');
  assert.ok(t.includes('holds this print of it, No. 1 of 10, acquired on') && !/Licensing, simply/.test(t), 'the certificate of authenticity speaks of the print');
  const certP = await page({}, `/c/${ref}`); t = main(certP); clean(t, 'the certificate (public)');
  assert.ok(!/Cora/.test(certP) && !/cora@/.test(certP), 'signed out: no holder’s name anywhere on the page');
  assert.ok(!/\$\s?\d/.test(t) && !/house’s share/.test(t) && !/to the maker/.test(t), 'signed out: no price and no split: ' + (t.match(/.{0,40}\$\s?\d.{0,40}/) || [''])[0]);
  assert.ok(!/Your print\. It is/.test(t) && !/12 Orchard/.test(certP), 'nor the order');
  assert.ok(t.includes('Ferry') || t.includes(text(w.title)), 'the work'); assert.ok(t.includes('Mara Lind') && t.includes('No. 1 of 10') && t.includes('Acquired') && t.includes('its holder holds this print of it') && t.includes('acquired on') && t.includes('Watermark number'), 'what proves it: maker, number, date, held, the register');
  assert.ok(t.includes('Is this yours? Sign in to open it in your gallery.') && certP.includes(`/signin?next=${encodeURIComponent(`/yours/p/${ref}`)}`), 'a holder who is signed out is shown the way in');
  t = main(await page(mara, `/c/${ref}`)); assert.ok(t.includes('Held by Cora Bell') && t.includes('$360'), 'the maker sees it whole');
  t = main(await page(studio, `/c/${ref}`)); assert.ok(t.includes('Held by Cora Bell') && t.includes('$360'), 'the Studio sees it whole');
  // the tick: the name, never the price
  assert.equal(db.prepare('SELECT show_holder FROM licenses WHERE ref=?').get(ref).show_holder, 0, 'off by default');
  assert.ok(roomH.includes(`action="/yours/p/${ref}/name"`) && !/name="show" value="1" checked/.test(roomH), 'the tick is in the room, unticked');
  r = await form({}, `/yours/p/${ref}/name`, { show: '1' }); assert.equal(db.prepare('SELECT show_holder FROM licenses WHERE ref=?').get(ref).show_holder, 0, 'a stranger cannot tick it');
  r = await form(cora, `/yours/p/${ref}/name`, { show: '1' }); assert.match(r.headers.get('location'), /ok=name/);
  t = main(await page({}, `/c/${ref}`)); assert.ok(t.includes('Held by Cora Bell') && !/\$\s?\d/.test(t), 'ticked: the public page names the holder, and still no price');
  await form(cora, `/yours/p/${ref}/name`, {}); assert.ok(!/Cora/.test(await page({}, `/c/${ref}`)), 'unticked: the name is gone again');
  // the PDF answers for both (its words are checked by eye; a PDF's text is compressed)
  for (const jar of [cora, {}]) { r = await go(jar, `/c/${ref}.pdf`); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /pdf/); await r.arrayBuffer(); }
  say('3. the certificate: whole for the holder, the maker and the Studio; signed out, no name, no price, no split; the tick shows the name only');

  // ---- the receipt letter ---------------------------------------------------------------------------------------------
  const rec = letters('cora@example.com').find(m => /^Your print of/.test(m.subject)); assert.ok(rec, 'the receipt letter');
  clean(rec.text, 'the letter');
  assert.ok(/^Your print of /.test(rec.text) && rec.text.includes('No. 1 of 10') && rec.text.includes('What you hold. You hold a print of this work') && rec.text.includes(PAID) && rec.text.includes(`Your print, and its papers: http://localhost/yours/p/${ref}`), 'the letter: the print, its number, What you hold, when the maker is paid, the way to the order');
  assert.ok(!/#print/.test(rec.text), 'no link to print it yourself');
  const LET = require('../src/mail-letters'); const lf = LET.collected({ base: 'http://localhost', title: 'Ferry, Morning', maker: 'Mara Lind', name: 'Cora Bell', who: 'Cora Bell', kind: 'print', personal: false, useName: 'On a wall', no: 1, of: 10, can: ['Hang it'], cannot: ['Copy it'], holds: 'You hold a print of this work: an object that is yours.', fee: '$360', share: '$300', house: '$60', number: 'WM 2026 0000 0001', checkUrl: 'http://localhost/t/202600000001', certUrl: 'http://localhost/c/X', contractUrl: 'http://localhost/c/X/contract', roomUrl: 'http://localhost/yours/p/X', galleryUrl: 'http://localhost/c/X', img: 'http://localhost/i.jpg', paidWhen: PAID, printWhere: 'Mara Lind makes the print, signs it and sends it to you; you will be told when it is on its way.' });
  clean(text(lf.html), 'the letter as set'); assert.ok(text(lf.html).includes('Your print, and its papers') && text(lf.html).includes(PAID) && /word-break:break-all/.test(lf.html));

  // ---- sent: the status moves on every page ---------------------------------------------------------------------------
  await form(mara, `/account/works/${w.slug}/prints/${o.id}`, { do: 'sent', no: '3', tracking: '1Z999' });
  t = main(await page(cora, `/yours/p/${ref}`)); assert.ok(t.includes('It is sent by Mara Lind.') && t.includes('No. 3 of 10'), 'sent, as No. 3, the number the maker wrote');
  t = main(await page({}, `/c/${ref}`)); assert.ok(t.includes('No. 3 of 10'), 'the public certificate carries the print’s own number');
  say('4. the letter matches; the status and the number follow the order');

  // ---- letters fit a phone (item 4): links wrap; "Type it, or tap it." only beside a code ------------------------------
  const mail = require('../src/mail');
  const code = mail.paper({ subject: '123 456 is your Watermark code', text: 'Your code is\n\n123 456\n\nhttp://localhost/signin/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', feature: '123 456', cta: { label: 'Sign in with one tap', url: 'http://localhost/x' } });
  assert.ok(code.includes('Type it, or tap it.') && /<a href="http:\/\/localhost\/signin\/a+" style="[^"]*overflow-wrap:anywhere/.test(code), 'a code is typed or tapped; its bare link wraps');
  const words = mail.paper({ subject: 'Is it you?', text: 'A photograph.', feature: 'Is it you?', cta: { label: 'See the photograph', url: 'http://localhost/x' } });
  assert.ok(!words.includes('Type it, or tap it.'), 'a letter with no code never says "Type it, or tap it."');
  say('5. letters: links wrap, and only a code is typed');

  // ---- at 390 wide, in a browser when the machine has one: no letter and no page of the print buyer runs wider than the
  // screen. SHOTS=<dir> keeps the screenshots. ---------------------------------------------------------------------------
  let browser = null; try { const { chromium } = require('playwright'); browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : fs.existsSync('/usr/bin/google-chrome') ? { channel: 'chrome' } : {}); } catch (e) { browser = null; }
  if (browser) {
    const SHOTS = process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' }); const pg = await ctx.newPage();
    const wide = async (name) => { const sw = await pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)); if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `${name}-390.png`), fullPage: true }); return sw; };
    const LONG = 'http://localhost/account/join/' + 'a'.repeat(90);
    const set = [
      ['letter-code', mail.paper({ subject: '123 456 is your Watermark code', text: `Your code is\n\n123 456\n\nOr open this link on this device:\n${LONG}\n\nIf you did not ask for it, ignore this letter.`, feature: '123 456', cta: { label: 'Sign in with one tap', url: LONG } })],
      ['letter-words', mail.paper({ subject: 'Your photographs for Dinner at the Odeon', text: `Sam,\n\nConfirm that these are yours and your studio opens:\n\n${LONG}\n\nWatermark`, feature: 'Your photographs', cta: { label: 'Confirm, and open your studio', url: LONG } })],
      ...(app.locals.mailLog || []).filter(m => m.text).slice(0, 12).map((m, i) => [`letter-${String(i).padStart(2, '0')}-${m.subject.replace(/[^a-z0-9]+/ig, '-').slice(0, 40)}`, mail.paper({ subject: m.subject, text: m.text })]),
      ['letter-receipt-print', lf.html.replace(/<img [^>]*>/g, '')],
    ];
    for (const [name, html] of set) { await pg.setContent(html.replace(/<img [^>]*wordmark[^>]*>/g, ''), { waitUntil: 'domcontentloaded' }); const sw = await wide(name); assert.ok(sw <= 390, `${name} fits a 390 screen (it is ${sw} wide)`); }
    await ctx.addCookies(Object.entries(cora).map(([name, value]) => ({ name, value, url: base })));
    for (const [name, p] of [['thanks', `/thanks/${ref}`], ['room', `/yours/p/${ref}`], ['certificate-holder', `/c/${ref}`], ['yours', '/yours'], ['papers-tab', '/yours?tab=files'], ['work', `/w/${w.slug}`], ['license', `/license/${w.slug}`]]) { await pg.goto(base + p, { waitUntil: 'load' }); const sw = await wide(`page-${name}`); assert.ok(sw <= 392, `${p} fits a 390 screen (it is ${sw} wide)`); }
    const anon = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' }); const ap = await anon.newPage(); await ap.goto(`${base}/c/${ref}`, { waitUntil: 'load' }); if (SHOTS) await ap.screenshot({ path: path.join(SHOTS, 'page-certificate-public-390.png'), fullPage: true });
    await browser.close(); say('6. at 390 wide: the letters and the print buyer’s pages fit the screen');
  } else say('6. no browser on this machine: the 390 check was not run');

  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  say('ok'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
