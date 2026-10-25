// What a maker sees in their own Watermark account, and the Studio page that invites them.
const { layout, esc, money, date, setDeskPath, VER } = require('./views');

function signedOut() {
  return layout({ title: 'Your room · Watermark', studio: true, body: `<section class="narrow"><p class="k">For makers</p><h1>Sign in to your room.</h1>
<p class="lede">The email your studio is under, and a six-digit code comes back; or the passkey you saved. No password.</p>
<p><a class="buy-btn" href="/signin?next=/account">Sign in</a></p>
<p class="note">Not a Watermark maker yet? Watermark is by invitation; <a href="/join">apply with the work</a>.</p></section>` });
}

// Open a studio: a name and an email, and you are in.
// By invitation. Watermark shows work a curator has looked at; the door is an application, read by the house.
function join({ err = null, sent = false, name = '', email = '' }) {
  const msg = { name: 'Your name, as it would appear beside your work.', email: 'An email address we can write to.', known: 'There is already a studio under that email. <a href="/signin?next=/account">Sign in</a> and it opens.', work: 'Show us where the work can be seen: a site, a book, a gallery, an Instagram.' }[err];
  if (sent) return layout({ title: 'Received · Watermark', body: `<section class="narrow jn"><p class="k">For makers</p><h1>Received.</h1>
<p class="lede">Thank you. Every application is read by the house, in the order it arrives, with the work in front of us. If the work is ready, an invitation comes by mail; if not yet, a word on why. We do not hurry this.</p>
<p class="sr-also"><a href="/artists">The artists whose work hangs here</a> · <a href="/collection">The collection</a></p></section>` });
  return layout({ title: 'By invitation · Watermark', desc: 'Watermark holds work a curator has looked at. Apply with yours.', path: '/join', body: `<section class="narrow jn"><p class="k">For makers</p><h1>By invitation.</h1>
<p class="lede">Watermark is not a place to upload. It is a house that holds work the way a gallery or a museum does: looked at first, then kept, shown, collected and licensed at the source, with the maker's copyright intact and ${require('./fee').yours(85, 'theirs')}. An invitation means a curator has stood in front of your work and said it is ready to be shown. You have to work for it; that is the point.</p>
<p class="lede">What hangs here is work worth presenting, at the level of thought of a great museum. The beautiful rises; the body of work is kept whole. Nothing pornographic; a nude is a thoughtful nude or it does not hang. No identifiable people without their consent.</p>
<h2>Apply with the work</h2>
${msg ? `<p class="err">${msg}</p>` : ''}
<form method="post" action="/apply" class="form">
<label>Your name<input name="name" value="${esc(name)}" required autocomplete="name" autofocus></label>
<label>Email<input name="email" type="email" value="${esc(email)}" required autocomplete="email"></label>
<label>Where the work can be seen<input name="portfolio" placeholder="A site, a book, a gallery, an Instagram" required></label>
<label>Your practice <small>a few words</small><input name="practice" placeholder="Documentary; architecture; the street; an estate"></label>
<label>What you would bring<textarea name="note" rows="4" placeholder="What the work is, how much of it there is, and why it should be kept."></textarea></label>
<button class="buy-btn">Apply</button>
<p class="note">Applications are read by people. If an invitation comes, your studio opens from the letter; nothing is public until you publish it, and each publication is your word that the work is yours. <a href="/terms">The terms</a>.</p></form>
<p class="sr-also">Already a maker? <a href="/account">Sign in</a>.</p></section>` });
}
// The maker's profile: what their page says about them.
function profile({ m, saved = null, slug, intros = '' }) {
  setDeskPath('/account/profile');
  return layout({ title: 'Your profile · Watermark', studio: true, body: `<section class="narrow pf-ed"><p class="k">Your studio</p><h1>Your page.</h1>
<p class="lede">This is what people find at <a href="/m/${esc(slug)}">watermark.krafftco.com/m/${esc(slug)}</a>: who you are, where you work, and your work.</p>
${saved ? '<p class="ok">Saved.</p>' : ''}
<form method="post" action="/account/profile" enctype="multipart/form-data" class="form">
<div class="pf-por">${m.portrait ? `<img src="/portrait/${esc(m.handle)}?v=${esc(m.portrait)}" alt="">` : '<span class="pf-none"></span>'}<label class="pf-up"><input type="file" name="portrait" accept="image/*"><span>${m.portrait ? 'Change the portrait' : 'Add a portrait'}</span></label>${m.portrait ? '<label class="chk"><input type="checkbox" name="remove_portrait" value="1"> Remove it</label>' : ''}</div>
<label>Name<input name="name" value="${esc(m.name)}" required></label>
<label>Studio or house<input name="house" value="${esc(m.house || '')}"></label>
<label>Where you work<input name="place" value="${esc(m.place || '')}" placeholder="New York"></label>
<label>About you <small>a few lines, in your words</small><textarea name="bio" rows="5" maxlength="700">${esc(m.bio || '')}</textarea></label>
<label>Website<input name="site" value="${esc(m.site || '')}" placeholder="yourname.com"></label>
<label>Instagram<input name="instagram" value="${esc(m.instagram || '')}" placeholder="@yourname"></label>
<label>Other addresses that open your studio<input name="emails" value="${esc(m.emails || '')}" placeholder="you@gmail.com, you@work.com" inputmode="email"><small>Sign in with any of them and both your studio and your gallery open.</small></label>
<fieldset class="wide pf-links"><legend>Elsewhere <small>writing, film, music, a shop; up to six</small></legend>${(() => { let L = []; try { L = JSON.parse(m.links || '[]'); } catch (e) { /* none */ } return [0, 1, 2, 3, 4, 5].map(i => `<div class="pf-link"><input name="link_label" value="${esc((L[i] || {}).label || '')}" placeholder="${['Writing', 'Film', 'Music', 'Shop', 'Books', 'Talks'][i]}" maxlength="40"><input name="link_url" value="${esc((L[i] || {}).url || '')}" placeholder="https://" maxlength="300"></div>`).join(''); })()}</fieldset>
<button class="btn">Save</button></form>
<p class="sr-also"><a href="/account">Your studio</a> &middot; <a href="/account/upload">Add work</a></p></section>${intros}` });
}
function gone() {
  return layout({ title: 'Link used · Watermark', studio: true, body: `<section class="narrow"><p class="k">Your account</p><h1>This link has been used.</h1>
<p class="lede">Each sign-in link works once. If this is your device, you are probably already signed in: <a href="/account">open your account</a>. Otherwise ask for a fresh link.</p></section>` });
}

