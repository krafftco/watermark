// A museum for everyone (Will, 29 Oct: "we have to find a way to create a museum of everybody's work; Watermark is a
// museum, and it's curated, meaning what's on the walls has been placed there intentionally"; "making it where people
// can upload their work and manage all this is the only way this works"; "not an elitist club that I have to manage";
// "you can follow an artist, a collector and a curator"; "do whatever is best for the company and its long term growth").
//
// Three things, so the house runs and grows without a hand at every door:
// 1. Every maker opens their own museum at once (the open door, makers.door='record'): they put work in, cull it,
//    price it and hang it, as the curator of their own walls. A museum has a limited wall (MUSEUM_WALL, 36 on view);
//    the rest stays in storage, fingerprinted and deeded. The limit is what keeps a museum a museum.
// 2. The house's halls (the collection, Wander's open feed, today's work, For you) hold what was placed there:
//    every work of a maker the house has invited, and a work from any museum once it has earned the hall by the
//    signals that cost something: someone else paid for it, a curator hung it on a public wall, or two people called
//    Bravo (three a month each). The house may pass or take back any work by hand, and never has to.
// 3. Anyone follows anyone: an artist, a collector, a curator. A follow is private (no counts on the wall, as
//    Instagram has followers); what a profile shows in public is its collectors, the people who paid. Wander's
//    Following (in=following) walks what the people you follow did lately: new work on view, a wall hung, a piece
//    collected.
'use strict';
const MUSEUM_WALL = Number(process.env.MUSEUM_WALL || 36);
const BRAVOS_TO_HALL = Number(process.env.BRAVOS_TO_HALL || 2);
const EARN_MIN = Number(process.env.HALL_EARN_MIN || 5);

