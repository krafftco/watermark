// HTML for every page. Plain functions, no template engine.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c, cur = 'usd') => c == null ? 'On request' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
const date = s => s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
const { NEVER } = require('./rules');
const termText = u => u.kind === 'print' ? 'Yours to keep' : u.term_months ? (u.term_months % 12 ? `${u.term_months} months` : `${u.term_months / 12} year${u.term_months > 12 ? 's' : ''}`) : 'Perpetual';

function layout({ title, body, desc = 'Held on Watermark.', bare = false, studio = false }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="noai, noimageai"><meta name="tdm-reservation" content="1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..500;1,6..72,300..500&display=swap">
<link rel="stylesheet" href="/static/style.css"><link rel="icon" href="/static/wave.svg"></head>
<body class="${bare ? 'bare' : ''}${studio ? ' studio' : ''}">
${bare ? '' : `<header class="top"><a class="brand" href="/"><img src="/static/watermark-logo.svg" alt="Watermark" width="120" height="32"></a>
<nav><a href="/collection">Collection</a><a href="/#makers">For makers</a><a href="/verify" class="nv-h">Verify</a>${studio ? '<a href="/studio">Studio</a><a href="/studio/logout">Sign out</a>' : ''}</nav></header>`}
<main>${body}</main>
${bare ? '' : `<footer class="foot"><p>Watermark &middot; a Krafft company &middot; Leave your mark.</p><p><a href="/about">About</a> &middot; <a href="/ledger">Ledger</a> &middot; <a href="/terms">Terms</a></p></footer>`}
</body></html>`;
}

function collection({ maker, works }) {
  const cards = works.map(w => `<a class="card" href="/w/${esc(w.slug)}"><span class="cf"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" draggable="false"></span><span class="ct">${esc(w.title)}</span><span class="cm">${esc(w.place || '')}</span></a>`).join('');
  return layout({
    title: `${maker ? maker.name + ' · ' : ''}Watermark`,
    desc: 'Photographs held, credited and licensed on Watermark.',
    body: `<section class="intro"><p class="k">${maker ? esc(maker.house || maker.name) : 'The collection'}</p>
<h1>Photographs held on Watermark.</h1><p class="lede">Every work here is registered to its maker, shown at screen size, and licensed at the source. Press any photograph to see who made it and how to use it properly.</p></section>
<section class="grid">${cards || '<p class="empty">Nothing is held here yet.</p>'}</section>`
  });
}

