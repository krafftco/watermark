// Watermark, as an app. The shell (styles, scripts, the marks) is kept on the device; pages come from the
// house and the last copy of each is kept so the rooms you have walked are there when the connection is
// not; photographs are kept as you see them, up to a few hundred, oldest out first. Nothing private is
// cached: the studio, your gallery, the Studio, sign-in and anything with a key go straight to the house.
const V = 'wm-2026-10-23cold';
const SHELL = ['/static/style.css', '/static/watermark-logo.svg', '/static/wave.svg', '/static/collection.js', '/static/guard.js', '/static/room.js', '/static/house.js', '/static/signin.js', '/static/applause.js', '/offline'];
const PRIVATE = /^\/(notices|api\/notices|basket|api\/basket|stroll|wander|api\/stroll|frame\/|tv$|show\/|cab\/|cabinet|showings|hang\/.*\/g\/|account|yours|studio|signin|signout|auth|api\/me|c\/|d\/|seat\/|k\/|collector\/|swap|market\/.*\/bid|library\/d\/|w\/[^/]+\/archive)/;
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== V + '-img' && k !== V + '-pages').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const trim = async (name, max) => { const c = await caches.open(name); const ks = await c.keys(); if (ks.length > max) await Promise.all(ks.slice(0, ks.length - max).map(k => c.delete(k))); };
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (PRIVATE.test(u.pathname) || u.searchParams.has('k')) return;
  // The shell: cache first, refreshed in the background.
  if (u.pathname.startsWith('/static/')) { e.respondWith(caches.open(V).then(async c => { const hit = await c.match(r); const net = fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => hit); return hit || net; })); return; }
  // Photographs as shown: cache first, a few hundred kept.
  if (u.pathname.startsWith('/img/') || u.pathname.startsWith('/portrait/')) { e.respondWith(caches.open(V + '-img').then(async c => { const hit = await c.match(r); const net = fetch(r).then(res => { if (res.ok) { c.put(r, res.clone()); trim(V + '-img', 400); } return res; }); if (hit) { e.waitUntil(net.catch(() => {})); return hit; } return net; })); return; }
  // Pages: the house first; the last copy if the house cannot be reached; the offline room if there is none.
  if (r.mode === 'navigate' || (r.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(fetch(r).then(async res => { if (res.ok && res.type === 'basic') caches.open(V + '-pages').then(c => { c.put(r, res.clone()); trim(V + '-pages', 120); }); if (res.status >= 502 && res.status <= 504) return (await caches.match(r)) || (await caches.match('/offline')) || res; return res; })
      .catch(async () => (await caches.match(r)) || (await caches.match('/offline')) || new Response('The house cannot be reached.', { status: 503, headers: { 'Content-Type': 'text/plain' } })));
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
