// The S3 driver against an in-memory stand-in for S3 (same commands the real service receives).
const assert = require('assert');
const { createStore } = require('../src/storage');
const objs = {}; const seen = [];
const client = { async send(cmd) {
  const n = cmd.constructor.name, i = cmd.input; seen.push([n, i]);
  if (n === 'PutObjectCommand') { objs[i.Key] = i.Body; return {}; }
  if (n === 'GetObjectCommand') { if (!objs[i.Key]) { const e = new Error('nope'); e.name = 'NoSuchKey'; throw e; } const b = objs[i.Key]; return { Body: { transformToByteArray: async () => new Uint8Array(b) } }; }
  if (n === 'ListObjectsV2Command') return { Contents: Object.keys(objs).filter(k => k.startsWith(i.Prefix)).map(Key => ({ Key })) };
  if (n === 'GetBucketCorsCommand') { if (!client.cors) { const e = new Error('none'); e.name = 'NoSuchCORSConfiguration'; throw e; } return { CORSRules: client.cors }; }
  if (n === 'PutBucketCorsCommand') { if (client.corsForbidden) { const e = new Error('no'); e.$metadata = { httpStatusCode: 403 }; throw e; } client.cors = i.CORSConfiguration.CORSRules; return {}; }
} };
(async () => {
  const s = createStore({ bucket: 'krafft-watermark-vault', client });
  await s.put('originals/a.jpg', Buffer.from('photo'), 'image/jpeg');
  assert.equal(seen[0][1].ServerSideEncryption, 'AES256'); assert.equal(seen[0][1].Bucket, 'krafft-watermark-vault');
  assert.equal((await s.get('originals/a.jpg')).toString(), 'photo');
  assert.equal(await s.get('originals/missing.jpg'), null);
  assert.deepEqual(await s.list('originals/'), ['originals/a.jpg']);
  // Watermark's own key: S3 only ever holds sealed bytes; wrong key refuses to start
  // The bucket's door for the browser (21 Oct): set by the house, idempotent, and 'forbidden' said plainly when the key cannot.
  assert.equal(await s.ensureCors(['https://watermark.krafftco.com']), 'set'); assert.ok(client.cors[0].ExposeHeaders.includes('ETag') && client.cors[0].AllowedMethods.includes('PUT'));
  assert.equal(await s.ensureCors(['https://watermark.krafftco.com']), 'ok', 'already set: left alone');
  client.corsForbidden = true; client.cors = null; assert.equal(await s.ensureCors(['https://x.example']), 'forbidden'); client.corsForbidden = false;
  const key = require('crypto').randomBytes(32).toString('base64');
  const v = createStore({ bucket: 'b', client, vaultKey: key });
  assert.equal(await v.checkKey(), 'set'); assert.equal(await v.checkKey(), 'ok');
  await v.put('originals/b.jpg', Buffer.from('the master'), 'image/jpeg');
  assert.ok(!Buffer.from(objs['originals/b.jpg']).includes(Buffer.from('the master')), 'provider sees only sealed bytes');
  assert.equal((await v.get('originals/b.jpg')).toString(), 'the master');
  assert.equal((await v.get('originals/a.jpg')).toString(), 'photo', 'files from before the key still read');
  const wrong = createStore({ bucket: 'b', client, vaultKey: require('crypto').randomBytes(32).toString('base64') });
  await assert.rejects(wrong.checkKey(), /does not match/);
  assert.throws(() => createStore({ bucket: 'b', client, vaultKey: 'short' }), /32 characters/);
  // The lock (29 Oct): masters written under GOVERNANCE retention; others not; a bucket that refuses is noted, the write goes through.
  process.env.VAULT_LOCK_DAYS = '365';
  const L = createStore({ bucket: 'b', client });
  seen.length = 0; await L.put('originals/c.jpg', Buffer.from('m'), 'image/jpeg'); await L.put('backups/x.gz', Buffer.from('b'));
  assert.equal(seen[0][1].ObjectLockMode, 'GOVERNANCE'); assert.ok(seen[0][1].ObjectLockRetainUntilDate > new Date(Date.now() + 300 * 864e5)); assert.ok(!seen[1][1].ObjectLockMode, 'backups are not locked');
  assert.equal(L.lock.state, 'on');
  let ret = 0; const send0 = client.send; client.send = async cmd => { if (cmd.constructor.name === 'PutObjectRetentionCommand') { ret++; return {}; } return send0(cmd); };
  const r = await L.retainAll(); assert.ok(r.ok && r.n === ret && ret >= 3, 'the lock laid over what is held: ' + JSON.stringify(r));
  client.send = async cmd => { if (cmd.input.ObjectLockMode) { const e = new Error('Bucket is missing Object Lock Configuration'); e.name = 'InvalidRequest'; throw e; } return send0(cmd); };
  const R = createStore({ bucket: 'b', client }); await R.put('originals/d.jpg', Buffer.from('m'), 'image/jpeg');
  assert.equal(R.lock.state, 'refused'); assert.ok(objs['originals/d.jpg'], 'written without the lock'); client.send = send0; delete process.env.VAULT_LOCK_DAYS;
  console.log('ok: s3 driver');
})().catch(e => { console.error(e); process.exit(1); });
