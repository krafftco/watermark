// Stay (Will, 25 Oct: music through the whole house, "let's do it"). A page that owns a sound (Wander's turntable,
// the Listening Room) keeps it by staying: the rest of the house opens in a layer over it (`.sty`: a bar across
// the top for the host's player, the page in a frame beneath), the address bar follows the frame, Back walks the
// frame's history and closes the layer at its first page, × closes it, and the host page is exactly where it was.
// The sound never changes hands, so it never stops and never asks for a second tap. A payment leaves for Stripe at
// the top (Checkout refuses a frame), which is the one road that ends the music. Same origin only.
(function () {
  var S = { el: null, frame: null, bar: null, open: false, depth: 0, onClose: null, onWander: null };
  var CHECKOUT = /\/(buy|basket\/collect|take|begin|proof|print|order|pocket|standing|club|friends|keeping|circle|library\/[^/]+\/take|yours\/p\/[^/]+\/(proof|order)|w\/[^/]+\/print)(\/|$|\?)/;
  function same(u) { try { var x = new URL(u, location.href); return x.origin === location.origin ? x : null; } catch (e) { return null; } }
  function build() {
    if (S.el) return;
    S.el = document.createElement('div'); S.el.className = 'sty'; S.el.hidden = true;
    S.el.innerHTML = '<div class="sty-bar"><button type="button" class="sty-back" data-sty-back aria-label="Back">←</button><div class="sty-slot" data-sty-slot></div><button type="button" class="sty-x" data-sty-close aria-label="Back to where you were">×</button></div><iframe class="sty-f" title="Watermark" allow="fullscreen; autoplay; web-share; clipboard-write"></iframe>';
    document.body.appendChild(S.el); S.frame = S.el.querySelector('iframe'); S.bar = S.el.querySelector('[data-sty-slot]');
    S.el.querySelector('[data-sty-close]').addEventListener('click', close);
    S.el.querySelector('[data-sty-back]').addEventListener('click', function () { history.back(); });
    S.frame.addEventListener('load', onLoad);
  }
  function onLoad() {
    if (!S.open) return; var w = S.frame.contentWindow, doc = null; try { if (w.location.href === 'about:blank') return; } catch (e) {} try { doc = w.document; } catch (e) { doc = null; }
    if (!doc) { // somewhere not ours (Stripe refuses a frame anyway): leave at the top
      try { location.href = S.frame.src; } catch (e) {} return;
    }
    var path = w.location.pathname + w.location.search + w.location.hash;
    if (/^\/wander(\/|$|\?)/.test(w.location.pathname) && S.onWander) { // Wander inside Wander: the host takes it
      var q = new URLSearchParams(w.location.search); close(); S.onWander(q.get('at'), path); return;
    }
    try { history.replaceState({ sty: true }, '', path); } catch (e) {}
    try { document.title = doc.title || document.title; } catch (e) {}
    doc.documentElement.classList.add('in-stay');
    // A payment leaves at the top: Checkout will not be framed.
    doc.addEventListener('submit', function (e) { var f = e.target; if (f && f.tagName === 'FORM' && CHECKOUT.test(f.getAttribute('action') || '')) f.target = '_top'; }, true);
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !e.defaultPrevented) close(); });
    try { S.frame.focus(); } catch (e) {}
  }
  function open(url, opts) {
    opts = opts || {}; var u = same(url); if (!u) { location.href = url; return false; }
    build(); if (opts.bar) { S.bar.innerHTML = ''; S.bar.appendChild(opts.bar); }
    S.onClose = opts.onClose || null; S.onWander = opts.onWander || null;
    if (!S.open) { S.open = true; S.el.hidden = false; document.documentElement.classList.add('sty-on'); try { history.pushState({ sty: 'root' }, '', location.href); } catch (e) {} }
    S.frame.src = u.href; return true;
  }
  function close() {
    if (!S.open) return; S.open = false; S.el.hidden = true; document.documentElement.classList.remove('sty-on');
    try { S.frame.src = 'about:blank'; } catch (e) {}
    try { history.replaceState(null, '', S.home || location.pathname + location.search); } catch (e) {}
    if (S.onClose) S.onClose();
  }
  addEventListener('popstate', function () { if (S.open && !(history.state && history.state.sty)) close(); });
  // Links on the host page open in the layer while a sound is on.
  function arm(shouldStay) {
    S.home = location.pathname + location.search;
    document.addEventListener('click', function (e) {
      if (!shouldStay()) return; if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      var a = e.target.closest('a[href]'); if (!a || a.target || a.hasAttribute('download') || a.hasAttribute('data-no-stay')) return;
      var u = same(a.getAttribute('href')); if (!u) return; if (/^\/(d|img|static|signout)\//.test(u.pathname) || u.pathname === location.pathname) return;
      e.preventDefault(); open(u.href, S.opts);
    }, true);
  }
  window.WMStay = { open: open, close: close, arm: function (shouldStay, opts) { S.opts = opts || {}; arm(shouldStay); }, isOpen: function () { return S.open; } };
})();
