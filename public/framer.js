// The framer (4 Nov): a frame laid over the whole picture, moved by a drag, sized by its corners, shaped by the chips.
// The frame is kept in fractions of the picture, so it means the same on any screen and against the original.
(function () {
  var root = document.querySelector('[data-fz]'); if (!root) return;
  var img = root.querySelector('[data-fz-img]'), box = root.querySelector('[data-fz-box]'), form = root.querySelector('[data-fz-form]');
  var W = +root.dataset.w || 0, H = +root.dataset.h || 0;
  var f = { x: 0.3, y: 0.25, w: 0.4, h: 0.5 }; // in fractions of the picture
  var ar = 0.8; // width / height of the frame on the picture, by its own pixels; 0 = free
  // The picture as drawn: the element may be larger than the picture inside it (contain, or held to its true size).
  function rect() {
    var b = img.getBoundingClientRect(), nw = img.naturalWidth || W || 1, nh = img.naturalHeight || H || 1;
    var s = Math.min(b.width / nw, b.height / nh); var cs = getComputedStyle(img);
    if (cs.objectFit !== 'contain' && cs.objectFit !== 'scale-down') return b;
    var w = nw * s, h = nh * s; return { left: b.left + (b.width - w) / 2, top: b.top + (b.height - h) / 2, width: w, height: h };
  }
  function picAr() { var r = rect(); return r.width / (r.height || 1); }
  // Keep the frame inside the picture and true to its shape.
  function fit(anchor) {
    f.w = Math.max(0.04, Math.min(1, f.w)); f.h = Math.max(0.04, Math.min(1, f.h));
    if (ar) { var k = ar / picAr(); // fraction-width per fraction-height for this shape
      if (anchor === 'w') f.h = f.w / k; else f.w = f.h * k;
      if (f.w > 1) { f.w = 1; f.h = f.w / k; } if (f.h > 1) { f.h = 1; f.w = f.h * k; } }
    f.x = Math.max(0, Math.min(1 - f.w, f.x)); f.y = Math.max(0, Math.min(1 - f.h, f.y));
  }
  function draw() {
    var r = rect(), s = root.querySelector('[data-fz-stage]').getBoundingClientRect();
    box.hidden = false;
    box.style.left = (r.left - s.left + f.x * r.width) + 'px'; box.style.top = (r.top - s.top + f.y * r.height) + 'px';
    box.style.width = (f.w * r.width) + 'px'; box.style.height = (f.h * r.height) + 'px';
    ['x', 'y', 'w', 'h'].forEach(function (k) { form.querySelector('input[name=' + k + ']').value = f[k].toFixed(5); });
    var say = root.querySelector('.fz-say'); if (say && W && H) { var px = Math.round(Math.min(f.w * W, f.h * H)); say.textContent = px < 240 ? 'Too small to hold up on a wall: make the frame a little larger.' : 'Move the frame to the part you love. Its corners size it.'; }
  }
  var drag = null;
  function pt(e) { var t = e.touches ? e.touches[0] : e; return { x: t.clientX, y: t.clientY }; }
  function down(e) {
    var c = e.target.getAttribute && e.target.getAttribute('data-c'); if (!c && !box.contains(e.target)) return;
    e.preventDefault(); var p = pt(e); drag = { c: c || 'move', p: p, f: { x: f.x, y: f.y, w: f.w, h: f.h } };
  }
  function move(e) {
    if (!drag) return; e.preventDefault(); var p = pt(e), r = rect();
    var dx = (p.x - drag.p.x) / r.width, dy = (p.y - drag.p.y) / r.height, o = drag.f;
    if (drag.c === 'move') { f.x = o.x + dx; f.y = o.y + dy; fit(); }
    else {
      var e2 = drag.c.indexOf('e') >= 0, s2 = drag.c.indexOf('s') >= 0;
      var nw = e2 ? o.w + dx : o.w - dx, nh = s2 ? o.h + dy : o.h - dy;
      f.w = nw; f.h = nh; fit(Math.abs(dx) > Math.abs(dy) ? 'w' : 'h');
      f.x = e2 ? o.x : o.x + o.w - f.w; f.y = s2 ? o.y : o.y + o.h - f.h; fit();
    }
    draw();
  }
  function up() { drag = null; }
  box.addEventListener('mousedown', down); box.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move); window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up); window.addEventListener('touchend', up);
  // A tap on the picture moves the frame there.
  img.addEventListener('click', function (e) { var r = rect(); if (e.clientX < r.left || e.clientX > r.left + r.width || e.clientY < r.top || e.clientY > r.top + r.height) return; f.x = (e.clientX - r.left) / r.width - f.w / 2; f.y = (e.clientY - r.top) / r.height - f.h / 2; fit(); draw(); });
  root.querySelectorAll('[data-ar]').forEach(function (b) {
    b.addEventListener('click', function () {
      root.querySelectorAll('[data-ar]').forEach(function (x) { x.removeAttribute('aria-pressed'); }); b.setAttribute('aria-pressed', 'true');
      ar = b.dataset.ar === 'free' ? 0 : +b.dataset.ar; var cx = f.x + f.w / 2, cy = f.y + f.h / 2; fit('h'); f.x = cx - f.w / 2; f.y = cy - f.h / 2; fit(); draw();
    });
  });
  function start() { fit('h'); draw(); }
  if (img.complete && img.naturalWidth) start(); else img.addEventListener('load', start);
  window.addEventListener('resize', draw);
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') return; var s = e.shiftKey ? 0.05 : 0.01;
    if (e.key === 'ArrowLeft') f.x -= s; else if (e.key === 'ArrowRight') f.x += s; else if (e.key === 'ArrowUp') f.y -= s; else if (e.key === 'ArrowDown') f.y += s; else if (e.key === 'Escape') { location.href = root.querySelector('.fz-x').href; return; } else return;
    e.preventDefault(); fit(); draw();
  });
})();
