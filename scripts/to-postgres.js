#!/usr/bin/env node
// Moving house (27 Oct 2026): copy a SQLite house into a Postgres one, table by table, and prove it.
//   DATABASE_URL=postgres://… node scripts/to-postgres.js /path/to/watermark.db
// The schema is made by the house itself (every room's CREATE TABLE runs at mount, translated by the dialect), so the
// target is the same shape the app will use; tables are copied in dependency order (parents before children), the
// identity sequences set past the highest id, then every table's count compared and the register's chain verified on
// the new side. Run it with the old house stopped (or read-only) so nothing lands between the copy and the cutover.
// Safe to run again: it empties the target's tables first (a fresh database is the usual case).
'use strict';
const path = require('path');
const Database = require('better-sqlite3');

const file = process.argv[2]; const url = process.env.DATABASE_URL;
if (!file || !url) { console.error('usage: DATABASE_URL=postgres://… node scripts/to-postgres.js watermark.db'); process.exit(2); }

(async () => {
  const t0 = Date.now();
  // 1. The schema: boot the house against the target with every chore off, then let go of it.
  process.env.NO_SEED = '1'; process.env.CHORES = '0'; process.env.NODE_ENV = process.env.NODE_ENV || 'migrate';
  process.env.DATA_DIR = process.env.DATA_DIR || path.join(require('os').tmpdir(), 'wm-migrate-' + process.pid);
  const { createApp } = require('../src/app');
  const app = createApp({ noTimers: true, vaultNow: true, dataDir: process.env.DATA_DIR });
  const pg = app.locals.db; if (pg.kind !== 'postgres') throw new Error('DATABASE_URL must name a Postgres server');
  const src = new Database(file, { readonly: true });
  console.log(`schema made on ${new URL(url).host} in ${Date.now() - t0} ms`);

  // 2. The tables, in dependency order: a table waits for the tables it references.
  const tables = pg.prepare("SELECT table_name t FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name").all().map(r => r.t);
  const refs = {}; for (const r of pg.prepare(`SELECT tc.table_name t, ccu.table_name p FROM information_schema.table_constraints tc JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`).all()) { (refs[r.t] = refs[r.t] || new Set()).add(r.p); }
  const order = []; const seen = new Set();
  const visit = (t, stack = []) => { if (seen.has(t)) return; if (stack.includes(t)) return; for (const p of refs[t] || []) if (p !== t) visit(p, [...stack, t]); seen.add(t); order.push(t); };
  tables.forEach(t => visit(t));
  const srcTables = new Set(src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name));
  const pgCols = t => pg.prepare("SELECT column_name c, data_type d FROM information_schema.columns WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position").all(t);

  // Empty the target (children first), then copy.
  for (const t of [...order].reverse()) pg.prepare(`DELETE FROM ${t}`).run();
  const counts = {};
  for (const t of order) {
    if (!srcTables.has(t)) { console.log(`  ${t}: not in the old house, left empty`); continue; }
    const cols = pgCols(t); const srcCols = new Set(src.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name));
    const use = cols.filter(c => srcCols.has(c.c)); if (!use.length) continue;
    const names = use.map(c => c.c).join(', ');
    const rows = src.prepare(`SELECT ${names} FROM ${t}`).all(); let n = 0;
    const CH = 200;
    for (let i = 0; i < rows.length; i += CH) {
      const chunk = rows.slice(i, i + CH);
      const values = chunk.map((r, ri) => '(' + use.map((c, ci) => '$' + (ri * use.length + ci + 1)).join(',') + ')').join(',');
      const params = []; for (const r of chunk) for (const c of use) { let v = r[c.c]; if (v instanceof Buffer && c.d !== 'bytea') v = v.toString(); if (typeof v === 'bigint') v = Number(v); params.push(v === undefined ? null : v); }
      pg.prepare(`INSERT INTO ${t} (${names}) VALUES ${values}`).run(params); n += chunk.length;
    }
    counts[t] = n; console.log(`  ${t}: ${n}`);
  }
  // 3. The identity sequences, past the highest id or seq in each table.
  for (const t of order) {
    const ids = pgCols(t).filter(c => c.c === 'id' || c.c === 'seq'); if (!ids.length) continue;
    const seq = pg.prepare('SELECT pg_get_serial_sequence(?, ?) s', ).get(t, ids[0].c); if (!seq || !seq.s) continue;
    const m = pg.prepare(`SELECT COALESCE(MAX(${ids[0].c}), 0) m FROM ${t}`).get().m;
    pg.prepare(`SELECT setval(?, ?, ?)`).run(seq.s, Math.max(m, 1), m > 0 ? 1 : 0);
  }
  // 4. Prove it: counts, and the register's chain on the new side.
  let bad = 0;
  for (const t of order) { if (!srcTables.has(t)) continue; const a = src.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, b = pg.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; if (a !== b) { bad++; console.error(`  COUNT MISMATCH ${t}: ${a} → ${b}`); } }
  const chain = require('../src/ledger').verifyAll(pg);
  if (!chain.ok) { bad++; console.error(`  REGISTER CHAIN BROKEN at ${chain.broken_at}`); }
  const extra = [...srcTables].filter(t => !tables.includes(t)); if (extra.length) console.log(`  old tables no room makes any more (not copied): ${extra.join(', ')}`);
  console.log(bad ? `FAILED: ${bad} problem(s)` : `ok: ${Object.keys(counts).length} tables, ${Object.values(counts).reduce((a, b) => a + b, 0)} rows, the register verifies; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  src.close(); pg.close(); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
