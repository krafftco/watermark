// The Studio: where the maker manages the vault, prices and licenses.
const { layout, esc, money, date, termText, setDeskPath } = require('./views');

// Four rooms, then the back office in small type. Simple on purpose.
const MAIN = [['/studio', 'Holdings'], ['/studio/trove', 'Works'], ['/studio/licenses', 'Licenses'], ['/studio/market', 'Market'], ['/studio/makers', 'Makers']];
const MORE = [['/studio/launch', 'Launch'], ['/studio/works', 'Add photographs'], ['/studio/editions', 'Editions'], ['/studio/copyright', 'Copyright'], ['/studio/contract', 'Contract'], ['/studio/activity', 'Activity'], ['/studio/uses', 'Prices'], ['/studio/masters', 'Masters'], ['/studio/sightings', 'Sightings'], ['/studio/accounts', 'Accounts']];
// The rooms are in the desk header (views.deskHeader); nav() only says which room this is.
const nav = active => { setDeskPath(active); return ''; };

function login({ error }) {
  return layout({ title: 'Studio · Watermark', body: `<section class="narrow"><p class="k">Studio</p><h1>Sign in to your vault.</h1>${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/studio/login" class="form"><label>Password<input type="password" name="password" required autofocus></label><button>Sign in</button></form></section>` });
}

function overview({ maker, stats, recent, views, ending = [], notice }) {
  const en = ending.map(l => `<tr><td><a href="/studio/licenses/${esc(l.ref)}">${esc(l.ref)}</a></td><td>${esc(l.title)}</td><td>${esc(l.licensee_company || l.licensee_name)}</td><td>${date(l.ends_at)}</td><td>${l.renewal_sent_at ? 'Notice sent' : 'Not yet'}</td></tr>`).join('');
  const v = views.map(r => `<tr><td>${esc(r.host || 'watermark')}</td><td>${esc(r.kind)}</td><td>${r.n}</td></tr>`).join('');
  const rl = recent.map(l => `<tr><td><a href="/studio/licenses/${esc(l.ref)}">${esc(l.ref)}</a></td><td>${esc(l.title)}</td><td>${esc(l.licensee_company || l.licensee_name)}</td><td>${esc(l.use_name)}</td><td><span class="pill s-${esc(l.status)}">${esc(l.status.replace('_', ' '))}</span></td></tr>`).join('');
  return layout({ studio: true, title: 'Activity · Watermark', body: `<section class="studio-wrap">${nav('/studio/activity')}
<p class="k">${esc(maker.house || maker.name)}</p><h1>Activity.</h1>
<div class="stats"><div><b>${stats.works}</b><span>works held</span></div><div><b>${stats.active}</b><span>active licenses</span></div><div><b>${stats.open}</b><span>requests waiting</span></div><div><b>${money(stats.earned || 0)}</b><span>licensed to date</span></div><div><b>${stats.views}</b><span>views, 30 days</span></div></div>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<h2>Ending in the next 60 days</h2><table class="tbl"><thead><tr><th>Ref</th><th>Work</th><th>Licensee</th><th>Ends</th><th>Renewal</th></tr></thead><tbody>${en || '<tr><td colspan="5">Nothing ending soon.</td></tr>'}</tbody></table>
<form method="post" action="/studio/renewals" class="inline" style="margin-top:12px"><button class="link">Send renewal notices now</button></form>
<form method="post" action="/studio/backup" class="inline" style="margin-top:8px"><button class="link">Back up the database to the vault now</button></form>
<h2>Recent licenses</h2><table class="tbl"><thead><tr><th>Ref</th><th>Work</th><th>Licensee</th><th>Use</th><th>Status</th></tr></thead><tbody>${rl || '<tr><td colspan="5">None yet.</td></tr>'}</tbody></table>
<h2>Where your work was seen (30 days)</h2><table class="tbl"><thead><tr><th>Site</th><th>Kind</th><th>Count</th></tr></thead><tbody>${v || '<tr><td colspan="3">No views yet.</td></tr>'}</tbody></table>
</section>` });
}

