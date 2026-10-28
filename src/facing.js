// Facing pages (Will, 25 Oct: "open up a book in two languages, like on an iPad or on a Duo, in a split screen: one
// page in English and the next in Spanish or Italian, and you could flip and switch it, so you could read a book one
// page at a time and learn a language"). The Loeb Library's way: the original on one page, the translation facing it,
// paragraph beside paragraph. Any book in the reading room, any of the house's languages: the translation is made by
// the house's AI a chapter at a time the first time anyone asks, kept in `translations`, labelled, and served to the
// next reader at once. Paragraphs stay in step, so the eye can walk between them. Nothing of who read what is kept.
// Needs ANTHROPIC_API_KEY (the guide's key); without it the Facing button is away and the API says so plainly.
'use strict';

const MODEL = () => process.env.FACING_MODEL || process.env.CLOSER_MODEL || 'claude-sonnet-5-5';
const on = () => !!process.env.ANTHROPIC_API_KEY;
const LANGS = [
  ['en', 'English'], ['es', 'Spanish'], ['it', 'Italian'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'],
  ['la', 'Latin'], ['nl', 'Dutch'], ['sv', 'Swedish'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['ko', 'Korean'], ['ar', 'Arabic'], ['ru', 'Russian'],
];
const NAME = Object.fromEntries(LANGS);
const CHUNK_PARAS = 24, CHUNK_CHARS = 9000;
const SYSTEM = `You are a literary translator of the first rank, translating a chapter of a book for a facing-page edition: the original on the left page, your translation on the right, paragraph beside paragraph, read by someone learning the language.
Rules: translate every paragraph given, in order, one for one; never merge, split, skip or add paragraphs. Keep the register, the period and the rhythm of the original; keep proper names; keep a paragraph that is only '* * *' exactly as it is. Translate the sense faithfully and idiomatically, not word for word; where the original is archaic, let the translation be a touch formal rather than modern slang. Return only a JSON array of strings, one per paragraph, with no commentary before or after it.`;

// The chapters of a text, as the reading room cuts them (the same split, so the chapter numbers agree); plates are not here.
function chaptersOf(body) {
  const chs = []; let cur = { head: null, paras: [] };
  for (const p of String(body || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) { if (/^##?\s/.test(p)) { if (cur.head || cur.paras.length) chs.push(cur); cur = { head: p.replace(/^#+\s*/, ''), paras: [] }; } else cur.paras.push(p); }
  if (cur.head || cur.paras.length) chs.push(cur);
  return chs;
}

function mountFacing(app, { db, ledger, fetchImpl }) {
  const doFetch = fetchImpl || fetch;
  db.exec(`CREATE TABLE IF NOT EXISTS translations (id INTEGER PRIMARY KEY, text_id INTEGER NOT NULL, lang TEXT NOT NULL, chapter INTEGER NOT NULL,
    head TEXT, paras TEXT NOT NULL, model TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(text_id, lang, chapter))`);
  try { db.exec("ALTER TABLE texts ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'"); } catch (e) { /* has it */ }

  const inflight = new Map(); // `${id}:${lang}:${c}` → Promise, so two readers at once make one translation

  async function ask(paras, lang, from) {
    const r = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(180000),
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 16000, system: SYSTEM, messages: [{ role: 'user', content: `Translate from ${NAME[from] || from} into ${NAME[lang] || lang}. ${paras.length} paragraphs follow as a JSON array; answer with a JSON array of exactly ${paras.length} strings.\n\n${JSON.stringify(paras)}` }] }),
    });
    if (!r.ok) throw new Error(`facing ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const m = text.match(/\[[\s\S]*\]/); if (!m) throw new Error('facing: no array');
    let out = JSON.parse(m[0]); if (!Array.isArray(out)) throw new Error('facing: not an array');
    out = out.map(s => String(s == null ? '' : s));
    // The count must agree so the pages stay in step; a short answer is padded, a long one folded into its last.
    if (out.length > paras.length) out = out.slice(0, paras.length - 1).concat([out.slice(paras.length - 1).join(' ')]);
    while (out.length < paras.length) out.push('');
    return { out, model: j.model || MODEL() };
  }

  // One chapter, translated and kept. Returns { head, paras, lang, model, at } or null when the house cannot.
  async function translate(t, c, lang) {
    const key = `${t.id}:${lang}:${c}`;
    const have = db.prepare('SELECT * FROM translations WHERE text_id=? AND lang=? AND chapter=?').get(t.id, lang, c);
    if (have) return { head: have.head, paras: JSON.parse(have.paras), lang, model: have.model, at: have.at, cached: true };
    if (!on()) return null;
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      const chs = chaptersOf(t.body); const ch = chs[c]; if (!ch) return null;
      const from = t.lang || 'en'; if (from === lang) return { head: ch.head, paras: ch.paras.slice(), lang, model: 'same', at: new Date().toISOString() };
      const paras = ch.paras; const out = new Array(paras.length).fill(''); let model = MODEL();
      // Chunks of a size the model answers whole; breaks '* * *' pass through untouched.
      let i = 0;
      while (i < paras.length) {
        let j = i, chars = 0; while (j < paras.length && j - i < CHUNK_PARAS && chars < CHUNK_CHARS) { chars += paras[j].length; j++; }
        const slice = paras.slice(i, j);
        const r = await ask(slice, lang, from); model = r.model;
        for (let k = 0; k < slice.length; k++) out[i + k] = slice[k] === '* * *' ? '* * *' : r.out[k];
        i = j;
      }
      let head = ch.head || null;
      if (head) { try { head = (await ask([head], lang, from)).out[0] || head; } catch (e) { /* the original head stands */ } }
      db.prepare('INSERT INTO translations (text_id, lang, chapter, head, paras, model) VALUES (?,?,?,?,?,?) ON CONFLICT(text_id, lang, chapter) DO UPDATE SET head=excluded.head, paras=excluded.paras, model=excluded.model').run(t.id, lang, c, head, JSON.stringify(out), model);
      try { ledger.append(db, 'text.translated', t.slug, { lang, chapter: c, model }); } catch (e) { /* the register is not the point */ }
      return { head, paras: out, lang, model, at: new Date().toISOString() };
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  const textOf = slug => db.prepare("SELECT * FROM texts WHERE slug=? AND status='held' AND public=1").get(String(slug));

  // What the reader asks for: GET /read/:slug/facing?c=&lang= → the chapter's twin. Made now if it is not yet kept
  // (the reader shows the wave meanwhile); ?peek=1 answers only what is already kept, never making one.
  app.get('/read/:slug/facing', async (req, res) => {
    const t = textOf(req.params.slug); if (!t) return res.status(404).json({ error: 'no such book' });
    const lang = String(req.query.lang || '').toLowerCase(); if (!NAME[lang]) return res.status(400).json({ error: 'not one of the house’s languages', langs: LANGS });
    const c = Math.max(0, +(req.query.c || 0) || 0); const chs = chaptersOf(t.body); if (!chs[c]) return res.status(404).json({ error: 'no such chapter' });
    if (req.query.peek) { const have = db.prepare('SELECT 1 FROM translations WHERE text_id=? AND lang=? AND chapter=?').get(t.id, lang, c); return res.json({ kept: !!have, on: on() }); }
    if (!on()) return res.status(503).json({ error: 'The house has no translator set; the facing page cannot be made yet.' });
    try {
      const r = await translate(t, c, lang); if (!r) return res.status(404).json({ error: 'nothing to translate' });
      res.set('Cache-Control', 'private, no-store'); res.json({ lang, name: NAME[lang], from: t.lang || 'en', chapter: c, head: r.head, paras: r.paras, model: r.model, at: r.at, label: r.model === 'same' ? '' : 'Translated with AI' });
      // The next chapter follows quietly, so a reader turning the page finds it waiting.
      if (chs[c + 1] && !db.prepare('SELECT 1 FROM translations WHERE text_id=? AND lang=? AND chapter=?').get(t.id, lang, c + 1)) translate(t, c + 1, lang).catch(() => {});
    } catch (e) { console.error('[facing]', e.message); res.status(502).json({ error: 'The translator did not answer; try again in a moment.' }); }
  });

  app.locals.facing = { on, LANGS, NAME, translate, chaptersOf, langOf: t => t.lang || 'en' };
}

module.exports = { mountFacing, LANGS, NAME, chaptersOf };
