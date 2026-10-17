/* The house bar: one thin strip shared by Krafft, Krafft Studios, Watermark and Will Fullerton's own site.
   Served from watermark.krafftco.com/house.js and loaded in the <head> of every site, so they all
   show the same bar and it changes in one place.
   Seamless: each link returns you to the page you last had open on that site (30 minutes), the next
   page is prefetched on hover, and links stay in the tab. The krafftco.com sites share one cookie;
   across to wrkfullerton.com (another domain) the link carries #kh and the site you land on sends you
   on to your last page there. */
(function () {
  if (window.__krafftHouse) return; window.__krafftHouse = 1;
  var P = [
    { id: 'krafft', name: 'Krafft', host: 'krafftco.com', url: 'https://www.krafftco.com' },
    { id: 'studios', name: 'Krafft Studios', host: 'studios.krafftco.com', url: 'https://studios.krafftco.com' },
    { id: 'watermark', name: 'Watermark', host: 'watermark.krafftco.com', url: 'https://watermark.krafftco.com' },
    // A venture that lives as a page on krafftco.com: matched by path, always opens at its page.
    { id: 'dgc', name: 'Dallas Golf Club', short: 'DGC', host: 'krafftco.com', path: '/dallas-golf-club', url: 'https://www.krafftco.com/dallas-golf-club' },
    { id: 'will', name: 'Will Fullerton', short: 'W. Fullerton', host: 'wrkfullerton.com', url: 'https://www.wrkfullerton.com', own: 1 }
  ];
  function fam(host) { return /wrkfullerton\.com$/.test(host) ? 'wrkfullerton.com' : /krafftco\.com$/.test(host) ? 'krafftco.com' : ''; }
  var h = location.hostname.replace(/^www\./, '');
  var here = null;
  for (var i = 0; i < P.length; i++) if (h === P[i].host && !P[i].path) here = P[i].id;
  for (var i2 = 0; i2 < P.length; i2++) if (P[i2].path && h === P[i2].host && location.pathname.indexOf(P[i2].path) === 0) here = P[i2].id;
  // Pages that should never be "returned to": private, one-off or transactional.
  var SKIP = /^\/(studio|thanks|buy|k\/|view|ghost|members|signin|signup|account|checkout|utilities|401|404)/;
  var F = fam(h), DOMAIN = F ? '; domain=.' + F : '';
  function read(id) { var m = document.cookie.match(new RegExp('(?:^|; )kh_' + id + '=([^;]*)')); try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } }
  // Arrived from the other domain's bar: go straight on to the last page open here.
  if (here && location.hash === '#kh') {
    var last = read(here === 'dgc' ? 'krafft' : here), cur = location.pathname + location.search;
    if (last && last.charAt(0) === '/' && !/^\/\//.test(last) && last !== cur) { location.replace(last); return; }
    try { history.replaceState(null, '', cur); } catch (e) {}
  }
  var keep = here === 'dgc' ? null : here;  // a venture page is not "where you were" on Krafft
  if (keep && !SKIP.test(location.pathname)) {
    try { document.cookie = 'kh_' + keep + '=' + encodeURIComponent(location.pathname + location.search) + '; max-age=1800; path=/; SameSite=Lax; Secure' + DOMAIN; } catch (e) {}
  }
  var css = '.kh{position:relative;z-index:1000;display:flex;align-items:center;gap:clamp(18px,2.6vw,36px);height:32px;padding:0 clamp(16px,4vw,56px);background:#111;color:rgba(246,245,242,.56);font:400 10.5px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.24em;text-transform:uppercase;-webkit-font-smoothing:antialiased;overflow-x:auto;scrollbar-width:none;white-space:nowrap;box-sizing:border-box}'
    + '.kh::-webkit-scrollbar{display:none}'
    + '.kh a{position:relative;color:inherit;text-decoration:none;padding:6px 0;transition:color .5s cubic-bezier(.16,1,.3,1)}'
    + '.kh a:hover,.kh a:focus-visible{color:#f6f5f2;outline:none}'
    + '.kh a[aria-current]{color:#f6f5f2}'
    + '.kh a[aria-current]::after{content:"";position:absolute;left:0;right:0;bottom:2px;height:1px;background:currentColor}'
    + '.kh .kh-own{margin-left:auto}'
    + '.kh .kh-own::before{content:"";position:absolute;left:calc(-1 * clamp(9px,1.3vw,18px));top:50%;width:1px;height:10px;margin-top:-5px;background:rgba(246,245,242,.22)}'
    + '.kh .kh-sh{display:none}'
    + '@media (max-width:960px){.kh .kh-fl{display:none}.kh .kh-sh{display:inline}}'
    + '@media (max-width:600px){.kh{gap:13px;letter-spacing:.12em;padding:0 16px;font-size:10px}.kh .kh-own{margin-left:0;padding-left:0}.kh .kh-own::before{left:-8px}}'
    + '@media print{.kh{display:none}}';
  function link(p) {
    var a = document.createElement('a');
    var other = fam(p.host) !== F;           // another domain: its cookie can't be read from here
    var back = p.id !== here && !other ? read(p.id) : '';
    a.href = p.path ? p.url : p.id === here ? p.url + '/' : p.url + (back && back.charAt(0) === '/' && !/^\/\//.test(back) ? back : '/') + (other ? '#kh' : '');
    var short = p.short || (p.id === 'studios' ? 'Studios' : '');
    if (short) { var f1 = document.createElement('span'); f1.className = 'kh-fl'; f1.textContent = p.name; var f2 = document.createElement('span'); f2.className = 'kh-sh'; f2.textContent = short; a.appendChild(f1); a.appendChild(f2); }
    else a.textContent = p.name;
    if (p.own) a.className = 'kh-own';
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

  // krafftco.com/license and Watermark, joined: when the photograph is held on Watermark, each use is
  // bought there at once and the photograph can be collected; with no photograph, the uses lead to the collection.
  if (/(^|\.)krafftco\.com$/.test(h) && /^\/license\/?$/.test(location.pathname)) {
    var WMB = 'https://watermark.krafftco.com', USE = { Editorial: 'editorial', Commercial: 'commercial', Campaign: 'campaign', Print: 'print' };
    var lic = function () {
      var r = document.querySelector('.wl'); if (!r) return;
      var img = new URLSearchParams(location.search).get('image') || '';
      var set = function (w) {
        [].forEach.call(r.querySelectorAll('.wl-use'), function (li) {
          var go = li.querySelector('.wl-go'), t = li.getAttribute('data-tier'); if (!go || !USE[t]) return;
          go.href = w ? w.license + '?use=' + USE[t] : WMB + '/collection';
          go.firstChild.textContent = w ? 'Continue on Watermark ' : 'Choose a photograph on Watermark ';
          go.addEventListener('click', function (e) { e.stopImmediatePropagation(); }, true);
          var ta = li.querySelector('textarea'); if (ta) ta.addEventListener('input', function () { setTimeout(function () { go.href = w ? w.license + '?use=' + USE[t] : WMB + '/collection'; }, 0); });
        });
        if (w && w.collect && !r.querySelector('.wk-col')) {
          var a = document.createElement('a'); a.className = 'wk-col'; a.href = w.page;
          a.innerHTML = '<span><svg viewBox="0 0 51.66 51.88" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M20.35.14L.14,26V0c7.28,0,20.21.14,20.21.14Z"/><polygon points="51.66 51.88 31.73 51.84 27.51 45.27 38.12 32.14 51.66 51.88"/><polygon points="0 41.9 .14 51.71 9.97 51.84 51.66 .3 31.8 .14 0 41.9"/></svg></span>Or collect it: yours to keep, numbered';
          a.setAttribute('style', 'display:inline-flex;align-items:center;gap:14px;margin:-12px 0 36px;font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;color:#eee8dd;text-decoration:none;border-bottom:0');
          a.firstChild.setAttribute('style', 'display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#eee8dd;color:#0d0b09');
          var dek = r.querySelector('.wl-dek'); if (dek) dek.insertAdjacentElement('afterend', a);
        }
      };
      if (!img) return set(null);
      fetch(WMB + '/api/match?src=' + encodeURIComponent(img)).then(function (x) { return x.json(); }).then(function (j) { if (j && j.work) set(j.work); }).catch(function () {});
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(lic, 0); }); else setTimeout(lic, 0);
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
