// The album (2 Nov, after Pic-Time): hearts on every photograph, the favourites shown alone and downloaded as one,
// and the album played as a film: two pictures cross-fading, five seconds each, quiet music made in the browser.
(function () {
  var D = window.__DV; if (!D) return;
  var root = document.querySelector('main.dv'); if (!root) return;
  var countEl = document.querySelector('[data-dvh-count]'), dl = document.querySelector('[data-dvh-dl]'), none = document.querySelector('[data-dvh-none]');
  var filterBtn = document.querySelector('[data-dvh-filter]'), only = false;
  function paintFilter() {
    var shown = 0;
    document.querySelectorAll('.dv-w[data-dv-slug]').forEach(function (f) { var on = f.hasAttribute('data-hearted'); f.hidden = only && !on; if (!f.hidden) shown++; });
    document.querySelectorAll('.dvs').forEach(function (s) { s.hidden = only && !s.querySelector('.dv-w:not([hidden])'); });
    var nav = document.querySelector('.dvs-nav'); if (nav) nav.hidden = only;
    if (none) none.hidden = !(only && shown === 0);
    if (filterBtn) filterBtn.setAttribute('aria-pressed', String(only));
  }
  if (filterBtn) filterBtn.addEventListener('click', function () { only = !only; paintFilter(); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-dvh]'); if (!b) return; e.preventDefault();
    var slug = b.getAttribute('data-dvh'), fig = b.closest('.dv-w'), was = fig.hasAttribute('data-hearted');
    // Shown at once; set right by the house's answer.
    fig.toggleAttribute('data-hearted', !was); b.setAttribute('aria-pressed', String(!was)); b.classList.add('dvh-pop'); setTimeout(function () { b.classList.remove('dvh-pop'); }, 400);
    if (!was && navigator.vibrate) navigator.vibrate(8);
    fetch(D.base + '/' + encodeURIComponent(slug) + '/heart', { method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) return; fig.toggleAttribute('data-hearted', j.on); b.setAttribute('aria-pressed', String(j.on));
        if (countEl) countEl.textContent = j.n; if (dl) dl.hidden = !j.n; if (only) paintFilter();
      }).catch(function () { fig.toggleAttribute('data-hearted', was); b.setAttribute('aria-pressed', String(was)); });
  });
  // The film.
  var P = document.querySelector('[data-dvp]'); if (!P) return;
  var A = P.querySelector('.dvp-a'), B = P.querySelector('.dvp-b'), cap = P.querySelector('[data-dvp-cap]'), front = A, i = 0, timer = null, paused = false, list = D.list, lock = null;
  var EACH = 5200;
  function src(k) { return '/img/' + encodeURIComponent(list[k].s) + '/large'; }
  function show(k) {
    i = (k + list.length) % list.length; var back = front === A ? B : A, it = list[i];
    var im = new Image(); im.onload = im.onerror = function () { back.src = im.src; back.classList.add('on'); front.classList.remove('on'); front = back; cap.textContent = it.t + (it.p ? ' · ' + it.p : '') + '  ' + (i + 1) + ' / ' + list.length; var nx = new Image(); nx.src = src((i + 1) % list.length); };
    im.src = src(i);
    clearTimeout(timer); if (!paused) timer = setTimeout(function () { show(i + 1); }, EACH);
  }
  function start(at) {
    if (only) { var h = []; document.querySelectorAll('.dv-w[data-hearted]').forEach(function (f) { var s = f.getAttribute('data-dv-slug'); list.forEach(function (x) { if (x.s === s) h.push(x); }); }); list = h.length ? h : D.list; } else list = D.list;
    P.hidden = false; document.documentElement.classList.add('dvp-on'); paused = false; pauseBtn.setAttribute('aria-label', 'Pause');
    try { if (P.requestFullscreen) P.requestFullscreen().catch(function () {}); } catch (e) { /* */ }
    try { navigator.wakeLock && navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {}); } catch (e) { /* */ }
    show(at || 0);
  }
  function stop() { clearTimeout(timer); P.hidden = true; document.documentElement.classList.remove('dvp-on'); music(false); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* */ } try { lock && lock.release(); } catch (e) { /* */ } lock = null; }
  var pauseBtn = P.querySelector('[data-dvp-pause]');
  document.querySelectorAll('[data-dvp-open]').forEach(function (b) { b.addEventListener('click', function () { start(0); }); });
  P.querySelector('[data-dvp-x]').addEventListener('click', stop);
  P.querySelector('[data-dvp-next]').addEventListener('click', function () { show(i + 1); });
  P.querySelector('[data-dvp-prev]').addEventListener('click', function () { show(i - 1); });
  pauseBtn.addEventListener('click', function () { paused = !paused; pauseBtn.classList.toggle('on', paused); if (paused) clearTimeout(timer); else show(i + 1); });
  document.addEventListener('keydown', function (e) {
    if (P.hidden) return;
    if (e.key === 'Escape') stop(); else if (e.key === 'ArrowRight') show(i + 1); else if (e.key === 'ArrowLeft') show(i - 1); else if (e.key === ' ') { e.preventDefault(); pauseBtn.click(); }
  });
  var tx = null; P.addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; }, { passive: true });
  P.addEventListener('touchend', function (e) { if (tx == null) return; var dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1)); }, { passive: true });
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && !P.hidden && P.requestFullscreen) { /* left by the system: stay open on the page */ } });
  // Quiet music: four sines breathing, made here, nothing streamed and nothing to license.
  var ctx = null, nodes = [], mBtn = P.querySelector('[data-dvp-music]');
  function music(on) {
    if (!on) { nodes.forEach(function (n) { try { n.stop(); } catch (e) { /* */ } }); nodes = []; if (mBtn) mBtn.setAttribute('aria-pressed', 'false'); return; }
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume && ctx.resume(); } catch (e) { return; }
    var out = ctx.createGain(); out.gain.value = 0.0001; out.connect(ctx.destination); out.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 3);
    [196, 246.94, 293.66, 392].forEach(function (f, k) {
      var o = ctx.createOscillator(), g = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.25; l.frequency.value = 0.05 + k * 0.023; lg.gain.value = 0.22;
      l.connect(lg); lg.connect(g.gain); o.connect(g); g.connect(out); o.start(); l.start(); nodes.push(o, l);
    });
    if (mBtn) mBtn.setAttribute('aria-pressed', 'true');
  }
  if (mBtn) mBtn.addEventListener('click', function () { music(mBtn.getAttribute('aria-pressed') !== 'true'); });
})();
