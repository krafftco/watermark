/* The rows (src/rows.js): the front door as a television's menu. Arrows move the focus from tile to tile, up and
   down between rows, Enter opens; a focused tile scrolls its row to keep itself in view; a swipe moves a row on a
   phone (the browser does that). Nothing here is needed to read the page. */
(function () {
  'use strict';
  var root = document.querySelector('[data-rws]'); if (!root) return;
  var rows = [].slice.call(root.querySelectorAll('[data-rw]'));
  function tiles(r) { return [].slice.call(r.querySelectorAll('.rw-t')); }
  function where(el) { for (var i = 0; i < rows.length; i++) { var t = tiles(rows[i]); var j = t.indexOf(el); if (j >= 0) return { r: i, c: j }; } return null; }
  function go(r, c) { r = Math.max(0, Math.min(rows.length - 1, r)); var t = tiles(rows[r]); if (!t.length) return; c = Math.max(0, Math.min(t.length - 1, c)); t[c].focus({ preventScroll: true }); t[c].scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }
  document.addEventListener('keydown', function (e) {
    var a = document.activeElement; if (!a || !a.classList || !a.classList.contains('rw-t')) return;
    var p = where(a); if (!p) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(p.r, p.c + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(p.r, p.c - 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); go(p.r + 1, p.c); } else if (e.key === 'ArrowUp') { e.preventDefault(); go(p.r - 1, p.c); }
  });
  // A hover brings a tile forward a little, as a remote's focus does; the row itself does not move.
  root.addEventListener('focusin', function (e) { var t = e.target.closest && e.target.closest('.rw-t'); if (t) t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
})();
