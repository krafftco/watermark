/* Stars, as in Lightroom: click a star, or press 1–5 with a row under the pointer or focused; 0 clears. */
(function () {
  var forms = document.querySelectorAll('form.st'); if (!forms.length) return;
  function paint(f, n) { f.setAttribute('data-stars', n); var bs = f.querySelectorAll('button'); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', i < n); }
  function set(f, n) {
    var cur = +f.getAttribute('data-stars') || 0; if (n === cur) n = 0; // the same star again clears
    paint(f, n); f.classList.add('tick'); setTimeout(function () { f.classList.remove('tick'); }, 400);
    var fd = new FormData(f); fd.set('n', n);
    fetch(f.action, { method: 'POST', body: new URLSearchParams(fd), headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) { if (j && j.ok) paint(f, j.stars); }).catch(function () { paint(f, cur); });
  }
  document.addEventListener('click', function (e) { var b = e.target.closest('form.st button'); if (!b) return; e.preventDefault(); set(b.form, +b.value); });
  var hot = null;
  document.addEventListener('pointerover', function (e) { var r = e.target.closest('.ac-row'); if (r) hot = r; });
  document.addEventListener('focusin', function (e) { var r = e.target.closest('.ac-row'); if (r) hot = r; });
  document.addEventListener('keydown', function (e) {
    if (!hot || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key >= '0' && e.key <= '5') { var f = hot.querySelector('form.st'); if (f) { e.preventDefault(); var n = +e.key; if (n === 0) { paint(f, 0); var fd = new FormData(f); fd.set('n', 0); fetch(f.action, { method: 'POST', body: new URLSearchParams(fd), headers: { Accept: 'application/json' }, credentials: 'same-origin' }); } else { paint(f, n); var fd2 = new FormData(f); fd2.set("n", n); fetch(f.action, { method: "POST", body: new URLSearchParams(fd2), headers: { Accept: "application/json" }, credentials: "same-origin" }); } } }
  });
})();
