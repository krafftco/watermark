// The visit log by month (#119, 20 Nov 2026). `hits` is the house's largest table: every page and API request (people,
// bots, the kids' corner), kept HITS_KEEP_DAYS (30) and pruned by the worker. Pictures and static files are counted in
// memory only and never written (analytics.js). This file keeps the raw log; analytics.js writes it and numbers.js rolls
// it up by day.
//
// On Postgres the log is partitioned by month on `at` (declarative, RANGE, a partition `hits_pYYYYMM` per UTC month and
// `hits_pdefault` for anything outside them, so a write never fails for want of a month). The prune drops the months
// wholly older than the cut and deletes, in batches, what is older than the cut inside the oldest month that remains,
// so the log holds exactly the keep-days, as before. The months ahead are made a round early.
//
// The move from the one table to the months (`step`, the worker's, a round at a time; nothing on the website):
//   1. `hits_new`: the same columns (LIKE hits), PRIMARY KEY (id, at), partitioned; its months from the cut to two ahead.
//   2. Copy by id, 20,000 ids a statement, only rows inside the keep-days (`at >= cut`): what is older the prune deletes
//      anyway. Each statement is one INSERT … SELECT on the server: no row passes through the process. Resumable: the
//      next id is MAX(id) of hits_new, so a restart carries on where the last statement ended.
//   3. When fewer than 20,000 ids are left, the switch, in one transaction holding the old table for a moment (a lock
//      waited for 2 s at most, else tried next round): the tail copied, `hits` renamed `hits_old` and `hits_new` renamed
//      `hits` (indexes too), the new id sequence set a clear gap past the old one, the old table's last id kept in
//      settings (`hits_switch`). The website's writes wait for that moment (well under its 4 s) and then land in the new
//      table: Postgres looks a name up again after a lock it waited for.
//   4. A round later: any row the old table still took after the switch is copied over, the rows inside the keep-days
//      are counted on both sides, and only if they agree is `hits_old` dropped. Otherwise it is kept and said.
// Every step logs a `[hits]` line with its counts. Finished: `[hits] months: done` and `hits_switch` reads `done` in
// settings; `SELECT relkind FROM pg_class WHERE relname='hits'` answers 'p'.
// SQLite keeps the one table and the batched delete.
'use strict';

const DAY = 86400;
const BATCH = 20000;
const COLS = ['id', 'at', 'path', 'kind', 'status', 'ms', 'visitor', 'ref', 'device', 'browser', 'bot', 'country', 'bytes'];

