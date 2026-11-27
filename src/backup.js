const ROLE = require('./role');
// Backups and the restore drill (Will, 19 Oct: security 2/6). The database is the house's memory: every maker,
// license, number, acceptance and register entry. Each night a consistent copy is taken (SQLite's online backup),
// gzipped, and put in the vault, where VAULT_KEY seals it with AES-256-GCM before it leaves the server; copies
// older than KEEP days are pruned. Portraits (the one thing on the disk that is not in the database or the
// vault) go with it. Once a week (and the night after a drill that failed) the latest copy is fetched back, opened
// read-only, integrity-checked, and its register compared with the live one: a backup that has never been restored is a hope, not a backup. The
// outcome is kept (`backup_runs`), shown on /healthz and Studio → Backups, and a failure is mailed to the house
// and told on the register (`backup.failed`, hidden). `scripts/restore.js` puts a copy back by hand.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { execFile } = require('child_process');
// Off the event loop (28 Oct, the morning of the move: a synchronous pg_dump of the live house froze it for half a
// minute and the edge showed the cold page): every pg tool runs as a child the house waits on, never blocks on.
const run = (cmd, args, { timeout = 600e3, encoding } = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { encoding: encoding || 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) { err.message = err.killed ? `${path.basename(cmd)} was stopped after ${Math.round(timeout / 60e3)} min, the time it is allowed` : (stderr && String(stderr).trim()) || err.message; return reject(err); }
    resolve(stdout);
  });
});
const { pipeline } = require('stream/promises');
const hashFile = file => new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex'))); });
// What a person may read of a failure (health, the Studio, the letter): its first lines, short, and never an address
// that carries a password.
const plain = m => String(m == null ? '' : m).replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]*@[^\s'"]*/gi, '(an address)').replace(/\s+/g, ' ').trim().slice(0, 300);

// Postgres (27 Oct): the copy is pg_dump's archive (custom format, gzipped, sealed by the vault as before), and the
// drill restores it into a scratch database on the same server (wm_drill_<n>), checks it, and drops it; where the
// server refuses CREATE DATABASE the drill lists the archive and says a full restore needs that right.
const PGBIN = process.env.PG_BIN || ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/bin'].find(d => fs.existsSync(path.join(d, 'pg_dump'))) || '';
const pgTool = t => (PGBIN ? path.join(PGBIN, t) : t);
const dbUrlFor = (url, name) => { const u = new URL(url); u.pathname = '/' + name; return u.toString(); };

const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);
const HOUR = Number(process.env.BACKUP_HOUR || 7); // UTC; 3 am New York in winter
// (27 Nov, #162) A drill that has not passed in DRILL_STALE_DAYS is the house's business as much as a missing copy.
// pg_restore into the scratch database is given DRILL_RESTORE_MIN (it was ten minutes, set when the copy was 30 MB).
const DRILL_STALE_DAYS = Number(process.env.DRILL_STALE_DAYS || 8);
const RESTORE_MS = Number(process.env.DRILL_RESTORE_MIN || 45) * 60e3;
// (27 Nov) The drill's hours: it begins by the clock only after a copy made in the NIGHT_HOURS from BACKUP_HOUR (2 to 6 am
// New York in winter), never in the day. The Studio's own press runs at once.
const NIGHT_HOURS = Number(process.env.DRILL_NIGHT_HOURS || 4);
const night = now => ((now.getUTCHours() - HOUR + 24) % 24) < NIGHT_HOURS;
// The room a scratch restore is taken to need on the database server: the live database's size, and half again for
// what the server writes while it restores.
const ROOM_FACTOR = Number(process.env.DRILL_ROOM_FACTOR || 1.5);
const RUNNING_MS = RESTORE_MS + 45 * 60e3; // a drill begun and not ended within this was ended with its process
const PREFIX = 'backups/db/';

