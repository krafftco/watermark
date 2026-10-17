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
      if (!c) return res.redirect(`/closer/${w.slug}`);
      if (b.act === 'save') { const t = String(b.text || '').trim().slice(0, 4000); if (t) save(w.id, { ...c, text: t, state: 'approved', edited: t !== c.text || !!c.edited, approvedAt: new Date().toISOString() }); }
      else if (b.act === 'hide') save(w.id, { ...c, state: 'hidden' });
      else if (b.act === 'show') save(w.id, { ...c, state: c.approvedAt ? 'approved' : 'shown' });
    } catch (e) { console.error('[closer]', e.message); return res.redirect(`/closer/${w.slug}?ok=failed`); }
    res.redirect(`/closer/${w.slug}?ok=saved`);
  });
  app.post('/studio/closer/fill', studioOnly, (req, res) => { fill().catch(() => {}); res.redirect('/studio/launch?ok=' + encodeURIComponent('Writing guides for every photograph without one, in the background.')); });

  return { write, fill, read, on };
}

module.exports = { mountCloser, SYSTEM };
