// The stroll (Will, 17 Oct: seeing photographs has to be as easy as Instagram, and as hard to put down, but the
// photographs have to be the most beautiful in the world). Watermark on a phone as a full-screen vertical scroll:
// one photograph fills the screen on the dark wall; a swipe brings the next; it never repeats what you have seen;
// the best work comes first and what you stand before shapes what comes next. Double-tap zooms in; the hat is on the rail. A rail
// of acts on the right; a plate at the foot; a search up top to stroll through one place or one maker.
const { esc } = require('./views');

const I = require('./icons');
let HOUSE = null; // the app, for the page's screens (strollPage is outside the mount)
function mountStroll(app, { db, V, wanderJSON, I }) {
  HOUSE = app;
  const PAGE = 8;
  // What comes next: never what this stroll has shown (up to 300 slugs carried by the client), the best first with a
  // little chance in it, and when there is a word, only what matches it (place, title, maker, keywords).
  const makerBy = key => { if (!key) return null; const all = db.prepare('SELECT * FROM makers').all(); return all.find(m => m.handle === key) || all.find(m => V.makerSlug(m) === key) || null; };
  const POOL = new Map(); app.locals.wanderPoolDirty = () => POOL.clear();
  function next(req, { seen = [], q = '', maker = '', n = PAGE } = {}) {
    const not = seen.slice(-300); const params = [];
    let where = "w.status='held'" + (app.locals.zone ? app.locals.zone.sql(req) : '') + (!q && !maker && app.locals.editSql ? app.locals.editSql('w') : ''); if (not.length) { where += ` AND w.slug NOT IN (${not.map(() => '?').join(',')})`; params.push(...not); }
    if (q) { const like = `%${q.replace(/[%_]/g, '')}%`; where += " AND (w.title LIKE ? OR w.place LIKE ? OR w.keywords LIKE ? OR m.name LIKE ? OR w.taken_at LIKE ? OR EXISTS (SELECT 1 FROM artists a WHERE a.id=w.artist_id AND (a.name LIKE ? OR a.movement LIKE ?)))"; params.push(like, like, like, like, `${q.replace(/[%_]/g, '')}%`, like, like); } // a word, a maker, an artist, a movement or a year (5 Nov)
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
    if (!q && !mk && items.length >= 4) { const r0 = Math.random(); let t = null; try { t = (r0 < 0.3 && app.locals.sheets && process.env.SHEETS_IN_WANDER === '1' ? app.locals.sheets.screen(seen) : null) || (r0 < 0.65 ? textScreen(seen) : recordScreen(seen)); } catch (e) { screenFault(e); } if (t) items.splice(3 + Math.floor(Math.random() * Math.min(3, items.length - 3)), 0, t); }
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
    if (Date.now() - SHELF.at > 300e3) { try { SHELF.ids = db.prepare("SELECT t.id FROM texts t WHERE t.status='held' AND t.public=1 AND COALESCE(t.subscribers_only,0)=0 AND t.kind IN ('book','essay') AND t.body IS NOT NULL AND length(t.body) > 3000").all().map(r => r.id); } catch (e) { SHELF.ids = []; } SHELF.at = Date.now(); }
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
    if (key.startsWith('album:')) return app.locals.deliveries && app.locals.deliveries.set ? app.locals.deliveries.set(key.slice(6), true, req) : null;
    return setOf(key);
  }
  const isDelivery = key => /^(delivery|album):/.test(String(key || ''));
  function inSet(req, key, { seen = [], at = '', n = PAGE } = {}) {
    const v = mine(req, key); if (!v || !v.works.length) return null;
    const slugs = v.works.map(w => w.slug), not = new Set(seen);
    let i = slugs.indexOf(at || seen[seen.length - 1]); if (i < 0) i = -1;
    const out = [];
    for (let k = 1; k <= slugs.length && out.length < n; k++) { const sl = slugs[(i + k) % slugs.length]; if (!not.has(sl) && sl !== at) { out.push(sl); not.add(sl); } }
    const rows = out.map(sl => db.prepare(isDelivery(key) ? "SELECT * FROM works WHERE slug=? AND status IN ('held','hidden')" : "SELECT * FROM works WHERE slug=? AND status='held'").get(sl)).filter(Boolean);
    return { label: v.label, href: v.href, n: slugs.length, via: v.via || null, files: v.files || null, items: rows.map(w => wanderJSON(w, req)) };
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
      ...(require('./views').isQuiet() ? [] : [[reading ? '/yours/reading' : '/wander?in=shelf', 'Read', reading ? `${reading} book${reading === 1 ? '' : 's'} open` : 'Wander the shelf', I.facing || I.page || ''],
      ['/listening', 'Listen', 'The Listening Room', I.play || '']]),
      ['/collection', 'Collect', 'The collection', I.collect || ''],
      [m ? '/account' : '/makers', 'Make', m ? 'Your studio' : 'For those who make', I.pencil || I.plus || '']
    ].map(([h, v, l, ic]) => `<a href="${h}"><span class="sd-vi">${ic}</span><b>${v}</b><i>${esc(l)}</i></a>`).join('')}</nav>`;
    yours = yours.replace(/<\/header>/, '</header>' + verbs);
    // Who made it (Will, 5 Nov): the swipe left opens the person behind the picture, as TikTok trained everyone to
    // expect; their face first, so it is plainly someone, then their work, Follow, and the way into all of it.
    let who = '';
    if (w) {
      const A = app.locals.art; const LL = app.locals.lifeline;
      const art = w.artist_id && A ? db.prepare('SELECT * FROM artists WHERE id=?').get(w.artist_id) : null;
      const isInst = ['institution', 'company'].includes(String(db.prepare('SELECT kind FROM makers WHERE id=?').get(w.maker_id)?.kind || ''));
      const strip = (ws, key) => ws.length ? `<div class="whp-strip">${ws.map(x => `<a href="/wander?at=${esc(x.slug)}&in=${esc(key)}" aria-label="${esc(V.tidy(x.title))}"><img src="/img/${esc(x.slug)}/thumb" alt="" loading="lazy"></a>`).join('')}</div>` : '';
      const first = t => { const p = String(t || '').split(/\n{2,}/)[0].trim(); return p.length > 280 ? p.slice(0, 277).replace(/\s\S*$/, '') + '…' : p; };
      if (art && isInst) {
        const ws = db.prepare("SELECT slug, title FROM works WHERE artist_id=? AND status='held' AND slug<>? ORDER BY curated DESC, stars DESC, id LIMIT 9").all(art.id, w.slug);
        const n = db.prepare("SELECT COUNT(*) n FROM works WHERE artist_id=? AND status='held'").get(art.id).n;
        const dates = LL ? LL.dateWords(art) : null;
        const face = ws[0] ? `/img/${ws[0].slug}/thumb` : `/img/${w.slug}/thumb`;
        who = `<header class="whp-h"><img class="whp-face whp-face-w" src="${esc(face)}" alt=""><div><p class="k">The artist</p><h3>${esc(art.name)}</h3><p class="whp-l">${[dates, art.nationality, art.movement].filter(Boolean).map(esc).join(' · ')}</p></div></header>
