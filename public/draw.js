// Draw: the sheet. Layers are offscreen canvases composited onto the display canvas; a stroke is drawn on its own
// canvas and laid onto the active layer at the tool's opacity when the pen lifts, so a wash builds only where it
// overlaps itself across strokes, never within one. Pressure from the pointer where the device has it. Zoom and pan
// by two fingers, space, the hand tool or the wheel. Undo keeps the active layer's pixels before each stroke.
// The house's file (.wmd) is a JSON of layers as PNG data URLs; autosaved to the browser every ten seconds.
(function () {
  'use strict';
  var root = document.querySelector('[data-draw]'); if (!root) return;
  var $ = function (s, el) { return (el || root).querySelector(s); }, $$ = function (s, el) { return Array.prototype.slice.call((el || root).querySelectorAll(s)); };
  var stage = $('[data-dw-stage]'), paper = $('[data-dw-paper]'), view = $('[data-dw-canvas]'), live = $('[data-dw-live]'), state = $('[data-dw-state]'), titleIn = $('[data-dw-title]');
  var refIm = $('[data-dw-refim]'), refBox = $('[data-dw-ref]'), traceIm = $('[data-dw-traceim]'), grid = $('[data-dw-grid]');
  var owner = root.getAttribute('data-owner') || '', id = root.getAttribute('data-id') || '', fileUrl = root.getAttribute('data-file') || '', refSlug = root.getAttribute('data-ref') || '';
  var ar = parseFloat(root.getAttribute('data-ar')) || 1.5;
  var W = 2048, H = Math.round(W / ar); if (H > 2600) { H = 2600; W = Math.round(H * ar); }
  var layers = [], active = 0, undo = [], redo = [], dirty = false, lsKey = 'wm_draw_' + (id ? 'd' + id : refSlug ? 'r' + refSlug : 'blank');
  var T = { tool: 'pencil', size: 6, opacity: 1, color: '#111111' };
  var Z = { s: 1, x: 0, y: 0, mirror: false };

  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function newLayer(name) { return { name: name || ('Layer ' + (layers.length + 1)), c: mk(W, H), opacity: 1, visible: true }; }
  function size(w, h) { W = w; H = h; view.width = live.width = W; view.height = live.height = H; paper.style.width = W + 'px'; paper.style.height = H + 'px'; }
  function paint() {
    var g = view.getContext('2d'); g.clearRect(0, 0, W, H);
    layers.forEach(function (L) { if (!L.visible) return; g.globalAlpha = L.opacity; g.drawImage(L.c, 0, 0); });
    g.globalAlpha = 1;
  }
  function say(s, hold) { state.textContent = s; clearTimeout(say.t); if (!hold) say.t = setTimeout(function () { if (state.textContent === s) state.textContent = ''; }, 2600); }

  // The view: fit, zoom, pan, mirror.
  function fit() { var r = stage.getBoundingClientRect(); var s = Math.min((r.width - 24) / W, (r.height - 24) / H); Z.s = Math.max(0.02, s); Z.x = (r.width - W * Z.s) / 2; Z.y = (r.height - H * Z.s) / 2; apply(); }
  function apply() { paper.style.transform = 'translate(' + Z.x + 'px,' + Z.y + 'px) scale(' + (Z.mirror ? -Z.s : Z.s) + ',' + Z.s + ')' + (Z.mirror ? ' translateX(-100%)' : ''); }
  function zoomAt(f, cx, cy) { var ns = Math.min(16, Math.max(0.02, Z.s * f)); var r = stage.getBoundingClientRect(); var px = cx - r.left, py = cy - r.top; Z.x = px - (px - Z.x) * (ns / Z.s); Z.y = py - (py - Z.y) * (ns / Z.s); Z.s = ns; apply(); }
  function toPaper(cx, cy) { var r = stage.getBoundingClientRect(); var x = (cx - r.left - Z.x) / Z.s, y = (cy - r.top - Z.y) / Z.s; if (Z.mirror) x = W - x; return { x: x, y: y }; }

  // The stroke.
  var S = { on: false, pts: [], last: null, pid: null };
  var sc = live.getContext('2d');
  function brush() {
    var t = T.tool;
    return { hard: t === 'pencil' || t === 'ink' || t === 'eraser', soft: t === 'brush' || t === 'wash', pressure: t !== 'wash', grain: t === 'pencil', widen: t === 'ink' ? 1.6 : t === 'pencil' ? 1.2 : 1, spacing: t === 'wash' ? 0.35 : 0.22 };
  }
  function dab(g, x, y, r, a, b) {
    if (r < 0.25) r = 0.25;
    if (b.soft) { var gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgba(T.color, a)); gr.addColorStop(0.55, rgba(T.color, a * 0.55)); gr.addColorStop(1, rgba(T.color, 0)); g.fillStyle = gr; }
    else g.fillStyle = rgba(T.tool === 'eraser' ? '#000000' : T.color, a);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (b.grain && r > 1.2) { g.fillStyle = rgba(T.color, a * 0.35); for (var i = 0; i < 3; i++) { var q = Math.random() * Math.PI * 2, d = Math.random() * r; g.beginPath(); g.arc(x + Math.cos(q) * d, y + Math.sin(q) * d, Math.max(0.3, r * 0.22), 0, Math.PI * 2); g.fill(); } }
  }
  function rgba(hex, a) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) || ['', '11', '11', '11']; return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + Math.max(0, Math.min(1, a)) + ')'; }
  function segment(g, a, bpt, b) {
    var dx = bpt.x - a.x, dy = bpt.y - a.y, dist = Math.hypot(dx, dy), step = Math.max(0.6, T.size * b.spacing); var n = Math.max(1, Math.ceil(dist / step));
    for (var i = 1; i <= n; i++) { var t = i / n, p = a.p + (bpt.p - a.p) * t; var r = radius(p, b); var alpha = b.hard ? (T.tool === 'pencil' ? 0.35 + 0.65 * p : 1) : 0.9 * (b.pressure ? 0.4 + 0.6 * p : 1); dab(g, a.x + dx * t, a.y + dy * t, r, alpha, b); }
  }
  function radius(p, b) { var base = T.size / 2; if (!b.pressure) return base; return base * (0.35 + 0.65 * p) * (p > 0.6 ? 1 + (b.widen - 1) * (p - 0.6) / 0.4 : 1); }
  function begin(e) {
    if (T.tool === 'hand') return;
    var L = layers[active]; if (!L || !L.visible) { say('That layer is hidden.'); return; }
    S.on = true; S.pid = e.pointerId; S.pts = []; pushUndo();
    sc.clearRect(0, 0, W, H); sc.globalCompositeOperation = 'source-over';
    live.style.opacity = T.tool === 'eraser' ? 0 : T.opacity; live.style.mixBlendMode = 'normal';
    if (T.tool === 'eraser') { var g = L.c.getContext('2d'); g.save(); g.globalCompositeOperation = 'destination-out'; S.eg = g; }
    var p = toPaper(e.clientX, e.clientY); p.p = pressure(e); S.last = p; S.start = p; var b = brush();
    dab(S.eg || sc, p.x, p.y, radius(p.p, b), b.hard ? 1 : 0.9, b); if (S.eg) paint();
  }
  function move(e) {
    if (!S.on || e.pointerId !== S.pid) return;
    var pts = (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]); var b = brush();
    pts.forEach(function (ev) { var p = toPaper(ev.clientX, ev.clientY); p.p = pressure(ev); if (e.shiftKey && S.start) { var dx = p.x - S.start.x, dy = p.y - S.start.y; if (Math.abs(dx) > Math.abs(dy)) p.y = S.start.y; else p.x = S.start.x; } var lp = S.last; if (lp) { var mid = { x: (lp.x + p.x) / 2, y: (lp.y + p.y) / 2, p: (lp.p + p.p) / 2 }; segment(S.eg || sc, lp, mid, b); segment(S.eg || sc, mid, p, b); } S.last = p; });
    if (S.eg) paint();
  }
  function end(e) {
    if (!S.on || (e && e.pointerId !== S.pid)) return; S.on = false;
    var L = layers[active];
    if (S.eg) { S.eg.restore(); S.eg = null; }
    else { var g = L.c.getContext('2d'); g.globalAlpha = T.opacity; g.drawImage(live, 0, 0); g.globalAlpha = 1; sc.clearRect(0, 0, W, H); live.style.opacity = 1; }
    paint(); dirty = true; redo = []; say(''); clearTimeout(end.t); end.t = setTimeout(listLayers, 400);
  }
  function pressure(e) { if (e.pointerType === 'pen' && typeof e.pressure === 'number' && e.pressure > 0) return e.pressure; if (e.pointerType === 'touch' && e.pressure > 0 && e.pressure !== 0.5) return e.pressure; return 0.75; }

  // Undo keeps the active layer's pixels.
  function pushUndo() { var L = layers[active]; var c = mk(W, H); c.getContext('2d').drawImage(L.c, 0, 0); undo.push({ i: active, c: c }); if (undo.length > 30) undo.shift(); }
  function doUndo() { var u = undo.pop(); if (!u) return say('Nothing to undo.'); var L = layers[u.i]; if (!L) return; var c = mk(W, H); c.getContext('2d').drawImage(L.c, 0, 0); redo.push({ i: u.i, c: c }); L.c = u.c; active = u.i; paint(); listLayers(); dirty = true; }
  function doRedo() { var u = redo.pop(); if (!u) return say('Nothing to redo.'); var L = layers[u.i]; if (!L) return; var c = mk(W, H); c.getContext('2d').drawImage(L.c, 0, 0); undo.push({ i: u.i, c: c }); L.c = u.c; active = u.i; paint(); listLayers(); dirty = true; }

  // Pointers: one draws, two pinch, space or the hand pans.
  var fingers = {}, pinch = null, pan = null, space = false;
  function cap(e) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ } }
  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    fingers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var n = Object.keys(fingers).length;
    if (n === 2) { if (S.on) { S.on = false; var L = layers[active]; if (S.eg) { S.eg.restore(); S.eg = null; } sc.clearRect(0, 0, W, H); live.style.opacity = 1; if (undo.length) { var u = undo.pop(); L.c = u.c; } paint(); } var k = Object.keys(fingers); var a = fingers[k[0]], b = fingers[k[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, s: Z.s, x: Z.x, y: Z.y }; return; }
    if (n > 2) return;
    if (space || T.tool === 'hand' || e.button === 1) { pan = { x: e.clientX, y: e.clientY, zx: Z.x, zy: Z.y }; cap(e); return; }
    cap(e); begin(e);
  });
  stage.addEventListener('pointerdown', function () { if (root.classList.contains('dw-lay') && small()) root.classList.remove('dw-lay'); }, true);
  stage.addEventListener('pointermove', function (e) {
    if (fingers[e.pointerId]) fingers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (pinch) { var k = Object.keys(fingers); if (k.length < 2) return; var a = fingers[k[0]], b = fingers[k[1]]; var d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2; var ns = Math.min(16, Math.max(0.02, pinch.s * d / pinch.d)); var r = stage.getBoundingClientRect(); var px = pinch.cx - r.left, py = pinch.cy - r.top; Z.x = px - (px - pinch.x) * (ns / pinch.s) + (cx - pinch.cx); Z.y = py - (py - pinch.y) * (ns / pinch.s) + (cy - pinch.cy); Z.s = ns; apply(); return; }
    if (pan) { Z.x = pan.zx + (e.clientX - pan.x); Z.y = pan.zy + (e.clientY - pan.y); apply(); return; }
    move(e);
  });
  function up(e) { delete fingers[e.pointerId]; if (pinch && Object.keys(fingers).length < 2) pinch = null; if (pan) { pan = null; return; } end(e); }
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up); stage.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') end(e); });
  stage.addEventListener('wheel', function (e) { e.preventDefault(); if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2 && !e.shiftKey) zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY); else { Z.x -= e.deltaX; Z.y -= e.deltaY; apply(); } }, { passive: false });
  stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });

  // Tools.
  function setTool(k) { T.tool = k; $$('[data-dw-tool]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dw-tool') === k ? 'true' : 'false'); }); root.setAttribute('data-tool', k); var d = { pencil: 3, ink: 5, brush: 24, wash: 90, eraser: 30 }[k]; if (d && !setTool.touched[k]) { setSize(d); } var op = { wash: 35 }[k] || (k === 'hand' ? null : 100); if (op && !setTool.touched['op' + k]) setOpacity(op); }
  setTool.touched = {};
  function setSize(n) { T.size = Math.max(1, Math.min(200, n)); $('[data-dw-size]').value = T.size; $('[data-dw-sizeo]').textContent = T.size; }
  $$('[data-dw-tool]').forEach(function (b) { b.addEventListener('click', function () { setTool(b.getAttribute('data-dw-tool')); }); });
  $('[data-dw-size]').addEventListener('input', function (e) { setTool.touched[T.tool] = true; setSize(+e.target.value); });
  function setOpacity(n) { T.opacity = n / 100; $('[data-dw-opacity]').value = n; $('[data-dw-opo]').textContent = n; }
  $('[data-dw-opacity]').addEventListener('input', function (e) { setTool.touched['op' + T.tool] = true; setOpacity(+e.target.value); });
  function setColor(c) { T.color = c; $$('[data-dw-color]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dw-color') === c ? 'true' : 'false'); }); $('[data-dw-picker]').value = c; }
  $$('[data-dw-color]').forEach(function (b) { b.addEventListener('click', function () { setColor(b.getAttribute('data-dw-color')); }); });
  $('[data-dw-picker]').addEventListener('input', function (e) { setColor(e.target.value); });

  // Layers.
  var icons = {}; $$('template[data-dw-ic]').forEach(function (t) { icons[t.getAttribute('data-dw-ic')] = t.innerHTML; });
  var list = $('[data-dw-layerlist]'), lop = $('[data-dw-lop]');
  function listLayers() {
    list.innerHTML = '';
    for (var i = layers.length - 1; i >= 0; i--) {
      var L = layers[i]; var li = document.createElement('li'); li.className = (i === active ? 'on' : '') + (L.visible ? '' : ' off'); li.setAttribute('data-i', i);
      var th = mk(56, Math.round(56 * H / W)); th.getContext('2d').drawImage(L.c, 0, 0, th.width, th.height);
      li.appendChild(th); var nm = document.createElement('span'); nm.textContent = L.name; li.appendChild(nm);
      var eye = document.createElement('button'); eye.type = 'button'; eye.className = 'dw-leye'; eye.innerHTML = icons.eye || '·'; eye.title = L.visible ? 'Hide the layer' : 'Show the layer'; eye.setAttribute('data-eye', i); li.appendChild(eye);
      list.appendChild(li);
    }
    lop.value = Math.round((layers[active] ? layers[active].opacity : 1) * 100);
  }
  list.addEventListener('click', function (e) { var eye = e.target.closest('[data-eye]'); if (eye) { var L = layers[+eye.getAttribute('data-eye')]; L.visible = !L.visible; paint(); listLayers(); dirty = true; return; } var li = e.target.closest('li[data-i]'); if (li) { active = +li.getAttribute('data-i'); listLayers(); } });
  list.addEventListener('dblclick', function (e) { var li = e.target.closest('li[data-i]'); if (!li) return; var L = layers[+li.getAttribute('data-i')]; var inp = document.createElement('input'); inp.value = L.name; inp.maxLength = 40; li.querySelector('span').replaceWith(inp); inp.focus(); inp.select(); var done = function () { L.name = inp.value.trim() || L.name; listLayers(); dirty = true; }; inp.addEventListener('blur', done); inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') inp.blur(); }); });
  lop.addEventListener('input', function (e) { if (layers[active]) { layers[active].opacity = (+e.target.value) / 100; paint(); dirty = true; } });
  function addLayer() { if (layers.length >= 24) return say('Twenty-four layers is plenty.'); layers.splice(active + 1, 0, newLayer()); active = active + 1; listLayers(); paint(); dirty = true; }
  function delLayer() { if (layers.length <= 1) { pushUndo(); layers[0].c.getContext('2d').clearRect(0, 0, W, H); paint(); say('The sheet is clear.'); return; } layers.splice(active, 1); active = Math.max(0, active - 1); undo = []; redo = []; listLayers(); paint(); dirty = true; }
  function moveLayer(d) { var j = active + d; if (j < 0 || j >= layers.length) return; var t = layers[active]; layers[active] = layers[j]; layers[j] = t; active = j; undo = []; redo = []; listLayers(); paint(); dirty = true; }

  // Reference and trace.
  var refOn = true, traceOn = false, rf = { grid: 0, values: false, squint: false, notan: false };
  // On a desk the reference stands beside the sheet; on a phone Reference shows the picture over the sheet (a tap on it, or Reference again, returns).
  var small = function () { return matchMedia('(max-width: 900px)').matches; };
  function setRef(on) { refOn = on; if (refBox) refBox.hidden = !on; root.classList.toggle('dw-noref', !on); root.classList.toggle('dw-refon', on && small()); var b = $('[data-dw="ref"]'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (!small()) fit(); }
  if (refBox) refBox.addEventListener('click', function (e) { if (small() && !e.target.closest('button, a')) setRef(false); });
  function setTrace(on) { traceOn = on; if (traceIm) traceIm.hidden = !on; var b = $('[data-dw="trace"]'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (on) say('Tracing: the picture under the sheet at a quarter. Learn the shapes; then draw it without.'); }
  function refFilter() { if (!refIm) return; var f = []; if (rf.values) f.push('grayscale(1)'); if (rf.squint) f.push('blur(6px)'); if (rf.notan) f.push('url(#dw-notan)'); refIm.style.filter = f.join(' '); if (traceIm) traceIm.style.filter = f.join(' '); if (grid) { grid.hidden = !rf.grid; grid.className = 'dw-grid' + (rf.grid === 2 ? ' dw-grid6' : ''); } $$('[data-dw-rf]').forEach(function (b) { var k = b.getAttribute('data-dw-rf'); b.setAttribute('aria-pressed', (k === 'grid' ? !!rf.grid : !!rf[k]) ? 'true' : 'false'); }); }
  $$('[data-dw-rf]').forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-dw-rf'); if (k === 'grid') rf.grid = (rf.grid + 1) % 3; else rf[k] = !rf[k]; refFilter(); }); });

  // Acts.
  function flatten() { var c = mk(W, H); var g = c.getContext('2d'); layers.forEach(function (L) { if (!L.visible) return; g.globalAlpha = L.opacity; g.drawImage(L.c, 0, 0); }); return c; }
  function wmd() { return JSON.stringify({ v: 1, title: titleIn.value.trim() || 'Untitled', w: W, h: H, ref: refSlug || null, layers: layers.map(function (L) { return { name: L.name, opacity: L.opacity, visible: L.visible, png: L.c.toDataURL('image/png') }; }) }); }
  function fileName(ext) { return (titleIn.value.trim() || 'Drawing').replace(/[^\w .-]+/g, '') + ext; }
  function download(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  function exportPng() { flatten().toBlob(function (b) { if (b) download(b, fileName('.png')); say('The PNG is yours.'); }, 'image/png'); }
  function exportWmd() { download(new Blob([wmd()], { type: 'application/json' }), fileName('.wmd')); say('The file is yours; it opens here again.'); }
  function load(j, keepId) {
    if (!j || !j.layers || !j.layers.length) throw new Error('Not a drawing.');
    size(j.w || W, j.h || H); layers = []; active = 0; undo = []; redo = [];
    if (j.title && !keepId) titleIn.value = j.title;
    var left = j.layers.length;
    j.layers.forEach(function (lj, i) { var L = newLayer(lj.name || ('Layer ' + (i + 1))); L.opacity = typeof lj.opacity === 'number' ? lj.opacity : 1; L.visible = lj.visible !== false; layers.push(L); var im = new Image(); im.onload = function () { L.c.getContext('2d').drawImage(im, 0, 0); if (!--left) { paint(); listLayers(); } }; im.onerror = function () { if (!--left) { paint(); listLayers(); } }; im.src = lj.png; });
    active = layers.length - 1; listLayers(); paint(); fit();
  }
  function openFile(f) {
    if (!f) return;
    if (/\.wmd$/i.test(f.name) || /json/.test(f.type)) { var r = new FileReader(); r.onload = function () { try { load(JSON.parse(r.result)); dirty = true; say('Opened.'); } catch (e) { say('Not a drawing I can open.'); } }; r.readAsText(f); return; }
    if (/^image\//.test(f.type)) { var url = URL.createObjectURL(f); var im = new Image(); im.onload = function () { var L = newLayer(f.name.replace(/\.[^.]+$/, '').slice(0, 40)); var s = Math.min(W / im.naturalWidth, H / im.naturalHeight, 1); var w = im.naturalWidth * s, h = im.naturalHeight * s; L.c.getContext('2d').drawImage(im, (W - w) / 2, (H - h) / 2, w, h); layers.splice(active + 1, 0, L); active++; listLayers(); paint(); dirty = true; URL.revokeObjectURL(url); say('Laid in as a layer.'); }; im.src = url; }
  }
  $('[data-dw-open]').addEventListener('change', function (e) { openFile(e.target.files[0]); e.target.value = ''; });
  var keeping = false;
  function keep() {
    if (!owner) { location.href = '/signin?next=' + encodeURIComponent(location.pathname + location.search); return; }
    if (keeping) return; keeping = true; say('Keeping…', true);
    var body = JSON.stringify({ id: id, title: titleIn.value.trim() || 'Untitled', wmd: wmd(), png: flatten().toDataURL('image/png') });
    fetch('/draw/save', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-watermark-drawing+json' }, body: body }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
      keeping = false; if (!x.ok) { say(x.j.error || 'Not kept.'); return; } dirty = false;
      if (!id) { id = String(x.j.id); root.setAttribute('data-id', id); history.replaceState(null, '', x.j.href); var vf = $('[data-dw-vault]'); if (!vf && root.getAttribute('data-maker')) { var f = document.createElement('form'); f.method = 'post'; f.action = '/draw/d/' + id + '/vault'; f.setAttribute('data-dw-vault', ''); f.innerHTML = '<button class="dw-vault" title="Put the drawing in the vault as a work of your own">' + (icons.check || '') + '<span>To the vault</span></button>'; $('.dw-acts').appendChild(f); } }
      say('Kept.'); try { localStorage.removeItem(lsKey); } catch (e) { /* */ }
    }).catch(function () { keeping = false; say('The house could not be reached; the drawing is still here, and in your browser.'); });
  }
  var acts = { undo: doUndo, redo: doRedo, fit: fit, png: exportPng, wmd: exportWmd, keep: keep, addlayer: addLayer, dellayer: delLayer, layerup: function () { moveLayer(1); }, layerdown: function () { moveLayer(-1); },
    mirror: function () { Z.mirror = !Z.mirror; apply(); $('[data-dw="mirror"]').setAttribute('aria-pressed', Z.mirror ? 'true' : 'false'); },
    ref: function () { setRef(!refOn); }, trace: function () { setTrace(!traceOn); }, layers: function () { root.classList.toggle('dw-lay'); var lp = $('[data-dw-layers]'), tb = $('.dw-top'); if (lp && tb) lp.style.top = tb.getBoundingClientRect().bottom + 'px'; } };
  $$('[data-dw]').forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-dw'); if (acts[k]) acts[k](); }); });
  var vf = $('[data-dw-vault]'); if (vf) vf.addEventListener('submit', function (e) { if (dirty) { e.preventDefault(); say('Keep it first, so the vault takes what you see.'); } });

  // Keys.
  document.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range') { if (e.key === 'Escape') e.target.blur(); return; }
    var meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); keep(); return; }
    if (meta && e.key.toLowerCase() === 'l') { e.preventDefault(); addLayer(); return; }
    if (meta) return;
    if (e.key === ' ') { if (!space) { space = true; root.classList.add('dw-space'); } e.preventDefault(); return; }
    var k = e.key.toLowerCase();
    var tools = { p: 'pencil', i: 'ink', b: 'brush', w: 'wash', e: 'eraser', h: 'hand' };
    if (tools[k] && !e.shiftKey) { setTool(tools[k]); return; }
    if (k === '[') setSize(Math.round(T.size > 10 ? T.size / 1.25 : T.size - 1)); else if (k === ']') setSize(Math.round(T.size > 10 ? T.size * 1.25 : T.size + 1));
    else if (k === '0') fit(); else if (k === '+' || k === '=') zoomAt(1.25, innerWidth / 2, innerHeight / 2); else if (k === '-') zoomAt(0.8, innerWidth / 2, innerHeight / 2);
    else if (k === 'm') acts.mirror(); else if (k === 'r' && refBox) setRef(!refOn); else if (k === 't' && e.shiftKey && traceIm) setTrace(!traceOn);
    else if (k === 'g' && refIm) { rf.grid = (rf.grid + 1) % 3; refFilter(); } else if (k === 'v' && refIm) { rf.values = !rf.values; refFilter(); } else if (k === 's' && refIm) { rf.squint = !rf.squint; refFilter(); } else if (k === 'n' && refIm) { rf.notan = !rf.notan; refFilter(); }
    else if (e.key === 'Escape') { var back = $('.dw-back'); if (back && !dirty) location.href = back.href; else say(dirty ? 'Unsaved: Keep it, or take the file, before you leave.' : ''); }
    else return;
    e.preventDefault();
  });
  document.addEventListener('keyup', function (e) { if (e.key === ' ') { space = false; root.classList.remove('dw-space'); } });
  titleIn.addEventListener('input', function () { dirty = true; });
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) { var ro = new ResizeObserver(function () { if (!S.on && !pinch) fit(); }); ro.observe(stage); }
  window.addEventListener('load', function () { requestAnimationFrame(fit); });
  window.addEventListener('beforeunload', function (e) { if (dirty) { autosave(); if (!owner) return; e.preventDefault(); e.returnValue = ''; } });

  // Autosave to the browser every ten seconds; the house's copy by Keep.
  function autosave() { if (!dirty) return; try { localStorage.setItem(lsKey, wmd()); } catch (e) { /* too large, or private */ } }
  setInterval(autosave, 10000);
  document.addEventListener('visibilitychange', function () { if (document.hidden) autosave(); });

  // Begin: the kept file, else the browser's copy, else a blank sheet.
  size(W, H);
  function blank() { layers = [newLayer('Paper')]; active = 0; listLayers(); paint(); fit(); }
  function fromLocal() { try { var s = localStorage.getItem(lsKey); if (s) { load(JSON.parse(s), true); say('Where you left off, from this browser. Keep it to hold it under your name.'); return true; } } catch (e) { /* */ } return false; }
  if (fileUrl) fetch(fileUrl, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) { load(j, true); }).catch(function () { if (!fromLocal()) blank(); });
  else if (!fromLocal()) blank();
  setTool('pencil'); setColor('#111111'); refFilter(); if (refBox && small()) setRef(false);
  if (navigator.wakeLock) { navigator.wakeLock.request('screen').catch(function () {}); }
  window.__WMDraw = { layers: function () { return layers; }, wmd: wmd, load: load, T: T, Z: Z, setTool: setTool };
})();
