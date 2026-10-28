// Backups and the restore drill (Will, 19 Oct: security 2/6). The database is the house's memory: every maker,
// license, number, acceptance and register entry. Each night a consistent copy is taken (SQLite's online backup),
// gzipped, and put in the vault, where VAULT_KEY seals it with AES-256-GCM before it leaves the server; copies
// older than KEEP days are pruned. Portraits (the one thing on the disk that is not in the database or the
// vault) go with it. Once a week the latest copy is fetched back, opened read-only, integrity-checked, and its
// register compared with the live one: a backup that has never been restored is a hope, not a backup. The
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
    if (err) { err.message = (stderr && String(stderr).trim()) || err.message; return reject(err); }
    resolve(stdout);
  });
});
const gzip = (buf, opts) => new Promise((resolve, reject) => zlib.gzip(buf, opts, (e, out) => e ? reject(e) : resolve(out)));
const gunzip = buf => new Promise((resolve, reject) => zlib.gunzip(buf, (e, out) => e ? reject(e) : resolve(out)));

// Postgres (27 Oct): the copy is pg_dump's archive (custom format, gzipped, sealed by the vault as before), and the
// drill restores it into a scratch database on the same server (wm_drill_<n>), checks it, and drops it; where the
// server refuses CREATE DATABASE the drill lists the archive and says a full restore needs that right.
const PGBIN = process.env.PG_BIN || ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/bin'].find(d => fs.existsSync(path.join(d, 'pg_dump'))) || '';
const pgTool = t => (PGBIN ? path.join(PGBIN, t) : t);
const dbUrlFor = (url, name) => { const u = new URL(url); u.pathname = '/' + name; return u.toString(); };

const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);
const HOUR = Number(process.env.BACKUP_HOUR || 7); // UTC; 3 am New York in winter
const PREFIX = 'backups/db/';