function work({ w, maker, uses, base, rules }) {
  const ratio = w.width && w.height ? `${w.width} / ${w.height}` : '3 / 2';
  const facts = [
    ['Maker', maker.name], ['House', maker.house], ['Place', w.place], ['Taken', date(w.taken_at)],
    ['Camera', w.camera], ['Lens', w.lens], ['Registered', date(w.created_at)],
  ].filter(f => f[1]).map(f => `<div><dt>${f[0]}</dt><dd>${esc(f[1])}</dd></div>`).join('');
  const embed = `&lt;script src="${esc(base)}/embed.js" defer&gt;&lt;/script&gt;\n&lt;watermark-image work="${esc(w.slug)}"&gt;&lt;/watermark-image&gt;`;
  const options = uses.map(u => `<a class="use" href="/license/${esc(w.slug)}?use=${esc(u.key)}"><span class="un">${esc(u.name)}</span><span class="up">${money(u.price_cents)}</span><span class="ud">${esc(u.description)} ${esc(termText(u))}.</span><span class="ua">${u.price_cents == null ? 'Ask' : u.kind === 'print' ? 'Order' : 'License'} <i></i></span></a>`).join('');
  return layout({
    title: `${w.title} · ${maker.name} · Watermark`,
    desc: `${w.title}, a photograph by ${maker.name}. Held on Watermark.`,
    body: `<article class="work">
<figure class="plate" style="aspect-ratio:${ratio}" data-viewer data-full="/img/${esc(w.slug)}/large" data-title="${esc(w.title)}" data-credit="Photograph by ${esc(maker.name)}">
<img src="/img/${esc(w.slug)}/screen" alt="${esc(w.title)}" draggable="false"><span class="shield"></span></figure>
<div class="meta">
<p class="k">Held on Watermark</p><h1>${esc(w.title)}</h1>
<p class="by">Photograph by ${esc(maker.name)}${maker.house ? `, ${esc(maker.house)}` : ''}</p>
${w.caption ? `<p class="cap">${esc(w.caption)}</p>` : ''}
<dl class="facts">${facts}</dl>
<h2>Use this photograph</h2><div class="uses">${options}</div>
${rules && rules.never.length ? `<p class="never"><span>The maker says never</span>${rules.never.map(k => esc(NEVER[k])).join(' &middot; ')}</p>` : ''}
<p class="note">Every license is written in plain language, carries its own reference, and is recorded on the <a href="/ledger">ledger</a>. The full file is delivered when the license is granted.</p>
<h2>Embed it with credit</h2><pre class="code">${embed}</pre>
<p class="fp">Fingerprint <code>${esc(w.sha256.slice(0, 16))}&hellip;</code>${w.source_url ? ` &middot; <a href="${esc(w.source_url)}" target="_blank" rel="noopener">See where it was published</a>` : ''}</p>
<p class="note"><a href="/w/${esc(w.slug)}/life">The life of this photograph</a>: when it was registered, and every time it has been licensed.</p>
<details class="report" id="report"><summary>Seen this photograph used somewhere?</summary>
<form method="post" action="/report/${esc(w.slug)}" class="form"><label>Where you saw it<input name="url" type="url" required placeholder="https://"></label>
<label>A note (optional)<input name="note"></label><label>Your email, if the maker may write back (optional)<input name="email" type="email"></label><button>Tell the maker</button></form></details>
</div></article>
<script src="/static/viewer.js" defer></script>`
  });
}

function licenseForm({ w, maker, uses, chosen, error, values = {}, renews }) {
  const opts = uses.map(u => `<label class="opt"><input type="radio" name="use" value="${esc(u.key)}" ${u.key === chosen ? 'checked' : ''} required><span><b>${esc(u.name)}</b> &middot; ${money(u.price_cents)}<br><small>${esc(u.description)} ${esc(termText(u))}.</small></span></label>`).join('');
  return layout({
    title: `License ${w.title} · Watermark`,
    body: `<section class="lic">
<div class="lic-fig"><img src="/img/${esc(w.slug)}/screen" alt="${esc(w.title)}" draggable="false"><p class="cap"><b>${esc(w.title)}</b><br>Photograph by ${esc(maker.name)}</p></div>
<form method="post" action="/license/${esc(w.slug)}" class="form">
<p class="k">License a photograph</p><h1>Use it properly. Pay the person who made it.</h1>
${error ? `<p class="err">${esc(error)}</p>` : ''}
${renews ? `<p class="ok">Renewing license ${esc(renews)}.</p><input type="hidden" name="renews" value="${esc(renews)}">` : ''}
<fieldset><legend>How you will use it</legend>${opts}</fieldset>
<label>Your name<input name="name" required value="${esc(values.name)}"></label>
<label>Email<input name="email" type="email" required value="${esc(values.email)}"></label>
<label>Company<input name="company" value="${esc(values.company)}"></label>
<label>Where and how it will appear<textarea name="intended" rows="4" placeholder="The publication, page or campaign; how long; how many.">${esc(values.intended)}</textarea></label>
<label class="chk"><input type="checkbox" name="agree" value="1" required> I agree to the <a href="/terms" target="_blank">license terms</a>.</label>
<button type="submit">Continue</button>
<p class="note">Priced uses go straight to secure payment. Uses on request are answered by the maker, usually within a day.</p>
</form></section>`
  });
}

