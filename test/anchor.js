// The anchor (28 Oct): the register's head into OpenTimestamps, the proof file as the client expects it, the upgrade
// that replaces a pending attestation with Bitcoin's. A fake calendar stands in; the serialisation is the real one.
const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');
const A = require('../src/anchor');
const ledger = require('../src/ledger');
const { parseTs, serialize, walk, rd2, varint, varbytes, apply } = A._internal;

const db = new Database(':memory:');
db.exec(`CREATE TABLE ledger (seq INTEGER PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, subject TEXT NOT NULL, data TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT)`);
ledger.setKey('test-seed');
ledger.append(db, 'work.registered', 'one', {}); ledger.append(db, 'license.granted', 'WM-1', { paid: true });
const head = db.prepare('SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1').get();

// The fake calendar: POST /digest answers append(nonce) → sha256 → pending(uri); GET /timestamp/<commitment> answers,
// after one miss, prepend(x) → sha256 → bitcoin(height 870000).
const uri = 'https://cal.test'; const nonce = crypto.randomBytes(16); const calls = []; let ready = false;
const pendingAtt = Buffer.concat([Buffer.from([0x00]), Buffer.from(A.TAG_PENDING, 'hex'), varbytes(varbytes(Buffer.from(uri)))]);
const fakeFetch = async (u, o) => {
  u = String(u); calls.push(u);
  if (u.endsWith('/digest')) {
    const d = Buffer.from(o.body); assert.equal(d.length, 32, 'the raw digest is posted');
    const body = Buffer.concat([Buffer.from([0xf0]), varbytes(nonce), Buffer.from([0x08]), pendingAtt]);
    return { ok: true, status: 200, arrayBuffer: async () => body };
  }
  const m = u.match(/\/timestamp\/([0-9a-f]{64})$/); assert.ok(m, 'the upgrade asks by the commitment: ' + u);
  const expect = crypto.createHash('sha256').update(Buffer.concat([Buffer.from(head.hash, 'hex'), nonce])).digest('hex'); assert.equal(m[1], expect, 'the commitment is the digest after the calendar\'s ops');
  if (!ready) return { ok: false, status: 404 };
  const body = Buffer.concat([Buffer.from([0xf1]), varbytes(Buffer.from('ab', 'hex')), Buffer.from([0x08]), Buffer.from([0x00]), Buffer.from(A.TAG_BITCOIN, 'hex'), varbytes(varint(870000))]);
  return { ok: true, status: 200, arrayBuffer: async () => body };
};

(async () => {
  const app = express(); app.locals.noTimers = true;
  A.mountAnchor(app, { db, ledger, C: { base: 'http://localhost' }, V: {}, studioOnly: (q, s, n) => n(), fetchImpl: fakeFetch });
  process.env.OTS_CALENDARS = uri; // read at require: the module's CALENDARS already hold the defaults, so point the anchor at the fake
  app.locals.anchor.CALENDARS.splice(0, app.locals.anchor.CALENDARS.length, uri);

  const r = await app.locals.anchor.anchor(); assert.ok(r.ok && r.seq === head.seq && r.head === head.hash, JSON.stringify(r));
  const row = db.prepare('SELECT * FROM anchors WHERE id=?').get(r.id); assert.ok(row.ots && row.bitcoin_height === null, 'pending');
  const f = A.parseOts(Buffer.from(row.ots)); assert.equal(f.digest.toString('hex'), head.hash, 'the file carries the head as its digest');
  assert.ok(Buffer.from(row.ots).subarray(0, A.MAGIC.length).equals(A.MAGIC) && Buffer.from(row.ots)[A.MAGIC.length] === 1 && Buffer.from(row.ots)[A.MAGIC.length + 1] === 0x08, 'magic, version 1, sha256');
  let st = A.status(f.ts, f.digest); assert.deepEqual(st, { bitcoin: null, pending: [uri] });
  assert.equal(serialize(parseTs(rd2(serialize(f.ts)))).toString('hex'), serialize(f.ts).toString('hex'), 'the timestamp round-trips');
  assert.equal((await app.locals.anchor.anchor()).same, true, 'the same head is not anchored twice');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='register.anchored'").get().n, 1);

  assert.equal(await app.locals.anchor.upgrade(), 0, 'not yet in a block'); ready = true;
  assert.equal(await app.locals.anchor.upgrade(), 1, 'upgraded');
  const up = db.prepare('SELECT * FROM anchors WHERE id=?').get(r.id); assert.equal(up.bitcoin_height, 870000);
  const f2 = A.parseOts(Buffer.from(up.ots)); st = A.status(f2.ts, f2.digest); assert.deepEqual(st, { bitcoin: 870000, pending: [] }, 'the pending leaf replaced by Bitcoin\'s: ' + JSON.stringify(st));
  // The chain of ops in the file reproduces the calendar's commitment and then Bitcoin's: walk from the digest.
  const atts = walk(f2.ts, f2.digest); const btc = atts.find(a => a.tag === A.TAG_BITCOIN);
  const expect = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('ab', 'hex'), crypto.createHash('sha256').update(Buffer.concat([f2.digest, nonce])).digest()])).digest();
  assert.ok(btc && btc.msg.equals(expect), 'the Bitcoin attestation commits to the right bytes');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='register.anchored.bitcoin'").get().n, 1);
  // A second anchor after a new entry; the newest proof covering an older entry.
  ledger.append(db, 'work.registered', 'two', {}); const h2 = db.prepare('SELECT seq FROM ledger ORDER BY seq DESC LIMIT 1').get().seq; const r2 = await app.locals.anchor.anchor(); assert.ok(r2.ok && r2.seq === h2, 'the new head: ' + JSON.stringify([r2, h2]));
  const L = app.locals.anchor.latest(); assert.ok(L.count === 2 && L.bitcoin.seq === head.seq && L.latest.seq === h2, JSON.stringify(L));
  // The HTTP doors.
  const srv = app.listen(0); const port = srv.address().port;
  const j = await (await fetch(`http://localhost:${port}/ledger/anchors.json`)).json(); assert.ok(j.anchors.length === 2 && j.anchors[1].ots.endsWith(`/ledger/anchors/${r.id}.ots`), 'listed with the files');
  const o = await fetch(`http://localhost:${port}/ledger/anchors/${r.id}.ots`); assert.ok(o.status === 200 && /\.ots"/.test(o.headers.get('content-disposition')) && Buffer.from(await o.arrayBuffer()).equals(Buffer.from(up.ots)), 'the proof as a file');
  const s1 = await fetch(`http://localhost:${port}/ledger/anchors/seq/1.ots`); assert.ok(s1.status === 200 && s1.headers.get('content-disposition').includes(`register-${head.seq}.ots`), 'an entry under the Bitcoin-anchored head gets that proof: ' + s1.status + ' ' + s1.headers.get('content-disposition'));
  assert.equal((await fetch(`http://localhost:${port}/ledger/anchors/seq/99.ots`)).status, 404);
  srv.close();
  console.log('anchor: the head into the clock, the proof as the client expects it, the upgrade');
})().catch(e => { console.error(e); process.exit(1); });
