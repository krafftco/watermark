/* Look closer: hear the guide read aloud. The house voice first (a recording made once, served from the house);
   the browser's own voice only when there is no recording yet. Paragraphs light as they are read. */
(function () {
  var b = document.querySelector('[data-say]'), box = document.querySelector('[data-say-text]');
  if (!b || !box) return;
  var S = window.speechSynthesis, paras = [].slice.call(box.querySelectorAll('p')), i = 0, playing = false, audio = null, tick = null;
  var src = b.getAttribute('data-say-audio');
  if (!S && !src) { b.hidden = true; return; }
  function voice() {
    if (!S) return null;
    var vs = S.getVoices().filter(function (v) { return /^en(-|_|$)/i.test(v.lang); });
    var pref = [/premium|enhanced|natural|neural/i, /Daniel|Serena|Kate|Oliver|Arthur/, /Samantha|Ava|Allison|Google UK English|Google US English/];
    for (var k = 0; k < pref.length; k++) { var f = vs.filter(function (v) { return pref[k].test(v.name); }); if (f.length) return f[0]; }
    return vs[0] || null;
  }
  function mark(n) { paras.forEach(function (p, k) { p.classList.toggle('lc-now', k === n && playing); }); }
  function stop() {
    playing = false; if (S) S.cancel(); if (audio) { audio.pause(); audio.currentTime = 0; } clearInterval(tick);
    b.classList.remove('on'); b.querySelector('span').textContent = 'Hear it'; mark(-1);
  }
  // Browser voice, paragraph by paragraph.
  function nextSpoken() {
    if (!playing || i >= paras.length) return stop();
    var u = new SpeechSynthesisUtterance(paras[i].textContent), v = voice();
    if (v) { u.voice = v; u.lang = v.lang; } u.rate = 0.94; u.pitch = 1;
    u.onend = function () { i++; nextSpoken(); }; u.onerror = function () { stop(); };
    mark(i); S.speak(u);
  }
  // The recording: paragraphs light in proportion to their length as the audio plays.
  function playRecording() {
    if (!audio) { audio = new Audio(src); audio.preload = 'auto'; }
    var total = paras.reduce(function (n, p) { return n + p.textContent.length; }, 0) || 1;
    var ends = [], acc = 0; paras.forEach(function (p) { acc += p.textContent.length; ends.push(acc / total); });
    audio.onended = stop; audio.onerror = function () { if (S) { audio = null; playing = true; i = 0; nextSpoken(); } else stop(); };
    var p = audio.play();
    if (p && p.catch) p.catch(function () { if (S) { audio = null; i = 0; nextSpoken(); } else stop(); });
    tick = setInterval(function () { if (!audio || !audio.duration) return; var f = audio.currentTime / audio.duration; var n = 0; while (n < ends.length - 1 && f > ends[n]) n++; mark(n); }, 250);
  }
  b.addEventListener('click', function () {
    if (playing) return stop();
    if (window.WMVoice) window.WMVoice.stop();
    playing = true; i = 0; if (S) S.cancel(); b.classList.add('on'); b.querySelector('span').textContent = 'Stop';
    if (src) playRecording(); else nextSpoken();
  });
  // Warm the recording while the visitor reads, so the first tap is instant.
  if (src) { (window.requestIdleCallback || function (f) { setTimeout(f, 2500); })(function () { try { audio = new Audio(src); audio.preload = 'auto'; } catch (e) {} }); }
  if (S && S.onvoiceschanged !== undefined) S.onvoiceschanged = function () {};
  window.addEventListener('pagehide', stop);
})();
