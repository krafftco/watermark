// The judge of a picture (20 Oct). The same measures as test/pictures.js, in the house itself, so conservation can
// hold every display copy to the standard: close to the original resized (PSNR) and with no block structure laid
// into it (the energy at 8-pixel boundaries against the energy inside the blocks, over what the original has).
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Blockiness: mean absolute luminance step across 8-px boundaries vs. the same step inside blocks, in levels.
async function blockiness(input) {
  const { data, info } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true }); const w = info.width, h = info.height; let edge = 0, ne = 0, inner = 0, ni = 0;
  for (let y = 8; y < h - 8; y++) for (let x = 8; x < w - 8; x++) { const d = Math.abs(data[y * w + x] - data[y * w + x - 1]); if (x % 8 === 0) { edge += d; ne++; } else if (x % 8 === 4) { inner += d; ni++; } }
  for (let y = 8; y < h - 8; y++) for (let x = 8; x < w - 8; x++) { const d = Math.abs(data[y * w + x] - data[(y - 1) * w + x]); if (y % 8 === 0) { edge += d; ne++; } else if (y % 8 === 4) { inner += d; ni++; } }
  return edge / ne - inner / ni;
}
async function psnr(refBuf, refInfo, file) {
  const B = await sharp(file).resize({ width: refInfo.width, height: refInfo.height, fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const n = Math.min(refBuf.length, B.data.length); let se = 0; for (let i = 0; i < n; i++) { const d = refBuf[i] - B.data[i]; se += d * d; }
  const mse = se / n; return mse === 0 ? 99 : 10 * Math.log10(255 * 255 / mse);
}
// Texture: how much the original varies inside blocks (a sky is near 0; a scene is several levels); the limits follow it.
const limitsFor = texture => (texture < 1.5 ? { blocks: 0.2, db: 45 } : { blocks: 0.6, db: 38 });

// Judge one display copy against the original at that size. Returns { ok, blocks, db, texture, limits }.
async function judge(original, rendition, width) {
  const ref = await sharp(original).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const refPng = sharp(ref.data, { raw: { width: ref.info.width, height: ref.info.height, channels: ref.info.channels } });
  const refBlocks = await blockiness(await refPng.clone().png().toBuffer());
  // texture: the inner step of the reference alone
  const { data, info } = await refPng.clone().greyscale().raw().toBuffer({ resolveWithObject: true }); let inner = 0, ni = 0;
  for (let y = 8; y < info.height - 8; y++) for (let x = 8; x < info.width - 8; x += 8) { inner += Math.abs(data[y * info.width + x + 4] - data[y * info.width + x + 3]); ni++; }
  const texture = ni ? inner / ni : 0;
  const blocks = (await blockiness(rendition)) - refBlocks;
  const db = await psnr(ref.data, ref.info, rendition);
  const limits = limitsFor(texture);
  // ok is the conservation verdict: far from the original (under the PSNR floor) or a grid as heavy as a mark (2 levels)
  // fails; a mild grid over the gate's limit is a note (`soft`), since a maker's own lower-quality JPEG re-encodes with
  // some of it and that is their file, not damage. The pipeline test (test/pictures.js) keeps the strict limits.
  return { ok: db > limits.db && blocks < 2, soft: blocks >= limits.blocks, blocks: +blocks.toFixed(3), db: +db.toFixed(1), texture: +texture.toFixed(2), limits };
}
// Does the original decode whole? A truncated or broken file fails here.
async function decodes(original) {
  try { const m = await sharp(original, { failOn: 'truncated' }).metadata(); await sharp(original, { failOn: 'truncated' }).raw().toBuffer(); return { ok: true, width: m.width, height: m.height, format: m.format, icc: !!m.icc, space: m.space }; }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
}
const exists = f => { try { return fs.statSync(f).size > 0; } catch (e) { return false; } };
module.exports = { blockiness, psnr, judge, decodes, limitsFor, exists, path };
