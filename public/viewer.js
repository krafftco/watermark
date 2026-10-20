// Watermark viewer: the photograph lifts from where it hangs into a dark room of its own. Honour, not locks.
// Nothing is laid over the picture. The plate rises and recedes as in the viewing room; the deck holds the walk
// (before · next), the hat, hang it, collect and the guide read aloud; zoom is real.
(function () {
  var plate = document.querySelector('[data-viewer]');
  if (!plate) return;
  var G = window.__WM_GUARD || {}, K = window.__WM_WALK || null, S = window.speechSynthesis;
  var hasHat = !!document.querySelector('.ap-b'), hasHang = !!document.querySelector('.hg-open'), guideBox = document.querySelector('[data-say-text]'), buyForm = document.querySelector('form.share-buy');
  var ic = function (n) { var t = document.querySelector('template[data-ic="' + n + '"]'); return t ? t.innerHTML : ''; };
  var box = document.createElement('div');
  box.className = 'wv';
  box.innerHTML =
    '<div class="wv-vig"></div>' +
    '<div class="wv-top"><span class="wv-t"></span><span class="wv-ctl">' +
      (guideBox && S ? '<button type="button" class="wv-b" data-guide aria-pressed="false">' + ic('guide') + '<span>Guide</span></button>' : '') +
      '<button type="button" class="wv-b" data-z="out" aria-label="Smaller">&minus;</button><button type="button" class="wv-b" data-z="in" aria-label="Closer">+</button>' +
      '<button type="button" class="wv-b wv-x" data-close>' + ic('close') + '<span>Close</span></button></span></div>' +
    '<aside class="wv-guide" hidden><div class="wv-gt"></div></aside>' +
    '<div class="wv-plate"><b class="wv-pt"></b><span class="wv-pc"></span><span class="wv-pw"></span></div>' +
    '<div class="wv-deck">' +
      (K ? '<button type="button" class="wv-b" data-walk="prev">' + ic('back') + '<span>Before</span></button>' : '') +
      (hasHat ? '<button type="button" class="wv-b" data-hat aria-pressed="false">' + ic('hat') + '<span>Hat</span></button>' : '') +
      (hasHang ? '<button type="button" class="wv-b" data-hang>' + ic('hang') + '<span>Hang it</span></button>' : '') +
      (buyForm ? '<button type="button" class="wv-b wv-buy" data-buy>' + ic('collect') + '<span>Collect' + (G.price ? ', ' + G.price : '') + '</span></button>' : G.collect ? '<a class="wv-b wv-buy" href="' + G.collect + '">' + ic('collect') + '<span>Collect' + (G.price ? ', ' + G.price : '') + '</span></a>' : '') +
      (K ? '<button type="button" class="wv-b" data-walk="next"><span>Next</span>' + ic('next') + '</button>' : '') +
    '</div>';
  var img = new Image(); img.alt = ''; img.draggable = false; box.appendChild(img);
  document.body.appendChild(box);
  box.querySelector('.wv-t').textContent = plate.dataset.title;
  box.querySelector('.wv-pt').textContent = plate.dataset.title;
  box.querySelector('.wv-pc').textContent = plate.dataset.credit + (plate.dataset.place ? ' · ' + plate.dataset.place : '');
  if (K) box.querySelector('.wv-pw').textContent = K.label + ' · ' + K.i + ' of ' + K.n;
  var s = 1, fit = 1, x = 0, y = 0, idle, label;
  function apply() { img.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')'; }
  function center() {
    var W = innerWidth, H = innerHeight, w = img.naturalWidth || 1, h = img.naturalHeight || 1;
    // On a computer the photograph keeps a margin of the dark around it, so a tall one is never clipped by the
    // screen's edge, a notch or a rounded corner; on a phone it fills the screen.
    var m = matchMedia('(pointer:fine)').matches ? 0.92 : 1;
    fit = Math.min(W * m / w, H * m / h); s = fit; x = -w * s / 2; y = -h * s / 2; apply();
  }
  // Into and out of the browser's full screen, or a window resized: set it again if it was at rest.
  function refit() { if (box.classList.contains('on') && !lifting && Math.abs(s - fit) < 1e-6) center(); }
  addEventListener('resize', refit); document.addEventListener('fullscreenchange', function () { setTimeout(refit, 60); });
  function zoomAt(f, cx, cy) {
    var ns = Math.max(fit, Math.min(fit * 8, s * f));
    var ox = cx - innerWidth / 2, oy = cy - innerHeight / 2;
    x = ox - (ox - x) * (ns / s); y = oy - (oy - y) * (ns / s); s = ns; apply();
  }
  function wake() { box.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(function () { box.classList.add('idle'); }, 2600); }
  // The plate rises, holds a moment, recedes; a touch or a movement brings it back.
  function showPlate(hold) { box.classList.add('labeled'); clearTimeout(label); label = setTimeout(function () { box.classList.remove('labeled'); }, hold || 4000); }
  // Seamless: the photograph lifts off the page from where it hangs, settles full screen, and returns the same way.
  var pageImg = plate.querySelector('img'), lifting = false;
  function rectOf() { var r = (pageImg || plate).getBoundingClientRect(); if (pageImg && pageImg.naturalWidth) { var ar = pageImg.naturalWidth / pageImg.naturalHeight, bw = r.width, bh = r.height; if (bw / bh > ar) { var w2 = bh * ar; return { left: r.left + (bw - w2) / 2, top: r.top, width: w2, height: bh }; } var h2 = bw / ar; return { left: r.left, top: r.top + (bh - h2) / 2, width: bw, height: h2 }; } return r; }
  function fromRect(r) { var w = img.naturalWidth || 1; s = r.width / w; x = r.left - innerWidth / 2; y = r.top - innerHeight / 2; apply(); }
  function open() {
    if (lifting) return; lifting = true;
    var r = rectOf();
    if (!img.src) { img.src = (pageImg && pageImg.currentSrc) || plate.dataset.full; }
    box.classList.add('on'); document.documentElement.style.overflow = 'hidden';
    var go = function () {
      img.style.transition = 'none'; fromRect(r); void img.offsetWidth;
      img.style.transition = 'transform .72s cubic-bezier(.2,.7,.2,1)'; center(); box.classList.add('lit');
      setTimeout(function () { img.style.transition = ''; lifting = false; showPlate(4400); if (plate.dataset.full && /\/large$/.test(plate.dataset.full) && Math.max(screen.width, screen.height) * (devicePixelRatio || 1) > 2400) plate.dataset.full = plate.dataset.full.replace(/\/large$/, '/wall'); // (20 Oct) the wall copy for screens with more pixels than large
        if (plate.dataset.full && img.getAttribute('src') !== plate.dataset.full) { var full = new Image(); full.onload = function () { var ratio = full.naturalWidth / (img.naturalWidth || 1); s = s / ratio; img.src = plate.dataset.full; apply(); fit = fit / ratio; }; full.src = plate.dataset.full; } }, 740);
      if (box.requestFullscreen && matchMedia('(pointer:fine)').matches) box.requestFullscreen().catch(function () {});
      wake();
    };
    if (img.complete && img.naturalWidth) go(); else img.onload = go;
  }
  function close() {
    if (lifting) return; lifting = true; stopGuide();
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    box.classList.remove('lit', 'labeled');
    setTimeout(function () { var r = rectOf(); img.style.transition = 'transform .56s cubic-bezier(.2,.7,.2,1)'; fromRect(r);
      setTimeout(function () { box.classList.remove('on'); document.documentElement.style.overflow = ''; img.style.transition = ''; lifting = false; }, 580); }, document.fullscreenElement ? 120 : 0);
  }
  // The walk: the next photograph opens already lifted.
  function walkTo(d) { if (!K || !K[d]) return; box.classList.remove('lit'); setTimeout(function () { location.href = K[d].href + '?open=1'; }, 180); }
  // The guide, read aloud in the room (the page's own reader does the speaking).
  var sayBtn = document.querySelector('[data-say]'), gBtn = box.querySelector('[data-guide]'), gBox = box.querySelector('.wv-guide');
  function stopGuide() { if (gBtn && gBtn.getAttribute('aria-pressed') === 'true') { gBtn.setAttribute('aria-pressed', 'false'); gBox.hidden = true; if (sayBtn && sayBtn.classList.contains('on')) sayBtn.click(); } }
  if (gBtn) { gBox.querySelector('.wv-gt').innerHTML = guideBox.innerHTML; gBtn.addEventListener('click', function () { var on = gBtn.getAttribute('aria-pressed') === 'true'; if (on) return stopGuide(); gBtn.setAttribute('aria-pressed', 'true'); gBox.hidden = false; if (sayBtn && !sayBtn.classList.contains('on')) sayBtn.click(); }); }
  // The hat and the hang: the page's own buttons do the work; the viewer shows the state.
  var hatBtn = box.querySelector('[data-hat]'), pageHat = document.querySelector('.ap-b');
  function syncHat() { if (hatBtn && pageHat) hatBtn.setAttribute('aria-pressed', pageHat.classList.contains('on') ? 'true' : 'false'); }
  if (hatBtn) { syncHat(); hatBtn.addEventListener('click', function () { pageHat.click(); setTimeout(syncHat, 300); setTimeout(syncHat, 1200); hatBtn.classList.add('tip'); setTimeout(function () { hatBtn.classList.remove('tip'); }, 700); }); }
  var hangBtn = box.querySelector('[data-hang]');
  if (hangBtn) hangBtn.addEventListener('click', function () { var b = document.querySelector('.hg-open'); if (b) b.click(); });
  plate.addEventListener('click', open);
  box.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); wake(); }, { passive: false });
  box.addEventListener('dblclick', function (e) { if (e.target.closest('.wv-b,.wv-guide')) return; zoomAt(s > fit * 1.5 ? fit / s : 2.5, e.clientX, e.clientY); });
  var drag = null, pts = {}, pinch = null, moved = false;
  box.addEventListener('pointerdown', function (e) { if (e.target.closest('.wv-b,.wv-guide,.wv-plate')) return; pts[e.pointerId] = e; box.setPointerCapture(e.pointerId); drag = { x: e.clientX - x, y: e.clientY - y }; moved = false; wake(); });
  box.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') wake();
    if (!pts[e.pointerId]) return; pts[e.pointerId] = e;
    var ids = Object.keys(pts);
    if (ids.length === 2) {
      var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch) zoomAt(d / pinch, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      pinch = d; return;
    }
    if (drag && s > fit) { x = e.clientX - drag.x; y = e.clientY - drag.y; apply(); moved = true; }
  });
  function up(e) { var tap = drag && !moved && !pinch && e.pointerType !== 'mouse'; delete pts[e.pointerId]; pinch = null; drag = null; if (tap) { showPlate(4000); wake(); } }
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-close')) close(); else if (b.hasAttribute('data-buy')) { var sb = buyForm.querySelector('button[type=submit],button:not([type])'); if (sb) sb.click(); else buyForm.requestSubmit(); } else if (b.dataset.walk) walkTo(b.dataset.walk); else if (b.dataset.z) zoomAt(b.dataset.z === 'in' ? 1.4 : 1 / 1.4, innerWidth / 2, innerHeight / 2);
  });
  document.addEventListener('keydown', function (e) {
    if (!box.classList.contains('on')) return;
    if (e.key === 'Escape') close();
    if (e.key === '+' || e.key === '=') zoomAt(1.4, innerWidth / 2, innerHeight / 2);
    if (e.key === '-') zoomAt(1 / 1.4, innerWidth / 2, innerHeight / 2);
    if (e.key === '0') center();
    if (e.key === 'ArrowRight' && K) { e.stopImmediatePropagation(); walkTo('next'); }
    if (e.key === 'ArrowLeft' && K) { e.stopImmediatePropagation(); walkTo('prev'); }
    if ((e.key === 'h' || e.key === 'H') && hatBtn) hatBtn.click();
    if ((e.key === 'g' || e.key === 'G') && gBtn) gBtn.click();
    if ((e.key === 's' || e.key === 'S') && hangBtn) hangBtn.click();
    if ((e.key === 'c' || e.key === 'C') && box.querySelector('[data-buy]')) box.querySelector('[data-buy]').click();
  }, true);
  addEventListener('resize', function () { if (box.classList.contains('on')) center(); });
  // Courtesy protection: the original never reaches the browser; these stop casual saving of the screen copy.
  document.addEventListener('contextmenu', function (e) { if (e.target.closest('.plate,.wv,.cf,.lic-fig')) e.preventDefault(); });
  document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && /^[sp]$/i.test(e.key)) e.preventDefault(); });
})();
