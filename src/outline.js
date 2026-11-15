// A book of numbered notes (#35; Will, 13 Nov, reading Leonardo's Notebooks on a phone: "how is this book even supposed
// to be read?"; then "Fix the whole book… for the first time ever someone can really study and understand his genius").
// Richter's Leonardo is not a narrative: volumes → front matter → sections (I–XXII) → parts → topics → notes 1–1566,
// each note its number alone on a line, Leonardo's capital headings and text, Richter's footnotes, and the manuscript it
// comes from ("C.A. 172b; 516b]"). The house's chaptering (CHAPTER / roman numerals / capital lines) cut it at the wrong
// places, so for such a book the reader sets its own structure instead.
//   Recognised by shape alone, never by name (`detect`): at least 100 paragraphs that are only `N.`, at least 80% of them
//   rising, and at least three bare roman numerals (`III.`, `_XIII.`) followed by a title line. A book that does not fit
//   is set exactly as before, byte for byte (the reader does not call anything here for it but `book()`, which says null).
//   Built once per book when it is first read (`book`), from the chapters the reader has already split, and kept in a
//   small cache (the last 4 such books, keyed by slug, updated_at and body length; a book that is not one is remembered
//   as not one, up to 500 keys). The build is four passes over the paragraphs (flatten, detect, the contents, the body)
//   plus one that sets their type; for Leonardo's 6,926 paragraphs a few milliseconds, held as about 1.5 MB of set
//   HTML. A visitor's request then only joins strings, as the reader always has. The stored text is never changed; no
//   AI is asked; nothing walks the library.
//   The seam for later (stage 2, not built): `note(n)` on a built book → { n, chapter, ms: [{ ms, name, folio, line }] },
//   exposed as `app.locals.bookNotes.note(slug, n)` (reading.js), so a note can be joined to a codex page in Volumes.
// #40 (14 Nov, the real book read against stage 1): the chapters follow the text's own shapes. Each volume's contents
//   is a zone, from "CONTENTS…" (or the volume's title page) to its last synopsis before the next note: a numeral there is
//   an entry, never a section. A section is a numeral with a mixed-case title that is exactly the next section; a part a
//   numeral with a line in capitals, inside the section. A bare range line "(279. 280)." opens those notes together, one
//   block anchored for each number that has no line of its own; a number joined to its text ("13. From the character…")
//   is a note only when it is exactly the next, its own number never stands bare, the note before has no footnote, and
//   the text reads as a note's. A footnote never runs across a note's number, a numeral, a range line or a capital
//   heading. A number with no anchor goes to the nearest lower note, and the reader is told ("within 453–457"). A
//   manuscript line is read by its shape (a known abbreviation and a leaf), never as any short line ending "]".
//   lay 'n2'. Places kept under 13 Nov's chaptering (lay 'n1') are carried by running that build, frozen in
//   outline-n1.js, once per built book: each old chapter goes to where its first line now stands.
const OFF = { off: false }; // the test sets it to compare the reader with all of this away
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NUM = /^\d{1,4}(?:\s*(?:\.|,|—|–|-{1,2})\s*\d{1,4})*\.?$/;
const PART = /^(?:([IVXLC]+)\.\s*)?([A-Z][A-Z\s,;:’'\-&]*[A-Z])\.?$/;
const TOPIC = /^([\s\S]*?\S)\s*\(([^()]*)\)\s*\.?$/;
const BNUM = /^(\d{1,4})\.$/;
const RUNON = /^(\d{1,4})\.\s+(\S[\s\S]*)$/;
// A numeral alone on its line: "III.", "_XIII.", and (#59) as the stored text may carry it, with emphasis marks, spaces or
// no full stop ("**IV.**", "XII"); a single letter needs its full stop (a diagram's "C" is not a numeral).
const BROMAN = /^[_*\s]*(?:([IVXLC]+)\s*\.|([IVXLC]{2,}))[_*\s]*$/;
const romM = p => { const m = String(p).match(BROMAN); return m ? [m[0], m[1] || m[2]] : null; };
const VOL = /^_*volume\s+([0-9]+|[ivx]+|one|two|three)\.?_*$/i;
const isCaps = p => !/[a-z]/.test(p) && /[A-Z]{3}/.test(p);
const strip_ = s => String(s).replace(/_/g, '').trim();
const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const roman = r => { const v = { I: 1, V: 5, X: 10, L: 50, C: 100 }; let n = 0; for (let k = 0; k < r.length; k++) { const a = v[r[k]], b = v[r[k + 1]] || 0; n += a < b ? -a : a; } return n; };
// ---- The synopsis: "Topic (548).—Topic (549—554).—IV. A PART IN CAPITALS.—…"
function runs(p) {
  const out = []; let depth = 0, cur = '';
  for (let k = 0; k < p.length; k++) {
    const ch = p[k];
    if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === '—' || (ch === '-' && p[k + 1] === '-'))) { if (ch === '-') k++; out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}
// "538. 539" → [[538],[539]]; "540—547" → [[540,547]]; "491—493." → [[491,493]].
function numbers(s) {
  const items = []; for (const part of String(s).split(/\s*[.,]\s*/).filter(Boolean)) { const m = part.match(/^(\d{1,4})(?:\s*(?:—|–|-{1,2})\s*(\d{1,4}))?$/); if (!m) return null; const a = +m[1], b = m[2] ? +m[2] : null; if (b != null && b < a) return null; items.push(b == null ? [a] : [a, b]); }
  return items.length ? items : null;
}
function parse(p, min = 4) {
  p = String(p); if (!/—|--/.test(p) || !/\(\s*\d/.test(p)) return null;
  const rs = runs(p); if (rs.length < Math.max(2, min)) return null;
  const out = []; let topics = 0;
  for (const r of rs) {
    const t = r.match(TOPIC);
    if (t && NUM.test(t[2].trim())) { const ns = numbers(t[2].trim()); if (!ns) return null; out.push({ topic: /\b[A-Z]{2,4}\.$/.test(t[1]) ? t[1] : t[1].replace(/\s*\.$/, ''), ns }); topics++; continue; }
    const h = r.match(PART);
    if (h && !/[a-z]/.test(r) && /[A-Z]{2}/.test(h[2])) { out.push({ part: h[2].replace(/\s+/g, ' ').trim(), no: h[1] || null }); continue; }
    return null;
  }
  return topics >= min ? out : null;
}
// A topic line in the body: "On the choice of light for a picture (549-554)."
function rangeLine(p) {
  if (p.length > 220 || isCaps(p) || /^\[/.test(p)) return null;
  const m = p.match(TOPIC); if (!m || !NUM.test(m[2].trim())) return null; const ns = numbers(m[2].trim()); if (!ns) return null;
  return { text: m[1].replace(/\s*\.$/, ''), ns };
}
// ---- The manuscript a note comes from: "C.A. 172b; 516b]", "Leic. 9b]", "B. 50b]". Spelled out where it is one of these.
const MSS = [
  [/^C\.\s?A\.\s*/, 'C.A.', 'Codex Atlanticus'], [/^Br\.\s?M\.\s*/, 'Br. M.', 'Codex Arundel (British Museum)'], [/^S\.\s?K\.\s?M\.\s*/, 'S.K.M.', 'the Forster codices (South Kensington Museum)'],
  [/^Leic\.\s*/, 'Leic.', 'Codex Leicester'], [/^Ash\.\s*/, 'Ash.', 'Ashburnham'], [/^Tr\.\s*/, 'Tr.', 'Codex Trivulzianus'], [/^W\.\s*/, 'W.', 'Windsor'],
];
function manuscript(line) {
  const orig = String(line).replace(/\]\s*$/, '').trim();
  for (const [re, ms, name] of MSS) { const m = orig.match(re); if (m) return { ms, name, folio: orig.slice(m[0].length).trim(), line: orig }; }
  const p = orig.match(/^([A-M])\.\s*(?=\S)/); if (p) return { ms: `${p[1]}.`, name: `Manuscript ${p[1]} (Institut de France)`, folio: orig.slice(p[0].length).trim(), line: orig };
  return { ms: null, name: null, folio: null, line: orig };
}
// ---- Recognition and the build.
function flatten(chs) {
  const F = [];
  chs.forEach((c, oc) => { if (c.plate || c.page) return; if (c.head) F.push({ t: String(c.head).trim(), oc, oj: -1, h: true }); (c.paras || []).forEach((p, oj) => F.push({ t: String(p).trim(), oc, oj, h: false })); });
  return F;
}
function detect(F) {
  let bare = 0, rise = 0, last = 0;
  for (const x of F) { const m = x.t.match(BNUM); if (m) { bare++; if (+m[1] > last) rise++; last = +m[1]; } }
  if (bare < 100 || rise < bare * 0.8) return false;
  let secs = 0; for (let i = 0; i < F.length - 1; i++) if (BROMAN.test(F[i].t) && F[i + 1].t.length <= 200 && !BNUM.test(F[i + 1].t) && !BROMAN.test(F[i + 1].t)) secs++;
  return secs >= 3;
}
// The shapes of the real text (#40, read against the live page on 14 Nov).
const CONTENTS = /^_*contents\b/i;
const HEADLINE = /^_*([IVXLC]+)\._*\s+(\S[\s\S]{1,200})$/; // a numeral and its title in one paragraph
const RANGEP = /^_?\(\s*([\dl][\dl\s.,—–-]*)\)\s*\.?_?$/; // a bare range line: "(279. 280).", "(355-361).", "(1379-l413)."
const synLike = p => /\(\s*\d[^()]*\)\s*\.?\s*(?:—|--)/.test(p) || !!parse(p, 1);
// A manuscript line by its shape: a known abbreviation, then a leaf (a number, a roman part, or Richter's o' and the like).
const SRC_AB = /^(?:C\.\s?A\.|Br\.\s?M\.|S\.\s?K\.\s?M\.|Leic\.|Ash\.|Tr\.|Triv\.|W\.|F[l1]\.|[A-M]\.|[A-Z][a-z]{1,4}\.)\s*/;
const isSrc = p => { if (p.length > 48 || !/\]$/.test(p) || /\[/.test(p) || /\b[a-z]{5,}\b/.test(p)) return false; const m = p.match(SRC_AB); if (!m) return false; const rest = p.slice(m[0].length).replace(/\]$/, ''); return /\d|^[IVX]{1,5}[ab]?\b|[a-z]['"’”]|^[A-Z][a-z]{0,3}\./.test(rest); };
function expand(s) {
  const t = String(s).replace(/l/g, '1'); const out = [];
  for (const part of t.split(/\s*[.,]\s*/).filter(Boolean)) { const m = part.match(/^(\d{1,4})(?:\s*(?:—|–|-{1,2})\s*(\d{1,4}))?$/); if (!m) return null; const a = +m[1], b = m[2] ? +m[2] : a; if (b < a || b - a > 60) out.push(a); else for (let k = a; k <= b; k++) out.push(k); }
  return out.length ? out : null;
}
const SMALLW = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'to', 'by', 'for', 'with', 'from', 'as']);
const titled = s => String(s).toLowerCase().replace(/(^|[\s(—-])([a-z][a-z’']*)/g, (m, pre, w, off) => pre + (off > 0 && SMALLW.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
function build(t, chs, guide) {
  const F = flatten(chs); if (!detect(F)) return null;
  const kind = new Array(F.length).fill(null); // 'p','intro','h','t','fn','src','skip'
  const clean = F.map(x => x.t);
  const bare = new Set(); F.forEach(x => { const m = x.t.match(BNUM); if (m) bare.add(+m[1]); });
  // Volumes: a "Volume N" paragraph opens one; the first volume may have none.
  const vols = []; F.forEach((x, i) => { if (VOL.test(x.t)) vols.push(i); });
  const ranges = []; { let s = 0; for (const v of vols) { if (v > s) ranges.push([s, v, vols.includes(s)]); s = v; } ranges.push([s, F.length, vols.includes(s)]); }
  const chapters = []; const notes = new Map(); const secByNo = new Map(); const topicNames = new Set(); const entries = [];
  let lastNote = 0, lastSec = 0, sec = null, note = null, topic = null, intro = false, pendSrc = [];
  const firstBare = (a, e) => { for (let i = a; i < e; i++) if (BNUM.test(F[i].t)) return i; return e; };
  for (const [s, e, hasVol] of ranges) {
    const vno = vols.indexOf(s) + 1 || 1;
    // The contents zone: from "CONTENTS…" (or, after a volume's title page, the first numeral or synopsis) to the
    // last synopsis before the first note that follows. Inside it a numeral is an entry, never a section.
    const fb = firstBare(s, e); let cz = -1;
    for (let i = s; i < fb; i++) if (CONTENTS.test(F[i].t)) { cz = i; break; }
    if (cz < 0 && hasVol) for (let i = s + 1; i < fb; i++) if (BROMAN.test(F[i].t) || synLike(F[i].t)) { cz = i; break; }
    // An entry's synopsis may be a single topic ("Plans of anatomical studies (796—800).") right after its numeral and title.
    const entrySyn = i => synLike(F[i].t) || (cz >= 0 && i - 2 >= cz && !!rangeLine(F[i].t) && !!romM(F[i - 2].t) && !synLike(F[i - 1].t) && !rangeLine(F[i - 1].t));
    let zEnd = cz; if (cz >= 0) for (let i = cz; i < fb; i++) if (entrySyn(i)) zEnd = i + 1;
    if (cz >= 0 && zEnd === cz) cz = -1;
    // Before it: the front matter (the first volume) or the volume's title page, each a chapter of its own.
    // Without contents: the front runs to the first note, numeral or range line.
    const fEnd = cz >= 0 ? cz : (() => { for (let i = s + (hasVol ? 1 : 0); i < e; i++) if (BNUM.test(F[i].t) || BROMAN.test(F[i].t) || RANGEP.test(F[i].t) || rangeLine(F[i].t)) return i; return e; })();
    if (fEnd > s || hasVol) {
      const front = { kind: 'front', head: hasVol ? strip_(F[s].t) : null, vol: vno, items: [] };
      for (let i = s; i < fEnd; i++) { if (i === s && hasVol) { kind[i] = 'skip'; continue; } front.items.push({ k: 'p', i }); kind[i] = 'p'; }
      chapters.push(front);
    }
    let bodyFrom = s;
    if (cz >= 0) {
      const con = { kind: 'contents', head: (vols.length > 1 || hasVol) ? `Contents of Volume ${vno}` : 'Contents', vol: vno, entries: [], span: [cz, zEnd] };
      let ent = null;
      for (let i = cz; i < zEnd; i++) {
        const p = F[i].t; kind[i] = 'skip'; if (CONTENTS.test(p)) continue;
        const r = romM(p); if (r) { ent = { no: r[1], title: null, syn: [], raw: [] }; con.entries.push(ent); continue; }
        const hl = !synLike(p) && p.match(HEADLINE); if (hl) { ent = { no: hl[1], title: strip_(hl[2]).replace(/\.$/, ''), syn: [], raw: [] }; con.entries.push(ent); continue; }
        if (entrySyn(i)) { if (!ent) { ent = { no: null, title: null, syn: [], raw: [] }; con.entries.push(ent); } const one = !synLike(p) && rangeLine(p); const sp = one ? [{ topic: one.text, ns: one.ns }] : parse(p, 1); if (sp) { ent.syn.push(...sp); for (const x of sp) if (x.topic) topicNames.add(norm(strip_(x.topic))); } else ent.raw.push(p); continue; }
        if (ent && !ent.syn.length && !ent.raw.length) { ent.title = strip_(p).replace(/\.$/, ''); continue; }
        ent = { no: null, title: strip_(p).replace(/\.$/, ''), syn: [], raw: [] }; con.entries.push(ent);
      }
      con.entries = con.entries.filter(en => en.syn.length || en.raw.length || en.title);
      // An entry with no title of its own takes the first capital run of its synopsis (section I: "PROLEGOMENA…").
      for (const en of con.entries) if (!en.title && en.syn.length && en.syn[0].part && !en.syn[0].no) en.title = titled(en.syn.shift().part);
      let k = lastSec; for (const en of con.entries) { if (en.no) k = roman(en.no); else { k++; en.no = toRoman(k); } }
      entries.push(...con.entries.map(en => ({ ...en, vol: vno })));
      chapters.push(con); bodyFrom = zEnd;
    } else if (fEnd > s) bodyFrom = fEnd;
    // The body: sections (a numeral and a mixed-case title, exactly the next section), parts (a numeral and a line in
    // capitals, restarting in each section), topics, notes.
    const open = (no, title) => { sec = { kind: 'section', no, head: `${no}. ${title}`, title, vol: vno, blocks: [], parts: 0 }; chapters.push(sec); secByNo.set(no, sec); lastSec = roman(no); note = null; topic = null; intro = true; };
    const after = i => { for (let j = i + 1; j < e && j < i + 60; j++) { const m = F[j].t.match(BNUM); if (m) return +m[1]; } return null; };
    const want = (n, i) => { if (n <= lastNote || notes.has(n)) return false; if (n <= lastNote + 80) return true; const a = after(i); return a != null && a > n && a <= n + 4; };
    const nextIsNote = i => { for (let j = i; j < e && j < i + 2; j++) { const m = F[j].t.match(BNUM); if (m) return want(+m[1], j); if (!RANGEP.test(F[j].t)) return false; return true; } return false; };
    const structural = j => BNUM.test(F[j].t) || BROMAN.test(F[j].t) || RANGEP.test(F[j].t) || isCaps(F[j].t);
    const newNote = (n, also, i) => { lastNote = Math.max(lastNote, n); note = { k: 'note', n, also: also || [], items: [], ms: [] }; sec.blocks.push(note); notes.set(n, { sec, note }); for (const a of note.also) notes.set(a, { sec, note }); if (topic) topic.notes.push(n); intro = false; if (pendSrc.length) { for (const x of pendSrc) { note.ms.push(x.mm); note.items.push(x); } pendSrc = []; } };
    for (let i = bodyFrom; i < e; i++) {
      if (kind[i]) continue; const p = F[i].t;
      // A numeral heading: on its own line with its title after it, or both in one paragraph.
      // A numeral alone on its line (#59: always alone in this text; "III. Castles and Villas." on one line is Richter's
      // list, never a section), then its title. With a guide (the contents' own numbering, below), only there.
      let hd = null; const r = romM(p);
      if (r && i + 1 < e && !BNUM.test(F[i + 1].t) && !BROMAN.test(F[i + 1].t) && F[i + 1].t.length <= 200 && !synLike(F[i + 1].t)) hd = { no: r[1], title: F[i + 1].t.replace(/\*/g, ''), span: 2 };
      if (guide && guide.has(i)) { const g = guide.get(i); kind[i] = kind[i + 1] = 'skip'; open(g.no, strip_(F[i + 1].t.replace(/\*/g, '')).replace(/\.$/, '')); i += 1; continue; }
      if (hd) {
        const caps = isCaps(hd.title);
        if ((!guide || !entries.some(x => x.no === hd.no)) && !caps && roman(hd.no) === lastSec + 1) { for (let k = 0; k < hd.span; k++) kind[i + k] = 'skip'; open(hd.no, strip_(hd.title).replace(/\.$/, '')); i += hd.span - 1; continue; }
        if (caps && sec) { for (let k = 0; k < hd.span; k++) kind[i + k] = 'skip'; sec.blocks.push({ k: 'part', no: hd.no, title: strip_(hd.title).replace(/\.$/, '') }); sec.parts++; i += hd.span - 1; note = null; topic = null; intro = false; continue; }
      }
      if (!sec) { const no = toRoman(lastSec + 1); const en = entries.find(x => x.no === no && x.vol === vno) || entries.find(x => x.no === no); open(no, en && en.title ? en.title : `Section ${no}`); }
      // A note: its number alone on a line. A number joined to its text only when it is exactly the next, the note
      // before has no footnote, its own number does not stand bare later, and the text reads as a note's.
      let m = p.match(BNUM), body = null;
      if (!m) { const ro = p.match(RUNON); if (ro && +ro[1] === lastNote + 1 && !bare.has(+ro[1]) && note && !note.items.some(x => x.k === 'fn') && !/^(\d|[a-z]|\[Footnote|On the \d)/.test(ro[2])) { m = ro; body = ro[2]; } }
      if (m && want(+m[1], i)) {
        newNote(+m[1], null, i);
        if (body != null) { clean[i] = body; note.items.push({ k: 't', i }); kind[i] = 't'; } else kind[i] = 'skip';
        continue;
      }
      // A bare range line opens those notes together: one block, anchored for each number without its own line.
      const rg = p.match(RANGEP);
      if (rg) {
        const ns = (expand(rg[1]) || []).filter(n => n > lastNote && !bare.has(n) && !notes.has(n));
        kind[i] = 'skip';
        if (ns.length) { newNote(ns[0], ns.slice(1), i); note.label = rg[1].replace(/l/g, '1').replace(/\s*-\s*/g, '–').replace(/\s*\.\s*/g, ', ').replace(/,\s*$/, ''); }
        else { if (note) note.items.push({ k: 't', i }); else sec.blocks.push({ k: 'p', i }); kind[i] = note ? 't' : 'p'; }
        continue;
      }
      const rl = rangeLine(p);
      if (rl) {
        kind[i] = 'skip'; const tp = { k: 'topic', text: rl.text, ns: rl.ns, notes: [] }; intro = false;
        if (note && !note.items.length && rl.ns[0][0] === note.n) { const at = sec.blocks.indexOf(note); sec.blocks.splice(at, 0, tp); tp.notes.push(note.n); topic = tp; continue; }
        sec.blocks.push(tp); topic = tp; note = null; continue;
      }
      if (p.length <= 120 && (/\.$/.test(p) || F[i].h) && !/\d/.test(p) && /^[A-Z‘“'"_]/.test(p) && !isCaps(p) && nextIsNote(i + 1) && (topicNames.has(norm(strip_(p))) || !note)) {
        kind[i] = 'skip'; topic = { k: 'topic', text: p.replace(/\.$/, ''), ns: null, notes: [] }; sec.blocks.push(topic); note = null; intro = false; continue;
      }
      // Richter's footnote: from "[Footnote" to the paragraph that ends "]"; never across a note's number, a numeral,
      // a range line or a capital heading (an unclosed footnote must not swallow what follows it).
      if (/^_?\[Footnote/i.test(p)) {
        const is = [i]; kind[i] = 'fn'; let j = i;
        if (!/\]_?\s*$/.test(p)) for (j = i + 1; j < e && j < i + 12 && !structural(j); j++) { is.push(j); kind[j] = 'fn'; if (/\]_?\s*$/.test(F[j].t)) break; }
        clean[i] = clean[i].replace(/^_?\[Footnote\s*([^:\]]*):?\s*/i, (x, ref) => ref ? `${ref.trim()}: ` : ''); clean[is[is.length - 1]] = clean[is[is.length - 1]].replace(/\](_?)\s*$/, '$1');
        if (note) note.items.push({ k: 'fn', is }); else sec.blocks.push({ k: 'fn', is }); i = is[is.length - 1]; continue;
      }
      if (isSrc(p)) { const mm = manuscript(p); kind[i] = 'src'; if (note) { note.ms.push(mm); note.items.push({ k: 'src', i, mm }); } else pendSrc.push({ k: 'src', i, mm }); continue; }
      if (intro) { const last = sec.blocks[sec.blocks.length - 1]; if (last && last.k === 'intro') last.is.push(i); else sec.blocks.push({ k: 'intro', is: [i] }); kind[i] = 'intro'; continue; }
      if (note) {
        if (!BROMAN.test(p) && (isCaps(p) || (F[i].h && !/[.!?\]]$/.test(p)))) { note.items.push({ k: 'h', i }); kind[i] = 'h'; continue; } // a bare numeral is never Leonardo's heading
        note.items.push({ k: 't', i }); kind[i] = 't'; continue;
      }
      sec.blocks.push({ k: 'p', i }); kind[i] = 'p';
    }
    if (pendSrc.length && sec) { for (const x of pendSrc) { sec.blocks.push({ k: 'p', i: x.i }); kind[x.i] = 'p'; } pendSrc = []; }
  }
  // The type of each paragraph: *word* and the source's _italics_, which may run across paragraphs, as emphasis. An
  // italic that has not closed within 60 paragraphs was a stray mark; no underscore reaches the page.
  const H = new Array(F.length).fill('');
  const ignore = new Set(); let openAt = -1, i = 0, on = false;
  while (i < F.length) {
    const cnt = (clean[i].match(/_/g) || []).length - (ignore.has(i) ? 1 : 0);
    if (on && i - openAt > 60) { ignore.add(openAt); i = openAt; on = false; openAt = -1; continue; }
    const nowOn = cnt % 2 ? !on : on; if (!on && nowOn) openAt = i; on = nowOn; if (!on) openAt = -1; i++;
  }
  on = false;
  for (let k = 0; k < F.length; k++) {
    let segs = clean[k].split('_'); let skipFirst = ignore.has(k);
    let h = ''; let st = on;
    for (let s = 0; s < segs.length; s++) { if (s > 0) { if (skipFirst) skipFirst = false; else st = !st; } const x = esc(segs[s]).replace(/\*([^*\n]{1,200}?)\*/g, '<em>$1</em>'); h += st && x.trim() ? `<em>${x}</em>` : x; }
    on = st; H[k] = h.replace(/<\/em><em>/g, '');
  }
  // Which chapter holds each note, and the contents' entries joined to their sections.
  const nb = { chapters, notes, F, H, kind, entries, lay: 'n2' };
  chapters.forEach((c, ci) => { c.ci = ci; });
  for (const [, v] of notes) v.chapter = v.sec.ci;
  for (const c of chapters) if (c.kind === 'contents') for (const en of c.entries) { const s = secByNo.get(en.no); en.ci = s ? s.ci : null; }
  // Where each of the old chapters begins now (a place kept under the old chaptering is carried to it).
  const where = new Array(F.length).fill(-1);
  const mark = (i, ci) => { if (i != null) where[i] = ci; };
  chapters.forEach((c, ci) => { if (c.span) for (let k = c.span[0]; k < c.span[1]; k++) mark(k, ci); for (const it of c.items || []) mark(it.i, ci); for (const b of c.blocks || []) { mark(b.i, ci); for (const x of b.is || []) mark(x, ci); for (const it of b.items || []) { mark(it.i, ci); for (const x of it.is || []) mark(x, ci); } } });
  // A line not set on its own (a numeral, a title, a note's number) belongs where the next set paragraph goes.
  for (let k = F.length - 1; k >= 0; k--) if (where[k] < 0) where[k] = k + 1 < F.length ? where[k + 1] : chapters.length - 1;
  const remap = []; for (let k = 0; k < F.length; k++) if (remap[F[k].oc] == null) remap[F[k].oc] = where[k];
  nb.remap = Array.from({ length: chs.length }, (_, k) => remap[k] == null ? 0 : remap[k]);
  // Places saved under 13 Nov's chaptering (lay 'n1', one day of ribbons and links): that build, frozen in
  // outline-n1.js, is run once here, and each of its chapters is carried to where its first line now stands.
  try {
    const old = require('./outline-n1').build(t, chs);
    const first = c => { let m = Infinity; const see = i => { if (i != null && i < m) m = i; }; if (c.span) see(c.span[0]); for (const it of c.items || []) see(it.i); for (const b of c.blocks || []) { see(b.i); for (const x of b.is || []) see(x); for (const it of b.items || []) { see(it.i); for (const x of it.is || []) see(x); } } return m; };
    nb.remap1 = old ? old.chapters.map(c => { const i = first(c); return Number.isFinite(i) ? where[i] : 0; }) : [];
  } catch (e) { nb.remap1 = []; }
  nb.text = chapters.map(c => { const is = []; for (const it of c.items || []) is.push(it.i); for (const b of c.blocks || []) { if (b.i != null) is.push(b.i); is.push(...(b.is || [])); for (const it of b.items || []) { if (it.i != null) is.push(it.i); is.push(...(it.is || [])); } } return is.map(x => clean[x]).join(' ').replace(/[_*]/g, '').replace(/\s+/g, ' ').toLowerCase(); });
  return nb;
}
function toRoman(n) { const T = [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, r] of T) while (n >= v) { s += r; n -= v; } return s || 'I'; }
// ---- Setting.
function num(nb, at, item) {
  const [a, b] = item; const label = b == null ? String(a) : `${a}–${b}`;
  let n = null; if (nb.notes.has(a)) n = a; else if (b != null) for (let k = a + 1; k <= Math.min(b, a + 400); k++) if (nb.notes.has(k)) { n = k; break; }
  let say = b == null ? `Note ${a}` : `Notes ${a} to ${b}`;
  if (n == null) { const w = within(nb, a, 60); if (!w) return `<span class="rdo-n">${label}</span>`; n = w.k; say += `, within ${w.k}–${w.up}`; }
  const c = nb.notes.get(n).chapter;
  return `<a class="rdo-n" href="${noteHref(nb, c, at, n)}" data-rd-note="n${n}" data-rd-nc="${c}" aria-label="${say}">${label}</a>`;
}
// A number with no anchor of its own (Richter gave it no line: "(453-457)" over one note): the nearest lower note that
// has one, and where the next begins, so the reader can be told "within 453–457". Null beyond `lim` numbers.
function within(nb, n, lim) {
  let k = n - 1; while (k > 0 && n - k <= lim && !nb.notes.has(k)) k--; if (!nb.notes.has(k)) return null;
  let up = n + 1; while (up < n + 400 && !nb.notes.has(up)) up++; return { k: nb.notes.get(k).note.n, up: up - 1 };
}
const noteHref = (nb, c, at, n) => `${c === at ? '' : `?c=${c}&l=${nb.lay}`}#n${n}`;
const rangeOf = tp => tp.ns ? tp.ns.map(x => x.length > 1 ? `${x[0]}–${x[1]}` : String(x[0])).join(', ') : tp.notes.length ? (tp.notes.length > 1 ? `${tp.notes[0]}–${tp.notes[tp.notes.length - 1]}` : String(tp.notes[0])) : '';
const firstOf = (nb, tp) => { if (tp.notes.length) return tp.notes[0]; if (tp.ns) for (const x of tp.ns) for (let k = x[0]; k <= (x[1] || x[0]) && k <= x[0] + 400; k++) if (nb.notes.has(k)) return k; return null; };
const inl = s => esc(String(s).replace(/_/g, '')).replace(/\*([^*\n]{1,200}?)\*/g, '<em>$1</em>');
const LABEL = 'Richter’s note'; // DRAFT for Will
const KIND = 'A book of numbered notes, gathered by subject. Each section opens with a list of what it holds; a number takes you to its note.'; // DRAFT for Will
function contents(nb, c, ci) {
  return c.entries.map((en, k) => {
    const id = `rdo-e${ci}-${k}`; const groups = []; let g = { part: null, items: [] };
    for (const r of en.syn) { if (r.part) { if (g.part || g.items.length) groups.push(g); g = { part: r, items: [] }; } else g.items.push(r); }
    if (g.part || g.items.length) groups.push(g);
    const title = `${esc(en.no)}. ${inl(en.title || '')}`;
    return `<section class="rdo-ent" aria-labelledby="${id}"><h3 id="${id}">${en.ci != null ? `<a href="?c=${en.ci}&l=${nb.lay}" data-c="${en.ci}">${title}</a>` : title}</h3>${groups.map(gr => `${gr.part ? `<h4 class="rdo-pt">${gr.part.no ? `<span>${esc(gr.part.no)}</span> ` : ''}${esc(gr.part.part)}</h4>` : ''}${gr.items.length ? `<ul class="rdo-ol">${gr.items.map(r => `<li><span class="rdo-tp">${inl(r.topic)}</span><span class="rdo-ns">${r.ns.map(x => num(nb, ci, x)).join(', ')}</span></li>`).join('')}</ul>` : ''}`).join('')}</section>`;
  }).join('');
}
function sectionNav(nb, c, ci) {
  const tops = c.blocks.filter(b => b.k === 'part' || b.k === 'topic'); if (!tops.length) return '';
  const li = tp => { const n = firstOf(nb, tp); const rg = rangeOf(tp); const txt = inl(tp.text); return `<li>${n != null ? `<a href="#n${n}" data-rd-note="n${n}" data-rd-nc="${nb.notes.get(n).chapter}">${txt}</a>` : `<span class="rdo-tp">${txt}</span>`}${rg ? `<span class="rdo-ns">${rg}</span>` : ''}</li>`; };
  let h = '', open = false, loose = [];
  for (const b of tops) {
    if (b.k === 'part') { if (loose.length) { h += loose.map(li).join(''); loose = []; } if (open) h += '</ul></li>'; h += `<li class="rdo-op"><span class="rdo-pn">${esc(b.no)}</span> ${esc(b.title)}<ul>`; open = true; }
    else if (open) h += li(b); else loose.push(b);
  }
  if (open) h += '</ul></li>'; if (loose.length) h += loose.map(li).join('');
  return `<nav class="rdo" aria-label="In this section"><p class="rdo-k" aria-hidden="true">In this section</p><ul class="rdo-ol">${h}</ul></nav>`;
}
// One chapter's body, as the reader sets it. `pix` is the reader's pictures-in-the-text (looked up by the old place).
function render(nb, ci, pix, links) {
  const c = nb.chapters[ci]; const { F, H } = nb;
  const P = (i, cls, tag = 'p') => (F[i].oj >= 0 && pix ? pix.before(F[i].oc, F[i].oj) : '') + `<${tag}${cls ? ` class="${cls}"` : ''}>${H[i]}</${tag}>` + (F[i].oj >= 0 && pix ? pix.after(F[i].oc, F[i].oj) : '');
  if (c.kind === 'front') return (ci === 0 ? `<p class="rdo-kind">${KIND}</p>` : '') + c.items.map((it, k) => P(it.i, k === 0 ? 'rdr-first' : '')).join('');
  if (c.kind === 'contents') return `${msLink(nb, '')}<nav class="rdo rdo-con" aria-label="${esc(c.head)}">${contents(nb, c, ci)}</nav>`;
  const parts = c.parts > 0; const lv = { part: 3, topic: parts ? 4 : 3 }; let inTopic = false;
  let h = sectionNav(nb, c, ci);
  for (const b of c.blocks) {
    if (b.k === 'intro') h += `<aside class="rdo-intro" aria-label="${LABEL}"><p class="rdo-lab" aria-hidden="true">${LABEL}</p>${b.is.map(i => P(i)).join('')}</aside>`;
    else if (b.k === 'part') { h += `<h3 class="rdo-pt"><span>${esc(b.no)}</span> ${esc(b.title)}</h3>`; inTopic = false; }
    else if (b.k === 'topic') { const rg = rangeOf(b); h += `<h${lv.topic} class="rdo-th">${inl(b.text)}${rg ? ` <span class="rdo-ns">${rg}</span>` : ''}</h${lv.topic}>`; inTopic = true; }
    else if (b.k === 'p') h += P(b.i);
    else if (b.k === 'fn') h += fn(b, P);
    else if (b.k === 'note') {
      const hl = Math.min(6, inTopic ? lv.topic + 1 : (parts ? 4 : 3));
      h += `<div class="rdo-note" id="n${b.n}">${(b.also || []).map(a => `<span class="rdo-al" id="n${a}"></span>`).join('')}<p class="rdo-no">${b.label ? esc(b.label) : b.n}</p>${b.items.map(it => it.k === 'h' ? P(it.i, 'rdo-lh', `h${hl}`) : it.k === 't' ? P(it.i) : it.k === 'fn' ? fn(it, P) : `<p class="rdo-src"><span class="rdo-lab">Manuscript</span> ${it.mm.name ? `${esc(it.mm.name)}${it.mm.folio ? `, ${esc(it.mm.folio)}` : ''} <span class="rdo-orig">(${esc(it.mm.line)})</span>` : esc(it.mm.line)}${links ? (lf => lf ? seeLeaf(links.get(`${lf.key}\u0000${lf.leaf}`)) : '')(leafOf(it.mm)) : ''}</p>`).join('')}</div>`;
    }
  }
  return h;
}
const fn = (b, P) => `<details class="rdo-fn"><summary>${LABEL}</summary>${b.is.map(i => P(i)).join('')}</details>`;
// ---- The cache and the doors the reader uses.
const CACHE = new Map(); const NOT = new Set();
// One miss must not cascade (#59: on live a missed III left II holding II–X, and Richter's one-line list inside XII
// then read as sections III–V). When the contents list the sections, the body's sections must agree with them: the
// same count, and each title beginning with the first two words of its contents title. If they do not, the sections
// are found again by the contents' own numbering (a numeral whose next paragraph begins with that title), and the
// host's log says how many matched: "[outline] <slug>: sections N of M matched".
const first2 = s => norm(strip_(String(s || '').replace(/\*/g, ''))).split(' ').filter(Boolean).slice(0, 2).join(' ');
function agrees(nb) {
  const secs = nb.chapters.filter(c => c.kind === 'section'); const en = nb.entries;
  if (secs.length !== en.length) return false;
  return secs.every(c => { const x = en.find(y => y.no === c.no); return x && first2(x.title) === first2(c.title); });
}
function guideOf(nb) {
  const { F } = nb; const spans = nb.chapters.filter(c => c.span).map(c => c.span); const inC = i => spans.some(([a, b]) => i >= a && i < b);
  const g = new Map(); let pos = spans.length ? spans[0][1] : 0; let found = 0;
  for (const en of nb.entries) {
    const w = first2(en.title); if (!w) continue;
    for (let i = pos; i < F.length - 1; i++) { if (inC(i)) continue; const r = romM(F[i].t); if (r && r[1] === en.no && first2(F[i + 1].t) === w) { g.set(i, { no: en.no }); pos = i + 2; found++; break; } }
  }
  g.found = found; return g;
}
function checked(t, chs) {
  const nb = build(t, chs); if (!nb || nb.entries.length < 3 || agrees(nb)) return nb;
  const g = guideOf(nb); const nb2 = build(t, chs, g); if (!nb2) return nb;
  const n2 = nb2.chapters.filter(c => c.kind === 'section').length;
  console.log(`[outline] ${t.slug}: sections ${n2} of ${nb.entries.length} matched (by the contents; the body's own reading gave ${nb.chapters.filter(c => c.kind === 'section').length})`);
  return nb2;
}
function book(t, chs) {
  if (OFF.off || !t || !chs || !chs.length || !t.body) return null;
  const key = `${t.slug}\u0000${t.updated_at || t.created_at || ''}\u0000${String(t.body).length}`;
  if (NOT.has(key)) return null;
  if (CACHE.has(key)) { const nb = CACHE.get(key); CACHE.delete(key); CACHE.set(key, nb); return nb; }
  const nb = checked(t, chs);
  if (!nb) { NOT.add(key); if (NOT.size > 500) NOT.delete(NOT.values().next().value); return null; }
  CACHE.set(key, nb); while (CACHE.size > 4) CACHE.delete(CACHE.keys().next().value);
  return nb;
}
// Where a request lands: ?n= a note; ?c= with this layout's mark (&l=) as it says; ?c= without it was a place under the
// old chaptering (a ribbon, a bookmark, a passage sent), carried to where that chapter's first line now stands; with a
// passage (?q=) the chapter that holds it. Never an error: anything else is the book's start.
function place(nb, query, at) {
  const n = parseInt(query.n, 10); if (n && nb.notes.has(n)) return { at: nb.notes.get(n).chapter, note: `n${n}`, asked: true };
  if (n > 0) { const w = within(nb, n, 200); if (w) return { at: nb.notes.get(w.k).chapter, note: `n${w.k}`, asked: true, within: `Note ${n} is within ${w.k}–${w.up}.` }; } // DRAFT for Will
  const max = nb.chapters.length - 1; const c = Math.max(0, parseInt(query.c, 10) || 0);
  if (query.c == null) return { at: 0, note: null, asked: false };
  if (String(query.l || '') === nb.lay) return { at: Math.min(max, c), note: null, asked: true };
  const old = String(query.l || '') === 'n1' && nb.remap1 && nb.remap1.length ? nb.remap1 : nb.remap;
  const q = String(query.q || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
  if (q) { const k = nb.text.findIndex(x => x.includes(q)); if (k >= 0) return { at: k, note: null, asked: true }; }
  return { at: Math.min(max, old[Math.min(c, old.length - 1)] || 0), note: null, asked: true };
}
// ---- By manuscript (#37; Will, 13–14 Nov: "even the codexes, how can we show them beautifully and help people understand
// what they are looking at"). A second way through the book: every manuscript Richter cites, its leaves in order, the
// notes written on each. Read from the manuscript lines stage 1 already parsed ({ ms, name, folio }), never from the
// text again: `byMs(nb)` is built once per built book and kept on it, so a request only joins strings.
//   The key: the abbreviation as a slug ('C.A.' → 'ca', 'Leic.' → 'leic'), with a roman or letter part that stands
//   before the leaf ('S.K.M. III. 1b' → 'skm-iii', 'W.A.II.5b' → 'w-a-ii'): Forster III is not Forster I. The leaf: a
//   number with a or b, r or v ('172b'), Richter's own text kept as its label; ordered by the number, then a before b
//   and r before v. A line with two numbers ('C.A. 172b; 516b') keeps both as written and is keyed by the first. A line
//   that does not read this way ('F1. Uff.', 'W. XII.', 'L. Ib') is listed under Other with its text: never dropped,
//   never guessed.
const LEAF = /^(\d{1,4})\s*([abrv])?$/i;
const QUAL = /^([IVX]{1,6}|[A-Z])\s*\.\s*(?=\S)|^([IVX]{1,6})\s+(?=\d)/;
const compact = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
function leafOf(mm) {
  if (!mm) return null; if (mm._lf !== undefined) return mm._lf;
  let r = null;
  if (mm.ms && mm.folio) {
    let rest = String(mm.folio).trim().replace(/\.\s*$/, '').trim(); const quals = []; let q;
    while ((q = rest.match(QUAL)) && quals.length < 3) { quals.push(q[1] || q[2]); rest = rest.slice(q[0].length).trim(); }
    const parts = rest.split(/\s*;\s*/); const first = parts[0].match(LEAF);
    if (first && parts.slice(1).every(x => LEAF.test(x))) {
      const side = first[2] ? ({ a: 1, r: 1, b: 2, v: 2 })[first[2].toLowerCase()] : 0;
      r = { key: [compact(mm.ms), ...quals.map(x => x.toLowerCase())].join('-'), abbr: `${mm.ms}${quals.length ? ' ' + quals.map(x => x + '.').join(' ') : ''}`, name: `${mm.name}${quals.length ? ', ' + quals.join(' ') : ''}`, leaf: `${+first[1]}${first[2] ? first[2].toLowerCase() : ''}`, label: parts[0], num: +first[1], side, also: parts.slice(1) };
    }
  }
  try { Object.defineProperty(mm, '_lf', { value: r, enumerable: false }); } catch (e) { /* */ }
  return r;
}
const plainOf = h => String(h || '').replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (x, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[k]).replace(/\s+/g, ' ').trim();
const cut = (s, n) => s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';
// A note in a line: Leonardo's heading if it has one, else its first words.
function gist(nb, n) {
  const v = nb.notes.get(n); if (!v) return { head: false, text: '' };
  const h = v.note.items.find(it => it.k === 'h'); if (h) return { head: true, text: cut(plainOf(nb.H[h.i]), 110) };
  const t = v.note.items.find(it => it.k === 't'); return { head: false, text: t ? cut(plainOf(nb.H[t.i]), 90) : '' };
}
const msOrder = m => m.name.replace(/^the\s+/i, '');
function byMs(nb) {
  if (!nb) return null; if (nb.byMs) return nb.byMs;
  const mss = new Map(); const other = new Map();
  for (const n of [...nb.notes.keys()].sort((a, b) => a - b)) {
    if (nb.notes.get(n).note.n !== n) continue; // a number opened with another (a range line) is listed under the first
    for (const mm of nb.notes.get(n).note.ms) {
      const lf = leafOf(mm);
      if (!lf) { const k = mm.line; if (!other.has(k)) other.set(k, { line: k, notes: [] }); const o = other.get(k); if (!o.notes.includes(n)) o.notes.push(n); continue; }
      if (!mss.has(lf.key)) mss.set(lf.key, { key: lf.key, abbr: lf.abbr, name: lf.name, leaves: new Map(), notes: 0 });
      const m = mss.get(lf.key);
      if (!m.leaves.has(lf.leaf)) m.leaves.set(lf.leaf, { leaf: lf.leaf, label: lf.label, num: lf.num, side: lf.side, notes: [] });
      const L = m.leaves.get(lf.leaf); if (L.notes.some(x => x.n === n)) continue;
      L.notes.push({ n, line: mm.line, also: lf.also, ...gist(nb, n) }); m.notes++;
    }
  }
  const list = [...mss.values()].map(m => ({ ...m, leaves: [...m.leaves.values()].sort((a, b) => a.num - b.num || a.side - b.side || a.label.localeCompare(b.label)) }))
    .sort((a, b) => msOrder(a).localeCompare(msOrder(b), 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key, 'en', { numeric: true }));
  const index = new Map(list.map(m => [m.key, m]));
  const find = s => { const c = compact(s); if (!c) return null; return index.get(String(s).trim().toLowerCase()) || list.find(m => compact(m.key) === c || compact(m.abbr) === c) || null; };
  const notesOn = (key, leaf) => { const m = index.get(key); const L = m && m.leaves.find(x => x.leaf === leaf); return L ? { m, L } : null; };
  nb.byMs = { list, other: [...other.values()], index, find, notesOn };
  return nb.byMs;
}
const hasMs = nb => !!(nb && byMs(nb).list.length);
const leafKey = s => { const m = String(s || '').trim().match(LEAF); return m ? `${+m[1]}${m[2] ? m[2].toLowerCase() : ''}` : null; };
// The page itself: the index of manuscripts, or one manuscript's leaves. `links` (leaves.js) says which leaves have a
// page in an open volume; `u` the book's address. Every sentence here is a DRAFT for Will.
const MS_LEDE = 'The notes gathered by the manuscript and leaf Richter gives for each. The leaf numbers are his.'; // DRAFT for Will
const MS_OTHER = 'Lines not read as a manuscript and a leaf, as Richter wrote them.'; // DRAFT for Will
const count = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
function seeLeaf(ps) {
  if (!ps || !ps.length) return '';
  const [a, ...more] = ps;
  return `<span class="rdm-see"><a href="${esc(a.href)}">See the leaf</a> · <a href="${esc(a.study)}">Study</a>${a.unsure ? ' · <span class="rdm-un">unsure</span>' : ''}${more.map(x => ` · <a href="${esc(x.href)}">also page ${x.p}</a>${x.unsure ? ' <span class="rdm-un">unsure</span>' : ''}`).join('')}</span>`;
}
function msPage(nb, { u, key, links }) {
  const X = byMs(nb); const m = key && key !== 'other' ? X.index.get(String(key)) : null;
  const noteLi = (x, extra = '') => `<li><a href="${u}?n=${x.n}"><b class="rdm-n">${x.n}</b> <span class="${x.head ? 'rdm-h' : 'rdm-t'}">${esc(x.text || '')}</span></a>${extra}</li>`;
  if (m) {
    return `<p class="rdm-up"><a href="${u}?by=ms">All manuscripts</a></p><h1 class="rdm-t1">${esc(m.name)} <span class="rdm-ab">${esc(m.abbr)}</span></h1><p class="rdm-ct">${count(m.leaves.length, 'leaf', 'leaves')} · ${count(m.notes, 'note', 'notes')}</p>`
      + m.leaves.map((L, k) => `<section class="rdm-lf" aria-labelledby="rdm-l${k}"><h2 id="rdm-l${k}"><span class="rdm-lk">Leaf</span> ${esc(L.label)}</h2>${links ? (s => s ? `<p class="rdm-sl">${s}</p>` : '')(seeLeaf(links.get(`${m.key}\u0000${L.leaf}`))) : ''}<ul class="rdm-ns">${L.notes.map(x => noteLi({ ...x, n: x.n }, x.also && x.also.length ? ` <span class="rdm-also">with ${esc(x.also.join('; '))}</span>` : '')).join('')}</ul></section>`).join('');
  }
  if (key === 'other' && X.other.length) {
    return `<p class="rdm-up"><a href="${u}?by=ms">All manuscripts</a></p><h1 class="rdm-t1">Other</h1><p class="rdm-ct">${esc(MS_OTHER)}</p><ul class="rdm-ot">${X.other.map(o => `<li><span class="rdm-line">${esc(o.line)}</span><span class="rdm-on">${o.notes.map(n => `<a href="${u}?n=${n}" aria-label="Note ${n}">${n}</a>`).join(', ')}</span></li>`).join('')}</ul>`;
  }
  return `<h1 class="rdm-t1">By manuscript</h1><p class="rdm-ld">${esc(MS_LEDE)}</p><ul class="rdm-ix">${X.list.map(x => `<li><a href="${u}?by=ms&amp;ms=${esc(x.key)}"><b>${esc(x.name.charAt(0).toUpperCase() + x.name.slice(1))}</b> <span class="rdm-ab">${esc(x.abbr)}</span></a><span class="rdm-ct">${count(x.leaves.length, 'leaf', 'leaves')} · ${count(x.notes, 'note', 'notes')}</span></li>`).join('')}${X.other.length ? `<li class="rdm-oi"><a href="${u}?by=ms&amp;ms=other"><b>Other</b></a><span class="rdm-ct">${count(X.other.reduce((s, o) => s + o.notes.length, 0), 'line', 'lines')}</span></li>` : ''}</ul>`;
}
const msLink = (nb, u) => hasMs(nb) ? `<p class="rdm-to"><a href="${u}?by=ms">By manuscript</a><span>the notes by the manuscript and leaf they were written on</span></p>` : ''; // DRAFT for Will
function note(nb, n) { const v = nb && nb.notes.get(+n); return v ? { n: +n, chapter: v.chapter, section: v.sec.no, ms: v.note.ms.map(m => ({ ms: m.ms, name: m.name, folio: m.folio, line: m.line })) } : null; }
const goField = nb => `<form class="rdo-go" method="get" data-rd-go><label for="rdo-go-n">Go to note</label><input id="rdo-go-n" name="n" type="number" inputmode="numeric" min="1" max="${Math.max(...nb.notes.keys())}" placeholder="548" required><button type="submit">Go</button><p class="rdo-go-say" data-rd-go-say role="status"></p></form>`;
module.exports = { OFF, parse, runs, numbers, manuscript, detect, build, book, render, place, note, goField, KIND, LABEL, CACHE, leafOf, byMs, hasMs, leafKey, msPage, msLink, seeLeaf, MS_LEDE, MS_OTHER };
