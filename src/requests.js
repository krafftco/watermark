// Requests: what a maker is asked, and how they answer. A request is a license whose status is 'requested':
// a use the maker approves by hand, a use with no price, a use the held file is too small for (the master is
// needed), or any order while Stripe is off. The maker answers from their own studio (/account/requests):
// accept at a fee (a payment link goes to the buyer; the file and certificate follow payment), grant without
// payment, or decline with a word. The Studio keeps its own door (/studio/licenses) on the same answers.
// Every answer is written to the buyer and recorded on the register.
const fs = require('fs');
const { layout, esc, money, date, termText, setDeskPath } = require('./views');

function mountRequests(app, { db, C, q, mail, ledger, V, stripe, checkoutUrl, grant, isStudio, makerOf, upload, images, replaceMaster, meets, MIN_MP }) {
  const full = ref => db.prepare(`SELECT l.*, w.title, w.slug, w.width, w.height, w.maker_id, u.name AS use_name, u.kind, u.key AS use_key, u.term_months, u.price_cents AS use_price
    FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE l.ref=?`).get(String(ref || ''));
  const listFor = makerId => db.prepare(`SELECT l.*, w.title, w.slug, w.width, w.height, u.name AS use_name, u.key AS use_key
    FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE w.maker_id=? AND l.status IN ('requested','awaiting_payment','declined','active','expired')
    ORDER BY CASE l.status WHEN 'requested' THEN 0 WHEN 'awaiting_payment' THEN 1 ELSE 2 END, l.id DESC LIMIT 200`).all(makerId);
  const waiting = makerId => db.prepare("SELECT COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status='requested'").get(makerId).n;
  const open = l => l.status === 'requested' || l.status === 'awaiting_payment';
  const needsMaster = l => !meets({ width: l.width, height: l.height }, l.use_key);
  // The queue: what is waiting for this maker, oldest first, and where this one stands in it.
  const queue = makerId => db.prepare("SELECT l.ref FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status='requested' ORDER BY l.id").all(makerId).map(r => r.ref);
  const place = l => { const qu = queue(l.maker_id), i = qu.indexOf(l.ref); return { n: qu.length, at: i < 0 ? 0 : i + 1, next: qu.find((r, j) => r !== l.ref && (i < 0 || j > i)) || qu.find(r => r !== l.ref) || null }; };
  // What to suggest: what this maker last took for the use, else their price for it.
  const suggest = l => { const last = db.prepare("SELECT l.price_cents FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.use_id=l.use_id AND l.use_id=? AND l.status IN ('active','expired','awaiting_payment') AND l.price_cents>0 AND l.ref!=? ORDER BY l.id DESC LIMIT 1").get(l.maker_id, l.use_id, l.ref); return last ? { cents: last.price_cents, from: 'what you last took for this use' } : l.use_price ? { cents: l.use_price, from: 'your price for this use' } : null; };
  const earnedThisMonth = makerId => { const m = db.prepare('SELECT share_pct FROM makers WHERE id=?').get(makerId), r = db.prepare("SELECT COALESCE(SUM(l.price_cents),0) s, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0 AND l.starts_at>=date('now','start of month')").get(makerId); return { cents: Math.round(r.s * ((m && m.share_pct) || 85) / 100), n: r.n }; };

  // The answers, shared by the maker's desk and the Studio's.
  async function accept(ref, cents, by) {
    const l = full(ref); if (!l || !open(l)) return { ok: false, why: 'This request is no longer open.' };
    if (!(cents > 0)) return { ok: false, why: 'Set a fee.' };
    db.prepare("UPDATE licenses SET price_cents=?, status='awaiting_payment', updated_at=datetime('now') WHERE ref=?").run(cents, l.ref);
    ledger.append(db, 'license.quoted', l.ref, { currency: l.currency, by });
    if (!stripe) return { ok: true, url: null, note: 'Fee saved. Connect Stripe to send a payment link.' };
    const url = await checkoutUrl(l.ref);
    mail.send({ to: l.licensee_email, ...mail.templates.payToLicensee({ ref: l.ref, title: l.title, name: l.licensee_name, fee: V.money(cents), url }) });
    return { ok: true, url, note: mail.on() ? 'Accepted. The payment link is on its way to the buyer.' : 'Accepted. Send the buyer this payment link.' };
  }
  function give(ref, by) {
    const l = full(ref); if (!l || !open(l)) return { ok: false, why: 'This request is no longer open.' };
    grant(l.ref, { paid: false });
    ledger.append(db, 'license.granted.free', l.ref, { by });
    return { ok: true, note: 'Granted. The file and certificate have gone to the buyer.' };
  }
  function decline(ref, word, by) {
    const l = full(ref); if (!l || !open(l)) return { ok: false, why: 'This request is no longer open.' };
    db.prepare("UPDATE licenses SET status='declined', conditions=COALESCE(?, conditions), updated_at=datetime('now') WHERE ref=?").run(word ? `Declined: ${word}` : null, l.ref);
    ledger.append(db, 'license.declined', l.ref, { by });
    mail.send({ to: l.licensee_email, ...mail.templates.declinedToLicensee({ ref: l.ref, title: l.title, name: l.licensee_name, word, base: C.base, slug: l.slug }) });
    return { ok: true, note: 'Declined. The buyer has been told, kindly.' };
  }

  // Who may answer: the work's maker, or the Studio.
  const may = (req, l) => { const m = makerOf(req); return !!(l && (isStudio(req) || (m && m.id === l.maker_id))); };
  const back = (req, ref, msg) => `/account/requests/${encodeURIComponent(ref)}${msg ? `?ok=${encodeURIComponent(msg)}` : ''}`;
  // Answered: on to the next one waiting; when none, the desk says so.
  const onward = (l, msg) => { const nx = queue(l.maker_id).find(r => r !== l.ref); return nx ? back(null, nx, msg) : `/account/requests?ok=${encodeURIComponent(msg)}`; };

  app.get('/account/requests', (req, res) => {
    const m = makerOf(req) || (req.query.maker && isStudio(req) ? db.prepare('SELECT * FROM makers WHERE handle=?').get(String(req.query.maker)) : null);
    if (!m) return res.redirect('/signin?next=/account/requests');
    res.send(requestsPage({ m, list: listFor(m.id), needsMaster, first: queue(m.id)[0] || null, month: earnedThisMonth(m.id), ok: req.query.ok || null }));
  });
  app.get('/account/requests/:ref', (req, res) => {
    const l = full(req.params.ref); if (!l) return res.sendStatus(404);
    if (!may(req, l)) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    const mk = db.prepare('SELECT share_pct FROM makers WHERE id=?').get(l.maker_id);
    res.send(requestPage({ l, needs: needsMaster(l), min: MIN_MP[l.use_key] || 0, ok: req.query.ok || null, pay: req.query.pay || null, stripe: !!stripe, place: place(l), suggest: suggest(l), pct: (mk && mk.share_pct) || 85 }));
  });
  app.post('/account/requests/:ref/accept', async (req, res) => {
    const l = full(req.params.ref); if (!l) return res.sendStatus(404); if (!may(req, l)) return res.sendStatus(401);
    const x = req.body || {};
    if (x.free) { const r = give(l.ref, 'maker'); return res.redirect(r.ok ? onward(l, r.note) : back(req, l.ref, r.why)); }
    if (!(Number(x.price) > 0)) return res.redirect(back(req, l.ref, 'Set a fee, or tick Grant without payment.'));
    const r = await accept(l.ref, Math.round(Number(x.price) * 100), 'maker');
    if (r.ok && r.url && !mail.on()) return res.redirect(back(req, l.ref, r.note) + `&pay=${encodeURIComponent(r.url)}`);
    res.redirect(r.ok ? onward(l, r.note) : back(req, l.ref, r.why));
  });
  app.post('/account/requests/:ref/decline', (req, res) => {
    const l = full(req.params.ref); if (!l) return res.sendStatus(404); if (!may(req, l)) return res.sendStatus(401);
    const r = decline(l.ref, String((req.body || {}).word || '').trim().slice(0, 600) || null, 'maker');
    res.redirect(r.ok ? onward(l, r.note) : back(req, l.ref, r.why));
  });
  // The master, when the request needs it: same picture, larger; then the request can be accepted.
  app.post('/account/requests/:ref/master', (req, res, next) => upload().single('file')(req, res, next), async (req, res) => {
    const l = full(req.params.ref); if (!l) return res.sendStatus(404); if (!may(req, l)) return res.sendStatus(401);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id);
    const gone = () => { try { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch (e) { /* already gone */ } };
    if (!req.file) return res.redirect(back(req, l.ref, 'Choose the master file.'));
    try {
      const info = await images.inspect(req.file.path), h = await images.dhash(req.file.path);
      if (w.dhash && images.hamming(h, w.dhash) > 12) { gone(); return res.redirect(back(req, l.ref, 'That file does not look like this photograph. Nothing was changed.')); }
      if ((w.width || 0) * (w.height || 0) >= info.width * info.height) { gone(); return res.redirect(back(req, l.ref, 'That file is no larger than the one held.')); }
      await replaceMaster(w, req.file, info, h);
      res.redirect(back(req, l.ref, `The master is in: ${Math.round(info.width * info.height / 1e6)} megapixels. Now accept the request.`));
    } catch (e) { gone(); console.error('[master]', e.message); res.redirect(back(req, l.ref, 'That file could not be read.')); }
  });

  app.locals.requests = { accept, give, decline, waiting, full, needsMaster, queue };
  return app.locals.requests;
}

