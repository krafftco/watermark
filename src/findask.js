// How a person asks (#179; Will, 20 Nov: "I could not search and find my picture the seine by will fullerton").
// A search is read before it is run: a phrase in quotes, a number typed exactly, a title "by" a maker, a year or a
// decade, a kind of work ("drawings"), and a holder ("at the art institute", "met"). Nothing here touches the
// database: find.js runs what this reads, on both roads (the small house's list and the database's candidates).
const JOIN = new Set(['by', 'the', 'a', 'an', 'of', 'and', 'in', 'at', 'on', 'from', 'with']);
const ARTICLE = new Set(['the', 'a', 'an']);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
// What people call a museum for short. Only read as a holder when a museum of the house answers to the longer words.
const ALIAS = { met: 'metropolitan museum', moma: 'museum modern art', aic: 'art institute chicago', nga: 'national gallery art', lacma: 'los angeles county museum', mfa: 'museum fine arts', rijks: 'rijksmuseum', getty: 'getty museum' };
const KIND_ALSO = { photo: 'photograph', photos: 'photograph', photography: 'photograph' };
const QUOTED = /["“”„«»]([^"“”„«»]+)["“”„«»]/g;
const inName = (nm, t) => String(nm || '').split(' ').some(w => w.startsWith(t));
const TRACK = require('./track');

// A kind of work by its word, singular or plural ("drawing", "drawings"); "work" itself is no kind.
function kindOf(t, KINDS) {
  if (KIND_ALSO[t]) return KIND_ALSO[t];
  for (const k of Object.keys(KINDS || {})) { if (k === 'other' || k === 'mixed') continue; const n = norm(KINDS[k]); if (t === n || t === n + 's') return k; }
  return null;
}
// The ask with its tokens set (after a word is set aside or mended): the same reading, tidied.
function withToks(P, toks) {
  toks = toks.map(t => ({ ...t }));
  if (toks.length === 1 && toks[0].type === 'kind' && !P.phrases.length) toks[0].type = null; // a kind typed alone is a word: the Mediums way answers it, and no question walks the collection by kind
  const hold = toks.filter(t => t.role === 'holder');
  const by = toks.some(t => t.role === 'title') && toks.some(t => t.role === 'maker');
  if (!by) for (const t of toks) if (t.role === 'title' || t.role === 'maker') t.role = null;
  // What the title may be, exactly: every word left, the words before "by", each with and without its article.
  const core = toks.filter(t => t.role !== 'holder').map(t => t.t).join(' ');
  const titleSide = by ? toks.filter(t => t.role === 'title').map(t => t.t).join(' ') : '';
  const titles = [...new Set([core, titleSide, ...P.phrases].filter(Boolean).flatMap(x => { const bare = x.split(' ').filter(w => !JOIN.has(w)).join(' '); return bare ? [x, bare, `the ${bare}`, `a ${bare}`] : [x]; }))].slice(0, 12);
  return { ...P, toks, by, holder: hold.length ? P.holder : null, titles, cores: new Set([core, titleSide, ...P.phrases.map(p => p.split(' ').filter(w => !JOIN.has(w)).join(' '))].filter(Boolean)) };
}
// The phrases let go: their words asked apart.
function apart(P) { const more = P.phrases.flatMap(p => p.split(' ')).filter(w => !JOIN.has(w)).map(t => ({ t, role: null, type: null })); return withToks({ ...P, phrases: [] }, [...P.toks, ...more]); }

function understand(q, { museums = [], KINDS = {} } = {}) {
  const raw = String(q || '').trim().slice(0, 120);
  const phrases = [];
  const rest = raw.replace(QUOTED, (m, p) => { const n = norm(p); if (n && phrases.length < 3) phrases.push(n); return ' '; }).replace(/["“”„«»]/g, ' ').replace(/['’`]s\b/g, ''); // "Leonardo's trattato" is leonardo + trattato
  const nq = norm(rest); const words0 = nq.split(' ').filter(Boolean);
  // A number typed exactly: an accession number (no space in it) or a Watermark number (twelve digits, or WM-2026-000123).
  const ref = TRACK.ref(raw) && /^[wm\d\s.-]+$/i.test(raw) ? TRACK.ref(raw) : (/^WM-\d{4}-\d{6}$/i.test(raw) ? raw.toUpperCase() : null);
  const num = !phrases.length && /\d/.test(raw) && !/\s/.test(raw) && !/^\d{4}s?$/.test(raw) && raw.length <= 40 ? raw : null;
  const toks = []; let mode = null;
  for (const w of words0) {
    if (JOIN.has(w)) { if (w === 'by') mode = 'maker'; else if (w === 'at' || w === 'in' || w === 'from') mode = 'where'; continue; }
    const tk = { t: w, role: mode, type: null };
    const dec = /^(\d{3})0s$/.exec(w); const k = kindOf(w, KINDS);
    if (dec) { tk.type = 'decade'; tk.y0 = Number(dec[1]) * 10; } else if (/^\d{4}$/.test(w) && +w >= 1000 && +w <= 2100) tk.type = 'year'; else if (k) { tk.type = 'kind'; tk.k = k; }
    if (tk.type) tk.role = null; // a year, a decade or a kind is never part of a name
    toks.push(tk);
  }
  // A joining word alone is still a word ("the").
  if (!toks.length && !phrases.length) for (const w of words0) toks.push({ t: w, role: null, type: null });
  // The holder: the words after "at" (or a short name anywhere), when a museum of the house answers to all of them.
  const mus = museums.filter(m => m && m.id && !m.known);
  const short = t => !t.type && ALIAS[t.t] && mus.some(m => ALIAS[t.t].split(' ').every(x => inName(m.nm, x)));
  const wordsOf = t => (short(t) ? ALIAS[t.t].split(' ') : [t.t]);
  const after = toks.filter(t => t.role === 'where'), shorts = toks.filter(t => t.role !== 'where' && short(t));
  let holder = null;
  for (const want of [[...after, ...shorts], shorts, after]) {
    if (!want.length || holder) continue;
    const hw = want.flatMap(wordsOf); const H = mus.filter(m => hw.every(x => inName(m.nm, x)));
    if (H.length) { holder = { ids: new Set(H.map(m => Number(m.id))), names: H.map(m => m.name) }; for (const t of want) t.role = 'holder'; }
  }
  for (const t of toks) if (t.role === 'where') t.role = null;
  // "X by Y": the words before are the title's, the words after the maker's.
  if (toks.some(t => t.role === 'maker') && toks.some(t => t.role === null && !t.type)) for (const t of toks) if (t.role === null && !t.type) t.role = 'title';
  return withToks({ raw, nq, all: norm(raw), words: norm(raw.replace(/['’`]s\b/g, '')).split(' ').filter(Boolean), phrases, num, ref, holder }, toks);
}
// The words shown back, as they were typed, without the ones set aside: "the seine by will fullerton".
function shown(P, gone = [], mended = []) {
  const g = new Set(gone); const m = new Map(mended);
  const out = P.words.filter(w => !g.has(w)).map(w => m.get(w) || w);
  while (out.length && JOIN.has(out[out.length - 1])) out.pop();
  while (out.length && JOIN.has(out[0]) && !(ARTICLE.has(out[0]) && out.length > 1 && !JOIN.has(out[1]))) out.shift();
  return out.join(' ');
}
module.exports = { understand, withToks, apart, shown, norm, JOIN, inName, kindOf };
