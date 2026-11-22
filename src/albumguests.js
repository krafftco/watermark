// Guests add their own photographs to an album (#203; Will, 22 Nov, ANI.31: "people who get an album's link should be
// able to add their own photographs: phone pictures now, their film scans when the rolls come back"). Will's framing:
// everything a guest adds is theirs, held in their own studio, and the album is only a window onto the pictures they
// chose to share with it.
//   - The add step is the album's own (/a/:share/add, /deliver/:token/add): a name, an email, the one sentence they agree
//     to, then the pictures (many at once). No password. Each file goes through the photographer's own door
//     (app.locals.takeWork: the bag check, the fingerprint, the vault; the master exactly as it arrived) and becomes a
//     work of the guest's own studio, private ('hidden'): never on their page, the gallery or the market unless they
//     later show it themselves.
//   - Nothing is shown to anyone but the guest until one letter's link is pressed (/added/:token; it travels only by mail
//     to the address typed, and it signs them in through the house's own `admit`), and then the album's photographer
//     chooses, picture by picture, what the group sees. The photographer may show or not show; never edit, sell, license
//     or delete a guest's work. The guest may take a picture out of the album at any time; it stays theirs.
//   - In the album the photographer's pictures are the album (the cover, the card, the film and Wander's walk); a guest's
//     pictures sit below in their own part, credited by first name, and are Wander's own walk (`album:<share>.guests`).
//     They can be hearted, downloaded and shared by the group as the album's rules allow; prints, Keep it and licences
//     are offered only on the photographer's pictures.
//   - Limits are the house's storage, per album and per person (never an address): a file over GUEST_FILE_MB, a video,
//     anything that is not a photograph is refused plainly, by name.
// Words for people are drafts for Will (docs/COUNSEL.md 51 on the sentence a guest agrees to). (src/guests.js is another
// room: the guest list of a collector's private gallery.)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const LIM = {
  fileMB: +process.env.GUEST_FILE_MB || 40, // a phone picture is a few MB; a large film scan or a video is refused plainly
  perSend: 30, // files in one press (the page sends one at a time; without its script, up to this many at once)
  albumN: +process.env.GUEST_ALBUM_MAX || 600, // pictures a single album takes from its guests
  albumGB: +process.env.GUEST_ALBUM_GB || 6,
  personN: +process.env.GUEST_PERSON_MAX || 200, // pictures one person may add, across albums
  personGB: +process.env.GUEST_PERSON_GB || 3,
  letterMin: 10, // the confirming letter again, at most once in this many minutes
  linkDays: 30, // the confirming link's life
};
// Draft for Will (docs/COUNSEL.md 51): the one sentence a guest agrees to before adding.
const AGREE = 'Your photographs stay yours. You let this album show them to the people it is shared with, and the photographer, or you, may take any of them out.';
const okEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e) && e.length <= 160;
const VIDEO = /^video\//i, VIDEO_EXT = /\.(mov|mp4|m4v|avi|mkv|webm|3gp|hevc)$/i;

