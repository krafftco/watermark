// Al's edit (29 Oct, Will: "pre sort and maybe add stars to what you think are my best"; "we got to get the whole
// thing cleared and then we can give access to Michael and Brian at Leica"). A picture editor's first pass over a
// maker's whole archive: Al looks at every frame (the screen copy, never the master) and gives it a score from 1.0 to
// 5.0 with one line why, judged as a picture editor at a great agency would (light, moment, composition, what it says,
// the craft; a near-duplicate or a technical failure low), and a plain title when the frame still carries its file name.
// The score becomes stars by the maker's own spread, so the archive is graded against itself: the top 5% five stars,
// the next 15% four, the next 30% three, the next 30% two, the rest one. Al only ever raises a grade the maker left at
// 0 or 1; a maker's 2 to 5 is theirs and is never touched. Every frame that ends up at four or five is then read for
// people (art.attribute), so Hang your best can sort it the moment the edit is done. Kept on works.al_grade (JSON:
// score, why, title, at) and works.stars_by ('al' when the stars are Al's). The maker sees it all on the Library and
// can grade over it; nothing is published by the edit itself.
'use strict';

const MODEL = () => process.env.ALEDIT_MODEL || process.env.CLOSER_MODEL || 'claude-sonnet-5-5';
const FILE_NAME = /^(img|dsc|dscf|l\d|_mg|p\d|joe)[\s_-]*[a-z_ ]*\d+$|^[A-Z0-9_ -]*\d{2,}$/i;
const PCT = [[0.05, 5], [0.20, 4], [0.50, 3], [0.80, 2], [1.01, 1]];
const SYSTEM = `You are the picture editor of a great photographic agency, making the first edit of a photographer's archive. You are shown one frame and its record. Judge it as a photograph: the light, the moment, the composition, what it says, the craft. Be honest and exacting: most frames in any archive are ordinary; a near-duplicate, a test shot, a blurred or badly exposed frame scores low; only a few frames in a hundred deserve the top. Never identify a living person by name. Answer with JSON only: {"score": a number from 1.0 to 5.0 with one decimal, "why": "one short sentence on what makes it work or not, in plain words", "title": "if the record's title is a file name or a code, a plain, quiet title for the frame in title case, under six words, no quotation marks, like 'A Pool Among Cypresses'; else null"}`;

