/* Bravo! The hat is a nod; this is the standing ovation. Scarce (a few a month), so it means something.
   On a yes: the word swells, gold flecks fly, the phone answers in the hand. Press again to take it back. */
(function () {
  var f = document.querySelector('[data-bv]'); if (!f) return;
  var b = f.querySelector('.bv-b'), t = document.querySelector('[data-bv-t]'), say = document.querySelector('[data-bv-say]'), busy = false;
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function count(n) { t.hidden = !n; t.textContent = n === 1 ? 'One bravo' : n + ' bravos'; }
  function tell(s) { say.textContent = s; say.hidden = !s; }
  function burst() {
    try { navigator.vibrate && navigator.vibrate([14, 50, 14, 50, 40]); } catch (e) {}
    b.classList.remove('cheer'); void b.offsetWidth; b.classList.add('cheer');
    if (still) return;
    var r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var layer = document.createElement('div'); layer.className = 'bv-fx'; document.body.appendChild(layer);
    var tones = ['#c9a45c', '#e8d29a', '#b38a3e', '#f4ead0', '#ffffff'];
    for (var i = 0; i < 34; i++) {
      var p = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 150;
      p.style.left = cx + 'px'; p.style.top = cy + 'px'; p.style.background = tones[i % tones.length];
      p.style.setProperty('--x', Math.cos(a) * d + 'px'); p.style.setProperty('--y', (Math.sin(a) * d - 60) + 'px');
      p.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg'); p.style.animationDelay = (Math.random() * 80) + 'ms';
      if (i % 3 === 0) { p.style.width = '4px'; p.style.height = '10px'; }
      layer.appendChild(p);
    }
    var w = document.createElement('b'); w.textContent = 'Bravo!'; w.style.left = cx + 'px'; w.style.top = cy + 'px'; layer.appendChild(w);
    setTimeout(function () { layer.remove(); }, 1700);
  }
  b.addEventListener('click', function () {
    if (busy) return; busy = true;
    var was = b.classList.contains('on');
    if (!was) burst();
    b.classList.toggle('on', !was); b.setAttribute('aria-pressed', !was ? 'true' : 'false');
    fetch(f.getAttribute('action'), { method: 'POST', headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        count(j.n || 0);
        if (j.spent) { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); tell('Your ' + (j.of || 3) + ' bravos this month are given. Take one back to give it here.'); return; }
        if (!j.ok) throw 0;
        b.classList.toggle('on', j.on); b.setAttribute('aria-pressed', j.on ? 'true' : 'false');
        tell(j.on ? (j.left ? 'Bravo. The maker is told. ' + j.left + ' left this month.' : 'Bravo. The maker is told. That was your last this month.') : '');
      })
      .catch(function () { b.classList.toggle('on', was); })
      .then(function () { busy = false; });
  });
})();
