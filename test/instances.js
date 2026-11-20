// Several copies of the website (#123, docs/SCALE.md "Stage 2: several copies"). On Postgres (DATABASE_URL, CI's
// postgres job) it starts TWO website processes (ROLE=web, each its own disk, the one database; test/instances-copy.js)
// at the same moment on an empty database, and holds:
//   1. both boot (the boot's DDL taken one process at a time) and both answer;
//   2. a visitor's journey alternates between them: the rooms, the basket, a checkout begun on one and returned to on
//      the other, sign-in by code asked on one and answered on the other, a passkey's challenge kept for the other;
//   3. a payment settled at once by the webhook on one, the return on the other and the settling timer on both is
//      granted once: one licence active, one entry on the register, one letter to the collector;
//   4. money out runs once: an owed share (market), a maker's pay and a person's Friday pay asked of both copies at
//      the same moment make one transfer each; a balcony night settled by both pays its host once;
//   5. an upload begun on one (the file sent through it) is taken in once, by the copy that holds the file, while the
//      other copy's pump and sweep run; an original on one copy's disk is not called lost by the other's vault queue.
// On SQLite (npm test) the copies cannot share a database without sharing a disk: it checks the lease alone and says so.
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { fork } = require('child_process');
const PG = !!process.env.DATABASE_URL;
const nap = ms => new Promise(r => setTimeout(r, ms));

async function sqliteOnly() {
  const { createApp } = require('../src/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-instances-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', noTimers: true, vaultNow: true });
  const { instances: I, db } = app.locals;
  assert.ok(I.lease('t:a', 60e3), 'a free lease is taken'); assert.ok(I.lease('t:a', 60e3), 'and renewed by its holder');
  db.prepare("UPDATE leases SET holder='another' WHERE k='t:a'").run();
  assert.ok(!I.lease('t:a', 60e3), 'a lease another process holds is refused'); assert.equal(I.holderOf('t:a'), 'another');
  db.prepare("UPDATE leases SET until_ms=? WHERE k='t:a'").run(Date.now() - 1);
  assert.ok(I.lease('t:a', 60e3), 'a lease run out is taken'); I.release('t:a'); assert.equal(I.holderOf('t:a'), null);
  let ran = 0; const t = I.pinned('x', 1000, () => ran++); t(); t(); assert.equal(ran, 2, 'a pinned timer runs where its lease is held');
  db.prepare("UPDATE leases SET holder='another' WHERE k='timer:x'").run(); t(); assert.equal(ran, 2, 'and not where it is not');
  assert.ok(I.alive(I.ME) && !I.alive('gone:1'), 'this process is alive; one never seen is not');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('instances: the lease holds on SQLite; two copies need Postgres (run with DATABASE_URL, as CI\'s postgres job does)');
}

