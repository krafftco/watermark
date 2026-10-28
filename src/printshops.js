// The press (Will, 26 Oct: "a portal where print shops can receive orders from Watermark and make them; the pipeline
// for printing absolutely seamless; empower local printers to fill the supply of the demand and establish
// relationships with their customers"; "we love printing. Benjamin Franklin"; "take over all those print shops in
// terms of our software so good for it"). Franklin's own way: a press in every town, the house's standard, the
// shop's name on the work. A print shop is a maker of kind 'printer' (so sign-in, the desk, the bank and Friday pay
// all hold), with a `print_shops` row (the city, the papers, the widest sheet, framing, pickup, shipping, turnaround,
// the story). Every print the house sells (a proof, an edition, a print asked for) becomes a job: `assign()` offers
// it to the nearest open shop that can make it (the state first, then the zip, else the house's own room); the shop
// accepts on its desk, takes the print file (the master, untouched, with the ticket: size, paper, border, the number
// for the pencil line) and moves it Printing → Shipped → Delivered; the collector is written to at each step, and the
// letter names the shop, which is how the relationship begins. The shop's fee (PRINT_SHOP_PCT of the price, default
// 60) clears on delivery and goes out on Friday with everyone else's. /printers: the shops by city, and the door to
// print for the house (an application the Studio reads at Studio → Back office → The press).
'use strict';
const ROLE = require('./role');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PCT = () => Math.max(0, Math.min(100, +(process.env.PRINT_SHOP_PCT || 60)));
const STEPS = { offered: 'Offered', accepted: 'Accepted', printing: 'Printing', shipped: 'Shipped', delivered: 'Delivered', declined: 'Declined' };
const ORDER = { accepted: 'asked', printing: 'making', shipped: 'sent', delivered: 'done' }; // the job's step → the order's
const longIn = size => { const n = String(size || '').match(/\d+(\.\d+)?/g); return n ? Math.max(...n.map(Number)) : 0; };
const money = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

