// The loan desk (Will, 3 Nov: "allow museums to trade work with other museums"; built as what museums do every week:
// they lend). One museum asks another for a work for a show; the lender agrees with its terms or declines; the
// agreement is set out from the request and fingerprinted; the work is reported on at every handover (condition
// reports with a photograph: leaving, arrived, sent back, home); and when it is home the loan is written on the
// work's own record as its exhibition history (the register's `work.lent`), which is what adds to a work's life.
// Borrowers are institutions, companies and galleries (the Studio too); lenders are any maker, the work's own.
// Exchanges and deaccessions (title changing hands) are the plan's next step and counsel's, not this desk's.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const multer = require('multer');
const BORROWERS = ['institution', 'company', 'gallery'];
const STEPS = { asked: 'Asked', agreed: 'Agreed', declined: 'Declined', withdrawn: 'Withdrawn', out: 'With the borrower', back: 'On its way home', home: 'Home' };
const COVER = { wall: 'Wall-to-wall insurance by the borrower, at the agreed value', indemnity: 'The U.S. Arts and Artifacts Indemnity, with the borrower insuring the deductible', lender: 'The lender’s own policy, the borrower named, the premium the borrower’s' };

function mountLoans(app, { db, V, C, store, makerOf, isStudio, ledger }) {
  const { esc, tidy } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS loans (id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, work_id INTEGER NOT NULL, lender_id INTEGER NOT NULL, borrower_id INTEGER NOT NULL,
    show_title TEXT NOT NULL, venue TEXT, city TEXT, opens TEXT, closes TEXT, note TEXT, facility TEXT, status TEXT NOT NULL DEFAULT 'asked', cover TEXT, value_cents INTEGER, courier INTEGER NOT NULL DEFAULT 0,
    credit TEXT, word TEXT, agreement TEXT, agreement_hash TEXT, reports TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const dir = path.join(C.dataDir, 'loans'); fs.mkdirSync(dir, { recursive: true });
  const up = multer({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: 40 * 1024 * 1024 } });
  const J = (s, d) => { try { return JSON.parse(s || '') || d; } catch (e) { return d; } };
  const t = (v, n) => { const s = String(v == null ? '' : v).replace(/<[^>]*>/g, '').trim().slice(0, n); return s || null; };
  const ymd = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const maker = id => db.prepare('SELECT * FROM makers WHERE id=?').get(id);
  const work = id => db.prepare('SELECT id, slug, title, maker_id, width, height, medium, obj_dims, taken_at FROM works WHERE id=?').get(id);
  const may = m => !!m && BORROWERS.includes(m.kind);
  const tell = (maker_id, title, body, l) => { if (app.locals.notify && app.locals.notify.tell) { try { app.locals.notify.tell({ maker_id, kind: 'loan', title, body, href: `/account/loans/${l.id}` }); } catch (e) { /* */ } } };
  const nextRef = () => { const y = new Date().getFullYear(); const n = db.prepare("SELECT COUNT(*) n FROM loans WHERE ref LIKE ?").get(`LN-${y}-%`).n + 1; return `LN-${y}-${String(n).padStart(4, '0')}`; };
  const day = s => (s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
  const money = c => (c == null ? '' : '$' + Math.round(c / 100).toLocaleString('en-US'));

  // The agreement, set out from the request and the lender's terms. A draft for counsel.
  function agreement(l) {
    const w = work(l.work_id), L = maker(l.lender_id), B = maker(l.borrower_id);
    return [
      `Loan agreement ${l.ref}`,
      `The lender, ${L.name}, lends to the borrower, ${B.name}, the work “${tidy(w.title)}”${w.medium ? `, ${w.medium}` : ''}${w.obj_dims ? `, ${w.obj_dims}` : ''}, for the exhibition “${l.show_title}”${l.venue ? ` at ${l.venue}` : ''}${l.city ? `, ${l.city}` : ''}, from ${day(l.opens)} to ${day(l.closes)}.`,
      `Cover: ${COVER[l.cover] || COVER.wall}${l.value_cents ? `, at an agreed value of ${money(l.value_cents)}` : ''}, from the moment the work leaves the lender until it is home again ("nail to nail").`,
      `Care: the borrower keeps the work in the conditions of its facility report, does not clean, restore, frame, unframe or treat it, and tells the lender at once of any change in its condition.`,
      `Handling: the work travels by a carrier the lender approves${l.courier ? ', with a courier for the lender' : ''}, the costs the borrower’s. A condition report is made, with a photograph, as the work leaves, arrives, is sent back and comes home; each is kept on Watermark with this agreement.`,
      `Credit: wherever the work is shown or reproduced in connection with the exhibition, the credit reads: ${l.credit || `Lent by ${L.name}`}.`,
      `Images: photography of the work in the exhibition is for the borrower’s own record and press about the exhibition; any other reproduction is licensed by the lender.`,
      `Return: the work is returned by the end of the loan, unless both agree in writing to extend it. Either may end the loan if the other does not keep these terms.`,
      `This agreement is a draft set out by Watermark from the request and the lender’s terms. Both institutions should read it with their own counsel before the work moves.`,
    ].join('\n\n');
  }
  const side = (l, m) => (m && m.id === l.lender_id ? 'lender' : m && m.id === l.borrower_id ? 'borrower' : null);
  const loanOf = id => db.prepare('SELECT * FROM loans WHERE id=?').get(+id);

  // The work page: its exhibition history, and the door for a museum that would borrow it.
  function block(w, req) {
    if (!w) return '';
    const past = db.prepare("SELECT l.*, b.name AS borrower FROM loans l JOIN makers b ON b.id=l.borrower_id WHERE l.work_id=? AND l.status IN ('out','back','home') ORDER BY l.opens DESC").all(w.id);
    const me = req ? makerOf(req) : null;
    const door = me && may(me) && me.id !== w.maker_id ? `<p class="lnk-door"><a class="buy-btn" href="/account/loans/new?work=${encodeURIComponent(w.slug)}">Ask to borrow it for a show</a> <span>For ${esc(me.name)}: the request goes to the lender, with the papers set out for you both.</span></p>` : '';
    if (!past.length && !door) return '';
    return `<section class="lnk" id="exhibitions">${past.length ? `<p class="k">Exhibition history</p><ul class="lnk-h">${past.map(l => `<li><b>${esc((l.opens || '').slice(0, 4))}</b> “${esc(l.show_title)}”${l.venue ? `, ${esc(l.venue)}` : ''}${l.city ? `, ${esc(l.city)}` : ''}<span>Lent to ${esc(l.borrower)}${l.status !== 'home' ? ' · on loan now' : ''}</span></li>`).join('')}</ul>` : ''}${door}</section>`;
  }

  // Ask.
  app.get('/account/loans/new', (req, res) => {
    const me = makerOf(req); if (!me) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    if (!may(me)) return res.redirect('/account/loans?ok=borrow-kind');
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(req.query.work || '')); if (!w || w.maker_id === me.id) return res.redirect('/account/loans');
    const L = maker(w.maker_id);
    res.send(V.layout({ title: 'Ask to borrow · Watermark', path: '/account/loans', body: `<section class="studio-wrap lnk-desk"><p class="k">The loan desk</p><h1>Ask to borrow “${esc(tidy(w.title))}”</h1>
<p class="lede">From ${esc(L.name)}. Say what the show is and when; the lender answers with its terms, and the agreement is set out for you both.</p>
<img class="lnk-pic" src="/img/${esc(w.slug)}/screen" alt="">
<form method="post" action="/account/loans" class="lnk-f"><input type="hidden" name="work" value="${esc(w.slug)}">
<label><span>The exhibition</span><input name="show" required maxlength="160" placeholder="Light and Water: the Dutch Interior"></label>
<label><span>Where</span><input name="venue" maxlength="160" placeholder="the museum or gallery"></label><label><span>City</span><input name="city" maxlength="80"></label>
<label><span>Opens</span><input type="date" name="opens" required></label><label><span>Closes</span><input type="date" name="closes" required></label>
<label class="lnk-w"><span>The facility</span><textarea name="facility" rows="3" maxlength="1200" placeholder="Climate (temperature and humidity held), light levels, security, fire suppression; or attach your standard facility report by letter"></textarea></label>
<label class="lnk-w"><span>A word to the lender</span><textarea name="note" rows="3" maxlength="1200"></textarea></label>
<button class="buy-btn">Send the request</button></form></section>` }));
  });
  app.post('/account/loans', (req, res) => {
    const me = makerOf(req); if (!me) return res.sendStatus(401); if (!may(me)) return res.sendStatus(403);
    const b = req.body || {}; const w = db.prepare("SELECT * FROM works WHERE slug=? AND status='held'").get(String(b.work || ''));
    if (!w || w.maker_id === me.id) return res.redirect(303, '/account/loans');
    const opens = ymd(b.opens), closes = ymd(b.closes); const show = t(b.show, 160);
    if (!show || !opens || !closes || closes < opens) return res.redirect(303, `/account/loans/new?work=${encodeURIComponent(w.slug)}&ok=dates`);
    const ref = nextRef();
    const id = db.prepare('INSERT INTO loans (ref, work_id, lender_id, borrower_id, show_title, venue, city, opens, closes, note, facility) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(ref, w.id, w.maker_id, me.id, show, t(b.venue, 160), t(b.city, 80), opens, closes, t(b.note, 1200), t(b.facility, 1200)).lastInsertRowid;
    const l = loanOf(id);
    ledger.append(db, 'loan.asked', w.slug, { ref, borrower: me.handle });
    tell(w.maker_id, `${me.name} asks to borrow ${tidy(w.title)}`, `For “${show}”, ${day(opens)} to ${day(closes)}.`, l);
    res.redirect(303, `/account/loans/${id}`);
  });

  // The desk: in and out.
  app.get('/account/loans', (req, res) => {
    const me = makerOf(req); if (!me) return res.redirect('/signin?next=/account/loans');
    const rows = db.prepare('SELECT l.*, w.slug, w.title FROM loans l JOIN works w ON w.id=l.work_id WHERE l.lender_id=? OR l.borrower_id=? ORDER BY l.updated_at DESC').all(me.id, me.id);
    const row = l => { const other = maker(l.lender_id === me.id ? l.borrower_id : l.lender_id); return `<li><a href="/account/loans/${l.id}"><img src="/img/${esc(l.slug)}/thumb" alt=""><span><b>${esc(tidy(l.title))}</b><small>${l.lender_id === me.id ? 'To' : 'From'} ${esc(other ? other.name : '')} · “${esc(l.show_title)}” · ${esc(day(l.opens))}</small></span><em class="lnk-s lnk-${esc(l.status)}">${esc(STEPS[l.status] || l.status)}</em></a></li>`; };
    const lent = rows.filter(l => l.lender_id === me.id), asked = rows.filter(l => l.borrower_id === me.id);
    res.send(V.layout({ title: 'The loan desk · Watermark', path: '/account/loans', body: `<section class="studio-wrap lnk-desk"><p class="k">The loan desk</p><h1>Loans</h1>
<p class="lede">Lend and borrow work between museums: the request, the terms, the agreement, a condition report at every handover, and the loan written into the work’s history when it is home.${may(me) ? ' To borrow, open any work held by another institution and press Ask to borrow it.' : ''}</p>
${req.query.ok === 'borrow-kind' ? '<p class="ok">Borrowing is for institutions, companies and galleries; any maker may lend.</p>' : ''}
<h2>Asked of you</h2>${lent.length ? `<ul class="lnk-list">${lent.map(row).join('')}</ul>` : '<p class="note">No requests yet.</p>'}
<h2>Yours to borrow</h2>${asked.length ? `<ul class="lnk-list">${asked.map(row).join('')}</ul>` : '<p class="note">Nothing asked for yet.</p>'}</section>` }));
  });

  // One loan: the thread.
  app.get('/account/loans/:id', (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return next();
    const me = makerOf(req); const l = loanOf(req.params.id); if (!l) return res.sendStatus(404);
    const as = side(l, me); if (!as && !isStudio(req)) return res.sendStatus(403);
    const w = work(l.work_id), L = maker(l.lender_id), B = maker(l.borrower_id); const reports = J(l.reports, []);
    const report = (stage, label) => `<form method="post" action="/account/loans/${l.id}/step" enctype="multipart/form-data" class="lnk-f lnk-rep"><input type="hidden" name="do" value="${stage}"><label class="lnk-w"><span>Condition, as it ${label}</span><textarea name="condition" rows="3" maxlength="1200" required placeholder="Its state, any marks or changes, the frame and glazing"></textarea></label><label><span>A photograph</span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label><button class="buy-btn">${esc(label === 'leaves' ? 'It has left' : label === 'arrives' ? 'It has arrived' : label === 'is sent back' ? 'It is on its way home' : 'It is home')}</button></form>`;
    let acts = '';
    if (as === 'lender' && l.status === 'asked') acts = `<form method="post" action="/account/loans/${l.id}/step" class="lnk-f"><input type="hidden" name="do" value="agree"><label class="lnk-w"><span>Cover</span><select name="cover">${Object.entries(COVER).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label><span>Agreed value (private, USD)</span><input name="value" inputmode="numeric" placeholder="250000"></label><label><span>Credit line</span><input name="credit" maxlength="200" value="Lent by ${esc(L.name)}"></label><label class="lnk-chk"><input type="checkbox" name="courier" value="1"> A courier travels with it</label><button class="buy-btn">Agree to lend</button></form>
<form method="post" action="/account/loans/${l.id}/step" class="lnk-f"><input type="hidden" name="do" value="decline"><label class="lnk-w"><span>Or decline, with a word</span><input name="word" maxlength="400"></label><button class="link">Decline</button></form>`;
    else if (as === 'borrower' && ['asked', 'agreed'].includes(l.status)) acts = `<form method="post" action="/account/loans/${l.id}/step"><input type="hidden" name="do" value="withdraw"><button class="link">Withdraw the request</button></form>`;
    if (as === 'lender' && l.status === 'agreed') acts += report('left', 'leaves');
    if (as === 'borrower' && l.status === 'out' && !reports.some(r => r.stage === 'arrived')) acts += report('arrived', 'arrives');
    if (as === 'borrower' && l.status === 'out' && reports.some(r => r.stage === 'arrived')) acts += report('returned', 'is sent back');
    if (as === 'lender' && l.status === 'back') acts += report('home', 'comes home');
    res.send(V.layout({ title: `${l.ref} · The loan desk`, path: '/account/loans', body: `<section class="studio-wrap lnk-desk"><p class="k"><a href="/account/loans">The loan desk</a> · ${esc(l.ref)}</p><h1>“${esc(tidy(w.title))}” for “${esc(l.show_title)}”</h1>
<p class="lnk-st"><em class="lnk-s lnk-${esc(l.status)}">${esc(STEPS[l.status] || l.status)}</em> Lent by ${esc(L.name)} to ${esc(B.name)}${l.venue ? `, at ${esc(l.venue)}` : ''}${l.city ? `, ${esc(l.city)}` : ''}, ${esc(day(l.opens))} to ${esc(day(l.closes))}.</p>
<img class="lnk-pic" src="/img/${esc(w.slug)}/screen" alt="">
${l.note ? `<p><b>From the borrower:</b> ${esc(l.note)}</p>` : ''}${l.facility ? `<p><b>The facility:</b> ${esc(l.facility)}</p>` : ''}${l.word ? `<p><b>From the lender:</b> ${esc(l.word)}</p>` : ''}
${l.agreement ? `<details class="lnk-ag" open><summary>The agreement <small>fingerprint ${esc(String(l.agreement_hash).slice(0, 16))}</small></summary>${l.agreement.split('\n\n').map(p => `<p>${esc(p)}</p>`).join('')}</details>` : ''}
${reports.length ? `<h2>Condition reports</h2><ol class="lnk-reps">${reports.map((r, i) => `<li><b>${esc({ left: 'As it left', arrived: 'As it arrived', returned: 'As it was sent back', home: 'As it came home' }[r.stage] || r.stage)}</b> · ${esc(r.by)} · ${esc(String(r.at).slice(0, 10))}<p>${esc(r.condition)}</p>${r.photo ? `<img src="/account/loans/${l.id}/report/${i}" alt="" loading="lazy">` : ''}</li>`).join('')}</ol>` : ''}
${acts}</section>` }));
  });
  app.post('/account/loans/:id/step', up.single('photo'), (req, res, next) => (req.file ? app.locals.bagcheck.gate('image')(req, res, next) : next()), async (req, res) => {
    const me = makerOf(req); const l = loanOf(req.params.id); if (!l) return res.sendStatus(404);
    const as = side(l, me); if (!as) { if (req.file) fs.unlink(req.file.path, () => {}); return res.sendStatus(403); }
    const b = req.body || {}; const d = String(b.do || ''); const w = work(l.work_id); const L = maker(l.lender_id), B = maker(l.borrower_id);
    const go = (status, extra = {}) => { const cols = Object.keys(extra); db.prepare(`UPDATE loans SET status=?, ${cols.map(c => `${c}=?, `).join('')}updated_at=datetime('now') WHERE id=?`).run(status, ...cols.map(c => extra[c]), l.id); };
    const other = as === 'lender' ? B : L;
    const addReport = async stage => {
      const reports = J(l.reports, []); const r = { stage, by: me.name, at: new Date().toISOString(), condition: t(b.condition, 1200) || '' };
      if (req.file) { const key = `loans/${l.id}-${stage}-${crypto.randomBytes(4).toString('hex')}.jpg`; const local = path.join(C.dataDir, key); try { await require('sharp')(req.file.path).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(local); r.photo = key; try { await store.put(key, local, 'image/jpeg'); } catch (e) { /* */ } } catch (e) { /* not a picture */ } fs.unlink(req.file.path, () => {}); }
      reports.push(r); return JSON.stringify(reports);
    };
    if (as === 'lender' && l.status === 'asked' && d === 'agree') {
      const cover = COVER[b.cover] ? b.cover : 'wall'; const value = Math.round(Number(String(b.value || '').replace(/[^0-9.]/g, '')) * 100) || null;
      const terms = { ...l, cover, value_cents: value, courier: b.courier === '1' ? 1 : 0, credit: t(b.credit, 200) || `Lent by ${L.name}` };
      const text = agreement(terms);
      go('agreed', { cover, value_cents: value, courier: terms.courier, credit: terms.credit, agreement: text, agreement_hash: crypto.createHash('sha256').update(text).digest('hex') });
      ledger.append(db, 'loan.agreed', w.slug, { ref: l.ref });
      tell(B.id, `${L.name} agrees to lend ${tidy(w.title)}`, `For “${l.show_title}”. The agreement is set out.`, l);
    } else if (as === 'lender' && l.status === 'asked' && d === 'decline') {
      go('declined', { word: t(b.word, 400) }); ledger.append(db, 'loan.declined', w.slug, { ref: l.ref });
      tell(B.id, `${L.name} cannot lend ${tidy(w.title)}`, t(b.word, 120) || 'Declined.', l);
    } else if (as === 'borrower' && ['asked', 'agreed'].includes(l.status) && d === 'withdraw') {
      go('withdrawn'); ledger.append(db, 'loan.withdrawn', w.slug, { ref: l.ref }); tell(L.id, `${B.name} withdrew its request`, tidy(w.title), l);
    } else if (as === 'lender' && l.status === 'agreed' && d === 'left') {
      go('out', { reports: await addReport('left') }); ledger.append(db, 'loan.out', w.slug, { ref: l.ref }); tell(B.id, `${tidy(w.title)} has left ${L.name}`, 'The condition report is on the desk.', l);
    } else if (as === 'borrower' && l.status === 'out' && d === 'arrived') {
      db.prepare("UPDATE loans SET reports=?, updated_at=datetime('now') WHERE id=?").run(await addReport('arrived'), l.id); tell(L.id, `${tidy(w.title)} has arrived at ${B.name}`, 'The condition report is on the desk.', l);
    } else if (as === 'borrower' && l.status === 'out' && d === 'returned') {
      go('back', { reports: await addReport('returned') }); tell(L.id, `${tidy(w.title)} is on its way home`, 'The condition report is on the desk.', l);
    } else if (as === 'lender' && l.status === 'back' && d === 'home') {
      go('home', { reports: await addReport('home') });
      ledger.append(db, 'work.lent', w.slug, { ref: l.ref, lender: L.name, borrower: B.name, show: l.show_title, city: l.city || null, year: (l.opens || '').slice(0, 4) });
      tell(B.id, `${tidy(w.title)} is home at ${L.name}`, 'The loan is written into the work’s history.', l);
    } else if (req.file) fs.unlink(req.file.path, () => {});
    res.redirect(303, `/account/loans/${l.id}`);
  });
  app.get('/account/loans/:id/report/:i', async (req, res) => {
    const me = makerOf(req); const l = loanOf(req.params.id); if (!l) return res.sendStatus(404); if (!side(l, me) && !isStudio(req)) return res.sendStatus(403);
    const r = J(l.reports, [])[+req.params.i]; if (!r || !r.photo) return res.sendStatus(404);
    const local = path.join(C.dataDir, r.photo); if (!fs.existsSync(local) && store.get) { try { const buf = await store.get(r.photo); if (buf) fs.writeFileSync(local, buf); } catch (e) { /* */ } }
    if (!fs.existsSync(local)) return res.sendStatus(404);
    res.set('Cache-Control', 'private, no-store'); res.type('image/jpeg'); res.sendFile(local);
  });
  // The house sees every loan.
  app.get('/studio/loans', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const rows = db.prepare('SELECT l.*, w.title, a.name AS lender, b.name AS borrower FROM loans l JOIN works w ON w.id=l.work_id JOIN makers a ON a.id=l.lender_id JOIN makers b ON b.id=l.borrower_id ORDER BY l.updated_at DESC LIMIT 300').all();
    res.send(V.layout({ title: 'Loans · Studio', studio: true, path: '/studio/loans', body: `<section class="studio-wrap"><h1>Loans</h1><table class="tbl"><tr><th>Ref</th><th>Work</th><th>From</th><th>To</th><th>Show</th><th>Opens</th><th>State</th></tr>${rows.map(l => `<tr><td><a href="/account/loans/${l.id}">${esc(l.ref)}</a></td><td>${esc(tidy(l.title))}</td><td>${esc(l.lender)}</td><td>${esc(l.borrower)}</td><td>${esc(l.show_title)}</td><td>${esc(l.opens || '')}</td><td>${esc(STEPS[l.status] || l.status)}</td></tr>`).join('') || '<tr><td colspan="7">None yet.</td></tr>'}</table></section>` }));
  });
  app.locals.loans = { block, agreement, STEPS };
  return app.locals.loans;
}
module.exports = { mountLoans, STEPS };
