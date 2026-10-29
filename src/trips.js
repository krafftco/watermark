// The trip (29 Oct, Will: "show off work in the way it was shot; people could see someone's trip chronologically and
// see it unwind like a movie"; "the frames that are skipped: a blur that shows it's private but in the archive";
// "make it feel like the photographer is holding back gems"; "something I wish I could share but can't, and someday
// I might get permission, and it's ready in the archive"; "we have to get people to hide and unhide work").
// /trip/<maker>/<place>: every frame the maker made in one place, in the order it was taken, played like a film:
// one frame at a time on the dark wall, the place and the hour on the frame, a title card when the day turns or the
// light goes ("Later that day", "The next morning", "Tuesday, May 15"). What the maker shows is shown; what they keep
// back stays in the film as a gem held back: a colour wash of the frame (48 px, blurred to nothing a face could be
// read from; never the picture) with 'Held back by the photographer · kept in the archive'. A frame the maker has
// taken out of their trips (works.in_trip = 0), a rejected frame, a quarantined or merged one, never appears at all.
// The maker sees their own trip with every frame true and one tap on each: On view | Held back (hide and unhide).
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const MIN = Number(process.env.TRIP_MIN || 8);

function mountTrips(app, { db, V, C, images, cache, originalPath, ledger, makerOf, isStudio }) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='in_trip'").get()) db.exec('ALTER TABLE works ADD COLUMN in_trip INTEGER NOT NULL DEFAULT 1');
  const esc = V.esc, tidy = V.tidy || (s => s);
  const makerBy = h => db.prepare('SELECT * FROM makers WHERE handle=?').get(String(h || ''));
  const placeOf = w => String(w.place || '').trim();
  const shown = w => w.status === 'held' && !w.keep_back;
  const owner = (req, m) => { const me = makerOf(req); return (me && me.id === m.id) || isStudio(req); };
  const frames = m => db.prepare(`SELECT * FROM works WHERE maker_id=? AND status IN ('held','hidden') AND in_trip=1 AND COALESCE(flag,'')<>'reject' AND COALESCE(disputed,0)=0 AND place IS NOT NULL AND place<>''`).all(m.id);
  const when = w => String(w.taken_at || w.created_at || '');
  // Every place with enough frames to be a trip, the most frames first; the cover is the best shown frame.
  function list(m) {
    const by = new Map();
    for (const w of frames(m)) { const p = placeOf(w); if (!by.has(p)) by.set(p, []); by.get(p).push(w); }
    return [...by.entries()].filter(([, ws]) => ws.length >= MIN && ws.some(shown)).map(([place, ws]) => {
      const vis = ws.filter(shown).sort((a, b) => (b.stars - a.stars) || (b.curated - a.curated));
      const dates = ws.map(when).filter(Boolean).sort();
      return { place, slug: slugify(place), n: ws.length, held: ws.length - vis.length, cover: vis[0] ? vis[0].slug : null, from: dates[0] || null, to: dates[dates.length - 1] || null, href: `/trip/${encodeURIComponent(m.handle)}/${slugify(place)}` };
    }).sort((a, b) => b.n - a.n);
  }
  function trip(m, pslug) {
    const ws = frames(m).filter(w => slugify(placeOf(w)) === pslug).sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : a.id - b.id));
    return ws.length ? { place: placeOf(ws[0]), ws } : null;
  }

  // The gem held back: a wash of the frame's colours, never the picture. Public: it shows nothing but colour.
  app.get('/img/:slug/held', async (req, res) => {
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status IN ('held','hidden') AND in_trip=1").get(req.params.slug);
    if (!w) return res.sendStatus(404);
    try {
      const out = path.join(cache, `${w.slug}-held.jpg`);
      if (!fs.existsSync(out)) {
        const src = await images.derivative(await originalPath(w), cache, w.slug, 'thumb', 'jpg');
        const r = (w.width || 3) / (w.height || 2); const W = 900, H = Math.max(200, Math.round(W / r));
        const tiny = await sharp(src).resize(12, Math.max(4, Math.round(12 / r)), { fit: 'fill' }).blur(1.2).toBuffer();
        const tmp = `${out}.${process.pid}.tmp`;
        await sharp(tiny).resize(W, H, { kernel: 'cubic' }).blur(28).modulate({ brightness: 0.72, saturation: 0.8 }).jpeg({ quality: 70 }).toFile(tmp);
        try { fs.renameSync(tmp, out); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* there */ } }
      }
      res.set('Cache-Control', 'public, max-age=86400'); res.type('image/jpeg').sendFile(out);
    } catch (e) { res.sendStatus(404); }
  });

  // Hide and unhide, one tap, by the maker (or the house).
  app.post('/trip/work/:slug', (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(req.params.slug); if (!w) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id);
    if (!owner(req, m)) return res.status(403).json({ ok: false });
    const b = req.body || {};
    if (b.out === '1') { db.prepare('UPDATE works SET in_trip=0 WHERE id=?').run(w.id); return res.json({ ok: true, out: true }); }
    if (b.show === '1') {
      if (w.status === 'quarantined' || (w.disputed || 0) > 0 || w.flag === 'reject') return res.json({ ok: false, why: 'This frame cannot go up.' });
      if (w.status !== 'held' && app.locals.mayHang && !app.locals.mayHang(m)) return res.json({ ok: false, why: 'Your museum’s walls are full.' });
      db.prepare("UPDATE works SET status='held', keep_back=0 WHERE id=?").run(w.id);
      if (w.status !== 'held') { ledger.append(db, 'work.published', w.slug, { maker: m.handle, by: 'trip' }); if (app.locals.legal) { try { app.locals.legal.accept('maker', m.id, 'makers', null, 'trip'); } catch (e) { /* quiet */ } } }
    } else {
      db.prepare("UPDATE works SET status='hidden', keep_back=1 WHERE id=?").run(w.id);
      if (w.status === 'held') ledger.append(db, 'work.private', w.slug, { maker: m.handle, by: 'trip' });
    }
    if (app.locals.findIndexDirty) app.locals.findIndexDirty();
    res.json({ ok: true, shown: b.show === '1' });
  });

  // The camera's own hour, as it was on the clock where it was made (EXIF carries no zone): read as wall time.
  const day = s => { let t = String(s || '').replace(' ', 'T'); if (!t) return null; if (/^\d{4}-\d\d-\d\d$/.test(t)) t += 'T12:00:00'; if (!/(Z|[+-]\d\d:?\d\d)$/.test(t)) t += 'Z'; const d = new Date(t); return isNaN(d) ? null : d; };
  const fmtDay = d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const fmtHour = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).toLowerCase();
  // The cards between frames: a new day, the light turning, a long pause.
  function cardBefore(prev, cur) {
    const a = prev ? day(when(prev)) : null, b = day(when(cur)); if (!b) return null;
    if (!a) return fmtDay(b);
    if (a.toISOString().slice(0, 10) !== b.toISOString().slice(0, 10)) { const gap = Math.round((Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) / 864e5); return gap === 1 && b.getUTCHours() < 11 ? `The next morning · ${fmtDay(b)}` : fmtDay(b); }
    const h = (b - a) / 36e5; if (h >= 3) return b.getUTCHours() >= 18 ? 'That evening' : 'Later that day';
    return null;
  }

  app.get('/trip/:handle/:place', (req, res) => {
    const m = makerBy(req.params.handle); if (!m) return res.sendStatus(404);
    const t = trip(m, req.params.place); if (!t) return res.sendStatus(404);
    const mine = owner(req, m);
    if (!mine && !t.ws.some(shown)) return res.sendStatus(404);
    res.set('Cache-Control', mine ? 'private, no-store' : 'public, max-age=300');
    const seq = []; let prev = null;
    for (const w of t.ws) {
      const c = cardBefore(prev, w); if (c) seq.push({ card: c });
      const d = day(when(w)); const vis = shown(w);
      seq.push({ slug: w.slug, title: tidy(w.title), shown: vis, open: vis || mine, at: d ? `${fmtDay(d)}, ${fmtHour(d)}` : '', w: w.width || 3, h: w.height || 2, href: `/w/${w.slug}` });
      prev = w;
    }
    const nShown = t.ws.filter(shown).length, nHeld = t.ws.length - nShown;
    const first = String(m.name || '').split(' ')[0];
    const dates = t.ws.map(when).filter(Boolean).sort(); const d0 = day(dates[0]), d1 = day(dates[dates.length - 1]);
    const span = d0 && d1 ? (d0.toISOString().slice(0, 10) === d1.toISOString().slice(0, 10) ? fmtDay(d0) : `${fmtDay(d0)} to ${fmtDay(d1)}`) : '';
    const data = JSON.stringify({ seq, mine, back: `/m/${encodeURIComponent(V.makerSlug ? V.makerSlug(m) : m.handle)}` }).replace(/</g, '\\u003c');
    res.send(V.layout({ title: `${t.place} · ${m.name} · Watermark`, path: '/wander', bare: true, body: `<main class="trp" data-trp>
<section class="trp-open" data-trp-open><p class="trp-k">A trip, as it was shot</p><h1>${esc(t.place)}</h1><p class="trp-by">${esc(m.name)}${span ? ` · ${esc(span)}` : ''}</p>
<p class="trp-n">${t.ws.length} frames, in the order they were taken${nHeld ? ` · <span class="trp-gem">◆</span> ${nHeld} held back by the photographer, kept in the archive` : ''}</p>
<button type="button" class="trp-go" data-trp-go>Play it</button> <a class="trp-x" href="/m/${esc(V.makerSlug ? V.makerSlug(m) : m.handle)}">${esc(first)}’s page</a>
${mine ? `<p class="trp-own">This is your trip. Every frame shows true to you; tap <b>On view</b> or <b>Held back</b> on any frame to hide or unhide it. Held-back frames show to others only as a wash of colour.</p>` : ''}</section>
<section class="trp-film" data-trp-film hidden><div class="trp-stage" data-trp-stage></div>
<header class="trp-top"><a class="trp-close" href="/m/${esc(V.makerSlug ? V.makerSlug(m) : m.handle)}" aria-label="Leave">×</a><span class="trp-place">${esc(t.place)}</span><span class="trp-at" data-trp-at></span><span class="trp-count" data-trp-count></span></header>
<footer class="trp-deck"><button type="button" data-trp-prev aria-label="Back">‹</button><button type="button" data-trp-play aria-label="Pause">❚❚</button><button type="button" data-trp-next aria-label="Next">›</button><span class="trp-pace"><button type="button" data-trp-pace="6000">Slow</button><button type="button" data-trp-pace="3500" aria-pressed="true">Steady</button><button type="button" data-trp-pace="1600">Quick</button></span>${mine ? '<button type="button" class="trp-vis" data-trp-vis></button>' : ''}</footer>
<div class="trp-strip" data-trp-strip></div></section>
<script>window.__WM_TRIP=${data}</script><script src="/static/trip.js" defer></script></main>` }));
  });

  app.locals.trips = { list, trip, slugify };
  return app.locals.trips;
}
module.exports = { mountTrips, slugify };
