'use strict';
// The artist's page (Will, 31 Oct: "an IMDb for artists"; "see every single work Monet ever painted, chronologically";
// "all of Leonardo's notebooks, drawings and paintings"; "a profile where you discover, cleanly, all of their works and
// all of their writings"; "artists in their estates also"; "the hall of wonder, where the most curious like to hang out").
// One page for any artist, alive or dead: the best work large, the life, a line from birth to death with the years the
// work was made marked on it, the work in the order it was made (by the artist's own periods when the house has them,
// else by decade or by year), their writings standing as books, who photographed and who keeps the originals, the
// rights in one plain line, and the door for the artist or the estate to keep the page.
const yearOf = s => { const m = String(s || '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/); return m ? +m[1] : null; };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// The year a work was made: the record's date, else a year in the title, else the first year in the caption that falls
// inside the artist's life (a caption also carries the year a museum bought it).
function madeIn(w, a) {
  const inLife = y => y && (!a.born || y >= a.born - 1) && (!a.died || y <= a.died + 1);
  const t = yearOf(w.taken_at); if (inLife(t)) return t;
  const ti = yearOf(w.title); if (inLife(ti)) return ti;
  for (const m of String(w.caption || '').matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)) if (inLife(+m[1])) return +m[1];
  return a.born || a.died ? null : t;
}
// Periods, a line each: '1886–1887 Paris: Two years with Theo in Montmartre.'
function periodsOf(a) {
  return String(a.periods || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d{3,4})\s*(?:[–-]\s*(\d{3,4}))?\s+([^:]+?)(?::\s*(.*))?$/); if (!m) return null;
    return { from: +m[1], to: +(m[2] || m[1]), name: m[3].trim(), line: (m[4] || '').trim() };
  }).filter(Boolean);
}
function chapters(a, ws) {
  const dated = ws.filter(w => w.y), undated = ws.filter(w => !w.y);
  const ps = periodsOf(a); let out = [];
  if (ps.length) {
    out = ps.map(p => ({ name: p.name, years: p.from === p.to ? `${p.from}` : `${p.from}–${p.to}`, line: p.line, id: `p${p.from}`, list: dated.filter(w => w.y >= p.from && w.y <= p.to) }));
    const left = dated.filter(w => !ps.some(p => w.y >= p.from && w.y <= p.to)); if (left.length) out.push({ name: 'Other years', years: '', line: '', id: 'other', list: left });
  } else if (dated.length) {
    const span = dated[dated.length - 1].y - dated[0].y; const byDecade = span > 14 && dated.length > 24;
    const key = w => byDecade ? Math.floor(w.y / 10) * 10 : w.y;
    for (const w of dated) { const k = key(w); let c = out[out.length - 1]; if (!c || c.k !== k) { c = { k, name: byDecade ? `The ${k}s` : `${k}`, years: '', line: '', id: `y${k}`, list: [] }; out.push(c); } c.list.push(w); }
  }
  out = out.filter(c => c.list.length);
  if (undated.length) out.push({ name: dated.length ? 'Undated' : 'The work', years: '', line: '', id: 'undated', list: undated });
  return out;
}
// The life as a line: born to died (or to today), a mark for each year with work in the house, taller with more.
function lifeLine(a, ws, esc) {
  const ys = ws.map(w => w.y).filter(Boolean); if (!ys.length && !a.born) return '';
  const from = Math.min(a.born || Infinity, ...ys), to = Math.max(a.died || new Date().getFullYear(), ...ys); if (!(to > from)) return '';
  const n = {}; ys.forEach(y => { n[y] = (n[y] || 0) + 1; }); const max = Math.max(1, ...Object.values(n));
  const at = y => ((y - from) / (to - from) * 100).toFixed(2);
  return `<div class="apl-life" aria-label="${esc(a.name)}’s life, ${from} to ${a.died ? to : 'today'}"><div class="apl-rule"></div>
${Object.entries(n).map(([y, c]) => `<a class="apl-tick" href="#y-${y}" style="left:${at(+y)}%;height:${(8 + 34 * c / max).toFixed(0)}px" title="${y}: ${c} work${c === 1 ? '' : 's'}"></a>`).join('')}
<span class="apl-end apl-b" style="left:0">${a.born ? `Born ${a.born}` : from}</span><span class="apl-end apl-d" style="left:100%">${a.died ? `Died ${a.died}` : 'Today'}</span></div>`;
}

