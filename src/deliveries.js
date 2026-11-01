const ROLE = require('./role');
// Deliveries (Will, 21 Oct: "something like ShootProof where I can deliver photos to a client safely through a watermark
// and a download link; if I send them the link, they can download it without payment"). The maker picks the work (held
// or kept back), names the client, and sends one link. Each photograph is granted to the client as a license of use
// 'delivery' (perpetual, no money; the maker's own terms with the client stand outside the house), so every file leaves
// the house the way every file does: the maker's name, the copyright and the licence number written into it (XMP, the
// mark within the picture, Content Credentials when signing is on), each download counted and told on the register,
// and anyone can check a file at /verify. The link /deliver/<token>: the photographs on a dark wall, one download each
// and all of them as one zip; it closes on the day the maker set (the licences end with it) or when the maker closes it.
// Nothing of the client is public: `delivery.sent` is hidden on the register; the licences' entries say 'delivered'.
// Next: a price (the link becomes a Checkout before the files, through the basket's set path); a PIN; proofing (the
// client picks from a larger set before the maker finishes); the client's own gallery holding what was delivered.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const DAYS = Number(process.env.DELIVERY_DAYS || 30);
const SIZES = { original: 'The 2,400-pixel copy, and the full file too', large: 'The 2,400-pixel copy only' }; // (21 Oct) the copy is what friends download: a couple of megabytes for a phone and for sharing; the full file is a second door
function mountDeliveries(app, { db, C, V, I, mail, ledger, grant, nextRef, mk, q, makerOf, isStudio, originalPath, images, cache, marked, fileName, buyerOf, setBuyer }) {
  const { esc, tidy, date } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, maker_id INTEGER NOT NULL, title TEXT NOT NULL, client_name TEXT NOT NULL, client_email TEXT, note TEXT,
    size TEXT NOT NULL DEFAULT 'original', expires_at TEXT, status TEXT NOT NULL DEFAULT 'open', opens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT);
  CREATE TABLE IF NOT EXISTS delivery_works (delivery_id INTEGER NOT NULL, work_id INTEGER NOT NULL, pos INTEGER NOT NULL DEFAULT 0, ref TEXT NOT NULL, PRIMARY KEY (delivery_id, work_id));`);
  const byToken = db.prepare('SELECT * FROM deliveries WHERE token=?');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('deliveries') WHERE name='share_token'").get()) db.exec('ALTER TABLE deliveries ADD COLUMN share_token TEXT');
  const byShare = db.prepare('SELECT * FROM deliveries WHERE share_token=?');
  // The address to pass on: made once per album, on first need; it shows, it never hands over a file.
  const shareOf = d => { if (d.share_token) return d.share_token; const t = crypto.randomBytes(9).toString('base64url'); db.prepare('UPDATE deliveries SET share_token=? WHERE id=? AND share_token IS NULL').run(t, d.id); d.share_token = byToken.get(d.token).share_token; return d.share_token; };
  const shareBtn = (d, m, ws) => { const u = `${C.base}/a/${shareOf(d)}`; return `<button type="button" class="dv-send" data-send data-send-title="${esc(d.title)}" data-send-text="${esc(`${ws.length === 1 ? 'A photograph' : ws.length + ' photographs'} by ${m.name}`)}" data-send-url="${esc(u)}">${I.share || ''}<span>Send to the group</span><i>They see every picture and sign the book; the downloads stay with you</i></button>`; };
  // The book the group signs: a line and a name, newest last; the maker may take a line down.
  const bookOf = (d, req, view) => {
    const lines = db.prepare('SELECT * FROM delivery_notes WHERE delivery_id=? AND removed_at IS NULL ORDER BY id').all(d.id);
    const me = makerOf(req); const own = (me && me.id === d.maker_id) || isStudio(req);
    const said = { ok: 'Signed. Thank you.', no: 'A line and a name, please, and no links.', wait: 'A moment; the book is resting.' }[req.query.book] || '';
    const act = `/deliver/${esc(view ? '_' : d.token)}/note`.replace('/deliver/_/', `/a/${esc(shareOf(d))}/`);
    return `<section class="dv-book" id="book"><p class="k">The book</p><h2>${lines.length ? 'Signed by the group.' : 'Be the first to sign.'}</h2>${said ? `<p class="dv-said">${esc(said)}</p>` : ''}
