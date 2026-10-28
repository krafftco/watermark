#!/usr/bin/env node
// The static check (27 Oct 2026): every statement the house prepares, read out of the source, translated by the
// dialect and PREPAREd against a real Postgres (parsed, planned, never run), so what the translator cannot do by
// rule (a bare integer where Postgres wants a boolean, a loose GROUP BY, a function it lacks) is found in one pass
// instead of one visitor at a time. Usage: DATABASE_URL=… node scripts/sql-check.js [src/room.js …]
// Needs the schema in place: boot the house once against that database first (the smoke suite does).
'use strict';
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
const D = require('../src/dialect');

const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(__dirname, '../src')).filter(f => f.endsWith('.js')).map(f => 'src/' + f);

// Pull the first argument of every .prepare( … ) when it is a plain literal; a template with ${} is reported, not checked.
function statements(src) {
  // .prepare(…) and any wrapper the file defines over it: const q = (sql, …) => db.prepare(sql)…, function q(sql …)
  const wrappers = [...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\(\s*sql\b|function\s+(\w+)\s*\(\s*sql\b/g)].map(m => m[1] || m[2]).filter(Boolean);
  const out = []; const re = new RegExp('(?:\\.prepare' + (wrappers.length ? '|\\b(?:' + wrappers.join('|') + ')' : '') + ')\\(\\s*', 'g'); let m;
  while ((m = re.exec(src))) {
    const i = m.index + m[0].length, q = src[i]; if (!"'\"`".includes(q)) continue;
    let j = i + 1, s = '';
    for (; j < src.length; j++) { const c = src[j]; if (c === '\\') { s += src[j + 1] === 'n' ? '\n' : src[j + 1]; j++; continue; } if (c === q) break; s += c; }
    const line = src.slice(0, m.index).split('\n').length;
    if ((q === '`' && /\$\{/.test(s)) || /^\s*\+/.test(src.slice(j + 1, j + 4))) { out.push({ line, dynamic: true, sql: s }); continue; }
    out.push({ line, sql: s });
  }
  return out;
}

(async () => {
  const url = process.env.DATABASE_URL; if (!url) { console.error('DATABASE_URL needed'); process.exit(2); }
  const c = new Client({ connectionString: url }); await c.connect();
  await c.query(D.PRELUDE);
  let n = 0, bad = 0, dyn = 0, unknown = 0; const faults = [];
  const allSrc = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const st of statements(src)) {
      if (st.dynamic) { dyn++; continue; }
      n++;
      let sql; try { sql = D.toPg(st.sql, { returning: null }); } catch (e) { bad++; faults.push(`${f}:${st.line}  translate: ${e.message}`); continue; }
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)/i.test(sql)) continue;
      try { await c.query('PREPARE wm_check AS ' + sql); await c.query('DEALLOCATE wm_check'); }
      catch (e) {
        try { await c.query('DEALLOCATE wm_check'); } catch (e2) {}
        if (/could not determine data type of parameter/.test(e.message)) { unknown++; if (process.env.SHOW_UNTYPED) console.log(`${f}:${st.line}  untyped: ${sql.replace(/\s+/g, ' ').slice(0, 200)}`); continue; } // a $n with no context; fine at run time with a typed value
        const rel = /relation "(\w+)" does not exist/.exec(e.message);
        if (rel && !allSrc.includes(`EXISTS ${rel[1]} `) && !allSrc.includes(`EXISTS ${rel[1]}(`)) { console.log(`${f}:${st.line}  a table no room makes (${rel[1]}), as on SQLite`); continue; }
        bad++; faults.push(`${f}:${st.line}  ${e.message}\n      ${sql.replace(/\s+/g, ' ').slice(0, 220)}`);
      }
    }
  }
  await c.end();
  faults.forEach(x => console.log(x));
  console.log(`\n${n} statements checked, ${bad} faults, ${dyn} dynamic (not checked), ${unknown} with an untyped parameter`);
  process.exit(bad ? 1 : 0);
})();
