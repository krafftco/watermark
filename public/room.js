/* The viewing room: one photograph at a time on a dark wall; the guide read aloud; on to the next by itself. */
(function () {
  var R = document.querySelector('[data-vr]'); if (!R) return;
  var im = R.querySelectorAll('.vr-im'), cur = 0, hist = [], at = -1, seen = (R.getAttribute('data-from') || '').split(',').filter(Boolean);
  var $ = function (s) { return R.querySelector(s); };
  var kEl = $('[data-vr-k]'), tEl = $('[data-vr-t]'), byEl = $('[data-vr-by]'), gEl = $('[data-vr-guide]'), pageEl = $('[data-vr-page]'), colEl = $('[data-vr-collect]'), bar = $('[data-vr-bar]'), hint = $('[data-vr-hint]');
  var sayB = $('[data-vr-say]'), autoB = $('[data-vr-auto]');
  var auto = true, saying = false, DWELL = 14000, timer = null, t0 = 0, left = DWELL, paused = false;
  var S = window.speechSynthesis;
  function voice() { if (!S) return null; var vs = S.getVoices().filter(function (v) { return /^en(-|_|$)/i.test(v.lang); }); var pref = [/premium|enhanced|natural|neural/i, /Daniel|Serena|Kate|Oliver|Arthur/, /Samantha|Ava|Allison|Google UK English|Google US English/]; for (var k = 0; k < pref.length; k++) { var f = vs.filter(function (v) { return pref[k].test(v.name); }); if (f.length) return f[0]; } return vs[0] || null; }
  function stopSay() { saying = false; if (S) S.cancel(); sayB.setAttribute('aria-pressed', 'false'); gEl.querySelectorAll('p').forEach(function (p) { p.classList.remove('now'); }); }
  function say(w) {
    if (!S || !w.guide) return;
    stopSay(); saying = true; sayB.setAttribute('aria-pressed', 'true'); gEl.hidden = false;
    var paras = [].slice.call(gEl.querySelectorAll('p')), i = 0;
    (function next() { if (!saying || i >= paras.length) { if (saying) { saying = false; sayB.setAttribute('aria-pressed', 'false'); if (auto) go(1); } return; }
      var u = new SpeechSynthesisUtterance(paras[i].textContent), v = voice(); if (v) { u.voice = v; u.lang = v.lang; } u.rate = 0.92;
      paras.forEach(function (p, k) { p.classList.toggle('now', k === i); });
      u.onend = function () { i++; next(); }; u.onerror = function () { saying = false; }; S.speak(u); })();
  }
  function show(w) {
    var next = im[1 - cur], prev = im[cur];
    next.onload = function () { next.classList.add('on'); prev.classList.remove('on'); cur = 1 - cur; next.onload = null; };
    next.src = w.img; next.alt = w.title;
    kEl.textContent = [w.place, w.year].filter(Boolean).join(' · ');
    tEl.textContent = w.title; byEl.innerHTML = '<a href="/m/' + w.makerSlug + '">' + w.maker.replace(/[<>&]/g, '') + '</a>';
    pageEl.href = '/w/' + w.slug;
    if (w.collect) { colEl.hidden = false; colEl.href = w.collect.url; colEl.textContent = 'Collect it, ' + w.collect.price; } else colEl.hidden = true;
    gEl.innerHTML = w.guide ? w.guide.split(/\n{2,}/).map(function (p) { return '<p>' + p.replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }) + '</p>'; }).join('') + '<small>' + (w.approved ? 'Written with AI, approved by the maker.' : 'Written by AI from the photograph and its record.') + '</small>' : '';
    gEl.hidden = !w.guide || !saying; sayB.hidden = !w.guide;
    document.title = w.title + ' · The viewing room';
    try { history.replaceState(null, '', '/wander/room?from=' + seen.slice(-12).join(',')); } catch (e) {}
    if (saying) say(w);
  }
  function dwell() { clearTimeout(timer); if (!auto || paused || saying) return; t0 = Date.now(); bar.style.transition = 'none'; bar.style.width = '0%'; requestAnimationFrame(function () { bar.style.transition = 'width ' + left + 'ms linear'; bar.style.width = '100%'; }); timer = setTimeout(function () { go(1); }, left); }
  function go(d) {
    clearTimeout(timer); bar.style.transition = 'none'; bar.style.width = '0%'; left = DWELL;
    if (d < 0) { if (at <= 0) return; at--; show(hist[at]); dwell(); return; }
    if (at < hist.length - 1) { at++; show(hist[at]); dwell(); return; }
    fetch('/api/wander?from=' + encodeURIComponent(seen.slice(-12).join(','))).then(function (r) { return r.json(); }).then(function (w) {
      if (!w || w.none) return; seen.push(w.slug); hist.push(w); at = hist.length - 1; show(w); dwell();
    }).catch(function () {});
  }
  function pause(on) { paused = on; if (on) { clearTimeout(timer); left = Math.max(1500, left - (Date.now() - t0)); bar.style.transition = 'none'; bar.style.width = getComputedStyle(bar).width; } else dwell(); R.classList.toggle('paused', on); }
  $('[data-vr-next]').addEventListener('click', function () { go(1); });
  $('[data-vr-prev]').addEventListener('click', function () { go(-1); });
  autoB.addEventListener('click', function () { auto = !auto; autoB.setAttribute('aria-pressed', String(auto)); autoB.querySelector('span').textContent = auto ? 'Wandering' : 'Staying'; if (auto) dwell(); else { clearTimeout(timer); bar.style.width = '0%'; } });
  sayB.addEventListener('click', function () { if (saying) { stopSay(); dwell(); } else { clearTimeout(timer); bar.style.width = '0%'; say(hist[at]); } });
  document.addEventListener('keydown', function (e) {
    if (e.key === ' ') { e.preventDefault(); pause(!paused); } else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key.toLowerCase() === 'g') sayB.click(); else if (e.key === 'Escape') location.href = '/collection';
  });
  var hideT; function wake() { R.classList.add('awake'); clearTimeout(hideT); hideT = setTimeout(function () { R.classList.remove('awake'); }, 2600); }
  ['mousemove', 'touchstart', 'keydown'].forEach(function (ev) { document.addEventListener(ev, wake, { passive: true }); });
  $('.vr-fig').addEventListener('click', function () { if (saying) return; go(1); });
  setTimeout(function () { hint.classList.add('gone'); }, 6000);
  window.addEventListener('pagehide', function () { if (S) S.cancel(); });
  wake(); go(1);
})();
