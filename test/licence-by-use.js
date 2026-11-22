// A license written from the use chosen (#183; Will, 21 Nov 2026). The Standard Content License can now carry two
// more things a real editor or brand states: where (worldwide unless one territory is named) and how many (unlimited
// unless a number is stated). Held here:
//   - today's agreement, for every order that names neither, is byte for byte what it was before #183: its text is
//     held to fingerprints taken from src/contract.js as it stood on w/176-what-you-hold (30e8f58), and an order
//     already stored keeps its fingerprint (licenses.rights.hash) and its agreement page;
//   - editorial, one country, 5,000 copies, one year: the Territory and Size of Use clauses, shown in full;
//   - commercial, worldwide, unlimited: identical to today;
//   - money: a narrowed license is never sold at once and has no price of its own: it goes to the maker, who names the
//     fee; it is paid at exactly that fee and its agreement then carries the narrowed clauses;
//   - the license page asks the four plain questions and still has no field for a name or an email before payment;
//   - the one statement (src/holds.js) says the territory and the size, in one clause.
// Every clause and sentence here is a draft: the clauses for counsel (REVIEW), the words for Will.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto');
const K = require('../src/contract'); const H = require('../src/holds');
const sha = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const show = sections => sections.map(s => [s.n && s.h ? `${s.n} ${s.h}` : s.n, ...(s.p || []), ...(s.items || []).map(i => `  - ${i}`), ...(s.sub || []).map(x => [`${x.n} ${x.h}`, ...(x.p || []), ...(x.items || []).map(i => `  - ${i}`)].join('\n'))].filter(Boolean).join('\n')).join('\n\n');
const sub = (sections, h) => (sections.find(s => s.n === '2').sub || []).find(x => x.h === h);

// ---- 1. today's text, unchanged ------------------------------------------------------------------------------------
const U = { social: { key: 'social', kind: 'license', term_months: null }, editorial: { key: 'editorial', kind: 'license', term_months: 12, name: 'In a story' }, commercial: { key: 'commercial', kind: 'license', term_months: 12, name: 'For a company' }, campaign: { key: 'campaign', kind: 'license', term_months: 12 }, print: { key: 'print', kind: 'print', term_months: null } };
const CASES = { social: { use: U.social, never: ['ai'], base: 500 }, editorial: { use: U.editorial, never: ['ai', 'political'], base: 35000 }, commercial: { use: U.commercial, never: ['ai'], base: 75000 }, commercialPlus: { use: U.commercial, add: ['audiovisual', 'editorial'], extras: ['entities', 'exclusive', 'derivative', 'merchandise'], never: [], base: 75000 }, campaign: { use: U.campaign, never: ['ai', 'sensitive', 'alter'], base: 250000 }, print: { use: U.print, never: [], base: 25000 } };
// Taken from the contract before this change (the scratch script run on 30e8f58's src/contract.js); never regenerate.
const BEFORE = {
  social: { terms: '6249e5cb53274c4d2103d3826f9203e6320b603685186465d398aa9cac7fb0ac', text: '00870630864abd734c47bf20bf521d98bcbee2a80c40d5057af15b874bfbac3a' },
  editorial: { terms: '61fd5a64ca9489e58e8f369220a56369bd73ce3e4b5de185377f75a4b354aefb', text: '5d249a8371476c19384d780ce6887527620b64181308520f192f343f3da31302' },
  commercial: { terms: '48a75597367609cc39c371773190d11fea188e571caa8374e34e6cf534fb5f64', text: '7508ed19777484e14091d18ad06a59a15a9b58b29fec87143bb325353c8086ee' },
  commercialPlus: { terms: '5b47519de4fef6793677026decd9692c1c3427c03661ff63e4ce7aec872a73c3', text: '44b06c606ccef48dff7899b6daaddae5113447d3e2c5475dbe243059ee9b0b86' },
  campaign: { terms: '6925a678dc568fac36e3299147935d8b84e9f49bd858b11e286c85c5aac1e0b4', text: 'd250d1e8fc07643e09ac13ae5107083a958fff54acc049381352e5a96271b7c2' },
  print: { terms: '2aca3792f3e3a45d9c1ff83d729c43f74484eed008dfc04e19876e391b162f64', text: '95f296a3eec3d8a17d724b96a97a1876e95d74c57fab037fc85d11a9480cef89' },
};
const fp = t => sha(K.assemble({ t, work: 'The Dome at Noon', maker: 'A Maker', ref: 'WM-2026-000001' }));
for (const [k, c] of Object.entries(CASES)) {
  for (const extra of [{}, { territory: null, limit: null }, { territory: '', limit: { n: '', of: '' } }, { territory: 'ZZ', limit: { n: 'many', of: 'copies' } }, { territory: { code: 'FR', name: '<b>' }, limit: { n: 0, of: 'copies' } }]) {
    const t = K.terms({ ...c, ...extra });
    assert.equal(sha(t), BEFORE[k].terms, `${k} ${JSON.stringify(extra)}: the terms are today's`);
    assert.equal(fp(t), BEFORE[k].text, `${k} ${JSON.stringify(extra)}: the agreement is today's, byte for byte`);
  }
}
// A personal piece and a print never carry a territory or a size: they are not narrowed, and not repriced.
for (const k of ['social', 'print']) { const t = K.terms({ ...CASES[k], territory: 'FR', limit: { n: 5000, of: 'copies' } }); assert.equal(fp(t), BEFORE[k].text, `${k}: a territory or a size changes nothing`); assert.equal(t.price, CASES[k].base); }
console.log('ok: every order that names neither reads as it did, byte for byte');

