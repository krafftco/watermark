#!/usr/bin/env node
// Restore a database backup from the vault by hand: node scripts/restore.js [key]
// Needs the same S3_BUCKET / AWS_REGION / S3_ENDPOINT / VAULT_KEY / DATA_DIR as the app. Without a key, the latest.
// Writes DATA_DIR/watermark.restored.db after checking it; swapping it in is yours: stop the app, move the files, start it.
const path = require('path'); const fs = require('fs'); const zlib = require('zlib'); const crypto = require('crypto'); const { pipeline } = require('stream/promises');
const Database = require('better-sqlite3');
const { createStore } = require('../src/storage');
(async () => {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const store = createStore({ bucket: process.env.S3_BUCKET, region: process.env.AWS_REGION, endpoint: process.env.S3_ENDPOINT, vaultKey: process.env.VAULT_KEY, localRoot: path.join(dataDir, 'vault') });
  let key = process.argv[2];
  if (!key) { const j = await store.get('backups/latest.json'); if (!j) throw new Error('no backup in the vault'); key = JSON.parse(j.toString()).key; }
  // (27 Nov, #162) As streams, to the disk: fetched, unsealed (the seal's tag is proven at the end) and unzipped
  // without holding the copy, so a copy of any size is restored on a small machine. Reads every copy ever made.
  const pg = /\.pgdump\.gz$/.test(key), out = path.join(dataDir, pg ? 'watermark.restored.pgdump' : 'watermark.restored.db');
  const src = await store.readStream(key); if (!src) throw new Error(`not found: ${key}`);
  const sha = crypto.createHash('sha256'), gun = zlib.createGunzip(); let bytes = 0; gun.on('data', d => { sha.update(d); bytes += d.length; });
  try { await pipeline(src, gun, fs.createWriteStream(out + '.part')); } catch (e) { try { fs.unlinkSync(out + '.part'); } catch (x) { /* */ } throw e; }
  fs.renameSync(out + '.part', out);
  const raw = { length: bytes }, sha256 = sha.digest('hex');
  { let L = null; try { const j = await store.get('backups/latest.json'); L = j ? JSON.parse(j.toString()) : null; } catch (e) { /* the copy is judged without it */ }
    if (L && L.key === key && L.sha256) { if (L.sha256 !== sha256) throw new Error(`the copy that came back is not the copy that was made (fingerprint ${sha256.slice(0, 12)}…, made ${L.sha256.slice(0, 12)}…); ${out} is left for a look: do not restore from it`); console.log('fingerprint as made'); } }
  if (pg) { // a Postgres house's copy: the restore is pg_restore's, with the house stopped
    console.log(`fetched ${key} → ${out} (${raw.length} bytes)`);
    console.log('Now, with the house stopped: pg_restore --clean --if-exists --no-owner --no-acl -d "$DATABASE_URL" ' + out + ' ; then start it.');
    return;
  }
  const b = new Database(out, { readonly: true }); const integ = b.pragma('integrity_check', { simple: true });
  const n = b.prepare('SELECT COUNT(*) n FROM ledger').get().n; b.close();
  if (integ !== 'ok') throw new Error(`integrity_check: ${integ}`);
  console.log(`restored ${key} → ${out} (${raw.length} bytes, register ${n} entries, integrity ok)`);
  console.log('Now: stop the app; mv watermark.db watermark.before-restore.db; mv watermark.restored.db watermark.db; remove watermark.db-wal and -shm; start the app.');
})().catch(e => { console.error(e.message); process.exit(1); });
