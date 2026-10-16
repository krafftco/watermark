// The Watermark viewer for sealed files (.wmk). The file is opened in this browser only:
// the photograph is decrypted in memory and drawn to a canvas, never saved as an image file.
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var stage = $('#sv-stage'), canvas = $('#sv-canvas'), ctx = canvas.getContext('2d');
  var bmp = null, view = { s: 1, x: 0, y: 0 };
  function say(t, sub) { $('#sv-msg').textContent = t; $('#sv-sub').textContent = sub || ''; }
  function u32(dv, o) { return dv.getUint32(o, false); }

  function parse(buf) {
    var dv = new DataView(buf), b = new Uint8Array(buf);
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'WMK1') throw new Error('This is not a Watermark sealed file.');
    var o = 4, hl = u32(dv, o); o += 4;
    var head = b.slice(o, o + hl); o += hl;
    var pl = u32(dv, o); o += 4;
    var preview = b.slice(o, o + pl); o += pl;
    var iv = b.slice(o, o + 12); o += 12;
    return { header: JSON.parse(new TextDecoder().decode(head)), head: head, preview: preview, iv: iv, body: b.slice(o) };
  }

  function fit() {
    if (!bmp) return;
    var r = stage.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    canvas.width = r.width * d; canvas.height = r.height * d;
    var s = Math.min(r.width / bmp.width, r.height / bmp.height) * 0.94;
    view = { s: s, x: (r.width - bmp.width * s) / 2, y: (r.height - bmp.height * s) / 2 };
    draw();
  }
  function draw() {
    var d = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.s * d, 0, 0, view.s * d, view.x * d, view.y * d);
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0);
  }
  function zoomAt(f, cx, cy) {
    var r = stage.getBoundingClientRect(), min = Math.min(r.width / bmp.width, r.height / bmp.height) * 0.94;
    var ns = Math.max(min, Math.min(view.s * f, 8));
    var px = cx - r.left, py = cy - r.top;
    view.x = px - (px - view.x) * (ns / view.s); view.y = py - (py - view.y) * (ns / view.s); view.s = ns; draw();
  }

  async function openBuffer(buf) {
    var p;
    try { p = parse(buf); } catch (e) { return say(e.message); }
    var h = p.header;
    $('#sv-title').textContent = h.title || 'Untitled';
    $('#sv-credit').textContent = (h.credit || '') + (h.house ? ', ' + h.house : '');
    $('#sv-terms').textContent = h.conditions ? h.conditions + '.' : '';
    $('#sv-license').href = h.license || '/';
    var pv = URL.createObjectURL(new Blob([p.preview], { type: 'image/jpeg' }));
    $('#sv-preview').src = pv; document.body.classList.add('sv-has');
    // Keys come only from this Watermark, never from an address written in a file.
    var keys = new URL(h.keys, location.href);
    if (keys.origin !== location.origin) return say('This file was sealed by another Watermark.', 'Open it there.');
    say('Asking the maker…');
    var r, j;
    try { r = await fetch(keys.pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ access: h.access, host: location.host }) }); j = await r.json(); }
    catch (e) { return say('Watermark could not be reached.', 'A sealed file needs a connection to open.'); }
    if (!j.open) { document.body.classList.add('sv-closed'); return say(j.reason || 'This file is closed.', 'You can license the photograph instead.'); }
    try {
      var raw = Uint8Array.from(atob(j.key), function (c) { return c.charCodeAt(0); });
      var key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
      var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: p.iv, additionalData: p.head, tagLength: 128 }, key, p.body);
      bmp = await createImageBitmap(new Blob([plain]));
      plain = null; raw.fill(0);
    } catch (e) { return say('This file has been altered and will not open.'); }
    document.body.classList.add('sv-open'); say('');
    URL.revokeObjectURL(pv); fit();
  }

  // Ways in: drop a file, choose one, or arrive with ?src= pointing at a file on this site.
  $('#sv-pick').addEventListener('change', function (e) { var f = e.target.files[0]; if (f) f.arrayBuffer().then(openBuffer); });
  document.addEventListener('dragover', function (e) { e.preventDefault(); document.body.classList.add('sv-drag'); });
  document.addEventListener('dragleave', function () { document.body.classList.remove('sv-drag'); });
  document.addEventListener('drop', function (e) { e.preventDefault(); document.body.classList.remove('sv-drag'); var f = e.dataTransfer.files[0]; if (f) f.arrayBuffer().then(openBuffer); });
  var src = new URLSearchParams(location.search).get('src');
  if (src) { var u = new URL(src, location.href); if (u.origin === location.origin) fetch(u).then(function (r) { return r.arrayBuffer(); }).then(openBuffer); }

  // Looking closely: wheel or pinch to zoom, drag to move, double-click to fit.
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  stage.addEventListener('wheel', function (e) { if (!bmp) return; e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  var pts = new Map(), lastD = 0;
  stage.addEventListener('pointerdown', function (e) { if (!bmp) return; stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); });
  stage.addEventListener('pointermove', function (e) {
    if (!pts.has(e.pointerId)) return;
    var prev = pts.get(e.pointerId); pts.set(e.pointerId, e);
    if (pts.size === 1) { view.x += e.clientX - prev.clientX; view.y += e.clientY - prev.clientY; draw(); }
    else if (pts.size === 2) { var a = Array.from(pts.values()), d = Math.hypot(a[0].clientX - a[1].clientX, a[0].clientY - a[1].clientY); if (lastD) zoomAt(d / lastD, (a[0].clientX + a[1].clientX) / 2, (a[0].clientY + a[1].clientY) / 2); lastD = d; }
  });
  ['pointerup', 'pointercancel'].forEach(function (t) { stage.addEventListener(t, function (e) { pts.delete(e.pointerId); lastD = 0; }); });
  stage.addEventListener('dblclick', fit);
  window.addEventListener('resize', fit);
  // Leaving the page or hiding it clears the canvas.
  document.addEventListener('visibilitychange', function () { if (document.hidden && bmp) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); } else if (bmp) draw(); });
})();
