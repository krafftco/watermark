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
  const worksOf = d => db.prepare('SELECT w.*, dw.ref, dw.pos FROM delivery_works dw JOIN works w ON w.id=dw.work_id WHERE dw.delivery_id=? ORDER BY dw.pos, w.id').all(d.id);
  // For the thank-you card: the delivery holding this work, if it is live.
  const holds = (token, slug) => { const d = byToken.get(token); if (!d || !live(d)) return null; return worksOf(d).some(w => w.slug === slug) ? d : null; };
  const licOf = ref => db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref);
  // The album as a set to wander (Will, 21 Oct): its photographs, in its order, while the link is live.
  const set = token => { const d = byToken.get(String(token || '')); if (!d || !live(d)) return null; return { label: d.title, href: `/deliver/${d.token}`, via: d.token, works: worksOf(d).map(w => ({ id: w.id, slug: w.slug, title: w.title, width: w.width, height: w.height, maker_id: w.maker_id })) }; };
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
  setTimeout(sweep, 60e3).unref(); setInterval(sweep, 3600e3).unref();
  // The copies of every live album made ahead (90 s after start, one at a time), so a client's Download all never waits on the house.
  const warmAlbums = async () => { for (const d of db.prepare("SELECT * FROM deliveries WHERE status='open'").all()) { if (!live(d)) continue; for (const w of worksOf(d)) { try { await images.derivative(await originalPath(w), cache, w.slug, 'large', 'jpg'); } catch (e) { /* on the first download instead */ } } } };
  if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') setTimeout(() => warmAlbums().catch(() => {}), 90e3).unref();
  const first = s => String(s || '').trim().split(/\s+/)[0] || '';

  // The maker's desk.
  app.get('/account/deliveries', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?to=' + encodeURIComponent('/account/deliveries'));
    const rows = db.prepare('SELECT * FROM deliveries WHERE maker_id=? ORDER BY id DESC LIMIT 100').all(m.id);
    const works = db.prepare("SELECT id, slug, title, place, status FROM works WHERE maker_id=? AND status IN ('held','hidden') ORDER BY stars DESC, id DESC").all(m.id);
    const ok = req.query.ok ? String(req.query.ok) : '';
    const sent = req.query.sent ? byToken.get(String(req.query.sent)) : null;
    res.send(V.layout({ title: 'Deliveries · Watermark', path: '/account/deliveries', studio: true, body: `<section class="studio-wrap dv-desk"><p class="k">Your studio</p><h1>Deliveries.</h1>
<p class="lede">Send a client their photographs: one link, no payment, every file carrying your name and its licence inside it, every download counted. The link closes on the day you set.${ok ? ` <b>${esc(ok)}</b>` : ''}</p>
${sent && sent.maker_id === m.id ? `<div class="dv-sent"><p class="k">Sent</p><h2>${esc(sent.title)}</h2><p>For ${esc(sent.client_name)}${sent.client_email ? `, written to ${esc(sent.client_email)}` : ''}. The link:</p><p class="dv-link"><input readonly value="${esc(url(sent))}" onclick="this.select()"> <button type="button" class="link" data-copy="${esc(url(sent))}">Copy</button></p></div>` : ''}
<form method="post" action="/account/deliveries" class="dv-f"><h2>A new delivery</h2>
<div class="dv-grid"><label><span>What it is</span><input name="title" required maxlength="120" placeholder="The wedding, the proofs, the June shoot"></label><label><span>For whom</span><input name="client" required maxlength="120" placeholder="Their name"></label><label><span>Their email (optional: the house writes to them)</span><input type="email" name="email" maxlength="160"></label><label><span>Closes in</span><select name="days"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="365">A year</option><option value="0">Never</option></select></label><label><span>The files</span><select name="size">${Object.entries(SIZES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
<label class="dv-notef"><span>A note to them (optional)</span><textarea name="note" rows="2" maxlength="600"></textarea></label>
<p class="k">The photographs <small>(tick; held and kept-back alike)</small> · <input type="search" class="dv-find" placeholder="Filter by word" data-dv-find></p>
<div class="dv-pick" data-dv-pick>${works.map(w => `<label class="dv-w" data-t="${esc((w.title + ' ' + (w.place || '')).toLowerCase())}"><input type="checkbox" name="works" value="${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span>${esc(tidy(w.title))}${w.status === 'hidden' ? ' <i>kept back</i>' : ''}</span></label>`).join('')}</div>
<p class="dv-row"><button class="buy-btn">Make the link</button> <span class="note">Each photograph is granted to them as a licence of use <i>Delivered</i>, free, with your name and the number written into the file.</span></p></form>
${rows.length ? `<h2>Sent</h2><table class="tbl dv-t"><tr><th>What</th><th>For</th><th>Photographs</th><th>Opened</th><th>Downloads</th><th>State</th><th></th></tr>${rows.map(d => `<tr><td><a href="/deliver/${esc(d.token)}">${esc(d.title)}</a></td><td>${esc(d.client_name)}</td><td>${db.prepare('SELECT COUNT(*) n FROM delivery_works WHERE delivery_id=?').get(d.id).n}</td><td>${d.opens}</td><td>${dlCount(d)}</td><td>${live(d) ? `Open${d.expires_at ? ` until ${esc(date(d.expires_at))}` : ''}` : 'Closed'}</td><td>${live(d) ? `<form method="post" action="/account/deliveries/${d.id}/close"><button class="link">Close</button></form>` : ''}</td></tr>`).join('')}</table>` : ''}
<script>(function(){var f=document.querySelector('[data-dv-find]'),p=document.querySelector('[data-dv-pick]');if(f&&p)f.addEventListener('input',function(){var v=f.value.trim().toLowerCase();[].forEach.call(p.children,function(l){l.hidden=!!v&&l.getAttribute('data-t').indexOf(v)<0});});document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');if(!b)return;navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){b.textContent='Copied'});});})();</script></section>` }));
  });
  app.post('/account/deliveries', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 120), client = String(b.client || '').trim().slice(0, 120), email = String(b.email || '').trim().toLowerCase().slice(0, 160);
    const slugs = [].concat(b.works || []).map(String).slice(0, 300);
    if (!title || !client || !slugs.length) return res.redirect('/account/deliveries?ok=' + encodeURIComponent('A title, a name and at least one photograph.'));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect('/account/deliveries?ok=' + encodeURIComponent('That email will not do.'));
    const u = q.use.get(m.id, 'delivery'); if (!u) return res.redirect('/account/deliveries?ok=' + encodeURIComponent('The delivery use is not set for this studio yet.'));
    const days = Math.max(0, Math.min(3650, +b.days || 0)); const size = SIZES[b.size] ? b.size : 'original';
    const token = crypto.randomBytes(18).toString('base64url');
    const id = Number(db.prepare("INSERT INTO deliveries (token, maker_id, title, client_name, client_email, note, size, expires_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(token, m.id, title, client, email || null, String(b.note || '').trim().slice(0, 600) || null, size, days ? new Date(Date.now() + days * 864e5).toISOString() : null).lastInsertRowid);
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
    setTimeout(async () => { for (const w of worksOf(d)) { try { await images.derivative(await originalPath(w), cache, w.slug, 'large', 'jpg'); } catch (e) { /* made on the first download instead */ } } }, 50).unref(); // the copies made now, in the background
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
  app.get('/deliver/:token', (req, res) => {
    const d = byToken.get(String(req.params.token)); if (!d) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id);
    res.set('Cache-Control', 'private, no-store');
    if (!live(d)) return res.status(410).send(V.layout({ title: `${d.title} · Watermark`, bare: true, body: `<main class="dv"><section class="dv-wall"><p class="k">From ${esc(m.name)}</p><h1>${esc(d.title)}</h1><p class="dv-lede">This delivery has closed. Write to ${esc(m.name)} for another.</p></section></main>` }));
    db.prepare('UPDATE deliveries SET opens=opens+1 WHERE id=?').run(d.id);
    const ws = worksOf(d); const me = buyerOf(req);
    const wander = `/wander?in=delivery:${esc(d.token)}`, logo = `<a class="dv-logo" href="/" aria-label="Watermark"><img src="/static/watermark-logo.svg" alt="Watermark" width="150" height="40"></a>`;
    res.send(V.layout({ title: `${d.title} · Watermark`, bare: true, desc: `${d.title}, from ${m.name}.`, body: `<main class="dv"><section class="dv-wall">
<header class="dv-h">${logo}<p class="k">From ${esc(m.name)} · for ${esc(d.client_name)}</p><h1>${esc(d.title)}</h1>
<p class="dv-gift">${ws.length === 1 ? 'A photograph' : `${ws.length} photographs`} by ${esc(m.name)}, made for you and yours to keep: download them, print them, share them. Each one carries ${esc(first(m.name))}’s name inside it, the way a print carries a signature.</p>
${d.note ? `<blockquote class="dv-note"><p>${esc(d.note)}</p><footer>— ${esc(first(m.name))}</footer></blockquote>` : ''}
<p class="dv-acts"><a class="dv-wander" href="${wander}">${V.WAVE_MARK || ''}<span>Wander through them</span><i>One at a time, edge to edge</i></a><a class="dv-all" href="/deliver/${esc(d.token)}/all.zip">${I.in || ''}<span>Download all ${ws.length === 1 ? '' : `(${ws.length})`}</span></a><span class="dv-sz">2,400 pixels, a few megabytes each: right for a phone and for sharing.${allowsFull(d) ? ` <a href="/deliver/${esc(d.token)}/all.zip?full=1">The full files</a> (${esc(fullSize(ws))}) for printing.` : ''}${d.expires_at ? ` The link closes ${esc(date(d.expires_at))}.` : ''}</span></p></header>
<div class="dv-grid">${ws.map(w => { const l = licOf(w.ref); return `<figure class="dv-w"><a href="${wander}&at=${esc(w.slug)}" class="dv-im"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="lazy" decoding="async"${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}></a><figcaption><b>${esc(tidy(w.title))}</b>${w.place ? `<i>${esc(w.place)}</i>` : ''}<a href="/deliver/${esc(d.token)}/${esc(w.slug)}/file" download>Download</a><button type="button" class="dv-keep" data-dv-keep="${esc(w.slug)}">Keep it</button>${allowsFull(d) ? `<a class="dv-full" href="/deliver/${esc(d.token)}/${esc(w.slug)}/file?full=1" download title="The full file, for printing">Full size</a>` : ''}</figcaption></figure>`; }).join('')}</div>
${ws.length ? `<section class="ty dv-ty" id="thanks"><div class="ty-card"><p class="k">A thank-you card</p>
${req.query.thanks === 'given' ? `<p class="ty-done">Sent. ${esc(first(m.name))} will see it.</p>` : req.query.thanks ? '<p class="ty-done">Not just now; the till is closed.</p>' : ''}
<form method="post" action="/w/${esc(ws[0].slug)}/thanks" class="ty-f"><input type="hidden" name="via" value="${esc(d.token)}"><p class="ty-say">These are a gift. If you would like to thank ${esc(first(m.name))}, a card goes straight to ${esc(first(m.name))}; the house keeps nothing of it.</p>
<div class="ty-amts">${[99, 499, 999].map((c, i) => `<label><input type="radio" name="amount" value="${c}" ${i === 1 ? 'checked' : ''}><span>${c < 100 ? `${c}¢` : `$${(c / 100).toFixed(2)}`}</span></label>`).join('')}<label class="ty-own"><input type="radio" name="amount" value="own"><span>$<input name="own" inputmode="decimal" placeholder="your own" aria-label="Your own amount"></span></label></div>
<input name="word" class="ty-word" placeholder="A word, if you like" maxlength="280" autocomplete="off"><button class="buy-btn">Send the card</button></form></div></section>` : ''}
<form method="post" class="dv-ks" data-dv-ks hidden><input type="hidden" name="slug"><p class="dv-ks-t"><b>Keep <span data-dv-ks-title></span>.</b> It hangs in a gallery of your own, yours for good, with its papers; and from there you can have it printed, framed and sent, or save it to your phone.</p>${me ? `<p class="dv-ks-me">As ${esc(me.email)}.</p>` : `<label><span>Your name</span><input name="name" maxlength="120" autocomplete="name"></label><label><span>Email</span><input name="email" type="email" required maxlength="160" autocomplete="email" inputmode="email"></label>`}<p class="dv-ks-row"><button class="buy-btn">Keep it</button><button type="button" class="link" data-dv-ks-x>Not now</button></p></form>
<footer class="dv-foot"><p>Each file carries ${esc(m.name)}’s name, the copyright and its licence number inside it, and the house keeps the record of every download. Anyone can check a file at <a href="/verify">watermark.krafftco.com/verify</a>. ${esc(m.name)}’s terms with you stand as agreed between you; the house does not change them.</p><p class="dv-wm">${logo}<span>Delivered with Watermark · Where great work is kept.</span></p></footer></section>
<script>(function(){var f=document.querySelector('[data-dv-ks]');if(!f)return;document.addEventListener('click',function(e){var b=e.target.closest('[data-dv-keep]');if(b){f.slug.value=b.getAttribute('data-dv-keep');f.action='/deliver/${esc(d.token)}/'+b.getAttribute('data-dv-keep')+'/keep';f.querySelector('[data-dv-ks-title]').textContent=b.closest('figure').querySelector('b').textContent;f.hidden=false;f.scrollIntoView({behavior:'smooth',block:'center'});var i=f.querySelector('input[name=email]');if(i)setTimeout(function(){i.focus()},400);}if(e.target.closest('[data-dv-ks-x]'))f.hidden=true;});})();</script></main>` }));
  });
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
