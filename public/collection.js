/* The collection: search, rooms, two views, and a full-screen viewer.
   Every photograph is one click from filling the screen; arrow keys, swipe or the edges move through
   whatever is showing; Esc returns you where you were. #slug in the address opens a photograph directly. */
(function () {
  var W = window.__WM || [], bySlug = {};
  // ---------- search: forgiving, ranked, every field ----------
  // Accents and case don't matter, a typo is forgiven, short forms are understood, titles rank first.
  function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['\u2019`]s\b/g, '').replace(/['\u2019`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  var SYN = { nyc: 'new york', ny: 'new york', manhattan: 'new york', la: 'los angeles', sf: 'san francisco', dc: 'washington', uk: 'united kingdom', england: 'united kingdom', britain: 'united kingdom', usa: 'united states', us: 'united states', america: 'united states', italia: 'italy', firenze: 'florence', roma: 'rome', venezia: 'venice', milano: 'milan', munchen: 'munich', koln: 'cologne', bw: 'black and white', mono: 'black and white', duomo: 'dome', church: 'cathedral' };
  var ROOMT = {}; [].forEach.call(document.querySelectorAll('#cxRooms button[data-r]'), function (b) { if (b.dataset.r) ROOMT[b.dataset.r] = b.textContent; });
  W.forEach(function (w, i) {
    w.i = i; bySlug[w.s] = w;
    w.F = [[norm(w.t), 6], [norm(w.mk), 5], [norm(w.p), 4], [norm((w.m || []).map(function (r) { return ROOMT[r] || r; }).join(' ')), 3], [norm(w.a), 3], [norm(w.d && w.d.slice(0, 4)), 2], [norm(w.k), 2], [norm(w.cp), 1], [norm(w.c), 1]];
  });
  function lev(a, b, max) { if (Math.abs(a.length - b.length) > max) return max + 1; var p = [], i, j; for (j = 0; j <= b.length; j++) p[j] = j; for (i = 1; i <= a.length; i++) { var c = [i], lo = i; for (j = 1; j <= b.length; j++) { c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (c[j] < lo) lo = c[j]; } if (lo > max) return max + 1; p = c; } return p[b.length]; }
  function termScore(w, t) {
    var alt = SYN[t], best = 0;
    for (var k = 0; k < w.F.length; k++) {
      var f = w.F[k][0], wt = w.F[k][1]; if (!f) continue;
      var sc = 0;
      if (alt && f.indexOf(alt) > -1) sc = wt * 2;
      else if ((' ' + f + ' ').indexOf(' ' + t + ' ') > -1) sc = wt * 3;
      else if ((' ' + f).indexOf(' ' + t) > -1) sc = wt * 2;
      else if (t.length > 2 && f.indexOf(t) > -1) sc = wt;
      else if (t.length >= 5) { var ws = f.split(' '), mx = t.length >= 8 ? 2 : 1; for (var x = 0; x < ws.length; x++) if (ws[x].length >= 4 && lev(ws[x], t, mx) <= mx) { sc = wt * 0.5; break; } }
      if (sc > best) best = sc;
    }
    return best;
  }
  function search(qs) {
    var terms = norm(qs).split(' ').filter(Boolean); if (!terms.length) return null;
    var out = [];
    W.forEach(function (w) { var s = 0; for (var i = 0; i < terms.length; i++) { var x = termScore(w, terms[i]); if (!x) return; s += x; } out.push([s, w]); });
    out.sort(function (a, b) { return b[0] - a[0] || a[1].i - b[1].i; });
    return out.map(function (x) { return x[1]; });
  }
  window.__wmSearch = search;
  var $ = function (id) { return document.getElementById(id); };
  var cx = $('cx'), flat = $('cxFlat'), q = $('cxQ'), n = $('cxN'), roomsEl = $('cxRooms');
  var state = { q: '', room: '', maker: '', view: 'plates' };
  try { var u0 = new URLSearchParams(location.search); if (u0.get('q')) state.q = u0.get('q'); if (u0.get('maker')) state.maker = u0.get('maker'); } catch (e) {}
  try { var sv = JSON.parse(sessionStorage.getItem('wm-cx') || '{}'); if (sv.view) state.view = sv.view; } catch (e) {}
  // In the rooms view the viewer walks the photographs in the order they hang.
  var domOrder = [], seenS = {};
  [].forEach.call(document.querySelectorAll('#cx a[data-s]'), function (a) { if (!seenS[a.dataset.s] && bySlug[a.dataset.s]) { seenS[a.dataset.s] = 1; domOrder.push(bySlug[a.dataset.s]); } });
  var showing = domOrder.length ? domOrder : W.slice();
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var SP = window.__WM_SHARE;
  function plate(w) { return '<a class="pl" href="/w/' + w.s + '" data-s="' + w.s + '" style="--r:' + w.r + '"><img src="/img/' + w.s + '/thumb" alt="' + esc(w.t) + '" loading="lazy" decoding="async" draggable="false"><span class="pc"><b>' + esc(w.t) + '</b><i>' + esc([w.mk, w.p].filter(Boolean).join(', ')) + '</i></span>' + (SP && !w.x ? '<span class="pb" data-buy role="button" tabindex="0" aria-label="Collect">' + ((w.kk ? window.__WM_MARK : window.__WM_WAVE) || 'K') + '<i class="seal-r"></i></span>' : '') + '</a>'; }
  // One tap, like Buy Now: straight to Apple Pay / card, the file on screen the moment it clears.
  function buy(slug) { var f = document.createElement('form'); f.method = 'post'; f.action = '/buy/' + slug; var i = document.createElement('input'); i.type = 'hidden'; i.name = 'use'; i.value = 'social'; f.appendChild(i); document.body.appendChild(f); f.submit(); }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-buy]'); if (!b) return; e.preventDefault(); e.stopPropagation(); var sl = b.closest('[data-s]').dataset.s; b.classList.add('is-going'); setTimeout(function () { location.href = '/w/' + sl + '?have=1#have'; }, 220); }, true);
  document.addEventListener('keydown', function (e) { var b = e.target.closest && e.target.closest('[data-buy]'); if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); b.click(); } }, true);
  function row(w) { return '<a class="ix" href="/w/' + w.s + '" data-s="' + w.s + '"><span class="ix-t"><img src="/img/' + w.s + '/thumb" alt="" loading="lazy" draggable="false"></span><span class="ix-a">' + esc(w.a) + '</span><span class="ix-n">' + esc(w.t) + '<small>' + esc(w.mk || '') + '</small></span><span class="ix-p">' + esc(w.p) + '</span><span class="ix-c">' + esc(w.c) + '</span><span class="ix-d">' + esc(w.d) + '</span><span class="ix-z">' + (w.w ? w.w + ' × ' + w.h : '') + '</span></a>'; }
  function render() {
    var found = search(state.q), terms = found ? [1] : [];
    showing = (found || W).filter(function (w) { return (!state.room || w.m.indexOf(state.room) > -1) && (!state.maker || w.ms === state.maker); });
    try { var u = new URL(location.href); state.q ? u.searchParams.set('q', state.q) : u.searchParams.delete('q'); state.maker ? u.searchParams.set('maker', state.maker) : u.searchParams.delete('maker'); history.replaceState(null, '', u.pathname + u.search + location.hash); } catch (e) {}
    n.hidden = showing.length === W.length; n.textContent = showing.length + ' of ' + W.length;
    var grouped = !terms.length && !state.room && !state.maker && state.view === 'plates';
    cx.hidden = !grouped; flat.hidden = grouped;
    if (!grouped) {
      flat.className = 'cx-flat v-' + state.view;
      flat.innerHTML = showing.length ? (state.view === 'index' ? '<div class="ix ix-h"><span></span><span>Accession</span><span>Title &middot; Maker</span><span>Place</span><span>Camera</span><span>Taken</span><span>Pixels</span></div>' + showing.map(row).join('') : '<div class="plates">' + showing.map(plate).join('') + '</div>') : '<p class="empty">Nothing matches &ldquo;' + esc(state.q) + '&rdquo; yet. Try a place, a maker, a year, or <a href="#" data-wander>wander</a>.</p>';
    } else showing = domOrder;
    [].forEach.call(document.querySelectorAll('.cx-view button'), function (b) { b.setAttribute('aria-pressed', b.dataset.v === state.view); });
    [].forEach.call(roomsEl.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', b.dataset.r === state.room); });
    [].forEach.call(document.querySelectorAll('#cxMakers button'), function (b) { b.setAttribute('aria-pressed', b.dataset.mk === state.maker); });
    try { sessionStorage.setItem('wm-cx', JSON.stringify({ view: state.view })); } catch (e) {}
  }
  var t; q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { state.q = q.value.trim(); render(); }, 90); });
  roomsEl.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.room = b.dataset.r; render(); var y = (state.room && !state.q ? flat : cx).getBoundingClientRect().top + scrollY - $('cxBar').offsetHeight - 8; if (scrollY > y) window.scrollTo({ top: y, behavior: 'smooth' }); var sel = roomsEl.querySelector('[aria-pressed=true]'); if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); });
  document.querySelector('.cx-view').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b || !b.dataset.v) return; state.view = b.dataset.v; render(); });
  document.addEventListener('keydown', function (e) { if (e.key === '/' && document.activeElement !== q && lb.hidden) { e.preventDefault(); q.focus(); } });
  // Enter opens the best match full screen; Esc clears.
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); state.q = q.value.trim(); render(); if (showing[0]) open(showing[0].s, q); }
    if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; state.q = ''; render(); }
  });
  var mkEl = $('cxMakers'); if (mkEl) mkEl.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.maker = b.dataset.mk; render(); });
  if (state.q) q.value = state.q;
  if (state.view !== 'plates' || state.q || state.maker) render();

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
    $('lbM').textContent = [w.mk, w.p, w.d, w.c, w.a].filter(Boolean).join('  ·  ');
    $('lbPos').textContent = (cur + 1) + ' / ' + list.length;
    var vo = $('lbVo'); if (vo) { vo.hidden = !w.v; vo.classList.remove('on'); vo.style.setProperty('--p', '0%'); vo.onclick = function () {
      if (vo.dataset.src && vo.dataset.for === w.s) return window.WMVoice && window.WMVoice.play(vo.dataset.src, vo);
      fetch('/api/voices/' + w.s).then(function (r) { return r.json(); }).then(function (j) { var a = (j.voices || []).find(function (x) { return x.audio; }); if (!a) return; vo.dataset.src = a.audio; vo.dataset.for = w.s; $('lbM').textContent = (a.speaker || a.kind) + (a.role ? ', ' + a.role : '') + '  ·  ' + $('lbM').textContent; window.WMVoice && window.WMVoice.play(a.audio, vo); });
    }; if (window.WMVoice) window.WMVoice.stop(); }
    $('lbRec').href = '/w/' + w.s; $('lbLic').href = '/license/' + w.s; if ($('lbShare')) { $('lbShare').hidden = !!w.x; $('lbShare').action = '/buy/' + w.s; $('lbShare').dataset.amount = w.$ || ''; }
    [cur - 1, cur + 1].forEach(function (j) { var x = list[(j + list.length) % list.length]; if (x) { var p = new Image(); p.src = '/img/' + x.s + (window.innerWidth * (window.devicePixelRatio || 1) > 1700 ? '/large' : '/screen'); } });
    history.replaceState(null, '', '#' + w.s);
  }
  function step(d) { cur = (cur + d + list.length) % list.length; show(); wake(); }
  // ---------- wander: get lost in the collection ----------
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  function wander(from) { var pool = shuffle(showing.length && showing !== domOrder ? showing : W); if (!pool.length) return; showing = pool; open(pool[0].s, from); }
  document.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('[data-wander]'); if (!a) return; e.preventDefault(); wander(a); });
  if (/[?&]wander=1/.test(location.search)) setTimeout(function () { wander(); }, 300);
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
