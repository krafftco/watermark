// The bridge (27 Oct 2026): Postgres with SQLite's shape. The house calls its database synchronously in two and a
// half thousand places (`db.prepare(sql).get(…)`), and Postgres answers asynchronously; rather than rewrite every
// room, this hands each statement to a worker thread that holds the connection and waits on shared memory for the
// answer (Atomics.wait), so the calling code is untouched and the whole smoke suite proves the translation. The
// cost is a blocked event loop for one round trip per statement (a few hundred microseconds on the private
// network), which the house already paid, in smaller coin, to SQLite; rooms can move to the async form later,
// one at a time, as a performance pass. The dialect is translated in dialect.js on the way through.
'use strict';
const { Worker } = require('worker_threads');
const path = require('path');
const D = require('./dialect');

const STATUS = 0, LENGTH = 1, WAIT_MS = 120000;

function open(url) {
  const worker = new Worker(path.join(__dirname, 'pgworker.js'), { workerData: { url } });
  worker.unref();
  let sab = new SharedArrayBuffer(8 + 256 * 1024), ctl = new Int32Array(sab, 0, 2), data = new Uint8Array(sab, 8);
  worker.postMessage({ kind: 'attach', sab });
  const cache = new Map(); // translated SQL by source text
  const idCols = new Map(); // table → the column an INSERT should return (id or seq)
  let depth = 0, closed = false;

  function call(msg) {
    if (closed) throw new Error('database closed');
    Atomics.store(ctl, STATUS, 0);
    worker.postMessage(msg);
    for (;;) {
      const r = Atomics.wait(ctl, STATUS, 0, WAIT_MS);
      if (r === 'timed-out') throw new Error('database: no answer in ' + WAIT_MS / 1000 + ' s');
      const st = Atomics.load(ctl, STATUS);
      if (st === 2) { // the answer is bigger than the buffer: grow it and let the worker write again
        const need = Atomics.load(ctl, LENGTH);
        sab = new SharedArrayBuffer(8 + Math.max(need, data.length * 2)); ctl = new Int32Array(sab, 0, 2); data = new Uint8Array(sab, 8);
        Atomics.store(ctl, STATUS, 0); worker.postMessage({ kind: 'grow', sab }); continue;
      }
      const len = Atomics.load(ctl, LENGTH);
      const obj = JSON.parse(Buffer.from(data.buffer, data.byteOffset, len).toString());
      if (st === 3) { const e = new Error(obj.message + (obj.sql ? '\n  in: ' + obj.sql.slice(0, 300) : '')); e.code = obj.code; e.detail = obj.detail; e.position = obj.position; throw e; }
      return obj;
    }
  }

  function exec(sql) {
    // Several statements at once (DDL at mount): each translated on its own, sent as one simple query.
    const parts = splitStatements(sql).map(s => D.toPg(s)); if (!parts.length) return;
    call({ kind: 'exec', sql: parts.join(';\n') });
    if (parts.some(D.isDdl)) idCols.clear();
  }
  function query(sql, params, array) { return call({ kind: 'query', sql, params: params.map(p => p === undefined ? null : p), array }); }
  function returningFor(table) {
    if (!table) return null;
    if (!idCols.has(table)) {
      const r = query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name IN ('id','seq')", [table]);
      const names = r.rows.map(x => x.column_name); idCols.set(table, names.includes('id') ? 'id' : names.includes('seq') ? 'seq' : null);
    }
    return idCols.get(table);
  }
  function translate(sql) {
    let t = cache.get(sql); if (t) return t;
    const ret = D.isInsert(sql) ? returningFor(D.insertTable(sql)) : null;
    const tr = D.toPg(sql, { returning: ret });
    t = { sql: String(tr), ret, ddl: D.isDdl(sql), named: tr.named || null };
    cache.set(sql, t); return t;
  }
  const flat = a => (a.length === 1 && Array.isArray(a[0])) ? a[0] : a;
  // Positional (?) or named (@name with one object) parameters, as better-sqlite3 takes them.
  const bind = (t, a) => (t.named && a.length === 1 && a[0] && typeof a[0] === 'object' && !Array.isArray(a[0])) ? t.named.map(k => a[0][k]) : flat(a);

  function prepare(sql) {
    const t = translate(sql);
    const flat = a => bind(t, a);
    const stmt = {
      source: sql,
      get(...p) { return query(t.sql, flat(p), false).rows[0]; },
      all(...p) { return query(t.sql, flat(p), false).rows; },
      run(...p) { const r = query(t.sql, flat(p), false); if (t.ddl) idCols.clear(); const row = r.rows[0]; return { changes: r.n || 0, lastInsertRowid: row && t.ret ? row[t.ret] : 0 }; },
      iterate(...p) { return query(t.sql, flat(p), false).rows[Symbol.iterator](); },
      pluck() { return { get: (...p) => { const r = query(t.sql, flat(p), true).rows[0]; return r ? r[0] : undefined; }, all: (...p) => query(t.sql, flat(p), true).rows.map(r => r[0]) }; },
      raw() { return { get: (...p) => query(t.sql, flat(p), true).rows[0], all: (...p) => query(t.sql, flat(p), true).rows, iterate: (...p) => query(t.sql, flat(p), true).rows[Symbol.iterator]() }; },
    };
    return stmt;
  }
  function transaction(fn) {
    const wrapped = (...a) => {
      const sp = depth > 0 ? 'wm_sp' + depth : null;
      exec(sp ? `SAVEPOINT ${sp}` : 'BEGIN'); depth++;
      try { const r = fn(...a); depth--; exec(sp ? `RELEASE SAVEPOINT ${sp}` : 'COMMIT'); return r; }
      catch (e) { depth--; try { exec(sp ? `ROLLBACK TO SAVEPOINT ${sp}` : 'ROLLBACK'); } catch (e2) {} throw e; }
    };
    wrapped.deferred = wrapped; wrapped.immediate = wrapped; wrapped.exclusive = wrapped;
    return wrapped;
  }

  exec(D.PRELUDE);
  return {
    kind: 'postgres', url, prepare, exec, transaction,
    pragma: () => [],
    close() { if (closed) return; closed = true; try { call({ kind: 'close' }); } catch (e) {} },
    backup() { throw new Error('backup: use pg_dump for a Postgres house'); },
    inTransaction: () => depth > 0,
  };
}

// Statements split on ; outside quotes and comments.
function splitStatements(sql) {
  const out = []; let cur = '';
  for (const s of D.segments(sql)) {
    if (s.code == null) { cur += s.str; continue; }
    let rest = s.code;
    for (;;) { const i = rest.indexOf(';'); if (i < 0) { cur += rest; break; } cur += rest.slice(0, i); if (cur.trim()) out.push(cur); cur = ''; rest = rest.slice(i + 1); }
  }
  if (cur.trim()) out.push(cur);
  return out.map(s => s.trim()).filter(s => s && !/^(--.*\n?)+$/.test(s));
}

module.exports = { open, splitStatements };
