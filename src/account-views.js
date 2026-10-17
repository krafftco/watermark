// What a maker sees in their own Watermark account, and the Studio page that invites them.
const { layout, esc, money, date } = require('./views');

function signedOut() {
  return layout({ title: 'Your account · Watermark', studio: true, body: `<section class="narrow" data-passkey-box><p class="k">For makers</p><h1>Sign in to your room.</h1>
<p class="lede">With the passkey you saved: Face ID, Touch ID or your phone. The first time, open the invitation link we sent you.</p>
<p><button class="buy-btn" data-passkey="maker-signin">Sign in with a passkey</button></p><p class="pk-msg" data-passkey-msg></p>
<p class="note">Not a Watermark maker yet? <a href="/join">Open your studio</a>. Lost everything? Write to us and we will send a fresh invitation.</p></section>
<script src="/static/webauthn.js" defer></script><script src="/static/auth.js" defer></script>` });
}

// Open a studio: a name and an email, and you are in.
function join({ err = null, name = '', email = '' }) {
  const msg = { name: 'Your name, as it should appear beside your work.', email: 'An email address, so your studio can find you again.', known: 'There is already a studio under that email. Sign in with your passkey, or write to us for a fresh link.' }[err];
  return layout({ title: 'Open your studio · Watermark', body: `<section class="narrow jn"><p class="k">For makers</p><h1>Open your studio.</h1>
<p class="lede">Hold your photographs on Watermark: fingerprinted on arrival, shown on your own page, collected and licensed at the source. You keep the copyright; 85% of every sale is yours. It takes a minute.</p>
${msg ? `<p class="err">${esc(msg)}</p>` : ''}
<form method="post" action="/join" class="form">
<label>Your name<input name="name" value="${esc(name)}" required autocomplete="name" autofocus></label>
<label>Email<input name="email" type="email" value="${esc(email)}" required autocomplete="email"></label>
<label>Studio or house <small>optional</small><input name="house" placeholder="If you work under a name"></label>
<button class="buy-btn">Open my studio</button>
<p class="note">By opening a studio you confirm that the photographs you upload are your own and that you hold the rights to them. Nothing is public until you publish it, and each publication is your word on that. <a href="/terms">The terms</a>.</p></form>
<p class="sr-also">Already a maker? <a href="/account">Sign in</a>.</p></section>` });
}
// The maker's profile: what their page says about them.
function profile({ m, saved = null, slug }) {
  return layout({ title: 'Your profile · Watermark', studio: true, body: `<section class="narrow pf-ed"><p class="k">Your studio</p><h1>Your page.</h1>
<p class="lede">This is what people find at <a href="/m/${esc(slug)}">watermark.krafftco.com/m/${esc(slug)}</a>: who you are, where you work, and your photographs.</p>
${saved ? '<p class="ok">Saved.</p>' : ''}
<form method="post" action="/account/profile" enctype="multipart/form-data" class="form">
<div class="pf-por">${m.portrait ? `<img src="/portrait/${esc(m.handle)}?v=${esc(m.portrait)}" alt="">` : '<span class="pf-none"></span>'}<label class="pf-up"><input type="file" name="portrait" accept="image/*"><span>${m.portrait ? 'Change the portrait' : 'Add a portrait'}</span></label>${m.portrait ? '<label class="chk"><input type="checkbox" name="remove_portrait" value="1"> Remove it</label>' : ''}</div>
<label>Name<input name="name" value="${esc(m.name)}" required></label>
<label>Studio or house<input name="house" value="${esc(m.house || '')}"></label>
<label>Where you work<input name="place" value="${esc(m.place || '')}" placeholder="New York"></label>
<label>About you <small>a few lines, in your words</small><textarea name="bio" rows="5" maxlength="700">${esc(m.bio || '')}</textarea></label>
<label>Website<input name="site" value="${esc(m.site || '')}" placeholder="yourname.com"></label>
<label>Instagram<input name="instagram" value="${esc(m.instagram || '')}" placeholder="@yourname"></label>
<button class="btn">Save</button></form>
<p class="sr-also"><a href="/account">Your studio</a> &middot; <a href="/account/upload">Add photographs</a></p></section>` });
}
function gone() {
  return layout({ title: 'Link used · Watermark', studio: true, body: `<section class="narrow"><p class="k">Your account</p><h1>This link has been used.</h1>
<p class="lede">Each sign-in link works once. If this is your device, you are probably already signed in: <a href="/account">open your account</a>. Otherwise ask for a fresh link.</p></section>` });
}

