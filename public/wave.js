// The wave that swims (Will, 21 Oct: "the watermark W is really the wandering W, the wiggling W; an animation where the
// wave goes up and down: that's our loading, a beautiful animation"). The house's mark (window.__WM_WAVE, the logo's
// wave, viewBox 1.5 14.2 41 11) is set three abreast inside a window one wave wide and slid left by one wave over and
// over, so the crest travels; the window itself breathes up and down. `WMWave.show(where)` puts it up (fixed, top
// centre, unless `where` is an element to fill); `hide()` takes it down; it never shows for less than 400 ms so it
// never flickers. Shown by the house: on any same-origin navigation that takes more than 250 ms (a tap on a link, a
// form sent), while Wander fetches more, while Find searches, and by any script that asks. Reduced motion: it holds
// still and fades instead.
(function () {
  'use strict';
  var el = null, t0 = 0, pending = null, hideT = null;
  function make() {
    var svg = window.__WM_WAVE || '';
    var d = document.createElement('div'); d.className = 'wm-wave'; d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<div class="wm-wave-w"><div class="wm-wave-r">' + svg + svg + svg + '</div></div>';
    return d;
  }
  function show(where) {
    if (pending) return; var host = where && where.nodeType ? where : document.body;
    pending = setTimeout(function () { pending = null; if (!el) el = make(); el.classList.toggle('wm-wave-in', host !== document.body); host.appendChild(el); t0 = Date.now(); requestAnimationFrame(function () { el.classList.add('on'); }); }, where && where.now ? 0 : 250);
  }
  function hide() {
    if (pending) { clearTimeout(pending); pending = null; }
    if (!el || !el.parentNode) return;
    var wait = Math.max(0, 400 - (Date.now() - t0)); clearTimeout(hideT);
    hideT = setTimeout(function () { el.classList.remove('on'); setTimeout(function () { if (el && el.parentNode && !el.classList.contains('on')) el.parentNode.removeChild(el); }, 350); }, wait);
  }
  // Navigations: a tap on a link of the house, or a form sent, shows the wave until the page changes.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a[href]'); if (!a || a.target === '_blank' || a.hasAttribute('download') || a.getAttribute('href').charAt(0) === '#') return;
    var u; try { u = new URL(a.href, location.href); } catch (x) { return; }
    if (u.origin !== location.origin || (u.pathname === location.pathname && u.search === location.search)) return;
    show();
  }, true);
  document.addEventListener('submit', function (e) { if (!e.defaultPrevented) show(); }, true);
  addEventListener('pageshow', hide); addEventListener('pagehide', hide); addEventListener('load', hide);
  // A navigation that a script cancelled after the click (the stroll's own taps, the viewer) must not leave it up.
  setInterval(function () { if (el && el.parentNode && el.classList.contains('on') && !el.classList.contains('wm-wave-in') && document.visibilityState === 'visible' && Date.now() - t0 > 12000) hide(); }, 2000);
  window.WMWave = { show: show, hide: hide };
})();
