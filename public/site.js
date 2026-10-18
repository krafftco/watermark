/* Watermark on a company's own site. One line in the page:
     <script src="__WM_BASE__/site.js" data-client="natora" defer></script>
   then data-wm on each photograph Watermark holds for them (a slug, a ref WM-2026-000123, or a Watermark number):
     <img data-wm="the-staircase" alt="…">
   The image is served under its license (counted by page), and the credit sits on it: the maker, the license, and
   the number anyone can check. data-wm-keep keeps the site's own image file; data-wm-credit="below" sets the credit
   beneath instead of on the picture; "none" leaves it to the site. When a license has ended, the photograph is
   no longer shown. */
(function () {
  var BASE = '__WM_BASE__';
  var me = document.currentScript || document.querySelector('script[src*="/site.js"]');
  var who = me && (me.getAttribute('data-client') || (me.src.match(/[?&]c=([\w-]+)/) || [])[1]);
  if (!who) return;
  var css = '.wm-f{position:relative;display:block;margin:0}.wm-f>img{display:block;width:100%;height:auto}' +
    '.wm-c{position:absolute;left:10px;bottom:10px;max-width:calc(100% - 20px);padding:5px 9px;background:rgba(11,10,9,.55);color:#f2ede4;font:500 10px/1.4 "Helvetica Neue",Arial,sans-serif;letter-spacing:.06em;text-decoration:none;border-radius:2px;opacity:.75;transition:opacity .3s;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
    '.wm-f:hover .wm-c,.wm-c:focus-visible{opacity:1}.wm-c b{font-weight:600}.wm-c i{font-style:normal;opacity:.7;margin-left:6px}' +
    '.wm-f.wm-below .wm-c{position:static;display:inline-block;margin-top:6px;padding:0;background:none;color:inherit;opacity:.65;-webkit-backdrop-filter:none;backdrop-filter:none}' +
    '.wm-gone{display:flex;align-items:center;justify-content:center;min-height:180px;background:#ece7de;color:#5c564d;font:400 12px/1.5 "Helvetica Neue",Arial,sans-serif;text-align:center;padding:20px}' +
    '@media (max-width:520px){.wm-c i{display:none}}';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function digits(s) { return String(s || '').replace(/[^0-9]/g, ''); }
  function run(data) {
    var by = {};
    (data.works || []).forEach(function (w) { by[w.slug] = by[w.ref] = by[digits(w.number)] = w; });
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    [].forEach.call(document.querySelectorAll('[data-wm]'), function (img) {
      if (img.__wm) return; img.__wm = 1;
      var key = img.getAttribute('data-wm'), w = by[key] || by[digits(key)];
      if (!w) return;
      var mode = img.getAttribute('data-wm-credit') || '';
      if (!w.live) {
        var gone = document.createElement('div'); gone.className = 'wm-gone';
        gone.innerHTML = esc(w.title) + ' &middot; ' + esc(w.maker) + '<br>The license for this photograph has ended.';
        img.replaceWith(gone); return;
      }
      if (img.tagName === 'IMG' && !img.hasAttribute('data-wm-keep')) {
        img.src = w.image.screen; img.srcset = w.image.screen + ' 1600w, ' + w.image.large + ' 2400w';
        if (!img.sizes) img.sizes = '100vw';
        if (!img.alt) img.alt = w.title + ', a photograph by ' + w.maker;
        if (w.width && w.height) { img.width = w.width; img.height = w.height; }
      }
      img.setAttribute('data-wm-ref', w.ref);
      if (mode === 'none') return;
      var fig = document.createElement('figure'); fig.className = 'wm-f' + (mode === 'below' ? ' wm-below' : '');
      img.parentNode.insertBefore(fig, img); fig.appendChild(img);
      var a = document.createElement('a'); a.className = 'wm-c'; a.href = w.check; a.target = '_blank'; a.rel = 'noopener';
      a.title = 'Licensed on Watermark. Check the license.';
      a.innerHTML = '&copy; <b>' + esc(w.maker) + '</b><i>Licensed &middot; ' + esc(w.number) + '</i>';
      fig.appendChild(a);
    });
  }
  function go() {
    fetch(BASE + '/api/client/' + encodeURIComponent(who)).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) { run(d); window.WMSite = { refresh: function () { run(d); } }; } }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
