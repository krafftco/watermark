// The raw door (Will, 26 Oct: the darkroom's negative). A DNG is a TIFF whose main image is the sensor's own data,
// which the house cannot yet develop on the box (no LibRaw); but a DNG exported by Lightroom, Capture One or the
// camera carries one or more JPEG previews, and the full-size preview is the maker's own rendering of the frame.
// So the DNG comes in as the negative, byte for byte, and its largest preview becomes the master the house shows,
// prints and delivers; the darkroom keeps the DNG under negatives/ for the day a true raw develop is on the box.
// Read by hand from the TIFF structure (IFD0, chained IFDs, SubIFDs): no decoder touches the sensor data.
'use strict';
const fs = require('fs');

const T = { SUBFILE: 254, WIDTH: 256, HEIGHT: 257, BPS: 258, COMPRESSION: 259, PHOTOMETRIC: 262, STRIPS: 273, STRIPBYTES: 279, SUBIFDS: 330, JPEGIF: 513, JPEGIFLEN: 514, DNGVERSION: 50706 };
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };

function open(file) {
  let fd; try { fd = fs.openSync(file, 'r'); } catch (e) { return null; } const size = fs.fstatSync(fd).size;
  const head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0);
  const le = head[0] === 0x49 && head[1] === 0x49, be = head[0] === 0x4d && head[1] === 0x4d;
  if (!le && !be) { fs.closeSync(fd); return null; }
  const magic = le ? head.readUInt16LE(2) : head.readUInt16BE(2); if (magic !== 42) { fs.closeSync(fd); return null; }
  const r16 = (b, o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)), r32 = (b, o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const read = (off, n) => { if (off + n > size || off < 0) return null; const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, off); return b; };
  return { fd, size, le, r16, r32, read, first: r32(head, 4), close: () => fs.closeSync(fd) };
}

// One IFD: tags → values (numbers, or arrays), and the next IFD's offset.
function ifd(t, off, depth) {
  if (!off || depth > 6) return null; const nb = t.read(off, 2); if (!nb) return null;
  const n = t.r16(nb, 0); if (n > 500) return null; const b = t.read(off + 2, n * 12 + 4); if (!b) return null;
  const tags = {};
  for (let i = 0; i < n; i++) {
    const e = i * 12, tag = t.r16(b, e), type = t.r16(b, e + 2), count = t.r32(b, e + 4), sz = (SIZES[type] || 1) * count;
    let vb; if (sz <= 4) vb = b.subarray(e + 8, e + 8 + sz); else { vb = t.read(t.r32(b, e + 8), sz); if (!vb) continue; }
    const vals = [];
    for (let k = 0; k < Math.min(count, 64); k++) {
      if (type === 3) vals.push(t.r16(vb, k * 2)); else if (type === 4 || type === 13) vals.push(t.r32(vb, k * 4)); else if (type === 1 || type === 7) vals.push(vb[k]); else if (type === 16) vals.push(Number(t.le ? vb.readBigUInt64LE(k * 8) : vb.readBigUInt64BE(k * 8))); else vals.push(null);
    }
    tags[tag] = count === 1 ? vals[0] : vals;
  }
  return { tags, next: t.r32(b, n * 12) };
}

function walk(t) {
  const out = [], seen = new Set();
  const visit = (off, depth) => {
    if (!off || seen.has(off) || seen.size > 64) return; seen.add(off);
    const d = ifd(t, off, depth); if (!d) return; out.push(d.tags);
    const subs = d.tags[T.SUBIFDS]; (Array.isArray(subs) ? subs : subs != null ? [subs] : []).forEach(s => visit(s, depth + 1));
    if (d.next) visit(d.next, depth);
  };
  visit(t.first, 0); return out;
}

function isDng(file) {
  const t = open(file); if (!t) return false;
  try { const d = ifd(t, t.first, 0); return !!(d && d.tags[T.DNGVERSION] != null); } catch (e) { return false; } finally { t.close(); }
}

// Every JPEG preview in the file (the raw image itself, lossless-JPEG CFA data, is never one): offset, length, width, height.
function previews(file) {
  const t = open(file); if (!t) return []; const out = [];
  try {
    for (const g of walk(t)) {
      const comp = g[T.COMPRESSION], pm = g[T.PHOTOMETRIC], bps = Array.isArray(g[T.BPS]) ? g[T.BPS][0] : g[T.BPS];
      const w = g[T.WIDTH] || 0, h = g[T.HEIGHT] || 0;
      if (g[T.JPEGIF] != null && g[T.JPEGIFLEN]) { out.push({ offset: g[T.JPEGIF], length: g[T.JPEGIFLEN], width: w, height: h }); continue; }
      if ((comp === 7 || comp === 6) && (pm === 6 || pm === 2) && (bps == null || bps === 8)) {
        const so = Array.isArray(g[T.STRIPS]) ? g[T.STRIPS] : [g[T.STRIPS]], sb = Array.isArray(g[T.STRIPBYTES]) ? g[T.STRIPBYTES] : [g[T.STRIPBYTES]];
        if (so.length === 1 && so[0] != null && sb[0]) out.push({ offset: so[0], length: sb[0], width: w, height: h });
      }
    }
    // Only what really begins as a JPEG.
    return out.filter(p => { const b = t.read(p.offset, 3); return b && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; }).sort((a, b) => (b.width * b.height) - (a.width * a.height));
  } catch (e) { return []; } finally { t.close(); }
}

// The largest preview written out as its own JPEG; null when the DNG carries none worth showing.
function unwrap(file, { min = 1600, to = null } = {}) {
  if (!isDng(file)) return null;
  const ps = previews(file); const best = ps[0];
  if (!best || best.width < min) return { dng: file, jpeg: null, previews: ps };
  const out = to || `${file}.preview.jpg`;
  const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(best.length); fs.readSync(fd, b, 0, best.length, best.offset); fs.writeFileSync(out, b); } finally { fs.closeSync(fd); }
  return { dng: file, jpeg: out, width: best.width, height: best.height, previews: ps };
}

const NO_PREVIEW = 'This DNG carries no full-size preview, so the house has nothing to show from it yet. Export it with a full-size JPEG preview (Lightroom: Export → DNG → JPEG Preview: Full Size), or bring the JPEG beside it.';

module.exports = { isDng, previews, unwrap, NO_PREVIEW };
