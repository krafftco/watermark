/* A reading of the screen (14 Nov): any page with ?vv=1 shows what the device reports about its own height, so what one tablet does (a gap under the tab bar, a bar that will not take a press) can be understood from a screenshot. Shown to no one who does not ask for it. */
(function () {
  if (!/[?&]vv=1(?:&|$)/.test(location.search)) return;
  var b = document.createElement('pre');
  b.style.cssText = 'position:fixed;left:8px;top:calc(8px + env(safe-area-inset-top));z-index:9999;margin:0;padding:8px 10px;background:rgba(0,0,0,.82);color:#9f9;font:12px/1.45 ui-monospace,Menlo,monospace;border-radius:8px;pointer-events:none;white-space:pre';
  var probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none';
  var px = function (h) { probe.style.height = h; return Math.round(probe.getBoundingClientRect().height); };
  var bot = document.createElement('div'); bot.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:3px;background:#f33;z-index:9999;pointer-events:none';
  function read() {
    var vv = window.visualViewport, tb = document.querySelector('.tb'), r = tb ? tb.getBoundingClientRect() : null, st = document.querySelector('main.st'), sr = st ? st.getBoundingClientRect() : null;
    var sa = function (n) { probe.style.height = 'env(safe-area-inset-' + n + ')'; return Math.round(probe.getBoundingClientRect().height); };
    b.textContent = [
      'inner ' + innerWidth + ' x ' + innerHeight,
      'client ' + document.documentElement.clientWidth + ' x ' + document.documentElement.clientHeight,
      'visual ' + (vv ? Math.round(vv.width) + ' x ' + Math.round(vv.height) + ' top ' + Math.round(vv.offsetTop) + ' scale ' + vv.scale.toFixed(2) : 'none'),
      'screen ' + screen.width + ' x ' + screen.height + ' avail ' + screen.availHeight + ' dpr ' + devicePixelRatio,
      'vh ' + px('100vh') + ' dvh ' + px('100dvh') + ' svh ' + px('100svh') + ' lvh ' + px('100lvh'),
      'safe t' + sa('top') + ' b' + sa('bottom'),
      'stage ' + (sr ? Math.round(sr.top) + '..' + Math.round(sr.bottom) : 'none') + '  tabs ' + (r ? Math.round(r.top) + '..' + Math.round(r.bottom) : 'none'),
      'standalone ' + (navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)) + '  scrollY ' + Math.round(scrollY),
      (navigator.userAgent.match(/(CriOS|FxiOS|EdgiOS|Version)\/[\d.]+/) || ['?'])[0] + ' ' + (navigator.userAgent.match(/(iPad|iPhone|Macintosh|Android)/) || ['?'])[0] + ' touch ' + navigator.maxTouchPoints
    ].join('\n');
  }
  var last = 'no press yet';
  ['pointerdown', 'click'].forEach(function (ev) { document.addEventListener(ev, function (e) { var t = e.target, el = document.elementFromPoint(e.clientX, e.clientY); last = ev + ' ' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ' on ' + (t.tagName || '?') + '.' + String(t.className || '').split(' ')[0].slice(0, 18) + (el && el !== t ? ' (under the point: ' + el.tagName + '.' + String(el.className || '').split(' ')[0].slice(0, 18) + ')' : ''); }, true); });
  var read0 = read; read = function () { read0(); var d = document.querySelector('dialog[data-rm]'); b.textContent += '\n' + last + '\nrooms sheet ' + (d ? 'open=' + d.open + ' modal=' + (d.matches && d.matches(':modal')) + ' showModal=' + (typeof d.showModal) : 'none'); };
  document.body.appendChild(probe); document.body.appendChild(bot); document.body.appendChild(b); read(); setInterval(function () { read(); }, 500);
})();
