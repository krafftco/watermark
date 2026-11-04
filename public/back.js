// The way back (Will, 3 Nov: "we need more back buttons in the app"; "not enough to go back one step").
// Every page keeps a trail of where you have been this visit (sessionStorage wm_trail, the last twelve). The Back
// button on every page but the front door goes one step; the arrow beside it opens the trail, so you can go back
// three, five or ten places at once. With no trail (a link opened cold), Back goes to the page above this one.
(function () {
  var KEY = 'wm_trail', MAX = 12;
  var app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  if (app) document.documentElement.classList.add('wm-app');
  var here = location.pathname + location.search;
  function read() { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function write(t) { try { sessionStorage.setItem(KEY, JSON.stringify(t.slice(-MAX))); } catch (e) {} }
  function title() { return (document.title || '').split(/\s+[·|–]\s+/)[0].trim() || location.pathname; }
  if (window.top !== window) return;
  var t = read(), last = t[t.length - 1], prev = t[t.length - 2];
  if (last && last.p === here) last.t = title();                       // a reload
  else if (prev && prev.p === here) { t.pop(); t[t.length - 1].t = title(); } // went back one
  else {
    var at = -1; for (var i = t.length - 1; i >= 0; i--) if (t[i].p === here) { at = i; break; }
    if (at >= 0) t = t.slice(0, at + 1);                               // went back several: the trail ends here
    else t.push({ p: here, t: title() });
  }
  write(t);
  // The page above this one, for a link opened cold.
  function parent(p) {
    var s = p.replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (/^\/w\/[^/]+$/.test(s) || /^\/m\/[^/]+\/[^/]+$/.test(s)) return /^\/m\//.test(s) ? s.replace(/\/[^/]+$/, '') : '/collection';
    if (/^\/(account|studio|yours)\/.+/.test(s)) { var top = s.split('/').slice(0, 2).join('/'), up = s.replace(/\/[^/]+$/, ''); return up.length > top.length ? up : top; }
    var u = s.replace(/\/[^/]+$/, ''); return u || '/';
  }
  // Go back n places by the browser's own history (so Forward still works), and if nothing happens within half a
  // second (the history does not reach that far: a link opened cold), go there directly.
  function step(n, to) {
    var left = false; addEventListener('pagehide', function () { left = true; }, { once: true });
    if (history.length > n) history.go(-n);
    setTimeout(function () { if (!left && location.pathname + location.search === here) location.href = to; }, 500);
  }
  function setup() {
    var bs = document.querySelectorAll('[data-nv-back]'); if (!bs.length) return;
    var path = location.pathname;
    if (path === '/' || path === '/house' || path === '/wander') return;
    var trail = read(); var back = trail.slice(0, -1).reverse();     // newest first, without here
    bs.forEach(function (b) {
      b.hidden = false;
      var up = back[0] ? back[0].p : parent(here);
      b.title = back[0] ? 'Back to ' + back[0].t : 'Up a level';
      b.onclick = function (e) { if (e && e.preventDefault) e.preventDefault(); step(1, up); };
      var wrap = b.parentNode, more = wrap && wrap.querySelector('[data-nv-trail]');
      if (!more || back.length < 2) return;
      more.hidden = false;
      var menu = document.createElement('div'); menu.className = 'bkt'; menu.hidden = true; menu.setAttribute('role', 'menu');
      menu.innerHTML = '<p class="bkt-h">Where you have been</p>' + back.map(function (s, i) {
        return '<a role="menuitem" href="' + s.p.replace(/"/g, '&quot;') + '" data-bkt="' + (i + 1) + '"><span class="bkt-n">' + (i + 1) + '</span><span class="bkt-t"></span></a>';
      }).join('') + '<a role="menuitem" class="bkt-home" href="/">The front door</a>';
      menu.querySelectorAll('.bkt-t').forEach(function (el, i) { el.textContent = back[i].t; });
      wrap.appendChild(menu);
      function close() { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); }
      more.onclick = function (e) { e.preventDefault(); e.stopPropagation(); menu.hidden = !menu.hidden; more.setAttribute('aria-expanded', String(!menu.hidden)); };
      menu.addEventListener('click', function (e) {
        var a = e.target.closest('a[data-bkt]'); if (!a) return;
        e.preventDefault(); step(+a.getAttribute('data-bkt'), a.getAttribute('href'));
      });
      document.addEventListener('click', function (e) { if (!menu.hidden && !e.target.closest('.bkt')) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
      // A long press on Back opens the trail too.
      var hold; b.addEventListener('pointerdown', function () { hold = setTimeout(function () { hold = 'held'; more.click(); }, 500); });
      b.addEventListener('pointerup', function (e) { if (hold === 'held') { e.preventDefault(); b.addEventListener('click', function s(ev) { ev.stopImmediatePropagation(); ev.preventDefault(); b.removeEventListener('click', s, true); }, true); } clearTimeout(hold); hold = null; });
      b.addEventListener('pointerleave', function () { if (hold !== 'held') clearTimeout(hold); });
    });
  }
  // A swipe in from the left edge goes back, as on Instagram (the installed app has no browser to do it). An arrow
  // follows the thumb; past 90 px it is lit and letting go goes back; anywhere short of that, nothing happens.
  function swipe() {
    var p = location.pathname; if (!app || p === '/' || p === '/house' || p === '/wander') return;
    var x0, y0, on = false, dx = 0, chip;
    function go() { var b = document.querySelector('[data-nv-back]:not([hidden])'); if (b) b.onclick(new Event('click')); else history.back(); }
    addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return; var t = e.touches[0];
      if (t.clientX > 24) return; x0 = t.clientX; y0 = t.clientY; on = true; dx = 0;
    }, { passive: true });
    addEventListener('touchmove', function (e) {
      if (!on) return; var t = e.touches[0]; dx = t.clientX - x0; var dy = Math.abs(t.clientY - y0);
      if (dy > 40 && dy > dx) { on = false; if (chip) chip.remove(); chip = null; return; }
      if (dx < 8) return;
      if (!chip) { chip = document.createElement('div'); chip.className = 'bks'; chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'; chip.style.transition = 'background .15s'; document.body.appendChild(chip); }
      var d = Math.min(dx, 140); chip.style.top = (t.clientY - 22) + 'px'; chip.style.transform = 'translateX(' + (d * 0.6 - 44) + 'px)'; chip.classList.toggle('on', dx > 90);
      if (dx > 8 && e.cancelable) e.preventDefault();
    }, { passive: false });
    addEventListener('touchend', function () {
      if (!on) return; on = false; var far = dx > 90;
      if (chip) { var c = chip; chip = null; c.style.transition = ''; c.offsetWidth; c.style.transform = far ? 'translateX(40px)' : 'translateX(-44px)'; c.style.opacity = '0'; setTimeout(function () { c.remove(); }, 260); }
      if (far) { if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) {} go(); }
    });
    addEventListener('touchcancel', function () { on = false; if (chip) { chip.remove(); chip = null; } });
  }
  swipe();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
