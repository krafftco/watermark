// The walk (Will, 17 Oct): moving from one photograph to the next inside whatever you came from, the way you walk a
// room. The list you arrived through (the collection, a maker's archive, a gallery, a wall, a series) is remembered;
// the photograph page knows its place in it: 12 of 48, the one before and the one after, arrows, swipe, keys.
const RG = require('./regard');
const I = require('./icons');
const { esc } = require('./views');

function mountWalk(app, { db, V, SERIES }) {
  const TTL = 60e3, cache = new Map();
  const SEL = 'SELECT w.id, w.slug, w.title, w.width, w.height, w.maker_id FROM works w';
  function list(key) {
    const hit = cache.get(key); if (hit && Date.now() - hit.at < TTL) return hit.v;
    let v = null; const [kind, ...rest] = String(key || '').split(':'); const k = rest.join(':');
    try {
      if (kind === 'collection') v = { label: 'The collection', href: '/collection', works: RG.byRegard(db, db.prepare(`${SEL} WHERE w.status='held' ORDER BY w.id`).all()) };
      else if (kind === 'maker') { const m = db.prepare('SELECT * FROM makers WHERE handle=?').get(k) || [...db.prepare('SELECT * FROM makers').all()].find(x => V.makerSlug(x) === k); if (m) v = { label: `${m.name}'s archive`, href: `/m/${V.makerSlug(m)}`, works: RG.byRegard(db, db.prepare(`${SEL} WHERE w.maker_id=? AND w.status='held' ORDER BY w.curated DESC, w.id`).all(m.id)) }; }
      else if (kind === 'gallery') { const b = db.prepare('SELECT * FROM buyers WHERE code=?').get(k); if (b) v = { label: `${b.name ? b.name + "'s" : 'a'} gallery`, href: `/g/${b.code}`, works: db.prepare(`${SEL} JOIN licenses l ON l.work_id=w.id AND l.buyer_id=? AND l.status='active' WHERE w.status='held' GROUP BY w.id ORDER BY MIN(l.collector_no) IS NULL, MIN(l.collector_no), MIN(l.starts_at)`).all(b.id) }; }
      else if (kind === 'hang') { const h = db.prepare('SELECT h.*, b.code FROM hangs h JOIN buyers b ON b.id=h.buyer_id WHERE h.slug=?').get(k); if (h) v = { label: h.title, href: `/g/${h.code}/hang/${h.slug}`, works: db.prepare(`${SEL} JOIN hang_works hw ON hw.work_id=w.id WHERE hw.hang_id=? AND w.status='held' ORDER BY hw.pos, w.id`).all(h.id) }; }
      else if (kind === 'series') { const s = (SERIES || []).find(x => x.slug === k); if (s) { const slugs = s.chapters.flatMap(c => c.works); const rows = db.prepare(`${SEL} WHERE w.slug IN (${slugs.map(() => '?').join(',')}) AND w.status='held'`).all(...slugs); const by = new Map(rows.map(r => [r.slug, r])); v = { label: s.title, href: `/series/${s.slug}`, works: slugs.map(x => by.get(x)).filter(Boolean) }; } }
    } catch (e) { v = null; }
    cache.set(key, { at: Date.now(), v }); return v;
  }
  const ctxOf = req => { const q = req.query && req.query.in; if (q) return String(q).slice(0, 80); const m = /(?:^|;\s*)wm_in=([^;]+)/.exec(req.headers.cookie || ''); return m ? decodeURIComponent(m[1]).slice(0, 80) : null; };
  const set = (res, key) => res.cookie('wm_in', key, { httpOnly: true, sameSite: 'lax', maxAge: 2 * 3600e3, path: '/' });
  const brief = w => (w ? { slug: w.slug, title: w.title, href: `/w/${w.slug}`, thumb: `/img/${w.slug}/thumb`, screen: `/img/${w.slug}/screen` } : null);
  function walk(req, slug) {
    const key = ctxOf(req); if (!key) return null;
    const v = list(key); if (!v || !v.works.length) return null;
    const i = v.works.findIndex(w => w.slug === slug); if (i < 0) return null;
    const n = v.works.length;
    return { key, label: v.label, href: v.href, i: i + 1, n, prev: brief(v.works[(i - 1 + n) % n]), next: brief(v.works[(i + 1) % n]), wrap: n > 1 };
  }
  app.locals.walk = { walk, set, ctxOf, list };
  return app.locals.walk;
}

// The bar on the photograph page.
function walkBar(k) {
  if (!k) return '';
  return `<nav class="wk" aria-label="Walk" data-walk><a class="wk-go wk-prev" href="${esc(k.prev.href)}" title="${esc(k.prev.title)}">${I.back}<span>Before</span></a><p class="wk-where"><a href="${esc(k.href)}">${esc(k.label)}</a><b>${k.i} of ${k.n}</b></p><a class="wk-go wk-next" href="${esc(k.next.href)}" title="${esc(k.next.title)}"><span>Next</span>${I.next}</a></nav>
<script>window.__WM_WALK=${JSON.stringify({ prev: k.prev, next: k.next, i: k.i, n: k.n, label: k.label, href: k.href }).replace(/</g, '\\u003c')};</script>`;
}

module.exports = { mountWalk, walkBar };
