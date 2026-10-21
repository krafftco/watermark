// The only copy (21 Oct): an original registered with the bucket copy still to come has one copy in the world, the
// local one. Conservation never drops it to "fetch it again"; a copy that is truly gone puts the work off view with
// the finding (its picture answers 404, never 500); and the moment the file is back the queue vaults it.
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createStore } = require('../src/storage');
const { createApp } = require('../src/app');
const objs = {};
const client = { async send(cmd) {
  const n = cmd.constructor.name, i = cmd.input;
  if (n === 'PutObjectCommand') { objs[i.Key] = Buffer.from(i.Body); return {}; }
  if (n === 'GetObjectCommand') { if (!objs[i.Key]) { const e = new Error('nope'); e.name = 'NoSuchKey'; throw e; } const b = objs[i.Key]; return { Body: { transformToByteArray: async () => new Uint8Array(b) } }; }
  if (n === 'HeadObjectCommand') { if (!objs[i.Key]) { const e = new Error('nope'); e.name = 'NotFound'; throw e; } return { ContentLength: objs[i.Key].length }; }
  if (n === 'DeleteObjectCommand') { delete objs[i.Key]; return {}; }
  if (n === 'ListObjectsV2Command') return { Contents: Object.keys(objs).filter(k => k.startsWith(i.Prefix)).map(Key => ({ Key })) };
  if (n === 'GetBucketCorsCommand') return { CORSRules: [] };
  return {};
} };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-vault-'));
  const store = createStore({ bucket: 'b', client });
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', noTimers: true, store });
  const { db, registerWork } = app.locals;
  const fixture = process.argv[2] || path.join(__dirname, 'fixture.jpg');
  const tmp = path.join(dir, 'in.jpg'); fs.copyFileSync(fixture, tmp);
  const w0 = await registerWork({ file: tmp, title: 'The Only Copy', originalName: 'only.jpg' });
  await new Promise(r => setTimeout(r, 300)); // let the queue's 50 ms kick run first
  let w = db.prepare('SELECT * FROM works WHERE id=?').get(w0.id);
  // the queue may already have run (50 ms after the insert); put the work back to the moment before the bucket had it
  db.prepare('UPDATE works SET vaulted=0 WHERE id=?').run(w.id); delete objs['originals/' + w.original_file]; w.vaulted = 0;
  const local = path.join(dir, 'originals', w.original_file); assert.ok(fs.existsSync(local));
  // 1. A damaged local copy of the only copy is reported, never dropped.
  const whole = fs.readFileSync(local); fs.writeFileSync(local, whole.subarray(0, Math.floor(whole.length / 2)));
  let r = await app.locals.conservation.check(w, { renders: false });
  assert.ok(fs.existsSync(local), 'the only copy is still on disk after a failed decode');
  assert.ok(r.findings.some(f => /does not decode|incomplete/i.test(f)) && !r.findings.some(f => /dropped/i.test(f)), r.findings.join(' | '));
  fs.writeFileSync(local, whole);
  // 2. The file truly gone: off view with the finding, the picture 404, told on /healthz.
  fs.unlinkSync(local);
  await app.locals.vaultPending();
  w = db.prepare('SELECT * FROM works WHERE id=?').get(w0.id);
  assert.equal(w.status, 'restoring', 'off view for conservation'); assert.equal(w.vaulted, 0);
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  assert.equal((await fetch(`${base}/img/${w.slug}/screen`)).status, 404, 'a missing original is 404, not 500');
  const h = await (await fetch(`${base}/healthz`)).json(); assert.ok(h.vault.lost.includes(w.slug), JSON.stringify(h.vault));
  // 3. The same file sent again comes home to its record (never "already held"): vaulted on the next pass, the bucket
  // holds it, back on view.
  const again = path.join(dir, 'again.jpg'); fs.writeFileSync(again, whole);
  const home = await registerWork({ file: again, title: 'Sent Again', originalName: 'again.jpg' });
  assert.equal(home.id, w0.id, 'the same record'); assert.ok(home.cameHome); assert.ok(fs.existsSync(local));
  await app.locals.vaultPending();
  w = db.prepare('SELECT * FROM works WHERE id=?').get(w0.id);
  assert.equal(w.vaulted, 1); assert.ok(objs['originals/' + w.original_file], 'in the bucket');
  r = await app.locals.conservation.check(w, { renders: false }); assert.ok(r.ok, r.findings.join(' | '));
  w = db.prepare('SELECT * FROM works WHERE id=?').get(w0.id); assert.equal(w.status, 'held');
  assert.equal((await fetch(`${base}/img/${w.slug}/screen`)).status, 200);
  srv.close();
  console.log('ok: the only copy');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
