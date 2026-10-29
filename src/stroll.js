// The stroll (Will, 17 Oct: seeing photographs has to be as easy as Instagram, and as hard to put down, but the
// photographs have to be the most beautiful in the world). Watermark on a phone as a full-screen vertical scroll:
// one photograph fills the screen on the dark wall; a swipe brings the next; it never repeats what you have seen;
// the best work comes first and what you stand before shapes what comes next. Double-tap zooms in; the hat is on the rail. A rail
// of acts on the right; a plate at the foot; a search up top to stroll through one place or one maker.
const { esc } = require('./views');

const I = require('./icons');
function mountStroll(app, { db, V, wanderJSON, I }) {
  const PAGE = 8;
  // What comes next: never what this stroll has shown (up to 300 slugs carried by the client), the best first with a
  // little chance in it, and when there is a word, only what matches it (place, title, maker, keywords).
  const makerBy = key => { if (!key) return null; const all = db.prepare('SELECT * FROM makers').all(); return all.find(m => m.handle === key) || all.find(m => V.makerSlug(m) === key) || null; };
  const POOL = new Map(); app.locals.wanderPoolDirty = () => POOL.clear();
  function next(req, { seen = [], q = '', maker = '', n = PAGE } = {}) {
    const not = seen.slice(-300); const params = [];
    let where = "w.status='held'" + (app.locals.zone ? app.locals.zone.sql(req) : '') + (!q && !maker && app.locals.editSql ? app.locals.editSql('w') : ''); if (not.length) { where += ` AND w.slug NOT IN (${not.map(() => '?').join(',')})`; params.push(...not); }
    if (q) { const like = `%${q.replace(/[%_]/g, '')}%`; where += ' AND (w.title LIKE ? OR w.place LIKE ? OR w.keywords LIKE ? OR m.name LIKE ?)'; params.push(like, like, like, like); }
    const mk = makerBy(maker); if (mk) { where += ' AND w.maker_id=?'; params.push(mk.id); }
    // The open wander draws from a pool kept a minute (28 Oct, for an audience): the held works with their weights, picked
    // at random here rather than sorted by the database for every page; a word, a maker or the adult rooms open still ask.
    let rows;
    if (!q && !mk) {
      const sql = where.replace(/ AND w\.slug NOT IN \([^)]*\)/, ''); const pk = sql + '#' + (db.prepare('SELECT MAX(seq) s FROM ledger').get().s || 0); let pool = POOL.get(pk); // any entry on the register (a work published, held back) makes the pool new
      if (!pool || Date.now() - pool.at > 60e3) { pool = { at: Date.now(), rows: db.prepare(`SELECT w.* FROM works w JOIN makers m ON m.id=w.maker_id WHERE ${sql}`).all() }; POOL.set(pk, pool); if (POOL.size > 20) POOL.delete(POOL.keys().next().value); }
      const notSet = new Set(not); const cands = pool.rows.filter(r => !notSet.has(r.slug)).map(r => ({ r, k: (r.curated ? 4 : r.stars >= 4 ? 3 : r.stars >= 3 ? 1.5 : 1) * (0.5 + Math.random()) }));
      cands.sort((x, y) => y.k - x.k); rows = cands.slice(0, n).map(x => x.r);
    }
    else rows = db.prepare(`SELECT w.* FROM works w JOIN makers m ON m.id=w.maker_id WHERE ${where} ORDER BY (CASE WHEN w.curated=1 THEN 4 WHEN w.stars>=4 THEN 3 WHEN w.stars>=3 THEN 1.5 ELSE 1 END) * (0.5 + RANDOM() / 18446744073709551616.0 + 0.5) DESC LIMIT ?`).all(...params, n);
    // For you: when the house knows what held this visitor, a few of the eye's picks are set among the rest.
    let picks = [];
    if (!q && !mk && app.locals.looking && app.locals.buyerOf) {
      try { const b = app.locals.buyerOf(req), v = req.cookies && req.cookies.wm_v; if (b || v) { const c = app.locals.looking.candidates(b, v, 24, 8); const notSet = new Set(not); picks = c.picks.filter(x => !notSet.has(x.slug) && !rows.find(r => r.slug === x.slug)).slice(0, 3).map(x => db.prepare('SELECT * FROM works WHERE id=?').get(x.id)).filter(Boolean); } } catch (e) { picks = []; }
    }
    const out = []; let pi = 0;
    for (let i = 0; i < rows.length && out.length < n; i++) { if (pi < picks.length && i % 3 === 1) out.push(picks[pi++]); out.push(rows[i]); }
    while (pi < picks.length && out.length < n) out.push(picks[pi++]);
    const items = out.slice(0, n).map(w => wanderJSON(w, req));
    // Wander across everything (Will, 24 Oct, after StumbleUpon): in the open wander, every sixth screen or so is a
    // page from the shelf, a chapter's opening set on the wall, with Read on. Never in a set, a word or a maker's walk.
    if (!q && !mk && items.length >= 4) { const t = Math.random() < 0.6 ? textScreen(seen) : recordScreen(seen); if (t) items.splice(3 + Math.floor(Math.random() * Math.min(3, items.length - 3)), 0, t); }
    return items;
  }
  // A page from the shelf: a public book with a body, a chapter at random, its first paragraphs.
  const byName = a => { const x = String(a || '').trim(); const m = x.match(/^([^,]+),\s*([^,(]+)(.*)$/); return m ? `${m[2].trim()} ${m[1].trim()}` : x; };
  const CLOTH = ['#2f4a3a', '#5a1f22', '#23304d', '#6b4b2a', '#8a7a52', '#3b4a5a', '#4a3350', '#7a5a2a']; const hashOf = x => { let h = 7; for (const ch of String(x)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  // A record from the Listening Room (Will, 24 Oct: Wander across everything): the disc on the wall, one side to play here.
  function recordScreen(seen) {
    let r; try { r = db.prepare("SELECT slug, title, performer, composer, year, line, files, cover_slug, cover_url FROM recordings WHERE status='playing' ORDER BY RANDOM() LIMIT 1").get(); } catch (e) { return null; }
    if (!r) return null; const slug = `r:${r.slug}`; if (seen.includes(slug)) return null;
    let files = []; try { files = JSON.parse(r.files || '[]'); } catch (e) { /* */ } if (!files.length) return null;
    const img = r.cover_slug ? `/img/${r.cover_slug}/screen` : r.cover_url || `/listening/${encodeURIComponent(r.slug)}/label.svg`;
    return { kind: 'record', slug, record: r.slug, title: r.title, by: r.performer || r.composer || '', composer: r.composer && r.composer !== r.performer ? r.composer : '', year: r.year || '', line: r.line || '', img, url: files[0].url, side: files[0].title || 'Side A', href: `/listening/${r.slug}?play=1`, n: files.length };
  }
  // The shelf is read once in five minutes (28 Oct, for an audience: each feed page had sorted every book at random and
  // read a whole body); one book's chapters are cut once and kept, the first two hundred books at a time.
  const SHELF = { at: 0, ids: [] }; const CHAPTERS = new Map();
  function shelfBook() {
    if (Date.now() - SHELF.at > 300e3) { try { SHELF.ids = db.prepare("SELECT t.id FROM texts t WHERE t.status='held' AND t.public=1 AND t.kind IN ('book','essay') AND t.body IS NOT NULL AND length(t.body) > 3000").all().map(r => r.id); } catch (e) { SHELF.ids = []; } SHELF.at = Date.now(); }
    if (!SHELF.ids.length) return null;
    const id = SHELF.ids[Math.floor(Math.random() * SHELF.ids.length)]; const kept = CHAPTERS.get(id); if (kept && Date.now() - kept.at < 3600e3) return kept;
    const t = db.prepare("SELECT t.slug, t.title, t.author, t.body, w.slug AS cover FROM texts t LEFT JOIN works w ON w.id=t.cover_work_id WHERE t.id=?").get(id); if (!t) return null;
    const chs = []; let cur = { head: null, paras: [] };
    for (const p of String(t.body).split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) { if (/^##?\s/.test(p)) { if (cur.head || cur.paras.length) chs.push(cur); cur = { head: p.replace(/^#+\s*/, ''), paras: [] }; } else if (p !== '* * *') cur.paras.push(p); }
    if (cur.head || cur.paras.length) chs.push(cur);
    const good = chs.map((c, i) => ({ head: c.head, paras: c.paras.slice(0, 6), i })).filter(c => c.paras.join(' ').length > 400);
    const out = { at: Date.now(), t: { slug: t.slug, title: t.title, author: t.author, cover: t.cover }, chs: good, n: chs.length };
    CHAPTERS.set(id, out); if (CHAPTERS.size > 200) CHAPTERS.delete(CHAPTERS.keys().next().value); return out;
  }
  app.locals.shelfDirty = () => { SHELF.at = 0; CHAPTERS.clear(); };
  function textScreen(seen) {
    const book = shelfBook(); if (!book) return null; const { t, chs, n } = book;
    const good = chs; if (!good.length) return null;
    const c = good[Math.floor(Math.random() * good.length)]; const slug = `t:${t.slug}:${c.i}`; if (seen.includes(slug)) return null;
    const ex = []; let len = 0; for (const p of c.paras) { if (len > 520) break; ex.push(p); len += p.length; }
    return { kind: 'text', slug, book: t.slug, title: t.title, author: byName(t.author), cloth: CLOTH[(hashOf(t.title || t.slug) >>> 7) % CLOTH.length], head: c.head || null, c: c.i, excerpt: ex.map(p => p.replace(/\*([^*\n]{1,200}?)\*/g, '$1')), href: `/read/${t.slug}?c=${c.i}`, cover: t.cover ? `/img/${t.cover}/screen` : null, n };
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
    if (key === 'following') return app.locals.museums ? app.locals.museums.set(req) : null; // 29 Oct: what the people you follow did lately
    if (key === 'studio') { const m = app.locals.accounts ? app.locals.accounts.makerOf(req) : null; if (!m) return null; const v = setOf('maker:' + m.handle); return v ? Object.assign({}, v, { label: 'Your work', href: '/account' }) : null; }
    // A delivery (Will, 21 Oct: the friend wanders the album as one wanders the house; the work stays the maker's):
    // the album's photographs, held or kept back, in the album's order, for as long as the link is live.
    if (key.startsWith('delivery:')) return app.locals.deliveries && app.locals.deliveries.set ? app.locals.deliveries.set(key.slice(9)) : null;
    return setOf(key);
  }
  const isDelivery = key => String(key || '').startsWith('delivery:');
  function inSet(req, key, { seen = [], at = '', n = PAGE } = {}) {
    const v = mine(req, key); if (!v || !v.works.length) return null;
    const slugs = v.works.map(w => w.slug), not = new Set(seen);
    let i = slugs.indexOf(at || seen[seen.length - 1]); if (i < 0) i = -1;
    const out = [];
    for (let k = 1; k <= slugs.length && out.length < n; k++) { const sl = slugs[(i + k) % slugs.length]; if (!not.has(sl) && sl !== at) { out.push(sl); not.add(sl); } }
    const rows = out.map(sl => db.prepare(isDelivery(key) ? "SELECT * FROM works WHERE slug=? AND status IN ('held','hidden')" : "SELECT * FROM works WHERE slug=? AND status='held'").get(sl)).filter(Boolean);
    return { label: v.label, href: v.href, n: slugs.length, via: v.via || null, items: rows.map(w => wanderJSON(w, req)) };
  }
  app.get('/api/stroll', (req, res) => {
    const seen = String(req.query.seen || '').split(',').filter(Boolean);
    const q = String(req.query.q || '').trim().slice(0, 60), maker = String(req.query.maker || '').slice(0, 60);
    const n = Math.max(1, Math.min(16, parseInt(req.query.n, 10) || PAGE));
    if (req.query.in === 'shelf') { const CP = app.locals.commonplace; const items = CP ? CP.passages(seen, n) : []; return res.set('Cache-Control', 'no-store').json({ items, end: items.length < n, label: 'The shelf', href: '/library' }); }
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
${(() => { const S = app.locals.season, nx = S ? S.next() : null; return nx ? `<section class="sd-sec sd-night"><p class="k">The season · next</p><h3><a href="/season/${esc(nx.slug)}">${esc(nx.title)}</a></h3><p class="sd-m">${esc(S.when(nx.at))}${nx.city ? ` · ${esc(nx.city)}` : ''}. In the real world. <a href="/season">The season →</a></p></section>` : `<section class="sd-sec sd-night"><p class="k">The season</p><p class="sd-m">The nights the house throws, in the real world. <a href="/season">The season</a> · <a href="/club">The Club</a></p></section>`; })()}
<div class="sd-doors">${door('/m/' + w.maker_handle, 'The maker', w.maker_name, 'Their page, their archive, their studio', w.maker_portrait ? '/portrait/' + w.maker_handle : '/img/' + w.slug + '/thumb')}${door(b ? '/yours' : '/signin?next=/yours', 'Yours', 'Your gallery', b ? 'What you hold, your walls, your papers' : 'Sign in to open it')}${door('/collection', 'The museum', 'The collection', 'Every work, the wings, the masterworks')}${door('/keys', 'The house', 'The Keys', 'The club, its rules, and the story since 1947')}</div>`;
    }
    // Your door: the wallet, as a maker or a collector.
    let yours = '';
    if (!b && !m) yours = `<header class="sd-h"><p class="k">Yours</p><h3>Your gallery, your wallet.</h3><p class="sd-m">Sign in and what you hold, your pocket and your walls are one swipe away.</p><a class="buy-btn" href="/signin?next=/wander">Sign in</a></header>`;
    else {
      const bal = P && b ? P.balance(b) : 0, cash = P && b ? P.cashable(b) : 0;
      const pieces = b ? db.prepare("SELECT w.slug, w.title FROM licenses l JOIN works w ON w.id=l.work_id WHERE l.buyer_id=? AND l.status='active' AND w.status='held' ORDER BY l.id DESC LIMIT 6").all(b.id) : [];
      const nHeld = b ? db.prepare("SELECT COUNT(*) n FROM licenses WHERE buyer_id=? AND status='active'").get(b.id).n : 0;
      const walls = b ? db.prepare('SELECT COUNT(*) n FROM hangs WHERE buyer_id=?').get(b.id).n : 0;
      const basket = String((req.cookies && req.cookies.wm_bk) || '').split(',').filter(Boolean).length;
      const collector = `<div class="sd-pane" data-sd-as="collector">
<section class="sd-wallet"><p class="k">Your pocket</p><p class="sd-sum">${money(bal)}</p><p class="sd-m">${cash >= 100 ? `${money(cash)} earned, yours to cash out.` : 'One tap collects from it.'}</p><div class="sd-row"><a href="/yours?tab=settings#pocket">Top up</a>${cash >= 100 ? '<a href="/yours?tab=settings#pocket">Cash out</a>' : ''}</div></section>
<section class="sd-sec"><p class="k">Your gallery · ${nHeld}</p>${pieces.length ? `<a class="sd-stroll" href="/wander?in=mine${w ? '' : ''}">${I.wave || ''}<b>Wander your gallery</b><i>Your pieces, one at a time, edge to edge</i></a><div class="sd-th">${pieces.map(p => `<a href="/yours" title="${esc(p.title)}"><img src="/img/${esc(p.slug)}/thumb" alt=""></a>`).join('')}</div>` : '<p class="sd-m">Nothing yet. Collect what stops you.</p>'}<a class="sd-go" href="/yours">Open your gallery →</a></section>
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
    // The house, from inside Wander (Will, 26 Oct: "you have to be able to access Read and Listen"): the five verbs at the top of the Yours door.
    let reading = 0; try { reading = b ? db.prepare("SELECT COUNT(*) n FROM reading_list WHERE buyer_id=? AND status='reading'").get(b.id).n : 0; } catch (e) { reading = 0; }
    const verbs = `<nav class="sd-verbs" aria-label="The house">${[
      ...(() => { const F = app.locals.museums; const n = F && F.meOf(req) ? F.followed(req).length : 0; return [n ? ['/wander?in=following', 'Look', `Following · ${n}`, I.wave || ''] : ['/wander', 'Look', 'Wander everything', I.wave || '']]; })(),
      [reading ? '/yours/reading' : '/wander?in=shelf', 'Read', reading ? `${reading} book${reading === 1 ? '' : 's'} open` : 'Wander the shelf', I.facing || I.page || ''],
      ['/listening', 'Listen', 'The Listening Room', I.play || ''],
      ['/collection', 'Collect', 'The collection', I.collect || ''],
      [m ? '/account' : '/makers', 'Make', m ? 'Your studio' : 'For those who make', I.pencil || I.plus || '']
    ].map(([h, v, l, ic]) => `<a href="${h}"><span class="sd-vi">${ic}</span><b>${v}</b><i>${esc(l)}</i></a>`).join('')}</nav>`;
    yours = yours.replace(/<\/header>/, '</header>' + verbs);
    res.json({ keys, yours });
  });

  // The old address: one word, Wander (Will, 21 Oct). Links in the wild and the app's cache still say /stroll.
  app.get('/stroll', (req, res) => res.redirect(301, '/wander' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));
  // The front door is Wander (Will, 26 Oct, the Jobs cut: one name on the door; `/` opens on the picture; the page
  // about the house is /house). A tenant's `/` was rewritten to its maker's page before this.
  // A stranger's first page of Wander is built once every fifteen seconds (28 Oct, for an audience); anyone the house knows is built fresh.
  const brief = h => (req, res, next) => (app.locals.minute ? app.locals.minute(h, 15e3) : h)(req, res, next);
  app.get('/', brief((req, res) => wander(req, res, { front: true })));
  app.get('/wander', brief((req, res) => wander(req, res, {})));
  function wander(req, res, { front = false }) {
    const q = String(req.query.q || '').trim().slice(0, 60), maker = String(req.query.maker || '').slice(0, 60);
    const key = String(req.query.in || '').slice(0, 80);
    const at = req.query.at ? db.prepare(isDelivery(key) ? "SELECT * FROM works WHERE slug=? AND status IN ('held','hidden')" : "SELECT * FROM works WHERE slug=? AND status='held'").get(String(req.query.at)) : null;
    // The readers' feed (Will, 27 Oct): Wander, for words. One passage a screen, on the paper.
    if (key === 'shelf') { const CP = app.locals.commonplace; const items = CP ? CP.passages([], 6) : []; res.set('Cache-Control', 'private, no-store'); return res.send(strollPage({ items, set: { key, label: 'The shelf', href: '/library', n: 0, via: null }, I, front, shelf: true })); }
    const set = key ? inSet(req, key, { at: at ? at.slug : '', n: 6 }) : null;
    if (isDelivery(key) && !set) return res.redirect('/deliver/' + encodeURIComponent(key.slice(9))); // closed, or not an album: its own door says so
    let items = set ? set.items : next(req, { q, maker, n: 6, seen: at ? [at.slug] : [] });
    if (at) items = [wanderJSON(at, req), ...items];
    const mk = set ? null : makerBy(maker);
    res.set('Cache-Control', 'private, no-store');
    res.send(strollPage({ items, q: set ? '' : q, maker: mk ? { name: mk.name, slug: V.makerSlug(mk) } : null, set: set ? { key, label: set.label, href: set.href, n: set.n, via: set.via || null } : null, I , front }));
  }
}

// The page: the first photographs are in the HTML, so the stroll begins the instant it opens; the script carries on.
function strollPage({ items, q = '', maker = null, set = null, I, front = false, shelf = false }) {
  const V = require('./views');
  const BUNCH = (() => { try { return require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'keys', 'bunch.svg'), 'utf8').replace('<svg ', '<svg class="kmk kmk-bunch" aria-hidden="true" '); } catch (e) { return I.key || ''; } })();
  const bookObj = w => `<a class="st-bk${w.cover ? '' : ' st-bound'}" href="/read/${esc(w.book)}"><img src="${esc(w.cover || `/binding/${encodeURIComponent(w.book)}.svg`)}" alt=""><span class="bk3-e"></span></a>`;
  const recordCard = w => `<section class="st-i st-rec" data-slug="${esc(w.slug)}" data-kind="record"><article class="st-rc"><a class="st-rdisc" href="${esc(w.href)}"><img src="${esc(w.img)}" alt="" loading="lazy"></a><p class="k">From the Listening Room</p><h2>${esc(w.title)}</h2><p class="st-rby">${esc(w.by)}${w.composer ? ` · ${esc(w.composer)}` : ''}${w.year ? ` · ${esc(w.year)}` : ''}</p>${w.line ? `<p class="st-rline">${esc(w.line)}</p>` : ''}<div class="st-racts"><button type="button" class="st-rplay" data-st-rplay data-src="${esc(w.url)}">${I.play}${I.pause}<span>Play ${esc(w.side)}</span></button><a class="st-rgo" href="${esc(w.href)}">Into the room${w.n > 1 ? ` · ${w.n} sides` : ''}</a></div></article></section>`;
  const textCard = w => w.passage
    ? `<section class="st-i st-txt st-pas" data-slug="${esc(w.slug)}" data-kind="text"><article class="st-tx"><p class="k">A passage</p><div class="st-txb st-pasb">${w.excerpt.map(p => `<p>${esc(p)}</p>`).join('')}</div><p class="st-pasrc">— ${w.author ? `${esc(w.author)}, ` : ''}<i>${esc(w.title)}</i>${w.head ? `<span>${esc(w.head)}</span>` : ''}</p><div class="st-pasfoot">${bookObj(w)}<div><a class="st-txgo" href="${esc(w.href)}">Open the book here</a><p class="st-txacts"><button type="button" data-st-cp title="Keep it in your commonplace book: passages copied out of what you read, in your own hand">${I.plus}<span>Keep</span></button><button type="button" data-st-share title="Send the passage to someone, on its card">${I.share}<span>Share</span></button></p></div></div></article></section>`
    : `<section class="st-i st-txt" data-slug="${esc(w.slug)}" data-kind="text">${bookObj(w)}<article class="st-tx"><p class="k">From the shelf</p><h2>${esc(w.title)}</h2>${w.author ? `<p class="st-txa">${esc(w.author)}</p>` : ''}${w.head ? `<p class="st-txh">${esc(w.head)}</p>` : ''}<div class="st-txb">${w.excerpt.map(p => `<p>${esc(p)}</p>`).join('')}</div><a class="st-txgo" href="${esc(w.href)}">Read on${w.n ? ` · ${w.n} chapters` : ''}</a><p class="st-txacts"><button type="button" data-st-keep title="Keep it on your shelf: among your books, to read when you like">${I.plus}<span>Keep</span></button><button type="button" data-st-share title="Send the book to someone">${I.share}<span>Share</span></button></p></article></section>`;
  const card = (w, i) => w.kind === 'text' ? textCard(w) : w.kind === 'record' ? recordCard(w) : `<section class="st-i" data-slug="${esc(w.slug)}">
<img class="st-im" src="${esc(w.img)}" alt="${esc(w.title)}" draggable="false" decoding="async"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}>
<div class="st-plate"><a class="st-by" href="/wander?maker=${esc(w.makerSlug)}&at=${esc(w.slug)}" data-st-maker>${esc(w.maker)}</a><a class="st-t" href="/m/${esc(w.makerSlug)}/${esc(w.slug)}?from=wander">${esc(w.title)}</a><span class="st-k">${w.place ? `<a href="/wander?q=${encodeURIComponent(w.place)}">${esc(w.place)}</a>` : ''}${w.place && w.year ? ' · ' : ''}${esc(w.year || '')}</span><a class="st-tog" href="/m/${esc(w.makerSlug)}/${esc(w.slug)}?from=wander" title="Watermark: the asset under the picture; its number, its terms, its papers, the licence to use it"><b>${I.wave}Wander</b><span>${I.shield}Watermark</span></a></div>
<button type="button" class="st-eye" data-eye="${esc(w.slug)}" aria-label="The Watermark: the asset, its number, its terms">${I.shield}</button>
<nav class="st-rail" aria-label="Acts">
<button type="button" class="st-b" data-st-hat aria-pressed="${w.hat && w.hat.mine ? 'true' : 'false'}" title="Hat: a nod, I saw it. Free, as many as you like.">${I.hat}<span data-st-hat-n>Hat</span></button><button type="button" class="st-b st-bv" data-st-bravo aria-pressed="${w.bravo && w.bravo.mine ? 'true' : 'false'}" title="Bravo: it floored me. Three a month.">${I.bravo}<span>Bravo</span></button>
<button type="button" class="st-b" data-st-hang title="Save it to a wall of yours, like a pin. Find it again in Yours.">${I.hang}<span>Save</span></button>
<button type="button" class="st-b" data-st-share title="Send it to someone.">${I.send}<span>Share</span></button>
<button type="button" class="st-b st-moreb" data-st-more aria-expanded="false" aria-label="More">${I.more}<span>More</span></button>
<div class="st-more" data-st-morebox hidden><a class="st-b" data-st-record href="/m/${esc(w.makerSlug)}/${esc(w.slug)}?from=wander" title="Watermark: the asset under the picture; its number, its terms, the licence to use it.">${I.page}<span>Watermark</span></a>${w.guide ? `<button type="button" class="st-b" data-st-guide title="Look closer: what to see in it, read by Al.">${I.guide}<span>Look closer</span></button>` : ''}<a class="st-b" data-st-easel href="/draw/from/${esc(w.slug)}?back=${encodeURIComponent(`/wander?at=${w.slug}`)}" title="Draw it: the picture alone, with the easel's tools.">${I.pencil}<span>Draw</span></a><button type="button" class="st-b" data-st-card title="A thank-you card to the maker, from 99¢.">${I.card}<span>Thank</span></button><button type="button" class="st-b" data-st-settings title="Sit a while: each work held a minute and a half, the guide read, quiet music.">${I.stand}<span>Sit</span></button></div>
${w.held ? `<span class="st-b st-held">${I.collect}<span>Yours</span></span>` : w.collect ? `<button type="button" class="st-b st-buy" data-st-buy data-url="${esc(w.collect.url)}" data-pocket="${w.collect.pocket ? 1 : 0}" title="Collect it: yours to keep, numbered, with the papers. ${esc(w.collect.price)}.">${I.collect}<span>Collect<b>${esc(w.collect.price)}</b></span><em>Yours to keep</em></button>` : ''}
</nav>
<div class="st-hat-fly" aria-hidden="true">${I.hat}</div>
</section>`;
  return V.layout({ title: front ? 'Watermark · Where great work is kept' : `${q ? `${V.tidy(q)} · ` : ''}Wander · Watermark`, desc: front ? 'Makers keep their work here. Anyone can own a piece of it. Wander: the finest work, one at a time, edge to edge.' : 'Watermark on a phone: the finest work, one at a time, edge to edge. Swipe for the next.', path: front ? '/' : '/wander', bare: true, image: items[0] ? items[0].img : null, body: `<main class="st${front ? ' st-front' : ''}" data-stroll${front ? ' data-front="1"' : ''} data-q="${esc(q)}" data-maker="${esc(maker ? maker.slug : '')}">
<header class="st-top"><a class="st-home" href="${front ? '/house' : '/'}" aria-label="Watermark">${V.WAVE_MARK || ''}<span>Watermark</span></a>${maker ? `<a class="st-chip" href="/wander" title="Everything again">${esc(maker.name)}<i>${I.close}</i></a>` : ''}${set ? `<a class="st-chip st-set" href="${esc(set.href)}" title="Back to ${esc(set.label)}">${esc(set.label)}<i>${I.close}</i></a>` : ''}${q && !maker && !set ? `<a class="st-chip" href="/wander" title="Everything again">${esc(q)}<i>${I.close}</i></a>` : ''}<span class="st-sp"></span><button type="button" class="st-gon" data-find-open="stroll" aria-label="Find" title="Find a work, a place, a maker: straight to it">${I.find || I.eye}<span>Find</span></button><a class="st-x" href="${set ? esc(set.href) : front ? '/house' : '/collection'}" aria-label="Close" data-st-close>${I.close}</a></header>
<div class="st-sheet st-ss" data-st-ssheet hidden><div class="st-scard"><button type="button" class="st-gx" data-st-sx2 aria-label="Close">${I.close}</button><p class="k">Settings</p>
<button type="button" class="st-sit1" data-st-sit aria-pressed="false">${I.stand}<b>Sit a while</b><span>Each work held a minute and a half, the guide read, quiet music. Tap again to stand.</span></button>
<p class="st-skeys">Keys: arrows or space move · H hat · B bravo · S hang · G guide · C collect · Esc leaves.</p></div></div>
<button type="button" class="st-hld" data-st-held hidden title="Release (L or Esc)">${I.full}<b>Held</b><span data-st-heldfs>full screen</span><i>${I.close}</i></button>
<div class="st-scroll" data-st-scroll>${items.map(card).join('')}${items.length ? '' : `<section class="st-i st-none"><p>Nothing by that word yet.</p><a href="/wander">Wander on</a></section>`}</div>
<div class="st-guide" data-st-guide-sheet hidden><div class="st-gcard"><button type="button" class="st-gx" data-st-gx aria-label="Close">${I.close}</button><p class="k st-wil">${I.wilhelm}Look closer &middot; Al</p>${V.GUIDE_SWITCH || ''}<div class="st-gt" data-st-gt></div><p class="st-gby" data-st-gby></p></div></div>
${front ? `<div class="st-hello" data-st-hello><p>Makers keep their work here. Anyone can own a piece of it.</p><a href="/house">What this is &rarr;</a></div>` : ''}<p class="st-toast" data-st-toast hidden></p>${['find','close','next','wave','wilhelm'].map(k => `<template data-ic="${k}">${I[k]}</template>`).join('')}
<button type="button" class="st-tab st-tab-l" data-st-doors="yours" aria-label="Yours: your gallery and your wallet">${I.collect}<span>Yours</span></button><button type="button" class="st-tab st-tab-r" data-st-doors="keys" aria-label="The Keys">${BUNCH}<span>The Keys</span></button>
<aside class="st-side st-side-l" data-st-side="yours" aria-label="Yours"><div class="sdr" data-sd-body></div></aside><aside class="st-side st-side-r" data-st-side="keys" aria-label="The Keys"><div class="sdr" data-sd-body></div></aside><div class="st-shade" data-st-shade hidden></div>
<template data-st-ic="wave">${I.wave}</template><template data-st-ic="play">${I.play}</template><template data-st-ic="pause">${I.pause}</template><template data-st-ic="plus">${I.plus}</template><template data-st-ic="share">${I.share}</template>
<div class="st-sitbar" data-st-sitbar hidden><button type="button" data-st-stand>Stand up</button></div>
<p class="st-stay" data-st-stay hidden>Stay with this one.</p>
<p class="st-swipe" data-st-swipe hidden><span>Swipe up for the next</span><i></i></p>
</main>
<script>window.__WM_STROLL=${JSON.stringify({ items, q, maker: maker ? maker.slug : '', set }).replace(/</g, '\\u003c')};</script>
<script src="/static/stay.js?v=${V.VER || ''}" defer></script><script src="/static/stroll.js?v=${V.VER || ''}" defer></script><script src="/static/eye.js?v=${V.VER || ''}" defer></script>` });
}

module.exports = { mountStroll, strollPage };
