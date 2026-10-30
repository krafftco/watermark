/* Look closer: hear the guide read aloud, in the house's voice only (a recording made once, served from the house).
   The browser's synthetic voice is never used (Will, 20 Oct: it sounds like a machine); with no recording yet the
   button stays away and the guide is read with the eyes. Paragraphs light as they are read. */
(function () {
  var b = document.querySelector('[data-say]'), box = document.querySelector('[data-say-text]');
  if (!b || !box) return;
  var S = null, paras = [].slice.call(box.querySelectorAll('p')), i = 0, playing = false, audio = null, tick = null;
  var src = b.getAttribute('data-say-audio');
  if (!src) { b.hidden = true; return; }
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
    if (!audio || audio.error) { audio = new Audio(src + (src.indexOf('?') < 0 ? '?' : '&') + 'play=1'); audio.preload = 'auto'; } // (30 Oct) a recording is made only when someone presses play
    var total = paras.reduce(function (n, p) { return n + p.textContent.length; }, 0) || 1;
    var ends = [], acc = 0; paras.forEach(function (p) { acc += p.textContent.length; ends.push(acc / total); });
    audio.onended = stop; audio.onerror = function () { if (S) { audio = null; playing = true; i = 0; nextSpoken(); } else stop(); };
    var p = audio.play();
    if (p && p.catch) p.catch(function () { if (S) { audio = null; i = 0; nextSpoken(); } else stop(); });
    tick = setInterval(function () { if (!audio || !audio.duration) return; var f = audio.currentTime / audio.duration; var n = 0; while (n < ends.length - 1 && f > ends[n]) n++; mark(n); }, 250);
  }
  b.addEventListener('click', function () {
    if (!src) return; if (playing) return stop();
    if (window.WMVoice) window.WMVoice.stop();
    playing = true; i = 0; if (S) S.cancel(); b.classList.add('on'); b.querySelector('span').textContent = 'Stop';
    if (src) playRecording(); else nextSpoken();
  });
  // Warm the recording while the visitor reads, so the first tap is instant.
  if (src) { (window.requestIdleCallback || function (f) { setTimeout(f, 2500); })(function () { try { audio = new Audio(src); audio.preload = 'auto'; } catch (e) {} }); }
  if (S && S.onvoiceschanged !== undefined) S.onvoiceschanged = function () {};
  window.addEventListener('pagehide', stop);
})();

/* The guide's setting: Off · Hints · Full, one for the whole house, remembered on this device. Off folds the guide
   to one slim line you can still open; Hints shows the first paragraph and asks you to find each thing before it
   tells you why; Full opens everything. */
(function () {
  var root = document.documentElement;
  function cur() { return root.getAttribute('data-guide') || 'hints'; }
  function paint() { [].forEach.call(document.querySelectorAll('[data-guide-set]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-guide-set') === cur() ? 'true' : 'false'); });
    var full = cur() === 'full'; [].forEach.call(document.querySelectorAll('.sd-s'), function (d, i) { if (full) d.open = true; else if (cur() === 'hints') d.open = i === 0; }); }
  window.WMGuide = { get: cur, set: function (v) { root.setAttribute('data-guide', v); try { localStorage.setItem('wm_guide', v); } catch (e) {} [].forEach.call(document.querySelectorAll('.lc'), function (s) { s.classList.remove('lc-open', 'lc-all'); }); paint(); } };
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-guide-set],[data-lc-open],[data-lc-more],[data-sd-reveal]'); if (!t) return;
    if (t.hasAttribute('data-guide-set')) return window.WMGuide.set(t.getAttribute('data-guide-set'));
    var sec = t.closest('.lc');
    if (t.hasAttribute('data-lc-open')) { sec.classList.add('lc-open'); return; }
    if (t.hasAttribute('data-lc-more')) { sec.classList.add('lc-all'); return; }
    if (t.hasAttribute('data-sd-reveal')) { t.closest('li').classList.add('on'); }
  });
  paint();
})();