// The front door, written for image makers.
function home({ maker, works, uses, sent }) {
  const hero = works[0]; const demo = works[1] || works[0];
  const strip = works.slice(0, 8).map(w => `<a href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" draggable="false"></a>`).join('');
  const price = k => { const u = uses.find(x => x.key === k); return u ? money(u.price_cents) : ''; };
  return layout({
    title: 'Watermark · For the people who make the pictures',
    desc: 'Hold your work, set your terms, and get paid the moment someone uses it properly.',
    body: `<section class="h-hero">${hero ? `<img src="/img/${esc(hero.slug)}/large" alt="" draggable="false">` : ''}<div class="h-shade"></div>
<div class="h-in"><p class="k">Watermark</p><h1>For the people who make the pictures.</h1>
<p class="h-lede">Hold your work. Set your terms. Get paid the moment someone uses it properly.</p>
<p class="h-cta"><a class="h-btn" href="#apply">Hold your work here</a><a class="h-ln" href="/collection">See the collection</a></p></div>
${hero ? `<p class="h-cr">${esc(hero.title)} &middot; Photograph by ${esc(maker.name)}</p>` : ''}</section>

<section class="h-sec" id="makers"><p class="k">Why it is broken</p><h2 class="h2">Your work travels. You don&rsquo;t go with it.</h2>
<div class="h-3"><div><h3>It is taken.</h3><p>A screenshot makes any photograph free to anyone who wants it. The credit is the first thing lost.</p></div>
<div><h3>It is hard to buy.</h3><p>Licensing means a quote, a contract and a week of email. Most people give up and take it instead.</p></div>
<div><h3>It pays someone else.</h3><p>The platforms set the price, keep most of it, and decide where your work appears.</p></div></div></section>

<section class="h-sec h-dark"><p class="k">The maker&rsquo;s say</p><h2 class="h2">Your work. Your terms. Written into every license.</h2>
<div class="h-say">
<div class="h-card"><p class="h-ck">Lake Como, Morning</p>
<div class="h-row"><span>In a story</span><i class="on"></i></div><div class="h-row"><span>For a company</span><i class="on"></i></div><div class="h-row"><span>Before an audience</span><i></i></div><div class="h-row"><span>On a wall</span><i class="on"></i></div>
<div class="h-row h-sep"><span>Approve each license myself</span><i></i></div>
<p class="h-ck">Never for</p><div class="h-tags"><b>Training AI</b><b>Political campaigns</b><b>Altering the image</b></div></div>
<ul class="h-list">
<li><b>Choose the uses.</b> Open a photograph to stories and companies and close it to campaigns. Each work can have its own terms.</li>
<li><b>Set the price.</b> Public, fixed and yours. Buyers see it before they decide, so nobody has to ask.</li>
<li><b>Approve every sale, or none.</b> Let licenses happen on their own, or see each one before it is granted.</li>
<li><b>Say never.</b> Not for AI training. Not for politics. Not altered. Your conditions are written into the license, the certificate and the file itself.</li>
<li><b>Credit, always.</b> Your name travels with the photograph wherever it is embedded or delivered.</li>
</ul></div></section>

<section class="h-sec"><p class="k">Protection</p><h2 class="h2">Protected by design, not by a stamp across the middle.</h2>
<div class="h-6">
<div><h3>The original stays in the vault.</h3><p>Only screen-sized copies are ever shown. The full file leaves only under a license.</p></div>
<div><h3>Fingerprinted on arrival.</h3><p>Every original is fingerprinted and registered on a public ledger that cannot be quietly edited.</p></div>
<div><h3>Licensed inside the file.</h3><p>Each delivered file carries the maker, the licensee, the reference, the term and your conditions.</p></div>
<div><h3>Reserved from AI.</h3><p>Every page and image tells crawlers and AI companies the work is reserved and not theirs to train on.</p></div>
<div><h3>Seen somewhere? You decide.</h3><p>Anyone can report where your work turned up. Offer a license, ask for credit, or let it be.</p></div>
<div><h3>Anyone can verify.</h3><p>Every license has a reference. One look tells a publisher, a client or a court whether a use is licensed.</p></div>
</div></section>

<section class="h-sec h-sale"><p class="k">How a sale happens</p><h2 class="h2">The way it should have always worked.</h2>
<ol class="h-steps"><li><b>They find it.</b>On your site, in an article, or here. The license button travels with the photograph.</li>
<li><b>They choose a use.</b>In a story, ${price('editorial')}. For a company, ${price('commercial')}. The price is in plain sight.</li>
<li><b>They tap once.</b>Apple Pay, Google Pay or a card. No account and no form.</li>
<li><b>It is done.</b>The file, the certificate and the receipt arrive at once. You are paid, and you get a note saying so.</li></ol>
${demo ? `<p><a class="h-btn h-btn-d" href="/license/${esc(demo.slug)}">See it for yourself</a></p>` : ''}</section>

<section class="h-sec h-num"><p class="h-big">85%</p><div><h2 class="h2">Of every license goes to the maker.</h2><p>Watermark&rsquo;s share covers payment, delivery, the ledger and the protection. You own your work, your buyers and your record of sales.</p></div></section>

<section class="h-sec h-by"><p class="k">By image makers</p><h2 class="h2">Built by a photographer, for photographers.</h2>
<p class="h-p">Watermark began seven years ago with a simple frustration: the photographs travelled and the photographer didn&rsquo;t. It is built by Krafft, a creative company, and its first collection is our own. We built it the way we wanted to be treated: credited, asked, and paid.</p>
${strip ? `<div class="h-strip">${strip}</div><p><a class="h-ln h-ln-d" href="/collection">See the collection</a></p>` : ''}</section>

<section class="h-sec h-apply" id="apply"><p class="k">Hold your work here</p><h2 class="h2">We are opening Watermark to a small group of makers first.</h2>
${sent ? '<p class="h-sent">Thank you. We read every application and will write to you personally.</p>' : `<form method="post" action="/apply" class="h-form">
<label>Name<input name="name" required autocomplete="name"></label>
<label>Email<input name="email" type="email" required autocomplete="email"></label>
<label>Where we can see your work<input name="portfolio" type="url" placeholder="https://"></label>
<label>What you make<select name="practice"><option>Photography</option><option>Illustration</option><option>Fine art</option><option>Film and stills</option><option>Something else</option></select></label>
<label class="h-wide">Anything we should know<textarea name="note" rows="3"></textarea></label>
<button class="h-btn h-btn-d h-wide" type="submit">Apply</button></form>`}</section>`
  });
}

