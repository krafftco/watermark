// Claims. When someone says a photograph here is theirs, or that they are in it without consent, the house has
// a procedure and keeps to it: the claim is taken in writing, under a statement of good faith; sales of the
// work pause at once (it stays on the wall while the house looks, since a bare claim is not a proof); the
// maker is told the same hour and answers in writing; the Studio weighs both against what the house holds
// (the arrival date, the fingerprint, the camera's record, Content Credentials, the Copyright Office line,
// the register) and decides: dismissed, and sales resume; or upheld, and the photograph comes down, its
// holders told. Every step is written to the register; only the decision is told in public, and the
// photograph's name is not. A claim is a notice under 17 U.S.C. §512 where that applies; the house's agent
// is the house address. Counsel should read this before the house relies on it.
const fs = require('fs');
const path = require('path');
const { layout, esc, date, setDeskPath } = require('./views');

const KINDS = { made: 'I made this photograph', owns: 'I hold the copyright in it', person: 'I am in it and did not consent', other: 'Something else' };
const STATUS = { open: 'Open', answered: 'Answered by the maker', upheld: 'Upheld; the photograph came down', dismissed: 'Dismissed; the photograph stands', withdrawn: 'Withdrawn' };
const caseNo = d => `WM-C-${String(d.id).padStart(4, '0')}`;