${art.bio ? `<p class="whp-bio">${esc(first(art.bio))}</p>` : ''}
<p class="whp-n">${n} work${n === 1 ? '' : 's'} in the house</p>${strip(ws, 'artist:' + art.slug)}
<div class="whp-acts"><a class="whp-go" href="/wander/art/${esc(art.slug)}">${I.wave || ''}<b>Wander their work</b></a><a class="whp-pg" href="/art/${esc(art.slug)}">Their page ${I.next}</a></div>
${isInst ? `<p class="whp-by">Photographed for the house by ${esc(w.maker_name)}.</p>` : ''}`;
      } else {
        const mk = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id);
        const slugM = V.makerSlug(mk);
        const ws = db.prepare("SELECT slug, title FROM works WHERE maker_id=? AND status='held' AND slug<>? ORDER BY curated DESC, stars DESC, id DESC LIMIT 9").all(mk.id, w.slug);
        const n = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(mk.id).n;
        const lt = LL ? LL.text(mk) : null;
        const line = lt ? [lt.years, lt.atWork ? 'at work' : null, lt.verified ? 'Verified' : null].filter(Boolean).join(' · ') : (mk.place || '');
        const fol = app.locals.museums && !isInst ? app.locals.museums.button('maker:' + mk.id) : '';
        const face = mk.portrait ? `/portrait/${esc(mk.handle)}` : `/img/${esc(w.slug)}/thumb`;
        who = `<header class="whp-h"><img class="whp-face${mk.portrait ? '' : ' whp-face-w'}" src="${face}" alt=""><div><p class="k">${isInst ? 'The collection' : 'The maker'}</p><h3>${esc(mk.name)}</h3>${line ? `<p class="whp-l">${esc(line)}</p>` : ''}</div></header>
