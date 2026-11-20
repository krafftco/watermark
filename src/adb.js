// The async path (20 Nov 2026, #117, docs/SCALE.md "Stage 2: how a room is moved"). The bridge (pgsync.js) holds the
// website's one thread for every answer, so one slow statement holds every visitor. This is the other way to ask:
// `adb.get/all/run(sql, ...params)` return promises, on a pool of Postgres connections beside the bridge, so the
// thread serves others while the database answers. The SQL is the house's own: each statement passes through
// dialect.js as on the bridge, and its rows come back in the bridge's shape. On SQLite (tests, the scale gate) the
// same statement runs on the same better-sqlite3 connection and resolves, so a moved room is tested on both engines.
'use strict';
const D = require('./dialect');

const isWeb = () => process.env.ROLE === 'web';
const LIMIT_MS = () => +process.env.ADB_LIMIT_MS || (isWeb() ? 4000 : 120000);
const SLOW_MS = () => +process.env.ADB_SLOW_MS || 500;
const POOL_N = () => Math.max(1, +process.env.ADB_POOL || 4);

const slow = []; // {ms, sql, at, n}: the worst twenty, for /healthz adbSlow
function noteSlow(ms, sql, failed) {
  const key = String(sql || '').replace(/\s+/g, ' ').slice(0, 200);
  const was = slow.find(x => x.sql === key);
  if (was) { was.n++; was.ms = Math.max(was.ms, ms); was.at = new Date().toISOString(); } else slow.push({ ms, sql: key, at: new Date().toISOString(), n: 1 });
  slow.sort((a, b) => b.ms - a.ms); slow.length = Math.min(slow.length, 20);
  console.error(`[adb slow] ${ms} ms${failed ? ' (ended)' : ''}: ${key}`);
}

// Parameters as better-sqlite3 and the bridge take them: positional, one array, or one object for @named.
const flat = a => (a.length === 1 && Array.isArray(a[0])) ? a[0] : a;
const isNamedArg = a => a.length === 1 && a[0] && typeof a[0] === 'object' && !Array.isArray(a[0]) && !(a[0] instanceof Date) && !Buffer.isBuffer(a[0]);
// A value as the bridge hands it back: its answer crosses threads as JSON, so a Date is its ISO string, a Buffer {type,data}.
const plain = v => (v === null || typeof v !== 'object') ? v : JSON.parse(JSON.stringify(v));
const plainRow = r => { if (!r) return r; for (const k of Object.keys(r)) { const v = r[k]; if (v !== null && typeof v === 'object') r[k] = plain(v); } return r; };

function timed(sql, fn) {
  const t0 = Date.now();
  const done = failed => { const ms = Date.now() - t0; if (ms > SLOW_MS()) noteSlow(ms, sql, failed); };
  let p; try { p = fn(); } catch (e) { done(true); return Promise.reject(e); }
  return Promise.resolve(p).then(r => { done(false); return r; }, e => { done(e && e.code === '57014'); throw e; });
}

// SQLite: the same statement on the same connection, resolved on the next turn of the loop.
function sqlite(db) {
  const stmts = new Map(); // compiled once, as the rooms keep theirs
  const prep = sql => { let st = stmts.get(sql); if (!st) { st = db.prepare(sql); if (stmts.size > 2000) stmts.clear(); stmts.set(sql, st); } return st; };
  const call = (sql, a, how) => timed(sql, () => {
    const st = prep(sql);
    const args = isNamedArg(a) ? [a[0]] : flat(a);
    if (how === 'get') return st.get(...args);
    if (how === 'all') return st.all(...args);
    const r = st.run(...args); return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
  });
  return { kind: 'sqlite', get: (sql, ...a) => call(sql, a, 'get'), all: (sql, ...a) => call(sql, a, 'all'), run: (sql, ...a) => call(sql, a, 'run'), slow: () => slow.slice(), close: () => Promise.resolve(), state: () => ({ kind: 'sqlite' }) };
}

