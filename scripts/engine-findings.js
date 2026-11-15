// A walk's findings raised in full as CI annotations (#55): CI's log cannot be read from a session, only annotations,
// at most 1500 characters each and ten of each level a step. Used by the `reach-webkit` job.
//   node scripts/engine-findings.js <reach|wayback> <findings.json> <output.txt> <exit code>
// With the findings file: every finding, grouped, in as many annotations as it takes (ten at the job's level, then ten
// notices; past that the job's artifact holds the whole file). WM_WEBKIT_ADVISORY=1: findings are warnings and the step
// passes. Without the findings file the walk did not finish (WebKit missing, a crash): the output's tail is an error and
// the step fails, advisory or not.
const fs = require('fs');
const [walk, json, out, rcArg] = process.argv.slice(2);
const rc = Number(rcArg || 0);
const advisory = process.env.WM_WEBKIT_ADVISORY === '1';
const MAX = 1500;
const esc = s => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const say = (level, title, msg) => console.log(`::${level} title=${title}::${esc(msg)}`);
const tail = () => { try { return fs.readFileSync(out, 'utf8').slice(-1000); } catch (e) { return '(no output)'; } };

let data = null;
try { data = JSON.parse(fs.readFileSync(json, 'utf8')); } catch (e) { /* the walk did not finish */ }
if (!data) {
  say('error', `${walk} webkit`, `the ${walk} walk did not finish in WebKit (exit ${rc}); its last lines:\n${tail()}`);
  process.exit(1);
}

let head, rows;
if (walk === 'reach') {
  const g = new Map();
  for (const f of data.faults) {
    const k = `${f.page} · ${f.kind}${f.at ? ' (' + f.at + ')' : ''} · ${f.sel} “${f.words}”${f.box ? ' [' + f.box.join(',') + ']' : ''}${f.cover ? ' · under ' + [f.cover.sel || f.cover.tag, f.cover.pe ? 'pe:' + f.cover.pe : '', f.cover.z ? 'z:' + f.cover.z : '', f.cover.pos && f.cover.pos !== 'static' ? f.cover.pos : ''].filter(Boolean).join(' ') : ''}`;
    if (!g.has(k)) g.set(k, new Set()); g.get(k).add(f.size + (f.role === 'out' ? '' : '/' + f.role));
  }
  rows = [...g].map(([k, v]) => `${k} · ${[...v].join(',')}`);
  const issues = [...new Set((data.allowed || []).map(a => '#' + a.issue))].join(' ');
  head = `reach webkit: ${data.faults.length} findings in ${rows.length} groups; ${(data.allowed || []).length} on the allow-list (${issues || 'none'})`;
} else {
  rows = data.fails || [];
  head = `wayback webkit: ${rows.length} of ${data.checks} checks failed`;
}
const fault = rows.length > 0 || rc !== 0;
if (!fault) { console.log(head + ': clean'); process.exit(0); }
if (!rows.length) rows = [`the walk exited ${rc} with no findings; its last lines:\n${tail()}`];

// Pack the rows into annotations of at most MAX characters as sent (escaped) (a single long row is cut, never dropped silently).
const packs = []; let cur = '';
for (let r of rows) { if (r.length > MAX - 40) r = r.slice(0, MAX - 41) + '…'; if (cur && esc(cur + r + '\n').length > MAX - 40) { packs.push(cur); cur = ''; } cur += r + '\n'; }
if (cur) packs.push(cur);
const level = advisory ? 'warning' : 'error';
const n = packs.length;
say(level, `${walk} webkit`, head + (advisory ? ' (advisory: WM_WEBKIT_ADVISORY=1, #55)' : '') + `; ${n} annotation${n === 1 ? '' : 's'} follow`);
packs.slice(0, 9).forEach((m, i) => say(level, `${walk} webkit ${i + 1}/${n}`, m));
packs.slice(9, 18).forEach((m, i) => say('notice', `${walk} webkit ${i + 10}/${n}`, m));
if (n > 18) say('notice', `${walk} webkit`, `${n - 18} more annotations' worth not raised: the whole list is in this job's artifact (webkit-findings)`);
console.log(head);
process.exit(advisory ? 0 : 1);
