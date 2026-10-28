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
    CREATE TABLE IF NOT EXISTS readers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, note TEXT, token TEXT UNIQUE NOT NULL, since TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT, visits INTEGER NOT NULL DEFAULT 0, ended_at TEXT, letter_at TEXT, played_at TEXT);
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
  function plate(w, line) { if (!w) return ''; const yr = w.taken_at ? String(w.taken_at).slice(0, 4) : ''; return `<figure class="ph-pl"><div class="ph-pl-i"><a href="/w/${esc(w.slug)}?from=peephole"><img src="/img/${esc(w.slug)}/screen" alt="" loading="lazy"></a><button type="button" class="ph-eye" data-eye="${esc(w.slug)}" title="The watermark" aria-label="The watermark">${I.shield}</button></div><figcaption><span class="ph-pl-t"><i>${esc(V.tidy ? V.tidy(w.title) : w.title)}</i> · ${esc(w.maker)}${w.place ? ` · ${esc(w.place)}` : ''}${yr ? `, ${esc(yr)}` : ''}</span><span class="ph-pl-acts"><a href="/w/${esc(w.slug)}">The record</a><a href="/wander?at=${esc(w.slug)}">Wander</a></span>${line ? `<span class="ph-pl-why">${line}</span>` : ''}</figcaption></figure>`; }
  function brief(r, N, P) {
    const O = N.O, g = O.growth || {}, m = O.money || {}, v = O.vault || {}, reg = O.register || {}, live = O.live || {};
    const gb = v.bytes ? v.bytes / 1e9 : 0; const perWork = v.works && gb ? (gb * 1000 / v.works) : 0;
    const founded = N.firstEntry ? new Date(N.firstEntry.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'October 2026';
    const days = N.firstEntry ? Math.max(1, Math.round((Date.now() - new Date(N.firstEntry.at)) / 864e5)) : null;
    const S = (k, h, body) => `<section class="ph-s" id="${k}"><h2 class="ph-h">${h}</h2>${body}</section>`;
    const n = x => Number(x || 0).toLocaleString('en-US');
    return `
<p class="ph-sal">Dear ${esc(first(r.name))},</p>
<p class="ph-lede">In Vail we talked about Ethereum. This is what I have built since. The numbers are the house's own, drawn fresh each time the page opens.</p>
${S('what', 'What it is', `
<p>Watermark is a museum for the web, with an engine under it.</p>
<p>The museum: one work at a time, true to size, with its record beneath it. Nothing else on the screen. No feed, no advertisement, no counter. A piece of what you look at can be yours for seven dollars.</p>
<p>The engine: a registry. A maker puts the master in the vault. The house fingerprints it, writes it into a public register the day it arrives, and issues a deed. Every licence, sale and transfer after that is a line in the same book. The book is signed, published whole, and stamped every hour into a public clock the house does not control.</p>
<p>The price is the maker's, all of it. The collector pays the house's share on top; the schedule is published. Makers are paid every Friday.</p>
<p>Founded ${esc(founded)}. A Krafft company. Dallas and New York.</p>`)}
${plate(P[0], 'Every photograph here is a registered work. The shield opens its watermark.')}
${S('why', 'The problem', `
<p>In 1990 a photograph was evidence. In 2026 it is a claim. Machines make pictures by the hundred million a day. No platform can tell a photograph from a fabrication. The people who made the real ones are not paid.</p>
<p>Getty Images, the largest keeper of commercial pictures in the world, filed for Chapter 11 a week ago with its archive pledged against its debt.</p>
<p>The Met has put 490,000 objects online without restriction; the Smithsonian five million; the Library of Congress 90,000 books. Each through its own door, in its own format. A request to reproduce one object at a great museum still goes to four addresses and a form to print, sign and post.</p>
<p>There is no registry for made work that is neutral, open, and trusted the way a title company is trusted for land. Title companies do not build houses.</p>`)}
${S('record', 'The record', `
<ul class="ph-facts">
<li>${n(v.works)} works. ${gb.toFixed(1)} GB of masters${perWork ? `, ${perWork.toFixed(0)} MB each` : ''}. ${n(g.makers && g.makers.n)} makers. ${N.institutions} institution${N.institutions === 1 ? '' : 's'}. ${n(v.books)} books. ${n(v.records)} records.</li>
<li>${n(reg.entries)} entries on the register, ${reg.ok ? 'every one intact' : 'a break'}${reg.anchors && reg.anchors.bitcoin ? `; in Bitcoin to entry ${n(reg.anchors.bitcoin.seq)}` : ''}.</li>
<li>${n(g.collectors && g.collectors.n)} people have paid for a piece. ${n(O.theNumber && O.theNumber.strangersThisWeek)} pieces collected by strangers this week; ${n(O.theNumber && O.theNumber.strangersLastWeek)} last week.${g.comeBack && g.comeBack.n >= 3 ? ` ${g.comeBack.pct} in a hundred come back within sixty days.` : ''}</li>
<li>${money(m.all ? m.all.total : 0)} taken since the first day; ${money(m.all ? m.all.makers : 0)} of it the makers'. ${money(m.week ? m.week.total : 0)} this week.${m.fridayLast ? ` Last Friday ${money(m.fridayLast.amount || 0)} went out.` : ''}</li>
<li>${n(O.people && O.people.visitors7d)} visitors this week; ${n(O.people && O.people.visitorsPrior)} the week before.</li>
<li>${days ? `${days} days` : ''} from the first line of code to this page. ${n(O.velocity && O.velocity.releases)} releases.</li>
</ul>
<p class="ph-note">A new house's numbers. The structure is finished. The edit of the founding collection and the first ten makers come next.</p>`)}
${plate(P[1])}
${S('studios', 'Krafft Studios', `
<p>Studios is the magazine. Watermark is what it stands on. ${n(N.studios)} photographs in its stories are matched to their records in the house. Stop on one and the mark is there; the record and the price are a tap away; the piece is yours without leaving the page.</p>
<p>Every frame a studio shoots is a master with a maker, a date and a price.</p>`)}
${S('natora', 'The first company', `
<p>Natora, a New York family office buying office buildings and looking at Dallas (Glenn Lostritto and Glenn Jr.; I had meant to introduce you), licenses the house's photographs with the pictures linked into its own site. One line of code. The house serves each picture under its licence, with the credit and the number on it, and counts the page it hangs on. When the licence ends, the picture says so. ${N.clients} compan${N.clients === 1 ? 'y' : 'ies'}; ${N.clientLic} live licence${N.clientLic === 1 ? '' : 's'}; ${n(N.placements.n)} placements.</p>
<p>A company that links to the registry never loses a picture. The registry knows where every picture that passed through it hangs, for how long, under what terms.</p>`)}
${S('platform', 'A platform', `
<p>There is a conversation to be had with X. The door is built; the terms are published and the same for everyone. A platform opens a studio for each creator with one call, puts pictures in by address, sells from its own feed. The maker is paid Friday. The platform takes five percent, from the house's side. The picture carries the mark, which leads to the record. No exclusivity.</p>
<p>A platform shows billions of pictures a day and cannot say which were made by a person. A registry is worth more to a platform when the platform does not own it.</p>
<p class="ph-note">Nothing is signed.</p>`)}
${plate(P[2])}
${S('getty', 'Getty, and the museums', `
<p>Getty's archive is some hundreds of millions of items and the collateral for its debt. Restructurings sell the pieces that are not core. The house has a door that reads an archive whole, records each item with its rights, and keeps it on two floors: the record, where the trade desk sells what sells; the house, where a committee hangs what belongs in a museum.</p>
<p>The house already speaks the museums' protocol, reads the Met's open collection, and replaces a rights office's four addresses with one desk. The Met's head of licensing is a conversation begun.</p>`)}
${S('data', 'What fills a data center', `
<p>The campus at Alliance will hold four hundred megawatts. What goes in the racks is mostly weights, caches, and other people's pictures scraped without a record.</p>
<p>The vault is ${perWork ? `${perWork.toFixed(0)} MB a work` : 'a few tens of megabytes a work'}, kept byte for byte. A million works is a few dozen terabytes with a deed on every one: the only clean material in the building, and something a city can wander in the evening while the racks hum.</p>`)}
${S('size', 'The size of it', `
<p>Getty took $981 million last year from 600,000 contributors and is merging with Shutterstock. The trade in pictures is a few billion dollars a year. Title insurance in this country is some twenty billion a year for keeping one kind of record straight.</p>
<p>The house sells more than the Collect. Prints: a proof for $25, editions from $250, made by local shops that take sixty percent. The Library: the public domain set beautifully, and makers' own books through the house's press. The tools: a darkroom, a writer's desk, a drawing sheet, each a door a professional pays at. The Keys: a club with dues. A museum's or a maker's own house on its own domain, by the month. Every one is live.</p>
<p>Each is a line in the same register and pays the same Friday.</p>`)}
${S('ask', 'The ask', `
<p>Your judgment first: a foundation to hold the register and the standard; the operating company to take capital as Class B with the founder's trust in control.</p>
<p>Your introductions second: the first institutions, the Dallas collectors, the bankers who will handle Getty's pieces.</p>
<p>Capital third, if the first two hold, on terms set down with counsel.</p>
<p>And the name. watermark.com is for sale. A museum is called by its name, not its address.</p>
<p>Everything in this brief can be checked without taking my word for it. That is the point.</p>
<p class="ph-close">This is a Texas company. This is a Dallas company. Some day, on the TXSE.</p>
<p class="ph-sign"><span class="ph-hand">${esc(C.maker && C.maker.name || 'Will Fullerton')}</span><br>${esc(C.maker && C.maker.name || 'Will Fullerton')}<br><span>Founding director, Watermark · founder, Krafft</span></p>`)}`;
  }

  // --- The room.
  app.get('/peephole', (req, res) => {
    noStore(res); const r = readerOf(req);
    if (!r) return res.redirect('/signin?next=/peephole'); // nothing is described to a stranger; the room is reached by letter or by the reader's own sign-in
    if (r.id) db.prepare("UPDATE readers SET last_seen=datetime('now'), visits=visits+1 WHERE id=?").run(r.id);
    const N = numbers(); const O = N.O; const P = plates(6); const lately = (app.locals.lately ? app.locals.lately(14) : []).map(({ e, line }) => ({ at: e.at, text: String(line.text || '') }));
    const lines = db.prepare('SELECT * FROM reader_lines WHERE reader_id=? ORDER BY id DESC LIMIT 6').all(r.id);
    const g = O.growth || {}, m = O.money || {}, live = O.live || {}, costs = O.costs;
    const spark = (rows, k) => { if (!rows || !rows.length) return ''; const max = Math.max(1, ...rows.map(x => x[k] || 0)); return `<span class="ph-spark">${rows.slice(-30).map(x => `<i style="height:${Math.max(2, Math.round(100 * (x[k] || 0) / max))}%" title="${esc(x.d)}: ${x[k] || 0}"></i>`).join('')}</span>`; };
    const tile = (big, small, sub = '') => `<div class="ph-t"><b>${big}</b><span>${small}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const dateLine = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
    res.send(V.layout({ title: `The brief · ${r.name}`, path: '/peephole', desc: 'A private brief.', bare: true, body: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500&display=swap"><main class="ph">
<script src="/static/eye.js" defer></script>
<header class="ph-mast"><p class="ph-k">${esc(C.maker && C.maker.name || 'Will Fullerton')} · The brief</p><h1>For ${esc(r.name)}.</h1><p class="ph-date">${esc(dateLine)} · prepared for ${esc(r.name)} · <a href="#numbers">the numbers</a> · <a href="#register">the register</a> · <a href="#papers">the papers</a></p></header>
<article class="ph-brief">${brief(r, N, P)}</article>

<section class="ph-show" id="show"><h2 class="ph-h">Use it</h2>
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

<section class="ph-num" id="numbers"><h2 class="ph-h">The numbers</h2>
${(() => { const T = []; const Q = [];
      const add = (val, big, small, sub) => { if (val > 0) T.push(tile(big, small, sub)); else Q.push(small); };
      add((O.theNumber && O.theNumber.strangersThisWeek) || 0, (O.theNumber && O.theNumber.strangersThisWeek) || 0, 'collected by strangers this week', `${(O.theNumber && O.theNumber.strangersLastWeek) || 0} last week`);
      add(m.week ? m.week.total : 0, money(m.week ? m.week.total : 0), 'sold this week', `${money(m.week ? m.week.makers : 0)} to makers`);
      add(m.all ? m.all.total : 0, money(m.all ? m.all.total : 0), 'since the first day', `${money(m.all ? m.all.makers : 0)} to makers · ${money(m.all ? m.all.house : 0)} the house`);
      add((O.people && O.people.visitors7d) || 0, (O.people && O.people.visitors7d) || 0, 'visitors this week', `${(O.people && O.people.visitorsPrior) || 0} the week before`);
      add(live.now || 0, live.now || 0, 'on the site now', live.speed && live.speed.page ? `pages p50 ${live.speed.page.p50} ms · p95 ${live.speed.page.p95} ms` : '');
      add((g.works && g.works.n) || 0, (g.works && g.works.n) || 0, 'works held', `${(g.works && g.works.week) || 0} this week`);
      add((g.makers && g.makers.n) || 0, (g.makers && g.makers.n) || 0, 'makers', `${(g.makers && g.makers.week) || 0} joined this week`);
      add((g.collectors && g.collectors.n) || 0, (g.collectors && g.collectors.n) || 0, 'collectors', g.comeBack && g.comeBack.n >= 3 ? `${g.comeBack.pct}% come back within 60 days` : '');
      if (g.firstSale && g.firstSale.n >= 2) T.push(tile(`${g.firstSale.median} d`, 'a maker’s first sale', `median of ${g.firstSale.n}`));
      add(O.register ? O.register.entries : 0, O.register ? O.register.entries.toLocaleString('en-US') : 0, 'register entries', O.register && O.register.ok ? 'every one intact' : 'a break');
      add(O.vault ? O.vault.bytes : 0, O.vault ? (O.vault.bytes / 1e9).toFixed(1) + ' GB' : '0', 'in the vault', O.vault ? `${O.vault.books} books · ${O.vault.records} records` : '');
      if (costs) T.push(tile(money(costs.monthly * 100), 'the machine, a month', costs.per1kVisitors != null ? `$${costs.per1kVisitors} per thousand visitors` : ''));
      return `<div class="ph-tiles">${T.join('')}</div>${Q.length ? `<p class="ph-quiet">Nothing yet to report: ${Q.join(', ')}.</p>` : ''}`; })()}
<div class="ph-charts"><div><p class="k">Visitors by day, thirty days</p>${spark(g.visitorsByDay, 'visitors')}</div><div><p class="k">Pieces collected by day, thirty days</p>${spark(g.collectsByDay, 'n')}</div></div>
<p class="ph-note">Computed by the house when the page opens. Nothing typed in.</p></section>

<section class="ph-reg" id="register"><h2 class="ph-h">The register, lately</h2><ul class="ph-wire">${lately.map(l => `<li><span>${esc(new Date(l.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }))}</span> ${l.text}</li>`).join('')}</ul><p class="ph-note"><a href="/ledger">The whole register</a> · <a href="/ledger/anchors.json">its anchors</a> · <a href="/standard">how anyone checks it</a></p></section>

<section class="ph-site" id="site"><h2 class="ph-h">Built lately</h2>
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

<section class="ph-line"><h2 class="ph-h">A line</h2>
<form method="post" action="/peephole/line" class="ph-f"><textarea name="body" rows="3" maxlength="2000" placeholder="A question. A doubt. An introduction." required></textarea><button>Send it</button></form>
${lines.length ? `<ul class="ph-lines">${lines.map(l => `<li><span>${esc(new Date(l.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</span> ${esc(l.body)}</li>`).join('')}</ul>` : ''}
<p class="ph-note">This room is yours alone. What you write here reaches the director and no one else.</p></section>
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
    if (!process.env.PLAYHOUSE_BASE) return ''; // the live house shows the playhouse only once it is set up for the reader (PLAYHOUSE_BASE)
    return `<section class="ph-play" id="play"><h2 class="ph-h">The playhouse</h2><p>There is a second, complete copy of the house with play money in it, where you may open your own studio and gallery, put work in, collect, and walk the back office without touching anything real. The same letter opens it: <a href="${esc(NEXT)}/peephole">${esc(NEXT.replace(/^https?:\/\//, ''))}/peephole</a>.</p></section>`;
  }

  // --- The Studio: who may look in.
  app.get('/studio/peephole', studioOnly, (req, res) => {
    const rows = db.prepare('SELECT r.*, (SELECT COUNT(*) FROM reader_lines l WHERE l.reader_id=r.id) lines FROM readers r ORDER BY r.ended_at IS NOT NULL, r.id DESC').all();
    const allLines = db.prepare('SELECT l.*, r.name FROM reader_lines l JOIN readers r ON r.id=l.reader_id ORDER BY l.id DESC LIMIT 30').all();
    res.send(V.layout({ title: 'The peephole · Studio', studio: true, path: '/studio/peephole', body: `<section class="narrow prose"><p class="k">People</p><h1>The peephole.</h1>
<p>A room for one reader at a time: the brief, the numbers as they stand, the register, the papers. Named here, opened by letter, closed by a word. ${req.query.ok === 'sent' ? '<b>The letter went.</b>' : req.query.ok === 'held' ? '<b>The room is open; the letter is held. Read it as the house, then send it from the row.</b>' : req.query.ok === 'off' ? '<b>The keys are back.</b>' : req.query.ok === 'relinked' ? '<b>A fresh door; the old link is dead.</b>' : ''}</p>
<form method="post" action="/studio/peephole" class="row"><label>Name<input name="name" required maxlength="80"></label><label>Email<input name="email" type="email" required maxlength="160"></label><label>A line (why they are reading)<input name="note" maxlength="200"></label><label class="chk"><input type="checkbox" name="hold" value="1"> Open the room, hold the letter (read the brief as the house first; send it from the row below)</label><button>Open the room</button></form>
<table class="tbl"><thead><tr><th>Reader</th><th>Since</th><th>Seen</th><th>Visits</th><th>Lines</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.ended_at ? 'off' : ''}"><td><b>${esc(r.name)}</b><br><small>${esc(r.email)}${r.note ? ` · ${esc(r.note)}` : ''}</small></td><td>${esc(String(r.since).slice(0, 10))}</td><td>${r.last_seen ? esc(String(r.last_seen).slice(0, 16)) : 'never'}</td><td>${r.visits}</td><td>${r.lines}</td><td>${r.ended_at ? 'closed' : `<input class="ph-link" readonly value="${esc(C.base)}/peephole/open/${esc(r.token)}" onclick="this.select()" title="The door: copy it into your own letter"> <form method="post" action="/studio/peephole/${r.id}/letter" class="inl"><button>${r.letter_at ? 'Send the letter again' : 'Send the letter'}</button></form> <form method="post" action="/studio/peephole/${r.id}/relink" class="inl"><button>A fresh door</button></form> <form method="post" action="/studio/peephole/${r.id}/close" class="inl"><button>Take the keys back</button></form>`}</td></tr>`).join('')}</tbody></table>
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
  // A fresh door: the old link dies, the count starts again (the director tested the link himself).
  app.post('/studio/peephole/:id/relink', studioOnly, (req, res) => { db.prepare("UPDATE readers SET token=?, visits=0, last_seen=NULL, letter_at=NULL, played_at=played_at WHERE id=? AND ended_at IS NULL").run(crypto.randomBytes(24).toString('base64url'), Number(req.params.id)); res.redirect('/studio/peephole?ok=relinked'); });
  app.post('/studio/peephole/:id/close', studioOnly, (req, res) => { db.prepare("UPDATE readers SET ended_at=datetime('now') WHERE id=?").run(Number(req.params.id)); res.redirect('/studio/peephole?ok=off'); });
  app.locals.peephole = { readerOf, brief, numbers };
}
module.exports = { mountPeephole };
