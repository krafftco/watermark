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
async function derivative(original, cacheDir, slug, size) {
  const w = SIZES[size];
  if (!w) throw new Error('unknown size');
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `${slug}-${size}.jpg`);
  if (!fs.existsSync(out)) {
    await sharp(original).rotate().resize({ width: w, height: w, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: size === 'thumb' ? 78 : 84, mozjpeg: true })
      .withMetadata({ exif: { IFD0: { Copyright: 'Held on Watermark. License at the source.' } } })
      .toFile(out);
  }
  return out;
}

// A visual fingerprint (difference hash, 64 bits): the same frame at any size or quality hashes alike,
// so a full-resolution master can be matched to the web copy already held.
async function dhash(file) {
  const px = await sharp(file).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}
function hamming(a, b) { let v = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0; while (v) { n += Number(v & 1n); v >>= 1n; } return n; }

module.exports = { inspect, derivative, dhash, hamming, SIZES };
