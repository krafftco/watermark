// The rights desk (Will, 20 Oct: "let's solve this for museums; let's become who they want to do their digital archives
// with, or have us help them integrate"). The way it works today at a great museum: a page of paragraphs that sends
// publication requests to one agency for North America and another for everywhere else, archival audio to a third
// address, film stills nowhere, text permissions to a fourth, and the Archives' own permission form as a PDF to be
// printed, signed, and posted or emailed, with the citation rules on page two. Weeks, by email, and nobody knows
// where a request is. The house's answer is one door per institution: /rights/<institution>. A work in the collection
// that the house holds is licensed on the spot by the institution's own prices (the ordinary /license flow; a
// public-domain work is free with the credit line); anything else (archival material, installation views, text,
// film, audio, a work not yet held) is asked for through one form that carries every field of the museum's own, with
// the conditions accepted by a tick instead of a signature, answered from the institution's desk (/account/rights)
// with a ticket number the asker can follow (/rights/r/<ticket>), and recorded. Nothing on the register: a request is
// private to the two parties. Every word of the conditions is the institution's to edit (makers.rights_terms) and a
// draft until counsel reads it; the defaults follow what museum archives commonly require.
const crypto = require('crypto');
const KINDS = { image: 'An image of a work in the collection', archive: 'Archival material (documents, installation views, checklists, press releases)', text: 'Text from a publication or the archives', film: 'Film or audio from the collection', other: 'Something else' };
const USES = { book: 'A book or catalogue', article: 'An article, essay or thesis', exhibition: 'An exhibition or wall text', film: 'A film, broadcast or documentary', web: 'A website or social media', commercial: 'Commercial or advertising', study: 'Private study or research' };
const DEFAULT_TERMS = `You will not misrepresent the material. You will cite it as the institution asks. You will not publish private or personally identifiable information about living persons that could cause them harm. You alone are responsible for complying with the law, including libel, copyright and privacy. You will obtain any further permission needed from copyright holders and from people depicted. You will send the institution a copy of the publication.`;
function mountRights(app, { db, V, C, mail, isStudio, makerOf, notify }) {
  const { esc, tidy, date } = V, HOUSE = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  for (const [c, t] of [['rights_email', 'TEXT'], ['rights_note', 'TEXT'], ['rights_terms', 'TEXT'], ['rights_open', 'INTEGER NOT NULL DEFAULT 1']]) {
    if (!db.prepare("SELECT 1 FROM pragma_table_info('makers') WHERE name=?").get(c)) db.exec(`ALTER TABLE makers ADD COLUMN ${c} ${t}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS rights_requests (id INTEGER PRIMARY KEY, ticket TEXT NOT NULL UNIQUE, maker_id INTEGER NOT NULL, work_id INTEGER, kind TEXT NOT NULL, what TEXT NOT NULL,
    use_kind TEXT, author TEXT, title TEXT, publisher TEXT, pub_date TEXT, territory TEXT, deadline TEXT, name TEXT NOT NULL, email TEXT NOT NULL, affiliation TEXT, address TEXT, phone TEXT, note TEXT,
    accepted INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'asked', answer TEXT, fee_cents INTEGER, answered_at TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const inst = slug => db.prepare("SELECT * FROM makers WHERE handle=? AND kind='institution'").get(String(slug));
  const ticketFor = () => `RR-${new Date().getUTCFullYear()}-${String(db.prepare("SELECT COUNT(*) n FROM rights_requests").get().n + 1).padStart(5, '0')}`;
  const hits = new Map(), slow = ip => { const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < 6e5); a.push(now); hits.set(ip, a); return a.length > 6; };
  const mayDesk = (req, m) => { if (isStudio(req)) return true; const me = makerOf(req); return !!(me && me.id === m.id); };
  const STATUS = { asked: 'With the rights desk', answered: 'Answered', granted: 'Permission granted', declined: 'Declined', withdrawn: 'Withdrawn' };

  // The door: one page per institution.
  app.get('/rights/:slug', (req, res) => {
    const m = inst(req.params.slug); if (!m) return res.sendStatus(404);
    const held = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(m.id).n;
    const open = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held' AND open IS NOT NULL").get(m.id).n;
    const q = String(req.query.q || '').trim().slice(0, 80);
    const found = q ? db.prepare("SELECT slug, title, taken_at, open FROM works WHERE maker_id=? AND status='held' AND (title LIKE ? OR caption LIKE ? OR accession LIKE ?) ORDER BY curated DESC, stars DESC LIMIT 12").all(m.id, `%${q}%`, `%${q}%`, `%${q}%`) : [];
    const ok = String(req.query.ok || '');
    const terms = m.rights_terms || DEFAULT_TERMS;
    res.send(V.layout({ title: `Rights and reproductions · ${m.name} · Watermark`, path: `/rights/${m.handle}`, desc: `Reproduce a work, archival material or text from ${m.name}: one door, answered with a ticket you can follow.`, body: `<article class="rd">
<header class="rd-h"><p class="k">${esc(m.name)}</p><h1>Rights and reproductions.</h1>
<p class="lede">One door for every request: a work in the collection, archival material, text, film. A work the house holds is licensed here on the spot, at ${esc(m.name)}’s own terms; everything else is asked for below and answered by the institution’s rights desk, with a ticket you can follow.${m.rights_note ? ` ${esc(m.rights_note)}` : ''}</p></header>
${ok === 'sent' ? `<p class="ok rd-ok">Received. Your ticket is <b>${esc(String(req.query.t || ''))}</b>; a copy has gone to your address, and the rights desk will answer there. <a href="/rights/r/${esc(String(req.query.t || ''))}">Follow it →</a></p>` : ok === 'check' ? '<p class="err rd-ok">Your name, your address, what you need and the conditions, please.</p>' : ''}
<section class="rd-s"><p class="k">A work in the collection</p><h2>Reproduce a work.</h2>
<p>${held ? `${held.toLocaleString('en-US')} work${held === 1 ? '' : 's'} from ${esc(m.name)} ${held === 1 ? 'is' : 'are'} held by the house${open ? `; ${open} ${open === 1 ? 'is' : 'are'} in the public domain or openly licensed and free to take with the credit line` : ''}. Find the work; its page says what it may be used for and at what price, or asks the institution on your behalf.` : `${esc(m.name)}’s works are not yet held by the house; ask below and the desk will answer.`}</p>
${held ? `<form method="get" action="/rights/${esc(m.handle)}" class="rd-find"><input name="q" value="${esc(q)}" placeholder="Title, subject or accession number" maxlength="80"><button class="buy-btn">Find</button></form>
${q ? (found.length ? `<ul class="rd-found">${found.map(w => `<li><a href="/m/${esc(m.handle)}/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span><b>${esc(tidy(w.title))}</b>${w.taken_at ? ` · ${esc(String(w.taken_at).slice(0, 4))}` : ''}${w.open ? ' · <i>free, with credit</i>' : ''}</span></a> <a class="link" href="/license/${esc(w.slug)}">License it →</a></li>`).join('')}</ul>` : `<p class="note">Nothing held by that word. Ask below and name the work.</p>`) : ''}` : ''}</section>
<section class="rd-s" id="ask"><p class="k">Anything else</p><h2>Ask the rights desk.</h2>
<p>Archival material, installation views, text from a publication or the archives, film or audio, or a work not yet held. One form, every field the desk needs, answered in writing to your address.</p>
<form method="post" action="/rights/${esc(m.handle)}" class="rd-f">
<label class="rd-wide"><span>What you need</span><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
<label class="rd-wide"><span>Describe it</span><textarea name="what" required maxlength="2000" rows="4" placeholder="The work, the record group, the document, the passage; dates, accession or call numbers if you have them"></textarea></label>
<label><span>The use</span><select name="use_kind">${Object.entries(USES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
<label><span>Needed by</span><input name="deadline" maxlength="40" placeholder="A date, if there is one"></label>
<p class="k rd-k">The publication</p>
<label><span>Author</span><input name="author" maxlength="120"></label><label><span>Title</span><input name="title" maxlength="200"></label><label><span>Publisher or outlet</span><input name="publisher" maxlength="120"></label><label><span>Date</span><input name="pub_date" maxlength="40"></label><label><span>Territory</span><input name="territory" maxlength="80" placeholder="World, North America, …"></label>
<p class="k rd-k">You</p>
<label><span>Name</span><input name="name" required maxlength="120" autocomplete="name"></label><label><span>Email</span><input type="email" name="email" required maxlength="160" autocomplete="email"></label><label><span>Affiliation</span><input name="affiliation" maxlength="160"></label><label><span>Telephone</span><input name="phone" maxlength="40" autocomplete="tel"></label><label class="rd-wide"><span>Address</span><input name="address" maxlength="240" autocomplete="street-address"></label>
<label class="rd-wide"><span>A note (optional)</span><textarea name="note" maxlength="2000" rows="3"></textarea></label>
<div class="rd-terms"><p class="k">The conditions</p><p>${esc(terms)}</p><label class="rd-c"><input type="checkbox" name="accept" value="1" required> I accept these conditions on behalf of myself and the publication.</label></div>
<input type="text" name="website" class="hpot" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="buy-btn">Send to the rights desk</button></form>
<p class="note">No charge to ask. A fee, if any, is named in the answer; permission is given in writing and recorded with its ticket.</p></section>
<section class="rd-s rd-foot"><p class="k">The house</p><p>${esc(m.name)}’s rights desk is kept on Watermark, a Krafft company, which holds the works, keeps the register and answers for the papers. <a href="/museums">For museums</a> · <a href="/m/${esc(m.handle)}">${esc(m.name)} on Watermark</a>.</p></section>
</article>` }));
  });
  app.post('/rights/:slug', (req, res) => {
    const m = inst(req.params.slug); if (!m || !m.rights_open) return res.sendStatus(404);
    const b = req.body || {}, t = (v, n) => String(v || '').trim().slice(0, n);
    if (b.website) return res.redirect(303, `/rights/${m.handle}?ok=sent&t=RR`);
    const name = t(b.name, 120), email = t(b.email, 160).toLowerCase(), what = t(b.what, 2000);
    if (!name || !what || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || b.accept !== '1' || slow(req.ip)) return res.redirect(303, `/rights/${m.handle}?ok=check#ask`);
    const ticket = ticketFor();
    db.prepare(`INSERT INTO rights_requests (ticket, maker_id, kind, what, use_kind, author, title, publisher, pub_date, territory, deadline, name, email, affiliation, address, phone, note, accepted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
      .run(ticket, m.id, KINDS[b.kind] ? b.kind : 'other', what, USES[b.use_kind] ? b.use_kind : null, t(b.author, 120) || null, t(b.title, 200) || null, t(b.publisher, 120) || null, t(b.pub_date, 40) || null, t(b.territory, 80) || null, t(b.deadline, 40) || null, name, email, t(b.affiliation, 160) || null, t(b.address, 240) || null, t(b.phone, 40) || null, t(b.note, 2000) || null);
    const to = m.rights_email || m.email || HOUSE;
    const lines = `${ticket} · ${m.name}\n\n${KINDS[b.kind] || KINDS.other}\n${what}\n\nUse: ${USES[b.use_kind] || '—'}${b.deadline ? `; needed by ${t(b.deadline, 40)}` : ''}\nPublication: ${[t(b.author, 120), t(b.title, 200), t(b.publisher, 120), t(b.pub_date, 40)].filter(Boolean).join(', ') || '—'}${b.territory ? `; ${t(b.territory, 80)}` : ''}\n\nFrom: ${name}${b.affiliation ? `, ${t(b.affiliation, 160)}` : ''}\n${email}${b.phone ? ` · ${t(b.phone, 40)}` : ''}${b.address ? `\n${t(b.address, 240)}` : ''}${b.note ? `\n\n${t(b.note, 2000)}` : ''}\n\nThe conditions were accepted.`;
    mail.send({ to, subject: `Rights request ${ticket}: ${KINDS[b.kind] ? KINDS[b.kind].split(' (')[0] : 'a request'}`, text: `${lines}\n\nAnswer it: ${C.base}/account/rights/${ticket}\n\nWatermark` });
    mail.send({ to: email, subject: `${m.name}: your request, ${ticket}`, text: `Thank you. ${m.name}’s rights desk has your request.\n\n${lines}\n\nFollow it: ${C.base}/rights/r/${ticket}\n\nWatermark, for ${m.name}` });
    if (notify) notify({ maker_id: m.id, kind: 'rights', title: `A rights request, ${ticket}`, body: what.slice(0, 120), href: `/account/rights/${ticket}` }).catch(() => {});
    res.redirect(303, `/rights/${m.handle}?ok=sent&t=${encodeURIComponent(ticket)}`);
  });
  // How to open a desk: the page a museum's rights staff read before the meeting.
  app.get('/museums/desk', (req, res) => {
    res.send(V.layout({ title: 'Open a rights desk · Watermark', path: '/museums/desk', desc: 'How an institution opens its rights and reproductions desk on Watermark, in an afternoon, with nothing migrated.', body: `<article class="rd rd-guide">
<header class="rd-h"><p class="k">For museums</p><h1>Open a rights desk.</h1>
<p class="lede">One door for every request to reproduce, quote or license from your collection and archives, answered by your own people from one queue, with a ticket the asker can follow. Nothing migrates; nothing leaves your building; your rights page points at the desk and that is all that changes.</p></header>
<section class="rd-s"><p class="k">What it replaces</p><p>The page of paragraphs: one agency for North America, another for the rest of the world, archival audio to a third address, text permissions to a fourth, and the permission form as a PDF to print, sign and post. Scholars email; nobody knows where a request is; the answer takes weeks and is not recorded anywhere a second person can find it.</p></section>
<section class="rd-s"><p class="k">What the desk does</p><ol class="ow-ol">
<li><b>One address.</b> <code>${esc(C.base)}/rights/&lt;your-name&gt;</code>, or under your own domain by letter. Your rights page links it; the old addresses can stay as long as you like.</li>
<li><b>Every field of your form, once.</b> What, the use, the publication (author, title, publisher, date), territory, deadline, who is asking and where to write. Your conditions, in your words, accepted with a tick. A PDF is no longer needed, though the desk will take one.</li>
<li><b>A ticket.</b> RR-2026-00042, mailed to the asker and to your rights address. The asker follows it on a page; your staff answer from a queue: grant, answer, decline, with a fee if any, in writing. A grant is the permission, recorded with its number.</li>
<li><b>The collection, if you choose.</b> Works the house holds for you are licensed on the spot at your prices, and public-domain works are given free with your credit line, so the simple requests never reach a person. Bring works in from your IIIF manifest or your own API; leave the rest where it is.</li>
<li><b>Third-party rights, said plainly.</b> Where the artist’s estate or a donor must also consent, your answer names it; the desk does not pretend to clear what it cannot.</li></ol></section>
<section class="rd-s"><p class="k">What it costs, and what it keeps</p><p>The pilot is free for ninety days. The desk’s records are yours: exported on request, deleted on request; the house never sells or shares a requester’s details. The service runs on encrypted storage with nightly sealed backups and a weekly restore drill, behind two-factor doors, with every action by your staff on an audit trail. The agreement is one page and is read by your counsel before anything is turned on.</p></section>
<section class="rd-s"><p class="k">The afternoon</p><ol class="ow-ol"><li>Write to the house with the institution’s name and the address your rights requests should reach.</li><li>The house opens the desk and sends your rights staff their invitation; they sign in with their email and a passkey, set the conditions in your words, and try a request on themselves.</li><li>Put the link on your rights page. Measure the turnaround.</li></ol>
<p><a class="buy-btn" href="mailto:${esc(HOUSE)}?subject=${encodeURIComponent('A rights desk for our institution')}">Write to the house</a> <a class="link" href="/museums">For museums</a></p></section>
</article>` }));
  });
  // The asker follows it.
  app.get('/rights/r/:ticket', (req, res) => {
    const r = db.prepare('SELECT r.*, m.name AS inst, m.handle FROM rights_requests r JOIN makers m ON m.id=r.maker_id WHERE r.ticket=?').get(String(req.params.ticket).toUpperCase()); if (!r) return res.sendStatus(404);
    res.send(V.layout({ title: `${r.ticket} · Watermark`, path: '/rights', desc: 'A rights request.', body: `<article class="rd rd-one"><header class="rd-h"><p class="k">${esc(r.inst)} · rights and reproductions</p><h1>${esc(r.ticket)}</h1><p class="lede rd-st rd-${esc(r.status)}">${esc(STATUS[r.status] || r.status)}${r.answered_at ? `, ${esc(date(r.answered_at))}` : `, asked ${esc(date(r.at))}`}.</p></header>
<section class="rd-s"><p class="k">Asked for</p><p><b>${esc(KINDS[r.kind] || r.kind)}</b></p><p>${esc(r.what).replace(/\n/g, '<br>')}</p><p class="note">${esc(USES[r.use_kind] || '')}${r.deadline ? ` · needed by ${esc(r.deadline)}` : ''}${r.title ? ` · ${esc([r.author, r.title, r.publisher, r.pub_date].filter(Boolean).join(', '))}` : ''}</p></section>
${r.answer ? `<section class="rd-s"><p class="k">The answer</p><p>${esc(r.answer).replace(/\n/g, '<br>')}</p>${r.fee_cents ? `<p><b>Fee: ${V.money(r.fee_cents)}</b></p>` : ''}${r.status === 'granted' ? `<p class="note">Permission is given in writing by this page and the letter sent to ${esc(r.email)}, under the conditions accepted on ${esc(date(r.at))}. Keep the ticket; it is the permission’s number.</p>` : ''}</section>` : '<section class="rd-s"><p class="k">The answer</p><p>Not yet. The desk will write to your address.</p></section>'}
<p class="note"><a href="/rights/${esc(r.handle)}">${esc(r.inst)}’s rights desk</a></p></article>` }));
  });
  // The institution's desk.
  app.get('/account/rights', (req, res) => {
    const me = makerOf(req); const m = me && me.kind === 'institution' ? me : null;
    if (!m) return isStudio(req) ? res.redirect('/studio/rights') : res.sendStatus(me ? 403 : 401);
    res.send(desk(m, req));
  });
  function desk(m, req, note = '') {
    const rows = db.prepare('SELECT * FROM rights_requests WHERE maker_id=? ORDER BY CASE status WHEN \'asked\' THEN 0 ELSE 1 END, id DESC LIMIT 200').all(m.id);
    const waiting = rows.filter(r => r.status === 'asked');
    return V.layout({ title: 'Rights desk · Studio · Watermark', path: '/account/rights', studio: true, body: `<section class="studio-wrap rd-desk"><p class="k">${esc(m.name)}</p><h1>The rights desk.</h1>
<p class="lede">${waiting.length ? `${waiting.length} request${waiting.length === 1 ? '' : 's'} waiting.` : 'All answered.'} The public door is <a href="/rights/${esc(m.handle)}">/rights/${esc(m.handle)}</a>. ${note}</p>
<form method="post" action="/account/rights/settings" class="rd-set"><label><span>Requests go to</span><input type="email" name="rights_email" value="${esc(m.rights_email || '')}" placeholder="${esc(m.email || 'rights@…')}" maxlength="160"></label><label><span>A line on the door (optional)</span><input name="rights_note" value="${esc(m.rights_note || '')}" maxlength="300" placeholder="Some collections need a further permission; the desk will say which."></label><label class="rd-wide"><span>The conditions</span><textarea name="rights_terms" rows="4" maxlength="4000">${esc(m.rights_terms || DEFAULT_TERMS)}</textarea></label><label class="rd-c"><input type="checkbox" name="rights_open" value="1"${m.rights_open ? ' checked' : ''}> The door is open</label><button>Keep</button></form>
${rows.length ? `<table class="tbl rd-t"><tr><th>Ticket</th><th>Asked</th><th>What</th><th>From</th><th>State</th></tr>${rows.map(r => `<tr><td><a href="/account/rights/${esc(r.ticket)}">${esc(r.ticket)}</a></td><td>${esc(date(r.at))}</td><td>${esc((KINDS[r.kind] || r.kind).split(' (')[0])}<br><small>${esc(r.what.slice(0, 90))}${r.what.length > 90 ? '…' : ''}</small></td><td>${esc(r.name)}${r.affiliation ? `<br><small>${esc(r.affiliation)}</small>` : ''}</td><td>${esc(STATUS[r.status] || r.status)}</td></tr>`).join('')}</table>` : '<p>No request yet.</p>'}</section>` });
  }
  app.post('/account/rights/settings', (req, res) => {
    const me = makerOf(req); if (!me || me.kind !== 'institution') return res.sendStatus(401);
    const b = req.body || {}, t = (v, n) => String(v || '').trim().slice(0, n);
    db.prepare('UPDATE makers SET rights_email=?, rights_note=?, rights_terms=?, rights_open=? WHERE id=?').run(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t(b.rights_email, 160)) ? t(b.rights_email, 160) : null, t(b.rights_note, 300) || null, t(b.rights_terms, 4000) || null, b.rights_open === '1' ? 1 : 0, me.id);
    res.redirect('/account/rights');
  });
  const one = (req, res, ticket) => {
    const r = db.prepare('SELECT r.*, m.name AS inst, m.handle FROM rights_requests r JOIN makers m ON m.id=r.maker_id WHERE r.ticket=?').get(String(ticket).toUpperCase()); if (!r) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(r.maker_id); if (!mayDesk(req, m)) return res.sendStatus(403);
    res.send(V.layout({ title: `${r.ticket} · Rights desk · Watermark`, path: '/account/rights', studio: true, body: `<section class="studio-wrap rd-one"><p class="k"><a href="/account/rights">The rights desk</a> · ${esc(r.inst)}</p><h1>${esc(r.ticket)}</h1><p class="lede">${esc(STATUS[r.status] || r.status)}; asked ${esc(date(r.at))}.</p>
<dl class="rd-dl"><dt>What</dt><dd><b>${esc(KINDS[r.kind] || r.kind)}</b><br>${esc(r.what).replace(/\n/g, '<br>')}</dd><dt>Use</dt><dd>${esc(USES[r.use_kind] || '—')}${r.deadline ? ` · needed by ${esc(r.deadline)}` : ''}${r.territory ? ` · ${esc(r.territory)}` : ''}</dd><dt>Publication</dt><dd>${esc([r.author, r.title, r.publisher, r.pub_date].filter(Boolean).join(', ') || '—')}</dd><dt>From</dt><dd>${esc(r.name)}${r.affiliation ? `, ${esc(r.affiliation)}` : ''}<br><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.phone ? ` · ${esc(r.phone)}` : ''}${r.address ? `<br>${esc(r.address)}` : ''}</dd>${r.note ? `<dt>Note</dt><dd>${esc(r.note).replace(/\n/g, '<br>')}</dd>` : ''}<dt>Conditions</dt><dd>Accepted ${esc(date(r.at))}.</dd></dl>
${r.answer ? `<p class="k">The answer</p><p>${esc(r.answer).replace(/\n/g, '<br>')}</p>${r.fee_cents ? `<p>Fee: ${V.money(r.fee_cents)}</p>` : ''}` : ''}
<form method="post" action="/account/rights/${esc(r.ticket)}" class="rd-ans"><label class="rd-wide"><span>Answer, in writing</span><textarea name="answer" rows="6" maxlength="4000" required placeholder="What is granted and how it must be cited; what is declined and why; a further permission needed; the fee, if any.">${esc(r.answer || '')}</textarea></label><label><span>Fee, USD (optional)</span><input name="fee" inputmode="decimal" value="${r.fee_cents ? (r.fee_cents / 100) : ''}" placeholder="0"></label>
<div class="rd-btns"><button class="buy-btn" name="do" value="granted">Grant</button><button name="do" value="answered">Answer only</button><button name="do" value="declined">Decline</button></div></form></section>` }));
  };
  app.get('/account/rights/:ticket', (req, res) => one(req, res, req.params.ticket));
  app.post('/account/rights/:ticket', (req, res) => {
    const r = db.prepare('SELECT r.*, m.name AS inst FROM rights_requests r JOIN makers m ON m.id=r.maker_id WHERE r.ticket=?').get(String(req.params.ticket).toUpperCase()); if (!r) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(r.maker_id); if (!mayDesk(req, m)) return res.sendStatus(403);
    const b = req.body || {}; const status = ['granted', 'answered', 'declined'].includes(b.do) ? b.do : 'answered';
    const answer = String(b.answer || '').trim().slice(0, 4000); if (!answer) return res.redirect(`/account/rights/${r.ticket}`);
    const fee = Math.round(parseFloat(String(b.fee || '0').replace(/[^0-9.]/g, '')) * 100) || null;
    db.prepare("UPDATE rights_requests SET status=?, answer=?, fee_cents=?, answered_at=datetime('now') WHERE id=?").run(status, answer, fee, r.id);
    mail.send({ to: r.email, subject: `${r.inst}: ${STATUS[status].toLowerCase()}, ${r.ticket}`, text: `${answer}${fee ? `\n\nFee: ${V.money(fee)}` : ''}\n\n${status === 'granted' ? `This letter and ${C.base}/rights/r/${r.ticket} are your permission in writing, under the conditions you accepted on ${date(r.at)}. Keep the ticket.` : `Follow it: ${C.base}/rights/r/${r.ticket}`}\n\n${r.inst}, through Watermark` });
    res.redirect(`/account/rights?ok=${encodeURIComponent(`${r.ticket}: ${STATUS[status].toLowerCase()}.`)}`);
  });
  // The Studio sees every desk.
  app.get('/studio/rights', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const rows = db.prepare("SELECT r.*, m.name AS inst FROM rights_requests r JOIN makers m ON m.id=r.maker_id ORDER BY CASE r.status WHEN 'asked' THEN 0 ELSE 1 END, r.id DESC LIMIT 300").all();
    const insts = db.prepare("SELECT handle, name, rights_open FROM makers WHERE kind='institution' ORDER BY name").all();
    res.send(V.layout({ title: 'Rights desks · Studio · Watermark', path: '/studio/rights', studio: true, body: `<section class="studio-wrap rd-desk"><p class="k">The house</p><h1>The rights desks.</h1>
<p class="lede">${insts.length ? insts.map(i => `<a href="/rights/${esc(i.handle)}">${esc(i.name)}</a>${i.rights_open ? '' : ' (closed)'}`).join(' · ') : 'No institution yet: invite one from Accounts.'}</p>
${rows.length ? `<table class="tbl rd-t"><tr><th>Ticket</th><th>Institution</th><th>Asked</th><th>What</th><th>From</th><th>State</th></tr>${rows.map(r => `<tr><td><a href="/account/rights/${esc(r.ticket)}">${esc(r.ticket)}</a></td><td>${esc(r.inst)}</td><td>${esc(date(r.at))}</td><td>${esc((KINDS[r.kind] || r.kind).split(' (')[0])}<br><small>${esc(r.what.slice(0, 80))}</small></td><td>${esc(r.name)}</td><td>${esc(STATUS[r.status] || r.status)}</td></tr>`).join('')}</table>` : '<p>No request yet.</p>'}</section>` }));
  });
  app.locals.rights = { KINDS, USES, DEFAULT_TERMS, waiting: makerId => db.prepare("SELECT COUNT(*) n FROM rights_requests WHERE maker_id=? AND status='asked'").get(makerId).n };
  return app.locals.rights;
}
module.exports = { mountRights, KINDS, USES, DEFAULT_TERMS };