function mountPrintShops(app, { db, V, C, ledger, mail, isStudio, studioOnly, makerOf, originalPath, nanoid, inviteLink }) {
  db.exec(`CREATE TABLE IF NOT EXISTS print_shops (id INTEGER PRIMARY KEY, maker_id INTEGER NOT NULL UNIQUE, city TEXT, state TEXT, zip TEXT, address TEXT, papers TEXT,
    max_in INTEGER NOT NULL DEFAULT 17, framing INTEGER NOT NULL DEFAULT 0, pickup INTEGER NOT NULL DEFAULT 1, ships INTEGER NOT NULL DEFAULT 1, turnaround INTEGER NOT NULL DEFAULT 5,
    story TEXT, status TEXT NOT NULL DEFAULT 'open', house INTEGER NOT NULL DEFAULT 0, jobs INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS printer_applications (id INTEGER PRIMARY KEY, name TEXT NOT NULL, shop TEXT NOT NULL, email TEXT NOT NULL, city TEXT, state TEXT, papers TEXT, max_in INTEGER,
    note TEXT, status TEXT NOT NULL DEFAULT 'asked', at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS print_jobs (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, shop_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'offered', cents INTEGER NOT NULL DEFAULT 0,
    token TEXT NOT NULL, downloads INTEGER NOT NULL DEFAULT 0, tracking TEXT, note TEXT, offered_at TEXT NOT NULL DEFAULT (datetime('now')), accepted_at TEXT, done_at TEXT, paid INTEGER NOT NULL DEFAULT 0)`);
  db.exec('CREATE INDEX IF NOT EXISTS print_jobs_order ON print_jobs(order_id)');

  const shopOf = makerId => db.prepare('SELECT s.*, m.name, m.handle, m.email FROM print_shops s JOIN makers m ON m.id=s.maker_id WHERE s.maker_id=?').get(makerId);
  const shopById = id => db.prepare('SELECT s.*, m.name, m.handle, m.email FROM print_shops s JOIN makers m ON m.id=s.maker_id WHERE s.id=?').get(id);
  const orderOf = id => db.prepare('SELECT o.*, l.ref, l.collector_no, l.licensee_name, w.slug, w.title, w.width, w.height, w.id AS work_id2, w.maker_id AS work_maker, mk.name AS maker_name FROM print_orders o JOIN licenses l ON l.id=o.license_id JOIN works w ON w.id=l.work_id JOIN makers mk ON mk.id=w.maker_id WHERE o.id=?').get(id);
  const jobOf = id => db.prepare('SELECT j.*, s.maker_id AS shop_maker FROM print_jobs j JOIN print_shops s ON s.id=j.shop_id WHERE j.id=?').get(id);
  const liveJob = orderId => db.prepare("SELECT j.*, s.maker_id AS shop_maker FROM print_jobs j JOIN print_shops s ON s.id=j.shop_id WHERE j.order_id=? AND j.status NOT IN ('declined') ORDER BY j.id DESC LIMIT 1").get(orderId);
  const stateOf = addr => { const m = String(addr || '').match(/\b([A-Z]{2})\b\s+\d{5}/); return m ? m[1] : null; };
  const zipOf = addr => { const m = String(addr || '').match(/\b(\d{5})(?:-\d{4})?\b/); return m ? m[1] : null; };

  // The house's own room is the first shop: Will's Canon PRO-1100, 17 inches wide, on Hahnemühle and Red River papers.
  function ensureHouse() {
    const hm = C.maker && C.maker.handle ? db.prepare('SELECT id FROM makers WHERE handle=?').get(C.maker.handle) : null; if (!hm) return null;
    let s = db.prepare('SELECT * FROM print_shops WHERE maker_id=?').get(hm.id);
    if (!s) { db.prepare("INSERT INTO print_shops (maker_id, city, state, papers, max_in, framing, pickup, ships, turnaround, story, house) VALUES (?,?,?,?,?,?,?,?,?,?,1)").run(hm.id, 'New York', 'NY', 'Hahnemühle Photo Rag; Hahnemühle Baryta; Red River UltraPro Satin', 17, 0, 0, 1, 5, 'The house’s own print room: a Canon imagePROGRAF PRO-1100, twelve pigment inks, seventeen inches wide.'); s = db.prepare('SELECT * FROM print_shops WHERE maker_id=?').get(hm.id); }
    return s;
  }

  // The fee the shop earns for an order: a share of the price; the house keeps the rest and pays the maker from its own side.
  const feeFor = (o, shop) => (shop && shop.lab ? 0 : Math.round((o.cents || 0) * PCT() / 100));

  // Who makes it: an open shop whose sheet is wide enough, in the collector's state first, then by zip, else the house.
  function choose(o) {
    const need = longIn(o.size) || (o.kind === 'proof' ? 7 : 0);
    const shops = db.prepare("SELECT s.*, m.name FROM print_shops s JOIN makers m ON m.id=s.maker_id WHERE s.status='open' AND COALESCE(m.standing,'open')='open'").all().filter(s => s.max_in >= need && (!o.framed || s.framing) && (o.pickup ? true : s.ships));
    const st = stateOf(o.address), zip = zipOf(o.address);
    const able = shops.filter(s => s.id !== o.declinedShop && !(o.declinedShops || []).includes(s.id));
    const outside = able.filter(s => !s.house && !s.lab);
    const near = st ? outside.filter(s => s.state === st) : [];
    const pick = (near.length ? near : outside).sort((a, b) => {
      if (zip && a.zip && b.zip) { const da = Math.abs(+a.zip.slice(0, 3) - +zip.slice(0, 3)), dbb = Math.abs(+b.zip.slice(0, 3) - +zip.slice(0, 3)); if (da !== dbb) return da - dbb; }
      return a.jobs - b.jobs;
    })[0];
    const labShop = !o.pickup && !o.framed && !o.frame ? able.find(s => s.lab) : null; // the lab: shipped, unframed, after any shop near the collector
    return pick || labShop || able.find(s => s.house) || null;
  }

  function offer(o, shop, { by = 'house' } = {}) {
    const token = crypto.randomBytes(18).toString('base64url');
    const id = db.prepare('INSERT INTO print_jobs (order_id, shop_id, cents, token) VALUES (?,?,?,?)').run(o.id, shop.id, feeFor(o, shop), token).lastInsertRowid;
    db.prepare('UPDATE print_shops SET jobs=jobs+1 WHERE id=?').run(shop.id);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(shop.maker_id);
    try { ledger.append(db, 'print.offered', o.ref, { job: id, shop: m.handle, by, hidden: true }); } catch (e) { /* */ }
    if (shop.lab) { if (app.locals.lab) { const pr = app.locals.lab.place(id); app.locals.lab.inflight = pr; pr.catch(e => console.error('[lab]', e.message)); } }
    else if (!shop.house) {
      if (app.locals.notify) try { app.locals.notify.tell({ maker_id: m.id, kind: 'print', slug: o.slug, href: `/account/printing/${id}`, title: `A print to make: ${o.title}`, body: `${o.size || 'the proof'}${o.paper ? ` on ${o.paper}` : ''} · ${money(feeFor(o))} to you` }); } catch (e) { /* */ }
      if (m.email) mail.send({ to: m.email, subject: `A print to make: ${o.title}`, text: `${m.name.split(' ')[0]},\n\nThe house has a print for you to make: ${o.title}, by ${o.maker_name}; ${o.size || 'the proof, 5 × 7'}${o.paper ? ` on ${o.paper}` : ''}${o.framed ? ', framed' : ''}. ${money(feeFor(o))} to you, paid on Friday once it is delivered.\n\nAccept it, take the file and the ticket, and move it along as it goes:\n${C.base}/account/printing/${id}\n\nWatermark, a Krafft company.` });
    }
    return id;
  }

  // Every print the house has sold and not yet placed is placed; run after each sale and once a minute.
  function sweep() {
    ensureHouse(); if (app.locals.lab) try { app.locals.lab.ensureLab(); } catch (e) { /* */ }
    const rows = db.prepare("SELECT o.id FROM print_orders o WHERE o.status='asked' AND COALESCE(o.cents,0)>0 AND NOT EXISTS (SELECT 1 FROM print_jobs j WHERE j.order_id=o.id AND j.status<>'declined')").all();
    let n = 0; for (const r of rows) { const o = orderOf(r.id); if (!o) continue; const s = choose(o); if (s) { offer(o, s); n++; } }
    return n;
  }

  // The collector written to as the print moves, naming the shop.
  function tellCollector(o, j, st) {
    const shop = shopById(j.shop_id); const who = shop.house ? 'the house’s print room' : shop.lab ? 'the house’s lab' : `${shop.name}${shop.city ? `, ${shop.city}` : ''}`;
    const words = { accepted: `is in hand at ${who}, who will make it.`, printing: `is being printed now, at ${who}. Every print is checked by eye before it leaves.`, shipped: `is on its way to you from ${who}.${j.tracking ? ` Tracking: ${j.tracking}.` : ''}`, delivered: `has arrived, we hope safely. It was made by ${who}${shop.house || shop.lab ? '' : `: they would be glad to make the next (${C.base}/printers/${shop.handle})`}. Record it on your piece so it stays with the number.` }[st];
    if (words && o.email) mail.send({ to: o.email, subject: `Your print of ${o.title}`, text: `Your print of ${o.title} (${o.size || 'the proof'}${o.paper ? `, ${o.paper}` : ''}) ${words}\n\nYour piece: ${C.base}/yours/p/${o.ref}\n\nWatermark` });
  }

  function move(j, st, { tracking = null, note = null, by = 'shop' } = {}) {
    if (!STEPS[st] || st === j.status) return false;
    const o = orderOf(j.order_id); if (!o) return false;
    const now = new Date().toISOString();
    db.prepare('UPDATE print_jobs SET status=?, tracking=COALESCE(?, tracking), note=COALESCE(?, note), accepted_at=CASE WHEN ?=\'accepted\' THEN ? ELSE accepted_at END, done_at=CASE WHEN ?=\'delivered\' THEN ? ELSE done_at END WHERE id=?').run(st, tracking, note, st, now, st, now, j.id);
    if (ORDER[st]) db.prepare('UPDATE print_orders SET status=? WHERE id=?').run(ORDER[st], o.id);
    if (st === 'declined') { db.prepare('UPDATE print_shops SET jobs=MAX(0, jobs-1) WHERE id=?').run(j.shop_id); const declinedShops = db.prepare("SELECT shop_id FROM print_jobs WHERE order_id=? AND status='declined'").all(o.id).map(r => r.shop_id); const next = choose({ ...o, declinedShop: j.shop_id, declinedShops }); if (next && next.id !== j.shop_id) offer(o, next, { by: 'declined' }); }
    try { const sh = shopById(j.shop_id); if (st === 'delivered') ledger.append(db, 'print.delivered', o.slug, { job: j.id, ref: o.ref, shop: sh.house || sh.lab ? null : sh.name, city: sh.house || sh.lab ? null : sh.city, lab: sh.lab ? 1 : undefined }); else ledger.append(db, `print.${st}`, o.ref, { job: j.id, by }); } catch (e) { /* */ }
    if (st !== 'declined') tellCollector(o, j, st);
    if (st === 'delivered') { const shop = shopById(j.shop_id); if (!shop.house && !shop.lab) { const wm = db.prepare('SELECT * FROM makers WHERE id=?').get(o.work_maker); if (wm && app.locals.notify) try { app.locals.notify.tell({ maker_id: wm.id, kind: 'print', slug: o.slug, href: `/account/works/${o.slug}`, title: `A print of ${o.title} was delivered`, body: `Made by ${shop.name}${shop.city ? `, ${shop.city}` : ''}.` }); } catch (e) { /* */ } } }
    return true;
  }

  // What a shop has earned (delivered jobs), and what is still inside the hold: for the maker's statement and Friday pay.
  const earned = makerId => { try { return db.prepare("SELECT COALESCE(SUM(j.cents),0) s, COUNT(*) n FROM print_jobs j JOIN print_shops s ON s.id=j.shop_id WHERE s.maker_id=? AND j.status='delivered' AND s.house=0 AND s.lab IS NULL").get(makerId); } catch (e) { return { s: 0, n: 0 }; } };
  const clearing = (makerId, since) => { try { return db.prepare("SELECT COALESCE(SUM(j.cents),0) s, COUNT(*) n FROM print_jobs j JOIN print_shops s ON s.id=j.shop_id WHERE s.maker_id=? AND j.status='delivered' AND s.house=0 AND s.lab IS NULL AND j.done_at > datetime('now', ?)").get(makerId, since); } catch (e) { return { s: 0, n: 0 }; } };
  const where = orderId => { const j = liveJob(orderId); if (!j) return ''; const s = shopById(j.shop_id); return `${s.house ? 'The house’s room' : s.lab ? 'The lab' : esc(s.name)} · ${STEPS[j.status]}`; };

  const ticket = (o, j, shop) => {
    const rows = [['Work', `${o.title}, by ${o.maker_name}`], ['Number', o.kind === 'edition' ? `The print, No. ${o.edition_no || '?'}${o.edition_n ? ` of ${o.edition_n}` : ''}` : o.collector_no ? `Collected on Watermark, No. ${o.collector_no}` : o.ref], ['Size', o.kind === 'proof' ? '5 × 7 in, the picture fitted with a white border' : (o.size || 'as asked')], ['Paper', o.paper || (o.kind === 'proof' ? 'Hahnemühle Photo Rag' : 'the shop’s choice among the house’s papers')], ['Framed', o.framed || o.frame ? 'Yes' : 'No'], ['The pencil line', `${o.kind === 'edition' ? `No. ${o.edition_no || '?'}` : o.collector_no ? `No. ${o.collector_no}` : ''} · ${o.title}${o.kind === 'proof' ? '' : ' · ' + o.maker_name}`.replace(/^ · /, '')], ['Master', `${o.width} × ${o.height} px`], ['To', o.pickup ? 'Taken home from the show (no shipping)' : `${o.ship_name || o.licensee_name || ''}\n${o.address || ''}`.trim()], ['Collector', (o.ship_name || o.licensee_name || '').split(/\s+/)[0] || 'A collector'], ['To you', money(j.cents)], ['Note', o.note || '']].filter(r => r[1]);
    return `<dl class="pj-ticket">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v).replace(/\n/g, '<br>')}</dd></div>`).join('')}</dl>`;
  };

  // ---- The shop's desk ---------------------------------------------------------------------------------------
  const asShop = (req, res) => { const m = makerOf(req); if (!m) { res.redirect(`/signin?next=${encodeURIComponent(req.originalUrl)}`); return null; } const s = shopOf(m.id); if (!s && !isStudio(req)) { res.status(403).send(V.layout({ title: 'The press · Watermark', body: `<section class="narrow"><p class="k">The press</p><h1>Not a print shop.</h1><p class="lede">This desk is for the shops that print for the house. <a href="/printers">Print for the house.</a></p></section>` })); return null; } return { m, s: s || ensureHouse() }; };

  app.get('/account/printing', (req, res) => {
    const x = asShop(req, res); if (!x) return; const { s } = x;
    const jobs = db.prepare("SELECT j.*, o.kind, o.size, o.paper, o.framed, o.frame, o.pickup, o.address, o.ship_name, o.at AS asked_at, l.ref, w.slug, w.title, mk.name AS maker_name FROM print_jobs j JOIN print_orders o ON o.id=j.order_id JOIN licenses l ON l.id=o.license_id JOIN works w ON w.id=l.work_id JOIN makers mk ON mk.id=w.maker_id WHERE j.shop_id=? ORDER BY CASE j.status WHEN 'offered' THEN 0 WHEN 'accepted' THEN 1 WHEN 'printing' THEN 2 WHEN 'shipped' THEN 3 ELSE 4 END, j.id DESC").all(s.id);
    const by = k => jobs.filter(j => j.status === k);
    const E = earned(s.maker_id);
    const row = j => `<a class="pj-row" href="/account/printing/${j.id}"><img src="/img/${esc(j.slug)}/thumb" alt="" width="56" height="42"><span><b>${esc(j.title)}</b> · ${esc(j.maker_name)}<br><small>${j.kind === 'proof' ? 'The proof, 5 × 7' : esc(j.size || '')}${j.paper ? ` · ${esc(j.paper)}` : ''}${j.framed || j.frame ? ' · framed' : ''}${j.pickup ? ' · for the show' : ''} · ${money(j.cents)} to you</small></span><em>${STEPS[j.status]}</em></a>`;
    const sec = (h, list, line) => `<section class="pj-sec"><h2>${h} <span>${list.length}</span></h2>${list.length ? list.map(row).join('') : `<p class="note">${line}</p>`}</section>`;
    res.set('Cache-Control', 'private, no-store').send(V.layout({ title: 'The press · Watermark', path: '/account/printing', studio: true, body: `<section class="studio-wrap pj"><p class="k">The press</p><h1>${esc(s.house ? 'The house’s print room.' : s.name + '.')}</h1>