function mountDisputes(app, { db, C, mail, ledger, V, isStudio, makerOf, mk, shieldOf }) {
  db.exec(`CREATE TABLE IF NOT EXISTS disputes (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, company TEXT,
    body TEXT NOT NULL, links TEXT, file TEXT, oath INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', answer TEXT, answered_at TEXT, decision TEXT, decided_at TEXT, decided_by TEXT,
    ip TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS disputes_work ON disputes(work_id, status)`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name='disputed'").get()) db.exec('ALTER TABLE works ADD COLUMN disputed INTEGER NOT NULL DEFAULT 0');
  const dir = path.join(C.dataDir, 'claims'); fs.mkdirSync(dir, { recursive: true });
  const multer = require('multer');
  const upload = multer({ dest: dir, limits: { fileSize: 60 * 1024 * 1024, files: 1 } });

  const full = id => db.prepare('SELECT d.*, w.slug, w.title, w.maker_id, w.status AS work_status FROM disputes d JOIN works w ON w.id=d.work_id WHERE d.id=?').get(Number(id));
  const openOn = w => db.prepare("SELECT * FROM disputes WHERE work_id=? AND status IN ('open','answered') ORDER BY id DESC").all(w.id);
  const refresh = w => db.prepare("UPDATE works SET disputed=(SELECT COUNT(*) FROM disputes WHERE work_id=? AND status IN ('open','answered')) WHERE id=?").run(w.id, w.id);
  const holders = w => db.prepare("SELECT COUNT(*) n FROM licenses WHERE work_id=? AND status='active'").get(w.id).n;
  app.locals.disputes = { full, openOn, KINDS, STATUS, caseNo, waiting: makerId => db.prepare("SELECT COUNT(*) n FROM disputes d JOIN works w ON w.id=d.work_id WHERE w.maker_id=? AND d.status='open'").get(makerId).n,
    open: () => db.prepare("SELECT COUNT(*) n FROM disputes WHERE status IN ('open','answered')").get().n };

  // The door, on every work page: a claim in writing.
  app.get('/w/:slug/claim', (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(String(req.params.slug)); if (!w) return res.sendStatus(404);
    res.send(claimForm({ w, maker: mk(w), KINDS, err: req.query.err || null }));
  });
  app.post('/w/:slug/claim', (req, res, next) => upload.single('file')(req, res, e => (e ? res.redirect(`/w/${req.params.slug}/claim?err=file`) : next())), async (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(String(req.params.slug)); if (!w) return res.sendStatus(404);
    const b = req.body || {}, name = String(b.name || '').trim().slice(0, 120), email = String(b.email || '').trim().slice(0, 200), body = String(b.body || '').trim().slice(0, 6000);
    const kind = KINDS[b.kind] ? b.kind : 'other';
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || body.length < 20 || b.oath !== '1') return res.redirect(`/w/${w.slug}/claim?err=fields`);
    if (db.prepare("SELECT COUNT(*) n FROM disputes WHERE email=? AND at > datetime('now','-1 day')").get(email).n >= 3) return res.redirect(`/w/${w.slug}/claim?err=many`);
    const id = db.prepare('INSERT INTO disputes (work_id, kind, name, email, company, body, links, file, oath, ip) VALUES (?,?,?,?,?,?,?,?,1,?)')
      .run(w.id, kind, name, email, String(b.company || '').trim().slice(0, 160) || null, body, String(b.links || '').trim().slice(0, 2000) || null, req.file ? req.file.filename : null, req.ip || null).lastInsertRowid;
    refresh(w);
    const d = full(id), maker = mk(w);
    ledger.append(db, 'dispute.opened', w.slug, { claim: caseNo(d), kind });
    const base = C.base;
    mail.send({ to: email, subject: `Your claim ${caseNo(d)}, received`, text: `Thank you. Your claim about "${w.title}" is ${caseNo(d)}. Sales of the photograph are paused while the house looks at it. The maker has been told and asked to answer in writing. You will hear from the house within five working days.\n\nWhat you said: ${KINDS[kind]}.\n\nIf anything should be added, reply to this letter and quote the number.`, feature: 'A claim, received' });
    if (maker.email) mail.send({ to: maker.email, subject: `A claim about "${w.title}" (${caseNo(d)})`, text: `Someone has written to the house about "${w.title}": ${KINDS[kind]}. Sales are paused while the house looks. Please answer in writing within five days; what you say and what the house holds (the arrival, the fingerprint, the camera's record, the register) decide it.`, feature: 'A claim about your work', cta: { label: 'Answer the claim', url: `${base}/account/claims/${id}` } });
    mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `Claim ${caseNo(d)} on ${w.accession || w.slug}`, text: `${name} <${email}>: ${KINDS[kind]}.\n\n${body}\n\n${base}/studio/claims/${id}`, feature: 'A claim to decide', cta: { label: 'Open the file', url: `${base}/studio/claims/${id}` } });
    res.send(layout({ title: 'Claim received · Watermark', body: `<section class="narrow cl"><p class="k">Claims</p><h1>Received.</h1><p class="lede">Your claim is <b>${caseNo(d)}</b>. Sales of the photograph are paused while the house looks at it; the maker has been asked to answer in writing. You will hear from the house within five working days, at ${esc(email)}.</p><p class="sr-also"><a href="/w/${esc(w.slug)}">The photograph</a></p></section>` }));
  });

  // The maker's answer.
  const mine = (req, id) => { const d = full(id), m = makerOf(req); return d && m && d.maker_id === m.id ? d : null; };
  app.get('/account/claims', (req, res) => { const m = makerOf(req); if (!m) return res.redirect('/account'); res.send(claimsDesk({ rows: db.prepare('SELECT d.*, w.slug, w.title FROM disputes d JOIN works w ON w.id=d.work_id WHERE w.maker_id=? ORDER BY d.id DESC').all(m.id), base: '/account/claims', studio: false })); });
  app.get('/account/claims/:id', (req, res) => { const d = mine(req, req.params.id); if (!d) return res.sendStatus(404); res.send(claimPage({ d, packet: packet(d), base: '/account/claims', studio: false, ok: req.query.ok || null })); });
  app.post('/account/claims/:id/answer', (req, res) => {
    const d = mine(req, req.params.id); if (!d || !['open', 'answered'].includes(d.status)) return res.sendStatus(404);
    const answer = String((req.body || {}).answer || '').trim().slice(0, 6000); if (answer.length < 10) return res.redirect(`/account/claims/${d.id}?ok=short`);
    db.prepare("UPDATE disputes SET answer=?, answered_at=datetime('now'), status='answered' WHERE id=?").run(answer, d.id);
    ledger.append(db, 'dispute.answered', d.slug, { claim: caseNo(d) });
    mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `${caseNo(d)}: the maker has answered`, text: answer, cta: { label: 'Decide', url: `${C.base}/studio/claims/${d.id}` } });
    res.redirect(`/account/claims/${d.id}?ok=answered`);
  });

  // The Studio decides.
  app.get('/studio/claims', (req, res) => { if (!isStudio(req)) return res.redirect('/studio'); res.send(claimsDesk({ rows: db.prepare('SELECT d.*, w.slug, w.title FROM disputes d JOIN works w ON w.id=d.work_id ORDER BY CASE d.status WHEN \'answered\' THEN 0 WHEN \'open\' THEN 1 ELSE 2 END, d.id DESC').all(), base: '/studio/claims', studio: true })); });
  app.get('/studio/claims/:id', (req, res) => { if (!isStudio(req)) return res.redirect('/studio'); const d = full(req.params.id); if (!d) return res.sendStatus(404); res.send(claimPage({ d, packet: packet(d), base: '/studio/claims', studio: true, ok: req.query.ok || null })); });
  app.get('/studio/claims/:id/file', (req, res) => { if (!isStudio(req)) return res.redirect('/studio'); const d = full(req.params.id); if (!d || !d.file) return res.sendStatus(404); res.sendFile(path.join(dir, path.basename(d.file))); });
  app.post('/studio/claims/:id/decide', async (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio');
    const d = full(req.params.id); if (!d || !['open', 'answered'].includes(d.status)) return res.sendStatus(404);
    const b = req.body || {}, outcome = ['uphold', 'dismiss', 'withdraw'].includes(b.outcome) ? b.outcome : null, note = String(b.note || '').trim().slice(0, 4000);
    if (!outcome) return res.redirect(`/studio/claims/${d.id}`);
    const status = { uphold: 'upheld', dismiss: 'dismissed', withdraw: 'withdrawn' }[outcome];
    db.prepare("UPDATE disputes SET status=?, decision=?, decided_at=datetime('now'), decided_by='studio' WHERE id=?").run(status, note || null, d.id);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(d.work_id); refresh(w);
    const maker = mk(w);
    if (outcome === 'uphold') {
      db.prepare("UPDATE works SET status='private', disputed=0 WHERE id=?").run(w.id);
      ledger.append(db, 'dispute.upheld', w.slug, { claim: caseNo(d), kind: d.kind, holders: holders(w) });
      mail.send({ to: d.email, subject: `${caseNo(d)}: upheld`, text: `The house has looked at your claim about "${w.title}" and upheld it. The photograph has come down and is no longer offered.${note ? `\n\n${note}` : ''}` });
      if (maker.email) mail.send({ to: maker.email, subject: `${caseNo(d)}: the claim was upheld`, text: `The house has upheld the claim about "${w.title}". It has come down and is no longer offered; the record is kept.${note ? `\n\n${note}` : ''}\n\nIf you believe this is wrong, write to the house with what you hold.` });
    } else {
      ledger.append(db, outcome === 'dismiss' ? 'dispute.dismissed' : 'dispute.withdrawn', w.slug, { claim: caseNo(d) });
      mail.send({ to: d.email, subject: `${caseNo(d)}: ${status}`, text: outcome === 'dismiss' ? `The house has looked at your claim about "${w.title}" against what it holds (the record of its arrival, its fingerprint, the camera's record and the register) and has not upheld it. The photograph stands.${note ? `\n\n${note}` : ''}\n\nIf you hold evidence the house has not seen, reply with it and quote the number.` : `Your claim about "${w.title}" is recorded as withdrawn.` });
      if (maker.email) mail.send({ to: maker.email, subject: `${caseNo(d)}: settled`, text: `The claim about "${w.title}" was ${status}. Sales have resumed.${note ? `\n\n${note}` : ''}` });
    }
    res.redirect(`/studio/claims/${d.id}?ok=${status}`);
  });

  // What the house holds on the work: the packet a decision is made from.
  function packet(d) {
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(d.work_id), maker = mk(w), sh = shieldOf(w, maker);
    const arrived = db.prepare("SELECT at FROM ledger WHERE type='work.registered' AND subject=? ORDER BY seq LIMIT 1").get(w.slug);
    const firstSale = db.prepare("SELECT MIN(starts_at) at FROM licenses WHERE work_id=? AND status IN ('active','expired')").get(w.id).at;
    return [
      ['Maker of record', `${maker.name}${maker.joined_at ? `, in the house since ${date(maker.joined_at)}` : ''}`],
      ['Arrived', arrived ? `${date(arrived.at)}, register entry ${sh.seq || '—'}` : date(w.created_at)],
      ['Made', w.taken_at ? date(w.taken_at) : 'No date in the file'],
      ['Camera', [w.camera, w.lens].filter(Boolean).join(', ') || 'Not recorded'],
      ['Fingerprint', w.sha256 || '—'],
      ['Size held', w.width && w.height ? `${w.width} × ${w.height} px, ${sh.mp} MP${w.bytes ? `, ${(w.bytes / 1e6).toFixed(1)} MB` : ''}` : '—'],
      ['Content Credentials', sh.cred && !sh.cred.none ? `Arrived signed${sh.cred.issuer ? ` by ${sh.cred.issuer}` : ''}${sh.cred.captured ? ', in camera' : ''}` : 'None on arrival'],
      ['Copyright Office', sh.office && sh.office.line ? sh.office.line : w.copyright_reg ? `Registered, ${w.copyright_reg}` : 'Not registered through the house'],
      ['Fixity', sh.fixity && sh.fixity.at ? `${sh.fixity.ok === false ? 'FAILED' : 'Intact'}, checked ${date(sh.fixity.at)}` : 'Not yet checked'],
      ['Held by others', `${holders(w)} active license${holders(w) === 1 ? '' : 's'}${firstSale ? `, first ${date(firstSale)}` : ''}`],
      ['Shown', w.status === 'held' ? 'Public' : w.status],
    ];
  }
  return app.locals.disputes;
}

