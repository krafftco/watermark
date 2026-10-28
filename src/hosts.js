const ROLE = require('./role');
// The host's chair (Will, 21 Oct: the rooms are open at every hour by smart programming, "but there will be somebody
// there to do it"; people must be able to make a career on the platform). Hosting is a job: the rota (`host_shifts`:
// room scope 'house' or 'm:<handle>', the night (New York's date), who (a maker or a collector with a key), status
// offered | taken | done | missed | paid, cents). The house sets the rota from Studio → Back office → Hosts: a night
// offered to a named keyholder by letter, or left open for any maker or curator to take at /hosts (the rota as
// everyone sees it: who hosts when, by first name; your nights; Take this night). On the night the chair is the
// host's: /balcony/host admits the rota's host first (the house can always sit); when the room closes with the host
// having come, the shift is done and HOST_CENTS (5000, $50 a night, a draft) is credited to their pocket from the
// house's side (`hosting`, cashable), `host.paid` hidden; a host who did not come is marked missed and the night is
// told to the house. A reminder notice (kind 'night') the day of. The register says, on the night, who hosted (as
// `balcony.night` already does). Nothing else is kept of the evening.
const HOST_CENTS = process.env.HOST_CENTS != null ? +process.env.HOST_CENTS : 5000;
const TZ = process.env.BALCONY_TZ || 'America/New_York';
function mountHosts(app, { db, V, C, mail, ledger, isStudio, buyerOf, makerOf, notify = null }) {
  const { esc, date } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS host_shifts (id INTEGER PRIMARY KEY, scope TEXT NOT NULL DEFAULT 'house', night TEXT NOT NULL, owner TEXT, name TEXT, status TEXT NOT NULL DEFAULT 'offered', cents INTEGER NOT NULL DEFAULT ${HOST_CENTS}, note TEXT, reminded INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT, UNIQUE (scope, night))`);
  const nightOf = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const K = () => app.locals.keys;
  const ownerOf = req => { const m = makerOf(req), b = buyerOf(req); return m ? { id: `m:${m.id}`, name: m.name, kinds: ['maker'], m, b } : b ? { id: `b:${b.id}`, name: b.name, m: null, b } : null; };
  const mayHost = req => { const k = K() ? K().holds(req) : {}; return !!(k.maker || k.curator || k.house) || isStudio(req); };
  const nights = (scope, n = 14) => { const out = []; for (let i = 0; i < n; i++) { const d = new Date(Date.now() + i * 86400e3); const night = nightOf(d); out.push({ night, shift: db.prepare('SELECT * FROM host_shifts WHERE scope=? AND night=?').get(scope, night) || null, label: d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }) }); } return out; };
  const buyerOfOwner = o => { if (!o) return null; const [k, id] = o.split(':'); if (k === 'b') return db.prepare('SELECT * FROM buyers WHERE id=?').get(+id); const m = db.prepare('SELECT * FROM makers WHERE id=?').get(+id); if (!m) return null; return (m.buyer_id && db.prepare('SELECT * FROM buyers WHERE id=?').get(m.buyer_id)) || (m.email && db.prepare('SELECT * FROM buyers WHERE lower(email)=lower(?)').get(m.email)) || null; };
  const emailOfOwner = o => { const [k, id] = String(o || '').split(':'); const r = k === 'm' ? db.prepare('SELECT email FROM makers WHERE id=?').get(+id) : k === 'b' ? db.prepare('SELECT email FROM buyers WHERE id=?').get(+id) : null; return r && r.email; };
  // Tonight's host for a room, as the balcony asks.
  const tonight = scope => db.prepare("SELECT * FROM host_shifts WHERE scope=? AND night=? AND status='taken'").get(scope, nightOf()) || null;
  const isTonightsHost = (scope, who) => { const s = tonight(scope); return !!(s && who && s.owner === who); };
  // When a room closes: done or missed, and the pocket.
  function settle(scope, night, hostId, came) {
    const s = db.prepare("SELECT * FROM host_shifts WHERE scope=? AND night=? AND status='taken'").get(scope, night); if (!s) return;
    const sat = hostId && s.owner === hostId;
    if (!sat) { db.prepare("UPDATE host_shifts SET status='missed' WHERE id=?").run(s.id); mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `The host did not come: ${s.name}, ${s.night}`, text: `${s.name} had the chair on ${s.night} (${scope}) and did not take it. ${came} came.` }); return; }
    db.prepare("UPDATE host_shifts SET status='done' WHERE id=?").run(s.id);
    const b = buyerOfOwner(s.owner);
    if (b && app.locals.pocket && s.cents > 0) { app.locals.pocket.credit(b, s.cents, 'hosting', `host-${s.id}`, `Hosting the balcony, ${s.night}`); db.prepare("UPDATE host_shifts SET status='paid', paid_at=datetime('now') WHERE id=?").run(s.id); }
    try { ledger.append(db, 'host.paid', s.night, { scope, cents: s.cents, came }); } catch (e) { /* */ }
  }
  // The rota, as everyone sees it.
  app.get('/hosts', (req, res) => {
    const me = ownerOf(req); const can = mayHost(req);
    const scopes = ['house', ...db.prepare("SELECT DISTINCT scope FROM host_shifts WHERE scope!='house'").all().map(r => r.scope)];
    const mine = me ? db.prepare("SELECT * FROM host_shifts WHERE owner=? AND night>=? ORDER BY night").all(me.id, nightOf()) : [];
    res.send(V.layout({ title: 'The hosts · The Keys · Watermark', path: '/hosts', desc: 'Who keeps the balcony, night by night. A keyholder may take an open night; the house pays the chair.', body: `<section class="cx-intro hs"><p class="k"><a href="/keys">The Keys</a> · The balcony</p><h1>The hosts.</h1>
<p class="lede">The balcony is open every night from nine, New York time, and somebody is there. The chair is a job: the host hangs the wall of the night, plays the piano, keeps the conversation, asks to keep a line. Makers and curators with keys may take an open night; the house pays ${V.money(HOST_CENTS)} for the evening, from its own side.${req.query.ok ? ` <b>${esc(String(req.query.ok))}</b>` : ''}</p>
${mine.length ? `<p class="hs-mine"><span class="k">Your nights</span> ${mine.map(s => `${esc(date(s.night))}${s.scope !== 'house' ? ` (${esc(s.scope.slice(2))})` : ''}`).join(' · ')}</p>` : ''}</section>
${scopes.map(scope => `<section class="hs-rota"><h2>${scope === 'house' ? 'The house’s balcony' : `The balcony at ${esc((db.prepare('SELECT name FROM makers WHERE handle=?').get(scope.slice(2)) || {}).name || scope.slice(2))}`}</h2><table class="tbl hs-t"><tr><th>Night</th><th>Host</th><th></th></tr>${nights(scope).map(n => `<tr><td>${esc(n.label)}</td><td>${n.shift && n.shift.status !== 'offered' ? esc((n.shift.name || '').split(' ')[0]) : n.shift ? `<i>offered to ${esc((n.shift.name || '').split(' ')[0])}</i>` : '<i>open</i>'}</td><td>${!n.shift && can ? `<form method="post" action="/hosts/take"><input type="hidden" name="scope" value="${esc(scope)}"><input type="hidden" name="night" value="${n.night}"><button class="link">Take this night</button></form>` : n.shift && me && n.shift.owner === me.id && n.shift.status === 'offered' ? `<form method="post" action="/hosts/${n.shift.id}/accept"><button class="link">Accept</button></form>` : n.shift && me && n.shift.owner === me.id && n.shift.status === 'taken' ? `<form method="post" action="/hosts/${n.shift.id}/give"><button class="link">Give it back</button></form>` : ''}</td></tr>`).join('')}</table></section>`).join('')}
${!can ? '<section class="cx-intro"><p class="note">Taking a night needs a maker’s or a curator’s key. <a href="/keys">The Keys</a>.</p></section>' : ''}` }));
  });
  app.post('/hosts/take', (req, res) => {
    const me = ownerOf(req); if (!me || !mayHost(req)) return res.sendStatus(403);
    const scope = /^(house|m:[a-z0-9-]+)$/.test(String(req.body.scope || '')) ? String(req.body.scope) : 'house', night = String(req.body.night || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(night) || night < nightOf()) return res.redirect('/hosts?ok=' + encodeURIComponent('That night is gone.'));
    try { db.prepare("INSERT INTO host_shifts (scope, night, owner, name, status) VALUES (?,?,?,?,'taken')").run(scope, night, me.id, me.name || 'A host'); } catch (e) { return res.redirect('/hosts?ok=' + encodeURIComponent('Someone has that night.')); }
    res.redirect('/hosts?ok=' + encodeURIComponent(`The ${date(night)} chair is yours.`));
  });
  app.post('/hosts/:id/accept', (req, res) => { const me = ownerOf(req); const s = db.prepare('SELECT * FROM host_shifts WHERE id=?').get(+req.params.id); if (!me || !s || s.owner !== me.id) return res.sendStatus(403); db.prepare("UPDATE host_shifts SET status='taken' WHERE id=?").run(s.id); res.redirect('/hosts?ok=' + encodeURIComponent('Accepted. Thank you.')); });
  app.post('/hosts/:id/give', (req, res) => { const me = ownerOf(req); const s = db.prepare('SELECT * FROM host_shifts WHERE id=?').get(+req.params.id); if (!me || !s || s.owner !== me.id) return res.sendStatus(403); db.prepare('DELETE FROM host_shifts WHERE id=?').run(s.id); mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `A night given back: ${s.night}`, text: `${s.name} gave back the chair for ${s.night} (${s.scope}).` }); res.redirect('/hosts?ok=' + encodeURIComponent('Given back; the house is told.')); });
  // The Studio: the rota, offer a night to someone, clear one.
  app.get('/studio/hosts', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403); V.setDeskPath('/studio/hosts');
    const rows = db.prepare('SELECT * FROM host_shifts WHERE night>=? ORDER BY night, scope').all(nightOf(new Date(Date.now() - 30 * 86400e3)));
    res.send(V.layout({ title: 'Hosts · Watermark', studio: true, body: `<section class="studio-wrap"><p class="k">The Keys</p><h1>The hosts.</h1>
<p class="lede">The rota for the balcony. Offer a night to a maker or a collector with a key (by handle or email); they accept at /hosts. Open nights may be taken by any maker or curator. The chair pays ${V.money(HOST_CENTS)} from the house’s side when the host comes.${req.query.ok ? ` <b>${esc(String(req.query.ok))}</b>` : ''}</p>
<form method="post" action="/studio/hosts/offer" class="cl-f tm-f"><label><span>Night</span><input type="date" name="night" required></label><label><span>Room</span><input name="scope" value="house" placeholder="house or m:handle"></label><label><span>Who (handle or email)</span><input name="who" required></label><button class="buy-btn">Offer the chair</button></form>
<table class="tbl"><tr><th>Night</th><th>Room</th><th>Host</th><th>State</th><th></th></tr>${rows.map(s => `<tr><td>${esc(date(s.night))}</td><td>${esc(s.scope)}</td><td>${esc(s.name || '')}</td><td>${esc(s.status)}${s.status === 'paid' ? ` · ${V.money(s.cents)}` : ''}</td><td><form method="post" action="/studio/hosts/${s.id}/clear"><button class="link">Clear</button></form></td></tr>`).join('') || '<tr><td colspan="5">No nights set.</td></tr>'}</table></section>` }));
  });
  app.post('/studio/hosts/offer', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    const who = String(req.body.who || '').trim().toLowerCase(); const night = String(req.body.night || ''); const scope = /^(house|m:[a-z0-9-]+)$/.test(String(req.body.scope || '')) ? String(req.body.scope) : 'house';
    const m = db.prepare('SELECT * FROM makers WHERE handle=? OR lower(email)=?').get(who, who); const b = m ? null : db.prepare('SELECT * FROM buyers WHERE lower(email)=?').get(who);
    if (!m && !b) return res.redirect('/studio/hosts?ok=' + encodeURIComponent('No one by that handle or address.'));
    const owner = m ? `m:${m.id}` : `b:${b.id}`, name = (m || b).name || who;
    try { db.prepare("INSERT INTO host_shifts (scope, night, owner, name, status) VALUES (?,?,?,?,'offered')").run(scope, night, owner, name); } catch (e) { return res.redirect('/studio/hosts?ok=' + encodeURIComponent('That night is taken.')); }
    const email = (m || b).email; if (email) mail.send({ to: email, subject: `The chair on ${date(night)}`, text: `${name.split(' ')[0]},\n\nWould you host the balcony on ${date(night)}? The room opens at nine, New York time; you hang the wall of the night, play the piano if you like, and keep the conversation. The house pays ${V.money(HOST_CENTS)} for the evening.\n\nAccept here: ${C.base}/hosts\n\nThank you.` });
    if (notify) notify({ maker_id: m ? m.id : null, buyer_id: b ? b.id : null, kind: 'night', title: `The chair on ${date(night)}`, body: 'The house asks you to host the balcony. Accept at the rota.', href: '/hosts' }).catch(() => {});
    res.redirect('/studio/hosts?ok=' + encodeURIComponent(`Offered to ${name}.`));
  });
  app.post('/studio/hosts/:id/clear', (req, res) => { if (!isStudio(req)) return res.sendStatus(403); db.prepare('DELETE FROM host_shifts WHERE id=?').run(+req.params.id); res.redirect('/studio/hosts?ok=Cleared.'); });
  // The reminder, the day of, once.
  function remind() {
    for (const s of db.prepare("SELECT * FROM host_shifts WHERE night=? AND status='taken' AND reminded=0").all(nightOf())) {
      db.prepare('UPDATE host_shifts SET reminded=1 WHERE id=?').run(s.id);
      const email = emailOfOwner(s.owner); if (email) mail.send({ to: email, subject: 'Tonight, the chair is yours', text: `${(s.name || '').split(' ')[0]},\n\nThe balcony opens at nine, New York time, and the chair is yours tonight. ${C.base}/balcony${s.scope !== 'house' ? '/at/' + s.scope.slice(2) : ''}\n\nThank you for keeping the room.` });
      const [k, id] = s.owner.split(':'); if (notify) notify({ maker_id: k === 'm' ? +id : null, buyer_id: k === 'b' ? +id : null, kind: 'night', title: 'Tonight, the chair is yours', body: 'The balcony opens at nine.', href: '/balcony' }).catch(() => {});
    }
  }
  if (!app.locals.noTimers && ROLE.chores) setInterval(remind, 30 * 60e3).unref();
  app.locals.hosts = { tonight, isTonightsHost, settle, remind, HOST_CENTS, nightOf };
  return app.locals.hosts;
}
module.exports = { mountHosts, HOST_CENTS };
