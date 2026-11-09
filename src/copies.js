'use strict';
// The copies (Will, 8 Nov: "this thing needs to fly all the time; you go from thing to thing to thing and you get to
// see beautiful"; the house at 2.3 GB and load 11 that afternoon, making display copies of 55,000 works cold, one
// visitor at a time). The rule from here: the website never opens a master. The worker makes every work's display
// copies (thumb, screen, large; JPEG and WebP) the moment it arrives and puts them in the bucket; the edge and the
// website serve them from there; a copy the website finds missing is answered with the nearest copy it has (or a
// quiet placeholder) and asked of the worker by a ticket (`render_asks`), never made in front of a visitor.
// `works.copies_at` says when a work's set was complete; once the backfill has read every work (`settings.copies_gate`),
// the open walls (wall.js) show only work whose copies exist, so nothing on a wall is ever a first look.
const ROLE = require('./role');
const WALL = require('./wall');

function mountCopies(app, { db, images, cache, originalPath, GOV, studioOnly, ledger }) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get('copies_at')) db.exec('ALTER TABLE works ADD COLUMN copies_at TEXT');
  db.exec('CREATE TABLE IF NOT EXISTS render_asks (slug TEXT PRIMARY KEY, asked_at TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, size TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)');
  for (const [c, t] of [['copies_claim', 'TEXT'], ['copies_claim_at', 'TEXT'], ['copies_tries', 'INTEGER DEFAULT 0']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const setting = k => { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? r.v : null; };
  const put = (k, v) => db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
  const quiet = !!app.locals.noTimers;
  // The website of a split house never opens a master (NO_MASTER_ON_WEB=1 forces it anywhere, for tests and a local check).
  const noMaster = () => process.env.NO_MASTER_ON_WEB === '1' || (ROLE.web && !ROLE.chores);
  WALL.setGate(setting('copies_gate') === '1');

  // A ticket for the worker: this work's copies are wanted.
  function ask(slug, size) {
    try { db.prepare("INSERT INTO render_asks (slug, asked_at, n, size) VALUES (?, ?, 1, ?) ON CONFLICT(slug) DO UPDATE SET n=render_asks.n+1, asked_at=excluded.asked_at").run(slug, now(), size || null); } catch (e) { /* asked */ }
  }
  const THUMB = ['thumb']; let made = 0; // a newly made set renews the open wander's pool (stroll.js keys on it)
  // Make a work's set (the thumb for anything kept; every size for work on view) and mark it.
  async function make(w) {
    const o = () => originalPath(w);
    let full = false;
    await images.warm(o, cache, w.slug, THUMB);
    if (w.status === 'held' && !w.keep_back) full = await images.warm(o, cache, w.slug);
    else full = await images.has(cache, w.slug);
    if (full && !w.copies_at) { db.prepare('UPDATE works SET copies_at=? WHERE id=?').run(now(), w.id); made++; }
    return full;
  }
  // The tickets, oldest first (the worker; or the house itself when it is its own worker).
  let draining = false;
  async function drain(limit = 20) {
    if (draining) return 0; draining = true; let n = 0;
    try {
      const rows = db.prepare('SELECT slug FROM render_asks ORDER BY asked_at LIMIT ?').all(limit);
      for (const r of rows) {
        const w = db.prepare('SELECT * FROM works WHERE slug=?').get(r.slug);
        if (w && ['held', 'hidden'].includes(w.status)) { try { await make(w); n++; } catch (e) { console.error('[copies]', r.slug, e.message); } }
        db.prepare('DELETE FROM render_asks WHERE slug=?').run(r.slug);
        if (GOV && GOV.settle && !quiet) await GOV.settle('copies');
      }
    } finally { draining = false; }
    return n;
  }
  // The backfill: every work without copies_at asked of the bucket by HEAD (three JPEGs; the WebPs are made from them
  // on the web in a moment); marked when there; the gate set when every work has been looked at.
  const job = { on: false, looked: 0, marked: 0, missing: 0, done: false, at: null, error: null };
  async function backfill({ parallel = 4 } = {}) {
    if (job.on) return job; Object.assign(job, { on: true, looked: 0, marked: 0, missing: 0, done: false, at: new Date().toISOString(), error: null });
    try {
      const rows = db.prepare("SELECT id, slug FROM works WHERE copies_at IS NULL AND status IN ('held','hidden') ORDER BY id").all();
      for (let i = 0; i < rows.length; i += parallel) {
        await Promise.all(rows.slice(i, i + parallel).map(async r => {
          const ok = await images.has(cache, r.slug, ['thumb', 'screen', 'large'], ['jpg']);
          job.looked++; if (ok) { job.marked++; db.prepare('UPDATE works SET copies_at=? WHERE id=? AND copies_at IS NULL').run(now(), r.id); } else job.missing++;
        }));
        if (!quiet && i % 400 === 0) await new Promise(r => setTimeout(r, 50));
      }
      job.done = true; gate(true);
    } catch (e) { job.error = e.message; } finally { job.on = false; }
    return job;
  }
  function gate(on) {
    put('copies_gate', on ? '1' : '0'); WALL.setGate(!!on);
    try { if (ledger) ledger.append(db, 'copies.gated', 'house', { on: !!on }); } catch (e) { /* the open wander's pool is keyed on the register */ }
    try { if (app.locals.findIndexDirty) app.locals.findIndexDirty(); } catch (e) { /* */ }
  }
  const countsNow = () => ({ scribes: (() => { try { const p = progress(); return { left: p.left, perMin: p.perMin, etaMin: p.etaMin, scribes: p.scribes, paused: p.paused, importsHeld: p.importsHeld }; } catch (e) { return null; } })(), asks: db.prepare('SELECT COUNT(*) n FROM render_asks').get().n, made: db.prepare("SELECT COUNT(*) n FROM works WHERE copies_at IS NOT NULL AND status='held'").get().n, held: db.prepare("SELECT COUNT(*) n FROM works WHERE status='held'").get().n, gate: WALL.gate(), noMaster: noMaster(), backfill: job });
  const counts = () => (app.locals.kept ? app.locals.kept('copies-counts', 30e3, countsNow) : countsNow()); // (9 Nov) /healthz asked these of every work on each call
  // The placeholder: the wall's own dark, nothing else; never cached.
  const placeholder = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16" viewBox="0 0 24 16"><rect width="24" height="16" fill="#0b0a09"/></svg>';
  app.post('/studio/copies/backfill', studioOnly, (req, res) => { backfill().catch(() => {}); res.redirect('/studio/restoration?ok=' + encodeURIComponent('Reading the bucket for every work’s copies; /healthz says how far.')); });
  app.post('/studio/copies/gate', studioOnly, (req, res) => { gate(req.body && req.body.on === '1'); res.redirect('/studio/restoration?ok=' + encodeURIComponent(WALL.gate() ? 'The open walls show only work whose copies are made.' : 'The open walls show every work the standard allows.')); });
  if (!quiet && ROLE.chores) { setInterval(() => { drain().catch(() => {}); }, 5000).unref(); if (GOV && GOV.boot) GOV.boot('copies backfill', () => backfill().then(j => console.log('[copies] backfill', j.marked, 'marked of', j.looked))); }
  // ── The scribes (Will, 9 Nov: "build a system or machine or worker for this job"; "a scribe"). Nothing used to walk
  // the collection making copies: the backfill only marked what the bucket already held, and the rest was made only
  // when a visitor met a gap. Now every process of ROLE=scribe (any number of them; Render's instance count is the
  // dial) runs SCRIBE_LANES (3) lanes, each claiming the next work without a full set from one queue (best first:
  // curated, stars, the makers' own before the shelves, newest), making it, and claiming the next. A claim is a row
  // update that only one process can win (`copies_claim`, given up after SCRIBE_STALE_MIN (15) if its scribe died);
  // a work that fails three times is set aside (`copies_tries`) and counted. The worker keeps one lane while no
  // scribe is seen. Each scribe writes a heartbeat (settings `scribe:<id>`); the Studio's /studio/scribes adds them
  // up: how many are left, how fast, when it is done. Imports can be held meanwhile (settings `imports_held`): the
  // line, the feeds and the inboxes start nothing new and a running feed pauses where it is.
  const ME = (process.env.RENDER_INSTANCE_ID || require('os').hostname()) + ':' + process.pid;
  const LANES = Math.max(1, +process.env.SCRIBE_LANES || (ROLE.scribe ? 3 : 1));
  const STALE_MS = 60e3 * (+process.env.SCRIBE_STALE_MIN || 15);
  const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const SHELF = "CASE WHEN m.kind IN ('institution','company') OR m.handle='the-public-domain' THEN 1 ELSE 0 END";
  const WANT = "w.copies_at IS NULL AND w.status='held' AND COALESCE(w.keep_back,0)=0 AND COALESCE(w.copies_tries,0)<3";
  function claim() {
    const stale = iso(Date.now() - STALE_MS);
    const rows = db.prepare(`SELECT w.id FROM works w LEFT JOIN makers m ON m.id=w.maker_id WHERE ${WANT} AND (w.copies_claim IS NULL OR w.copies_claim_at < ?) ORDER BY COALESCE(w.curated,0) DESC, COALESCE(w.stars,0) DESC, ${SHELF}, w.id DESC LIMIT 12`).all(stale);
    for (const r of rows) {
      const c = db.prepare('UPDATE works SET copies_claim=?, copies_claim_at=? WHERE id=? AND copies_at IS NULL AND (copies_claim IS NULL OR copies_claim_at < ?)').run(ME, now(), r.id, stale);
      if (c.changes === 1) return db.prepare('SELECT * FROM works WHERE id=?').get(r.id);
    }
    return null;
  }
  const done = []; // completion times, for the rate
  const scribe = { lanes: 0, made: 0, failed: 0, at: null, last: null, error: null };
  const nap = ms => new Promise(r => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
  const fleetSeen = () => { try { const t = Date.now() - 120e3; return db.prepare("SELECT v FROM settings WHERE k LIKE 'scribe:%'").all().some(r => { try { const v = JSON.parse(r.v); return v.at > t && v.role === 'scribe'; } catch (e) { return false; } }); } catch (e) { return false; } };
  const resting = () => {
    if (setting('scribes_paused') === '1') return true;
    if (GOV && GOV.showing && GOV.showing()) return true;
    if (GOV && GOV.overHard && GOV.overHard()) return true;
    if (app.locals.readonly && app.locals.readonly()) return true;
    if (!ROLE.scribe) { if (GOV && GOV.chores && !GOV.chores()) return true; if (fleetSeen()) return true; } // the worker steps aside for the scribes
    return false;
  };
  async function one() {
    const w = claim(); if (!w) return false;
    const t0 = Date.now();
    try {
      const full = await make(w);
      if (full) { scribe.made++; done.push(Date.now()); scribe.last = w.slug; }
      else { scribe.failed++; db.prepare('UPDATE works SET copies_tries=COALESCE(copies_tries,0)+1 WHERE id=?').run(w.id); }
      // A scribe keeps no masters: the copy on its disk was only for this work (the vault holds it).
      if (ROLE.scribe && w.vaulted) { try { const p = originalPath(w); if (p && require('fs').existsSync(p)) require('fs').unlinkSync(p); } catch (e) { /* kept */ } }
    } catch (e) { scribe.failed++; scribe.error = `${w.slug}: ${e.message}`.slice(0, 200); console.error('[scribe]', w.slug, e.message); try { db.prepare('UPDATE works SET copies_tries=COALESCE(copies_tries,0)+1 WHERE id=?').run(w.id); } catch (e2) { /* */ } }
    finally { try { db.prepare('UPDATE works SET copies_claim=NULL, copies_claim_at=NULL WHERE id=? AND copies_claim=?').run(w.id, ME); } catch (e) { /* stale in time */ } }
    if (Date.now() - t0 > 120e3) console.log(`[scribe] ${w.slug} took ${Math.round((Date.now() - t0) / 1000)} s`);
    return true;
  }
  async function lane() {
    scribe.lanes++;
    for (;;) {
      try {
        if (resting()) { await nap(20e3); continue; }
        if (draining) { await nap(2e3); continue; }
        const did = await one();
        if (!did) { await nap(30e3); continue; }
        if (GOV && GOV.settle) await GOV.settle('scribe');
      } catch (e) { scribe.error = e.message; console.error('[scribe]', e.message); await nap(10e3); }
    }
  }
  const rate = () => { const t = Date.now() - 10 * 60e3; while (done.length && done[0] < t) done.shift(); return done.length / 10; }; // works a minute
  function beat() {
    try { put('scribe:' + ME, JSON.stringify({ at: Date.now(), lanes: scribe.lanes, made: scribe.made, failed: scribe.failed, rate: rate(), rss: Math.round(process.memoryUsage().rss / 1048576), last: scribe.last, error: scribe.error, role: ROLE.role })); } catch (e) { /* */ }
  }
  function fleet() {
    const t = Date.now() - 120e3; const out = [];
    for (const r of db.prepare("SELECT k, v FROM settings WHERE k LIKE 'scribe:%'").all()) { try { const v = JSON.parse(r.v); out.push({ id: r.k.slice(7), ...v, live: v.at > t }); } catch (e) { /* */ } }
    return out.sort((a, b) => b.at - a.at);
  }
  function progress() {
    const left = db.prepare(`SELECT COUNT(*) n FROM works w WHERE ${WANT}`).get().n;
    const stuck = db.prepare("SELECT COUNT(*) n FROM works WHERE copies_at IS NULL AND status='held' AND COALESCE(keep_back,0)=0 AND COALESCE(copies_tries,0)>=3").get().n;
    const ready = db.prepare("SELECT COUNT(*) n FROM works WHERE copies_at IS NOT NULL AND status='held'").get().n;
    const live = fleet().filter(f => f.live); const perMin = live.reduce((a, f) => a + (+f.rate || 0), 0);
    return { left, ready, stuck, scribes: live.length, lanes: live.reduce((a, f) => a + (+f.lanes || 0), 0), perMin: Math.round(perMin * 10) / 10, etaMin: perMin > 0 ? Math.round(left / perMin) : null, paused: setting('scribes_paused') === '1', importsHeld: setting('imports_held') === '1', fleet: fleet().slice(0, 12) };
  }
  const etaWords = m => m == null ? 'not moving yet' : m < 90 ? `about ${m} minutes` : m < 48 * 60 ? `about ${Math.round(m / 60)} hours` : `about ${Math.round(m / 1440)} days`;
  const holdImports = on => {
    put('imports_held', on ? '1' : '0');
    if (on) db.prepare("UPDATE feeds SET status='paused', note='imports held' WHERE status='queued'").run();
    else db.prepare("UPDATE feeds SET status='queued', note=NULL WHERE status='paused' AND note='imports held'").run();
  };
  if (setting('imports_held') == null && !quiet) holdImports(true); // Will, 9 Nov: stop imports; make the collection we hold first
  // The pace (9 Nov): even with imports let go, nothing new starts while more than SCRIBE_BEHIND (500) works wait for
  // their copies, so the house never again takes in faster than it can make ready.
  const BEHIND = +process.env.SCRIBE_BEHIND || 500; let behindAt = 0, behindWas = false;
  const behind = () => { if (Date.now() - behindAt > 30e3) { behindAt = Date.now(); try { behindWas = db.prepare(`SELECT COUNT(*) n FROM works w WHERE ${WANT}`).get().n > BEHIND; } catch (e) { behindWas = false; } } return behindWas; };
  app.locals.importsHeld = () => setting('imports_held') === '1' || (!quiet && behind());
  app.locals.copiesBehind = behind;
  app.get('/studio/scribes', studioOnly, (req, res) => {
    const p = progress(); const V = app.locals.V || require('./views'); const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const pct = p.ready + p.left ? Math.round(100 * p.ready / (p.ready + p.left)) : 100;
    const row = f => `<li class="scb-r${f.live ? '' : ' scb-off'}"><b>${esc(f.id)}</b><small>${f.live ? 'at work' : 'not seen since ' + new Date(f.at).toISOString().slice(11, 16) + ' UTC'} · ${f.lanes || 0} lanes · ${f.made || 0} made · ${f.rate || 0} a minute · ${f.rss || 0} MB${f.failed ? ` · ${f.failed} failed` : ''}${f.last ? ` · last <a href="/w/${esc(f.last)}">${esc(f.last)}</a>` : ''}${f.error ? ` · ${esc(f.error)}` : ''}</small></li>`;
    res.send(V.layout({ title: 'The scribes · Studio · Watermark', studio: true, path: '/studio/scribes', body: `<main class="scb"><p class="k">The collection</p><h1>The scribes.</h1>
<p class="lede">Every work on view is made once in every size, put in the vault's bucket and served from the edge, so no visitor ever waits on a master. The scribes make them, best work first, as many at a time as there are scribes running.</p>
${req.query.ok ? `<p class="bl-ok">${esc(req.query.ok)}</p>` : ''}
<div class="scb-n"><span><b>${p.ready.toLocaleString('en-US')}</b><i>ready</i></span><span><b>${p.left.toLocaleString('en-US')}</b><i>left</i></span><span><b>${p.perMin}</b><i>a minute</i></span><span><b>${p.paused ? 'Paused' : esc(etaWords(p.etaMin))}</b><i>${p.paused ? '' : 'to go'}</i></span></div>
<div class="scb-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
<p>${p.scribes ? `${p.scribes} scribe${p.scribes === 1 ? '' : 's'} at work, ${p.lanes} lanes.` : 'No scribe at work. Start one in Render (a background worker with ROLE=scribe), or the worker makes them one at a time.'}${p.stuck ? ` ${p.stuck} could not be made after three tries (see the restoration room).` : ''}</p>
<form method="post" action="/studio/scribes/pause" class="bl-in"><button>${p.paused ? 'Let them work' : 'Pause the scribes'}</button></form>
<form method="post" action="/studio/scribes/imports" class="bl-in"><button>${p.importsHeld ? 'Let imports run again' : 'Hold all imports'}</button></form>
<p class="scb-note">${p.importsHeld ? '<b>Imports are held.</b> The line, the feeds and the inboxes start nothing new; makers sending their own work are never held.' : 'Imports are let go' + (behind() ? ', and waiting: more than ' + BEHIND + ' works are still to copy, so nothing new starts until the scribes catch up.' : '.')} The gate is ${WALL.gate() ? '<b>on</b>: the open walls show only work whose copies are made' : '<b>off</b>'}.</p>
<form method="post" action="/studio/copies/gate" class="bl-in"><input type="hidden" name="on" value="${WALL.gate() ? '0' : '1'}"><button>${WALL.gate() ? 'Open the gate' : 'Turn the gate on'}</button></form>
<h2>The scribes</h2><ul class="scb-l">${p.fleet.map(row).join('') || '<li><small>None yet.</small></li>'}</ul>
<script>setTimeout(()=>location.reload(),30000)</script></main>` }));
  });
  app.get('/studio/scribes.json', studioOnly, (req, res) => res.json(progress()));
  app.post('/studio/scribes/pause', studioOnly, (req, res) => { const on = setting('scribes_paused') !== '1'; put('scribes_paused', on ? '1' : '0'); res.redirect('/studio/scribes?ok=' + encodeURIComponent(on ? 'Paused: each finishes the work in hand.' : 'At work again.')); });
  app.post('/studio/scribes/imports', studioOnly, (req, res) => { const on = setting('imports_held') !== '1'; holdImports(on); res.redirect('/studio/scribes?ok=' + encodeURIComponent(on ? 'Imports held. A feed running now pauses at its next item.' : 'Imports run again; feeds held for this pick up where they stopped.')); });
  if (!quiet && (ROLE.scribe || ROLE.chores)) {
    const go = () => { for (let i = 0; i < LANES; i++) lane(); beat(); setInterval(beat, 30e3).unref(); console.log(`[scribe] ${ME} at work, ${LANES} lanes (${ROLE.role})`); };
    setTimeout(go, ROLE.scribe ? 5e3 : 240e3).unref();
  }
  app.locals.copies = { gen: () => made, ask, make, drain, backfill, gate, counts, noMaster, placeholder, job, claim, one, progress, fleet, holdImports, scribe, ME };
  return app.locals.copies;
}
module.exports = { mountCopies };
