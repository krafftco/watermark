// The opening (Will, 18 Oct: a show in Meatpacking as the big launch, where photographers sign up for Watermark).
// A hang with an opening date and a venue (Make it a show) gains a reply card on its page: name, email, a guest,
// and "I make photographs". Each reply is kept (`rsvps`), the guest is written to, and the wall's curator and the
// house are told. Someone who makes photographs is handed the application (/join, their name and email filled in):
// Watermark is by invitation, so the door at the opening is the application, read in the Studio as any other.
// The guest list is the curator's and the Studio's: /hang/:id/guests (and .csv). Nothing of it is on the register.
function mountOpening(app, { db, C, V, mail, buyerOf, isStudio }) {
  db.exec(`CREATE TABLE IF NOT EXISTS rsvps (id INTEGER PRIMARY KEY, hang_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
    plus INTEGER NOT NULL DEFAULT 0, maker INTEGER NOT NULL DEFAULT 0, note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (hang_id, email))`);
  const esc = V.esc, HOUSE = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  const hang = id => db.prepare('SELECT * FROM hangs WHERE id=?').get(+id);
  const today = () => new Date().toISOString().slice(0, 10);
  const open = h => !!(h && h.public && h.opens_at && (!h.closes_at || h.closes_at >= today()));
  const when = d => { try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return d; } };
  const mine = (req, h) => { const b = buyerOf(req); return isStudio(req) || (b && b.id === h.buyer_id); };
  const hits = new Map(); // a few replies an address in ten minutes
  const slow = req => { const k = req.ip, now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 6e5); a.push(now); hits.set(k, a); return a.length > 6; };

  // The card on the wall's page (called by hangPage through app.locals).
  function card(h, q = {}) {
    if (!open(h)) return '';
    const past = h.opens_at < today();
    if (q.rsvp === 'yes') return `<section class="op" id="opening"><p class="k">The opening</p><h2>You are on the list.</h2><p class="lede">${past ? 'The show is up' : `${esc(when(h.opens_at))}`}${h.venue ? `, ${esc(h.venue)}` : ''}. A note is on its way to you.${q.maker === '1' ? ' You said you make photographs: your application is one step from here.' : ''}</p>${q.maker === '1' ? `<p><a class="btn" href="/join?name=${encodeURIComponent(q.n || '')}&email=${encodeURIComponent(q.e || '')}">Apply to show on Watermark</a></p>` : ''}</section>`;
    return `<section class="op" id="opening"><p class="k">${past ? 'Now showing' : 'The opening'}</p><h2>${past ? 'Come and see it.' : esc(when(h.opens_at)) + '.'}</h2>
<p class="lede">${h.venue ? esc(h.venue) + '. ' : ''}${past ? 'Leave your name and the house will keep you told of what comes next.' : 'Leave your name to be on the list. Bring someone if you like.'}</p>
<form method="post" action="/hang/${h.id}/rsvp" class="op-f"><label><span>Name</span><input name="name" required maxlength="120" autocomplete="name"></label><label><span>Email</span><input name="email" type="email" required maxlength="160" autocomplete="email"></label>
<label class="op-c"><input type="checkbox" name="plus" value="1"> Bringing a guest</label><label class="op-c"><input type="checkbox" name="maker" value="1"> I make photographs</label>
<input name="website" tabindex="-1" autocomplete="off" class="hpot" aria-hidden="true"><button>${past ? 'Keep me told' : 'Put me on the list'}</button></form></section>`;
  }

  app.post('/hang/:id/rsvp', (req, res) => {
    const h = hang(req.params.id); if (!open(h)) return res.sendStatus(404);
    const x = req.body || {}, back = (app.locals.hangs && app.locals.hangs.href ? app.locals.hangs.href(h) : `/hang/${h.slug}`);
    if (x.website) return res.redirect(303, back); // the honeypot
    const name = String(x.name || '').trim().slice(0, 120), email = String(x.email || '').trim().toLowerCase().slice(0, 160);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || slow(req)) return res.redirect(303, back + '#opening');
    const maker = x.maker === '1' ? 1 : 0, plus = x.plus === '1' ? 1 : 0;
    const had = db.prepare('SELECT id FROM rsvps WHERE hang_id=? AND email=?').get(h.id, email);
    db.prepare(`INSERT INTO rsvps (hang_id, name, email, plus, maker) VALUES (?,?,?,?,?) ON CONFLICT(hang_id, email) DO UPDATE SET name=excluded.name, plus=excluded.plus, maker=MAX(rsvps.maker, excluded.maker)`).run(h.id, name, email, plus, maker);
    if (!had) {
      const where = `${when(h.opens_at)}${h.venue ? `, ${h.venue}` : ''}`;
      mail.send({ to: email, subject: `${h.title}: you are on the list`, text: `${name},\n\nYou are on the list for ${h.title}: ${where}.${plus ? ' Your guest is welcome.' : ''}\n\nThe photographs are on the wall now: ${C.base}${back}\n${maker ? `\nYou make photographs. Watermark shows a small number of makers, by invitation; the application is here: ${C.base}/join?name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}\n` : ''}\nWatermark` });
      const owner = h.buyer_id ? db.prepare('SELECT email FROM buyers WHERE id=?').get(h.buyer_id) : null;
      const line = `${name} (${email})${plus ? ' and a guest' : ''}${maker ? ', makes photographs' : ''}, for ${h.title}.\n\nThe list: ${C.base}/hang/${h.id}/guests`;
      for (const to of new Set([HOUSE, owner && owner.email].filter(Boolean))) mail.send({ to, subject: `The opening: ${name}${maker ? ' (a photographer)' : ''}`, text: line });
    }
    res.redirect(303, `${back}?rsvp=yes&maker=${maker}&n=${encodeURIComponent(name)}&e=${encodeURIComponent(email)}#opening`);
  });

  app.get('/hang/:id/guests', (req, res) => {
    const h = hang(req.params.id); if (!h || !mine(req, h)) return res.sendStatus(404);
    const rows = db.prepare('SELECT * FROM rsvps WHERE hang_id=? ORDER BY id').all(h.id);
    const tot = rows.length + rows.reduce((s, r) => s + r.plus, 0), mk = rows.filter(r => r.maker).length;
    res.send(V.layout({ title: `The list · ${h.title} · Watermark`, path: '/hangs', body: `<section class="narrow op-l"><p class="k">The opening</p><h1>${esc(h.title)}.</h1>
<p class="lede">${h.opens_at ? esc(when(h.opens_at)) : ''}${h.venue ? `, ${esc(h.venue)}` : ''}. ${rows.length} repl${rows.length === 1 ? 'y' : 'ies'}, ${tot} expected, ${mk} who make photographs. <a href="/hang/${h.id}/guests.csv">The list as a spreadsheet</a></p>
${rows.length ? `<table class="tbl"><tr><th>Name</th><th>Email</th><th>Guest</th><th>Makes photographs</th><th>Replied</th></tr>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${r.plus ? '+1' : ''}</td><td>${r.maker ? 'Yes' : ''}</td><td>${esc(String(r.at).slice(0, 10))}</td></tr>`).join('')}</table>` : '<p>No one yet.</p>'}</section>` }));
  });
  app.get('/hang/:id/guests.csv', (req, res) => {
    const h = hang(req.params.id); if (!h || !mine(req, h)) return res.sendStatus(404);
    const q = s => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const rows = db.prepare('SELECT * FROM rsvps WHERE hang_id=? ORDER BY id').all(h.id);
    res.type('text/csv').set('Content-Disposition', `attachment; filename="${h.slug}-guests.csv"`)
      .send(['name,email,guest,makes_photographs,replied', ...rows.map(r => [q(r.name), q(r.email), r.plus, r.maker, q(r.at)].join(','))].join('\n'));
  });
  return { card, open };
}
module.exports = { mountOpening };
