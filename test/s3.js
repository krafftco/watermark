// The S3 driver against an in-memory stand-in for S3 (same commands the real service receives).
const assert = require('assert');
const { createStore } = require('../src/storage');
const objs = {}; const seen = [];
const client = { async send(cmd) {
  const n = cmd.constructor.name, i = cmd.input; seen.push([n, i]);
  if (n === 'PutObjectCommand') { objs[i.Key] = i.Body; return {}; }
  if (n === 'GetObjectCommand') { if (!objs[i.Key]) { const e = new Error('nope'); e.name = 'NoSuchKey'; throw e; } const b = objs[i.Key]; return { Body: { transformToByteArray: async () => new Uint8Array(b) } }; }
  if (n === 'ListObjectsV2Command') return { Contents: Object.keys(objs).filter(k => k.startsWith(i.Prefix)).map(Key => ({ Key })) };
} };
(async () => {
  const s = createStore({ bucket: 'krafft-watermark-vault', client });
  await s.put('originals/a.jpg', Buffer.from('photo'), 'image/jpeg');
  assert.equal(seen[0][1].ServerSideEncryption, 'AES256'); assert.equal(seen[0][1].Bucket, 'krafft-watermark-vault');
  assert.equal((await s.get('originals/a.jpg')).toString(), 'photo');
  assert.equal(await s.get('originals/missing.jpg'), null);
  assert.deepEqual(await s.list('originals/'), ['originals/a.jpg']);
  // Watermark's own key: S3 only ever holds sealed bytes; wrong key refuses to start
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
  console.log('ok: s3 driver');
})().catch(e => { console.error(e); process.exit(1); });
