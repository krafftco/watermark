'use strict';
// Whose hand (Will, 6 Nov: "three versions of Leonardo's Yarnwinder? He didn't paint it three different times. These are
// master copies?"). A master's page must hold the master's work, not every painting that wears the name. The tidy finds
// the same file scanned twice; this finds the work that is not theirs at all. Three witnesses, in order:
//   1. The record's own words. Museums and Commons say it plainly: "Workshop of", "Follower of", "Circle of", "After",
//      "Copy after", "Style of", "Imitator of". Those are someone else's hand → off the master's wall. "Attributed to",
//      "probably", "possibly" are scholars' attributions → they stay, marked.
//   2. The catalogue (Wikidata, read for the artist): a held work whose file is the catalogue's own image of a work the
//      artist made is theirs. Two catalogued versions of one subject (the Buccleuch and the Lansdowne Madonnas of the
//      Yarnwinder) both stand, each named by its keeper. Two files of one catalogued work: the larger stands.
//   3. The look: a work not in the catalogue that is the same composition as a catalogued one is another version, a
//      copy most likely (≥ HANDS_VERSION and under the tidy's one-picture line); the same picture outright is a repeat.
//      Anything else uncatalogued is listed for a person, never taken down by the house on its own.
// Taking down is the tidy's hand (status hidden, keep_back, `works.tidy` says why), so the tidy's Put them all back
// undoes it too; `works.hand` keeps the verdict either way. Nothing is deleted.
const sharp = require('sharp');
const pairs = require('./pairs');

const NOT_THEIRS = /\b(after|workshop|studio of|bottega|atelier|followers?|circle of|cerchia|school of|scuola|style of|manner of|imitator|copy|copied|copie|replica|pupil|assistant|derivative)\b/i;
const MAYBE = /\b(attributed|attribuito|attribué|probably|possibly|perhaps|ascribed|uncertain)\b|\?/i;
const SAME = Number(process.env.TIDY_SAME || 0.94);
const VERSION = Number(process.env.HANDS_VERSION || 0.62);
const SIG = Number(process.env.HANDS_SIG || 0.45);

