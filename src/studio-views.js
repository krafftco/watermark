// The Studio: where the maker manages the vault, prices and licenses.
const { layout, esc, money, date, termText } = require('./views');

const nav = active => `<nav class="snav">${[['/studio', 'Overview'], ['/studio/works', 'Vault'], ['/studio/licenses', 'Licenses'], ['/studio/uses', 'Uses & prices']].map(([h, t]) => `<a href="${h}"${h === active ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;

function login({ error }) {
  return layout({ title: 'Studio · Watermark', body: `<section class="narrow"><p class="k">Studio</p><h1>Sign in to your vault.</h1>${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/studio/login" class="form"><label>Password<input type="password" name="password" required autofocus></label><button>Sign in</button></form></section>` });
}

function overview({ maker, stats, recent, views, ending = [], notice }) {
  const en = ending.map(l => `<tr><td><a href="/studio/licenses/${esc(l.ref)}">${esc(l.ref)}</a></td><td>${esc(l.title)}</td><td>${esc(l.licensee_company || l.licensee_name)}</td><td>${date(l.ends_at)}</td><td>${l.renewal_sent_at ? 'Notice sent' : 'Not yet'}</td></tr>`).join('');
  const v = views.map(r => `<tr><td>${esc(r.host || 'watermark')}</td><td>${esc(r.kind)}</td><td>${r.n}</td></tr>`).join('');
  const rl = recent.map(l => `<tr><td><a href="/studio/licenses/${esc(l.ref)}">${esc(l.ref)}</a></td><td>${esc(l.title)}</td><td>${esc(l.licensee_company || l.licensee_name)}</td><td>${esc(l.use_name)}</td><td><span class="pill s-${esc(l.status)}">${esc(l.status.replace('_', ' '))}</span></td></tr>`).join('');
  return layout({ studio: true, title: 'Studio · Watermark', body: `<section class="studio-wrap">${nav('/studio')}
<p class="k">${esc(maker.house || maker.name)}</p><h1>Your estate.</h1>
<div class="stats"><div><b>${stats.works}</b><span>works held</span></div><div><b>${stats.active}</b><span>active licenses</span></div><div><b>${stats.open}</b><span>requests waiting</span></div><div><b>${money(stats.earned || 0)}</b><span>licensed to date</span></div><div><b>${stats.views}</b><span>views, 30 days</span></div></div>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<h2>Ending in the next 60 days</h2><table class="tbl"><thead><tr><th>Ref</th><th>Work</th><th>Licensee</th><th>Ends</th><th>Renewal</th></tr></thead><tbody>${en || '<tr><td colspan="5">Nothing ending soon.</td></tr>'}</tbody></table>
<form method="post" action="/studio/renewals" class="inline" style="margin-top:12px"><button class="link">Send renewal notices now</button></form>
<h2>Recent licenses</h2><table class="tbl"><thead><tr><th>Ref</th><th>Work</th><th>Licensee</th><th>Use</th><th>Status</th></tr></thead><tbody>${rl || '<tr><td colspan="5">None yet.</td></tr>'}</tbody></table>
<h2>Where your work was seen (30 days)</h2><table class="tbl"><thead><tr><th>Site</th><th>Kind</th><th>Count</th></tr></thead><tbody>${v || '<tr><td colspan="3">No views yet.</td></tr>'}</tbody></table>
</section>` });
}

function works({ list, error, notice }) {
  const rows = list.map(w => `<tr><td><img src="/img/${esc(w.slug)}/thumb" alt="" width="72"></td><td><a href="/w/${esc(w.slug)}">${esc(w.title)}</a><br><small>${esc(w.place || '')}</small></td><td>${esc(w.camera || '')}</td><td>${date(w.created_at)}</td><td>${w.status === 'held' ? 'Public' : 'Hidden'}</td><td><form method="post" action="/studio/works/${esc(w.slug)}/toggle"><button class="link">${w.status === 'held' ? 'Hide' : 'Show'}</button></form></td></tr>`).join('');
  return layout({ studio: true, title: 'Vault · Watermark', body: `<section class="studio-wrap">${nav('/studio/works')}
<h1>The vault.</h1>${error ? `<p class="err">${esc(error)}</p>` : ''}${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<form method="post" action="/studio/works" enctype="multipart/form-data" class="form upload">
<p class="k">Register a work</p>
<label>Photograph (JPEG, TIFF or PNG, full resolution)<input type="file" name="file" accept="image/*" required></label>
<label>Title<input name="title" required></label>
<label>Place<input name="place" placeholder="Florence, Italy"></label>
<label>Caption<textarea name="caption" rows="3"></textarea></label>
<label>Published at (optional)<input name="source_url" type="url" placeholder="https://studios.krafftco.com/florence/"></label>
<button>Register and hold</button>
<p class="note">Watermark reads the camera, lens and time, fingerprints the original, and writes the registration to the ledger. The original is never shown publicly.</p></form>
<table class="tbl"><thead><tr><th></th><th>Work</th><th>Camera</th><th>Registered</th><th>Visibility</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6">The vault is empty.</td></tr>'}</tbody></table></section>` });
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
  const rows = list.map(u => `<tr><td><b>${esc(u.name)}</b><br><small>${esc(u.description)}</small></td><td>${esc(termText(u))}</td><td><form method="post" action="/studio/uses/${esc(u.key)}" class="inline"><input name="price" type="number" min="0" step="1" value="${u.price_cents == null ? '' : u.price_cents / 100}" placeholder="On request"><button>Save</button></form></td></tr>`).join('');
  return layout({ studio: true, title: 'Uses & prices · Watermark', body: `<section class="studio-wrap">${nav('/studio/uses')}<h1>Uses and prices.</h1>${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<p class="lede">Leave a price empty to take requests and quote each one yourself. A price lets licensees pay at once.</p>
<table class="tbl"><thead><tr><th>Use</th><th>Term</th><th>Price (USD)</th></tr></thead><tbody>${rows}</tbody></table></section>` });
}

module.exports = { login, overview, works, licenses, licenseDetail, uses };
