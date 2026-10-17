/* The viewing room: one photograph at a time on a dark wall. You stand in front of it first; it moves on only
   when you ask it to wander. The next photograph is already in the room before you need it. The plate beneath
   (the title, the maker, the price) is always there, quietly; the sale is one tap, from your pocket when it
   covers. C collects, H tips your hat, S hangs it on your wall, G reads the guide, W wanders, Esc leaves. */
(function () {
  var R = document.querySelector('[data-vr]'); if (!R) return;
  var im = R.querySelectorAll('.vr-im'), cur = 0, hist = [], at = -1, seen = (R.getAttribute('data-from') || '').split(',').filter(Boolean), ahead = null, aheadImg = null;
  var $ = function (s) { return R.querySelector(s); };
  var kEl = $('[data-vr-k]'), tEl = $('[data-vr-t]'), byEl = $('[data-vr-by]'), gEl = $('[data-vr-guide]'), pageEl = $('[data-vr-page]'), cf = $('[data-vr-cf]'), colEl = $('[data-vr-collect]'), fromEl = $('[data-vr-from]'), hatB = $('[data-vr-hat]'), hangB = $('[data-vr-hang]'), bar = $('[data-vr-bar]'), hint = $('[data-vr-hint]'), toast = $('[data-vr-toast]');
  var sayB = $('[data-vr-say]'), autoB = $('[data-vr-auto]');
  var auto = false, saying = false, DWELL = 14000, timer = null, t0 = 0, left = DWELL, paused = false, stoodAt = Date.now();
  var S = window.speechSynthesis;
  var esc = function (s) { return String(s || '').replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); };
  function code() { try { var k = localStorage.getItem('wm_v'); if (!k) { k = Math.random().toString(36).slice(2, 8); localStorage.setItem('wm_v', k); } return k; } catch (e) { return 'anon'; } }
  var V = code(); try { document.cookie = 'wm_v=' + V + '; max-age=31536000; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); } catch (e) {}
  function say_(msg, ms) { toast.textContent = msg; toast.hidden = false; toast.classList.add('on'); clearTimeout(say_.t); say_.t = setTimeout(function () { toast.classList.remove('on'); setTimeout(function () { toast.hidden = true; }, 500); }, ms || 2600); }
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
  // Standing: how long you stood in front of each, told to the house when you move on (the first hundred are remembered).
  function stood(w) { if (!w) return; var s = Math.round((Date.now() - stoodAt) / 1000); stoodAt = Date.now(); if (s < 2) return; try { navigator.sendBeacon('/w/' + w.slug + '/stood', JSON.stringify({ v: V, s: s })); } catch (e) {} }
  function plate(w) {
    kEl.textContent = [w.place, w.year].filter(Boolean).join(' · ');
    tEl.textContent = w.title; byEl.innerHTML = '<a href="/m/' + esc(w.makerSlug) + '">' + esc(w.maker) + '</a>';
    pageEl.href = '/m/' + esc(w.makerSlug) + '/' + esc(w.slug);
    if (w.collect) { cf.hidden = false; cf.action = w.collect.url; fromEl.value = w.collect.pocket ? 'pocket' : ''; colEl.innerHTML = (w.collect.pocket ? 'Collect it, ' + esc(w.collect.price) + ' <small>from your pocket, one tap</small>' : 'Collect it, ' + esc(w.collect.price)) + (w.collect.edition ? ' <small>No. ' + (w.collect.edition.sold + 1) + ' of ' + w.collect.edition.size + '</small>' : ''); }
    else { cf.hidden = true; }
    if (w.held) { cf.hidden = true; }
    hatB.setAttribute('aria-pressed', String(!!(w.hat && w.hat.mine))); hatB.textContent = w.hat && w.hat.n ? 'Hat · ' + w.hat.n : 'Hat';
    gEl.innerHTML = w.guide ? w.guide.split(/\n{2,}/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '<small>' + (w.approved ? 'Written with AI, approved by the maker.' : 'Written by AI from the photograph and its record.') + '</small>' : '';
    gEl.hidden = !w.guide || !saying; sayB.hidden = !w.guide;
    document.title = w.title + ' · The viewing room';
    try { history.replaceState(null, '', '/wander/room?at=' + w.slug + '&from=' + seen.slice(-12).join(',')); } catch (e) {}
  }
  function show(w, instant) {
    var next = im[1 - cur], prev = im[cur];
    var swap = function () { next.classList.add('on'); prev.classList.remove('on'); cur = 1 - cur; next.onload = null; R.classList.remove('drift'); void R.offsetWidth; R.classList.add('drift'); };
    if (instant || next.src === location.origin + w.img || (aheadImg && aheadImg.src === location.origin + w.img && aheadImg.complete)) { next.src = w.img; next.alt = w.title; swap(); }
    else { next.onload = swap; next.src = w.img; next.alt = w.title; }
    plate(w); showPlate();
    if (saying) say(w);
    fetchAhead();
  }
  // The next photograph is fetched and decoded while you stand, so the room never waits.
  function fetchAhead() {
    if (at < hist.length - 1) return;
    var ex = seen.slice(-12).join(',');
    fetch('/api/wander?from=' + encodeURIComponent(ex)).then(function (r) { return r.json(); }).then(function (w) { if (!w || w.none) return; ahead = w; aheadImg = new Image(); aheadImg.decoding = 'async'; aheadImg.src = w.img; }).catch(function () {});
  }
  function dwell() { clearTimeout(timer); if (!auto || paused || saying) return; t0 = Date.now(); bar.style.transition = 'none'; bar.style.width = '0%'; requestAnimationFrame(function () { bar.style.transition = 'width ' + left + 'ms linear'; bar.style.width = '100%'; }); timer = setTimeout(function () { go(1); }, left); }
  function go(d) {
    clearTimeout(timer); bar.style.transition = 'none'; bar.style.width = '0%'; left = DWELL;
    stood(hist[at]);
    if (d < 0) { if (at <= 0) return; at--; show(hist[at]); dwell(); return; }
    if (at < hist.length - 1) { at++; show(hist[at]); dwell(); return; }
    if (ahead) { var w = ahead; ahead = null; seen.push(w.slug); hist.push(w); at = hist.length - 1; show(w); dwell(); return; }
    fetch('/api/wander?from=' + encodeURIComponent(seen.slice(-12).join(','))).then(function (r) { return r.json(); }).then(function (w) {
      if (!w || w.none) return; seen.push(w.slug); hist.push(w); at = hist.length - 1; show(w); dwell();
    }).catch(function () {});
  }
  function pause(on) { paused = on; R.classList.toggle('labeled', on || R.classList.contains('awake')); if (on) { clearTimeout(timer); left = Math.max(1500, left - (Date.now() - t0)); bar.style.transition = 'none'; bar.style.width = getComputedStyle(bar).width; } else dwell(); R.classList.toggle('paused', on); }
  // The sale: from the pocket it is posted at once and the room says so; otherwise the form goes to Checkout (Apple Pay, Link, a card) and returns here.
  cf.addEventListener('submit', function (e) {
    var w = hist[at]; if (!w || !w.collect) return;
    if (fromEl.value !== 'pocket') { cf.action = w.collect.url + '?back=' + encodeURIComponent('/wander/room?at=' + w.slug); return; }
    e.preventDefault(); colEl.disabled = true;
    fetch(w.collect.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'use=social&from=pocket&json=1' }).then(function (r) { return r.json(); }).then(function (j) {
      colEl.disabled = false; if (j && j.ok) { w.held = true; w.collect = null; plate(w); say_('Yours' + (j.no ? ', No. ' + j.no : '') + '. It hangs in your gallery.', 3600); } else say_((j && j.why) || 'The pocket could not cover it; collect it from the photograph.', 3600);
    }).catch(function () { colEl.disabled = false; cf.action = w.collect.url; cf.submit(); });
  });
  hatB.addEventListener('click', function () { var w = hist[at]; if (!w) return; fetch('/w/' + w.slug + '/applaud', { method: 'POST', headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) { if (!j) return; w.hat = { n: j.n, mine: !!j.mine }; plate(w); say_(j.mine ? 'A tip of the hat.' : 'Hat back on.'); }).catch(function () {}); });
  hangB.addEventListener('click', function () { var w = hist[at]; if (!w) return; fetch('/hang/add', { method: 'post', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'work=' + encodeURIComponent(w.slug) + '&hang=wander&title=From+my+wandering&json=1' }).then(function (r) { return r.json(); }).then(function (j) { say_(j && j.ok ? 'Hung on your wall, From my wandering.' : 'Could not hang it just now.'); }).catch(function () {}); });
  // Full screen: the photograph alone, edge to edge. Asked for on Wander, or F, or the button; Esc leaves it the browser's way.
  var fullB = $('[data-vr-full]');
  function full(on) { var d = document; try { if (on && !d.fullscreenElement && d.documentElement.requestFullscreen) d.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(function () {}); else if (!on && d.fullscreenElement) d.exitFullscreen(); } catch (e) {} }
  if (fullB) fullB.addEventListener('click', function () { full(!document.fullscreenElement); });
  document.addEventListener('fullscreenchange', function () { R.classList.toggle('full', !!document.fullscreenElement); });
  // The plate rises with each photograph, holds, and recedes; a touch of the mouse brings it back.
  var plateT; function showPlate() { R.classList.add('labeled'); clearTimeout(plateT); plateT = setTimeout(function () { if (!saying && !paused) R.classList.remove('labeled'); }, 4200); }
  var pauseB = $('[data-vr-pause]'), pauseL = $('[data-vr-pause-l]');
  function pauseLabel() { pauseL.textContent = !auto ? 'Wander' : paused ? 'Resume' : 'Pause'; pauseB.setAttribute('aria-pressed', String(auto && !paused)); }
  pauseB.addEventListener('click', function () { if (!auto) { autoB.click(); full(true); } else pause(!paused); pauseLabel(); });
  $('[data-vr-next]').addEventListener('click', function () { go(1); });
  $('[data-vr-prev]').addEventListener('click', function () { go(-1); });
  autoB.addEventListener('click', function () { auto = !auto; autoB.setAttribute('aria-pressed', String(auto)); autoB.querySelector('span').textContent = auto ? 'Wandering' : 'Standing'; if (auto) dwell(); else { clearTimeout(timer); bar.style.width = '0%'; } pauseLabel(); });
  sayB.addEventListener('click', function () { if (saying) { stopSay(); dwell(); } else { clearTimeout(timer); bar.style.width = '0%'; say(hist[at]); } });
  document.addEventListener('keydown', function (e) {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    var k = e.key.toLowerCase();
    if (e.key === ' ') { e.preventDefault(); if (!auto) autoB.click(); else pause(!paused); pauseLabel(); } else if (k === 'f') { full(!document.fullscreenElement); } else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1);
    else if (k === 'g') sayB.click(); else if (k === 'w') autoB.click(); else if (k === 'c' && !cf.hidden) colEl.click(); else if (k === 'h') hatB.click(); else if (k === 's') hangB.click(); else if (e.key === 'Escape') location.href = '/collection';
  });
  var hideT; function wake() { R.classList.add('awake'); R.classList.add('labeled'); clearTimeout(plateT); clearTimeout(hideT); hideT = setTimeout(function () { R.classList.remove('awake'); if (!saying && !paused) R.classList.remove('labeled'); }, 2600); }
  ['mousemove', 'touchstart', 'keydown'].forEach(function (ev) { document.addEventListener(ev, wake, { passive: true }); });
  $('.vr-fig').addEventListener('click', function () { if (saying) return; if (R.classList.contains('awake') && window.matchMedia('(hover:none)').matches) { go(1); } else go(1); });
  setTimeout(function () { hint.classList.add('gone'); }, 7000);
  window.addEventListener('pagehide', function () { if (S) S.cancel(); stood(hist[at]); });
  wake();
  var first = window.__WM_FIRST;
  if (first) { seen.push(first.slug); hist.push(first); at = 0; show(first, true); } else go(1);
})();
