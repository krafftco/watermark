// The binding (Will, 25 Oct: "a beautiful book covering that feels like a Gilded Age Morgan Library, Franklin Library
// kind of binding, where people see these books and they just look like treasures"). One drawing for every book
// the house keeps that has no cover of its own: a board of morocco or calf in one of the house's leathers, the grain
// in it, a double gilt fillet with corner fleurons, a cartouche for the title in gilt, the author beneath in small
// capitals, the spine with five raised bands and a contrasting leather label, the page block's gilt edge. Drawn
// as SVG from the book's title (the leather and the proportions follow a hash of it, so the same book is always the
// same book), served at /binding/<slug>.svg and inlined wherever a book stands: the shelves, the rows, Wander, the
// reading list, the reading room's cover, the Library.
const LEATHERS = [
  { name: 'morocco', base: '#6b1420', dark: '#3f0a12', light: '#8a2130', label: '#1a1512' },
  { name: 'bottle', base: '#17402e', dark: '#0d2419', light: '#245a40', label: '#5a0f17' },
  { name: 'navy', base: '#1b2a4a', dark: '#0f182c', light: '#2a3f6b', label: '#5a0f17' },
  { name: 'oxblood', base: '#4a1414', dark: '#2a0a0a', light: '#6a2020', label: '#1a1512' },
  { name: 'black', base: '#1e1b18', dark: '#0e0c0b', light: '#2e2a26', label: '#5a0f17' },
  { name: 'calf', base: '#7a4a24', dark: '#4a2a12', light: '#9a6334', label: '#1a1512' },
  { name: 'plum', base: '#3e1f3d', dark: '#241124', light: '#58305a', label: '#1a1512' },
  { name: 'olive', base: '#4a4a24', dark: '#2c2c14', light: '#636332', label: '#5a0f17' },
];
const GILT = '#d9b86a', GILT_HI = '#f3e0a6', GILT_LO = '#a8863f';
const hash = s => { let h = 7; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x.replace(/\s*\(.*\)$/, ''); };
// Words wrapped to a width in a serif at a size: a guess of 0.52 em a character, the title's own case kept.
function wrap(text, chars, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > chars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur); if (lines.length > max) { const keep = lines.slice(0, max); keep[max - 1] = keep[max - 1].replace(/\s+\S*$/, '') + '…'; return keep; } return lines;
}
// A small fleuron for the corners: a four-petalled ornament on a stem, after the tools of the French binders.
const PETAL = 'M0 0C2.6 -2.2 2.6 -6.4 0 -9C-2.6 -6.4 -2.6 -2.2 0 0Z';
const FLEURON = [0, 90, 180, 270].map(r => `<path d="${PETAL}" transform="rotate(${r})"/>`).join('') + '<circle r="1.4"/>';
function svg(t, opts = {}) {
  const W = opts.w || 300, H = opts.h || Math.round(W * 1.52); const h = hash(t.title || t.slug);
  const L = LEATHERS[(h >>> 7) % LEATHERS.length]; const spine = Math.round(W * 0.11); const bx = spine, bw = W - spine;
  const inset = Math.round(W * 0.07); const fx = bx + inset, fy = inset, fw = bw - inset * 2, fh = H - inset * 2;
  const title = String(t.title || '').trim(); const author = byName(t.author); const year = t.year ? String(t.year).slice(0, 4) : '';
  const big = title.length < 18; const size = big ? W * 0.095 : title.length < 40 ? W * 0.078 : W * 0.064;
  const lines = wrap(title, Math.max(8, Math.floor((fw * 0.8) / (size * 0.5))), 4);
  const cy = H * 0.42; const lh = size * 1.18; const y0 = cy - ((lines.length - 1) * lh) / 2;
  const tt = lines.map((ln, i) => `<tspan x="${bx + bw / 2}" y="${(y0 + i * lh).toFixed(1)}">${esc(ln)}</tspan>`).join('');
  const bands = [0.12, 0.3, 0.48, 0.66, 0.84].map(p => `<rect x="0" y="${(H * p).toFixed(1)}" width="${spine}" height="${Math.max(3, W * 0.012).toFixed(1)}" fill="${L.light}"/><rect x="0" y="${(H * p + Math.max(3, W * 0.012)).toFixed(1)}" width="${spine}" height="1.2" fill="${L.dark}"/>`).join('');
  const uid = 'b' + (h % 100000).toString(36) + W; // the width too: two sizes of one book on a page must not share defs
  const labelY = H * 0.14, labelH = H * 0.13;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}${author ? ', ' + esc(author) : ''}">
