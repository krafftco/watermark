// The committees (Will, 20 Oct: "who hangs and how it's decided: that's where there's a real company that needs to be
// built"; one man in one chat is not an institution; "let's just make it so we can start building this thing").
//   Two committees, named from the house's own story (the keys of the restaurant opened the front door; a museum is
//   judged by its walls), each a set of seats the house gives by letter and takes back; the names are drafts:
//   THE FRONT DOOR decides who hangs: it reads the asks, each seat votes in the review room (hang, with the pieces
//     ticked for the first show, or not yet, with a word); COMMITTEE_NEEDED (2) votes to hang invite the maker and
//     hang the union of what the hanging voters ticked; the same number of not-yets answer the ask with their words.
//   THE WALLS decides what stays: it looks at what was hung in the last thirty days; the same number of votes send
//     a work back to the record (status hidden, never deleted, still deeded; the maker told) or set its room.
//   The director's say: while settings.committee_veto is on (the first season), the Studio's own decision stands
//   alone and at once, as before; a seat's vote is counted either way. Every decision carries the seats' handles
//   on the register (`maker.invited` by 'committee', `work.unhung`); `committee.voted` is hidden.
//   A seat is a person: the letter signs them in as themselves (`admit`); `reviewerOf(req)` finds the seat by the
//   signed-in email. Seats see /committee and the rooms, nothing else of the Studio.
const crypto = require('crypto');
const NEEDED = Number(process.env.COMMITTEE_NEEDED || 2);
const COMMITTEES = {
  door: { key: 'door', name: 'The Front Door', line: 'Who hangs. Reads every ask, looks at the edit large, and decides by two votes: hang the first show, or not yet, with a word back.' },
  walls: { key: 'walls', name: 'The Walls', line: 'What stays. Looks at everything hung in the last thirty days, and by two votes sends a work back to the record, or sets its room.' },
};

