// The zones (Will, 20 Oct: a child-friendly, safe house by default, one you could hand to a kid on an iPad, like
// trusting your kid walking around the Met; real art worth showing that is not for children can hang, with its
// label, in a room you enter knowing what you will see; never cheap, crude or offensive, which curation refuses).
//   works.zone: 'all' (default) | 'mature', set by the maker on the work's record (with a line saying why: nudity,
//   violence, disturbing subject matter) or by the house.
//   The visitor's zone, cookie wm_zone (180 days): 'all' (default: mature work is veiled and left out of the walks),
//   'mature' (the adult rooms are open; each work still labelled), 'family' (the doors to the adult rooms are closed
//   on this device; the switch to undo it is at /zone, so it is a lock against wandering, not against a determined
//   teenager, and the page says so).
//   The veil: a mature work's served pictures (/img) are a deep blur unless the adult rooms are open, so every
//   listing, feed and preview is safe without touching each of them. The work page asks at the door.
//   The walks (the stroll's feed, Wander, today's, Find) leave mature work out unless the rooms are open.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
function mountZone(app, { db, V, images, originalPath, cache, isStudio, makerOf }) {
  const { esc, tidy } = V;
  for (const [c, t] of [['zone', "TEXT NOT NULL DEFAULT 'all'"], ['zone_note', 'TEXT']]) if (!db.prepare(`SELECT 1 FROM pragma_table_info('works') WHERE name='${c}'`).get()) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  const zoneOf = req => { const z = req.cookies && req.cookies.wm_zone; return z === 'mature' || z === 'family' ? z : 'all'; };
  const open = req => zoneOf(req) === 'mature';
  const mature = w => !!(w && w.zone === 'mature');
  // The SQL fragment the walks add when the rooms are closed.
  const sql = (req, alias = 'w') => (open(req) ? '' : ` AND COALESCE(${alias}.zone,'all')='all'`);
  const setZone = (res, z) => res.cookie('wm_zone', z, { maxAge: 180 * 86400000, sameSite: 'lax', httpOnly: false, path: '/' });

  app.get('/zone', (req, res) => {
    const z = zoneOf(req), back = String(req.query.back || '/collection').replace(/[^\w\-/?=&.%]/g, '');
    res.send(V.layout({ title: 'The rooms · Watermark', path: '/zone', body: `<article class="zn"><p class="k">The house</p><h1>Which rooms are open.</h1>
<p class="lede">Most of the house is for everyone: you can hand it to a child. Some rooms hold work that is not for children: nudity, violence, a hard subject. Real art, worth showing, labelled at the door. You choose whether those doors open on this device.</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<form method="post" action="/zone" class="zn-f"><input type="hidden" name="back" value="${esc(back)}">
<label class="zn-o${z === 'all' ? ' on' : ''}"><input type="radio" name="zone" value="all"${z === 'all' ? ' checked' : ''}><b>Everyone</b><span>The adult rooms are closed and veiled. Each one asks at its door; you may enter one at a time.</span></label>
<label class="zn-o${z === 'mature' ? ' on' : ''}"><input type="radio" name="zone" value="mature"${z === 'mature' ? ' checked' : ''}><b>Including the adult rooms</b><span>Every room is open to you. Each work that is not for children still carries its label.</span></label>
<label class="zn-o${z === 'family' ? ' on' : ''}"><input type="radio" name="zone" value="family"${z === 'family' ? ' checked' : ''}><b>Family</b><span>The adult rooms are closed and their doors do not open on this device until you come back here. A latch, not a lock: it keeps a child from wandering in, not a determined one from finding this page.</span></label>
<button class="buy-btn">Keep</button></form>
<p class="note">The house refuses what is cheap, crude or offensive at the door; the adult rooms hold only work the house would hang.</p></article>` }));
  });
  app.post('/zone', (req, res) => { const z = ['all', 'mature', 'family'].includes((req.body || {}).zone) ? req.body.zone : 'all'; setZone(res, z); res.redirect(303, `/zone?ok=${encodeURIComponent('Kept.')}&back=${encodeURIComponent(String((req.body || {}).back || '/collection'))}`); });
  app.post('/zone/enter', (req, res) => { if (zoneOf(req) === 'family') return res.redirect('/zone'); setZone(res, 'mature'); res.redirect(303, String((req.body || {}).back || '/collection').replace(/[^\w\-/?=&.%]/g, '') || '/collection'); });

  // The door on a work page.
  const door = (req, res, w, m) => {
    const fam = zoneOf(req) === 'family';
    res.status(200).send(V.layout({ title: `${tidy(w.title)} · Watermark`, path: '/w', body: `<article class="zn-door"><p class="k">A room not for children</p><h1>${esc(tidy(w.title))}</h1><p class="lede">A photograph by ${esc(m ? m.name : '')}${w.zone_note ? `: ${esc(w.zone_note)}` : ''}. The house hangs it as the work it is; it is not for children.</p>
${fam ? '<p>This device is set to Family, so this door stays closed. <a href="/zone">The rooms</a>.</p>' : `<form method="post" action="/zone/enter" class="zn-enter"><input type="hidden" name="back" value="${esc(req.originalUrl)}"><button class="buy-btn">I am an adult; open the room</button></form><p class="note">Opening it opens every adult room on this device. <a href="/zone">Choose otherwise</a>.</p>`}
<p><a href="/collection">Back to the collection</a> · <a href="/wander">Wander instead</a></p></article>` }));
  };
  app.use((req, res, next) => {
    if (req.method !== 'GET' || open(req)) return next();
    const m1 = req.path.match(/^\/w\/([^/]+)\/?$/) || req.path.match(/^\/m\/[^/]+\/([^/]+)\/?$/); if (!m1) return next();
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(m1[1]); if (!w || !mature(w)) return next();
    const me = makerOf(req); if ((me && me.id === w.maker_id) || isStudio(req)) return next();
    const mk = db.prepare('SELECT name FROM makers WHERE id=?').get(w.maker_id);
    door(req, res, w, mk);
  });
  // The veil over a mature work's pictures when the rooms are closed.
  app.get('/img/:slug/:size', async (req, res, next) => {
    if (open(req)) return next();
    const w = db.prepare("SELECT * FROM works WHERE slug=?").get(req.params.slug); if (!w || !mature(w) || !images.SIZES[req.params.size]) return next();
    const me = makerOf(req); if ((me && me.id === w.maker_id) || isStudio(req)) return next();
    try {
      const out = path.join(cache, `${w.slug}-${req.params.size}-veil.jpg`);
      if (!fs.existsSync(out)) { const src = await images.derivative(await originalPath(w), cache, w.slug, req.params.size, 'jpg'); const tmp = `${out}.${process.pid}.tmp`; await sharp(src).blur(60).modulate({ brightness: 0.8, saturation: 0.5 }).jpeg({ quality: 70 }).toFile(tmp); try { fs.renameSync(tmp, out); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* there */ } } }
      res.set('Cache-Control', 'private, max-age=3600'); res.set('Vary', 'Cookie'); res.type('image/jpeg').sendFile(out);
    } catch (e) { next(); }
  });

  // The maker, or the house, sets the zone on the work.
  const setWorkZone = (w, z, note) => { db.prepare('UPDATE works SET zone=?, zone_note=? WHERE id=?').run(z === 'mature' ? 'mature' : 'all', z === 'mature' ? (note || null) : null, w.id); if (app.locals.findIndexDirty) app.locals.findIndexDirty(); };
  app.post('/account/works/:slug/zone', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const w = db.prepare('SELECT * FROM works WHERE slug=? AND maker_id=?').get(req.params.slug, m.id); if (!w) return res.sendStatus(404);
    setWorkZone(w, (req.body || {}).zone, String((req.body || {}).note || '').replace(/<[^>]*>/g, '').trim().slice(0, 140));
    res.redirect(303, `/account/works/${encodeURIComponent(w.slug)}?ok=zone`);
  });
  app.post('/studio/works/:slug/zone', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(req.params.slug); if (!w) return res.sendStatus(404);
    setWorkZone(w, (req.body || {}).zone, String((req.body || {}).note || '').trim().slice(0, 140));
    res.redirect(303, `/studio/works/${encodeURIComponent(w.slug)}?ok=zone`);
  });
  // The block on the work's record.
  const block = (w, action) => `<section class="zn-set"><h2>Not for children?</h2><p class="note">Most work is for everyone. If this one shows nudity, violence or a hard subject, mark it so: it hangs behind a door with its label, veiled in the walks, and never on a device set to Family. The house may set it too.</p>
<form method="post" action="${action}" class="zn-setf"><label class="cr-att"><input type="checkbox" name="zone" value="mature"${mature(w) ? ' checked' : ''}> Not for children</label><label>Why, in a few words (shown at the door)<input name="note" maxlength="140" value="${esc(w.zone_note || '')}" placeholder="nudity · violence · a hard subject"></label><button class="buy-btn">Keep</button></form></section>`;
  const label = w => (mature(w) ? `<p class="zn-label"><span class="k">Not for children</span>${w.zone_note ? ` ${esc(w.zone_note)}` : ''} · <a href="/zone">The rooms</a></p>` : '');
  app.locals.zone = { of: zoneOf, open, mature, sql, block, label };
  return app.locals.zone;
}
module.exports = { mountZone };
