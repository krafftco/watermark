// The editions room (Will, 20 Oct: "we also want our art to be sold"; "this should work perfectly with actual
// prints and real shows, like a curator's best friend"; the first time the work is shown is on Watermark and at
// the Leica gallery in Meatpacking). A print edition is a product on a work: a size, a paper, an edition of N,
// a price, a framed option, signed and numbered. A guest at the show taps the QR on the wall label, sees
// 'Edition of 12 on Hahnemühle Photo Rag, 16 × 24, $650, 4 remain', pays in one tap with their address (or takes it
// home from the show), and holds No. 5 of 12: the print, the papers, and the piece in their gallery on Watermark
// are one object. The maker is told; the print room gets the order; the show's desk lists what sold, to whom, and
// what to pack.
//   `print_editions` (work_id, label, long_in, paper, edition_n, price_cents, framed_cents, active, sort). The
//   house's sizes (EDITION_DEFAULTS, drafts) open with one click on the work's record (maker or Studio); each row is
//   edited there (POST /account|studio/works/:slug/editions). A print is sold only when the master meets the print
//   standard (`meets(w, 'print')`) and the maker lists 'On a wall'.
//   The work page: `.pe` (sizes with price and what remains, framed, take it home at the show or shipped) →
//   POST /w/:slug/print → a license of the 'print' use (price = size + framed; rights.print = {edition, label,
//   paper, framed, pickup, show}) → Checkout with the address (unless pickup) → on payment `onGrant`: the edition
//   number allotted (never reused), a `print_orders` row (kind 'edition', the address, 'asked' for the print room),
//   `print.sold` on the register ('A print of X, No. 5 of 12, 16 × 24, was acquired'), the maker told.
//   The show (a public hang with an opening): /hang/:id/labels (the curator or the Studio): one wall label a work
//   with the QR to /w/:slug?show=<hang slug> (which remembers the show for thirty days, so every sale is the show's),
//   the editions and prices, sold dots; /hang/:id/sales (+ .csv): what sold through the show, the addresses, pickup
//   or ship, totals, the packing list. The hang page shows 'N remain' or 'Sold' under each work of a show.
//   Studio → Prints moves each print order Asked → Printing → Sent → Delivered as before.
const qr = require('./qr');

const EDITION_DEFAULTS = [
  { label: '11 × 14', long_in: 14, paper: 'Hahnemühle Photo Rag', edition_n: 12, price_cents: 25000, framed_cents: 15000 },
  { label: '16 × 24', long_in: 24, paper: 'Hahnemühle Photo Rag', edition_n: 12, price_cents: 65000, framed_cents: 30000 },
  { label: '24 × 36', long_in: 36, paper: 'Hahnemühle Photo Rag', edition_n: 8, price_cents: 140000, framed_cents: 45000 },
];
const VIA_DAYS = 30;

