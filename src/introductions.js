// Introductions. The house is entered by invitation; an introduction is an invitation someone we trust may
// give. A maker in good standing has a few a year to introduce other makers (their name vouches; the account
// opens at once and the register says who introduced whom). The Studio issues partner links to curators,
// museums and artists it has a relationship with: a link that opens accounts (makers, or collectors) for as
// many as the house allows, with a label, until it is closed. Anyone may introduce collectors without limit.
const { layout, esc, date } = require('./views');
const MAKER_INTROS_A_YEAR = 5;   // a draft

function mountIntroductions(app, { db, C, mail, ledger, V, isStudio, makerOf, buyerOf, setMaker, setBuyer, slugify, DEFAULT_USES }) {
  db.exec(`CREATE TABLE IF NOT EXISTS introductions (id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, by_kind TEXT NOT NULL, by_id INTEGER, label TEXT, opens TEXT NOT NULL DEFAULT 'maker',
      uses INTEGER NOT NULL DEFAULT 0, max_uses INTEGER, closed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const [t, c] of [['makers', 'introduced_by'], ['buyers', 'introduced_by']]) if (!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name='${c}'`).get()) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT`);
  for (const c of ['to_name', 'note']) if (!db.prepare(`SELECT 1 FROM pragma_table_info('introductions') WHERE name='${c}'`).get()) db.exec(`ALTER TABLE introductions ADD COLUMN ${c} TEXT`);
  const { nanoid } = require('nanoid');
  const byToken = t => db.prepare('SELECT * FROM introductions WHERE token=?').get(String(t));
  const live = i => i && !i.closed && (i.max_uses == null || i.uses < i.max_uses);
  const introducer = i => (i.by_kind === 'house' ? { name: 'the house', line: 'house' } : i.by_kind === 'maker' ? (() => { const m = db.prepare('SELECT * FROM makers WHERE id=?').get(i.by_id); return m ? { name: m.name, line: `maker:${m.handle}`, slug: V.makerSlug(m) } : null; })() : (() => { const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(i.by_id); return b ? { name: b.name || 'a collector', line: `buyer:${b.code || b.id}`, code: b.public ? b.code : null } : null; })());
  const url = i => `${C.base}/i/${i.token}`;
  const mine = (kind, id) => db.prepare('SELECT * FROM introductions WHERE by_kind=? AND by_id=? ORDER BY id DESC').all(kind, id);
  const yearUsed = m => db.prepare("SELECT COALESCE(SUM(uses),0) n, COUNT(*) c FROM introductions WHERE by_kind='maker' AND by_id=? AND opens='maker' AND created_at > datetime('now','-1 year')").get(m.id);
  const make = ({ by_kind, by_id, label, opens, max_uses, to_name = null, note = null }) => { const id = db.prepare('INSERT INTO introductions (token, by_kind, by_id, label, opens, max_uses, to_name, note) VALUES (?,?,?,?,?,?,?,?)').run(nanoid(14), by_kind, by_id || null, label || null, opens === 'collector' ? 'collector' : 'maker', max_uses == null ? null : Number(max_uses), to_name || null, note || null).lastInsertRowid; return db.prepare('SELECT * FROM introductions WHERE id=?').get(id); };

  // Giving one. A maker: a few maker introductions a year, collectors without limit. The Studio: partner links.
  app.post('/account/introductions', (req, res) => {
    const m = makerOf(req); if (!m || m.standing === 'held') return res.sendStatus(401); const x = req.body || {};
    if (x.do === 'close') { db.prepare("UPDATE introductions SET closed=1 WHERE id=? AND by_kind='maker' AND by_id=?").run(Number(x.id), m.id); return res.redirect('/account/profile?ok=intro-closed#introductions'); }
    const opens = x.opens === 'collector' ? 'collector' : 'maker';
    if (opens === 'maker' && yearUsed(m).c >= MAKER_INTROS_A_YEAR) return res.redirect('/account/profile?ok=intro-limit#introductions');
    make({ by_kind: 'maker', by_id: m.id, label: String(x.label || '').trim().slice(0, 120) || null, opens, max_uses: opens === 'maker' ? 1 : null });
    res.redirect('/account/profile?ok=intro#introductions');
  });
  app.post('/yours/introductions', (req, res) => {
    const b = buyerOf(req); if (!b) return res.redirect('/yours'); const x = req.body || {};
    if (x.do === 'close') { db.prepare("UPDATE introductions SET closed=1 WHERE id=? AND by_kind='buyer' AND by_id=?").run(Number(x.id), b.id); return res.redirect('/yours?tab=settings#introductions'); }
    make({ by_kind: 'buyer', by_id: b.id, label: String(x.label || '').trim().slice(0, 120) || null, opens: 'collector', max_uses: null });
    res.redirect('/yours?tab=settings#introductions');
  });
  app.post('/studio/introductions', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login'); const x = req.body || {};
    if (x.do === 'close') { db.prepare('UPDATE introductions SET closed=1 WHERE id=?').run(Number(x.id)); return res.redirect('/studio/accounts?ok=Link+closed.#introductions'); }
    const toName = String(x.to_name || '').trim().slice(0, 120) || null, note = String(x.note || '').replace(/\r/g, '').trim().slice(0, 4000) || null;
    if (x.do === 'letter') { db.prepare('UPDATE introductions SET to_name=?, note=? WHERE id=?').run(toName, note, Number(x.id)); return res.redirect('/studio/accounts?ok=The+letter+is+set.#introductions'); }
    const i = make({ by_kind: 'house', label: String(x.label || '').trim().slice(0, 120) || toName, opens: x.opens, max_uses: x.max_uses ? Number(x.max_uses) : null, to_name: toName, note });
    ledger.append(db, 'introduction.issued', `intro-${i.id}`, { label: i.label, opens: i.opens });
    res.redirect(`/studio/accounts?ok=${encodeURIComponent(`A partner link for ${i.label || 'someone'}: ${url(i)}`)}#introductions`);
  });

  // The card (Will, 21 Oct, for the Leica Meatpacking evening: photographers on board on the spot): a printable page
  // with the QR of an introduction link, in the house's hand, for a phone to scan; the studio opens at once.
  app.get('/i/:token/card', (req, res) => {
    const i = db.prepare('SELECT * FROM introductions WHERE token=?').get(String(req.params.token)); if (!i) return res.sendStatus(404);
    const mine = i.by_kind === 'house' ? isStudio(req) : (i.by_kind === 'maker' ? ((app.locals.accounts && app.locals.accounts.makerOf(req)) || {}).handle === i.by_id.replace(/^maker:/, '') : false);
    if (!mine && !isStudio(req)) return res.sendStatus(403);
    const qr = require('./qr').svg(url(i), { size: 560 });
    res.send(V.layout({ title: `${i.label || 'An introduction'} · Watermark`, path: `/i/${i.token}/card`, bare: true, body: `<main class="inc"><section class="inc-card"><p class="k">Watermark${i.label ? ` · ${esc(i.label)}` : ''}</p><h1>${i.opens === 'maker' ? 'Your studio, now.' : 'Your gallery, now.'}</h1>
<p class="inc-lede">${i.opens === 'maker' ? 'Scan it. Photographers: your name, your email, and your studio opens; put a photograph in and it is deeded, fingerprinted and on the register in a minute. Everyone else: wander, and collect one for seven dollars.' : 'Scan it: your name, your email, and your gallery opens. Collect a photograph for seven dollars and it is yours, numbered, with its papers.'}</p>
<div class="inc-qr">${qr}</div><p class="inc-url">${esc(url(i).replace(/^https?:\/\//, ''))}</p><p class="inc-foot">${i.max_uses != null ? `Good for ${i.max_uses - i.uses} more.` : ''} Entered by invitation; introduced by the house.</p></section><p class="inc-print"><button type="button" class="link" onclick="print()">Print</button></p></main>` }));
  });
  // A letter (Will, 2 Nov, for Phil Penman: "create a space for him to realize what it is"): an introduction written to
  // one person. The Studio sets a name and a letter on a house link; /i/:token then reads as a page made for them: the
  // letter signed by the founding director, what the house is in five plain lines with live pictures, a strip to wander,
  // and the door to their own studio at the foot. Private (noindex, no-store); nothing on the register until they enter.
  const letterData = () => {
    const h = C.maker && C.maker.handle ? db.prepare('SELECT * FROM makers WHERE handle=?').get(C.maker.handle) : null;
    const strip = db.prepare("SELECT w.slug, w.title, w.width, w.height FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND COALESCE(w.zone,'all')<>'mature' AND COALESCE(m.kind,'maker') NOT IN ('institution') AND (w.curated=1 OR w.stars>=4) ORDER BY w.curated DESC, RANDOM() LIMIT 8").all();
    if (strip.length < 5) strip.push(...db.prepare("SELECT slug, title, width, height FROM works WHERE status='held' AND COALESCE(zone,'all')<>'mature' ORDER BY RANDOM() LIMIT 8").all().filter(w => !strip.some(x => x.slug === w.slug)).slice(0, 8 - strip.length));
    const n = db.prepare("SELECT COUNT(*) n FROM works WHERE status='held'").get().n;
    const makersN = db.prepare("SELECT COUNT(DISTINCT maker_id) n FROM works WHERE status='held'").get().n;
    return { cover: coverOf(), director: h, strip, n, makersN };
  };
  // Taking one up.
  // The cover: one of the house's best, wide, behind the door.
  const coverOf = () => db.prepare("SELECT slug, title FROM works WHERE status='held' AND width > height*1.3 AND (curated=1 OR stars>=4) ORDER BY curated DESC, stars DESC, RANDOM() LIMIT 1").get() || db.prepare("SELECT slug, title FROM works WHERE status='held' AND width > height*1.3 ORDER BY RANDOM() LIMIT 1").get() || null;
  app.get('/i/:token', (req, res) => {
    const i = byToken(req.params.token); if (!i || !live(i)) return res.status(404).send(gone());
    if (i.to_name || i.note) { res.set('X-Robots-Tag', 'noindex, nofollow'); res.set('Cache-Control', 'private, no-store'); return res.send(letterPage({ i, err: req.query.err || null, ...letterData() })); }
    res.send(introPage({ i, who: introducer(i), err: req.query.err || null, cover: coverOf(), make: req.query.make === '1' }));
  });
  app.post('/i/:token', (req, res) => {
    const i = byToken(req.params.token); if (!i || !live(i)) return res.status(404).send(gone());
    const who = introducer(i), x = req.body || {};
    const name = String(x.name || '').trim().slice(0, 120), email = String(x.email || '').trim().toLowerCase().slice(0, 160);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect(`/i/${i.token}?err=fields`);
    db.prepare('UPDATE introductions SET uses=uses+1 WHERE id=?').run(i.id);
    if (i.opens === 'maker') {
      if (db.prepare('SELECT 1 FROM makers WHERE email=?').get(email)) return res.redirect('/signin?next=/account');
      let handle = slugify(name), k = 2; while (db.prepare('SELECT 1 FROM makers WHERE handle=?').get(handle)) handle = `${slugify(name)}-${k++}`;
      const id = db.prepare("INSERT INTO makers (handle,name,email,house,kind,joined_at,introduced_by,site) VALUES (?,?,?,?,'maker',datetime('now'),?,?)").run(handle, name, email, null, who ? who.line : i.by_kind, String(x.site || '').trim().slice(0, 300) || null).lastInsertRowid;
      const ins = db.prepare('INSERT OR IGNORE INTO uses (maker_id,key,name,description,term_months,kind,sort,price_cents) VALUES (?,?,?,?,?,?,?,?)'); DEFAULT_USES.forEach(u => ins.run(id, ...u));
      const m = db.prepare('SELECT * FROM makers WHERE id=?').get(id);
      setMaker(res, m);
      ledger.append(db, 'maker.introduced', handle, { by: who ? who.line : i.by_kind, label: i.label });
      if (i.by_kind === 'maker') { const by = db.prepare('SELECT * FROM makers WHERE id=?').get(i.by_id); if (by && by.kind === 'gallery' && app.locals.galleries) { db.prepare("INSERT INTO representation (gallery_id, maker_id, pct, status, since) VALUES (?,?,?,'on',datetime('now'))").run(by.id, id, app.locals.galleries.DEFAULT_PCT); ledger.append(db, 'representation.began', handle, { gallery: by.handle, pct: app.locals.galleries.DEFAULT_PCT }); } }
      mail.send({ to: email, subject: 'Welcome to Watermark', text: `${name.split(' ')[0]},\n\n${who ? who.name : 'Someone'} introduced you to the house, and the door is open: your studio is ready. Put your work in; it is fingerprinted, registered and protected the moment it arrives, and shown when you say.\n\n${C.base}/account`, feature: 'Introduced', cta: { label: 'Open your studio', url: `${C.base}/account` } });
      if (who && i.by_kind === 'maker') { const by = db.prepare('SELECT * FROM makers WHERE id=?').get(i.by_id); if (by && by.email) mail.send({ to: by.email, subject: `${name} has joined on your introduction`, text: `${name} took up your introduction and has a studio in the house now. The register records that you introduced them.` }); }
      return res.redirect('/account?welcome=1');
    }
    let b = db.prepare('SELECT * FROM buyers WHERE email=?').get(email);
    if (!b) { const bid = db.prepare("INSERT INTO buyers (customer, email, name, code, introduced_by) VALUES ('', ?, ?, ?, ?)").run(email, name, nanoid(10), who ? who.line : i.by_kind).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(bid); }
    else if (!b.introduced_by) db.prepare('UPDATE buyers SET introduced_by=? WHERE id=?').run(who ? who.line : i.by_kind, b.id);
    setBuyer(res, b);
    mail.send({ to: email, subject: 'Welcome to Watermark', text: `${name.split(' ')[0]},\n\n${who ? who.name : 'Someone'} introduced you to the house. Your gallery is open: every photograph you collect hangs there, numbered; your cabinet is yours alone; your hangs are walls you curate from the whole collection.\n\n${C.base}/yours`, feature: 'Introduced', cta: { label: 'Your gallery', url: `${C.base}/yours` } });
    res.redirect('/yours?welcome=1');
  });

  // Who introduced whom, for the maker page.
  // A standing link for a gallery: one open introduction, good any number of times, that represents whoever comes through it.
  const linkFor = ({ by_kind, by_id, opens }) => { let i = db.prepare("SELECT * FROM introductions WHERE by_kind=? AND by_id=? AND opens=? AND max_uses IS NULL AND closed=0 ORDER BY id LIMIT 1").get(by_kind, by_id, opens); if (!i) i = make({ by_kind, by_id, opens, label: 'The gallery', max_uses: null }); return url(i).replace(/^https?:\/\/[^/]+/, ''); };
  app.locals.introductions = { mine, make, url, live, introducer, yearUsed, MAKER_INTROS_A_YEAR, linkFor, all: () => db.prepare('SELECT * FROM introductions ORDER BY closed, id DESC').all().map(i => ({ ...i, url: url(i), who: introducer(i) })),
    introducedBy: line => ({ makers: db.prepare('SELECT handle, name FROM makers WHERE introduced_by=?').all(line), collectors: db.prepare('SELECT COUNT(*) n FROM buyers WHERE introduced_by=?').get(line).n }),
    whoIntroduced: line => { if (!line) return null; const [k, v] = String(line).split(':'); if (k === 'maker') { const m = db.prepare('SELECT * FROM makers WHERE handle=?').get(v); return m ? { name: m.name, href: `/m/${V.makerSlug(m)}` } : null; } if (k === 'house') return { name: 'the house', href: '/about' }; const b = db.prepare('SELECT * FROM buyers WHERE code=?').get(v); return b ? { name: b.name || 'a collector', href: b.public ? `/collector/${b.code}` : null } : null; } };
  return app.locals.introductions;
}

