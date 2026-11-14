// The chaptering of 13 Nov (#35 stage 1, lay 'n1'), frozen: kept only so that a place saved under it (a ribbon, a
// link carrying &l=n1) can be carried to where its chapter's first line stands in today's chaptering (outline.js, #40).
// Never used to set a page. Do not change it.
const OFF = { off: false }; // the test sets it to compare the reader with all of this away
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NUM = /^\d{1,4}(?:\s*(?:\.|,|—|–|-{1,2})\s*\d{1,4})*\.?$/;
const PART = /^(?:([IVXLC]+)\.\s*)?([A-Z][A-Z\s,;:’'\-&]*[A-Z])\.?$/;
const TOPIC = /^([\s\S]*?\S)\s*\(([^()]*)\)\s*\.?$/;
const BNUM = /^(\d{1,4})\.$/;
const RUNON = /^(\d{1,4})\.\s+(\S[\s\S]*)$/;
const BROMAN = /^_*([IVXLC]+)\._*$/;
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
const isSrc = p => p.length <= 48 && /\]$/.test(p) && !/\[/.test(p) && /^[A-Z][A-Za-z0-9]*\./.test(p);
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
function build(t, chs) {
  const F = flatten(chs); if (!detect(F)) return null;
  const kind = new Array(F.length).fill(null); // what each paragraph is, for setting: 'p','syn','intro','h','t','fn','src','skip'
  const clean = F.map(x => x.t);
  // Volumes.
  const vols = []; F.forEach((x, i) => { if (VOL.test(x.t)) vols.push(i); });
  const ranges = []; { let s = 0; for (const v of vols) { if (v > s) ranges.push([s, v, ranges.length ? F[s].t : null]); s = v; } ranges.push([s, F.length, ranges.length ? F[s].t : null]); }
  if (ranges.length && vols[0] === 0) ranges[0][2] = F[0].t;
  const chapters = []; const notes = new Map(); const secByNo = new Map(); const topicNames = new Set(); const entries = [];
  let lastNote = 0, lastSec = 0;
  for (const [s0, e, volHead] of ranges) {
    let s = s0; const vno = chapters.filter(c => c.kind === 'front').length + 1;
    if (volHead) { kind[s] = 'skip'; s++; }
    // The contents: the first cluster of synopses in the volume.
    const syn = []; for (let i = s; i < e; i++) { if (BNUM.test(F[i].t) && syn.length) break; const sp = parse(F[i].t, 1); if (sp) { if (syn.length && i - syn[syn.length - 1].i > 6) break; syn.push({ i, sp }); } }
    let cStart = -1, cEnd = s;
    if (syn.length) {
      cStart = syn[0].i; if (cStart - 1 >= s && F[cStart - 1].t.length <= 160 && !BNUM.test(F[cStart - 1].t)) { cStart--; if (!BROMAN.test(F[cStart].t) && cStart - 1 >= s && BROMAN.test(F[cStart - 1].t)) cStart--; }
      cEnd = syn[syn.length - 1].i + 1;
    }
    const front = { kind: 'front', head: volHead ? strip_(volHead) : null, vol: vno, items: [] };
    const fEnd = cStart >= 0 ? cStart : (() => { for (let i = s; i < e; i++) if (BNUM.test(F[i].t) || (BROMAN.test(F[i].t) && i + 1 < e)) return i; return e; })();
    for (let i = s; i < fEnd; i++) { front.items.push({ k: 'p', i }); kind[i] = 'p'; }
    if (front.items.length || volHead || !chapters.length) chapters.push(front);
    if (cStart >= 0) {
      const con = { kind: 'contents', head: ranges.length > 1 ? `Contents of Volume ${vno}` : 'Contents', vol: vno, entries: [], span: [cStart, cEnd] };
      let ent = null; const isSyn = new Map(syn.map(x => [x.i, x.sp]));
      for (let i = cStart; i < cEnd; i++) {
        const p = F[i].t; kind[i] = 'skip';
        if (isSyn.has(i)) { if (!ent) { ent = { no: null, title: null, syn: [] }; con.entries.push(ent); } ent.syn.push(...isSyn.get(i)); for (const r of isSyn.get(i)) if (r.topic) topicNames.add(norm(r.topic.replace(/_/g, ''))); continue; }
        const r = p.match(BROMAN); if (r) { ent = { no: r[1], title: null, syn: [] }; con.entries.push(ent); continue; }
        if (ent && !ent.syn.length) { ent.title = strip_(p).replace(/\.$/, ''); continue; }
        if (!ent || ent.syn.length) { ent = { no: null, title: strip_(p).replace(/\.$/, ''), syn: [] }; con.entries.push(ent); }
      }
      con.entries = con.entries.filter(en => en.syn.length);
      // A first entry without its numeral is section I (or the one after the last).
      let k = lastSec; for (const en of con.entries) { if (en.no) k = roman(en.no); else { k++; en.no = toRoman(k); } }
      entries.push(...con.entries.map(en => ({ ...en, vol: vno })));
      chapters.push(con);
    }
    // The body: sections, parts, topics, notes.
    let sec = null, note = null, topic = null, intro = false, partSeen = false;
    // The next entry's numeral, left at the foot of the contents ("X." when the contents go on no further), is not a section.
    if (cStart >= 0 && cEnd < e && BROMAN.test(F[cEnd].t)) { const en = chapters[chapters.length - 1].entries; const lastNo = en.length ? roman(en[en.length - 1].no) : 0; if (roman(F[cEnd].t.match(BROMAN)[1]) === lastNo + 1) { kind[cEnd] = 'skip'; } }
    const open = (no, title) => { sec = { kind: 'section', no, head: `${no}. ${title}`, title, vol: vno, blocks: [], parts: 0 }; chapters.push(sec); secByNo.set(no, sec); lastSec = roman(no); note = null; topic = null; intro = true; partSeen = false; };
    // A number is the next note when it rises, and either follows closely or the next bare number follows it.
    const after = i => { for (let j = i + 1; j < e && j < i + 60; j++) { const m = F[j].t.match(BNUM); if (m) return +m[1]; } return null; };
    const want = (n, i) => { if (n <= lastNote) return false; if (n <= lastNote + 80) return true; const a = after(i); return a != null && a > n && a <= n + 4; };
    const nextIsNote = i => { const m = i < e && F[i].t.match(BNUM); return !!(m && want(+m[1], i)); };
    for (let i = cEnd; i < e; i++) {
      if (kind[i]) continue; const p = F[i].t;
      const r = p.match(BROMAN);
      if (r && i + 1 < e) {
        const nx = F[i + 1].t;
        if (isCaps(nx) && !BNUM.test(nx) && sec) { sec.blocks.push({ k: 'part', no: r[1], title: strip_(nx).replace(/\.$/, '') }); sec.parts++; kind[i] = kind[i + 1] = 'skip'; i++; note = null; topic = null; intro = false; partSeen = true; continue; }
        if ((!sec || roman(r[1]) > roman(sec.no)) && nx.length <= 200 && !BNUM.test(nx) && !isCaps(nx)) { kind[i] = kind[i + 1] = 'skip'; open(r[1], strip_(nx).replace(/\.$/, '')); i++; continue; }
      }
      if (!sec) { const no = toRoman(lastSec + 1); const en = entries.find(x => x.no === no && x.vol === vno) || entries.find(x => x.no === no); open(no, en && en.title ? en.title : `Section ${no}`); }
      let m = p.match(BNUM), body = null;
      if (!m) { const ro = p.match(RUNON); if (ro && +ro[1] === lastNote + 1 && +ro[1] >= 10) { m = ro; body = ro[2]; } }
      if (m && want(+m[1], i)) {
        const n = +m[1]; lastNote = n; note = { k: 'note', n, items: [], ms: [] }; sec.blocks.push(note); notes.set(n, { sec, note }); if (topic) topic.notes.push(n); intro = false;
        if (body != null) { clean[i] = body; note.items.push({ k: 't', i }); kind[i] = 't'; } else kind[i] = 'skip';
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
      if (/^\[Footnote/i.test(p) || /^_?\[Footnote/i.test(p)) {
        const is = []; let j = i; for (; j < e && j < i + 12; j++) { is.push(j); kind[j] = 'fn'; if (/\]_?\s*$/.test(F[j].t)) break; }
        clean[i] = clean[i].replace(/^_?\[Footnote\s*([^:\]]*):?\s*/i, (x, ref) => ref ? `${ref.trim()}: ` : ''); clean[is[is.length - 1]] = clean[is[is.length - 1]].replace(/\](_?)\s*$/, '$1');
        if (note) note.items.push({ k: 'fn', is }); else sec.blocks.push({ k: 'fn', is }); i = j; continue;
      }
      if (intro) { const last = sec.blocks[sec.blocks.length - 1]; if (last && last.k === 'intro') last.is.push(i); else sec.blocks.push({ k: 'intro', is: [i] }); kind[i] = 'intro'; continue; }
      if (note) {
        if (isSrc(p)) { const mm = manuscript(p); note.ms.push(mm); note.items.push({ k: 'src', i, mm }); kind[i] = 'src'; continue; }
        if (isCaps(p) || (F[i].h && !/[.!?\]]$/.test(p))) { note.items.push({ k: 'h', i }); kind[i] = 'h'; continue; }
        note.items.push({ k: 't', i }); kind[i] = 't'; continue;
      }
      sec.blocks.push({ k: 'p', i }); kind[i] = 'p';
    }
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
  const nb = { chapters, notes, F, H, kind, entries, lay: 'n1' };
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
  nb.text = chapters.map(c => { const is = []; for (const it of c.items || []) is.push(it.i); for (const b of c.blocks || []) { if (b.i != null) is.push(b.i); is.push(...(b.is || [])); for (const it of b.items || []) { if (it.i != null) is.push(it.i); is.push(...(it.is || [])); } } return is.map(x => clean[x]).join(' ').replace(/[_*]/g, '').replace(/\s+/g, ' ').toLowerCase(); });
  return nb;
}
function toRoman(n) { const T = [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, r] of T) while (n >= v) { s += r; n -= v; } return s || 'I'; }
module.exports = { build };
