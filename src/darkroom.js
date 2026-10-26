// The darkroom (Will, 26 Oct: "can we build a photo editor; better than Lightroom; or at least works in a pinch and
// then better later"). A develop room for one work, in the browser: the picture large on the dark wall, the sliders a
// photographer expects (exposure, contrast, whites, blacks, shadows, temperature, tint, saturation, clarity, sharpen,
// vignette; black and white; crop and straighten), before/after on a key. The truth is the server: while a slider
// moves the page approximates with CSS; when it rests the house renders the same recipe with sharp at screen size,
// so what is seen is what will print. The recipe is kept on the work (`develops`). 'Make it the picture' renders the
// recipe on the original at full size (JPEG 100, 4:4:4) and makes that the master through `replaceMaster`, keeping
// the original as the negative (`works.negative_file`, vaulted under negatives/); 'Back to the negative' undoes it.
// Every wall, print and delivery follows the master, as always; the negative is never lost. JPEG, TIFF and PNG today;
// raw later. Highlights (a tone curve) are the next thing: sharp has no curve, and a raw pass is the way.
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SLIDERS = [
  ['exposure', 'Exposure', -3, 3, 0.05], ['contrast', 'Contrast', -100, 100, 1], ['whites', 'Whites', -100, 100, 1], ['blacks', 'Blacks', -100, 100, 1], ['highlights', 'Highlights', -100, 100, 1], ['shadows', 'Shadows', -100, 100, 1],
  ['temp', 'Temperature', -100, 100, 1], ['tint', 'Tint', -100, 100, 1], ['saturation', 'Saturation', -100, 100, 1],
  ['clarity', 'Clarity', 0, 100, 1], ['sharpen', 'Sharpen', 0, 100, 1], ['vignette', 'Vignette', 0, 100, 1],
];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// A recipe, read safely from anything.
function recipeOf(x) {
  let j = x; if (typeof x === 'string') { try { j = JSON.parse(x); } catch (e) { j = {}; } } j = j && typeof j === 'object' ? j : {};
  const r = {}; for (const [k, , a, b] of SLIDERS) { const v = Number(j[k]); r[k] = Number.isFinite(v) ? clamp(v, a, b) : 0; }
  r.bw = !!j.bw; r.rotate = clamp(Number(j.rotate) || 0, -45, 45);
  const c = j.crop && typeof j.crop === 'object' ? { x: clamp(+j.crop.x || 0, 0, 1), y: clamp(+j.crop.y || 0, 0, 1), w: clamp(+j.crop.w || 1, 0.05, 1), h: clamp(+j.crop.h || 1, 0.05, 1) } : null;
  r.crop = c && (c.x > 0 || c.y > 0 || c.w < 1 || c.h < 1) && c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001 ? c : null;
  r.masks = masksOf(j.masks);
  return r;
}
// Local adjustments: up to four masks, a gradient (from a point where it is whole to a point where it is gone) or an
// ellipse (whole at the centre, feathered to its edge), each with its own light and colour; `inv` turns it inside out.
const MASK_ADJ = [['exposure', 'Exposure', -3, 3, 0.05], ['contrast', 'Contrast', -100, 100, 1], ['highlights', 'Highlights', -100, 100, 1], ['shadows', 'Shadows', -100, 100, 1], ['temp', 'Temperature', -100, 100, 1], ['saturation', 'Saturation', -100, 100, 1]];
function masksOf(x) {
  let a = x; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = null; } } if (!Array.isArray(a)) return [];
  const f = v => clamp(Number(v) || 0, 0, 1); const out = [];
  for (const m of a.slice(0, 4)) {
    if (!m || typeof m !== 'object') continue; const g = m.g || {}; const adj = {}; let any = false;
    for (const [k, , lo, hi] of MASK_ADJ) { const v = Number((m.adj || {})[k]); adj[k] = Number.isFinite(v) ? clamp(v, lo, hi) : 0; if (adj[k]) any = true; }
    if (m.kind === 'linear') out.push({ kind: 'linear', g: { x0: f(g.x0), y0: f(g.y0), x1: f(g.x1), y1: f(g.y1) }, inv: !!m.inv, adj, any });
    else if (m.kind === 'radial') out.push({ kind: 'radial', g: { cx: f(g.cx), cy: f(g.cy), rx: clamp(Number(g.rx) || 0.25, 0.01, 1.5), ry: clamp(Number(g.ry) || 0.25, 0.01, 1.5), f: clamp(Number(g.f) || 0.5, 0, 1) }, inv: !!m.inv, adj, any });
  }
  return out;
}
// The weight of a mask at a point of the picture (fractions), 0..1.
function maskAt(m, x, y) {
  let t;
  if (m.kind === 'linear') { const dx = m.g.x1 - m.g.x0, dy = m.g.y1 - m.g.y0; const len = dx * dx + dy * dy; t = len < 1e-9 ? 1 : 1 - clamp(((x - m.g.x0) * dx + (y - m.g.y0) * dy) / len, 0, 1); t = t * t * (3 - 2 * t); }
  else { const dx = (x - m.g.cx) / m.g.rx, dy = (y - m.g.cy) / m.g.ry; const d = Math.sqrt(dx * dx + dy * dy); const inner = 1 - m.g.f; t = d <= inner ? 1 : d >= 1 ? 0 : 1 - (d - inner) / (1 - inner); t = t * t * (3 - 2 * t); }
  return m.inv ? 1 - t : t;
}
const isFlat = r => SLIDERS.every(([k]) => !r[k]) && !r.bw && !r.rotate && !r.crop && !(r.masks || []).some(m => m.any);
// The largest upright rectangle inside a rotated picture (so a straightened picture shows no wedges).
function innerRect(W, H, deg) {
  const a = Math.abs(deg) * Math.PI / 180; if (!a) return { left: 0, top: 0, width: W, height: H };
  const s = Math.sin(a), c = Math.cos(a); const long = Math.max(W, H), short = Math.min(W, H);
  const half = short <= 2 * s * c * long; let w, h;
  if (half) { const x = 0.5 * short; w = W >= H ? x / s : x / c; h = W >= H ? x / c : x / s; } else { const cos2 = c * c - s * s; w = (W * c - H * s) / cos2; h = (H * c - W * s) / cos2; }
  const RW = Math.round(W * c + H * s), RH = Math.round(W * s + H * c);
  return { left: Math.max(0, Math.round((RW - w) / 2)), top: Math.max(0, Math.round((RH - h) / 2)), width: Math.max(1, Math.floor(w)), height: Math.max(1, Math.floor(h)) };
}
// Dimensions as they stand after auto-rotation: metadata() reports the file's own, before the EXIF turn.
const upright = m => (m.orientation >= 5 ? { W: m.height, H: m.width } : { W: m.width, H: m.height });
// The tone curve: highlights and shadows as a lookup table, the way a curve does it (sharp has no curve, so the pixels
// take one pass through JavaScript). Highlights act on the bright half with a soft edge (negative recovers, positive opens, as
// a photographer expects), shadows on the dark half (lifted or deepened); the middle is left alone and the ends never cross.
function lut(r) {
  if (!r.highlights && !r.shadows) return null;
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255; let y = x;
    if (r.highlights) { const w = sm(0.3, 0.95, x); y += (r.highlights / 100) * 0.42 * w * (x - 0.3); }
    if (r.shadows) { const w = 1 - sm(0.05, 0.7, x); y += (r.shadows / 100) * 0.42 * w * (0.7 - x); }
    t[i] = Math.max(0, Math.min(255, Math.round(y * 255)));
  }
  for (let i = 1; i < 256; i++) if (t[i] < t[i - 1]) t[i] = t[i - 1]; // never crossing
  return t;
}
// One pass through the pixels in JavaScript (sharp has no curve and no mask): `fn(data, info, top)` works on a band of
// rows, async, in place. Small pictures in one pass; big masters in bands through temp files and joined back, so a
// sixty-megapixel file never sits raw in memory twice. The caller removes `pipeline.tmp` when it is done.
async function rawPass(pipeline, fn, { bandMP = 10, tmpDir = require('os').tmpdir() } = {}) {
  const meta = await pipeline.clone().metadata(); const { W, H } = upright(meta); const mp = W * H / 1e6;
  const pass = async (pl, top) => { const { data, info } = await pl.raw().toBuffer({ resolveWithObject: true }); await fn(data, info, top, W, H); return { data, info }; };
  if (mp <= bandMP) { const { data, info } = await pass(pipeline, 0); return sharp(data, { raw: info, limitInputPixels: false }); }
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; const tmp = [];
  const base = path.join(tmpDir, `dkr-base-${stamp}.png`); await pipeline.png({ compressionLevel: 0 }).toFile(base); tmp.push(base);
  const rows = Math.max(64, Math.floor(bandMP * 1e6 / W)); const parts = [];
  for (let top = 0; top < H; top += rows) { const h = Math.min(rows, H - top); const { data, info } = await pass(sharp(base, { limitInputPixels: false }).extract({ left: 0, top, width: W, height: h }), top); const f = path.join(tmpDir, `dkr-band-${stamp}-${parts.length}.png`); await sharp(data, { raw: info, limitInputPixels: false }).png({ compressionLevel: 0 }).toFile(f); parts.push(f); tmp.push(f); }
  const joined = path.join(tmpDir, `dkr-join-${stamp}.png`); await sharp(parts, { join: { across: 1 }, limitInputPixels: false }).png({ compressionLevel: 0 }).toFile(joined); tmp.push(joined);
  const out = sharp(joined, { limitInputPixels: false }); out.tmp = tmp; return out;
}
const curved = (pipeline, table, opts) => rawPass(pipeline, async (data) => { for (let i = 0; i < data.length; i++) data[i] = table[data[i]]; }, opts);
// A mask's own adjustment, rendered on a band of the picture as it stands, then blended in by the mask's weight.
async function localAdj(data, info, adj) {
  let p = sharp(data, { raw: info, limitInputPixels: false }); let a = 1, b = 0; const comp = (a2, b2) => { b = a2 * b + b2; a = a2 * a; };
  if (adj.exposure) comp(Math.pow(2, adj.exposure), 0);
  if (adj.contrast) { const f = 1 + adj.contrast / 100 * (adj.contrast > 0 ? 1 : 0.6); comp(f, 128 * (1 - f)); }
  if (a !== 1 || b !== 0) p = p.linear(a, b);
  if (adj.temp) { const t = adj.temp / 250; p = p.recomb([[1 + t, 0, 0], [0, 1, 0], [0, 0, 1 - t]]); }
  if (adj.saturation) p = p.modulate({ saturation: Math.max(0, 1 + adj.saturation / 100) });
  const out = await p.raw().toBuffer(); const table = lut(adj); if (table) for (let i = 0; i < out.length; i++) out[i] = table[out[i]];
  return out;
}
const masked = (pipeline, masks, opts) => rawPass(pipeline, async (data, info, top, W, H) => {
  const ch = info.channels, w = info.width, h = info.height;
  for (const m of masks) {
    if (!m.any) continue; const adj = await localAdj(data, info, m.adj); const wt = new Float32Array(w);
    for (let y = 0; y < h; y++) {
      const fy = (top + y + 0.5) / H; let i = y * w * ch; let skip = true;
      for (let x = 0; x < w; x++) { const t = maskAt(m, (x + 0.5) / W, fy); wt[x] = t; if (t > 0.002) skip = false; }
      if (skip) continue;
      for (let x = 0; x < w; x++, i += ch) { const t = wt[x]; if (t <= 0.002) continue; for (let c = 0; c < ch && c < 3; c++) { const o = i + c; data[o] = Math.round(data[o] + (adj[o] - data[o]) * t); } }
    }
  }
}, opts);
// The recipe applied to a sharp pipeline. sharp runs its operations in a fixed order and keeps one `linear`, so the
// tone sliders are composed into one affine map (y = a·x + b) before they are set.
async function apply(input, r, { width = null } = {}) {
  let p = sharp(input, { failOn: 'none', limitInputPixels: false }).rotate(); const meta = await p.metadata();
  let { W, H } = upright(meta);
  if (r.rotate) { p = p.rotate(r.rotate, { background: '#000' }); const ir = innerRect(W, H, r.rotate); p = p.extract(ir); W = ir.width; H = ir.height; }
  if (r.crop) { const e = { left: Math.round(r.crop.x * W), top: Math.round(r.crop.y * H), width: Math.max(1, Math.round(r.crop.w * W)), height: Math.max(1, Math.round(r.crop.h * H)) }; e.width = Math.min(e.width, W - e.left); e.height = Math.min(e.height, H - e.top); p = p.extract(e); W = e.width; H = e.height; }
  if (width && width < W) { p = p.resize({ width, withoutEnlargement: true, kernel: 'lanczos3' }); H = Math.round(H * width / W); W = width; }
  // Tone: exposure (a gain), contrast (about the middle), whites (gain on the top), blacks (an offset at the bottom).
  let a = 1, b = 0; const comp = (a2, b2) => { b = a2 * b + b2; a = a2 * a; };
  if (r.exposure) comp(Math.pow(2, r.exposure), 0);
  if (r.contrast) { const f = 1 + r.contrast / 100 * (r.contrast > 0 ? 1 : 0.6); comp(f, 128 * (1 - f)); }
  if (r.whites) comp(1 + r.whites / 300, 0);
  if (r.blacks) comp(1, r.blacks * 0.35);
  if (a !== 1 || b !== 0) p = p.linear(a, b);
  if (r.temp || r.tint) { const t = r.temp / 250, g = r.tint / 300; p = p.recomb([[1 + t, 0, 0], [0, 1 + g, 0], [0, 0, 1 - t]]); }
  if (r.bw) p = p.greyscale();
  else if (r.saturation) p = p.modulate({ saturation: Math.max(0, 1 + r.saturation / 100) });
  const tmpDir = process.env.DKR_TMP || require('os').tmpdir(); let tmp = [];
  const table = lut(r); if (table) { p = await curved(p, table, { tmpDir }); tmp = tmp.concat(p.tmp || []); }
  const masks = (r.masks || []).filter(m => m.any); if (masks.length) { p = await masked(p, masks, { tmpDir }); tmp = tmp.concat(p.tmp || []); }
  if (r.clarity) p = p.sharpen({ sigma: 3, m1: 0, m2: r.clarity / 40 }); // local contrast: a wide, mild unsharp mask
  if (r.sharpen) p = p.sharpen({ sigma: 0.9, m1: r.sharpen / 60, m2: r.sharpen / 40 });
  if (r.vignette) { const o = (r.vignette / 100 * 0.85).toFixed(3); const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="50%" cy="50%" r="72%"><stop offset="45%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${o}"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`); p = p.composite([{ input: svg, blend: 'multiply' }]); }
  p.tmp = tmp; return p;
}
// The house's looks (drafts, tuned by eye): a recipe in a word.
const LOOKS = [
  ['film', 'Film', { contrast: 12, blacks: -8, highlights: -10, shadows: 8, saturation: 6, temp: 4, clarity: 8 }],
  ['rich', 'Rich', { contrast: 22, blacks: -14, highlights: -18, shadows: 6, saturation: 14, clarity: 14, vignette: 18 }],
  ['soft', 'Soft', { contrast: -12, highlights: -25, shadows: 18, saturation: -8, clarity: 0 }],
  ['portrait', 'Portrait', { contrast: 6, highlights: -14, shadows: 12, temp: 6, tint: 2, saturation: -4, clarity: 4, vignette: 14 }],
  ['landscape', 'Landscape', { contrast: 16, highlights: -22, shadows: 10, whites: 8, saturation: 12, clarity: 18, sharpen: 20 }],
  ['silver', 'Silver', { bw: true, contrast: 18, blacks: -10, highlights: -8, shadows: 10, clarity: 12, sharpen: 10 }],
  ['platinum', 'Platinum', { bw: true, contrast: 8, highlights: -20, shadows: 16, clarity: 6 }],
  ['noir', 'Noir', { bw: true, contrast: 34, blacks: -24, highlights: -10, shadows: -10, clarity: 16, vignette: 36 }],
];
const sweepTmp = p => { for (const f of (p && p.tmp) || []) { try { fs.unlinkSync(f); } catch (e) { /* gone */ } } };

function mountDarkroom(app, { db, V, C, store, images, ledger, originalPath, replaceMaster, makerOf, isStudio, studioOnly }) {
  db.exec('CREATE TABLE IF NOT EXISTS develops (work_id INTEGER PRIMARY KEY, recipe TEXT NOT NULL, by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')), applied_at TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS develop_looks (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, recipe TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const looksOf = who => db.prepare('SELECT id, name, recipe FROM develop_looks WHERE owner=? ORDER BY name').all(who).map(l => ({ ...l, recipe: recipeOf(l.recipe) }));
  try { db.exec('ALTER TABLE works ADD COLUMN negative_file TEXT'); } catch (e) { /* has it */ }
  const cache = path.join(C.dataDir, 'cache'); fs.mkdirSync(cache, { recursive: true });
  const originals = path.join(C.dataDir, 'originals');
  const own = (req, w) => { if (!w) return null; if (isStudio(req)) return { who: 'studio' }; const m = makerOf(req); return m && m.id === w.maker_id ? { who: m.handle } : null; };
  const workOf = slug => db.prepare('SELECT * FROM works WHERE slug=?').get(String(slug));
  const current = w => { const d = db.prepare('SELECT * FROM develops WHERE work_id=?').get(w.id); return d ? { ...d, recipe: recipeOf(d.recipe) } : null; };
  // The working copy: the original at 1600 px, made once, the base every preview is rendered from.
  async function base(w) {
    const f = path.join(cache, `${w.slug}-dkr-${String(w.sha256).slice(0, 8)}.jpg`);
    if (!fs.existsSync(f)) { const src = await originalPath(w); const tmp = `${f}.${process.pid}.tmp`; await sharp(src, { failOn: 'none', limitInputPixels: false }).rotate().resize({ width: 1600, withoutEnlargement: true, kernel: 'lanczos3' }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(tmp); fs.renameSync(tmp, f); }
    return f;
  }

  const page = (w, d, who) => {
    const r = d ? d.recipe : recipeOf({});
    const mine = looksOf(who); const chip = (id, name, rec, own) => `<button type="button" class="dkr-look${own ? ' dkr-look-m' : ''}" data-dkr-look="${esc(JSON.stringify(rec))}"${own ? ` data-dkr-lookid="${id}"` : ''} title="${own ? 'Your look' : 'A look of the house'}">${esc(name)}</button>`;
    const looks = `<h3>Looks</h3><div class="dkr-looks">${LOOKS.map(([k, n, rec]) => chip(k, n, recipeOf(rec), false)).join('')}${mine.map(l => chip(l.id, l.name, l.recipe, true)).join('')}</div><p class="dkr-lookf"><input name="look_name" maxlength="40" placeholder="Name this recipe" aria-label="A name for this recipe as a look"><button name="do" value="look" type="submit">Keep as a look</button>${mine.length ? `<button type="button" data-dkr-unlook hidden>Forget this look</button>` : ''}</p>`;
    const masks = `<h3>Masks</h3><p class="dkr-mline"><button type="button" data-dkr-mask="linear">A gradient</button><button type="button" data-dkr-mask="radial">A circle</button><small>Light and colour for one part of the picture: draw it on the picture, then set its own sliders.</small></p><div class="dkr-masks" data-dkr-masklist></div><input type="hidden" name="masks" value="${esc(JSON.stringify(r.masks || []))}"><template data-dkr-masktpl>${MASK_ADJ.map(([k, label, a, b, step]) => `<label class="dkr-s"><span>${label}</span><input type="range" data-mk="${k}" min="${a}" max="${b}" step="${step}" value="0"><output>0</output></label>`).join('')}</template>`;
    const row = ([k, label, a, b, step]) => `<label class="dkr-s"><span>${label}</span><input type="range" name="${k}" min="${a}" max="${b}" step="${step}" value="${r[k]}" data-dkr><output>${r[k]}</output></label>`;
    return V.layout({ title: `${V.tidy(w.title)} · the darkroom · Watermark`, path: `/account/develop/${w.slug}`, studio: true, bare: true, body: `<main class="dkr" data-dkr-room data-slug="${esc(w.slug)}" data-base="/account/develop/${esc(w.slug)}">
<header class="dkr-bar"><a class="dkr-back" href="${who === 'studio' ? '/studio/works/' : '/account/works/'}${esc(w.slug)}">← The record</a><b>${esc(V.tidy(w.title))}</b><span class="dkr-say" data-dkr-say>${d ? (d.applied_at ? 'Developed, and the picture.' : 'A recipe saved, not yet the picture.') : 'The negative, untouched.'}</span><span class="dkr-keys">B before · R reset · Esc</span></header>
<div class="dkr-wall"><figure class="dkr-fig"><img src="/account/develop/${esc(w.slug)}/preview?r=${encodeURIComponent(JSON.stringify(r))}" alt="" data-dkr-img draggable="false"><img src="/account/develop/${esc(w.slug)}/preview?r=%7B%7D" alt="" data-dkr-before hidden><div class="dkr-crop" data-dkr-crop hidden></div><svg class="dkr-mk" data-dkr-mk hidden></svg></figure></div>
<aside class="dkr-panel"><form method="post" action="/account/develop/${esc(w.slug)}" data-dkr-form>
<canvas class="dkr-hist" data-dkr-hist width="256" height="72"></canvas><p class="dkr-clip" data-dkr-clip></p>${looks}<h3>Light</h3>${SLIDERS.slice(0, 6).map(row).join('')}<h3>Colour</h3>${SLIDERS.slice(6, 9).map(row).join('')}<label class="dkr-ck"><input type="checkbox" name="bw" value="1"${r.bw ? ' checked' : ''} data-dkr> Black and white</label>
<h3>Detail</h3>${SLIDERS.slice(9).map(row).join('')}
${masks}
<h3>Frame</h3><label class="dkr-s"><span>Straighten</span><input type="range" name="rotate" min="-45" max="45" step="0.1" value="${r.rotate}" data-dkr><output>${r.rotate}</output></label>
<p class="dkr-cropline"><button type="button" data-dkr-cropstart>${r.crop ? 'Crop again' : 'Crop'}</button> <button type="button" data-dkr-cropclear${r.crop ? '' : ' hidden'}>Uncrop</button><input type="hidden" name="crop" value="${esc(r.crop ? JSON.stringify(r.crop) : '')}"></p>
<div class="dkr-acts"><button class="buy-btn" name="do" value="save">Save the recipe</button><button name="do" value="apply" class="dkr-apply" data-dkr-apply>Make it the picture</button>${w.negative_file ? `<button name="do" value="negative" class="dkr-neg">Back to the negative</button>` : ''}<button type="button" data-dkr-reset>Reset</button></div>
<p class="dkr-fine">What you see is rendered by the house from the original with this recipe, so it is what will print. 'Make it the picture' renders it at full size (JPEG 100) and makes it the master the walls, prints and deliveries use; the original is kept as the negative and can be put back. Highlights and shadows are a true curve, and a mask's light is rendered by the house pixel by pixel; nothing is a CSS trick when it rests.</p></form></aside>
<script src="/static/darkroom.js?v=${esc(V.VER)}" defer></script></main>` });
  };

  app.get('/account/develop/:slug', async (req, res) => {
    const w = workOf(req.params.slug); const o = own(req, w); if (!w) return res.sendStatus(404); if (!o) return res.sendStatus(403);
    res.set('Cache-Control', 'private, no-store').send(page(w, current(w), o.who));
  });
  // The preview: the recipe on the working copy, rendered by the house. Cached by recipe for a minute.
  const previews = new Map();
  app.get('/account/develop/:slug/preview', async (req, res) => {
    const w = workOf(req.params.slug); const o = own(req, w); if (!w) return res.sendStatus(404); if (!o) return res.sendStatus(403);
    const r = recipeOf(req.query.r); const key = `${w.slug}:${w.sha256}:${JSON.stringify(r)}`;
    try {
      let buf = previews.get(key); if (!buf) { const p = await apply(await base(w), r, { width: 1600 }); buf = await p.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer(); sweepTmp(p); previews.set(key, buf); if (previews.size > 60) previews.delete(previews.keys().next().value); }
      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=60' }).send(buf);
    } catch (e) { console.error('[darkroom]', e.message); res.sendStatus(500); }
  });
  app.post('/account/develop/:slug', async (req, res) => {
    const w = workOf(req.params.slug); const o = own(req, w); if (!w) return res.sendStatus(404); if (!o) return res.sendStatus(403);
    const b = req.body || {}; const d = String(b.do || 'save'); const json = req.query.json === '1' || b.json === '1';
    const answer = (ok, say, extra = {}) => json ? res.json({ ok, say, ...extra }) : res.redirect(`/account/develop/${w.slug}?ok=${encodeURIComponent(say)}`);
    if (d === 'negative') {
      if (!w.negative_file) return answer(false, 'There is no negative kept for this work.');
      try {
        let src = path.join(originals, w.negative_file); if (!fs.existsSync(src)) { const buf = await store.get('negatives/' + w.negative_file); if (!buf) return answer(false, 'The negative could not be fetched from the vault.'); fs.writeFileSync(src, buf); }
        const tmp = path.join(cache, `${w.slug}-neg-${Date.now()}${path.extname(w.negative_file)}`); fs.copyFileSync(src, tmp);
        const info = await images.inspect(tmp), h = await images.dhash(tmp);
        await replaceMaster(w, { path: tmp, originalname: w.negative_file }, info, h);
        db.prepare('UPDATE develops SET applied_at=NULL WHERE work_id=?').run(w.id);
        try { ledger.append(db, 'work.undeveloped', w.slug, { by: o.who, hidden: true }); } catch (e) { /* */ }
        return answer(true, 'The negative is the picture again.');
      } catch (e) { console.error('[darkroom]', e.message); return answer(false, 'The negative could not be put back: ' + e.message); }
    }
    let r; try { r = recipeOf({ ...b, crop: b.crop ? JSON.parse(b.crop) : null, masks: b.masks || [], bw: b.bw === '1' || b.bw === true || b.bw === 'on' }); } catch (e) { r = recipeOf(b); }
    if (d === 'unlook') { db.prepare('DELETE FROM develop_looks WHERE id=? AND owner=?').run(Number(b.look_id), o.who); return answer(true, 'The look is forgotten.'); }
    if (d === 'look') {
      const name = String(b.look_name || '').trim().slice(0, 40); if (!name) return answer(false, 'A name for the look.'); if (isFlat(r)) return answer(false, 'A flat recipe is no look.');
      const keep = { ...r, crop: null, rotate: 0, masks: [] }; // a look is light and colour, never this picture's frame
      const had = db.prepare('SELECT id FROM develop_looks WHERE owner=? AND name=?').get(o.who, name);
      if (had) db.prepare('UPDATE develop_looks SET recipe=? WHERE id=?').run(JSON.stringify(keep), had.id); else db.prepare('INSERT INTO develop_looks (owner, name, recipe) VALUES (?,?,?)').run(o.who, name, JSON.stringify(keep));
      return answer(true, `Kept as the look ‘${name}’.`, { looks: looksOf(o.who) });
    }
    db.prepare("INSERT INTO develops (work_id, recipe, by, updated_at) VALUES (?,?,?, datetime('now')) ON CONFLICT(work_id) DO UPDATE SET recipe=excluded.recipe, by=excluded.by, updated_at=excluded.updated_at").run(w.id, JSON.stringify(r), o.who);
    if (d !== 'apply') return answer(true, 'The recipe is saved.');
    if (isFlat(r)) return answer(false, 'Nothing to develop: the recipe is flat.');
    try {
      const src = await originalPath(w); const ext = path.extname(w.original_file).toLowerCase() || '.jpg';
      // The negative, kept once: the original as it was before any development.
      if (!w.negative_file) { const neg = `${w.slug}-negative-${String(w.sha256).slice(0, 10)}${ext}`; const np = path.join(originals, neg); fs.copyFileSync(src, np); await store.put('negatives/' + neg, np, /\.png$/.test(ext) ? 'image/png' : /\.tiff?$/.test(ext) ? 'image/tiff' : 'image/jpeg'); db.prepare('UPDATE works SET negative_file=? WHERE id=?').run(neg, w.id); }
      const out = path.join(cache, `${w.slug}-developed-${Date.now()}.jpg`);
      const p = await apply(src, r); await p.withMetadata().jpeg({ quality: 100, chromaSubsampling: '4:4:4', mozjpeg: false }).toFile(out); sweepTmp(p);
      const info = await images.inspect(out), h = await images.dhash(out);
      await replaceMaster(db.prepare('SELECT * FROM works WHERE id=?').get(w.id), { path: out, originalname: `${w.slug}-developed.jpg` }, info, h);
      db.prepare("UPDATE develops SET applied_at=datetime('now') WHERE work_id=?").run(w.id);
      try { ledger.append(db, 'work.developed', w.slug, { by: o.who, recipe: r, hidden: true }); } catch (e) { /* */ }
      return answer(true, 'Developed. It is the picture now; the negative is kept.');
    } catch (e) { console.error('[darkroom]', e.message); return answer(false, 'It could not be developed: ' + e.message); }
  });
  const door = (w, base) => `<p class="dkr-door"><a class="buy-btn" href="/account/develop/${esc(w.slug)}">Develop it</a><small>The darkroom: exposure, contrast, colour, crop and straighten, rendered by the house from the original; the negative kept.${w.negative_file ? ' Developed.' : ''}</small></p>`;
  app.locals.darkroom = { recipeOf, apply, isFlat, innerRect, door, current, SLIDERS, MASK_ADJ, LOOKS, lut, maskAt, looksOf };
  return app.locals.darkroom;
}
module.exports = { mountDarkroom, recipeOf, apply, isFlat, innerRect, SLIDERS, MASK_ADJ, lut, curved, rawPass, masked, maskAt, sweepTmp, LOOKS };
