// The Gazette by post (Will, 2 Nov: "what can we learn from Substack for the writers' room and our blogs"; "let's
// build it"). A maker's page is already their paper (rows.js, the masthead); this makes it arrive. Readers subscribe
// on the maker's page or at the end of any piece (an email, confirmed by one tap, or at once when they are signed in
// with that address); each new piece goes to every subscriber's inbox as a letter in the house's design, whole for
// those who may read it, the opening for the rest. The list is the maker's: they see it, export it, bring their own.
// A paid tier, when the maker turns it on: a price by the month (the maker's, every dollar; the house's share on top
// when the fee is on), paid through Stripe, on the statement and paid out on Fridays; a piece may be for paying
// subscribers, read whole by them and in its opening by everyone else. The bench under writing is the subscribers'
// own. Recommendations: up to three makers a maker reads, shown on their page and the moment someone subscribes.
// Unsubscribing is one tap, from every letter, and the letter says why it came.
const crypto = require('crypto');
const FEE = require('./fee');
const L = require('./mail-letters');
const PRICE = Number(process.env.GAZETTE_CENTS || 500);
const GAP = process.env.NODE_ENV === 'test' ? 0 : Number(process.env.GAZETTE_GAP_MS || 700);
const HOLD_DAYS = Number(process.env.PAYOUT_HOLD_DAYS || 7);