<ol class="dv-lines">${lines.map(l => `<li><p>${esc(l.body)}</p><span>— ${esc(l.name)}</span>${own ? `<form method="post" action="/deliver/${esc(d.token)}/note/${l.id}/remove"><button class="link">Take down</button></form>` : ''}</li>`).join('')}</ol>
<form method="post" action="${act}" class="dv-bookf"><input name="body" required maxlength="400" placeholder="A line about the day, the pictures, the people" autocomplete="off"><input name="name" required maxlength="60" placeholder="Your name" autocomplete="given-name"><button class="buy-btn">Sign</button></form></section>`;
  };
  db.exec(`CREATE TABLE IF NOT EXISTS delivery_notes (id INTEGER PRIMARY KEY, delivery_id INTEGER NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, ip TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), removed_at TEXT)`);
  const worksOf = d => db.prepare('SELECT w.*, dw.ref, dw.pos FROM delivery_works dw JOIN works w ON w.id=dw.work_id WHERE dw.delivery_id=? ORDER BY dw.pos, w.id').all(d.id);
  // For the thank-you card: the delivery holding this work, if it is live.
  const holds = (token, slug) => { const d = byToken.get(token) || byShare.get(token); if (!d || !live(d)) return null; return worksOf(d).some(w => w.slug === slug) ? d : null; };
  const licOf = ref => db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref);
  // The album as a set to wander (Will, 21 Oct): its photographs, in its order, while the link is live.
  const set = (token, view = false) => { const d = (view ? byShare : byToken).get(String(token || '')); if (!d || !live(d)) return null; return { label: d.title, href: view ? `/a/${d.share_token}` : `/deliver/${d.token}`, via: view ? d.share_token : d.token, view, files: view ? null : d.token, works: worksOf(d).map(w => ({ id: w.id, slug: w.slug, title: w.title, width: w.width, height: w.height, maker_id: w.maker_id })) }; };
  const live = d => d.status === 'open' && !(d.expires_at && new Date(d.expires_at) < new Date());
  const url = d => `${C.base}/deliver/${d.token}`;
  const dlCount = d => db.prepare('SELECT COUNT(*) n FROM downloads dl JOIN licenses l ON l.id=dl.license_id JOIN delivery_works dw ON dw.ref=l.ref WHERE dw.delivery_id=?').get(d.id).n;
  // Closing a delivery ends its licences, so the links stop with it.
  function close(d) {
    db.prepare("UPDATE deliveries SET status='closed', closed_at=datetime('now') WHERE id=?").run(d.id);
    const ended = new Date(Date.now() - 1000).toISOString();
    for (const w of worksOf(d)) db.prepare("UPDATE licenses SET ends_at=?, updated_at=datetime('now') WHERE ref=? AND status='active'").run(ended, w.ref);
  }
  // Expired deliveries close themselves, hourly.
  function sweep() { for (const d of db.prepare("SELECT * FROM deliveries WHERE status='open' AND expires_at IS NOT NULL AND expires_at < datetime('now')").all()) close(d); }
  if (ROLE.chores) { setTimeout(sweep, 60e3).unref(); setInterval(sweep, 3600e3).unref(); }
  // The copies of every live album made ahead (90 s after start, one at a time), so a client's Download all never waits on the house.
  const warmAlbums = async () => { for (const d of db.prepare("SELECT * FROM deliveries WHERE status='open'").all()) { if (!live(d)) continue; for (const w of worksOf(d)) { try { await images.derivativeOf(() => originalPath(w), cache, w.slug, 'large', 'jpg'); } catch (e) { /* on the first download instead */ } } } };
  if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') app.locals.governor.boot('warm albums', () => warmAlbums());
  const first = s => String(s || '').trim().split(/\s+/)[0] || '';
  // By text, from the maker's own phone (Will, 1 Nov: "instead of just their email, an option to send it to their phone
  // number"): the house sends no texts of its own; a tap opens the maker's Messages with the link written in, so it comes
  // from a number the friend knows. The phone is kept on the delivery for the maker only, never on a licence or a page.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('deliveries') WHERE name='client_phone'").get()) db.exec('ALTER TABLE deliveries ADD COLUMN client_phone TEXT');
  const phoneOf = x => { const t = String(x || '').trim(); if (!t) return ''; const plus = t.startsWith('+'); const d = t.replace(/\D/g, ''); if (d.length < 7 || d.length > 15) return null; return plus ? '+' + d : d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : d; };
  const textOf = (d, m) => `${first(d.client_name) ? first(d.client_name) + ', ' : ''}${d.title}: photographs by ${m.name}. ${url(d)}`;
  const smsHref = (d, m) => `sms:${d.client_phone || ''}?&body=${encodeURIComponent(textOf(d, m))}`;
  const textBtn = (d, m, cls = 'buy-btn') => `<a class="${cls} dv-text" href="${esc(smsHref(d, m))}">Text it${d.client_phone ? ` to ${esc(d.client_phone)}` : ''}</a>`;

  // The maker's desk.
  app.get('/account/deliveries', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?to=' + encodeURIComponent('/account/deliveries'));
    const rows = db.prepare('SELECT * FROM deliveries WHERE maker_id=? ORDER BY id DESC LIMIT 100').all(m.id);
    // Sorting and choosing (Will, 21 Oct): the last upload first by default, or by place, by title, by stars; a word filters; Tick all shown.
    const sort = { newest: 'w.id DESC', place: 'w.place IS NULL, w.place, w.id DESC', title: 'lower(w.title)', stars: 'w.stars DESC, w.id DESC' }[String(req.query.sort || 'newest')] || 'w.id DESC';
    const works = db.prepare(`SELECT w.id, w.slug, w.title, w.place, w.status, w.stars, w.created_at FROM works w WHERE w.maker_id=? AND w.status IN ('held','hidden') ORDER BY ${sort}`).all(m.id);
    const sortNow = String(req.query.sort || 'newest');
    const ok = req.query.ok ? String(req.query.ok) : '';
    const sent = req.query.sent ? byToken.get(String(req.query.sent)) : null;
    res.send(V.layout({ title: 'Deliveries · Watermark', path: '/account/deliveries', studio: true, body: `<section class="studio-wrap dv-desk"><p class="k">Your studio</p><h1>Deliveries.</h1>
