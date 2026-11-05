// Follow (29 Oct): any [data-follow="maker:id"|"gallery:id"] button. Private: no counts are shown.
// WMFollow.paint(root) wires buttons put on the page later (Wander's maker panel, 5 Nov).
(function () {
  function paint(b, on) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); var w = b.querySelector('[data-fo-w]'); if (w) w.textContent = on ? 'Following' : 'Follow'; }
  function wire(root) {
    var bs = [].slice.call((root || document).querySelectorAll('[data-follow]')).filter(function (b) { return !b.__fo; }); if (!bs.length) return;
    bs.forEach(function (b) { b.__fo = 1; });
    fetch('/api/follow?k=' + encodeURIComponent(bs.map(function (b) { return b.dataset.follow; }).join(',')), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); }).then(function (j) { bs.forEach(function (b) { paint(b, j.on && j.on[b.dataset.follow]); }); }).catch(function () {});
    bs.forEach(function (b) {
      b.addEventListener('click', function () {
        var body = new URLSearchParams({ k: b.dataset.follow, back: location.pathname + location.search });
        fetch('/follow', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body })
          .then(function (r) { return r.json(); }).then(function (j) { if (j.go) { location.href = j.go; return; } if (j.ok) { paint(b, j.on); if (navigator.vibrate) navigator.vibrate(8); } });
      });
    });
  }
  window.WMFollow = { paint: wire };
  wire(document);
})();
