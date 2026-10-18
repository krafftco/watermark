// The holder's room (Will, 18 Oct: most people here will be collectors, so what they collect must be the best page
// in the house; they should feel they have something real, and be given everything to use it; above all, print it,
// and see it in person: the house wants the work to turn analog). The Frick is the model: a collection lived with in
// a house, not a white cube. /yours/p/:ref is one piece you hold: the photograph on its mount, then Print it (the
// sizes your file prints at, the file, how to print it yourself, or have the house print it), Live with it (your TV,
// a wall, your phone), the papers, the prints you have made, and passing it on. /print is the house's guide to
// printing. Print orders are taken by letter while the print room is set up (`print_orders`, mailed to the house).
const I = require('./icons');

// Paper sizes, long side × short side, inches.
const PAPERS = [[7, 5], [10, 8], [14, 11], [18, 12], [20, 16], [24, 16], [30, 20], [36, 24], [40, 30], [60, 40]];
const PAPER_STOCK = [
  ['photo-rag', 'Cotton rag, matte', 'A soft, velvety cotton paper: the museum choice for most photographs. No glare.'],
  ['fibre-gloss', 'Baryta fibre, soft gloss', 'The look of a darkroom print: deep blacks, a gentle sheen. Rich for colour and black and white.'],
  ['lustre', 'Lustre', 'A pearl surface, sharp and forgiving. The everyday lab paper, and a fine proof.'],
];
const half = x => { const r = Math.round(x * 2) / 2; const f = Math.floor(r); return r - f ? `${f || ''}½` : String(f); };

// What a file of this many pixels prints at: for each paper, the picture fitted on it and how fine it holds.
function sizes(pxL, pxS) {
  if (!pxL || !pxS) return [];
  const a = pxL / pxS;
  return PAPERS.map(([PL, PS]) => {
    const L = Math.min(PL, PS * a), S = L / a, ppi = pxL / L;
    const grade = ppi >= 290 ? 'fine' : ppi >= 230 ? 'good' : ppi >= 170 ? 'wall' : null;
    return { paper: `${PL} × ${PS}`, image: `${half(L)} × ${half(S)}`, ppi: Math.round(ppi), grade };
  });
}
const GRADE = { fine: 'Close up, every detail', good: 'Framed, at arm’s length', wall: 'On the wall, from a step back' };