<p class="lede">Prints the house has sold, offered to you by where the collector lives and what you can make. Accept one, take the file and the ticket, and move it along as it goes; the collector is written to at every step, in your name. ${money(E.s)} earned on ${E.n} print${E.n === 1 ? '' : 's'}; paid on Friday, once delivered.</p>
<div class="pj-cols"><div>${sec('Offered to you', by('offered'), 'Nothing waiting. The next print sold near you comes here.')}${sec('In hand', [...by('accepted'), ...by('printing'), ...by('shipped')], 'Nothing in hand.')}${sec('Delivered', by('delivered').slice(0, 30), 'None yet.')}</div>
<aside class="pj-side"><h2>Your shop</h2><form method="post" action="/account/printing/shop" class="pj-form"><label><span>City</span><input name="city" value="${esc(s.city || '')}"></label><label><span>State</span><input name="state" value="${esc(s.state || '')}" maxlength="2" placeholder="TX"></label><label><span>ZIP</span><input name="zip" value="${esc(s.zip || '')}" maxlength="10"></label><label><span>Address, for pickups</span><textarea name="address" rows="2">${esc(s.address || '')}</textarea></label><label><span>Papers you keep</span><textarea name="papers" rows="2">${esc(s.papers || '')}</textarea></label><label><span>Widest sheet, inches</span><input name="max_in" type="number" min="5" max="120" value="${s.max_in}"></label><label class="pj-ck"><input type="checkbox" name="framing" value="1"${s.framing ? ' checked' : ''}> We frame</label><label class="pj-ck"><input type="checkbox" name="pickup" value="1"${s.pickup ? ' checked' : ''}> Collectors may pick up</label><label class="pj-ck"><input type="checkbox" name="ships" value="1"${s.ships ? ' checked' : ''}> We ship</label><label><span>Days to make a print</span><input name="turnaround" type="number" min="1" max="30" value="${s.turnaround}"></label><label><span>Your story, on your page</span><textarea name="story" rows="4">${esc(s.story || '')}</textarea></label><label class="pj-ck"><input type="checkbox" name="open" value="1"${s.status === 'open' ? ' checked' : ''}> Taking prints</label><button class="buy-btn">Keep</button></form>
<p class="pj-fine">Your page: <a href="/printers/${esc(s.handle)}">/printers/${esc(s.handle)}</a>. The house pays ${PCT()}% of each print’s price to the shop that makes it; the maker is paid from the house’s side. <a href="/account/payouts">Getting paid</a>.</p></aside></div></section>` }));
  });

  app.post('/account/printing/shop', (req, res) => {
    const x = asShop(req, res); if (!x) return; const b = req.body || {};
    db.prepare('UPDATE print_shops SET city=?, state=?, zip=?, address=?, papers=?, max_in=?, framing=?, pickup=?, ships=?, turnaround=?, story=?, status=? WHERE id=?').run(String(b.city || '').slice(0, 80), String(b.state || '').toUpperCase().slice(0, 2), String(b.zip || '').slice(0, 10), String(b.address || '').slice(0, 400), String(b.papers || '').slice(0, 400), Math.max(5, Math.min(120, +b.max_in || 17)), b.framing ? 1 : 0, b.pickup ? 1 : 0, b.ships ? 1 : 0, Math.max(1, Math.min(30, +b.turnaround || 5)), String(b.story || '').slice(0, 1200), b.open ? 'open' : 'held', x.s.id);
    res.redirect('/account/printing');
  });

  app.get('/account/printing/:id', (req, res) => {
    const x = asShop(req, res); if (!x) return; const j = jobOf(+req.params.id); if (!j || (j.shop_id !== x.s.id && !isStudio(req))) return res.sendStatus(404);
    const o = orderOf(j.order_id); const shop = shopById(j.shop_id);
    const acts = { offered: `<form method="post" action="/account/printing/${j.id}/move" class="pj-acts"><button name="status" value="accepted" class="buy-btn">Accept: I will make it</button> <button name="status" value="declined">Not this one</button></form>`, accepted: `<form method="post" action="/account/printing/${j.id}/move" class="pj-acts"><button name="status" value="printing" class="buy-btn">It is on the press</button></form>`, printing: `<form method="post" action="/account/printing/${j.id}/move" class="pj-acts"><label><span>Tracking, if any</span><input name="tracking" placeholder="1Z…"></label><button name="status" value="shipped" class="buy-btn">${o.pickup ? 'Ready at the show' : 'It has shipped'}</button></form>`, shipped: `<form method="post" action="/account/printing/${j.id}/move" class="pj-acts"><button name="status" value="delivered" class="buy-btn">Delivered</button></form>`, delivered: '<p class="note">Delivered. Thank you. Paid on Friday.</p>', declined: '<p class="note">Declined; the house offered it on.</p>' }[j.status] || '';
    res.set('Cache-Control', 'private, no-store').send(V.layout({ title: `${o.title} · the press · Watermark`, path: `/account/printing/${j.id}`, studio: true, body: `<section class="studio-wrap pj"><p class="k"><a href="/account/printing">The press</a> · ${STEPS[j.status]}</p><h1>${esc(o.title)}.</h1><p class="lede">By ${esc(o.maker_name)}. ${o.kind === 'proof' ? 'The proof: the first object most collectors own.' : o.kind === 'edition' ? `A numbered print, No. ${o.edition_no || '?'}.` : 'A print asked for.'}</p>