// ---- 2. the cases of the issue, with their clauses -----------------------------------------------------------------
const ed = K.terms({ ...CASES.editorial, territory: 'FR', limit: { n: '5,000', of: 'copies' } });
assert.deepStrictEqual([ed.territory, ed.limit, ed.term_months, ed.price, ed.ask], [{ code: 'FR', name: 'France' }, { n: 5000, of: 'copies' }, 12, null, true], 'editorial, France, 5,000 copies, one year: asked of the maker, no price');
const edText = K.assemble({ t: ed, work: 'The Dome at Noon', maker: 'A Maker', ref: 'WM-2026-000002' });
assert.equal(sub(edText, 'Territory').n, '2.7'); assert.equal(sub(edText, 'Size of Use').n, '2.8');
assert.equal(sub(edText, 'Territory').p[0], 'You may use the Content only within the following territory: France (the “Territory”). No right is granted to reproduce, perform publicly, display, transmit or distribute the Content outside the Territory. The Content being accessible from outside the Territory on a website or social media account that you direct to an audience in the Territory is not, of itself, a use outside the Territory.');
assert.equal(sub(edText, 'Size of Use').p[0], 'You may reproduce the Content in no more than 5,000 copies in total, counting every copy, in any form, of every work or material in which the Content appears (the “Limit”). The Limit applies to all of your uses of the Content under this Agreement taken together, for the whole of the Term. No use of the Content beyond the Limit is permitted without an additional license from Licensor.');
assert.ok(edText.find(s => s.n === '7').sub[0].p[0].includes('continues for 1 year'), 'one year: 7.1 as today');
// Nothing else in the agreement moved: take the two clauses out and it is the editorial license of today.
const edBare = edText.map(s => s.n === '2' ? { ...s, sub: s.sub.filter(x => !['Territory', 'Size of Use'].includes(x.h)) } : s);
assert.equal(sha(edBare), sha(K.assemble({ t: K.terms(CASES.editorial), work: 'The Dome at Noon', maker: 'A Maker', ref: 'WM-2026-000002' })), 'the two clauses are the only change');
console.log('\n---- Editorial, France only, 5,000 copies, one year: Section 2 ----\n' + show([edText.find(s => s.n === '2')]) + '\n');
const cm = K.terms({ ...CASES.commercial, territory: '', limit: null });
assert.equal(fp(cm), BEFORE.commercial.text, 'commercial, worldwide, unlimited: identical to today');
assert.ok(!sub(K.assemble({ t: cm }), 'Territory') && !sub(K.assemble({ t: cm }), 'Size of Use') && cm.price === 75000 && !cm.ask);
console.log('---- Commercial, worldwide, unlimited: Section 2 (as today) ----\n' + show([K.assemble({ t: cm }).find(s => s.n === '2')]) + '\n');
// After Exclusivity the clauses take the next numbers; the other two measures read as written.
const ex = K.assemble({ t: K.terms({ ...CASES.commercial, extras: ['exclusive'], territory: 'EU', limit: { n: 20000, of: 'circulation' } }) });
assert.deepStrictEqual(ex.find(s => s.n === '2').sub.map(x => x.n + ' ' + x.h).slice(6), ['2.7 Exclusivity', '2.8 Territory', '2.9 Size of Use']);
assert.ok(sub(ex, 'Territory').p[0].includes('territory: European Union (the') && sub(ex, 'Size of Use').p[0].startsWith('You may use the Content only in works or materials whose combined circulation does not exceed 20,000 in total'));
assert.ok(sub(K.assemble({ t: K.terms({ ...CASES.campaign, limit: { n: 300, of: 'audience' } }) }), 'Size of Use').p[0].startsWith('You may use the Content only before a combined audience that does not exceed 300 people in total'));
// The order keeps the place's name it was sold with.
assert.ok(sub(K.assemble({ t: { ...K.terms(CASES.editorial), territory: { code: 'GB', name: 'United Kingdom' } } }), 'Territory').p[0].includes('United Kingdom (the'));
// For counsel: each clause is in REVIEW as ADDED, with its words; and in docs/CONTRACT.md.
const rv = K.REVIEW.filter(r => r[0] === 'ADDED' && /^(Territory|Size of Use)/.test(r[1]));
assert.equal(rv.length, 2, 'both clauses are listed for counsel'); assert.ok(rv[0][2].includes('No right is granted to reproduce') && rv[1][2].includes('The Limit applies to all of your uses'));
const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CONTRACT.md'), 'utf8'); assert.ok(doc.includes('**Territory') && doc.includes('**Size of Use'), 'docs/CONTRACT.md lists them');
// The statement: one clause, same sentence form.
const st = H.statement({ use: U.editorial, t: ed, maker: 'A Maker', will: true });
assert.equal(st.may, 'You may use it on websites, educational works, editorial works and literary works, in one territory (France) and in no more than 5,000 copies, for yourself or one company or client, credited to A Maker.');
assert.equal(H.statement({ use: U.editorial, t: K.terms(CASES.editorial), maker: 'A Maker' }).may, 'You may use it on websites, educational works, editorial works and literary works, for yourself or one company or client, credited to A Maker.', 'worldwide, unlimited: the statement of today');
console.log('ok: the clauses, for counsel; the statement:\n  ' + st.text);

