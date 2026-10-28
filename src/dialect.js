// The dialect (27 Oct 2026, the night the database moved): the house was written against SQLite, two and a half
// thousand statements in its own idiom (datetime('now'), INSERT OR IGNORE, pragma_table_info, ? for a parameter).
// Postgres speaks a close cousin. This file turns one into the other in one place, so no room has to be rewritten
// to move house: every statement passes through `toPg` on its way to the server. What it cannot translate by rule
// (a bare integer where Postgres wants a boolean, a GROUP BY Postgres finds too loose) is found by the static
// check (scripts/sql-check.js), which prepares every statement in the source against a real Postgres, and fixed by
// hand in words both databases accept.
'use strict';

// Split SQL into code and string segments, so rewrites never touch the inside of a literal.
function segments(sql) {
  const out = []; let i = 0, code = '';
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") { let j = i + 1; while (j < sql.length) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; } j++; } out.push({ code }); code = ''; out.push({ str: sql.slice(i, j + 1) }); i = j + 1; continue; }
    if (c === '"') { let j = sql.indexOf('"', i + 1); if (j < 0) j = sql.length - 1; out.push({ code }); code = ''; out.push({ str: sql.slice(i, j + 1) }); i = j + 1; continue; }
    if (c === '-' && sql[i + 1] === '-') { let j = sql.indexOf('\n', i); if (j < 0) j = sql.length; out.push({ code }); code = ''; out.push({ str: sql.slice(i, j) }); i = j; continue; }
    code += c; i++;
  }
  out.push({ code });
  return out;
}
const join = segs => segs.map(s => s.code != null ? s.code : s.str).join('');

const NOW = "timezone('utc', now())";
const FMT_DT = "'YYYY-MM-DD HH24:MI:SS'", FMT_D = "'YYYY-MM-DD'";

// A SQLite date modifier as a Postgres expression applied to `x`.
function modify(x, mod) {
  const m = mod.trim();
  const lit = /^'([^']*)'$/.exec(m);
  if (lit) {
    const v = lit[1].trim();
    if (v === 'start of month') return `date_trunc('month', ${x})`;
    if (v === 'start of day') return `date_trunc('day', ${x})`;
    if (v === 'start of year') return `date_trunc('year', ${x})`;
    if (v === 'localtime' || v === 'utc') return x;
    const r = /^([+-]?)\s*(\d+(?:\.\d+)?)\s*(second|minute|hour|day|month|year)s?$/i.exec(v);
    if (r) return `(${x} ${r[1] === '-' ? '-' : '+'} interval '${r[2]} ${r[3].toLowerCase()}s')`;
    throw new Error('dialect: unknown date modifier ' + v);
  }
  return `(${x} + wm_mod(${m}))`; // a modifier built at run time: wm_mod() reads SQLite's words into an interval
}
const base = a => { const t = a.trim(); return /^'now'$/i.test(t) ? NOW : `(${t})::timestamp`; };

