// The reading room (src/reading.js): chapters without a page load, the place kept on the device, size and light.
(function () {
  'use strict';
  var main = document.querySelector('main.rd[data-read]'); if (!main) return;
  var R; try { R = JSON.parse(main.getAttribute('data-read')); } catch (e) { return; }
  var key = 'wm_read_' + R.slug, S = {}; try { S = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { S = {}; }
  var pref = {}; try { pref = JSON.parse(localStorage.getItem('wm_read_pref') || '{}'); } catch (e) { pref = {}; }
  var html = document.documentElement, at = R.at;
  function apply() { html.setAttribute('data-rd-theme', pref.theme || 'paper'); html.style.setProperty('--rd-size', (pref.size || 20) + 'px'); var b = main.querySelector('[data-rd-theme] span'); if (b) b.textContent = { paper: 'Light', sepia: 'Sepia', night: 'Night' }[pref.theme || 'paper']; }
  function savePref() { try { localStorage.setItem('wm_read_pref', JSON.stringify(pref)); } catch (e) { /* */ } }
  function keep() { S.c = at; S.y = window.scrollY / Math.max(1, document.body.scrollHeight - innerHeight); S.at = Date.now(); try { localStorage.setItem(key, JSON.stringify(S)); } catch (e) { /* */ } }
  function show(i, y) {
    i = Math.max(0, Math.min(R.n - 1, i)); at = i;
    var secs = main.querySelectorAll('.rd-ch'); for (var k = 0; k < secs.length; k++) secs[k].hidden = (+secs[k].getAttribute('data-ch') !== i);
    var links = main.querySelectorAll('[data-rd-toc-panel] a'); for (var j = 0; j < links.length; j++) { if (+links[j].getAttribute('data-c') === i) links[j].setAttribute('aria-current', 'page'); else links[j].removeAttribute('aria-current'); }
    try { history.replaceState(null, '', '?c=' + i); } catch (e) { /* */ }
    var toc = main.querySelector('[data-rd-toc-panel]'); if (toc) toc.hidden = true;
    requestAnimationFrame(function () { window.scrollTo(0, y ? y * Math.max(1, document.body.scrollHeight - innerHeight) : 0); keep(); });
  }
  // The place kept: offered back once, on arrival without a chapter asked for.
  if (!/[?&]c=/.test(location.search) && S.c != null && (S.c !== at || S.y > 0.02)) {
    var back = document.createElement('div'); back.className = 'rd-resume'; back.innerHTML = '<span>You were reading.</span> <button type="button">Go back to your place</button>';
    back.querySelector('button').addEventListener('click', function () { show(S.c, S.y); back.remove(); }); main.appendChild(back); setTimeout(function () { back.classList.add('on'); }, 50); setTimeout(function () { back.remove(); }, 12000);
  }
  main.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-c]'); if (a) { e.preventDefault(); show(+a.getAttribute('data-c'), 0); return; }
    var t = e.target.closest('[data-rd-toc]'); if (t) { var p = main.querySelector('[data-rd-toc-panel]'); p.hidden = !p.hidden; return; }
    var s = e.target.closest('[data-rd-size]'); if (s) { pref.size = Math.max(15, Math.min(30, (pref.size || 20) + (s.getAttribute('data-rd-size') === '+' ? 1 : -1))); apply(); savePref(); return; }
    var th = e.target.closest('[data-rd-theme]'); if (th) { pref.theme = { paper: 'sepia', sepia: 'night', night: 'paper' }[pref.theme || 'paper']; apply(); savePref(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input,textarea')) return;
    if (e.key === 'ArrowRight') show(at + 1, 0); else if (e.key === 'ArrowLeft') show(at - 1, 0);
    else if (e.key === 'j' || e.key === ' ') { e.preventDefault(); window.scrollBy(0, innerHeight * 0.85); } else if (e.key === 'k') window.scrollBy(0, -innerHeight * 0.85);
    else if (e.key === 'Escape') { var p = main.querySelector('[data-rd-toc-panel]'); if (p) p.hidden = true; }
  });
  var t0 = null; addEventListener('scroll', function () { clearTimeout(t0); t0 = setTimeout(keep, 400); }, { passive: true });
  // Still: the bar fades after a while and comes back on a move.
  var still = null; function wake() { main.classList.remove('rd-still'); clearTimeout(still); still = setTimeout(function () { main.classList.add('rd-still'); }, 4000); }
  ['mousemove', 'touchstart', 'keydown', 'scroll'].forEach(function (ev) { addEventListener(ev, wake, { passive: true }); }); wake();
  apply();
})();
