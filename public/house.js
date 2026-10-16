/* The house bar: one thin strip shared by Krafft, Krafft Studios and Watermark.
   Served from watermark.krafftco.com/house.js and loaded in the <head> of every property, so the
   three sites always show the same bar and it changes in one place.
   Seamless: each link returns you to the page you last had open on that property (a shared
   .krafftco.com cookie, 30 minutes), the next page is prefetched on hover, and links stay in the tab. */
(function () {
  if (window.__krafftHouse) return; window.__krafftHouse = 1;
  var P = [
    { id: 'krafft', name: 'Krafft', host: 'krafftco.com', url: 'https://krafftco.com' },
    { id: 'studios', name: 'Krafft Studios', host: 'studios.krafftco.com', url: 'https://studios.krafftco.com' },
    { id: 'watermark', name: 'Watermark', host: 'watermark.krafftco.com', url: 'https://watermark.krafftco.com' }
  ];
  var h = location.hostname.replace(/^www\./, '');
  var here = null;
  for (var i = 0; i < P.length; i++) if (h === P[i].host) here = P[i].id;
  // Pages that should never be "returned to": private, one-off or transactional.
  var SKIP = /^\/(studio|thanks|buy|k\/|view|ghost|members|signin|signup|account|checkout|utilities|401|404)/;
  var DOMAIN = /krafftco\.com$/.test(h) ? '; domain=.krafftco.com' : '';
  function read(id) { var m = document.cookie.match(new RegExp('(?:^|; )kh_' + id + '=([^;]*)')); try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } }
  if (here && !SKIP.test(location.pathname)) {
    try { document.cookie = 'kh_' + here + '=' + encodeURIComponent(location.pathname + location.search) + '; max-age=1800; path=/; SameSite=Lax; Secure' + DOMAIN; } catch (e) {}
  }
  var css = '.kh{position:relative;z-index:1000;display:flex;align-items:center;gap:clamp(18px,2.6vw,36px);height:32px;padding:0 clamp(16px,4vw,56px);background:#111;color:rgba(246,245,242,.56);font:400 10.5px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.24em;text-transform:uppercase;-webkit-font-smoothing:antialiased;overflow-x:auto;scrollbar-width:none;white-space:nowrap;box-sizing:border-box}'
    + '.kh::-webkit-scrollbar{display:none}'
    + '.kh a{position:relative;color:inherit;text-decoration:none;padding:6px 0;transition:color .5s cubic-bezier(.16,1,.3,1)}'
    + '.kh a:hover,.kh a:focus-visible{color:#f6f5f2;outline:none}'
    + '.kh a[aria-current]{color:#f6f5f2}'
    + '.kh a[aria-current]::after{content:"";position:absolute;left:0;right:0;bottom:2px;height:1px;background:currentColor}'
    + '@media (max-width:600px){.kh{gap:20px;letter-spacing:.2em}}'
    + '@media print{.kh{display:none}}';
  function link(p) {
    var a = document.createElement('a');
    var back = p.id !== here ? read(p.id) : '';
    a.href = p.id === here ? p.url + '/' : p.url + (back && back.charAt(0) === '/' && !/^\/\//.test(back) ? back : '/');
    a.textContent = p.name;
    if (p.id === here) a.setAttribute('aria-current', 'site');
    var done = false;
    function pre() { if (done || p.id === here) return; done = true; var l = document.createElement('link'); l.rel = 'prefetch'; l.href = a.href; document.head.appendChild(l); }
    a.addEventListener('mouseenter', pre); a.addEventListener('touchstart', pre, { passive: true }); a.addEventListener('focus', pre);
    return a;
  }
  // Styles go in at once, so a bar the page renders itself is never seen unstyled.
  if (!document.getElementById('kh-css')) { var st = document.createElement('style'); st.id = 'kh-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st); }
  function build() {
    var bar = document.querySelector('.kh');
    if (bar) { // rendered by the page itself (Watermark): refresh its links so "back to where you were" works
      var as = bar.querySelectorAll('a[data-p]');
      for (var j = 0; j < as.length; j++) for (var k = 0; k < P.length; k++) if (as[j].getAttribute('data-p') === P[k].id) as[j].replaceWith(link(P[k]));
      return;
    }
    bar = document.createElement('nav'); bar.className = 'kh'; bar.setAttribute('aria-label', 'Krafft');
    for (var n = 0; n < P.length; n++) bar.appendChild(link(P[n]));
    document.body.insertBefore(bar, document.body.firstChild);
  }
  // A page that renders the bar itself says so; wait for it to be parsed, then refresh its links.
  var own = document.querySelector('meta[name="kh"]');
  if (own) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build(); }
  else if (document.body) build();
  else if (window.MutationObserver) { // insert the moment <body> exists, before first paint, so nothing jumps
    var mo = new MutationObserver(function () { if (document.body) { mo.disconnect(); build(); } });
    mo.observe(document.documentElement, { childList: true });
  } else document.addEventListener('DOMContentLoaded', build);
})();
