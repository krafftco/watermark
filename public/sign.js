// Signed on the spot (src/sign.js): the pad. A finger (or a pen, or a mouse) draws on the canvas at the device's own
// resolution; a stroke is kept as a path so the line is smooth; Clear starts over; the signature leaves as a PNG in a
// hidden field when the release is sent. Nothing is sent until the subject presses Sign.
(function () {
  'use strict';
  var main = document.querySelector('main.sg[data-sign]'); if (!main) return;
  var cv = main.querySelector('[data-sg-canvas]'), form = main.querySelector('[data-sg-form]'), sig = main.querySelector('[data-sg-sig]'), go = main.querySelector('[data-sg-go]'), hint = main.querySelector('[data-sg-hint]');
  if (!cv || !form) return;
  var ctx = cv.getContext('2d'), drawing = false, strokes = 0, last = null, dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  function size() {
    var r = cv.getBoundingClientRect(); var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) { var keep = strokes ? cv.toDataURL() : null; cv.width = w; cv.height = h; paint(); if (keep) { var im = new Image(); im.onload = function () { ctx.drawImage(im, 0, 0, w, h); }; im.src = keep; } }
  }
  function paint() { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#141210'; ctx.lineWidth = 2.2 * dpr; }
  function pt(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }; }
  function down(e) { if (e.button && e.button !== 0) return; e.preventDefault(); drawing = true; last = pt(e); try { cv.setPointerCapture(e.pointerId); } catch (x) { /* */ } ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(last.x + 0.1, last.y + 0.1); ctx.stroke(); }
  function move(e) { if (!drawing) return; e.preventDefault(); var p = pt(e); var mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 }; ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(mid.x, mid.y); last = p; }
  function up(e) { if (!drawing) return; drawing = false; strokes++; ready(); }
  function ready() { var ok = strokes > 0; if (go) go.disabled = !ok; if (hint) hint.textContent = ok ? 'Signed. Press the button to keep it.' : 'Draw your signature above.'; }
  cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', up);
  cv.style.touchAction = 'none';
  var clear = main.querySelector('[data-sg-clear]'); if (clear) clear.addEventListener('click', function () { ctx.clearRect(0, 0, cv.width, cv.height); strokes = 0; ready(); });
  var minor = main.querySelector('[data-sg-minor]'), guardian = main.querySelector('[data-sg-guardian]');
  if (minor && guardian) minor.addEventListener('change', function () { guardian.hidden = !minor.checked; var inp = guardian.querySelector('input'); if (inp) inp.required = minor.checked; });
  form.addEventListener('submit', function (e) {
    if (!strokes) { e.preventDefault(); if (hint) hint.textContent = 'A signature is needed.'; return; }
    // The signature leaves at a steady size whatever the screen: 900 × 300, white ground.
    var out = document.createElement('canvas'); out.width = 900; out.height = 300; var o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, 900, 300); o.drawImage(cv, 0, 0, 900, 300);
    sig.value = out.toDataURL('image/png');
  });
  size(); addEventListener('resize', size); ready();
})();