<p class="lede">Send a client their photographs: one link, no payment, every file carrying your name and its licence inside it, every download counted. The link closes on the day you set.${ok ? ` <b>${esc(ok)}</b>` : ''}</p>
${sent && sent.maker_id === m.id ? `<div class="dv-sent"><p class="k">Sent</p><h2>${esc(sent.title)}</h2><p>For ${esc(sent.client_name)}${sent.client_email ? `, written to ${esc(sent.client_email)}` : ''}${sent.client_phone ? `${sent.client_email ? ' and' : ','} ready to text to ${esc(sent.client_phone)}` : ''}. The link:</p><p class="dv-link"><input readonly value="${esc(url(sent))}" onclick="this.select()"> <button type="button" class="link" data-copy="${esc(url(sent))}">Copy</button></p><p class="dv-row">${textBtn(sent, m)} <span class="note">Opens Messages on this phone with the link written in, so it comes from you.</span></p></div>` : ''}
<form method="post" action="/account/deliveries" class="dv-f"><h2>A new delivery</h2>
<div class="dv-grid"><label><span>What it is</span><input name="title" required maxlength="120" placeholder="The wedding, the proofs, the June shoot"></label><label><span>For whom</span><input name="client" required maxlength="120" placeholder="Their name"></label><label><span>Their email (optional: the house writes to them)</span><input type="email" name="email" maxlength="160"></label><label><span>Their phone (optional: you text it from your phone)</span><input type="tel" name="phone" inputmode="tel" autocomplete="tel" maxlength="24" placeholder="+1 212 555 0100"></label><label><span>Closes in</span><select name="days"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="365">A year</option><option value="0">Never</option></select></label><label><span>The files</span><select name="size">${Object.entries(SIZES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
<label class="dv-notef"><span>A note to them (optional)</span><textarea name="note" rows="2" maxlength="600"></textarea></label>
<p class="k dv-sortrow">The photographs <small>(tick; held and kept-back alike)</small> · <input type="search" class="dv-find" placeholder="Filter by word" data-dv-find> · <span class="dv-sort">${[['newest', 'Last upload first'], ['place', 'By place'], ['title', 'By title'], ['stars', 'By stars']].map(([k, n]) => `<a href="/account/deliveries?sort=${k}#pick"${sortNow === k ? ' aria-current="page"' : ''}>${n}</a>`).join(' · ')}</span> · <button type="button" class="link" data-dv-all>Tick all shown</button> <button type="button" class="link" data-dv-none>None</button> <b data-dv-count></b></p>
<div class="dv-pick" id="pick" data-dv-pick>${works.map((w, i, arr) => `${sortNow === 'place' && (i === 0 || (arr[i - 1].place || '') !== (w.place || '')) ? `<p class="dv-ph">${esc(w.place || 'No place')}</p>` : ''}<label class="dv-w" data-t="${esc((w.title + ' ' + (w.place || '')).toLowerCase())}"><input type="checkbox" name="works" value="${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span>${esc(tidy(w.title))}${w.status === 'hidden' ? ' <i>kept back</i>' : ''}${w.stars ? ` <i>${'★'.repeat(w.stars)}</i>` : ''}</span></label>`).join('')}</div>
<p class="dv-row"><button class="buy-btn">Make the link</button> <span class="note">Each photograph is granted to them as a licence of use <i>Delivered</i>, free, with your name and the number written into the file.</span></p></form>
${rows.length ? `<h2>Sent</h2><table class="tbl dv-t"><tr><th>What</th><th>For</th><th>Photographs</th><th>Opened</th><th>Downloads</th><th>State</th><th></th></tr>${rows.map(d => `<tr><td><a href="/deliver/${esc(d.token)}">${esc(d.title)}</a></td><td>${esc(d.client_name)}</td><td>${db.prepare('SELECT COUNT(*) n FROM delivery_works WHERE delivery_id=?').get(d.id).n}</td><td>${d.opens}</td><td>${dlCount(d)}</td><td>${live(d) ? `Open${d.expires_at ? ` until ${esc(date(d.expires_at))}` : ''}` : 'Closed'}</td><td>${live(d) ? `<button type="button" class="link" data-send data-send-title="${esc(d.title)}" data-send-text="${esc(d.title)}, photographs by ${esc(m.name)}" data-send-url="${esc(url(d))}" title="The album with its downloads, for the people it was made for">Send</button> · ${textBtn(d, m, 'link')} · <button type="button" class="link" data-send data-send-title="${esc(d.title)}" data-send-url="${esc(C.base + '/a/' + shareOf(d))}" title="To see, sign and pass on; no downloads">Share to see</button> · ${db.prepare('SELECT COUNT(*) n FROM delivery_notes WHERE delivery_id=? AND removed_at IS NULL').get(d.id).n} in the book · <form method="post" action="/account/deliveries/${d.id}/close"><button class="link">Close</button></form>` : ''}</td></tr>`).join('')}</table>` : ''}
<script>(function(){var f=document.querySelector('[data-dv-find]'),p=document.querySelector('[data-dv-pick]'),c=document.querySelector('[data-dv-count]');function count(){if(!c||!p)return;var n=p.querySelectorAll('input:checked').length;c.textContent=n?n+' chosen':'';}if(f&&p)f.addEventListener('input',function(){var v=f.value.trim().toLowerCase();[].forEach.call(p.querySelectorAll('.dv-w'),function(l){l.hidden=!!v&&l.getAttribute('data-t').indexOf(v)<0});});if(p){p.addEventListener('change',count);var a=document.querySelector('[data-dv-all]'),no=document.querySelector('[data-dv-none]');if(a)a.addEventListener('click',function(){[].forEach.call(p.querySelectorAll('.dv-w'),function(l){if(!l.hidden)l.querySelector('input').checked=true});count();});if(no)no.addEventListener('click',function(){[].forEach.call(p.querySelectorAll('input'),function(i){i.checked=false});count();});}document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');if(!b)return;navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){b.textContent='Copied'});});})();</script></section>` }));
  });
  app.post('/account/deliveries', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 120), client = String(b.client || '').trim().slice(0, 120), email = String(b.email || '').trim().toLowerCase().slice(0, 160);
    const slugs = [].concat(b.works || []).map(String).slice(0, 300);
    if (!title || !client || !slugs.length) return res.redirect('/account/deliveries?ok=' + encodeURIComponent('A title, a name and at least one photograph.'));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect('/account/deliveries?ok=' + encodeURIComponent('That email will not do.'));
    const phone = phoneOf(b.phone); if (phone === null) return res.redirect('/account/deliveries?ok=' + encodeURIComponent('That phone number will not do.'));
    const u = q.use.get(m.id, 'delivery'); if (!u) return res.redirect('/account/deliveries?ok=' + encodeURIComponent('The delivery use is not set for this studio yet.'));
    const days = Math.max(0, Math.min(3650, +b.days || 0)); const size = SIZES[b.size] ? b.size : 'original';
    const token = crypto.randomBytes(18).toString('base64url');
    const id = Number(db.prepare("INSERT INTO deliveries (token, maker_id, title, client_name, client_email, client_phone, note, size, expires_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(token, m.id, title, client, email || null, phone || null, String(b.note || '').trim().slice(0, 600) || null, size, days ? new Date(Date.now() + days * 864e5).toISOString() : null).lastInsertRowid);
    let n = 0;
    for (const slug of slugs) {
      const w = db.prepare("SELECT * FROM works WHERE slug=? AND maker_id=? AND status IN ('held','hidden')").get(slug, m.id); if (!w) continue;
      const ref = nextRef();
      // The licence: the client's name, no email on the licence itself (one letter goes out below, not one a photograph).
      db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,intended_use,price_cents,status) VALUES (?,?,?,?,?,?,NULL,'requested')").run(ref, w.id, u.id, client, '', `Delivered: ${title}`.slice(0, 400));
      grant(ref, { paid: false });
      if (days) db.prepare("UPDATE licenses SET ends_at=? WHERE ref=?").run(new Date(Date.now() + days * 864e5).toISOString(), ref);
      db.prepare('INSERT INTO delivery_works (delivery_id, work_id, pos, ref) VALUES (?,?,?,?)').run(id, w.id, n++, ref);
    }
    if (!n) { db.prepare('DELETE FROM deliveries WHERE id=?').run(id); return res.redirect('/account/deliveries?ok=' + encodeURIComponent('None of those photographs are yours to send.')); }
    const d = byToken.get(token);
    setTimeout(async () => { for (const w of worksOf(d)) { try { await images.derivativeOf(() => originalPath(w), cache, w.slug, 'large', 'jpg'); } catch (e) { /* made on the first download instead */ } } }, 50).unref(); // the copies made now, in the background
    try { ledger.append(db, 'delivery.sent', m.handle, { n, size, days }); } catch (e) { /* */ }
    if (email) mail.send({ to: email, subject: `${m.name} has sent you ${n === 1 ? 'a photograph' : `${n} photographs`}: ${title}`, text: `${first(client)},\n\n${m.name} has sent you ${n === 1 ? 'a photograph' : `${n} photographs`}, "${title}".\n\n${url(d)}\n\n${d.note ? d.note + '\n\n' : ''}Each file carries ${m.name}'s name and its licence number inside it; anyone can check a file at ${C.base}/verify.${d.expires_at ? ` The link closes on ${date(d.expires_at)}.` : ''}\n\nWatermark, for ${m.name}` });
    res.redirect(`/account/deliveries?sent=${token}`);
  });
  app.post('/account/deliveries/:id/close', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const d = db.prepare('SELECT * FROM deliveries WHERE id=? AND maker_id=?').get(+req.params.id, m.id); if (!d) return res.sendStatus(404);
    close(d); res.redirect('/account/deliveries?ok=' + encodeURIComponent(`${d.title} is closed.`));
  });

  // The client's door.
  // The album in a chat (31 Oct, Will: "how are people going to deliver, to a friend group and chats; this needs to be
  // social"): the link unfurls as a card of the album's own pictures, the title and who made them; the album has a
  // book the group signs (a line and a name, no account); a share sends it on to the group.
  app.get(['/deliver/:token/card.jpg', '/a/:share/card.jpg'], async (req, res) => {
    const d = req.params.share ? byShare.get(String(req.params.share)) : byToken.get(String(req.params.token)); if (!d || !live(d)) return res.sendStatus(404);
    const out = path.join(cache, `album-${d.token.slice(0, 16)}-${d.id}-card.jpg`);
    try {
      if (!fs.existsSync(out)) {
        const sharp = require('sharp'); const ws = worksOf(d).slice(0, 3); const W = 1200, H = 630, n = Math.max(1, ws.length), cw = Math.floor(W / n);
        const tiles = []; for (let i = 0; i < ws.length; i++) { const f = await images.derivativeOf(() => originalPath(ws[i]), cache, ws[i].slug, 'screen', 'jpg'); tiles.push({ input: await sharp(f).resize(cw - (i < n - 1 ? 4 : 0), H, { fit: 'cover', position: 'attention' }).toBuffer(), left: i * cw, top: 0 }); }
        await sharp({ create: { width: W, height: H, channels: 3, background: '#0b0a09' } }).composite(tiles).jpeg({ quality: 86 }).toFile(out);
      }
      res.set('Cache-Control', 'public, max-age=3600').type('image/jpeg').sendFile(out);
    } catch (e) { console.error('[album card]', e.message); res.sendStatus(404); }
  });
  app.post(['/deliver/:token/note', '/a/:share/note'], (req, res) => {
    const d = req.params.share ? byShare.get(String(req.params.share)) : byToken.get(String(req.params.token)); if (!d || !live(d)) return res.sendStatus(404);
    const name = String(req.body.name || '').trim().slice(0, 60), body = String(req.body.body || '').trim().slice(0, 400);
    const back = req.params.share ? `/a/${d.share_token}#book` : `/deliver/${d.token}#book`;
    if (!name || body.length < 2 || /https?:\/\/|www\./i.test(body)) return res.redirect(303, back.replace('#', '?book=no#'));
    const recent = db.prepare("SELECT COUNT(*) n FROM delivery_notes WHERE delivery_id=? AND ip=? AND at > datetime('now','-10 minutes')").get(d.id, req.ip).n;
    if (recent >= 4) return res.redirect(303, back.replace('#', '?book=wait#'));
    db.prepare('INSERT INTO delivery_notes (delivery_id, name, body, ip) VALUES (?,?,?,?)').run(d.id, name, body, req.ip);
    if (app.locals.notify) app.locals.notify.tell({ maker_id: d.maker_id, kind: 'note', href: `/deliver/${d.token}#book`, title: `${name} signed ${d.title}`, body: body.slice(0, 140) }).catch(() => {});
    res.redirect(303, back.replace('#', '?book=ok#'));
  });
  app.post('/deliver/:token/note/:id/remove', (req, res) => {
    const d = byToken.get(String(req.params.token)); if (!d) return res.sendStatus(404);
    const me = makerOf(req); if (!((me && me.id === d.maker_id) || isStudio(req))) return res.sendStatus(403);
    db.prepare("UPDATE delivery_notes SET removed_at=datetime('now') WHERE id=? AND delivery_id=?").run(+req.params.id, d.id); res.redirect(303, `/deliver/${d.token}#book`);
  });
  // Instax from the album: the exact pixels the printer lays down, for each photograph the album holds.
  app.get('/deliver/:token/:slug/instax', async (req, res) => {
    const d = byToken.get(String(req.params.token)); if (!d || !live(d)) return res.sendStatus(404);
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    try {
      const K = require('./keep'); const out = await K.instaxFile(await originalPath(w), { film: String(req.query.film || 'mini'), mode: req.query.mode === 'fit' ? 'fit' : 'fill', look: String(req.query.look || 'film') });
      const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id); const name = `${tidy(w.title)}, ${m.name} (${out.film.name}).jpg`.replace(/[\/:*?"<>|]/g, '');
      res.set({ 'Content-Type': 'image/jpeg', 'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'private, no-store' }).send(out.buf);
    } catch (e) { console.error('[album instax]', e.message); res.sendStatus(500); }
  });
  function albumPage(d, req, res, view) {
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id);
    res.set('Cache-Control', 'private, no-store');
    if (!live(d)) return res.status(410).send(V.layout({ title: `${d.title} · Watermark`, bare: true, body: `<main class="dv"><section class="dv-wall"><p class="k">From ${esc(m.name)}</p><h1>${esc(d.title)}</h1><p class="dv-lede">This delivery has closed. Write to ${esc(m.name)} for another.</p></section></main>` }));
    db.prepare('UPDATE deliveries SET opens=opens+1 WHERE id=?').run(d.id);
    const all = worksOf(d); const me = buyerOf(req);
    const SI = app.locals.sitters; const ids = all.map(w => w.id); const withs = SI ? SI.inWorks(ids) : {}; const mine = SI ? SI.mineIn(me, ids) : new Set();
    const onlyMine = req.query.mine === '1' && mine.size; const ws = onlyMine ? all.filter(w => mine.has(w.id)) : all;
    const sh = shareOf(d); const base = view ? `/a/${esc(sh)}` : `/deliver/${esc(d.token)}`; const wander = view ? `/wander?in=album:${esc(sh)}` : `/wander?in=delivery:${esc(d.token)}`, logo = `<a class="dv-logo" href="/" aria-label="Watermark"><img src="/static/watermark-logo.svg" alt="Watermark" width="150" height="40"></a>`;
    res.send(V.layout({ title: `${d.title} · ${m.name}`, bare: true, desc: `${ws.length === 1 ? 'A photograph' : ws.length + ' photographs'} by ${m.name}. ${view ? 'Shared from' : 'Delivered with'} Watermark.`, path: `/a/${sh}`, image: `/a/${sh}/card.jpg`, body: `<main class="dv"><section class="dv-wall">
<header class="dv-h">${logo}<p class="k">From ${esc(m.name)}${view ? '' : ` · for ${esc(d.client_name)}`}</p><h1>${esc(d.title)}</h1>
<p class="dv-gift">${ws.length === 1 ? 'A photograph' : `${ws.length} photographs`} by ${esc(m.name)}, ${view ? 'shared with you. Look as long as you like; each one carries' : 'made for you and yours to keep: download them, print them, share them. Each one carries'} ${esc(first(m.name))}’s name inside it, the way a print carries a signature.</p>
${d.note ? `<blockquote class="dv-note"><p>${esc(d.note)}</p><footer>— ${esc(first(m.name))}</footer></blockquote>` : ''}
<p class="dv-acts"><a class="dv-wander" href="${wander}">${V.WAVE_MARK || ''}<span>Wander through them</span><i>One at a time, edge to edge</i></a>${view ? '' : `<a class="dv-all" href="/deliver/${esc(d.token)}/all.zip">${I.in || ''}<span>Download all ${ws.length === 1 ? '' : `(${ws.length})`}</span></a><span class="dv-sz">2,400 pixels, a few megabytes each: right for a phone and for sharing.${allowsFull(d) ? ` <a href="/deliver/${esc(d.token)}/all.zip?full=1">The full files</a> (${esc(fullSize(ws))}) for printing.` : ''}${d.expires_at ? ` The link closes ${esc(date(d.expires_at))}.` : ''}</span>`}${shareBtn(d, m, ws)}</p>
<p class="dv-you">${mine.size ? `You are in ${mine.size} from this ${all.length > 1 ? 'roll' : 'picture'}. ${onlyMine ? `<a href="${base}">Show them all</a>` : `<a href="${base}?mine=1">Show only yours</a>`}` : 'Find yourself: tap <b>That&rsquo;s me</b> under any photograph you are in, or name a friend who is. They come to your own Pictures of you, credited.'}</p></header>
<div class="dv-grid">${ws.map(w => { const l = licOf(w.ref); return `<figure class="dv-w"><a href="${wander}&at=${esc(w.slug)}" class="dv-im"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="lazy" decoding="async"${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}></a><figcaption><b>${esc(tidy(w.title))}</b>${w.place ? `<i>${esc(w.place)}</i>` : ''}${view ? '' : `<a href="/deliver/${esc(d.token)}/${esc(w.slug)}/file" download>Download</a><button type="button" class="dv-keep" data-dv-keep="${esc(w.slug)}">Keep it</button>${allowsFull(d) ? `<a class="dv-full" href="/deliver/${esc(d.token)}/${esc(w.slug)}/file?full=1" download title="The full file, for printing">Full size</a>` : ''}`}${withs[w.id] ? `<span class="dv-with">With ${withs[w.id].map(esc).join(', ')}</span>` : ''}<span class="dv-me">${mine.has(w.id) ? '<em>You are in it</em>' : `<button type="button" class="link" data-dv-me="${esc(w.slug)}">That&rsquo;s me</button>`}<button type="button" class="link" data-dv-friend="${esc(w.slug)}">That&rsquo;s a friend</button><button type="button" class="link" data-dv-story="${base}/${esc(w.slug)}/story.jpg" data-dv-story-name="${esc(tidy(w.title))}">Share to your story</button></span></figcaption></figure>`; }).join('')}</div>
<form class="dv-tag" data-dv-tag data-base="${base}" hidden><p class="dv-tag-t" data-dv-tag-t></p>${me && me.email ? `<p class="dv-tag-me" data-dv-asme>As ${esc(me.email)}.</p>` : ''}<label data-dv-who><span>Your name</span><input name="name" maxlength="120" autocomplete="name"></label><label data-dv-who><span>Your email</span><input name="email" type="email" maxlength="160" autocomplete="email" inputmode="email"></label><label data-dv-fr><span>Their name</span><input name="friend_name" maxlength="120"></label><label data-dv-fr><span>Their email</span><input name="friend_email" type="email" maxlength="160" inputmode="email"></label><p class="dv-tag-row"><button class="buy-btn">Send</button><button type="button" class="link" data-dv-tag-x>Not now</button></p><p class="note">Adults only. A photograph is linked to a person only by their own yes; the house never recognises faces.</p></form>
${bookOf(d, req, view)}${ws.length ? `<section class="ty dv-ty" id="thanks"><div class="ty-card"><p class="k">A thank-you card</p>
${req.query.thanks === 'given' ? `<p class="ty-done">Sent. ${esc(first(m.name))} will see it.</p>` : req.query.thanks ? '<p class="ty-done">Not just now; the till is closed.</p>' : ''}
<form method="post" action="/w/${esc(ws[0].slug)}/thanks" class="ty-f"><input type="hidden" name="via" value="${esc(view ? sh : d.token)}"><p class="ty-say">${view ? 'If these moved you' : 'These are a gift. If you would like'} to thank ${esc(first(m.name))}, a card goes straight to ${esc(first(m.name))}; the house keeps nothing of it.</p>
<div class="ty-amts">${[99, 499, 999].map((c, i) => `<label><input type="radio" name="amount" value="${c}" ${i === 1 ? 'checked' : ''}><span>${c < 100 ? `${c}¢` : `$${(c / 100).toFixed(2)}`}</span></label>`).join('')}<label class="ty-own"><input type="radio" name="amount" value="own"><span>$<input name="own" inputmode="decimal" placeholder="your own" aria-label="Your own amount"></span></label></div>
<input name="word" class="ty-word" placeholder="A word, if you like" maxlength="280" autocomplete="off"><button class="buy-btn">Send the card</button></form></div></section>` : ''}
${view ? '' : `<form method="post" class="dv-ks" data-dv-ks hidden><input type="hidden" name="slug"><p class="dv-ks-t"><b>Keep <span data-dv-ks-title></span>.</b> It hangs in a gallery of your own, yours for good, with its papers; and from there you can have it printed, framed and sent, or save it to your phone.</p>${me ? `<p class="dv-ks-me">As ${esc(me.email)}.</p>` : `<label><span>Your name</span><input name="name" maxlength="120" autocomplete="name"></label><label><span>Email</span><input name="email" type="email" required maxlength="160" autocomplete="email" inputmode="email"></label>`}<p class="dv-ks-row"><button class="buy-btn">Keep it</button><button type="button" class="link" data-dv-ks-x>Not now</button></p></form>`}
<script>(function(){var f=document.querySelector('[data-dv-tag]');if(!f)return;var signed=!!f.querySelector('[data-dv-asme]'),slug='',fr=false;function show(sel,on){[].forEach.call(f.querySelectorAll(sel),function(x){x.hidden=!on;var i=x.querySelector('input');if(i)i.required=on;});}
document.addEventListener('click',function(e){var me=e.target.closest('[data-dv-me]'),fd=e.target.closest('[data-dv-friend]'),st=e.target.closest('[data-dv-story]');
if(st){e.preventDefault();var u=st.getAttribute('data-dv-story'),n=st.getAttribute('data-dv-story-name')||'photograph';fetch(u).then(function(r){return r.blob();}).then(function(b){var file=new File([b],n.replace(/[^a-z0-9 ]/gi,'')+' (story).jpg',{type:'image/jpeg'});if(navigator.canShare&&navigator.canShare({files:[file]}))return navigator.share({files:[file]}).catch(function(){});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=file.name;document.body.appendChild(a);a.click();a.remove();});return;}
if(e.target.closest('[data-dv-tag-x]')){f.hidden=true;return;}
if(!me&&!fd)return;slug=(me||fd).getAttribute(me?'data-dv-me':'data-dv-friend');fr=!!fd;
if(me&&signed){post();return;}
show('[data-dv-who]',!signed&&!fr);show('[data-dv-fr]',fr);f.querySelector('[data-dv-tag-t]').textContent=fr?'Who is it? They are asked by letter, and nothing is linked until they say yes.':'You, in this photograph. A letter asks you to confirm; then it is in your Pictures of you.';f.hidden=false;(me||fd).closest('figure').after(f);var i=f.querySelector('input:not([hidden])');setTimeout(function(){var x=f.querySelector('label:not([hidden]) input');if(x)x.focus();},50);});
function post(){var body=new URLSearchParams(new FormData(f));if(fr)body.set('friend','1');fetch(f.getAttribute('data-base')+'/'+slug+'/me',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:body.toString(),credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){f.hidden=true;var t=document.createElement('p');t.className='dv-done';t.textContent=j.linked?'It is in your Pictures of you.':j.ok?(fr?'Asked. They will get a letter.':'Check your email to confirm.'):'That did not go through. An email, please.';var fig=document.querySelector('[data-dv-me="'+slug+'"],[data-dv-friend="'+slug+'"]');if(fig)fig.closest('figcaption').appendChild(t);if(j.linked&&!fr)setTimeout(function(){location.reload();},900);});}
f.addEventListener('submit',function(e){e.preventDefault();post();});})();</script>
<footer class="dv-foot">${view ? `<div class="dv-cta"><p><b>${esc(first(m.name))} delivered these with Watermark.</b> Photographers send their work this way: one link, every picture credited inside the file, the group signs the book, and the pictures stay theirs.</p><p><a class="dv-cta-a" href="/join">Deliver your own photographs</a> <a href="/m/${esc(V.makerSlug ? V.makerSlug(m) : m.handle)}">More by ${esc(m.name)}</a></p></div>` : ''}<p>Each file carries ${esc(m.name)}’s name, the copyright and its licence number inside it, and the house keeps the record of every download. Anyone can check a file at <a href="/verify">watermark.krafftco.com/verify</a>. ${esc(m.name)}’s terms with you stand as agreed between you; the house does not change them.</p><p class="dv-wm">${logo}<span>Delivered with Watermark · Where great work is kept.</span></p></footer></section>
${view ? '' : `<script>(function(){var f=document.querySelector('[data-dv-ks]');if(!f)return;document.addEventListener('click',function(e){var b=e.target.closest('[data-dv-keep]');if(b){f.slug.value=b.getAttribute('data-dv-keep');f.action='/deliver/${esc(d.token)}/'+b.getAttribute('data-dv-keep')+'/keep';f.querySelector('[data-dv-ks-title]').textContent=b.closest('figure').querySelector('b').textContent;f.hidden=false;f.scrollIntoView({behavior:'smooth',block:'center'});var i=f.querySelector('input[name=email]');if(i)setTimeout(function(){i.focus()},400);}if(e.target.closest('[data-dv-ks-x]'))f.hidden=true;});})();</script>`}</main>` }));
  }
  app.get('/deliver/:token', (req, res) => {
    const d = byToken.get(String(req.params.token)); if (!d) return res.sendStatus(404);
    albumPage(d, req, res, false);
  });
  // The album to pass on (31 Oct, Will: "they can share something but not the ability to download"; "virality"):
  // a second address that shows the photographs, the book and the thanks, never a file.
  app.get('/a/:share', (req, res) => { const d = byShare.get(String(req.params.share)); if (!d) return res.sendStatus(404); albumPage(d, req, res, true); });
  // Keep it (Will, 23 Oct: "the collector must immediately be able to do something with the image"; a photograph of
  // yourself, given by the photographer, kept in a gallery of your own, then printed, framed and sent by the house):
  // a free licence of the photograph to the person who keeps it, under the album's own use, no end; the holder's room
  // then offers the proof, prints and Instax. A signed-in collector keeps it as themselves; a stranger gives an email
  // (a new gallery opens for a new email; an email the house knows gets the piece in their gallery and a letter, never
  // a sign-in by typing an address).
  app.post('/deliver/:token/:slug/keep', (req, res) => {
    const d = byToken.get(String(req.params.token)); if (!d || !live(d)) return res.sendStatus(410);
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id); const u = q.use.get(m.id, 'delivery'); if (!u) return res.sendStatus(409);
    let b = buyerOf(req); const x = req.body || {}; const email = String(x.email || '').trim().toLowerCase().slice(0, 160), name = String(x.name || '').trim().slice(0, 120);
    let known = false;
    if (!b) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect(`/deliver/${d.token}?keep=email`);
      b = db.prepare('SELECT * FROM buyers WHERE email=?').get(email);
      if (b) known = true; else { const id = db.prepare("INSERT INTO buyers (customer, email, name) VALUES ('', ?, ?)").run(email, name || null).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); }
    }
    const had = db.prepare("SELECT * FROM licenses WHERE work_id=? AND buyer_id=? AND status='active' AND intended_use LIKE 'Kept from %'").get(w.id, b.id);
    let ref = had && had.ref;
    if (!ref) {
      ref = nextRef();
      db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,intended_use,price_cents,status,buyer_id,rights) VALUES (?,?,?,?,?,?,NULL,'requested',?,?)").run(ref, w.id, u.id, name || b.name || d.client_name, b.email || email || '', `Kept from ${d.title}`.slice(0, 400), b.id, JSON.stringify({ size: allowsFull(d) ? 'full' : 'share', strip: false }));
      grant(ref, { paid: false });
      try { ledger.append(db, 'license.kept', ref, { work: w.slug, from: d.token.slice(0, 6) }); } catch (e) { /* */ }
      if (app.locals.notify) try { app.locals.notify.tell('m:' + m.id, 'kept', { title: `${tidy(w.title)} was kept`, body: `${name || b.name || 'Someone'} kept it from ${d.title}.`, url: `/w/${w.slug}` }); } catch (e) { /* */ }
    }
    const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref);
    if (known) { mail.send({ to: b.email, subject: `${tidy(w.title)} is in your gallery`, text: `${first(name || b.name || 'there')},\n\n${tidy(w.title)}, by ${m.name}, from "${d.title}", now hangs in your gallery on Watermark, yours for good.\n\n${C.base}/signin?next=/yours\n\nWatermark`, feature: 'Kept', cta: { label: 'Your gallery', url: `${C.base}/signin?next=/yours` } }); }
    res.redirect(`/thanks/${ref}?k=${l.download_token || ''}`);
  });
  // One file of the album (21 Oct): the 2,400-pixel copy by default (marked within, the papers inside, no strip: a
  // couple of megabytes, right for a phone and for sharing), or the full file with ?full=1 when the album allows it.
  // Counted as a download of the photograph's own licence. The full file leaves untouched (the master's own pixels).
  async function fileOf(d, w, m, full) {
    const l = licOf(w.ref); if (!l || l.status !== 'active' || (l.ends_at && new Date(l.ends_at) < new Date())) return null;
    const file = await originalPath(w);
    const fmt = full ? (/\.png$/i.test(file) ? 'png' : /\.tiff?$/i.test(file) ? 'tiff' : 'jpeg') : 'jpeg';
    const dlId = Number(db.prepare('INSERT INTO downloads (license_id, size) VALUES (?,?)').run(l.id, full ? 'full' : 'share').lastInsertRowid);
    ledger.append(db, 'file.delivered', l.ref, { work: w.slug, size: full ? 'full' : 'share' });
    // the copy: the house's own 2,400-pixel JPEG 94 from the master (the wall's 'large', cached, warmed when the album is made), so Download all streams at once
    const raw = full ? fs.readFileSync(file) : fs.readFileSync(await images.derivative(file, cache, w.slug, 'large', 'jpg'));
    const buf = full && !/\.(jpe?g|png|tiff?)$/i.test(file) ? raw : await marked(raw, { w, maker: m, ref: l.ref, licensee: d.client_name, use: 'Delivered', ends: l.ends_at, dlId, share: !full, strip: false, format: fmt });
    const fn = fileName(w, m, l.ref, full ? path.extname(w.original_file).toLowerCase() : '.jpg');
    return { buf, name: fn.utf8 || `${w.slug}.jpg`, ascii: fn.ascii || `${w.slug}.jpg`, type: fmt === 'png' ? 'image/png' : fmt === 'tiff' ? 'image/tiff' : 'image/jpeg' };
  }
  const allowsFull = d => d.size !== 'large';
  const fullSize = ws => { const b = ws.reduce((a, w) => a + (w.bytes || 0), 0); return b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`; };
  app.get('/deliver/:token/:slug/file', async (req, res) => {
    const d = byToken.get(String(req.params.token)); if (!d || !live(d)) return res.sendStatus(404);
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    const full = req.query.full === '1' && allowsFull(d); const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id);
    try { const f = await fileOf(d, w, m, full); if (!f) return res.sendStatus(410);
      res.set('Content-Type', f.type); res.set('Content-Disposition', `attachment; filename="${f.ascii.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`); res.set('Cache-Control', 'private, no-store'); res.send(f.buf);
    } catch (e) { console.error('[delivery file]', w.slug, e.message); res.sendStatus(500); }
  });
  // All of it as one zip: the copies by default, the full files with ?full=1; each file marked and counted as a
  // download of its own licence; one file in memory at a time (the zip waits for each entry to be written).
  app.get('/deliver/:token/all.zip', async (req, res) => {
    const d = byToken.get(String(req.params.token)); if (!d || !live(d)) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id), ws = worksOf(d), full = req.query.full === '1' && allowsFull(d);
    res.set('Content-Type', 'application/zip'); res.set('Content-Disposition', `attachment; filename="${d.title.replace(/[^\w .-]+/g, ' ').trim() || 'Delivery'}, ${m.name.replace(/[^\w .-]+/g, ' ')} (Watermark).zip"`); res.set('Cache-Control', 'private, no-store');
    const zip = archiver('zip', { zlib: { level: 1 } }); zip.on('error', () => { try { res.end(); } catch (e) { /* */ } }); zip.pipe(res);
    for (const w of ws) {
      try { const f = await fileOf(d, w, m, full); if (!f) continue;
        const written = new Promise(r => zip.once('entry', r)); zip.append(f.buf, { name: f.name }); await written;
      } catch (e) { console.error('[delivery zip]', w.slug, e.message); }
    }
    zip.finalize();
  });
  // One photograph's page inside the delivery: the picture large, Download, back.
  // That's me / That's a friend, from either address of the album.
  const tagHits = new Map();
  const albumOf = req => req.params.share ? byShare.get(String(req.params.share)) : byToken.get(String(req.params.token));
  app.post(['/deliver/:token/:slug/me', '/a/:share/:slug/me'], (req, res) => {
    const d = albumOf(req); if (!d || !live(d)) return res.status(410).json({ ok: false });
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.status(404).json({ ok: false });
    const k = req.ip, now = Date.now(); const h = (tagHits.get(k) || []).filter(t => now - t < 600e3); if (h.length >= 12) return res.status(429).json({ ok: false, why: 'wait' }); h.push(now); tagHits.set(k, h);
    if (!app.locals.sitters) return res.status(503).json({ ok: false });
    const x = req.body || {}; const b = buyerOf(req);
    const friend = x.friend === '1' ? { name: String(x.friend_name || '').trim().slice(0, 120), email: String(x.friend_email || '').trim().toLowerCase().slice(0, 160) } : null;
    const r = app.locals.sitters.claim(w, { buyer: b && b.email ? b : null, email: String(x.email || '').trim().toLowerCase().slice(0, 160), name: String(x.name || '').trim().slice(0, 120), friend, where: d.title });
    res.json(r);
  });
  // The photograph sized for a story (1080 × 1920): the picture whole on the dark, the credit beneath it in the
  // house's type, the album and the address. The picture is the album's own copy; the credit is drawn, not hidden.
  app.get(['/deliver/:token/:slug/story.jpg', '/a/:share/:slug/story.jpg'], async (req, res) => {
    const d = albumOf(req); if (!d || !live(d)) return res.sendStatus(404);
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    const out = path.join(cache, `story-${w.slug}-${d.id}.jpg`);
    try {
      if (!fs.existsSync(out)) {
        const sharp = require('sharp'); const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id);
        const src = await images.derivativeOf(() => originalPath(w), cache, w.slug, 'large', 'jpg');
        const W = 1080, H = 1920, boxW = 960, boxH = 1380;
        const pic = await sharp(src).resize(boxW, boxH, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
        const left = Math.round((W - pic.info.width) / 2), top = Math.round(150 + (boxH - pic.info.height) / 2);
        const e = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><text x="${W / 2}" y="${top + pic.info.height + 92}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="40" fill="#efe9df">Photograph by ${e(m.name)}</text><text x="${W / 2}" y="${top + pic.info.height + 150}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="25" letter-spacing="5" fill="#a39d92">${e(String(d.title).toUpperCase().slice(0, 48))}</text><text x="${W / 2}" y="${H - 90}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" letter-spacing="6" fill="#8f897f">WATERMARK</text></svg>`;
        const tmp = `${out}.${process.pid}.tmp`;
        await sharp({ create: { width: W, height: H, channels: 3, background: '#0b0a09' } }).composite([{ input: pic.data, left, top }, { input: Buffer.from(svg), left: 0, top: 0 }]).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(tmp);
        try { fs.renameSync(tmp, out); } catch (er) { try { fs.unlinkSync(tmp); } catch (e2) { /* */ } }
      }
      res.set('Cache-Control', 'private, max-age=3600'); res.type('image/jpeg').sendFile(out);
    } catch (er) { console.error('[story]', er.message); res.sendStatus(500); }
  });
  app.get('/deliver/:token/:slug', (req, res) => {
    const d = byToken.get(String(req.params.token)); if (!d || !live(d)) return res.sendStatus(404);
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    const l = licOf(w.ref), m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id);
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: `${tidy(w.title)} · ${d.title} · Watermark`, bare: true, body: `<main class="dv dv-one"><a class="dv-back" href="/deliver/${esc(d.token)}">${I.back || ''}<span>${esc(d.title)}</span></a><img class="dv-big" src="/img/${esc(w.slug)}/large" alt="${esc(tidy(w.title))}"><p class="dv-cap"><b>${esc(tidy(w.title))}</b> · ${esc(m.name)}${w.place ? ` · ${esc(w.place)}` : ''} · <a href="/deliver/${esc(d.token)}/${esc(w.slug)}/file" download>Download</a><button type="button" class="dv-keep" data-dv-keep="${esc(w.slug)}">Keep it</button>${allowsFull(d) ? ` · <a href="/deliver/${esc(d.token)}/${esc(w.slug)}/file?full=1" download>Full size</a>` : ''} · <a href="/wander?in=delivery:${esc(d.token)}&at=${esc(w.slug)}">Wander from here</a></p></main>` }));
  });
  app.locals.deliveries = { url, live, close, worksOf, holds, set };
  return app.locals.deliveries;
}
module.exports = { mountDeliveries, SIZES };