function render({ a, ws, find = '', ghosts = [], show = null, whole = false, known = 0, writings, V, rights, wanderHref, museums, photographers, claimLine, kinds, binding, isStudio }) {
  const { esc, tidy } = V; const all = ghosts.length ? ws.concat(ghosts).sort((x, y) => (x.y || 99999) - (y.y || 99999) || (x.ghost ? 1 : 0) - (y.ghost ? 1 : 0)) : ws; const ch = chapters(a, all); const r = rights;
  const hero = ws.find(w => w.curated) || ws.slice().sort((x, y) => (y.stars || 0) - (x.stars || 0))[0];
  const ys = ws.map(w => w.y).filter(Boolean); const span = ys.length ? (Math.min(...ys) === Math.max(...ys) ? `${ys[0]}` : `${Math.min(...ys)} to ${Math.max(...ys)}`) : '';
  const seen = new Set();
  const cap = whole ? 0 : (show || all.length > 240) ? 12 : 0;
  const plate = w => { const anchor = w.y && !seen.has(w.y) ? (seen.add(w.y), ` id="y-${w.y}"`) : '';
    if (w.ghost) return `<figure class="apl-w apl-gh"${anchor}><div class="apl-ghb"><b>${esc(tidy(w.title))}</b>${w.y ? `<span>${w.y}</span>` : ''}${w.medium || w.size ? `<i>${esc([w.medium, w.size].filter(Boolean).join(', '))}</i>` : ''}<em>${w.keeps ? esc(w.keeps) : 'Where it is kept is not known'}</em>${w.onView ? `<small class="apl-ov">On view now: ${esc(w.onView)}</small>` : `<small>${w.image ? 'A photograph exists; not yet brought into the house' : 'No open photograph'}</small>`}</div><figcaption>${w.wiki ? `<a href="${esc(w.wiki)}" rel="noopener">Read about it</a> · ` : ''}${/^moma:/.test(w.qid) ? (w.url ? `<a href="${esc(w.url)}" rel="noopener">At MoMA</a> · ` : '') + `<a href="/registry/known/moma/${esc(w.qid.slice(5))}">The record</a>` : `<a href="https://www.wikidata.org/wiki/${esc(w.qid)}" rel="noopener">The record</a>`}</figcaption></figure>`;
    // A tap on the picture opens Wander at it, inside the artist's own walk (Will, 2 Nov: "a way to view the work and then go into wander"); the record stays a line in the caption.
    return `<figure class="apl-w"${anchor}><a href="${esc(wanderHref)}${wanderHref.includes('?') ? '&' : '?'}at=${esc(w.slug)}" title="Open it in Wander"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="lazy" decoding="async"${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}></a><figcaption><b><a href="/m/${esc(w.handle)}/${esc(w.slug)}">${esc(tidy(w.title))}</a></b>${w.y ? `<span>${w.y}</span>` : ''}${w.medium ? `<i>${esc(w.medium)}</i>` : ''}${w.keeps ? `<em>${esc(w.keeps)}</em>` : ''}${w.handle && w.handle !== 'the-public-domain' ? `<small>Photograph by ${esc(w.maker_name)}</small>` : ''}<a class="apl-st" href="/easel/${esc(w.slug)}?back=${encodeURIComponent('/art/' + a.slug)}">Study it on the easel</a></figcaption></figure>`; };
  const bio = String(a.bio || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const facts = [known ? `${known} known work${known === 1 ? '' : 's'}, ${ws.length} in the house` : null, !known && ws.length ? `${ws.length} work${ws.length === 1 ? '' : 's'}${kinds.length ? ` · ${kinds.join(', ')}` : ''}` : null, span ? `made ${span}` : null, writings.length ? `${writings.length} in their own words` : null, museums.length ? `kept in ${museums.length} collection${museums.length === 1 ? '' : 's'}` : null].filter(Boolean);
  return `<main class="apl">
<header class="apl-h">${hero ? `<figure class="apl-hero"><a href="${esc(wanderHref)}${wanderHref.includes('?') ? '&' : '?'}at=${esc(hero.slug)}" title="Open it in Wander"><img src="/img/${esc(hero.slug)}/large" alt="${esc(tidy(hero.title))}"></a><figcaption>${esc(tidy(hero.title))}${hero.y ? `, ${hero.y}` : ''}</figcaption></figure>` : ''}
<div class="apl-ht"><p class="k"><a href="/art">The hall</a>${a.movement ? ` · <a href="/art?movement=${encodeURIComponent(a.movement)}">${esc(a.movement)}</a>` : ''}</p><h1>${esc(a.name)}</h1>
<p class="apl-dates">${esc([a.born || a.died ? `${a.born || '?'} – ${a.died || (a.born ? 'living' : '')}` : '', a.nationality].filter(Boolean).join(' · '))}${a.claim_status === 'claimed' ? ' · <span class="apl-kept">Kept by the artist’s side</span>' : ''}</p>
${bio.length ? `<p class="apl-lede">${esc(bio[0])}</p>` : ''}
${facts.length ? `<p class="apl-facts">${esc(facts.join(' · '))}</p>` : ''}
${find || ''}<p class="apl-acts">${ws.length ? `${show ? `<a class="apl-wander" href="${esc(show.href)}">${V.WAVE_MARK || ''}<span>Walk the show</span><i>${show.works.length} works, one at a time</i></a><a class="apl-read" href="${esc(show.all)}"><span>Wander everything</span><i>All ${ws.length.toLocaleString('en-US')}, in the order made</i></a>` : `<a class="apl-wander" href="${esc(wanderHref)}">${V.WAVE_MARK || ''}<span>Wander the work</span><i>One at a time, in the order it was made</i></a>`}<button type="button" class="apl-read apl-send" data-send data-send-url="/art/${esc(a.slug)}" data-send-title="${esc(a.name)}" data-send-text="${esc(a.name)}${a.born || a.died ? ` (${esc(a.born || '')}–${esc(a.died || '')})` : ''}: the life and the work, in the order it was made."><span>Share this page</span><i>Send this page: the life, the dates, the work</i></button>` : ''}${ws.length ? `<a class="apl-read" href="/easel?artist=${esc(a.slug)}"><span>Study the work</span><i>On the easel: values, notan, a grid, side by side</i></a>` : ''}${writings.length ? `<a class="apl-read" href="#writings"><span>Read their words</span><i>${esc(tidy(writings[0].title))}${writings.length > 1 ? ` and ${writings.length - 1} more` : ''}</i></a>` : ''}</p></div></header>
${lifeLine(a, all, esc)}
${bio.length > 1 ? `<section class="apl-bio">${bio.slice(1).map(p => `<p>${esc(p)}</p>`).join('')}</section>` : ''}
${show ? `<section class="ash" id="show"><header><p class="k">The show</p><h2>${esc(show.title)}</h2>${show.line ? `<p>${esc(show.line)}</p>` : ''}</header><div class="ash-row">${show.works.map(w => `<figure class="ash-w"><a href="${esc(show.href)}?at=${esc(w.slug)}" title="Open it in the show"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="lazy" decoding="async"${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}></a><figcaption><b><a href="/m/${esc(w.handle)}/${esc(w.slug)}">${esc(tidy(w.title))}</a></b>${w.y ? `<span>${w.y}</span>` : ''}</figcaption></figure>`).join('')}</div><p class="ash-go"><a class="apl-wander" href="${esc(show.href)}">${V.WAVE_MARK || ''}<span>Walk the show</span></a></p></section>
<h2 class="ash-cat" id="catalogue">The catalogue <small>${ws.length.toLocaleString('en-US')} works${known ? ` · ${known.toLocaleString('en-US')} known` : ''}, in the order made</small></h2>` : ''}
${ch.length > 1 ? `<nav class="apl-toc">${ch.map(c => `<a href="#${esc(c.id)}">${esc(c.name)}${c.years ? ` <small>${esc(c.years)}</small>` : ''}</a>`).join('')}</nav>` : ''}
${ch.map(c => `<section class="apl-ch" id="${esc(c.id)}"><header><h2>${esc(c.name)}</h2>${c.years ? `<span>${esc(c.years)}</span>` : ''}${c.line ? `<p>${esc(c.line)}</p>` : ''}<small>${c.list.length} work${c.list.length === 1 ? '' : 's'}</small></header><div class="apl-grid">${(cap && c.list.length > cap ? c.list.slice(0, cap) : c.list).map(plate).join('')}</div>${cap && c.list.length > cap ? `<p class="ash-more"><a href="/art/${esc(a.slug)}?all=1#${esc(c.id)}">All ${c.list.length.toLocaleString('en-US')} from ${esc(c.name)}</a></p>` : ''}</section>`).join('') || '<p class="apl-empty">Nothing of theirs is in the house yet.</p>'}
${writings.length ? `<section class="apl-wr" id="writings"><h2>In their own words</h2><div class="apl-books">${writings.map(t => binding ? binding.html(t, `/read/${t.slug}`, { size: 180 }) : `<a href="/read/${esc(t.slug)}">${esc(tidy(t.title))}</a>`).join('')}</div></section>` : ''}
${photographers.length || museums.length ? `<section class="apl-who">${museums.length ? `<div><h2>Where the originals are</h2><p>${museums.map(m => m && m.html ? m.html : esc(m)).join('<br>')}</p>${museums.some(m => m && m.html) ? '<p><a href="/art/visit">See it in person: every museum, by city</a></p>' : ''}</div>` : ''}${photographers.length ? `<div><h2>Photographed by</h2><p>${photographers.map(([h, n]) => `<a href="/m/${esc(h)}">${esc(n)}</a>`).join('<br>')}</p></div>` : ''}</section>` : ''}
<section class="apl-foot"><p class="apl-rights"><b>${r.state === 'pd' ? 'Public domain.' : r.state === 'reserved' ? 'Under copyright.' : 'Terms set by the artist’s side.'}</b> ${esc(r.why || '')}</p>
${a.sources || a.wiki ? `<p class="apl-src">Read further: ${[a.wiki, ...String(a.sources || '').split('\n')].map(s => String(s || '').trim()).filter(Boolean).map(s => /^https?:/.test(s) ? `<a href="${esc(s)}" rel="noopener">${esc(s.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : esc(s)).join(' · ')}</p>` : ''}
<p class="apl-claim">${claimLine}</p>${isStudio ? `<p class="apl-claim"><a href="/studio/art/${esc(a.slug)}">Edit this page, or bring in more of the work</a></p>` : ''}</section></main>`;
}

// Their own words: books on the shelf whose author is this artist (every part of the name present, either order).
function writingsOf(db, a) {
  const parts = norm(a.name).split(' ').filter(p => p.length > 2 && !['van', 'von', 'der', 'den', 'del', 'della'].includes(p)); if (!parts.length) return [];
  // Never the bodies: every public book's text came over the bridge on each visit (2 Nov, the ten seconds).
  return db.prepare("SELECT t.id, t.slug, t.title, t.author, t.kind, t.year, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.public=1 AND t.author IS NOT NULL AND t.kind IN ('book','essay','document','journal','letters') ORDER BY t.id").all().filter(t => { const n = norm(t.author); return parts.every(p => n.includes(p)); });
}

module.exports = { render, writingsOf, madeIn, periodsOf, chapters };
