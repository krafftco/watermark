// The trip, played (29 Oct). One frame at a time, crossfading, the hour on each; title cards between days; held-back
// frames as a wash of colour with their line. Space pauses, ← → step, Esc leaves. The maker gets On view | Held back.
(function () {
  var T = window.__WM_TRIP; var root = document.querySelector('[data-trp]'); if (!T || !root) return;
  var seq = T.seq, i = 0, playing = true, pace = 3500, timer = null;
  var film = root.querySelector('[data-trp-film]'), open = root.querySelector('[data-trp-open]'), stage = root.querySelector('[data-trp-stage]');
  var at = root.querySelector('[data-trp-at]'), count = root.querySelector('[data-trp-count]'), strip = root.querySelector('[data-trp-strip]');
  var play = root.querySelector('[data-trp-play]'), vis = root.querySelector('[data-trp-vis]');
  var frames = seq.filter(function (x) { return !x.card; }).length, frameNo = function (k) { var n = 0; for (var j = 0; j <= k; j++) if (!seq[j].card) n++; return n; };
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // the strip: a tick per frame, gems as dots
  seq.forEach(function (x, k) { if (x.card) return; var b = el('button', 'trp-tick' + (x.shown ? '' : ' trp-tick-held')); b.type = 'button'; b.title = x.shown ? x.title : 'Held back'; b.onclick = function () { go(k); }; b.dataset.k = k; strip.appendChild(b); });
  function src(x) { return x.open ? '/img/' + encodeURIComponent(x.slug) + '/large' : '/img/' + encodeURIComponent(x.slug) + '/held'; }
  // decode the next two ahead
  function warm(k) { for (var j = k + 1; j < Math.min(seq.length, k + 3); j++) if (!seq[j].card) { var im = new Image(); im.src = src(seq[j]); } }
  function show(k) {
    var x = seq[k]; var layer = el('div', 'trp-layer');
    if (x.card) { layer.classList.add('trp-card'); layer.appendChild(el('p', null, esc(x.card))); at.textContent = ''; }
    else {
      var img = el('img', 'trp-im' + (x.open ? '' : ' trp-im-held')); img.alt = x.shown ? x.title : ''; img.src = src(x);
      if (x.shown || T.mine) { var a = el('a', 'trp-link'); a.href = x.href; a.appendChild(img); layer.appendChild(a); } else layer.appendChild(img);
      if (!x.shown) layer.appendChild(el('p', 'trp-held', '<span class="trp-gem">◆</span> ' + (T.mine ? 'Held back by you · others see a wash of colour' : 'Held back by the photographer · kept in the archive')));
      else if (x.title) layer.appendChild(el('p', 'trp-title', esc(x.title)));
      at.textContent = x.at || '';
    }
    stage.appendChild(layer); requestAnimationFrame(function () { layer.classList.add('on'); });
    var old = stage.querySelectorAll('.trp-layer'); for (var j = 0; j < old.length - 1; j++) (function (o) { o.classList.remove('on'); setTimeout(function () { o.remove(); }, 900); })(old[j]);
    count.textContent = x.card ? '' : frameNo(k) + ' / ' + frames;
    [].forEach.call(strip.children, function (b) { b.classList.toggle('on', +b.dataset.k === k); });
    if (vis) { vis.hidden = !!x.card; if (!x.card) vis.textContent = x.shown ? 'On view · hold it back' : 'Held back · put it on view'; }
    warm(k);
  }
  function hold(k) { var x = seq[k]; return x.card ? 2200 : x.shown ? pace : Math.min(pace, 1800); }
  function tick() { clearTimeout(timer); if (!playing) return; timer = setTimeout(function () { if (i < seq.length - 1) { i++; show(i); tick(); } else { playing = false; play.textContent = '↺'; } }, hold(i)); }
  function go(k) { i = Math.max(0, Math.min(seq.length - 1, k)); show(i); tick(); }
  function begin() { open.hidden = true; film.hidden = false; if (film.requestFullscreen && matchMedia('(pointer:coarse)').matches) { try { film.requestFullscreen(); } catch (e) { /* fine */ } } go(0); }
  root.querySelector('[data-trp-go]').onclick = begin;
  play.onclick = function () { if (!playing && i >= seq.length - 1) { playing = true; play.textContent = '❚❚'; return go(0); } playing = !playing; play.textContent = playing ? '❚❚' : '▶'; tick(); };
  root.querySelector('[data-trp-prev]').onclick = function () { go(i - 1); };
  root.querySelector('[data-trp-next]').onclick = function () { go(i + 1); };
  [].forEach.call(root.querySelectorAll('[data-trp-pace]'), function (b) { b.onclick = function () { pace = +b.dataset.trpPace; [].forEach.call(root.querySelectorAll('[data-trp-pace]'), function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); }); tick(); }; });
  if (vis) vis.onclick = function () {
    var x = seq[i]; if (!x || x.card) return; var want = x.shown ? '0' : '1'; vis.disabled = true;
    fetch('/trip/work/' + encodeURIComponent(x.slug), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'show=' + want, credentials: 'same-origin' })
      .then(function (r) { return r.json(); }).then(function (j) { vis.disabled = false; if (!j.ok) { vis.textContent = j.why || 'Not now'; return; } x.shown = want === '1'; var t = strip.querySelector('[data-k="' + i + '"]'); if (t) t.classList.toggle('trp-tick-held', !x.shown); show(i); })
      .catch(function () { vis.disabled = false; });
  };
  // a swipe steps
  var sx = null; film.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
  film.addEventListener('touchend', function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1)); }, { passive: true });
  document.addEventListener('keydown', function (e) {
    if (film.hidden) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); begin(); } return; }
    if (e.key === ' ') { e.preventDefault(); play.click(); } else if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); else if (e.key === 'Escape') location.href = T.back;
  });
})();