function works({ list, error, notice, rooms = [] }) {
  const rows = list.map(w => `<tr><td><img src="/img/${esc(w.slug)}/thumb" alt="" width="72"></td><td><a href="/w/${esc(w.slug)}">${esc(w.title)}</a><br><small>${esc(w.place || '')}</small></td><td>${esc(w.camera || '')}</td><td>${date(w.created_at)}</td><td>${w.status === 'held' ? 'Public' : 'Hidden'}</td><td><a href="/studio/works/${esc(w.slug)}">Catalogue</a></td><td><form method="post" action="/studio/works/${esc(w.slug)}/toggle"><button class="link">${w.status === 'held' ? 'Hide' : 'Show'}</button></form></td></tr>`).join('');
  return layout({ studio: true, title: 'Vault · Watermark', body: `<section class="studio-wrap">${nav('/studio/works')}
<h1>The vault.</h1>${error ? `<p class="err">${esc(error)}</p>` : ''}${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<form class="form upload bulk" id="bulk" onsubmit="return false">
<p class="k">Bring works into the vault</p>
<label class="drop" id="drop"><input type="file" id="bulkFiles" accept="image/jpeg,image/png,image/tiff" multiple><b>Choose photographs or drop them here</b><span>Full-resolution masters: JPEG, TIFF or PNG. Each is fingerprinted, sealed into the vault and written to the ledger. Titles come from the file names; refine them in each catalogue record.</span></label>
<div class="bulk-opts"><label>Place, for all<input id="bulkPlace" placeholder="Florence, Italy"></label>
<label>Collection<select id="bulkRoom"><option value="">None</option>${rooms.map(r => `<option value="${r.id}">${esc(r.title)}</option>`).join('')}</select></label>
<label class="chk"><input type="checkbox" id="bulkHidden" checked> Keep them private until I publish each one</label></div>
<button type="button" id="bulkGo" disabled>Register 0 works</button>
<ol class="bulk-list" id="bulkList"></ol>
</form>
<script>(function(){var files=[],inp=document.getElementById('bulkFiles'),go=document.getElementById('bulkGo'),list=document.getElementById('bulkList'),drop=document.getElementById('drop');
function set(f){files=[].slice.call(f).filter(function(x){return ['image/jpeg','image/png','image/tiff'].indexOf(x.type)>=0||/[.](jpe?g|png|tiff?)$/i.test(x.name)});list.innerHTML=files.map(function(x,i){return '<li id="b'+i+'"><span>'+x.name.replace(/</g,'&lt;')+'</span><em>'+(x.size/1048576).toFixed(1)+' MB</em><i>Waiting</i></li>'}).join('');go.disabled=!files.length;go.textContent='Register '+files.length+' work'+(files.length===1?'':'s');}
inp.addEventListener('change',function(){set(inp.files)});
drop.addEventListener('dragover',function(e){e.preventDefault();drop.classList.add('over')});drop.addEventListener('dragleave',function(){drop.classList.remove('over')});
drop.addEventListener('drop',function(e){e.preventDefault();drop.classList.remove('over');set(e.dataTransfer.files)});
go.addEventListener('click',async function(){go.disabled=true;var ok=0,skip=0;for(var i=0;i<files.length;i++){var li=document.getElementById('b'+i),st=li.querySelector('i');st.textContent='Sealing…';li.className='busy';
var fd=new FormData();fd.append('file',files[i]);fd.append('place',document.getElementById('bulkPlace').value);fd.append('room',document.getElementById('bulkRoom').value);fd.append('hidden',document.getElementById('bulkHidden').checked?'1':'0');
try{var r=await fetch('/studio/works/one',{method:'POST',body:fd,credentials:'same-origin'});var j=await r.json();if(j.ok){ok++;li.className='done';st.innerHTML='<a href="/studio/works/'+j.slug+'">'+j.accession+'</a>'}else{skip++;li.className='skip';st.textContent=j.error}}catch(e){skip++;li.className='skip';st.textContent='Connection lost; try again'}
go.textContent=ok+' registered'+(skip?', '+skip+' skipped':'')+' of '+files.length;}
go.textContent='Done: '+ok+' registered'+(skip?', '+skip+' skipped':'');setTimeout(function(){location.href='/studio/works?ok='+encodeURIComponent(ok+' works registered.')},1500);});})();</script>
<details class="single"><summary>Register a single work with its details</summary>
<form method="post" action="/studio/works" enctype="multipart/form-data" class="form upload">
<label>Photograph (JPEG, TIFF or PNG, full resolution)<input type="file" name="file" accept="image/*" required></label>
<label>Title<input name="title" required></label>
<label>Place<input name="place" placeholder="Florence, Italy"></label>
<label>Caption<textarea name="caption" rows="3"></textarea></label>
<label>Published at (optional)<input name="source_url" type="url" placeholder="https://studios.krafftco.com/florence/"></label>
<button>Register and hold</button>
<p class="note">Watermark reads the camera, lens and time, fingerprints the original, and writes the registration to the ledger. The original is never shown publicly.</p></form></details>
<table class="tbl"><thead><tr><th></th><th>Work</th><th>Camera</th><th>Registered</th><th>Visibility</th><th></th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7">The vault is empty.</td></tr>'}</tbody></table></section>` });
}

function licenses({ list }) {
  const rows = list.map(l => `<tr><td><a href="/studio/licenses/${esc(l.ref)}">${esc(l.ref)}</a></td><td>${date(l.created_at)}</td><td>${esc(l.title)}</td><td>${esc(l.licensee_company || l.licensee_name)}<br><small>${esc(l.licensee_email)}</small></td><td>${esc(l.use_name)}</td><td>${money(l.price_cents)}</td><td><span class="pill s-${esc(l.status)}">${esc(l.status.replace('_', ' '))}</span></td></tr>`).join('');
  return layout({ studio: true, title: 'Licenses · Watermark', body: `<section class="studio-wrap">${nav('/studio/licenses')}<h1>Licenses.</h1>
<table class="tbl"><thead><tr><th>Ref</th><th>Date</th><th>Work</th><th>Licensee</th><th>Use</th><th>Fee</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No requests yet.</td></tr>'}</tbody></table></section>` });
}

function licenseDetail({ l, payLink, notice }) {
  const open = l.status === 'requested' || l.status === 'awaiting_payment';
  return layout({ studio: true, title: `${l.ref} · Watermark`, body: `<section class="studio-wrap">${nav('/studio/licenses')}
<p class="k">${esc(l.ref)}</p><h1>${esc(l.title)}</h1>${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<dl class="facts"><div><dt>Licensee</dt><dd>${esc(l.licensee_name)}${l.licensee_company ? ', ' + esc(l.licensee_company) : ''} &middot; <a href="mailto:${esc(l.licensee_email)}">${esc(l.licensee_email)}</a></dd></div>
<div><dt>Use</dt><dd>${esc(l.use_name)} (${esc(termText(l))})</dd></div>
<div><dt>Intended</dt><dd>${esc(l.intended_use || '—')}</dd></div>
<div><dt>Fee</dt><dd>${money(l.price_cents)}</dd></div>
<div><dt>Status</dt><dd><span class="pill s-${esc(l.status)}">${esc(l.status.replace('_', ' '))}</span></dd></div></dl>
${payLink ? `<p class="ok">Payment link for the licensee: <a href="${esc(payLink)}">${esc(payLink)}</a></p>` : ''}
${open ? `<div class="actions">
<form method="post" action="/studio/licenses/${esc(l.ref)}/quote" class="form inline"><label>Set the fee (USD)<input name="price" type="number" min="1" step="1" value="${l.price_cents ? l.price_cents / 100 : ''}" required></label><button>Send for payment</button></form>
<form method="post" action="/studio/licenses/${esc(l.ref)}/grant" class="inline"><button>Grant without payment</button></form>
<form method="post" action="/studio/licenses/${esc(l.ref)}/decline" class="inline"><button class="link">Decline</button></form></div>` : ''}
<p><a href="/c/${esc(l.ref)}">Open the certificate</a></p></section>` });
}