function mountGazette(app, { db, V, C, mail, ledger, stripe, buyerOf, makerOf, isStudio }) {
  const { esc, tidy, date } = V;
  const col = (t, c) => !!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name=?`).get(c);
  db.exec(`CREATE TABLE IF NOT EXISTS gazette_subs (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, email TEXT NOT NULL, name TEXT, buyer_id INTEGER, token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending', tier TEXT NOT NULL DEFAULT 'free', source TEXT, stripe_sub TEXT, stripe_session TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), confirmed_at TEXT, ended_at TEXT, UNIQUE (maker_id, email));
  CREATE TABLE IF NOT EXISTS gazette_plans (maker_id INTEGER PRIMARY KEY, price_cents INTEGER, paid_on INTEGER NOT NULL DEFAULT 0, welcome TEXT, recs TEXT);
  CREATE TABLE IF NOT EXISTS gazette_sends (id INTEGER PRIMARY KEY, text_id INTEGER NOT NULL, maker_id INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS gazette_payments (id INTEGER PRIMARY KEY, sub_id INTEGER NOT NULL, maker_id INTEGER NOT NULL, invoice TEXT UNIQUE, cents INTEGER NOT NULL, maker_cents INTEGER NOT NULL, house_cents INTEGER NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  if (!col('texts', 'subscribers_only')) db.exec('ALTER TABLE texts ADD COLUMN subscribers_only INTEGER NOT NULL DEFAULT 0');
  if (!col('texts', 'letter_sent_at')) db.exec('ALTER TABLE texts ADD COLUMN letter_sent_at TEXT');
  const first = s => String(s || '').trim().split(/\s+/)[0] || '';
  const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const money = c => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
  const maker = h => { h = String(h || ''); return db.prepare('SELECT * FROM makers WHERE handle=?').get(h) || db.prepare('SELECT * FROM makers').all().find(x => (V.makerSlug ? V.makerSlug(x) : x.handle) === h) || null; };
  const makerById = id => db.prepare('SELECT * FROM makers WHERE id=?').get(id);
  const slugOf = m => (V.makerSlug ? V.makerSlug(m) : m.handle);
  const plan = m => { const p = db.prepare('SELECT * FROM gazette_plans WHERE maker_id=?').get(m.id) || { maker_id: m.id, price_cents: null, paid_on: 0, welcome: null, recs: null }; p.price = p.price_cents || PRICE; return p; };
  const totalOf = (m, cents) => FEE.on() ? FEE.total('gazette', cents) : cents;
  const makerSide = (m, cents) => FEE.on() ? cents : Math.round(cents * (m.share_pct || 85) / 100);
  const newToken = () => crypto.randomBytes(18).toString('base64url');
  const GZC = 'wm_gz';
  const tokensOf = req => String((req.cookies || {})[GZC] || '').split('.').filter(t => /^[\w-]{16,40}$/.test(t)).slice(0, 60);
  const remember = (req, res, tok) => { const v = [tok].concat(tokensOf(req).filter(x => x !== tok)).slice(0, 60).join('.'); res.cookie(GZC, v, { maxAge: 400 * 864e5, httpOnly: true, sameSite: 'lax', secure: /^https:/.test(C.base || '') }); if (req.cookies) req.cookies[GZC] = v; };
  // This visitor's subscription to this maker, if any: by the device's tokens, else the signed-in reader's email.
  function subOf(req, m) {
    const ts = tokensOf(req); let s = null;
    if (ts.length) s = db.prepare(`SELECT * FROM gazette_subs WHERE maker_id=? AND token IN (${ts.map(() => '?').join(',')}) ORDER BY id LIMIT 1`).get(m.id, ...ts);
    if (!s) { const b = buyerOf(req); if (b && b.email) s = db.prepare('SELECT * FROM gazette_subs WHERE maker_id=? AND lower(email)=?').get(m.id, String(b.email).toLowerCase()); }
    return s || null;
  }
  const reads = (req, m) => { const me = makerOf(req); if ((me && me.id === m.id) || isStudio(req)) return 'host'; const s = subOf(req, m); return s && s.status === 'on' ? (s.tier === 'paid' ? 'paid' : 'free') : null; };
  const counts = m => db.prepare("SELECT SUM(CASE WHEN status='on' THEN 1 ELSE 0 END) n, SUM(CASE WHEN status='on' AND tier='paid' THEN 1 ELSE 0 END) paid, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM gazette_subs WHERE maker_id=?").get(m.id);

  // Subscribe: a signed-in reader with this address is on at once; anyone else confirms by one tap from a letter.
  const hits = new Map(); const slow = k => { const now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 600e3); a.push(now); hits.set(k, a); return a.length > 8; };
  function subscribe(req, res, m, email, name, source) {
    const b = buyerOf(req); const sure = !!(b && b.email && String(b.email).toLowerCase() === email);
    let s = db.prepare('SELECT * FROM gazette_subs WHERE maker_id=? AND lower(email)=?').get(m.id, email);
    if (!s) { db.prepare('INSERT INTO gazette_subs (maker_id, email, name, buyer_id, token, status, source, confirmed_at) VALUES (?,?,?,?,?,?,?,?)').run(m.id, email, name || null, b && b.id || null, newToken(), sure ? 'on' : 'pending', source, sure ? new Date().toISOString() : null); s = db.prepare('SELECT * FROM gazette_subs WHERE maker_id=? AND lower(email)=?').get(m.id, email); if (sure) told(m, s); }
    else if (s.status !== 'on') { db.prepare("UPDATE gazette_subs SET status=?, name=COALESCE(?, name), ended_at=NULL, confirmed_at=CASE WHEN ?='on' THEN datetime('now') ELSE confirmed_at END WHERE id=?").run(sure ? 'on' : 'pending', name || null, sure ? 'on' : 'pending', s.id); s = db.prepare('SELECT * FROM gazette_subs WHERE id=?').get(s.id); if (sure) told(m, s); }
    remember(req, res, s.token);
    if (s.status === 'pending') mail.send({ to: email, subject: `Confirm: ${m.name}’s Gazette`, text: `${first(name) || 'Hello'},\n\nOne tap to confirm you would like ${m.name}’s new work by post:\n\n${C.base}/gz/c/${s.token}\n\nIf this was not you, do nothing; nothing will be sent.\n\nWatermark`, feature: 'One tap', cta: { label: 'Yes, send it to me', url: `${C.base}/gz/c/${s.token}` } });
    return s;
  }
  function told(m, s) { if (app.locals.notify) app.locals.notify.tell({ maker_id: m.id, kind: 'note', href: '/account/gazette', title: `${s.name || s.email.split('@')[0]} subscribed to your Gazette`, body: s.tier === 'paid' ? 'A paying subscriber.' : 'By post.' }).catch(() => {}); }
  app.post('/m/:handle/subscribe', (req, res) => {
    const m = maker(req.params.handle); if (!m) return res.sendStatus(404);
    const x = req.body || {}, email = String(x.email || '').trim().toLowerCase().slice(0, 160), name = String(x.name || '').trim().slice(0, 120);
    const back = String(x.back || `/m/${slugOf(m)}`).startsWith('/') ? String(x.back || `/m/${slugOf(m)}`) : `/m/${slugOf(m)}`;
    const json = x.json === '1' || /json/.test(req.headers.accept || '');
    if (x.website || slow(req.ip)) return json ? res.status(429).json({ ok: false }) : res.redirect(303, back);
    if (!okEmail(email)) return json ? res.json({ ok: false, why: 'email' }) : res.redirect(303, back + (back.includes('?') ? '&' : '?') + 'gz=email#gz');
    const s = subscribe(req, res, m, email, name, x.source === 'piece' ? 'piece' : 'page');
    try { ledger.append(db, 'gazette.subscribed', m.handle, { how: s.status }); } catch (e) { /* */ }
    if (json) return res.json({ ok: true, status: s.status });
    res.redirect(303, s.status === 'on' ? `/gz/c/${s.token}` : back + (back.includes('?') ? '&' : '?') + 'gz=check#gz');
  });
  // Confirmed: the moment to recommend (the maker's own three).
  app.get('/gz/c/:token', (req, res) => {
    const s = db.prepare('SELECT * FROM gazette_subs WHERE token=?').get(String(req.params.token)); if (!s) return res.sendStatus(404);
    const m = makerById(s.maker_id);
    if (s.status !== 'on') { db.prepare("UPDATE gazette_subs SET status='on', confirmed_at=datetime('now'), ended_at=NULL WHERE id=?").run(s.id); told(m, s); }
    remember(req, res, s.token); res.set('Cache-Control', 'private, no-store');
    const p = plan(m), recs = recsOf(m).filter(r => !db.prepare("SELECT 1 FROM gazette_subs WHERE maker_id=? AND lower(email)=? AND status='on'").get(r.id, s.email.toLowerCase()));
    res.send(V.layout({ title: `${m.name}’s Gazette · Watermark`, body: `<section class="gzp"><p class="k">${esc(m.name)}’s Gazette</p><h1>You are on the list.</h1><p class="gzp-l">${p.welcome ? esc(p.welcome) : `New work from ${esc(first(m.name))} comes to ${esc(s.email)} as it is published. Every letter has a one-tap way off.`}</p>
${p.paid_on && s.tier !== 'paid' ? paidBox(m, s.email, s.name) : ''}
${recs.length ? `<h2>${esc(first(m.name))} also reads</h2><div class="gzp-recs">${recs.map(r => `<form method="post" action="/m/${esc(slugOf(r))}/subscribe" class="gzp-rec">${r.portrait ? `<img src="/portrait/${esc(r.handle)}" alt="" loading="lazy">` : ''}<div><b>${esc(r.name)}</b>${r.bio ? `<span>${esc(String(r.bio).slice(0, 120))}</span>` : ''}</div><input type="hidden" name="email" value="${esc(s.email)}"><input type="hidden" name="name" value="${esc(s.name || '')}"><input type="hidden" name="back" value="/gz/c/${esc(s.token)}"><button class="buy-btn">Subscribe</button></form>`).join('')}</div>` : ''}
<p class="gzp-f"><a href="/m/${esc(slugOf(m))}">${esc(m.name)}’s page</a> · <a href="/gz/u/${esc(s.token)}">Your subscription</a></p></section>` }));
  });
  // One tap off, from any letter; the mail's own unsubscribe (RFC 8058) posts here too.
  const unsubPage = (s, m, done) => V.layout({ title: 'Your subscription · Watermark', body: `<section class="gzp"><p class="k">${esc(m.name)}’s Gazette</p>${done ? `<h1>Off the list.</h1><p class="gzp-l">No more letters from ${esc(first(m.name))} to ${esc(s.email)}. ${s.tier === 'paid' ? 'Your paid subscription ends with the month paid.' : ''}</p><form method="post" action="/m/${esc(slugOf(m))}/subscribe"><input type="hidden" name="email" value="${esc(s.email)}"><button class="link">That was a mistake: put me back</button></form>` : `<h1>${s.status === 'on' ? 'You are subscribed.' : 'You are not subscribed.'}</h1><p class="gzp-l">${esc(s.email)}${s.tier === 'paid' && s.status === 'on' ? ' · a paying subscriber' : ''}</p>${s.status === 'on' ? `<form method="post" action="/gz/u/${esc(s.token)}"><button class="buy-btn">Unsubscribe</button></form>` : ''}`}</section>` });
  app.get('/gz/u/:token', (req, res) => { const s = db.prepare('SELECT * FROM gazette_subs WHERE token=?').get(String(req.params.token)); if (!s) return res.sendStatus(404); res.set('Cache-Control', 'private, no-store'); res.send(unsubPage(s, makerById(s.maker_id), false)); });
  app.post('/gz/u/:token', async (req, res) => {
    const s = db.prepare('SELECT * FROM gazette_subs WHERE token=?').get(String(req.params.token)); if (!s) return res.sendStatus(404);
    db.prepare("UPDATE gazette_subs SET status='off', ended_at=datetime('now') WHERE id=?").run(s.id);
    if (s.stripe_sub && stripe) { try { await stripe.subscriptions.update(s.stripe_sub, { cancel_at_period_end: true }); } catch (e) { console.error('[gazette] end', e.message); } }
    try { ledger.append(db, 'gazette.unsubscribed', makerById(s.maker_id).handle, {}); } catch (e) { /* */ }
    if ((req.body || {})['List-Unsubscribe'] === 'One-Click') return res.sendStatus(200);
    res.send(unsubPage(s, makerById(s.maker_id), true));
  });

  // The paid tier.
  function paidBox(m, email, name) {
    const p = plan(m); if (!p.paid_on) return '';
    return `<form method="post" action="/m/${esc(slugOf(m))}/subscribe/paid" class="gz-paid"><p><b>Support ${esc(first(m.name))}: ${money(totalOf(m, p.price))} a month.</b> ${FEE.on() ? `${money(p.price)} of it is ${esc(first(m.name))}’s, every dollar; the house’s share is on top.` : 'Paid to the maker every Friday.'} Paying subscribers read everything, including what is for them alone, and sit on the bench under every piece.</p>${email ? `<input type="hidden" name="email" value="${esc(email)}"><input type="hidden" name="name" value="${esc(name || '')}">` : '<input name="email" type="email" required placeholder="Your email" maxlength="160"><input name="name" placeholder="Your name" maxlength="120">'}<button class="buy-btn">Subscribe for ${money(totalOf(m, p.price))} a month</button></form>`;
  }
  app.post('/m/:handle/subscribe/paid', async (req, res) => {
    const m = maker(req.params.handle); if (!m) return res.sendStatus(404); const p = plan(m); if (!p.paid_on) return res.redirect(`/m/${slugOf(m)}`);
    const x = req.body || {}, email = String(x.email || '').trim().toLowerCase().slice(0, 160), name = String(x.name || '').trim().slice(0, 120);
    if (!okEmail(email)) return res.redirect(`/m/${slugOf(m)}?gz=email#gz`);
    let s = db.prepare('SELECT * FROM gazette_subs WHERE maker_id=? AND lower(email)=?').get(m.id, email);
    if (!s) { db.prepare("INSERT INTO gazette_subs (maker_id, email, name, buyer_id, token, status, source) VALUES (?,?,?,?,?,'pending','paid')").run(m.id, email, name || null, (buyerOf(req) || {}).id || null, newToken()); s = db.prepare('SELECT * FROM gazette_subs WHERE maker_id=? AND lower(email)=?').get(m.id, email); }
    remember(req, res, s.token);
    if (s.tier === 'paid' && s.status === 'on') return res.redirect(`/gz/u/${s.token}`);
    if (!stripe) return res.redirect(`/m/${slugOf(m)}?gz=closed#gz`);
    try {
      const total = totalOf(m, p.price);
      const sess = await stripe.checkout.sessions.create({ mode: 'subscription', customer_email: email,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: total, recurring: { interval: 'month' }, product_data: { name: `${m.name}’s Gazette`, description: `A paying subscription to ${m.name}’s writing and work on Watermark.` } } }],
        metadata: { gazette: String(s.id) }, subscription_data: { metadata: { gazette: String(s.id) } },
        success_url: `${C.base}/gz/p/${s.id}/thanks?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${C.base}/m/${slugOf(m)}#gz` });
      db.prepare('UPDATE gazette_subs SET stripe_session=? WHERE id=?').run(sess.id, s.id);
      res.redirect(303, sess.url);
    } catch (e) { console.error('[gazette] checkout', e.message); res.redirect(`/m/${slugOf(m)}?gz=closed#gz`); }
  });
  function activate(subId, sess) {
    const s = db.prepare('SELECT * FROM gazette_subs WHERE id=?').get(+subId); if (!s) return null;
    if (sess && sess.payment_status && sess.payment_status !== 'paid' && sess.status !== 'complete') return s;
    if (s.tier !== 'paid' || s.status !== 'on') {
      db.prepare("UPDATE gazette_subs SET status='on', tier='paid', stripe_sub=COALESCE(?, stripe_sub), confirmed_at=COALESCE(confirmed_at, datetime('now')), ended_at=NULL WHERE id=?").run(sess && sess.subscription || null, s.id);
      const m = makerById(s.maker_id); told(m, Object.assign({}, s, { tier: 'paid' }));
      try { ledger.append(db, 'gazette.paid', m.handle, {}); } catch (e) { /* */ }
      if (sess && sess.amount_total) pay(s.id, sess.invoice || sess.id, sess.amount_total);
    }
    return db.prepare('SELECT * FROM gazette_subs WHERE id=?').get(s.id);
  }
  // A month paid: the maker's side and the house's, kept for the statement.
  function pay(subId, invoice, cents) {
    const s = db.prepare('SELECT * FROM gazette_subs WHERE id=?').get(+subId); if (!s || !cents) return;
    const m = makerById(s.maker_id); const mc = FEE.on() ? Math.min(cents, FEE.makerFromTotal ? FEE.makerFromTotal('gazette', cents) : cents) : makerSide(m, cents);
    db.prepare('INSERT INTO gazette_payments (sub_id, maker_id, invoice, cents, maker_cents, house_cents) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(s.id, s.maker_id, String(invoice || 'x-' + Date.now()), cents, mc, cents - mc);
  }
  app.get('/gz/p/:id/thanks', async (req, res) => {
    let s = db.prepare('SELECT * FROM gazette_subs WHERE id=?').get(+req.params.id); if (!s) return res.sendStatus(404);
    if (stripe && req.query.session_id && s.tier !== 'paid') { try { const sess = await stripe.checkout.sessions.retrieve(String(req.query.session_id)); if (sess.metadata && String(sess.metadata.gazette) === String(s.id)) s = activate(s.id, sess) || s; } catch (e) { /* the webhook will */ } }
    res.redirect(`/gz/c/${s.token}`);
  });
  app.locals.gazetteEvent = event => {
    try {
      const o = event.data && event.data.object; if (!o) return;
      if (event.type === 'checkout.session.completed' && o.metadata && o.metadata.gazette) activate(o.metadata.gazette, o);
      if (event.type === 'invoice.paid' && o.subscription) { const s = db.prepare('SELECT * FROM gazette_subs WHERE stripe_sub=?').get(String(o.subscription)); if (s && o.billing_reason !== 'subscription_create') pay(s.id, o.id, o.amount_paid); }
      if (event.type === 'customer.subscription.deleted' && o.metadata && o.metadata.gazette) db.prepare("UPDATE gazette_subs SET tier='free' WHERE id=?").run(+o.metadata.gazette);
    } catch (e) { console.error('[gazette] event', e.message); }
  };
  const earned = makerId => db.prepare('SELECT COALESCE(SUM(maker_cents),0) s, COUNT(*) n FROM gazette_payments WHERE maker_id=?').get(makerId);
  const clearing = (makerId, since) => db.prepare("SELECT COALESCE(SUM(maker_cents),0) s, COUNT(*) n FROM gazette_payments WHERE maker_id=? AND at > datetime('now', ?)").get(makerId, since || `-${HOLD_DAYS} days`);

  // Recommendations: up to three makers, by handle.
  const recsOf = m => { let r = []; try { r = JSON.parse(plan(m).recs || '[]'); } catch (e) { r = []; } return r.map(h => maker(h)).filter(x => x && x.id !== m.id).slice(0, 3); };

  // The box on the maker's page (inside the masthead's paper) and at the end of a piece.
  function box(m, req, { back, source = 'page' } = {}) {
    const p = plan(m), s = subOf(req, m), said = { check: 'Check your inbox: one tap confirms it.', email: 'An email, please.', closed: 'Paying is not open just now.' }[req.query && req.query.gz] || '';
    const recs = recsOf(m);
    const head = `<p class="gz-sk">By post</p><h3 class="gz-sh">${s && s.status === 'on' ? `You read ${esc(m.kind && m.kind !== 'maker' ? m.name : first(m.name))}${s.tier === 'paid' ? ', and support the work' : ''}.` : `${esc(m.kind && m.kind !== 'maker' ? m.name : first(m.name))}’s new work, by post.`}</h3>`;
    const form = s && s.status === 'on' ? `<p class="gz-sl">Letters come to ${esc(s.email)}. <a href="/gz/u/${esc(s.token)}">Your subscription</a></p>${p.paid_on && s.tier !== 'paid' ? paidBox(m, s.email, s.name) : ''}`
      : `<form method="post" action="/m/${esc(slugOf(m))}/subscribe" class="gz-f"><input name="email" type="email" required placeholder="Your email" maxlength="160" autocomplete="email" value="${esc((buyerOf(req) || {}).email || '')}"><input type="hidden" name="back" value="${esc(back || `/m/${slugOf(m)}`)}"><input type="hidden" name="source" value="${source}"><input name="website" class="hpot" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="buy-btn">Subscribe</button></form><p class="gz-sl">Free. A letter when something new is published; nothing else, ever. One tap to stop.</p>${p.paid_on ? `<p class="gz-sl">Or <a href="#gz-paid" data-gz-paid>support ${esc(first(m.name))} for ${money(totalOf(m, p.price))} a month</a>.</p><div id="gz-paid" hidden>${paidBox(m)}</div><script>document.addEventListener('click',function(e){var a=e.target.closest('[data-gz-paid]');if(!a)return;e.preventDefault();document.getElementById('gz-paid').hidden=false;});</script>` : ''}`;
    return `<aside class="gz-sub" id="gz">${head}${said ? `<p class="gz-said">${esc(said)}</p>` : ''}${form}${recs.length && source === 'page' ? `<p class="gz-recs"><span>${esc(first(m.name))} reads</span> ${recs.map(r => `<a href="/m/${esc(slugOf(r))}">${esc(r.name)}</a>`).join(' · ')}</p>` : ''}</aside>`;
  }

  // A piece for paying subscribers: the opening for everyone else.
  const OPEN = 3;
  function locked(t, req) {
    if (!t || !t.maker_id || !t.subscribers_only) return null;
    const m = makerById(t.maker_id); if (!m) return null; const r = reads(req, m); if (r === 'host' || r === 'paid') return null;
    const paras = String(t.body || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean); const out = []; let n = 0;
    for (const p of paras) { out.push(p); if (!/^##?\s/.test(p)) n++; if (n >= OPEN) break; }
    return { preview: out.join('\n\n'), card: `<section class="gz-lock"><p class="k">For ${esc(first(m.name))}’s paying subscribers</p><h2>The rest of this piece is theirs.</h2>${plan(m).paid_on ? paidBox(m, (subOf(req, m) || {}).email, (subOf(req, m) || {}).name) : `<p>${esc(first(m.name))} has not opened paid subscriptions yet.</p>`}<p class="gz-sl">Already paying? <a href="/signin?next=${encodeURIComponent('/read/' + t.slug)}">Sign in</a> with the address you subscribed with.</p></section>` };
  }
  // The end of a maker's piece: subscribe, and the bench.
  function endOf(t, req) {
    if (!t || !t.maker_id) return ''; const m = makerById(t.maker_id); if (!m) return '';
    const n = db.prepare("SELECT COUNT(*) n FROM bench_lines WHERE kind='text' AND subject_id=? AND removed_at IS NULL").get(t.id).n;
    return `<section class="gz-end">${box(m, req, { back: `/read/${t.slug}`, source: 'piece' })}<p class="gz-bench"><a href="/bench/text/${esc(t.slug)}">The bench</a> · ${n ? `${n} ${n === 1 ? 'line' : 'lines'} from readers` : `${esc(first(m.name))}’s subscribers talk about it here`}</p></section>`;
  }

  // The bench under writing: the subscribers' own (paying ones, for a piece that is theirs), the maker, the house.
  const benchText = slug => db.prepare("SELECT * FROM texts WHERE slug=? AND status='held' AND public=1 AND maker_id IS NOT NULL").get(String(slug));
  function mayTalk(req, t, m) { const r = reads(req, m); if (!r) return { may: false, why: `Subscribe to ${first(m.name)}’s Gazette to talk here.` }; if (t.subscribers_only && r === 'free') return { may: false, why: 'This piece’s bench is for paying subscribers.' }; const s = r === 'host' ? null : subOf(req, m); const me = makerOf(req); const name = r === 'host' ? (me ? me.name : 'The Studio') : (s && s.name) || ((buyerOf(req) || {}).name) || null; return { may: !!name, name, why: name ? '' : 'Give your name when you subscribe; every line is signed.', host: r === 'host', sub: s }; }
  app.get('/bench/text/:slug', (req, res) => {
    const t = benchText(req.params.slug); if (!t) return res.sendStatus(404); const m = makerById(t.maker_id); const who = mayTalk(req, t, m);
    const ls = db.prepare("SELECT * FROM bench_lines WHERE kind='text' AND subject_id=? AND removed_at IS NULL ORDER BY (seen_at IS NOT NULL) DESC, id ASC LIMIT 300").all(t.id);
    const ok = { said: 'Said.', short: 'A sentence at least, please.', link: 'No links on the bench.', no: who.why }[req.query.ok] || '';
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: `The bench · ${tidy(t.title)} · Watermark`, path: '/keys', body: `<section class="bn"><header class="bn-h"><p class="k"><a href="/m/${esc(slugOf(m))}">${esc(m.name)}’s Gazette</a> · The bench</p><h1>On the bench.</h1><p class="bn-rule"><a href="/read/${esc(t.slug)}"><i>${esc(tidy(t.title))}</i></a>. ${t.subscribers_only ? 'Paying subscribers' : 'Subscribers'} and ${esc(first(m.name))} talk here; signed, a sentence at least.</p></header>
${ok ? `<p class="bn-note">${esc(ok)}</p>` : ''}${ls.length ? `<ol class="bn-lines">${ls.map(l => `<li class="${l.seen_at ? 'seen' : ''}"><p class="bn-p">${esc(l.body)}</p><p class="bn-s"><b>${esc(l.name)}</b><span>${esc(date(l.at))}</span>${l.maker_id === m.id ? '<em>The writer</em>' : ''}${who.host ? `<form method="post" action="/bench/text/${esc(t.slug)}/${l.id}/remove"><button class="link">Take down</button></form>` : ''}</p></li>`).join('')}</ol>` : '<p class="bn-rule">No one has spoken yet.</p>'}
${who.may ? `<form method="post" action="/bench/text/${esc(t.slug)}" class="bn-f"><label><span>${esc(who.name)}${who.host ? ', the writer' : ''}</span><textarea name="body" required minlength="20" maxlength="1200" rows="3"></textarea></label><button class="buy-btn">Say it</button></form>` : `<div class="bn-door">${!reads(req, m) ? box(m, req, { back: `/bench/text/${t.slug}`, source: 'piece' }) : `<p>${esc(who.why)}</p>${plan(m).paid_on ? paidBox(m, (who.sub || {}).email) : ''}`}</div>`}</section>` }));
  });
  const benchHits = new Map();
  app.post('/bench/text/:slug', (req, res) => {
    const t = benchText(req.params.slug); if (!t) return res.sendStatus(404); const m = makerById(t.maker_id); const who = mayTalk(req, t, m);
    const back = `/bench/text/${t.slug}`; if (!who.may) return res.redirect(303, back + '?ok=no');
    const body = String((req.body || {}).body || '').trim().slice(0, 1200);
    if (body.length < 20 || !/\s/.test(body)) return res.redirect(303, back + '?ok=short');
    if (/https?:\/\/|www\./i.test(body)) return res.redirect(303, back + '?ok=link');
    const k = req.ip, now = Date.now(), h = (benchHits.get(k) || []).filter(x => now - x < 600e3); if (h.length >= 6) return res.redirect(303, back); h.push(now); benchHits.set(k, h);
    const me = makerOf(req), b = buyerOf(req);
    db.prepare("INSERT INTO bench_lines (kind, subject_id, buyer_id, maker_id, name, body) VALUES ('text',?,?,?,?,?)").run(t.id, who.host ? null : (b && b.id) || null, who.host && me ? me.id : null, who.name, body);
    if (!who.host && app.locals.notify) app.locals.notify.tell({ maker_id: m.id, kind: 'bench', href: back, title: `${who.name} on ${tidy(t.title)}`, body: body.slice(0, 140) }).catch(() => {});
    res.redirect(303, back + '?ok=said');
  });
  app.post('/bench/text/:slug/:id/remove', (req, res) => {
    const t = benchText(req.params.slug); if (!t) return res.sendStatus(404); const m = makerById(t.maker_id);
    if (reads(req, m) !== 'host') return res.sendStatus(403);
    db.prepare("UPDATE bench_lines SET removed_at=datetime('now') WHERE id=? AND kind='text' AND subject_id=?").run(+req.params.id, t.id); res.redirect(303, `/bench/text/${t.slug}`);
  });

  // The letter: the piece in the house's frame, whole for those who may read it, the opening for the rest.
  const para = p => /^##?\s/.test(p) ? `<tr><td class="wm-pad" style="padding:22px 56px 4px;font:400 22px/1.3 Georgia,'Times New Roman',serif;color:#151412">${esc(p.replace(/^#+\s*/, ''))}</td></tr>`
    : /^>\s?/.test(p) ? `<tr><td class="wm-pad" style="padding:8px 56px 8px 72px;font:italic 400 18px/1.6 Georgia,'Times New Roman',serif;color:#4a463f">${esc(p.replace(/^>\s?/, '')).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*\n]+)\*/g, '<i>$1</i>')}</td></tr>`
    : p === '* * *' ? '<tr><td align="center" style="padding:14px 0;color:#a29d93">⁂</td></tr>'
    : `<tr><td class="wm-pad" style="padding:0 56px 16px;font:400 18px/1.62 Georgia,'Times New Roman',serif;color:#151412">${esc(p).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*\n]+)\*/g, '<i>$1</i>')}</td></tr>`;
  function letter(t, m, s) {
    const whole = !t.subscribers_only || s.tier === 'paid';
    const paras = String(t.body || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
    const LONG = 60; const shown = whole ? paras.slice(0, LONG) : (() => { const o = []; let n = 0; for (const p of paras) { o.push(p); if (!/^##?\s/.test(p)) n++; if (n >= OPEN) break; } return o; })();
    const more = !whole || paras.length > shown.length;
    const cover = t.cover_work_id ? db.prepare("SELECT slug FROM works WHERE id=? AND status='held'").get(t.cover_work_id) : null;
    const url = `${C.base}/read/${t.slug}`, off = `${C.base}/gz/u/${s.token}`;
    const html = L.frame({ base: C.base, preheader: t.summary || `${tidy(t.title)}, by ${m.name}`, body: `<tr><td align="center" class="wm-pad" style="padding:22px 56px 0;font:10px/1.6 'Helvetica Neue',Helvetica,Arial,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:#7a756c">${esc(m.name)}’s Gazette</td></tr>
<tr><td align="center" class="wm-pad" style="padding:14px 56px 6px;font:400 36px/1.12 'Didot','Bodoni 72',Georgia,serif;color:#151412" class="wm-h">${esc(tidy(t.title))}</td></tr>
${t.summary ? `<tr><td align="center" class="wm-pad" style="padding:4px 56px 18px;font:italic 400 17px/1.5 Georgia,serif;color:#4a463f">${esc(t.summary)}</td></tr>` : ''}
${cover ? `<tr><td style="padding:8px 40px 26px" class="wm-pad"><img src="${C.base}/img/${esc(cover.slug)}/screen?f=jpg" width="520" alt="" style="display:block;width:100%;height:auto;border:0"></td></tr>` : ''}
${shown.map(para).join('')}
${more ? `<tr><td align="center" style="padding:10px 56px 26px" class="wm-pad"><a href="${url}" style="display:inline-block;background:#151412;color:#fcfbf8;text-decoration:none;font:13px/1 'Helvetica Neue',Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;padding:15px 24px">${whole ? 'Read on in the house' : 'Read on as a paying subscriber'}</a></td></tr>` : ''}
<tr><td align="center" class="wm-pad" style="padding:10px 56px 40px;font:13px/1.7 'Helvetica Neue',Helvetica,Arial,sans-serif;color:#7a756c"><a href="${C.base}/bench/text/${esc(t.slug)}" style="color:#151412">Talk about it on the bench</a> · <a href="${C.base}/m/${esc(slugOf(m))}" style="color:#151412">${esc(m.name)}’s page</a><br>You subscribed to ${esc(m.name)}’s Gazette on Watermark. <a href="${off}" style="color:#7a756c">Unsubscribe in one tap</a>.</td></tr>` });
    const text = `${m.name}’s Gazette\n\n${tidy(t.title)}\n${t.summary ? t.summary + '\n' : ''}\n${shown.map(p => p.replace(/^#+\s*/, '').replace(/^>\s?/, '')).join('\n\n')}\n\n${more ? `Read on: ${url}\n\n` : ''}Talk about it: ${C.base}/bench/text/${t.slug}\nUnsubscribe: ${off}`;
    return { html, text };
  }
  const SENDER = (m) => { const addr = (String(process.env.MAIL_FROM || '').match(/<([^>]+)>/) || [])[1] || 'house@watermark.krafftco.com'; return `${String(m.name).replace(/[<>"]/g, '')} · Watermark <${addr}>`; };
  const queue = []; let running = false;
  async function drain() { if (running) return; running = true; try { while (queue.length) { const j = queue.shift(); try { await mail.send(j); } catch (e) { console.error('[gazette] send', e.message); } if (GAP) await new Promise(r => setTimeout(r, GAP)); } } finally { running = false; } }
  function send(t, { only } = {}) {
    if (!t || !t.maker_id) return 0; const m = makerById(t.maker_id); if (!m) return 0;
    const subs = db.prepare(`SELECT * FROM gazette_subs WHERE maker_id=? AND status='on'${only === 'paid' ? " AND tier='paid'" : ''}`).all(m.id);
    for (const s of subs) { const { html, text } = letter(t, m, s); const off = `${C.base}/gz/u/${s.token}`; queue.push({ to: s.email, from: SENDER(m), subject: tidy(t.title), html, text, headers: { 'List-Unsubscribe': `<${off}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }); }
    db.prepare("UPDATE texts SET letter_sent_at=datetime('now') WHERE id=?").run(t.id);
    db.prepare('INSERT INTO gazette_sends (text_id, maker_id, n) VALUES (?,?,?)').run(t.id, m.id, subs.length);
    try { ledger.append(db, 'gazette.sent', t.slug, { n: subs.length }); } catch (e) { /* */ }
    drain();
    return subs.length;
  }

  // The maker's desk.
  app.get('/account/gazette', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/gazette');
    const p = plan(m), c = counts(m), E = earned(m.id), ok = req.query.ok ? String(req.query.ok) : '';
    const texts = db.prepare("SELECT t.*, (SELECT n FROM gazette_sends gs WHERE gs.text_id=t.id ORDER BY gs.id DESC LIMIT 1) sent_n FROM texts t WHERE t.maker_id=? AND t.status='held' AND t.kind <> 'photobook' ORDER BY t.id DESC LIMIT 60").all(m.id);
    const subs = db.prepare("SELECT * FROM gazette_subs WHERE maker_id=? AND status IN ('on','pending') ORDER BY id DESC LIMIT 200").all(m.id);
    const recs = recsOf(m).map(r => r.handle).join(', ');
    res.send(V.layout({ title: 'Your Gazette · Watermark', path: '/account/gazette', studio: true, body: `<section class="studio-wrap gzd"><p class="k">Your page and store</p><h1>Your Gazette.</h1>
<p class="lede">Your new writing goes to your readers by post, as a letter in the house’s hand. The list is yours: export it, bring your own, take it with you.</p>${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
<div class="gzd-n"><p><b>${c.n || 0}</b><span>subscribers</span></p><p><b>${c.paid || 0}</b><span>paying</span></p><p><b>${c.pending || 0}</b><span>waiting to confirm</span></p><p><b>${money(E.s)}</b><span>yours from the paid tier, all time</span></p></div>
<h2>Your writing</h2>${texts.length ? `<table class="tbl gzd-t"><tr><th>Piece</th><th>For</th><th>By post</th><th></th></tr>${texts.map(t => `<tr><td><a href="/read/${esc(t.slug)}">${esc(tidy(t.title))}</a>${t.public ? '' : ' <i>not shown</i>'}</td><td><form method="post" action="/account/gazette/only/${t.id}"><button class="link" title="Change who may read it whole">${t.subscribers_only ? 'Paying subscribers' : 'Everyone'}</button></form></td><td>${t.letter_sent_at ? `Sent ${esc(date(t.letter_sent_at))}${t.sent_n != null ? ` to ${t.sent_n}` : ''}` : '—'}</td><td>${!t.letter_sent_at && t.public ? `<form method="post" action="/account/gazette/send/${t.id}" onsubmit="return confirm('Send ${esc(tidy(t.title)).replace(/'/g, '')} to ${c.n || 0} subscriber${c.n === 1 ? '' : 's'}?')"><button class="buy-btn">Send to ${c.n || 0}</button></form>` : ''}</td></tr>`).join('')}</table>` : `<p>Nothing written yet. <a href="/account/writing">Write something</a>, or open <a href="/account/desk">the Writer’s Desk</a>.</p>`}
<h2>The paid tier</h2><form method="post" action="/account/gazette/plan" class="gzd-f"><label class="pw-chk"><input type="checkbox" name="paid_on" value="1"${p.paid_on ? ' checked' : ''}> Readers may support you by the month</label><label><span>Your price a month</span><input name="price" inputmode="decimal" value="${(p.price / 100).toFixed(2)}"></label><p class="note">${FEE.on() ? `Every dollar of your price is yours; the house’s share is paid by the reader on top (${money(totalOf(m, p.price))} in all).` : `${m.share_pct || 85}% is yours.`} Paid out every Friday with everything else. A piece marked for paying subscribers is read whole by them and in its opening by everyone else.</p>
<label><span>A line for new subscribers</span><input name="welcome" maxlength="300" value="${esc(p.welcome || '')}" placeholder="Thank you for reading. Expect a letter a month."></label><label><span>Makers you read (up to three, by their address on Watermark)</span><input name="recs" maxlength="200" value="${esc(recs)}" placeholder="their-handle, another"></label><p><button class="buy-btn">Save</button></p></form>
<h2>Your list <span class="note"><a href="/account/gazette.csv">Export it</a></span></h2>
<form method="post" action="/account/gazette/import" class="gzd-f"><label><span>Bring your own list: an email a line, a name after a comma if you have it</span><textarea name="list" rows="4" maxlength="200000" placeholder="ana@example.com, Ana"></textarea></label><label class="pw-chk"><input type="checkbox" name="attest" value="1" required> These people asked to hear from me.</label><p><button class="buy-btn">Bring them in</button></p></form>
${subs.length ? `<table class="tbl"><tr><th>Email</th><th>Name</th><th></th><th>Since</th></tr>${subs.map(s => `<tr><td>${esc(s.email)}</td><td>${esc(s.name || '')}</td><td>${s.status === 'pending' ? 'Waiting to confirm' : s.tier === 'paid' ? 'Paying' : 'Free'}</td><td>${esc(date(s.confirmed_at || s.created_at))}</td></tr>`).join('')}</table>` : '<p class="note">No one yet. Your page carries the box; so does the end of every piece you write.</p>'}
</section>` }));
  });
  app.post('/account/gazette/plan', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); const x = req.body || {};
    const price = Math.max(100, Math.min(100000, Math.round(parseFloat(String(x.price || '5').replace(/[^\d.]/g, '')) * 100) || PRICE));
    const recs = String(x.recs || '').split(/[\s,]+/).map(h => h.replace(/^.*\/m\//, '').replace(/^@/, '').trim()).filter(Boolean).map(h => maker(h)).filter(r => r && r.id !== m.id).slice(0, 3).map(r => r.handle);
    db.prepare('INSERT INTO gazette_plans (maker_id, price_cents, paid_on, welcome, recs) VALUES (?,?,?,?,?) ON CONFLICT (maker_id) DO UPDATE SET price_cents=excluded.price_cents, paid_on=excluded.paid_on, welcome=excluded.welcome, recs=excluded.recs')
      .run(m.id, price, x.paid_on ? 1 : 0, String(x.welcome || '').trim().slice(0, 300) || null, JSON.stringify(recs));
    res.redirect('/account/gazette?ok=Saved.');
  });
  app.post('/account/gazette/send/:id', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const t = db.prepare("SELECT * FROM texts WHERE id=? AND maker_id=? AND status='held' AND public=1").get(+req.params.id, m.id); if (!t) return res.sendStatus(404);
    if (t.letter_sent_at) return res.redirect('/account/gazette?ok=' + encodeURIComponent('That one has gone already.'));
    const n = send(t); res.redirect('/account/gazette?ok=' + encodeURIComponent(n ? `On its way to ${n} reader${n === 1 ? '' : 's'}.` : 'Sent to no one yet: the list is empty.'));
  });
  app.post('/account/gazette/only/:id', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const t = db.prepare('SELECT * FROM texts WHERE id=? AND maker_id=?').get(+req.params.id, m.id); if (!t) return res.sendStatus(404);
    db.prepare('UPDATE texts SET subscribers_only=? WHERE id=?').run(t.subscribers_only ? 0 : 1, t.id);
    res.redirect('/account/gazette?ok=' + encodeURIComponent(t.subscribers_only ? `${tidy(t.title)} is for everyone.` : `${tidy(t.title)} is for paying subscribers; everyone else reads its opening.`));
  });
  app.get('/account/gazette.csv', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = db.prepare("SELECT * FROM gazette_subs WHERE maker_id=? AND status='on' ORDER BY id").all(m.id);
    res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', `attachment; filename="${(m.handle || 'gazette')}-subscribers.csv"`); res.set('Cache-Control', 'private, no-store');
    res.send(['email,name,tier,since', ...rows.map(s => [s.email, s.name, s.tier, s.confirmed_at || s.created_at].map(q).join(','))].join('\n') + '\n');
  });
  app.post('/account/gazette/import', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401); const x = req.body || {};
    if (!x.attest) return res.redirect('/account/gazette?ok=' + encodeURIComponent('Only people who asked to hear from you.'));
    let n = 0, bad = 0;
    for (const line of String(x.list || '').split(/\r?\n/).slice(0, 20000)) {
      const [e, ...rest] = line.split(/[,\t;]/); const email = String(e || '').trim().toLowerCase().replace(/^"|"$/g, ''); if (!email || email === 'email') continue;
      if (!okEmail(email)) { bad++; continue; }
      const name = rest.join(' ').trim().replace(/^"|"$/g, '').slice(0, 120) || null;
      const had = db.prepare('SELECT * FROM gazette_subs WHERE maker_id=? AND lower(email)=?').get(m.id, email);
      if (had) { if (had.status === 'off') continue; if (had.status === 'pending') { db.prepare("UPDATE gazette_subs SET status='on', confirmed_at=datetime('now') WHERE id=?").run(had.id); n++; } continue; }
      db.prepare("INSERT INTO gazette_subs (maker_id, email, name, token, status, source, confirmed_at) VALUES (?,?,?,?,'on','import',datetime('now'))").run(m.id, email, name, newToken()); n++;
    }
    try { ledger.append(db, 'gazette.imported', m.handle, { n }); } catch (e) { /* */ }
    res.redirect('/account/gazette?ok=' + encodeURIComponent(`${n} brought in${bad ? `; ${bad} line${bad === 1 ? '' : 's'} not an email` : ''}. Anyone who unsubscribed before stays off.`));
  });

  app.locals.gazette = { box, locked, endOf, send, drain, earned, clearing, subOf, reads, plan, counts, queue };
  return app.locals.gazette;
}
module.exports = { mountGazette };
