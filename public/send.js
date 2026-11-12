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
      + '<button type="button" class="snd-go" data-snd-go>Send</button><p class="snd-f">It opens for them on its own, in the dark, with your name. Nothing is followed.</p>'
      + '<div class="snd-ig"><span>Or post it</span><button type="button" data-snd-ig="post">Post</button><button type="button" data-snd-ig="story">Story</button><button type="button" data-snd-ig="placard" title="The card of the house: the work on its mount, who made it, and where it stands">Placard</button></div>'
      + '<p class="snd-igf" data-snd-igf hidden></p></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target === el || e.target.closest('.snd-x')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && el && !el.hidden) close(); });
    el.querySelector('[data-snd-go]').addEventListener('click', go);
    [].forEach.call(el.querySelectorAll('[data-snd-ig]'), function (b) { b.addEventListener('click', function () { post(b.getAttribute('data-snd-ig')); }); });
    return el;
  }
  var made = null; // the link, made the moment the sheet opens, so Send can open the share sheet inside the tap
  function make() { made = null; var p = fetch('/send', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ slug: cur.slug }).toString() }).then(function (r) { return r.json(); }).then(function (d) { if (d && d.url) made = d; return d; }).catch(function () { return null; }); return p; }
  function open(o) {
    build(); cur = o || {}; make(); var f = from(), me = (document.querySelector('[data-me]') || {}).getAttribute ? (document.querySelector('[data-me]').getAttribute('data-me') || '') : '';
    el.querySelector('.snd-im').src = cur.img || ('/img/' + encodeURIComponent(cur.slug) + '/screen');
    el.querySelector('[data-snd-t]').innerHTML = '<b>' + esc(cur.title || '') + '</b>' + (cur.by ? ' · ' + esc(cur.by) : '');
    el.querySelector('[data-snd-k]').textContent = f && f.from ? 'Send one back to ' + f.from : 'Send it to someone';
    el.querySelector('[data-snd-nmw]').hidden = !!me; el.querySelector('[data-snd-note]').value = '';
    el.querySelector('[data-snd-igf]').hidden = true; fetchCards();
    el.hidden = false; document.documentElement.classList.add('snd-on'); setTimeout(function () { el.querySelector('[data-snd-note]').focus({ preventScroll: true }); }, 60);
  }
  // Post it (5 Nov): the card made by the house (the picture whole, its title, who made it, the address), handed to
  // the share sheet so Instagram takes it in one tap; the work's own link is copied first for a story's link sticker.
  var cards = {};
  function fetchCards() { cards = {}; ['post', 'story', 'placard'].forEach(function (k) { cards[k] = fetch('/w/' + encodeURIComponent(cur.slug) + '/' + k + '.jpg', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) { cards[k + 'B'] = b; return b; }).catch(function () { return null; }); }); }
  function workLink() { return location.origin + '/w/' + encodeURIComponent(cur.slug) + '?from=ig'; }
  function post(k) {
    var link = workLink(), note = el.querySelector('[data-snd-igf]');
    try { if (navigator.clipboard) navigator.clipboard.writeText(link); } catch (e) {}
    var name = (cur.title || 'Watermark').replace(/[^\w .,'-]+/g, ' ').trim() + ' (' + k + ').jpg';
    var said = function () { note.hidden = false; note.textContent = k === 'story' ? 'The link is copied: add it to your story as a link sticker, so people can find the work.' : 'The link is copied: paste it in your caption or bio, so people can find the work.'; };
    var b = cards[k + 'B'];
    if (b && window.File && navigator.canShare) {
      var f = new File([b], name, { type: 'image/jpeg' });
      if (navigator.canShare({ files: [f] })) { navigator.share({ files: [f] }).then(said).catch(function (e) { if (!e || e.name !== 'AbortError') dl(k); }); said(); return; }
    }
    dl(k); said();
  }
  function dl(k) { var a = document.createElement('a'); a.href = '/w/' + encodeURIComponent(cur.slug) + '/' + k + '.jpg?dl=1'; a.setAttribute('download', ''); document.body.appendChild(a); a.click(); a.remove(); }
  function close() { if (!el) return; el.hidden = true; document.documentElement.classList.remove('snd-on'); }
  function go() {
    var btn = el.querySelector('[data-snd-go]'); if (btn.disabled) return;
    var f = from(), note = el.querySelector('[data-snd-note]').value || '', name = el.querySelector('[data-snd-name]').value || '';
    var finish = function (d) {
      var body = new URLSearchParams({ note: note, name: name }); if (f && f.t) body.set('reply', f.t);
      var u = '/send/' + encodeURIComponent(d.url.split('/').pop()) + '/note';
      if (navigator.sendBeacon) navigator.sendBeacon(u, new Blob([body.toString()], { type: 'application/x-www-form-urlencoded' })); else fetch(u, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), keepalive: true });
      var text = note ? note : 'I found something for you.';
      var done = function () { close(); sayT(f && f.from ? 'Sent back to ' + f.from + '.' : 'Sent. It opens for them on its own.'); try { if (f && f.from) sessionStorage.removeItem('wm_found'); } catch (e) {} };
      if (navigator.share) navigator.share({ title: d.title, text: text, url: d.url }).then(done).catch(function (e) { if (e && e.name === 'AbortError') return; copy(d.url); });
      else copy(d.url);
    };
    var copy = function (u) { if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { close(); sayT('The link is copied. Paste it to them; it opens on its own.'); }, function () { showLink(u); }); else showLink(u); };
    if (made) return finish(made); // inside the tap: the share sheet opens at once
    btn.disabled = true; btn.textContent = 'A moment';
    make().then(function (d) { btn.disabled = false; btn.textContent = 'Send'; if (!d || !d.url) { sayT('It could not be sent just now.'); return; } finish(d); });
  }
  function showLink(u) { var p = el.querySelector('.snd-f'); p.innerHTML = 'Copy this and send it: <input class="snd-u" readonly value="' + esc(u) + '">'; var i = p.querySelector('input'); i.focus(); i.select(); }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-wm-send]'); if (!b) return; e.preventDefault(); open({ slug: b.getAttribute('data-wm-send'), title: b.getAttribute('data-send-title') || '', by: b.getAttribute('data-send-by') || '', img: b.getAttribute('data-send-img') || '' }); });
  window.WMSend = { open: open, close: close };
})();