function mountKeep(app, { db, V, C, buyerOf, mk, mail, ledger, dlOf, isStudio }) {
  db.exec(`CREATE TABLE IF NOT EXISTS print_orders (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, buyer_id INTEGER, size TEXT, paper TEXT,
    frame INTEGER NOT NULL DEFAULT 0, email TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'asked', at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const { esc, tidy, date, money } = V, HOUSE = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  const lic = ref => db.prepare(`SELECT l.*, u.key AS use_key, u.kind AS use_kind, u.name AS use_name FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.ref=?`).get(String(ref));
  const mine = (req, l) => { const b = buyerOf(req); return !!(l && ((b && l.buyer_id === b.id) || isStudio(req))); };

  // What the holder's file is, in pixels: Collect is the 2400-pixel copy; the Reference and working licenses the original.
  function fileOf(l, w) {
    const W = w.width || 0, H = w.height || 0, L = Math.max(W, H), S = Math.min(W, H);
    if (l.use_key === 'social') { const k = L ? Math.min(1, 2400 / L) : 1; return { L: Math.round(L * k), S: Math.round(S * k), what: 'The 2400-pixel copy' }; }
    return { L, S, what: 'The full original' };
  }

  function room({ l, w, maker, b, ok }) {
    const f = fileOf(l, w), sz = sizes(f.L, f.S), best = sz.filter(s => s.grade), top = best[best.length - 1];
    const prints = db.prepare('SELECT * FROM prints WHERE license_id=? ORDER BY id').all(l.id);
    const orders = db.prepare('SELECT * FROM print_orders WHERE license_id=? ORDER BY id DESC').all(l.id);
    const dl = dlOf(l), live = l.status === 'active' && (!l.ends_at || new Date(l.ends_at) > new Date());
    const ref = db.prepare("SELECT u.price_cents FROM uses u WHERE u.maker_id=? AND u.key='reference'").get(w.maker_id);
    const canRef = !!(l.use_key === 'social' && ref && ref.price_cents != null && Math.max(w.width || 0, w.height || 0) >= 7000);
    const title = tidy(w.title), yr = (w.taken_at || '').slice(0, 4), r = (w.width && w.height ? w.width / w.height : 1.5).toFixed(3);
    const no = l.collector_no ? `No.&nbsp;${l.collector_no}${w.edition_size ? ` of ${w.edition_size}` : ''}` : esc(l.use_name);
    const file = live && l.download_token && dl.left ? `/d/${esc(l.download_token)}` : null;
    const note = { asked: 'Asked. The house will write within a day with the paper, the size, the price and when it will be ready.', recorded: 'Recorded. The print is part of this piece’s life now.', check: 'Choose a size, and say where to write.' }[ok];
    return V.layout({ title: `${title} · Yours · Watermark`, path: '/yours', desc: `${title}, by ${maker.name}. Yours.`, body: `<div class="kp">
<section class="kp-wall"><figure class="kp-mount" style="--r:${r}"><img src="/img/${esc(w.slug)}/large" alt="${esc(title)}, a photograph by ${esc(maker.name)}" draggable="false"><figcaption class="kp-pencil"><span>${no}</span><span><i>${esc(title)}</i>${yr ? `, ${esc(yr)}` : ''}</span><span class="kp-sig">${esc(maker.name)}</span></figcaption></figure></section>
<header class="kp-h"><p class="k"><a href="/yours">Your gallery</a> · ${no}</p><h1><i>${esc(title)}</i> is yours.</h1>
<p class="kp-l">A photograph by <a href="/m/${esc(V.makerSlug(maker))}">${esc(maker.name)}</a>${w.place ? `, ${esc(w.place)}` : ''}${yr ? `, ${esc(yr)}` : ''}. Held since ${esc(date(l.starts_at))}.</p>
<nav class="kp-acts" aria-label="What to do with it"><a href="#print" class="kp-a kp-a1">${I.print}<span>Print it</span></a><a href="/frame" class="kp-a">${I.full}<span>On your TV</span></a><button type="button" class="kp-a hg-open" data-hang-open="${esc(w.slug)}">${I.hang}<span>Hang it</span></button>${file ? `<a href="${file}" class="kp-a" download>${I.in || I.plus}<span>Save it</span></a>` : ''}<a href="/c/${esc(l.ref)}${l.download_token ? `?k=${esc(l.download_token)}` : ''}" class="kp-a">${I.page}<span>The papers</span></a></nav></header>
${note ? `<p class="${ok === 'check' ? 'err' : 'ok'} kp-note">${note}</p>` : ''}

<section class="kp-s kp-print" id="print"><p class="k">Print it</p><h2>See it in person.</h2>
<p class="kp-lede">A photograph is finished when it is printed. On paper it has weight and edges; it changes with the light in your room through the day; it is seen across a room, not scrolled past. Everything you need is here.</p>
<div class="kp-file"><div><span class="kp-fk">Your file</span><b>${esc(f.what)}</b><small>${f.L && f.S ? `${f.L.toLocaleString('en-US')} × ${f.S.toLocaleString('en-US')} pixels · sRGB colour · ready for any lab` : 'Ready for any lab'}</small></div>
${top ? `<div><span class="kp-fk">Prints beautifully to</span><b>${esc(top.image)} in</b><small>on ${esc(top.paper)} paper</small></div>` : ''}
${file ? `<a class="buy-btn kp-take" href="${file}" download>Take the print file</a>` : `<span class="kp-fk">${!live ? 'This license has ended.' : !l.download_token ? `The file is kept with <a href="/c/${esc(l.ref)}">the license</a>.` : 'Every download has been used: write to the house for another.'}</span>`}</div>
<table class="kp-sz"><thead><tr><th>Paper</th><th>The picture</th><th>How it holds</th></tr></thead><tbody>${sz.filter((s, i) => s.grade || i < best.length + 2).map(s => `<tr class="${s.grade ? 'kp-g-' + s.grade : 'kp-no'}"><td>${esc(s.paper)} in</td><td>${esc(s.image)} in</td><td>${s.grade ? `<span class="kp-dot"></span>${GRADE[s.grade]}` : canRef ? 'Larger than this file: the Reference prints it' : 'Larger than this file holds'}</td></tr>`).join('')}</tbody></table>
${canRef ? `<p class="kp-up">To print larger, <a href="/license/${esc(w.slug)}?use=reference">collect the Reference</a>, ${money(ref.price_cents)}: the full original, ${(w.width || 0).toLocaleString('en-US')} × ${(w.height || 0).toLocaleString('en-US')} pixels, for prints to ${esc((sizes(Math.max(w.width, w.height), Math.min(w.width, w.height)).filter(s => s.grade).pop() || {}).image || 'wall size')} in.</p>` : ''}

<div class="kp-two">
<div class="kp-way"><p class="k">Print it yourself</p><h3>Five steps, one afternoon.</h3><ol class="kp-steps">
<li><b>Take the file</b> above. Send it to the lab exactly as it is: no sharpening, no resizing; it is already set for print.</li>
<li><b>Choose a lab</b> that makes fine-art (giclée) prints on cotton or fibre paper. A local one lets you see a proof.</li>
<li><b>Choose a paper.</b> Cotton rag, matte, for most photographs; baryta for darkroom blacks; lustre for a first proof.</li>
<li><b>Choose a size</b> from the table: anything marked holds. Leave a white border of two inches or more; it is where the eye rests.</li>
<li><b>Frame it</b> behind UV glass, with a mat, and hang its centre at 57 inches from the floor, as museums do.</li></ol>
<p><a href="/print">The house’s guide to printing →</a></p></div>
<div class="kp-way kp-house"><p class="k">Or have it printed</p><h3>The house prints it for you.</h3>
<p>Printed on archival cotton or fibre, checked by eye, signed off and sent to your door, numbered to match your piece. Ask, and the house writes back with the price and the day it will be ready.</p>
<form method="post" action="/yours/p/${esc(l.ref)}/order" class="kp-f">
<label><span>Size</span><select name="size" required>${best.map(s => `<option>${esc(s.image)} in, on ${esc(s.paper)}</option>`).join('')}</select></label>
<label><span>Paper</span><select name="paper">${PAPER_STOCK.map(([k, n]) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></label>
<label class="kp-c"><input type="checkbox" name="frame" value="1"> Framed, behind UV glass</label>
<label><span>Where to write</span><input type="email" name="email" required maxlength="160" value="${esc((b && b.email) || l.licensee_email || '')}" autocomplete="email"></label>
<label class="kp-wide"><span>A note (optional)</span><input name="note" maxlength="300" placeholder="A date it is for, a frame you have in mind"></label>
<button class="buy-btn">Ask for the print</button></form>
${orders.length ? `<ul class="kp-ord">${orders.map(o => `<li>${esc(o.size || '')}${o.paper ? `, ${esc(o.paper)}` : ''}${o.frame ? ', framed' : ''} · asked ${esc(date(o.at))} · <i>${esc({ asked: 'with the house', making: 'being printed', sent: 'sent', done: 'delivered' }[o.status] || o.status)}</i></li>`).join('')}</ul>` : ''}</div>
</div></section>

<section class="kp-s"><p class="k">The prints of this piece</p><h2>${prints.length ? `${prints.length} print${prints.length === 1 ? '' : 's'}, recorded.` : 'Record a print when you make one.'}</h2>
<p class="kp-lede">A print you make is part of the piece’s life: recorded here, it stays with the number, and goes with it if you ever pass it on.</p>
${prints.length ? `<ul class="kp-pr">${prints.map(p => `<li><b>${esc(p.size || '')}</b>${p.paper ? ` · ${esc(p.paper)}` : ''}${p.made ? ` · ${esc(p.made)}` : ''}</li>`).join('')}</ul>` : ''}
<form method="post" action="/yours/print" class="kp-f kp-rec"><input type="hidden" name="ref" value="${esc(l.ref)}"><input type="hidden" name="back" value="/yours/p/${esc(l.ref)}"><label><span>Size</span><input name="size" placeholder="16 × 20 in" required maxlength="60"></label><label><span>Paper or lab</span><input name="paper" maxlength="80"></label><label><span>When</span><input name="made" maxlength="40" placeholder="October 2026"></label><button>Record it</button></form></section>

<section class="kp-s kp-live"><p class="k">Live with it</p><h2>Not only on paper.</h2><div class="kp-grid">
<a href="/frame" class="kp-tile">${I.full}<b>On your television</b><span>A screen at home is a wall. Choose your gallery as the set; it changes slowly through the evening.</span></a>
<button type="button" class="kp-tile hg-open" data-hang-open="${esc(w.slug)}">${I.hang}<b>Hang it on a wall</b><span>Put it beside others you love, in an order you choose, with a line of your own. Show the wall, or keep it.</span></button>
${file ? `<a href="${file}" class="kp-tile" download>${I.in || I.plus}<b>On your phone</b><span>Save it to Photos; set it as your lock screen. It is yours to keep.</span></a>` : ''}
<a href="/w/${esc(w.slug)}#closer" class="kp-tile">${I.guide}<b>Look closer</b><span>The wall text and the study: what to look for, the place and its story, the artists it speaks to.</span></a>
</div></section>

<section class="kp-s kp-papers"><p class="k">The papers</p><h2>What you hold, and the proof of it.</h2><ul class="kp-pp">
<li><a href="/c/${esc(l.ref)}${l.download_token ? `?k=${esc(l.download_token)}` : ''}">The certificate</a><span>Signed by the maker, with your number and what you may do with it.</span></li>
<li><a href="/c/${esc(l.ref)}/contract">The agreement</a><span>The words you accepted, kept as they were.</span></li>
<li><a href="/t/${esc(require('./track').compact(l.ref))}">The Watermark number</a><span>Anyone can check it, any time: it says the piece is yours and genuine.</span></li>
${live && dl.limit ? `<li><span class="kp-k">Downloads</span><span>${dl.left} of ${dl.limit} left. Each file carries your name and the license within it.</span></li>` : ''}
</ul>${l.collector_no ? `<p class="kp-pass">To give it to someone, or trade it: <a href="/yours?tab=files#files">pass it on</a>. It leaves your gallery the moment it lands in theirs, with every print recorded.</p>` : ''}</section>
</div><script src="/static/hang.js?v=${V.VER}" defer></script>` });
  }

  app.get('/yours/p/:ref', (req, res) => {
    const l = lic(req.params.ref); if (!l) return res.sendStatus(404);
    if (!mine(req, l)) return res.redirect(`/c/${encodeURIComponent(l.ref)}`);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    res.send(room({ l, w, maker: mk(w), b: buyerOf(req), ok: req.query.ok || null }));
  });
  const hits = new Map(), slow = k => { const now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 36e5); a.push(now); hits.set(k, a); return a.length > 6; };
  app.post('/yours/p/:ref/order', (req, res) => {
    const l = lic(req.params.ref); if (!l || !mine(req, l)) return res.sendStatus(404);
    const x = req.body || {}, t = (v, n) => String(v || '').trim().slice(0, n);
    const size = t(x.size, 80), email = t(x.email, 160).toLowerCase();
    if (!size || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || slow(req.ip)) return res.redirect(303, `/yours/p/${encodeURIComponent(l.ref)}?ok=check#print`);
    const b = buyerOf(req), w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id), maker = mk(w);
    db.prepare('INSERT INTO print_orders (license_id, buyer_id, size, paper, frame, email, note) VALUES (?,?,?,?,?,?,?)').run(l.id, b ? b.id : null, size, t(x.paper, 80) || null, x.frame === '1' ? 1 : 0, email, t(x.note, 300) || null);
    ledger.append(db, 'print.asked', l.ref, { size });
    mail.send({ to: HOUSE, subject: `A print asked for: ${tidy(w.title)}, ${size}`, text: `${tidy(w.title)}, by ${maker.name}. ${l.ref}${l.collector_no ? `, No. ${l.collector_no}` : ''}.\n\nSize: ${size}\nPaper: ${t(x.paper, 80) || 'their choice'}\nFramed: ${x.frame === '1' ? 'yes' : 'no'}\nWrite to: ${email}\n${x.note ? `Note: ${t(x.note, 300)}\n` : ''}\nThe file: the original, held in the vault (${w.width} × ${w.height}).\n\nWatermark` });
    mail.send({ to: email, subject: `Your print of ${tidy(w.title)}`, text: `Thank you. The house has your request for a print of ${tidy(w.title)}, by ${maker.name}: ${size}${x.paper ? `, ${t(x.paper, 80)}` : ''}${x.frame === '1' ? ', framed' : ''}.\n\nWe will write within a day with the price and the day it will be ready.\n\nYour piece: ${C.base}/yours/p/${l.ref}\n\nWatermark` });
    res.redirect(303, `/yours/p/${encodeURIComponent(l.ref)}?ok=asked#print`);
  });

  // The house's guide to printing: for anyone, collector or not.
  app.get('/print', (req, res) => {
    res.send(V.layout({ title: 'Print your work · Watermark', path: '/print', desc: 'How to print a photograph well: the file, the paper, the size, the lab, the frame.', body: `<article class="narrow kp-guide">
<p class="k">The house’s guide</p><h1>Print your work.</h1>
<p class="lede">A photograph on a screen is light passing through. On paper it becomes a thing: it has a surface and an edge, it lives in a room, it is there when you come home. The house wants every work it holds to be seen this way, at least once. This is how.</p>
<h2>1. The file</h2><p>What prints well is a matter of pixels across the paper. At 300 pixels to the inch a print holds every detail at reading distance; at 240 it is fine in a frame at arm’s length; at 180 it holds on a wall seen from a step back. Each piece in your gallery shows the sizes its file prints at. Send the file to the lab as it is: Watermark files are in sRGB colour, which every lab expects, and need no sharpening or resizing.</p>
<h2>2. The paper</h2>${PAPER_STOCK.map(([, n, d]) => `<p><b>${esc(n)}.</b> ${esc(d)}</p>`).join('')}<p>Ask for archival pigment printing (often called giclée). It lasts a century and more behind glass, out of direct sun.</p>
<h2>3. The size</h2><p>Smaller than you think is often better: a photograph at 11 × 14 inches, framed with a wide mat, draws people close. Leave a border of white paper, two inches or more, around the picture; it is where the eye rests, and where the work can be signed and numbered in pencil.</p>
<h2>4. The lab</h2><p>Use a lab that makes fine-art prints and will show you a proof, ideally one you can visit. Order a small proof first, on the paper you have chosen, and look at it by daylight, near a window. If the colour or the darks are not right, say so; a good lab adjusts. Or ask the house, which prints on archival cotton and fibre and checks every print by eye before it is sent.</p>
<h2>5. The frame</h2><p>A simple wood or metal frame, a white or off-white mat, and UV-filtering glass (museum glass if you can) to keep the colour and cut the reflection. Hang it out of direct sun, with its centre 57 inches from the floor: the height museums hang at, the eye level of most people standing.</p>
<h2>6. Record it</h2><p>When the print is made, record it on the piece in your gallery: the size, the paper, the date. It becomes part of the piece’s life, and goes with it if you pass it on.</p>
<p class="kp-gend"><a class="buy-btn" href="/yours">Your gallery</a> <a href="/collection">Or find something to print →</a></p></article>` }));
  });
  return { sizes };
}
module.exports = { mountKeep, sizes };
