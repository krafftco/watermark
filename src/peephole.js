// The peephole (Will, 28 Oct: "a brief room, private, only for him; a view into Watermark and Krafft; cut holes into
// the business so he can see into it; the data room"; for Ross Perot Jr. first, "our guide", with the care not to
// put too much trust in anyone: a reader sees the house's own numbers and papers, never a person's name, never a key).
// A reader is named by the house (Studio → People → The peephole): a letter carries a one-time door, /peephole/open/:token,
// which admits the device for a year (cookie wm_ph); a reader signed in with the same email is admitted too; the house
// takes the keys back any time. The room: the brief (a newspaper for one reader, written as Franklin wrote to
// Washington: facts, numbers, the ask, no flattery), the numbers as they stand (the owner's view, live), lately on the
// register, the papers, and a line the reader may leave for the director. Nothing of a reader on the public register.
const crypto = require('crypto');
const I = require('./icons');

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
    const cl = t(() => db.prepare('SELECT name, hosts FROM clients ORDER BY id LIMIT 1').get()) || null; const clientHost = cl && cl.hosts ? String(cl.hosts).split(/[\s,]+/)[0].replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
    return { O, clients, placements, clientLic, studios, institutions, firstEntry, clientHost, clientName: cl ? cl.name : null };
  }
  // The plates: the house's best work set between the parts, each carrying the mark; the shield opens the watermark, the record and Wander are a tap away. The show of the future is the thing itself.
  function plates(n) { try { return db.prepare("SELECT w.slug, w.title, w.place, w.taken_at, m.name maker FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' AND (w.zone IS NULL OR w.zone='all') ORDER BY w.curated DESC, w.stars DESC, w.id LIMIT ?").all(n); } catch (e) { return db.prepare("SELECT w.slug, w.title, w.place, w.taken_at, m.name maker FROM works w JOIN makers m ON m.id=w.maker_id WHERE w.status='held' ORDER BY w.curated DESC, w.stars DESC, w.id LIMIT ?").all(n); } }
  function plate(w, line) { if (!w) return ''; const yr = w.taken_at ? String(w.taken_at).slice(0, 4) : ''; return `<figure class="ph-pl"><a href="/w/${esc(w.slug)}?from=peephole"><img src="/img/${esc(w.slug)}/screen" alt="" loading="lazy"></a><figcaption><span class="ph-pl-t"><i>${esc(V.tidy ? V.tidy(w.title) : w.title)}</i> · ${esc(w.maker)}${w.place ? ` · ${esc(w.place)}` : ''}${yr ? `, ${esc(yr)}` : ''}</span><span class="ph-pl-acts"><button type="button" class="ph-eye" data-eye="${esc(w.slug)}" title="What the watermark carries">${I.shield} The watermark</button> <a href="/w/${esc(w.slug)}">The record</a> <a href="/wander?at=${esc(w.slug)}">Wander from it</a> <img class="ph-badge" src="/w/${esc(w.slug)}/badge.svg?theme=light" alt="Watermark" height="22"></span>${line ? `<span class="ph-pl-why">${line}</span>` : ''}</figcaption></figure>`; }
  function brief(r, N, P) {
    const O = N.O, g = O.growth || {}, m = O.money || {}, v = O.vault || {}, reg = O.register || {}, live = O.live || {};
    const gb = v.bytes ? v.bytes / 1e9 : 0; const perWork = v.works && gb ? (gb * 1000 / v.works) : 0; // MB a work
    const founded = N.firstEntry ? new Date(N.firstEntry.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'October 2026';
    const S = (k, h, body) => `<section class="ph-s" id="${k}"><h2 class="ph-h">${h}</h2>${body}</section>`;
    const n = x => Number(x || 0).toLocaleString('en-US');
    return `
<p class="ph-sal">${esc(first(r.name))},</p>
<p class="ph-lede">Before Vail I wrote you a page on Ethereum and on what a contract that runs itself is, so you would know the subject better than the room. This is the same kind of page, about what I have built since. It is written to be read in one sitting. The numbers are the house's own and are drawn fresh each time the page is opened; where a thing is not yet a fact, I say so.</p>
${S('what', 'I. What it is', `
<p>Watermark is a museum for the web, with an engine under it.</p>
<p>The museum: one work at a time, true to size, with its record beneath it, and nothing else on the screen. No feed, no advertisement, no counter. People come to look. A piece of what they look at can be theirs for seven dollars, numbered, with the maker's name inside the file.</p>
<p>The engine: a registry. A maker puts the master in the vault. The house fingerprints it, writes it into a public register the day it arrives, and issues a deed. Every licence, sale and transfer after that is a line in the same book. The register is signed, published whole, and stamped every hour into a public clock the house does not control, so the house cannot rewrite its own past. Any file that leaves carries its papers inside it; any copy anywhere can be traced to its line.</p>
<p>The money: the price is the maker's, all of it. The collector pays the house's share on top, and the schedule is published, as an auction house publishes its premium. Makers are paid every Friday. Founded ${esc(founded)}; a Krafft company; Dallas and New York.</p>`)}
${plate(P[0], 'Every photograph in this brief is a registered work. The shield opens what its watermark carries; the picture opens the record.')}
${S('why', 'II. The problem it stands in', `
<p>In 1990 a photograph was evidence. In 2026 it is a claim. The machines make pictures by the hundred million a day; no platform can tell a photograph from a fabrication; the people who made the real ones are not paid for them. Getty Images, the largest keeper of commercial pictures in the world, filed for Chapter 11 in Delaware a week ago with its archive pledged against its debt.</p>
<p>The institutions that hold the world's art each keep their own records in their own formats. The Met has put 490,000 objects online without restriction; the Smithsonian five million; the Library of Congress 90,000 books free to anyone. Each is reached through a different door, and a request to reproduce one object at a great museum still goes to four addresses and a form to print, sign and post.</p>
<p>What does not exist is a registry for made work that is neutral, open, and trusted the way a title company is trusted for land: one book, any surface. Title companies do not build houses. Visa does not sell shoes.</p>`)}
${S('record', 'III. The record, as it stands', `
<ul class="ph-facts">
<li>${n(v.works)} works in the vault, ${gb.toFixed(1)} GB of masters, ${perWork ? `${perWork.toFixed(0)} MB a work` : ''}; ${n(g.makers && g.makers.n)} makers; ${N.institutions} institution${N.institutions === 1 ? '' : 's'}; ${n(v.books)} books on the shelf, ${n(v.records)} records on the turntable.</li>
<li>${n(reg.entries)} entries on the register, ${reg.ok ? 'every one intact' : 'a break'}${reg.anchors && reg.anchors.bitcoin ? `; stamped into Bitcoin to entry ${n(reg.anchors.bitcoin.seq)}` : ''}.</li>
<li>${n(g.collectors && g.collectors.n)} people have paid for a piece. ${n(O.theNumber && O.theNumber.strangersThisWeek)} pieces collected by strangers this week; ${n(O.theNumber && O.theNumber.strangersLastWeek)} last week. ${g.comeBack && g.comeBack.n >= 3 ? `${g.comeBack.pct} in a hundred come back for a second within sixty days.` : ''}</li>
<li>${money(m.all ? m.all.total : 0)} taken since the first day; ${money(m.all ? m.all.makers : 0)} of it the makers'. ${money(m.week ? m.week.total : 0)} this week.${m.fridayLast ? ` Last Friday: ${money(m.fridayLast.amount || 0)} paid out to ${m.fridayLast.makers || 0} maker${m.fridayLast.makers === 1 ? '' : 's'}.` : ''}</li>
<li>${n(O.people && O.people.visitors7d)} visitors this week against ${n(O.people && O.people.visitorsPrior)} the week before; ${n(O.people && O.people.stood7d)} stood before a work long enough to count.</li>
<li>Built in ${(() => { const d0 = N.firstEntry ? new Date(N.firstEntry.at) : null; return d0 ? Math.max(1, Math.round((Date.now() - d0) / 864e5)) : '?'; })()} days by one person and the machine; ${n(O.velocity && O.velocity.releases)} releases; the tests run on every change and the house is walked door to door after every deploy. Postgres, a worker beside the web, the vault in S3, an edge in front, sealed backups nightly with a restore drill weekly.</li>
</ul>
<p class="ph-note">These are a new house's numbers and I will not dress them. Read them as you would read a building the week it opens: the structure is finished, the walls are not yet hung. The pictures on the walls today are a first pass of my own archive, put in to build against; the edit comes next, from ten thousand frames of New York alone, and then the first ten makers who are not me.</p>`)}
${plate(P[1])}
${S('studios', 'IV. Krafft Studios', `
<p>Studios is the magazine; Watermark is what it stands on. ${n(N.studios)} photographs in Studios stories are matched to their records in the house. A reader who stops on one sees the mark; a tap shows the record and the price; the piece is theirs without leaving the page. Each story carries its credits and a way to thank the people who made it.</p>
<p>Taylor Sheridan has just made Alliance the largest film campus in Texas. Every frame a studio shoots is a master with a maker, a date and a price, and a magazine that runs on a registry is a shop window that never says so.</p>`)}
${S('natora', 'V. The first company', `
<p>Natora, a Dallas real estate brand, licenses the house's photographs with the pictures linked into its own site. One line of code asks the house for each image; the house serves it under its licence with the credit and the Watermark number on it, and counts the page it hangs on. When the licence ends the picture says so, quietly. Today: ${N.clients} compan${N.clients === 1 ? 'y' : 'ies'}, ${N.clientLic} live corporate licence${N.clientLic === 1 ? '' : 's'}, ${n(N.placements.n)} placements across ${N.placements.hosts} site${N.placements.hosts === 1 ? '' : 's'}.</p>
<p>A company that links to the registry never loses track of a picture, and the registry knows where every picture in the world that passed through it hangs, for how long, under what terms. Getty's enterprise did this with people and lawsuits.</p>`)}
${S('platform', 'VI. A platform', `
<p>There is a conversation to be had with X. The door is already built, and the terms are published, the same for every platform: a platform opens a studio for each of its creators with one call, puts their pictures in by address, and sells from its own feed. The maker is paid Friday; the platform takes five percent, from the house's side; the picture carries the mark, which leads back to the record. No exclusivity. The house's own surface stands on the same terms.</p>
<p>A platform shows several billion pictures a day and cannot say which were made by a person. A registry is worth more to a platform when the platform does not own it: its creators, and every museum, will trust a neutral book they would never trust a platform's vault. What a platform brings is distribution and a payment rail. What it must not have is the register.</p>
<p class="ph-note">In prospect means in prospect. Nothing is signed and no name is on any public page of the house.</p>`)}
${plate(P[2])}
${S('getty', 'VII. Getty, and the museums', `
<p>Getty's archive is some hundreds of millions of items and the collateral for its debt. Restructurings keep the company whole and sell the pieces that are not core; the historical collections are the pieces most likely to be offered, and a buyer with a registry, a story and capital is who a debtor's bankers call. The house has a bulk door that reads an archive whole (a spreadsheet, a museum protocol, a bucket), records each item with its rights, and keeps it on two floors: the record, where everything is kept and the trade desk sells what sells; and the house, where a committee hangs what belongs in a museum. Junk is recorded, not hung.</p>
<p>The museums are the other half. The house already speaks their protocol, reads the Met's open collection, replaces a rights office's four addresses with one desk, and can give a museum its own house on its own domain. The Met's head of licensing is a conversation begun.</p>
<p>Those are the two moves that make a house an institution in a season rather than a decade: a great archive, and a great museum's trust.</p>`)}
${S('data', 'VIII. What fills a data center', `
<p>You have said you have been in data centers since you were seven. The campus at Alliance will hold four hundred megawatts of them. What they are filled with is the question nobody in the trade asks aloud, and the answer today is mostly weights, caches and other people's pictures scraped without a record.</p>
<p>The house's vault is ${perWork ? `${perWork.toFixed(0)} MB a work` : 'a few tens of megabytes a work'} at full resolution, kept byte for byte, never re-encoded. A million works is a few dozen terabytes with a deed on every one. The register is a line of text per event. Against the scale of the campus it is a rounding error; against the scale of the problem it is the only clean material in the building. A museum for the web is also a lullaby: something a city can wander in the evening while the racks hum, and the thing the public gets back from the build-out.</p>`)}
${S('ask', 'IX. The ask', `
<p>Your judgment first: a foundation to hold the register and the standard; the operating company to take capital as Class B with the founder's trust in control. Your introductions second: the first institutions, the Dallas collectors, and the bankers who will handle Getty's pieces. Capital third, if the first two hold, on terms set down with counsel before either of us is in a hurry.</p>
<p>And one small, concrete thing. The house should own its name. watermark.com is for sale. A museum is called by its name, not its address.</p>
<p>What you may expect in return is the one thing the house is built to give: a record. Every dollar in and out is on the register or the statement; this room shows you the numbers as they are, not as described; and when the house breaks a promise it says so in public and puts it right. You will not have to take my word for anything in this brief, which is the point of the thing.</p>
<p class="ph-sign">With great respect,<br><span class="ph-hand">${esc(C.maker && C.maker.name || 'Will Fullerton')}</span><br>${esc(C.maker && C.maker.name || 'Will Fullerton')}<br><span>Founding director, Watermark · founder, Krafft</span></p>`)}`;
  }

  // --- The room.
  app.get('/peephole', (req, res) => {
    noStore(res); const r = readerOf(req);
    if (!r) return res.status(403).send(V.layout({ title: 'The peephole · Watermark', path: '/peephole', bare: true, body: `<main class="ph ph-door"><p class="k">The peephole</p><h1>A room for one reader.</h1><p>This room is opened by letter. If you have one, open the link in it on this device; if you are signed in, use the address the letter was sent to.</p><p><a href="/signin?next=/peephole">Sign in</a> · <a href="/">The house</a></p></main>` }));
    if (r.id) db.prepare("UPDATE readers SET last_seen=datetime('now'), visits=visits+1 WHERE id=?").run(r.id);
    const N = numbers(); const O = N.O; const P = plates(6); const lately = (app.locals.lately ? app.locals.lately(14) : []).map(({ e, line }) => ({ at: e.at, text: String(line.text || '') }));
    const lines = db.prepare('SELECT * FROM reader_lines WHERE reader_id=? ORDER BY id DESC LIMIT 6').all(r.id);
    const g = O.growth || {}, m = O.money || {}, live = O.live || {}, costs = O.costs;
    const spark = (rows, k) => { if (!rows || !rows.length) return ''; const max = Math.max(1, ...rows.map(x => x[k] || 0)); return `<span class="ph-spark">${rows.slice(-30).map(x => `<i style="height:${Math.max(2, Math.round(100 * (x[k] || 0) / max))}%" title="${esc(x.d)}: ${x[k] || 0}"></i>`).join('')}</span>`; };
    const tile = (big, small, sub = '') => `<div class="ph-t"><b>${big}</b><span>${small}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const dateLine = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
    res.send(V.layout({ title: `The peephole · for ${first(r.name)}`, path: '/peephole', desc: 'A private brief.', bare: true, body: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500&display=swap"><main class="ph">
<script src="/static/eye.js" defer></script>
<header class="ph-mast"><p class="ph-k">${esc(C.maker && C.maker.name || 'Will Fullerton')} · The brief</p><h1>For ${esc(r.name)}.</h1><p class="ph-date">${esc(dateLine)} · prepared for ${esc(r.name)} · the numbers are live · <a href="#numbers">the numbers</a> · <a href="#register">the register</a> · <a href="#papers">the papers</a></p></header>
<article class="ph-brief">${brief(r, N, P)}</article>

<section class="ph-show" id="show"><h2 class="ph-h">The show</h2><p>The best way to understand the house is to use it. Each door below opens in this window; come back with the arrow.</p>
<ul class="ph-doors">
<li><a href="/wander?at=${esc(P[3] ? P[3].slug : '')}"><b>Wander</b><span>The museum itself: one work a screen, true to size, the record under every picture, the Collect quiet. Swipe left for the Keys, right for your own gallery.</span></a></li>
<li><a href="/w/${esc(P[4] ? P[4].slug : (P[0] ? P[0].slug : ''))}"><b>A record</b><span>What sits under every picture: the deed, the number, the uses and prices, the Shield, the guide written with AI, the guest book, the provenance.</span></a></li>
<li><a href="https://studios.krafftco.com"><b>Krafft Studios</b><span>The magazine on the registry. Stop on any photograph in a story: the K opens its record and its price without leaving the page.</span></a></li>
${N.clientHost ? `<li><a href="https://${esc(N.clientHost)}"><b>${esc(N.clientName || 'The first company')}</b><span>A company's site with the house's pictures linked in under licence, the credit and the Watermark number on each, counted by the page they hang on.</span></a></li>` : ''}
<li><a href="/keys"><b>The Keys</b><span>The club of the house: the benches, the balcony at night, the Library, the Listening Room, the Screening Room, the season.</span></a></li>
<li><a href="/library"><b>The Library</b><span>The public domain, set beautifully: ${(O.vault && O.vault.books) || 0} books in the house's bindings, read in facing translation if you like.</span></a></li>
<li><a href="/standard"><b>The standard</b><span>What a work carries and how anyone checks it with free tools; the register protocol any house may run.</span></a></li>
<li><a href="/platforms"><b>For platforms</b><span>The door a platform plugs into, and the published terms.</span></a></li>
</ul></section>

${playhouse(r)}

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

  // --- The playhouse (Will, 28 Oct: "give him access, a maker's account and a collector's, fake money to play with; he
  // is not going to break anything and it is not going to go to the real thing"). Only on the test house (STAGING=1,
  // test Stripe, mail to the allowed list): one press opens the reader's own studio and gallery under their email, puts
  // PLAY_CENTS of play money in the pocket once, and may open the back office too. The live house only points the way.
  const PLAY = process.env.STAGING === '1', PLAY_CENTS = Number(process.env.PLAY_CENTS || 50000), NEXT = process.env.PLAYHOUSE_BASE || 'https://watermark-next.onrender.com';
  if (!db.prepare("SELECT 1 FROM pragma_table_info('readers') WHERE name='played_at'").get()) db.exec('ALTER TABLE readers ADD COLUMN played_at TEXT');
  app.post('/peephole/play/account', (req, res) => {
    noStore(res); const r = readerOf(req); if (!PLAY || !r || !r.id) return res.sendStatus(403);
    const email = r.email.toLowerCase();
    let m = db.prepare('SELECT * FROM makers WHERE lower(email)=?').get(email);
    if (!m) {
      const slugify = x => String(x).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'maker';
      let handle = slugify(r.name), i = 2; while (db.prepare('SELECT 1 FROM makers WHERE handle=?').get(handle)) handle = `${slugify(r.name)}-${i++}`;
      db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door, bio) VALUES (?,?,?,'maker',datetime('now'),'house',?)").run(handle, r.name, email, 'A reader of the house, at play.');
      m = db.prepare('SELECT * FROM makers WHERE handle=?').get(handle);
    }
    if (app.locals.admit) app.locals.admit(req, res, email, 'the peephole');
    if (!r.played_at) { const b = db.prepare('SELECT * FROM buyers WHERE lower(email)=? ORDER BY id DESC LIMIT 1').get(email); if (b && app.locals.pocket) { app.locals.pocket.credit(b, PLAY_CENTS, 'topup', 'play', 'Play money, from the house'); db.prepare("UPDATE readers SET played_at=datetime('now') WHERE id=?").run(r.id); } }
    res.redirect(String(req.body && req.body.to || '') === 'gallery' ? '/yours' : '/account');
  });
  app.post('/peephole/play/studio', (req, res) => { noStore(res); const r = readerOf(req); if (!PLAY || !r || !r.id || !app.locals.openStudio) return res.sendStatus(403); app.locals.openStudio(res); res.redirect('/studio'); });
  function playhouse(r) {
    if (!r.id) return '';
    if (PLAY) return `<section class="ph-play" id="play"><h2 class="ph-h">The playhouse</h2><p>This is the house's second, complete copy: everything works, the money is play money, and nothing here reaches the real house. Open your own studio and gallery under your address, put work in, grade it, publish it, collect a piece with the ${money(PLAY_CENTS)} in your pocket, leave a line in a guest book, hang a wall. Break nothing; try everything.</p>
<div class="ph-playacts"><form method="post" action="/peephole/play/account"><input type="hidden" name="to" value="studio"><button>Open my studio <span>a maker's account, under your name</span></button></form><form method="post" action="/peephole/play/account"><input type="hidden" name="to" value="gallery"><button>Open my gallery <span>a collector's account, ${money(PLAY_CENTS)} to play with</span></button></form><form method="post" action="/peephole/play/studio"><button>Open the back office <span>the Studio: every desk the house runs on</span></button></form></div>
<p class="ph-note">The signed-in address is yours (${esc(r.email)}); the house's letters to it are real, its money is not.</p></section>`;
    return `<section class="ph-play" id="play"><h2 class="ph-h">The playhouse</h2><p>There is a second, complete copy of the house with play money in it, where you may open your own studio and gallery, put work in, collect, and walk the back office without touching anything real. The same letter opens it: <a href="${esc(NEXT)}/peephole">${esc(NEXT.replace(/^https?:\/\//, ''))}/peephole</a>.</p></section>`;
  }

  // --- The Studio: who may look in.
  app.get('/studio/peephole', studioOnly, (req, res) => {
    const rows = db.prepare('SELECT r.*, (SELECT COUNT(*) FROM reader_lines l WHERE l.reader_id=r.id) lines FROM readers r ORDER BY r.ended_at IS NOT NULL, r.id DESC').all();
    const allLines = db.prepare('SELECT l.*, r.name FROM reader_lines l JOIN readers r ON r.id=l.reader_id ORDER BY l.id DESC LIMIT 30').all();
    res.send(V.layout({ title: 'The peephole · Studio', studio: true, path: '/studio/peephole', body: `<section class="narrow prose"><p class="k">People</p><h1>The peephole.</h1>
<p>A room for one reader at a time: the brief, the numbers as they stand, the register, the papers. Named here, opened by letter, closed by a word. ${req.query.ok === 'sent' ? '<b>The letter went.</b>' : req.query.ok === 'held' ? '<b>The room is open; the letter is held. Read it as the house, then send it from the row.</b>' : req.query.ok === 'off' ? '<b>The keys are back.</b>' : ''}</p>
<form method="post" action="/studio/peephole" class="row"><label>Name<input name="name" required maxlength="80"></label><label>Email<input name="email" type="email" required maxlength="160"></label><label>A line (why they are reading)<input name="note" maxlength="200"></label><label class="chk"><input type="checkbox" name="hold" value="1"> Open the room, hold the letter (read the brief as the house first; send it from the row below)</label><button>Open the room</button></form>
<table class="tbl"><thead><tr><th>Reader</th><th>Since</th><th>Seen</th><th>Visits</th><th>Lines</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.ended_at ? 'off' : ''}"><td><b>${esc(r.name)}</b><br><small>${esc(r.email)}${r.note ? ` · ${esc(r.note)}` : ''}</small></td><td>${esc(String(r.since).slice(0, 10))}</td><td>${r.last_seen ? esc(String(r.last_seen).slice(0, 16)) : 'never'}</td><td>${r.visits}</td><td>${r.lines}</td><td>${r.ended_at ? 'closed' : `<form method="post" action="/studio/peephole/${r.id}/letter" class="inl"><button>${r.letter_at ? 'Send the letter again' : 'Send the letter'}</button></form> <form method="post" action="/studio/peephole/${r.id}/close" class="inl"><button>Take the keys back</button></form>`}</td></tr>`).join('')}</tbody></table>
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
    r = db.prepare('SELECT * FROM readers WHERE id=?').get(r.id); const held = b.hold === '1'; if (!held) letter(r);
    ledger.append(db, 'reader.invited', String(r.id), { held }); // hidden
    res.redirect('/studio/peephole?ok=' + (held ? 'held' : 'sent'));
  });
  app.post('/studio/peephole/:id/letter', studioOnly, (req, res) => { const r = db.prepare('SELECT * FROM readers WHERE id=? AND ended_at IS NULL').get(Number(req.params.id)); if (r) letter(r); res.redirect('/studio/peephole?ok=sent'); });
  app.post('/studio/peephole/:id/close', studioOnly, (req, res) => { db.prepare("UPDATE readers SET ended_at=datetime('now') WHERE id=?").run(Number(req.params.id)); res.redirect('/studio/peephole?ok=off'); });
  app.locals.peephole = { readerOf, brief, numbers };
}
module.exports = { mountPeephole };