// ---- 3. the house: the page, an old order, the money -----------------------------------------------------------------
(async () => {
  const { createApp } = require('../src/app'); const sharp = require('sharp');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-lbu-'));
  const stripeClient = require('stripe')('sk_test_dummy'); const sessions = {};
  stripeClient.checkout.sessions.create = async o => { const id = 'cs_' + Object.keys(sessions).length; sessions[id] = { id, ...o, url: 'https://checkout.stripe.test/' + id, payment_status: 'unpaid' }; return sessions[id]; };
  stripeClient.checkout.sessions.retrieve = async id => sessions[id];
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'lbu', stripeKey: 'sk_test_dummy', stripePk: 'pk_test_dummy', stripeClient, webhookSecret: 'whsec_test', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
    const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
    const f = path.join(dir, 'w.jpg'); await sharp(path.join(__dirname, 'fixture.jpg')).resize({ width: 6100, height: 4100, fit: 'fill' }).jpeg({ quality: 70 }).toFile(f);
    const w0 = await app.locals.registerWork({ file: f, title: 'The Dome at Noon', originalName: 'w.jpg' }); db.prepare("UPDATE works SET status='held' WHERE slug=?").run(w0.slug);
    const w = db.prepare('SELECT id, slug, title, maker_id FROM works WHERE slug=?').get(w0.slug); const maker = db.prepare('SELECT id, name FROM makers WHERE id=?').get(w.maker_id);
    const use = key => db.prepare('SELECT id, key, kind, name, price_cents, term_months FROM uses WHERE maker_id=? AND key=?').get(maker.id, key);
    const lic = ref => db.prepare('SELECT ref, status, price_cents, rights, download_token, stripe_session, intended_use FROM licenses WHERE ref=?').get(ref);
    const n0 = () => Object.keys(sessions).length;

    // The license page: the four questions, and still nothing to fill in about yourself.
    const anna = {}; let r = await go(anna, `/license/${w.slug}?use=editorial`); let t = await r.text(); assert.equal(r.status, 200);
    for (const q of ['What is it for?', 'Where will it appear?', 'How many?', 'For how long?', 'Anywhere in the world', 'Only in France', 'Copies printed, no more than', 'No set number']) assert.ok(t.includes(q), 'the license page asks: ' + q);
    assert.ok(!/name="email"/.test(t) && !/name="name"/.test(t), 'no form fields about the buyer before payment');
    { const a = t.indexOf('class="buy-form"'), b = t.indexOf('id="buyBtn"'), between = t.slice(a, b); assert.ok(a > 0 && b > a && !/<\/form>/.test(between) && between.includes('name="where"') && between.includes('name="many"'), 'the answers are inside the form, before its button'); }
    r = await go(anna, `/contract/${w.slug}?holds=1&use=editorial&where=FR&of=copies&many=5000`); t = await r.text();
    assert.ok(r.status === 200 && t.includes('data-holds="license"') && t.includes('in one territory (France) and in no more than 5,000 copies'), 'the statement follows the answers: ' + t);
    r = await go(anna, `/contract/${w.slug}?use=editorial&where=FR&of=copies&many=5000`); t = await r.text(); assert.ok(t.includes('Territory') && t.includes('France (the') && t.includes('5,000 copies'), 'the agreement, read before paying, carries them');

    // An old order: stored before #183 (its terms as today's code made them), its fingerprint, its agreement page.
    r = await form(anna, `/buy/${w.slug}`, { use: 'commercial' }); assert.equal(r.status, 303);
    const s1 = sessions[r.headers.get('location').split('/').pop()]; const oref = s1.metadata.ref; const ol = lic(oref);
    const stored = JSON.parse(ol.rights); assert.ok(!('territory' in stored) && !('limit' in stored), 'an order that names neither stores neither');
    const { version, hash, ...bare } = stored;
    assert.equal(sha(K.assemble({ t: bare, work: w.title, maker: maker.name, ref: oref })), hash, 'its fingerprint is the agreement assembled today');
    assert.equal(s1.line_items[0].price_data.unit_amount, use('commercial').price_cents, 'and it is sold at today\'s price');
    const before = { ...CASES.commercial, use: { key: 'commercial', kind: 'license', term_months: use('commercial').term_months } };
    const old = K.terms({ ...before, never: [], base: use('commercial').price_cents }); // a row as written before #183
    assert.equal(sha(K.terms({ ...before, never: [], base: use('commercial').price_cents, territory: null, limit: null })), sha(old));
    const oldRef = 'WM-2026-900183'; const oldFp = t0 => sha(K.assemble({ t: t0, work: w.title, maker: maker.name, ref: oldRef }));
    old.hash = oldFp(old); old.version = 'standard-2021-counsel/v0'; // as app.js stores it: the fingerprint, then the version
    db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, price_cents, status, starts_at, ends_at, download_token, rights) VALUES (?, ?, ?, 'Old', 'old@example.com', ?, 'active', datetime('now','-30 days'), datetime('now','+335 days'), 'tok-old', ?)").run(oldRef, w.id, use('commercial').id, old.price, JSON.stringify(old));
    const oldRow = JSON.parse(lic(oldRef).rights); const { version: v2, hash: h2, ...ob } = oldRow;
    assert.equal(h2, oldFp(ob), 'the old order\'s stored fingerprint still matches the agreement assembled from its stored terms today');
    r = await go(anna, `/c/${oldRef}/contract?k=tok-old`); t = await r.text();
    assert.ok(r.status === 200 && t.includes('Accepted at checkout and recorded on the register.') && !t.includes('Territory') && !t.includes('Size of Use') && t.includes('in all media'), 'its agreement page reads as before');
    r = await go(anna, `/c/${oldRef}?k=tok-old`); t = await r.text(); assert.ok(t.includes('Agreement accepted by Old at payment'), 'and its certificate still says the agreement was accepted');

    // Money: an answer that narrows never goes to payment and has no price; the maker names the fee.
    let n = n0(); r = await form(anna, `/buy/${w.slug}`, { use: 'editorial', where: 'FR', of: 'copies', many: '5,000' }); t = await r.text();
    assert.equal(r.status, 200); assert.equal(n0(), n, 'no payment is opened for a narrowed license');
    assert.ok(t.includes('Tell the maker') && t.includes('name="where" value="FR"') && t.includes('name="many" value="5000"') && t.includes('Where: France only.') && t.includes('How many: no more than 5,000 copies printed.'), 'it is asked of the maker, with the answers carried');
    assert.ok(t.includes('in one territory (France) and in no more than 5,000 copies'), 'and the statement says them before anything is sent');
    // Junk answers narrow nothing: today's license at today's price.
    n = n0(); r = await form(anna, `/buy/${w.slug}`, { use: 'editorial', where: 'ZZ', of: 'copies', many: 'lots' }); assert.equal(r.status, 303); assert.equal(n0(), n + 1);
    { const sj = sessions[r.headers.get('location').split('/').pop()]; assert.equal(sj.line_items[0].price_data.unit_amount, use('editorial').price_cents); const lt = JSON.parse(lic(sj.metadata.ref).rights); assert.ok(!lt.territory && !lt.limit); }
    // The request: stored with its narrowed terms and no fee.
    n = n0(); r = await form(anna, `/license/${w.slug}`, { use: 'editorial', name: 'Ann Editor', email: 'ann@mag.example', agree: '1', intended: 'Where: France only.', where: 'FR', of: 'copies', many: '5000' });
    assert.equal(r.status, 200); assert.equal(n0(), n, 'a request goes to the maker, not to payment');
    const rq = db.prepare("SELECT ref FROM licenses WHERE licensee_email='ann@mag.example' ORDER BY id DESC LIMIT 1").get().ref; let rl = lic(rq);
    assert.deepStrictEqual([rl.status, rl.price_cents], ['requested', null], 'requested, no price');
    const rt = JSON.parse(rl.rights); assert.deepStrictEqual([rt.territory, rt.limit, rt.price], [{ code: 'FR', name: 'France' }, { n: 5000, of: 'copies' }, null]);
    // A request that narrows nothing is stored exactly as before (no terms, the use's price).
    await form(anna, `/license/${w.slug}`, { use: 'editorial', name: 'Bo', email: 'bo@mag.example', agree: '1' });
    { const b0 = db.prepare("SELECT rights, price_cents FROM licenses WHERE licensee_email='bo@mag.example'").get(); assert.deepStrictEqual([b0.rights, b0.price_cents], [null, use('editorial').price_cents]); }
    // The maker's fee, paid by the link, and the agreement the license then carries.
    n = n0();
    r = await form(studio, `/studio/licenses/${rq}/quote`, { price: '420' }); assert.equal(r.status, 302); assert.equal(n0(), n + 1, 'the maker\'s fee opens one payment');
    rl = lic(rq); const sq = sessions[rl.stripe_session]; const charged = sq.line_items[0].price_data.unit_amount;
    assert.equal(rl.price_cents, 42000, 'the fee is the maker\'s'); assert.ok(charged >= 42000, 'the payment is that fee (and the house\'s share, if the collector pays it): ' + charged);
    Object.assign(sq, { payment_status: 'paid', amount_total: charged, customer_details: { email: 'ann@mag.example', name: 'Ann Editor' } });
    r = await go(anna, `/c/${rq}?session_id=${sq.id}`); t = await r.text(); rl = lic(rq); assert.equal(rl.status, 'active', 'paid, granted');
    assert.ok(t.includes('in one territory (France) and in no more than 5,000 copies'), 'the certificate says what is held');
    r = await go(anna, `/c/${rq}/contract?k=${rl.download_token}`); t = await r.text();
    assert.ok(t.includes('2.7') && t.includes('France (the') && t.includes('no more than 5,000 copies in total'), 'the agreement carries the clauses');
    // The words a visitor reads.
    for (const s0 of [st.text, ...K.SIZES.map(z => z.q), 'A license for one place, or for a set number, is agreed with the maker: they reply with the fee.']) assert.ok(!new RegExp(`\\b(${H.NEVER.join('|')})\\b`, 'i').test(s0) && !/—/.test(s0), s0);
    console.log('ok: the page asks; an old order is unchanged; a narrowed license is asked, priced by the maker, paid at that fee');
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
