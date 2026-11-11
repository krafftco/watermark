// The cull (11 Nov): the maker's own work one picture at a time; right puts it on view, left keeps it back, up
// leaves it for later; Undo takes the last one back. Every decision is one small POST to /account/cull/say.
(function () {
  var root = document.querySelector('[data-cll]'); if (!root) return;
  var $ = function (s) { return root.querySelector(s); };
  var stage = $('[data-cll-stage]'), plate = $('[data-cll-plate]'), countEl = $('[data-cll-count]'), acts = $('[data-cll-acts]'),
    hint = $('[data-cll-hint]'), endEl = $('[data-cll-end]'), sayEl = $('[data-cll-say]'), attest = $('[data-cll-attest]'), undoB = $('[data-cll-do="undo"]');
  var deckKey = root.getAttribute('data-deck'), place = root.getAttribute('data-place') || '';
  var works = [], at = 0, card = null, busy = false, hist = [], tally = { show: 0, hide: 0, later: 0 }, waiting = null;
  var attested = false; try { attested = sessionStorage.getItem('wm_cull_attest') === '1'; } catch (e) {}
  var sayT = null;
  function say(t) { sayEl.textContent = t; sayEl.hidden = false; clearTimeout(sayT); sayT = setTimeout(function () { sayEl.hidden = true; }, 4200); }
  function post(body) {
    var p = new URLSearchParams(); for (var k in body) p.append(k, body[k]);
    return fetch('/account/cull/say', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: p.toString() })
      .then(function (r) { return r.json().catch(function () { return { ok: false, msg: 'The house did not answer. Try again.' }; }); })
      .catch(function () { return { ok: false, msg: 'No connection. Nothing was changed.' }; });
  }
  function src(w, size) { return '/img/' + encodeURIComponent(w.slug) + '/' + (size || 'large'); }
  function warm(i) { for (var k = i; k < Math.min(works.length, i + 3); k++) { if (!works[k]._im) { var im = new Image(); im.decoding = 'async'; im.src = src(works[k]); works[k]._im = im; } } }
  function count() {
    var left = works.length - at;
    countEl.textContent = works.length ? (Math.min(at + 1, works.length) + ' of ' + works.length) + (tally.show || tally.hide ? ' · ' + tally.show + ' on view · ' + tally.hide + ' kept back' : '') : '';
    undoB.disabled = !hist.length;
    if (left <= 0) end();
  }
  function end() {
    acts.hidden = true; hint.hidden = true; plate.textContent = ''; stage.innerHTML = '';
    $('[data-cll-end-h]').textContent = works.length ? 'That is all of them.' : 'Nothing here to decide.';
    $('[data-cll-end-l]').textContent = works.length ? (tally.show + ' put on view, ' + tally.hide + ' kept back' + (tally.later ? ', ' + tally.later + ' left for later' : '') + '.') : 'Every work in this set has had its answer. Choose another set above, or add work.';
    endEl.hidden = false;
  }
  function show() {
    endEl.hidden = true; acts.hidden = false;
    if (at >= works.length) return count();
    var w = works[at]; stage.innerHTML = '';
    card = document.createElement('div'); card.className = 'cll-card';
    var im = document.createElement('img'); im.alt = w.title; im.draggable = false; im.decoding = 'async'; im.src = src(w);
    im.addEventListener('load', function () { im.classList.add('ld'); card.classList.add('cll-in'); });
    im.addEventListener('error', function () { card.classList.add('cll-in'); });
    card.appendChild(im); stage.appendChild(card); tag('');
    plate.innerHTML = ''; var b = document.createElement('b'); b.textContent = w.title; plate.appendChild(b);
    var meta = [w.place, w.at ? w.at.slice(0, 4) : '', w.status === 'public' ? 'on view now' : (w.kept ? 'kept back by you' : 'not on view'), w.stars ? '★'.repeat(w.stars) : ''].filter(Boolean).join(' · ');
    var s = document.createElement('span'); s.textContent = meta; plate.appendChild(s);
    warm(at + 1); count(); drag(card);
    try { history.replaceState(null, '', location.pathname + '?deck=' + deckKey + (place ? '&place=' + encodeURIComponent(place) : '') + '&at=' + encodeURIComponent(w.slug)); } catch (e) {}
  }
  function tag(k, p) { root.classList.toggle('cll-y', k === 'y'); root.classList.toggle('cll-n', k === 'n'); root.classList.toggle('cll-l', k === 'l'); root.style.setProperty('--cll-p', p == null ? 1 : p); }
  function fly(to) {
    if (!card) return; var c = card; card = null;
    var W = window.innerWidth, H = window.innerHeight;
    c.style.transition = 'transform .28s ease-in, opacity .28s ease-in';
    c.style.transform = to === 'show' ? 'translate(' + W + 'px,-40px) rotate(14deg)' : to === 'hide' ? 'translate(' + (-W) + 'px,-40px) rotate(-14deg)' : 'translate(0,' + (-H) + 'px)';
    c.style.opacity = '0'; tag(to === 'show' ? 'y' : to === 'hide' ? 'n' : 'l', 1);
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); if (!card || !card.style.transform) tag(''); }, 300);
  }
  function back() { if (card) { card.style.transition = 'transform .2s ease-out'; card.style.transform = ''; } tag(''); }
  function decide(to) {
    if (busy || at >= works.length) return;
    var w = works[at];
    if (to === 'show' && w.status !== 'public' && !attested) { waiting = w.slug; back(); attest.hidden = false; return; }
    busy = true; var was = { status: w.status, kept: w.kept };
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {}
    fly(to); hint.hidden = true;
    var done = function (r) {
      busy = false;
      if (!r.ok) { say(r.msg === 'attest' ? 'Tick the line first.' : (r.msg || 'That did not take.')); show(); return; }
      w.status = r.status; w.kept = r.kept;
      hist.push({ i: at, to: to, was: was }); if (hist.length > 60) hist.shift();
      tally[to]++; at++; show();
    };
    if (to === 'later') return setTimeout(function () { done({ ok: true, status: w.status, kept: w.kept }); }, 120);
    post({ slug: w.slug, to: to, attest: attested ? '1' : '0' }).then(done);
  }
  function undo() {
    if (busy || !hist.length) return; var h = hist.pop(); var w = works[h.i];
    var fin = function () { tally[h.to] = Math.max(0, tally[h.to] - 1); at = h.i; show(); };
    if (h.to === 'later') return fin();
    busy = true;
    post({ slug: w.slug, to: 'undo', was: h.was.status, kept: h.was.kept }).then(function (r) { busy = false; if (!r.ok) { hist.push(h); return say(r.msg || 'That did not take.'); } w.status = r.status; w.kept = r.kept; fin(); });
  }
  function grade(n) {
    if (at >= works.length) return; var w = works[at];
    fetch('/account/works/batch', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ slugs: w.slug, do: 'stars', stars: String(n), json: '1' }).toString() })
      .then(function (r) { return r.json(); }).then(function (r) { if (r && r.ok) { w.stars = n; say(n ? '★'.repeat(n) : 'Grade cleared'); var s = plate.querySelector('span'); if (s) s.textContent = [w.place, w.at ? w.at.slice(0, 4) : '', w.status === 'public' ? 'on view now' : 'not on view', n ? '★'.repeat(n) : ''].filter(Boolean).join(' · '); } }).catch(function () {});
  }
  // The card follows the finger; past a third of the way, or a quick flick, it goes.
  function drag(c) {
    var sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, on = false, id = null;
    c.addEventListener('pointerdown', function (e) { if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return; on = true; id = e.pointerId; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = Date.now(); c.style.transition = 'none'; try { c.setPointerCapture(id); } catch (x) {} });
    c.addEventListener('pointermove', function (e) {
      if (!on || e.pointerId !== id) return; dx = e.clientX - sx; dy = e.clientY - sy;
      var up = dy < 0 && Math.abs(dy) > Math.abs(dx) * 1.2;
      c.style.transform = up ? 'translate(0,' + dy + 'px)' : 'translate(' + dx + 'px,' + (dy * 0.25) + 'px) rotate(' + (dx / 28) + 'deg)';
      var p = Math.min(1, Math.abs(up ? dy : dx) / (window.innerWidth * 0.3));
      tag(up ? (dy < -12 ? 'l' : '') : dx > 12 ? 'y' : dx < -12 ? 'n' : '', p);
    });
    var up = function (e) {
      if (!on || (e && e.pointerId !== id)) return; on = false;
      var dt = Math.max(1, Date.now() - t0), W = window.innerWidth, H = window.innerHeight;
      var vert = dy < 0 && Math.abs(dy) > Math.abs(dx) * 1.2;
      if (vert && (-dy > H * 0.22 || (-dy > 60 && -dy / dt > 0.6))) return decide('later');
      if (!vert && (Math.abs(dx) > W * 0.28 || (Math.abs(dx) > 60 && Math.abs(dx) / dt > 0.6))) return decide(dx > 0 ? 'show' : 'hide');
      back();
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', function () { on = false; back(); });
  }
  acts.addEventListener('click', function (e) { var b = e.target.closest('[data-cll-do]'); if (!b) return; var d = b.getAttribute('data-cll-do'); if (d === 'undo') undo(); else decide(d); });
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
    if (!attest.hidden) { if (e.key === 'Escape') { attest.hidden = true; waiting = null; } return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); decide('show'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); decide('hide'); }
    else if (e.key === 'ArrowUp' || e.key === ' ') { e.preventDefault(); decide('later'); }
    else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') { e.preventDefault(); undo(); }
    else if (/^[0-5]$/.test(e.key)) grade(+e.key);
    else if (e.key === 'Escape') location.href = '/account/table';
  });
  $('[data-cll-attest-go]').addEventListener('click', function () {
    if (!$('[data-cll-attest-cb]').checked) return say('Tick the line first.');
    attested = true; try { sessionStorage.setItem('wm_cull_attest', '1'); } catch (e) {}
    attest.hidden = true; if (waiting && works[at] && works[at].slug === waiting) decide('show'); waiting = null;
  });
  $('[data-cll-attest-no]').addEventListener('click', function () { attest.hidden = true; waiting = null; });
  var sel = $('[data-cll-place]'); if (sel) sel.addEventListener('change', function () { location.href = '/account/cull?deck=' + deckKey + (sel.value ? '&place=' + encodeURIComponent(sel.value) : ''); });
  fetch('/account/cull.json?deck=' + encodeURIComponent(deckKey) + (place ? '&place=' + encodeURIComponent(place) : ''), { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (d) { works = d.works || []; var from = root.getAttribute('data-at'); if (from) { for (var i = 0; i < works.length; i++) if (works[i].slug === from) { at = i; break; } } var w = $('[data-cll-wait]'); if (w) w.remove(); if (!works.length) { count(); end(); } else show(); })
    .catch(function () { var w = $('[data-cll-wait]'); if (w) w.textContent = 'The house did not answer. Pull down to try again.'; });
  window.__WM_CULL = { decide: decide, undo: undo, state: function () { return { at: at, n: works.length, tally: tally, slug: works[at] && works[at].slug }; } };
})();
