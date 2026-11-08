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
  const counts = () => ({ asks: db.prepare('SELECT COUNT(*) n FROM render_asks').get().n, made: db.prepare("SELECT COUNT(*) n FROM works WHERE copies_at IS NOT NULL AND status='held'").get().n, held: db.prepare("SELECT COUNT(*) n FROM works WHERE status='held'").get().n, gate: WALL.gate(), noMaster: noMaster(), backfill: job });
  // The placeholder: the wall's own dark, nothing else; never cached.
  const placeholder = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16" viewBox="0 0 24 16"><rect width="24" height="16" fill="#0b0a09"/></svg>';
  app.post('/studio/copies/backfill', studioOnly, (req, res) => { backfill().catch(() => {}); res.redirect('/studio/restoration?ok=' + encodeURIComponent('Reading the bucket for every work’s copies; /healthz says how far.')); });
  app.post('/studio/copies/gate', studioOnly, (req, res) => { gate(req.body && req.body.on === '1'); res.redirect('/studio/restoration?ok=' + encodeURIComponent(WALL.gate() ? 'The open walls show only work whose copies are made.' : 'The open walls show every work the standard allows.')); });
  if (!quiet && ROLE.chores) { setInterval(() => { drain().catch(() => {}); }, 5000).unref(); if (GOV && GOV.boot) GOV.boot('copies backfill', () => backfill().then(j => console.log('[copies] backfill', j.marked, 'marked of', j.looked))); }
  app.locals.copies = { gen: () => made, ask, make, drain, backfill, gate, counts, noMaster, placeholder, job };
  return app.locals.copies;
}
module.exports = { mountCopies };
