// The desk (Will, 19 Oct 2026: "a dashboard where I, Will Fullerton, can see into everything: my own personal site;
// the most convenient glance into my business and creative empire; one of my own sites, separate, secret;
// fullerton.cloud; exactly like the New Yorker"). One page, read at a glance, set like a magazine's front:
// the masthead, the figure, the date, then the columns: The House (Watermark), The Ledger (money), The Desk
// (what needs you), Goings On (the season), The Wire (Studios and the register). Every source is optional and
// says so quietly when it is not connected. The door: an email code (Resend) for DESK_EMAIL only, a signed cookie.
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const E = process.env;
const SECRET = E.DESK_SECRET || crypto.randomBytes(32).toString('hex');
const WHO = String(E.DESK_EMAIL || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
const BASE = E.WATERMARK_BASE || 'https://watermark.krafftco.com';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => '$' + (Math.round(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex').slice(0, 32);
const TZ = E.DESK_TZ || 'America/New_York';
const dateLine = d => new Date(d || Date.now()).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ }).toUpperCase();
const when = s => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '';
const ago = s => { if (!s) return ''; const m = Math.round((Date.now() - new Date(s)) / 60000); if (m < 2) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 36) return `${h} h ago`; return `${Math.round(h / 24)} d ago`; };

