// The frame: photographs cycling on a wall. Two images cross-fade; the next is decoded while the current one hangs;
// a slow drift on each; the plate rises for a moment. The remote changes the set; the screen asks every few seconds.
(function () {
  var root = document.querySelector('[data-tv]'); if (!root) return;
  var code = root.getAttribute('data-code'), st = window.__WM_TV || { works: [] }, waiting = root.getAttribute('data-waiting') === '1';
  var ims = root.querySelectorAll('.fm-im'), cur = 0, i = -1, timer = null, paused = false, v = st.v, started = !waiting;
  var plate = root.querySelector('[data-tv-plate]'), wait = root.querySelector('[data-tv-wait]'), corner = root.querySelector('[data-tv-corner]'), sound = root.querySelector('[data-tv-sound]');
  var k = root.querySelector('[data-tv-k]'), t = root.querySelector('[data-tv-t]'), by = root.querySelector('[data-tv-by]');
  var order = [];
  function shuffle() { order = st.works.map(function (_, j) { return j; }); for (var a = order.length - 1; a > 0; a--) { var b = Math.floor(Math.random() * (a + 1)), x = order[a]; order[a] = order[b]; order[b] = x; } }
  shuffle();
  function load(src) { return new Promise(function (ok) { var im = new Image(); im.decoding = 'async'; im.onload = function () { (im.decode ? im.decode().catch(function () {}) : Promise.resolve()).then(function () { ok(src); }); }; im.onerror = function () { ok(null); }; im.src = src; }); }
  var ahead = null;
  function prime() { if (!st.works.length) return; var n = st.works[order[(i + 1) % order.length]]; ahead = load(n.img); }
  function show(dir) {
    if (!st.works.length) return;
    i = (i + (dir || 1) + order.length) % order.length;
    var w = st.works[order[i]];
    (ahead && dir !== -1 ? ahead : load(w.img)).then(function () {
      var nxt = ims[1 - cur]; nxt.src = w.img; nxt.className = 'fm-im fm-on'; ims[cur].className = 'fm-im fm-off'; cur = 1 - cur;
      nxt.style.animation = 'none'; void nxt.offsetWidth; nxt.style.animation = '';
      k.textContent = [w.place, w.year].filter(Boolean).join(' · '); t.textContent = w.title; by.textContent = w.maker + (w.held ? '' : ' · Watermark');
      plate.className = 'fm-plate' + (st.plate === 'never' ? '' : ' up'); if (st.plate === 'brief') setTimeout(function () { plate.className = 'fm-plate'; }, 6000);
      prime(); arm();
    });
  }
  function arm() { clearTimeout(timer); if (!paused) timer = setTimeout(function () { show(1); }, (st.every || 30) * 1000); }
  function begin() { if (started) return; started = true; wait.hidden = true; corner.className = 'fm-corner dim'; show(1); }
  // The remote: ask every five seconds whether the set changed.
  function poll() { fetch('/frame/tv/' + code + '/state', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (s) { if (!s) return; if (s.v !== v || s.works.length !== st.works.length) { st = s; v = s.v; shuffle(); i = -1; ahead = null; music(); if (!started) begin(); else show(1); } }).catch(function () {}).then(function () { setTimeout(poll, 5000); }); }
  // Quiet, made in the room: two slow sines a fifth apart, breathing, far below speech. Nothing streamed, nothing to license.
  var ac = null, own = null;
  function music() {
    if (own) { own.pause(); own = null; }
    if (ac) { ac.close().catch(function () {}); ac = null; }
    sound.hidden = true;
    if (st.music === 'own' && st.music_url) { own = new Audio(st.music_url); own.loop = true; own.volume = .5; own.play().catch(function () { sound.hidden = false; }); }
    if (st.music === 'quiet') { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } var g = ac.createGain(); g.gain.value = 0; g.connect(ac.destination);
      [55, 82.4, 110, 164.8].forEach(function (f, j) { var o = ac.createOscillator(), og = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain(); o.type = 'sine'; o.frequency.value = f; og.gain.value = [.5, .25, .18, .08][j]; lfo.frequency.value = .03 + j * .013; lg.gain.value = og.gain.value * .6; lfo.connect(lg); lg.connect(og.gain); o.connect(og); og.connect(g); o.start(); lfo.start(); });
      g.gain.linearRampToValueAtTime(.12, ac.currentTime + 12); if (ac.state === 'suspended') { sound.hidden = false; } }
  }
  function wake() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {}); } catch (e) {} }
  function fs() { var el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(function () {}); }
  document.addEventListener('keydown', function (e) {
    if (e.key === ' ') { e.preventDefault(); if (!started) { begin(); return; } paused = !paused; if (!paused) show(1); else clearTimeout(timer); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (!started) begin(); else show(1); }
    else if (e.key === 'ArrowLeft') show(-1);
    else if (e.key === 'f' || e.key === 'F') fs();
    else if (e.key === 'Escape') { if (document.fullscreenElement) document.exitFullscreen(); else location.href = '/frame'; }
  });
  root.addEventListener('click', function () { if (!started) begin(); if (ac && ac.state === 'suspended') ac.resume(); if (own) own.play().catch(function () {}); sound.hidden = true; wake(); });
  var idle; document.addEventListener('mousemove', function () { root.classList.add('mouse'); clearTimeout(idle); idle = setTimeout(function () { root.classList.remove('mouse'); }, 2500); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });
  wake(); music(); poll();
  if (started) { show(1); }
})();