async function twoCopies() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-instances-'));
  const share = path.join(root, 'share'); fs.mkdirSync(share);
  const env = { ...process.env, PAYOUTS: 'stripe', PAYOUT_HOLD_DAYS: '0', FEE_SIDE: 'maker', SHARE_DIR: share, RENDER_GIT_COMMIT: 'twocopies' };
  delete env.RENDER_INSTANCE_ID;
  const start = name => { const dir = path.join(root, name); fs.mkdirSync(dir);
    const c = fork(path.join(__dirname, 'instances-copy.js'), [], { env: { ...env, COPY_DIR: dir, COPY_NAME: name }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    c.out = ''; c.stdout.on('data', d => { c.out += d; }); c.stderr.on('data', d => { c.out += d; });
    c.waiting = new Map(); let n = 0;
    c.on('message', m => { if (m.ready) { c.port = m.ready; c.me = m.me; c.readyAt = Date.now(); if (c.onReady) c.onReady(); return; } const w = c.waiting.get(m.id); if (w) { c.waiting.delete(m.id); m.err ? w[1](new Error(`${name}: ${m.err}`)) : w[0](m.v); } });
    c.ask = (op, o = {}) => new Promise((res, rej) => { const id = ++n; c.waiting.set(id, [res, rej]); c.send({ id, op, ...o }); });
    c.call = (p, ...args) => c.ask('call', { path: p, args }); c.sql = (sql, args = [], how = 'all') => c.ask('sql', { sql, args, how });
    c.ready = new Promise((res, rej) => { c.onReady = res; c.on('exit', code => rej(new Error(`${name} left (${code}) before it was ready:\n${c.out.slice(-3000)}`))); });
    return c; };
  // 1. Both at once, on an empty database.
  const t0 = Date.now(); const A = start('A'), B = start('B');
  await Promise.race([Promise.all([A.ready, B.ready]), nap(240e3).then(() => { throw new Error('the copies did not come up in four minutes:\n' + A.out.slice(-1500) + '\n' + B.out.slice(-1500)); })]);
  A.base = `http://127.0.0.1:${A.port}`; B.base = `http://127.0.0.1:${B.port}`;
  assert.notEqual(A.me, B.me, 'two copies, two names');
  console.log(`instances: two copies up together in ${Date.now() - t0} ms (A ${A.readyAt - t0} ms, B ${B.readyAt - t0} ms); boot waits: ${(A.out + B.out).match(/\[boot\][^\n]*/g) || 'none said'}`);
  const both = async (fn) => Promise.all([fn(A, B), fn(B, A)]);
  const get = async (c, p, h = {}) => { const r = await fetch(c.base + p, { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605', ...h }, redirect: 'manual' }); return { status: r.status, text: await r.text(), headers: r.headers }; };
  const post = async (c, p, body, h = {}) => { const r = await fetch(c.base + p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...h }, body: typeof body === 'string' ? body : new URLSearchParams(body).toString(), redirect: 'manual' }); return { status: r.status, text: await r.text(), headers: r.headers }; };
  const cookieOf = r => (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || '']).map(x => x.split(';')[0]).filter(Boolean).join('; ');
  for (const c of [A, B]) { const h = await (await fetch(c.base + '/healthz')).json(); assert.equal(h.instance, c.me, '/healthz names the copy that answered'); assert.equal(h.role, 'web'); }

  // Works to look at and collect (registered on A: the originals are on A's disk until the bucket has them).
  const maker = await A.sql("SELECT id, handle FROM makers ORDER BY id LIMIT 1", [], 'get');
  const sharp = require('sharp'); const ws = [];
  for (let i = 0; i < 3; i++) { const f = path.join(root, 'A', `in${i}.jpg`); await sharp(path.join(__dirname, 'fixture.jpg')).resize({ width: 4200, height: 2800, fit: 'fill' }).modulate({ brightness: 1 + i / 30 }).jpeg().toFile(f);
    const w = await A.call('registerWork', { file: f, title: `Two Rooms ${i}`, place: 'Lisbon', originalName: `in${i}.jpg` }); await A.sql("UPDATE works SET status='held' WHERE id=?", [w.id], 'run'); ws.push(w); }
  // 5b. The vault: an original on A's disk, its put still landing, is not called lost by B's queue.
  const held = await A.sql('SELECT id, vaulted, vault_on, status FROM works WHERE id=?', [ws[2].id], 'get');
  assert.equal(held.vault_on, A.me, 'the work records which copy holds its original until the bucket has it');
  for (let i = 0; i < 40; i++) { await Promise.all([B.call('vaultPending'), A.call('vaultPending')]); if (!Number((await A.sql('SELECT COUNT(*) n FROM works WHERE vaulted=0', [], 'get')).n)) break; await nap(250); }
  for (const w of ws) { const r = await A.sql('SELECT vaulted, status FROM works WHERE id=?', [w.id], 'get'); assert.equal(r.status, 'held', `${w.slug}: not taken off view by the other copy's vault queue`); assert.equal(Number(r.vaulted), 1, `${w.slug}: vaulted by the copy that holds it`); }
  const puts = fs.readFileSync(path.join(share, 'bucket.log'), 'utf8').trim().split('\n').map(JSON.parse).filter(x => /^originals\//.test(x.put));
  assert.equal(puts.filter(x => x.copy === 'B').length, 0, 'B put no original (it has none)');
  const lostB = await B.ask('get', { path: 'vaultState' }); assert.equal((lostB.lost || []).length, 0, 'B calls nothing lost');
  console.log(`instances: the vault queue on both copies: ${puts.length} originals put, all by A; none lost, none off view`);

  // 2. The visitor's journey, every request on the other copy from the one before.
  let k = 0; const next = () => (k++ % 2 ? B : A);
  for (const p of ['/', '/wander', `/w/${ws[0].slug}`, '/collection', `/m/${maker.handle}`, '/api/stroll?n=6&seen=', `/w/${ws[1].slug}`, '/makers', '/basket']) { const c = next(); const r = await get(c, p); assert.ok(r.status === 200, `${p} on ${c === A ? 'A' : 'B'}: ${r.status} ${r.text.slice(0, 200)}`); }
  // The basket rides with the visitor (a cookie): put on A, read on B, collected from B, paid, returned to A.
  const bk = `wm_bk=${ws[0].slug}`;
  for (const c of [A, B]) { const r = await get(c, '/basket', { cookie: bk }); assert.ok(r.text.includes('Two Rooms 0'), 'the basket, on either copy'); }
  let r = await post(B, `/buy/${ws[0].slug}`, { use: 'social' }); assert.equal(r.status, 303, 'checkout begun on B: ' + r.status + ' ' + r.text.slice(0, 200));
  const sid = r.headers.get('location').split('/').pop(); const sfile = path.join(share, 'stripe', sid + '.json');
  const sess = JSON.parse(fs.readFileSync(sfile)); const ref = sess.metadata.ref;
  Object.assign(sess, { payment_status: 'paid', status: 'complete', amount_total: sess.line_items[0].price_data.unit_amount, customer_details: { email: 'cora@example.com', name: 'Cora' } }); fs.writeFileSync(sfile, JSON.stringify(sess));
  // 3. Settled at once, four ways, on both copies.
  const stripe = require('stripe')('sk_test_dummy');
  const payload = JSON.stringify({ id: 'evt_' + sid, type: 'checkout.session.completed', livemode: false, data: { object: sess } });
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
  const settled = await Promise.all([
    fetch(A.base + '/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body: payload }).then(x => x.status),
    get(B, `/thanks/${ref}?session_id=${sid}`).then(x => x.status),
    A.call('settleAll'), B.call('settleAll'),
    fetch(B.base + '/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body: payload }).then(x => x.status), // Stripe sends again
  ]);
  assert.equal(settled[0], 200); assert.equal(settled[4], 200);
  await nap(300);
  const lic = await A.sql('SELECT status, collector_no, download_token FROM licenses WHERE ref=?', [ref], 'get');
  assert.equal(lic.status, 'active', 'collected'); assert.equal(Number(lic.collector_no), 1, 'collector No. 1, once');
  const granted = (await A.sql("SELECT COUNT(*) n FROM ledger WHERE type='license.granted' AND subject=?", [ref], 'get')).n;
  assert.equal(Number(granted), 1, 'one entry on the register for the licence, however many copies settled it');
  const letters = [...await A.ask('mails'), ...await B.ask('mails')].filter(m => m.to === 'cora@example.com');
  assert.equal(letters.length, 1, `one letter to the collector (${letters.map(x => x.subject).join(' | ')})`);
  assert.ok((await A.ask('ledgerOk')).ok, 'the register\'s chain is whole');
  r = await get(A, `/c/${ref}?k=${lic.download_token}`); assert.equal(r.status, 200, 'the certificate, on the other copy');
  console.log('instances: a payment settled by the webhook on A (twice), the return on B and the timer on both: granted once, one register entry, one letter');

  // The same, twelve at once: each payment's webhook delivered to both copies at the same moment (as when Stripe sends
  // again while the first is still being answered). Each licence is granted once.
  const burst = [];
  for (let i = 0; i < 12; i++) { const c = i % 2 ? A : B; const rr = await post(c, `/buy/${ws[1 + (i % 2)].slug}`, { use: 'social' }); assert.equal(rr.status, 303, 'checkout ' + i);
    const id = rr.headers.get('location').split('/').pop(); const f = path.join(share, 'stripe', id + '.json'); const s0 = JSON.parse(fs.readFileSync(f));
    Object.assign(s0, { payment_status: 'paid', status: 'complete', amount_total: s0.line_items[0].price_data.unit_amount, customer_details: { email: `c${i}@example.com`, name: 'C' + i } }); fs.writeFileSync(f, JSON.stringify(s0));
    const pl = JSON.stringify({ id: 'evt_' + id, type: 'checkout.session.completed', livemode: false, data: { object: s0 } }); burst.push({ ref: s0.metadata.ref, pl, sg: stripe.webhooks.generateTestHeaderString({ payload: pl, secret: 'whsec_test' }) }); }
  await Promise.all(burst.flatMap(x => [A, B].map(c => fetch(c.base + '/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': x.sg }, body: x.pl }).then(q => assert.equal(q.status, 200)))));
  await nap(300);
  for (const x of burst) { const n = Number((await A.sql("SELECT COUNT(*) n FROM ledger WHERE type='license.granted' AND subject=?", [x.ref], 'get')).n); assert.equal(n, 1, `${x.ref}: granted once, not ${n}`); }
  const burstLetters = [...await A.ask('mails'), ...await B.ask('mails')].filter(m => /^c\d+@example\.com$/.test(m.to));
  assert.equal(burstLetters.length, 12, `one letter each to twelve collectors, not ${burstLetters.length}`);
  assert.ok((await A.ask('ledgerOk')).ok, 'the register\'s chain is whole after twenty-four answers at once');
  console.log('instances: twelve payments, each delivered to both copies at once: twelve grants, twelve letters, the register whole');

  // Sign-in by code: asked on A, answered on B, the cookie good on A.
  r = await post(A, '/signin/code', { email: 'cora@example.com' }); assert.equal(r.status, 200, 'a code asked on A');
  const code = await A.ask('lastCode'); assert.ok(code && code.code);
  r = await post(B, '/signin/verify', { email: 'cora@example.com', code: code.code }); assert.equal(r.status, 200, 'the code answered on B: ' + r.text.slice(0, 160));
  const me = cookieOf(r); assert.ok(/wm_b=/.test(me), 'signed in by B');
  r = await post(A, '/signin/verify', { email: 'cora@example.com', code: code.code }); assert.equal(r.status, 400, 'the same code is not good twice, on any copy');
  r = await get(A, '/yours', { cookie: me }); assert.equal(r.status, 200, 'the gallery, on A'); assert.ok(r.text.includes('Two Rooms 0'), 'with what was collected on B');
  // A passkey's challenge: given by A, taken by B.
  r = await post(A, '/auth/passkey/register/options', {}, { cookie: me, 'content-type': 'application/json' }); assert.equal(r.status, 200);
  const ch = cookieOf(r).split('; ').find(x => x.startsWith('wm_ch=')); assert.ok(ch, 'a challenge cookie');
  assert.equal(Number((await A.sql('SELECT COUNT(*) n FROM passkey_challenges', [], 'get')).n), 1, 'the challenge kept in the database');
  r = await post(B, '/auth/passkey/register/verify', '{}', { cookie: `${me}; ${ch}`, 'content-type': 'application/json' });
  assert.equal(Number((await A.sql('SELECT COUNT(*) n FROM passkey_challenges', [], 'get')).n), 0, 'B found it and took it (the answer itself is a stand-in, refused)');
  console.log('instances: sign-in asked on A and answered on B; a passkey challenge given by A and taken by B');

  // 4. Money out, asked of both copies at the same moment.
  const m = await A.sql('SELECT * FROM makers WHERE id=?', [maker.id], 'get');
  await A.sql('UPDATE makers SET stripe_account=? WHERE id=?', ['acct_maker', m.id], 'run'); m.stripe_account = 'acct_maker';
  const money = () => (fs.existsSync(path.join(share, 'money.log')) ? fs.readFileSync(path.join(share, 'money.log'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);
  // A maker's pay: both copies press "pay" at once.
  const owed = await A.call('payouts.statement', m); assert.ok(owed.cleared >= 100, `the maker has cleared money to pay (${owed.cleared})`);
  const paid = await both(c => c.call('payouts.pay', m));
  const toMaker = money().filter(x => x.kind === 'transfer' && x.destination === 'acct_maker');
  assert.equal(toMaker.length, 1, `one transfer to the maker, not ${toMaker.length} (${JSON.stringify(paid)})`);
  assert.equal(toMaker[0].amount, owed.cleared, 'for what had cleared');
  assert.ok(paid.some(x => x.ok) && paid.every(x => x.ok || ['busy', 'small'].includes(x.why)), 'the other copy says busy or that nothing is left: ' + JSON.stringify(paid));
  // An owed share from the market: both copies pay what is owed at once.
  const seller = Number((await A.sql("INSERT INTO buyers (customer, email, stripe_account) VALUES ('', 'seller@example.com', 'acct_seller')", [], 'run')).lastInsertRowid);
  const lid = (await A.sql('SELECT id FROM licenses WHERE ref=?', [ref], 'get')).id;
  const tid = Number((await A.sql("INSERT INTO trades (license_id, seller, price_cents, royalty_cents, fee_cents, settled, buyer_id, stripe_session, payment_intent) VALUES (?,?,?,?,?,'stripe',?,?,?)", [lid, seller, 2000, 200, 0, seller, 'cs_trade', 'pi_trade'], 'run')).lastInsertRowid);
  const pid = Number((await A.sql("INSERT INTO payouts (trade_id, kind, buyer_id, amount_cents, status) VALUES (?,?,?,?,'owed')", [tid, 'seller', seller, 1800], 'run')).lastInsertRowid);
  await both(c => c.call('payOwed'));
  const toSeller = money().filter(x => x.kind === 'transfer' && x.destination === 'acct_seller');
  assert.equal(toSeller.length, 1, `one transfer for the owed share, not ${toSeller.length}`); assert.equal(toSeller[0].key, `wm-payout-${pid}`, 'with Stripe\'s own guard');
  assert.equal((await A.sql('SELECT status FROM payouts WHERE id=?', [pid], 'get')).status, 'paid');
  // A person's Friday pay (the pocket): both copies sweep at once.
  const curator = await A.sql('SELECT * FROM buyers WHERE id=?', [Number((await A.sql("INSERT INTO buyers (customer, email, name, stripe_account) VALUES ('', 'cur@example.com', 'Cur', 'acct_cur')", [], 'run')).lastInsertRowid)], 'get');
  await A.call('pocket.credit', curator, 900, 'thanks_in', 'hang-1', 'A card');
  await both(c => c.call('pocket.sweep', curator, { by: 'friday' }));
  const toCur = money().filter(x => x.kind === 'transfer' && x.destination === 'acct_cur');
  assert.equal(toCur.length, 1, `one Friday pay to the person, not ${toCur.length}`);
  // The balcony's host: the chair taken on A, the night closed by both (B never saw the host).
  const night = await A.call('hosts.nightOf'); const host = Number((await A.sql("INSERT INTO buyers (customer, email, name) VALUES ('', 'host@example.com', 'Hal')", [], 'run')).lastInsertRowid);
  await A.sql("INSERT INTO host_shifts (scope, night, owner, name, status) VALUES ('house', ?, ?, 'Hal', 'taken')", [night, `b:${host}`], 'run');
  await A.call('hosts.sat', 'house', `b${host}`);
  await both((c, o) => c.call('hosts.settle', 'house', night, c === A ? `b:${host}` : null, 3));
  const shift = await A.sql("SELECT status FROM host_shifts WHERE night=? AND scope='house'", [night], 'get');
  assert.equal(shift.status, 'paid', 'the host who sat on A is paid, though B closed a room without them');
  assert.equal(Number((await A.sql("SELECT COUNT(*) n FROM pocket WHERE kind='hosting' AND buyer_id=?", [host], 'get')).n), 1, 'once');
  console.log(`instances: money out on both copies at once: the maker paid once, the owed share once, Friday pay once, the host once (${money().length} calls to Stripe that move money, in all)`);

  // 5a. An upload begun on A, the file sent through B, taken in once while A's pump and sweep run.
  const ck = cookieOf(await post(A, '/studio/login', { password: 'pw' })); assert.ok(/wm_s=/.test(ck), 'the Studio on A');
  const up = path.join(root, 'up.jpg'); await sharp(path.join(__dirname, 'fixture.jpg')).resize(1400).modulate({ hue: 40 }).jpeg().toFile(up); const bytes = fs.readFileSync(up);
  r = await fetch(A.base + '/studio/arrivals/start', { method: 'POST', headers: { cookie: ck, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'up.jpg', size: bytes.length, type: 'image/jpeg' }) });
  const st = await r.json(); assert.ok(st.ok && st.id, 'begun on A: ' + JSON.stringify(st));
  r = await fetch(B.base + `/studio/arrivals/${st.id}/body`, { method: 'PUT', headers: { cookie: ck, 'content-type': 'application/octet-stream' }, body: bytes }); assert.equal(r.status, 200, 'the file sent through B');
  await Promise.all([A.call('arrivals.pump'), A.call('arrivals.sweep'), B.call('arrivals.sweep')]);
  let done = null; for (let i = 0; i < 120 && !done; i++) { await nap(500); const s2 = await (await fetch(A.base + `/studio/arrivals/state?ids=${st.id}`, { headers: { cookie: ck } })).json(); const a = s2.asked.find(x => x.id === st.id); if (a && ['done', 'failed'].includes(a.status)) done = a; if (i % 4 === 0) await A.call('arrivals.pump'); }
  assert.ok(done, 'the arrival was answered'); assert.equal(done.status, 'done', 'taken in: ' + JSON.stringify(done));
  const row = await A.sql('SELECT host FROM arrivals WHERE id=?', [st.id], 'get'); assert.equal(row.host, B.me, 'by B, the copy that holds the file');
  console.log(`instances: an upload begun on A and sent through B, taken in once by B (${done.outcome}) while A's pump and both sweeps ran`);

  A.send({ op: 'exit' }); B.send({ op: 'exit' }); await nap(300);
  fs.rmSync(root, { recursive: true, force: true });
}

(async () => {
  if (!PG) await sqliteOnly(); else await twoCopies();
  console.log('instances: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
