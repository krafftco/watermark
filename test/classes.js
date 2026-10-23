// No two rooms may share a class (21 Oct: the tour's `.tr` darkened the trade page; the card's `.ic` stretched every
// glyph to a column; the reading room's `.rd` would have broken the rights desk). The house's older classes are
// defined more than once on purpose (phones, dark rooms); their counts are the baseline below. Any class defined more
// often than its baseline, or any new class defined twice, fails. Raise a baseline only when the second definition
// is the same room's (a media query), never another room's.
const fs = require('fs'); const assert = require('assert'); const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const seen = new Map();
for (const m of css.matchAll(/(?:^|[}\n])\s*\.([a-z][a-z0-9-]*)\s*\{/g)) { const c = m[1]; seen.set(c, (seen.get(c) || 0) + 1); }
const BASE = { top: 6, foot: 2, ct: 2, plate: 4, snav: 2, sv: 2, cat: 2, plates: 2, pl: 3, pb: 4, pt: 2, essay: 2, lot: 2, ls: 2, pf: 2, ap: 2, lt: 2, td: 2, rq: 2, op: 2, wk: 2, gc: 2, bc: 2, gh: 3, vt: 2 };
const bad = [...seen].filter(([c, n]) => !/-/.test(c) && n > (BASE[c] || 1));
assert.deepEqual(bad, [], 'a room class defined again, by another room? ' + bad.map(([c, n]) => `.${c}×${n}`).join(', '));
console.log('ok: no two rooms share a class');
