// Galleries and the eye (Will, 17 Oct): curation is a badge of honour first and a living second, and the first
// curators are real galleries. A gallery is a maker of kind 'gallery': it represents photographers (a share of the
// maker's side, agreed between them; the house's 15% is untouched), mounts shows (hangs with an opening and a
// close, at a venue) and sells its artists' work here with provenance. Every curator's standing is told in one
// line, the eye: walls hung, works placed, lines well seen. No points, no leaderboard; a line on the wall.
const { layout, esc, money, date, setDeskPath } = require('./views');

const DEFAULT_PCT = 50;          // the gallery's share of the maker's side, a draft; set per agreement
const EYE = (b, s) => s.gallery ? `A gallerist · ${s.gallery}` : s.placed >= 10 && s.walls >= 3 ? 'A dealer' : s.placed >= 1 && s.walls >= 1 ? 'An eye' : s.walls >= 1 ? 'A curator' : null;

function mountGalleries(app, { db, C, V, mail, ledger, makerOf, buyerOf, isStudio }) {
  db.exec(`CREATE TABLE IF NOT EXISTS representation (id INTEGER PRIMARY KEY, gallery_id INTEGER NOT NULL, maker_id INTEGER NOT NULL, pct INTEGER NOT NULL DEFAULT ${DEFAULT_PCT}, status TEXT NOT NULL DEFAULT 'offered',
      note TEXT, since TEXT, until TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS gallery_cuts (id INTEGER PRIMARY KEY, license_ref TEXT NOT NULL, gallery_id INTEGER NOT NULL, maker_id INTEGER NOT NULL, cents INTEGER NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const c of ['opens_at', 'closes_at', 'venue']) if (!db.prepare(`SELECT 1 FROM pragma_table_info('hangs') WHERE name='${c}'`).get()) db.exec(`ALTER TABLE hangs ADD COLUMN ${c} TEXT`);

  const isGallery = m => !!m && m.kind === 'gallery';
  const galleryOf = makerId => db.prepare("SELECT r.*, g.name AS gallery, g.handle AS gallery_handle FROM representation r JOIN makers g ON g.id=r.gallery_id WHERE r.maker_id=? AND r.status='on' ORDER BY r.id DESC LIMIT 1").get(makerId);
  const artists = g => db.prepare(`SELECT r.*, m.name, m.handle, m.portrait, (SELECT COUNT(*) FROM works w WHERE w.maker_id=m.id AND w.status='held') AS works,
    (SELECT COALESCE(SUM(cents),0) FROM gallery_cuts c WHERE c.gallery_id=r.gallery_id AND c.maker_id=m.id) AS earned FROM representation r JOIN makers m ON m.id=r.maker_id WHERE r.gallery_id=? AND r.status IN ('offered','on') ORDER BY r.status DESC, m.name`).all(g.id);
  // The gallery's own gallery (its buyer), where its shows hang.
  function galleryBuyer(g) {
    let b = g.buyer_id ? db.prepare('SELECT * FROM buyers WHERE id=?').get(g.buyer_id) : (g.email ? db.prepare('SELECT * FROM buyers WHERE email=?').get(g.email) : null);
    if (!b) { const { nanoid } = require('nanoid'); const id = db.prepare("INSERT INTO buyers (customer, email, name, code, public) VALUES ('', ?, ?, ?, 1)").run(g.email || '', g.name, nanoid(10)).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); }
    if (g.buyer_id !== b.id) db.prepare('UPDATE makers SET buyer_id=? WHERE id=?').run(b.id, g.id);
    return b;
  }
  const galleryByBuyer = b => (b ? db.prepare("SELECT * FROM makers WHERE kind='gallery' AND (buyer_id=? OR (email IS NOT NULL AND email=?)) LIMIT 1").get(b.id, b.email || '') : null);

  // The cut, on every paid license of a represented maker's work. The house's share is untouched.
  function cut(l, w, makerSharePct) {
    const r = galleryOf(w.maker_id); if (!r || !(l.price_cents > 0)) return null;
    if (db.prepare('SELECT 1 FROM gallery_cuts WHERE license_ref=?').get(l.ref)) return null;
    const cents = Math.round(l.price_cents * (makerSharePct / 100) * (r.pct / 100)); if (cents < 1) return null;
    db.prepare('INSERT INTO gallery_cuts (license_ref, gallery_id, maker_id, cents) VALUES (?,?,?,?)').run(l.ref, r.gallery_id, w.maker_id, cents);
    ledger.append(db, 'representation.earned', l.ref, { gallery: r.gallery_handle, work: w.slug, amount: cents });
    return { gallery: r, cents };
  }
  const cutsIn = g => db.prepare('SELECT COALESCE(SUM(cents),0) s, COUNT(*) n FROM gallery_cuts WHERE gallery_id=?').get(g.id);
  const cutsOut = m => db.prepare('SELECT COALESCE(SUM(cents),0) s, COUNT(*) n FROM gallery_cuts WHERE maker_id=?').get(m.id);

  // The eye: one line of standing for any curator.
  function eye(b) {
    if (!b) return null;
    const walls = db.prepare('SELECT COUNT(*) n FROM hangs WHERE buyer_id=? AND public=1').get(b.id).n;
    const placed = db.prepare(`SELECT COUNT(*) n FROM licenses l WHERE l.status IN ('active','expired') AND l.price_cents>0 AND l.buyer_id!=? AND (l.via=? OR l.via IN (SELECT 'hang:'||id FROM hangs WHERE buyer_id=?))`).get(b.id, `gallery:${b.code}`, b.id).n;
    const seen = db.prepare('SELECT COUNT(*) n FROM notes WHERE buyer_id=? AND seen_at IS NOT NULL').get(b.id).n;
    const g = galleryByBuyer(b);
    const s = { walls, placed, seen, gallery: g ? g.name : null, gallerySlug: g ? V.makerSlug(g) : null };
    s.badge = EYE(b, s);
    s.line = [s.badge, walls ? `${walls} wall${walls === 1 ? '' : 's'} hung` : null, placed ? `${placed} placed` : null, seen ? `${seen} well seen` : null].filter(Boolean).join(' · ');
    return s;
  }
  // A show: a gallery's hang with an opening and a close.
  const showOf = h => { if (!h) return null; const g = galleryByBuyer({ id: h.buyer_id, email: '' }); const dated = h.opens_at || h.closes_at; if (!g && !dated) return null; const now = new Date().toISOString().slice(0, 10);
    return { gallery: g ? g.name : null, gallerySlug: g ? V.makerSlug(g) : null, venue: h.venue || (g ? g.house : null), opens: h.opens_at, closes: h.closes_at, state: h.closes_at && h.closes_at < now ? 'closed' : h.opens_at && h.opens_at > now ? 'coming' : 'open' }; };
  const shows = g => { const b = galleryBuyer(g); return db.prepare(`SELECT h.*, (SELECT COUNT(*) FROM hang_works hw WHERE hw.hang_id=h.id) n FROM hangs h WHERE h.buyer_id=? ORDER BY COALESCE(h.opens_at, h.created_at) DESC`).all(b.id); };

  const galleryOnly = (req, res, next) => { const m = makerOf(req); if (!isGallery(m)) return res.redirect('/signin?next=/account/gallery'); req.gallery = m; next(); };
  // The gallery's desk.
  app.get('/account/gallery', galleryOnly, (req, res) => res.send(galleryDesk({ g: req.gallery, artists: artists(req.gallery), shows: shows(req.gallery), cuts: cutsIn(req.gallery), b: galleryBuyer(req.gallery), ok: req.query.ok || null, intro: app.locals.introductions ? app.locals.introductions.linkFor({ by_kind: 'maker', by_id: req.gallery.id, opens: 'maker' }) : null, base: C.base })));
  app.post('/account/gallery/offer', galleryOnly, (req, res) => {
    const x = req.body || {}; const m = db.prepare("SELECT * FROM makers WHERE handle=? AND kind IN ('maker','estate')").get(String(x.handle || '').trim().toLowerCase());
    if (!m) return res.redirect(`/account/gallery?ok=${encodeURIComponent('No maker answers to that handle.')}`);
    if (db.prepare("SELECT 1 FROM representation WHERE gallery_id=? AND maker_id=? AND status IN ('offered','on')").get(req.gallery.id, m.id)) return res.redirect(`/account/gallery?ok=${encodeURIComponent('Already offered, or already yours.')}`);
    const pct = Math.min(70, Math.max(10, Math.round(Number(x.pct) || DEFAULT_PCT)));
    db.prepare("INSERT INTO representation (gallery_id, maker_id, pct, status, note) VALUES (?,?,?,'offered',?)").run(req.gallery.id, m.id, pct, String(x.note || '').trim().slice(0, 600) || null);
    if (m.email) mail.send({ to: m.email, subject: `${req.gallery.name} would like to represent you`, text: `${m.name.split(' ')[0]},\n\n${req.gallery.name} has offered to represent your work on Watermark: they would mount shows of it, place it, and take ${pct}% of your side of each sale they or anyone else makes here while the arrangement stands; the house's share does not change. Read the offer and answer it at ${C.base}/account/representation.\n\nWatermark` });
    res.redirect(`/account/gallery?ok=${encodeURIComponent(`Offered to ${m.name}. They answer from their studio.`)}`);
  });
  app.post('/account/gallery/end/:id', galleryOnly, (req, res) => { db.prepare("UPDATE representation SET status='ended', until=datetime('now') WHERE id=? AND gallery_id=?").run(+req.params.id, req.gallery.id); res.redirect('/account/gallery?ok=' + encodeURIComponent('Ended.')); });
  // The maker answers.
  app.get('/account/representation', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/representation');
    res.send(representationPage({ m, offers: db.prepare("SELECT r.*, g.name AS gallery, g.handle AS gallery_handle, g.house, g.place FROM representation r JOIN makers g ON g.id=r.gallery_id WHERE r.maker_id=? AND r.status IN ('offered','on','ended') ORDER BY r.status='on' DESC, r.id DESC").all(m.id), out: cutsOut(m), ok: req.query.ok || null }));
  });
  app.post('/account/representation/:id', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); const r = db.prepare('SELECT * FROM representation WHERE id=? AND maker_id=?').get(+req.params.id, m.id); if (!r) return res.sendStatus(404);
    const g = db.prepare('SELECT * FROM makers WHERE id=?').get(r.gallery_id); const a = String((req.body || {}).answer || '');
    if (a === 'accept' && r.status === 'offered') { db.prepare("UPDATE representation SET status='ended', until=datetime('now') WHERE maker_id=? AND status='on'").run(m.id); db.prepare("UPDATE representation SET status='on', since=datetime('now') WHERE id=?").run(r.id); ledger.append(db, 'representation.began', m.handle, { gallery: g.handle, pct: r.pct }); if (g.email) mail.send({ to: g.email, subject: `${m.name} accepted your representation`, text: `${m.name} is now represented by ${g.name} on Watermark. Their work is yours to show: ${C.base}/account/gallery\n\nWatermark` }); return res.redirect(`/account/representation?ok=${encodeURIComponent(`${g.name} represents you now.`)}`); }
    if (a === 'decline' && r.status === 'offered') { db.prepare("UPDATE representation SET status='declined' WHERE id=?").run(r.id); return res.redirect(`/account/representation?ok=${encodeURIComponent('Declined, kindly.')}`); }
    if (a === 'end' && r.status === 'on') { db.prepare("UPDATE representation SET status='ended', until=datetime('now') WHERE id=?").run(r.id); ledger.append(db, 'representation.ended', m.handle, { gallery: g.handle }); return res.redirect(`/account/representation?ok=${encodeURIComponent('Ended.')}`); }
    res.redirect('/account/representation');
  });
  // A show's dates and venue, set on the hang.
  app.post('/hang/:id/show', (req, res) => {
    const b = buyerOf(req); const h = db.prepare('SELECT * FROM hangs WHERE id=?').get(+req.params.id); if (!h || !b || (h.buyer_id !== b.id && !isStudio(req))) return res.sendStatus(404);
    const x = req.body || {}; const d = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null);
    db.prepare("UPDATE hangs SET opens_at=?, closes_at=?, venue=?, updated_at=datetime('now') WHERE id=?").run(d(x.opens_at), d(x.closes_at), String(x.venue || '').trim().slice(0, 120) || null, h.id);
    if (d(x.opens_at) && !h.opens_at && h.public) ledger.append(db, 'show.opening', `hang-${h.id}`, { title: h.title, slug: h.slug, opens: d(x.opens_at), venue: x.venue || null });
    res.redirect(app.locals.hangs.href ? app.locals.hangs.href(app.locals.hangs.byId(h.id)) : `/hang/${h.slug}`);
  });
  // Shows now and coming, for the front door and the Galleries page.
  const onNow = () => db.prepare(`SELECT h.*, b.name AS curator, b.code AS curator_code, g.name AS gallery, g.handle AS gallery_handle, (SELECT COUNT(*) FROM hang_works hw WHERE hw.hang_id=h.id) n FROM hangs h JOIN buyers b ON b.id=h.buyer_id LEFT JOIN makers g ON g.buyer_id=b.id AND g.kind='gallery'
    WHERE h.public=1 AND h.opens_at IS NOT NULL AND (h.closes_at IS NULL OR h.closes_at >= date('now')) ORDER BY h.opens_at > date('now'), h.opens_at DESC LIMIT 12`).all();

  app.locals.galleries = { isGallery, galleryOf, artists, cut, cutsIn, cutsOut, eye, showOf, shows, onNow, galleryBuyer, galleryByBuyer, DEFAULT_PCT };
  return app.locals.galleries;
}

