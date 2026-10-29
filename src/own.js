// You already own it (Will, 20 Oct: "the most intuitive, simple copyright app ever … people assume if they don't
// register they're not copyright owners … every time they take a picture they're a copyright owner … give people
// rights they have never exercised"). The law is on their side: a work is theirs the moment it is fixed; registration
// strengthens the claim (in the U.S., the right to sue and to statutory damages), it does not create it.
// So the house says it, in the first minute, and gives them the paper:
//   The deed (/w/:slug/deed): one page in plain words: who made it, when, the fingerprint, the register entry and
//     the house's signature, the Office registration when there is one. Printable. The first thing many makers will
//     own that says they own something.
//   The arrival sentence: the vault's answer to each file carries `yours`, the sentence ("This is yours. It has been
//     since …"), and the deed's address, shown under each arrival.
//   /own: "You already own it": the five things people get wrong, and the three things you can do with what you own.
//   The open door (/record): the collection stays curated, by invitation; the register opens. Anyone may bring in
//     what they made (name, email, their first files), hold the deed, ask the house to register it with the Office,
//     and set their terms. `makers.door = 'record'`: their work is held privately and never hung in the collection
//     until the house invites them (Studio → Makers: Invite to the house → door 'house').
//   The Office, one tap (/account/copyright): a maker ticks the works, pays the Office's fee per group through
//     Checkout, and the house files (Studio → Copyright sees the asks; the maker is told at each step).
//   Said simply: the maker's prices as one sentence ("You may use this in a story for $350 …"), on /account/prices
//     and the work page, so a license reads like a sentence a person would say.
const mail = require('./mail');
const OFFICE_FEE = Number(process.env.COPYRIGHT_FEE_CENTS) || 5500; // the Office's group fee, passed through at cost (a draft)
const GROUP = 750; // works a group, the Office's limit

