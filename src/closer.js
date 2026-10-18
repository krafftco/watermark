// Look closer: every photograph can speak. A guide written by AI from the photograph itself and its
// record (title, place, year, camera), the way a museum's wall text or audio guide would: what is in the
// frame, where and what it is, a little history, and how the picture was made. Read on the page or
// heard aloud. Always marked as written by AI; the maker can correct it, approve it or hide it.
// Needs ANTHROPIC_API_KEY in the host's settings; without it nothing is written and nothing shows.
const MODEL = () => process.env.CLOSER_MODEL || 'claude-sonnet-5-5';
const on = () => !!process.env.ANTHROPIC_API_KEY;

const SYSTEM = `You write the wall text for a photograph in a museum's collection: the short guide a visitor reads or hears while standing in front of it. Most of your readers will never visit a museum; this is theirs. Many are young and looking closely at a photograph for the first time. Make them fall in love with looking.
Write 150 to 220 words in three short paragraphs of plain prose. No headings, no lists, no quotation marks around the whole.
First paragraph: what is in the frame, so someone who cannot see it would know it, and the one thing to notice first.
Second: the place or subject: what it is, a little of its history or why it matters, told as a story rather than a fact sheet, only what you are confident of. If a name or date is uncertain, describe rather than name.
Third: how to look. The light, the composition, the moment, the camera if the record names it, and one plain-language idea from art or photography (a word like "vanishing point" or "chiaroscuro", explained in a clause) so the reader leaves knowing something they can use in front of any picture.
Voice: restrained, precise, warm, confident; a knowledgeable friend, not a lecturer. Short sentences. No hype, no superlatives, no exclamation marks, no "stunning", "breathtaking", "captures", "testament".
Never identify or guess the identity of any person from their appearance, and never speculate about anyone's private life; describe people only as figures in the scene.
Do not invent facts. Use the record you are given; if the record and the picture disagree, trust the record for names and dates.
Write about the photograph, not about yourself or the visitor. Do not mention AI.`;

// The study (Will, 18 Oct: the best art history resource there is; the friend of the most curious; the thing that
// teaches people how to think about art). Beneath the wall text, an entry in sections a curious person can go
// down as far as they like: what to look for, the place and its history, how it was made, the artists it is in
// conversation with, words worth keeping, questions to carry, and where to read further. Researched on the web
// (Anthropic's web search tool) so the history is checked and the sources are real; always marked as AI.
const STUDY_SYSTEM = `You write the study that sits beneath a photograph's wall text in a museum's collection online: the entry a curious visitor opens when they want to know everything, and the one that teaches them how to think about a picture. Your reader is intelligent, curious and new to art history. Feed that curiosity; never talk down.

Research first. Use web search to check the history of the place or subject, dates, architects, events and the artists you mention. Use only what you can confirm; if something is uncertain, say less. Prefer museums, universities, encyclopaedias, official sites and established publications as sources.

Then return ONLY one JSON object, no prose before or after, in this shape:
{
 "look": [{"what": "a short phrase naming something in this picture", "why": "two or three sentences: what it does, and what it teaches about looking"}],
 "place": {"heading": "the place or subject, named", "story": ["paragraph", "paragraph"]},
 "making": ["paragraph on light, time of day, vantage, composition, lens and camera if the record names them, and why those choices matter"],
 "lineage": [{"name": "an artist or photographer (historic or well known)", "why": "one or two sentences on the conversation between their work and this picture, and one work of theirs to look up"}],
 "words": [{"term": "a term from art or photography", "means": "what it means, in one plain sentence, as seen in this picture"}],
 "questions": ["an open question to carry while looking, one sentence"],
 "further": [{"title": "a book, essay, museum page or collection", "by": "author or institution", "url": "https://... (only from your research)"}]
}
Counts: look 3; place.story 2 to 3 paragraphs; making 1 to 2 paragraphs; lineage 2 to 3; words 2 to 4; questions 3; further 2 to 5.
Voice: restrained, precise, warm and confident; a knowledgeable friend. Short sentences. No hype, no superlatives, no exclamation marks; never "stunning", "breathtaking", "captures", "testament", "delve".
Never identify or guess the identity of any person in the photograph from their appearance; describe people only as figures in the scene. Named artists in "lineage" are fine: they are the history the picture belongs to.
Do not invent facts, works, titles or URLs. If the record and the picture disagree, trust the record for names and dates. Do not mention AI or yourself.`;

