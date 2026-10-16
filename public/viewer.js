// Watermark viewer: full screen, real zoom, protected. Honour, not locks.
(function () {
  var plate = document.querySelector('[data-viewer]');
  if (!plate) return;
  var box = document.createElement('div');
  box.className = 'wv';
  box.innerHTML = '<div class="wv-bar"><span class="wv-t"></span><span><button type="button" data-z="out">&minus;</button> <button type="button" data-z="in">+</button> <button type="button" data-close>Close</button></span></div>';
  var img = new Image(); img.alt = ''; img.draggable = false; box.appendChild(img);
  document.body.appendChild(box);
  box.querySelector('.wv-t').textContent = plate.dataset.title + ' · ' + plate.dataset.credit;
  var s = 1, fit = 1, x = 0, y = 0, idle;
  function apply() { img.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')'; }
  function center() {
    var W = innerWidth, H = innerHeight, w = img.naturalWidth || 1, h = img.naturalHeight || 1;
    fit = Math.min(W / w, H / h); s = fit; x = -w * s / 2; y = -h * s / 2; apply();
  }
  function zoomAt(f, cx, cy) {
    var ns = Math.max(fit, Math.min(fit * 8, s * f));
    var ox = cx - innerWidth / 2, oy = cy - innerHeight / 2;
    x = ox - (ox - x) * (ns / s); y = oy - (oy - y) * (ns / s); s = ns; apply();
  }
  function wake() { box.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(function () { box.classList.add('idle'); }, 2200); }
  function open() {
    if (!img.src) img.src = plate.dataset.full;
    box.classList.add('on'); document.documentElement.style.overflow = 'hidden';
    if (img.complete) center(); else img.onload = center;
    if (box.requestFullscreen && matchMedia('(pointer:fine)').matches) box.requestFullscreen().catch(function () {});
    wake();
  }
  function close() { box.classList.remove('on'); document.documentElement.style.overflow = ''; if (document.fullscreenElement) document.exitFullscreen().catch(function () {}); }
  plate.addEventListener('click', open);
  box.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); wake(); }, { passive: false });
  box.addEventListener('dblclick', function (e) { zoomAt(s > fit * 1.5 ? fit / s : 2.5, e.clientX, e.clientY); });
  var drag = null, pts = {}, pinch = null;
  box.addEventListener('pointerdown', function (e) { if (e.target.closest('button')) return; pts[e.pointerId] = e; box.setPointerCapture(e.pointerId); drag = { x: e.clientX - x, y: e.clientY - y }; wake(); });
  box.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId]) return; pts[e.pointerId] = e;
    var ids = Object.keys(pts);
    if (ids.length === 2) {
      var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch) zoomAt(d / pinch, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      pinch = d; return;
    }
    if (drag && s > fit) { x = e.clientX - drag.x; y = e.clientY - drag.y; apply(); }
  });
  function up(e) { delete pts[e.pointerId]; pinch = null; drag = null; }
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-close')) close(); else zoomAt(b.dataset.z === 'in' ? 1.4 : 1 / 1.4, innerWidth / 2, innerHeight / 2);
  });
  document.addEventListener('keydown', function (e) {
    if (!box.classList.contains('on')) return;
    if (e.key === 'Escape') close();
    if (e.key === '+' || e.key === '=') zoomAt(1.4, innerWidth / 2, innerHeight / 2);
    if (e.key === '-') zoomAt(1 / 1.4, innerWidth / 2, innerHeight / 2);
    if (e.key === '0') center();
  });
  addEventListener('resize', function () { if (box.classList.contains('on')) center(); });
  // Courtesy protection: the original never reaches the browser; these stop casual saving of the screen copy.
  document.addEventListener('contextmenu', function (e) { if (e.target.closest('.plate,.wv,.cf,.lic-fig')) e.preventDefault(); });
  document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && /^[sp]$/i.test(e.key)) e.preventDefault(); });
})();
