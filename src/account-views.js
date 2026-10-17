// What a maker sees in their own Watermark account, and the Studio page that invites them.
const { layout, esc, money, date } = require('./views');

function signedOut() {
  return layout({ title: 'Your account · Watermark', studio: true, body: `<section class="narrow" data-passkey-box><p class="k">For makers</p><h1>Sign in to your room.</h1>
<p class="lede">With the passkey you saved: Face ID, Touch ID or your phone. The first time, open the invitation link we sent you.</p>
<p><button class="buy-btn" data-passkey="maker-signin">Sign in with a passkey</button></p><p class="pk-msg" data-passkey-msg></p>
<p class="note">Not a Watermark maker yet? <a href="/makers#apply">Apply</a>. Lost everything? Write to us and we will send a fresh invitation.</p></section>
<script src="/static/webauthn.js" defer></script><script src="/static/auth.js" defer></script>` });
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

function dashboard({ m, pct, works, jewels, byUse, recent, totals, toMaker, multiple, viewing, need, keyed = true }) {
  const hidden = viewing ? `<input type="hidden" name="maker" value="${esc(m.handle)}">` : '';
  const star = w => `<form method="post" action="/account/works/${esc(w.slug)}/jewel" class="inline">${hidden}<button class="jw${w.curated ? ' on' : ''}" title="${w.curated ? 'Remove from your jewels' : 'Mark as a jewel'}" aria-pressed="${w.curated ? 'true' : 'false'}">${w.curated ? '&#9733;' : '&#9734;'}</button></form>`;
  const jewel = w => `<div class="ac-j" id="w-${esc(w.slug)}"><a href="/w/${esc(w.slug)}" class="ac-jf"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" draggable="false"></a>
<div class="ac-jt"><b>${esc(w.title)}</b>${star(w)}</div><dl class="ac-jm"><div><dt>To you</dt><dd>${money(toMaker(w.gross))}</dd></div><div><dt>Shares</dt><dd>${w.shares}</dd></div><div><dt>Licenses</dt><dd>${w.licenses}</dd></div><div><dt>Seen, 30 days</dt><dd>${w.seen30}</dd></div><div><dt>Sightings</dt><dd>${w.sightings}</dd></div><div><dt>Share it</dt><dd>${w.share_cents ? money(w.share_cents) : 'Standard'}</dd></div></dl></div>`;
  const kinds = byUse.map(u => `<tr><td>${esc(u.name)}</td><td>${u.n}</td><td>${money(u.gross)}</td><td><b>${money(toMaker(u.gross))}</b></td></tr>`).join('');
  const sales = recent.map(l => `<tr><td>${date(l.starts_at)}</td><td><a href="/w/${esc(l.slug)}">${esc(l.title)}</a></td><td>${esc(l.use_name)}</td><td>${money(l.price_cents)}</td><td><b>${money(toMaker(l.price_cents))}</b></td></tr>`).join('');
  const pub = w => viewing ? (w.status === 'held' ? 'Public' : 'Private') : w.status === 'held'
    ? `<form method="post" action="/account/works/${esc(w.slug)}/show" class="inline"><button class="link">Public &middot; make private</button></form>`
    : `<form method="post" action="/account/works/${esc(w.slug)}/show" class="inline ac-pub"><label class="chk"><input type="checkbox" name="attest" value="1" required> I hold the rights, and releases for anyone identifiable</label><button>Publish</button></form>`;
  const all = works.map(w => `<tr id="w-${esc(w.slug)}"><td>${star(w)}</td><td><img src="/img/${esc(w.slug)}/thumb" alt="" width="56" loading="lazy" draggable="false"></td><td><a href="/w/${esc(w.slug)}">${esc(w.title)}</a><br><small>${esc(w.place || '')} &middot; <a href="/voices/${esc(w.slug)}">Add your voice</a></small></td><td>${pub(w)}</td><td>${w.seen30}</td><td>${w.shares}</td><td>${w.licenses}</td><td>${money(toMaker(w.gross))}</td></tr>`).join('');
  return layout({ title: `${m.name} · Watermark`, studio: true, body: `<section class="studio-wrap ac">
${viewing ? `<p class="ok">You are viewing ${esc(m.name)}'s dashboard as they see it. <a href="/studio/accounts">Back to accounts</a></p>` : ''}
<p class="k">${m.kind === 'estate' ? 'Estate' : 'Your Watermark'}${m.house ? ' · ' + esc(m.house) : ''}</p><h1>${esc(m.name)}.</h1>
${!viewing && !keyed ? `<div class="pk" data-passkey-box><div><b>Save your sign-in.</b><p>A passkey (Face ID, Touch ID or your phone) lets you come back to your room from any device, with no link and no password.</p><button class="pk-go" data-passkey="maker-save">Save with a passkey</button><p class="pk-msg" data-passkey-msg></p></div></div><script src="/static/webauthn.js" defer></script><script src="/static/auth.js" defer></script>` : ''}
<div class="stats ac-stats"><div><b>${money(totals.earned)}</b><span>earned, all time</span></div><div><b>${money(totals.earned30)}</b><span>last 30 days</span></div><div><b>${totals.shares}</b><span>shares sold</span></div><div><b>${totals.jewels}</b><span>jewels</span></div><div><b>${totals.works}</b><span>works held (${totals.public} public)</span></div>
<div><b>${totals.value != null ? money(totals.value) : '&mdash;'}</b><span>archive value, estimate</span></div></div>
<p class="note">You keep ${pct}% of every sale; figures here are your share. Archive value is ${multiple}&times; your last twelve months of earnings, an illustration rather than an appraisal${totals.value == null ? '; it appears once you have sales' : ''}.</p>
<h2>Your jewels</h2>${jewels.length ? `<div class="ac-js">${jewels.map(jewel).join('')}</div>` : '<p class="note">Mark the works that matter most with the star; they lead this page and are the first we show collectors.</p>'}
<h2>What is selling</h2><table class="tbl"><thead><tr><th>Use</th><th>Sold</th><th>Paid</th><th>To you</th></tr></thead><tbody>${kinds}</tbody></table>
<h2>Recent sales</h2><table class="tbl"><thead><tr><th>Date</th><th>Work</th><th>Use</th><th>Paid</th><th>To you</th></tr></thead><tbody>${sales || '<tr><td colspan="5">No sales yet.</td></tr>'}</tbody></table>
<h2>Everything you hold</h2>${viewing ? '' : '<p><a class="buy-btn ac-up" href="/account/upload">Add photographs</a></p>'}${need === 'attest' ? '<p class="err">To publish, confirm you hold the rights and any releases.</p>' : ''}<table class="tbl ac-all"><thead><tr><th></th><th></th><th>Work</th><th>On Watermark</th><th>Seen, 30 days</th><th>Shares</th><th>Licenses</th><th>To you</th></tr></thead><tbody>${all || '<tr><td colspan="8">Nothing here yet.</td></tr>'}</tbody></table>
<p class="note"><a href="/account/logout">Sign out</a></p></section>` });
}

function upload({ m }) {
  return layout({ title: 'Add photographs · Watermark', studio: true, body: `<section class="studio-wrap"><p class="k"><a href="/account">${esc(m.name)}</a></p><h1>Add photographs.</h1>
<p class="lede">Full-resolution files: JPEG, TIFF or PNG. Each is fingerprinted, sealed in the vault and written to the ledger the moment it arrives. They stay private until you publish them from your account.</p>
<form class="form upload bulk" onsubmit="return false"><label class="drop"><input type="file" id="aFiles" accept="image/jpeg,image/png,image/tiff" multiple><b>Choose photographs or a folder&rsquo;s worth</b><span>Titles come from the file names; refine them later.</span></label>
<label>Place, for all<input id="aPlace" placeholder="Florence, Italy"></label><button type="button" id="aGo" disabled>Choose photographs</button><ol class="bulk-list" id="aList"></ol></form>
<script>(function(){var inp=document.getElementById('aFiles'),go=document.getElementById('aGo'),list=document.getElementById('aList'),files=[];
inp.onchange=function(){files=[].slice.call(inp.files);go.disabled=!files.length;go.textContent='Hold '+files.length+' photograph'+(files.length===1?'':'s')};
go.onclick=async function(){go.disabled=true;var ok=0,i=0;async function one(){while(i<files.length){var f=files[i++],li=document.createElement('li');li.textContent=f.name;list.appendChild(li);var fd=new FormData();fd.append('file',f);fd.append('place',document.getElementById('aPlace').value);
try{var j=await (await fetch('/account/works/one',{method:'POST',body:fd,credentials:'same-origin'})).json();li.className=j.ok?'done':'skip';li.textContent=f.name+(j.ok?' · held':' · '+j.error);if(j.ok)ok++}catch(e){li.className='skip';li.textContent=f.name+' · connection lost'}go.textContent=i+' of '+files.length}}
await Promise.all([one(),one()]);go.textContent=ok+' held';setTimeout(function(){location.href='/account'},1200)};})();</script></section>` });
}

module.exports = { signedOut, gone, studioAccounts, dashboard, upload };
