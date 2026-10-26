// The darkroom (src/darkroom.js). While a slider moves the picture is approximated with CSS filters at once; when it
// rests, the house renders the same recipe from the original and the true picture replaces it. B holds the negative
// up for comparison; R resets; crop is drawn on the picture; Esc leaves.
(function () {
  'use strict';
  var room = document.querySelector('[data-dkr-room]'); if (!room) return;
  var base = room.getAttribute('data-base'), form = room.querySelector('[data-dkr-form]'), img = room.querySelector('[data-dkr-img]'), before = room.querySelector('[data-dkr-before]'), say = room.querySelector('[data-dkr-say]'), cropEl = room.querySelector('[data-dkr-crop]'), fig = img.parentNode;
  var inputs = Array.prototype.slice.call(form.querySelectorAll('[data-dkr]')), cropIn = form.querySelector('input[name=crop]');
  var masksIn = form.querySelector('input[name=masks]'), maskList = form.querySelector('[data-dkr-masklist]'), maskTpl = form.querySelector('[data-dkr-masktpl]'), mkSvg = room.querySelector('[data-dkr-mk]');
  var masks = []; try { masks = JSON.parse(masksIn.value || '[]') || []; } catch (e) { masks = []; }
  function recipe() {
    var r = {}; inputs.forEach(function (i) { if (i.type === 'checkbox') r[i.name] = i.checked; else r[i.name] = +i.value; });
    if (cropIn.value) { try { r.crop = JSON.parse(cropIn.value); } catch (e) { /* none */ } }
    masksIn.value = JSON.stringify(masks); r.masks = masks;
    return r;
  }
  // The approximation: what CSS can do while the finger is on the slider.
  function approx(r) {
    var f = [];
    if (r.exposure) f.push('brightness(' + Math.pow(2, r.exposure).toFixed(3) + ')');
    if (r.contrast) f.push('contrast(' + (1 + r.contrast / 100 * (r.contrast > 0 ? 1 : 0.6)).toFixed(3) + ')');
    if (r.whites) f.push('brightness(' + (1 + r.whites / 300).toFixed(3) + ')');
    if (r.shadows) f.push('brightness(' + (1 + r.shadows / 400).toFixed(3) + ')');
    if (r.highlights) f.push('contrast(' + (1 + r.highlights / 500).toFixed(3) + ')');
    if (r.bw) f.push('grayscale(1)'); else if (r.saturation) f.push('saturate(' + Math.max(0, 1 + r.saturation / 100).toFixed(3) + ')');
    if (r.temp) f.push('sepia(' + Math.abs(r.temp / 400).toFixed(3) + ')' + (r.temp < 0 ? ' hue-rotate(180deg) sepia(' + Math.abs(r.temp / 400).toFixed(3) + ') hue-rotate(180deg)' : ''));
    img.style.filter = f.join(' ');
    img.style.transform = r.rotate ? 'rotate(' + r.rotate + 'deg) scale(' + (1 + Math.abs(r.rotate) / 60).toFixed(3) + ')' : '';
  }
  // The histogram: read from the house's own preview each time it lands; luminance on a log scale, clipping counted.
  var hist = room.querySelector('[data-dkr-hist]'), clip = room.querySelector('[data-dkr-clip]');
  function histogram() {
    if (!hist || !img.naturalWidth) return;
    try {
      var c = document.createElement('canvas'); var W = 256, H = Math.max(1, Math.round(256 * img.naturalHeight / img.naturalWidth)); c.width = W; c.height = H; var x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H);
      var d = x.getImageData(0, 0, W, H).data, L = new Uint32Array(256), R = new Uint32Array(256), G = new Uint32Array(256), B = new Uint32Array(256), n = W * H, lo = 0, hi = 0;
      for (var i = 0; i < d.length; i += 4) { var r = d[i], g = d[i + 1], b = d[i + 2]; var l = (r * 54 + g * 183 + b * 19) >> 8; L[l]++; R[r]++; G[g]++; B[b]++; if (l <= 2) lo++; if (l >= 253) hi++; }
      var ctx = hist.getContext('2d'), w = hist.width, h = hist.height; ctx.clearRect(0, 0, w, h);
      var max = 1; for (var k = 0; k < 256; k++) max = Math.max(max, L[k], R[k], G[k], B[k]);
      var draw = function (arr, col) { ctx.beginPath(); ctx.moveTo(0, h); for (var k2 = 0; k2 < 256; k2++) { var v = Math.log(1 + arr[k2]) / Math.log(1 + max); ctx.lineTo(k2 * w / 255, h - v * (h - 2)); } ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
      ctx.globalCompositeOperation = 'lighter'; draw(R, 'rgba(220,70,60,.45)'); draw(G, 'rgba(90,200,90,.45)'); draw(B, 'rgba(80,120,240,.45)'); ctx.globalCompositeOperation = 'source-over'; draw(L, 'rgba(232,227,218,.55)');
      if (clip) { var pl = lo / n * 100, ph = hi / n * 100; clip.textContent = (pl >= 0.05 ? pl.toFixed(1) + '% blacks clipped' : 'Blacks held') + ' · ' + (ph >= 0.05 ? ph.toFixed(1) + '% whites clipped' : 'Whites held'); clip.classList.toggle('dkr-clip-on', pl >= 0.5 || ph >= 0.5); }
    } catch (e) { /* a tainted canvas or an old browser: no histogram */ }
  }
  img.addEventListener('load', histogram); if (img.complete) histogram();
  var pending = null, busy = false, want = null;
  function render() {
    var r = recipe(); var url = base + '/preview?r=' + encodeURIComponent(JSON.stringify(r));
    if (busy) { want = url; return; } busy = true; room.classList.add('dkr-busy');
    var n = new Image(); n.onload = function () { img.src = url; img.style.filter = ''; img.style.transform = ''; busy = false; room.classList.remove('dkr-busy'); if (want && want !== url) { var w = want; want = null; busy = false; setTimeout(render, 0); } else want = null; };
    n.onerror = function () { busy = false; room.classList.remove('dkr-busy'); };
    n.src = url;
  }
  function changed(live) {
    var r = recipe(); inputs.forEach(function (i) { var o = i.parentNode.querySelector('output'); if (o) o.textContent = i.value; });
    approx(r); clearTimeout(pending); pending = setTimeout(render, live ? 450 : 60);
  }
  inputs.forEach(function (i) { i.addEventListener('input', function () { changed(true); }); i.addEventListener('change', function () { changed(false); }); });
  // Before and after: hold B.
  function hold(on) { before.hidden = !on; img.style.visibility = on ? 'hidden' : ''; }
  addEventListener('keydown', function (e) { if (/input|textarea/i.test(e.target.tagName) && e.target.type !== 'range') return; if (e.key === 'b' || e.key === 'B') { hold(true); } if (e.key === 'r' || e.key === 'R') { reset(); } if (e.key === 'Escape') { var back = room.querySelector('.dkr-back'); if (cropping) endCrop(false); else if (drawing) { drawing = null; mStart = null; room.classList.remove('dkr-cropping'); } else if (cur >= 0) { cur = -1; paintMasks(); paintOverlay(); } else if (back) location.href = back.href; } });
  addEventListener('keyup', function (e) { if (e.key === 'b' || e.key === 'B') hold(false); });
  img.addEventListener('pointerdown', function (e) { if (cropping || drawing) return; hold(true); e.preventDefault(); }); addEventListener('pointerup', function () { if (!cropping) hold(false); });
  function reset() { inputs.forEach(function (i) { if (i.type === 'checkbox') i.checked = false; else i.value = i.name === 'rotate' ? 0 : 0; }); cropIn.value = ''; room.querySelector('[data-dkr-cropclear]').hidden = true; masks = []; paintMasks(); changed(false); }
  var rb = room.querySelector('[data-dkr-reset]'); if (rb) rb.addEventListener('click', reset);
  // Crop: draw a rectangle on the picture; kept as fractions of the picture as it is.
  var cropping = false, c0 = null;
  function rect() { return img.getBoundingClientRect(); }
  function endCrop(keep) {
    cropping = false; room.classList.remove('dkr-cropping');
    if (keep && c0 && c0.w > 0.05 && c0.h > 0.05) { cropIn.value = JSON.stringify({ x: +c0.x.toFixed(4), y: +c0.y.toFixed(4), w: +c0.w.toFixed(4), h: +c0.h.toFixed(4) }); room.querySelector('[data-dkr-cropclear]').hidden = false; changed(false); }
    cropEl.hidden = true; c0 = null;
  }
  var cs = room.querySelector('[data-dkr-cropstart]'); if (cs) cs.addEventListener('click', function () { cropping = true; room.classList.add('dkr-cropping'); say.textContent = 'Draw the crop on the picture; let go to keep it.'; });
  var cc = room.querySelector('[data-dkr-cropclear]'); if (cc) cc.addEventListener('click', function () { cropIn.value = ''; cc.hidden = true; changed(false); });
  var start = null;
  fig.addEventListener('pointerdown', function (e) { if (!cropping) return; e.preventDefault(); var r = rect(); start = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; cropEl.hidden = false; });
  fig.addEventListener('pointermove', function (e) { if (!cropping || !start) return; var r = rect(); var x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); c0 = { x: Math.min(start.x, x), y: Math.min(start.y, y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) }; cropEl.style.left = (r.left - fig.getBoundingClientRect().left + c0.x * r.width) + 'px'; cropEl.style.top = (r.top - fig.getBoundingClientRect().top + c0.y * r.height) + 'px'; cropEl.style.width = (c0.w * r.width) + 'px'; cropEl.style.height = (c0.h * r.height) + 'px'; });
  addEventListener('pointerup', function () { if (cropping && start) { start = null; endCrop(true); } });
  // Looks: a recipe in a word. A look sets light and colour and leaves this picture's frame and masks alone.
  var lookBtns = Array.prototype.slice.call(form.querySelectorAll('[data-dkr-look]')), unlook = form.querySelector('[data-dkr-unlook]'), lookId = null;
  function applyLook(rec) { inputs.forEach(function (i) { if (!(i.name in rec)) return; if (i.type === 'checkbox') i.checked = !!rec[i.name]; else i.value = rec[i.name]; }); changed(false); }
  lookBtns.forEach(function (b) { b.addEventListener('click', function () { var rec; try { rec = JSON.parse(b.getAttribute('data-dkr-look')); } catch (e) { return; } applyLook(rec); lookBtns.forEach(function (x) { x.classList.toggle('on', x === b); }); lookId = b.getAttribute('data-dkr-lookid'); if (unlook) unlook.hidden = !lookId; }); });
  if (unlook) unlook.addEventListener('click', function () { if (!lookId) return; var fd = new URLSearchParams(); fd.set('do', 'unlook'); fd.set('look_id', lookId); fd.set('json', '1'); fetch(form.action, { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function () { var b = form.querySelector('[data-dkr-lookid="' + lookId + '"]'); if (b) b.remove(); lookId = null; unlook.hidden = true; say.textContent = 'The look is forgotten.'; }); });
  // Masks: a gradient or a circle drawn on the picture, each with its own sliders; the red wash shows the one being set.
  var drawing = null, cur = -1;
  function svgNS(tag, at) { var el = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(at).forEach(function (k) { el.setAttribute(k, at[k]); }); return el; }
  function paintOverlay() {
    if (!mkSvg) return; var m = masks[cur]; if (!m) { mkSvg.setAttribute('hidden', ''); return; }
    var r = rect(), fr = fig.getBoundingClientRect(); mkSvg.removeAttribute('hidden'); mkSvg.style.left = (r.left - fr.left) + 'px'; mkSvg.style.top = (r.top - fr.top) + 'px'; mkSvg.setAttribute('width', r.width); mkSvg.setAttribute('height', r.height); mkSvg.setAttribute('viewBox', '0 0 1 1'); mkSvg.setAttribute('preserveAspectRatio', 'none');
    while (mkSvg.firstChild) mkSvg.removeChild(mkSvg.firstChild); var defs = svgNS('defs', {}); var id = 'mkg' + Date.now(); var grad;
    if (m.kind === 'linear') { grad = svgNS('linearGradient', { id: id, gradientUnits: 'userSpaceOnUse', x1: m.g.x0, y1: m.g.y0, x2: m.g.x1, y2: m.g.y1 }); grad.appendChild(svgNS('stop', { offset: 0, 'stop-color': '#d33', 'stop-opacity': m.inv ? 0 : .45 })); grad.appendChild(svgNS('stop', { offset: 1, 'stop-color': '#d33', 'stop-opacity': m.inv ? .45 : 0 })); }
    else { grad = svgNS('radialGradient', { id: id, gradientUnits: 'userSpaceOnUse', cx: m.g.cx, cy: m.g.cy, r: 1, gradientTransform: 'translate(' + m.g.cx + ' ' + m.g.cy + ') scale(' + m.g.rx + ' ' + m.g.ry + ') translate(' + (-m.g.cx) + ' ' + (-m.g.cy) + ')' }); grad.appendChild(svgNS('stop', { offset: 0, 'stop-color': '#d33', 'stop-opacity': m.inv ? 0 : .45 })); grad.appendChild(svgNS('stop', { offset: Math.max(0, 1 - m.g.f), 'stop-color': '#d33', 'stop-opacity': m.inv ? 0 : .45 })); grad.appendChild(svgNS('stop', { offset: 1, 'stop-color': '#d33', 'stop-opacity': m.inv ? .45 : 0 })); }
    defs.appendChild(grad); mkSvg.appendChild(defs);
    if (m.inv) { var back = svgNS('rect', { width: 1, height: 1, fill: '#d33', 'fill-opacity': .45 }); mkSvg.appendChild(back); }
    mkSvg.appendChild(svgNS('rect', { width: 1, height: 1, fill: 'url(#' + id + ')' }));
    if (m.kind === 'linear') mkSvg.appendChild(svgNS('line', { x1: m.g.x0, y1: m.g.y0, x2: m.g.x1, y2: m.g.y1, stroke: '#fff', 'stroke-width': .004, 'vector-effect': 'non-scaling-stroke' }));
    else mkSvg.appendChild(svgNS('ellipse', { cx: m.g.cx, cy: m.g.cy, rx: m.g.rx, ry: m.g.ry, fill: 'none', stroke: '#fff', 'stroke-width': .004, 'vector-effect': 'non-scaling-stroke' }));
  }
  function paintMasks() {
    if (!maskList) return; maskList.innerHTML = '';
    masks.forEach(function (m, i) {
      var d = document.createElement('div'); d.className = 'dkr-mask' + (i === cur ? ' on' : ''); d.setAttribute('data-i', i);
      d.innerHTML = '<p class="dkr-mhead"><b>' + (m.kind === 'linear' ? 'Gradient' : 'Circle') + ' ' + (i + 1) + '</b><label><input type="checkbox" data-mkinv' + (m.inv ? ' checked' : '') + '> Invert</label><button type="button" data-mkdel>Remove</button></p>';
      var body = document.createElement('div'); body.className = 'dkr-mbody'; body.appendChild(maskTpl.content.cloneNode(true)); d.appendChild(body);
      Array.prototype.forEach.call(body.querySelectorAll('[data-mk]'), function (inp) { var k = inp.getAttribute('data-mk'); inp.value = (m.adj || {})[k] || 0; inp.nextElementSibling.textContent = inp.value; inp.addEventListener('input', function () { m.adj = m.adj || {}; m.adj[k] = +inp.value; inp.nextElementSibling.textContent = inp.value; cur = i; clearTimeout(pending); pending = setTimeout(render, 450); }); inp.addEventListener('change', function () { clearTimeout(pending); pending = setTimeout(render, 60); }); });
      d.querySelector('[data-mkinv]').addEventListener('change', function (e) { m.inv = e.target.checked; cur = i; paintOverlay(); changed(false); });
      d.querySelector('[data-mkdel]').addEventListener('click', function () { masks.splice(i, 1); cur = -1; paintMasks(); paintOverlay(); changed(false); });
      d.addEventListener('click', function (e) { if (e.target.closest('input, button, label')) return; cur = i; paintMasks(); paintOverlay(); });
      maskList.appendChild(d);
    });
    if (!masks.length) maskList.innerHTML = '<p class="dkr-mnone">No masks yet.</p>';
  }
  Array.prototype.forEach.call(form.querySelectorAll('[data-dkr-mask]'), function (b) { b.addEventListener('click', function () { if (masks.length >= 4) { say.textContent = 'Four masks is plenty.'; return; } drawing = b.getAttribute('data-dkr-mask'); room.classList.add('dkr-cropping'); say.textContent = drawing === 'linear' ? 'Drag on the picture from where the light is whole to where it is gone.' : 'Drag on the picture from the centre out.'; }); });
  var mStart = null;
  fig.addEventListener('pointerdown', function (e) { if (!drawing) return; e.preventDefault(); var r = rect(); mStart = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; var m = drawing === 'linear' ? { kind: 'linear', g: { x0: mStart.x, y0: mStart.y, x1: mStart.x, y1: mStart.y }, adj: {} } : { kind: 'radial', g: { cx: mStart.x, cy: mStart.y, rx: 0.01, ry: 0.01, f: 0.5 }, adj: {} }; masks.push(m); cur = masks.length - 1; paintOverlay(); });
  fig.addEventListener('pointermove', function (e) { if (!drawing || !mStart) return; var r = rect(); var x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); var m = masks[cur]; if (!m) return; if (m.kind === 'linear') { m.g.x1 = x; m.g.y1 = y; } else { m.g.rx = Math.max(0.01, Math.abs(x - m.g.cx)); m.g.ry = Math.max(0.01, Math.abs(y - m.g.cy)); } paintOverlay(); });
  addEventListener('pointerup', function () { if (!drawing || !mStart) return; mStart = null; drawing = null; room.classList.remove('dkr-cropping'); var m = masks[cur]; if (m && m.kind === 'linear' && Math.abs(m.g.x1 - m.g.x0) < 0.01 && Math.abs(m.g.y1 - m.g.y0) < 0.01) { masks.pop(); cur = -1; paintOverlay(); say.textContent = 'Too short a drag to be a gradient.'; } else say.textContent = 'Set its sliders below; the red is where it acts.'; paintMasks(); if (cur >= 0) { var el = maskList.querySelector('.dkr-mask.on'); if (el) el.scrollIntoView({ block: 'nearest' }); } });
  addEventListener('resize', paintOverlay);
  paintMasks();
  // Saving and developing without leaving the room.
  form.addEventListener('submit', function (e) {
    var btn = e.submitter; var d = btn && btn.value ? btn.value : 'save'; if (d === 'negative') return;
    e.preventDefault(); recipe(); var fd = new FormData(form); fd.set('do', d); fd.set('json', '1'); if (!form.querySelector('input[name=bw]').checked) fd.delete('bw'); else fd.set('bw', '1');
    say.textContent = d === 'apply' ? 'Developing at full size: a minute for a large master.' : 'Saving.'; room.classList.add('dkr-busy');
    fetch(form.action, { method: 'POST', body: new URLSearchParams(fd), credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) { say.textContent = j.say || (j.ok ? 'Done.' : 'Something went wrong.'); room.classList.remove('dkr-busy'); if ((d === 'apply' || d === 'look') && j.ok) { setTimeout(function () { location.reload(); }, 800); } }).catch(function () { say.textContent = 'The house could not be reached.'; room.classList.remove('dkr-busy'); });
  });
})();
