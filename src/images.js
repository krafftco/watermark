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

module.exports = { inspect, derivative, SIZES };
