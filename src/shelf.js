// The shelf (24 Oct, from an auction house's advertisement: a dark wall, three shelves, real books standing up with
// their shadows, one line in gold in the middle, one act): the house's books shown as objects, not as cards. A book
// with a cover photograph stands in it; one without is bound here in cloth (a colour from its title, the title and
// author in gold on the board), which is how the public domain looked on a shelf before the paperback.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const CLOTH = ['#2f4a3a', '#5a1f22', '#23304d', '#6b4b2a', '#8a7a52', '#3b4a5a', '#4a3350', '#7a5a2a'];
const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x; };
const hash = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
function book(t, href) {
  const h = hash(t.title || t.slug); const cloth = CLOTH[(h >> 7) % CLOTH.length]; const tall = 150 + (h % 5) * 8; const wide = 100 + ((h >> 3) % 4) * 6;
  const inner = t.cover ? `<img src="/img/${esc(t.cover)}/screen" alt="" loading="lazy">` : `<span class="shf-cloth" style="background:${cloth}"><span class="shf-rule"></span><b>${esc(t.title)}</b>${t.author ? `<i>${esc(byName(t.author))}</i>` : ''}<span class="shf-rule"></span></span>`;
  return `<a class="shf-bk" href="${esc(href)}" style="--h:${tall}px;--w:${wide}px" title="${esc(t.title)}${t.author ? `, ${esc(byName(t.author))}` : ''}">${inner}</a>`;
}
// band({ books, href(t), line, act: { href, text }, k }): up to nine books on three shelves, the line on the middle one.
function band({ books, href, line, act, k }) {
  if (!books.length) return '';
  // Fewer than five: one shelf, the line between what there is.
  const rows = books.length < 5 ? [[], books.slice(0, 2), []] : [books.slice(0, 3), books.slice(3, 5), books.slice(5, 8)];
  const shelf = (list, mid) => `<div class="shf-row${mid ? ' shf-mid' : ''}">${mid ? `${list[0] ? book(list[0], href(list[0])) : '<span></span>'}<div class="shf-line">${k ? `<p class="k">${esc(k)}</p>` : ''}<h2>${line}</h2>${act ? `<a class="shf-act" href="${esc(act.href)}">${esc(act.text)}</a>` : ''}</div>${list[1] ? book(list[1], href(list[1])) : '<span></span>'}` : list.map(t => book(t, href(t))).join('')}<span class="shf-plank"></span></div>`;
  return `<section class="shf" aria-label="The shelf">${rows[0].length ? shelf(rows[0]) : ''}${shelf(rows[1], true)}${rows[2].length ? shelf(rows[2]) : ''}</section>`;
}
module.exports = { band, book };