function gone() { return layout({ title: 'An introduction · Watermark', body: `<section class="narrow cl"><p class="k">An introduction</p><h1>This introduction has been used, or closed.</h1><p class="lede">If you make work, <a href="/join">open your museum</a>; if you collect, the <a href="/collection">collection</a> is open to walk, and a gallery of your own begins with the first piece you collect.</p></section>` }); }

function introPage({ i, who, err, cover = null, make = false }) {
  // One door for everyone in the room (23 Oct, the Magnum night): the photograph behind, the question in front. A
  // maker's introduction asks "did you make something, or did you come to look?": makers give a name and an email and
  // their studio opens; everyone else wanders, and a gallery opens with the first Collect. A collector's introduction
  // opens the gallery at once.
  const maker = i.opens === 'maker';
  const FEE = require('./fee');
  const form = `<form method="post" action="/i/${esc(i.token)}" class="inv-f"><label><span>Your name</span><input name="name" required maxlength="120" autocomplete="name" autofocus></label><label><span>Email</span><input name="email" type="email" required maxlength="160" autocomplete="email" inputmode="email"></label>${maker ? '<label><span>Where your work can be seen <em>(optional)</em></span><input name="site" maxlength="300" placeholder="https://" inputmode="url"></label>' : ''}<button class="inv-go">${maker ? 'Open my studio' : 'Open my gallery'}</button>
<p class="inv-note">By entering you accept the house\u2019s <a href="/terms">terms</a>. Nothing is published until you say.</p></form>`;
  const body = maker && !make && !err
    ? `<div class="inv-doors"><a class="inv-door" href="/i/${esc(i.token)}?make=1"><small>I make things</small><b>Open my studio.</b><i>Your name and your email. Put one photograph in tonight: it is yours, deeded and on the register in a minute. ${esc(FEE.yours(85).replace(/^the/, 'The'))}.</i></a><a class="inv-door" href="/wander${cover ? `?at=${esc(cover.slug)}` : ''}" data-nv-wander><small>I came to look</small><b>Wander.</b><i>One work at a time, edge to edge. Collect one for seven dollars and a gallery of your own opens, numbered, with its papers.</i></a></div>`
    : `${err ? '<p class="inv-err">Your name and a working email are needed.</p>' : ''}${form}`;
  return layout({ title: `${i.label || 'An introduction'} \u00b7 Watermark`, path: `/i/${i.token}`, bare: true, body: `<main class="inv">${cover ? `<img class="inv-bg" src="/img/${esc(cover.slug)}/large" alt="" draggable="false">` : ''}<div class="inv-card">
<p class="k inv-k">${WAVE} Watermark${i.label ? ` \u00b7 ${esc(i.label)}` : ''}</p>
<h1>${who && who.name !== 'the house' ? `${esc(who.name)} introduces you.` : maker && !make && !err ? 'Welcome to the house.' : maker ? 'Your studio, now.' : 'Your gallery, now.'}</h1>
${maker && !make && !err ? '<p class="inv-lede">Watermark is where great work is kept: held by the person who made it, shown when they say, collected and licensed at the source. Which door?</p>' : ''}
${body}
${maker && (make || err) ? `<p class="inv-back"><a href="/i/${esc(i.token)}">\u2190 I came to look</a></p>` : ''}
</div>${cover ? `<p class="inv-cap">${esc(cover.title)}</p>` : ''}</main>` });
}
function letterPage({ i, err, cover, director, strip, n, makersN }) {
  const FEE = require('./fee');
  const to = i.to_name || '', first = to.split(/\s+/)[0] || '';
  const dName = director ? director.name : 'Will Fullerton', dFirst = dName.split(/\s+/)[0];
  const paras = String(i.note || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const pic = (w, k) => w ? `<img src="/img/${esc(w.slug)}/${k || 'screen'}" alt="" loading="lazy" draggable="false">` : '';
  const pts = [
    ['No numbers on the wall.', 'No likes, no counts, no feed deciding who is seen. How long someone stands before a picture is the only measure, and it stays between you and the house.'],
    ['Every picture, the whole screen.', 'One work at a time, edge to edge, at the size it was made to be seen. Wander is how people walk through it.'],
    ['Collectors, not followers.', `Anyone can own a piece. ${FEE.on && FEE.on() ? 'The price is yours; the house’s share is paid on top by the collector.' : 'Most of every sale is yours.'} You are paid every Friday.`],
    ['Yours, on the record.', 'Every file is fingerprinted, deeded and registered the minute it arrives; your name and copyright travel inside it. Companies license at your prices.'],
    ['The whole body of work.', 'Not only what does well: your trips in the order you shot them, your contact sheets, your best in front and the rest kept safe, shown when you say.'],
  ];
  const form = `<form method="post" action="/i/${esc(i.token)}" class="inv-f ltr-f"><label><span>Your name</span><input name="name" required maxlength="120" autocomplete="name" value="${esc(to)}"></label><label><span>Email</span><input name="email" type="email" required maxlength="160" autocomplete="email" inputmode="email"></label>${i.opens === 'maker' ? '<label><span>Where your work can be seen <em>(optional)</em></span><input name="site" maxlength="300" placeholder="https://" inputmode="url"></label>' : ''}<button class="inv-go">${i.opens === 'maker' ? 'Open my studio' : 'Open my gallery'}</button><p class="inv-note">No password: your email gets you in. Nothing is published until you say. <a href="/terms">The terms</a>.</p></form>`;
  return layout({ title: `${to ? `For ${to}` : 'A letter'} · Watermark`, path: `/i/${i.token}`, bare: true, body: `<main class="ltr">
<header class="ltr-hero">${pic(cover, 'large')}<div class="ltr-ht"><p class="ltr-k">${WAVE} Watermark${to ? ` · for ${esc(to)}` : ''}</p><h1>${first ? `${esc(first)}, a museum for your work.` : 'A museum for your work.'}</h1><p>${n.toLocaleString('en-US')} works by ${makersN} ${makersN === 1 ? 'maker' : 'makers'}, kept where they were made to be seen.</p><a class="ltr-down" href="#letter">Read the letter ↓</a></div>${cover ? `<p class="ltr-cap">${esc(cover.title)}</p>` : ''}</header>
${paras ? `<section class="ltr-letter" id="letter">${paras}<p class="ltr-sig">${director ? `<img src="/portrait/${esc(director.handle)}" alt="" onerror="this.remove()">` : ''}<span>${esc(dFirst)}<small>${esc(dName)} · founding director, Watermark</small></span></p></section>` : '<span id="letter"></span>'}
<section class="ltr-what"><p class="ltr-k2">What it is, in a minute</p><ol>${pts.map((p, k) => `<li>${pic(strip[k])}<div><b>${esc(p[0])}</b><span>${esc(p[1])}</span></div></li>`).join('')}</ol></section>
${strip.length ? `<section class="ltr-walk"><p class="ltr-k2">See it before you decide</p><div class="ltr-strip">${strip.slice(0, 8).map(w => `<a href="/wander?at=${esc(w.slug)}" data-nv-wander>${pic(w, 'thumb')}</a>`).join('')}</div><a class="ltr-wander" href="/wander${strip[0] ? `?at=${esc(strip[0].slug)}` : ''}" data-nv-wander>${WAVE} Wander the house first</a><p class="ltr-small">Best on your phone. Swipe up for the next; tap the shield for the record behind a picture.</p></section>` : ''}
<section class="ltr-door" id="door"><p class="ltr-k2">Your studio</p><h2>${first ? `When you are ready, ${esc(first)}.` : 'When you are ready.'}</h2><p class="ltr-lede">Your name and an email, and your studio opens. Put in one picture and it is yours on the record in a minute; nothing shows until you say.</p>${err ? '<p class="inv-err">Your name and a working email are needed.</p>' : ''}${form}</section>
</main>` });
}
const WAVE = require('./views').WAVE_MARK;
// On a maker's Your page, and on the Studio's Accounts: the links to give.
function introBlock({ list, used, limit, base, action, opens = true, studio = false }) {
  const row = i => `<li class="in-row"><span>${esc(i.label || (i.opens === 'maker' ? 'A maker' : 'Collectors'))}<small>${i.opens === 'maker' ? 'opens a studio' : 'opens galleries'} · ${i.uses} taken${i.max_uses != null ? ` of ${i.max_uses}` : ''}${i.closed ? ' · closed' : ''}${studio && i.who ? ` · by ${esc(i.who.name)}` : ''}</small></span>${i.closed || (i.max_uses != null && i.uses >= i.max_uses) ? '<code class="in-dead">used</code>' : `<a href="/i/${esc(i.token)}/card" class="in-card">Card</a> <code>${esc(base)}/i/${esc(i.token)}</code><button type="button" class="link" data-copy="${esc(base)}/i/${esc(i.token)}">Copy</button>`}${!i.closed ? `<form method="post" action="${action}"><input type="hidden" name="do" value="close"><input type="hidden" name="id" value="${i.id}"><button class="link">Close</button></form>` : ''}${studio && !i.closed ? `<details class="in-letter"><summary>${i.to_name || i.note ? `The letter to ${esc(i.to_name || 'them')}` : 'Write a letter'}</summary><form method="post" action="${action}" class="cl-f"><input type="hidden" name="do" value="letter"><input type="hidden" name="id" value="${i.id}"><label><span>Written to</span><input name="to_name" maxlength="120" value="${esc(i.to_name || '')}"></label><label><span>The letter</span><textarea name="note" rows="7" maxlength="4000">${esc(i.note || '')}</textarea></label><button class="buy-btn">Set it</button> <a href="/i/${esc(i.token)}" target="_blank" rel="noopener">See the page</a></form></details>` : ''}</li>`;
  return `<section class="in" id="introductions"><header class="gh"><h2>Introductions</h2><span>${studio ? 'partner links' : `${used} of ${limit} this year`}</span></header>
<p class="lede pk-lede">${studio ? 'A partner link opens accounts for a curator, a museum or an artist the house has a relationship with: as many as you set, until you close it. The register records who introduced whom.' : `The house is entered by invitation, and your name is one. You may introduce ${limit} makers a year: a link each, good once, that opens their studio at once; the register records that you introduced them. Introduce collectors without limit.`}</p>
${list.length ? `<ul class="in-list">${list.map(row).join('')}</ul>` : ''}
<form method="post" action="${action}" class="cl-f in-new"><label><span>For whom (a name or a note, shown on the letter)</span><input name="label" maxlength="120"></label>${opens ? `<fieldset><legend>Opens</legend><label class="cl-k"><input type="radio" name="opens" value="maker" checked> A maker's studio</label><label class="cl-k"><input type="radio" name="opens" value="collector"> A collector's gallery</label></fieldset>` : ''}${studio ? '<label><span>How many may take it (blank: no limit)</span><input name="max_uses" inputmode="numeric" maxlength="5"></label><label><span>Written to (a name; makes the link a page for them)</span><input name="to_name" maxlength="120" placeholder="Phil Penman"></label><label><span>A letter (shown on their page, signed by you; a blank line between paragraphs)</span><textarea name="note" rows="7" maxlength="4000"></textarea></label>' : ''}<button class="buy-btn">Make the link</button></form>
<script>document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');if(!b)return;navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1600)})})</script></section>`;
}

module.exports = { mountIntroductions, introBlock, MAKER_INTROS_A_YEAR };
