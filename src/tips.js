// Tips: a reader pays the people who made a story. The writer and the photographer today; narration,
// film and music later, by the same rule: every story carries its credits, and a tip is shared among them.
// Credits come from Krafft Studios (Ghost's author for the words; Watermark's own record for the
// photographs) and can be added by hand for other media. Tips land in the house's Stripe account and are
// recorded to each person; paying them out directly needs Stripe Connect, which comes with counsel.
const ROLES = { words: 'Words', photographs: 'Photographs', narration: 'Narration', film: 'Film', music: 'Music' };
const AMOUNTS = [300, 500, 1000, 2500];

function mountTips(app, { db, C, stripe, maker, slugify, ledger, V, ghost = {}, fetchImpl = fetch }) {
  db.exec(`CREATE TABLE IF NOT EXISTS credits (id INTEGER PRIMARY KEY, post_slug TEXT NOT NULL, role TEXT NOT NULL, maker_id INTEGER NOT NULL, source TEXT,
    UNIQUE(post_slug, role, maker_id))`);
  db.exec(`CREATE TABLE IF NOT EXISTS stories (slug TEXT PRIMARY KEY, title TEXT, url TEXT, fetched_at TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS tips (id INTEGER PRIMARY KEY, grp TEXT NOT NULL, post_slug TEXT, maker_id INTEGER NOT NULL, role TEXT, amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', name TEXT, email TEXT, note TEXT, stripe_session TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT)`);
  const API = ghost.api || process.env.GHOST_CONTENT_API || 'https://krafftstudios.ghost.io/ghost/api/content';
  const KEY = ghost.key || process.env.GHOST_CONTENT_KEY || '8198cc66daa230f254acfaf9d5';
  const clean = s => String(s || '').replace(/[^a-z0-9-]/gi, '').slice(0, 160);

  // A person is a maker record, whatever they make. Writers get one the first time they are credited.
  function personNamed(name) {
    const n = String(name || '').trim(); if (!n) return null;
    let m = db.prepare('SELECT * FROM makers WHERE lower(name)=lower(?)').get(n);
    if (!m) {
      let handle = slugify(n), i = 2; while (db.prepare('SELECT 1 FROM makers WHERE handle=?').get(handle)) handle = `${slugify(n)}-${i++}`;
      db.prepare("INSERT INTO makers (handle, name, kind) VALUES (?,?,'writer')").run(handle, n);
      m = db.prepare('SELECT * FROM makers WHERE handle=?').get(handle);
    }
    return m;
  }
  const credit = (post, role, m, source) => m && db.prepare('INSERT OR IGNORE INTO credits (post_slug, role, maker_id, source) VALUES (?,?,?,?)').run(post, role, m.id, source);

  // Who made this story. Reads Ghost once a day at most; the photographs come from what Watermark holds.
  async function creditsOf(post) {
    post = clean(post); if (!post) return null;
    let st = db.prepare('SELECT * FROM stories WHERE slug=?').get(post);
    if (!st || !st.fetched_at || Date.now() - new Date(st.fetched_at + 'Z').getTime() > 864e5) {
      try {
        const r = await fetchImpl(`${API}/posts/slug/${post}/?key=${KEY}&include=authors&fields=title,url,slug`, { signal: AbortSignal.timeout(4000) });
        if (r.ok) {
          const p = ((await r.json()).posts || [])[0];
          if (p) {
            db.prepare("INSERT INTO stories (slug, title, url, fetched_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(slug) DO UPDATE SET title=excluded.title, url=excluded.url, fetched_at=excluded.fetched_at").run(post, p.title, p.url);
            for (const a of p.authors || []) credit(post, 'words', personNamed(a.name), 'ghost');
          }
        }
      } catch (e) { /* offline: use what is known */ }
      st = db.prepare('SELECT * FROM stories WHERE slug=?').get(post);
    }
    for (const r of db.prepare('SELECT DISTINCT w.maker_id FROM studios_imports s JOIN works w ON w.id=s.work_id WHERE s.post_slug=?').all(post)) credit(post, 'photographs', db.prepare('SELECT * FROM makers WHERE id=?').get(r.maker_id), 'watermark');
    const rows = db.prepare('SELECT c.role, m.id, m.name FROM credits c JOIN makers m ON m.id=c.maker_id WHERE c.post_slug=? ORDER BY c.id').all(post);
    if (!st && !rows.length) return null;
    // One line per person, with every role they played: "Words and photographs".
    const people = [];
    for (const r of rows) { let p = people.find(x => x.id === r.id); if (!p) people.push(p = { id: r.id, name: r.name, roles: [] }); if (!p.roles.includes(r.role)) p.roles.push(r.role); }
    for (const p of people) p.label = p.roles.map((k, i) => (i ? ROLES[k].toLowerCase() : ROLES[k]) || k).join(' and ');
    return { post, title: (st && st.title) || post, url: (st && st.url) || null, people };
  }
  app.locals.creditsOf = creditsOf;

  app.get('/tip/:post', async (req, res) => {
    const c = await creditsOf(req.params.post); if (!c || !c.people.length) return res.sendStatus(404);
    const back = /^https:\/\/([a-z0-9-]+\.)?krafftco\.com\//.test(String(req.query.back || '')) ? String(req.query.back) : c.url;
    res.send(V.tip({ c, amounts: AMOUNTS, back, open: !!stripe, unavailable: req.query.unavailable }));
  });

  app.post('/tip/:post', async (req, res) => {
    const c = await creditsOf(req.params.post); if (!c || !c.people.length || !stripe) return res.redirect(`/tip/${clean(req.params.post)}`);
    const x = req.body || {};
    const cents = Math.round(Number(String(x.own || x.amount || '').replace(/[^0-9.]/g, '')) * 100);
    if (!(cents >= 300 && cents <= 500000)) return res.redirect(`/tip/${c.post}`);
    // To everyone credited, shared evenly; or to one person.
    const to = x.to && x.to !== 'all' ? c.people.filter(p => String(p.id) === String(x.to)) : c.people;
    if (!to.length) return res.redirect(`/tip/${c.post}`);
    const grp = require('crypto').randomBytes(9).toString('base64url');
    const each = Math.floor(cents / to.length);
    to.forEach((p, i) => db.prepare('INSERT INTO tips (grp, post_slug, maker_id, role, amount_cents, note) VALUES (?,?,?,?,?,?)')
      .run(grp, c.post, p.id, p.roles.join('+'), i === 0 ? cents - each * (to.length - 1) : each, String(x.note || '').trim().slice(0, 280) || null));
    const names = to.map(p => p.name).join(' and ');
    const back = /^https:\/\/([a-z0-9-]+\.)?krafftco\.com\//.test(String(x.back || '')) ? String(x.back) : `${C.base}/tip/${c.post}`;
    try {
      const s = await stripe.checkout.sessions.create({
        mode: 'payment', submit_type: 'donate', customer_creation: 'always',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `For ${c.title}`, description: `A tip to ${names}. 85% goes to ${to.length > 1 ? 'them' : names}.` } } }],
        metadata: { tip: grp }, payment_intent_data: { metadata: { tip: grp } },
        success_url: `${C.base}/tip/thanks/${grp}?session_id={CHECKOUT_SESSION_ID}`, cancel_url: back,
      });
      db.prepare('UPDATE tips SET stripe_session=? WHERE grp=?').run(s.id, grp);
      res.redirect(303, s.url);
    } catch (e) { console.error('[tip]', e.message); db.prepare("DELETE FROM tips WHERE grp=? AND status='pending'").run(grp); res.redirect(`/tip/${c.post}?unavailable=1`); }
  });

  // The thank-you card. Ninety-nine cents, or more, to the person who made a photograph, with a word if you
  // like: an expression, not a purchase. iTunes taught people to spend a dollar on a thing they loved; this
  // is that, for a photograph. The house keeps none of it; the card fee comes out and the rest is theirs.
  const THANKS = [99, 499, 999];
  app.post('/w/:slug/thanks', async (req, res) => {
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(req.params.slug)); if (!w) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id) || maker;
    const x = req.body || {};
    const cents = x.amount === 'own' ? Math.round(Number(String(x.own || '').replace(/[^0-9.]/g, '')) * 100) : Math.round(Number(x.amount));
    if (!(cents >= 99 && cents <= 500000)) return res.redirect(`/w/${w.slug}#thanks`);
    const grp = require('crypto').randomBytes(9).toString('base64url');
    const word = String(x.word || '').trim().slice(0, 280) || null;
    // From the pocket, when it covers the card: posted at once, no checkout.
    const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null;
    if (b && app.locals.pocket && app.locals.pocket.spend(b, cents, 'thanks', grp, `${m.name.split(' ')[0]}, for ${String(w.title).replace(/[.\s]+$/, '')}`)) {
      db.prepare("INSERT INTO tips (grp, post_slug, maker_id, role, amount_cents, note, status, name, email, paid_at) VALUES (?,?,?,?,?,?,'paid',?,?,datetime('now'))").run(grp, `work:${w.slug}`, m.id, 'thanks', cents, word, b.name || null, b.email || null);
      ledger.append(db, 'thanks.given', `tip-${grp}`, { work: w.slug, to: m.handle, amount: cents, from: 'pocket' });
      return res.redirect(`/w/${w.slug}?thanks=given#thanks`);
    }
    if (!stripe) return res.redirect(`/w/${w.slug}?thanks=off#thanks`);
    db.prepare('INSERT INTO tips (grp, post_slug, maker_id, role, amount_cents, note) VALUES (?,?,?,?,?,?)').run(grp, `work:${w.slug}`, m.id, 'thanks', cents, word);
    try {
      const s = await stripe.checkout.sessions.create({
        mode: 'payment', submit_type: 'donate', customer_creation: 'always',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `Thank you, ${m.name}`, description: `For ${String(w.title).replace(/[.\s]+$/, '')}. The house keeps nothing of this; after the card fee it is ${m.name.split(' ')[0]}'s.` } } }],
        metadata: { tip: grp }, payment_intent_data: { metadata: { tip: grp } },
        success_url: `${C.base}/w/${w.slug}/thanked?grp=${grp}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${C.base}/w/${w.slug}#thanks`,
      });
      db.prepare('UPDATE tips SET stripe_session=? WHERE grp=?').run(s.id, grp);
      res.redirect(303, s.url);
    } catch (e) { console.error('[thanks]', e.message); db.prepare("DELETE FROM tips WHERE grp=? AND status='pending'").run(grp); res.redirect(`/w/${w.slug}?thanks=unavailable#thanks`); }
  });
  app.get('/w/:slug/thanked', async (req, res) => {
    const rows = db.prepare('SELECT * FROM tips WHERE grp=?').all(String(req.query.grp || ''));
    if (rows.length && rows[0].stripe_session === req.query.session_id && rows[0].status === 'pending' && stripe) { try { settle(rows[0].grp, await stripe.checkout.sessions.retrieve(req.query.session_id)); } catch (e) { /* the webhook will */ } }
    res.redirect(`/w/${req.params.slug}?thanks=given#thanks`);
  });
  // Thank-yous on a work: how many, and the words left with them (shown to the maker; the count to all).
  app.locals.thanksOf = w => ({ n: db.prepare("SELECT COUNT(*) n FROM tips WHERE post_slug=? AND status='paid'").get(`work:${w.slug}`).n, amounts: THANKS,
    words: db.prepare("SELECT note, name, amount_cents, paid_at FROM tips WHERE post_slug=? AND status='paid' AND note IS NOT NULL ORDER BY id DESC LIMIT 12").all(`work:${w.slug}`) });

  function settle(grp, s) {
    const rows = db.prepare('SELECT * FROM tips WHERE grp=?').all(grp); if (!rows.length || rows[0].stripe_session !== s.id || rows[0].status !== 'pending') return rows;
    if (s.status !== 'complete' && s.payment_status !== 'paid') return rows;
    const d = s.customer_details || {};
    db.prepare("UPDATE tips SET status='paid', name=?, email=?, paid_at=datetime('now') WHERE grp=?").run(d.name || null, d.email || null, grp);
    for (const t of rows) ledger.append(db, t.role === 'thanks' ? 'thanks.given' : 'tip.given', `tip-${t.id}`, { story: t.post_slug, work: t.role === 'thanks' ? String(t.post_slug).replace(/^work:/, '') : undefined, to: db.prepare('SELECT handle FROM makers WHERE id=?').get(t.maker_id).handle, role: t.role, amount: t.amount_cents });
    return db.prepare('SELECT * FROM tips WHERE grp=?').all(grp);
  }
  const prevEvent = app.locals.patronEvent;
  app.locals.patronEvent = event => {
    if (prevEvent) prevEvent(event);
    const o = event.data.object;
    if (event.type === 'checkout.session.completed' && o.metadata && o.metadata.tip) settle(String(o.metadata.tip), o);
  };

  app.get('/tip/thanks/:grp', async (req, res) => {
    let rows = db.prepare('SELECT t.*, m.name AS maker_name FROM tips t JOIN makers m ON m.id=t.maker_id WHERE t.grp=?').all(String(req.params.grp));
    if (!rows.length || rows[0].stripe_session !== req.query.session_id) return res.redirect('/');
    if (rows[0].status === 'pending' && stripe) { try { settle(rows[0].grp, await stripe.checkout.sessions.retrieve(req.query.session_id)); } catch (e) { /* shows as pending */ } }
    rows = db.prepare('SELECT t.*, m.name AS maker_name FROM tips t JOIN makers m ON m.id=t.maker_id WHERE t.grp=?').all(String(req.params.grp));
    const c = await creditsOf(rows[0].post_slug);
    res.send(V.tipThanks({ rows, c }));
  });

  // What tips have come to a person (or to everyone), paid only.
  const tipsTo = makerId => db.prepare(`SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM tips WHERE status='paid'${makerId ? ' AND maker_id=?' : ''}`).get(...(makerId ? [makerId] : []));
  app.locals.tipsTo = tipsTo;
  return { creditsOf, tipsTo, ROLES };
}

module.exports = { mountTips, ROLES };
