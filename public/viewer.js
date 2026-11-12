// The dark room is retired (Will, 12 Nov: "we should do away with this view… Wander is our way to present media, not
// this view ever"). A press on the photograph where it hangs on its page opens Wander at that work, in the set the
// page was walking; a work not on view (seen only by its maker or those it was sent to) opens on the easel instead,
// since Wander shows only what is on view. The old viewer is in the repository's history (before 12 Nov).
(function () {
  var plate = document.querySelector('[data-viewer]');
  if (!plate) return;
  var G = window.__WM_GUARD || {}, slug = plate.getAttribute('data-slug') || G.slug;
  if (!slug) return;
  plate.style.cursor = 'pointer';
  plate.addEventListener('click', function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    if (e.target.closest('a,button,form,[data-eye]')) return;
    var here = location.pathname + location.search;
    if (plate.getAttribute('data-quiet') != null) { location.href = '/easel/' + encodeURIComponent(slug) + '?back=' + encodeURIComponent(here); return; }
    var m = /[?&]in=([^&#]+)/.exec(location.search);
    location.href = '/wander?at=' + encodeURIComponent(slug) + (m ? '&in=' + m[1] : '');
  });
})();