function mountBackup(app, { db, C, store, ledger, mail, isStudio, V }) {
  db.exec(`CREATE TABLE IF NOT EXISTS backup_runs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, key TEXT, bytes INTEGER, sha256 TEXT, ok INTEGER NOT NULL DEFAULT 1,
    detail TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const HOUSE = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const record = (kind, r) => db.prepare('INSERT INTO backup_runs (kind, key, bytes, sha256, ok, detail) VALUES (?,?,?,?,?,?)').run(kind, r.key || null, r.bytes || null, r.sha256 || null, r.ok ? 1 : 0, r.detail || null);
  function failed(kind, e) {
    record(kind, { ok: false, detail: e.message });
    try { ledger.append(db, 'backup.failed', kind, { error: e.message.slice(0, 200) }); } catch (x) { /* */ }
    try { mail.send({ to: HOUSE, subject: `Backup ${kind} failed`, text: `${kind}: ${e.message}\n\n${C.base}/studio/backups\n\nWatermark` }); } catch (x) { /* */ }
  }

  // A consistent copy of the database, gzipped, into the vault; portraits beside it; old copies pruned.
  async function backup() {
    const pg = db.kind === 'postgres';
    const tmp = path.join(C.dataDir, `backup-${process.pid}.tmp.${pg ? 'pgdump' : 'db'}`);
    try {
      if (pg) await run(pgTool('pg_dump'), ['--format=custom', '--no-owner', '--no-acl', '-f', tmp, db.url]);
      else await db.backup(tmp);
      const raw = fs.readFileSync(tmp); fs.unlinkSync(tmp);
      const gz = await gzip(raw, { level: 6 });
      const key = `${PREFIX}watermark-${stamp()}.${pg ? 'pgdump' : 'db'}.gz`, sha256 = crypto.createHash('sha256').update(raw).digest('hex');
      await store.put(key, gz, 'application/gzip');
      const head = db.prepare('SELECT hash, seq FROM ledger ORDER BY seq DESC LIMIT 1').get() || {};
      await store.put('backups/latest.json', Buffer.from(JSON.stringify({ key, at: new Date().toISOString(), bytes: gz.length, raw: raw.length, sha256, ledger: head, encrypted: !!store.encrypted })), 'application/json');
      const pd = path.join(C.dataDir, 'portraits');
      if (fs.existsSync(pd)) { for (const f of fs.readdirSync(pd)) { const fp = path.join(pd, f); if (fs.statSync(fp).isFile()) await store.put(`backups/portraits/${f}`, fs.readFileSync(fp), 'application/octet-stream'); } }
      const pruned = await prune();
      record('backup', { key, bytes: gz.length, sha256, ok: true, detail: `${raw.length} bytes raw; register at ${head.seq || 0}; pruned ${pruned}` });
      return { key, bytes: gz.length, sha256 };
    } catch (e) { try { fs.unlinkSync(tmp); } catch (x) { /* */ } failed('backup', e); throw e; }
  }
  async function prune() {
    const keys = (await store.list(PREFIX)).filter(k => /watermark-\d{4}-\d{2}-\d{2}T/.test(k)).sort();
    const cut = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
    let n = 0; const keep = keys.slice(-3); // never below three, whatever their age
    for (const k of keys) { const d = (k.match(/watermark-(\d{4}-\d{2}-\d{2})T/) || [])[1]; if (d && d < cut && !keep.includes(k) && store.del) { await store.del(k); n++; } }
    return n;
  }
  // The drill: fetch the latest copy back, open it, check it, compare its register with the live one.
  async function drill(key) {
    let tmp = null;
    try {
      if (!key) { const j = await store.get('backups/latest.json'); if (!j) throw new Error('no backup yet'); key = JSON.parse(j.toString()).key; }
      const gz = await store.get(key); if (!gz) throw new Error(`backup ${key} not found`);
      const raw = await gunzip(gz);
      if (/\.pgdump\.gz$/.test(key)) { tmp = 'pg'; return await drillPg(key, raw); } // records its own outcome
      tmp = path.join(C.dataDir, `drill-${process.pid}.tmp.db`); fs.writeFileSync(tmp, raw);
      const b = new Database(tmp, { readonly: true });
      const integ = b.pragma('integrity_check', { simple: true });
      if (integ !== 'ok') throw new Error(`integrity_check: ${integ}`);
      const tables = b.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n;
      const bh = b.prepare('SELECT hash, seq FROM ledger ORDER BY seq DESC LIMIT 1').get() || {};
      const lh = bh.seq ? db.prepare('SELECT hash FROM ledger WHERE seq=?').get(bh.seq) : null;
      if (bh.seq && (!lh || lh.hash !== bh.hash)) throw new Error(`register differs at ${bh.seq}`);
      const chain = ledger.verifyAll ? ledger.verifyAll(b) : { ok: true };
      if (!chain.ok) throw new Error(`register chain broken at ${chain.broken_at}`);
      const counts = ['makers', 'works', 'licenses', 'buyers', 'ledger'].map(t => `${t} ${b.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n}`).join(', ');
      b.close(); fs.unlinkSync(tmp); tmp = null;
      const detail = `${key}: ${tables} tables; ${counts}; register at ${bh.seq || 0} matches the live one and verifies`;
      record('drill', { key, bytes: raw.length, ok: true, detail });
      return { ok: true, key, detail };
    } catch (e) { if (tmp === 'pg') throw e; if (tmp) { try { fs.unlinkSync(tmp); } catch (x) { /* */ } } failed('drill', e); throw e; }
  }
  async function drillPg(key, raw) {
    const tmp = path.join(C.dataDir, `drill-${process.pid}.tmp.pgdump`); fs.writeFileSync(tmp, raw);
    const name = `wm_drill_${process.pid}_${Date.now() % 100000}`; let made = false, b = null;
    try {
      const listing = await run(pgTool('pg_restore'), ['--list', tmp], { timeout: 120e3 });
      const tables = (listing.match(/ TABLE /g) || []).length;
      if (!tables) throw new Error('the archive lists no tables');
      try { db.exec(`CREATE DATABASE "${name}"`); made = true; }
      catch (e) {
        const detail = `${key}: archive lists ${tables} tables; a full restore needs CREATE DATABASE on the server (${e.message.split('\n')[0]})`;
        record('drill', { key, bytes: raw.length, ok: true, detail }); return { ok: true, key, detail };
      }
      const url = dbUrlFor(db.url, name);
      await run(pgTool('pg_restore'), ['--no-owner', '--no-acl', '-d', url, tmp]);
      b = require('./pgsync').open(url);
      const bh = b.prepare('SELECT hash, seq FROM ledger ORDER BY seq DESC LIMIT 1').get() || {};
      const lh = bh.seq ? db.prepare('SELECT hash FROM ledger WHERE seq=?').get(bh.seq) : null;
      if (bh.seq && (!lh || lh.hash !== bh.hash)) throw new Error(`register differs at ${bh.seq}`);
      const chain = ledger.verifyAll ? ledger.verifyAll(b) : { ok: true };
      if (!chain.ok) throw new Error(`register chain broken at ${chain.broken_at}`);
      const counts = ['makers', 'works', 'licenses', 'buyers', 'ledger'].map(t => `${t} ${b.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n}`).join(', ');
      const detail = `${key}: restored into a scratch database, ${tables} tables; ${counts}; register at ${bh.seq || 0} matches the live one and verifies`;
      record('drill', { key, bytes: raw.length, ok: true, detail });
      return { ok: true, key, detail };
    } catch (e) { failed('drill', e); throw e; }
    finally {
      try { if (b) b.close(); } catch (x) { /* */ }
      if (made) { try { db.exec(`DROP DATABASE "${name}" WITH (FORCE)`); } catch (x) { console.error('[drill] could not drop', name, x.message); } }
      try { fs.unlinkSync(tmp); } catch (x) { /* */ }
    }
  }
  const last = kind => db.prepare('SELECT * FROM backup_runs WHERE kind=? ORDER BY id DESC LIMIT 1').get(kind);
  const lastGood = kind => db.prepare('SELECT * FROM backup_runs WHERE kind=? AND ok=1 ORDER BY id DESC LIMIT 1').get(kind);
  const summary = () => { const b = last('backup'), d = last('drill'); return { vault: store.kind, encrypted: !!store.encrypted, keepDays: KEEP_DAYS, last: b ? { at: b.at, ok: !!b.ok, key: b.key, bytes: b.bytes } : null, drill: d ? { at: d.at, ok: !!d.ok, key: d.key } : null, stale: !b || Date.now() - new Date(b.at + 'Z').getTime() > 26 * 3600e3 }; };

  // Studio → Backups: what is in the vault, the last drill, and the two buttons.
  app.get('/studio/backups', async (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const runs = db.prepare('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 60').all();
    let keys = []; try { keys = (await store.list(PREFIX)).sort().reverse().slice(0, 40); } catch (e) { /* */ }
    const esc = V.esc, s = summary();
    res.send(V.layout({ title: 'Backups · Studio · Watermark', studio: true, path: '/studio/backups', body: `<section class="studio-wrap"><p class="k">Conservation</p><h1>Backups.</h1>
<p class="lede">The database is copied to the vault ${store.kind === 's3' ? 'nightly' : 'nightly (local disk here: set S3_BUCKET for the vault)'}${store.encrypted ? ', sealed with the vault key before it leaves the server' : ' <b>unsealed: set VAULT_KEY</b>'}; copies are kept ${KEEP_DAYS} days, never fewer than three. Once a week the latest copy is restored and checked against the live register. ${s.stale ? '<b>No backup in the last day.</b>' : ''}</p>
<p><form method="post" action="/studio/backups/run" class="inline"><button class="buy-btn">Back up now</button></form> <form method="post" action="/studio/backups/drill" class="inline"><button>Restore drill now</button></form>${req.query.ok ? ` <span class="ok">${esc(req.query.ok)}</span>` : ''}</p>
<h2>In the vault</h2>${keys.length ? `<ul class="bk-keys">${keys.map(k => `<li><code>${esc(k)}</code> <form method="post" action="/studio/backups/drill" class="inline"><input type="hidden" name="key" value="${esc(k)}"><button class="bk-alt">Drill this one</button></form></li>`).join('')}</ul>` : '<p>Nothing yet.</p>'}
<h2>Runs</h2>${runs.length ? `<table class="tbl"><tr><th>When</th><th>What</th><th>Outcome</th><th>Detail</th></tr>${runs.map(r => `<tr class="${r.ok ? '' : 'bad'}"><td>${esc(V.date(r.at))}</td><td>${esc(r.kind)}</td><td>${r.ok ? 'ok' : '<b>failed</b>'}</td><td><small>${esc(r.detail || '')}</small></td></tr>`).join('')}</table>` : '<p>None yet.</p>'}
<h2>To restore by hand</h2><p>${db.kind === 'postgres' ? 'A Postgres house: fetch the copy with <code>node scripts/restore.js &lt;key&gt;</code> (it writes the archive beside the app as <code>watermark.restored.pgdump</code>), then <code>pg_restore --clean --no-owner -d $DATABASE_URL watermark.restored.pgdump</code> with the house stopped.' : ''}On the server: <code>node scripts/restore.js &lt;key&gt;</code> with the same S3 and VAULT_KEY settings; it fetches the copy, checks it and writes <code>watermark.db</code> beside the live one as <code>watermark.restored.db</code>; stop the app, swap the files, start it. The portraits are under <code>backups/portraits/</code>.</p></section>` }));
  });
  app.post('/studio/backups/run', async (req, res) => { if (!isStudio(req)) return res.sendStatus(403); try { const r = await backup(); res.redirect(`/studio/backups?ok=${encodeURIComponent(`Backed up: ${r.key} (${r.bytes} bytes)`)}`); } catch (e) { res.redirect(`/studio/backups?ok=${encodeURIComponent('Failed: ' + e.message)}`); } });
  app.post('/studio/backups/drill', async (req, res) => { if (!isStudio(req)) return res.sendStatus(403); try { const r = await drill((req.body || {}).key || null); res.redirect(`/studio/backups?ok=${encodeURIComponent(r.detail)}`); } catch (e) { res.redirect(`/studio/backups?ok=${encodeURIComponent('Drill failed: ' + e.message)}`); } });

  // Nightly at HOUR UTC; a drill on Sundays; and a backup an hour after start if none in the last day.
  function schedule() {
    const tick = async () => {
      // Due when there is no good copy yet, when the last try failed over an hour ago, or when the hour has come and the
      // last good copy is older than twenty hours. The first look is five minutes after start, because every deploy
      // restarts the house and an hourly tick from start seldom survived to the hour (20 Oct: no copy since the 19th).
      const now = new Date(), b = last('backup'), good = lastGood('backup');
      const age = x => (x ? Date.now() - new Date(x.at + 'Z').getTime() : Infinity);
      const due = !good || (b && !b.ok && age(b) > 3600e3) || (now.getUTCHours() >= HOUR && age(good) > 20 * 3600e3);
      if (!due) return;
      try { const r = await backup(); console.log('[backup]', r.key); } catch (e) { console.error('[backup]', e.message); return; }
      const d = last('drill');
      if (now.getUTCDay() === 0 || !d || Date.now() - new Date(d.at + 'Z').getTime() > 8 * 864e5) { try { const r = await drill(); console.log('[drill]', r.detail); } catch (e) { console.error('[drill]', e.message); } }
    };
    setTimeout(tick, 300e3).unref(); setInterval(tick, 3600e3).unref();
  }
  app.locals.backup = { backup, drill, prune, summary, last };
  return { backup, drill, prune, summary, schedule };
}
module.exports = { mountBackup };