function mountBackup(app, { db, C, store, ledger, mail, isStudio, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS backup_runs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, key TEXT, bytes INTEGER, sha256 TEXT, ok INTEGER NOT NULL DEFAULT 1,
    detail TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  // (27 Nov) Where a run stopped and how long it took, beside what it said.
  for (const [c, t] of [['step', 'TEXT'], ['ms', 'INTEGER']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('backup_runs') WHERE name=?").get(c)) db.exec(`ALTER TABLE backup_runs ADD COLUMN ${c} ${t}`);
  db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)'); // the room guard keeps one line here
  const HOUSE = require('./address').email();
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const record = (kind, r) => db.prepare('INSERT INTO backup_runs (kind, key, bytes, sha256, ok, detail, step, ms) VALUES (?,?,?,?,?,?,?,?)').run(kind, r.key || null, r.bytes || null, r.sha256 || null, r.ok ? 1 : 0, r.detail || null, r.step || null, r.ms == null ? null : r.ms);
  // A failure is kept (with its step and its time), told on the register and mailed to the house.
  function failed(kind, e, x = {}) {
    const msg = plain(e.message), where = x.step ? ` at "${x.step}"${x.ms != null ? ` after ${Math.round(x.ms / 1000)} s` : ''}` : '', notRun = !!e.notRun;
    if (x.id) db.prepare('UPDATE backup_runs SET key=?, ok=0, detail=?, step=?, ms=? WHERE id=?').run(x.key || null, msg, x.step || null, x.ms == null ? null : x.ms, x.id);
    else record(kind, { key: x.key, ok: false, detail: msg, step: x.step, ms: x.ms });
    try { ledger.append(db, 'backup.failed', kind, { error: msg.slice(0, 200), ...(x.step ? { step: x.step } : {}) }); } catch (z) { /* */ }
    try { Promise.resolve(mail.send({ to: HOUSE, subject: notRun ? `Backup ${kind} not run` : `Backup ${kind} failed`, text: `${notRun ? `The ${kind} was not run${x.key ? ` on ${x.key}` : ''}: nothing was fetched and nothing restored` : `The ${kind} failed${where}${x.key ? `, on ${x.key}` : ''}`}:\n\n${msg}\n\n${notRun && /DRILL_MIN_FREE_MB is not set/.test(msg) ? 'To let it run: read the free room on the database server\'s own page, and set DRILL_MIN_FREE_MB (in MB) on the service that runs the chores.\n\n' : ''}${kind === 'drill' ? 'It is tried again after the next nightly copy.\n\n' : ''}${C.base}/studio/backups\n\nWatermark` })).catch(() => {}); } catch (z) { /* */ }
  }

  // A consistent copy of the database, gzipped, into the vault; portraits beside it; old copies pruned.
  async function backup() {
    const pg = db.kind === 'postgres';
    const tmp = path.join(C.dataDir, `backup-${process.pid}.tmp.${pg ? 'pgdump' : 'db'}`);
    const gzTmp = tmp + '.gz', t0 = Date.now();
    try {
      if (pg) await run(pgTool('pg_dump'), ['--format=custom', '--no-owner', '--no-acl', '-f', tmp, db.url]);
      else await db.backup(tmp);
      // (20 Nov) The copy is never held whole in memory before it is sealed. It was: the dump read whole (about 500 MB on
      // live), gzipped whole, hashed, then sealed (a third copy), on a worker with 2 GB. From about 18 Nov the worker
      // was ended for memory at this line, 6 min 40 s after every start, and no backup was made (docs/STABILITY.md).
      // Now the dump is hashed and gzipped from disk to disk.
      // (pg_dump's archive is already compressed inside, so level 1 here: the .gz is kept so old and new copies open alike.)
      const rawBytes = fs.statSync(tmp).size, sha256 = await hashFile(tmp);
      await pipeline(fs.createReadStream(tmp), zlib.createGzip({ level: pg ? 1 : 6 }), fs.createWriteStream(gzTmp)); fs.unlinkSync(tmp);
      const raw = { length: rawBytes }, gz = { length: fs.statSync(gzTmp).size };
      const key = `${PREFIX}watermark-${stamp()}.${pg ? 'pgdump' : 'db'}.gz`;
      console.log(`[backup] ${Math.round(rawBytes / 1048576)} MB copied, ${Math.round(gz.length / 1048576)} MB to seal`);
      // (27 Nov, #162) Sealed and sent as a stream, in parts: the finished file is no longer read whole to be sealed
      // (it was held twice over, about 1.3 GB for the copy of 27 Nov).
      await store.putFile(key, gzTmp, 'application/gzip'); fs.unlinkSync(gzTmp);
      const head = db.prepare('SELECT hash, seq FROM ledger ORDER BY seq DESC LIMIT 1').get() || {};
      await store.put('backups/latest.json', Buffer.from(JSON.stringify({ key, at: new Date().toISOString(), bytes: gz.length, raw: raw.length, sha256, ledger: head, encrypted: !!store.encrypted })), 'application/json');
      const pd = path.join(C.dataDir, 'portraits');
      if (fs.existsSync(pd)) { for (const f of fs.readdirSync(pd)) { const fp = path.join(pd, f); if (fs.statSync(fp).isFile()) await store.put(`backups/portraits/${f}`, fs.readFileSync(fp), 'application/octet-stream'); } }
      const pruned = await prune();
      record('backup', { key, bytes: gz.length, sha256, ok: true, detail: `${raw.length} bytes raw; register at ${head.seq || 0}; pruned ${pruned}`, step: 'done', ms: Date.now() - t0 });
      return { key, bytes: gz.length, sha256 };
    } catch (e) { for (const f of [tmp, gzTmp]) { try { fs.unlinkSync(f); } catch (x) { /* */ } } failed('backup', e, { ms: Date.now() - t0 }); throw e; }
  }
  async function prune() {
    const keys = (await store.list(PREFIX)).filter(k => /watermark-\d{4}-\d{2}-\d{2}T/.test(k)).sort();
    const cut = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
    let n = 0; const keep = keys.slice(-3); // never below three, whatever their age
    for (const k of keys) { const d = (k.match(/watermark-(\d{4}-\d{2}-\d{2})T/) || [])[1]; if (d && d < cut && !keep.includes(k) && store.del) { await store.del(k); n++; } }
    return n;
  }
  // The drill: fetch the latest copy back, open it, check it, compare its register with the live one.
  // (27 Nov, #162) From 20 Nov a copy over 200 MB was not drilled at all (DRILL_MAX_MB: the drill held the copy three
  // times over), and said so only in a line of the Runs table; health showed `ok: false` and no reason, and the next
  // try was a week away. Now the copy comes back as a stream: fetched, unsealed, unzipped and fingerprinted on its way
  // to the disk, whatever its size, then restored and checked as before. Each drill is a line from its first moment
  // (a drill ended with its process leaves "begun, not finished", not silence), and keeps the step it reached, how
  // long it took and what it said.
  const STEPS = { find: 'finding the copy', room: 'judging the room', fetch: 'fetching the copy from the vault', unseal: 'opening the seal', unzip: 'unzipping', disk: 'writing the copy to the disk', fingerprint: 'checking the fingerprint', list: 'reading the archive', create: 'making the scratch database', restore: 'restoring into the scratch database', open: 'opening the restored copy', register: 'comparing the registers', chain: 'verifying the register', count: 'counting', done: 'done', begun: 'begun, not finished' };
  // The room (27 Nov; the rule: a drill never puts the live database at risk). A Postgres drill restores a second copy
  // of the database onto the live server; a disk filled there stops the house. So before anything is fetched the drill
  // judges the room, and where it might not fit, or the room cannot be known, it does not begin: the line says "not
  // run", at the step "room", with the numbers. The room is known in two ways and the smaller is believed:
  //   measured: the server keeps its files on this machine's disk (a house on one box, a laptop, a test);
  //   vouched:  DRILL_MIN_FREE_MB, the room a person read on the server's own page and set. The house keeps the
  //             database's size as it first saw that number, and takes off what the database has grown since.
  // The copy unzipped must also fit on this process's own disk.
  const MBs = n => Math.round(n / 1048576);
  const serverFree = () => { try {
    const u = new URL(db.url), h = u.searchParams.get('host') || u.hostname;
    if (!(h === '' || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.startsWith('/'))) return null;
    const d = db.prepare("SELECT current_setting('data_directory') AS d").get().d; if (!d || !fs.existsSync(d)) return null;
    const f = fs.statfsSync(d); return f.bavail * f.bsize;
  } catch (e) { return null; } };
  async function room(key, L, pg) {
    const set = process.env.DRILL_MIN_FREE_MB ? Number(process.env.DRILL_MIN_FREE_MB) * 1048576 : null;
    let raw = L && L.key === key && L.raw ? L.raw : null; if (raw == null) { try { raw = (await store.size(key)) || 0; } catch (e) { raw = 0; } }
    let disk = null; try { const f = fs.statfsSync(C.dataDir); disk = f.bavail * f.bsize; } catch (e) { /* not known */ }
    const here = pg ? disk : [disk, set].filter(x => x != null && !isNaN(x)).sort((a, b) => a - b)[0];
    if (here != null && here < raw * 1.1) return `the copy unzipped needs about ${MBs(raw * 1.1)} MB on this disk and ${MBs(here)} MB is free${!pg && set != null && here === set ? ' (DRILL_MIN_FREE_MB)' : ''}`;
    if (!pg) return null;
    // A drill ended with its process leaves its scratch database on the server, taking room for nothing: one that no
    // one is connected to is dropped before the room is judged (a drill under way elsewhere holds a connection).
    try { for (const r of db.prepare("SELECT d.datname AS name FROM pg_database d WHERE d.datname LIKE 'wm_drill_%' AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)").all()) { if (!/^wm_drill_\d+_\d+$/.test(r.name)) continue; try { db.exec(`DROP DATABASE "${r.name}"`); console.log('[drill] dropped a scratch database left behind:', r.name); } catch (e) { console.error('[drill] could not drop', r.name, plain(e.message)); } } } catch (e) { /* judged as it is */ }
    let size; try { size = Number(db.prepare('SELECT pg_database_size(current_database()) AS n').get().n); } catch (e) { size = NaN; }
    if (!(size >= 0)) return 'the database server would not say how large the database is, so the room a scratch restore needs is not known';
    const need = size * ROOM_FACTOR, measured = serverFree(); let vouched = null;
    if (set != null && !isNaN(set)) {
      const k = 'drill_room', mark = `${process.env.DRILL_MIN_FREE_MB}:`; let then = size;
      try { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); if (r && String(r.v).startsWith(mark)) then = Number(String(r.v).slice(mark.length)) || size; else db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, mark + size); } catch (e) { /* judged without the growth */ }
      vouched = set - Math.max(0, size - then);
    }
    const free = [measured, vouched].filter(x => x != null).sort((a, b) => a - b)[0];
    const needs = `a scratch restore needs about ${MBs(need)} MB on the database server (the database is ${MBs(size)} MB)`;
    if (free == null) return `the room free on the database server is not known (DRILL_MIN_FREE_MB is not set); ${needs}`;
    if (free < need) return `${needs} and ${MBs(free)} MB is free there${measured != null && free === measured ? ' (measured)' : ` (DRILL_MIN_FREE_MB ${process.env.DRILL_MIN_FREE_MB}${vouched < set ? `, less the ${MBs(set - vouched)} MB the database has grown since that was set` : ''})`}`;
    return null;
  }
  let drilling = null;
  function drill(key) {
    if (drilling) return Promise.reject(new Error('a drill is under way; this one was not begun'));
    drilling = drill1(key).finally(() => { drilling = null; }); return drilling;
  }
  async function drill1(key) {
    const t0 = Date.now(), S = { step: 'find' }; let tmp = null, b = null, scratch = null;
    const id = db.prepare('INSERT INTO backup_runs (kind, key, ok, detail, step) VALUES (?,?,0,?,?)').run('drill', key || null, 'begun, not finished: if this line stays, the process ended before the drill did', 'begun').lastInsertRowid;
    try {
      let L = null; try { const j = await store.get('backups/latest.json'); L = j ? JSON.parse(j.toString()) : null; } catch (e) { if (!key) throw e; }
      if (!key) { if (!L) throw new Error('no backup yet'); key = L.key; }
      const pg = /\.pgdump\.gz$/.test(key);
      S.step = 'room';
      { const why = await room(key, L, pg); if (why) { const e = new Error(`not run: ${why}`); e.notRun = true; throw e; } }
      S.step = 'fetch';
      const src = await store.readStream(key); if (!src) throw new Error(`backup ${key} not found`);
      tmp = path.join(C.dataDir, `drill-${process.pid}.tmp.${pg ? 'pgdump' : 'db'}`);
      // One pass, nothing held whole: the vault's stream, unsealed (the seal's tag is proven at the end), unzipped,
      // fingerprinted, written. Whichever part fails names the step.
      const gun = zlib.createGunzip(), sha = crypto.createHash('sha256'), out = fs.createWriteStream(tmp); let bytes = 0;
      gun.on('data', d => { sha.update(d); bytes += d.length; });
      try { await pipeline(src, gun, out); }
      catch (e) { S.step = /the seal|sealed copy/.test(e.message) ? 'unseal' : /^Z_/.test(e.code || '') || /unexpected end of file|incorrect header check/.test(e.message) ? 'unzip' : /^(ENOSPC|EDQUOT|EIO|EROFS|EACCES|EMFILE)$/.test(e.code || '') ? 'disk' : 'fetch'; throw e; }
      S.step = 'fingerprint';
      const sha256 = sha.digest('hex');
      if (L && L.key === key && L.sha256 && L.sha256 !== sha256) throw new Error(`the copy that came back is not the copy that was made (${bytes} bytes, fingerprint ${sha256.slice(0, 12)}…; made ${L.raw} bytes, ${String(L.sha256).slice(0, 12)}…)`);
      let tables, how;
      if (pg) {
        S.step = 'list';
        const listing = await run(pgTool('pg_restore'), ['--list', tmp], { timeout: 120e3 });
        tables = (listing.match(/ TABLE /g) || []).length;
        if (!tables) throw new Error('the archive lists no tables');
        S.step = 'create';
        const name = `wm_drill_${process.pid}_${Date.now() % 100000}`;
        try { db.exec(`CREATE DATABASE "${name}"`); scratch = name; }
        catch (e) {
          const detail = `${key}: archive lists ${tables} tables; a full restore needs CREATE DATABASE on the server (${plain(e.message.split('\n')[0])})`;
          db.prepare('UPDATE backup_runs SET key=?, bytes=?, ok=1, detail=?, step=?, ms=? WHERE id=?').run(key, bytes, detail, 'done', Date.now() - t0, id); return { ok: true, key, detail };
        }
        S.step = 'restore';
        const url = dbUrlFor(db.url, name);
        await run(pgTool('pg_restore'), ['--no-owner', '--no-acl', '-d', url, tmp], { timeout: RESTORE_MS });
        S.step = 'open';
        b = require('./pgsync').open(url); how = 'restored into a scratch database, ';
      } else {
        S.step = 'open';
        b = new Database(tmp, { readonly: true }); how = '';
        const integ = b.pragma('integrity_check', { simple: true });
        if (integ !== 'ok') throw new Error(`integrity_check: ${integ}`);
        tables = b.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n;
      }
      S.step = 'register';
      const bh = b.prepare('SELECT hash, seq FROM ledger ORDER BY seq DESC LIMIT 1').get() || {};
      const lh = bh.seq ? db.prepare('SELECT hash FROM ledger WHERE seq=?').get(bh.seq) : null;
      if (bh.seq && (!lh || lh.hash !== bh.hash)) throw new Error(`register differs at ${bh.seq}`);
      S.step = 'chain';
      const chain = ledger.verifyAll ? ledger.verifyAll(b) : { ok: true };
      if (!chain.ok) throw new Error(`register chain broken at ${chain.broken_at}`);
      S.step = 'count';
      const counts = ['makers', 'works', 'licenses', 'buyers', 'ledger'].map(t => `${t} ${b.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n}`).join(', ');
      const ms = Date.now() - t0;
      const detail = `${key}: ${how}${tables} tables; ${counts}; register at ${bh.seq || 0} matches the live one and verifies${L && L.key === key && L.sha256 ? '; fingerprint as made' : ''}; ${Math.round(bytes / 1048576)} MB in ${Math.round(ms / 1000)} s`;
      db.prepare('UPDATE backup_runs SET key=?, bytes=?, sha256=?, ok=1, detail=?, step=?, ms=? WHERE id=?').run(key, bytes, sha256, detail, 'done', ms, id);
      return { ok: true, key, detail };
    } catch (e) { failed('drill', e, { id, key, step: S.step, ms: Date.now() - t0 }); e.step = S.step; throw e; }
    finally {
      try { if (b) b.close(); } catch (x) { /* */ }
      if (scratch) { try { db.exec(`DROP DATABASE "${scratch}" WITH (FORCE)`); } catch (x) { console.error('[drill] could not drop', scratch, plain(x.message)); } }
      if (tmp) for (const f of [tmp, tmp + '-wal', tmp + '-shm']) { try { fs.unlinkSync(f); } catch (x) { /* */ } }
    }
  }
  const last = kind => db.prepare('SELECT * FROM backup_runs WHERE kind=? ORDER BY id DESC LIMIT 1').get(kind);
  const lastGood = kind => db.prepare('SELECT * FROM backup_runs WHERE kind=? AND ok=1 ORDER BY id DESC LIMIT 1').get(kind);
  const age = x => (x ? Date.now() - new Date(x.at + 'Z').getTime() : Infinity);
  // What health and the alarm read. The drill's line says how it ended: the step, the seconds and the words of a
  // failure (short, no addresses), and when one last passed. `stale` is either: no good copy in 26 hours, or no drill
  // passed in DRILL_STALE_DAYS (counted from the first good copy on a new house).
  const drillLine = d => { if (!d) return null; const running = !d.ok && d.step === 'begun' && age(d) < RUNNING_MS;
    return { at: d.at, ok: !!d.ok, key: d.key, ...(running ? { running: true } : {}), ...(!d.ok && d.step === 'room' ? { notRun: true } : {}), step: d.step || null, secs: d.ms == null ? null : Math.round(d.ms / 1000), ...(d.ok || running ? {} : { error: plain(d.detail).slice(0, 200) }) }; };
  const summary = () => {
    const b = last('backup'), d = last('drill'), pass = lastGood('drill'), first = pass ? null : db.prepare("SELECT at FROM backup_runs WHERE kind='backup' AND ok=1 ORDER BY id LIMIT 1").get();
    const backupStale = !b || age(b) > 26 * 3600e3, drillStale = pass ? age(pass) > DRILL_STALE_DAYS * 864e5 : !!first && age(first) > DRILL_STALE_DAYS * 864e5;
    return { vault: store.kind, encrypted: !!store.encrypted, keepDays: KEEP_DAYS, last: b ? { at: b.at, ok: !!b.ok, key: b.key, bytes: b.bytes } : null,
      drill: d ? { ...drillLine(d), passed: pass ? pass.at : null } : null, stale: backupStale || drillStale, backupStale, drillStale, drillDays: DRILL_STALE_DAYS };
  };
  // For the alarm: a drill that failed, said once while it is news (within the hour after it ended, or after the time
  // a drill is allowed when it never ended).
  const drillFailedLately = () => { const d = last('drill'); if (!d || d.ok) return null; const ended = new Date(d.at + 'Z').getTime() + (d.step === 'begun' ? RUNNING_MS : d.ms || 0); return Date.now() >= ended && Date.now() - ended < 65 * 60e3 ? drillLine(d) : null; };

  // Studio → Backups: what is in the vault, the last drill, and the two buttons.
  app.get('/studio/backups', async (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const runs = db.prepare('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 60').all();
    let keys = []; try { keys = (await store.list(PREFIX)).sort().reverse().slice(0, 40); } catch (e) { /* */ }
    const esc = V.esc, s = summary(), D = s.drill;
    res.send(V.layout({ title: 'Backups · Studio · Watermark', studio: true, path: '/studio/backups', body: `<section class="studio-wrap"><p class="k">Conservation</p><h1>Backups.</h1>
<p class="lede">The database is copied to the vault ${store.kind === 's3' ? 'nightly' : 'nightly (local disk here: set S3_BUCKET for the vault)'}${store.encrypted ? ', sealed with the vault key before it leaves the server' : ' <b>unsealed: set VAULT_KEY</b>'}; copies are kept ${KEEP_DAYS} days, never fewer than three. Once a week the latest copy is fetched back, restored and checked against the live register; a drill that fails is tried again after the next night's copy. A drill begins by itself only in the night; it does not begin at all where the scratch restore might not fit on the database server. ${s.backupStale ? '<b>No backup in the last day.</b>' : ''}${s.drillStale ? ` <b>No drill has passed in ${s.drillDays} days.</b>` : ''}</p>
<p>${D ? `The last drill, ${esc(V.date(D.at))}: ${D.ok ? 'passed' : D.running ? 'under way' : D.notRun ? '<b>not run</b>' : `<b>failed</b> at “${esc(STEPS[D.step] || D.step || 'a step not kept')}”`}${D.secs != null && !D.notRun ? `, after ${D.secs} s` : ''}.${D.error ? ` It said: ${esc(D.error)}` : ''}${!D.ok ? ` The last drill that passed: ${D.passed ? esc(V.date(D.passed)) : 'none on record'}.` : ''}` : 'No drill yet.'}</p>
<p><form method="post" action="/studio/backups/run" class="inline"><button class="buy-btn">Back up now</button></form> <form method="post" action="/studio/backups/drill" class="inline"><button>Restore drill now</button></form>${req.query.ok ? ` <span class="ok">${esc(req.query.ok)}</span>` : ''}</p>
<h2>In the vault</h2>${keys.length ? `<ul class="bk-keys">${keys.map(k => `<li><code>${esc(k)}</code> <form method="post" action="/studio/backups/drill" class="inline"><input type="hidden" name="key" value="${esc(k)}"><button class="bk-alt">Drill this one</button></form></li>`).join('')}</ul>` : '<p>Nothing yet.</p>'}
<h2>Runs</h2>${runs.length ? `<table class="tbl"><tr><th>When</th><th>What</th><th>Outcome</th><th>Step</th><th>Took</th><th>Detail</th></tr>${runs.map(r => `<tr class="${r.ok ? '' : 'bad'}"><td>${esc(V.date(r.at))}</td><td>${esc(r.kind)}</td><td>${r.ok ? 'ok' : r.kind === 'drill' && r.step === 'begun' && age(r) < RUNNING_MS ? 'under way' : r.kind === 'drill' && r.step === 'room' ? '<b>not run</b>' : '<b>failed</b>'}</td><td>${r.ok ? '' : esc(STEPS[r.step] || r.step || '')}</td><td>${r.ms == null ? '' : `${Math.round(r.ms / 1000)} s`}</td><td><small>${esc(plain(r.detail))}</small></td></tr>`).join('')}</table>` : '<p>None yet.</p>'}
<h2>To restore by hand</h2><p>${db.kind === 'postgres' ? 'A Postgres house: fetch the copy with <code>node scripts/restore.js &lt;key&gt;</code> (it writes the archive beside the app as <code>watermark.restored.pgdump</code>), then <code>pg_restore --clean --no-owner -d $DATABASE_URL watermark.restored.pgdump</code> with the house stopped.' : ''}On the server: <code>node scripts/restore.js &lt;key&gt;</code> with the same S3 and VAULT_KEY settings; it fetches the copy, checks it and writes <code>watermark.db</code> beside the live one as <code>watermark.restored.db</code>; stop the app, swap the files, start it. The portraits are under <code>backups/portraits/</code>.</p></section>` }));
  });
  app.post('/studio/backups/run', async (req, res) => { if (!isStudio(req)) return res.sendStatus(403); try { const r = await backup(); res.redirect(`/studio/backups?ok=${encodeURIComponent(`Backed up: ${r.key} (${r.bytes} bytes)`)}`); } catch (e) { res.redirect(`/studio/backups?ok=${encodeURIComponent('Failed: ' + plain(e.message))}`); } });
  app.post('/studio/backups/drill', async (req, res) => { if (!isStudio(req)) return res.sendStatus(403); 
    // (27 Nov) A drill of a large copy takes minutes; the press is answered within eight seconds and the drill goes on, a line under Runs.
    try { const r = await Promise.race([drill((req.body || {}).key || null), new Promise(z => setTimeout(z, +process.env.DRILL_PRESS_MS || 8000, null).unref())]); if (!r) { if (drilling) drilling.catch(() => {}); return res.redirect(`/studio/backups?ok=${encodeURIComponent('The drill is under way. It is the first line under Runs; this page shows how it ended.')}`); } res.redirect(`/studio/backups?ok=${encodeURIComponent(r.detail)}`); } catch (e) { res.redirect(`/studio/backups?ok=${encodeURIComponent(e.notRun ? `Drill ${plain(e.message)}` : `Drill failed${e.step ? ` at “${STEPS[e.step] || e.step}”` : ''}: ${plain(e.message)}`)}`); } });

  // Nightly at HOUR UTC, and a backup an hour after start if none in the last day. A drill only ever follows a copy
  // made in the night (`night`): after Sunday's, and after any night's when the last drill did not pass, was not run,
  // or none has passed in a week (27 Nov: a failed drill waited for the next Sunday). Never by the clock in the day: a
  // copy made at noon after a deploy is not followed by a drill, and a drill overdue waits for the night.
  const drillDue = (now, { copied } = {}) => {
    if (!copied || !night(now)) return false;
    const d = last('drill'), pass = lastGood('drill');
    return now.getUTCDay() === 0 || !d || !d.ok || age(pass) > 7 * 864e5;
  };
  function schedule() {
    const tick = async () => {
      // Due when there is no good copy yet, when the last try failed over an hour ago, or when the hour has come and the
      // last good copy is older than twenty hours. The first look is five minutes after start, because every deploy
      // restarts the house and an hourly tick from start seldom survived to the hour (20 Oct: no copy since the 19th).
      const now = new Date(), b = last('backup'), good = lastGood('backup');
      const due = !good || (b && !b.ok && age(b) > 3600e3) || (now.getUTCHours() >= HOUR && age(good) > 20 * 3600e3);
      let copied = false;
      if (due) { try { const r = await backup(); console.log('[backup]', r.key); copied = true; } catch (e) { console.error('[backup]', plain(e.message)); } }
      if (drillDue(now, { copied })) { try { const r = await drill(); console.log('[drill]', r.detail); } catch (e) { console.error(e.notRun ? '[drill]' : `[drill] failed at ${e.step || '?'}:`, plain(e.message)); } }
    };
    if (ROLE.chores) { setTimeout(tick, 300e3).unref(); setInterval(tick, 3600e3).unref(); }
  }
  app.locals.backup = { backup, drill, prune, summary, last, drillDue, drillFailedLately };
  return { backup, drill, prune, summary, schedule };
}
module.exports = { mountBackup };
