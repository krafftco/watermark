'use strict';
// The meter on Al (Will, 8 Nov: "why am I paying 41 dollars a day in api credits"). Every call the house makes to the
// model on its own key goes through `ok(module)` first: it counts the day's calls by module (settings `al_<day>`) and
// refuses past the lines. Two lines: AL_DAY_MAX (400) for everything the house does by itself in the background (the
// art reading of arrivals, guides, studies, jackets, translations, For you) and AL_PRESS_MAX (1500) for what a person
// pressed (the standard's look, Al's edit, a guide asked for). AL_FILLS=0 is the kill switch for every background job.
// What has been spent today is on /healthz (full) as `al` and in the morning digest.
const ROLE = require('./role');

const DAY_MAX = Math.max(0, +(process.env.AL_DAY_MAX || 400));
const PRESS_MAX = Math.max(0, +(process.env.AL_PRESS_MAX || 1500));
const PRESSED = new Set(['frick', 'aledit', 'art.asked', 'closer.asked', 'study.asked', 'jacket.asked', 'facing']);
const fillsOn = () => process.env.AL_FILLS !== '0';

function mountSpend(app, { db }) {
  db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)');
  const day = () => new Date().toISOString().slice(0, 10);
  const key = () => `al_${day()}`;
  const read = () => { try { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(key()); return r ? JSON.parse(r.v) : {}; } catch (e) { return {}; } };
  const write = o => db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key(), JSON.stringify(o));
  const sum = (o, pressed) => Object.entries(o).filter(([k]) => !k.startsWith('_') && PRESSED.has(k) === pressed).reduce((s, [, n]) => s + n, 0);
  // May this module make one more call today? Counts it when yes.
  function ok(module) {
    const o = read(); const pressed = PRESSED.has(module);
    if (!pressed && !fillsOn()) return false;
    const used = sum(o, pressed), max = pressed ? PRESS_MAX : DAY_MAX;
    if (used >= max) { o._refused = (o._refused || 0) + 1; write(o); return false; }
    o[module] = (o[module] || 0) + 1; write(o); return true;
  }
  const today = () => { const o = read(); return { day: day(), background: sum(o, false), backgroundMax: DAY_MAX, pressed: sum(o, true), pressedMax: PRESS_MAX, refused: o._refused || 0, fills: fillsOn(), by: Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_'))) }; };
  // The last seven days, for the digest.
  const week = () => { const out = []; for (let i = 0; i < 7; i++) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); try { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(`al_${d}`); const o = r ? JSON.parse(r.v) : {}; out.push({ day: d, n: Object.entries(o).filter(([k]) => !k.startsWith('_')).reduce((s, [, n]) => s + n, 0) }); } catch (e) { out.push({ day: d, n: 0 }); } } return out; };
  app.locals.spend = { ok, today, week, fillsOn, DAY_MAX, PRESS_MAX, PRESSED, chores: ROLE.chores };
  return app.locals.spend;
}
module.exports = { mountSpend, DAY_MAX, PRESS_MAX };
