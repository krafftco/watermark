/* The collection: search, rooms, two views, and a full-screen viewer.
   Every photograph is one click from filling the screen; arrow keys, swipe or the edges move through
   whatever is showing; Esc returns you where you were. #slug in the address opens a photograph directly. */
(function () {
  var W = window.__WM || [], bySlug = {};
  W.forEach(function (w, i) { w.i = i; bySlug[w.s] = w; w.q = (w.t + ' ' + w.p + ' ' + w.c + ' ' + w.a + ' ' + w.k + ' ' + w.d).toLowerCase(); });
  var $ = function (id) { return document.getElementById(id); };
  var cx = $('cx'), flat = $('cxFlat'), q = $('cxQ'), n = $('cxN'), roomsEl = $('cxRooms');
  var state = { q: '', room: '', view: 'plates' };
  try { var sv = JSON.parse(sessionStorage.getItem('wm-cx') || '{}'); if (sv.view) state.view = sv.view; } catch (e) {}
  // In the rooms view the viewer walks the photographs in the order they hang.
  var domOrder = [], seenS = {};
  [].forEach.call(document.querySelectorAll('#cx a[data-s]'), function (a) { if (!seenS[a.dataset.s] && bySlug[a.dataset.s]) { seenS[a.dataset.s] = 1; domOrder.push(bySlug[a.dataset.s]); } });
  var showing = domOrder.length ? domOrder : W.slice();
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function plate(w) { return '<a class="pl" href="/w/' + w.s + '" data-s="' + w.s + '" style="--r:' + w.r + '"><img src="/img/' + w.s + '/thumb" alt="' + esc(w.t) + '" loading="lazy" decoding="async" draggable="false"><span class="pc"><b>' + esc(w.t) + '</b>' + (w.p ? '<i>' + esc(w.p) + '</i>' : '') + '</span></a>'; }
  function row(w) { return '<a class="ix" href="/w/' + w.s + '" data-s="' + w.s + '"><span class="ix-t"><img src="/img/' + w.s + '/thumb" alt="" loading="lazy" draggable="false"></span><span class="ix-a">' + esc(w.a) + '</span><span class="ix-n">' + esc(w.t) + '</span><span class="ix-p">' + esc(w.p) + '</span><span class="ix-c">' + esc(w.c) + '</span><span class="ix-d">' + esc(w.d) + '</span><span class="ix-z">' + (w.w ? w.w + ' × ' + w.h : '') + '</span></a>'; }
  function render() {
    var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    showing = W.filter(function (w) { return (!state.room || w.m.indexOf(state.room) > -1) && terms.every(function (t) { return w.q.indexOf(t) > -1; }); });
    n.hidden = showing.length === W.length; n.textContent = showing.length + ' of ' + W.length;
    var grouped = !terms.length && !state.room && state.view === 'plates';
    cx.hidden = !grouped; flat.hidden = grouped;
    if (!grouped) {
      flat.className = 'cx-flat v-' + state.view;
      flat.innerHTML = showing.length ? (state.view === 'index' ? '<div class="ix ix-h"><span></span><span>Accession</span><span>Title</span><span>Place</span><span>Camera</span><span>Taken</span><span>Pixels</span></div>' + showing.map(row).join('') : '<div class="plates">' + showing.map(plate).join('') + '</div>') : '<p class="empty">Nothing matches. Try a place or a camera.</p>';
    } else showing = domOrder;
    [].forEach.call(document.querySelectorAll('.cx-view button'), function (b) { b.setAttribute('aria-pressed', b.dataset.v === state.view); });
    [].forEach.call(roomsEl.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', b.dataset.r === state.room); });
    try { sessionStorage.setItem('wm-cx', JSON.stringify({ view: state.view })); } catch (e) {}
  }
  var t; q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { state.q = q.value.trim(); render(); }, 90); });
  roomsEl.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.room = b.dataset.r; render(); var y = (state.room && !state.q ? flat : cx).getBoundingClientRect().top + scrollY - $('cxBar').offsetHeight - 8; if (scrollY > y) window.scrollTo({ top: y, behavior: 'smooth' }); var sel = roomsEl.querySelector('[aria-pressed=true]'); if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); });
  document.querySelector('.cx-view').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.view = b.dataset.v; render(); });
  document.addEventListener('keydown', function (e) { if (e.key === '/' && document.activeElement !== q && lb.hidden) { e.preventDefault(); q.focus(); } });
  if (state.view !== 'plates') render();

  // ---------- the viewer ----------
  var lb = $('lb'), img = $('lbImg'), lo = $('lbLo'), cur = -1, list = W, idle, lastFocus;
  function open(slug, from) {
    var w = bySlug[slug]; if (!w) return;
    list = showing.indexOf(w) > -1 ? showing : W; cur = list.indexOf(w);
    lastFocus = from || document.activeElement;
    lb.hidden = false; document.documentElement.classList.add('lb-on');
    show(); if (location.hash !== '#' + slug) history.replaceState(null, '', '#' + slug);
    $('lbX').focus({ preventScroll: true }); wake();
  }
  function show() {
    var w = list[cur]; if (!w) return;
    lo.src = '/img/' + w.s + '/thumb'; lo.style.opacity = ''; img.classList.remove('in'); img.alt = w.t;
    var big = new Image(); big.decoding = 'async';
    big.onload = function () { if (list[cur] === w) { img.src = big.src; img.classList.add('in'); setTimeout(function () { if (list[cur] === w) lo.style.opacity = '0'; }, 700); } };
    big.src = '/img/' + w.s + (window.innerWidth * (window.devicePixelRatio || 1) > 1700 ? '/large' : '/screen');
    $('lbT').textContent = w.t;
    $('lbM').textContent = [w.p, w.d, w.c, w.a].filter(Boolean).join('  ·  ');
    $('lbPos').textContent = (cur + 1) + ' / ' + list.length;
    $('lbRec').href = '/w/' + w.s; $('lbLic').href = '/license/' + w.s;
    [cur - 1, cur + 1].forEach(function (j) { var x = list[(j + list.length) % list.length]; if (x) { var p = new Image(); p.src = '/img/' + x.s + (window.innerWidth * (window.devicePixelRatio || 1) > 1700 ? '/large' : '/screen'); } });
    history.replaceState(null, '', '#' + w.s);
  }
  function step(d) { cur = (cur + d + list.length) % list.length; show(); wake(); }
  function close() {
    lb.hidden = true; document.documentElement.classList.remove('lb-on'); img.removeAttribute('src');
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    history.replaceState(null, '', location.pathname + location.search);
    var w = list[cur], el = w && document.querySelector('[data-s="' + w.s + '"]:not([hidden] *)');
    if (el) { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); } else if (lastFocus) lastFocus.focus({ preventScroll: true });
  }
  function wake() { lb.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(function () { lb.classList.add('idle'); }, 2600); }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-s]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault(); open(a.dataset.s, a);
  });
  $('lbX').onclick = close; $('lbPrev').onclick = function () { step(-1); }; $('lbNext').onclick = function () { step(1); };
  $('lbFs').onclick = function () { if (document.fullscreenElement) document.exitFullscreen(); else if (lb.requestFullscreen) lb.requestFullscreen().catch(function () {}); };
  document.addEventListener('fullscreenchange', function () { $('lbFs').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });
  $('lbStage').addEventListener('click', function (e) { if (e.target === this) close(); });
  lb.addEventListener('mousemove', wake);
  lb.addEventListener('contextmenu', function (e) { if (e.target.tagName === 'IMG') e.preventDefault(); });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape' && !document.fullscreenElement) close();
    else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'f') $('lbFs').click();
    else if (e.key === 'i') lb.classList.toggle('bare');
    else if (e.key === 'Enter' && document.activeElement === $('lbX')) close();
    else wake();
  });
  var x0 = null, y0 = 0;
  lb.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  lb.addEventListener('touchend', function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1); else if (dy > 90) close(); else wake(); });
  function fromHash() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (h && bySlug[h]) { if (lb.hidden || list[cur] !== bySlug[h]) open(h); }
    else if (/^room-/.test(h)) { var r = h.slice(5); if (roomsEl.querySelector('[data-r="' + r + '"]')) { if (!lb.hidden) close(); state.room = r; render(); } }
  }
  window.addEventListener('hashchange', fromHash); fromHash();
})();
