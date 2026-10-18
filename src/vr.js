// In a headset (Will, 18 Oct: experience the work beautifully in a headset, in beautiful grand spaces). /vr is a
// room built in the browser with WebXR, so a Quest or a Vision Pro opens it from Safari or the Meta browser with no
// app: a long gallery under a skylight, a rotunda under a dome with an oculus, or the night (photographs alone in
// the dark). On a computer or a phone it is the same room, walked with the mouse, the keys or a finger.
// What hangs: any set the house already knows (?in=collection | maker:<handle> | gallery:<code> | hang:<slug> |
// series:<slug>), a public wall or gallery only; ?at=<slug> stands you before one photograph.
// The photographs travel at screen size; the plate beside each names the maker, as on every wall of the house.
const path = require('path');

function mountVR(app, { db, V }) {
  const SPACES = {
    gallery: { name: 'The long gallery', line: 'A gallery under a skylight, the photographs facing one another down its length.' },
    rotunda: { name: 'The rotunda', line: 'A round room under a dome, light falling through the oculus.' },
    night: { name: 'The night', line: 'Nothing but the photographs, each in its own light.' },
  };
  const MAX = 30;
  function setOf(key) {
    const W = app.locals.walk; if (!W) return null;
    const [kind, ...rest] = String(key || 'collection').split(':'); const k = rest.join(':');
    if (kind === 'hang') { const h = db.prepare('SELECT public FROM hangs WHERE slug=?').get(k); if (!h || !h.public) return null; }
    if (kind === 'gallery') { const b = db.prepare('SELECT public FROM buyers WHERE code=?').get(k); if (!b || !b.public) return null; }
    return W.list(key);
  }
  function items(key, at) {
    const v = setOf(key) || setOf('collection'); if (!v) return { label: 'The collection', href: '/collection', items: [] };
    let ws = v.works.slice();
    if (at) { const i = ws.findIndex(w => w.slug === at); if (i > 0) ws = ws.slice(i).concat(ws.slice(0, i)); }
    ws = ws.slice(0, MAX).map(w => db.prepare("SELECT w.*, m.name AS maker_name FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.slug=? AND w.status='held'").get(w.slug)).filter(Boolean);
    return { label: v.label, href: v.href, items: ws.map(w => ({ slug: w.slug, title: V.tidy(w.title), maker: w.maker_name, place: w.place || null, year: (w.taken_at || '').slice(0, 4) || null, w: w.width || 3, h: w.height || 2, img: `/img/${w.slug}/screen?f=jpg`, page: `/w/${w.slug}` })) };
  }
  app.get('/vendor/three.module.min.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.min.js'));
  });
  app.get('/api/vr', (req, res) => res.set('Cache-Control', 'no-store').json(items(String(req.query.in || 'collection').slice(0, 80), String(req.query.at || ''))));
  app.get('/vr', (req, res) => {
    const key = String(req.query.in || 'collection').slice(0, 80), space = SPACES[req.query.space] ? String(req.query.space) : 'gallery';
    const d = items(key, String(req.query.at || ''));
    res.set('Cache-Control', 'no-store').send(V.vrPage({ data: { ...d, key, space, spaces: SPACES }, spaces: SPACES, space, key }));
  });
  return { SPACES };
}
module.exports = { mountVR };
