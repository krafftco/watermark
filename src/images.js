// Images: read what the camera wrote, fingerprint the original, and make the sizes we show.
// The original never leaves the vault until a license is granted.
const sharp = require('sharp');
// Launch fix 6.1: libvips keeps a cache of decoded images and runs a thread per core; on a 512 MB instance that
// tipped the process over its limit. One thread and a small cache are plenty for one photograph at a time.
sharp.cache({ memory: 48, files: 0, items: 40 }); sharp.concurrency(1);
const exifr = require('exifr');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SIZES = { thumb: 600, screen: 1600, large: 2400, wall: 3840 }; // wall (20 Oct): for the viewer on screens with more pixels than large; never enlarged beyond the original
const WARM = ['thumb', 'screen', 'large']; // made ahead of the first visitor; wall on demand

function cameraName(make, model) {
  const tidy = t => String(t || '').trim().replace(/\b(camera ag|corporation|corp\.?|co\.,? ?ltd\.?|inc\.?)\b/gi, '').replace(/\bLEICA\b/g, 'Leica').replace(/\s+/g, ' ').trim();
  const mk = tidy(make), md = tidy(model);
  if (!mk && !md) return null;
  if (md.toLowerCase().startsWith(mk.toLowerCase())) return md;
  return [mk, md].filter(Boolean).join(' ');
}

async function inspect(file) {
  // hashed as a stream and read by path, so a sixty-megapixel master never sits in memory twice (20 Oct)
  const sha256 = await new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
  const meta = await sharp(file).rotate().metadata();
  let exif = {};
  try { exif = (await exifr.parse(file, { pick: ['Make', 'Model', 'LensModel', 'DateTimeOriginal', 'Artist', 'Copyright'] })) || {}; } catch (e) { exif = {}; }
  const camera = cameraName(exif.Make, exif.Model);
  const takenAt = exif.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal.toISOString() : null;
  // EXIF orientation: report the displayed size
  const swap = meta.orientation && meta.orientation >= 5;
  return {
    sha256,
    width: swap ? meta.height : meta.width,
    height: swap ? meta.width : meta.height,
    camera, lens: exif.LensModel || null, taken_at: takenAt,
    artist: exif.Artist || null, copyright: exif.Copyright || null,
  };
}

// Display copies are cached on disk; sizes are fixed so nobody can ask for the original by size.
// Each size is kept as JPEG and, when the browser accepts it, WebP (about a third smaller at the same look).
const FORMATS = { jpg: ['jpg', 'image/jpeg'], webp: ['webp', 'image/webp'] };
// The mark on renditions (19 Oct: harder to copy the house): when `marker` is set, every screen and large copy
// carries the invisible mark of mark.js with the work's rendition payload, so a scraped archive traces back.
let marker = null; // { key, payloadFor(slug) } set by the app
const setMarker = m => { marker = m; };
// Quality (20 Oct, after the blocking): screen and large at JPEG 88 / WebP 82-84, which holds a smooth sky; the file
// names carry 'q2' so every rendition made before is rebuilt.
const Q = { jpg: { thumb: 78, screen: 88, large: 90, wall: 90 }, webp: { thumb: 72, screen: 90, large: 92, wall: 92 } };
const fileOf = (cacheDir, slug, size, fmt) => path.join(cacheDir, `${slug}-${size}${marker && size !== 'thumb' ? 'm' : ''}q2.${fmt}`);
async function derivative(original, cacheDir, slug, size, fmt = 'jpg') {
  const w = SIZES[size];
  if (!w) throw new Error('unknown size');
  if (!FORMATS[fmt]) fmt = 'jpg';
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = fileOf(cacheDir, slug, size, fmt);
  if (!fs.existsSync(out)) {
    const tmp = `${out}.${process.pid}.${Date.now()}.tmp`;
    let base = sharp(original).rotate().resize({ width: w, height: w, fit: 'inside', withoutEnlargement: true });
    if (marker && size !== 'thumb') {
      const payload = marker.payloadFor(slug);
      if (payload != null) { const { data, info } = await base.raw().toBuffer({ resolveWithObject: true }); require('./mark').embedRaw(data, info, payload, marker.key); base = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }); }
    }
    if (fmt === 'webp') await base.webp({ quality: Q.webp[size], effort: 4 }).toFile(tmp);
    else await base.jpeg({ quality: Q.jpg[size], mozjpeg: true, chromaSubsampling: size === 'thumb' ? '4:2:0' : '4:4:4' }).withMetadata({ exif: { IFD0: { Copyright: 'Held on Watermark. License at the source.' } } }).toFile(tmp);
    try { fs.renameSync(tmp, out); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* already there */ } }
  }
  return out;
}
// The format a request will take: WebP when the browser says so, else JPEG.
function pick(accept) { return /image\/webp/.test(accept || '') ? 'webp' : 'jpg'; }
// Make every size in both formats ahead of the first visitor (one work at a time, in the background).
async function warm(original, cacheDir, slug) {
  for (const size of WARM) for (const fmt of Object.keys(FORMATS)) await derivative(original, cacheDir, slug, size, fmt);
}
const warmed = (cacheDir, slug) => WARM.every(size => Object.keys(FORMATS).every(fmt => fs.existsSync(fileOf(cacheDir, slug, size, fmt))));

// A visual fingerprint (difference hash, 64 bits): the same frame at any size or quality hashes alike,
// so a full-resolution master can be matched to the web copy already held.
async function dhash(file) {
  const px = await sharp(file).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}
function hamming(a, b) { let v = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0; while (v) { n += Number(v & 1n); v >>= 1n; } return n; }

module.exports = { setMarker, fileOf, inspect, derivative, dhash, hamming, SIZES, FORMATS, pick, warm, warmed };
