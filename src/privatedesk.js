// The private desk (Will, 5 Nov: "we could be an art dealer to these people, or an art advisor … 'you could trade this
// with such-and-such and so-and-so' … the most powerful art dealer in the world"; and "yes, let's go" to the house's
// answer: a desk that introduces a collector who is looking to an owner who would consider selling, with both sides'
// yes, using only what each side chose to tell it, for a stated fee).
//
// The rules are the desk's whole value, so they are written into it:
//  - A want and an offer are told only to the house. Neither side is named to the other until both say yes.
//  - The desk uses only what each side put on the desk. Nothing from the registry's private record of an owner
//    (what they hold, where, what they paid) is ever read to find a buyer or a seller: an offer names a registry
//    record only when its owner brings it here, and only what the owner chose to show leaves the desk.
//  - When the house itself is on either side, it says so before anyone says yes.
//  - The fee is stated before the introduction (DESK_FEE_PCT of the price, paid by the seller, a draft) and recorded
//    when a sale is reported; the price agreed is between the two of them.
// Counsel reads the dealer and advisory lines, and the fee, before the desk is offered beyond the house's own circle.
const crypto = require('crypto');

const FEE_PCT = () => Number(process.env.DESK_FEE_PCT || 5);
const MCLASS = { painting: 'A painting', paper: 'A work on paper', print: 'A print', photograph: 'A photograph', sculpture: 'A sculpture', other: 'Any medium' };

