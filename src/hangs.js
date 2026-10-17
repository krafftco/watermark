// Curators. A collector holds the work; a curator hangs it. Anyone with an eye can make a hang: a titled wall
// of photographs from the collection, in an order, with a line on each if they like, whether or not they hold
// a single one. A hang is public at /hang/:slug and listed with the galleries. When someone comes to a hang (or
// a gallery), likes what they see and collects from it, the curator earns a share of that sale from the
// house's side (CURATOR_PCT, a draft), credited to their pocket at once; and anyone may thank a curator with a
// card. What a curator earns can be spent in the house or cashed out (pocket.js). The maker's 85% is untouched.
const { layout, esc, money, date, tidy } = require('./views');
const CURATOR_PCT = 5;      // of the sale price, paid from the house's share; a draft
const VIA_DAYS = 30;

function mountHangs(app, { db, C, V, stripe, buyerOf, setBuyer, ledger, pocket, mk }) {
  db.exec(`CREATE TABLE IF NOT EXISTS hangs (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, line TEXT, public INTEGER NOT NULL DEFAULT 0,
      sales INTEGER NOT NULL DEFAULT 0, earned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS hang_works (hang_id INTEGER NOT NULL, work_id INTEGER NOT NULL, pos INTEGER NOT NULL DEFAULT 0, note TEXT, PRIMARY KEY (hang_id, work_id));
    CREATE TABLE IF NOT EXISTS hang_thanks (id INTEGER PRIMARY KEY, hang_id INTEGER NOT NULL, cents INTEGER NOT NULL, word TEXT, name TEXT, status TEXT NOT NULL DEFAULT 'pending', stripe_session TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('licenses') WHERE name='via'").get()) db.exec('ALTER TABLE licenses ADD COLUMN via TEXT');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('buyers') WHERE name='statement'").get()) db.exec('ALTER TABLE buyers ADD COLUMN statement TEXT');
  const { nanoid } = require('nanoid');
  const slugOf = t => (String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'hang') + '-' + nanoid(5).toLowerCase();
  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: VIA_DAYS * 864e5 };

  const byId = id => db.prepare('SELECT h.*, b.name AS curator, b.code AS curator_code, b.public AS curator_public FROM hangs h JOIN buyers b ON b.id=h.buyer_id WHERE h.id=?').get(Number(id));
  const bySlug = s => db.prepare('SELECT h.*, b.name AS curator, b.code AS curator_code, b.public AS curator_public FROM hangs h JOIN buyers b ON b.id=h.buyer_id WHERE h.slug=?').get(String(s));
  const worksOf = h => db.prepare("SELECT w.*, hw.pos, hw.note, m.name AS maker, m.handle FROM hang_works hw JOIN works w ON w.id=hw.work_id JOIN makers m ON m.id=w.maker_id WHERE hw.hang_id=? AND w.status='held' ORDER BY hw.pos, w.id").all(h.id);
  const mine = b => (b ? db.prepare('SELECT h.*, (SELECT COUNT(*) FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=h.id AND w.status=\'held\') AS n FROM hangs h WHERE buyer_id=? ORDER BY updated_at DESC').all(b.id) : []);
  const publicHangs = () => db.prepare("SELECT h.*, b.name AS curator, b.code AS curator_code, (SELECT COUNT(*) FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=h.id AND w.status='held') AS n FROM hangs h JOIN buyers b ON b.id=h.buyer_id WHERE h.public=1 ORDER BY h.sales DESC, h.updated_at DESC LIMIT 100").all().filter(h => h.n > 0).map(h => ({ ...h, thumbs: worksOf(h).slice(0, 5) }));
  const touch = id => db.prepare("UPDATE hangs SET updated_at=datetime('now') WHERE id=?").run(id);
  const own = (req, id) => { const b = buyerOf(req), h = b && byId(id); return h && h.buyer_id === b.id ? h : null; };
  const ensure = (req, res) => { let b = buyerOf(req); if (!b) { const id = db.prepare("INSERT INTO buyers (customer, email, code) VALUES ('', NULL, ?)").run(nanoid(10)).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); } return b; };

  // Whose wall brought the visitor: a hang or a gallery, remembered for thirty days.
  const via = (res, what) => res.cookie('wm_via', what, cookieOpts);
  const viaOf = req => (req.cookies && req.cookies.wm_via) || null;
  app.use('/collector/:code', (req, res, next) => { if (/^[A-Za-z0-9_-]{6,20}$/.test(req.params.code)) via(res, `gallery:${req.params.code}`); next(); });
  const stampVia = (req, ref) => { const v = viaOf(req); if (v) db.prepare('UPDATE licenses SET via=? WHERE ref=? AND via IS NULL').run(v, ref); };

  // The curator's share, on a paid sale that came through their wall. The maker's share is untouched; this is the house's.
  function reward(l, w) {
    if (!l.via || !(l.price_cents > 0)) return null;
    const [kind, key] = String(l.via).split(':');
    const h = kind === 'hang' ? byId(key) : null;
    const curator = h ? db.prepare('SELECT * FROM buyers WHERE id=?').get(h.buyer_id) : kind === 'gallery' ? db.prepare('SELECT * FROM buyers WHERE code=?').get(String(key)) : null;
    if (!curator || curator.id === l.buyer_id) return null;
    const mkr = mk(w); if (mkr && mkr.buyer_id === curator.id) return null;           // a maker is not paid for selling their own work twice
    const cents = Math.round(l.price_cents * CURATOR_PCT / 100); if (cents < 1) return null;
    pocket.credit(curator, cents, 'curation', l.ref, `${tidy(w.title)}, collected through your ${h ? 'hang' : 'gallery'}`);
    if (h) db.prepare('UPDATE hangs SET sales=sales+1, earned=earned+? WHERE id=?').run(cents, h.id);
    ledger.append(db, 'curation.earned', l.ref, { work: w.slug, via: l.via, amount: cents });
    return { curator, cents, hang: h };
  }

  // The walls.
  app.get('/hangs', (req, res) => res.send(hangsPage({ hangs: publicHangs(), me: buyerOf(req) })));
  app.get('/hang/:slug', (req, res) => {
    const h = bySlug(req.params.slug); if (!h) return res.sendStatus(404);
    const b = buyerOf(req), isOwn = b && b.id === h.buyer_id;
    if (!h.public && !isOwn) return res.sendStatus(404);
    if (h.public) via(res, `hang:${h.id}`);
    res.send(hangPage({ h, works: worksOf(h), own: !!isOwn, thanks: thanksOf(h), state: req.query.thanks || null, pocket: b && pocket ? pocket.balance(b) : 0, on: !!stripe, pct: CURATOR_PCT }));
  });
  // Making one, and hanging work on it.
  app.post('/hangs/new', (req, res) => {
    const b = ensure(req, res), x = req.body || {}; const title = String(x.title || '').trim().slice(0, 80); if (!title) return res.redirect('/yours?tab=hangs');
    const id = db.prepare('INSERT INTO hangs (buyer_id, slug, title, line) VALUES (?,?,?,?)').run(b.id, slugOf(title), title, String(x.line || '').trim().slice(0, 600) || null).lastInsertRowid;
    if (x.work) { const w = db.prepare("SELECT id FROM works WHERE slug=? AND status='held'").get(String(x.work)); if (w) db.prepare('INSERT OR IGNORE INTO hang_works (hang_id, work_id, pos) VALUES (?,?,0)').run(id, w.id); return res.redirect(`/w/${x.work}?hung=${id}`); }
    res.redirect(`/hang/${byId(id).slug}`);
  });
  app.post('/hang/add', (req, res) => {
    const b = ensure(req, res), x = req.body || {}; const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(x.work || '')); if (!w) return res.sendStatus(404);
    let h = x.hang === 'new' ? null : own(req, x.hang);
    if (!h) { const title = String(x.title || '').trim().slice(0, 80) || 'A hang'; const id = db.prepare('INSERT INTO hangs (buyer_id, slug, title) VALUES (?,?,?)').run(b.id, slugOf(title), title).lastInsertRowid; h = byId(id); }
    const pos = db.prepare('SELECT COALESCE(MAX(pos),0)+1 p FROM hang_works WHERE hang_id=?').get(h.id).p;
    db.prepare('INSERT OR IGNORE INTO hang_works (hang_id, work_id, pos) VALUES (?,?,?)').run(h.id, w.id, pos); touch(h.id);
    res.redirect(`/w/${w.slug}?hung=${h.id}`);
  });
  app.post('/hang/:id/edit', (req, res) => {
    const h = own(req, req.params.id); if (!h) return res.sendStatus(404); const x = req.body || {};
    const wasPublic = h.public, pub = x.public === '1' ? 1 : 0;
    db.prepare("UPDATE hangs SET title=?, line=?, public=?, updated_at=datetime('now') WHERE id=?").run(String(x.title || h.title).trim().slice(0, 80) || h.title, String(x.line || '').trim().slice(0, 600) || null, pub, h.id);
    if (pub && !wasPublic) ledger.append(db, 'hang.opened', `hang-${h.id}`, { title: h.title, slug: h.slug });
    res.redirect(`/hang/${h.slug}`);
  });
  app.post('/hang/:id/work', (req, res) => {
    const h = own(req, req.params.id); if (!h) return res.sendStatus(404); const x = req.body || {};
    const w = db.prepare('SELECT id FROM works WHERE slug=?').get(String(x.work || '')); if (!w) return res.redirect(`/hang/${h.slug}`);
    if (x.do === 'remove') db.prepare('DELETE FROM hang_works WHERE hang_id=? AND work_id=?').run(h.id, w.id);
    else if (x.do === 'note') db.prepare('UPDATE hang_works SET note=? WHERE hang_id=? AND work_id=?').run(String(x.note || '').trim().slice(0, 400) || null, h.id, w.id);
    else if (x.do === 'up' || x.do === 'down') {
      const rows = db.prepare('SELECT work_id, pos FROM hang_works WHERE hang_id=? ORDER BY pos, work_id').all(h.id); const i = rows.findIndex(r => r.work_id === w.id), j = x.do === 'up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < rows.length) { [rows[i], rows[j]] = [rows[j], rows[i]]; const up = db.prepare('UPDATE hang_works SET pos=? WHERE hang_id=? AND work_id=?'); rows.forEach((r, k) => up.run(k, h.id, r.work_id)); }
    }
    touch(h.id); res.redirect(`/hang/${h.slug}`);
  });
  app.post('/hang/:id/delete', (req, res) => { const h = own(req, req.params.id); if (!h) return res.sendStatus(404); db.prepare('DELETE FROM hang_works WHERE hang_id=?').run(h.id); db.prepare('DELETE FROM hangs WHERE id=?').run(h.id); res.redirect('/yours?tab=hangs'); });
  app.post('/yours/statement', (req, res) => { const b = buyerOf(req); if (!b) return res.redirect('/yours'); db.prepare('UPDATE buyers SET statement=? WHERE id=?').run(String((req.body || {}).statement || '').trim().slice(0, 400) || null, b.id); res.redirect('/yours?tab=hangs'); });

  // A card for the curator: from the pocket at once, else Checkout; lands in the curator's pocket.
  const thanksOf = h => ({ n: db.prepare("SELECT COUNT(*) n FROM hang_thanks WHERE hang_id=? AND status='paid'").get(h.id).n });
  app.post('/hang/:id/thanks', async (req, res) => {
    const h = byId(req.params.id); if (!h || !h.public) return res.sendStatus(404); const x = req.body || {};
    const cents = x.amount === 'own' ? Math.round(Number(String(x.own || '').replace(/[^0-9.]/g, '')) * 100) : Math.round(Number(x.amount));
    if (!(cents >= 99 && cents <= 500000)) return res.redirect(`/hang/${h.slug}#thanks`);
    const word = String(x.word || '').trim().slice(0, 280) || null, curator = db.prepare('SELECT * FROM buyers WHERE id=?').get(h.buyer_id);
    const b = buyerOf(req);
    if (b && b.id !== h.buyer_id && pocket.spend(b, cents, 'thanks', `hang-${h.id}`, `${h.curator || 'a curator'}, for ${h.title}`)) {
      db.prepare("INSERT INTO hang_thanks (hang_id, cents, word, name, status) VALUES (?,?,?,?,'paid')").run(h.id, cents, word, b.name || null);
      pocket.credit(curator, cents, 'thanks_in', `hang-${h.id}`, `A card for ${h.title}${word ? `: ${word}` : ''}`);
      ledger.append(db, 'thanks.given', `hang-${h.id}`, { hang: h.slug, amount: cents, from: 'pocket' });
      return res.redirect(`/hang/${h.slug}?thanks=given#thanks`);
    }
    if (!stripe) return res.redirect(`/hang/${h.slug}?thanks=off#thanks`);
    const id = db.prepare('INSERT INTO hang_thanks (hang_id, cents, word) VALUES (?,?,?)').run(h.id, cents, word).lastInsertRowid;
    try {
      const s = await stripe.checkout.sessions.create({ mode: 'payment', submit_type: 'donate', customer_creation: 'always',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `Thank you, ${h.curator || 'curator'}`, description: `For the hang "${h.title}". The house keeps nothing of this.` } } }],
        metadata: { hangthanks: String(id) }, payment_intent_data: { metadata: { hangthanks: String(id) } },
        success_url: `${C.base}/hang/${h.slug}/thanked?id=${id}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${C.base}/hang/${h.slug}#thanks` });
      db.prepare('UPDATE hang_thanks SET stripe_session=? WHERE id=?').run(s.id, id);
      res.redirect(303, s.url);
    } catch (e) { console.error('[hang thanks]', e.message); db.prepare('DELETE FROM hang_thanks WHERE id=?').run(id); res.redirect(`/hang/${h.slug}?thanks=off#thanks`); }
  });
  function settleThanks(id, s) {
    const t = db.prepare('SELECT * FROM hang_thanks WHERE id=?').get(Number(id)); if (!t || t.status !== 'pending' || t.stripe_session !== s.id || s.payment_status !== 'paid') return;
    const h = byId(t.hang_id); const d = s.customer_details || {};
    db.prepare("UPDATE hang_thanks SET status='paid', name=COALESCE(name, ?) WHERE id=?").run(d.name || null, t.id);
    pocket.credit(db.prepare('SELECT * FROM buyers WHERE id=?').get(h.buyer_id), t.cents, 'thanks_in', `hang-${h.id}`, `A card for ${h.title}${t.word ? `: ${t.word}` : ''}`);
    ledger.append(db, 'thanks.given', `hang-${h.id}`, { hang: h.slug, amount: t.cents });
  }
  app.get('/hang/:slug/thanked', async (req, res) => {
    const h = bySlug(req.params.slug); if (!h) return res.sendStatus(404);
    const t = db.prepare('SELECT * FROM hang_thanks WHERE id=?').get(Number(req.query.id));
    if (t && t.status === 'pending' && stripe && t.stripe_session === req.query.session_id) { try { settleThanks(t.id, await stripe.checkout.sessions.retrieve(t.stripe_session)); } catch (e) { /* webhook */ } }
    res.redirect(`/hang/${h.slug}?thanks=given#thanks`);
  });
  app.locals.hangEvent = event => { if (event.type === 'checkout.session.completed') { const s = event.data.object; if (s.metadata && s.metadata.hangthanks) settleThanks(s.metadata.hangthanks, s); } };

  app.locals.hangs = { mine, publicHangs, reward, stampVia, viaOf, byId, bySlug, worksOf, CURATOR_PCT };
  return app.locals.hangs;
}