${mk.bio ? `<p class="whp-bio">${esc(first(mk.bio))}</p>` : ''}
<p class="whp-n">${n} work${n === 1 ? '' : 's'} on view</p>${strip(ws, 'maker:' + mk.handle)}
<div class="whp-acts">${fol}<a class="whp-go" href="/wander?maker=${esc(slugM)}">${I.wave || ''}<b>Wander their work</b></a><a class="whp-pg" href="/m/${esc(slugM)}">Their page ${I.next}</a></div>`;
      }
    }
    // About the work (Will, 6 Nov: "it should get you more about the work"): the work first, the person after it.
    let about = '';
    if (w) {
      const A = app.locals.art; const art = A && A.ofWork ? (() => { try { return A.ofWork(w); } catch (e) { return null; } })() : null;
      const isInst = ['institution', 'company'].includes(String(db.prepare('SELECT kind FROM makers WHERE id=?').get(w.maker_id)?.kind || ''));
      const by = art && isInst ? art.name : w.maker_name;
      const year = String(w.obj_made || '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[1] || (w.taken_at || '').slice(0, 4) || '';
      const c = app.locals.closerOf ? app.locals.closerOf(w) : null;
      const para = t => { const p = String(t || '').split(/\n{2,}/).map(x => x.trim()).filter(Boolean)[0] || ''; return p.length > 520 ? p.slice(0, 517).replace(/\s\S*$/, '') + '…' : p; };
      const words = c && c.text ? para(c.text) : para(w.caption);
      const look = c && c.study && !c.studyHidden && Array.isArray(c.study.look) ? c.study.look.slice(0, 3) : [];
      let kept = null; try { const CT = app.locals.catalogue; const r = CT && CT.rowOfWork ? CT.rowOfWork(w) : null; if (r && r.collection) { const k = r.collection_qid && CT.keeper ? CT.keeper(r.collection_qid) : null; kept = { name: r.collection, where: [k && k.city, k && k.country].filter(Boolean).join(', '), qid: r.collection_qid }; } } catch (e) { kept = null; }
      const facts = [['Made', [year, w.place].filter(Boolean).join(' · ')], ['Medium', w.medium], ['Size', w.obj_dims], ['Kept at', kept ? [kept.name, kept.where].filter(Boolean).join(', ') : ''], ['Accession', w.accession]].filter(f => f[1]);
      const rec = `/m/${esc(V.makerSlug({ handle: w.maker_handle, name: w.maker_name }))}/${esc(w.slug)}?from=wander`;
      const openW = ['pd', 'cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc'].includes(w.open || '');
      about = `<header class="wka-h"><p class="k">The work</p><h3>${esc(V.tidy(w.title))}</h3><p class="wka-by">${esc(by)}${year ? `, ${esc(year)}` : ''}</p></header>
