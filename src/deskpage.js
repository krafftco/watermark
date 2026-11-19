'use strict';
// A desk's list at scale (#78–#93, the scale gate). The desks run on the website's one process; a museum holds 60,000
// works, and a list that reads every one of them holds every visitor behind it (13 Nov). So a desk that lists a maker's
// works shows a page of them (PAGE, the newest first by id), with keyset paging (Older: `?before=<id>`, Newer:
// `?after=<id>`; never OFFSET, which reads every row it skips) and a search that asks the database (title, place,
// accession, keywords, the year: the same words find.js reads, so Postgres answers it from the `works_find` trigram index).
// Counts are asked as counts, by the caller. What a page costs: one statement of PAGE + 1 rows, by the index on
// (maker_id, id), whatever the size of the collection; a search with no match reads the maker's index entries once.
const PAGE = 200;
const WORDS = "lower(coalesce(w.title,'') || ' ' || coalesce(w.place,'') || ' ' || coalesce(w.keywords,'') || ' ' || coalesce(w.accession,'') || ' ' || coalesce(substr(w.taken_at,1,4),''))";

// The request's place in the list: a word (at most four tokens; LIKE's own marks taken out) and one keyset bound.
function where(query = {}) {
  const q = String(query.q || '').trim().slice(0, 80);
  const toks = q.toLowerCase().replace(/[%_\\]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4);
  const id = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : null; };
  const after = id(query.after), before = after ? null : id(query.before);
  return { q, toks, before, after };
}

// One page. `cols` the columns (named; `w` is works), `base` the WHERE the desk already has (its params in `params`),
// `from` any joins after `works w`. Returns { rows, older, newer } (ids for the links, or null).
function page(db, { cols, from = '', base, params = [], at, limit = PAGE }) {
  const conds = [base], args = [...params];
  for (const t of at.toks) { conds.push(`${WORDS} LIKE ?`); args.push(`%${t}%`); }
  if (at.before) { conds.push('w.id < ?'); args.push(at.before); }
  if (at.after) { conds.push('w.id > ?'); args.push(at.after); }
  const rows = db.prepare(`SELECT ${cols} FROM works w ${from} WHERE ${conds.join(' AND ')} ORDER BY w.id ${at.after ? 'ASC' : 'DESC'} LIMIT ${limit + 1}`).all(...args);
  const more = rows.length > limit; if (more) rows.length = limit;
  if (at.after) rows.reverse();
  const first = rows[0], last = rows[rows.length - 1];
  return {
    rows,
    newer: first && (at.after ? more : !!at.before) ? first.id : null,
    older: last && (at.after ? true : more) ? last.id : null,
  };
}

// The controls: the search box (it asks the house, not the page) and Newer / Older. `keep` are the query's other
// parameters to carry (a star filter, the Studio's ?maker=). `hash` an anchor to land on.
function controls({ esc, path, at, older, newer, keep = {}, hash = '', label = 'Find a work', shown = 0, total = null }) {
  const carry = Object.entries(keep).filter(([, v]) => v != null && v !== '');
  const href = extra => path + '?' + new URLSearchParams([...carry, ...(at.q ? [['q', at.q]] : []), ...Object.entries(extra)].map(([k, v]) => [k, String(v)])).toString() + hash;
  const hidden = carry.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  const nav = newer || older ? `<nav class="dkp-nav" aria-label="More works">${newer ? `<a href="${esc(href({ after: newer }))}" rel="prev">&larr; Newer</a>` : ''}${older ? `<a href="${esc(href({ before: older }))}" rel="next">Older &rarr;</a>` : ''}</nav>` : '';
  const line = total != null && total > shown && !at.q && !at.before && !at.after ? `<span class="dkp-n">The newest ${shown.toLocaleString('en-US')} of ${Number(total).toLocaleString('en-US')}</span>` : at.q ? `<span class="dkp-n">${shown ? `${shown.toLocaleString('en-US')}${older ? '+' : ''} found` : 'Nothing found'} for “${esc(at.q)}” · <a href="${esc(path + (carry.length ? '?' + new URLSearchParams(carry).toString() : '') + hash)}">Clear</a></span>` : '';
  return `<div class="dkp"><form class="dkp-q" method="get" action="${esc(path)}${esc(hash)}" role="search">${hidden}<label><span>${esc(label)}</span><input type="search" name="q" value="${esc(at.q)}" placeholder="A title, a place, an accession number" autocomplete="off"></label><button>Find</button></form>${line}${nav}</div>`;
}

// A search across a desk's works (a picker): the works whose words hold every token, or whose slug is the word, best
// first, LIMIT `limit` (20). For a field that asks as the person types; never a list of every work.
function find(db, { cols, from = '', base, params = [], q, limit = 20, order = 'w.stars DESC, w.id DESC' }) {
  const at = where({ q });
  if (!at.toks.length) return [];
  const conds = at.toks.map(() => `${WORDS} LIKE ?`).join(' AND ');
  return db.prepare(`SELECT ${cols} FROM works w ${from} WHERE ${base} AND ((${conds}) OR w.slug = ?) ORDER BY ${order} LIMIT ${limit}`).all(...params, ...at.toks.map(t => `%${t}%`), at.q.toLowerCase());
}

module.exports = { PAGE, WORDS, where, page, controls, find };
