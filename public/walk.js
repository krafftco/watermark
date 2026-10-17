// Walking: arrow keys and a swipe move to the photograph before or after, inside what you came from. The next one
// is fetched while you stand, so the step is instant.
(function () {
  var k = window.__WM_WALK; if (!k) return;
  var open = /[?&]open=1/.test(location.search);
  function go(to) { if (!to) return; location.href = to.href + (document.querySelector('.wv.on') ? '?open=1' : ''); }
  // Prefetch the next page and its image.
  try { ['next', 'prev'].forEach(function (d) { if (!k[d]) return; var l = document.createElement('link'); l.rel = 'prefetch'; l.href = k[d].href; document.head.appendChild(l); var im = new Image(); im.src = k[d].screen; }); } catch (e) {}
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return; var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(k.next); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(k.prev); }
  });
  // Swipe on the plate, or anywhere in the full-screen view.
  var sx = null, sy = null, st = 0;
  document.addEventListener('touchstart', function (e) { var on = e.target.closest('.plate, .wv'); if (!on) { sx = null; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); }, { passive: true });
  document.addEventListener('touchend', function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null; if (Date.now() - st > 700 || Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return; go(dx < 0 ? k.next : k.prev); }, { passive: true });
  // Arrived from full screen: lift straight away.
  if (open) { var p = document.querySelector('[data-viewer]'); if (p) { history.replaceState(null, '', location.pathname); setTimeout(function () { p.click(); }, 60); } }
})();
