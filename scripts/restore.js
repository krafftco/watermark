#!/usr/bin/env node
// Restore a database backup from the vault by hand: node scripts/restore.js [key]
// Needs the same S3_BUCKET / AWS_REGION / S3_ENDPOINT / VAULT_KEY / DATA_DIR as the app. Without a key, the latest.
// Writes DATA_DIR/watermark.restored.db after checking it; swapping it in is yours: stop the app, move the files, start it.
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
const Database = require('better-sqlite3');
const { createStore } = require('../src/storage');
(async () => {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const store = createStore({ bucket: process.env.S3_BUCKET, region: process.env.AWS_REGION, endpoint: process.env.S3_ENDPOINT, vaultKey: process.env.VAULT_KEY, localRoot: path.join(dataDir, 'vault') });
  let key = process.argv[2];
  if (!key) { const j = await store.get('backups/latest.json'); if (!j) throw new Error('no backup in the vault'); key = JSON.parse(j.toString()).key; }
  const gz = await store.get(key); if (!gz) throw new Error(`not found: ${key}`);
  const raw = zlib.gunzipSync(gz);
  if (/\.pgdump\.gz$/.test(key)) { // a Postgres house's copy: the restore is pg_restore's, with the house stopped
    const out = path.join(dataDir, 'watermark.restored.pgdump'); fs.writeFileSync(out, raw);
    console.log(`fetched ${key} → ${out} (${raw.length} bytes)`);
    console.log('Now, with the house stopped: pg_restore --clean --if-exists --no-owner --no-acl -d "$DATABASE_URL" ' + out + ' ; then start it.');
    return;
  }
  const out = path.join(dataDir, 'watermark.restored.db'); fs.writeFileSync(out, raw);
  const b = new Database(out, { readonly: true }); const integ = b.pragma('integrity_check', { simple: true });
  const n = b.prepare('SELECT COUNT(*) n FROM ledger').get().n; b.close();
  if (integ !== 'ok') throw new Error(`integrity_check: ${integ}`);
  console.log(`restored ${key} → ${out} (${raw.length} bytes, register ${n} entries, integrity ok)`);
  console.log('Now: stop the app; mv watermark.db watermark.before-restore.db; mv watermark.restored.db watermark.db; remove watermark.db-wal and -shm; start the app.');
})().catch(e => { console.error(e.message); process.exit(1); });
