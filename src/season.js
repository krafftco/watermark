// The season, the Circle and the cards (Will, 19 Oct: "why would someone go to the balcony lounge late at night at the
// museum? why do they go to the late night at the Met, to the Apollo Circle gala? … People need to be able to meet
// each other through Watermark, and that's the thing that's distinct … a social club, a museum, a place to experience
// it in the real world … everything centred on bringing people to the real world; we are going to throw events … our
// version of the Apollo Circle that people pay to be part of: a young members' circle … something billionaires and
// people want to be a part of"). Not a dating app, not a feed: a members' club with a calendar. Three things:
//   The season: the nights the house throws (an opening, a late night, a dinner, a salon, a screening, a walk), each
//     a page with the picture, the words, the artists present, who is coming (first names, to those going), the reply.
//   The Circle: the young members, under forty, by the year (drafts: $600; $1,200 with a guest to every night). Theirs
//     first: every night opens to the Circle before the keys. A key comes with it (the collector's).
//   The card: how two people meet. Over a work, a line or a night, one keyholder leaves a card for another (a sentence,
//     at most one a day, never the same person twice); if the other says yes, the house introduces them by letter, to
//     both at once, and gets out of the way. A no is never told. Nothing of it on the wall or the register.
// Why it is not disgusting: you meet over the work, under your name, in a sentence, and only when both say yes; the
// house asks for no photograph of you; the picture on every page is a work. Every word a draft for Will.
const mail = require('./mail');
const CIRCLE = {
  circle: { key: 'circle', name: 'The Circle', cents: Number(process.env.CIRCLE_CENTS) || 60000, line: 'Every night of the season, first. The dinner, the artists, the introductions. A key.' },
  guest: { key: 'guest', name: 'The Circle, with a guest', cents: Number(process.env.CIRCLE_GUEST_CENTS) || 120000, line: 'The same, and a guest beside you at every night.' },
};
const KINDS = { opening: 'An opening', late: 'A late night', dinner: 'The dinner', salon: 'A salon', screening: 'A screening', walk: 'A walk', party: 'A party' };
const CIRCLE_FIRST_HOURS = Number(process.env.CIRCLE_FIRST_HOURS) || 48;

