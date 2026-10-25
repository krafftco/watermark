/* The Listening Room as one room (src/listening.js). Will, 24 Oct: "a Spotify-like experience": the music never stops
   when you move. The shelf, each record and the queue are views of one document; the player is a bar at the foot that
   stays; the address follows. A record plays whole, side after side, and the next record on the shelf follows, as a
   radio does; 'Play the shelf' lines them all up. The platter turns while its record plays; a tap on a side lifts the
   needle to it; space plays and pauses. The phone's lock screen shows the record (Media Session); Best plays the
   lossless file when the record has one; Wander with it puts the house's pictures on the wall while it plays; the room
   dims when you are still. Nothing here is logged or sent anywhere: a count of plays on the house's own record only. */
(function () {
  'use strict';
  var D = window.__LRA; var room = document.querySelector('[data-lr-app]'); if (!D || !room) return;
  var a = room.querySelector('[data-lr-audio]'); if (!a) return;
  var byslug = {}; D.records.forEach(function (r) { byslug[r.slug] = r; });
  var order = []; D.groups.forEach(function (g) { g.records.forEach(function (s) { if (byslug[s] && order.indexOf(s) < 0) order.push(s); }); });
  D.records.forEach(function (r) { if (order.indexOf(r.slug) < 0) order.push(r.slug); });
  var $ = function (q, el) { return (el || room).querySelector(q); };
  var ic = function (k) { var t = $('template[data-lr-ic="' + k + '"]'); return t ? t.innerHTML : ''; };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  // The queue: records in order; a pointer to the record and the side playing.
  var Q = { list: [], i: -1, t: 0 }; var pre = null;
  var canFlac = !!(a.canPlayType && (a.canPlayType('audio/flac') || a.canPlayType('audio/x-flac')));
  var fi = 'light'; try { fi = localStorage.getItem('wm_lr_fi') || 'light'; } catch (e) {}
  function cur() { return Q.i >= 0 ? byslug[Q.list[Q.i]] : null; }
  function track() { var r = cur(); return r ? r.tracks[Q.t] : null; }
  function urlOf(t) { return (fi === 'best' && canFlac && t.flac) ? t.flac : t.url; }
  function fromShelf(slug) { var i = order.indexOf(slug); if (i < 0) return [slug].concat(order); return order.slice(i).concat(order.slice(0, i)); }

  var bar = $('[data-lr-bar]'), barimg = $('[data-lr-barimg]'), barsl = $('[data-lr-barsl]'), bart = $('[data-lr-bart]'), barby = $('[data-lr-barby]'), time = $('[data-lr-time]'), fill = $('[data-lr-fill]'), prog = $('[data-lr-bar2prog]');
  var minib = $('[data-lr-minib]'), minitr = $('[data-lr-minitr]');
  function playBtns() { return room.querySelectorAll('[data-lr-play],[data-lr-play2]'); }

  function paint() {
    var r = cur(), t = track(); var on = !a.paused && !!t;
    room.classList.toggle('lr-going', on);
    var ps = playBtns(); for (var i = 0; i < ps.length; i++) ps[i].setAttribute('aria-label', a.paused ? 'Play' : 'Pause');
    if (r) {
      bar.hidden = false; room.classList.add('lr-playing');
      bart.textContent = r.title; barby.textContent = t ? (t.title + (r.by ? ' · ' + r.by : '')) : r.by;
      if (r.cover) { barimg.src = r.cover; barimg.hidden = false; barsl.hidden = true; } else { barimg.hidden = true; barsl.hidden = false; barsl.textContent = r.title; }
      if (minib) minib.textContent = r.title; if (minitr && t) minitr.textContent = t.title;
    }
    // The record view, when it shows the record that is playing: the platter turns, the side is marked.
    var rv = $('[data-lr-view="record"]'); if (rv) { var same = rv.getAttribute('data-lr-slug') === (r && r.slug); rv.classList.toggle('lr-on', on && same); var tr = rv.querySelectorAll('[data-lr-track]'); for (var k = 0; k < tr.length; k++) tr[k].setAttribute('aria-current', same && k === Q.t ? 'true' : 'false'); var pb = rv.querySelector('[data-lr-playrec]'); if (pb) { pb.querySelector('span').textContent = same && on ? 'Pause' : (same && t ? 'Resume' : 'Play it through'); pb.classList.toggle('lr-paused', same && on); } }
    var cards = room.querySelectorAll('[data-lr-open]'); for (var c = 0; c < cards.length; c++) cards[c].classList.toggle('lr-now', !!r && cards[c].getAttribute('data-lr-open') === r.slug && on);
    var fb = $('[data-lr-fi]'); if (fb) { var hasFlac = r && r.tracks.some(function (x) { return x.flac; }); fb.setAttribute('aria-pressed', fi === 'best' ? 'true' : 'false'); fb.querySelector('[data-lr-fit]').textContent = fi === 'best' ? (hasFlac && canFlac ? 'Best · lossless' : 'Best') : 'Light'; fb.hidden = !hasFlac; }
    paintQueue(); session();
  }
  function load(go, keepTime) {
    var t = track(); if (!t) return; var t0 = keepTime ? a.currentTime : 0; a.src = urlOf(t);
    if (t0) { a.addEventListener('loadedmetadata', function once() { a.removeEventListener('loadedmetadata', once); try { a.currentTime = t0; } catch (e) {} }); }
    if (fill) fill.style.width = '0'; if (go) a.play().catch(function () {}); paint(); warm();
  }
  // The next side is loaded while this one plays (the next record's first side at the end of a record), so the gap is the needle's, not the network's.
  function nextPos() { var r = cur(); if (!r) return null; if (Q.t < r.tracks.length - 1) return { i: Q.i, t: Q.t + 1 }; if (Q.i < Q.list.length - 1) return { i: Q.i + 1, t: 0 }; return null; }
  function warm() { var n = nextPos(); if (!n) { pre = null; return; } try { pre = new Audio(); pre.preload = 'auto'; pre.src = urlOf(byslug[Q.list[n.i]].tracks[n.t]); } catch (e) { pre = null; } }
  function startQueue(list, i, t, go) { Q.list = list.filter(function (s) { return byslug[s] && byslug[s].tracks.length; }); Q.i = Math.max(0, Math.min(Q.list.length - 1, i || 0)); Q.t = t || 0; if (!Q.list.length) return; load(go !== false); }
  function playRecord(slug, t) { var r = cur(); if (r && r.slug === slug && (t == null || t === Q.t)) { toggle(); return; } startQueue(fromShelf(slug), 0, t || 0, true); }
  function stepTrack(d) { var r = cur(); if (!r) return; var t = Q.t + d; if (t >= 0 && t < r.tracks.length) { Q.t = t; load(true); } else if (d > 0 && Q.i < Q.list.length - 1) { Q.i++; Q.t = 0; load(true); toast('Next: ' + cur().title); } else if (d < 0 && Q.i > 0) { Q.i--; Q.t = cur().tracks.length - 1; load(true); } }
  function toggle() { if (!track()) { if (order.length) startQueue(fromShelf(D.open || D.tonight || order[0]), 0, 0, true); return; } if (a.paused) a.play().catch(function () {}); else a.pause(); }

  // The end of a side: the next side; the end of a record: the next record, said in a line.
  a.addEventListener('ended', function () { var n = nextPos(); if (!n) { paint(); toast('The shelf is played through.'); return; } var newRec = n.i !== Q.i; Q.i = n.i; Q.t = n.t; load(true); if (newRec) toast('Next: ' + cur().title + (cur().by ? ' · ' + cur().by : '')); });
  a.addEventListener('play', paint); a.addEventListener('pause', paint);
  a.addEventListener('timeupdate', function () { if (a.duration && fill) fill.style.width = (100 * a.currentTime / a.duration) + '%'; if (time) time.textContent = mmss(a.currentTime) + (a.duration ? ' / ' + mmss(a.duration) : ''); if ('mediaSession' in navigator && a.duration) { try { navigator.mediaSession.setPositionState({ duration: a.duration, playbackRate: a.playbackRate, position: a.currentTime }); } catch (e) {} } });
  if (prog) prog.addEventListener('click', function (e) { if (!a.duration) return; var r = prog.getBoundingClientRect(); a.currentTime = a.duration * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); });

  // A line that comes and goes.
  var toastEl = null, toastT = null; function toast(s) { if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'lr-toast'; room.appendChild(toastEl); } toastEl.textContent = s; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 3200); }

  // The views. A record opens over the shelf without a reload; the address follows; Back returns.
  var shelfV = $('[data-lr-view="shelf"]'), toShelf = $('[data-lr-toshelf]'), home = $('.lr-home');
  function recordHtml(r) {
    var tr = r.tracks.map(function (t, i) { return '<li><button type="button" data-lr-track="' + i + '"><span class="lr-n">' + (i + 1) + '</span><span class="lr-tt">' + esc(t.title) + '</span><span class="lr-tl">' + (t.seconds ? mmss(t.seconds) : '') + '</span></button></li>'; }).join('');
    return '<section class="lr-deck"><figure class="lr-disc"><span class="lr-platter" data-lr-platter>' + (r.cover ? '<img src="' + esc(r.cover) + '" alt="">' : '<span class="lr-label"><b>' + esc(r.title) + '</b></span>') + '</span><span class="lr-arm" data-lr-arm></span></figure>' +
      '<div class="lr-side"><p class="k">' + esc(r.chosen ? 'Chosen by ' + r.chosen : 'On the turntable') + '</p><h1 data-lr-h1>' + esc(r.title) + '</h1><p class="lr-by">' + esc(r.performer || '') + (r.composer && r.composer !== r.performer ? ' · ' + esc(r.composer) : '') + (r.year ? ' · ' + esc(r.year) : '') + '</p>' + (r.line ? '<p class="lede">' + esc(r.line) + '</p>' : '') +
      '<div class="lr-fi"><button type="button" class="lr-fib lr-gold" data-lr-playrec>' + ic('play') + '<span>Play it through</span></button><button type="button" class="lr-fib" data-lr-fi aria-pressed="false"><span class="lr-fidot"></span><span data-lr-fit>Light</span></button><button type="button" class="lr-fib" data-lr-wander>' + ic('wave') + '<span>Wander with it</span></button></div>' +
      '<ol class="lr-tracks" data-lr-tracks>' + tr + '</ol></div></section>' +
      (r.body || r.why ? '<section class="lr-notes"><p class="k">The sleeve</p>' + (r.why ? '<p class="lr-why">' + esc(r.why) + '</p>' : '') + (r.body ? (r.source === 'archive' && !r.why ? '<details class="lr-arch"><summary>From the Archive’s record</summary><p>' + esc(r.body) + '</p></details>' : '<p>' + esc(r.body) + '</p>') : '') + '</section>' : '') +
      '<p class="lr-credit">' + esc(r.credit) + (r.license_url ? ' <a href="' + esc(r.license_url) + '" rel="license">The licence</a>.' : '') + (r.ia ? ' <a href="https://archive.org/details/' + esc(r.ia) + '">The record at the Archive</a>.' : '') + '</p>';
  }
  function showRecord(slug, push) {
    var r = byslug[slug]; if (!r) return false;
    var rv = $('[data-lr-view="record"]'); if (!rv) { rv = document.createElement('section'); rv.className = 'lr-recv'; rv.setAttribute('data-lr-view', 'record'); shelfV.parentNode.insertBefore(rv, shelfV.nextSibling); }
    if (rv.getAttribute('data-lr-slug') !== slug) { rv.innerHTML = recordHtml(r); rv.setAttribute('data-lr-slug', slug); wire(rv); }
    rv.hidden = false; shelfV.hidden = true; if (toShelf) toShelf.hidden = false; if (home) home.hidden = true;
    document.title = r.title + ' · The Listening Room · Watermark'; D.open = slug;
    if (push) { try { history.pushState({ lr: slug }, '', '/listening/' + encodeURIComponent(slug)); } catch (e) {} }
    scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' }); paint(); return true;
  }
  function showShelf(push) { var rv = $('[data-lr-view="record"]'); if (rv) rv.hidden = true; shelfV.hidden = false; if (toShelf) toShelf.hidden = true; if (home) home.hidden = false; document.title = 'The Listening Room · The Keys · Watermark'; D.open = null; if (push) { try { history.pushState({ lr: null }, '', '/listening'); } catch (e) {} } scrollTo({ top: 0 }); paint(); }
  function wire(rv) {
    var slug = rv.getAttribute('data-lr-slug');
    var tr = rv.querySelectorAll('[data-lr-track]'); for (var i = 0; i < tr.length; i++) (function (k) { tr[k].addEventListener('click', function () { var r = cur(); if (r && r.slug === slug) { Q.t = k; load(true); } else startQueue(fromShelf(slug), 0, k, true); }); })(i);
    var pb = rv.querySelector('[data-lr-playrec]'); if (pb) pb.addEventListener('click', function () { playRecord(slug); });
    var fb = rv.querySelector('[data-lr-fi]'); if (fb) fb.addEventListener('click', function () { fi = fi === 'best' ? 'light' : 'best'; try { localStorage.setItem('wm_lr_fi', fi); } catch (e) {} var r = cur(); if (r) { var was = !a.paused; load(was, true); } paint(); });
    var wb = rv.querySelector('[data-lr-wander]'); if (wb) wb.addEventListener('click', function () { if (!cur() || cur().slug !== slug) startQueue(fromShelf(slug), 0, 0, true); openWall(); });
  }
  var rv0 = $('[data-lr-view="record"]'); if (rv0 && D.open) { rv0.setAttribute('data-lr-slug', D.open); wire(rv0); }
  room.addEventListener('click', function (e) { var o = e.target.closest('[data-lr-open]'); if (!o) return; var slug = o.getAttribute('data-lr-open'); if (!byslug[slug]) return; e.preventDefault(); showRecord(slug, true); });
  if (toShelf) toShelf.addEventListener('click', function () { showShelf(true); });
  var pa = $('[data-lr-playall]'); if (pa) pa.addEventListener('click', function () { startQueue(fromShelf(D.tonight || order[0]), 0, 0, true); toast('The shelf, played through. ' + order.length + ' records.'); });
  var bc = $('[data-lr-barcover]'); if (bc) bc.addEventListener('click', function () { var r = cur(); if (r) { if (D.open === r.slug) return; showRecord(r.slug, true); } });
  addEventListener('popstate', function () { var m = location.pathname.match(/^\/listening\/([^/]+)/); if (m && byslug[decodeURIComponent(m[1])]) showRecord(decodeURIComponent(m[1]), false); else showShelf(false); });
  try { history.replaceState({ lr: D.open }, '', location.pathname + location.search); } catch (e) {}

  // The bar's own buttons.
  var pbs = playBtns(); for (var p = 0; p < pbs.length; p++) pbs[p].addEventListener('click', toggle);
  var pv = $('[data-lr-prev]'), nx = $('[data-lr-nexttr]'); if (pv) pv.addEventListener('click', function () { if (a.currentTime > 4) a.currentTime = 0; else stepTrack(-1); }); if (nx) nx.addEventListener('click', function () { stepTrack(1); });

  // The queue, as a sheet: what is on now, and what follows; a tap jumps.
  var qv = $('[data-lr-queuev]'), ql = $('[data-lr-queuelist]'), qb = $('[data-lr-queue]'), qx = $('[data-lr-queuex]');
  function paintQueue() { if (!ql || qv.hidden) return; var h = ''; Q.list.forEach(function (s, i) { var r = byslug[s]; if (!r) return; h += '<li' + (i === Q.i ? ' aria-current="true"' : '') + '><button type="button" data-lr-q="' + i + '">' + (r.cover ? '<img src="' + esc(r.cover) + '" alt="">' : '<span class="lr-sleeve lr-sleeve-s">' + esc(r.title) + '</span>') + '<span><b>' + esc(r.title) + '</b><i>' + esc(r.by) + (i === Q.i && track() ? ' · ' + esc(track().title) : '') + '</i></span></button></li>'; }); ql.innerHTML = h || '<li class="lr-qempty">Nothing lined up. Press play, or Play the shelf.</li>'; }
  if (qb) qb.addEventListener('click', function () { qv.hidden = !qv.hidden; paintQueue(); }); if (qx) qx.addEventListener('click', function () { qv.hidden = true; });
  if (ql) ql.addEventListener('click', function (e) { var b = e.target.closest('[data-lr-q]'); if (!b) return; Q.i = +b.getAttribute('data-lr-q'); Q.t = 0; load(true); });

  // The phone's own controls: the record on the lock screen, next and previous, a seek.
  function session() {
    if (!('mediaSession' in navigator)) return; var r = cur(), t = track(); if (!r || !t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: r.by || '', album: r.title + ' · The Listening Room, Watermark', artwork: r.cover ? [{ src: r.cover, sizes: '512x512', type: 'image/jpeg' }] : [] });
      navigator.mediaSession.setActionHandler('play', function () { a.play().catch(function () {}); });
      navigator.mediaSession.setActionHandler('pause', function () { a.pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', function () { stepTrack(-1); });
      navigator.mediaSession.setActionHandler('nexttrack', nextPos() ? function () { stepTrack(1); } : null);
      navigator.mediaSession.setActionHandler('seekto', function (d) { if (d.seekTime != null) a.currentTime = d.seekTime; });
      navigator.mediaSession.setActionHandler('seekbackward', function (d) { a.currentTime = Math.max(0, a.currentTime - (d.seekOffset || 10)); });
      navigator.mediaSession.setActionHandler('seekforward', function (d) { a.currentTime = Math.min(a.duration || 0, a.currentTime + (d.seekOffset || 10)); });
    } catch (e) { /* no session */ }
  }
  // Wander with it: the house's pictures on the wall while the record plays; a small bar keeps the controls.
  var wall = $('[data-lr-wall]'), wx = $('[data-lr-wallx]');
  function openWall() { if (!wall) return; if (!wall.querySelector('iframe')) { var f = document.createElement('iframe'); f.src = D.wander || '/wander'; f.title = 'Wander'; f.setAttribute('allow', 'fullscreen'); wall.insertBefore(f, wall.firstChild); } wall.hidden = false; room.classList.add('lr-walled'); if (a.paused && track()) a.play().catch(function () {}); }
  function closeWall() { if (!wall) return; wall.hidden = true; room.classList.remove('lr-walled'); }
  if (wx) wx.addEventListener('click', closeWall);
  // Still: after eight seconds without a movement the words dim and the record is what is left; any movement returns them.
  var stillT = null; function wake() { room.classList.remove('lr-still'); clearTimeout(stillT); stillT = setTimeout(function () { if (!a.paused && D.open) room.classList.add('lr-still'); }, 8000); }
  ['mousemove', 'touchstart', 'keydown', 'click'].forEach(function (ev) { addEventListener(ev, wake, { passive: true }); }); wake(); a.addEventListener('play', wake); a.addEventListener('pause', function () { room.classList.remove('lr-still'); });
  document.addEventListener('keydown', function (e) { if (e.target.closest('input,textarea')) return; if (e.key === ' ') { e.preventDefault(); toggle(); } else if (e.key === 'ArrowRight' && e.shiftKey) stepTrack(1); else if (e.key === 'ArrowLeft' && e.shiftKey) stepTrack(-1); else if (e.key === 'Escape') { if (wall && !wall.hidden) closeWall(); else if (qv && !qv.hidden) qv.hidden = true; else if (D.open) showShelf(true); } else if (e.key === 'w' || e.key === 'W') { if (track()) openWall(); } else if (e.key === 'q' || e.key === 'Q') { if (qv) { qv.hidden = !qv.hidden; paintQueue(); } } });
  // The wake lock while a side plays, so the phone does not sleep on the music.
  var lock = null; a.addEventListener('play', function () { try { navigator.wakeLock && navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {}); } catch (e) {} });
  a.addEventListener('pause', function () { try { lock && lock.release(); } catch (e) {} lock = null; });
  // Arriving at a record: it is set on the turntable, lined up with the shelf behind it; ?play=1 drops the needle.
  if (D.open && byslug[D.open]) startQueue(fromShelf(D.open), 0, 0, /[?&]play=1/.test(location.search));
  paint();
})();
