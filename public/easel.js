// The easel (20 Oct; 2 Nov, Will: "put the easel on the forefront: people use these images as reference while they paint
// and draw; the phone or the Duo on its stand is the easel"). The work held for a study session. Pinch, drag, wheel and
// keys move the view; Hold locks it; the teacher's tools are CSS and SVG filters on the picture, nothing sent anywhere.
// Value (P) reads any passage's value, 0 black to 10 white, and its colour; Side by side (B) sets the colour beside the
// values, the notan or the squint, the two moving together; On the stand puts everything away, holds the view and keeps
// the screen awake. The tools you used are remembered on this device.
(function () {
  var root = document.querySelector('[data-easel]'); if (!root) return;
  var stage = root.querySelector('[data-ez-stage]'), pane = root.querySelector('[data-ez-pane]'), pane2 = root.querySelector('[data-ez-pane2]');
  var img = root.querySelector('[data-ez-im]'), img2 = root.querySelector('[data-ez-im2]'), grid = root.querySelector('[data-ez-grid]'), grid2 = root.querySelector('[data-ez-grid2]');
  var study = root.querySelector('[data-ez-study]'), timers = root.querySelector('[data-ez-timers]'), clock = root.querySelector('[data-ez-clock]');
  var pickBox = root.querySelector('[data-ez-pickbox]'), ring = root.querySelector('[data-ez-ring]');
  var s = 1, x = 0, y = 0, held = false, state = { grid: 0, mirror: false, values: false, squint: false, notan: 0, pick: false, compare: false };
  var GRIDS = ['', 'ez-g3', 'ez-g4', 'ez-g6'], GRIDW = ['Grid', 'Grid · thirds', 'Grid · 4 × 4', 'Grid · 6 × 4'];
  // The wall copy, 3840 px, once it has arrived (the easel is for looking close).
  if (root.dataset.wall) { var big = new Image(); big.onload = function () { img.src = root.dataset.wall; if (img2) img2.src = root.dataset.wall; canvas = null; }; big.src = root.dataset.wall; }
  function W() { return pane.clientWidth; } function H() { return pane.clientHeight; }
  function size() { var w0 = W(), h0 = H(), ar = parseFloat(root.dataset.ar) || 1.5; var w = w0, h = w0 / ar; if (h > h0) { h = h0; w = h0 * ar; } [img, img2, grid, grid2].forEach(function (el) { if (!el) return; el.style.width = w + 'px'; el.style.height = h + 'px'; }); }
  function apply() { var t = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')', m = state.mirror ? ' scaleX(-1)' : ''; img.style.transform = t + m; if (img2) img2.style.transform = t + m; grid.style.transform = t; if (grid2) grid2.style.transform = t; if (ring) ring.hidden = true; }
  function clamp() { var max = Math.max(0, (img.offsetWidth * s - W()) / 2 + W() * 0.4), may = Math.max(0, (img.offsetHeight * s - H()) / 2 + H() * 0.4); x = Math.max(-max, Math.min(max, x)); y = Math.max(-may, Math.min(may, y)); }
  function paneAt(cx) { return state.compare && pane2 && cx >= pane2.getBoundingClientRect().left ? pane2 : pane; }
  function zoomAt(f, cx, cy) { if (held) return; var r = paneAt(cx).getBoundingClientRect(); var px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2; var ns = Math.max(1, Math.min(12, s * f)); var k = ns / s; x = px - (px - x) * k; y = py - (py - y) * k; s = ns; clamp(); apply(); }
  function reset() { s = 1; x = 0; y = 0; apply(); }
  // Pointer: drag and pinch; in Value, a tap reads the passage.
  var pts = {}, drag = null, pinch = null, down = null;
  stage.addEventListener('pointerdown', function (e) { pts[e.pointerId] = e; try { stage.setPointerCapture(e.pointerId); } catch (er) { /* */ } down = { x: e.clientX, y: e.clientY, t: Date.now() }; if (Object.keys(pts).length === 1) drag = { x: e.clientX - x, y: e.clientY - y }; });
  stage.addEventListener('pointermove', function (e) {
    if (state.pick && e.pointerType === 'mouse' && !Object.keys(pts).length) { read(e.clientX, e.clientY, false); return; }
    if (!pts[e.pointerId]) return; pts[e.pointerId] = e; var ids = Object.keys(pts);
    if (ids.length >= 2) { var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pinch) zoomAt(d / pinch, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2); pinch = d; return; }
    if (drag && !held) { x = e.clientX - drag.x; y = e.clientY - drag.y; clamp(); apply(); }
  });
  function up(e) { var tap = down && Object.keys(pts).length === 1 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && Date.now() - down.t < 500; delete pts[e.pointerId]; if (!Object.keys(pts).length) { drag = null; pinch = null; } if (tap && state.pick) read(e.clientX, e.clientY, true); down = null; }
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', function (e) { delete pts[e.pointerId]; drag = null; pinch = null; down = null; });
  stage.addEventListener('wheel', function (e) { e.preventDefault(); if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY / 300), e.clientX, e.clientY); else if (!held) { x -= e.deltaX; clamp(); apply(); } }, { passive: false });
  stage.addEventListener('dblclick', function (e) { if (state.pick) return; if (s > 1.05) reset(); else zoomAt(3, e.clientX, e.clientY); });
  // Value: the passage under the finger, read from the picture itself (a canvas of it, made once).
  var canvas = null, cx2 = null;
  function sample(u, v) {
    if (!canvas) { if (!img.naturalWidth) return null; var cw = Math.min(1600, img.naturalWidth), ch = Math.round(cw * img.naturalHeight / img.naturalWidth); canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch; cx2 = canvas.getContext('2d', { willReadFrequently: true }); try { cx2.drawImage(img, 0, 0, cw, ch); } catch (er) { canvas = null; return null; } }
    var px = Math.max(0, Math.min(canvas.width - 1, Math.floor(u * canvas.width))), py = Math.max(0, Math.min(canvas.height - 1, Math.floor(v * canvas.height)));
    try { var d = cx2.getImageData(Math.max(0, px - 2), Math.max(0, py - 2), 5, 5).data, r = 0, g = 0, b = 0, n = 0; for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return [r / n, g / n, b / n]; } catch (er) { return null; }
  }
  function lstar(rgb) { var lin = function (c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; var Y = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; }
  var WORD = ['black', 'near black', 'very dark', 'dark', 'low middle', 'middle', 'high middle', 'light', 'very light', 'near white', 'white'];
  function read(cx, cy, mark) {
    var p = paneAt(cx), r = p.getBoundingClientRect(); var px = (cx - r.left - r.width / 2 - x) / s, py = (cy - r.top - r.height / 2 - y) / s; if (state.mirror) px = -px;
    var u = px / img.offsetWidth + 0.5, v = py / img.offsetHeight + 0.5; if (u < 0 || u > 1 || v < 0 || v > 1) return;
    var rgb = sample(u, v); if (!rgb) return; var L = lstar(rgb), val = Math.round(L / 10);
    var hex = '#' + rgb.map(function (c) { var h = Math.round(c).toString(16); return h.length < 2 ? '0' + h : h; }).join('');
    pickBox.hidden = false; pickBox.querySelector('[data-ez-sw]').style.background = hex;
    pickBox.querySelector('[data-ez-pv]').textContent = 'Value ' + val + ' of 10 · ' + WORD[val];
    pickBox.querySelector('[data-ez-hex]').textContent = hex.toUpperCase() + ' · L* ' + Math.round(L);
    pickBox.querySelectorAll('[data-v]').forEach(function (el) { el.classList.toggle('on', +el.getAttribute('data-v') === val); });
    if (mark && ring) { ring.style.left = (cx - pane.getBoundingClientRect().left) + 'px'; ring.style.top = (cy - pane.getBoundingClientRect().top) + 'px'; ring.hidden = p !== pane; }
  }
  // Tools.
  function filters() {
    var f = []; if (state.values) f.push('grayscale(1)'); if (state.squint) f.push('blur(' + Math.max(3, img.offsetWidth / 120) + 'px)'); if (state.notan === 1) f.push('url(#ez-notan2)'); if (state.notan === 2) f.push('url(#ez-notan5)');
    var css = f.join(' '); if (state.compare && img2) { img.style.filter = ''; img2.style.filter = css || 'grayscale(1)'; } else { img.style.filter = css; if (img2) img2.style.filter = ''; }
  }
  function set(btn, on) { if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  var B = {}; root.querySelectorAll('[data-ez]').forEach(function (b) { B[b.dataset.ez] = b; });
  function paintGrid() { [grid, grid2].forEach(function (g) { if (!g) return; g.hidden = !state.grid; g.className = 'ez-grid' + (state.grid ? ' ' + GRIDS[state.grid] : ''); }); set(B.grid, !!state.grid); if (B.grid) B.grid.lastChild.textContent = GRIDW[state.grid]; }
  function paintCompare() { root.classList.toggle('ez-two', state.compare); if (pane2) pane2.hidden = !state.compare; set(B.compare, state.compare); size(); clamp(); apply(); filters(); }
  function keep() { try { localStorage.setItem('wm_ez', JSON.stringify({ grid: state.grid, values: state.values, squint: state.squint, notan: state.notan, compare: state.compare })); } catch (e) { /* */ } }
  function tool(k) {
    if (k === 'grid') { state.grid = (state.grid + 1) % GRIDS.length; paintGrid(); }
    else if (k === 'mirror') { state.mirror = !state.mirror; set(B.mirror, state.mirror); apply(); }
    else if (k === 'values') { state.values = !state.values; set(B.values, state.values); filters(); }
    else if (k === 'squint') { state.squint = !state.squint; set(B.squint, state.squint); filters(); }
    else if (k === 'notan') { state.notan = (state.notan + 1) % 3; set(B.notan, !!state.notan); B.notan.lastChild.textContent = state.notan === 1 ? 'Notan · two' : state.notan === 2 ? 'Notan · five' : 'Notan'; filters(); }
    else if (k === 'pick') { state.pick = !state.pick; set(B.pick, state.pick); root.classList.toggle('ez-picking', state.pick); if (!state.pick) { pickBox.hidden = true; if (ring) ring.hidden = true; } else pickBox.hidden = false; }
    else if (k === 'compare') { state.compare = !state.compare; paintCompare(); }
    else if (k === 'hold') { held = !held; set(B.hold, held); stage.classList.toggle('ez-held', held); }
    else if (k === 'stand') { held = true; set(B.hold, true); stage.classList.add('ez-held'); hideTools(true); try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {}); } catch (e) { /* */ } wake(); }
    else if (k === 'fit') { reset(); }
    else if (k === 'study') { study.hidden = !study.hidden; set(B.study, !study.hidden); }
    else if (k === 'timer') { timers.hidden = !timers.hidden; set(B.timer, !timers.hidden); }
    if (/^(grid|values|squint|notan|compare)$/.test(k)) keep();
  }
  root.querySelectorAll('[data-ez]').forEach(function (b) { b.addEventListener('click', function () { tool(b.dataset.ez); }); });
  // What you used last time, on this device.
  try { var kept = JSON.parse(localStorage.getItem('wm_ez') || 'null'); if (kept) { state.grid = +kept.grid || 0; state.values = !!kept.values; state.squint = !!kept.squint; state.notan = +kept.notan || 0; state.compare = !!kept.compare && innerWidth > 700; set(B.values, state.values); set(B.squint, state.squint); set(B.notan, !!state.notan); if (B.notan) B.notan.lastChild.textContent = state.notan === 1 ? 'Notan · two' : state.notan === 2 ? 'Notan · five' : 'Notan'; paintGrid(); } } catch (e) { /* */ }
  size(); paintCompare(); addEventListener('resize', function () { size(); clamp(); apply(); });
  // The timer, with a quiet chime.
  var endAt = 0, tick = null;
  function chime() { try { var A = new (window.AudioContext || window.webkitAudioContext)(); [523.25, 659.25, 783.99].forEach(function (f, i) { var o = A.createOscillator(), g = A.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = 0; o.connect(g); g.connect(A.destination); var t = A.currentTime + i * 0.35; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2); o.start(t); o.stop(t + 2.3); }); } catch (e) { /* silent */ } if (navigator.vibrate) navigator.vibrate([60, 40, 60]); }
  function show() { var left = Math.max(0, endAt - Date.now()); var m = Math.floor(left / 60000), sec = Math.floor(left / 1000) % 60; clock.textContent = m + ':' + (sec < 10 ? '0' : '') + sec; if (left <= 0) { clearInterval(tick); tick = null; clock.textContent = 'Time.'; chime(); setTimeout(function () { clock.hidden = true; }, 8000); } }
  root.querySelectorAll('[data-ez-min]').forEach(function (b) { b.addEventListener('click', function () { var min = +b.dataset.ezMin; timers.hidden = true; set(B.timer, false); if (tick) clearInterval(tick); if (!min) { clock.hidden = true; tick = null; return; } endAt = Date.now() + min * 60000; clock.hidden = false; show(); tick = setInterval(show, 1000); }); });
  // Just the picture: Hide puts the tools and the top bar away; the ghost in the corner, H, Tab or Esc brings them back.
  // After eight seconds still the chrome fades by itself; any touch or movement returns it.
  var hidden = false, peek = root.querySelector('[data-ez-peek]'), stillT = null;
  function hideTools(on) { hidden = on; root.classList.toggle('ez-hidden', on); if (peek) peek.hidden = !on; }
  var hb = root.querySelector('[data-ez-hide]'); if (hb) hb.addEventListener('click', function () { hideTools(true); });
  if (peek) peek.addEventListener('click', function () { hideTools(false); });
  function still() { root.classList.add('ez-still'); } function awake() { root.classList.remove('ez-still'); clearTimeout(stillT); stillT = setTimeout(still, 8000); }
  ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (ev) { addEventListener(ev, awake, { passive: true }); }); awake();
  // Keys.
  addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return; var k = e.key.toLowerCase();
    if (k === 'h' || k === 'tab') { hideTools(!hidden); e.preventDefault(); return; }
    if (k === 'escape' && hidden) { hideTools(false); e.preventDefault(); return; }
    if (k === 'enter') { tool('stand'); e.preventDefault(); return; }
    var map = { g: 'grid', m: 'mirror', v: 'values', s: 'squint', n: 'notan', p: 'pick', b: 'compare', l: 'hold', t: 'timer', '0': 'fit', '?': 'study' };
    if (map[k]) { tool(map[k]); e.preventDefault(); return; }
    if (k === 'escape') { var back = root.querySelector('.ez-back'); if (back) location.href = back.getAttribute('href'); return; }
    if (held) return; var st = 60 / s;
    if (k === 'arrowleft') { x += st * s; } else if (k === 'arrowright') { x -= st * s; } else if (k === 'arrowup') { y += st * s; } else if (k === 'arrowdown') { y -= st * s; } else if (k === '+' || k === '=') { zoomAt(1.25, innerWidth / 2, innerHeight / 2); return; } else if (k === '-') { zoomAt(0.8, innerWidth / 2, innerHeight / 2); return; } else return;
    e.preventDefault(); clamp(); apply();
  });
  // The screen stays awake.
  var lock = null; function wake() { if (navigator.wakeLock && !lock) navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }).catch(function () {}); }
  wake(); document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') wake(); });
})();
