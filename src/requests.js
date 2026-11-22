// Requests: what a maker is asked, and how they answer. A request is a license whose status is 'requested':
// a use the maker approves by hand, a use with no price, a use the held file is too small for (the master is
// needed), or any order while Stripe is off. The maker answers from their own studio (/account/requests):
// accept at a fee (a payment link goes to the buyer; the file and certificate follow payment), grant without
// payment, or decline with a word. The Studio keeps its own door (/studio/licenses) on the same answers.
// Every answer is written to the buyer and recorded on the register.
const fs = require('fs');
const { layout, esc, money, date, termText, setDeskPath } = require('./views');

const K = require('./contract');
const R = require('./rules');
const H = require('./holds');
// (#184) A deal made elsewhere: the maker writes the license (status 'offered'), the other side accepts it by a link that
// carries its own key (download_token until the grant replaces it). The answers are read as the license page reads them.
const askedOf = b => ({ territory: String((b && b.where) || '').slice(0, 4) || null, limit: b && b.of ? { n: String(b.many || '').slice(0, 16), of: String(b.of).slice(0, 16) } : null });
const writtenOf = l => { try { return !!(l && l.rights && JSON.parse(l.rights).written); } catch (e) { return false; } };

function mountRequests(app, { db, C, q, mail, ledger, V, stripe, checkoutUrl, grant, isStudio, makerOf, upload, images, replaceMaster, meets, MIN_MP, nextRef, listed, mk }) {
  const full = ref => db.prepare(`SELECT l.*, w.title, w.slug, w.width, w.height, w.maker_id, u.name AS use_name, u.kind, u.key AS use_key, u.term_months, u.price_cents AS use_price
    FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE l.ref=?`).get(String(ref || ''));
  const listFor = makerId => db.prepare(`SELECT l.*, w.title, w.slug, w.width, w.height, u.name AS use_name, u.key AS use_key
    FROM licenses l JOIN works w ON w.id=l.work_id JOIN uses u ON u.id=l.use_id WHERE w.maker_id=? AND l.status IN ('requested','awaiting_payment','offered','declined','active','expired')
    ORDER BY CASE l.status WHEN 'requested' THEN 0 WHEN 'awaiting_payment' THEN 1 WHEN 'offered' THEN 1 ELSE 2 END, l.id DESC LIMIT 200`).all(makerId);
  const waiting = makerId => db.prepare("SELECT COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status='requested'").get(makerId).n;
  const open = l => l.status === 'requested' || l.status === 'awaiting_payment';
  const needsMaster = l => !meets({ width: l.width, height: l.height }, l.use_key);
  // The queue: what is waiting for this maker, oldest first, and where this one stands in it.
  const queue = makerId => db.prepare("SELECT l.ref FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status='requested' ORDER BY l.id").all(makerId).map(r => r.ref);
  const place = l => { const qu = queue(l.maker_id), i = qu.indexOf(l.ref); return { n: qu.length, at: i < 0 ? 0 : i + 1, next: qu.find((r, j) => r !== l.ref && (i < 0 || j > i)) || qu.find(r => r !== l.ref) || null }; };
  // What to suggest: what this maker last took for the use, else their price for it.
  const suggest = l => { const last = db.prepare("SELECT l.price_cents FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.use_id=l.use_id AND l.use_id=? AND l.status IN ('active','expired','awaiting_payment') AND l.price_cents>0 AND l.ref!=? ORDER BY l.id DESC LIMIT 1").get(l.maker_id, l.use_id, l.ref); return last ? { cents: last.price_cents, from: 'what you last took for this use' } : l.use_price ? { cents: l.use_price, from: 'your price for this use' } : null; };
  const FEE = require('./fee'); const earnedThisMonth = makerId => { const m = db.prepare('SELECT share_pct FROM makers WHERE id=?').get(makerId), r = db.prepare(`SELECT COALESCE(SUM(${FEE.sqlMaker((m && m.share_pct) || 85)}),0) s, COUNT(*) n FROM licenses l JOIN works w ON w.id=l.work_id WHERE w.maker_id=? AND l.status IN ('active','expired') AND l.price_cents>0 AND l.starts_at>=date('now','start of month')`).get(makerId); return { cents: r.s, n: r.n }; };

  // The answers, shared by the maker's desk and the Studio's.
  async function accept(ref, cents, by) {
    const l = full(ref); if (!l || !open(l)) return { ok: false, why: 'This request is no longer open.' };
    if (!(cents > 0)) return { ok: false, why: 'Set a fee.' };
    { const wt = app.locals.sitters ? app.locals.sitters.waiting(l.ref) : null; if (wt) return { ok: false, why: wt.no ? `${wt.who} has not agreed to this use.` : `Waiting on ${wt.who}: the person in the photograph says yes or no first.` }; }
    db.prepare("UPDATE licenses SET price_cents=?, status='awaiting_payment', updated_at=datetime('now') WHERE ref=?").run(cents, l.ref);
    ledger.append(db, 'license.quoted', l.ref, { currency: l.currency, by });
    if (!stripe) return { ok: true, url: null, note: 'Fee saved. Connect Stripe to send a payment link.' };
    const url = await checkoutUrl(l.ref);
    mail.send({ to: l.licensee_email, ...mail.templates.payToLicensee({ ref: l.ref, title: l.title, name: l.licensee_name, fee: V.money(cents), url }) });
    return { ok: true, url, note: mail.on() ? 'Accepted. The payment link is on its way to the buyer.' : 'Accepted. Send the buyer this payment link.' };
  }
  function give(ref, by, { credit = false } = {}) {
    const l = full(ref); if (!l || !open(l)) return { ok: false, why: 'This request is no longer open.' };
    { const wt = app.locals.sitters ? app.locals.sitters.waiting(l.ref) : null; if (wt) return { ok: false, why: wt.no ? `${wt.who} has not agreed to this use.` : `Waiting on ${wt.who}: the person in the photograph says yes or no first.` }; }
    // (#184) Granted for credit: a real license at no fee. Its terms are the request's own (or the use's), with the
    // credit-only Section 3, fingerprinted as any order's; the fee is nothing, so nothing counts as earned.
    if (credit) {
      const w = db.prepare('SELECT id, title, rules, maker_id FROM works WHERE id=?').get(l.work_id), m = db.prepare('SELECT name FROM makers WHERE id=?').get(l.maker_id), rules = R.parse(w.rules);
      let t0 = null; try { t0 = l.rights ? JSON.parse(l.rights) : null; } catch (e) { t0 = null; }
      const base = t0 ? (({ version, hash, ...x }) => x)(t0) : K.terms({ use: { key: l.use_key, kind: l.kind, term_months: l.term_months }, never: rules.never, base: 0, transfer: rules.transfer || null });
      const t = K.seal({ ...base, price: 0, ask: false, credit: true }, { work: w.title, maker: m.name, ref: l.ref });
      db.prepare("UPDATE licenses SET rights=?, price_cents=0, house_cents=0, updated_at=datetime('now') WHERE ref=?").run(JSON.stringify(t), l.ref);
    }
    grant(l.ref, { paid: false });
    ledger.append(db, 'license.granted.free', l.ref, { by, ...(credit ? { credit: true } : {}) });
    return { ok: true, note: credit ? 'Granted for credit. The agreement, the file and the certificate have gone to them.' : 'Granted. The file and certificate have gone to the buyer.' };
  }
  function decline(ref, word, by) {
    const l = full(ref); if (!l || !(open(l) || l.status === 'offered')) return { ok: false, why: 'This request is no longer open.' };
    const ch = db.prepare("UPDATE licenses SET status='declined', conditions=COALESCE(?, conditions), updated_at=datetime('now') WHERE ref=? AND status=?").run(word ? `Declined: ${word}` : null, l.ref, l.status);
    if (!ch.changes) return { ok: false, why: 'This request is no longer open.' };
    ledger.append(db, 'license.declined', l.ref, { by });
    if (l.status === 'offered') return { ok: true, note: 'Withdrawn. The link no longer opens it.' }; // the maker takes back what they wrote
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
    res.send(requestsPage({ m, list: listFor(m.id), needsMaster, first: queue(m.id)[0] || null, month: earnedThisMonth(m.id), ok: req.query.ok || null, base: C.base, write: writeForm(m, req.query.write ? String(req.query.write) : null, req.query.why ? String(req.query.why).slice(0, 200) : null) }));
  });
  app.get('/account/requests/:ref', (req, res) => {
    const l = full(req.params.ref); if (!l) return res.sendStatus(404);
    if (!may(req, l)) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    const mk = db.prepare('SELECT share_pct FROM makers WHERE id=?').get(l.maker_id);
    res.send(requestPage({ l, needs: needsMaster(l), min: MIN_MP[l.use_key] || 0, ok: req.query.ok || null, pay: req.query.pay || null, stripe: !!stripe, place: place(l), suggest: suggest(l), pct: (FEE.on() ? 100 : 0) || (mk && mk.share_pct) || 85, link: l.status === 'offered' && l.download_token ? `${C.base}/c/${l.ref}?k=${l.download_token}` : null }));
  });
  app.post('/account/requests/:ref/accept', async (req, res) => {
    const l = full(req.params.ref); if (!l) return res.sendStatus(404); if (!may(req, l)) return res.sendStatus(401);
    const x = req.body || {};
    if (x.free) { const r = give(l.ref, 'maker', { credit: true }); return res.redirect(r.ok ? onward(l, r.note) : back(req, l.ref, r.why)); }
    if (!(Number(x.price) > 0)) return res.redirect(back(req, l.ref, 'Name a fee, or grant it for credit only.'));
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

  // ---- (#184) A deal made elsewhere: the maker writes the license; the other side accepts by a link. ----
  // The form, on the requests desk: the maker's held works (the newest 200), their working uses, the same questions as
  // the license page, who it is for, and the fee (none is credit only). Nothing here costs the maker anything.
  function writeForm(m, slug, why) {
    const works = db.prepare("SELECT slug, title FROM works WHERE maker_id=? AND status='held' ORDER BY id DESC LIMIT 200").all(m.id);
    if (!works.length) return '';
    const uses = db.prepare("SELECT key, name, term_months FROM uses WHERE maker_id=? AND kind='license' AND key NOT IN ('social','reference','delivery') ORDER BY sort, id").all(m.id);
    if (!uses.length) return '';
    return writeHtml({ works, uses, slug, why, places: K.PLACES(), sizes: K.SIZES, notAdvice: K.FORM_NOT_ADVICE });
  }
  app.post('/account/requests/write', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/requests');
    const b = req.body || {}, t = (v, n) => String(v || '').trim().slice(0, n);
    const again = why => res.redirect(`/account/requests?write=${encodeURIComponent(t(b.work, 120))}&why=${encodeURIComponent(why)}#write`);
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND maker_id=? AND status='held'").get(t(b.work, 120), m.id);
    if (!w) return again('Choose one of your photographs on view.');
    const u = db.prepare("SELECT * FROM uses WHERE maker_id=? AND key=? AND kind='license'").get(m.id, t(b.use, 30));
    const rules = R.parse(w.rules);
    // The maker may write any of their own working uses; what the house closes for everyone (a dispute, a release not
    // yet in, an exclusive license already held, the person in the photograph saying no) stays closed here too.
    if (!u || ['social', 'reference', 'delivery'].includes(u.key) || !listed({ ...rules, uses: null }, u.key, w)) return again('That use cannot be licensed for this photograph just now.');
    const name = t(b.name, 120), email = t(b.email, 160).toLowerCase();
    if (!name) return again('Say who the license is for.');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return again('That address does not look whole. Leave it empty and send them the link yourself.');
    const fee = String(b.fee || '').replace(/[$,\s]/g, '');
    const cents = fee === '' ? 0 : Math.round(Number(fee) * 100);
    if (!(cents >= 0) || !Number.isFinite(cents)) return again('A fee in dollars, or leave it empty for credit only.');
    if (cents > 0 && cents < 100) return again('A fee of at least $1, or leave it empty for credit only.');
    const ref = nextRef(), token = require('crypto').randomBytes(24).toString('base64url');
    const base = K.terms({ use: u, never: rules.never, base: cents, transfer: rules.transfer || null, ...askedOf(b) });
    // The maker names the fee for the use as they agreed it, narrowed or not: it is the price, never asked again.
    const terms = K.seal({ ...base, price: cents, ask: false, written: true, ...(cents ? {} : { credit: true }) }, { work: w.title, maker: m.name, ref });
    // house_cents 0: the house takes no share of a license the maker arranged alone (Will has not decided otherwise).
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,licensee_company,intended_use,price_cents,status,conditions,rights,house_cents,download_token) VALUES (?,?,?,?,?,?,?,?,'offered',?,?,0,?)")
      .run(ref, w.id, u.id, name, email, t(b.company, 160) || null, t(b.intended, 2000) || null, cents, R.conditions(rules) || null, JSON.stringify(terms), token);
    ledger.append(db, 'license.written', ref, { work: w.slug, use: u.key, ...(cents ? {} : { credit: true }) });
    const link = `${C.base}/c/${ref}?k=${token}`;
    if (email) mail.send({ to: email, subject: `${m.name} has written you a license`, text: `${m.name} has written a license for ${V.tidy(w.title)} (${u.name}), for ${name}${t(b.company, 160) ? `, ${t(b.company, 160)}` : ''}.\n\n${cents ? `The fee is ${V.money(cents)}, paid through Watermark when you accept.` : `There is no fee: ${m.name} asks to be credited wherever the use allows.`}\n\nRead it and accept it here:\n${link}\n\n${K.FORM_NOT_ADVICE}\n\nWatermark` });
    res.redirect(`/account/requests/${encodeURIComponent(ref)}?ok=${encodeURIComponent(email && mail.on() ? 'Written. The link has gone to them; it is below too.' : 'Written. Send them the link below.')}`);
  });

  // The other side's page: the license as written, who it is for, and Accept (or Accept and pay). No account.
  const keyOk = (l, k) => !!(l && l.download_token && k && String(k) === l.download_token);
  const waitingOther = l => l && (l.status === 'offered' || (l.status === 'awaiting_payment' && writtenOf(l)));
  function offer(req, res, l, err = null, v = null) {
    if (!keyOk(l, req.query.k || (req.body && req.body.k))) return res.sendStatus(404);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id), maker = mk(w), u = q.useById.get(l.use_id);
    let t = null; try { t = JSON.parse(l.rights); } catch (e) { t = null; }
    res.set('Cache-Control', 'private, no-store'); res.set('X-Robots-Tag', 'noindex');
    res.send(offerPage({ l, w, maker, u, t, err, v: v || {}, holds: H.block({ use: u, t, maker: maker.name, edition: !!w.edition_size, will: true }), notAdvice: K.FORM_NOT_ADVICE }));
  }
  app.post('/c/:ref/accept', async (req, res) => {
    const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(String(req.params.ref));
    if (!waitingOther(l) || !keyOk(l, (req.body || {}).k)) return res.sendStatus(404);
    const b = req.body || {}, t = (v, n) => String(v || '').trim().slice(0, n);
    const name = t(b.name, 120), email = t(b.email, 160).toLowerCase(), company = t(b.company, 160);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || b.agree !== '1') return offer(req, res, l, 'Your name, an address the papers can go to, and the tick that you accept, please.', { name, email, company });
    if (l.price_cents > 0 && !stripe) return offer(req, res, l, 'Payment cannot be taken here just now. Nothing was taken; please try again later.', { name, email, company });
    const ch = db.prepare("UPDATE licenses SET licensee_name=?, licensee_email=?, licensee_company=?, updated_at=datetime('now') WHERE ref=? AND status IN ('offered','awaiting_payment')").run(name, email, company || null, l.ref);
    if (!ch.changes) return res.sendStatus(409);
    const w = db.prepare('SELECT id, slug, title, maker_id FROM works WHERE id=?').get(l.work_id), maker = mk(w);
    if (l.price_cents > 0) return res.redirect(303, await checkoutUrl(l.ref)); // the fee the maker named, exactly (house_cents 0)
    // No fee: accepted is granted. Only the press that moves it on goes on (grant's own claim).
    const g = grant(l.ref, { paid: false });
    if (maker.email) mail.send({ to: maker.email, subject: `Accepted: ${V.tidy(w.title)}`, text: `${name}${company ? `, ${company}` : ''} accepted the license you wrote for ${V.tidy(w.title)}, for credit alone. It is recorded.\n\n${C.base}/account/requests/${l.ref}\n\nWatermark` });
    res.redirect(303, `/c/${l.ref}?k=${g.download_token || ''}`);
  });
  app.post('/c/:ref/decline', (req, res) => {
    const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(String(req.params.ref));
    if (!waitingOther(l) || !keyOk(l, (req.body || {}).k)) return res.sendStatus(404);
    const word = String((req.body || {}).word || '').trim().slice(0, 600);
    db.prepare("UPDATE licenses SET status='declined', conditions=?, updated_at=datetime('now') WHERE ref=? AND status IN ('offered','awaiting_payment')").run(word ? `Declined by them: ${word}` : 'Declined by them', l.ref);
    ledger.append(db, 'license.declined', l.ref, { by: 'licensee' });
    const w = db.prepare('SELECT id, slug, title, maker_id FROM works WHERE id=?').get(l.work_id), maker = mk(w);
    if (maker.email) mail.send({ to: maker.email, subject: `Declined: ${V.tidy(w.title)}`, text: `${l.licensee_name} declined the license you wrote for ${V.tidy(w.title)}.${word ? `\n\nTheir word: ${word}` : ''}\n\n${C.base}/account/requests/${l.ref}\n\nWatermark` });
    res.set('Cache-Control', 'private, no-store');
    res.send(layout({ title: 'Declined · Watermark', body: `<section class="narrow"><p class="k">A license</p><h1>Declined.</h1><p class="lede">${esc(maker.name)} has been told. Nothing was taken and nothing is recorded against you.</p><p><a class="buy-btn" href="/w/${esc(w.slug)}">The photograph</a></p></section>` }));
  });

  app.locals.requests = { accept, give, decline, waiting, full, needsMaster, queue, offer, waitingOther };
  return app.locals.requests;
}