<defs>
<filter id="${uid}g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${h % 97}" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.09 0" result="a"/><feBlend in="SourceGraphic" in2="a" mode="multiply"/></filter>
<linearGradient id="${uid}l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${L.dark}"/><stop offset=".55" stop-color="${L.base}"/><stop offset="1" stop-color="${L.dark}"/></linearGradient>
<linearGradient id="${uid}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${L.light}"/><stop offset=".5" stop-color="${L.base}"/><stop offset="1" stop-color="${L.dark}"/></linearGradient>
<linearGradient id="${uid}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GILT_HI}"/><stop offset=".5" stop-color="${GILT}"/><stop offset="1" stop-color="${GILT_LO}"/></linearGradient>
<linearGradient id="${uid}t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GILT_HI}"/><stop offset=".6" stop-color="${GILT}"/><stop offset="1" stop-color="${GILT_LO}"/></linearGradient>
</defs>
<g filter="url(#${uid}g)">
<rect x="0" y="0" width="${spine}" height="${H}" fill="url(#${uid}l)"/>
<rect x="${bx}" y="0" width="${bw}" height="${H}" fill="url(#${uid}b)"/>
</g>
<rect x="${spine - 1}" y="0" width="2" height="${H}" fill="${L.dark}" opacity=".7"/>
${bands}
<rect x="${(spine * 0.12).toFixed(1)}" y="${labelY.toFixed(1)}" width="${(spine * 0.76).toFixed(1)}" height="${labelH.toFixed(1)}" fill="${L.label}" stroke="url(#${uid}e)" stroke-width="0.8"/>
<text transform="translate(${(spine / 2 + size * 0.02).toFixed(1)} ${(labelY + labelH / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" dominant-baseline="middle" font-family="'Newsreader','Times New Roman',Georgia,serif" font-size="${Math.max(6, spine * 0.42).toFixed(1)}" letter-spacing=".06em" fill="url(#${uid}e)">${esc(title.length > 22 ? title.slice(0, 21).replace(/\s+\S*$/, '') + '…' : title)}</text>
${author ? `<text transform="translate(${(spine / 2).toFixed(1)} ${(H * 0.62).toFixed(1)}) rotate(-90)" text-anchor="middle" dominant-baseline="middle" font-family="'Newsreader','Times New Roman',Georgia,serif" font-size="${Math.max(5, spine * 0.3).toFixed(1)}" letter-spacing=".14em" fill="url(#${uid}e)" opacity=".9">${esc(author.split(' ').pop().toUpperCase())}</text>` : ''}
<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="none" stroke="url(#${uid}e)" stroke-width="${(W * 0.006).toFixed(2)}"/>
<rect x="${fx + W * 0.018}" y="${fy + W * 0.018}" width="${fw - W * 0.036}" height="${fh - W * 0.036}" fill="none" stroke="url(#${uid}e)" stroke-width="${(W * 0.0025).toFixed(2)}"/>
${[[fx + W * 0.05, fy + W * 0.05, 0], [fx + fw - W * 0.05, fy + W * 0.05, 90], [fx + fw - W * 0.05, fy + fh - W * 0.05, 180], [fx + W * 0.05, fy + fh - W * 0.05, 270]].map(([x, y, r]) => `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r}) scale(${(W / 300).toFixed(3)})" fill="url(#${uid}t)">${FLEURON}</g>`).join('')}
<ellipse cx="${(bx + bw / 2).toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(fw * 0.4).toFixed(1)}" ry="${(Math.max(lines.length * lh * 0.78, fh * 0.14) + W * 0.04).toFixed(1)}" fill="none" stroke="url(#${uid}e)" stroke-width="${(W * 0.004).toFixed(2)}"/>
<text text-anchor="middle" dominant-baseline="middle" font-family="'Newsreader','Times New Roman',Georgia,serif" font-size="${size.toFixed(1)}" fill="url(#${uid}t)" style="font-weight:400">${tt}</text>
${author ? `<text x="${(bx + bw / 2).toFixed(1)}" y="${(H * 0.72).toFixed(1)}" text-anchor="middle" font-family="'Newsreader','Times New Roman',Georgia,serif" font-size="${(W * 0.042).toFixed(1)}" letter-spacing=".22em" fill="url(#${uid}e)">${esc(author.toUpperCase())}</text>` : ''}
<line x1="${(bx + bw / 2 - fw * 0.18).toFixed(1)}" y1="${(H * 0.78).toFixed(1)}" x2="${(bx + bw / 2 + fw * 0.18).toFixed(1)}" y2="${(H * 0.78).toFixed(1)}" stroke="url(#${uid}e)" stroke-width="${(W * 0.003).toFixed(2)}"/>
${year ? `<text x="${(bx + bw / 2).toFixed(1)}" y="${(H * 0.845).toFixed(1)}" text-anchor="middle" font-family="'Newsreader','Times New Roman',Georgia,serif" font-size="${(W * 0.038).toFixed(1)}" letter-spacing=".12em" fill="url(#${uid}e)" opacity=".85">${esc(year)}</text>` : ''}
<path transform="translate(${(bx + bw / 2 - W * 0.04).toFixed(1)} ${(H - inset - W * 0.045).toFixed(1)}) scale(${(W * 0.08 / 41).toFixed(4)})" d="M1.5 19.4c3.2 0 4.5-4.5 8.2-4.5s4.9 4.5 8.2 4.5 4.5-4.5 8.2-4.5 4.9 4.5 8.2 4.5 4.5-4.5 8.2-4.5" fill="none" stroke="url(#${uid}e)" stroke-width="2.4" stroke-linecap="round"/>
</svg>`;
}
// The book as it stands on a shelf: the binding (or the cover photograph on the board) with the page block's gilt
// edge and the shelf's shadow, in a box the caller sizes (`--w`, `--h`).
function html(t, href, { cls = '', size = 300 } = {}) {
  const inner = t.cover ? `<span class="bnd bnd-ph"><img src="/img/${esc(t.cover)}/screen" alt="" loading="lazy" decoding="async"></span>` : `<span class="bnd">${svg(t, { w: size })}</span>`;
  return `<a class="bk3 ${cls}" href="${esc(href)}" title="${esc(t.title)}${t.author ? `, ${esc(byName(t.author))}` : ''}">${inner}<span class="bk3-e"></span></a>`;
}
function mountBinding(app, { db }) {
  app.get('/binding/:slug.svg', (req, res) => {
    const t = db.prepare("SELECT slug, title, author, year FROM texts WHERE slug=? AND status='held' AND public=1").get(String(req.params.slug));
    if (!t) return res.sendStatus(404);
    const w = Math.max(120, Math.min(900, parseInt(req.query.w, 10) || 300));
    res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }).send(svg(t, { w }));
  });
  app.locals.binding = { svg, html, byName, LEATHERS };
}
module.exports = { svg, html, mountBinding, byName };
