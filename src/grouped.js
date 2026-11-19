'use strict';
// One question for many makers (#85, #90, #93: the scale gate). A desk that asked the same sum once per maker or per
// collector (24 statements × 300 makers on /studio) asks it once, grouped by the id, for all of them or for the few
// given. `ids` null means everyone; an empty list, no one.
function inList(col, ids) {
  if (ids == null) return { sql: '1=1', args: [] };
  if (!ids.length) return { sql: '1=0', args: [] };
  return { sql: `${col} IN (${ids.map(() => '?').join(',')})`, args: ids.map(Number) };
}
// Rows keyed by their `id` column (a number on both engines).
const byId = (rows, key = 'id') => new Map(rows.map(r => [Number(r[key]), r]));
// A grouped sum that may meet a table a fresh house has not made yet: none.
function safe(fn) { try { return fn(); } catch (e) { return new Map(); } }
module.exports = { inList, byId, safe };
