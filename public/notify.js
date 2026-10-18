/* Notifications on this device: the bell's count in the header, and on /notices the one button that turns on
   lock-screen notifications (Web Push through the service worker). iPhone and iPad allow it only in the installed app. */
(function () {
  if (window.__WM_NOTIFY) return; window.__WM_NOTIFY = 1;
  var bell = document.querySelector('[data-nv-bell]'), page = document.querySelector('[data-notices]');
  // The bell: shown to anyone signed in; a dot and a count when something is new.
  if (bell || page) fetch('/api/notices', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
    if (!j || !j.in || !bell) return;
    bell.hidden = false; var n = bell.querySelector('[data-nv-n]'); n.textContent = j.unread ? (j.unread > 9 ? '9+' : j.unread) : ''; bell.classList.toggle('has', !!j.unread);
    try { if (navigator.setAppBadge) { if (j.unread) navigator.setAppBadge(j.unread); else navigator.clearAppBadge(); } } catch (e) {}
  }).catch(function () {});
  if (!page) return;
  var key = page.getAttribute('data-key'), state = page.querySelector('[data-nt-state]'), on = page.querySelector('[data-nt-on]'), test = page.querySelector('[data-nt-test]'), ios = page.querySelector('[data-nt-ios]');
  var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function b64(s) { var p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function say(t) { state.textContent = t; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (isIOS && !standalone) { say('Add Watermark to your Home Screen to be told here.'); ios.hidden = false; } else say('This browser cannot show notifications. The list below is always kept.');
    return;
  }
  navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
    return reg.pushManager.getSubscription().then(function (sub) {
      function done(sub) { say('On. You will be told here.'); on.hidden = true; test.hidden = false; return sub; }
      if (sub && Notification.permission === 'granted') { send(sub); return done(sub); }
      if (Notification.permission === 'denied') { say('Notifications are blocked for Watermark in this browser’s settings.'); return; }
      say('Off.'); on.hidden = false;
      on.onclick = function () {
        on.disabled = true;
        Notification.requestPermission().then(function (p) {
          if (p !== 'granted') { on.disabled = false; say('Not allowed. You can change it in the browser’s settings.'); return; }
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }).then(function (s) { return send(s).then(function () { done(s); }); });
        }).catch(function (e) { on.disabled = false; say('Could not turn on: ' + (e && e.message || 'try again')); });
      };
    });
  }).catch(function () { say('Could not reach the house’s service worker. Reload and try again.'); });
  function send(sub) { return fetch('/notices/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub }) }); }
  test.onclick = function () { test.disabled = true; fetch('/notices/test', { method: 'POST' }).then(function () { test.textContent = 'Sent'; setTimeout(function () { test.disabled = false; test.textContent = 'Send a test'; }, 4000); }); };
})();