function uses({ list, notice }) {
  const rows = list.map(u => `<tr><td><b>${esc(u.name)}</b><br><small>${esc(u.description)}</small></td><td>${esc(termText(u))}</td><td><form method="post" action="/studio/uses/${esc(u.key)}" class="inline"><input name="price" type="number" min="${u.key === 'social' ? 3 : 0}" step="1" value="${u.price_cents == null ? '' : Math.round(u.price_cents / 100)}" placeholder="On request"><button>Save</button></form>${u.key === 'social' ? '<br><small>About the price of a coffee. Whole dollars, $3 at least.</small>' : ''}</td></tr>`).join('');
  return layout({ studio: true, title: 'Uses & prices · Watermark', body: `<section class="studio-wrap">${nav('/studio/uses')}<h1>Uses and prices.</h1>${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<p class="lede">Leave a price empty to take requests and quote each one yourself. A price lets licensees pay at once.</p>
<table class="tbl"><thead><tr><th>Use</th><th>Term</th><th>Price (USD)</th></tr></thead><tbody>${rows}</tbody></table></section>` });
}


// One work: the maker's terms, and the life of the photograph so far.
function workTerms({ makerName = '', w, rules, uses, NEVER, seen, lic, seals = [], rooms = [], views = [], notice }) {
  const open = k => !rules.uses || rules.uses.includes(k);
  const paid = lic.filter(l => ['active', 'expired'].includes(l.status));
  const earned = paid.reduce((a, l) => a + (l.price_cents || 0), 0);
  const life = lic.map(l => `<tr><td><a href="/studio/licenses/${esc(l.ref)}">${esc(l.ref)}</a></td><td>${date(l.starts_at || l.created_at)}</td><td>${esc(l.licensee_company || l.licensee_name)}</td><td>${esc(l.use_name)}</td><td>${money(l.price_cents)}</td><td><span class="pill s-${esc(l.status)}">${esc(l.status.replace('_', ' '))}</span></td></tr>`).join('');
  const sg = seen.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a> &middot; ${date(x.created_at)} &middot; ${esc(x.status)}</li>`).join('');
  return layout({ studio: true, title: `${w.title} · Studio`, body: `<section class="studio-wrap">${nav('/studio/works')}
<div class="wt"><img src="/img/${esc(w.slug)}/thumb" alt="" width="160"><div><p class="k">${esc(w.accession || 'Catalogue')}</p><h1>${esc(w.title)}</h1>
<div class="stats"><div><b>${money(earned)}</b><span>earned for you</span></div><div><b>${paid.length}</b><span>times licensed</span></div><div><b>${seen.length}</b><span>sightings</span></div></div></div></div>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<p class="vo-link"><a href="/voices/${esc(w.slug)}">Voices: record what you think of this photograph, or add an art historian or a note &rarr;</a></p>
<h2>Catalogue record</h2>
<div class="cat"><dl class="facts cat-fixed">
<div><dt>Accession</dt><dd>${esc(w.accession || '')}</dd></div><div><dt>Maker</dt><dd>${esc(makerName)}</dd></div>
<div><dt>Date made</dt><dd>${w.taken_at ? date(w.taken_at) : 'Unknown'}</dd></div><div><dt>Registered</dt><dd>${date(w.created_at)}</dd></div>
<div><dt>Dimensions</dt><dd>${w.width && w.height ? `${w.width} × ${w.height} px · prints to ${Math.round(w.width / 300 * 2.54)} × ${Math.round(w.height / 300 * 2.54)} cm at 300 dpi` : ''}</dd></div>
<div><dt>Camera</dt><dd>${esc([w.camera, w.lens].filter(Boolean).join(', '))}</dd></div>
<div><dt>Fingerprint</dt><dd><code>${esc(w.sha256.slice(0, 24))}…</code></dd></div></dl>
<form method="post" action="/studio/works/${esc(w.slug)}/catalogue" class="form cat-form">
<label>Title<input name="title" value="${esc(w.title)}" required></label>
<label>Place<input name="place" value="${esc(w.place || '')}" placeholder="Florence, Italy"></label>
<label>Medium<input name="medium" value="${esc(w.medium || 'Digital photograph')}"></label>
<label>Credit line<input name="credit" value="${esc(w.credit || '')}" placeholder="${esc(makerName)}"></label>
<label>Copyright registration<input name="copyright_reg" value="${esc(w.copyright_reg || '')}" placeholder="VA 2-345-678"></label>
<label>Edition size<input name="edition" type="number" min="1" step="1" value="${w.edition_size || ''}" placeholder="Open edition"></label>
<label>Collect price, USD<input name="share" type="number" min="3" step="1" value="${w.share_cents ? Math.round(w.share_cents / 100) : ''}" placeholder="Your standard price"></label>
<label class="chk"><input type="checkbox" name="noshare" value="1" ${w.rules && /"social":false/.test(w.rules) ? 'checked' : ''}> License only: no Share it on this photograph</label>
<label class="wide">Keywords<input name="keywords" value="${esc(w.keywords || '')}" placeholder="architecture, cathedral, fresco, Renaissance"></label>
<label class="wide">Wall text<textarea name="caption" rows="4" placeholder="What it is, when and why it was made.">${esc(w.caption || '')}</textarea></label>
<fieldset class="wide"><legend>Collections</legend>${rooms.length ? rooms.map(c => `<label class="chk"><input type="checkbox" name="rooms" value="${c.id}" ${c.has ? 'checked' : ''}> ${esc(c.title)}</label>`).join('') : '<small>No collections yet. Start one from Works.</small>'}</fieldset>
<button>Save the record</button></form></div>
<h2>Exhibition history</h2><table class="tbl"><thead><tr><th>Where</th><th>How</th><th>Views</th><th>First</th><th>Latest</th></tr></thead><tbody>${views.map(v => `<tr><td>${esc(v.host || 'Watermark')}</td><td>${esc({ view: 'Its page', open: 'License page opened', embed: 'Embedded with credit' }[v.kind] || v.kind)}</td><td>${v.n}</td><td>${esc(v.first)}</td><td>${esc(v.last)}</td></tr>`).join('') || '<tr><td colspan="5">Not shown anywhere yet.</td></tr>'}${w.source_url ? `<tr><td colspan="5">Published at <a href="${esc(w.source_url)}" target="_blank" rel="noopener">${esc(w.source_url.replace(/^https?:\/\//, ''))}</a></td></tr>` : ''}</tbody></table>
<h2>Terms</h2>
<form method="post" action="/studio/works/${esc(w.slug)}" class="form terms-form">
<h2>Open to</h2>${uses.map(u => `<label class="chk"><input type="checkbox" name="uses" value="${esc(u.key)}" ${open(u.key) ? 'checked' : ''}> ${esc(u.name)} <small>${money(u.price_cents)}</small></label>`).join('')}
<h2>Approval</h2><label class="chk"><input type="checkbox" name="approve" value="1" ${rules.approve ? 'checked' : ''}> Approve each license myself before the buyer pays</label>
<h2>Never for</h2>${Object.entries(NEVER).map(([k, v]) => `<label class="chk"><input type="checkbox" name="never" value="${k}" ${rules.never.includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}
<h2>Its public record</h2><label class="chk"><input type="checkbox" name="showEarned" value="1" ${rules.showEarned ? 'checked' : ''}> Show what this photograph has earned on its public life page</label>
<h2>Credit</h2><label class="chk"><input type="checkbox" name="credit" value="1" ${rules.credit ? 'checked' : ''}> Require credit wherever the use allows</label>
<button>Save my terms</button><p class="note">Terms apply to every new license and are written into its certificate and the delivered file. Licenses already granted keep the terms they were sold under.</p></form>
<h2>The life of this photograph</h2><table class="tbl"><thead><tr><th>Ref</th><th>Date</th><th>Licensee</th><th>Use</th><th>Fee</th><th>Status</th></tr></thead><tbody>${life || '<tr><td colspan="6">Not licensed yet.</td></tr>'}</tbody></table>
<h2 id="seals">Sealed copies</h2>
<p class="lede">Send the full photograph to a client, an editor or a printer without letting it go. A sealed file opens only in the Watermark viewer, every opening is counted here, and you can close it at any time.</p>
<form method="post" action="/studio/works/${esc(w.slug)}/seal" class="form inline seal-form"><label>For<input name="label" placeholder="An editor at a magazine"></label>
<label>Size<select name="size"><option value="large">Large (2400 px)</option><option value="original">Full resolution</option></select></label>
<label>Open for<select name="days"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="365">A year</option><option value="0">Until I close it</option></select></label><button>Seal a copy</button></form>
<table class="tbl"><thead><tr><th>For</th><th>Sealed</th><th>Size</th><th>Open until</th><th>Opened</th><th>Status</th><th></th></tr></thead><tbody>${seals.map(s => `<tr><td>${esc(s.label || '—')}</td><td>${date(s.created_at)}</td><td>${s.size === 'original' ? 'Full' : 'Large'}</td><td>${s.expires_at ? date(s.expires_at) : 'Until closed'}</td><td>${s.opens}${s.last_opened_at ? `<br><small>last ${date(s.last_opened_at)}</small>` : ''}</td><td>${s.status === 'open' ? 'Open' : 'Closed'}</td>
<td><a href="/studio/seals/${esc(s.id)}.wmk">Download</a> &middot; <form method="post" action="/studio/seals/${esc(s.id)}/${s.status === 'open' ? 'close' : 'open'}" class="inline"><button class="link">${s.status === 'open' ? 'Close it' : 'Reopen'}</button></form></td></tr>`).join('') || '<tr><td colspan="7">Nothing sealed yet.</td></tr>'}</tbody></table>
<h2>Sightings</h2><ul class="plain">${sg || '<li>None reported.</li>'}</ul>
<p class="note">Fingerprint <code>${esc(w.sha256)}</code></p></section>` });
}

