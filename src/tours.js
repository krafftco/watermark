// Tours (Will, 21 Oct: "there needs to be a tour guide"; a guide like the Met's own on Instagram, "Hi, I'm …, I'm a
// tour guide here at the Met"; "tour guides should be able to curate things they want in collections, then create
// recordings and walk people through; they can add notes"; "users could be tour guides that communicated about work;
// people must feel they can make a career on this platform and use their gifting; it elevates people and allows people
// to be seen, or at least heard; the work needs to be heard"). A tour is a wall (a hang) the guide walks you through
// in their own voice: on the wall's page the curator records a word on each work (`tour_voices`: hang, work (0 = the
// welcome), the file in the vault `tours/`, mime, seconds; the browser's MediaRecorder, three minutes a stop, nothing
// transcribed, no model in it) beside the line they write; a wall with any recording is a tour. /tour/<slug>: the
// photograph alone on the dark wall, the guide's name, the recording playing as you arrive (after the first tap), the
// line beneath, next and back; the guide is paid as any curator (the wall sets `wm_via`, so a Collect within thirty
// days earns the curation share) and takes cards. /guides lists the guides of the house, each by name with their tours
// and their line, newest voice first; a guide's gallery shows 'Tours'. Nothing on the register but `tour.opened`
// (public: 'X recorded a tour of Y') the first time a wall gains a voice.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const MAX_MB = 12, MAX_SECONDS = 180;
function mountTours(app, { db, C, V, store, buyerOf, ledger, isStudio = () => false, notify = null }) {
  const { layout, esc } = V; const I = require('./icons');
  db.exec(`CREATE TABLE IF NOT EXISTS tour_voices (id INTEGER PRIMARY KEY, hang_id INTEGER NOT NULL, work_id INTEGER NOT NULL DEFAULT 0, file TEXT NOT NULL, mime TEXT NOT NULL, seconds REAL, bytes INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (hang_id, work_id))`);
  const multer = require('multer'); const dir = path.join(C.dataDir, 'incoming'); fs.mkdirSync(dir, { recursive: true });
  const upload = multer({ dest: dir, limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 }, fileFilter: (req, f, cb) => cb(null, /^(audio|video)\//.test(f.mimetype)) });
  // The gallery as a tour (26 Oct, the collector's house): a collector's whole gallery is walked as a wall is, in
  // their own voice. The gallery stands in for a hang: id = -buyer id, slug 'g-<code>', the pieces in the gallery's
  // own order (the owner's hand first), public when the gallery is. tour_voices keys on the negative id.
  const galleryHang = b => (b ? { id: -b.id, gallery: true, slug: `g-${b.code || b.id}`, title: `${b.name ? b.name + '’s' : 'A'} gallery`, buyer_id: b.id, public: !!(b.public && b.code), line: b.statement || '', curator: b.name, curator_code: b.code, curator_public: b.public, updated_at: null } : null);
  const H = () => {
    const h = app.locals.hangs;
    return {
      ...h,
      byId: id => (Number(id) < 0 ? galleryHang(db.prepare('SELECT * FROM buyers WHERE id=?').get(-Number(id))) : h.byId(id)),
      bySlug: slug => (/^g-/.test(String(slug)) ? galleryHang(db.prepare('SELECT * FROM buyers WHERE code=?').get(String(slug).slice(2))) : h.bySlug(slug)),
      worksOf: x => (x && x.gallery ? galleryWorks(x) : h.worksOf(x)),
      href: x => (x && x.gallery ? (x.curator_code ? `/g/${x.curator_code}` : '/yours') : h.href(x))
    };
  };
  const galleryWorks = x => {
    const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(x.buyer_id); if (!b) return [];
    let hand = []; try { hand = app.locals.ownHand ? app.locals.ownHand(b) : []; } catch (e) { hand = []; }
    const list = app.locals.walk && b.code ? (app.locals.walk.list('gallery:' + b.code) || { works: [] }).works : [];
    const seen = new Set(); const slugs = [...hand, ...list].map(w => w.slug).filter(s => !seen.has(s) && seen.add(s));
    if (!slugs.length) return [];
    const rows = db.prepare(`SELECT w.*, m.name AS maker, m.handle FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.slug IN (${slugs.map(() => '?').join(',')})`).all(...slugs);
    const by = Object.fromEntries(rows.map(r => [r.slug, r])); return slugs.map(s => by[s]).filter(Boolean).map((w, i) => ({ ...w, pos: i + 1, note: '' }));
  };
  const own = (req, h) => { const b = buyerOf(req); return isStudio(req) || !!(b && h && h.buyer_id === b.id); };
  const voices = h => db.prepare('SELECT * FROM tour_voices WHERE hang_id=?').all(h.id);
  const voiceMap = h => { const m = {}; for (const v of voices(h)) m[v.work_id] = v; return m; };
  const isTour = h => !!db.prepare('SELECT 1 FROM tour_voices WHERE hang_id=? LIMIT 1').get(h.id);
  const guideOf = h => db.prepare('SELECT id, name, code, public, statement FROM buyers WHERE id=?').get(h.buyer_id) || {};
  const ext = mime => (/mp4|m4a|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /mpeg|mp3/.test(mime) ? 'mp3' : /wav/.test(mime) ? 'wav' : 'webm');
  // The curator records a word on a work (or the welcome: work 'welcome').
  app.post('/tour/:id/voice/:work', upload.single('voice'), (req, res, next) => app.locals.bagcheck.gate('audio', { json: true })(req, res, next), async (req, res) => {
    const h = H().byId(req.params.id); if (!h || !own(req, h)) { if (req.file) fs.unlink(req.file.path, () => {}); return res.sendStatus(h ? 403 : 404); }
    const wid = req.params.work === 'welcome' ? 0 : h.gallery ? (H().worksOf(h).find(w => w.slug === String(req.params.work)) || {}).id : (db.prepare('SELECT w.id FROM works w JOIN hang_works hw ON hw.work_id=w.id WHERE hw.hang_id=? AND w.slug=?').get(h.id, String(req.params.work)) || {}).id;
    if (wid == null || !req.file) { if (req.file) fs.unlink(req.file.path, () => {}); return res.sendStatus(400); }
    const seconds = Math.min(MAX_SECONDS, +req.body.seconds || 0) || null;
    const file = `tours/${h.id}-${wid}-${crypto.randomBytes(5).toString('hex')}.${ext(req.file.mimetype)}`;
    try { await store.put(file, req.file.path); } catch (e) { console.error('[tours vault]', e.message); fs.unlink(req.file.path, () => {}); return res.sendStatus(503); }
    fs.unlink(req.file.path, () => {});
    const first = !isTour(h);
    const old = db.prepare('SELECT * FROM tour_voices WHERE hang_id=? AND work_id=?').get(h.id, wid);
    if (old) { try { if (store.del) await store.del(old.file); } catch (e) { /* */ } }
    db.prepare('INSERT INTO tour_voices (hang_id, work_id, file, mime, seconds, bytes) VALUES (?,?,?,?,?,?) ON CONFLICT(hang_id, work_id) DO UPDATE SET file=excluded.file, mime=excluded.mime, seconds=excluded.seconds, bytes=excluded.bytes, at=datetime(\'now\')').run(h.id, wid, file, req.file.mimetype, seconds, req.file.size);
    if (first && h.public) { try { ledger.append(db, 'tour.opened', h.slug, { title: h.title, by: guideOf(h).name || 'a guide', gallery: !!h.gallery }); } catch (e) { /* */ } }
    const v = db.prepare('SELECT * FROM tour_voices WHERE hang_id=? AND work_id=?').get(h.id, wid);
    res.set('Cache-Control', 'private, no-store'); res.json({ ok: true, src: `/tour/${h.id}/voice/${v.id}`, seconds: v.seconds });
  });
  app.post('/tour/:id/voice/:work/remove', async (req, res) => {
    const h = H().byId(req.params.id); if (!h || !own(req, h)) return res.sendStatus(h ? 403 : 404);
    const wid = req.params.work === 'welcome' ? 0 : (db.prepare('SELECT w.id FROM works w WHERE w.slug=?').get(String(req.params.work)) || {}).id;
    const v = db.prepare('SELECT * FROM tour_voices WHERE hang_id=? AND work_id=?').get(h.id, wid); if (v) { try { if (store.del) await store.del(v.file); } catch (e) { /* */ } db.prepare('DELETE FROM tour_voices WHERE id=?').run(v.id); }
    res.set('Cache-Control', 'private, no-store'); res.json({ ok: true });
  });
  // The recording, to anyone the wall admits (public, or its own curator); ranges honoured so a phone can seek.
  app.get('/tour/:id/voice/:vid', async (req, res) => {
    const h = H().byId(req.params.id); if (!h) return res.sendStatus(404); if (!h.public && !own(req, h)) return res.sendStatus(403);
    const v = db.prepare('SELECT * FROM tour_voices WHERE id=? AND hang_id=?').get(+req.params.vid, h.id); if (!v) return res.sendStatus(404);
    let buf; try { buf = await store.get(v.file); } catch (e) { buf = null; } if (!buf) return res.sendStatus(404);
    res.set({ 'Content-Type': v.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': h.public ? 'public, max-age=3600' : 'private, no-store' });
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r) { const a = r[1] ? +r[1] : 0, b = r[2] ? Math.min(+r[2], buf.length - 1) : buf.length - 1; if (a > b || a >= buf.length) { res.set('Content-Range', `bytes */${buf.length}`); return res.sendStatus(416); } res.status(206).set({ 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Content-Length': b - a + 1 }); return res.end(buf.subarray(a, b + 1)); }
    res.set('Content-Length', buf.length); res.end(buf);
  });
  // The tour: the wall walked in the guide's voice.
  app.get('/tour/:slug', (req, res) => {
    const h = H().bySlug(req.params.slug); if (!h) return res.sendStatus(404);
    if (!h.public && !own(req, h)) return res.sendStatus(403);
    if (h.public) res.cookie('wm_via', h.gallery ? `gallery:${h.curator_code}` : `hang:${h.id}`, { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 30 * 86400e3 });
    const works = H().worksOf(h), vm = voiceMap(h), g = guideOf(h);
    const stops = [{ welcome: true, voice: vm[0] ? `/tour/${h.id}/voice/${vm[0].id}` : null }].concat(works.map(w => ({ slug: w.slug, title: w.title, maker: w.maker, handle: w.handle, place: w.place, year: w.taken_at ? String(w.taken_at).slice(0, 4) : '', note: w.note || '', voice: vm[w.id] ? `/tour/${h.id}/voice/${vm[w.id].id}` : null })));
    const at = Math.max(0, stops.findIndex(s => s.slug === req.query.at));
    res.send(layout({ title: `${h.title} · a tour · Watermark`, path: `/tour/${h.slug}`, desc: `${g.name || 'A guide'} walks you through ${h.title}.`, bare: true, body: `<main class="tw" data-tour='${esc(JSON.stringify({ slug: h.slug, title: h.title, guide: g.name || 'A guide', stops, at }))}'>
<header class="tw-bar"><a class="tw-back" href="${esc(H().href(h))}">${I.back}<span>The wall</span></a><p class="tw-title"><b>${esc(h.title)}</b><span>a tour with ${esc(g.name || 'a guide')}</span></p><span class="tw-n"></span></header>
<section class="tw-stage"><div class="tw-welcome"><p class="k">A tour</p><h1>${esc(h.title)}.</h1><p class="tw-guide">${esc(g.name || 'A guide')}${g.statement ? ` · ${esc(g.statement)}` : ''}</p>${h.line ? `<p class="lede">${esc(h.line)}</p>` : ''}<p class="tw-count">${works.length} stop${works.length === 1 ? '' : 's'} · ${Object.keys(vm).length ? 'in the guide’s own voice' : 'in the guide’s words'}</p><button type="button" class="buy-btn tw-begin">Begin</button></div><img class="tw-im" alt="" hidden><div class="tw-plate"><b></b><span></span><p class="tw-note"></p></div></section>
<footer class="tw-deck"><button type="button" class="tw-prev" aria-label="Back">${I.back}</button><button type="button" class="tw-play" aria-label="Play or pause">${I.play}${I.pause}</button><button type="button" class="tw-next" aria-label="Next">${I.next}</button></footer>
<audio class="tw-audio" preload="auto"></audio>
<template data-ic="wilhelm">${I.wilhelm}</template></main><script src="/static/tour.js?v=${esc(V.VER)}" defer></script>` }));
  });
  // The guides of the house: everyone whose wall carries their voice.
  app.get('/guides', (req, res) => {
    const rows = db.prepare(`SELECT b.id, b.name, b.code, b.public, b.statement, COUNT(DISTINCT h.id) tours, MAX(v.at) last FROM tour_voices v JOIN hangs h ON h.id=v.hang_id AND h.public=1 JOIN buyers b ON b.id=h.buyer_id GROUP BY b.id ORDER BY last DESC`).all();
    const toursOf = id => db.prepare('SELECT DISTINCT h.* FROM hangs h JOIN tour_voices v ON v.hang_id=h.id WHERE h.buyer_id=? AND h.public=1 ORDER BY h.updated_at DESC').all(id);
    res.send(layout({ title: 'Guides · Watermark', path: '/guides', desc: 'The guides of the house: people who walk you through the work in their own voice.', body: `<section class="cx-intro"><p class="k">The house</p><h1>Guides.</h1>
<p class="lede">Anyone with an eye and a voice can hang a wall and walk you through it. A guide chooses the work, writes a line on each, and says a word on each in their own voice. The house pays a guide the curator’s share of what is collected on their tour, and takes nothing of the cards left for them.</p>
<p class="hg-share"><a href="/yours?tab=hangs">Hang a wall and record a tour</a> · <a href="/hangs">Every wall</a></p></section>
<section class="gd-list">${rows.length ? rows.map(g => `<article class="gd"><h2>${g.public && g.code ? `<a href="/g/${esc(g.code)}">${esc(g.name || 'A guide')}</a>` : esc(g.name || 'A guide')}</h2>${g.statement ? `<p class="gd-line">${esc(g.statement)}</p>` : ''}<ul>${toursOf(g.id).map(h => `<li><a href="/tour/${esc(h.slug)}">${esc(h.title)}</a>${h.line ? ` <small>${esc(h.line)}</small>` : ''}</li>`).join('')}</ul></article>`).join('') : '<p class="note">No tour has been recorded yet. Be the first: hang a wall, and say a word on each work.</p>'}</section>` }));
  });
  // For the wall's page: the recorder beside each line (the owner), the door for everyone.
  function recorder(h, w) {
    const v = db.prepare('SELECT * FROM tour_voices WHERE hang_id=? AND work_id=?').get(h.id, w ? w.id : 0);
    const key = w ? w.slug : 'welcome';
    return `<div class="tw-rec" data-tour-rec="/tour/${h.id}/voice/${esc(key)}" ${v ? `data-has="/tour/${h.id}/voice/${v.id}"` : ''}><button type="button" class="link tw-rec-b">${v ? 'Say it again' : w ? 'Say a word on this one' : 'Record a welcome'}</button>${v ? `<audio controls preload="none" src="/tour/${h.id}/voice/${v.id}"></audio><button type="button" class="link tw-rec-x">Remove</button>` : ''}<span class="tw-rec-s"></span></div>`;
  }
  // The collector's own desk for the gallery's tour: the welcome and a word on each piece.
  app.get('/yours/tour', (req, res) => {
    const b = buyerOf(req); if (!b) return res.redirect('/signin?next=/yours/tour');
    const h = galleryHang(b), works = galleryWorks(h);
    res.send(layout({ title: 'A tour of your gallery · Watermark', path: '/yours/tour', body: `<section class="cx-intro twg"><p class="k">Your house</p><h1>A tour, in your voice.</h1>
<p class="lede">Say a word on each piece and a welcome at the door, and your gallery can be walked the way a guide walks a wall: the picture alone, your voice beside it, on to the next when you finish. Three minutes a stop at most; nothing is transcribed and no model hears it.${h.public ? ` <a href="/tour/${esc(h.slug)}">Take it</a>.` : ' The tour opens with your gallery: give it your name and an address under <a href="/yours?tab=more#settings">Settings</a>.'}</p>
<div class="twg-welcome"><h2>The welcome</h2>${recorder(h, null)}</div>
<ol class="twg-list">${works.map(w => `<li><a class="twg-pic" href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"></a><div><b>${esc(V.tidy ? V.tidy(w.title) : w.title)}</b><i>${esc(w.maker)}${w.place ? ` · ${esc(w.place)}` : ''}</i>${recorder(h, w)}</div></li>`).join('')}</ol>
${works.length ? '' : '<p class="yc-shelf">Nothing to walk yet: collect a piece first.</p>'}</section><script src="/static/tour.js?v=${esc(V.VER)}" defer></script>` }));
  });
  const galleryDoor = b => { const h = galleryHang(b); return h && h.public && isTour(h) ? `/tour/${h.slug}` : null; };
  const door = h => (isTour(h) ? `<p class="hg-share tw-door"><a href="/tour/${esc(h.slug)}">${I.guide}<span>Take the tour, in ${esc((guideOf(h).name || 'the guide').split(' ')[0])}’s voice</span></a></p>` : '');
  const toursBy = b => (b ? db.prepare('SELECT DISTINCT h.* FROM hangs h JOIN tour_voices v ON v.hang_id=h.id WHERE h.buyer_id=? ORDER BY h.updated_at DESC').all(b.id) : []);
  app.locals.tours = { isTour, recorder, door, toursBy, voices, MAX_SECONDS, galleryHang, galleryDoor };
  return app.locals.tours;
}
module.exports = { mountTours };
