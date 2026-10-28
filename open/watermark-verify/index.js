#!/usr/bin/env node
// watermark-verify: check a Watermark work without asking Watermark.
//
// Open source, MIT. No dependencies. Reads the papers inside a delivered JPEG (the fingerprint, the number, the
// licence), checks a register (the signed chain at /ledger.json), checks an anchor (the .ots proof of a register's
// head, OpenTimestamps), and opens an archival master (.wmark: the original byte for byte, its papers, the house's
// signature). Everything here is built on public standards: SHA-256, Ed25519, XMP, EXIF, OpenTimestamps, zip.
//
//   const V = require('watermark-verify');
//   V.papers(jpegBuffer)                  → { fingerprint, number, license, accession, register, creator, copyright }
//   V.register(entries, houseKeyHex)      → { ok, checked, head, broken_at, unsigned }
//   V.anchor(otsBuffer, headHex)          → { ok, digest, matches, bitcoin, pending }
//   V.wmark(zipBuffer)                    → { ok, manifest, original: { name, sha256, matches }, signature }
//   node index.js <file> [house key]      the same, from the command line
'use strict';
const crypto = require('crypto');

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const GENESIS = '0'.repeat(64);

// --- The register: each entry's hash is sha256 of seq|at|type|subject|data|prev_hash; each links to the one before;
// each hash is signed with the house's Ed25519 key (hex, 32 bytes; published at /.well-known/did.json and /ledger.json).
function digest(e) { return sha256([e.seq, e.at, e.type, e.subject, typeof e.data === 'string' ? e.data : JSON.stringify(e.data || {}), e.prev_hash].join('|')); }
function checkSig(hashHex, sigHex, pubHex) {
  try { const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pubHex, 'hex')]); return crypto.verify(null, Buffer.from(hashHex, 'hex'), crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(sigHex, 'hex')); } catch (e) { return false; }
}
function register(entries, houseKey) {
  const rows = Array.isArray(entries) ? entries : (entries && entries.entries) || []; const key = houseKey || (entries && entries.house) || null;
  // A whole register starts at the genesis hash and every entry can be recomputed. An extract (the entries for one
  // work, as a .wmark carries them) has gaps and no entry bodies: then only the signatures and the links between
  // consecutive entries are checked, and the answer says so (extract: true).
  const whole = rows.length > 0 && rows[0].prev_hash === GENESIS && rows.every(e => typeof e.data !== 'undefined' && typeof e.subject !== 'undefined');
  let prev = whole ? GENESIS : null, prevSeq = null, n = 0, unsigned = 0;
  for (const e of rows) {
    if (whole && (e.prev_hash !== prev || digest(e) !== e.hash)) return { ok: false, broken_at: e.seq, checked: n, head: prev };
    if (!whole && prevSeq !== null && e.seq === prevSeq + 1 && e.prev_hash !== prev) return { ok: false, broken_at: e.seq, checked: n, head: prev, extract: true };
    if (key) { if (!e.sig || !checkSig(e.hash, e.sig, key)) unsigned++; }
    prev = e.hash; prevSeq = e.seq; n++;
  }
  return { ok: unsigned === 0 && (whole || !!key), checked: n, head: prev, unsigned, signed: !!key, extract: !whole };
}

