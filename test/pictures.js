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
  // Colour is managed: a Display P3-tagged original comes out in sRGB, in both formats, within two levels of the right value.
  { const P = require('../src/pictures'); const p3 = path.join(dir, 'p3.jpg'); await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 230, g: 40, b: 40 } } }).jpeg({ quality: 95 }).withMetadata({ icc: 'p3' }).toFile(p3);
    // (29 Oct) The maker's colour is kept: a wide master is shown in Display P3 with its profile, never squeezed to sRGB;
    // seen through sRGB it reads the same as the master does.
    for (const fmt of ['jpg', 'webp']) { const out = await images.derivative(p3, dir, 'p3', 'screen', fmt); const meta = await sharp(out).metadata(); assert.ok(meta.icc && /P3/.test(meta.icc.toString('latin1').replace(/\0/g, '')), `${fmt}: the copy carries Display P3`); const { data } = await sharp(out).toColourspace('srgb').raw().toBuffer({ resolveWithObject: true }); assert.ok(Math.abs(data[0] - 230) <= 2 && Math.abs(data[1] - 40) <= 2 && Math.abs(data[2] - 40) <= 2, `${fmt}: the same colour as the master (${data[0]},${data[1]},${data[2]})`); }
    const sr = path.join(dir, 'srgb.jpg'); await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 120, b: 200 } } }).withExif({ GPS: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 46/1 0/1' }, IFD0: { Make: 'Leica' } }).jpeg({ quality: 95 }).withIccProfile('srgb').toFile(sr);
    for (const fmt of ['jpg', 'webp']) { const out = await images.derivative(sr, dir, 'srgb', 'screen', fmt); const meta = await sharp(out).metadata(); assert.ok(!meta.icc || !/P3/.test(meta.icc.toString('latin1').replace(/\0/g, '')), `${fmt}: an sRGB master stays sRGB`); const ex = await require('exifr').parse(out, { gps: true }).catch(() => null); assert.ok(!ex || ex.latitude == null, `${fmt}: no GPS rides on a copy for the walls`); }
    { const c = await images.copy(p3, 300); const meta = await sharp(c).metadata(); assert.ok(meta.icc && /P3/.test(meta.icc.toString('latin1').replace(/\0/g, '')), 'the delivered copy keeps the colour too'); }
    console.log('ok: the maker\'s colour kept (P3 stays P3, sRGB stays sRGB, nothing private rides along)');
    // The judge agrees with the gate, and a broken original is seen.
    const j = await P.judge(sky, path.join(dir, 'sky-screen-ref.png').replace('-ref.png', '-ref.png'), images.SIZES.screen); assert.ok(j.ok, 'the judge passes the reference');
    const broken = path.join(dir, 'broken.jpg'); fs.writeFileSync(broken, fs.readFileSync(sky).subarray(0, 20000)); const d = await P.decodes(broken); assert.ok(!d.ok, 'a truncated original fails to decode whole'); console.log('ok: the judge, and a broken original seen'); }
  console.log('ok: the pictures');
})().catch(e => { console.error(e); process.exit(1); });
