// Backups and the restore drill (#162, 27 Nov). On live the copy had grown to 660 MB; from 20 Nov the drill did not run
// on a copy over 200 MB, health said `drill.ok: false` with no reason, and the next try was a week away. This proves:
//   1. the vault seals and opens as streams, in the one format (what `seal` wrote `openStream` reads, and the other way);
//      a stream into a bucket goes in parts, and a failed one is aborted;
//   2. a copy larger than the memory allowed is backed up, drilled and restored by hand (scripts/restore.js) while the
//      process stays within MEM_MB of where it stood;
//   3. every way a drill fails leaves its step, its seconds and its words on /healthz and Studio → Backups, raises the
//      alarm, and is due again after the next night's copy; a drill ended with its process is not silence;
//   4. `stale` is also a drill that has not passed in DRILL_STALE_DAYS.
// Both engines: with DATABASE_URL the copy is pg_dump's and the drill restores into a scratch database.
//   node test/backup.js            BACKUP_TEST_MB (256) sets the copy's size; BACKUP_TEST_MEM_MB (200) the allowance.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.VAULT_PART_MB = '5';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os'); const zlib = require('zlib'); const crypto = require('crypto');
const { Readable } = require('stream'); const { execFileSync } = require('child_process');
const { createStore } = require('../src/storage');
const { createApp } = require('../src/app');
const MB = 1048576, SIZE = +(process.env.BACKUP_TEST_MB || 256), MEM = +(process.env.BACKUP_TEST_MEM_MB || 200);
const t0 = Date.now(); const say = (...a) => console.log(`[backup ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const drain = async s => { const c = []; for await (const d of s) c.push(d); return Buffer.concat(c); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-backup-'));
  const KEY = crypto.randomBytes(32).toString('base64');

  // 1. The seal as a stream, on the local vault: every size round the head and the tag, both ways, sealed and plain.
  for (const vaultKey of [undefined, KEY]) {
    const s = createStore({ localRoot: path.join(dir, vaultKey ? 'sealed' : 'plain'), vaultKey });
    for (const n of [0, 1, 15, 16, 17, 31, 32, 33, 65536, 3 * MB + 7]) {
      const b = crypto.randomBytes(n), f = path.join(dir, 'f'); fs.writeFileSync(f, b);
      await s.putFile(`a/file-${n}`, f); assert.ok((await s.get(`a/file-${n}`)).equals(b), `sent as a stream, read whole (${n})`);
      await s.put(`a/whole-${n}`, b); assert.ok((await drain(await s.readStream(`a/whole-${n}`))).equals(b), `sent whole, read as a stream (${n})`);
    }
    assert.equal(await s.readStream('a/none'), null, 'no such copy: null, not an error');
    if (vaultKey) {
      const p = path.join(dir, 'sealed', 'a', 'file-65536'), b = fs.readFileSync(p);
      assert.ok(b.subarray(0, 4).toString() === 'WMV1', 'the one format');
      const c = Buffer.from(b); c[4000] ^= 1; fs.writeFileSync(p, c); await assert.rejects(drain(await s.readStream('a/file-65536')), /seal does not verify/, 'a changed copy does not open');
      fs.writeFileSync(p, b.subarray(0, b.length - 5)); await assert.rejects(drain(await s.readStream('a/file-65536')), /seal does not verify|cut short/, 'a copy cut short does not open');
      const other = createStore({ localRoot: path.join(dir, 'sealed'), vaultKey: crypto.randomBytes(32).toString('base64') });
      await assert.rejects(drain(await other.readStream('a/file-16')), /seal does not verify/, 'another key does not open it');
    }
  }
  // A bucket (the commands the real service receives): in parts of VAULT_PART_MB, one object when it fits in one part,
  // aborted when a part fails; read back as a stream.
  { const objs = {}, ups = {}, seen = []; let failPart = 0;
    const client = { async send(cmd) {
      const n = cmd.constructor.name, i = cmd.input; seen.push(n);
      if (n === 'PutObjectCommand') { objs[i.Key] = Buffer.from(i.Body); return {}; }
      if (n === 'CreateMultipartUploadCommand') { const id = 'u' + seen.length; ups[id] = { key: i.Key, parts: {}, sse: i.ServerSideEncryption }; return { UploadId: id }; }
      if (n === 'UploadPartCommand') { if (i.PartNumber === failPart) throw new Error('the line dropped'); assert.ok(Buffer.isBuffer(i.Body) && i.Body.length <= 5 * MB, 'a part is one part'); ups[i.UploadId].parts[i.PartNumber] = Buffer.from(i.Body); return { ETag: `"e${i.PartNumber}"` }; }
      if (n === 'CompleteMultipartUploadCommand') { const u = ups[i.UploadId]; const ps = i.MultipartUpload.Parts; assert.deepEqual(ps.map(p => p.PartNumber), ps.map((p, k) => k + 1)); assert.ok(ps.slice(0, -1).every(p => u.parts[p.PartNumber].length === 5 * MB), 'every part but the last is whole'); objs[u.key] = Buffer.concat(ps.map(p => u.parts[p.PartNumber])); delete ups[i.UploadId]; return {}; }
      if (n === 'AbortMultipartUploadCommand') { delete ups[i.UploadId]; return {}; }
      if (n === 'GetObjectCommand') { if (!objs[i.Key]) { const e = new Error('nope'); e.name = 'NoSuchKey'; throw e; } const b = objs[i.Key]; return { Body: Object.assign(Readable.from((function* () { for (let o = 0; o < b.length; o += 70001) yield b.subarray(o, o + 70001); })(), { objectMode: false }), { transformToByteArray: async () => new Uint8Array(b) }) }; }
      return {};
    } };
    const s = createStore({ bucket: 'b', client, vaultKey: KEY });
    const big = crypto.randomBytes(12 * MB + 12345), f = path.join(dir, 'big'); fs.writeFileSync(f, big);
    await s.putFile('backups/db/big.gz', f, 'application/gzip');
    assert.deepEqual(seen.filter(n => /Upload/.test(n)), ['CreateMultipartUploadCommand', 'UploadPartCommand', 'UploadPartCommand', 'UploadPartCommand', 'CompleteMultipartUploadCommand'], seen.join(' '));
    assert.ok(!objs['backups/db/big.gz'].includes(big.subarray(100, 164)), 'the bucket holds only sealed bytes');
    assert.ok((await drain(await s.readStream('backups/db/big.gz'))).equals(big), 'back from the bucket as a stream');
    assert.ok((await s.get('backups/db/big.gz')).equals(big), 'and whole, by the reader every older script has');
    seen.length = 0; fs.writeFileSync(f, big.subarray(0, 1000)); await s.putFile('backups/db/small.gz', f); assert.deepEqual(seen, ['PutObjectCommand'], 'what fits in a part is one object');
    assert.ok((await drain(await s.readStream('backups/db/small.gz'))).equals(big.subarray(0, 1000)));
    fs.writeFileSync(f, big); failPart = 2; seen.length = 0; await assert.rejects(s.putFile('backups/db/dropped.gz', f), /the line dropped/); failPart = 0;
    assert.ok(seen.includes('AbortMultipartUploadCommand') && !Object.keys(ups).length && !objs['backups/db/dropped.gz'], 'a failed upload is aborted, never left half-made or half-kept');
    assert.equal(await s.readStream('backups/db/none.gz'), null);
    fs.unlinkSync(f);
    say('the seal as a stream; a bucket in parts'); }

  // 2. A house whose copy is larger than the memory allowed.
  const mailed = [];
  const app = createApp({ dataDir: path.join(dir, 'house'), base: 'http://localhost', adminPassword: 'pw', secret: 's', noTimers: true, vaultNow: true, vaultKey: KEY });
  const { db, store } = app.locals, B = app.locals.backup, pg = db.kind === 'postgres';
  const mail = require('../src/mail'); const send0 = mail.send; mail.send = async m => { mailed.push(m); return true; };
  assert.ok(store.encrypted, 'a sealed vault');
  db.exec(`CREATE TABLE IF NOT EXISTS wm_ballast (id INTEGER PRIMARY KEY, b ${pg ? 'BYTEA' : 'BLOB'})`);
  { const ins = db.prepare('INSERT INTO wm_ballast (b) VALUES (?)'); for (let i = 0; i < SIZE; i++) ins.run(crypto.randomBytes(MB)); } // random: neither pg_dump nor gzip makes it small
  if (global.gc) global.gc();
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const ck = (await fetch(`${base}/studio/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' })).headers.get('set-cookie').split(';')[0];
  const health = async () => (await (await fetch(`${base}/healthz`, { headers: { cookie: ck } })).json()).backup;
  const desk = async () => (await (await fetch(`${base}/studio/backups`, { headers: { cookie: ck } })).text());
  // Memory, judged: resident memory sampled through the copy, the drill and the restore by hand.
  const rss = () => process.memoryUsage().rss / MB; let peak = 0; const watch = setInterval(() => { peak = Math.max(peak, rss()); }, 20);
  const judged = async (what, f) => { await new Promise(r => setTimeout(r, 300)); if (global.gc) global.gc(); const from = rss(); peak = from; const r = await f(); const rose = Math.round(peak - from); say(`${what}: memory rose ${rose} MB (from ${Math.round(from)} MB; allowed ${MEM})`); assert.ok(rose < MEM, `${what} held ${rose} MB over where it stood: a copy of ${SIZE} MB must not be held (allowed ${MEM} MB)`); return r; };

  const b1 = await judged('the copy', () => B.backup());
  assert.ok(b1.bytes > SIZE * MB * 0.95, `a copy larger than the memory allowed (${Math.round(b1.bytes / MB)} MB, allowed ${MEM} MB)`); assert.ok(SIZE > MEM, 'the test means a copy larger than its allowance');
  assert.ok(!fs.readdirSync(path.join(dir, 'house')).some(f => /^backup-.*tmp/.test(f)), 'nothing left on the disk after the copy');
  const d1 = await judged('the drill', () => B.drill());
  assert.ok(d1.ok && /matches the live one and verifies; fingerprint as made/.test(d1.detail), d1.detail);
  assert.ok(!fs.readdirSync(path.join(dir, 'house')).some(f => /^drill-.*tmp/.test(f)), 'nothing left on the disk after the drill');
  let h = await health();
  assert.ok(h.last.ok && h.drill.ok && h.drill.step === 'done' && typeof h.drill.secs === 'number' && h.drill.passed === h.drill.at && !h.drill.error && h.stale === false && h.drillStale === false && h.backupStale === false, JSON.stringify(h));
  assert.equal(B.drillDue(new Date('2026-11-25T07:10:00Z'), { copied: true }), false, 'a Wednesday after a drill that passed: not due'); // 25 Nov 2026 is a Wednesday
  assert.equal(B.drillDue(new Date('2026-11-29T07:10:00Z'), { copied: true }), true, 'after Sunday\'s copy: due');
  assert.equal(B.drillDue(new Date('2026-11-25T12:00:00Z')), false, 'between copies, with a passed drill: not due');
  // The restore by hand reads the same copy the same way, in a process of its own held to a small heap.
  { const pre = path.join(dir, 'maxrss.js'); fs.writeFileSync(pre, "let m = 0; const look = () => { m = Math.max(m, process.memoryUsage().rss); }; setInterval(look, 10).unref(); process.on('exit', () => { look(); console.log('maxrss ' + Math.round(m / 1048576)); });"); // sampled, not the kernel's high-water mark: that one begins at the parent's size
    const out = execFileSync(process.execPath, ['--max-old-space-size=64', '-r', pre, path.join(__dirname, '..', 'scripts', 'restore.js')], { env: { ...process.env, DATA_DIR: path.join(dir, 'house'), VAULT_KEY: KEY, S3_BUCKET: '' }, encoding: 'utf8' });
    const most = +(out.match(/maxrss (\d+)/) || [])[1]; say(`the restore by hand: ${most} MB at its peak, the whole process`); assert.ok(most > 0 && most < MEM, `the restore by hand held ${most} MB`);
    assert.ok(/fingerprint as made/.test(out) && (pg ? /fetched backups\/db\/.*pgdump/.test(out) : /integrity ok/.test(out)), out);
    const f = path.join(dir, 'house', pg ? 'watermark.restored.pgdump' : 'watermark.restored.db'); assert.ok(fs.statSync(f).size > SIZE * MB * 0.95); fs.unlinkSync(f);
    // and with the copy held whole, as before this repair, the same small process cannot: the proof that the allowance bites
    const whole = `const {createStore}=require(${JSON.stringify(path.join(__dirname, '..', 'src', 'storage'))});createStore({localRoot:${JSON.stringify(path.join(dir, 'house', 'vault'))},vaultKey:${JSON.stringify(KEY)}}).get(${JSON.stringify(b1.key)}).then(b=>{const z=require('zlib').gunzipSync(b);return z.length})`;
    const held = +(execFileSync(process.execPath, ['-r', pre, '-e', whole], { encoding: 'utf8' }).match(/maxrss (\d+)/) || [])[1]; say(`held whole, as before: ${held} MB at its peak`); assert.ok(held > 2 * SIZE, 'the old road holds the copy several times over'); }
  clearInterval(watch);

  // 3. Every way a drill fails is kept with its step, its seconds and its words; mailed; alarmed; and due again.
  const fails = async (what, step, re, key) => {
    mailed.length = 0; let e = null; try { await B.drill(key); } catch (x) { e = x; }
    assert.ok(e && e.step === step && re.test(e.message), `${what}: failed at ${e && e.step}: ${e && e.message}`);
    const h = await health(); assert.ok(h.drill && h.drill.ok === false && h.drill.step === step && typeof h.drill.secs === 'number' && re.test(h.drill.error) && h.drill.error.length <= 200 && h.drill.passed, `${what} on /healthz: ${JSON.stringify(h.drill)}`);
    const page = await desk(); assert.ok(/The last drill, [^<]*<b>failed<\/b> at “/.test(page) && re.test(page) && /The last drill that passed:/.test(page) && /<th>Step<\/th><th>Took<\/th>/.test(page), `${what} on Studio → Backups`);
    assert.ok(mailed.some(m => /Backup drill failed/.test(m.subject) && m.text.includes(`at "${step}"`) && re.test(m.text) && /tried again after the next nightly copy/.test(m.text)), `${what}: the house is written to, with the step`);
    const w = app.locals.digest.wrongs(); assert.ok(w.some(x => x.includes(`the restore drill failed at "${step}"`) && re.test(x)), `${what} raises the alarm: ${w.join(' | ')}`);
    assert.equal(B.drillDue(new Date('2026-11-25T07:10:00Z'), { copied: true }), true, `${what}: tried again after the next night's copy, not the next Sunday`);
    assert.ok(!fs.readdirSync(path.join(dir, 'house')).some(f => /^drill-.*tmp/.test(f)), `${what}: nothing left on the disk`);
    return h.drill;
  };
  const vaultFile = k => path.join(dir, 'house', 'vault', k);
  const good = fs.readFileSync(vaultFile(b1.key)); // the sealed copy as the vault holds it (the test may hold it; the house may not)
  // the seal: a byte changed in the vault
  { const c = Buffer.from(good); c[c.length >> 1] ^= 1; fs.writeFileSync(vaultFile(b1.key), c); await fails('a copy changed in the vault', 'unseal', /seal does not verify/); }
  // cut short on its way back
  { fs.writeFileSync(vaultFile(b1.key), good.subarray(0, good.length >> 1)); await fails('a copy cut short', 'unseal', /seal does not verify/); }
  fs.writeFileSync(vaultFile(b1.key), good);
  // gone from the vault
  await fails('a copy that is not there', 'fetch', /not found/, `backups/db/watermark-1999-01-01T00-00-00.${pg ? 'pgdump' : 'db'}.gz`);
  // not a gzip
  { const k = `backups/db/watermark-1999-01-02T00-00-00.${pg ? 'pgdump' : 'db'}.gz`; await store.put(k, crypto.randomBytes(4096)); await fails('a copy that does not unzip', 'unzip', /header|gzip|zlib|unexpected/i, k); await store.del(k); }
  // sound in itself, but not the copy that was made: the fingerprint kept beside it says so
  { const latest = JSON.parse((await store.get('backups/latest.json')).toString());
    await store.put('backups/latest.json', Buffer.from(JSON.stringify({ ...latest, sha256: '0'.repeat(64) })));
    await fails('a copy that is not the copy made', 'fingerprint', /not the copy that was made/);
    await store.put('backups/latest.json', Buffer.from(JSON.stringify(latest))); }
  // an archive that restores to nothing (Postgres), or a file that is no database (SQLite)
  { const k = `backups/db/watermark-1999-01-03T00-00-00.${pg ? 'pgdump' : 'db'}.gz`; await store.put(k, zlib.gzipSync(crypto.randomBytes(8192)));
    await fails('a copy that is no database', pg ? 'list' : 'open', pg ? /archive|pg_restore/i : /not a database|integrity|malformed/i, k); await store.del(k); }
  // a failure's words never carry an address with a password
  { const run = db.prepare("SELECT id FROM backup_runs WHERE kind='drill' ORDER BY id DESC LIMIT 1").get();
    db.prepare('UPDATE backup_runs SET detail=? WHERE id=?').run('pg_restore: error: connection to postgres://wm:s3cret-pw@db.internal:5432/wm failed', run.id);
    const h2 = await health(); assert.ok(!/s3cret/.test(JSON.stringify(h2)) && /\(an address\)/.test(h2.drill.error), JSON.stringify(h2.drill)); assert.ok(!/s3cret/.test(await desk()), 'nor on the desk'); }
  // one drill at a time
  { const a = B.drill(), b = B.drill(); await assert.rejects(b, /under way/); assert.ok((await a).ok, 'and the drill passes again on the copy put back'); }
  h = await health(); assert.ok(h.drill.ok && !h.stale, 'passed again');
  assert.ok(!app.locals.digest.wrongs().some(x => /drill/.test(x)), 'and the alarm is quiet');
  say('every failure kept, shown, mailed, alarmed and due again');

  // The line live showed on 27 Nov, as the house of 20 Nov wrote it (no step, no seconds): its words are on health now,
  // and it is due.
  const back = (id, days) => db.prepare("UPDATE backup_runs SET at=datetime('now', ?) WHERE id=?").run(`-${days} days`, id);
  { const id = db.prepare('INSERT INTO backup_runs (kind, key, bytes, ok, detail) VALUES (?,?,?,0,?)').run('drill', b1.key, 661241893, `${b1.key}: not drilled here; the copy is 631 MB and the drill reads it whole (over 200 MB)`).lastInsertRowid; back(id, 5);
    h = await health(); assert.ok(h.drill.ok === false && /not drilled here; the copy is 631 MB/.test(h.drill.error) && h.drill.step === null && h.drill.secs === null, JSON.stringify(h.drill));
    assert.equal(B.drillDue(new Date('2026-11-27T12:00:00Z')), true, 'not tried in 26 hours and not passed: due at the next look, without waiting for a copy');
    assert.ok(!app.locals.digest.wrongs().some(x => /drill/.test(x)), 'five days on it is no longer news, and not yet stale by the drill that passed since');
    // 4. stale: no drill passed in DRILL_STALE_DAYS
    for (const r of db.prepare("SELECT id FROM backup_runs WHERE kind='drill' AND ok=1").all()) back(r.id, 9);
    h = await health(); assert.ok(h.stale === true && h.drillStale === true && h.backupStale === false && h.drillDays === 8, JSON.stringify(h));
    const w = app.locals.digest.wrongs(); assert.ok(w.some(x => /no restore drill has passed in 8 days/.test(x) && /not drilled here/.test(x)) && !w.some(x => /backup is stale/.test(x)), w.join(' | '));
    assert.ok(/No drill has passed in 8 days/.test(await desk()) && !/No backup in the last day/.test(await desk()), 'said on the desk, as what it is');
    assert.ok(/NO DRILL PASSED IN 8 DAYS/.test(app.locals.digest.compose()), 'and in the morning digest'); }
  // A drill ended with its process (the host's memory line, a deploy): its first line stays, and says so.
  { const id = db.prepare("INSERT INTO backup_runs (kind, ok, detail, step) VALUES ('drill', 0, 'begun, not finished: if this line stays, the process ended before the drill did', 'begun')").run().lastInsertRowid;
    h = await health(); assert.ok(h.drill.running === true && !h.drill.error, 'begun a moment ago: under way');
    assert.equal(B.drillDue(new Date()), false, 'not begun twice');
    back(id, 2); h = await health(); assert.ok(!h.drill.running && h.drill.step === 'begun' && /process ended before the drill did/.test(h.drill.error), JSON.stringify(h.drill));
    assert.ok(/<b>failed<\/b> at “begun, not finished”/.test(await desk()));
    assert.equal(B.drillDue(new Date()), true, 'and it is due'); }
  // The drill passes: nothing is stale.
  assert.ok((await B.drill()).ok); h = await health(); assert.ok(h.drill.ok && !h.stale && !h.drillStale, JSON.stringify(h));
  // The Studio's press: answered with how it ended, or within the moment allowed while the drill goes on.
  { const press = async () => { const r = await fetch(`${base}/studio/backups/drill`, { method: 'POST', redirect: 'manual', headers: { cookie: ck, 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: '' }); return decodeURIComponent(r.headers.get('location') || String(r.status)); };
    assert.ok(/matches the live one and verifies/.test(await press()), 'the press says how the drill ended');
    process.env.DRILL_PRESS_MS = '1'; const l = await press(); delete process.env.DRILL_PRESS_MS; assert.ok(/The drill is under way/.test(l), l);
    for (let i = 0; i < 600 && (await health()).drill.running; i++) await new Promise(r => setTimeout(r, 100)); h = await health(); assert.ok(h.drill.ok && !h.drill.running, 'and it ends as a line: ' + JSON.stringify(h.drill)); }
  // A new house: stale by the drill only once its first good copy is DRILL_STALE_DAYS old and none has passed.
  db.prepare("DELETE FROM backup_runs WHERE kind='drill'").run(); h = await health(); assert.ok(h.drill === null && !h.stale, 'a copy made today, no drill yet: not stale');
  for (const r of db.prepare("SELECT id FROM backup_runs WHERE kind='backup'").all()) back(r.id, 9); await B.backup();
  h = await health(); assert.ok(h.drillStale && h.stale && !h.backupStale, JSON.stringify(h));
  assert.equal(B.drillDue(new Date()), true);

  mail.send = send0; srv.close(); db.exec('DROP TABLE wm_ballast');
  if (db.close) try { db.close(); } catch (e) { /* */ }
  fs.rmSync(dir, { recursive: true, force: true });
  say('backup: the copy sealed and sent as a stream, the drill from disk at any size, every failure told'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
