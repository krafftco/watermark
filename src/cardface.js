// The face of a story or a post card (#210, 22 Nov: the first guest's story, seen on a phone). One drawing for the
// album's cards (deliveries.js) and the work's own (postit.js): the picture whole on the dark, the lines beneath it,
// the house's logo (its own paths, not the word typed) at the foot. A story keeps every mark between y=250 and y=1590,
// clear of Instagram's name bar and its reply bar; a post keeps 60 px of dark on every side. Drawn into the card only,
// never into a served picture.
const fs = require('fs'); const path = require('path');

const BG = '#0b0a09', MARK = '#a39d92';
const LOGO_W = 84.7023, LOGO_H = 22.295;
let paths = null; const drawn = new Map();
const logoPaths = () => {
  if (paths == null) {
    const s = fs.readFileSync(path.join(__dirname, '..', 'public', 'watermark-logo.svg'), 'utf8');
    paths = (s.match(/<path\b[^>]*\/>/g) || []).map(p => p.replace(/\s(id|class|style|fill)="[^"]*"/g, '')).join('');
  }
  return paths;
};
// The logo at (x, y), w wide, in the card's quiet grey.
const logo = (x, y, w, fill = MARK) => `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(w / LOGO_W).toFixed(5)})" fill="${fill}">${logoPaths()}</g>`;

// makers.instagram is kept bare (accounts.js strips the @ and anything Instagram does not allow); said with the @.
const igOf = v => { const h = String(v || '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30); return h ? `@${h}` : ''; };

const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Long words are cut, never run off the card.
const fit = (t, n) => { t = String(t || ''); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t; };

const SERIF = "Georgia, 'Times New Roman', serif", SANS = 'Helvetica, Arial, sans-serif';
// The frame each kind keeps: where marks may stand (the band), and the picture's widest box.
const FRAME = {
  story: { W: 1080, H: 1920, top: 290, bottom: 1556, boxW: 940 }, // Instagram covers 0–249 and 1591–1919
  post: { W: 1080, H: 1350, top: 84, bottom: 1270, boxW: 940 } // 60 px of dark on every side, and some air
};
const LOGO_PX = 210, LOGO_GAP = 66; // the logo's width; the air between the last line and the logo

// lines: [{ t, size, serif, italic, fill, gap, caps }] — gap is the baseline's distance from the line (or picture) above.
// foot: one small line under the logo (the work's address), or none.
function layout(kind, lines, foot) {
  const F = FRAME[kind]; const lh = LOGO_PX * LOGO_H / LOGO_W;
  const footY = F.bottom; const logoTop = foot ? footY - 20 - 24 - lh : F.bottom - lh;
  const areaBot = logoTop - LOGO_GAP;
  const textH = lines.reduce((a, l) => a + l.gap, 0) + 10; // the last line's descenders
  return { F, lh, footY, logoTop, areaBot, textH, boxW: F.boxW, boxH: Math.floor(areaBot - F.top - textH) };
}
function svgOf(kind, L, pic, lines, foot) {
  const { F } = L; const block = pic.height + L.textH;
  const top = Math.round(F.top + Math.max(0, (L.areaBot - F.top - block) / 2)), left = Math.round((F.W - pic.width) / 2);
  let y = top + pic.height; const parts = [];
  for (const l of lines) {
    y += l.gap;
    parts.push(`<text x="${F.W / 2}" y="${y}" text-anchor="middle" font-family="${l.serif ? SERIF : SANS}"${l.italic ? ' font-style="italic"' : ''} font-size="${l.size}"${l.spacing ? ` letter-spacing="${l.spacing}"` : ''} fill="${l.fill}">${esc(l.caps ? String(l.t).toUpperCase() : l.t)}</text>`);
  }
  parts.push(logo((F.W - LOGO_PX) / 2, L.logoTop, LOGO_PX));
  if (foot) parts.push(`<text x="${F.W / 2}" y="${L.footY}" text-anchor="middle" font-family="${SANS}" font-size="19" letter-spacing="4" fill="#8f877b">${esc(String(foot).toUpperCase())}</text>`);
  return { top, left, svg: `<svg width="${F.W}" height="${F.H}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>` };
}

// Draws the card to `out` (written whole, then renamed into place). src: the picture's own large copy.
async function draw({ kind, src, lines, foot, out }) {
  const sharp = require('sharp');
  lines = lines.filter(l => l && l.t);
  const L = layout(kind, lines, foot);
  const pic = await sharp(src).resize(L.boxW, L.boxH, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
  const { top, left, svg } = svgOf(kind, L, pic.info, lines, foot);
  const tmp = `${out}.${process.pid}.tmp`;
  await sharp({ create: { width: L.F.W, height: L.F.H, channels: 3, background: BG } })
    .composite([{ input: pic.data, left, top }, { input: Buffer.from(svg), left: 0, top: 0 }])
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(tmp);
  try { fs.renameSync(tmp, out); } catch (er) { try { fs.unlinkSync(tmp); } catch (e2) { /* */ } }
  if (process.env.NODE_ENV === 'test') drawn.set(path.basename(out), svg); // test/cardface.js reads what was drawn
  return { out, svg, pic: { top, left, width: pic.info.width, height: pic.info.height } };
}

// The lines, as each room says them.
const L = {
  credit: t => ({ t: fit(t, 42), size: 40, serif: true, italic: true, fill: '#efe9df', gap: 66 }),
  title: t => ({ t: fit(t, 42), size: 42, serif: true, italic: true, fill: '#efe9df', gap: 68 }),
  line: t => ({ t: fit(t, 60), size: 26, fill: '#b9b1a4', gap: 46 }),
  handle: (t, gap = 44) => ({ t, size: 26, fill: '#b9b1a4', gap, spacing: 1 }),
  caps: t => ({ t: fit(t, 40), size: 24, fill: MARK, gap: 56, caps: true, spacing: 5 })
};

module.exports = { draw, layout, igOf, fit, L, FRAME, BG, LOGO_PX, logoPaths, drawn };