function mountAlbumGuests(app, X) {
  const { db, C, V, I, mail, ledger, grant, nextRef, q, D } = X;
  const { esc, tidy } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS delivery_guests (id INTEGER PRIMARY KEY, delivery_id INTEGER NOT NULL, maker_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE, key TEXT NOT NULL UNIQUE, agreed_at TEXT NOT NULL, proven_at TEXT, mailed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS delivery_guest_works (delivery_id INTEGER NOT NULL, work_id INTEGER NOT NULL, guest_id INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'waiting',
    ref TEXT, bytes INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT, PRIMARY KEY (delivery_id, work_id))`);
  // state: 'waiting' (kept; shown to no one until the email is confirmed and the photographer shows it), 'in' (shown to
  // the album's group), 'no' (the photographer chose not to show it, or took it out), 'out' (the guest took it out).
  const first = s => String(s || '').trim().split(/\s+/)[0] || '';
  const tok = () => crypto.randomBytes(18).toString('base64url');
  const byKey = (d, k) => (/^[\w-]{16,40}$/.test(k || '') ? db.prepare('SELECT * FROM delivery_guests WHERE delivery_id=? AND key=?').get(d.id, String(k)) : null);
  const makerById = id => db.prepare('SELECT * FROM makers WHERE id=?').get(id);
  const baseOf = (d, view) => (view ? `/a/${D.shareOf(d)}` : `/deliver/${d.token}`);
  const msAgo = t => Date.now() - Date.parse(String(t).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(t)) ? '' : 'Z'));

  // What kind of file it is, said plainly (CTO, 22 Nov): a phone copy (small, or with no camera named: a picture passed
  // through a chat, a screenshot) or a full file (a camera or a scanner named, eight million pixels or more).
  const kindOf = w => { const mp = ((w.width || 0) * (w.height || 0)) / 1e6; return w.camera && mp >= 8 ? { k: 'full', say: 'A full file' } : { k: 'phone', say: 'A phone copy' }; };
  // The house's reading of who is in it (art.js), for the photographer's one look: a likely child, or not yet read.
  const readOf = w => { try { const a = w.attribution ? JSON.parse(w.attribution) : null; if (!a || a.missed) return 'unread'; return a.people && a.people.minors ? 'child' : ''; } catch (e) { return 'unread'; } };

  // The shown pictures of an album, by guest (in the order they first added), each guest's in the order taken.
  const COLS = 'w.id, w.slug, w.title, w.place, w.width, w.height, w.taken_at, w.original_file, w.maker_id, w.camera, w.bytes, w.status, g.ref, g.guest_id, g.state, g.added_at';
  function shownOf(d) {
    const rows = db.prepare(`SELECT ${COLS}, gu.name AS guest_name FROM delivery_guest_works g JOIN works w ON w.id=g.work_id JOIN delivery_guests gu ON gu.id=g.guest_id WHERE g.delivery_id=? AND g.state='in' AND gu.proven_at IS NOT NULL ORDER BY g.guest_id, w.id LIMIT 2000`).all(d.id);
    const order = []; const by = new Map(); for (const r of rows) { if (!by.has(r.guest_id)) { by.set(r.guest_id, []); order.push(r.guest_id); } by.get(r.guest_id).push(r); }
    return order.flatMap(id => by.get(id).sort(D.byTaken));
  }
  const shownOne = (d, slug) => db.prepare("SELECT w.*, g.ref, g.guest_id FROM delivery_guest_works g JOIN works w ON w.id=g.work_id JOIN delivery_guests gu ON gu.id=g.guest_id WHERE g.delivery_id=? AND w.slug=? AND g.state='in' AND gu.proven_at IS NOT NULL LIMIT 1").get(d.id, String(slug || '')) || null;

  // ---------- the add step ----------
  const page = (d, body, title = 'Add your photographs') => V.layout({ title: `${title} · ${d.title}`, bare: true, desc: `Add your own photographs to ${d.title}.`, body: `<main class="dv gad"><section class="gad-c">${body}</section></main>` });
  const backTo = (d, view) => `<p class="gad-back"><a href="${esc(baseOf(d, view))}#guests">${I.back || ''}<span>Back to ${esc(d.title)}</span></a></p>`;
  const SAY = {
    big: `That file is larger than an album takes (${LIM.fileMB} MB). A phone picture is well under that; a large film scan can be saved smaller and sent again.`,
    video: 'Photographs only here: a video cannot be added to the album.',
    type: 'That file is not a photograph the house can read. A JPEG, a HEIC from a phone, a PNG or a TIFF will do.',
    album: 'This album has all the pictures it can take from its guests for now. Write to the photographer.',
    person: 'You have added as many pictures as one person can for now. Take some out of an album in your studio, then add again.',
    known: 'That email already has a studio on Watermark. Sign in with it first, then add your photographs.',
    host: 'This is your own album: add your photographs from the album’s page in your studio.',
    agree: 'Tick the line above the button, please: it says what happens to your photographs.',
    name: 'Your name, please: it goes beside your pictures.',
    email: 'An email, please: one letter there confirms the pictures are yours.',
    none: 'Choose at least one photograph.',
    closed: 'This album has closed, and takes nothing more.',
    off: 'The photographer has not opened this album to added photographs.',
  };
  const tooMuch = (d, guest, more) => {
    const a = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(bytes),0) b FROM delivery_guest_works WHERE delivery_id=? AND state IN ('waiting','in')").get(d.id);
    if (Number(a.n) + 1 > LIM.albumN || Number(a.b) + more > LIM.albumGB * 1e9) return 'album';
    const p = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(g.bytes),0) b FROM delivery_guest_works g JOIN delivery_guests gu ON gu.id=g.guest_id WHERE gu.maker_id=? AND g.state IN ('waiting','in')").get(guest.maker_id);
    if (Number(p.n) + 1 > LIM.personN || Number(p.b) + more > LIM.personGB * 1e9) return 'person';
    return null;
  };
  // Who is adding: a signed-in photographer as themselves (already proven); a guest by the key this page was given for
  // this album; otherwise a name and an email make (or find, while it is unproven) a studio of their own, kept unproven
  // until the letter's link is pressed. An address that already opens a proven studio must sign in first: nothing is ever
  // put into a proven studio by typing its address.
  function who(req, d, x) {
    const me = D.makerOf(req);
    if (me) {
      if (me.id === d.maker_id) return { error: 'host' };
      let g = db.prepare('SELECT * FROM delivery_guests WHERE delivery_id=? AND maker_id=? ORDER BY id LIMIT 1').get(d.id, me.id);
      if (!g) { const id = Number(db.prepare("INSERT INTO delivery_guests (delivery_id, maker_id, name, email, token, key, agreed_at, proven_at) VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))").run(d.id, me.id, me.name, String(me.email || '').toLowerCase(), tok(), tok()).lastInsertRowid); g = db.prepare('SELECT * FROM delivery_guests WHERE id=?').get(id); }
      else if (!g.proven_at) { db.prepare("UPDATE delivery_guests SET proven_at=datetime('now') WHERE id=?").run(g.id); g = db.prepare('SELECT * FROM delivery_guests WHERE id=?').get(g.id); }
      return { g };
    }
    const k = byKey(d, x.g); if (k) return { g: k };
    const name = String(x.name || '').trim().slice(0, 120), email = String(x.email || '').trim().toLowerCase().slice(0, 160);
    if (!name || /https?:\/\/|www\./i.test(name)) return { error: 'name' };
    if (!okEmail(email)) return { error: 'email' };
    if (String(x.agree || '') !== '1') return { error: 'agree' };
    const known = db.prepare('SELECT * FROM makers WHERE lower(email)=? ORDER BY id LIMIT 1').get(email) || db.prepare("SELECT * FROM makers WHERE emails IS NOT NULL AND emails<>'' AND (',' || replace(lower(emails), ' ', '') || ',') LIKE ('%,' || ? || ',%') ORDER BY id LIMIT 1").get(email);
    let mk = null;
    if (known) { if (known.door === 'album' && Number(known.email_ok) === 0) mk = known; else return { error: 'known' }; }
    if (!mk) {
      const slug = app.locals.accounts.slugify(name) || 'guest'; let handle = slug, i = 2; while (db.prepare('SELECT 1 FROM makers WHERE handle=?').get(handle)) handle = `${slug}-${i++}`;
      const id = Number(db.prepare("INSERT INTO makers (handle, name, email, kind, email_ok, door) VALUES (?,?,?,'maker',0,'album')").run(handle, name, email).lastInsertRowid);
      const ins = db.prepare('INSERT INTO uses (maker_id,key,name,description,term_months,kind,sort,price_cents) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING');
      app.locals.accounts.DEFAULT_USES.forEach(u => ins.run(id, ...u));
      mk = makerById(id);
    }
    let g = db.prepare('SELECT * FROM delivery_guests WHERE delivery_id=? AND maker_id=? ORDER BY id LIMIT 1').get(d.id, mk.id);
    if (!g) { const id = Number(db.prepare("INSERT INTO delivery_guests (delivery_id, maker_id, name, email, token, key, agreed_at) VALUES (?,?,?,?,?,?,datetime('now'))").run(d.id, mk.id, name, email, tok(), tok()).lastInsertRowid); g = db.prepare('SELECT * FROM delivery_guests WHERE id=?').get(id); }
    return { g };
  }
  // The one letter: it proves the address and opens their studio (the link signs them in, as any house link does).
  function letter(d, g) {
    if (g.proven_at) return { sent: true };
    if (g.mailed_at && msAgo(g.mailed_at) < LIM.letterMin * 60e3) return { sent: mail.on() };
    const m = makerById(d.maker_id) || { name: 'the photographer' }; const url = `${C.base}/added/${g.token}`;
    db.prepare("UPDATE delivery_guests SET mailed_at=datetime('now') WHERE id=?").run(g.id);
    mail.send({ to: g.email, subject: `Your photographs for ${d.title}`, feature: 'Your photographs', cta: { label: 'Confirm, and open your studio', url },
      text: `${first(g.name)},\n\nThank you for adding your photographs to "${d.title}". Press the link to confirm they are yours; it opens your own studio on Watermark, with your pictures in it.\n\n${url}\n\nThey stay yours. ${first(m.name)} sees them once you confirm, and chooses which the album shows, credited to you. Nobody else sees them until then.\n\nIf you did not add any photographs, ignore this letter: nothing is shown.\n\nWatermark` });
    return { sent: mail.on() };
  }
  // The page: the form, or what happened.
  app.get(['/a/:share/add', '/deliver/:token/add'], (req, res) => {
    const d = D.albumOf(req); if (!d) return res.sendStatus(404);
    const view = !!req.params.share, m = makerById(d.maker_id);
    res.set('Cache-Control', 'private, no-store'); res.set('X-Robots-Tag', 'noindex');
    if (!D.live(d)) return res.status(410).send(page(d, `<h1>${esc(d.title)}</h1><p class="dv-lede">${esc(SAY.closed)}</p>`, 'Closed'));
    if (D.isHost(req, d)) return res.redirect(`/account/deliveries/${d.id}#add`);
    const can = D.capsOf(req, d, view); if (!can.see) return res.redirect(baseOf(d, view));
    if (!can.add) return res.send(page(d, `<h1>${esc(d.title)}</h1><p class="dv-lede">${esc(SAY.off)}</p>${backTo(d, view)}`));
    const me = D.makerOf(req), x = req.query;
    const kept = Math.max(0, Number(x.kept) || 0), no = Math.max(0, Number(x.no) || 0), err = SAY[x.why] ? SAY[x.why] : '';
    const done = kept ? `<div class="gad-done" role="status"><p><b>${kept === 1 ? 'One photograph is' : `${kept} photographs are`} kept.</b> ${me ? `${esc(first(m.name))} will see ${kept === 1 ? 'it' : 'them'} and choose what the album shows.` : x.sent === '0' ? 'The letter to confirm them could not be sent just now. Add them again in a while and a letter will go.' : `Look in your email: one letter, one press, and they are yours in your own studio. ${esc(first(m.name))} sees them after that.`}</p>${no ? `<p>${no === 1 ? 'One file was' : `${no} files were`} not taken: ${esc(SAY[x.why] || SAY.type)}</p>` : ''}</div>` : err ? `<p class="dv-said" role="alert">${esc(err)}${x.why === 'known' ? ` <a href="/signin?next=${encodeURIComponent(`${baseOf(d, view)}/add`)}">Sign in</a>` : ''}</p>` : '';
    res.send(page(d, `<p class="k">${esc(d.title)} · photographs by ${esc(m.name)}</p><h1>Add your photographs.</h1>
<p class="dv-lede">Were you there too? Add the pictures you took, from your phone or your computer, as many as you like. ${esc(first(m.name))} chooses what the album shows, and each one is credited to you.</p>${done}
<form method="post" enctype="multipart/form-data" class="gad-f" data-gad>${me ? `<p class="gad-as">As ${esc(me.name)}.</p>` : `<label><span>Your name</span><input name="name" required maxlength="120" autocomplete="name"></label><label><span>Your email <i>one letter, to confirm they are yours</i></span><input name="email" type="email" inputmode="email" required maxlength="160" autocomplete="email"></label>
<label class="gad-ok"><input type="checkbox" name="agree" value="1" required><span>${esc(AGREE)}</span></label>`}
<label class="gad-pick"><input type="file" name="files" accept="image/*,.heic,.heif,.tif,.tiff,.dng" multiple required data-gad-files><span class="buy-btn">${I.plus || ''}<span>Choose photographs</span></span><b data-gad-n></b></label>
<p class="gad-go"><button class="buy-btn" data-gad-go>Add them</button></p><p class="gad-st" data-gad-st role="status" aria-live="polite"></p>
<p class="note">Photographs only, up to ${LIM.fileMB} MB each. They go into a studio of your own, private, and this album shows only the ones ${esc(first(m.name))} chooses. No password: the letter is the key.</p></form>${backTo(d, view)}
<script>(function(){var f=document.querySelector('[data-gad]');if(!f||!window.fetch||!window.FormData)return;var inp=f.querySelector('[data-gad-files]'),n=f.querySelector('[data-gad-n]'),st=f.querySelector('[data-gad-st]'),go=f.querySelector('[data-gad-go]');
inp.addEventListener('change',function(){n.textContent=inp.files.length?inp.files.length+' chosen':'';});
f.addEventListener('submit',function(e){e.preventDefault();var files=[].slice.call(inp.files||[]);if(!files.length){st.textContent='Choose at least one photograph.';return;}go.disabled=true;var key='',kept=0,no=0,why='',sent='1',i=0;
function one(){if(i>=files.length)return end();st.textContent='Sending '+(i+1)+' of '+files.length+'…';var b=new FormData();['name','email','agree'].forEach(function(k){var el=f.elements[k];if(el&&(el.type!=='checkbox'||el.checked))b.append(k,el.value);});if(key)b.append('g',key);b.append('files',files[i]);
fetch(location.pathname,{method:'POST',body:b,credentials:'same-origin',headers:{accept:'application/json'}}).then(function(r){return r.json();}).then(function(j){if(j.g)key=j.g;if(j.letter===false)sent='0';kept+=j.kept||0;no+=j.no||0;if(j.why)why=j.why;if(j.stop){go.disabled=false;if(j.why==='known'){location.href=location.pathname+'?why=known';return;}st.textContent=j.say||'That did not go through.';return;}i++;one();}).catch(function(){no++;i++;one();});}
function end(){location.href=location.pathname+'?kept='+kept+'&no='+no+(why?'&why='+why:'')+'&sent='+sent;}one();});})();</script>`));
  });
  // The pictures in: one file a request from the page's own script, or several from the form alone.
  const up = multer({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: LIM.fileMB * 1024 * 1024, files: LIM.perSend } }).array('files', LIM.perSend);
  app.post(['/a/:share/add', '/deliver/:token/add'], (req, res, next) => up(req, res, e => {
    if (!e) return next();
    for (const f of req.files || []) { try { fs.unlinkSync(f.path); } catch (x) { /* gone */ } }
    const why = e.code === 'LIMIT_FILE_SIZE' ? 'big' : 'type';
    if (/application\/json/.test(req.headers.accept || '')) return res.status(413).json({ ok: false, kept: 0, no: 1, why, say: SAY[why] });
    return res.redirect(303, `${req.path}?kept=0&no=1&why=${why}`);
  }), async (req, res) => {
    const files = req.files || []; const json = /application\/json/.test(req.headers.accept || '');
    const drop = () => { for (const f of files) { try { fs.unlinkSync(f.path); } catch (x) { /* gone */ } } };
    const d = D.albumOf(req); const view = !!req.params.share;
    if (!d) { drop(); return res.sendStatus(404); }
    const back = `${baseOf(d, view)}/add`;
    const stop = (why, code = 400) => { drop(); if (json) return res.status(code).json({ ok: false, stop: true, why, say: SAY[why] }); return res.redirect(303, `${back}?why=${why}`); };
    if (!D.live(d)) return stop('closed', 410);
    const can = D.capsOf(req, d, view); if (!can.see) return stop('off', 403); if (D.isHost(req, d)) return stop('host', 409); if (!can.add) return stop('off', 403);
    const w0 = who(req, d, req.body || {}); if (w0.error) return stop(w0.error, w0.error === 'known' ? 409 : 400);
    const g = w0.g;
    if (!files.length) return stop('none');
    let kept = 0, no = 0, why = '';
    for (const f of files) {
      if (VIDEO.test(f.mimetype || '') || VIDEO_EXT.test(f.originalname || '')) { try { fs.unlinkSync(f.path); } catch (x) { /* gone */ } no++; why = 'video'; continue; }
      const lim = tooMuch(d, g, f.size || 0); if (lim) { try { fs.unlinkSync(f.path); } catch (x) { /* gone */ } no++; why = lim; continue; }
      const r = await app.locals.takeWork(f.path, { name: f.originalname, maker_id: g.maker_id, kind: 'photograph' }); // the photographer's own door: the bag check, the fingerprint, the vault
      if (!r || !r.ok || !r.slug) { no++; why = why || 'type'; continue; }
      const w = db.prepare('SELECT id, bytes, maker_id FROM works WHERE slug=?').get(r.slug); if (!w || w.maker_id !== g.maker_id) { no++; continue; }
      db.prepare("INSERT INTO delivery_guest_works (delivery_id, work_id, guest_id, state, bytes) VALUES (?,?,?,'waiting',?) ON CONFLICT DO NOTHING").run(d.id, w.id, g.id, Number(w.bytes || f.size || 0));
      kept++;
    }
    let lt = { sent: true };
    if (kept) {
      try { ledger.append(db, 'album.added', d.token.slice(0, 6), { n: kept }); } catch (e) { /* */ }
      lt = letter(d, db.prepare('SELECT * FROM delivery_guests WHERE id=?').get(g.id));
      if (g.proven_at) tellHost(d, g, kept);
    }
    if (json) return res.json({ ok: kept > 0, kept, no, why, say: why ? SAY[why] : '', g: g.key, letter: !!lt.sent });
    res.redirect(303, `${back}?kept=${kept}&no=${no}${why ? `&why=${why}` : ''}&sent=${lt.sent ? 1 : 0}`);
  });
  function tellHost(d, g, n) {
    if (app.locals.notify) app.locals.notify.tell({ maker_id: d.maker_id, kind: 'note', href: `/account/deliveries/${d.id}#guests`, title: `${first(g.name)} added ${n === 1 ? 'a photograph' : `${n} photographs`} to ${d.title}`, body: 'Choose which the album shows.' }).catch(() => {});
  }
  // The letter's link: the address is proven, the guest is signed in (the house's own admit), their studio opens.
  app.get('/added/:token', (req, res) => {
    res.set('Cache-Control', 'private, no-store'); res.set('X-Robots-Tag', 'noindex');
    const g = /^[\w-]{16,40}$/.test(req.params.token) ? db.prepare('SELECT * FROM delivery_guests WHERE token=?').get(String(req.params.token)) : null;
    const old = g && !g.proven_at && msAgo(g.created_at) > LIM.linkDays * 864e5;
    if (!g || old) return res.status(410).send(V.layout({ title: 'This link has run out · Watermark', bare: true, body: `<main class="dv gad"><section class="gad-c"><h1>This link has run out.</h1><p class="dv-lede">Open the album again and add your photographs once more; a fresh letter will come.</p><p><a class="buy-btn" href="/signin">Sign in</a></p></section></main>` }));
    const d = db.prepare('SELECT * FROM deliveries WHERE id=?').get(g.delivery_id);
    const fresh = !g.proven_at;
    if (fresh) db.prepare("UPDATE delivery_guests SET proven_at=datetime('now') WHERE id=? AND proven_at IS NULL").run(g.id);
    app.locals.admit(req, res, g.email, 'a link'); // proves the address: an unproven studio becomes its owner's
    if (fresh && d) { const n = Number(db.prepare("SELECT COUNT(*) n FROM delivery_guest_works WHERE guest_id=? AND state='waiting'").get(g.id).n); if (n) tellHost(d, g, n); }
    const m = d ? makerById(d.maker_id) : null;
    res.redirect('/account?ok=' + encodeURIComponent(`Your photographs are in your studio, private and yours.${d && m ? ` ${first(m.name)} will choose which ${d.title} shows, credited to you.` : ''}`));
  });

  // ---------- the photographer's look ----------
  function desk(d) {
    const rows = db.prepare(`SELECT ${COLS}, w.attribution, gu.name AS guest_name, gu.proven_at FROM delivery_guest_works g JOIN works w ON w.id=g.work_id JOIN delivery_guests gu ON gu.id=g.guest_id WHERE g.delivery_id=? AND g.state IN ('waiting','in','no') ORDER BY g.guest_id, w.id LIMIT 2000`).all(d.id);
    const unproven = rows.filter(r => !r.proven_at && r.state === 'waiting').length;
    const seen = rows.filter(r => r.proven_at); if (!seen.length && !unproven) return '';
    const by = new Map(); for (const r of seen) { if (!by.has(r.guest_id)) by.set(r.guest_id, []); by.get(r.guest_id).push(r); }
    const waiting = seen.filter(r => r.state === 'waiting').length, shown = seen.filter(r => r.state === 'in').length;
    const act = (r, a, word, cls = 'link') => `<form method="post" action="/account/deliveries/${d.id}/guests"><input type="hidden" name="work" value="${esc(r.slug)}"><button class="${cls}" name="act" value="${a}">${word}</button></form>`;
    return `<h2 class="dvd-h2" id="guests">From the guests <span>${waiting} to look at · ${shown} shown</span></h2>
<p class="dvd-l">Pictures the group took. They stay theirs; you choose which the album shows, below your own, credited to them.${unproven ? ` ${unproven === 1 ? 'One more waits' : `${unproven} more wait`} for the sender to confirm their email.` : ''}</p>
${[...by.values()].map(list => { const g = list[0]; const wait = list.filter(r => r.state === 'waiting'); return `<section class="gad-g"><header class="gad-gh"><b>Added by ${esc(g.guest_name)}</b>${wait.length > 1 ? `<form method="post" action="/account/deliveries/${d.id}/guests"><input type="hidden" name="guest" value="${g.guest_id}"><button class="buy-btn" name="act" value="all">Show all ${wait.length}</button></form>` : ''}</header>
<div class="gad-ws">${list.sort(D.byTaken).map(r => { const k = kindOf(r), look = readOf(r); return `<figure class="gad-w gad-${esc(r.state)}" data-gad-slug="${esc(r.slug)}"><img src="/img/${esc(r.slug)}/thumb" alt="${esc(tidy(r.title))}" loading="lazy"><figcaption><span>${esc(k.say)}${look === 'child' ? ' · <b>a child, likely: look before you show it</b>' : look === 'unread' ? ' · not yet read by the house: look yourself' : ''}</span>${r.state === 'waiting' ? `<span class="gad-acts">${act(r, 'yes', 'Show', 'buy-btn')}${act(r, 'no', 'Not this one')}</span>` : r.state === 'in' ? `<span class="gad-acts"><em>Shown</em>${act(r, 'no', 'Take out')}</span>` : `<span class="gad-acts"><em>Not shown</em>${act(r, 'yes', 'Show after all')}</span>`}</figcaption></figure>`; }).join('')}</div></section>`; }).join('')}`;
  }
  // Show: a licence of the guest's own work, under the guest's own use 'delivery', to the album (so every file leaves
  // with the guest's name, the copyright and a number inside it); it ends with the album. Not shown: nothing is granted.
  function show(d, gw) {
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(gw.work_id); if (!w || w.status === 'quarantined') return false;
    const u = q.use.get(w.maker_id, 'delivery'); if (!u) return false;
    let ref = gw.ref; const l = ref ? db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref) : null;
    if (!l || l.status !== 'active' || (l.ends_at && new Date(l.ends_at) < new Date())) {
      ref = nextRef();
      db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,intended_use,price_cents,status) VALUES (?,?,?,?,?,?,NULL,'requested')").run(ref, w.id, u.id, d.client_name, '', `Shown in: ${d.title}`.slice(0, 400));
      grant(ref, { paid: false });
      if (d.expires_at) db.prepare('UPDATE licenses SET ends_at=? WHERE ref=?').run(d.expires_at, ref);
    }
    db.prepare("UPDATE delivery_guest_works SET state='in', ref=?, decided_at=datetime('now') WHERE delivery_id=? AND work_id=?").run(ref, d.id, w.id);
    return true;
  }
  function takeOut(d, gw, state) {
    if (gw.ref) db.prepare("UPDATE licenses SET ends_at=?, updated_at=datetime('now') WHERE ref=? AND status='active'").run(new Date(Date.now() - 1000).toISOString(), gw.ref);
    db.prepare("UPDATE delivery_guest_works SET state=?, decided_at=datetime('now') WHERE delivery_id=? AND work_id=?").run(state, d.id, gw.work_id);
    db.prepare('DELETE FROM delivery_hearts WHERE delivery_id=? AND work_id=?').run(d.id, gw.work_id);
  }
  app.post('/account/deliveries/:id/guests', (req, res) => {
    const m = D.makerOf(req); if (!m) return res.sendStatus(401);
    const d = db.prepare('SELECT * FROM deliveries WHERE id=? AND maker_id=?').get(+req.params.id, m.id); if (!d) return res.sendStatus(404);
    const x = req.body || {}; const back = msg => res.redirect(`/account/deliveries/${d.id}?ok=${encodeURIComponent(msg)}#guests`);
    const proven = 'AND guest_id IN (SELECT id FROM delivery_guests WHERE proven_at IS NOT NULL)';
    if (x.act === 'all') {
      if (!D.live(d)) return back('This album is closed.');
      const list = db.prepare(`SELECT * FROM delivery_guest_works WHERE delivery_id=? AND guest_id=? AND state='waiting' ${proven} LIMIT 2000`).all(d.id, +x.guest || 0);
      let n = 0; for (const gw of list) if (show(d, gw)) n++;
      return back(n ? `${n} shown in the album.` : 'Nothing waiting.');
    }
    const w = db.prepare('SELECT id, title FROM works WHERE slug=?').get(String(x.work || '')); if (!w) return res.sendStatus(404);
    const gw = db.prepare(`SELECT * FROM delivery_guest_works WHERE delivery_id=? AND work_id=? AND state IN ('waiting','in','no') ${proven}`).get(d.id, w.id); if (!gw) return res.sendStatus(404);
    if (x.act === 'yes') { if (!D.live(d)) return back('This album is closed.'); return back(show(d, gw) ? `${tidy(w.title)} is shown in the album.` : 'That could not be shown.'); }
    if (x.act === 'no') { takeOut(d, gw, 'no'); return back(`${tidy(w.title)} is not shown. It stays theirs.`); }
    res.sendStatus(400);
  });

  // ---------- the guest's own studio ----------
  // Every album a work of theirs is shared with, for the works on the page (one question).
  function sharedOf(ids) {
    const out = {}; ids = (ids || []).map(Number).filter(Boolean).slice(0, 500); if (!ids.length) return out;
    db.prepare(`SELECT g.work_id, g.state, d.id AS did, d.title, w.width, w.height, w.camera, m.name AS by_name FROM delivery_guest_works g JOIN deliveries d ON d.id=g.delivery_id JOIN works w ON w.id=g.work_id JOIN makers m ON m.id=d.maker_id WHERE g.work_id IN (${ids.map(() => '?').join(',')}) AND g.state IN ('waiting','in','no') LIMIT 2000`).all(...ids)
      .forEach(r => { (out[r.work_id] = out[r.work_id] || []).push(r); });
    return out;
  }
  const studioLine = (w, list) => (list || []).map(r => `<small class="gad-sh">${esc(kindOf(r).say)} · Shared with ${esc(r.title)}${r.state === 'in' ? '' : r.state === 'no' ? `, not shown by ${esc(first(r.by_name))}` : `, waiting for ${esc(first(r.by_name))}`} <form method="post" action="/account/shared/out"><input type="hidden" name="work" value="${esc(w.slug)}"><input type="hidden" name="album" value="${r.did}"><button class="link">Take it out of the album</button></form></small>`).join('');
  app.post('/account/shared/out', (req, res) => {
    const me = D.makerOf(req); if (!me) return res.sendStatus(401);
    const x = req.body || {}; const w = db.prepare('SELECT id, slug, title, maker_id FROM works WHERE slug=?').get(String(x.work || '')); if (!w || w.maker_id !== me.id) return res.sendStatus(404);
    const d = db.prepare('SELECT * FROM deliveries WHERE id=?').get(+x.album || 0); const gw = d && db.prepare('SELECT * FROM delivery_guest_works WHERE delivery_id=? AND work_id=?').get(d.id, w.id); if (!gw) return res.sendStatus(404);
    takeOut(d, gw, 'out');
    res.redirect('/account?ok=' + encodeURIComponent(`${tidy(w.title)} is out of ${d.title}. It stays in your studio.`) + `#w-${w.slug}`);
  });

  // ---------- in the album ----------
  // Their own part, below the photographer's: a tighter grid, each credited by first name; their own walk in Wander.
  const walkOf = (d, view) => `/wander?in=${view ? 'album' : 'delivery'}:${encodeURIComponent((view ? D.shareOf(d) : d.token) + '.guests')}`;
  function section(d, can, view, hearts) {
    const ws = shownOf(d); const base = baseOf(d, view); const m = makerById(d.maker_id);
    if (!ws.length && !can.add) return '';
    const walk = walkOf(d, view);
    const by = new Map(); for (const w of ws) { if (!by.has(w.guest_id)) by.set(w.guest_id, []); by.get(w.guest_id).push(w); }
    const fig = w => { const nm = esc(tidy(w.title)), who = esc(first(w.guest_name)); return `<figure class="dv-w gad-fw" id="p-${esc(w.slug)}" data-dv-slug="${esc(w.slug)}"${hearts.has(w.id) ? ' data-hearted' : ''}><a href="${walk}&amp;at=${esc(w.slug)}" class="dv-im" data-dvo><img src="/img/${esc(w.slug)}/screen" alt="${nm}, by ${who}" loading="lazy" decoding="async"${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}></a><span class="gad-by">${who}</span><button type="button" class="dvh-b" data-dvh="${esc(w.slug)}" aria-pressed="${hearts.has(w.id)}" aria-label="Favourite" title="Favourite">${D.HEART}</button><figcaption><b>${nm}</b><i>by ${esc(w.guest_name)}</i>
<span class="dvx">${can.download ? `<a class="dvx-b" href="${base}/${esc(w.slug)}/file" download>${I.in || ''}<span>Download</span></a>` : ''}${can.social ? `<button type="button" class="dvx-b" data-dvx="share">${I.share || ''}<span>Share</span></button>` : ''}</span>
${can.social ? `<span class="dvx-sh" data-dvx-p="share" hidden><button type="button" class="dvx-o" data-dv-story="${base}/${esc(w.slug)}/post.jpg" data-dv-story-name="${nm}" data-dv-story-kind="post"><b>Post</b><i>For a feed, 4:5, credited to ${who}</i></button><button type="button" class="dvx-o" data-dv-story="${base}/${esc(w.slug)}/story.jpg" data-dv-story-name="${nm}" data-dv-story-kind="story"><b>Story</b><i>Full height, 9:16, credited to ${who}</i></button></span>` : ''}</figcaption></figure>`; };
    return `<section class="gad-s" id="guests"><p class="k">From the guests</p><h2>${ws.length ? 'The night, as the guests saw it.' : 'Were you there too?'}</h2><p class="gad-l">${ws.length ? `Pictures the group took, each credited to whoever took it.${ws.length > 1 ? ` <a href="${walk}">Wander through them</a>.` : ''}` : `Add the pictures you took. ${esc(first(m.name))} chooses what the album shows, credited to you.`}</p>
${can.add ? `<p class="gad-add"><a class="buy-btn" href="${base}/add">${I.plus || ''}<span>Add your photographs</span></a></p>` : ''}
${[...by.values()].map(list => `<div class="gad-one"><h3>From ${esc(first(list[0].guest_name))} <span>${list.length}</span></h3><div class="dv-grid gad-grid">${list.map(fig).join('')}</div></div>`).join('')}</section>`;
  }

  // ---------- who may see a guest's picture ----------
  // A guest's picture not yet shown is the guest's alone (and the photographer's, to decide); once shown in an album
  // behind the open door it is seen as that album's own pictures are; behind a private door, only by the people inside.
  const isGuestWork = workId => !!db.prepare('SELECT 1 FROM delivery_guest_works WHERE work_id=? LIMIT 1').get(workId);
  const openShown = workId => !!db.prepare("SELECT 1 FROM delivery_guest_works g JOIN deliveries d ON d.id=g.delivery_id JOIN delivery_guests gu ON gu.id=g.guest_id WHERE g.work_id=? AND g.state='in' AND gu.proven_at IS NOT NULL AND d.door='link' AND d.status='open' LIMIT 1").get(workId);
  const guarded = workId => isGuestWork(workId) && !openShown(workId);
  function mayView(req, w, tokens, email) {
    const me = D.makerOf(req);
    if (me && db.prepare("SELECT 1 FROM delivery_guest_works g JOIN deliveries d ON d.id=g.delivery_id WHERE g.work_id=? AND d.maker_id=? AND g.state IN ('waiting','in','no') LIMIT 1").get(w.id, me.id)) return true; // the album's photographer, deciding
    const shownIn = "g.work_id=? AND g.state='in' AND d.status='open' AND gu.proven_at IS NOT NULL";
    if (tokens.length && db.prepare(`SELECT 1 FROM delivery_members mm JOIN delivery_guest_works g ON g.delivery_id=mm.delivery_id JOIN deliveries d ON d.id=g.delivery_id JOIN delivery_guests gu ON gu.id=g.guest_id WHERE ${shownIn} AND mm.status='in' AND mm.token IN (${tokens.map(() => '?').join(',')}) LIMIT 1`).get(w.id, ...tokens)) return true;
    if (email && db.prepare(`SELECT 1 FROM delivery_members mm JOIN delivery_guest_works g ON g.delivery_id=mm.delivery_id JOIN deliveries d ON d.id=g.delivery_id JOIN delivery_guests gu ON gu.id=g.guest_id WHERE ${shownIn} AND mm.status='in' AND lower(mm.email)=? LIMIT 1`).get(w.id, email)) return true;
    return false;
  }

  return { LIM, AGREE, SAY, kindOf, shownOf, shownOne, desk, section, sharedOf, studioLine, guarded, isGuestWork, mayView, walkOf };
}
module.exports = { mountAlbumGuests, LIM, AGREE };
