// Curators (Will, 18 Oct: "my gallery at Leica can curate my work and show my show, in Watermark; Michael was going to
// help me curate the show, to make the best set"). A maker opens the whole archive (public and kept back) to a curator
// or a gallery by letter; the curator works inside it, builds a show (a wall in Watermark's sense), sequences it, writes
// a line for each photograph and sends it to the maker; the maker approves (the show opens, and anything kept back that
// the show needs is published with it) or returns it with a note. A gallery that represents the maker has the same keys.
// The curator earns the house's curation share on what sells through the show, as any wall does.
const { nanoid } = require('nanoid');

function mountCurate(app, { db, C, V, I, mail, ledger, buyerOf, setBuyer, makerOf }) {
  db.exec(`CREATE TABLE IF NOT EXISTS curators (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, email TEXT NOT NULL, name TEXT, label TEXT, buyer_id INTEGER,
    token TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'invited', at TEXT NOT NULL DEFAULT (datetime('now')), joined_at TEXT, UNIQUE (maker_id, email))`);
  for (const [c, t] of [['for_maker_id', 'INTEGER'], ['review', 'TEXT'], ['review_note', 'TEXT']]) if (!db.prepare(`SELECT 1 FROM pragma_table_info('hangs') WHERE name='${c}'`).get()) db.exec(`ALTER TABLE hangs ADD COLUMN ${c} ${t}`);
  const esc = V.esc, tidy = V.tidy, slugOfMaker = V.makerSlug;
  const makerBySlug = s => db.prepare('SELECT * FROM makers').all().find(m => slugOfMaker(m) === s || m.handle === s) || null;
  const codeFor = b => { if (b.code) return b.code; const c = nanoid(10); db.prepare('UPDATE buyers SET code=? WHERE id=?').run(c, b.id); return c; };

  // May this person curate this maker? The maker, a curator they invited, or a gallery representing them.
  function canCurate(req, m) {
    if (!m) return false;
    const me = makerOf(req); if (me && me.id === m.id) return true;
    const b = buyerOf(req); if (!b) return false;
    if (db.prepare("SELECT 1 FROM curators WHERE maker_id=? AND status='on' AND (buyer_id=? OR lower(email)=lower(?))").get(m.id, b.id, b.email || '-')) return true;
    const g = db.prepare("SELECT g.id FROM makers g WHERE g.kind='gallery' AND (g.buyer_id=? OR lower(g.email)=lower(?))").get(b.id, b.email || '-');
    try { if (g && db.prepare("SELECT 1 FROM representation WHERE gallery_id=? AND maker_id=? AND status='on'").get(g.id, m.id)) return true; } catch (e) { /* no galleries yet */ }
    return false;
  }
  const archivesFor = b => {
    if (!b) return [];
    const a = db.prepare("SELECT m.* FROM curators c JOIN makers m ON m.id=c.maker_id WHERE c.status='on' AND (c.buyer_id=? OR lower(c.email)=lower(?))").all(b.id, b.email || '-');
    let r = []; try { r = db.prepare("SELECT m.* FROM representation x JOIN makers m ON m.id=x.maker_id JOIN makers g ON g.id=x.gallery_id WHERE x.status='on' AND g.kind='gallery' AND (g.buyer_id=? OR lower(g.email)=lower(?))").all(b.id, b.email || '-'); } catch (e) { /* none */ }
    const seen = new Set(); return [...a, ...r].filter(m => !seen.has(m.id) && seen.add(m.id));
  };
  app.locals.curate = { canCurate, archivesFor };
  const shell = (title, body) => V.layout({ title: `${title} · Watermark`, path: '/curate', body });
  const tell = (x) => { try { if (app.locals.notify) app.locals.notify.tell(x).catch(() => {}); } catch (e) { /* quiet */ } };

  // ---- The maker's side: who holds keys, and the shows waiting for an answer.
  app.get('/account/curators', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/curators');
    V.setDeskPath('/account/curators');
    const list = db.prepare("SELECT * FROM curators WHERE maker_id=? AND status!='ended' ORDER BY id DESC").all(m.id);
    const shows = db.prepare("SELECT h.*, b.name AS curator, b.code AS curator_code, (SELECT COUNT(*) FROM hang_works hw WHERE hw.hang_id=h.id) AS n FROM hangs h JOIN buyers b ON b.id=h.buyer_id WHERE h.for_maker_id=? AND h.review IN ('proposed','approved','returned') ORDER BY CASE h.review WHEN 'proposed' THEN 0 ELSE 1 END, h.updated_at DESC").all(m.id);
    const thumbs = h => db.prepare('SELECT w.slug FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? ORDER BY hw.pos LIMIT 6').all(h.id);
    const ok = req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : '';
    res.send(V.layout({ title: 'Curators · Your studio · Watermark', studio: true, path: '/account/curators', body: `<section class="cu">
<p class="k">Your studio</p><h1>Curators.</h1>
<p class="lede">Open your archive to someone whose eye you trust: a gallery, a curator, a friend with taste. They see everything you hold, kept-back work included, build a show from it and send it to you. Nothing opens until you say so.</p>${ok}
${shows.length ? `<h2>Shows for you</h2><ul class="cu-shows">${shows.map(h => `<li class="cu-show ${esc(h.review)}"><div class="cu-strip">${thumbs(h).map(t => `<img src="/img/${esc(t.slug)}/thumb" alt="" loading="lazy">`).join('')}</div><div class="cu-sh-t"><b>${esc(h.title)}</b><span>${h.n} photograph${h.n === 1 ? '' : 's'} &middot; by ${esc(h.curator || 'a curator')} &middot; ${h.review === 'proposed' ? 'waiting for you' : h.review === 'approved' ? 'open' : 'returned with a note'}</span>${h.line ? `<p>${esc(h.line)}</p>` : ''}</div>
<div class="cu-sh-go"><a href="/curate/show/${h.id}">See it</a>${h.review === 'proposed' ? `<form method="post" action="/account/shows/${h.id}/approve"><button class="buy-btn">Approve and open</button></form><form method="post" action="/account/shows/${h.id}/return" class="cu-ret"><input name="note" placeholder="A note back (optional)" maxlength="400"><button class="bk-alt">Return</button></form>` : ''}</div></li>`).join('')}</ul>` : ''}
<h2>Who holds keys</h2>
${list.length ? `<ul class="cu-keys">${list.map(c => `<li><div><b>${esc(c.name || c.email)}</b><span>${esc([c.label, c.email].filter(Boolean).join(' · '))}</span><small>${c.status === 'on' ? `In since ${esc(String(c.joined_at || c.at).slice(0, 10))}` : 'Letter sent, not yet opened'}</small></div><form method="post" action="/account/curators/${c.id}/end"><button class="bk-alt">Take back the keys</button></form></li>`).join('')}</ul>` : '<p class="note">No one yet.</p>'}
<form method="post" action="/account/curators" class="form cu-inv"><h2>Open your archive to someone</h2>
<label>Their name<input name="name" required maxlength="80" placeholder="Michael"></label>
<label>Their email<input name="email" type="email" required maxlength="160"></label>
<label>As (optional)<input name="label" maxlength="80" placeholder="Leica Gallery, curator"></label>
<button class="buy-btn">Send the keys</button>
<p class="note">They receive a letter with a link that opens your archive to them, signed in as themselves. You can take the keys back at any time; a show you approved stays open until you close it.</p></form>
</section>` }));
  });
  app.post('/account/curators', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const x = req.body || {}; const email = String(x.email || '').trim().toLowerCase().slice(0, 160);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect('/account/curators?ok=' + encodeURIComponent('That email does not look right.'));
    const token = nanoid(24); const name = String(x.name || '').trim().slice(0, 80) || null, label = String(x.label || '').trim().slice(0, 80) || null;
    db.prepare("INSERT INTO curators (maker_id, email, name, label, token, status) VALUES (?,?,?,?,?,'invited') ON CONFLICT(maker_id, email) DO UPDATE SET name=excluded.name, label=excluded.label, token=excluded.token, status=CASE WHEN curators.status='on' THEN 'on' ELSE 'invited' END").run(m.id, email, name, label, token);
    const link = `${C.base}/curate/join/${token}`;
    ledger.append(db, 'curator.invited', m.handle, { label });
    if (mail.on()) mail.send({ to: email, subject: `${m.name} has opened the archive to you`, text: `${name ? name.split(' ')[0] + ',\n\n' : ''}${m.name} has given you the keys to the archive on Watermark: every photograph held there, including the work kept back, to curate a show from.\n\nOpen it here (the link signs you in as yourself):\n${link}\n\nBuild the show, sequence it, write a line for each photograph if you like, and send it to ${m.name.split(' ')[0]}. Nothing opens to the public until ${m.name.split(' ')[0]} approves it.\n\nWatermark` });
    res.redirect('/account/curators?ok=' + encodeURIComponent(mail.on() ? `The keys are on their way to ${email}.` : `Mail is off. Send this link yourself: ${link}`));
  });
  app.post('/account/curators/:id/end', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    db.prepare("UPDATE curators SET status='ended' WHERE id=? AND maker_id=?").run(+req.params.id, m.id);
    res.redirect('/account/curators?ok=' + encodeURIComponent('The keys are back with you.'));
  });
  // Approve: the show opens, and whatever it needs from the kept-back work is published with it.
  app.post('/account/shows/:id/approve', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const h = db.prepare("SELECT * FROM hangs WHERE id=? AND for_maker_id=?").get(+req.params.id, m.id); if (!h) return res.sendStatus(404);
    const hidden = db.prepare("SELECT w.* FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? AND w.status='hidden' AND w.maker_id=?").all(h.id, m.id);
    for (const w of hidden) { db.prepare("UPDATE works SET status='held' WHERE id=?").run(w.id); ledger.append(db, 'work.published', w.slug, { by: 'show', show: h.slug }); }
    db.prepare("UPDATE hangs SET review='approved', review_note=NULL, public=1, updated_at=datetime('now') WHERE id=?").run(h.id);
    ledger.append(db, 'hang.opened', h.slug, { show: true, maker: m.handle });
    tell({ buyer_id: h.buyer_id, kind: 'reviewed', href: `/curate/show/${h.id}`, title: `${m.name} approved your show`, body: `${h.title} is open.${hidden.length ? ` ${hidden.length} photograph${hidden.length === 1 ? ' was' : 's were'} brought out for it.` : ''}` });
    res.redirect('/account/curators?ok=' + encodeURIComponent(`${h.title} is open.${hidden.length ? ` ${hidden.length} kept-back photograph${hidden.length === 1 ? '' : 's'} published with it.` : ''}`));
  });
  app.post('/account/shows/:id/return', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const h = db.prepare("SELECT * FROM hangs WHERE id=? AND for_maker_id=?").get(+req.params.id, m.id); if (!h) return res.sendStatus(404);
    const note = String((req.body || {}).note || '').trim().slice(0, 400) || null;
    db.prepare("UPDATE hangs SET review='returned', review_note=?, public=0, updated_at=datetime('now') WHERE id=?").run(note, h.id);
    tell({ buyer_id: h.buyer_id, kind: 'reviewed', href: `/curate/show/${h.id}`, title: `${m.name} returned your show with a note`, body: note || h.title });
    res.redirect('/account/curators?ok=' + encodeURIComponent('Returned.'));
  });

  // ---- The curator's side.
  app.get('/curate/join/:token', (req, res) => {
    const c = db.prepare("SELECT * FROM curators WHERE token=? AND status!='ended'").get(String(req.params.token)); if (!c) return res.sendStatus(404);
    if (app.locals.admit) app.locals.admit(req, res, c.email);
    const b = db.prepare('SELECT * FROM buyers WHERE lower(email)=lower(?)').get(c.email);
    if (b) { codeFor(b); if (c.name && !b.name) db.prepare('UPDATE buyers SET name=? WHERE id=?').run(c.name, b.id); }
    db.prepare("UPDATE curators SET status='on', buyer_id=?, joined_at=COALESCE(joined_at, datetime('now')) WHERE id=?").run(b ? b.id : null, c.id);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(c.maker_id);
    tell({ maker_id: m.id, kind: 'show', href: '/account/curators', title: `${c.name || c.email} opened your archive`, body: c.label ? `As ${c.label}.` : 'They can begin a show.' });
    res.redirect(`/curate/${slugOfMaker(m)}?welcome=1`);
  });
  app.get('/curate', (req, res) => {
    const b = buyerOf(req); const list = archivesFor(b); const me = makerOf(req);
    if (!b && !me) return res.redirect('/signin?next=/curate');
    if (list.length === 1 && !me) return res.redirect(`/curate/${slugOfMaker(list[0])}`);
    res.send(shell('Curate', `<section class="cu"><p class="k">Curate</p><h1>The archives open to you.</h1>${list.length ? `<ul class="cu-arch">${list.map(m => `<li><a href="/curate/${esc(slugOfMaker(m))}"><b>${esc(m.name)}</b><span>${esc(m.house || '')}</span></a></li>`).join('')}</ul>` : '<p class="lede">None yet. A maker opens their archive to you by letter.</p>'}${me ? `<p><a href="/curate/${esc(slugOfMaker(me))}">Your own archive</a> &middot; <a href="/account/curators">Who holds your keys</a></p>` : ''}</section>`));
  });
  const showsOf = (b, m) => (b ? db.prepare("SELECT h.*, (SELECT COUNT(*) FROM hang_works hw WHERE hw.hang_id=h.id) AS n FROM hangs h WHERE h.buyer_id=? AND h.for_maker_id=? ORDER BY h.updated_at DESC").all(b.id, m.id) : []);
  const showWorks = h => db.prepare("SELECT w.*, hw.pos, hw.note FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? ORDER BY hw.pos, w.id").all(h.id);
  const curatorBuyer = (req, res) => { let b = buyerOf(req); const me = makerOf(req); if (!b && me && me.email) { b = db.prepare('SELECT * FROM buyers WHERE lower(email)=lower(?)').get(me.email); if (b) setBuyer(res, b); } if (b) codeFor(b); return b; };
  // The desk: the whole archive on one side, the show being built on the other.
  app.get('/curate/:maker', (req, res) => {
    const m = makerBySlug(String(req.params.maker)); if (!m) return res.sendStatus(404);
    if (!canCurate(req, m)) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    const b = curatorBuyer(req, res); if (!b) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    const stars = Math.max(0, Math.min(5, parseInt(req.query.stars, 10) || 0)), q = String(req.query.q || '').trim().slice(0, 60);
    const args = [m.id]; let where = "w.maker_id=? AND w.status IN ('held','hidden') AND COALESCE(w.disputed,0)=0";
    if (stars) { where += ' AND w.stars>=?'; args.push(stars); }
    if (q) { where += ' AND (w.title LIKE ? OR w.place LIKE ? OR w.keywords LIKE ?)'; const l = `%${q.replace(/[%_]/g, '')}%`; args.push(l, l, l); }
    const works = db.prepare(`SELECT w.* FROM works w WHERE ${where} ORDER BY w.stars DESC, w.curated DESC, w.taken_at DESC, w.id DESC LIMIT 600`).all(...args);
    const total = db.prepare("SELECT COUNT(*) n, SUM(status='hidden') k FROM works WHERE maker_id=? AND status IN ('held','hidden')").get(m.id);
    const shows = showsOf(b, m); const cur = shows.find(s => String(s.id) === String(req.query.show)) || shows[0] || null;
    const inShow = new Set(cur ? showWorks(cur).map(w => w.id) : []);
    const seq = cur ? showWorks(cur) : [];
    const starsOf = n => '★'.repeat(n || 0);
    res.set('Cache-Control', 'private, no-store');
    res.send(shell(`Curating ${m.name}`, `<section class="cu cu-desk" data-cu data-show="${cur ? cur.id : ''}">
<header class="cu-h"><div><p class="k">Curating</p><h1>${esc(m.name)}&rsquo;s archive.</h1><p class="cu-n">${total.n} photographs held${total.k ? `, ${total.k} kept back (marked)` : ''}. ${req.query.welcome ? `${esc(m.name.split(' ')[0])} has given you the keys. Choose a show, or begin one.` : ''}</p></div>
<form method="get" class="cu-f"><input type="hidden" name="show" value="${cur ? cur.id : ''}"><input name="q" value="${esc(q)}" placeholder="A place, a word"><select name="stars" onchange="this.form.submit()"><option value="0">Every grade</option>${[3, 4, 5].map(s => `<option value="${s}"${stars === s ? ' selected' : ''}>${s}★ and above</option>`).join('')}</select><button class="bk-alt">Find</button></form></header>
<div class="cu-cols">
<div class="cu-grid">${works.map(w => `<button type="button" class="cu-w${inShow.has(w.id) ? ' on' : ''}${w.status === 'hidden' ? ' kept' : ''}" data-cu-w="${esc(w.slug)}" aria-pressed="${inShow.has(w.id)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy" draggable="false"><span><b>${esc(tidy(w.title))}</b><i>${esc(w.place || '')}${w.stars ? ` ${starsOf(w.stars)}` : ''}${w.status === 'hidden' ? ' · kept back' : ''}</i></span><em>${I.check}</em></button>`).join('') || '<p class="note">Nothing by that word or grade.</p>'}</div>
<aside class="cu-show">${cur ? `<form method="post" action="/curate/show/${cur.id}/title" class="cu-st"><input name="title" value="${esc(cur.title)}" maxlength="120" aria-label="The show's title"><textarea name="line" rows="3" maxlength="600" placeholder="The curator's statement">${esc(cur.line || '')}</textarea><button class="bk-alt">Keep</button></form>
<p class="cu-state">${cur.review === 'proposed' ? `With ${esc(m.name.split(' ')[0])} for approval.` : cur.review === 'approved' ? 'Open to the public.' : cur.review === 'returned' ? `Returned${cur.review_note ? `: &ldquo;${esc(cur.review_note)}&rdquo;` : '.'}` : 'A draft. Only you can see it.'}</p>
<ol class="cu-seq" data-cu-seq>${seq.map(w => `<li data-slug="${esc(w.slug)}"><span class="cu-grip">${I.grip}</span><img src="/img/${esc(w.slug)}/thumb" alt=""><div><b>${esc(tidy(w.title))}</b><input data-cu-note value="${esc(w.note || '')}" placeholder="A line for the wall" maxlength="240"></div><button type="button" class="cu-x" data-cu-out aria-label="Take it out">${I.close}</button></li>`).join('')}</ol>
<p class="cu-hint">${seq.length ? `${seq.length} in the show. Drag to sequence; the order is the walk.` : 'Tap photographs on the left to hang them here.'}</p>
${seq.length && cur.review !== 'proposed' && cur.review !== 'approved' ? `<form method="post" action="/curate/show/${cur.id}/propose"><button class="buy-btn">Send to ${esc(m.name.split(' ')[0])}</button></form>` : ''}
<p class="cu-links"><a href="/curate/show/${cur.id}">Preview</a>${shows.length > 1 ? ` &middot; ${shows.filter(s => s.id !== cur.id).map(s => `<a href="?show=${s.id}">${esc(s.title)}</a>`).join(' &middot; ')}` : ''}</p>` : '<p class="lede">Begin a show.</p>'}
<form method="post" action="/curate/${esc(slugOfMaker(m))}/show" class="cu-new"><input name="title" placeholder="${cur ? 'Another show' : 'The show’s title'}" maxlength="120" required><button class="bk-alt">Begin</button></form></aside>
</div></section><script src="/static/curate.js?v=${V.VER}" defer></script>`));
  });
  app.post('/curate/:maker/show', (req, res) => {
    const m = makerBySlug(String(req.params.maker)); if (!m || !canCurate(req, m)) return res.sendStatus(403);
    const b = curatorBuyer(req, res); if (!b) return res.sendStatus(401);
    const title = String((req.body || {}).title || '').trim().slice(0, 120) || `A show of ${m.name}`;
    let base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'show', s = base, k = 2; while (db.prepare('SELECT 1 FROM hangs WHERE slug=?').get(s)) s = `${base}-${k++}`;
    const id = db.prepare("INSERT INTO hangs (buyer_id, slug, title, public, for_maker_id, review) VALUES (?,?,?,0,?,'draft')").run(b.id, s, title, m.id).lastInsertRowid;
    res.redirect(`/curate/${slugOfMaker(m)}?show=${id}`);
  });
  const myShow = (req, id) => { const b = buyerOf(req); const h = db.prepare('SELECT * FROM hangs WHERE id=? AND for_maker_id IS NOT NULL').get(+id); if (!h) return null; const m = db.prepare('SELECT * FROM makers WHERE id=?').get(h.for_maker_id); const me = makerOf(req); if ((b && h.buyer_id === b.id && canCurate(req, m)) || (me && me.id === m.id)) return { h, m, mine: !!(b && h.buyer_id === b.id) }; return null; };
  app.post('/curate/show/:id/toggle', (req, res) => {
    const s = myShow(req, req.params.id); if (!s || !s.mine) return res.status(403).json({ ok: false });
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND maker_id=? AND status IN ('held','hidden')").get(String((req.body || {}).work || ''), s.m.id); if (!w) return res.status(404).json({ ok: false });
    const had = db.prepare('SELECT 1 FROM hang_works WHERE hang_id=? AND work_id=?').get(s.h.id, w.id);
    if (had) db.prepare('DELETE FROM hang_works WHERE hang_id=? AND work_id=?').run(s.h.id, w.id);
    else db.prepare('INSERT INTO hang_works (hang_id, work_id, pos) VALUES (?,?,(SELECT COALESCE(MAX(pos),-1)+1 FROM hang_works WHERE hang_id=?))').run(s.h.id, w.id, s.h.id);
    if (s.h.review === 'returned') db.prepare("UPDATE hangs SET review='draft' WHERE id=?").run(s.h.id);
    db.prepare("UPDATE hangs SET updated_at=datetime('now') WHERE id=?").run(s.h.id);
    res.json({ ok: true, in: !had, n: db.prepare('SELECT COUNT(*) n FROM hang_works WHERE hang_id=?').get(s.h.id).n, w: { slug: w.slug, title: tidy(w.title) } });
  });
  app.post('/curate/show/:id/order', (req, res) => {
    const s = myShow(req, req.params.id); if (!s || !s.mine) return res.status(403).json({ ok: false });
    const slugs = String((req.body || {}).order || '').split(',').filter(Boolean).slice(0, 500);
    const up = db.prepare('UPDATE hang_works SET pos=? WHERE hang_id=? AND work_id=(SELECT id FROM works WHERE slug=?)');
    db.transaction(() => slugs.forEach((sl, i) => up.run(i, s.h.id, sl)))(); res.json({ ok: true });
  });
  app.post('/curate/show/:id/note', (req, res) => {
    const s = myShow(req, req.params.id); if (!s || !s.mine) return res.status(403).json({ ok: false });
    db.prepare('UPDATE hang_works SET note=? WHERE hang_id=? AND work_id=(SELECT id FROM works WHERE slug=?)').run(String((req.body || {}).note || '').trim().slice(0, 240) || null, s.h.id, String((req.body || {}).work || ''));
    res.json({ ok: true });
  });
  app.post('/curate/show/:id/title', (req, res) => {
    const s = myShow(req, req.params.id); if (!s || !s.mine) return res.sendStatus(403);
    const x = req.body || {};
    db.prepare("UPDATE hangs SET title=?, line=?, updated_at=datetime('now') WHERE id=?").run(String(x.title || s.h.title).trim().slice(0, 120) || s.h.title, String(x.line || '').trim().slice(0, 600) || null, s.h.id);
    res.redirect(`/curate/${slugOfMaker(s.m)}?show=${s.h.id}`);
  });
  app.post('/curate/show/:id/propose', (req, res) => {
    const s = myShow(req, req.params.id); if (!s || !s.mine) return res.sendStatus(403);
    const n = db.prepare('SELECT COUNT(*) n FROM hang_works WHERE hang_id=?').get(s.h.id).n; if (!n) return res.redirect(`/curate/${slugOfMaker(s.m)}?show=${s.h.id}`);
    db.prepare("UPDATE hangs SET review='proposed', updated_at=datetime('now') WHERE id=?").run(s.h.id);
    const b = buyerOf(req); const who = (b && b.name) || 'Your curator';
    const first = db.prepare('SELECT w.slug FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? ORDER BY hw.pos LIMIT 1').get(s.h.id);
    tell({ maker_id: s.m.id, kind: 'show', slug: first && first.slug, href: '/account/curators', title: `${who} proposes a show`, body: `${s.h.title}: ${n} photograph${n === 1 ? '' : 's'}. Approve it, or return it with a note.` });
    if (mail.on() && s.m.email) mail.send({ to: s.m.email, subject: `A show for you to approve: ${s.h.title}`, text: `${who} has sequenced ${n} photographs of yours as "${s.h.title}".\n\nSee it, approve it or return it with a note:\n${C.base}/account/curators\n\nWatermark` });
    res.redirect(`/curate/${slugOfMaker(s.m)}?show=${s.h.id}`);
  });
  // The preview: the show as it will hang, kept-back work included, for the curator and the maker.
  app.get('/curate/show/:id', (req, res) => {
    const s = myShow(req, req.params.id); if (!s) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    const seq = showWorks(s.h); const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(s.h.buyer_id) || {};
    res.set('Cache-Control', 'private, no-store');
    res.send(shell(s.h.title, `<section class="cu-pv"><p class="k">${s.h.review === 'approved' ? 'Open' : 'Preview'} &middot; ${esc(s.m.name)}</p><h1>${esc(s.h.title)}</h1><p class="cu-by">Curated by ${esc(b.name || 'a curator')}</p>${s.h.line ? `<p class="lede">${esc(s.h.line)}</p>` : ''}
<ol class="cu-wall">${seq.map((w, i) => `<li><figure><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="${i < 2 ? 'eager' : 'lazy'}" draggable="false"></figure><p><b>${esc(tidy(w.title))}</b>${w.place ? `, ${esc(w.place)}` : ''}${w.status === 'hidden' ? ' <i>(kept back; published if approved)</i>' : ''}</p>${w.note ? `<p class="cu-line">${esc(w.note)}</p>` : ''}</li>`).join('')}</ol>
<p class="cu-pv-go">${s.mine ? `<a class="bk-alt" href="/curate/${esc(slugOfMaker(s.m))}?show=${s.h.id}">Back to the desk</a>` : ''}${!s.mine && s.h.review === 'proposed' ? `<form method="post" action="/account/shows/${s.h.id}/approve"><button class="buy-btn">Approve and open</button></form> <a class="bk-alt" href="/account/curators">Return with a note</a>` : ''}${s.h.review === 'approved' ? ` <a class="bk-alt" href="${esc(require('./hangs').hangHref ? require('./hangs').hangHref({ ...s.h, curator_code: b.code }) : '/hang/' + s.h.slug)}">The open show</a>` : ''}</p></section>`));
  });
}

module.exports = { mountCurate };