function mountPrivateDesk(app, { db, V, C, mail, ledger, studioOnly, isStudio, buyerOf }) {
  const esc = V.esc, money = c => (c == null ? '' : '$' + Math.round(c / 100).toLocaleString('en-US'));
  db.exec(`CREATE TABLE IF NOT EXISTS desk_wants (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL, artist_id INTEGER, artist TEXT, mclass TEXT, year_from INTEGER, year_to INTEGER, max_cm REAL,
      budget_low INTEGER, budget_high INTEGER, note TEXT, house INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS desk_offers (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL, object_id INTEGER, artist_id INTEGER, artist TEXT, title TEXT, made_year INTEGER, mclass TEXT, h_cm REAL, w_cm REAL,
      asking INTEGER, show_price INTEGER NOT NULL DEFAULT 0, show_photo INTEGER NOT NULL DEFAULT 0, note TEXT, house INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS desk_intros (id INTEGER PRIMARY KEY, want_id INTEGER NOT NULL, offer_id INTEGER NOT NULL, token TEXT NOT NULL, fee_pct REAL NOT NULL, status TEXT NOT NULL DEFAULT 'proposed',
      buyer_yes INTEGER, owner_yes INTEGER, line TEXT, price INTEGER, fee INTEGER, at TEXT NOT NULL DEFAULT (datetime('now')), introduced_at TEXT, closed_at TEXT, UNIQUE (want_id, offer_id))`);
  const PB = () => app.locals.pricebook, A = () => app.locals.art, RG = () => app.locals.registry;
  const int = v => { const n = parseInt(String(v || '').replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n : null; };
  const cents = v => { const n = Number(String(v || '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };
  const buyer = id => db.prepare('SELECT * FROM buyers WHERE id=?').get(id) || {};
  const nameOf = b => b.name || (b.email ? b.email.split('@')[0] : 'A collector');
  const houseBuyer = () => { try { const H = app.locals.hangs && app.locals.hangs.houseBuyer ? app.locals.hangs.houseBuyer() : null; return H ? H.id : null; } catch (e) { return null; } };
  const tell = (buyer_id, title, body) => { try { app.locals.notify && app.locals.notify.tell({ buyer_id, kind: 'desk', title, body, href: '/yours/desk' }); } catch (e) { /* */ } };
  const write = (to, subject, text) => { if (to && mail && mail.send) mail.send({ to, subject, text }).catch(() => {}); };
  const artistOf = name => { const n = String(name || '').trim(); return n && A() ? A().ensure(n) : null; };
  const what = o => [MCLASS[o.mclass] && o.mclass !== 'other' ? MCLASS[o.mclass] : 'A work', o.artist ? `by ${o.artist}` : '', o.title ? `, “${o.title}”` : '', o.made_year ? `, ${o.made_year}` : '', o.h_cm && o.w_cm ? `, ${Math.round(o.h_cm)} × ${Math.round(o.w_cm)} cm` : ''].join(' ').replace(/ ,/g, ',').replace(/\s+/g, ' ').trim();
  const looking = w => [w.mclass && w.mclass !== 'other' ? MCLASS[w.mclass] : 'A work', w.artist ? `by ${w.artist}` : '', w.year_from || w.year_to ? `, made ${w.year_from || '…'}–${w.year_to || '…'}` : ''].join(' ').replace(/ ,/g, ',').trim();
  const band = w => (w.budget_low || w.budget_high ? `${w.budget_low ? money(w.budget_low) : 'up'} to ${w.budget_high ? money(w.budget_high) : 'open'}` : 'a budget not given');

  // How well an offer answers a want: the artist first, then the medium, the years, the size, the price.
  function score(w, o) {
    let s = 0, why = [];
    if (w.artist_id && o.artist_id) { if (w.artist_id !== o.artist_id) return null; s += 50; why.push('the artist'); } else if (w.artist_id) return null;
    if (w.mclass && w.mclass !== 'other') { if (o.mclass === w.mclass) { s += 15; why.push('the medium'); } else s -= 10; }
    if (o.made_year && (w.year_from || w.year_to)) { if ((!w.year_from || o.made_year >= w.year_from) && (!w.year_to || o.made_year <= w.year_to)) { s += 10; why.push('the years'); } else s -= 15; }
    if (w.max_cm && o.h_cm && o.w_cm) { if (Math.max(o.h_cm, o.w_cm) <= w.max_cm) { s += 5; why.push('the size'); } else s -= 20; }
    if (o.asking && (w.budget_low || w.budget_high)) { if ((!w.budget_high || o.asking <= w.budget_high * 1.1) && (!w.budget_low || o.asking >= w.budget_low * 0.5)) { s += 20; why.push('the price'); } else s -= 30; }
    return s > 0 ? { s, why } : null;
  }
  function matches() {
    const ws = db.prepare("SELECT * FROM desk_wants WHERE status='open'").all(), os = db.prepare("SELECT * FROM desk_offers WHERE status='open'").all();
    const done = new Set(db.prepare('SELECT want_id, offer_id FROM desk_intros').all().map(r => `${r.want_id}|${r.offer_id}`));
    const out = [];
    for (const w of ws) for (const o of os) { if (w.buyer_id === o.buyer_id || done.has(`${w.id}|${o.id}`)) continue; const m = score(w, o); if (m) out.push({ w, o, ...m }); }
    return out.sort((a, b) => b.s - a.s);
  }
  // What the market says of the offer, from the price book (the house's eyes only).
  const marketOf = o => { try { if (!o.artist_id || !PB()) return null; const e = PB().ask({ artist_id: o.artist_id, mclass: o.mclass, h_cm: o.h_cm, w_cm: o.w_cm, made_year: o.made_year, price: o.asking ? o.asking / 100 : null }); return e && e.ok ? e : null; } catch (e) { return null; } };

  function propose(want, offer, line) {
    const w = db.prepare('SELECT * FROM desk_wants WHERE id=?').get(want), o = db.prepare('SELECT * FROM desk_offers WHERE id=?').get(offer); if (!w || !o) throw new Error('not found');
    const token = crypto.randomBytes(12).toString('hex');
    const id = db.prepare('INSERT INTO desk_intros (want_id, offer_id, token, fee_pct, line) VALUES (?,?,?,?,?)').run(w.id, o.id, token, FEE_PCT(), String(line || '').slice(0, 500) || null).lastInsertRowid;
    const hw = o.house ? ' The house itself is the owner.' : '', hb = w.house ? ' The house itself is the one looking.' : '';
    tell(w.buyer_id, 'The private desk has a work for you', `${what(o)}${o.show_price && o.asking ? `, offered at ${money(o.asking)}` : ''}.${hw} Say yes and the desk introduces you to its owner.`);
    tell(o.buyer_id, 'The private desk has someone for your work', `A collector is looking for ${looking(w)}, ${band(w)}.${hb} Say yes and the desk introduces you; the fee is ${FEE_PCT()}% of the price, from the seller.`);
    write(buyer(w.buyer_id).email, 'The private desk has a work for you', `${what(o)}.${hw}\n\n${line ? line + '\n\n' : ''}Neither of you is named until both say yes.\n\n${C.base}/yours/desk`);
    write(buyer(o.buyer_id).email, 'The private desk has someone for your work', `A collector is looking for ${looking(w)}, ${band(w)}.${hb}\n\nThe desk's fee is ${FEE_PCT()}% of the price, from the seller, and only if a sale follows.\n\n${C.base}/yours/desk`);
    try { ledger.append(db, 'desk.proposed', `intro-${id}`, { want: w.id, offer: o.id }); } catch (e) { /* */ }
    return id;
  }
  function answer(intro, b, yes) {
    const i = db.prepare('SELECT * FROM desk_intros WHERE id=?').get(intro); if (!i || i.status !== 'proposed') return null;
    const w = db.prepare('SELECT * FROM desk_wants WHERE id=?').get(i.want_id), o = db.prepare('SELECT * FROM desk_offers WHERE id=?').get(i.offer_id);
    const side = b.id === w.buyer_id ? 'buyer' : b.id === o.buyer_id ? 'owner' : null; if (!side) return null;
    db.prepare(`UPDATE desk_intros SET ${side}_yes=? WHERE id=?`).run(yes ? 1 : 0, i.id);
    const j = db.prepare('SELECT * FROM desk_intros WHERE id=?').get(i.id);
    if (j.buyer_yes === 0 || j.owner_yes === 0) { db.prepare("UPDATE desk_intros SET status='declined', closed_at=datetime('now') WHERE id=?").run(i.id); return 'declined'; }
    if (j.buyer_yes === 1 && j.owner_yes === 1) {
      db.prepare("UPDATE desk_intros SET status='introduced', introduced_at=datetime('now') WHERE id=?").run(i.id);
      const bb = buyer(w.buyer_id), ob = buyer(o.buyer_id);
      const card = (x, y, role) => `${nameOf(x)}, meet ${nameOf(y)}${y.email ? ` (${y.email})` : ''}, the ${role}.\n\nThe work: ${what(o)}.\n\nYou have both said yes. What follows is between you; the desk's fee is ${j.fee_pct}% of the price, from the seller, if a sale follows. Tell the desk when it does.\n\n${C.base}/yours/desk`;
      write(bb.email, 'The private desk: an introduction', card(bb, ob, 'owner')); write(ob.email, 'The private desk: an introduction', card(ob, bb, 'collector'));
      tell(w.buyer_id, 'Introduced', `You and the owner of ${what(o)} have both said yes. A letter with their address is on its way.`); tell(o.buyer_id, 'Introduced', 'You and the collector have both said yes. A letter with their address is on its way.');
      try { ledger.append(db, 'desk.introduced', `intro-${i.id}`, {}); } catch (e) { /* */ }
      return 'introduced';
    }
    return 'waiting';
  }

  // The collector's own desk.
  app.get('/yours/desk', (req, res) => {
    const b = buyerOf(req); if (!b) return res.redirect('/signin?next=/yours/desk');
    const ws = db.prepare("SELECT * FROM desk_wants WHERE buyer_id=? AND status<>'withdrawn' ORDER BY id DESC").all(b.id), os = db.prepare("SELECT * FROM desk_offers WHERE buyer_id=? AND status<>'withdrawn' ORDER BY id DESC").all(b.id);
    const mine = db.prepare("SELECT o.* FROM objects o WHERE o.owner=? AND o.status='recorded' AND o.record_kind<>'collection' AND o.id NOT IN (SELECT object_id FROM desk_offers WHERE object_id IS NOT NULL AND status='open') ORDER BY o.id DESC LIMIT 60").all(`b:${b.id}`);
    const intros = db.prepare("SELECT i.*, w.buyer_id wb, o.buyer_id ob FROM desk_intros i JOIN desk_wants w ON w.id=i.want_id JOIN desk_offers o ON o.id=i.offer_id WHERE (w.buyer_id=? OR o.buyer_id=?) AND i.status IN ('proposed','introduced') ORDER BY i.id DESC").all(b.id, b.id);
    const introRow = i => { const w = db.prepare('SELECT * FROM desk_wants WHERE id=?').get(i.want_id), o = db.prepare('SELECT * FROM desk_offers WHERE id=?').get(i.offer_id); const side = i.wb === b.id ? 'buyer' : 'owner'; const mineYes = i[`${side}_yes`];
      const say = side === 'buyer' ? `${esc(what(o))}${o.show_price && o.asking ? `, offered at ${money(o.asking)}` : ''}${o.house ? ' · <b>the house is the owner</b>' : ''}` : `A collector looking for ${esc(looking(w))}, ${esc(band(w))}${w.house ? ' · <b>the house is the one looking</b>' : ''}`;
      const photo = side === 'buyer' && o.show_photo && o.object_id ? (() => { const ob = db.prepare('SELECT photo, work_id FROM objects WHERE id=?').get(o.object_id); return ob && ob.photo ? `<img class="pdk-ph" src="/desk/photo/${i.token}" alt="">` : ''; })() : '';
      return `<div class="pdk-i">${photo}<div><p>${say}</p>${i.line ? `<p class="note">${esc(i.line)}</p>` : ''}${i.status === 'introduced' ? '<p><b>Introduced.</b> The letter with their address has gone to you both.</p>' : mineYes == null ? `<form method="post" action="/yours/desk/i/${i.id}" class="inline"><button name="yes" value="1">Yes, introduce us</button> <button name="yes" value="0" class="link">Not this one</button></form><p class="note">The fee, if a sale follows: ${i.fee_pct}% of the price, from the seller.</p>` : '<p class="note">You said yes; waiting on the other side.</p>'}</div></div>`; };
    const MC = Object.entries(MCLASS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    res.send(V.layout({ title: 'The private desk · Watermark', path: '/yours/desk', body: `<section class="studio-wrap pdk"><p class="k"><a href="/yours">You</a> · The private desk</p><h1>The private desk.</h1>
<p class="lede">Tell the house what you are looking for, or what you would consider selling. Only the house reads it. When a work and a collector answer each other, the desk asks you both; neither is named to the other until both say yes. The fee, only if a sale follows: ${FEE_PCT()}% of the price, from the seller.</p>${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
${intros.length ? `<section class="hd-list"><div class="hd-h"><h2>For you</h2></div>${intros.map(introRow).join('')}</section>` : ''}
<section class="hd-list"><div class="hd-h"><h2>What you are looking for</h2></div>${ws.map(w => `<div class="pdk-r"><span>${esc(looking(w))} · ${esc(band(w))} · ${esc(w.status)}</span><form method="post" action="/yours/desk/want/${w.id}/withdraw" class="inline"><button class="link">Take it off the desk</button></form></div>`).join('')}
<form method="post" action="/yours/desk/want" class="form pbk-f"><label>The artist<input name="artist"></label><label>Medium<select name="mclass">${MC}</select></label><label>Made from<input name="year_from" inputmode="numeric"></label><label>to<input name="year_to" inputmode="numeric"></label><label>No larger than (cm)<input name="max_cm" inputmode="numeric"></label><label>Budget from (USD)<input name="budget_low"></label><label>to<input name="budget_high"></label><label class="pdk-w">A word for the house<input name="note"></label><button>Put it on the desk</button></form></section>
<section class="hd-list"><div class="hd-h"><h2>What you would consider selling</h2></div>${os.map(o => `<div class="pdk-r"><span>${esc(what(o))}${o.asking ? ` · asking ${money(o.asking)}${o.show_price ? '' : ' (told to the house only)'}` : ''} · ${esc(o.status)}</span><form method="post" action="/yours/desk/offer/${o.id}/withdraw" class="inline"><button class="link">Take it off the desk</button></form></div>`).join('')}
<form method="post" action="/yours/desk/offer" class="form pbk-f">${mine.length ? `<label class="pdk-w">A work on your registry<select name="object_id"><option value="">Describe it below instead</option>${mine.map(o => `<option value="${o.id}">${esc(o.title)}${o.artist ? `, ${esc(o.artist)}` : ''}</option>`).join('')}</select></label>` : ''}<label>The artist<input name="artist"></label><label>Title<input name="title"></label><label>Year made<input name="made_year" inputmode="numeric"></label><label>Medium<select name="mclass">${MC}</select></label><label>Height cm<input name="h_cm"></label><label>Width cm<input name="w_cm"></label><label>Asking (USD, optional)<input name="asking"></label><label><input type="checkbox" name="show_price" value="1"> Tell the asking price to a matched collector</label><label><input type="checkbox" name="show_photo" value="1"> Show its photograph to a matched collector</label><label class="pdk-w">A word for the house<input name="note"></label><button>Put it on the desk</button></form>
<p class="note">Nothing else on your registry is read by the desk, and nothing here is shown to anyone but the house until you say yes. Not an appraisal; the price you agree is between you.</p></section></section>` }));
  });
  app.post('/yours/desk/want', (req, res) => {
    const b = buyerOf(req); if (!b) return res.redirect('/signin?next=/yours/desk'); const x = req.body || {};
    const a = artistOf(x.artist); const hb = houseBuyer();
    db.prepare('INSERT INTO desk_wants (buyer_id, artist_id, artist, mclass, year_from, year_to, max_cm, budget_low, budget_high, note, house) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(b.id, a ? a.id : null, a ? a.name : (String(x.artist || '').trim() || null),
      MCLASS[x.mclass] ? x.mclass : 'other', int(x.year_from), int(x.year_to), int(x.max_cm), cents(x.budget_low), cents(x.budget_high), String(x.note || '').slice(0, 500) || null, hb && hb === b.id ? 1 : 0);
    try { ledger.append(db, 'desk.want', `buyer-${b.id}`, {}); } catch (e) { /* */ }
    res.redirect('/yours/desk?ok=' + encodeURIComponent('On the desk. Only the house reads it.'));
  });
  app.post('/yours/desk/offer', (req, res) => {
    const b = buyerOf(req); if (!b) return res.redirect('/signin?next=/yours/desk'); const x = req.body || {};
    let ob = null; if (x.object_id) { ob = db.prepare("SELECT * FROM objects WHERE id=? AND owner=? AND status='recorded'").get(int(x.object_id), `b:${b.id}`); if (!ob) return res.redirect('/yours/desk?ok=' + encodeURIComponent('That record is not yours.')); }
    let cm = null; try { cm = ob && ob.cm ? JSON.parse(ob.cm) : null; } catch (e) { /* */ } const pc = ob && RG() && RG().cmOf ? RG().cmOf(ob.dims) : null;
    const a = ob && ob.artist_id ? db.prepare('SELECT * FROM artists WHERE id=?').get(ob.artist_id) : artistOf(x.artist); const hb = houseBuyer();
    const mclass = MCLASS[x.mclass] && x.mclass !== 'other' ? x.mclass : ob && PB() ? PB().mclassOf(ob.medium) : 'other';
    db.prepare('INSERT INTO desk_offers (buyer_id, object_id, artist_id, artist, title, made_year, mclass, h_cm, w_cm, asking, show_price, show_photo, note, house) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(b.id, ob ? ob.id : null, a ? a.id : null, a ? a.name : (String(x.artist || '').trim() || null),
      ob ? ob.title : String(x.title || '').slice(0, 200) || null, ob ? ob.made_year : int(x.made_year), mclass, (cm && cm.h) || (pc && pc.h) || Number(x.h_cm) || null, (cm && cm.w) || (pc && pc.w) || Number(x.w_cm) || null,
      cents(x.asking), x.show_price ? 1 : 0, x.show_photo ? 1 : 0, String(x.note || '').slice(0, 500) || null, hb && hb === b.id ? 1 : 0);
    try { ledger.append(db, 'desk.offer', `buyer-${b.id}`, {}); } catch (e) { /* */ }
    res.redirect('/yours/desk?ok=' + encodeURIComponent('On the desk. Only the house reads it.'));
  });
  for (const k of ['want', 'offer']) app.post(`/yours/desk/${k}/:id/withdraw`, (req, res) => { const b = buyerOf(req); if (!b) return res.redirect('/signin?next=/yours/desk'); db.prepare(`UPDATE desk_${k}s SET status='withdrawn' WHERE id=? AND buyer_id=?`).run(int(req.params.id), b.id); res.redirect('/yours/desk'); });
  app.post('/yours/desk/i/:id', (req, res) => { const b = buyerOf(req); if (!b) return res.redirect('/signin?next=/yours/desk'); const r = answer(int(req.params.id), b, String((req.body || {}).yes) === '1');
    res.redirect('/yours/desk?ok=' + encodeURIComponent(r === 'introduced' ? 'Introduced: a letter with their address is on its way to you both.' : r === 'declined' ? 'Taken off. Nothing was said to the other side.' : r === 'waiting' ? 'Yes noted; waiting on the other side.' : 'Not yours to answer.')); });

  // The house's side: the matches, the market beside each, propose, record a sale.
  app.get('/studio/desk', studioOnly, (req, res) => {
    const ms = matches().slice(0, 80);
    const live = db.prepare("SELECT * FROM desk_intros ORDER BY id DESC LIMIT 60").all();
    const W = id => db.prepare('SELECT * FROM desk_wants WHERE id=?').get(id), O = id => db.prepare('SELECT * FROM desk_offers WHERE id=?').get(id);
    const n = { w: db.prepare("SELECT COUNT(*) n FROM desk_wants WHERE status='open'").get().n, o: db.prepare("SELECT COUNT(*) n FROM desk_offers WHERE status='open'").get().n, fees: db.prepare("SELECT COALESCE(SUM(fee),0) n FROM desk_intros WHERE status='sold'").get().n };
    res.send(V.layout({ studio: true, title: 'The private desk · Studio · Watermark', path: '/studio/desk', body: `<section class="studio-wrap hd pdk">${require('./studio-views').nav('/studio/desk')}
<p class="k">The house · Private</p><h1>The private desk.</h1><p class="lede">${n.w} looking · ${n.o} offered · ${money(n.fees)} in fees recorded. Each match uses only what each side put on the desk; the price book's view sits beside it for the house's eyes.</p>${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<section class="hd-list"><div class="hd-h"><h2>Matches</h2></div>${ms.length ? ms.map(m => { const e = marketOf(m.o); return `<form method="post" action="/studio/desk/propose" class="pdk-m"><input type="hidden" name="want" value="${m.w.id}"><input type="hidden" name="offer" value="${m.o.id}">
<p><b>${esc(what(m.o))}</b>${m.o.asking ? ` · asking ${money(m.o.asking)}` : ''}${m.o.house ? ' · the house owns it' : ''}<br>for ${esc(nameOf(buyer(m.w.buyer_id)))}: ${esc(looking(m.w))}, ${esc(band(m.w))}${m.w.house ? ' · the house is looking' : ''}</p>
<p class="note">On ${esc(m.why.join(', '))}.${e ? ` The book: likely ${money(e.likely)} (${money(e.low)}–${money(e.high)}, ${e.sure})${e.versus ? `; the asking price is ${esc(e.versus.word)} (${e.versus.off >= 0 ? '+' : ''}${e.versus.off}%)` : ''}.` : ''}</p>
<input name="line" placeholder="A line from the house to both (optional)"><button>Propose the introduction</button></form>`; }).join('') : '<p class="hd-calm">No match yet.</p>'}</section>
<section class="hd-list"><div class="hd-h"><h2>Introductions</h2></div>${live.map(i => { const w = W(i.want_id), o = O(i.offer_id); return `<div class="pdk-r"><span>${esc(what(o))} · ${esc(nameOf(buyer(o.buyer_id)))} → ${esc(nameOf(buyer(w.buyer_id)))} · <b>${esc(i.status)}</b>${i.price ? ` · ${money(i.price)}, fee ${money(i.fee)}` : ''}</span>${i.status === 'introduced' ? `<form method="post" action="/studio/desk/i/${i.id}/sold" class="inline"><input name="price" placeholder="Price agreed (USD)" required><button>A sale followed</button></form>` : ''}</div>`; }).join('') || '<p class="hd-calm">None yet.</p>'}</section>
<p class="note">The desk never reads an owner's private registry record to find a buyer, and never shows one side to the other before both say yes. When the house is a side, both are told before they answer. Counsel reads the dealer and advisory lines before the desk goes wider.</p></section>` }));
  });
  app.post('/studio/desk/propose', studioOnly, (req, res) => { try { propose(int((req.body || {}).want), int((req.body || {}).offer), (req.body || {}).line); res.redirect('/studio/desk?ok=' + encodeURIComponent('Proposed: both sides asked.')); } catch (e) { res.redirect('/studio/desk?ok=' + encodeURIComponent(e.message)); } });
  app.post('/studio/desk/i/:id/sold', studioOnly, (req, res) => {
    const i = db.prepare('SELECT * FROM desk_intros WHERE id=?').get(int(req.params.id)); const p = cents((req.body || {}).price);
    if (!i || i.status !== 'introduced' || !p) return res.redirect('/studio/desk');
    const fee = Math.round(p * i.fee_pct / 100);
    db.prepare("UPDATE desk_intros SET status='sold', price=?, fee=?, closed_at=datetime('now') WHERE id=?").run(p, fee, i.id);
    db.prepare("UPDATE desk_offers SET status='sold' WHERE id=?").run(i.offer_id); db.prepare("UPDATE desk_wants SET status='found' WHERE id=?").run(i.want_id);
    try { ledger.append(db, 'desk.sold', `intro-${i.id}`, { fee_pct: i.fee_pct }); } catch (e) { /* */ }
    res.redirect('/studio/desk?ok=' + encodeURIComponent(`Recorded: ${money(p)}, the fee ${money(fee)}.`));
  });
  // The offered work's photograph, to the matched collector only, and only when its owner chose to show it.
  app.get('/desk/photo/:token', (req, res) => {
    const b = buyerOf(req); const i = db.prepare("SELECT * FROM desk_intros WHERE token=? AND status IN ('proposed','introduced','sold')").get(String(req.params.token)); if (!b || !i) return res.sendStatus(404);
    const w = db.prepare('SELECT * FROM desk_wants WHERE id=?').get(i.want_id), o = db.prepare('SELECT * FROM desk_offers WHERE id=?').get(i.offer_id);
    if (!w || !o || w.buyer_id !== b.id || !o.show_photo || !o.object_id) return res.sendStatus(404);
    const ob = db.prepare('SELECT photo FROM objects WHERE id=?').get(o.object_id); const f = ob && ob.photo ? require('path').join(C.dataDir, ob.photo) : null;
    if (!f || !require('fs').existsSync(f)) return res.sendStatus(404); res.set('Cache-Control', 'private, no-store').type('image/jpeg').sendFile(f);
  });
  // The public door: what the desk is.
  app.get('/desk', (req, res) => res.send(V.layout({ title: 'The private desk · Watermark', path: '/desk', desc: 'Looking for a work, or ready to part with one: the house introduces collector and owner, privately, with both sides’ yes.', body: `<section class="studio-wrap pdk"><p class="k">Collect</p><h1>The private desk.</h1>
<p class="lede">Most great works change hands quietly. Tell the house what you are looking for, or what you would consider selling, and the desk looks for the other half. When it finds one it asks you both; neither of you is named to the other until both say yes.</p>
<ul class="pdk-rules"><li>Only the house reads what you put on the desk.</li><li>The desk uses only what you put on it. It never reads the rest of your registry to find a buyer or a seller.</li><li>When the house itself is on either side, you are told before you answer.</li><li>The fee is stated first: ${FEE_PCT()}% of the price, from the seller, only if a sale follows. The price is between the two of you.</li></ul>
<p><a class="buy-btn" href="/yours/desk">Go to the desk</a></p><p class="note">Not an appraisal, and not advice on what to pay. Every word a draft.</p></section>` })));
  app.locals.privateDesk = { matches, score, propose, answer };
}

module.exports = { mountPrivateDesk };