// A photograph's record: its title, its terms, and every license in its life.
function life({ w, maker, lic, reg, rules }) {
  const earned = lic.reduce((a, l) => a + (l.price_cents || 0), 0);
  const rows = lic.map(l => `<li><span>${date(l.starts_at)}</span><b>${esc(l.use_name)}</b><em>${l.status === 'active' ? `Active${l.ends_at ? ' until ' + date(l.ends_at) : ''}` : 'Completed'}</em>${rules.showEarned ? `<i>${money(l.price_cents)}</i>` : ''}<a href="/verify?ref=${esc(l.ref)}">${esc(l.ref)}</a></li>`).join('');
  return layout({ title: `The life of ${w.title} · Watermark`, body: `<section class="lifep">
<div class="life-h"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" draggable="false"><div><p class="k">The life of a photograph</p><h1>${esc(w.title)}</h1>
<p class="by">Made by ${esc(maker.name)}${w.taken_at ? `, ${date(w.taken_at)}` : ''}. Rights held by ${esc(maker.name)}.</p></div></div>
<div class="stats"><div><b>${lic.length}</b><span>times licensed</span></div>${rules.showEarned ? `<div><b>${money(earned)}</b><span>earned for its maker</span></div>` : ''}<div><b>${date(w.created_at)}</b><span>registered</span></div></div>
<ol class="life-l"><li><span>${date(w.created_at)}</span><b>Registered on Watermark</b><em>Fingerprint ${esc(w.sha256.slice(0, 16))}&hellip;</em>${reg ? `<a href="/ledger">Ledger ${reg.seq}</a>` : ''}</li>${rows}</ol>
<p class="note">Licensees are not named. Each reference can be checked by anyone at <a href="/verify">/verify</a>.</p>
<p><a class="btn" href="/license/${esc(w.slug)}">License this photograph</a></p></section>` });
}