${facts.length ? `<dl class="wka-f">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
${words ? `<section class="wka-s"><p class="k">${c && c.text ? 'Look closer' : 'About it'}</p><p class="wka-t">${esc(words)}</p></section>` : ''}
${look.length ? `<section class="wka-s"><p class="k">What to look for</p><ol class="wka-l">${look.map(x => `<li><b>${esc(x.what)}</b>${x.why ? ` <span>${esc(x.why)}</span>` : ''}</li>`).join('')}</ol></section>` : ''}
${kept && kept.qid ? `<p class="wka-m">The original hangs at ${esc(kept.name)}. <a href="/art/visit/${esc(kept.qid)}">See it in person</a></p>` : ''}
<div class="wka-acts"><a class="whp-go" href="${rec}">${I.shield || ''}<b>The full record</b></a>${c && c.study && !c.studyHidden ? `<a class="whp-pg" href="${rec.replace('?from=wander', '')}#study">The study ${I.next}</a>` : ''}</div>
<p class="wka-r">${openW ? 'In the public domain: free for everyone to look at, share and print.' : 'Numbered and on the register. To use it beyond looking, license it on the record.'}</p>
<p class="k wka-who">Who made it</p>`;
      who = about + who + `<p class="whp-x">Swipe right to go back to the picture.</p>`;
    }
    res.json({ keys, yours, who });
  });

  // The old address: one word, Wander (Will, 21 Oct). Links in the wild and the app's cache still say /stroll.
  app.get('/stroll', (req, res) => res.redirect(301, '/wander' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));
  // The front door is Wander (Will, 26 Oct, the Jobs cut: one name on the door; `/` opens on the picture; the page
  // about the house is /house). A tenant's `/` was rewritten to its maker's page before this.
  // A stranger's first page of Wander is built once every fifteen seconds (28 Oct, for an audience); anyone the house knows is built fresh.
  const brief = h => (req, res, next) => (app.locals.minute ? app.locals.minute(h, 15e3) : h)(req, res, next);
  app.get('/', brief((req, res) => wander(req, res, { front: true })));
  app.get('/wander', brief((req, res) => wander(req, res, {})));
  // An artist's wander, at an address worth sending (Will, 2 Nov: "make it where you can share an artist wander"):
  // /wander/art/<slug> walks the artist's wall, in the order made, and unfurls as the artist's own card.
  app.get('/wander/art/:slug', brief((req, res) => {
    const A = app.locals.art; const a = A && A.bySlug ? A.bySlug(String(req.params.slug)) : null; if (!a) return res.redirect('/art');
    // The show first, when one is open (5 Nov: a tight show, not twelve thousand works); ?all=1 walks everything.
    const sh = req.query.all === '1' || !app.locals.shows ? null : app.locals.shows.showOf(a);
    const h = sh || (A.wall ? A.wall(a) : null); if (!h) return res.redirect(`/art/${a.slug}`);
    // What is sent is the artist's own page (Will, 2 Nov): the life, the dates, the work in order; never the wall.
    return wander(req, res, { key: `hang:${h.slug}`, as: { label: a.name, href: `/art/${a.slug}` }, share: { url: `/art/${a.slug}`, image: `/art/${a.slug}/card.png`, title: a.name, text: `${a.name}${a.born || a.died ? ` (${a.born || ''}–${a.died || ''})` : ''}: the life and the work, in the order it was made.` } });
  }));
  // A set worth sending: public walls, a maker's work, a series, the collection; never a private room or an album.
  const SHAREABLE = k => /^(hang|maker|series|year|decade|century|place|movement|kind|artist):[^\s]+$/.test(k) || /^(collection|arrived|open|stood|living)$/.test(k);
  // The first name of whoever is signed in, for a flower's card; nothing else of them.
  const meFirst = req => { try { const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null; const m = app.locals.accounts ? app.locals.accounts.makerOf(req) : null; const n = String((m && m.name) || (b && b.name && !/collection$/i.test(b.name) ? b.name : '') || '').trim().split(/\s+/)[0] || ''; return /^[\p{L}'’.-]{1,24}$/u.test(n) ? n : ''; } catch (e) { return ''; } };
  // Sent (Will, 5 Nov: "when someone gets a link they open it and are stunned at the beauty, then can do more"; "here,
  // I found something for you"; "whatever is right for Watermark and Krafft"). A work sent to someone opens alone, in
  // the dark, with the giver's first name and, if they wrote one, their line; then the house. The recipient may send one
  // back, and only then is the giver told. Nothing is counted or followed; a sending is a row so the link stays short
  // and the line stays out of the address.
  db.exec(`CREATE TABLE IF NOT EXISTS sendings (id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, work_id INTEGER NOT NULL, from_name TEXT, note TEXT, buyer_id INTEGER, maker_id INTEGER, reply_to INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const okName = n => { const x = String(n || '').trim().split(/\s+/)[0].slice(0, 24); return /^[\p{L}'’.-]{1,24}$/u.test(x) ? x : ''; };
  const okNote = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 160).replace(/https?:\/\/\S+/gi, '').trim();
  const sendSlow = new Map();
  // The only word back to a giver: someone they sent a work to chose to send one in return.
  function tellBack(back, workId, _u, { from, note, token }) {
    if (!back || !(back.buyer_id || back.maker_id) || !app.locals.notify) return;
    const w = db.prepare('SELECT slug, title FROM works WHERE id=?').get(workId); if (!w) return;
    try { app.locals.notify.tell({ buyer_id: back.buyer_id || null, maker_id: back.buyer_id ? null : back.maker_id, kind: 'found', slug: w.slug, href: `/found/${token}`, title: `${from || 'Someone'} sent you one back`, body: `${V.tidy(w.title)}${note ? ` · “${note}”` : ''}` }); } catch (e) { /* the sending stands */ }
  }
  app.post('/send', (req, res) => {
    const b = req.body || {}; const w = db.prepare("SELECT id, slug, title, zone FROM works WHERE slug=? AND status='held'").get(String(b.slug || ''));
    if (!w) return res.status(404).json({ error: 'not held' });
    const n = (sendSlow.get(req.ip) || 0) + 1; sendSlow.set(req.ip, n); if (n > 60) return res.status(429).json({ error: 'slow' }); if (sendSlow.size > 5000) sendSlow.clear();
    const buyer = app.locals.buyerOf ? app.locals.buyerOf(req) : null, mk = app.locals.accounts ? app.locals.accounts.makerOf(req) : null;
    const from = okName(b.name) || meFirst(req); const note = okNote(b.note);
    const back = b.reply ? db.prepare('SELECT * FROM sendings WHERE token=?').get(String(b.reply).slice(0, 40)) : null;
    const token = require('crypto').randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO sendings (token, work_id, from_name, note, buyer_id, maker_id, reply_to) VALUES (?,?,?,?,?,?,?)').run(token, w.id, from || null, note || null, buyer ? buyer.id : null, mk ? mk.id : null, back ? back.id : null);
    if (back) tellBack(back, w.id, null, { from, note, token });
    const url = `${(process.env.BASE_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`}/found/${token}`;
    res.set('Cache-Control', 'no-store').json({ url, title: V.tidy(w.title), text: note ? `${note}` : 'I found something for you.' });
  });
  app.post('/send/:token/note', (req, res) => {
    const s = db.prepare('SELECT * FROM sendings WHERE token=?').get(String(req.params.token).slice(0, 40)); if (!s) return res.sendStatus(404);
    if (Date.now() - Date.parse(String(s.at).replace(' ', 'T') + 'Z') > 30 * 60e3) return res.sendStatus(409); // only while it is being sent
    const b = req.body || {}; const note = okNote(b.note), name = okName(b.name);
    db.prepare('UPDATE sendings SET note=COALESCE(?, note), from_name=COALESCE(?, from_name) WHERE id=?').run(note || null, name || null, s.id);
    const back = b.reply && !s.reply_to ? db.prepare('SELECT * FROM sendings WHERE token=?').get(String(b.reply).slice(0, 40)) : null;
    if (back) { db.prepare('UPDATE sendings SET reply_to=? WHERE id=?').run(back.id, s.id); tellBack(back, s.work_id, token => token, { from: name || s.from_name, note: note || s.note, token: s.token }); }
    res.sendStatus(204);
  });
  const openSent = (req, res, next, s) => {
    const w = db.prepare("SELECT slug, zone FROM works WHERE id=? AND status='held'").get(s.work_id); if (!w) return next();
    if (w.zone === 'mature' && app.locals.zone && !app.locals.zone.open(req)) return res.redirect(`/w/${w.slug}`); // the door first
    res.set('Cache-Control', 'private, no-store'); // (req.query cannot be written in Express 5: the work goes in by hand)
    return wander(req, res, { at: w.slug, gift: { from: s.from_name || '', note: s.note || '', token: s.token || '' } });
  };
  app.get('/found/:token', (req, res, next) => { const s = db.prepare('SELECT * FROM sendings WHERE token=?').get(String(req.params.token).slice(0, 40)); if (!s) return next(); return openSent(req, res, next, s); });
  // The first links of 5 Nov: /flower/<slug>?from=<name> still opens the same way.
  app.get('/flower/:slug', (req, res, next) => { const w = db.prepare("SELECT id FROM works WHERE slug=? AND status='held'").get(String(req.params.slug)); if (!w) return next(); return openSent(req, res, next, { work_id: w.id, from_name: okName(req.query.from) }); });
  function wander(req, res, { front = false, key: keyIn = null, share = null, as = null, gift = null, at: atIn = null }) {
    const q = String(req.query.q || '').trim().slice(0, 60), maker = String(req.query.maker || '').slice(0, 60);
    const key = String(keyIn || req.query.in || '').slice(0, 80);
    const atSlug = atIn || req.query.at;
    const at = atSlug ? db.prepare(isDelivery(key) ? "SELECT * FROM works WHERE slug=? AND status IN ('held','hidden')" : "SELECT * FROM works WHERE slug=? AND status='held'").get(String(atSlug)) : null;
    // The readers' feed (Will, 27 Oct): Wander, for words. One passage a screen, on the paper.
    if (key === 'shelf') { const CP = app.locals.commonplace; const items = CP ? CP.passages([], 6) : []; res.set('Cache-Control', 'private, no-store'); return res.send(strollPage({ items, set: { key, label: 'The shelf', href: '/library', n: 0, via: null }, I, front, shelf: true })); }
    const set = key ? inSet(req, key, { at: at ? at.slug : '', n: 6 }) : null;
    if (isDelivery(key) && !set) return res.redirect(key.startsWith('album:') ? '/a/' + encodeURIComponent(key.slice(6)) : '/deliver/' + encodeURIComponent(key.slice(9))); // closed, or not an album: its own door says so
    let items = set ? set.items : next(req, { q, maker, n: 6, seen: at ? [at.slug] : [] });
    if (at) items = [wanderJSON(at, req), ...items];
    const mk = set ? null : makerBy(maker);
    res.set('Cache-Control', 'private, no-store');
    const sh = share || (set && SHAREABLE(key) ? { url: `/wander?in=${encodeURIComponent(key)}`, title: `${set.label} · Wander`, text: `${set.label}: one work at a time, on Watermark.` } : null);
    // A flower (Will, 5 Nov: "when we send someone a link it opens like a present; here, I found something for you"):
    // the card is the picture itself; the page opens on it alone, in the dark, and the chrome comes after.
    const giftLine = gift ? `${gift.from ? `${gift.from} found this for you.` : 'Someone found this for you.'}` : '';
    const giftNote = gift && gift.note ? gift.note : '';
    res.send(strollPage({ items, q: set ? '' : q, maker: mk ? { name: mk.name, slug: V.makerSlug(mk) } : null, set: set ? { key, label: (as && as.label) || set.label, href: (as && as.href) || set.href, n: set.n, via: set.via || null, files: set.files || null } : null, I , front, share: sh, gift: gift ? { from: gift.from || '', line: giftLine, note: giftNote, token: gift.token || '' } : null, me: meFirst(req) }));
  }
}

// The page: the first photographs are in the HTML, so the stroll begins the instant it opens; the script carries on.
function strollPage({ items, q = '', maker = null, set = null, I, front = false, shelf = false, share = null, gift = null, me = '' }) {
  const giftLine = gift ? gift.line : '';
  const V = require('./views');
  const BUNCH = (() => { try { return require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'keys', 'bunch.svg'), 'utf8').replace('<svg ', '<svg class="kmk kmk-bunch" aria-hidden="true" '); } catch (e) { return I.key || ''; } })();
  const bookObj = w => `<a class="st-bk${w.cover ? '' : ' st-bound'}" href="/read/${esc(w.book)}"><img src="${esc(w.cover || `/binding/${encodeURIComponent(w.book)}.svg`)}" alt=""><span class="bk3-e"></span></a>`;
  const recordCard = w => `<section class="st-i st-rec" data-slug="${esc(w.slug)}" data-kind="record"><article class="st-rc"><a class="st-rdisc" href="${esc(w.href)}"><img src="${esc(w.img)}" alt="" loading="lazy"></a><p class="k">From the Listening Room</p><h2>${esc(w.title)}</h2><p class="st-rby">${esc(w.by)}${w.composer ? ` · ${esc(w.composer)}` : ''}${w.year ? ` · ${esc(w.year)}` : ''}</p>${w.line ? `<p class="st-rline">${esc(w.line)}</p>` : ''}<div class="st-racts"><button type="button" class="st-rplay" data-st-rplay data-src="${esc(w.url)}">${I.play}${I.pause}<span>Play ${esc(w.side)}</span></button><a class="st-rgo" href="${esc(w.href)}">Into the room${w.n > 1 ? ` · ${w.n} sides` : ''}</a></div></article></section>`;
  const textCard = w => w.passage
    ? `<section class="st-i st-txt st-pas" data-slug="${esc(w.slug)}" data-kind="text"><article class="st-tx"><p class="k">A passage</p><div class="st-txb st-pasb">${w.excerpt.map(p => `<p>${esc(p)}</p>`).join('')}</div><p class="st-pasrc">— ${w.author ? `${esc(w.author)}, ` : ''}<i>${esc(w.title)}</i>${w.head ? `<span>${esc(w.head)}</span>` : ''}</p><div class="st-pasfoot">${bookObj(w)}<div><a class="st-txgo" href="${esc(w.href)}">Open the book here</a><p class="st-txacts"><button type="button" data-st-cp title="Keep it in your commonplace book: passages copied out of what you read, in your own hand">${I.plus}<span>Keep</span></button><button type="button" data-st-share title="Send the passage to someone, on its card">${I.share}<span>Share</span></button></p></div></div></article></section>`
    : `<section class="st-i st-txt" data-slug="${esc(w.slug)}" data-kind="text">${bookObj(w)}<article class="st-tx"><p class="k">From the shelf</p><h2>${esc(w.title)}</h2>${w.author ? `<p class="st-txa">${esc(w.author)}</p>` : ''}${w.head ? `<p class="st-txh">${esc(w.head)}</p>` : ''}<div class="st-txb">${w.excerpt.map(p => `<p>${esc(p)}</p>`).join('')}</div><a class="st-txgo" href="${esc(w.href)}">Read on${w.n ? ` · ${w.n} chapters` : ''}</a><p class="st-txacts"><button type="button" data-st-keep title="Keep it on your shelf: among your books, to read when you like">${I.plus}<span>Keep</span></button><button type="button" data-st-share title="Send the book to someone">${I.share}<span>Share</span></button></p></article></section>`;
  // A screen from the shelf, the turntable or a contact sheet never takes the wall down with it (30 Oct: a third of
  // Wander's first loads answered 500); the fault is kept for /healthz and the screen left out.
  function screenFault(e) { HOUSE.locals.screenFault = { at: new Date().toISOString(), message: String(e && e.message || e).slice(0, 300), stack: String(e && e.stack || '').split('\n').slice(0, 6).join(' | ') }; console.error('[wander] screen', e); }
  const card = (w, i) => { if (w.kind === 'sheet' || w.kind === 'text' || w.kind === 'record') { try { return w.kind === 'sheet' ? (HOUSE.locals.sheets ? HOUSE.locals.sheets.card(w) : '') : w.kind === 'text' ? textCard(w) : recordCard(w); } catch (e) { screenFault(e); return ''; } } return cardOf(w, i); };
  const cardOf = (w, i) => `<section class="st-i" data-slug="${esc(w.slug)}">
<img class="st-im" src="${esc(w.img)}" alt="${esc(w.title)}" draggable="false" decoding="async"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}>
<div class="st-plate"><a class="st-by" href="${w.artist ? esc(w.artist.href) : `/wander?maker=${esc(w.makerSlug)}&at=${esc(w.slug)}`}"${w.artist ? '' : ' data-st-maker'}>${esc(w.maker)}</a>${w.life && (w.life.years || w.life.atWork || w.life.verified) ? `<span class="st-life">${w.life.years ? `<i>${esc(w.life.years)}</i>` : ''}${w.life.atWork ? '<b class="lfl-w" title="Put up new work in the last month">at work</b>' : ''}${w.life.verified ? '<b class="lfl-v" title="A real person, checked">Verified</b>' : ''}</span>` : ''}<a class="st-t" href="/m/${esc(w.makerSlug)}/${esc(w.slug)}?from=wander">${esc(w.title)}</a><span class="st-k">${w.place ? `<a href="/wander?q=${encodeURIComponent(w.place)}">${esc(w.place)}</a>` : ''}${w.place && w.year ? ' · ' : ''}${esc(w.year || '')}</span><a class="st-tog" href="/m/${esc(w.makerSlug)}/${esc(w.slug)}?from=wander" title="Watermark: the asset under the picture; its number, its terms, its papers, the licence to use it"><b>${I.wave}Wander</b><span>${I.shield}Watermark</span></a></div>
<button type="button" class="st-eye" data-eye="${esc(w.slug)}" aria-label="The Watermark: the asset, its number, its terms">${I.shield}</button>
<nav class="st-rail" aria-label="Acts">
<button type="button" class="st-b" data-st-hat aria-pressed="${w.hat && w.hat.mine ? 'true' : 'false'}" title="Hat: a nod, I saw it. Free, as many as you like.">${I.hat}<span data-st-hat-n>Hat</span></button><button type="button" class="st-b st-bv" data-st-bravo aria-pressed="${w.bravo && w.bravo.mine ? 'true' : 'false'}" title="Bravo: it floored me. Three a month.">${I.bravo}<span>Bravo</span></button>
<button type="button" class="st-b" data-st-hang title="Save it to a wall of yours, like a pin. Find it again in Yours.">${I.hang}<span>Save</span></button>
<button type="button" class="st-b" data-st-share title="Send it to someone. It opens for them on its own, with your name and a line from you.">${I.send}<span>Send</span></button><a class="st-b st-study" data-st-easel href="/easel/${esc(w.slug)}?back=${encodeURIComponent(`/wander?at=${w.slug}`)}" title="Study it: the work large on the easel, with values, notan, squint, a grid and a timer. Set your phone on a stand and draw from it.">${I.easel}<span>Study</span></a>
<button type="button" class="st-b st-moreb" data-st-more aria-expanded="false" aria-label="More">${I.more}<span>More</span></button>
<div class="st-more" data-st-morebox hidden>${w.slug && !String(w.slug).includes(':') ? `<a class="st-b" href="/w/${esc(w.slug)}/frame" title="Frame a detail: the part you love, kept with its own address">${I.look}<span>Frame</span></a><button type="button" class="st-b" data-note="${esc(w.slug)}" title="Keep a thought: write a line, or say it aloud. Yours alone unless you share it.">${I.pencil}<span>Note</span></button>` : ''}${w.sheet ? `<a class="st-b" data-st-sheet href="${esc(w.sheet.href)}?back=${encodeURIComponent(`/wander?at=${w.slug}`)}" title="The contact sheet: every frame around this one, as it was shot.">${I.page}<span>Contact sheet</span></a>` : ''}<a class="st-b" data-st-record href="/m/${esc(w.makerSlug)}/${esc(w.slug)}?from=wander" title="Watermark: the asset under the picture; its number, its terms, the licence to use it.">${I.page}<span>Watermark</span></a>${w.guide ? `<button type="button" class="st-b" data-st-guide title="Look closer: what to see in it, read by Al.">${I.guide}<span>Look closer</span></button>` : ''}<button type="button" class="st-b" data-st-card title="A thank-you card to the maker, from 99¢.">${I.card}<span>Thank</span></button><button type="button" class="st-b" data-st-settings title="Sit a while: each work held a minute and a half, the guide read, quiet music.">${I.stand}<span>Sit</span></button></div>
${w.held ? `<span class="st-b st-held">${I.collect}<span>Yours</span></span>` : w.collect ? `<button type="button" class="st-b st-buy" data-st-buy data-url="${esc(w.collect.url)}" data-pocket="${w.collect.pocket ? 1 : 0}" title="Collect it: yours to keep, numbered, with the papers. ${esc(w.collect.price)}.">${I.collect}<span>Collect<b>${esc(w.collect.price)}</b></span><em>Yours to keep</em></button>` : w.printOpen ? `<a class="st-b st-buy st-print" href="${esc(w.printOpen.url)}" title="Print it: archival pigment on cotton paper, sent to your door. From ${esc(w.printOpen.from)}.">${I.hang}<span>Print it<b>from ${esc(w.printOpen.from)}</b></span></a>` : ''}
</nav>
<div class="st-hat-fly" aria-hidden="true">${I.hat}</div>
</section>`;
  const g0 = gift && items[0] ? items[0] : null;
  return V.layout({ title: g0 ? `${V.tidy(g0.title)} · ${g0.maker}` : front ? 'Watermark · Where great work is kept' : share ? `${share.title} · Watermark` : `${q ? `${V.tidy(q)} · ` : ''}Wander · Watermark`, desc: g0 ? (gift.note ? `“${gift.note}” ${giftLine}` : giftLine) : front ? 'Keep what you make. Own a piece of what others make. Wander: the finest work, one at a time, edge to edge.' : share ? share.text : 'Watermark on a phone: the finest work, one at a time, edge to edge. Swipe for the next.', path: g0 ? (gift.token ? `/found/${gift.token}` : `/w/${g0.slug}`) : front ? '/' : share ? share.url : '/wander', bare: true, image: g0 ? `/img/${g0.slug}/large?f=jpg` : share && share.image ? share.image : items[0] ? items[0].img : null, body: `<main class="st${front ? ' st-front' : ''}${gift ? ' st-gift st-gifting' : ''}" data-stroll${front ? ' data-front="1"' : ''}${gift ? ` data-gift="1" data-from="${esc(gift.from || '')}" data-found="${esc(gift.token || '')}"` : ''} data-q="${esc(q)}" data-maker="${esc(maker ? maker.slug : '')}" data-me="${esc(me)}">
<header class="st-top"><a class="st-home" href="${front ? '/house' : '/'}" aria-label="Watermark">${V.WAVE_MARK || ''}<span>Watermark</span></a><a class="st-look" href="/look" title="Every collection in the house: the Met, the masters, the makers">Look around</a>${maker ? `<a class="st-chip" href="/wander" title="Everything again">${esc(maker.name)}<i>${I.close}</i></a>` : ''}${set ? `<a class="st-chip st-set" href="${esc(set.href)}" title="Back to ${esc(set.label)}">${esc(set.label)}<i>${I.close}</i></a>` : ''}${q && !maker && !set ? `<a class="st-chip" href="/wander" title="Everything again">${esc(q)}<i>${I.close}</i></a>` : ''}<span class="st-sp"></span>${share ? `<button type="button" class="st-gon" data-st-setshare data-url="${esc(share.url)}" data-title="${esc(share.title)}" data-text="${esc(share.text)}" aria-label="Share this wander" title="Send this wander: the whole walk, from the first work">${I.share || I.send}<span>Share</span></button>` : ''}<button type="button" class="st-gon" data-find-open="stroll" aria-label="Find" title="Find a work, a place, a maker: straight to it">${I.find || I.eye}<span>Find</span></button><button type="button" class="st-gon st-full" data-st-fs hidden aria-label="Full screen" title="Full screen (F)">${I.full || ''}<span>Full screen</span></button><a class="st-x" href="${set ? esc(set.href) : front ? '/house' : '/collection'}" aria-label="Close" data-st-close>${I.close}</a></header>
<div class="st-sheet st-ss" data-st-ssheet hidden><div class="st-scard"><button type="button" class="st-gx" data-st-sx2 aria-label="Close">${I.close}</button><p class="k">Settings</p>
<button type="button" class="st-sit1" data-st-sit aria-pressed="false">${I.stand}<b>Sit a while</b><span>Each work held a minute and a half, the guide read, quiet music. Tap again to stand.</span></button>
<p class="st-skeys">Keys: arrows or space move · H hat · B bravo · S hang · G guide · C collect · Esc leaves.</p></div></div>
<button type="button" class="st-hld" data-st-held hidden title="Release (L or Esc)">${I.full}<b>Held</b><span data-st-heldfs>full screen</span><i>${I.close}</i></button>
<div class="st-scroll" data-st-scroll>${items.map(card).join('')}${items.length ? '' : `<section class="st-i st-none"><p>Nothing by that word yet.</p><a href="/wander">Wander on</a></section>`}</div>
<div class="st-guide" data-st-guide-sheet hidden><div class="st-gcard"><button type="button" class="st-gx" data-st-gx aria-label="Close">${I.close}</button><p class="k st-wil">${I.guide}Look closer &middot; Al</p>${V.GUIDE_SWITCH || ''}<div class="st-gt" data-st-gt></div><p class="st-gby" data-st-gby></p></div></div>
${gift ? `<div class="st-flower" data-st-flower>${gift.note ? `<p class="st-fl-note">“${esc(gift.note)}”</p>` : ''}<p class="st-fl-line">${esc(giftLine)}</p><p class="st-fl-sub">${items[0] ? `<b>${esc(V.tidy(items[0].title))}</b> · ${esc(items[0].maker)}` : ''}</p></div>` : ''}${front ? `<div class="st-hello" data-st-hello><p>Keep what you make. Own a piece of what others make.</p><a href="/house">What this is &rarr;</a></div>` : ''}<p class="st-toast" data-st-toast hidden></p>${['find','close','next','wave'].map(k => `<template data-ic="${k}">${I[k]}</template>`).join('')}
<button type="button" class="st-tab st-tab-r" data-st-doors="keys" aria-label="About the work">${I.page || I.look}<span>About</span></button>
<aside class="st-side st-side-r st-who" data-st-side="keys" aria-label="About the work and who made it"><div class="sdr" data-sd-body></div></aside><script src="/static/follow.js" defer></script><div class="st-shade" data-st-shade hidden></div>
<template data-st-ic="wave">${I.wave}</template><template data-st-ic="look">${I.look}</template><template data-st-ic="pencil">${I.pencil}</template><template data-st-ic="in">${I.in || ''}</template><template data-st-ic="card">${I.card || ''}</template><template data-st-ic="play">${I.play}</template><template data-st-ic="pause">${I.pause}</template><template data-st-ic="plus">${I.plus}</template><template data-st-ic="share">${I.share}</template>
<div class="st-sitbar" data-st-sitbar hidden><button type="button" data-st-stand>Stand up</button></div>
<p class="st-stay" data-st-stay hidden>Stay with this one.</p>
<p class="st-swipe" data-st-swipe hidden><span>Swipe up for the next</span><i></i></p>
</main>
<script>window.__WM_STROLL=${JSON.stringify({ items, q, maker: maker ? maker.slug : '', set }).replace(/</g, '\\u003c')};</script>
<script src="/static/stay.js?v=${V.VER || ''}" defer></script><script src="/static/stroll.js?v=${V.VER || ''}" defer></script><script src="/static/eye.js?v=${V.VER || ''}" defer></script>` });
}

module.exports = { mountStroll, strollPage };