function claimForm({ w, maker, KINDS, err }) {
  const E = { fields: 'Your name, a working email address, what happened (at least a sentence) and the statement are all needed.', many: 'Three claims a day from one address is the limit. Write to the house instead.', file: 'The file could not be taken (60 MB at most).' }[err];
  return layout({ title: `A claim · ${w.title} · Watermark`, body: `<section class="narrow cl"><p class="k">Claims</p><h1>Say so in writing.</h1>
<p class="lede">If this photograph is yours, or you are in it and did not agree to be shown, tell the house here. Sales pause the moment a claim arrives; the maker is asked to answer; the house decides against what it holds (when the file arrived, its fingerprint, the camera's record, any Content Credentials, the Copyright Office) and writes to you within five working days. A false claim is a serious thing: the statement below is made under penalty of perjury where the law provides it.</p>
<p class="cl-work"><a href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt=""></a><span><b>${esc(w.title)}</b><br>${esc(maker.name)}${w.accession ? ` · ${esc(w.accession)}` : ''}</span></p>
${E ? `<p class="err">${esc(E)}</p>` : ''}
<form method="post" action="/w/${esc(w.slug)}/claim" enctype="multipart/form-data" class="cl-f">
<fieldset><legend>What you are saying</legend>${Object.entries(KINDS).map(([k, t], i) => `<label class="cl-k"><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</fieldset>
<label><span>Your name</span><input name="name" required maxlength="120" autocomplete="name"></label>
<label><span>Email</span><input name="email" type="email" required maxlength="200" autocomplete="email"></label>
<label><span>Company or representative, if any</span><input name="company" maxlength="160"></label>
<label><span>What happened, and how you know</span><textarea name="body" rows="6" required minlength="20" maxlength="6000" placeholder="When and where you made it, or how you came to hold the rights; what shows it is yours."></textarea></label>
<label><span>Where it can be seen (links, one a line)</span><textarea name="links" rows="2" maxlength="2000"></textarea></label>
<label><span>Your original, or other evidence (optional, 60 MB at most)</span><input type="file" name="file"></label>
<label class="cl-oath"><input type="checkbox" name="oath" value="1" required> I believe in good faith that what I have said is true and accurate; I am the person concerned, or the holder of the right, or authorized to act for them; and I understand that a knowing misstatement may make me liable.</label>
<button class="buy-btn">Send the claim</button></form>
<p class="note">The house's agent for notices is house@watermark.krafftco.com. Claims are kept with the work's record; the decision is written to the register without naming anyone.</p></section>` });
}

function claimsDesk({ rows, base, studio }) {
  setDeskPath(base);
  return layout({ title: 'Claims · Watermark', studio: true, body: `<section class="studio-wrap"><p class="k">${studio ? 'The house' : 'Your studio'}</p><h1>Claims.</h1>
<p class="lede">Every claim made about a photograph${studio ? ' in the house' : ' of yours'}, open ones first. Sales of a work pause while a claim is open; the record is kept whichever way it goes.</p>
${rows.length ? `<div class="tbl cl-tbl">${rows.map(d => `<a class="tbl-r" href="${base}/${d.id}"><img src="/img/${esc(d.slug)}/thumb" alt=""><span><b>${esc(d.title)}</b><small>${caseNo(d)} · ${esc(KINDS[d.kind] || d.kind)}</small></span><span>${esc(d.name)}</span><span>${date(d.at)}</span><span class="cl-st cl-${d.status}">${esc(STATUS[d.status] || d.status)}</span></a>`).join('')}</div>` : '<p class="nt-0">No claims. Good.</p>'}</section>` });
}

function claimPage({ d, packet, base, studio, ok }) {
  setDeskPath(base);
  const notice = { answered: 'Your answer is with the house.', short: 'Say a little more.', upheld: 'Upheld. The photograph has come down; both parties have been written to.', dismissed: 'Dismissed. Sales have resumed; both parties have been written to.', withdrawn: 'Recorded as withdrawn.' }[ok];
  const live = ['open', 'answered'].includes(d.status);
  return layout({ title: `${caseNo(d)} · Watermark`, studio: true, body: `<section class="studio-wrap cl-p"><p class="k"><a href="${base}">Claims</a> · ${caseNo(d)}</p><h1>${esc(d.title)}</h1>
<p class="cl-st cl-${d.status}">${esc(STATUS[d.status] || d.status)}${d.decided_at ? `, ${date(d.decided_at)}` : ''}</p>
${notice ? `<p class="${ok === 'short' ? 'err' : 'ok'}">${esc(notice)}</p>` : ''}
<div class="cl-cols"><div>
<h2>The claim</h2><dl class="lc2-dl"><div><dt>Says</dt><dd>${esc(KINDS[d.kind] || d.kind)}</dd></div><div><dt>From</dt><dd>${esc(d.name)}${d.company ? `, ${esc(d.company)}` : ''}${studio ? ` &lt;${esc(d.email)}&gt;` : ''}</dd></div><div><dt>Received</dt><dd>${date(d.at)}</dd></div>${d.links ? `<div><dt>Seen at</dt><dd>${esc(d.links).replace(/\n/g, '<br>')}</dd></div>` : ''}${d.file && studio ? `<div><dt>Evidence</dt><dd><a href="${base}/${d.id}/file">The file they sent</a></dd></div>` : ''}</dl>
<blockquote class="cl-q">${esc(d.body).replace(/\n/g, '<br>')}</blockquote>
<h2>The maker's answer</h2>${d.answer ? `<blockquote class="cl-q">${esc(d.answer).replace(/\n/g, '<br>')}</blockquote><p class="note">${date(d.answered_at)}</p>` : studio ? '<p class="note">Not yet answered.</p>' : ''}
${!studio && live ? `<form method="post" action="${base}/${d.id}/answer" class="cl-f"><label><span>${d.answer ? 'Add to your answer' : 'Your answer, in writing'}</span><textarea name="answer" rows="6" required minlength="10" maxlength="6000" placeholder="When and where you made it; what you hold (the raw file, the camera, the contact sheet); anything the house should know.">${esc(d.answer || '')}</textarea></label><button class="buy-btn">Send to the house</button></form>` : ''}
${d.decision ? `<h2>The decision</h2><blockquote class="cl-q">${esc(d.decision).replace(/\n/g, '<br>')}</blockquote>` : ''}
</div><aside>
<h2>What the house holds</h2><dl class="lc2-dl cl-pk">${packet.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>
<p class="note"><a href="/w/${esc(d.slug)}">The photograph</a> · <a href="/w/${esc(d.slug)}/life">Its life</a></p>
${studio && live ? `<form method="post" action="${base}/${d.id}/decide" class="cl-f cl-decide"><h2>Decide</h2><label><span>A word to both parties (optional)</span><textarea name="note" rows="3" maxlength="4000"></textarea></label><div class="cl-btns"><button class="buy-btn" name="outcome" value="dismiss">Dismiss: the photograph stands</button><button class="link cl-up" name="outcome" value="uphold" onclick="return confirm('Uphold the claim? The photograph comes down and both parties are written to.')">Uphold: take it down</button><button class="link" name="outcome" value="withdraw">Record as withdrawn</button></div></form>` : ''}
</aside></div></section>` });
}

module.exports = { mountDisputes, KINDS, STATUS, caseNo };