function mountHands(app, { db, V, ledger, studioOnly, images, cache, originalPath }) {
  const esc = V.esc;
  for (const [c, t] of [['hand', 'TEXT'], ['hand_why', 'TEXT']]) { try { if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`); } catch (e) { /* */ } }
  const C = () => app.locals.catalogue;
  const artist = slug => db.prepare('SELECT * FROM artists WHERE slug=?').get(String(slug));

  // 1. The words. The attribution line (Artist:/Attribution: in the caption, as feeds keep it), else the title; only the
  // words before the artist's own name count ("Leonardo da Vinci, after a cartoon" is still Leonardo).
  function wordsOf(w, a) {
    const cap = String(w.caption || ''); const m = /(?:^|·\s*)(?:Artist|Attribution|Creator|Author):\s*([^·]+)/i.exec(cap);
    const line = (m ? m[1] : '').trim(); const surname = String(a.name || '').split(/\s+/).pop();
    const before = s => { const i = surname ? s.toLowerCase().indexOf(surname.toLowerCase()) : -1; return i > 0 ? s.slice(0, i) : i === 0 ? '' : s; };
    // The attribution line speaks in its own words; a title only when it says so outright ("Copy of the Mona Lisa",
    // "Workshop of …", "after Leonardo"), never "After the Bath".
    if (line) { const b = before(line); if (b && NOT_THEIRS.test(b)) return { hand: 'not', why: line.slice(0, 120) }; if (b && MAYBE.test(b)) return { hand: 'attributed', why: line.slice(0, 120) }; }
    const title = String(w.title || ''); const sn = surname ? surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '\u0000';
    if (new RegExp(`\\b((workshop|followers?|circle|school|style|manner|imitators?|studio|pupils?) of|cop(y|ies) (of|after)|replica of|after ${sn})\\b`, 'i').test(title)) return { hand: 'not', why: title.slice(0, 120) };
    if (new RegExp(`\\b(attributed to|ascribed to)\\b`, 'i').test(title)) return { hand: 'attributed', why: title.slice(0, 120) };
    return null;
  }
  // The look: the thumbnail, grey and softened, as the tidy reads it.
  async function grey(w) {
    const f = await images.derivativeOf(() => originalPath(w), cache, w.slug, 'thumb', 'jpg');
    const { data, info } = await sharp(f).rotate().greyscale().resize(160, 160, { fit: 'inside', kernel: 'cubic' }).blur(2).raw().toBuffer({ resolveWithObject: true });
    return { w: info.width, h: info.height, px: data };
  }
  const sigOf = g => { const v = pairs.sample(g, 1, 1, 0.5, 0.5, 12, 12); let m = 0; for (const x of v) m += x; m /= v.length; let n = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; n += v[i] * v[i]; } n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n; return v; };
  const dot = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * y[i]; return s; };

  const jobs = new Map();
  async function plan(a) {
    a = db.prepare('SELECT * FROM artists WHERE id=?').get(a.id) || a;
    const j = { on: true, n: 0, done: 0, plan: null, error: null }; jobs.set(a.id, j);
    try {
      const ws = db.prepare("SELECT id, slug, title, caption, source_url, width, height, original_file FROM works WHERE artist_id=? AND status='held' AND tidy IS NULL ORDER BY id").all(a.id);
      j.n = ws.length; const CT = C(); const read = !!a.catalogue_at;
      const out = { n: ws.length, at: new Date().toISOString(), catalogueRead: read, not: [], attributed: [], kept: [], repeats: [], versions: [], unknown: [] };
      const brief = (w, extra) => ({ slug: w.slug, title: w.title, w: w.width, h: w.height, ...extra });
      const rowOf = new Map(); for (const w of ws) { const r = CT && CT.rowOfWork ? CT.rowOfWork(w) : null; if (r) rowOf.set(w.id, r); }
      const rest = [];
      for (const w of ws) {
        const t = wordsOf(w, a);
        if (t && t.hand === 'not') { out.not.push(brief(w, { why: t.why })); continue; }
        if (rowOf.has(w.id)) continue; // catalogued: below
        if (t && t.hand === 'attributed') out.attributed.push(brief(w, { why: t.why }));
        rest.push(w);
      }
      // Catalogued works: one file stands for each catalogue entry (the most pixels); a second file is a repeat.
      const byRow = new Map(); for (const w of ws) { const r = rowOf.get(w.id); if (!r || out.not.some(x => x.slug === w.slug)) continue; if (!byRow.has(r.id)) byRow.set(r.id, []); byRow.get(r.id).push(w); }
      const cat = [];
      for (const [, g] of byRow) { g.sort((x, y) => (y.width * y.height) - (x.width * x.height)); const r = rowOf.get(g[0].id); out.kept.push(brief(g[0], { keeper: r.collection || null, year: r.year || null })); cat.push(g[0]); for (const o of g.slice(1)) out.repeats.push(brief(o, { why: `another file of ${g[0].slug}`, of: g[0].slug })); }
      // The look, only where the catalogue has been read and there is something catalogued to compare with.
      if (read && cat.length && rest.length) {
        const G = new Map(), S = new Map(); const settle = app.locals.governor ? () => app.locals.governor.settle('hands') : () => null;
        for (const w of [...cat, ...rest]) { try { const g = await grey(w); G.set(w.id, g); S.set(w.id, sigOf(g)); } catch (e) { console.error('[hands] look', w.slug, e.message); } j.done++; if (j.done % 25 === 0) await settle(); }
        let t0 = Date.now();
        for (const w of rest) {
          const gw = G.get(w.id); let best = 0, of = null;
          // The cheap look first (the signature against every catalogued work), the full look only on the closest three:
          // 3,000 files against 150 catalogued works must be minutes, not hours (6 Nov, Leonardo on the live house).
          if (gw) {
            const near = cat.map(c => ({ c, d: S.get(c.id) ? dot(S.get(w.id), S.get(c.id)) : -1 })).filter(x => x.d >= SIG).sort((x, y) => y.d - x.d).slice(0, 3);
            for (const { c } of near) { const gc = G.get(c.id); const v = Math.max(pairs.within(gc, gw, true), pairs.within(gw, gc, true)); if (v > best) { best = v; of = c; } }
            if (of && best >= VERSION - 0.08) { const gc = G.get(of.id); best = Math.max(best, pairs.within(gc, gw), pairs.within(gw, gc)); }
            if (Date.now() - t0 > 15) { await new Promise(r => setImmediate(r)); t0 = Date.now(); }
          }
          if (of && best >= SAME) out.repeats.push(brief(w, { why: `the same picture as ${of.slug}`, of: of.slug, v: +best.toFixed(2) }));
          else if (of && best >= VERSION) out.versions.push(brief(w, { why: `another version of ${of.title || of.slug}, not in the catalogue`, of: of.slug, v: +best.toFixed(2) }));
          else if (!out.attributed.some(x => x.slug === w.slug)) out.unknown.push(brief(w, {}));
        }
        out.attributed = out.attributed.filter(x => !out.repeats.some(r => r.slug === x.slug) && !out.versions.some(r => r.slug === x.slug));
      } else for (const w of rest) if (!out.attributed.some(x => x.slug === w.slug)) out.unknown.push(brief(w, {}));
      j.plan = out; db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(`hands_plan_${a.id}`, JSON.stringify(out));
    } catch (e) { j.error = e.message; console.error('[hands]', a.slug, e.message); }
    j.on = false; return j.plan;
  }
  const planOf = a => { const j = jobs.get(a.id); if (j && j.plan) return j.plan; try { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(`hands_plan_${a.id}`); return r ? JSON.parse(r.v) : null; } catch (e) { return null; } };

  // The hand: what is not theirs goes off the master's wall; every verdict is written on the work.
  function apply(a, p = planOf(a)) {
    if (!p) return 0; let n = 0; const now = new Date().toISOString();
    const mark = db.prepare('UPDATE works SET hand=?, hand_why=? WHERE slug=? AND artist_id=?');
    const hide = db.prepare("UPDATE works SET status='hidden', status_before='held', keep_back=1, tidy=?, tidy_at=? WHERE slug=? AND artist_id=? AND status='held' AND tidy IS NULL");
    const run = db.transaction(() => {
      for (const k of p.kept) mark.run('catalogued', k.keeper || null, k.slug, a.id);
      for (const k of p.attributed) mark.run('attributed', k.why, k.slug, a.id);
      for (const k of p.unknown) mark.run('unknown', null, k.slug, a.id);
      for (const [list, hand, say] of [[p.not, 'not', x => `not ${a.name}'s hand: ${x.why}`], [p.versions, 'version', x => x.why], [p.repeats, 'repeat', x => x.why]]) {
        for (const x of list) { mark.run(hand, x.why, x.slug, a.id); if (hide.run(say(x), now, x.slug, a.id).changes) { n++; try { ledger.append(db, 'work.tidied', x.slug, { artist: a.slug, why: say(x), by: 'hands' }); } catch (e) { /* */ } } }
      }
    }); run();
    try { db.prepare('DELETE FROM settings WHERE k=?').run(`hands_plan_${a.id}`); } catch (e) { /* */ } jobs.delete(a.id);
    try { if (app.locals.art) { app.locals.art.wall(a); app.locals.art.uncache(a.slug); } } catch (e) { /* */ } try { if (app.locals.findIndexDirty) app.locals.findIndexDirty(); } catch (e) { /* */ }
    return n;
  }
  // Every master with a catalogue read: looked at one after another in the background; Apply stays a person's press.
  const all = { on: false, done: 0, n: 0 };
  async function planAll() {
    if (all.on) return; all.on = true;
    try { const as = db.prepare("SELECT a.* FROM artists a WHERE a.catalogue_at IS NOT NULL AND EXISTS (SELECT 1 FROM works w WHERE w.artist_id=a.id AND w.status='held') ORDER BY a.name").all(); all.n = as.length; all.done = 0; for (const a of as) { await plan(a); all.done++; } }
    finally { all.on = false; }
  }

  const th = (w, cls = '') => `<a class="tyd-w ${cls}" href="/studio/works/${esc(w.slug)}" title="${esc(w.title || w.slug)} · ${w.w || '?'} × ${w.h || '?'}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span>${esc(w.title || w.slug)}<small>${w.keeper ? esc(w.keeper) + ' · ' : ''}${w.why ? esc(w.why) : ''}${w.v ? ` · ${w.v}` : ''}</small></span></a>`;
  const sect = (h, note, list, cls = '') => list.length ? `<h3>${h} · ${list.length}</h3>${note ? `<p class="note">${note}</p>` : ''}<div class="tyd-bad ${cls}">${list.slice(0, 300).map(x => th(x)).join('')}</div>` : '';
  function page(req, res, a) {
    const j = jobs.get(a.id); const p = planOf(a); const off = p ? p.not.length + p.versions.length + p.repeats.length : 0;
    const body = `<section class="studio-wrap tyd"><p class="k"><a href="/studio/art">The art</a> · <a href="/studio/art/${esc(a.slug)}">${esc(a.name)}</a> · <a href="/studio/art/${esc(a.slug)}/tidy">The tidy</a></p><h1>Whose hand</h1>
<p class="note">A master’s page holds the master’s work. The record’s own words (workshop of, follower of, after, copy), the catalogue of what ${esc(a.name)} made, and the look (the same composition as a catalogued work, but not itself catalogued) decide what is theirs. Workshop pieces, copies and extra files go off the wall, named; nothing is deleted, and the tidy’s Put them all back undoes it.</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
${a.catalogue_at ? '' : `<p class="tyd-err">The catalogue has not been read for ${esc(a.name)}: only the words will speak. Read it first on <a href="/studio/art/${esc(a.slug)}">the artist’s page</a>.</p>`}
${j && j.on ? `<p class="tyd-live">Looking… ${j.done} of ${j.n} read.</p><script>setTimeout(()=>location.reload(),4000)</script>` : `<form method="post" action="/studio/art/${esc(a.slug)}/hands/plan" class="ax-f"><button class="buy-btn">${p ? 'Look again' : 'Look at whose hand'}</button></form>`}
${j && j.error ? `<p class="tyd-err">The look stopped: ${esc(j.error)}</p>` : ''}
${p && !(j && j.on) ? `<h2>${p.kept.length} catalogued · ${off} not theirs or extra · ${p.attributed.length} attributed · ${p.unknown.length} for a look · of ${p.n}</h2>
${off ? `<form method="post" action="/studio/art/${esc(a.slug)}/hands/apply" class="ax-f tyd-apply"><button class="buy-btn">Take ${off} off ${esc(a.name)}’s wall</button></form>` : '<p class="note">Nothing to take off.</p>'}
${sect('Someone else’s hand', 'Workshop, followers, circle, after, copies: by the record’s own words.', p.not)}
${sect('Other versions, not in the catalogue', 'The same composition as a catalogued work; most likely a copy.', p.versions)}
${sect('Extra files', 'Another file of a work already on the wall.', p.repeats)}
${sect('In the catalogue: these stand', '', p.kept)}
${sect('Attributed: these stand, marked', '', p.attributed)}
${sect('Not in the catalogue: a person looks', 'The house does not take these down by itself.', p.unknown)}` : ''}</section>`;
    res.send(V.layout({ title: `Whose hand · ${a.name} · Studio · Watermark`, path: '/studio/art', studio: true, body }));
  }
  app.get('/studio/art/:slug/hands', studioOnly, (req, res) => { const a = artist(req.params.slug); if (!a) return res.sendStatus(404); page(req, res, a); });
  app.post('/studio/art/:slug/hands/plan', studioOnly, (req, res) => {
    const a = artist(req.params.slug); if (!a) return res.sendStatus(404);
    const go = () => plan(a); const G = app.locals.governor; const p = G && G.turn ? G.turn('hands', go) : go();
    if (req.body && req.body.json) return p.then(x => res.json({ ok: true, plan: x }));
    p.catch(() => null); res.redirect(`/studio/art/${a.slug}/hands`);
  });
  app.post('/studio/art/:slug/hands/apply', studioOnly, (req, res) => { const a = artist(req.params.slug); if (!a) return res.sendStatus(404); const n = apply(a); if (req.body && req.body.json) return res.json({ ok: true, n }); res.redirect(`/studio/art/${a.slug}/hands?ok=${encodeURIComponent(`${n} taken off the wall.`)}`); });
  app.post('/studio/hands/all', studioOnly, (req, res) => { planAll().catch(e => console.error('[hands]', e.message)); res.redirect('/studio/art?ok=' + encodeURIComponent('Looking at whose hand, every master with a catalogue, one after another.')); });
  app.locals.hands = { plan, planOf, apply, planAll, wordsOf, all, jobs };
  return app.locals.hands;
}
module.exports = { mountHands, NOT_THEIRS, MAYBE };
