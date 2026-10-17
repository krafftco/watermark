// The frame (Will, 17 Oct): photographs cycling on a television, the way the Samsung Frame hangs art on a wall,
// chosen for the evening: "images of Florence", "the Great Rooms", a friend's wall. Pieces you have collected
// show at full size; everything else shows at screen size with its plate, and the set can be collected in one tap.
// A screen pairs by a five-letter code; a phone is the remote. Quiet music is made in the browser, not streamed.
const { nanoid, customAlphabet } = require('nanoid');
const { layout, esc, money, setDeskPath } = require('./views');

const code5 = customAlphabet('BCDFGHJKLMNPQRSTVWXZ', 5); // no vowels: no words
const EVERY = [15, 30, 60, 120, 300];
const MUSIC = { none: 'Silence', quiet: 'Quiet (made in the room)', own: 'A stream of your own' };

function mountFrame(app, { db, C, V, stripe, buyerOf, ledger, pocket, nextRef, grant, collectUse, SERIES }) {
  db.exec(`CREATE TABLE IF NOT EXISTS frames (id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, buyer_id INTEGER, set_kind TEXT NOT NULL DEFAULT 'today', set_key TEXT, title TEXT,
    every INTEGER NOT NULL DEFAULT 30, music TEXT NOT NULL DEFAULT 'none', music_url TEXT, plate TEXT NOT NULL DEFAULT 'brief', created_at TEXT NOT NULL DEFAULT (datetime('now')), seen_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const SEL = `SELECT w.id, w.slug, w.title, w.place, substr(w.taken_at,1,4) AS year, w.width, w.height, w.maker_id, m.name AS maker, m.handle FROM works w JOIN makers m ON m.id=w.maker_id`;
  const HELD = "w.status='held' AND w.disputed=0 AND m.standing='open'";
  const byIdSet = ids => ids.length ? db.prepare(`${SEL} WHERE w.id IN (${ids.map(() => '?').join(',')}) AND ${HELD}`).all(...ids) : [];
  const bySlugs = slugs => { const rows = slugs.length ? db.prepare(`${SEL} WHERE w.slug IN (${slugs.map(() => '?').join(',')}) AND ${HELD}`).all(...slugs) : []; const by = new Map(rows.map(r => [r.slug, r])); return slugs.map(s => by.get(s)).filter(Boolean); };

  // The sets a frame can show.
  function resolve(kind, key, b) {
    switch (kind) {
      case 'today': return { title: 'The house, today', works: db.prepare(`${SEL} WHERE ${HELD} AND (w.curated=1 OR w.stars>=4) ORDER BY RANDOM() LIMIT 60`).all() };
      case 'gallery': { if (!b) return { title: 'Your gallery', works: [] }; const ids = db.prepare("SELECT DISTINCT work_id FROM licenses WHERE buyer_id=? AND status='active'").all(b.id).map(r => r.work_id); return { title: `${b.name ? b.name + "'s" : 'Your'} gallery`, works: byIdSet(ids) }; }
      case 'hang': { const h = db.prepare('SELECT * FROM hangs WHERE slug=?').get(String(key || '')); if (!h || !(h.public || (b && h.buyer_id === b.id))) return null; const ids = db.prepare('SELECT work_id FROM hang_works WHERE hang_id=? ORDER BY pos').all(h.id).map(r => r.work_id); const rows = byIdSet(ids), by = new Map(rows.map(r => [r.id, r])); return { title: h.title, works: ids.map(i => by.get(i)).filter(Boolean) }; }
      case 'series': { const s = (SERIES || []).find(x => x.slug === key); if (!s) return null; return { title: s.title, works: bySlugs(s.chapters.flatMap(c => c.works)) }; }
      case 'maker': { const m = db.prepare('SELECT * FROM makers WHERE handle=?').get(String(key || '')); if (!m) return null; return { title: m.name, works: db.prepare(`${SEL} WHERE w.maker_id=? AND ${HELD} ORDER BY w.stars DESC, w.curated DESC, RANDOM() LIMIT 80`).all(m.id) }; }
      case 'q': { const t = String(key || '').trim().slice(0, 60); if (!t) return null; const like = `%${t}%`; return { title: t, works: db.prepare(`${SEL} WHERE ${HELD} AND (w.title LIKE ? OR w.place LIKE ? OR w.keywords LIKE ?) ORDER BY w.stars DESC, RANDOM() LIMIT 80`).all(like, like, like) }; }
      default: return null;
    }
  }
  const heldIds = b => b ? new Set(db.prepare("SELECT DISTINCT work_id FROM licenses WHERE buyer_id=? AND status='active'").all(b.id).map(r => r.work_id)) : new Set();
  function state(f) {
    const b = f.buyer_id ? db.prepare('SELECT * FROM buyers WHERE id=?').get(f.buyer_id) : null;
    const set = resolve(f.set_kind, f.set_key, b) || resolve('today');
    const held = heldIds(b);
    return { code: f.code, title: f.title || set.title, every: f.every, music: f.music, music_url: f.music === 'own' ? f.music_url : null, plate: f.plate, v: f.updated_at,
      works: set.works.map(w => ({ slug: w.slug, title: w.title, place: w.place, year: w.year, maker: w.maker, w: w.width, h: w.height, held: held.has(w.id), img: `/img/${w.slug}/${held.has(w.id) ? 'large' : 'screen'}` })) };
  }
  const frame = code => db.prepare('SELECT * FROM frames WHERE code=?').get(String(code || '').toUpperCase());
  const mine = (req, f) => { const b = buyerOf(req); return !!(f && (!f.buyer_id || (b && b.id === f.buyer_id))); };
  const parseSet = s => { const [kind, ...rest] = String(s || 'today').split(':'); return { kind: ['today', 'gallery', 'hang', 'series', 'maker', 'q'].includes(kind) ? kind : 'today', key: rest.join(':') || null }; };

  // The door.
  app.get('/frame', (req, res) => {
    const b = buyerOf(req);
    const hangs = db.prepare(`SELECT h.slug, h.title, h.public, COUNT(hw.work_id) n FROM hangs h LEFT JOIN hang_works hw ON hw.hang_id=h.id WHERE h.public=1 OR h.buyer_id=? GROUP BY h.id HAVING n>0 ORDER BY h.public, h.id DESC LIMIT 24`).all(b ? b.id : -1);
    const makers = db.prepare(`SELECT m.handle, m.name, COUNT(w.id) n FROM makers m JOIN works w ON w.maker_id=m.id AND w.status='held' WHERE m.standing='open' GROUP BY m.id ORDER BY n DESC LIMIT 12`).all();
    const frames = b ? db.prepare('SELECT * FROM frames WHERE buyer_id=? ORDER BY updated_at DESC LIMIT 6').all(b.id) : [];
    res.send(framePage({ b, hangs, makers, series: SERIES || [], frames, on: !!stripe, q: req.query.q || '' }));
  });
  app.get('/tv', (req, res) => res.redirect('/frame/tv'));
  app.get('/frame/pair', (req, res) => { const f = frame(req.query.code); res.redirect(f ? `/frame/${f.code}` : `/frame?ok=${encodeURIComponent('No screen answers to those letters.')}`); });
  // The screen: opens with a code and waits for a remote, or plays a set straight away.
  app.get('/frame/tv', (req, res) => {
    let f = req.query.code ? frame(req.query.code) : null;
    if (!f) { const b = buyerOf(req); const { kind, key } = parseSet(req.query.set); let code; do { code = code5(); } while (frame(code)); db.prepare('INSERT INTO frames (code, buyer_id, set_kind, set_key) VALUES (?,?,?,?)').run(code, b ? b.id : null, req.query.set ? kind : 'today', req.query.set ? key : null); f = frame(code); }
    res.send(tvPage({ code: f.code, first: state(f), base: C.base, waiting: !req.query.set && !req.query.code }));
  });
  app.get('/frame/tv/:code/state', (req, res) => {
    const f = frame(req.params.code); if (!f) return res.status(404).json({ gone: true });
    db.prepare("UPDATE frames SET seen_at=datetime('now') WHERE id=?").run(f.id);
    res.set('Cache-Control', 'no-store'); res.json(state(f));
  });
  // The remote: a phone in the hand.
  app.get('/frame/:code', (req, res) => {
    const f = frame(req.params.code); if (!f) return res.sendStatus(404);
    const b = buyerOf(req);
    if (f.buyer_id == null && b) db.prepare('UPDATE frames SET buyer_id=? WHERE id=?').run(b.id, f.id); // the first signed-in hand holds it
    const st = state(frame(f.code));
    const hangs = db.prepare(`SELECT h.slug, h.title, h.public FROM hangs h JOIN hang_works hw ON hw.hang_id=h.id WHERE h.public=1 OR h.buyer_id=? GROUP BY h.id ORDER BY h.public, h.id DESC LIMIT 24`).all(b ? b.id : -1);
    const makers = db.prepare(`SELECT m.handle, m.name FROM makers m JOIN works w ON w.maker_id=m.id AND w.status='held' WHERE m.standing='open' GROUP BY m.id ORDER BY COUNT(w.id) DESC LIMIT 12`).all();
    const unheld = st.works.filter(w => !w.held);
    const collect = unheld.length ? unheld.map(w => ({ w, u: collectUse(db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug)) })).filter(x => x.u) : [];
    const total = collect.reduce((s, x) => s + x.u.price_cents, 0);
    res.send(remotePage({ f: frame(f.code), st, b, hangs, makers, series: SERIES || [], own: mine(req, f), ok: req.query.ok || null, collect: { n: collect.length, total, pocket: b && pocket ? pocket.balance(b) : 0, on: !!stripe } }));
  });
  app.post('/frame/:code', (req, res) => {
    const f = frame(req.params.code); if (!f) return res.sendStatus(404); if (!mine(req, f)) return res.sendStatus(403);
    const x = req.body || {}; const { kind, key } = parseSet(x.set);
    const every = EVERY.includes(Number(x.every)) ? Number(x.every) : f.every;
    const music = MUSIC[x.music] ? x.music : f.music;
    const url = music === 'own' ? String(x.music_url || f.music_url || '').trim().slice(0, 300) : f.music_url;
    const plate = ['always', 'brief', 'never'].includes(x.plate) ? x.plate : f.plate;
    const title = String(x.title || '').trim().slice(0, 80) || null;
    if (resolve(kind, key, buyerOf(req)) === null) return res.redirect(`/frame/${f.code}?ok=${encodeURIComponent('Nothing hangs under that name.')}`);
    db.prepare("UPDATE frames SET set_kind=?, set_key=?, every=?, music=?, music_url=?, plate=?, title=?, updated_at=datetime('now') WHERE id=?").run(kind, key, every, music, url || null, plate, title, f.id);
    res.redirect(`/frame/${f.code}?ok=${encodeURIComponent('On the screen.')}`);
  });
  // Collect the set: every piece on the screen not yet yours, $5 each, from the pocket in one tap or by Checkout.
  app.post('/frame/:code/collect', async (req, res) => {
    const f = frame(req.params.code); if (!f) return res.sendStatus(404);
    const b = buyerOf(req); if (!b) return res.redirect(`/signin?next=${encodeURIComponent('/frame/' + f.code)}`);
    const st = state({ ...f, buyer_id: b.id });
    const items = st.works.filter(w => !w.held).map(w => ({ w: db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug) })).map(x => ({ ...x, u: collectUse(x.w) })).filter(x => x.u);
    if (!items.length) return res.redirect(`/frame/${f.code}?ok=${encodeURIComponent('Every piece on the screen is already yours.')}`);
    const total = items.reduce((s, x) => s + x.u.price_cents, 0);
    const setRef = `frame:${f.code}:${nextRef()}`;
    const refs = items.map(x => { const ref = nextRef(); db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,price_cents,status,set_ref,buyer_id) VALUES (?,?,?,?,?,?,'awaiting_payment',?,?)").run(ref, x.w.id, x.u.id, b.name || 'Collector', b.email || '', x.u.price_cents, setRef, b.id); return ref; });
    if (req.body && req.body.from === 'pocket' && pocket && pocket.spend(b, total, 'collect', refs[0], `The frame: ${items.length} photographs`)) {
      for (const [i, ref] of refs.entries()) { grant(ref, { paid: true, price_cents: items[i].u.price_cents }); ledger.append(db, 'license.paid.pocket', ref, { work: items[i].w.slug, use: items[i].u.key, amount: items[i].u.price_cents, frame: f.code }); }
      db.prepare("UPDATE frames SET updated_at=datetime('now') WHERE id=?").run(f.id);
      return res.redirect(`/frame/${f.code}?ok=${encodeURIComponent(`Yours: ${items.length} photographs, now at full size on the screen.`)}`);
    }
    if (!stripe) { db.prepare("DELETE FROM licenses WHERE set_ref=?").run(setRef); return res.redirect(`/frame/${f.code}?ok=${encodeURIComponent('Payments are not open yet.')}`); }
    ledger.append(db, 'license.checkout', refs[0], { set: setRef, works: items.map(x => x.w.slug), frame: f.code });
    try {
      const ss = await stripe.checkout.sessions.create({ mode: 'payment', submit_type: 'pay', customer_email: b.email || undefined,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: total, product_data: { name: `The frame: ${st.title}`, description: `${items.length} photographs, each yours to keep, share and hang, each numbered in your gallery.`, images: items.slice(0, 4).map(x => `${C.base}/img/${x.w.slug}/thumb`) } } }],
        metadata: { ref: refs[0], set: setRef, frame: f.code },
        success_url: `${C.base}/frame/${f.code}?ok=${encodeURIComponent('Yours. Give the screen a moment.')}`, cancel_url: `${C.base}/frame/${f.code}` });
      db.prepare('UPDATE licenses SET stripe_session=? WHERE set_ref=?').run(ss.id, setRef);
      res.redirect(303, ss.url);
    } catch (e) { console.error('[frame]', e.message); db.prepare("DELETE FROM licenses WHERE set_ref=? AND status='awaiting_payment'").run(setRef); res.redirect(`/frame/${f.code}?ok=${encodeURIComponent('Checkout could not open.')}`); }
  });

  app.locals.frame = { resolve, state, frame, EVERY, MUSIC };
  return app.locals.frame;
}

// ---- Pages ----
const setOptions = ({ hangs, makers, series, b, current }) => {
  const opt = (v, t) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(t)}</option>`;
  return `${opt('today', 'The house, today: the best of what hangs')}${b ? opt('gallery', 'My gallery: what I have collected') : ''}
${series.length ? `<optgroup label="Series">${series.map(s => opt('series:' + s.slug, s.title)).join('')}</optgroup>` : ''}
${hangs.length ? `<optgroup label="Walls hung by curators">${hangs.map(h => opt('hang:' + h.slug, h.title + (h.public ? '' : ' (yours)'))).join('')}</optgroup>` : ''}
${makers.length ? `<optgroup label="One maker">${makers.map(m => opt('maker:' + m.handle, m.name)).join('')}</optgroup>` : ''}`;
};

function framePage({ b, hangs, makers, series, frames, on, q }) {
  return layout({ title: 'The frame · Watermark', desc: 'Photographs from the house, cycling on your television, chosen for the evening.', path: '/frame', body: `<section class="narrow fr">
<p class="k">The frame</p><h1>Photographs on the wall, chosen for the evening.</h1>
<p class="lede">Open the house on a television and let it cycle: the best of what hangs, one maker, a wall a curator hung, a series, or whatever you ask for ("Florence", "domes", "the sea"). Your phone is the remote. Pieces you have collected show at full size; everything else shows with its plate, and the whole set can be collected in one tap.</p>
<div class="fr-two">
<div class="fr-card"><p class="k">On a television</p><h2>Pair a screen.</h2><p>Open <b>${esc(String(process.env.BASE_URL || '').replace(/^https?:\/\//, '') || 'watermark.krafftco.com')}/tv</b> in the television's browser, or cast this page to it. It shows five letters; type them here and the screen is yours.</p>
<form method="get" action="/frame/pair" class="form fr-pair"><input name="code" placeholder="ABCDE" maxlength="5" autocapitalize="characters" autocomplete="off" required pattern="[A-Za-z]{5}"><button class="jewel">Hold the remote</button></form>
<p class="note">Samsung Frame, LG, Sony: use the set's browser or cast from a phone (AirPlay, Chromecast). Apple TV: AirPlay this page from a phone or Mac. Fire TV: the Silk browser.</p></div>
<div class="fr-card"><p class="k">On this screen</p><h2>Play here.</h2><form method="get" action="/frame/tv" class="form fr-play"><label>What to show<select name="set">${setOptions({ hangs, makers, series, b, current: 'today' })}</select></label><label>Or ask for<input name="q" placeholder="Florence, domes, the sea…" value="${esc(q)}" maxlength="60"></label><button class="jewel">Open the frame</button></form><p class="note">Full screen, slow, no controls on the wall: arrows move, space pauses, Esc leaves.</p></div>
</div>
${frames.length ? `<h2>Your screens</h2><ul class="fr-list">${frames.map(f => `<li><a href="/frame/${esc(f.code)}"><b>${esc(f.code)}</b> ${esc(f.title || f.set_kind)}${f.seen_at ? ` · seen ${esc(f.seen_at.slice(0, 16))}` : ''}</a></li>`).join('')}</ul>` : ''}
<h2>How it is licensed</h2>
<p>At home, among friends, a screen is a wall: the photographs cycle freely at screen size with their plates, as they hang in the house. A piece you collect ($5, yours to keep and share) shows at full size and without the plate. A restaurant, a lobby, a shop window: that is a public display, by letter to the house, priced for the room. ${on ? '' : 'Collecting opens with payments.'}</p>
<p class="note">A draft until Will confirms. Music: the frame can make its own quiet, or play a stream you already have the right to play; the house does not stream music it has not licensed.</p>
</section><script>document.querySelector('.fr-play').addEventListener('submit',function(e){var q=this.q.value.trim();if(q){this.set.value='q:'+q}this.q.disabled=true});</script>` });
}
// /tv and /frame/pair are small doors.
function tvPage({ code, first, base, waiting }) {
  return layout({ title: 'The frame · Watermark', bare: true, path: '/frame/tv', body: `<main class="fm" data-tv data-code="${esc(code)}" data-waiting="${waiting ? 1 : 0}">
<figure class="fm-fig"><img class="fm-im" alt="" decoding="async"><img class="fm-im fm-next" alt="" decoding="async"></figure>
<div class="fm-plate" data-tv-plate><p class="fm-k" data-tv-k></p><h1 class="fm-t" data-tv-t></h1><p class="fm-by" data-tv-by></p></div>
<div class="fm-wait" data-tv-wait${waiting ? '' : ' hidden'}><img src="/static/watermark-logo.svg" alt="Watermark" class="fm-logo"><p class="fm-k">On your phone, open</p><p class="fm-url">${esc(base.replace(/^https?:\/\//, ''))}/frame</p><p class="fm-k">and type</p><p class="fm-code">${esc(code)}</p><p class="fm-note">Or press space to begin with the house's choice.</p></div>
<div class="fm-corner" data-tv-corner><span class="fm-cc">${esc(code)}</span><span class="fm-sound" data-tv-sound hidden>Tap for sound</span></div>
</main><script>window.__WM_TV=${JSON.stringify(first).replace(/</g, '\\u003c')};</script><script src="/static/frame.js?v=${Date.now().toString(36).slice(0, 5)}" defer></script>` });
}
function remotePage({ f, st, b, hangs, makers, series, own, ok, collect }) {
  const current = f.set_kind === 'today' || f.set_kind === 'gallery' ? f.set_kind : `${f.set_kind}:${f.set_key}`;
  return layout({ title: `Remote ${f.code} · The frame · Watermark`, bare: false, path: `/frame/${f.code}`, body: `<section class="narrow fr fr-remote">
<p class="k">The remote · <b>${esc(f.code)}</b></p><h1>${esc(st.title)}.</h1>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
<p class="lede">${st.works.length} photographs on the screen, one every ${f.every >= 60 ? `${f.every / 60} minute${f.every >= 120 ? 's' : ''}` : `${f.every} seconds`}.${!own ? ' This screen is held by someone else; you may watch.' : ''}</p>
${collect.n ? `<div class="fr-collect"><p class="k">Collect the set</p><p>${collect.n} of these are not yet yours. Collect them for ${money(collect.total)}: each becomes yours to keep, share and hang, numbered in your gallery, and shows at full size on the wall tonight.</p>
<form method="post" action="/frame/${esc(f.code)}/collect" class="form inline">${collect.pocket >= collect.total ? `<button class="jewel" name="from" value="pocket">Collect all ${collect.n}, ${money(collect.total)} from my pocket</button>` : collect.on ? `<button class="jewel">Collect all ${collect.n}, ${money(collect.total)}</button>` : '<span class="note">Collecting opens with payments.</span>'}</form></div>` : (b ? '<p class="note">Every piece on the screen is yours.</p>' : `<p class="note"><a href="/signin?next=${encodeURIComponent('/frame/' + f.code)}">Sign in</a> to collect the set.</p>`)}
${own ? `<form method="post" action="/frame/${esc(f.code)}" class="form fr-form">
<label>What to show<select name="set">${setOptions({ hangs, makers, series, b, current })}${f.set_kind === 'q' ? `<option value="q:${esc(f.set_key)}" selected>Asked for: ${esc(f.set_key)}</option>` : ''}</select></label>
<label>Or ask for<input name="q" placeholder="Florence, domes, the sea…" maxlength="60"></label>
<div class="fr-row"><label>Change every<select name="every">${EVERY_OPTS(f.every)}</select></label>
<label>Plate<select name="plate">${['brief', 'always', 'never'].map(p => `<option value="${p}"${f.plate === p ? ' selected' : ''}>${p === 'brief' ? 'A moment, then fades' : p === 'always' ? 'Always shown' : 'Never'}</option>`).join('')}</select></label></div>
<div class="fr-row"><label>Music<select name="music">${Object.entries(MUSIC).map(([k, t]) => `<option value="${k}"${f.music === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
<label>Your stream<input name="music_url" placeholder="https://… (a stream you may play)" value="${esc(f.music_url || '')}"></label></div>
<label>A title for the evening <small>optional</small><input name="title" value="${esc(f.title || '')}" maxlength="80" placeholder="${esc(st.title)}"></label>
<button class="jewel">Put it on the screen</button></form>
<script>document.querySelector('.fr-form').addEventListener('submit',function(){var q=this.q.value.trim();if(q){this.set.value='q:'+q;var o=document.createElement('option');o.value='q:'+q;o.selected=true;this.set.appendChild(o)}this.q.disabled=true});</script>` : ''}
<h2>On the screen now</h2><ul class="fr-grid">${st.works.slice(0, 48).map(w => `<li class="${w.held ? 'held' : ''}"><a href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span>${esc(w.title)}${w.held ? ' · yours' : ''}</span></a></li>`).join('')}</ul>
<p class="note">Pieces marked yours show at full size without the plate. <a href="/frame">The frame</a> · <a href="/frame/tv?code=${esc(f.code)}">Open this screen here</a></p>
</section>` });
}
const EVERY_OPTS = cur => EVERY.map(s => `<option value="${s}"${s === cur ? ' selected' : ''}>${s >= 60 ? `${s / 60} minute${s >= 120 ? 's' : ''}` : `${s} seconds`}</option>`).join('');

module.exports = { mountFrame };