// On the wall: one photograph at a time, in the curator's order, the curator's line beneath; a hang is walked, not scanned.
const plate = (w, note, i) => `<figure class="hg-fig"><a class="hg-im" href="/w/${esc(w.slug)}" style="--r:${(w.width && w.height ? w.width / w.height : 1.5).toFixed(3)}"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="${i < 2 ? 'eager' : 'lazy'}" draggable="false"></a><figcaption><span class="hg-n">${i + 1}</span><b><a href="/w/${esc(w.slug)}">${esc(tidy(w.title))}</a></b><i>${esc(w.maker)}${w.place ? `, ${esc(w.place)}` : ''}</i>${note ? `<p class="hg-note">${esc(note)}</p>` : ''}</figcaption></figure>`;

// The curated walls, with the galleries.
function hangsPage({ hangs, me }) {
  return layout({ title: 'Hangs · Watermark', desc: 'Walls hung by people with an eye: photographs from the collection, chosen and ordered.', path: '/hangs', body: `<section class="cx-intro"><p class="k">Hangs</p><h1>Walls hung by people with an eye.</h1>
<p class="lede">A curator need not own a thing. They choose, and order, and say why. Walk a hang; collect from it, and the curator earns a share of that sale from the house, never from the maker. <a href="/yours?tab=hangs">Hang a wall of your own.</a></p></section>
<section class="gal">${hangs.length ? `<div class="hg-cards">${hangs.map(hangCard).join('')}</div>` : '<p class="note">No wall is hung yet. Yours could be the first.</p>'}</section>` });
}
const hangCard = h => `<a class="hg-card" href="/hang/${esc(h.slug)}"><span class="hg-th">${h.thumbs.map(w => `<img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy" draggable="false">`).join('')}</span><b>${esc(h.title)}</b><span>Hung by ${esc(h.curator || 'a curator')} · ${h.n} photograph${h.n === 1 ? '' : 's'}${h.sales ? ` · ${h.sales} collected from it` : ''}</span>${h.line ? `<small>${esc(h.line)}</small>` : ''}</a>`;

