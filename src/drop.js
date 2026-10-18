// Bring a photograph home (Will, 18 Oct: drop in a Watermark image and it is read, referenced and added to your
// gallery when you hold the rights; collectors can add what they were given by people able to give it).
// /yours/add takes any file that left the house (or a .wmark). Its papers are read the way /verify reads them:
// the bytes, the record written into the file, or the mark within the picture lead to the license it left under.
//   yours already                   → say so, and show where it hangs;
//   yours by email on another door  → it joins this gallery (the same person, signed in elsewhere);
//   held by someone else, may pass  → ask them to pass it on: they are told and answer with one tap (/pass/:token);
//                                     a yes moves it here with a fresh key and a transfer on the register;
//   held by someone else, may not   → it stays theirs; collect your own;
//   a photograph with no license    → this is <title>: collect it to hold it;
//   unknown                          → nothing held here matches.
// Nothing moves without the holder's say, so a copy found in the world never becomes a claim on its own.
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { nanoid } = require('nanoid');

function mountDrop(app, { db, C, V, mail, ledger, buyerOf, setBuyer, mk }) {
  db.exec(`CREATE TABLE IF NOT EXISTS pass_requests (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, from_buyer INTEGER NOT NULL, holder_buyer INTEGER NOT NULL, token TEXT UNIQUE NOT NULL,
    note TEXT, status TEXT NOT NULL DEFAULT 'asked', at TEXT NOT NULL DEFAULT (datetime('now')), answered_at TEXT)`);
  const take = multer({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: 120 * 1024 * 1024, files: 1 } });
  const esc = V.esc, tidy = V.tidy;
  const tell = x => { try { if (app.locals.notify) app.locals.notify.tell(x).catch(() => {}); } catch (e) { /* quiet */ } };
  const work = id => (id ? db.prepare('SELECT * FROM works WHERE id=?').get(id) : null);
  const buyer = id => (id ? db.prepare('SELECT * FROM buyers WHERE id=?').get(id) : null);
  const same = (a, b) => !!(a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase());
  const plate = w => (w ? `<a class="dr-pl" href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}"><span><b>${esc(tidy(w.title))}</b><small>${esc(w.accession || '')}${mk(w) ? ` · ${esc(mk(w).name)}` : ''}</small></span></a>` : '');
  const page = (title, inner) => V.layout({ title: `${title} · Watermark`, path: '/yours/add', body: `<section class="narrow dr">${inner}</section>` });
  const form = (lede = '') => `<p class="k">Your gallery</p><h1>Bring a photograph home.</h1>
<p class="lede">${lede || 'Drop in a photograph that came from Watermark. The house reads the papers it carries and, when it is yours to hold, hangs it in your gallery. A file given to you by its holder can come home the same way.'}</p>
<form method="post" action="/yours/add" enctype="multipart/form-data" class="dr-f" data-dr>
<label class="dr-zone" data-dr-zone><input type="file" name="file" accept="image/*,.wmark,application/zip" required><span class="dr-in"><b>Drop the file here</b><small>or choose it. A photograph from Watermark, or its archive (.wmark).</small></span></label>
<button class="btn">Read its papers</button></form>
<p class="dr-n">Nothing you drop is kept. The house reads it, answers, and lets it go.</p>
<script>(function(){var f=document.querySelector('[data-dr]'),z=document.querySelector('[data-dr-zone]');if(!f||!z)return;var i=z.querySelector('input');['dragenter','dragover'].forEach(function(t){z.addEventListener(t,function(e){e.preventDefault();z.classList.add('on')})});['dragleave','drop'].forEach(function(t){z.addEventListener(t,function(e){e.preventDefault();z.classList.remove('on')})});z.addEventListener('drop',function(e){if(e.dataTransfer.files.length){i.files=e.dataTransfer.files;f.submit()}});i.addEventListener('change',function(){if(i.files.length)f.submit()})})();</script>`;

  app.get('/yours/add', (req, res) => {
    if (!buyerOf(req)) return res.redirect('/signin?next=' + encodeURIComponent('/yours/add'));
    res.send(page('Bring a photograph home', form()));
  });

  // What the dropped file is, and what this visitor may do with it.
  async function read(buf, name) {
    const r = await app.locals.archive.verifyBuffer(buf, name);
    let l = null;
    if (r.trace && r.trace.license_id) l = db.prepare('SELECT * FROM licenses WHERE id=?').get(r.trace.license_id);
    else if (r.trace && r.trace.ref) l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(r.trace.ref);
    if (!l && r.kind === 'wmark' && r.m && r.m.license) l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(String(r.m.license));
    return { r, l, w: (l && work(l.work_id)) || r.w || null };
  }
  app.post('/yours/add', (req, res, next) => take.single('file')(req, res, e => (e ? res.send(page('Bring a photograph home', form('That file could not be taken. A photograph or a .wmark archive, up to 120 MB.'))) : next())), async (req, res) => {
    const me = buyerOf(req); if (!me) return res.redirect('/signin?next=' + encodeURIComponent('/yours/add'));
    if (!req.file) return res.redirect('/yours/add');
    let buf; try { buf = fs.readFileSync(req.file.path); } finally { fs.unlink(req.file.path, () => {}); }
    let got; try { got = await read(buf, req.file.originalname); } catch (e) { return res.send(page('Bring a photograph home', form('That file could not be read. Try the photograph exactly as Watermark delivered it.'))); }
    const { r, l, w } = got;
    if (!w) return res.send(page('Unknown to the house', `<p class="k">Your gallery</p><h1>Unknown to the house.</h1><p class="lede">Nothing held here matches this file. If it came from Watermark, try the file exactly as it was delivered: a screenshot or a heavy crop loses its papers.</p><p><a class="btn" href="/yours/add">Try another</a></p>`));
    if (!l) return res.send(page(tidy(w.title), `<p class="k">Your gallery</p><h1>This is ${esc(tidy(w.title))}.</h1><p class="lede">${esc(r.say || '')} It carries no license of its own, so there is nothing here to bring home. Collect it to hold it.</p>${plate(w)}<p><a class="btn" href="/w/${esc(w.slug)}">See it, and collect it</a></p>`));
    const status = l.status === 'active';
    if (l.buyer_id === me.id) return res.send(page('Already yours', `<p class="k">Your gallery</p><h1>Already yours.</h1><p class="lede">${esc(tidy(w.title))}${l.collector_no ? `, No.&nbsp;${l.collector_no},` : ''} hangs in your gallery under license ${esc(l.ref)}.</p>${plate(w)}<p><a class="btn" href="/yours">Go to your gallery</a> <a class="link" href="/c/${esc(l.ref)}">The license</a></p>`));
    const holder = buyer(l.buyer_id);
    // The same person on another door: the license's email, or its holder's, is the one signed in here.
    if (status && me.email && (same(me.email, l.licensee_email) || same(me.email, holder && holder.email))) {
      db.transaction(() => {
        db.prepare("INSERT INTO transfers (license_id, token, from_buyer, to_buyer, claimed_at) VALUES (?,?,?,?,datetime('now'))").run(l.id, nanoid(24), l.buyer_id || me.id, me.id);
        db.prepare("UPDATE licenses SET buyer_id=?, updated_at=datetime('now') WHERE id=?").run(me.id, l.id);
      })();
      ledger.append(db, 'license.transferred', l.ref, { work: w.slug, collector_no: l.collector_no || null, how: 'gathered' });
      return res.send(page('Brought home', `<p class="k">Your gallery</p><h1>Brought home.</h1><p class="lede">${esc(tidy(w.title))}${l.collector_no ? `, No.&nbsp;${l.collector_no},` : ''} was licensed to ${esc(me.email)}. It hangs in this gallery now, with its license and its file.</p>${plate(w)}<p><a class="btn" href="/yours">See it in your gallery</a></p>`));
    }
    if (!status) return res.send(page(tidy(w.title), `<p class="k">Your gallery</p><h1>This license has ended.</h1><p class="lede">${esc(tidy(w.title))} left the house under license ${esc(l.ref)}, which is no longer in force. Collect it to hold it.</p>${plate(w)}<p><a class="btn" href="/w/${esc(w.slug)}">See it</a></p>`));
    const passable = app.locals.canTransfer && app.locals.canTransfer(l) && !!l.collector_no;
    if (!passable) return res.send(page(tidy(w.title), `<p class="k">Your gallery</p><h1>Held by someone else.</h1><p class="lede">This copy of ${esc(tidy(w.title))} belongs to a license held by ${esc(l.licensee_company || 'another collector')}. Its terms do not let it pass on, so it cannot hang in your gallery. You can collect your own.</p>${plate(w)}<p><a class="btn" href="/w/${esc(w.slug)}">Collect your own</a></p>`));
    const open = db.prepare("SELECT * FROM pass_requests WHERE license_id=? AND from_buyer=? AND status='asked'").get(l.id, me.id);
    res.send(page(tidy(w.title), `<p class="k">Your gallery</p><h1>${esc(tidy(w.title))}, No.&nbsp;${l.collector_no}.</h1>
<p class="lede">This piece is held in another collector's gallery. If they gave it to you, ask them to pass it on: they are told, and with one tap it moves to your gallery with its own file and license, recorded on the register.</p>${plate(w)}
${open ? '<p class="ok">You have asked. The holder has been told.</p>' : `<form method="post" action="/yours/add/ask" class="form dr-ask"><input type="hidden" name="ref" value="${esc(l.ref)}"><label>A word for them <small>(optional)</small><input name="note" maxlength="200" placeholder="It was a gift from you, at the opening."></label><button class="btn">Ask them to pass it on</button></form>`}`));
  });

  app.post('/yours/add/ask', (req, res) => {
    const me = buyerOf(req), b = req.body || {}; if (!me) return res.redirect('/signin?next=/yours/add');
    const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(String(b.ref || ''));
    if (!l || l.status !== 'active' || l.buyer_id === me.id || !l.collector_no || !(app.locals.canTransfer && app.locals.canTransfer(l))) return res.redirect('/yours/add');
    const w = work(l.work_id), holder = buyer(l.buyer_id);
    let pr = db.prepare("SELECT * FROM pass_requests WHERE license_id=? AND from_buyer=? AND status='asked'").get(l.id, me.id);
    if (!pr) {
      const token = nanoid(28);
      db.prepare('INSERT INTO pass_requests (license_id, from_buyer, holder_buyer, token, note) VALUES (?,?,?,?,?)').run(l.id, me.id, l.buyer_id, token, String(b.note || '').trim().slice(0, 200) || null);
      pr = db.prepare('SELECT * FROM pass_requests WHERE token=?').get(token);
      ledger.append(db, 'license.pass.asked', l.ref, { work: w.slug, collector_no: l.collector_no });
      const who = me.name || 'A collector', link = `${C.base}/pass/${token}`;
      tell({ buyer_id: l.buyer_id, kind: 'asked', slug: w.slug, href: `/pass/${token}`, title: `${who} asks you to pass on ${tidy(w.title)}, No. ${l.collector_no}`, body: pr.note ? `“${pr.note}”` : 'Pass it on, or keep it.' });
      if (holder && holder.email) mail.send({ to: holder.email, subject: `${who} asks you to pass on ${tidy(w.title)}, No. ${l.collector_no}`, text: `${who} has a copy of ${tidy(w.title)}, No. ${l.collector_no}, from your gallery on Watermark, and asks you to pass the piece to them.${pr.note ? `\n\nThey write: “${pr.note}”` : ''}\n\nPass it on, or keep it: ${link}\n\nNothing moves unless you say so.`, cta: { label: 'Answer', url: link } });
    }
    res.redirect(`/yours/add/asked?ref=${encodeURIComponent(l.ref)}`);
  });
  app.get('/yours/add/asked', (req, res) => {
    const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(String(req.query.ref || '')); const w = l ? work(l.work_id) : null;
    res.send(page('Asked', `<p class="k">Your gallery</p><h1>Asked.</h1><p class="lede">The holder of ${w ? esc(tidy(w.title)) : 'the piece'} has been told. When they pass it on, it appears in your gallery and you are told.</p>${plate(w)}<p><a class="btn" href="/yours">Your gallery</a></p>`));
  });

  // The holder's answer: one tap to pass it on, or to keep it.
  const passOf = token => { const pr = db.prepare('SELECT * FROM pass_requests WHERE token=?').get(String(token)); if (!pr) return null; const l = db.prepare('SELECT * FROM licenses WHERE id=?').get(pr.license_id); return l ? { pr, l, w: work(l.work_id), from: buyer(pr.from_buyer) } : null; };
  app.get('/pass/:token', (req, res) => {
    const p = passOf(req.params.token); const me = buyerOf(req);
    if (!p) return res.status(404).send(page('Not found', '<h1>This request is not here.</h1><p><a href="/yours">Your gallery</a></p>'));
    if (!me || me.id !== p.l.buyer_id) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    const done = p.pr.status !== 'asked';
    res.send(page('Pass it on?', `<p class="k">From your gallery</p><h1>${done ? (p.pr.status === 'passed' ? 'Passed on.' : 'Kept.') : `Pass on ${esc(tidy(p.w.title))}, No.&nbsp;${p.l.collector_no}?`}</h1>
<p class="lede">${done ? 'Answered.' : `${esc((p.from && p.from.name) || 'A collector')} asks for it.${p.pr.note ? ` They write: “${esc(p.pr.note)}”` : ''} If you pass it on, it leaves your gallery and hangs in theirs, with its own file and license; the register records the transfer. If you keep it, nothing changes.`}</p>${plate(p.w)}
${done ? '' : `<form method="post" action="/pass/${esc(p.pr.token)}" class="dr-ans"><button class="btn" name="do" value="pass">Pass it on</button> <button class="link" name="do" value="keep">Keep it</button></form>`}`));
  });
  app.post('/pass/:token', (req, res) => {
    const p = passOf(req.params.token); const me = buyerOf(req);
    if (!p || !me || me.id !== p.l.buyer_id || p.pr.status !== 'asked') return res.redirect(`/pass/${encodeURIComponent(req.params.token)}`);
    if ((req.body || {}).do !== 'pass') {
      db.prepare("UPDATE pass_requests SET status='kept', answered_at=datetime('now') WHERE id=?").run(p.pr.id);
      ledger.append(db, 'license.pass.kept', p.l.ref, { work: p.w.slug });
      return res.redirect(`/pass/${encodeURIComponent(req.params.token)}`);
    }
    if (p.l.status !== 'active' || !(app.locals.canTransfer && app.locals.canTransfer(p.l)) || db.prepare("SELECT 1 FROM listings WHERE license_id=? AND status='open'").get(p.l.id)) return res.redirect(`/pass/${encodeURIComponent(req.params.token)}`);
    const to = p.from, token = nanoid(32);
    db.transaction(() => {
      db.prepare("INSERT INTO transfers (license_id, token, from_buyer, to_buyer, claimed_at) VALUES (?,?,?,?,datetime('now'))").run(p.l.id, nanoid(24), me.id, to.id);
      db.prepare("UPDATE licenses SET buyer_id=?, download_token=?, licensee_name=COALESCE(?, licensee_name), licensee_email=COALESCE(?, licensee_email), updated_at=datetime('now') WHERE id=?").run(to.id, token, to.name || null, to.email || null, p.l.id);
      db.prepare("UPDATE offers SET status='closed', closed_at=datetime('now') WHERE license_id=? AND status='open'").run(p.l.id);
      db.prepare("UPDATE pass_requests SET status='passed', answered_at=datetime('now') WHERE id=?").run(p.pr.id);
      db.prepare("UPDATE pass_requests SET status='kept', answered_at=datetime('now') WHERE license_id=? AND status='asked' AND id<>?").run(p.l.id, p.pr.id);
    })();
    ledger.append(db, 'license.transferred', p.l.ref, { work: p.w.slug, collector_no: p.l.collector_no, how: 'given', to: to.code || null });
    tell({ buyer_id: to.id, kind: 'received', slug: p.w.slug, href: '/yours', title: `${tidy(p.w.title)}, No. ${p.l.collector_no}, is yours`, body: `${me.name || 'Its holder'} passed it on. It hangs in your gallery now.` });
    if (to.email) mail.send({ to: to.email, subject: `Passed to you: ${tidy(p.w.title)}, No. ${p.l.collector_no}`, text: `${me.name || 'Its holder'} passed ${tidy(p.w.title)}, No. ${p.l.collector_no}, to you. It hangs in your gallery on Watermark now, with its file and its license.\n\n${C.base}/yours` });
    res.redirect(`/pass/${encodeURIComponent(req.params.token)}`);
  });
}
module.exports = { mountDrop };
