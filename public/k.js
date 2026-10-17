/* The K on every Krafft photograph. Its label toggles between the ways to have it; the K commits.
   Loaded on Krafft Studios (and any Krafft site). On a story, it asks Watermark which photographs are held
   there, then sets a small K seal in the corner of each one. Pressing it opens that photograph on Watermark,
   at checkout, to be collected; photographs held privately open a license request to the maker. At the end of the story, a quiet line leads to the room and to patronage.
   Served from watermark.krafftco.com/k.js; change it only here. */
(function () {
  if (window.__krafftK) return; window.__krafftK = 1;
  var WM = 'https://watermark.krafftco.com';
  var GLYPH = '<svg viewBox="0 0 51.66 51.88" fill="currentColor" aria-hidden="true"><path d="M20.35.14L.14,26V0c7.28,0,20.21.14,20.21.14Z"/><polygon points="51.66 51.88 31.73 51.84 27.51 45.27 38.12 32.14 51.66 51.88"/><polygon points="0 41.9 .14 51.71 9.97 51.84 51.66 .3 31.8 .14 0 41.9"/></svg>';
  var css = ''
    + '.wk{position:absolute;right:12px;bottom:12px;z-index:5;display:inline-flex;align-items:center;gap:0;height:36px;min-width:36px;padding:0;border:0;border-radius:999px;background:rgba(255,255,255,0);color:#fff;box-shadow:none;text-decoration:none;font:500 11px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;opacity:.5;transition:opacity .5s cubic-bezier(.16,1,.3,1),background .5s cubic-bezier(.16,1,.3,1),color .5s cubic-bezier(.16,1,.3,1),box-shadow .5s cubic-bezier(.16,1,.3,1),gap .45s cubic-bezier(.16,1,.3,1),padding .45s cubic-bezier(.16,1,.3,1);-webkit-tap-highlight-color:transparent;cursor:pointer}'
    + '.wk-host:hover .wk{opacity:.85}.wk:hover,.wk.is-open,.wk:focus-within{opacity:1;background:rgba(255,255,255,.95);color:#0e0e0e;box-shadow:0 4px 18px rgba(0,0,0,.18)}'
    + '.wk>a{display:grid;place-items:center;color:inherit;text-decoration:none;flex:none}.wk i{display:grid;place-items:center;width:36px;height:36px;flex:none}'
    + '.wk svg{display:block;width:12px;height:12px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));transition:transform .5s cubic-bezier(.34,1.56,.64,1),filter .5s}.wk:hover svg,.wk.is-open svg,.wk:focus-within svg{filter:none}'
    + '.wk b{max-width:0;overflow:hidden;white-space:nowrap;font-weight:500;transition:max-width .45s cubic-bezier(.16,1,.3,1)}'
    + '.wk.is-down svg{transform:scale(.82)}'
    + '.wk::after{content:"";position:absolute;left:0;top:0;width:36px;height:36px;border-radius:50%;border:1px solid #fff;opacity:0;pointer-events:none}'
    + '.wk.is-up::after{animation:wkR .9s cubic-bezier(.16,1,.3,1) both}'
    + '@keyframes wkR{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(1.9)}}'
    + '@media (hover:none){.wk{right:8px;bottom:8px;opacity:.45}}'
    + '.wk-end{margin:clamp(48px,7vw,88px) auto 0;padding:32px 0 0;border-top:1px solid rgba(0,0,0,.12);max-width:720px;display:flex;gap:18px;align-items:flex-start;text-align:left}'
    + '.wk-end .wk-m{display:grid;place-items:center;flex:none;width:44px;height:44px;border-radius:50%;background:#0e0e0e;color:#f7f6f3}'
    + '.wk-end .wk-m svg{width:17px;height:17px}'
    + '.wk-end p{margin:0 0 10px;font-size:1.05em;line-height:1.5}'
    + '.wk-end a{color:inherit}'
    + '.wk-end small{display:block;font:500 11px/1.6 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;opacity:.7}'
    + '.wk .wk-l{appearance:none;border:0;background:none;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px;max-width:0;overflow:hidden;white-space:nowrap;padding:0;transition:max-width .45s cubic-bezier(.16,1,.3,1)}'
    + '.wk.is-open{gap:2px;padding-right:14px}.wk.is-open .wk-l{max-width:220px}'
    + '.wk .wk-l em{font-style:normal;display:inline-block}.wk .wk-l em.in{animation:wkT .4s cubic-bezier(.16,1,.3,1) both}'
    + '.wk .wk-d{display:inline-flex;gap:3px}.wk .wk-d s{width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.25;text-decoration:none}.wk .wk-d s.on{opacity:1}'
    + '@keyframes wkT{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}'

    + '@media (prefers-reduced-motion:reduce){.wk,.wk *{transition:none!important;animation:none!important}}';

  function path(src) { var m = String(src || '').split('?')[0].replace(/\/size\/w\d+(\/format\/\w+)?\//, '/').replace(/_o(\.[a-z]+)$/i, '$1').match(/\/content\/images\/.+$/); return m ? m[0] : null; }
  function slug() { var p = location.pathname.replace(/^\/+|\/+$/g, '').split('/'); return p.length === 1 && p[0] ? p[0] : ''; }

  // The K. Open it (hover, or a first tap on a phone) and its label toggles between the ways to have the
  // photograph: Collect, In a story, For a company, Before an audience, On a wall. Pressing the K commits.
  function commit(w, key) {
    var f = document.createElement('form'); f.method = 'post'; f.action = WM + '/buy/' + encodeURIComponent(w.slug); f.style.display = 'none';
    [['use', key], ['back', location.href.split('#')[0]]].forEach(function (kv) { var i = document.createElement('input'); i.type = 'hidden'; i.name = kv[0]; i.value = kv[1]; f.appendChild(i); });
    document.body.appendChild(f); f.submit();
  }
  function seal(w, img, lic) {
    var box = document.createElement('span'); box.className = 'wk';
    var uses = (w.uses && w.uses.length ? w.uses : w.collect ? [{ k: 'social', l: 'Collect' }] : []), at = 0;
    var k = document.createElement('a'); k.innerHTML = '<i>' + GLYPH + '</i>';
    var lb = document.createElement('button'); lb.type = 'button'; lb.className = 'wk-l';
    if (uses.length) {
      k.href = WM + '/w/' + w.slug + '?via=studios';
      lb.innerHTML = '<em></em>' + (uses.length > 1 ? '<span class="wk-d">' + uses.map(function () { return '<s></s>'; }).join('') + '</span>' : '');
    } else {
      var u = new URL(lic); u.searchParams.set('image', (img.currentSrc || img.src).replace(/\/size\/w\d+(\/format\/\w+)?\//, '/').split('?')[0]); u.searchParams.set('title', document.title); u.searchParams.set('from', location.href.split('#')[0]);
      k.href = u.toString(); lb.innerHTML = '<em>License</em>';
    }
    function show(anim) {
      if (!uses.length) return; var em = lb.querySelector('em'); em.textContent = uses[at].l;
      if (anim) { em.classList.remove('in'); void em.offsetWidth; em.classList.add('in'); }
      [].forEach.call(lb.querySelectorAll('s'), function (d, i) { d.className = i === at ? 'on' : ''; });
      k.setAttribute('aria-label', uses[at].l + ': ' + w.title);
      lb.setAttribute('aria-label', 'Showing ' + uses[at].l + '. Tap for the next way to have it');
    }
    show(false);
    box.appendChild(k); box.appendChild(lb);
    var noHover = window.matchMedia && matchMedia('(hover: none)').matches, touch = noHover;
    box.addEventListener('pointerdown', function (e) { touch = noHover || e.pointerType === 'touch'; });
    box.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse' && !noHover) box.classList.add('is-open'); });
    box.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'mouse') return; box.classList.remove('is-open'); box.classList.remove('is-down'); });
    lb.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!box.classList.contains('is-open')) { box.classList.add('is-open'); return; }
      if (uses.length > 1) { at = (at + 1) % uses.length; show(true); } else if (!uses.length) location.href = k.href;
    });
    k.addEventListener('pointerdown', function () { box.classList.remove('is-up'); box.classList.add('is-down'); });
    k.addEventListener('click', function (e) {
      e.stopPropagation(); // never open the theme's lightbox instead
      if (e.metaKey || e.ctrlKey) return; // a new tab still opens the photograph's page
      e.preventDefault();
      if (touch && !box.classList.contains('is-open')) { box.classList.add('is-open'); box.classList.remove('is-down'); return; } // first tap opens
      box.classList.remove('is-down'); void box.offsetWidth; box.classList.add('is-up');
      try { navigator.vibrate && navigator.vibrate(8); } catch (x) {}
      setTimeout(function () { if (uses.length) commit(w, uses[at].k); else location.href = k.href; }, 280);
    });
    // A tap anywhere else closes it again.
    document.addEventListener('pointerdown', function (e) { if (!box.contains(e.target)) box.classList.remove('is-open'); });
    return box;
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