function reported({ w }) {
  return layout({ title: 'Thank you · Watermark', body: `<section class="done"><p class="k">Sighting received</p><h1>Thank you. The maker will see it.</h1>
<p class="lede">You reported where <em>${esc(w.title)}</em> turned up. The maker decides what happens next. Your details are never published.</p>
<p><a class="btn" href="/w/${esc(w.slug)}">Back to the photograph</a></p></section>` });
}

// The license page. One photograph, four uses, every price in plain sight, one button.
// Payment (Apple Pay, Google Pay, Link, card) collects name and email; nothing is asked twice.
function buy({ w, maker, uses, chosen, renews, instant, rules = { never: [], approve: false } }) {
  const pick = uses.find(u => u.key === chosen) || uses.find(u => u.key === 'commercial') || uses[0];
  const label = u => u.price_cents == null || !instant ? 'Ask the maker' : rules.approve ? `Request for ${money(u.price_cents)}` : `${u.kind === 'print' ? 'Order' : 'License'} for ${money(u.price_cents)}`;
  const rows = uses.map(u => `<label class="bu"><input type="radio" name="use" value="${esc(u.key)}" data-label="${esc(label(u))}" ${u === pick ? 'checked' : ''}>
<span class="bu-n">${esc(u.name)}</span><span class="bu-p">${money(u.price_cents)}</span>
<span class="bu-d">${esc(u.description)} <em>${esc(termText(u))}.</em></span></label>`).join('');
  const ratio = w.width && w.height ? `${w.width} / ${w.height}` : '3 / 2';
  return layout({
    title: `License ${w.title} · Watermark`,
    desc: `License ${w.title}, a photograph by ${maker.name}.`,
    body: `<section class="buy">
<figure class="buy-fig"><div class="buy-plate" style="aspect-ratio:${ratio}"><img src="/img/${esc(w.slug)}/screen" alt="${esc(w.title)}" draggable="false"></div>
<figcaption><b>${esc(w.title)}</b>${w.place ? ` &middot; ${esc(w.place)}` : ''}<br>Photograph by ${esc(maker.name)}</figcaption></figure>
<form method="post" action="/buy/${esc(w.slug)}" class="buy-form">
<p class="k">Held on Watermark</p><h1>Give it somewhere to live.</h1>
${renews ? `<p class="ok">Renewing ${esc(renews)}.</p><input type="hidden" name="renews" value="${esc(renews)}">` : ''}
<fieldset class="bus"><legend class="vh">How it will be used</legend>${rows}</fieldset>
<details class="buy-note"><summary>Add a note for the maker</summary><textarea name="note" rows="3" placeholder="Where it will appear. Optional."></textarea></details>
<button type="submit" class="buy-btn" id="buyBtn">${esc(label(pick))}</button>
${rules.never.length ? `<p class="never"><span>The maker says never</span>${rules.never.map(k => esc(NEVER[k])).join(' &middot; ')}</p>` : ''}
<p class="buy-how">${rules.approve ? 'The maker approves each license personally, usually within the day. You pay only once it is approved.' : instant ? 'Apple Pay, Google Pay or card. The full file, a certificate and a receipt arrive the moment you pay.' : 'The maker replies with terms and a payment link, usually within the day.'}</p>
<ul class="buy-p"><li>Paid to the maker</li><li>Full resolution, licensed in the file</li><li>Recorded on the <a href="/ledger">ledger</a></li></ul>
<p class="buy-more">Exclusivity, a longer term or something larger? <a href="/buy/${esc(w.slug)}?ask=1" data-ask>Ask the maker</a>. &middot; <a href="/terms" target="_blank">The terms</a>, in plain language.</p>
</form></section>
<script>(function(){var b=document.getElementById('buyBtn');document.querySelectorAll('.bu input').forEach(function(i){i.addEventListener('change',function(){b.textContent=i.dataset.label;});});
var a=document.querySelector('[data-ask]');a&&a.addEventListener('click',function(e){e.preventDefault();var f=document.querySelector('.buy-form');var h=document.createElement('input');h.type='hidden';h.name='ask';h.value='1';f.appendChild(h);f.submit();});})();</script>`
  });
}