// Parse the arguments of a call that begins at `start` (just after the opening paren); returns { args, end }.
function args(sql, start) {
  const out = []; let depth = 0, i = start, cur = '', q = false;
  for (; i < sql.length; i++) {
    const c = sql[i];
    if (q) { cur += c; if (c === "'" && sql[i + 1] === "'") { cur += "'"; i++; } else if (c === "'") q = false; continue; }
    if (c === "'") { q = true; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') { if (depth === 0) { out.push(cur); return { args: out, end: i + 1 }; } depth--; }
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  throw new Error('dialect: unbalanced call');
}

// Rewrite SQLite's functions wherever they appear (outside strings), innermost first by repetition.
const FNS = /\b(datetime|date|strftime|julianday|total|group_concat|json_extract|instr|max|min)\s*\(/ig;
function functions(sql) {
  for (let guard = 0; guard < 200; guard++) {
    const segs = segments(sql); let pos = 0, hit = null;
    for (const s of segs) {
      if (s.code != null) { FNS.lastIndex = 0; const m = FNS.exec(s.code); if (m) { hit = { at: pos + m.index, name: m[1].toLowerCase(), open: pos + m.index + m[0].length }; break; } pos += s.code.length; }
      else pos += s.str.length;
    }
    if (!hit) return sql.replace(/\bMAX_\(/g, 'MAX(').replace(/\bMIN_\(/g, 'MIN(');
    const { args: a, end } = args(sql, hit.open);
    let rep;
    if (hit.name === 'datetime') { let x = base(a[0]); for (const m of a.slice(1)) x = modify(x, m); rep = `to_char(${x}, ${FMT_DT})`; }
    else if (hit.name === 'date') { let x = base(a[0]); for (const m of a.slice(1)) x = modify(x, m); rep = `to_char(${x}, ${FMT_D})`; }
    else if (hit.name === 'strftime') {
      const f = /^\s*'(.*)'\s*$/.exec(a[0]); if (!f) throw new Error('dialect: strftime needs a literal format');
      let x = base(a[1] || "'now'"); for (const m of a.slice(2)) x = modify(x, m);
      if (f[1] === '%s') rep = `floor(extract(epoch from ${x}))::bigint`;
      else rep = `to_char(${x}, '${f[1].replace(/%Y/g, 'YYYY').replace(/%m/g, 'MM').replace(/%d/g, 'DD').replace(/%H/g, 'HH24').replace(/%M/g, 'MI').replace(/%S/g, 'SS').replace(/%j/g, 'DDD').replace(/%w/g, 'D')}')`;
    }
    else if (hit.name === 'julianday') { let x = base(a[0] || "'now'"); for (const m of a.slice(1)) x = modify(x, m); rep = `(extract(epoch from ${x}) / 86400.0 + 2440587.5)`; }
    else if (hit.name === 'total') rep = `coalesce(sum(${a[0]}), 0)`;
    else if (hit.name === 'group_concat') rep = `string_agg((${a[0]})::text, ${a[1] ? a[1].trim() : "','"})`;
    else if (hit.name === 'json_extract') { const k = /^\s*'\$\.(\w+)'\s*$/.exec(a[1] || ''); if (!k) throw new Error('dialect: json_extract needs a $.key path'); rep = `((${a[0]})::json->>'${k[1]}')`; }
    else if (hit.name === 'instr') rep = `position((${a[1].trim()}) in (${a[0].trim()}))`;
    else if (hit.name === 'max' || hit.name === 'min') { if (a.length < 2) { sql = sql.slice(0, hit.at) + (hit.name === 'max' ? 'MAX_(' : 'MIN_(') + sql.slice(hit.open); continue; } rep = `${hit.name === 'max' ? 'greatest' : 'least'}(${a.join(',')})`; }
    sql = sql.slice(0, hit.at) + rep + sql.slice(end);
  }
  throw new Error('dialect: too many functions');
}

// The code-level rewrites: words, placeholders, DDL.
function words(sql) {
  const segs = segments(sql); let n = 0; const ignore = { v: false }; const named = []; const ddl = /^\s*(CREATE|ALTER)\b/i.test(sql);
  for (const s of segs) {
    if (s.code == null) continue;
    let c = s.code;
    c = c.replace(/\?/g, () => '$' + (++n));
    c = c.replace(/(\$\d+)\s+IS\s+(NOT\s+)?NULL\b/ig, (m, p, not) => `${p}::text IS ${not ? 'NOT ' : ''}NULL`); // a parameter with no column to take its type from
    c = c.replace(/@(\w+)/g, (m, name) => { if (!named.includes(name)) named.push(name); return '$' + (n + named.indexOf(name) + 1); });
    if (/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(c)) { c = c.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/ig, 'INSERT INTO'); ignore.v = true; }
    c = c.replace(/\bNOT\s+LIKE\b/ig, 'NOT ILIKE').replace(/\bLIKE\b/ig, 'ILIKE');
    c = c.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/ig, 'INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY');
    c = c.replace(/\b(\w+)\s+INTEGER\s+PRIMARY\s+KEY\b/ig, (m, col) => `${col} INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`);
    c = c.replace(/\bBLOB\b/g, 'BYTEA');
    if (ddl) c = c.replace(/\bINTEGER\b/g, 'BIGINT'); // SQLite's INTEGER is 64-bit: millisecond clocks and byte counts live in it
    c = c.replace(/\bAS\s+([a-z_]*[A-Z][A-Za-z0-9_]*[a-z][A-Za-z0-9_]*|[a-z][a-z0-9_]*[A-Z][A-Za-z0-9_]*)\b(?!\s*\()/g, (m, al) => /^(INTEGER|TEXT|REAL)$/i.test(al) ? m : `AS "${al}"`); // camelCase aliases keep their case
    s.code = c;
  }
  let out = join(segs);
  if (ignore.v && !/\bON\s+CONFLICT\b/i.test(out)) out = out.replace(/;?\s*$/, '') + ' ON CONFLICT DO NOTHING';
  words.named = named;
  return out;
}

// The whole translation; `returning` names the column the house wants back from an INSERT (set by the caller).
function toPg(sql, { returning } = {}) {
  sql = sql.replace(/\bpragma_table_info\s*\(\s*'(\w+)'\s*\)\s+WHERE\s+name\s*=/ig, (m, t) => `information_schema.columns WHERE table_name='${t}' AND column_name=`);
  sql = sql.replace(/\bsqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=/ig, "information_schema.tables WHERE table_schema='public' AND table_name=");
  sql = sql.replace(/\bIS\s+NOT\s+(\?|'[^']*')/ig, 'IS DISTINCT FROM $1').replace(/\bIS\s+(\?|'[^']*')/ig, 'IS NOT DISTINCT FROM $1');
  let out = words(functions(sql));
  const named = words.named;
  if (returning && /^\s*INSERT\b/i.test(out) && !/\bRETURNING\b/i.test(out)) out = out.replace(/;?\s*$/, '') + ` RETURNING ${returning}`;
  return named && named.length ? Object.assign(new String(out), { named }) : out;
}

// The table an INSERT writes to, and the first statement word.
const insertTable = sql => { const m = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?(\w+)"?/i.exec(sql); return m ? m[1].toLowerCase() : null; };
const isDdl = sql => /^\s*(CREATE|ALTER|DROP)\b/i.test(sql);
const isInsert = sql => /^\s*INSERT\b/i.test(sql);

// What the server needs once: SQLite's modifier words as an interval.
const PRELUDE = `CREATE OR REPLACE FUNCTION wm_mod(m text) RETURNS interval LANGUAGE sql IMMUTABLE AS $$ SELECT regexp_replace(trim(m), '^\\+', '')::interval $$;`;

module.exports = { toPg, segments, insertTable, isDdl, isInsert, PRELUDE };
