/* The Listening Room (src/listening.js): a record played through. The platter turns while it plays, the arm sits on
   the disc, each side follows the last; a tap on a track lifts the needle to it; space plays and pauses. */
(function () {
  'use strict';
  var R = window.__LR; var room = document.querySelector('[data-lr]'); if (!R || !room) return;
  var a = room.querySelector('[data-lr-audio]'), play = room.querySelector('[data-lr-play]'), title = room.querySelector('[data-lr-title]'), time = room.querySelector('[data-lr-time]'), fill = room.querySelector('[data-lr-fill]'), bar = room.querySelector('[data-lr-bar]'), tracks = room.querySelectorAll('[data-lr-track]');
  var at = 0;
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function paint() { room.classList.toggle('lr-on', !a.paused); play.setAttribute('aria-label', a.paused ? 'Play' : 'Pause'); for (var i = 0; i < tracks.length; i++) tracks[i].setAttribute('aria-current', i === at ? 'true' : 'false'); }
  function load(i, go) { at = Math.max(0, Math.min(R.tracks.length - 1, i)); a.src = R.tracks[at].url; title.textContent = R.tracks[at].title; fill.style.width = '0'; if (go) a.play().catch(function () {}); paint(); }
  play.addEventListener('click', function () { if (a.paused) a.play().catch(function () {}); else a.pause(); });
  for (var i = 0; i < tracks.length; i++) (function (k) { tracks[k].addEventListener('click', function () { load(k, true); }); })(i);
  a.addEventListener('play', paint); a.addEventListener('pause', paint);
  a.addEventListener('timeupdate', function () { if (a.duration) fill.style.width = (100 * a.currentTime / a.duration) + '%'; time.textContent = mmss(a.currentTime) + (a.duration ? ' / ' + mmss(a.duration) : ''); });
  // The end of the record: the next on the shelf is offered and, after twelve seconds, played; a tap goes at once; Esc stays.
  var nx = room.querySelector('[data-lr-next]'), nxT = null;
  function offerNext() { if (!R.next || !nx) return; nx.href = R.next.href; nx.querySelector('[data-lr-nextt]').textContent = R.next.title; nx.querySelector('[data-lr-nextby]').textContent = R.next.by || ''; nx.hidden = false; var n = 12; var c = nx.querySelector('[data-lr-count]'); c.textContent = 'in ' + n + ' s'; nxT = setInterval(function () { n--; c.textContent = n > 0 ? 'in ' + n + ' s' : ''; if (n <= 0) { clearInterval(nxT); location.href = R.next.href; } }, 1000); }
  function stayHere() { if (nxT) clearInterval(nxT); nxT = null; if (nx) nx.hidden = true; }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') stayHere(); });
  a.addEventListener('ended', function () { if (at < R.tracks.length - 1) load(at + 1, true); else { paint(); offerNext(); } });
  if (/[?&]play=1/.test(location.search)) { a.play().catch(function () {}); }
  bar.addEventListener('click', function (e) { if (!a.duration) return; var r = bar.getBoundingClientRect(); a.currentTime = a.duration * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); });
  document.addEventListener('keydown', function (e) { if (e.target.closest('input,textarea')) return; if (e.key === ' ') { e.preventDefault(); play.click(); } else if (e.key === 'ArrowRight' && e.shiftKey) load(at + 1, true); else if (e.key === 'ArrowLeft' && e.shiftKey) load(at - 1, true); });
  // The wake lock while a side plays, so the phone does not sleep on the music.
  var lock = null; a.addEventListener('play', function () { try { navigator.wakeLock && navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {}); } catch (e) {} });
  a.addEventListener('pause', function () { try { lock && lock.release(); } catch (e) {} lock = null; });
  paint();
})();