// Sources. Each returns a plain object or { off: reason }. Cached a minute so a reload costs nothing.
const cache = new Map();
async function cached(key, ttl, fn) { const h = cache.get(key); if (h && Date.now() - h.at < ttl) return h.v; try { const v = await fn(); cache.set(key, { at: Date.now(), v }); return v; } catch (e) { const v = { off: e.message }; cache.set(key, { at: Date.now(), v }); return v; } }
const getJSON = async (url, opt = {}) => { const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`); return r.json(); };
const S = {
  watermark: () => cached('wm', 60000, async () => { if (!E.DESK_KEY) return { off: 'DESK_KEY not set' }; return getJSON(`${BASE}/api/desk`, { headers: { 'x-desk-key': E.DESK_KEY } }); }),
  stripe: () => cached('stripe', 60000, async () => {
    if (!E.STRIPE_KEY) return { off: 'STRIPE_KEY not set' }; const h = { Authorization: `Bearer ${E.STRIPE_KEY}` };
    const [bal, ch] = await Promise.all([getJSON('https://api.stripe.com/v1/balance', { headers: h }), getJSON('https://api.stripe.com/v1/charges?limit=12', { headers: h })]);
    const sum = (arr, cur = 'usd') => arr.filter(x => x.currency === cur).reduce((a, x) => a + x.amount, 0);
    const since = t => ch.data.filter(c => c.paid && !c.refunded && c.created * 1000 >= t).reduce((a, c) => a + c.amount, 0);
    const d = new Date(); const dayStart = new Date(d.toLocaleDateString('en-US', { timeZone: TZ })).getTime();
    return { available: sum(bal.available), pending: sum(bal.pending), today: since(dayStart), charges: ch.data.slice(0, 8).map(c => ({ amount: c.amount, at: c.created * 1000, what: c.description || (c.metadata && (c.metadata.ref || c.metadata.proof && 'A proof' || c.metadata.circle && 'The Circle')) || c.statement_descriptor || 'Payment', who: c.billing_details && c.billing_details.name || c.receipt_email || '' })), live: /^[sr]k_live_/.test(E.STRIPE_KEY) };
  }),
  notion: () => cached('notion', 120000, async () => {
    if (!E.NOTION_TOKEN) return { off: 'NOTION_TOKEN not set' };
    const srcs = String(E.NOTION_SOURCES || 'Tasks=c5239e6b-0f1e-4aa7-ac41-e389d7516fda').split(',').map(s => s.trim()).filter(Boolean).map(s => { const [label, id] = s.split('='); return { label, id }; });
    const h = { Authorization: `Bearer ${E.NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };
    const out = [];
    for (const src of srcs) {
      let r; try { r = await getJSON(`https://api.notion.com/v1/data_sources/${src.id}/query`, { method: 'POST', headers: h, body: JSON.stringify({ page_size: 40 }) }); }
      catch (e) { r = await getJSON(`https://api.notion.com/v1/databases/${src.id}/query`, { method: 'POST', headers: { ...h, 'Notion-Version': '2022-06-28' }, body: JSON.stringify({ page_size: 40 }) }); }
      const rows = (r.results || []).map(p => { const P = p.properties || {}; let title = '', due = null, status = '', done = false;
        for (const [k, v] of Object.entries(P)) { if (v.type === 'title') title = (v.title || []).map(t => t.plain_text).join(''); else if (v.type === 'date' && v.date && !due) due = v.date.start; else if ((v.type === 'status' && v.status) || (v.type === 'select' && v.select && /status/i.test(k))) { status = (v.status || v.select).name; done = /done|complete|closed|won|lost|archived/i.test(status); } else if (v.type === 'checkbox' && /done|complete/i.test(k)) done = done || !!v.checkbox; }
        return { title, due, status, done, url: p.url, edited: p.last_edited_time }; }).filter(r => r.title && !r.done);
      rows.sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
      out.push({ label: src.label, rows: rows.slice(0, 12), n: rows.length });
    }
    return { sources: out };
  }),
  render: () => cached('render', 120000, async () => {
    if (!E.RENDER_API_KEY) return { off: 'RENDER_API_KEY not set' }; const h = { Authorization: `Bearer ${E.RENDER_API_KEY}` };
    const svcs = await getJSON('https://api.render.com/v1/services?limit=20', { headers: h });
    const out = [];
    for (const { service } of svcs.slice(0, 8)) { let d = null; try { const ds = await getJSON(`https://api.render.com/v1/services/${service.id}/deploys?limit=1`, { headers: h }); d = ds[0] && ds[0].deploy; } catch (e) { /* none */ } out.push({ name: service.name, suspended: service.suspended, deploy: d ? { status: d.status, at: d.finishedAt || d.createdAt } : null }); }
    return { services: out };
  }),
  ghost: () => cached('ghost', 300000, async () => {
    if (!E.GHOST_URL || !E.GHOST_KEY) return { off: 'GHOST_URL/GHOST_KEY not set' };
    const r = await getJSON(`${E.GHOST_URL.replace(/\/$/, '')}/ghost/api/content/posts/?key=${E.GHOST_KEY}&limit=6&fields=title,url,published_at,primary_author&include=authors`);
    return { posts: (r.posts || []).map(p => ({ title: p.title, url: p.url, at: p.published_at, by: p.primary_author && p.primary_author.name })) };
  }),
  health: () => cached('health', 60000, async () => getJSON(`${BASE}/healthz`)),
  owner: () => cached('owner', 60000, async () => { if (!E.DESK_KEY) return { off: 'DESK_KEY not set' }; return getJSON(`${BASE}/api/desk/owner`, { headers: { 'x-desk-key': E.DESK_KEY } }); }),
};