// For anything bespoke: three fields, then the maker answers.
function ask({ w, maker, u, note, renews, error, approve }) {
  return layout({
    title: `Ask about ${w.title} · Watermark`,
    body: `<section class="buy buy-ask">
<figure class="buy-fig"><div class="buy-plate"><img src="/img/${esc(w.slug)}/screen" alt="${esc(w.title)}" draggable="false"></div>
<figcaption><b>${esc(w.title)}</b><br>Photograph by ${esc(maker.name)}</figcaption></figure>
<form method="post" action="/license/${esc(w.slug)}" class="buy-form form">
<p class="k">${esc(u.name)}${approve && u.price_cents != null ? ` &middot; ${money(u.price_cents)}` : ''}</p><h1>${approve ? 'This maker approves each license personally.' : 'Tell the maker what you have in mind.'}</h1>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<input type="hidden" name="use" value="${esc(u.key)}"><input type="hidden" name="agree" value="1">
${renews ? `<input type="hidden" name="renews" value="${esc(renews)}">` : ''}
<label>Your name<input name="name" required autocomplete="name" autofocus></label>
<label>Email<input name="email" type="email" required autocomplete="email"></label>
<label>The project<textarea name="intended" rows="4" placeholder="Where it will appear, for how long, and whether you need it exclusively.">${esc(note || '')}</textarea></label>
<button type="submit" class="buy-btn">Send to the maker</button>
<p class="buy-how">A reply with terms and a one-tap payment link, usually within the day.</p>
</form></section>`
  });
}

// The moment after paying.
function thanks({ lic, w, maker, use }) {
  const done = lic.status === 'active';
  return layout({
    title: done ? `It's yours · ${w.title}` : 'One moment · Watermark',
    body: `${done ? '' : '<meta http-equiv="refresh" content="3">'}<section class="yours${done ? ' in' : ''}">
<div class="yours-fig"><img src="/img/${esc(w.slug)}/screen" alt="${esc(w.title)}" draggable="false"><span class="yours-seal" aria-hidden="true"><img src="/static/wave.svg" alt=""></span></div>
<div class="yours-t">
<p class="k">${esc(lic.ref)}</p>
<h1>${done ? 'It&rsquo;s yours.' : 'Payment received. Preparing your file.'}</h1>
<p class="lede">${done ? `<em>${esc(w.title)}</em> by ${esc(maker.name)}. ${use.kind === 'print' ? 'A signed archival print, yours to keep. It ships within the week.' : `Licensed ${esc(use.name.toLowerCase())}${lic.ends_at ? ` until ${date(lic.ends_at)}` : ''}.`} ${lic.licensee_email ? `A copy of everything is on its way to ${esc(lic.licensee_email)}.` : ''}` : 'This takes a few seconds.'}</p>
${done ? `<div class="yours-a">${lic.download_token ? `<a class="buy-btn" href="/d/${esc(lic.download_token)}">Download the full file</a>` : ''}
<a class="yours-l" href="/c/${esc(lic.ref)}.pdf">Certificate (PDF)</a><a class="yours-l" href="/c/${esc(lic.ref)}?k=${esc(lic.download_token || '')}">License page</a><a class="yours-l" href="/verify?ref=${esc(lic.ref)}">Verify</a></div>
<p class="note">The file carries its license inside it: maker, licensee, reference and term. ${esc(maker.name)} has been paid.</p>` : ''}
</div></section>`
  });
}

