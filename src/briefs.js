// The brief (29 Oct, Will: "we need to make it so brands can easily work with creators and artists; the brand
// partnership has never been easier; the contracts, the whole brand partnership thing, we've solved"; "delivery of
// reels, etc."). A brand says once what it needs; artists answer; the house carries the rest: the agreement, the
// money held, the delivery (photographs from the vault, and reels, films and files sent straight), the approval, the
// licence, and the artist paid on Friday. The brand needs no account: its brief has a desk at /b/<token>, by letter.
//   1. The brief  /brands (the door) → POST /brands/brief: company, who, email, what, what is delivered (photographs,
//      a reel, other), how many, the uses (the house's own: For a company, Before an audience; Exclusively), where
//      (the United States | worldwide), for how long (a year, two, perpetual), the budget, the date, and to whom: an
//      open call, or one artist (?to=<handle>, from the maker page's 'Commission').
//   2. Answers   /account/briefs: open calls and the briefs sent to you; an answer is a fee, a line and up to six of
//      your own works as references. The brand is mailed.
//   3. The award /b/<token>: the answers side by side; Choose → the agreement, assembled from the brief (`agreement`,
//      fingerprinted, a draft for counsel) → Checkout for the fee plus the house's share on top (FEE.total) →
//      funded (metadata.brief; `app.locals.briefEvent`; the return settles too). The house holds it.
//   4. Delivery  the artist's commission page: works from the vault, ticked, and files sent straight (photographs,
//      reels and films: MP4, MOV, WebM; the bag check reads every one); a company's or a campaign's use needs the
//      releases of anyone recognisable, so a vault work the clearance desk holds back cannot be delivered until its
//      release is in (sign one on the spot). Deliver → the brand is mailed.
//   5. Approval  the brand looks (each file served from its desk, never public) and approves, or asks for a change
//      with a word; BRIEF_APPROVE_DAYS (14) after delivery with no answer, it is approved by itself. On approval: the
//      licence is the agreement (uses, where, how long, exclusively or not, from the day of approval), recorded with
//      every file's fingerprint; the artist's fee is owed and clears for Friday pay (`earned`, `clearing`); the files
//      go to the brand through their desk.
//   A brand that ends it after the award and before delivery pays BRIEF_KILL_PCT (50) to the artist; the rest is
//   refunded by hand. Nothing of a brief is told on the register but that a commission was made and approved, with
//   no brand named. Every word a draft for Will and counsel.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USES = [['commercial', 'For a company', 'its website, its decks, its letters, its own channels'], ['campaign', 'Before an audience', 'advertising, a campaign, a film, a package, a billboard']];
const KINDS = [['photographs', 'Photographs'], ['reel', 'A reel or a film'], ['other', 'Something else (say in the brief)']];
const TERMS = [['12', 'A year'], ['24', 'Two years'], ['0', 'For good']];
const WHERE = [['us', 'The United States'], ['world', 'Worldwide']];

