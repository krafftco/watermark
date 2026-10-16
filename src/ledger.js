// The ledger: an append-only, hash-chained record of every registration and license.
// Each entry carries the hash of the one before it, so any edit to history breaks the chain.
const crypto = require('crypto');

const GENESIS = '0'.repeat(64);

function digest(e) {
  return crypto.createHash('sha256')
    .update([e.seq, e.at, e.type, e.subject, e.data, e.prev_hash].join('|'))
    .digest('hex');
}

function append(db, type, subject, data) {
  const last = db.prepare('SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1').get();
  const e = {
    seq: last ? last.seq + 1 : 1,
    at: new Date().toISOString(),
    type, subject,
    data: JSON.stringify(data || {}),
    prev_hash: last ? last.hash : GENESIS,
  };
  e.hash = digest(e);
  db.prepare('INSERT INTO ledger (seq, at, type, subject, data, prev_hash, hash) VALUES (@seq,@at,@type,@subject,@data,@prev_hash,@hash)').run(e);
  return e;
}

function verify(db) {
  let prev = GENESIS, n = 0;
  for (const e of db.prepare('SELECT * FROM ledger ORDER BY seq').iterate()) {
    if (e.prev_hash !== prev || digest(e) !== e.hash) return { ok: false, broken_at: e.seq, checked: n };
    prev = e.hash; n++;
  }
  return { ok: true, checked: n, head: prev };
}

module.exports = { append, verify, digest };