function requested({ lic, w }) {
  return layout({
    title: 'Request received · Watermark',
    body: `<section class="done"><p class="k">Reference ${esc(lic.ref)}</p><h1>Thank you. Your request is with the maker.</h1>
<p class="lede">You asked to use <em>${esc(w.title)}</em>. The maker will confirm terms in writing, usually within a day. Your reference is <b>${esc(lic.ref)}</b>.</p>
<p><a class="btn" href="/w/${esc(w.slug)}">Back to the photograph</a></p></section>`
  });
}

function certificate({ lic, w, maker, use, entry, base, owner }) {
  const active = lic.status === 'active';
  return layout({
    title: `License ${lic.ref} · Watermark`,
    body: `<section class="cert">
<p class="k">Watermark license</p><h1>${esc(lic.ref)}</h1>
<p class="status s-${esc(lic.status)}">${esc({ active: 'Active', requested: 'Requested', awaiting_payment: 'Awaiting payment', declined: 'Declined', expired: 'Expired' }[lic.status] || lic.status)}</p>
<div class="cert-grid">
<img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" draggable="false">
<dl class="facts">
<div><dt>Work</dt><dd><a href="/w/${esc(w.slug)}">${esc(w.title)}</a></dd></div>
<div><dt>Maker</dt><dd>${esc(maker.name)}</dd></div>
<div><dt>Licensee</dt><dd>${esc(lic.licensee_company || lic.licensee_name)}</dd></div>
<div><dt>Use</dt><dd>${esc(use.name)}: ${esc(use.description)}</dd></div>
<div><dt>Term</dt><dd>${active ? `${date(lic.starts_at)}${lic.ends_at ? ' to ' + date(lic.ends_at) : ', perpetual'}` : esc(termText(use))}</dd></div>
${lic.price_cents != null ? `<div><dt>Fee</dt><dd>${money(lic.price_cents, lic.currency)}</dd></div>` : ''}
${lic.conditions ? `<div><dt>Conditions</dt><dd>${esc(lic.conditions)}.</dd></div>` : ''}
<div><dt>Fingerprint</dt><dd><code>${esc(w.sha256)}</code></dd></div>
${entry ? `<div><dt>Ledger</dt><dd>Entry ${entry.seq} &middot; <code>${esc(entry.hash.slice(0, 24))}&hellip;</code></dd></div>` : ''}
</dl></div>
<div class="terms"><h2>In plain language</h2>
<p>${esc(maker.name)} grants ${esc(lic.licensee_company || lic.licensee_name)} a non-exclusive, non-transferable license to use the photograph above for ${esc(use.name.toLowerCase())} use as described${lic.intended_use ? `: &ldquo;${esc(lic.intended_use)}&rdquo;` : ''}, for the term shown, with credit to ${esc(maker.name)} where the use allows. ${lic.conditions ? esc(lic.conditions) + '. ' : ''}Copyright stays with the maker. Any other use needs a new license. The full terms are at <a href="${esc(base)}/terms">${esc(base.replace(/^https?:\/\//, ''))}/terms</a>.</p></div>
${owner && active && lic.download_token ? `<p><a class="btn" href="/d/${esc(lic.download_token)}">Download the full file</a></p>` : ''}
${active ? `<p><a href="/c/${esc(lic.ref)}.pdf">Certificate as PDF</a></p>` : ''}
<p class="note">Anyone can check this license at <a href="/verify?ref=${esc(lic.ref)}">/verify</a>.</p>
</section>`
  });
}