function mountBriefs(app, { db, V, C, ledger, stripe, mail, makerOf, studioOnly, originalPath, store }) {
  const { esc, money } = V; const FEE = require('./fee');
  db.exec(`CREATE TABLE IF NOT EXISTS briefs (id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, token TEXT UNIQUE NOT NULL, company TEXT NOT NULL, contact TEXT, email TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT, kinds TEXT, n INTEGER, uses TEXT, territory TEXT, term INTEGER, exclusive INTEGER NOT NULL DEFAULT 0, budget_cents INTEGER, due TEXT,
      to_maker INTEGER, status TEXT NOT NULL DEFAULT 'open', proposal_id INTEGER, fee_cents INTEGER, house_cents INTEGER, paid INTEGER NOT NULL DEFAULT 0, stripe_session TEXT,
      agreement_hash TEXT, delivered_at TEXT, approved_at TEXT, change_note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), funded_at TEXT, ended_at TEXT);
    CREATE TABLE IF NOT EXISTS brief_answers (id INTEGER PRIMARY KEY, brief_id INTEGER NOT NULL, maker_id INTEGER NOT NULL, fee_cents INTEGER NOT NULL, line TEXT, refs TEXT,
      status TEXT NOT NULL DEFAULT 'sent', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS brief_files (id INTEGER PRIMARY KEY, brief_id INTEGER NOT NULL, work_id INTEGER, file TEXT, name TEXT, mime TEXT, bytes INTEGER, sha256 TEXT,
      kind TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const DIR = path.join(C.dataDir, 'briefs'); try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) { console.error('[briefs]', e.message); }
  const MAX_MB = Number(process.env.BRIEF_MAX_MB || 4096);
  const APPROVE_DAYS = Number(process.env.BRIEF_APPROVE_DAYS || 14);
  const KILL = Number(process.env.BRIEF_KILL_PCT || 50);
  const upload = require('multer')({ dest: path.join(C.dataDir, 'incoming'), limits: { fileSize: MAX_MB * 1024 * 1024, files: 20 } });
  const base = C.base;
  const byToken = t => db.prepare('SELECT * FROM briefs WHERE token=?').get(String(t || ''));
  const byRef = r => db.prepare('SELECT * FROM briefs WHERE ref=?').get(String(r || ''));
  const maker = id => db.prepare('SELECT * FROM makers WHERE id=?').get(id);
  const first = n => String(n || '').split(/\s+/)[0];
  const lbl = (list, k) => (list.find(x => x[0] === String(k)) || [k, k])[1];
  const usesOf = b => String(b.uses || '').split(',').filter(Boolean);
  const said = b => `${usesOf(b).map(k => lbl(USES, k)).join(' and ') || 'For a company'}, ${b.territory === 'world' ? 'worldwide' : 'in the United States'}, ${+b.term ? `for ${+b.term === 12 ? 'a year' : +b.term / 12 + ' years'}` : 'for good'}${b.exclusive ? ', exclusively' : ', not exclusively'}`;
  const page = (title, inner, cls = 'brf') => V.layout({ title: `${title} · Watermark`, path: '/brands', body: `<section class="narrow ${cls}">${inner}</section>` });
  const nextRef = () => { const y = new Date().getFullYear(); const n = db.prepare("SELECT COUNT(*) n FROM briefs WHERE ref LIKE ?").get(`BR-${y}-%`).n + 1; return `BR-${y}-${String(n).padStart(4, '0')}`; };
  const sha = f => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
  const send = (to, subject, text) => { if (to) mail.send({ to, subject, text: text + '\n\nWatermark' }).catch(() => {}); };
  const tell = (m, title, href) => { try { if (app.locals.notify) Promise.resolve(app.locals.notify.tell({ maker_id: m.id, kind: 'requested', title, href })).catch(() => {}); } catch (e) { /* a courtesy */ } };

  // ---------- the agreement ----------
  function agreement(b, a, m) {
    const fee = money(a.fee_cents); const tot = money(FEE.on() ? FEE.total(a.fee_cents) : a.fee_cents);
    return [`COMMISSION AND LICENCE · ${b.ref}`, '',
      `Between ${m.name} (the Artist), ${b.company} (the Brand), and Watermark, a Krafft company (the House), which holds the money and keeps the record.`, '',
      `1. The work. The Artist makes and delivers: ${b.title}. ${b.body || ''} (${b.n || 1} ${String(b.kinds || 'photographs').split(',').map(k => lbl(KINDS, k).toLowerCase()).join(', ')}${b.due ? `, by ${b.due}` : ''}).`,
      `2. The fee. ${fee} to the Artist${FEE.on() ? `, and the House's share on top: the Brand pays ${tot}` : ''}. The Brand pays when it chooses the Artist; the House holds it until approval.`,
      `3. Delivery and approval. The Artist delivers through the House. The Brand approves, or asks once for a change with a reason, within ${APPROVE_DAYS} days of delivery; after that the delivery is approved.`,
      `4. The licence. On approval the Brand may use what was delivered ${said(b)}, from the day of approval. Every other right stays with the Artist. The Artist keeps the copyright and may show the work as their own, in their portfolio and on Watermark${b.exclusive ? ', but grants no other company a licence to it while this licence runs' : ''}.`,
      `5. Credit. Where the Brand can, it credits the work "${m.name} / Watermark".`,
      `6. People and property. The Artist warrants that anyone recognisable in what is delivered has signed a release, and that prominent private property or marks are released or cleared.`,
      `7. Ending early. If the Brand ends the commission after choosing the Artist and before delivery, ${KILL}% of the fee is the Artist's; the rest is returned.`,
      `8. The money. The Artist is paid by the House on the first Friday after approval clears.`,
      `9. The record. The House keeps this agreement, its fingerprint, every file's fingerprint and the dates.`, '',
      'A draft for counsel. Not yet reviewed.'].join('\n');
  }
  const fp = t => crypto.createHash('sha256').update(t).digest('hex');

  // ---------- 1. the brief ----------
  const opts = (list, name, type, checked = []) => list.map(([k, l, d]) => `<label class="brf-o"><input type="${type}" name="${name}" value="${k}"${checked.includes(k) ? ' checked' : ''}><span><b>${esc(l)}</b>${d ? `<small>${esc(d)}</small>` : ''}</span></label>`).join('');
  app.get('/brands', (req, res) => {
    const to = req.query.to ? db.prepare("SELECT * FROM makers WHERE handle=?").get(String(req.query.to)) : null;
    res.send(page('Work with an artist', `<p class="k">For brands</p><h1>${to ? `Commission ${esc(to.name)}.` : 'Work with an artist.'}</h1>
<p class="lede">Say once what you need. ${to ? esc(first(to.name)) + ' answers' : 'Artists answer'} with a fee and work of theirs to judge by. Choose, pay once, and the house carries the rest: the agreement, the money held until you approve, the delivery of photographs and films, the licence in writing, and the artist paid.</p>
<ol class="brf-how"><li><b>The brief.</b> Two minutes, below.</li><li><b>Answers.</b> A fee, a line, and their work.</li><li><b>Choose and pay.</b> The agreement is written from your brief; the money is held.</li><li><b>Delivery.</b> Photographs, reels, films, straight to your desk.</li><li><b>Approve.</b> The licence starts; the artist is paid on Friday.</li></ol>
<form method="post" action="/brands/brief" class="brf-f">${to ? `<input type="hidden" name="to" value="${esc(to.handle)}">` : ''}
<label>Your company<input name="company" required maxlength="120"></label><label>Your name<input name="contact" maxlength="80"></label><label>Your email<input name="email" type="email" required maxlength="160"></label>
<label>What it is<input name="title" required maxlength="140" placeholder="Portraits of our founders for the spring launch"></label>
<label>The brief<textarea name="body" rows="6" maxlength="4000" placeholder="What you want made, the mood, where it will appear, anything the artist should know."></textarea></label>
<fieldset><legend>What is delivered</legend>${opts(KINDS, 'kinds', 'checkbox', ['photographs'])}<label class="brf-n">How many<input name="n" type="number" min="1" max="200" value="10"></label></fieldset>
<fieldset><legend>How you will use it</legend>${opts(USES, 'uses', 'checkbox', ['commercial'])}<label class="brf-o"><input type="checkbox" name="exclusive" value="1"><span><b>Exclusively</b><small>no other company may license what is made, while your licence runs</small></span></label></fieldset>
<fieldset><legend>Where, and for how long</legend><div class="brf-row">${opts(WHERE, 'territory', 'radio', ['us'])}</div><div class="brf-row">${opts(TERMS, 'term', 'radio', ['12'])}</div></fieldset>
<label>Your budget, in dollars<input name="budget" type="number" min="0" step="50" placeholder="2500"></label><label>Needed by<input name="due" type="date"></label>
<button class="buy-btn">Send the brief</button>
<p class="muted">Your brief goes ${to ? 'to ' + esc(to.name) : 'to the house’s artists'}; nothing is charged until you choose. You get a desk for it by letter: no account, no password.</p></form>`));
  });
  app.post('/brands/brief', (req, res) => {
    const x = req.body || {}; const t = (v, n) => String(v || '').replace(/<[^>]*>/g, '').trim().slice(0, n);
    const email = t(x.email, 160).toLowerCase(); if (!t(x.company, 120) || !t(x.title, 140) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect('/brands?ok=check');
    const list = v => (Array.isArray(v) ? v : [v]).filter(Boolean).map(String);
    const to = x.to ? db.prepare('SELECT * FROM makers WHERE handle=?').get(String(x.to)) : null;
    const token = crypto.randomBytes(18).toString('base64url'); const ref = nextRef();
    const uses = list(x.uses).filter(k => USES.some(u => u[0] === k)); const kinds = list(x.kinds).filter(k => KINDS.some(u => u[0] === k));
    db.prepare(`INSERT INTO briefs (ref, token, company, contact, email, title, body, kinds, n, uses, territory, term, exclusive, budget_cents, due, to_maker) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ref, token, t(x.company, 120), t(x.contact, 80), email, t(x.title, 140), t(x.body, 4000), (kinds.length ? kinds : ['photographs']).join(','), Math.max(1, Math.min(200, +x.n || 1)), (uses.length ? uses : ['commercial']).join(','),
        x.territory === 'world' ? 'world' : 'us', [0, 12, 24].includes(+x.term) ? +x.term : 12, x.exclusive === '1' ? 1 : 0, +x.budget > 0 ? Math.round(+x.budget * 100) : null, t(x.due, 10) || null, to ? to.id : null);
    send(email, `Your brief, ${ref}`, `Your brief "${t(x.title, 140)}" is with ${to ? to.name : 'the house’s artists'}. Answers come to your desk:\n\n${base}/b/${token}\n\nKeep this letter: the link is your desk.`);
    if (to) { send(to.email, `A brief for you: ${t(x.title, 140)}`, `${first(to.name)},\n\n${t(x.company, 120)} would like to commission you: ${t(x.title, 140)}.\n\nRead it and answer: ${base}/account/briefs/${ref}`); tell(to, `A brief from ${t(x.company, 120)}`, `/account/briefs/${ref}`); }
    res.redirect(`/b/${token}?ok=sent`);
  });

  // ---------- 3. the brand's desk ----------
  const tile = w => w ? `<img src="/img/${encodeURIComponent(w.slug)}/thumb" alt="" loading="lazy">` : '';
  const fileRow = (b, f) => `<li class="brf-file"><span>${f.kind === 'video' ? '▶' : f.kind === 'image' ? '◻' : '·'}</span><b>${esc(f.name || 'file')}</b><small>${f.bytes ? Math.round(f.bytes / 1e5) / 10 + ' MB' : ''} · ${esc(String(f.sha256 || '').slice(0, 12))}</small>${b.status === 'delivered' || b.status === 'done' ? `<a href="/b/${esc(b.token)}/f/${f.id}">${b.status === 'done' ? 'Take it' : 'Look'}</a>` : ''}</li>`;
  function desk(b, ok) {
    const answers = db.prepare("SELECT a.*, m.name, m.handle FROM brief_answers a JOIN makers m ON m.id=a.maker_id WHERE a.brief_id=? AND a.status<>'withdrawn' ORDER BY a.id").all(b.id);
    const files = db.prepare('SELECT * FROM brief_files WHERE brief_id=? ORDER BY id').all(b.id);
    const chosen = b.proposal_id ? answers.find(a => a.id === b.proposal_id) : null;
    const state = { open: 'Waiting for answers', chosen: 'Chosen: waiting for payment', commissioned: 'Commissioned: the artist is at work', delivered: 'Delivered: yours to approve', done: 'Approved: the licence runs', ended: 'Ended' }[b.status] || b.status;
    return page(b.title, `<p class="k">Your brief · ${esc(b.ref)}</p><h1>${esc(b.title)}</h1><p class="lede">${esc(b.company)} · ${esc(said(b))}</p><p class="brf-state">${esc(state)}</p>
${ok ? `<p class="ok">${esc({ sent: 'Your brief is sent. Keep this page’s address: it is your desk.', paid: 'Paid and held. The artist is told.', approved: 'Approved. The licence runs from today; your files are below.', change: 'Your note is with the artist.' }[ok] || ok)}</p>` : ''}
${b.status === 'open' || b.status === 'chosen' ? `<h2>Answers · ${answers.length}</h2>${answers.length ? `<ul class="brf-ans">${answers.map(a => { const refs = JSON.parse(a.refs || '[]').map(s => db.prepare('SELECT slug FROM works WHERE slug=?').get(s)).filter(Boolean); return `<li><div class="brf-refs">${refs.map(tile).join('')}</div><p><b><a href="/m/${esc(a.handle)}" target="_blank">${esc(a.name)}</a></b> · ${money(a.fee_cents)}${FEE.on() ? ` <small>(${money(FEE.total(a.fee_cents))} with the house’s share)</small>` : ''}</p><p>${esc(a.line || '')}</p><form method="post" action="/b/${esc(b.token)}/choose"><input type="hidden" name="answer" value="${a.id}"><button class="buy-btn">Choose ${esc(first(a.name))}</button></form></li>`; }).join('')}</ul>` : '<p class="muted">None yet. You will be written to as each arrives.</p>'}` : ''}
${chosen && b.status !== 'open' ? `<h2>The agreement</h2><pre class="brf-ag">${esc(agreement(b, chosen, { name: chosen.name }))}</pre>${b.agreement_hash ? `<p class="muted">Fingerprint ${esc(b.agreement_hash.slice(0, 16))}…</p>` : ''}` : ''}
${b.status === 'chosen' ? `<form method="post" action="/b/${esc(b.token)}/pay"><button class="buy-btn">Pay ${money(FEE.on() ? FEE.total(chosen.fee_cents) : chosen.fee_cents)} and begin</button> <span class="muted">Held by the house until you approve.</span></form>` : ''}
${files.length ? `<h2>Delivered · ${files.length}</h2><ul class="brf-files">${files.map(f => fileRow(b, f)).join('')}</ul>` : ''}
${b.status === 'delivered' ? `<form method="post" action="/b/${esc(b.token)}/approve" class="brf-ap"><button class="buy-btn">Approve: the licence starts today</button></form><form method="post" action="/b/${esc(b.token)}/change" class="brf-ap"><label>Or ask for a change<input name="note" maxlength="600" required></label><button class="btn ghost">Ask</button></form><p class="muted">Approved by itself ${APPROVE_DAYS} days after delivery.</p>` : ''}
${b.status === 'done' ? `<p>The licence: ${esc(said(b))}, from ${esc(String(b.approved_at).slice(0, 10))}. Credit: “${esc(chosen ? chosen.name : '')} / Watermark”.</p>` : ''}`);
  }
  app.get('/b/:token', (req, res) => { const b = byToken(req.params.token); if (!b) return res.sendStatus(404); res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', 'noindex'); res.send(desk(b, req.query.ok)); });
  app.post('/b/:token/choose', (req, res) => {
    const b = byToken(req.params.token); if (!b || !['open', 'chosen'].includes(b.status)) return res.redirect(`/b/${req.params.token}`);
    const a = db.prepare('SELECT * FROM brief_answers WHERE id=? AND brief_id=?').get(+req.body.answer, b.id); if (!a) return res.redirect(`/b/${b.token}`);
    const m = maker(a.maker_id);
    db.prepare("UPDATE briefs SET status='chosen', proposal_id=?, fee_cents=?, house_cents=?, agreement_hash=? WHERE id=?").run(a.id, a.fee_cents, FEE.on() ? FEE.total(a.fee_cents) - a.fee_cents : 0, fp(agreement(b, a, m)), b.id);
    res.redirect(`/b/${b.token}#pay`);
  });
  function funded(b, sessId) {
    if (!b || b.paid) return;
    db.prepare("UPDATE briefs SET paid=1, status='commissioned', funded_at=datetime('now'), stripe_session=COALESCE(stripe_session, ?) WHERE id=?").run(sessId || null, b.id);
    db.prepare("UPDATE brief_answers SET status=CASE WHEN id=? THEN 'accepted' ELSE 'declined' END WHERE brief_id=?").run(b.proposal_id, b.id);
    const a = db.prepare('SELECT * FROM brief_answers WHERE id=?').get(b.proposal_id); const m = a && maker(a.maker_id);
    if (m) { send(m.email, `Commissioned: ${b.title}`, `${first(m.name)},\n\n${b.company} chose you, and has paid. The fee, ${money(a.fee_cents)}, is held by the house until they approve.\n\nThe brief and the place to deliver:\n${base}/account/briefs/${b.ref}`); tell(m, `Commissioned by ${b.company}`, `/account/briefs/${b.ref}`); }
    ledger.append(db, 'commission.made', b.ref, { maker: m ? m.handle : null });
  }
  app.post('/b/:token/pay', async (req, res) => {
    const b = byToken(req.params.token); if (!b || b.status !== 'chosen') return res.redirect(`/b/${req.params.token}`);
    const total = FEE.on() ? FEE.total(b.fee_cents) : b.fee_cents;
    if (!stripe) { if (process.env.NODE_ENV === 'test') { funded(byToken(b.token), 'test'); return res.redirect(`/b/${b.token}?ok=paid`); } return res.redirect(`/b/${b.token}?ok=` + encodeURIComponent('Payment is not open yet; the house will write to you.')); }
    try {
      const s = await stripe.checkout.sessions.create({ mode: 'payment', customer_email: b.email, line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: total, product_data: { name: `Commission ${b.ref}: ${b.title}`.slice(0, 120) } } }], metadata: { brief: String(b.id) }, success_url: `${base}/b/${b.token}/paid?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/b/${b.token}` });
      db.prepare('UPDATE briefs SET stripe_session=? WHERE id=?').run(s.id, b.id); res.redirect(303, s.url);
    } catch (e) { console.error('[briefs] checkout', e.message); res.redirect(`/b/${b.token}?ok=` + encodeURIComponent('Stripe did not answer; try again.')); }
  });
  app.get('/b/:token/paid', async (req, res) => {
    const b = byToken(req.params.token); if (!b) return res.sendStatus(404);
    try { if (stripe && req.query.session_id) { const s = await stripe.checkout.sessions.retrieve(String(req.query.session_id)); if (s.payment_status === 'paid' && String(s.metadata.brief) === String(b.id)) funded(b, s.id); } } catch (e) { console.error('[briefs] settle', e.message); }
    res.redirect(`/b/${b.token}?ok=paid`);
  });
  app.locals.briefEvent = event => { const o = event.data.object; if (event.type === 'checkout.session.completed' && o.metadata && o.metadata.brief && o.payment_status === 'paid') funded(db.prepare('SELECT * FROM briefs WHERE id=?').get(+o.metadata.brief), o.id); };

  function approve(b, how) {
    if (!b || b.status !== 'delivered') return false;
    db.prepare("UPDATE briefs SET status='done', approved_at=datetime('now') WHERE id=?").run(b.id);
    const a = db.prepare('SELECT * FROM brief_answers WHERE id=?').get(b.proposal_id); const m = a && maker(a.maker_id);
    if (m) { send(m.email, `Approved: ${b.title}`, `${first(m.name)},\n\n${b.company} approved what you delivered. ${money(a.fee_cents)} is yours, paid on the first Friday after it clears.\n\n${base}/account/payouts`); tell(m, `Approved by ${b.company}`, `/account/briefs/${b.ref}`); }
    send(b.email, `Approved: ${b.title} (${b.ref})`, `The licence runs from today: ${said(b)}. Your files and the agreement stay at your desk:\n\n${base}/b/${b.token}`);
    ledger.append(db, 'commission.approved', b.ref, { maker: m ? m.handle : null, how, files: db.prepare('SELECT sha256 FROM brief_files WHERE brief_id=?').all(b.id).map(f => f.sha256) });
    return true;
  }
  app.post('/b/:token/approve', (req, res) => { const b = byToken(req.params.token); if (!b) return res.sendStatus(404); approve(b, 'brand'); res.redirect(`/b/${b.token}?ok=approved`); });
  app.post('/b/:token/change', (req, res) => {
    const b = byToken(req.params.token); if (!b || b.status !== 'delivered') return res.redirect(`/b/${req.params.token}`);
    const note = String(req.body.note || '').replace(/<[^>]*>/g, '').trim().slice(0, 600); if (!note) return res.redirect(`/b/${b.token}`);
    db.prepare("UPDATE briefs SET status='commissioned', change_note=?, delivered_at=NULL WHERE id=?").run(note, b.id);
    const a = db.prepare('SELECT * FROM brief_answers WHERE id=?').get(b.proposal_id); const m = a && maker(a.maker_id);
    if (m) { send(m.email, `A change asked: ${b.title}`, `${first(m.name)},\n\n${b.company} asks: "${note}"\n\n${base}/account/briefs/${b.ref}`); tell(m, `${b.company} asks for a change`, `/account/briefs/${b.ref}`); }
    res.redirect(`/b/${b.token}?ok=change`);
  });
  // A file, to the brand only, through their desk; never public, never cached.
  app.get('/b/:token/f/:id', async (req, res) => {
    const b = byToken(req.params.token); if (!b || !['delivered', 'done'].includes(b.status)) return res.sendStatus(404);
    const f = db.prepare('SELECT * FROM brief_files WHERE id=? AND brief_id=?').get(+req.params.id, b.id); if (!f) return res.sendStatus(404);
    res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', 'noindex');
    try {
      const p = f.work_id ? await originalPath(db.prepare('SELECT * FROM works WHERE id=?').get(f.work_id)) : path.join(DIR, f.file);
      if (b.status === 'done') res.attachment(f.name || path.basename(p)); else res.set('Content-Disposition', 'inline');
      res.type(f.mime || 'application/octet-stream').sendFile(p);
    } catch (e) { res.sendStatus(404); }
  });

  // ---------- 2 and 4. the artist's side ----------
  const openFor = m => db.prepare("SELECT * FROM briefs WHERE status='open' AND (to_maker IS NULL OR to_maker=?) ORDER BY id DESC LIMIT 60").all(m.id);
  const mine = m => db.prepare("SELECT b.*, a.fee_cents AS my_fee, a.status AS my_status FROM briefs b JOIN brief_answers a ON a.brief_id=b.id AND a.maker_id=? ORDER BY b.id DESC LIMIT 60").all(m.id);
  app.get('/account/briefs', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/briefs');
    res.set('Cache-Control', 'private, no-store');
    const open = openFor(m), my = mine(m);
    const row = b => `<li><a href="/account/briefs/${esc(b.ref)}"><b>${esc(b.title)}</b><span>${esc(b.company)} · ${esc(said(b))}${b.budget_cents ? ' · about ' + money(b.budget_cents) : ''}${b.due ? ' · by ' + esc(b.due) : ''}${b.to_maker ? ' · to you' : ''}</span></a></li>`;
    res.send(V.layout({ title: 'Briefs · Your studio', studio: true, body: `<section class="studio-wrap brf"><p class="k"><a href="/account">Your studio</a></p><h1>Briefs.</h1>
<p class="lede">Brands asking for work. Answer with a fee and your work; if you are chosen, the money is held before you begin, the agreement is written, and you deliver here: photographs from your vault, reels and films straight.</p>
<h2>Your commissions and answers</h2><ul class="brf-list">${my.map(b => `<li><a href="/account/briefs/${esc(b.ref)}"><b>${esc(b.title)}</b><span>${esc(b.company)} · ${esc({ sent: 'answered', accepted: { commissioned: 'commissioned: deliver', delivered: 'delivered: with the brand', done: 'approved' }[b.status] || 'chosen', declined: 'another was chosen' }[b.my_status] || b.my_status)} · ${money(b.my_fee)}</span></a></li>`).join('') || '<li class="muted">None yet.</li>'}</ul>
<h2>Open · ${open.length}</h2><ul class="brf-list">${open.map(row).join('') || '<li class="muted">No briefs open just now.</li>'}</ul></section>` }));
  });
  app.get('/account/briefs/:ref', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=' + encodeURIComponent(req.originalUrl));
    const b = byRef(req.params.ref); if (!b || (b.to_maker && b.to_maker !== m.id)) return res.sendStatus(404);
    res.set('Cache-Control', 'private, no-store');
    const a = db.prepare('SELECT * FROM brief_answers WHERE brief_id=? AND maker_id=?').get(b.id, m.id);
    const ours = a && b.proposal_id === a.id && b.paid;
    const works = db.prepare("SELECT slug, title, id FROM works WHERE maker_id=? AND status IN ('held','hidden') ORDER BY stars DESC, id DESC LIMIT 120").all(m.id);
    const CL = app.locals.clearance; const uses = usesOf(b);
    const held = w => CL ? uses.filter(k => CL.blocks(db.prepare('SELECT * FROM works WHERE id=?').get(w.id), k)) : [];
    const files = db.prepare('SELECT * FROM brief_files WHERE brief_id=? ORDER BY id').all(b.id);
    const pick = (name, max, note) => `<div class="brf-pick">${works.map(w => { const h = name === 'works' ? held(w) : []; return `<label class="brf-pw${h.length ? ' brf-held' : ''}" title="${esc(w.title)}${h.length ? ' · waits for a release' : ''}"><input type="checkbox" name="${name}" value="${esc(w.slug)}"${h.length ? ' disabled' : ''}>${tile(w)}${h.length ? '<small>Needs a release</small>' : ''}</label>`; }).join('')}</div>${note || ''}`;
    res.send(V.layout({ title: `${b.title} · Briefs`, studio: true, body: `<section class="studio-wrap brf"><p class="k"><a href="/account/briefs">Briefs</a> · ${esc(b.ref)}</p><h1>${esc(b.title)}</h1>
<p class="lede">${esc(b.company)} · ${esc(said(b))}${b.budget_cents ? ` · about ${money(b.budget_cents)}` : ''}${b.due ? ` · by ${esc(b.due)}` : ''}</p>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ''}
<div class="brf-body">${esc(b.body || '').replace(/\n/g, '<br>')}</div><p class="muted">${b.n || 1} · ${esc(String(b.kinds).split(',').map(k => lbl(KINDS, k)).join(', '))}</p>
${b.change_note && ours && b.status === 'commissioned' ? `<p class="err">They ask for a change: “${esc(b.change_note)}”</p>` : ''}
${!a && b.status === 'open' ? `<h2>Answer</h2><form method="post" action="/account/briefs/${esc(b.ref)}/answer" class="brf-f"><label>Your fee, in dollars<input name="fee" type="number" min="50" step="50" required value="${b.budget_cents ? Math.round(b.budget_cents / 100) : ''}"></label>
<label>A line to them<textarea name="line" rows="3" maxlength="800" placeholder="How you would make it."></textarea></label><p class="muted">Up to six of your works for them to judge by.</p>${pick('refs')}<button class="buy-btn">Send my answer</button>
<p class="muted">${FEE.on() ? 'Your fee is yours, whole; the house’s share is paid by the brand on top.' : ''} If you are chosen you are paid before you begin, held by the house.</p></form>` : ''}
${a && !ours ? `<p class="muted">You answered: ${money(a.fee_cents)}. ${a.status === 'declined' ? 'They chose another artist this time.' : 'Waiting for the brand.'}</p>` : ''}
${ours ? `<h2>The agreement</h2><pre class="brf-ag">${esc(agreement(b, a, m))}</pre>
${['commissioned'].includes(b.status) ? `<h2>Deliver</h2><form method="post" action="/account/briefs/${esc(b.ref)}/deliver" enctype="multipart/form-data" class="brf-f">
<p>From your vault (a company’s or a campaign’s use needs the release of anyone recognisable; a work marked <i>Needs a release</i> can go once it is in: <a href="/account/release/sign">sign one on the spot</a>)</p>${pick('works', 200)}
<label>Reels, films and other files<input type="file" name="files" multiple accept="video/mp4,video/quicktime,video/webm,image/*,application/pdf"></label><button class="buy-btn">Deliver</button></form>` : ''}
${files.length ? `<h2>Delivered</h2><ul class="brf-files">${files.map(f => `<li class="brf-file"><b>${esc(f.name || '')}</b><small>${f.bytes ? Math.round(f.bytes / 1e5) / 10 + ' MB' : ''} · ${esc(String(f.sha256 || '').slice(0, 12))}</small></li>`).join('')}</ul>` : ''}
<p class="brf-state">${esc({ commissioned: 'At work: deliver when ready', delivered: 'With the brand to approve', done: 'Approved: your fee clears for Friday' }[b.status] || b.status)}</p>` : ''}</section>` }));
  });
  app.post('/account/briefs/:ref/answer', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const b = byRef(req.params.ref); if (!b || b.status !== 'open' || (b.to_maker && b.to_maker !== m.id)) return res.redirect('/account/briefs');
    if (db.prepare('SELECT 1 FROM brief_answers WHERE brief_id=? AND maker_id=?').get(b.id, m.id)) return res.redirect(`/account/briefs/${b.ref}`);
    const fee = Math.round(+req.body.fee * 100); if (!(fee >= 5000)) return res.redirect(`/account/briefs/${b.ref}?ok=` + encodeURIComponent('A fee of $50 or more.'));
    const refs = (Array.isArray(req.body.refs) ? req.body.refs : [req.body.refs]).filter(Boolean).map(String).filter(s => db.prepare('SELECT 1 FROM works WHERE slug=? AND maker_id=?').get(s, m.id)).slice(0, 6);
    db.prepare('INSERT INTO brief_answers (brief_id, maker_id, fee_cents, line, refs) VALUES (?,?,?,?,?)').run(b.id, m.id, fee, String(req.body.line || '').replace(/<[^>]*>/g, '').slice(0, 800), JSON.stringify(refs));
    send(b.email, `An answer to your brief, ${b.ref}`, `${m.name} answered "${b.title}": ${money(fee)}.\n\nSee it, with their work: ${base}/b/${b.token}`);
    res.redirect(`/account/briefs/${b.ref}?ok=` + encodeURIComponent('Sent. The brand is written to.'));
  });
  app.post('/account/briefs/:ref/deliver', upload.array('files', 20), async (req, res) => {
    const m = makerOf(req); const clean = () => { for (const f of req.files || []) { try { fs.unlinkSync(f.path); } catch (e) { /* gone */ } } };
    if (!m) { clean(); return res.sendStatus(401); }
    const b = byRef(req.params.ref); const a = b && db.prepare('SELECT * FROM brief_answers WHERE brief_id=? AND maker_id=?').get(b.id, m.id);
    if (!b || !a || b.proposal_id !== a.id || b.status !== 'commissioned') { clean(); return res.redirect('/account/briefs'); }
    const back = ok => res.redirect(`/account/briefs/${b.ref}?ok=` + encodeURIComponent(ok));
    const CL = app.locals.clearance; const uses = usesOf(b); let n = 0; const refused = [];
    for (const s of (Array.isArray(req.body.works) ? req.body.works : [req.body.works]).filter(Boolean)) {
      const w = db.prepare("SELECT * FROM works WHERE slug=? AND maker_id=? AND status IN ('held','hidden')").get(String(s), m.id); if (!w) continue;
      if (CL && uses.some(k => CL.blocks(w, k))) { refused.push(w.title); continue; }
      if (db.prepare('SELECT 1 FROM brief_files WHERE brief_id=? AND work_id=?').get(b.id, w.id)) continue;
      db.prepare("INSERT INTO brief_files (brief_id, work_id, name, mime, bytes, sha256, kind) VALUES (?,?,?,?,?,?,'image')").run(b.id, w.id, `${w.title}${path.extname(w.original_file || '.jpg')}`, /\.png$/i.test(w.original_file) ? 'image/png' : /\.tiff?$/i.test(w.original_file) ? 'image/tiff' : 'image/jpeg', w.bytes, w.sha256); n++;
    }
    for (const f of req.files || []) {
      const v = app.locals.bagcheck ? await app.locals.bagcheck.check(f.path, { expect: 'deliverable', name: f.originalname, where: 'brief', who: `m:${m.handle}` }) : { ok: true, type: 'unknown' };
      if (!v.ok) { refused.push(`${f.originalname}: ${v.reason}`); try { fs.unlinkSync(f.path); } catch (e) { /* */ } continue; }
      const h = await sha(f.path); const name = `${b.ref}-${h.slice(0, 10)}${path.extname(f.originalname || '') || ''}`;
      try { fs.renameSync(f.path, path.join(DIR, name)); } catch (e) { fs.copyFileSync(f.path, path.join(DIR, name)); fs.unlinkSync(f.path); }
      const kind = v.type === 'mp4' || v.type === 'webm' ? 'video' : v.type === 'pdf' ? 'other' : 'image';
      const mime = { mp4: /\.mov$/i.test(f.originalname) ? 'video/quicktime' : 'video/mp4', webm: 'video/webm', pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', tiff: 'image/tiff', webp: 'image/webp' }[v.type] || f.mimetype;
      db.prepare('INSERT INTO brief_files (brief_id, file, name, mime, bytes, sha256, kind) VALUES (?,?,?,?,?,?,?)').run(b.id, name, String(f.originalname || name).slice(0, 160), mime, f.size, h, kind); n++;
      if (store && store.put) store.put('briefs/' + name, path.join(DIR, name), mime).catch(e => console.error('[briefs] vault', e.message));
    }
    if (!n) return back(refused.length ? `Nothing delivered. ${refused.join('; ')}` : 'Choose works or files to deliver.');
    db.prepare("UPDATE briefs SET status='delivered', delivered_at=datetime('now'), change_note=NULL WHERE id=?").run(b.id);
    send(b.email, `Delivered: ${b.title} (${b.ref})`, `${m.name} has delivered. Look, and approve or ask for a change, at your desk:\n\n${base}/b/${b.token}\n\nApproved by itself in ${APPROVE_DAYS} days if you say nothing.`);
    back(`Delivered.${refused.length ? ' Not sent: ' + refused.join('; ') : ''}`);
  });

  // ---------- the money: the artist's side, for the statement and Friday pay ----------
  const HOLD = Number(process.env.PAYOUT_HOLD_DAYS || 7);
  const earned = makerId => db.prepare(`SELECT COALESCE(SUM(a.fee_cents),0) s, COUNT(*) n FROM briefs b JOIN brief_answers a ON a.id=b.proposal_id WHERE a.maker_id=? AND b.status='done' AND b.paid=1`).get(makerId);
  const clearing = (makerId, since = `-${HOLD} days`) => db.prepare(`SELECT COALESCE(SUM(a.fee_cents),0) s, COUNT(*) n FROM briefs b JOIN brief_answers a ON a.id=b.proposal_id WHERE a.maker_id=? AND b.status='done' AND b.paid=1 AND b.approved_at > datetime('now', ?)`).get(makerId, since);
  // Approved by itself: BRIEF_APPROVE_DAYS after delivery with no word.
  const quiet = () => { for (const b of db.prepare(`SELECT * FROM briefs WHERE status='delivered' AND delivered_at < datetime('now', ?)`).all(`-${APPROVE_DAYS} days`)) approve(b, 'quiet'); };
  if (!app.locals.noTimers && require('./role').chores) setInterval(() => { try { quiet(); } catch (e) { console.error('[briefs]', e.message); } }, 3600e3).unref();
  // The house sees every brief.
  app.get('/studio/briefs', studioOnly, (req, res) => {
    const rows = db.prepare('SELECT b.*, (SELECT COUNT(*) FROM brief_answers a WHERE a.brief_id=b.id) answers FROM briefs b ORDER BY b.id DESC LIMIT 200').all();
    res.send(V.layout({ title: 'Briefs · The house', studio: true, body: `<section class="studio-wrap brf"><p class="k"><a href="/studio">The house</a></p><h1>Briefs.</h1><table class="tbl"><thead><tr><th>Ref</th><th>Brand</th><th>What</th><th>Answers</th><th>State</th><th>Fee</th></tr></thead><tbody>${rows.map(b => `<tr><td><a href="/b/${esc(b.token)}">${esc(b.ref)}</a></td><td>${esc(b.company)}</td><td>${esc(b.title)}</td><td>${b.answers}</td><td>${esc(b.status)}</td><td>${b.fee_cents ? money(b.fee_cents) : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">None yet.</td></tr>'}</tbody></table></section>` }));
  });
  app.locals.briefs = { earned, clearing, approve, quiet, agreement, funded };
  return app.locals.briefs;
}
module.exports = { mountBriefs, USES, KINDS };
