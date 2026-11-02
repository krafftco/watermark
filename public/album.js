// The album (2 Nov, after Pic-Time): hearts on every photograph, the favourites shown alone and downloaded as one,
// and the album played as a film: two pictures cross-fading, five seconds each, quiet music made in the browser.
(function () {
  var D = window.__DV; if (!D) return;
  var root = document.querySelector('main.dv'); if (!root) return;
  var countEl = document.querySelector('[data-dvh-count]'), dl = document.querySelector('[data-dvh-dl]'), none = document.querySelector('[data-dvh-none]');
  var filterBtn = document.querySelector('[data-dvh-filter]'), only = false;
  function paintFilter() {
    var shown = 0;
    document.querySelectorAll('.dv-grid .dv-w[data-dv-slug]').forEach(function (f) { var on = f.hasAttribute('data-hearted'); f.hidden = only && !on; if (!f.hidden) shown++; });
    document.querySelectorAll('.dvs').forEach(function (s) { s.hidden = only && !s.querySelector('.dv-w:not([hidden])'); });
    var nav = document.querySelector('.dvs-nav'); if (nav) nav.hidden = only;
    if (none) none.hidden = !(only && shown === 0);
    if (filterBtn) filterBtn.setAttribute('aria-pressed', String(only));
  }
  if (filterBtn) filterBtn.addEventListener('click', function () { only = !only; paintFilter(); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-dvh]'); if (!b) return; e.preventDefault();
    var slug = b.getAttribute('data-dvh'), fig = b.closest('.dv-w'), was = fig.hasAttribute('data-hearted');
    // Every copy of this photograph on the page (the grid and the open view) is set together.
    function mark(on) { document.querySelectorAll('.dv-w[data-dv-slug="' + slug + '"]').forEach(function (f) { f.toggleAttribute('data-hearted', on); var hb = f.querySelector('[data-dvh]'); if (hb) hb.setAttribute('aria-pressed', String(on)); }); }
    // Shown at once; set right by the house's answer.
    mark(!was); b.classList.add('dvh-pop'); setTimeout(function () { b.classList.remove('dvh-pop'); }, 400);
    if (!was && navigator.vibrate) navigator.vibrate(8);
    fetch(D.base + '/' + encodeURIComponent(slug) + '/heart', { method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) return; mark(j.on);
        if (countEl) countEl.textContent = j.n; if (dl) dl.hidden = !j.n; if (only) paintFilter();
      }).catch(function () { mark(was); });
  });
  // A photograph's own acts (Share, More) open their panel in place; the album's Download opens its sheet.
  document.addEventListener('click', function (e) {
    var x = e.target.closest('[data-dvx]');
    if (x) { var cap = x.closest('figcaption'), k = x.getAttribute('data-dvx'); cap.querySelectorAll('[data-dvx-p]').forEach(function (p) { p.hidden = p.getAttribute('data-dvx-p') !== k || !p.hidden; }); cap.querySelectorAll('[data-dvx]').forEach(function (y) { var p = cap.querySelector('[data-dvx-p="' + y.getAttribute('data-dvx') + '"]'); y.setAttribute('aria-expanded', String(!!p && !p.hidden)); }); return; }
    var t = e.target.closest('[data-dvt]');
    if (t) { var sh = document.querySelector('[data-dvt-p="' + t.getAttribute('data-dvt') + '"]'); if (sh) { sh.hidden = !sh.hidden; t.setAttribute('aria-expanded', String(!sh.hidden)); } return; }
    var open = document.querySelector('[data-dvt-p]:not([hidden])'); if (open && !e.target.closest('[data-dvt-p]')) { open.hidden = true; }
  });
  // The photograph's view (2 Nov, after Pic-Time): a tap on the grid opens one photograph large on the dark, with its
  // acts beneath (the figcaption's own, so every handler on the page works there too); arrows, a swipe, Esc, Back.
  var O = document.createElement('div'); O.className = 'dvo'; O.hidden = true; O.setAttribute('role', 'dialog'); O.setAttribute('aria-label', 'Photograph');
  O.innerHTML = '<button type="button" class="dvo-x" data-dvo-x aria-label="Close">\u00d7</button><button type="button" class="dvo-p" data-dvo-go="-1" aria-label="Before">\u2039</button><button type="button" class="dvo-n" data-dvo-go="1" aria-label="Next">\u203a</button><div class="dvo-in"><figure class="dv-w dvo-f"><div class="dvo-im"><img alt=""></div></figure><p class="dvo-c" data-dvo-c></p></div>';
  root.appendChild(O);
  var oi = -1, olist = [], ofig = O.querySelector('.dvo-f'), oimg = ofig.querySelector('img'), ocount = O.querySelector('[data-dvo-c]'), opened = false;
  function grid() { return [].slice.call(document.querySelectorAll('.dv-grid .dv-w[data-dv-slug]')).filter(function (f) { return !f.hidden; }); }
  function oshow(k) {
    if (!olist.length) return; oi = (k + olist.length) % olist.length; var g = olist[oi], slug = g.getAttribute('data-dv-slug');
    ofig.setAttribute('data-dv-slug', slug); ofig.toggleAttribute('data-hearted', g.hasAttribute('data-hearted'));
    [].slice.call(ofig.children).forEach(function (c) { if (!c.classList.contains('dvo-im')) c.remove(); });
    oimg.src = '/img/' + encodeURIComponent(slug) + '/large'; oimg.alt = (g.querySelector('img') || {}).alt || '';
    var hb = g.querySelector('[data-dvh]'); if (hb) ofig.appendChild(hb.cloneNode(true));
    var cap = g.querySelector('figcaption'); if (cap) { var c2 = cap.cloneNode(true); c2.querySelectorAll('[data-dvx-p]').forEach(function (p) { p.hidden = true; }); ofig.appendChild(c2); }
    ocount.textContent = (oi + 1) + ' of ' + olist.length;
    [1, -1].forEach(function (s) { var n = olist[(oi + s + olist.length) % olist.length]; if (n) { var im = new Image(); im.src = '/img/' + encodeURIComponent(n.getAttribute('data-dv-slug')) + '/large'; } });
    var tag = document.querySelector('[data-dv-tag]'); if (tag && O.contains(tag)) tag.hidden = true;
  }
  function oopen(fig) { olist = grid(); var k = olist.indexOf(fig); if (k < 0) return; O.hidden = false; document.documentElement.classList.add('dvo-on'); if (!opened) { opened = true; try { history.pushState({ dvo: 1 }, ''); } catch (e) { /* */ } } oshow(k); }
  function oclose(fromPop) { if (O.hidden) return; O.hidden = true; document.documentElement.classList.remove('dvo-on'); var tag = document.querySelector('[data-dv-tag]'); if (tag && O.contains(tag)) { tag.hidden = true; root.appendChild(tag); } if (opened && !fromPop) { opened = false; try { history.back(); } catch (e) { /* */ } } opened = false; }
  window.addEventListener('popstate', function () { if (!O.hidden) { opened = false; oclose(true); } });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-dvo]'); if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); oopen(a.closest('.dv-w')); return; }
    if (e.target.closest('[data-dvo-x]') || e.target === O) { oclose(); return; }
    var go = e.target.closest('[data-dvo-go]'); if (go) { oshow(oi + Number(go.getAttribute('data-dvo-go'))); return; }
    if (O.contains(e.target) && e.target.closest('[data-dv-keep]')) setTimeout(function () { oclose(); }, 0); // the keep form lives on the page
  });
  document.addEventListener('keydown', function (e) { if (O.hidden || /input|textarea/i.test((e.target || {}).tagName || '')) return; if (e.key === 'Escape') oclose(); else if (e.key === 'ArrowRight') oshow(oi + 1); else if (e.key === 'ArrowLeft') oshow(oi - 1); });
  var ox = null, oy = null; O.addEventListener('touchstart', function (e) { if (e.touches.length !== 1) { ox = null; return; } ox = e.touches[0].clientX; oy = e.touches[0].clientY; }, { passive: true });
  O.addEventListener('touchend', function (e) { if (ox == null) return; var dx = e.changedTouches[0].clientX - ox, dy = e.changedTouches[0].clientY - oy; ox = null; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4 && e.target.closest('.dvo-im')) oshow(oi + (dx < 0 ? 1 : -1)); else if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.6 && e.target.closest('.dvo-im')) oclose(); }, { passive: true });
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
    if (only) { var h = []; document.querySelectorAll('.dv-grid .dv-w[data-hearted]').forEach(function (f) { var s = f.getAttribute('data-dv-slug'); list.forEach(function (x) { if (x.s === s) h.push(x); }); }); list = h.length ? h : D.list; } else list = D.list;
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