function hangPage({ h, works, own, thanks, state, pocket, on, pct }) {
  const notice = { given: 'Your card is with the curator. Thank you.', off: 'The till is closed for the moment.' }[state];
  const first = h.curator ? h.curator.split(' ')[0] : 'the curator';
  return layout({ title: `${h.title} · Watermark`, desc: h.line || `A wall hung by ${h.curator || 'a curator'}.`, body: `<section class="cx-intro hg-head"><p class="k">A hang${h.public ? '' : ' · private, yours alone'}</p><h1>${esc(h.title)}.</h1>
<p class="hg-by">Hung by ${h.curator_public && h.curator_code ? `<a href="/collector/${esc(h.curator_code)}">${esc(h.curator || 'a curator')}</a>` : esc(h.curator || 'a curator')} · ${works.length} photograph${works.length === 1 ? '' : 's'}${h.sales ? ` · ${h.sales} collected from this wall` : ''}</p>
${h.line ? `<p class="lede">${esc(h.line)}</p>` : ''}
${own ? `<details class="hg-edit"><summary>Edit the hang</summary><form method="post" action="/hang/${h.id}/edit" class="cl-f"><label><span>Title</span><input name="title" value="${esc(h.title)}" maxlength="80" required></label><label><span>A line on the wall</span><textarea name="line" rows="3" maxlength="600">${esc(h.line || '')}</textarea></label><label class="cl-oath"><input type="checkbox" name="public" value="1" ${h.public ? 'checked' : ''}> Show it: list it with the galleries, and earn ${pct}% of what is collected through it</label><button class="buy-btn">Save</button></form><form method="post" action="/hang/${h.id}/delete" onsubmit="return confirm('Take this wall down? The photographs stay in the collection.')"><button class="link">Take the wall down</button></form></details>` : ''}</section>
<section class="hg-wall">${works.map((w, i) => `<div class="hg-pl">${plate(w, w.note, i)}${own ? `<form method="post" action="/hang/${h.id}/work" class="hg-ctl"><input type="hidden" name="work" value="${esc(w.slug)}"><button name="do" value="up">Earlier</button><button name="do" value="down">Later</button><input name="note" placeholder="A line on this one, for the wall" value="${esc(w.note || '')}" maxlength="400"><button name="do" value="note">Keep the line</button><button name="do" value="remove" class="hg-rm">Take it down</button></form>` : ''}</div>`).join('') || '<p class="note hg-empty">Nothing on the wall yet. On any photograph, choose <i>Hang it</i>.</p>'}</section>
${h.public && !own ? `<section class="ty hg-ty" id="thanks"><div class="ty-in"><p class="k">A card for ${esc(first)}</p><h2>Thank the eye.</h2><p class="lede">Curators are not paid to hang a wall. If this one gave you something, send ${esc(first)} a card: ninety-nine cents, or what you like, with a word. The house keeps nothing of it.${thanks.n ? ` ${thanks.n} card${thanks.n === 1 ? '' : 's'} so far.` : ''}</p>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<form method="post" action="/hang/${h.id}/thanks" class="ty-f"${pocket >= 99 ? ' data-pocket="1"' : ''}><div class="ty-amts">${[99, 499, 999].map((c, i) => `<label><input type="radio" name="amount" value="${c}" ${i === 0 ? 'checked' : ''}><span>${money(c)}</span></label>`).join('')}<label class="ty-own"><input type="radio" name="amount" value="own"><span>Or</span><input name="own" inputmode="decimal" placeholder="$"></label></div><input name="word" placeholder="A word, if you like" maxlength="280"><button class="buy-btn" ${on || pocket >= 99 ? '' : 'disabled'}>Send the card</button></form></div></section>` : ''}` });
}

