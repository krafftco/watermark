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
  console.log('ok: s3 driver');
})().catch(e => { console.error(e); process.exit(1); });
