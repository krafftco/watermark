// The guests of the house (26 Oct, the third of the collector's house's three: a guest list for the whole house, not
// only a showing). A private gallery can be opened to the people its owner names: each guest is written to with a
// link that admits them (and is remembered on the device, `wm_gg`); a signed-in collector whose email is on the
// list is admitted too; a guest taken off the list is out at once. The gallery stays off the public rooms.
'use strict';
const crypto = require('crypto');

function mountGuests(app, { db, C, V, mail, buyerOf, ledger }) {
  const { esc } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS gallery_guests (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL, email TEXT NOT NULL, name TEXT, token TEXT UNIQUE NOT NULL, invited_at TEXT NOT NULL DEFAULT (datetime('now')), seen_at TEXT, visits INTEGER NOT NULL DEFAULT 0, UNIQUE (buyer_id, email))`);
  const cookieOf = req => { try { return JSON.parse((req.cookies && req.cookies.wm_gg) || '{}') || {}; } catch (e) { return {}; } };
  const admit = (req, res, b, g) => { const m = cookieOf(req); m[b.id] = g.token; res.cookie('wm_gg', JSON.stringify(m), { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 180 * 864e5 }); };
  const guestsOf = b => db.prepare('SELECT * FROM gallery_guests WHERE buyer_id=? ORDER BY id').all(b.id);
  // Who may see a gallery that is not public: its owner, a guest by link, a signed-in collector on the list.
  function admitted(req, b) {
    if (!b) return null; const me = buyerOf(req); if (me && me.id === b.id) return { who: 'owner' };
    const t = cookieOf(req)[b.id]; const g = t ? db.prepare('SELECT * FROM gallery_guests WHERE buyer_id=? AND token=?').get(b.id, t) : null;
    if (g) return { who: 'guest', guest: g };
    if (me && me.email) { const g2 = db.prepare('SELECT * FROM gallery_guests WHERE buyer_id=? AND lower(email)=lower(?)').get(b.id, me.email); if (g2) return { who: 'guest', guest: g2 }; }
    return null;
  }
  const canSee = (req, b) => !!(b && ((b.public && b.code) || admitted(req, b)));
  // The guest's door: the letter's link admits them and leads to the gallery.
  app.get('/g/:code/guest/:token', (req, res) => {
    const b = db.prepare('SELECT * FROM buyers WHERE code=?').get(String(req.params.code)); if (!b) return res.sendStatus(404);
    const g = db.prepare('SELECT * FROM gallery_guests WHERE buyer_id=? AND token=?').get(b.id, String(req.params.token)); if (!g) return res.sendStatus(410);
    db.prepare("UPDATE gallery_guests SET seen_at=COALESCE(seen_at, datetime('now')), visits=visits+1 WHERE id=?").run(g.id);
    admit(req, res, b, g); res.redirect(`/g/${encodeURIComponent(b.code)}`);
  });
  // The owner's list.
  app.get('/yours/guests', (req, res) => {
    const b = buyerOf(req); if (!b) return res.redirect('/signin?next=/yours/guests');
    const gs = guestsOf(b), ok = req.query.ok || '';
    res.send(V.layout({ title: 'Guests of your house · Watermark', path: '/yours/guests', body: `<section class="cx-intro gst"><p class="k">Your house</p><h1>Guests.</h1>
<p class="lede">${b.public && b.code ? 'Your gallery is open to anyone with its address. A guest list is for the day you close the doors: the people named here come in regardless.' : 'Your gallery is private. The people named here are written to with a link that lets them in, and only them; take a name off and the link stops working. Nothing of your gallery is shown in the public rooms.'}${b.code ? '' : ' Give your gallery an address first, under <a href="/yours?tab=more#settings">Settings</a>.'}</p>
${ok === 'sent' ? `<p class="ok">Written to. ${req.query.n || ''} on the list.</p>` : ok === 'none' ? '<p class="err">No address I could read.</p>' : ''}
<form method="post" action="/yours/guests" class="form gst-f"><label><span>Who to invite: a name and an email a line, or just the emails</span><textarea name="list" rows="4" placeholder="Annie Taylor, annie@example.com&#10;harlan@example.com" required></textarea></label><label><span>A word with the letter (optional)</span><input name="note" maxlength="300" placeholder="Come and see what I have been collecting."></label><button class="buy-btn">Write to them</button></form>
${gs.length ? `<table class="tbl gst-t"><thead><tr><th>Guest</th><th>Invited</th><th>Came</th><th></th></tr></thead><tbody>${gs.map(g => `<tr><td><b>${esc(g.name || g.email)}</b>${g.name ? `<br><small>${esc(g.email)}</small>` : ''}</td><td>${esc(String(g.invited_at).slice(0, 10))}</td><td>${g.seen_at ? `${g.visits} time${g.visits === 1 ? '' : 's'}` : 'Not yet'}</td><td><form method="post" action="/yours/guests/${g.id}/remove"><button class="link">Take off the list</button></form></td></tr>`).join('')}</tbody></table>` : '<p class="yc-shelf">No guests yet.</p>'}
<p class="hg-share"><a href="/yours">Your house</a></p></section>` }));
  });
  app.post('/yours/guests', (req, res) => {
    const b = buyerOf(req); if (!b) return res.sendStatus(401);
    if (!b.code) { db.prepare('UPDATE buyers SET code=? WHERE id=?').run(crypto.randomBytes(8).toString('base64url').slice(0, 10), b.id); b.code = db.prepare('SELECT code FROM buyers WHERE id=?').get(b.id).code; }
    const lines = String((req.body || {}).list || '').split(/\r?\n|;/).map(x => x.trim()).filter(Boolean).slice(0, 100);
    const note = String((req.body || {}).note || '').trim().slice(0, 300);
    let n = 0;
    for (const line of lines) {
      const m = line.match(/([^\s,<>]+@[^\s,<>]+\.[^\s,<>]+)/); if (!m) continue;
      const email = m[1].toLowerCase(), name = line.replace(m[0], '').replace(/[<>,]/g, ' ').trim() || null;
      const token = crypto.randomBytes(12).toString('base64url');
      db.prepare('INSERT INTO gallery_guests (buyer_id, email, name, token) VALUES (?,?,?,?) ON CONFLICT(buyer_id, email) DO UPDATE SET name=COALESCE(excluded.name, gallery_guests.name)').run(b.id, email, name, token);
      const g = db.prepare('SELECT * FROM gallery_guests WHERE buyer_id=? AND email=?').get(b.id, email); n++;
      const link = `${C.base}/g/${encodeURIComponent(b.code)}/guest/${g.token}`, who = b.name || 'A collector';
      try { mail.send({ to: email, subject: `${who} invites you to see their collection`, text: `${name ? name.split(' ')[0] + ',\n\n' : ''}${who} has opened their gallery on Watermark to you.${note ? `\n\n"${note}"` : ''}\n\nCome in: ${link}\n\nThe link is yours alone; it lets you in whenever you like. Watermark · Where great work is kept.`, html: `<p>${name ? esc(name.split(' ')[0]) + ',</p><p>' : ''}<b>${esc(who)}</b> has opened their gallery on Watermark to you.${note ? `</p><blockquote>${esc(note)}</blockquote><p>` : ''}</p><p><a href="${link}">Come in</a></p><p style="color:#777">The link is yours alone; it lets you in whenever you like.<br>Watermark · Where great work is kept.</p>` }); } catch (e) { /* mail off */ }
    }
    if (n) { try { ledger.append(db, 'gallery.invited', `b-${b.id}`, { n }); } catch (e) { /* */ } }
    res.redirect(`/yours/guests?ok=${n ? 'sent' : 'none'}&n=${guestsOf(b).length}`);
  });
  app.post('/yours/guests/:id/remove', (req, res) => {
    const b = buyerOf(req); if (!b) return res.sendStatus(401);
    db.prepare('DELETE FROM gallery_guests WHERE id=? AND buyer_id=?').run(+req.params.id, b.id); res.redirect('/yours/guests');
  });
  app.locals.guests = { canSee, admitted, guestsOf };
  return app.locals.guests;
}
module.exports = { mountGuests };
