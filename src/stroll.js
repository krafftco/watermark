// The stroll (Will, 17 Oct: seeing photographs has to be as easy as Instagram, and as hard to put down, but the
// photographs have to be the most beautiful in the world). Watermark on a phone as a full-screen vertical scroll:
// one photograph fills the screen on the dark wall; a swipe brings the next; it never repeats what you have seen;
// the best work comes first and what you stand before shapes what comes next. Double-tap tips your hat. A rail
// of acts on the right; a plate at the foot; a search up top to stroll through one place or one maker.
const { esc } = require('./views');

function mountStroll(app, { db, V, wanderJSON, I }) {
  const PAGE = 8;
  // What comes next: never what this stroll has shown (up to 300 slugs carried by the client), the best first with a
  // little chance in it, and when there is a word, only what matches it (place, title, maker, keywords).
  const makerBy = key => { if (!key) return null; const all = db.prepare('SELECT * FROM makers').all(); return all.find(m => m.handle === key) || all.find(m => V.makerSlug(m) === key) || null; };
  function next(req, { seen = [], q = '', maker = '', n = PAGE } = {}) {
    const not = seen.slice(-300); const params = [];
    let where = "w.status='held'"; if (not.length) { where += ` AND w.slug NOT IN (${not.map(() => '?').join(',')})`; params.push(...not); }
    if (q) { const like = `%${q.replace(/[%_]/g, '')}%`; where += ' AND (w.title LIKE ? OR w.place LIKE ? OR w.keywords LIKE ? OR m.name LIKE ?)'; params.push(like, like, like, like); }
    const mk = makerBy(maker); if (mk) { where += ' AND w.maker_id=?'; params.push(mk.id); }
    const rows = db.prepare(`SELECT w.* FROM works w JOIN makers m ON m.id=w.maker_id WHERE ${where} ORDER BY (CASE WHEN w.curated=1 THEN 4 WHEN w.stars>=4 THEN 3 WHEN w.stars>=3 THEN 1.5 ELSE 1 END) * (0.5 + RANDOM() / 18446744073709551616.0 + 0.5) DESC LIMIT ?`).all(...params, n);
    // For you: when the house knows what held this visitor, a few of the eye's picks are set among the rest.
    let picks = [];
    if (!q && !mk && app.locals.looking && app.locals.buyerOf) {
      try { const b = app.locals.buyerOf(req), v = req.cookies && req.cookies.wm_v; if (b || v) { const c = app.locals.looking.candidates(b, v, 24, 8); const notSet = new Set(not); picks = c.picks.filter(x => !notSet.has(x.slug) && !rows.find(r => r.slug === x.slug)).slice(0, 3).map(x => db.prepare('SELECT * FROM works WHERE id=?').get(x.id)).filter(Boolean); } } catch (e) { picks = []; }
    }
    const out = []; let pi = 0;
    for (let i = 0; i < rows.length && out.length < n; i++) { if (pi < picks.length && i % 3 === 1) out.push(picks[pi++]); out.push(rows[i]); }
    while (pi < picks.length && out.length < n) out.push(picks[pi++]);
    return out.slice(0, n).map(w => wanderJSON(w, req));
  }
  // A set (Will, 18 Oct: the stroll everywhere): tapping a photograph in the collection, an artist, a gallery, a wall or a
  // series on a phone strolls through that set alone, in its own order, from the photograph tapped; the end says so.
  const setOf = key => (key && app.locals.walk ? app.locals.walk.list(String(key).slice(0, 80)) : null);
  function inSet(req, key, { seen = [], at = '', n = PAGE } = {}) {
    const v = setOf(key); if (!v || !v.works.length) return null;
    const slugs = v.works.map(w => w.slug), not = new Set(seen);
    let i = slugs.indexOf(at || seen[seen.length - 1]); if (i < 0) i = -1;
    const out = [];
    for (let k = 1; k <= slugs.length && out.length < n; k++) { const sl = slugs[(i + k) % slugs.length]; if (!not.has(sl) && sl !== at) { out.push(sl); not.add(sl); } }
    const rows = out.map(sl => db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(sl)).filter(Boolean);
    return { label: v.label, href: v.href, n: slugs.length, items: rows.map(w => wanderJSON(w, req)) };
  }
  app.get('/api/stroll', (req, res) => {
    const seen = String(req.query.seen || '').split(',').filter(Boolean);
    const q = String(req.query.q || '').trim().slice(0, 60), maker = String(req.query.maker || '').slice(0, 60);
    const n = Math.max(1, Math.min(16, parseInt(req.query.n, 10) || PAGE));
    if (req.query.in) { const r = inSet(req, req.query.in, { seen, n }); if (r) return res.set('Cache-Control', 'no-store').json({ items: r.items, end: r.items.length < n, label: r.label, href: r.href }); }
    res.set('Cache-Control', 'no-store').json({ items: next(req, { seen, q, maker, n }), q, maker });
  });
  // The ways in (18 Oct: Find should never be an empty box): the places, the makers and the series held, with counts.
  app.get('/api/stroll/ways', (req, res) => {
    const places = db.prepare("SELECT place AS name, COUNT(*) n FROM works WHERE status='held' AND place IS NOT NULL AND place!='' GROUP BY place ORDER BY n DESC, place LIMIT 24").all();
    const makers = db.prepare("SELECT m.*, COUNT(*) n FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND COALESCE(m.kind,'') NOT IN ('writer','gallery') GROUP BY m.id ORDER BY n DESC LIMIT 12").all().map(m => ({ name: m.name, slug: V.makerSlug(m), n: m.n }));
    let series = []; try { series = db.prepare("SELECT s.slug, s.title, COUNT(sw.work_id) n FROM series s JOIN series_works sw ON sw.series_id=s.id JOIN works w ON w.id=sw.work_id AND w.status='held' WHERE s.public=1 GROUP BY s.id ORDER BY n DESC LIMIT 12").all(); } catch (e) { series = []; }
    res.set('Cache-Control', 'public, max-age=300').json({ places, makers, series });
  });
  app.get('/stroll', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60), maker = String(req.query.maker || '').slice(0, 60);
    const at = req.query.at ? db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(req.query.at)) : null;
    const key = String(req.query.in || '').slice(0, 80); const set = key ? inSet(req, key, { at: at ? at.slug : '', n: 6 }) : null;
    let items = set ? set.items : next(req, { q, maker, n: 6, seen: at ? [at.slug] : [] });
    if (at) items = [wanderJSON(at, req), ...items];
    const mk = set ? null : makerBy(maker);
    res.set('Cache-Control', 'private, no-store');
    res.send(strollPage({ items, q: set ? '' : q, maker: mk ? { name: mk.name, slug: V.makerSlug(mk) } : null, set: set ? { key, label: set.label, href: set.href, n: set.n } : null, I }));
  });
}

