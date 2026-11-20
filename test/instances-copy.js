// One copy of the website for test/instances.js (#123): ROLE=web, its own disk (COPY_DIR), the one Postgres
// (DATABASE_URL), and stand-ins for Stripe and the bucket that every copy shares through files in SHARE_DIR, as the real
// ones are shared. It answers HTTP like the house and takes orders from the test by IPC: { id, op, ... } → { id, v | err }.
// Started only by test/instances.js (it exits at once without a parent to talk to).
'use strict';
if (!process.send) { console.error('instances-copy: started by test/instances.js only'); process.exit(2); }
process.env.NODE_ENV = 'test'; process.env.ROLE = 'web';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { Readable } = require('stream');
const DIR = process.env.COPY_DIR, SHARE = process.env.SHARE_DIR, NAME = process.env.COPY_NAME || '?';
const nap = ms => new Promise(r => setTimeout(r, ms));
const log = (file, o) => fs.appendFileSync(path.join(SHARE, file), JSON.stringify({ copy: NAME, ...o }) + '\n');

// Stripe, as one account seen by every copy: sessions are files; every call that moves money is a line in a log.
const stripeClient = require('stripe')('sk_test_dummy');
const sdir = path.join(SHARE, 'stripe'); fs.mkdirSync(sdir, { recursive: true });
const sfile = id => path.join(sdir, String(id).replace(/[^\w-]/g, '_') + '.json');
stripeClient.checkout.sessions.create = async o => { const id = 'cs_' + crypto.randomBytes(6).toString('hex'); const s = { id, ...o, url: 'https://checkout.stripe.test/' + id, payment_status: 'unpaid', status: 'open' }; fs.writeFileSync(sfile(id), JSON.stringify(s)); return s; };
stripeClient.checkout.sessions.retrieve = async id => { await nap(40); return JSON.parse(fs.readFileSync(sfile(id))); }; // a round trip, so two copies interleave
stripeClient.paymentIntents.retrieve = async id => { await nap(40); return { id, status: 'succeeded', latest_charge: 'ch_' + id, amount_received: 0 }; };
stripeClient.accounts.retrieve = async id => { await nap(40); return { id, payouts_enabled: true }; };
stripeClient.transfers.create = async (o, opts) => { await nap(60); log('money.log', { kind: 'transfer', amount: o.amount, destination: o.destination, metadata: o.metadata || null, key: (opts && opts.idempotencyKey) || null }); return { id: 'tr_' + crypto.randomBytes(6).toString('hex') }; };
stripeClient.refunds.create = async (o, opts) => { await nap(40); log('money.log', { kind: 'refund', payment_intent: o.payment_intent, key: (opts && opts.idempotencyKey) || null }); return { id: 're_' + crypto.randomBytes(6).toString('hex') }; };

// The bucket, as one bucket seen by every copy (a folder); a put takes 300 ms so a second copy can look while it lands.
const bdir = path.join(SHARE, 'bucket'); fs.mkdirSync(bdir, { recursive: true });
const bfile = k => path.join(bdir, encodeURIComponent(k));
const client = { async send(cmd) {
  const n = cmd.constructor.name, i = cmd.input;
  if (n === 'PutObjectCommand') { await nap(300); fs.writeFileSync(bfile(i.Key), Buffer.from(i.Body)); log('bucket.log', { put: i.Key }); return {}; }
  if (n === 'GetObjectCommand') { if (!fs.existsSync(bfile(i.Key))) { const e = new Error('nope'); e.name = 'NoSuchKey'; throw e; } const b = fs.readFileSync(bfile(i.Key)); const body = Readable.from([b]); body.transformToByteArray = async () => new Uint8Array(b); return { Body: body, ContentLength: b.length }; }
  if (n === 'HeadObjectCommand') { if (!fs.existsSync(bfile(i.Key))) { const e = new Error('NotFound'); e.name = 'NotFound'; throw e; } return { ContentLength: fs.statSync(bfile(i.Key)).size }; }
  if (n === 'DeleteObjectCommand') { try { fs.unlinkSync(bfile(i.Key)); } catch (e) { /* gone */ } return {}; }
  if (n === 'ListObjectsV2Command') return { Contents: fs.readdirSync(bdir).map(decodeURIComponent).filter(k => k.startsWith(i.Prefix || '')).map(Key => ({ Key })) };
  if (n === 'CreateMultipartUploadCommand') return { UploadId: 'up_' + crypto.randomBytes(4).toString('hex') };
  if (n === 'AbortMultipartUploadCommand' || n === 'CompleteMultipartUploadCommand') return {};
  if (n === 'GetBucketCorsCommand') return { CORSRules: [] };
  if (n === 'PutBucketCorsCommand') return {};
  throw new Error('the stand-in bucket does not know ' + n);
} };
const store = require('../src/storage').createStore({ bucket: 'wm-test', client, localRoot: path.join(DIR, 'vault') });

const { createApp } = require('../src/app');
const app = createApp({ dataDir: DIR, base: process.env.BASE || 'http://localhost', adminPassword: 'pw', secret: 'two-copies', stripeKey: 'sk_test_dummy', stripePk: 'pk_test_dummy', stripeClient, webhookSecret: 'whsec_test', noTimers: true, store });
const at = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const ops = {
  // app.locals.<path>(...args), its answer as JSON
  call: async m => { const parts = m.path.split('.'); const fn = at(app.locals, m.path); const self = parts.length > 1 ? at(app.locals, parts.slice(0, -1).join('.')) : app.locals; if (typeof fn !== 'function') throw new Error('no function ' + m.path); return fn.apply(self, m.args || []); },
  sql: async m => app.locals.db.prepare(m.sql)[m.how || 'all'](...(m.args || [])),
  mails: async () => (app.locals.mailLog || []).map(x => ({ to: x.to, subject: x.subject })),
  lastCode: async () => app.locals.lastCode,
  me: async () => app.locals.instances.ME,
  get: async m => at(app.locals, m.path),
  ledgerOk: async () => require('../src/ledger').verify(app.locals.db),
};
const srv = app.listen(0, () => process.send({ ready: srv.address().port, me: app.locals.instances.ME }));
process.on('message', async m => {
  if (m && m.op === 'exit') { srv.close(); process.exit(0); }
  try { const v = await ops[m.op](m); process.send({ id: m.id, v: v === undefined ? null : JSON.parse(JSON.stringify(v)) }); }
  catch (e) { process.send({ id: m.id, err: String(e && e.stack || e).slice(0, 800) }); }
});
process.on('disconnect', () => process.exit(0));
