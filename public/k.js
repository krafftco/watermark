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
    + '.wk{position:absolute;right:12px;bottom:12px;z-index:5;-webkit-tap-highlight-color:transparent}'
    + '.wk>a{position:relative;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0);color:#fff;opacity:.5;text-decoration:none;cursor:pointer;transition:opacity .5s cubic-bezier(.16,1,.3,1),background .5s cubic-bezier(.16,1,.3,1),color .5s cubic-bezier(.16,1,.3,1),box-shadow .5s cubic-bezier(.16,1,.3,1),transform .3s cubic-bezier(.16,1,.3,1)}'
    + '.wk-host:hover .wk>a{opacity:.85}.wk>a:hover,.wk.is-open>a,.wk>a:focus-visible{opacity:1;background:rgba(255,255,255,.95);color:#0e0e0e;box-shadow:0 4px 18px rgba(0,0,0,.18)}'
    + '.wk>a i{display:grid;place-items:center}.wk svg{display:block;width:12px;height:12px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));transition:filter .5s}.wk>a:hover svg,.wk.is-open>a svg,.wk>a:focus-visible svg{filter:none}'
    + '.wk>a:active{transform:scale(.9)}'
    + '.wk>a::after{content:"";position:absolute;inset:0;border-radius:50%;border:1px solid #fff;opacity:0;pointer-events:none}.wk.is-up>a::after{animation:wkR .9s cubic-bezier(.16,1,.3,1) both}'
    + '@keyframes wkR{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(1.9)}}'
    + '.wk-c{position:absolute;right:0;bottom:46px;min-width:248px;max-width:min(300px,calc(100vw - 32px));margin:0;padding:6px;list-style:none;background:rgba(255,255,255,.97);color:#0e0e0e;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.22),0 2px 6px rgba(0,0,0,.08);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);font:400 14px/1.2 \"Helvetica Neue\",Helvetica,Arial,sans-serif;letter-spacing:0;text-transform:none;text-align:left;opacity:0;visibility:hidden;transform:translateY(8px) scale(.97);transform-origin:100% 100%;transition:opacity .35s cubic-bezier(.16,1,.3,1),transform .45s cubic-bezier(.16,1,.3,1),visibility 0s linear .45s}'
    + '.wk.is-open .wk-c{opacity:1;visibility:visible;transform:none;transition:opacity .35s cubic-bezier(.16,1,.3,1),transform .45s cubic-bezier(.16,1,.3,1),visibility 0s}'
    + '.wk-c::after{content:"";position:absolute;right:13px;bottom:-5px;width:10px;height:10px;background:inherit;transform:rotate(45deg);border-radius:2px}'
    + '.wk-c li{margin:0;padding:0}.wk-c li+li{border-top:1px solid rgba(0,0,0,.07)}'
    + '.wk-c button,.wk-c a{display:flex;align-items:center;gap:12px;width:100%;padding:12px 12px;border:0;border-radius:9px;background:none;color:inherit;font:inherit;text-align:left;text-decoration:none;cursor:pointer;transition:background .25s}'
    + '.wk-c button:hover,.wk-c button:focus-visible,.wk-c a:hover{background:rgba(0,0,0,.05);outline:none}'
    + '.wk-c b{font-weight:500;flex:1}.wk-c em{font-style:normal;color:#6f6c66;font-variant-numeric:tabular-nums}.wk-c i{font-style:normal;color:#9b978f;transition:transform .3s cubic-bezier(.16,1,.3,1)}.wk-c button:hover i{transform:translateX(3px)}'
    + '.wk-c .wk-h{padding:10px 12px 8px;font:500 10px/1.3 \"Helvetica Neue\",Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#8a867f}'
    + '.wk-c li.is-go button{background:#0e0e0e;color:#f7f6f3}.wk-c li.is-go em,.wk-c li.is-go i{color:#f7f6f3}'
    + '.wk-c li:nth-child(n){opacity:0;transform:translateY(4px);transition:opacity .3s cubic-bezier(.16,1,.3,1),transform .4s cubic-bezier(.16,1,.3,1)}.wk.is-open .wk-c li{opacity:1;transform:none}'
    + '.wk.is-open .wk-c li:nth-child(2){transition-delay:.03s}.wk.is-open .wk-c li:nth-child(3){transition-delay:.06s}.wk.is-open .wk-c li:nth-child(4){transition-delay:.09s}.wk.is-open .wk-c li:nth-child(5){transition-delay:.12s}.wk.is-open .wk-c li:nth-child(6){transition-delay:.15s}.wk.is-open .wk-c li:nth-child(7){transition-delay:.18s}'
    + '@media (hover:none){.wk{right:8px;bottom:8px}.wk>a{opacity:.45}}'
    + '.wk-c,.wk-c *{box-sizing:border-box}'
    + '.wk.is-below .wk-c{bottom:auto;top:46px;transform-origin:100% 0}.wk.is-below .wk-c::after{bottom:auto;top:-5px}'
    + '@media (max-width:640px){.wk-c{position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom))!important;top:auto!important;transform-origin:50% 100%!important;max-width:none;min-width:0;padding:8px;border-radius:18px;transform:translateY(24px);font-size:16px;z-index:2147483000}.wk-c::after{display:none}.wk-c button,.wk-c a{padding:15px 14px}'
      + '.wk::before{content:"";position:fixed;inset:0;background:rgba(0,0,0,.28);opacity:0;visibility:hidden;transition:opacity .35s cubic-bezier(.16,1,.3,1),visibility 0s linear .35s;z-index:2147482999}.wk.is-open::before{opacity:1;visibility:visible;transition:opacity .35s cubic-bezier(.16,1,.3,1)}}'
    + '.wk-end{margin:clamp(48px,7vw,88px) auto 0;padding:32px 0 0;border-top:1px solid rgba(0,0,0,.12);max-width:720px;display:flex;gap:18px;align-items:flex-start;text-align:left}'
    + '.wk-end .wk-m{display:grid;place-items:center;flex:none;width:44px;height:44px;border-radius:50%;background:#0e0e0e;color:#f7f6f3}'
    + '.wk-end .wk-m svg{width:17px;height:17px}'
    + '.wk-end p{margin:0 0 10px;font-size:1.05em;line-height:1.5}'
    + '.wk-end a{color:inherit}'
    + '.wk-end small{display:block;font:500 11px/1.6 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;opacity:.7}'

    + '.wk-crs{display:flex;flex-wrap:wrap;gap:6px 22px;margin:0 0 12px!important;font-size:1em}.wk-cr em{font:500 10px/1 \"Helvetica Neue\",Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;font-style:normal;opacity:.6;margin-right:6px}'
    + '.wk-tip{display:inline-block;margin:2px 0 6px;padding:11px 20px;border-radius:999px;background:#0e0e0e;color:#f7f6f3!important;text-decoration:none;font:500 11px/1 \"Helvetica Neue\",Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;transition:background .3s}.wk-tip:hover{background:#000}'
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
  // The K. Tap it (or click it) and a small card unfolds above it with every way to have the photograph;
  // one tap on a line goes straight there. Tap the K again, press Escape or tap elsewhere to close it.
  function money(c) { return '$' + Math.round(c / 100).toLocaleString('en-US'); }
  function seal(w, img, lic) {
    var box = document.createElement('span'); box.className = 'wk';
    var k = document.createElement('a'); k.innerHTML = '<i>' + GLYPH + '</i>'; k.setAttribute('role', 'button'); k.setAttribute('aria-haspopup', 'menu'); k.setAttribute('aria-expanded', 'false');
    k.setAttribute('aria-label', 'Collect or license ' + w.title);
    var uses = w.uses && w.uses.length ? w.uses : w.collect ? [{ k: 'social', l: 'Collect' }] : [];
    var card = document.createElement('ul'); card.className = 'wk-c'; card.setAttribute('role', 'menu');
    var html = '<li class="wk-h" role="presentation">' + (uses.length ? 'Have this photograph' : 'Held privately') + '</li>';
    if (uses.length) {
      k.href = (w.page || (WM + '/w/' + w.slug)) + '?via=studios';
      uses.forEach(function (u) { html += '<li role="none"><button type="button" role="menuitem" data-k="' + u.k + '"><b>' + u.l + '</b>' + (u.p ? '<em>' + money(u.p) + '</em>' : u.ask ? '<em>Ask</em>' : '') + '<i>&rsaquo;</i></button></li>'; });
      html += '<li role="none"><a role="menuitem" href="' + k.href + '"><b>See it on Watermark</b><i>&rsaquo;</i></a></li>';
    } else {
      var u = new URL(lic); u.searchParams.set('image', (img.currentSrc || img.src).replace(/\/size\/w\d+(\/format\/\w+)?\//, '/').split('?')[0]); u.searchParams.set('title', document.title); u.searchParams.set('from', location.href.split('#')[0]);
      k.href = u.toString();
      html += '<li role="none"><a role="menuitem" href="' + k.href + '"><b>Ask to license it</b><i>&rsaquo;</i></a></li>';
    }
    card.innerHTML = html;
    box.appendChild(card); box.appendChild(k);
    function setOpen(on) { if (on) { var r = k.getBoundingClientRect(); box.classList.toggle('is-below', r.top < card.offsetHeight + 60); } box.classList.toggle('is-open', on); k.setAttribute('aria-expanded', on ? 'true' : 'false'); if (on) { var f = card.querySelector('button,a'); if (f && document.activeElement === k) f.focus({ preventScroll: true }); } }
    k.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); // never the theme's lightbox
      if (e.metaKey || e.ctrlKey) { window.open(k.href, '_blank'); return; }
      setOpen(!box.classList.contains('is-open'));
    });
    card.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest('button[data-k]'); if (!b) return;
      e.preventDefault();
      var li = b.parentNode; li.classList.add('is-go');
      box.classList.remove('is-up'); void box.offsetWidth; box.classList.add('is-up');
      try { navigator.vibrate && navigator.vibrate(8); } catch (x) {}
      setTimeout(function () { commit(w, b.getAttribute('data-k')); }, 260);
    });
    card.addEventListener('keydown', function (e) {
      var items = [].slice.call(card.querySelectorAll('button,a')), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && box.classList.contains('is-open')) { setOpen(false); k.focus(); } });
    document.addEventListener('pointerdown', function (e) { if (!box.contains(e.target) || e.target === box) setOpen(false); });
    return box;
  }

  function run(data) {
    if (!data || !data.works || !data.works.length) return;
    var by = {}; data.works.forEach(function (w) { if (w.collect || w.ask) by[w.path] = w; });
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var root = document.querySelector('article') || document.querySelector('main') || document.body, fits = [];
    [].forEach.call(root.querySelectorAll('img'), function (img) {
      var w = by[path(img.currentSrc || img.src)] || by[path(img.getAttribute('src'))]; if (!w) return;
      var host = img.closest('figure, .kg-gallery-image, .kg-image-card') || img.parentElement;
      if (!host || host.querySelector(':scope > .wk')) return;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.classList.add('wk-host'); var sl = seal(w, img, data.license || 'https://www.krafftco.com/license'); host.appendChild(sl);
      // Sit on the photograph itself, not on its figure (which may carry a caption below it).
      var fit = function () { var h = host.getBoundingClientRect(), r = img.getBoundingClientRect(); if (!r.width) return; var inset = window.matchMedia('(hover:none)').matches ? 8 : 12;
        sl.style.right = Math.round(h.right - r.right + inset) + 'px'; sl.style.bottom = Math.round(h.bottom - r.bottom + inset) + 'px'; };
      fit(); if (!img.complete) img.addEventListener('load', fit); fits.push(fit);
    });
    window.addEventListener('resize', function () { fits.forEach(function (f) { f(); }); });
    var cr = data.credits, tipUrl = cr && cr.tip ? cr.tip + '?back=' + encodeURIComponent(location.href.split('#')[0]) : null;
    if (!data.room && !tipUrl && !data.wander) return;
    var esc = function (t) { return String(t).replace(/[<>&"]/g, ''); };
    var names = cr ? cr.people.map(function (p) { return '<span class="wk-cr"><em>' + esc(p.label) + '</em> ' + esc(p.name) + '</span>'; }).join('') : '';
    var ROLE = { Words: 'writer', Photographs: 'photographer', Narration: 'narrator', Film: 'filmmaker', Music: 'composer' };
    var who = !cr ? '' : cr.people.length === 1 ? cr.people[0].name : cr.people.length === 2 && cr.people.every(function (p) { return ROLE[p.label]; }) ? 'the ' + ROLE[cr.people[0].label] + ' and the ' + ROLE[cr.people[1].label] : 'the people who made it';
    var end = document.createElement('aside'); end.className = 'wk-end';
    end.innerHTML = '<span class="wk-m">' + GLYPH + '</span><div>'
      + (names ? '<p class="wk-crs">' + names + '</p>' : '')
      + (tipUrl ? '<p><a class="wk-tip" href="' + tipUrl + '">Tip ' + esc(who) + '</a></p>' : '')
      + '<small>' + (data.wander ? '<a href="' + data.wander + '">Wander from here</a>' + (data.room || data.patron ? ' &nbsp;&middot;&nbsp; ' : '') : '') + (data.room ? '<a href="' + data.room.url + '">Walk the room: ' + esc(data.room.title) + '</a>' : '')
      + (data.room && data.patron ? ' &nbsp;&middot;&nbsp; ' : '') + (data.patron ? '<a href="' + data.patron + '">Become a patron</a>' : '') + '</small></div>';
    var content = root.querySelector('.gh-content, .post-content, .article-content, .k-content') || root;
    content.appendChild(end);
  }

  function go() {
    var s = slug(); if (!s || !document.querySelector('article')) return;
    fetch(WM + '/api/k?post=' + encodeURIComponent(s)).then(function (r) { return r.ok ? r.json() : null; }).then(run).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