function mountMuseums(app, { db, C, V, studioOnly }) {
  for (const [c, t] of [['hall', 'INTEGER NOT NULL DEFAULT 0'], ['hall_why', 'TEXT']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name=?").get(c)) db.exec(`ALTER TABLE works ADD COLUMN ${c} ${t}`);
  db.exec(`CREATE TABLE IF NOT EXISTS follows (id INTEGER PRIMARY KEY, who TEXT NOT NULL, kind TEXT NOT NULL, target INTEGER NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (who, kind, target))`);
  db.exec('CREATE INDEX IF NOT EXISTS follows_target ON follows (kind, target)');
  const esc = V.esc;
  const makerOf = req => (app.locals.accounts ? app.locals.accounts.makerOf(req) : null);
  const buyerOf = req => (app.locals.buyerOf ? app.locals.buyerOf(req) : null);

  // The halls: a fragment for every query that fills the house's own walls.
  const hallSql = (a = 'w') => ` AND (${a}.hall=1 OR ${a}.maker_id NOT IN (SELECT id FROM makers WHERE door='record'))`;
  // A museum's wall: how many more may go on view.
  const onView = m => db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(m.id).n;
  const wallLeft = m => (!m || m.door !== 'record' ? Infinity : Math.max(0, MUSEUM_WALL - onView(m)));

  // Earning the hall, by what costs something. Run every few minutes and after the acts that earn it.
  const OPEN_MAKERS = "SELECT id FROM makers WHERE door='record'";
  const selfBuyer = 'COALESCE((SELECT mb.buyer_id FROM makers mb WHERE mb.id=works.maker_id), -1)';
  function earn() {
    let n = 0;
    const set = (why, cond) => { n += db.prepare(`UPDATE works SET hall=1, hall_why=? WHERE hall=0 AND status='held' AND maker_id IN (${OPEN_MAKERS}) AND ${cond}`).run(why, ).changes; };
    try {
      set('collected', `EXISTS (SELECT 1 FROM licenses l WHERE l.work_id=works.id AND l.status='active' AND COALESCE(l.price_cents,0) > 0 AND COALESCE(l.buyer_id,-2) <> ${selfBuyer})`);
      set('hung', `EXISTS (SELECT 1 FROM hang_works hw JOIN hangs h ON h.id=hw.hang_id WHERE hw.work_id=works.id AND h.public=1 AND h.buyer_id <> ${selfBuyer})`);
      set('bravo', `(SELECT COUNT(*) FROM bravos bv WHERE bv.work_id=works.id) >= ${BRAVOS_TO_HALL}`);
    } catch (e) { console.error('[museums] earn', e.message); }
    if (n && app.locals.findIndexDirty) app.locals.findIndexDirty();
    return n;
  }
  if (!app.locals.noTimers && require('./role').chores) setInterval(earn, EARN_MIN * 60000).unref();

  // The house's say, by hand (never needed for the house to run).
  app.post('/studio/works/:slug/hall', studioOnly, (req, res) => {
    const on = req.body.on === '1' ? 1 : 0;
    db.prepare("UPDATE works SET hall=?, hall_why=? WHERE slug=?").run(on, on ? 'house' : 'house: out', String(req.params.slug));
    if (req.body.json === '1') return res.json({ ok: true, on });
    res.redirect(String(req.body.back || '/studio'));
  });

  // ---------- following ----------
  const meOf = req => { const b = buyerOf(req); if (b) return 'b:' + b.id; const m = makerOf(req); return m ? 'm:' + m.id : null; };
  const KINDS = { maker: 'makers', gallery: 'buyers' };
  const parseKey = k => { const [kind, id] = String(k || '').split(':'); return KINDS[kind] && +id > 0 ? { kind, target: +id } : null; };
  const exists = t => !!db.prepare(`SELECT 1 FROM ${KINDS[t.kind]} WHERE id=?`).get(t.target);
  const self = (req, t) => { const b = buyerOf(req), m = makerOf(req); return (t.kind === 'maker' && m && m.id === t.target) || (t.kind === 'gallery' && b && b.id === t.target); };

  app.get('/api/follow', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const me = meOf(req); const keys = String(req.query.k || '').split(',').map(parseKey).filter(Boolean).slice(0, 40);
    const out = {}; for (const t of keys) out[`${t.kind}:${t.target}`] = me ? !!db.prepare('SELECT 1 FROM follows WHERE who=? AND kind=? AND target=?').get(me, t.kind, t.target) : false;
    res.json({ ok: true, signed: !!me, on: out });
  });
  app.post('/follow', (req, res) => {
    const t = parseKey(req.body.k); if (!t || !exists(t)) return res.status(404).json({ ok: false });
    const me = meOf(req); if (!me) return res.json({ ok: false, go: '/signin?next=' + encodeURIComponent(String(req.body.back || '/')) });
    if (self(req, t)) return res.json({ ok: false, error: 'This is you.' });
    const had = db.prepare('SELECT id FROM follows WHERE who=? AND kind=? AND target=?').get(me, t.kind, t.target);
    if (had) db.prepare('DELETE FROM follows WHERE id=?').run(had.id); else db.prepare('INSERT INTO follows (who, kind, target) VALUES (?,?,?)').run(me, t.kind, t.target);
    if (!had && app.locals.notify && app.locals.notify.tell) {
      try { Promise.resolve(app.locals.notify.tell({ ...(t.kind === 'maker' ? { maker_id: t.target } : { buyer_id: t.target }), kind: 'follow', title: 'Someone follows you now', body: 'Who follows you is theirs to keep; what your page shows is your collectors.', href: t.kind === 'maker' ? '/account' : '/yours' })).catch(() => {}); } catch (e) { /* quiet */ }
    }
    res.json({ ok: true, on: !had });
  });
  const button = key => `<button type="button" class="fo-b" data-follow="${esc(key)}" aria-pressed="false"><span data-fo-w>Follow</span></button>`;

  // Who I follow, as people.
  function followed(req) {
    const me = meOf(req); if (!me) return [];
    return db.prepare('SELECT kind, target, at FROM follows WHERE who=? ORDER BY id DESC').all(me).map(f => {
      if (f.kind === 'maker') { const m = db.prepare('SELECT id, name, handle, portrait FROM makers WHERE id=?').get(f.target); return m ? { kind: 'maker', id: m.id, name: m.name, href: `/m/${V.makerSlug(m)}`, portrait: m.portrait ? `/portrait/${m.handle}` : null } : null; }
      const b = db.prepare('SELECT id, name, code, public FROM buyers WHERE id=?').get(f.target); return b && b.public && b.code ? { kind: 'gallery', id: b.id, name: b.name || 'A collector', href: `/g/${b.code}` } : null;
    }).filter(Boolean);
  }
  // What the people I follow did lately, newest first: new work on view, a wall hung, a piece collected.
  function feed(req, limit = 120) {
    const me = meOf(req); if (!me) return [];
    const mk = db.prepare("SELECT target FROM follows WHERE who=? AND kind='maker'").all(me).map(r => r.target);
    const gs = db.prepare("SELECT target FROM follows WHERE who=? AND kind='gallery'").all(me).map(r => r.target);
    const ev = [];
    const IN = a => a.map(() => '?').join(',');
    if (mk.length) for (const w of db.prepare(`SELECT w.*, w.created_at AS t, 'made' AS why FROM works w WHERE w.maker_id IN (${IN(mk)}) AND w.status='held' ORDER BY w.id DESC LIMIT 200`).all(...mk)) ev.push(w);
    if (gs.length) {
      const pub = db.prepare(`SELECT id FROM buyers WHERE id IN (${IN(gs)}) AND public=1`).all(...gs).map(r => r.id);
      if (pub.length) {
        for (const w of db.prepare(`SELECT w.*, l.starts_at AS t, 'collected' AS why FROM licenses l JOIN works w ON w.id=l.work_id WHERE l.buyer_id IN (${IN(pub)}) AND l.status='active' AND w.status='held' ORDER BY l.id DESC LIMIT 200`).all(...pub)) ev.push(w);
      }
      for (const w of db.prepare(`SELECT w.*, h.created_at AS t, 'hung' AS why FROM hang_works hw JOIN hangs h ON h.id=hw.hang_id JOIN works w ON w.id=hw.work_id WHERE h.buyer_id IN (${IN(gs)}) AND h.public=1 AND w.status='held' ORDER BY h.id DESC LIMIT 200`).all(...gs)) ev.push(w);
    }
    ev.sort((a, b) => String(b.t || '').localeCompare(String(a.t || '')));
    const seen = new Set(); return ev.filter(w => !seen.has(w.slug) && seen.add(w.slug)).slice(0, limit);
  }
  // The set Wander walks for in=following (stroll.js asks for it like any set).
  const set = req => { const works = feed(req); return works.length ? { label: 'Following', href: '/yours/following', works } : null; };

  app.get('/yours/following', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!meOf(req)) return res.redirect('/signin?next=/yours/following');
    const people = followed(req), works = feed(req, 24);
    const body = `<section class="studio-wrap fo"><p class="k"><a href="/yours">Yours</a></p><h1>Following.</h1>
<p class="lede">The artists, collectors and curators you follow. No one sees whom you follow, or how many follow you; what a page shows is its collectors.</p>
${works.length ? `<p><a class="buy-btn" href="/wander?in=following">Wander what they did lately</a></p>` : ''}
<ol class="fo-list">${people.map(p => `<li><a href="${esc(p.href)}">${p.portrait ? `<img src="${esc(p.portrait)}" alt="">` : '<span class="fo-ph"></span>'}<b>${esc(p.name)}</b><i>${p.kind === 'maker' ? 'Artist' : 'Collector · curator'}</i></a>${button(`${p.kind}:${p.id}`)}</li>`).join('') || '<li class="muted">No one yet. Follow an artist from their page, or a collector from their gallery.</li>'}</ol></section>
<script src="/static/follow.js" defer></script>`;
    res.send(V.layout({ title: 'Following · Watermark', path: '/yours', body }));
  });

  // The open door: anyone opens their museum (the form posts to /record, own.js).
  app.get('/open', (req, res) => res.redirect('/join'));

  app.locals.museums = { MUSEUM_WALL, hallSql, wallLeft, onView, earn, button, feed, set, followed, meOf };
  return app.locals.museums;
}

