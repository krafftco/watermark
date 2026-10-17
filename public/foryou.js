// For you: filled after the page is up, so the house's eye never slows the room. Shown only when there is looking to go on.
(function () {
  var slots = document.querySelectorAll('[data-for-you]'); if (!slots.length) return;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var n = slots[0].getAttribute('data-for-you') || 6;
  fetch('/api/for-you?n=' + n, { headers: { accept: 'application/json' }, credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || !j.picks || !j.picks.length) return;
    slots.forEach(function (s) {
      s.innerHTML = '<header class="gh"><h2>For you</h2><span>' + (j.by === 'claude' ? "chosen by the house's eye, with AI; never the same twice" : 'chosen by likeness to what held you; never the same twice') + ' · <a href="/yours/looking">your looking</a></span></header><div class="fy-row">' + j.picks.map(function (p) { return '<a class="fy-c" href="/w/' + esc(p.slug) + '"><img src="' + esc(p.thumb) + '" alt="" loading="lazy"><b>' + esc(p.title) + '</b><small>' + esc(p.maker) + (p.place ? ' · ' + esc(p.place) : '') + '</small><em>' + esc(p.why) + '</em></a>'; }).join('') + '</div>';
      s.hidden = false;
    });
  }).catch(function () {});
})();
