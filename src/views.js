// HTML for every page. Plain functions, no template engine.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c, cur = 'usd') => c == null ? 'On request' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
// Titles as a catalogue sets them: no closing period, proper apostrophes.
const tidy = s => String(s == null ? '' : s).trim().replace(/\.$/, '').replace(/(\w)'(\w)/g, '$1\u2019$2').replace(/'/g, '\u2019');
// The maker's mark, used as the Collect seal. Krafft makers carry the hand-made K; others the Watermark wave.
const K_MARK = '<svg viewBox="0 0 51.66 51.88" fill="currentColor" aria-hidden="true"><path d="M20.35.14L.14,26V0c7.28,0,20.21.14,20.21.14Z"/><polygon points="51.66 51.88 31.73 51.84 27.51 45.27 38.12 32.14 51.66 51.88"/><polygon points="0 41.9 .14 51.71 9.97 51.84 51.66 .3 31.8 .14 0 41.9"/></svg>';
const I = require('./icons');
const OBJ = require('./object'); // kinds and by-lines: 'Photograph by', 'Painting by'
const HAT = I.hat;
const WAVE_MARK = '<svg viewBox="1.5 14.2 41 11" fill="currentColor" aria-hidden="true"><path d="M40.9019,20.248c.0496.0348.1284.1018.21.14.0392.0183.1355.0555.1748.0725.142.0613.2106.0623.2106.0623.4242.1069.61-.0405.61-.0405,0,0,.0188-.0104.0372-.0243.0184-.014.0363-.0314.0458-.0406.0151-.0146.0539-.0644.0539-.0644,0,0,.052-.0909.0637-.1237.0071-.0198.024-.0795.024-.0795.0222-.0965.0109-.1126.0246-.2317.0093-.0811-.0287-.3268-.0598-.4078-.0365-.0952-.1166-.3107-.1703-.4046-.0609-.1065-.288-.3048-.3726-.4039-.0684-.0801-.1447-.1568-.2296-.2285-.1278-.108-.4529-.423-.699-.5881-.1149-.077-.4531-.3086-.661-.3576-.1954-.0461-.5058-.1799-.7093-.2207-.1562-.0313-.3892-.0664-.5873-.0663-.1141.0029-1.5885.0597-2.7094,1.0659-.3753.3369-.3855.3946-.8039.8574-1.32,1.4605-2.8991,1.493-4.248.0839-2.6425-2.7603-4.3029-2.7712-7.0126-.0458-1.4491,1.4575-2.8945,1.5826-4.2166-.0527-2.0205-2.4992-5.04-2.4249-6.9906-.0205-1.4506,1.788-2.9277,1.5387-4.6146-.3402-1.5584-1.7356-3.6345-2.0457-5.3761-.7779-.3208.2335-.6042.5574-.9828.9127-.3769.3368-.7879,2.0455.8259,1.4273.2077-.0796.4772-.3289.6437-.4599,1.37-1.0769,2.6549-.9274,3.9243.3511,2.7283,2.7477,4.1663,2.7285,6.9293-.0031,1.449-1.4325,2.9109-1.5845,4.2323.0157,2.0744,2.512,4.8342,2.5441,6.9759.0433,1.4851-1.7342,2.9311-1.5102,4.6445.3102,1.7438,1.8528,3.6846,2.1267,5.4476.7528.2651-.2066.5093-.4648.7507-.7199.9751-1.0303,1.776-1.4668,2.6072-1.416,0-.052.6333.1119.8306.2146.0961.05.3577.1959.4835.268.0829.0476.2447.1927.3365.2464l.1702.1427.1157.0958.071.0558Z"/></svg>';
// Each maker's own mark on the Collect seal: Krafft's makers carry the hand-made K, every other maker the Watermark wave.
const isKrafft = m => !!m && (/krafft/i.test(m.house || '') || m.handle === 'krafft');
const markOf = () => WAVE_MARK; // Will, 18 Oct: the Watermark sign moves forward; the K stays with Krafft's own sites
const mlink = (name, cls = '') => `<a href="/m/${esc(makerSlug({ name }))}"${cls ? ` class="${cls}"` : ''}>${esc(name)}</a>`;
const makerSlug = m => String((m && m.name) || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const seal = (m, label = 'Collect', cls = '') => `<button class="seal${cls ? ' ' + cls : ''}" aria-label="${esc(label)}"><span class="seal-k">${markOf(m)}</span><span class="seal-r" aria-hidden="true"></span></button>`;
// The Watermark Shield: an escutcheon with the wave struck across it.
const SHIELD = '<svg viewBox="0 0 40 46" aria-hidden="true" class="wm-shield"><path d="M20 1.5 37.5 6.5V22c0 11.2-7.4 18.6-17.5 22.4C9.9 40.6 2.5 33.2 2.5 22V6.5Z" fill="currentColor"/><path d="M20 3.6 35.6 8.1V22c0 9.9-6.5 16.6-15.6 20.2C11.3 38.6 4.4 31.9 4.4 22V8.1Z" fill="none" stroke="var(--bg,#fff)" stroke-width=".45" opacity=".42"/><svg x="5.5" y="16.3" width="29" height="7.8" viewBox="1.5 14.2 41 11" preserveAspectRatio="xMidYMid meet"><path d="M40.9019,20.248c.0496.0348.1284.1018.21.14.0392.0183.1355.0555.1748.0725.142.0613.2106.0623.2106.0623.4242.1069.61-.0405.61-.0405,0,0,.0188-.0104.0372-.0243.0184-.014.0363-.0314.0458-.0406.0151-.0146.0539-.0644.0539-.0644,0,0,.052-.0909.0637-.1237.0071-.0198.024-.0795.024-.0795.0222-.0965.0109-.1126.0246-.2317.0093-.0811-.0287-.3268-.0598-.4078-.0365-.0952-.1166-.3107-.1703-.4046-.0609-.1065-.288-.3048-.3726-.4039-.0684-.0801-.1447-.1568-.2296-.2285-.1278-.108-.4529-.423-.699-.5881-.1149-.077-.4531-.3086-.661-.3576-.1954-.0461-.5058-.1799-.7093-.2207-.1562-.0313-.3892-.0664-.5873-.0663-.1141.0029-1.5885.0597-2.7094,1.0659-.3753.3369-.3855.3946-.8039.8574-1.32,1.4605-2.8991,1.493-4.248.0839-2.6425-2.7603-4.3029-2.7712-7.0126-.0458-1.4491,1.4575-2.8945,1.5826-4.2166-.0527-2.0205-2.4992-5.04-2.4249-6.9906-.0205-1.4506,1.788-2.9277,1.5387-4.6146-.3402-1.5584-1.7356-3.6345-2.0457-5.3761-.7779-.3208.2335-.6042.5574-.9828.9127-.3769.3368-.7879,2.0455.8259,1.4273.2077-.0796.4772-.3289.6437-.4599,1.37-1.0769,2.6549-.9274,3.9243.3511,2.7283,2.7477,4.1663,2.7285,6.9293-.0031,1.449-1.4325,2.9109-1.5845,4.2323.0157,2.0744,2.512,4.8342,2.5441,6.9759.0433,1.4851-1.7342,2.9311-1.5102,4.6445.3102,1.7438,1.8528,3.6846,2.1267,5.4476.7528.2651-.2066.5093-.4648.7507-.7199.9751-1.0303,1.776-1.4668,2.6072-1.416,0-.052.6333.1119.8306.2146.0961.05.3577.1959.4835.268.0829.0476.2447.1927.3365.2464l.1702.1427.1157.0958.071.0558Z" fill="currentColor" opacity=".22" transform="translate(0 .45)"/><path d="M40.9019,20.248c.0496.0348.1284.1018.21.14.0392.0183.1355.0555.1748.0725.142.0613.2106.0623.2106.0623.4242.1069.61-.0405.61-.0405,0,0,.0188-.0104.0372-.0243.0184-.014.0363-.0314.0458-.0406.0151-.0146.0539-.0644.0539-.0644,0,0,.052-.0909.0637-.1237.0071-.0198.024-.0795.024-.0795.0222-.0965.0109-.1126.0246-.2317.0093-.0811-.0287-.3268-.0598-.4078-.0365-.0952-.1166-.3107-.1703-.4046-.0609-.1065-.288-.3048-.3726-.4039-.0684-.0801-.1447-.1568-.2296-.2285-.1278-.108-.4529-.423-.699-.5881-.1149-.077-.4531-.3086-.661-.3576-.1954-.0461-.5058-.1799-.7093-.2207-.1562-.0313-.3892-.0664-.5873-.0663-.1141.0029-1.5885.0597-2.7094,1.0659-.3753.3369-.3855.3946-.8039.8574-1.32,1.4605-2.8991,1.493-4.248.0839-2.6425-2.7603-4.3029-2.7712-7.0126-.0458-1.4491,1.4575-2.8945,1.5826-4.2166-.0527-2.0205-2.4992-5.04-2.4249-6.9906-.0205-1.4506,1.788-2.9277,1.5387-4.6146-.3402-1.5584-1.7356-3.6345-2.0457-5.3761-.7779-.3208.2335-.6042.5574-.9828.9127-.3769.3368-.7879,2.0455.8259,1.4273.2077-.0796.4772-.3289.6437-.4599,1.37-1.0769,2.6549-.9274,3.9243.3511,2.7283,2.7477,4.1663,2.7285,6.9293-.0031,1.449-1.4325,2.9109-1.5845,4.2323.0157,2.0744,2.512,4.8342,2.5441,6.9759.0433,1.4851-1.7342,2.9311-1.5102,4.6445.3102,1.7438,1.8528,3.6846,2.1267,5.4476.7528.2651-.2066.5093-.4648.7507-.7199.9751-1.0303,1.776-1.4668,2.6072-1.416,0-.052.6333.1119.8306.2146.0961.05.3577.1959.4835.268.0829.0476.2447.1927.3365.2464l.1702.1427.1157.0958.071.0558Z" fill="var(--bg,#fff)"/></svg></svg>';
function shieldBlock(sh, { open = false, slug = '' } = {}) {
  if (!sh) return '';
  const c = sh.cred && !sh.cred.none ? sh.cred : null;
  const capture = c ? (c.captured ? `Signed in camera at the moment it was made${c.issuer ? `, by ${esc(c.issuer)}` : ''}.` : `Arrived carrying Content Credentials${c.app ? ` from ${esc(c.app)}` : ''}${c.issuer ? `, signed by ${esc(c.issuer)}` : ''}.`) : '';
  const rows = [
    ['Held for', `${esc(sh.maker)}${sh.house ? `, ${esc(sh.house)}` : ''}, ${date(sh.registered)}${sh.accession ? ` &middot; ${esc(sh.accession)}` : ''}`],
    sh.object ? [sh.object.k, sh.object.v] : null,
    ['Authorship', `${esc(sh.maker)} attested on arrival to having made this ${esc((sh.kind || 'photograph').toLowerCase())} and holding its copyright, theirs from the moment it was made.${slug ? ` <a href="/w/${esc(slug)}/deed">The deed</a>.` : ''}`],
    sh.copyright ? ['U.S. copyright', `Registered, ${esc(sh.copyright)}. Search it at <a href="https://publicrecords.copyright.gov/" rel="noopener">publicrecords.copyright.gov</a>.`] : sh.office ? ['U.S. copyright', `${esc(sh.office.line)} <a href="/copyright">How registration works here</a>.`] : null,
    capture ? ['At capture', capture] : null,
    // Launch fix 1.1: the master row shows only when a full master is held (12 MP and up), never 'awaited' or 'due'.
    sh.mp && sh.mp >= 12 ? ['Archival master', `Held at ${esc(String(sh.mp))} megapixels.${sh.fixity && sh.fixity.ok ? ` Fixity last verified ${date(sh.fixity.checked_at)}: the original re-hashed against its fingerprint and found whole.` : sh.fixity ? ' Under conservation review.' : ''}${sh.archive ? ` <a href="/w/${esc(sh.archive)}/archive.wmark">Take the archive (.wmark)</a>.` : ''}`] : null,
    ['Fingerprint', `<code>sha256:${esc(String(sh.fingerprint || '').slice(0, 16))}&hellip;</code> The original, sealed in the vault. <a href="/verify">Verify a file</a>.`],
    sh.seq ? ['Ledger', `Entry ${sh.seq} in the <a href="/ledger">register</a>, chained to every entry before it.`] : null,
    sh.signs ? ['Content Credentials', `Every file that leaves Watermark carries them: the maker, the copyright holder, the license${sh.noAI ? ', and that it is not for AI training' : ''}. Inspect any copy at <a href="https://contentcredentials.org/verify" rel="noopener">contentcredentials.org/verify</a>.`] : null,
  ].filter(Boolean);
  return `<details class="wshield"${open ? ' open' : ''}><summary><span class="sh-m">${SHIELD}</span><span class="sh-t"><b>Watermark Shield</b><small>Held by Watermark for ${esc(sh.maker)} &middot; ${date(sh.registered)}</small></span><span class="sh-x" aria-hidden="true"></span></summary>
<dl class="sh-dl">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>${slug ? `<p class="sh-more"><a href="/w/${esc(slug)}/life">The life of this photograph &rarr;</a></p>` : ''}</details>`;
}
// Reference: a photograph held at reference quality, the full original straight from the camera file,
// 40 megapixels or more (a Leica Q3 at 60, a Hasselblad X2D at 100).
const megapixels = w => (w && w.width && w.height ? Math.round(w.width * w.height / 1e6) : 0);
const isReference = w => megapixels(w) >= 40;
const REF_MARK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .8 11.2 6 6 11.2.8 6Z" fill="none" stroke="currentColor" stroke-width="1"/><path d="M6 3.6 8.4 6 6 8.4 3.6 6Z" fill="currentColor"/></svg>';
const refTag = (w, cls = '') => isReference(w) ? `<span class="mst${cls ? ' ' + cls : ''}" title="Reference image: the full original, ${megapixels(w)} megapixels">${REF_MARK}<b>Reference</b>${cls === 'mst-lg' ? `<i>${megapixels(w)} MP</i>` : ''}</span>` : '';
// Registered with the U.S. Copyright Office: the number, entered when the certificate arrives.
const isRegistered = w => !!(w && w.copyright_reg);
const regTag = (w, cls = '') => isRegistered(w) ? `<span class="crt${cls ? ' ' + cls : ''}" title="Registered with the U.S. Copyright Office, ${esc(w.copyright_reg)}"><i aria-hidden="true">&copy;</i><b>U.S. Registered</b>${cls === 'crt-lg' ? `<em>${esc(w.copyright_reg)}</em>` : ''}</span>` : '';
const date = s => s ? new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
const { NEVER } = require('./rules');
const termText = u => u.kind === 'print' ? 'Yours to keep' : u.term_months ? (u.term_months % 12 ? `${u.term_months} months` : `${u.term_months / 12} year${u.term_months > 12 ? 's' : ''}`) : 'Perpetual';

// Changes with every deploy, so browsers fetch the new styles and scripts at once.
const VER = (process.env.RENDER_GIT_COMMIT || String(Date.now())).slice(0, 8);
const BASE = () => (process.env.BASE_URL || 'https://watermark.krafftco.com').replace(/\/$/, '');
// Link previews (iMessage, LinkedIn, Slack), search engines and Google Images read these.
function headMeta({ title, desc, path, image, type = 'website', jsonld }) {
  const u = BASE() + (path || '');
  return `<link rel="canonical" href="${esc(u)}">${/^\/(w|m)\//.test(path || '') && type === 'article' ? `<link rel="alternate" type="application/json+oembed" href="${BASE()}/oembed?url=${encodeURIComponent(u)}" title="${esc(title)}">` : ''}<meta property="og:site_name" content="Watermark"><meta property="og:type" content="${type}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(u)}">${image ? `<meta property="og:image" content="${esc(BASE() + image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(BASE() + image)}">` : '<meta name="twitter:card" content="summary">'}${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}`;
}
// The app: a service worker keeps the shell and the rooms you have walked; links prerender as you reach for them
// (Speculation Rules, where the browser has them), so the next page is already there; pages cross-fade (View
// Transitions). An install prompt is kept for /app. Nothing here is required for the house to work.
const APP = `<script type="speculationrules">{"prerender":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/(account|yours|studio|signin|signout|auth|buy|license|swap|market|friends|m/*/patron|w/*/archive.wmark|library/d|d|c|k|seat)/*"}}]},"eagerness":"moderate"}]}</script>
<script>if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}
addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__wmInstall=e;document.documentElement.classList.add('can-install');var b=document.querySelector('[data-install]');if(b)b.hidden=false;});
document.addEventListener('click',function(e){var b=e.target.closest('[data-install]');if(!b||!window.__wmInstall)return;e.preventDefault();window.__wmInstall.prompt();window.__wmInstall=null;b.hidden=true;});</script>`;
function offline() {
  return layout({ title: 'The house cannot be reached · Watermark', bare: false, body: `<section class="nf"><span class="nf-im nf-blank"></span><div class="nf-t"><p class="k">Between rooms</p><h1>The house cannot be reached just now.</h1>
<p class="lede">You may be offline, or a new version is being hung. The rooms you have already walked are still here; everything else will be back in a minute.</p>
<p class="nf-row"><a class="buy-btn" href="/collection">The collection</a><a class="nf-alt" href="/wander/room">The viewing room</a><a class="nf-alt" href="/yours">Your gallery</a></p></div></section>` });
}
function appPage({ standalone = false }) {
  return layout({ title: 'Watermark, as an app · Watermark', desc: 'Put Watermark on your Dock or your home screen: the house without the browser around it.', path: '/app', body: `<section class="narrow ap"><p class="k">The app</p><h1>${standalone ? 'You are in the app.' : 'Watermark, on your Dock.'}</h1>
<p class="lede">${standalone ? 'The house, without the browser around it. Wander from the icon; the rooms you have walked stay with you when the connection does not.' : 'The house without the browser around it: its own window and icon, instant pages, the photographs you have seen kept on the device, and the rooms you have walked there when the connection is not. Nothing to download from a store; nothing it can see but the house.'}</p>
${standalone ? '' : `<p class="ap-act"><button class="buy-btn" data-install hidden>Install Watermark</button></p>
<h2>By hand</h2>
<dl class="facts ap-how" data-ap-how><div data-os="ios"><dt>iPhone, iPad</dt><dd>In Safari, tap <b>Share</b> (the square with the arrow), then <b>Add to Home Screen</b>, then <b>Add</b>. The house opens full screen from its own icon.</dd></div>
<div data-os="mac-safari"><dt>Mac, Safari</dt><dd>File → <b>Add to Dock</b>.</dd></div>
<div data-os="mac-chrome"><dt>Mac, Chrome or Edge</dt><dd>In the address bar, the install icon at the right; or the browser menu → <b>Install Watermark</b>.</dd></div>
<div><dt>Android</dt><dd>The browser menu → <b>Install app</b>, or <b>Add to Home screen</b>.</dd></div>
<div><dt>Windows</dt><dd>Chrome or Edge: the install icon in the address bar.</dd></div></dl>`}
<p class="note">A native application for the Mac and the phone is on the list; this is the same house, installed, and it will be kept current.</p></section>
<script>(function(){var ua=navigator.userAgent,ios=/iPhone|iPad|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),mac=/Macintosh/.test(ua)&&!ios,safari=/Safari/.test(ua)&&!/Chrome|Chromium|Edg/.test(ua);var me=ios?'ios':mac?(safari?'mac-safari':'mac-chrome'):null;var dl=document.querySelector('[data-ap-how]');if(dl&&me){var el=dl.querySelector('[data-os="'+me+'"]');if(el){el.classList.add('ap-me');dl.prepend(el);}}})();</script>` });
}
// The house bar (Krafft · Krafft Studios · Watermark), rendered here so it never flashes in;
// public/house.js then points each link back to the page last open on that property.
const HOUSE = `<nav class="kh" aria-label="Krafft"><button class="kh-k" type="button" aria-label="The houses of Krafft">${K_MARK}</button><span class="kh-h"><a data-p="studios" href="https://studios.krafftco.com/">Studios</a><a data-p="watermark" href="/" aria-current="site">Watermark</a></span></nav>`;
// The desk: the Studio's own shell. No public nav, no house bar; a wordmark, the rooms, the back office,
// a status line, and the way out. Dense and quiet, the way a bank's application is.
let deskStatus = () => '', deskPath = '';
const setDeskPath = h => { deskPath = h || ''; };
const setDeskStatus = fn => { deskStatus = fn; };
const DESK_MAIN = [['/studio', 'Holdings'], ['/studio/trove', 'Works'], ['/studio/licenses', 'Licenses'], ['/studio/market', 'Market'], ['/studio/makers', 'Makers']];
const DESK_MORE = [['/studio/launch', 'Launch'], ['/studio/analytics', 'The numbers'], ['/studio/founders', 'Founders'], ['/studio/committee', 'The committees'], ['/studio/season', 'The season'], ['/studio/iiif', 'Collections in'], ['/studio/feedback', 'Feedback'], ['/studio/clients', 'Companies'], ['/studio/prints', 'Prints'], ['/studio/works', 'Add work'], ['/studio/editions', 'Editions'], ['/studio/copyright', 'Copyright'], ['/studio/contract', 'Contract'], ['/studio/legal', 'Agreements'], ['/studio/activity', 'Activity'], ['/studio/uses', 'Prices'], ['/studio/masters', 'Masters'], ['/studio/fixity', 'Conservation'], ['/studio/restoration', 'Restoration'], ['/studio/backups', 'Backups'], ['/studio/audit', 'Audit'], ['/studio/library', 'Library'], ['/studio/sightings', 'Sightings'], ['/studio/claims', 'Claims'], ['/studio/hangs', 'Hangs'], ['/studio/accounts', 'Accounts'], ['/studio/hall', 'Hall of Patrons'], ['/studio/partners', 'Partners']];
const MAKER_MAIN = [['/account', 'Your studio'], ['/account/requests', 'Requests'], ['/account/upload', 'The vault'], ['/account/profile', 'Your page'], ['/account/payouts', 'Getting paid'], ['/account/curators', 'Curators'], ['/account/connections', 'Connections'], ['/account/atelier', 'Atelier'], ['/yours', 'Your gallery']];
// Every maker is a collector. One switch, the same in the studio and the gallery: Studio | Gallery.
let houseMaker = null; const setHouseMaker = h => { houseMaker = h; };
const SWITCH = (on, { admin = false } = {}) => `<nav class="dk-sw" aria-label="Studio or gallery">${admin ? `<a href="/studio"${on === 'house' ? ' aria-current="page"' : ''}>The house</a>` : ''}<a href="${admin && houseMaker ? `/account?maker=${esc(houseMaker)}` : '/account'}"${on === 'studio' ? ' aria-current="page"' : ''}>${admin ? 'My studio' : 'Studio'}</a><a href="/yours"${on === 'gallery' ? ' aria-current="page"' : ''}>Gallery</a></nav>`;
let deskAdmin = false; const setDeskAdmin = v => { deskAdmin = !!v; };
let deskGallery = false; const setDeskGallery = v => { deskGallery = !!v; };
function deskHeader(path = '') {
  path = path || deskPath;
  const maker = /^\/(account|yours|closer)/.test(path);
  const cur = h => (path === h || (!['/studio', '/account'].includes(h) && path && path.startsWith(h))) ? ' aria-current="page"' : '';
  if (maker) return `<header class="dk"><div class="dk-row"><a class="dk-brand" href="/account"><img src="/static/watermark-logo.svg" alt="Watermark"></a>${SWITCH('studio', { admin: deskAdmin })}<a href="/notices" class="nv-bell dk-bell" data-nv-bell hidden aria-label="Notifications">${I.bell}<i data-nv-n></i></a>
<nav class="dk-nav" aria-label="Your rooms">${(deskGallery ? [MAKER_MAIN[0], ['/account/gallery', 'The gallery'], ...MAKER_MAIN.slice(1)] : MAKER_MAIN).filter(([h]) => h !== '/yours').map(([h, t]) => `<a href="${h}"${cur(h)}>${t}</a>`).join('')}</nav>
<div class="dk-right"><a href="/" class="dk-out">The collection</a><form method="post" action="/signout" class="dk-form"><button class="dk-out">Sign out</button></form></div></div></header>`;
  return `<header class="dk"><div class="dk-row"><a class="dk-brand" href="/studio"><img src="/static/watermark-logo.svg" alt="Watermark"></a>${SWITCH('house', { admin: true })}
<nav class="dk-nav" aria-label="The rooms">${DESK_MAIN.map(([h, t]) => `<a href="${h}"${cur(h)}>${t}</a>`).join('')}</nav><details class="dk-more"><summary>Back office</summary><div>${DESK_MORE.map(([h, t]) => `<a href="${h}"${cur(h)}>${t}</a>`).join('')}</div></details>
<div class="dk-right"><a href="/" class="dk-out">The collection</a><a href="/studio/logout" class="dk-out">Sign out</a></div></div>
<div class="dk-status">${deskStatus()}</div></header>`;
}
// Beta and the test house. BETA is the live house before launch (a quiet word by the wordmark and a way to tell
// us what you find); the Studio turns it off at launch (setLaunched). STAGING is the test house: a band on every page.
let LAUNCHED = false; const setLaunched = v => { LAUNCHED = !!v; };
const STG = () => process.env.STAGING === '1';
function layout({ title, body, desc = 'Held on Watermark.', bare = false, studio = false, path, image, type, jsonld, mark = null }) {
  const dark = bare && /class="(st|vr|fm|xr|ez)[ "]/.test(body);
  return `<!doctype html><html lang="en"${dark ? ' class="dk"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><script>try{document.documentElement.setAttribute('data-guide',localStorage.getItem('wm_guide')||'hints')}catch(e){document.documentElement.setAttribute('data-guide','hints')}</script>
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="theme-color" content="#0e0e0e"><link rel="manifest" href="/static/app/manifest.webmanifest"><link rel="apple-touch-icon" href="/static/app/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Watermark"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="mobile-web-app-capable" content="yes"><meta name="robots" content="${studio || STG() ? 'noindex, nofollow, ' : ''}noai, noimageai"><meta name="tdm-reservation" content="1">${studio ? '' : headMeta({ title, desc, path, image, type, jsonld })}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Archivo:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,300..500;1,6..72,300..500&display=swap">
<link rel="stylesheet" href="/static/style.css?v=${VER}"><script>(function(){var m=document.cookie.match(/(?:^|; )wm_hi=([^;]*)/);if(!m)return;document.cookie='wm_hi=; Max-Age=0; path=/';var n=decodeURIComponent(m[1]);addEventListener('DOMContentLoaded',function(){var d=document.createElement('div');d.className='wm-hi';d.textContent=n&&n!=='·'?'Welcome back, '+n+'. You are our honoured guest.':'Welcome. You are our honoured guest.';document.body.appendChild(d);requestAnimationFrame(function(){d.classList.add('on')});setTimeout(function(){d.classList.remove('on');setTimeout(function(){d.remove()},600)},3200)})})()</script><link rel="icon" href="/static/wave.svg">${bare || studio ? '' : '<meta name="kh" content="page"><meta name="kh-dot" content="off"><script src="/house.js"></script>'}</head>
<body class="${bare ? 'bare' : ''}${studio ? ' studio' : ''}">${STG() ? '<div class="stg"><b>The test house.</b> Nothing here is real and no money moves. <a href="https://watermark.krafftco.com">The house</a></div>' : ''}
${bare ? '' : studio ? deskHeader(path) : `${HOUSE}<header class="top"><button type="button" class="nv-back" data-nv-back hidden aria-label="Back">${I.back}<span>Back</span></button><a class="brand" href="/"><img src="/static/watermark-logo.svg" alt="Watermark" width="120" height="32">${LAUNCHED ? '' : '<sup class="beta">Beta</sup>'}</a>
<nav><a href="/collection">Collection</a><a href="/makers">Makers</a><a href="/signin" class="nv-y" data-nv-me>Sign in</a></nav><script>fetch('/api/me',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){if(!j||!j.in)return;var a=document.querySelector('[data-nv-me]');if(a){a.textContent='Yours';a.href='/yours'}}).catch(function(){})</script><a href="/notices" class="nv-bell" data-nv-bell hidden aria-label="Notifications">${I.bell}<i data-nv-n></i></a><button type="button" class="nv-find" data-find-open="page" title="Find a work, a place, a maker (press /)" aria-label="Find">${I.find}<span>Find</span></button><a href="${path === '/yours' ? '/stroll?in=mine' : '/stroll'}" class="nv-w" title="${path === '/yours' ? 'Stroll your gallery: your pieces, one at a time, full screen' : 'Wander: one work at a time, full screen'}" data-nv-wander>${WAVE_MARK}<span>Wander</span></a></header><script>(function(){if(matchMedia('(max-width:760px) and (pointer:coarse)').matches){document.querySelectorAll('[data-nv-wander],a[href="/wander/room"],a[href="/wander"]').forEach(function(a){if(a.pathname==='/stroll')return;a.href='/stroll';a.title='The stroll: the finest work, one at a time';});}})();</script>`}
<main>${body}</main><script>window.__WM_MARK=${JSON.stringify(mark || WAVE_MARK)};window.__WM_WAVE=${JSON.stringify(WAVE_MARK)};</script><script src="/static/seal.js?v=${VER}" defer></script>
${bare ? '' : `<footer class="foot"><p class="foot-h">Watermark &middot; <a href="https://krafftco.com">a Krafft company</a><span> &middot; The founding collection and the house&rsquo;s media are made by <a href="https://studios.krafftco.com">Krafft Studios</a>.</span></p>${LAUNCHED ? '' : `<p class="foot-beta">Watermark is in beta. Something odd, broken or wonderful? <a href="/feedback?from=${encodeURIComponent(path || '')}">Tell us</a>.</p>`}<nav class="foot-l" aria-label="The house"><a href="/artists">Artists</a><a href="/collectors">Galleries</a><a href="/market">Market</a><a href="/yours">Yours</a><a href="/journal">Journal</a><a href="/library">The Library</a><a href="/guestbook">Guest book</a><a href="/own">You already own it</a><a href="/hanging">Who hangs</a><a href="/keys">The Keys</a><a href="/season">The season</a><a href="/club">The Club</a><a href="/enjoy">Enjoying it</a><a href="/friends">Friends of the house</a><a href="/makers">For makers</a><a href="/museums">For museums</a><a href="/trade">For the trade</a><a href="/verify">Verify a license</a><a href="/ledger">The register</a><a href="/copyright">Copyright Office</a><a href="/about">About</a><a href="/director">The director</a><a href="/owners">Owners</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/legal">The agreements</a><a href="/signin">Sign in</a><a href="/app">The app</a><a href="/frame">The frame</a><a href="/stroll">The stroll</a><a href="/print">Print your work</a><a href="/find">Find</a></nav></footer>`}${bare || studio ? '' : APP}
<script src="/static/foryou.js?v=${VER}" defer></script>${studio ? '' : `<script src="/static/basket.js?v=${VER}" defer></script><script src="/static/eye.js?v=${VER}" defer></script><script src="/static/tostroll.js?v=${VER}" defer></script>`}<script src="/static/notify.js?v=${VER}" defer></script>${studio ? '' : `${['find','close','next','wave','wilhelm'].map(k => `<template data-ic="${k}">${I[k]}</template>`).join('')}<script src="/static/find.js?v=${VER}" defer></script>`}<script src="/static/save.js?v=${VER}" defer></script><script src="/static/trade.js?v=${VER}" defer></script><script>(function(){var sa=matchMedia('(display-mode:standalone)').matches||navigator.standalone;if(!sa)return;var b=document.querySelector('[data-nv-back]');if(!b)return;var came=document.referrer&&new URL(document.referrer,location.href).origin===location.origin;if(history.length>1&&came&&location.pathname!=='/'){b.hidden=false;b.onclick=function(){history.back();};}})();</script></body></html>`;
}

// One row of the collection's search index: the small shape collection.js searches and lays out.
const indexRow = (w, m, { voiced = false, rooms = [] } = {}) => ({ v: voiced ? 1 : 0, cp: (w.caption || '').slice(0, 240), mk: m.name, ms: makerSlug(m), kk: isKrafft(m) ? 1 : 0, s: w.slug, t: tidy(w.title), p: w.place || '', a: w.accession || '', c: w.camera || '', d: w.taken_at ? String(w.taken_at).slice(0, 10) : '', r: +((w.width && w.height ? w.width / w.height : 1.5).toFixed(3)), w: w.width, h: w.height, k: w.keywords || '', m: rooms, $: w.share_cents || null, x: /"social":false/.test(w.rules || '') ? 1 : 0 });
function collection({ front = false, maker, works, rooms = [], share = null, pay = null, lately = [], today = null, hangs = [], shows = [], collections = [] }) {
  const mOf = w => w.maker || maker;
  // The collection is an archive you can walk: rooms as galleries, an index to search, and every
  // photograph a click from filling the screen.
  const ratio = w => (w.width && w.height ? w.width / w.height : 1.5);
  const roomOf = {}; rooms.forEach(r => (r.ids || []).forEach(id => { (roomOf[id] = roomOf[id] || []).push(r.slug); }));
  const data = works.map(w => indexRow(w, mOf(w), { voiced: w.voiced, rooms: roomOf[w.id] || [] }));
  const sp = share && share.price_cents != null ? money(share.price_cents) : null;
  const plate = w => `<a class="pl" href="/w/${esc(w.slug)}" data-s="${esc(w.slug)}" style="--r:${ratio(w).toFixed(3)}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" decoding="async" draggable="false"><span class="pl-tags">${refTag(w, 'mst-pl')}${regTag(w, 'crt-pl')}</span><span class="pc"><b>${esc(tidy(w.title))}</b><i>${esc([mOf(w).name, w.place].filter(Boolean).join(', '))}</i></span>${sp && !/"social":false/.test(w.rules || '') ? `<span class="pb" data-buy role="button" tabindex="0" aria-label="Collect">${markOf(mOf(w))}<i class="seal-r"></i></span>` : ''}</a>`;
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
  // Four doors (Will, 18 Oct: the Collection is the largest entry into the house; it has to traverse the makers'
  // art, what curators hang, what galleries show, and the collections people keep). Each door shows what is behind it.
  const th = list => list.slice(0, 3).map(sl => `<img src="/img/${esc(sl)}/thumb" alt="" loading="lazy" draggable="false">`).join('');
  const pick = (n, off) => works.filter(w => w.curated || (w.stars || 0) >= 4).concat(works).slice(off, off + n).map(w => w.slug);
  const wallSlugs = hangs.flatMap(h => (h.thumbs || []).map(t => t.slug)), showSlugs = shows.flatMap(h => (h.thumbs || []).map(t => t.slug)), collSlugs = collections.flatMap(c => (c.thumbs || []).map(t => t.slug));
  const door = (href, k, h, line, slugs, n) => `<a class="dr4-d" href="${href}"><span class="dr4-im">${th(slugs)}</span><span class="dr4-t"><small>${k}</small><b>${h}</b><i>${line}</i></span>${n != null ? `<span class="dr4-n">${n}</span>` : ''}</a>`;
  const doors = `<nav class="dr4" aria-label="Into the house">
