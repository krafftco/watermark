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
  // The far right of the bar is the visitor's own door: their studio and collection when they are known
  // to the house, the way in when they are not. Will's page is the example of what everyone's can be.
  var WM = 'https://watermark.krafftco.com';
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
  // Quiet by default: a thin strip with the K and the house you are in, and your own door at the right.
  // On hover (or a tap on the K) it opens and shows every house by name. Nothing jumps: the height is fixed.
  var css = '.kh{position:relative;z-index:1000;display:flex;align-items:center;gap:0;height:30px;padding:0 clamp(16px,4vw,56px);background:#111;color:rgba(246,245,242,.56);font:400 10.5px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;white-space:nowrap;-webkit-font-smoothing:antialiased;overflow:hidden;box-sizing:border-box;width:100%}'
    + '.kh .kh-k{display:grid;place-items:center;width:14px;height:14px;margin-right:clamp(14px,2vw,24px);color:#f6f5f2;background:none;border:0;padding:0;cursor:pointer;flex:none;opacity:.9}.kh .kh-k svg{width:11px;height:11px;display:block}'
    + '.kh .kh-h{display:flex;align-items:center;gap:0;min-width:0}'
    + '.kh a{position:relative;display:inline-block;color:inherit;text-decoration:none;padding:6px 0;transition:color .5s cubic-bezier(.16,1,.3,1),max-width .55s cubic-bezier(.16,1,.3,1),opacity .4s,margin .55s cubic-bezier(.16,1,.3,1);overflow:hidden}'
    + '.kh a:hover,.kh a:focus-visible{color:#f6f5f2;outline:none}'
    + '.kh .kh-h a{max-width:0;opacity:0;margin-right:0}'
    + '.kh .kh-h a[aria-current]{max-width:240px;opacity:1;color:#f6f5f2}'
    + '.kh.open .kh-h a,.kh:focus-within .kh-h a{max-width:240px;opacity:1;margin-right:clamp(18px,2.6vw,36px)}'
    + '@media (hover:hover){.kh:hover .kh-h a{max-width:240px;opacity:1;margin-right:clamp(18px,2.6vw,36px)}}'
    + '.kh .kh-h a[aria-current]::after{content:"";position:absolute;left:0;right:0;bottom:2px;height:1px;background:currentColor}'
    + '.kh .kh-r{margin-left:auto;display:flex;align-items:center;gap:clamp(14px,2vw,24px)}'
    + '.kh .kh-gb{opacity:0;max-width:0;overflow:hidden;transition:opacity .4s,max-width .55s cubic-bezier(.16,1,.3,1)}.kh.open .kh-gb,.kh:focus-within .kh-gb{opacity:.75;max-width:120px}@media (hover:hover){.kh:hover .kh-gb{opacity:.75;max-width:120px}}'
    + '.kh .kh-you{color:#f6f5f2;opacity:.9;display:inline-flex;align-items:center;gap:8px;max-width:none}'
    + '.kh .kh-you .kh-in{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#f6f5f2;color:#111;font-size:8.5px;letter-spacing:.04em;font-weight:600;flex:none}'
    + '.kh .kh-you .kh-nm{max-width:0;opacity:0;overflow:hidden;transition:max-width .55s cubic-bezier(.16,1,.3,1),opacity .4s}'
    + '.kh.open .kh-you .kh-nm,.kh:focus-within .kh-you .kh-nm{max-width:200px;opacity:1}@media (hover:hover){.kh:hover .kh-you .kh-nm{max-width:200px;opacity:1}}'
    + '.kh .kh-me{display:none}'
    + '.kh .kh-sh{display:none}'
    + '@media (max-width:960px){.kh .kh-fl{display:none}.kh .kh-sh{display:inline}}'
    + '@media (max-width:600px){.kh{letter-spacing:.12em;padding:0 16px;font-size:10px}.kh.open .kh-h a,.kh:focus-within .kh-h a{margin-right:14px}}'
    + '@media print{.kh{display:none}}';
  var KM = '<svg viewBox="0 0 51.66 51.88" fill="currentColor" aria-hidden="true"><path d="M20.35.14L.14,26V0c7.28,0,20.21.14,20.21.14Z"/><polygon points="51.66 51.88 31.73 51.84 27.51 45.27 38.12 32.14 51.66 51.88"/><polygon points="51.66 0 .14 51.88 .14 51.67 .14 32.28 28.16 0 51.66 0"/></svg>';
  function link(p) {
    var a = document.createElement('a');
    var other = fam(p.host) !== F;           // another domain: its cookie can't be read from here
    var back = p.id !== here && !other ? read(p.id) : '';
    a.href = p.path ? p.url : p.id === here ? p.url + '/' : p.url + (back && back.charAt(0) === '/' && !/^\/\//.test(back) ? back : '/') + (other ? '#kh' : '');
    var short = p.short || (p.id === 'studios' ? 'Studios' : '');
    if (short) { var f1 = document.createElement('span'); f1.className = 'kh-fl'; f1.textContent = p.name; var f2 = document.createElement('span'); f2.className = 'kh-sh'; f2.textContent = short; a.appendChild(f1); a.appendChild(f2); }
    else a.textContent = p.name;
    if (p.id === here) a.setAttribute('aria-current', 'site');
    var done = false;
    function pre() { if (done || p.id === here) return; done = true; var l = document.createElement('link'); l.rel = 'prefetch'; l.href = a.href; document.head.appendChild(l); }
    a.addEventListener('mouseenter', pre); a.addEventListener('touchstart', pre, { passive: true }); a.addEventListener('focus', pre);
    return a;
  }
  // Styles go in at once, so a bar the page renders itself is never seen unstyled.
  if (!document.getElementById('kh-css')) { var st = document.createElement('style'); st.id = 'kh-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st); }
  function initials(n) { return String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join('') || 'Y'; }
  function build() {
    var bar = document.querySelector('.kh'), houses, pre = !!bar;
    if (pre) { // rendered by the page itself (Watermark): keep its links, refresh them so "back to where you were" works
      if (bar.querySelector('.kh-r')) return;
      var as = bar.querySelectorAll('a[data-p]'); houses = bar.querySelector('.kh-h') || document.createElement('span'); houses.className = 'kh-h';
      for (var j = 0; j < as.length; j++) for (var k = 0; k < P.length; k++) if (as[j].getAttribute('data-p') === P[k].id) { var nl = link(P[k]); if (as[j].parentNode === houses) as[j].replaceWith(nl); else { houses.appendChild(nl); as[j].remove(); } }
    } else { bar = document.createElement('nav'); bar.className = 'kh'; bar.setAttribute('aria-label', 'Krafft'); houses = document.createElement('span'); houses.className = 'kh-h'; for (var n = 0; n < P.length; n++) houses.appendChild(link(P[n])); }
    var kb = bar.querySelector('.kh-k');
    if (!kb) { kb = document.createElement('button'); kb.className = 'kh-k'; kb.type = 'button'; kb.setAttribute('aria-label', 'The houses of Krafft'); kb.innerHTML = KM; bar.appendChild(kb); }
    kb.addEventListener('click', function () { bar.classList.toggle('open'); });
    if (houses.parentNode !== bar) bar.appendChild(houses);
    var right = document.createElement('span'); right.className = 'kh-r';
    // The house guest book, from every door: a quiet line at the end of the bar.
    var gb = document.createElement('a'); gb.className = 'kh-gb'; gb.textContent = 'Guest book';
    var ch = here === 'studios' ? 'studios' : here === 'dgc' ? 'dgc' : here === 'watermark' ? 'watermark' : here === 'will' ? 'krafft' : 'krafft';
    gb.href = 'https://watermark.krafftco.com/guestbook?chapter=' + ch + '&from=' + encodeURIComponent(location.href.split('#')[0]) + '#sign';
    right.appendChild(gb);
    var you = document.createElement('a'); you.className = 'kh-you'; you.innerHTML = '<span class="kh-nm">Sign in</span>'; you.href = WM + '/signin'; right.appendChild(you);
    you.querySelector('.kh-nm').style.maxWidth = 'none'; you.querySelector('.kh-nm').style.opacity = '1';
    bar.appendChild(right);
    if (!pre) document.body.insertBefore(bar, document.body.firstChild);
    try {
      fetch(WM + '/api/me', { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (me) {
        if (!me || !me.in) return;
        you.innerHTML = '<span class="kh-in">' + initials(me.name) + '</span><span class="kh-nm">' + (me.name || 'You').replace(/[<>&]/g, '') + '</span>';
        you.href = me.maker ? WM + '/account' : WM + '/yours'; you.title = me.maker ? 'Your studio' : 'Your gallery';
      }).catch(function () {});
    } catch (e) {}
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

  // krafftco.com/watermark: "Go further" leads into the living collection, not away from it.
  if (/(^|\.)krafftco\.com$/.test(h) && /^\/watermark\/?$/.test(location.pathname)) {
    var wmp = function () {
      var ul = document.querySelector('.wm .wm-links'); if (!ul || ul.getAttribute('data-wm')) return; ul.setAttribute('data-wm', '1');
      var W = 'https://watermark.krafftco.com';
      var row = function (href, t, s) { var li = document.createElement('li'); li.innerHTML = '<a href="' + href + '"><span>' + t + '<i></i></span><small>' + s + '</small></a>'; return li; };
      [].forEach.call(ul.querySelectorAll('a'), function (a) {
        if (/studios\.krafftco\.com\/?$/.test(a.href)) { a.href = W + '/collection'; a.removeAttribute('target'); a.querySelector('span').firstChild.textContent = 'Walk the collection'; a.querySelector('small').textContent = 'Krafft Studios'; }
        if (/\/license$/.test(a.getAttribute('href') || '')) { a.querySelector('small').textContent = 'Four uses'; }
      });
      var first = ul.children[1] || null;
      [row(W + '/series/the-great-rooms', 'The Great Rooms', 'A series'), row(W + '/collectors', 'The collectors', 'Founding 100'), row(W + '/m/will-fullerton#patron', 'Become a patron', 'Patronage')]
        .forEach(function (li) { ul.insertBefore(li, first ? first.nextSibling : null); first = li; });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wmp); else wmp();
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
