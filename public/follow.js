// Follow (29 Oct): any [data-follow="maker:id"|"gallery:id"] button. Private: no counts are shown.
(function () {
  var bs = [].slice.call(document.querySelectorAll('[data-follow]')); if (!bs.length) return;
  function paint(b, on) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); var w = b.querySelector('[data-fo-w]'); if (w) w.textContent = on ? 'Following' : 'Follow'; }
  fetch('/api/follow?k=' + encodeURIComponent(bs.map(function (b) { return b.dataset.follow; }).join(',')), { credentials: 'same-origin' })
    .then(function (r) { return r.json(); }).then(function (j) { bs.forEach(function (b) { paint(b, j.on && j.on[b.dataset.follow]); }); }).catch(function () {});
  bs.forEach(function (b) {
    b.addEventListener('click', function () {
      var body = new URLSearchParams({ k: b.dataset.follow, back: location.pathname + location.search });
      fetch('/follow', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body })
        .then(function (r) { return r.json(); }).then(function (j) { if (j.go) { location.href = j.go; return; } if (j.ok) { paint(b, j.on); if (navigator.vibrate) navigator.vibrate(8); } });
    });
  });
})();
