// Arrange (26 Oct): the collection in its owner's order. Any wall marked data-arrange-items="<url>" whose children
// carry data-arrange-item="<ref>" can be rearranged by dragging (a mouse, or a press on the grip on a phone); the
// order is posted as a comma-separated list and kept. Nothing else on the page changes.
(function () {
  'use strict';
  var wall = document.querySelector('[data-arrange-items]'); if (!wall) return;
  var url = wall.getAttribute('data-arrange-items'), dragging = null, saveT = null;
  function items() { return [].slice.call(wall.querySelectorAll('[data-arrange-item]')); }
  function save() {
    clearTimeout(saveT); saveT = setTimeout(function () {
      var order = items().map(function (p) { return p.getAttribute('data-arrange-item'); }).join(',');
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, credentials: 'same-origin', body: new URLSearchParams({ order: order }) })
        .then(function () { wall.classList.add('arr-saved'); setTimeout(function () { wall.classList.remove('arr-saved'); }, 900); }).catch(function () {});
    }, 300);
  }
  function place(target, x, y) {
    if (!dragging || !target || target === dragging) return;
    var r = target.getBoundingClientRect();
    var before = (x - r.left) / r.width + (y - r.top) / r.height < 1;
    if (before) wall.insertBefore(dragging, target); else wall.insertBefore(dragging, target.nextSibling);
  }
  wall.addEventListener('dragstart', function (e) { var p = e.target.closest('[data-arrange-item]'); if (!p) return; dragging = p; p.classList.add('arr-lift'); try { e.dataTransfer.setData('text/plain', p.getAttribute('data-arrange-item')); e.dataTransfer.effectAllowed = 'move'; } catch (x) {} });
  wall.addEventListener('dragend', function () { if (dragging) dragging.classList.remove('arr-lift'); dragging = null; });
  wall.addEventListener('dragover', function (e) { if (!dragging) return; e.preventDefault(); place(e.target.closest('[data-arrange-item]'), e.clientX, e.clientY); });
  wall.addEventListener('drop', function (e) { e.preventDefault(); save(); });
  // A phone: press the grip, move, let go.
  var tp = null;
  wall.addEventListener('touchstart', function (e) { var g = e.target.closest('[data-arrange-grip]'); if (!g) return; tp = g.closest('[data-arrange-item]'); dragging = tp; tp.classList.add('arr-lift'); }, { passive: true });
  wall.addEventListener('touchmove', function (e) { if (!tp) return; e.preventDefault(); var t = e.touches[0], el = document.elementFromPoint(t.clientX, t.clientY); place(el && el.closest('[data-arrange-item]'), t.clientX, t.clientY); }, { passive: false });
  wall.addEventListener('touchend', function () { if (!tp) return; tp.classList.remove('arr-lift'); tp = null; dragging = null; save(); });
  // A keyboard: the grip focused, ← → move it.
  wall.addEventListener('keydown', function (e) { var g = e.target.closest && e.target.closest('[data-arrange-grip]'); if (!g) return; var p = g.closest('[data-arrange-item]'); if (e.key === 'ArrowLeft' && p.previousElementSibling) { wall.insertBefore(p, p.previousElementSibling); g.focus(); save(); e.preventDefault(); } if (e.key === 'ArrowRight' && p.nextElementSibling) { wall.insertBefore(p.nextElementSibling, p); g.focus(); save(); e.preventDefault(); } });
})();
