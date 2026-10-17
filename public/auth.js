/* Passkeys: save a collection to this person's phone or computer, and sign in on any other. */
(function () {
  var W = window.SimpleWebAuthnBrowser; if (!W) return;
  function msg(el, t) { var m = (el.closest('[data-passkey-box]') || document).querySelector('[data-passkey-msg]'); if (m) m.textContent = t; }
  async function post(u, body) { var r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : '{}' }); return { ok: r.ok, j: await r.json().catch(function () { return {}; }) }; }
  async function save(el, who) {
    var base = who === 'maker' ? '/auth/maker' : '/auth/passkey';
    var o = await post(base + '/register/options'); if (!o.ok) return msg(el, 'Not available just now. Try again in a moment.');
    var att; try { att = await W.startRegistration({ optionsJSON: o.j }); } catch (e) { return msg(el, e && e.name === 'InvalidStateError' ? 'This device already holds your passkey.' : 'Not saved. Nothing has changed.'); }
    var v = await post(base + '/register/verify', att);
    if (v.ok) { msg(el, who === 'maker' ? 'Saved. Sign in to your room with it from any device.' : 'Saved. Your gallery now follows you to every device you sign in on.'); setTimeout(function () { location.reload(); }, 1200); } else msg(el, 'Not saved. Try again.');
  }
  async function signin(el, who) {
    var base = who === 'maker' ? '/auth/maker' : '/auth/passkey';
    var o = await post(base + '/login/options'); if (!o.ok) return msg(el, 'Not available just now. Try again in a moment.');
    var a; try { a = await W.startAuthentication({ optionsJSON: o.j }); } catch (e) { return msg(el, 'Not signed in. Nothing has changed.'); }
    var v = await post(base + '/login/verify', a);
    if (v.ok) location.href = who === 'maker' ? '/account' : '/yours'; else msg(el, v.j && v.j.unknown ? 'That passkey is not one Watermark knows.' : 'Not signed in. Try again.');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-passkey]'); if (!b) return;
    e.preventDefault();
    if (!W.browserSupportsWebAuthn()) return msg(b, 'This browser cannot hold a passkey. Try Safari or Chrome on a recent phone or computer.');
    var k = b.getAttribute('data-passkey'), who = /^maker-/.test(k) ? 'maker' : 'collector';
    (/save$/.test(k) ? save : signin)(b, who);
  });
})();
