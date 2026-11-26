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
  // (#225) What a curator is paid, in the one sentence hangs.js keeps beside the code that pays it.
  const H = require('./hangs'); const SHARE = H.curatorShare();
  const paid = who => `When a work is collected through ${who}, you earn ${SHARE}, never the maker’s. It is credited to your pocket at the sale; on Fridays what has cleared goes to your bank, once you have connected one.`;
  // The public address of a show, and the address a title gives (free among the walls and the addresses shows have left).
  const publicHref = h => H.hangHref({ ...h, curator_code: h.curator_code || (db.prepare('SELECT code FROM buyers WHERE id=?').get(h.buyer_id) || {}).code });
  const slugFor = (title, id) => { const base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'show'; let x = base, k = 2;
    while (db.prepare('SELECT 1 FROM hangs WHERE slug=? AND id!=?').get(x, id || 0) || db.prepare('SELECT 1 FROM hang_was WHERE slug=? AND hang_id!=?').get(x, id || 0)) x = `${base}-${k++}`; return x; };
  const COPY = `<script>document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');if(!b)return;var t=b.getAttribute('data-copy'),done=function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1600)};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(done,function(){prompt('The link',t)});else prompt('The link',t)})</script>`;
  const linkBlock = h => { const u = C.base + publicHref(h); return `<p class="cu-open"><span class="k">The public link</span><a href="${esc(publicHref(h))}">${esc(u)}</a><button type="button" class="bk-alt" data-copy="${esc(u)}">Copy</button></p>`; };
  // What a show holds that the public has not seen: 'out' would be published by an approval; 'kept' the maker has kept
  // back by name (works.keep_back) and no approval publishes.
  const notShown = (h, m) => { const rows = db.prepare("SELECT w.id, w.slug, w.title, w.place, w.keep_back FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? AND w.status='hidden' AND w.maker_id=? ORDER BY hw.pos, w.id LIMIT 500").all(h.id, m.id);
    return { all: rows, out: rows.filter(w => !Number(w.keep_back || 0)), kept: rows.filter(w => Number(w.keep_back || 0)) }; };
  const approveBtn = (h, m) => { const x = notShown(h, m); return x.out.length + x.kept.length ? `<a class="buy-btn" href="/account/shows/${h.id}/approve">Approve and open</a>` : `<form method="post" action="/account/shows/${h.id}/approve"><button class="buy-btn">Approve and open</button></form>`; };
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
<p class="lede">Open your archive to someone whose eye you trust: a gallery, a curator, a friend with taste. They see everything you hold, kept-back work included, build a show from it and send it to you. Nothing opens until you say so, and a photograph the public has not seen is named to you before it does.</p>${ok}
${shows.length ? `<h2>Shows for you</h2><ul class="cu-shows">${shows.map(h => `<li class="cu-show ${esc(h.review)}"><div class="cu-strip">${thumbs(h).map(t => `<img src="/img/${esc(t.slug)}/thumb" alt="" loading="lazy">`).join('')}</div><div class="cu-sh-t"><b>${esc(h.title)}</b><span>${h.n} photograph${h.n === 1 ? '' : 's'} &middot; by ${esc(h.curator || 'a curator')} &middot; ${h.review === 'proposed' ? 'waiting for you' : h.review === 'approved' ? 'open' : 'returned with a note'}</span>${h.line ? `<p>${esc(h.line)}</p>` : ''}</div>
<div class="cu-sh-go"><a href="/curate/show/${h.id}">See it</a>${h.review === 'proposed' ? `${approveBtn(h, m)}<form method="post" action="/account/shows/${h.id}/return" class="cu-ret"><input name="note" placeholder="A note back (optional)" maxlength="400"><button class="bk-alt">Return</button></form>` : ''}</div></li>`).join('')}</ul>` : ''}
<h2>Who holds keys</h2>
${list.length ? `<ul class="cu-keys">${list.map(c => `<li><div><b>${esc(c.name || c.email)}</b><span>${esc([c.label, c.email].filter(Boolean).join(' · '))}</span><small>${c.status === 'on' ? `In since ${esc(String(c.joined_at || c.at).slice(0, 10))}` : 'Letter sent, not yet opened'}</small></div><form method="post" action="/account/curators/${c.id}/end"><button class="bk-alt">Take back the keys</button></form></li>`).join('')}</ul>` : '<p class="note">No one yet.</p>'}
<form method="post" action="/account/curators" class="form cu-inv"><h2>Open your archive to someone</h2>
<label>Their name<input name="name" required maxlength="80" placeholder="Michael"></label>
<label>Their email<input name="email" type="email" required maxlength="160"></label>
<label>As (optional)<input name="label" maxlength="80" placeholder="Leica Gallery, curator"></label>
<button class="buy-btn">Send the keys</button>
<p class="note">They receive a letter with a link that opens your archive to them, signed in as themselves. You can take the keys back at any time; a show you approved stays open until you close it. When a work is collected through their show, they earn ${esc(SHARE)}, never yours.</p></form>
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
    { // The invitation, engraved (31 Oct): the maker's best photograph on its mount, what the key opens, one door.
      const L = require('./mail-letters'); const best = db.prepare("SELECT * FROM works WHERE maker_id=? AND status='held' AND COALESCE(keep_back,0)=0 ORDER BY curated DESC, stars DESC, id DESC LIMIT 1").get(m.id);
      const K = app.locals.keys; const given = K ? db.prepare("SELECT COUNT(*) n FROM keys WHERE kind='curator'").get().n : 1;
      const letter = L.curatorInvite({ base: C.base, name, maker: m.name, makerFirst: m.name.split(' ')[0], label, link, share: SHARE, no: given === 0 ? 1 : null, img: best ? `${C.base}/img/${best.slug}/screen?f=jpg` : null, href: best ? `${C.base}/w/${best.slug}` : C.base, title: best ? V.tidy(best.title) : '', year: best ? String(best.taken_at || '').slice(0, 4) : '' });
      if (mail.on()) mail.send({ to: email, subject: letter.subject, text: letter.text, html: letter.html }); else if (app.locals.mailLog) app.locals.mailLog.push({ to: email, subject: letter.subject, link }); }
    // (16 Nov, #65) The join link signs its opener in as the invited address, so it travels only by mail to that address.
    // With mail off it is never shown to the inviter (it was: any maker could invite an address and become it); the
    // tests read it from app.locals.mailLog, which exists only under NODE_ENV=test.
    res.redirect('/account/curators?ok=' + encodeURIComponent(mail.on() ? `The keys are on their way to ${email}.` : `Mail is off, so the letter to ${email} could not be sent.`));
  });
  app.post('/account/curators/:id/end', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    db.prepare("UPDATE curators SET status='ended' WHERE id=? AND maker_id=?").run(+req.params.id, m.id);
    res.redirect('/account/curators?ok=' + encodeURIComponent('The keys are back with you.'));
  });
  // Approve. (#225) A photograph the public has not seen is never opened by one press: when a show holds any, the
  // button leads to a page that names each one, and the maker opens the show with them or without them. The answer
  // carries the photographs that page named ('seen'); one hung since is named first. A work the maker has kept back
  // (works.keep_back) is named too and stays private either way. What is left out leaves the show.
  const showFor = (req, res) => { const m = makerOf(req); if (!m) { if (req.method === 'GET') res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl)); else res.redirect(303, '/signin?next=/account/curators'); return null; }
    const h = db.prepare("SELECT * FROM hangs WHERE id=? AND for_maker_id=?").get(+req.params.id, m.id); if (!h) { res.redirect(303, '/account/curators?ok=' + encodeURIComponent('That show is not here any more.')); return null; } return { m, h }; };
  app.get('/account/shows/:id/approve', (req, res) => {
    const s = showFor(req, res); if (!s) return; const { m, h } = s;
    if (h.review === 'approved') return res.redirect('/account/curators?ok=' + encodeURIComponent(`${h.title} is already open.`));
    const x = notShown(h, m); const n = db.prepare('SELECT COUNT(*) n FROM hang_works WHERE hang_id=?').get(h.id).n; const rest = n - x.out.length - x.kept.length;
    const by = (db.prepare('SELECT name FROM buyers WHERE id=?').get(h.buyer_id) || {}).name || 'a curator';
    const row = w => `<li><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span><b>${esc(tidy(w.title))}</b>${w.place ? `<i>${esc(w.place)}</i>` : ''}</span></li>`;
    V.setDeskPath('/account/curators'); res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: `Approve ${h.title} · Your studio · Watermark`, studio: true, path: '/account/curators', body: `<section class="cu cu-ok">
<p class="k">Curators &middot; approve a show</p><h1>${esc(h.title)}</h1>
<p class="lede">${n} photograph${n === 1 ? '' : 's'}, chosen by ${esc(by)}. ${req.query.changed ? 'The show changed since you last looked. ' : ''}${x.out.length ? `${x.out.length === 1 ? 'One of them is' : `${x.out.length} of them are`} not public yet. Opening the show with ${x.out.length === 1 ? 'it' : 'them'} publishes ${x.out.length === 1 ? 'it' : 'them'}: anyone can then see ${x.out.length === 1 ? 'it' : 'them'}, here and on your page.` : 'Everything else in it is already public.'}</p>
${x.out.length ? `<h2>Not public yet</h2><ul class="cu-named" data-cu-out>${x.out.map(row).join('')}</ul>` : ''}
${x.kept.length ? `<h2>Kept back by you</h2><p class="note">${x.kept.length === 1 ? 'This one stays' : 'These stay'} private whichever you press, and ${x.kept.length === 1 ? 'leaves' : 'leave'} the show. To let one go, publish it yourself in <a href="/account/hang">Hang your best</a> first.</p><ul class="cu-named" data-cu-kept>${x.kept.map(row).join('')}</ul>` : ''}
<form method="post" action="/account/shows/${h.id}/approve" class="cu-ok-go"><input type="hidden" name="seen" value="${x.out.concat(x.kept).map(w => w.id).join(',')}">
${x.out.length ? `<button class="buy-btn" name="with" value="all">Open the show and publish ${x.out.length === 1 ? 'this photograph' : `these ${x.out.length}`}</button>` : ''}
${rest > 0 ? `<button class="${x.out.length ? 'bk-alt' : 'buy-btn'}" name="with" value="none">${x.out.length ? `Open the show without ${x.out.length === 1 ? 'it' : 'them'}` : 'Open the show'} (${rest} photograph${rest === 1 ? '' : 's'})</button>` : `<p class="note">Without ${x.out.length + x.kept.length === 1 ? 'it' : 'them'} the show would be empty, so it cannot open that way.</p>`}
<a href="/curate/show/${h.id}">See the show again</a> <a href="/account/curators">Not now</a></form>
<p class="note">Either way the curator is told what you decided, by name. To ask for changes instead, return the show with a note from <a href="/account/curators">Curators</a>.</p>
</section>` }));
  });
  app.post('/account/shows/:id/approve', (req, res) => {
    const s = showFor(req, res); if (!s) return; const { m, h } = s; const x = notShown(h, m), body = req.body || {};
    const how = body.with === 'all' || body.with === 'none' ? body.with : null;
    const seen = new Set(String(body.seen || '').split(',').filter(Boolean).map(Number));
    if (x.out.length + x.kept.length) {
      if (!how) return res.redirect(303, `/account/shows/${h.id}/approve`);
      if (x.out.concat(x.kept).some(w => !seen.has(w.id))) return res.redirect(303, `/account/shows/${h.id}/approve?changed=1`); // hung since the page was read: name it first
    }
    const publish = how === 'all' ? x.out : [], left = how === 'all' ? x.kept : x.all;
    const n = db.prepare('SELECT COUNT(*) n FROM hang_works WHERE hang_id=?').get(h.id).n - left.length;
    if (n < 1) return res.redirect(303, `/account/shows/${h.id}/approve`);
    db.transaction(() => {
      for (const w of publish) { db.prepare("UPDATE works SET status='held' WHERE id=? AND status='hidden' AND COALESCE(keep_back,0)=0").run(w.id); ledger.append(db, 'work.published', w.slug, { by: 'show', show: h.slug }); }
      for (const w of left) db.prepare('DELETE FROM hang_works WHERE hang_id=? AND work_id=?').run(h.id, w.id);
      db.prepare("UPDATE hangs SET review='approved', review_note=NULL, public=1, updated_at=datetime('now') WHERE id=?").run(h.id);
    })();
    ledger.append(db, 'hang.opened', h.slug, { show: true, maker: m.handle });
    const names = left.map(w => tidy(w.title));
    tell({ buyer_id: h.buyer_id, kind: 'reviewed', href: `/curate/show/${h.id}`, title: `${m.name} approved your show`, body: `${h.title} is open.${publish.length ? ` ${publish.length} photograph${publish.length === 1 ? ' was' : 's were'} brought out for it.` : ''}${left.length ? ` Left out, still private: ${names.join('; ')}.` : ''}` });
    { // The letter (#225): the bell alone did not reach a curator who was not in the house. It carries the public link.
      const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(h.buyer_id);
      if (b && b.email) { const first = db.prepare("SELECT w.slug, w.title, w.taken_at FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? AND w.status='held' AND COALESCE(w.keep_back,0)=0 ORDER BY hw.pos, w.id LIMIT 1").get(h.id);
        const link = C.base + publicHref({ ...h, curator_code: codeFor(b) });
        const letter = require('./mail-letters').showApproved({ base: C.base, name: b.name, maker: m.name, makerFirst: m.name.split(' ')[0], title: h.title, link, n, left: names, share: SHARE, img: first ? `${C.base}/img/${first.slug}/screen?f=jpg` : null, href: link, imgTitle: first ? tidy(first.title) : '', year: first ? String(first.taken_at || '').slice(0, 4) : '' });
        if (mail.on()) mail.send({ to: b.email, subject: letter.subject, text: letter.text, html: letter.html }); else if (app.locals.mailLog) app.locals.mailLog.push({ to: b.email, subject: letter.subject, link, text: letter.text }); } }
    res.redirect(303, '/account/curators?ok=' + encodeURIComponent(`${h.title} is open.${publish.length ? ` ${publish.length} photograph${publish.length === 1 ? '' : 's'} published with it.` : ''}${left.length ? ` Left out, still private: ${names.join('; ')}.` : ''}`));
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
    // The key at once, not at the next backfill, and its letter: the number and the first three steps.
    if (b && app.locals.keys) { const had = db.prepare("SELECT 1 FROM keys WHERE kind='curator' AND buyer_id=?").get(b.id); const k = app.locals.keys.issue('curator', { buyer_id: b.id }, 'archive');
      if (k && !had && c.email) { const L = require('./mail-letters'); const letter = L.curatorKey({ base: C.base, name: c.name, makerFirst: m.name.split(' ')[0], no: k.no, desk: `${C.base}/curate/${slugOfMaker(m)}` }); if (mail.on()) mail.send({ to: c.email, subject: letter.subject, text: letter.text, html: letter.html }); } }
    res.redirect(`/curate/${slugOfMaker(m)}?welcome=1`);
  });
  // The curator's own room (31 Oct, Will: "we need curators more than anybody; they are the driver; their account
  // must be the most thought through"): the key, the archives open to them with a picture of each, every show by
  // where it stands with what it has placed and earned, their own walls, the money, the way on. One page, no dead ends.
  app.get('/curate', (req, res) => {
    const me = makerOf(req); let b = buyerOf(req);
    if (!b && me && me.email) b = db.prepare('SELECT * FROM buyers WHERE lower(email)=lower(?)').get(me.email) || null;
    if (!b && !me) return res.redirect('/signin?next=/curate');
    if (b) codeFor(b);
    const list = archivesFor(b);
    const key = b ? db.prepare("SELECT * FROM keys WHERE kind='curator' AND buyer_id=?").get(b.id) : null;
    const shows = b ? db.prepare("SELECT h.*, (SELECT COUNT(*) FROM hang_works hw WHERE hw.hang_id=h.id) AS n FROM hangs h WHERE h.buyer_id=? AND h.for_maker_id IS NOT NULL ORDER BY CASE h.review WHEN 'returned' THEN 0 WHEN 'draft' THEN 1 WHEN 'proposed' THEN 2 ELSE 3 END, h.updated_at DESC").all(b.id) : [];
    const walls = b ? db.prepare("SELECT h.*, (SELECT COUNT(*) FROM hang_works hw WHERE hw.hang_id=h.id) AS n FROM hangs h WHERE h.buyer_id=? AND h.for_maker_id IS NULL ORDER BY h.updated_at DESC LIMIT 12").all(b.id) : [];
    const thumbs = h => db.prepare("SELECT w.slug FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? ORDER BY hw.pos, w.id LIMIT 3").all(h.id).map(x => x.slug);
    const earned = b ? db.prepare("SELECT COALESCE(SUM(cents),0) c, COALESCE(SUM(CASE WHEN at >= date('now','start of month') THEN cents ELSE 0 END),0) m FROM pocket WHERE buyer_id=? AND kind='curation'").get(b.id) : { c: 0, m: 0 };
    const placed = shows.concat(walls).reduce((n, h) => n + (h.sales || 0), 0);
    const eye = b && app.locals.galleries ? app.locals.galleries.eye(b) : null;
    const coverOf = m => db.prepare("SELECT slug FROM works WHERE maker_id=? AND status='held' AND COALESCE(keep_back,0)=0 ORDER BY curated DESC, stars DESC, id DESC LIMIT 1").get(m.id);
    const countOf = m => db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='hidden' THEN 1 ELSE 0 END) k FROM works WHERE maker_id=? AND status IN ('held','hidden')").get(m.id);
    const state = h => h.review === 'approved' ? ['Open', 'open'] : h.review === 'proposed' ? ['With the maker', 'with'] : h.review === 'returned' ? ['Returned with a note', 'ret'] : ['Draft', 'draft'];
    const first = b && b.name ? String(b.name).split(' ')[0] : '';
    const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
    const hrefOf = h => app.locals.hangs ? app.locals.hangs.href({ ...h, curator_code: b ? b.code : null }) : `/hang/${h.slug}`;
    res.set('Cache-Control', 'private, no-store');
    res.send(shell('Your curating', `<section class="cu cur">
<header class="cur-h"><p class="k">${key ? `The curator&rsquo;s key, No.&nbsp;${key.no}` : 'Curating'}</p><h1>${first ? `${esc(first)}&rsquo;s curating.` : 'Your curating.'}</h1>
<p class="cur-line">${[list.length ? `${list.length} archive${list.length === 1 ? '' : 's'} open to you` : null, shows.length ? `${shows.length} show${shows.length === 1 ? '' : 's'}` : null, placed ? `${placed} placed` : null, earned.c ? `${money(earned.c)} earned` : null].filter(Boolean).join(' · ') || 'Where your shows begin.'}${eye && eye.badge ? ` · <i>${esc(eye.badge)}</i>` : ''}</p></header>
${shows.some(h => h.review === 'returned') ? `<p class="cur-need">${shows.filter(h => h.review === 'returned').map(h => `<a href="/curate/${esc(slugOfMaker(db.prepare('SELECT * FROM makers WHERE id=?').get(h.for_maker_id)))}?show=${h.id}">${esc(h.title)}</a> came back with a note${h.review_note ? `: &ldquo;${esc(h.review_note)}&rdquo;` : '.'}`).join('<br>')}</p>` : ''}
<h2 class="cur-k">The archives open to you</h2>
${list.length ? `<ul class="cur-arch">${list.map(m => { const c = coverOf(m), n = countOf(m); return `<li><a href="/curate/${esc(slugOfMaker(m))}">${c ? `<img src="/img/${esc(c.slug)}/screen" alt="" loading="lazy">` : '<span class="cur-blank"></span>'}<b>${esc(m.name)}</b><span>${n.n} works${n.k ? `, ${n.k} kept back` : ''}</span><em>Open the archive</em></a></li>`; }).join('')}</ul>` : `<p class="cur-empty">None yet. A maker opens their archive to you by letter; a gallery that represents makers has their archives too.${me ? ` <a href="/account/curators">Open yours to a curator</a>.` : ''}</p>`}
<h2 class="cur-k">Your shows</h2>
${shows.length ? `<ul class="cur-shows">${shows.map(h => { const mm = db.prepare('SELECT * FROM makers WHERE id=?').get(h.for_maker_id); const [st, cls] = state(h); const t = thumbs(h); return `<li class="cur-s cur-${cls}"><a class="cur-strip" href="/curate/${esc(slugOfMaker(mm))}?show=${h.id}">${t.length ? t.map(x => `<img src="/img/${esc(x)}/thumb" alt="" loading="lazy">`).join('') : '<span class="cur-blank"></span>'}</a><div class="cur-st"><b>${esc(h.title)}</b><span>${esc(mm ? mm.name : '')} · ${h.n} work${h.n === 1 ? '' : 's'}${h.sales ? ` · ${h.sales} placed, ${money(h.earned || 0)}` : ''}</span><i>${st}</i></div><p class="cur-go"><a href="/curate/${esc(slugOfMaker(mm))}?show=${h.id}">${h.review === 'approved' ? 'Change it' : 'Go on'}</a>${h.review === 'approved' ? ` <a href="${esc(hrefOf(h))}">See it</a>` : ` <a href="/curate/show/${h.id}">Preview</a>`}</p></li>`; }).join('')}</ul>` : `<p class="cur-empty">${list.length ? 'Open an archive and tap a photograph: the show begins with your first choice.' : 'Your shows will gather here.'}</p>`}
${walls.length ? `<h2 class="cur-k">Your walls</h2><ul class="cur-shows">${walls.map(h => { const t = thumbs(h); return `<li class="cur-s"><a class="cur-strip" href="${esc(hrefOf(h))}">${t.map(x => `<img src="/img/${esc(x)}/thumb" alt="" loading="lazy">`).join('') || '<span class="cur-blank"></span>'}</a><div class="cur-st"><b>${esc(h.title)}</b><span>${h.n} work${h.n === 1 ? '' : 's'}${h.sales ? ` · ${h.sales} placed` : ''}</span><i>${h.public ? 'Shown' : 'Private'}</i></div><p class="cur-go"><a href="${esc(hrefOf(h))}">See it</a></p></li>`; }).join('')}</ul>` : ''}
<h2 class="cur-k">The share</h2>
<p class="cur-money">${earned.c ? `<b>${money(earned.c)}</b> earned in all${earned.m ? `, ${money(earned.m)} this month` : ''}. ${esc(paid('a show of yours or your gallery’s link'))} <a href="/yours?tab=more#pocket">Your pocket</a>` : esc(paid('a show of yours or your gallery’s link'))}</p>
<p class="cur-links"><a href="/keys">The Keys</a> · <a href="/yours">Your gallery</a> · <a href="/legal/curators">The Curator and Gallery Agreement</a></p>
</section>`));
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
    const total = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='hidden' THEN 1 ELSE 0 END) k FROM works WHERE maker_id=? AND status IN ('held','hidden')").get(m.id);
    const shows = showsOf(b, m); const cur = shows.find(s => String(s.id) === String(req.query.show)) || shows[0] || null;
    const inShow = new Set(cur ? showWorks(cur).map(w => w.id) : []);
    const seq = cur ? showWorks(cur) : [];
    const starsOf = n => '★'.repeat(n || 0);
    res.set('Cache-Control', 'private, no-store');
    res.send(shell(`Curating ${m.name}`, `<section class="cu cu-desk" data-cu data-show="${cur ? cur.id : ''}" data-maker="${esc(slugOfMaker(m))}" data-first="${esc(m.name.split(' ')[0])}">
<header class="cu-h"><div><p class="k">Curating</p><h1>${esc(m.name)}&rsquo;s archive.</h1><p class="cu-n">${total.n} works held${total.k ? `, ${total.k} kept back (marked)` : ''}. </p></div>
<form method="get" class="cu-f"><input type="hidden" name="show" value="${cur ? cur.id : ''}"><input name="q" value="${esc(q)}" placeholder="A place, a word"><select name="stars" onchange="this.form.submit()"><option value="0">Every grade</option>${[3, 4, 5].map(s => `<option value="${s}"${stars === s ? ' selected' : ''}>${s}★ and above</option>`).join('')}</select><button class="bk-alt">Find</button></form></header>
${!shows.length ? `<ol class="cu-steps"><li><b>Walk the archive.</b><span>Tap a photograph to hang it. The show begins with your first choice.</span></li><li><b>Sequence it.</b><span>Drag the order, a line beside each, a title and a statement.</span></li><li><b>Send it to ${esc(m.name.split(' ')[0])}.</b><span>Nothing opens until ${esc(m.name.split(' ')[0])} approves it. Then it opens to the public under your name, a letter brings you its link, and a work collected through it earns you ${esc(SHARE)}.</span></li></ol>` : ''}
<div class="cu-cols">
<div class="cu-grid">${works.map(w => `<button type="button" class="cu-w${inShow.has(w.id) ? ' on' : ''}${w.status === 'hidden' ? ' kept' : ''}" data-cu-w="${esc(w.slug)}" aria-pressed="${inShow.has(w.id)}"><span class="cu-im"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy" draggable="false"></span><span><b>${esc(tidy(w.title))}</b><i>${esc(w.place || '')}${w.stars ? ` ${starsOf(w.stars)}` : ''}${w.status === 'hidden' ? ' · kept back' : ''}</i></span><em>${I.check}</em></button>`).join('') || '<p class="note">Nothing by that word or grade.</p>'}</div>
<aside class="cu-show" data-cu-tray><button type="button" class="cu-tray" data-cu-tray-t aria-expanded="false"><b data-cu-tn>${seq.length}</b><span>${cur ? esc(cur.title) : 'Your show'}</span><i>Open</i></button>${cur ? `<form method="post" action="/curate/show/${cur.id}/title" class="cu-st"><input name="title" value="${esc(cur.title)}" maxlength="120" aria-label="The show's title"><textarea name="line" rows="3" maxlength="600" placeholder="The curator's statement">${esc(cur.line || '')}</textarea><button class="bk-alt">Keep</button></form>
<p class="cu-state">${cur.review === 'proposed' ? `With ${esc(m.name.split(' ')[0])} for approval.` : cur.review === 'approved' ? 'Open to the public. The address follows the title; an earlier address still opens it.' : cur.review === 'returned' ? `Returned${cur.review_note ? `: &ldquo;${esc(cur.review_note)}&rdquo;` : '.'}` : `A draft. Only you can see it; ${esc(m.name.split(' ')[0])} sees it when you send it, and it has no public link until it is approved.`}</p>${cur.review === 'approved' ? linkBlock(cur) : ''}
<ol class="cu-seq" data-cu-seq>${seq.map(w => `<li data-slug="${esc(w.slug)}"><span class="cu-grip">${I.grip}</span><img src="/img/${esc(w.slug)}/thumb" alt=""><div><b>${esc(tidy(w.title))}</b><input data-cu-note value="${esc(w.note || '')}" placeholder="A line for the wall" maxlength="240"></div><button type="button" class="cu-x" data-cu-out aria-label="Take it out">${I.close}</button></li>`).join('')}</ol>
<p class="cu-hint">${seq.length ? `${seq.length} in the show. Drag to sequence; the order is the walk.` : 'Tap works on the left to hang them here.'}</p>
${seq.length && cur.review !== 'proposed' && cur.review !== 'approved' ? `<form method="post" action="/curate/show/${cur.id}/propose"><button class="buy-btn">Send to ${esc(m.name.split(' ')[0])}</button><small class="cu-agree">Sending accepts <a href="/legal/curators" target="_blank">the Curator and Gallery Agreement</a>.</small></form>` : ''}
<p class="cu-links"><a href="/curate/show/${cur.id}">Preview</a>${shows.length > 1 ? ` &middot; ${shows.filter(s => s.id !== cur.id).map(s => `<a href="?show=${s.id}">${esc(s.title)}</a>`).join(' &middot; ')}` : ''}</p>` : '<p class="cu-empty">Your show begins with the first photograph you tap. Name it whenever you like.</p><ol class="cu-seq" data-cu-seq></ol>'}
<form method="post" action="/curate/${esc(slugOfMaker(m))}/show" class="cu-new"><input name="title" placeholder="${cur ? 'Another show' : 'The show’s title'}" maxlength="120" required><button class="bk-alt">Begin</button></form></aside>
</div><template data-cu-ic="grip">${I.grip}</template><template data-cu-ic="close">${I.close}</template></section>${COPY}<script src="/static/curate.js?v=${V.VER}" defer></script>`));
  });
  app.post('/curate/:maker/show', (req, res) => {
    const m = makerBySlug(String(req.params.maker)); if (!m || !canCurate(req, m)) return res.sendStatus(403);
    const b = curatorBuyer(req, res); if (!b) return res.sendStatus(401);
    const title = String((req.body || {}).title || '').trim().slice(0, 120) || `A show of ${m.name}`;
    const s = slugFor(title, 0);
    const id = db.prepare("INSERT INTO hangs (buyer_id, slug, title, public, for_maker_id, review) VALUES (?,?,?,0,?,'draft')").run(b.id, s, title, m.id).lastInsertRowid;
    if ((req.headers.accept || '').includes('application/json')) return res.json({ ok: true, id, title });
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
    const seqNow = showWorks(s.h).map(x => ({ slug: x.slug, title: tidy(x.title), note: x.note || '' }));
    res.json({ ok: true, in: !had, n: seqNow.length, w: { slug: w.slug, title: tidy(w.title) }, seq: seqNow });
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
    const title = String(x.title || s.h.title).trim().slice(0, 120) || s.h.title;
    // (#225) The address follows the title (it kept the working one: /hang/a-show-of-mira under a show renamed twice);
    // the address it leaves is kept in hang_was and sends on, so a link already handed out still arrives.
    const slug = title === s.h.title ? s.h.slug : slugFor(title, s.h.id);
    db.transaction(() => {
      if (slug !== s.h.slug) { db.prepare('DELETE FROM hang_was WHERE slug=?').run(slug); db.prepare("INSERT INTO hang_was (slug, hang_id) VALUES (?,?) ON CONFLICT(slug) DO UPDATE SET hang_id=excluded.hang_id").run(s.h.slug, s.h.id); }
      db.prepare("UPDATE hangs SET title=?, slug=?, line=?, updated_at=datetime('now') WHERE id=?").run(title, slug, String(x.line || '').trim().slice(0, 600) || null, s.h.id);
    })();
    res.redirect(`/curate/${slugOfMaker(s.m)}?show=${s.h.id}`);
  });
  app.post('/curate/show/:id/propose', (req, res) => {
    const s = myShow(req, req.params.id); if (!s || !s.mine) return res.sendStatus(403);
    const n = db.prepare('SELECT COUNT(*) n FROM hang_works WHERE hang_id=?').get(s.h.id).n; if (!n) return res.redirect(`/curate/${slugOfMaker(s.m)}?show=${s.h.id}`);
    db.prepare("UPDATE hangs SET review='proposed', updated_at=datetime('now') WHERE id=?").run(s.h.id);
    const b = buyerOf(req); const who = (b && b.name) || 'Your curator';
    if (b && app.locals.legal) { try { app.locals.legal.accept('curator', b.id, 'curators', req.ip, `hang-${s.h.id}`); } catch (e) { console.error('[legal]', e.message); } } // sending a show accepts the Curator Agreement
    const first = db.prepare('SELECT w.slug FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? ORDER BY hw.pos LIMIT 1').get(s.h.id);
    tell({ maker_id: s.m.id, kind: 'show', slug: first && first.slug, href: '/account/curators', title: `${who} proposes a show`, body: `${s.h.title}: ${n} photograph${n === 1 ? '' : 's'}. Approve it, or return it with a note.` });
    if (mail.on() && s.m.email) mail.send({ to: s.m.email, subject: `A show for you to approve: ${s.h.title}`, text: `${who} has sequenced ${n} works of yours as "${s.h.title}".\n\nSee it, approve it or return it with a note:\n${C.base}/account/curators\n\nWatermark` });
    res.redirect(`/curate/${slugOfMaker(s.m)}?show=${s.h.id}`);
  });
  // The preview: the show as it will hang, kept-back work included, for the curator and the maker.
  app.get('/curate/show/:id', (req, res) => {
    const s = myShow(req, req.params.id); if (!s) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    const seq = showWorks(s.h); const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(s.h.buyer_id) || {};
    res.set('Cache-Control', 'private, no-store');
    res.send(shell(s.h.title, `<section class="cu-pv"><p class="k">${s.h.review === 'approved' ? 'Open' : 'Preview'} &middot; ${esc(s.m.name)}</p><h1>${esc(s.h.title)}</h1><p class="cu-by">Curated by ${esc(b.name || 'a curator')}</p>${s.h.review === 'approved' ? linkBlock({ ...s.h, curator_code: b.code }) : `<p class="cu-priv">A private preview: only ${s.mine ? `you and ${esc(s.m.name.split(' ')[0])}` : `you and ${esc((b.name || 'the curator').split(' ')[0])}`} can open this page, so its address is not one to pass on. The show has no public link until ${s.mine ? `${esc(s.m.name.split(' ')[0])} approves it; a letter brings it to you then` : 'you approve it'}.</p>`}${s.h.line ? `<p class="lede">${esc(s.h.line)}</p>` : ''}
<ol class="cu-wall">${seq.map((w, i) => `<li><figure><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="${i < 2 ? 'eager' : 'lazy'}" draggable="false"></figure><p><b>${esc(tidy(w.title))}</b>${w.place ? `, ${esc(w.place)}` : ''}${w.status === 'hidden' ? (Number(w.keep_back || 0) ? ` <i>(kept back by ${esc(s.m.name.split(' ')[0])}; it stays private)</i>` : ` <i>(not public yet; ${s.mine ? `${esc(s.m.name.split(' ')[0])} is asked by name before it is` : 'you are asked by name before it is'})</i>`) : ''}</p>${w.note ? `<p class="cu-line">${esc(w.note)}</p>` : ''}</li>`).join('')}</ol>
<p class="cu-pv-go">${s.mine ? `<a class="bk-alt" href="/curate/${esc(slugOfMaker(s.m))}?show=${s.h.id}">Back to the desk</a>` : ''}${!s.mine && s.h.review === 'proposed' ? `${approveBtn(s.h, s.m)} <a class="bk-alt" href="/account/curators">Return with a note</a>` : ''}${s.h.review === 'approved' ? ` <a class="bk-alt" href="${esc(publicHref({ ...s.h, curator_code: b.code }))}">The open show</a>` : ''}</p></section>${COPY}`));
  });
}

module.exports = { mountCurate };