function sightings({ list, embeds, base }) {
  const st = { new: 'New', licensed: 'Licensed', offered: 'License offered', resolved: 'Let it be' };
  const rows = list.map(x => `<tr><td><a href="/studio/works/${esc(x.slug)}">${esc(x.title)}</a></td><td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url.replace(/^https?:\/\//, '').slice(0, 60))}</a>${x.note ? `<br><small>${esc(x.note)}</small>` : ''}</td><td>${date(x.created_at)}</td>
<td><form method="post" action="/studio/sightings/${x.id}" class="inline"><select name="status" onchange="this.form.submit()">${Object.entries(st).map(([k, v]) => `<option value="${k}" ${x.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></form>
<a class="link" href="mailto:?subject=${encodeURIComponent(`Your use of "${x.title}"`)}&body=${encodeURIComponent(`Hello,\n\nI'm the photographer behind "${x.title}", which appears at ${x.url}. I'd be glad for you to keep using it. You can license it in a minute here:\n\n${base}/license/${x.slug}\n\nThank you.`)}">Offer a license</a></td></tr>`).join('');
  const em = embeds.map(e => `<tr><td>${esc(e.host)}</td><td>${esc(e.title)}</td><td>${e.n}</td><td>${esc(e.last)}</td></tr>`).join('');
  return layout({ studio: true, title: 'Sightings · Watermark', body: `<section class="studio-wrap">${nav('/studio/sightings')}<h1>Where your work has been seen.</h1>
<p class="lede">Reported by people who noticed it, and counted wherever it is embedded with credit. You decide what to do: offer a license, ask for credit, or let it be.</p>
<h2>Reported</h2><table class="tbl"><thead><tr><th>Work</th><th>Where</th><th>Reported</th><th>Your call</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No sightings reported.</td></tr>'}</tbody></table>
<h2>Embedded with credit</h2><table class="tbl"><thead><tr><th>Site</th><th>Work</th><th>Views</th><th>Last seen</th></tr></thead><tbody>${em || '<tr><td colspan="4">Not embedded anywhere yet.</td></tr>'}</tbody></table></section>` });
}

function makers({ list }) {
  const rows = list.map(a => `<tr><td><b>${esc(a.name)}</b><br><small><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></small></td><td>${esc(a.practice || '')}</td><td>${a.portfolio ? `<a href="${esc(a.portfolio)}" target="_blank" rel="noopener">${esc(a.portfolio.replace(/^https?:\/\//, ''))}</a>` : ''}${a.note ? `<br><small>${esc(a.note)}</small>` : ''}</td><td>${date(a.created_at)}</td>
<td>${a.status === 'invited' ? 'Invited' : `<form method="post" action="/studio/accounts" class="inline"><input type="hidden" name="name" value="${esc(a.name)}"><input type="hidden" name="email" value="${esc(a.email)}"><input type="hidden" name="application" value="${a.id}"><button>Approve and invite</button></form>`}
<form method="post" action="/studio/makers/${a.id}" class="inline"><select name="status" onchange="this.form.submit()">${['new', 'invited', 'declined'].map(k => `<option ${a.status === k ? 'selected' : ''}>${k}</option>`).join('')}</select></form></td></tr>`).join('');
  return layout({ studio: true, title: 'Makers · Watermark', body: `<section class="studio-wrap">${nav('/studio/makers')}<h1>Makers who want in.</h1>
<table class="tbl"><thead><tr><th>Maker</th><th>Practice</th><th>Work</th><th>Applied</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No applications yet.</td></tr>'}</tbody></table></section>` });
}

// The Trove. The maker's private gallery: every work, what it is, and what it has done.
function trove({ maker, rows, totals, sort, room, rooms, untapped, notice, view = 'wall' }) {
  const q = (o) => { const p = new URLSearchParams({ ...(room ? { room: room.slug } : {}), sort, ...(view === 'list' ? { view: 'list' } : {}), ...o }); return '/studio/trove?' + p; };
  // The catalogue register: one row a work, the way a curator reads an archive.
  const st = w => ({ held: 'Published', private: 'Private', hidden: 'Private', draft: 'Draft' }[w.status] || esc(w.status));
  const list = `<table class="cat"><thead><tr><th>Accession</th><th></th><th>Title</th><th>Date made</th><th>Place</th><th>Medium · size</th><th>Edition</th><th>U.S. ©</th><th>Status</th><th class="r">Licensed</th><th class="r">Seen</th><th class="r">Earned</th><th>Record</th></tr></thead><tbody>${rows.map(w => `<tr>
<td class="acc">${esc(w.accession || '')}</td><td class="cat-th"><a href="/studio/works/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"></a></td>
<td class="cat-t"><a href="/studio/works/${esc(w.slug)}">${esc(w.title)}</a>${w.stars ? `<small>${'&#9733;'.repeat(w.stars)}</small>` : ''}</td>
<td>${w.taken_at ? esc(String(w.taken_at).slice(0, 10)) : '<i>—</i>'}</td><td>${esc(w.place || '')}</td><td>Digital photograph${w.width ? ` · ${w.width}&thinsp;×&thinsp;${w.height}` : ''}</td>
<td>${w.edition_size ? `of ${w.edition_size}` : 'open'}</td><td>${w.copyright_reg ? `<span class="cat-reg">${esc(w.copyright_reg)}</span>` : '<i>—</i>'}</td><td>${st(w)}</td>
<td class="r">${w.licensed}</td><td class="r">${w.seen}</td><td class="r">${money(w.earned)}</td><td>${w.missing.length ? `<span class="cat-miss">${w.complete}%</span>` : '<span class="cat-ok">Complete</span>'}</td></tr>`).join('')}</tbody></table>`;
  const sorts = [['stars', 'The rubies: by stars'], ['earned', 'Most earned'], ['standing', 'Most applauded'], ['duds', 'Seen, never applauded'], ['seen', 'Most seen'], ['untapped', 'Seen, never licensed'], ['taken', 'Date made'], ['newest', 'Newest in'], ['unfinished', 'Needs cataloguing']];
  const tiles = rows.map(w => `<a class="tv-w" href="/studio/works/${esc(w.slug)}">
<span class="tv-f"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy" draggable="false">${w.sealed ? '<i class="tv-s" title="Sealed copies out">Sealed</i>' : ''}</span>
<span class="tv-acc">${esc(w.accession || '')}</span><b>${esc(w.title)}</b><span class="tv-pl">${esc([w.place, w.taken_at ? String(w.taken_at).slice(0, 4) : ''].filter(Boolean).join(', '))}</span>
<span class="tv-n"><em>${money(w.earned)}</em><span>${w.stars ? '&#9733;'.repeat(w.stars) + ' · ' : ''}${w.licensed} licensed · ${w.seen} seen${w.applause ? ` · ${w.applause} applauded` : ''}${w.captures ? ` · ${w.captures} screenshot${w.captures === 1 ? '' : 's'}` : ''}${w.sites ? ` · ${w.sites} site${w.sites > 1 ? 's' : ''}` : ''}</span></span>
${w.missing.length ? `<span class="tv-miss">Record ${w.complete}% · add ${esc(w.missing.join(', '))}</span>` : '<span class="tv-ok">Record complete</span>'}</a>`).join('');
  return layout({ studio: true, title: 'Works · Watermark', body: `<section class="studio-wrap tv">${nav('/studio/trove')}
<div class="tv-head"><div><p class="k">${esc(maker.house || maker.name)}</p><h1>${room ? esc(room.title) : 'The works.'}</h1>
${room && room.note ? `<p class="lede">${esc(room.note)}</p>` : `<p class="lede">Everything you hold, what each work is, and what it has done in its life.</p>`}</div>
<div class="tv-tot"><div><b>${money(totals.earned)}</b><span>earned, lifetime</span></div><div><b>${totals.works}</b><span>works held</span></div><div><b>${totals.licensed}</b><span>licensed at least once</span></div><div><b>${totals.seen}</b><span>times seen</span></div><div><b>${totals.complete}%</b><span>catalogued</span></div></div></div>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
${untapped.length && !room ? `<div class="tv-hint"><span class="k">Worth a look</span> Seen often, never licensed: ${untapped.map(w => `<a href="/studio/works/${esc(w.slug)}">${esc(w.title)}</a> (${w.seen})`).join(', ')}. A wall text, a collection or a public room can turn attention into a license.</div>` : ''}
<nav class="tv-rooms"><a href="${'/studio/trove?sort=' + sort}"${room ? '' : ' aria-current="page"'}>All works</a>${rooms.map(c => `<a href="/studio/trove?room=${esc(c.slug)}&sort=${sort}"${room && room.id === c.id ? ' aria-current="page"' : ''}>${esc(c.title)} <small>${c.n}</small>${c.public ? ' <small>· public</small>' : ''}</a>`).join('')}
<details class="tv-new"><summary>New collection</summary><form method="post" action="/studio/collections" class="form"><label>Title<input name="title" required placeholder="Florence, 2025"></label><label>Wall text<textarea name="note" rows="2"></textarea></label><label class="chk"><input type="checkbox" name="public" value="1"> Give it a public room</label><button>Open the collection</button></form></details></nav>
${room && room.public ? `<p class="note">Public room: <a href="/rooms/${esc(room.slug)}">/rooms/${esc(room.slug)}</a></p>` : ''}
<div class="tv-sort">${sorts.map(([k, t]) => `<a href="${q({ sort: k })}"${k === sort ? ' aria-current="page"' : ''}>${t}</a>`).join('')}<span class="tv-view"><a href="${q({ view: 'wall' })}"${view === 'wall' ? ' aria-current="page"' : ''}>The wall</a><a href="${q({ view: 'list' })}"${view === 'list' ? ' aria-current="page"' : ''}>The register</a></span></div>
${view === 'list' ? `<div class="cat-wrap">${rows.length ? list : '<p class="empty">Nothing here yet.</p>'}</div>` : `<div class="tv-grid">${tiles || '<p class="empty">Nothing here yet. Register a work in the Vault.</p>'}</div>`}</section>` });
}

// Holdings: the collection as a body of assets. One number, where it came from, what needs you, and
// every work as a line on a statement.
function holdings({ maker, t, streams, needs, rows, recent, notice }) {
  const pct = n => (t.earned ? Math.round(100 * n / t.earned) : 0);
  const ed = w => w.edition_size ? `<span class="hd-ed"><i style="--p:${Math.min(100, Math.round(100 * w.sold / w.edition_size))}%"></i>${w.sold} of ${w.edition_size}</span>` : `<span class="hd-ed hd-open">Open</span>`;
  const line = w => `<a class="hd-row" href="/studio/works/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><span class="hd-t"><b>${esc(w.title)}</b><small>${esc(w.accession || '')}${w.place ? ' · ' + esc(w.place) : ''}</small></span>${ed(w)}<span class="hd-c">${w.licensed}</span><span class="hd-c">${w.seen30}</span><span class="hd-v">${money(w.earned)}</span></a>`;
  const need = needs.filter(n => n.n > 0);
  return layout({ studio: true, title: 'Holdings · Watermark', body: `<section class="studio-wrap hd">${nav('/studio')}
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<header class="hd-top"><p class="k">${esc(maker.house || maker.name)} · Holdings</p>
<div class="hd-big"><b>${money(t.earned)}</b><span>earned from the collection, lifetime${t.month ? ` · ${money(t.month)} this month` : ''}</span></div>
<div class="hd-mix">${streams.map(s => `<div><span class="k">${esc(s.name)}</span><b>${money(s.cents)}${s.per ? `<small>${esc(s.per)}</small>` : ''}</b>${s.note ? `<small>${esc(s.note)}</small>` : `<i style="--p:${pct(s.cents)}%"></i>`}</div>`).join('')}</div>
<div class="hd-held"><span><b>${t.works}</b> works held</span><span><b>${t.rooms}</b> rooms</span><span><b>${t.numbered}</b> numbered to <b>${t.collectors}</b> collector${t.collectors === 1 ? '' : 's'}</span><span><b>${t.seen30}</b> seen in 30 days</span><span><b>${t.complete}%</b> catalogued</span></div></header>
<section class="hd-need"><h2>Needs you</h2>${need.length ? `<ul>${need.map(n => `<li><a href="${n.href}"><b>${n.n}</b>${esc(n.label)}<span>→</span></a></li>`).join('')}</ul>` : '<p class="hd-calm">Nothing waiting. The collection is in order.</p>'}</section>
<section class="hd-list"><div class="hd-h"><h2>The holdings</h2><a href="/studio/trove">All ${t.works} works →</a></div>
<div class="hd-head"><span></span><span>Work</span><span>Edition</span><span class="hd-c">Licensed</span><span class="hd-c">Seen, 30d</span><span class="hd-v">Earned</span></div>
${rows.map(line).join('') || '<p class="empty">Nothing held yet. <a href="/studio/works">Add photographs</a>.</p>'}</section>
${recent.length ? `<section class="hd-list"><div class="hd-h"><h2>Lately</h2><a href="/studio/licenses">Every license →</a></div>${recent.map(l => `<a class="hd-ev" href="/studio/licenses/${esc(l.ref)}"><span>${date(l.starts_at || l.created_at)}</span><b>${esc(l.title)}</b><span>${esc(l.use_name)}${l.collector_no ? ` · No. ${l.collector_no}` : ''}</span><span class="hd-v">${money(l.price_cents)}</span></a>`).join('')}</section>` : ''}
</section>` });
}


// Masters: choose the archive folder once; every full-resolution file is matched to the work it was
// published as and becomes that work's original. Frames not yet published are held privately.
function masters({ upgraded, web, need = [], min = {}, ok = null }) {
  const U = { social: 'Collect', reference: 'the Reference', editorial: 'In a story', commercial: 'For a company', campaign: 'Before an audience', print: 'On a wall' };
  return layout({ studio: true, title: 'Masters · Watermark', body: `<section class="studio-wrap">${nav('/studio/masters')}
<p class="k">Vault</p><h1>Masters.</h1>
<p class="lede">${upgraded} works held at full resolution; ${web} still from the web copy.</p>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
<section class="hd-list" id="need"><div class="hd-h"><h2>Waiting for a master</h2><span>${need.length} public photograph${need.length === 1 ? '' : 's'}</span></div>
<p class="note">What each use needs: ${Object.entries(min).map(([k, v]) => `${esc(U[k] || k)} ${v} MP`).join(' &middot; ')}. Below the line, a buyer can still ask, and you are told to upload the master; nothing low-resolution is sent for a campaign or a print.</p>
${need.length ? need.map(w => `<div class="ms-row"><img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy"><div><b>${esc(String(w.title).replace(/[.\s]+$/, ''))}</b><span>${w.width && w.height ? `${w.width.toLocaleString('en-US')} &times; ${w.height.toLocaleString('en-US')}, ${w.mp.toFixed(1)} MP` : 'Size unknown'} &middot; waiting: ${w.waiting.map(k => esc(U[k] || k)).join(', ')}</span></div>
<form method="post" action="/studio/works/${esc(w.slug)}/master" enctype="multipart/form-data" class="ms-up"><label><input type="file" name="file" accept="image/jpeg,image/tiff,image/png" required onchange="this.form.submit()"><span>Upload the master</span></label></form></div>`).join('') : '<p class="hd-calm">Every public photograph is held at full resolution.</p>'}</section>
<form method="post" action="/studio/credentials/scan" class="inline"><button class="link">Read Content Credentials from every original</button></form>
<form class="form upload bulk" onsubmit="return false">
<label class="drop"><input type="file" id="mFiles" webkitdirectory directory multiple><b>Choose your exports folder</b><span>Every JPEG, TIFF or PNG inside, in every subfolder. A file that matches a work already held replaces its web copy as the original; one that matches nothing is registered privately in an archive room for its place. Folders starting with an underscore (contact sheets, web exports) are skipped. Leave this page open; you can stop and pick up later.</span></label>
<button type="button" id="mGo" disabled>Choose a folder</button>
<p id="mSum" class="small"></p>
<ol class="bulk-list" id="mList"></ol>
</form>
<script>(function(){var inp=document.getElementById('mFiles'),go=document.getElementById('mGo'),sum=document.getElementById('mSum'),list=document.getElementById('mList'),files=[],K='wm-masters-done',done={};
try{done=JSON.parse(localStorage.getItem(K)||'{}')}catch(e){}
function keep(f){var p=f.webkitRelativePath||f.name;return /\\.(jpe?g|tiff?|png)$/i.test(f.name)&&!/(^|\\/)[_.]/.test(p)&&!done[p+':'+f.size]}
inp.onchange=function(){files=[].filter.call(inp.files,keep);go.disabled=!files.length;go.textContent=files.length?'Hold '+files.length+' masters':'Nothing new in that folder';sum.textContent=Object.keys(done).length?Object.keys(done).length+' already done on this computer.':''};
go.onclick=async function(){go.disabled=true;var n={master:0,archive:0,known:0,smaller:0,skip:0},i=0,t0=Date.now();
async function one(f){var p=f.webkitRelativePath||f.name,fd=new FormData();fd.append('file',f);fd.append('folder',p.split('/').slice(0,-1).join('/'));
for(var a=0;a<3;a++){try{var r=await fetch('/studio/masters/one',{method:'POST',body:fd,credentials:'same-origin'});if(r.status===401||r.redirected){sum.textContent='Signed out: sign in again and choose the folder; it picks up where it stopped.';throw 'stop'}var j=await r.json();
if(j.ok){n[j.outcome]++;done[p+':'+f.size]=1;try{localStorage.setItem(K,JSON.stringify(done))}catch(e){}if(j.outcome==='master'){var li=document.createElement('li');li.className='done';li.innerHTML='<span>'+p+'</span> <a href="/w/'+j.slug+'">'+(j.title||j.slug)+'</a>';list.insertBefore(li,list.firstChild)}}else n.skip++;return}catch(e){if(e==='stop')throw e;await new Promise(function(r){setTimeout(r,2000*(a+1))})}}n.skip++}
async function worker(){while(i<files.length){var f=files[i++];await one(f);var s=(Date.now()-t0)/1000,left=Math.round(s/i*(files.length-i)/60);go.textContent=i+' of '+files.length+(left?' · about '+left+' min left':'');sum.textContent=n.master+' upgraded to full resolution · '+n.archive+' new to the archive (private) · '+(n.known+n.smaller)+' already held'+(n.skip?' · '+n.skip+' skipped':'')}}
try{await Promise.all([worker(),worker(),worker()]);go.textContent='Done'}catch(e){go.textContent='Stopped'}};})();</script>
</section>` });
}

// Edition sizes: proposed, adjusted and approved in one pass.
function editions({ rows, notice }) {
  const open = rows.filter(r => !r.edition_size), done = rows.filter(r => r.edition_size);
  const row = r => `<label class="ed-row"><input type="checkbox" name="on_${r.id}" value="1" ${r.edition_size ? '' : 'checked'}><img src="/img/${esc(r.slug)}/thumb" alt="" loading="lazy"><span class="hd-t"><b>${esc(r.title)}</b><small>${esc(r.place || '')}${r.sold ? ` &middot; ${r.sold} already collected` : ''}</small></span><span class="ed-why">${esc(r.why)}</span><span class="ed-in">Edition of <input name="size_${r.id}" inputmode="numeric" value="${r.edition_size || r.size}" aria-label="Edition size for ${esc(r.title)}"></span></label>`;
  return layout({ studio: true, title: 'Editions · Watermark', body: `<section class="studio-wrap hd">${nav('/studio/editions')}
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}<p class="k">Editions</p><h1>Number the collection.</h1>
<p class="lede">A size makes a photograph a numbered limited edition: collectors hold No. 3 of 25, and once an edition is complete it passes only between them, on the market. Proposed sizes are rarer for the works that matter most. Adjust any number, untick what should stay open, and approve. A size can be raised later, never lowered below what has been collected.</p>
<form method="post" action="/studio/editions">
${open.length ? `<section class="hd-list"><div class="hd-h"><h2>Not yet numbered</h2><span class="hd-n">${open.length}</span></div>${open.map(row).join('')}</section>` : '<p class="hd-calm">Every public photograph is numbered.</p>'}
${done.length ? `<details class="ed-done"><summary>Already numbered (${done.length})</summary>${done.map(row).join('')}</details>` : ''}
<p class="ed-go"><button class="buy-btn">Approve these editions</button></p></form></section>` });
}

// Copyright: the bridge to the U.S. Copyright Office.
function copyright({ proposals, groups, reg, fee, notice }) {
  const st = { prepared: 'Prepared', filed: 'Filed', registered: 'Registered' };
  const g = x => `<div class="cr-g"><div class="cr-h"><b>${esc(x.title || '')}</b><span class="cr-s cr-${esc(x.status)}">${st[x.status] || x.status}</span></div>
<p class="cr-m">${x.n} photograph${x.n === 1 ? "" : "s"} &middot; ${x.kind === 'GRPPH' ? 'Group of published photographs' : 'Group of unpublished photographs'} &middot; ${money(fee)} filing fee${x.sr ? ` &middot; Service request ${esc(x.sr)}` : ''}${x.reg ? ` &middot; <b>${esc(x.reg)}</b>` : ''}</p>
<div class="cr-a"><a href="/studio/copyright/${x.id}/titles.csv">Title list (CSV)</a><a href="/studio/copyright/${x.id}/deposit.zip">Deposit copies (ZIP)</a><a href="https://eco.copyright.gov/" rel="noopener" target="_blank">Open eCO &rarr;</a></div>
${x.status === 'prepared' ? `<form method="post" action="/studio/copyright/${x.id}" class="cr-f"><input type="hidden" name="act" value="filed"><input name="sr" placeholder="Service request number, e.g. 1-1234567890" required><button>Mark as filed</button></form><form method="post" action="/studio/copyright/${x.id}" class="inline"><input type="hidden" name="act" value="release"><button class="link">Release these photographs</button></form>` : ''}
${x.status === 'filed' ? `<form method="post" action="/studio/copyright/${x.id}" class="cr-f"><input type="hidden" name="act" value="registered"><input name="reg" placeholder="Registration number, e.g. VA 2-412-118" required><button>Mark as registered</button></form>` : ''}</div>`;
  return layout({ studio: true, title: 'Copyright · Watermark', body: `<section class="studio-wrap hd">${nav('/studio/copyright')}
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}<p class="k">U.S. Copyright Office</p><h1>Register the collection.</h1>
<p class="lede">Registration is what lets a photographer sue for infringement and claim statutory damages. The Office takes up to 750 photographs by one author in a single group, published in one calendar year (or all unpublished), for one ${money(fee)} fee. Watermark prepares each group: the title list and the deposit copies, ready to file in the Office's own system, eCO. When the certificate comes, enter its number and every photograph in the group carries it.</p>
<div class="hd-held"><span><b>${reg}</b> registered</span><span><b>${groups.filter(x => x.status === 'filed').length}</b> group${groups.filter(x => x.status === 'filed').length === 1 ? '' : 's'} filed</span><span><b>${proposals.reduce((a, p) => a + p.works.length, 0)}</b> not yet in a group</span></div>
<section class="hd-list"><div class="hd-h"><h2>Ready to group</h2></div>${proposals.length ? proposals.map(p => `<form method="post" action="/studio/copyright/prepare" class="cr-p"><input type="hidden" name="key" value="${esc(p.key)}"><span><b>${esc(p.label)}${p.part ? `, part ${p.part}` : ''}</b><small>${p.works.length} photograph${p.works.length === 1 ? "" : "s"} &middot; ${p.kind === 'GRPPH' ? 'group of published photographs' : 'group of unpublished photographs'} &middot; ${money(fee)}</small></span><button>Prepare this group</button></form>`).join('') : '<p class="hd-calm">Every photograph is in a group.</p>'}</section>
${groups.length ? `<section class="hd-list"><div class="hd-h"><h2>Groups</h2></div>${groups.map(g).join('')}</section>` : ''}
<p class="note">Check the publication dates before filing: a photograph first published on Krafft Studios may have an earlier date than the one Watermark holds. Watermark is not a law firm; for anything unusual (work made for hire, joint authors, earlier registrations), ask counsel.</p></section>` });
}

// Launch: the rails, checked.
function contract({ review, rights, extras, bundles, add }) {
  const tag = { FIX: 'Corrected', ADDED: 'Added', OPEN: 'For counsel' };
  const U = { social: 'Collect', reference: 'Collect the Reference', editorial: 'In a story', commercial: 'For a company', campaign: 'Before an audience', print: 'On a wall' };
  return layout({ studio: true, title: 'Contract · Watermark', body: `<section class="studio-wrap hd">${nav('/studio/contract')}
<p class="k">Contract</p><h1>The Standard Content License Agreement</h1>
<p class="lede">Counsel's 2021 draft for Watermark Ventures, now assembled for each order from the rights the licensee pays for. Each use carries its rights; anything else can be added at a price or asked of the maker; the maker's never list is written in.</p>
<section class="hd-list"><div class="hd-h"><h2>What each use carries</h2></div>${Object.entries(bundles).map(([k, v]) => `<div class="ln-row"><span class="ln-dot ln-ok"></span><b>${esc(U[k] || k)}</b><span>${v.length ? v.map(r => esc(rights.find(x => x.key === r).label)).join(', ') : k === 'print' ? 'A physical print; no reproduction rights' : ''}${k === 'social' || k === 'reference' ? ' (personal only)' : ''}</span></div>`).join('')}
<div class="ln-row"><span class="ln-dot ln-man"></span><b>Each use added</b><span>+${money(add)} (draft)</span></div>
${extras.map(e => `<div class="ln-row"><span class="ln-dot ln-man"></span><b>${esc(e.label)}</b><span>${e.price == null ? 'Asked of the maker' : '+' + money(e.price) + ' (draft)'}. ${esc(e.note)}</span></div>`).join('')}</section>
<section class="hd-list"><div class="hd-h"><h2>For review with counsel</h2></div>${review.map(([k, where, what]) => `<div class="ln-row"><span class="ln-dot ${k === 'OPEN' ? 'ln-no' : 'ln-man'}"></span><b>${esc(tag[k])} &middot; ${esc(where)}</b><span>${esc(what)}</span></div>`).join('')}</section>
<p class="note">Read the live text for any photograph at /contract/&lt;photograph&gt;. Not legal advice; confirm with counsel before taking live payments on it.</p></section>` });
}

function launch({ checks, live }) {
  const all = checks.flatMap(g => g.items), ready = all.filter(i => i.ok).length;
  return layout({ studio: true, title: 'Launch · Watermark', body: `<section class="studio-wrap hd">${nav('/studio/launch')}
<p class="k">Launch</p><h1>${live ? 'Live.' : 'Before Watermark takes real money.'}</h1>
<p class="lede">Every rail Watermark runs on, checked as this page loads. ${ready} of ${all.length} are in place. Green is done; the rest says exactly what is missing and where it goes.</p>
${checks.map(g => `<section class="hd-list"><div class="hd-h"><h2>${esc(g.group)}</h2></div>${g.items.map(i => `<div class="ln-row"><span class="ln-dot ${i.ok ? 'ln-ok' : i.manual ? 'ln-man' : 'ln-no'}" aria-label="${i.ok ? 'Done' : 'To do'}"></span><b>${esc(i.name)}</b><span>${esc(i.detail || '')}</span></div>`).join('')}</section>`).join('')}
<p class="note">Keys and passwords go in Render's environment settings only, never in chat, Notion or email.</p></section>` });
}

module.exports = { contract, launch, copyright, editions, nav, holdings, masters, login, overview, trove, works, licenses, licenseDetail, uses, workTerms, sightings, makers };
