// The SQL gate in CLAUDE.md, read by a machine (#8): "Never SELECT * from works or texts for a list: name the columns
// and give it a LIMIT." Every statement in src/ whose own FROM (outside its subqueries) is `works` or `texts` and that is
// not asked for one row (`.get(`, an aggregate with no GROUP BY, or a WHERE on id or slug alone) must have a LIMIT and
// must name its columns (no `*`, no `w.*`). What stood on 16 Nov is in ALLOW below, by file, each line with the issue
// that will take it out; a new statement that breaks the rule fails here, and an allowed one that is fixed must leave
// the list (a stale line fails too, so the list only shrinks).
//   node test/listreads.js            the check
//   LISTREADS_PRINT=1 node test/listreads.js   every offender, as allow lines (to see the whole of it)
'use strict';
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');

// Every string literal that begins with SELECT ('…', "…", `…` with ${…} kept as an opaque mark), with the text after it.
// Found by its opening quote and read to its closing one, so the rest of the file (regular expressions, comments) is
// never tokenised and cannot lead the reader astray.
function literals(code) {
  const out = [];
  for (const m of code.matchAll(/(['"`])\s*SELECT\b/g)) {
    const c = m[1], i = m.index; let j = i + 1, s = '';
    while (j < code.length) {
      const d = code[j];
      if (d === '\\') { s += code[j + 1] || ''; j += 2; continue; }
      if (c === '`' && d === '$' && code[j + 1] === '{') { // the interpolation, nested braces and strings included
        let k = j + 2, depth = 1;
        while (k < code.length && depth) { const e = code[k]; if (e === '{') depth++; else if (e === '}') depth--; else if (e === "'" || e === '"' || e === '`') { const q = e; k++; while (k < code.length && code[k] !== q) { if (code[k] === '\\') k++; k++; } } k++; }
        s += ' ${} '; j = k; continue;
      }
      if (d === c || (c !== '`' && d === '\n')) break;
      s += d; j++;
    }
    out.push({ s, at: i, after: code.slice(j + 1, j + 120) });
  }
  return out;
}
// The statement at depth 0 (subqueries and function arguments blanked), for finding its own FROM, LIMIT and columns.
const top = sql => { let d = 0, o = ''; for (const ch of sql) { if (ch === '(') { d++; o += ' '; continue; } if (ch === ')') { d = Math.max(0, d - 1); o += ' '; continue; } o += d ? ' ' : ch; } return o; };
const norm = s => String(s).replace(/\s+/g, ' ').trim();

function offenders() {
  const found = [];
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort()) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    for (const { s, at, after } of literals(code)) {
      if (!/^\s*SELECT\b/i.test(s)) continue;
      const t = top(s);
      const own = t.match(/\bFROM\s+(\w+)/i); if (!own || !/^(works|texts)$/i.test(own[1])) continue;
      if (/^\s*\)?\s*\.get\(/.test(after) || /^\s*\)\s*\.pluck\(\)\s*\.get\(/.test(after)) continue; // one row
      if (/\badb\.get\(\s*$/.test(code.slice(Math.max(0, at - 24), at))) continue; // one row, on the async path (#117)
      const cols = (t.match(/^\s*SELECT\s+(DISTINCT\s+)?([\s\S]*?)\bFROM\b/i) || [])[2] || '';
      const star = /(^|,)\s*(\w+\.)?\*\s*(,|$)/.test(cols);
      const agg = /^\s*(COUNT|SUM|MAX|MIN|AVG|COALESCE|TOTAL)\b/i.test(cols) && !/\bGROUP\s+BY\b/i.test(t) && !/,\s*\w+\.?\w*\s*(,|$)/.test(cols.replace(/\b(COUNT|SUM|MAX|MIN|AVG|COALESCE|TOTAL)\s*/gi, ''));
      const one = /\bWHERE\s+(\w+\.)?(id|slug)\s*=\s*(\?|@\w+|\$\{\})\s*($|\b(AND|ORDER|LIMIT)\b)/i.test(t) && !/\bOR\b/i.test(t);
      // a list the caller bounds (`id IN (…)`, `slug IN (…)` of the few it shows) or counts grouped by a kind, not a row each
      const bounded = /\b(\w+\.)?(id|slug)\s+IN\s*\(\s*\$\{\}\s*\)/i.test(s) || (/\bGROUP\s+BY\s+(?!\w*\.?(id|\w+_id|slug)\b)/i.test(t) && /\b(COUNT|SUM)\s*\(/i.test(s));
      const limit = /\bLIMIT\b/i.test(t) || bounded;
      if (agg || one) continue; // one row, whatever its columns
      const why = [!limit ? 'no LIMIT' : null, star && !bounded ? 'SELECT *' : null].filter(Boolean);
      if (!why.length) continue;
      const line = code.slice(0, at).split('\n').length;
      found.push({ file: f, line, why: why.join(', '), sql: norm(s).slice(0, 90) });
    }
  }
  return found;
}

// What stood on 16 Nov (#8): file, the statement's first words, and the issue that takes it out. A line matches every
// statement in that file that begins with those words.
const ALLOW = require('./listreads-allow.json');

if (require.main === module) {
  const found = offenders();
  if (process.env.LISTREADS_PRINT) { console.log(JSON.stringify(found.map(o => ({ file: o.file, sql: o.sql, why: o.why, issue: 0, line: o.line })), null, 1)); process.exit(0); }
  const used = new Set(), bad = [];
  for (const o of found) { const i = ALLOW.findIndex(a => a.file === o.file && o.sql.startsWith(a.sql)); if (i >= 0) used.add(i); else bad.push(`src/${o.file}:${o.line} ${o.why}: ${o.sql}`); }
  const stale = ALLOW.filter((a, i) => !used.has(i)).map(a => `${a.file}: ${a.sql} (#${a.issue})`);
  if (bad.length) console.log(`listreads: ${bad.length} list read${bad.length === 1 ? '' : 's'} from works or texts without a LIMIT, or with SELECT * (CLAUDE.md, the SQL gate): name the columns and give it a LIMIT, or ask for one row with .get(\n  ` + bad.join('\n  '));
  if (stale.length) console.log(`listreads: ${stale.length} allowed line${stale.length === 1 ? '' : 's'} no longer found (fixed: take ${stale.length === 1 ? 'it' : 'them'} out of test/listreads-allow.json)\n  ` + stale.join('\n  '));
  if (bad.length || stale.length) process.exit(1);
  console.log(`listreads: ok (${found.length} allowed, each with its issue; no new one)`);
}
module.exports = { offenders, literals };
