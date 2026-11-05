// Share anything (Will, 26 Oct: "everything has to be easily shareable"). Any element with [data-send] shares the
// page it sits on, or what its own attributes say (data-send-title, data-send-text, data-send-url), through the
// device's own sheet when it has one, else the link is copied and a line says so. Nothing is recorded.
(function () {
  'use strict';
  function meta(n) { var m = document.querySelector('meta[property="' + n + '"]'); return m ? m.getAttribute('content') : ''; }
  var sayT = null; function say(t) { var d = document.querySelector('.shr-say'); if (!d) { d = document.createElement('div'); d.className = 'shr-say'; document.body.appendChild(d); } d.textContent = t; d.classList.add('on'); clearTimeout(sayT); sayT = setTimeout(function () { d.classList.remove('on'); }, 4000); }
  function share(el) {
    var url = el.getAttribute('data-send-url') || meta('og:url') || location.href, title = el.getAttribute('data-send-title') || meta('og:title') || document.title, text = el.getAttribute('data-send-text') || meta('og:description') || '';
    if (/^\//.test(url)) url = location.origin + url;
    if (navigator.share) navigator.share({ title: title, text: text, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { say('Link copied.'); }, function () { say(url); });
    else say(url);
  }
  document.addEventListener('click', function (e) { var el = e.target.closest('[data-send]'); if (!el) return; e.preventDefault(); share(el); });
  window.WMShare = { share: function (o) { var el = document.createElement('i'); Object.keys(o || {}).forEach(function (k) { el.setAttribute('data-send-' + k, o[k]); }); share(el); } };
})();
