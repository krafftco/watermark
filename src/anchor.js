// The anchor (Will, 28 Oct: "the open ledger; blockchain's best use"; the register is the house's word, and a word
// needs a clock the house does not own). Every hour the head of the register (the hash of its last entry) is sent to
// OpenTimestamps calendars, which commit it into Bitcoin for nothing: no token, no coin, no account. The proof (.ots)
// is kept and published beside the register, so anyone can prove with the free `ots` client that this head, and so
// every entry under it, existed before the block's time, against a chain Watermark does not run. In public copy the
// word is 'anchored', never blockchain.
//
// Built from the OpenTimestamps serialisation alone (open, documented): the file is the magic, a version, the hash op,
// the digest, then the timestamp (ops: append f0, prepend f1, reverse f2, hexlify f3, sha1 02, ripemd160 03, sha256 08,
// keccak256 67; a fork ff; an attestation 00 + an 8-byte tag + varbytes). A calendar answers POST /digest with the
// timestamp from our digest down to its pending attestation; GET /timestamp/<commitment> later gives the upgrade, and
// the pending leaf is replaced by it. We never need to verify the Bitcoin header ourselves: that is the client's job.
const crypto = require('crypto');

const MAGIC = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');
const TAG_PENDING = '83dfe30d2ef90c8e', TAG_BITCOIN = '0588960d73d71901';
const CALENDARS = (process.env.OTS_CALENDARS || 'https://a.pool.opentimestamps.org,https://b.pool.opentimestamps.org,https://a.pool.eternitywall.com').split(',').map(s => s.trim()).filter(Boolean);
const ANCHOR_EVERY_MIN = Number(process.env.ANCHOR_EVERY_MIN || 60);

