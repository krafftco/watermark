// The jacket (Will, 26 Oct: "think about when someone clicks into a book: how do we sell a book? the most beautiful
// front and back, even for a book we pulled; everything they need: the author, is this an important piece of writing,
// did it inspire a film"). Every book in the house gets the house's own front and back matter, researched on the web
// and written by Al, the way a photograph gets its guide and study: the front flap (one line, what it is and why to
// read it now, why it matters, when and where it first appeared, who should read it) and the back (the author's life,
// the book's afterlife: films, plays, operas, what it changed; in conversation with other books, linked when the house
// holds them; read further). Kept on `texts.jacket` (JSON); shown on the Library's page (`front`, `back`) and as the
// line on the reading room's cover; the Studio can write it again or hide it. Always labelled as written with AI.
'use strict';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MODEL = () => process.env.JACKET_MODEL || process.env.CLOSER_MODEL || 'claude-sonnet-5-5';

const RESEARCH_SYSTEM = `You are researching a book for the house's own jacket: the front and back matter a great bookshop or a museum's library would write. Use web search to establish what is true about the book (when and where it was first published and in what form; its reception then and its standing now; whether it was adapted into films, plays, operas, television or music, with titles and years; what it influenced) and about its author (life and dates, what else they wrote, one or two telling facts). Prefer encyclopaedias, universities, libraries, publishers and established publications. Then write plain research notes: the facts you confirmed, each with its source, and anything uncertain marked so.`;
const WRITE_SYSTEM = `You write the jacket of a book for a house that keeps the finest books, pictures and records: the front flap and the back, as the best publisher or bookseller would, for an intelligent reader who may never have heard of the book. Restrained, precise, warm; no hype, no superlatives, no exclamation marks, no 'timeless' or 'masterpiece'. Sell the book by telling the truth about it well. Never spoil an ending. Write in plain, present-tense English. Where the research is uncertain, leave the fact out rather than guess.`;
const TOOL = { name: 'write_jacket', description: 'Write the book’s jacket: its front and its back.', input_schema: { type: 'object', properties: {
  line: { type: 'string', description: 'One sentence, under 140 characters, that makes a stranger want to open it.' },
  blurb: { type: 'array', items: { type: 'string' }, description: 'Two or three short paragraphs: what the book is and why to read it now.' },
  why: { type: 'string', description: 'One paragraph: why it matters; what it changed; where it stands.' },
  firsts: { type: 'string', description: 'When, where and in what form it first appeared, in one or two sentences.' },
  read_if: { type: 'array', items: { type: 'string' }, description: 'Two to four short lines: read it if you…' },
  author: { type: 'object', properties: { name: { type: 'string' }, dates: { type: 'string', description: 'e.g. 1819–1891' }, life: { type: 'string', description: 'One paragraph on the life, with one or two telling facts.' }, also: { type: 'array', items: { type: 'string' }, description: 'Two to four other works by the author.' } }, required: ['name', 'life'] },
  afterlife: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['film', 'television', 'play', 'opera', 'music', 'adaptation', 'influence', 'other'] }, title: { type: 'string' }, year: { type: 'string' }, note: { type: 'string' } }, required: ['kind', 'title'] }, description: 'Films, plays, operas, music, what it influenced. Only what the research confirms.' },
  companions: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, author: { type: 'string' }, why: { type: 'string' } }, required: ['title', 'author', 'why'] }, description: 'Three to five books in conversation with this one, with a line why.' },
  sources: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['url'] } },
}, required: ['line', 'blurb', 'why', 'author'] } };

