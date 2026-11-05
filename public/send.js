/* Send (5 Nov): a work sent to someone, with your name and a line of your own. One small sheet: the picture, "Say
   something" (optional), Send. The house makes a short link that opens for them on the picture alone; the device's
   share sheet carries it, else it is copied. If you arrived on a work someone sent you, the sheet offers to send one
   back to them, and only then are they told. */
(function () {
  'use strict';
  var el = null, cur = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sayT(t) { var d = document.querySelector('.shr-say'); if (!d) { d = document.createElement('div'); d.className = 'shr-say'; document.body.appendChild(d); } d.textContent = t; d.classList.add('on'); setTimeout(function () { d.classList.remove('on'); }, 4200); }
  function from() { try { return JSON.parse(sessionStorage.getItem('wm_found') || 'null'); } catch (e) { return null; } }
  function build() {
    if (el) return el;
    el = document.createElement('div'); el.className = 'snd'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Send it to someone');
    el.innerHTML = '<div class="snd-c"><button type="button" class="snd-x" aria-label="Close">×</button><img class="snd-im" alt=""><p class="snd-k" data-snd-k>Send it to someone</p><p class="snd-t" data-snd-t></p>'
      + '<label class="snd-l"><span>Say something, if you like</span><textarea maxlength="160" rows="2" data-snd-note placeholder="This made me think of you."></textarea></label>'
      + '<label class="snd-l snd-nm" data-snd-nmw hidden><span>Your first name</span><input maxlength="24" data-snd-name autocomplete="given-name"></label>'
      + '<button type="button" class="snd-go" data-snd-go>Send</button><p class="snd-f">It opens for them on its own, in the dark, with your name. Nothing is followed.</p></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target === el || e.target.closest('.snd-x')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && el && !el.hidden) close(); });
    el.querySelector('[data-snd-go]').addEventListener('click', go);
    return el;
  }
  function open(o) {
    build(); cur = o || {}; var f = from(), me = (document.querySelector('[data-me]') || {}).getAttribute ? (document.querySelector('[data-me]').getAttribute('data-me') || '') : '';
    el.querySelector('.snd-im').src = cur.img || ('/img/' + encodeURIComponent(cur.slug) + '/screen');
    el.querySelector('[data-snd-t]').innerHTML = '<b>' + esc(cur.title || '') + '</b>' + (cur.by ? ' · ' + esc(cur.by) : '');
    el.querySelector('[data-snd-k]').textContent = f && f.from ? 'Send one back to ' + f.from : 'Send it to someone';
    el.querySelector('[data-snd-nmw]').hidden = !!me; el.querySelector('[data-snd-note]').value = '';
    el.hidden = false; document.documentElement.classList.add('snd-on'); setTimeout(function () { el.querySelector('[data-snd-note]').focus({ preventScroll: true }); }, 60);
  }
  function close() { if (!el) return; el.hidden = true; document.documentElement.classList.remove('snd-on'); }
  function go() {
    var btn = el.querySelector('[data-snd-go]'); if (btn.disabled) return; btn.disabled = true; btn.textContent = 'A moment';
    var f = from(), body = new URLSearchParams({ slug: cur.slug, note: el.querySelector('[data-snd-note]').value || '', name: el.querySelector('[data-snd-name]').value || '' });
    if (f && f.t) body.set('reply', f.t);
    fetch('/send', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.disabled = false; btn.textContent = 'Send'; if (!d || !d.url) { sayT('It could not be sent just now.'); return; }
        var done = function () { close(); sayT(f && f.from ? 'Sent back to ' + f.from + '.' : 'Sent. It opens for them on its own.'); try { if (f && f.from) sessionStorage.removeItem('wm_found'); } catch (e) {} };
        if (navigator.share) navigator.share({ title: d.title, text: d.text, url: d.url }).then(done).catch(function () { showLink(d.url); });
        else if (navigator.clipboard) navigator.clipboard.writeText(d.url).then(function () { close(); sayT('The link is copied. It opens for them on its own.'); }, function () { showLink(d.url); });
        else showLink(d.url);
      })
      .catch(function () { btn.disabled = false; btn.textContent = 'Send'; sayT('It could not be sent just now.'); });
  }
  function showLink(u) { var p = el.querySelector('.snd-f'); p.innerHTML = 'Copy this and send it: <input class="snd-u" readonly value="' + esc(u) + '">'; var i = p.querySelector('input'); i.focus(); i.select(); }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-wm-send]'); if (!b) return; e.preventDefault(); open({ slug: b.getAttribute('data-wm-send'), title: b.getAttribute('data-send-title') || '', by: b.getAttribute('data-send-by') || '', img: b.getAttribute('data-send-img') || '' }); });
  window.WMSend = { open: open, close: close };
})();
