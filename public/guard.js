/* The guard. While you look, the photograph is shown clean: nothing laid over it, ever. The protections
   live in the application, not on the picture. Only in the capture moment (the page loses the eye to a
   capture tool, Print Screen, the Mac's capture keys, a copy out of the page) does the mark come up for
   a few seconds, so what is taken carries the work's name and address; then it goes again. Honour, not locks. */
(function () {
  var W = window.__WM_GUARD; if (!W) return;
  function code() { try { var k = localStorage.getItem('wm_v'); if (!k) { k = Math.random().toString(36).slice(2, 8); localStorage.setItem('wm_v', k); } return k; } catch (e) { return 'anon'; } }
  var v = code(); try { document.cookie = 'wm_v=' + v + '; max-age=31536000; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); } catch (e) {}
  var text = (W.accession || W.slug) + ' · ' + v + ' · watermark';
  // A tiled SVG naming the work and the viewer: the veil that comes up in the capture moment.
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="140"><text x="6" y="40" font-family="Helvetica,Arial,sans-serif" font-size="11" fill="white" transform="rotate(-18 130 70)">' + text.replace(/[<>&]/g, '') + '</text><text x="6" y="118" font-family="Helvetica,Arial,sans-serif" font-size="11" fill="black" transform="rotate(-18 130 70)">' + text.replace(/[<>&]/g, '') + '</text></svg>';
  var url = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  var st = document.createElement('style');
  st.textContent = '.wm-nudge{position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);max-width:min(520px,calc(100vw - 32px));padding:14px 18px;background:#0e0e0e;color:#f6f5f2;font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.35);opacity:0;transition:opacity .4s,transform .5s cubic-bezier(.16,1,.3,1);z-index:2147483000}'
    + '.wm-nudge.on{opacity:1;transform:translate(-50%,0)}.wm-nudge a{color:#fff;margin-left:10px;white-space:nowrap}';
  document.head.appendChild(st);

  // Print Screen (Windows, Linux) is the one capture key a page can hear. The Mac's are not ours to see.
  var said = false;
  function note(kind) {
    try { navigator.sendBeacon(W.capture, new Blob([JSON.stringify({ kind: kind, v: v })], { type: 'application/json' })); } catch (e) {}
    if (said) return; said = true;
    var n = document.createElement('div'); n.className = 'wm-nudge';
    n.innerHTML = 'This photograph is held on Watermark and carries its trace. ' + (W.collect ? 'It is yours to keep, credited, for ' + W.price + '.<a href="' + W.collect + '">Collect it</a>' : 'Please credit ' + (W.maker || 'the maker') + '.');
    document.body.appendChild(n); requestAnimationFrame(function () { n.classList.add('on'); });
    setTimeout(function () { n.classList.remove('on'); setTimeout(function () { n.remove(); }, 600); }, 7000);
  }
  // The mark, for the capture moment only: the picture dims, the wave comes up large and single, and one
  // line names the work and its address. Nothing tiled, nothing busy; it should look like the house's own seal.
  var mark = '<svg viewBox="1.5 14.2 41 11" fill="currentColor"><path d="' + W.wave + '"/></svg><span>' + (W.accession ? W.accession + ' \u00b7 ' : '') + 'watermark.krafftco.com/w/' + W.slug + '</span>';
  var st2 = document.createElement('style');
  st2.textContent = '.wm-mark{position:absolute;left:0;right:0;bottom:7%;display:flex;justify-content:center;align-items:center;gap:10px;color:#fff;font:12px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;opacity:0;pointer-events:none;z-index:6;transition:opacity .25s ease .05s;text-shadow:0 1px 12px rgba(0,0,0,.5)}'
    + '.wm-mark svg{display:none}'
    + '.wm-up .wm-mark{opacity:.92}'
    + '.wm-veil{position:absolute;inset:0;z-index:4;pointer-events:none;opacity:0;transition:opacity .2s ease;background:radial-gradient(ellipse at center,rgba(8,8,8,.38) 0%,rgba(8,8,8,.66) 100%)}'
    + '.wm-up .wm-veil{opacity:1}'
    + '.wm-big{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);width:min(46%,420px);color:#fff;opacity:0;pointer-events:none;z-index:5;filter:drop-shadow(0 6px 30px rgba(0,0,0,.55));transition:opacity .25s ease,transform .6s cubic-bezier(.16,1,.3,1)}'
    + '.wm-up .wm-big{opacity:.96;transform:translate(-50%,-50%) scale(1)}';
  document.head.appendChild(st2);
  function dress(host) {
    if (!host || host.querySelector(':scope > .wm-mark')) return;
    var m = document.createElement('span'); m.className = 'wm-mark'; m.setAttribute('aria-hidden', 'true'); m.innerHTML = mark; host.appendChild(m);
    var ve = document.createElement('span'); ve.className = 'wm-veil'; ve.setAttribute('aria-hidden', 'true'); host.appendChild(ve);
    var big = document.createElement('span'); big.className = 'wm-big'; big.setAttribute('aria-hidden', 'true'); big.innerHTML = '<svg viewBox="1.5 14.2 41 11" fill="currentColor"><path d="' + W.wave + '"/></svg>'; host.appendChild(big);
  }
  function dressAll() { var hs = document.querySelectorAll('.plate, .wv, .lb-stage, .lic-fig'); for (var i = 0; i < hs.length; i++) dress(hs[i]); }
  dressAll(); new MutationObserver(dressAll).observe(document.body, { childList: true, subtree: true });
  var upT = null;
  function up(ms) { document.documentElement.classList.add('wm-up'); clearTimeout(upT); if (ms) upT = setTimeout(down, ms); }
  function down() { document.documentElement.classList.remove('wm-up'); }
  window.addEventListener('blur', function () { up(0); });
  window.addEventListener('focus', down);
  document.addEventListener('visibilitychange', function () { if (document.hidden) up(0); else down(); });
  document.addEventListener('keyup', function (e) { if (e.key === 'PrintScreen' || e.code === 'PrintScreen') { up(4000); note('printscreen'); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'PrintScreen' || e.code === 'PrintScreen' || (e.metaKey && e.shiftKey && /^[345]$/.test(e.key))) up(4000); });
  // A copy of the image out of the page (drag, copy) is answered the same way.
  document.addEventListener('copy', function (e) { if (e.target && e.target.closest && e.target.closest('.plate,.wv,.lb-stage,.lic-fig')) note('copy'); });
  // Standing here: the house is told once (and numbered), and the time spent is added when you leave.
  var t0 = Date.now(), told = false;
  function stood(final) {
    var secs = Math.round((Date.now() - t0) / 1000); if (!final && told) return;
    try { navigator.sendBeacon(W.stood, new Blob([JSON.stringify({ v: v, s: final ? secs : 0 })], { type: 'application/json' })); } catch (e) {}
  }
  if (W.stood) {
    fetch(W.stood, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: v, s: 0 }), credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      told = true; var el = document.querySelector('[data-stood]'); if (!el) return;
      if (j && j.line) { el.textContent = j.line; el.hidden = false; }
    }).catch(function () {});
    window.addEventListener('pagehide', function () { stood(true); });
  }
})();