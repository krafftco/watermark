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
  for (const w of db.prepare('SELECT id, stars, curated FROM works').all()) add(w.id, (w.stars || 0) * 3 + (w.curated ? 4 : 0));
  const safe = (sql, f) => { try { for (const r of db.prepare(sql).all()) f(r); } catch (e) { /* table not yet */ } };
  safe('SELECT work_id id, COUNT(*) n FROM applause GROUP BY work_id', r => add(r.id, Math.min(20, r.n)));
  safe('SELECT work_id id, COUNT(*) n, SUM(CASE WHEN seen_at IS NOT NULL THEN 1 ELSE 0 END) s FROM notes WHERE removed_at IS NULL AND work_id>0 GROUP BY work_id', r => add(r.id, Math.min(15, r.n * 1.5) + r.s * 2));
  safe("SELECT work_id id, COUNT(*) n FROM licenses WHERE status IN ('active','expired') GROUP BY work_id", r => add(r.id, Math.min(30, r.n * 2)));
  safe('SELECT work_id id, COUNT(*) n FROM stood GROUP BY work_id', r => add(r.id, Math.log2(r.n + 1)));
  safe('SELECT work_id id, SUM(count) n FROM views GROUP BY work_id', r => add(r.id, Math.min(3, Math.log10(r.n + 1))));
  return m;
}
function regardMap(db, fresh = false) {
  if (fresh || Date.now() - cache.at > TTL) cache = { at: Date.now(), map: compute(db) };
  return cache.map;
}
const regardOf = (db, w) => regardMap(db).get(w.id) || 0;
// Sort a list of works by regard, newest first among equals; never drops anything.
function byRegard(db, works) { const m = regardMap(db); return works.slice().sort((a, b) => (m.get(b.id) || 0) - (m.get(a.id) || 0) || b.id - a.id); }
// A maker's body of work by year: when it was made (else when it arrived), the most regarded of each year first.
function chronology(db, works) {
  const m = regardMap(db); const years = new Map();
  for (const w of works) { const y = String(w.taken_at || w.created_at || '').slice(0, 4) || 'Undated'; if (!years.has(y)) years.set(y, []); years.get(y).push(w); }
  return [...years.entries()].sort((a, b) => (b[0] > a[0] ? 1 : -1)).map(([year, ws]) => ({ year, n: ws.length, works: ws.sort((a, b) => (m.get(b.id) || 0) - (m.get(a.id) || 0)) }));
}
const touch = () => { cache.at = 0; };
module.exports = { regardMap, regardOf, byRegard, chronology, touch };