${door('#archive', 'The makers', 'The archive', `${total} works${shown.length > 1 ? ` in ${shown.length} rooms` : ''}, by the people who made them.`, pick(3, 0), total)}
${door(hangs.length ? '#walls' : '/yours?tab=hangs', 'The curators', 'Walls', hangs.length ? 'Work hung by people with an eye, each wall in its own order.' : 'No wall is hung yet. A curator need not own a thing: hang the first.', wallSlugs.length ? wallSlugs : pick(3, 3), hangs.length || null)}
${door(shows.length ? '#shows' : '/collectors', 'The galleries', 'Shows', shows.length ? 'What the galleries have on the wall now, and what opens next.' : 'Galleries mount their shows here, with an opening and a close.', showSlugs.length ? showSlugs : pick(3, 6), shows.length || null)}
${door(collections.length ? '#collections' : '/collectors', 'The collectors', 'Collections', collections.length ? 'What people keep, shown by those who chose to show it.' : 'Every collection worth seeing is kept by someone. The first are forming.', collSlugs.length ? collSlugs : pick(3, 9), collections.length || null)}
</nav>`;
  // The Great Hall (Will, 18 Oct: the home page is the Met's entrance; straight up the grand staircase to the
  // masters, left into one wing, right into another, the information desk in the middle; wonder, scale, beauty).
  const stars = w => (w.curated ? 6 : 0) + (w.stars || 0);
  let masters = works.filter(w => w.curated || (w.stars || 0) >= 5);
  if (masters.length < 4) masters = masters.concat(works.filter(w => !masters.includes(w) && (w.stars || 0) >= 4));
  if (masters.length < 4) masters = masters.concat(works.filter(w => !masters.includes(w) && w.width >= 1800));
  masters = masters.filter(w => !cover || w.id !== cover.id).sort((a, b) => stars(b) - stars(a)).slice(0, 7);
  const stair = masters.find(w => w.height >= w.width) || masters[0] || cover;
  const roomCover = r => { const ws = (r.ids || []).map(id => byId[id]).filter(Boolean); return ws.slice().sort((a, b) => stars(b) - stars(a) || (b.width || 0) - (a.width || 0))[0]; };
  const wingsList = shown.slice(0, 8);
  const placeName = r => esc(r.title.replace(/^Journey Out (East|West):?\s*/, '').replace(/^Series:\s*/, ''));
  const makerRows = makerList.map(m => { const ws = works.filter(w => mOf(w).id === m.id); return { m, n: ws.length, w: ws.slice().sort((a, b) => stars(b) - stars(a))[0] }; }).sort((a, b) => b.n - a.n).slice(0, 6);
  const onView = shows.length + hangs.length;
  const hall = `<section class="ghall" id="hall"><div class="gh-in">
