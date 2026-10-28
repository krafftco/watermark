// The peephole (Will, 28 Oct: "a brief room, private, only for him; a view into Watermark and Krafft; cut holes into
// the business so he can see into it; the data room"; for Ross Perot Jr. first, "our guide", with the care not to
// put too much trust in anyone: a reader sees the house's own numbers and papers, never a person's name, never a key).
// A reader is named by the house (Studio → People → The peephole): a letter carries a one-time door, /peephole/open/:token,
// which admits the device for a year (cookie wm_ph); a reader signed in with the same email is admitted too; the house
// takes the keys back any time. The room: the brief (a newspaper for one reader, written as Franklin wrote to
// Washington: facts, numbers, the ask, no flattery), the numbers as they stand (the owner's view, live), lately on the
// register, the papers, and a line the reader may leave for the director. Nothing of a reader on the public register.
const crypto = require('crypto');

function mountPeephole(app, { db, V, C, ledger, mail, isStudio, studioOnly }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS readers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, note TEXT, token TEXT UNIQUE NOT NULL, since TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT, visits INTEGER NOT NULL DEFAULT 0, ended_at TEXT, letter_at TEXT);
    CREATE TABLE IF NOT EXISTS reader_lines (id INTEGER PRIMARY KEY, reader_id INTEGER NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  const esc = V.esc, money = V.money;
  const first = n => String(n || '').split(/\s+/)[0];
  const emailOf = req => { const L = app.locals; const m = L.accounts && L.accounts.makerOf ? L.accounts.makerOf(req) : null; const b = L.buyerOf ? L.buyerOf(req) : null; return (m && m.email) || (b && b.email) || null; };
  function baseReader(req) {
    const t = req.cookies && req.cookies.wm_ph; let r = t ? db.prepare('SELECT * FROM readers WHERE token=? AND ended_at IS NULL').get(t) : null;
    if (!r) { const e = emailOf(req); if (e) r = db.prepare('SELECT * FROM readers WHERE lower(email)=lower(?) AND ended_at IS NULL').get(e) || null; }
    return r;
  }
  // The Studio is admitted as a reader called the house, so the director reads what the reader reads.
  const readerOf = req => baseReader(req) || (isStudio(req) ? { id: 0, name: 'The house', email: '', token: null } : null);
  const noStore = res => { res.set('Cache-Control', 'private, no-store'); res.set('X-Robots-Tag', 'noindex, nofollow'); };

  // --- The door.
  app.get('/peephole/open/:token', (req, res) => {
    const r = db.prepare('SELECT * FROM readers WHERE token=? AND ended_at IS NULL').get(req.params.token); if (!r) return res.redirect('/peephole');
    res.cookie('wm_ph', r.token, { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: 365 * 86400e3 });
    res.redirect('/peephole');
  });

  // --- The brief: written once, read with the live numbers in it. Every word a draft for Will.
  function numbers() {
    const t = f => { try { return f(); } catch (e) { return null; } };
    const O = t(() => app.locals.deskOwner && app.locals.deskOwner()) || {};
    const clients = t(() => db.prepare('SELECT COUNT(*) n FROM clients').get().n) || 0;
    const placements = t(() => db.prepare('SELECT COALESCE(SUM(n),0) n, COUNT(DISTINCT host) hosts FROM placements').get()) || { n: 0, hosts: 0 };
    const clientLic = t(() => db.prepare("SELECT COUNT(*) n FROM licenses WHERE licensee_company IS NOT NULL AND status='active'").get().n) || 0;
    const studios = t(() => db.prepare('SELECT COUNT(*) n FROM studios_imports').get().n) || 0;
    const institutions = t(() => db.prepare("SELECT COUNT(*) n FROM makers WHERE kind='institution'").get().n) || 0;
    const firstEntry = t(() => db.prepare('SELECT at FROM ledger ORDER BY seq LIMIT 1').get()) || null;
    return { O, clients, placements, clientLic, studios, institutions, firstEntry };
  }
  function brief(r, N) {
    const O = N.O, g = O.growth || {}, m = O.money || {}, v = O.vault || {}, reg = O.register || {}, live = O.live || {};
    const gb = v.bytes ? (v.bytes / 1e9).toFixed(1) : '0';
    const founded = N.firstEntry ? new Date(N.firstEntry.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'October 2026';
    const S = (k, h, body) => `<section class="ph-s" id="${k}"><h2 class="ph-h">${h}</h2>${body}</section>`;
    return `
<p class="ph-sal">Sir,</p>
<p class="ph-lede">You asked to be brought up to speed. This room is where that happens. What follows is set down as plainly as I can set it, in the order a reader of newspapers would want it: what the thing is, why it matters, what it has done so far, what is in prospect, and what is asked of you. The numbers in it are the house's own and are drawn fresh each time the page is opened; nothing here was typed in by hand. Where a word is mine and not yet a fact, I say so.</p>
${S('what', 'I. What this is', `
<p><b>Watermark is a registry for work made by people, with a museum on top of it.</b> A maker puts the master of a photograph, a painting, a book or a recording into the vault. The house fingerprints it, writes it into a public register the day it arrives, and gives the maker a deed. From then on anyone may look at it for nothing, and anyone may own a numbered piece of it for seven dollars, or license it for a story, a company or a wall at the maker's price. The maker is paid every Friday. The house's share is paid by the collector on top of the maker's price and is published, the way an auction house publishes its premium.</p>
<p>Three things are true of it that are not true of anything else in the trade. The master is never touched: what the maker gave us is what the collector takes, with the papers written inside the file. The register is public, signed, and stamped every hour into a clock the house does not own, so the house itself cannot rewrite what it said. And there is no advertising, now or ever; nothing counts you; the only thing sold is the work.</p>
<p>Founded ${esc(founded)}, Dallas and New York. A Krafft company; Krafft Studios made the founding collection and makes the house's media.</p>`)}
${S('why', 'II. Why it matters', `
<p>Every picture on the internet is now suspect. The machines make them by the million, the platforms cannot tell a photograph from a fabrication, and the people who made the real ones are not paid. The institutions that hold the world's art (the Met, the Library of Congress, the Smithsonian) each keep their own records in their own formats behind four addresses and a PDF to print and post. There is no registry for made work that is neutral, open, and trusted the way a title company is trusted for land.</p>
<p>That is the gap. It is an infrastructure gap, and infrastructure companies are the quiet ones that every other company pays. Visa does not sell shoes. The value of such a registry rises with every surface that uses it, and the registry is worth more <i>not</i> owned by any one platform, which is why the plan is for a foundation to hold the register and the standard and license them to the operating company. That, with counsel, is the next piece of paper.</p>
<p>The house also keeps a museum on top, because a registry that no one visits is a filing cabinet. Wander shows one work at a time, true to size, with its record beneath it. People come to look, and stay, and some of them buy. The museum is the proof that the registry works and the reason anyone has heard of it.</p>`)}
${S('record', 'III. The record so far', `
<ul class="ph-facts">
<li><b>${(v.works || 0).toLocaleString('en-US')}</b> works held, <b>${esc(gb)} GB</b> of masters in the vault, by <b>${(g.makers && g.makers.n) || 0}</b> makers; <b>${N.institutions}</b> institution${N.institutions === 1 ? '' : 's'}.</li>
<li><b>${(reg.entries || 0).toLocaleString('en-US')}</b> entries on the register, ${reg.ok ? 'every one intact' : '<b>a break</b>'}${reg.anchors && reg.anchors.bitcoin ? `; anchored in Bitcoin to entry ${reg.anchors.bitcoin.seq}` : ''}.</li>
<li><b>${(g.collectors && g.collectors.n) || 0}</b> collectors have paid for a piece; <b>${(O.theNumber && O.theNumber.strangersThisWeek) || 0}</b> pieces were collected by strangers this week against ${(O.theNumber && O.theNumber.strangersLastWeek) || 0} the week before. ${g.comeBack && g.comeBack.n >= 3 ? `${g.comeBack.pct}% of collectors come back for a second piece within sixty days.` : 'Too few collectors yet to say how many come back; the figure will appear here when there are.'}</li>
<li>Sales: <b>${money(m.week ? m.week.total : 0)}</b> this week, <b>${money(m.month ? m.month.total : 0)}</b> this month, <b>${money(m.all ? m.all.total : 0)}</b> since the first day; of that, ${money(m.all ? m.all.makers : 0)} to makers.${m.fridayLast ? ` Last Friday pay: ${money(m.fridayLast.amount || 0)} to ${m.fridayLast.makers || 0} maker${m.fridayLast.makers === 1 ? '' : 's'}.` : ''}</li>
<li>Visitors: <b>${(O.people && O.people.visitors7d) || 0}</b> this week (${(O.people && O.people.visitorsPrior) || 0} the week before); ${(O.people && O.people.stood7d) || 0} stood before a work long enough to be counted.</li>
<li>The machine: Postgres, a worker beside the web, a vault in S3, an edge in front, nightly sealed backups with a weekly restore drill, two factors on the Studio door, an audit of every act. ${live.up ? `Up ${Math.round(live.up / 3600)} hours since the last deploy;` : ''} version ${esc(O.velocity && O.velocity.version || '')}, ${(O.velocity && O.velocity.releases) || 0} releases since launch.</li>
</ul>
<p class="ph-note">These are small numbers and I will not dress them. The house opened on ${esc(founded)}. What the numbers show is that every part of the machine works end to end with real money, and that strangers pay. The next job is supply: the founding collection's masters at full size, and the first ten makers who are not me.</p>`)}
${S('studios', 'IV. Krafft Studios: the first surface', `
<p>Krafft Studios is the magazine and the production house; Watermark is the thing it is built on. Every photograph on a Studios story carries the mark: ${N.studios.toLocaleString('en-US')} pictures are matched to their records in the house, and a reader who stops on one can collect it or license it without leaving the page. Each story carries its credits and a Tip button, shared among the people who made it.</p>
<p>What it represents: Studios is the first proof that a publisher can run on the registry. The pictures in the magazine are not decoration; each is an asset with a number, a deed and a price, and the magazine is a shop window that never says so. Every publisher in the world has the same pictures and the same problem.</p>`)}
${S('natora', 'V. Natora: the first company', `
<p>Natora is the first corporation licensing the house's photographs with the images linked into its own site. The Studio grants each picture as an ordinary licence; a line of code on their site asks the house for the image, which is served under its licence with the credit and the Watermark number on it, and counted by the page it hangs on. When the licence ends, the picture quietly says so. Today: ${N.clients} compan${N.clients === 1 ? 'y' : 'ies'}, ${N.clientLic} live corporate licence${N.clientLic === 1 ? '' : 's'}, ${N.placements.n.toLocaleString('en-US')} placements counted across ${N.placements.hosts} site${N.placements.hosts === 1 ? '' : 's'}.</p>
<p>What it represents: a Getty-shaped business with none of Getty's machinery. A company does not download a file and lose track of it; it links to the registry, and the registry knows where every picture hangs, for how long, under what terms. That is the enterprise product, and it is already live.</p>`)}
${S('platform', 'VI. The platform in prospect', `
<p>There is a conversation to be had with X. The shape of it is the one I would propose to any platform: the platform is the surface, the house is the registry. A platform opens a studio for each of its creators with one call, puts their pictures in by address, and sells from its own feed; the maker is paid Friday; the platform takes a published share, five percent, from the house's side and never the maker's; the pictures carry the mark, which leads back to the record. No exclusivity, the same terms for every platform, and the house's own surface stands on the same terms. The door is built and the terms are published at <a href="/platforms">/platforms</a>.</p>
<p>Why a platform would take it rather than build it: a registry is worth more to a platform when the platform does not own it. Its creators, and every museum, will trust a neutral register they will never trust a platform's vault. Provenance is the one thing a platform cannot credibly issue about itself. What X would bring is distribution and a payment rail; what it must not have is the register.</p>
<p class="ph-note">In prospect means in prospect. Nothing is signed and no name is on any public page of the house.</p>`)}
${S('getty', 'VII. Getty, and the museum', `
<p>Getty Images filed for Chapter 11 in Delaware on the twenty-first of October, to restructure its debt and go private. The archive is the collateral and the company means to continue; but a debtor under pressure sells pieces, and the historical collections are the pieces most likely to be offered. The house is built to take them: a bulk door that reads a whole archive (CSV, OAI, IIIF, a bucket), records every item with its rights read per item, and holds it on two floors: the record, where everything is kept and the stock trade sells what sells through the trade desk; and the house, where the Walls committee hangs what belongs in a museum. Junk is recorded, not hung.</p>
<p>The museums are the other half. The house already speaks the museums' own protocol (IIIF), reads the Met's open collection, replaces the four addresses and the printed form of a rights office with one desk, and offers a museum its own house on its own domain, made with Watermark. The Met's head of licensing is a conversation we have begun.</p>
<p>These are the two acquisitions that would make the house an institution in a season rather than a decade: a great archive, and a great museum's trust. Both are capital conversations and both are introductions. That is the ask.</p>`)}
${S('ask', 'VIII. What is asked of you', `
<p>Three things, in order. Your judgment on the shape: the foundation holding the register, the operating company taking capital as Class B with the founder's trust holding control, and whether that is a structure you would put money behind. Your introductions: the first institutions, the Dallas collectors, and the bankers who will handle Getty's pieces. And, if the first two hold, your capital, on terms we set down together with counsel before either of us is in a hurry.</p>
<p>What you may expect from the house in return is the one thing it is built to give: a record. Every dollar in and out is on the register or the statement; this room shows you the numbers as they stand, not as they are described; and when the house breaks a promise it says so in public and puts it right.</p>
<p class="ph-sign">With great respect,<br>${esc(C.maker && C.maker.name || 'The director')}<br><span>Founding director, Watermark</span></p>`)}`;
  }

  // --- The room.
  app.get('/peephole', (req, res) => {
    noStore(res); const r = readerOf(req);
    if (!r) return res.status(403).send(V.layout({ title: 'The peephole · Watermark', path: '/peephole', bare: true, body: `<main class="ph ph-door"><p class="k">The peephole</p><h1>A room for one reader.</h1><p>This room is opened by letter. If you have one, open the link in it on this device; if you are signed in, use the address the letter was sent to.</p><p><a href="/signin?next=/peephole">Sign in</a> · <a href="/">The house</a></p></main>` }));
    if (r.id) db.prepare("UPDATE readers SET last_seen=datetime('now'), visits=visits+1 WHERE id=?").run(r.id);
    const N = numbers(); const O = N.O; const lately = (app.locals.lately ? app.locals.lately(14) : []).map(({ e, line }) => ({ at: e.at, text: String(line.text || '') }));
    const lines = db.prepare('SELECT * FROM reader_lines WHERE reader_id=? ORDER BY id DESC LIMIT 6').all(r.id);
    const g = O.growth || {}, m = O.money || {}, live = O.live || {}, costs = O.costs;
    const spark = (rows, k) => { if (!rows || !rows.length) return ''; const max = Math.max(1, ...rows.map(x => x[k] || 0)); return `<span class="ph-spark">${rows.slice(-30).map(x => `<i style="height:${Math.max(2, Math.round(100 * (x[k] || 0) / max))}%" title="${esc(x.d)}: ${x[k] || 0}"></i>`).join('')}</span>`; };
    const tile = (big, small, sub = '') => `<div class="ph-t"><b>${big}</b><span>${small}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const dateLine = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
    res.send(V.layout({ title: `The peephole · for ${first(r.name)}`, path: '/peephole', desc: 'A private brief.', bare: true, body: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500&display=swap"><main class="ph">
<header class="ph-mast"><p class="ph-k">The peephole · Krafft &amp; Watermark</p><h1>A brief for ${esc(r.name)}.</h1><p class="ph-date">${esc(dateLine)} · prepared for one reader · the numbers are live · <a href="#numbers">the numbers</a> · <a href="#register">the register</a> · <a href="#papers">the papers</a></p></header>
<article class="ph-brief">${brief(r, N)}</article>

<section class="ph-num" id="numbers"><h2 class="ph-h">The numbers, as they stand</h2>
<div class="ph-tiles">
${tile((O.theNumber && O.theNumber.strangersThisWeek) || 0, 'collected by strangers this week', `${(O.theNumber && O.theNumber.strangersLastWeek) || 0} last week`)}
${tile(money(m.week ? m.week.total : 0), 'sold this week', `${money(m.week ? m.week.makers : 0)} to makers`)}
${tile(money(m.all ? m.all.total : 0), 'since the first day', `${money(m.all ? m.all.makers : 0)} to makers · ${money(m.all ? m.all.house : 0)} the house`)}
${tile((O.people && O.people.visitors7d) || 0, 'visitors this week', `${(O.people && O.people.visitorsPrior) || 0} the week before`)}
${tile(live.now == null ? '–' : live.now, 'on the site now', live.speed && live.speed.page ? `pages p50 ${live.speed.page.p50} ms · p95 ${live.speed.page.p95} ms` : '')}
${tile((g.works && g.works.n) || 0, 'works held', `${(g.works && g.works.week) || 0} this week`)}
${tile((g.makers && g.makers.n) || 0, 'makers', `${(g.makers && g.makers.week) || 0} joined this week`)}
${tile((g.collectors && g.collectors.n) || 0, 'collectors', g.comeBack && g.comeBack.n >= 3 ? `${g.comeBack.pct}% come back within 60 days` : 'come-back rate when there are enough')}
${tile(g.firstSale && g.firstSale.n >= 2 ? `${g.firstSale.median} d` : '–', 'a maker’s first sale', g.firstSale ? `median of ${g.firstSale.n}` : 'from joining')}
${tile(O.register ? O.register.entries.toLocaleString('en-US') : 0, 'register entries', O.register && O.register.ok ? 'every one intact' : 'a break')}
${tile(O.vault ? (O.vault.bytes / 1e9).toFixed(1) + ' GB' : '0', 'in the vault', O.vault ? `${O.vault.books} books · ${O.vault.records} records · ${O.vault.films} film${O.vault.films === 1 ? '' : 's'}` : '')}
${tile(costs ? money(costs.monthly * 100) : '–', 'the machine, a month', costs && costs.per1kVisitors != null ? `$${costs.per1kVisitors} per thousand visitors` : 'set COSTS_MONTHLY to show the cost line')}
</div>
<div class="ph-charts"><div><p class="k">Visitors by day, thirty days</p>${spark(g.visitorsByDay, 'visitors')}</div><div><p class="k">Pieces collected by day, thirty days</p>${spark(g.collectsByDay, 'n')}</div></div>
<p class="ph-note">Every figure is computed by the house from its own tables when this page is opened. Nothing is typed in. Costs are the house's vendors by the month, set in its environment; the cost per thousand visitors follows.</p></section>

<section class="ph-reg" id="register"><h2 class="ph-h">Lately, on the register</h2><ul class="ph-wire">${lately.map(l => `<li><span>${esc(new Date(l.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }))}</span> ${l.text}</li>`).join('')}</ul><p class="ph-note"><a href="/ledger">The whole register</a> · <a href="/ledger/anchors.json">its anchors</a> · <a href="/standard">how anyone checks it</a></p></section>

<section class="ph-site" id="site"><h2 class="ph-h">The construction site</h2><p>The house ships most days. Each release is named and dated; the walk through every door runs on each one; the tests are green before anything reaches the live house. What was built lately:</p>
<ul class="ph-rel">${((app.locals.releases && app.locals.releases.releases()) || []).slice(0, 6).map(x => `<li><b>${esc(x.version)}</b> · ${esc(x.name || '')} <span>${esc(x.date || '')}</span>${x.items && x.items.length ? `<ul>${x.items.slice(0, 4).map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>
<p class="ph-note"><a href="/releases">Every release</a> · <a href="/healthz">the house's pulse</a> (up, the register sound, the vault, mail, payments; the full report is the Studio's)</p></section>

<section class="ph-pap" id="papers"><h2 class="ph-h">The papers</h2><ul class="ph-links">
<li><a href="/owners">How the company is owned</a> <span>Class A and B, the owner’s manual, what is never touched</span></li>
<li><a href="/share">The house’s share</a> <span>the published schedule the collector pays</span></li>
<li><a href="/promises">The country store</a> <span>the promises the house keeps, and the family story they come from</span></li>
<li><a href="/standard">The standard</a> <span>the record, the number, the register, the anchor, the file, the mark</span></li>
<li><a href="/platforms">For platforms</a> <span>the door and the terms, the same for everyone</span></li>
<li><a href="/museums">For museums</a> <span>one desk, not four addresses</span></li>
<li><a href="/legal">The agreements</a> <span>six documents, versioned and fingerprinted; every word for counsel</span></li>
<li><a href="/releases">What’s new</a> <span>each release named and dated</span></li>
<li><a href="/wander">Wander</a> <span>the museum itself; the best way to understand the house is to stand in it</span></li>
</ul></section>

<section class="ph-line"><h2 class="ph-h">A line for the director</h2>
<form method="post" action="/peephole/line" class="ph-f"><textarea name="body" rows="3" maxlength="2000" placeholder="A question, a doubt, an introduction. It reaches the director alone." required></textarea><button>Send it</button></form>
${lines.length ? `<ul class="ph-lines">${lines.map(l => `<li><span>${esc(new Date(l.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</span> ${esc(l.body)}</li>`).join('')}</ul>` : ''}
<p class="ph-note">This room is yours alone; nothing in it is on the public register, and nothing you write here is seen by anyone but the director.</p></section>
</main>` }));
  });
  app.post('/peephole/line', (req, res) => {
    noStore(res); const r = readerOf(req); if (!r || !r.id) return res.sendStatus(403);
    const body = String((req.body || {}).body || '').replace(/<[^>]*>/g, '').trim().slice(0, 2000); if (!body) return res.redirect('/peephole#line');
    db.prepare('INSERT INTO reader_lines (reader_id, body) VALUES (?,?)').run(r.id, body);
    try { mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `A line from the peephole: ${r.name}`, text: `${r.name} wrote, in the peephole:\n\n${body}\n\n${C.base}/studio/peephole` }); } catch (e) { /* mail off */ }
    if (app.locals.notify && C.maker) { try { const hm = db.prepare('SELECT id FROM makers WHERE handle=?').get(C.maker.handle); if (hm) app.locals.notify.tell({ maker_id: hm.id, kind: 'note', href: '/studio/peephole', title: `${r.name} wrote a line in the peephole`, body: body.slice(0, 140) }).catch(() => {}); } catch (e) { /* */ } }
    res.redirect('/peephole?ok=line#line');
  });

  // --- The Studio: who may look in.
  app.get('/studio/peephole', studioOnly, (req, res) => {
    const rows = db.prepare('SELECT r.*, (SELECT COUNT(*) FROM reader_lines l WHERE l.reader_id=r.id) lines FROM readers r ORDER BY r.ended_at IS NOT NULL, r.id DESC').all();
    const allLines = db.prepare('SELECT l.*, r.name FROM reader_lines l JOIN readers r ON r.id=l.reader_id ORDER BY l.id DESC LIMIT 30').all();
    res.send(V.layout({ title: 'The peephole · Studio', studio: true, path: '/studio/peephole', body: `<section class="narrow prose"><p class="k">People</p><h1>The peephole.</h1>
<p>A room for one reader at a time: the brief, the numbers as they stand, the register, the papers. Named here, opened by letter, closed by a word. ${req.query.ok === 'sent' ? '<b>The letter went.</b>' : req.query.ok === 'off' ? '<b>The keys are back.</b>' : ''}</p>
<form method="post" action="/studio/peephole" class="row"><label>Name<input name="name" required maxlength="80"></label><label>Email<input name="email" type="email" required maxlength="160"></label><label>A line (why they are reading)<input name="note" maxlength="200"></label><button>Open the room and send the letter</button></form>
<table class="tbl"><thead><tr><th>Reader</th><th>Since</th><th>Seen</th><th>Visits</th><th>Lines</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.ended_at ? 'off' : ''}"><td><b>${esc(r.name)}</b><br><small>${esc(r.email)}${r.note ? ` · ${esc(r.note)}` : ''}</small></td><td>${esc(String(r.since).slice(0, 10))}</td><td>${r.last_seen ? esc(String(r.last_seen).slice(0, 16)) : 'never'}</td><td>${r.visits}</td><td>${r.lines}</td><td>${r.ended_at ? 'closed' : `<form method="post" action="/studio/peephole/${r.id}/letter" class="inl"><button>Send the letter again</button></form> <form method="post" action="/studio/peephole/${r.id}/close" class="inl"><button>Take the keys back</button></form>`}</td></tr>`).join('')}</tbody></table>
${allLines.length ? `<h2>Lines left</h2><ul>${allLines.map(l => `<li><b>${esc(l.name)}</b> <small>${esc(String(l.at).slice(0, 16))}</small><br>${esc(l.body)}</li>`).join('')}</ul>` : ''}
<p><a href="/peephole">Read the room as the house</a> (the Studio is admitted).</p></section>` }));
  });
  function letter(r) {
    const url = `${C.base}/peephole/open/${r.token}`;
    const text = `${first(r.name)},\n\nI have set a room aside for you on Watermark: the brief, the numbers as they stand, the register, and the papers, with a line you may leave for me. It is yours alone and it stays current.\n\nOpen it here, on the device you read on:\n${url}\n\nWith great respect,\n${C.maker && C.maker.name || 'Will Fullerton'}\nFounding director, Watermark`;
    try { mail.send({ to: r.email, subject: 'A room set aside for you', text }); } catch (e) { /* mail off */ }
    db.prepare("UPDATE readers SET letter_at=datetime('now') WHERE id=?").run(r.id);
    return url;
  }
  app.post('/studio/peephole', studioOnly, (req, res) => {
    const b = req.body || {}; const name = String(b.name || '').replace(/<[^>]*>/g, '').trim().slice(0, 80), email = String(b.email || '').trim().toLowerCase().slice(0, 160);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect('/studio/peephole');
    let r = db.prepare('SELECT * FROM readers WHERE lower(email)=lower(?)').get(email);
    if (r) db.prepare('UPDATE readers SET name=?, note=?, ended_at=NULL WHERE id=?').run(name, String(b.note || '').slice(0, 200) || r.note, r.id);
    else { const id = db.prepare('INSERT INTO readers (name, email, note, token) VALUES (?,?,?,?)').run(name, email, String(b.note || '').slice(0, 200) || null, crypto.randomBytes(24).toString('base64url')).lastInsertRowid; r = db.prepare('SELECT * FROM readers WHERE id=?').get(id); }
    r = db.prepare('SELECT * FROM readers WHERE id=?').get(r.id); letter(r);
    ledger.append(db, 'reader.invited', String(r.id), {}); // hidden
    res.redirect('/studio/peephole?ok=sent');
  });
  app.post('/studio/peephole/:id/letter', studioOnly, (req, res) => { const r = db.prepare('SELECT * FROM readers WHERE id=? AND ended_at IS NULL').get(Number(req.params.id)); if (r) letter(r); res.redirect('/studio/peephole?ok=sent'); });
  app.post('/studio/peephole/:id/close', studioOnly, (req, res) => { db.prepare("UPDATE readers SET ended_at=datetime('now') WHERE id=?").run(Number(req.params.id)); res.redirect('/studio/peephole?ok=off'); });
  app.locals.peephole = { readerOf, brief, numbers };
}
module.exports = { mountPeephole };