function mountSeason(app, { db, V, C, ledger, stripe, buyerOf, setBuyer, makerOf, isStudio, notify }) {
  db.exec(`CREATE TABLE IF NOT EXISTS circle (id INTEGER PRIMARY KEY, buyer_id INTEGER, maker_id INTEGER, name TEXT, email TEXT, level TEXT NOT NULL, cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      attest INTEGER NOT NULL DEFAULT 0, stripe_session TEXT, stripe_sub TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), started_at TEXT, ended_at TEXT);
    CREATE TABLE IF NOT EXISTS nights (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, line TEXT, body TEXT, kind TEXT NOT NULL DEFAULT 'late', city TEXT, venue TEXT, address TEXT,
      at TEXT NOT NULL, ends_at TEXT, capacity INTEGER NOT NULL DEFAULT 0, circle_first INTEGER NOT NULL DEFAULT 1, work_slug TEXT, hang_slug TEXT, makers TEXT, host TEXT, status TEXT NOT NULL DEFAULT 'draft',
      came INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS night_guests (id INTEGER PRIMARY KEY, night_id INTEGER NOT NULL, buyer_id INTEGER, maker_id INTEGER, name TEXT NOT NULL, email TEXT, plus INTEGER NOT NULL DEFAULT 0, note TEXT,
      status TEXT NOT NULL DEFAULT 'going', at TEXT NOT NULL DEFAULT (datetime('now')), came INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS ng_night ON night_guests(night_id, status);
    CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY, from_owner TEXT NOT NULL, to_owner TEXT NOT NULL, about TEXT, note TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), answer TEXT, answered_at TEXT, introduced_at TEXT);
    CREATE INDEX IF NOT EXISTS cards_to ON cards(to_owner, at);
    CREATE TABLE IF NOT EXISTS meet_prefs (owner TEXT PRIMARY KEY, open INTEGER NOT NULL DEFAULT 1, line TEXT)`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('nights') WHERE name='menu'").get()) db.exec('ALTER TABLE nights ADD COLUMN menu TEXT');
  const { esc, tidy, date } = V;
  const base = C.base;
  // The Keyhole Room: a dinner is not first come. Names go down ('asked'); the house draws the table (the Circle first,
  // then by the order of asking), DINNER_SEATS (12) at one table, and the drawn are seated ('going'); the rest are told
  // kindly and kept for the next. The menu and the address go only to those seated.
  const DINNER_SEATS = Number(process.env.DINNER_SEATS) || 12;
  const isDinner = n => n.kind === 'dinner';
  const asked = id => db.prepare("SELECT * FROM night_guests WHERE night_id=? AND status='asked' ORDER BY at").all(id);
  const money = c => '$' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const when = s => s ? new Date(s).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: process.env.BALCONY_TZ || 'America/New_York' }) : '';
  const slow = (() => { const hits = new Map(); return (k, n = 6) => { const now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 600000); a.push(now); hits.set(k, a); return a.length > n; }; })();

  // Who someone is: an owner key ('b:<id>' | 'm:<id>'), a name for the room (first name on the wall, the whole name in a letter).
  function who(req) {
    const b = buyerOf(req), m = makerOf(req);
    if (!b && !m) return null;
    const owner = b ? `b:${b.id}` : `m:${m.id}`;
    const name = (m && m.name) || (b && b.name) || givenName(owner) || '', email = (b && b.email) || (m && m.email) || '';
    return { b, m, owner, name, email, first: name.split(/\s+/)[0] || 'A guest' };
  }
  // A collector's gallery may carry no name; the name they gave the Circle or a night stands in for it.
  function givenName(o) {
    const [k, id] = String(o).split(':'), col = k === 'b' ? 'buyer_id' : 'maker_id';
    const c = db.prepare(`SELECT name FROM circle WHERE ${col}=? AND name IS NOT NULL ORDER BY id DESC LIMIT 1`).get(Number(id)); if (c) return c.name;
    const g = db.prepare(`SELECT name FROM night_guests WHERE ${col}=? ORDER BY id DESC LIMIT 1`).get(Number(id)); return g ? g.name : '';
  }
  const ownerOf = o => { const [k, id] = String(o || '').split(':'); if (k === 'b') return { b: db.prepare('SELECT * FROM buyers WHERE id=?').get(Number(id)) }; if (k === 'm') return { m: db.prepare('SELECT * FROM makers WHERE id=?').get(Number(id)) }; return {}; };
  const nameOf = o => { const { b, m } = ownerOf(o); return (m && m.name) || (b && b.name) || givenName(o) || (b || m ? 'A keyholder' : ''); };
  const emailOf = o => { const { b, m } = ownerOf(o); return (b && b.email) || (m && m.email) || ''; };
  const tell = (o, n) => { if (!notify) return; const { b, m } = ownerOf(o); notify.tell({ buyer_id: b ? b.id : null, maker_id: m ? m.id : null, ...n }).catch(() => {}); };
  const post = (to, subject, text, cta) => { if (!to) return; mail.send({ to, subject, text, cta }).catch(e => console.error('[season]', e.message)); };

  // The Circle.
  const member = w => w && db.prepare("SELECT * FROM circle WHERE status IN ('active','ending') AND ((buyer_id IS NOT NULL AND buyer_id=?) OR (maker_id IS NOT NULL AND maker_id=?) OR (email IS NOT NULL AND email<>'' AND email=?)) ORDER BY id DESC LIMIT 1").get(w.b ? w.b.id : -1, w.m ? w.m.id : -1, w.email || '');
  const circleCount = () => db.prepare("SELECT COUNT(*) n FROM circle WHERE status IN ('active','ending')").get().n;
  const holdsKey = req => !!(app.locals.keys && app.locals.keys.any(req));

  app.get('/circle', (req, res) => {
    const w = who(req), mine = member(w), n = circleCount();
    const nights = upcoming().slice(0, 4);
    const members = mine ? db.prepare("SELECT name FROM circle WHERE status IN ('active','ending') AND name IS NOT NULL ORDER BY started_at").all().map(r => r.name.split(/\s+/)[0]) : [];
    res.send(V.layout({ title: 'The Circle · The Keys · Watermark', path: '/circle', desc: 'The young members of the Keys: the nights of the season first, the dinner, the artists, the introductions. Under forty, by the year.', body: `<article class="cr">
<header class="cr-cover ky-damask"><div class="cr-ct">${app.locals.keys && app.locals.keys.MARK ? app.locals.keys.MARK.bunch : ''}<p class="k">The Keys · the young members</p><h1>The Circle.</h1><p class="cr-lede">For those under forty who want to be in the room. The nights of the season, first; the dinner; the artists; the people. Not a feed: a club, in a city near you, and here between.</p>${n ? `<p class="cr-count">${n} member${n === 1 ? '' : 's'}</p>` : ''}</div></header>
<section class="cr-why"><p class="k">Why</p><h2>You go to the late night at the museum to be among people like you, in a beautiful room, with something worth talking about in front of you.</h2>
<p>That is the whole of it. The work gives you the reason; the house gives you the room; the Circle gives you the people. The house throws the nights: an opening, a late night at the galleries, a dinner at one table, a salon with a maker, a screening, a walk through a city with the photographer who made its pictures. Krafft Studios films them. The Circle hears first and comes first.</p></section>
<section class="cr-what"><p class="k">What a member holds</p><ul class="cr-list">
<li><b>Every night, first.</b> A night opens to the Circle ${CIRCLE_FIRST_HOURS} hours before the keys. Most rooms are small; the Circle fills them.</li>
<li><b>The dinner.</b> Twelve at one table, in a city, with a maker. Members are drawn first.</li>
<li><b>The artists.</b> The salons are the makers’ own: how it was made, in their words, in a room, with wine.</li>
<li><b>The introductions.</b> Leave your card for someone over a work or a night; when they say yes, the house introduces you. Both of you, at once, by letter.</li>
<li><b>A key.</b> The collector’s key, if you do not hold one: the galleries, the benches, the balcony.</li>
<li><b>The house.</b> Your dues keep the doors open and the makers paid. Not a gift; a membership.</li></ul></section>
${nights.length ? `<section class="cr-next"><p class="k">The season</p>${nights.map(nightCard).join('')}<p><a href="/season">The whole season →</a></p></section>` : ''}
${mine ? `<section class="cr-mine"><p class="k">Yours</p><h2>You are a member of the Circle.</h2><p>${esc(CIRCLE[mine.level] ? CIRCLE[mine.level].name : mine.level)} · since ${esc(date(mine.started_at))}${mine.status === 'ending' ? ' · ending at the end of the year paid' : ''}.</p>${members.length ? `<p class="cr-mem"><span class="k">In the Circle</span> ${members.map(esc).join(' · ')}</p>` : ''}<p><a href="/season">The season</a> · <a href="/meet">Your cards</a> · <a href="/keys">The Keys</a></p>${mine.status === 'active' ? `<form method="post" action="/circle/end" class="cr-end"><button class="link">Leave at the end of the year paid</button></form>` : ''}</section>`
  : `<section class="cr-join" id="join"><p class="k">Join</p><div class="cr-levels">${Object.values(CIRCLE).map(l => `<form method="post" action="/circle/join" class="cr-lv"><h3>${esc(l.name)}</h3><p class="cr-pr"><b>${money(l.cents)}</b> a year</p><p>${esc(l.line)}</p><input type="hidden" name="level" value="${l.key}">
<label>Your name<input name="name" required maxlength="80" value="${esc(w ? w.name : '')}"></label><label>Email<input name="email" type="email" required maxlength="160" value="${esc(w ? w.email : '')}"></label>
<label class="cr-att"><input type="checkbox" name="attest" value="1" required> I am under forty.</label>
<button class="buy-btn">Join the Circle</button></form>`).join('')}</div>
<p class="note">Dues are by the year through Stripe; leave any time and the year paid runs out. Under forty on joining; the house asks for no document. Prices are drafts until the director confirms them. Not tax-deductible.</p></section>`}
<section class="cr-rules"><p class="k">The manner</p><ul><li>You meet over the work. The picture on every page here is a work; the house asks for no photograph of you.</li><li>You speak under your name, a sentence at least.</li><li>A card is one sentence, once a day. The house introduces only when both say yes, and never says no for anyone.</li><li>What is said in the rooms stays in the rooms. The nights are filmed by Studios; you may ask not to be.</li><li>Discretion. The house never says who holds what, or who came, outside the room.</li></ul></section>
<p class="ky-foot"><a href="/keys">The Keys</a> · <a href="/season">The season</a> · <a href="/balcony">The balcony</a></p>
</article>` }));
  });
  app.post('/circle/join', async (req, res) => {
    const x = req.body || {}, lv = CIRCLE[x.level]; if (!lv) return res.sendStatus(400);
    const name = String(x.name || '').trim().slice(0, 80), email = String(x.email || '').trim().toLowerCase().slice(0, 160);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !x.attest || slow('join:' + req.ip)) return res.redirect('/circle?ok=check#join');
    const w = who(req); if (member(w)) return res.redirect('/circle?ok=member');
    const id = db.prepare('INSERT INTO circle (buyer_id, maker_id, name, email, level, cents, attest) VALUES (?,?,?,?,?,?,1)').run(w && w.b ? w.b.id : null, w && w.m ? w.m.id : null, name, email, lv.key, lv.cents).lastInsertRowid;
    if (!stripe) { return res.redirect('/circle?ok=unavailable'); }
    try {
      const s = await stripe.checkout.sessions.create({ mode: 'subscription', customer_email: email,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: lv.cents, recurring: { interval: 'year' }, product_data: { name: `${lv.name}, the Keys at Watermark`, description: lv.line } } }],
        metadata: { circle: String(id) }, subscription_data: { metadata: { circle: String(id) } },
        success_url: `${base}/circle/${id}/thanks?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/circle` });
      db.prepare('UPDATE circle SET stripe_session=? WHERE id=?').run(s.id, id);
      res.redirect(303, s.url);
    } catch (e) { console.error('[circle]', e.message); db.prepare("DELETE FROM circle WHERE id=? AND status='pending'").run(id); res.redirect('/circle?ok=unavailable'); }
  });
  function activate(id, s) {
    const c = db.prepare('SELECT * FROM circle WHERE id=?').get(id); if (!c || c.status !== 'pending' || c.stripe_session !== s.id) return c;
    if (s.status !== 'complete' && s.payment_status !== 'paid') return c;
    db.prepare("UPDATE circle SET status='active', stripe_sub=?, started_at=datetime('now') WHERE id=?").run(s.subscription || null, id);
    ledger.append(db, 'circle.joined', `circle-${id}`, { level: c.level, amount: c.cents });
    // A key comes with it: the collector's, if none is held.
    try { if (app.locals.keys && c.buyer_id) app.locals.keys.issue('collector', { buyer_id: c.buyer_id }, 'circle'); } catch (e) { /* keys may be issued later by the backfill */ }
    post(c.email, 'Welcome to the Circle', `${c.name.split(/\s+/)[0]},\n\nYou are a member of the Circle, the young members of the Keys. The nights of the season open to you first; the dinner draws from the Circle; the salons are the makers’ own.\n\nThe season is at ${base}/season. Your cards, and the introductions the house makes, are at ${base}/meet.\n\nThank you. You are our honoured guest. This is our house and our home, and you are welcome in it.\n\nWatermark, a Krafft company.`, { label: 'The season', url: `${base}/season` });
    tell(c.buyer_id ? `b:${c.buyer_id}` : c.maker_id ? `m:${c.maker_id}` : '', { kind: 'circle', title: 'You are in the Circle', body: 'The nights of the season open to you first.', href: '/season' });
    return db.prepare('SELECT * FROM circle WHERE id=?').get(id);
  }
  app.get('/circle/:id/thanks', async (req, res) => {
    let c = db.prepare('SELECT * FROM circle WHERE id=?').get(Number(req.params.id)); if (!c) return res.sendStatus(404);
    if (c.status === 'pending' && stripe && req.query.session_id) { try { const s = await stripe.checkout.sessions.retrieve(String(req.query.session_id)); c = activate(c.id, s) || c; } catch (e) { /* the webhook will */ } }
    if (c.status === 'active' && !c.buyer_id && setBuyer) { // give the new member a gallery, so the key and the cards have a home
      let b = db.prepare('SELECT * FROM buyers WHERE email=? ORDER BY id LIMIT 1').get(c.email);
      if (!b) { const bid = db.prepare("INSERT INTO buyers (customer, email, name) VALUES ('', ?, ?)").run(c.email, c.name).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(bid); }
      db.prepare('UPDATE circle SET buyer_id=? WHERE id=?').run(b.id, c.id); setBuyer(res, b);
      try { if (app.locals.keys) app.locals.keys.issue('collector', { buyer_id: b.id }, 'circle'); } catch (e) { /* later */ }
    }
    res.send(V.layout({ title: 'Welcome to the Circle · Watermark', path: '/circle', body: `<section class="thanks cr-th"><p class="k">The Keys</p><h1>${c.status === 'active' ? 'You are in the Circle.' : 'Thank you.'}</h1><p class="lede">${c.status === 'active' ? 'The nights of the season open to you first. Thank you. You are our honoured guest, and this is your house now too.' : 'Your membership is being confirmed; a letter follows.'}</p><p><a class="buy-btn" href="/season">The season</a> <a class="buy-btn" href="/meet">Your cards</a></p></section>` }));
  });
  app.post('/circle/end', async (req, res) => {
    const c = member(who(req)); if (!c) return res.redirect('/circle');
    try { if (stripe && c.stripe_sub) await stripe.subscriptions.update(c.stripe_sub, { cancel_at_period_end: true }); } catch (e) { /* recorded anyway */ }
    db.prepare("UPDATE circle SET status='ending' WHERE id=?").run(c.id);
    res.redirect('/circle?ok=ending');
  });
  app.locals.seasonEvent = event => {
    const o = event.data.object;
    if (event.type === 'checkout.session.completed' && o.metadata && o.metadata.circle) activate(Number(o.metadata.circle), o);
    if (event.type === 'customer.subscription.deleted' && o.metadata && o.metadata.circle) { db.prepare("UPDATE circle SET status='ended', ended_at=datetime('now') WHERE id=?").run(Number(o.metadata.circle)); ledger.append(db, 'circle.ended', `circle-${o.metadata.circle}`, {}); }
  };

  // The season.
  const night = slug => db.prepare('SELECT * FROM nights WHERE slug=?').get(String(slug));
  const upcoming = () => db.prepare("SELECT * FROM nights WHERE status='open' AND at >= datetime('now', '-6 hours') ORDER BY at").all();
  const past = () => db.prepare("SELECT * FROM nights WHERE status IN ('open','past') AND at < datetime('now', '-6 hours') ORDER BY at DESC LIMIT 12").all();
  const going = id => db.prepare("SELECT * FROM night_guests WHERE night_id=? AND status='going' ORDER BY at").all(id);
  const seats = id => db.prepare("SELECT COALESCE(SUM(1+plus),0) n FROM night_guests WHERE night_id=? AND status='going'").get(id).n;
  const pictureOf = n => { if (n.work_slug) { const w = db.prepare("SELECT slug FROM works WHERE slug=? AND status='held'").get(n.work_slug); if (w) return `/img/${esc(w.slug)}/screen`; } if (n.hang_slug) { const h = db.prepare("SELECT w.slug FROM hangs h JOIN hang_works hw ON hw.hang_id=h.id JOIN works w ON w.id=hw.work_id WHERE h.slug=? AND w.status='held' ORDER BY hw.pos LIMIT 1").get(n.hang_slug); if (h) return `/img/${esc(h.slug)}/screen`; } const t = app.locals.todays ? app.locals.todays() : null; return t ? `/img/${esc(t.slug)}/screen` : ''; };
  const makersOf = n => String(n.makers || '').split(/[,\s]+/).filter(Boolean).map(h => db.prepare('SELECT name, handle, portrait FROM makers WHERE handle=?').get(h)).filter(Boolean);
  const circleOnly = n => n.circle_first && (new Date(n.created_at + 'Z').getTime() + CIRCLE_FIRST_HOURS * 3600000) > Date.now();
  const myReply = (n, w) => w ? db.prepare("SELECT * FROM night_guests WHERE night_id=? AND status<>'cancelled' AND ((buyer_id IS NOT NULL AND buyer_id=?) OR (maker_id IS NOT NULL AND maker_id=?)) ORDER BY id DESC LIMIT 1").get(n.id, w.b ? w.b.id : -1, w.m ? w.m.id : -1) : null;
  function nightCard(n) {
    const s = seats(n.id), full = n.capacity && s >= n.capacity;
    return `<a class="sn-card" href="/season/${esc(n.slug)}"><img src="${pictureOf(n)}" alt="" loading="lazy"><div><p class="k">${esc(KINDS[n.kind] || 'A night')}${n.city ? ` · ${esc(n.city)}` : ''}</p><h3>${esc(n.title)}</h3><p class="sn-when">${esc(when(n.at))}</p>${n.line ? `<p class="sn-line">${esc(n.line)}</p>` : ''}<p class="sn-foot">${isDinner(n) ? (s ? `The table is drawn · ${s} seated` : `One table of ${n.capacity || DINNER_SEATS} · names down`) : circleOnly(n) ? 'The Circle first' : full ? 'Full · a waiting list' : s ? `${s} coming` : 'Open'}</p></div></a>`;
  }
  app.get('/season', (req, res) => {
    const up = upcoming(), gone = past(), w = who(req), mine = member(w);
    res.send(V.layout({ title: 'The season · The Keys · Watermark', path: '/season', desc: 'The nights the house throws: openings, late nights, the dinner, salons with the makers, screenings, walks. In the real world.', body: `<article class="sn">
<header class="sn-h ky-damask"><div class="sn-ht"><p class="k">The Keys · in the real world</p><h1>The season.</h1><p class="lede">The nights the house throws. An opening; a late night in the galleries; the dinner at one table; a salon in a maker’s own words; a screening; a walk through a city with the photographer who made its pictures. Filmed by Krafft Studios. ${mine ? 'You are in the Circle: every night is yours first.' : 'Keyholders come; <a href="/circle">the Circle</a> comes first.'}</p></div></header>
${up.length ? `<section class="sn-up"><p class="k">Coming</p><div class="sn-grid">${up.map(nightCard).join('')}</div></section>` : `<section class="sn-up"><p class="k">Coming</p><p class="lede">The first night of the season is being set. ${mine ? 'You will hear first.' : '<a href="/circle">The Circle</a> hears first.'}</p></section>`}
${gone.length ? `<section class="sn-past"><p class="k">Held</p><ul class="sn-pl">${gone.map(n => `<li><a href="/season/${esc(n.slug)}"><b>${esc(n.title)}</b> · ${esc(date(n.at))}${n.city ? ` · ${esc(n.city)}` : ''}${n.came ? ` · ${n.came} came` : ''}</a></li>`).join('')}</ul></section>` : ''}
<section class="sn-how"><p class="k">How a night works</p><p>A night opens on this page and to the Circle by letter; ${CIRCLE_FIRST_HOURS} hours later to every keyholder. You reply with your name; a guest if your membership carries one; a line if you like. The address comes with the reply. In the room, you will know who is coming before you arrive, by first name and by what they collect or make, and you may leave a card for anyone there. After, the night has its bench, and the house says only how many came.</p><p><a href="/circle">The Circle</a> · <a href="/keys">The Keys</a> · <a href="/meet">Your cards</a></p></section>
</article>` }));
  });
  app.get('/season/:slug', (req, res) => {
    const n = night(req.params.slug); if (!n || (n.status === 'draft' && !isStudio(req)) || n.status === 'cancelled') return res.sendStatus(404);
    const w = who(req), mine = member(w), key = holdsKey(req), me = myReply(n, w), gs = going(n.id), s = seats(n.id), full = n.capacity && s >= n.capacity, co = circleOnly(n), gone = new Date(n.at).getTime() < Date.now() - 6 * 3600000 || n.status === 'past';
    const ms = makersOf(n), may = !!(mine || (key && !co)), inRoom = !!(me || isStudio(req));
    const ok = { asked: 'Your name is down. The house draws the table a week before and writes either way.', going: 'You are coming. The address is below, and a letter is on its way.', waiting: 'The room is full; you are on the waiting list, and the house will write when a place opens.', cancelled: 'Your place is given back.', key: 'A night is for keyholders and the Circle. Collect a piece, or join the Circle.', circle: `This night is the Circle’s for its first ${CIRCLE_FIRST_HOURS} hours.`, check: 'A name is needed.', card: 'Your card is left. If they say yes, the house will introduce you both.', carded: 'You have already left a card for them.', daily: 'One card a day; tomorrow.', self: 'That is you.' }[req.query.ok];
    const lineFor = g => { const o = g.buyer_id ? `b:${g.buyer_id}` : g.maker_id ? `m:${g.maker_id}` : ''; const parts = []; if (g.maker_id) parts.push('makes'); if (g.buyer_id) { const c = db.prepare("SELECT COUNT(DISTINCT work_id) n FROM licenses WHERE buyer_id=? AND status='active' AND collector_no IS NOT NULL").get(g.buyer_id).n; if (c) parts.push(`collects${c > 1 ? ` · ${c} pieces` : ''}`); } if (o && db.prepare("SELECT 1 FROM circle WHERE status IN ('active','ending') AND (buyer_id=? OR maker_id=?)").get(g.buyer_id || -1, g.maker_id || -1)) parts.push('the Circle'); return { o, line: parts.join(' · ') }; };
    res.send(V.layout({ title: `${n.title} · The season · Watermark`, path: '/season', desc: n.line || `${KINDS[n.kind] || 'A night'} of the house${n.city ? ` in ${n.city}` : ''}.`, image: pictureOf(n), body: `<article class="nx">
<header class="nx-h"><img class="nx-pic" src="${pictureOf(n)}" alt=""><div class="nx-ht"><p class="k"><a href="/season">The season</a> · ${esc(KINDS[n.kind] || 'A night')}${n.city ? ` · ${esc(n.city)}` : ''}</p><h1>${esc(n.title)}</h1><p class="nx-when">${esc(when(n.at))}${n.ends_at ? ` until ${esc(new Date(n.ends_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: process.env.BALCONY_TZ || 'America/New_York' }))}` : ''}${n.venue ? ` · ${esc(n.venue)}` : ''}</p>${n.line ? `<p class="lede">${esc(n.line)}</p>` : ''}${n.host ? `<p class="nx-host">Hosted by ${esc(n.host)}</p>` : ''}</div></header>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
${n.body ? `<section class="nx-body">${String(n.body).split(/\n\s*\n/).map(p => `<p>${esc(p.trim())}</p>`).join('')}</section>` : ''}
${ms.length ? `<section class="nx-makers"><p class="k">The artists present</p><div class="nx-ms">${ms.map(m => `<a href="/m/${esc(m.handle)}" class="nx-m">${m.portrait ? `<img src="/portrait/${esc(m.handle)}" alt="">` : ''}<b>${esc(m.name)}</b></a>`).join('')}</div></section>` : ''}
${n.hang_slug ? `<p class="nx-wall"><a href="/hang/${esc(n.hang_slug)}">The wall of the night →</a></p>` : ''}
<section class="nx-reply" id="reply"><p class="k">${gone ? 'Held' : 'The reply'}</p>${gone ? `<p>${n.came ? `${n.came} came.` : 'The night was held.'} ${n.hang_slug ? `<a href="/bench/wall/${esc(n.hang_slug)}">The bench of the night →</a>` : ''}</p>`
  : me && me.status === 'asked' ? `<p><b>Your name is down for the table.</b> The house draws ${n.capacity || DINNER_SEATS} seats${dinnerDrawn(n) ? '; this table is drawn, and your name is kept for the next' : ', a week before, the Circle first, then in the order of asking'}. You will hear either way.</p><form method="post" action="/season/${esc(n.slug)}/cancel"><button class="link">Take my name off</button></form>`
  : me ? `<p><b>${isDinner(n) ? 'You are seated' : 'You are coming'}${me.plus ? ', with a guest' : ''}.</b>${me.status === 'waiting' ? ' On the waiting list.' : ''} ${n.address ? `<br>${esc(n.address).replace(/\n/g, '<br>')}` : ''}</p>${isDinner(n) && n.menu ? `<div class="nx-menu"><p class="k">The menu</p>${String(n.menu).split(/\n\s*\n/).map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}<form method="post" action="/season/${esc(n.slug)}/cancel"><button class="link">Give my place back</button></form>`
  : !w ? `<p>A night is for keyholders and the Circle. <a href="/signin?next=/season/${esc(n.slug)}">Sign in</a> to reply.</p>`
  : !may ? `<p>${co ? `This night is the Circle’s for its first ${CIRCLE_FIRST_HOURS} hours; keyholders after. <a href="/circle">Join the Circle</a> to come first.` : 'A night is for keyholders and the Circle. <a href="/collection">Collect a piece</a> for the collector’s key, or <a href="/circle">join the Circle</a>.'}</p>`
  : isDinner(n) ? `<form method="post" action="/season/${esc(n.slug)}/reply" class="nx-form"><p>One table of ${n.capacity || DINNER_SEATS}, with a maker. Not first come: put your name down and the house draws the table a week before, the Circle first, then in the order of asking. ${asked(n.id).length ? `${asked(n.id).length} name${asked(n.id).length === 1 ? '' : 's'} down.` : ''}</p><label>Your name<input name="name" required maxlength="80" value="${esc(w.name)}"></label><label>A line, if you like: what you collect, what you’d ask the maker<input name="note" maxlength="140" placeholder="optional"></label><button class="buy-btn">Put my name down</button></form>`
  : `<form method="post" action="/season/${esc(n.slug)}/reply" class="nx-form"><p>${full ? 'The room is full; the house keeps a waiting list.' : `${s ? `${s} coming${n.capacity ? ` of ${n.capacity}` : ''}.` : 'Be the first.'}`}</p><label>Your name<input name="name" required maxlength="80" value="${esc(w.name)}"></label>${mine && mine.level === 'guest' ? `<label class="cr-att"><input type="checkbox" name="plus" value="1"> I am bringing a guest</label>` : ''}<label>A line, if you like<input name="note" maxlength="140" placeholder="optional"></label><button class="buy-btn">${full ? 'Put me on the list' : 'I will come'}</button></form>`}</section>
${inRoom && gs.length ? `<section class="nx-who"><p class="k">${isDinner(n) ? 'The table' : 'Who is coming'}</p><ul class="nx-gl">${gs.map(g => { const { o, line } = lineFor(g); const self = w && o === w.owner; return `<li><b>${esc(g.name.split(/\s+/)[0])}</b>${g.plus ? ' and a guest' : ''}${line ? ` <span>${esc(line)}</span>` : ''}${g.note ? ` <em>${esc(g.note)}</em>` : ''}${o && !self && key ? ` <a class="nx-card" href="/meet/card?to=${encodeURIComponent(o)}&about=${encodeURIComponent('night:' + n.slug)}">Leave your card</a>` : ''}</li>`; }).join('')}</ul><p class="note">Shown only to those coming. First names, and what each collects or makes.</p></section>` : ''}
<p class="ky-foot"><a href="/season">The season</a> · <a href="/circle">The Circle</a> · <a href="/keys">The Keys</a></p>
</article>` }));
  });
  app.post('/season/:slug/reply', (req, res) => {
    const n = night(req.params.slug); if (!n || n.status !== 'open') return res.sendStatus(404);
    const w = who(req); if (!w) return res.redirect(`/signin?next=/season/${encodeURIComponent(n.slug)}`);
    const mine = member(w), back = ok => res.redirect(303, `/season/${encodeURIComponent(n.slug)}?ok=${ok}#reply`);
    if (!mine && !holdsKey(req)) return back('key'); if (!mine && circleOnly(n)) return back('circle');
    if (myReply(n, w)) return back('going');
    const name = String((req.body || {}).name || w.name || '').trim().slice(0, 80), note = String((req.body || {}).note || '').replace(/<[^>]*>/g, '').trim().slice(0, 140); if (!name) return back('check');
    const plus = mine && mine.level === 'guest' && (req.body || {}).plus ? 1 : 0;
    if (isDinner(n)) {
      db.prepare("INSERT INTO night_guests (night_id, buyer_id, maker_id, name, email, plus, note, status) VALUES (?,?,?,?,?,?,?,'asked')").run(n.id, w.b ? w.b.id : null, w.m ? w.m.id : null, name, w.email || null, 0, note || null);
      post(w.email, `Your name is down: ${n.title}`, `${name.split(/\s+/)[0]},\n\nYour name is down for ${n.title}, ${when(n.at)}${n.city ? `, ${n.city}` : ''}. The house draws the table a week before, the Circle first, then in the order of asking, and writes either way.\n\n${base}/season/${n.slug}\n\nThank you.\n\nWatermark, a Krafft company.`);
      return back('asked');
    }
    const full = n.capacity && seats(n.id) + 1 + plus > n.capacity, status = full ? 'waiting' : 'going';
    db.prepare('INSERT INTO night_guests (night_id, buyer_id, maker_id, name, email, plus, note, status) VALUES (?,?,?,?,?,?,?,?)').run(n.id, w.b ? w.b.id : null, w.m ? w.m.id : null, name, w.email || null, plus, note || null, status);
    if (status === 'going') post(w.email, `You are expected: ${n.title}`, `${name.split(/\s+/)[0]},\n\nYou are expected at ${n.title}, ${when(n.at)}${n.venue ? `, at ${n.venue}` : ''}${n.city ? `, ${n.city}` : ''}.${n.address ? `\n\n${n.address}` : ''}${plus ? '\n\nYour guest is expected with you.' : ''}\n\nWho is coming, by first name, is on the night’s page; you may leave a card for anyone there, and the house will introduce you if they say yes.\n\n${base}/season/${n.slug}\n\nThank you for coming. You are our honoured guest. We hope you come back.\n\nWatermark, a Krafft company.`, { label: 'The night', url: `${base}/season/${n.slug}` });
    else post(w.email, `The list: ${n.title}`, `${name.split(/\s+/)[0]},\n\nThe room for ${n.title} is full; you are on the waiting list, and the house will write the moment a place opens.\n\n${base}/season/${n.slug}\n\nThank you.\n\nWatermark, a Krafft company.`);
    back(status);
  });
  const dinnerDrawn = n => db.prepare("SELECT COUNT(*) n FROM night_guests WHERE night_id=? AND status='going'").get(n.id).n > 0;
  // The draw: the house seats the table. By itself (the Circle first, then the order of asking) or a name at a time.
  function seat(n, g) {
    db.prepare("UPDATE night_guests SET status='going' WHERE id=?").run(g.id);
    post(g.email, `A place at the table: ${n.title}`, `${g.name.split(/\s+/)[0]},\n\nYou are seated at ${n.title}, ${when(n.at)}${n.venue ? `, at ${n.venue}` : ''}${n.city ? `, ${n.city}` : ''}.${n.address ? `\n\n${n.address}` : ''}${n.menu ? `\n\nThe menu:\n${n.menu}` : ''}\n\nThe table, by first name, is on the night’s page: ${base}/season/${n.slug}\n\nThank you for coming. You are our honoured guest. We hope you come back.\n\nWatermark, a Krafft company.`, { label: 'The table', url: `${base}/season/${n.slug}` });
    tell(g.buyer_id ? `b:${g.buyer_id}` : `m:${g.maker_id}`, { kind: 'night', title: `A place at the table: ${n.title}`, body: 'You are seated.', href: `/season/${n.slug}` });
  }
  function draw(n) {
    const cap = n.capacity || DINNER_SEATS, room = cap - seats(n.id); if (room <= 0) return 0;
    const names = asked(n.id).map(g => ({ g, circle: !!db.prepare("SELECT 1 FROM circle WHERE status IN ('active','ending') AND ((buyer_id IS NOT NULL AND buyer_id=?) OR (maker_id IS NOT NULL AND maker_id=?))").get(g.buyer_id || -1, g.maker_id || -1) }));
    names.sort((a, b) => (b.circle - a.circle) || (a.g.at < b.g.at ? -1 : 1));
    const chosen = names.slice(0, room); chosen.forEach(({ g }) => seat(n, g));
    for (const { g } of names.slice(room)) post(g.email, `The table: ${n.title}`, `${g.name.split(/\s+/)[0]},\n\nThe table for ${n.title} is drawn, and this time there was not a place; your name is kept for the next dinner, ahead of the line.\n\n${base}/season\n\nThank you.\n\nWatermark, a Krafft company.`);
    return chosen.length;
  }
  app.post('/studio/season/:id/draw', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    const n = db.prepare('SELECT * FROM nights WHERE id=?').get(Number(req.params.id)); if (!n) return res.sendStatus(404);
    const g = (req.body || {}).g ? db.prepare("SELECT * FROM night_guests WHERE id=? AND night_id=? AND status='asked'").get(Number(req.body.g), n.id) : null;
    const k = g ? (seat(n, g), 1) : draw(n);
    res.redirect(303, `/studio/season/${n.id}/guests?ok=${encodeURIComponent(k ? `${k} seated.` : 'No seat to give.')}`);
  });
  app.post('/season/:slug/cancel', (req, res) => {
    const n = night(req.params.slug), w = who(req); if (!n || !w) return res.sendStatus(404);
    const me = myReply(n, w); if (me) db.prepare("UPDATE night_guests SET status='cancelled' WHERE id=?").run(me.id);
    // The first on the waiting list takes the place.
    if (me && me.status === 'going') { const nx = db.prepare("SELECT * FROM night_guests WHERE night_id=? AND status='waiting' ORDER BY at LIMIT 1").get(n.id); if (nx && (!n.capacity || seats(n.id) + 1 + nx.plus <= n.capacity)) { db.prepare("UPDATE night_guests SET status='going' WHERE id=?").run(nx.id); post(nx.email, `A place: ${n.title}`, `${nx.name.split(/\s+/)[0]},\n\nA place has opened at ${n.title}, ${when(n.at)}; it is yours.${n.address ? `\n\n${n.address}` : ''}\n\n${base}/season/${n.slug}\n\nThank you.\n\nWatermark, a Krafft company.`); tell(nx.buyer_id ? `b:${nx.buyer_id}` : `m:${nx.maker_id}`, { kind: 'night', title: `A place at ${n.title}`, body: 'It is yours.', href: `/season/${n.slug}` }); } }
    res.redirect(303, `/season/${encodeURIComponent(n.slug)}?ok=cancelled#reply`);
  });

  // The cards.
  const pref = o => db.prepare('SELECT * FROM meet_prefs WHERE owner=?').get(o) || { owner: o, open: 1, line: '' };
  const aboutOf = a => { const [k, v] = String(a || '').split(':'); if (k === 'night') { const n = night(v); return n ? { text: `the night “${n.title}”`, href: `/season/${n.slug}` } : null; } if (k === 'work') { const w = db.prepare("SELECT title, slug FROM works WHERE slug=? AND status='held'").get(v); return w ? { text: `“${tidy(w.title)}”`, href: `/w/${w.slug}` } : null; } if (k === 'wall') { const h = db.prepare('SELECT title, slug FROM hangs WHERE slug=? AND public=1').get(v); return h ? { text: `the wall “${h.title}”`, href: `/hang/${h.slug}` } : null; } return null; };
  const cardLink = (req, { buyer_id, maker_id }, about) => { const w = who(req); if (!w || !holdsKey(req)) return ''; const o = buyer_id ? `b:${buyer_id}` : maker_id ? `m:${maker_id}` : ''; if (!o || o === w.owner) return ''; return `<a class="mt-cl" href="/meet/card?to=${encodeURIComponent(o)}${about ? `&about=${encodeURIComponent(about)}` : ''}">Leave your card</a>`; };
  app.get('/meet/card', (req, res) => {
    const w = who(req); if (!w) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl)); if (!holdsKey(req)) return res.redirect('/keys');
    const to = String(req.query.to || ''), nm = nameOf(to); if (!nm || to === w.owner) return res.sendStatus(404);
    const ab = aboutOf(req.query.about), p = pref(to);
    const already = db.prepare('SELECT 1 FROM cards WHERE from_owner=? AND to_owner=?').get(w.owner, to);
    res.send(V.layout({ title: 'Leave your card · Watermark', path: '/meet', body: `<section class="mt-one"><p class="k">The Keys · a card</p><h1>For ${esc(nm.split(/\s+/)[0])}.</h1>
${!p.open ? '<p class="lede">They are not taking cards just now.</p>' : already ? '<p class="lede">You have left your card for them already. If they say yes, the house will introduce you both.</p>' : `<p class="lede">One sentence, under your name${ab ? `, over ${ab.href ? `<a href="${esc(ab.href)}">${esc(ab.text)}</a>` : esc(ab.text)}` : ''}. If they say yes, the house introduces you both by letter, at once, and steps back. If not, nothing is said, to anyone.</p>
<form method="post" action="/meet/card" class="mt-form"><input type="hidden" name="to" value="${esc(to)}"><input type="hidden" name="about" value="${esc(req.query.about || '')}"><label>Your sentence<textarea name="note" required minlength="12" maxlength="240" rows="3" placeholder="What you saw, and why you’d like to meet."></textarea></label><p class="note">Signed ${esc(w.name)}. One card a day.</p><button class="buy-btn">Leave the card</button></form>`}
<p class="ky-foot"><a href="/meet">Your cards</a> · <a href="/keys">The Keys</a></p></section>` }));
  });
  app.post('/meet/card', (req, res) => {
    const w = who(req); if (!w || !holdsKey(req)) return res.sendStatus(403);
    const x = req.body || {}, to = String(x.to || ''), back = (ok, r) => res.redirect(303, (r || `/meet`) + `?ok=${ok}`);
    const ret = x.about && String(x.about).startsWith('night:') ? `/season/${encodeURIComponent(String(x.about).slice(6))}` : null;
    if (!nameOf(to)) return res.sendStatus(404); if (to === w.owner) return back('self', ret);
    if (!pref(to).open) return back('closed', ret);
    if (db.prepare('SELECT 1 FROM cards WHERE from_owner=? AND to_owner=?').get(w.owner, to)) return back('carded', ret);
    if (db.prepare("SELECT COUNT(*) n FROM cards WHERE from_owner=? AND at > datetime('now','-1 day')").get(w.owner).n >= 1) return back('daily', ret);
    const note = String(x.note || '').replace(/<[^>]*>/g, '').replace(/https?:\/\/\S+/g, '').trim().slice(0, 240); if (note.length < 12) return back('check', ret);
    const ab = aboutOf(x.about);
    const id = db.prepare('INSERT INTO cards (from_owner, to_owner, about, note) VALUES (?,?,?,?)').run(w.owner, to, ab ? String(x.about) : null, note).lastInsertRowid;
    ledger.append(db, 'card.left', `card-${id}`, {});
    tell(to, { kind: 'card', title: `A card from ${w.first}`, body: `“${note.length > 90 ? note.slice(0, 87) + '…' : note}” The house will introduce you only if you say yes.`, href: '/meet' });
    post(emailOf(to), `A card is left for you`, `${(nameOf(to).split(/\s+/)[0]) || ''},\n\n${w.first} has left a card for you${ab ? ` over ${ab.text}` : ''}:\n\n“${note}”\n\nIf you would like to meet, say yes at ${base}/meet and the house will introduce you both by letter, at once. If not, say nothing, and nothing will be said.\n\nWatermark, a Krafft company.`, { label: 'Your cards', url: `${base}/meet` });
    back('card', ret);
  });
  app.get('/meet', (req, res) => {
    const w = who(req); if (!w) return res.redirect('/signin?next=/meet');
    const p = pref(w.owner), key = holdsKey(req);
    const inb = db.prepare('SELECT * FROM cards WHERE to_owner=? ORDER BY at DESC LIMIT 40').all(w.owner), out = db.prepare('SELECT * FROM cards WHERE from_owner=? ORDER BY at DESC LIMIT 40').all(w.owner);
    const ok = { card: 'Your card is left. If they say yes, the house will introduce you both.', carded: 'You have already left a card for them.', daily: 'One card a day; tomorrow.', self: 'That is you.', closed: 'They are not taking cards just now.', check: 'A sentence, please: twelve characters at least, no links.', yes: 'The house has introduced you. A letter is with you both.', no: 'Put away. Nothing is said.', pref: 'Kept.' }[req.query.ok];
    const card = (c, dir) => { const other = dir === 'in' ? c.from_owner : c.to_owner, nm = nameOf(other) || 'Someone', ab = aboutOf(c.about); return `<li class="mt-c ${c.introduced_at ? 'met' : c.answer === 'no' ? 'put' : ''}"><p class="mt-from"><b>${esc(dir === 'in' ? nm.split(/\s+/)[0] : nm)}</b>${ab ? ` · over ${ab.href ? `<a href="${esc(ab.href)}">${esc(ab.text)}</a>` : esc(ab.text)}` : ''} · ${esc(date(c.at))}</p><p class="mt-note">“${esc(c.note)}”</p>${c.introduced_at ? `<p class="mt-st">Introduced, ${esc(date(c.introduced_at))}. The letter has both your addresses.</p>` : dir === 'in' ? (c.answer === 'no' ? '<p class="mt-st">Put away.</p>' : `<form method="post" action="/meet/${c.id}/answer" class="mt-ans"><button class="buy-btn" name="a" value="yes">Yes, introduce us</button> <button class="link" name="a" value="no">Not now</button></form>`) : '<p class="mt-st">Left. The house will write if they say yes.</p>'}</li>`; };
    res.send(V.layout({ title: 'Your cards · The Keys · Watermark', path: '/meet', body: `<article class="mt">
<header class="mt-h"><p class="k">The Keys</p><h1>Your cards.</h1><p class="lede">How people meet at the house. Over a work, a line or a night, a keyholder leaves a card for another: a sentence, under their name. If the other says yes, the house introduces them both by letter, at once, and steps back. A no is never told. Nothing of it on the wall.</p></header>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
${!key ? '<p class="note">Cards are left and taken by keyholders. <a href="/keys">The Keys</a>.</p>' : ''}
<section class="mt-sec"><p class="k">Left for you</p>${inb.length ? `<ul class="mt-list">${inb.map(c => card(c, 'in')).join('')}</ul>` : '<p class="note">None yet. Cards find you on the benches, in the guest books and at the nights of <a href="/season">the season</a>.</p>'}</section>
<section class="mt-sec"><p class="k">Yours, left</p>${out.length ? `<ul class="mt-list">${out.map(c => card(c, 'out')).join('')}</ul>` : '<p class="note">None yet. Under any signed line, and beside anyone coming to a night, is “Leave your card”.</p>'}</section>
<section class="mt-sec mt-pref"><p class="k">Taking cards</p><form method="post" action="/meet/prefs"><label class="cr-att"><input type="checkbox" name="open" value="1"${p.open ? ' checked' : ''}> I am taking cards</label><label>A line about you, shown to the person you are introduced to, never on the wall<input name="line" maxlength="140" value="${esc(p.line || '')}" placeholder="optional"></label><button class="buy-btn">Keep</button></form></section>
<p class="ky-foot"><a href="/season">The season</a> · <a href="/circle">The Circle</a> · <a href="/keys">The Keys</a></p></article>` }));
  });
  app.post('/meet/prefs', (req, res) => {
    const w = who(req); if (!w) return res.sendStatus(403);
    const x = req.body || {};
    db.prepare('INSERT INTO meet_prefs (owner, open, line) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET open=excluded.open, line=excluded.line').run(w.owner, x.open ? 1 : 0, String(x.line || '').replace(/<[^>]*>/g, '').trim().slice(0, 140));
    res.redirect(303, '/meet?ok=pref');
  });
  app.post('/meet/:id/answer', (req, res) => {
    const w = who(req); if (!w) return res.sendStatus(403);
    const c = db.prepare('SELECT * FROM cards WHERE id=? AND to_owner=?').get(Number(req.params.id), w.owner); if (!c || c.introduced_at) return res.redirect(303, '/meet');
    const a = (req.body || {}).a === 'yes' ? 'yes' : 'no';
    db.prepare("UPDATE cards SET answer=?, answered_at=datetime('now') WHERE id=?").run(a, c.id);
    if (a === 'no') return res.redirect(303, '/meet?ok=no');
    db.prepare("UPDATE cards SET introduced_at=datetime('now') WHERE id=?").run(c.id);
    ledger.append(db, 'introduction.made', `card-${c.id}`, {});
    const A = { o: c.from_owner, name: nameOf(c.from_owner), email: emailOf(c.from_owner), line: pref(c.from_owner).line }, B = { o: c.to_owner, name: w.name, email: w.email, line: pref(w.owner).line };
    const ab = aboutOf(c.about), next = upcoming()[0];
    const letter = (me, you) => `${me.name.split(/\s+/)[0]},\n\nThe house is glad to introduce you to ${you.name}${ab ? `, over ${ab.text}` : ''}.${you.line ? `\n\n${you.name.split(/\s+/)[0]}, in their own words: “${you.line}”` : ''}\n\nYou may write to each other at these addresses:\n${A.name} · ${A.email || 'no address given'}\n${B.name} · ${B.email || 'no address given'}\n\nWhat follows is yours; the house steps back here.${next ? `\n\nThe next night of the season is ${next.title}, ${when(next.at)}${next.city ? `, ${next.city}` : ''}: ${base}/season/${next.slug}` : ''}\n\nThank you. You are our honoured guests.\n\nWatermark, a Krafft company.`;
    post(A.email, `An introduction: ${B.name}`, letter(A, B), { label: 'The season', url: `${base}/season` });
    post(B.email, `An introduction: ${A.name}`, letter(B, A), { label: 'The season', url: `${base}/season` });
    tell(A.o, { kind: 'card', title: `${B.name.split(/\s+/)[0]} said yes`, body: 'The house has introduced you; a letter has both your addresses.', href: '/meet' });
    res.redirect(303, '/meet?ok=yes');
  });

  // The Studio: the season's desk and the Circle's roll.
  const slugify = s => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'night';
  app.get('/studio/season', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const all = db.prepare('SELECT * FROM nights ORDER BY at DESC').all(), e = req.query.edit ? night(req.query.edit) : null;
    const form = n => `<form method="post" action="/studio/season" class="sn-ed"><input type="hidden" name="id" value="${n ? n.id : ''}">
<label>Title<input name="title" required maxlength="120" value="${esc(n ? n.title : '')}"></label><label>Kind<select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${n && n.kind === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
<label>When (New York; YYYY-MM-DDTHH:MM)<input name="at" type="datetime-local" required value="${esc(n ? String(n.at).slice(0, 16) : '')}"></label><label>Until (optional)<input name="ends_at" type="datetime-local" value="${esc(n && n.ends_at ? String(n.ends_at).slice(0, 16) : '')}"></label>
<label>City<input name="city" maxlength="60" value="${esc(n ? n.city || '' : '')}"></label><label>Venue<input name="venue" maxlength="120" value="${esc(n ? n.venue || '' : '')}"></label><label>Address (shown only to those coming)<textarea name="address" rows="2">${esc(n ? n.address || '' : '')}</textarea></label>
<label>One line<input name="line" maxlength="200" value="${esc(n ? n.line || '' : '')}"></label><label>The words (paragraphs)<textarea name="body" rows="5">${esc(n ? n.body || '' : '')}</textarea></label>
<label>Capacity (0 = no limit; a dinner seats ${DINNER_SEATS} unless set)<input name="capacity" type="number" min="0" value="${n ? n.capacity : 0}"></label><label>The menu (a dinner; shown only to those seated)<textarea name="menu" rows="4">${esc(n ? n.menu || '' : '')}</textarea></label><label>Host<input name="host" maxlength="80" value="${esc(n ? n.host || '' : '')}"></label>
<label>Picture: a work’s slug<input name="work_slug" value="${esc(n ? n.work_slug || '' : '')}"></label><label>The wall of the night: a hang’s slug<input name="hang_slug" value="${esc(n ? n.hang_slug || '' : '')}"></label><label>Makers present: handles, comma-separated<input name="makers" value="${esc(n ? n.makers || '' : '')}"></label>
<label class="cr-att"><input type="checkbox" name="circle_first" value="1"${!n || n.circle_first ? ' checked' : ''}> The Circle first (${CIRCLE_FIRST_HOURS} hours)</label>
<label>Status<select name="status">${['draft', 'open', 'past', 'cancelled'].map(s => `<option${n && n.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select></label><label>Came (after)<input name="came" type="number" min="0" value="${n && n.came != null ? n.came : ''}"></label>
<button class="buy-btn">${n ? 'Keep' : 'Make the night'}</button></form>`;
    res.send(V.layout({ title: 'The season · Studio · Watermark', studio: true, path: '/studio/season', body: `<section class="studio-wrap"><p class="k">The Keys</p><h1>The season.</h1><p class="lede">The nights the house throws. A night is a draft until opened; opening tells the Circle by letter and the register. The Circle: ${circleCount()} member${circleCount() === 1 ? '' : 's'} · <a href="/studio/circle">the roll</a>.</p>${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<h2>${e ? `Edit: ${esc(e.title)}` : 'A new night'}</h2>${form(e)}${e ? `<p><a href="/studio/season">New instead</a> · <a href="/season/${esc(e.slug)}">The page</a> · <a href="/studio/season/${e.id}/guests">Guests (${seats(e.id)})</a> · <a href="/studio/season/${e.id}/guests.csv">.csv</a></p>` : ''}
<h2>Every night</h2><table class="tbl"><tr><th>When</th><th>Night</th><th>City</th><th>Status</th><th>Coming</th><th></th></tr>${all.map(n => `<tr><td>${esc(String(n.at).slice(0, 16).replace('T', ' '))}</td><td><a href="/season/${esc(n.slug)}">${esc(n.title)}</a></td><td>${esc(n.city || '')}</td><td>${esc(n.status)}</td><td>${seats(n.id)}${n.capacity ? ` / ${n.capacity}` : ''}${n.came != null ? ` · ${n.came} came` : ''}</td><td><a href="/studio/season?edit=${esc(n.slug)}">Edit</a> · <a href="/studio/season/${n.id}/guests">Guests</a></td></tr>`).join('')}</table></section>` }));
  });
  app.post('/studio/season', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    const x = req.body || {}, t = (k, n) => String(x[k] || '').trim().slice(0, n);
    const id = Number(x.id) || 0, was = id ? db.prepare('SELECT * FROM nights WHERE id=?').get(id) : null;
    const title = t('title', 120), at = t('at', 16); if (!title || !at) return res.redirect('/studio/season?ok=' + encodeURIComponent('A title and a time are needed.'));
    const v = { title, kind: KINDS[x.kind] ? x.kind : 'late', at, ends_at: t('ends_at', 16) || null, city: t('city', 60) || null, venue: t('venue', 120) || null, address: String(x.address || '').trim().slice(0, 400) || null, line: t('line', 200) || null, body: String(x.body || '').trim().slice(0, 6000) || null,
      capacity: Math.max(0, Number(x.capacity) || 0), menu: String(x.menu || '').trim().slice(0, 2000) || null, host: t('host', 80) || null, work_slug: t('work_slug', 80) || null, hang_slug: t('hang_slug', 80) || null, makers: t('makers', 400) || null, circle_first: x.circle_first && x.circle_first !== '0' ? 1 : 0, status: ['draft', 'open', 'past', 'cancelled'].includes(x.status) ? x.status : 'draft', came: x.came === '' || x.came == null ? null : Math.max(0, Number(x.came) || 0) };
    let slug = was ? was.slug : slugify(title); if (!was) { let i = 2, b = slug; while (night(slug)) slug = `${b}-${i++}`; }
    if (was) db.prepare('UPDATE nights SET title=@title, kind=@kind, at=@at, ends_at=@ends_at, city=@city, venue=@venue, address=@address, line=@line, body=@body, capacity=@capacity, menu=@menu, host=@host, work_slug=@work_slug, hang_slug=@hang_slug, makers=@makers, circle_first=@circle_first, status=@status, came=@came WHERE id=@id').run({ ...v, id });
    else db.prepare('INSERT INTO nights (slug, title, kind, at, ends_at, city, venue, address, line, body, capacity, menu, host, work_slug, hang_slug, makers, circle_first, status, came) VALUES (@slug, @title, @kind, @at, @ends_at, @city, @venue, @address, @line, @body, @capacity, @menu, @host, @work_slug, @hang_slug, @makers, @circle_first, @status, @came)').run({ ...v, slug });
    const n = night(slug);
    if (n.status === 'open' && (!was || was.status !== 'open')) {
      ledger.append(db, 'night.opened', `night-${n.id}`, { slug: n.slug, title: n.title, kind: n.kind, city: n.city, at: n.at });
      // The Circle hears first, by letter and by notice.
      for (const c of db.prepare("SELECT * FROM circle WHERE status IN ('active','ending')").all()) {
        post(c.email, `${KINDS[n.kind] || 'A night'}: ${n.title}`, `${(c.name || '').split(/\s+/)[0]},\n\n${n.title}, ${when(n.at)}${n.city ? `, ${n.city}` : ''}.${n.line ? `\n\n${n.line}` : ''}\n\nThe Circle has it first, for ${CIRCLE_FIRST_HOURS} hours. Reply at ${base}/season/${n.slug}.\n\nThank you. You are our honoured guest.\n\nWatermark, a Krafft company.`, { label: 'Reply', url: `${base}/season/${n.slug}` });
        tell(c.buyer_id ? `b:${c.buyer_id}` : c.maker_id ? `m:${c.maker_id}` : '', { kind: 'night', title: n.title, body: `${when(n.at)}${n.city ? `, ${n.city}` : ''}. The Circle first.`, href: `/season/${n.slug}` });
      }
    }
    if (n.status === 'past' && (!was || was.status !== 'past')) ledger.append(db, 'night.held', `night-${n.id}`, { slug: n.slug, title: n.title, city: n.city, came: n.came || seats(n.id) });
    res.redirect('/studio/season?edit=' + encodeURIComponent(slug) + '&ok=' + encodeURIComponent('Kept.'));
  });
  app.get('/studio/season/:id/guests', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const n = db.prepare('SELECT * FROM nights WHERE id=?').get(Number(req.params.id)); if (!n) return res.sendStatus(404);
    const gs = db.prepare("SELECT * FROM night_guests WHERE night_id=? AND status<>'cancelled' ORDER BY CASE status WHEN 'going' THEN 0 WHEN 'asked' THEN 1 ELSE 2 END, at").all(n.id);
    res.send(V.layout({ title: `Guests · ${n.title} · Studio`, studio: true, path: '/studio/season', body: `<section class="studio-wrap"><p class="k"><a href="/studio/season?edit=${esc(n.slug)}">${esc(n.title)}</a></p><h1>The guests.</h1><p class="lede">${seats(n.id)} coming${n.capacity ? ` of ${n.capacity}` : ''}. <a href="/studio/season/${n.id}/guests.csv">.csv</a></p>${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
${isDinner(n) ? `<form method="post" action="/studio/season/${n.id}/draw" class="sn-draw"><p>The Keyhole Room: ${asked(n.id).length} name${asked(n.id).length === 1 ? '' : 's'} down, ${seats(n.id)} seated of ${n.capacity || DINNER_SEATS}.</p><button class="buy-btn">Draw the table</button> <span class="note">The Circle first, then the order of asking; everyone is written to.</span></form>` : ''}
<table class="tbl"><tr><th>Name</th><th>Email</th><th>Guest</th><th>Line</th><th>Status</th><th>Replied</th><th>Came</th></tr>${gs.map(g => `<tr><td>${esc(g.name)}${g.status === 'asked' ? ` <form method="post" action="/studio/season/${n.id}/draw" style="display:inline"><input type="hidden" name="g" value="${g.id}"><button class="link">Seat</button></form>` : ''}</td><td>${esc(g.email || '')}</td><td>${g.plus ? '+1' : ''}</td><td>${esc(g.note || '')}</td><td>${esc(g.status)}</td><td>${esc(String(g.at).slice(0, 16))}</td><td><form method="post" action="/studio/season/${n.id}/came"><input type="hidden" name="g" value="${g.id}"><button class="link">${g.came ? 'Came ✓' : 'Mark came'}</button></form></td></tr>`).join('')}</table></section>` }));
  });
  app.get('/studio/season/:id/guests.csv', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    const gs = db.prepare("SELECT * FROM night_guests WHERE night_id=? AND status<>'cancelled' ORDER BY at").all(Number(req.params.id));
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    res.type('text/csv').send(['name,email,guest,line,status,replied'].concat(gs.map(g => [g.name, g.email, g.plus ? 1 : 0, g.note, g.status, g.at].map(q).join(','))).join('\n'));
  });
  app.post('/studio/season/:id/came', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    db.prepare('UPDATE night_guests SET came=CASE came WHEN 1 THEN 0 ELSE 1 END WHERE id=? AND night_id=?').run(Number((req.body || {}).g), Number(req.params.id));
    res.redirect(303, `/studio/season/${req.params.id}/guests`);
  });
  app.get('/studio/circle', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const rows = db.prepare('SELECT * FROM circle ORDER BY started_at DESC, id DESC').all();
    res.send(V.layout({ title: 'The Circle · Studio · Watermark', studio: true, path: '/studio/season', body: `<section class="studio-wrap"><p class="k">The Keys · <a href="/studio/season">The season</a></p><h1>The Circle.</h1><p class="lede">${circleCount()} member${circleCount() === 1 ? '' : 's'}. Dues ${Object.values(CIRCLE).map(l => `${money(l.cents)} (${l.name.toLowerCase()})`).join(', ')} a year, drafts until the director confirms.</p>
<table class="tbl"><tr><th>Member</th><th>Email</th><th>Level</th><th>Status</th><th>Since</th></tr>${rows.map(c => `<tr><td>${esc(c.name || '')}</td><td>${esc(c.email || '')}</td><td>${esc(c.level)}</td><td>${esc(c.status)}</td><td>${esc(String(c.started_at || c.created_at).slice(0, 10))}</td></tr>`).join('')}</table></section>` }));
  });

  // Tell the register how to say it, and the stroll's Keys door what is next.
  const next = () => upcoming()[0] || null;
  app.locals.season = { CIRCLE, KINDS, member: req => member(who(req)), circleCount, upcoming, next, night, cardLink, when };
  return app.locals.season;
}
module.exports = { mountSeason, CIRCLE, KINDS };
