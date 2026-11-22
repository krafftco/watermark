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
  // (22 Nov, #196) The account out of credit: the API answered 400 "Your credit balance is too low" for every new work,
  // and the art fill marked each one missed (never read again). Now the first such answer is heard here (`heard(e)`,
  // called where a background job catches its error): it is kept in settings `credit_low` (shared by every process),
  // said once in the log and once on the Studio's front desk, and every background call is refused for AL_CREDIT_WAIT_MIN
  // (30) minutes; then one call tries again, and a second refusal from the API starts the wait again. A person's press
  // still goes through (it is how the house learns the account is paid). No line, key or model is changed by this.
  const CREDIT = /credit balance is too low/i;
  const WAIT_MS = 60e3 * Math.max(1, +(process.env.AL_CREDIT_WAIT_MIN || 30));
  function credit() { try { const r = db.prepare("SELECT v FROM settings WHERE k='credit_low'").get(); const v = r ? JSON.parse(r.v) : null; return v && v.until > Date.now() ? v : null; } catch (e) { return null; } }
  function heard(e, module) {
    if (!CREDIT.test(String((e && e.message) || e || ''))) return false;
    const was = credit(); const at = Date.now(); const v = { since: was ? was.since : at, at, until: at + WAIT_MS, module: module || null, n: (was ? was.n : 0) + 1 };
    try { db.prepare("INSERT INTO settings (k, v) VALUES ('credit_low', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(JSON.stringify(v)); } catch (er) { /* said in the log below */ }
    if (!was) console.error(`[al] the API says the account's credit is too low (${module || 'a call'}); the house's own AI calls wait until ${new Date(v.until).toISOString().slice(11, 16)} UTC, then try once again`);
    return true;
  }
  // May this module make one more call today? Counts it when yes.
  function ok(module) {
    const o = read(); const pressed = PRESSED.has(module);
    if (!pressed && !fillsOn()) return false;
    if (!pressed && credit()) return false; // out of credit: the background waits (above)
    const used = sum(o, pressed), max = pressed ? PRESS_MAX : DAY_MAX;
    if (used >= max) { o._refused = (o._refused || 0) + 1; write(o); return false; }
    o[module] = (o[module] || 0) + 1; write(o); return true;
  }
  const today = () => { const o = read(); return { day: day(), background: sum(o, false), backgroundMax: DAY_MAX, pressed: sum(o, true), pressedMax: PRESS_MAX, refused: o._refused || 0, fills: fillsOn(), credit: credit(), by: Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_'))) }; };
  // The last seven days, for the digest.
  const week = () => { const out = []; for (let i = 0; i < 7; i++) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); try { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(`al_${d}`); const o = r ? JSON.parse(r.v) : {}; out.push({ day: d, n: Object.entries(o).filter(([k]) => !k.startsWith('_')).reduce((s, [, n]) => s + n, 0) }); } catch (e) { out.push({ day: d, n: 0 }); } } return out; };
  app.locals.spend = { ok, today, week, fillsOn, heard, credit, DAY_MAX, PRESS_MAX, PRESSED, chores: ROLE.chores };
  return app.locals.spend;
}
module.exports = { mountSpend, DAY_MAX, PRESS_MAX };
