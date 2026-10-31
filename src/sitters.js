'use strict';
// The sitter (31 Oct, Will: "a subject account; the models of the world; sometimes people are the muses; they gather
// all these photos of themselves; their likenesses"; "the connection between maker and model"; "figure out how to do
// that so beautifully").
// A role on the same account, never a separate one: a sitter is a person (buyers row, same sign-in) who is in
// photographs held here. The photographer keeps the copyright, always; the sitter keeps their likeness.
// How a picture comes to a sitter (no face recognition, ever; a link only by their own hand):
//   - the release: a model release signed with an email (signed on the phone, or kept on the work's record) links the
//     sitter to the photograph at once: they signed;
//   - the photographer names them on a work: a letter goes to them, and nothing links until they say it is them;
//   - a sitter already linked to that photographer by a signed release is linked to the next picture at once, and told.
// What the sitter has: "Pictures of you" (/yours/sitter), every picture by every photographer, grouped by the
// photographer; keep any of them, free, for good; the credit "With <name>" on the work, if they want it (each picture
// can be stepped out of); their word on commercial use (open | ask me first | not), which the house enforces on
// the wall, the API and the trade; a fee they ask for commercial use, shown to the photographer when asked; a line
// to the photographer to shoot again; the claims door for a picture they want down. Adults only: a release marked
// for a minor never makes a sitter.
// The photographer has "Your sitters" (/account/sitters) and "In this picture" on each work's record.
const crypto = require('crypto');

