/* The Listening Room (src/listening.js). A record played through: the platter turns while it plays, the arm sits on
   the disc, each side follows the last with the next already loaded; a tap on a track lifts the needle to it; space
   plays and pauses. The phone's own controls and lock screen show the record (Media Session); Best plays the lossless
   file when the record has one; Wander with it puts the house's pictures on the wall while it plays; the room dims when
   you are still. */
(function () {
  'use strict';
  var R = window.__LR; var room = document.querySelector('[data-lr]'); if (!R || !room) return;
  var a = room.querySelector('[data-lr-audio]'), play = room.querySelector('[data-lr-play]'), play2 = room.querySelector('[data-lr-play2]'), title = room.querySelector('[data-lr-title]'), time = room.querySelector('[data-lr-time]'), fill = room.querySelector('[data-lr-fill]'), bar = room.querySelector('[data-lr-bar]'), tracks = room.querySelectorAll('[data-lr-track]'), minitr = room.querySelector('[data-lr-minitr]');
  var at = 0, pre = null;
  var canFlac = !!(a.canPlayType && (a.canPlayType('audio/flac') || a.canPlayType('audio/x-flac')));
  var fi = 'light'; try { fi = localStorage.getItem('wm_lr_fi') || 'light'; } catch (e) {}
  var hasFlac = R.tracks.some(function (t) { return t.flac; });
  function urlOf(t) { return (fi === 'best' && canFlac && t.flac) ? t.flac : t.url; }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function paint() { room.classList.toggle('lr-on', !a.paused); play.setAttribute('aria-label', a.paused ? 'Play' : 'Pause'); for (var i = 0; i < tracks.length; i++) tracks[i].setAttribute('aria-current', i === at ? 'true' : 'false'); var fb = room.querySelector('[data-lr-fi]'); if (fb) { fb.setAttribute('aria-pressed', fi === 'best' ? 'true' : 'false'); fb.querySelector('[data-lr-fit]').textContent = fi === 'best' ? (hasFlac && canFlac ? 'Best · lossless' : 'Best') : 'Light'; fb.hidden = !hasFlac; } if (minitr) minitr.textContent = R.tracks[at].title; session(); }
  function load(i, go, keepTime) { at = Math.max(0, Math.min(R.tracks.length - 1, i)); var t0 = keepTime ? a.currentTime : 0; a.src = urlOf(R.tracks[at]); if (t0) { a.addEventListener('loadedmetadata', function once() { a.removeEventListener('loadedmetadata', once); try { a.currentTime = t0; } catch (e) {} }); } title.textContent = R.tracks[at].title; fill.style.width = '0'; if (go) a.play().catch(function () {}); paint(); warm(); }
  // The next side is loaded while this one plays, so the gap between them is the needle's, not the network's.
  function warm() { var n = R.tracks[at + 1]; if (!n) { pre = null; return; } try { pre = new Audio(); pre.preload = 'auto'; pre.src = urlOf(n); } catch (e) { pre = null; } }
  function toggle() { if (a.paused) a.play().catch(function () {}); else a.pause(); }
  play.addEventListener('click', toggle); if (play2) play2.addEventListener('click', toggle);
  for (var i = 0; i < tracks.length; i++) (function (k) { tracks[k].addEventListener('click', function () { load(k, true); }); })(i);
  a.addEventListener('play', paint); a.addEventListener('pause', paint);
  a.addEventListener('timeupdate', function () { if (a.duration) fill.style.width = (100 * a.currentTime / a.duration) + '%'; time.textContent = mmss(a.currentTime) + (a.duration ? ' / ' + mmss(a.duration) : ''); if ('mediaSession' in navigator && a.duration) { try { navigator.mediaSession.setPositionState({ duration: a.duration, playbackRate: a.playbackRate, position: a.currentTime }); } catch (e) {} } });
  bar.addEventListener('click', function (e) { if (!a.duration) return; var r = bar.getBoundingClientRect(); a.currentTime = a.duration * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); });
  // Fidelity.
  var fb = room.querySelector('[data-lr-fi]'); if (fb) fb.addEventListener('click', function () { fi = fi === 'best' ? 'light' : 'best'; try { localStorage.setItem('wm_lr_fi', fi); } catch (e) {} var was = !a.paused; load(at, was, true); });
  // The end of the record: the next on the shelf is offered and, after twelve seconds, played; a tap goes at once; Esc stays.
  var nx = room.querySelector('[data-lr-next]'), nxT = null;
  function offerNext() { if (!R.next || !nx) return; nx.href = R.next.href; nx.querySelector('[data-lr-nextt]').textContent = R.next.title; nx.querySelector('[data-lr-nextby]').textContent = R.next.by || ''; nx.hidden = false; var n = 12; var c = nx.querySelector('[data-lr-count]'); c.textContent = 'in ' + n + ' s'; nxT = setInterval(function () { n--; c.textContent = n > 0 ? 'in ' + n + ' s' : ''; if (n <= 0) { clearInterval(nxT); location.href = R.next.href; } }, 1000); }
  function stayHere() { if (nxT) clearInterval(nxT); nxT = null; if (nx) nx.hidden = true; }
  a.addEventListener('ended', function () { if (at < R.tracks.length - 1) load(at + 1, true); else { paint(); offerNext(); } });
  // The phone's own controls: the record on the lock screen, next and previous, a seek.
  function session() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: R.tracks[at].title, artist: R.by || '', album: R.title + ' · The Listening Room, Watermark', artwork: R.cover ? [{ src: R.cover, sizes: '512x512', type: 'image/jpeg' }] : [] });
      navigator.mediaSession.setActionHandler('play', function () { a.play().catch(function () {}); });
      navigator.mediaSession.setActionHandler('pause', function () { a.pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', at > 0 ? function () { load(at - 1, true); } : null);
      navigator.mediaSession.setActionHandler('nexttrack', at < R.tracks.length - 1 ? function () { load(at + 1, true); } : null);
      navigator.mediaSession.setActionHandler('seekto', function (d) { if (d.seekTime != null) a.currentTime = d.seekTime; });
      navigator.mediaSession.setActionHandler('seekbackward', function (d) { a.currentTime = Math.max(0, a.currentTime - (d.seekOffset || 10)); });
      navigator.mediaSession.setActionHandler('seekforward', function (d) { a.currentTime = Math.min(a.duration || 0, a.currentTime + (d.seekOffset || 10)); });
    } catch (e) { /* no session */ }
  }
  // Wander with it: the house's pictures on the wall while the record plays; a small bar keeps the controls.
  var wall = room.querySelector('[data-lr-wall]'), wb = room.querySelector('[data-lr-wander]'), wx = room.querySelector('[data-lr-wallx]');
  function openWall() { if (!wall) return; if (!wall.querySelector('iframe')) { var f = document.createElement('iframe'); f.src = R.wander || '/wander'; f.title = 'Wander'; f.setAttribute('allow', 'fullscreen'); wall.insertBefore(f, wall.firstChild); } wall.hidden = false; room.classList.add('lr-walled'); if (a.paused) a.play().catch(function () {}); }
  function closeWall() { if (!wall) return; wall.hidden = true; room.classList.remove('lr-walled'); }
  if (wb) wb.addEventListener('click', openWall); if (wx) wx.addEventListener('click', closeWall);
  // Still: after eight seconds without a movement the words dim and the record is what is left; any movement returns them.
  var stillT = null; function wake() { room.classList.remove('lr-still'); clearTimeout(stillT); stillT = setTimeout(function () { if (!a.paused) room.classList.add('lr-still'); }, 8000); }
  ['mousemove', 'touchstart', 'keydown', 'click'].forEach(function (ev) { addEventListener(ev, wake, { passive: true }); }); wake(); a.addEventListener('play', wake); a.addEventListener('pause', function () { room.classList.remove('lr-still'); });
  document.addEventListener('keydown', function (e) { if (e.target.closest('input,textarea')) return; if (e.key === ' ') { e.preventDefault(); toggle(); } else if (e.key === 'ArrowRight' && e.shiftKey) load(at + 1, true); else if (e.key === 'ArrowLeft' && e.shiftKey) load(at - 1, true); else if (e.key === 'Escape') { if (wall && !wall.hidden) closeWall(); else stayHere(); } else if (e.key === 'w' || e.key === 'W') openWall(); });
  // The wake lock while a side plays, so the phone does not sleep on the music.
  var lock = null; a.addEventListener('play', function () { try { navigator.wakeLock && navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {}); } catch (e) {} });
  a.addEventListener('pause', function () { try { lock && lock.release(); } catch (e) {} lock = null; });
  if (/[?&]play=1/.test(location.search)) { a.play().catch(function () {}); }
  load(0, false); paint();
})();
