/* Watermark on a company's own site. One line in the page:
     <script src="__WM_BASE__/site.js" data-client="natora" defer></script>
   then data-wm on each photograph Watermark holds for them (a slug, a ref WM-2026-000123, or a Watermark number):
     <img data-wm="the-staircase" alt="…">
   The image is served under its license (counted by page), and the credit sits on it: the maker, the license, and
   the number anyone can check. data-wm-keep keeps the site's own image file; data-wm-credit="below" sets the credit
   beneath instead of on the picture; "none" leaves it to the site. When a license has ended, the photograph is
   no longer shown.
   A click on the photograph opens it on Watermark (2 Nov): its maker, its licence, its record, the original. A new tab
   by default so the site stays open; data-wm-link="self" opens it in place, "none" leaves the picture unlinked. A
   photograph already inside a link keeps that link, and the credit still opens the licence. data-wm also works on an
   element with a background image (a Webflow div): it becomes the link. */
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
    '.wm-a{display:block;position:relative;cursor:zoom-in;color:inherit}.wm-a:focus-visible{outline:2px solid #b8913f;outline-offset:3px}' +
    '.wm-v{position:absolute;right:10px;top:10px;display:inline-flex;align-items:center;gap:7px;padding:6px 10px;background:rgba(11,10,9,.55);color:#f2ede4;font:500 10px/1 "Helvetica Neue",Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;border-radius:2px;opacity:0;transform:translateY(-3px);transition:opacity .3s,transform .3s;pointer-events:none;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
    '.wm-v svg{width:18px;height:6px}.wm-a:hover .wm-v,.wm-a:focus-visible .wm-v,[data-wm-link-el]:hover .wm-v{opacity:1;transform:none}[data-wm-link-el]{cursor:zoom-in;position:relative}' +
    '@media (hover:none){.wm-v{opacity:.85;transform:none}}' +
    '@media (max-width:520px){.wm-c i{display:none}}';
  var WAVE = '<svg viewBox="0 0 44 14" aria-hidden="true"><path d="M1 7c3.5-6 7-6 10.5 0s7 6 10.5 0 7-6 10.5 0 7 6 10.5 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function chip() { var v = document.createElement('span'); v.className = 'wm-v'; v.innerHTML = WAVE + '<span>Watermark</span>'; return v; }
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
      // The click-through: the photograph opens itself on Watermark.
      var how = img.getAttribute('data-wm-link') || '', inLink = img.closest && img.closest('a');
      var label = w.title + ', ' + (w.kind || 'a photograph') + ' by ' + w.maker + '. Open it on Watermark.';
      var target = how === 'self' ? '_self' : '_blank';
      if (how !== 'none' && !inLink) {
        if (img.tagName === 'IMG') {
          var a0 = document.createElement('a'); a0.className = 'wm-a'; a0.href = w.go || w.page; a0.target = target; if (target === '_blank') a0.rel = 'noopener';
          a0.setAttribute('aria-label', label); a0.title = 'Open it on Watermark';
          img.parentNode.insertBefore(a0, img); a0.appendChild(img); a0.appendChild(chip());
        } else {
          img.setAttribute('data-wm-link-el', ''); img.setAttribute('role', 'link'); img.setAttribute('tabindex', '0'); img.setAttribute('aria-label', label); img.title = 'Open it on Watermark';
          if (getComputedStyle(img).position === 'static') img.style.position = 'relative';
          img.appendChild(chip());
          var open = function () { if (target === '_self') location.href = w.go || w.page; else window.open(w.go || w.page, '_blank', 'noopener'); };
          img.addEventListener('click', function (e) { if (e.target.closest('a,button')) return; open(); });
          img.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
        }
      }
      if (mode === 'none') return;
      var hold = img.tagName === 'IMG' && img.parentNode.classList && img.parentNode.classList.contains('wm-a') ? img.parentNode : img;
      var fig = document.createElement('figure'); fig.className = 'wm-f' + (mode === 'below' ? ' wm-below' : '');
      if (img.tagName !== 'IMG') { var a1 = document.createElement('a'); a1.className = 'wm-c'; a1.href = w.check; a1.target = '_blank'; a1.rel = 'noopener'; a1.title = 'Licensed on Watermark. Check the license.'; a1.innerHTML = '&copy; <b>' + esc(w.maker) + '</b><i>Licensed &middot; ' + esc(w.number) + '</i>'; if (mode === 'below') { a1.style.position = 'static'; } img.appendChild(a1); return; }
      hold.parentNode.insertBefore(fig, hold); fig.appendChild(hold);
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
