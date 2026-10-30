// The contact sheet: a loupe on a computer, a tap blows a frame up, arrows / swipe / keys walk the roll,
// a double-tap or a double-click looks closer, and the maker circles another frame.
(function () {
  var S = window.__WM_SHEET; var root = document.querySelector('[data-ctc]'); if (!S || !root) return;
  var F = S.frames, v = root.querySelector('[data-ctc-v]'), img = root.querySelector('[data-ctc-img]'), stage = root.querySelector('[data-ctc-stage]');
  var no = root.querySelector('[data-ctc-no]'), tt = root.querySelector('[data-ctc-t]'), act = root.querySelector('[data-ctc-act]'), strip = root.querySelector('[data-ctc-strip]');
  var at = -1, z = 1, px = 0, py = 0;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function apply() { img.style.transform = 'translate(' + px + 'px,' + py + 'px) scale(' + z + ')'; v.classList.toggle('ctc-zoomed', z > 1); }
  function reset() { z = 1; px = 0; py = 0; apply(); }
  strip.innerHTML = F.map(function (f, i) { return '<button type="button" data-ctc-go="' + i + '"' + (f.pick ? ' class="pk"' : '') + ' aria-label="Frame ' + f.n + '"><img src="' + esc(f.thumb) + '" alt="" loading="lazy"></button>'; }).join('');
  function show(i) {
    i = (i + F.length) % F.length; at = i; var f = F[i]; reset();
    img.src = f.img; img.classList.toggle('ctc-washed', !f.open);
    no.textContent = 'Frame ' + f.n + (f.pick ? ' · circled' : '') + (f.at ? ' · ' + f.at : '');
    tt.textContent = f.title || (f.open ? (f.out ? 'An outtake, kept in the archive' : '') : 'Held back by the photographer · kept in the archive');
    var a = [];
    if (f.href) a.push('<a href="' + esc(f.href) + '">The photograph</a>', '<a href="/wander?at=' + esc(f.slug) + '">Wander from here</a>');
    if (S.mine && f.on && !f.pick && f.wslug) a.push('<button type="button" data-ctc-pick="' + esc(f.wslug) + '">Circle this one</button>');
    act.innerHTML = a.join('');
    [].forEach.call(strip.children, function (b, k) { b.setAttribute('aria-current', k === i ? 'true' : 'false'); if (k === i && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'center' }); });
    var n = F[(i + 1) % F.length]; if (n && n.open) { var p = new Image(); p.src = n.img; }
    try { history.replaceState(null, '', location.pathname + location.search.replace(/([?&])f=\d+&?/, '$1').replace(/[?&]$/, '') + '#f' + f.n); } catch (e) { /* the address */ }
  }
  function open(i) { v.hidden = false; document.documentElement.classList.add('ctc-on'); show(i); }
  function close() { v.hidden = true; document.documentElement.classList.remove('ctc-on'); at = -1; img.removeAttribute('src'); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* */ } }
  root.addEventListener('click', function (e) {
    var o = e.target.closest('[data-ctc-open]'); if (o) { open(+o.getAttribute('data-ctc-open')); return; }
    var g = e.target.closest('[data-ctc-go]'); if (g) { show(+g.getAttribute('data-ctc-go')); return; }
    if (e.target.closest('[data-ctc-close]')) return close();
    if (e.target.closest('[data-ctc-prev]')) return show(at - 1);
    if (e.target.closest('[data-ctc-next]')) return show(at + 1);
    var pk = e.target.closest('[data-ctc-pick]'); if (pk) {
      pk.disabled = true; fetch('/sheet/' + encodeURIComponent(pk.getAttribute('data-ctc-pick')) + '/pick', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'json=1', credentials: 'same-origin' })
        .then(function (r) { return r.json(); }).then(function (j) { if (j && j.href) location.href = j.href; else pk.disabled = false; }).catch(function () { pk.disabled = false; });
      return;
    }
    var sb = e.target.closest('[data-ctc-silver]'); if (sb) { var on = root.classList.toggle('ctc-silver'); sb.setAttribute('aria-pressed', on ? 'true' : 'false'); try { localStorage.setItem('wm_ctc_silver', on ? '1' : ''); } catch (er) { /* */ } }
  });
  try { if (localStorage.getItem('wm_ctc_silver')) { root.classList.add('ctc-silver'); var sb0 = root.querySelector('[data-ctc-silver]'); if (sb0) sb0.setAttribute('aria-pressed', 'true'); } } catch (e) { /* */ }
  document.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input,textarea')) return;
    if (at < 0) { if (e.key === 'Enter' && document.activeElement && document.activeElement.hasAttribute('data-ctc-open')) return; return; }
    if (e.key === 'Escape') { if (z > 1) reset(); else close(); }
    else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === ' ') { e.preventDefault(); show(at + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'h') { e.preventDefault(); show(at - 1); }
    else if (e.key === '+' || e.key === '=') { z = Math.min(5, z * 1.5); apply(); }
    else if (e.key === '-') { z = Math.max(1, z / 1.5); if (z === 1) reset(); else apply(); }
  });
  // Look closer: a double-click or double-tap zooms in at that spot; a drag moves around; the wheel zooms.
  function zoomAt(cx, cy, to) { var r = stage.getBoundingClientRect(); var ox = cx - r.left - r.width / 2, oy = cy - r.top - r.height / 2; var k = to / z; px = ox - (ox - px) * k; py = oy - (oy - py) * k; z = to; if (z <= 1.01) reset(); else apply(); }
  stage.addEventListener('dblclick', function (e) { if (!F[at] || !F[at].open) return; zoomAt(e.clientX, e.clientY, z > 1 ? 1 : 2.5); });
  stage.addEventListener('wheel', function (e) { if (at < 0 || !F[at].open) return; e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.max(1, Math.min(5, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); }, { passive: false });
  var drag = null, tap = 0, pinch = null, sw = null;
  stage.addEventListener('pointerdown', function (e) { if (e.pointerType === 'touch') return; if (z > 1) { drag = { x: e.clientX - px, y: e.clientY - py }; stage.setPointerCapture(e.pointerId); } });
  stage.addEventListener('pointermove', function (e) { if (drag) { px = e.clientX - drag.x; py = e.clientY - drag.y; apply(); } });
  stage.addEventListener('pointerup', function () { drag = null; });
  stage.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) { var a = e.touches[0], b = e.touches[1]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: z }; sw = null; return; }
    var t = e.touches[0]; sw = { x: t.clientX, y: t.clientY, px: px, py: py, at: Date.now() };
  }, { passive: true });
  stage.addEventListener('touchmove', function (e) {
    if (pinch && e.touches.length === 2) { e.preventDefault(); var a = e.touches[0], b = e.touches[1]; var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); zoomAt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, Math.max(1, Math.min(5, pinch.z * d / pinch.d))); return; }
    if (sw && z > 1) { e.preventDefault(); var t = e.touches[0]; px = sw.px + t.clientX - sw.x; py = sw.py + t.clientY - sw.y; apply(); }
  }, { passive: false });
  stage.addEventListener('touchend', function (e) {
    if (pinch) { if (e.touches.length < 2) pinch = null; return; }
    if (!sw) return; var t = e.changedTouches[0]; var dx = t.clientX - sw.x, dy = t.clientY - sw.y;
    if (z === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { show(at + (dx < 0 ? 1 : -1)); sw = null; return; }
    if (z === 1 && dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.3) { close(); sw = null; return; }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) { var now = Date.now(); if (now - tap < 300 && F[at] && F[at].open) { zoomAt(t.clientX, t.clientY, z > 1 ? 1 : 2.5); tap = 0; } else tap = now; }
    sw = null;
  });
  // The loupe: on a computer, a round glass rides the cursor over the sheet, the frame under it three times larger.
  var loupe = root.querySelector('[data-ctc-loupe]'), lin = loupe && loupe.firstElementChild, fine = window.matchMedia && matchMedia('(pointer:fine)').matches, cur = null;
  if (loupe && fine) {
    var film = root.querySelector('.ctc-film'); var Z = 3.2, R = 95;
    film.addEventListener('mousemove', function (e) {
      var li = e.target.closest('.ctc-f'); if (!li || li.classList.contains('ctc-held')) { loupe.hidden = true; cur = null; return; }
      var r = li.getBoundingClientRect();
      if (cur !== li) { cur = li; lin.innerHTML = ''; var c = li.cloneNode(true); c.removeAttribute('data-i'); [].forEach.call(c.querySelectorAll('svg,.ctc-no,.ctc-ed'), function (n) { n.remove(); }); c.className += ' ctc-lc'; c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; lin.appendChild(c); var im = c.querySelector('img'); var big = F[+li.getAttribute('data-i')]; if (im && big) im.src = big.img.replace('/large', '/screen'); }
      loupe.hidden = false; loupe.style.transform = 'translate(' + (e.clientX - R) + 'px,' + (e.clientY - R) + 'px)';
      var x = e.clientX - r.left, y = e.clientY - r.top; lin.firstChild.style.transform = 'translate(' + (R - x * Z) + 'px,' + (R - y * Z) + 'px) scale(' + Z + ')';
    });
    film.addEventListener('mouseleave', function () { loupe.hidden = true; cur = null; });
  }
  var m = location.hash.match(/^#f(\d+)$/); if (m) { var k = F.findIndex(function (f) { return f.n === +m[1]; }); if (k >= 0) open(k); }
})();