// --- a reader, varints and varbytes
const varint = n => { const out = []; while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(n); return Buffer.from(out); };
const varbytes = b => Buffer.concat([varint(b.length), b]);
const rd2 = buf => { let p = 0; const self = {
  byte: () => { if (p >= buf.length) throw new Error('short'); return buf[p++]; },
  varint: () => { let v = 0, s = 0, b; do { b = buf[p++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; },
  bytes: n => { const o = buf.subarray(p, p + n); if (o.length < n) throw new Error('short'); p += n; return Buffer.from(o); },
  varbytes: () => self.bytes(self.varint()), pos: () => p, seek: x => { p = x; }, end: () => p >= buf.length, back: () => { p -= 1; } }; return self; };

function parseTs(r) {
  const node = { ops: [], atts: [] };
  const leaf = () => {
    const tag = r.byte();
    if (tag === 0x00) { const t = r.bytes(8).toString('hex'); node.atts.push({ tag: t, payload: r.varbytes() }); return; }
    const arg = (tag === 0xf0 || tag === 0xf1) ? r.varbytes() : null;
    node.ops.push([tag, arg, parseTs(r)]);
  };
  for (;;) { const t = r.byte(); if (t === 0xff) { leaf(); continue; } r.back(); leaf(); break; }
  return node;
}
function serialize(node) {
  const parts = []; const items = [...node.atts.map(a => ['att', a]), ...node.ops.map(o => ['op', o])];
  items.forEach((it, i) => {
    if (i < items.length - 1) parts.push(Buffer.from([0xff]));
    if (it[0] === 'att') parts.push(Buffer.from([0x00]), Buffer.from(it[1].tag, 'hex'), varbytes(it[1].payload));
    else { const [tag, arg, child] = it[1]; parts.push(Buffer.from([tag])); if (arg) parts.push(varbytes(arg)); parts.push(serialize(child)); }
  });
  return Buffer.concat(parts);
}
function apply(op, arg, msg) {
  switch (op) {
    case 0xf0: return Buffer.concat([msg, arg]);
    case 0xf1: return Buffer.concat([arg, msg]);
    case 0xf2: return Buffer.from(msg).reverse();
    case 0xf3: return Buffer.from(msg.toString('hex'), 'ascii');
    case 0x02: return crypto.createHash('sha1').update(msg).digest();
    case 0x03: return crypto.createHash('ripemd160').update(msg).digest();
    case 0x08: return crypto.createHash('sha256').update(msg).digest();
    default: throw new Error('unknown op ' + op.toString(16));
  }
}
// Walk: every attestation with the commitment it attests to, and the path (node references) to replace a pending one.
function walk(node, msg, out = [], path = []) {
  for (const a of node.atts) out.push({ ...a, msg, node, path });
  for (const [op, arg, child] of node.ops) walk(child, apply(op, arg, msg), out, [...path, [op, arg]]);
  return out;
}
function pendingUri(payload) { const r = rd2(payload); return r.varbytes().toString('utf8'); }
function bitcoinHeight(payload) { return rd2(payload).varint(); }

// --- the file
function otsFile(digest, ts) { return Buffer.concat([MAGIC, varint(1), Buffer.from([0x08]), digest, serialize(ts)]); }
function parseOts(buf) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not an .ots file');
  const r = rd2(buf.subarray(MAGIC.length)); const v = r.varint(); if (v !== 1) throw new Error('version ' + v);
  const op = r.byte(); if (op !== 0x08) throw new Error('digest op ' + op.toString(16)); const digest = r.bytes(32); return { digest, ts: parseTs(r) };
}
function status(ts, digest) {
  const atts = walk(ts, digest); const btc = atts.filter(a => a.tag === TAG_BITCOIN).map(a => bitcoinHeight(a.payload));
  return { bitcoin: btc.length ? Math.min(...btc) : null, pending: atts.filter(a => a.tag === TAG_PENDING).map(a => pendingUri(a.payload)) };
}

function mountAnchor(app, { db, ledger, C, V, studioOnly, fetchImpl = (...a) => fetch(...a), ROLE }) {
  db.exec(`CREATE TABLE IF NOT EXISTS anchors (id INTEGER PRIMARY KEY, seq INTEGER NOT NULL, head TEXT NOT NULL, ots BLOB, calendars TEXT, bitcoin_height INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')), upgraded_at TEXT, note TEXT)`);
  const headOf = () => db.prepare('SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1').get() || null;

  // Anchor the head now: the digest to each calendar; the first good answer makes the file, the others are merged as forks.
  async function anchor({ force } = {}) {
    const h = headOf(); if (!h) return { ok: false, why: 'an empty register' };
    const last = db.prepare('SELECT * FROM anchors ORDER BY id DESC LIMIT 1').get();
    // Nothing new since the last anchor but the anchor's own entries: nothing to anchor (else the clock would wind itself).
    if (last && !force && db.prepare("SELECT COUNT(*) n FROM ledger WHERE seq > ? AND type NOT LIKE 'register.anchored%'").get(last.seq).n === 0) return { ok: true, same: true, seq: last.seq };
    const digest = Buffer.from(h.hash, 'hex'); if (digest.length !== 32) return { ok: false, why: 'the head is not a sha256' };
    const answers = []; let ts = null;
    for (const cal of CALENDARS) {
      try {
        const r = await fetchImpl(cal + '/digest', { method: 'POST', body: digest, signal: AbortSignal.timeout(10000), headers: { accept: 'application/vnd.opentimestamps.v1', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'watermark-anchor' } });
        if (!r.ok) { answers.push(`${cal}: ${r.status}`); continue; }
        const body = Buffer.from(await r.arrayBuffer()); const sub = parseTs(rd2(body));
        if (!ts) ts = sub; else { ts.ops.push(...sub.ops); ts.atts.push(...sub.atts); }
        answers.push(`${cal}: ok`);
      } catch (e) { answers.push(`${cal}: ${String(e.message || e).slice(0, 60)}`); }
    }
    if (!ts) { const r = db.prepare('INSERT INTO anchors (seq, head, calendars, note) VALUES (?,?,?,?)').run(h.seq, h.hash, answers.join('; '), 'no calendar answered'); return { ok: false, why: answers.join('; '), id: r.lastInsertRowid }; }
    const file = otsFile(digest, ts);
    const r = db.prepare('INSERT INTO anchors (seq, head, ots, calendars) VALUES (?,?,?,?)').run(h.seq, h.hash, file, answers.join('; '));
    ledger.append(db, 'register.anchored', String(h.seq), { head: h.hash, calendars: answers.filter(a => /ok$/.test(a)).length }); // hidden: the anchor is of the head before it
    return { ok: true, id: r.lastInsertRowid, seq: h.seq, head: h.hash, bytes: file.length, calendars: answers };
  }
  // Upgrade: every pending attestation is asked for its Bitcoin proof; a complete one replaces the pending leaf.
  async function upgrade(limit = 20) {
    const rows = db.prepare('SELECT * FROM anchors WHERE ots IS NOT NULL AND bitcoin_height IS NULL ORDER BY id LIMIT ?').all(limit); let done = 0;
    for (const a of rows) {
      let f; try { f = parseOts(Buffer.from(a.ots)); } catch (e) { db.prepare('UPDATE anchors SET note=? WHERE id=?').run('unreadable: ' + e.message, a.id); continue; }
      let changed = false;
      for (const att of walk(f.ts, f.digest).filter(x => x.tag === TAG_PENDING)) {
        const uri = pendingUri(att.payload);
        try {
          const r = await fetchImpl(`${uri.replace(/\/$/, '')}/timestamp/${att.msg.toString('hex')}`, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/vnd.opentimestamps.v1', 'user-agent': 'watermark-anchor' } });
          if (!r.ok) continue; // 404: not yet in a block
          const up = parseTs(rd2(Buffer.from(await r.arrayBuffer())));
          if (!walk(up, att.msg).some(x => x.tag === TAG_BITCOIN)) continue;
          att.node.atts = att.node.atts.filter(x => x !== att && !(x.tag === att.tag && x.payload.equals(att.payload))); att.node.ops.push(...up.ops); att.node.atts.push(...up.atts); changed = true;
        } catch (e) { /* the calendar is away; next hour */ }
      }
      if (changed) { const st = status(f.ts, f.digest); db.prepare('UPDATE anchors SET ots=?, bitcoin_height=?, upgraded_at=datetime(\'now\') WHERE id=?').run(otsFile(f.digest, f.ts), st.bitcoin, a.id); if (st.bitcoin) { done++; ledger.append(db, 'register.anchored.bitcoin', String(a.seq), { head: a.head, height: st.bitcoin }); } }
    }
    return done;
  }
  const list = (n = 50) => db.prepare('SELECT id, seq, head, bitcoin_height, at, upgraded_at, calendars, note, (ots IS NOT NULL) has FROM anchors ORDER BY id DESC LIMIT ?').all(n).map(r => ({ ...r, has: !!r.has }));
  const latest = () => { const r = db.prepare('SELECT id, seq, head, bitcoin_height, at FROM anchors WHERE ots IS NOT NULL ORDER BY id DESC LIMIT 1').get(); const b = db.prepare('SELECT id, seq, head, bitcoin_height, at FROM anchors WHERE bitcoin_height IS NOT NULL ORDER BY id DESC LIMIT 1').get(); return { latest: r || null, bitcoin: b || null, count: db.prepare('SELECT COUNT(*) n FROM anchors WHERE ots IS NOT NULL').get().n }; };

  // Public: the anchors beside the register; each proof as a file for the ots client.
  app.get('/ledger/anchors.json', (req, res) => res.json({ house: ledger.publicKey ? ledger.publicKey() : null, register: `${C.base}/ledger.json`, how: 'Each row is the register\'s head (the sha256 of its last entry, seq) sent to OpenTimestamps calendars at `at`; `ots` is the proof file. Verify with the free client: `ots verify <file>.ots` against a Bitcoin node or a public explorer; the digest in the file is the head hash.', anchors: list(200).map(a => ({ ...a, ots: a.has ? `${C.base}/ledger/anchors/${a.id}.ots` : null })) }));
  app.get('/ledger/anchors/:id.ots', (req, res) => { const a = db.prepare('SELECT ots, seq FROM anchors WHERE id=?').get(Number(req.params.id)); if (!a || !a.ots) return res.sendStatus(404); res.set('Cache-Control', 'public, max-age=3600').type('application/octet-stream').set('Content-Disposition', `attachment; filename="watermark-register-${a.seq}.ots"`).send(Buffer.from(a.ots)); });
  // A head's own proof: GET /ledger/anchors/head/:hash.ots gives the newest proof whose anchored head is at or after that entry (any entry under an anchored head is covered by it).
  app.get('/ledger/anchors/seq/:seq.ots', (req, res) => { const a = db.prepare('SELECT ots, seq FROM anchors WHERE ots IS NOT NULL AND seq >= ? ORDER BY CASE WHEN bitcoin_height IS NULL THEN 1 ELSE 0 END, seq ASC LIMIT 1').get(Number(req.params.seq)); if (!a) return res.sendStatus(404); res.type('application/octet-stream').set('Content-Disposition', `attachment; filename="watermark-register-${a.seq}.ots"`).send(Buffer.from(a.ots)); });
  // The Studio: anchor now, upgrade now.
  app.post('/studio/anchor', studioOnly, async (req, res) => { const r = await anchor({ force: true }); res.redirect('/ledger?anchored=' + (r.ok ? 'ok' : encodeURIComponent(r.why || 'no'))); });
  app.post('/studio/anchor/upgrade', studioOnly, async (req, res) => { const n = await upgrade(50); res.redirect('/ledger?upgraded=' + n); });

  if (!app.locals.noTimers && (!ROLE || ROLE.chores) && process.env.ANCHOR !== '0') {
    const tick = async () => { try { await anchor(); await upgrade(); } catch (e) { console.error('[anchor]', e.message); } };
    if (app.locals.governor) app.locals.governor.boot('anchor', tick); else setTimeout(tick, 60e3).unref();
    setInterval(tick, ANCHOR_EVERY_MIN * 60e3).unref();
  }
  app.locals.anchor = { anchor, upgrade, list, latest, status, parseOts, otsFile, CALENDARS };
}

module.exports = { mountAnchor, parseOts, otsFile, status, MAGIC, TAG_PENDING, TAG_BITCOIN, _internal: { parseTs, serialize, walk, rd2, varint, varbytes, apply } };
