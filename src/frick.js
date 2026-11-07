// The Frick standard (5 Nov, Will: "pull things off the wall for these public domain painters and paintings, because
// some of the quality is just not good enough… some of them are junk: bad edges, too small, too blurry"; "we want
// consistency of quality everywhere we can"). A pass over the house's shelves (the public domain, the museums'
// open access): every picture on view is measured, then looked at by Al, and what does not meet the standard comes off
// the wall, named, reversible, never deleted (the same hand as the tidy: status hidden, keep_back, works.tidy).
//
// Measured by the house, the same way for every file:
//   size     the long side of the original (FRICK_MIN_LONG 1600 down; under FRICK_GOOD_LONG 2400 asked of Al)
//   blur     the Laplacian of the picture at 1024 px against its own contrast; under FRICK_SOFT .55 of the shelf's
//            middle (or FRICK_BLUR_FLOOR absolute) is soft
//   edges    a band at any side that is flat (a mat, a scanner bed, a white margin) or a hard frame, by how far in the
//            rows and columns stay alike to the edge; past FRICK_EDGE 3.5% of that side is a bad edge
// Looked at by Al (the screen copy and these numbers): is this a clean, whole, faithful reproduction of the work? a
// verdict (hang | check | down), a score and the faults by name. The house's own measures are never overruled by Al
// to hang: too small is down, whatever Al says.
'use strict';
const sharp = require('sharp');

const N = k => Number(process.env[k]);
const MIN_LONG = N('FRICK_MIN_LONG') || 1600;
const GOOD_LONG = N('FRICK_GOOD_LONG') || 2400;
const SOFT = N('FRICK_SOFT') || 0.55;
const BLUR_FLOOR = N('FRICK_BLUR_FLOOR') || 0.18;
const EDGE = N('FRICK_EDGE') || 0.035;
const MODEL = () => process.env.FRICK_MODEL || process.env.CLOSER_MODEL || 'claude-sonnet-5-5';
const FAULTS = ['too small', 'soft or blurred', 'bad edges', 'frame or mount showing', 'cropped or not the whole work', 'a detail', 'skewed or keystoned', 'glare or reflection', 'colour cast or faded', 'printed reproduction or halftone', 'a book page', 'text or watermark on it', 'noise or compression', 'not the artwork itself'];
const SYSTEM = `You are the head of imaging at a great museum, holding a public collection to the Frick's standard: on the wall, only clean, whole, faithful reproductions of each work. You are shown one picture of an artwork and its record, with measurements the house made. Judge the reproduction, never the art: is it sharp, large enough to look at closely, cut cleanly at the edges of the work (no ragged scan edges, no mat, no scanner bed, no frame unless the frame is part of the work), straight, evenly lit without glare, true in colour, free of text, watermarks or printing dots, and the whole work rather than a detail? Be exacting: a good scan from a museum hangs; a small, soft, skewed or badly cut file does not. Answer with JSON only: {"verdict": "hang" | "check" | "down", "score": a number from 1.0 to 5.0, "faults": [any of: ${FAULTS.map(f => `"${f}"`).join(', ')}], "why": "one short plain sentence"}`;

