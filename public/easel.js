// The easel (20 Oct): the work held for a study session. Pinch, drag, wheel and keys move the view; Hold locks it;
// the teacher's tools are CSS and SVG filters on the picture, nothing sent anywhere; the timer chimes quietly.
(function () {
  var root = document.querySelector('[data-easel]'); if (!root) return;
  var stage = root.querySelector('[data-ez-stage]'), img = root.querySelector('[data-ez-im]'), grid = root.querySelector('[data-ez-grid]'), study = root.querySelector('[data-ez-study]'), timers = root.querySelector('[data-ez-timers]'), clock = root.querySelector('[data-ez-clock]');
  var s = 1, x = 0, y = 0, fit = 1, held = false, state = { grid: 0, mirror: false, values: false, squint: false, notan: 0 };
  // The wall copy when the screen can use it.
  // The easel is for looking close (Will, 23 Oct): always the wall copy, 3840 px, once it has arrived.
  if (root.dataset.wall) { var big = new Image(); big.onload = function () { img.src = root.dataset.wall; }; big.src = root.dataset.wall; }
  function size() { var W = stage.clientWidth, H = stage.clientHeight, ar = parseFloat(root.dataset.ar) || 1.5; var w = W, h = W / ar; if (h > H) { h = H; w = H * ar; } img.style.width = w + 'px'; img.style.height = h + 'px'; grid.style.width = w + 'px'; grid.style.height = h + 'px'; fit = 1; }
  function apply() { var t = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')' + (state.mirror ? ' scaleX(-1)' : ''); img.style.transform = t; grid.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')'; }
  function clamp() { var max = Math.max(0, (img.offsetWidth * s - stage.clientWidth) / 2 + stage.clientWidth * 0.4), may = Math.max(0, (img.offsetHeight * s - stage.clientHeight) / 2 + stage.clientHeight * 0.4); x = Math.max(-max, Math.min(max, x)); y = Math.max(-may, Math.min(may, y)); }
  function zoomAt(f, cx, cy) { if (held) return; var r = stage.getBoundingClientRect(); var px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2; var ns = Math.max(1, Math.min(12, s * f)); var k = ns / s; x = px - (px - x) * k; y = py - (py - y) * k; s = ns; clamp(); apply(); }
  function reset() { s = 1; x = 0; y = 0; apply(); }
  size(); apply(); addEventListener('resize', function () { size(); clamp(); apply(); });
  // Pointer: drag and pinch.
  var pts = {}, drag = null, pinch = null;
  stage.addEventListener('pointerdown', function (e) { pts[e.pointerId] = e; stage.setPointerCapture(e.pointerId); if (Object.keys(pts).length === 1) drag = { x: e.clientX - x, y: e.clientY - y }; });
  stage.addEventListener('pointermove', function (e) { if (!pts[e.pointerId]) return; pts[e.pointerId] = e; var ids = Object.keys(pts); if (ids.length >= 2) { var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pinch) zoomAt(d / pinch, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2); pinch = d; return; } if (drag && !held) { x = e.clientX - drag.x; y = e.clientY - drag.y; clamp(); apply(); } });
  function up(e) { delete pts[e.pointerId]; if (!Object.keys(pts).length) { drag = null; pinch = null; } }
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', function (e) { e.preventDefault(); if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY / 300), e.clientX, e.clientY); else if (!held) { x -= e.deltaX; clamp(); apply(); } }, { passive: false });
  stage.addEventListener('dblclick', function (e) { if (s > 1.05) reset(); else zoomAt(3, e.clientX, e.clientY); });
  // Tools.
  function filters() { var f = []; if (state.values) f.push('grayscale(1)'); if (state.squint) f.push('blur(' + Math.max(3, img.offsetWidth / 120) + 'px)'); if (state.notan === 1) f.push('url(#ez-notan2)'); if (state.notan === 2) f.push('url(#ez-notan5)'); img.style.filter = f.join(' '); }
  function set(btn, on) { if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  var B = {}; root.querySelectorAll('[data-ez]').forEach(function (b) { B[b.dataset.ez] = b; });
  function tool(k) {
    if (k === 'grid') { state.grid = (state.grid + 1) % 3; grid.hidden = !state.grid; grid.className = 'ez-grid' + (state.grid === 1 ? ' ez-g3' : state.grid === 2 ? ' ez-g6' : ''); set(B.grid, !!state.grid); B.grid.lastChild.textContent = state.grid === 1 ? 'Grid · thirds' : state.grid === 2 ? 'Grid · 6 × 4' : 'Grid'; }
    else if (k === 'mirror') { state.mirror = !state.mirror; set(B.mirror, state.mirror); apply(); }
    else if (k === 'values') { state.values = !state.values; set(B.values, state.values); filters(); }
    else if (k === 'squint') { state.squint = !state.squint; set(B.squint, state.squint); filters(); }
    else if (k === 'notan') { state.notan = (state.notan + 1) % 3; set(B.notan, !!state.notan); B.notan.lastChild.textContent = state.notan === 1 ? 'Notan · two' : state.notan === 2 ? 'Notan · five' : 'Notan'; filters(); }
    else if (k === 'hold') { held = !held; set(B.hold, held); stage.classList.toggle('ez-held', held); }
    else if (k === 'fit') { reset(); }
    else if (k === 'study') { study.hidden = !study.hidden; set(B.study, !study.hidden); }
    else if (k === 'timer') { timers.hidden = !timers.hidden; set(B.timer, !timers.hidden); }
  }
  root.querySelectorAll('[data-ez]').forEach(function (b) { b.addEventListener('click', function () { tool(b.dataset.ez); }); });
  // The timer, with a quiet chime.
  var endAt = 0, tick = null;
  function chime() { try { var A = new (window.AudioContext || window.webkitAudioContext)(); [523.25, 659.25, 783.99].forEach(function (f, i) { var o = A.createOscillator(), g = A.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = 0; o.connect(g); g.connect(A.destination); var t = A.currentTime + i * 0.35; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2); o.start(t); o.stop(t + 2.3); }); } catch (e) { /* silent */ } if (navigator.vibrate) navigator.vibrate([60, 40, 60]); }
  function show() { var left = Math.max(0, endAt - Date.now()); var m = Math.floor(left / 60000), sec = Math.floor(left / 1000) % 60; clock.textContent = m + ':' + (sec < 10 ? '0' : '') + sec; if (left <= 0) { clearInterval(tick); tick = null; clock.textContent = 'Time.'; chime(); setTimeout(function () { clock.hidden = true; }, 8000); } }
  root.querySelectorAll('[data-ez-min]').forEach(function (b) { b.addEventListener('click', function () { var min = +b.dataset.ezMin; timers.hidden = true; set(B.timer, false); if (tick) clearInterval(tick); if (!min) { clock.hidden = true; tick = null; return; } endAt = Date.now() + min * 60000; clock.hidden = false; show(); tick = setInterval(show, 1000); }); });
  // Just the picture (Will, 20 Oct: the sticky menu at the bottom is distracting; you need to look at the whole image):
  // Hide puts the tools and the top bar away; a small ghost in the corner, H, Tab or Esc brings them back. After eight
  // seconds still, the chrome fades by itself; any touch or movement returns it.
  var hidden = false, peek = root.querySelector('[data-ez-peek]'), stillT = null;
  function hideTools(on) { hidden = on; root.classList.toggle('ez-hidden', on); if (peek) peek.hidden = !on; }
  var hb = root.querySelector('[data-ez-hide]'); if (hb) hb.addEventListener('click', function () { hideTools(true); });
  if (peek) peek.addEventListener('click', function () { hideTools(false); });
  function still() { root.classList.add('ez-still'); } function awake() { root.classList.remove('ez-still'); clearTimeout(stillT); stillT = setTimeout(still, 8000); }
  ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (ev) { addEventListener(ev, awake, { passive: true }); }); awake();
  // Keys.
  addEventListener('keydown', function (e) { if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return; var k = e.key.toLowerCase(); if (k === 'h' || k === 'tab') { hideTools(!hidden); e.preventDefault(); return; } if (k === 'escape' && hidden) { hideTools(false); e.preventDefault(); return; } var map = { g: 'grid', m: 'mirror', v: 'values', s: 'squint', n: 'notan', l: 'hold', t: 'timer', '0': 'fit', '?': 'study' }; if (map[k]) { tool(map[k]); e.preventDefault(); return; } if (k === 'escape') { var back = root.querySelector('.ez-back'); if (back) location.href = back.getAttribute('href'); } if (k === '+' || k === '=') zoomAt(1.25, innerWidth / 2, innerHeight / 2); if (k === '-') zoomAt(0.8, innerWidth / 2, innerHeight / 2); if (!held && /^arrow/.test(k)) { var d = 40; if (k === 'arrowleft') x += d; if (k === 'arrowright') x -= d; if (k === 'arrowup') y += d; if (k === 'arrowdown') y -= d; clamp(); apply(); e.preventDefault(); } });
  // The screen stays awake.
  var lock = null; function wake() { if (navigator.wakeLock && !lock) navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }).catch(function () {}); }
  wake(); document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') wake(); });
})();