// ---- The desk ----
const short = d => { try { return new Date(d.replace(' ', 'T') + (/[Z+]/.test(d) ? '' : 'Z')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
const STATUS = { requested: 'Waiting for you', awaiting_payment: 'Accepted · awaiting payment', active: 'Licensed', declined: 'Declined', expired: 'Ended' };
function requestsPage({ m, list, needsMaster, first, month, ok }) {
  setDeskPath('/account/requests');
  const open = list.filter(l => l.status === 'requested'), rest = list.filter(l => l.status !== 'requested');
  const row = l => `<a class="rq" href="/account/requests/${esc(l.ref)}"><img src="/img/${esc(l.slug)}/thumb" alt="" loading="lazy"><span class="rq-t"><b>${esc(l.title)}</b><small>${esc(l.use_name)} · ${esc(l.licensee_name)}${l.licensee_company ? `, ${esc(l.licensee_company)}` : ''}</small></span><span class="rq-m">${l.price_cents ? money(l.price_cents) : 'No fee set'}${l.status === 'requested' && needsMaster(l) ? '<i>Needs the master</i>' : ''}</span><span class="rq-s s-${esc(l.status)}">${esc(STATUS[l.status] || l.status)}</span><span class="rq-d">${short(l.created_at)}</span></a>`;
  return layout({ title: 'Requests · Watermark', studio: true, body: `<section class="studio-wrap hd rq-pg"><p class="k">Your studio</p><h1>Requests.</h1>
${ok ? `<p class="ok rq-ok">${esc(ok)}</p>` : ''}
<div class="rq-top"><div class="rq-sum"><p class="lede">What people have asked of your work. Accept at a fee and a payment link goes out; the file and certificate follow payment. Or decline, with a word.</p>
<dl class="rq-nums"><div><dt>Waiting</dt><dd>${open.length}</dd></div><div><dt>Earned this month</dt><dd>${money(month.cents)}<small>${month.n} paid</small></dd></div></dl></div>
${first ? `<a class="jewel rq-go" href="/account/requests/${esc(first)}">Clear the desk<small>${open.length} waiting · one after another</small></a>` : `<div class="rq-clear"><p class="k">All clear</p><p>Nothing waits for you. New requests arrive here and by mail.</p></div>`}</div>
${open.length ? `<h2>Waiting for you</h2><div class="rq-list">${open.map(row).join('')}</div>` : ''}
${rest.length ? `<h2>Licensed, and answered</h2><div class="rq-list rq-done">${rest.map(row).join('')}</div>` : ''}</section>` });
}
function requestPage({ l, needs, min, ok, pay, stripe, place, suggest, pct }) {
  setDeskPath('/account/requests');
  const open = l.status === 'requested' || l.status === 'awaiting_payment';
  const fee = l.price_cents ? l.price_cents / 100 : suggest ? suggest.cents / 100 : '';
  const yours = c => money(Math.round(c * pct / 100));
  return layout({ title: `${l.ref} · Requests · Watermark`, studio: true, body: `<section class="studio-wrap hd rq-one" data-next="${esc(place.next || '')}">
<div class="rq-crumb"><p class="k"><a href="/account/requests">Requests</a> · ${esc(l.ref)}</p>${place.n ? `<p class="k rq-place">${l.status === 'requested' ? `${place.at} of ${place.n} waiting` : `${place.n} waiting`}${place.next ? ` · <a href="/account/requests/${esc(place.next)}">Next <kbd>N</kbd></a>` : ''}</p>` : ''}</div>
<div class="rq-head"><figure class="rq-fig"><img src="/img/${esc(l.slug)}/screen" alt="${esc(l.title)}"><figcaption><a href="/w/${esc(l.slug)}">${esc(l.title)}</a> · ${Math.round((l.width || 0) * (l.height || 0) / 1e6)} MP held</figcaption></figure>
<div class="rq-body"><h1>${esc(l.title)}</h1><p class="rq-st s-${esc(l.status)}">${esc(STATUS[l.status] || l.status)}</p>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}${pay ? `<p class="ok">Payment link: <a href="${esc(pay)}">${esc(pay)}</a></p>` : ''}
<dl class="facts rq-facts">
<div><dt>Asked by</dt><dd>${esc(l.licensee_name)}${l.licensee_company ? `, ${esc(l.licensee_company)}` : ''}<small><a href="mailto:${esc(l.licensee_email)}">${esc(l.licensee_email)}</a></small></dd></div>
<div><dt>Use</dt><dd>${esc(l.use_name)} · ${esc(termText(l))}</dd></div>
<div><dt>They say</dt><dd>${l.intended_use ? esc(l.intended_use) : '<span class="mu">Nothing more.</span>'}</dd></div>
<div><dt>Asked</dt><dd>${date(l.created_at)}</dd></div>
${l.conditions && /^Declined:/.test(l.conditions) ? `<div><dt>Your word</dt><dd>${esc(l.conditions.replace(/^Declined:\s*/, ''))}</dd></div>` : ''}
</dl>
${open && needs ? `<div class="rq-need"><p class="k">Needs the master</p><p>This use needs ${min} megapixels; the file held is ${Math.round((l.width || 0) * (l.height || 0) / 1e6)}. Put the full-resolution original in and the buyer receives it on payment.</p>
<form method="post" action="/account/requests/${esc(l.ref)}/master" enctype="multipart/form-data" class="form inline"><input type="file" name="file" accept="image/*" required><button>Add the master</button></form></div>` : ''}
${open ? `<div class="rq-acts">
<form method="post" action="/account/requests/${esc(l.ref)}/accept" class="form rq-accept" id="rq-accept"><div class="rq-fee"><label>Fee (USD)<input name="price" type="number" min="1" step="1" value="${fee}" id="rq-price" autocomplete="off"></label><p class="rq-sug">${suggest ? `${money(suggest.cents)}, ${esc(suggest.from)}.` : 'No price set for this use yet.'} <span id="rq-yours">${fee ? `${yours(Math.round(Number(fee) * 100))} is yours.` : ''}</span></p></div>
<button class="jewel rq-btn" id="rq-go" ${needs ? 'disabled title="Add the master first"' : ''}>Accept${stripe ? ' and send for payment' : ''}<kbd>A</kbd></button>
<button class="link rq-free" name="free" value="1" ${needs ? 'disabled' : ''}>Grant without payment<kbd>G</kbd></button></form>
<form method="post" action="/account/requests/${esc(l.ref)}/decline" class="form rq-decline"><label>A word to the buyer <small>optional</small><input name="word" id="rq-word" placeholder="Not for this use; try the one beside it." maxlength="600"></label><button class="link">Decline<kbd>D</kbd></button></form>
</div>
<p class="rq-keys">Keys: <b>A</b> accept at the fee · <b>G</b> grant free · <b>D</b> decline · <b>N</b> next · <b>Esc</b> the desk. After an answer the next one waiting comes up.</p>` : `<p class="note">${l.status === 'active' ? `Licensed. <a href="/c/${esc(l.ref)}">The license page.</a>` : l.status === 'declined' ? 'You declined this request.' : 'This request is closed.'}</p>`}
</div></div>
<script>(function(){var s=document.querySelector('.rq-one'),nx=s.getAttribute('data-next'),p=document.getElementById('rq-price'),y=document.getElementById('rq-yours'),pct=${Number(pct) || 85};
if(p&&y)p.addEventListener('input',function(){var c=Math.round(Number(p.value)*100);y.textContent=c>0?'$'+(Math.round(c*pct/100)/100).toLocaleString('en-US',{minimumFractionDigits:2})+' is yours.':''});
document.addEventListener('keydown',function(e){if(e.metaKey||e.ctrlKey||e.altKey)return;var t=e.target,typing=t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA');if(typing&&e.key!=='Escape'&&!(t.id==='rq-price'&&e.key==='Enter'))return;
var k=e.key.toLowerCase();if(k==='escape'){location.href='/account/requests';return}if(k==='n'&&nx){location.href='/account/requests/'+nx;return}
var go=document.getElementById('rq-go');if(k==='a'&&go&&!go.disabled){e.preventDefault();go.click()}else if(k==='g'){var g=document.querySelector('.rq-free');if(g&&!g.disabled){e.preventDefault();g.click()}}else if(k==='d'){var w=document.getElementById('rq-word');if(w){e.preventDefault();w.focus()}}});})();</script></section>` });
}

module.exports = { mountRequests, requestsPage, requestPage };