function mountCommittee(app, { db, V, C, ledger, mail, studioOnly, isStudio, buyerOf, makerOf }) {
  const { esc, tidy } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS reviewers (id INTEGER PRIMARY KEY, committee TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, label TEXT, token TEXT NOT NULL UNIQUE, invited_at TEXT NOT NULL DEFAULT (datetime('now')), joined_at TEXT, ended_at TEXT);
    CREATE TABLE IF NOT EXISTS committee_votes (id INTEGER PRIMARY KEY, committee TEXT NOT NULL, about TEXT NOT NULL, reviewer_id INTEGER NOT NULL, vote TEXT NOT NULL, hang TEXT, note TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(committee, about, reviewer_id));`);
  const dayOf = s => new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const first = n => String(n || '').split(/\s+/)[0];
  const seats = key => db.prepare('SELECT * FROM reviewers WHERE committee=? AND ended_at IS NULL ORDER BY id').all(key);
  const veto = () => (db.prepare("SELECT v FROM settings WHERE k='committee_veto'").get() || { v: '1' }).v !== '0';

  // Who sits here.
  function reviewerOf(req) {
    const emails = []; const b = buyerOf(req); if (b && b.email) emails.push(b.email.toLowerCase()); const m = makerOf(req); if (m && m.email) emails.push(m.email.toLowerCase());
    if (!emails.length) return [];
    return db.prepare(`SELECT * FROM reviewers WHERE ended_at IS NULL AND joined_at IS NOT NULL AND lower(email) IN (${emails.map(() => '?').join(',')})`).all(...emails);
  }
  const sits = (req, key) => reviewerOf(req).find(r => r.committee === key) || null;
  app.locals.committee = { COMMITTEES, NEEDED, seats, reviewerOf, sits };

  // The house gives a seat by letter, and takes it back.
  app.post('/studio/committee/seat', studioOnly, (req, res) => {
    const b = req.body || {}; const key = COMMITTEES[b.committee] ? b.committee : null; const name = String(b.name || '').trim().slice(0, 80), email = String(b.email || '').trim().toLowerCase().slice(0, 160), label = String(b.label || '').trim().slice(0, 80);
    if (!key || !name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect('/studio/committee?ok=' + encodeURIComponent('A committee, a name and an email.'));
    const token = crypto.randomBytes(18).toString('base64url');
    db.prepare('INSERT INTO reviewers (committee, name, email, label, token) VALUES (?,?,?,?,?)').run(key, name, email, label || null, token);
    const cm = COMMITTEES[key];
    mail.send({ to: email, subject: `A seat on ${cm.name}`, text: `${first(name)},\n\nThe house asks you to sit on ${cm.name}, the committee of Watermark that decides ${key === 'door' ? 'who hangs' : 'what stays on the walls'}.\n\n${cm.line}\n\nYour seat opens here, once: ${C.base}/committee/join/${token}\n\nIt is work, and it is an honour; the house is grateful. Thank you.\n\nWatermark, a Krafft company.` }).catch(() => {});
    ledger.append(db, 'committee.seated', key, { name, label: label || undefined });
    res.redirect('/studio/committee?ok=' + encodeURIComponent(`${name} is written to.`));
  });
  app.post('/studio/committee/seat/:id/end', studioOnly, (req, res) => { db.prepare("UPDATE reviewers SET ended_at=datetime('now') WHERE id=?").run(Number(req.params.id)); res.redirect('/studio/committee?ok=' + encodeURIComponent('The seat is taken back.')); });
  app.post('/studio/committee/veto', studioOnly, (req, res) => { db.prepare("INSERT INTO settings (k, v) VALUES ('committee_veto', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run((req.body || {}).on ? '1' : '0'); res.redirect('/studio/committee'); });
  app.get('/committee/join/:token', (req, res) => {
    const r = db.prepare('SELECT * FROM reviewers WHERE token=? AND ended_at IS NULL').get(String(req.params.token)); if (!r) return res.sendStatus(404);
    if (app.locals.admit) app.locals.admit(req, res, r.email);
    const b = db.prepare('SELECT * FROM buyers WHERE lower(email)=lower(?)').get(r.email); if (b && !b.name) db.prepare('UPDATE buyers SET name=? WHERE id=?').run(r.name, b.id);
    db.prepare("UPDATE reviewers SET joined_at=COALESCE(joined_at, datetime('now')) WHERE id=?").run(r.id);
    res.redirect('/committee?welcome=1');
  });

  // The Studio's page: the committees, their seats, the standing of each ask and the recent hangs.
  app.get('/studio/committee', studioOnly, (req, res) => {
    const body = `<article class="cmt"><p class="k">The house</p><h1>The committees.</h1>
<p class="lede">Who hangs, and what stays, decided by more than one pair of eyes. Each seat is given by letter and can be taken back. ${NEEDED} votes decide. ${veto() ? 'The director’s say is on: the Studio’s own decision stands alone, as in the first season.' : 'The director’s say is off: the committees decide.'}</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
${Object.values(COMMITTEES).map(cm => `<section class="cmt-c"><h2>${esc(cm.name)}</h2><p>${esc(cm.line)}</p>
<ul class="cmt-seats">${seats(cm.key).map(r => `<li><b>${esc(r.name)}</b>${r.label ? ` · ${esc(r.label)}` : ''} · ${r.joined_at ? `sat ${esc(dayOf(r.joined_at))}` : `written to ${esc(dayOf(r.invited_at))}`} <form method="post" action="/studio/committee/seat/${r.id}/end" class="inline"><button class="link">Take back the seat</button></form></li>`).join('') || '<li class="note">No seats yet.</li>'}</ul>
<form method="post" action="/studio/committee/seat" class="cmt-f"><input type="hidden" name="committee" value="${cm.key}"><input name="name" placeholder="Name" required><input name="email" type="email" placeholder="Email" required><input name="label" placeholder="As (a gallerist, a maker of the house…)"><button class="buy-btn">Give a seat</button></form></section>`).join('')}
<form method="post" action="/studio/committee/veto" class="cmt-veto"><label><input type="checkbox" name="on" value="1"${veto() ? ' checked' : ''}> The director’s say (the Studio decides alone, at once)</label><button class="link">Keep</button></form>
<p><a href="/committee">The committees’ desk</a> · <a href="/hanging">The standard, as the public reads it</a></p></article>`;
    res.send(V.layout({ title: 'The committees · Watermark', path: '/studio', body, desk: true }));
  });

  // The desk: what waits for each seat the person holds (the Studio sees both).
  const asks = () => db.prepare("SELECT a.*, m.name, m.handle, m.id AS mid FROM house_asks a JOIN makers m ON m.id=a.maker_id WHERE a.answer IS NULL ORDER BY a.at").all();
  const recent = () => db.prepare("SELECT w.*, m.name AS maker_name, m.handle FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND w.id IN (SELECT CAST(json_extract(data,'$.id') AS INTEGER) FROM ledger WHERE 0) OR (w.status='held' AND w.created_at >= datetime('now','-30 days')) ORDER BY w.created_at DESC LIMIT 60").all();
  const votesOn = (key, about) => db.prepare('SELECT v.*, r.name, r.label FROM committee_votes v JOIN reviewers r ON r.id=v.reviewer_id WHERE v.committee=? AND v.about=? ORDER BY v.at').all(key, about);
  app.get('/committee', (req, res) => {
    const mine = reviewerOf(req), house = isStudio(req);
    if (!mine.length && !house) return res.status(401).send(V.layout({ title: 'The committees · Watermark', path: '/committee', body: `<article class="cmt"><p class="k">The house</p><h1>The committees.</h1><p class="lede">Seats are given by letter. If you hold one, <a href="/signin">sign in</a> with the address the letter came to.</p><p><a href="/hanging">How the house decides who hangs</a></p></article>` }));
    const has = key => house || mine.some(r => r.committee === key);
    const body = `<article class="cmt"><p class="k">The committees</p><h1>${req.query.welcome ? 'Welcome. Your seat is open.' : 'The desk.'}</h1>
<p class="lede">${mine.length ? `You sit on ${mine.map(r => COMMITTEES[r.committee].name).join(' and ')}.` : 'The house sees both committees.'} ${NEEDED} votes decide; every decision is told on the register with the seats’ names.</p>
${has('door') ? `<section class="cmt-c"><h2>${COMMITTEES.door.name}</h2><p class="note">${COMMITTEES.door.line}</p>
<ul class="cmt-l">${asks().map(a => { const vs = votesOn('door', 'ask:' + a.id); return `<li><b>${esc(a.name)}</b> · asked ${esc(dayOf(a.at))}${a.note ? ` · <em>${esc(a.note)}</em>` : ''} · ${vs.length ? vs.map(v => `${esc(first(v.name))}: ${v.vote === 'hang' ? 'hang' : 'not yet'}`).join(', ') : 'no votes yet'} · <a href="/committee/review/${a.mid}">Look</a></li>`; }).join('') || '<li class="note">Nothing waits.</li>'}</ul></section>` : ''}
${has('walls') ? `<section class="cmt-c"><h2>${COMMITTEES.walls.name}</h2><p class="note">${COMMITTEES.walls.line}</p>
<div class="rv-grid">${recent().map(w => { const vs = votesOn('walls', 'work:' + w.id); return `<div class="rv-w cmt-w"><a href="/w/${esc(w.slug)}" target="_blank" rel="noopener"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"></a><span class="rv-cap">${esc(tidy(w.title || w.slug))} · ${esc(w.maker_name)} · ${'★'.repeat(w.stars || 0) || 'ungraded'}${vs.length ? ` · ${vs.map(v => `${esc(first(v.name))}: ${esc(v.vote)}`).join(', ')}` : ''}</span>
<form method="post" action="/committee/walls/${w.id}" class="cmt-wf"><button name="vote" value="down" class="link">Back to the record</button> · <button name="vote" value="mature" class="link">Not for children</button><input name="note" placeholder="a word" maxlength="200"></form></div>`; }).join('') || '<p class="note">Nothing hung in thirty days.</p>'}</div></section>` : ''}
<p><a href="/hanging">The standard</a></p></article>`;
    res.send(V.layout({ title: 'The committees · Watermark', path: '/committee', body }));
  });

  // The Front Door's review room: the house's room, with the vote beneath.
  app.get('/committee/review/:id', (req, res) => {
    const seat = sits(req, 'door'), house = isStudio(req); if (!seat && !house) return res.sendStatus(401);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(Number(req.params.id)); if (!m) return res.sendStatus(404);
    const ask = db.prepare('SELECT * FROM house_asks WHERE maker_id=? AND answer IS NULL ORDER BY id DESC LIMIT 1').get(m.id);
    const r = app.locals.readiness(m); const show = r.edit.length ? r.edit : r.all.slice(0, 12);
    const vs = ask ? votesOn('door', 'ask:' + ask.id) : []; const mineV = seat ? vs.find(v => v.reviewer_id === seat.id) : null;
    const body = `<article class="rv"><p class="k">${COMMITTEES.door.name}</p><h1>${esc(m.name)}</h1>
<p class="lede">${esc(m.place || '')}${m.place ? ' · ' : ''}${r.all.length} works recorded · ${r.edit.length} in the edit · ${r.big.length} of the edit at ${app.locals.ready.READY_MP} MP+</p>
${ask ? `<p class="rv-ask">Asked on ${esc(dayOf(ask.at))}${ask.note ? `: <em>${esc(ask.note)}</em>` : ''}</p>` : '<p class="note">No ask waits; the room is open to look.</p>'}
${m.bio ? `<blockquote class="rv-bio">${esc(m.bio)}</blockquote>` : ''}
${vs.length ? `<ul class="cmt-votes">${vs.map(v => `<li><b>${esc(v.name)}</b>${v.label ? ` · ${esc(v.label)}` : ''}: ${v.vote === 'hang' ? 'hang' : 'not yet'}${v.note ? ` · <em>${esc(v.note)}</em>` : ''}</li>`).join('')}</ul>` : ''}
<p class="note">The standard: craft, honesty and a body of work. The house never tells an artist what to make. <a href="/hanging">Read it whole</a>.</p>
${ask && seat ? `<form method="post" action="/committee/review/${m.id}/vote" class="rv-f">
<div class="rv-grid">${show.map(w => `<label class="rv-w"><input type="checkbox" name="hang" value="${esc(w.slug)}"${(w.stars || 0) >= 4 ? ' checked' : ''}><img src="/img/${esc(w.slug)}/screen" alt="" loading="lazy"><span class="rv-cap">${esc(tidy(w.title || w.slug))}${w.place ? ` · ${esc(w.place)}` : ''} · ${'★'.repeat(w.stars || 0) || 'ungraded'} · ${w.width && w.height ? Math.round(w.width * w.height / 1e6) + ' MP' : '?'}</span></label>`).join('')}</div>
<label>A word, kept with your vote (shown to the maker if the answer is not yet)<textarea name="note" maxlength="600" rows="2"></textarea></label>
<p class="rv-acts"><button class="buy-btn" name="vote" value="hang">Hang: the ticked pieces as the first show</button> <button class="link" name="vote" value="notyet">Not yet</button>${mineV ? ` <span class="note">You voted ${mineV.vote === 'hang' ? 'hang' : 'not yet'}; voting again replaces it.</span>` : ''}</p></form>` : ''}
${house ? `<p><a href="/studio/review/${m.id}">The Studio’s room</a></p>` : ''}
<p><a href="/committee">Back to the desk</a></p></article>`;
    res.send(V.layout({ title: `${COMMITTEES.door.name} · ${m.name}`, path: '/committee', body }));
  });
  app.post('/committee/review/:id/vote', (req, res) => {
    const seat = sits(req, 'door'); if (!seat) return res.sendStatus(401);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(Number(req.params.id)); if (!m) return res.sendStatus(404);
    const ask = db.prepare('SELECT * FROM house_asks WHERE maker_id=? AND answer IS NULL ORDER BY id DESC LIMIT 1').get(m.id); if (!ask) return res.redirect('/committee');
    const b = req.body || {}; const vote = b.vote === 'hang' ? 'hang' : 'notyet'; let hang = b.hang; hang = Array.isArray(hang) ? hang : hang ? String(hang).split(',') : [];
    const note = String(b.note || '').replace(/<[^>]*>/g, '').trim().slice(0, 600) || null;
    db.prepare("INSERT INTO committee_votes (committee, about, reviewer_id, vote, hang, note) VALUES ('door', ?, ?, ?, ?, ?) ON CONFLICT(committee, about, reviewer_id) DO UPDATE SET vote=excluded.vote, hang=excluded.hang, note=excluded.note, at=datetime('now')").run('ask:' + ask.id, seat.id, vote, JSON.stringify(hang.slice(0, 60)), note);
    ledger.append(db, 'committee.voted', m.handle, { committee: 'door', seat: seat.name, vote });
    const vs = votesOn('door', 'ask:' + ask.id); const ups = vs.filter(v => v.vote === 'hang'), downs = vs.filter(v => v.vote === 'notyet');
    if (ups.length >= NEEDED) {
      const union = [...new Set(ups.flatMap(v => { try { return JSON.parse(v.hang || '[]'); } catch (e) { return []; } }))];
      app.locals.inviteMaker(m, union, { by: 'committee', seats: ups.map(v => v.name) });
      return res.redirect('/committee?ok=' + encodeURIComponent(`${m.name} is invited; the first show is hung.`));
    }
    if (downs.length >= NEEDED) {
      const words = downs.map(v => v.note).filter(Boolean).join('\n\n') || 'Not yet. Keep bringing it in; the house will look again.';
      app.locals.answerAsk(m, ask, words, { by: 'committee', seats: downs.map(v => v.name) });
      return res.redirect('/committee?ok=' + encodeURIComponent(`${m.name} is written to.`));
    }
    res.redirect('/committee?ok=' + encodeURIComponent(`Your vote is kept. ${NEEDED - Math.max(ups.length, downs.length)} more decide.`));
  });

  // The Walls: a vote on a hung work.
  app.post('/committee/walls/:id', (req, res) => {
    const seat = sits(req, 'walls'); if (!seat) return res.sendStatus(401);
    const w = db.prepare("SELECT * FROM works WHERE id=? AND status='held'").get(Number(req.params.id)); if (!w) return res.redirect('/committee');
    const b = req.body || {}; const vote = b.vote === 'mature' ? 'mature' : 'down'; const note = String(b.note || '').replace(/<[^>]*>/g, '').trim().slice(0, 200) || null;
    db.prepare("INSERT INTO committee_votes (committee, about, reviewer_id, vote, note) VALUES ('walls', ?, ?, ?, ?) ON CONFLICT(committee, about, reviewer_id) DO UPDATE SET vote=excluded.vote, note=excluded.note, at=datetime('now')").run('work:' + w.id, seat.id, vote, note);
    ledger.append(db, 'committee.voted', w.slug, { committee: 'walls', seat: seat.name, vote });
    const vs = votesOn('walls', 'work:' + w.id).filter(v => v.vote === vote);
    if (vs.length >= NEEDED) {
      const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id);
      if (vote === 'down') {
        db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(w.id); if (app.locals.findIndexDirty) app.locals.findIndexDirty();
        ledger.append(db, 'work.unhung', w.slug, { maker: m.handle, by: 'committee', seats: vs.map(v => v.name) });
        if (app.locals.notify) try { app.locals.notify.tell({ maker_id: m.id, kind: 'show', href: `/account/works/${w.slug}`, title: `${tidy(w.title)} was taken down by the Walls`, body: (vs.map(v => v.note).filter(Boolean).join(' ') || 'It stays in your record, yours and deeded.').slice(0, 200) }); } catch (e) { /* told by mail */ }
        if (m.email) mail.send({ to: m.email, subject: `${tidy(w.title)} comes down`, text: `${first(m.name)},\n\nThe Walls, the committee of the house that decides what stays, has taken ${tidy(w.title)} off the walls. It stays in your record, yours and deeded, and you may bring it back with the rest of your edit when the house looks again.\n\n${vs.map(v => v.note).filter(Boolean).join('\n\n')}\n\nThank you for making it.\n\nWatermark, a Krafft company.` }).catch(() => {});
      } else {
        db.prepare("UPDATE works SET zone='mature', zone_note=COALESCE(zone_note, ?) WHERE id=?").run(vs.map(v => v.note).filter(Boolean)[0] || 'set by the Walls', w.id); if (app.locals.findIndexDirty) app.locals.findIndexDirty();
        ledger.append(db, 'work.roomed', w.slug, { maker: m.handle, by: 'committee', seats: vs.map(v => v.name) });
      }
      return res.redirect('/committee?ok=' + encodeURIComponent(vote === 'down' ? `${tidy(w.title)} is back in the record.` : `${tidy(w.title)} hangs in the adult rooms.`));
    }
    res.redirect('/committee?ok=' + encodeURIComponent(`Your vote is kept. ${NEEDED - vs.length} more decide.`));
  });

  // The standard, as the public reads it (every word a draft for Will).
  app.get('/hanging', (req, res) => {
    const d = seats('door'), wl = seats('walls');
    const who = rs => rs.filter(r => r.joined_at).map(r => `${esc(first(r.name))}${r.label ? `, ${esc(r.label)}` : ''}`).join(' · ');
    res.send(V.layout({ title: 'Who hangs · Watermark', path: '/hanging', desc: 'How the house decides who hangs and what stays.', body: `<article class="hg-std"><p class="k">The house</p><h1>Who hangs, and how it is decided.</h1>
<p class="lede">Everyone may put work in the record the day they make it; it is kept, deeded and theirs. The walls are a museum’s, and hanging there is by invitation. This is how the invitation is decided, so that the standard is public and no one person is the standard.</p>
<h2>The standard</h2>
<p>The house looks for three things. <b>Craft</b>: the work is made with command of its means, whatever they are. <b>Honesty</b>: it is the maker’s own, made as it says it was, with the rights to show it. <b>A body of work</b>: not one picture but an edit, a way of seeing that holds across many. The house has its own eye and never tells an artist what to make. It has no house style; it refuses what is cheap, crude or offensive, and nothing else on principle.</p>
<h2>The moment</h2>
<p>The house reads readiness from the work, not from a form: ${app.locals.ready.READY_WORKS} works recorded; an edit of ${app.locals.ready.READY_BEST} or more that the maker graded four or five stars, each titled, placed, dated and given a sentence; the edit at ${app.locals.ready.READY_MP} megapixels or more, so it can be printed, published and sold at every size; a page in the maker’s own words and their prices. Then the maker asks the house to look.</p>
<h2>${esc(COMMITTEES.door.name)}</h2>
<p>${esc(COMMITTEES.door.line)} ${NEEDED} votes decide. A seat looks at the edit large, with the maker’s own grades and the files’ sizes beside each piece, and votes to hang, ticking the pieces for the first show, or not yet, with a word that is sent to the maker. Every ask is answered within the month, in words.${d.length ? ` Sitting now: ${who(d) || 'seats written to'}.` : ''}</p>
<h2>${esc(COMMITTEES.walls.name)}</h2>
<p>${esc(COMMITTEES.walls.line)} A work taken down is never deleted: it returns to the maker’s record, deeded and theirs, and may come back with their next edit.${wl.length ? ` Sitting now: ${who(wl) || 'seats written to'}.` : ''}</p>
<h2>The register</h2>
<p>Every invitation, every first show and every work taken down is told on <a href="/ledger">the register</a> with the seats that decided it. In the house’s first season the founding director may decide alone; the page says so while it is true${veto() ? ' (it is)' : ' (it is not)'}.</p>
<p><a href="/own">You already own it</a> · <a href="/record">Begin the record</a> · <a href="/makers">For those who make</a></p></article>` }));
  });
}
module.exports = { mountCommittee, COMMITTEES, NEEDED };
