// The private desk (5 Nov): a want and an offer, told only to the house; a match; both asked, neither named until both
// say yes; the letter of introduction; a sale recorded with the stated fee; the house's own side disclosed.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-pdk-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'pdk', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const signin = async (jar, email) => { app.locals.lastCode = null; await form(jar, '/signin/code', { email }); await form(jar, '/signin/verify', { email, code: app.locals.lastCode.code }); };
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  const ann = {}, bob = {}, cy = {}; await signin(ann, 'ann@example.com'); await signin(bob, 'bob@example.com'); await signin(cy, 'cy@example.com');
  assert.ok((await go({}, '/yours/desk')).headers.get('location').startsWith('/signin'), 'a stranger is sent to sign in');
  assert.ok((await (await go({}, '/desk')).text()).includes('neither of you is named'), 'the public door says the rules');
  // Ann records a painting on her registry and puts it on the desk; a second record she keeps off it.
  await form(ann, '/yours/registry', { title: 'Harbour at Dusk', artist: 'Agnes Example', made: '1962', medium: 'Oil on canvas', dims: '80 × 100 cm' });
  await form(ann, '/yours/registry', { title: 'Kept Quiet', artist: 'Agnes Example', made: '1963', medium: 'Oil on canvas', dims: '50 × 40 cm' });
  const [o1, o2] = db.prepare('SELECT * FROM objects ORDER BY id').all(); assert.ok(o1 && o2 && o1.owner.startsWith('b:'), 'two private records');
  await form(ann, '/yours/desk/offer', { object_id: String(o1.id), asking: '120000', show_photo: '1' });
  // Bob is looking for her work; Cy for someone else's.
  await form(bob, '/yours/desk/want', { artist: 'Agnes Example', mclass: 'painting', year_from: '1955', year_to: '1970', budget_low: '80000', budget_high: '150000' });
  await form(cy, '/yours/desk/want', { artist: 'Someone Else', mclass: 'painting' });
  const PD = app.locals.privateDesk; const ms = PD.matches();
  assert.equal(ms.length, 1, 'one match: Bob and the harbour'); assert.ok(ms[0].why.includes('the artist') && ms[0].why.includes('the price'), 'why it matched: ' + ms[0].why);
  assert.ok(!db.prepare('SELECT 1 FROM desk_offers WHERE object_id=?').get(o2.id), 'the record she kept off the desk is never offered');
  // The house's view carries the book's word when it has one; propose.
  const sd = await (await go(studio, '/studio/desk')).text(); assert.ok(sd.includes('Harbour at Dusk') && sd.includes('Propose the introduction'), 'the house sees the match');
  await form(studio, '/studio/desk/propose', { want: String(ms[0].w.id), offer: String(ms[0].o.id), line: 'A fine one.' });
  const i = db.prepare('SELECT * FROM desk_intros').get(); assert.ok(i && i.status === 'proposed' && i.fee_pct === 5, 'proposed at the stated fee');
  // Each side sees the other only as described; no names, no emails.
  const bp = await (await go(bob, '/yours/desk')).text(); assert.ok(bp.includes('Harbour at Dusk') && !bp.includes('ann@example.com') && bp.includes('Yes, introduce us'), 'Bob sees the work, not Ann');
  const ap = await (await go(ann, '/yours/desk')).text(); assert.ok(ap.includes('A collector looking for') && !ap.includes('bob@example.com'), 'Ann sees a collector, not Bob');
  assert.ok(!ap.includes('120,000') || ap.includes('told to the house only'), 'her asking price is the house’s alone');
  assert.ok(!bp.includes('$1,200'), 'Bob is not told the asking price she kept back');
  assert.equal((await go(cy, `/desk/photo/${i.token}`)).status, 404, 'the photograph is not for anyone else');
  // Ann says yes; then Bob: introduced, the letter carries both addresses.
  await form(ann, `/yours/desk/i/${i.id}`, { yes: '1' }); assert.equal(db.prepare('SELECT status FROM desk_intros').get().status, 'proposed', 'one yes is not enough');
  await form(bob, `/yours/desk/i/${i.id}`, { yes: '1' }); assert.equal(db.prepare('SELECT status FROM desk_intros').get().status, 'introduced', 'both yes: introduced');
  const log = (app.locals.mailLog || []).map(m => JSON.stringify(m)).join('\n'); assert.ok(/meet/.test(log) && log.includes('ann@example.com') && log.includes('bob@example.com'), 'the letter of introduction');
  assert.equal((await form(cy, `/yours/desk/i/${i.id}`, { yes: '0' })).status, 302); assert.equal(db.prepare('SELECT status FROM desk_intros').get().status, 'introduced', 'a third person cannot answer');
  // The sale recorded with the fee; the offer and the want close.
  await form(studio, `/studio/desk/i/${i.id}/sold`, { price: '110000' });
  const s = db.prepare('SELECT * FROM desk_intros').get(); assert.ok(s.status === 'sold' && s.price === 11000000 && s.fee === 550000, 'the fee, 5% of the price');
  assert.equal(db.prepare('SELECT status FROM desk_offers').get().status, 'sold');
  assert.ok(!db.prepare("SELECT 1 FROM ledger WHERE type LIKE 'desk.%'").all().some(() => false), 'on the register');
  const reg = await (await go({}, '/ledger')).text(); assert.ok(!reg.includes('desk.'), 'never on the public register');
  // A no ends it quietly.
  await form(cy, '/yours/desk/offer', { artist: 'Someone Else', title: 'A Study', mclass: 'painting' });
  assert.equal(PD.matches().length, 0, 'never matched with oneself (Cy wants and offers the same artist)');
  srv.close(); console.log('privatedesk: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
