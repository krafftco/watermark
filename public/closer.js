/* Look closer: hear the guide read aloud, paragraph by paragraph, in the best voice the device has. */
(function () {
  var b = document.querySelector('[data-say]'), box = document.querySelector('[data-say-text]');
  if (!b || !box) return;
  if (!('speechSynthesis' in window)) { b.hidden = true; return; }
  var S = window.speechSynthesis, paras = [].slice.call(box.querySelectorAll('p')), i = 0, playing = false;
  function voice() {
    var vs = S.getVoices().filter(function (v) { return /^en(-|_|$)/i.test(v.lang); });
    var pref = [/premium|enhanced|natural|neural/i, /Daniel|Serena|Kate|Oliver|Arthur/, /Samantha|Ava|Allison|Google UK English|Google US English/];
    for (var k = 0; k < pref.length; k++) { var f = vs.filter(function (v) { return pref[k].test(v.name); }); if (f.length) return f[0]; }
    return vs[0] || null;
  }
  function mark(n) { paras.forEach(function (p, k) { p.classList.toggle('lc-now', k === n && playing); }); }
  function stop() { playing = false; S.cancel(); b.classList.remove('on'); b.querySelector('span').textContent = 'Hear it'; mark(-1); }
  function next() {
    if (!playing || i >= paras.length) return stop();
    var u = new SpeechSynthesisUtterance(paras[i].textContent), v = voice();
    if (v) { u.voice = v; u.lang = v.lang; } u.rate = 0.94; u.pitch = 1;
    u.onend = function () { i++; next(); }; u.onerror = function () { stop(); };
    mark(i); S.speak(u);
  }
  b.addEventListener('click', function () {
    if (playing) return stop();
    if (window.WMVoice) window.WMVoice.stop();
    playing = true; i = 0; S.cancel(); b.classList.add('on'); b.querySelector('span').textContent = 'Stop'; next();
  });
  if (S.onvoiceschanged !== undefined) S.onvoiceschanged = function () {};
  window.addEventListener('pagehide', stop);
})();