function parseStudy(text) {
  const t = String(text || ''); const a = t.indexOf('{'), z = t.lastIndexOf('}'); if (a < 0 || z <= a) throw new Error('study: no json');
  const j = JSON.parse(t.slice(a, z + 1));
  const s = v => String(v == null ? '' : v).replace(/<\/?cite[^>]*>/g, '').trim();
  const arr = (v, n) => (Array.isArray(v) ? v : []).slice(0, n);
  const out = {
    look: arr(j.look, 4).map(x => ({ what: s(x.what), why: s(x.why) })).filter(x => x.what && x.why),
    place: j.place && j.place.heading ? { heading: s(j.place.heading), story: arr(j.place.story, 4).map(s).filter(Boolean) } : null,
    making: arr(j.making, 3).map(s).filter(Boolean),
    lineage: arr(j.lineage, 4).map(x => ({ name: s(x.name), why: s(x.why) })).filter(x => x.name && x.why),
    words: arr(j.words, 5).map(x => ({ term: s(x.term), means: s(x.means) })).filter(x => x.term && x.means),
    questions: arr(j.questions, 4).map(s).filter(Boolean),
    further: arr(j.further, 6).map(x => ({ title: s(x.title), by: s(x.by), url: /^https:\/\/[^\s"<>]+$/.test(s(x.url)) ? s(x.url) : null })).filter(x => x.title),
  };
  if (!out.look.length && !out.place) throw new Error('study: empty');
  return out;
}

function mountCloser(app, { db, C, studioOnly, isStudio, makerOf, imageOf, ledger, V, fetchImpl = (...a) => fetch(...a) }) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='closer'").get()) db.exec('ALTER TABLE works ADD COLUMN closer TEXT');
  const read = w => { try { return w && w.closer ? JSON.parse(w.closer) : null; } catch (e) { return null; } };
  const save = (id, c) => db.prepare('UPDATE works SET closer=? WHERE id=?').run(c ? JSON.stringify(c) : null, id);
  const may = (req, w) => !!w && (isStudio(req) || (makerOf(req) || {}).id === w.maker_id);

  async function write(w) {
    if (!on() || !w) return null;
    const img = await imageOf(w);
    const record = [
      `Title: ${w.title}`, w.place && `Place: ${w.place}`, (w.taken_at || '').slice(0, 4) && `Year: ${(w.taken_at || '').slice(0, 4)}`,
      w.camera && `Camera: ${w.camera}${w.lens ? `, ${w.lens}` : ''}`, w.caption && `The maker's caption: ${String(w.caption).slice(0, 1200)}`,
      w.keywords && `Keywords: ${w.keywords}`,
    ].filter(Boolean).join('\n');
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 900, system: SYSTEM, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.toString('base64') } },
        { type: 'text', text: `The record for this photograph:\n${record}\n\nWrite its wall text.` },
      ] }] }),
    });
    if (!r.ok) throw new Error(`guide ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) return null;
    const c = { text, model: j.model || MODEL(), at: new Date().toISOString(), state: 'shown' };
    save(w.id, c);
    ledger.append(db, 'work.guide', w.slug, { model: c.model });
    return c;
  }

  // The study, researched: web search first, then the entry as JSON. Without the search tool (an older key or
  // model), it is written from the record and the picture alone, and says so by having no sources.
  async function study(w) {
    if (!on() || !w) return null;
    const c = read(w); if (!c) return null;
    const img = await imageOf(w);
    const record = [`Title: ${w.title}`, w.place && `Place: ${w.place}`, (w.taken_at || '').slice(0, 4) && `Year: ${(w.taken_at || '').slice(0, 4)}`,
      w.camera && `Camera: ${w.camera}${w.lens ? `, ${w.lens}` : ''}`, w.caption && `The maker's caption: ${String(w.caption).slice(0, 1200)}`, w.keywords && `Keywords: ${w.keywords}`,
      `The wall text already written: ${c.text}`].filter(Boolean).join('\n');
    const ask = async tools => {
      const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(180000),
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL(), max_tokens: 4000, system: STUDY_SYSTEM, ...(tools ? { tools } : {}), messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.toString('base64') } },
          { type: 'text', text: `The record for this photograph:\n${record}\n\nResearch it, then write its study as the JSON object.` },
        ] }] }),
      });
      if (!r.ok) { const e = new Error(`study ${r.status}: ${(await r.text()).slice(0, 200)}`); e.status = r.status; throw e; }
      return r.json();
    };
    let j, searched = true;
    try { j = await ask([{ type: process.env.CLOSER_SEARCH_TOOL || 'web_search_20250305', name: 'web_search', max_uses: 5 }]); }
    catch (e) { if (e.status !== 400) throw e; searched = false; j = await ask(null); }
    const blocks = j.content || [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
    const st = parseStudy(text);
    // Sources the search actually read, kept beside what was cited.
    const seen = [];
    blocks.forEach(b => { if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(x => { if (x && x.url && !seen.some(y => y.url === x.url)) seen.push({ url: x.url, title: x.title || '' }); }); });
    st.read = seen.slice(0, 12); st.searched = searched; st.model = j.model || MODEL(); st.at = new Date().toISOString();
    const fresh = read(w) || c; save(w.id, { ...fresh, study: st });
    return st;
  }

  // Quietly fill in every held photograph that has no guide yet, one at a time.
  let running = false;
  async function fill(limit = Infinity) {
    if (running || !on()) return 0; running = true; let n = 0;
    try {
      for (const w of db.prepare("SELECT * FROM works WHERE status='held' AND closer IS NULL ORDER BY id").all()) {
        if (n >= limit) break;
        try { if (await write(w)) n++; } catch (e) { console.error('[closer]', w.slug, e.message); if (/\b(401|403|429)\b/.test(e.message)) break; }
        await new Promise(r => setTimeout(r, 1500));
      }
      // Then the studies, best work first, paced (each runs several web searches on the house's key).
      let studies = 0; const PER = Math.max(0, parseInt(process.env.STUDY_PER_RUN || '40', 10));
      for (const w of db.prepare("SELECT * FROM works WHERE status='held' AND closer IS NOT NULL AND closer NOT LIKE '%\"study\":%' AND closer NOT LIKE '%\"studyTried\":%' ORDER BY curated DESC, stars DESC, id").all()) {
        if (n >= limit) break;
        if (studies++ >= PER) break;
        try { if (await study(w)) n++; } catch (e) { console.error('[study]', w.slug, e.message); if (/\b(401|403|429)\b/.test(e.message)) break; const c0 = read(w); if (c0) save(w.id, { ...c0, studyTried: new Date().toISOString() }); }
        await new Promise(r => setTimeout(r, 4000));
      }
    } finally { running = false; }
    return n;
  }
  app.locals.closerFill = fill;
  if (on() && process.env.NODE_ENV !== 'test') { setTimeout(() => fill().catch(() => {}), 20000).unref(); setInterval(() => fill().catch(() => {}), 30 * 60000).unref(); }

  // What the public page shows: the text, and whether the maker has read it.
  app.locals.closerOf = w => { const c = read(w); return c && c.state !== 'hidden' ? c : null; };

  // The maker's desk for one guide: read it, correct it, approve it, hide it, write it again.
  app.get('/closer/:slug', (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(String(req.params.slug)); if (!may(req, w)) return res.redirect('/studio/login');
    res.send(V.closerEdit({ w, c: read(w), on: on(), ok: req.query.ok }));
  });
  app.post('/closer/:slug', async (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(String(req.params.slug)); if (!may(req, w)) return res.sendStatus(403);
    const b = req.body || {}, c = read(w);
    try {
      if (b.act === 'write') { await write(w); return res.redirect(`/closer/${w.slug}?ok=written`); }
      if (b.act === 'study') { await study(w); return res.redirect(`/closer/${w.slug}?ok=studied`); }
      if (b.act === 'study-hide' && c) { save(w.id, { ...c, studyHidden: true }); return res.redirect(`/closer/${w.slug}?ok=saved`); }
      if (b.act === 'study-show' && c) { save(w.id, { ...c, studyHidden: false }); return res.redirect(`/closer/${w.slug}?ok=saved`); }
      if (!c) return res.redirect(`/closer/${w.slug}`);
      if (b.act === 'save') { const t = String(b.text || '').trim().slice(0, 4000); const sources = String(b.sources || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 8); const by = String(b.by || '').trim().slice(0, 80) || null;
        if (t) save(w.id, { ...c, text: t, sources, by, state: 'approved', edited: t !== c.text || !!c.edited, approvedAt: new Date().toISOString() }); }
      else if (b.act === 'hide') save(w.id, { ...c, state: 'hidden' });
      else if (b.act === 'show') save(w.id, { ...c, state: c.approvedAt ? 'approved' : 'shown' });
    } catch (e) { console.error('[closer]', e.message); return res.redirect(`/closer/${w.slug}?ok=failed`); }
    res.redirect(`/closer/${w.slug}?ok=saved`);
  });
  app.post('/studio/closer/fill', studioOnly, (req, res) => { fill().catch(() => {}); res.redirect('/studio/launch?ok=' + encodeURIComponent('Writing guides for every photograph without one, in the background.')); });

  return { write, study, fill, read, on };
}

module.exports = { mountCloser, SYSTEM, STUDY_SYSTEM, parseStudy };
