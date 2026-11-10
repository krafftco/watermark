// The volume: pages bound again, turned one at a time (two abreast on a wide screen).
(function () {
  var root = document.querySelector('[data-vlm]'), D = window.__VLM; if (!root || !D) return;
  var P = D.pages, N = P.length, i = Math.min(N, Math.max(1, +root.dataset.at || 1)) - 1;
  var $ = function (s) { return root.querySelector(s); };
  var L = $('[data-vlm-l]'), R = $('[data-vlm-r]'), cap = $('[data-vlm-cap]'), num = $('[data-vlm-n]'), thumbs = $('[data-vlm-thumbs]'), stage = $('[data-vlm-stage]');
  var study = $('[data-vlm-study]'), rec = $('[data-vlm-rec]'), note = $('[data-vlm-note]');
  var wide = function () { return innerWidth >= 900 && innerWidth > innerHeight * 1.15; };
  var src = function (p) { return '/img/' + p.s + '/large'; };
  var warm = {}; function ready(k) { if (k < 0 || k >= N || warm[k]) return; var im = new Image(); im.decoding = 'async'; im.src = src(P[k]); warm[k] = im; }
  // A page is shown whole or not at all: the picture is decoded first, then set.
  function set(img, p) {
    if (!p) { img.hidden = true; img.removeAttribute('src'); return; }
    img.hidden = false; var u = src(p); if (img.getAttribute('src') === u) return;
    img.classList.remove('ld'); var pre = new Image(); pre.src = u;
    var go = function () { if (img.dataset.want !== u) return; img.src = u; };
    img.dataset.want = u; (pre.decode ? pre.decode().then(go, go) : (pre.onload = go));
  }
  function pair() { if (!wide() || i === 0) return [i, -1]; var a = i % 2 ? i : i - 1; return [a, a + 1 < N ? a + 1 : -1]; }
  function show(push) {
    var pr = pair(), a = P[pr[0]], b = pr[1] >= 0 ? P[pr[1]] : null;
    root.classList.toggle('vlm-two', !!b); set(L, a); set(R, b);
    var cur = P[i]; num.textContent = (b ? (pr[0] + 1) + '–' + (pr[1] + 1) : (i + 1)) + ' of ' + N;
    cap.textContent = cur.t;
    study.href = '/easel/' + cur.s + '?back=' + encodeURIComponent('/volume/' + D.slug + '?p=' + (i + 1));
    rec.href = '/w/' + cur.s; note.setAttribute('data-note', cur.s);
    [].forEach.call(thumbs.children, function (t, k) { var on = k === pr[0] || k === pr[1]; t.classList.toggle('on', on); if (k === i && t.scrollIntoView) { try { t.scrollIntoView({ inline: 'center', block: 'nearest', behavior: push ? 'smooth' : 'auto' }); } catch (e) { } } });
    $('[data-vlm-prev]').disabled = pr[0] === 0; $('[data-vlm-next]').disabled = (pr[1] >= 0 ? pr[1] : pr[0]) >= N - 1;
    try { history.replaceState(null, '', '/volume/' + D.slug + (i ? '?p=' + (i + 1) : '')); } catch (e) { }
    var last = pr[1] >= 0 ? pr[1] : pr[0]; ready(last + 1); ready(last + 2); ready(pr[0] - 1); if (wide()) { ready(last + 3); ready(pr[0] - 2); }
  }
  function turn(d) {
    var pr = pair(), last = pr[1] >= 0 ? pr[1] : pr[0], to = d > 0 ? last + 1 : pr[0] - 1;
    if (to < 0 || to >= N) { stage.classList.add('vlm-end'); setTimeout(function () { stage.classList.remove('vlm-end'); }, 300); return; }
    i = to; show(true);
  }
  $('[data-vlm-prev]').addEventListener('click', function () { turn(-1); });
  $('[data-vlm-next]').addEventListener('click', function () { turn(1); });
  thumbs.addEventListener('click', function (e) { var t = e.target.closest('[data-vlm-t]'); if (!t) return; i = +t.dataset.vlmT - 1; show(true); });
  // A tap on the left third goes back, on the right third goes on.
  $('[data-vlm-spread]').addEventListener('click', function (e) { if (moved) return; var x = e.clientX / innerWidth; if (x < .33) turn(-1); else if (x > .67) turn(1); });
  addEventListener('keydown', function (e) {
    if (/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); turn(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); turn(-1); }
    else if (e.key === 'Home') { i = 0; show(true); } else if (e.key === 'End') { i = N - 1; show(true); }
    else if (e.key === 'Escape') { var x = root.querySelector('.vlm-x'); if (x) location.href = x.href; }
  });
  // A swipe turns the page; two fingers are the browser's own zoom, left alone.
  var sx = 0, sy = 0, st = 0, one = false, moved = false;
  stage.addEventListener('touchstart', function (e) { one = e.touches.length === 1 && (!window.visualViewport || visualViewport.scale < 1.05); if (!one) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); moved = false; }, { passive: true });
  stage.addEventListener('touchend', function (e) { if (!one) return; var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - st < 900) { moved = true; turn(dx < 0 ? 1 : -1); setTimeout(function () { moved = false; }, 350); } }, { passive: true });
  var rz; addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { show(false); }, 120); });
  show(false);
})();
