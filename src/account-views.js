// What a maker sees in their own Watermark account, and the Studio page that invites them.
const { layout, esc, money, date } = require('./views');

function signedOut() {
  return layout({ title: 'Your account · Watermark', studio: true, body: `<section class="narrow"><p class="k">Your account</p><h1>Sign in with your link.</h1>
<p class="lede">Watermark accounts open from the link we send you; there is no password to remember. Lost it? Write to us and we will send a fresh one.</p></section>` });
}
function gone() {
  return layout({ title: 'Link used · Watermark', studio: true, body: `<section class="narrow"><p class="k">Your account</p><h1>This link has been used.</h1>
<p class="lede">Each sign-in link works once. If this is your device, you are probably already signed in: <a href="/account">open your account</a>. Otherwise ask for a fresh link.</p></section>` });
}

function studioAccounts({ list, base, notice }) {
  const rows = list.map(m => `<tr><td><b>${esc(m.name)}</b>${m.house ? `<br><small>${esc(m.house)}</small>` : ''}</td><td>${m.kind === 'estate' ? 'Estate' : 'Maker'}</td><td>${m.works}</td><td>${m.joined_at ? 'Joined ' + date(m.joined_at) : 'Invited'}</td>
<td>${m.invite_token ? `<input class="copy" readonly value="${esc(base)}/account/join/${esc(m.invite_token)}" onclick="this.select()">` : `<form method="post" action="/studio/accounts/${m.id}/link" class="inline"><button class="link">New sign-in link</button></form>`}</td>
<td><a href="/account?maker=${esc(m.handle)}">Their dashboard</a></td></tr>`).join('');
  return layout({ studio: true, title: 'Accounts · Watermark', body: `<section class="studio-wrap"><nav class="snav"><a href="/studio">Trove</a><a href="/studio/activity">Activity</a><a href="/studio/works">Vault</a><a href="/studio/masters">Masters</a><a href="/studio/licenses">Licenses</a><a href="/studio/sightings">Sightings</a><a href="/studio/uses">Uses &amp; prices</a><a href="/studio/accounts" aria-current="page">Accounts</a><a href="/studio/makers">Makers</a></nav>
<p class="k">Accounts</p><h1>Every maker, their own Watermark.</h1>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<p class="lede">Each maker or estate gets an account and a sign-in link. Send the link yourself; it works once and signs them in on that device. They keep 85% of every sale.</p>
<table class="tbl"><thead><tr><th>Account</th><th>Kind</th><th>Works</th><th>Status</th><th>Sign-in link</th><th></th></tr></thead><tbody>${rows}</tbody></table>
<h2>Invite a maker or an estate</h2>
<form method="post" action="/studio/accounts" class="form inline-form"><label>Name<input name="name" required placeholder="Greg Williams"></label><label>Email<input name="email" type="email" placeholder="Optional"></label><label>Studio or estate<input name="house" placeholder="Optional"></label>
<label>Kind<select name="kind"><option value="maker">Maker</option><option value="estate">Estate</option></select></label><button>Create the account</button></form></section>` });
}

