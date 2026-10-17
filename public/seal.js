/* The Collect seal: the maker's mark, pressed like a stamp.
   Press: it gives under the finger. Release: a ring goes out, a tick on the phone, and then the
   collecting happens. After the purchase, the seal on the page is filled in: it's yours. */
(function () {
  if (window.__wmSeal) return; window.__wmSeal = 1;
  var SEL = '.seal, .pb, .lb-seal';
  function root(e) { return e.target && e.target.closest && e.target.closest(SEL); }
  function down(s) { s.classList.remove('is-up'); s.classList.add('is-down'); }
  function up(s) {
    if (!s.classList.contains('is-down')) return;
    s.classList.remove('is-down'); void s.offsetWidth; s.classList.add('is-up');
    try { navigator.vibrate && navigator.vibrate(8); } catch (e) {}
    setTimeout(function () { s.classList.remove('is-up'); }, 950);
  }
  document.addEventListener('pointerdown', function (e) { var s = root(e); if (s) down(s); }, true);
  document.addEventListener('pointerup', function (e) { var s = root(e); if (s) up(s); }, true);
  document.addEventListener('pointercancel', function (e) { var s = root(e); if (s) s.classList.remove('is-down'); }, true);
  document.addEventListener('pointerleave', function (e) { var s = root(e); if (s) s.classList.remove('is-down'); }, true);
  // A seal inside a form lets the ring go out before the form goes; the payment sheet then takes over.
  document.addEventListener('click', function (e) {
    var s = e.target.closest && e.target.closest('form .seal'); if (!s) return;
    var f = s.closest('form'); if (f.dataset.go) { delete f.dataset.go; return; }
    e.preventDefault();
    if (!s.classList.contains('is-up')) { down(s); requestAnimationFrame(function () { up(s); }); }
    setTimeout(function () { f.dataset.go = '1'; f.requestSubmit ? f.requestSubmit(s) : f.submit(); }, 260);
  }, true);
  // The toggle beside the seal: choose how you want the photograph; the seal then commits that choice.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.use-tg button'); if (!b) return;
    e.preventDefault();
    var g = b.parentNode, f = g.closest('form'), uses = JSON.parse(g.dataset.uses || '[]'), u = uses.filter(function (x) { return x.k === b.dataset.k; })[0]; if (!u || !f) return;
    [].forEach.call(g.children, function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
    var t = f.querySelector('.seal-t'), h = f.querySelector('.seal-t b'), p = f.querySelector('.seal-t > span'), inp = f.querySelector('input[name=use]');
    if (inp) inp.value = u.k;
    t.classList.remove('tg-in'); void t.offsetWidth; t.classList.add('tg-in');
    if (h) h.textContent = u.b; if (p) p.textContent = u.d;
    var s = f.querySelector('.seal'); if (s) s.setAttribute('aria-label', u.b);
  });
  // Called by the payment sheet when a photograph is collected.
  window.WMSealed = function (slug, no, of) {
    var f = document.querySelector('form[data-share="' + slug + '"]'); if (!f) return;
    var r = f.querySelector('.seal-row'); if (r) r.classList.add('is-yours');
    var t = f.querySelector('.seal-t b'); if (t) t.textContent = no ? 'Yours. No. ' + no + (of ? ' of ' + of : '') : 'Yours.';
    var p = f.querySelector('.seal-t span'); if (p) p.innerHTML = 'It hangs in <a href="/yours">your collection</a>.';
  };
})();