// --- The papers inside a JPEG: the XMP packet (APP1, http://ns.adobe.com/xap/1.0/) and the EXIF ImageUniqueID.
function papers(buf) {
  const s = buf.toString('latin1'); const out = { fingerprint: null, number: null, license: null, accession: null, register: null, creator: null, copyright: null, c2pa: false };
  const x = (() => { const i = s.indexOf('<x:xmpmeta'); if (i < 0) return ''; const j = s.indexOf('</x:xmpmeta>', i); return j < 0 ? '' : s.slice(i, j + 12); })();
  const get = tag => { const m = x.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1] : null; };
  if (x) {
    out.number = get('wm:number'); out.license = get('wm:license'); out.accession = get('wm:accession'); out.register = get('wm:register'); out.fingerprint = get('wm:sha256') || get('wm:fingerprint');
    out.creator = (x.match(/<dc:creator>[\s\S]*?<rdf:li>([^<]*)<\/rdf:li>/) || [])[1] || null;
    out.copyright = (x.match(/<dc:rights>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/) || [])[1] || null;
    out.webStatement = (x.match(/xmpRights:WebStatement="([^"]*)"/) || x.match(/<xmpRights:WebStatement>([^<]*)</) || [])[1] || null;
  }
  // EXIF ImageUniqueID (tag 0xa420) carries the first 32 hex characters of the original's fingerprint.
  if (!out.fingerprint) { const m = s.match(/[0-9a-f]{32}/g); if (m) { const i = s.indexOf('Exif\0\0'); if (i >= 0) { const near = m.find(h => { const k = s.indexOf(h); return k > i && k < i + 70000; }); if (near) out.fingerprint = near; } } }
  out.c2pa = s.includes('c2pa') || s.includes('jumb');
  out.sha256 = sha256(buf);
  return out;
}