// Yours → Hangs: the curator's room.
function hangsBlock({ hangs, b, pct, earned }) {
  return `<section class="gal yc-hangs"><header class="gh"><h2>Your hangs</h2><span>${hangs.length} wall${hangs.length === 1 ? '' : 's'}</span></header>
<p class="lede pk-lede">A collector holds the work; a curator hangs it. Choose photographs from the whole collection, put them in an order, say why. Show a wall and it is listed with the galleries; collect from it and ${pct}% of the sale is yours, from the house's side${earned ? ` (so far ${money(earned)})` : ''}. Yours to spend here, or to cash out.</p>
${hangs.length ? `<div class="hg-list">${hangs.map(h => `<a class="hd-ev" href="/hang/${esc(h.slug)}"><span>${h.public ? 'Shown' : 'Private'}</span><b>${esc(h.title)}</b><span>${h.n} photograph${h.n === 1 ? '' : 's'}${h.sales ? ` · ${h.sales} collected · ${money(h.earned)} earned` : ''}</span><span class="hd-v">Open</span></a>`).join('')}</div>` : ''}
<form method="post" action="/hangs/new" class="cl-f hg-new"><label><span>A new wall</span><input name="title" placeholder="Its title" maxlength="80" required></label><label><span>A line on it (optional)</span><input name="line" maxlength="600" placeholder="What holds these together"></label><button class="buy-btn">Hang it</button></form>
<form method="post" action="/yours/statement" class="cl-f hg-st"><label><span>Your eye, in a line (shown with your gallery and your hangs)</span><input name="statement" value="${esc(b.statement || '')}" maxlength="400" placeholder="What you look for"></label><button class="link">Keep</button></form></section>`;
}

// On the work page: hang it on one of mine.
function hangIt({ w, hangs, hung }) {
  return `<div class="hg-it" id="hang">${hung ? `<p class="ok">Hung. <a href="/hang/${esc(hung.slug)}">See the wall</a>.</p>` : ''}<form method="post" action="/hang/add" class="hg-itf"><input type="hidden" name="work" value="${esc(w.slug)}"><label>Hang it <select name="hang">${hangs.map(h => `<option value="${h.id}">${esc(h.title)}</option>`).join('')}<option value="new">On a new wall…</option></select></label><input name="title" placeholder="Title of the new wall" maxlength="80"><button class="link">Hang</button></form><p class="note">A hang is a wall you curate from the whole collection, yours to show; ${CURATOR_PCT}% of what is collected through it is yours.</p></div>`;
}

module.exports = { mountHangs, hangsPage, hangPage, hangsBlock, hangIt, hangCard, CURATOR_PCT };
