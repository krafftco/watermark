// The ledger: an append-only, hash-chained record of every registration and license.
// Each entry carries the hash of the one before it, so any edit to history breaks the chain.
const crypto = require('crypto');

const GENESIS = '0'.repeat(64);

// The house's signature. Every entry's hash is signed with an Ed25519 key derived from the vault key, so
// a copy of the register (ledger.json) can be checked by anyone, anywhere, without asking Watermark:
// the chain proves nothing was changed; the signature proves the house wrote it.
let signer = null;
function setKey(seed) {
  if (!seed) { signer = null; return; }
  const raw = crypto.createHash('sha256').update('watermark-register:' + seed).digest();
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw]);
  const priv = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  signer = { priv, pub };
}
const publicKey = () => (signer ? signer.pub : null);
function sign(hash) { return signer ? crypto.sign(null, Buffer.from(hash, 'hex'), signer.priv).toString('hex') : null; }
function checkSig(hash, sig, pubHex) {
  try { const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pubHex, 'hex')]); return crypto.verify(null, Buffer.from(hash, 'hex'), crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(sig, 'hex')); } catch (e) { return false; }
}

function digest(e) {
  return crypto.createHash('sha256')
    .update([e.seq, e.at, e.type, e.subject, e.data, e.prev_hash].join('|'))
    .digest('hex');
}

const sigReady = new WeakSet();
function ensureSig(db) { if (sigReady.has(db)) return; if (!db.prepare("SELECT 1 FROM pragma_table_info('ledger') WHERE name='sig'").get()) db.exec('ALTER TABLE ledger ADD COLUMN sig TEXT'); sigReady.add(db); }
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
  e.sig = sign(e.hash);
  ensureSig(db);
  db.prepare('INSERT INTO ledger (seq, at, type, subject, data, prev_hash, hash, sig) VALUES (@seq,@at,@type,@subject,@data,@prev_hash,@hash,@sig)').run(e);
  return e;
}

// Verifying the whole chain is linear; a large register would make every status check slow. So the
// verified head is remembered per database, and only entries after it are checked on the next call.
// Any edit to an entry already verified is still caught: the full walk runs once an hour, and the
// smoke test's tamper check runs it directly (verifyAll).
const heads = new WeakMap();
function verifyAll(db) {
  let prev = GENESIS, n = 0;
  for (const e of db.prepare('SELECT * FROM ledger ORDER BY seq').iterate()) {
    if (e.prev_hash !== prev || digest(e) !== e.hash) return { ok: false, broken_at: e.seq, checked: n };
    prev = e.hash; n++;
  }
  return { ok: true, checked: n, head: prev };
}
function verify(db) {
  const h = heads.get(db);
  if (!h || Date.now() - h.at > 60 * 60 * 1000 || !h.ok) { const r = verifyAll(db); heads.set(db, { ...r, at: Date.now(), seq: r.checked }); return r; }
  let prev = h.head, n = h.checked;
  for (const e of db.prepare('SELECT * FROM ledger WHERE seq>? ORDER BY seq').iterate(h.seq)) {
    if (e.prev_hash !== prev || digest(e) !== e.hash) { const r = { ok: false, broken_at: e.seq, checked: n }; heads.set(db, { ...r, at: Date.now(), seq: n, head: prev }); return r; }
    prev = e.hash; n++;
  }
  const r = { ok: true, checked: n, head: prev }; heads.set(db, { ...r, at: Date.now(), seq: n }); return r;
}

module.exports = { append, verify, verifyAll, digest, setKey, publicKey, sign, checkSig, ensureSig };
