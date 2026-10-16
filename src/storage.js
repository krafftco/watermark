// The vault. Originals, sealed files and database backups live in object storage
// (Amazon S3, or any S3-compatible store such as Cloudflare R2). The server's disk is only a cache:
// lose the server and nothing is lost. Without S3 settings, everything stays on local disk (development).
const fs = require('fs');
const path = require('path');

function localStore(root) {
  const p = k => path.join(root, k);
  return {
    kind: 'local',
    async put(key, body) { fs.mkdirSync(path.dirname(p(key)), { recursive: true }); fs.writeFileSync(p(key), Buffer.isBuffer(body) ? body : fs.readFileSync(body)); },
    async get(key) { return fs.existsSync(p(key)) ? fs.readFileSync(p(key)) : null; },
    async list(prefix) { const d = path.dirname(p(prefix + 'x')); return fs.existsSync(d) ? fs.readdirSync(d).map(f => path.posix.join(path.posix.dirname(prefix + 'x'), f)).filter(k => k.startsWith(prefix)) : []; },
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
  };
}

function createStore(cfg) {
  if (cfg.bucket) return s3Store(cfg);
  return localStore(cfg.localRoot);
}

module.exports = { createStore };
