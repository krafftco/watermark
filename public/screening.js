// The Screening Room (src/screening.js): the film plays through from the showing's elapsed time; a pause opens the
// filmmaker's note nearest the moment; no scrubbing.
(function () {
  'use strict';
  var main = document.querySelector('main.sc-room[data-screening]'); if (!main) return;
  var S; try { S = JSON.parse(main.getAttribute('data-screening')); } catch (e) { return; }
  var v = main.querySelector('.sc-video'); if (!v) return;
  var note = main.querySelector('.sc-note'), noteT = main.querySelector('.sc-note-t'), hint = main.querySelector('.sc-hint'), resume = main.querySelector('.sc-resume');
  var notes = (S.notes || []).filter(function (n) { return n.t != null; }).sort(function (a, b) { return a.t - b.t; });
  var general = (S.notes || []).filter(function (n) { return n.t == null; });
  var started = false, seeking = false;
  // The house's quiet music (7 Nov) when the file's score is not known to be free: four sines breathing, made here.
  var ctx = null, nodes = [];
  function music(on) {
    if (S.score !== 'house') return;
    if (!on) { nodes.forEach(function (n) { try { n.stop(); } catch (e) { /* */ } }); nodes = []; return; }
    if (nodes.length) return;
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume && ctx.resume(); } catch (e) { return; }
    var out = ctx.createGain(); out.gain.value = 0.0001; out.connect(ctx.destination); out.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 4);
    [196, 246.94, 293.66, 392].forEach(function (f, k) {
      var o = ctx.createOscillator(), g = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.25; l.frequency.value = 0.05 + k * 0.023; lg.gain.value = 0.22;
      l.connect(lg); lg.connect(g.gain); o.connect(g); g.connect(out); o.start(); l.start(); nodes.push(o, l);
    });
  }
  if (S.score === 'house') { v.muted = true; v.addEventListener('play', function () { music(true); }); v.addEventListener('pause', function () { music(false); }); v.addEventListener('ended', function () { music(false); }); }
  function begin() { if (started) return; started = true; if (S.elapsed > 2) { seeking = true; try { v.currentTime = S.elapsed; } catch (e) { /* */ } } v.play().catch(function () {}); if (hint) hint.hidden = true; try { if (v.requestFullscreen && matchMedia('(pointer:fine)').matches) v.requestFullscreen().catch(function () {}); } catch (e) { /* */ } }
  v.addEventListener('click', function () { if (!started) begin(); else if (v.paused) v.play(); else v.pause(); });
  main.addEventListener('click', function (e) { if (!started && !e.target.closest('a,button')) begin(); });
  document.addEventListener('keydown', function (e) { if (e.key === ' ') { e.preventDefault(); if (!started) begin(); else if (v.paused) v.play(); else v.pause(); } if (e.key === 'Escape') { if (document.fullscreenElement) document.exitFullscreen(); } });
  // No scrubbing: a seek that is not ours is undone.
  var last = 0; v.addEventListener('timeupdate', function () { last = v.currentTime; });
  v.addEventListener('seeking', function () { if (seeking) { seeking = false; return; } if (Math.abs(v.currentTime - last) > 2) { try { v.currentTime = last; } catch (e) { /* */ } } });
  function nearest(t) { var best = null; for (var i = 0; i < notes.length; i++) if (notes[i].t <= t + 1) best = notes[i]; return best || general[0] || null; }
  v.addEventListener('pause', function () { if (!started || v.ended) return; var n = nearest(v.currentTime); if (!n) return; noteT.textContent = n.text; note.hidden = false; main.classList.add('sc-paused'); });
  v.addEventListener('play', function () { note.hidden = true; main.classList.remove('sc-paused'); });
  if (resume) resume.addEventListener('click', function () { v.play(); });
  v.addEventListener('ended', function () { main.classList.add('sc-ended'); if (hint) { hint.hidden = false; hint.textContent = 'The end. Thank you for coming.'; } });
})();