<header class="gh-top"><p class="k">The Great Hall</p><p class="gh-lede">Up the staircase to the masterworks. To the left, the wings, by place. To the right, the makers. In the middle, the desk: what is on today, and how to find anything.</p></header>
<div class="gh-3">
<nav class="gh-wing gh-left" aria-label="The wings"><p class="gh-dir">&larr; The wings</p>${wingsList.length ? wingsList.map(r => { const c = roomCover(r); const n = (r.ids || []).filter(id => byId[id]).length; return `<a class="gh-row" href="/rooms/${esc(r.slug)}">${c ? `<img src="/img/${esc(c.slug)}/thumb" alt="" loading="lazy" draggable="false">` : '<span></span>'}<b>${placeName(r)}</b><i>${n}</i></a>`; }).join('') : `<a class="gh-row" href="#archive"><span></span><b>The whole archive</b><i>${total}</i></a>`}<a class="gh-all" href="#wings">Walk the wings</a></nav>
${stair ? `<a class="gh-stair" href="#masterworks"><span class="gh-stair-im"><img src="/img/${esc(stair.slug)}/large" alt="${esc(tidy(stair.title))}" loading="lazy" draggable="false"></span><span class="gh-stair-t"><small>Straight ahead &middot; the grand staircase</small><b>The masterworks</b><i>${masters.length} works the makers hold highest</i></span></a>` : ''}
<nav class="gh-wing gh-right" aria-label="The makers"><p class="gh-dir">The makers &rarr;</p>${makerRows.map(({ m, n, w }) => `<a class="gh-row" href="/m/${esc(makerSlug(m))}">${m.portrait ? `<img class="gh-por" src="/portrait/${esc(m.handle)}" alt="" loading="lazy">` : w ? `<img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy" draggable="false">` : '<span></span>'}<b>${esc(m.name)}</b><i>${n}</i></a>`).join('')}<a class="gh-all" href="/artists">Every maker</a></nav>
</div>
</div></section>
<section class="gh-mw" id="masterworks"><header class="gh-mw-h"><p class="k">The grand staircase</p><h2>The masterworks.</h2><p class="gh-lede">The works their makers hold highest, hung large, with room around each.</p></header>
<div class="gh-salon">${(masters.length > 2 ? masters.filter(w => w !== stair) : masters).map((w, i) => `<a class="gh-m${i % 3 === 0 ? ' gh-m-big' : ''}" href="/w/${esc(w.slug)}" style="--r:${ratio(w).toFixed(3)}"><span class="gh-m-im"><img src="/img/${esc(w.slug)}/${i % 3 === 0 ? 'large' : 'screen'}" alt="${esc(tidy(w.title))}" loading="lazy" decoding="async" draggable="false"></span><span class="gh-m-t"><b>${esc(tidy(w.title))}</b><i>${esc([mOf(w).name, w.place].filter(Boolean).join(' · '))}</i></span></a>`).join('')}</div></section>
${wingsList.length ? `<section class="gh-wings" id="wings"><header class="gh-mw-h"><p class="k">The wings</p><h2>By place.</h2></header>${wingsList.map(r => { const c = roomCover(r); const n = (r.ids || []).filter(id => byId[id]).length; return c ? `<a class="gh-band" href="/rooms/${esc(r.slug)}"><img src="/img/${esc(c.slug)}/large" alt="" loading="lazy" draggable="false"><span class="gh-band-t"><small>${n} works</small><b>${placeName(r)}</b><i>Enter the wing</i></span></a>` : ''; }).join('')}</section>` : ''}`;
  const desk = `<div class="gh-desk" aria-label="The information desk">
${today ? `<a class="gh-cell gh-today" href="/w/${esc(today.slug)}?today=1"><img src="/img/${esc(today.slug)}/thumb" alt="" loading="lazy" draggable="false"><span><small>Today&rsquo;s work</small><b>${esc(tidy(today.title))}</b></span></a>` : ''}
<a class="gh-cell" href="${onView ? (shows.length ? '#shows' : '#walls') : '/collectors'}"><span><small>On view</small><b>${shows.length ? `${shows.length} show${shows.length === 1 ? '' : 's'}` : ''}${shows.length && hangs.length ? ', ' : ''}${hangs.length ? `${hangs.length} wall${hangs.length === 1 ? '' : 's'}` : ''}${onView ? '' : 'The galleries'}</b></span></a>
<form class="gh-cell gh-find" action="/collection" method="get" data-gh-find><label><small>Find anything</small><input type="search" name="q" placeholder="A place, a maker, a word" autocomplete="off" aria-label="Search the collection"></label></form>
<span class="gh-cell gh-ways"><small>Other ways in</small><span><a href="/stroll">Stroll</a><a href="/wander">Wander</a><a href="/vr">In a headset</a><a href="/frame">On your TV</a></span></span>
<span class="gh-cell gh-hours"><small>Open</small><b>Always, and free to look</b></span>
</div>`;
  // Grand Central (Will, 18 Oct: the front page orients everybody and routes them where they need to go): a
  // departures board, one line for each kind of visitor, the track on the right, then the desk.
  const t1 = (w) => (w ? `<img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy" draggable="false">` : '<span></span>');
  const any = n => works[n] || works[0];
  // Every line its own picture: the masterworks first, then the rest, never the same twice on the board.
  const used = new Set(); const pic = pref => { const c = [pref, ...masters, ...works].find(w => w && !used.has(w.slug)); if (c) used.add(c.slug); return c; };
  // Wilhelm at the door (Will, 20 Oct: "we do want to efficiently route people"; "everyone likes a good tour guide, who
  // is ours": Wilhelm). He asks who you are and sends you: three doors, then the smaller ways in a row. No numbers.
  const wdoors = [
    ['/stroll' + (cover ? `?at=${esc(cover.slug)}` : ''), 'I came to look.', 'Then wander. One work at a time, edge to edge; the guide if you want it, silence if you don’t.', pic(today), 'Wander'],
    ['/yours', 'I collect.', `Your gallery: what you hold, your walls, your pocket. ${total} works to choose from, each $5 to begin.`, pic(cover), 'Your gallery'],
    ['/makers#ready', 'I make things.', 'Put it in the day you make it; hang it when it is ready. The record is free and yours; the walls are by invitation.', pic(makerRows[0] && makerRows[0].w), 'Two floors'],
  ];
  const ways = [
    ['/collection', 'The collection', `the museum, ${total} works`],
    [onView ? '/collectors' : '/collectors', 'On view', onView ? `${shows.length ? `${shows.length} show${shows.length === 1 ? '' : 's'}, ` : ''}${hangs.length} wall${hangs.length === 1 ? '' : 's'}` : 'shows and walls'],
    ['/artists', 'The makers', makerList.length > 1 ? `${makerList.length} rooms` : 'the first room'],
    ['/trade', 'Editors and companies', 'search, comp, license'],
    ['/verify', 'Check a work', 'who made it, who holds it'],
    ['/find', 'Find', 'a title, a place, a maker'],
  ];
  const departures = `<section class="gc" id="board" aria-label="Where to"><div class="gh-in"><header class="gc-h gc-wil">${I.wilhelm}<div><p class="k">Wilhelm, at the door</p><h2>Who are you, today?</h2><p class="gh-lede">Tell me and I’ll send you the right way. The whole house is open; this is only the shortest road.</p></div></header>
<div class="gc-doors">${wdoors.map(([href, name, line, w, act]) => `<a class="gc-door" href="${href}"${/^\/stroll/.test(href) ? ' data-nv-wander' : ''}>${t1(w)}<b>${name}</b><i>${esc(line)}</i><span class="gc-act">${esc(act)} &rarr;</span></a>`).join('')}</div>
<nav class="gc-ways" aria-label="Other ways in"><p class="k">Or, by name</p>${ways.map(([href, name, line]) => `<a href="${href}"><b>${name}</b><i>${esc(line)}</i></a>`).join('')}</nav></div></section>`;
  const showsBand = shows.length ? `<section class="hg-band" id="shows"><div class="hg-band-in"><header class="gh"><h2>Shows</h2><a class="wk-more" href="/collectors">All the galleries</a></header><div class="hg-cards">${shows.slice(0, 3).map(h => `<a class="hg-card" href="/g/${esc(h.curator_code)}/hang/${esc(h.slug)}"><span class="hg-th">${(h.thumbs || []).map(w => `<img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy">`).join('')}</span><b>${esc(h.title)}</b><span>${esc(h.gallery || h.curator || 'A curator')}${h.venue ? ` · ${esc(h.venue)}` : ''}</span></a>`).join('')}</div></div></section>` : '';
  const collBand = collections.length ? `<section class="hg-band" id="collections"><div class="hg-band-in"><header class="gh"><h2>Collections</h2><a class="wk-more" href="/collectors">Every collection</a></header><div class="yc-cards">${collections.slice(0, 4).map(collectorCard).join('')}</div></div></section>` : '';
  return layout({
    title: front ? 'Watermark · Where great work is kept' : 'The collection · Watermark',
    desc: `${total} works held, credited and licensed on Watermark.`,
    path: '/', image: works[0] ? `/img/${works[0].slug}/screen` : null,
    body: `${cover ? `<section class="gh-hero${(cover.width || 0) < 3000 ? ' gh-small' : ''}"><img src="/img/${esc(cover.slug)}/large" srcset="/img/${esc(cover.slug)}/large 2400w, /img/${esc(cover.slug)}/wall 3840w" sizes="100vw" alt="${esc(tidy(cover.title))}" fetchpriority="high" draggable="false"><div class="gh-hero-t"><p class="gh-k">${front ? 'Watermark' : 'The collection'}</p><h1>${front ? 'Where great work is kept.' : 'Enter the museum.'}</h1><p class="gh-sub">${total} works${makerList.length > 1 ? ` by ${makerList.length} makers` : ''}, each held by the person who made it.</p><span class="gh-go"><a class="gh-wander" href="/stroll${cover ? `?at=${esc(cover.slug)}` : ''}" data-nv-wander>${WAVE_MARK}<span>Wander</span></a><a class="gh-enter" href="${front ? '#board' : '#hall'}">${front ? 'Where to?' : 'Enter'}<span aria-hidden="true">&darr;</span></a></span></div><span class="cx-cap">${esc(tidy(cover.title))}${cover.place ? ` &middot; ${esc(cover.place)}` : ''}</span></section>` : ''}<div class="cx-welcome cx-wander"><p>We recommend you wander.</p><a class="cx-wgo" href="/stroll${cover ? `?at=${esc(cover.slug)}` : ''}" data-nv-wander>${WAVE_MARK}<span>Wander</span></a><small>One work at a time, full screen. Swipe or scroll for the next.</small></div>
${front ? `${departures}<section class="gh-deskwrap"><div class="gh-in"><p class="k">The information desk</p>${desk}</div></section>` : hall}
${front ? `${showsBand}${hangs.length ? `<section class="hg-band" id="walls"><div class="hg-band-in"><header class="gh"><h2>Walls hung by people with an eye</h2><a class="wk-more" href="/collectors">All the galleries</a></header><div class="hg-cards">${hangs.slice(0, 3).map(require('./hangs').hangCard).join('')}</div><p class="note">A curator need not own a thing. <a href="/yours?tab=hangs">Hang a wall of your own</a>; collect through one and its curator earns a share, from the house.</p></div></section>` : ''}
${collBand}<section class="fy fy-home" data-for-you="6" hidden></section>
${lately.length ? `<section class="lt"><div class="lt-in"><p class="k">Lately, in the house</p><ul class="lt-l">${lately.map(({ e, line }) => `<li>${line.work ? `<a class="lt-im" href="/w/${esc(line.work.slug)}"><img src="/img/${esc(line.work.slug)}/thumb" alt="" loading="lazy" draggable="false"></a>` : `<span class="lt-im lt-none">${WAVE_MARK}</span>`}<span class="lt-t">${line.text}</span></li>`).join('')}</ul><a class="lt-more" href="/ledger">The register</a></div></section>` : ''}
<a class="sr-band" href="/series/the-great-rooms"><span class="sr-band-im"><img src="/img/the-library-stacks/thumb" alt="" loading="lazy" draggable="false"><img src="/img/behind-the-clock-at-the-musee-d-orsay/thumb" alt="" loading="lazy" draggable="false"><img src="/img/under-the-gallery-dome/thumb" alt="" loading="lazy" draggable="false"></span><span class="sr-band-t"><small>A series by Will Fullerton &middot; Krafft Studios</small><b>The Great Rooms</b><span>Domes, libraries and the light inside them. See the series &rarr;</span></span></a>
` : ''}${front ? '' : `<section class="cx-intro" id="archive"><p class="k">${makerList.length > 1 ? `${makerList.length} makers` : esc(maker.house || maker.name)}</p>
${cover ? '<h2 id="rooms">The archive.</h2>' : '<h1 id="rooms">For those who collect.</h1>'}<p class="cx-count">${total} works · ${shown.length} rooms${makerList.length > 1 ? ` · ${makerList.length} makers` : ''} · each registered to its maker and licensed at the source</p></section>
<div class="cx-bar" id="cxBar"><label class="cx-q"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg><input id="cxQ" type="search" placeholder="Search ${total} works" aria-label="Search the collection" autocomplete="off" spellcheck="false"></label>
<div class="cx-rooms" id="cxRooms"><button type="button" data-r="" aria-pressed="true">All</button>${shown.map(r => `<button type="button" data-r="${esc(r.slug)}">${esc(r.title.replace(/^Journey Out (East|West):?\s*/, ''))}</button>`).join('')}</div>
${makerList.length > 1 ? `<div class="cx-makers" id="cxMakers"><button type="button" data-mk="" aria-pressed="true">All makers</button>${makerList.map(m => `<button type="button" data-mk="${esc(makerSlug(m))}">${esc(m.name)}</button>`).join('')}</div>` : ''}
<div class="cx-view"><a class="cx-lib" href="/stroll" title="One work at a time, edge to edge; swipe for the next">Stroll</a><a class="cx-lib" href="/series/the-great-rooms" title="Work gathered in series">Series</a><a class="cx-lib" href="/journal" title="The notebook">Journal</a><a class="cx-lib" href="/frame" title="Art on your television">The frame</a><a class="cx-lib" href="/vr" title="The collection in a grand room, in a headset or the browser">In a headset</a><a class="cx-lib" href="/library" title="Books, journals, essays, papers">Library</a><a class="cx-lib" href="/open" title="Public domain and Creative Commons">Free and clear</a><button type="button" data-wander title="A work at random, then another">Wander</button><button type="button" data-v="plates" aria-pressed="true" title="Plates">Plates</button><button type="button" data-v="index" title="Index">Index</button></div><span class="cx-n" id="cxN" hidden></span></div>
<div class="cx" id="cx">${galleries}${restByMaker.filter(([m, ws]) => !(m.id === maker.id && shown.length && ws.length < 8)).map(([m, ws]) => `<section class="gal" data-room="" data-maker="${esc(makerSlug(m))}"><header class="gh"><h2>${m.id === maker.id ? (shown.length ? 'Also held' : 'Every work') : `<a href="/m/${esc(makerSlug(m))}">${esc(m.name)}</a>`}</h2><span>${ws.length}</span></header><div class="plates">${ws.map(plate).join('')}</div></section>`).join('')}${total ? '' : '<p class="empty">Nothing is held here yet.</p>'}</div>
<div class="cx-flat" id="cxFlat" hidden></div>
<div class="lb" id="lb" hidden role="dialog" aria-modal="true" aria-label="Photograph"><div class="lb-stage" id="lbStage"><img id="lbLo" alt="" draggable="false"><img id="lbImg" alt="" draggable="false"></div>
<div class="lb-top"><span id="lbPos"></span><span class="lb-act"><button type="button" id="lbFs">Full screen</button><button type="button" id="lbX" aria-label="Close">Close</button></span></div>
<div class="lb-cap"><div><b id="lbT"></b><span id="lbM"></span></div><span class="lb-act"><button type="button" id="lbVo" class="lb-vo" hidden aria-label="Listen"><i></i>Listen</button><a id="lbRec" href="#">Record</a><a id="lbLic" href="#">License</a>${share && share.price_cents != null ? `<form method="post" id="lbShare" class="lb-share"><input type="hidden" name="use" value="social"><button class="lb-seal"><span class="lb-k">${WAVE_MARK}</span>Collect</button></form>` : ''}</span></div>
<button type="button" class="lb-nav lb-prev" id="lbPrev" aria-label="Previous"></button><button type="button" class="lb-nav lb-next" id="lbNext" aria-label="Next"></button></div>
`}<script>(function(){var f=document.querySelector('[data-gh-find]'),q0=new URLSearchParams(location.search).get('q');if(q0){addEventListener('load',function(){var i=document.getElementById('cxQ');if(i){i.value=q0;i.dispatchEvent(new Event('input',{bubbles:true}));var a=document.getElementById('archive');if(a)a.scrollIntoView();}});}if(!f||!document.getElementById('cxQ'))return;f.addEventListener('submit',function(e){e.preventDefault();var q=f.q.value,i=document.getElementById('cxQ'),a=document.getElementById('archive');if(i){i.value=q;i.dispatchEvent(new Event('input',{bubbles:true}));}if(a)a.scrollIntoView({behavior:'smooth'});});})();window.__WM_SHARE=${JSON.stringify(sp)};${works.length > 300 ? `window.__WM_INDEX='/api/index.json';` : `window.__WM=${JSON.stringify(data).replace(/</g, '\\u003c')};`}</script><script src="/static/voices.js?v=${VER}" defer></script>${front ? '' : `<script src="/static/collection.js?v=${VER}" defer></script>`}${pay ? `<script>window.__WM_PAY=${JSON.stringify(pay).replace(/</g, '\\u003c')};</script><script src="/static/pay.js?v=${VER}" defer></script>` : ''}`
  });
}

const VKIND = { maker: 'The maker', historian: 'Art history', note: 'A note' };
const mmss = n => n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : '';
// Look closer: the guide on a photograph, read on the page or heard aloud. Always says it was written by AI,
// and whether the maker has read and approved it.
// The guide, as much or as little as you want (Will, 18 Oct): Off, Hints (the coach: what to look for, the why
// held back until you have looked; the wall text's first paragraph), Full. One setting for the whole house,
// remembered on the device (localStorage wm_guide, set on <html data-guide> before the page paints).
const GUIDE_SWITCH = `<div class="gd-sw" role="group" aria-label="How much of the guide"><button type="button" data-guide-set="off">Off</button><button type="button" data-guide-set="hints">Hints</button><button type="button" data-guide-set="full">Full</button></div>`;
// The study: beneath the wall text, an entry the curious can go down as far as they like (Will, 18 Oct).
const studyBlock = (c, w) => {
  const st = c && !c.studyHidden ? c.study : null; if (!st) return '';
  const sec = (k, title, inner, open) => inner ? `<details class="sd-s"${open ? ' open' : ''} id="study-${k}"><summary><span>${title}</span><i aria-hidden="true"></i></summary><div class="sd-b">${inner}</div></details>` : '';
  const P = a => a.map(x => `<p>${esc(x)}</p>`).join('');
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const read = (st.further || []).length ? st.further : [];
  return `<div class="sd" id="study"><p class="sd-k">Go further</p>
${sec('look', 'What to look for', st.look.length ? `<p class="sd-coach">Find each one in the picture before you read why.</p><ol class="sd-look">${st.look.map(x => `<li><b>${esc(x.what)}</b><span class="sd-why">${esc(x.why)}</span><button type="button" class="sd-reveal" data-sd-reveal>Why it matters</button></li>`).join('')}</ol>` : '', true)}
${sec('place', st.place ? esc(st.place.heading) : 'The place', st.place ? P(st.place.story) : '')}
${sec('making', 'How it was made', st.making.length ? P(st.making) : '')}
${sec('lineage', 'In conversation with', st.lineage.length ? `<ul class="sd-li">${st.lineage.map(x => `<li><b>${esc(x.name)}</b><span>${esc(x.why)}</span></li>`).join('')}</ul>` : '')}
${sec('words', 'Words to keep', st.words.length ? `<dl class="sd-w">${st.words.map(x => `<div><dt>${esc(x.term)}</dt><dd>${esc(x.means)}</dd></div>`).join('')}</dl>` : '')}
${sec('questions', 'To carry with you', st.questions.length ? `<ul class="sd-q">${st.questions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '')}
${sec('further', 'Read further', read.length ? `<ul class="sd-f">${read.map(x => `<li>${x.url ? `<a href="${esc(x.url)}" rel="noopener" target="_blank">${esc(x.title)}</a>` : `<i>${esc(x.title)}</i>`}${x.by ? `<span>${esc(x.by)}</span>` : ''}${x.url ? `<em>${esc(host(x.url))}</em>` : ''}</li>`).join('')}</ul>` : '')}
<p class="sd-more">${w.place ? `<a href="/stroll?q=${encodeURIComponent(String(w.place).split(',')[0])}">Stroll ${esc(String(w.place).split(',')[0])}</a>` : ''}</p>
<p class="sd-by">${st.searched ? 'Researched on the web and written with AI' : 'Written with AI from the photograph and its record'}${(st.read || []).length ? `; ${st.read.length} source${st.read.length === 1 ? '' : 's'} read` : ''}. Check what matters to you against the sources.</p></div>`;
};
const closerBlock = (c, w, edit) => {
  if (!c) return edit ? `<p class="lc-edit"><a href="/closer/${esc(w.slug)}">Look closer: write a guide for this photograph</a></p>` : '';
  const paras = String(c.text).split(/\n{2,}/).map(p => `<p>${esc(p.trim())}</p>`).join('');
  return `<section class="lc" id="closer"><button type="button" class="lc-min" data-lc-open aria-label="Open the guide"><span class="lc-min-k">${I.wilhelm}Look closer &middot; read by Wilhelm</span><span class="lc-min-t">${esc(String(c.text).split(/(?<=[.!?])\s/)[0].slice(0, 140))}</span><i aria-hidden="true">Open</i></button><div class="lc-h"><p class="k">Look closer <span class="lc-ai">${I.wilhelm}<span>Read by Wilhelm, with AI</span></span></p>${GUIDE_SWITCH}<button type="button" class="lc-say" data-say data-say-audio="/closer/${esc(w.slug)}/audio" aria-label="Hear it"><i></i><span>Hear it</span></button></div>
<div class="lc-t" data-say-text>${paras}</div><button type="button" class="lc-more" data-lc-more>Read on</button>
${c.sources && c.sources.length ? `<p class="lc-src"><b>Sources</b> ${c.sources.map(x => /^https?:\/\//.test(x) ? `<a href="${esc(x)}" rel="noopener">${esc(x.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : esc(x)).join(' &middot; ')}</p>` : ''}
${studyBlock(c, w)}
<p class="lc-by">${c.by ? `Written by ${esc(c.by)}, with AI from the photograph and its record.` : c.state === 'approved' ? 'Written with AI from the photograph and its record; read and approved by the maker.' : 'Written by AI from the photograph and its record. The maker may correct it.'}${edit ? ` <a href="/closer/${esc(w.slug)}">Edit</a>` : ''}</p></section>
<script src="/static/closer.js?v=${VER}" defer></script>`;
};
function closerEdit({ w, c, on, ok }) {
  const msg = { written: 'Written.', studied: 'The study is written.', saved: 'Saved.', failed: 'The guide could not be written just now. Try again in a minute.' }[ok];
  return layout({ title: `Look closer · ${tidy(w.title)}`, body: `<section class="narrow lc-ed">
<p class="k">Look closer</p><h1>${esc(tidy(w.title))}</h1>
<figure class="lc-fig"><img src="/img/${esc(w.slug)}/screen" alt=""></figure>
${msg ? `<p class="ok">${msg}</p>` : ''}
${!on ? `<p class="note">Guides are written once ANTHROPIC_API_KEY is set in Render.</p>` : ''}
${c ? `<form method="post" class="form"><input type="hidden" name="act" value="save">
<label>The guide, as visitors will read and hear it<textarea name="text" rows="12">${esc(c.text)}</textarea></label>
<label>Sources, one a line: a book, a catalogue entry, a monument&rsquo;s own record, a page you checked<textarea name="sources" rows="3" placeholder="Krautheimer, Rome: Profile of a City, 312–1308 (Princeton, 1980), pp. 20–25&#10;The Pantheon: pantheonroma.com">${esc((c.sources || []).join('\n'))}</textarea></label>
<label>Written by<input name="by" value="${esc(c.by || '')}" placeholder="Your name, or the writer's, as it should be credited"></label>
<p class="note">${c.state === 'hidden' ? 'Hidden from the page.' : c.state === 'approved' ? 'Approved by you.' : 'Shown as written by AI; not yet approved.'} Saving approves it.</p>
<button class="btn">Save and approve</button></form>
<div class="lc-acts"><form method="post"><input type="hidden" name="act" value="${c.state === 'hidden' ? 'show' : 'hide'}"><button class="link">${c.state === 'hidden' ? 'Show it again' : 'Hide it'}</button></form>
${on ? `<form method="post"><input type="hidden" name="act" value="write"><button class="link">Write it again</button></form><form method="post"><input type="hidden" name="act" value="study"><button class="link">${c.study ? 'Research the study again' : 'Research and write the study'}</button></form>` : ''}
${c.study ? `<form method="post"><input type="hidden" name="act" value="${c.studyHidden ? 'study-show' : 'study-hide'}"><button class="link">${c.studyHidden ? 'Show the study' : 'Hide the study'}</button></form>` : ''}</div>
${c.study && !c.studyHidden ? `<div class="lc-ed-study"><p class="k">The study, as visitors see it</p>${studyBlock(c, w)}</div>` : ''}`
  : on ? `<form method="post"><input type="hidden" name="act" value="write"><button class="btn">Write the guide</button></form>` : ''}
<p class="sr-also"><a href="/w/${esc(w.slug)}">Back to the photograph</a></p></section>` });
}

// One voice on a photograph: a round play button, who is speaking, and what they said.
const voice = v => `<div class="vo">${v.audio ? `<button type="button" class="vo-play" data-voice="/listen/${esc(v.key)}" aria-label="Listen to ${esc(v.speaker || VKIND[v.kind])}"><i></i></button>` : `<span class="vo-play vo-quiet" aria-hidden="true">&ldquo;</span>`}
<div class="vo-t"><small>${esc(VKIND[v.kind] || '')}${v.seconds ? ` &middot; ${mmss(v.seconds)}` : ''}</small><b>${esc(v.speaker || '')}${v.role ? `<span>, ${esc(v.role)}</span>` : ''}</b>
${v.body ? (v.audio ? `<details><summary>Read it</summary><p>${esc(v.body)}</p></details>` : `<p class="vo-note">${esc(v.body)}</p>`) : ''}</div></div>`;

function work({ prints = '', objectLabel = '', zoneLabel = '', bench = '', walk = null, hang = '', open = null, thanks = null, stood = null, wander = false, office = null, mkt = null, shield = null, w, maker, uses, base, rules, pay = null, held = { n: 0, shown: [] }, ed = null, patron = null, story = null, voices = [], closer = null, edit = false, mine = [], up = null, ap = null, note = null, canModerate = false, me = null }) {
  // What this visitor already holds is not offered to them again; everything else still is.
  const owns = new Set(mine.map(m => m.key)); if (mine.some(m => m.kind !== 'print')) owns.add('social');
  const allUses = uses; uses = uses.filter(u => !owns.has(u.key));
  // A work page is a catalogue entry: the photograph on its own wall, then the entry as an
  // auction house or museum would set it, then the record. Publisher tools stay folded away.
  const ratio = w.width && w.height ? `${w.width} / ${w.height}` : '3 / 2';
  const title = tidy(w.title);
  const year = w.taken_at ? String(w.taken_at).slice(0, 4) : '';
  // A catalogue note that only repeats the title ('The staircase.') is not shown.
  const bare = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const cap = w.caption && bare(w.caption) !== bare(title) && bare(w.caption).length > 12 ? w.caption : '';
  const medium = ['Digital photograph', w.camera ? `made with a ${w.camera}${w.lens && !/Q\d/.test(w.camera) ? ', ' + w.lens : ''}` : ''].filter(Boolean).join(', ');
  const dims = w.width && w.height ? `${w.width.toLocaleString('en-US')} &times; ${w.height.toLocaleString('en-US')} pixels` : '';
  const facts = [
    ['Accession', w.accession], ['Maker', maker.name], ['House', maker.house], ['Place', w.place], ['Taken', date(w.taken_at)],
    ['Camera', w.camera], ['Lens', w.lens], ['Entered', date(w.created_at)],
  ].filter(f => f[1]).map(f => `<div><dt>${f[0]}</dt><dd>${esc(f[1])}</dd></div>`).join('');
  const embed = `&lt;script src="${esc(base)}/embed.js" defer&gt;&lt;/script&gt;\n&lt;watermark-image work="${esc(w.slug)}"&gt;&lt;/watermark-image&gt;`;
  const share = uses.find(u => u.key === 'social' && u.price_cents != null);
  // The K toggles between uses: Collect is the default; the others are a tap away, and the seal commits.
  const tUses = share ? [{ k: 'social', l: 'Collect', b: ed ? `Collect No.\u00a0${ed.sold + 1}` : 'Collect', d: 'Yours to keep and to share, credited. 85% goes to the photographer.' },
    ...uses.filter(u => u !== share).map(u => ({ k: u.key, l: u.name, b: u.name, d: `${u.description} ${termText(u)}. ${u.price_cents == null ? 'Price on request.' : money(u.price_cents) + '.'}` }))] : [];
  // The seal opens a card of every way to have the photograph, the same card as the K on Krafft Studios.
  const toggle = tUses.length > 1 ? `<ul class="seal-menu" role="menu" hidden><li class="sm-h" role="presentation">Have this photograph</li>${tUses.map(u => {
    const pu = uses.find(x => x.key === u.k);
    return `<li role="none"><button type="button" role="menuitem" data-k="${esc(u.k)}"><b>${esc(u.k === 'social' ? u.b : u.l)}</b>${u.k !== 'social' && pu && pu.price_cents != null ? `<em>${money(pu.price_cents)}</em>` : ''}<i>&rsaquo;</i></button></li>`; }).join('')}</ul>` : '';
  const options = uses.filter(u => u !== share).map(u => `<a class="use" href="/license/${esc(w.slug)}?use=${esc(u.key)}"><span class="un">${esc(u.name)}</span><span class="up">${money(u.price_cents)}</span><span class="ud">${esc(u.description)} ${esc(termText(u))}.</span><span class="ua">${u.price_cents == null || u.needsMaster ? 'Ask' : u.kind === 'print' ? 'Order' : 'License'} <i></i></span></a>`).join('');
  const trade = ed && held.n && !mine.some(m => m.collector_no) ? ` <a class="lot-trade" href="/swap/new?work=${esc(w.slug)}">Offer a trade for one.</a>` : '';
  // Launch fix 1.4: no small numbers on the wall. Counts show from five; below that, names or a quiet line.
  const named = held.shown.map(c => `<a href="/g/${esc(c.code)}">${esc(c.name || 'a private collector')}</a> <small>No.&nbsp;${c.no}</small>`).join(', ');
  const keepers = held.n >= 5
    ? `In ${held.n} collections${held.shown.length ? ', among them ' + named : ''}.${trade}`
    : held.n ? `${held.shown.length ? `Collected by ${named}.` : 'In private collections.'}${trade}`
    : 'The first collector will be No.&nbsp;1.';
  return layout({
    title: `${title} · ${maker.name} · Watermark`,
    desc: `${title}, a photograph by ${maker.name}${w.place ? `, ${w.place}` : ''}. Held on Watermark; collect it at the source.`,
    path: `/m/${makerSlug(maker)}/${w.slug}`, image: `/img/${w.slug}/screen`, type: 'article', mark: markOf(maker),
    // Google Images shows a "Licensable" badge when an image carries these fields.
    jsonld: { '@context': 'https://schema.org', '@type': 'ImageObject', name: title, caption: w.caption || undefined, contentUrl: `${BASE()}/img/${w.slug}/screen`, thumbnailUrl: `${BASE()}/img/${w.slug}/thumb`,
      creator: { '@type': 'Person', name: maker.name }, creditText: `${OBJ.by(w, maker.name)}${maker.house ? ', ' + maker.house : ''}`, copyrightNotice: `© ${maker.name}`,
      copyrightHolder: { '@type': 'Person', name: maker.name }, license: `${BASE()}/terms`, acquireLicensePage: `${BASE()}/license/${w.slug}`,
      dateCreated: w.taken_at || undefined, contentLocation: w.place ? { '@type': 'Place', name: w.place } : undefined, identifier: w.accession || undefined,
      sourceOrganization: { '@type': 'Organization', name: 'Watermark', parentOrganization: { '@type': 'Organization', name: 'Krafft', url: 'https://krafftco.com' } } },
    body: `<article class="work lot">
<div class="lot-wall"><figure class="plate" style="aspect-ratio:${ratio};--ar:${w.width && w.height ? (w.width / w.height).toFixed(3) : 1.5}" data-viewer data-full="/img/${esc(w.slug)}/large" data-title="${esc(title)}" data-credit="${esc(OBJ.by(w, maker.name))}" data-place="${esc([w.place, year].filter(Boolean).join(', '))}">
<img src="/img/${esc(w.slug)}/screen" alt="${esc(title)}" draggable="false"><span class="shield"></span><button type="button" class="eye-b" data-eye="${esc(w.slug)}" aria-label="See the watermark">${require('./icons').eye}<span>Watermark</span></button></figure>
<p class="lot-hint">Tap or click the ${OBJ.kindWord(w).toLowerCase()} to see it whole.${walk ? ' Arrows walk.' : ''}</p>${objectLabel || ''}${require('./walk').walkBar(walk)}</div>
<div class="meta lot-entry">
${w.accession ? `<p class="lot-no">${esc(w.accession)}</p>` : ''}
<p class="lot-maker"><a href="/m/${esc(makerSlug(maker))}">${esc(maker.name)}</a>${maker.house ? ` <span>${esc(maker.house)}</span>` : ''}</p>
<h1 class="lot-t">${esc(title)}</h1>
<p class="lot-pl">${[w.place, year].filter(Boolean).map(esc).join(', ')}</p>
${story ? `<p class="lot-story">From <a href="${esc(story.url)}"><i>${esc(story.title)}</i></a>, Krafft Studios</p>` : ''}
<p class="lot-md">${esc(medium)}${dims ? `<br>${dims}` : ''}</p>
${zoneLabel}${ap ? `<div class="ap" id="applause"><form method="post" action="/w/${esc(w.slug)}/applaud" data-ap><button type="button" class="ap-b${ap.mine ? ' on' : ''}" aria-pressed="${ap.mine ? 'true' : 'false'}" aria-label="${ap.mine ? 'Applauded' : 'Applaud'}">${HAT}<span class="ap-r"></span></button></form><span class="ap-t" data-ap-t${ap.n < 5 ? ' hidden' : ''}><b data-ap-n>${ap.n}</b> ${ap.n === 1 ? 'tip of the hat' : 'tips of the hat'}</span>${ap.bravo ? `<form method="post" action="/w/${esc(w.slug)}/bravo" data-bv data-bv-of="${ap.bravo.of}"><button type="button" class="bv-b${ap.bravo.mine ? ' on' : ''}" aria-pressed="${ap.bravo.mine ? 'true' : 'false'}" title="Bravo! The most you can give a work: ${ap.bravo.of} a month" aria-label="Bravo">${I.bravo}</button></form><span class="bv-t" data-bv-t${ap.bravo.n ? '' : ' hidden'}>${ap.bravo.n === 1 ? 'One bravo' : `${ap.bravo.n} bravos`}</span>` : ''}${share && !open && !(ed && !ed.left) ? `<button type="button" class="ap-col" data-collect-now title="Collect it: yours to keep, credited${thanks && thanks.pocket >= share.price_cents ? ', one tap from your pocket' : ''}">${I.collect}<span>Collect</span><em>${money(share.price_cents)}</em></button><script>(function(){var b=document.querySelector('[data-collect-now]');if(!b)return;b.addEventListener('click',function(){var f=document.querySelector('form[data-share]');if(!f)return;if(f.requestSubmit)f.requestSubmit();else f.submit();});})();</script>` : ''}</div>${ap.bravo ? `<p class="bv-say" data-bv-say hidden></p>` : ''}<a class="ap-b ap-study" href="/easel/${esc(w.slug)}" title="The easel: study it, draw it, paint it">${I.wilhelm}<span>Study</span></a><p class="ap-why"><b>Hat</b> is a nod: <i>I saw it.</i> <b>Bravo</b> is a shout: <i>it floored me.</i> Hats are free; three bravos a month.</p>` : ''}
${isRegistered(w) ? `<div class="lot-mst">${regTag(w, 'crt-lg')}<p>Registered with the U.S. Copyright Office. Search the public record at <a href="https://publicrecords.copyright.gov/" rel="noopener">publicrecords.copyright.gov</a>.</p></div>` : office ? `<p class="lot-office">${esc(office.line)} <a href="/copyright">How it works</a>.</p>` : ''}
${isReference(w) ? `<div class="lot-mst">${refTag(w, 'mst-lg')}<p>A reference image: the full original, ${w.width.toLocaleString('en-US')} &times; ${w.height.toLocaleString('en-US')} pixels${w.camera ? `, from a ${esc(w.camera)}` : ''}, straight from the camera file. It is what collectors and licensees receive, sealed and signed, and large enough to print on a wall.</p></div>` : ''}
${w.note ? `<section class="mn" id="note"><p class="k">The maker&rsquo;s note</p>${String(w.note).split(/\n{2,}/).map(p => `<p>${esc(p.trim())}</p>`).join('')}<p class="mn-by">${esc(maker.name)}</p></section>` : ''}${closerBlock(closer, w, edit)}${wander ? `<a class="wd-on" href="/wander?from=${esc(w.slug)}">${WAVE_MARK}<span>Wander on</span></a>` : ''}
${voices.length ? `<div class="vo-list">${voices.map(voice).join('')}</div>` : ''}
${w.disputed ? `<p class="wk-claim">Under review: a claim about this photograph is with the house. It is shown, and nothing is sold, until the house decides.</p>` : ''}
${shieldBlock(shield, { slug: w.slug })}
${hang}
<p class="wk-claim-door"><a href="/w/${esc(w.slug)}/claim">Is this yours, or are you in it? Say so.</a></p>
<p class="lot-keep">${keepers}</p>
${ed ? `<p class="lot-ed"><b>Edition of ${ed.size}</b><span>${ed.left ? `${ed.left} of ${ed.size} remain` : 'Complete. Every number is held.'}${share && share.ladder && share.ladder.step ? ` &middot; issued at ${money(share.ladder.base)} to No.&nbsp;1, ${money(share.ladder.price)} now` : ''}${share && share.ladder && share.ladder.next && ed.left ? ` &middot; ${money(share.ladder.next)} from No.&nbsp;${share.ladder.at + 1}` : ''}</span></p>` : ''}
${share && ed && !ed.left ? `<p class="lot-gone">This edition is complete. It can pass to you only from one of its collectors${mkt && mkt.open.length ? '' : '; none is offered just now'}.</p>` : ''}
${ed && mkt && (mkt.open.length || mkt.p.trades || mkt.held) ? `<div class="lot-mk" id="market"><p class="k">On the market</p>${mkt.open.map(o => `<a href="/market/${o.id}"><span>No.&nbsp;${o.collector_no} of ${ed.size}</span><b>${money(o.ask_cents)}</b><i>&rsaquo;</i></a>`).join('')}${mkt.p.trades ? `<p class="lot-mk-h">Last traded at ${money(mkt.p.last)}, ${date(mkt.p.lastAt)}${mkt.p.issue != null ? `; issued at ${money(mkt.p.issue)}` : ''}. <a href="/w/${esc(w.slug)}/life">Its history</a></p>` : ''}
${mkt.held ? (mkt.sent === 'sent' ? '<p class="ok">Your offer is with its collectors. If one accepts, Watermark writes to you to settle it.</p>' : `<details class="lot-of"${mkt.sent ? ' open' : ''}><summary>Make an offer to its collectors</summary><form method="post" action="/w/${esc(w.slug)}/offer" class="form">${mkt.sent === 'check' ? '<p class="err">An email and an amount, please.</p>' : mkt.sent === 'none' ? '<p class="err">No collector holds that number.</p>' : ''}<label>Your offer, in dollars<input name="offer" inputmode="decimal" required placeholder="${mkt.p.value ? (mkt.p.value / 100).toFixed(0) : ''}"></label><label>For number<select name="no"><option value="">Any number</option>${mkt.nos.map(n => `<option value="${n}">No. ${n}</option>`).join('')}</select></label><label>Your name<input name="name" autocomplete="name"></label><label>Email<input name="email" type="email" required autocomplete="email"></label><button>Send the offer</button><small>${mkt.held} collector${mkt.held === 1 ? ' holds' : 's hold'} a number. Nothing is charged now.</small></form></details>`) : ''}</div>` : ''}
${mine.length ? `<section class="lot-yours" id="yours"><p class="k">In your gallery</p>
${up === '1' ? '<p class="ok">It is on the market. It stays in your gallery until it sells.</p>' : up === 'price' ? '<p class="err">Give it a price of at least $1.</p>' : ''}
${mine.map(m => `<div class="ly-row"><div class="ly-t"><b>${m.key === 'social' ? 'Collected' : esc(m.name)}</b><span>${m.collector_no ? `<i class="no">No.&nbsp;${m.collector_no}${ed ? `<small>&thinsp;/&thinsp;${ed.size}</small>` : ''}</i>` : ''}${m.collector_no && (m.ends_at || m.kind === 'print') ? ' &middot; ' : ''}${m.ends_at ? `until ${date(m.ends_at)}` : m.kind === 'print' ? 'a print, yours to keep' : m.collector_no ? '' : 'yours to keep'}</span></div>
<div class="ly-a">${m.download_token && m.kind !== 'print' ? (m.dl && !m.dl.left ? '<span>Downloads used</span>' : `<a href="/d/${esc(m.download_token)}">Download</a>${m.key !== 'social' ? `<a href="/d/${esc(m.download_token)}?size=share">Share size</a>` : ''}`) : ''}<a href="/c/${esc(m.ref)}${m.download_token ? `?k=${esc(m.download_token)}` : ''}">License</a>${m.dl ? `<small>${m.dl.left} of ${m.dl.limit} downloads left</small>` : ''}</div>
${ed && m.collector_no ? (m.listed != null ? `<form method="post" action="/yours/offer/withdraw" class="ly-up"><input type="hidden" name="ref" value="${esc(m.ref)}"><input type="hidden" name="back" value="/w/${esc(w.slug)}"><span>Offered at <b>${money(m.listed)}</b></span><button class="link">Withdraw</button></form>`
  : `<details class="ly-up"><summary>Put it up for sale</summary><form method="post" action="/yours/offer" class="ly-f"><input type="hidden" name="ref" value="${esc(m.ref)}"><input type="hidden" name="back" value="/w/${esc(w.slug)}"><label>Your asking price<span class="ly-in"><i>$</i><input name="ask" inputmode="decimal" required placeholder="${mkt && mkt.p && mkt.p.value ? (mkt.p.value / 100).toFixed(0) : ''}"></span></label><button class="btn">Offer it on the market</button><p class="note">It stays in your gallery until it sells. The photographer receives 10% of the price; Watermark keeps 5%.</p></form></details>`) : ''}</div>`).join('')}
${uses.length ? `<p class="ly-more">Also available to you: ${uses.map(u => `<a href="/license/${esc(w.slug)}?use=${esc(u.key)}">${esc(u.name)}</a>`).join(', ')}.</p>` : ''}</section>` : ''}
${open ? `<section class="op" id="open"><p class="k">Free and clear · ${esc(open.name)}</p><p class="op-say">${esc(open.says)}</p>
<p class="op-act"><a class="buy-btn" href="/open/${esc(w.slug)}/take">Take the original</a></p>
<p class="op-credit"><span class="k">Credit</span><code>${esc(open.credit)}</code></p>
<p class="note">Held, fingerprinted and conserved here like everything else; <a href="${esc(open.url)}" rel="noopener">the licence</a> says what you may do. If you love it, there is a card below.</p></section>` : ''}
${share && !open && !(ed && !ed.left) ? `<form method="post" action="/buy/${esc(w.slug)}" class="share-buy" data-share="${esc(w.slug)}" data-title="${esc(title)}" data-amount="${share.price_cents}"${thanks && thanks.pocket >= share.price_cents ? ' data-pocket="1"' : ''}><input type="hidden" name="use" value="social">${thanks && thanks.pocket >= share.price_cents ? '<input type="hidden" name="from" value="pocket">' : ''}<div class="seal-row">${toggle}${seal(maker, `Collect ${title}`)}<div class="seal-t"><b>${ed ? `Collect No.&nbsp;${ed.sold + 1}` : 'Collect'}<em>${money(share.price_cents)}</em></b><span>Yours to keep and to share, credited. 85% goes to the photographer.${thanks && thanks.pocket >= share.price_cents ? ' From your pocket, one tap.' : ''}</span>${tUses.length > 1 ? `<button type="button" class="sm-more" data-sm aria-haspopup="menu">Other ways to have it<i aria-hidden="true"></i></button>` : ''}</div></div></form>${pay ? `<script>window.__WM_PAY=${JSON.stringify(pay).replace(/</g, '\\u003c')};</script><script src="/static/pay.js?v=${VER}" defer></script>` : ''}` : ''}
${thanks ? `<section class="ty" id="thanks"><div class="ty-card"><p class="k">A thank-you card</p>
${thanks.state === 'given' ? `<p class="ty-done">Sent. ${esc(maker.name.split(' ')[0])} will see it.</p>` : thanks.state === 'off' || thanks.state === 'unavailable' ? '<p class="ty-done">Not just now; the till is closed.</p>' : ''}
<form method="post" action="/w/${esc(w.slug)}/thanks" class="ty-f"><p class="ty-say">Say thank you to ${esc(maker.name.split(' ')[0])}.</p>
<div class="ty-amts">${thanks.amounts.map((c, i) => `<label><input type="radio" name="amount" value="${c}" ${i === 0 ? 'checked' : ''}><span>${c < 100 ? `${c}¢` : `$${(c / 100).toFixed(2)}`}</span></label>`).join('')}<label class="ty-own"><input type="radio" name="amount" value="own"><span>$<input name="own" inputmode="decimal" placeholder="your own" aria-label="Your own amount"></span></label></div>
<input name="word" class="ty-word" placeholder="A word, if you like" maxlength="280" autocomplete="off">
<button class="ty-go" ${thanks.on || thanks.pocket > 0 ? '' : 'disabled'}>Send it</button>${thanks.pocket > 0 ? `<em class="ty-pk">From your pocket, ${money(thanks.pocket)} in it.</em>` : `<em class="ty-pk"><a href="/yours?tab=settings#pocket">Fill a pocket</a> and cards go with one tap.</em>`}
<small>Nothing to keep, nothing to download: an expression. The house keeps none of it; after the card fee it is ${esc(maker.name.split(' ')[0])}'s.${thanks.n ? ` ${thanks.n} ${thanks.n === 1 ? 'person has' : 'people have'} said thank you.` : ''}</small></form></div></section>` : ''}
${patron ? `<p class="pat-line"><a href="/m/${esc(patron)}#patron">Become a patron of ${esc(maker.name)}</a><span>Keep the work going, monthly or once.</span></p>` : ''}
${share && !(ed && !ed.left) ? `<script>(function(){var f=document.querySelector('[data-share]');if(!f||matchMedia('(hover:hover)').matches)return;var shown=false;f.addEventListener('click',function(e){if(shown)return;if(!e.target.closest('button.seal'))return;e.preventDefault();e.stopImmediatePropagation();f.classList.add('px-on');shown=true;setTimeout(function(){f.classList.remove('px-on');shown=false},3500)},true)})();</script>` : ''}
${share && !open ? `<details class="more-uses"><summary>Other uses <span>In a story, for a company, before an audience, a print</span></summary><div class="uses">${options}</div></details>` : `<h2>Use this photograph</h2><div class="uses">${options}</div>`}
${prints}
</div></article>
<section class="lot-rec">
${cap ? `<div class="lot-sec"><h2>Catalogue note</h2><p class="cap">${esc(cap)}</p></div>` : ''}
${ap ? `${stood ? `<p class="lot-stood"><span data-stood ${stood.mine && stood.mine <= stood.first ? '' : 'hidden'}>${stood.mine && stood.mine <= stood.first ? `You were the ${stood.ord(stood.mine)} person to stand in front of this.` : ''}</span><small>${stood.n >= 5 ? `${stood.n} people have stood in front of this photograph.` : 'Be among the first to stand in front of this photograph.'}</small></p>` : ''}
${bench ? `<div class="lot-sec bn-sec">${bench}<p class="bn-sec-l">The talk is in the Keys, one door from the wall: what the members say, signed, with the maker reading.</p></div>` : ''}
<div class="lot-sec nt" id="notes"><h2>Guest book</h2><p class="nt-h">You are a guest in ${esc(maker.name)}&rsquo;s studio. Sign as you would in someone&rsquo;s home: your name, and what you would say to them standing in front of the picture. ${esc(maker.name.split(' ')[0])} reads every line, and marks the ones that saw something.</p>
<p class="nt-ep">It is easy to be clever about a picture and hard to be useful to the person who made it. A line here costs nothing to write and is kept for good, under your name. Write the one you would want to find beneath your own work.</p>
${note === '1' ? '<p class="ok">Signed.</p>' : note === 'check' ? '<p class="err">A sentence and your name, please, without links.</p>' : note === 'kind' ? '<p class="err">Not in this house. Say it as you would to their face.</p>' : note === 'slow' ? '<p class="err">A moment, please.</p>' : ''}
${ap.notes.length ? `<ol class="gb">${ap.notes.slice().reverse().map(n => `<li><span class="gb-d">${date(n.at)}</span><p class="gb-p">${esc(n.body)}</p><span class="gb-s">${n.public && n.code ? `<a href="/collector/${esc(n.code)}">${esc(n.name || 'A visitor')}</a>` : esc(n.name || 'A visitor')}${n.regard ? `<small class="gb-rg" title="Lines makers have marked well seen">${n.regard} well seen</small>` : ''}</span>${n.seen_at ? `<span class="gb-ws">${HAT}Well seen, says ${esc(maker.name.split(' ')[0])}</span>` : ''}${canModerate ? `<form method="post" action="/w/${esc(w.slug)}/notes/${n.id}/seen" class="gb-rm gb-sn"><button class="link">${n.seen_at ? 'Unmark' : 'Well seen'}</button></form>` : ''}${canModerate || (me && n.buyer_id === me) ? `<form method="post" action="/w/${esc(w.slug)}/notes/${n.id}/remove" class="gb-rm"><button class="link" aria-label="Remove this line">Remove</button></form>` : ''}</li>`).join('')}</ol>` : '<p class="nt-0">The book is open. No one has signed yet.</p>'}
<form method="post" action="/w/${esc(w.slug)}/notes" class="gb-f"><label class="gb-l"><span>A line for the book</span><textarea name="body" rows="2" maxlength="280" placeholder="What you saw in it, or where it took you." required></textarea></label><div class="gb-row"><label class="gb-l gb-n"><span>Signed</span><input name="name" placeholder="Your name" maxlength="60" required autocomplete="name"></label><button class="btn">Sign the book</button></div></form></div>` : ''}
<div class="lot-sec"><h2>Provenance and record</h2><dl class="facts">${facts}</dl>
<p class="note"><a href="/w/${esc(w.slug)}/life">The life of this photograph</a>: its registration and every license since, recorded in the <a href="/ledger">register</a>.</p>
${rules && rules.never.length ? `<p class="never"><span>The maker says never</span>${rules.never.map(k => esc(NEVER[k])).join(' &middot; ')}</p>` : ''}</div>
<details class="lot-fold"><summary>For publishers</summary><p class="note">Embed it with credit. Every license is written in plain language, carries its own reference, and is recorded on the ledger.</p><pre class="code">${embed}</pre>
<p class="fp">Fingerprint <code>${esc(w.sha256.slice(0, 16))}&hellip;</code>${w.source_url ? ` &middot; <a href="${esc(w.source_url)}" target="_blank" rel="noopener">See where it was published</a>` : ''}</p></details>
<details class="lot-fold report" id="report"><summary>Seen this photograph used somewhere?</summary>
<form method="post" action="/report/${esc(w.slug)}" class="form"><label>Where you saw it<input name="url" type="url" required placeholder="https://"></label>
<label>A note (optional)<input name="note"></label><label>Your email, if the maker may write back (optional)<input name="email" type="email"></label><button>Tell the maker</button></form></details>
</section>
<script>window.__WM_GUARD=${JSON.stringify({ slug: w.slug, accession: w.accession || null, maker: maker.name, wave: WAVE_MARK.match(/d="([^"]+)"/)[1], capture: `/w/${w.slug}/capture`, stood: `/w/${w.slug}/stood`, collect: share ? `/license/${w.slug}` : null, price: share ? money(share.price_cents) : null, easel: `/easel/${w.slug}` }).replace(/</g, '\\u003c')};</script>${['hat','hang','collect','guide','back','next','close','wilhelm'].map(k => `<template data-ic="${k}">${I[k]}</template>`).join('')}<script src="/static/guard.js?v=${VER}" defer></script><script src="/static/viewer.js?v=${VER}" defer></script><script src="/static/hang.js?v=${VER}" defer></script><script src="/static/walk.js?v=${VER}" defer></script><script src="/static/applause.js?v=${VER}" defer></script><script src="/static/bravo.js?v=${VER}" defer></script>${voices.length ? `<script src="/static/voices.js?v=${VER}" defer></script>` : ''}`
  });
}

function licenseForm({ w, maker, uses, chosen, error, values = {}, renews }) {
  const opts = uses.map(u => `<label class="opt"><input type="radio" name="use" value="${esc(u.key)}" ${u.key === chosen ? 'checked' : ''} required><span><b>${esc(u.name)}</b> &middot; ${money(u.price_cents)}<br><small>${esc(u.description)} ${esc(termText(u))}.</small></span></label>`).join('');
  return layout({
    title: `License ${w.title} · Watermark`,
    body: `<section class="lic">
<div class="lic-fig"><img src="/img/${esc(w.slug)}/screen" alt="${esc(w.title)}" draggable="false"><p class="cap"><b>${esc(w.title)}</b><br>Photograph by ${esc(maker.name)}</p></div>
<form method="post" action="/license/${esc(w.slug)}" class="form">
<p class="k">License a work</p><h1>Use it properly. Pay the person who made it.</h1>
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
  // Launch fix 3.3: the demo is a flagship plate with a full record (a place, a size), never an orphan.
  const full = w => w !== hero && w.place && (w.width || 0) >= 1200;
  const demo = works.find(w => w.slug === 'the-staircase') || works.find(w => full(w) && (w.curated || w.stars >= 4)) || works.find(full) || works[1] || works[0];
  const strip = works.slice(0, 8).map(w => `<a href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" loading="lazy" draggable="false"></a>`).join('');
  const price = k => { const u = uses.find(x => x.key === k); return u ? money(u.price_cents) : ''; };
  return layout({
    title: 'For those who make · Watermark',
    desc: 'Hold your work, set your terms, and get paid the moment someone uses it properly.',
    path: '/', image: hero ? `/img/${hero.slug}/screen` : null,
    jsonld: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Watermark', url: BASE(), logo: `${BASE()}/static/watermark-logo.svg`, slogan: 'Leave your mark.', description: 'Hold, show, license and protect art at the source.', parentOrganization: { '@type': 'Organization', name: 'Krafft', url: 'https://krafftco.com' } },
    body: `<section class="h-hero">${hero ? `<img src="/img/${esc(hero.slug)}/large" alt="" draggable="false">` : ''}<div class="h-shade"></div>
<div class="h-in"><p class="k">Watermark</p><h1>For those who make.</h1>
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
<button type="button" class="h-row" role="switch" aria-checked="true"><span>In a story</span><i></i></button><button type="button" class="h-row" role="switch" aria-checked="true"><span>For a company</span><i></i></button><button type="button" class="h-row" role="switch" aria-checked="false"><span>Before an audience</span><i></i></button><button type="button" class="h-row" role="switch" aria-checked="true"><span>On a wall</span><i></i></button><button type="button" class="h-row h-sep" role="switch" aria-checked="false" data-approve><span>Approve each license myself</span><i></i></button>
<p class="h-ck">Never for</p><div class="h-tags"><button type="button" aria-pressed="true">Training AI</button><button type="button" aria-pressed="true">Political campaigns</button><button type="button" aria-pressed="true">Altering the image</button><button type="button" aria-pressed="false">Tobacco, firearms or gambling</button></div>
<p class="h-sum" aria-live="polite"></p></div>
<ul class="h-list">
<li><b>Choose the uses.</b> Open a photograph to stories and companies and close it to campaigns. Each work can have its own terms.</li>
<li><b>Set the price.</b> Public, fixed and yours. Collectors see it before they decide, so nobody has to ask.</li>
<li><b>Approve every sale, or none.</b> Let licenses happen on their own, or see each one before it is granted.</li>
<li><b>Say never.</b> Not for AI training. Not for politics. Not altered. Your conditions are written into the license, the certificate and the file itself.</li>
<li><b>Credit, always.</b> Your name travels with the photograph wherever it is embedded or delivered.</li>
</ul><script>(function(){var c=document.querySelector('.h-card');if(!c)return;var sum=c.querySelector('.h-sum');
function lst(a){return a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1]}
function say(){var on=[].map.call(c.querySelectorAll('.h-row[aria-checked=true]:not([data-approve])'),function(b){return b.textContent.trim().toLowerCase()}),no=[].map.call(c.querySelectorAll('.h-tags [aria-pressed=true]'),function(b){var t=b.textContent.trim();return t.charAt(0).toLowerCase()+t.slice(1)}),ap=c.querySelector('[data-approve]').getAttribute('aria-checked')==='true';
sum.textContent=(on.length?'Open '+lst(on)+'. ':'Closed to every use. ')+(on.length?(ap?'You approve each license. ':'Licenses happen on their own. '):'')+(no.length?'Never for '+lst(no)+'.':'')}
c.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;if(b.getAttribute('role')==='switch')b.setAttribute('aria-checked',b.getAttribute('aria-checked')==='true'?'false':'true');else b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')==='true'?'false':'true');say()});say()})();</script></div></section>

<section class="h-sec"><p class="k">Protection</p><h2 class="h2">Protected by design, not by a stamp across the middle.</h2>
<div class="h-6">
<div><h3>Sealed when it travels.</h3><p>Only screen-sized copies are shown. When the full file must travel, it goes sealed: it opens only in Watermark, every opening is counted, and you can close it at any time.</p></div>
<div><h3>Fingerprinted on arrival.</h3><p>Every original is fingerprinted and written into a public register that cannot be quietly edited.</p></div>
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

<section class="h-sec h-num"><p class="h-big">85%</p><div><h2 class="h2">Of every license goes to the maker.</h2><p>Watermark&rsquo;s share covers payment, delivery, the record and the protection. You own your work, your buyers and your record of sales.</p></div></section>

<section class="h-sec h-by"><p class="k">By image makers</p><h2 class="h2">Built by a photographer, for photographers.</h2>
<p class="h-p">The idea for Watermark began seven years ago with a simple frustration: the photographs travelled and the photographer didn&rsquo;t. It is built by Krafft, a creative company, and its first collection is our own. We built it the way we wanted to be treated: credited, asked, and paid.</p>
${strip ? `<div class="h-strip">${strip}</div><p><a class="h-ln h-ln-d" href="/collection">See the collection</a></p>` : ''}</section>

<section class="h-sec h-two" id="ready"><p class="k">Two floors</p><h2 class="h2">Put it in the day you make it. Hang it when it is ready.</h2>
<div class="h-3 h-two-g"><div><h3>The record</h3><p>Open to everyone, free, from the first frame. Every work you bring in is kept, fingerprinted, deeded and yours; nothing is shown and nothing is sold. It is the frame on your own wall: your work, treated as worth making. <a href="/own">You already own it</a>.</p></div>
<div><h3>The moment</h3><p>The stock agencies once made a living possible for anyone whose work was good enough. There is a moment when work is ready to be shown, when people will pay for it. The house reads it from what it can see: a body of work, an edit you made yourself, professional files, a page and your prices. Then it looks at your edit, large, and writes back within the month.</p></div>
<div><h3>The house</h3><p>By invitation. Hung in the collection, in the walks and the stroll, licensed and collected on your terms, 85% of every sale yours. The house has its own eye and never tells you what to make; it looks for craft, honesty and a body of work, and it hangs your first show itself.</p></div></div>
<p class="h-cta"><a class="h-btn h-btn-d" href="/record">Begin the record</a><a class="h-ln h-ln-d" href="#apply">Or apply to the house now</a></p></section>

<section class="h-sec h-apply" id="apply"><p class="k">Hold your work here</p><h2 class="h2">We are opening Watermark to a small group of makers first.</h2>
<p class="h-in-already">Already a Watermark maker? <a href="/signin">Sign in to your room</a>.</p>
${sent ? '<p class="h-sent">Thank you. We read every application and will write to you personally.</p>' : `<form method="post" action="/apply" class="h-form">
<label>Name<input name="name" required autocomplete="name"></label>
<label>Email<input name="email" type="email" required autocomplete="email"></label>
<label>Where we can see your work<input name="portfolio" type="url" placeholder="https://"></label>
<label>What you make<select name="practice"><option>Photography</option><option>Illustration</option><option>Fine art</option><option>Film and stills</option><option>Something else</option></select></label>
<label class="h-wide">Anything we should know<textarea name="note" rows="3"></textarea></label>
<p class="h-wide h-note">Watermark holds photographs, illustration, fine art and film stills, made by you and yours to license. It does not hold stock, work made by AI, or work you do not own.</p>
<button class="h-btn h-btn-d h-wide" type="submit">Apply</button></form>`}</section>`
  });
}

// A photograph's record: its title, its terms, and every license in its life.
function life({ w, maker, lic, reg, rules, ed = null, prints = [], moves = [], shield = null, trades = [], chart = '' }) {
  const earned = lic.reduce((a, l) => a + (l.price_cents || 0), 0);
  const rows = lic.map(l => `<li><span>${date(l.starts_at)}</span><b>${esc(l.use_name)}</b><em>${l.collector_no ? `Collector No. ${l.collector_no}${ed ? ' of ' + ed.size : ''}` : l.status === 'active' ? `Active${l.ends_at ? ' until ' + date(l.ends_at) : ''}` : 'Completed'}</em>${rules.showEarned ? `<i>${money(l.price_cents)}</i>` : ''}<a href="/verify?ref=${esc(l.ref)}">${esc(l.ref)}</a></li>`).join('');
  return layout({ title: `The life of ${w.title} · Watermark`, body: `<section class="lifep">
<div class="life-h"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(w.title)}" draggable="false"><div><p class="k">The life of a work</p><h1>${esc(w.title)}</h1>
<p class="by">Made by ${esc(maker.name)}${w.taken_at ? `, ${date(w.taken_at)}` : ''}. Rights held by ${esc(maker.name)}.</p></div></div>
${shieldBlock(shield, { open: true })}
${trades.length ? `<section class="life-tr"><h2>Traded between collectors</h2>${chart || ''}<ul>${trades.map(t => `<li><span>${date(t.at)}</span><b>No. ${t.collector_no}${ed ? ' of ' + ed.size : ''}</b><em>${money(t.price_cents)}</em></li>`).join('')}</ul></section>` : ''}
<div class="stats">${ed ? `<div><b>${ed.sold} of ${ed.size}</b><span>collected</span></div>` : ''}<div><b>${lic.length}</b><span>times licensed</span></div>${prints.length ? `<div><b>${prints.length}</b><span>prints made</span></div>` : ''}${rules.showEarned ? `<div><b>${money(earned)}</b><span>earned for its maker</span></div>` : ''}<div><b>${date(w.created_at)}</b><span>registered</span></div></div>
<ol class="life-l"><li><span>${date(w.created_at)}</span><b>Entered into Watermark</b><em>Fingerprint ${esc(w.sha256.slice(0, 16))}&hellip;</em>${reg ? `<a href="/ledger">Ledger ${reg.seq}</a>` : ''}</li>${rows}${prints.map(p => `<li><span>${date(p.created_at)}</span><b>Printed by collector No. ${p.collector_no}</b><em>${esc([p.size, p.paper, p.made].filter(Boolean).join(', '))}</em></li>`).join('')}${moves.map(m => `<li><span>${date(m.claimed_at)}</span><b>No. ${m.collector_no} passed to a new collector</b><em>Same number, new hands</em></li>`).join('')}</ol>
<p class="note">Collectors are not named. Each reference can be checked by anyone at <a href="/verify">/verify</a>.</p>
<p><a class="btn" href="/license/${esc(w.slug)}">License this photograph</a></p></section>` });
}

// The viewer for sealed files.
function viewer() {
  return layout({ title: 'Open a sealed file · Watermark', desc: 'Open a work sealed on Watermark.', body: `<section class="sv">
<div class="sv-intro"><p class="k">Watermark viewer</p><h1>Open a sealed work.</h1>
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

// Where it will live: each use drawn as a place, the photograph at the centre of it.
// The wall hangs the whole picture at its true proportions; the billboard and the screens crop it as they would.
function scenes(w, maker) {
  const r = w.width && w.height ? w.width / w.height : 1.5;
  let hp = 46, wp = hp * 0.75 * r; if (wp > 52) { wp = 52; hp = wp / (0.75 * r); }
  const t = esc(tidy(w.title)), by = esc(maker.name);
  const yr = String(w.taken_at || w.created_at || '').slice(0, 4);
  return `<div class="ls-sc ls-social" data-sc="social"><div class="pd"><i class="pd-is"></i><div class="pd-st"><span>9:41</span><span class="pd-bt"></span></div>
<div class="pd-top"><i></i><b>yourname</b></div><div class="ph"></div>
<div class="pd-cap"><p><b>yourname</b> Evening, ${w.place ? esc(String(w.place).split(',')[0]) : 'abroad'}.</p><span>Photograph by ${by}</span></div></div></div>
<div class="ls-sc ls-story" data-sc="editorial"><div class="sp"><div class="sp-l"><div class="ph"></div><span class="sp-cr">Photograph: ${by}</span></div>
<div class="sp-r"><span class="kk">The feature</span><span class="hh">${t}</span>${w.place ? `<span class="dk">${esc(w.place)}</span>` : ''}
<span class="tx"><i></i><i></i><i></i><i></i><i style="width:82%"></i><i></i><i></i><i style="width:64%"></i></span><span class="fo">${yr || ''} &middot; 14</span></div></div></div>
<div class="ls-sc ls-co" data-sc="commercial"><div class="br"><div class="bar"><i></i><i></i><i></i><u>halden.com</u></div>
<div class="site"><div class="ph"></div><div class="nav"><b>Halden</b><span>Work</span><span>Studio</span><span>Journal</span><span>Contact</span></div>
<div class="hd">Made to be lived with.</div><span class="crd">Photograph: ${by}</span></div></div></div>
<div class="ls-sc ls-aud" data-sc="campaign"><i class="sky"></i><i class="gr"></i>
<div class="bb"><div class="ph"></div><span class="mk">Halden</span></div><i class="lg l1"></i><i class="lg l2"></i></div>
<div class="ls-sc ls-wall" data-sc="print"><i class="spot"></i>
<div class="fr" style="left:${(50 - wp / 2).toFixed(2)}%;top:${(40 - hp / 2).toFixed(2)}%;width:${wp.toFixed(2)}%;height:${hp.toFixed(2)}%"><div class="ph"></div></div>
<i class="fl"></i></div>`;
}

// The contract, as numbered sections (src/contract.js), set like a printed agreement.
const contractBody = sections => `<div class="ct">${sections.map(x => `<section class="ct-s">${x.h ? `<h3><span>${esc(x.n)}.</span> ${esc(x.h)}</h3>` : ''}${(x.p || []).map(p => `<p${x.caps ? ' class="ct-caps"' : ''}>${esc(p)}</p>`).join('')}
${(x.sub || []).map(y => `<div class="ct-sub"><p${y.caps ? ' class="ct-caps"' : ''}><b>${esc(y.n)}&ensp;${esc(y.h)}.</b> ${esc((y.p || []).join(' '))}</p>${y.items ? `<ol class="ct-items">${y.items.map(i => `<li>${esc(i)}</li>`).join('')}</ol>` : ''}</div>`).join('')}</section>`).join('')}</div>`;
function contractPage({ sections, w, maker, u, t, preview = false, lic = null }) {
  const C = require('./contract');
  const has = C.RIGHTS.filter(r => t.rights.includes(r.key)).map(r => r.label);
  return layout({ title: `${preview ? 'The agreement' : 'Agreement ' + lic.ref} · ${tidy(w.title)}`, body: `<section class="ct-wrap">
<p class="k">${preview ? 'The agreement, as it would read' : `Agreement ${esc(lic.ref)}`}</p>
<h1>Standard Content License Agreement</h1>
<p class="ct-for"><i>${esc(tidy(w.title))}</i>, photograph by ${mlink(maker.name)} &middot; ${esc(u.name)}${t.price != null && !t.ask ? ` &middot; ${money(t.price)}` : ''}</p>
<div class="ct-sum"><div><span>Granted</span>${has.length ? has.map(esc).join(', ') : u.kind === 'print' ? 'A physical print' : 'Personal use'}${t.extras.length ? `; ${t.extras.map(k => esc(C.EXTRAS.find(e => e.key === k).label)).join(', ')}` : ''}</div>
<div><span>Term</span>${t.term_months ? `${t.term_months / 12 === 1 ? '1 year' : t.term_months + ' months'}` : 'Perpetual'}</div>
<div><span>Never</span>${t.never.length ? t.never.map(k => esc(require('./rules').NEVER[k])).join('; ') : 'No further restrictions'}</div></div>
${contractBody(sections)}
<p class="note">${preview ? 'Assembled from the rights chosen. The agreement you accept at checkout is this text, with your name and order added.' : 'Accepted at checkout and recorded on the ledger.'} Drafted with counsel; under review.</p>
<p class="sr-also"><a href="/w/${esc(w.slug)}">The photograph</a></p></section>` });
}

// The rights in the contract: what the chosen use carries, what can be added (priced), what needs the
// maker (asked), and what the maker never allows. Changing any of them changes the price and the text.
function rightsPanel(uses, rules) {
  const C = require('./contract');
  const data = {};
  for (const u of uses) { const t = C.terms({ use: u, never: rules.never, base: u.price_cents }); data[u.key] = { has: t.rights, addable: t.addable, personal: t.personal, print: u.kind === 'print', base: u.price_cents }; }
  const noAdapt = rules.never.includes('alter');
  return `<div class="rt" data-rt hidden><p class="rt-h">The rights in your contract <a href="#" data-rt-read>Read the agreement</a></p>
<div class="rt-g" role="group" aria-label="Permitted uses">${C.RIGHTS.map(r => `<label class="rt-c" data-r="${r.key}"><input type="checkbox" name="add" value="${r.key}"><span>${esc(r.label)}</span><em></em></label>`).join('')}</div>
<div class="rt-x" role="group" aria-label="Extended rights">${C.EXTRAS.map(e => { const off = e.key === 'derivative' && noAdapt; return `<label class="rt-e${off ? ' is-never' : ''}" title="${esc(e.note)}"><input type="checkbox" name="x" value="${e.key}"${off ? ' disabled' : ''}><span><b>${esc(e.label)}</b>${esc(e.note)}</span><em>${off ? 'The maker says never' : e.price == null ? 'Ask the maker' : '+' + money(e.price)}</em></label>`; }).join('')}</div>
<dialog class="rt-d" data-rt-d><button type="button" class="rt-close" aria-label="Close" data-rt-close>&times;</button><div data-rt-body></div></dialog>
<script src="/static/rights.js?v=${VER}" defer></script><script>window.__WM_RT=${JSON.stringify({ uses: data, add: C.ADD_RIGHT, extras: Object.fromEntries(C.EXTRAS.map(e => [e.key, e.price])) }).replace(/</g, '\\u003c')};</script></div>`;
}

// The license page. One photograph, four uses, every price in plain sight, one button.
// Payment (Apple Pay, Google Pay, Link, card) collects name and email; nothing is asked twice.
function buy({ w, maker, uses, chosen, renews, instant, rules = { never: [], approve: false }, mine = [], simply = '' }) {
  const held = Object.fromEntries((renews ? [] : mine).map(m => [m.key, m]));
  const open = uses.filter(u => !held[u.key]);
  const pick = open.find(u => u.key === chosen) || open.find(u => u.key === 'social' && u.price_cents != null) || open.find(u => u.key === 'commercial') || open[0] || uses[0];
  const label = u => !u || u.price_cents == null || !instant || u.needsMaster ? 'Ask the maker' : rules.approve ? `Request for ${money(u.price_cents)}` : `${u.key === 'social' ? 'Collect' : u.kind === 'print' ? 'Order' : 'License'} for ${money(u.price_cents)}`;
  const row = u => held[u.key] ? `<label class="bu is-mine"><input type="radio" name="use" value="${esc(u.key)}" disabled>
<span class="bu-n">${esc(u.name)}</span><span class="bu-p">Yours</span>
<span class="bu-d">${held[u.key].ends_at ? `Licensed to you until ${date(held[u.key].ends_at)}.` : 'In your gallery.'} <a href="/c/${esc(held[u.key].ref)}${held[u.key].download_token ? `?k=${esc(held[u.key].download_token)}` : ''}">Your license</a></span></label>` : `<label class="bu"><input type="radio" name="use" value="${esc(u.key)}" data-label="${esc(label(u))}" ${u === pick ? 'checked' : ''}>
<span class="bu-n">${esc(u.name)}</span><span class="bu-p">${money(u.price_cents)}</span>
<span class="bu-d">${esc(u.description)} <em>${esc(termText(u))}.</em>${u.needsMaster ? ' <span class="bu-nm">The maker supplies the full-resolution file for this use; they reply within the day.</span>' : ''}</span></label>`;
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
${scenes(w, maker)}</div>
<figcaption><b>${esc(tidy(w.title))}</b>${w.place ? ` &middot; ${esc(w.place)}` : ''}<br>${OBJ.kindWord(w)} by ${mlink(maker.name)}<span class="ls-cap" data-ls-cap>Choose where it will live, and see it there.</span></figcaption></figure>
<form method="post" action="/buy/${esc(w.slug)}" class="buy-form">
<p class="k">Held on Watermark</p><h1>${pick && pick.key === 'social' ? 'Collect it.' : 'Give it somewhere to live.'}</h1>
${renews ? `<p class="ok">Renewing ${esc(renews)}.</p><input type="hidden" name="renews" value="${esc(renews)}">` : ''}
${simply ? `<p class="own-say">${esc(simply)}</p>` : ''}<fieldset class="bus"><legend class="vh">How it will be used</legend>${rows}</fieldset>
${rightsPanel(uses, rules)}
<details class="buy-note"><summary>Add a note for the maker</summary><textarea name="note" rows="3" placeholder="Where it will appear. Optional."></textarea></details>
<button type="submit" class="buy-btn" id="buyBtn">${esc(label(pick))}</button>
<p class="buy-assent">By paying you accept the <a href="/contract/${esc(w.slug)}?use=${esc(pick ? pick.key : '')}" target="_blank" data-assent>license agreement</a> for the rights you chose. It is binding on both sides, and a copy is yours with the certificate.</p>
${rules.never.length ? `<p class="never"><span>The maker says never</span>${rules.never.map(k => esc(NEVER[k])).join(' &middot; ')}</p>` : ''}
<p class="buy-how">${rules.approve ? 'The maker approves each license personally, usually within the day. You pay only once it is approved.' : instant ? (pick && pick.key === 'social' ? 'Apple Pay, Google Pay or card. The file is yours the moment you pay, ready to post.' : 'Apple Pay, Google Pay or card. The full file, a certificate and a receipt arrive the moment you pay.') : 'The maker replies with terms and a payment link, usually within the day.'}</p>
<ul class="buy-p"><li>Paid to the maker</li><li>Full resolution, licensed in the file</li><li>Recorded in Watermark&rsquo;s <a href="/ledger">register</a></li></ul>
<p class="buy-more">Exclusivity, a longer term or something larger? <a href="/buy/${esc(w.slug)}?ask=1" data-ask>Ask the maker</a>. &middot; <a href="/terms" target="_blank">The terms</a>, in plain language.</p>
</form></section>
<script>(function(){var b=document.getElementById('buyBtn');
// See it where it will live: each use shows the photograph in its place.
var st=document.querySelector('[data-ls]'),cap=document.querySelector('[data-ls-cap]'),sc=st?[].slice.call(st.querySelectorAll('[data-sc]')):[];
var CAPS={'':'Choose a use to see it in place.',social:'On your own accounts.',editorial:'Opening a story.',commercial:'The first thing people see.',campaign:'At the scale of a city.',print:'On your wall, for good.'};
function show(k){if(!st)return;var has=sc.some(function(x){return x.getAttribute('data-sc')===k;});sc.forEach(function(x){x.classList.toggle('on',x.getAttribute('data-sc')===(has?k:''));});if(cap)cap.textContent=CAPS[has?k:'']||CAPS[''];}
var cur=(document.querySelector('.bu input:checked')||{}).value||'';show(cur);
document.querySelectorAll('.bu').forEach(function(l){var i=l.querySelector('input');l.addEventListener('mouseenter',function(){show(i.value);});l.addEventListener('mouseleave',function(){show((document.querySelector('.bu input:checked')||{}).value||'');});});
document.querySelectorAll('.bu input').forEach(function(i){i.addEventListener('change',function(){b.textContent=i.dataset.label;show(i.value);});});
var a=document.querySelector('[data-ask]');a&&a.addEventListener('click',function(e){e.preventDefault();var f=document.querySelector('.buy-form');var h=document.createElement('input');h.type='hidden';h.name='ask';h.value='1';f.appendChild(h);f.submit();});})();</script>`
  });
}

// For anything bespoke: three fields, then the maker answers.
function ask({ w, maker, u, note, renews, error, approve, uses = [] }) {
  // The menu stays with the buyer: every other use the work allows, a tap away, instant ones marked by price, the rest as Ask.
  const menu = uses.length > 1 ? `<nav class="buy-menu" aria-label="Other uses"><p class="k">Or another use</p><ul>${uses.map(x => `<li${x.key === u.key ? ' class="now"' : ''}><a href="${x.needsMaster || x.price_cents == null ? `/buy/${esc(w.slug)}?use=${esc(x.key)}` : `/license/${esc(w.slug)}?use=${esc(x.key)}`}"><b>${esc(x.name)}</b><span>${x.needsMaster || x.price_cents == null ? 'Ask the maker' : money(x.price_cents) + ' · at once'}</span></a></li>`).join('')}</ul><a class="buy-back" href="/w/${esc(w.slug)}">&larr; The photograph</a></nav>` : `<p class="buy-back-p"><a class="buy-back" href="/w/${esc(w.slug)}">&larr; The photograph</a></p>`;
  return layout({
    title: `Ask about ${w.title} · Watermark`,
    body: `<section class="buy buy-ask">
<figure class="buy-fig"><div class="buy-plate"><img src="/img/${esc(w.slug)}/screen" alt="${esc(w.title)}" draggable="false"></div>
<figcaption><b>${esc(w.title)}</b><br>${esc(OBJ.by(w, maker.name))}</figcaption></figure>
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
</form>${menu}</section>`
  });
}

// The moment after paying.
function makerPage({ keys = [], edit = null, introduced = null, rep = null, m, slug, works, collectors, patrons, wall, series, levels, once, open, mine = [], stories = [], lines = [], applause = 0, years = [], collects = null }) {
  // Every maker's home, set the way Will's own site is set: a line about who they are, one photograph on a wall,
  // the latest from Studios, the series, recent photographs, then writing and the house, side by side.
  const wide = w => (w.width || 0) >= 1800 && w.width > w.height * 1.3;
  const cover = works.find(w => w.slug === 'inside-brunelleschi-s-dome') || works.find(w => w.curated && wide(w)) || works.find(wide) || works[0];
  const pick = works.filter(w => w.curated).concat(works).filter((w, i, a) => a.indexOf(w) === i).filter(w => w !== cover).slice(0, 4);
  const lvName = k => ({ medici: 'Medici', benefactor: 'Benefactors', patron: 'Patrons', friend: 'Friends' }[k] || 'Patrons');
  const groups = ['medici', 'benefactor', 'patron', 'friend'].map(k => [k, wall.filter(p => p.level === k)]).filter(g => g[1].length);
  const first = m.name.split(' ')[0];
  const roles = [houseMaker && m.handle === houseMaker ? '<a href="/director" class="mh-dir">Founding director</a> &middot; The founding collection' : null, m.kind === 'gallery' ? 'Gallery' : works.length ? 'Photographer' : null, stories.length ? 'Writer' : null, m.house ? esc(m.house) : null, m.place ? esc(m.place) : null].filter(Boolean).join(' &middot; ');
  const bio = m.bio ? esc(m.bio) : `${esc(m.name)} holds ${works.length} photograph${works.length === 1 ? '' : 's'} on Watermark${m.house ? `, under ${esc(m.house)}` : ''}. Each is fingerprinted, numbered and licensed at the source; 85% of every sale is ${esc(first)}&rsquo;s.`;
  const story = p => `<a class="wk-card" href="${esc(p.url)}">${p.feature_image ? `<span class="wk-card-frame"><img src="${esc(p.feature_image)}" alt="" loading="lazy"></span>` : ''}<span class="wk-card-kicker">${(p.tags || []).filter(t => t.visibility !== 'internal').slice(0, 1).map(t => esc(t.name)).join('')}${p.reading_time ? ` &middot; ${p.reading_time} min` : ''}</span><b class="wk-card-title">${esc(p.title)}</b><span class="wk-card-text">${esc(p.custom_excerpt || (p.excerpt || '').slice(0, 140))}</span></a>`;
  return layout({ title: `${m.name} · Watermark`, desc: `${m.name}${m.house ? ', ' + m.house : ''}. ${works.length} works held on Watermark.`, path: `/m/${slug}`, image: cover ? `/img/${cover.slug}/screen` : null,
    body: `<section class="mh"><div class="mh-wrap">
<div class="mh-who">${m.portrait ? `<img class="mk-por" src="/portrait/${esc(m.handle)}" alt="${esc(m.name)}">` : ''}<div><p class="k">${roles || 'Maker'}${keys.length ? ` · <a href="/keys" class="mh-key">The Keys, No. ${keys[0].no}</a>` : ''}</p><h1>${esc(m.name)}.</h1>${edit && edit.held > edit.n ? `<p class="mh-intro">Shows ${edit.n} of ${edit.held} held: the edit is the work.</p>` : ''}${introduced ? `<p class="mh-intro">Introduced to the house by ${introduced.href ? `<a href="${esc(introduced.href)}">${esc(introduced.name)}</a>` : esc(introduced.name)}.</p>` : ''}${rep && rep.by ? `<p class="mh-intro">Represented by <a href="/m/${esc(rep.by.handle)}">${esc(rep.by.name)}</a>.</p>` : ''}<p class="lede">${bio}</p>
${rep && rep.artists ? `<div class="mh-reps"><p class="k">Represents</p><ul class="mh-artists">${rep.artists.map(a => `<li><a href="/m/${esc(a.handle)}">${a.portrait ? `<img src="/portrait/${esc(a.handle)}" alt="">` : ''}<b>${esc(a.name)}</b><small>${a.works} held</small></a></li>`).join('')}</ul>${rep.shows && rep.shows.length ? `<p class="k">Shows</p><ul class="mh-shows">${rep.shows.map(h => `<li><a href="${esc(h.href)}"><b>${esc(h.title)}</b><small>${h.opens_at ? `opens ${esc(h.opens_at)}` : ''}${h.closes_at ? ` · closes ${esc(h.closes_at)}` : ''}${h.venue ? ` · ${esc(h.venue)}` : ''}</small></a></li>`).join('')}</ul>` : ''}</div>` : ''}
${m.site || m.instagram || (m.links && m.links !== '[]') ? `<p class="mk-links"><span class="k">Elsewhere</span>${m.site ? `<a href="${esc(m.site)}" rel="noopener">${esc(m.site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : ''}${m.instagram ? `<a href="https://www.instagram.com/${esc(m.instagram)}/" rel="noopener">@${esc(m.instagram)}</a>` : ''}${(() => { try { return (JSON.parse(m.links || '[]')).map(l => `<a href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`).join(''); } catch (e) { return ''; } })()}</p>` : ''}</div></div>
${cover ? `<figure class="mh-plate"><a href="/w/${esc(cover.slug)}" style="--r:${cover.width && cover.height ? (cover.width / cover.height).toFixed(3) : 1.5}"><img src="/img/${esc(cover.slug)}/large" alt="${esc(tidy(cover.title))}" fetchpriority="high" draggable="false"></a><figcaption>${esc(tidy(cover.title).replace(/[.\s]+$/, ''))}${cover.place ? `, ${esc(cover.place)}` : ''} · <a href="/w/${esc(cover.slug)}">See the photograph</a></figcaption></figure>` : ''}</div></section>
<section class="mh-stats"><div class="mh-wrap"><p class="mk-stats"><span><b>${works.length}</b> photographs</span><span><b>${collectors}</b> collector${collectors === 1 ? '' : 's'}</span><span><b>${applause}</b> tip${applause === 1 ? '' : 's'} of the hat</span><span><b>${patrons}</b> patron${patrons === 1 ? '' : 's'}</span><span class="mk-split"><b>85%</b> of every sale is ${esc(first)}&rsquo;s</span></p></div></section>
${stories.length ? `<section class="mh-sec"><div class="mh-wrap"><header class="gh"><h2>Latest, from Studios</h2><a class="wk-more" href="https://studios.krafftco.com/author/${esc(makerSlug(m))}/">Everything</a></header><div class="mh-cards">${stories.slice(0, 3).map(story).join('')}</div></div></section>` : ''}
${series.length ? `<section class="mh-sec"><div class="mh-wrap"><header class="gh"><h2>Series</h2><a class="wk-more" href="/collection">The collection</a></header><div class="mh-cards">${series.map(x => `<a class="wk-card" href="/series/${esc(x.slug)}"><span class="wk-card-kicker">A series</span><b class="wk-card-title">${esc(x.title)}</b>${x.note ? `<span class="wk-card-text">${esc(x.note)}</span>` : ''}</a>`).join('')}</div></div></section>` : ''}
${years.length > 1 ? `<section class="mh-sec"><div class="mh-wrap"><header class="gh"><h2>The body of work</h2><span>${works.length} works · ${years.length} years</span></header>
<p class="lede mh-lede">An artist is a body of work, not one picture. Here it is, year by year, the most regarded of each first; everything kept.</p>
<div class="yr">${years.map(y => `<section class="yr-y"><h3><span>${esc(y.year)}</span><small>${y.n} photograph${y.n === 1 ? '' : 's'}</small></h3><div class="yr-row">${y.works.slice(0, 6).map(w => `<a href="/w/${esc(w.slug)}" style="--r:${w.width && w.height ? (w.width / w.height).toFixed(3) : 1.5}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(tidy(w.title))}" loading="lazy" draggable="false"></a>`).join('')}${y.n > 6 ? `<a class="yr-more" href="/collection?maker=${esc(slug)}&year=${esc(y.year)}">+${y.n - 6}</a>` : ''}</div></section>`).join('')}</div></div></section>` : ''}
${collects && collects.n ? `<section class="mh-sec"><div class="mh-wrap"><header class="gh"><h2>Alongside the work: what ${esc(m.name.split(' ')[0])} collects</h2><a class="wk-more" href="/g/${esc(collects.code)}">The gallery</a></header>
<p class="lede mh-lede">Artists are the keenest collectors of other artists. ${collects.n} photograph${collects.n === 1 ? '' : 's'} by other makers hang in ${esc(m.name.split(' ')[0])}'s gallery.</p>
<div class="mh-strip">${collects.works.map(w => `<a href="/w/${esc(w.slug)}" style="--r:${w.width && w.height ? (w.width / w.height).toFixed(3) : 1.5}" title="${esc(tidy(w.title))} · ${esc(w.maker)} · No. ${w.collector_no}"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="lazy" draggable="false"></a>`).join('')}</div></div></section>` : ''}
${pick.length ? `<section class="mh-sec mh-tint"><div class="mh-wrap"><header class="gh"><h2>${years.length > 1 ? 'Most regarded' : 'Recent work'}</h2><a class="wk-more" href="/collection">Collect</a></header><div class="mh-strip">${pick.map(w => `<a href="/w/${esc(w.slug)}" style="--r:${w.width && w.height ? (w.width / w.height).toFixed(3) : 1.5}"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="lazy" draggable="false"></a>`).join('')}</div></div></section>` : ''}
<section class="mh-sec"><div class="mh-wrap mh-split">
<div><p class="k">${lines.length ? 'From the guest books' : 'Collect and license'}</p>${lines.length ? `<h2 class="wk-h2">What people say in front of the work.</h2><ol class="gb gb-mine">${lines.map(n => `<li><span class="gb-d">${date(n.at)}</span><p class="gb-p">${esc(n.body)}</p><span class="gb-s">${esc(n.name || 'A visitor')}<small class="gb-on">on <a href="/w/${esc(n.slug)}#notes">${esc(tidy(n.title))}</a></small></span></li>`).join('')}</ol>` : `<h2 class="wk-h2">Yours to keep, from ${money(500)}.</h2><p class="wk-body">Every work here can be collected, numbered, in a minute, or licensed for a story, a company, a campaign or a wall, with the agreement in plain language and the file sealed to you.</p><a class="wk-link" href="/collection">Walk the collection</a>`}</div>
<div><p class="k">The house</p><h2 class="wk-h2">${esc(m.name)}, on Watermark${m.house ? `, with ${esc(m.house)}` : ''}.</h2><p class="wk-body">Watermark holds the work at the source and licenses it; Krafft Studios tells the stories. ${esc(first)} keeps the copyright, 85% of every sale, and a say in every use.${open ? ' Patrons keep the work going.' : ''}</p>${open ? `<a class="wk-link" href="#patron">Become a patron</a>` : `<a class="wk-link" href="/friends">Friends of the house</a>`}</div></div></section>
${open ? `<section class="pat" id="patron"><header><p class="k">Patronage</p><h2>Keep the work going.</h2><p>In Florence, Lorenzo de&rsquo; Medici kept a young Michelangelo at his own table. Patronage is how great work has always been made. Here anyone can do it: monthly, or once. Patrons come closer to the work, never to the person. 85% goes to ${esc(m.name)}.</p></header>
${mine.length ? `<p class="pat-mine">You are a patron of ${esc(m.name)}. Thank you.</p>` : ''}
<div class="pat-levels">${levels.filter(l => l.key !== 'medici').map(l => `<form method="post" action="/m/${esc(slug)}/patron" class="pat-l${l.key === 'patron' ? ' pat-mid' : ''}"><input type="hidden" name="level" value="${l.key}"><p class="pat-n">${esc(l.name)}</p><p class="pat-p">${money(l.cents)}<small> a month</small></p><p class="pat-g">${esc(l.gives)}</p><div class="seal-row">${seal(m, `Become a ${l.name}`)}<span class="pat-go">Become a ${esc(l.name)}</span></div></form>`).join('')}</div>
${levels.filter(l => l.key === 'medici').map(l => `<form method="post" action="/m/${esc(slug)}/patron" class="pat-l pat-medici"><input type="hidden" name="level" value="${l.key}"><div><p class="pat-n">${esc(l.name)}</p><p class="pat-p">${money(l.cents)}<small> a month</small></p><label class="pat-yr"><input type="checkbox" name="interval" value="year"> Or ${money(l.year)} once a year</label></div><div><p class="pat-g">${esc(l.gives)}</p><p class="pat-g pat-letter">Above the Medici there is no price on the page: a series commissioned, a room founded, an estate endowed. <a href="mailto:${esc(m.email || 'will@krafftco.com')}?subject=${encodeURIComponent('A letter to ' + m.name)}">Write to ${esc(m.name.split(' ')[0])}</a>.</p></div><div class="seal-row">${seal(m, 'Become a Medici')}<span class="pat-go">Become a Medici</span></div></form>`).join('')}
<form method="post" action="/m/${esc(slug)}/patron" class="pat-once"><p class="pat-n">Or once</p><div class="pat-ch">${once.map((c, i) => `<label><input type="radio" name="once" value="${c / 100}" ${i === 1 ? 'checked' : ''}><span>${money(c)}</span></label>`).join('')}<label class="pat-own"><span>$</span><input name="amount" inputmode="numeric" placeholder="Your amount" aria-label="Your own amount, in dollars"></label></div>${seal(m, 'Give once')}</form>
<p class="note pat-fine">Monthly patronage can be ended any time from <a href="/yours">Yours</a>. Prices are drafts.</p></section>` : ''}
<section class="pat-wall" id="wall"><p class="k">The patrons of ${esc(m.name)}</p>${groups.length ? groups.map(([k, ps]) => `<div><h3>${lvName(k)}</h3><p>${ps.map(p => esc(p.name)).join(' &middot; ')}</p></div>`).join('') : `<p class="pat-first">The first name on this wall is still to be written.</p>`}</section>` });
}

function patronThanks({ p, m, slug, level, own, session }) {
  const done = p.status !== 'pending';
  return layout({ title: 'Thank you · Watermark', body: `<section class="cx-intro pat-ty">${done ? `<span class="ps-stamp" aria-hidden="true">${WAVE_MARK}</span>` : ''}<p class="k">${p.recurring ? 'Patronage' : 'Support'}</p>
<h1>${done ? (p.recurring ? `You are a patron of ${esc(m.name)}.` : `Thank you. ${esc(m.name)} will know.`) : 'One moment. Your patronage is being confirmed.'}</h1>
${done && level ? `<p class="lede">${esc(level.name)}. ${esc(level.gives)}</p>` : done ? '<p class="lede">85% of it goes to the maker.</p>' : `<p class="lede"><a href="/patron/${p.id}/thanks?session_id=${esc(session)}">Refresh</a> in a few seconds.</p>`}
${done && own ? `<form method="post" action="/patron/${p.id}/name" class="form pat-nm"><label>Your name on the wall<input name="name" value="${esc(p.name || '')}" placeholder="As you would like it written"></label><label class="chk"><input type="checkbox" name="public" value="1" ${p.public ? 'checked' : ''}> Show my name among the patrons</label><button class="buy-btn">Save</button></form>` : ''}
<p class="sr-also"><a href="/m/${esc(slug)}">Back to ${esc(m.name)}</a> &middot; <a href="/yours">Your gallery</a></p></section>` });
}

// A tip for the people who made a story: shared among everyone credited, or to one of them.
function tip({ c, amounts, back, open, unavailable }) {
  const many = c.people.length > 1;
  const who = c.people.map(p => `<li><span class="tp-r">${esc(p.label)}</span><b>${esc(p.name)}</b></li>`).join('');
  const to = many ? `<fieldset class="tp-to"><legend class="k">To</legend><div class="use-tg">${[['all', `Both, shared evenly`], ...c.people.map(p => [p.id, p.name])].map(([v, l], i) => `<label><input type="radio" name="to" value="${v}" ${i ? '' : 'checked'}><span>${esc(l)}</span></label>`).join('')}</div></fieldset>` : '';
  return layout({ title: `For ${tidy(c.title)} · Watermark`, body: `<section class="cx-intro tp">
<p class="k">For the people who made it</p><h1><i>${esc(c.title)}</i></h1>
<ul class="tp-who">${who}</ul>
${unavailable ? '<p class="err">Tips could not open just now. Please try again in a moment.</p>' : ''}
${open ? `<form method="post" action="/tip/${esc(c.post)}" class="tp-f"><input type="hidden" name="back" value="${esc(back || '')}">
${to}
<div class="pat-ch">${amounts.map((a, i) => `<label><input type="radio" name="amount" value="${a / 100}" ${i === 1 ? 'checked' : ''}><span>${money(a)}</span></label>`).join('')}<label class="pat-own"><span>$</span><input name="own" inputmode="decimal" placeholder="Your amount" aria-label="Your own amount, in dollars"></label></div>
<label class="tp-note">A word for them, if you like<input name="note" maxlength="280" placeholder="Optional"></label>
<div class="seal-row">${seal({ name: 'Krafft Studios', house: 'Krafft Studios' }, 'Tip')}<div class="seal-t"><b>Tip</b><span>85% goes to ${many ? 'them, shared as you choose' : esc(c.people[0].name)}. Paid once; nothing recurring.</span></div></div></form>` : '<p class="lede">Tips open shortly.</p>'}
${back ? `<p class="sr-also"><a href="${esc(back)}">Back to the story</a></p>` : ''}</section>` });
}
function tipThanks({ rows, c }) {
  const done = rows[0].status === 'paid';
  const names = rows.map(r => r.maker_name).join(' and ');
  return layout({ title: 'Thank you · Watermark', body: `<section class="cx-intro pat-ty">${done ? `<span class="ps-stamp" aria-hidden="true">${WAVE_MARK}</span>` : ''}<p class="k">A tip</p>
<h1>${done ? `Thank you. ${esc(names)} will know.` : 'One moment. Your tip is being confirmed.'}</h1>
<p class="lede">${done ? `For <i>${esc(c ? c.title : '')}</i>. 85% of it goes to ${rows.length > 1 ? 'them' : esc(names)}.` : 'Refresh in a few seconds.'}</p>
<p class="sr-also">${c && c.url ? `<a href="${esc(c.url)}">Back to the story</a> &middot; ` : ''}<a href="/">The collection</a></p></section>` });
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

// Hand it to your phone: a code to scan, and nothing to type.
function handPage({ url, svg, mailOn, email, next }) {
  return layout({ title: 'Your other device · Watermark', path: '/signin/hand', body: `<section class="narrow hand"><p class="k">Sign in</p><h1>Hand it to your phone.</h1>
<p class="lede">Point the other device's camera at this. It opens Watermark signed in as you: your gallery, your studio, your pocket. The code is good for ten minutes, once.</p>
<div class="hand-two"><figure class="hand-qr">${svg}<figcaption>${esc(email)}</figcaption></figure>
<div class="hand-else"><p class="k">Or</p>${mailOn ? `<form method="post" action="/signin/hand/mail"><button class="jewel">Mail me the link</button></form><p class="note">Open it on the device you want signed in.</p>` : '<p class="note">Mail is not on yet; scan the code, or copy the link below.</p>'}
<details class="hand-link"><summary>The link itself</summary><code>${esc(url)}</code></details>
<p class="note">A passkey is the other way: once saved on a device (Face ID, Touch ID), it signs you in there with no code and no mail. Offered on the sign-in page.</p></div></div>
<p class="note"><a href="${esc(next || '/yours')}">Back</a></p></section>` });
}
function signin({ b, m, has, mailOn = true, out = false, gone = false, next = null }) {
  // One field. The code comes by mail; a passkey, when the browser holds one, is offered in the same field.
  const inside = !!(b && (b.email || has)) || !!m;
  const who = m ? m.name.split(' ')[0] : (b && b.name ? b.name.split(' ')[0] : null);
  return layout({ title: 'Sign in · Watermark', body: `<section class="si" data-si data-next="${next ? esc(next) : ''}">
<div class="si-card">
<span class="si-k" aria-hidden="true">${WAVE_MARK}</span>
${inside ? `<div class="si-step is-on"><p class="k">Signed in</p><h1>${who ? `Good to see you, ${esc(who)}.` : 'You are in.'}</h1><p class="lede">${m ? 'Your room and your gallery are open on this device.' : 'Your gallery is open on this device, and follows you to any other you sign in on.'}</p>
<p class="si-row"><a class="buy-btn" href="${m ? '/account' : '/yours'}">${m ? 'Go to your room' : 'Go to your gallery'}</a>${m ? '<a class="si-alt" href="/yours">Your gallery</a>' : ''}</p>
<form method="post" action="/signout" class="si-out"><button>Sign out of this device</button></form></div>`
: `<div class="si-step is-on" data-step="email">
<p class="k">${gone ? 'That link has been used' : out ? 'Signed out' : 'Watermark'}</p><h1>${gone ? 'Sign in again.' : out ? 'Until next time.' : 'Sign in.'}</h1>
<p class="lede">${gone ? 'Links work once and for ten minutes. Enter your email and we will send a fresh one.' : 'Your email, and a six-digit code comes back. No password, nothing to remember.'}</p>
<form class="si-f" data-si-email novalidate><label class="si-field"><input type="email" name="email" inputmode="email" autocomplete="username webauthn" autocapitalize="off" spellcheck="false" placeholder="you@somewhere.com" required autofocus><span class="si-line"></span></label>
<button class="buy-btn si-go" type="submit"><span>Send the code</span><i class="si-spin" aria-hidden="true"></i></button></form>
<p class="si-msg" data-si-msg aria-live="polite"></p>
<p class="note si-pk"><button type="button" class="si-link" data-passkey="signin">Sign in with a passkey instead</button></p>
${mailOn ? '' : '<p class="note si-off">Email codes are not switched on for this house yet; use a passkey, or ask the Studio.</p>'}</div>
<div class="si-step" data-step="code">
<p class="k">Check your mail</p><h1>Enter the code.</h1>
<p class="lede">We sent six digits to <b data-si-to></b>. Type them here, or open the link in the message.</p>
<p class="note si-off" data-si-off hidden>Mail is not connected for this house yet, so the code was not sent. The keeper can read it from the house log and give it to you.</p>
<form class="si-f" data-si-code novalidate><div class="si-code" data-si-boxes>${'<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="1" pattern="[0-9]" aria-label="digit">'.repeat(6)}</div>
<button class="buy-btn si-go" type="submit"><span>Sign in</span><i class="si-spin" aria-hidden="true"></i></button></form>
<p class="si-msg" data-si-msg aria-live="polite"></p>
<p class="note"><button type="button" class="si-link" data-si-again>Send another</button> &middot; <button type="button" class="si-link" data-si-back>Different email</button></p></div>
<div class="si-step" data-step="done"><p class="k">Welcome</p><h1 data-si-hello>You are in.</h1><p class="lede" data-si-sub>One moment.</p></div>`}
</div>
<p class="si-foot">A Krafft company. Your email is used to sign you in and to send what you collect; nothing else. <a href="/terms">Terms</a>.</p>
</section>
<script src="/static/webauthn.js" defer></script><script src="/static/auth.js?v=${VER}" defer></script><script src="/static/signin.js?v=${VER}" defer></script>` });
}

// Trades in kind: pick the piece you want, then the piece you give.
function swapNew({ w, b, theirs, want, mine, err }) {
  const t = tidy(w.title);
  const why = { locked: 'That license cannot pass to another person; its agreement does not allow it.', want: 'That piece is not one that can be traded for.', give: 'Choose one of your own numbered pieces to give.', same: 'Those are the same piece.', listed: 'That piece of yours is on the market; withdraw it first.', open: 'You have already offered a trade for that piece.' }[err];
  const plate = (p, href, label) => `<a class="sw-p" href="${href}"><img src="/img/${esc(p.slug)}/screen" alt="${esc(tidy(p.title))}" loading="lazy" draggable="false"><span><b>${esc(tidy(p.title))}</b> No.&nbsp;${p.collector_no}${p.edition_size ? `<small>&thinsp;/&thinsp;${p.edition_size}</small>` : ''}<i>${label}</i></span></a>`;
  return layout({ title: `Trade for ${t} · Watermark`, body: `<section class="sw"><p class="k">A trade</p><h1>${want ? `For No.&nbsp;${want.collector_no} of <i>${esc(t)}</i>, what do you give?` : `Which piece of <i>${esc(t)}</i>?`}</h1>
<p class="lede">${want ? 'One piece for another; nothing is paid. The holder accepts or declines, and nothing moves until they do.' : `${theirs.length} numbered piece${theirs.length === 1 ? ' is' : 's are'} held by other collectors. Choose the one you want; then choose what you give for it.`}</p>
${why ? `<p class="err">${why}</p>` : ''}
${!want ? `<div class="sw-grid">${theirs.map(p => `<a class="sw-no" href="/swap/new?work=${esc(w.slug)}&want=${p.id}"><b>No.&nbsp;${p.collector_no}</b><span>${p.public && p.code ? `${esc(p.holder || 'a collector')}` : 'a private collector'}</span><small>since ${date(p.starts_at)}</small></a>`).join('') || '<p class="note">No piece of this work is held by anyone else yet.</p>'}</div>`
: `<div class="sw-two"><div>${plate(want, `/w/${esc(want.slug)}`, want.holder && want.holder_code ? `held by ${esc(want.holder)}` : 'held by a private collector')}</div>
<form method="post" action="/swap" class="sw-f"><input type="hidden" name="want" value="${want.id}">
${mine.length ? `<p class="k">You give</p><div class="sw-mine">${mine.filter(m => m.id !== want.id).map(m => `<label class="sw-m"><input type="radio" name="give" value="${m.id}" required><img src="/img/${esc(m.slug)}/thumb" alt="" draggable="false"><span><b>${esc(tidy(m.title))}</b> No.&nbsp;${m.collector_no}${m.edition_size ? `<small>&thinsp;/&thinsp;${m.edition_size}</small>` : ''}<em>${esc(m.maker)}</em></span></label>`).join('')}</div>
<label class="sw-note">A line to the holder, if you like<textarea name="note" maxlength="400" rows="2" placeholder="I have wanted this one since I saw it in the Great Rooms."></textarea></label>
<button class="buy-btn">Offer the trade</button><p class="note">The photographer is told when a piece changes hands, and the trade goes on the register. No money moves.</p>` : `<p class="note">You hold no numbered piece to trade yet. <a href="/collection">Collect one</a>, then come back.</p>`}</form></div>`}
</section>` });
}

function swap({ s, role, b, ok }) {
  const { give, want } = s; const done = s.status !== 'open';
  const plate = p => `<div class="sw-p"><img src="/img/${esc(p.slug)}/screen" alt="${esc(tidy(p.title))}" draggable="false"><span><b>${esc(tidy(p.title))}</b> No.&nbsp;${p.collector_no}${p.edition_size ? `<small>&thinsp;/&thinsp;${p.edition_size}</small>` : ''}<i>${esc(p.maker)}</i></span></div>`;
  const head = ok === 'traded' ? 'Traded.' : ok === 'declined' ? 'Declined.' : ok === 'lapsed' ? 'This trade can no longer be made.' : s.status === 'accepted' ? 'Traded.' : s.status === 'open' ? (role === 'to' ? 'A trade is offered to you.' : 'Your trade is offered.') : `This trade was ${s.status}.`;
  const sub = ok === 'traded' || s.status === 'accepted' ? 'Each piece is now in its new collection, with a fresh key, and the trade is on the register.' : ok === 'lapsed' ? 'One of the pieces has moved, or is on the market.' : s.status === 'open' ? (role === 'to' ? 'Nothing moves until you say so.' : 'Waiting on the holder. You can withdraw it until they answer.') : '';
  return layout({ title: 'A trade · Watermark', body: `<section class="sw"><p class="k">A trade</p><h1>${head}</h1>${sub ? `<p class="lede">${sub}</p>` : ''}
<div class="sw-two sw-vs"><div><p class="k">${role === 'to' ? 'Offered to you' : 'You give'}</p>${plate(give)}</div><span class="sw-x" aria-hidden="true">for</span><div><p class="k">${role === 'to' ? 'Your piece' : 'For their'}</p>${plate(want)}</div></div>
${s.note ? `<blockquote class="sw-q">${esc(s.note)}</blockquote>` : ''}
${!done && role === 'to' ? `<p class="sw-acts"><form method="post" action="/swap/${s.id}/accept"><button class="buy-btn">Accept the trade</button></form><form method="post" action="/swap/${s.id}/decline"><button class="link">Decline</button></form></p>` : ''}
${!done && role === 'from' ? `<form method="post" action="/swap/${s.id}/withdraw"><button class="link">Withdraw the offer</button></form>` : ''}
<p class="note"><a href="/yours">Your gallery</a></p></section>` });
}

// Watermark and the U.S. Copyright Office: the public account of the bridge.
function copyrightPage({ n, fee, max }) {
  return layout({ title: 'The U.S. Copyright Office · Watermark', desc: 'How Watermark prepares, files and records U.S. copyright registration for every work it holds.', path: '/copyright', body: `<section class="cx-intro cr-pg"><p class="k">Watermark and the U.S. Copyright Office</p>
<h1>Copyright, on the public record.</h1>
<p class="lede">Copyright belongs to the photographer from the moment the picture is made. Registration with the United States Copyright Office is the public record of it, and what a court asks for. Watermark prepares that record for every work it holds, files it the Office&rsquo;s way, and writes the registration number back onto the work, its certificate and its Shield.</p>
<p class="cr-n"><span><b>${n.held}</b> works held</span><span><b>${n.registered}</b> registered</span><span><b>${n.filed}</b> filed, pending</span><span><b>${n.prepared || 0}</b> prepared, not yet filed</span><span><b>${n.groups}</b> group registration${n.groups === 1 ? '' : 's'}</span></p></section>
<section class="narrow cr-body cr-words">
<h2>What the words mean here</h2>
<p><b>Registered</b> means the U.S. Copyright Office has issued a registration number (VA&hellip;) for the photograph. Only then does Watermark use the word, and the number is shown on the work.</p>
<p><b>Filed, pending</b> means the application, the fee and the deposit have gone to the Office and a service request number has been issued. The Office takes months to decide.</p>
<p><b>Prepared</b> means Watermark has grouped the photograph the Office&rsquo;s way and made the title list and deposit, ready to file. Nothing has been sent yet.</p>
<p><b>Held by Watermark</b> is the house&rsquo;s own record: the photograph entered, fingerprinted and kept in the register. It is not a copyright registration.</p>
</section>
<section class="narrow cr-body">
<h2>What the Office receives</h2>
<p>The Office registers photographs in groups: up to ${max} by one author, published in one calendar year (GRPPH), or unpublished (GRUPH), for a fee of ${money(fee)} a group. Watermark sorts every held photograph into those groups automatically, keeps the title list in the Office&rsquo;s form (title, file name, date), and assembles the deposit: one file for each photograph, named as it is in the list, at the size the Office accepts. The maker&rsquo;s attestation of authorship, taken on arrival, stands behind every title.</p>
<h2>What comes back</h2>
<p>When the Office issues a registration, its number is entered once and appears on every photograph in the group: the <i>U.S. Registered</i> mark on the plate, the line on the work&rsquo;s page, the row on its Shield, and the certificate of every license sold afterward, with a link to the Office&rsquo;s public record. While a group is filed and waiting, the work says so; before that, it says the copyright is held and registration is prepared. Nothing on Watermark claims a registration that has not been made.</p>
<h2>What the record carries</h2>
<p>Each photograph holds its original in the vault, fingerprinted on arrival, with its camera data intact and, where the camera or its software provided them, its Content Credentials. Every event in its life is on the <a href="/ledger">register</a>: registration here, sale, license, transfer. A registration number from the Office joins that chain, so the Office&rsquo;s record and ours point at the same picture.</p>
<h2>What we are ready for</h2>
<p>The Office is moving its filing from eCO to its new Enterprise Copyright System. Watermark already holds every field a group application asks for, in the order it asks, so when the Office opens a way to file by machine, or to sign in with a federal identity, Watermark will file and sign in that way. Until then the Studio files by hand from what Watermark prepares, and the Office hears from one careful filer rather than from hundreds.</p>
<p class="note">Watermark is not a law firm and does not give legal advice. Registration is made by the author, the claimant or their authorised agent. Questions from the Office: <a href="mailto:will@krafftco.com">will@krafftco.com</a>.</p>
</section>` });
}

// The artists: who holds work here. Each name opens their page; each page opens their work.
function artists({ artists }) {
  const card = m => `<a class="ar" href="/m/${esc(m.slug)}">${m.cover ? `<span class="ar-im" style="--r:${m.cover.width && m.cover.height ? (m.cover.width / m.cover.height).toFixed(3) : 1.5}"><img src="/img/${esc(m.cover.slug)}/screen" alt="${esc(tidy(m.cover.title))}" loading="lazy" draggable="false"></span>` : '<span class="ar-im"></span>'}
<span class="ar-t">${m.portrait ? `<img class="ar-por" src="/portrait/${esc(m.handle)}" alt="">` : ''}<span><b>${esc(m.name)}</b><small>${m.house ? esc(m.house) + ' &middot; ' : ''}${m.n} photograph${m.n === 1 ? '' : 's'}${m.collectors ? ` &middot; ${m.collectors} collector${m.collectors === 1 ? '' : 's'}` : ''}${m.kind === 'estate' ? ' &middot; Estate' : m.kind === 'institution' ? ' &middot; Institution' : ''}</small></span></span></a>`;
  return layout({ title: 'The artists · Watermark', desc: 'The photographers whose work is held on Watermark.', path: '/artists', body: `<section class="cx-intro ar-intro"><p class="k">The artists</p><h1>Whose work hangs here.</h1>
<p class="lede">Watermark holds photographs for the people who made them. The Krafft Collection was the first; every maker who joins keeps their copyright, sets their own terms and takes 85% of every sale. Open a name to see the work.</p></section>
<section class="ar-wall"><div class="ar-grid">${artists.map(card).join('')}</div></section>
<section class="gal"><p class="note ar-join">Watermark is by invitation. A photographer, or an estate, with work that is ready? <a href="/join">Apply with the work</a>.</p></section>` });
}

// The door out. A traveller's farewell, said once and meant: see you down the road; the doors are always open.
// The words are a draft in Will's voice.
function farewell({ name = null, cover = null }) {
  return layout({ title: 'See you down the road · Watermark', desc: 'The doors are always open.', path: '/farewell', body: `<section class="fw">${cover ? `<img class="fw-im" src="/img/${esc(cover.slug)}/large" alt="${esc(tidy(cover.title))}" fetchpriority="high" draggable="false">` : ''}
<div class="fw-in"><span class="fw-k" aria-hidden="true">${WAVE_MARK}</span>
<p class="k">${name ? `Until next time, ${esc(name)}` : 'Until next time'}</p>
<h1>Thank you for coming.<br>We hope you come back.</h1>
<p class="fw-l">It was our pleasure to have you. You are signed out of this device. The doors are always open: your gallery, your numbers and everything you have written here are kept, and will be here when you come back.</p>
<p class="fw-row"><a class="fw-btn" href="/signin">Come back in</a><a class="fw-alt" href="/collection">Walk the collection as a visitor</a></p>
${cover ? `<p class="fw-cap">${esc(tidy(cover.title))}${cover.place ? `, ${esc(cover.place)}` : ''}</p>` : ''}</div></section>` });
}

// The viewing room. Nothing but the photograph on a dark wall, its title small beneath, the guide read
// aloud if you like, and the next one after a slow count unless you touch it. The museum, for an afternoon.
function viewingRoom({ from = '', first = null }) {
  return layout({ title: 'The viewing room · Watermark', desc: 'Wander through the collection, one work at a time, with a guide beside each.', path: '/wander/room', bare: true, image: first ? first.img : null, body: `<main class="vr" data-vr data-from="${esc(from)}">
<figure class="vr-fig"><img class="vr-im" alt="" draggable="false" decoding="async"${first ? ` src="${esc(first.img)}" fetchpriority="high"` : ''}><img class="vr-im vr-next" alt="" draggable="false" decoding="async"></figure>
<div class="vr-toast" data-vr-toast hidden></div>
<header class="vr-top"><a class="vr-home" href="/collection" aria-label="Watermark"><img src="/static/watermark-logo.svg" alt="Watermark"></a><div class="vr-ctl"><button type="button" class="vr-b" data-vr-say aria-pressed="false">${I.guide}<span>Guide</span></button><button type="button" class="vr-b" data-vr-auto aria-pressed="false">${I.stand}<span>Standing</span></button><a class="vr-b vr-x" href="/collection" aria-label="Leave the room">${I.close}</a></div></header>
<aside class="vr-side"><p class="vr-k" data-vr-k></p><h1 class="vr-t" data-vr-t></h1><p class="vr-by" data-vr-by></p><div class="vr-guide" data-vr-guide hidden></div><div class="vr-row"><button type="button" class="vr-go vr-act" data-vr-hat title="Tip your hat (H)">${I.hat}<span>Hat</span></button><button type="button" class="vr-go vr-act vr-bv" data-vr-bravo title="Bravo! The most you can give a work, three a month (B)">${I.bravo}<span>Bravo</span></button><button type="button" class="vr-go vr-act" data-vr-hang title="Hang it on your wall (S)">${I.hang}<span>Hang it</span></button><a class="vr-go vr-act" href="/frame" title="Show it on your television">${I.full}<span>On your TV</span></a><form method="post" class="vr-cf" data-vr-cf hidden><input type="hidden" name="use" value="social"><input type="hidden" name="from" value="" data-vr-from><button class="vr-go vr-act vr-collect" data-vr-collect type="submit" title="Collect it (C)">${I.collect}<span>Collect</span><em data-vr-price></em></button></form></div><p class="vr-why">Hat is a nod: <i>I saw it.</i> Bravo is a shout: <i>it floored me.</i></p><p class="vr-pg"><a class="vr-go" data-vr-page href="#">${I.page}<span>The photograph</span></a></p></aside>
<div class="vr-bar"><i data-vr-bar></i></div>
<div class="vr-deck"><button type="button" class="vr-nav vr-prev" data-vr-prev aria-label="Back">${I.back}</button><button type="button" class="vr-nav vr-pause" data-vr-pause aria-label="Pause or wander on"><i class="vr-dot"></i><span data-vr-pause-l>Wander</span></button><button type="button" class="vr-nav vr-nxt" data-vr-next aria-label="Next">${I.next}</button><span class="vr-sep"></span><button type="button" class="vr-nav vr-full" data-vr-full aria-label="Full screen" title="Full screen (F)">${I.full}</button></div>
<p class="vr-hint" data-vr-hint>Stand as long as you like. Arrows move · space pauses · F fills the screen · G reads the guide · H tips your hat · B calls bravo · S hangs it · C collects · Esc leaves.</p>
</main><script>window.__WM_FIRST=${first ? JSON.stringify(first).replace(/</g, '\\u003c') : 'null'};</script><script src="/static/room.js?v=${VER}" defer></script>` });
}

// The signs. Whatever has closed, a visitor sees a photograph and the way on, never a number. The way a museum
// hangs a card on a gallery door: closed for the moment, the rest of the house is open.
const SIGNS = {
  400: { k: 'Not quite', h: 'That request could not be read.', p: 'Something in it was not as the house expected. Go back a step and try again.' },
  401: { k: 'A private room', h: 'This room is for its keeper.', p: 'Sign in and it opens; if it is not yours, the rest of the house is.' , signin: true },
  403: { k: 'A private room', h: 'This door is not yours to open.', p: 'It belongs to someone else. The rest of the house is open.' },
  404: { k: 'Nothing hangs here', h: 'There is no page at this address.', p: 'It may have moved, or the link was copied short.' },
  409: { k: 'Already done', h: 'That has already happened.', p: 'The house recorded it the first time; nothing more is needed.' },
  410: { k: 'This door has closed', h: 'What was here has run its course.', p: 'A link that opened once, a run that ended, a file whose downloads are spent. The photograph itself is still in the house.' },
  413: { k: 'Too large', h: 'The vault takes files up to a certain size.', p: 'Make it smaller, or write to the house for a larger door.' },
  429: { k: 'Slow down', h: 'There is time.', p: 'Too many knocks at once. Stand in front of something for a minute and try again.' },
  500: { k: 'Being attended to', h: 'Something in this room gave way.', p: 'The house has been told. The rest of the galleries are open; this one will be back shortly.' },
  502: { k: 'Being attended to', h: 'The house is between rooms.', p: 'A new version is being hung. Give it a minute; everything you have walked is still here.' },
  503: { k: 'Closed for the moment', h: 'This gallery is closed for a short while.', p: 'It will open again shortly. The rest of the house is open.' },
};
function sign({ code = 404, cover = null, detail = null, next = null }) {
  const S = SIGNS[code] || SIGNS[500];
  return layout({ title: `${S.h} · Watermark`, desc: S.p, bare: false, body: `<section class="nf">${cover ? `<a class="nf-im" href="/w/${esc(cover.slug)}" style="--r:${cover.width && cover.height ? (cover.width / cover.height).toFixed(3) : 1.5}"><img src="/img/${esc(cover.slug)}/screen" alt="${esc(tidy(cover.title))}" draggable="false"></a>` : '<span class="nf-im nf-blank"></span>'}
<div class="nf-t"><p class="k nf-wil">${I.wilhelm}${esc(S.k)}</p><h1>${esc(S.h)}</h1><p class="lede">${esc(detail || S.p)}${cover ? ` Meanwhile, this is <a href="/w/${esc(cover.slug)}"><i>${esc(tidy(cover.title))}</i></a>${cover.maker ? `, by ${esc(cover.maker)}` : ''}.` : ''}</p>
<p class="nf-row">${S.signin ? '<a class="buy-btn" href="/signin">Sign in</a>' : next ? `<a class="buy-btn" href="${esc(next.href)}">${esc(next.label)}</a>` : '<a class="buy-btn" href="/wander/room">Wander on</a>'}<a class="nf-alt" href="/collection">The collection</a><a class="nf-alt" href="/artists">The artists</a><a class="nf-alt" href="/yours">Your gallery</a></p></div></section>` });
}
// Nothing hangs here.
function notFound({ cover = null }) {
  return layout({ title: 'Nothing hangs here · Watermark', desc: 'There is no page at this address.', body: `<section class="nf">${cover ? `<a class="nf-im" href="/w/${esc(cover.slug)}" style="--r:${cover.width && cover.height ? (cover.width / cover.height).toFixed(3) : 1.5}"><img src="/img/${esc(cover.slug)}/screen" alt="${esc(tidy(cover.title))}" draggable="false"></a>` : ''}
<div class="nf-t"><p class="k">Nothing hangs here</p><h1>There is no page at this address.</h1><p class="lede">It may have moved, or the link was copied short. The house is all around you${cover ? `; this is <a href="/w/${esc(cover.slug)}"><i>${esc(tidy(cover.title))}</i></a>, in the collection` : ''}.</p>
<p class="nf-row"><a class="buy-btn" href="/collection">Walk the collection</a><a class="nf-alt" href="/wander/room">Or wander</a><a class="nf-alt" href="/artists">The artists</a><a class="nf-alt" href="/yours">Your gallery</a></p></div></section>` });
}

// The Hall of Patrons. Portraits, made by the house, hung large in a dark room, a brass plate beneath each:
// the name, what they founded, the year. The way the Frick hangs its founders; the way Gainsborough painted his.
function hall({ patrons }) {
  const plate = p => `<figure class="hp${p.slug ? '' : ' hp-empty'}">${p.slug ? `<a class="hp-im" href="/w/${esc(p.slug)}" style="--r:${p.width && p.height ? (p.width / p.height).toFixed(3) : 0.8}"><img src="/img/${esc(p.slug)}/large" alt="${esc(p.name)}" loading="lazy" draggable="false"></a>` : '<span class="hp-im hp-blank"><i>Portrait to be made</i></span>'}
<figcaption class="hp-plate"><b>${esc(p.name)}</b>${p.founded ? `<span>${esc(p.founded)}</span>` : ''}${p.year ? `<small>${p.year}</small>` : ''}${p.note ? `<em>${esc(p.note)}</em>` : ''}</figcaption></figure>`;
  return layout({ title: 'The Hall of Patrons · Watermark', desc: 'The people who founded things here, honoured in portrait.', path: '/patrons', body: `<section class="hh"><div class="hh-in"><p class="k">The Hall of Patrons</p><h1>Those who kept the doors open.</h1>
<p class="lede">Every house worth visiting was founded by someone. The Frick was Frick&rsquo;s; the Morgan was Morgan&rsquo;s. Here the people who founded a room, a series or an estate are honoured the old way: a portrait, made by the house, hung in a room of its own, with their name beneath it for good.</p></div>
${patrons.length ? `<div class="hh-room">${patrons.map(plate).join('')}</div>` : '<div class="hh-room hh-none"><p>The first portrait in this hall is still to be made.</p></div>'}
<div class="hh-in hh-foot"><p>To found something here: <a href="/friends#letter">write to the house</a>. Each portrait is a photograph in the collection, held in the vault and on the register like any other.</p></div></section>` });
}
function hallDesk({ patrons, ok }) {
  setDeskPath('/studio/hall');
  const form = (p = {}) => `<form method="post" action="/studio/hall" class="form hd-f">${p.id ? `<input type="hidden" name="id" value="${p.id}">` : ''}
<div class="hl-row"><label>Name<input name="name" value="${esc(p.name || '')}" required></label><label>Founded (what they gave)<input name="founded" value="${esc(p.founded || '')}" placeholder="The Great Rooms; a seat at acquisitions"></label><label>Year<input name="year" value="${p.year || ''}" inputmode="numeric" size="6"></label></div>
<div class="hl-row"><label>Portrait: the work&rsquo;s slug<input name="work" value="${esc(p.slug || '')}" placeholder="portrait-of-…"></label><label>House<select name="house"><option value="watermark"${p.house !== 'krafft' ? ' selected' : ''}>Watermark</option><option value="krafft"${p.house === 'krafft' ? ' selected' : ''}>Krafft</option></select></label><label>Order<input name="sort" value="${p.sort || 0}" size="4"></label><label class="chk"><input type="checkbox" name="public" value="1"${p.id ? (p.public ? ' checked' : '') : ' checked'}> Shown</label></div>
<label>A line beneath the plate<input name="note" value="${esc(p.note || '')}" maxlength="400"></label><div class="hd-acts"><button class="btn">${p.id ? 'Save' : 'Hang the portrait'}</button>${p.id ? `</form><form method="post" action="/studio/hall/${p.id}/remove"><button class="link">Take down</button>` : ''}</form></div>`;
  return layout({ studio: true, title: 'The Hall of Patrons · Studio', body: `<section class="studio-wrap"><p class="k">Back office</p><h1>The Hall of Patrons.</h1>
<p class="lede">A portrait for each person who founded something here. Make the portrait, put it in the vault as a work (its own title, private or public), then hang it here by its slug. The sitter&rsquo;s consent to be shown is yours to hold. <a href="/patrons">See the hall</a>.</p>
${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
<h2>Hang a portrait</h2>${form()}
${patrons.length ? `<h2>In the hall</h2>${patrons.map(p => `<div class="hd-one">${p.slug ? `<img src="/img/${esc(p.slug)}/thumb" alt="">` : '<span class="hd-blank"></span>'}${form(p)}</div>`).join('')}` : ''}</section>` });
}

function claim({ c, maker, mine }) {
  if (!c) return layout({ title: 'Watermark', body: '<section class="cx-intro"><p class="k">Passed on</p><h1>This link has been used, or has expired.</h1><p><a class="buy-btn" href="/collection">Walk the collection</a></p></section>' });
  const { w, l } = c;
  return layout({ title: `${tidy(w.title)} · Watermark`, body: `<section class="cl"><div class="cl-im"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" draggable="false"></div><div class="cl-t"><p class="k">A work passed to you</p><h1><i>${esc(tidy(w.title))}</i></h1><p class="lot-maker">${esc(maker.name)}</p>
<p class="cl-no">Collector No. ${l.collector_no}${w.edition_size ? ` of ${w.edition_size}` : ''}</p>
${mine ? '<p class="note">This is the link you made. Send it to the person you are giving it to.</p>' : `<form method="post" class="seal-row cl-f">${seal(maker, 'Accept')}<div class="seal-t"><b>Accept</b><span>It hangs in your gallery with this number, and its file is yours.</span></div></form>`}</div></section>` });
}

// The basket: what has been gathered, each with its price and a way out of the basket; one payment for all.
// Notifications: what the house has told you, the devices it tells, and what you choose to hear about.
function noticesPage({ items, kinds, devices, key, name = '', saved = null, cover = null, maker = false }) {
  const when = t => { const d = new Date(String(t).replace(' ', 'T') + 'Z'); const s = (Date.now() - d) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const first = name ? esc(name.split(' ')[0]) : '';
  // What each choice means, in a line.
  const HINT = { licensed: 'The moment it happens: what, by whom, for how much, and its number.', requested: 'A company or a person asks for a use you approve yourself.', thanks: 'Someone sends a card to say the photograph meant something.', hat: 'A quiet one. Off unless you want every tip.', note: 'Someone writes a line about your work.', paid: 'Money on its way to your bank.', show: 'A curator opens your archive or sends you a show to approve.', reviewed: 'The maker approves or returns a show you hung.', answered: 'A maker accepts or declines what you asked for.', received: 'A numbered piece is passed to you.', placed: 'Someone collects through a wall you hung.' };
  const groups = [['Your work', kinds.filter(k => ['licensed', 'requested', 'thanks', 'hat', 'note', 'paid', 'show'].includes(k.key))], ['Your walls and your collecting', kinds.filter(k => !['licensed', 'requested', 'thanks', 'hat', 'note', 'paid', 'show'].includes(k.key))]].filter(g => g[1].length);
  const sample = cover ? `<div class="ntx"><p class="ntx-k">What a notice looks like</p><div class="ntx-card"><img src="/img/${esc(cover.slug)}/thumb" alt="" draggable="false"><div><p class="ntx-h"><span class="ntx-app">${WAVE_MARK}</span>Watermark<i>now</i></p><b>${esc(tidy(cover.title))} was collected</b><span>Collect &middot; $5 &middot; No.&nbsp;4 &middot; 85% is yours</span></div></div></div>` : '';
  return layout({ title: 'Notifications · Watermark', path: '/notices', body: `<section class="ntp" data-notices data-key="${esc(key)}">
<header class="ntp-hero"${cover ? ` style="--img:url('/img/${esc(cover.slug)}/large')"` : ''}><div class="ntp-in">
<p class="k">${first ? `${first}, the house will tell you` : 'The house will tell you'}</p>
<h1>${maker ? 'When your work is chosen, you will know.' : 'When something of yours moves, you will know.'}</h1>
<div class="ntp-dev"><span class="ntp-dot" aria-hidden="true"></span><p data-nt-state>Checking this device&hellip;</p><button type="button" class="ntp-on" data-nt-on hidden>Turn on notifications</button><button type="button" class="ntp-test" data-nt-test hidden>Send a test</button></div>
<p class="nt-ios" data-nt-ios hidden>On iPhone and iPad, notices come to the installed app: in Safari tap <b>Share</b>, then <b>Add to Home Screen</b>, open Watermark from its icon and come back here. <a href="/app">How</a></p>
</div></header>
${saved ? `<p class="ok ntp-ok">${esc(saved)}</p>` : ''}
<div class="ntp-body">
<div class="ntp-main">
${items.length ? `<p class="ntp-sk">Lately</p><ol class="nt-list">${items.map(n => `<li class="nt-it${n.read_at ? '' : ' new'}"><a href="${esc(n.href || '/notices')}">${n.slug ? `<img src="/img/${esc(n.slug)}/thumb" alt="" loading="lazy" draggable="false">` : `<span class="nt-mk">${I.bell}</span>`}<div><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ''}<small>${when(n.at)}</small></div></a></li>`).join('')}</ol>`
    : `<p class="ntp-sk">Lately</p><p class="ntp-empty">Nothing yet. ${maker ? 'The first time a work of yours is chosen, it will be here, and on your phone the moment it happens.' : 'When something of yours moves, it will be here.'}</p>${sample}`}
</div>
<form method="post" action="/notices/prefs" class="ntp-prefs" data-nt-prefs><p class="ntp-sk">Tell me when</p>
${groups.map(([t, ks]) => `<fieldset><legend>${esc(t)}</legend>${ks.map(k => `<label class="ntp-sw"><span><b>${esc(k.label)}</b><small>${esc(HINT[k.key] || '')}</small></span><input type="checkbox" name="on" value="${esc(k.key)}"${k.on ? ' checked' : ''}><i aria-hidden="true"></i></label>`).join('')}</fieldset>`).join('')}
<button class="bk-alt ntp-save">Save</button><p class="ntp-note" data-nt-saved>Every notice is kept here either way; these choose what reaches your devices. The letters the house sends by email stay as they are.</p></form>
</div>
${devices.length ? `<div class="ntp-devs"><p class="ntp-sk">Devices told</p><ul>${devices.map(d => `<li><span>${esc(/iPhone/.test(d.ua) ? 'iPhone' : /iPad/.test(d.ua) ? 'iPad' : /Android/.test(d.ua) ? 'Android' : /Mac/.test(d.ua) ? 'Mac' : /Windows/.test(d.ua) ? 'Windows' : 'A device')}</span><small>since ${esc(String(d.at).slice(0, 10))}</small><form method="post" action="/notices/unsubscribe"><input type="hidden" name="id" value="${d.id}"><button class="bk-alt">Stop</button></form></li>`).join('')}</ul></div>` : ''}
</section><script src="/static/notify.js?v=${VER}" defer></script>` });
}
// A file link opened on a phone: the photograph, and one button that hands it to the phone's share sheet (Save Image → Photos).
function savePage({ w, maker, file, ref }) {
  return layout({ title: `${tidy(w.title)} · Yours · Watermark`, path: `/c/${ref}`, body: `<section class="svp"><figure><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" draggable="false"></figure>
<p class="k">Yours</p><h1>${esc(tidy(w.title))}</h1><p class="svp-by">${esc(maker.name)}${w.place ? ` &middot; ${esc(w.place)}` : ''}</p>
<a class="buy-btn svp-go" href="${esc(file)}" download data-name="${esc(tidy(w.title))}">Save to Photos</a>
<p class="note">Tap, then <b>Save Image</b>. The file carries ${esc(maker.name.split(' ')[0])}&rsquo;s credit and your license. <a href="/c/${esc(ref)}">Your license</a> &middot; <a href="/yours">Your gallery</a></p></section>` });
}
function basketPage({ items, total, pocket = 0, covers = false, buy = true, note = null }) {
  const n = items.length;
  return layout({ title: 'Your basket · Watermark', desc: 'Work gathered to collect together.', path: '/basket', body: `<section class="bk">
<p class="k">Your basket</p><h1>${n ? `${n} photograph${n === 1 ? '' : 's'}, collected together.` : 'The basket is empty.'}</h1>
${note ? `<p class="ok">${esc(note)}</p>` : ''}
${n ? `<ol class="bk-list" data-bk-list>${items.map(x => `<li class="bk-it" data-slug="${esc(x.w.slug)}"><a class="bk-th" href="/m/${esc(makerSlug(x.maker))}/${esc(x.w.slug)}"><img src="/img/${esc(x.w.slug)}/thumb" alt="" loading="lazy" draggable="false"></a><div class="bk-t"><a href="/m/${esc(makerSlug(x.maker))}/${esc(x.w.slug)}"><b>${esc(tidy(x.w.title))}</b></a><span>${esc(x.maker.name)}${x.w.place ? ` &middot; ${esc(x.w.place)}` : ''}</span><small>Collect: yours to keep and share, credited</small></div><span class="bk-p">${money(x.price)}</span><button type="button" class="bk-x" data-bk-remove="${esc(x.w.slug)}" aria-label="Take out of the basket">${I.close}</button></li>`).join('')}</ol>
<div class="bk-sum"><span>${n} photograph${n === 1 ? '' : 's'}</span><b>${money(total)}</b></div>
<p class="bk-split">85% of every one goes to its photographer.</p>
<div class="bk-go">${covers ? `<form method="post" action="/basket/collect"><input type="hidden" name="from" value="pocket"><button class="buy-btn">Collect all ${n}, from your pocket</button></form><p class="bk-note">Your pocket holds ${money(pocket)}. One tap, no checkout.</p>` : ''}
${buy ? `<form method="post" action="/basket/collect"><button class="${covers ? 'bk-alt' : 'buy-btn'}">${covers ? 'Pay by card instead' : `Collect all ${n} &middot; ${money(total)}`}</button></form>${covers ? '' : '<p class="bk-note">One payment: Apple Pay, Google Pay or card. Each work is numbered in your gallery, with its file and certificate.</p>'}` : '<p class="note">Payments are not open yet.</p>'}
<a class="bk-more" href="/collection">Keep looking</a></div>` : `<p class="lede">Tap <b>Add to basket</b> on any photograph, keep looking, and collect them all at once.</p><p><a class="buy-btn" href="/collection">Walk the collection</a> <a class="bk-more" href="/stroll">Or stroll</a></p>`}
</section><script src="/static/basket.js?v=${VER}" defer></script>` });
}
function setThanks({ items, name }) {
  const done = items.every(l => l.status === 'active');
  return layout({ title: 'Yours · Watermark', body: `<section class="cx-intro sr-thanks"><p class="k">${esc(name)}</p><h1>${done ? 'They&rsquo;re yours.' : 'Payment received. Preparing your files.'}</h1>
<p class="lede">${done ? `${items.length} works, each numbered and hung in <a href="/yours">your gallery</a>. Save them below; every file carries its maker&rsquo;s credit.` : 'This takes a few seconds. Refresh the page in a moment.'}</p></section>
<section class="gal"><div class="st-grid">${items.map(l => `<div class="st-it"><img src="/img/${esc(l.slug)}/thumb" alt="${esc(tidy(l.title))}" loading="lazy" draggable="false"><i>${esc(tidy(l.title))}</i><small>${l.collector_no ? `Collector No.&nbsp;${l.collector_no}` : ''}</small>${done && l.download_token ? `<a href="/d/${esc(l.download_token)}" download>Save</a>` : ''}</div>`).join('')}</div>
<p class="sr-also"><a class="buy-btn" href="/yours">See your gallery</a></p></section>` });
}

function thanks({ lic, w, maker, use }) {
  const done = lic.status === 'active';
  return layout({
    title: done ? `It's yours · ${w.title}` : 'One moment · Watermark',
    body: `${done ? '' : '<meta http-equiv="refresh" content="3">'}<section class="yours${done ? ' in' : ''}">
<div class="yours-fig"><img src="/img/${esc(w.slug)}/screen" alt="${esc(w.title)}" draggable="false"><span class="yours-seal" aria-hidden="true"><img src="/static/wave.svg" alt=""></span></div>
<div class="yours-t">
<p class="k">${esc(lic.ref)}</p>
<h1>${done ? 'It&rsquo;s yours. Thank you.' : 'Payment received. Preparing your file.'}</h1>${done && lic.collector_no ? `<p class="yc-big">Collector No. ${lic.collector_no}${w.edition_size ? ` of ${w.edition_size}` : ''}, <em>${esc(tidy(w.title))}</em>. <a href="/yours">It hangs in your gallery.</a></p>` : ''}
<p class="lede">${done ? `<em>${esc(w.title)}</em> by ${esc(maker.name)}. ${use.kind === 'print' ? 'A signed archival print, yours to keep. It ships within the week.' : `Licensed ${esc(use.name.toLowerCase())}${lic.ends_at ? ` until ${date(lic.ends_at)}` : ''}.`} ${lic.licensee_email ? `A copy of everything is on its way to ${esc(lic.licensee_email)}.` : ''}` : 'This takes a few seconds.'}</p>
${done ? `<div class="yours-a">${lic.download_token ? `<a class="buy-btn" href="/d/${esc(lic.download_token)}">Download the full file</a>` : ''}
<a class="yours-l" href="/c/${esc(lic.ref)}.pdf">Certificate (PDF)</a><a class="yours-l" href="/c/${esc(lic.ref)}?k=${esc(lic.download_token || '')}">License page</a><a class="yours-l" href="/verify?ref=${esc(lic.ref)}">Verify</a></div>
<p class="note">The file carries its license inside it: maker, collector, reference and term. ${esc(maker.name)} has been paid.</p>
${lic.collector_no ? `<p class="yours-proof"><span class="k">The proof</span> Hold it in your hand: a 5 × 7 print from the house’s print room, on Hahnemühle Photo Rag, your number in pencil, posted. <a href="/yours/p/${esc(lic.ref)}?k=${esc(lic.download_token || '')}#print">Ask for the proof →</a></p>` : ''}` : ''}
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

// A seat on someone's license: the person it was shared with sees what it covers and keeps it.
function seat({ s, l, live, mine }) {
  const who = l.licensee_company || l.licensee_name || 'A license holder';
  return layout({ title: `${tidy(l.title)} · A seat on license ${l.ref} · Watermark`, body: `<section class="lc2 seat-pg">
<figure class="lc2-fig"><img src="/img/${esc(l.slug)}/screen" alt="${esc(tidy(l.title))}" draggable="false"></figure>
<div class="lc2-side"><p class="lc2-st s-${live ? 'active' : 'expired'}"><i></i>${live ? 'Shared with you' : 'Ended'}</p>
<h1>${esc(tidy(l.title))}</h1>
<p class="lc2-says">${esc(who)} holds this photograph for ${esc(l.use_name.toLowerCase())}${l.ends_at ? `, until ${date(l.ends_at)}` : ''}, and has given you a seat on the license${s.name ? `, ${esc(s.name)}` : ''}.</p>
<dl class="lc2-dl"><div><dt>License</dt><dd>${esc(l.ref)}</dd></div><div><dt>For</dt><dd>${esc(l.use_name)}</dd></div><div><dt>Your seat</dt><dd>Inside ${esc(who)}&rsquo;s use; it does not pass to another company.</dd></div></dl>
<div class="lc2-acts">${mine ? (live ? `<a class="buy-btn" href="/seat/${esc(s.token)}/file">Download the photograph</a>` : '') + `<a href="/yours">Your gallery</a>`
  : s.buyer_id ? '<p class="note">This seat has been taken. Ask the person who shared it with you.</p>'
  : live ? `<form method="post" action="/seat/${esc(s.token)}" style="flex:1 1 100%"><button class="buy-btn" style="width:100%">Keep it in my gallery</button></form>` : ''}
<a href="/c/${esc(l.ref)}">The license</a></div></div></section>` });
}


// Friends of the house: the wall, the levels, a gift of any amount. The Krafft Collection is kept by its friends.
function friends({ levels, letter = [], once, houses, open, walls, counts, mine, unavailable }) {
  // The ladder: friend, patron, benefactor, and the Medici set apart. Above it, the house takes letters.
  const lv = (house) => levels.map(l => `<label class="fr-lv${l.key === 'medici' ? ' fr-med' : ''}"><input type="radio" name="level" value="${l.key}" form="give-${house}"><b>${esc(l.name)}</b><em>${money(l.cents)} a month${l.year ? `<small>or ${money(l.year)} a year</small>` : ''}</em><span>${esc(l.gives)}</span>${l.year ? `<label class="fr-yr"><input type="checkbox" name="interval" value="year" form="give-${house}"> Once a year instead</label>` : ''}</label>`).join('');
  const wallOf = (house) => walls[house].length ? `<ul class="fr-wall">${walls[house].map(f => `<li class="fr-${esc(f.level)}"><b>${esc(f.name)}</b><span>${f.level === 'once' ? 'gave' : esc(levels.find(x => x.key === f.level) ? levels.find(x => x.key === f.level).name : f.level)}${f.started_at ? ` &middot; ${new Date(f.started_at).getFullYear()}` : ''}</span></li>`).join('')}</ul>` : '<p class="nt-0">The first name on this wall is still to be written.</p>';
  const give = (house) => `<form method="post" action="/friends" class="fr-give" id="give-${house}"><input type="hidden" name="house" value="${house}"><div class="fr-lvs">${lv(house)}</div>
<div class="fr-once"><span>Or once, any amount</span>${once.map(c => `<button name="once" value="${c / 100}">${money(c)}</button>`).join('')}<label class="fr-own"><i>$</i><input name="amount" inputmode="decimal" placeholder="Your amount"></label><button class="btn">Give</button></div>
<button class="buy-btn fr-join">Become a ${houses[house]} friend</button></form>`;
  return layout({ title: 'Friends of Watermark · Watermark', desc: 'The Krafft Collection is kept by its friends. Become a friend of Watermark or of Krafft, monthly or once.', path: '/friends', body: `<section class="cx-intro fr-intro"><p class="k">Friends of the house</p>
<h1>Every collection worth seeing is kept by someone.</h1>
<p class="lede">The Frick is kept by its friends; so is the Met. Watermark is an archive first: it holds photographs at the source, fingerprints them, serves them and protects them, for as long as there is a Watermark. The Krafft Collection is its first collection. Friends keep it open.</p>
${unavailable ? '<p class="err">Giving is unavailable for a moment. Try again shortly.</p>' : ''}${!open ? '<p class="note">Giving opens when payments go live.</p>' : ''}</section>
<section class="gal fr-two">
<div class="fr-house" id="watermark"><header class="gh"><h2>Friends of Watermark</h2><span>${counts.watermark} friend${counts.watermark === 1 ? '' : 's'}</span></header><p class="fr-what">Keeps the archive: the vault, the register, the Shield, and the work of holding every maker&rsquo;s work for good.</p>${mine.watermark.length ? '<p class="ok">You are a friend of Watermark. Thank you.</p>' : ''}${give('watermark')}</div>
<div class="fr-house" id="krafft"><header class="gh"><h2>Friends of Krafft</h2><span>${counts.krafft} friend${counts.krafft === 1 ? '' : 's'}</span></header><p class="fr-what">Keeps the house: Krafft Studios and its stories, the Krafft Collection, and what the collection acquires next.</p>${mine.krafft.length ? '<p class="ok">You are a friend of Krafft. Thank you.</p>' : ''}${give('krafft')}</div></section>
${letter.length ? `<section class="fr-letter" id="letter"><div class="fr-letter-in"><p class="k">By letter</p><h2>Above the Medici, there is no price on the page.</h2>
<p class="lede">Some gifts are a name on something that lasts. These are arranged in a letter and a conversation, the way the great houses have always done it.</p>
<div class="fr-lt">${letter.map(l => `<div><b>${esc(l.name)}</b><p>${esc(l.what)}</p></div>`).join('')}</div>
<p class="fr-write"><a href="/patrons">The Hall of Patrons</a> &middot; Write to the house: <a href="mailto:will@krafftco.com?subject=A%20letter%20to%20the%20house">will@krafftco.com</a>. Every letter is answered by Will Fullerton.</p></div></section>` : ''}
<section class="gal" id="wall"><header class="gh"><h2>The wall</h2><span>friends of the house</span></header><div class="fr-walls"><div><p class="k">Watermark</p>${wallOf('watermark')}</div><div><p class="k">Krafft</p>${wallOf('krafft')}</div></div>
<p class="note">Gifts to Watermark and Krafft support two companies, not a charity; they are not tax-deductible. A foundation for the collection is the plan, once there is a collection to found it on.</p></section>` });
}
function friendThanks({ f, house, level }) {
  return layout({ title: `Thank you · Watermark`, body: `<section class="narrow sr"><p class="k">Friends of ${esc(house)}</p>
<h1>${f.status === 'pending' ? 'One moment.' : level ? `You are a ${esc(level.name)} of ${esc(house)}.` : `Thank you. ${esc(house)} is kept by people like you.`}</h1>
<p class="lede">${f.status === 'pending' ? 'Your gift is being confirmed.' : level ? esc(level.gives) : 'Your name goes on the wall, if you want it there.'}</p>
${f.status !== 'pending' && f.buyer_id ? `<form method="post" action="/friends/${f.id}/name" class="form inline"><input name="name" value="${esc(f.name || '')}" placeholder="Your name, as it should read on the wall"><button class="btn">Set</button></form>` : ''}
<p class="sr-also"><a href="/friends#wall">The wall</a> &middot; <a href="/collection">The collection</a></p></section>` });
}
// Keeping: what the archive holds for a maker, the line it is free to, and the ladder above it.
function keeping({ m, works, weighed, gb, over, pct, tier, fits, plan, tiers, open, ok }) {
  setDeskPath('/account/keeping');
  const gbs = g => (g >= 1000 ? `${g / 1000} TB` : `${g} GB`), held = gb < 0.1 ? '<0.1 GB' : `${gb.toFixed(1)} GB`;
  const notice = { begun: 'Keeping has begun. Thank you for trusting the archive with your work.', moved: `Moved to ${tier.name}.`, ending: 'Keeping ends at the close of this period; the studio tier holds after that.', unavailable: 'Payment is unavailable for a moment.' }[ok];
  return layout({ title: 'Keeping · Watermark', studio: true, body: `<section class="narrow kp"><p class="k">Your studio</p><h1>Keeping.</h1>
<p class="lede">Watermark is an archive. Every work you hold here is fingerprinted, kept in the vault with its master, served at every size, protected by the Shield and written into the register. The studio is free to ${tiers[0].works} works or ${gbs(tiers[0].gb)}. Storage costs, so above that line a larger archive is kept for a monthly sum, by what it holds.</p>
${notice ? `<p class="${ok === 'unavailable' ? 'err' : 'ok'}">${esc(notice)}</p>` : ''}
<div class="kp-meter${over ? ' over' : ''}"><div class="kp-bar"><i style="width:${pct}%"></i></div><p><b>${works} photograph${works === 1 ? '' : 's'}, ${held}</b> held${weighed !== works ? ` (culled work weighs a quarter: ${weighed} toward the line)` : ''} · ${tier.name}: ${tier.works.toLocaleString()} works or ${gbs(tier.gb)}${over ? ` · <em>above the line${fits ? `; ${fits.name} would hold it` : '; write to the house'}</em>` : ''}</p></div>
<div class="kp-tiers">${tiers.map(t => `<div class="kp-tier${t.key === tier.key ? ' on' : ''}"><p class="k">${t.key === tier.key ? 'Yours now' : fits && fits.key === t.key && over ? 'Would hold it' : '&nbsp;'}</p><h2>${esc(t.name)}</h2><p class="kp-size">${t.works.toLocaleString()} works<br>or ${gbs(t.gb)}</p><p class="kp-price">${t.cents ? `${money(t.cents)} a month` : 'Free'}</p><p class="kp-gives">${esc(t.gives)}</p>
${t.key === tier.key ? (plan && plan.status === 'active' ? `<form method="post" action="/account/keeping/end"><button class="link">End Keeping</button></form>` : plan && plan.status === 'ending' ? '<p class="note">Ending at the close of this period.</p>' : '') : t.cents ? (open ? `<form method="post" action="/account/keeping"><input type="hidden" name="tier" value="${t.key}"><button class="buy-btn">${plan && plan.status === 'active' ? 'Move here' : 'Begin'}</button></form>` : '<p class="note">Opens when payments go live.</p>') : ''}</div>`).join('')}</div>
<p class="note">Above the line the archive still holds everything: a notice, never a block. Larger than the vault, reference masters, film: by letter to the house. Prices are drafts.</p>
<p class="sr-also"><a href="/account">Your studio</a></p></section>` });
}

// The house guest book: every line signed anywhere in Krafft, in chapters, newest first. A masthead for
// the house: who came, what they saw, what they said.
function guestbook({ lines, chapters, chapter, note, from, canModerate, me }) {
  const shown = chapter ? lines.filter(n => (n.work_id ? 'watermark' : n.chapter) === chapter) : lines;
  const line = n => `<li><span class="gb-d">${date(n.at)}<br><small>${esc(chapters[n.work_id ? 'watermark' : n.chapter] || '')}</small></span><p class="gb-p">${esc(n.body)}</p><span class="gb-s">${n.public && n.code ? `<a href="/collector/${esc(n.code)}">${esc(n.name || 'A visitor')}</a>` : esc(n.name || 'A visitor')}${n.wslug ? `<small class="gb-on">on <a href="/w/${esc(n.wslug)}#notes">${esc(tidy(n.wtitle))}</a>, ${esc(n.maker)}</small>` : ''}</span>${n.seen_at ? `<span class="gb-ws">${HAT}Well seen</span>` : ''}${!n.work_id && (canModerate || (me && n.buyer_id === me)) ? `<form method="post" action="/guestbook/${n.id}/remove" class="gb-rm"><button class="link">Remove</button></form>` : ''}</li>`;
  return layout({ title: 'The guest book · Krafft', desc: 'The guest book of the house of Krafft: who came, what they saw, what they said.', path: '/guestbook', body: `<section class="cx-intro gbk"><p class="k">The house of Krafft</p>
<h1>The guest book.</h1>
<p class="lede">One book for the whole house: Krafft, Krafft Studios, Advisory, Ventures, Watermark and Dallas Golf Club. Whoever comes through any of our doors may sign it, as you would in someone&rsquo;s home. Every line is kept, under the name that signed it.</p>
<p class="nt-ep">It is easy to be clever about a picture and hard to be useful to the person who made it. A line here costs nothing to write and is kept for good, under your name. Write the one you would want to find beneath your own work.</p>
<nav class="gbk-ch"><a href="/guestbook"${chapter ? '' : ' aria-current="page"'}>Every chapter</a>${Object.entries(chapters).map(([k, v]) => `<a href="/guestbook?chapter=${k}"${chapter === k ? ' aria-current="page"' : ''}>${esc(v)}</a>`).join('')}</nav></section>
<section class="gal gbk-book">${shown.length ? `<ol class="gb">${shown.map(line).join('')}</ol>` : '<p class="nt-0">This chapter is open. No one has signed yet.</p>'}</section>
<section class="gal gbk-sign" id="sign"><header class="gh"><h2>Sign the book</h2></header>
${note === '1' ? '<p class="ok">Signed. Thank you for coming.</p>' : note === 'check' ? '<p class="err">A line and your name, please, without links.</p>' : note === 'kind' ? '<p class="err">Not in this house. Say it as you would to our faces.</p>' : note === 'slow' ? '<p class="err">A moment, please.</p>' : ''}
<form method="post" action="/guestbook" class="gb-f"><label class="gb-l"><span>Which door you came through</span><select name="chapter">${Object.entries(chapters).filter(([k]) => k !== 'watermark').map(([k, v]) => `<option value="${k}"${chapter === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
<label class="gb-l"><span>A line for the book</span><textarea name="body" rows="2" maxlength="280" placeholder="What brought you, what you found, or a word for the house." required></textarea></label>
<div class="gb-row"><label class="gb-l gb-n"><span>Signed</span><input name="name" placeholder="Your name" maxlength="60" required autocomplete="name"></label><button class="btn">Sign the book</button></div>
<p class="note">To sign beneath a work, open it and sign there; those lines appear here too, in the Watermark chapter.</p></form>
${from ? `<p class="sr-also"><a href="${esc(from)}">Back to where you were</a></p>` : ''}</section>` });
}
// The license, as the person who holds it should see it: the photograph, what they may do with it, until
// when, and what to keep in mind. The proof (fingerprint, register entry) is there for anyone who asks,
// folded away; nobody needs to read a hash to trust a license.
const USE_SAYS = {
  social: 'on their own accounts, credited',
  reference: 'as their own: to keep, to print large and to share, credited',
  editorial: 'in a story: a feature, a book, an essay or a report, with the maker named',
  commercial: 'for their company: a website, a presentation, a letter to investors',
  campaign: 'before an audience: a campaign, a film, a billboard, a package',
};
// What a holder can and cannot do, in plain words, from the contract they hold. The license page and the letter
// that delivers it say the same thing.
function plainRights(lic, use, t = null) {
  const C = require('./contract');
  const cond = String(lic.conditions || '');
  const never = [/AI/i.test(cond) && 'ai', /altering/i.test(cond) && 'alter', /political/i.test(cond) && 'political', /tobacco/i.test(cond) && 'sensitive'].filter(Boolean);
  const tt = t || C.terms({ use, never, base: lic.price_cents });
  const can = [], cannot = [];
  if (use.kind === 'print') { can.push('Hang it, live with it, show it anywhere', 'Sell it or give it away, as an object'); cannot.push('Photograph, scan or reproduce it'); }
  else if (tt.personal) { can.push('Post it on your own accounts', 'Set it as your lock screen or wallpaper', use.key === 'reference' ? 'Print it large for your own walls' : 'Keep the file for good'); cannot.push('Use it for a business, a brand or a client'); }
  else {
    can.push('Use it in ' + C.RIGHTS.filter(r => tt.rights.includes(r.key)).map(r => r.label.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1'));
    can.push('Share it on your own accounts, credited');
    can.push(tt.extras.includes('entities') ? 'Use it for more than one company or client' : 'Use it for one company or client');
    if (lic.ends_at) can.push(`Keep using it until ${date(lic.ends_at)}`);
    if (tt.extras.includes('merchandise')) can.push('Put it on goods for sale'); else cannot.push('Put it on goods for sale: prints, cards, apparel');
    cannot.push('Make it part of a logo or trademark');
  }
  if (use.kind !== 'print') {
    if (tt.extras.includes('derivative')) can.push('Adapt it: retouch, recolour, combine'); else { can.push('Resize it and crop it lightly'); cannot.push('Change the picture itself'); }
    cannot.push('Let others download it as a file', 'Pass the license to someone else');
  }
  if (never.includes('ai')) cannot.push('Train or test AI with it');
  if (never.includes('political')) cannot.push('Use it in politics or advocacy');
  if (never.includes('sensitive')) cannot.push('Use it for tobacco, firearms or gambling');
  cannot.push('Say you made it');
  return { can, cannot, cond, never };
}
function certificate({ lic, w, maker, use, entry, base, owner, seats = null, seat = null, dl = null, resend = null }) {
  const active = lic.status === 'active';
  const who = lic.licensee_company || lic.licensee_name || 'The holder';
  const C = require('./contract');
  let t = null; try { t = lic.rights ? JSON.parse(lic.rights) : null; } catch (e) { /* older license */ }
  const added = t ? C.RIGHTS.filter(r => t.added.includes(r.key)).map(r => r.label.toLowerCase()) : [];
  const extras = t ? t.extras.map(k => (C.EXTRAS.find(e => e.key === k) || {}).label).filter(Boolean) : [];
  const status = { active: 'Licensed', requested: 'Requested', awaiting_payment: 'Awaiting payment', declined: 'Declined', expired: 'Ended' }[lic.status] || lic.status;
  const says = use.kind === 'print' ? `${esc(who)} owns this print: signed, archival, theirs to keep.`
    : `${esc(who)} may use this photograph ${esc(USE_SAYS[use.key] || use.name.toLowerCase())}${added.length ? `, and also in ${esc(added.join(', '))}` : ''}${extras.length ? `. Included: ${esc(extras.join(', ').toLowerCase())}` : ''}${active ? (lic.ends_at ? `, until ${date(lic.ends_at)}.` : ', for good.') : '.'}`;
  let left = '';
  if (active && lic.ends_at && lic.starts_at) {
    const a = new Date(lic.starts_at).getTime(), z = new Date(lic.ends_at).getTime(), now = Date.now();
    const pct = Math.max(0, Math.min(100, (now - a) / (z - a) * 100)), days = Math.max(0, Math.ceil((z - now) / 864e5));
    left = `<div class="lc2-term"><div class="lc2-bar"><i style="width:${pct.toFixed(1)}%"></i></div><span>${date(lic.starts_at)}</span><span>${days ? `${days.toLocaleString('en-US')} day${days === 1 ? '' : 's'} left` : 'Ends today'}</span><span>${date(lic.ends_at)}</span></div>`;
  }
  const { can, cannot, cond } = plainRights(lic, use, t);
  const keep = cond.split(/\.\s*/).map(x => x.trim()).filter(Boolean);
  return layout({
    title: `${tidy(w.title)}: license ${lic.ref} · Watermark`,
    body: `<section class="lc2">
<figure class="lc2-fig lc2-print"><div class="pr-mat"><a class="pr-win" href="/w/${esc(w.slug)}" style="--r:${w.width && w.height ? (w.width / w.height).toFixed(3) : 1.5}"><img src="/img/${esc(w.slug)}/large" alt="${esc(tidy(w.title))}" draggable="false"></a>
<figcaption class="pr-cap"><span class="pr-no">${lic.collector_no ? `${lic.collector_no}${w.edition_size ? ` / ${w.edition_size}` : ''}` : ''}</span><span class="pr-t"><i>${esc(tidy(w.title))}</i>${w.taken_at ? `, ${String(w.taken_at).slice(0, 4)}` : ''}</span><span class="pr-sig">${esc(maker.name)}</span><span class="pr-emb" aria-hidden="true">${WAVE_MARK}</span></figcaption></div>
${owner && active && lic.download_token && dl && dl.left ? `<p class="pr-take"><a class="buy-btn" href="/d/${esc(lic.download_token)}" download>Take the file</a><small>${use.key === 'social' ? 'The 2400-pixel copy' : use.key === 'reference' ? 'The full original' : 'The licensed file'}, with your name, the maker's copyright and this license written into it, and a mark within the picture that is yours alone.</small></p>` : ''}${resend && resend.room ? `<p class="pr-room"><a href="${esc(resend.room)}">Print it, hang it, live with it &rarr;</a></p>` : ''}${resend ? `<form class="pr-again" id="again" method="post" action="/c/${esc(lic.ref)}/resend">${resend.sent ? `<p class="pr-sent">${resend.sent === 'no' ? 'That address did not look right. Try once more.' : resend.sent === 'slow' ? 'Sent a moment ago. Give it a few minutes, and look in Promotions or Spam.' : `Sent to ${esc(resend.sent)}. It carries the file, the certificate and the agreement.`}</p>` : ''}<label><span>The letter, the file and the agreement, sent again</span><input type="email" name="email" required maxlength="160" value="${esc(resend.email || '')}" placeholder="Your email" autocomplete="email"></label><button>Send it to me</button></form>` : ''}</figure>
<div class="lc2-side">
<p class="lc2-st s-${esc(lic.status)}"><i></i>${esc(status)}</p>
<h1>${esc(tidy(w.title))}</h1>
<p class="lc2-by">${OBJ.kindWord(w)} by ${mlink(maker.name)}</p>
<p class="lc2-says">${says}</p>
${left}
<dl class="lc2-dl">
<div><dt>Licensed to</dt><dd>${esc(who)}</dd></div>
<div><dt>For</dt><dd>${esc(use.name)}</dd></div>
${lic.price_cents != null ? `<div><dt>Paid</dt><dd>${money(lic.price_cents, lic.currency)}${lic.collector_no ? ` &middot; No.&nbsp;${lic.collector_no}` : ''}</dd></div>` : ''}
<div><dt>Credit</dt><dd>${OBJ.kindWord(w)} by ${mlink(maker.name)}</dd></div>
</dl>
<div class="lc2-cc"><div><p class="lc2-h">You can</p><ul>${can.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div><div><p class="lc2-h">You can&rsquo;t</p><ul class="no">${cannot.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
<div class="lc2-acts">
${owner && active && lic.download_token ? (dl && !dl.left ? '<p class="lc2-dl0">Every download has been used. The files you have are still licensed.</p>' : `<a class="buy-btn" href="/d/${esc(lic.download_token)}">Download the photograph</a>${use.key !== 'social' && use.kind !== 'print' ? `<a href="/d/${esc(lic.download_token)}?size=share">Share-size copy</a>` : ''}`) : ''}
${owner && dl ? `<span class="lc2-dln">${dl.left} of ${dl.limit} downloads left</span>` : ''}
${owner && lic.download_token ? `<a href="/c/${esc(lic.ref)}/contract?k=${esc(lic.download_token)}">The agreement</a>` : ''}
${active ? `<a href="/c/${esc(lic.ref)}.pdf">Certificate (PDF)</a>` : ''}
<a href="/t/${esc(require('./track').compact(lic.ref) || lic.ref)}">Anyone can check it: ${esc(require('./track').track(lic.ref) || lic.ref)}</a>
</div>
<div class="lc2-coa">${SHIELD}<div><p class="lc2-h">Certificate of authenticity</p>
<p>This certifies that the photograph above is an original work by ${esc(maker.name)}, held on Watermark${w.accession ? ` as ${esc(w.accession)}` : ''} since ${date(w.created_at)}, and that ${esc(who)} holds the license set out here${active ? `, granted on ${date(lic.starts_at)}` : ''}.</p>
<p class="lc2-sig"><span>${esc(maker.name)}</span><small>The maker, through Watermark</small></p>
${t && t.hash && active ? `<p class="lc2-acc">Agreement accepted by ${esc(who)} at payment on ${date(lic.starts_at)}. Order ${esc(lic.ref)}.</p>` : ''}</div></div>
${owner && seats && seats.capacity > 1 && lic.download_token ? `<section class="lc2-seats" id="seats"><p class="lc2-h">People on this license <span>${seats.list.length + 1} of ${seats.capacity} seats</span></p>
<p class="lc2-sn">Everyone at ${esc(who)} who works with the photograph can hold the license too: the file, the agreement and the dates, in their own collection. Each seat is recorded.</p>
${seat && seat.length > 12 ? `<p class="ok">Seat added. Their link: <input class="lc2-link" readonly value="${esc(base)}/seat/${esc(seat)}" onclick="this.select()"></p>` : seat === 'full' ? '<p class="err">Every seat is in use. Remove one, or add more below.</p>' : seat === 'added' ? '<p class="ok">Seats added.</p>' : seat === 'unavailable' ? '<p class="err">Payment is unavailable for a moment. Try again shortly.</p>' : seat === 'email' ? '<p class="err">An email address, so they can be sent their link.</p>' : seat === 'ended' ? '<p class="err">This license has ended.</p>' : ''}
<ul class="lc2-sl"><li><b>${esc(who)}</b><span>Holder</span></li>${seats.list.map(x => `<li><b>${esc(x.name || x.email)}</b><span>${x.claimed_at ? 'In their gallery' : 'Link sent'}</span><form method="post" action="/c/${esc(lic.ref)}/seats/${x.id}/remove"><input type="hidden" name="k" value="${esc(lic.download_token)}"><button class="link">Remove</button></form></li>`).join('')}</ul>
${seats.canBuy && active ? `<form method="post" action="/c/${esc(lic.ref)}/seats/buy" class="lc2-sb"><input type="hidden" name="k" value="${esc(lic.download_token)}"><span>More people?</span><select name="n" aria-label="Seats to add">${[1, 2, 3, 5, 10].map(n => `<option value="${n}">${n} seat${n === 1 ? '' : 's'}, ${money(n * seats.price)}</option>`).join('')}</select><button class="link">Add seats</button></form>` : ''}
${seats.list.length + 1 < seats.capacity && active ? `<form method="post" action="/c/${esc(lic.ref)}/seats" class="lc2-sf"><input type="hidden" name="k" value="${esc(lic.download_token)}"><input name="name" placeholder="Name" autocomplete="off"><input name="email" type="email" placeholder="Email" required autocomplete="off"><button class="btn">Add a seat</button></form>` : ''}</section>` : ''}
<details class="lc2-proof"><summary>How we know it&rsquo;s genuine</summary>
<p>Every license is written into Watermark&rsquo;s permanent record the moment it is granted, and each entry is sealed to the one before it, so nothing can be changed afterwards without it showing. The photograph is identified by its fingerprint, so this license belongs to this exact picture and no other.</p>
<dl class="lc2-dl lc2-tech"><div><dt>Watermark number</dt><dd class="wm-no">${esc(require('./track').track(lic.ref) || lic.ref)}</dd></div><div><dt>License</dt><dd>${esc(lic.ref)}</dd></div>${entry ? `<div><dt>Record</dt><dd>Entry ${entry.seq}, ${date(entry.at || lic.starts_at)} &middot; <code>${esc(entry.hash.slice(0, 16))}</code></dd></div>` : ''}<div><dt>Fingerprint</dt><dd><code>${esc(String(w.sha256 || '').slice(0, 16))}</code></dd></div>${t && t.hash ? `<div><dt>Agreement</dt><dd>Text fingerprint <code>${esc(t.hash.slice(0, 16))}</code></dd></div>` : ''}</dl>
<p class="note">The full record is public at <a href="/ledger">the register</a>.</p></details>
</div></section>
<section class="lc2-learn"><p class="k">Licensing, simply</p><div class="lc2-cards">
<div><b>The photographer keeps the copyright.</b><p>Owning a file, or even a print, doesn&rsquo;t give you the right to copy it. The copyright stays with the person who made the picture.</p></div>
<div><b>A license is permission for a use.</b><p>It says what you may do, where, and for how long. Pay for the use you need; anything more is a new license.</p></div>
<div><b>Credit is part of the price.</b><p>Name the photographer wherever the use allows: &ldquo;Photograph by ${esc(maker.name)}.&rdquo; It is how their work finds its next buyer.</p></div>
<div><b>When it ends, it ends.</b><p>${lic.ends_at ? 'At the end of the term, take it down or renew. Watermark reminds you a month before.' : 'This one has no end date. Keep it within its use and it is yours to keep.'}</p></div>
</div></section>
<section class="lc2-plain"><p class="k">In plain language</p>
<p>${esc(maker.name)} keeps the copyright and grants ${esc(who)} this license for the use above${lic.intended_use ? `, described as &ldquo;${esc(lic.intended_use)}&rdquo;` : ''}. Credit ${esc(maker.name)} wherever the use allows. Anything beyond it needs a new license, which takes a minute on Watermark. The full agreement is ${owner && lic.download_token ? `<a href="/c/${esc(lic.ref)}/contract?k=${esc(lic.download_token)}">here</a>` : `at <a href="/terms">the terms</a>`}.</p></section>`
  });
}

function verify({ ref, lic, w, notFound }) {
  return layout({
    title: 'Verify a license · Watermark',
    body: `<section class="narrow"><p class="k">Verify</p><h1>Is this use licensed?</h1>
<form method="get" action="/verify" class="inline"><input name="ref" placeholder="WM-2026-000001" value="${esc(ref)}"><button>Check</button></form>
<h2>Is this the real thing?</h2>
<p class="lede">Drop a Watermark archive (<code>.wmark</code>) or any image here. The house checks the signature on its papers, the original inside against its fingerprint, and the register; an image is matched to the vault byte for byte, or by its picture.</p>
<form method="post" action="/verify" enctype="multipart/form-data" class="vf-drop" data-vf><input type="file" name="file" accept=".wmark,image/*,application/zip" required><span class="vf-say">Choose a file, or drop it here</span><button>Verify</button></form>
<script>(function(){var f=document.querySelector('[data-vf]');if(!f)return;var i=f.querySelector('input');i.addEventListener('change',function(){if(i.files[0])f.querySelector('.vf-say').textContent=i.files[0].name;});f.addEventListener('dragover',function(e){e.preventDefault();f.classList.add('on')});f.addEventListener('dragleave',function(){f.classList.remove('on')});f.addEventListener('drop',function(e){e.preventDefault();f.classList.remove('on');i.files=e.dataTransfer.files;f.querySelector('.vf-say').textContent=i.files[0]?i.files[0].name:'';});})();</script>
${lic ? `<p class="lede">License <a href="/c/${esc(lic.ref)}">${esc(lic.ref)}</a> for <em>${esc(w.title)}</em> is <b>${esc(lic.status === 'active' ? 'active' : lic.status.replace('_', ' '))}</b>${lic.ends_at ? ` until ${date(lic.ends_at)}` : ''}.</p>` : notFound ? '<p class="lede">No license with that reference. If you have seen this work used, the maker would like to know.</p>' : ''}
</section>`
  });
}

// What the house says of a file dropped on /verify.
function verifyFile({ r, name, maker }) {
  const w = r.w || null;
  const plate = w ? `<a class="vf-pl" href="/w/${esc(w.slug)}"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}"><span><b>${esc(tidy(w.title))}</b><small>${esc(w.accession || '')}${maker ? ` · ${esc(maker.name)}` : ''}</small></span></a>` : '';
  const checks = r.checks ? `<ul class="vf-checks">${r.checks.map(c => `<li class="${c.ok ? 'yes' : 'no'}"><i></i><span><b>${esc(c.k)}</b><small>${esc(c.note)}</small></span></li>`).join('')}</ul>` : '';
  return layout({ title: 'Verified · Watermark', body: `<section class="narrow vf"><p class="k">Verify · ${esc(name)}</p>
<h1 class="${r.genuine ? 'vf-yes' : 'vf-no'}">${r.genuine ? 'Genuine.' : r.held ? 'The original; its papers do not fully verify.' : r.w ? 'Not the original.' : 'Unknown to the house.'}</h1>
<p class="lede">${esc(r.say)}</p>${plate}${checks}${w ? '<p class="vf-home"><a href="/yours/add">Is it yours? Bring it home to your gallery &rarr;</a></p>' : ''}
${r.h ? `<p class="note">SHA-256 of ${r.kind === 'wmark' ? 'the original inside' : 'the file'}: <code>${esc(r.h)}</code></p>` : ''}
<p class="note"><a href="/verify">Verify another</a>${w ? ` · <a href="/w/${esc(w.slug)}/life">The life of this photograph</a>` : ''}</p></section>` });
}

// The register: the life of the house, day by day. A photograph enters, is seen, is tipped a hat, is
// collected, is licensed, changes hands. The hash of each entry is kept small at the end of the line.
function registerPage({ told, check, counts, chapters = {}, chapter = null, spans = {}, span = 'all', order = 'newest', tally = {} }) {
  const q = (c, sp, o) => `/ledger?${[c ? `chapter=${c}` : '', sp && sp !== 'all' ? `span=${sp}` : '', o === 'oldest' ? 'order=oldest' : ''].filter(Boolean).join('&')}`.replace(/\?$/, '');
  const dayOf = at => new Date(at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  const timeOf = at => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const days = [];
  for (const x of told) { const d = dayOf(x.e.at); if (!days.length || days[days.length - 1].day !== d) days.push({ day: d, items: [] }); days[days.length - 1].items.push(x); }
  const MARK = { birth: WAVE_MARK, applause: HAT, collect: WAVE_MARK, trade: WAVE_MARK, patron: WAVE_MARK, office: '<span class="rg-c">&copy;</span>', life: '' };
  const row = ({ e, line }) => `<li class="rg-i rg-${line.kind}">${line.work ? `<a class="rg-im" href="/w/${esc(line.work.slug)}" style="--r:${line.work.width && line.work.height ? (line.work.width / line.work.height).toFixed(3) : 1.5}"><img src="/img/${esc(line.work.slug)}/thumb" alt="" loading="lazy" draggable="false"></a>` : `<span class="rg-im rg-none">${MARK[line.kind] || ''}</span>`}<p class="rg-t">${line.text}</p><span class="rg-m"><time>${timeOf(e.at)}</time><code title="Entry ${e.seq}, chained to the one before it">${esc(e.hash.slice(0, 10))}</code></span></li>`;
  return layout({
    title: 'The register · Watermark', desc: 'The life of the house: every work that enters, every hat tipped, every piece collected, licensed or traded, recorded once and chained to the one before.', path: '/ledger',
    body: `<section class="cx-intro rg-intro"><p class="k">The register</p><h1>The life of the house, written once.</h1>
<p class="lede">Every work that enters, every hat tipped, every piece collected, licensed or passed on, every name on the wall: recorded here as it happens, each entry chained to the one before it so the past cannot be quietly changed. ${check.ok ? `<b>${check.checked} entries, intact.</b>` : `<b class="err">The chain is broken at entry ${check.broken_at}.</b>`}</p>
<p class="rg-n"><span><b>${counts.works}</b> works entered</span><span><b>${counts.collected}</b> collected or licensed</span><span><b>${counts.hats}</b> tips of the hat</span><span><b>${counts.all}</b> entries in all</span></p></section>
<nav class="rg-nav"><div class="rg-ch"><a href="${q(null, span, order)}"${chapter ? '' : ' aria-current="page"'}>Everything</a>${Object.entries(chapters).map(([k, c]) => `<a href="${q(k, span, order)}"${chapter === k ? ' aria-current="page"' : ''}>${esc(c.name)}<small>${tally[k] || 0}</small></a>`).join('')}</div>
<div class="rg-sp">${Object.entries(spans).map(([k, v]) => `<a href="${q(chapter, k, order)}"${span === k ? ' aria-current="page"' : ''}>${esc(v[0])}</a>`).join('')}<span class="rg-sep"></span><a href="${q(chapter, span, order === 'newest' ? 'oldest' : 'newest')}">${order === 'newest' ? 'Oldest first' : 'Newest first'}</a></div></nav>
<section class="rg">${days.map(d => `<div class="rg-day"><h2>${esc(d.day)}</h2><ol>${d.items.map(row).join('')}</ol></div>`).join('') || `<p class="nt-0">${chapter || span !== 'all' ? 'Nothing in this chapter yet, in this span.' : 'The first entry is still to be written.'}</p>`}
<p class="note rg-foot">Sign-ins, keys and the people behind each entry are kept off this page. The full chain, with every hash, is at <a href="/ledger.json">/ledger.json</a>.</p></section>`
  });
}

function about() {
  // The why, in Will's words. A draft until he confirms it.
  return layout({
    title: 'About · Watermark', desc: 'Why Watermark exists: to see photographs properly, to wander, to learn, and to give artists one place for the whole of their working life.', path: '/about',
    body: `<section class="narrow prose ab"><p class="k">About</p><h1>I started Watermark because I could not stand how photographs are shown.</h1>
<p class="lede">Small, compressed, buried in feeds and stock sites, a watermark across the face of them. The work of a life, shown worse than a menu. I wanted a place where you could actually see a photograph: at full size, in good light, on a wall built for it, with nothing laid over it.</p>
<p>And then I wanted to wander. To find things I was not looking for, one after another, the way you do in a museum when you turn a corner. To stand in front of something, learn what it is, who made it, when and why, and where it sits in the rest of their work. If they have written, filmed or recorded anything, to find that too. To leave a line in the book. To take a photograph home, numbered, for five dollars, or license it for a story or a wall with the agreement in plain language. Watermark is that place.</p>
<h2>For the people who make the work</h2>
<p>A gallery is also a business. Watermark is the studio tool: the vault that keeps the originals, fingerprinted on arrival and checked for fixity on a schedule; the register that records every sale and every change of hands; the licenses, the certificates and the contract; the requests, answered from your own desk; the Copyright Office bridge; the archival master with its papers. The copyright stays yours; 85% of every sale is yours. The aim is to take every entrepreneurial, legal and financial problem off an artist's desk, so what is left is the work, and the people who want to see it.</p>
<h2>No advertising, ever</h2>
<p>Nothing here is paid for by interrupting you. The house is kept by the people who use it: collectors, licensees, and the <a href="/friends">friends of the house</a>, who give because they like coming here. It stays a walled garden where what you meet is beautiful or thoughtful, and nothing else.</p>
<h2>Krafft and Watermark</h2>
<p>Watermark is a Krafft company, and the largest of them. Krafft is the founding firm: a creative house of three parts, Design for clients, Studios for original work, Ventures for what the house owns. Krafft Studios made the founding collection on these walls, and makes the house&rsquo;s media: the stories, the dinners, the films of the openings, the Keys. The two are one house seen from two doors. Watermark keeps the work; Studios makes it.</p>
<h2>By invitation</h2>
<p>Watermark is curated. Work hangs here because someone stood in front of it and said it was ready. That is the honour, and it is the point: the beautiful rises, the body of work is kept whole, and nothing is sold that is not worth keeping. <a href="/join">Apply with the work.</a></p>
<p class="ab-sig"><a href="/director">Will Fullerton</a><br><small>Founding director &middot; Krafft Studios &middot; Watermark is a Krafft company</small></p></section>`
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
<li><b>Record.</b> Every license is recorded in Watermark&rsquo;s register by reference and fingerprint. Personal details are not published.</li>
<li><b>Claims.</b> If a photograph here is yours, or you are in it without having agreed, say so in writing from its page (<i>Is this yours? Say so</i>) or to house@watermark.krafftco.com, the house&rsquo;s agent for notices. Sales pause when a claim arrives; the maker answers; the house decides against its record and writes to both within five working days. A claim upheld brings the photograph down and its holders are told.</li></ol></section>`
  });
}

// A collector's own Watermark: every work they have collected, numbered, room by room.
function collector({ first = null, keys = [], cabinet = '', hangs = '', hand = [], rights = [], isMaker = false, isHouse = false, pocket = '', sent = null, canSend = () => true, looking = null, tab = null, book = null, note = null, me = null, swaps = { forMe: [], byMe: [] }, shared = [], lines = [], applauded = [], regard = null, b, items, rooms, works, makers, own, base, pay = null, share = null, give = null, got = null, founding = null, left = null, patronOf = [], patronSlug = null, keyed = true, pf = null, offer = null, offers = [], accepted = null }) {
  const pr = pf ? Object.fromEntries(pf.rows.map(r => [r.id, r])) : {};
  const who = b && b.name ? b.name : own ? 'Your gallery' : 'A gallery';
  if (!b || (!items.length && !(own && (tab === 'hangs' || tab === 'cabinet' || hand.length || shared.length || lines.length || applauded.length)))) return layout({ title: `${who} · Watermark`, body: `<section class="cx-intro yc-empty"><p class="k">${own ? 'Your gallery' : 'Collection'}</p>
${own && (isMaker || isHouse) ? `<div class="yc-sw">${SWITCH('gallery', { admin: isHouse })}</div>` : ''}<h1>${own ? 'For those who collect.' : 'Nothing to see here.'}</h1>${own ? '<p class="yc-start">Start your gallery.</p>' : ''}
<p class="lede">${own ? 'Every work you collect on Watermark hangs here, numbered: you are collector No. 1, No. 12, No. 37 of the work. It stays private unless you choose to show it.' : 'This gallery is private, or no longer exists.'}</p>
${own && left ? `<p class="fc-call"><span class="fc-k">${WAVE_MARK}</span>The first hundred people to collect on Watermark are its Founding Collectors, marked so on their wall for good. ${left} of 100 places remain.</p>` : ''}
${own ? `<p class="yc-row"><a class="buy-btn" href="/collection">Walk the collection</a><a class="yc-today" href="/today">Or start with today's photograph →</a></p><p class="yc-signin">${b && b.email ? `Signed in as ${esc(b.email)}. The first piece you collect hangs here.` : 'Already a collector? <a href="/signin">Sign in</a>.'}</p>` : ''}</section>` });
  const plate = i => `<a class="pl yc-pl" href="/w/${esc(i.slug)}" data-s="${esc(i.slug)}" style="--r:${(i.width && i.height ? i.width / i.height : 1.5).toFixed(3)}"><img src="/img/${esc(i.slug)}/thumb" alt="${esc(i.title)}" loading="lazy" draggable="false"><span class="yc-no">No. ${i.collector_no || '—'}${i.edition_size ? `<small>/${i.edition_size}</small>` : ''}</span><span class="pc"><b>${esc(i.title)}</b><i>${esc(i.maker)}</i></span>${!own && pay ? `<span class="pb" data-buy role="button" tabindex="0" aria-label="Collect">${WAVE_MARK}<i class="seal-r"></i></span>` : ''}${i.printed ? `<span class="yc-pr">Printed</span>` : ''}</a>`;
  // Each piece as a card you hold: an instant print on textured stock, inscribed with its number, title and
  // maker, blind-embossed with the Watermark wave. Tilted a little, as cards are when they are laid down.
  const card = i => { const tilt = (((i.id * 37) % 7) - 3) * 0.45; const yr = String(i.starts_at || '').slice(0, 4);
    return `<div class="tc" style="--tilt:${tilt.toFixed(2)}deg"><a class="tc-win" href="${own ? `/yours/p/${esc(i.ref)}` : `/w/${esc(i.slug)}`}" data-slug="${esc(i.slug)}"><img src="/img/${esc(i.slug)}/screen" alt="${esc(tidy(i.title))}" loading="lazy" draggable="false"></a>
<span class="tc-foot"><span class="tc-no">${i.collector_no ? `No.&nbsp;${i.collector_no}${i.edition_size ? `<small>&thinsp;/&thinsp;${i.edition_size}</small>` : ''}` : ''}</span><a class="tc-ins" href="${own ? `/yours/p/${esc(i.ref)}` : `/w/${esc(i.slug)}`}">${esc(tidy(i.title))}</a>
${pr[i.id] && pr[i.id].market && pr[i.id].market.value != null && i.edition_size ? `<span class="tc-val">${pr[i.id].value > pr[i.id].cost ? `<b>${money(pr[i.id].value)}</b> <i>paid ${money(pr[i.id].cost)}</i>` : pr[i.id].listing ? `<b>Offered at ${money(pr[i.id].listing.ask_cents)}</b>` : `<i>${money(pr[i.id].cost)}</i>`}</span>` : ''}<span class="tc-meta">${mlink(i.maker)}${i.place ? ` &middot; ${esc(String(i.place).split(',')[0])}` : ''}${yr ? ` &middot; ${yr}` : ''}${i.use_key && !['social', 'reference'].includes(i.use_key) ? ` &middot; ${esc(i.use_name)}` : ''}</span><span class="tc-mark" aria-hidden="true">${WAVE_MARK}</span></span>${i.printed ? `<span class="tc-pr">Printed</span>` : ''}</div>`; };
  const roomRow = r => `<a class="yc-room" href="/rooms/${esc(r.slug)}"><span class="yc-rt">${esc(r.title.replace(/^Journey Out (East|West):?\s*/, ''))}</span><span class="yc-bar"><i style="width:${Math.round(100 * r.have / r.total)}%"></i></span><span class="yc-rn">${r.have === r.total ? 'Complete' : `${r.have} of ${r.total}`}</span></a>`;
  const lowest = items.reduce((a, i) => (i.collector_no && (!a || i.collector_no < a.collector_no) ? i : a), null);
  const done = rooms.filter(r => r.have === r.total).length;
  const marks = [...(keys || []).map(k => `<a href="/keys">The Keys: ${k.kind === 'maker' ? 'the maker’s key' : k.kind === 'curator' ? 'the curator’s key' : 'the collector’s key'}, No.&nbsp;${k.no}</a>`), first && first.is ? `<span class="fc-first">The first collector of the house${first.note ? `: ${esc(first.note)}` : ''}</span> Founding Collector, No.&nbsp;1 of 100` : founding ? `Founding Collector, No.&nbsp;${founding} of 100` : null, ...patronOf.map(p => `Patron of ${esc(p.maker_name)} since ${esc(new Date(p.started_at + 'Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}`)].filter(Boolean);
  const change = pf ? pf.value - pf.paid : 0;
  // The owner's gallery in rooms: one tab at a time, the way a studio is laid out; a visitor sees it whole.
  // Six rooms, plainly named (18 Oct: the collector's page must be the easiest in the house); the guest books,
  // patronage and the settings share 'More'. Old addresses (?tab=books, patronage, settings) still open their room.
  const TABS = [['gallery', 'Gallery'], ['hangs', 'Walls'], ['files', 'Papers'], ['market', 'Market'], ['cabinet', 'Cabinet'], ['more', 'More']];
  const MORE = ['books', 'patronage', 'settings'];
  const T = own ? (TABS.some(t => t[0] === tab) || MORE.includes(tab) ? tab : 'gallery') : null;
  const on = k => !own || T === k || (T === 'more' && MORE.includes(k));
  const unprinted = own ? items.find(i => !i.printed && i.status === 'active') : null;
  const tabs = own ? `<nav class="yt" aria-label="Your gallery"><div class="yt-in">${TABS.map(([k, n]) => `<a href="/yours?tab=${k}"${T === k || (k === 'more' && MORE.includes(T)) ? ' aria-current="page"' : ''}>${n}${k === 'market' && (offers.length + swaps.forMe.length) ? `<i>${offers.length + swaps.forMe.length}</i>` : ''}</a>`).join('')}</div></nav>` : '';
  return layout({ title: `${who} · Watermark`, path: own ? '/yours' : `/g/${b.code}`, desc: `${works} works collected on Watermark.`, body: `${own && (isMaker || isHouse) ? `<div class="yc-sw">${SWITCH('gallery', { admin: isHouse })}<span>Every maker is a collector. What you earn here can be spent here: <a href="/account/payouts">put earnings in your pocket</a> and collect the artists you admire.</span></div>` : ''}<section class="cx-intro yc-head">${b.name ? `<p class="k">${own ? 'Your gallery' : 'Collection'}</p>` : ''}
<h1>${own ? 'For those who collect.' : `${esc(who)}.`}</h1>
${marks.length ? `<ul class="yc-marks">${marks.map(m => `<li><span class="fc-k">${WAVE_MARK}</span>${m}</li>`).join('')}</ul>` : ''}
<p class="yc-count">${hand.length ? `${hand.length} of ${own ? 'your' : 'their'} own, and ` : ''}${works} work${works === 1 ? '' : 's'} by ${makers} ${hand.length ? 'other ' : ''}photographer${makers === 1 ? '' : 's'}${done ? `, ${done} room${done === 1 ? '' : 's'} complete` : ''}.${lowest ? ` Your earliest number: No.&nbsp;${lowest.collector_no} of <i>${esc(tidy(lowest.title))}</i>.` : ''}${regard && regard.n ? ` ${regard.n} line${regard.n === 1 ? '' : 's'} in the guest books${regard.seen ? `, ${regard.seen} marked well seen by ${regard.makers} maker${regard.makers === 1 ? '' : 's'}` : ''}.` : ''}</p></section>${tabs}${on('gallery') || on('settings') ? `${keyed ? '' : `<div class="pk" data-passkey-box><span class="fc-k">${WAVE_MARK}</span><div><b>Keep your gallery on every device.</b><p>Save it with a passkey: Face ID or Touch ID, no password. Then sign in on any phone or computer and it is there.</p><button class="pk-go" data-passkey="save">Save with a passkey</button><p class="pk-msg" data-passkey-msg></p></div></div><script src="/static/webauthn.js" defer></script><script src="/static/auth.js?v=${VER}" defer></script>`}` : ''}
${own && on('gallery') && (items.length || hand.length) ? `<a class="yc-stroll" href="/stroll?in=mine${(hand[0] || items[0]) ? `&at=${esc((hand[0] || items[0]).slug)}` : ''}"><span class="yc-sfan">${[...hand, ...items].slice(0, 3).map(i => `<img src="/img/${esc(i.slug)}/thumb" alt="" loading="lazy" draggable="false">`).join('')}</span><span class="yc-st"><span class="k">${WAVE_MARK}</span><b>Stroll your gallery.</b><small>${works + hand.length} piece${works + hand.length === 1 ? '' : 's'}, one at a time, edge to edge. Swipe up for the next.</small></span></a>` : ''}
${own && on('gallery') && unprinted ? `<a class="yc-print" href="/yours/p/${esc(unprinted.ref)}#print"><img src="/img/${esc(unprinted.slug)}/thumb" alt="" loading="lazy" draggable="false"><span class="yc-pt"><span class="k">See it in person</span><b>Print <i>${esc(tidy(unprinted.title))}</i>.</b><small>The sizes your file prints at, the file, and how: yourself, or by the house.</small></span><span class="yc-pgo">Print it &rarr;</span></a>` : ''}
${own && on('gallery') ? `<p class="yc-home"><a href="/yours/add">Bring a photograph home: drop in a file from Watermark &rarr;</a></p><section class="fy" data-for-you="6" hidden></section>` : ''}
${own && looking && (looking.month || looking.firsts) && on('gallery') ? `<section class="lk"><p class="k">Your looking, this month <small>(seen by you alone)</small> · <a href="/yours/looking">the whole record</a></p><p class="lk-l">You have stood in front of <b>${looking.month}</b> photograph${looking.month === 1 ? '' : 's'}${looking.seconds >= 60 ? `, <b>${Math.round(looking.seconds / 60)}</b> minute${Math.round(looking.seconds / 60) === 1 ? '' : 's'} in all` : ''}${looking.firsts ? `; among the first hundred to see <b>${looking.firsts}</b>` : ''}.${looking.longest.length && looking.longest[0].seconds >= 30 ? ` Longest in front of <a href="/w/${esc(looking.longest[0].slug)}"><i>${esc(tidy(looking.longest[0].title))}</i></a>.` : ''}</p></section>` : ''}
${own && pf && on('gallery') ? `<section class="pf"><div class="pf-v"><span>Value of your gallery</span><b>${money(pf.value)}</b></div>
<dl class="pf-dl"><div><dt>You paid</dt><dd>${money(pf.paid)}</dd></div><div><dt>Change</dt><dd class="${change > 0 ? 'pf-up' : change < 0 ? 'pf-dn' : ''}">${change === 0 ? 'No change' : `${change > 0 ? '+' : '&minus;'}${money(Math.abs(change))} (${(Math.abs(pf.change) * 100).toFixed(1)}%)`}</dd></div><div><dt>Market</dt><dd><a href="/market">See what is offered</a></dd></div></dl>
<p class="pf-n">Limited editions are valued at their last trade, or at their issue price until they trade; open editions at what you paid. These are prices, not appraisals.</p></section>` : ''}
${rooms.length && on('gallery') ? `<section class="gal"><header class="gh"><h2>Rooms</h2><span>collected of each</span></header><div class="yc-rooms">${rooms.map(roomRow).join('')}</div></section>` : ''}
${lines.length && on('books') ? `<section class="gal yc-lines"><header class="gh"><h2>In the guest books</h2><span>${own ? 'what you have written' : `what ${esc(b.name || 'this collector')} has written`}</span></header><ol class="gb gb-mine">${lines.map(n => `<li><span class="gb-d">${date(n.at)}</span><p class="gb-p">${esc(n.body)}</p><span class="gb-s gb-w">on <a href="/w/${esc(n.slug)}#notes">${esc(tidy(n.title))}</a>, ${esc(n.maker)}</span></li>`).join('')}</ol></section>` : ''}
${applauded.length && on('books') ? `<section class="gal yc-ap"><header class="gh"><h2>Tips of the hat</h2><span>${applauded.length} photograph${applauded.length === 1 ? '' : 's'}</span></header><div class="yc-apg">${applauded.map(a => `<a href="/w/${esc(a.slug)}" title="${esc(tidy(a.title))}, ${esc(a.maker)}"><img src="/img/${esc(a.slug)}/thumb" alt="${esc(tidy(a.title))}" loading="lazy" draggable="false"></a>`).join('')}</div></section>` : ''}
${own && on('hangs') ? hangs : ''}
${own && on('cabinet') ? cabinet : ''}
${own && shared.length && on('files') ? `<section class="gal yc-shared"><header class="gh"><h2>Shared with you</h2><span>seats on licenses held by others</span></header>${shared.map(x => `<a class="hd-ev" href="/seat/${esc(x.token)}"><span>${esc(x.use_name)}</span><b>${esc(tidy(x.title))}</b><span>${esc(x.licensee_company || x.licensee_name || '')}${x.ends_at ? ` &middot; until ${date(x.ends_at)}` : ''}</span><span class="hd-v">Seat</span></a>`).join('')}</section>` : ''}
${hand.length && on('gallery') ? `<section class="gal yc-hand"><header class="gh"><h2>From ${own ? 'your' : `${esc(hand[0].maker.split(' ')[0])}'s`} own hand</h2><span>${hand.length} jewel${hand.length === 1 ? '' : 's'} · the artist's copies</span></header><div class="plates">${hand.map(w => `<a class="pl" href="/w/${esc(w.slug)}" style="--r:${w.width && w.height ? (w.width / w.height).toFixed(3) : 1.5}"><img src="/img/${esc(w.slug)}/thumb" alt="${esc(tidy(w.title))}" loading="lazy" draggable="false"><span class="pc"><b>${esc(tidy(w.title))}</b><i>${esc([w.place, w.taken_at ? String(w.taken_at).slice(0, 4) : ''].filter(Boolean).join(', '))}</i></span></a>`).join('')}</div>${own ? '<p class="note">Every work you grade five hangs here, beside what you collect; grade it lower and it returns to the studio.</p>' : ''}</section>` : ''}
${on('gallery') ? `<section class="gal"><header class="gh"><h2>${hand.length ? 'What ' + (own ? 'you collect' : esc(hand[0].maker.split(' ')[0]) + ' collects') : 'The gallery'}</h2><span>newest first</span></header>${own ? `<div class="tc-grid">${items.map(card).join('')}</div>` : `<div class="plates">${items.map(plate).join('')}</div>`}
${!own && pay ? `<script>window.__WM_PAY=${JSON.stringify(pay).replace(/</g, '\\u003c')};</script><script src="/static/pay.js?v=${VER}" defer></script>` : ''}
${book && b && on('books') ? `<section class="gal gb-gal" id="book"><header class="gh"><h2>The guest book</h2><span>${book.hats ? `${book.hats} tip${book.hats === 1 ? '' : 's'} of the hat` : ''}</span></header>
${note === '1' ? '<p class="ok">Signed. Thank you for coming.</p>' : note === 'kind' ? '<p class="err">This is someone&rsquo;s home. Say it kindly, or not at all.</p>' : note === 'check' ? '<p class="err">A sentence and a name, no links.</p>' : note === 'slow' ? '<p class="err">Three lines in ten minutes is plenty. Come back in a little while.</p>' : ''}
${book.lines.length ? `<ol class="gb">${book.lines.map(n => `<li><span class="gb-d">${date(n.at)}</span><p class="gb-p">${esc(n.body)}</p><span class="gb-s">${n.public && n.code ? `<a href="/collector/${esc(n.code)}">${esc(n.name || 'A visitor')}</a>` : esc(n.name || 'A visitor')}${n.wslug ? `<small class="gb-on">on <a href="/w/${esc(n.wslug)}">${esc(tidy(n.wtitle))}</a></small>` : ''}</span>${own || (me && n.buyer_id === me) ? `<form method="post" action="/collector/${esc(b.code)}/notes/${n.id}/remove" class="gb-rm"><button class="link">Remove</button></form>` : ''}</li>`).join('')}</ol>` : `<p class="nt-0">${own ? 'No one has signed your book yet. Share your gallery and they will.' : 'Be the first to sign.'}</p>`}
${!own ? `<div class="gb-sign"><form method="post" action="/collector/${esc(b.code)}/hat" class="ap-f"><button class="ap${book.mine ? ' on' : ''}" aria-pressed="${book.mine}">${HAT}<span>${book.mine ? 'Hat tipped' : 'Tip your hat to this gallery'}</span></button></form>
<form method="post" action="/collector/${esc(b.code)}/notes" class="gb-f"><label class="gb-l"><span>A line for the book</span><textarea name="body" rows="2" maxlength="280" placeholder="What you loved here, or what you would hang beside it." required></textarea></label><div class="gb-row"><label class="gb-l gb-n"><span>Signed</span><input name="name" placeholder="Your name" maxlength="60" required autocomplete="name"></label>${items.length ? `<label class="gb-l gb-n"><span>About</span><select name="work"><option value="">The whole gallery</option>${items.map(i => `<option value="${esc(i.slug)}">${esc(tidy(i.title))}${i.collector_no ? ` No. ${i.collector_no}` : ''}</option>`).join('')}</select></label>` : ''}<button class="btn">Sign the book</button></div></form></div>` : ''}</section>` : ''}` : ''}
${!own && share && share.price_cents != null ? `<p class="yc-cta">Like what ${esc(b.name || 'this collector')} collects? Every work here can be yours too, from ${money(share.price_cents)}.</p>` : ''}</section>
${own && on('settings') ? `<section class="gal dev"><header class="gh"><h2>Your devices</h2><span>one you, everywhere</span></header><p>${b && b.email ? `Signed in as <b>${esc(b.email)}</b>. On your phone, scan a code and you are in: the same gallery, the same pocket, no typing.` : 'Sign in with your email once and the gallery on this device joins the one your email names, on every device.'}</p><p class="dev-acts">${b && b.email ? `<a class="buy-btn" href="/signin/hand?next=/yours%3Ftab%3Dsettings">${I.key}<span>Hand it to my phone</span></a>` : `<a class="buy-btn" href="/signin?next=/yours%3Ftab%3Dsettings">Sign in</a>`}</p></section>` : ''}
${own && on('settings') && pocket ? `<section class="gal">${pocket}</section>` : ''}
${own ? `<section class="gal yc-own">${on('settings') ? `<header class="gh"><h2>Show it, or keep it</h2></header>
<form method="post" action="/yours" class="form yc-form"><label>Name on the wall<input name="name" value="${esc(b.name || '')}" placeholder="Elena's gallery"></label>
<label class="chk"><input type="checkbox" name="public" value="1" ${b.public ? 'checked' : ''}> Open my gallery to anyone with the link</label><button>Save</button></form>
${b.code ? `<p class="yc-wallet"><span class="k">Your wallet</span><code>WM-${esc(b.code)}</code><small>Anyone can send a photograph to this address. It is also the address of your gallery when you open it.</small></p>` : ''}
${b.public && b.code ? `<p class="note">Your public link: <a href="/collector/${esc(b.code)}">${esc(base)}/collector/${esc(b.code)}</a></p>` : '<p class="note">Private: only this device sees it.</p>'}
${give ? `<div class="yc-give" id="give"><p class="k">To pass on <em>${esc(tidy(give.title))}</em></p><p>Send this link to the person you are giving it to. When they accept, it hangs on their wall with your number, and leaves yours.</p><input readonly value="${esc(base)}/claim/${esc(give.token)}" onclick="this.select()"></div>` : ''}
` : ''}
${on('patronage') ? `<div id="patronage">${patronOf.length ? patronOf.map(p => `<div class="yc-pat"><span><b>Patron of ${esc(p.maker_name)}</b> &middot; ${esc(p.level.charAt(0).toUpperCase() + p.level.slice(1))}, ${money(p.amount_cents)} a month${p.status === 'ending' ? ' &middot; ends at the close of this month' : ''}</span>${p.status === 'active' ? `<form method="post" action="/patron/${p.id}/end"><button class="yf-give">End patronage</button></form>` : ''}</div>`).join('') : patronSlug ? `<p class="note">Keep a maker working: <a href="/m/${esc(patronSlug)}#patron">become a patron</a>.</p>` : ''}</div>` : ''}
${got ? `<p class="yc-got">It&rsquo;s yours now. It hangs below, with its number.</p>` : ''}${accepted ? '<p class="yc-got">Accepted. The piece moves to the buyer once they have paid; until then it stays on your wall. <a href="/yours/payouts">Where your share goes</a>.</p>' : ''}${on('market') ? `${offers.length ? `<div class="yc-offers"><p class="k">Offers for your pieces</p>${offers.map(o => `<div class="yc-of"><span><b>${money(o.offer_cents)}</b> for No. ${o.collector_no}${o.name ? ` from ${esc(o.name)}` : ''}</span><form method="post" action="/yours/offers/${o.id}/accept"><button>Accept</button></form><form method="post" action="/yours/offers/${o.id}/decline"><button class="link">Decline</button></form></div>`).join('')}</div>` : ''}${swaps.forMe.length ? `<div class="yc-offers" id="trades"><p class="k">Trades offered to you</p>${swaps.forMe.map(t => `<div class="yc-of"><span><b>${esc(tidy(t.give.title))}, No.&nbsp;${t.give.collector_no}</b> by ${esc(t.give.maker)}${t.from_name ? ` from ${esc(t.from_name)}` : ''} for your <b>${esc(tidy(t.want.title))}, No.&nbsp;${t.want.collector_no}</b></span><a class="btn" href="/swap/${t.id}">See the trade</a></div>`).join('')}</div>` : ''}${swaps.byMe.filter(t => t.status === 'open').length ? `<div class="yc-offers"><p class="k">Trades you have offered</p>${swaps.byMe.filter(t => t.status === 'open').map(t => `<div class="yc-of"><span>Your <b>${esc(tidy(t.give.title))}, No.&nbsp;${t.give.collector_no}</b> for <b>${esc(tidy(t.want.title))}, No.&nbsp;${t.want.collector_no}</b>, waiting on its holder</span><a class="link" href="/swap/${t.id}">Open</a></div>`).join('')}</div>` : ''}${offer === '1' ? '<p class="yc-got">Offered. It is on the market, and stays on your wall until it is sold. <a href="/yours/payouts">Where your share goes</a>.</p>' : offer === 'price' ? '<p class="err">Give it a price of at least $1.</p>' : ''}` : ''}
${sent ? `<p class="${sent === 'done' || sent === 'mailed' ? 'ok' : 'err'}">${{ done: 'Sent. It is in their gallery now.', mailed: 'Sent. They have a link by email to take it into their gallery.', locked: 'That license stays with you: its agreement does not allow it to pass to another person.', listed: 'It is on the market; withdraw it first.', who: 'Say who it is for: a wallet address or an email.', self: 'That is your own wallet.', unknown: 'No wallet by that address. Try their email.' }[sent] || ''}</p>` : ''}${on('files') && rights.length ? `<section class="cov" id="rights"><header class="gh"><h2>Your rights</h2><span>${rights.filter(r => r.live).length} live</span></header>
<p class="lede cov-lede">What you are covered for, in one place: the use, the term, the people on it, the files, the agreement. Nothing to chase.</p>
<div class="cov-list">${rights.map(r => `<div class="cov-row ${r.live ? (r.soon ? 'cov-soon' : 'cov-live') : 'cov-ended'}"><img src="/img/${esc(r.slug)}/thumb" alt="" loading="lazy"><div class="cov-t"><b>${esc(tidy(r.title))}</b><small>${esc(r.maker)} · ${esc(r.ref)}</small></div>
<div class="cov-u"><b>${esc(r.use_name)}</b><small>${r.ends_at ? (r.live ? `Covered until ${date(r.ends_at)}` : `Ended ${date(r.ends_at)}`) : 'Covered, for good'}${r.licensee_company ? ` · ${esc(r.licensee_company)}` : ''}</small></div>
<div class="cov-n"><span><b>${r.seats + 1}</b> ${r.seats ? 'people' : 'person'}</span><span><b>${r.dl.left}</b> downloads left</span></div>
<div class="cov-a"><a href="/c/${esc(r.ref)}${r.download_token ? `?k=${esc(r.download_token)}` : ''}">License</a><a href="/c/${esc(r.ref)}/contract">Agreement</a>${r.download_token && r.live ? `<a href="/d/${esc(r.download_token)}">File</a>` : ''}${r.live && r.ends_at ? `<a href="/license/${esc(r.slug)}?use=${esc(r.use_key)}&renews=${esc(r.ref)}">Renew</a>` : ''}</div>
<span class="cov-st">${r.live ? (r.soon ? 'Ending soon' : 'Covered') : 'Ended'}</span></div>`).join('')}</div></section>` : ''}
${on('files') ? `<div class="yc-files" id="files">${items.map(i => `<div class="yf"><img src="/img/${esc(i.slug)}/thumb" alt="" loading="lazy" draggable="false"><div class="yf-t"><i>${esc(tidy(i.title))}</i><small>${esc(i.maker)} &middot; No. ${i.collector_no || '—'}${i.edition_size ? ` of ${i.edition_size}` : ''} &middot; ${date(i.starts_at)}</small>${i.printed ? `<small class="yf-pr">Printed: ${esc(i.printed)}</small>` : ''}</div>
<div class="yf-a">${i.download_token ? `<a href="/d/${esc(i.download_token)}">Save</a>` : ''}
<details><summary>Record a print</summary><form method="post" action="/yours/print" class="yf-f"><input type="hidden" name="ref" value="${esc(i.ref)}"><input name="size" placeholder="Size, e.g. 16 × 20 in" required><input name="paper" placeholder="Paper or lab (optional)"><input name="made" placeholder="When (optional)"><button>Record it</button></form></details>
${i.collector_no && i.status === 'active' ? (canSend(i) ? `<details class="yf-send"><summary>Send it to a wallet</summary><form method="post" action="/yours/send" class="yf-f"><input type="hidden" name="ref" value="${esc(i.ref)}"><input name="to" placeholder="Their wallet address or email" required autocomplete="off"><button>Send</button><small>It leaves your gallery the moment it lands in theirs. By email, they take it with a link.</small></form><form method="post" action="/yours/give" class="yf-f"><input type="hidden" name="ref" value="${esc(i.ref)}"><button class="link">Or make a link to pass it on</button></form></details>` : '<span class="yf-lock" title="This license stays with you; its agreement does not allow transfer.">Not transferable</span>') : ''}${(() => { const r = pr[i.id]; if (!r || !i.collector_no || !i.edition_size || i.status !== 'active') return ''; return r.listing
  ? `<div class="yf-mk"><span>Offered at <b>${money(r.listing.ask_cents)}</b> &middot; <a href="/market/${r.listing.id}">its page</a></span><form method="post" action="/yours/offer" class="yf-ask"><input type="hidden" name="ref" value="${esc(i.ref)}"><input name="ask" inputmode="decimal" value="${(r.listing.ask_cents / 100).toFixed(0)}" aria-label="Asking price, dollars"><button>Change</button></form><form method="post" action="/yours/offer/withdraw"><input type="hidden" name="ref" value="${esc(i.ref)}"><button class="link">Withdraw</button></form></div>`
  : `<details class="yf-mk"><summary>Offer it on the market</summary><form method="post" action="/yours/offer" class="yf-ask"><input type="hidden" name="ref" value="${esc(i.ref)}"><span>$</span><input name="ask" inputmode="decimal" required placeholder="${r.market.value ? (r.market.value / 100).toFixed(0) : 'Your price'}" aria-label="Asking price, dollars"><button>Offer it</button></form><small>You paid ${money(r.cost)}${r.market.last != null ? `; it last traded at ${money(r.market.last)}` : ''}. The photographer receives 10% of a resale and Watermark 5%.</small></details>`; })()}</div></div>`).join('')}</div>` : ''}</section>` : ''}` });
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
<section class="sr-intro"><p class="lede">${esc(s.dek)}</p><p class="sr-toc">${chapters.map((c, i) => `<a href="#ch-${i + 1}"><span>${ROMAN[i]}</span>${esc(c.title)}</a>`).join('')}</p><p class="cx-count">${n} works in ${chapters.length} parts &middot; each one collectable</p></section>
${chapters.map((c, i) => `<section class="sr-ch" id="ch-${i + 1}"><header><span class="sr-no">${ROMAN[i]}</span><h2>${esc(c.title)}</h2><p>${esc(c.dek)}</p></header>
<div class="sr-hang">${c.works.map((w, j) => plate(w, j === 0)).join('')}</div>
${buy && c.items && c.items.length > 1 ? `<form method="post" action="/series/${esc(s.slug)}/collect" class="sr-set"><input type="hidden" name="part" value="${c.i}"><button class="jewel"><span>Collect all ${c.items.length} of ${esc(c.title)}</span><b>${money(c.price)}</b></button><p>${money(c.full)} one by one. Each work is numbered in your gallery.</p></form>` : ''}</section>`).join('')}
<section class="sr-end"><p>${esc(s.title)} is a series by ${esc(s.maker)} for ${esc(s.house)}. Every photograph in it is held on Watermark, and every one can hang in your gallery.</p>
${buy && whole && whole.n > 1 ? `<form method="post" action="/series/${esc(s.slug)}/collect" class="sr-set sr-set-all"><input type="hidden" name="part" value="all"><button class="jewel"><span>Collect the whole series &middot; ${whole.n} works</span><b>${money(whole.price)}</b></button><p>${money(whole.full)} one by one. The complete series, numbered on your wall.</p></form>` : ''}
<div class="sr-credits"><p class="k">Made possible by its patrons</p>${credits.length ? `<p class="sr-cn">${credits.map(esc).join(' &middot; ')}</p>` : '<p class="sr-cn sr-cn-empty">The next series could carry your name.</p>'}${patronSlug ? `<a href="/m/${esc(patronSlug)}#patron">Become a patron of ${esc(s.maker)}</a>` : ''}</div>
<p class="sr-also"><a href="/collection">Walk the whole collection</a></p></section>` });
}

const collectorCard = c => `<a class="yc-card" href="/g/${esc(c.code)}"><span class="yc-th">${c.thumbs.map(t => `<img src="/img/${esc(t.slug)}/thumb" alt="" loading="lazy" draggable="false">`).join('')}</span>
<b>${esc(c.name || 'A private collector')}</b>${c.eye && c.eye.line ? `<small class="fc-eye">${esc(c.eye.line)}</small>` : ''}${c.first ? '<small class="fc-tag fc-tag-first">The first collector</small>' : c.founding ? `<small class="fc-tag">Founding Collector No. ${c.founding}</small>` : ''}<span>${c.works} work${c.works === 1 ? '' : 's'}${c.earliest ? ` · earliest No. ${c.earliest}` : ''}</span>${c.statement ? `<small class="yc-stmt">${esc(c.statement)}</small>` : ''}</a>`;
// In a headset (vr.js, public/vr.js): the room fills the window; a quiet card names the space and the set, offers
// the other spaces, and the headset's door when the browser has one.
function vrPage({ data, spaces, space, key }) {
  const q = k => `/vr?in=${encodeURIComponent(key)}&space=${k}`;
  return layout({ bare: true, title: `${spaces[space].name} · Watermark`, desc: 'Work from Watermark in a grand room, in your headset or your browser.', path: '/vr', body: `<div class="xr" data-xr>
<div class="xr-c" data-xr-c></div>
<section class="xr-card" data-xr-card><a class="xr-home" href="${esc(data.href || '/collection')}" aria-label="Back">${I.back}<span>${esc(data.label || 'The collection')}</span></a>
<p class="xr-k">In a headset</p><h1>${esc(spaces[space].name)}</h1><p class="xr-l">${esc(spaces[space].line)} ${data.items.length} photograph${data.items.length === 1 ? '' : 's'} from ${esc(data.label || 'the collection')}.</p>
<nav class="xr-sp">${Object.entries(spaces).map(([k, v]) => `<a href="${q(k)}"${k === space ? ' aria-current="page"' : ''}>${esc(v.name.replace(/^The /, ''))}</a>`).join('')}</nav>
<button type="button" class="xr-go" data-xr-go hidden>Enter in your headset</button>
<p class="xr-how" data-xr-how>Drag to look around. Click a photograph to stand before it, or the floor to walk there. Arrow keys or W A S D to stroll.</p>
<p class="xr-how xr-hs" data-xr-hs hidden>In the headset: point and pull the trigger (or look and pinch) at a photograph to stand before it, at the floor to go there.</p>
<button type="button" class="xr-hide" data-xr-hide>Hide this</button></section>
<p class="xr-load" data-xr-load>Hanging the work&hellip;</p></div>
<script>window.__WM_VR=${JSON.stringify(data).replace(/</g, '\\u003c')};</script><script type="module" src="/static/vr.js?v=${VER}"></script>` });
}
function collectors({ list, left = null, hangs = [], shows = [] }) {
  const hangCard = require('./hangs').hangCard;
  const card = collectorCard;
  return layout({ title: 'Galleries · Watermark', desc: 'The galleries people keep on Watermark, and the walls curators hang.', path: '/collectors', body: `${pageHero('the-library-stacks', 'J. P. Morgan’s library, New York')}<section class="cx-intro"><p class="k">Galleries</p>
<h1>The people who keep the work, and the people who hang it.</h1><p class="lede">Frick, Morgan, Gardner: the great collections are why we can see the great works. Here are the galleries people have chosen to show, and the walls curators have hung from the whole collection. Every work on them can hang on yours; collect through a wall and its curator earns a share, from the house, never from the maker.</p>
<p class="cx-count"><a href="/yours">Your gallery</a> &middot; <a href="/yours?tab=hangs">Hang a wall</a> &middot; <a href="/collection">Walk the archive</a></p>${left ? `<p class="fc-call"><span class="fc-k">${WAVE_MARK}</span>The first hundred collectors are Watermark&rsquo;s Founding Collectors. ${left} of 100 places remain.</p>` : ''}</section>
${shows.length ? `<section class="gal"><header class="gh"><h2>Shows</h2><span>mounted by galleries, now and coming</span></header><div class="hg-cards">${shows.map(h => `<a class="hg-card" href="/g/${esc(h.curator_code)}/hang/${esc(h.slug)}"><span class="hg-th">${(h.thumbs || []).map(w => `<img src="/img/${esc(w.slug)}/thumb" alt="" loading="lazy">`).join('')}</span><b>${esc(h.title)}</b><span>${esc(h.gallery || h.curator || 'A curator')} · ${h.opens_at > new Date().toISOString().slice(0, 10) ? `opens ${esc(h.opens_at)}` : `through ${esc(h.closes_at || 'the season')}`}${h.venue ? ` · ${esc(h.venue)}` : ''}</span></a>`).join('')}</div></section>` : ''}
${hangs.length ? `<section class="gal"><header class="gh"><h2>Hangs</h2><span>walls curated from the collection</span></header><div class="hg-cards">${hangs.map(hangCard).join('')}</div></section>` : ''}
<section class="gal"><header class="gh"><h2>Collections</h2><span>what people hold</span></header>${list.length ? `<div class="yc-cards">${list.map(card).join('')}</div>` : '<p class="note">No collection is public yet. Yours could be the first: collect a work, then open your wall from <a href="/yours">Yours</a>.</p>'}</section>` });
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
// The journal, kept the way the old notebooks were kept: studies, plans, the process behind a picture,
// and the long habit of sitting in front of a master's work and making it again for yourself. Copy a draft.
function journal({ posts, study = [] }) {
  const item = (p, lead) => `<a class="jr${lead ? ' jr-lead' : ''}" href="${esc(p.url)}">${p.feature_image ? `<span class="jr-f"><img src="${esc(p.feature_image)}" alt="${esc(p.feature_image_alt || '')}"${lead ? ' fetchpriority="high"' : ' loading="lazy"'} draggable="false"></span>` : ''}
<span class="jr-t"><small>${date(p.published_at)}${p.reading_time ? ` &middot; ${p.reading_time} min` : ''}</small><b>${esc(p.title)}</b><span>${esc(p.custom_excerpt || (p.excerpt || '').slice(0, 220))}</span>${lead ? '<span class="jr-go">Read on Krafft Studios &rarr;</span>' : ''}</span></a>`;
  return layout({ title: 'Journal · Watermark', desc: 'A working notebook: studies, plans, the process behind the pictures, and the practice of studying the masters.', path: '/journal', body: `${pageHero('under-the-gallery-dome', 'The National Gallery, London')}<section class="cx-intro jn-intro"><p class="k">Journal</p>
<h1>A working notebook.</h1><p class="lede">Leonardo filled thousands of pages: studies of water and hands, plans for machines, notes on how a painting should be made and what he had learned from looking. The notebook was the work before the work. This journal is kept the same way: studies, plans, the process behind each photograph, and the old habit of sitting in front of a master&rsquo;s picture and making it again for yourself.</p></section>
<section class="gal jn-prac"><header class="gh"><h2>The practice</h2><span>three habits of the notebook</span></header><div class="jn-three">
<a class="jn-p" href="/wander/room"><span class="jn-n">I</span><b>Study.</b><p>Stand in front of one work for ten minutes, longer than feels reasonable. Read the guide, then look again without it. The viewing room is made for this.</p><span class="jn-go">Open the viewing room</span></a>
<a class="jn-p" href="/collection"><span class="jn-n">II</span><b>Copy.</b><p>Every record here names the place, the hour, the camera and the light. That is the recipe. Go and make the picture yourself; the masters learned by copying, and so does everyone.</p><span class="jn-go">Walk the collection</span></a>
<a class="jn-p" href="/guestbook"><span class="jn-n">III</span><b>Keep a record.</b><p>Write down what you saw and what you would do differently. On Watermark the record is the notebook: a caption, a place, a date, how it was made. Sign the guest book with what you learned.</p><span class="jn-go">The guest book</span></a></div></section>
${study.length ? `<section class="gal jn-study"><header class="gh"><h2>Worth studying this week</h2><span>from the collection</span></header><div class="jn-grid">${study.map(w => `<a class="jn-w" href="/w/${esc(w.slug)}" style="--r:${w.width && w.height ? (w.width / w.height).toFixed(3) : 1.5}"><img src="/img/${esc(w.slug)}/screen" alt="${esc(tidy(w.title))}" loading="lazy" draggable="false"><span><b>${esc(tidy(w.title))}</b>${w.place ? `<small>${esc(w.place)}</small>` : ''}</span></a>`).join('')}</div></section>` : ''}
<section class="gal"><header class="gh"><h2>From the notebooks</h2><span>written and published by <a href="https://studios.krafftco.com">Krafft Studios</a></span></header>${posts.length ? `<div class="jr-list">${posts.map((p, i) => item(p, i === 0)).join('')}</div>` : `<div class="jr-list"><a class="jr jr-lead" href="/patronage"><span class="jr-t"><small>Essay</small><b>On patronage</b><span>Every great work you have stood in front of was paid for by someone.</span></span></a></div>`}</section>` });
}


// Connections (src/bridge.js): who you are in other systems, which partners may see your work and hear of your sales,
// and the rights claims they send. Nothing flows to a partner until the maker turns it on.
function connections({ m, ids, did, partners, claims, ok }) {
  const msg = { identity: 'Your identity is saved.', partner: 'Saved.', claim: 'Saved.' }[ok];
  const when = d => (d ? String(d).slice(0, 10) : '');
  return layout({ title: 'Connections · Watermark', body: `<section class="narrow cn">
<p class="k">Connections</p><h1>Your work, joined to the rest of your world.</h1>
<p class="lede">Watermark speaks the open standards for identity and rights, so the systems you already use can recognise your work, check its papers and hear when it sells. Nothing is shared with a partner until you turn it on here, and you can turn it off at any time.</p>
${msg ? `<p class="ok">${msg}</p>` : ''}
<h2>Who you are</h2>
<p class="note">Your identity in the house: <code>${esc(did)}</code>. Anyone can read it at <a href="/m/${esc(makerSlug(m))}/did.json">/m/${esc(makerSlug(m))}/did.json</a>, with the identities you add below.</p>
<form method="post" action="/account/connections/identity" class="form">
<label>Your own identifier (a DID, from a rights platform or your own site)<input name="did" value="${esc(m.did || '')}" placeholder="did:web:example.com:you"></label>
<label>ISNI (the international identifier for creators)<input name="isni" value="${esc(ids.isni || '')}" placeholder="0000 0001 2345 6789"></label>
<label>IPI (if you also write music)<input name="ipi" value="${esc(ids.ipi || '')}" placeholder="00000000000"></label>
<label>Your site<input name="site" value="${esc(ids.site || '')}" placeholder="https://"></label>
<button class="btn">Save</button></form>
<h2>Partners</h2>
${partners.length ? `<ul class="cn-p">${partners.map(p => `<li><div><b>${esc(p.name)}</b>${p.site ? ` <a href="${esc(p.site)}" rel="noopener">${esc(String(p.site).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : ''}${p.note ? `<span>${esc(p.note)}</span>` : ''}<span>${p.on_ ? 'Connected: they can read your catalogue with its shares and accepted claims, send rights claims for you to accept, and are told of each sale (the use, the term and the price; never a buyer&rsquo;s name).' : 'Not connected.'}</span></div>
<form method="post" action="/account/connections/partner/${p.id}"><input type="hidden" name="on" value="${p.on_ ? '0' : '1'}"><button class="${p.on_ ? 'link' : 'btn'}">${p.on_ ? 'Disconnect' : 'Connect'}</button></form></li>`).join('')}</ul>` : '<p class="note">No partners yet.</p>'}
<h2>Rights claims</h2>
${claims.length ? `<ul class="cn-c">${claims.map(c => `<li class="cn-${esc(c.state)}"><div><b>${esc((c.kind || '').replace('-', ' '))}</b> on <a href="/w/${esc(c.slug || '')}">${esc(tidy(c.title || ''))}</a> <span>from ${esc(c.partner)}${c.party ? `, for ${esc(c.party)}` : ''}${c.ends_at ? `, until ${esc(when(c.ends_at))}` : ''}</span>${c.summary ? `<p>${esc(c.summary)}</p>` : ''}<span>${c.signed ? 'Signed, and the signature checks.' : 'Not signed, or the signature could not be checked.'} ${c.kind === 'exclusive' ? 'Accepting an exclusive stops sales of the uses it covers while it runs.' : ''}</span></div>
${c.state === 'pending' ? `<form method="post" action="/account/connections/claim/${c.id}"><button class="btn" name="act" value="accept">Accept</button><button class="link" name="act" value="decline">Decline</button></form>` : `<em>${esc(c.state)}</em>`}</li>`).join('')}</ul>` : '<p class="note">None.</p>'}
</section>` });
}
// Shares and releases on one work (src/splits.js).
function splitsPage({ w, m, splits, releases, ok }) {
  const msg = { split: 'Saved.', release: 'Saved.', pct: 'The shares cannot come to more than all of your side.', 'release-missing': 'Say who or what the release is for.' }[ok];
  const used = splits.reduce((a, x) => a + x.pct, 0);
  return layout({ title: `Shares and releases · ${tidy(w.title)}`, body: `<section class="narrow cn">
<p class="k">Shares and releases</p><h1>${esc(tidy(w.title))}</h1>
<figure class="lc-fig"><img src="/img/${esc(w.slug)}/screen" alt=""></figure>
${msg ? `<p class="ok">${msg}</p>` : ''}
<h2>Who shares in it</h2>
<p class="note">Shares come out of your side of each sale (${m.share_pct || 85}% of the price); the house&rsquo;s part is never touched. ${used ? `${used}% of your side is shared; ${100 - used}% is yours.` : 'All of your side is yours.'}</p>
${splits.length ? `<ul class="cn-c">${splits.map(x => `<li><div><b>${esc(x.name)}</b> <span>${esc(x.role || '')} &middot; ${x.pct}% of your side${x.did ? ` &middot; ${esc(x.did)}` : ''}</span></div><form method="post"><input type="hidden" name="act" value="unsplit"><input type="hidden" name="id" value="${x.id}"><button class="link">Remove</button></form></li>`).join('')}</ul>` : ''}
<form method="post" class="form cn-f"><input type="hidden" name="act" value="split">
<label>Name<input name="name" required></label><label>Role<input name="role" placeholder="Second shooter, assistant, estate"></label>
<label>Share of your side, %<input name="pct" type="number" min="1" max="100" step="0.5" required></label><label>Email, to be paid<input name="email" type="email"></label>
<label>Their identifier (optional)<input name="did" placeholder="did:web:…"></label><button class="btn">Add a share</button></form>
<h2>Releases</h2>
<p class="note">A photograph with a recognisable person needs their consent before it is shown; a private property may need the owner&rsquo;s. Record each release here. Names stay with you and the house; nothing here is shown to the public.</p>
${releases.length ? `<ul class="cn-c">${releases.map(x => `<li><div><b>${x.kind === 'property' ? 'Property' : 'Person'}: ${esc(x.subject)}</b> <span>${x.signed_on ? `signed ${esc(x.signed_on)}` : 'date not given'}${x.kept_at ? ` &middot; kept at ${esc(x.kept_at)}` : ''}</span>${x.note ? `<p>${esc(x.note)}</p>` : ''}</div><form method="post"><input type="hidden" name="act" value="unrelease"><input type="hidden" name="id" value="${x.id}"><button class="link">Remove</button></form></li>`).join('')}</ul>` : ''}
<form method="post" class="form cn-f"><input type="hidden" name="act" value="release">
<label>For<select name="kind"><option value="model">A person pictured</option><option value="property">A property</option></select></label>
<label>Who or what<input name="subject" required></label><label>Signed on<input name="signed_on" type="date"></label>
<label>Where the signed copy is kept<input name="kept_at" placeholder="A folder, a link, a drawer"></label><label>Note<input name="note"></label><button class="btn">Record the release</button></form>
<p class="sr-also"><a href="/w/${esc(w.slug)}">Back to the photograph</a></p></section>` });
}
// The Studio's partners: issue a key (shown once), set where sales are told, pause.
function partnersDesk({ rows, key = null, secret = null, newSlug = null, house, base }) {
  return layout({ studio: true, title: 'Partners · Studio', body: `<section class="studio-wrap cn">
<p class="k">Back office</p><h1>Partners.</h1>
<p class="lede">Rights platforms, registries and houses that work alongside Watermark. Each gets a key; each maker decides whether that partner may see their work. The design is in docs/PARTNERS.md. The house&rsquo;s identity is <code>${esc(house)}</code> (<a href="/.well-known/did.json">did.json</a>).</p>
${key ? `<div class="cn-key"><p><b>The key for ${esc(newSlug)}.</b> It is shown once, here, and never again. Hand it over by letter, never in a public place.</p><code>${esc(key)}</code>${secret ? `<p>The secret that signs each sale notice they receive (header <code>x-watermark-signature: sha256=…</code>):</p><code>${esc(secret)}</code>` : ''}</div>` : ''}
${rows.length ? `<ul class="cn-c">${rows.map(p => `<li><div><b>${esc(p.name)}</b> <span>${p.active ? 'Active' : 'Paused'} &middot; ${p.makers} maker${p.makers === 1 ? '' : 's'} connected &middot; ${p.claims} claim${p.claims === 1 ? '' : 's'} &middot; ${p.sends} notice${p.sends === 1 ? '' : 's'} sent${p.did ? ` &middot; ${esc(p.did)}` : ''}</span>
<form method="post" action="/studio/partners/${p.id}" class="cn-inline"><input type="hidden" name="act" value="webhook"><input name="webhook" value="${esc(p.webhook || '')}" placeholder="https://… where sales are told"><button class="link">Save</button></form></div>
<form method="post" action="/studio/partners/${p.id}"><input type="hidden" name="act" value="${p.active ? 'pause' : 'resume'}"><button class="link">${p.active ? 'Pause' : 'Resume'}</button></form></li>`).join('')}</ul>` : ''}
<h2>Add a partner</h2>
<form method="post" class="form cn-f"><label>Name<input name="name" required></label><label>Site<input name="site" placeholder="https://"></label><label>Their identifier<input name="did" placeholder="did:web:…"></label>
<label>Where sales are told (webhook)<input name="webhook" placeholder="https://…"></label><label>Note, shown to makers<input name="note" placeholder="What they do for a maker, in one line"></label><button class="btn">Add, and issue a key</button></form>
<p class="note">A partner reads <code>${esc(base)}/api/partner/v1</code> with <code>Authorization: Bearer &lt;key&gt;</code>.</p></section>` });
}

module.exports = { vrPage, setLaunched, feedbackPage, feedbackDesk, connections, splitsPage, partnersDesk, GUIDE_SWITCH, plainRights, savePage, noticesPage, basketPage, WAVE_MARK, VER, handPage, sign, SIGNS, setHouseMaker, setDeskAdmin, setDeskGallery, openShelf: (...a) => require('./open').openShelf(...a), offline, appPage, library: (...a) => require('./library').library(...a), text: (...a) => require('./library').text(...a), verifyFile, hall, hallDesk, indexRow, notFound, setDeskPath, setDeskStatus, viewingRoom, farewell, artists, copyrightPage, swapNew, swap, guestbook, friends, friendThanks, keeping, makerSlug, mlink, seat, contractBody, contractPage, closerEdit, regTag, isRegistered, isReference, refTag, tidy, K_MARK, tip, tipThanks, SHIELD, shieldBlock, voicesEdit, signin, series, setThanks, claim, makerPage, patronThanks, journal, patronage, collectors, collector, layout, room, viewer, life, home, reported, collection, work, buy, ask, thanks, licenseForm, requested, certificate, verify, registerPage, about, terms, esc, money, date, termText };

// Tell us (beta): one page, a few fields, no account needed. What lands is read at Studio → Feedback.
function feedbackPage({ from = '', sent = false, err = '' }) {
  return layout({ title: 'Tell us · Watermark', path: '/feedback', body: `<section class="narrow fb"><p class="k">Watermark is in beta</p>
<h1>${sent ? 'Thank you. It is with us.' : 'Tell us what you find.'}</h1>
${sent ? `<p class="lede">Every note is read by the people who make the house. If you left an address, we may write back.</p><p><a class="btn" href="${esc(from && from.startsWith('/') ? from : '/')}">Back to where you were</a></p>` : `<p class="lede">Something that broke, something that confused you, something you loved. A line is enough.</p>
${err ? `<p class="err">${esc(err)}</p>` : ''}<form method="post" action="/feedback" class="form fb-f">
<input type="hidden" name="from" value="${esc(from)}">
<fieldset class="fb-k"><legend>It was</legend>${[['broke', 'Something broke'], ['confusing', 'Something confused me'], ['idea', 'An idea'], ['loved', 'Something I loved']].map(([v, l], i) => `<label><input type="radio" name="kind" value="${v}"${i === 0 ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
<label>What happened<textarea name="body" rows="5" maxlength="4000" required placeholder="Where you were, what you did, what you expected."></textarea></label>
<label>Your email <small>(only if you would like an answer)</small><input name="email" type="email" autocomplete="email"></label>
<input name="website" tabindex="-1" autocomplete="off" class="hpot" aria-hidden="true">
<button class="btn">Send</button></form>`}</section>` });
}
function feedbackDesk({ rows, ok }) {
  const label = { broke: 'Broke', confusing: 'Confusing', idea: 'Idea', loved: 'Loved' };
  return layout({ studio: true, path: '/studio/feedback', title: 'Feedback · Watermark', body: `<section class="studio-wrap"><p class="k">The beta</p><h1>Feedback.</h1>${ok ? `<p class="ok">${esc(ok)}</p>` : ''}
<p class="lede">What testers and visitors told the house, newest first. Mark each one done when it is answered or fixed.</p>
${rows.length ? `<ol class="fb-l">${rows.map(r => `<li class="${r.done ? 'fb-done' : ''}"><p class="fb-m"><b>${label[r.kind] || 'Note'}</b> &middot; ${esc(String(r.at).slice(0, 16).replace('T', ' '))} UTC${r.page ? ` &middot; <a href="${esc(r.page)}">${esc(r.page)}</a>` : ''}${r.email ? ` &middot; <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''}${r.device ? ` &middot; <small>${esc(r.device)}</small>` : ''}</p><p class="fb-b">${esc(r.body).replace(/\n/g, '<br>')}</p><form method="post" action="/studio/feedback/${r.id}" class="inline"><button class="link">${r.done ? 'Open again' : 'Done'}</button></form></li>`).join('')}</ol>` : '<p>Nothing yet.</p>'}</section>` });
}
