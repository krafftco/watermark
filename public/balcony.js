/* The balcony (19 Oct): a stream of presence and lines while the room is open; nothing kept on this side either.
   Tap a name for a word with that person; the host's ask to keep a line appears beside it and waits for your yes. */
(function () {
  var root = document.querySelector('[data-balcony]'); if (!root) return;
  var keyed = root.getAttribute('data-keyed') === '1';
  var lines = root.querySelector('[data-lines]'), present = root.querySelector('[data-present] .bc-names'), wall = root.querySelector('[data-wall]');
  var word = root.querySelector('[data-word]'), wName = root.querySelector('[data-word-name]'), wLines = root.querySelector('[data-word-lines]'), wForm = root.querySelector('[data-word-say]');
  var names = {}, me = null, talking = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function post(u, body) { return fetch(u, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); }); }
  function addLine(l) {
    if (!lines) return;
    var li = document.createElement('li'); li.dataset.id = l.id; li.dataset.who = l.who;
    li.innerHTML = '<b data-name="' + esc(l.who) + '">' + esc(l.name) + '</b><span>' + esc(l.body) + '</span>' + (me && me.host && l.who !== me.id ? '<button type="button" class="link bc-keep" data-keep="' + l.id + '">Keep it?</button>' : '');
    lines.appendChild(li); while (lines.children.length > 120) lines.removeChild(lines.firstChild);
    lines.scrollTop = lines.scrollHeight;
  }
  var es = new EventSource('/balcony/stream');
  es.addEventListener('state', function (e) { var s = JSON.parse(e.data); me = s.you; names = {}; if (present) present.textContent = s.present.n ? s.present.names.join(' · ') : 'No one yet. Be first.'; });
  es.addEventListener('presence', function (e) { var p = JSON.parse(e.data); if (present) present.textContent = p.n ? p.names.join(' · ') : 'No one yet.'; });
  es.addEventListener('line', function (e) { addLine(JSON.parse(e.data)); });
  es.addEventListener('wall', function (e) { var w = JSON.parse(e.data); if (wall) wall.innerHTML = '<figure style="--r:' + w.r + '"><img src="/img/' + esc(w.slug) + '/large" alt=""><figcaption><i>' + esc(w.title) + '</i> · ' + esc(w.maker) + (w.place ? ', ' + esc(w.place) : '') + ' · the wall tonight</figcaption></figure>'; });
  es.addEventListener('piano', function () { location.reload(); });
  es.addEventListener('word', function (e) { var l = JSON.parse(e.data); var other = l.from === (me && me.id) ? l.to : l.from; if (!talking || talking.id !== other) openWord(other, l.from === (me && me.id) ? talking && talking.name : l.name); var li = document.createElement('li'); li.innerHTML = '<b>' + esc(l.name) + '</b><span>' + esc(l.body) + '</span>'; wLines.appendChild(li); wLines.scrollTop = wLines.scrollHeight; });
  es.addEventListener('ask', function (e) { var a = JSON.parse(e.data); var li = lines && lines.querySelector('li[data-id="' + a.id + '"]'); if (!li) return; var b = document.createElement('button'); b.type = 'button'; b.className = 'bc-yes'; b.textContent = 'The host asks to keep this on the bench under ' + a.wall + '. Yes?'; b.addEventListener('click', function () { post('/balcony/keep/' + a.id + '/yes').then(function (r) { if (r.ok) { b.textContent = 'Kept, in your name.'; b.disabled = true; } }); }); li.appendChild(b); });
  es.addEventListener('kept', function (e) { var k = JSON.parse(e.data); var li = lines && lines.querySelector('li[data-id="' + k.id + '"]'); if (li) li.classList.add('kept'); });
  es.addEventListener('closed', function () { es.close(); if (lines) lines.innerHTML = ''; root.classList.remove('on'); var p = root.querySelector('.bc-hours'); if (p) p.textContent = 'Closed for tonight. Nothing said here was kept.'; });
  var say = root.querySelector('[data-say]');
  if (say) say.addEventListener('submit', function (e) { e.preventDefault(); var inp = say.querySelector('input'); var v = inp.value.trim(); if (!v) return; post('/balcony/say', { body: v }).then(function (r) { if (r.ok) inp.value = ''; }); });
  function openWord(id, name) { talking = { id: id, name: name || id }; wName.textContent = talking.name; wLines.innerHTML = ''; word.hidden = false; }
  root.addEventListener('click', function (e) {
    var k = e.target.closest('[data-keep]'); if (k) { post('/balcony/keep/' + k.getAttribute('data-keep')).then(function () { k.textContent = 'Asked.'; }); return; }
    var n = e.target.closest('[data-name]'); if (n && keyed && me && n.getAttribute('data-name') !== me.id) { openWord(n.getAttribute('data-name'), n.textContent); return; }
    if (e.target.closest('[data-word-close]')) { word.hidden = true; talking = null; }
  });
  if (wForm) wForm.addEventListener('submit', function (e) { e.preventDefault(); if (!talking) return; var inp = wForm.querySelector('input'); var v = inp.value.trim(); if (!v) return; post('/balcony/word', { to: talking.id, body: v }).then(function (r) { if (r.ok) inp.value = ''; }); });
  addEventListener('pagehide', function () { es.close(); });
})();