const FEE = require('./fee');
function mountEditions(app, X) {
  const { db, C, V, stripe, q, mk, R, K, nextRef, meets, listed, priced, buyerOf, ledger, studioOnly, isStudio, makerOf, notify } = X;
  const { esc, money } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS print_editions (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, label TEXT NOT NULL, long_in REAL, paper TEXT, edition_n INTEGER NOT NULL DEFAULT 12,
    price_cents INTEGER NOT NULL, framed_cents INTEGER, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec('CREATE INDEX IF NOT EXISTS print_editions_work ON print_editions (work_id, sort)');
  for (const col of ['edition_id', 'edition_no', 'framed', 'pickup', 'show_id', 'work_id']) if (!db.prepare("SELECT 1 FROM pragma_table_info('print_orders') WHERE name=?").get(col)) db.exec(`ALTER TABLE print_orders ADD COLUMN ${col} INTEGER`);
  const tidy = t => String(t || '').replace(/[.\s]+$/, '');
  const rowsOf = w => db.prepare('SELECT * FROM print_editions WHERE work_id=? AND active=1 ORDER BY sort, id').all(w.id);
  const allOf = w => db.prepare('SELECT * FROM print_editions WHERE work_id=? ORDER BY sort, id').all(w.id);
  const soldOf = ed => db.prepare("SELECT COUNT(*) n FROM print_orders WHERE edition_id=? AND paid=1 AND status!='declined'").get(ed.id).n;
  const withLeft = rows => rows.map(e => { const sold = soldOf(e); return { ...e, sold, left: Math.max(0, e.edition_n - sold) }; });
  const forWork = w => withLeft(rowsOf(w));
  const sizeOf = (w, e) => { if (!w.width || !w.height || !e.long_in) return e.label; const r = Math.min(w.width, w.height) / Math.max(w.width, w.height); const s = +(e.long_in * r).toFixed(1); return w.width >= w.height ? `${s} × ${e.long_in} in` : `${e.long_in} × ${s} in`; };
  const printUse = m => { const u = q.use.get(m.id, 'print'); return u || null; };
  const canSell = (w, m) => { const u = printUse(m); return !!(u && stripe && listed(R.parse(w.rules), 'print', w) && meets(w, 'print') && !w.open); };

  // The show the visitor came from: ?show=<hang slug> on a work page remembers it, as a wall does.
  const showOf = slug => db.prepare('SELECT * FROM hangs WHERE slug=? AND public=1').get(String(slug));
  const showOn = h => h && h.opens_at && (!h.closes_at || new Date(h.closes_at + 'T23:59:59') >= new Date());
  app.locals.rememberShow = (req, res, next) => {
    if (req.method === 'GET' && req.query.show) { const h = showOf(req.query.show); if (h) res.cookie('wm_via', `hang:${h.id}`, { httpOnly: true, sameSite: 'lax', secure: C.base.startsWith('https'), maxAge: VIA_DAYS * 864e5 }); }
    next();
  };
  const viaShow = req => { if (req.query && req.query.show) { const h = showOf(req.query.show); if (showOn(h)) return h; } const v = (req.cookies && req.cookies.wm_via) || ''; const m = v.match(/^hang:(\d+)$/); if (!m) return null; const h = db.prepare('SELECT * FROM hangs WHERE id=?').get(+m[1]); return showOn(h) ? h : null; };

  // ---- the block on the work page
  function block(w, m, req) {
    if (!canSell(w, m)) return '';
    const rows = forWork(w); if (!rows.length) return '';
    const show = viaShow(req); const any = rows.some(r => r.left > 0);
    return `<section class="pe" id="print"><p class="k">The print</p><h2>${any ? 'Have it on your wall.' : 'The editions are sold.'}</h2>
<p class="pe-lede">An archival pigment print from the house's print room, signed and numbered by ${esc(m.name)}, with its papers; the piece joins your gallery on Watermark the moment it is yours.</p>
${any ? `<form method="post" action="/w/${esc(w.slug)}/print" class="pe-f" data-pe data-house-pct="${FEE.on() ? FEE.HOUSE_PCT : 0}">
<div class="pe-sizes">${rows.map((e, i) => `<label class="pe-s${e.left ? '' : ' pe-out'}"><input type="radio" name="edition" value="${e.id}"${e.left ? (i === rows.findIndex(x => x.left) ? ' checked' : '') : ' disabled'} data-price="${e.price_cents}" data-framed="${e.framed_cents || 0}"><span class="pe-l"><b>${esc(e.label)} in</b><i>${esc(sizeOf(w, e))} on ${esc(e.paper || 'archival paper')}</i><i>Edition of ${e.edition_n} · ${e.left ? `${e.left} remain` : 'sold out'}</i></span><span class="pe-p">${money(FEE.total('print', e.price_cents))}</span></label>`).join('')}</div>
<div class="pe-opts">${rows.some(r => r.framed_cents) ? `<label class="pe-o"><input type="checkbox" name="framed" value="1"><span>Framed, museum glass<i data-pe-framed></i></span></label>` : ''}
${show ? `<label class="pe-o"><input type="radio" name="how" value="pickup" checked><span>Take it home from the show<i>${esc(show.title)}${show.venue ? ` · ${esc(show.venue)}` : ''}</i></span></label><label class="pe-o"><input type="radio" name="how" value="ship"><span>Have it sent<i>Two to three weeks; the address at payment</i></span></label>` : '<p class="pe-ship">Sent in two to three weeks, to the address you give at payment. United States, Canada, the UK and Europe.</p>'}</div>
<button class="buy-btn pe-go"><span>Acquire it</span><em data-pe-total>${money(FEE.total('print', rows.find(x => x.left).price_cents))}</em></button>
<p class="pe-fine">${FEE.on() ? `The price is ${esc(m.name.split(' ')[0])}’s, every dollar; the house’s share (${FEE.HOUSE_PCT}%) is on top, in the total shown.` : `${m.share_pct != null ? m.share_pct : 85}% of it is ${esc(m.name.split(' ')[0])}'s.`} Yours to keep, to hang, to pass on; the papers say so.</p></form>
<script>(function(){var f=document.querySelector('[data-pe]');if(!f)return;var t=f.querySelector('[data-pe-total]'),fr=f.querySelector('[data-pe-framed]');function up(){var e=f.querySelector('input[name=edition]:checked');if(!e)return;var p=+e.dataset.price,x=+e.dataset.framed,c=f.querySelector('input[name=framed]');if(fr)fr.textContent=x?'+$'+(x/100).toLocaleString('en-US'):'';if(c&&c.checked)p+=x;var h=+f.dataset.housePct||0;p=p+Math.ceil(p*h/100);t.textContent='$'+(p/100).toLocaleString('en-US')}f.addEventListener('change',up);up()})();</script>` : ''}</section>`;
  }
  app.locals.editions = { forWork, canSell, block, sizeOf, EDITION_DEFAULTS, viaShow };

  // ---- the purchase
  const slow = new Map();
  app.post('/w/:slug/print', async (req, res) => {
    const w = q.work.get(req.params.slug); if (!w || w.status !== 'held') return res.sendStatus(404);
    const m = mk(w); if (!canSell(w, m)) return res.redirect(`/w/${w.slug}`);
    const e = withLeft(rowsOf(w).filter(x => x.id === +req.body.edition))[0]; if (!e || !e.left) return res.redirect(`/w/${w.slug}?ok=printgone#print`);
    const n = (slow.get(req.ip) || 0) + 1; slow.set(req.ip, n); if (n > 20) return res.sendStatus(429);
    const framed = req.body.framed === '1' && e.framed_cents ? 1 : 0; const show = viaShow(req); const pickup = show && req.body.how === 'pickup' ? 1 : 0;
    const u = priced(printUse(m), w); const makerPrice = e.price_cents + (framed ? e.framed_cents : 0); const price = FEE.total('print', makerPrice);
    const rules = R.parse(w.rules);
    const t = K.terms({ use: u, add: [], extras: [], never: rules.never, base: price, transfer: rules.transfer || null });
    t.price = price; t.maker = makerPrice; t.house = price - makerPrice; t.print = { edition: e.id, label: e.label, size: sizeOf(w, e), paper: e.paper, edition_n: e.edition_n, framed, pickup, show: show ? show.id : null };
    const ref = nextRef();
    t.version = 'standard-2021-counsel/v0'; t.hash = require('crypto').createHash('sha256').update(JSON.stringify(K.assemble({ t, work: w.title, maker: m.name, ref }))).digest('hex');
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,intended_use,price_cents,status,conditions,rights) VALUES (?,?,?,?,?,?,?,'awaiting_payment',?,?)")
      .run(ref, w.id, u.id, 'Collector', '', `A print: ${e.label} in on ${e.paper || 'archival paper'}${framed ? ', framed' : ''}${pickup ? `, taken from the show (${show.title})` : ''}`, price, R.conditions(rules) || null, JSON.stringify(t));
    if (FEE.on()) db.prepare('UPDATE licenses SET house_cents=? WHERE ref=?').run(price - makerPrice, ref);
    if (show) db.prepare('UPDATE licenses SET via=? WHERE ref=?').run(`hang:${show.id}`, ref);
    const b = buyerOf(req); if (b) db.prepare('UPDATE licenses SET buyer_id=?, licensee_name=?, licensee_email=? WHERE ref=?').run(b.id, b.name || 'Collector', b.email || '', ref);
    ledger.append(db, 'license.checkout', ref, { work: w.slug, use: 'print', edition: e.label });
    try {
      const s = await stripe.checkout.sessions.create({
        mode: 'payment', submit_type: 'pay', ...(b && b.customer ? { customer: b.customer } : b && b.email ? { customer_email: b.email } : {}),
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: price, product_data: { name: `${tidy(w.title)}: the print, ${e.label} in`, description: `Archival pigment print on ${e.paper || 'archival paper'}, edition of ${e.edition_n}, signed and numbered by ${m.name}${framed ? ', framed' : ''}. ${pickup ? `Taken home from ${show.title}.` : 'Sent in two to three weeks.'} Watermark ${ref}.` } } }],
        ...(pickup ? {} : { shipping_address_collection: { allowed_countries: ['US', 'CA', 'GB', 'FR', 'DE', 'IT', 'CH', 'ES', 'NL', 'AU'] } }),
        phone_number_collection: { enabled: true },
        metadata: { ref, print: '1' }, payment_intent_data: { metadata: { ref } },
        custom_text: { submit: { message: `By paying you accept the Standard Content License Agreement for this print (${ref}) and the terms of the house: ${C.base}/terms, and the prints agreement: ${C.base}/legal/prints.` } },
        success_url: `${C.base}/thanks/${ref}?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${C.base}/w/${w.slug}#print`,
      });
      db.prepare("UPDATE licenses SET stripe_session=? WHERE ref=?").run(s.id, ref);
      res.redirect(303, s.url);
    } catch (err) { console.error('[print]', err.message); db.prepare('DELETE FROM licenses WHERE ref=? AND status=\'awaiting_payment\'').run(ref); res.redirect(`/w/${w.slug}?ok=printoff#print`); }
  });

  // On payment: the number, the order for the print room, the register, the maker.
  function onGrant(l, extra) {
    let t = null; try { t = l.rights ? JSON.parse(l.rights) : null; } catch (e) { t = null; }
    if (!t || !t.print || !extra.paid) return;
    if (db.prepare('SELECT 1 FROM print_orders WHERE license_id=? AND kind=\'edition\'').get(l.id)) return;
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id); const m = mk(w); const p = t.print;
    const no = db.prepare("SELECT COALESCE(MAX(edition_no),0)+1 n FROM print_orders WHERE edition_id=?").get(p.edition).n;
    const s = extra.session || null; const sd = s && (s.shipping_details || s.customer_details) || {}; const a = sd.address || {};
    const address = p.pickup ? null : [a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country].filter(Boolean).join('\n') || null;
    const email = (s && s.customer_details && s.customer_details.email) || l.licensee_email || null; const name = sd.name || (s && s.customer_details && s.customer_details.name) || l.licensee_name || null;
    const phone = s && s.customer_details && s.customer_details.phone ? s.customer_details.phone : null;
    db.prepare("INSERT INTO print_orders (license_id, buyer_id, kind, size, paper, email, ship_name, address, cents, paid, status, edition_id, edition_no, framed, pickup, show_id, work_id, note) VALUES (?,?,'edition',?,?,?,?,?,?,1,'asked',?,?,?,?,?,?,?)")
      .run(l.id, l.buyer_id || null, `${p.label} in (${p.size})`, p.paper || null, email, name, address, l.price_cents, p.edition, no, p.framed ? 1 : 0, p.pickup ? 1 : 0, p.show || null, w.id, [phone ? `Phone ${phone}` : null, p.pickup ? 'Taken home from the show' : null].filter(Boolean).join(' · ') || null);
    t.print.no = no; db.prepare('UPDATE licenses SET rights=? WHERE id=?').run(JSON.stringify(t), l.id);
    ledger.append(db, 'print.sold', w.slug, { maker: m.handle, edition: p.label, no, of: p.edition_n, framed: !!p.framed, show: p.show || undefined, amount: l.price_cents });
    const nf = notify || app.locals.notify; if (nf && m) { try { nf.tell({ maker_id: m.id, kind: 'sold', href: `/account/works/${w.slug}`, title: `A print of ${tidy(w.title)} was acquired`, body: `${p.label} in, No. ${no} of ${p.edition_n}${p.framed ? ', framed' : ''}${p.pickup ? ', taken from the show' : ''} · ${money(l.price_cents)}` }); } catch (e) { /* quiet */ } }
  }
  app.locals.onGrant = onGrant;

  // ---- the record: the maker's or the Studio's editions on a work
  function recordBlock(w, base) {
    const rows = allOf(w).map(e => ({ ...e, sold: soldOf(e) }));
    const m = mk(w);
    const ok = meets(w, 'print'), lst = listed(R.parse(w.rules), 'print', w);
    return `<h2 id="editions">The print editions</h2><section class="pe-rec">
<p class="note">${ok ? '' : 'The master is under the print standard (24 MP); prints are offered once it is in the house. '}${lst ? '' : "'On a wall' is not listed for this work in its terms; list it to sell prints. "}${rows.length ? `${rows.length} size${rows.length === 1 ? '' : 's'}; ${rows.reduce((a, r) => a + r.sold, 0)} sold.` : 'No editions yet.'}</p>
${rows.length ? `<table class="tbl pe-t"><tr><th>Size</th><th>Long edge</th><th>Paper</th><th>Edition</th><th>Price</th><th>Framed +</th><th>Sold</th><th>On</th><th></th></tr>${rows.map(e => `<tr><form method="post" action="${base}/editions"><input type="hidden" name="id" value="${e.id}"><td><input name="label" value="${esc(e.label)}" size="8"></td><td><input name="long_in" value="${e.long_in || ''}" size="4"></td><td><input name="paper" value="${esc(e.paper || '')}" size="18"></td><td><input name="edition_n" value="${e.edition_n}" size="3"></td><td>$<input name="price" value="${(e.price_cents / 100).toFixed(0)}" size="6"></td><td>$<input name="framed" value="${e.framed_cents ? (e.framed_cents / 100).toFixed(0) : ''}" size="5"></td><td>${e.sold} of ${e.edition_n}</td><td><input type="checkbox" name="active" value="1"${e.active ? ' checked' : ''}></td><td><button class="link">Save</button></td></form></tr>`).join('')}</table>` : ''}
<form method="post" action="${base}/editions" class="inline"><input type="hidden" name="open" value="1"><button class="buy-btn">${rows.length ? 'Add the house\'s sizes' : 'Open editions with the house\'s sizes'}</button> <span class="small">11 × 14 $250 · 16 × 24 $650 · 24 × 36 $1,400, editions of 12 (8 for the largest), framed +$150/$300/$450. Drafts: set your own.</span></form>
<form method="post" action="${base}/editions" class="inline pe-new"><input type="hidden" name="new" value="1"><input name="label" placeholder="20 × 30" size="8"><input name="long_in" placeholder="30" size="4"><input name="paper" placeholder="Paper" size="18"><input name="edition_n" placeholder="12" size="3">$<input name="price" placeholder="900" size="6"><button class="link">Add a size</button></form>
${rows.length ? `<p class="small"><a href="/w/${esc(w.slug)}#print">See it as a collector does</a></p>` : ''}</section>`;
  }
  app.locals.editionsBlock = recordBlock;
  const save = (w, body) => {
    if (body.open === '1') { const have = allOf(w).map(e => e.label); let i = allOf(w).length; for (const d of EDITION_DEFAULTS) if (!have.includes(d.label)) db.prepare('INSERT INTO print_editions (work_id, label, long_in, paper, edition_n, price_cents, framed_cents, sort) VALUES (?,?,?,?,?,?,?,?)').run(w.id, d.label, d.long_in, d.paper, d.edition_n, d.price_cents, d.framed_cents, i++); return 'editions'; }
    const cents = v => Math.round(parseFloat(String(v || '').replace(/[$,]/g, '')) * 100);
    const label = String(body.label || '').trim().slice(0, 40), long_in = parseFloat(body.long_in) || null, paper = String(body.paper || '').trim().slice(0, 80) || null, edition_n = Math.max(1, Math.min(1000, parseInt(body.edition_n, 10) || 12)), price = cents(body.price), framed = body.framed ? cents(body.framed) : null;
    if (body.new === '1') { if (!label || !(price > 0)) return 'editioncheck'; db.prepare('INSERT INTO print_editions (work_id, label, long_in, paper, edition_n, price_cents, framed_cents, sort) VALUES (?,?,?,?,?,?,?,?)').run(w.id, label, long_in, paper, edition_n, price, framed, allOf(w).length); return 'editions'; }
    const e = db.prepare('SELECT * FROM print_editions WHERE id=? AND work_id=?').get(+body.id, w.id); if (!e) return 'editioncheck';
    if (!label || !(price > 0)) return 'editioncheck';
    db.prepare('UPDATE print_editions SET label=?, long_in=?, paper=?, edition_n=?, price_cents=?, framed_cents=?, active=? WHERE id=?').run(label, long_in, paper, Math.max(edition_n, soldOf(e)), price, framed, body.active === '1' ? 1 : 0, e.id);
    return 'editions';
  };
  app.post('/studio/works/:slug/editions', studioOnly, (req, res) => { const w = q.work.get(req.params.slug); if (!w) return res.sendStatus(404); const ok = save(w, req.body || {}); ledger.append(db, 'work.editions', w.slug, { by: 'studio' }); res.redirect(`/studio/works/${encodeURIComponent(w.slug)}?ok=${ok}#editions`); });
  app.post('/account/works/:slug/editions', (req, res) => { const m = makerOf(req); if (!m) return res.sendStatus(401); const w = db.prepare('SELECT * FROM works WHERE slug=? AND maker_id=?').get(req.params.slug, m.id); if (!w) return res.sendStatus(404); const ok = save(w, req.body || {}); ledger.append(db, 'work.editions', w.slug, { by: m.handle }); res.redirect(`/account/works/${encodeURIComponent(w.slug)}?ok=${ok}#editions`); });

  // ---- the show: wall labels, and the desk of what sold
  const hangOf = id => db.prepare('SELECT * FROM hangs WHERE id=?').get(+id);
  const hangWorks = h => db.prepare('SELECT w.*, hw.pos, hw.note FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? ORDER BY hw.pos, w.id').all(h.id);
  const curates = (req, h) => { if (isStudio(req)) return true; const b = buyerOf(req); return !!(b && h.buyer_id === b.id); };
  app.get('/hang/:id/labels', (req, res) => {
    const h = hangOf(req.params.id); if (!h || !curates(req, h)) return res.sendStatus(404);
    const works = hangWorks(h).filter(w => w.status === 'held');
    const labels = works.map(w => { const m = mk(w); const eds = canSell(w, m) ? forWork(w) : []; const yr = (w.taken_at || '').slice(0, 4); const sold = eds.length && eds.every(e => !e.left);
      const url = `${C.base}/w/${w.slug}?show=${encodeURIComponent(h.slug)}`;
      return `<div class="wl" data-url="${esc(url)}"><div class="wl-q">${qr.svg(url, { size: 150 })}</div><div class="wl-t"><h2>${esc(tidy(w.title))}</h2><p class="wl-m">${esc(m.name)}${yr ? `, ${esc(yr)}` : ''}${w.place ? ` · ${esc(w.place)}` : ''}</p><p class="wl-md">${esc(w.medium || 'Archival pigment print')}${eds.length ? ` on ${esc(eds[0].paper || 'Hahnemühle Photo Rag')}` : ''}</p>
${eds.length ? `<ul class="wl-e">${eds.map(e => `<li><b>${esc(e.label)} in</b> · edition of ${e.edition_n} · ${money(e.price_cents)}${e.left ? (e.left < e.edition_n ? ` · ${e.left} remain` : '') : ' · <i>sold</i>'}</li>`).join('')}</ul>` : `<p class="wl-e">Collect it on Watermark</p>`}
<p class="wl-u">${esc(C.base.replace(/^https?:\/\//, ''))}/w/${esc(w.slug)}${sold ? ' <span class="wl-dot" title="Sold"></span>' : ''}</p></div></div>`; }).join('');
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Wall labels · ${esc(h.title)}</title><style>
body{font-family:Georgia,'Times New Roman',serif;color:#0b0a09;margin:0;background:#fff}.wl{display:grid;grid-template-columns:150px 1fr;gap:18px;width:5.5in;height:3.4in;padding:.3in;box-sizing:border-box;border:1px solid #ddd;break-inside:avoid;page-break-inside:avoid;margin:0 0 .25in}.wl-q svg{width:150px;height:150px}.wl h2{font:400 20px/1.15 Georgia,serif;margin:0 0 4px}.wl-m{margin:0 0 2px;font-size:13px}.wl-md{margin:0 0 8px;font-size:12px;color:#555;font-style:italic}.wl-e{list-style:none;padding:0;margin:0 0 8px;font:12px/1.5 Helvetica,Arial,sans-serif}.wl-e i{color:#a0323a;font-style:normal}.wl-u{font:11px Helvetica,Arial,sans-serif;color:#666;margin:0}.wl-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#c0272d;vertical-align:middle;margin-left:6px}
.top{font:13px Helvetica,Arial,sans-serif;padding:14px 20px;border-bottom:1px solid #ddd;display:flex;gap:16px;align-items:center}.top a{color:#0b0a09}.sheet{padding:.4in;display:grid;grid-template-columns:1fr 1fr;gap:.25in}@media print{.top{display:none}.sheet{padding:0;gap:.2in}@page{margin:.4in}}
</style></head><body><div class="top"><b>Wall labels · ${esc(h.title)}</b><span>${works.length} works · 5.5 × 3.4 in each, two to a letter sheet; the QR opens the work with the show remembered, so each sale is the show's.</span><a href="/hang/${h.id}/sales">What sold</a><a href="javascript:print()">Print</a></div><div class="sheet">${labels}</div></body></html>`);
  });
  const salesOf = h => db.prepare(`SELECT l.ref, l.price_cents, l.starts_at, l.licensee_name, l.licensee_email, l.rights, w.title, w.slug, u.key AS use_key, u.name AS use_name, po.id AS order_id, po.size, po.paper, po.framed, po.pickup, po.ship_name, po.address, po.status AS order_status, po.edition_no, po.note AS order_note
    FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id LEFT JOIN print_orders po ON po.license_id=l.id AND po.kind='edition' WHERE l.via=? AND l.status IN ('active','expired') AND l.price_cents>0 ORDER BY l.starts_at DESC`).all(`hang:${h.id}`);
  app.get('/hang/:id/sales', (req, res) => {
    const h = hangOf(req.params.id); if (!h || !curates(req, h)) return res.sendStatus(404);
    const rows = salesOf(h); const total = rows.reduce((a, r) => a + (r.price_cents || 0), 0); const prints = rows.filter(r => r.order_id);
    res.send(V.layout({ title: `What sold · ${h.title} · Watermark`, path: '/hangs', body: `<section class="narrow op-l"><p class="k">The show</p><h1>${esc(h.title)}: what sold.</h1>
<p class="lede">${rows.length} sale${rows.length === 1 ? '' : 's'} through this show, ${money(total)} in all; ${prints.length} print${prints.length === 1 ? '' : 's'} (${prints.filter(r => r.pickup).length} taken home, ${prints.filter(r => !r.pickup).length} to send). <a href="/hang/${h.id}/sales.csv">The packing list (CSV)</a> · <a href="/hang/${h.id}/labels">Wall labels</a>${isStudio(req) ? ' · <a href="/studio/prints">The print room</a>' : ''}</p>
${rows.length ? `<table class="tbl"><tr><th>When</th><th>Work</th><th>What</th><th>Who</th><th>Where</th><th>Paid</th><th>State</th></tr>${rows.map(r => `<tr><td>${esc(String(r.starts_at || '').slice(0, 16).replace('T', ' '))}</td><td><a href="/w/${esc(r.slug)}">${esc(tidy(r.title))}</a></td><td>${r.order_id ? `Print ${esc(r.size)}${r.edition_no ? `, No. ${r.edition_no}` : ''}${r.framed ? ', framed' : ''}` : esc(r.use_name)}</td><td>${esc(r.ship_name || r.licensee_name || '')}<br><small>${esc(r.licensee_email || '')}</small></td><td>${r.order_id ? (r.pickup ? '<b>Taken home</b>' : esc(r.address || '').replace(/\n/g, '<br>')) : ''}</td><td>${money(r.price_cents)}</td><td>${r.order_id ? esc(r.order_status) : 'granted'}</td></tr>`).join('')}</table>` : '<p class="hd-calm">Nothing sold through the show yet. The wall labels carry the QR that makes a sale the show\'s.</p>'}</section>` }));
  });
  app.get('/hang/:id/sales.csv', (req, res) => {
    const h = hangOf(req.params.id); if (!h || !curates(req, h)) return res.sendStatus(404);
    const rows = salesOf(h); const c = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    res.type('text/csv').set('Content-Disposition', `attachment; filename="${h.slug}-sales.csv"`).send(['when,work,what,edition_no,framed,how,name,email,address,paid,state,ref'].concat(rows.map(r => [r.starts_at, tidy(r.title), r.order_id ? `Print ${r.size}` : r.use_name, r.edition_no || '', r.framed ? 'framed' : '', r.order_id ? (r.pickup ? 'pickup' : 'ship') : '', r.ship_name || r.licensee_name, r.licensee_email, (r.address || '').replace(/\n/g, ', '), (r.price_cents / 100).toFixed(2), r.order_status || 'granted', r.ref].map(c).join(','))).join('\n'));
  });
  // Under each work on a show's page: what remains.
  app.locals.editionLine = w => { const m = mk(w); if (!canSell(w, m)) return ''; const eds = forWork(w); if (!eds.length) return ''; const left = eds.reduce((a, e) => a + e.left, 0); const from = Math.min(...eds.map(e => e.price_cents)); return left ? `<span class="hg-ed">Prints from ${money(from)} · ${left} remain</span>` : '<span class="hg-ed hg-sold">Prints sold</span>'; };
  return { forWork, canSell, block, onGrant };
}
module.exports = { mountEditions, EDITION_DEFAULTS };
