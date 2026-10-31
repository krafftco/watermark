/* The curator's desk (31 Oct, Will: "the curator experience needs to be the best ever, the most easy, simple"):
   tap a photograph and it hangs (the first tap begins the show, no title asked first); tap again and it comes down;
   the show beside it changes in place, no page reload; drag the sequence; a line for each. On a phone the show is a
   tray at the foot of the screen that opens over the archive. */
(function () {
  var root = document.querySelector('[data-cu]'); if (!root) return;
  var id = root.getAttribute('data-show'), maker = root.getAttribute('data-maker'), seq = root.querySelector('[data-cu-seq]');
  var tray = root.querySelector('[data-cu-tray]'), tn = root.querySelector('[data-cu-tn]');
  function ic(k) { var t = root.querySelector('template[data-cu-ic="' + k + '"]'); return t ? t.innerHTML : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function post(path, body) { return fetch('/curate/show/' + id + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(body).toString(), credentials: 'same-origin' }).then(function (r) { return r.json(); }); }
  function paint(list) {
    if (!seq) return;
    seq.innerHTML = list.map(function (w) { return '<li data-slug="' + esc(w.slug) + '"><span class="cu-grip">' + ic('grip') + '</span><img src="/img/' + encodeURIComponent(w.slug) + '/thumb" alt=""><div><b>' + esc(w.title) + '</b><input data-cu-note value="' + esc(w.note) + '" placeholder="A line for the wall" maxlength="240"></div><button type="button" class="cu-x" data-cu-out aria-label="Take it out">' + ic('close') + '</button></li>'; }).join('');
    if (tn) tn.textContent = list.length; var h = root.querySelector('.cu-hint'); if (h) h.textContent = list.length ? list.length + ' in the show. Drag to sequence; the order is the walk.' : 'Tap works to hang them here.';
    root.querySelectorAll('[data-cu-w]').forEach(function (b) { var on = list.some(function (w) { return w.slug === b.getAttribute('data-cu-w'); }); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    var pf = root.querySelector('form[action$="/propose"]'); if (pf) pf.hidden = !list.length;
    if (tray) { tray.classList.remove('cu-bump'); void tray.offsetWidth; tray.classList.add('cu-bump'); }
  }
  function toggle(slug, tile) {
    if (tile) tile.classList.toggle('on');
    return post('/toggle', { work: slug }).then(function (j) { if (!j.ok) { if (tile) tile.classList.toggle('on'); return; } paint(j.seq || []); if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* */ } });
  }
  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-cu-tray-t]'); if (t) { var open = root.classList.toggle('cu-tray-open'); t.setAttribute('aria-expanded', open); return; }
    var w = e.target.closest('[data-cu-w]');
    if (w) {
      var slug = w.getAttribute('data-cu-w');
      if (!id) { // the first tap begins the show
        w.classList.add('on');
        fetch('/curate/' + maker + '/show', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'title=' + encodeURIComponent('A show of ' + (root.getAttribute('data-first') || 'the archive')), credentials: 'same-origin' })
          .then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.id) { w.classList.remove('on'); return; } id = String(j.id); return toggle(slug, null).then(function () { location.replace(location.pathname + '?show=' + id + '#show'); }); });
        return;
      }
      toggle(slug, w); return;
    }
    var x = e.target.closest('[data-cu-out]');
    if (x) { var li = x.closest('li'); li.style.opacity = '.3'; toggle(li.getAttribute('data-slug'), null); }
  });
  if (!seq) return;
  seq.addEventListener('change', function (e) { var i = e.target.closest('[data-cu-note]'); if (!i) return; post('/note', { work: i.closest('li').getAttribute('data-slug'), note: i.value }); });
  // Drag to sequence (mouse or touch), by the grip.
  var drag = null;
  seq.addEventListener('pointerdown', function (e) { var g = e.target.closest('.cu-grip'); if (!g) return; drag = g.closest('li'); drag.classList.add('dragging'); seq.setPointerCapture(e.pointerId); e.preventDefault(); });
  seq.addEventListener('pointermove', function (e) {
    if (!drag) return; var over = document.elementFromPoint(e.clientX, e.clientY); var li = over && over.closest && over.closest('[data-cu-seq] li');
    if (!li || li === drag) return; var r = li.getBoundingClientRect(); seq.insertBefore(drag, e.clientY < r.top + r.height / 2 ? li : li.nextSibling);
  });
  function drop() { if (!drag) return; drag.classList.remove('dragging'); drag = null; post('/order', { order: [].map.call(seq.querySelectorAll('li'), function (l) { return l.getAttribute('data-slug'); }).join(',') }); }
  seq.addEventListener('pointerup', drop); seq.addEventListener('pointercancel', drop);
})();