function studioAccounts({ list, base, notice, intros = '', asks = '' }) {
  const rows = list.map(m => `<tr><td><b>${esc(m.name)}</b>${m.house ? `<br><small>${esc(m.house)}</small>` : ''}</td><td>${m.kind === 'estate' ? 'Estate' : m.kind === 'institution' ? 'Institution' : m.kind === 'gallery' ? 'Gallery' : m.kind === 'writer' ? 'Writer' : 'Maker'}</td><td>${m.works}</td><td>${m.joined_at ? 'Joined ' + date(m.joined_at) : 'Invited'}</td>
<td>${m.door === 'record' ? `<form method="post" action="/studio/accounts/${m.id}/invite" class="inline"><button class="link">Invite to the house</button></form> ` : ''}${m.invite_token ? `<input class="copy" readonly value="${esc(base)}/account/join/${esc(m.invite_token)}" onclick="this.select()">` : `<form method="post" action="/studio/accounts/${m.id}/link" class="inline"><button class="link">New sign-in link</button></form>`}</td>
<td class="ac-doors"><a href="/account?maker=${esc(m.handle)}">Studio</a> <a href="/account/requests?maker=${esc(m.handle)}">Requests</a> <a href="/account/payouts?maker=${esc(m.handle)}">Statement</a> <a href="/account/prices?maker=${esc(m.handle)}">Prices</a> <a href="/m/${esc(m.handle)}">Page</a> <form method="post" action="/studio/accounts/${m.id}/standing" class="inline"><button class="link">${m.standing === 'held' ? 'Release' : 'Hold'}</button></form></td></tr>`).join('');
  return layout({ studio: true, title: 'Accounts · Watermark', body: `<section class="studio-wrap">${require('./studio-views').nav('/studio/accounts')}
<p class="k">Accounts</p><h1>Every maker, their own Watermark.</h1>${asks}
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<p class="lede">Watermark is by invitation: applications arrive at Studio → Makers; approving one opens an account here and mails the invitation. You can also invite a maker or an estate with a sign-in link. Hold a maker and their work goes private until you release them. ${require('./fee').on() ? 'The price of every sale is theirs.' : 'They keep 85% of every sale.'}</p>
<p class="note">Every door of a maker's studio opens for you from this table: their dashboard, their requests, their statement, their prices, their public page. You are shown as the Studio while you are in it; looking changes nothing.</p>
<table class="tbl"><thead><tr><th>Account</th><th>Kind</th><th>Works</th><th>Status</th><th>Sign-in link</th><th>Their doors</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Invite a maker or an estate</h2>
<form method="post" action="/studio/accounts" class="form inline-form"><label>Name<input name="name" required placeholder="Greg Williams"></label><label>Email<input name="email" type="email" placeholder="Optional"></label><label>Studio or estate<input name="house" placeholder="Optional"></label>
<label>Kind<select name="kind"><option value="maker">Maker</option><option value="estate">Estate</option><option value="institution">Institution: a museum, a library, an archive</option><option value="gallery">Gallery: represents photographers, mounts shows</option></select></label><button>Create the account</button></form></section>${intros}` });
}

