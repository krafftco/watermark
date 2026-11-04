// The note sheet (4 Nov): any [data-note=slug] opens it. Write a line, or press Say it and talk: the voice is kept and,
// where the browser can, the words are written as you speak. Or bring a finished recording. Private unless shared.
(function () {
  var sheet = null, slug = null, rec = null, chunks = [], blob = null, t0 = 0, timer = null, sr = null, made = 'voice';
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function el(h) { var d = document.createElement('div'); d.innerHTML = h; return d.firstChild; }
  function build() {
    sheet = el('<div class="nbs" role="dialog" aria-modal="true" aria-label="A note" hidden><div class="nbs-s">'
      + '<header><b>A note</b><button type="button" class="nbs-x" data-nbs-x aria-label="Close">×</button></header>'
      + '<textarea data-nbs-t rows="5" maxlength="4000" placeholder="What it makes you think, or feel. A line is enough."></textarea>'
      + '<div class="nbs-v"><button type="button" class="nbs-say" data-nbs-say><span class="nbs-dot"></span><span data-nbs-sayw>Say it</span></button><span class="nbs-tm" data-nbs-tm></span>'
      + '<label class="nbs-f">Bring a recording<input type="file" accept="audio/*,video/mp4" data-nbs-file hidden></label></div>'
      + '<div class="nbs-a" data-nbs-a hidden><audio controls data-nbs-au></audio><button type="button" data-nbs-drop>Leave the recording out</button></div>'
      + '<p class="nbs-h" data-nbs-h>' + (SR ? 'Say it keeps your voice and writes your words as you speak.' : 'Say it keeps your voice.') + '</p>'
      + '<label class="nbs-p"><input type="checkbox" data-nbs-pub> Share it under the work, with my first name</label>'
      + '<footer><span data-nbs-say2 class="nbs-msg"></span><button type="button" class="buy-btn" data-nbs-keep>Keep</button></footer></div></div>');
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet || e.target.closest('[data-nbs-x]')) close(); });
    q('[data-nbs-say]').addEventListener('click', toggle);
    q('[data-nbs-file]').addEventListener('change', function (e) { var f = e.target.files[0]; if (!f) return; stop(); blob = f; made = 'file'; show(); });
    q('[data-nbs-drop]').addEventListener('click', function () { blob = null; q('[data-nbs-a]').hidden = true; });
    q('[data-nbs-keep]').addEventListener('click', keep);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheet && !sheet.hidden) close(); });
  }
  function q(s) { return sheet.querySelector(s); }
  function say(m) { q('.nbs-msg').textContent = m || ''; }
  function show() { var a = q('[data-nbs-au]'); a.src = URL.createObjectURL(blob); q('[data-nbs-a]').hidden = false; }
  function open(s) {
    if (!sheet) build(); slug = s; blob = null; chunks = []; made = 'voice';
    q('[data-nbs-t]').value = ''; q('[data-nbs-a]').hidden = true; q('[data-nbs-pub]').checked = false; say('');
    sheet.hidden = false; setTimeout(function () { q('[data-nbs-t]').focus(); }, 30);
  }
  function close() { stop(); if (sheet) sheet.hidden = true; }
  function tick() { var s = Math.round((Date.now() - t0) / 1000); q('[data-nbs-tm]').textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function toggle() { if (rec && rec.state === 'recording') stop(); else start(); }
  function start() {
    if (!navigator.mediaDevices || !window.MediaRecorder) { say('This browser cannot record. Write it, or bring a recording.'); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) {
      chunks = []; blob = null; made = 'voice';
      try { rec = new MediaRecorder(st); } catch (e) { say('This browser cannot record.'); return; }
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () { st.getTracks().forEach(function (t) { t.stop(); }); if (chunks.length) { blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); show(); } };
      rec.start(); t0 = Date.now(); tick(); timer = setInterval(tick, 500);
      sheet.classList.add('nbs-on'); q('[data-nbs-sayw]').textContent = 'Stop';
      if (SR) { // the words, as they are said
        try {
          var ta = q('[data-nbs-t]'), base = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
          sr = new SR(); sr.continuous = true; sr.interimResults = true; sr.lang = document.documentElement.lang || 'en-US';
          sr.onresult = function (e) { var fin = '', mid = ''; for (var i = 0; i < e.results.length; i++) { if (e.results[i].isFinal) fin += e.results[i][0].transcript; else mid += e.results[i][0].transcript; } ta.value = base + fin + mid; };
          sr.onerror = function () { /* the voice is still kept */ };
          sr.start();
        } catch (e) { sr = null; }
      }
    }).catch(function () { say('The microphone was not allowed. Write it instead, or allow it and try again.'); });
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (sr) { try { sr.stop(); } catch (e) { /* */ } sr = null; }
    if (rec && rec.state === 'recording') rec.stop();
    if (sheet) { sheet.classList.remove('nbs-on'); q('[data-nbs-sayw]').textContent = 'Say it again'; }
  }
  function keep() {
    if (rec && rec.state === 'recording') { var was = rec.onstop; rec.onstop = function (e) { was && was(e); keep(); }; stop(); return; } // let the recorder hand over its last piece
    stop();
    var body = q('[data-nbs-t]').value.trim();
    (function () {
      if (!body && !blob) { say('Write a line, or say it.'); return; }
      var fd = new FormData(); fd.append('body', body); fd.append('public', q('[data-nbs-pub]').checked ? '1' : '0');
      if (blob) { fd.append('voice', blob, made === 'file' && blob.name ? blob.name : 'note.webm'); fd.append('made', made); if (made === 'voice') fd.append('seconds', String(Math.round((Date.now() - t0) / 1000))); }
      say('Keeping…'); q('[data-nbs-keep]').disabled = true;
      fetch('/w/' + encodeURIComponent(slug) + '/note', { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
        .then(function (x) {
          q('[data-nbs-keep]').disabled = false;
          if (x.j.go) { location.href = x.j.go; return; }
          if (!x.j.ok) { say(x.j.error || 'It could not be kept just now.'); return; }
          sheet.querySelector('.nbs-s').innerHTML = '<header><b>Kept.</b><button type="button" class="nbs-x" data-nbs-x aria-label="Close">×</button></header><p>' + (x.j.public ? 'It hangs under the work, with your first name.' : 'Yours alone.') + ' Everything you keep is in <a href="/yours/kept">Kept</a>.</p>';
          setTimeout(function () { if (sheet) { sheet.remove(); sheet = null; } }, 2600);
        }).catch(function () { q('[data-nbs-keep]').disabled = false; say('No connection. Try again in a moment.'); });
    })();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-note]'); if (!b) return;
    e.preventDefault(); e.stopPropagation(); open(b.getAttribute('data-note'));
  }, true);
})();