// ---- The desk ----
const short = d => { try { return new Date(d.replace(' ', 'T') + (/[Z+]/.test(d) ? '' : 'Z')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
const STATUS = { requested: 'Waiting for you', awaiting_payment: 'Accepted · awaiting payment', offered: 'Written · waiting for them', active: 'Licensed', declined: 'Declined', expired: 'Ended' };
function requestsPage({ m, list, needsMaster, first, month, ok, base = '', write = '' }) {
  setDeskPath('/account/requests');
  const open = list.filter(l => l.status === 'requested'), rest = list.filter(l => l.status !== 'requested');
  const row = l => `<a class="rq" href="/account/requests/${esc(l.ref)}"><img src="/img/${esc(l.slug)}/thumb" alt="" loading="lazy"><span class="rq-t"><b>${esc(l.title)}</b><small>${esc(l.use_name)} · ${esc(l.licensee_name)}${l.licensee_company ? `, ${esc(l.licensee_company)}` : ''}</small></span><span class="rq-m">${l.price_cents ? money(l.price_cents) : 'No fee set'}${l.status === 'requested' && needsMaster(l) ? '<i>Needs the master</i>' : ''}</span><span class="rq-s s-${esc(l.status)}">${esc(STATUS[l.status] || l.status)}</span><span class="rq-d">${short(l.created_at)}</span></a>`;
  return layout({ title: 'Requests · Watermark', studio: true, body: `<section class="studio-wrap hd rq-pg"><p class="k">Your studio</p><h1>Requests.</h1>
${ok ? `<p class="ok rq-ok">${esc(ok)}</p>` : ''}
<div class="rq-top"><div class="rq-sum"><p class="lede">What people have asked of your work. Accept at a fee and a payment link goes out; the file and certificate follow payment. Or decline, with a word.</p>
<dl class="rq-nums"><div><dt>Waiting</dt><dd>${open.length}</dd></div><div><dt>Earned this month</dt><dd>${money(month.cents)}<small>${month.n} paid</small></dd></div></dl></div>
${first ? `<a class="jewel rq-go" href="/account/requests/${esc(first)}">Clear the desk<small>${open.length} waiting · one after another</small></a>` : `<div class="rq-clear"><p class="k">All clear</p><p>Nothing waits for you. New requests arrive here and by mail.</p></div>`}</div>
${open.length ? `<h2>Waiting for you</h2><div class="rq-list">${open.map(row).join('')}</div>` : ''}
${rest.length ? `<h2>Licensed, and answered</h2><div class="rq-list rq-done">${rest.map(row).join('')}</div>` : ''}
${m.kind === 'maker' || m.kind === 'institution' || !m.kind ? `<h2 id="reply">Your reply link</h2>
<p>When someone asks in a comment or a message to use your photograph, answer with this address. They choose the photograph and say what it is for. A use you have priced is paid at once; a use priced at nothing is licensed for credit; anything else comes here as one request. You both receive the agreement, and it is recorded.</p>
<p><input class="lc2-link" readonly value="${esc(base)}/rights/${esc(m.handle)}" onclick="this.select()" aria-label="Your reply link"></p>
<p class="note">For one photograph, its own link is on its page in your studio. <a href="/account/prices">Your prices</a>: leave one empty to answer each request yourself, or set it at 0 for credit only.</p>` : ''}
${write}</section>` });
}
function requestPage({ l, needs, min, ok, pay, stripe, place, suggest, pct, link = null }) {
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
<button class="link rq-free" name="free" value="1" ${needs ? 'disabled' : ''}>Grant for credit only<kbd>G</kbd></button></form>
<form method="post" action="/account/requests/${esc(l.ref)}/decline" class="form rq-decline"><label>A word to the buyer <small>optional</small><input name="word" id="rq-word" placeholder="Not for this use; try the one beside it." maxlength="600"></label><button class="link">Decline<kbd>D</kbd></button></form>
</div>
<p class="rq-keys">Keys: <b>A</b> accept at the fee · <b>G</b> grant for credit · <b>D</b> decline · <b>N</b> next · <b>Esc</b> the desk. After an answer the next one waiting comes up.</p>` : l.status === 'offered' ? `<div class="rq-need"><p class="k">Written by you</p><p>${l.price_cents > 0 ? `When they accept, they pay ${money(l.price_cents)} here; all of it is yours.` : 'There is no fee: credit only.'} Send them this link. They read the agreement, say who they are, and accept${l.price_cents > 0 ? ' and pay' : ''}; you are told, and the license is recorded.</p>
${link ? `<p><input class="lc2-link" readonly value="${esc(link)}" onclick="this.select()" aria-label="The link to send"></p>` : ''}
<form method="post" action="/account/requests/${esc(l.ref)}/decline" class="form rq-decline"><button class="link">Withdraw it</button></form></div>` : `<p class="note">${l.status === 'active' ? `Licensed. <a href="/c/${esc(l.ref)}">The license page.</a>` : l.status === 'declined' ? 'You declined this request.' : 'This request is closed.'}</p>`}
</div></div>
<script>(function(){var s=document.querySelector('.rq-one'),nx=s.getAttribute('data-next'),p=document.getElementById('rq-price'),y=document.getElementById('rq-yours'),pct=${Number(pct) || 85};
if(p&&y)p.addEventListener('input',function(){var c=Math.round(Number(p.value)*100);y.textContent=c>0?'$'+(Math.round(c*pct/100)/100).toLocaleString('en-US',{minimumFractionDigits:2})+' is yours.':''});
document.addEventListener('keydown',function(e){if(e.metaKey||e.ctrlKey||e.altKey)return;var t=e.target,typing=t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA');if(typing&&e.key!=='Escape'&&!(t.id==='rq-price'&&e.key==='Enter'))return;
var k=e.key.toLowerCase();if(k==='escape'){location.href='/account/requests';return}if(k==='n'&&nx){location.href='/account/requests/'+nx;return}
var go=document.getElementById('rq-go');if(k==='a'&&go&&!go.disabled){e.preventDefault();go.click()}else if(k==='g'){var g=document.querySelector('.rq-free');if(g&&!g.disabled){e.preventDefault();g.click()}}else if(k==='d'){var w=document.getElementById('rq-word');if(w){e.preventDefault();w.focus()}}});})();</script></section>` });
}

// (#184) The form for a deal made elsewhere, on the requests desk. Words are drafts for Will.
function writeHtml({ works, uses, slug, why, places, sizes, notAdvice }) {
  return `<h2 id="write">Write a license for a deal made elsewhere</h2>
<p>Agreed in a message, an email or in person? Write the license here, from the same questions a brand answers, and send them the link. They accept it; the agreement goes to you both and the license is recorded. It costs you nothing. If you name a fee, they pay it here when they accept, and all of it is yours: the house takes no share.</p>
${why ? `<p class="err">${esc(why)}</p>` : ''}
<form method="post" action="/account/requests/write" class="rd-f">
<label class="rd-wide"><span>The photograph</span><select name="work" required>${works.map(w => `<option value="${esc(w.slug)}"${w.slug === slug ? ' selected' : ''}>${esc(w.title)}</option>`).join('')}</select></label>
<label><span>What is it for?</span><select name="use">${uses.map(u => `<option value="${esc(u.key)}">${esc(u.name)}${u.term_months ? ` · ${u.term_months % 12 ? u.term_months + ' months' : u.term_months / 12 + (u.term_months === 12 ? ' year' : ' years')}` : ''}</option>`).join('')}</select></label>
<label><span>Where will it appear?</span><select name="where"><option value="">Anywhere in the world</option>${places.map(p => `<option value="${esc(p.code)}">${esc(p.region ? p.name : 'Only in ' + p.name)}</option>`).join('')}</select></label>
<label><span>How many?</span><select name="of"><option value="">No set number</option>${sizes.map(z => `<option value="${esc(z.key)}">${esc(z.q[0].toUpperCase() + z.q.slice(1))}, no more than</option>`).join('')}</select></label>
<label><span>The number</span><input name="many" inputmode="numeric" pattern="[0-9,]*" maxlength="13" placeholder="5,000"></label>
<label><span>Who it is for</span><input name="name" required maxlength="120" placeholder="A person"></label>
<label><span>Their company <small>optional</small></span><input name="company" maxlength="160"></label>
<label><span>Their email <small>optional</small></span><input name="email" type="email" maxlength="160" placeholder="The house sends them the link"></label>
<label><span>The fee, USD</span><input name="fee" inputmode="decimal" maxlength="10" placeholder="Empty for credit only"></label>
<label class="rd-wide"><span>What you agreed <small>optional, kept between you</small></span><textarea name="intended" rows="3" maxlength="2000" placeholder="Where it will run, and when"></textarea></label>
<button class="buy-btn">Write the license</button></form>
<p class="note">${esc(notAdvice)}</p>`;
}
// (#184) The other side's page for a license the maker wrote: what they will hold, the agreement, Accept. Drafts for Will.
function offerPage({ l, w, maker, u, t, err, v, holds, notAdvice }) {
  const first = String(maker.name).split(' ')[0], fee = l.price_cents > 0;
  return layout({ title: `A license from ${maker.name} · Watermark`, body: `<section class="buy buy-ask">
<figure class="buy-fig"><div class="buy-plate"><img src="/img/${esc(w.slug)}/screen" alt="${esc(w.title)}" draggable="false"></div>
<figcaption><b>${esc(w.title)}</b><br>by ${esc(maker.name)}</figcaption></figure>
<div class="buy-form form"><form method="post" action="/c/${esc(l.ref)}/accept">
<p class="k">${esc(u.name)} &middot; ${fee ? money(l.price_cents, l.currency) : 'Credit only'}</p><h1>${esc(maker.name)} has written you a license.</h1>
${err ? `<p class="err">${esc(err)}</p>` : ''}
<p class="lede">${fee ? `The fee is ${money(l.price_cents, l.currency)}, paid here when you accept; all of it goes to ${esc(first)}.` : `There is no fee. ${esc(first)} asks to be credited wherever the use allows.`} Read it, say who it is for, and accept. The agreement, the file and the certificate come to you, and the license is recorded on the register.</p>
${holds}
<p><a href="/c/${esc(l.ref)}/contract?k=${esc(l.download_token)}" target="_blank">Read the agreement</a></p>
<input type="hidden" name="k" value="${esc(l.download_token)}">
<label>Your name<input name="name" required autocomplete="name" value="${esc(v.name || l.licensee_name || '')}"></label>
<label>Company <small>optional</small><input name="company" autocomplete="organization" value="${esc(v.company || l.licensee_company || '')}"></label>
<label>Email<input name="email" type="email" required autocomplete="email" value="${esc(v.email || l.licensee_email || '')}"></label>
<label class="chk"><input type="checkbox" name="agree" value="1" required> I accept the license agreement${fee ? '' : `, and with it the credit to ${esc(maker.name)}`}.</label>
<button type="submit" class="buy-btn">${fee ? `Accept and pay ${money(l.price_cents, l.currency)}` : 'Accept'}</button>
<p class="buy-how">${esc(notAdvice)}</p></form>
<form method="post" action="/c/${esc(l.ref)}/decline" class="form"><input type="hidden" name="k" value="${esc(l.download_token)}"><label>A word to ${esc(first)} <small>optional</small><input name="word" maxlength="600"></label><button class="link">Decline</button></form></div>
</section>` });
}

module.exports = { mountRequests, requestsPage, requestPage };