function mountSitters(app, { db, C, V, mail, ledger, grant, nextRef, q, makerOf, isStudio, buyerOf, setBuyer }) {
  const { esc, tidy } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS sitters (id INTEGER PRIMARY KEY, buyer_id INTEGER NOT NULL UNIQUE, name TEXT, credit INTEGER NOT NULL DEFAULT 1,
      commercial TEXT NOT NULL DEFAULT 'ask', fee_cents INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS sittings (id INTEGER PRIMARY KEY, sitter_id INTEGER NOT NULL, maker_id INTEGER NOT NULL, work_id INTEGER NOT NULL,
      release_id INTEGER, status TEXT NOT NULL DEFAULT 'asked', by TEXT, token TEXT, credit INTEGER NOT NULL DEFAULT 1, at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (sitter_id, work_id));`);
  for (const [c, t] of [['share_pct', 'INTEGER NOT NULL DEFAULT ' + Math.max(0, Math.min(50, Number(process.env.SITTER_PCT || 10)))], ['share_all', 'INTEGER NOT NULL DEFAULT 0']]) if (!db.prepare("SELECT 1 FROM pragma_table_info('sittings') WHERE name=?").get(c)) db.exec(`ALTER TABLE sittings ADD COLUMN ${c} ${t}`);
  // The sitter's word on one company's or campaign's use (a link they answer), and what their pictures have paid them.
  db.exec(`CREATE TABLE IF NOT EXISTS sitter_asks (id INTEGER PRIMARY KEY, license_ref TEXT NOT NULL, sitting_id INTEGER NOT NULL, sitter_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'asked', at TEXT NOT NULL DEFAULT (datetime('now')), answered_at TEXT, UNIQUE (license_ref, sitter_id));
    CREATE TABLE IF NOT EXISTS sitter_pay (id INTEGER PRIMARY KEY, sitter_id INTEGER NOT NULL, maker_id INTEGER NOT NULL, license_ref TEXT NOT NULL, cents INTEGER NOT NULL,
      at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (sitter_id, license_ref));`);
  const COMMERCIAL = new Set(['commercial', 'campaign']);
  const first = n => String(n || '').trim().split(/\s+/)[0] || '';
  const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const okEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e || '');
  const tell = (o) => { if (app.locals.notify) try { app.locals.notify.tell(o).catch(() => {}); } catch (e) { /* */ } };

  // A sitter for an email: the account the house already has for it, else a new one (no password, no sign-in yet).
  function sitterFor(email, name) {
    email = String(email || '').trim().toLowerCase(); if (!okEmail(email)) return null;
    let b = db.prepare('SELECT * FROM buyers WHERE lower(email)=?').get(email);
    if (!b) { const id = db.prepare("INSERT INTO buyers (customer, email, name) VALUES ('', ?, ?)").run(email, name || null).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); }
    let s = db.prepare('SELECT * FROM sitters WHERE buyer_id=?').get(b.id);
    if (!s) { db.prepare('INSERT INTO sitters (buyer_id, name) VALUES (?,?)').run(b.id, name || b.name || null); s = db.prepare('SELECT * FROM sitters WHERE buyer_id=?').get(b.id); }
    else if (name && !s.name) { db.prepare('UPDATE sitters SET name=? WHERE id=?').run(name, s.id); s.name = name; }
    return s;
  }
  const sitterOf = b => (b ? db.prepare('SELECT * FROM sitters WHERE buyer_id=?').get(b.id) : null);
  const nameOf = s => s.name || (db.prepare('SELECT name, email FROM buyers WHERE id=?').get(s.buyer_id) || {}).name || 'The sitter';

  // Releases with an address become sittings: they signed, so the link is made. A minor's release never does.
  function sync() {
    let n = 0;
    try {
      for (const r of db.prepare("SELECT * FROM work_releases WHERE kind='model' AND email IS NOT NULL AND email<>'' AND COALESCE(minor,0)=0 AND work_id>0").all()) {
        const w = db.prepare('SELECT id, maker_id FROM works WHERE id=?').get(r.work_id); if (!w) continue;
        const s = sitterFor(r.email, r.subject); if (!s) continue;
        const had = db.prepare('SELECT * FROM sittings WHERE sitter_id=? AND work_id=?').get(s.id, w.id);
        if (!had) { db.prepare("INSERT INTO sittings (sitter_id, maker_id, work_id, release_id, status, by) VALUES (?,?,?,?,'on','release')").run(s.id, w.maker_id, w.id, r.id); n++; }
        else if (had.status === 'asked') { db.prepare("UPDATE sittings SET status='on', release_id=?, by='release' WHERE id=?").run(r.id, had.id); n++; }
      }
    } catch (e) { console.error('[sitters] sync', e.message); }
    return n;
  }
  if (!app.locals.noTimers) { setTimeout(sync, 20e3).unref(); setInterval(sync, 10 * 60e3).unref(); }

  // The house's gate on commercial use, one read a turn of the loop: a work's strictest sitter word.
  let gTick = null;
  const words = () => {
    if (gTick) return gTick; const m = new Map();
    for (const r of db.prepare("SELECT st.work_id, s.commercial FROM sittings st JOIN sitters s ON s.id=st.sitter_id WHERE st.status='on' AND s.commercial<>'open'").all()) { const was = m.get(r.work_id); if (was !== 'closed') m.set(r.work_id, r.commercial); }
    gTick = m; setImmediate(() => { gTick = null; }); return m;
  };
  // null: as the house would; 'ask': listed, asked of the photographer (who sees the sitter's fee); 'closed': not offered.
  const gate = (w, key) => (w && COMMERCIAL.has(key) ? words().get(w.id) || null : null);

  const sittingsOf = w => db.prepare("SELECT st.*, s.name, s.credit AS scredit, s.commercial, s.fee_cents, s.buyer_id FROM sittings st JOIN sitters s ON s.id=st.sitter_id WHERE st.work_id=? ORDER BY st.id").all(w.id);
  // "With Ana Ruiz": on the work page, only where the sitter said yes, for this picture and overall.
  function credit(w) {
    try {
      const on = sittingsOf(w).filter(x => x.status === 'on' && x.credit && x.scredit);
      if (!on.length) return '';
      return `<p class="sit-with">With ${on.map(x => `<span>${esc(x.name || 'a sitter')}</span>`).join(' and ')}</p>`;
    } catch (e) { return ''; }
  }

  // ---- The photographer names a sitter on a work.
  app.post(['/account/works/:slug/sitter', '/studio/works/:slug/sitter'], (req, res) => {
    const studio = /^\/studio\//.test(req.path); const me = makerOf(req); if (!studio && !me) return res.sendStatus(401); if (studio && !isStudio(req)) return res.sendStatus(403);
    const w = db.prepare('SELECT * FROM works WHERE slug=?').get(String(req.params.slug)); if (!w || (!studio && w.maker_id !== me.id)) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id);
    const back = `${studio ? '/studio' : '/account'}/works/${encodeURIComponent(w.slug)}#sitters`;
    const x = req.body || {};
    if (x.do === 'remove') { db.prepare('DELETE FROM sittings WHERE id=? AND work_id=?').run(+x.id, w.id); return res.redirect(303, back); }
    if (x.do === 'share') { const pct = Math.max(0, Math.min(50, parseInt(x.pct, 10) || 0)); db.prepare('UPDATE sittings SET share_pct=?, share_all=? WHERE id=? AND work_id=?').run(pct, x.all ? 1 : 0, +x.id, w.id); return res.redirect(303, back); }
    const name = String(x.name || '').trim().slice(0, 120), email = String(x.email || '').trim().toLowerCase().slice(0, 160);
    if (!name || !okEmail(email)) return res.redirect(303, back.replace('#', '?sit=need#'));
    const s = sitterFor(email, name);
    if (db.prepare('SELECT 1 FROM sittings WHERE sitter_id=? AND work_id=?').get(s.id, w.id)) return res.redirect(303, back);
    // Known to this photographer by a signed release: linked now, and told. Otherwise asked.
    const known = db.prepare("SELECT 1 FROM sittings WHERE sitter_id=? AND maker_id=? AND release_id IS NOT NULL AND status='on'").get(s.id, m.id);
    const token = crypto.randomBytes(12).toString('base64url');
    db.prepare('INSERT INTO sittings (sitter_id, maker_id, work_id, status, by, token) VALUES (?,?,?,?,?,?)').run(s.id, m.id, w.id, known ? 'on' : 'asked', 'maker', token);
    const link = `${C.base}/sit/${token}`;
    const picture = `${C.base}/img/${w.slug}/screen?f=jpg`;
    const text = known
      ? `${first(name)},\n\n${m.name} has added another photograph of you on Watermark: ${tidy(w.title)}.\n\nIt is in Pictures of you, with the others. Keep it, step out of its credit, or tell the house what may be done with it:\n${C.base}/yours/sitter\n\nWatermark`
      : `${first(name)},\n\n${m.name} says you are in a photograph of theirs on Watermark: ${tidy(w.title)}.\n\nIs it you? If it is, the photograph comes to Pictures of you, where you can keep it, be credited by name if you like, and say what may be done with your likeness. If it is not, say so and nothing is linked.\n\n${link}\n\nWatermark`;
    if (mail.on()) mail.send({ to: email, subject: known ? `Another photograph of you, by ${m.name}` : `${m.name} photographed you`, text, feature: known ? 'Pictures of you' : 'Is it you?', cta: { label: known ? 'Pictures of you' : 'See the photograph', url: known ? `${C.base}/yours/sitter` : link } });
    else if (app.locals.mailLog) app.locals.mailLog.push({ to: email, subject: 'sitter', link });
    try { ledger.append(db, 'sitter.named', w.slug, { known: !!known }); } catch (e) { /* */ }
    res.redirect(303, back.replace('#', `?sit=${known ? 'linked' : 'asked'}#`));
  });
  // The block on the work's record: who is in it, and naming someone.
  function block(w, action) {
    const list = sittingsOf(w); const said = { need: 'A name and an email, please.', asked: 'Asked. They will see the photograph and say whether it is them.', linked: 'Linked: they had signed with you before, and they have been told.' };
    return `<section class="sit-rec" id="sitters"><h2>In this picture</h2><p class="note">The people in it, by their own word: a release they signed, or their yes to your letter. The copyright is yours; their likeness is theirs. No face is ever recognised by the house.</p>
${list.length ? `<ul class="sit-ls">${list.map(x => `<li><b>${esc(x.name || 'A sitter')}</b><span>${x.status === 'on' ? (x.release_id ? 'Signed a release' : 'Said it is them') : x.status === 'asked' ? 'Asked, not yet answered' : x.status === 'declined' ? 'Said it is not them' : 'Stepped out'}${x.status === 'on' ? ` · commercial use: ${x.commercial === 'open' ? 'yes' : x.commercial === 'closed' ? 'no' : 'ask them first'}${x.fee_cents ? ` · their fee ${money(x.fee_cents)}` : ''}${x.credit && x.scredit ? ' · credited' : ''}` : ''}</span><form method="post" action="${esc(action)}"><input type="hidden" name="do" value="remove"><input type="hidden" name="id" value="${x.id}"><button class="link">Remove</button></form>
<form method="post" action="${esc(action)}" class="sit-share"><input type="hidden" name="do" value="share"><input type="hidden" name="id" value="${x.id}"><label>Their share of your side <select name="pct">${[0, 5, 10, 15, 20, 25].map(n => `<option value="${n}"${x.share_pct === n ? ' selected' : ''}>${n}%</option>`).join('')}</select></label><label><input type="checkbox" name="all" value="1"${x.share_all ? ' checked' : ''}> on every sale, not only a company&rsquo;s or a campaign&rsquo;s</label><button class="link">Set</button></form></li>`).join('')}</ul>
<p class="note">A company or a campaign cannot use a likeness without the sitter&rsquo;s yes, so their share there is the price of that yes: a cost of your business, taken from your side, paid to them on Fridays. Collections and prints need nothing from them; a share there is yours to give.</p>` : ''}
<form method="post" action="${esc(action)}" class="sit-add">${''}<input name="name" placeholder="Their name" maxlength="120" required><input name="email" type="email" placeholder="Their email" maxlength="160" required><button class="bk-alt">Ask them</button></form>
${app.locals.signRelease ? `<p class="note">Better still, a release: <a href="/account/release/sign?work=${esc(w.slug)}">signed on this phone</a> links them at once.</p>` : ''}</section>`;
  }

  // ---- The sitter answers a letter: it is them, or it is not.
  app.get('/sit/:token', (req, res) => {
    const st = db.prepare('SELECT * FROM sittings WHERE token=?').get(String(req.params.token)); if (!st) return res.sendStatus(404);
    const s = db.prepare('SELECT * FROM sitters WHERE id=?').get(st.sitter_id), b = db.prepare('SELECT * FROM buyers WHERE id=?').get(s.buyer_id);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(st.work_id), m = db.prepare('SELECT * FROM makers WHERE id=?').get(st.maker_id);
    if (!w || !m) return res.sendStatus(404);
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'Is it you? · Watermark', bare: true, body: `<main class="sit-door"><figure><img src="/img/${esc(w.slug)}/screen" alt=""></figure><section>
<p class="k">${esc(m.name)} photographed you</p><h1>Is it you?</h1>
<p class="lede"><i>${esc(tidy(w.title))}</i>${w.place ? `, ${esc(w.place)}` : ''}. ${esc(first(m.name))} keeps the photograph; your likeness is yours. If it is you, it comes to Pictures of you: keep it, be credited by name if you like, and say what may be done with it.</p>
${st.status === 'asked' ? `<form method="post" action="/sit/${esc(st.token)}" class="sit-yes"><button name="a" value="yes" class="buy-btn">Yes, it is me</button><button name="a" value="no" class="link">It is not me</button></form>` : `<p class="lede">${st.status === 'on' ? 'Linked.' : 'Answered.'} <a href="/yours/sitter">Pictures of you</a></p>`}
<p class="note">Adults only. A picture is linked to a person only by their own word; the house never recognises faces.</p></section></main>` }));
  });
  app.post('/sit/:token', (req, res) => {
    const st = db.prepare('SELECT * FROM sittings WHERE token=?').get(String(req.params.token)); if (!st) return res.sendStatus(404);
    const s = db.prepare('SELECT * FROM sitters WHERE id=?').get(st.sitter_id), b = db.prepare('SELECT * FROM buyers WHERE id=?').get(s.buyer_id);
    const yes = (req.body || {}).a === 'yes';
    db.prepare('UPDATE sittings SET status=? WHERE id=?').run(yes ? 'on' : 'declined', st.id);
    tell({ maker_id: st.maker_id, kind: 'sitter', href: '/account/sitters', title: yes ? `${nameOf(s)} said it is them` : `${nameOf(s)} says it is not them`, body: (db.prepare('SELECT title FROM works WHERE id=?').get(st.work_id) || {}).title || '' });
    if (yes) { if (app.locals.admit) app.locals.admit(req, res, b.email, 'a link'); else if (setBuyer) setBuyer(res, b); return res.redirect(303, '/yours/sitter?ok=yes'); }
    res.redirect(303, `/sit/${st.token}`);
  });

  // ---- Pictures of you.
  app.get('/yours/sitter', (req, res) => {
    sync();
    const b = buyerOf(req); if (!b) return res.redirect('/signin?next=/yours/sitter');
    const s = sitterOf(b);
    const rows = s ? db.prepare("SELECT st.*, w.slug, w.title, w.place, w.taken_at, w.width, w.height, w.status AS wstatus, w.stars, m.name AS maker, m.handle FROM sittings st JOIN works w ON w.id=st.work_id JOIN makers m ON m.id=st.maker_id WHERE st.sitter_id=? AND st.status IN ('on','asked') AND w.status IN ('held','hidden') ORDER BY m.name, COALESCE(w.taken_at, w.created_at) DESC").all(s.id) : [];
    const on = rows.filter(r => r.status === 'on'), asked = rows.filter(r => r.status === 'asked');
    const kept = new Set(b ? db.prepare("SELECT work_id FROM licenses WHERE buyer_id=? AND status='active'").all(b.id).map(r => r.work_id) : []);
    const by = new Map(); for (const r of on) { if (!by.has(r.maker_id)) by.set(r.maker_id, { maker: r.maker, handle: r.handle, list: [] }); by.get(r.maker_id).list.push(r); }
    const hero = on.slice().sort((a, b2) => (b2.stars || 0) - (a.stars || 0))[0];
    const name = s ? nameOf(s) : (b.name || '');
    const said = { yes: 'Linked. It is here now, with the others.', saved: 'Kept.', kept: 'It hangs in your gallery now, yours for good.' }[req.query.ok] || '';
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'Pictures of you · Watermark', path: '/yours/sitter', body: `<main class="sit">
<header class="sit-h">${hero ? `<figure class="sit-hero"><img src="/img/${esc(hero.slug)}/large" alt=""></figure>` : ''}<div class="sit-ht"><p class="k">Pictures of you</p><h1>${esc(name || 'You')}.</h1>
<p class="sit-line">${on.length ? `${on.length} photograph${on.length === 1 ? '' : 's'} by ${by.size} photographer${by.size === 1 ? '' : 's'}.` : 'Photographs of you gather here, by your own word: a release you sign, or your yes to a photographer&rsquo;s letter.'} The photographers keep their pictures; your likeness is yours.</p>
${s && earnedBy(s).c ? `<p class="sit-earn"><b>${money(earnedBy(s).c)}</b> from ${earnedBy(s).n} sale${earnedBy(s).n === 1 ? '' : 's'} of photographs of you, in your pocket and to your bank on Fridays. <a href="/yours?tab=more#pocket">Your pocket</a></p>` : ''}${said ? `<p class="sit-said">${esc(said)}</p>` : ''}</div></header>
${asked.length ? `<section class="sit-ask"><h2>Is it you?</h2><ul class="sit-grid">${asked.map(r => `<li><img src="/img/${esc(r.slug)}/thumb" alt=""><span>${esc(r.maker)} says you are in <i>${esc(tidy(r.title))}</i>.</span><form method="post" action="/sit/${esc(r.token)}"><button name="a" value="yes" class="bk-alt">Yes</button> <button name="a" value="no" class="link">Not me</button></form></li>`).join('')}</ul></section>` : ''}
${s ? `<form method="post" action="/yours/sitter" class="sit-word"><h2>Your word on your likeness</h2>
<label class="sit-sw"><input type="checkbox" name="credit" value="1"${s.credit ? ' checked' : ''}> <span>Credit me by name: <b>With ${esc(name || 'you')}</b>, on the photographs.</span></label>
<fieldset><legend>For a company or a campaign</legend>${[['ask', 'Ask me first', 'The photographer is asked, and sees your fee.'], ['open', 'Yes', 'It may be licensed like the rest, under your release.'], ['closed', 'No', 'Never for a company or a campaign.']].map(([k, t, l]) => `<label><input type="radio" name="commercial" value="${k}"${s.commercial === k ? ' checked' : ''}> <b>${t}</b><span>${l}</span></label>`).join('')}</fieldset>
<label class="sit-fee"><span>Your fee for a company or campaign</span><span class="sit-fi">$<input name="fee" inputmode="decimal" value="${s.fee_cents ? (s.fee_cents / 100) : ''}" placeholder="none"></span></label>
<button class="buy-btn">Keep my word</button><p class="note">Showing, collecting, prints and books of the photographer&rsquo;s work need nothing from you. Licences already given stand.</p></form>` : ''}
${[...by.values()].map(g => `<section class="sit-by"><h2>Photographed by <a href="/m/${esc(g.handle)}">${esc(g.maker)}</a> <small>${g.list.length}</small></h2><ul class="sit-grid">${g.list.map(r => `<li class="${r.wstatus === 'held' ? '' : 'sit-kept'}"><a href="/w/${esc(r.slug)}"><img src="/img/${esc(r.slug)}/screen" alt="${esc(tidy(r.title))}" loading="lazy"></a><span><b>${esc(tidy(r.title))}</b>${r.place ? ` · ${esc(r.place)}` : ''}${r.wstatus === 'held' ? '' : ' · kept back by the photographer'}</span><p class="sit-acts">${kept.has(r.work_id) ? '<em>In your gallery</em>' : `<form method="post" action="/yours/sitter/keep/${esc(r.slug)}"><button class="bk-alt">Keep it</button></form>`}<form method="post" action="/yours/sitter/credit/${r.id}"><button class="link">${r.credit ? 'Step out of its credit' : 'Credit me on it'}</button></form><a class="link" href="/w/${esc(r.slug)}/claim">Ask for it to come down</a> <form method="post" action="/yours/sitter/again/${r.maker_id}"><button class="link">Shoot again</button></form></p></li>`).join('')}</ul></section>`).join('')}
<p class="note sit-foot">Adults only. A photograph comes here only by your word; the house never recognises faces. <a href="/clearance">What a release allows</a>.</p></main>` }));
  });
  app.post('/yours/sitter', (req, res) => {
    const b = buyerOf(req); if (!b) return res.sendStatus(401); const s = sitterOf(b); if (!s) return res.sendStatus(404);
    const x = req.body || {}; const c = ['ask', 'open', 'closed'].includes(x.commercial) ? x.commercial : s.commercial;
    const fee = Math.round(parseFloat(String(x.fee || '').replace(/[^0-9.]/g, '')) * 100);
    db.prepare('UPDATE sitters SET credit=?, commercial=?, fee_cents=? WHERE id=?').run(x.credit ? 1 : 0, c, fee > 0 ? Math.min(fee, 100000000) : null, s.id);
    try { ledger.append(db, 'sitter.word', `sitter-${s.id}`, { commercial: c }); } catch (e) { /* */ }
    res.redirect(303, '/yours/sitter?ok=saved');
  });
  app.post('/yours/sitter/credit/:id', (req, res) => {
    const b = buyerOf(req); const s = sitterOf(b); if (!s) return res.sendStatus(401);
    db.prepare('UPDATE sittings SET credit=1-credit WHERE id=? AND sitter_id=?').run(+req.params.id, s.id); res.redirect(303, '/yours/sitter');
  });
  // Keep a picture of yourself: a free licence of personal use, for good, as a friend keeps one from an album.
  app.post('/yours/sitter/keep/:slug', (req, res) => {
    const b = buyerOf(req); const s = sitterOf(b); if (!s) return res.sendStatus(401);
    const w = db.prepare("SELECT * FROM works WHERE slug=? AND status IN ('held','hidden')").get(String(req.params.slug)); if (!w) return res.sendStatus(404);
    if (!db.prepare("SELECT 1 FROM sittings WHERE sitter_id=? AND work_id=? AND status='on'").get(s.id, w.id)) return res.sendStatus(403);
    const u = q.use.get(w.maker_id, 'delivery'); if (!u) return res.sendStatus(409);
    if (!db.prepare("SELECT 1 FROM licenses WHERE work_id=? AND buyer_id=? AND status='active'").get(w.id, b.id)) {
      const ref = nextRef();
      db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,intended_use,price_cents,status,buyer_id,rights) VALUES (?,?,?,?,?,?,NULL,'requested',?,?)").run(ref, w.id, u.id, nameOf(s), b.email || '', 'Kept by its sitter', b.id, JSON.stringify({ size: 'share', strip: false }));
      grant(ref, { paid: false });
      tell({ maker_id: w.maker_id, kind: 'kept', href: `/w/${w.slug}`, title: `${nameOf(s)} kept ${tidy(w.title)}`, body: 'A picture of them, in their gallery now.' });
    }
    res.redirect(303, '/yours/sitter?ok=kept');
  });
  // Shoot again: the photographer is told, with the sitter's address, since the sitter asked.
  app.post('/yours/sitter/again/:maker', (req, res) => {
    const b = buyerOf(req); const s = sitterOf(b); if (!s) return res.sendStatus(401);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(+req.params.maker); if (!m) return res.sendStatus(404);
    if (!db.prepare("SELECT 1 FROM sittings WHERE sitter_id=? AND maker_id=? AND status='on'").get(s.id, m.id)) return res.sendStatus(403);
    tell({ maker_id: m.id, kind: 'sitter', href: '/account/sitters', title: `${nameOf(s)} would like to be photographed again`, body: b.email || '' });
    if (mail.on() && m.email) mail.send({ to: m.email, subject: `${nameOf(s)} would like to shoot again`, text: `${first(m.name)},\n\n${nameOf(s)}, who sat for you, would like to be photographed again. Write to them: ${b.email}\n\nWatermark` });
    res.redirect(303, '/yours/sitter?ok=saved');
  });

  // ---- Your sitters, for the photographer.
  app.get('/account/sitters', (req, res) => {
    sync();
    const m = makerOf(req); if (!m) return res.redirect('/signin?next=/account/sitters');
    const rows = db.prepare("SELECT s.*, COUNT(st.id) n, SUM(CASE WHEN st.status='asked' THEN 1 ELSE 0 END) a, MIN(w.slug) slug FROM sittings st JOIN sitters s ON s.id=st.sitter_id JOIN works w ON w.id=st.work_id WHERE st.maker_id=? AND st.status IN ('on','asked') GROUP BY s.id ORDER BY n DESC").all(m.id);
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'Your sitters · Watermark', studio: true, path: '/account/sitters', body: `<section class="sit sit-mk"><p class="k">Your studio</p><h1>Your sitters.</h1>
<p class="lede">The people in your photographs, by their own word. You keep the copyright; they keep their likeness, and their say on a company&rsquo;s or a campaign&rsquo;s use of it. Name someone on any work&rsquo;s record, or have them sign a release on your phone.</p>
${rows.length ? `<ul class="sit-mls">${rows.map(r => `<li><img src="/img/${esc(r.slug)}/thumb" alt=""><div><b>${esc(nameOf(r))}</b><span>${r.n} photograph${r.n === 1 ? '' : 's'}${r.a ? `, ${r.a} not yet answered` : ''} · commercial use: ${r.commercial === 'open' ? 'yes' : r.commercial === 'closed' ? 'no' : 'ask first'}${r.fee_cents ? ` · their fee ${money(r.fee_cents)}` : ''}</span></div></li>`).join('')}</ul>` : '<p class="note">None yet.</p>'}
<p><a class="buy-btn" href="/account/release/sign">Sign a release now, on this phone</a></p></section>` }));
  });


  // ---- A company's or a campaign's use, asked of the sitter (31 Oct, Will: "a link that is sent out and someone can
  // say yes or no, and the sitter gets money from the sale of the work, from the maker's percentage; a functioning
  // business within the ecosystem, not charity"). The request waits for every sitter who said "ask me first"; a no
  // declines it, kindly; a yes lets the photographer quote it. What the sitter is paid is their share of the
  // photographer's side, set by the photographer, recorded as the photographer's cost and credited to the sitter's
  // pocket, which goes to their bank on Fridays.
  function ask(ref) {
    const l = db.prepare('SELECT l.*, u.key AS use_key, u.name AS use_name, u.term_months FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.ref=?').get(ref);
    if (!l || !COMMERCIAL.has(l.use_key)) return 0;
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id); const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id);
    let n = 0;
    for (const st of sittingsOf(w).filter(x => x.status === 'on' && x.commercial === 'ask')) {
      if (db.prepare('SELECT 1 FROM sitter_asks WHERE license_ref=? AND sitter_id=?').get(ref, st.sitter_id)) continue;
      const token = crypto.randomBytes(12).toString('base64url');
      db.prepare('INSERT INTO sitter_asks (license_ref, sitting_id, sitter_id, token) VALUES (?,?,?,?)').run(ref, st.id, st.sitter_id, token); n++;
      const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(st.buyer_id); const link = `${C.base}/sit/ask/${token}`;
      const who = l.licensee_company || 'A company';
      const text = `${first(st.name)},\n\n${who} would like to use a photograph of you, by ${m.name}: ${tidy(w.title)}.\n\nThe use: ${l.use_name}${l.term_months ? `, for ${l.term_months} months` : ''}.${l.intended_use ? `\nWhat for: ${String(l.intended_use).slice(0, 300)}` : ''}\n${st.share_pct ? `\nIf you say yes and it is licensed, ${st.share_pct}% of ${first(m.name)}'s side of the fee is yours, paid on Fridays.` : ''}\n\nYes or no, here: ${link}\n\nNothing goes ahead without your yes.\nWatermark`;
      if (b && b.email && mail.on()) mail.send({ to: b.email, subject: `${who} would like to use a photograph of you`, text, feature: 'Your yes', cta: { label: 'Say yes or no', url: link } });
      else if (app.locals.mailLog) app.locals.mailLog.push({ to: b && b.email, subject: 'sitter ask', link });
      tell({ buyer_id: st.buyer_id, kind: 'sitter', href: `/sit/ask/${token}`, title: `${who} would like to use a photograph of you`, body: tidy(w.title) });
    }
    return n;
  }
  // What still waits on a sitter for this request: null when all have said yes (or none were asked).
  function waiting(ref) {
    const rows = db.prepare("SELECT a.status, s.name FROM sitter_asks a JOIN sitters s ON s.id=a.sitter_id WHERE a.license_ref=?").all(ref);
    const no = rows.find(r => r.status === 'no'); if (no) return { no: true, who: no.name || 'The sitter' };
    const wait = rows.filter(r => r.status === 'asked'); return wait.length ? { no: false, who: wait.map(r => r.name || 'the sitter').join(' and ') } : null;
  }
  app.get('/sit/ask/:token', (req, res) => {
    const a = db.prepare('SELECT * FROM sitter_asks WHERE token=?').get(String(req.params.token)); if (!a) return res.sendStatus(404);
    const l = db.prepare('SELECT l.*, u.name AS use_name, u.term_months FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.ref=?').get(a.license_ref);
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id), m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id), st = db.prepare('SELECT * FROM sittings WHERE id=?').get(a.sitting_id);
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: 'Your yes · Watermark', bare: true, body: `<main class="sit-door"><figure><img src="/img/${esc(w.slug)}/screen" alt=""></figure><section>
<p class="k">A photograph of you, by ${esc(m.name)}</p><h1>${esc(l.licensee_company || 'A company')} would like to use it.</h1>
<dl class="sit-dl"><dt>The use</dt><dd>${esc(l.use_name)}${l.term_months ? `, for ${l.term_months} months` : ''}</dd>${l.intended_use ? `<dt>What for</dt><dd>${esc(String(l.intended_use).slice(0, 400))}</dd>` : ''}<dt>Yours if it goes ahead</dt><dd>${st && st.share_pct ? `${st.share_pct}% of ${esc(first(m.name))}&rsquo;s side of the fee, paid to you on Fridays` : `Nothing has been set; ${esc(first(m.name))} can set a share`}</dd></dl>
${a.status === 'asked' ? `<form method="post" action="/sit/ask/${esc(a.token)}" class="sit-yes"><button name="a" value="yes" class="buy-btn">Yes, they may</button><button name="a" value="no" class="link">No</button></form><p class="note">Nothing goes ahead without your yes. A no is passed on kindly, without a reason unless you give one.</p>` : `<p class="lede">You said ${a.status === 'yes' ? 'yes' : 'no'}. <a href="/yours/sitter">Pictures of you</a></p>`}</section></main>` }));
  });
  app.post('/sit/ask/:token', async (req, res) => {
    const a = db.prepare('SELECT * FROM sitter_asks WHERE token=?').get(String(req.params.token)); if (!a) return res.sendStatus(404);
    if (a.status !== 'asked') return res.redirect(303, `/sit/ask/${a.token}`);
    const yes = (req.body || {}).a === 'yes'; db.prepare("UPDATE sitter_asks SET status=?, answered_at=datetime('now') WHERE id=?").run(yes ? 'yes' : 'no', a.id);
    const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(a.license_ref); const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id); const s = db.prepare('SELECT * FROM sitters WHERE id=?').get(a.sitter_id);
    try { ledger.append(db, 'sitter.answered', a.license_ref, { yes }); } catch (e) { /* */ }
    tell({ maker_id: w.maker_id, kind: 'sitter', href: `/account/requests/${encodeURIComponent(l.ref)}`, title: yes ? `${nameOf(s)} said yes` : `${nameOf(s)} said no`, body: `${l.licensee_company || 'A company'}, ${tidy(w.title)}` });
    if (!yes && app.locals.requests) try { app.locals.requests.decline(l.ref, 'The person in the photograph has not agreed to this use.', 'sitter'); } catch (e) { /* */ }
    if (app.locals.admit) { const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(s.buyer_id); if (b && b.email) app.locals.admit(req, res, b.email, 'a link'); }
    res.redirect(303, `/sit/ask/${a.token}`);
  });
  // Paid: each sitter's share of the photographer's side, to their pocket; a cost on the photographer's statement.
  function pay(ref) {
    const l = db.prepare('SELECT l.*, u.key AS use_key FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.ref=?').get(ref); if (!l || !(l.price_cents > 0)) return 0;
    const w = db.prepare('SELECT * FROM works WHERE id=?').get(l.work_id); const m = db.prepare('SELECT * FROM makers WHERE id=?').get(w.maker_id);
    const side = require('./fee').makerOf(l, m.share_pct || 85); let n = 0;
    for (const st of sittingsOf(w).filter(x => x.status === 'on' && x.share_pct > 0 && (x.share_all || COMMERCIAL.has(l.use_key)))) {
      const cents = Math.floor(side * st.share_pct / 100); if (cents < 1) continue;
      if (db.prepare('SELECT 1 FROM sitter_pay WHERE sitter_id=? AND license_ref=?').get(st.sitter_id, ref)) continue;
      db.prepare('INSERT INTO sitter_pay (sitter_id, maker_id, license_ref, cents) VALUES (?,?,?,?)').run(st.sitter_id, m.id, ref, cents);
      const b = db.prepare('SELECT * FROM buyers WHERE id=?').get(st.buyer_id);
      if (app.locals.pocket) app.locals.pocket.credit(b, cents, 'sitting', ref, `From ${m.name}: ${tidy(w.title)}`);
      tell({ buyer_id: st.buyer_id, kind: 'sitter', href: '/yours/sitter', title: `${money(cents)} from a photograph of you`, body: `${tidy(w.title)}, by ${m.name}` });
      n++;
    }
    return n;
  }
  // The photographer's cost: what their sitters have been paid from their side.
  const owedOut = m => { const r = db.prepare('SELECT COALESCE(SUM(p.cents),0) s, COUNT(*) n FROM sitter_pay p WHERE p.maker_id=?').get(m.id); const by = {}; for (const x of db.prepare('SELECT s.name, SUM(p.cents) c FROM sitter_pay p JOIN sitters s ON s.id=p.sitter_id WHERE p.maker_id=? GROUP BY s.id').all(m.id)) by[x.name || 'A sitter'] = x.c; return { s: r.s, n: r.n, by }; };
  const earnedBy = s => db.prepare('SELECT COALESCE(SUM(cents),0) c, COUNT(*) n FROM sitter_pay WHERE sitter_id=?').get(s.id);
  { const append = ledger.append; ledger.append = function (db_, type, subject, data) { const r = append.apply(this, arguments); try { if (type === 'license.requested') setImmediate(() => { try { ask(subject); } catch (e) { console.error('[sitters] ask', e.message); } }); if (type === 'license.granted' && data && data.paid) setImmediate(() => { try { pay(subject); } catch (e) { console.error('[sitters] pay', e.message); } }); } catch (e) { /* */ } return r; }; }

  app.locals.sitters = { sync, gate, credit, block, sitterFor, sittingsOf, ask, waiting, pay, owedOut, earnedBy };
  return app.locals.sitters;
}
module.exports = { mountSitters };
