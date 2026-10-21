// The balcony (Will, 19 Oct): the Keys' room, the balcony lounge above the Great Hall. Open at hours, a host, the
// wall of the night, the piano (a work shown first to those present), the long table (the talk), and a word between
// two people. The house keeps the work; it does not keep the people: everything said here lives in this process's
// memory only, is streamed to the keyholders present, and is gone at midnight (or at a restart, which is simply an
// empty room). No model reads it. What is kept is one sentence per night on the register (date, host, the wall,
// how many came), and a line a host asks to keep, with the speaker's yes, which goes to the bench in their name.
// Presence is first names while present, and nothing after. Anyone may look through the window: the wall, the
// host, how many are in; the talk itself is for those inside.
const crypto = require('crypto');

const TZ = process.env.BALCONY_TZ || 'America/New_York';
const OPEN = Number(process.env.BALCONY_OPEN || 21), CLOSE = Number(process.env.BALCONY_CLOSE || 24);
const CAP_LINES = 400;

function mountBalcony(app, { db, V, C, ledger, buyerOf, makerOf, isStudio }) {
  db.exec(`CREATE TABLE IF NOT EXISTS balcony_nights (id INTEGER PRIMARY KEY, night TEXT NOT NULL, host TEXT, wall TEXT, piano TEXT, came INTEGER NOT NULL DEFAULT 0,
    opened_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT)`);
  const { esc, tidy } = V;
  const keys = () => app.locals.keys;
  const hourNow = () => { const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false, minute: 'numeric' }).formatToParts(new Date()); const h = +p.find(x => x.type === 'hour').value % 24; return h + (+p.find(x => x.type === 'minute').value) / 60; };
  const nightOf = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const byHours = () => process.env.BALCONY_ALWAYS === '1' || (hourNow() >= OPEN && hourNow() < CLOSE);

  // The rooms, in memory: the house's balcony, and one for each collection (Will, 21 Oct: "the balcony is for people
  // who have just looked at the Met's collection, not the Brooklyn Museum"; "a context reference, like a game's lobby").
  // A room is keyed by its scope: 'house', or 'm:<handle>' for a maker's or an institution's own balcony. The scope a
  // visitor is in is the cookie `wm_room` (set by /balcony/at/:handle, cleared by /balcony/at/house), so the client's
  // fixed addresses (/balcony/stream, /say, …) reach the right room. The door of a collection's room: you have stood
  // before its work in the last three hours (`stood.last_at`), or you made it, or you work there, or you are the house.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('balcony_nights') WHERE name='scope'").get()) db.exec("ALTER TABLE balcony_nights ADD COLUMN scope TEXT NOT NULL DEFAULT 'house'");
  const rooms = new Map();
  function fresh(scope = 'house') { return { scope, night: null, open: false, host: null, wall: null, piano: null, present: new Map(), lines: [], seq: 0, clients: new Set(), came: new Set(), words: new Map(), asks: new Map(), forced: false, id: null }; }
  const roomFor = scope => { if (!rooms.has(scope)) rooms.set(scope, fresh(scope)); return rooms.get(scope); };
  let room = roomFor('house');
  const scopeOf = req => { const c = req.cookies && req.cookies.wm_room; return c && /^m:[a-z0-9-]+$/.test(c) && db.prepare("SELECT 1 FROM makers WHERE handle=?").get(c.slice(2)) ? c : 'house'; };
  const scopeMaker = scope => (scope === 'house' ? null : db.prepare('SELECT * FROM makers WHERE handle=?').get(scope.slice(2)) || null);
  // Each request on the balcony is served in its visitor's room (the handlers are synchronous; the stream keeps its own).
  app.use(['/balcony', '/balcony/*splat', '/api/balcony'], (req, res, next) => { room = roomFor(scopeOf(req)); next(); });
  function openRoom(how, r = room) {
    if (r.open) return r;
    const f = fresh(r.scope); rooms.set(r.scope, f); if (r === room) room = f; r = f; r.open = true; r.night = nightOf(); r.forced = how === 'house';
    r.id = db.prepare('INSERT INTO balcony_nights (night, scope) VALUES (?, ?)').run(r.night, r.scope).lastInsertRowid;
    return r;
  }
  function closeRoom(r = room) {
    if (!r.open) return;
    db.prepare("UPDATE balcony_nights SET host=?, wall=?, piano=?, came=?, closed_at=datetime('now') WHERE id=?").run(r.host ? r.host.name : null, r.wall ? r.wall.slug : null, r.piano ? r.piano.slug : null, r.came.size, r.id);
    try { ledger.append(db, 'balcony.night', r.night, { host: r.host ? r.host.name : null, wall: r.wall ? r.wall.slug : null, came: r.came.size, scope: r.scope }); } catch (e) { /* */ }
    if (app.locals.hosts) { try { app.locals.hosts.settle(r.scope, r.night, r.host ? String(r.host.id).replace(/^([mb])/, '$1:') : null, r.came.size); } catch (e) { console.error('[hosts]', e.message); } }
    for (const c of r.clients) { try { c.write(`event: closed\ndata: {}\n\n`); c.end(); } catch (e) { /* */ } }
    const f = fresh(r.scope); rooms.set(r.scope, f); if (r === room) room = f; // and everything said is gone
  }
  // The hours: a tick every minute opens and closes every room.
  function tick() { for (const r of [...rooms.values()]) { if (byHours() && !r.open) openRoom('hours', r); else if (!byHours() && r.open && !r.forced) closeRoom(r); } }
  if (!app.locals.noTimers) setInterval(tick, 60e3).unref();
  // The door of a collection's room.
  function admitted(req, who, scope) {
    if (scope === 'house' || who.house) return true;
    const m = scopeMaker(scope); if (!m) return false;
    if (who.m && who.m.id === m.id) return true;
    const v = req.cookies && req.cookies.wm_v; const args = [m.id]; let w = 'viewer=?'; args.push(String(v || '-').slice(0, 16)); if (who.b) { w = '(viewer=? OR buyer_id=?)'; args.push(who.b.id); }
    return !!db.prepare(`SELECT 1 FROM stood s JOIN works w ON w.id=s.work_id WHERE w.maker_id=? AND ${w} AND COALESCE(s.last_at, s.at) > datetime('now', '-3 hours') LIMIT 1`).get(...args);
  }
  // Into a collection's own room, or back to the house's.
  app.get('/balcony/at/:handle', (req, res) => {
    const h = String(req.params.handle); const opts = { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 6 * 3600e3 };
    if (h === 'house') { res.clearCookie('wm_room'); return res.redirect('/balcony'); }
    if (!db.prepare('SELECT 1 FROM makers WHERE handle=?').get(h)) return res.sendStatus(404);
    res.cookie('wm_room', 'm:' + h, opts); res.redirect('/balcony');
  });

  // Who is this, on the balcony: a keyholder with a first name, else a looker at the window.
  function whoIs(req) {
    const b = buyerOf(req), m = makerOf(req); const K = keys(); const held = K ? K.holds(req) : {};
    const name = ((m && m.name) || (b && b.name) || '').trim();
    const id = m ? `m${m.id}` : b ? `b${b.id}` : null;
    const keyed = Object.keys(held).length > 0 && !!name && !!id;
    const who = { b, m, id, name: name.split(' ')[0] || null, full: name || null, keyed, house: isStudio(req), kinds: Object.keys(held), scope: room.scope };
    if (!admitted(req, who, room.scope)) who.keyed = false; // at a collection's door without having stood before its work: the window only
    return who;
  }
  const canHost = who => who.house || who.kinds.includes('maker') || who.kinds.includes('curator');
  const send = (c, ev, data) => { try { c.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) { /* */ } };
  const broadcast = (ev, data, { inside = true } = {}) => { for (const c of room.clients) if (!inside || c.inside) send(c, ev, data); };
  const presence = () => ({ n: room.present.size, names: [...room.present.values()].map(p => p.name) });
  const state = who => ({ scope: room.scope, at: scopeMaker(room.scope) ? { name: scopeMaker(room.scope).name, handle: scopeMaker(room.scope).handle } : null, admitted: admitted({ cookies: {} }, { ...who, house: who.house }, 'house') && who.keyed, open: room.open, night: room.night, host: room.host ? { name: room.host.name } : null, wall: room.wall, piano: room.piano && (who.keyed || who.house) ? room.piano : (room.piano ? { title: 'Something new, for those present' } : null), present: presence(), hours: { open: OPEN, close: CLOSE, tz: TZ }, you: who.keyed ? { id: who.id, name: who.name, canHost: canHost(who), host: !!(room.host && room.host.id === who.id) } : null });
  const workOf = slug => { const w = db.prepare('SELECT w.slug, w.title, w.place, w.width, w.height, w.status, m.name AS maker FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.slug=?').get(String(slug)); return w ? { slug: w.slug, title: tidy(w.title), maker: w.maker, place: w.place, r: w.width && w.height ? +(w.width / w.height).toFixed(3) : 1.5, held: w.status === 'held' } : null; };

  // The page.
  app.get('/balcony', (req, res) => {
    tick();
    const who = whoIs(req); const st = state(who);
    res.send(V.layout({ title: `The balcony${st.at ? ' at ' + st.at.name : ''} · The Keys · Watermark`, path: '/balcony', bare: false, desc: 'The Keys’ room. Open in the evening; what is said here is not kept.', body: `<section class="bc${room.open ? ' on' : ''}" data-balcony data-keyed="${who.keyed ? 1 : 0}">
<header class="bc-top"><p class="k">${(app.locals.keys && app.locals.keys.MARK && app.locals.keys.MARK.bunch) || ''}<a href="/keys">The Keys</a> · The balcony${st.at ? ` at <a href="/m/${esc(st.at.handle)}">${esc(st.at.name)}</a> · <a href="/balcony/at/house">the house’s</a>` : ''}</p>${st.at && !who.keyed && !who.house ? `<p class="bc-door">This balcony is for those who have just looked at ${esc(st.at.name)}’s collection. <a href="/stroll?maker=${esc(st.at.handle)}">Stand before its work</a>, then come up; the room is open to you for three hours after.</p>` : ''}<p class="bc-hours">${room.open ? `Open tonight${room.host ? ` · ${esc(room.host.name)} is hosting` : ''}` : `Opens at ${OPEN > 12 ? OPEN - 12 : OPEN} in the evening, New York time, and closes at midnight.`}</p></header>
<div class="bc-wall" data-wall>${room.wall ? `<figure style="--r:${room.wall.r}"><img src="/img/${esc(room.wall.slug)}/large" alt="${esc(room.wall.title)}"><figcaption><i>${esc(room.wall.title)}</i> · ${esc(room.wall.maker)}${room.wall.place ? `, ${esc(room.wall.place)}` : ''} · the wall tonight</figcaption></figure>` : `<p class="bc-empty">${room.open ? 'No wall yet tonight. The host hangs one.' : 'The room is dark until the evening.'}</p>`}</div>
<aside class="bc-side">
<div class="bc-present" data-present><p class="k">In the room</p><p class="bc-names">${st.present.n ? esc(st.present.names.join(' · ')) : (room.open ? 'No one yet. Be first.' : 'Nobody; it is closed.')}</p></div>
${who.keyed && room.open ? `<div class="bc-you"><p class="k">You</p><p>${esc(who.name)}${st.you.host ? ', hosting' : ''}</p>${!room.host && st.you.canHost ? `<form method="post" action="/balcony/host"><button class="buy-btn">Take the host’s chair</button></form>` : ''}${st.you.host ? `<form method="post" action="/balcony/wall" class="bc-f"><input name="slug" placeholder="A work’s slug for the wall" required><button>Hang it</button></form><form method="post" action="/balcony/piano" class="bc-f"><input name="slug" placeholder="A work of yours, new, for the piano"><button>Show it</button></form>` : ''}</div>` : ''}
${room.piano ? `<div class="bc-piano"><p class="k">At the piano</p>${who.keyed || who.house ? `<figure style="--r:${room.piano.r}"><img src="/img/${esc(room.piano.slug)}/screen" alt=""><figcaption><i>${esc(room.piano.title)}</i> · ${esc(room.piano.maker)} · shown first to those here tonight${room.piano.held ? ` · <a href="/w/${esc(room.piano.slug)}">Collect it</a>` : ''}</figcaption></figure>` : '<p>Something new, for those present.</p>'}</div>` : ''}
</aside>
<div class="bc-table"><p class="k">The long table</p>
${who.keyed ? (room.open ? `<ol class="bc-lines" data-lines></ol><form class="bc-say" data-say><input name="body" maxlength="600" placeholder="Say something; it is not kept." autocomplete="off" required><button class="buy-btn">Say</button></form><p class="bc-note">Nothing here is kept. The host may ask to keep a line of yours for the bench; only with your yes. To speak to one person, tap their name.</p>` : '<p class="bc-note">Come back at nine.</p>') : `<p class="bc-note">${room.open ? 'The talk is for keyholders. You are welcome to look through the window: the wall, the host, who is in.' : ''} ${who.b || who.m ? (who.keyed ? '' : 'Keys are earned: collect a work, or be invited. <a href="/keys">The Keys</a>.') : '<a href="/signin?next=/balcony">Sign in</a> if you hold keys.'}</p>`}
</div>
<div class="bc-word" data-word hidden><p class="k">A word with <b data-word-name></b></p><ol data-word-lines></ol><form data-word-say><input name="body" maxlength="400" placeholder="For them alone; gone when either of you leaves." autocomplete="off" required><button>Say</button></form><button type="button" class="link" data-word-close>Close</button></div>
<script src="/static/balcony.js?v=${V.VER}" defer></script></section>` }));
  });

  // The stream: presence and lines, to those present; the window sees only presence and the wall.
  app.get('/balcony/stream', (req, res) => {
    tick();
    const who = whoIs(req);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
    res.inside = who.keyed && room.open; res.who = who.id;
    const r0 = room; room.clients.add(res);
    if (res.inside) { if (!room.present.has(who.id)) { room.present.set(who.id, { name: who.name, full: who.full, at: Date.now(), n: 1 }); room.came.add(who.id); broadcast('presence', presence(), { inside: false }); } else room.present.get(who.id).n++; }
    send(res, 'state', state(who));
    if (res.inside) for (const l of room.lines.slice(-80)) send(res, 'line', l);
    const beat = setInterval(() => { try { res.write(': beat\n\n'); } catch (e) { /* */ } }, 25e3);
    req.on('close', () => { clearInterval(beat); r0.clients.delete(res); if (res.inside && r0.present.has(who.id)) { const p = r0.present.get(who.id); p.n--; if (p.n <= 0) { r0.present.delete(who.id); for (const k of [...r0.words.keys()]) if (k.includes(who.id)) r0.words.delete(k); const was = room; room = r0; broadcast('presence', presence(), { inside: false }); room = was; } } });
  });
  const speaker = (req, res) => { const who = whoIs(req); if (!room.open) { res.status(409).json({ ok: false, why: 'closed' }); return null; } if (!who.keyed) { res.status(403).json({ ok: false, why: 'keys' }); return null; } return who; };
  app.post('/balcony/say', (req, res) => {
    const who = speaker(req, res); if (!who) return;
    const body = String((req.body || {}).body || '').replace(/\s+/g, ' ').trim().slice(0, 600); if (!body) return res.status(400).json({ ok: false });
    const l = { id: ++room.seq, who: who.id, name: who.name, body, at: Date.now() };
    room.lines.push(l); if (room.lines.length > CAP_LINES) room.lines.shift();
    broadcast('line', l); res.json({ ok: true });
  });
  // A word: to one person present; held only while both are here.
  app.post('/balcony/word', (req, res) => {
    const who = speaker(req, res); if (!who) return;
    const to = String((req.body || {}).to || ''), body = String((req.body || {}).body || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!to || !room.present.has(to) || to === who.id || !body) return res.status(400).json({ ok: false });
    const l = { id: ++room.seq, from: who.id, name: who.name, to, body, at: Date.now() };
    for (const c of room.clients) if (c.inside && (c.who === to || c.who === who.id)) send(c, 'word', l);
    res.json({ ok: true });
  });
  const rota = who => { const H = app.locals.hosts; if (!H) return true; const t = H.tonight(room.scope); return !t || who.house || t.owner === String(who.id || '').replace(/^([mb])/, '$1:'); }; // the rota's host has the chair tonight
  app.post('/balcony/host', (req, res) => { const who = whoIs(req); if (!room.open || !who.keyed || !canHost(who) || (room.host && room.host.id !== who.id) || !rota(who)) return res.redirect('/balcony'); room.host = { id: who.id, name: who.full }; broadcast('state', state(who), { inside: false }); res.redirect('/balcony'); });
  const hostOnly = (req, res) => { const who = whoIs(req); if (!room.open || !(who.house || (room.host && room.host.id === who.id))) { res.redirect('/balcony'); return null; } return who; };
  app.post('/balcony/wall', (req, res) => { const who = hostOnly(req, res); if (!who) return; const w = workOf((req.body || {}).slug); if (w && w.held) { room.wall = w; broadcast('wall', w, { inside: false }); } res.redirect('/balcony'); });
  app.post('/balcony/piano', (req, res) => {
    const who = hostOnly(req, res); if (!who) return; const slug = String((req.body || {}).slug || '').trim();
    const w = slug ? db.prepare('SELECT w.*, m.name AS mname FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.slug=?').get(slug) : null;
    if (w && (who.house || (who.m && who.m.id === w.maker_id))) { room.piano = { slug: w.slug, title: tidy(w.title), maker: w.mname, r: w.width && w.height ? +(w.width / w.height).toFixed(3) : 1.5, held: w.status === 'held' && !!w.published }; broadcast('piano', room.piano); }
    res.redirect('/balcony');
  });
  // Keeping a line: the host asks; the speaker says yes; it goes to the bench under the wall, in their name.
  app.post('/balcony/keep/:id', (req, res) => { const who = hostOnly(req, res); if (!who) return; const l = room.lines.find(x => x.id === +req.params.id); if (!l || !room.wall) return res.status(404).json({ ok: false }); room.asks.set(l.id, l); for (const c of room.clients) if (c.inside && c.who === l.who) send(c, 'ask', { id: l.id, body: l.body, wall: room.wall.title }); res.json({ ok: true }); });
  app.post('/balcony/keep/:id/yes', (req, res) => {
    const who = whoIs(req); const l = room.asks.get(+req.params.id); if (!who.keyed || !l || l.who !== who.id || !room.wall) return res.status(404).json({ ok: false });
    const w = db.prepare('SELECT id FROM works WHERE slug=?').get(room.wall.slug); if (!w) return res.status(404).json({ ok: false });
    db.prepare('INSERT INTO bench_lines (kind, subject_id, buyer_id, maker_id, name, body) VALUES (?,?,?,?,?,?)').run('work', w.id, who.b ? who.b.id : null, who.m ? who.m.id : null, who.full, l.body);
    room.asks.delete(l.id); broadcast('kept', { id: l.id }); res.json({ ok: true, href: `/bench/${room.wall.slug}` });
  });
  // The house opens or closes the room by hand (a night outside the hours, or an early close).
  app.post('/studio/balcony/:act', (req, res) => { if (!isStudio(req)) return res.sendStatus(403); if (req.params.act === 'open') openRoom('house'); else if (req.params.act === 'close') closeRoom(); res.redirect('/balcony'); });
  app.get('/api/balcony', (req, res) => { tick(); res.set('Cache-Control', 'no-store').json(state(whoIs(req))); });
  app.locals.balcony = { open: () => openRoom('house'), close: closeRoom, state: () => state({ keyed: false, house: true }), room: () => room, tick, nights: () => db.prepare('SELECT * FROM balcony_nights ORDER BY id DESC LIMIT 60').all() };
  return app.locals.balcony;
}
module.exports = { mountBalcony };
