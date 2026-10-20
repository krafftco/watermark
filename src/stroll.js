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
    let where = "w.status='held'" + (app.locals.zone ? app.locals.zone.sql(req) : ''); if (not.length) { where += ` AND w.slug NOT IN (${not.map(() => '?').join(',')})`; params.push(...not); }
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
  // 'mine' (Will, 19 Oct: flip through your own gallery as beautifully as the archive, and get there fast): the
  // signed-in person's gallery, in collector order; private to them. A maker's own held work is 'studio'.
  function mine(req, key) {
    if (key === 'mine') {
      const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null; if (!b) return null;
      const v = setOf('gallery:' + b.code) || { works: [] };
      // Rembrandt's room first: a maker's own five-star work hangs in their gallery, then what they collect.
      let hand = []; try { hand = app.locals.ownHand ? app.locals.ownHand(b, req) : []; } catch (e) { hand = []; }
      const seen = new Set(); const works = [...hand, ...v.works].filter(w => !seen.has(w.slug) && seen.add(w.slug));
      return { label: 'Your gallery', href: '/yours', works };
    }
    if (key === 'studio') { const m = app.locals.accounts ? app.locals.accounts.makerOf(req) : null; if (!m) return null; const v = setOf('maker:' + m.handle); return v ? Object.assign({}, v, { label: 'Your work', href: '/account' }) : null; }
    return setOf(key);
  }
  function inSet(req, key, { seen = [], at = '', n = PAGE } = {}) {
    const v = mine(req, key); if (!v || !v.works.length) return null;
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
  // The doors beside the stroll (Will, 19 Oct: swipe left and right must bring you somewhere meaningful: into the Keys,
  // and from there your gallery and the collection; and into your wallet, as a maker or a collector, with a switch).
  // One answer per work, rendered for whoever is signed in: `keys` (the right-hand door) and `yours` (the left-hand).
  app.get('/stroll/side/:slug', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const w = db.prepare("SELECT w.*, m.name AS maker_name, m.handle AS maker_handle, m.portrait AS maker_portrait FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.slug=? AND w.status='held'").get(String(req.params.slug));
    const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null, m = app.locals.accounts ? app.locals.accounts.makerOf(req) : null;
    const K = app.locals.keys, B = app.locals.bench, R = app.locals.balcony, P = app.locals.pocket;
    const held = K ? K.holds(req) : {}; const kinds = Object.keys(held).filter(k => k !== 'house');
    const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
    const door = (href, kicker, title, line, img) => `<a class="sd-door" href="${esc(href)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}<span><small>${esc(kicker)}</small><b>${esc(title)}</b>${line ? `<i>${esc(line)}</i>` : ''}</span>${I.next || ''}</a>`;
    // The Keys' door.
    let keys = '';
    if (w) {
      const n = B ? B.count('work', w.id) : 0, ls = B ? B.lines('work', w.id).slice(0, 2) : [];
      const st = R ? R.state() : null; const open = st && st.open;
      keys = `<header class="sd-h sd-keys-h">${K && K.MARK ? K.MARK.mark : ''}<p>${kinds.length ? `You hold ${kinds.map(k => `the ${k}’s key, No. ${held[k].no}`).join(' and ')}.` : 'Keys are earned, never bought.'}</p></header>
<section class="sd-sec"><p class="k">Under this work</p><h3>The bench</h3>${ls.length ? `<ol class="sd-lines">${ls.map(l => `<li><b>${esc(l.name)}</b> ${esc(l.body.length > 140 ? l.body.slice(0, 137) + '…' : l.body)}</li>`).join('')}</ol>` : '<p class="sd-m">No one has spoken yet. Stand before it a minute, then sit.</p>'}<a class="sd-go" href="/bench/${esc(w.slug)}">${n ? `${n} line${n === 1 ? '' : 's'} · Sit on the bench` : 'Sit on the bench'} →</a></section>
<section class="sd-sec"><p class="k">The Keys’ room</p><h3>The balcony</h3><p class="sd-m">${open ? `Open now${st.present && st.present.n ? ` · ${st.present.n} here` : ''}${st.host ? ` · ${esc(st.host.name)} hosting` : ''}. Nothing said is kept.` : 'Opens at nine in the evening, New York time, and closes at midnight.'}</p><a class="sd-go" href="/balcony">${open ? 'Go up' : 'Look in'} →</a></section>
${(() => { const S = app.locals.season, nx = S ? S.next() : null; return nx ? `<section class="sd-sec sd-night"><p class="k">The season · next</p><h3><a href="/season/${esc(nx.slug)}">${esc(nx.title)}</a></h3><p class="sd-m">${esc(S.when(nx.at))}${nx.city ? ` · ${esc(nx.city)}` : ''}. In the real world. <a href="/season">The season →</a></p></section>` : `<section class="sd-sec sd-night"><p class="k">The season</p><p class="sd-m">The nights the house throws, in the real world. <a href="/season">The season</a> · <a href="/circle">The Circle</a></p></section>`; })()}
<div class="sd-doors">${door('/m/' + w.maker_handle, 'The maker', w.maker_name, 'Their page, their archive, their studio', w.maker_portrait ? '/portrait/' + w.maker_handle : '/img/' + w.slug + '/thumb')}${door(b ? '/yours' : '/signin?next=/yours', 'Yours', 'Your gallery', b ? 'What you hold, your walls, your papers' : 'Sign in to open it')}${door('/collection', 'The museum', 'The collection', 'Every work, the wings, the masterworks')}${door('/keys', 'The house', 'The Keys', 'The club, its rules, and the story since 1947')}</div>`;
    }
    // Your door: the wallet, as a maker or a collector.
    let yours = '';
    if (!b && !m) yours = `<header class="sd-h"><p class="k">Yours</p><h3>Your gallery, your wallet.</h3><p class="sd-m">Sign in and what you hold, your pocket and your walls are one swipe away.</p><a class="buy-btn" href="/signin?next=/stroll">Sign in</a></header>`;
    else {
      const bal = P && b ? P.balance(b) : 0, cash = P && b ? P.cashable(b) : 0;
      const pieces = b ? db.prepare("SELECT w.slug, w.title FROM licenses l JOIN works w ON w.id=l.work_id WHERE l.buyer_id=? AND l.status='active' AND w.status='held' ORDER BY l.id DESC LIMIT 6").all(b.id) : [];
      const nHeld = b ? db.prepare("SELECT COUNT(*) n FROM licenses WHERE buyer_id=? AND status='active'").get(b.id).n : 0;
      const walls = b ? db.prepare('SELECT COUNT(*) n FROM hangs WHERE buyer_id=?').get(b.id).n : 0;
      const basket = String((req.cookies && req.cookies.wm_bk) || '').split(',').filter(Boolean).length;
      const collector = `<div class="sd-pane" data-sd-as="collector">
<section class="sd-wallet"><p class="k">Your pocket</p><p class="sd-sum">${money(bal)}</p><p class="sd-m">${cash >= 100 ? `${money(cash)} earned, yours to cash out.` : 'One tap collects from it.'}</p><div class="sd-row"><a href="/yours?tab=settings#pocket">Top up</a>${cash >= 100 ? '<a href="/yours?tab=settings#pocket">Cash out</a>' : ''}</div></section>
<section class="sd-sec"><p class="k">Your gallery · ${nHeld}</p>${pieces.length ? `<a class="sd-stroll" href="/stroll?in=mine${w ? '' : ''}">${I.wave || ''}<b>Stroll your gallery</b><i>Your pieces, one at a time, edge to edge</i></a><div class="sd-th">${pieces.map(p => `<a href="/yours" title="${esc(p.title)}"><img src="/img/${esc(p.slug)}/thumb" alt=""></a>`).join('')}</div>` : '<p class="sd-m">Nothing yet. Collect what stops you.</p>'}<a class="sd-go" href="/yours">Open your gallery →</a></section>
<div class="sd-doors">${door('/yours?tab=walls', 'Yours', walls ? `${walls} wall${walls === 1 ? '' : 's'}` : 'Your walls', 'Hang what you love, show it')}${basket ? door('/basket', 'Yours', `Basket · ${basket}`, 'Collect them all at once') : ''}${door('/yours?tab=papers', 'Yours', 'Your papers', 'Licenses, certificates, the register')}${door('/collection', 'The museum', 'The collection', 'Every work, the wings, the masterworks')}</div></div>`;
      let maker = '';
      if (m) {
        const st = app.locals.payouts ? app.locals.payouts.statement(m) : null;
        const waiting = db.prepare("SELECT COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status='requested'").get(m.id).n;
        const nw = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status IN ('held','hidden')").get(m.id).n, np = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(m.id).n;
        const month = db.prepare("SELECT COALESCE(SUM(price_cents),0) s, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0 AND l.starts_at >= date('now','start of month')").get(m.id);
        maker = `<div class="sd-pane" data-sd-as="maker" hidden>
<section class="sd-wallet"><p class="k">Owed to you</p><p class="sd-sum">${money(st ? st.owed : 0)}</p><p class="sd-m">${month.n ? `${month.n} sale${month.n === 1 ? '' : 's'} this month, ${money(Math.round(month.s * (st ? st.pct : 85) / 100))} yours.` : 'No sales yet this month.'}${m.stripe_account ? '' : ' Add a bank to be paid.'}</p><div class="sd-row"><a href="/account/payouts">The statement</a>${m.stripe_account ? '' : '<a href="/account/payouts">Your bank</a>'}</div></section>
<div class="sd-doors">${door('/account/requests', 'Your desk', waiting ? `${waiting} waiting` : 'Requests', waiting ? 'Answer them in a minute each' : 'All clear')}${door('/account', 'Your studio', `${np} of ${nw} shown`, 'The edit is the work')}${door('/account/upload', 'The vault', 'Add work', 'Put work in')}${door('/m/' + m.handle, 'Your page', m.name, 'As the house shows you')}</div></div>`;
      }
      yours = `<header class="sd-h"><p class="k">Yours</p><h3>${esc((m && m.name) || (b && b.name) || 'Your wallet')}</h3>${m ? `<div class="sd-sw" role="tablist"><button type="button" data-sd-switch="collector" aria-selected="true">Collector</button><button type="button" data-sd-switch="maker" aria-selected="false">Maker</button></div>` : ''}</header>${collector}${maker}`;
    }
    res.json({ keys, yours });
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
  const BUNCH = (() => { try { return require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'keys', 'bunch.svg'), 'utf8').replace('<svg ', '<svg class="kmk kmk-bunch" aria-hidden="true" '); } catch (e) { return I.key || ''; } })();
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
<button type="button" class="st-tab st-tab-l" data-st-doors="yours" aria-label="Yours: your gallery and your wallet">${I.collect}<span>Yours</span></button><button type="button" class="st-tab st-tab-r" data-st-doors="keys" aria-label="The Keys">${BUNCH}<span>The Keys</span></button>
<aside class="st-side st-side-l" data-st-side="yours" aria-label="Yours"><div class="sdr" data-sd-body></div></aside><aside class="st-side st-side-r" data-st-side="keys" aria-label="The Keys"><div class="sdr" data-sd-body></div></aside><div class="st-shade" data-st-shade hidden></div>
<div class="st-sitbar" data-st-sitbar hidden><button type="button" data-st-stand>Stand up</button></div>
<p class="st-stay" data-st-stay hidden>Stay with this one.</p>
</main>
<script>window.__WM_STROLL=${JSON.stringify({ items, q, maker: maker ? maker.slug : '', set }).replace(/</g, '\\u003c')};</script>
<script src="/static/stroll.js?v=${V.VER || ''}" defer></script><script src="/static/eye.js?v=${V.VER || ''}" defer></script>` });
}

module.exports = { mountStroll, strollPage };
