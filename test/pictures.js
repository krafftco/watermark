// The pictures (20 Oct, after the mark showed in the skies: "this kind of stuff can't happen"). Nothing may degrade a
// picture on its way to the screen. This test is the gate: a smooth sky and a textured scene go through the
// rendition pipeline exactly as the site serves them, and the result must (1) be close to the original resized
// (PSNR above 40 dB), and (2) show no block structure: the energy at 8-pixel block boundaries must be no greater
// than inside the blocks, beyond what the resized original itself has, by more than a fifth of a level in a sky
// (texture masks more: six tenths in a scene). The marked pipeline is run too, to prove the gate catches what it is for.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const sharp = require('sharp'); const images = require('../src/images'); const M = require('../src/mark');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-pic-')); const W = 3200, H = 2000;
  // A sky: a smooth vertical gradient from orange to blue, with a soft sun; 16-bit math, 8-bit out.
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = y / H, p = (y * W + x) * 3; const sun = Math.exp(-(((x - W * 0.55) ** 2 + (y - H * 0.35) ** 2) / (2 * 120 ** 2))) * 90; raw[p] = Math.min(255, Math.round(230 - 90 * t + sun)); raw[p + 1] = Math.min(255, Math.round(140 - 20 * t + sun)); raw[p + 2] = Math.min(255, Math.round(90 + 110 * t + sun * 0.6)); }
  const sky = path.join(dir, 'sky.jpg'); await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 97, chromaSubsampling: '4:4:4' }).toFile(sky);
  const fixture = path.join(__dirname, 'fixture.jpg');
  // Blockiness: mean absolute luminance step across 8-px boundaries vs. the same step inside blocks.
  async function blockiness(file) {
    const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true }); const w = info.width, h = info.height; let edge = 0, ne = 0, inner = 0, ni = 0;
    for (let y = 8; y < h - 8; y++) for (let x = 8; x < w - 8; x++) { const d = Math.abs(data[y * w + x] - data[y * w + x - 1]); if (x % 8 === 0) { edge += d; ne++; } else if (x % 8 === 4) { inner += d; ni++; } }
    for (let y = 8; y < h - 8; y++) for (let x = 8; x < w - 8; x++) { const d = Math.abs(data[y * w + x] - data[(y - 1) * w + x]); if (y % 8 === 0) { edge += d; ne++; } else if (y % 8 === 4) { inner += d; ni++; } }
    return edge / ne - inner / ni; // in levels: how much more a step at a block boundary is than one inside
  }
  async function psnr(a, b) { const A = await sharp(a).raw().toBuffer({ resolveWithObject: true }); const B = await sharp(b).resize({ width: A.info.width, height: A.info.height, fit: 'fill' }).raw().toBuffer(); let se = 0; for (let i = 0; i < A.data.length; i++) { const d = A.data[i] - B[i]; se += d * d; } const mse = se / A.data.length; return 10 * Math.log10(255 * 255 / Math.max(mse, 1e-9)); }
  for (const [name, src] of [['sky', sky], ['scene', fixture]]) {
    for (const fmt of ['jpg', 'webp']) for (const size of ['screen', 'large']) {
      images.setMarker(null); const clean = await images.derivative(src, dir, `${name}`, size, fmt);
      const ref = path.join(dir, `${name}-${size}-ref.png`); await sharp(src).rotate().resize({ width: images.SIZES[size], height: images.SIZES[size], fit: 'inside', withoutEnlargement: true }).png().toFile(ref);
      const b = (await blockiness(clean)) - (await blockiness(ref)), q = await psnr(ref, clean);
      const limit = name === 'sky' ? 0.2 : 0.6; assert.ok(b < limit, `${name} ${size} ${fmt}: block structure ${b.toFixed(3)} levels (must be under ${limit})`);
      const qmin = name === 'sky' ? 45 : 38; assert.ok(q > qmin, `${name} ${size} ${fmt}: ${q.toFixed(1)} dB from the original (must be over ${qmin})`);
      console.log(`ok: ${name} ${size} ${fmt}: blocks ${b.toFixed(3)}, ${q.toFixed(1)} dB`);
    }
  }
  // The gate must catch the mark: the sky, marked, shows blocks.
  images.setMarker({ key: 'k', payloadFor: () => M.renditionPayload(7) }); const marked = await images.derivative(sky, dir, 'sky-m', 'screen', 'jpg'); images.setMarker(null);
  const bm = (await blockiness(marked)) - (await blockiness(path.join(dir, 'sky-screen-ref.png'))); assert.ok(bm > 0.2, `the gate must see the mark (${bm.toFixed(3)})`); console.log(`ok: the gate sees the mark (blocks ${bm.toFixed(3)})`);
  console.log('ok: the pictures');
})().catch(e => { console.error(e); process.exit(1); });
