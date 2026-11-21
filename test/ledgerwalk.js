// The register's full check reads a page at a time (20 Nov: the whole register in memory ended the worker every seven
// minutes). The answer must be the one the single read gave: every entry counted, the head right, a tamper found
// wherever it sits, on a page's edge or inside one.
process.env.LEDGER_WALK_PAGE = '3';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ledgerwalk-'));
const { createApp } = require('../src/app');
const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'ledgerwalk-secret', noTimers: true, vaultNow: true });
const db = app.locals.db, ledger = require('../src/ledger');
for (let i = 0; i < 10; i++) ledger.append(db, 'test.walk', 't' + i, { i });
const n = db.prepare('SELECT COUNT(*) n FROM ledger').get().n, head = db.prepare('SELECT hash FROM ledger ORDER BY seq DESC LIMIT 1').get().hash;
assert(n > 6, 'more than two pages');
let r = ledger.verifyAll(db);
assert.deepStrictEqual({ ok: r.ok, checked: r.checked, head: r.head }, { ok: true, checked: n, head }, 'the whole register, every page');
const seqs = db.prepare('SELECT seq FROM ledger ORDER BY seq').all().map(x => x.seq);
for (const at of [seqs[0], seqs[2], seqs[3], seqs[n - 1]]) { // first, a page's last, the next page's first, the head
  const was = db.prepare('SELECT data FROM ledger WHERE seq=?').get(at).data;
  db.prepare("UPDATE ledger SET data='{\"x\":1}' WHERE seq=?").run(at);
  r = ledger.verifyAll(db); assert.strictEqual(r.ok, false, 'tamper at ' + at); assert.strictEqual(r.broken_at, at, 'found where it is: ' + at);
  db.prepare('UPDATE ledger SET data=? WHERE seq=?').run(was, at);
}
assert.strictEqual(ledger.verifyAll(db).ok, true, 'whole again');
console.log('ledgerwalk: ok,', n, 'entries in pages of 3');
process.exit(0);
