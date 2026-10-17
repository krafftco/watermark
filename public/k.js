/* The K on every Krafft photograph.
   Loaded on Krafft Studios (and any Krafft site). On a story, it asks Watermark which photographs are held
   there, then sets a small K seal in the corner of each one. Pressing it opens that photograph on Watermark,
   at checkout, to be collected; photographs held privately open a license request to the maker. At the end of the story, a quiet line leads to the room and to patronage.
   Served from watermark.krafftco.com/k.js; change it only here. */
(function () {
  if (window.__krafftK) return; window.__krafftK = 1;
  var WM = 'https://watermark.krafftco.com';
  var GLYPH = '<svg viewBox="0 0 51.66 51.88" fill="currentColor" aria-hidden="true"><path d="M20.35.14L.14,26V0c7.28,0,20.21.14,20.21.14Z"/><polygon points="51.66 51.88 31.73 51.84 27.51 45.27 38.12 32.14 51.66 51.88"/><polygon points="0 41.9 .14 51.71 9.97 51.84 51.66 .3 31.8 .14 0 41.9"/></svg>';
  var css = ''
    + '.wk{position:absolute;right:14px;bottom:14px;z-index:5;display:inline-flex;align-items:center;gap:0;height:40px;min-width:40px;padding:0;border:0;border-radius:999px;background:rgba(255,255,255,.94);color:#0e0e0e;box-shadow:0 4px 18px rgba(0,0,0,.18);text-decoration:none;font:500 11px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;opacity:0;transform:translateY(4px);transition:opacity .45s cubic-bezier(.16,1,.3,1),transform .45s cubic-bezier(.16,1,.3,1),gap .45s cubic-bezier(.16,1,.3,1),padding .45s cubic-bezier(.16,1,.3,1);-webkit-tap-highlight-color:transparent;cursor:pointer}'
    + '.wk-host:hover .wk,.wk:focus-visible{opacity:1;transform:none}'
    + '.wk i{display:grid;place-items:center;width:40px;height:40px;flex:none}'
    + '.wk svg{display:block;width:15px;height:15px;transition:transform .5s cubic-bezier(.34,1.56,.64,1)}'
    + '.wk b{max-width:0;overflow:hidden;white-space:nowrap;font-weight:500;transition:max-width .45s cubic-bezier(.16,1,.3,1)}'
    + '.wk:hover{gap:2px;padding-right:16px}.wk:hover b{max-width:120px}'
    + '.wk.is-down svg{transform:scale(.82)}'
    + '.wk::after{content:"";position:absolute;left:0;top:0;width:40px;height:40px;border-radius:50%;border:1px solid #fff;opacity:0;pointer-events:none}'
    + '.wk.is-up::after{animation:wkR .9s cubic-bezier(.16,1,.3,1) both}'
    + '@keyframes wkR{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(1.9)}}'
    + '@media (hover:none){.wk{opacity:.92;transform:none;right:10px;bottom:10px;height:36px;min-width:36px}.wk i{width:36px;height:36px}}'
    + '.wk-end{margin:clamp(48px,7vw,88px) auto 0;padding:32px 0 0;border-top:1px solid rgba(0,0,0,.12);max-width:720px;display:flex;gap:18px;align-items:flex-start;text-align:left}'
    + '.wk-end .wk-m{display:grid;place-items:center;flex:none;width:44px;height:44px;border-radius:50%;background:#0e0e0e;color:#f7f6f3}'
    + '.wk-end .wk-m svg{width:17px;height:17px}'
    + '.wk-end p{margin:0 0 10px;font-size:1.05em;line-height:1.5}'
    + '.wk-end a{color:inherit}'
    + '.wk-end small{display:block;font:500 11px/1.6 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;opacity:.7}'
    + '@media (prefers-reduced-motion:reduce){.wk,.wk *{transition:none!important;animation:none!important}}';

  function path(src) { var m = String(src || '').split('?')[0].replace(/\/size\/w\d+(\/format\/\w+)?\//, '/').replace(/_o(\.[a-z]+)$/i, '$1').match(/\/content\/images\/.+$/); return m ? m[0] : null; }
  function slug() { var p = location.pathname.replace(/^\/+|\/+$/g, '').split('/'); return p.length === 1 && p[0] ? p[0] : ''; }

  // Collect: straight to checkout for this photograph, and back to the story if they change their mind.
  function pay(w) {
    var f = document.createElement('form'); f.method = 'post'; f.action = WM + '/buy/' + encodeURIComponent(w.slug); f.style.display = 'none';
    [['use', 'social'], ['back', location.href.split('#')[0]]].forEach(function (kv) { var i = document.createElement('input'); i.type = 'hidden'; i.name = kv[0]; i.value = kv[1]; f.appendChild(i); });
    document.body.appendChild(f); f.submit();
  }
  function seal(w, img, lic) {
    var a = document.createElement('a');
    a.className = 'wk';
    if (w.collect) a.href = WM + '/w/' + w.slug + '?via=studios';
    else { var u = new URL(lic); u.searchParams.set('image', (img.currentSrc || img.src).replace(/\/size\/w\d+(\/format\/\w+)?\//, '/').split('?')[0]); u.searchParams.set('title', document.title); u.searchParams.set('from', location.href.split('#')[0]); a.href = u.toString(); }
    a.setAttribute('aria-label', (w.collect ? 'Collect ' : 'License ') + w.title);
    a.innerHTML = '<i>' + GLYPH + '</i><b>' + (w.collect ? 'Collect' : 'License') + '</b>';
    a.addEventListener('pointerdown', function () { a.classList.remove('is-up'); a.classList.add('is-down'); });
    a.addEventListener('pointerleave', function () { a.classList.remove('is-down'); });
    a.addEventListener('click', function (e) {
      e.stopPropagation(); // never open the theme's lightbox instead
      if (e.metaKey || e.ctrlKey) return; // a new tab still opens the photograph's page
      e.preventDefault(); a.classList.remove('is-down'); void a.offsetWidth; a.classList.add('is-up');
      try { navigator.vibrate && navigator.vibrate(8); } catch (x) {}
      setTimeout(function () { if (w.collect) pay(w); else location.href = a.href; }, 280);
    });
    return a;
  }

  function run(data) {
    if (!data || !data.works || !data.works.length) return;
    var by = {}; data.works.forEach(function (w) { if (w.collect || w.ask) by[w.path] = w; });
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var root = document.querySelector('article') || document.querySelector('main') || document.body;
    [].forEach.call(root.querySelectorAll('img'), function (img) {
      var w = by[path(img.currentSrc || img.src)] || by[path(img.getAttribute('src'))]; if (!w) return;
      var host = img.closest('figure, .kg-gallery-image, .kg-image-card') || img.parentElement;
      if (!host || host.querySelector(':scope > .wk')) return;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.classList.add('wk-host'); host.appendChild(seal(w, img, data.license || 'https://www.krafftco.com/license'));
    });
    if (!data.room) return;
    var end = document.createElement('aside'); end.className = 'wk-end';
    end.innerHTML = '<span class="wk-m">' + GLYPH + '</span><div><p>The photographs in this story are held on Watermark, each one numbered for the people who collect it.</p>'
      + '<small><a href="' + data.room.url + '">Walk the room: ' + data.room.title.replace(/[<>&]/g, '') + '</a>'
      + (data.patron ? ' &nbsp;&middot;&nbsp; <a href="' + data.patron + '">Become a patron</a>' : '') + '</small></div>';
    var content = root.querySelector('.gh-content, .post-content, .article-content, .k-content') || root;
    content.appendChild(end);
  }

  function go() {
    var s = slug(); if (!s || !document.querySelector('article')) return;
    fetch(WM + '/api/k?post=' + encodeURIComponent(s)).then(function (r) { return r.ok ? r.json() : null; }).then(run).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