function parse(x) {
  let j = x; if (typeof x === 'string') { try { j = JSON.parse(x); } catch (e) { const m = x.match(/\{[\s\S]*\}/); try { j = m ? JSON.parse(m[0]) : {}; } catch (e2) { j = {}; } } }
  const s = v => String(v == null ? '' : v).trim(); const arr = v => (Array.isArray(v) ? v : []);
  return {
    line: s(j.line).slice(0, 200), blurb: arr(j.blurb).map(s).filter(Boolean).slice(0, 4), why: s(j.why), firsts: s(j.firsts), read_if: arr(j.read_if).map(s).filter(Boolean).slice(0, 5),
    author: j.author ? { name: s(j.author.name), dates: s(j.author.dates), life: s(j.author.life), also: arr(j.author.also).map(s).filter(Boolean).slice(0, 5) } : null,
    afterlife: arr(j.afterlife).filter(a => a && a.title).map(a => ({ kind: s(a.kind) || 'other', title: s(a.title), year: s(a.year), note: s(a.note) })).slice(0, 10),
    companions: arr(j.companions).filter(c => c && c.title).map(c => ({ title: s(c.title), author: s(c.author), why: s(c.why) })).slice(0, 6),
    sources: arr(j.sources).filter(x => x && /^https:\/\//.test(String(x.url))).map(x => ({ title: s(x.title), url: s(x.url) })).slice(0, 10),
  };
}
const KIND = { film: 'A film', television: 'On television', play: 'A play', opera: 'An opera', music: 'Music', adaptation: 'An adaptation', influence: 'Its influence', other: '' };

function mountJacket(app, { db, C, V, ledger, studioOnly, isStudio, fetchImpl = (...a) => fetch(...a) }) {
  try { db.exec('ALTER TABLE texts ADD COLUMN jacket TEXT'); } catch (e) { /* has it */ }
  const on = () => !!process.env.ANTHROPIC_API_KEY;
  const read = t => { if (!t || !t.jacket) return null; try { return JSON.parse(t.jacket); } catch (e) { return null; } };
  const save = (id, j) => db.prepare('UPDATE texts SET jacket=? WHERE id=?').run(JSON.stringify(j), id);
  const byName = a => { const x = String(a || '').trim(); if (!x) return ''; const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}`.replace(/\s+/g, ' ') : x; };

  async function call(body) {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST', signal: AbortSignal.timeout(180000), headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL(), ...body }) });
    if (!r.ok) { const e = new Error(`jacket ${r.status}: ${(await r.text()).slice(0, 200)}`); e.status = r.status; throw e; }
    return r.json();
  }
  // The jacket, written: research on the web first, then the jacket through a tool whose shape is fixed.
  async function write(t) {
    if (!on() || !t) return null;
    const body = String(t.body || ''); const opening = body.replace(/^##? .*$/gm, '').trim().slice(0, 2500);
    const record = [`Title: ${t.title}`, t.author && `Author: ${t.author}`, t.year && `Year: ${t.year}`, t.kind && `Kind: ${t.kind}`, t.summary && `The house's line: ${t.summary}`, t.source && `Source: ${t.source}`, opening && `The opening of the text:\n${opening}`].filter(Boolean).join('\n');
    let notes = '', seen = [], searched = true;
    try {
      const j1 = await call({ max_tokens: 3000, system: RESEARCH_SYSTEM, tools: [{ type: process.env.CLOSER_SEARCH_TOOL || 'web_search_20250305', name: 'web_search', max_uses: 5 }], messages: [{ role: 'user', content: [{ type: 'text', text: `The book:\n${record}\n\nResearch it and write your notes.` }] }] });
      (j1.content || []).forEach(b => { if (b.type === 'text') notes += b.text; if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(x => { if (x && x.url && !seen.some(y => y.url === x.url)) seen.push({ url: x.url, title: x.title || '' }); }); });
    } catch (e) { if (e.status !== 400) throw e; searched = false; }
    const j = await call({ max_tokens: 5000, system: WRITE_SYSTEM, tools: [TOOL], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content: [{ type: 'text', text: `The book:\n${record}\n\n${notes ? `Research notes (with sources):\n${notes.slice(0, 12000)}\n\nSources read:\n${seen.map(x => `${x.title} ${x.url}`).join('\n')}\n\n` : 'No web research was available; write only what you are confident of, and no afterlife you cannot vouch for.\n\n'}Write the jacket now by calling write_jacket.` }] }] });
    const use = (j.content || []).find(b => b.type === 'tool_use' && b.name === 'write_jacket');
    const jk = use ? parse(use.input || {}) : parse((j.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
    if (!jk.line && !jk.blurb.length) return null;
    if (!jk.sources.length) jk.sources = seen.slice(0, 8);
    Object.assign(jk, { searched: searched && !!notes, model: j.model || MODEL(), at: new Date().toISOString(), state: 'shown' });
    save(t.id, jk);
    try { ledger.append(db, 'text.jacketed', t.slug, { model: jk.model, hidden: true }); } catch (e) { /* */ }
    return jk;
  }
  let running = false;
  async function fill(limit = Math.max(0, parseInt(process.env.JACKET_PER_RUN || '20', 10))) {
    if (running || !on()) return 0; running = true; let n = 0;
    try {
      for (const t of db.prepare("SELECT * FROM texts WHERE status='held' AND public=1 AND jacket IS NULL AND (body IS NOT NULL OR plates IS NOT NULL) ORDER BY CASE kind WHEN 'book' THEN 0 ELSE 1 END, id").all()) {
        if (n >= limit) break;
        try { if (await write(t)) n++; else save(t.id, { missed: new Date().toISOString() }); } catch (e) { console.error('[jacket]', t.slug, e.message); if (/\b(401|403|429)\b/.test(e.message)) break; save(t.id, { missed: new Date().toISOString(), why: e.message.slice(0, 120) }); }
        await new Promise(r => setTimeout(r, 4000));
      }
    } finally { running = false; }
    return n;
  }

  // The house's books that a companion names, linked.
  const inHouse = (title, author) => { const row = db.prepare("SELECT slug, title FROM texts WHERE status='held' AND public=1 AND lower(title)=lower(?) LIMIT 1").get(title) || (author ? db.prepare("SELECT slug, title FROM texts WHERE status='held' AND public=1 AND lower(title) LIKE lower(?) AND lower(COALESCE(author,'')) LIKE lower(?) LIMIT 1").get(`%${title.split(/[:(]/)[0].trim()}%`, `%${author.split(/\s+/).pop()}%`) : null); return row ? `/library/${row.slug}` : null; };
  const shown = t => { const j = read(t); return j && j.state === 'shown' && (j.line || (j.blurb && j.blurb.length)) ? j : null; };
  const line = t => { const j = shown(t); return j ? j.line : ''; };
  const credit = j => `<p class="jk-ai">Written by Al, the house’s AI${j.searched ? ', from research on the web' : ''}; corrected by the house as it reads. ${j.sources && j.sources.length ? '' : 'Unverified: read it as a first word, not the last.'}</p>`;
  function front(t) {
    const j = shown(t); if (!j) return '';
    return `<section class="jk jk-front"><div class="jk-flap">${j.line ? `<p class="jk-line">${esc(j.line)}</p>` : ''}${j.blurb.map(p => `<p>${esc(p)}</p>`).join('')}${j.why ? `<h3>Why it matters</h3><p>${esc(j.why)}</p>` : ''}${j.firsts ? `<p class="jk-firsts">${esc(j.firsts)}</p>` : ''}${j.read_if && j.read_if.length ? `<div class="jk-readif"><h3>Read it if you</h3><ul>${j.read_if.map(x => `<li>${esc(x.replace(/^(read it )?if you\s*/i, ''))}</li>`).join('')}</ul></div>` : ''}</div></section>`;
  }
  function back(t) {
    const j = shown(t); if (!j) return '';
    const a = j.author; const af = j.afterlife || []; const co = j.companions || [];
    return `<section class="jk jk-back">${a && a.life ? `<div class="jk-author"><h3>${esc(byName(a.name || t.author || ''))}${a.dates ? ` <span>${esc(a.dates)}</span>` : ''}</h3><p>${esc(a.life)}</p>${a.also && a.also.length ? `<p class="jk-also">Also: ${a.also.map(esc).join(' · ')}</p>` : ''}</div>` : ''}
${af.length ? `<div class="jk-after"><h3>Its afterlife</h3><ul>${af.map(x => `<li><b>${esc(x.title)}</b>${x.year ? ` <span>${esc(x.year)}</span>` : ''}${KIND[x.kind] ? ` · ${KIND[x.kind]}` : ''}${x.note ? `<br><small>${esc(x.note)}</small>` : ''}</li>`).join('')}</ul></div>` : ''}
${co.length ? `<div class="jk-with"><h3>In conversation with</h3><ul>${co.map(c => { const h = inHouse(c.title, c.author); return `<li>${h ? `<a href="${h}"><b>${esc(c.title)}</b></a>` : `<b>${esc(c.title)}</b>`}${c.author ? `, ${esc(byName(c.author))}` : ''}${h ? ' <small>· in the house</small>' : ''}${c.why ? `<br><small>${esc(c.why)}</small>` : ''}</li>`; }).join('')}</ul></div>` : ''}
${j.sources && j.sources.length ? `<div class="jk-src"><h3>Read further</h3><ul>${j.sources.map(x => `<li><a href="${esc(x.url)}" rel="noopener">${esc(x.title || x.url.replace(/^https?:\/\//, '').slice(0, 60))}</a></li>`).join('')}</ul></div>` : ''}${credit(j)}</section>`;
  }

  // The Studio: write it, again, hide or show.
  app.post('/studio/library/:slug/jacket', studioOnly, async (req, res) => {
    const t = db.prepare('SELECT * FROM texts WHERE slug=?').get(String(req.params.slug)); if (!t) return res.sendStatus(404);
    const d = String((req.body || {}).do || 'write'); const j = read(t);
    if (d === 'hide' && j) { save(t.id, { ...j, state: 'hidden' }); return res.redirect(`/library/${t.slug}?ok=jacket-hidden`); }
    if (d === 'show' && j) { save(t.id, { ...j, state: 'shown' }); return res.redirect(`/library/${t.slug}?ok=jacket-shown`); }
    if (!on()) return res.redirect(`/library/${t.slug}?ok=jacket-off`);
    try { await write(t); res.redirect(`/library/${t.slug}?ok=jacket-written`); } catch (e) { console.error('[jacket]', e.message); res.redirect(`/library/${t.slug}?ok=jacket-failed`); }
  });
  const studioLine = t => { const j = read(t); return `<form method="post" action="/studio/library/${esc(t.slug)}/jacket" class="inline jk-desk"><button name="do" value="write">${j && j.line ? 'Write the jacket again' : 'Write the jacket'}</button>${j && j.line ? ` <button name="do" value="${j.state === 'hidden' ? 'show' : 'hide'}">${j.state === 'hidden' ? 'Show the jacket' : 'Hide the jacket'}</button>` : ''}</form>`; };

  if (!app.locals.noTimers && on() && process.env.NODE_ENV !== 'test') { app.locals.governor.boot('jacket fill', () => fill()); setInterval(() => fill().catch(() => {}), 30 * 60000).unref(); }
  app.locals.jacket = { on, read, write, fill, front, back, line, studioLine, parse, TOOL };
  return app.locals.jacket;
}
module.exports = { mountJacket, parse, TOOL };
