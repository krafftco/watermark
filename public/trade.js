/* For the trade, on the device that asked for it: the quote bar on the trade search, and on any photograph's page a
   spec sheet (pixels, size, camera, every use with its price, a comp, the Watermark record). Visitors never see it. */
(function () {
  if (window.__WM_TRADE) return; window.__WM_TRADE = 1;
  var on = /(?:^|;\s*)wm_trade=1/.test(document.cookie);
  var qf = document.querySelector('[data-tr-quote]');
  if (qf) {
    var bar = qf.querySelector('[data-tr-qbar]'), n = qf.querySelector('[data-tr-n]');
    qf.addEventListener('change', function () { var k = qf.querySelectorAll('input[name=w]:checked').length; n.textContent = k; bar.hidden = !k; });
  }
  if (!on) return;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // The trade is on: say so quietly in the header, with the way out.
  var top = document.querySelector('header.top');
  if (top && !top.querySelector('.tr-chip')) { var c = document.createElement('a'); c.className = 'tr-chip'; c.href = '/trade'; c.title = 'You are seeing the house for the trade. Tap to search; the way back is on that page.'; c.textContent = 'Trade'; var w = top.querySelector('.nv-w'); top.insertBefore(c, w || null); }
  // A photograph's page: the spec sheet, after the entry.
  var f = document.querySelector('[data-viewer]'); var slug = f && (document.querySelector('form.share-buy') || {}).getAttribute ? (document.querySelector('[data-hangit]') || {}).getAttribute && document.querySelector('[data-hangit]').getAttribute('data-hangit') : null;
  if (!slug) { var m = location.pathname.match(/^\/(?:w|m\/[^/]+)\/([^/]+)$/); slug = m && m[1]; }
  var entry = document.querySelector('.lot-entry');
  if (!slug || !entry) return;
  fetch('/api/v1/works/' + encodeURIComponent(slug)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j) return; var d = j.dimensions || {};
    var box = document.createElement('section'); box.className = 'tr-spec-box';
    box.innerHTML = '<p class="k">For the trade</p>'
      + '<dl><div><dt>File</dt><dd>' + (d.width ? d.width.toLocaleString() + ' &times; ' + d.height.toLocaleString() + ' px &middot; ' + d.megapixels + ' MP' : '&mdash;') + '</dd></div>'
      + '<div><dt>Accession</dt><dd>' + esc(j.id || '') + '</dd></div>'
      + '<div><dt>Copyright</dt><dd>' + esc(j.copyright.holder) + (j.copyright.registered ? ' &middot; U.S. registered ' + esc(j.copyright.registration) : '') + '</dd></div>'
      + '<div><dt>Never</dt><dd>' + (j.rules.never.length ? esc(j.rules.never.map(function (k) { return ({ ai: 'Training AI', alter: 'Altering it beyond crop and resize', political: 'Political campaigns', tobacco: 'Tobacco', firearms: 'Firearms', adult: 'Adult content', sensitive: 'Sensitive subjects' })[k] || (k.charAt(0).toUpperCase() + k.slice(1)); }).join(' · ')) : 'No restrictions beyond the license') + '</dd></div>'
      + '<div><dt>Credit</dt><dd>' + esc(j.credit) + '</dd></div></dl>'
      + '<ul class="tr-uses">' + j.uses.map(function (u) { return '<li><a href="' + esc(String(u.url).replace(/^https?:\/\/[^/]+/, '')) + '"><span>' + esc(u.name) + '</span><b>' + (u.instant && u.price_cents != null ? '$' + (u.price_cents / 100).toLocaleString() : 'Ask') + '</b></a></li>'; }).join('') + '</ul>'
      + '<p class="tr-acts"><a href="/comp/' + encodeURIComponent(j.slug) + '" download>Comp for a layout</a> &middot; <a href="/trade">The trade search</a> &middot; <a href="/trade/off?back=' + encodeURIComponent(location.pathname) + '">Back to the gallery view</a></p>';
    entry.appendChild(box);
  }).catch(function () {});
})();
