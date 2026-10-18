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
  app.get('/api/stroll', (req, res) => {
    const seen = String(req.query.seen || '').split(',').filter(Boolean);
    const q = String(req.query.q || '').trim().slice(0, 60), maker = String(req.query.maker || '').slice(0, 60);
    const n = Math.max(1, Math.min(16, parseInt(req.query.n, 10) || PAGE));
    res.set('Cache-Control', 'no-store').json({ items: next(req, { seen, q, maker, n }), q, maker });
  });
  app.get('/stroll', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60), maker = String(req.query.maker || '').slice(0, 60);
    const at = req.query.at ? db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(req.query.at)) : null;
    let items = next(req, { q, maker, n: 6, seen: at ? [at.slug] : [] });
    if (at) items = [wanderJSON(at, req), ...items];
    const mk = makerBy(maker);
    res.set('Cache-Control', 'private, no-store');
    res.send(strollPage({ items, q, maker: mk ? { name: mk.name, slug: V.makerSlug(mk) } : null, I }));
  });
}

// The page: the first photographs are in the HTML, so the stroll begins the instant it opens; the script carries on.
function strollPage({ items, q = '', maker = null, I }) {
  const V = require('./views');
  const card = (w, i) => `<section class="st-i" data-slug="${esc(w.slug)}">
<img class="st-im" src="${esc(w.img)}" alt="${esc(w.title)}" draggable="false" decoding="async"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}>
<div class="st-plate"><a class="st-by" href="/stroll?maker=${esc(w.makerSlug)}&at=${esc(w.slug)}" data-st-maker>${esc(w.maker)}</a><a class="st-t" href="/m/${esc(w.makerSlug)}/${esc(w.slug)}">${esc(w.title)}</a><span class="st-k">${w.place ? `<a href="/stroll?q=${encodeURIComponent(w.place)}">${esc(w.place)}</a>` : ''}${w.place && w.year ? ' · ' : ''}${esc(w.year || '')}</span></div>
<nav class="st-rail" aria-label="Acts">
<button type="button" class="st-b" data-st-hat aria-pressed="${w.hat && w.hat.mine ? 'true' : 'false'}">${I.hat}<span data-st-hat-n>${w.hat && w.hat.n ? w.hat.n : ''}</span></button>
<button type="button" class="st-b" data-st-hang>${I.hang}<span>Hang</span></button>
${w.held ? `<span class="st-b st-held">${I.collect}<span>Yours</span></span>` : w.collect ? `<button type="button" class="st-b st-buy" data-st-buy data-url="${esc(w.collect.url)}" data-pocket="${w.collect.pocket ? 1 : 0}">${I.collect}<span>${esc(w.collect.price)}</span></button>` : ''}
${w.guide ? `<button type="button" class="st-b" data-st-guide>${I.guide}<span>Guide</span></button>` : ''}
<button type="button" class="st-b" data-st-card>${I.card}<span>Card</span></button>
<button type="button" class="st-b" data-st-share>${I.send}<span>Share</span></button>
</nav>
<div class="st-hat-fly" aria-hidden="true">${I.hat}</div>
</section>`;
  return V.layout({ title: `${q ? `${V.tidy(q)} · ` : ''}The stroll · Watermark`, desc: 'Watermark on a phone: the finest photographs, one at a time, edge to edge. Swipe for the next.', path: '/stroll', bare: true, image: items[0] ? items[0].img : null, body: `<main class="st" data-stroll data-q="${esc(q)}" data-maker="${esc(maker ? maker.slug : '')}">
<header class="st-top"><a class="st-home" href="/" aria-label="Watermark">${V.WAVE_MARK || ''}<span>Watermark</span></a>${maker ? `<a class="st-chip" href="/stroll" title="Everything again">${esc(maker.name)}<i>${I.close}</i></a>` : ''}<button type="button" class="st-gon" data-st-gon aria-pressed="false" title="Read each guide as you arrive">${I.guide}<span>Guide</span></button><form class="st-search" action="/stroll" method="get" data-st-search><input type="search" name="q" value="${esc(q)}" placeholder="A place, a maker, a word" aria-label="Find" autocomplete="off"><button type="button" class="st-sx" data-st-sx aria-label="Find">${I.eye}</button></form><a class="st-x" href="/collection" aria-label="Close">${I.close}</a></header>
<div class="st-scroll" data-st-scroll>${items.map(card).join('')}${items.length ? '' : `<section class="st-i st-none"><p>Nothing by that word yet.</p><a href="/stroll">Stroll on</a></section>`}</div>
<div class="st-guide" data-st-guide-sheet hidden><div class="st-gcard"><button type="button" class="st-gx" data-st-gx aria-label="Close">${I.close}</button><p class="k">Look closer</p><div class="st-gt" data-st-gt></div><p class="st-gby" data-st-gby></p></div></div>
<p class="st-toast" data-st-toast hidden></p>
</main>
<script>window.__WM_STROLL=${JSON.stringify({ items, q, maker: maker ? maker.slug : '' }).replace(/</g, '\\u003c')};</script>
<script src="/static/stroll.js?v=${V.VER || ''}" defer></script>` });
}

module.exports = { mountStroll, strollPage };
