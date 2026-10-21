// The tour (src/tours.js): the player on /tour/:slug, and the recorder on a wall's page for its curator.
(function () {
  'use strict';
  // ---- the player ----
  var main = document.querySelector('main.tr[data-tour]');
  if (main) {
    var T; try { T = JSON.parse(main.getAttribute('data-tour')); } catch (e) { T = null; }
    if (T) {
      var stops = T.stops, i = T.at || 0, started = false;
      var im = main.querySelector('.tr-im'), wel = main.querySelector('.tr-welcome'), plate = main.querySelector('.tr-plate'), note = main.querySelector('.tr-note'), n = main.querySelector('.tr-n'), audio = main.querySelector('.tr-audio'), play = main.querySelector('.tr-play');
      var pre = new Image();
      function show(k, go) {
        i = Math.max(0, Math.min(stops.length - 1, k)); var s = stops[i];
        main.classList.toggle('tr-on', !s.welcome); wel.hidden = !s.welcome; im.hidden = !!s.welcome;
        if (!s.welcome) {
          im.src = '/img/' + s.slug + '/large'; im.alt = s.title;
          plate.querySelector('b').textContent = s.title; plate.querySelector('span').textContent = s.maker + (s.place ? ' · ' + s.place : '') + (s.year ? ', ' + s.year : '');
          note.textContent = s.note || ''; n.textContent = i + ' of ' + (stops.length - 1);
          if (stops[i + 1] && stops[i + 1].slug) pre.src = '/img/' + stops[i + 1].slug + '/large';
          try { history.replaceState(null, '', '/tour/' + T.slug + '?at=' + s.slug); } catch (e) { /* */ }
        } else n.textContent = '';
        audio.pause(); main.classList.remove('tr-playing');
        if (s.voice) { audio.src = s.voice; if (go && started) audio.play().catch(function () {}); main.classList.add('tr-voiced'); } else { audio.removeAttribute('src'); main.classList.remove('tr-voiced'); }
      }
      audio.addEventListener('play', function () { main.classList.add('tr-playing'); });
      audio.addEventListener('pause', function () { main.classList.remove('tr-playing'); });
      audio.addEventListener('ended', function () { setTimeout(function () { if (i < stops.length - 1) show(i + 1, true); }, 1400); });
      main.querySelector('.tr-begin').addEventListener('click', function () { started = true; if (stops[0].voice && i === 0) { audio.play().catch(function () {}); audio.addEventListener('ended', function once() { audio.removeEventListener('ended', once); }, { once: true }); } else show(1, true); });
      // After the welcome plays, walk on.
      audio.addEventListener('ended', function () { if (i === 0) show(1, true); });
      main.querySelector('.tr-next').addEventListener('click', function () { started = true; show(i + 1, true); });
      main.querySelector('.tr-prev').addEventListener('click', function () { show(i - 1, true); });
      play.addEventListener('click', function () { started = true; if (!audio.src) return; if (audio.paused) audio.play().catch(function () {}); else audio.pause(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); if (e.key === ' ' && audio.src) play.click(); else { started = true; show(i + 1, true); } } else if (e.key === 'ArrowLeft') show(i - 1, true); else if (e.key === 'Escape') location.href = main.querySelector('.tr-back').href; });
      var x0 = null; main.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true }); main.addEventListener('touchend', function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) { started = true; show(dx < 0 ? i + 1 : i - 1, true); } }, { passive: true });
      if (i > 0) show(i, false); else show(0, false);
    }
  }
  // ---- the recorder (the curator, on their own wall) ----
  var recs = document.querySelectorAll('[data-tour-rec]');
  if (!recs.length) return;
  var canRec = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  recs.forEach(function (box) {
    var b = box.querySelector('.tr-rec-b'), s = box.querySelector('.tr-rec-s'), x = box.querySelector('.tr-rec-x'), url = box.getAttribute('data-tour-rec');
    if (!canRec) { b.disabled = true; s.textContent = 'Recording needs a browser with a microphone.'; return; }
    var rec = null, chunks = [], t0 = 0, tick = null, stream = null;
    function stop() {
      if (!rec || rec.state === 'inactive') return; clearInterval(tick); rec.stop();
    }
    function fmt(sec) { return Math.floor(sec / 60) + ':' + ('0' + Math.floor(sec % 60)).slice(-2); }
    b.addEventListener('click', function () {
      if (rec && rec.state === 'recording') return stop();
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) {
        stream = st; chunks = [];
        var mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].filter(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); })[0];
        rec = new MediaRecorder(st, mime ? { mimeType: mime } : undefined);
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          st.getTracks().forEach(function (t) { t.stop(); });
          var secs = (Date.now() - t0) / 1000; var blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
          b.textContent = 'Keeping it…'; b.disabled = true; s.textContent = fmt(secs);
          var fd = new FormData(); fd.append('seconds', String(Math.round(secs))); fd.append('voice', blob, 'voice.' + (/mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm'));
          fetch(url, { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(function (j) {
            b.disabled = false; b.textContent = 'Say it again'; s.textContent = 'Kept · ' + fmt(secs);
            var a = box.querySelector('audio'); if (!a) { a = document.createElement('audio'); a.controls = true; a.preload = 'none'; box.insertBefore(a, s); }
            a.src = j.src + '?t=' + Date.now();
            if (!x) { x = document.createElement('button'); x.type = 'button'; x.className = 'link tr-rec-x'; x.textContent = 'Remove'; box.insertBefore(x, s); wireX(); }
          }).catch(function () { b.disabled = false; b.textContent = 'Try again'; s.textContent = 'The house could not keep it.'; });
        };
        rec.start(250); t0 = Date.now(); b.textContent = 'Stop'; s.textContent = '● 0:00';
        tick = setInterval(function () { var secs = (Date.now() - t0) / 1000; s.textContent = '● ' + fmt(secs); if (secs >= 180) stop(); }, 500);
      }).catch(function () { s.textContent = 'The microphone was not allowed.'; });
    });
    function wireX() { if (!x) return; x.addEventListener('click', function () { fetch(url + '/remove', { method: 'POST', credentials: 'same-origin' }).then(function () { var a = box.querySelector('audio'); if (a) a.remove(); x.remove(); x = null; b.textContent = /welcome/.test(url) ? 'Record a welcome' : 'Say a word on this one'; s.textContent = ''; }); }); }
    wireX();
  });
})();
