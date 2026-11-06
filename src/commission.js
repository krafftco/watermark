// The commission room (Will, 5 Nov: "a portal for a collector and a maker to work on a commission; a legitimate
// conversation between maker and collector, a real chat, where you could negotiate pay, contracts, all that; get them
// out of email"; "where you could give updates and share photos of the work and video"). The brief (briefs.js) carries
// the agreement, the money held, the delivery and the approval; this is the conversation inside it.
//   - One thread per brief and artist (an open call has one per artist who speaks or answers). The client talks from
//     their desk (/b/<token>, no account), the artist from /account/briefs/<ref>.
//   - A message is words and up to six photographs, films or PDFs (the bag check reads each; kept under briefs/ in
//     the vault; served only to the two sides and the house, never public).
//   - Kinds: a note; an update (work in progress, the artist's); an offer (a fee, a date and a line on terms, from
//     either side). The other side accepts an offer: the artist's answer is set to that fee, the brief is chosen, the
//     agreement written and fingerprinted, and the client pays to begin (the money held, as before). A newer offer
//     from the same side replaces an open one. After payment the fee is fixed; changes to it are by the house.
//   - The other side is told: a notice for the artist at once, a letter at most once in COMMISSION_MAIL_MIN (10).
//   - The page asks for what is new every eight seconds while it is open (…/thread.json?after=).
//   - /commission is the collector's door (a work made for you; personal, never a company's use); /yours/commissions
//     lists a collector's own. Nothing of a conversation is told on the register.
//   Every word a draft for Will and counsel.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function mountCommission(app, { db, V, C, mail, makerOf, store }) {
  const { esc, money } = V; const FEE = require('./fee');
  db.exec(`CREATE TABLE IF NOT EXISTS commission_msgs (id INTEGER PRIMARY KEY, brief_id INTEGER NOT NULL, maker_id INTEGER NOT NULL, side TEXT NOT NULL,
    body TEXT, kind TEXT NOT NULL DEFAULT 'note', fee_cents INTEGER, due TEXT, terms TEXT, status TEXT, files TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)');
  const DIR = path.join(C.dataDir, 'briefs'); try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) { /* made by briefs */ }
  const MAX_MB = Number(process.env.BRIEF_MAX_MB || 4096);
  const MAIL_MIN = Number(process.env.COMMISSION_MAIL_MIN || 10);
  const upload = require('multer')({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: MAX_MB * 1024 * 1024, files: 6 } });
  const base = C.base;
  const B = () => app.locals.briefs;
  const byToken = t => db.prepare('SELECT * FROM briefs WHERE token=?').get(String(t || ''));
  const byRef = r => db.prepare('SELECT * FROM briefs WHERE ref=?').get(String(r || ''));
  const maker = id => db.prepare('SELECT * FROM makers WHERE id=?').get(+id);
  const first = n => String(n || '').split(/\s+/)[0];
  const clean = s => String(s || '').replace(/<[^>]*>/g, '').trim();
  const clientName = b => first(b.contact || b.company) || 'They';
  const paid = b => !!b.paid || ['commissioned', 'delivered', 'done'].includes(b.status);

  // ---------- reading ----------
  const thread = (b, mid, after = 0) => db.prepare('SELECT * FROM commission_msgs WHERE brief_id=? AND maker_id=? AND id>? ORDER BY id').all(b.id, +mid, +after || 0);
  const makersOf = b => {
    const ids = new Set(); if (b.to_maker) ids.add(b.to_maker);
    for (const r of db.prepare("SELECT maker_id FROM brief_answers WHERE brief_id=? AND status<>'withdrawn'").all(b.id)) ids.add(r.maker_id);
    for (const r of db.prepare('SELECT DISTINCT maker_id FROM commission_msgs WHERE brief_id=?').all(b.id)) ids.add(r.maker_id);
    return [...ids].map(maker).filter(Boolean);
  };
  // The artist may speak while the brief is open to them, or once they are the one chosen.
  const artistMay = (b, m) => {
    if (b.to_maker && b.to_maker !== m.id) return false;
    if (!b.proposal_id) return b.status === 'open' || b.status === 'chosen';
    const a = db.prepare('SELECT maker_id FROM brief_answers WHERE id=?').get(b.proposal_id); return !!a && a.maker_id === m.id;
  };
  const clientMay = (b, m) => { if (b.status === 'ended') return false; if (!b.proposal_id) return true; const a = db.prepare('SELECT maker_id FROM brief_answers WHERE id=?').get(b.proposal_id); return !!a && a.maker_id === m.id; };

  // ---------- drawing ----------
  const fileUrl = (b, msg, i, side) => side === 'client' ? `/b/${encodeURIComponent(b.token)}/t/${msg.maker_id}/f/${msg.id}/${i}` : `/account/briefs/${encodeURIComponent(b.ref)}/m/${msg.id}/${i}`;
  const when = s => { const d = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }); };
  function bubble(b, msg, viewer, m) {
    const mine = msg.side === viewer; const who = msg.side === 'house' ? 'Watermark' : msg.side === 'artist' ? first(m.name) : clientName(b);
    const files = JSON.parse(msg.files || '[]').map((f, i) => {
      const u = fileUrl(b, msg, i, viewer);
      return /^video\//.test(f.mime) ? `<video class="cnv-v" src="${u}" controls preload="metadata" playsinline></video>` : /^image\//.test(f.mime) ? `<a class="cnv-i" href="${u}" target="_blank"><img src="${u}" alt="${esc(f.name || '')}" loading="lazy"></a>` : `<a class="cnv-d" href="${u}" target="_blank">${esc(f.name || 'file')}</a>`;
    }).join('');
    const offer = msg.kind === 'offer' ? `<div class="cnv-of${msg.status === 'accepted' ? ' cnv-ok' : msg.status !== 'open' ? ' cnv-old' : ''}"><b>${money(msg.fee_cents)}</b>${FEE.on() && msg.fee_cents ? ` <small>${money(FEE.total(msg.fee_cents))} with the house’s share</small>` : ''}${msg.due ? `<span>Delivered by ${esc(msg.due)}</span>` : ''}${msg.terms ? `<span>${esc(msg.terms)}</span>` : ''}
<em>${msg.status === 'accepted' ? 'Agreed' : msg.status === 'replaced' ? 'Replaced by a newer offer' : msg.status === 'closed' ? 'Closed' : mine ? 'Waiting for their answer' : ''}</em>${!mine && msg.status === 'open' && !paid(b) ? `<form method="post" action="${viewer === 'client' ? `/b/${esc(b.token)}/t/${msg.maker_id}` : `/account/briefs/${esc(b.ref)}`}/accept/${msg.id}"><button class="buy-btn">Accept ${money(msg.fee_cents)}</button></form>` : ''}</div>` : '';
    return `<li class="cnv-m cnv-${msg.side}${mine ? ' cnv-me' : ''}${msg.kind === 'update' ? ' cnv-up' : ''}" data-id="${msg.id}"><p class="cnv-w">${esc(who)}${msg.kind === 'update' ? ' · an update' : msg.kind === 'offer' ? ' · an offer' : ''} · ${esc(when(msg.created_at))}</p>${msg.body ? `<p class="cnv-b">${esc(msg.body).replace(/\n/g, '<br>')}</p>` : ''}${files ? `<div class="cnv-fs">${files}</div>` : ''}${offer}</li>`;
  }
  function room(b, m, viewer) {
    const msgs = thread(b, m.id); const may = viewer === 'client' ? clientMay(b, m) : artistMay(b, m);
    const action = viewer === 'client' ? `/b/${esc(b.token)}/t/${m.id}` : `/account/briefs/${esc(b.ref)}`;
    const other = viewer === 'client' ? first(m.name) : clientName(b);
    const hint = viewer === 'client' ? `Say what you have in mind, send pictures of the place or what you love, and agree a fee with ${esc(first(m.name))} here.` : `Ask what they need, send sketches and work in progress, and agree a fee here. Nothing goes by email.`;
    return `<section class="cnv" id="talk-${m.id}" data-cnv="${action}/thread.json" data-after="${msgs.length ? msgs[msgs.length - 1].id : 0}">
<h2>${viewer === 'client' ? `Talk with ${esc(first(m.name))}` : `Talk with ${esc(other)}`}</h2>
<ul class="cnv-l">${msgs.map(x => bubble(b, x, viewer, m)).join('') || `<li class="cnv-e">${hint}</li>`}</ul>
${may ? `<form class="cnv-f" method="post" action="${action}/say" enctype="multipart/form-data">
<textarea name="body" rows="3" maxlength="4000" placeholder="Write to ${esc(other)}"></textarea>
<div class="cnv-row"><label class="cnv-at">Photos or video<input type="file" name="files" multiple accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf"></label>
${viewer === 'artist' && paid(b) ? '<label class="cnv-ck"><input type="checkbox" name="update" value="1"> It’s an update on the work</label>' : ''}
<button class="buy-btn">Send</button></div>
${!paid(b) ? `<details class="cnv-od"><summary>Make an offer</summary><div class="cnv-row"><label>The fee, in dollars<input name="fee" type="number" min="50" step="10" inputmode="decimal"></label><label>Delivered by<input name="due" type="date"></label></div><label>Terms, in a line<input name="terms" maxlength="300" placeholder="Two rounds of changes; prints at cost"></label><p class="muted">${esc(other)} can accept it here. An accepted offer writes the agreement; ${viewer === 'client' ? 'you pay' : 'they pay'} to begin, and the house holds the money until the work is approved.</p></details>` : ''}
</form>` : '<p class="muted">This conversation is closed.</p>'}
</section>`;
  }
  const SCRIPT = `<script>(function(){document.querySelectorAll('[data-cnv]').forEach(function(s){var u=s.getAttribute('data-cnv'),l=s.querySelector('.cnv-l');function tick(){if(document.hidden)return;fetch(u+'?after='+s.getAttribute('data-after'),{credentials:'same-origin'}).then(function(r){return r.ok?r.json():null}).then(function(j){if(!j||!j.html)return;var e=l.querySelector('.cnv-e');if(e)e.remove();l.insertAdjacentHTML('beforeend',j.html);s.setAttribute('data-after',j.after)}).catch(function(){})}setInterval(tick,8000);if(location.hash==='#'+s.id)l.lastElementChild&&l.lastElementChild.scrollIntoView({block:'end'})})})();</script>`;

  // The client's desk gets one room per artist; the artist's page gets theirs.
  app.locals.commission = {
    client: b => { const ms = makersOf(b); if (!ms.length) return ''; const chosen = b.proposal_id ? (db.prepare('SELECT maker_id FROM brief_answers WHERE id=?').get(b.proposal_id) || {}).maker_id : null; const list = chosen ? ms.filter(m => m.id === chosen) : ms; return list.map(m => room(b, m, 'client')).join('') + SCRIPT; },
    artist: (b, m) => (artistMay(b, m) || thread(b, m.id).length) ? room(b, m, 'artist') + SCRIPT : '',
  };

  // ---------- writing ----------
  async function keepFiles(b, msgId, files, who) {
    const out = [], refused = [];
    for (const f of files || []) {
      const v = app.locals.bagcheck ? await app.locals.bagcheck.check(f.path, { expect: 'deliverable', name: f.originalname, where: 'commission', who }) : { ok: true, type: 'jpeg' };
      if (!v.ok) { refused.push(`${f.originalname}: ${v.reason}`); try { fs.unlinkSync(f.path); } catch (e) { /* gone */ } continue; }
      const h = crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex');
      const name = `${b.ref}-m${msgId}-${h.slice(0, 10)}${path.extname(f.originalname || '') || ''}`;
      try { fs.renameSync(f.path, path.join(DIR, name)); } catch (e) { fs.copyFileSync(f.path, path.join(DIR, name)); fs.unlinkSync(f.path); }
      const mime = { mp4: /\.mov$/i.test(f.originalname) ? 'video/quicktime' : 'video/mp4', webm: 'video/webm', pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', tiff: 'image/tiff', webp: 'image/webp' }[v.type] || f.mimetype || 'application/octet-stream';
      out.push({ file: name, name: String(f.originalname || name).slice(0, 160), mime, bytes: f.size, sha256: h });
      if (store && store.put) store.put('briefs/' + name, path.join(DIR, name), mime).catch(e => console.error('[commission] vault', e.message));
    }
    return { out, refused };
  }
  function told(b, m, side) {
    const k = `cm_mail_${b.id}_${m.id}_${side}`; const s = db.prepare('SELECT v FROM settings WHERE k=?').get(k);
    if (s && Date.now() - Number(s.v) < MAIL_MIN * 60e3) return false;
    db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(Date.now())); return true;
  }
  function tellOther(b, m, side, msg) {
    const what = msg.kind === 'offer' ? `an offer of ${money(msg.fee_cents)}` : msg.kind === 'update' ? 'an update on the work' : 'a message';
    if (side === 'client') {
      try { if (app.locals.notify) Promise.resolve(app.locals.notify.tell({ maker_id: m.id, kind: 'requested', title: `${clientName(b)} sent ${what}`, body: b.title, href: `/account/briefs/${b.ref}#talk-${m.id}` })).catch(() => {}); } catch (e) { /* a courtesy */ }
      if (m.email && told(b, m, 'artist')) mail.send({ to: m.email, subject: `${clientName(b)} wrote: ${b.title}`, text: `${first(m.name)},\n\n${clientName(b)} sent ${what} about "${b.title}".\n\nRead and answer: ${base}/account/briefs/${b.ref}#talk-${m.id}\n\nWatermark` }).catch(() => {});
    } else if (b.email && told(b, m, 'client')) {
      mail.send({ to: b.email, subject: `${first(m.name)} wrote: ${b.title}`, text: `${first(m.name)} sent ${what} about "${b.title}".\n\nRead and answer at your desk: ${base}/b/${b.token}#talk-${m.id}\n\nWatermark` }).catch(() => {});
    }
  }
  async function say(req, res, b, m, side, back) {
    const x = req.body || {}; const body = clean(x.body).slice(0, 4000);
    const fee = Math.round(+x.fee * 100); const offer = fee >= 5000 && !paid(b);
    if (!body && !(req.files || []).length && !offer) { for (const f of req.files || []) { try { fs.unlinkSync(f.path); } catch (e) { /* */ } } return res.redirect(back + '?ok=' + encodeURIComponent(+x.fee && !offer ? 'An offer is $50 or more.' : 'Write something, or attach a photograph or a film.') + `#talk-${m.id}`); }
    const kind = offer ? 'offer' : side === 'artist' && x.update === '1' ? 'update' : 'note';
    if (offer) db.prepare("UPDATE commission_msgs SET status='replaced' WHERE brief_id=? AND maker_id=? AND side=? AND kind='offer' AND status='open'").run(b.id, m.id, side);
    const r = db.prepare('INSERT INTO commission_msgs (brief_id, maker_id, side, body, kind, fee_cents, due, terms, status, files) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(b.id, m.id, side, body || null, kind, offer ? fee : null, offer ? clean(x.due).slice(0, 10) || null : null, offer ? clean(x.terms).slice(0, 300) || null : null, offer ? 'open' : null, '[]');
    const id = Number(r.lastInsertRowid);
    const { out, refused } = await keepFiles(b, id, req.files, side === 'artist' ? `m:${m.handle}` : `brief:${b.ref}`);
    if (out.length) db.prepare('UPDATE commission_msgs SET files=? WHERE id=?').run(JSON.stringify(out), id);
    if (!body && !out.length && !offer) { db.prepare('DELETE FROM commission_msgs WHERE id=?').run(id); return res.redirect(back + '?ok=' + encodeURIComponent('Not sent: ' + refused.join('; ')) + `#talk-${m.id}`); }
    tellOther(b, m, side, db.prepare('SELECT * FROM commission_msgs WHERE id=?').get(id));
    if (x.json === '1') return res.json({ ok: true, id, refused });
    res.redirect(back + (refused.length ? '?ok=' + encodeURIComponent('Sent. Not attached: ' + refused.join('; ')) : '') + `#talk-${m.id}`);
  }
  // Accepting an offer: the artist's answer takes the fee, the brief is chosen and the agreement written.
  function accept(b, m, msg, by) {
    if (!msg || msg.kind !== 'offer' || msg.status !== 'open' || paid(b) || msg.side === by) return false;
    const due = msg.due || b.due;
    let a = db.prepare('SELECT * FROM brief_answers WHERE brief_id=? AND maker_id=?').get(b.id, m.id);
    if (a) db.prepare("UPDATE brief_answers SET fee_cents=?, status='sent' WHERE id=?").run(msg.fee_cents, a.id);
    else db.prepare('INSERT INTO brief_answers (brief_id, maker_id, fee_cents, line, refs) VALUES (?,?,?,?,?)').run(b.id, m.id, msg.fee_cents, msg.terms || 'Agreed in conversation', '[]');
    a = db.prepare('SELECT * FROM brief_answers WHERE brief_id=? AND maker_id=?').get(b.id, m.id);
    if (due !== b.due) db.prepare('UPDATE briefs SET due=? WHERE id=?').run(due, b.id);
    const nb = db.prepare('SELECT * FROM briefs WHERE id=?').get(b.id);
    const text = B().agreement(nb, a, m) + (msg.terms ? `\n\nAgreed in conversation: ${msg.terms}` : '');
    db.prepare("UPDATE briefs SET status='chosen', proposal_id=?, fee_cents=?, house_cents=?, agreement_hash=? WHERE id=?").run(a.id, a.fee_cents, FEE.on() ? FEE.total(a.fee_cents) - a.fee_cents : 0, crypto.createHash('sha256').update(text).digest('hex'), b.id);
    db.prepare("UPDATE commission_msgs SET status=CASE WHEN id=? THEN 'accepted' ELSE 'closed' END WHERE brief_id=? AND kind='offer' AND status='open'").run(msg.id, b.id);
    db.prepare("INSERT INTO commission_msgs (brief_id, maker_id, side, body, kind) VALUES (?,?,'house',?,'note')").run(b.id, m.id, `Agreed: ${money(msg.fee_cents)}${due ? `, delivered by ${due}` : ''}. The agreement is written. ${clientName(b)} pays ${money(FEE.on() ? FEE.total(msg.fee_cents) : msg.fee_cents)} to begin, and the house holds it until the work is approved.`);
    if (b.email) mail.send({ to: b.email, subject: `Agreed: ${b.title}`, text: `${first(m.name)} and you agreed ${money(msg.fee_cents)} for "${b.title}". The agreement is at your desk; pay there to begin:\n\n${base}/b/${b.token}#pay\n\nWatermark` }).catch(() => {});
    if (m.email) mail.send({ to: m.email, subject: `Agreed: ${b.title}`, text: `${first(m.name)},\n\n${money(msg.fee_cents)} is agreed for "${b.title}". You will be told when ${clientName(b)} has paid; then begin.\n\n${base}/account/briefs/${b.ref}\n\nWatermark` }).catch(() => {});
    return true;
  }

  // ---------- the client's side (by the desk's token) ----------
  const clientCtx = req => { const b = byToken(req.params.token); const m = b && maker(req.params.mid); return b && m && makersOf(b).some(x => x.id === m.id) ? { b, m } : null; };
  app.post('/b/:token/t/:mid/say', upload.array('files', 6), (req, res) => { const c = clientCtx(req); if (!c || !clientMay(c.b, c.m)) { for (const f of req.files || []) { try { fs.unlinkSync(f.path); } catch (e) { /* */ } } return res.sendStatus(404); } say(req, res, c.b, c.m, 'client', `/b/${c.b.token}`).catch(e => { console.error('[commission]', e.message); res.redirect(`/b/${c.b.token}`); }); });
  app.post('/b/:token/t/:mid/accept/:id', (req, res) => { const c = clientCtx(req); if (!c) return res.sendStatus(404); const msg = db.prepare('SELECT * FROM commission_msgs WHERE id=? AND brief_id=? AND maker_id=?').get(+req.params.id, c.b.id, c.m.id); accept(c.b, c.m, msg, 'client'); res.redirect(`/b/${c.b.token}#pay`); });
  app.get('/b/:token/t/:mid/thread.json', (req, res) => { const c = clientCtx(req); if (!c) return res.sendStatus(404); const rows = thread(c.b, c.m.id, req.query.after); res.set('Cache-Control', 'private, no-store').json({ after: rows.length ? rows[rows.length - 1].id : +req.query.after || 0, html: rows.map(x => bubble(c.b, x, 'client', c.m)).join('') }); });
  app.get('/b/:token/t/:mid/f/:id/:i', (req, res) => { const c = clientCtx(req); if (!c) return res.sendStatus(404); serve(res, c.b, c.m, req.params.id, req.params.i); });
  async function serve(res, b, m, id, i) {
    const msg = db.prepare('SELECT * FROM commission_msgs WHERE id=? AND brief_id=? AND maker_id=?').get(+id, b.id, m.id); const f = msg && JSON.parse(msg.files || '[]')[+i]; if (!f) return res.sendStatus(404);
    try { const p = app.locals.files ? await app.locals.files.local(path.join(DIR, f.file), 'briefs/' + f.file) : path.join(DIR, f.file); if (!p) return res.sendStatus(404); res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', 'noindex').set('Content-Disposition', 'inline').type(f.mime).sendFile(p); }
    catch (e) { res.sendStatus(404); }
  }

  // ---------- the artist's side ----------
  const artistCtx = (req, res) => { const m = makerOf(req); if (!m) { res.sendStatus(401); return null; } const b = byRef(req.params.ref); if (!b || (b.to_maker && b.to_maker !== m.id)) { res.sendStatus(404); return null; } return { b, m }; };
  app.post('/account/briefs/:ref/say', upload.array('files', 6), (req, res) => { const c = artistCtx(req, res); if (!c) { for (const f of req.files || []) { try { fs.unlinkSync(f.path); } catch (e) { /* */ } } return; } if (!artistMay(c.b, c.m)) return res.redirect(`/account/briefs/${c.b.ref}`); say(req, res, c.b, c.m, 'artist', `/account/briefs/${c.b.ref}`).catch(e => { console.error('[commission]', e.message); res.redirect(`/account/briefs/${c.b.ref}`); }); });
  app.post('/account/briefs/:ref/accept/:id', (req, res) => { const c = artistCtx(req, res); if (!c) return; const msg = db.prepare('SELECT * FROM commission_msgs WHERE id=? AND brief_id=? AND maker_id=?').get(+req.params.id, c.b.id, c.m.id); accept(c.b, c.m, msg, 'artist'); res.redirect(`/account/briefs/${c.b.ref}#talk-${c.m.id}`); });
  app.get('/account/briefs/:ref/thread.json', (req, res) => { const c = artistCtx(req, res); if (!c) return; const rows = thread(c.b, c.m.id, req.query.after); res.set('Cache-Control', 'private, no-store').json({ after: rows.length ? rows[rows.length - 1].id : +req.query.after || 0, html: rows.map(x => bubble(c.b, x, 'artist', c.m)).join('') }); });
  app.get('/account/briefs/:ref/m/:id/:i', (req, res) => { const c = artistCtx(req, res); if (!c) return; serve(res, c.b, c.m, req.params.id, req.params.i); });

  // ---------- the collector's door ----------
  app.get('/commission', (req, res) => {
    const to = req.query.to ? db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.query.to)) : null;
    const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null;
    const nm = to ? first(to.name) : null;
    res.send(V.layout({ title: `${to ? `Commission ${to.name}` : 'Commission a work'} · Watermark`, path: '/commission', body: `<section class="narrow brf"><p class="k">A work made for you</p><h1>${to ? `Commission ${esc(to.name)}.` : 'Commission a work.'}</h1>
<p class="lede">${to ? esc(nm) : 'An artist'} makes something for you: a portrait, your house, a place you love, a print for one wall. You talk it through here, with pictures and films as it comes along, agree the fee, and pay once. The house holds the money until you are happy, and the agreement is in writing.</p>
${req.query.ok === 'check' ? '<p class="err">Your name, your email and what you would like made, please.</p>' : ''}
<form method="post" action="/brands/brief" class="brf-f"><input type="hidden" name="kind" value="personal">${to ? `<input type="hidden" name="to" value="${esc(to.handle)}">` : ''}
<label>Your name<input name="contact" required maxlength="80" value="${esc(b && b.name || '')}"></label><label>Your email<input name="email" type="email" required maxlength="160" value="${esc(b && b.email || '')}"></label>
<label>What you would like made<input name="title" required maxlength="140" placeholder="Our house in the snow, for the hall"></label>
<label>Tell ${to ? esc(nm) : 'them'} about it<textarea name="body" rows="5" maxlength="4000" placeholder="Where, when, the feeling you want, where it will hang."></textarea></label>
<label>About how much, in dollars<input name="budget" type="number" min="0" step="50" placeholder="1500"></label><label>Hoped for by<input name="due" type="date"></label>
<input type="hidden" name="kinds" value="photographs"><input type="hidden" name="n" value="1">
<button class="buy-btn">Begin the conversation</button>
<p class="muted">Nothing is charged until you agree a fee. You get a room for it by letter: no account, no password. For a company’s use, <a href="/brands${to ? `?to=${esc(to.handle)}` : ''}">commission it for a company</a>.</p></form></section>` }));
  });
  app.get('/yours/commissions', (req, res) => {
    const b = app.locals.buyerOf ? app.locals.buyerOf(req) : null; if (!b) return res.redirect('/signin?next=/yours/commissions');
    const rows = db.prepare('SELECT * FROM briefs WHERE buyer_id=? OR (email<>\'\' AND lower(email)=lower(?)) ORDER BY id DESC LIMIT 60').all(b.id, b.email || '\u0000');
    const state = { open: 'Talking', chosen: 'Agreed: waiting for payment', commissioned: 'The artist is at work', delivered: 'Delivered: yours to approve', done: 'Done', ended: 'Ended' };
    res.set('Cache-Control', 'private, no-store').send(V.layout({ title: 'Your commissions · Watermark', path: '/yours/commissions', body: `<section class="narrow brf"><p class="k"><a href="/yours">You</a></p><h1>Your commissions.</h1>
<ul class="brf-list">${rows.map(r => `<li><a href="/b/${esc(r.token)}"><b>${esc(r.title)}</b><span>${esc(state[r.status] || r.status)} · ${esc(r.ref)}</span></a></li>`).join('') || '<li class="muted">None yet. <a href="/commission">Commission a work</a>.</li>'}</ul></section>` }));
  });
  app.locals.commissionRoom = { accept, thread, makersOf };
}
module.exports = { mountCommission };
