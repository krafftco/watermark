/* The trace: every photograph shown on Watermark carries a faint lattice naming the work and the viewer.
   Invisible at reading distance, it survives a screenshot, so a copy can be traced to the page it was
   taken from. A screenshot key (Print Screen) is noted and answered with an invitation, not a wall:
   browsers cannot see the Mac's capture keys, and no lock on the web holds; honour, not locks. */
(function () {
  var W = window.__WM_GUARD; if (!W) return;
  function code() { try { var k = localStorage.getItem('wm_v'); if (!k) { k = Math.random().toString(36).slice(2, 8); localStorage.setItem('wm_v', k); } return k; } catch (e) { return 'anon'; } }
  var v = code(), text = (W.accession || W.slug) + ' · ' + v + ' · watermark';
  // A tiled SVG of near-invisible text, laid over every protected image.
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="140"><text x="6" y="40" font-family="Helvetica,Arial,sans-serif" font-size="11" fill="white" transform="rotate(-18 130 70)">' + text.replace(/[<>&]/g, '') + '</text><text x="6" y="118" font-family="Helvetica,Arial,sans-serif" font-size="11" fill="black" transform="rotate(-18 130 70)">' + text.replace(/[<>&]/g, '') + '</text></svg>';
  var url = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  var st = document.createElement('style');
  st.textContent = '.wm-trace{position:absolute;inset:0;pointer-events:none;background-image:' + url + ';background-size:260px 140px;opacity:.045;mix-blend-mode:overlay;z-index:3}'
    + '.wm-nudge{position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);max-width:min(520px,calc(100vw - 32px));padding:14px 18px;background:#0e0e0e;color:#f6f5f2;font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.35);opacity:0;transition:opacity .4s,transform .5s cubic-bezier(.16,1,.3,1);z-index:2147483000}'
    + '.wm-nudge.on{opacity:1;transform:translate(-50%,0)}.wm-nudge a{color:#fff;margin-left:10px;white-space:nowrap}';
  document.head.appendChild(st);
  function lay(host) { if (!host || host.querySelector(':scope > .wm-trace')) return; if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; var t = document.createElement('span'); t.className = 'wm-trace'; t.setAttribute('aria-hidden', 'true'); host.appendChild(t); }
  function all() { var hs = document.querySelectorAll('.plate, .wv, .lic-fig, .lb-stage, .buy-plate, .tc-win, .cf'); for (var i = 0; i < hs.length; i++) lay(hs[i]); }
  all(); new MutationObserver(all).observe(document.body, { childList: true, subtree: true });

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
  // The watermark itself: the wave and the address, laid over every protected image. Quiet while you look;
  // when the page loses the eye (a capture tool taking focus, a switch away), it comes up at once, so what is
  // taken carries the name. Print Screen brings it up too.
  var mark = '<svg viewBox="1.5 14.2 41 11" fill="currentColor"><path d="' + W.wave + '"/></svg><span>' + (W.accession ? W.accession + ' \u00b7 ' : '') + 'watermark.krafftco.com/w/' + W.slug + '</span>';
  var st2 = document.createElement('style');
  st2.textContent = '.wm-mark{position:absolute;right:14px;bottom:12px;display:inline-flex;align-items:center;gap:8px;color:#fff;font:11px/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.08em;opacity:.55;text-shadow:0 1px 6px rgba(0,0,0,.6);pointer-events:none;z-index:4;transition:opacity .3s}'
    + '.wm-mark svg{width:26px;height:7px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.6))}'
    + '.wm-up .wm-mark{opacity:1}'
    + '.wm-veil{position:absolute;inset:0;z-index:4;pointer-events:none;opacity:0;transition:opacity .15s;background:' + url.replace('data:image/svg+xml;utf8,', 'data:image/svg+xml;utf8,') + ';background-size:260px 140px;mix-blend-mode:normal}'
    + '.wm-up .wm-veil{opacity:.35}'
    + '.wm-big{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-18deg);width:62%;color:#fff;opacity:0;pointer-events:none;z-index:5;filter:drop-shadow(0 2px 18px rgba(0,0,0,.5));transition:opacity .15s}'
    + '.wm-up .wm-big{opacity:.55}';
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
})();
