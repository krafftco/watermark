// A QR code, drawn as SVG: byte mode, error-correction level M, versions 1–10 (up to ~200 bytes). Built from the
// public ISO/IEC 18004 standard, nothing else. Enough for a sign-in link; not a general library.
const EC = { // per version: [total codewords, data codewords at level M, blocks at M, ec codewords per block]
  1: [26, 16, 1, 10], 2: [44, 28, 1, 16], 3: [70, 44, 1, 26], 4: [100, 64, 2, 18], 5: [134, 86, 2, 24], 6: [172, 108, 4, 16], 7: [196, 124, 4, 18], 8: [242, 154, 4, 22], 9: [292, 182, 5, 22], 10: [346, 216, 5, 26],
};
const ALIGN = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const EXP = new Array(512), LOG = new Array(256);
(function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); } g = ng; } return g; }
function rsEncode(data, n) { const g = rsGen(n), r = new Array(n).fill(0); for (const d of data) { const f = d ^ r[0]; r.shift(); r.push(0); if (f) for (let j = 0; j < n; j++) r[j] ^= mul(g[j + 1], f); } return r; }

function encode(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  let v = 1; while (v <= 10 && EC[v][1] - 2 < bytes.length) v++; if (v > 10) throw new Error('too long for this QR');
  const [total, dataN, blocks, ecN] = EC[v];
  const bits = []; const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(4, 4); push(bytes.length, v < 10 ? 8 : 16); for (const b of bytes) push(b, 8);
  for (let i = 0; i < 4 && bits.length < dataN * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0; data.length < dataN; p++) data.push(p % 2 ? 0x11 : 0xec);
  // Split into blocks (the shorter blocks first), encode, interleave.
  const short = Math.floor(dataN / blocks), longN = dataN % blocks, bl = [], ec = []; let at = 0;
  for (let b = 0; b < blocks; b++) { const len = short + (b >= blocks - longN ? 1 : 0); const d = data.slice(at, at + len); at += len; bl.push(d); ec.push(rsEncode(d, ecN)); }
  const out = []; for (let i = 0; i < short + 1; i++) for (const d of bl) if (i < d.length) out.push(d[i]); for (let i = 0; i < ecN; i++) for (const e of ec) out.push(e[i]);
  // The matrix.
  const N = v * 4 + 17, m = Array.from({ length: N }, () => new Array(N).fill(null)); // null = free
  const set = (r, c, val) => { m[r][c] = val ? 1 : 0; };
  const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const rr = r + i, cc = c + j; if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue; const on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) || (j >= 0 && j <= 6 && (i === 0 || i === 6)) || (i >= 2 && i <= 4 && j >= 2 && j <= 4); set(rr, cc, on); } };
  finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
  for (let i = 8; i < N - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  if (ALIGN[v]) for (const r of ALIGN[v]) for (const c of ALIGN[v]) { if (m[r][c] !== null) continue; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1); }
  for (let i = 0; i < 8; i++) { if (m[8][i] === null) set(8, i, 0); if (m[i][8] === null) set(i, 8, 0); if (m[8][N - 1 - i] === null) set(8, N - 1 - i, 0); if (m[N - 1 - i][8] === null) set(N - 1 - i, 8, 0); }
  set(N - 8, 8, 1); if (m[8][8] === null) set(8, 8, 0);
  if (v >= 7) { let vb = v; for (let i = 0; i < 12; i++) vb = (vb << 1) ^ ((vb >> 11) & 1 ? 0x1f25 : 0); const vbits = (v << 12) | (vb & 0xfff); for (let i = 0; i < 18; i++) { const bit = (vbits >> i) & 1; set(Math.floor(i / 3), N - 11 + (i % 3), bit); set(N - 11 + (i % 3), Math.floor(i / 3), bit); } }
  // Data, zigzag, with mask 0 ((r+c)%2==0), then the format bits for level M mask 0.
  const free = (r, c) => m[r][c] === null;
  let bi = 0; const allBits = out.flatMap(b => [7, 6, 5, 4, 3, 2, 1, 0].map(i => (b >> i) & 1));
  for (let col = N - 1, up = true; col > 0; col -= 2, up = !up) { if (col === 6) col--; for (let k = 0; k < N; k++) { const r = up ? N - 1 - k : k; for (const c of [col, col - 1]) if (free(r, c)) { const bit = allBits[bi++] || 0; m[r][c] = bit ^ ((r + c) % 2 === 0 ? 1 : 0); } } }
  const fmt = 0x5412 ^ 0; // level M, mask 0, pre-masked: format info for (00, 000)
  const F = [];
  { let d = (0b00 << 3) | 0; let x = d << 10; for (let i = 14; i >= 10; i--) if ((x >> i) & 1) x ^= 0x537 << (i - 10); const f = ((d << 10) | x) ^ 0x5412; for (let i = 14; i >= 0; i--) F.push((f >> i) & 1); }
  const fpos1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const fpos2 = [[N - 1, 8], [N - 2, 8], [N - 3, 8], [N - 4, 8], [N - 5, 8], [N - 6, 8], [N - 7, 8], [8, N - 8], [8, N - 7], [8, N - 6], [8, N - 5], [8, N - 4], [8, N - 3], [8, N - 2], [8, N - 1]];
  F.forEach((bit, i) => { m[fpos1[i][0]][fpos1[i][1]] = bit; m[fpos2[i][0]][fpos2[i][1]] = bit; });
  void fmt;
  return m.map(row => row.map(x => (x ? 1 : 0)));
}
function svg(text, { size = 220, dark = '#0b0a09', light = '#fff' } = {}) {
  const m = encode(text), N = m.length, q = 2, S = N + q * 2;
  let d = ''; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (m[r][c]) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${S}" height="${S}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
module.exports = { encode, svg };
