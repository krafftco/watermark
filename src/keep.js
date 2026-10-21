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

// The proof (Will, 19 Oct): the first object most collectors will own. A 5 × 7 print of the piece from the house's
// own print room (the PRO-1100, Hahnemühle Photo Rag), the number in pencil, posted. One price, paid at once from
// the pocket or by Checkout; it lands on the print room's desk already paid. Drafts: the price, US only.
const PROOF_CENTS = Number(process.env.PROOF_CENTS || 2500);
const PROOF_PAPER = 'Hahnemühle Photo Rag';

// Instax (Will, 20 Oct: "print your collection into Instax print"; he has a Leica Sofort 2). The Sofort 2 and the Instax
// mini printers lay down 800 × 600 pixels on a 62 × 46 mm picture (about 330 dpi); the Leica FOTOS app resamples whatever
// it is given. So the house makes the file the printer actually prints, and nothing is left to the app: the picture
// cropped to the frame (or fitted, with white), resampled once with Lanczos, sharpened for a small print, and given the
// house's recipe for instant film, which prints darker, flatter and cooler than a screen: shadows lifted a little, a
// touch more saturation, sRGB. The recipe is a first draft, to be tuned by eye against the Sofort 2 in the print room.
// It is the holder's own derivative of their file, made on request; nothing is laid into any picture the house shows.
const INSTAX = { mini: { w: 800, h: 600, mm: '62 × 46 mm', name: 'Instax mini' }, square: { w: 800, h: 800, mm: '62 × 62 mm', name: 'Instax Square' }, wide: { w: 1260, h: 840, mm: '99 × 62 mm', name: 'Instax Wide' } };
async function instaxFile(src, { film = 'mini', mode = 'fill', mono = false } = {}) {
  const sharp = require('sharp'); const F = INSTAX[film] || INSTAX.mini;
  const meta = await sharp(src).metadata();
  const portrait = (meta.height || 0) > (meta.width || 0) && F.w !== F.h;
  const W = portrait ? F.h : F.w, H = portrait ? F.w : F.h;
  let img = sharp(src, { failOn: 'none' }).rotate().toColorspace('srgb');
  img = mode === 'fit' ? img.resize(W, H, { fit: 'contain', background: '#ffffff', kernel: 'lanczos3' }) : img.resize(W, H, { fit: 'cover', position: 'attention', kernel: 'lanczos3' });
  // The recipe: a gentle lift of the shadows (gamma), a little more colour, then sharpening for 330 dpi on film.
  img = img.gamma(1.0, 1.08).modulate({ saturation: mono ? 1 : 1.06, brightness: 1.02 }).sharpen({ sigma: 0.8, m1: 0.6, m2: 1.2 });
  if (mono) img = img.greyscale();
  return { buf: await img.jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).withMetadata().toBuffer(), W, H, film: F };
}