function mountOwn(app, { db, V, C, ledger, stripe, buyerOf, makerOf, isStudio, studioOnly, registerWork }) {
  const { esc, tidy, date } = V;
  for (const [c, t] of [['door', 'TEXT'], ['invited_at', 'TEXT']]) if (!db.prepare(`SELECT 1 FROM pragma_table_info('makers') WHERE name='${c}'`).get()) db.exec(`ALTER TABLE makers ADD COLUMN ${c} ${t}`);
  db.exec(`CREATE TABLE IF NOT EXISTS copyright_asks (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, works TEXT NOT NULL, groups INTEGER NOT NULL DEFAULT 1, cents INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', stripe_session TEXT, note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), filed_at TEXT)`);
  const money = c => '$' + (Math.round(c || 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const mk = id => db.prepare('SELECT * FROM makers WHERE id=?').get(id);
  const entry = w => db.prepare("SELECT * FROM ledger WHERE type='work.registered' AND subject=? ORDER BY seq ASC LIMIT 1").get(w.slug);
  const madeAt = w => w.taken_at || w.created_at;
  const when = s => s ? new Date(s).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: process.env.BALCONY_TZ || 'America/New_York' }) : '';
  const dayOf = s => s ? new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  // The sentence. Said once, as a fact.
  const yours = (w, m) => { const made = madeAt(w); const exact = !!w.taken_at && /T\d\d:\d\d/.test(String(w.taken_at)); return `This is yours. It has been since ${exact ? when(made) : dayOf(made)}, when you made it. No one may use it without your yes.`; };
  app.locals.yours = yours;

  // The deed.
  app.get('/w/:slug/deed', (req, res) => {
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(req.params.slug); if (!w) return res.sendStatus(404);
    const m = mk(w.maker_id); const me = makerOf(req);
    if (w.status !== 'held' && !(me && me.id === w.maker_id) && !isStudio(req)) return res.sendStatus(404);
    const e = entry(w), cs = app.locals.copyrightState ? app.locals.copyrightState(w) : null, sig = e && e.sig ? e.sig : null;
    const first = (m.name || '').split(/\s+/)[0];
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: `Deed · ${tidy(w.title)} · Watermark`, path: '/own', desc: `The deed of ${tidy(w.title)}: made by ${m.name}, held on Watermark.`, body: `<article class="deed">
<header class="deed-h"><p class="k">Watermark · a deed of authorship</p><h1>${esc(tidy(w.title))}</h1><p class="deed-l">is the work of <b>${esc(m.name)}</b>, who has owned it since ${esc(dayOf(madeAt(w)))}, the day it was made.</p></header>
<figure class="deed-pic"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}"></figure>
<section class="deed-body">
<p>Copyright does not begin with a certificate or a registration. It begins the moment a work is fixed, with the person who made it. ${esc(first)} made this work${w.place ? ` in ${esc(w.place)}` : ''}${madeAt(w) ? ` on ${esc(dayOf(madeAt(w)))}` : ''}, and has held every right in it since: to copy it, to show it, to make work from it, and to say who else may.</p>
<dl class="deed-dl">
<div><dt>Made by</dt><dd>${esc(m.name)}${m.place ? `, ${esc(m.place)}` : ''}</dd></div>
<div><dt>Made</dt><dd>${esc(dayOf(madeAt(w)))}${w.camera ? ` · ${esc(w.camera)}` : ''}</dd></div>
<div><dt>Entered the register</dt><dd>${e ? `${esc(dayOf(e.at))}, entry No. ${e.seq}` : 'pending'}${w.accession ? ` · accession ${esc(w.accession)}` : ''}</dd></div>
<div><dt>Fingerprint</dt><dd><code>${esc(w.sha256 || '')}</code><small>SHA-256 of the original file. Any copy of the original has this fingerprint; no other file does.</small></dd></div>
${sig ? `<div><dt>The house’s signature</dt><dd><code>${esc(sig.slice(0, 32))}…</code><small>The register entry is signed with the house’s key (published at /ledger.json). Anyone can check it at <a href="/ledger">the register</a>.</small></dd></div>` : ''}
<div><dt>U.S. Copyright Office</dt><dd>${cs ? esc(cs.line) : ''}${cs && cs.state === 'none' && me && me.id === m.id ? ` <a href="/account/copyright">Register it →</a>` : ''}</dd></div>
<div><dt>Credential</dt><dd><a href="/w/${esc(w.slug)}/credential">A signed credential of authorship</a> (W3C Verifiable Credential), readable by any platform.</dd></div>
</dl>
<p class="deed-how"><b>What this deed is.</b> The house’s record that this work entered its register on the day above, made by the person named, with this fingerprint. It is evidence, kept and signed by Watermark, a Krafft company. It is not a registration with a government office; that is a separate act, noted above when it has been made. The house certifies the record; the maker’s word stands behind the work.</p>
<p class="deed-acts"><a class="buy-btn" href="javascript:print()">Print the deed</a> <a href="/w/${esc(w.slug)}">The work</a> · <a href="/own">You already own it</a></p>
</section></article>` }));
  });

  // You already own it.
  app.get('/own', (req, res) => {
    const me = makerOf(req);
    res.send(V.layout({ title: 'You already own it · Watermark', path: '/own', desc: 'Every time you make a picture, you own it. Watermark is where you hold it, show it, and let others use it on your terms.', body: `<article class="own">
<header class="own-h"><p class="k">Watermark</p><h1>You already own it.</h1><p class="lede">Every time you take a photograph, or paint, or write a line, you make something that is yours by law from that moment. No form, no fee, no one’s permission. Most people never find that out. This is the house where you do, and where you use it.</p></header>
<section class="own-s"><h2>Five things people get wrong</h2><ol class="own-l">
<li><b>“I never registered it, so it isn’t really mine.”</b> It is. Copyright begins when the work is fixed: when the shutter closes, when the brush lifts. Registration is a stronger claim, not the beginning of one.</li>
<li><b>“It’s on the internet, so anyone can use it.”</b> Posting a work does not give it away. A platform’s terms may let the platform show it; they do not make it anyone else’s.</li>
<li><b>“I’m not a real artist, so this doesn’t apply to me.”</b> The law has no bar to clear. A phone photograph of your street is yours exactly as a print in a museum is its maker’s.</li>
<li><b>“Someone used it, and there’s nothing I can do.”</b> There is. You may ask them to stop, ask them to pay, or let them, on your terms. A record of what you made and when is what makes any of it possible.</li>
<li><b>“Licensing is for agencies and lawyers.”</b> A license is one sentence: <em>you may use this for that, for this much.</em> The house writes the rest.</li></ol></section>
<section class="own-s"><h2>Three things you can do with what you own</h2><div class="own-3">
<div><p class="k">Keep it</p><p>Bring it into the vault. It is fingerprinted on arrival, written to the register with the day you made it, sealed with its master, and given a deed: one page that says, in plain words, that it is yours.</p></div>
<div><p class="k">Show it</p><p>Your own page, your own gallery; the stroll and the walls when the house invites you. Private until you say otherwise.</p></div>
<div><p class="k">Let someone use it</p><p>Set a price for each use, or none and answer each ask yourself. Every license is a signed record, every delivered file carries your name and the way back, and ${require('./fee').yours(85)}.</p></div></div></section>
<section class="own-s"><h2>And then, if you want, register it</h2><p>Registration with the U.S. Copyright Office is the one thing that does change: it lets you sue for infringement and ask for statutory damages. The Office takes groups of up to ${GROUP} photographs by one maker, published in one year, for one fee. The house prepares the filing from your deeds; you tap once and pay the Office’s fee at cost.</p></section>
<section class="own-door"><p class="k">The door</p><h2>Bring in what you made.</h2><p>Your name and your email open your own museum: put your work in, keep all of it, hang the best. Your first files get their deeds in a minute. Watermark’s own halls hold what has been collected, hung by a curator, or called Bravo.</p>${me ? `<p><a class="buy-btn" href="/account/upload">Into the vault</a></p>` : `<form method="post" action="/record" class="own-f"><label>Your name<input name="name" required maxlength="80" autocomplete="name"></label><label>Email<input name="email" type="email" required maxlength="160" autocomplete="email"></label><button class="buy-btn">Open my studio</button></form><p class="note">Nothing is shown publicly until you say so. ${esc(C.base.replace(/^https?:\/\//, ''))} is a Krafft company.</p>`}</section>
<p class="own-fine">Not legal advice; the law differs by country and by case. The house keeps the record and says what it is; a lawyer says what it means for you. <a href="/legal/makers">The Maker Agreement</a> · <a href="/copyright">How the house works with the Copyright Office</a>.</p>
</article>` }));
  });

  // The open door.
  const slow = (() => { const hits = new Map(); return (k, n = 5) => { const now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 3600000); a.push(now); hits.set(k, a); return a.length > n; }; })();
  app.get('/record', (req, res) => res.redirect('/own#door'));
  app.post('/record', (req, res) => {
    const x = req.body || {}, name = String(x.name || '').replace(/<[^>]*>/g, '').trim().slice(0, 80), email = String(x.email || '').trim().toLowerCase().slice(0, 160);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || slow(req.ip)) return res.redirect('/own?ok=check#door');
    let m = db.prepare('SELECT * FROM makers WHERE email=?').get(email);
    if (!m) {
      const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'maker';
      let handle = slugify(name), i = 2; while (db.prepare('SELECT 1 FROM makers WHERE handle=?').get(handle)) handle = `${slugify(name)}-${i++}`;
      const id = db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES (?,?,?,'maker',datetime('now'),'record')").run(handle, name, email).lastInsertRowid;
      m = mk(id);
      ledger.append(db, 'maker.recorded', m.handle, {});
      mail.send({ to: email, subject: 'Your museum is open', text: `${name.split(/\s+/)[0]},\n\nYour museum on Watermark is open. Bring in what you made: each file is fingerprinted, written to the register with the day you made it, and given a deed that says it is yours.\n\n${C.base}/account/upload\n\nWhat you bring in is private until you say otherwise. Thank you. You are our honoured guest.\n\nWatermark, a Krafft company.` }).catch(() => {});
    }
    if (app.locals.admit) app.locals.admit(req, res, email);
    res.redirect('/account/upload?welcome=own');
  });
  // The house invites a recorded maker in: their work may then hang.
  // Inviting and answering, shared with the committees (committee.js).
  app.locals.inviteMaker = (m, hang = [], who = { by: 'house' }) => {
    db.prepare("UPDATE makers SET door='house', invited_at=datetime('now') WHERE id=?").run(m.id);
    db.prepare("UPDATE house_asks SET answer='Invited to the house.', answered_at=datetime('now') WHERE maker_id=? AND answer IS NULL").run(m.id);
    ledger.append(db, 'maker.invited', m.handle, { ...who, from: 'record' });
    // The first show: what was ticked hangs; the rest stays in the record until the maker publishes it.
    let hung = 0;
    for (const slug of hang.slice(0, 60)) { const w = db.prepare("SELECT * FROM works WHERE slug=? AND maker_id=? AND status='hidden'").get(String(slug), m.id); if (!w) continue; db.prepare("UPDATE works SET status='held', stars=MAX(COALESCE(stars,0),4) WHERE id=?").run(w.id); ledger.append(db, 'work.published', w.slug, { maker: m.handle, ...who, show: 'first' }); hung++; } // the house's choice is a grade: a first show wanders at once (23 Oct)
    if (hung && app.locals.findIndexDirty) app.locals.findIndexDirty();
    if (m.email) mail.send({ to: m.email, subject: 'The house invites you', text: `${(m.name || '').split(/\s+/)[0]},\n\nThe house has looked at what you brought in and would like to hang it.${hung ? ` The first show is hung: ${hung} of your works are on the walls from today.` : ''} From today your work may be published to the collection from your studio: ${C.base}/account\n\nWelcome. You are our honoured guest.\n\nWatermark, a Krafft company.` }).catch(() => {});
    return hung;
  };
  app.locals.answerAsk = (m, ask, answer, who = { by: 'house' }) => {
    db.prepare("UPDATE house_asks SET answer=?, answered_at=datetime('now') WHERE id=?").run(answer, ask.id);
    ledger.append(db, 'house.answered', m.handle, who);
    if (m.email) mail.send({ to: m.email, subject: 'The house has looked', text: `${(m.name || '').split(/\s+/)[0]},\n\n${answer}\n\nYour work stays held and deeded, yours as ever; keep bringing it in. ${C.base}/account\n\nThank you.\n\nWatermark, a Krafft company.` }).catch(() => {});
  };
  app.post('/studio/accounts/:id/invite', studioOnly, (req, res) => {
    const m = mk(Number(req.params.id)); if (!m) return res.sendStatus(404);
    let hang = (req.body || {}).hang; hang = Array.isArray(hang) ? hang : hang ? String(hang).split(',') : [];
    app.locals.inviteMaker(m, hang, { by: 'house' });
    res.redirect('/studio/accounts?ok=' + encodeURIComponent(`${m.name} is invited to the house.`));
  });
  app.locals.mayHang = m => !m || m.door !== 'record' || !app.locals.museums || app.locals.museums.wallLeft(m) > 0; // 29 Oct: every maker hangs their own museum, up to its wall

  // The way in (Will, 20 Oct: getting hung must be a journey, doable, and one that ensures quality; the house has its
  // own eye but does not tell an artist what to make: the standard is craft, honesty and a body of work, not a style).
  db.exec(`CREATE TABLE IF NOT EXISTS house_asks (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL, note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), answer TEXT, answered_at TEXT)`);
  const lastAsk = m => db.prepare('SELECT * FROM house_asks WHERE maker_id=? ORDER BY id DESC LIMIT 1').get(m.id);
  app.locals.wayIn = (m, ok) => {
    if (!m || m.door !== 'record') return '';
    const r = app.locals.readiness(m), ask = lastAsk(m);
    const steps = r.steps.map(s => [s.t, s.done, s.line, s.href]);
    steps.push(['Ask the house to look', !!ask, ask ? (ask.answer ? `The house answered on ${dayOf(ask.answered_at)}: ${ask.answer}` : `Asked on ${dayOf(ask.at)}. The house looks at your edit, large, and writes back.`) : 'When the four above are done, ask. The house answers every ask, in words, within the month, and hangs the first show itself.', null]);
    const can = r.can && !(ask && !ask.answer);
    return `<section class="hd-way"><div class="hd-h"><h2>The way in</h2><span class="hd-n">${steps.filter(x => x[1]).length} of ${steps.length}</span></div>
<p class="way-l">Everything you bring in is yours, held and deeded, from the day it arrives: the record is the frame on your own wall. The house's walls are a museum's, and hanging there is by invitation. There is a moment when work is ready to be shown, when people will pay for it; the steps below are how the house reads that moment, and a discipline worth keeping either way: title it, place it, date it, grade it, edit it. The house has its own eye; it does not tell you what to make. It looks for craft, honesty and a body of work.</p>
<ol class="way-s">${steps.map(([t, done, line, href]) => `<li class="${done ? 'done' : ''}"><b>${esc(t)}</b><span>${esc(line)}</span>${href && !done ? `<a href="${href}">Go →</a>` : ''}</li>`).join('')}</ol>
${ok === 'asked' ? '<p class="ok">Asked. The house will write back.</p>' : ''}
${can ? `<form method="post" action="/account/ask-house" class="way-f"><label>A line to the house, if you like<input name="note" maxlength="240" placeholder="optional"></label><button class="buy-btn">Ask the house to look</button></form>` : ''}</section>`;
  };
  app.post('/account/ask-house', (req, res) => {
    const m = makerOf(req); if (!m || m.door !== 'record') return res.sendStatus(403);
    const open = lastAsk(m); if (open && !open.answer) return res.redirect('/account?ok=asked');
    if (app.locals.readiness && !app.locals.readiness(m).can) return res.redirect('/account?ok=notyet#way'); // the moment is read from the work, not asked for
    db.prepare('INSERT INTO house_asks (maker_id, note) VALUES (?,?)').run(m.id, String((req.body || {}).note || '').replace(/<[^>]*>/g, '').trim().slice(0, 240) || null);
    ledger.append(db, 'house.asked', m.handle, {});
    mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `${m.name} asks the house to look`, text: `${m.name} asks the house to look at their work.

${C.base}/account?maker=${m.handle}
${C.base}/studio/accounts` }).catch(() => {});
    res.redirect('/account?ok=asked');
  });
  app.post('/studio/accounts/:id/answer', studioOnly, (req, res) => {
    const m = mk(Number(req.params.id)); if (!m) return res.sendStatus(404);
    const ask = lastAsk(m); const answer = String((req.body || {}).answer || '').trim().slice(0, 600); if (!ask || ask.answer || !answer) return res.redirect('/studio/accounts');
    app.locals.answerAsk(m, ask, answer, { by: 'house' });
    res.redirect('/studio/accounts?ok=' + encodeURIComponent(`Answered ${m.name}.`));
  });
  app.locals.houseAsksBlock = () => {
    const rows = db.prepare('SELECT a.*, m.name, m.handle, m.id AS mid, (SELECT COUNT(*) FROM works w WHERE w.maker_id=m.id AND w.status IN (\'held\',\'hidden\')) n FROM house_asks a JOIN makers m ON m.id=a.maker_id WHERE a.answer IS NULL ORDER BY a.at').all();
    if (!rows.length) return '';
    return `<section class="ac-asks"><p class="k">Asking to hang · ${rows.length} · <a href="/studio/committee">The committees</a></p><ul class="ac-askl">${rows.map(a => `<li><b>${esc(a.name)}</b> · ${a.n} works · asked ${esc(dayOf(a.at))}${a.note ? ` · <em>${esc(a.note)}</em>` : ''} · <a href="/studio/review/${a.mid}">Look</a>
<form method="post" action="/studio/accounts/${a.mid}/invite" class="inline"><button class="link">Invite to the house</button></form>
<form method="post" action="/studio/accounts/${a.mid}/answer" class="inline ac-ans"><input name="answer" maxlength="600" placeholder="A word back, in the house’s voice: what you saw, and what would bring it in."><button class="link">Send</button></form></li>`).join('')}</ul></section>`;
  };

  // The Office, one tap.
  const regState = w => app.locals.copyrightState ? app.locals.copyrightState(w) : { state: 'none' };
  app.get('/account/copyright', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/copyright');
    const works = db.prepare("SELECT * FROM works WHERE maker_id=? AND status IN ('held','hidden') ORDER BY created_at DESC").all(m.id).map(w => ({ ...w, cs: regState(w) }));
    const open = works.filter(w => w.cs.state === 'none'), asks = db.prepare('SELECT * FROM copyright_asks WHERE maker_id=? ORDER BY id DESC').all(m.id);
    const ok = { asked: 'Asked. The house prepares the filing and writes to you at each step.', off: 'Payment is not available just now; write to the house.', none: 'Choose at least one work.' }[req.query.ok];
    res.send(V.layout({ title: 'Register with the Copyright Office · Watermark', studio: true, path: '/account/copyright', body: `<section class="studio-wrap hd"><p class="k"><a href="/account">${esc(m.name)}</a> · Your rights</p><h1>Register with the U.S. Copyright Office.</h1>
<p class="lede">Your work is yours already; the deed says so. Registration adds the one thing a deed cannot: the right to sue for infringement in the United States and to ask for statutory damages. The Office takes a group of up to ${GROUP} photographs by one maker, published in one year, for ${money(OFFICE_FEE)}. The house prepares the filing from your records, files it, and writes the registration number onto every work.</p>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
${open.length ? `<form method="post" action="/account/copyright/ask" class="cr-ask"><p class="k">Not yet registered · ${open.length}</p><ul class="cr-works">${open.map(w => `<li><label><input type="checkbox" name="w" value="${esc(w.slug)}" checked> <img src="/img/${esc(w.slug)}/thumb" alt=""> <b>${esc(tidy(w.title))}</b> <span>${esc(dayOf(madeAt(w)))}${w.status === 'held' ? ' · published' : ' · private'}</span></label></li>`).join('')}</ul>
<p class="note">Published and unpublished works go in separate groups; works made in different years go in separate groups. The fee is the Office’s, passed through at cost; the house charges nothing for the filing.</p><button class="buy-btn">Register these</button></form>` : '<p class="clear">Everything you hold is registered, filed, or prepared.</p>'}
${asks.length ? `<h2>Your filings</h2><table class="tbl"><tr><th>Asked</th><th>Works</th><th>Fee</th><th>Status</th></tr>${asks.map(a => `<tr><td>${esc(String(a.at).slice(0, 10))}</td><td>${JSON.parse(a.works).length}</td><td>${money(a.cents)}${a.paid ? '' : ' · unpaid'}</td><td>${esc(a.status)}</td></tr>`).join('')}</table>` : ''}
${works.filter(w => w.cs.state !== 'none').length ? `<h2>Registered, filed, prepared</h2><ul class="cr-done">${works.filter(w => w.cs.state !== 'none').map(w => `<li><b>${esc(tidy(w.title))}</b> <span>${esc(w.cs.line)}</span></li>`).join('')}</ul>` : ''}
<p class="fine"><a href="/own">You already own it</a> · <a href="/copyright">How the house works with the Office</a></p></section>` }));
  });
  app.post('/account/copyright/ask', async (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const slugs = [].concat((req.body || {}).w || []).map(String).filter(Boolean);
    const works = slugs.map(s => db.prepare("SELECT * FROM works WHERE slug=? AND maker_id=? AND status IN ('held','hidden')").get(s, m.id)).filter(w => w && regState(w).state === 'none');
    if (!works.length) return res.redirect('/account/copyright?ok=none');
    // Groups the Office's way: published / unpublished, by year made, up to GROUP each.
    const keys = new Set(works.map(w => `${w.status === 'held' ? 'p' : 'u'}:${String(madeAt(w) || '').slice(0, 4)}`)); let groups = 0; for (const k of keys) groups += Math.ceil(works.filter(w => `${w.status === 'held' ? 'p' : 'u'}:${String(madeAt(w) || '').slice(0, 4)}` === k).length / GROUP);
    const cents = groups * OFFICE_FEE;
    const id = db.prepare('INSERT INTO copyright_asks (maker_id, works, groups, cents) VALUES (?,?,?,?)').run(m.id, JSON.stringify(works.map(w => w.slug)), groups, cents).lastInsertRowid;
    if (!stripe || !m.email) return res.redirect('/account/copyright?ok=off');
    try {
      const s = await stripe.checkout.sessions.create({ mode: 'payment', submit_type: 'pay', customer_email: m.email,
        line_items: [{ quantity: groups, price_data: { currency: 'usd', unit_amount: OFFICE_FEE, product_data: { name: 'U.S. Copyright Office group registration', description: `The Office’s fee, at cost, per group of up to ${GROUP} works. ${works.length} work${works.length === 1 ? '' : 's'} in ${groups} group${groups === 1 ? '' : 's'}.` } } }],
        metadata: { copyright_ask: String(id) }, success_url: `${C.base}/account/copyright/thanks?id=${id}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${C.base}/account/copyright` });
      db.prepare('UPDATE copyright_asks SET stripe_session=? WHERE id=?').run(s.id, id);
      res.redirect(303, s.url);
    } catch (e) { console.error('[copyright]', e.message); db.prepare('DELETE FROM copyright_asks WHERE id=?').run(id); res.redirect('/account/copyright?ok=off'); }
  });
  function askPaid(id, s) {
    const a = db.prepare('SELECT * FROM copyright_asks WHERE id=?').get(Number(id)); if (!a || a.paid || (s && a.stripe_session !== s.id) || (s && s.payment_status !== 'paid')) return a;
    db.prepare("UPDATE copyright_asks SET paid=1, status='asked' WHERE id=?").run(a.id);
    ledger.append(db, 'copyright.asked', `ask-${a.id}`, { maker: mk(a.maker_id).handle, works: JSON.parse(a.works).length, groups: a.groups });
    const m = mk(a.maker_id);
    mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `Copyright filing asked: ${m.name}`, text: `${m.name} asks the house to register ${JSON.parse(a.works).length} work(s) in ${a.groups} group(s), paid ${money(a.cents)}.\n\n${C.base}/studio/copyright` }).catch(() => {});
    if (m.email) mail.send({ to: m.email, subject: 'Your registration is in hand', text: `${(m.name || '').split(/\s+/)[0]},\n\nThe house has your ask and the Office’s fee, and prepares the filing. You will hear when it is filed, and again when the Office registers it; the number is then written onto each work and its deed.\n\nThank you.\n\nWatermark, a Krafft company.` }).catch(() => {});
    return db.prepare('SELECT * FROM copyright_asks WHERE id=?').get(a.id);
  }
  app.get('/account/copyright/thanks', async (req, res) => {
    const a = db.prepare('SELECT * FROM copyright_asks WHERE id=?').get(Number(req.query.id)); if (!a) return res.sendStatus(404);
    if (!a.paid && stripe && req.query.session_id) { try { const s = await stripe.checkout.sessions.retrieve(String(req.query.session_id)); askPaid(a.id, s); } catch (e) { /* the webhook will */ } }
    res.redirect('/account/copyright?ok=asked');
  });
  app.locals.ownEvent = event => { if (event.type === 'checkout.session.completed') { const s = event.data.object; if (s.metadata && s.metadata.copyright_ask) askPaid(s.metadata.copyright_ask, s); } };
  // The Studio sees the asks beside its bridge.
  app.locals.copyrightAsks = () => db.prepare("SELECT a.*, m.name, m.handle FROM copyright_asks a JOIN makers m ON m.id=a.maker_id WHERE a.status='asked' ORDER BY a.at").all();
  app.post('/studio/copyright/asks/:id/filed', studioOnly, (req, res) => { db.prepare("UPDATE copyright_asks SET status='filed', filed_at=datetime('now') WHERE id=?").run(Number(req.params.id)); res.redirect('/studio/copyright'); });

  // Said simply.
  app.locals.saidSimply = (m, uses) => {
    const first = (m.name || '').split(/\s+/)[0] || 'The maker';
    const priced = uses.filter(u => u.price_cents > 0 && u.key !== 'social' && u.key !== 'reference'), asked = uses.filter(u => !u.price_cents && u.key !== 'social' && u.key !== 'reference');
    const FEE = require('./fee'); const part = u => `${u.name.toLowerCase().replace(/^in a story$/, 'in a story').replace(/^for a company$/, 'for a company')} for ${money(u.price_cents)}`;
    let s = `${first} says: you may use this ${priced.map(part).join(', ')}`.replace(/, ([^,]*)$/, ' or $1');
    if (!priced.length) s = `${first} says: ask, and I will answer`; else if (asked.length) s += `; for ${asked.map(u => u.name.toLowerCase()).join(' or ')}, ask`;
    return s + '.' + (FEE.on() && priced.length ? ` Every dollar of it is ${first}’s; the house’s share (${FEE.schedule()}) is paid on top.` : '');
  };
  return { yours, OFFICE_FEE, GROUP };
}
module.exports = { mountOwn };