function verify({ ref, lic, w, notFound }) {
  return layout({
    title: 'Verify a license · Watermark',
    body: `<section class="narrow"><p class="k">Verify</p><h1>Is this use licensed?</h1>
<form method="get" action="/verify" class="inline"><input name="ref" placeholder="WM-2026-000001" value="${esc(ref)}"><button>Check</button></form>
${lic ? `<p class="lede">License <a href="/c/${esc(lic.ref)}">${esc(lic.ref)}</a> for <em>${esc(w.title)}</em> is <b>${esc(lic.status === 'active' ? 'active' : lic.status.replace('_', ' '))}</b>${lic.ends_at ? ` until ${date(lic.ends_at)}` : ''}.</p>` : notFound ? '<p class="lede">No license with that reference. If you have seen this work used, the maker would like to know.</p>' : ''}
</section>`
  });
}

function ledgerPage({ entries, check }) {
  const rows = entries.map(e => `<tr><td>${e.seq}</td><td>${esc(e.at.slice(0, 19).replace('T', ' '))}</td><td>${esc(e.type)}</td><td>${esc(e.subject)}</td><td><code>${esc(e.hash.slice(0, 16))}&hellip;</code></td></tr>`).join('');
  return layout({
    title: 'Ledger · Watermark',
    body: `<section class="narrow wide"><p class="k">The ledger</p><h1>Every registration and every license, recorded once.</h1>
<p class="lede">Each entry carries the fingerprint of the one before it, so history cannot be quietly changed. Chain status: <b>${check.ok ? `intact, ${check.checked} entries` : `broken at entry ${check.broken_at}`}</b>.</p>
<table class="ledger"><thead><tr><th>#</th><th>When (UTC)</th><th>Event</th><th>Subject</th><th>Hash</th></tr></thead><tbody>${rows}</tbody></table></section>`
  });
}

function about() {
  return layout({
    title: 'About · Watermark',
    body: `<section class="narrow"><p class="k">About</p><h1>The web made it easy to steal. It should make it easy to license.</h1>
<p class="lede">Watermark holds a maker's work, shows it beautifully, and licenses it at the source. Every photograph is fingerprinted when it arrives, shown at screen size only, and carries its credit and its license wherever it is embedded. Licenses are plain-language, paid in seconds, and written to a public ledger.</p>
<p class="lede">Krafft is Watermark's first customer: the Krafft Studios collection is the seed.</p></section>`
  });
}

function terms() {
  return layout({
    title: 'License terms · Watermark',
    body: `<section class="narrow prose"><p class="k">License terms</p><h1>The standard Watermark license.</h1>
<p><b>Draft.</b> These terms are a plain-language starting point and should be reviewed by counsel before Watermark takes payment.</p>
<ol><li><b>Grant.</b> The maker grants the licensee a non-exclusive, non-transferable license to reproduce and display the work for the use, term and territory shown on the license certificate.</li>
<li><b>Credit.</b> Where the medium allows, the work is credited to the maker as shown on the certificate.</li>
<li><b>Ownership.</b> Copyright stays with the maker. No rights pass except those written on the certificate.</li>
<li><b>Changes.</b> The licensee may crop and resize the work; any other alteration needs the maker's written consent.</li>
<li><b>Exclusions.</b> No use in AI training datasets, no resale or sublicensing, and no use that implies the maker endorses a product, unless the certificate says so.</li>
<li><b>Term.</b> The license ends on the date on the certificate. Renewal is offered before it ends.</li>
<li><b>Prints.</b> A print is sold for private display. It carries no reproduction rights.</li>
<li><b>Record.</b> Every license is recorded on the Watermark ledger by reference and fingerprint. Personal details are not published.</li></ol></section>`
  });
}

module.exports = { layout, life, home, reported, collection, work, buy, ask, thanks, licenseForm, requested, certificate, verify, ledgerPage, about, terms, esc, money, date, termText };