// The first second of the UTC month that holds `sec`, and of the month `k` after it.
const monthOf = (sec, k = 0) => { const d = new Date(sec * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1) / 1000; };
const nameOf = sec => { const d = new Date(sec * 1000); return `hits_p${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

function mountHitsLog(db, { keepDays = +(process.env.HITS_KEEP_DAYS || 30), log = (...a) => console.log(...a), now = () => Math.floor(Date.now() / 1000) } = {}) {
  const pg = db.kind === 'postgres';
  const cutOf = () => now() - keepDays * DAY;
  const pruneQ = db.prepare('DELETE FROM hits WHERE id IN (SELECT id FROM hits WHERE at < ? ORDER BY id LIMIT 20000)');
  db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)');
  const getS = db.prepare('SELECT v FROM settings WHERE k=?');
  const setS = db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v');
  const kindOf = t => (pg ? (db.prepare("SELECT c.relkind AS k FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=?").get(t) || {}).k || null : null);
  const exists = t => !!kindOf(t);
  const partitioned = () => kindOf('hits') === 'p';

  // The months of a partitioned table, with their bounds (a default partition has none).
  function months(table = 'hits') {
    return db.prepare("SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS b FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid WHERE i.inhparent=(SELECT oid FROM pg_class WHERE relname=? AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=current_schema()))").all(table)
      .map(r => { const m = /FROM \('?(-?\d+)'?\) TO \('?(-?\d+)'?\)/.exec(r.b || ''); return { name: r.name, from: m ? +m[1] : null, to: m ? +m[2] : null }; });
  }
  // Every month from `from` to two ahead of now, made if missing. A month whose rows already sit in the default partition
  // cannot be made beside them: said, and those rows stay where they are (kept, read and pruned all the same).
  function ensureMonths(table, from) {
    const have = new Set(months(table).map(m => m.name)); const made = [];
    for (let a = monthOf(from); a <= monthOf(now(), 2); a = monthOf(a, 1)) {
      const name = nameOf(a); if (have.has(name)) continue;
      try { db.exec(`CREATE TABLE IF NOT EXISTS ${name} PARTITION OF ${table} FOR VALUES FROM (${a}) TO (${monthOf(a, 1)})`); made.push(name); }
      catch (e) { log(`[hits] the month ${name} could not be made (${String(e.message).split('\n')[0].slice(0, 160)}); its rows stay in the default partition`); }
    }
    return made;
  }

  // The prune. SQLite, or Postgres before the move: the batched delete, at most 100 batches (2,000,000 rows) a run.
  // Postgres after it: whole months dropped, then the batched delete inside what is left.
  function prune() {
    const cut = cutOf(); const t0 = Date.now(); let dropped = [], deleted = 0;
    if (pg && partitioned()) {
      ensureMonths('hits', cut);
      for (const m of months('hits')) {
        if (m.to == null || m.to > cut) continue;
        // DROP takes the parent's lock for a moment (a write waits for it); 2 s at most, else the next run.
        try { db.transaction(() => { db.exec("SET LOCAL lock_timeout = '2s'"); db.exec(`DROP TABLE ${m.name}`); })(); dropped.push(m.name); }
        catch (e) { log(`[hits] could not drop ${m.name} now (${String(e.message).split('\n')[0].slice(0, 120)}); next run`); }
      }
    }
    for (let i = 0; i < 100; i++) { const n = pruneQ.run(cut).changes; deleted += n; if (!n) break; }
    log(`[hits] pruned before ${new Date(cut * 1000).toISOString().slice(0, 16)}: ${dropped.length ? `months dropped ${dropped.join(', ')}; ` : ''}${deleted.toLocaleString('en-US')} rows deleted in ${Date.now() - t0} ms`);
    return { dropped, deleted, ms: Date.now() - t0 };
  }

  // ---- the move into months (Postgres only)
  const state = () => { const r = getS.get('hits_switch'); return r ? r.v : null; };
  const cols = COLS.join(', ');
  const maxId = t => Number((db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${t}`).get() || {}).m) || 0;

  function makeNew(cut) {
    // The same columns as the live table, read from it (the dialect would turn the word LIKE into ILIKE, so not LIKE hits).
    const defs = db.prepare("SELECT column_name AS c, data_type AS t, is_nullable AS nl, column_default AS d, is_identity AS idn FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='hits' ORDER BY ordinal_position").all()
      .map(r => r.c === 'id' ? 'id BIGINT GENERATED BY DEFAULT AS IDENTITY' : `${r.c} ${String(r.t).toUpperCase()}${r.nl === 'NO' ? ' NOT NULL' : ''}${r.d != null && !/nextval/.test(r.d) ? ' DEFAULT ' + r.d : ''}`);
    db.exec(`CREATE TABLE IF NOT EXISTS hits_new (${defs.join(', ')}, PRIMARY KEY (id, at)) PARTITION BY RANGE (at)`);
    db.exec('CREATE TABLE IF NOT EXISTS hits_new_pdefault PARTITION OF hits_new DEFAULT');
    db.exec('CREATE INDEX IF NOT EXISTS hits_new_at ON hits_new (at)');
    db.exec('CREATE INDEX IF NOT EXISTS hits_new_path ON hits_new (path, at)');
    // The months are named for the log they will be; made on hits_new, they stay its months after the rename.
    for (let a = monthOf(cut); a <= monthOf(now(), 2); a = monthOf(a, 1)) {
      const name = nameOf(a);
      if (!exists(name)) db.exec(`CREATE TABLE ${name} PARTITION OF hits_new FOR VALUES FROM (${a}) TO (${monthOf(a, 1)})`);
    }
  }

  // One round of the move: up to `batches` statements of copying, then the switch or the finish when they are due.
  // Returns what it did; `yieldFn` (async) lets the worker's other timers run between statements.
  async function step({ batches = 200, yieldFn = () => new Promise(r => setImmediate(r)) } = {}) {
    if (!pg) return { done: true, why: 'sqlite' };
    const st = state();
    if (st === 'done' && partitioned() && !exists('hits_old')) return { done: true };
    const cut = cutOf(); const t0 = Date.now();
    // 4. After the switch: strays, the count on both sides, then hits_old dropped.
    if (partitioned() && exists('hits_old')) return finish(cut);
    if (partitioned()) { setS.run('hits_switch', 'done'); log('[hits] months: done (the log was already by month)'); return { done: true }; }
    // 1–3. Before the switch.
    if (!exists('hits_new')) { makeNew(cut); log(`[hits] months: begun; hits_new made with ${months('hits_new').length} partitions`); }
    else ensureMonths('hits_new', cut);
    const top = maxId('hits');
    let from = maxId('hits_new');
    if (!from) { const r = db.prepare('SELECT MIN(id) AS m FROM hits WHERE at >= ?').get(cut); from = r && r.m != null ? Number(r.m) - 1 : top; }
    let copied = 0, n = 0;
    const copyQ = db.prepare(`INSERT INTO hits_new (${cols}) SELECT ${cols} FROM hits WHERE id > ? AND id <= ? AND at >= ?`);
    while (top - from > BATCH && n < batches) {
      copied += copyQ.run(from, from + BATCH, cut).changes; from += BATCH; n++;
      if (n % 25 === 0) log(`[hits] months: copied to id ${from.toLocaleString('en-US')} of ${top.toLocaleString('en-US')} (${copied.toLocaleString('en-US')} rows this round, ${Date.now() - t0} ms)`);
      await yieldFn();
    }
    if (top - from > BATCH) { log(`[hits] months: copying, at id ${from.toLocaleString('en-US')} of ${top.toLocaleString('en-US')}; ${copied.toLocaleString('en-US')} rows this round in ${Date.now() - t0} ms`); return { done: false, copied, at: from, top }; }
    return { done: false, copied: copied + switchOver(from, cut), switched: true };
  }

  // 3. The switch, in one transaction. The old table's lock is waited for 2 s at most; a write that waits behind it then
  // goes to the new table by name.
  function switchOver(from, cut) {
    const t0 = Date.now(); let tail = 0, last = 0;
    try {
      db.transaction(() => {
        db.exec("SET LOCAL lock_timeout = '2s'");
        db.exec('LOCK TABLE hits IN EXCLUSIVE MODE');
        last = maxId('hits');
        tail = db.prepare(`INSERT INTO hits_new (${cols}) SELECT ${cols} FROM hits WHERE id > ? AND at >= ?`).run(from, cut).changes;
        db.exec('ALTER TABLE hits RENAME TO hits_old');
        for (const [a, b] of [['hits_at', 'hits_old_at'], ['hits_path', 'hits_old_path'], ['hits_pkey', 'hits_old_pkey']]) db.exec(`ALTER INDEX IF EXISTS ${a} RENAME TO ${b}`);
        db.exec('ALTER TABLE hits_new RENAME TO hits');
        for (const [a, b] of [['hits_new_at', 'hits_at'], ['hits_new_path', 'hits_path'], ['hits_new_pkey', 'hits_pkey'], ['hits_new_pdefault', 'hits_pdefault']]) db.exec(`ALTER ${a === 'hits_new_pdefault' ? 'TABLE' : 'INDEX'} IF EXISTS ${a} RENAME TO ${b}`);
        // The new ids start a clear gap past every id the old table could still hand out to a write already under way.
        db.prepare("SELECT setval(pg_get_serial_sequence('hits', 'id'), ?)").get(last + 1000000);
        setS.run('hits_switch', String(last));
      })();
    } catch (e) { log(`[hits] months: the switch waits (${String(e.message).split('\n')[0].slice(0, 160)}); next round`); return 0; }
    log(`[hits] months: switched in ${Date.now() - t0} ms; the last ${tail} rows copied in the switch; old ids end at ${last.toLocaleString('en-US')}`);
    return tail;
  }

  // 4. The finish: strays copied, both sides counted inside the keep-days, the old table dropped only if they agree.
  function finish(cut) {
    const t0 = Date.now(); const last = Number(state()) || maxId('hits_old');
    const strays = db.prepare(`INSERT INTO hits (${cols}) SELECT ${COLS.map(c => 'o.' + c).join(', ')} FROM hits_old o WHERE o.id > ? AND o.at >= ? AND NOT EXISTS (SELECT 1 FROM hits h WHERE h.id = o.id AND h.at = o.at)`).run(last, cut).changes;
    const a = Number(db.prepare('SELECT COUNT(*) AS n FROM hits_old WHERE at >= ?').get(cut).n);
    const b = Number(db.prepare('SELECT COUNT(*) AS n FROM hits WHERE at >= ? AND (id <= ? OR id IN (SELECT id FROM hits_old WHERE id > ?))').get(cut, last, last).n);
    if (a !== b) { log(`[hits] months: NOT finished: inside the keep-days the old table holds ${a.toLocaleString('en-US')} rows and the new ${b.toLocaleString('en-US')} of them; hits_old is kept`); return { done: false, mismatch: { old: a, new: b } }; }
    db.exec('DROP TABLE hits_old');
    setS.run('hits_switch', 'done');
    log(`[hits] months: done; ${a.toLocaleString('en-US')} rows inside the keep-days on both sides${strays ? `, ${strays} written to the old table after the switch copied over` : ''}; the old table dropped (${Date.now() - t0} ms)`);
    return { done: true, rows: a, strays };
  }

  // What /healthz and the [hits] lines say: the shape, the months, the planner's row estimate (no count of the table).
  function shape() {
    if (!pg) return { kind: 'table' };
    const est = Number((db.prepare("SELECT COALESCE(SUM(c.reltuples), 0) AS n FROM pg_class c WHERE c.relname = 'hits' OR c.oid IN (SELECT inhrelid FROM pg_inherits WHERE inhparent = (SELECT oid FROM pg_class WHERE relname = 'hits' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())))").get() || {}).n) || 0;
    return { kind: partitioned() ? 'months' : 'table', months: partitioned() ? months('hits').map(m => m.name).sort() : [], rows: Math.max(0, Math.round(est)), move: state() };
  }

  return { prune, step, shape, partitioned, months, ensureMonths, monthOf, nameOf };
}

module.exports = { mountHitsLog, monthOf, nameOf };