// The page: the first photographs are in the HTML, so the stroll begins the instant it opens; the script carries on.
function strollPage({ items, q = '', maker = null, set = null, I }) {
  const V = require('./views');
  const card = (w, i) => `<section class="st-i" data-slug="${esc(w.slug)}">
<img class="st-im" src="${esc(w.img)}" alt="${esc(w.title)}" draggable="false" decoding="async"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}>
<div class="st-plate"><a class="st-by" href="/stroll?maker=${esc(w.makerSlug)}&at=${esc(w.slug)}" data-st-maker>${esc(w.maker)}</a><a class="st-t" href="/m/${esc(w.makerSlug)}/${esc(w.slug)}">${esc(w.title)}</a><span class="st-k">${w.place ? `<a href="/stroll?q=${encodeURIComponent(w.place)}">${esc(w.place)}</a>` : ''}${w.place && w.year ? ' · ' : ''}${esc(w.year || '')}</span></div>
<button type="button" class="st-eye" data-eye="${esc(w.slug)}" aria-label="See the watermark">${I.eye}</button>
<nav class="st-rail" aria-label="Acts">
<button type="button" class="st-b" data-st-hat aria-pressed="${w.hat && w.hat.mine ? 'true' : 'false'}">${I.hat}<span data-st-hat-n>Hat</span></button><button type="button" class="st-b st-bv" data-st-bravo aria-pressed="${w.bravo && w.bravo.mine ? 'true' : 'false'}">${I.bravo}<span>Bravo</span></button>
<button type="button" class="st-b" data-st-hang>${I.hang}<span>Hang</span></button>
${w.held ? `<span class="st-b st-held">${I.collect}<span>Yours</span></span>` : w.collect ? `<button type="button" class="st-b st-buy" data-st-buy data-url="${esc(w.collect.url)}" data-pocket="${w.collect.pocket ? 1 : 0}">${I.collect}<span>${esc(w.collect.price)}</span></button>` : ''}
${w.guide ? `<button type="button" class="st-b" data-st-guide>${I.guide}<span>Guide</span></button>` : ''}
<button type="button" class="st-b" data-st-card>${I.card}<span>Card</span></button>
<button type="button" class="st-b" data-st-share>${I.send}<span>Share</span></button>
</nav>
<div class="st-hat-fly" aria-hidden="true">${I.hat}</div>
</section>`;
  return V.layout({ title: `${q ? `${V.tidy(q)} · ` : ''}The stroll · Watermark`, desc: 'Watermark on a phone: the finest work, one at a time, edge to edge. Swipe for the next.', path: '/stroll', bare: true, image: items[0] ? items[0].img : null, body: `<main class="st" data-stroll data-q="${esc(q)}" data-maker="${esc(maker ? maker.slug : '')}">
<header class="st-top"><a class="st-home" href="/" aria-label="Watermark">${V.WAVE_MARK || ''}<span>Watermark</span></a>${maker ? `<a class="st-chip" href="/stroll" title="Everything again">${esc(maker.name)}<i>${I.close}</i></a>` : ''}${set ? `<a class="st-chip st-set" href="${esc(set.href)}" title="Back to ${esc(set.label)}">${esc(set.label)}<i>${I.close}</i></a>` : ''}${q && !maker && !set ? `<a class="st-chip" href="/stroll" title="Everything again">${esc(q)}<i>${I.close}</i></a>` : ''}<span class="st-sp"></span><button type="button" class="st-gon" data-find-open="stroll" aria-label="Find" title="Find a work, a place, a maker: straight to it">${I.find || I.eye}<span>Find</span></button><button type="button" class="st-gon" data-st-settings aria-label="Settings" title="The guide, the pace, the sound">${I.dial}<span>Settings</span></button><a class="st-x" href="${set ? esc(set.href) : '/collection'}" aria-label="Close" data-st-close>${I.close}</a></header>
/div>
<div class="st-sheet st-ss" data-st-ssheet hidden><div class="st-scard"><button type="button" class="st-gx" data-st-sx2 aria-label="Close">${I.close}</button><p class="k">Settings</p>
<button type="button" class="st-sit1" data-st-sit aria-pressed="false">${I.stand}<b>Sit a while</b><span>Each work held a minute and a half, the guide read, quiet music. Tap again to stand.</span></button>
<div class="st-srow"><p class="st-sk">The guide</p>${V.GUIDE_SWITCH || ''}</div>
<div class="st-srow"><p class="st-sk">Pace</p><div class="st-pills" data-st-pace><button type="button" data-pace="0">You scroll</button><button type="button" data-pace="15">15 s</button><button type="button" data-pace="30">30 s</button><button type="button" data-pace="90">90 s</button></div></div>
<div class="st-srow"><p class="st-sk">Sound</p><label class="st-sw"><input type="checkbox" data-st-music><span>Quiet music, made here</span></label><label class="st-sw"><input type="checkbox" data-st-gon><span>The guide read aloud as you arrive</span></label></div>
<p class="st-skeys">Keys: arrows or space move · H hat · B bravo · S hang · G guide · C collect · Esc leaves.</p></div></div>
<div class="st-scroll" data-st-scroll>${items.map(card).join('')}${items.length ? '' : `<section class="st-i st-none"><p>Nothing by that word yet.</p><a href="/stroll">Stroll on</a></section>`}</div>
<div class="st-guide" data-st-guide-sheet hidden><div class="st-gcard"><button type="button" class="st-gx" data-st-gx aria-label="Close">${I.close}</button><p class="k st-wil">${I.wilhelm}Look closer &middot; Wilhelm</p>${V.GUIDE_SWITCH || ''}<div class="st-gt" data-st-gt></div><p class="st-gby" data-st-gby></p></div></div>
<p class="st-toast" data-st-toast hidden></p>${['find','close','next','wave','wilhelm'].map(k => `<template data-ic="${k}">${I[k]}</template>`).join('')}
<div class="st-sitbar" data-st-sitbar hidden><button type="button" data-st-stand>Stand up</button></div>
<p class="st-stay" data-st-stay hidden>Stay with this one.</p>
</main>
<script>window.__WM_STROLL=${JSON.stringify({ items, q, maker: maker ? maker.slug : '', set }).replace(/</g, '\\u003c')};</script>
<script src="/static/stroll.js?v=${V.VER || ''}" defer></script><script src="/static/eye.js?v=${V.VER || ''}" defer></script>` });
}

module.exports = { mountStroll, strollPage };
