// Restore the latest database backup from the vault onto a new server.
// Usage: S3_BUCKET=... AWS_REGION=... DATA_DIR=/data node scripts/restore.js [backup-key]
// Originals need no restore: the app fetches each one from the vault the first time it is needed.
const fs = require('fs'); const path = require('path');
const { createStore } = require('../src/storage');
(async () => {
  const dataDir = process.env.DATA_DIR || './data';
  const store = createStore({ bucket: process.env.S3_BUCKET, region: process.env.AWS_REGION, endpoint: process.env.S3_ENDPOINT, localRoot: path.join(dataDir, 'vault') });
  const key = process.argv[2] || (await store.list('backups/db/')).sort().pop();
  if (!key) throw new Error('No backups found in the vault.');
  const dest = path.join(dataDir, 'watermark.db');
  if (fs.existsSync(dest)) throw new Error(`${dest} exists. Move it aside first; this script never overwrites.`);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dest, await store.get(key));
  console.log('Restored', key, '→', dest);
})().catch(e => { console.error(e.message); process.exit(1); });
