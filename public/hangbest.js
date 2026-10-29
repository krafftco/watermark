// Hang your best: a tap keeps a work back (or, in 'Look at these first', taps it in); kept back is saved at once.
(function () {
  var post = function (b) { return fetch('/account/hang/keep', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(b).toString(), credentials: 'same-origin' }).then(function (r) { return r.json(); }); };
  function sync(g) {
    var box = document.querySelector('[data-hb-slugs="' + g.getAttribute('data-hb-group') + '"]'); if (!box) return;
    var ins = [].slice.call(g.querySelectorAll('.hb-t[data-hb-mode="hold"][aria-pressed="false"]')).map(function (t) { return t.getAttribute('data-hb-slug'); });
    box.value = ins.join(',');
  }
  document.querySelectorAll('[data-hb-group]').forEach(function (g) {
    g.addEventListener('click', function (e) {
      var t = e.target.closest('.hb-t[data-hb-slug]'); if (!t) return;
      var mode = t.getAttribute('data-hb-mode'), on = t.getAttribute('aria-pressed') === 'true';
      if (mode === 'hold') { t.setAttribute('aria-pressed', on ? 'false' : 'true'); t.querySelector('.hb-x').textContent = on ? 'In' : 'Down'; sync(g); return; }
      // hang or kept: the tap is the lock itself
      t.setAttribute('aria-pressed', on ? 'false' : 'true');
      post({ slug: t.getAttribute('data-hb-slug'), on: on ? '0' : '1' }).then(function (j) { if (!j || !j.ok) t.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    });
    sync(g);
  });
})();