function studioAccounts({ list, base, notice }) {
  const rows = list.map(m => `<tr><td><b>${esc(m.name)}</b>${m.house ? `<br><small>${esc(m.house)}</small>` : ''}</td><td>${m.kind === 'estate' ? 'Estate' : 'Maker'}</td><td>${m.works}</td><td>${m.joined_at ? 'Joined ' + date(m.joined_at) : 'Invited'}</td>
<td>${m.invite_token ? `<input class="copy" readonly value="${esc(base)}/account/join/${esc(m.invite_token)}" onclick="this.select()">` : `<form method="post" action="/studio/accounts/${m.id}/link" class="inline"><button class="link">New sign-in link</button></form>`}</td>
<td><a href="/account?maker=${esc(m.handle)}">Their dashboard</a> &middot; <form method="post" action="/studio/accounts/${m.id}/standing" class="inline"><button class="link">${m.standing === 'held' ? 'Release' : 'Hold'}</button></form></td></tr>`).join('');
  return layout({ studio: true, title: 'Accounts · Watermark', body: `<section class="studio-wrap">${require('./studio-views').nav('/studio/accounts')}
<p class="k">Accounts</p><h1>Every maker, their own Watermark.</h1>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<p class="lede">Anyone can open a studio at /join and is listed here as they arrive. You can also invite a maker or an estate with a sign-in link. Hold a maker and their work goes private until you release them. They keep 85% of every sale.</p>
<table class="tbl"><thead><tr><th>Account</th><th>Kind</th><th>Works</th><th>Status</th><th>Sign-in link</th><th></th></tr></thead><tbody>${rows}</tbody></table>
<h2>Invite a maker or an estate</h2>
<form method="post" action="/studio/accounts" class="form inline-form"><label>Name<input name="name" required placeholder="Greg Williams"></label><label>Email<input name="email" type="email" placeholder="Optional"></label><label>Studio or estate<input name="house" placeholder="Optional"></label>
<label>Kind<select name="kind"><option value="maker">Maker</option><option value="estate">Estate</option></select></label><button>Create the account</button></form></section>` });
}