const I = require('./icons');
function dashboard({ keys = [], way = '', role = null, m, pct, works, jewels, byUse, recent, totals, toMaker, multiple, viewing, need, keyed = true, welcome = false, stars = null, culled = null, keeping = null, asks = 0, owed = 0, claims = 0, edit = null, rep = null, steps = null, batch = '', ok = null, almanack = null }) {
  setDeskPath('/account');
  const all = works; if (stars) works = works.filter(w => w.stars === stars);
  const grade = w => `<form method="post" action="/account/works/${esc(w.slug)}/stars" class="st" data-stars="${w.stars}" data-slug="${esc(w.slug)}">${viewing ? `<input type="hidden" name="maker" value="${esc(m.handle)}">` : ''}${[1, 2, 3, 4, 5].map(n => `<button name="n" value="${n}" class="${w.stars >= n ? 'on' : ''}" aria-label="${n} star${n === 1 ? '' : 's'}" title="${n}">&#9733;</button>`).join('')}</form>`;
  const counts = [5, 4, 3, 2, 1, 0].map(n => [n, all.filter(w => w.stars === n).length]);
  const hidden = viewing ? `<input type="hidden" name="maker" value="${esc(m.handle)}">` : '';
  const star = w => `<form method="post" action="/account/works/${esc(w.slug)}/jewel" class="inline">${hidden}<button class="jw${w.curated ? ' on' : ''}" title="${w.curated ? 'Remove from your jewels' : 'Mark as a jewel'}" aria-pressed="${w.curated ? 'true' : 'false'}">${w.curated ? '&#9733;' : '&#9734;'}</button></form>`;
  const jewel = w => `<a class="ac-j" id="j-${esc(w.slug)}" href="/w/${esc(w.slug)}"><span class="ac-jf"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" draggable="false"></span><b>${esc(w.title)}</b><span>${money(toMaker(w.gross))} &middot; ${w.seen30} seen</span></a>`;
  const pub = w => viewing ? `<span class="ac-st">${w.status === 'held' ? 'Public' : 'Private'}</span>` : w.status === 'held'
    ? `<form method="post" action="/account/works/${esc(w.slug)}/show" class="inline"><button class="link ac-st">Public</button></form>`
    : `<details class="ac-pub"><summary>Private &middot; <u>Publish</u></summary><form method="post" action="/account/works/${esc(w.slug)}/show"><label><input type="checkbox" name="attest" value="1" required> I hold the rights, and releases for anyone identifiable, and I accept <a href="/legal/makers" target="_blank">the Maker Agreement</a></label><button>Publish</button></form></details>`;
  const row = w => `<div class="hd-row ac-row${viewing ? '' : ' ac-row-bt'}" id="w-${esc(w.slug)}">${viewing ? '' : `<label class="bt-ck"><input type="checkbox" form="batchForm" name="slugs" value="${esc(w.slug)}" aria-label="Select"></label>`}<a href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy" draggable="false"></a>
<span class="hd-t"><b><a href="/w/${esc(w.slug)}">${esc(w.title)}</a></b><small>${esc(w.place || '')}${viewing ? '' : `${w.place ? ' &middot; ' : ''}<a href="/voices/${esc(w.slug)}">Add your voice</a>`}</small></span>
<span>${pub(w)}</span><span class="hd-c">${w.shares + w.licenses}</span><span class="hd-c">${w.seen30}</span><span class="hd-v">${money(toMaker(w.gross))}</span><span class="ac-star">${grade(w)}</span></div>`;
  const collected = byUse.filter(u => u.key === 'social').reduce((a, u) => a + u.gross, 0), licensed = byUse.filter(u => u.key !== 'social').reduce((a, u) => a + u.gross, 0);
  const share = c => (collected + licensed ? Math.round(100 * c / (collected + licensed)) : 0);
  const privateN = works.filter(w => w.status !== 'held').length;
  const needs = viewing ? [] : [
    asks ? `<li><a href="/account/requests"><b>${asks}</b> request${asks === 1 ? '' : 's'} waiting for your answer<span>&rarr;</span></a></li>` : '',
    rep ? `<li><a href="/account/representation"><b>${esc(rep)}</b> offers to represent you<span>&rarr;</span></a></li>` : '',
    claims ? `<li><a href="/account/claims"><b>${claims}</b> claim${claims === 1 ? '' : 's'} about your work waiting for your answer<span>&rarr;</span></a></li>` : '',
    keeping && keeping.over ? `<li><a href="/account/keeping"><b>${keeping.works}</b> works held, above the ${esc(keeping.tier.name)} line; see Keeping<span>&rarr;</span></a></li>` : '',
    owed >= 100 ? `<li><a href="/account/payouts"><b>${money(owed)}</b> owed to you; see the statement, add your bank<span>&rarr;</span></a></li>` : '',
    privateN ? `<li><a href="#holdings"><b>${privateN}</b> photograph${privateN === 1 ? '' : 's'} waiting to be published<span>&rarr;</span></a></li>` : '',
    !jewels.length && works.length ? `<li><a href="#holdings"><b>&#9734;</b> Star the works that matter most; collectors see them first<span>&rarr;</span></a></li>` : '',
  ].filter(Boolean);
  // The desk (Will, 23 Oct: "the back of house as beautifully designed as the front; one screen; anybody could manage it"):
  // the line (today, this month, what needs you), then three columns of rows with one verb each (Needs you · The work ·
  // Money); the figures that were paragraphs are rows; everything else is in the rail. No paragraphs on the desk.
  const bank = totals.bank;
  const needRows = viewing ? [] : [
    asks ? ['/account/requests', 'Answer', `${asks} request${asks === 1 ? '' : 's'} waiting`] : null,
    claims ? ['/account/claims', 'Answer', `${claims} claim${claims === 1 ? '' : 's'} about your work`] : null,
    rep ? ['/account/representation', 'Decide', `${rep} offers to represent you`] : null,
    owed >= 100 && !bank ? ['/account/payouts', 'Add your bank', `${money(owed)} is owed to you`] : null,
    privateN ? ['#holdings', 'Publish', `${privateN} work${privateN === 1 ? '' : 's'} waiting in the vault`] : null,
    keeping && keeping.over ? ['/account/keeping', 'See Keeping', `${keeping.works} works held, above the ${keeping.tier.name} line`] : null,
    !jewels.length && works.length ? ['#holdings', 'Grade', 'Star the works that matter most'] : null,
  ].filter(Boolean);
  const G = role && role.kind === 'gallery' ? role : null, N = role && role.kind === 'institution' ? role : null;
  if (G && G.offered && !viewing) needRows.unshift(['/account/gallery', 'Waiting', `${G.offered} offer${G.offered === 1 ? '' : 's'} of representation awaiting the maker`]);
  if (N && N.rights && !viewing) needRows.unshift(['/account/rights', 'Answer', `${N.rights} rights request${N.rights === 1 ? '' : 's'} waiting`]);
  const workRows = G ? [
    ['/account/gallery', 'Represents', `${G.represents} maker${G.represents === 1 ? '' : 's'}`],
    ['/yours?tab=walls', 'Shows', `${G.shows} wall${G.shows === 1 ? '' : 's'} hung`],
    ['/account/gallery', 'Offer representation', 'By handle, or your standing link'],
    [`/m/${esc(m.handle)}`, 'Your page', 'Represents and Shows, as the public sees them'],
    ['#holdings', 'The holdings', `${totals.works} held · ${totals.public} public`],
  ] : N ? [
    ['#holdings', 'The collection', `${totals.works} held · ${totals.public} public · ${N.open} open access`],
    ['/account/rights', 'The rights desk', N.rightsOpen ? 'Open: one door for every request' : 'Closed: open it in settings'],
    ['/account/staff', 'The team', `${N.team} seat${N.team === 1 ? '' : 's'}`],
    viewing ? null : ['/account/upload', 'Add work', 'Into the vault'],
    ['/account/house', 'Your own house', m.white_on ? m.white_domain || 'On' : 'A white label on your domain'],
    [`/m/${esc(m.handle)}`, 'Your page', 'As the public sees it'],
  ] : [
    viewing ? null : ['/account/upload', 'Add work', 'Into the vault'],
    ['#holdings', 'The holdings', `${totals.works} held · ${totals.public} public · ${totals.jewels} jewel${totals.jewels === 1 ? '' : 's'}`],
    ['/account/prices', 'Your prices', byUse.filter(u => u.key !== 'delivery').map(u => u.name).slice(0, 3).join(', ')],
    [`/m/${esc(m.handle)}`, 'Your page', m.bio ? 'As the public sees it' : 'Add a portrait and a line'],
    edit && totals.works >= 5 ? ['/account#holdings', 'The edit', `Standing ${edit.now.standing}${edit.best && edit.best.from ? ` · culling from ${'★'.repeat(edit.best.from)} would give ${edit.best.standing}` : ''}`] : null,
    viewing ? null : ['/account/deliveries', 'Deliver an album', 'To a client or a friend'],
    viewing || !almanack ? null : ['/account/almanack', almanack.has ? `${almanack.y}’s almanack` : 'The almanack', almanack.has ? 'Set; remake it as the year goes on' : `Your ${almanack.y} as one book, in one press`],
  ].filter(Boolean);
  const moneyRows = [
    G ? ['/account/payouts', 'Representation', `${money(G.cutsMonth)} this month · ${money(G.cuts)} in all`] : null,
    ['/account/payouts', 'This month', `${money(totals.month)} · ${totals.monthN} sale${totals.monthN === 1 ? '' : 's'}`],
    ['/account/payouts', 'All time', `${money(totals.earned + (totals.tips || 0) + (totals.royalties || 0))} · ${totals.shares} collected`],
    ['/account/payouts', owed >= 100 ? 'Owed to you' : 'The statement', owed >= 100 ? money(owed) : 'Every sale, line by line'],
    viewing ? null : ['/account/payouts', bank ? 'Your bank' : 'Add your bank', bank ? 'Connected' : 'Paid by hand until then'],
    totals.royalties ? ['/account/payouts', 'Royalties', `${money(totals.royalties)} from ${totals.resales} resale${totals.resales === 1 ? '' : 's'}`] : null,
    ['/share', 'The split', require('./fee').on ? 'The price is yours; the house’s share is on top' : `You keep ${pct}% of every sale`],
  ].filter(Boolean);
  const col = (title, rows, empty) => `<section class="dk2-col"><h2>${title}</h2>${rows.length ? `<ul>${rows.map(([href, verb, line]) => `<li><a href="${href}"><b>${esc(verb)}</b><span>${esc(line)}</span></a></li>`).join('')}</ul>` : `<p class="dk2-empty">${empty}</p>`}</section>`;
  const desk = () => `<section class="dk2" aria-label="The desk">
<header class="dk2-line"><span><b>${money(totals.today)}</b><i>today${totals.todayN ? ` · ${totals.todayN}` : ''}</i></span><span><b>${money(totals.month)}</b><i>this month</i></span><span><b>${needRows.length}</b><i>need${needRows.length === 1 ? 's' : ''} you</i></span>${keys.length ? `<a href="/keys" class="dk2-key">${I.key}<i>No. ${keys[0].no}</i></a>` : ''}</header>
<div class="dk2-cols">${col('Needs you', needRows, 'All clear.')}${col('The work', workRows, '')}${col('Money', moneyRows, '')}</div>
${recent.length ? `<p class="dk2-late">Lately: ${recent.slice(0, 3).map(l => `<a href="/w/${esc(l.slug)}">${esc(l.title)}</a>, ${esc(l.use_name.toLowerCase())}, ${money(require('./fee').makerOf(l, pct))}`).join(' · ')}</p>` : ''}
</section>`;
  return layout({ title: `${m.name} · Watermark`, studio: true, body: `<section class="studio-wrap hd ac">
${viewing ? `<p class="ok">You are viewing ${esc(m.name)}'s studio as they see it. <a href="/studio/accounts">Back to accounts</a></p>` : ''}
<header class="ac-bar"><div><p class="k">${m.kind === 'estate' ? 'The estate' : m.kind === 'gallery' ? 'The gallery' : m.kind === 'institution' ? 'The institution' : 'Your studio'}${m.house ? ' &middot; ' + esc(m.house) : ''}</p><h1>${esc(m.name)}.</h1></div>
${viewing ? '' : `<nav><a class="buy-btn ac-up" href="/account/upload">Add work</a><a class="ac-hand" href="/signin/hand?next=/account" title="Open your studio on your phone">Your phone</a><form method="post" action="/signout" class="ac-out"><button>Sign out</button></form></nav>`}</header>
${steps ? `<section class="fs" aria-label="First steps"><header class="fs-h"><p class="k">First steps &middot; ${steps.done} of ${steps.total}</p><h2>${steps.done ? 'Nearly open.' : 'Your studio, opened.'}</h2><p>Each step ticks itself when it is done. Next: <a href="${steps.next.href}">${esc(steps.next.title.toLowerCase())}</a>.</p><form method="post" action="/account/steps/away" class="fs-away"><button class="link">Put this away</button></form></header>
<ol class="fs-l">${steps.steps.map((s, i) => `<li class="${s.done ? 'fs-done' : ''}${s === steps.next ? ' fs-next' : ''}"><span class="fs-n">${s.done ? '&#10003;' : i + 1}</span><span class="fs-t"><b>${esc(s.title)}</b><small>${esc(s.line)}</small></span>${s.done ? '<span class="fs-ok">Done</span>' : s.copy ? `<button type="button" class="fs-go" data-fs-copy="${esc(s.copy)}">${esc(s.go)}</button>` : `<a class="fs-go" href="${s.href}">${esc(s.go)}</a>`}</li>`).join('')}</ol>
<script>(function(){var b=document.querySelector('[data-fs-copy]');if(!b)return;b.addEventListener('click',function(){var u=b.getAttribute('data-fs-copy');function done(){b.textContent='Copied';fetch('/account/steps/shared',{method:'POST',headers:{Accept:'application/json'},credentials:'same-origin'});}if(navigator.share&&matchMedia('(pointer:coarse)').matches){navigator.share({url:u}).then(done).catch(function(){});}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(done);}else{prompt('Your page',u);done();}});})();</script></section>` : ''}
${!viewing && !keyed ? `<div class="pk" id="passkey" data-passkey-box><div><b>Save your sign-in.</b><p>A passkey (Face ID, Touch ID or your phone) brings you back to your studio from any device, with no link and no password.</p><button class="pk-go" data-passkey="maker-save">Save with a passkey</button><p class="pk-msg" data-passkey-msg></p></div></div><script src="/static/webauthn.js" defer></script><script src="/static/auth.js" defer></script>` : ''}
${desk()}
${jewels.length ? `<section class="hd-list"><div class="hd-h"><h2>Your jewels</h2></div><div class="ac-js">${jewels.map(jewel).join('')}</div></section>` : ''}
<section class="hd-list" id="holdings"><div class="hd-h"><h2>The holdings</h2>${all.length ? `<span class="hd-n">${works.length === all.length ? `${all.length} work${all.length === 1 ? '' : 's'}` : `${works.length} of ${all.length}`}</span>` : ''}</div>
${all.length ? `<div class="st-bar"><nav class="st-f" aria-label="By stars"><a href="/account#holdings"${stars ? '' : ' aria-current="page"'}>All</a>${counts.map(([n, c]) => `<a href="/account?stars=${n}#holdings"${stars === n ? ' aria-current="page"' : ''}${c ? '' : ' class="is-0"'}>${n ? '&#9733;'.repeat(n) : 'Ungraded'}<small>${c}</small></a>`).join('')}</nav>
${viewing ? '' : `<form method="post" action="/account/cull" class="st-cull"><span>Keep public from</span><select name="from" aria-label="Stars"><option value="3">&#9733;&#9733;&#9733;</option><option value="4">&#9733;&#9733;&#9733;&#9733;</option><option value="5">&#9733;&#9733;&#9733;&#9733;&#9733;</option><option value="2">&#9733;&#9733;</option></select><button class="link">Cull</button></form>`}</div>
${culled ? `<p class="ok">Culled from ${'&#9733;'.repeat(culled.from)}: ${culled.down} made private, ${culled.up} brought back. Nothing is deleted; every photograph stays fingerprinted and registered, and culled work weighs a quarter toward Keeping.</p>` : ''}
<p class="st-help">1 to 5 on a row grades it; five is a jewel. Culled work stays held, out of the way. ${keeping ? ` Held: ${keeping.works} photograph${keeping.works === 1 ? '' : 's'}, weighing ${keeping.weighed} toward the free line of ${keeping.terms.freeWorks}. <a href="/account/keeping">Keeping</a>.` : ''}</p>` : ''}
${welcome ? `<p class="ok">Your studio is open. <a href="/account/upload">Add your first works</a>, then <a href="/account/profile">tell people who you are</a>.</p>` : ''}${m.standing === 'held' ? '<p class="err">Your studio is held by Watermark while we look at something. Your work is private until it is released; write to us if you have questions.</p>' : ''}${need === 'attest' ? '<p class="err">To publish, confirm you hold the rights and any releases.</p>' : need === 'held' ? '<p class="err">Your studio is held; nothing can be published until it is released.</p>' : need === 'invited' ? '<p class="err">Your work is held and deeded; hanging it in the collection is by the house’s invitation. Ask the house to look, below.</p>' : ''}${way || ''}
${ok && !/^(cull|attest|held|invited)/.test(ok) && !culled ? `<p class="ok">${esc(ok)}</p>` : ''}
${works.length ? `${viewing ? '' : `<form method="post" action="/account/works/batch" id="batchForm" data-batch>${batch}</form>`}<div class="hd-head ac-row${viewing ? '' : ' ac-row-bt'}">${viewing ? '' : '<span></span>'}<span></span><span>Work</span><span>On Watermark</span><span class="hd-c">Sold</span><span class="hd-c">Seen, 30d</span><span class="hd-v">To you</span><span></span></div>${works.map(row).join('')}${viewing ? '' : `<script src="/static/batch.js?v=${VER}" defer></script>`}` : `<p class="hd-calm">Nothing here yet. ${viewing ? '' : '<a href="/account/upload">Add your first works</a>; they stay private until you publish them.'}</p>`}</section>
${recent.length ? `<section class="hd-list"><div class="hd-h"><h2>Lately</h2></div>${recent.map(l => `<a class="hd-ev" href="/w/${esc(l.slug)}"><span>${date(l.starts_at)}</span><b>${esc(l.title)}</b><span>${esc(l.use_name)}</span><span class="hd-v">${money(toMaker(l.price_cents))}</span></a>`).join('')}</section>` : ''}
</section><script src="/static/stars.js?v=2" defer></script>` });
}

// Into the vault. Putting finished work here should feel like hanging it: each photograph is shown as it
// arrives, fingerprinted, given its accession number and its entry on the register, one plate after another.
// Only the best belongs here; the page says so.
function upload({ m, welcome = false }) {
  setDeskPath('/account/upload');
  return layout({ title: 'Into the vault · Watermark', studio: true, body: `<section class="studio-wrap vt" data-vault>${welcome ? '<p class="ok own-wel">Your studio is open. Bring in what you made: each file is fingerprinted, written to the register with the day you made it, and given a deed. Nothing is shown until you say so.</p>' : ''}
<div class="vt-head"><div><p class="k"><a href="/account">&larr; Your studio</a> &middot; ${esc(m.name)} &middot; The vault</p><h1>Put your best work in the vault.</h1>
<p class="lede">This is where your finished work lives: fingerprinted the moment it arrives, sealed with its master, numbered, written to the register, and held for as long as there is a Watermark. Bring the work you would hang. The rest stays on your drive.</p></div>
</div>
<form class="vt-form" onsubmit="return false"><label class="vt-door"><input type="file" id="aFiles" accept="image/jpeg,image/png,image/tiff" multiple><span class="vt-door-in"><b>Open the vault</b><span>Choose files, or a folder&rsquo;s worth. Titles come from the file names; you refine them after.</span></span></label>
<div class="vt-row"><label class="vt-place">Place, for all<input id="aPlace" placeholder="Florence, Italy"></label><label class="vt-kind">Kind, for all<select id="aKind"><option value="photograph">Photographs</option><option value="painting">Paintings (the file is the photograph of record)</option><option value="drawing">Drawings</option><option value="print">Prints</option><option value="sculpture">Sculpture</option><option value="textile">Textiles</option><option value="mixed">Mixed media</option><option value="film">Film stills</option><option value="other">Other works</option></select></label><button type="button" class="buy-btn vt-go" id="aGo" disabled>Choose files</button></div></form>
<ul class="vt-rules"><li><b>The master, never an export for the web.</b> A JPEG at full size and quality 100 with its colour profile, straight from your edit (TIFF and PNG are taken too). The house keeps it byte for byte, makes every smaller copy itself, and never re-encodes what it delivers as the original. A better file for a work already held takes its place: same record, same number. 12 MP and up licenses for stories and companies; 24 for campaigns and walls; 40 earns the Reference.</li><li><b>Private until you hang it.</b> Every arrival is held privately; you publish each one from your studio when it is ready.</li><li><b>Your word stands behind it.</b> Publishing is your attestation that you made it, hold the rights, and have releases for anyone identifiable.</li></ul>
<p class="vt-status" id="aStatus" aria-live="polite">Nothing chosen yet.</p>
<ol class="vt-list" id="aList"></ol>
<div class="vt-done" id="aDone" hidden><p class="k">Held</p><h2 id="aDoneT"></h2><p class="lede">Each one is in the vault with its number and its entry on the register. Hang them when they are ready: a title, a place, a date, a sentence, then publish.</p><p class="vt-acts"><a class="buy-btn" href="/account">Go to your studio</a><a class="vt-more" href="/account/upload">Bring more</a></p></div>
<script src="/static/arrivals.js?v=${VER}"></script><script>(function(){var inp=document.getElementById('aFiles'),go=document.getElementById('aGo'),status=document.getElementById('aStatus'),list=document.getElementById('aList'),done=document.getElementById('aDone'),doneT=document.getElementById('aDoneT'),files=[],A=window.WMArrivals;
function esc(s){return String(s).replace(/[<>&]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]})}
inp.onchange=function(){files=[].slice.call(inp.files).filter(function(f){return /^image\\//.test(f.type)||/\\.(jpe?g|tiff?|png)$/i.test(f.name)});go.disabled=!files.length;go.textContent=files.length?'Put '+files.length+' work'+(files.length===1?'':'s')+' in the vault':'Choose files';status.textContent=files.length?files.length+' file'+(files.length===1?'':'s')+' chosen, '+(files.reduce(function(a,f){return a+f.size},0)/1048576).toFixed(0)+' MB. Nothing has been sent yet: press the button.':'Nothing chosen yet.';list.innerHTML='';files.forEach(function(f){var li=document.createElement('li');li.className='vt-i';var url=URL.createObjectURL(f);li.innerHTML='<span class="vt-pl"><img src="'+url+'" alt=""></span><span class="vt-t"><b>'+esc(f.name.replace(/\\.[a-z0-9]+$/i,'').replace(/[_-]+/g,' '))+'</b><span class="vt-s"><i data-s="0">Sent</i><i data-s="1">Fingerprint</i><i data-s="2">Sealed</i><i data-s="3">Register</i></span><small class="vt-m"></small><span class="vt-bar"><i></i></span></span>';list.appendChild(li);f._li=li})};
function settle(f,j){var li=f._li,st=li.querySelectorAll('[data-s]'),m=li.querySelector('.vt-m');li.classList.remove('busy');if(j.ok){li.classList.add('held');st[1].classList.add('on');st[2].classList.add('on');setTimeout(function(){st[3].classList.add('on')},300);if(j.yours){var y=document.createElement('p');y.className='vt-yours';y.innerHTML=esc(j.yours)+' <a href="'+j.deed+'">The deed</a>';li.appendChild(y)}m.innerHTML=(j.accession?'<code>'+esc(j.accession)+'</code> &middot; ':'')+(j.mp?j.mp+' MP &middot; ':'')+(j.fingerprint?'sha256 '+esc(j.fingerprint)+'&hellip;':'')+(j.entry?' &middot; entry '+j.entry:'');li.querySelector('b').textContent=j.title;if(j.slug){var a=document.createElement('a');a.className='vt-rec';a.href='/account/works/'+encodeURIComponent(j.slug);a.textContent='Open its record';li.appendChild(a)}}else{li.classList.add('skip');m.textContent=j.error||'Not held.'}}
go.onclick=async function(){go.disabled=true;inp.disabled=true;var ok=0,ids={},pending=0,sending=true;window.onbeforeunload=function(){return sending?'Files are still being sent. If you leave now, the ones not yet sent will not reach the vault.':undefined};
  // 1. every file straight into the vault, one after another (its parts four at a time); the page follows the house's reading from the start
  var following=follow();
  for(var i=0;i<files.length;i++){var f=files[i],li=f._li,st=li.querySelectorAll('[data-s]'),m=li.querySelector('.vt-m'),bar=li.querySelector('.vt-bar i'),sent=0;li.classList.add('busy');
    try{var id=await A.send(f,{base:'/account',meta:{kind:document.getElementById('aKind').value,place:document.getElementById('aPlace').value},onBytes:function(b){sent+=b;bar.style.width=Math.min(100,sent/f.size*100)+'%'},onVia:function(v){if(v==='house')status.textContent='The vault is taking the files through the house (a little slower). Sending '+(i+1)+' of '+files.length+'.';}});st[0].classList.add('on');bar.style.width='100%';m.textContent='In the vault; being read\u2026';ids[id]=f;pending++}
    catch(e){li.classList.remove('busy');li.classList.add('skip');m.textContent=e==='signed-out'?'Signed out: sign in and try again.':(e.message||'Could not be sent.')}
    go.textContent=(i+1)+' of '+files.length+' sent';status.textContent='Sent '+(i+1)+' of '+files.length+' (on the house\u2019s disk) \u00b7 held '+ok+' so far. Stay until every file says Sent; after that the house keeps reading them on its own, and your studio shows each work as it is held.'}
  sending=false;window.onbeforeunload=null;status.textContent='All '+files.length+' sent. Held '+ok+' of '+files.length+' so far; the house is reading the rest. You can leave now: your studio shows each work as it is held.';
  // 2. the house reads them in its own time; the page follows
  async function follow(){while(sending||pending>0){await new Promise(function(r){setTimeout(r,2000)});if(!Object.keys(ids).length)continue;try{var s=await (await fetch('/account/arrivals/state?ids='+Object.keys(ids).join(','),{credentials:'same-origin'})).json();(s.asked||[]).forEach(function(a){var f=ids[a.id];if(!f)return;if(a.status==='done'||a.status==='failed'){delete ids[a.id];pending--;var j=a.result||{ok:false,error:a.error};if(a.status==='failed')j={ok:false,error:a.error||'Could not be read as a photograph.'};settle(f,j);if(j.ok)ok++;status.textContent='All '+files.length+' sent. Held '+ok+' of '+files.length+'; '+pending+' still being read.'+(sending?'':' You can leave now: your studio shows each work as it is held.')}else if(a.status==='working'){f._li.querySelector('.vt-m').textContent='Fingerprinting\u2026'}})}catch(e){status.textContent='The house is busy (a deploy, perhaps); still waiting for '+pending+'. Your files are in the vault.'}}}
  await following;go.textContent=ok+' held';status.textContent=ok+' of '+files.length+' held. '+(ok<files.length?(files.length-ok)+' could not be taken; the reason is under each one.':'All in.');done.hidden=false;doneT.textContent=ok===files.length?(ok===1?'One work is in the vault.':'All '+ok+' works are in the vault.'):ok+' of '+files.length+' works are in the vault.';done.scrollIntoView({behavior:'smooth',block:'start'})};})();</script></section>` });
}

module.exports = { join, profile, signedOut, gone, studioAccounts, dashboard, upload };
