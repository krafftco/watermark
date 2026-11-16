// Regard. How a photograph rises in the house: the maker's own grade, the jewels they name, the tips of
// the hat, the lines written in front of it and the ones the maker marked well seen, the collectors who
// took it, the people who stood in front of it. No down-votes anywhere; nothing is hidden by regard. The
// regarded hang first, the rest hang after, every one still in the maker's room. A museum does the same:
// the masterpiece in the great hall, the body of work kept whole in the study rooms.
const TTL = 5 * 60 * 1000;
let cache = { at: 0, map: new Map() };

function compute(db) {
  const m = new Map();
  const add = (id, v) => m.set(id, (m.get(id) || 0) + v);
  for (const w of db.prepare('SELECT id, stars, curated FROM works WHERE stars>0 OR curated=1').all() /* (9 Nov) only the graded: an ungraded work adds nothing, and the rest was every row of the house each five minutes */) add(w.id, (w.stars || 0) * 3 + (w.curated ? 4 : 0));
  const safe = (sql, f) => { try { for (const r of db.prepare(sql).all()) f(r); } catch (e) { /* table not yet */ } };
  safe('SELECT work_id id, COUNT(*) n FROM applause GROUP BY work_id', r => add(r.id, Math.min(20, r.n)));
  safe('SELECT work_id id, COUNT(*) n FROM bravos GROUP BY work_id', r => add(r.id, Math.min(40, r.n * 5))); // a bravo is five hats
  safe('SELECT work_id id, COUNT(*) n, SUM(CASE WHEN seen_at IS NOT NULL THEN 1 ELSE 0 END) s FROM notes WHERE removed_at IS NULL AND work_id>0 GROUP BY work_id', r => add(r.id, Math.min(15, r.n * 1.5) + r.s * 2));
  safe("SELECT work_id id, COUNT(*) n FROM licenses WHERE status IN ('active','expired') GROUP BY work_id", r => add(r.id, Math.min(30, r.n * 2)));
  safe('SELECT work_id id, COUNT(*) n FROM stood GROUP BY work_id', r => add(r.id, Math.log2(r.n + 1)));
  safe('SELECT work_id id, SUM(count) n FROM views GROUP BY work_id', r => add(r.id, Math.min(3, Math.log10(r.n + 1))));
  return m;
}
// (16 Nov, #70–#77) The whole house's regard is built by the worker (shared.js, `kept`) when the house is split, and
// the website reads it as one kept row; it is no longer asked for by any visitor's room (they use regardFor).
let kept = null;
const keptFrom = f => { kept = f; };
function regardMap(db, fresh = false) {
  if (kept && !fresh) { try { const m = kept(); if (m instanceof Map) return m; } catch (e) { /* build here */ } }
  if (fresh || Date.now() - cache.at > TTL) cache = { at: Date.now(), map: compute(db) };
  return cache.map;
}
// (16 Nov, #72 #76) The regard of the works a page shows, never of the whole house: `regardMap` read a row for every
// work ever seen, hatted or graded (100,000 view sums, 84,000 graded works at the scale gate's size) to sort the 1,200
// a page draws. Asked here by id, ID_CHUNK at a time, each table through its index on work_id; an answer is kept
// TTL per work (KEEP_MAX works at most), so a page asked again costs nothing. The same numbers as `compute`.
const ID_CHUNK = 500, KEEP_MAX = 20000;
let byId = new Map();
function computeFor(db, ids) {
  const m = new Map(ids.map(id => [id, 0]));
  const add = (id, v) => { if (m.has(id)) m.set(id, m.get(id) + v); };
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const part = ids.slice(i, i + ID_CHUNK), qs = part.map(() => '?').join(',');
    const safe = (sql, f) => { try { for (const r of db.prepare(sql).all(...part)) f(r); } catch (e) { /* table not yet */ } };
    safe(`SELECT id, stars, curated FROM works WHERE id IN (${qs})`, w => add(w.id, (w.stars || 0) * 3 + (w.curated ? 4 : 0)));
    safe(`SELECT work_id id, COUNT(*) n FROM applause WHERE work_id IN (${qs}) GROUP BY work_id`, r => add(r.id, Math.min(20, r.n)));
    safe(`SELECT work_id id, COUNT(*) n FROM bravos WHERE work_id IN (${qs}) GROUP BY work_id`, r => add(r.id, Math.min(40, r.n * 5)));
    safe(`SELECT work_id id, COUNT(*) n, SUM(CASE WHEN seen_at IS NOT NULL THEN 1 ELSE 0 END) s FROM notes WHERE removed_at IS NULL AND work_id IN (${qs}) GROUP BY work_id`, r => add(r.id, Math.min(15, r.n * 1.5) + r.s * 2));
    safe(`SELECT work_id id, COUNT(*) n FROM licenses WHERE status IN ('active','expired') AND work_id IN (${qs}) GROUP BY work_id`, r => add(r.id, Math.min(30, r.n * 2)));
    safe(`SELECT work_id id, COUNT(*) n FROM stood WHERE work_id IN (${qs}) GROUP BY work_id`, r => add(r.id, Math.log2(r.n + 1)));
    safe(`SELECT work_id id, SUM(count) n FROM views WHERE work_id IN (${qs}) GROUP BY work_id`, r => add(r.id, Math.min(3, Math.log10(r.n + 1))));
  }
  return m;
}
function regardFor(db, ids) {
  const now = Date.now(), out = new Map(), want = [];
  for (const id of new Set(ids.map(Number))) { const k = byId.get(id); if (k && now - k.at < TTL) out.set(id, k.v); else want.push(id); }
  if (want.length) {
    const got = computeFor(db, want);
    if (byId.size + got.size > KEEP_MAX) byId = new Map();
    for (const [id, v] of got) { out.set(id, v); byId.set(id, { at: now, v }); }
  }
  return out;
}
const regardOf = (db, w) => regardFor(db, [w.id]).get(Number(w.id)) || 0;
// Sort a list of works by regard, newest first among equals; never drops anything.
function byRegard(db, works) { const m = regardFor(db, works.map(w => w.id)); return works.slice().sort((a, b) => (m.get(Number(b.id)) || 0) - (m.get(Number(a.id)) || 0) || b.id - a.id); }
// A maker's body of work by year: when it was made (else when it arrived), the most regarded of each year first.
function chronology(db, works) {
  const m = regardFor(db, works.map(w => w.id)); const years = new Map();
  for (const w of works) { const y = String(w.taken_at || w.created_at || '').slice(0, 4) || 'Undated'; if (!years.has(y)) years.set(y, []); years.get(y).push(w); }
  return [...years.entries()].sort((a, b) => (b[0] > a[0] ? 1 : -1)).map(([year, ws]) => ({ year, n: ws.length, works: ws.sort((a, b) => (m.get(Number(b.id)) || 0) - (m.get(Number(a.id)) || 0)) }));
}
// Standing: how a maker ranks in the house. Not the sum of regard (which rewards hanging everything) but the
// regard of what is shown, divided by the square root of how much is shown: a tight edit of strong work
// outranks a long wall of the same work with the weak hung beside it. The great collectors culled; so does the house.
function standing(db, makerId, { from = null } = {}) {
  const m = regardMap(db);
  const rows = db.prepare('SELECT id, stars, status FROM works WHERE maker_id=?').all(makerId);
  const shown = rows.filter(w => (from == null ? w.status === 'held' : (w.stars || 0) >= from && w.status !== 'withdrawn'));
  const sum = shown.reduce((a, w) => a + (m.get(w.id) || 0), 0);
  return { n: shown.length, held: rows.length, sum, standing: shown.length ? Math.round(sum / Math.sqrt(shown.length) * 10) / 10 : 0 };
}
const touch = () => { cache.at = 0; byId = new Map(); };
// (#76) What a maker's page says of the edit ("Shows n of held"): two counts asked of the database, not the standing.
const editCounts = (db, makerId) => { const r = db.prepare("SELECT COUNT(*) held, SUM(CASE WHEN status='held' THEN 1 ELSE 0 END) n FROM works WHERE maker_id=?").get(makerId) || {}; return { n: Number(r.n || 0), held: Number(r.held || 0) }; };
module.exports = { compute, keptFrom, regardMap, regardFor, regardOf, byRegard, chronology, standing, editCounts, touch };
