// The display copies kept within a budget: wall first, then large, then screen; thumbs never.
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const images = require('../src/images');
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wmdisk-'));
const put = (n, kb, age) => { const p = path.join(d, n); fs.writeFileSync(p, Buffer.alloc(kb * 1024)); const t = (Date.now() - age * 1000) / 1000; fs.utimesSync(p, t, t); };
for (let i = 0; i < 5; i++) { put(`w${i}-thumbq5.jpg`, 100, i); put(`w${i}-screenq5.jpg`, 300, i); put(`w${i}-largeq5.jpg`, 600, i); put(`w${i}-wallq5.jpg`, 1200, i); }
put('w0-dkr-abc.jpg', 500, 1);
const total = images.usage(d); assert.ok(Object.keys(total).length >= 21, 'usage lists the files');
const r = images.trimRenditions(d, 6 * 1024 * 1024);
const left = fs.readdirSync(d);
assert.ok(r.n > 0 && r.total <= 6 * 1024 * 1024, 'trimmed under the budget');
assert.equal(left.filter(f => /thumb/.test(f)).length, 5, 'thumbs never trimmed');
assert.ok(!left.includes('w0-dkr-abc.jpg'), 'working copies go first');
assert.ok(left.filter(f => /wall/.test(f)).length < 5 && left.filter(f => /screen/.test(f)).length === 5, 'wall before screen');
const r2 = images.trimRenditions(d, 1e12); assert.equal(r2.n, 0, 'under budget, nothing goes');
fs.rmSync(d, { recursive: true, force: true });
console.log('ok: the display copies within their budget');
