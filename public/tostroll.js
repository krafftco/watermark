/* The stroll everywhere (Will, 18 Oct: the stroll is the best of the house; it has to find its way into the rest).
   On a phone, a tap on any photograph in a set (the collection, an artist, a gallery, a hung wall, a series, the
   front door) opens the stroll right there: edge to edge, from that photograph, through that set alone in its own
   order. Back returns to the page you were on. A computer keeps its pages. */
(function () {
  if (window.__WM_TOSTROLL) return; window.__WM_TOSTROLL = 1;
  if (!window.matchMedia || !matchMedia('(max-width:760px) and (pointer:coarse)').matches) return;
  var p = location.pathname.replace(/\/+$/, '') || '/', m, key = '';
  if (p === '/' || p === '/collection') key = 'collection';
  else if ((m = /^\/m\/([^/]+)$/.exec(p))) key = 'maker:' + m[1];
  else if ((m = /^\/(?:g|collector)\/([^/]+)$/.exec(p))) key = 'gallery:' + m[1];
  else if ((m = /^\/(?:g\/[^/]+\/)?hang\/([^/]+)$/.exec(p))) key = 'hang:' + m[1];
  else if ((m = /^\/series\/([^/]+)$/.exec(p))) key = 'series:' + m[1];
  else if (/^\/(stroll|wander|frame|tv|curate|account|studio|trade|basket|yours)/.test(p)) return; // rooms with their own ways
  function slugOf(a) {
    var h = a.getAttribute('href') || '', x = /^\/(?:w|m\/[^/?#]+)\/([^/?#]+)\/?(?:[?#].*)?$/.exec(h);
    return x && !/^(life|claim|thanks|closer|archive\.wmark)$/.test(x[1]) ? x[1] : null;
  }
  document.addEventListener('click', function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    if (e.target.closest('[data-buy],[data-eye],.pb,.hg-ctl,.hg-grip,button,form')) return;
    var a = e.target.closest('a[href]'); if (!a || !a.querySelector('img')) return;
    var slug = slugOf(a); if (!slug) return;
    if (document.querySelector('.hg-own')) return; // arranging your own wall
    e.preventDefault(); e.stopPropagation();
    location.href = '/stroll?at=' + encodeURIComponent(slug) + (key ? '&in=' + encodeURIComponent(key) : '');
  }, true); // first, ahead of the page's own lightbox
})();
