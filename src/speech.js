const ROLE = require('./role');
// The house voice (Will, 17 Oct: the browser's voice is not human enough). Every Look closer guide is read once by a
// neural voice and kept as an MP3 in the vault; the page, the viewer and the viewing room play that, and fall back to
// the browser's own voice only when no recording exists yet. Provider by environment:
//   OPENAI_API_KEY → OpenAI speech (model SPEECH_MODEL, default gpt-4o-mini-tts; voice SPEECH_VOICE, default 'ash')
//   ELEVENLABS_API_KEY → ElevenLabs (voice id SPEECH_VOICE; model SPEECH_MODEL, default eleven_multilingual_v2)
// Nothing is streamed live from a provider to a visitor: a guide is rendered once, then served from the house.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STYLE = 'You are a museum guide reading wall text aloud to one visitor standing in front of the photograph. Unhurried, warm, quiet and precise; no performance, no uplift at the end of sentences. Leave a short pause between paragraphs.';

function mountSpeech(app, { db, C, store, closerOf, fetchImpl = fetch }) {
  db.exec(`CREATE TABLE IF NOT EXISTS speech (work_id INTEGER PRIMARY KEY, hash TEXT NOT NULL, file TEXT NOT NULL, provider TEXT, voice TEXT, bytes INTEGER, made_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const dir = path.join(C.dataDir, 'speech'); fs.mkdirSync(dir, { recursive: true });
  // ElevenLabs first when both are set (Will, 20 Oct: the voice must be elegant and beautiful); OpenAI otherwise.
  const provider = () => (process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : process.env.OPENAI_API_KEY ? 'openai' : null);
  // ElevenLabs' George (a warm, unhurried British narrator from the premade library) unless SPEECH_VOICE names another.
  // (29 Oct: SPEECH_VOICE was 'ash', an OpenAI name, while ElevenLabs was the provider; every reading 404'd.) A name that is
  // not an ElevenLabs voice id (20 letters and digits) falls back to George.
  const voice = () => { const v = process.env.SPEECH_VOICE, p = provider(); if (p === 'elevenlabs') return v && /^[A-Za-z0-9]{20}$/.test(v) ? v : 'JBFqnCBsd6RMkjVDRZzb'; return v || (p === 'openai' ? 'ash' : ''); };
  const on = () => !!provider() && process.env.NODE_ENV !== 'test';
  const hashOf = text => crypto.createHash('sha256').update(`${provider()}|${voice()}|${text}`).digest('hex').slice(0, 16);

  async function render(text) {
    const p = provider(); if (!p) throw new Error('no speech provider');
    const clean = String(text).replace(/\s+\n/g, '\n').trim();
    if (p === 'openai') {
      const r = await fetchImpl('https://api.openai.com/v1/audio/speech', { method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: process.env.SPEECH_MODEL || 'gpt-4o-mini-tts', voice: voice(), input: clean, instructions: STYLE, response_format: 'mp3', speed: 0.95 }) });
      if (!r.ok) throw new Error(`speech ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return Buffer.from(await r.arrayBuffer());
    }
    const r = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice())}?output_format=mp3_44100_128`, { method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'content-type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      body: JSON.stringify({ text: clean, model_id: process.env.SPEECH_MODEL || 'eleven_multilingual_v2', voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, speed: 0.95 } }) });
    if (!r.ok) throw new Error(`speech ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return Buffer.from(await r.arrayBuffer());
  }

  // The recording for a work's current guide, made if missing (when a provider is on); null when there is none.
  async function fileFor(w, { make = true } = {}) {
    const c = closerOf(w); if (!c || !c.text) return null;
    const hash = hashOf(c.text);
    const row = db.prepare('SELECT * FROM speech WHERE work_id=?').get(w.id);
    if (row && row.hash === hash) {
      const local = path.join(dir, path.basename(row.file));
      if (!fs.existsSync(local)) { try { fs.writeFileSync(local, await store.get(row.file)); } catch (e) { return null; } }
      return local;
    }
    if (!make || !on()) return null;
    const buf = await render(c.text);
    const file = `speech/${w.slug}-${hash}.mp3`, local = path.join(dir, `${w.slug}-${hash}.mp3`);
    fs.writeFileSync(local, buf);
    try { await store.put(file, local, 'audio/mpeg'); } catch (e) { console.error('[speech] store', e.message); }
    db.prepare('INSERT INTO speech (work_id, hash, file, provider, voice, bytes, made_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET hash=excluded.hash, file=excluded.file, provider=excluded.provider, voice=excluded.voice, bytes=excluded.bytes, made_at=excluded.made_at')
      .run(w.id, hash, file, provider(), voice(), buf.length, new Date().toISOString());
    if (row && row.file !== file) { const old = path.join(dir, path.basename(row.file)); try { fs.unlinkSync(old); } catch (e) { /* gone */ } }
    return local;
  }
  const has = w => { const c = closerOf(w); if (!c) return false; const row = db.prepare('SELECT hash FROM speech WHERE work_id=?').get(w.id); return !!row && row.hash === hashOf(c.text); };

  const DAY = { d: '', n: 0 };
  const underCap = () => { const d = new Date().toISOString().slice(0, 10); if (DAY.d !== d) { DAY.d = d; DAY.n = 0; } if (DAY.n >= Number(process.env.SPEECH_DAY_MAX || 40)) return false; DAY.n++; return true; };
  // Serve it. 404 when there is no recording and none can be made: the page falls back to the browser's voice.
  app.get('/closer/:slug/audio', async (req, res) => {
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(req.params.slug);
    if (!w) return res.sendStatus(404);
    try {
      // (30 Oct, Will: the voice costs credits; "I want it to sound good if someone does it; I'm not saying we do it to
      // everybody"): a recording is made only when a person presses play (?play=1), never for a preload, and no more
      // than SPEECH_DAY_MAX (40) new ones a day; one made is kept and served to everyone after.
      const f = await fileFor(w, { make: on() && req.query.play === '1' && underCap() });
      if (!f) return res.sendStatus(404);
      res.set('Cache-Control', 'public, max-age=86400'); res.type('audio/mpeg'); res.sendFile(f);
    } catch (e) { console.error('[speech]', w.slug, e.message); res.sendStatus(404); }
  });

  // Quietly record every guide that has none yet (the best work first), one at a time.
  let running = false;
  async function fill(limit = Infinity) {
    if (running || !on()) return 0; running = true; let n = 0;
    try {
      for (const w of db.prepare("SELECT * FROM works WHERE status='held' AND closer IS NOT NULL ORDER BY curated DESC, stars DESC, id").all()) {
        if (n >= limit) break;
        if (has(w)) continue;
        try { if (await fileFor(w)) n++; } catch (e) { console.error('[speech]', w.slug, e.message); if (/\b(401|403|429|402)\b/.test(e.message)) break; }
        await new Promise(r => setTimeout(r, 800));
      }
    } finally { running = false; }
    return n;
  }
  app.locals.speech = { on, provider, voice, fileFor, has, fill, hashOf, render };
  if (on() && process.env.SPEECH_FILL === '1' && process.env.NODE_ENV !== 'test' && ROLE.chores) { /* (30 Oct) off unless asked for: every guide read in advance spent credits on pictures no one listened to */ app.locals.governor.boot('speech fill', () => fill().then(n => { if (n) console.log('[speech]', n, 'guides read'); })); setInterval(() => fill().catch(() => {}), 30 * 60000).unref(); }
  return app.locals.speech;
}

module.exports = { mountSpeech, STYLE };
