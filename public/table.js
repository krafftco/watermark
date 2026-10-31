// The Library (25 Oct): Lightroom's Library module for the maker's own work. The grid, the loupe, flags and stars
// on the keys, selection by click / shift / ⌘ / marquee (a press and a drag on a phone), one act for the whole
// selection through JSON, the tiles repainted, a toast with Undo. Nothing here talks to anything but the house.
(function () {
  var root = document.querySelector('[data-lib]'); if (!root) return;
  var D = window.__LIB || { works: [] }; var works = D.works; var bySlug = {}; works.forEach(function (w) { bySlug[w.slug] = w; });
  var grid = root.querySelector('[data-lib-grid]'), bar = root.querySelector('[data-lib-bar]'), nEl = root.querySelector('[data-lib-n]');
  var sel = new Set(); var anchor = null; var cur = null; var shown = works.slice();
  var F = { flag: 'all', stars: 0, pub: 'all', q: '' };
  var f0 = root.getAttribute('data-f'); if (f0 === 'private') F.pub = 'private'; if (f0 === 'picks') F.flag = 'pick'; if (f0 === 'weak') F.pub = 'weak';
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var auto = root.querySelector('[data-lib-auto]');
  try { auto.checked = localStorage.getItem('wm_lib_auto') === '1'; } catch (e) { /* */ }
  var sizeIn = root.querySelector('[data-lib-size]'); try { var sz = localStorage.getItem('wm_lib_size'); if (sz) sizeIn.value = sz; } catch (e) { /* */ }
  function setSize() { grid.style.setProperty('--n', sizeIn.value); try { localStorage.setItem('wm_lib_size', sizeIn.value); } catch (e) { /* */ } }
  sizeIn.addEventListener('input', setSize); setSize();
  // The filter.
  function matches(w) {
    if (F.flag === 'pick' && w.flag !== 'pick') return false; if (F.flag === 'reject' && w.flag !== 'reject') return false; if (F.flag === 'unflagged' && w.flag) return false;
    if (F.stars && (w.stars || 0) < F.stars) return false;
    if (F.pub === 'private' && w.status !== 'private') return false; if ((F.pub === 'public' || F.pub === 'weak') && w.status !== 'public') return false;
    if (F.q) { var q = F.q.toLowerCase(); if ((w.title + ' ' + w.place + ' ' + w.accession + ' ' + w.at).toLowerCase().indexOf(q) < 0) return false; }
    return true;
  }
  function paintFilters() {
    root.querySelectorAll('[data-lib-flags] button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-f') === F.flag); });
    root.querySelectorAll('[data-lib-stars] button').forEach(function (b) { b.setAttribute('aria-pressed', +b.getAttribute('data-s') === F.stars); });
    root.querySelectorAll('[data-lib-pub] button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-p') === F.pub); });
  }
  root.querySelector('[data-lib-flags]').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; F.flag = b.getAttribute('data-f'); render(); });
  root.querySelector('[data-lib-stars]').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; F.stars = +b.getAttribute('data-s'); render(); });
  root.querySelector('[data-lib-pub]').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; F.pub = b.getAttribute('data-p'); render(); });
  var qIn = root.querySelector('[data-lib-q]'); var qT; qIn.addEventListener('input', function () { clearTimeout(qT); qT = setTimeout(function () { F.q = qIn.value.trim(); render(); }, 120); });
  // The tiles.
  function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += '<i' + (i <= n ? ' class="on"' : '') + '>★</i>'; return s; }
  function tile(w) {
    var r = w.w && w.h ? (w.w / w.h) : 1.5;
    return '<figure class="lib-t' + (sel.has(w.slug) ? ' is-sel' : '') + (w.flag ? ' is-' + w.flag : '') + (w.status === 'public' ? ' is-pub' : '') + '" data-slug="' + w.slug + '" style="--r:' + r.toFixed(3) + '" tabindex="-1">' +
      '<span class="lib-im"><img src="/img/' + encodeURIComponent(w.slug) + '/thumb" alt="" loading="lazy" decoding="async" draggable="false"></span>' +
      '<span class="lib-badges"><i class="lib-flag"></i>' + (w.status === 'public' ? '<i class="lib-pubdot" title="Public"></i>' : '') + (w.curated ? '<i class="lib-jewel" title="Curated">◆</i>' : '') + (w.sold ? '<i class="lib-sold" title="Collected ' + w.sold + '">' + w.sold + '</i>' : '') + '</span>' +
      '<figcaption><b>' + esc(w.title) + (F.pub === 'weak' ? ' <small class="lib-why">' + (w.seen ? w.seen + ' stood' : 'not yet seen') + (w.hats ? ' · ' + w.hats + ' hats' : '') + '</small>' : '') + '</b><span class="lib-st">' + stars(w.stars) + '</span></figcaption></figure>';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render() {
    shown = works.filter(matches); if (F.pub === 'weak') shown.sort(function (a, b) { return (a.merit || 0) - (b.merit || 0); }); paintFilters();
    grid.innerHTML = shown.map(tile).join('');
    root.querySelector('[data-lib-empty]').hidden = shown.length > 0;
    root.querySelector('[data-lib-count]').textContent = shown.length === works.length ? works.length + ' works' : shown.length + ' of ' + works.length;
    sel.forEach(function (s) { if (!shown.some(function (w) { return w.slug === s; })) sel.delete(s); });
    paintSel();
  }
  function repaint(w) { var el = grid.querySelector('[data-slug="' + w.slug + '"]'); if (!el) return; var n = document.createElement('div'); n.innerHTML = tile(w); el.replaceWith(n.firstChild); }
  function paintSel() {
    grid.querySelectorAll('.lib-t').forEach(function (el) { el.classList.toggle('is-sel', sel.has(el.getAttribute('data-slug'))); el.classList.toggle('is-cur', el.getAttribute('data-slug') === cur); });
    nEl.textContent = sel.size; bar.hidden = sel.size === 0; root.querySelector('[data-lib-sel]').textContent = sel.size + ' selected';
    document.body.classList.toggle('lib-on', sel.size > 0);
  }
  function idx(slug) { for (var i = 0; i < shown.length; i++) if (shown[i].slug === slug) return i; return -1; }
  function select(slug, mode) { // mode: 'one' | 'toggle' | 'range'
    if (mode === 'range' && anchor) { var a = idx(anchor), b = idx(slug); if (a >= 0 && b >= 0) { var lo = Math.min(a, b), hi = Math.max(a, b); for (var i = lo; i <= hi; i++) sel.add(shown[i].slug); } }
    else if (mode === 'toggle') { if (sel.has(slug)) sel.delete(slug); else sel.add(slug); anchor = slug; }
    else { sel.clear(); sel.add(slug); anchor = slug; }
    cur = slug; paintSel();
  }
  function none() { sel.clear(); paintSel(); }
  function all() { shown.forEach(function (w) { sel.add(w.slug); }); paintSel(); }
  // Click, shift, ⌘; a double-click opens the loupe.
  grid.addEventListener('click', function (e) {
    var t = e.target.closest('.lib-t'); if (!t) return; var slug = t.getAttribute('data-slug');
    if (coarse) { select(slug, 'toggle'); return; }
    if (e.shiftKey) select(slug, 'range'); else if (e.metaKey || e.ctrlKey) select(slug, 'toggle'); else select(slug, sel.size === 1 && sel.has(slug) ? 'toggle' : 'one');
  });
  grid.addEventListener('dblclick', function (e) { var t = e.target.closest('.lib-t'); if (t) loupe(t.getAttribute('data-slug')); });
  // The marquee (a pointer on the wall between tiles, dragged).
  var mq = null, mqEl = null;
  grid.addEventListener('pointerdown', function (e) {
    if (coarse || e.button !== 0) return; if (e.target.closest('.lib-t')) return;
    mq = { x: e.clientX, y: e.clientY, add: e.shiftKey || e.metaKey, base: new Set(sel) }; mqEl = document.createElement('div'); mqEl.className = 'lib-mq'; document.body.appendChild(mqEl); grid.setPointerCapture(e.pointerId); e.preventDefault();
  });
  grid.addEventListener('pointermove', function (e) {
    if (!mq) return; var x1 = Math.min(mq.x, e.clientX), y1 = Math.min(mq.y, e.clientY), x2 = Math.max(mq.x, e.clientX), y2 = Math.max(mq.y, e.clientY);
    mqEl.style.cssText = 'left:' + x1 + 'px;top:' + y1 + 'px;width:' + (x2 - x1) + 'px;height:' + (y2 - y1) + 'px';
    sel = new Set(mq.add ? mq.base : []);
    grid.querySelectorAll('.lib-t').forEach(function (t) { var r = t.getBoundingClientRect(); if (r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2) sel.add(t.getAttribute('data-slug')); });
    paintSel();
  });
  function mqEnd() { if (!mq) return; mq = null; if (mqEl) mqEl.remove(); mqEl = null; }
  grid.addEventListener('pointerup', mqEnd); grid.addEventListener('pointercancel', mqEnd);
  // A phone: a press, then a drag, sweeps (Lightroom mobile's tap-and-drag).
  var sw = null, swT = null;
  grid.addEventListener('touchstart', function (e) {
    var t = e.target.closest('.lib-t'); if (!t || e.touches.length !== 1) return;
    var slug = t.getAttribute('data-slug'); swT = setTimeout(function () { sw = { from: slug, base: new Set(sel) }; sel.add(slug); anchor = slug; paintSel(); if (navigator.vibrate) navigator.vibrate(8); }, 260);
  }, { passive: true });
  grid.addEventListener('touchmove', function (e) {
    if (!sw) { clearTimeout(swT); return; }
    e.preventDefault(); var p = e.touches[0]; var el = document.elementFromPoint(p.clientX, p.clientY); var t = el && el.closest('.lib-t'); if (!t) return;
    var a = idx(sw.from), b = idx(t.getAttribute('data-slug')); if (a < 0 || b < 0) return;
    sel = new Set(sw.base); var lo = Math.min(a, b), hi = Math.max(a, b); for (var i = lo; i <= hi; i++) sel.add(shown[i].slug); paintSel();
  }, { passive: false });
  grid.addEventListener('touchend', function () { clearTimeout(swT); if (sw) { sw = null; } }, { passive: true });
  grid.addEventListener('touchcancel', function () { clearTimeout(swT); sw = null; }, { passive: true });
  // Acts: one POST for the selection, the tiles repainted, Undo offered.
  var busy = false; var last = null;
  function post(body) {
    var fd = new URLSearchParams(); Object.keys(body).forEach(function (k) { fd.append(k, body[k]); }); fd.append('json', '1');
    return fetch('/account/works/batch', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).then(function (r) { return r.json(); });
  }
  function apply(answer) { (answer.works || []).forEach(function (u) { var w = bySlug[u.slug]; if (!w) return; w.status = u.status; w.stars = u.stars; w.curated = u.curated; w.flag = u.flag; w.place = u.place; w.kind = u.kind; repaint(w); }); paintSel(); if (loupeSlug) loupePaint(); }
  function act(body, undo) {
    if (busy) return; var slugs = Array.from(sel); if (!slugs.length) return; busy = true;
    var before = slugs.map(function (s) { var w = bySlug[s]; return { slug: s, status: w.status, stars: w.stars, flag: w.flag, place: w.place, kind: w.kind }; });
    post(Object.assign({ slugs: slugs.join(',') }, body)).then(function (a) {
      busy = false; apply(a); toast(a.msg || 'Done.', undo === false ? null : function () { undoOf(body, before); });
      if (auto.checked && (body.do === 'stars' || body.do === 'flag') && slugs.length === 1) advance();
    }).catch(function () { busy = false; toast('The house could not be reached.'); });
  }
  function undoOf(body, before) {
    // The inverse: publish ↔ hide; stars, flags, place and kind back to what each had (grouped by value).
    var groups = {}; before.forEach(function (b) {
      var key, val; if (body.do === 'look') { key = 'negative'; val = ''; } else if (body.do === 'publish') { key = 'hide'; val = ''; } else if (body.do === 'hide') { key = 'publish'; val = ''; } else if (body.do === 'stars') { key = 'stars'; val = String(b.stars); } else if (body.do === 'flag') { key = 'flag'; val = b.flag || 'none'; } else if (body.do === 'place') { key = 'place'; val = b.place; } else if (body.do === 'kind') { key = 'kind'; val = b.kind; } else return;
      var k = key + '|' + val; (groups[k] = groups[k] || { key: key, val: val, slugs: [] }).slugs.push(b.slug);
    });
    var runs = Object.keys(groups).map(function (k) { return groups[k]; });
    (function next() { var g = runs.shift(); if (!g) { toast('Undone.', null); return; } var b = { slugs: g.slugs.join(','), do: g.key }; if (g.key === 'stars') b.stars = g.val; if (g.key === 'flag') b.flag = g.val; if (g.key === 'place') { if (!g.val) { next(); return; } b.place = g.val; } if (g.key === 'kind') b.kind = g.val; if (g.key === 'publish') b.attest = '1'; post(b).then(function (a) { apply(a); next(); }); })();
  }
  var tEl = root.querySelector('[data-lib-toast]'), tMsg = root.querySelector('[data-lib-tmsg]'), tUndo = root.querySelector('[data-lib-undo]'), tT;
  function toast(msg, undo) { tMsg.textContent = msg; tUndo.hidden = !undo; tUndo.onclick = undo ? function () { tEl.hidden = true; undo(); } : null; tEl.hidden = false; clearTimeout(tT); tT = setTimeout(function () { tEl.hidden = true; }, undo ? 7000 : 2600); }
  // Publish asks the attestation once a visit.
  var attest = root.querySelector('[data-lib-attest]'), attestCb = root.querySelector('[data-lib-attest-cb]');
  function attested() { try { return sessionStorage.getItem('wm_lib_attest') === '1'; } catch (e) { return false; } }
  function publish() { if (attested()) { act({ do: 'publish', attest: '1' }); return; } attest.hidden = false; attestCb.checked = false; attestCb.focus(); }
  root.querySelector('[data-lib-attest-go]').addEventListener('click', function () { if (!attestCb.checked) { attestCb.focus(); return; } try { sessionStorage.setItem('wm_lib_attest', '1'); } catch (e) { /* */ } attest.hidden = true; act({ do: 'publish', attest: '1' }); });
  root.querySelector('[data-lib-attest-no]').addEventListener('click', function () { attest.hidden = true; });
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var a = b.getAttribute('data-act');
    if (a === 'publish') publish();
    else if (a === 'hide') act({ do: 'hide' });
    else if (a === 'look') { var lk = root.querySelector('[data-lib-look]'); if (!lk || !lk.value) { toast('Choose a look first.'); return; } act({ do: 'look', look: lk.value }); }
    else if (a === 'stars') act({ do: 'stars', stars: b.getAttribute('data-stars') });
    else if (a === 'flag') act({ do: 'flag', flag: b.getAttribute('data-flag') });
    else if (a === 'place') { var p = root.querySelector('[data-lib-place]').value.trim(); if (!p) { root.querySelector('[data-lib-place]').focus(); return; } act({ do: 'place', place: p }); }
  });
  root.querySelector('[data-lib-kind]').addEventListener('change', function (e) { if (e.target.value) { act({ do: 'kind', kind: e.target.value }); e.target.value = ''; } });
  root.querySelector('[data-lib-none]').addEventListener('click', none);
  // Auto-advance: after grading one, the next becomes the one (Lightroom's caps lock).
  auto.addEventListener('change', function () { try { localStorage.setItem('wm_lib_auto', auto.checked ? '1' : '0'); } catch (e) { /* */ } });
  function advance() { var i = idx(cur); if (i < 0 || i + 1 >= shown.length) return; select(shown[i + 1].slug, 'one'); var el = grid.querySelector('.is-cur'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); if (loupeSlug) loupe(cur); }
  // The loupe.
  var L = root.querySelector('[data-lib-loupe]'), Lim = root.querySelector('[data-lib-lim]'), loupeSlug = null;
  function loupe(slug) { loupeSlug = slug; cur = slug; if (!sel.has(slug)) select(slug, 'one'); loupePaint(); L.hidden = false; document.body.classList.add('lib-loupe-on'); }
  function loupePaint() { var w = bySlug[loupeSlug]; if (!w) return; Lim.src = '/img/' + encodeURIComponent(w.slug) + '/large'; root.querySelector('[data-lib-lt]').textContent = w.title; root.querySelector('[data-lib-ll]').textContent = [w.place, w.at.slice(0, 4), w.status === 'public' ? 'Public' : 'Private', w.flag === 'pick' ? 'Pick' : w.flag === 'reject' ? 'Rejected' : ''].filter(Boolean).join(' · '); root.querySelector('[data-lib-lstars]').innerHTML = stars(w.stars); root.querySelector('[data-lib-lopen]').href = '/w/' + encodeURIComponent(w.slug); var i = idx(loupeSlug); var im2 = shown[i + 1]; if (im2) { var pre = new Image(); pre.src = '/img/' + encodeURIComponent(im2.slug) + '/large'; } }
  function loupeClose() { loupeSlug = null; L.hidden = true; document.body.classList.remove('lib-loupe-on'); }
  function loupeStep(d) { var i = idx(loupeSlug); var w = shown[i + d]; if (!w) return; select(w.slug, 'one'); loupe(w.slug); }
  root.querySelector('[data-lib-lclose]').addEventListener('click', loupeClose);
  root.querySelector('[data-lib-lprev]').addEventListener('click', function () { loupeStep(-1); });
  root.querySelector('[data-lib-lnext]').addEventListener('click', function () { loupeStep(1); });
  root.querySelector('[data-lib-lstars]').addEventListener('click', function (e) { var i = e.target.closest('i'); if (!i) return; var n = Array.prototype.indexOf.call(i.parentNode.children, i) + 1; var w = bySlug[loupeSlug]; act({ do: 'stars', stars: w.stars === n ? 0 : n }); });
  var tx = null; L.addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; }, { passive: true }); L.addEventListener('touchend', function (e) { if (tx == null) return; var dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 50) loupeStep(dx < 0 ? 1 : -1); }, { passive: true });
  // Keys, as Lightroom's.
  var help = root.querySelector('[data-lib-keys]'); root.querySelector('[data-lib-help]').addEventListener('click', function (e) { e.preventDefault(); help.hidden = !help.hidden; }); root.querySelector('[data-lib-keys-close]').addEventListener('click', function () { help.hidden = true; });
  document.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
    var k = e.key;
    if (k === 'Escape') { if (!attest.hidden) { attest.hidden = true; return; } if (!help.hidden) { help.hidden = true; return; } if (loupeSlug) { loupeClose(); return; } none(); return; }
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'a') { e.preventDefault(); all(); return; }
    if (/^[0-5]$/.test(k) && sel.size) { e.preventDefault(); act({ do: 'stars', stars: k }); return; }
    var kl = k.toLowerCase();
    if (kl === 'p' && sel.size) { act({ do: 'flag', flag: 'pick' }); return; }
    if (kl === 'x' && sel.size) { act({ do: 'flag', flag: 'reject' }); return; }
    if (kl === 'u' && sel.size) { act({ do: 'flag', flag: 'none' }); return; }
    if ((kl === 'e' || k === ' ') && (cur || sel.size)) { e.preventDefault(); if (loupeSlug) loupeClose(); else loupe(cur || Array.from(sel)[0]); return; }
    if (k === 'Enter' && cur) { location.href = '/w/' + encodeURIComponent(cur); return; }
    if (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'ArrowDown' || k === 'ArrowUp') {
      var i = idx(cur); if (i < 0) { if (shown.length) select(shown[0].slug, 'one'); return; }
      var cols = Math.max(1, Math.round(grid.clientWidth / (grid.querySelector('.lib-t') || grid).getBoundingClientRect().width));
      var j = k === 'ArrowRight' ? i + 1 : k === 'ArrowLeft' ? i - 1 : k === 'ArrowDown' ? i + cols : i - cols; if (j < 0 || j >= shown.length) return; e.preventDefault();
      select(shown[j].slug, e.shiftKey ? 'range' : 'one'); if (loupeSlug) loupe(cur); var el = grid.querySelector('.is-cur'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
    if (e.getModifierState && e.getModifierState('CapsLock') !== auto.checked && (kl === 'capslock')) { auto.checked = !auto.checked; auto.dispatchEvent(new Event('change')); }
  });
  render();
})();
