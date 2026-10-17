// Images: read what the camera wrote, fingerprint the original, and make the sizes we show.
// The original never leaves the vault until a license is granted.
const sharp = require('sharp');
const exifr = require('exifr');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SIZES = { thumb: 600, screen: 1600, large: 2400 };

function cameraName(make, model) {
  const tidy = t => String(t || '').trim().replace(/\b(camera ag|corporation|corp\.?|co\.,? ?ltd\.?|inc\.?)\b/gi, '').replace(/\bLEICA\b/g, 'Leica').replace(/\s+/g, ' ').trim();
  const mk = tidy(make), md = tidy(model);
  if (!mk && !md) return null;
  if (md.toLowerCase().startsWith(mk.toLowerCase())) return md;
  return [mk, md].filter(Boolean).join(' ');
}

async function inspect(file) {
  const buf = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const meta = await sharp(buf).rotate().metadata();
  let exif = {};
  try { exif = (await exifr.parse(buf, { pick: ['Make', 'Model', 'LensModel', 'DateTimeOriginal', 'Artist', 'Copyright'] })) || {}; } catch (e) { exif = {}; }
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
async function derivative(original, cacheDir, slug, size, fmt = 'jpg') {
  const w = SIZES[size];
  if (!w) throw new Error('unknown size');
  if (!FORMATS[fmt]) fmt = 'jpg';
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `${slug}-${size}.${fmt}`);
  if (!fs.existsSync(out)) {
    const tmp = `${out}.${process.pid}.${Date.now()}.tmp`;
    const base = sharp(original).rotate().resize({ width: w, height: w, fit: 'inside', withoutEnlargement: true });
    if (fmt === 'webp') await base.webp({ quality: size === 'thumb' ? 70 : size === 'large' ? 78 : 76, effort: 4 }).toFile(tmp);
    else await base.jpeg({ quality: size === 'thumb' ? 78 : 84, mozjpeg: true }).withMetadata({ exif: { IFD0: { Copyright: 'Held on Watermark. License at the source.' } } }).toFile(tmp);
    try { fs.renameSync(tmp, out); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* already there */ } }
  }
  return out;
}
// The format a request will take: WebP when the browser says so, else JPEG.
function pick(accept) { return /image\/webp/.test(accept || '') ? 'webp' : 'jpg'; }
// Make every size in both formats ahead of the first visitor (one work at a time, in the background).
async function warm(original, cacheDir, slug) {
  for (const size of Object.keys(SIZES)) for (const fmt of Object.keys(FORMATS)) await derivative(original, cacheDir, slug, size, fmt);
}
const warmed = (cacheDir, slug) => Object.keys(SIZES).every(size => Object.keys(FORMATS).every(fmt => fs.existsSync(path.join(cacheDir, `${slug}-${size}.${fmt}`))));

// A visual fingerprint (difference hash, 64 bits): the same frame at any size or quality hashes alike,
// so a full-resolution master can be matched to the web copy already held.
async function dhash(file) {
  const px = await sharp(file).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}
function hamming(a, b) { let v = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0; while (v) { n += Number(v & 1n); v >>= 1n; } return n; }

module.exports = { inspect, derivative, dhash, hamming, SIZES, FORMATS, pick, warm, warmed };
