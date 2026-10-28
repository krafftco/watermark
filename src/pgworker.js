// The worker on the other side of the bridge (see pgsync.js): one Postgres connection, one statement at a time,
// the answer written into shared memory and the waiting main thread woken. It is the only thread that talks to
// the server; the main thread blocks for each answer, so statements are strictly in order and a transaction is
// simply BEGIN … COMMIT on this one connection.
'use strict';
const { parentPort, workerData } = require('worker_threads');
const { Client, types } = require('pg');

types.setTypeParser(20, v => Number(v));     // int8 (COUNT(*)) as a number, as SQLite gave it
types.setTypeParser(1700, v => Number(v));   // numeric
types.setTypeParser(1016, v => v);           // int8[] untouched

let ctl, data, pending = null, client = null, connecting = null;
const STATUS = 0, LENGTH = 1;

function attach(sab) { ctl = new Int32Array(sab, 0, 2); data = new Uint8Array(sab, 8); }
function answer(status, obj) {
  const bytes = Buffer.from(JSON.stringify(obj === undefined ? null : obj));
  if (bytes.length > data.length) { pending = { status, bytes }; Atomics.store(ctl, LENGTH, bytes.length); Atomics.store(ctl, STATUS, 2); Atomics.notify(ctl, STATUS); return; }
  data.set(bytes); Atomics.store(ctl, LENGTH, bytes.length); Atomics.store(ctl, STATUS, status); Atomics.notify(ctl, STATUS);
}

async function connect() {
  if (client) return client;
  if (!connecting) connecting = (async () => {
    const c = new Client({ connectionString: workerData.url, ssl: /sslmode=require|render\.com|neon\.tech|supabase/.test(workerData.url) && !/localhost|127\.0\.0\.1|\/tmp/.test(workerData.url) ? { rejectUnauthorized: false } : undefined });
    await c.connect();
    // No statement may hold this connection hostage (28 Oct, the test worker fell silent on Render with nothing in the
    // log): a lock waits fifteen seconds at most, a statement two minutes, and a transaction left open with nothing
    // running is cut after a minute, each an error the house sees rather than a silence.
    await c.query(`SET lock_timeout = '${+(process.env.PG_LOCK_TIMEOUT_MS || 15000)}ms'; SET statement_timeout = '${+(process.env.PG_STATEMENT_TIMEOUT_MS || 120000)}ms'; SET idle_in_transaction_session_timeout = '${+(process.env.PG_IDLE_TX_TIMEOUT_MS || 60000)}ms'`);
    c.on('error', e => { console.error('[pg] connection', e.message); client = null; connecting = null; });
    client = c; return c;
  })().catch(e => { connecting = null; throw e; }); // a failed connection is tried again on the next statement
  return connecting;
}

parentPort.on('message', async msg => {
  try {
    if (msg.kind === 'attach') { attach(msg.sab); return; }
    if (msg.kind === 'grow') { attach(msg.sab); const p = pending; pending = null; if (p) { data.set(p.bytes); Atomics.store(ctl, LENGTH, p.bytes.length); Atomics.store(ctl, STATUS, p.status); Atomics.notify(ctl, STATUS); } return; }
    if (msg.kind === 'close') { try { if (client) await client.end(); } catch (e) {} answer(1, true); process.exit(0); }
    const c = await connect();
    if (msg.kind === 'exec') { await c.query(msg.sql); answer(1, true); return; }
    if (msg.kind === 'query') {
      const r = await c.query({ text: msg.sql, values: msg.params || [], rowMode: msg.array ? 'array' : undefined });
      answer(1, { rows: r.rows, n: r.rowCount });
      return;
    }
    answer(3, { message: 'unknown message ' + msg.kind });
  } catch (e) {
    answer(3, { message: e.message, code: e.code, detail: e.detail, position: e.position, sql: msg && msg.sql });
  }
});