// The figure: an original character for Krafft, in the spirit of a magazine's cover gentleman. A working draft.
const FIGURE = fs.readFileSync(path.join(__dirname, 'public', 'figure.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');

function page({ title, body, bare = false }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500;6..96,700&family=Bodoni+Moda:ital,opsz,wght@1,6..96,400&family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&display=swap"><link rel="stylesheet" href="/desk.css"></head>
<body class="${bare ? 'bare' : ''}">${body}</body></html>`;
}

const app = express();
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use((req, res, next) => { res.set('X-Frame-Options', 'DENY'); res.set('Referrer-Policy', 'no-referrer'); res.set('X-Robots-Tag', 'noindex, nofollow'); res.set('Cache-Control', 'private, no-store'); next(); });
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// The door.
const codes = new Map(); // email → { code, link, at, tries }
const admitted = req => { const c = req.cookies && req.cookies.desk; if (!c) return null; const [email, exp, mac] = String(c).split('.'); if (!email || !exp || mac !== sign(`${email}.${exp}`) || Date.now() > +exp) return null; const e = Buffer.from(email, 'base64url').toString(); return WHO.includes(e) ? e : null; };
const admit = (res, email) => { const exp = Date.now() + 30 * 86400000, em = Buffer.from(email).toString('base64url'); res.cookie('desk', `${em}.${exp}.${sign(`${em}.${exp}`)}`, { httpOnly: true, sameSite: 'lax', secure: !!E.RENDER || process.env.NODE_ENV === 'production', maxAge: 30 * 86400000 }); };
async function sendCode(email, code, link) {
  if (!E.RESEND_API_KEY) { console.log(`[desk] code for ${email}: ${code}  link: ${link}`); return true; }
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${E.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: E.MAIL_FROM || 'Watermark <house@watermark.krafftco.com>', to: [email], subject: `The desk: ${code}`, text: `Your code for the desk is ${code}. It is good for ten minutes.\n\nOr open: ${link}\n\nIf you did not ask for this, ignore it; nothing happens without the code.` }) });
  return r.ok;
}
app.get('/door', (req, res) => {
  res.send(page({ title: 'The desk', bare: true, body: `<main class="door"><div class="dr-fig">${FIGURE}</div><h1>The desk.</h1><p class="dr-l">Private. A code is sent to the desk’s own address.</p>
${req.query.sent ? `<form method="post" action="/door/code" class="dr-f"><label>The code<input name="code" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" autofocus required></label><input type="hidden" name="email" value="${esc(req.query.sent)}"><button>Enter</button></form>${req.query.bad ? '<p class="dr-x">Not that one.</p>' : ''}`
  : `<form method="post" action="/door" class="dr-f"><label>Email<input name="email" type="email" autofocus required></label><button>Send the code</button></form>${req.query.no ? '<p class="dr-x">The desk does not know that address.</p>' : ''}`}</main>` }));
});
app.post('/door', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!WHO.includes(email)) return res.redirect('/door?no=1');
  const code = String(crypto.randomInt(100000, 999999)), link = `${req.protocol}://${req.get('host')}/door/${crypto.randomBytes(16).toString('hex')}`;
  codes.set(email, { code, link, at: Date.now(), tries: 0 });
  await sendCode(email, code, link);
  res.redirect('/door?sent=' + encodeURIComponent(email));
});
app.post('/door/code', (req, res) => {
  const email = String((req.body || {}).email || '').toLowerCase(), c = codes.get(email);
  if (!c || Date.now() - c.at > 600000 || c.tries >= 5) return res.redirect('/door');
  c.tries++; if (String((req.body || {}).code || '').trim() !== c.code) return res.redirect('/door?sent=' + encodeURIComponent(email) + '&bad=1');
  codes.delete(email); admit(res, email); res.redirect('/');
});
app.get('/door/:token', (req, res) => { for (const [email, c] of codes) if (c.link.endsWith('/door/' + req.params.token) && Date.now() - c.at < 600000) { codes.delete(email); admit(res, email); return res.redirect('/'); } res.redirect('/door'); });
app.post('/out', (req, res) => { res.clearCookie('desk'); res.redirect('/door'); });
app.use((req, res, next) => { if (req.path === '/healthz') return res.json({ ok: true, who: WHO.length, sources: { watermark: !!E.DESK_KEY, stripe: !!E.STRIPE_KEY, notion: !!E.NOTION_TOKEN, render: !!E.RENDER_API_KEY, ghost: !!(E.GHOST_URL && E.GHOST_KEY), mail: !!E.RESEND_API_KEY } }); if (!admitted(req)) return res.redirect('/door'); next(); });