// --- The anchor: an OpenTimestamps file whose digest is a register head. Reads the file, says whether the digest
// matches the head, and whether it stands in Bitcoin yet (and in which block) or is still pending at a calendar.
const MAGIC = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');
const TAG_PENDING = '83dfe30d2ef90c8e', TAG_BITCOIN = '0588960d73d71901';
const rd = buf => { let p = 0; const self = { byte: () => { if (p >= buf.length) throw new Error('short'); return buf[p++]; }, varint: () => { let v = 0, s = 0, b; do { b = buf[p++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; }, bytes: n => { const o = buf.subarray(p, p + n); if (o.length < n) throw new Error('short'); p += n; return Buffer.from(o); }, varbytes: () => self.bytes(self.varint()), back: () => { p -= 1; } }; return self; };
function parseTs(r) {
  const node = { ops: [], atts: [] };
  const leaf = () => { const tag = r.byte(); if (tag === 0x00) { node.atts.push({ tag: r.bytes(8).toString('hex'), payload: r.varbytes() }); return; } const arg = (tag === 0xf0 || tag === 0xf1) ? r.varbytes() : null; node.ops.push([tag, arg, parseTs(r)]); };
  for (;;) { const t = r.byte(); if (t === 0xff) { leaf(); continue; } r.back(); leaf(); break; }
  return node;
}
function apply(op, arg, msg) {
  switch (op) {
    case 0xf0: return Buffer.concat([msg, arg]); case 0xf1: return Buffer.concat([arg, msg]); case 0xf2: return Buffer.from(msg).reverse(); case 0xf3: return Buffer.from(msg.toString('hex'), 'ascii');
    case 0x02: return crypto.createHash('sha1').update(msg).digest(); case 0x03: return crypto.createHash('ripemd160').update(msg).digest(); case 0x08: return crypto.createHash('sha256').update(msg).digest();
    default: throw new Error('unknown op ' + op.toString(16));
  }
}
function walk(node, msg, out = []) { for (const a of node.atts) out.push({ ...a, msg }); for (const [op, arg, child] of node.ops) walk(child, apply(op, arg, msg), out); return out; }
function anchor(buf, headHex) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return { ok: false, why: 'not an OpenTimestamps file' };
  const r = rd(buf.subarray(MAGIC.length)); const v = r.varint(); if (v !== 1) return { ok: false, why: 'version ' + v };
  const op = r.byte(); if (op !== 0x08) return { ok: false, why: 'the digest is not sha256' }; const digestB = r.bytes(32); const ts = parseTs(r);
  const atts = walk(ts, digestB); const btc = atts.filter(a => a.tag === TAG_BITCOIN).map(a => rd(a.payload).varint());
  const pending = atts.filter(a => a.tag === TAG_PENDING).map(a => rd(a.payload).varbytes().toString('utf8'));
  const digest = digestB.toString('hex'); const matches = headHex ? digest === String(headHex).toLowerCase() : null;
  return { ok: matches !== false && (btc.length > 0 || pending.length > 0), digest, matches, bitcoin: btc.length ? Math.min(...btc) : null, pending, note: btc.length ? `Committed in Bitcoin block ${Math.min(...btc)}: the register to this head existed before that block. Confirm the block's Merkle root with any Bitcoin node or explorer (the ots client does this).` : 'Pending at the calendar; not yet in a block.' };
}

// --- The archival master: a stored zip. original/<file>, manifest.json, manifest.sig (Ed25519 over sha256 of the
// manifest's bytes, hex), register.json, certificate.pdf. Read by hand: local file headers, no compression expected.
function zipEntries(buf) {
  const out = []; let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const flags = buf.readUInt16LE(p + 6), method = buf.readUInt16LE(p + 8); let csize = buf.readUInt32LE(p + 18); const nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nlen).toString('utf8'); let start = p + 30 + nlen + xlen;
    if (flags & 8) { // sizes in a data descriptor after the data (archiver writes them so): find the next header or descriptor
      const next = buf.indexOf(Buffer.from('504b0708', 'hex'), start); if (next < 0) break; csize = next - start; out.push({ name, method, data: buf.subarray(start, next) }); p = next + 16; if (buf.readUInt32LE(p - 4) !== 0x04034b50 && buf.readUInt32LE(p) !== 0x04034b50) { /* zip64 descriptor: 24 bytes */ if (p + 8 <= buf.length && buf.readUInt32LE(p + 8) === 0x04034b50) p += 8; } continue;
    }
    out.push({ name, method, data: buf.subarray(start, start + csize) }); p = start + csize;
  }
  return out;
}
function inflate(e) { if (e.method === 0) return Buffer.from(e.data); if (e.method === 8) return require('zlib').inflateRawSync(e.data); throw new Error('compression ' + e.method); }
function wmark(buf, houseKey) {
  const es = zipEntries(buf); const get = n => { const e = es.find(x => x.name === n); return e ? inflate(e) : null; };
  const mj = get('manifest.json'), sig = get('manifest.sig'); if (!mj) return { ok: false, why: 'no manifest.json inside: not a Watermark archive' };
  let m; try { m = JSON.parse(mj.toString()); } catch (e) { return { ok: false, why: 'the manifest cannot be read' }; }
  const key = houseKey || (m.house_key && m.house_key.public) || null;
  const signature = { present: !!sig, ok: !!(sig && key && checkSig(sha256(mj), sig.toString().trim(), key)), key };
  const oe = es.find(x => x.name.startsWith('original/')); const ob = oe ? inflate(oe) : null; const oh = ob ? sha256(ob) : null;
  const original = { name: oe ? oe.name.slice(9) : null, sha256: oh, expected: m.original && m.original.sha256 || null, matches: !!(oh && m.original && oh === m.original.sha256) };
  let reg = null; try { const rj = get('register.json'); if (rj) { const R = JSON.parse(rj.toString()); reg = register(R.entries || [], (R.house && R.house.public) || key); } } catch (e) { reg = { ok: false, why: e.message }; }
  return { ok: signature.ok && original.matches, manifest: m, original, signature, register: reg, note: signature.ok && original.matches ? 'The original inside is the one the papers describe, and the papers are signed by the house whose key is in the manifest. Check that key against the house\'s own: ' + (m.house_key && m.house_key.register || '') : 'Something does not hold; see signature and original.' };
}

module.exports = { papers, register, anchor, wmark, digest, checkSig, sha256 };

if (require.main === module) {
  const fs = require('fs'); const [file, key] = process.argv.slice(2);
  if (!file) { console.log('watermark-verify <file.jpg | ledger.json | anchor.ots | archive.wmark> [house key hex]'); process.exit(2); }
  const buf = fs.readFileSync(file); let out;
  if (/\.ots$/i.test(file)) out = anchor(buf, key);
  else if (/\.wmark$/i.test(file) || buf.readUInt32LE(0) === 0x04034b50) out = wmark(buf, key);
  else if (/\.json$/i.test(file)) out = register(JSON.parse(buf.toString()), key);
  else out = papers(buf);
  console.log(JSON.stringify(out, (k, v) => (k === 'manifest' ? undefined : v), 2));
  process.exit(out && out.ok === false ? 1 : 0);
}