function dashboard({ m, pct, works, jewels, byUse, recent, totals, toMaker, multiple, viewing }) {
  const hidden = viewing ? `<input type="hidden" name="maker" value="${esc(m.handle)}">` : '';
  const star = w => `<form method="post" action="/account/works/${esc(w.slug)}/jewel" class="inline">${hidden}<button class="jw${w.curated ? ' on' : ''}" title="${w.curated ? 'Remove from your jewels' : 'Mark as a jewel'}" aria-pressed="${w.curated ? 'true' : 'false'}">${w.curated ? '&#9733;' : '&#9734;'}</button></form>`;
  const jewel = w => `<div class="ac-j" id="w-${esc(w.slug)}"><a href="/w/${esc(w.slug)}" class="ac-jf"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" draggable="false"></a>
<div class="ac-jt"><b>${esc(w.title)}</b>${star(w)}</div><dl class="ac-jm"><div><dt>To you</dt><dd>${money(toMaker(w.gross))}</dd></div><div><dt>Shares</dt><dd>${w.shares}</dd></div><div><dt>Licenses</dt><dd>${w.licenses}</dd></div><div><dt>Seen, 30 days</dt><dd>${w.seen30}</dd></div><div><dt>Sightings</dt><dd>${w.sightings}</dd></div><div><dt>Share it</dt><dd>${w.share_cents ? money(w.share_cents) : 'Standard'}</dd></div></dl></div>`;
  const kinds = byUse.map(u => `<tr><td>${esc(u.name)}</td><td>${u.n}</td><td>${money(u.gross)}</td><td><b>${money(toMaker(u.gross))}</b></td></tr>`).join('');
  const sales = recent.map(l => `<tr><td>${date(l.starts_at)}</td><td><a href="/w/${esc(l.slug)}">${esc(l.title)}</a></td><td>${esc(l.use_name)}</td><td>${money(l.price_cents)}</td><td><b>${money(toMaker(l.price_cents))}</b></td></tr>`).join('');
  const all = works.map(w => `<tr id="w-${esc(w.slug)}"><td>${star(w)}</td><td><img src="/img/${esc(w.slug)}/thumb" alt="" width="56" loading="lazy" draggable="false"></td><td><a href="/w/${esc(w.slug)}">${esc(w.title)}</a><br><small>${esc(w.place || '')}${w.status === 'held' ? '' : ' · private'}</small></td><td>${w.seen30}</td><td>${w.shares}</td><td>${w.licenses}</td><td>${money(toMaker(w.gross))}</td></tr>`).join('');
  return layout({ title: `${m.name} · Watermark`, studio: true, body: `<section class="studio-wrap ac">
${viewing ? `<p class="ok">You are viewing ${esc(m.name)}'s dashboard as they see it. <a href="/studio/accounts">Back to accounts</a></p>` : ''}
<p class="k">${m.kind === 'estate' ? 'Estate' : 'Your Watermark'}${m.house ? ' · ' + esc(m.house) : ''}</p><h1>${esc(m.name)}.</h1>
<div class="stats ac-stats"><div><b>${money(totals.earned)}</b><span>earned, all time</span></div><div><b>${money(totals.earned30)}</b><span>last 30 days</span></div><div><b>${totals.shares}</b><span>shares sold</span></div><div><b>${totals.jewels}</b><span>jewels</span></div><div><b>${totals.works}</b><span>works held (${totals.public} public)</span></div>
<div><b>${totals.value != null ? money(totals.value) : '&mdash;'}</b><span>archive value, estimate</span></div></div>
<p class="note">You keep ${pct}% of every sale; figures here are your share. Archive value is ${multiple}&times; your last twelve months of earnings, an illustration rather than an appraisal${totals.value == null ? '; it appears once you have sales' : ''}.</p>
<h2>Your jewels</h2>${jewels.length ? `<div class="ac-js">${jewels.map(jewel).join('')}</div>` : '<p class="note">Mark the works that matter most with the star; they lead this page and are the first we show buyers.</p>'}
<h2>What is selling</h2><table class="tbl"><thead><tr><th>Use</th><th>Sold</th><th>Paid</th><th>To you</th></tr></thead><tbody>${kinds}</tbody></table>
<h2>Recent sales</h2><table class="tbl"><thead><tr><th>Date</th><th>Work</th><th>Use</th><th>Paid</th><th>To you</th></tr></thead><tbody>${sales || '<tr><td colspan="5">No sales yet.</td></tr>'}</tbody></table>
<h2>Everything you hold</h2><table class="tbl ac-all"><thead><tr><th></th><th></th><th>Work</th><th>Seen, 30 days</th><th>Shares</th><th>Licenses</th><th>To you</th></tr></thead><tbody>${all || '<tr><td colspan="7">Nothing here yet.</td></tr>'}</tbody></table>
<p class="note"><a href="/account/logout">Sign out</a></p></section>` });
}

module.exports = { signedOut, gone, studioAccounts, dashboard };
