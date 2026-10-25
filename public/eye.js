/* See the watermark (Will, 18 Oct). The eye on a photograph opens what its watermark carries: who made it, its
   number, the copyright, how the maker is paid, who holds it, how to have it, and the proof. One sheet for the
   whole house; it opens over whatever you are looking at and closes back to it, with no page change. */
(function () {
  if (window.__WM_EYE) return; window.__WM_EYE = 1;
  var sheet, body, cache = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ui() {
    if (sheet) return;
    sheet = document.createElement('div'); sheet.className = 'wye'; sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'The watermark');
    sheet.innerHTML = '<div class="wye-c"><button type="button" class="wye-x" aria-label="Close">&times;</button><div data-wye></div></div>';
    document.body.appendChild(sheet); body = sheet.querySelector('[data-wye]');
    sheet.addEventListener('click', function (e) { if (e.target === sheet || e.target.closest('.wye-x')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) { e.stopPropagation(); close(); } }, true);
    var y0 = null; sheet.addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; }, { passive: true });
    sheet.addEventListener('touchend', function (e) { if (y0 != null && e.changedTouches[0].clientY - y0 > 80 && sheet.querySelector('.wye-c').scrollTop <= 0) close(); y0 = null; }, { passive: true });
  }
  function close() { sheet.classList.remove('on'); setTimeout(function () { sheet.hidden = true; }, 320); }
  function row(k, v) { return v ? '<div class="wye-r"><dt>' + k + '</dt><dd>' + v + '</dd></div>' : ''; }
  function draw(d) {
    var made = [esc(d.place), esc(d.year)].filter(Boolean).join(', ');
    body.innerHTML = '<p class="wye-k">The Watermark</p><h2>' + esc(d.title) + '</h2>'
      + '<p class="wye-l">A registered work: numbered, fingerprinted, on the house\u2019s register, held under lock and key and shown in the open. Look as long as you like. To use it, in a story, a campaign, a product or on a wall, license it here: the maker is paid, and the licence travels inside the file.</p><dl>'
      + row('Made by', '<a href="' + esc(d.makerHref) + '">' + esc(d.maker) + '</a>' + (made ? '<br><span>' + made + '</span>' : ''))
      + row('Its number', '<span class="wye-no">' + esc(d.number) + '</span>')
      + row('Copyright', esc(d.copyright))
      + row('The maker is paid', esc(d.paid))
      + row('Held', esc(d.held))
      + (d.open ? row('Free to use', 'Open to everyone, with the credit.') : row('To use it, license it', (d.uses || []).map(function (u) { return '<a class="wye-u" href="' + esc(u.href) + '"><b>' + esc(u.name) + '</b><i>' + esc(u.price) + '</i></a>'; }).join('')))
      + row('Never', (d.never || []).map(esc).join(' &middot; '))
      + row('Proof', esc(d.proof) + ' <a href="' + esc(d.life) + '">Its life</a> &middot; <a href="' + esc(d.verify) + '">Check a copy</a>')
      + '</dl>';
  }
  function open(slug) {
    ui(); sheet.hidden = false; requestAnimationFrame(function () { sheet.classList.add('on'); });
    if (cache[slug]) return draw(cache[slug]);
    body.innerHTML = '<p class="wye-k">The watermark</p><p class="wye-l">Reading it&hellip;</p>';
    fetch('/api/eye/' + encodeURIComponent(slug), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.none) { body.innerHTML = '<p class="wye-k">The watermark</p><p class="wye-l">This photograph is not shown just now.</p>'; return; }
      cache[slug] = d; draw(d);
    }).catch(function () { body.innerHTML = '<p class="wye-k">The watermark</p><p class="wye-l">It could not be read just now. Try again in a moment.</p>'; });
  }
  // Capture first, so the plate's own tap (the viewer, the stroll's rest) never fires underneath.
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-eye]'); if (!b) return; e.preventDefault(); e.stopPropagation(); open(b.getAttribute('data-eye')); }, true);
  ['pointerdown', 'touchstart', 'dblclick'].forEach(function (t) { document.addEventListener(t, function (e) { if (e.target.closest && e.target.closest('[data-eye]')) e.stopPropagation(); }, { capture: true, passive: true }); });
  window.WMEye = { open: open };
})();
