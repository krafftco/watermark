/* The curator's desk: tap a photograph to hang it in the show or take it down; drag the sequence; a line for each. */
(function () {
  var root = document.querySelector('[data-cu]'); if (!root) return;
  var id = root.getAttribute('data-show'), seq = root.querySelector('[data-cu-seq]');
  function post(path, body) { return fetch('/curate/show/' + id + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(body).toString() }).then(function (r) { return r.json(); }); }
  root.addEventListener('click', function (e) {
    var w = e.target.closest('[data-cu-w]');
    if (w) { if (!id) { var t = root.querySelector('.cu-new input'); if (t) { t.focus(); t.placeholder = 'Name the show first'; } return; }
      w.classList.toggle('on'); post('/toggle', { work: w.getAttribute('data-cu-w') }).then(function (j) { if (!j.ok) { w.classList.toggle('on'); return; } location.reload(); }); return; }
    var x = e.target.closest('[data-cu-out]');
    if (x) { var li = x.closest('li'); li.style.opacity = '.3'; post('/toggle', { work: li.getAttribute('data-slug') }).then(function () { location.reload(); }); }
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