// The door, said: what opens when you open a museum.
function joinPage({ esc, base, err }) {
  return `<section class="narrow jn"><p class="k">For everyone who makes pictures</p><h1>Open your museum.</h1>
<p class="lede">Put your pictures in, keep all of them, and hang the best: your own museum, under your name, in a minute. Your trips, your family, your work; the ones you hold back stay yours and stay private.</p>
${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" action="/record" class="own-f"><label>Your name<input name="name" required maxlength="80" autocomplete="name"></label><label>Email<input name="email" type="email" required maxlength="160" autocomplete="email"></label><label class="own-adult"><input type="checkbox" name="adult" value="1" required> I am eighteen or older</label><button class="buy-btn">Open my museum</button></form>
<ul class="jn-what"><li><b>Your museum.</b> You are its curator: ${MUSEUM_WALL} works on view at a time, in your order, and everything else kept in storage, fingerprinted and deeded as yours.</li>
<li><b>Your store.</b> Set your prices; the price is yours, whole. The house's share is paid by the collector, on top. Paid every Friday.</li>
<li><b>The house's halls.</b> Work rises into Watermark's own collection when it is collected, hung by a curator or called Bravo. No one has to let you in.</li>
<li><b>Held back, kept safe.</b> A picture of someone close, or one you can’t share yet, stays in your archive, locked and copied twice; in a trip it shows only as a wash of its colours.</li>
<li><b>Collectors, not followers.</b> Anyone can follow you. What your page shows is how many have collected you.</li></ul>
<p class="note">Nothing is public until you hang it. ${esc(base.replace(/^https?:\/\//, ''))} is a Krafft company.</p></section>`;
}

module.exports = { mountMuseums, joinPage, MUSEUM_WALL };