// ---- The pages ----
function galleryDesk({ g, artists, shows, cuts, b, ok, intro, base }) {
  setDeskPath('/account/gallery');
  const on = artists.filter(a => a.status === 'on'), offered = artists.filter(a => a.status === 'offered');
  return layout({ title: 'The gallery · Watermark', studio: true, body: `<section class="studio-wrap hd gy">
<p class="k">The gallery</p><h1>${esc(g.name)}.</h1>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
<p class="lede">Your artists, your shows, and what the gallery has earned placing their work. A show is a wall you hang with an opening and a close; it carries your name on the front door while it runs.</p>
<dl class="rq-nums"><div><dt>Artists</dt><dd>${on.length}</dd></div><div><dt>Shows</dt><dd>${shows.filter(s => s.public).length}</dd></div><div><dt>Earned placing</dt><dd>${money(cuts.s)}<small>${cuts.n} sale${cuts.n === 1 ? '' : 's'}</small></dd></div></dl>
<div class="gy-two">
<div><h2>Artists</h2>
${on.length ? `<div class="rq-list">${on.map(a => `<div class="rq"><img src="${a.portrait ? `/portrait/${esc(a.handle)}` : '/static/watermark-mark.svg'}" alt=""><span class="rq-t"><b><a href="/m/${esc(a.handle)}">${esc(a.name)}</a></b><small>${a.works} held · ${a.pct}% of their side to the gallery${a.since ? ` · since ${date(a.since)}` : ''}</small></span><span class="rq-m">${money(a.earned)}</span><span class="rq-s"><form method="post" action="/account/gallery/end/${a.id}"><button class="link">End</button></form></span><span class="rq-d"></span></div>`).join('')}</div>` : '<p class="note">No artist is represented yet.</p>'}
${offered.length ? `<h3>Offered, awaiting their answer</h3><ul class="gy-off">${offered.map(a => `<li>${esc(a.name)} · ${a.pct}% <form method="post" action="/account/gallery/end/${a.id}" class="inline"><button class="link">Withdraw</button></form></li>`).join('')}</ul>` : ''}
<h3>Represent a maker in the house</h3>
<form method="post" action="/account/gallery/offer" class="form gy-offer"><label>Their handle<input name="handle" placeholder="as in watermark…/m/handle" required></label><label>Gallery's share of their side<input name="pct" type="number" min="10" max="70" value="${DEFAULT_PCT}">%</label><label>A note with the offer <small>optional</small><input name="note" maxlength="600"></label><button class="jewel">Offer representation</button></form>
<p class="note">The split is between you and the artist, on the artist's side of each sale; the house's share does not change. A draft until counsel has read it.</p>
${intro ? `<h3>Bring a photographer in</h3><p>Your introduction opens a studio for them at once, represented by you from the first day:</p><p class="gy-link"><code>${esc(base)}${esc(intro)}</code></p>` : ''}
</div>
<div><h2>Shows</h2>
${shows.length ? `<div class="rq-list">${shows.map(s => `<a class="rq" href="/g/${esc(b.code)}/hang/${esc(s.slug)}"><span class="rq-t" style="grid-column:1/3"><b>${esc(s.title)}</b><small>${s.n} photograph${s.n === 1 ? '' : 's'}${s.opens_at ? ` · opens ${date(s.opens_at)}` : ''}${s.closes_at ? ` · closes ${date(s.closes_at)}` : ''}${s.venue ? ` · ${esc(s.venue)}` : ''}</small></span><span class="rq-m">${s.sales ? `${s.sales} placed` : ''}</span><span class="rq-s ${s.public ? 's-active' : ''}">${s.public ? 'Showing' : 'Private'}</span><span class="rq-d"></span></a>`).join('')}</div>` : '<p class="note">No show is hung yet.</p>'}
<p><a class="buy-btn" href="/yours?tab=hangs">Hang a show</a></p>
<p class="note">A show is a hang: make it in your gallery, set its opening and close on the wall, and show it. While it runs it leads the front door and the Galleries page.</p>
</div></div></section>` });
}
function representationPage({ m, offers, out, ok }) {
  setDeskPath('/account/representation');
  return layout({ title: 'Representation · Watermark', studio: true, body: `<section class="narrow hd gy">
<p class="k">Your studio</p><h1>Representation.</h1>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
<p class="lede">A gallery that represents you mounts shows of your work here and places it; in return it takes an agreed share of your side of each sale while the arrangement stands. The house's share does not change. One gallery at a time.</p>
${offers.length ? `<ul class="gy-reps">${offers.map(r => `<li class="gy-rep s-${esc(r.status)}"><p class="k">${r.status === 'offered' ? 'An offer' : r.status === 'on' ? 'Represents you' : 'Ended'}</p><h2><a href="/m/${esc(r.gallery_handle)}">${esc(r.gallery)}</a></h2><p>${r.house ? esc(r.house) + ' · ' : ''}${r.place ? esc(r.place) + ' · ' : ''}${r.pct}% of your side${r.since ? ` · since ${date(r.since)}` : ''}${r.until ? ` · until ${date(r.until)}` : ''}</p>${r.note ? `<p class="gy-note">${esc(r.note)}</p>` : ''}
${r.status === 'offered' ? `<form method="post" action="/account/representation/${r.id}" class="inline"><button class="jewel" name="answer" value="accept">Accept</button> <button class="link" name="answer" value="decline">Decline</button></form>` : r.status === 'on' ? `<form method="post" action="/account/representation/${r.id}" class="inline"><button class="link" name="answer" value="end">End the arrangement</button></form>` : ''}</li>`).join('')}</ul>` : '<p class="note">No gallery has offered yet. Galleries in the house find you through your page.</p>'}
${out.n ? `<p class="note">${money(out.s)} has gone to your gallery across ${out.n} sale${out.n === 1 ? '' : 's'}; your statement at <a href="/account/payouts">Getting paid</a> shows it.</p>` : ''}
</section>` });
}

module.exports = { mountGalleries, EYE, DEFAULT_PCT };
