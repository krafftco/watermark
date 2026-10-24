// The reading room (src/reading.js): a book, not a web page. The cover first; chapters without a page load; Pages
// (the chapter set in columns the height of the screen, turned by a tap at either edge, a swipe, or the arrows) or
// Scroll; the place kept on the device; size and light; a progress line. Nothing of the reading is told to anyone.
(function () {
  'use strict';
  var main = document.querySelector('main.rdr[data-read]'); if (!main) return;
  var R; try { R = JSON.parse(main.getAttribute('data-read')); } catch (e) { return; }
  var key = 'wm_read_' + R.slug, S = {}; try { S = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { S = {}; }
  var pref = {}; try { pref = JSON.parse(localStorage.getItem('wm_read_pref') || '{}'); } catch (e) { pref = {}; }
  var html = document.documentElement, at = R.at, cover = main.querySelector('[data-rd-cover]'), page = main.querySelector('[data-rd-page]');
  var TOUCH = matchMedia('(pointer:coarse)').matches;
  if (!pref.mode) pref.mode = TOUCH ? 'pages' : 'scroll';
  function paged() { return pref.mode === 'pages'; }
  function apply() {
    html.setAttribute('data-rd-theme', pref.theme || 'paper'); html.style.setProperty('--rd-size', (pref.size || 20) + 'px');
    var b = main.querySelector('button[data-rd-theme] span'); if (b) b.textContent = { paper: 'Light', sepia: 'Sepia', night: 'Night' }[pref.theme || 'paper'];
    main.classList.toggle('rdr-paged', paged()); var m = main.querySelector('[data-rd-mode] span'); if (m) m.textContent = paged() ? 'Pages' : 'Scroll';
    var turns = main.querySelectorAll('[data-rd-turn]'); for (var i = 0; i < turns.length; i++) turns[i].hidden = !paged() || !cover.hidden;
  }
  function savePref() { try { localStorage.setItem('wm_read_pref', JSON.stringify(pref)); } catch (e) { /* */ } }
  function sec() { return main.querySelector('.rdr-ch[data-ch="' + at + '"]'); }
  function depth() { var s = sec(); if (!s) return 0; if (paged()) return s.scrollLeft / Math.max(1, s.scrollWidth - s.clientWidth); return window.scrollY / Math.max(1, document.body.scrollHeight - innerHeight); }
  function keep() { if (!cover.hidden) return; S.c = at; S.y = depth(); S.at = Date.now(); try { localStorage.setItem(key, JSON.stringify(S)); } catch (e) { /* */ } prog(); }
  function prog() { var p = main.querySelector('[data-rd-prog]'); if (p) p.style.width = Math.round(100 * (at + depth()) / R.n) + '%'; }
  function show(i, y) {
    i = Math.max(0, Math.min(R.n - 1, i)); at = i; cover.hidden = true;
    var secs = main.querySelectorAll('.rdr-ch'); for (var k = 0; k < secs.length; k++) secs[k].hidden = (+secs[k].getAttribute('data-ch') !== i);
    var links = main.querySelectorAll('[data-rd-toc-panel] a'); for (var j = 0; j < links.length; j++) { if (+links[j].getAttribute('data-c') === i) links[j].setAttribute('aria-current', 'page'); else links[j].removeAttribute('aria-current'); }
    try { history.replaceState(null, '', '?c=' + i); } catch (e) { /* */ }
    var toc = main.querySelector('[data-rd-toc-panel]'); if (toc) toc.hidden = true;
    apply();
    requestAnimationFrame(function () {
      var s = sec();
      if (paged()) { window.scrollTo(0, 0); if (s) s.scrollLeft = (y || 0) * Math.max(0, s.scrollWidth - s.clientWidth); }
      else window.scrollTo(0, y ? y * Math.max(1, document.body.scrollHeight - innerHeight) : 0);
      keep();
    });
  }
  // A page turned: one screen's width of the chapter; past the end, the next chapter; before the start, the one before.
  function turn(dir) {
    var s = sec(); if (!s || !paged()) { show(at + dir, 0); return; }
    var w = s.clientWidth, max = s.scrollWidth - s.clientWidth, x = s.scrollLeft;
    if (dir > 0 && x >= max - 4) { if (at < R.n - 1) show(at + 1, 0); return; }
    if (dir < 0 && x <= 4) { if (at > 0) show(at - 1, 1); return; }
    s.scrollTo({ left: Math.max(0, Math.min(max, Math.round(x / w) * w + dir * w)), behavior: 'smooth' }); setTimeout(keep, 450);
  }
  // The cover: Begin opens the first chapter, or the place you were at.
  if (cover && !cover.hidden) {
    var resume = S.c != null && (S.c !== 0 || S.y > 0.02);
    var btn = cover.querySelector('[data-rd-begin]'); if (btn && resume) btn.textContent = 'Go back to your place';
    if (btn) btn.addEventListener('click', function () { if (resume) show(S.c, S.y); else show(0, 0); });
    if (resume) { var again = document.createElement('button'); again.type = 'button'; again.className = 'rdr-cover-again'; again.textContent = 'Or begin again'; again.addEventListener('click', function () { show(0, 0); }); btn.parentNode.insertBefore(again, btn.nextSibling); }
  } else if (!/[?&]c=/.test(location.search) && S.c != null && (S.c !== at || S.y > 0.02)) {
    var back = document.createElement('div'); back.className = 'rdr-resume'; back.innerHTML = '<span>You were reading.</span> <button type="button">Go back to your place</button>';
    back.querySelector('button').addEventListener('click', function () { show(S.c, S.y); back.remove(); }); main.appendChild(back); setTimeout(function () { back.classList.add('on'); }, 50); setTimeout(function () { back.remove(); }, 12000);
  }
  main.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-c]'); if (a) { e.preventDefault(); show(+a.getAttribute('data-c'), 0); return; }
    var tn = e.target.closest('[data-rd-turn]'); if (tn) { turn(+tn.getAttribute('data-rd-turn')); return; }
    var t = e.target.closest('[data-rd-toc]'); if (t) { var p = main.querySelector('[data-rd-toc-panel]'); p.hidden = !p.hidden; return; }
    var md = e.target.closest('[data-rd-mode]'); if (md) { pref.mode = paged() ? 'scroll' : 'pages'; savePref(); show(at, 0); return; }
    var s = e.target.closest('[data-rd-size]'); if (s) { pref.size = Math.max(15, Math.min(30, (pref.size || 20) + (s.getAttribute('data-rd-size') === '+' ? 1 : -1))); apply(); savePref(); return; }
    var th = e.target.closest('button[data-rd-theme]'); if (th) { pref.theme = { paper: 'sepia', sepia: 'night', night: 'paper' }[pref.theme || 'paper']; apply(); savePref(); return; }
    // In Pages, a tap on the text's right third turns forward, the left third back.
    if (paged() && cover.hidden && e.target.closest('.rdr-ch') && !e.target.closest('a, button')) { var r = page.getBoundingClientRect(), f = (e.clientX - r.left) / r.width; if (f > 0.66) turn(1); else if (f < 0.34) turn(-1); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input,textarea')) return;
    if (e.key === 'ArrowRight') turn(1); else if (e.key === 'ArrowLeft') turn(-1);
    else if (e.key === 'j' || e.key === ' ') { e.preventDefault(); if (paged()) turn(1); else window.scrollBy(0, innerHeight * 0.85); } else if (e.key === 'k') { if (paged()) turn(-1); else window.scrollBy(0, -innerHeight * 0.85); }
    else if (e.key === 'Escape') { var p = main.querySelector('[data-rd-toc-panel]'); if (p) p.hidden = true; }
  });
  var t0 = null; addEventListener('scroll', function () { clearTimeout(t0); t0 = setTimeout(keep, 400); }, { passive: true });
  page.addEventListener('scroll', function () { clearTimeout(t0); t0 = setTimeout(keep, 300); }, { passive: true, capture: true });
  // A swipe in Pages turns the page; the columns scroll-snap, so the finger does most of it.
  addEventListener('resize', function () { if (paged()) { var y = depth(); show(at, y); } });
  // Still: the bar fades after a while and comes back on a move.
  var still = null; function wake() { main.classList.remove('rdr-still'); clearTimeout(still); still = setTimeout(function () { main.classList.add('rdr-still'); }, 4000); }
  ['mousemove', 'touchstart', 'keydown', 'scroll'].forEach(function (ev) { addEventListener(ev, wake, { passive: true }); }); wake();
  apply(); prog();
})();
