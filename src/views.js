// HTML for every page. Plain functions, no template engine.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c, cur = 'usd') => c == null ? 'On request' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
// Titles as a catalogue sets them: no closing period, proper apostrophes.
const tidy = s => String(s == null ? '' : s).trim().replace(/\.$/, '').replace(/(\w)'(\w)/g, '$1\u2019$2').replace(/'/g, '\u2019');
// The maker's mark, used as the Collect seal. Krafft makers carry the hand-made K; others the Watermark wave.
const K_MARK = '<svg viewBox="0 0 51.66 51.88" fill="currentColor" aria-hidden="true"><path d="M20.35.14L.14,26V0c7.28,0,20.21.14,20.21.14Z"/><polygon points="51.66 51.88 31.73 51.84 27.51 45.27 38.12 32.14 51.66 51.88"/><polygon points="0 41.9 .14 51.71 9.97 51.84 51.66 .3 31.8 .14 0 41.9"/></svg>';
const WAVE_MARK = '<svg viewBox="1.5 14.2 41 11" fill="currentColor" aria-hidden="true"><path d="M40.9019,20.248c.0496.0348.1284.1018.21.14.0392.0183.1355.0555.1748.0725.142.0613.2106.0623.2106.0623.4242.1069.61-.0405.61-.0405,0,0,.0188-.0104.0372-.0243.0184-.014.0363-.0314.0458-.0406.0151-.0146.0539-.0644.0539-.0644,0,0,.052-.0909.0637-.1237.0071-.0198.024-.0795.024-.0795.0222-.0965.0109-.1126.0246-.2317.0093-.0811-.0287-.3268-.0598-.4078-.0365-.0952-.1166-.3107-.1703-.4046-.0609-.1065-.288-.3048-.3726-.4039-.0684-.0801-.1447-.1568-.2296-.2285-.1278-.108-.4529-.423-.699-.5881-.1149-.077-.4531-.3086-.661-.3576-.1954-.0461-.5058-.1799-.7093-.2207-.1562-.0313-.3892-.0664-.5873-.0663-.1141.0029-1.5885.0597-2.7094,1.0659-.3753.3369-.3855.3946-.8039.8574-1.32,1.4605-2.8991,1.493-4.248.0839-2.6425-2.7603-4.3029-2.7712-7.0126-.0458-1.4491,1.4575-2.8945,1.5826-4.2166-.0527-2.0205-2.4992-5.04-2.4249-6.9906-.0205-1.4506,1.788-2.9277,1.5387-4.6146-.3402-1.5584-1.7356-3.6345-2.0457-5.3761-.7779-.3208.2335-.6042.5574-.9828.9127-.3769.3368-.7879,2.0455.8259,1.4273.2077-.0796.4772-.3289.6437-.4599,1.37-1.0769,2.6549-.9274,3.9243.3511,2.7283,2.7477,4.1663,2.7285,6.9293-.0031,1.449-1.4325,2.9109-1.5845,4.2323.0157,2.0744,2.512,4.8342,2.5441,6.9759.0433,1.4851-1.7342,2.9311-1.5102,4.6445.3102,1.7438,1.8528,3.6846,2.1267,5.4476.7528.2651-.2066.5093-.4648.7507-.7199.9751-1.0303,1.776-1.4668,2.6072-1.416,0-.052.6333.1119.8306.2146.0961.05.3577.1959.4835.268.0829.0476.2447.1927.3365.2464l.1702.1427.1157.0958.071.0558Z"/></svg>';
// Each maker's own mark on the Collect seal: Krafft's makers carry the hand-made K, every other maker the Watermark wave.
const isKrafft = m => !!m && (/krafft/i.test(m.house || '') || m.handle === 'krafft');
const markOf = m => (isKrafft(m) ? K_MARK : WAVE_MARK);
const makerSlug = m => String((m && m.name) || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const seal = (m, label = 'Collect', cls = '') => `<button class="seal${cls ? ' ' + cls : ''}" aria-label="${esc(label)}"><span class="seal-k">${markOf(m)}</span><span class="seal-r" aria-hidden="true"></span></button>`;
const date = s => s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
const { NEVER } = require('./rules');
const termText = u => u.kind === 'print' ? 'Yours to keep' : u.term_months ? (u.term_months % 12 ? `${u.term_months} months` : `${u.term_months / 12} year${u.term_months > 12 ? 's' : ''}`) : 'Perpetual';

// Changes with every deploy, so browsers fetch the new styles and scripts at once.
const VER = (process.env.RENDER_GIT_COMMIT || String(Date.now())).slice(0, 8);
const BASE = () => (process.env.BASE_URL || 'https://watermark.krafftco.com').replace(/\/$/, '');
// Link previews (iMessage, LinkedIn, Slack), search engines and Google Images read these.
function headMeta({ title, desc, path, image, type = 'website', jsonld }) {
  const u = BASE() + (path || '');
  return `<link rel="canonical" href="${esc(u)}"><meta property="og:site_name" content="Watermark"><meta property="og:type" content="${type}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(u)}">${image ? `<meta property="og:image" content="${esc(BASE() + image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(BASE() + image)}">` : '<meta name="twitter:card" content="summary">'}${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}`;
}
// The house bar (Krafft · Krafft Studios · Watermark), rendered here so it never flashes in;
// public/house.js then points each link back to the page last open on that property.
const HOUSE = '<nav class="kh" aria-label="Krafft"><a data-p="krafft" href="https://www.krafftco.com/">Krafft</a><a data-p="studios" href="https://studios.krafftco.com/">Krafft Studios</a><a data-p="watermark" href="/" aria-current="site">Watermark</a><a data-p="dgc" href="https://www.krafftco.com/dallas-golf-club">Dallas Golf Club</a><a data-p="will" class="kh-own" href="https://www.wrkfullerton.com/">Will Fullerton</a></nav>';
function layout({ title, body, desc = 'Held on Watermark.', bare = false, studio = false, path, image, type, jsonld, mark = null }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="${studio ? 'noindex, nofollow, ' : ''}noai, noimageai"><meta name="tdm-reservation" content="1">${studio ? '' : headMeta({ title, desc, path, image, type, jsonld })}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Archivo:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,300..500;1,6..72,300..500&display=swap">
<link rel="stylesheet" href="/static/style.css?v=${VER}"><link rel="icon" href="/static/wave.svg">${bare ? '' : '<meta name="kh" content="page"><script src="/house.js"></script>'}</head>
<body class="${bare ? 'bare' : ''}${studio ? ' studio' : ''}">
${bare ? '' : `${HOUSE}<header class="top"><a class="brand" href="/"><img src="/static/watermark-logo.svg" alt="Watermark" width="120" height="32"></a>
<nav><a href="/collection">Collection</a><a href="/series/the-great-rooms" class="nv-m">Series</a><a href="/collectors">Collectors</a><a href="/journal">Journal</a><a href="/yours" class="nv-y">Yours</a>${studio ? '<a href="/studio">Studio</a><a href="/studio/logout">Sign out</a>' : ''}</nav></header>`}
<main>${body}</main><script>window.__WM_MARK=${JSON.stringify(mark || K_MARK)};window.__WM_WAVE=${JSON.stringify(WAVE_MARK)};</script><script src="/static/seal.js?v=${VER}" defer></script>
${bare ? '' : `<footer class="foot"><p>Watermark &middot; <a href="https://krafftco.com">a Krafft company</a> &middot; Leave your mark.</p><p><a href="/m/will-fullerton#patron">Patronage</a> &middot; <a href="/#makers">For makers</a> &middot; <a href="/verify">Verify a license</a> &middot; <a href="/ledger">Ledger</a> &middot; <a href="/about">About</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/signin">Sign in</a></p></footer>`}
</body></html>`;
}

function collection({ maker, works, rooms = [], share = null, pay = null }) {
  const mOf = w => w.maker || maker;
  // The collection is an archive you can walk: rooms as galleries, an index to search, and every
  // photograph a click from filling the screen.
  const ratio = w => (w.width && w.height ? w.width / w.height : 1.5);
  const roomOf = {}; rooms.forEach(r => (r.ids || []).forEach(id => { (roomOf[id] = roomOf[id] || []).push(r.slug); }));
  const data = works.map(w => ({ v: w.voiced ? 1 : 0, cp: (w.caption || '').slice(0, 240), mk: mOf(w).name, ms: makerSlug(mOf(w)), kk: isKrafft(mOf(w)) ? 1 : 0, s: w.slug, t: tidy(w.title), p: w.place || '', a: w.accession || '', c: w.camera || '', d: w.taken_at ? String(w.taken_at).slice(0, 10) : '', r: +ratio(w).toFixed(3), w: w.width, h: w.height, k: w.keywords || '', m: roomOf[w.id] || [], $: w.share_cents || null, x: /"social":false/.test(w.rules || '') ? 1 : 0 }));
  const sp = share && share.price_cents != null ? money(share.price_cents) : null;
  const plate = w => `<a class="pl" href="/w/${esc(w.slug)}" data-s="${esc(w.slug)}" style="--r:${ratio(w).toFixed(3)}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" decoding="async" draggable="false"><span class="pc"><b>${esc(tidy(w.title))}</b><i>${esc([mOf(w).name, w.place].filter(Boolean).join(', '))}</i></span>${sp && !/"social":false/.test(w.rules || '') ? `<span class="pb" data-buy role="button" tabindex="0" aria-label="Collect">${markOf(mOf(w))}<i class="seal-r"></i></span>` : ''}</a>`;
  const byId = Object.fromEntries(works.map(w => [w.id, w]));
  const shown = rooms.filter(r => (r.ids || []).filter(id => byId[id]).length >= 3);
  const seen = new Set();
  const galleries = shown.map(r => { const ws = (r.ids || []).map(id => byId[id]).filter(Boolean); ws.forEach(w => seen.add(w.id)); return ws.length ? `<section class="gal" id="room-${esc(r.slug)}" data-room="${esc(r.slug)}"><header class="gh"><h2><a href="/rooms/${esc(r.slug)}">${esc(r.title)}</a></h2><span>${ws.length}</span></header><div class="plates">${ws.map(plate).join('')}</div></section>` : ''; }).join('');
  const rest = works.filter(w => !seen.has(w.id));
  // Other makers hang beside the house's own work, each in a gallery of their own, newest maker last.
  const restByMaker = []; rest.forEach(w => { const m = mOf(w); let g = restByMaker.find(x => x[0].id === m.id); if (!g) restByMaker.push(g = [m, []]); g[1].push(w); });
  restByMaker.sort((a, b) => (a[0].id === maker.id ? -1 : b[0].id === maker.id ? 1 : 0));
  const makerList = []; works.forEach(w => { const m = mOf(w); if (!makerList.find(x => x.id === m.id)) makerList.push(m); });
  const total = works.length;
  // The cover: a jewel if one is marked, else a large landscape frame.
  const wide = w => (w.width || 0) >= 1800 && w.width > w.height * 1.3;
  const cover = works.find(w => w.curated && wide(w)) || works.filter(wide).find(w => /florence|paris|como|zurich/i.test(w.place || '')) || works.find(wide) || null;
  return layout({
    title: 'The collection · Watermark',
    desc: `${total} photographs held, credited and licensed on Watermark.`,
    path: '/collection', image: works[0] ? `/img/${works[0].slug}/screen` : null,
    body: `${cover ? `<section class="cx-cover"><img src="/img/${esc(cover.slug)}/large" alt="${esc(cover.title)}" fetchpriority="high" draggable="false"><div class="cx-hero"><h1>Those who make need those who collect.</h1><a class="btn" href="#rooms">Walk the collection</a><a class="cx-wander" href="#" data-wander>Or wander</a></div><span class="cx-cap">${esc(tidy(cover.title))}${cover.place ? ` &middot; ${esc(cover.place)}` : ''}</span></section>` : ''}<section class="cx-intro"><p class="k">${makerList.length > 1 ? `${makerList.length} makers` : esc(maker.house || maker.name)}</p>
${cover ? '<h2 id="rooms">The collection.</h2>' : '<h1 id="rooms">The collection.</h1>'}<p class="cx-count">${total} photographs · ${shown.length} rooms${makerList.length > 1 ? ` · ${makerList.length} makers` : ''} · each registered to its maker and licensed at the source</p></section>
<a class="sr-band" href="/series/the-great-rooms"><span class="sr-band-im"><img src="/img/the-library-stacks/thumb" alt="" loading="lazy" draggable="false"><img src="/img/behind-the-clock-at-the-musee-d-orsay/thumb" alt="" loading="lazy" draggable="false"><img src="/img/under-the-gallery-dome/thumb" alt="" loading="lazy" draggable="false"></span><span class="sr-band-t"><small>A series by Will Fullerton &middot; Krafft Studios</small><b>The Great Rooms</b><span>Domes, libraries and the light inside them. See the series &rarr;</span></span></a>
<div class="cx-bar" id="cxBar"><label class="cx-q"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg><input id="cxQ" type="search" placeholder="Search ${total} photographs" aria-label="Search the collection" autocomplete="off" spellcheck="false"></label>
<div class="cx-rooms" id="cxRooms"><button type="button" data-r="" aria-pressed="true">All</button>${shown.map(r => `<button type="button" data-r="${esc(r.slug)}">${esc(r.title.replace(/^Journey Out (East|West):?\s*/, ''))}</button>`).join('')}</div>
${makerList.length > 1 ? `<div class="cx-makers" id="cxMakers"><button type="button" data-mk="" aria-pressed="true">All makers</button>${makerList.map(m => `<button type="button" data-mk="${esc(makerSlug(m))}">${esc(m.name)}</button>`).join('')}</div>` : ''}
<div class="cx-view"><button type="button" data-wander title="A photograph at random, then another">Wander</button><button type="button" data-v="plates" aria-pressed="true" title="Plates">Plates</button><button type="button" data-v="index" title="Index">Index</button></div><span class="cx-n" id="cxN" hidden></span></div>
<div class="cx" id="cx">${galleries}${restByMaker.map(([m, ws]) => `<section class="gal" data-room="" data-maker="${esc(makerSlug(m))}"><header class="gh"><h2>${m.id === maker.id ? (shown.length ? 'Also held' : 'Every photograph') : `<a href="/m/${esc(makerSlug(m))}">${esc(m.name)}</a>`}</h2><span>${ws.length}</span></header><div class="plates">${ws.map(plate).join('')}</div></section>`).join('')}${total ? '' : '<p class="empty">Nothing is held here yet.</p>'}</div>
<div class="cx-flat" id="cxFlat" hidden></div>
<div class="lb" id="lb" hidden role="dialog" aria-modal="true" aria-label="Photograph"><div class="lb-stage" id="lbStage"><img id="lbLo" alt="" draggable="false"><img id="lbImg" alt="" draggable="false"></div>
<div class="lb-top"><span id="lbPos"></span><span class="lb-act"><button type="button" id="lbFs">Full screen</button><button type="button" id="lbX" aria-label="Close">Close</button></span></div>
<div class="lb-cap"><div><b id="lbT"></b><span id="lbM"></span></div><span class="lb-act"><button type="button" id="lbVo" class="lb-vo" hidden aria-label="Listen"><i></i>Listen</button><a id="lbRec" href="#">Record</a><a id="lbLic" href="#">License</a>${share && share.price_cents != null ? `<form method="post" id="lbShare" class="lb-share"><input type="hidden" name="use" value="social"><button class="lb-seal"><span class="lb-k">${K_MARK}</span>Collect</button></form>` : ''}</span></div>
<button type="button" class="lb-nav lb-prev" id="lbPrev" aria-label="Previous"></button><button type="button" class="lb-nav lb-next" id="lbNext" aria-label="Next"></button></div>
<script>window.__WM_SHARE=${JSON.stringify(sp)};window.__WM=${JSON.stringify(data).replace(/</g, '\\u003c')};</script><script src="/static/voices.js?v=${VER}" defer></script><script src="/static/collection.js?v=${VER}" defer></script>${pay ? `<script>window.__WM_PAY=${JSON.stringify(pay).replace(/</g, '\\u003c')};</script><script src="/static/pay.js?v=${VER}" defer></script>` : ''}`
  });
}

const VKIND = { maker: 'The maker', historian: 'Art history', note: 'A note' };
const mmss = n => n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : '';
// One voice on a photograph: a round play button, who is speaking, and what they said.
const voice = v => `<div class="vo">${v.audio ? `<button type="button" class="vo-play" data-voice="/listen/${esc(v.key)}" aria-label="Listen to ${esc(v.speaker || VKIND[v.kind])}"><i></i></button>` : `<span class="vo-play vo-quiet" aria-hidden="true">&ldquo;</span>`}
<div class="vo-t"><small>${esc(VKIND[v.kind] || '')}${v.seconds ? ` &middot; ${mmss(v.seconds)}` : ''}</small><b>${esc(v.speaker || '')}${v.role ? `<span>, ${esc(v.role)}</span>` : ''}</b>
${v.body ? (v.audio ? `<details><summary>Read it</summary><p>${esc(v.body)}</p></details>` : `<p class="vo-note">${esc(v.body)}</p>`) : ''}</div></div>`;

function work({ w, maker, uses, base, rules, pay = null, held = { n: 0, shown: [] }, ed = null, patron = null, story = null, voices = [] }) {
  // A work page is a catalogue entry: the photograph on its own wall, then the entry as an
  // auction house or museum would set it, then the record. Publisher tools stay folded away.
  const ratio = w.width && w.height ? `${w.width} / ${w.height}` : '3 / 2';
  const title = tidy(w.title);
  const year = w.taken_at ? String(w.taken_at).slice(0, 4) : '';
  const cap = w.caption && tidy(w.caption) !== title ? w.caption : '';
  const medium = ['Digital photograph', w.camera ? `made with a ${w.camera}${w.lens && !/Q\d/.test(w.camera) ? ', ' + w.lens : ''}` : ''].filter(Boolean).join(', ');
  const dims = w.width && w.height ? `${w.width.toLocaleString('en-US')} &times; ${w.height.toLocaleString('en-US')} pixels` : '';
  const facts = [
    ['Accession', w.accession], ['Maker', maker.name], ['House', maker.house], ['Place', w.place], ['Taken', date(w.taken_at)],
    ['Camera', w.camera], ['Lens', w.lens], ['Registered', date(w.created_at)],
  ].filter(f => f[1]).map(f => `<div><dt>${f[0]}</dt><dd>${esc(f[1])}</dd></div>`).join('');
  const embed = `&lt;script src="${esc(base)}/embed.js" defer&gt;&lt;/script&gt;\n&lt;watermark-image work="${esc(w.slug)}"&gt;&lt;/watermark-image&gt;`;
  const share = uses.find(u => u.key === 'social' && u.price_cents != null);
  const options = uses.filter(u => u !== share).map(u => `<a class="use" href="/license/${esc(w.slug)}?use=${esc(u.key)}"><span class="un">${esc(u.name)}</span><span class="up">${money(u.price_cents)}</span><span class="ud">${esc(u.description)} ${esc(termText(u))}.</span><span class="ua">${u.price_cents == null ? 'Ask' : u.kind === 'print' ? 'Order' : 'License'} <i></i></span></a>`).join('');
  const keepers = held.n
    ? `In ${held.n} collection${held.n === 1 ? '' : 's'}${held.shown.length ? ', among them ' + held.shown.map(c => `<a href="/collector/${esc(c.code)}">${esc(c.name || 'a private collector')}</a> <small>No.&nbsp;${c.no}</small>`).join(', ') : ''}.`
    : 'Not yet in any collection. The first collector will be No.&nbsp;1.';
  return layout({
    title: `${title} · ${maker.name} · Watermark`,
    desc: `${title}, a photograph by ${maker.name}${w.place ? `, ${w.place}` : ''}. Held on Watermark; collect it at the source.`,
    path: `/w/${w.slug}`, image: `/img/${w.slug}/screen`, type: 'article', mark: markOf(maker),
    // Google Images shows a "Licensable" badge when an image carries these fields.
    jsonld: { '@context': 'https://schema.org', '@type': 'ImageObject', name: title, caption: w.caption || undefined, contentUrl: `${BASE()}/img/${w.slug}/screen`, thumbnailUrl: `${BASE()}/img/${w.slug}/thumb`,
      creator: { '@type': 'Person', name: maker.name }, creditText: `Photograph by ${maker.name}${maker.house ? ', ' + maker.house : ''}`, copyrightNotice: `© ${maker.name}`,
      copyrightHolder: { '@type': 'Person', name: maker.name }, license: `${BASE()}/terms`, acquireLicensePage: `${BASE()}/license/${w.slug}`,
      dateCreated: w.taken_at || undefined, contentLocation: w.place ? { '@type': 'Place', name: w.place } : undefined, identifier: w.accession || undefined,
      sourceOrganization: { '@type': 'Organization', name: 'Watermark', parentOrganization: { '@type': 'Organization', name: 'Krafft', url: 'https://krafftco.com' } } },
    body: `<article class="work lot">
<div class="lot-wall"><figure class="plate" style="aspect-ratio:${ratio};--ar:${w.width && w.height ? (w.width / w.height).toFixed(3) : 1.5}" data-viewer data-full="/img/${esc(w.slug)}/large" data-title="${esc(title)}" data-credit="Photograph by ${esc(maker.name)}">
<img src="/img/${esc(w.slug)}/screen" alt="${esc(title)}" draggable="false"><span class="shield"></span></figure>
<p class="lot-hint">Click the photograph to see it whole.</p></div>
<div class="meta lot-entry">
${w.accession ? `<p class="lot-no">${esc(w.accession)}</p>` : ''}
<p class="lot-maker"><a href="/m/${esc(makerSlug(maker))}">${esc(maker.name)}</a>${maker.house ? ` <span>${esc(maker.house)}</span>` : ''}</p>
<h1 class="lot-t">${esc(title)}</h1>
<p class="lot-pl">${[w.place, year].filter(Boolean).map(esc).join(', ')}</p>
${story ? `<p class="lot-story">From <a href="${esc(story.url)}"><i>${esc(story.title)}</i></a>, Krafft Studios</p>` : ''}
<p class="lot-md">${esc(medium)}${dims ? `<br>${dims}` : ''}</p>
${voices.length ? `<div class="vo-list">${voices.map(voice).join('')}</div>` : ''}
<p class="lot-keep">${keepers}</p>
${ed ? `<p class="lot-ed"><b>Edition of ${ed.size}</b><span>${ed.left ? `${ed.left} of ${ed.size} remain` : 'Complete. Every number is held.'}</span></p>` : ''}
${share && ed && !ed.left ? `<p class="lot-gone">This edition is complete. It can pass to you only from one of its collectors.</p>` : ''}
${share && !(ed && !ed.left) ? `<form method="post" action="/buy/${esc(w.slug)}" class="share-buy" data-share="${esc(w.slug)}" data-title="${esc(title)}" data-amount="${share.price_cents}"><input type="hidden" name="use" value="social"><div class="seal-row">${seal(maker, `Collect ${title}`)}<div class="seal-t"><b>${ed ? `Collect No.&nbsp;${ed.sold + 1}` : 'Collect'}</b><span>Yours to keep and to share, credited. 85% goes to the photographer.</span></div></div></form>${pay ? `<script>window.__WM_PAY=${JSON.stringify(pay).replace(/</g, '\\u003c')};</script><script src="/static/pay.js?v=${VER}" defer></script>` : ''}` : ''}
${patron ? `<p class="pat-line"><a href="/m/${esc(patron)}#patron">Become a patron of ${esc(maker.name)}</a><span>Keep the work going, monthly or once.</span></p>` : ''}
${share ? `<details class="more-uses"><summary>Other uses <span>In a story, for a company, before an audience, a print</span></summary><div class="uses">${options}</div></details>` : `<h2>Use this photograph</h2><div class="uses">${options}</div>`}
</div></article>
<section class="lot-rec">
${cap ? `<div class="lot-sec"><h2>Catalogue note</h2><p class="cap">${esc(cap)}</p></div>` : ''}
<div class="lot-sec"><h2>Provenance and record</h2><dl class="facts">${facts}</dl>
<p class="note"><a href="/w/${esc(w.slug)}/life">The life of this photograph</a>: its registration and every license since, recorded on the <a href="/ledger">ledger</a>.</p>
${rules && rules.never.length ? `<p class="never"><span>The maker says never</span>${rules.never.map(k => esc(NEVER[k])).join(' &middot; ')}</p>` : ''}</div>
<details class="lot-fold"><summary>For publishers</summary><p class="note">Embed it with credit. Every license is written in plain language, carries its own reference, and is recorded on the ledger.</p><pre class="code">${embed}</pre>
<p class="fp">Fingerprint <code>${esc(w.sha256.slice(0, 16))}&hellip;</code>${w.source_url ? ` &middot; <a href="${esc(w.source_url)}" target="_blank" rel="noopener">See where it was published</a>` : ''}</p></details>
<details class="lot-fold report" id="report"><summary>Seen this photograph used somewhere?</summary>
<form method="post" action="/report/${esc(w.slug)}" class="form"><label>Where you saw it<input name="url" type="url" required placeholder="https://"></label>
<label>A note (optional)<input name="note"></label><label>Your email, if the maker may write back (optional)<input name="email" type="email"></label><button>Tell the maker</button></form></details>
</section>
<script src="/static/viewer.js" defer></script>${voices.length ? `<script src="/static/voices.js?v=${VER}" defer></script>` : ''}`
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
  // Lead with a large landscape frame from a place, never a small web copy.
  const big = works.filter(w => (w.width || 0) >= 1800 && w.width > w.height * 1.3);
  const hero = big.find(w => /florence|lake como|zurich|paris/i.test(w.place || '')) || big[0] || works[0];
  const demo = works.find(w => w !== hero && (w.width || 0) >= 1200) || works[1] || works[0];
  const strip = works.slice(0, 8).map(w => `<a href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" draggable="false"></a>`).join('');
  const price = k => { const u = uses.find(x => x.key === k); return u ? money(u.price_cents) : ''; };
  return layout({
    title: 'Watermark · For the people who make the pictures',
    desc: 'Hold your work, set your terms, and get paid the moment someone uses it properly.',
    path: '/', image: hero ? `/img/${hero.slug}/screen` : null,
    jsonld: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Watermark', url: BASE(), logo: `${BASE()}/static/watermark-logo.svg`, slogan: 'Leave your mark.', description: 'Hold, show, license and protect photographs at the source.', parentOrganization: { '@type': 'Organization', name: 'Krafft', url: 'https://krafftco.com' } },
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
<li><b>Set the price.</b> Public, fixed and yours. Collectors see it before they decide, so nobody has to ask.</li>
<li><b>Approve every sale, or none.</b> Let licenses happen on their own, or see each one before it is granted.</li>
<li><b>Say never.</b> Not for AI training. Not for politics. Not altered. Your conditions are written into the license, the certificate and the file itself.</li>
<li><b>Credit, always.</b> Your name travels with the photograph wherever it is embedded or delivered.</li>
</ul></div></section>

<section class="h-sec"><p class="k">Protection</p><h2 class="h2">Protected by design, not by a stamp across the middle.</h2>
<div class="h-6">
<div><h3>Sealed when it travels.</h3><p>Only screen-sized copies are shown. When the full file must travel, it goes sealed: it opens only in Watermark, every opening is counted, and you can close it at any time.</p></div>
<div><h3>Fingerprinted on arrival.</h3><p>Every original is fingerprinted and registered on a public ledger that cannot be quietly edited.</p></div>
<div><h3>Licensed inside the file.</h3><p>Each delivered file carries the maker, the collector, the reference, the term and your conditions.</p></div>
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
function life({ w, maker, lic, reg, rules, ed = null, prints = [], moves = [] }) {
  const earned = lic.reduce((a, l) => a + (l.price_cents || 0), 0);
  const rows = lic.map(l => `<li><span>${date(l.starts_at)}</span><b>${esc(l.use_name)}</b><em>${l.collector_no ? `Collector No. ${l.collector_no}${ed ? ' of ' + ed.size : ''}` : l.status === 'active' ? `Active${l.ends_at ? ' until ' + date(l.ends_at) : ''}` : 'Completed'}</em>${rules.showEarned ? `<i>${money(l.price_cents)}</i>` : ''}<a href="/verify?ref=${esc(l.ref)}">${esc(l.ref)}</a></li>`).join('');
  return layout({ title: `The life of ${w.title} · Watermark`, body: `<section class="lifep">
<div class="life-h"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" draggable="false"><div><p class="k">The life of a photograph</p><h1>${esc(w.title)}</h1>
<p class="by">Made by ${esc(maker.name)}${w.taken_at ? `, ${date(w.taken_at)}` : ''}. Rights held by ${esc(maker.name)}.</p></div></div>
<div class="stats">${ed ? `<div><b>${ed.sold} of ${ed.size}</b><span>collected</span></div>` : ''}<div><b>${lic.length}</b><span>times licensed</span></div>${prints.length ? `<div><b>${prints.length}</b><span>prints made</span></div>` : ''}${rules.showEarned ? `<div><b>${money(earned)}</b><span>earned for its maker</span></div>` : ''}<div><b>${date(w.created_at)}</b><span>registered</span></div></div>
<ol class="life-l"><li><span>${date(w.created_at)}</span><b>Registered on Watermark</b><em>Fingerprint ${esc(w.sha256.slice(0, 16))}&hellip;</em>${reg ? `<a href="/ledger">Ledger ${reg.seq}</a>` : ''}</li>${rows}${prints.map(p => `<li><span>${date(p.created_at)}</span><b>Printed by collector No. ${p.collector_no}</b><em>${esc([p.size, p.paper, p.made].filter(Boolean).join(', '))}</em></li>`).join('')}${moves.map(m => `<li><span>${date(m.claimed_at)}</span><b>No. ${m.collector_no} passed to a new collector</b><em>Same number, new hands</em></li>`).join('')}</ol>
<p class="note">Collectors are not named. Each reference can be checked by anyone at <a href="/verify">/verify</a>.</p>
<p><a class="btn" href="/license/${esc(w.slug)}">License this photograph</a></p></section>` });
}

// The viewer for sealed files.
function viewer() {
  return layout({ title: 'Open a sealed file · Watermark', desc: 'Open a photograph sealed on Watermark.', body: `<section class="sv">
<div class="sv-intro"><p class="k">Watermark viewer</p><h1>Open a sealed photograph.</h1>
<p class="lede">Drop a <code>.wmk</code> file here, or choose one. It opens in this window only, with the maker&rsquo;s permission, and is never saved as a picture.</p>
<label class="buy-btn sv-btn">Choose a sealed file<input id="sv-pick" type="file" accept=".wmk" hidden></label></div>
<div class="sv-frame"><div id="sv-stage"><img id="sv-preview" alt=""><canvas id="sv-canvas"></canvas>
<div class="sv-state"><p id="sv-msg"></p><p id="sv-sub"></p><a id="sv-license" class="h-ln" href="/">License this photograph</a></div></div>
<div class="sv-cap"><div><b id="sv-title"></b><span id="sv-credit"></span></div><span id="sv-terms"></span><span class="sv-seal">Sealed on Watermark</span></div></div>
</section><script src="/static/seal-viewer.js" defer></script>` });
}

// A public room: a collection the maker has chosen to show.
function room({ c, works, maker }) {
  const cards = works.map(w => `<a class="card" href="/w/${esc(w.slug)}"><span class="cf"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" draggable="false"></span><span class="ct">${esc(w.title)}</span><span class="cm">${esc(w.place || '')}</span></a>`).join('');
  return layout({ title: `${c.title} · Watermark`, desc: c.note || `${c.title}, a collection held on Watermark.`, body: `<section class="intro"><p class="k">${esc(maker.house || maker.name)} · A room</p><h1>${esc(c.title)}</h1>${c.note ? `<p class="lede">${esc(c.note)}</p>` : ''}<p class="note">${works.length} work${works.length === 1 ? '' : 's'}</p></section><section class="grid">${cards}</section>` });
}

function reported({ w }) {
  return layout({ title: 'Thank you · Watermark', body: `<section class="done"><p class="k">Sighting received</p><h1>Thank you. The maker will see it.</h1>
<p class="lede">You reported where <em>${esc(w.title)}</em> turned up. The maker decides what happens next. Your details are never published.</p>
<p><a class="btn" href="/w/${esc(w.slug)}">Back to the photograph</a></p></section>` });
}

// The license page. One photograph, four uses, every price in plain sight, one button.
// Payment (Apple Pay, Google Pay, Link, card) collects name and email; nothing is asked twice.
function buy({ w, maker, uses, chosen, renews, instant, rules = { never: [], approve: false } }) {
  const pick = uses.find(u => u.key === chosen) || uses.find(u => u.key === 'social' && u.price_cents != null) || uses.find(u => u.key === 'commercial') || uses[0];
  const label = u => u.price_cents == null || !instant ? 'Ask the maker' : rules.approve ? `Request for ${money(u.price_cents)}` : `${u.key === 'social' ? 'Share it' : u.kind === 'print' ? 'Order' : 'License'} for ${money(u.price_cents)}`;
  const row = u => `<label class="bu"><input type="radio" name="use" value="${esc(u.key)}" data-label="${esc(label(u))}" ${u === pick ? 'checked' : ''}>
<span class="bu-n">${esc(u.name)}</span><span class="bu-p">${money(u.price_cents)}</span>
<span class="bu-d">${esc(u.description)} <em>${esc(termText(u))}.</em></span></label>`;
  // Share it leads; the larger uses wait behind one line until someone asks for them.
  const lead = uses.find(u => u.key === 'social' && u.price_cents != null);
  const rest = uses.filter(u => u !== lead);
  const rows = lead ? `${row(lead)}<details class="bu-more"${pick !== lead ? ' open' : ''}><summary>Other uses <span>In a story, for a company, before an audience, a print</span></summary>${rest.map(row).join('')}</details>` : uses.map(row).join('');
  const ratio = w.width && w.height ? `${w.width} / ${w.height}` : '3 / 2';
  return layout({
    title: `License ${w.title} · Watermark`,
    desc: `License ${w.title}, a photograph by ${maker.name}.`,
    body: `<section class="buy">
<figure class="buy-fig"><div class="ls" data-ls style="--img:url('/img/${esc(w.slug)}/screen')">
<div class="ls-sc on" data-sc=""><div class="buy-plate" style="aspect-ratio:${ratio}"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" draggable="false"></div></div>
<div class="ls-sc ls-social" data-sc="social"><div class="ph-dev"><div class="ph-top"><i></i><b>yourname</b></div><div class="ph"></div><div class="ph-cap"><b>yourname</b> Evening light. <span>Photograph by ${esc(maker.name)} &middot; Watermark</span></div></div></div>
<div class="ls-sc ls-story" data-sc="editorial"><div class="ph"></div><div class="pg"><span class="kk">The feature</span><span class="hh">${esc(tidy(w.title))}</span><span class="ln"></span><span class="ln"></span><span class="ln" style="width:86%"></span><span class="ln"></span><span class="ln" style="width:70%"></span><span class="cr">Photograph by ${esc(maker.name)}</span></div></div>
<div class="ls-sc ls-co" data-sc="commercial"><div class="bar"><i></i><i></i><i></i><u></u></div><div class="site"><div class="ph"></div><div class="nav"><span></span><span style="width:120px"></span></div><div class="hd">Your company, introduced.</div></div></div>
<div class="ls-sc ls-aud" data-sc="campaign"><div class="bb"><div class="ph"></div></div><i class="pole p1"></i><i class="pole p2"></i></div>
<div class="ls-sc ls-wall" data-sc="print"><div class="fr"><div class="mt"><div class="ph"></div></div></div><div class="fl"></div></div>
</div>
<figcaption><b>${esc(tidy(w.title))}</b>${w.place ? ` &middot; ${esc(w.place)}` : ''}<br>Photograph by ${esc(maker.name)}<span class="ls-cap" data-ls-cap>Choose where it will live, and see it there.</span></figcaption></figure>
<form method="post" action="/buy/${esc(w.slug)}" class="buy-form">
<p class="k">Held on Watermark</p><h1>${pick && pick.key === 'social' ? 'Share it.' : 'Give it somewhere to live.'}</h1>
${renews ? `<p class="ok">Renewing ${esc(renews)}.</p><input type="hidden" name="renews" value="${esc(renews)}">` : ''}
<fieldset class="bus"><legend class="vh">How it will be used</legend>${rows}</fieldset>
<details class="buy-note"><summary>Add a note for the maker</summary><textarea name="note" rows="3" placeholder="Where it will appear. Optional."></textarea></details>
<button type="submit" class="buy-btn" id="buyBtn">${esc(label(pick))}</button>
${rules.never.length ? `<p class="never"><span>The maker says never</span>${rules.never.map(k => esc(NEVER[k])).join(' &middot; ')}</p>` : ''}
<p class="buy-how">${rules.approve ? 'The maker approves each license personally, usually within the day. You pay only once it is approved.' : instant ? (pick && pick.key === 'social' ? 'Apple Pay, Google Pay or card. The file is yours the moment you pay, ready to post.' : 'Apple Pay, Google Pay or card. The full file, a certificate and a receipt arrive the moment you pay.') : 'The maker replies with terms and a payment link, usually within the day.'}</p>
<ul class="buy-p"><li>Paid to the maker</li><li>Full resolution, licensed in the file</li><li>Recorded on the <a href="/ledger">ledger</a></li></ul>
<p class="buy-more">Exclusivity, a longer term or something larger? <a href="/buy/${esc(w.slug)}?ask=1" data-ask>Ask the maker</a>. &middot; <a href="/terms" target="_blank">The terms</a>, in plain language.</p>
</form></section>
<script>(function(){var b=document.getElementById('buyBtn');
// See it where it will live: each use shows the photograph in its place.
var st=document.querySelector('[data-ls]'),cap=document.querySelector('[data-ls-cap]'),sc=st?[].slice.call(st.querySelectorAll('[data-sc]')):[];
var CAPS={'':'Choose where it will live, and see it there.',social:'Share it: on your own accounts, credited.',editorial:'In a story: opening the feature, credited on the page.',commercial:'For a company: the first thing anyone sees.',campaign:'On a billboard, at the scale it deserves.',print:'On a wall: signed, matted, framed, kept.'};
function show(k){if(!st)return;var has=sc.some(function(x){return x.getAttribute('data-sc')===k;});sc.forEach(function(x){x.classList.toggle('on',x.getAttribute('data-sc')===(has?k:''));});if(cap)cap.textContent=CAPS[has?k:'']||CAPS[''];}
var cur=(document.querySelector('.bu input:checked')||{}).value||'';show(cur);
document.querySelectorAll('.bu').forEach(function(l){var i=l.querySelector('input');l.addEventListener('mouseenter',function(){show(i.value);});l.addEventListener('mouseleave',function(){show((document.querySelector('.bu input:checked')||{}).value||'');});});
document.querySelectorAll('.bu input').forEach(function(i){i.addEventListener('change',function(){b.textContent=i.dataset.label;show(i.value);});});
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
function makerPage({ m, slug, works, collectors, patrons, wall, series, levels, once, open, mine = [] }) {
  const wide = w => (w.width || 0) >= 1800 && w.width > w.height * 1.3;
  const cover = works.find(w => w.slug === 'inside-brunelleschi-s-dome') || works.find(w => w.curated && wide(w)) || works.find(wide) || works[0];
  const pick = works.filter(w => w.curated).concat(works).filter((w, i, a) => a.indexOf(w) === i).slice(0, 6);
  const lvName = k => ({ medici: 'Medici', patron: 'Patrons', friend: 'Friends' }[k] || 'Patrons');
  const groups = ['medici', 'patron', 'friend'].map(k => [k, wall.filter(p => p.level === k)]).filter(g => g[1].length);
  return layout({ title: `${m.name} · Watermark`, desc: `${m.name}${m.house ? ', ' + m.house : ''}. ${works.length} photographs held on Watermark. Become a patron.`, path: `/m/${slug}`, image: cover ? `/img/${cover.slug}/screen` : null,
    body: `${cover ? pageHero(cover.slug, `${tidy(cover.title)}${cover.place ? ', ' + cover.place : ''}`, `<div><p class="sr-k">${esc(m.house || 'Maker')}</p><h1>${esc(m.name)}</h1></div>${open ? '<a class="btn" href="#patron">Become a patron</a>' : ''}`, m.name) : ''}
<section class="mk-intro"><p class="mk-stats"><span><b>${works.length}</b> photographs</span><span><b>${collectors}</b> collector${collectors === 1 ? '' : 's'}</span><span><b>${patrons}</b> patron${patrons === 1 ? '' : 's'}</span></p>
${series.length ? `<p class="mk-series">${series.map(x => `<a href="/series/${esc(x.slug)}"><small>A series</small><i>${esc(x.title)}</i></a>`).join('')}<a href="/collection"><small>The archive</small><i>The collection</i></a></p>` : ''}</section>
<section class="mk-pick">${pick.map(w => `<a href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(tidy(w.title))}" loading="lazy" draggable="false"></a>`).join('')}</section>
${open ? `<section class="pat" id="patron"><header><p class="k">Patronage</p><h2>Keep the work going.</h2><p>In Florence, Lorenzo de&rsquo; Medici kept a young Michelangelo at his own table. Patronage is how great work has always been made. Here anyone can do it: monthly, or once. Patrons come closer to the work, never to the person. 85% goes to ${esc(m.name)}.</p></header>
${mine.length ? `<p class="pat-mine">You are a patron of ${esc(m.name)}. Thank you.</p>` : ''}
<div class="pat-levels">${levels.map(l => `<form method="post" action="/m/${esc(slug)}/patron" class="pat-l${l.key === 'patron' ? ' pat-mid' : ''}"><input type="hidden" name="level" value="${l.key}"><p class="pat-n">${esc(l.name)}</p><p class="pat-p">${money(l.cents)}<small> a month</small></p><p class="pat-g">${esc(l.gives)}</p><div class="seal-row">${seal(m, `Become a ${l.name}`)}<span class="pat-go">Become a ${esc(l.name)}</span></div></form>`).join('')}</div>
<form method="post" action="/m/${esc(slug)}/patron" class="pat-once"><p class="pat-n">Or once</p><div class="pat-ch">${once.map((c, i) => `<label><input type="radio" name="once" value="${c / 100}" ${i === 1 ? 'checked' : ''}><span>${money(c)}</span></label>`).join('')}<label class="pat-own"><span>$</span><input name="amount" inputmode="numeric" placeholder="Your amount" aria-label="Your own amount, in dollars"></label></div>${seal(m, 'Give once')}</form>
<p class="note pat-fine">Monthly patronage can be ended any time from <a href="/yours">Yours</a>. Prices are drafts.</p></section>` : ''}
<section class="pat-wall" id="wall"><p class="k">The patrons of ${esc(m.name)}</p>${groups.length ? groups.map(([k, ps]) => `<div><h3>${lvName(k)}</h3><p>${ps.map(p => esc(p.name)).join(' &middot; ')}</p></div>`).join('') : `<p class="pat-first">The first name on this wall is still to be written.</p>`}</section>` });
}

function patronThanks({ p, m, slug, level, own, session }) {
  const done = p.status !== 'pending';
  return layout({ title: 'Thank you · Watermark', body: `<section class="cx-intro pat-ty">${done ? `<span class="ps-stamp" aria-hidden="true">${K_MARK}</span>` : ''}<p class="k">${p.recurring ? 'Patronage' : 'Support'}</p>
<h1>${done ? (p.recurring ? `You are a patron of ${esc(m.name)}.` : `Thank you. ${esc(m.name)} will know.`) : 'One moment. Your patronage is being confirmed.'}</h1>
${done && level ? `<p class="lede">${esc(level.name)}. ${esc(level.gives)}</p>` : done ? '<p class="lede">85% of it goes to the maker.</p>' : `<p class="lede"><a href="/patron/${p.id}/thanks?session_id=${esc(session)}">Refresh</a> in a few seconds.</p>`}
${done && own ? `<form method="post" action="/patron/${p.id}/name" class="form pat-nm"><label>Your name on the wall<input name="name" value="${esc(p.name || '')}" placeholder="As you would like it written"></label><label class="chk"><input type="checkbox" name="public" value="1" ${p.public ? 'checked' : ''}> Show my name among the patrons</label><button class="buy-btn">Save</button></form>` : ''}
<p class="sr-also"><a href="/m/${esc(slug)}">Back to ${esc(m.name)}</a> &middot; <a href="/yours">Your collection</a></p></section>` });
}

function voicesEdit({ w, maker, voices, kinds, saved }) {
  return layout({ title: `Voices · ${tidy(w.title)} · Watermark`, body: `<section class="vo-ed"><a class="vo-back" href="/w/${esc(w.slug)}">&larr; ${esc(tidy(w.title))}</a>
<div class="vo-head"><img src="/img/${esc(w.slug)}/thumb" alt="" draggable="false"><div><p class="k">Voices</p><h1>What is said about this photograph.</h1><p class="lede">Your own word on it, an art historian&rsquo;s reading, or a note. People hear it on the photograph&rsquo;s page and in the viewer.</p></div></div>
${saved === '1' ? '<p class="ok">Saved. It is on the photograph now.</p>' : saved === 'removed' ? '<p class="ok">Removed.</p>' : saved === 'empty' ? '<p class="err">Record something, add a file, or write a note.</p>' : ''}
${voices.length ? `<div class="vo-list">${voices.map(v => voice(v) + `<form method="post" action="/voices/${esc(w.slug)}/${esc(v.key)}/remove" class="vo-rm"><button>Remove</button></form>`).join('')}</div>` : ''}
<form method="post" action="/voices/${esc(w.slug)}" enctype="multipart/form-data" class="form vo-form" data-vo-form>
<label>Whose voice<select name="kind">${Object.entries(kinds).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select></label>
<label>Speaker<input name="speaker" value="${esc(maker.name)}" placeholder="Name"></label>
<label>Who they are (optional)<input name="role" placeholder="Art historian, The Morgan Library"></label>
<div class="vo-rec"><button type="button" class="vo-recbtn" data-rec><i></i><span>Record</span></button><span class="vo-time" data-rec-time>0:00</span><audio controls hidden data-rec-play></audio></div>
<label>Or a file (m4a, mp3, wav)<input type="file" name="audio" accept="audio/*"></label>
<label>Words (a note, or what was said)<textarea name="body" rows="5" placeholder="What you see in it, where you stood, why it matters."></textarea></label>
<input type="hidden" name="seconds" value="">
<button class="buy-btn">Save it to the photograph</button></form></section>
<script src="/static/voices.js?v=${VER}" defer></script>` });
}

function signin({ b, has }) {
  return layout({ title: 'Sign in · Watermark', body: `<section class="cx-intro pk-in" data-passkey-box><span class="ps-stamp" aria-hidden="true">${K_MARK}</span><p class="k">Your collection</p>
<h1>${has ? 'You are signed in.' : 'Sign in.'}</h1>
<p class="lede">${has ? 'Your collection is saved to your passkey, and follows you to every device you sign in on.' : 'With the passkey you saved on Watermark: Face ID, Touch ID or your phone. No password, nothing to remember.'}</p>
${has ? '<p><a class="buy-btn" href="/yours">Go to your collection</a></p><form method="post" action="/auth/signout"><button class="pk-out">Sign out of this device</button></form>' : '<p><button class="buy-btn" data-passkey="signin">Sign in with a passkey</button></p><p class="pk-msg" data-passkey-msg></p><p class="note">New here? Collect a photograph and it hangs in <a href="/yours">your collection</a>; save it with a passkey from there.</p>'}
</section><script src="/static/webauthn.js" defer></script><script src="/static/auth.js?v=${VER}" defer></script>` });
}

function claim({ c, maker, mine }) {
  if (!c) return layout({ title: 'Watermark', body: '<section class="cx-intro"><p class="k">Passed on</p><h1>This link has been used, or has expired.</h1><p><a class="buy-btn" href="/collection">Walk the collection</a></p></section>' });
  const { w, l } = c;
  return layout({ title: `${tidy(w.title)} · Watermark`, body: `<section class="cl"><div class="cl-im"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" draggable="false"></div><div class="cl-t"><p class="k">A work passed to you</p><h1><i>${esc(tidy(w.title))}</i></h1><p class="lot-maker">${esc(maker.name)}</p>
<p class="cl-no">Collector No. ${l.collector_no}${w.edition_size ? ` of ${w.edition_size}` : ''}</p>
${mine ? '<p class="note">This is the link you made. Send it to the person you are giving it to.</p>' : `<form method="post" class="seal-row cl-f">${seal(maker, 'Accept')}<div class="seal-t"><b>Accept</b><span>It hangs in your collection with this number, and its file is yours.</span></div></form>`}</div></section>` });
}

function setThanks({ items, name }) {
  const done = items.every(l => l.status === 'active');
  return layout({ title: 'Yours · Watermark', body: `<section class="cx-intro sr-thanks"><p class="k">${esc(name)}</p><h1>${done ? 'They&rsquo;re yours.' : 'Payment received. Preparing your files.'}</h1>
<p class="lede">${done ? `${items.length} photographs, each numbered and hung in <a href="/yours">your collection</a>. Save them below; every file carries its maker&rsquo;s credit.` : 'This takes a few seconds. Refresh the page in a moment.'}</p></section>
<section class="gal"><div class="st-grid">${items.map(l => `<div class="st-it"><img src="/img/${esc(l.slug)}/thumb" alt="${esc(tidy(l.title))}" loading="lazy" draggable="false"><i>${esc(tidy(l.title))}</i><small>${l.collector_no ? `Collector No.&nbsp;${l.collector_no}` : ''}</small>${done && l.download_token ? `<a href="/d/${esc(l.download_token)}" download>Save</a>` : ''}</div>`).join('')}</div>
<p class="sr-also"><a class="buy-btn" href="/yours">See your collection</a></p></section>` });
}

function thanks({ lic, w, maker, use }) {
  const done = lic.status === 'active';
  return layout({
    title: done ? `It's yours · ${w.title}` : 'One moment · Watermark',
    body: `${done ? '' : '<meta http-equiv="refresh" content="3">'}<section class="yours${done ? ' in' : ''}">
<div class="yours-fig"><img src="/img/${esc(w.slug)}/screen" alt="${esc(w.title)}" draggable="false"><span class="yours-seal" aria-hidden="true"><img src="/static/wave.svg" alt=""></span></div>
<div class="yours-t">
<p class="k">${esc(lic.ref)}</p>
<h1>${done ? 'It&rsquo;s yours.' : 'Payment received. Preparing your file.'}</h1>${done && lic.collector_no ? `<p class="yc-big">Collector No. ${lic.collector_no}${w.edition_size ? ` of ${w.edition_size}` : ''}, <em>${esc(tidy(w.title))}</em>. <a href="/yours">It hangs in your collection.</a></p>` : ''}
<p class="lede">${done ? `<em>${esc(w.title)}</em> by ${esc(maker.name)}. ${use.kind === 'print' ? 'A signed archival print, yours to keep. It ships within the week.' : `Licensed ${esc(use.name.toLowerCase())}${lic.ends_at ? ` until ${date(lic.ends_at)}` : ''}.`} ${lic.licensee_email ? `A copy of everything is on its way to ${esc(lic.licensee_email)}.` : ''}` : 'This takes a few seconds.'}</p>
${done ? `<div class="yours-a">${lic.download_token ? `<a class="buy-btn" href="/d/${esc(lic.download_token)}">Download the full file</a>` : ''}
<a class="yours-l" href="/c/${esc(lic.ref)}.pdf">Certificate (PDF)</a><a class="yours-l" href="/c/${esc(lic.ref)}?k=${esc(lic.download_token || '')}">License page</a><a class="yours-l" href="/verify?ref=${esc(lic.ref)}">Verify</a></div>
<p class="note">The file carries its license inside it: maker, collector, reference and term. ${esc(maker.name)} has been paid.</p>` : ''}
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

// A collector's own Watermark: every work they have collected, numbered, room by room.
function collector({ b, items, rooms, works, makers, own, base, pay = null, share = null, give = null, got = null, founding = null, left = null, patronOf = [], patronSlug = null, keyed = true }) {
  const who = b && b.name ? b.name : own ? 'Your collection' : 'A collection';
  if (!b || !items.length) return layout({ title: `${who} · Watermark`, body: `<section class="cx-intro yc-empty"><p class="k">${own ? 'Your collection' : 'Collection'}</p>
<h1>${own ? 'Start your collection.' : 'Nothing to see here.'}</h1>
<p class="lede">${own ? 'Every photograph you collect on Watermark hangs here, numbered: you are collector No. 1, No. 12, No. 37 of the work. It stays private unless you choose to show it.' : 'This collection is private, or no longer exists.'}</p>
${own && left ? `<p class="fc-call"><span class="fc-k">${K_MARK}</span>The first hundred people to collect on Watermark are its Founding Collectors, marked so on their wall for good. ${left} of 100 places remain.</p>` : ''}
${own ? '<p><a class="buy-btn" href="/collection">Walk the collection</a></p><p class="yc-signin">Already a collector? <a href="/signin">Sign in with your passkey</a>.</p>' : ''}</section>` });
  const plate = i => `<a class="pl yc-pl" href="/w/${esc(i.slug)}" data-s="${esc(i.slug)}" style="--r:${(i.width && i.height ? i.width / i.height : 1.5).toFixed(3)}"><img src="/img/${esc(i.slug)}/thumb" alt="${esc(i.title)}" loading="lazy" draggable="false"><span class="yc-no">No. ${i.collector_no || '—'}${i.edition_size ? `<small>/${i.edition_size}</small>` : ''}</span><span class="pc"><b>${esc(i.title)}</b><i>${esc(i.maker)}</i></span>${!own && pay ? `<span class="pb" data-buy role="button" tabindex="0" aria-label="Collect">${K_MARK}<i class="seal-r"></i></span>` : ''}${i.printed ? `<span class="yc-pr">Printed</span>` : ''}</a>`;
  const roomRow = r => `<a class="yc-room" href="/rooms/${esc(r.slug)}"><span class="yc-rt">${esc(r.title.replace(/^Journey Out (East|West):?\s*/, ''))}</span><span class="yc-bar"><i style="width:${Math.round(100 * r.have / r.total)}%"></i></span><span class="yc-rn">${r.have === r.total ? 'Complete' : `${r.have} of ${r.total}`}</span></a>`;
  const lowest = items.reduce((a, i) => (i.collector_no && (!a || i.collector_no < a.collector_no) ? i : a), null);
  return layout({ title: `${who} · Watermark`, desc: `${works} photographs collected on Watermark.`, body: `<section class="cx-intro"><p class="k">${own ? 'Your collection' : 'Collection'}</p>
<h1>${esc(who)}${b.name ? '.' : ''}</h1>${founding ? `<p class="fc-mark"><span class="fc-k">${K_MARK}</span>Founding Collector &middot; No. ${founding} of 100</p>` : ''}${patronOf.map(p => `<p class="fc-mark pat-mark"><span class="fc-k">${K_MARK}</span>Patron of ${esc(p.maker_name)} &middot; since ${esc(new Date(p.started_at + 'Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</p>`).join('')}
<p class="cx-count">${works} work${works === 1 ? '' : 's'} · ${makers} photographer${makers === 1 ? '' : 's'} · ${rooms.filter(r => r.have === r.total).length} room${rooms.filter(r => r.have === r.total).length === 1 ? '' : 's'} complete${lowest ? ` · earliest: collector No. ${lowest.collector_no} of <em>${esc(lowest.title)}</em>` : ''}</p></section>
${rooms.length ? `<section class="gal"><header class="gh"><h2>Rooms</h2><span>collected of each</span></header><div class="yc-rooms">${rooms.map(roomRow).join('')}</div></section>` : ''}
<section class="gal"><header class="gh"><h2>The collection</h2><span>newest first</span></header><div class="plates">${items.map(plate).join('')}</div>
${!own && pay ? `<script>window.__WM_PAY=${JSON.stringify(pay).replace(/</g, '\\u003c')};</script><script src="/static/pay.js?v=${VER}" defer></script>` : ''}
${!own && share && share.price_cents != null ? `<p class="yc-cta">Like what ${esc(b.name || 'this collector')} collects? Every work here can be yours too, from ${money(share.price_cents)}: open one and press Share it.</p>` : ''}</section>
${own ? `<section class="gal yc-own"><header class="gh"><h2>Show it, or keep it</h2></header>
<form method="post" action="/yours" class="form yc-form"><label>Name on the wall<input name="name" value="${esc(b.name || '')}" placeholder="Elena's collection"></label>
<label class="chk"><input type="checkbox" name="public" value="1" ${b.public ? 'checked' : ''}> Open my collection to anyone with the link</label><button>Save</button></form>
${b.public && b.code ? `<p class="note">Your public link: <a href="/collector/${esc(b.code)}">${esc(base)}/collector/${esc(b.code)}</a></p>` : '<p class="note">Private: only this device sees it.</p>'}
${give ? `<div class="yc-give" id="give"><p class="k">To pass on <em>${esc(tidy(give.title))}</em></p><p>Send this link to the person you are giving it to. When they accept, it hangs on their wall with your number, and leaves yours.</p><input readonly value="${esc(base)}/claim/${esc(give.token)}" onclick="this.select()"></div>` : ''}
${keyed ? '' : `<div class="pk" data-passkey-box><span class="fc-k">${K_MARK}</span><div><b>Keep your collection on every device.</b><p>Save it with a passkey: Face ID or Touch ID, no password. Then sign in on any phone or computer and it is there.</p><button class="pk-go" data-passkey="save">Save with a passkey</button><p class="pk-msg" data-passkey-msg></p></div></div><script src="/static/webauthn.js" defer></script><script src="/static/auth.js?v=${VER}" defer></script>`}
<div id="patronage">${patronOf.length ? patronOf.map(p => `<div class="yc-pat"><span><b>Patron of ${esc(p.maker_name)}</b> &middot; ${esc(p.level.charAt(0).toUpperCase() + p.level.slice(1))}, ${money(p.amount_cents)} a month${p.status === 'ending' ? ' &middot; ends at the close of this month' : ''}</span>${p.status === 'active' ? `<form method="post" action="/patron/${p.id}/end"><button class="yf-give">End patronage</button></form>` : ''}</div>`).join('') : patronSlug ? `<p class="note">Keep a maker working: <a href="/m/${esc(patronSlug)}#patron">become a patron</a>.</p>` : ''}</div>
${got ? `<p class="yc-got">It&rsquo;s yours now. It hangs below, with its number.</p>` : ''}
<div class="yc-files" id="files">${items.map(i => `<div class="yf"><img src="/img/${esc(i.slug)}/thumb" alt="" loading="lazy" draggable="false"><div class="yf-t"><i>${esc(tidy(i.title))}</i><small>${esc(i.maker)} &middot; No. ${i.collector_no || '—'}${i.edition_size ? ` of ${i.edition_size}` : ''} &middot; ${date(i.starts_at)}</small>${i.printed ? `<small class="yf-pr">Printed: ${esc(i.printed)}</small>` : ''}</div>
<div class="yf-a">${i.download_token ? `<a href="/d/${esc(i.download_token)}">Save</a>` : ''}
<details><summary>Record a print</summary><form method="post" action="/yours/print" class="yf-f"><input type="hidden" name="ref" value="${esc(i.ref)}"><input name="size" placeholder="Size, e.g. 16 × 20 in" required><input name="paper" placeholder="Paper or lab (optional)"><input name="made" placeholder="When (optional)"><button>Record it</button></form></details>
${i.collector_no && i.status === 'active' ? `<form method="post" action="/yours/give"><input type="hidden" name="ref" value="${esc(i.ref)}"><button class="yf-give">Pass it on</button></form>` : ''}</div></div>`).join('')}</div></section>` : ''}` });
}

// The collectors: the walls people chose to show, so others can see what taste looks like here.
// A photograph across the top of a page, captioned like a wall label.
const pageHero = (slug, cap, h, by = 'Will Fullerton') => `<section class="cx-cover pg-hero"><img src="/img/${esc(slug)}/large" alt="${esc(cap)}" fetchpriority="high" draggable="false">${h ? `<div class="cx-hero">${h}</div>` : ''}<span class="cx-cap">${esc(cap)}${by ? ` &middot; ${esc(by)}` : ''}</span></section>`;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

function series({ s, chapters, whole = null, buy = false, credits = [], patronSlug = null }) {
  const plate = (w, big) => `<a class="sr-pl${big ? ' sr-big' : ''}" href="/w/${esc(w.slug)}" style="--r:${w.width && w.height ? (w.width / w.height).toFixed(3) : 1.5}"><span class="sr-im"><img src="/img/${esc(w.slug)}/${big ? 'large' : 'screen'}" alt="${esc(tidy(w.title))}" loading="lazy" decoding="async" draggable="false"></span><span class="sr-lb"><i>${esc(tidy(w.title))}</i><small>${esc(w.place || '')}${w.accession ? ` &middot; ${esc(w.accession)}` : ''}</small></span></a>`;
  const cover = chapters.flatMap(c => c.works).find(w => w.slug === s.cover);
  const n = chapters.reduce((a, c) => a + c.works.length, 0);
  return layout({ title: `${s.title} · ${s.house} · Watermark`, desc: s.dek, path: `/series/${s.slug}`, image: cover ? `/img/${cover.slug}/screen` : null, type: 'article',
    body: `${cover ? pageHero(cover.slug, `${tidy(cover.title)}, ${cover.place || ''}`, `<div><p class="sr-k">A series by ${esc(s.maker)} &middot; ${esc(s.house)}</p><h1>${esc(s.title)}</h1></div><a class="btn" href="#ch-1">Enter</a>`) : ''}
<section class="sr-intro"><p class="lede">${esc(s.dek)}</p><p class="sr-toc">${chapters.map((c, i) => `<a href="#ch-${i + 1}"><span>${ROMAN[i]}</span>${esc(c.title)}</a>`).join('')}</p><p class="cx-count">${n} photographs in ${chapters.length} parts &middot; each one collectable</p></section>
${chapters.map((c, i) => `<section class="sr-ch" id="ch-${i + 1}"><header><span class="sr-no">${ROMAN[i]}</span><h2>${esc(c.title)}</h2><p>${esc(c.dek)}</p></header>
<div class="sr-hang">${c.works.map((w, j) => plate(w, j === 0)).join('')}</div>
${buy && c.items && c.items.length > 1 ? `<form method="post" action="/series/${esc(s.slug)}/collect" class="sr-set"><input type="hidden" name="part" value="${c.i}"><button class="jewel"><span>Collect all ${c.items.length} of ${esc(c.title)}</span><b>${money(c.price)}</b></button><p>${money(c.full)} one by one. Each photograph is numbered in your collection.</p></form>` : ''}</section>`).join('')}
<section class="sr-end"><p>${esc(s.title)} is a series by ${esc(s.maker)} for ${esc(s.house)}. Every photograph in it is held on Watermark, and every one can hang in your collection.</p>
${buy && whole && whole.n > 1 ? `<form method="post" action="/series/${esc(s.slug)}/collect" class="sr-set sr-set-all"><input type="hidden" name="part" value="all"><button class="jewel"><span>Collect the whole series &middot; ${whole.n} photographs</span><b>${money(whole.price)}</b></button><p>${money(whole.full)} one by one. The complete series, numbered on your wall.</p></form>` : ''}
<div class="sr-credits"><p class="k">Made possible by its patrons</p>${credits.length ? `<p class="sr-cn">${credits.map(esc).join(' &middot; ')}</p>` : '<p class="sr-cn sr-cn-empty">The next series could carry your name.</p>'}${patronSlug ? `<a href="/m/${esc(patronSlug)}#patron">Become a patron of ${esc(s.maker)}</a>` : ''}</div>
<p class="sr-also"><a href="/collection">Walk the whole collection</a></p></section>` });
}

function collectors({ list, left = null }) {
  const card = c => `<a class="yc-card" href="/collector/${esc(c.code)}"><span class="yc-th">${c.thumbs.map(t => `<img src="/img/${esc(t.slug)}/thumb" alt="" loading="lazy" draggable="false">`).join('')}</span>
<b>${esc(c.name || 'A private collector')}</b>${c.founding ? `<small class="fc-tag">Founding Collector No. ${c.founding}</small>` : ''}<span>${c.works} work${c.works === 1 ? '' : 's'}${c.earliest ? ` · earliest No. ${c.earliest}` : ''}</span></a>`;
  return layout({ title: 'The collectors · Watermark', desc: 'Collections people have chosen to show on Watermark.', path: '/collectors', body: `${pageHero('the-library-stacks', 'J. P. Morgan’s library, New York')}<section class="cx-intro"><p class="k">The collectors</p>
<h1>The people who keep the work.</h1><p class="lede">Frick, Morgan, Gardner: the great collections are why we can see the great works. These are the collections people have chosen to show on Watermark. Every work on their walls can hang on yours.</p>
<p class="cx-count"><a href="/yours">Your collection</a> &middot; <a href="/collection">Walk the archive</a></p>${left ? `<p class="fc-call"><span class="fc-k">${K_MARK}</span>The first hundred collectors are Watermark&rsquo;s Founding Collectors. ${left} of 100 places remain.</p>` : ''}</section>
<section class="gal">${list.length ? `<div class="yc-cards">${list.map(card).join('')}</div>` : '<p class="note">No collection is public yet. Yours could be the first: collect a work, then open your wall from <a href="/yours">Yours</a>.</p>'}</section>` });
}

// On patronage: why collectors matter, and why makers must be paid. Will's words, confirmed 16 Oct 2026.
function patronage() {
  return layout({ title: 'On patronage · Watermark', desc: 'Every great work you have stood in front of was paid for by someone. Those who make and those who collect: Watermark honours both.', path: '/patronage', type: 'article', body: `${pageHero('inside-brunelleschi-s-dome', 'Brunelleschi’s dome, Florence: the city of the Medici')}<article class="essay">
<p class="k">On patronage</p>
<h1>Every great work you have stood in front of was paid for by someone.</h1>
<p>In Florence around 1490, Lorenzo de&rsquo; Medici took a teenage stonecutter into his own household. He fed him at his table and let him study the family&rsquo;s collection of ancient sculpture. The boy was Michelangelo. Without that house there is no David, and no Sistine ceiling.</p>
<p>Leonardo&rsquo;s story runs the same way, through more hands. Lorenzo sent him from Florence to Milan, where Ludovico Sforza kept him for nearly twenty years. Out of those years came <em>The Last Supper</em>. Later Giuliano de&rsquo; Medici gave him rooms in Rome, and at the end of his life the King of France gave him a house at Amboise, where he died in 1519. Each patron bought him time. Time is what a maker needs most and can least afford.</p>
<p>Centuries later Henry Clay Frick and J.&nbsp;P. Morgan did the same work another way. They collected, kept and finally gave what they had gathered back to the public. You can walk into the Frick on Fifth Avenue because one man spent his life choosing well.</p>
<p>Collectors are not customers. They are the reason the rest of us get to see great work at all. Their taste becomes our inheritance.</p>
<p>The makers of our time are photographers, filmmakers and image makers, and most of them are paid nothing when their work is used. Watermark exists to change that: every image held, credited and paid for at the source. And it exists to bring back the oldest arrangement in art, the one between those who make and those who collect.</p>
<p class="essay-end">Those who make and those who collect. Watermark honours both.</p>
<p class="essay-go"><a class="buy-btn" href="/m/will-fullerton#patron">Become a patron</a> <a href="/collection">Walk the collection</a> <a href="/collectors">See the collectors</a></p>
</article>` });
}

// The Journal: what Krafft Studios writes about Watermark, art history and the people who make and collect.
function journal({ posts }) {
  const item = (p, lead) => `<a class="jr${lead ? ' jr-lead' : ''}" href="${esc(p.url)}">${p.feature_image ? `<span class="jr-f"><img src="${esc(p.feature_image)}" alt="${esc(p.feature_image_alt || '')}"${lead ? ' fetchpriority="high"' : ' loading="lazy"'} draggable="false"></span>` : ''}
<span class="jr-t"><small>${date(p.published_at)}${p.reading_time ? ` &middot; ${p.reading_time} min` : ''}</small><b>${esc(p.title)}</b><span>${esc(p.custom_excerpt || (p.excerpt || '').slice(0, 220))}</span>${lead ? '<span class="jr-go">Read on Krafft Studios &rarr;</span>' : ''}</span></a>`;
  return layout({ title: 'Journal · Watermark', desc: 'Watermark news, art history and patronage, written by Krafft Studios.', path: '/journal', body: `${pageHero('under-the-gallery-dome', 'The National Gallery, London')}<section class="cx-intro"><p class="k">Journal</p>
<h1>On making, collecting and keeping.</h1><p class="lede">News from Watermark, the history of art and patronage, and the people who make and collect. Written and published by <a href="https://studios.krafftco.com">Krafft Studios</a>.</p></section>
<section class="gal">${posts.length ? `<div class="jr-list">${posts.map((p, i) => item(p, i === 0)).join('')}</div>` : `<div class="jr-list"><a class="jr jr-lead" href="/patronage"><span class="jr-t"><small>Essay</small><b>On patronage</b><span>Every great work you have stood in front of was paid for by someone.</span></span></a></div>`}</section>` });
}

module.exports = { voicesEdit, signin, series, setThanks, claim, makerPage, patronThanks, journal, patronage, collectors, collector, layout, room, viewer, life, home, reported, collection, work, buy, ask, thanks, licenseForm, requested, certificate, verify, ledgerPage, about, terms, esc, money, date, termText };
