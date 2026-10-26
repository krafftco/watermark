// The raw door: a DNG built by hand (IFD0 with DNGVersion and a CFA 'raw' image, a SubIFD with a JPEG preview, an
// IFD1 thumbnail) is read without a decoder, and its largest preview comes out as a JPEG.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const sharp = require('sharp');
const raw = require('../src/raw');

// A little-endian TIFF writer: ifds = [{ tags: [[tag, type, values]], sub: [ifd] }]; data blobs placed after.
function tiff(ifds) {
  const parts = []; let pos = 8; const entries = []; // placeholders
  const SZ = { 1: 1, 3: 2, 4: 4, 7: 1 };
  const blobs = []; const place = buf => { const at = pos; blobs.push({ at, buf }); pos += buf.length + (buf.length % 2); return at; };
  const layout = []; // [{ at, entries:[{tag,type,count,valueBuf|offsetOfBlob}], next }]
  function writeIfd(def) {
    const tags = def.tags.slice();
    const subAts = (def.sub || []).map(s => writeIfd(s));
    if (subAts.length) tags.push([330, 4, subAts]);
    tags.sort((a, b) => a[0] - b[0]);
    const n = tags.length, at = pos; pos += 2 + n * 12 + 4;
    const rows = tags.map(([tag, type, values]) => {
      const vals = Array.isArray(values) ? values : [values]; const sz = SZ[type] * vals.length;
      const vb = Buffer.alloc(Math.max(sz, 4));
      vals.forEach((v, i) => { if (type === 3) vb.writeUInt16LE(v, i * 2); else if (type === 4) vb.writeUInt32LE(v, i * 4); else vb[i] = v; });
      if (sz <= 4) return { tag, type, count: vals.length, inline: vb.subarray(0, 4) };
      return { tag, type, count: vals.length, off: place(vb.subarray(0, sz)) };
    });
    layout.push({ at, rows, next: 0 }); return at;
  }
  const firstAt = writeIfd(ifds[0]);
  if (ifds[1]) { const a = writeIfd(ifds[1]); layout[0].next = a; }
  const out = Buffer.alloc(pos); out.write('II', 0); out.writeUInt16LE(42, 2); out.writeUInt32LE(firstAt, 4);
  for (const L of layout) {
    out.writeUInt16LE(L.rows.length, L.at);
    L.rows.forEach((r, i) => { const e = L.at + 2 + i * 12; out.writeUInt16LE(r.tag, e); out.writeUInt16LE(r.type, e + 2); out.writeUInt32LE(r.count, e + 4); if (r.inline) r.inline.copy(out, e + 8); else out.writeUInt32LE(r.off, e + 8); });
    out.writeUInt32LE(L.next, L.at + 2 + L.rows.length * 12);
  }
  for (const b of blobs) b.buf.copy(out, b.at);
  return out;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-raw-'));
  const big = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 120, g: 90, b: 60 } } }).jpeg({ quality: 90 }).toBuffer();
  const small = await sharp({ create: { width: 256, height: 171, channels: 3, background: { r: 120, g: 90, b: 60 } } }).jpeg({ quality: 80 }).toBuffer();
  const cfa = Buffer.alloc(64 * 64 * 2, 7);
  // The blobs must be placed by the writer; give each image its own 'strip' tag pointing at a placed blob, so build in two passes.
  const BIG_OFF = 4096, SMALL_OFF = BIG_OFF + big.length + 64, CFA_OFF = SMALL_OFF + small.length + 64;
  const file = tiff([
    { tags: [[254, 4, 0], [256, 4, 64], [257, 4, 64], [258, 3, 16], [259, 3, 1], [262, 3, 32803], [273, 4, CFA_OFF], [277, 3, 1], [279, 4, cfa.length], [50706, 1, [1, 4, 0, 0]]],
      sub: [{ tags: [[254, 4, 1], [256, 4, 2400], [257, 4, 1600], [258, 3, [8, 8, 8]], [259, 3, 7], [262, 3, 6], [273, 4, BIG_OFF], [277, 3, 3], [279, 4, big.length]] }] },
    { tags: [[254, 4, 1], [256, 4, 256], [257, 4, 171], [259, 3, 6], [513, 4, SMALL_OFF], [514, 4, small.length]] }
  ]);
  const whole = Buffer.alloc(CFA_OFF + cfa.length); file.copy(whole, 0); big.copy(whole, BIG_OFF); small.copy(whole, SMALL_OFF); cfa.copy(whole, CFA_OFF);
  const dng = path.join(dir, 'frame.dng'); fs.writeFileSync(dng, whole);
  assert.ok(raw.isDng(dng), 'a DNG by its DNGVersion tag');
  const jpg = path.join(dir, 'plain.jpg'); fs.writeFileSync(jpg, big); assert.ok(!raw.isDng(jpg), 'a JPEG is not');
  const ps = raw.previews(dng); assert.equal(ps.length, 2, 'two previews found: ' + JSON.stringify(ps)); assert.equal(ps[0].width, 2400, 'the largest first');
  const u = raw.unwrap(dng); assert.ok(u && u.jpeg && u.width === 2400, 'the full-size preview comes out');
  const meta = await sharp(u.jpeg).metadata(); assert.equal(meta.width, 2400); assert.equal(meta.format, 'jpeg');
  assert.equal(fs.readFileSync(u.jpeg).length, big.length, 'byte for byte the preview inside');
  const u2 = raw.unwrap(dng, { min: 4000 }); assert.ok(u2 && !u2.jpeg, 'too small a preview is refused');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok: the raw door');
})().catch(e => { console.error(e); process.exit(1); });