function mountFrick(app, { db, V, ledger, studioOnly, images, cache, originalPath, fetchImpl }) {
  const { esc } = V;
  for (const [c, t] of [['frick', 'TEXT'], ['tidy', 'TEXT'], ['tidy_at', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  const doFetch = (...a) => (api.transport || fetchImpl || fetch)(...a);
  const alOn = () => !!process.env.ANTHROPIC_API_KEY;
  const G = () => app.locals.governor;

  // The shelves: works whose maker is an institution or the house's shelf, or any work open to everyone.
  const SHELF = "(w.open IN ('pd','cc0','cc-by','cc-by-sa') OR m.kind IN ('institution') OR m.handle='the-public-domain')";
  // Living makers (7 Nov, Will: "a certain megapixel, blurriness, or resolution: we got to take it off the wall"): the
  // house measures a living maker's held work too (size, sharpness, edges; never Al, never taken down by the house); a
  // reading of 'down' keeps the work off the house's open walls only (wall.js), on its maker's own page as ever.
  const LIVING = "(w.open IS NULL AND COALESCE(m.kind,'maker') IN ('maker','estate','writer') AND m.handle<>'the-public-domain')";
  const shelfOf = s => (s && s.living ? LIVING : SHELF);
  function scopeSql(s) {
    if (s && s.living) return { sql: '', args: [] };
    if (s && s.artist) return { sql: 'AND w.artist_id=?', args: [s.artist] };
    if (s && s.maker) return { sql: 'AND w.maker_id=?', args: [s.maker] };
    return { sql: '', args: [] };
  }
  const onView = (s, unread) => { const q = scopeSql(s); return db.prepare(`SELECT w.id FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.tidy IS NULL AND ${shelfOf(s)} ${q.sql} ${unread ? 'AND w.frick IS NULL' : ''} ORDER BY w.id`).all(...q.args).map(r => r.id); };
  const row = id => db.prepare('SELECT id, slug, title, caption, width, height, artist_id, maker_id, original_file, sha256, frick, status FROM works WHERE id=?').get(id);
  const readOf = w => { try { return JSON.parse(w.frick || 'null'); } catch (e) { return null; } };

  // The house's own measures, from the screen copy (the original's size from the record).
  async function measure(w) {
    const f = await images.derivativeOf(() => originalPath(w), cache, w.slug, 'screen', 'jpg');
    const { data, info } = await sharp(f).rotate().greyscale().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, px = data;
    let sum = 0, sq = 0; for (let i = 0; i < px.length; i++) { sum += px[i]; sq += px[i] * px[i]; }
    const mean = sum / px.length, std = Math.sqrt(Math.max(0, sq / px.length - mean * mean));
    let lap = 0, n = 0; for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; const v = 4 * px[i] - px[i - 1] - px[i + 1] - px[i - W] - px[i + W]; lap += v * v; n++; }
    const sharpness = n ? Math.sqrt(lap / n) / Math.max(8, std) : 0;
    // Edges: how deep each side's band runs, a row (or column) being 'of the band' while it stays flat or stays like the edge.
    const line = (k, horiz) => { const len = horiz ? W : H; let s = 0, s2 = 0; for (let t = 0; t < len; t++) { const v = horiz ? px[k * W + t] : px[t * W + k]; s += v; s2 += v * v; } const m = s / len; return { m, sd: Math.sqrt(Math.max(0, s2 / len - m * m)) }; };
    // A band is a run of flat rows from the edge (a mat, a scanner bed, a margin) that ends abruptly; a sky fades, a margin stops.
    const depth = (horiz, from) => { const len = horiz ? H : W; const at = k => line(from ? k : len - 1 - k, horiz); let d = 0, bm = 0; for (let k = 0; k < len * 0.25; k++) { const l = at(k); if (l.sd < 5) { d++; bm += l.m; } else break; } if (!d) return 0; bm /= d; let nm = 0, ns = 0; const t = Math.min(3, Math.floor(len * 0.25) - d); if (t <= 0) return d / len; for (let k = d; k < d + t; k++) { const l = at(k); nm += l.m; ns += l.sd; } nm /= t; ns /= t; return (Math.abs(nm - bm) > 18 || ns > 20) ? d / len : 0; };
    const edges = { top: depth(true, true), bottom: depth(true, false), left: depth(false, true), right: depth(false, false) };
    const long = Math.max(w.width || 0, w.height || 0);
    return { long, mp: Math.round((w.width || 0) * (w.height || 0) / 1e4) / 100, sharpness: Math.round(sharpness * 1000) / 1000, edges: Object.fromEntries(Object.entries(edges).map(([k, v]) => [k, Math.round(v * 1000) / 1000])), std: Math.round(std) };
  }
  function houseFaults(m, middle) {
    const f = [];
    if (m.long && m.long < MIN_LONG) f.push({ k: 'too small', hard: true, why: `${m.long} px on the long side` });
    else if (m.long && m.long < GOOD_LONG) f.push({ k: 'too small', hard: false, why: `${m.long} px on the long side` });
    if (m.sharpness < BLUR_FLOOR || (middle && m.sharpness < middle * SOFT)) f.push({ k: 'soft or blurred', hard: m.sharpness < BLUR_FLOOR * 0.7, why: `sharpness ${m.sharpness}${middle ? ` against the shelf's ${Math.round(middle * 1000) / 1000}` : ''}` });
    const bad = Object.entries(m.edges).filter(([, v]) => v > EDGE);
    if (bad.length) f.push({ k: 'bad edges', hard: bad.some(([, v]) => v > EDGE * 3), why: bad.map(([s, v]) => `${s} ${Math.round(v * 100)}%`).join(', ') });
    if (m.std < 6) f.push({ k: 'blank', hard: true, why: 'nothing in it' });
    return f;
  }

  async function look(w, m, hf) {
    const buf = await app.locals.imageOf(w);
    const record = [`Title: ${w.title}`, w.caption && `Record: ${String(w.caption).slice(0, 400)}`, `Measured by the house: original ${w.width} × ${w.height} px (${m.mp} MP); sharpness ${m.sharpness}; flat or framed band at the edges: ${Object.entries(m.edges).map(([s, v]) => `${s} ${Math.round(v * 100)}%`).join(', ')}`, hf.length && `The house noticed: ${hf.map(f => `${f.k} (${f.why})`).join('; ')}`].filter(Boolean).join('\n');
    const r = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 300, system: SYSTEM, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } }, { type: 'text', text: record }] }] }),
    });
    if (!r.ok) throw new Error(`look ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json(); if (j.stop_reason === 'refusal') return { verdict: 'check', score: 0, faults: [], why: 'not read' };
    const t = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join(''); const mm = t.match(/\{[\s\S]*\}/); if (!mm) throw new Error('no answer');
    const s = JSON.parse(mm[0]);
    return { verdict: ['hang', 'check', 'down'].includes(s.verdict) ? s.verdict : 'check', score: Math.max(1, Math.min(5, +s.score || 3)), faults: (Array.isArray(s.faults) ? s.faults : []).map(String).filter(f => FAULTS.includes(f)).slice(0, 6), why: String(s.why || '').slice(0, 220) };
  }
  // The verdict: the house's hard faults take it down; Al's down takes it down; anything soft is a person's look.
  function decide(hf, al) {
    if (hf.some(f => f.hard)) return 'down';
    if (al && al.verdict === 'down' && al.score <= 2.5) return 'down';
    if (al && al.verdict === 'hang' && al.score >= 3.5 && !hf.length) return 'hang';
    if (al && al.verdict === 'hang' && al.score >= 4 && hf.every(f => f.k !== 'too small')) return 'hang';
    if (!al && !hf.length) return 'hang';
    return 'check';
  }

  const jobs = new Map(); // scope key → { running, done, total, down, check, hang, failed, at, last, auto }
  const keyOf = s => s && s.living ? 'living' : s && s.artist ? `a:${s.artist}` : s && s.maker ? `m:${s.maker}` : 'all';
  function takeDown(w, why, by = 'frick') {
    const r = db.prepare("UPDATE works SET status='hidden', status_before='held', keep_back=1, tidy=?, tidy_at=? WHERE id=? AND status='held' AND tidy IS NULL").run(`below the standard: ${why}`, new Date().toISOString(), w.id);
    if (r.changes) { try { ledger.append(db, 'work.tidied', w.slug, { by, why }); } catch (e) { /* */ } }
    return r.changes;
  }
  function after(ids) {
    const A = app.locals.art; const seen = new Set();
    for (const id of ids) { const w = db.prepare('SELECT artist_id FROM works WHERE id=?').get(id); if (!w || !w.artist_id || seen.has(w.artist_id)) continue; seen.add(w.artist_id); try { const a = db.prepare('SELECT * FROM artists WHERE id=?').get(w.artist_id); if (a && A) { A.wall(a); A.uncache(a.slug); } } catch (e) { /* the page follows within the minute */ } }
    try { if (app.locals.findIndexDirty) app.locals.findIndexDirty(); } catch (e) { /* */ }
  }
  function run(s = {}, { again = false, auto = false } = {}) {
    const k = keyOf(s); const j0 = jobs.get(k); if (j0 && j0.running) return j0;
    const living = !!(s && s.living); if (living) auto = false; // the house never takes a living maker's work down
    const ids = onView(s, !again);
    const job = { running: true, done: 0, total: ids.length, down: 0, check: 0, hang: 0, failed: 0, taken: 0, at: Date.now(), last: null, auto, al: alOn() };
    jobs.set(k, job); if (!ids.length) { job.running = false; return job; }
    (async () => {
      // The shelf's middle sharpness, from what is already read and the first files read now.
      const prior = db.prepare(`SELECT w.frick FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.frick IS NOT NULL AND ${shelfOf(s)} LIMIT 4000`).all().map(r => { try { return JSON.parse(r.frick).m.sharpness; } catch (e) { return null; } }).filter(x => x > 0);
      const mid = () => { const a = prior.slice().sort((x, y) => x - y); return a.length >= 12 ? a[Math.floor(a.length / 2)] : null; };
      const P = Math.max(1, N('FRICK_PARALLEL') || 3); let i = 0; const downIds = [];
      const one = async () => {
        while (i < ids.length) {
          const w = row(ids[i++]); if (!w || w.status !== 'held') { job.done++; continue; }
          try {
            const m = await measure(w); prior.push(m.sharpness);
            const hf = houseFaults(m, mid());
            let al = null; if (alOn() && !living && !hf.some(f => f.hard)) { try { al = await look(w, m, hf); } catch (e) { job.last = e.message; } }
            const verdict = decide(hf, al);
            const reading = { at: new Date().toISOString(), m, house: hf, al, verdict, by: al ? 'house and Al' : 'house' };
            db.prepare('UPDATE works SET frick=? WHERE id=?').run(JSON.stringify(reading), w.id);
            job[verdict]++;
            if (verdict === 'down' && auto && takeDown(w, whyOf(reading))) { job.taken++; downIds.push(w.id); }
          } catch (e) { job.failed++; job.last = e.message; }
          job.done++; const g = G(); if (g && g.settle && job.done % 4 === 0) await g.settle('the standard'); else await new Promise(r => setImmediate(r));
        }
      };
      await Promise.all(Array.from({ length: P }, one));
      if (downIds.length) after(downIds);
      try { ledger.append(db, 'frick.read', k, { read: job.done - job.failed, down: job.down, check: job.check, taken: job.taken }); } catch (e) { /* */ }
      job.running = false; job.at = Date.now();
    })().catch(e => { job.running = false; job.last = e.message; console.error('[frick]', e.message); });
    return job;
  }
  const whyOf = r => [...(r.house || []).map(f => f.k), ...((r.al && r.al.faults) || [])].filter((x, i, a) => a.indexOf(x) === i).join(', ') || (r.al && r.al.why) || 'below the standard';
  // The readings that wait for the hand: down (to take off) and check (a person looks), by scope.
  function waiting(s, verdict) {
    const q = scopeSql(s);
    return db.prepare(`SELECT w.id, w.slug, w.title, w.width, w.height, w.frick FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.tidy IS NULL AND w.frick IS NOT NULL AND ${shelfOf(s)} ${q.sql} ORDER BY w.id`).all(...q.args)
      .map(w => ({ ...w, r: readOf(w) })).filter(w => w.r && w.r.verdict === verdict);
  }
  function apply(s, slugs) {
    if (s && s.living) return 0; // a living maker's work is never taken down by the house's rule; a person's hand only
    const list = waiting(s, 'down').filter(w => !slugs || slugs.includes(w.slug)); let n = 0; const ids = [];
    db.transaction(() => { for (const w of list) if (takeDown(w, whyOf(w.r))) { n++; ids.push(w.id); } })();
    after(ids); return n;
  }
  function putBack(s) {
    const q = scopeSql(s);
    const rows = db.prepare(`SELECT w.id, w.slug FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.tidy LIKE 'below the standard:%' AND ${SHELF} ${q.sql}`).all(...q.args);
    db.transaction(() => { for (const w of rows) { db.prepare("UPDATE works SET status='held', keep_back=0, tidy=NULL, tidy_at=NULL WHERE id=?").run(w.id); try { ledger.append(db, 'work.untidied', w.slug, { by: 'frick' }); } catch (e) { /* */ } } })();
    after(rows.map(r => r.id)); return rows.length;
  }
  function keep(slug) { // a person says it hangs: read as hang, never asked again unless read again
    const w = db.prepare('SELECT id, frick FROM works WHERE slug=?').get(slug); if (!w) return 0;
    const r = readOf(w) || {}; r.verdict = 'hang'; r.kept = new Date().toISOString(); db.prepare('UPDATE works SET frick=? WHERE id=?').run(JSON.stringify(r), w.id);
    try { ledger.append(db, 'frick.kept', slug, {}); } catch (e) { /* the open wander's pool is keyed on the register's head */ } return 1;
  }

  // The desk.
  const scopeOf = q => { if (q.living) return { s: { living: true }, label: 'Living makers', qs: 'living=1' }; const a = q.artist ? db.prepare('SELECT id, slug, name FROM artists WHERE slug=?').get(String(q.artist)) : null; const m = !a && q.maker ? db.prepare('SELECT id, handle, name FROM makers WHERE handle=?').get(String(q.maker)) : null; return { s: a ? { artist: a.id } : m ? { maker: m.id } : {}, label: a ? a.name : m ? m.name : 'Every shelf', qs: a ? `artist=${encodeURIComponent(a.slug)}` : m ? `maker=${encodeURIComponent(m.handle)}` : '' }; };
  const tile = (w, act) => { const r = w.r || {}; const f = whyOf(r); return `<figure class="fk-w"><a href="/studio/works/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"></a><figcaption><b>${esc(w.title || w.slug)}</b><small>${w.width || '?'} × ${w.height || '?'}${r.al ? ` · Al ${r.al.score}` : ''}</small><i>${esc(f)}</i>${r.al && r.al.why ? `<em>${esc(r.al.why)}</em>` : ''}${act || ''}</figcaption></figure>`; };
  app.get('/studio/standard', studioOnly, (req, res) => {
    const sc = scopeOf(req.query); const k = keyOf(sc.s); const j = jobs.get(k);
    const onN = onView(sc.s, false).length, unread = onView(sc.s, true).length;
    const down = waiting(sc.s, 'down'), check = waiting(sc.s, 'check');
    const q = scopeSql(sc.s);
    const gone = db.prepare(`SELECT w.slug, w.title, w.tidy FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.tidy LIKE 'below the standard:%' AND ${SHELF} ${q.sql} ORDER BY w.tidy_at DESC LIMIT 300`).all(...q.args);
    const goneN = db.prepare(`SELECT COUNT(*) n FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.tidy LIKE 'below the standard:%' AND ${SHELF} ${q.sql}`).get(...q.args).n;
    const artists = db.prepare(`SELECT a.slug, a.name, COUNT(*) n, SUM(CASE WHEN w.frick IS NULL THEN 1 ELSE 0 END) u FROM works w JOIN makers m ON m.id=w.maker_id JOIN artists a ON a.id=w.artist_id WHERE w.status='held' AND w.tidy IS NULL AND ${SHELF} GROUP BY a.slug, a.name ORDER BY COUNT(*) DESC LIMIT 60`).all();
    const insts = db.prepare(`SELECT m.handle, m.name, COUNT(*) n FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.tidy IS NULL AND ${SHELF} GROUP BY m.handle, m.name ORDER BY COUNT(*) DESC`).all();
    const act = (path, label, cls = 'btn', extra = '') => `<form method="post" action="/studio/standard/${path}${sc.qs ? `?${sc.qs}` : ''}" class="fk-f">${extra}<button class="${cls}">${label}</button></form>`;
    const body = `<section class="studio-wrap fk"><p class="k"><a href="/studio">The house</a> · Bringing in</p><h1>The standard</h1>
<p class="note">The Frick's rule: on the wall, only clean, whole, faithful reproductions. Every picture on the house's shelves (the public domain and the museums' open access) is measured by the house (size, sharpness against the shelf, the edges) and looked at by Al${alOn() ? '' : ' (Al is off: no key, so the house measures alone)'}. What falls short comes off the wall, named; nothing is deleted, and every one can be put back.</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<nav class="fk-scope"><a href="/studio/standard"${!sc.qs ? ' aria-current="page"' : ''}>Every shelf</a><a href="/studio/standard?living=1"${sc.s.living ? ' aria-current="page"' : ''}>Living makers</a>${insts.map(m => `<a href="/studio/standard?maker=${esc(m.handle)}">${esc(m.name)} · ${m.n}</a>`).join('')}</nav>
<details class="fk-arts"><summary>By artist</summary><p>${artists.map(a => `<a href="/studio/standard?artist=${esc(a.slug)}">${esc(a.name)} <small>${a.n}${a.u ? ` · ${a.u} unread` : ''}</small></a>`).join(' · ')}</p></details>
<h2>${esc(sc.label)}</h2>
<p class="fk-line"><b>${onN}</b> on the wall · <b>${onN - unread}</b> read · <b>${down.length}</b> to come down · <b>${check.length}</b> for your eye · <b>${goneN}</b> off the wall by the standard</p>
${sc.s.living ? `<p class="note">A living maker’s work is measured by the house alone (size, sharpness, the edges) and never taken down by it: a reading of ‘down’ keeps the work off the house’s open walls (Wander, today, the collection, Discover; the wall standard asks for ${app.locals.wall ? app.locals.wall.WALL_MIN_PX : 2400} px on the long side too) and leaves it on the maker’s own page. ‘It hangs’ puts it back on the open walls.</p>` : ''}${j && j.running ? `<p class="fk-live">Reading… ${j.done} of ${j.total}${j.auto ? ` · ${j.taken} taken down` : ''}${j.failed ? ` · ${j.failed} could not be read` : ''}</p><script>setTimeout(()=>location.reload(),5000)</script>` : `<div class="fk-acts">${unread ? (sc.s.living ? act('run', `Read the ${unread} unread`, 'buy-btn') : act('run', `Read the ${unread} unread and take down what fails`, 'buy-btn', '<input type="hidden" name="auto" value="1">') + act('run', 'Read only, I will look')) : ''}${onN - unread ? act('run', 'Read everything again', 'btn', '<input type="hidden" name="again" value="1">') : ''}</div>${j && j.last ? `<p class="note">Last: ${esc(j.last)}</p>` : ''}`}
${down.length ? `<h3>${sc.s.living ? `Off the open walls by the reading · ${down.length}` : `To come down · ${down.length}`}</h3>${sc.s.living ? '' : act('apply', `Take these ${down.length} off the wall`, 'buy-btn')}<div class="fk-g">${down.slice(0, 300).map(w => tile(w, `<form method="post" action="/studio/standard/keep${sc.qs ? `?${sc.qs}` : ''}"><input type="hidden" name="slug" value="${esc(w.slug)}"><button class="fk-k">It hangs</button></form>`)).join('')}</div>` : ''}
${check.length ? `<h3>For your eye · ${check.length}</h3><p class="note">The house or Al was not sure. Keep what hangs; take down the rest.</p><div class="fk-g">${check.slice(0, 300).map(w => tile(w, `<form method="post" action="/studio/standard/keep${sc.qs ? `?${sc.qs}` : ''}"><input type="hidden" name="slug" value="${esc(w.slug)}"><button class="fk-k">It hangs</button></form><form method="post" action="/studio/standard/apply${sc.qs ? `?${sc.qs}` : ''}"><input type="hidden" name="slugs" value="${esc(w.slug)}"><input type="hidden" name="check" value="1"><button class="fk-d">Take it down</button></form>`)).join('')}</div>` : ''}
${goneN ? `<h3>Off the wall by the standard · ${goneN}</h3>${act('back', 'Put them all back')}<div class="fk-gone">${gone.map(w => `<a href="/studio/works/${esc(w.slug)}" title="${esc(w.title)} · ${esc(String(w.tidy).replace('below the standard: ', ''))}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
</section>`;
    res.set('Cache-Control', 'private, no-store').send(V.layout({ title: 'The standard · Studio · Watermark', path: '/studio/standard', studio: true, body }));
  });
  const back = (req, ok) => `/studio/standard?${scopeOf(req.query).qs ? scopeOf(req.query).qs + '&' : ''}ok=${encodeURIComponent(ok)}`;
  app.post('/studio/standard/run', studioOnly, (req, res) => { const sc = scopeOf(req.query); const j = run(sc.s, { again: req.body && req.body.again === '1', auto: req.body && req.body.auto === '1' }); if (req.body && req.body.json) return res.json({ ok: true, job: j }); res.redirect(back(req, j.total ? `Reading ${j.total}.` : 'Nothing unread.')); });
  app.post('/studio/standard/apply', studioOnly, (req, res) => {
    const sc = scopeOf(req.query); const slugs = req.body && req.body.slugs ? String(req.body.slugs).split(',').map(s => s.trim()).filter(Boolean) : null;
    let n;
    if (slugs && req.body.check === '1') { n = 0; const ids = []; for (const s of slugs) { const w = db.prepare('SELECT id, slug, frick FROM works WHERE slug=?').get(s); if (w && takeDown(w, whyOf(readOf(w) || {}), 'frick: a person')) { n++; ids.push(w.id); } } after(ids); }
    else n = apply(sc.s, slugs);
    if (req.body && req.body.json) return res.json({ ok: true, n }); res.redirect(back(req, `${n} taken off the wall.`));
  });
  app.post('/studio/standard/keep', studioOnly, (req, res) => { const n = keep(String((req.body && req.body.slug) || '')); if (req.body && req.body.json) return res.json({ ok: !!n }); res.redirect(back(req, 'Kept on the wall.')); });
  app.post('/studio/standard/back', studioOnly, (req, res) => { const n = putBack(scopeOf(req.query).s); if (req.body && req.body.json) return res.json({ ok: true, n }); res.redirect(back(req, `${n} put back on the wall.`)); });

  const api = { transport: null };
  Object.assign(api, { run, measure, houseFaults, decide, apply, putBack, keep, waiting, jobs, FAULTS }); app.locals.frick = api;
  return api;
}
module.exports = { mountFrick, FAULTS };
