// Institutions (Will, 21 Oct: "every museum in the world interested in having their own profile: their own pages,
// their own collections, their own curators; it works for their entire team; it plugs into their archives; an online
// business and a way to show their collections"; "the Met and the Frick; Bloomberg Connects doesn't do that good a job;
// the museum's favourite partner; more powerful because everybody uses it"). What a museum is on Watermark: a maker of
// kind 'institution' with a team. The team: `institution_staff` (name, email, role: director | curator | rights |
// registrar | shop | editor), each invited by letter from /account/staff, each signing in as themselves (`admit`) and
// then acting for the institution: `makerOf` (accounts.js) answers the institution for a signed-in person whose email
// is on its staff and who has chosen it (`wm_staff` cookie, set on joining and at /staff/as/<handle>), so the whole
// studio, the vault, the rights desk, the curators' keys and getting paid work for the team as they work for a maker.
// Roles are recorded and shown; the first season every role opens the whole desk, and finer doors come with the first
// museum's wishes rather than guessed. The museum page: the maker page gains a museum strip (`museumStrip`): on view
// (its curators' public walls), the collection (held, open access), the rights desk, the team, visit. Nothing of the
// team on the register (`staff.invited/joined/ended` hidden).
const crypto = require('crypto');
const ROLES = { director: 'Director', curator: 'Curator', rights: 'Rights and reproductions', registrar: 'Registrar', shop: 'Shop', editor: 'Editor' };
function mountInstitutions(app, { db, V, C, mail, ledger, isStudio, makerOf, buyerOf, admit, notify }) {
  const { esc, date } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS institution_staff (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, email TEXT NOT NULL, name TEXT, role TEXT NOT NULL DEFAULT 'curator', token TEXT NOT NULL UNIQUE,
    buyer_id INTEGER, status TEXT NOT NULL DEFAULT 'invited', invited_at TEXT NOT NULL DEFAULT (datetime('now')), joined_at TEXT, ended_at TEXT)`);
  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 1000 * 60 * 60 * 24 * 90 };
  const inst = handle => db.prepare("SELECT * FROM makers WHERE handle=? AND kind='institution'").get(String(handle));
  // The institutions a signed-in person works for.
  const staffOf = b => (b ? db.prepare("SELECT m.*, s.role AS staff_role, s.name AS staff_name FROM institution_staff s JOIN makers m ON m.id=s.maker_id WHERE s.status='on' AND (s.buyer_id=? OR lower(s.email)=lower(?)) ORDER BY m.name").all(b.id, b.email || '-') : []);
  // The institution a request acts for, if the person has chosen one they work for: consulted by makerOf.
  function actingFor(req) {
    const h = req.cookies && req.cookies.wm_staff; if (!h) return null;
    const b = buyerOf(req); if (!b) return null;
    return staffOf(b).find(m => m.handle === h) || null;
  }
  const mayManage = (req, m) => { if (isStudio(req)) return true; const me = makerOf(req); return !!(me && me.id === m.id); };
  // The team's desk: /account/staff (the institution signed in, or the Studio as it).
  app.get('/account/staff', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); if (m.kind !== 'institution') return res.redirect('/account');
    const rows = db.prepare("SELECT * FROM institution_staff WHERE maker_id=? AND status!='ended' ORDER BY role, name").all(m.id);
    res.send(V.layout({ title: 'The team · Watermark', path: '/account/staff', studio: true, body: `<section class="studio-wrap tm"><p class="k">${esc(m.name)}</p><h1>The team.</h1>
<p class="lede">Everyone who works the desk for ${esc(m.name)}: invited by letter, signed in as themselves, acting for the institution. Take a seat back any time.${req.query.ok ? ` <b>${esc(String(req.query.ok))}</b>` : ''}</p>
<form method="post" action="/account/staff" class="tm-f"><label><span>Name</span><input name="name" required maxlength="120"></label><label><span>Email</span><input type="email" name="email" required maxlength="160"></label><label><span>Role</span><select name="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label><button class="buy-btn">Send the invitation</button></form>
${rows.length ? `<table class="tbl tm-t"><tr><th>Name</th><th>Role</th><th>Email</th><th>State</th><th></th></tr>${rows.map(s => `<tr><td>${esc(s.name || '')}</td><td>${esc(ROLES[s.role] || s.role)}</td><td>${esc(s.email)}</td><td>${s.status === 'on' ? `Joined ${esc(date(s.joined_at))}` : `Invited ${esc(date(s.invited_at))}`}</td><td><form method="post" action="/account/staff/${s.id}/end"><button class="link">Take the seat back</button></form></td></tr>`).join('')}</table>` : '<p>No one yet. Invite your rights desk first.</p>'}
<p class="hg-share"><a href="/account/house">Your own house: your address, your name on the door</a></p>
<p class="note">What a seat opens: the studio and the vault, the rights desk, the curators’ keys, the collection’s records, getting paid. Roles are shown beside each name; finer doors by role come with the first museum’s wishes.</p></section>` }));
  });
  app.post('/account/staff', (req, res) => {
    const m = makerOf(req); if (!m || m.kind !== 'institution') return res.sendStatus(401);
    const b = req.body || {}, name = String(b.name || '').trim().slice(0, 120), email = String(b.email || '').trim().toLowerCase().slice(0, 160), role = ROLES[b.role] ? b.role : 'curator';
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect('/account/staff?ok=' + encodeURIComponent('A name and an email, please.'));
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare("INSERT INTO institution_staff (maker_id, email, name, role, token) VALUES (?,?,?,?,?)").run(m.id, email, name, role, token);
    mail.send({ to: email, subject: `${m.name}’s desk on Watermark`, text: `${name.split(' ')[0]},\n\nYou have a seat at ${m.name}’s desk on Watermark, as ${ROLES[role].toLowerCase()}. Open it from this link, once, on the device you open it on:\n\n${C.base}/staff/join/${token}\n\nAfterwards you sign in with your email. Welcome.` });
    try { ledger.append(db, 'staff.invited', m.handle, { role }); } catch (e) { /* */ }
    res.redirect('/account/staff?ok=' + encodeURIComponent(`${name} invited.`));
  });
  app.post('/account/staff/:id/end', (req, res) => {
    const m = makerOf(req); if (!m || m.kind !== 'institution') return res.sendStatus(401);
    db.prepare("UPDATE institution_staff SET status='ended', ended_at=datetime('now') WHERE id=? AND maker_id=?").run(+req.params.id, m.id);
    try { ledger.append(db, 'staff.ended', m.handle, {}); } catch (e) { /* */ }
    res.redirect('/account/staff?ok=' + encodeURIComponent('The seat is taken back.'));
  });
  app.get('/staff/join/:token', (req, res) => {
    const s = db.prepare("SELECT * FROM institution_staff WHERE token=? AND status!='ended'").get(String(req.params.token)); if (!s) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(s.maker_id); if (!m) return res.sendStatus(404);
    if (admit) admit(req, res, s.email);
    const b = db.prepare('SELECT * FROM buyers WHERE lower(email)=lower(?)').get(s.email);
    if (b && s.name && !b.name) db.prepare('UPDATE buyers SET name=? WHERE id=?').run(s.name, b.id);
    db.prepare("UPDATE institution_staff SET status='on', buyer_id=?, joined_at=COALESCE(joined_at, datetime('now')) WHERE id=?").run(b ? b.id : null, s.id);
    res.cookie('wm_staff', m.handle, cookieOpts);
    try { ledger.append(db, 'staff.joined', m.handle, { role: s.role }); } catch (e) { /* */ }
    if (notify) notify({ maker_id: m.id, kind: 'show', title: `${s.name || s.email} joined the desk`, body: `As ${ROLES[s.role] || s.role}.`, href: '/account/staff' }).catch(() => {});
    res.redirect(s.role === 'rights' ? '/account/rights' : '/account');
  });
  // Choose which institution to act for (a person may sit at more than one desk), or step back to oneself.
  app.get('/staff/as/:handle', (req, res) => {
    const b = buyerOf(req); const m = b && staffOf(b).find(x => x.handle === String(req.params.handle));
    if (!m) return res.sendStatus(403);
    res.cookie('wm_staff', m.handle, cookieOpts); res.redirect('/account');
  });
  app.post('/staff/off', (req, res) => { res.clearCookie('wm_staff'); res.redirect('/yours'); });
  // The museum strip for the maker page.
  function museumStrip(m) {
    if (!m || m.kind !== 'institution') return '';
    const held = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(m.id).n;
    const open = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held' AND open IS NOT NULL").get(m.id).n;
    const team = db.prepare("SELECT name, role FROM institution_staff WHERE maker_id=? AND status='on' ORDER BY role").all(m.id);
    let shows = []; try { shows = db.prepare("SELECT h.title, h.slug, h.opens_at, h.closes_at FROM hangs h WHERE h.public=1 AND h.for_maker_id=? ORDER BY h.opens_at DESC LIMIT 4").all(m.id); } catch (e) { shows = []; }
    return `<section class="mu-strip"><div class="mh-wrap"><p class="k">The museum</p><nav class="mu-doors">
<a href="/m/${esc(m.handle)}#works"><b>${held.toLocaleString('en-US')}</b><span>works in the collection${open ? `, ${open.toLocaleString('en-US')} open access` : ''}</span></a>
${shows.length ? `<a href="/hang/${esc(shows[0].slug)}"><b>On view</b><span>${esc(shows[0].title)}${shows.length > 1 ? ` and ${shows.length - 1} more` : ''}</span></a>` : `<a href="/collectors#shows"><b>On view</b><span>Walls hung by the museum’s curators</span></a>`}
<a href="/rights/${esc(m.handle)}"><b>Rights and reproductions</b><span>One door for every request, with a ticket to follow</span></a>
<a href="/stroll?maker=${esc(m.handle)}"><b>Stroll the collection</b><span>One work at a time, with the guide</span></a>
<a href="/frame/tv?set=maker:${esc(m.handle)}"><b>On your television</b><span>The collection on a Frame at home, free</span></a>
<a href="/keys/at/${esc(m.handle)}"><b>The Keys at ${esc(m.name)}</b><span>The benches, the tours, the balcony: for those who have just looked</span></a>
${m.site ? `<a href="${esc(m.site)}" rel="noopener"><b>Visit</b><span>${esc(m.site.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</span></a>` : ''}
</nav>${team.length ? `<p class="mu-team">The desk: ${team.map(s => `${esc(s.name || '')} <i>${esc(ROLES[s.role] || s.role)}</i>`).join(' · ')}.</p>` : ''}</div></section>`;
  }
  app.locals.institutions = { ROLES, staffOf, actingFor, museumStrip, mayManage };
  return app.locals.institutions;
}
module.exports = { mountInstitutions, ROLES };
