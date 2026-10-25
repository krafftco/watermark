// The wave that swims (Will, 21 Oct: "the watermark W is really the wandering W, the wiggling W; an animation where the
// wave goes up and down: that's our loading, a beautiful animation"; 25 Oct: "it doesn't need to go up and down"; the
// tiled logo showed its seams). One true wave now: a sine drawn at the mark's weight and wavelength, three periods in a
// window one logo wide, slid left by exactly one window over and over, so the crest travels and nothing ever joins or
// bobs. `WMWave.show(where)` puts it up (fixed, top centre, unless `where` is an element to fill); `hide()` takes it
// down; it never shows for less than 400 ms so it never flickers. Shown by the house: on any same-origin navigation
// that takes more than 250 ms (a tap on a link, a form sent), while Wander fetches more, while Find searches, and by
// any script that asks. Reduced motion: it holds still and fades instead.
(function () {
  'use strict';
  var el = null, t0 = 0, pending = null, hideT = null;
  // The logo's wave: period 14 of its 41-wide box, a crest 2.3 high, a line 1.75 thick. Drawn over nine periods.
  function path() {
    var P = 14, A = 2.3, d = '', x;
    for (x = -42; x <= 126; x += 0.5) d += (x === -42 ? 'M' : 'L') + x.toFixed(1) + ' ' + (5.5 - A * Math.sin(2 * Math.PI * x / P)).toFixed(2);
    return d;
  }
  function make() {
    var d = document.createElement('div'); d.className = 'wm-wave'; d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<div class="wm-wave-w"><svg class="wm-wave-r" viewBox="0 0 126 11" preserveAspectRatio="none" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="' + path() + '"/></svg></div>';
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
    setTimeout(function () { if (!e.defaultPrevented) show(); }, 0);
  }, true);
  // A form a script takes over (the pay sheet, the hat) never navigates: look again after the other listeners have run.
  document.addEventListener('submit', function (e) { setTimeout(function () { if (!e.defaultPrevented) show(); }, 0); }, true);
  addEventListener('pageshow', hide); addEventListener('pagehide', hide); addEventListener('load', hide);
  // A navigation that a script cancelled after the click (the stroll's own taps, the viewer) must not leave it up.
  setInterval(function () { if (el && el.parentNode && el.classList.contains('on') && !el.classList.contains('wm-wave-in') && document.visibilityState === 'visible' && Date.now() - t0 > 12000) hide(); }, 2000);
  window.WMWave = { show: show, hide: hide };
})();