// The front.
const off = (o, what) => o && o.off ? `<p class="off">${esc(what)}: not connected<span>${esc(o.off)}</span></p>` : '';
app.get('/', async (req, res) => {
  const [wm, st, nt, rd, gh, hz] = await Promise.all([S.watermark(), S.stripe(), S.notion(), S.render(), S.ghost(), S.health()]);
  const W = wm.off ? null : wm;
  const needs = W ? [
    [W.needs.requests, 'request' , 'waiting for a maker’s answer', `${BASE}/studio/licenses`],
    [W.needs.claims, 'claim', 'open', `${BASE}/studio/claims`],
    [W.needs.applications, 'maker', 'asking to join', `${BASE}/studio/makers`],
    [W.needs.prints, 'print', 'in the print room', `${BASE}/studio/prints`],
    [W.needs.dinnerNames, 'name', 'down for a dinner, not yet drawn', `${BASE}/studio/season`],
    [W.needs.feedback, 'note', 'from the beta, unanswered', `${BASE}/studio/feedback`],
  ].filter(x => x[0] > 0) : [];
  const issue = Math.floor((Date.now() - new Date('2026-10-16T00:00:00Z')) / 86400000) + 1;
  res.send(page({ title: 'The desk', body: `<header class="mast"><div class="mast-in"><div class="fig">${FIGURE}</div><div class="mast-t"><h1>The Desk</h1><p class="mast-d">${dateLine()} · No. ${issue} · <em>Krafft, and all of it</em></p></div><form method="post" action="/out" class="out"><button>Out</button></form></div><div class="rule"></div></header>
<main class="sheet">
<section class="col"><h2>The House</h2>${off(wm, 'Watermark')}${W ? `
<p class="big"><b>${money(W.sales.today.c)}</b> today <span>${W.sales.today.n} sale${W.sales.today.n === 1 ? '' : 's'}</span></p>
<ul class="ln"><li><b>${money(W.sales.week.c)}</b> this week · ${W.sales.week.n}</li><li><b>${money(W.sales.month.c)}</b> this month · ${W.sales.month.n}</li><li><b>${money(W.sales.all.c)}</b> all time · ${W.sales.all.n}</li></ul>
<ul class="ln"><li>${W.house.works} works held${W.house.hidden ? ` · ${W.house.hidden} kept back` : ''}</li><li>${W.house.makers} makers · ${W.house.collectors} collectors · ${W.house.licenses} live licenses</li><li>${W.stood.today} stood before something today · ${W.stood.week} this week</li><li>The Circle: ${W.circle.n} member${W.circle.n === 1 ? '' : 's'}${W.circle.n ? ` · ${money(W.circle.c)} a year` : ''} · Friends: ${W.friends.n}${W.friends.n ? ` · ${money(W.friends.c)} a month` : ''}</li><li>The register: ${W.house.register.toLocaleString('en-US')} entries, ${W.house.registerOk ? 'sound' : '<b class="bad">broken</b>'} · Stripe ${W.house.stripe} · mail ${W.house.mail ? 'on' : '<b class="bad">off</b>'} · ${W.house.launched ? 'launched' : 'beta'}</li></ul>
${W.sales.recent.length ? `<h3>Lately sold</h3><ul class="ln sm">${W.sales.recent.slice(0, 6).map(r => `<li><b>${money(r.price_cents)}</b> ${esc(r.title)} <span>${esc(r.use_key === 'social' ? 'Collect' : r.use_key)} · ${esc(r.licensee_company || r.licensee_name || '')} · ${ago(r.starts_at)}</span></li>`).join('')}</ul>` : ''}` : ''}
${hz && !hz.off ? `<p class="fine">Health: ledger ${hz.ledger ? 'ok' : 'BROKEN'} · mail ${hz.mail ? 'on' : 'off'} · closer ${hz.closer ? 'on' : 'off'} · speech ${hz.speech || 'off'} · signing ${hz.signing ? 'on' : 'off'}${hz.backup ? ` · backup ${hz.backup.stale ? '<b class="bad">stale</b>' : 'fresh'}` : ''}</p>` : ''}</section>

<section class="col"><h2>The Ledger</h2>${off(st, 'Stripe')}${st && !st.off ? `
<p class="big"><b>${money(st.available)}</b> available <span>${money(st.pending)} pending${st.live ? '' : ' · test mode'}</span></p>
<ul class="ln sm">${st.charges.map(c => `<li><b>${money(c.amount)}</b> ${esc(c.what)} <span>${esc(c.who)} · ${ago(c.at)}</span></li>`).join('')}</ul>` : ''}
${W && W.needs.owed ? `<p class="fine">Owed to makers: <b>${money(W.needs.owed)}</b> (paid by hand until Connect).</p>` : ''}
${rd && !rd.off ? `<h3>The machines</h3><ul class="ln sm">${rd.services.map(s => `<li>${esc(s.name)} <span>${s.suspended === 'suspended' ? 'suspended' : s.deploy ? `${esc(s.deploy.status)} · ${ago(s.deploy.at)}` : ''}</span></li>`).join('')}</ul>` : off(rd, 'Render')}</section>

<section class="col"><h2>Needs You</h2>${W ? (needs.length ? `<ul class="nd">${needs.map(([n, w, line, href]) => `<li><a href="${href}"><b>${n}</b> ${esc(w)}${n === 1 ? '' : 's'} ${esc(line)}</a></li>`).join('')}</ul>` : '<p class="clear">All clear.</p>') : ''}
${nt && !nt.off ? nt.sources.map(s => `<h3>${esc(s.label)} <span>${s.n} open</span></h3>${s.rows.length ? `<ul class="ln sm">${s.rows.map(r => `<li><a href="${esc(r.url)}">${esc(r.title)}</a> <span>${r.due ? `due ${esc(r.due.slice(0, 10))}` : ''}${r.status ? ` · ${esc(r.status)}` : ''}</span></li>`).join('')}</ul>` : '<p class="clear">Nothing open.</p>'}`).join('') : off(nt, 'Notion')}</section>

<section class="col"><h2>Goings On</h2>${W ? (W.nights.length ? `<ul class="ln">${W.nights.map(n => `<li><a href="${BASE}/season/${esc(n.slug)}"><b>${esc(n.title)}</b></a> <span>${esc(when(n.at))}${n.city ? ` · ${esc(n.city)}` : ''} · ${n.kind === 'dinner' ? `${n.asked} names down, ${n.going} seated` : `${n.going} coming${n.capacity ? ` of ${n.capacity}` : ''}`}</span></li>`).join('')}</ul>` : `<p class="clear">No night is set. <a href="${BASE}/studio/season">Throw one.</a></p>`) : ''}
${gh && !gh.off ? `<h3>Studios</h3><ul class="ln sm">${gh.posts.map(p => `<li><a href="${esc(p.url)}">${esc(p.title)}</a> <span>${esc(p.by || '')} · ${ago(p.at)}</span></li>`).join('')}</ul>` : off(gh, 'Studios')}</section>

<section class="col wide"><h2>The Wire</h2>${W ? `<ul class="wire">${W.lately.map(l => `<li><span>${esc(when(l.at))}</span> ${esc(l.text)}</li>`).join('')}</ul>` : ''}
<p class="fine">Read at ${esc(new Date().toLocaleTimeString('en-US', { timeZone: TZ }))} New York. Sources refresh each minute. <a href="/owner">The owner’s view</a> · <a href="${BASE}/studio">The Studio</a> · <a href="${BASE}/ledger">The register</a> · <a href="https://studios.krafftco.com">Studios</a> · <a href="https://www.notion.so">Notion</a> · <a href="https://dashboard.stripe.com">Stripe</a> · <a href="https://dashboard.render.com">Render</a></p></section>
</main>` }));
});
// The owner's view (Will, 28 Oct: "what would Elon want eyes into"): one screen, the house's own figures, nothing typed in.
app.get('/owner', async (req, res) => {
  const O = await S.owner(); if (O.off) return res.send(page({ title: 'The owner’s view', body: `<main class="sheet"><p class="off">Watermark: not connected<span>${esc(O.off)}</span></p></main>` }));
  const g = O.growth || {}, m = O.money || {}, v = O.vault || {}, reg = O.register || {}, live = O.live || {}, c = O.costs, p = O.people || {};
  const n = x => Number(x || 0).toLocaleString('en-US');
  const tile = (big, small, sub = '') => `<div class="ot"><b>${big}</b><span>${esc(small)}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
  const spark = (rows, k) => { if (!rows || !rows.length) return '<p class="off">nothing yet</p>'; const max = Math.max(1, ...rows.map(x => x[k] || 0)); return `<div class="osp">${rows.slice(-30).map(x => `<i style="height:${Math.max(2, Math.round(100 * (x[k] || 0) / max))}%" title="${esc(x.d)}: ${x[k] || 0}"></i>`).join('')}</div>`; };
  const issue = Math.floor((Date.now() - new Date('2026-10-16T00:00:00Z')) / 86400000) + 1;
  res.send(page({ title: 'The owner’s view', body: `<header class="mast"><div class="mast-in"><div class="fig">${FIGURE}</div><div class="mast-t"><h1>The Owner’s View</h1><p class="mast-d">${dateLine()} · No. ${issue} · <em>the house, by its own instruments</em></p></div><form method="post" action="/out" class="out"><button>Out</button></form></div><div class="rule"></div></header>
<main class="osheet">
<section class="orow"><h2>The number</h2><div class="otiles">
${tile(n(O.theNumber && O.theNumber.strangersThisWeek), 'collected by strangers this week', `${n(O.theNumber && O.theNumber.strangersLastWeek)} last week`)}
${tile(money(m.week ? m.week.total : 0), 'sold this week', `${money(m.week ? m.week.makers : 0)} to makers · ${money(m.week ? m.week.house : 0)} the house`)}
${tile(money(m.month ? m.month.total : 0), 'this month', `${m.month ? m.month.n : 0} sale${m.month && m.month.n === 1 ? '' : 's'}`)}
${tile(money(m.all ? m.all.total : 0), 'since the first day', `${money(m.all ? m.all.makers : 0)} to makers`)}
${tile(m.fridayLast ? money(m.fridayLast.amount) : '–', 'last Friday pay', m.fridayLast ? `${m.fridayLast.makers} maker${m.fridayLast.makers === 1 ? '' : 's'} · ${ago(m.fridayLast.at)}` : 'none yet')}
${tile(money(m.owed || 0), 'owed to makers', m.feeSide === 'collector' ? 'the house’s share paid by the collector' : '')}
</div></section>
<section class="orow"><h2>Live</h2><div class="otiles">
${tile(live.now == null ? '–' : n(live.now), 'on the site now', live.lastHour ? `${n(live.lastHour.page)} pages in the last hour` : '')}
${tile(live.speed && live.speed.page ? `${live.speed.page.p50} ms` : '–', 'page, median', live.speed && live.speed.page ? `p95 ${live.speed.page.p95} ms · API p50 ${live.speed.api.p50} ms` : '')}
${tile(n(live.errors7d), 'server errors, 7 days', live.faults ? `${live.faults.exceptions || 0} exceptions · ${live.faults.rejections || 0} rejections since start` : '')}
${tile(live.up ? `${Math.floor(live.up / 3600)} h` : '–', 'up since the last deploy', `version ${esc(live.ver || '')} · ${esc(live.role || 'all')}${live.worker ? ` · worker ${live.worker.stale ? '<b class="bad">stale</b>' : 'beating'}` : ''}`)}
${tile(live.backup && live.backup.last ? (live.backup.stale ? '<b class="bad">stale</b>' : 'fresh') : '–', 'backups', live.backup && live.backup.drill ? `drill ${live.backup.drill.ok ? 'passed' : '<b class="bad">failed</b>'} ${ago(live.backup.drill.at)}` : '')}
${tile(reg.ok ? 'intact' : '<b class="bad">broken</b>', 'the register', `${n(reg.entries)} entries${reg.anchors && reg.anchors.bitcoin ? ` · in Bitcoin to ${n(reg.anchors.bitcoin.seq)}` : reg.anchors && reg.anchors.latest ? ' · anchored, pending' : ''}`)}
</div></section>
<section class="orow"><h2>Growth</h2><div class="otiles">
${tile(n(p.visitors7d), 'visitors, 7 days', `${n(p.visitorsPrior)} the week before · ${n(p.visitors30d)} in 30`)}
${tile(n(p.stood7d), 'stood before a work', `${n(p.hats7d)} hats · ${n(p.bravos7d)} bravos · ${n(p.signins7d)} sign-ins`)}
${tile(n(g.works && g.works.n), 'works', `+${n(g.works && g.works.week)} this week`)}
${tile(n(g.makers && g.makers.n), 'makers', `+${n(g.makers && g.makers.week)} this week`)}
${tile(n(g.collectors && g.collectors.n), 'collectors', `+${n(g.collectors && g.collectors.week)} first-time this week`)}
${tile(g.comeBack && g.comeBack.n >= 3 ? `${g.comeBack.pct}%` : '–', 'come back within 60 days', g.comeBack ? `of ${g.comeBack.n}` : 'from three collectors')}
${tile(g.firstSale && g.firstSale.n >= 2 ? `${g.firstSale.median} d` : '–', 'a maker’s first sale', g.firstSale ? `median of ${g.firstSale.n}` : 'from two makers')}
${tile(g.standing ? n(g.standing.n) : '–', 'standing orders', g.standing ? `${money(g.standing.cents || 0)} a month` : '')}
</div><div class="ocharts"><div><h3>Visitors by day</h3>${spark(g.visitorsByDay, 'visitors')}</div><div><h3>Pieces collected by day</h3>${spark(g.collectsByDay, 'n')}</div></div></section>
<section class="orow"><h2>The vault</h2><div class="otiles">
${tile(`${(v.bytes / 1e9).toFixed(1)} GB`, 'masters, byte for byte', v.works ? `${(v.bytes / 1e6 / v.works).toFixed(0)} MB a work` : '')}
${tile(n(v.institutions), 'institutions', '')}${tile(n(v.books), 'books', '')}${tile(n(v.records), 'records', '')}${tile(n(v.films), 'films', '')}
${tile(v.lost ? `<b class="bad">${v.lost}</b>` : '0', 'originals lost', `${n(v.unvaulted)} not yet in the vault`)}
</div></section>
<section class="orow"><h2>The machine</h2><div class="otiles">
${c ? tile(money(c.monthly * 100), 'a month, all vendors', Object.entries(c.byVendor).map(([k, val]) => `${esc(k)} $${val}`).join(' · ')) : tile('–', 'a month', 'set COSTS_MONTHLY in Render')}
${c && c.per1kVisitors != null ? tile(`$${c.per1kVisitors}`, 'per thousand visitors', `${n(c.visitors30d)} visitors in 30 days`) : ''}
${c && c.grossMargin != null ? tile(`${c.grossMargin}%`, 'gross margin, this month', 'the house’s share less the vendors') : ''}
${tile(esc(O.velocity && O.velocity.version || ''), 'version', `${O.velocity ? O.velocity.releasesThisWeek : 0} release${O.velocity && O.velocity.releasesThisWeek === 1 ? '' : 's'} this week · ${O.velocity ? O.velocity.releases : 0} in all`)}
</div></section>
<p class="fine">Every figure is computed by the house from its own tables when this page is opened; nothing is typed in. Read at ${esc(new Date().toLocaleTimeString('en-US', { timeZone: TZ }))} New York. <a href="/">The desk</a> · <a href="${BASE}/studio/analytics">The numbers</a> · <a href="${BASE}/ledger">The register</a></p>
</main>` }));
});
app.get('/api/all', async (req, res) => { const [watermark, stripe, notion, render, ghost, health] = await Promise.all([S.watermark(), S.stripe(), S.notion(), S.render(), S.ghost(), S.health()]); res.json({ watermark, stripe, notion, render, ghost, health }); });
app.get('/api/owner', async (req, res) => res.json(await S.owner()));

if (require.main === module) { const port = Number(E.PORT) || 4100; app.listen(port, () => console.log(`[desk] on ${port}; ${WHO.length ? WHO.join(', ') : 'DESK_EMAIL not set: no one can enter'}`)); }
module.exports = { app, S };
