// Watermark, as an app. The shell (styles, scripts, the marks) is kept on the device; pages come from the
// house and the last copy of each is kept so the rooms you have walked are there when the connection is
// not; photographs are kept as you see them, up to a few hundred, oldest out first. Nothing private is
// cached: the studio, your gallery, the Studio, sign-in and anything with a key go straight to the house.
const V = 'wm-2026-11-15targets';
const SHELL = ['/static/style.css', '/static/watermark-logo.svg', '/static/wave.svg', '/static/collection.js', '/static/guard.js', '/static/room.js', '/static/house.js', '/static/signin.js', '/static/applause.js', '/offline'];
const PRIVATE = /^\/(join$|own$|notices|api\/notices|basket|api\/basket|stroll|wander|api\/stroll|frame\/|tv$|show\/|cab\/|cabinet|showings|hang\/.*\/g\/|account|yours|studio|signin|signout|auth|api\/me|c\/|d\/|seat\/|k\/|collector\/|swap|market\/.*\/bid|library\/d\/|w\/[^/]+\/archive)/;
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== V + '-img' && k !== V + '-pages').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Does the answer fit the file asked for? A stylesheet is text/css, a script is JavaScript, a picture is an image, a font a font; an HTML page is never any of them.
const KIND = { css: /^text\/css/, js: /javascript|ecmascript/, mjs: /javascript|ecmascript/, svg: /^image\/svg/, png: /^image\//, jpg: /^image\//, jpeg: /^image\//, webp: /^image\//, gif: /^image\//, ico: /^image\//, json: /json/, webmanifest: /json|manifest/, woff: /font|octet/, woff2: /font|octet/, mp3: /^audio\//, html: /^text\/html/ };
const fits = (path, res) => { if (!res.ok || res.type !== 'basic') return false; const t = (res.headers.get('content-type') || '').toLowerCase(); const ext = (path.match(/\.([a-z0-9]+)$/) || [])[1]; const k = ext && KIND[ext]; return k ? k.test(t) : !/^text\/html/.test(t); };
const trim = async (name, max) => { const c = await caches.open(name); const ks = await c.keys(); if (ks.length > max) await Promise.all(ks.slice(0, ks.length - max).map(k => c.delete(k))); };
// The installed app never stranded on a file (#43; Will, 15 Nov: "it opens this black screen viewer… you can't get out").
// The app has no browser bar: a navigation that lands on a file (or on a bare error) would replace the house with it, and
// reopening the app returns to it. Pages tell the worker when they run as the installed app on iPhone and iPad
// (navigator.standalone, where the app keeps its own worker, apart from Safari's); for such a device, a navigation that
// answers a file or a bare status is answered instead by the house's own page: what it is, a way to take the file
// (the share sheet, by save.js), and a way back. A browser's downloads are untouched. ?wm_take=1 passes straight through.
const APPKEY = '/__wm/app';
let isApp = null;
self.addEventListener('message', e => { const d = e.data || {}; if (d.wm === 'app' && !isApp) { isApp = true; e.waitUntil(caches.open(V + '-pages').then(c => c.put(APPKEY, new Response('1')))); } });
const appNow = async () => { if (isApp === null) isApp = !!(await caches.match(APPKEY)); return isApp; };
const H = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isFileAnswer = res => { const t = (res.headers.get('content-type') || '').toLowerCase(); return !/^text\/html/.test(t) || /attachment/i.test(res.headers.get('content-disposition') || ''); };
function landing(url, res) {
  const u = new URL(url); const ok = res && res.ok; const cd = res ? res.headers.get('content-disposition') || '' : '';
  let name = (cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1]; try { name = name ? decodeURIComponent(name) : ''; } catch (x) { name = ''; }
  name = name || (cd.match(/filename="?([^";]+)"?/i) || [])[1] || decodeURIComponent(u.pathname.split('/').pop() || '') || 'The file';
  u.searchParams.set('wm_take', '1');
  const body = ok ? `<p class="k">From Watermark</p><h1>${H(name)}</h1><p class="lede">The file is ready. Take it, and you come back here.</p><p class="nf-row"><a class="buy-btn" href="${H(u.pathname + u.search)}" download="${H(name)}">Take the file</a><a class="nf-alt" href="/" data-wm-home>The front door</a></p>`
    : `<p class="k">Oh, oops</p><h1>This could not be opened.</h1><p class="lede">${res && res.status === 404 ? 'It is not here, or not any longer.' : res && res.status === 410 ? 'It has been used, or it has closed.' : 'The house could not open it just now.'}</p><p class="nf-row"><a class="buy-btn" href="/" data-wm-home>The front door</a><a class="nf-alt" href="/wander">Wander</a></p>`;
  const html = `<!doctype html><html lang="en" class="wm-app"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><title>${ok ? H(name) : 'Not opened'} · Watermark</title><link rel="stylesheet" href="/static/style.css?v=${V}"><script>window.__WM_APP=true</script></head><body class="bare"><div class="nv-float" data-up="/"><span class="nv-bk"><a class="nv-back" data-nv-back href="/" aria-label="Back"><svg viewBox="0 0 24 24" class="ic nv-chev" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Back</span></a></span></div><main id="main" class="nf"><div class="nf-t">${body}</div></main><script>(function(){var b=document.querySelector('[data-nv-back]');b.onclick=function(e){e.preventDefault();var l=false;addEventListener('pagehide',function(){l=true},{once:true});if(history.length>1)history.back();setTimeout(function(){if(!l)location.href='/'},500)};})();</script><script src="/static/save.js?v=${V}" defer></script></body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-WM-Landing': ok ? 'file' : 'error' } });
}
// A navigation in the app: the answer (kept as any page is), unless it is a file or a bare status; a failed one is the
// last copy or the cold page, never blank. An opaque redirect is the browser's to follow, never a file.
const wrap = (r, res) => res.type === 'basic' && isFileAnswer(res) ? landing(r.url, res) : res;
const keepable = u => !PRIVATE.test(u.pathname) && !u.searchParams.has('k');
const appNav = (e, r, u) => e.respondWith(fetch(r).then(async res => {
  if (res.ok && res.type === 'basic' && keepable(u) && /text\/html/.test(res.headers.get('content-type') || '') && !res.headers.get('content-disposition')) caches.open(V + '-pages').then(c => { c.put(r, res.clone()); trim(V + '-pages', 120); });
  if (res.status >= 502 && res.status <= 504) return (keepable(u) && await caches.match(r)) || (await caches.match('/offline')) || wrap(r, res);
  return wrap(r, res);
}).catch(async () => (keepable(u) && await caches.match(r)) || (await caches.match('/offline')) || landing(r.url, null)));
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (r.mode === 'navigate' && !u.searchParams.has('wm_take') && u.pathname !== '/wander') {
    if (isApp) return appNav(e, r, u);
    if (isApp === null) {
      // Not yet known since the worker woke: a navigation that may be a file waits on one cache read; the rest go on.
      if (PRIVATE.test(u.pathname) || u.searchParams.has('k') || /\.[a-z0-9]{2,5}$|\/(file|take|instax|save)$/i.test(u.pathname)) return e.respondWith(appNow().then(a => fetch(r).then(res => a ? wrap(r, res) : res).catch(async () => a ? (await caches.match('/offline')) || landing(r.url, null) : Response.error())));
      e.waitUntil(appNow());
    }
  }
  // Wander in the subway (Will, 23 Oct): the room itself is kept, one copy, so it opens with no signal; what hangs in
  // it then comes from the pack the page keeps (stroll.js). Only the room, never the feed and never a drawer.
  if (u.pathname === '/wander' && (r.mode === 'navigate' || (r.headers.get('accept') || '').includes('text/html'))) {
    e.respondWith(fetch(r).then(async res => { if (res.ok && res.type === 'basic') caches.open(V + '-pages').then(c => c.put('/wander', res.clone())); if (res.status >= 502 && res.status <= 504) return (await caches.match('/wander')) || (await caches.match('/offline')) || res; return res; })
      .catch(async () => (await caches.match('/wander')) || (await caches.match('/offline')) || landing(r.url, null)));
    return;
  }
  if (PRIVATE.test(u.pathname) || u.searchParams.has('k')) return;
  // The shell: cache first, refreshed in the background. Never kept unless it is what was asked for (27 Oct: during a
  // deploy's cold minute the edge answered /static/style.css with the cold page, 200 and HTML, and the worker kept it as
  // the stylesheet, so every page on the phone came up bare until the cache was dropped): the answer's type must fit
  // the file's name, and a wrong answer is never served over a good copy already held.
  if (u.pathname.startsWith('/static/')) { e.respondWith(caches.open(V).then(async c => { const hit = await c.match(r); const net = fetch(r).then(res => { if (fits(u.pathname, res)) { c.put(r, res.clone()); return res; } return hit || res; }).catch(() => hit); return hit || net; })); return; }
  // Photographs as shown: cache first, a few hundred kept; only a picture is ever kept as one.
  if (u.pathname.startsWith('/img/') || u.pathname.startsWith('/portrait/')) { e.respondWith(caches.open(V + '-img').then(async c => { const hit = await c.match(r); const net = fetch(r).then(res => { if (res.ok && (res.headers.get('content-type') || '').startsWith('image/') && !res.headers.get('x-making')) { c.put(r, res.clone()); trim(V + '-img', 400); return res; } return hit || res; }); if (hit) { e.waitUntil(net.catch(() => {})); return hit; } return net; })); return; }
  // Pages: the house first; the last copy if the house cannot be reached; the offline room if there is none.
  if (r.mode === 'navigate' || (r.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(fetch(r).then(async res => { if (res.ok && res.type === 'basic' && (res.headers.get('content-type') || '').includes('text/html') && !res.headers.get('content-disposition')) caches.open(V + '-pages').then(c => { c.put(r, res.clone()); trim(V + '-pages', 120); }); /* a download is never kept as a page */ if (res.status >= 502 && res.status <= 504) return (await caches.match(r)) || (await caches.match('/offline')) || res; return res; })
      .catch(async () => (await caches.match(r)) || (await caches.match('/offline')) || landing(r.url, null)));
  }
});
// Notifications from the house: shown on the lock screen; a tap opens the right room (or brings an open one forward).
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Watermark', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Watermark', { body: d.body || '', icon: d.icon || '/static/app/icon-192.png', badge: d.badge || '/static/app/icon-192.png', image: d.image, tag: d.tag, renotify: false, data: { url: d.url || '/notices' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || '/notices';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => { for (const c of list) { if (new URL(c.url).origin === self.location.origin && 'focus' in c) { c.navigate(url); return c.focus(); } } return self.clients.openWindow(url); }));
});
