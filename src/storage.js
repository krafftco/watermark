// The vault. Originals, sealed files and database backups live in object storage
// (Amazon S3, or any S3-compatible store such as Cloudflare R2). The server's disk is only a cache:
// lose the server and nothing is lost. Without S3 settings, everything stays on local disk (development).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Watermark's own key. With VAULT_KEY set (any random secret of 32+ characters; Render generates one), every object is sealed with
// AES-256-GCM before it leaves the server, so the storage provider holds only what it cannot read.
// Objects written before the key existed are read as they are. Lose the key and the vault is unreadable:
// keep it in two safe places.
const MAGIC = Buffer.from('WMV1');
function sealer(keyB64) {
  if (!keyB64) return { on: false, seal: b => b, open: b => b };
  if (String(keyB64).length < 32) throw new Error('VAULT_KEY must be at least 32 characters.');
  const key = crypto.createHash('sha256').update('watermark-vault:' + keyB64).digest();
  return {
    on: true,
    seal(b) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([MAGIC, iv, c.update(b), c.final(), c.getAuthTag()]); },
    open(b) {
      if (!b || b.length < 32 || !b.subarray(0, 4).equals(MAGIC)) return b;
      const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(4, 16)); d.setAuthTag(b.subarray(b.length - 16));
      return Buffer.concat([d.update(b.subarray(16, b.length - 16)), d.final()]);
    },
  };
}

function localStore(root) {
  const p = k => path.join(root, k);
  return {
    kind: 'local',
    async put(key, body) { fs.mkdirSync(path.dirname(p(key)), { recursive: true }); fs.writeFileSync(p(key), Buffer.isBuffer(body) ? body : fs.readFileSync(body)); },
    async get(key) { return fs.existsSync(p(key)) ? fs.readFileSync(p(key)) : null; },
    async list(prefix) { const d = path.dirname(p(prefix + 'x')); return fs.existsSync(d) ? fs.readdirSync(d).map(f => path.posix.join(path.posix.dirname(prefix + 'x'), f)).filter(k => k.startsWith(prefix)) : []; },
    async del(key) { try { fs.unlinkSync(p(key)); } catch (e) { /* gone */ } },
    async size(key) { try { return fs.statSync(p(key)).size; } catch (e) { return null; } },
  };
}

function s3Store({ bucket, region, endpoint, client }) {
  const S3 = require('@aws-sdk/client-s3');
  const c = client || new S3.S3Client({ region: region || 'us-east-1', ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
  const isR2 = endpoint && /r2\.cloudflarestorage/.test(endpoint);
  return {
    kind: 's3',
    async put(key, body, type = 'application/octet-stream') {
      await c.send(new S3.PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.isBuffer(body) ? body : fs.readFileSync(body), ContentType: type, ...(isR2 ? {} : { ServerSideEncryption: 'AES256' }) }));
    },
    async get(key) {
      try { const r = await c.send(new S3.GetObjectCommand({ Bucket: bucket, Key: key })); return Buffer.from(await r.Body.transformToByteArray()); }
      catch (e) { if (e.name === 'NoSuchKey' || (e.$metadata && e.$metadata.httpStatusCode === 404)) return null; throw e; }
    },
    async list(prefix) {
      const r = await c.send(new S3.ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
      return (r.Contents || []).map(o => o.Key);
    },
    async del(key) { await c.send(new S3.DeleteObjectCommand({ Bucket: bucket, Key: key })); },
    async size(key) { try { const r = await c.send(new S3.HeadObjectCommand({ Bucket: bucket, Key: key })); return r.ContentLength; } catch (e) { return null; } },
    // Arrivals (20 Oct): a browser uploads straight into the bucket in parts, by signed addresses, never through the
    // house's server; the house completes the upload and reads the object back when it takes the file in.
    multipart: {
      async start(key, type) { const r = await c.send(new S3.CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: type || 'application/octet-stream', ...(isR2 ? {} : { ServerSideEncryption: 'AES256' }) })); return r.UploadId; },
      async partUrl(key, uploadId, n, expires = 3600) { const { getSignedUrl } = require('@aws-sdk/s3-request-presigner'); return getSignedUrl(c, new S3.UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: n }), { expiresIn: expires }); },
      async complete(key, uploadId, parts) { await c.send(new S3.CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.n, ETag: p.etag })) } })); },
      async abort(key, uploadId) { try { await c.send(new S3.AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })); } catch (e) { /* gone */ } },
    },
    // the object as it is, unsealed, written to a file (for an arrival, which came from a browser and is not sealed)
    async download(key, file) { const r = await c.send(new S3.GetObjectCommand({ Bucket: bucket, Key: key })); await new Promise((res, rej) => { const w = fs.createWriteStream(file); r.Body.pipe(w).on('finish', res).on('error', rej); r.Body.on('error', rej); }); },
  };
}

function createStore(cfg) {
  const raw = cfg.bucket ? s3Store(cfg) : localStore(cfg.localRoot);
  const k = sealer(cfg.vaultKey);
  return {
    kind: raw.kind, encrypted: k.on,
    put: (key, body, type) => raw.put(key, k.seal(Buffer.isBuffer(body) ? body : fs.readFileSync(body)), type),
    get: async key => k.open(await raw.get(key)),
    list: prefix => raw.list(prefix),
    del: key => raw.del(key),
    size: key => raw.size(key),
    multipart: raw.multipart || null, download: raw.download || null,
    // A known object proves the key is the right one before anything is written with it.
    async checkKey() {
      if (!k.on) return 'off';
      const probe = await raw.get('vault/keycheck');
      if (!probe) { await raw.put('vault/keycheck', k.seal(Buffer.from('watermark')), 'application/octet-stream'); return 'set'; }
      try { if (k.open(probe).toString() === 'watermark') return 'ok'; } catch (e) { /* wrong key */ }
      throw new Error('VAULT_KEY does not match the key this vault was sealed with. Refusing to start.');
    },
  };
}

module.exports = { createStore };
