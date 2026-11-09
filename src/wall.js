'use strict';
// The wall standard (Will, 7 Nov: "if it can't meet in frame-to-frame, it can't show. These smaller images that show on
// the screen, we can't do that. We have to be able to go edge to edge and make these images always look beautiful";
// "a certain megapixel, blurriness, or resolution: we got to take it off the wall. It's Frick, man").
//
// The house's open walls (the open Wander, today's work, the collection, Discover's rows, the walks by time, place,
// movement, kind and artist, the Latest row, For you) show only a work whose master can fill a screen: its long side
// at WALL_MIN_PX (2400, the large copy's own size and the Collect file's; with true size's quarter grace that fills a
// 3,000-pixel screen, every phone and most laptops) and no reading by the standard (frick.js) that found it soft,
// blurred, blank or badly edged. Nothing is hidden by this: the work stays held, on its maker's own page and in any
// set a person chose (a maker's wander, a wall, a gallery, a show, an album); it is simply not put on the house's
// walls. The house may say otherwise per work (`works.wall` 'on' | 'off'), from the record.
//
// `sql(alias)` is a fragment for any query that fills an open wall; museums.hallSql carries it, so every query
// that already asked for the halls asks for the standard too; walk.js and look.js add it to their own SAFE.
// Under test the floor is 800 (the fixtures are 1,200 px); WALL_MIN_PX in the environment overrides either way.
const WALL_MIN_PX = Math.max(400, Number(process.env.WALL_MIN_PX || (process.env.NODE_ENV === 'test' ? 800 : 2400)));

// The gate (8 Nov, copies.js): once the backfill has read every work, an open wall shows only work whose display copies
// are made (`works.copies_at`), so no visitor's look is ever a first look. Set live by copies.js; read at each call.
let gateOn = false; const setGate = on => { gateOn = !!on; }; const gate = () => gateOn;
function sql(a = 'w') {
  // MAX(a,b) is two-arg here (greatest on Postgres by the dialect); frick is JSON with no spaces ("verdict":"down").
  return (gateOn ? ` AND ${a}.copies_at IS NOT NULL` : '') + ` AND (${a}.wall='on' OR (COALESCE(${a}.wall,'')<>'off' AND MAX(COALESCE(${a}.width,0),COALESCE(${a}.height,0))>=${WALL_MIN_PX} AND COALESCE(${a}.frick,'') NOT LIKE '%"verdict":"down"%'))`;
}
// The same rule read for one work: { ok, why }.
function holds(w) {
  if (!w) return { ok: false, why: 'no work' };
  if (w.wall === 'on') return { ok: true, why: 'the house says it hangs' };
  if (w.wall === 'off') return { ok: false, why: 'the house keeps it off the open walls' };
  if (gateOn && !w.copies_at) return { ok: false, why: 'its display copies are not yet made; the worker makes them and it goes up by itself' };
  const long = Math.max(w.width || 0, w.height || 0);
  if (long < WALL_MIN_PX) return { ok: false, why: `${long || 'an unknown number of'} px on the long side; the open walls need ${WALL_MIN_PX}` };
  let r = null; try { r = w.frick ? JSON.parse(w.frick) : null; } catch (e) { /* no reading */ }
  if (r && r.verdict === 'down') { const f = [...(r.house || []).map(x => x.k), ...((r.al && r.al.faults) || [])].filter((x, i, a) => a.indexOf(x) === i).join(', '); return { ok: false, why: `read by the standard: ${f || 'below it'}` }; }
  return { ok: true, why: long >= WALL_MIN_PX ? `${long} px on the long side` : '' };
}

function mountWall(app, { db, V, studioOnly, ledger }) {
  const esc = V.esc;
  for (const [c, t] of [['wall', 'TEXT'], ['frick', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  // The record: one line, and the house's say.
  function block(w, base, { studio = false } = {}) {
    const h = holds(w);
    const say = studio ? `<form method="post" action="${esc(base)}" class="wl-f"><select name="wall"><option value=""${!w.wall ? ' selected' : ''}>By the standard</option><option value="on"${w.wall === 'on' ? ' selected' : ''}>On the open walls, whatever its size</option><option value="off"${w.wall === 'off' ? ' selected' : ''}>Off the open walls</option></select><button class="link">Say so</button></form>` : '';
    const fix = !h.ok && !studio && /px on the long side/.test(h.why) ? ` <a href="/account/upload">Send the full file</a> and it goes up by itself.` : '';
    return `<section class="wl" id="wall"><h2>The open walls</h2><p class="${h.ok ? 'wl-ok' : 'wl-no'}">${h.ok ? `On the house’s open walls${h.why ? ` (${esc(h.why)})` : ''}.` : `Not on the house’s open walls: ${esc(h.why)}.${fix}`} <small>The open walls are Wander, today’s work, the collection and Discover; the work is always on its own page and in any set a person chose.</small></p>${say}</section>`;
  }
  app.post('/studio/works/:slug/wall', studioOnly, (req, res) => {
    const w = db.prepare('SELECT id, slug FROM works WHERE slug=?').get(req.params.slug); if (!w) return res.sendStatus(404);
    const v = ['on', 'off'].includes(req.body && req.body.wall) ? req.body.wall : null;
    db.prepare('UPDATE works SET wall=? WHERE id=?').run(v, w.id);
    try { if (ledger) ledger.append(db, 'wall.said', w.slug, { wall: v }); } catch (e) { /* the open wander's pool is keyed on the register's head */ }
    try { if (app.locals.findIndexDirty) app.locals.findIndexDirty(); } catch (e) { /* */ }
    if (req.body && req.body.json) return res.json({ ok: true, wall: v });
    res.redirect(`/studio/works/${encodeURIComponent(w.slug)}?ok=${encodeURIComponent(v ? `The house says: ${v === 'on' ? 'it hangs' : 'off the open walls'}.` : 'By the standard.')}#wall`);
  });
  // How many held works the standard keeps off the open walls, for the desk.
  const counts = () => db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN 1=1${sql('w')} THEN 1 ELSE 0 END) ok FROM works w WHERE w.status='held'`).get();
  // The label (Will, 9 Nov: "we are a museum… some things in the basement, in the vault… people can access all of
  // those things"): one plain line under the work, as a museum's own record says it. On view = on the house's open
  // walls (Wander, the collection, Discover); in the collection = kept, with its own page, found by name, not hung.
  function onView(w, maker) {
    if (!w || w.status !== 'held') return null;
    return !!(holds(w).ok && (w.hall || !maker || maker.door !== 'record'));
  }
  function label(w, maker) {
    const on = onView(w, maker); if (on === null) return '';
    return on ? `<p class="onv onv-on"><b>On view</b><span>in Wander and the collection</span></p>`
      : `<p class="onv"><b>In the collection</b><span>not on view · kept by the house, and always here</span></p>`;
  }
  app.locals.wall = { WALL_MIN_PX, sql, holds, block, counts, gate, setGate, onView, label };
  return app.locals.wall;
}
module.exports = { mountWall, sql, holds, WALL_MIN_PX, setGate, gate };