function mountKeep(app, { db, V, C, buyerOf, mk, mail, ledger, dlOf, isStudio, stripe, pocket, setBuyer, originalPath }) {
  db.exec(`CREATE TABLE IF NOT EXISTS print_orders (id INTEGER PRIMARY KEY, license_id INTEGER NOT NULL, buyer_id INTEGER, size TEXT, paper TEXT,
    frame INTEGER NOT NULL DEFAULT 0, email TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'asked', at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const [col, def] of [['kind', "TEXT NOT NULL DEFAULT 'ask'"], ['cents', 'INTEGER'], ['paid', 'INTEGER NOT NULL DEFAULT 0'], ['stripe_session', 'TEXT'], ['ship_name', 'TEXT'], ['address', 'TEXT']]) {
    if (!db.prepare("SELECT 1 FROM pragma_table_info('print_orders') WHERE name=?").get(col)) db.exec(`ALTER TABLE print_orders ADD COLUMN ${col} ${def}`);
  }
  const { esc, tidy, date, money } = V, HOUSE = process.env.HOUSE_EMAIL || 'house@watermark.krafftco.com';
  const pk = () => (typeof pocket === 'function' ? pocket() : pocket) || app.locals.pocket;
  const lic = ref => db.prepare(`SELECT l.*, u.key AS use_key, u.kind AS use_kind, u.name AS use_name FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.ref=?`).get(String(ref));
  const mine = (req, l) => { const b = buyerOf(req), k = String((req.query && req.query.k) || (req.body && req.body.k) || ''); return !!(l && ((b && l.buyer_id === b.id) || isStudio(req) || (k && l.download_token && k === l.download_token))); };

  // What the holder's file is, in pixels: Collect is the 2400-pixel copy; the Reference and working licenses the original.
  function fileOf(l, w) {
    const W = w.width || 0, H = w.height || 0, L = Math.max(W, H), S = Math.min(W, H);
    if (l.use_key === 'social') { const k = L ? Math.min(1, 2400 / L) : 1; return { L: Math.round(L * k), S: Math.round(S * k), what: 'The 2400-pixel copy' }; }
    return { L, S, what: 'The full original' };
  }

  function room({ l, w, maker, b, ok, kq = '' }) {
    const f = fileOf(l, w), sz = sizes(f.L, f.S), best = sz.filter(s => s.grade), top = best[best.length - 1];
    const prints = db.prepare('SELECT * FROM prints WHERE license_id=? ORDER BY id').all(l.id);
    const orders = db.prepare('SELECT * FROM print_orders WHERE license_id=? ORDER BY id DESC').all(l.id);
    const dl = dlOf(l), live = l.status === 'active' && (!l.ends_at || new Date(l.ends_at) > new Date());
    const ref = db.prepare("SELECT u.price_cents FROM uses u WHERE u.maker_id=? AND u.key='reference'").get(w.maker_id);
    const canRef = !!(l.use_key === 'social' && ref && ref.price_cents != null && Math.max(w.width || 0, w.height || 0) >= 7000);
    const title = tidy(w.title), yr = (w.taken_at || '').slice(0, 4), r = (w.width && w.height ? w.width / w.height : 1.5).toFixed(3);
    const no = l.collector_no ? `No.&nbsp;${l.collector_no}${w.edition_size ? ` of ${w.edition_size}` : ''}` : esc(l.use_name);
    const file = live && l.download_token && dl.left ? `/d/${esc(l.download_token)}` : null;
    const note = { asked: 'Asked. The house will write within a day with the paper, the size, the price and when it will be ready.', recorded: 'Recorded. The print is part of this piece’s life now.', check: 'Choose a size, and say where to write.', proof: 'Yours. The proof is with the print room; it will be posted within the week, and you will be written to when it goes.', proofcheck: 'Your name, the address and where to write, please.', proofoff: 'The proof cannot be paid for just now. Write to the house and we will arrange it.' }[ok];
    const proofs = orders.filter(o => o.kind === 'proof' && o.paid), proofSz = sizes(f.L, f.S)[0];
    const bal = b && pk() ? pk().balance(b) : 0, proofPocket = bal >= PROOF_CENTS;
    const proof = live ? `<div class="kp-proof"><div class="kp-proof-pic" style="--r:${r}"><img src="/img/${esc(w.slug)}/thumb" alt=""></div><div class="kp-proof-t"><p class="k">The proof</p><h3>Hold it in your hand, ${money(PROOF_CENTS)}.</h3>
<p>A 5 × 7 print of <i>${esc(title)}</i> from the house’s own print room: pigment on ${PROOF_PAPER}, the picture ${proofSz ? esc(proofSz.image) + ' inches' : 'fitted to the sheet'} with a white border, ${l.collector_no ? 'your number' : 'the title'} in pencil beneath. Posted to you${proofs.length ? `. You have ${proofs.length === 1 ? 'one' : proofs.length}` : ''}.</p>
<form method="post" action="/yours/p/${esc(l.ref)}/proof" class="kp-f kp-pf">${kq ? `<input type="hidden" name="k" value="${esc(kq)}">` : ''}
<label><span>Name on the parcel</span><input name="name" required maxlength="80" value="${esc((b && b.name) || l.licensee_name || '')}" autocomplete="name"></label>
<label><span>Where to write</span><input type="email" name="email" required maxlength="160" value="${esc((b && b.email) || l.licensee_email || '')}" autocomplete="email"></label>
<label class="kp-wide"><span>Street</span><input name="street" required maxlength="120" autocomplete="street-address"></label>
<label><span>City</span><input name="city" required maxlength="60" autocomplete="address-level2"></label>
<label><span>State</span><input name="state" required maxlength="2" autocomplete="address-level1" placeholder="NY"></label>
<label><span>ZIP</span><input name="zip" required maxlength="10" inputmode="numeric" autocomplete="postal-code"></label>
${proofPocket ? `<button class="buy-btn" name="from" value="pocket">${money(PROOF_CENTS)} from your pocket</button>` : `<button class="buy-btn">The proof, ${money(PROOF_CENTS)}</button>`}<small class="kp-pfn">United States for now; elsewhere by letter to the house. Posted within the week.</small></form></div></div>` : '';
    return V.layout({ title: `${title} · Yours · Watermark`, path: '/yours', desc: `${title}, by ${maker.name}. Yours.`, body: `<div class="kp">
<section class="kp-wall"><figure class="kp-mount" style="--r:${r}"><img src="/img/${esc(w.slug)}/large" alt="${esc(title)}, a photograph by ${esc(maker.name)}" draggable="false"><figcaption class="kp-pencil"><span>${no}</span><span><i>${esc(title)}</i>${yr ? `, ${esc(yr)}` : ''}</span><span class="kp-sig">${esc(maker.name)}</span></figcaption></figure></section>
<header class="kp-h"><p class="k"><a href="/yours">Your gallery</a> · ${no}</p><h1><i>${esc(title)}</i> is yours.</h1>
<p class="kp-l">${require('./object').aBy(w, '').replace(/ by $/, '')} by <a href="/m/${esc(V.makerSlug(maker))}">${esc(maker.name)}</a>${w.place ? `, ${esc(w.place)}` : ''}${yr ? `, ${esc(yr)}` : ''}. Held since ${esc(date(l.starts_at))}.</p>
<nav class="kp-acts" aria-label="What to do with it"><a href="#print" class="kp-a kp-a1">${I.print}<span>Print it</span></a><a href="/frame" class="kp-a">${I.full}<span>On your TV</span></a><button type="button" class="kp-a hg-open" data-hang-open="${esc(w.slug)}">${I.hang}<span>Hang it</span></button>${file ? `<a href="${file}" class="kp-a" download>${I.in || I.plus}<span>Save it</span></a>` : ''}<a href="/c/${esc(l.ref)}${l.download_token ? `?k=${esc(l.download_token)}` : ''}" class="kp-a">${I.page}<span>The papers</span></a></nav></header>
${note ? `<p class="${ok === 'check' ? 'err' : 'ok'} kp-note">${note}</p>` : ''}

<section class="kp-s kp-print" id="print"><p class="k">Print it</p><h2>See it in person.</h2>
<p class="kp-lede">A photograph is finished when it is printed. On paper it has weight and edges; it changes with the light in your room through the day; it is seen across a room, not scrolled past. Everything you need is here.</p>
<div class="kp-file"><div><span class="kp-fk">Your file</span><b>${esc(f.what)}</b><small>${f.L && f.S ? `${f.L.toLocaleString('en-US')} × ${f.S.toLocaleString('en-US')} pixels · sRGB colour · ready for any lab` : 'Ready for any lab'}</small></div>
${top ? `<div><span class="kp-fk">Prints beautifully to</span><b>${esc(top.image)} in</b><small>on ${esc(top.paper)} paper</small></div>` : ''}
${file ? `<a class="buy-btn kp-take" href="${file}" download>Take the print file</a>` : `<span class="kp-fk">${!live ? 'This license has ended.' : !l.download_token ? `The file is kept with <a href="/c/${esc(l.ref)}">the license</a>.` : 'Every download has been used: write to the house for another.'}</span>`}</div>
<table class="kp-sz"><thead><tr><th>Paper</th><th>The picture</th><th>How it holds</th></tr></thead><tbody>${sz.filter((s, i) => s.grade || i < best.length + 2).map(s => `<tr class="${s.grade ? 'kp-g-' + s.grade : 'kp-no'}"><td>${esc(s.paper)} in</td><td>${esc(s.image)} in</td><td>${s.grade ? `<span class="kp-dot"></span>${GRADE[s.grade]}` : canRef ? 'Larger than this file: the Reference prints it' : 'Larger than this file holds'}</td></tr>`).join('')}</tbody></table>
${proof}
${canRef ? `<p class="kp-up">To print larger, <a href="/license/${esc(w.slug)}?use=reference">collect the Reference</a>, ${money(ref.price_cents)}: the full original, ${(w.width || 0).toLocaleString('en-US')} × ${(w.height || 0).toLocaleString('en-US')} pixels, for prints to ${esc((sizes(Math.max(w.width, w.height), Math.min(w.width, w.height)).filter(s => s.grade).pop() || {}).image || 'wall size')} in.</p>` : ''}

${live ? `<div class="kp-way kp-instax" id="instax"><p class="k">Instax</p><h3>Print it in your hand, in ninety seconds.</h3>
<p>For a Leica Sofort 2 or any Instax printer. The house makes the exact file the printer lays down (800 × 600 pixels on a 62 × 46 mm picture), already cropped, sharpened and set for instant film, which prints darker and flatter than a screen. Nothing is left to the app.</p>
<form method="get" action="/yours/p/${esc(l.ref)}/instax" class="kp-f kp-ix">${kq ? `<input type="hidden" name="k" value="${esc(kq)}">` : ''}
<label><span>Film</span><select name="film"><option value="mini">Instax mini (Sofort 2)</option><option value="square">Instax Square</option><option value="wide">Instax Wide</option></select></label>
<label><span>The frame</span><select name="mode"><option value="fill">Fill the frame</option><option value="fit">Whole picture, white edges</option></select></label>
<button class="buy-btn">Take the Instax file</button></form>
<ol class="kp-steps kp-ixs"><li>Save the file to your phone (it lands in Photos).</li><li>Open <b>Leica FOTOS</b> (or the Instax app), choose <b>Print</b>, and pick the file from your photos.</li><li>Leave every filter and effect off: the file is already set.</li><li>Print, and let it develop face down for ninety seconds. Record it below.</li></ol>
<p class="note">The recipe is the house’s own and a first draft, tuned by eye against the Sofort 2 in the print room. It never counts against your downloads.</p></div>` : ''}
<div class="kp-two">
<div class="kp-way"><p class="k">Print it yourself</p><h3>Five steps, one afternoon.</h3><ol class="kp-steps">
<li><b>Take the file</b> above. Send it to the lab exactly as it is: no sharpening, no resizing; it is already set for print.</li>
<li><b>Choose a lab</b> that makes fine-art (giclée) prints on cotton or fibre paper. A local one lets you see a proof.</li>
<li><b>Choose a paper.</b> Cotton rag, matte, for most photographs; baryta for darkroom blacks; lustre for a first proof.</li>
<li><b>Choose a size</b> from the table: anything marked holds. Leave a white border of two inches or more; it is where the eye rests.</li>
<li><b>Frame it</b> behind UV glass, with a mat, and hang its centre at 57 inches from the floor, as museums do.</li></ol>
<p><a href="/print">The house’s guide to printing →</a></p></div>
<div class="kp-way kp-house"><p class="k">Or have it printed</p><h3>The house prints it for you.</h3>
<p>Printed in the house’s own print room, pigment on Hahnemühle and Red River fine-art papers up to 17 inches wide, checked by eye, signed off and sent to your door, numbered to match your piece. Ask, and the house writes back with the price and the day it will be ready.</p>
<form method="post" action="/yours/p/${esc(l.ref)}/order" class="kp-f">${kq ? `<input type="hidden" name="k" value="${esc(kq)}">` : ''}
<label><span>Size</span><select name="size" required>${best.map(s => `<option>${esc(s.image)} in, on ${esc(s.paper)}</option>`).join('')}</select></label>
<label><span>Paper</span><select name="paper">${PAPER_STOCK.map(([k, n]) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></label>
<label class="kp-c"><input type="checkbox" name="frame" value="1"> Framed, behind UV glass</label>
<label><span>Where to write</span><input type="email" name="email" required maxlength="160" value="${esc((b && b.email) || l.licensee_email || '')}" autocomplete="email"></label>
<label class="kp-wide"><span>A note (optional)</span><input name="note" maxlength="300" placeholder="A date it is for, a frame you have in mind"></label>
<button class="buy-btn">Ask for the print</button></form>
${orders.filter(o => o.kind !== 'proof' || o.paid).length ? `<ul class="kp-ord">${orders.filter(o => o.kind !== 'proof' || o.paid).map(o => `<li>${o.kind === 'proof' ? 'The proof, ' : ''}${esc(o.size || '')}${o.paper ? `, ${esc(o.paper)}` : ''}${o.frame ? ', framed' : ''} · asked ${esc(date(o.at))} · <i>${esc({ asked: 'with the house', making: 'being printed', sent: 'sent', done: 'delivered' }[o.status] || o.status)}</i></li>`).join('')}</ul>` : ''}</div>
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
    res.send(room({ l, w, maker: mk(w), b: buyerOf(req), ok: req.query.ok || null, kq: req.query.k && l.download_token === String(req.query.k) ? l.download_token : '' }));
  });
  // The Instax file, made on request from the holder's own file (the original; or the 2400 px copy's source is the same original).
  app.get('/yours/p/:ref/instax', async (req, res) => {
    const l = lic(req.params.ref); if (!l || !mine(req, l)) return res.sendStatus(404);
    if (l.status !== 'active' || (l.ends_at && new Date(l.ends_at) < new Date())) return res.sendStatus(410);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id); if (!w) return res.sendStatus(404);
    try {
      const src = await originalPath(w);
      const out = await instaxFile(src, { film: String(req.query.film || 'mini'), mode: req.query.mode === 'fit' ? 'fit' : 'fill' });
      const name = `${tidy(w.title)}, ${mk(w).name} (${out.film.name}).jpg`.replace(/[\/:*?"<>|]/g, '');
      ledger.append(db, 'print.instax', l.ref, { film: out.film.name, w: out.W, h: out.H });
      res.set({ 'Content-Type': 'image/jpeg', 'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'private, no-store' }).send(out.buf);
    } catch (e) { console.error('[instax]', e.message); res.sendStatus(500); }
  });
  const hits = new Map(), slow = k => { const now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 36e5); a.push(now); hits.set(k, a); return a.length > 6; };
  app.post('/yours/p/:ref/order', (req, res) => {
    const l = lic(req.params.ref); if (!l || !mine(req, l)) return res.sendStatus(404);
    const x = req.body || {}, t = (v, n) => String(v || '').trim().slice(0, n);
    const size = t(x.size, 80), email = t(x.email, 160).toLowerCase();
    if (!size || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || slow(req.ip)) return res.redirect(303, `/yours/p/${encodeURIComponent(l.ref)}?ok=check${x.k ? '&k=' + encodeURIComponent(x.k) : ''}#print`);
    const b = buyerOf(req), w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id), maker = mk(w);
    db.prepare('INSERT INTO print_orders (license_id, buyer_id, size, paper, frame, email, note) VALUES (?,?,?,?,?,?,?)').run(l.id, b ? b.id : null, size, t(x.paper, 80) || null, x.frame === '1' ? 1 : 0, email, t(x.note, 300) || null);
    ledger.append(db, 'print.asked', l.ref, { size });
    mail.send({ to: HOUSE, subject: `A print asked for: ${tidy(w.title)}, ${size}`, text: `${tidy(w.title)}, by ${maker.name}. ${l.ref}${l.collector_no ? `, No. ${l.collector_no}` : ''}.\n\nSize: ${size}\nPaper: ${t(x.paper, 80) || 'their choice'}\nFramed: ${x.frame === '1' ? 'yes' : 'no'}\nWrite to: ${email}\n${x.note ? `Note: ${t(x.note, 300)}\n` : ''}\nThe file: the original, held in the vault (${w.width} × ${w.height}).\n\nWatermark` });
    mail.send({ to: email, subject: `Your print of ${tidy(w.title)}`, text: `Thank you. The house has your request for a print of ${tidy(w.title)}, by ${maker.name}: ${size}${x.paper ? `, ${t(x.paper, 80)}` : ''}${x.frame === '1' ? ', framed' : ''}.\n\nWe will write within a day with the price and the day it will be ready.\n\nYour piece: ${C.base}/yours/p/${l.ref}\n\nWatermark` });
    res.redirect(303, `/yours/p/${encodeURIComponent(l.ref)}?ok=asked${x.k ? '&k=' + encodeURIComponent(x.k) : ''}#print`);
  });

  // The proof: paid at once, from the pocket or by Checkout; it reaches the desk already paid.
  const proofSize = (l, w) => { const f = fileOf(l, w), s = sizes(f.L, f.S)[0]; return s ? `${s.image} in, on 7 × 5` : '7 × 5'; };
  function proofPaid(o, how, s) {
    if (!o || o.paid) return;
    db.prepare("UPDATE print_orders SET paid=1, status='asked', stripe_session=COALESCE(?, stripe_session) WHERE id=?").run(s ? s.id : null, o.id);
    if (s && s.customer && o.buyer_id) db.prepare("UPDATE buyers SET customer=COALESCE(NULLIF(customer,''), ?), email=COALESCE(email, ?) WHERE id=?").run(s.customer, (s.customer_details || {}).email || null, o.buyer_id);
    const l = db.prepare('SELECT * FROM licenses WHERE id=?').get(o.license_id), w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id), maker = mk(w);
    ledger.append(db, 'proof.collected', l.ref, { cents: o.cents, how });
    mail.send({ to: HOUSE, subject: `A proof, paid: ${tidy(w.title)}`, text: `${tidy(w.title)}, by ${maker.name}. ${l.ref}${l.collector_no ? `, No. ${l.collector_no}` : ''}.\n\nThe proof: ${o.size}, ${PROOF_PAPER}. Paid ${money(o.cents)} (${how}).\n\nPost to:\n${o.ship_name}\n${o.address}\n\nWrite to: ${o.email}\n\nThe file: the original, held in the vault (${w.width} × ${w.height}). Studio → Prints moves it along.\n\nWatermark` });
    if (o.email) mail.send({ to: o.email, subject: `The proof of ${tidy(w.title)}`, text: `Thank you. A proof of ${tidy(w.title)}, by ${maker.name}, is with the house's print room: ${o.size}, pigment on ${PROOF_PAPER}, ${l.collector_no ? `No. ${l.collector_no}` : 'the title'} in pencil beneath.\n\nIt will be posted within the week to:\n${o.ship_name}\n${o.address}\n\nYou will be written to when it goes.\n\nYour piece: ${C.base}/yours/p/${l.ref}\n\nWatermark` });
  }
  app.post('/yours/p/:ref/proof', async (req, res) => {
    const l = lic(req.params.ref); if (!l || !mine(req, l)) return res.sendStatus(404);
    const x = req.body || {}, t = (v, n) => String(v || '').trim().slice(0, n), kq = x.k ? '&k=' + encodeURIComponent(x.k) : '';
    const back = ok => res.redirect(303, `/yours/p/${encodeURIComponent(l.ref)}?ok=${ok}${kq}#print`);
    const name = t(x.name, 80), email = t(x.email, 160).toLowerCase(), street = t(x.street, 120), city = t(x.city, 60), state = t(x.state, 20).toUpperCase(), zip = t(x.zip, 10);
    if (!name || !street || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(-\d{4})?$/.test(zip) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || slow(req.ip)) return back('proofcheck');
    const live = l.status === 'active' && (!l.ends_at || new Date(l.ends_at) > new Date()); if (!live) return back('proofoff');
    let b = buyerOf(req), w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    const address = `${street}\n${city}, ${state} ${zip}\nUnited States`, size = proofSize(l, w);
    const id = db.prepare("INSERT INTO print_orders (license_id, buyer_id, kind, size, paper, email, ship_name, address, cents, paid, status) VALUES (?,?,'proof',?,?,?,?,?,?,0,'pending')").run(l.id, b ? b.id : null, size, PROOF_PAPER, email, name, address, PROOF_CENTS).lastInsertRowid;
    const o = db.prepare('SELECT * FROM print_orders WHERE id=?').get(id);
    if (x.from === 'pocket' && b && pk() && pk().spend(b, PROOF_CENTS, 'proof', l.ref, `The proof of ${tidy(w.title)}`)) { proofPaid(o, 'pocket'); return back('proof'); }
    if (!stripe) { db.prepare('DELETE FROM print_orders WHERE id=?').run(id); return back('proofoff'); }
    if (!b && setBuyer) { const bid = db.prepare("INSERT INTO buyers (customer, email) VALUES ('', ?)").run(email).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(bid); setBuyer(res, b); db.prepare('UPDATE print_orders SET buyer_id=? WHERE id=?').run(b.id, id); }
    try {
      const s = await stripe.checkout.sessions.create({ mode: 'payment', submit_type: 'pay', ...(b && b.customer ? { customer: b.customer } : { customer_email: email }),
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: PROOF_CENTS, product_data: { name: `The proof: ${tidy(w.title)}`, description: `A 5 × 7 print from the house's print room, pigment on ${PROOF_PAPER}, posted to you.`, images: [`${C.base}/img/${w.slug}/screen?f=jpg`] } } }],
        metadata: { proof: String(id) }, payment_intent_data: { metadata: { proof: String(id) } },
        success_url: `${C.base}/yours/p/${l.ref}/proof/thanks?id=${id}&session_id={CHECKOUT_SESSION_ID}${l.download_token ? `&k=${l.download_token}` : ''}`, cancel_url: `${C.base}/yours/p/${l.ref}${l.download_token ? `?k=${l.download_token}` : ''}#print` });
      db.prepare('UPDATE print_orders SET stripe_session=? WHERE id=?').run(s.id, id);
      res.redirect(303, s.url);
    } catch (e) { console.error('[proof]', e.message); db.prepare('DELETE FROM print_orders WHERE id=?').run(id); back('proofoff'); }
  });
  function settleProof(id, s) {
    const o = db.prepare('SELECT * FROM print_orders WHERE id=?').get(Number(id));
    if (!o || o.paid || o.kind !== 'proof' || o.stripe_session !== s.id || s.payment_status !== 'paid') return;
    proofPaid(o, 'card', s);
  }
  app.get('/yours/p/:ref/proof/thanks', async (req, res) => {
    const o = db.prepare('SELECT * FROM print_orders WHERE id=?').get(Number(req.query.id));
    if (o && !o.paid && stripe && o.stripe_session === req.query.session_id) { try { settleProof(o.id, await stripe.checkout.sessions.retrieve(o.stripe_session)); } catch (e) { /* the webhook */ } }
    res.redirect(`/yours/p/${encodeURIComponent(req.params.ref)}?ok=proof${req.query.k ? '&k=' + encodeURIComponent(req.query.k) : ''}#print`);
  });
  app.locals.keepEvent = event => { if (event.type === 'checkout.session.completed') { const s = event.data.object; if (s.metadata && s.metadata.proof) settleProof(s.metadata.proof, s); } };

  // The wall letter (Will, 19 Oct): thirty days after a personal Collect with nothing printed and no proof asked,
  // one letter, 'Ready to hang', with the proof; once per piece, never again. Daily.
  db.exec(`CREATE TABLE IF NOT EXISTS wall_letters (license_id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  async function wallLetters({ days = 30 } = {}) {
    const rows = db.prepare(`SELECT l.*, u.key AS use_key, u.kind AS use_kind, u.name AS use_name FROM licenses l JOIN uses u ON u.id=l.use_id
      WHERE l.status='active' AND l.licensee_email IS NOT NULL AND l.licensee_email<>'' AND u.kind<>'print' AND u.key IN ('social','reference')
      AND l.starts_at <= datetime('now', ?) AND (l.ends_at IS NULL OR l.ends_at > datetime('now'))
      AND l.id NOT IN (SELECT license_id FROM wall_letters) AND l.id NOT IN (SELECT license_id FROM prints)
      AND l.id NOT IN (SELECT license_id FROM print_orders WHERE status<>'pending') ORDER BY l.id LIMIT 50`).all(`-${days} days`);
    let n = 0;
    for (const l of rows) {
      db.prepare('INSERT OR IGNORE INTO wall_letters (license_id) VALUES (?)').run(l.id);
      const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id); if (!w) continue; const maker = mk(w);
      const k = l.download_token ? `?k=${l.download_token}` : '';
      try {
        const m = require('./mail-letters').ready({ base: C.base, title: tidy(w.title), maker: maker.name, year: (w.taken_at || '').slice(0, 4) || null, img: `${C.base}/img/${w.slug}/screen?f=jpg`, no: l.collector_no || null, of: w.edition_size || null,
          printUrl: `${C.base}/yours/p/${l.ref}${k}#print`, guideUrl: `${C.base}/print`, proof: { price: money(PROOF_CENTS), url: `${C.base}/yours/p/${l.ref}${k}#print` } });
        await mail.send({ to: l.licensee_email, subject: m.subject, text: m.text, html: m.html }); n++;
      } catch (e) { console.error('[wall]', l.ref, e.message); }
    }
    return n;
  }
  app.locals.wallLetters = wallLetters;

  // The print room's desk (Studio → Prints): every print asked for, moved along by hand; the asker is told at each step.
  const STEPS = { asked: 'Asked', making: 'Being printed', sent: 'Sent', done: 'Delivered', declined: 'Declined' };
  app.get('/studio/prints', (req, res) => {
    if (!isStudio(req)) return res.redirect('/studio/login');
    const rows = db.prepare(`SELECT o.*, l.ref, l.collector_no, w.slug, w.title, w.width, w.height FROM print_orders o JOIN licenses l ON l.id=o.license_id JOIN works w ON w.id=l.work_id WHERE o.status<>'pending' ORDER BY (o.status IN ('asked','making','sent')) DESC, o.id DESC LIMIT 300`).all();
    res.send(V.layout({ title: 'Prints · Studio · Watermark', studio: true, path: '/studio/prints', body: `<section class="studio-wrap"><p class="k">The print room</p><h1>Prints asked for.</h1>
<p class="lede">Each request is answered by letter with the price and the day; then moved along here. The asker is written to at each step. The original is in the vault at full size.</p>
${rows.length ? `<table class="tbl"><tr><th></th><th>Work</th><th>Print</th><th>Asked by</th><th>Asked</th><th>Where it is</th></tr>${rows.map(o => `<tr><td><img class="cat-th" src="/img/${esc(o.slug)}/thumb" alt="" width="56" height="42"></td><td><a href="/w/${esc(o.slug)}">${esc(tidy(o.title))}</a><br><small>${esc(o.ref)}${o.collector_no ? ` · No. ${o.collector_no}` : ''} · ${o.width} × ${o.height}</small></td><td>${o.kind === 'edition' ? `<b>The print, No. ${o.edition_no || '?'}</b> · ${esc(o.size || '')}<br><small>${esc(o.paper || '')}${o.framed ? ' · framed' : ''} · paid ${money(o.cents || 0)}${o.pickup ? ' · <b>taken home from the show</b>' : ''}${o.note ? ` · ${esc(o.note)}` : ''}</small>` : o.kind === 'proof' ? `<b>The proof</b> · ${esc(o.size || '')}<br><small>${esc(o.paper || '')} · paid ${money(o.cents || 0)}</small>` : `${esc(o.size || '')}<br><small>${esc(o.paper || '')}${o.frame ? ' · framed' : ''}${o.note ? ` · “${esc(o.note)}”` : ''}</small>`}</td><td><a href="mailto:${esc(o.email || '')}">${esc(o.email || '')}</a>${o.address ? `<br><small>${esc(o.ship_name || '')}<br>${esc(o.address).replace(/\n/g, '<br>')}</small>` : ''}</td><td>${esc(date(o.at))}</td><td><form method="post" action="/studio/prints/${o.id}" class="inline"><select name="status">${Object.entries(STEPS).map(([k, n]) => `<option value="${k}"${o.status === k ? ' selected' : ''}>${n}</option>`).join('')}</select> <button>Move</button></form></td></tr>`).join('')}</table>` : '<p>None yet. When a collector asks for a print from their piece, it arrives here and by mail.</p>'}</section>` }));
  });
  app.post('/studio/prints/:id', (req, res) => {
    if (!isStudio(req)) return res.sendStatus(403);
    const o = db.prepare('SELECT o.*, l.ref, w.title FROM print_orders o JOIN licenses l ON l.id=o.license_id JOIN works w ON w.id=l.work_id WHERE o.id=?').get(+req.params.id); if (!o) return res.sendStatus(404);
    const st = String((req.body || {}).status || ''); if (!STEPS[st] || st === o.status) return res.redirect('/studio/prints');
    db.prepare('UPDATE print_orders SET status=? WHERE id=?').run(st, o.id);
    const words = { making: 'is being printed now. We check every print by eye before it leaves.', sent: 'is on its way to you.', done: 'has arrived, we hope safely. Record it on your piece so it stays with the number.', declined: 'could not be made as asked. We will write separately.' }[st];
    if (words && o.email) mail.send({ to: o.email, subject: `Your print of ${tidy(o.title)}`, text: `Your print of ${tidy(o.title)} (${o.size}${o.paper ? `, ${o.paper}` : ''}) ${words}\n\nYour piece: ${C.base}/yours/p/${o.ref}\n\nWatermark` });
    res.redirect('/studio/prints');
  });

  // The house's guide to printing: for anyone, collector or not.
  app.get('/print', (req, res) => {
    res.send(V.layout({ title: 'Print your work · Watermark', path: '/print', desc: 'How to print a photograph well: the file, the paper, the size, the lab, the frame.', body: `<article class="narrow kp-guide">
<p class="k">The house’s guide</p><h1>Print your work.</h1>
<p class="lede">A photograph on a screen is light passing through. On paper it becomes a thing: it has a surface and an edge, it lives in a room, it is there when you come home. The house wants every work it holds to be seen this way, at least once. This is how.</p>
<h2>1. The file</h2><p>What prints well is a matter of pixels across the paper. At 300 pixels to the inch a print holds every detail at reading distance; at 240 it is fine in a frame at arm’s length; at 180 it holds on a wall seen from a step back. Each piece in your gallery shows the sizes its file prints at. Send the file to the lab as it is: Watermark files are in sRGB colour, which every lab expects, and need no sharpening or resizing.</p>
<h2>2. The paper</h2>${PAPER_STOCK.map(([, n, d]) => `<p><b>${esc(n)}.</b> ${esc(d)}</p>`).join('')}<p>Ask for archival pigment printing (often called giclée). It lasts a century and more behind glass, out of direct sun.</p>
<h2>3. The size</h2><p>Smaller than you think is often better: a photograph at 11 × 14 inches, framed with a wide mat, draws people close. Leave a border of white paper, two inches or more, around the picture; it is where the eye rests, and where the work can be signed and numbered in pencil.</p>
<h2>4. The lab</h2><p>Use a lab that makes fine-art prints and will show you a proof, ideally one you can visit. Order a small proof first, on the paper you have chosen, and look at it by daylight, near a window. If the colour or the darks are not right, say so; a good lab adjusts.</p><p><b>Or ask the house.</b> Watermark has its own print room: a Canon imagePROGRAF PRO-1100, twelve pigment inks, printing up to 17 inches wide on Hahnemühle and Red River fine-art papers, cotton and fibre, with each paper’s own colour profile. Every print is checked by eye before it is sent. Ask from the piece in your gallery; the house writes back within a day with the paper, the size and the price.</p>
<h2>5. The frame</h2><p>A simple wood or metal frame, a white or off-white mat, and UV-filtering glass (museum glass if you can) to keep the colour and cut the reflection. Hang it out of direct sun, with its centre 57 inches from the floor: the height museums hang at, the eye level of most people standing.</p>
<h2>6. Record it</h2><p>When the print is made, record it on the piece in your gallery: the size, the paper, the date. It becomes part of the piece’s life, and goes with it if you pass it on.</p>
<p class="kp-gend"><a class="buy-btn" href="/yours">Your gallery</a> <a href="/collection">Or find something to print →</a></p></article>` }));
  });
  return { sizes };
}
module.exports = { mountKeep, sizes, PROOF_CENTS, PROOF_PAPER, instaxFile, INSTAX };