<div class="pj-cols"><div><figure class="pj-pic"><img src="/img/${esc(o.slug)}/large" alt=""></figure>${ticket(o, j, shop)}${acts}</div>
<aside class="pj-side"><h2>The file</h2>${j.status === 'offered' ? '<p class="note">Accept the print to take the file.</p>' : `<p><a class="buy-btn" href="/account/printing/${j.id}/file">The master, untouched</a></p><p class="pj-fine">The maker’s own pixels, the papers inside, never re-encoded: the house’s rule. Three takes; ${j.downloads} used. Print from it, keep nothing after, and never show it: the licence is the collector’s.</p><p><a href="/account/printing/${j.id}/ticket.pdf">The ticket, for the bench (PDF)</a></p>`}
<h2>The house’s standard</h2><p class="pj-fine">Pigment on the paper named; the picture fitted to the sheet with a white border unless the ticket says bleed; the number and title in pencil beneath, lightly; checked by eye under daylight before it leaves; flat-packed or rolled in a tube, never folded. <a href="/print">The guide</a>.</p></aside></div></section>` }));
  });

  app.post('/account/printing/:id/move', (req, res) => {
    const x = asShop(req, res); if (!x) return; const j = jobOf(+req.params.id); if (!j || (j.shop_id !== x.s.id && !isStudio(req))) return res.sendStatus(404);
    const st = String((req.body || {}).status || ''); const allowed = { offered: ['accepted', 'declined'], accepted: ['printing', 'declined'], printing: ['shipped'], shipped: ['delivered'] }[j.status] || [];
    if (allowed.includes(st)) move(j, st, { tracking: String((req.body || {}).tracking || '').slice(0, 80) || null, by: x.s.house ? 'house' : x.s.handle });
    res.redirect(st === 'declined' ? '/account/printing' : `/account/printing/${j.id}`);
  });

  app.get('/account/printing/:id/file', async (req, res) => {
    const x = asShop(req, res); if (!x) return; const j = jobOf(+req.params.id); if (!j || (j.shop_id !== x.s.id && !isStudio(req))) return res.sendStatus(404);
    if (j.status === 'offered' || j.status === 'declined') return res.sendStatus(403);
    if (j.downloads >= 3 && !isStudio(req)) return res.status(410).send(V.layout({ title: 'The file · Watermark', body: '<section class="narrow"><h1>Three takes, used.</h1><p class="lede">Write to the house if the file was lost on the way.</p></section>' }));
    const o = orderOf(j.order_id); const w = db.prepare('SELECT * FROM works WHERE id=?').get(o.work_id2);
    let file; try { file = await originalPath(w); } catch (e) { return res.sendStatus(503); }
    db.prepare('UPDATE print_jobs SET downloads=downloads+1 WHERE id=?').run(j.id);
    try { ledger.append(db, 'print.file', o.ref, { job: j.id, hidden: true }); } catch (e) { /* */ }
    const ext = path.extname(w.original_file || file).toLowerCase() || '.jpg';
    res.set({ 'Content-Disposition': `attachment; filename="${String(o.title).replace(/[^\w .-]+/g, '').trim() || 'print'} (${o.ref})${ext}"`, 'Cache-Control': 'private, no-store' });
    fs.createReadStream(file).pipe(res);
  });

  app.get('/account/printing/:id/ticket.pdf', (req, res) => {
    const x = asShop(req, res); if (!x) return; const j = jobOf(+req.params.id); if (!j || (j.shop_id !== x.s.id && !isStudio(req))) return res.sendStatus(404);
    const o = orderOf(j.order_id); const shop = shopById(j.shop_id);
    let PDFDocument; try { PDFDocument = require('pdfkit'); } catch (e) { return res.sendStatus(503); }
    const doc = new PDFDocument({ size: [396, 612], margins: { top: 36, bottom: 36, left: 36, right: 36 } });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="ticket-${o.ref}.pdf"`, 'Cache-Control': 'private, no-store' }); doc.pipe(res);
    doc.font('Helvetica').fontSize(8).fillColor('#777').text('WATERMARK · THE PRESS · PRINT TICKET', { characterSpacing: 2 }); doc.moveDown(0.8);
    doc.font('Times-Roman').fontSize(20).fillColor('#000').text(o.title); doc.fontSize(11).fillColor('#333').text(`by ${o.maker_name}`); doc.moveDown();
    const rows = [['Number', o.kind === 'edition' ? `The print, No. ${o.edition_no || '?'}${o.edition_n ? ` of ${o.edition_n}` : ''}` : o.collector_no ? `No. ${o.collector_no}` : o.ref], ['Size', o.kind === 'proof' ? '5 × 7 in, fitted, white border' : (o.size || 'as asked')], ['Paper', o.paper || (o.kind === 'proof' ? 'Hahnemühle Photo Rag' : '')], ['Framed', o.framed || o.frame ? 'Yes' : 'No'], ['Pencil line', `${o.kind === 'edition' ? `No. ${o.edition_no || '?'}` : o.collector_no ? `No. ${o.collector_no}` : ''} · ${o.title}`], ['Master', `${o.width} × ${o.height} px`], ['To', o.pickup ? 'Taken home from the show' : `${o.ship_name || o.licensee_name || ''}\n${o.address || ''}`.trim()], ['Shop', shop.name], ['Ref', `${o.ref} · job ${j.id}`]];
    for (const [k, v] of rows) { if (!v) continue; doc.font('Helvetica-Bold').fontSize(8).fillColor('#666').text(k.toUpperCase(), { characterSpacing: 1 }); doc.font('Times-Roman').fontSize(12).fillColor('#000').text(v); doc.moveDown(0.5); }
    doc.moveDown(); doc.font('Helvetica').fontSize(8).fillColor('#777').text('The house’s standard: pigment on the paper named; fitted with a white border unless bleed; the number and title in pencil beneath, lightly; checked by eye under daylight; flat-packed or rolled, never folded. Keep nothing after.', { lineGap: 2 });
    doc.end();
  });

  // ---- The public room and the door ------------------------------------------------------------------------
  app.get('/printers', (req, res) => {
    ensureHouse();
    const shops = db.prepare("SELECT s.*, m.name, m.handle, m.portrait FROM print_shops s JOIN makers m ON m.id=s.maker_id WHERE s.status='open' AND s.house=0 AND s.lab IS NULL ORDER BY s.state, s.city, m.name").all();
    const byState = {}; for (const s of shops) (byState[s.state || '—'] = byState[s.state || '—'] || []).push(s);
    const made = db.prepare("SELECT COUNT(*) n FROM print_jobs WHERE status='delivered'").get().n;
    res.send(V.layout({ title: 'The press · Watermark', path: '/printers', desc: 'The print shops that make the house’s prints, town by town; and the door for a shop that would.', body: `<section class="cx-intro prs-head"><p class="k">The press</p><h1>A press in every town.</h1>${app.locals.roomPlate ? app.locals.roomPlate('printers') : ''}${require('./inscriptions').insc('printers')}<p class="lede">A press in each town, a printer at it, under one standard, and the printer’s name on the work. Every print the house sells is made near the collector by a shop that prints for the house, on the papers the house names, checked by eye, with the number in pencil. The shop is paid on Friday, and its name is on the letter, so the next print is theirs too.${made ? ` ${made} print${made === 1 ? '' : 's'} made so far.` : ''}</p></section>
<section class="prs-shops">${shops.length ? Object.entries(byState).map(([st, list]) => `<h2>${esc(st)}</h2><div class="prs-grid">${list.map(s => `<a class="prs-card" href="/printers/${esc(s.handle)}">${s.portrait ? `<img src="/portrait/${esc(s.handle)}" alt="">` : ''}<b>${esc(s.name)}</b><span>${esc([s.city, s.state].filter(Boolean).join(', '))} · to ${s.max_in} in wide${s.framing ? ' · frames' : ''}${s.pickup ? ' · pickup' : ''}</span></a>`).join('')}</div>`).join('') : '<p class="note">The house’s own room makes every print today. The first shops are being chosen.</p>'}</section>
<section class="prs-join" id="join"><h2>Print for the house.</h2><p>A shop with a pigment printer, the papers, a good eye and a bench. The house sends the prints sold near you, the master untouched and a ticket; you make it, pack it, send it, and are paid on Friday. The collector knows your name. ${req.query.ok === 'asked' ? '<b>Your note is with the house; we will write.</b>' : ''}</p>
<form method="post" action="/printers/apply" class="prs-form"><label><span>Your name</span><input name="name" required maxlength="80"></label><label><span>The shop</span><input name="shop" required maxlength="120"></label><label><span>Email</span><input name="email" type="email" required></label><label><span>City</span><input name="city" maxlength="80"></label><label><span>State</span><input name="state" maxlength="2" placeholder="TX"></label><label><span>Papers you keep</span><input name="papers" maxlength="300" placeholder="Hahnemühle Photo Rag, Canson Platine…"></label><label><span>Widest sheet, inches</span><input name="max_in" type="number" min="5" max="120" value="17"></label><label><span>A word on the shop</span><textarea name="note" rows="3" maxlength="800"></textarea></label><input type="text" name="website" class="hpot" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="buy-btn">Ask to print for the house</button></form></section>` }));
  });
  app.post('/printers/apply', (req, res) => {
    const b = req.body || {}; if (b.website) return res.redirect('/printers?ok=asked');
    const name = String(b.name || '').trim().slice(0, 80), shop = String(b.shop || '').trim().slice(0, 120), email = String(b.email || '').trim().toLowerCase().slice(0, 160);
    if (!name || !shop || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).send(V.layout({ title: 'The press · Watermark', body: '<section class="narrow"><h1>A name, the shop and an address, please.</h1><p><a href="/printers#join">Back</a></p></section>' }));
    const id = db.prepare('INSERT INTO printer_applications (name, shop, email, city, state, papers, max_in, note) VALUES (?,?,?,?,?,?,?,?)').run(name, shop, email, String(b.city || '').slice(0, 80), String(b.state || '').toUpperCase().slice(0, 2), String(b.papers || '').slice(0, 300), Math.max(5, Math.min(120, +b.max_in || 17)), String(b.note || '').slice(0, 800)).lastInsertRowid;
    try { ledger.append(db, 'printer.asked', String(id), { shop, hidden: true }); } catch (e) { /* */ }
    mail.send({ to: process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com', subject: `A shop asks to print for the house: ${shop}`, text: `${name}, ${shop}${b.city ? `, ${b.city}` : ''}${b.state ? `, ${b.state}` : ''}\n${email}\nPapers: ${b.papers || '—'} · to ${b.max_in || 17} in\n\n${b.note || ''}\n\n${C.base}/studio/printers` });
    mail.send({ to: email, subject: 'The house has your note', text: `${name.split(' ')[0]},\n\nThank you for asking to print for the house. We read every note and write back within the week.\n\nWatermark, a Krafft company.` });
    res.redirect('/printers?ok=asked');
  });
  app.get('/printers/:handle', (req, res) => {
    const s = db.prepare("SELECT s.*, m.name, m.handle, m.portrait, m.bio, m.site FROM print_shops s JOIN makers m ON m.id=s.maker_id WHERE m.handle=? AND s.house=0 AND s.lab IS NULL").get(String(req.params.handle)); if (!s) return res.sendStatus(404);
    const made = db.prepare("SELECT COUNT(*) n FROM print_jobs WHERE shop_id=? AND status='delivered'").get(s.id).n;
    res.send(V.layout({ title: `${s.name} · the press · Watermark`, path: `/printers/${s.handle}`, desc: `${s.name}${s.city ? `, ${s.city}` : ''}: a shop that prints for the house.`, body: `<section class="cx-intro prs-head"><p class="k"><a href="/printers">The press</a> · ${esc([s.city, s.state].filter(Boolean).join(', '))}</p><h1>${esc(s.name)}.</h1><p class="lede">${esc(s.story || 'A shop that prints for the house.')}</p>
<dl class="prs-facts"><div><dt>Papers</dt><dd>${esc(s.papers || 'The house’s papers')}</dd></div><div><dt>Widest sheet</dt><dd>${s.max_in} inches</dd></div><div><dt>Framing</dt><dd>${s.framing ? 'Yes' : 'Not yet'}</dd></div><div><dt>Pickup</dt><dd>${s.pickup ? `Yes${s.address ? `, at ${esc(s.address)}` : ''}` : 'Shipped'}</dd></div><div><dt>Turnaround</dt><dd>${s.turnaround} day${s.turnaround === 1 ? '' : 's'}</dd></div><div><dt>Made for the house</dt><dd>${made} print${made === 1 ? '' : 's'}</dd></div></dl>
<p>${s.status === 'open' ? `A print of any piece you hold can be made here: open the piece in your gallery and ask for a print; prints sold near ${esc(s.city || 'the shop')} come to this bench. <a href="/yours">Your gallery</a> · <a href="/print">The house’s guide to printing</a>` : 'Not taking prints at the moment.'}</p></section>` }));
  });

  // ---- The Studio: applications, the shops, the jobs -------------------------------------------------------
  app.get('/studio/printers', studioOnly, (req, res) => {
    ensureHouse();
    const apps = db.prepare("SELECT * FROM printer_applications WHERE status='asked' ORDER BY id DESC").all();
    const shops = db.prepare('SELECT s.*, m.name, m.handle, m.email, m.stripe_account FROM print_shops s JOIN makers m ON m.id=s.maker_id ORDER BY s.house DESC, m.name').all();
    const jobs = db.prepare("SELECT j.*, s.house, m.name AS shop_name, o.kind, o.size, l.ref, w.title FROM print_jobs j JOIN print_shops s ON s.id=j.shop_id JOIN makers m ON m.id=s.maker_id JOIN print_orders o ON o.id=j.order_id JOIN licenses l ON l.id=o.license_id JOIN works w ON w.id=l.work_id WHERE j.status<>'delivered' ORDER BY j.id DESC LIMIT 80").all();
    res.send(V.layout({ title: 'The press · Studio · Watermark', studio: true, path: '/studio/printers', body: `<section class="studio-wrap pj"><p class="k">Back office</p><h1>The press.</h1><p class="lede">The shops that print for the house, the shops asking to, and every print on a bench. ${req.query.ok ? `<b>${esc(req.query.ok)}</b>` : ''}</p>
<h2>Asking to print for the house (${apps.length})</h2>${apps.length ? `<table class="tbl"><tr><th>Shop</th><th>Where</th><th>Papers</th><th>Note</th><th></th></tr>${apps.map(a => `<tr><td><b>${esc(a.shop)}</b><br><small>${esc(a.name)} · ${esc(a.email)}</small></td><td>${esc([a.city, a.state].filter(Boolean).join(', '))}<br><small>to ${a.max_in} in</small></td><td><small>${esc(a.papers || '')}</small></td><td><small>${esc(a.note || '')}</small></td><td><form method="post" action="/studio/printers/apps/${a.id}" class="inline"><button name="do" value="invite" class="buy-btn">Invite</button> <button name="do" value="decline">Not now</button></form></td></tr>`).join('')}</table>` : '<p class="note">None waiting.</p>'}
<h2>The shops</h2><table class="tbl"><tr><th>Shop</th><th>Where</th><th>Can make</th><th>Jobs</th><th>Bank</th><th></th></tr>${shops.map(s => `<tr><td><b>${esc(s.house ? 'The house’s room' : s.lab ? `The lab (${s.lab})` : s.name)}</b><br><small>${esc(s.email || '')}${s.house || s.lab ? '' : ` · <a href="/printers/${esc(s.handle)}">page</a>`}</small></td><td>${esc([s.city, s.state, s.zip].filter(Boolean).join(', '))}</td><td><small>to ${s.max_in} in${s.framing ? ' · frames' : ''}${s.pickup ? ' · pickup' : ''}${s.ships ? ' · ships' : ''} · ${s.turnaround} d</small></td><td>${s.jobs}</td><td>${s.stripe_account ? 'Yes' : '—'}</td><td>${s.house ? '' : `<form method="post" action="/studio/printers/shops/${s.id}" class="inline"><button name="do" value="${s.status === 'open' ? 'hold' : 'open'}">${s.status === 'open' ? 'Hold' : 'Open'}</button></form>`}</td></tr>`).join('')}</table>
<h2>On the benches</h2>${jobs.length ? `<table class="tbl"><tr><th>Print</th><th>Shop</th><th>Where it is</th><th>To the shop</th><th>Move it</th></tr>${jobs.map(j => `<tr><td><b>${esc(j.title)}</b><br><small>${esc(j.ref)} · ${j.kind === 'proof' ? 'the proof' : esc(j.size || '')}</small></td><td>${esc(j.house ? 'The house’s room' : j.shop_name)}</td><td>${STEPS[j.status]}</td><td>${money(j.cents)}</td><td><form method="post" action="/studio/printers/jobs/${j.id}" class="inline"><select name="shop">${shops.filter(s => s.status === 'open').map(s => `<option value="${s.id}"${s.id === j.shop_id ? ' selected' : ''}>${esc(s.house ? 'The house’s room' : s.lab ? 'The lab' : s.name)}</option>`).join('')}</select><button name="do" value="reassign">To this shop</button> <button name="do" value="declined">Take it back</button></form></td></tr>`).join('')}</table>` : '<p class="note">Nothing on a bench. <form method="post" action="/studio/printers/sweep" class="inline"><button>Place what is waiting</button></form></p>'}
<form method="post" action="/studio/printers/sweep" class="inline"><button>Place what is waiting</button></form>${app.locals.lab ? app.locals.lab.panel() : ''}</section>` }));
  });
  app.post('/studio/printers/sweep', studioOnly, (req, res) => { const n = sweep(); res.redirect(`/studio/printers?ok=${encodeURIComponent(`${n} print${n === 1 ? '' : 's'} placed.`)}`); });
  app.post('/studio/printers/apps/:id', studioOnly, (req, res) => {
    const a = db.prepare('SELECT * FROM printer_applications WHERE id=?').get(+req.params.id); if (!a) return res.sendStatus(404);
    if ((req.body || {}).do === 'invite') {
      const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 60) || 'shop';
      let handle = slugify(a.shop), i = 2; while (db.prepare('SELECT 1 FROM makers WHERE handle=?').get(handle)) handle = `${slugify(a.shop)}-${i++}`;
      const id = db.prepare("INSERT INTO makers (handle, name, email, house, invite_token, kind, bio) VALUES (?,?,?,?,?,'printer',?)").run(handle, a.shop, a.email, a.city || null, nanoid(32), a.note || null).lastInsertRowid;
      db.prepare('INSERT INTO print_shops (maker_id, city, state, papers, max_in, story) VALUES (?,?,?,?,?,?)').run(id, a.city || null, a.state || null, a.papers || null, a.max_in || 17, a.note || null);
      db.prepare("UPDATE printer_applications SET status='invited' WHERE id=?").run(a.id);
      const m = db.prepare('SELECT * FROM makers WHERE id=?').get(id);
      try { ledger.append(db, 'printer.invited', handle, { shop: a.shop, city: a.city }); } catch (e) { /* */ }
      mail.send({ to: a.email, subject: 'Print for the house', text: `${a.name.split(' ')[0]},\n\n${a.shop} prints for the house now. Your desk is the press: the prints sold near you arrive there, with the master untouched and a ticket; you make each one, pack it, send it, and are paid on Friday. Open it here, once, and it is yours:\n${inviteLink(m)}\n\nThen set your papers, your widest sheet and your bank.\n\nWatermark, a Krafft company.` });
      return res.redirect(`/studio/printers?ok=${encodeURIComponent(`${a.shop} prints for the house. The letter is on its way.`)}`);
    }
    db.prepare("UPDATE printer_applications SET status='declined' WHERE id=?").run(a.id);
    mail.send({ to: a.email, subject: 'The press', text: `${a.name.split(' ')[0]},\n\nThank you for asking. The house is not adding a shop near you just now; we will keep your note and write when it is.\n\nWatermark, a Krafft company.` });
    res.redirect('/studio/printers?ok=Answered.');
  });
  app.post('/studio/printers/shops/:id', studioOnly, (req, res) => { const d = (req.body || {}).do; if (d === 'hold' || d === 'open') db.prepare('UPDATE print_shops SET status=? WHERE id=? AND house=0').run(d === 'hold' ? 'held' : 'open', +req.params.id); res.redirect('/studio/printers'); });
  app.post('/studio/printers/jobs/:id', studioOnly, (req, res) => {
    const j = jobOf(+req.params.id); if (!j) return res.sendStatus(404); const d = (req.body || {}).do;
    if (d === 'declined') { move(j, 'declined', { by: 'house' }); }
    else if (d === 'reassign') { const s = shopById(+(req.body || {}).shop); if (s && s.id !== j.shop_id) { db.prepare("UPDATE print_jobs SET status='declined' WHERE id=?").run(j.id); db.prepare('UPDATE print_shops SET jobs=MAX(0, jobs-1) WHERE id=?').run(j.shop_id); const o = orderOf(j.order_id); offer(o, s, { by: 'house' }); } }
    res.redirect('/studio/printers');
  });

  if (!app.locals.noTimers && ROLE.chores) { const t = setInterval(() => { try { sweep(); } catch (e) { console.error('[press]', e.message); } }, 60000); if (t.unref) t.unref(); setTimeout(() => { try { ensureHouse(); sweep(); } catch (e) { /* */ } }, 25000).unref(); }
  app.locals.printShops = { sweep, choose, offer, move, earned, clearing, where, shopOf, shopById, jobOf, STEPS, PCT, ensureHouse };
  return app.locals.printShops;
}
module.exports = { mountPrintShops, STEPS, longIn };
