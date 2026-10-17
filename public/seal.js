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
    if (menuOf(f)) { var row = f.querySelector('.seal-row'); setMenu(f, !row.classList.contains('is-open')); return; }
    if (!s.classList.contains('is-up')) { down(s); requestAnimationFrame(function () { up(s); }); }
    setTimeout(function () { f.dataset.go = '1'; f.requestSubmit ? f.requestSubmit(s) : f.submit(); }, 260);
  }, true);
  // The seal on a photograph's page opens its card: Collect first, then the licenses. A line commits.
  function menuOf(f) { return f && f.querySelector('.seal-menu'); }
  function setMenu(f, on) { var m = menuOf(f); if (!m) return; var row = f.querySelector('.seal-row'); if (on) { m.hidden = false; void m.offsetWidth; row.classList.add('is-open'); var first = m.querySelector('button'); if (first) first.focus({ preventScroll: true }); } else { row.classList.remove('is-open'); setTimeout(function () { if (!row.classList.contains('is-open')) m.hidden = true; }, 350); } }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.seal-menu button[data-k]');
    if (b) {
      e.preventDefault();
      var f = b.closest('form'), inp = f.querySelector('input[name=use]'); if (inp) inp.value = b.dataset.k;
      b.parentNode.classList.add('is-go');
      var s = f.querySelector('.seal'); if (s) { down(s); requestAnimationFrame(function () { up(s); }); }
      setTimeout(function () { setMenu(f, false); f.requestSubmit ? f.requestSubmit() : f.submit(); }, 260);
      return;
    }
    [].forEach.call(document.querySelectorAll('.seal-row.is-open'), function (r) { if (!r.contains(e.target)) setMenu(r.closest('form'), false); });
  });
  // The "ways to have it" line opens the same card; and once, as the seal comes into view, it shows that it opens.
  document.addEventListener('click', function (e) {
    var m = e.target.closest && e.target.closest('[data-sm]'); if (!m) return;
    e.preventDefault(); e.stopPropagation(); var f = m.closest('form'), row = f.querySelector('.seal-row'); setMenu(f, !row.classList.contains('is-open'));
  }, true);
  // Arriving from the K on a plate (?have=1): the card is already open.
  var openOnArrival = function () { if (!/[?&]have=1/.test(location.search)) return; var f = document.querySelector('form.share-buy'); if (!f || !menuOf(f)) return; f.scrollIntoView({ block: 'center' }); setTimeout(function () { setMenu(f, true); }, 350); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openOnArrival); else openOnArrival();
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (!en.isIntersecting) return; io.unobserve(en.target); setTimeout(function () { en.target.classList.add('sm-hint'); setTimeout(function () { en.target.classList.remove('sm-hint'); }, 1800); }, 700); }); }, { threshold: .8 });
    var watch = function () { [].forEach.call(document.querySelectorAll('form.share-buy .seal-row'), function (r) { if (r.querySelector('.seal-menu')) io.observe(r); }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  }
  document.addEventListener('keydown', function (e) {
    var open = document.querySelector('.seal-row.is-open'); if (!open) return;
    var items = [].slice.call(open.querySelectorAll('.seal-menu button')), i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { setMenu(open.closest('form'), false); var s = open.querySelector('.seal'); if (s) s.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  // Called by the payment sheet when a photograph is collected.
  window.WMSealed = function (slug, no, of) {
    var f = document.querySelector('form[data-share="' + slug + '"]'); if (!f) return;
    var r = f.querySelector('.seal-row'); if (r) r.classList.add('is-yours');
    var t = f.querySelector('.seal-t b'); if (t) t.textContent = no ? 'Yours. No. ' + no + (of ? ' of ' + of : '') : 'Yours.';
    var p = f.querySelector('.seal-t span'); if (p) p.innerHTML = 'It hangs in <a href="/yours">your collection</a>.';
  };
})();
