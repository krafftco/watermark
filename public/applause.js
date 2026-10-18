/* A tip of the hat: one press, one quiet ripple, the count moves. Press again to take it back. */
(function () {
  var f = document.querySelector('[data-ap]'); if (!f) return;
  var b = f.querySelector('.ap-b'), n = document.querySelector('[data-ap-n]'), t = document.querySelector('[data-ap-t]'), busy = false;
  b.addEventListener('click', function () {
    if (busy) return; busy = true;
    var was = b.classList.contains('on');
    b.classList.toggle('on', !was); b.setAttribute('aria-pressed', !was ? 'true' : 'false');
    if (!was) { b.classList.remove('tip'); void b.offsetWidth; b.classList.add('tip'); }
    fetch(f.getAttribute('action'), { method: 'POST', headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || !j.ok) throw 0; n.textContent = j.n; t.lastChild.textContent = ' tips of the hat'; t.hidden = j.n < 5; b.classList.toggle('on', j.on); b.setAttribute('aria-label', j.on ? 'Applauded' : 'Applaud'); })
      .catch(function () { b.classList.toggle('on', was); })
      .then(function () { busy = false; });
  });
})();