// Postgres: a pg Pool beside the bridge, opened on the first question.
function postgres(db, url) {
  const { Pool } = require('pg');
  const types = { getTypeParser: (oid, format) => {
    if (oid === 20 || oid === 1700) return v => (v === null ? null : Number(v)); // int8 (COUNT) and numeric as numbers, as the bridge reads them
    if (oid === 1016) return v => v;
    return require('pg').types.getTypeParser(oid, format);
  } };
  let pool = null, closed = false;
  const limitMs = LIMIT_MS(), poolN = POOL_N(); // read when opened: the pool itself opens on the first question
  const ssl = /sslmode=require|render\.com|neon\.tech|supabase/.test(url) && !/localhost|127\.0\.0\.1|\/tmp/.test(url) ? { rejectUnauthorized: false } : undefined;
  const open = () => {
    if (closed) throw new Error('adb: closed');
    if (pool) return pool;
    pool = new Pool({ connectionString: url, ssl, max: poolN, idleTimeoutMillis: 30000, allowExitOnIdle: true, types,
      statement_timeout: limitMs, lock_timeout: Math.min(limitMs, +(process.env.PG_LOCK_TIMEOUT_MS || 15000)), idle_in_transaction_session_timeout: 60000 });
    pool.on('error', e => console.error('[adb] connection', e.message)); // an idle connection lost: the pool makes another
    return pool;
  };
  const cache = new Map(); const idCols = new Map();
  async function returningFor(table) {
    if (!table) return null;
    if (!idCols.has(table)) {
      const r = await open().query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name IN ('id','seq')", [table]);
      const names = r.rows.map(x => x.column_name); idCols.set(table, names.includes('id') ? 'id' : names.includes('seq') ? 'seq' : null);
    }
    return idCols.get(table);
  }
  async function translate(sql) {
    let t = cache.get(sql); if (t) return t;
    const ret = D.isInsert(sql) ? await returningFor(D.insertTable(sql)) : null;
    const tr = D.toPg(sql, { returning: ret });
    t = { sql: String(tr), ret, named: tr.named || null };
    if (cache.size > 5000) cache.clear();
    cache.set(sql, t); return t;
  }
  const bind = (t, a) => (t.named && isNamedArg(a)) ? t.named.map(k => a[0][k]) : flat(a);
  // Inside the bridge's transaction a pool connection cannot see its rows: ask the bridge, as the room did before.
  const viaBridge = (sql, a, how) => { const st = db.prepare(sql); const args = isNamedArg(a) ? [a[0]] : flat(a); return how === 'get' ? st.get(...args) : how === 'all' ? st.all(...args) : st.run(...args); };
  function call(sql, a, how) {
    if (db.inTransaction && db.inTransaction()) { try { return Promise.resolve(viaBridge(sql, a, how)); } catch (e) { return Promise.reject(e); } }
    return timed(sql, async () => {
      const t = await translate(sql);
      const params = bind(t, a).map(p => (p === undefined ? null : p));
      let r; try { r = await open().query(t.sql, params); } catch (e) {
        const err = new Error(e.message + '\n  in: ' + t.sql.slice(0, 300)); err.code = e.code; err.detail = e.detail; err.position = e.position; throw err;
      }
      if (how === 'get') return plainRow(r.rows[0]);
      if (how === 'all') { for (const row of r.rows) plainRow(row); return r.rows; }
      const row = r.rows[0]; return { changes: r.rowCount || 0, lastInsertRowid: row && t.ret ? Number(row[t.ret]) : 0 };
    });
  }
  return {
    kind: 'postgres',
    get: (sql, ...a) => call(sql, a, 'get'), all: (sql, ...a) => call(sql, a, 'all'), run: (sql, ...a) => call(sql, a, 'run'),
    slow: () => slow.slice(),
    state: () => ({ kind: 'postgres', open: !!pool, total: pool ? pool.totalCount : 0, idle: pool ? pool.idleCount : 0, waiting: pool ? pool.waitingCount : 0, limitMs }),
    close: async () => { closed = true; const p = pool; pool = null; if (p) await p.end(); },
  };
}

// The house's db (from db.js) in, its async twin out.
function open(db) {
  if (db && db.kind === 'postgres') return postgres(db, db.url);
  return sqlite(db);
}

module.exports = { open, slow: () => slow.slice() };