function dashboard({ m, pct, works, jewels, byUse, recent, totals, toMaker, multiple, viewing, need, keyed = true, welcome = false, stars = null, culled = null, keeping = null }) {
  const all = works; if (stars) works = works.filter(w => w.stars === stars);
  const grade = w => `<form method="post" action="/account/works/${esc(w.slug)}/stars" class="st" data-stars="${w.stars}" data-slug="${esc(w.slug)}">${viewing ? `<input type="hidden" name="maker" value="${esc(m.handle)}">` : ''}${[1, 2, 3, 4, 5].map(n => `<button name="n" value="${n}" class="${w.stars >= n ? 'on' : ''}" aria-label="${n} star${n === 1 ? '' : 's'}" title="${n}">&#9733;</button>`).join('')}</form>`;
  const counts = [5, 4, 3, 2, 1, 0].map(n => [n, all.filter(w => w.stars === n).length]);
  const hidden = viewing ? `<input type="hidden" name="maker" value="${esc(m.handle)}">` : '';
  const star = w => `<form method="post" action="/account/works/${esc(w.slug)}/jewel" class="inline">${hidden}<button class="jw${w.curated ? ' on' : ''}" title="${w.curated ? 'Remove from your jewels' : 'Mark as a jewel'}" aria-pressed="${w.curated ? 'true' : 'false'}">${w.curated ? '&#9733;' : '&#9734;'}</button></form>`;
  const jewel = w => `<a class="ac-j" id="j-${esc(w.slug)}" href="/w/${esc(w.slug)}"><span class="ac-jf"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" draggable="false"></span><b>${esc(w.title)}</b><span>${money(toMaker(w.gross))} &middot; ${w.seen30} seen</span></a>`;
  const pub = w => viewing ? `<span class="ac-st">${w.status === 'held' ? 'Public' : 'Private'}</span>` : w.status === 'held'
    ? `<form method="post" action="/account/works/${esc(w.slug)}/show" class="inline"><button class="link ac-st">Public</button></form>`
    : `<details class="ac-pub"><summary>Private &middot; <u>Publish</u></summary><form method="post" action="/account/works/${esc(w.slug)}/show"><label><input type="checkbox" name="attest" value="1" required> I hold the rights, and releases for anyone identifiable</label><button>Publish</button></form></details>`;
  const row = w => `<div class="hd-row ac-row" id="w-${esc(w.slug)}"><a href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy" draggable="false"></a>
<span class="hd-t"><b><a href="/w/${esc(w.slug)}">${esc(w.title)}</a></b><small>${esc(w.place || '')}${viewing ? '' : `${w.place ? ' &middot; ' : ''}<a href="/voices/${esc(w.slug)}">Add your voice</a>`}</small></span>
<span>${pub(w)}</span><span class="hd-c">${w.shares + w.licenses}</span><span class="hd-c">${w.seen30}</span><span class="hd-v">${money(toMaker(w.gross))}</span><span class="ac-star">${grade(w)}</span></div>`;
  const collected = byUse.filter(u => u.key === 'social').reduce((a, u) => a + u.gross, 0), licensed = byUse.filter(u => u.key !== 'social').reduce((a, u) => a + u.gross, 0);
  const share = c => (collected + licensed ? Math.round(100 * c / (collected + licensed)) : 0);
  const privateN = works.filter(w => w.status !== 'held').length;
  const needs = viewing ? [] : [
    privateN ? `<li><a href="#holdings"><b>${privateN}</b> photograph${privateN === 1 ? '' : 's'} waiting to be published<span>&rarr;</span></a></li>` : '',
    !jewels.length && works.length ? `<li><a href="#holdings"><b>&#9734;</b> Star the works that matter most; collectors see them first<span>&rarr;</span></a></li>` : '',
  ].filter(Boolean);
  return layout({ title: `${m.name} · Watermark`, studio: true, body: `<section class="studio-wrap hd ac">
${viewing ? `<p class="ok">You are viewing ${esc(m.name)}'s studio as they see it. <a href="/studio/accounts">Back to accounts</a></p>` : ''}
<header class="ac-bar"><div><p class="k">${m.kind === 'estate' ? 'The estate' : 'Your studio'}${m.house ? ' &middot; ' + esc(m.house) : ''}</p><h1>${esc(m.name)}.</h1></div>
${viewing ? '' : `<nav><a class="buy-btn ac-up" href="/account/upload">Add photographs</a><a href="/account/logout">Sign out</a></nav>`}</header>
${!viewing && !keyed ? `<div class="pk" data-passkey-box><div><b>Save your sign-in.</b><p>A passkey (Face ID, Touch ID or your phone) brings you back to your studio from any device, with no link and no password.</p><button class="pk-go" data-passkey="maker-save">Save with a passkey</button><p class="pk-msg" data-passkey-msg></p></div></div><script src="/static/webauthn.js" defer></script><script src="/static/auth.js" defer></script>` : ''}
<div class="hd-top"><div class="hd-big"><b>${money(totals.earned + (totals.tips || 0) + (totals.royalties || 0))}</b><span>to you, all time${totals.earned30 ? ` &middot; ${money(totals.earned30)} in the last 30 days` : ''}</span></div>
<div class="hd-mix"><div><span class="k">Collected</span><b>${money(toMaker(collected))}</b><i style="--p:${share(collected)}%"></i></div><div><span class="k">Licensed</span><b>${money(toMaker(licensed))}</b><i style="--p:${share(licensed)}%"></i></div>
<div><span class="k">Royalties</span><b>${money(totals.royalties || 0)}</b><small>${totals.resales ? `From ${totals.resales} resale${totals.resales === 1 ? '' : 's'} between collectors` : '10% of every resale of your work'}</small></div>
<div><span class="k">Tips</span><b>${money(totals.tips || 0)}</b><small>${totals.tipsN ? `${totals.tipsN} from readers` : 'From readers of the stories you made'}</small></div>
<div><span class="k">Archive value</span><b>${totals.value != null ? money(totals.value) : '&mdash;'}</b><small>${totals.value != null ? `${multiple}&times; the last twelve months; an illustration, not an appraisal` : 'Appears once you have sales'}</small></div></div>
<div class="hd-held"><span><b>${totals.works}</b> works held</span><span><b>${totals.public}</b> public</span><span><b>${totals.jewels}</b> jewels</span><span><b>${totals.shares}</b> collected</span><span>You keep <b>${pct}%</b> of every sale</span></div></div>
${needs.length ? `<section class="hd-need"><h2>Needs you</h2><ul>${needs.join('')}</ul></section>` : ''}
${jewels.length ? `<section class="hd-list"><div class="hd-h"><h2>Your jewels</h2></div><div class="ac-js">${jewels.map(jewel).join('')}</div></section>` : ''}
<section class="hd-list" id="holdings"><div class="hd-h"><h2>The holdings</h2>${all.length ? `<span class="hd-n">${works.length === all.length ? `${all.length} work${all.length === 1 ? '' : 's'}` : `${works.length} of ${all.length}`}</span>` : ''}</div>
${all.length ? `<div class="st-bar"><nav class="st-f" aria-label="By stars"><a href="/account#holdings"${stars ? '' : ' aria-current="page"'}>All</a>${counts.map(([n, c]) => `<a href="/account?stars=${n}#holdings"${stars === n ? ' aria-current="page"' : ''}${c ? '' : ' class="is-0"'}>${n ? '&#9733;'.repeat(n) : 'Ungraded'}<small>${c}</small></a>`).join('')}</nav>
${viewing ? '' : `<form method="post" action="/account/cull" class="st-cull"><span>Keep public from</span><select name="from" aria-label="Stars"><option value="3">&#9733;&#9733;&#9733;</option><option value="4">&#9733;&#9733;&#9733;&#9733;</option><option value="5">&#9733;&#9733;&#9733;&#9733;&#9733;</option><option value="2">&#9733;&#9733;</option></select><button class="link">Cull</button></form>`}</div>
${culled ? `<p class="ok">Culled from ${'&#9733;'.repeat(culled.from)}: ${culled.down} made private, ${culled.up} brought back. Nothing is deleted; every photograph stays fingerprinted and registered, and culled work weighs a quarter toward Keeping.</p>` : ''}
<p class="st-help">Grade your work as you would in Lightroom: press 1 to 5 on a row, or click the stars. Five is a jewel and leads your page. Culling keeps the archive honest: the rubies in front, the rest kept but out of the way.${keeping ? ` Held: ${keeping.works} photograph${keeping.works === 1 ? '' : 's'}, weighing ${keeping.weighed} toward the free line of ${keeping.terms.freeWorks}. <a href="/account/keeping">Keeping</a>.` : ''}</p>` : ''}
${welcome ? `<p class="ok">Your studio is open. <a href="/account/upload">Add your first photographs</a>, then <a href="/account/profile">tell people who you are</a>.</p>` : ''}${m.standing === 'held' ? '<p class="err">Your studio is held by Watermark while we look at something. Your work is private until it is released; write to us if you have questions.</p>' : ''}${need === 'attest' ? '<p class="err">To publish, confirm you hold the rights and any releases.</p>' : need === 'held' ? '<p class="err">Your studio is held; nothing can be published until it is released.</p>' : ''}
${works.length ? `<div class="hd-head ac-row"><span></span><span>Work</span><span>On Watermark</span><span class="hd-c">Sold</span><span class="hd-c">Seen, 30d</span><span class="hd-v">To you</span><span></span></div>${works.map(row).join('')}` : `<p class="hd-calm">Nothing here yet. ${viewing ? '' : '<a href="/account/upload">Add your first photographs</a>; they stay private until you publish them.'}</p>`}</section>
${recent.length ? `<section class="hd-list"><div class="hd-h"><h2>Lately</h2></div>${recent.map(l => `<a class="hd-ev" href="/w/${esc(l.slug)}"><span>${date(l.starts_at)}</span><b>${esc(l.title)}</b><span>${esc(l.use_name)}</span><span class="hd-v">${money(toMaker(l.price_cents))}</span></a>`).join('')}</section>` : ''}
</section><script src="/static/stars.js" defer></script>` });
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

module.exports = { join, profile, signedOut, gone, studioAccounts, dashboard, upload };
