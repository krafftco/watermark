const ROLE = require('./role');
// Deliveries (Will, 21 Oct: "something like ShootProof where I can deliver photos to a client safely through a watermark
// and a download link; if I send them the link, they can download it without payment"). The maker picks the work (held
// or kept back), names the client, and sends one link. Each photograph is granted to the client as a license of use
// 'delivery' (perpetual, no money; the maker's own terms with the client stand outside the house), so every file leaves
// the house the way every file does: the maker's name, the copyright and the licence number written into it (XMP, the
// mark within the picture, Content Credentials when signing is on), each download counted and told on the register,
// and anyone can check a file at /verify. The link /deliver/<token>: the photographs on a dark wall, one download each
// and all of them as one zip; it closes on the day the maker set (the licences end with it) or when the maker closes it.
// Nothing of the client is public: `delivery.sent` is hidden on the register; the licences' entries say 'delivered'.
// Next: a price (the link becomes a Checkout before the files, through the basket's set path); a PIN; proofing (the
// client picks from a larger set before the maker finishes); the client's own gallery holding what was delivered.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const DAYS = Number(process.env.DELIVERY_DAYS || 30);
const SIZES = { original: 'The 2,400-pixel copy, and the full file too', large: 'The 2,400-pixel copy only' }; // (21 Oct) the copy is what friends download: a couple of megabytes for a phone and for sharing; the full file is a second door
function mountDeliveries(app, { db, C, V, I, mail, ledger, grant, nextRef, mk, q, makerOf, isStudio, originalPath, images, cache, marked, fileName, buyerOf, setBuyer }) {
  const { esc, tidy, date } = V;
  db.exec(`CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, maker_id INTEGER NOT NULL, title TEXT NOT NULL, client_name TEXT NOT NULL, client_email TEXT, note TEXT,
    size TEXT NOT NULL DEFAULT 'original', expires_at TEXT, status TEXT NOT NULL DEFAULT 'open', opens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT);
  CREATE TABLE IF NOT EXISTS delivery_works (delivery_id INTEGER NOT NULL, work_id INTEGER NOT NULL, pos INTEGER NOT NULL DEFAULT 0, ref TEXT NOT NULL, PRIMARY KEY (delivery_id, work_id));`);
  const byToken = db.prepare('SELECT * FROM deliveries WHERE token=?');
  if (!db.prepare("SELECT 1 FROM pragma_table_info('deliveries') WHERE name='share_token'").get()) db.exec('ALTER TABLE deliveries ADD COLUMN share_token TEXT');
  const byShare = db.prepare('SELECT * FROM deliveries WHERE share_token=?');
  // The address to pass on: made once per album, on first need; it shows, it never hands over a file.
  const shareOf = d => { if (d.share_token) return d.share_token; const t = crypto.randomBytes(9).toString('base64url'); db.prepare('UPDATE deliveries SET share_token=? WHERE id=? AND share_token IS NULL').run(t, d.id); d.share_token = byToken.get(d.token).share_token; return d.share_token; };
  // The book the group signs: a line and a name, newest last; the maker may take a line down.
  const bookOf = (d, req, view, can, base, ws) => {
    const lines = db.prepare('SELECT * FROM delivery_notes WHERE delivery_id=? AND removed_at IS NULL ORDER BY id').all(d.id);
    const own = isHost(req, d), priv = isPrivate(d), me = can && can.member;
    const said = { ok: priv ? 'Said.' : 'Signed. Thank you.', no: 'A line and a name, please, and no links.', wait: 'A moment; the book is resting.', closed: 'Only the people inside may speak here.' }[req.query.book] || '';
    const byId = {}; (ws || []).forEach(w => { byId[w.id] = w; });
    const act = `${base}/note`;
    const line = l => { const w = l.work_id && byId[l.work_id]; const mine = me && l.member_id === me.id; return `<li${w ? ' class="dv-lw"' : ''}>${w ? `<a class="dv-lwim" href="#" data-dvo-slug="${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(tidy(w.title))}" loading="lazy"></a>` : ''}<div><p>${esc(l.body)}</p><span>— ${esc(l.name)}${w ? ` · on ${esc(tidy(w.title))}` : ''}${priv ? ` · ${esc(date(l.at))}` : ''}</span>${own || mine ? `<form method="post" action="${base}/note/${l.id}/remove"><button class="link">Take down</button></form>` : ''}</div></li>`; };
    const speak = !can || can.speak;
    return `<section class="dv-book${priv ? ' dv-bench' : ''}" id="book"><p class="k">${priv ? 'The bench' : 'The book'}</p><h2>${priv ? (lines.length ? 'Said among yourselves.' : 'Nothing said yet. Say the first thing.') : lines.length ? 'Signed by the group.' : 'Be the first to sign.'}</h2>${priv ? '<p class="dv-bl">Only the people in this gallery see what is said here.</p>' : ''}${said ? `<p class="dv-said">${esc(said)}</p>` : ''}
<ol class="dv-lines">${lines.map(line).join('')}</ol>
${speak ? `<form method="post" action="${act}" class="dv-bookf" data-dv-bookf><input type="hidden" name="work" value=""><p class="dv-about" data-dv-about hidden>About <b data-dv-about-t></b> <button type="button" class="link" data-dv-about-x>× the whole album</button></p><input name="body" required maxlength="400" placeholder="${priv ? 'Say something to the group' : 'A line about the day, the pictures, the people'}" autocomplete="off">${me ? `<input type="hidden" name="name" value="${esc(me.name)}"><span class="dv-as">as ${esc(first(me.name))}</span>` : `<input name="name" required maxlength="60" placeholder="Your name" autocomplete="given-name">`}<button class="buy-btn">${priv ? 'Say it' : 'Sign'}</button></form>
<script>(function(){var f=document.querySelector('[data-dv-bookf]');if(!f)return;var a=f.querySelector('[data-dv-about]');document.addEventListener('click',function(e){var b=e.target.closest('[data-dv-say]');if(b){f.work.value=b.getAttribute('data-dv-say');a.querySelector('[data-dv-about-t]').textContent=b.getAttribute('data-dv-say-t');a.hidden=false;var o=document.querySelector('.dvo');if(o&&o.parentNode&&history.state&&history.state.dvo)history.back();setTimeout(function(){f.scrollIntoView({behavior:'smooth',block:'center'});f.body.focus();},120);e.preventDefault();}if(e.target.closest('[data-dv-about-x]')){f.work.value='';a.hidden=true;}var t=e.target.closest('[data-dvo-slug]');if(t){e.preventDefault();var g=document.querySelector('figure[data-dv-slug="'+t.getAttribute('data-dvo-slug')+'"] [data-dvo]');if(g)g.click();}});})();</script>` : ''}</section>`;
  };
  db.exec(`CREATE TABLE IF NOT EXISTS delivery_notes (id INTEGER PRIMARY KEY, delivery_id INTEGER NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, ip TEXT, at TEXT NOT NULL DEFAULT (datetime('now')), removed_at TEXT)`);
  const worksOf = d => db.prepare('SELECT w.*, dw.ref, dw.pos FROM delivery_works dw JOIN works w ON w.id=dw.work_id WHERE dw.delivery_id=? ORDER BY dw.pos, w.id').all(d.id);
  // For the thank-you card: the delivery holding this work, if it is live.
  const holds = (token, slug) => { const d = byToken.get(token) || byShare.get(token); if (!d || !live(d)) return null; return worksOf(d).some(w => w.slug === slug) ? d : null; };
  const licOf = ref => db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref);
  // The album as a set to wander (Will, 21 Oct): its photographs, in its order, while the link is live.
  const set = (token, view = false, req = null) => { const d = (view ? byShare : byToken).get(String(token || '')); if (!d || !live(d)) return null; if (view && isPrivate(d) && !(req && capsOf(req, d, true).see)) return null; return { label: d.title, href: view ? `/a/${d.share_token}` : `/deliver/${d.token}`, via: view ? d.share_token : d.token, view, files: view ? null : d.token, works: worksOf(d).map(w => ({ id: w.id, slug: w.slug, title: w.title, width: w.width, height: w.height, maker_id: w.maker_id })) }; };
  const live = d => d.status === 'open' && !(d.expires_at && new Date(d.expires_at) < new Date());
  const url = d => `${C.base}/deliver/${d.token}`;
  const dlCount = d => db.prepare('SELECT COUNT(*) n FROM downloads dl JOIN licenses l ON l.id=dl.license_id JOIN delivery_works dw ON dw.ref=l.ref WHERE dw.delivery_id=?').get(d.id).n;
  // Closing a delivery ends its licences, so the links stop with it.
  function close(d) {
    db.prepare("UPDATE deliveries SET status='closed', closed_at=datetime('now') WHERE id=?").run(d.id);
    const ended = new Date(Date.now() - 1000).toISOString();
    for (const w of worksOf(d)) db.prepare("UPDATE licenses SET ends_at=?, updated_at=datetime('now') WHERE ref=? AND status='active'").run(ended, w.ref);
  }
  // Expired deliveries close themselves, hourly.
  function sweep() { for (const d of db.prepare("SELECT * FROM deliveries WHERE status='open' AND expires_at IS NOT NULL AND expires_at < datetime('now')").all()) close(d); }
  if (ROLE.chores) { setTimeout(sweep, 60e3).unref(); setInterval(sweep, 3600e3).unref(); }
  // The copies of every live album made ahead (90 s after start, one at a time), so a client's Download all never waits on the house.
  const warmAlbums = async () => { for (const d of db.prepare("SELECT * FROM deliveries WHERE status='open'").all()) { if (!live(d)) continue; for (const w of worksOf(d)) { try { await images.derivativeOf(() => originalPath(w), cache, w.slug, 'large', 'jpg'); } catch (e) { /* on the first download instead */ } } } };
  if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') app.locals.governor.boot('warm albums', () => warmAlbums());
  const first = s => String(s || '').trim().split(/\s+/)[0] || '';
  // By text, from the maker's own phone (Will, 1 Nov: "instead of just their email, an option to send it to their phone
  // number"): the house sends no texts of its own; a tap opens the maker's Messages with the link written in, so it comes
  // from a number the friend knows. The phone is kept on the delivery for the maker only, never on a licence or a page.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('deliveries') WHERE name='client_phone'").get()) db.exec('ALTER TABLE deliveries ADD COLUMN client_phone TEXT');
  const phoneOf = x => { const t = String(x || '').trim(); if (!t) return ''; const plus = t.startsWith('+'); const d = t.replace(/\D/g, ''); if (d.length < 7 || d.length > 15) return null; return plus ? '+' + d : d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : d; };
  // The album, after Pic-Time (Will, 2 Nov: "look at Pic-Time's gallery experience, delivery, and beta it"): a cover the
  // whole screen, the roll in scenes by when it was made, a heart on every photograph (the client's favourites, which
  // the maker sees as a count: proofing), favourites downloaded as one, a slideshow with quiet music, and a print from
  // any frame. Hearts belong to a device (`wm_dvh`) or to the signed-in collector, shown only to whoever gave them.
  db.exec(`CREATE TABLE IF NOT EXISTS delivery_hearts (delivery_id INTEGER NOT NULL, work_id INTEGER NOT NULL, who TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (delivery_id, work_id, who))`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('deliveries') WHERE name='cover_slug'").get()) db.exec('ALTER TABLE deliveries ADD COLUMN cover_slug TEXT');
  // Private galleries (Will, 2 Nov: "a photographer could shoot a friend group and those photographs could exist in a
  // private gallery that's not on display for anybody else; the people who have links can do certain things, and the
  // photographer sets the rules: view, download, license; the bench, private, for the group"). An album has a door:
  // 'link' (anyone with the link, as it always was), 'join' (the link asks your name and you are in: the group) or
  // 'invited' (only those the maker, or a member the maker allows, invites; others ask and the maker lets them in).
  // Behind a private door the album's photographs are shown only to the people inside (the /img gate in app.js asks
  // `mayView`), and the rules decide what each may do. The bench is the group's own: lines about the day or about one
  // photograph, signed by the member, seen by no one outside.
  const col = (t, c) => !!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name=?`).get(c);
  if (!col('deliveries', 'door')) db.exec("ALTER TABLE deliveries ADD COLUMN door TEXT NOT NULL DEFAULT 'link'");
  if (!col('deliveries', 'rules')) db.exec('ALTER TABLE deliveries ADD COLUMN rules TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS delivery_members (id INTEGER PRIMARY KEY, delivery_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT, token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'in', invited_by TEXT, buyer_id INTEGER, joined_at TEXT NOT NULL DEFAULT (datetime('now')), seen_at TEXT, visits INTEGER NOT NULL DEFAULT 0)`);
  if (!col('delivery_notes', 'work_id')) db.exec('ALTER TABLE delivery_notes ADD COLUMN work_id INTEGER');
  if (!col('delivery_notes', 'member_id')) db.exec('ALTER TABLE delivery_notes ADD COLUMN member_id INTEGER');
  const DOORS = { link: ['Anyone with the link', 'As it has always been: the link opens it.'], join: ['The group', 'A private gallery: the link asks a name, and they are in. You see who.'], invited: ['By invitation', 'Only the people you invite. Anyone else with the link may ask, and you let them in.'] };
  const RULES = [['download', 'Download the copies', 'The 2,400-pixel copy, right for a phone'], ['full', 'Download the full files', 'For printing; only when the album carries them'], ['keep', 'Keep one in their own gallery', 'Theirs for good, with its papers, ready to print'], ['ask', 'Ask you to license one', 'For a company, a story, a wall: the request comes to you'], ['speak', 'Talk on the bench', 'Lines about the day or one photograph, seen only inside'], ['invite', 'Invite others', 'Members may bring someone in'], ['social', 'Post it', 'A credited copy sized for a feed or a story'], ['pass', 'Pass it on', 'A Share button for the album']];
  const DEF_RULES = { download: 1, full: 0, keep: 1, ask: 1, speak: 1, invite: 0, social: 0, pass: 0 };
  const rulesOf = d => { let r = {}; try { r = JSON.parse(d.rules || '{}') || {}; } catch (e) { /* */ } return Object.assign({}, DEF_RULES, r); };
  const isPrivate = d => d.door === 'join' || d.door === 'invited';
  const PGC = 'wm_pg';
  const tokensOf = req => String((req.cookies || {})[PGC] || '').split('.').filter(t => /^[\w-]{16,40}$/.test(t)).slice(0, 40);
  const admit = (req, res, tok) => { const t = [tok].concat(tokensOf(req).filter(x => x !== tok)).slice(0, 40).join('.'); res.cookie(PGC, t, { maxAge: 400 * 864e5, httpOnly: true, sameSite: 'lax', secure: /^https:/.test(C.base || '') }); if (req.cookies) req.cookies[PGC] = t; };
  const memberIn = (req, d) => {
    const ts = tokensOf(req); let mm = null;
    if (ts.length) mm = db.prepare(`SELECT * FROM delivery_members WHERE delivery_id=? AND status='in' AND token IN (${ts.map(() => '?').join(',')}) ORDER BY id LIMIT 1`).get(d.id, ...ts);
    if (!mm) { const b = buyerOf(req); if (b && b.email) mm = db.prepare("SELECT * FROM delivery_members WHERE delivery_id=? AND status='in' AND lower(email)=? ORDER BY id LIMIT 1").get(d.id, String(b.email).toLowerCase()); }
    return mm || null;
  };
  const isHost = (req, d) => { const me = makerOf(req); return !!(me && me.id === d.maker_id) || isStudio(req); };
  const newToken = () => crypto.randomBytes(18).toString('base64url');
  // The client named on the album is a member of its own group, so the client's link opens the pictures too.
  const clientMember = d => {
    let c = db.prepare("SELECT * FROM delivery_members WHERE delivery_id=? AND invited_by='client' ORDER BY id LIMIT 1").get(d.id);
    if (!c) { db.prepare("INSERT INTO delivery_members (delivery_id, name, email, phone, token, status, invited_by) VALUES (?,?,?,?,?,'in','client')").run(d.id, d.client_name, d.client_email || null, d.client_phone || null, newToken()); c = db.prepare("SELECT * FROM delivery_members WHERE delivery_id=? AND invited_by='client' ORDER BY id LIMIT 1").get(d.id); }
    return c;
  };
  // What this visitor may do here. The host (the maker, the Studio) everything; the client's link everything the album
  // carries; behind a private door a member what the rules allow; behind the open door the shared link shows, never hands over.
  function capsOf(req, d, view) {
    const r = rulesOf(d), fullOk = allowsFull(d);
    if (isHost(req, d)) return { see: true, download: true, full: fullOk, keep: true, ask: false, speak: true, invite: true, social: true, pass: true, host: true, member: null };
    if (!view) return { see: true, download: true, full: fullOk, keep: true, ask: !!r.ask, speak: true, invite: isPrivate(d) && !!r.invite, social: true, pass: true, client: true, member: isPrivate(d) ? clientMember(d) : null };
    if (!isPrivate(d)) return { see: true, download: false, full: false, keep: false, ask: !!r.ask, speak: true, invite: false, social: true, pass: true, member: null };
    const mm = memberIn(req, d); if (!mm) return { see: false };
    return { see: true, download: !!r.download, full: !!(r.download && r.full && fullOk), keep: !!r.keep, ask: !!r.ask, speak: !!r.speak, invite: !!r.invite, social: !!r.social, pass: !!r.pass, look: !r.download && !r.social && !r.pass && !r.keep, member: mm };
  }
  const membersOf = d => db.prepare("SELECT * FROM delivery_members WHERE delivery_id=? AND status IN ('in','asked') ORDER BY status DESC, id").all(d.id);
  const inviteLink = mm => `${C.base}/in/${mm.token}`;
  function invite(d, x, by) {
    const name = String(x.name || '').trim().slice(0, 120), email = String(x.email || '').trim().toLowerCase().slice(0, 160), phone = phoneOf(x.phone);
    if (!name) return { error: 'A name, please.' };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email will not do.' };
    if (phone === null) return { error: 'That phone number will not do.' };
    let mm = email ? db.prepare("SELECT * FROM delivery_members WHERE delivery_id=? AND lower(email)=? AND status<>'out'").get(d.id, email) : null;
    if (mm && mm.status === 'asked') { db.prepare("UPDATE delivery_members SET status='in', invited_by=? WHERE id=?").run(by, mm.id); mm = db.prepare('SELECT * FROM delivery_members WHERE id=?').get(mm.id); }
    if (!mm) { const id = Number(db.prepare("INSERT INTO delivery_members (delivery_id, name, email, phone, token, status, invited_by) VALUES (?,?,?,?,?,'in',?)").run(d.id, name, email || null, phone || null, newToken(), by).lastInsertRowid); mm = db.prepare('SELECT * FROM delivery_members WHERE id=?').get(id); }
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id);
    if (mm.email) mail.send({ to: mm.email, subject: `You are invited: ${d.title}, photographs by ${m.name}`, text: `${first(mm.name)},\n\nYou are invited into "${d.title}", a private gallery of photographs by ${m.name}. Only the people invited can see it.\n\n${inviteLink(mm)}\n\nThe link is yours; it lets you in on any device.\n\nWatermark, for ${m.name}`, feature: 'A private gallery', cta: { label: 'Come in', url: inviteLink(mm) } });
    try { ledger.append(db, 'gallery.invited', d.token.slice(0, 6), { by: String(by).split(':')[0] }); } catch (e) { /* */ }
    return { mm };
  }
  const inviteSms = (mm, d, m) => `sms:${mm.phone || ''}?&body=${encodeURIComponent(`${first(mm.name) ? first(mm.name) + ', ' : ''}you are invited into ${d.title}, photographs by ${m.name}: ${inviteLink(mm)}`)}`;
  // The /img gate: a photograph kept back in a private gallery is shown only to its maker, the Studio, a curator, someone
  // who holds a licence on it, and the people inside one of the private galleries that hold it.
  const guarded = workId => !!db.prepare("SELECT 1 FROM delivery_works dw JOIN deliveries d ON d.id=dw.delivery_id WHERE dw.work_id=? AND d.door IN ('join','invited') AND d.status='open' LIMIT 1").get(workId);
  function mayView(req, w) {
    const me = makerOf(req); if ((me && me.id === w.maker_id) || isStudio(req)) return true;
    const b = buyerOf(req); if (b && b.id && db.prepare("SELECT 1 FROM licenses WHERE work_id=? AND buyer_id=? AND status='active' LIMIT 1").get(w.id, b.id)) return true;
    const ts = tokensOf(req);
    if (ts.length && db.prepare(`SELECT 1 FROM delivery_members mm JOIN delivery_works dw ON dw.delivery_id=mm.delivery_id WHERE dw.work_id=? AND mm.status='in' AND mm.token IN (${ts.map(() => '?').join(',')}) LIMIT 1`).get(w.id, ...ts)) return true;
    if (b && b.email && db.prepare("SELECT 1 FROM delivery_members mm JOIN delivery_works dw ON dw.delivery_id=mm.delivery_id WHERE dw.work_id=? AND mm.status='in' AND lower(mm.email)=? LIMIT 1").get(w.id, String(b.email).toLowerCase())) return true;
    return false;
  }
  // The private galleries this visitor is in (for the Keys and Yours).
  function galleriesOf(req) {
    const ts = tokensOf(req), b = buyerOf(req), seen = new Map();
    const add = rows => rows.forEach(r => { if (!seen.has(r.id)) seen.set(r.id, r); });
    if (ts.length) add(db.prepare(`SELECT d.*, mm.name AS as_name FROM delivery_members mm JOIN deliveries d ON d.id=mm.delivery_id WHERE mm.status='in' AND mm.token IN (${ts.map(() => '?').join(',')})`).all(...ts));
    if (b && b.email) add(db.prepare("SELECT d.*, mm.name AS as_name FROM delivery_members mm JOIN deliveries d ON d.id=mm.delivery_id WHERE mm.status='in' AND lower(mm.email)=?").all(String(b.email).toLowerCase()));
    return [...seen.values()].filter(d => isPrivate(d) && live(d)).map(d => { const m = db.prepare('SELECT name FROM makers WHERE id=?').get(d.maker_id); const c = coverOf(d); const said = db.prepare('SELECT COUNT(*) n FROM delivery_notes WHERE delivery_id=? AND removed_at IS NULL').get(d.id).n; return { title: d.title, maker: m ? m.name : '', href: `/a/${shareOf(d)}`, bench: `/a/${shareOf(d)}#book`, cover: c ? `/img/${c.slug}/thumb` : null, n: nOf(d), people: db.prepare("SELECT COUNT(*) n FROM delivery_members WHERE delivery_id=? AND status='in'").get(d.id).n, said }; });
  }
  app.get('/api/my-galleries', (req, res) => { res.set('Cache-Control', 'private, no-store'); res.json({ galleries: galleriesOf(req) }); });
  const heartWho = (req, res) => { const b = buyerOf(req); if (b && b.id) return 'b:' + b.id; let v = req.cookies && req.cookies.wm_dvh; if (!/^[\w-]{12,40}$/.test(v || '')) { v = crypto.randomBytes(12).toString('base64url'); if (res) res.cookie('wm_dvh', v, { maxAge: 400 * 864e5, httpOnly: true, sameSite: 'lax' }); if (req.cookies) req.cookies.wm_dvh = v; } return 'v:' + v; };
  const heartsOf = (d, who) => new Set(db.prepare('SELECT work_id FROM delivery_hearts WHERE delivery_id=? AND who=?').all(d.id, who).map(r => r.work_id));
  const heartCounts = d => { const o = {}; db.prepare('SELECT work_id, COUNT(*) n FROM delivery_hearts WHERE delivery_id=? GROUP BY work_id').all(d.id).forEach(r => { o[r.work_id] = r.n; }); return o; };
  // Scenes: the roll is cut where an hour passes with nothing taken, or the day turns; named by the part of the day.
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.5 0 5.5 3.5 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const VER = (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 8);
  const PART = h => h < 5 ? 'The small hours' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
  const tsOf = w => { if (!w.taken_at) return null; const s = String(w.taken_at).replace(' ', 'T'); const x = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z'); return isNaN(x) ? null : x; };
  function scenesOf(ws) {
    if (ws.length < 8 || ws.some(w => tsOf(w) == null)) return null;
    const out = []; let cur = null, last = null;
    for (const w of ws) { const x = tsOf(w), dt = new Date(x), day = dt.toISOString().slice(0, 10);
      if (!cur || x - last > 60 * 60e3 || day !== cur.day) { cur = { day, hour: dt.getUTCHours(), list: [] }; out.push(cur); }
      cur.list.push(w); last = x; }
    if (out.length < 2) return null;
    const days = new Set(out.map(c => c.day)).size, seen = {};
    out.forEach((c, i) => { c.name = PART(c.hour); const k = c.day + c.name; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) c.name += ', later'; c.when = days > 1 ? new Date(c.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : ''; c.id = 's' + (i + 1); });
    return out;
  }
  const textOf = (d, m) => `${first(d.client_name) ? first(d.client_name) + ', ' : ''}${d.title}: photographs by ${m.name}. ${url(d)}`;
  const smsHref = (d, m) => `sms:${d.client_phone || ''}?&body=${encodeURIComponent(textOf(d, m))}`;
  const textBtn = (d, m, cls = 'buy-btn') => `<a class="${cls} dv-text" href="${esc(smsHref(d, m))}">Text it${d.client_phone ? ` to ${esc(d.client_phone)}` : ''}</a>`;

  // The maker's desk (2 Nov, docs/DESIGN.md: a tool speaks in plain verbs, one job a screen). Albums as cards, New album
  // on its own page (the few things needed now, the rest folded), and each album's own page: Preview · Share · Text ·
  // Copy link · Add · Close, the cover chosen by a tap, the scenes named, photographs added or taken out.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('deliveries') WHERE name='scene_names'").get()) db.exec('ALTER TABLE deliveries ADD COLUMN scene_names TEXT');
  const sceneNames = d => { try { return JSON.parse(d.scene_names || '{}') || {}; } catch (e) { return {}; } };
  const mine = (req, id) => { const m = makerOf(req); if (!m) return {}; const d = db.prepare('SELECT * FROM deliveries WHERE id=? AND maker_id=?').get(+id, m.id); return { m, d }; };
  const nOf = d => db.prepare('SELECT COUNT(*) n FROM delivery_works WHERE delivery_id=?').get(d.id).n;
  const heartsN = d => db.prepare('SELECT COUNT(*) n FROM delivery_hearts WHERE delivery_id=?').get(d.id).n;
  const coverOf = d => { const ws = worksOf(d); return ws.find(w => w.slug === d.cover_slug) || ws.slice().sort((a, b) => (b.curated || 0) - (a.curated || 0) || (b.stars || 0) - (a.stars || 0))[0]; };
  const SORTS = [['newest', 'Last upload first'], ['place', 'By place'], ['title', 'By title'], ['stars', 'By stars']];
  const sortSql = k => ({ newest: 'w.id DESC', place: 'w.place IS NULL, w.place, w.id DESC', title: 'lower(w.title)', stars: 'w.stars DESC, w.id DESC' }[k] || 'w.id DESC');
  const tool = (href, ic, word, extra = '') => `<a class="dvd-b" href="${href}"${extra}>${ic || ''}<span>${word}</span></a>`;
  // The photographs to choose from (held and kept back alike), with a word filter, sorts and Select all shown.
  function picker(m, req, base, skip = new Set()) {
    const sortNow = SORTS.some(x => x[0] === req.query.sort) ? String(req.query.sort) : 'newest';
    const works = db.prepare(`SELECT w.id, w.slug, w.title, w.place, w.status, w.stars FROM works w WHERE w.maker_id=? AND w.status IN ('held','hidden') ORDER BY ${sortSql(sortNow)}`).all(m.id).filter(w => !skip.has(w.id));
    return `<div class="dvd-pk"><p class="dvd-pkbar"><input type="search" class="dv-find" placeholder="Find by word" data-dv-find> <span class="dv-sort">${SORTS.map(([k, n]) => `<a href="${base}${base.includes('?') ? '&' : '?'}sort=${k}#pick"${sortNow === k ? ' aria-current="page"' : ''}>${n}</a>`).join(' · ')}</span> <button type="button" class="link" data-dv-all>Select all shown</button> <button type="button" class="link" data-dv-none>None</button> <b data-dv-count></b></p>
<div class="dv-pick" id="pick" data-dv-pick>${works.length ? works.map((w, i, arr) => `${sortNow === 'place' && (i === 0 || (arr[i - 1].place || '') !== (w.place || '')) ? `<p class="dv-ph">${esc(w.place || 'No place')}</p>` : ''}<label class="dv-w" data-t="${esc((w.title + ' ' + (w.place || '')).toLowerCase())}"><input type="checkbox" name="works" value="${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span>${esc(tidy(w.title))}${w.status === 'hidden' ? ' <i>kept back</i>' : ''}${w.stars ? ` <i>${'★'.repeat(w.stars)}</i>` : ''}</span></label>`).join('') : '<p class="note">Nothing more to add: every photograph in your vault is in this album.</p>'}</div></div>`;
  }
  const PICK_JS = `<script>(function(){var f=document.querySelector('[data-dv-find]'),p=document.querySelector('[data-dv-pick]'),c=document.querySelector('[data-dv-count]');function count(){if(!c||!p)return;var n=p.querySelectorAll('input:checked').length;c.textContent=n?n+' selected':'';}if(f&&p)f.addEventListener('input',function(){var v=f.value.trim().toLowerCase();[].forEach.call(p.querySelectorAll('.dv-w'),function(l){l.hidden=!!v&&l.getAttribute('data-t').indexOf(v)<0});});if(p){p.addEventListener('change',count);var a=document.querySelector('[data-dv-all]'),no=document.querySelector('[data-dv-none]');if(a)a.addEventListener('click',function(){[].forEach.call(p.querySelectorAll('.dv-w'),function(l){if(!l.hidden)l.querySelector('input').checked=true});count();});if(no)no.addEventListener('click',function(){[].forEach.call(p.querySelectorAll('input'),function(i){i.checked=false});count();});}document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');if(!b)return;e.preventDefault();var t=b.querySelector('span')||b;navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){t.textContent='Copied'});});})();</script>`;
  app.get('/account/deliveries', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?to=' + encodeURIComponent('/account/deliveries'));
    const rows = db.prepare('SELECT * FROM deliveries WHERE maker_id=? ORDER BY id DESC LIMIT 200').all(m.id);
    const ok = req.query.ok ? String(req.query.ok) : '';
    // An old link with ?sent= lands on the album's own page.
    if (req.query.sent) { const d = byToken.get(String(req.query.sent)); if (d && d.maker_id === m.id) return res.redirect(`/account/deliveries/${d.id}?sent=1`); }
    res.send(V.layout({ title: 'Albums · Watermark', path: '/account/deliveries', studio: true, body: `<section class="studio-wrap dvd"><header class="dvd-h"><div><p class="k">Your studio</p><h1>Albums.</h1><p class="dvd-l">Send a shoot to a client: one link, every file carrying your name.</p></div><a class="buy-btn dvd-new" href="/account/deliveries/new">${I.plus || ''}<span>New album</span></a></header>${ok ? `<p class="dvd-ok">${esc(ok)}</p>` : ''}
${rows.length ? `<div class="dvd-cards">${rows.map(d => { const c = coverOf(d), n = nOf(d), h = heartsN(d), on = live(d); return `<a class="dvd-card${on ? '' : ' dvd-off'}" href="/account/deliveries/${d.id}">${c ? `<img src="/img/${esc(c.slug)}/screen" alt="" loading="lazy">` : '<span class="dvd-noim"></span>'}<span class="dvd-ct"><b>${esc(d.title)}</b><span>For ${esc(d.client_name)} · ${esc(date(d.created_at))}</span><span>${n} photograph${n === 1 ? '' : 's'} · opened ${d.opens} · ♥ ${h}</span><em>${on ? (d.expires_at ? `Open until ${esc(date(d.expires_at))}` : 'Open') : 'Closed'}</em></span></a>`; }).join('')}</div>` : `<div class="dvd-empty"><p>No albums yet. Your first is a minute away: name it, choose the photographs, send the link.</p><a class="buy-btn" href="/account/deliveries/new">New album</a></div>`}
</section>` }));
  });
  app.get('/account/deliveries/new', (req, res) => {
    const m = makerOf(req); if (!m) return res.redirect('/signin?to=' + encodeURIComponent('/account/deliveries/new'));
    const ok = req.query.ok ? String(req.query.ok) : '';
    res.send(V.layout({ title: 'New album · Watermark', path: '/account/deliveries', studio: true, body: `<section class="studio-wrap dvd"><a class="dvd-back" href="/account/deliveries">${I.back || ''}<span>Albums</span></a><h1>New album.</h1>${ok ? `<p class="dvd-ok">${esc(ok)}</p>` : ''}
<form method="post" action="/account/deliveries" class="dv-f dvd-f"><div class="dvd-two"><label><span>Name it</span><input name="title" required maxlength="120" placeholder="The wedding, the June shoot" autofocus></label><label><span>For</span><input name="client" required maxlength="120" placeholder="Their name"></label><label><span>Their phone <i>you text it from yours</i></span><input type="tel" name="phone" inputmode="tel" autocomplete="tel" maxlength="24" placeholder="+1 212 555 0100"></label><label><span>Their email <i>the house writes to them</i></span><input type="email" name="email" maxlength="160"></label><label><span>Who can see it</span><select name="door">${Object.entries(DOORS).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join('')}</select></label></div>
<details class="dvd-more"><summary>More: a note, when it closes, the files</summary><div class="dvd-two"><label class="dv-notef"><span>A note to them</span><textarea name="note" rows="2" maxlength="600"></textarea></label><label><span>Closes in</span><select name="days"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="365">A year</option><option value="0">Never</option></select></label><label><span>The files</span><select name="size">${Object.entries(SIZES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label></div></details>
<h2 class="dvd-h2">Select the photographs</h2>${picker(m, req, '/account/deliveries/new')}
<p class="dvd-go"><button class="buy-btn">Make the album</button> <span class="note">Free to them. Each photograph is licensed to them with your name and its number written into the file.</span></p></form>${PICK_JS}</section>` }));
  });
  app.get('/account/deliveries/:id', (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return next();
    const { m, d } = mine(req, req.params.id); if (!m) return res.redirect('/signin?to=' + encodeURIComponent(req.originalUrl)); if (!d) return res.sendStatus(404);
    const ws = worksOf(d), on = live(d), counts = heartCounts(d), cover = coverOf(d), sc = scenesOf(ws), names = sceneNames(d);
    const ok = req.query.ok ? String(req.query.ok) : '', sent = req.query.sent === '1', link = url(d), sh = shareOf(d);
    const spare = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status IN ('held','hidden')").get(m.id).n > ws.length;
    res.send(V.layout({ title: `${d.title} · Albums · Watermark`, path: '/account/deliveries', studio: true, body: `<section class="studio-wrap dvd"><a class="dvd-back" href="/account/deliveries">${I.back || ''}<span>Albums</span></a>
<header class="dvd-ah">${cover ? `<img src="/img/${esc(cover.slug)}/screen" alt="">` : ''}<div><h1>${esc(d.title)}</h1><p class="dvd-l">For ${esc(d.client_name)} · ${esc(date(d.created_at))} · ${ws.length} photograph${ws.length === 1 ? '' : 's'} · ${on ? (d.expires_at ? `Open until ${esc(date(d.expires_at))}` : 'Open') : 'Closed'}</p><p class="dvd-st">Opened ${d.opens} · downloads ${dlCount(d)} · ${(t => `♥ ${t} favourite${t === 1 ? '' : 's'}`)(Object.values(counts).reduce((a, b) => a + b, 0))}</p></div></header>
${sent ? `<p class="dvd-ok">Made. Send it: Text it from your phone, or Share and choose where.${d.client_email ? ` The house has written to ${esc(d.client_email)}.` : ''}</p>` : ok ? `<p class="dvd-ok">${esc(ok)}</p>` : ''}
${on ? `<nav class="dvd-bar" aria-label="This album">${tool(`/deliver/${esc(d.token)}`, I.eye, 'Preview', ' target="_blank" rel="noopener"')}<button type="button" class="dvd-b" data-send data-send-title="${esc(d.title)}" data-send-text="${esc(`${d.title}, photographs by ${m.name}`)}" data-send-url="${esc(link)}">${I.share || ''}<span>Share</span></button>${tool(esc(smsHref(d, m)), I.send, 'Text')}<button type="button" class="dvd-b" data-copy="${esc(link)}">${I.page || ''}<span>Copy link</span></button>${spare ? tool('#add', I.plus, 'Add') : ''}<form method="post" action="/account/deliveries/${d.id}/close" onsubmit="return confirm('Close this album? The link stops working and its licences end.')"><button class="dvd-b">${I.close || ''}<span>Close</span></button></form></nav>
<p class="dvd-link"><input readonly value="${esc(link)}" onclick="this.select()" aria-label="The album's link"><span class="note">${isPrivate(d) ? `The link with downloads, for ${esc(first(d.client_name))}. The group's door: <a href="/a/${esc(sh)}" target="_blank" rel="noopener">${esc(C.base)}/a/${esc(sh)}</a>${d.door === 'join' ? ' (they give a name to come in)' : ' (they ask; you let them in)'}.` : `The link with downloads, for them. To pass it round a group without the files: <a href="/a/${esc(sh)}" target="_blank" rel="noopener">the album to share</a>.`}</span></p>` : '<p class="dvd-l">This album is closed. Its link no longer opens.</p>'}
${on ? deskDoor(d, m, req) : ''}
<h2 class="dvd-h2">Photographs <span>Tap ☆ to make one the cover</span></h2>
<div class="dvd-grid">${ws.map(w => `<figure class="dvd-w${cover && cover.id === w.id ? ' dvd-cov' : ''}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy">${counts[w.id] ? `<span class="dvd-hn">♥ ${counts[w.id]}</span>` : ''}<figcaption><span>${esc(tidy(w.title))}</span>${on ? `<form method="post" action="/account/deliveries/${d.id}/cover"><input type="hidden" name="slug" value="${esc(w.slug)}"><button class="dvd-i" title="${cover && cover.id === w.id ? 'The cover' : 'Make it the cover'}" aria-label="Make it the cover">${cover && cover.id === w.id ? '★' : '☆'}</button></form><form method="post" action="/account/deliveries/${d.id}/remove" onsubmit="return confirm('Take this photograph out of the album? It stays in your vault.')"><input type="hidden" name="slug" value="${esc(w.slug)}"><button class="dvd-i" title="Remove from this album" aria-label="Remove">×</button></form>` : ''}</figcaption></figure>`).join('')}</div>
${on && sc ? `<h2 class="dvd-h2">Scenes <span>Named by the time of day; rename them as you like</span></h2><form method="post" action="/account/deliveries/${d.id}/scenes" class="dvd-sc">${sc.map(c => `<label><img src="/img/${esc(c.list[0].slug)}/thumb" alt=""><span>${c.list.length} photograph${c.list.length === 1 ? '' : 's'}${c.when ? ` · ${esc(c.when)}` : ''}</span><input name="n_${esc(c.list[0].slug)}" value="${esc(names[c.list[0].slug] || '')}" placeholder="${esc(c.name)}" maxlength="60"></label>`).join('')}<p><button class="buy-btn">Save the names</button></p></form>` : ''}
${on ? `<details class="dvd-more dvd-ed"><summary>Edit the name and the note</summary><form method="post" action="/account/deliveries/${d.id}/edit" class="dvd-two"><label><span>Name</span><input name="title" required maxlength="120" value="${esc(d.title)}"></label><label class="dv-notef"><span>The note</span><textarea name="note" rows="2" maxlength="600">${esc(d.note || '')}</textarea></label><p><button class="buy-btn">Save</button></p></form></details>
${spare ? `<form method="post" action="/account/deliveries/${d.id}/add" class="dv-f" id="add"><h2 class="dvd-h2">Add photographs</h2>${picker(m, req, `/account/deliveries/${d.id}`, new Set(ws.map(w => w.id)))}<p class="dvd-go"><button class="buy-btn">Add to the album</button></p></form>` : ''}${PICK_JS}` : ''}
</section>` }));
  });
  // The album's own acts.
  app.post('/account/deliveries/:id/cover', (req, res) => {
    const { m, d } = mine(req, req.params.id); if (!m) return res.sendStatus(401); if (!d) return res.sendStatus(404);
    const w = worksOf(d).find(x => x.slug === String((req.body || {}).slug)); if (!w) return res.sendStatus(404);
    db.prepare('UPDATE deliveries SET cover_slug=? WHERE id=?').run(w.slug, d.id); res.redirect(`/account/deliveries/${d.id}?ok=` + encodeURIComponent('The cover is set.'));
  });
  app.post('/account/deliveries/:id/scenes', (req, res) => {
    const { m, d } = mine(req, req.params.id); if (!m) return res.sendStatus(401); if (!d) return res.sendStatus(404);
    const o = {}; for (const [k, v] of Object.entries(req.body || {})) { if (!k.startsWith('n_')) continue; const t = String(v || '').trim().slice(0, 60); if (t) o[k.slice(2)] = t; }
    db.prepare('UPDATE deliveries SET scene_names=? WHERE id=?').run(JSON.stringify(o), d.id); res.redirect(`/account/deliveries/${d.id}?ok=` + encodeURIComponent('The scenes are named.'));
  });
  app.post('/account/deliveries/:id/edit', (req, res) => {
    const { m, d } = mine(req, req.params.id); if (!m) return res.sendStatus(401); if (!d) return res.sendStatus(404);
    const title = String((req.body || {}).title || '').trim().slice(0, 120); if (!title) return res.redirect(`/account/deliveries/${d.id}?ok=` + encodeURIComponent('A name, please.'));
    db.prepare('UPDATE deliveries SET title=?, note=? WHERE id=?').run(title, String((req.body || {}).note || '').trim().slice(0, 600) || null, d.id); res.redirect(`/account/deliveries/${d.id}?ok=` + encodeURIComponent('Saved.'));
  });
  // Take one out: its licence ends now and the row goes; the photograph stays in the vault.
  app.post('/account/deliveries/:id/remove', (req, res) => {
    const { m, d } = mine(req, req.params.id); if (!m) return res.sendStatus(401); if (!d) return res.sendStatus(404);
    const w = worksOf(d).find(x => x.slug === String((req.body || {}).slug)); if (!w) return res.sendStatus(404);
    db.prepare("UPDATE licenses SET ends_at=?, updated_at=datetime('now') WHERE ref=? AND status='active'").run(new Date(Date.now() - 1000).toISOString(), w.ref);
    db.prepare('DELETE FROM delivery_works WHERE delivery_id=? AND work_id=?').run(d.id, w.id);
    db.prepare('DELETE FROM delivery_hearts WHERE delivery_id=? AND work_id=?').run(d.id, w.id);
    if (d.cover_slug === w.slug) db.prepare('UPDATE deliveries SET cover_slug=NULL WHERE id=?').run(d.id);
    res.redirect(`/account/deliveries/${d.id}?ok=` + encodeURIComponent(`${tidy(w.title)} is out of the album; it stays in your vault.`));
  });
  app.post('/account/deliveries/:id/add', (req, res) => {
    const { m, d } = mine(req, req.params.id); if (!m) return res.sendStatus(401); if (!d) return res.sendStatus(404);
    if (!live(d)) return res.redirect(`/account/deliveries/${d.id}`);
    const n = addWorks(m, d, [].concat((req.body || {}).works || []).map(String).slice(0, 300));
    res.redirect(`/account/deliveries/${d.id}?ok=` + encodeURIComponent(n ? `${n} added.` : 'Select at least one photograph to add.'));
  });
  // One licence a photograph, under the album's use and term; used when the album is made and when photographs are added.
  function addWorks(m, d, slugs) {
    const u = q.use.get(m.id, 'delivery'); if (!u) return 0;
    const have = new Set(worksOf(d).map(w => w.id)); let pos = (db.prepare('SELECT MAX(pos) p FROM delivery_works WHERE delivery_id=?').get(d.id).p ?? -1) + 1, n = 0;
    for (const slug of slugs) {
      const w = db.prepare("SELECT * FROM works WHERE slug=? AND maker_id=? AND status IN ('held','hidden')").get(slug, m.id); if (!w || have.has(w.id)) continue;
      const ref = nextRef();
      db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,intended_use,price_cents,status) VALUES (?,?,?,?,?,?,NULL,'requested')").run(ref, w.id, u.id, d.client_name, '', `Delivered: ${d.title}`.slice(0, 400));
      grant(ref, { paid: false });
      if (d.expires_at) db.prepare('UPDATE licenses SET ends_at=? WHERE ref=?').run(d.expires_at, ref);
      db.prepare('INSERT INTO delivery_works (delivery_id, work_id, pos, ref) VALUES (?,?,?,?)').run(d.id, w.id, pos++, ref); have.add(w.id); n++;
    }
    if (n) setTimeout(async () => { for (const w of worksOf(d)) { try { await images.derivativeOf(() => originalPath(w), cache, w.slug, 'large', 'jpg'); } catch (e) { /* on the first download */ } } }, 50).unref();
    return n;
  }
  app.post('/account/deliveries', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 120), client = String(b.client || '').trim().slice(0, 120), email = String(b.email || '').trim().toLowerCase().slice(0, 160);
    const slugs = [].concat(b.works || []).map(String).slice(0, 300);
    if (!title || !client || !slugs.length) return res.redirect('/account/deliveries/new?ok=' + encodeURIComponent('A name for the album, who it is for, and at least one photograph.'));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect('/account/deliveries/new?ok=' + encodeURIComponent('That email will not do.'));
    const phone = phoneOf(b.phone); if (phone === null) return res.redirect('/account/deliveries/new?ok=' + encodeURIComponent('That phone number will not do.'));
    const u = q.use.get(m.id, 'delivery'); if (!u) return res.redirect('/account/deliveries?ok=' + encodeURIComponent('The delivery use is not set for this studio yet.'));
    const days = Math.max(0, Math.min(3650, +b.days || 0)); const size = SIZES[b.size] ? b.size : 'original';
    const token = crypto.randomBytes(18).toString('base64url');
    const door = DOORS[b.door] ? b.door : 'link';
    const id = Number(db.prepare("INSERT INTO deliveries (token, maker_id, title, client_name, client_email, client_phone, note, size, expires_at, door) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(token, m.id, title, client, email || null, phone || null, String(b.note || '').trim().slice(0, 600) || null, size, days ? new Date(Date.now() + days * 864e5).toISOString() : null, door).lastInsertRowid);
    const d = byToken.get(token); if (isPrivate(d)) clientMember(d); const n = addWorks(m, d, slugs);
    if (!n) { db.prepare('DELETE FROM deliveries WHERE id=?').run(id); return res.redirect('/account/deliveries/new?ok=' + encodeURIComponent('None of those photographs are yours to send.')); }
    try { ledger.append(db, 'delivery.sent', m.handle, { n, size, days }); } catch (e) { /* */ }
    if (email) mail.send({ to: email, subject: `${m.name} has sent you ${n === 1 ? 'a photograph' : `${n} photographs`}: ${title}`, text: `${first(client)},\n\n${m.name} has sent you ${n === 1 ? 'a photograph' : `${n} photographs`}, "${title}".\n\n${url(d)}\n\n${d.note ? d.note + '\n\n' : ''}Each file carries ${m.name}'s name and its licence number inside it; anyone can check a file at ${C.base}/verify.${d.expires_at ? ` The link closes on ${date(d.expires_at)}.` : ''}\n\nWatermark, for ${m.name}` });
    res.redirect(`/account/deliveries/${id}?sent=1`);
  });
  app.post('/account/deliveries/:id/close', (req, res) => {
    const m = makerOf(req); if (!m) return res.sendStatus(401);
    const d = db.prepare('SELECT * FROM deliveries WHERE id=? AND maker_id=?').get(+req.params.id, m.id); if (!d) return res.sendStatus(404);
    close(d); res.redirect('/account/deliveries?ok=' + encodeURIComponent(`${d.title} is closed.`));
  });

  // The client's door.
  // The album in a chat (31 Oct, Will: "how are people going to deliver, to a friend group and chats; this needs to be
  // social"): the link unfurls as a card of the album's own pictures, the title and who made them; the album has a
  // book the group signs (a line and a name, no account); a share sends it on to the group.
  app.get(['/deliver/:token/card.jpg', '/a/:share/card.jpg'], async (req, res) => {
    const d = req.params.share ? byShare.get(String(req.params.share)) : byToken.get(String(req.params.token)); if (!d || !live(d)) return res.sendStatus(404);
    const out = path.join(cache, `album-${d.token.slice(0, 16)}-${d.id}-card.jpg`);
    try {
      if (!fs.existsSync(out)) {
        const sharp = require('sharp'); const ws = worksOf(d).slice(0, 3); const W = 1200, H = 630, n = Math.max(1, ws.length), cw = Math.floor(W / n);
        const tiles = []; for (let i = 0; i < ws.length; i++) { const f = await images.derivativeOf(() => originalPath(ws[i]), cache, ws[i].slug, 'screen', 'jpg'); tiles.push({ input: await sharp(f).resize(cw - (i < n - 1 ? 4 : 0), H, { fit: 'cover', position: 'attention' }).toBuffer(), left: i * cw, top: 0 }); }
        await sharp({ create: { width: W, height: H, channels: 3, background: '#0b0a09' } }).composite(tiles).jpeg({ quality: 86 }).toFile(out);
      }
      res.set('Cache-Control', 'public, max-age=3600').type('image/jpeg').sendFile(out);
    } catch (e) { console.error('[album card]', e.message); res.sendStatus(404); }
  });
  app.post(['/deliver/:token/note', '/a/:share/note'], (req, res) => {
    const d = req.params.share ? byShare.get(String(req.params.share)) : byToken.get(String(req.params.token)); if (!d || !live(d)) return res.sendStatus(404);
    const can = capsOf(req, d, !!req.params.share);
    const back = req.params.share ? `/a/${d.share_token}#book` : `/deliver/${d.token}#book`;
    if (!can.see || !can.speak) return res.redirect(303, back.replace('#', '?book=closed#'));
    const mm = can.member;
    const name = (mm ? mm.name : can.host ? (makerOf(req) || {}).name || 'The Studio' : String(req.body.name || '')).trim().slice(0, 60), body = String(req.body.body || '').trim().slice(0, 400);
    const ww = req.body.work ? worksOf(d).find(x => x.slug === String(req.body.work)) : null;
    if (!name || body.length < 2 || /https?:\/\/|www\./i.test(body)) return res.redirect(303, back.replace('#', '?book=no#'));
    const recent = db.prepare("SELECT COUNT(*) n FROM delivery_notes WHERE delivery_id=? AND ip=? AND at > datetime('now','-10 minutes')").get(d.id, req.ip).n;
    if (recent >= 4) return res.redirect(303, back.replace('#', '?book=wait#'));
    db.prepare('INSERT INTO delivery_notes (delivery_id, name, body, ip, work_id, member_id) VALUES (?,?,?,?,?,?)').run(d.id, name, body, req.ip, ww ? ww.id : null, mm ? mm.id : null);
    if (app.locals.notify) app.locals.notify.tell({ maker_id: d.maker_id, kind: 'note', href: `/deliver/${d.token}#book`, title: `${name} signed ${d.title}`, body: body.slice(0, 140) }).catch(() => {});
    res.redirect(303, back.replace('#', '?book=ok#'));
  });
  app.post(['/deliver/:token/note/:id/remove', '/a/:share/note/:id/remove'], (req, res) => {
    const d = albumOf(req); if (!d) return res.sendStatus(404);
    const l = db.prepare('SELECT * FROM delivery_notes WHERE id=? AND delivery_id=?').get(+req.params.id, d.id); if (!l) return res.sendStatus(404);
    const can = capsOf(req, d, !!req.params.share);
    if (!(isHost(req, d) || (can.member && l.member_id === can.member.id))) return res.sendStatus(403);
    db.prepare("UPDATE delivery_notes SET removed_at=datetime('now') WHERE id=? AND delivery_id=?").run(l.id, d.id); res.redirect(303, req.params.share ? `/a/${d.share_token}#book` : `/deliver/${d.token}#book`);
  });
  // Instax from the album: the exact pixels the printer lays down, for each photograph the album holds.
  app.get('/deliver/:token/:slug/instax', async (req, res) => {
    const d = byToken.get(String(req.params.token)); if (!d || !live(d)) return res.sendStatus(404);
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    try {
      const K = require('./keep'); const out = await K.instaxFile(await originalPath(w), { film: String(req.query.film || 'mini'), mode: req.query.mode === 'fit' ? 'fit' : 'fill', look: String(req.query.look || 'film') });
      const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id); const name = `${tidy(w.title)}, ${m.name} (${out.film.name}).jpg`.replace(/[\/:*?"<>|]/g, '');
      res.set({ 'Content-Type': 'image/jpeg', 'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'private, no-store' }).send(out.buf);
    } catch (e) { console.error('[album instax]', e.message); res.sendStatus(500); }
  });
  function albumPage(d, req, res, view) {
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id);
    res.set('Cache-Control', 'private, no-store');
    if (!live(d)) return res.status(410).send(V.layout({ title: `${d.title} · Watermark`, bare: true, body: `<main class="dv"><section class="dv-wall"><p class="k">From ${esc(m.name)}</p><h1>${esc(d.title)}</h1><p class="dv-lede">This delivery has closed. Write to ${esc(m.name)} for another.</p></section></main>` }));
    const can = capsOf(req, d, view);
    if (!can.see) return doorPage(d, m, req, res);
    if (can.member) { admit(req, res, can.member.token); db.prepare("UPDATE delivery_members SET visits=visits+1, seen_at=datetime('now') WHERE id=?").run(can.member.id); }
    db.prepare('UPDATE deliveries SET opens=opens+1 WHERE id=?').run(d.id);
    const all = worksOf(d); const me = buyerOf(req);
    const SI = app.locals.sitters; const ids = all.map(w => w.id); const withs = SI ? SI.inWorks(ids) : {}; const mine = SI ? SI.mineIn(me, ids) : new Set();
    const onlyMine = req.query.mine === '1' && mine.size; const ws = onlyMine ? all.filter(w => mine.has(w.id)) : all;
    const who = heartWho(req, res), hearts = heartsOf(d, who), mk0 = makerOf(req), isMaker = !!(mk0 && mk0.id === d.maker_id) || isStudio(req), counts = isMaker ? heartCounts(d) : {};
    const scenes = onlyMine ? null : scenesOf(ws); if (scenes) { const nm = sceneNames(d); scenes.forEach(c => { const t = nm[c.list[0].slug]; if (t) c.name = t; }); }
    const cover = ws.find(w => w.slug === d.cover_slug) || ws.slice().sort((a, b) => (b.curated || 0) - (a.curated || 0) || (b.stars || 0) - (a.stars || 0) || ((b.width || 0) > (b.height || 0)) - ((a.width || 0) > (a.height || 0)))[0];
    // On the grid a photograph carries the heart and nothing else (docs/DESIGN.md: one control on a grid); a tap opens
    // the photograph's own view (album.js), which reads its acts from the figcaption: Download · Share (Post, Story,
    // Message) · Print · More (Keep it, Full size, That's me, That's a friend, Wander from here).
    const fig = w => { const l = licOf(w.ref); const nm = esc(tidy(w.title)); return `<figure class="dv-w" data-dv-slug="${esc(w.slug)}"${hearts.has(w.id) ? ' data-hearted' : ''}><a href="${wander}&at=${esc(w.slug)}" class="dv-im" data-dvo><img src="/img/${esc(w.slug)}/screen" alt="${nm}" loading="lazy" decoding="async"${w.width && w.height ? ` width="${w.width}" height="${w.height}"` : ''}></a><button type="button" class="dvh-b" data-dvh="${esc(w.slug)}" aria-pressed="${hearts.has(w.id)}" aria-label="Favourite" title="Favourite">${HEART}</button>${isMaker && counts[w.id] ? `<span class="dvh-n" title="Favourited by ${counts[w.id]}">♥ ${counts[w.id]}</span>` : ''}<figcaption><b>${nm}</b>${w.place ? `<i>${esc(w.place)}</i>` : ''}${withs[w.id] ? `<span class="dv-with">With ${withs[w.id].map(esc).join(', ')}</span>` : ''}
<span class="dvx">${!can.download ? '' : `<a class="dvx-b" href="${base}/${esc(w.slug)}/file" download>${I.in || ''}<span>Download</span></a>`}${can.social || can.pass ? `<button type="button" class="dvx-b" data-dvx="share">${I.share || ''}<span>Share</span></button>` : ''}${!view && l && l.download_token ? `<a class="dvx-b dv-print" href="/yours/p/${esc(l.ref)}?k=${esc(l.download_token)}#print">${I.print || ''}<span>Print</span></a>` : ''}<button type="button" class="dvx-b" data-dvx="more">${I.more || ''}<span>More</span></button></span>
<span class="dvx-sh" data-dvx-p="share" hidden>${can.social ? `<button type="button" class="dvx-o" data-dv-story="${base}/${esc(w.slug)}/post.jpg" data-dv-story-name="${nm}" data-dv-story-kind="post"><b>Post</b><i>For a feed, 4:5, credited</i></button><button type="button" class="dvx-o" data-dv-story="${base}/${esc(w.slug)}/story.jpg" data-dv-story-name="${nm}" data-dv-story-kind="story"><b>Story</b><i>Full height, 9:16, credited</i></button>` : ''}${can.pass ? `<button type="button" class="dvx-o" data-send data-send-title="${esc(d.title)}" data-send-text="${esc(`${d.title}, photographs by ${m.name}`)}" data-send-url="${esc(`${C.base}/a/${sh}`)}"><b>Message</b><i>The album's link: they see it, the files stay with you</i></button>` : ''}</span>
<span class="dvx-mo dv-me" data-dvx-p="more" hidden>${can.keep ? `<button type="button" class="dv-keep" data-dv-keep="${esc(w.slug)}">Keep it</button>` : ''}${can.full ? `<a class="dv-full" href="${base}/${esc(w.slug)}/file?full=1" download title="The full file, for printing">Full size</a>` : ''}${can.speak ? `<a class="link" href="#book" data-dv-say="${esc(w.slug)}" data-dv-say-t="${nm}">Talk about it</a>` : ''}${can.ask ? `<a class="link" href="${base}/${esc(w.slug)}/ask">Ask to license it</a>` : ''}${mine.has(w.id) ? '<em>You are in it</em>' : `<button type="button" class="link" data-dv-me="${esc(w.slug)}">That&rsquo;s me</button>`}<button type="button" class="link" data-dv-friend="${esc(w.slug)}">That&rsquo;s a friend</button><a class="link" href="${wander}&at=${esc(w.slug)}">Wander from here</a></span></figcaption></figure>`; };
    const sh = shareOf(d); const base = view ? `/a/${esc(sh)}` : `/deliver/${esc(d.token)}`; const wander = view ? `/wander?in=album:${esc(sh)}` : `/wander?in=delivery:${esc(d.token)}`, logo = `<a class="dv-logo" href="/" aria-label="Watermark"><img src="/static/watermark-logo.svg" alt="Watermark" width="150" height="40"></a>`;
    res.send(V.layout({ title: `${d.title} · ${m.name}`, bare: true, desc: `${ws.length === 1 ? 'A photograph' : ws.length + ' photographs'} by ${m.name}. ${view ? 'Shared from' : 'Delivered with'} Watermark.`, path: `/a/${sh}`, image: `/a/${sh}/card.jpg`, body: `<main class="dv"${scenes ? ' data-dv-scenes' : ''}>${cover ? `<section class="dvc"><img class="dvc-im" src="/img/${esc(cover.slug)}/large" srcset="/img/${esc(cover.slug)}/large 2400w, /img/${esc(cover.slug)}/wall 3840w" sizes="100vw" alt="" fetchpriority="high"><div class="dvc-t">${logo}<p class="k">From ${esc(m.name)}${view ? '' : ` · for ${esc(d.client_name)}`}<span class="dvc-beta">Album · beta</span></p><h1>${esc(d.title)}</h1><p class="dvc-line">${ws.length === 1 ? 'A photograph' : `${ws.length} photographs`}${scenes ? ` in ${scenes.length} scenes` : ''}</p><p class="dvc-acts"><a class="dvc-go" href="#album">View the album</a><button type="button" class="dvc-play" data-dvp-open>${I.play || ''}<span>Play it</span></button></p></div></section>` : ''}<section class="dv-wall" id="album">
<header class="dv-h">${logo}<p class="k">From ${esc(m.name)}${view ? '' : ` · for ${esc(d.client_name)}`}</p><h1>${esc(d.title)}</h1>
<p class="dv-gift">${ws.length === 1 ? 'A photograph' : `${ws.length} photographs`}${scenes ? ` in ${scenes.length} scenes` : ''} by ${esc(m.name)}, ${view ? 'shared with you' : 'made for you and yours to keep'}. Each carries ${esc(first(m.name))}’s name inside it, the way a print carries a signature.${!view && d.expires_at ? ` The link closes ${esc(date(d.expires_at))}.` : ''}</p>
${d.note ? `<blockquote class="dv-note"><p>${esc(d.note)}</p><footer>— ${esc(first(m.name))}</footer></blockquote>` : ''}
${mine.size ? `<p class="dv-you">You are in ${mine.size} of these. ${onlyMine ? `<a href="${base}">Show them all</a>` : `<a href="${base}?mine=1">Show only yours</a>`}</p>` : ''}</header>
<nav class="dvt" aria-label="The album"><button type="button" class="dvt-b dvh-f" data-dvh-filter aria-pressed="false">${HEART}<span>Favourites <b data-dvh-count>${hearts.size}</b></span></button><button type="button" class="dvt-b" data-dvp-open>${I.play || ''}<span>Play</span></button><a class="dvt-b dv-wander" href="${wander}" title="Wander through them, one at a time, edge to edge">${V.WAVE_MARK || ''}<span>Wander</span></a>${can.download ? `<button type="button" class="dvt-b" data-dvt="dl">${I.in || ''}<span>Download</span></button>` : ''}${can.invite && isPrivate(d) ? `<a class="dvt-b" href="#people">${I.plus || ''}<span>Invite</span></a>` : ''}${can.pass ? `<button type="button" class="dvt-b" data-send data-send-title="${esc(d.title)}" data-send-text="${esc(`${ws.length === 1 ? 'A photograph' : ws.length + ' photographs'} by ${m.name}`)}" data-send-url="${esc(`${C.base}/a/${sh}`)}" title="${isPrivate(d) ? (d.door === 'join' ? 'Share the link: whoever opens it gives their name to come in' : 'Share the link: whoever opens it can ask to come in') : 'Share with the group: they see every picture and sign the book; the downloads stay with you'}">${I.share || ''}<span>Share</span></button>` : ''}</nav>
${!can.download ? '' : `<div class="dvt-sheet" data-dvt-p="dl" hidden><a href="${base}/all.zip"><b>Download all ${ws.length === 1 ? '' : `(${ws.length})`}</b><i>2,400 pixels, a few megabytes each: right for a phone and for sharing</i></a><a data-dvh-dl href="${base}/all.zip?fav=1"${hearts.size ? '' : ' hidden'}><b>Download your favourites</b><i>Only the ones with a heart</i></a>${can.full ? `<a href="${base}/all.zip?full=1"><b>The full files</b><i>${esc(fullSize(ws))}, for printing</i></a>` : ''}</div>`}
${isMaker ? `<p class="dvh-mk">Only you see this: ${Object.values(counts).reduce((a, b) => a + b, 0)} favourites given across the album; each photograph shows its count.</p>` : ''}
${scenes ? `<nav class="dvs-nav" aria-label="Scenes">${scenes.map(c => `<a href="#${c.id}">${esc(c.name)}${c.when ? ` <small>${esc(c.when)}</small>` : ''}</a>`).join('')}</nav>${scenes.map(c => `<section class="dvs" id="${c.id}"><h2>${esc(c.name)}${c.when ? ` <small>${esc(c.when)}</small>` : ''}<span>${c.list.length}</span></h2><div class="dv-grid">${c.list.map(fig).join('')}</div></section>`).join('')}` : `<div class="dv-grid">${ws.map(fig).join('')}</div>`}<p class="dvh-none" data-dvh-none hidden>No favourites yet. Tap the heart on any photograph.</p>
<form class="dv-tag" data-dv-tag data-base="${base}" hidden><p class="dv-tag-t" data-dv-tag-t></p>${me && me.email ? `<p class="dv-tag-me" data-dv-asme>As ${esc(me.email)}.</p>` : ''}<label data-dv-who><span>Your name</span><input name="name" maxlength="120" autocomplete="name"></label><label data-dv-who><span>Your email</span><input name="email" type="email" maxlength="160" autocomplete="email" inputmode="email"></label><label data-dv-fr><span>Their name</span><input name="friend_name" maxlength="120"></label><label data-dv-fr><span>Their email</span><input name="friend_email" type="email" maxlength="160" inputmode="email"></label><p class="dv-tag-row"><button class="buy-btn">Send</button><button type="button" class="link" data-dv-tag-x>Not now</button></p><p class="note">Adults only. A photograph is linked to a person only by their own yes; the house never recognises faces.</p></form>
${isPrivate(d) ? peopleBlock(d, m, req, can, base) : ''}${bookOf(d, req, view, can, base, all)}${ws.length ? `<section class="ty dv-ty" id="thanks"><div class="ty-card"><p class="k">A thank-you card</p>
${req.query.thanks === 'given' ? `<p class="ty-done">Sent. ${esc(first(m.name))} will see it.</p>` : req.query.thanks ? '<p class="ty-done">Not just now; the till is closed.</p>' : ''}
<form method="post" action="/w/${esc(ws[0].slug)}/thanks" class="ty-f"><input type="hidden" name="via" value="${esc(view ? sh : d.token)}"><p class="ty-say">${view ? 'If these moved you' : 'These are a gift. If you would like'} to thank ${esc(first(m.name))}, a card goes straight to ${esc(first(m.name))}; the house keeps nothing of it.</p>
<div class="ty-amts">${[99, 499, 999].map((c, i) => `<label><input type="radio" name="amount" value="${c}" ${i === 1 ? 'checked' : ''}><span>${c < 100 ? `${c}¢` : `$${(c / 100).toFixed(2)}`}</span></label>`).join('')}<label class="ty-own"><input type="radio" name="amount" value="own"><span>$<input name="own" inputmode="decimal" placeholder="your own" aria-label="Your own amount"></span></label></div>
<input name="word" class="ty-word" placeholder="A word, if you like" maxlength="280" autocomplete="off"><button class="buy-btn">Send the card</button></form></div></section>` : ''}
${!can.keep ? '' : `<form method="post" class="dv-ks" data-dv-ks hidden><input type="hidden" name="slug"><p class="dv-ks-t"><b>Keep <span data-dv-ks-title></span>.</b> It hangs in a gallery of your own, yours for good, with its papers; and from there you can have it printed, framed and sent, or save it to your phone.</p>${me ? `<p class="dv-ks-me">As ${esc(me.email)}.</p>` : `<label><span>Your name</span><input name="name" maxlength="120" autocomplete="name"></label><label><span>Email</span><input name="email" type="email" required maxlength="160" autocomplete="email" inputmode="email"></label>`}<p class="dv-ks-row"><button class="buy-btn">Keep it</button><button type="button" class="link" data-dv-ks-x>Not now</button></p></form>`}
<script>(function(){var f=document.querySelector('[data-dv-tag]');if(!f)return;var signed=!!f.querySelector('[data-dv-asme]'),slug='',fr=false;function show(sel,on){[].forEach.call(f.querySelectorAll(sel),function(x){x.hidden=!on;var i=x.querySelector('input');if(i)i.required=on;});}
document.addEventListener('click',function(e){var me=e.target.closest('[data-dv-me]'),fd=e.target.closest('[data-dv-friend]'),st=e.target.closest('[data-dv-story]');
if(st){e.preventDefault();var u=st.getAttribute('data-dv-story'),n=st.getAttribute('data-dv-story-name')||'photograph',kd=st.getAttribute('data-dv-story-kind')||'story';fetch(u).then(function(r){return r.blob();}).then(function(b){var file=new File([b],n.replace(/[^a-z0-9 ]/gi,'')+' ('+kd+').jpg',{type:'image/jpeg'});if(navigator.canShare&&navigator.canShare({files:[file]}))return navigator.share({files:[file]}).catch(function(){});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=file.name;document.body.appendChild(a);a.click();a.remove();});return;}
if(e.target.closest('[data-dv-tag-x]')){f.hidden=true;return;}
if(!me&&!fd)return;slug=(me||fd).getAttribute(me?'data-dv-me':'data-dv-friend');fr=!!fd;
if(me&&signed){post();return;}
show('[data-dv-who]',!signed&&!fr);show('[data-dv-fr]',fr);f.querySelector('[data-dv-tag-t]').textContent=fr?'Who is it? They are asked by letter, and nothing is linked until they say yes.':'You, in this photograph. A letter asks you to confirm; then it is in your Pictures of you.';f.hidden=false;(me||fd).closest('figure').after(f);var i=f.querySelector('input:not([hidden])');setTimeout(function(){var x=f.querySelector('label:not([hidden]) input');if(x)x.focus();},50);});
function post(){var body=new URLSearchParams(new FormData(f));if(fr)body.set('friend','1');fetch(f.getAttribute('data-base')+'/'+slug+'/me',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:body.toString(),credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){f.hidden=true;var t=document.createElement('p');t.className='dv-done';t.textContent=j.linked?'It is in your Pictures of you.':j.ok?(fr?'Asked. They will get a letter.':'Check your email to confirm.'):'That did not go through. An email, please.';var fig=document.querySelector('[data-dv-me="'+slug+'"],[data-dv-friend="'+slug+'"]');if(fig)fig.closest('figcaption').appendChild(t);if(j.linked&&!fr)setTimeout(function(){location.reload();},900);});}
f.addEventListener('submit',function(e){e.preventDefault();post();});})();</script>
<footer class="dv-foot">${view ? `<div class="dv-cta"><p><b>${esc(first(m.name))} delivered these with Watermark.</b> Photographers send their work this way: one link, every picture credited inside the file, the group signs the book, and the pictures stay theirs.</p><p><a class="dv-cta-a" href="/join">Deliver your own photographs</a> <a href="/m/${esc(V.makerSlug ? V.makerSlug(m) : m.handle)}">More by ${esc(m.name)}</a></p></div>` : ''}<p>Each file carries ${esc(m.name)}’s name, the copyright and its licence number inside it, and the house keeps the record of every download. Anyone can check a file at <a href="/verify">watermark.krafftco.com/verify</a>. ${esc(m.name)}’s terms with you stand as agreed between you; the house does not change them.</p><p class="dv-wm">${logo}<span>Delivered with Watermark · Where great work is kept.</span></p></footer></section>
${!can.keep ? '' : `<script>(function(){var f=document.querySelector('[data-dv-ks]');if(!f)return;document.addEventListener('click',function(e){var b=e.target.closest('[data-dv-keep]');if(b){f.slug.value=b.getAttribute('data-dv-keep');f.action='${base}/'+b.getAttribute('data-dv-keep')+'/keep';f.querySelector('[data-dv-ks-title]').textContent=b.closest('figure').querySelector('b').textContent;f.hidden=false;f.scrollIntoView({behavior:'smooth',block:'center'});var i=f.querySelector('input[name=email]');if(i)setTimeout(function(){i.focus()},400);}if(e.target.closest('[data-dv-ks-x]'))f.hidden=true;});})();</script>`}<div class="dvp" data-dvp hidden data-api="${base}"><img class="dvp-a" alt=""><img class="dvp-b" alt=""><p class="dvp-cap" data-dvp-cap></p><div class="dvp-deck"><button type="button" data-dvp-prev aria-label="Back">${I.back || '‹'}</button><button type="button" data-dvp-pause aria-label="Pause">${I.pause || 'II'}</button><button type="button" data-dvp-next aria-label="Next">${I.next || '›'}</button><button type="button" data-dvp-music aria-pressed="false">Quiet music</button><button type="button" data-dvp-x aria-label="Close">${I.close || '×'}</button></div></div>
${can.look ? `<p class="grp-lo">${esc(first(m.name))} has asked that these stay here: look as long as you like.</p><script>(function(){var d=document.documentElement;function veil(){d.classList.add('dv-veiled');clearTimeout(veil.t);veil.t=setTimeout(function(){d.classList.remove('dv-veiled')},2600);}document.addEventListener('contextmenu',function(e){if(e.target.closest('.dv img,.dvo img'))e.preventDefault();});document.addEventListener('dragstart',function(e){if(e.target.closest('.dv img,.dvo img'))e.preventDefault();});document.addEventListener('copy',function(e){e.preventDefault();veil();});window.addEventListener('blur',veil);document.addEventListener('visibilitychange',function(){if(document.hidden)veil();});document.addEventListener('keydown',function(e){if(e.key==='PrintScreen'||(e.metaKey&&e.shiftKey&&/^[345]$/.test(e.key)))veil();});})();</script>` : ''}<script>window.__DV=${JSON.stringify({ base: view ? '/a/' + sh : '/deliver/' + d.token, list: ws.map(w => ({ s: w.slug, t: tidy(w.title), p: w.place || '' })), only: onlyMine ? 1 : 0 }).replace(/</g, '\\u003c')};</script><script src="/static/album.js?v=${VER}" defer></script></main>` }));
  }
  // Who is inside, and the invitation (a member may bring someone in when the maker allows it).
  function peopleBlock(d, m, req, can, base) {
    const ppl = db.prepare("SELECT name, invited_by FROM delivery_members WHERE delivery_id=? AND status='in' ORDER BY id").all(d.id);
    const asked = can.host ? db.prepare("SELECT COUNT(*) n FROM delivery_members WHERE delivery_id=? AND status='asked'").get(d.id).n : 0;
    let made = null; if (req.query.invited) made = db.prepare("SELECT * FROM delivery_members WHERE delivery_id=? AND token=? AND status='in'").get(d.id, String(req.query.invited));
    const err = { name: 'A name, please.', email: 'That email will not do.', phone: 'That phone number will not do.' }[req.query.invite] || '';
    return `<section class="grp" id="people"><p class="k">${d.door === 'join' ? 'The group' : 'By invitation'}</p><h2>${ppl.length === 1 ? 'One person inside' : `${ppl.length} people inside`}, with ${esc(first(m.name))}.</h2>
<p class="grp-who">${ppl.map(p => `<span>${esc(first(p.name))}</span>`).join('')}</p>${can.host && asked ? `<p class="grp-ask">${asked} asking to come in. <a href="/account/deliveries/${d.id}#people">Let them in</a></p>` : ''}
${made ? `<div class="grp-made"><p><b>${esc(first(made.name))} is invited.</b>${made.email ? ` A letter has gone to ${esc(made.email)}.` : ''} Their own link:</p><p class="dvd-link"><input readonly value="${esc(inviteLink(made))}" onclick="this.select()" aria-label="Their link"></p><p class="grp-acts"><a class="buy-btn" href="${esc(inviteSms(made, d, m))}">Text it</a> <button type="button" class="link" data-copy="${esc(inviteLink(made))}"><span>Copy link</span></button></p></div>` : ''}
${can.invite ? `<details class="grp-inv"${err ? ' open' : ''}><summary>${I.plus || ''}<span>Invite someone</span></summary>${err ? `<p class="dv-said">${esc(err)}</p>` : ''}<form method="post" action="${base}/invite" class="grp-f"><input name="name" required maxlength="120" placeholder="Their name" autocomplete="off"><input name="email" type="email" maxlength="160" placeholder="Their email (the house writes)" autocomplete="off"><input name="phone" type="tel" inputmode="tel" maxlength="24" placeholder="Or their phone (you text it)" autocomplete="off"><button class="buy-btn">Invite</button></form><p class="note">Each person gets a link of their own. ${d.door === 'invited' ? 'No one else can see these pictures.' : 'Anyone with the album link can also give their name and come in.'}</p></details>` : ''}
<script>document.addEventListener('click',function(e){var b=e.target.closest('.grp [data-copy]');if(!b)return;e.preventDefault();navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){(b.querySelector('span')||b).textContent='Copied'});});</script></section>`;
  }
  // The door of a private gallery, for someone not yet inside: nothing of the pictures, a name to come in (the group)
  // or a word to ask (by invitation).
  function doorPage(d, m, req, res) {
    res.set('Cache-Control', 'private, no-store'); res.set('X-Robots-Tag', 'noindex');
    const join = d.door === 'join', asked = req.query.asked === '1', bad = req.query.door === 'no';
    res.send(V.layout({ title: `${d.title} · ${m.name}`, bare: true, desc: `A private gallery of photographs by ${m.name}.`, body: `<main class="dv grp-door"><section class="grp-dc"><a class="dv-logo" href="/" aria-label="Watermark"><img src="/static/watermark-logo.svg" alt="Watermark" width="150" height="40"></a><p class="k">A private gallery · ${esc(m.name)}</p><h1>${esc(d.title)}</h1>
${asked ? `<p class="dv-lede">Asked. ${esc(first(m.name))} will see it and let you in; a letter will bring your own link.</p>` : join ? `<p class="dv-lede">These photographs are for the people in them and their friends. Give your name to come in; the group will see it.</p>${bad ? '<p class="dv-said">Your name, please.</p>' : ''}<form method="post" action="/a/${esc(d.share_token)}/join" class="grp-f"><input name="name" required maxlength="120" placeholder="Your name" autocomplete="name" autofocus><input name="email" type="email" maxlength="160" placeholder="Your email, to find it again (optional)" autocomplete="email"><button class="buy-btn">Come in</button></form>` : `<p class="dv-lede">This gallery is by invitation. If you were in the room, ask ${esc(first(m.name))} to let you in.</p>${bad ? '<p class="dv-said">Your name and an email, please.</p>' : ''}<form method="post" action="/a/${esc(d.share_token)}/join" class="grp-f"><input name="name" required maxlength="120" placeholder="Your name" autocomplete="name" autofocus><input name="email" type="email" required maxlength="160" placeholder="Your email" autocomplete="email"><button class="buy-btn">Ask to come in</button></form>`}
<p class="note">Nothing in here is shown anywhere else. Every photograph stays ${esc(first(m.name))}'s.</p></section></main>` }));
  }
  // A personal invitation: the link lets its holder in on any device.
  app.get('/in/:token', (req, res) => {
    const mm = db.prepare('SELECT * FROM delivery_members WHERE token=?').get(String(req.params.token)); if (!mm || mm.status === 'out') return res.sendStatus(404);
    const d = db.prepare('SELECT * FROM deliveries WHERE id=?').get(mm.delivery_id); if (!d) return res.sendStatus(404);
    if (mm.status === 'asked') return res.redirect(`/a/${shareOf(d)}?asked=1`);
    admit(req, res, mm.token); res.set('Cache-Control', 'private, no-store');
    res.redirect(`/a/${shareOf(d)}`);
  });
  const joinHits = new Map();
  app.post('/a/:share/join', (req, res) => {
    const d = byShare.get(String(req.params.share)); if (!d || !live(d) || !isPrivate(d)) return res.sendStatus(404);
    const back = `/a/${d.share_token}`; const x = req.body || {};
    const k = req.ip, now = Date.now(); const h = (joinHits.get(k) || []).filter(t => now - t < 600e3); if (h.length >= 8) return res.sendStatus(429); h.push(now); joinHits.set(k, h);
    const name = String(x.name || '').trim().slice(0, 120), email = String(x.email || '').trim().toLowerCase().slice(0, 160);
    if (!name || /https?:\/\/|www\./i.test(name) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (d.door === 'invited' && !email)) return res.redirect(303, back + '?door=no');
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id); const b = buyerOf(req);
    if (d.door === 'join') {
      const tok = newToken(); db.prepare("INSERT INTO delivery_members (delivery_id, name, email, token, status, invited_by, buyer_id, seen_at) VALUES (?,?,?,?,'in','join',?,datetime('now'))").run(d.id, name, email || null, tok, b && b.id || null);
      admit(req, res, tok);
      if (app.locals.notify) app.locals.notify.tell({ maker_id: d.maker_id, kind: 'note', href: `/account/deliveries/${d.id}#people`, title: `${first(name)} joined ${d.title}`, body: 'Inside the private gallery.' }).catch(() => {});
      return res.redirect(303, back);
    }
    if (!db.prepare("SELECT 1 FROM delivery_members WHERE delivery_id=? AND lower(email)=? AND status IN ('asked','in')").get(d.id, email)) db.prepare("INSERT INTO delivery_members (delivery_id, name, email, token, status, invited_by, buyer_id) VALUES (?,?,?,?,'asked','asked',?)").run(d.id, name, email, newToken(), b && b.id || null);
    if (app.locals.notify) app.locals.notify.tell({ maker_id: d.maker_id, kind: 'note', href: `/account/deliveries/${d.id}#people`, title: `${first(name)} asks to come into ${d.title}`, body: 'Let them in from the album.' }).catch(() => {});
    if (m && m.email) mail.send({ to: m.email, subject: `${name} asks to come into ${d.title}`, text: `${name} (${email}) asks to come into "${d.title}".\n\nLet them in, or not: ${C.base}/account/deliveries/${d.id}#people\n\nWatermark` });
    res.redirect(303, back + '?asked=1');
  });
  app.post(['/a/:share/invite', '/deliver/:token/invite'], (req, res) => {
    const d = albumOf(req); if (!d || !live(d) || !isPrivate(d)) return res.sendStatus(404);
    const view = !!req.params.share, can = capsOf(req, d, view), base = view ? `/a/${d.share_token}` : `/deliver/${d.token}`;
    if (!can.see || !can.invite) return res.sendStatus(403);
    const by = can.host ? 'maker' : can.member ? (can.member.invited_by === 'client' ? 'client' : 'member:' + can.member.id) : 'client';
    const r = invite(d, req.body || {}, by);
    if (r.error) return res.redirect(303, `${base}?invite=${/email/.test(r.error) ? 'email' : /phone/.test(r.error) ? 'phone' : 'name'}#people`);
    res.redirect(303, `${base}?invited=${encodeURIComponent(r.mm.token)}#people`);
  });
  // Ask to license one: the request goes to the maker, who answers as for any request.
  const ASK_USES = [['commercial', 'For a company'], ['editorial', 'In a story'], ['wall', 'On a wall'], ['campaign', 'In a campaign'], ['other', 'Something else']];
  app.get(['/a/:share/:slug/ask', '/deliver/:token/:slug/ask'], (req, res) => {
    const d = albumOf(req); if (!d || !live(d)) return res.sendStatus(404);
    const view = !!req.params.share, can = capsOf(req, d, view), base = view ? `/a/${d.share_token}` : `/deliver/${d.token}`; if (!can.see || !can.ask) return res.sendStatus(403);
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id), me = can.member; res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: `Ask to license · ${tidy(w.title)}`, bare: true, body: `<main class="dv dv-one"><a class="dv-back" href="${base}">${I.back || ''}<span>${esc(d.title)}</span></a><img class="dv-big" src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}"><section class="grp-dc">${req.query.sent ? `<h1>Asked.</h1><p class="dv-lede">${esc(first(m.name))} has it, and will write back.</p>` : `<h1>Ask to license ${esc(tidy(w.title))}.</h1><p class="dv-lede">The photograph is ${esc(first(m.name))}'s. Say how you would use it, and ${esc(first(m.name))} will answer with the terms.</p>
<form method="post" class="grp-f grp-askf"><select name="use">${ASK_USES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select><input name="name" required maxlength="120" placeholder="Your name" value="${esc(me ? me.name : '')}"><input name="email" type="email" required maxlength="160" placeholder="Your email" value="${esc(me && me.email || '')}"><input name="company" maxlength="160" placeholder="Company, if any"><textarea name="note" rows="3" maxlength="800" placeholder="Where it would run, for how long"></textarea><button class="buy-btn">Ask</button></form>`}</section></main>` }));
  });
  app.post(['/a/:share/:slug/ask', '/deliver/:token/:slug/ask'], (req, res) => {
    const d = albumOf(req); if (!d || !live(d)) return res.sendStatus(404);
    const view = !!req.params.share, can = capsOf(req, d, view); if (!can.see || !can.ask) return res.sendStatus(403);
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    const x = req.body || {}, name = String(x.name || '').trim().slice(0, 120), email = String(x.email || '').trim().toLowerCase().slice(0, 160);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect(303, req.originalUrl.split('?')[0]);
    const use = (ASK_USES.find(u => u[0] === x.use) || ASK_USES[4])[1], company = String(x.company || '').trim().slice(0, 160), note = String(x.note || '').trim().slice(0, 800);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id);
    if (m && m.email) mail.send({ to: m.email, replyTo: email, subject: `${name} asks to license ${tidy(w.title)}`, text: `${name}${company ? ` of ${company}` : ''} (${email}) asks to license "${tidy(w.title)}" from "${d.title}": ${use}.\n\n${note || '(no note)'}\n\nReply to this letter to answer; or set the photograph's prices and send them the page.\n\n${C.base}/account/works/${w.slug}\n\nWatermark` });
    if (app.locals.notify) app.locals.notify.tell({ maker_id: d.maker_id, kind: 'requested', href: `/account/works/${w.slug}`, title: `${first(name)} asks to license ${tidy(w.title)}`, body: `${use}${company ? ' · ' + company : ''}` }).catch(() => {});
    try { ledger.append(db, 'license.asked.private', w.slug, { use: x.use || 'other' }); } catch (e) { /* */ }
    res.redirect(303, req.originalUrl.split('?')[0] + '?sent=1');
  });
  // The maker's hand on the door: who may come in and what they may do; invitations; letting in; taking out.
  app.post('/account/deliveries/:id/door', (req, res) => {
    const { m, d } = mine(req, req.params.id); if (!m) return res.sendStatus(401); if (!d) return res.sendStatus(404);
    const x = req.body || {}; const door = DOORS[x.door] ? x.door : 'link'; const r = {}; const look = x.preset === 'look'; RULES.forEach(([k]) => { r[k] = !look && x['r_' + k] ? 1 : 0; }); if (look) r.speak = 1;
    db.prepare('UPDATE deliveries SET door=?, rules=? WHERE id=?').run(door, JSON.stringify(r), d.id);
    if (door !== 'link') clientMember(Object.assign({}, d, { door }));
    try { ledger.append(db, 'gallery.door', d.token.slice(0, 6), { door }); } catch (e) { /* */ }
    res.redirect(`/account/deliveries/${d.id}?ok=` + encodeURIComponent(door === 'link' ? 'Anyone with the link can see it.' : door === 'join' ? 'A private gallery: the group gives a name to come in.' : 'By invitation only.') + '#door');
  });
  app.post('/account/deliveries/:id/members', (req, res) => {
    const { m, d } = mine(req, req.params.id); if (!m) return res.sendStatus(401); if (!d) return res.sendStatus(404);
    if (!isPrivate(d)) db.prepare("UPDATE deliveries SET door='invited' WHERE id=?").run(d.id);
    const r = invite(Object.assign({}, d, { door: isPrivate(d) ? d.door : 'invited' }), req.body || {}, 'maker');
    if (r.error) return res.redirect(`/account/deliveries/${d.id}?ok=` + encodeURIComponent(r.error) + '#people');
    res.redirect(`/account/deliveries/${d.id}?made=${encodeURIComponent(r.mm.token)}#people`);
  });
  app.post('/account/deliveries/:id/members/:mid/:act', (req, res) => {
    const { m, d } = mine(req, req.params.id); if (!m) return res.sendStatus(401); if (!d) return res.sendStatus(404);
    const mm = db.prepare('SELECT * FROM delivery_members WHERE id=? AND delivery_id=?').get(+req.params.mid, d.id); if (!mm) return res.sendStatus(404);
    if (req.params.act === 'let' && mm.status === 'asked') { db.prepare("UPDATE delivery_members SET status='in', invited_by='maker' WHERE id=?").run(mm.id); const f = db.prepare('SELECT * FROM delivery_members WHERE id=?').get(mm.id); if (f.email) mail.send({ to: f.email, subject: `Come in: ${d.title}`, text: `${first(f.name)},\n\n${m.name} has let you into "${d.title}". Your own link:\n\n${inviteLink(f)}\n\nWatermark, for ${m.name}`, cta: { label: 'Come in', url: inviteLink(f) } }); return res.redirect(`/account/deliveries/${d.id}?ok=` + encodeURIComponent(`${first(mm.name)} is in.`) + '#people'); }
    if (req.params.act === 'out' && mm.invited_by !== 'client') { db.prepare("UPDATE delivery_members SET status='out' WHERE id=?").run(mm.id); return res.redirect(`/account/deliveries/${d.id}?ok=` + encodeURIComponent(mm.status === 'asked' ? `${first(mm.name)} was not let in.` : `${first(mm.name)} is out; their link no longer opens it.`) + '#people'); }
    res.sendStatus(400);
  });
  // The maker's view of the door and the people, on the album's own page.
  function deskDoor(d, m, req) {
    const r = rulesOf(d), ppl = membersOf(d), made = req.query.made ? ppl.find(p => p.token === String(req.query.made)) : null;
    return `<h2 class="dvd-h2" id="door">Who can see it</h2><form method="post" action="/account/deliveries/${d.id}/door" class="grp-desk"><div class="grp-doors">${Object.entries(DOORS).map(([k, [n, l]]) => `<label class="grp-dr"><input type="radio" name="door" value="${k}"${(d.door || 'link') === k ? ' checked' : ''}><b>${n}</b><span>${l}</span></label>`).join('')}</div>
<fieldset class="grp-rules"><legend>Inside a private gallery, people may <button name="preset" value="look" class="link grp-look" title="Only look, and talk on the bench: no downloads, no posting, no passing it on">Look only</button></legend><p class="grp-r0"><b>See every photograph</b><span>Always</span></p>${RULES.map(([k, n, l]) => `<label class="grp-r"><input type="checkbox" name="r_${k}" value="1"${r[k] ? ' checked' : ''}${k === 'full' && !allowsFull(d) ? ' disabled' : ''}><b>${n}</b><span>${l}</span></label>`).join('')}</fieldset><p><button class="buy-btn">Save</button></p></form>
${isPrivate(d) ? `<h2 class="dvd-h2" id="people">Who is inside <span>${ppl.filter(p => p.status === 'in').length} in${ppl.some(p => p.status === 'asked') ? ` · ${ppl.filter(p => p.status === 'asked').length} asking` : ''}</span></h2>
${made ? `<div class="grp-made"><p><b>${esc(first(made.name))} is invited.</b>${made.email ? ` A letter has gone to ${esc(made.email)}.` : ''}</p><p class="dvd-link"><input readonly value="${esc(inviteLink(made))}" onclick="this.select()"></p><p class="grp-acts"><a class="buy-btn" href="${esc(inviteSms(made, d, m))}">Text it${made.phone ? ` to ${esc(made.phone)}` : ''}</a> <button type="button" class="dvd-b" data-copy="${esc(inviteLink(made))}"><span>Copy link</span></button></p></div>` : ''}
<ul class="grp-list">${ppl.map(p => `<li class="grp-${p.status}"><b>${esc(p.name)}</b><span>${esc(p.email || p.phone || '')}</span><span>${p.status === 'asked' ? 'Asking to come in' : p.invited_by === 'client' ? 'The client' : p.invited_by === 'join' ? 'Joined by the link' : p.invited_by === 'maker' ? 'Invited by you' : 'Invited by a member'}${p.visits ? ` · ${p.visits} visit${p.visits === 1 ? '' : 's'}` : ''}</span><span class="grp-la">${p.status === 'asked' ? `<form method="post" action="/account/deliveries/${d.id}/members/${p.id}/let"><button class="buy-btn">Let in</button></form>` : `<a class="link" href="${esc(inviteSms(p, d, m))}">Text</a> <button type="button" class="link" data-copy="${esc(inviteLink(p))}"><span>Copy link</span></button>`}${p.invited_by !== 'client' ? `<form method="post" action="/account/deliveries/${d.id}/members/${p.id}/out"><button class="link">${p.status === 'asked' ? 'No' : 'Take out'}</button></form>` : ''}</span></li>`).join('')}</ul>
<form method="post" action="/account/deliveries/${d.id}/members" class="grp-f"><input name="name" required maxlength="120" placeholder="Their name"><input name="email" type="email" maxlength="160" placeholder="Their email (the house writes)"><input name="phone" type="tel" inputmode="tel" maxlength="24" placeholder="Or their phone (you text it)"><button class="buy-btn">Invite</button></form>` : ''}`;
  }
  app.get('/deliver/:token', (req, res) => {
    const d = byToken.get(String(req.params.token)); if (!d) return res.sendStatus(404);
    albumPage(d, req, res, false);
  });
  // The album to pass on (31 Oct, Will: "they can share something but not the ability to download"; "virality"):
  // a second address that shows the photographs, the book and the thanks, never a file.
  app.get('/a/:share', (req, res) => { const d = byShare.get(String(req.params.share)); if (!d) return res.sendStatus(404); albumPage(d, req, res, true); });
  // Keep it (Will, 23 Oct: "the collector must immediately be able to do something with the image"; a photograph of
  // yourself, given by the photographer, kept in a gallery of your own, then printed, framed and sent by the house):
  // a free licence of the photograph to the person who keeps it, under the album's own use, no end; the holder's room
  // then offers the proof, prints and Instax. A signed-in collector keeps it as themselves; a stranger gives an email
  // (a new gallery opens for a new email; an email the house knows gets the piece in their gallery and a letter, never
  // a sign-in by typing an address).
  app.post(['/deliver/:token/:slug/keep', '/a/:share/:slug/keep'], (req, res) => {
    const d = albumOf(req); if (!d || !live(d)) return res.sendStatus(410);
    const can = capsOf(req, d, !!req.params.share); if (!can.see || !can.keep) return res.sendStatus(403);
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id); const u = q.use.get(m.id, 'delivery'); if (!u) return res.sendStatus(409);
    let b = buyerOf(req); const x = req.body || {}; const email = String(x.email || '').trim().toLowerCase().slice(0, 160), name = String(x.name || '').trim().slice(0, 120);
    let known = false;
    if (!b) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.redirect(req.params.share ? `/a/${d.share_token}?keep=email` : `/deliver/${d.token}?keep=email`);
      b = db.prepare('SELECT * FROM buyers WHERE email=?').get(email);
      if (b) known = true; else { const id = db.prepare("INSERT INTO buyers (customer, email, name) VALUES ('', ?, ?)").run(email, name || null).lastInsertRowid; b = db.prepare('SELECT * FROM buyers WHERE id=?').get(id); setBuyer(res, b); }
    }
    const had = db.prepare("SELECT * FROM licenses WHERE work_id=? AND buyer_id=? AND status='active' AND intended_use LIKE 'Kept from %'").get(w.id, b.id);
    let ref = had && had.ref;
    if (!ref) {
      ref = nextRef();
      db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,intended_use,price_cents,status,buyer_id,rights) VALUES (?,?,?,?,?,?,NULL,'requested',?,?)").run(ref, w.id, u.id, name || b.name || d.client_name, b.email || email || '', `Kept from ${d.title}`.slice(0, 400), b.id, JSON.stringify({ size: allowsFull(d) ? 'full' : 'share', strip: false }));
      grant(ref, { paid: false });
      try { ledger.append(db, 'license.kept', ref, { work: w.slug, from: d.token.slice(0, 6) }); } catch (e) { /* */ }
      if (app.locals.notify) try { app.locals.notify.tell('m:' + m.id, 'kept', { title: `${tidy(w.title)} was kept`, body: `${name || b.name || 'Someone'} kept it from ${d.title}.`, url: `/w/${w.slug}` }); } catch (e) { /* */ }
    }
    const l = db.prepare('SELECT * FROM licenses WHERE ref=?').get(ref);
    if (known) { mail.send({ to: b.email, subject: `${tidy(w.title)} is in your gallery`, text: `${first(name || b.name || 'there')},\n\n${tidy(w.title)}, by ${m.name}, from "${d.title}", now hangs in your gallery on Watermark, yours for good.\n\n${C.base}/signin?next=/yours\n\nWatermark`, feature: 'Kept', cta: { label: 'Your gallery', url: `${C.base}/signin?next=/yours` } }); }
    res.redirect(`/thanks/${ref}?k=${l.download_token || ''}`);
  });
  // One file of the album (21 Oct): the 2,400-pixel copy by default (marked within, the papers inside, no strip: a
  // couple of megabytes, right for a phone and for sharing), or the full file with ?full=1 when the album allows it.
  // Counted as a download of the photograph's own licence. The full file leaves untouched (the master's own pixels).
  async function fileOf(d, w, m, full) {
    const l = licOf(w.ref); if (!l || l.status !== 'active' || (l.ends_at && new Date(l.ends_at) < new Date())) return null;
    const file = await originalPath(w);
    const fmt = full ? (/\.png$/i.test(file) ? 'png' : /\.tiff?$/i.test(file) ? 'tiff' : 'jpeg') : 'jpeg';
    const dlId = Number(db.prepare('INSERT INTO downloads (license_id, size) VALUES (?,?)').run(l.id, full ? 'full' : 'share').lastInsertRowid);
    ledger.append(db, 'file.delivered', l.ref, { work: w.slug, size: full ? 'full' : 'share' });
    // the copy: the house's own 2,400-pixel JPEG 94 from the master (the wall's 'large', cached, warmed when the album is made), so Download all streams at once
    const raw = full ? fs.readFileSync(file) : fs.readFileSync(await images.derivative(file, cache, w.slug, 'large', 'jpg'));
    const buf = full && !/\.(jpe?g|png|tiff?)$/i.test(file) ? raw : await marked(raw, { w, maker: m, ref: l.ref, licensee: d.client_name, use: 'Delivered', ends: l.ends_at, dlId, share: !full, strip: false, format: fmt });
    const fn = fileName(w, m, l.ref, full ? path.extname(w.original_file).toLowerCase() : '.jpg');
    return { buf, name: fn.utf8 || `${w.slug}.jpg`, ascii: fn.ascii || `${w.slug}.jpg`, type: fmt === 'png' ? 'image/png' : fmt === 'tiff' ? 'image/tiff' : 'image/jpeg' };
  }
  const allowsFull = d => d.size !== 'large';
  const fullSize = ws => { const b = ws.reduce((a, w) => a + (w.bytes || 0), 0); return b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`; };
  app.get(['/deliver/:token/:slug/file', '/a/:share/:slug/file'], async (req, res) => {
    const d = albumOf(req); if (!d || !live(d)) return res.sendStatus(404);
    const can = capsOf(req, d, !!req.params.share); if (!can.see || !can.download) return res.sendStatus(403);
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    const full = req.query.full === '1' && can.full; const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id);
    try { const f = await fileOf(d, w, m, full); if (!f) return res.sendStatus(410);
      res.set('Content-Type', f.type); res.set('Content-Disposition', `attachment; filename="${f.ascii.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`); res.set('Cache-Control', 'private, no-store'); res.send(f.buf);
    } catch (e) { console.error('[delivery file]', w.slug, e.message); res.sendStatus(500); }
  });
  // All of it as one zip: the copies by default, the full files with ?full=1; each file marked and counted as a
  // download of its own licence; one file in memory at a time (the zip waits for each entry to be written).
  // A heart: the client's favourite, toggled; JSON back with the count of their own.
  app.post(['/deliver/:token/:slug/heart', '/a/:share/:slug/heart'], (req, res) => {
    const d = req.params.share ? byShare.get(String(req.params.share)) : byToken.get(String(req.params.token)); if (!d || !live(d)) return res.status(404).json({ ok: false });
    const w = worksOf(d).find(x => x.slug === req.params.slug); if (!w) return res.status(404).json({ ok: false });
    const who = heartWho(req, res); const on = db.prepare('SELECT 1 FROM delivery_hearts WHERE delivery_id=? AND work_id=? AND who=?').get(d.id, w.id, who);
    if (on) db.prepare('DELETE FROM delivery_hearts WHERE delivery_id=? AND work_id=? AND who=?').run(d.id, w.id, who);
    else db.prepare('INSERT INTO delivery_hearts (delivery_id, work_id, who) VALUES (?,?,?) ON CONFLICT DO NOTHING').run(d.id, w.id, who);
    res.json({ ok: true, on: !on, n: heartsOf(d, who).size });
  });
  app.get(['/deliver/:token/all.zip', '/a/:share/all.zip'], async (req, res) => {
    const d = albumOf(req); if (!d || !live(d)) return res.sendStatus(404);
    const can = capsOf(req, d, !!req.params.share); if (!can.see || !can.download) return res.sendStatus(403);
    const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id), full = req.query.full === '1' && can.full;
    let ws = worksOf(d); if (req.query.fav === '1') { const h = heartsOf(d, heartWho(req)); ws = ws.filter(w => h.has(w.id)); if (!ws.length) return res.redirect(req.params.share ? `/a/${encodeURIComponent(d.share_token)}` : `/deliver/${encodeURIComponent(d.token)}#album`); }
    res.set('Content-Type', 'application/zip'); res.set('Content-Disposition', `attachment; filename="${d.title.replace(/[^\w .-]+/g, ' ').trim() || 'Delivery'}, ${m.name.replace(/[^\w .-]+/g, ' ')} (Watermark).zip"`); res.set('Cache-Control', 'private, no-store');
    const zip = archiver('zip', { zlib: { level: 1 } }); zip.on('error', () => { try { res.end(); } catch (e) { /* */ } }); zip.pipe(res);
    for (const w of ws) {
      try { const f = await fileOf(d, w, m, full); if (!f) continue;
        const written = new Promise(r => zip.once('entry', r)); zip.append(f.buf, { name: f.name }); await written;
      } catch (e) { console.error('[delivery zip]', w.slug, e.message); }
    }
    zip.finalize();
  });
  // One photograph's page inside the delivery: the picture large, Download, back.
  // That's me / That's a friend, from either address of the album.
  const tagHits = new Map();
  const albumOf = req => req.params.share ? byShare.get(String(req.params.share)) : byToken.get(String(req.params.token));
  app.post(['/deliver/:token/:slug/me', '/a/:share/:slug/me'], (req, res) => {
    const d = albumOf(req); if (!d || !live(d)) return res.status(410).json({ ok: false });
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.status(404).json({ ok: false });
    const k = req.ip, now = Date.now(); const h = (tagHits.get(k) || []).filter(t => now - t < 600e3); if (h.length >= 12) return res.status(429).json({ ok: false, why: 'wait' }); h.push(now); tagHits.set(k, h);
    if (!app.locals.sitters) return res.status(503).json({ ok: false });
    const x = req.body || {}; const b = buyerOf(req);
    const friend = x.friend === '1' ? { name: String(x.friend_name || '').trim().slice(0, 120), email: String(x.friend_email || '').trim().toLowerCase().slice(0, 160) } : null;
    const r = app.locals.sitters.claim(w, { buyer: b && b.email ? b : null, email: String(x.email || '').trim().toLowerCase().slice(0, 160), name: String(x.name || '').trim().slice(0, 120), friend, where: d.title });
    res.json(r);
  });
  // The photograph sized for a story (1080 × 1920) or a post (1080 × 1350, 4:5, 2 Nov): the picture whole on the dark,
  // never cropped, the credit beneath it in the house's type, the album and the address. The picture is the album's own
  // copy; the credit is drawn, not hidden.
  app.get(['/deliver/:token/:slug/story.jpg', '/a/:share/:slug/story.jpg', '/deliver/:token/:slug/post.jpg', '/a/:share/:slug/post.jpg'], async (req, res) => {
    const post = req.path.endsWith('/post.jpg');
    const d = albumOf(req); if (!d || !live(d)) return res.sendStatus(404);
    { const can = capsOf(req, d, !!req.params.share); if (!can.see || !can.social) return res.sendStatus(403); }
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    const out = path.join(cache, `${post ? 'post' : 'story'}-${w.slug}-${d.id}.jpg`);
    try {
      if (!fs.existsSync(out)) {
        const sharp = require('sharp'); const m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id);
        const src = await images.derivativeOf(() => originalPath(w), cache, w.slug, 'large', 'jpg');
        const W = 1080, H = post ? 1350 : 1920, boxW = post ? 940 : 960, boxH = post ? 1000 : 1380, top0 = post ? 70 : 150;
        const pic = await sharp(src).resize(boxW, boxH, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
        const left = Math.round((W - pic.info.width) / 2), top = post ? Math.round((H - 70 - (pic.info.height + 124)) / 2) : Math.round(top0 + (boxH - pic.info.height) / 2), capY = top + pic.info.height + (post ? 70 : 92);
        const e = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><text x="${W / 2}" y="${capY}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="40" fill="#efe9df">Photograph by ${e(m.name)}</text><text x="${W / 2}" y="${capY + 54}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="25" letter-spacing="5" fill="#a39d92">${e(String(d.title).toUpperCase().slice(0, 48))}</text><text x="${W / 2}" y="${H - (post ? 50 : 90)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" letter-spacing="6" fill="#8f897f">WATERMARK</text></svg>`;
        const tmp = `${out}.${process.pid}.tmp`;
        await sharp({ create: { width: W, height: H, channels: 3, background: '#0b0a09' } }).composite([{ input: pic.data, left, top }, { input: Buffer.from(svg), left: 0, top: 0 }]).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(tmp);
        try { fs.renameSync(tmp, out); } catch (er) { try { fs.unlinkSync(tmp); } catch (e2) { /* */ } }
      }
      res.set('Cache-Control', 'private, max-age=3600'); res.type('image/jpeg').sendFile(out);
    } catch (er) { console.error('[story]', post ? 'post' : 'story', er.message); res.sendStatus(500); }
  });
  app.get('/deliver/:token/:slug', (req, res) => {
    const d = byToken.get(String(req.params.token)); if (!d || !live(d)) return res.sendStatus(404);
    const w = worksOf(d).find(x => x.slug === String(req.params.slug)); if (!w) return res.sendStatus(404);
    const l = licOf(w.ref), m = db.prepare('SELECT * FROM makers WHERE id=?').get(d.maker_id);
    res.set('Cache-Control', 'private, no-store');
    res.send(V.layout({ title: `${tidy(w.title)} · ${d.title} · Watermark`, bare: true, body: `<main class="dv dv-one"><a class="dv-back" href="/deliver/${esc(d.token)}">${I.back || ''}<span>${esc(d.title)}</span></a><img class="dv-big" src="/img/${esc(w.slug)}/large" alt="${esc(tidy(w.title))}"><p class="dv-cap"><b>${esc(tidy(w.title))}</b> · ${esc(m.name)}${w.place ? ` · ${esc(w.place)}` : ''} · <a href="/deliver/${esc(d.token)}/${esc(w.slug)}/file" download>Download</a><button type="button" class="dv-keep" data-dv-keep="${esc(w.slug)}">Keep it</button>${allowsFull(d) ? ` · <a href="/deliver/${esc(d.token)}/${esc(w.slug)}/file?full=1" download>Full size</a>` : ''} · <a href="/wander?in=delivery:${esc(d.token)}&at=${esc(w.slug)}">Wander from here</a></p></main>` }));
  });
  app.locals.deliveries = { url, live, close, worksOf, holds, set, guarded, mayView, galleriesOf, isPrivate };
  return app.locals.deliveries;
}
module.exports = { mountDeliveries, SIZES };