function mountAlEdit(app, { db, ledger, makerOf, isStudio, fetchImpl }) {
  for (const [c, t] of [['al_grade', 'TEXT'], ['stars_by', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const on = () => !!process.env.ANTHROPIC_API_KEY;
  const jobs = new Map(); // maker id → { running, done, total, failed, at }

  async function grade(w) {
    const buf = await app.locals.imageOf(w);
    const record = [`Title: ${w.title}`, w.place && `Place: ${w.place}`, w.taken_at && `Taken: ${String(w.taken_at).slice(0, 10)}`, w.caption && `Caption: ${String(w.caption).slice(0, 300)}`].filter(Boolean).join('\n');
    const r = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 300, system: SYSTEM, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } }, { type: 'text', text: record }] }] }),
    });
    if (!r.ok) throw new Error(`edit ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json(); if (j.stop_reason === 'refusal') return { score: 0, why: 'not read', refused: true };
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('no answer');
    const s = JSON.parse(m[0]);
    return { score: Math.max(1, Math.min(5, Math.round((+s.score || 1) * 10) / 10)), why: String(s.why || '').slice(0, 200), title: s.title ? String(s.title).replace(/["“”]/g, '').trim().slice(0, 60) : null };
  }
  // The stars by the archive's own spread; raise only, never over a grade the maker gave of two or more.
  function stars(makerId) {
    const rows = db.prepare("SELECT id, stars, stars_by, al_grade, curated FROM works WHERE maker_id=? AND al_grade IS NOT NULL AND status IN ('held','hidden')").all(makerId)
      .map(w => { let g = null; try { g = JSON.parse(w.al_grade); } catch (e) { /* none */ } return { ...w, g }; }).filter(w => w.g && !w.g.refused);
    rows.sort((a, b) => b.g.score - a.g.score); let n = 0;
    rows.forEach((w, i) => {
      const at = (i + 1) / rows.length; const s = (PCT.find(([p]) => at <= p) || [0, 1])[1];
      // Al's own grade only while the stars are still the ones Al gave; a maker who grades over it takes it back.
      const als = w.stars_by === 'al' && w.g.stars === w.stars;
      if ((w.stars || 0) >= 2 && !als) return;
      const next = Math.max(als ? 0 : (w.stars || 0), s);
      if (next !== w.stars || !als) { w.g.stars = next; db.prepare("UPDATE works SET stars=?, stars_by='al', al_grade=?, curated=CASE WHEN ?=5 THEN 1 ELSE curated END WHERE id=?").run(next, JSON.stringify(w.g), next, w.id); n++; }
    });
    return n;
  }
  function run(m, { all = false } = {}) {
    const j0 = jobs.get(m.id); if (j0 && j0.running) return j0;
    const todo = db.prepare(`SELECT * FROM works WHERE maker_id=? AND status IN ('held','hidden') AND COALESCE(flag,'')<>'reject' ${all ? '' : 'AND al_grade IS NULL'} ORDER BY id DESC`).all(m.id);
    const job = { running: true, done: 0, total: todo.length, failed: 0, retitled: 0, read: 0, at: Date.now(), last: null };
    if (!todo.length) { job.running = false; job.raised = stars(m.id); return job; }
    jobs.set(m.id, job);
    const G = app.locals.governor;
    (async () => {
      const N = Math.max(1, Number(process.env.ALEDIT_PARALLEL || 3)); let k = 0;
      const one = async () => {
        while (k < todo.length) {
          const w = todo[k++];
          try {
            const g = await grade(w); g.at = new Date().toISOString();
            db.prepare('UPDATE works SET al_grade=? WHERE id=?').run(JSON.stringify(g), w.id);
            if (g.title && FILE_NAME.test(String(w.title || '').trim())) { db.prepare('UPDATE works SET title=?, title_given=COALESCE(title_given, ?) WHERE id=?').run(g.title, w.title, w.id); job.retitled++; }
          } catch (e) { job.failed++; job.last = e.message; }
          job.done++;
          if (job.done % 25 === 0) stars(m.id);
          if (G) await G.settle('al edit');
        }
      };
      await Promise.all(Array.from({ length: N }, one));
      job.raised = stars(m.id);
      // Read the best for people, so Hang your best can sort them at once.
      const art = app.locals.art;
      if (art && art.attribute) for (const w of db.prepare("SELECT * FROM works WHERE maker_id=? AND status='hidden' AND stars>=4 AND attribution IS NULL").all(m.id)) { try { await art.attribute(w); job.read++; } catch (e) { /* stays unread */ } if (G) await G.settle('al edit'); }
      if (app.locals.findIndexDirty) app.locals.findIndexDirty();
      ledger.append(db, 'edit.al', m.handle, { graded: job.done - job.failed, raised: job.raised, retitled: job.retitled });
      job.running = false; job.at = Date.now();
    })().catch(e => { job.running = false; job.last = e.message; console.error('[al edit]', e.message); });
    return job;
  }
  const state = m => { const j = jobs.get(m.id); const graded = db.prepare('SELECT COUNT(*) n FROM works WHERE maker_id=? AND al_grade IS NOT NULL').get(m.id).n; const all = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status IN ('held','hidden')").get(m.id).n; return { on: on(), graded, all, job: j || null }; };
  app.post('/account/edit/al', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    if (!on()) return res.status(503).json({ ok: false, why: 'Al is not on (no key).' });
    const job = run(m, { all: req.body && req.body.all === '1' });
    if (!/json/.test(req.get('accept') || '') && !(req.body && req.body.json)) return res.redirect('/account/table?ok=al');
    res.json({ ok: true, ...state(m), job });
  });
  app.get('/account/edit/al', (req, res) => { const m = makerOf(req); if (!m) return res.sendStatus(401); res.set('Cache-Control', 'private, no-store').json({ ok: true, ...state(m) }); });
  // Al's picks (29 Oct, Will: "stuff that he has a real strong belief that it should be published"; street work with
  // people may hang, a single person is a portrait and waits, any child waits; "better safe than sorry"). From the house's
  // sort (Hang your best's plan at every grade, so its file checks hold), only Al's strong convictions: score ≥ min.
  // GET answers the list (nothing moves); POST with attest=1 publishes it through hangbest's own `hang`.
  async function picks(m, min) {
    const HB = app.locals.hangBest; if (!HB) return null;
    const p = await HB.plan(m, 1);
    const score = w => { try { const g = JSON.parse(w.al_grade || 'null'); return g && !g.refused ? g.score : 0; } catch (e) { return 0; } };
    const strong = x => score(x.w) >= min;
    const crowd = w => { try { const a = JSON.parse(w.attribution || 'null'); return !!(a && a.people && a.people.crowd); } catch (e) { return false; } };
    const go = [...p.clear.filter(strong), ...p.people.filter(strong).filter(x => crowd(x.w))];
    const held = { portraits: p.people.filter(strong).filter(x => !crowd(x.w)), children: p.children.filter(strong), check: p.check.filter(strong), unread: p.unread.filter(strong) };
    const row = x => ({ slug: x.w.slug, title: x.w.title, place: x.w.place, score: score(x.w), why: x.why || null });
    return { go: go.map(row).sort((a, b) => b.score - a.score), held: Object.fromEntries(Object.entries(held).map(([k, v]) => [k, v.map(row)])), works: go.map(x => x.w) };
  }
  app.get('/account/edit/al/picks', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const r = await picks(m, Number(req.query.min) || 4.3); if (!r) return res.sendStatus(503);
    res.set('Cache-Control', 'private, no-store').json({ ok: true, go: r.go, held: r.held });
  });
  app.post('/account/edit/al/picks', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    if (!req.body || req.body.attest !== '1') return res.status(400).json({ ok: false, why: 'attest' });
    const r = await picks(m, Number(req.body.min) || 4.3); if (!r) return res.sendStatus(503);
    const n = app.locals.hangBest.hang(m, r.works, 'al');
    res.json({ ok: true, published: n, go: r.go, held: r.held });
  });
  app.locals.alEdit = { grade, stars, run, state, picks, FILE_NAME };
  return app.locals.alEdit;
}
module.exports = { mountAlEdit, PCT, FILE_NAME };
