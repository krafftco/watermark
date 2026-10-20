// The cabinet. Rembrandt kept a kunstkamer: a room of what he owned, shown to the people he chose. Here a
// collector photographs the works they own (paintings, prints, objects: not the house's photographs, their
// own) and keeps them in a cabinet that is private by default. From the cabinet they open showings: a
// titled selection, in an order, with a line on each, opened to named guests by invitation for a run of
// dates, or to everyone if they choose. The images of a showing are served only to the people it is open to,
// never cached by the app, never indexed, and the house never says where a work hangs. A guest is a person
// with a letter, not an account. Limits (drafts): 200 works in a cabinet, 60 MB a file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { layout, esc, date, tidy } = require('./views');
const CAP = 200, MAX_MB = 60;
const ACCESS = { private: 'Yours alone', guests: 'Guests by invitation', public: 'Everyone' };

function mountCabinet(app, { db, C, mail, ledger, store, images, buyerOf, setBuyer }) {
  db.exec(`CREATE TABLE IF NOT EXISTS cabinet (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL, title TEXT NOT NULL, artist TEXT, year TEXT, medium TEXT, dims TEXT, note TEXT,
      file TEXT NOT NULL, width INTEGER, height INTEGER, sha256 TEXT, bytes INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS cabinet_buyer ON cabinet(buyer_id);
    CREATE TABLE IF NOT EXISTS showings (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, line TEXT, access TEXT NOT NULL DEFAULT 'private',
      opens_at TEXT, closes_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS showing_works (showing_id INTEGER NOT NULL, cabinet_id INTEGER NOT NULL, pos INTEGER NOT NULL DEFAULT 0, note TEXT, PRIMARY KEY (showing_id, cabinet_id));
    CREATE TABLE IF NOT EXISTS showing_guests (id INTEGER PRIMARY KEY, showing_id INTEGER NOT NULL, email TEXT NOT NULL, name TEXT, token TEXT UNIQUE NOT NULL, invited_at TEXT NOT NULL DEFAULT (datetime('now')), seen_at TEXT, visits INTEGER NOT NULL DEFAULT 0)`);
  const { nanoid } = require('nanoid');
  const dir = path.join(C.dataDir, 'cabinet'), cache = path.join(C.dataDir, 'cache-cabinet'); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(cache, { recursive: true });
  const multer = require('multer');
  const upload = multer({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 }, fileFilter: (req, f, cb) => cb(null, /^image\//.test(f.mimetype)) });
  const slugOf = t => { const base = String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'showing'; let s = base, k = 2; while (db.prepare('SELECT 1 FROM showings WHERE slug=?').get(s)) s = `${base}-${k++}`; return s; };
  const href = s => `/g/${s.owner_code || (db.prepare('SELECT code FROM buyers WHERE id=?').get(s.buyer_id) || {}).code || ''}/show/${s.slug}`;
  const sign = v => crypto.createHmac('sha256', C.secret).update(v).digest('base64url').slice(0, 24);

  const holding = id => db.prepare('SELECT * FROM cabinet WHERE id=?').get(Number(id));
  const holdings = b => (b ? db.prepare('SELECT * FROM cabinet WHERE buyer_id=? ORDER BY id DESC').all(b.id) : []);
  const showing = (k, by = 'slug') => db.prepare(`SELECT s.*, b.name AS owner, b.code AS owner_code, b.public AS owner_public FROM showings s JOIN buyers b ON b.id=s.buyer_id WHERE s.${by}=?`).get(by === 'id' ? Number(k) : String(k));
  const showings = b => (b ? db.prepare('SELECT s.*, (SELECT code FROM buyers WHERE id=s.buyer_id) AS owner_code, (SELECT COUNT(*) FROM showing_works sw WHERE sw.showing_id=s.id) AS n, (SELECT COUNT(*) FROM showing_guests g WHERE g.showing_id=s.id) AS guests FROM showings s WHERE buyer_id=? ORDER BY updated_at DESC').all(b.id) : []);
  const worksOf = s => db.prepare('SELECT c.*, sw.pos, sw.note AS wall_note FROM showing_works sw JOIN cabinet c ON c.id=sw.cabinet_id WHERE sw.showing_id=? ORDER BY sw.pos, c.id').all(s.id);
  const guestsOf = s => db.prepare('SELECT * FROM showing_guests WHERE showing_id=? ORDER BY id').all(s.id);
  const open = s => { const now = new Date().toISOString(); return (!s.opens_at || s.opens_at <= now) && (!s.closes_at || s.closes_at >= now); };
  const ensure = (req, res) => { let b = buyerOf(req); if (!b) { const id = db.prepare("INSERT INTO buyers (customer, email, code) VALUES ('', NULL, ?)").run(nanoid(10)).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); } return b; };
  const touch = id => db.prepare("UPDATE showings SET updated_at=datetime('now') WHERE id=?").run(id);

  // Who may see a showing: its owner; everyone, while it runs, if it is public; a guest with a letter (the token,
  // kept in a cookie once used), or a signed-in collector whose email is on the list.
  const guestCookie = req => { try { return JSON.parse((req.cookies && req.cookies.wm_g) || '{}'); } catch (e) { return {}; } };
  const admitGuest = (req, res, s, g) => { const m = guestCookie(req); m[s.id] = g.token; res.cookie('wm_g', JSON.stringify(m), { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 90 * 864e5 }); };
  function canSee(req, s) {
    const b = buyerOf(req); if (b && b.id === s.buyer_id) return { who: 'owner' };
    if (s.access === 'public' && open(s)) return { who: 'public' };
    if (s.access === 'guests' && open(s)) {
      const t = guestCookie(req)[s.id]; const g = t ? db.prepare('SELECT * FROM showing_guests WHERE showing_id=? AND token=?').get(s.id, t) : null;
      if (g) return { who: 'guest', guest: g };
      if (b && b.email) { const g2 = db.prepare('SELECT * FROM showing_guests WHERE showing_id=? AND lower(email)=lower(?)').get(s.id, b.email); if (g2) return { who: 'guest', guest: g2 }; }
    }
    return null;
  }
  const mine = (req, id) => { const b = buyerOf(req), s = showing(id, 'id'); return b && s && s.buyer_id === b.id ? s : null; };

  // The cabinet: a work photographed and put in.
  app.post('/cabinet/add', (req, res, next) => upload.single('file')(req, res, e => (e ? res.redirect('/yours?tab=cabinet&cab=file') : next())), async (req, res) => {
    const b = ensure(req, res), x = req.body || {}; if (!req.file) return res.redirect('/yours?tab=cabinet&cab=file');
    if (holdings(b).length >= CAP) { fs.unlinkSync(req.file.path); return res.redirect('/yours?tab=cabinet&cab=full'); }
    const title = String(x.title || '').trim().slice(0, 160) || 'Untitled';
    let info; try { info = await images.inspect(req.file.path); } catch (e) { fs.unlinkSync(req.file.path); return res.redirect('/yours?tab=cabinet&cab=file'); }
    const ext = /png$/i.test(req.file.mimetype) ? '.png' : /tiff?$/i.test(req.file.mimetype) ? '.tif' : '.jpg';
    const id = db.prepare('INSERT INTO cabinet (buyer_id, title, artist, year, medium, dims, note, file, width, height, sha256, bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(b.id, title, String(x.artist || '').trim().slice(0, 120) || null, String(x.year || '').trim().slice(0, 20) || null, String(x.medium || '').trim().slice(0, 120) || null, String(x.dims || '').trim().slice(0, 80) || null, String(x.note || '').trim().slice(0, 1000) || null, 'pending', info.width, info.height, info.sha256, req.file.size).lastInsertRowid;
    const file = `c${id}${ext}`; fs.renameSync(req.file.path, path.join(dir, file));
    try { await store.put('cabinet/' + file, path.join(dir, file)); } catch (e) { console.error('[cabinet vault]', e.message); }
    db.prepare('UPDATE cabinet SET file=? WHERE id=?').run(file, id);
    ledger.append(db, 'cabinet.kept', `cabinet-${id}`, { fingerprint: info.sha256 });                   // hidden on the register: the cabinet is private
    if (x.showing) { const s = mine(req, x.showing); if (s) { const pos = db.prepare('SELECT COALESCE(MAX(pos),0)+1 p FROM showing_works WHERE showing_id=?').get(s.id).p; db.prepare('INSERT OR IGNORE INTO showing_works (showing_id, cabinet_id, pos) VALUES (?,?,?)').run(s.id, id, pos); touch(s.id); return res.redirect(`${href(s)}`); } }
    res.redirect('/yours?tab=cabinet&cab=kept');
  });
  app.post('/cabinet/:id/edit', (req, res) => {
    const b = buyerOf(req), c = holding(req.params.id); if (!b || !c || c.buyer_id !== b.id) return res.sendStatus(404); const x = req.body || {};
    if (x.do === 'remove') { db.prepare('DELETE FROM showing_works WHERE cabinet_id=?').run(c.id); db.prepare('DELETE FROM cabinet WHERE id=?').run(c.id); return res.redirect('/yours?tab=cabinet'); }
    db.prepare('UPDATE cabinet SET title=?, artist=?, year=?, medium=?, dims=?, note=? WHERE id=?').run(String(x.title || c.title).trim().slice(0, 160) || c.title, String(x.artist || '').trim().slice(0, 120) || null, String(x.year || '').trim().slice(0, 20) || null, String(x.medium || '').trim().slice(0, 120) || null, String(x.dims || '').trim().slice(0, 80) || null, String(x.note || '').trim().slice(0, 1000) || null, c.id);
    res.redirect('/yours?tab=cabinet');
  });
  // Its image, only to those who may see a showing it hangs in (or its owner). Never cached, never indexed.
  app.get('/cab/:id/:size', async (req, res) => {
    const c = holding(req.params.id); if (!c || c.file === 'pending') return res.sendStatus(404);
    const size = ['thumb', 'screen', 'large'].includes(req.params.size) ? req.params.size : 'screen';
    const b = buyerOf(req); let ok = b && b.id === c.buyer_id;
    if (!ok) for (const s of db.prepare('SELECT s.* FROM showings s JOIN showing_works sw ON sw.showing_id=s.id WHERE sw.cabinet_id=?').all(c.id)) { if (canSee(req, s)) { ok = true; break; } }
    if (!ok) return res.sendStatus(404);
    let orig = path.join(dir, c.file);
    if (!fs.existsSync(orig)) { try { const buf = await store.get('cabinet/' + c.file); if (!buf) return res.sendStatus(404); fs.writeFileSync(orig, buf); } catch (e) { return res.sendStatus(503); } }
    try { const out = await images.derivative(orig, cache, `c${c.id}`, size); res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, noimageindex' }); res.sendFile(out); } catch (e) { res.sendStatus(500); }
  });

  // Showings.
  app.post('/showings/new', (req, res) => {
    const b = ensure(req, res), x = req.body || {}; const title = String(x.title || '').trim().slice(0, 80); if (!title) return res.redirect('/yours?tab=cabinet');
    const id = db.prepare('INSERT INTO showings (buyer_id, slug, title, line) VALUES (?,?,?,?)').run(b.id, slugOf(title), title, String(x.line || '').trim().slice(0, 600) || null).lastInsertRowid;
    res.redirect(href(showing(id, 'id')));
  });
  app.get('/g/:code/show/:slug', (req, res, next) => { req.url = `/show/${req.params.slug}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`; next(); });
  app.get('/show/:slug', (req, res) => {
    const s = showing(req.params.slug); if (!s) return res.sendStatus(404);
    const see = canSee(req, s); if (!see) return res.status(404).send(closedPage({ s, b: buyerOf(req) }));
    if (see.who === 'guest') db.prepare("UPDATE showing_guests SET seen_at=COALESCE(seen_at, datetime('now')), visits=visits+1 WHERE id=?").run(see.guest.id);
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': s.access === 'public' ? 'noimageindex' : 'noindex, noimageindex' });
    res.send(showingPage({ s, works: worksOf(s), own: see.who === 'owner', see, guests: see.who === 'owner' ? guestsOf(s) : [], cabinet: see.who === 'owner' ? holdings(buyerOf(req)) : [], ok: req.query.ok || null, base: C.base, running: open(s), ACCESS }));
  });
  // A guest's letter: the link admits them and remembers them on this device.
  app.get('/show/:slug/g/:token', (req, res) => {
    const s = showing(req.params.slug); if (!s) return res.sendStatus(404);
    const g = db.prepare('SELECT * FROM showing_guests WHERE showing_id=? AND token=?').get(s.id, String(req.params.token)); if (!g) return res.status(404).send(closedPage({ s, b: buyerOf(req) }));
    admitGuest(req, res, s, g); res.redirect(`${href(s)}`);
  });
  app.post('/show/:id/edit', (req, res) => {
    const s = mine(req, req.params.id); if (!s) return res.sendStatus(404); const x = req.body || {};
    const access = ACCESS[x.access] ? x.access : s.access;
    const d = v => { const t = String(v || '').trim(); if (!t) return null; const dt = new Date(t); return isNaN(dt) ? null : dt.toISOString(); };
    db.prepare("UPDATE showings SET title=?, line=?, access=?, opens_at=?, closes_at=?, updated_at=datetime('now') WHERE id=?").run(String(x.title || s.title).trim().slice(0, 80) || s.title, String(x.line || '').trim().slice(0, 600) || null, access, d(x.opens_at), d(x.closes_at), s.id);
    if (access === 'public' && s.access !== 'public') ledger.append(db, 'showing.opened', `showing-${s.id}`, { title: s.title, slug: s.slug });
    res.redirect(`${href(s)}?ok=saved`);
  });
  app.post('/show/:id/work', (req, res) => {
    const s = mine(req, req.params.id); if (!s) return res.sendStatus(404); const x = req.body || {}; const c = holding(x.cabinet); if (!c || c.buyer_id !== s.buyer_id) return res.redirect(`${href(s)}`);
    if (x.do === 'add') { const pos = db.prepare('SELECT COALESCE(MAX(pos),0)+1 p FROM showing_works WHERE showing_id=?').get(s.id).p; db.prepare('INSERT OR IGNORE INTO showing_works (showing_id, cabinet_id, pos) VALUES (?,?,?)').run(s.id, c.id, pos); }
    else if (x.do === 'remove') db.prepare('DELETE FROM showing_works WHERE showing_id=? AND cabinet_id=?').run(s.id, c.id);
    else if (x.do === 'note') db.prepare('UPDATE showing_works SET note=? WHERE showing_id=? AND cabinet_id=?').run(String(x.note || '').trim().slice(0, 400) || null, s.id, c.id);
    else if (x.do === 'up' || x.do === 'down') { const rows = db.prepare('SELECT cabinet_id, pos FROM showing_works WHERE showing_id=? ORDER BY pos, cabinet_id').all(s.id); const i = rows.findIndex(r => r.cabinet_id === c.id), j = x.do === 'up' ? i - 1 : i + 1; if (i >= 0 && j >= 0 && j < rows.length) { [rows[i], rows[j]] = [rows[j], rows[i]]; const up = db.prepare('UPDATE showing_works SET pos=? WHERE showing_id=? AND cabinet_id=?'); rows.forEach((r, k) => up.run(k, s.id, r.cabinet_id)); } }
    touch(s.id); res.redirect(`${href(s)}`);
  });
  // Guests: a letter each, by mail, with their own link; removable; the owner sees who has come.
  app.post('/show/:id/guests', (req, res) => {
    const s = mine(req, req.params.id); if (!s) return res.sendStatus(404); const x = req.body || {};
    if (x.do === 'remove') { db.prepare('DELETE FROM showing_guests WHERE id=? AND showing_id=?').run(Number(x.guest), s.id); return res.redirect(`${href(s)}?ok=removed`); }
    const lines = String(x.guests || '').split(/\n|,|;/).map(t => t.trim()).filter(Boolean).slice(0, 50); let n = 0;
    for (const line of lines) {
      const m = line.match(/^(?:(.*?)\s*<)?([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>?$/); if (!m) continue;
      const email = m[2].toLowerCase(), name = (m[1] || '').trim().replace(/^"|"$/g, '') || null;
      if (db.prepare('SELECT 1 FROM showing_guests WHERE showing_id=? AND email=?').get(s.id, email)) continue;
      const token = nanoid(24);
      db.prepare('INSERT INTO showing_guests (showing_id, email, name, token) VALUES (?,?,?,?)').run(s.id, email, name, token); n++;
      const url = `${C.base}/show/${s.slug}/g/${token}`;
      mail.send({ to: email, subject: `${s.owner || 'A collector'} invites you to a private showing: ${s.title}`, text: `${s.owner || 'A collector'} has opened a private showing on Watermark, "${s.title}", to a few people, and you are one of them.${s.line ? `\n\n${s.line}` : ''}${s.closes_at ? `\n\nIt runs until ${date(s.closes_at)}.` : ''}\n\nThis letter is yours alone; the link admits you and no one else: ${url}\n\nWhat you see is private to the room. The house never says where a work hangs.`, feature: 'A private showing', cta: { label: 'Enter the showing', url } });
    }
    if (n && s.access === 'private') db.prepare("UPDATE showings SET access='guests' WHERE id=?").run(s.id);
    res.redirect(`${href(s)}?ok=invited&n=${n}`);
  });
  app.post('/show/:id/delete', (req, res) => { const s = mine(req, req.params.id); if (!s) return res.sendStatus(404); db.prepare('DELETE FROM showing_works WHERE showing_id=?').run(s.id); db.prepare('DELETE FROM showing_guests WHERE showing_id=?').run(s.id); db.prepare('DELETE FROM showings WHERE id=?').run(s.id); res.redirect('/yours?tab=cabinet'); });

  app.locals.cabinet = { holdings, showings, showing, worksOf, canSee, CAP, ACCESS };
  return app.locals.cabinet;
}

const fig = (c, note, i) => `<figure class="hg-fig"><a class="hg-im" href="/cab/${c.id}/large" style="--r:${(c.width && c.height ? c.width / c.height : 1.3).toFixed(3)}" onclick="return false"><img src="/cab/${c.id}/screen" alt="${esc(tidy(c.title))}" loading="${i < 2 ? 'eager' : 'lazy'}" draggable="false"></a><figcaption><span class="hg-n">${i + 1}</span><b>${esc(tidy(c.title))}</b><i>${esc([c.artist, c.year, c.medium, c.dims].filter(Boolean).join(' · '))}</i>${note ? `<p class="hg-note">${esc(note)}</p>` : ''}</figcaption></figure>`;

function showingPage({ s, works, own, see, guests, cabinet, ok, base, running, ACCESS }) {
  const notice = { saved: 'Saved.', invited: 'Letters sent.', removed: 'Removed.' }[ok];
  const inShow = new Set(works.map(w => w.id));
  const dt = v => (v ? new Date(v).toISOString().slice(0, 16) : '');
  return layout({ title: `${s.title} · a showing · Watermark`, bare: s.access !== 'public', body: `<section class="cx-intro hg-head"><p class="k">A showing${s.access === 'public' ? '' : ' · private'}${!running ? ' · not running' : ''}</p><h1>${esc(s.title)}.</h1>
<p class="hg-by">From the cabinet of ${s.owner_public && s.owner_code ? `<a href="/g/${esc(s.owner_code)}">${esc(s.owner || 'a collector')}</a>` : esc(s.owner || 'a collector')} · ${works.length} work${works.length === 1 ? '' : 's'}${s.closes_at ? ` · until ${date(s.closes_at)}` : ''}${see.who === 'guest' ? ` · opened to you${see.guest.name ? `, ${esc(see.guest.name)}` : ''}` : ''}</p>
${s.line ? `<p class="lede">${esc(s.line)}</p>` : ''}
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
${own ? `<details class="hg-edit"><summary>The showing: who may come, and when</summary>
<form method="post" action="/show/${s.id}/edit" class="cl-f"><label><span>Title</span><input name="title" value="${esc(s.title)}" maxlength="80" required></label><label><span>A line at the door</span><textarea name="line" rows="2" maxlength="600">${esc(s.line || '')}</textarea></label>
<fieldset><legend>Open to</legend>${Object.entries(ACCESS).map(([k, t]) => `<label class="cl-k"><input type="radio" name="access" value="${k}" ${s.access === k ? 'checked' : ''}> ${t}${k === 'public' ? ' (listed nowhere; anyone with the link, while it runs)' : ''}</label>`).join('')}</fieldset>
<div class="cb-run"><label><span>Opens</span><input type="datetime-local" name="opens_at" value="${dt(s.opens_at)}"></label><label><span>Closes</span><input type="datetime-local" name="closes_at" value="${dt(s.closes_at)}"></label></div>
<button class="buy-btn">Save</button></form>
<h3>Guests</h3><p class="note">Each guest is sent a letter with a link of their own; it admits them and no one else. Remove a guest and their link stops working.</p>
${guests.length ? `<ul class="cb-guests">${guests.map(g => `<li><span>${esc(g.name || '')} &lt;${esc(g.email)}&gt;</span><small>${g.seen_at ? `came ${date(g.seen_at)}${g.visits > 1 ? `, ${g.visits} times` : ''}` : 'not yet come'}</small><form method="post" action="/show/${s.id}/guests"><input type="hidden" name="do" value="remove"><input type="hidden" name="guest" value="${g.id}"><button class="link">Remove</button></form></li>`).join('')}</ul>` : ''}
<form method="post" action="/show/${s.id}/guests" class="cl-f"><label><span>Invite (one a line: Name &lt;email&gt;, or just the email)</span><textarea name="guests" rows="3" placeholder="Ada Lovelace <ada@example.com>"></textarea></label><button class="buy-btn">Send the letters</button></form>
<h3>From your cabinet</h3>${cabinet.filter(c => !inShow.has(c.id)).length ? `<div class="cb-pick">${cabinet.filter(c => !inShow.has(c.id)).map(c => `<form method="post" action="/show/${s.id}/work"><input type="hidden" name="do" value="add"><input type="hidden" name="cabinet" value="${c.id}"><button title="${esc(c.title)}"><img src="/cab/${c.id}/thumb" alt="${esc(c.title)}"></button></form>`).join('')}</div>` : '<p class="note">Everything in your cabinet is on this wall. <a href="/yours?tab=cabinet">Put more in</a>.</p>'}
<form method="post" action="/show/${s.id}/delete" onsubmit="return confirm('Close this showing for good? The works stay in your cabinet.')"><button class="link">Close the showing for good</button></form></details>` : ''}</section>
<section class="hg-wall">${works.map((c, i) => `<div class="hg-pl">${fig(c, c.wall_note, i)}${own ? `<form method="post" action="/show/${s.id}/work" class="hg-ctl"><input type="hidden" name="cabinet" value="${c.id}"><button name="do" value="up">Earlier</button><button name="do" value="down">Later</button><input name="note" placeholder="A line on this one" value="${esc(c.wall_note || '')}" maxlength="400"><button name="do" value="note">Keep the line</button><button name="do" value="remove" class="hg-rm">Take it down</button></form>` : ''}</div>`).join('') || '<p class="note hg-empty">Nothing on the wall yet.</p>'}
<p class="cb-foot">A private showing on Watermark. The house never says where a work hangs.</p></section>` });
}

function closedPage({ s, b }) {
  return layout({ title: 'A showing · Watermark', bare: true, body: `<section class="narrow cl"><p class="k">A showing</p><h1>This room is not open to you.</h1><p class="lede">${esc(s.title)} is a private showing. If you were invited, open the letter you were sent; the link in it admits you.${b && b.email ? '' : ' If the invitation was addressed to your email, <a href="/signin">sign in</a> with it.'}</p><p class="sr-also"><a href="/">Watermark</a></p></section>` });
}

// Yours → Cabinet.
function cabinetBlock({ holdings, showings, state, CAP, ACCESS, registrar = () => '' }) {
  const notice = { recorded: 'The card is kept.', kept: 'Kept. It is in your cabinet, seen by you alone until you show it.', file: `The file could not be taken (an image, ${MAX_MB} MB at most).`, full: `Your cabinet holds ${CAP} works; write to the house for more.` }[state];
  return `<section class="gal yc-cab"><header class="gh"><h2>Your cabinet</h2><span>${holdings.length} work${holdings.length === 1 ? '' : 's'} · yours alone · <a href="/yours/cabinet/book">The book</a></span></header>
<p class="lede pk-lede">What you own, photographed. Rembrandt kept a room of what he collected and showed it to the people he chose. Put your works here, private by default; then open a showing to named guests for a run of dates, or to everyone. The house never says where a work hangs.</p>
${notice ? `<p class="${state === 'kept' ? 'ok' : 'err'}">${esc(notice)}</p>` : ''}
${holdings.length ? `<div class="cb-grid">${holdings.map(c => `<details class="cb-it"><summary><img src="/cab/${c.id}/thumb" alt="" loading="lazy" draggable="false"><b>${esc(tidy(c.title))}</b><small>${esc([c.artist, c.year].filter(Boolean).join(', '))}</small></summary><form method="post" action="/cabinet/${c.id}/edit" class="cl-f"><label><span>Title</span><input name="title" value="${esc(c.title)}" maxlength="160" required></label><label><span>Artist</span><input name="artist" value="${esc(c.artist || '')}" maxlength="120"></label><div class="cb-run"><label><span>Year</span><input name="year" value="${esc(c.year || '')}" maxlength="20"></label><label><span>Medium</span><input name="medium" value="${esc(c.medium || '')}" maxlength="120"></label><label><span>Dimensions</span><input name="dims" value="${esc(c.dims || '')}" maxlength="80"></label></div><label><span>Provenance, a note</span><textarea name="note" rows="2" maxlength="1000">${esc(c.note || '')}</textarea></label><button class="link">Keep</button> <button class="link hg-rm" name="do" value="remove" onclick="return confirm('Take it out of the cabinet?')">Take it out</button></form>${registrar(c)}</details>`).join('')}</div>` : ''}
<form method="post" action="/cabinet/add" enctype="multipart/form-data" class="cl-f cb-add"><h3>Put a work in</h3><label><span>The photograph (JPEG, PNG or TIFF, ${MAX_MB} MB at most)</span><input type="file" name="file" accept="image/*" required></label><label><span>Title</span><input name="title" maxlength="160" required></label><div class="cb-run"><label><span>Artist</span><input name="artist" maxlength="120"></label><label><span>Year</span><input name="year" maxlength="20"></label><label><span>Medium</span><input name="medium" maxlength="120"></label></div><label><span>Dimensions</span><input name="dims" maxlength="80" placeholder="61 × 46 cm"></label><label><span>Provenance, a note (private)</span><textarea name="note" rows="2" maxlength="1000"></textarea></label><button class="buy-btn">Put it in</button></form>
<header class="gh" style="margin-top:36px"><h2>Showings</h2><span>${showings.length}</span></header>
${showings.length ? `<div class="hg-list">${showings.map(s => `<a class="hd-ev" href="/g/${esc(s.owner_code || '')}/show/${esc(s.slug)}"><span>${esc(ACCESS[s.access] || s.access)}</span><b>${esc(s.title)}</b><span>${s.n} work${s.n === 1 ? '' : 's'}${s.guests ? ` · ${s.guests} guest${s.guests === 1 ? '' : 's'}` : ''}${s.closes_at ? ` · until ${date(s.closes_at)}` : ''}</span><span class="hd-v">Open</span></a>`).join('')}</div>` : ''}
<form method="post" action="/showings/new" class="cl-f hg-new"><label><span>A new showing</span><input name="title" placeholder="Its title" maxlength="80" required></label><label><span>A line at the door (optional)</span><input name="line" maxlength="600"></label><button class="buy-btn">Open it</button></form></section>`;
}

module.exports = { mountCabinet, cabinetBlock, showingPage, ACCESS, CAP };
