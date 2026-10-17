/* Voices: hear the maker, or an art historian, on a photograph. One player for the page; a ring
   fills as it plays. On the editing page, record straight from the microphone. */
(function () {
  if (window.WMVoice) return;
  var audio = new Audio(), btn = null; audio.preload = 'none';
  function set(b, on) { if (!b) return; b.classList.toggle('on', on); }
  audio.addEventListener('timeupdate', function () { if (btn && audio.duration) btn.style.setProperty('--p', (audio.currentTime / audio.duration * 100).toFixed(1) + '%'); });
  audio.addEventListener('ended', function () { set(btn, false); if (btn) btn.style.setProperty('--p', '0%'); });
  audio.addEventListener('pause', function () { set(btn, false); });
  audio.addEventListener('play', function () { set(btn, true); });
  function play(src, b) {
    if (btn === b && !audio.paused) { audio.pause(); return; }
    if (btn !== b || audio.getAttribute('data-src') !== src) { if (btn) { set(btn, false); btn.style.setProperty('--p', '0%'); } audio.src = src; audio.setAttribute('data-src', src); }
    btn = b; audio.play().catch(function () {});
  }
  window.WMVoice = { play: play, stop: function () { audio.pause(); } };
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-voice]'); if (!b) return; e.preventDefault(); play(b.getAttribute('data-voice'), b); });

  // ---------- recording, on the editing page ----------
  var form = document.querySelector('[data-vo-form]'); if (!form) return;
  var rb = form.querySelector('[data-rec]'), tm = form.querySelector('[data-rec-time]'), pl = form.querySelector('[data-rec-play]');
  var rec = null, chunks = [], blob = null, t0 = 0, tick = null, secs = 0;
  if (!window.MediaRecorder || !navigator.mediaDevices) { rb.hidden = true; tm.hidden = true; }
  rb.addEventListener('click', async function () {
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(function (t) { return MediaRecorder.isTypeSupported(t); }) || '';
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined); chunks = [];
      rec.ondataavailable = function (ev) { if (ev.data.size) chunks.push(ev.data); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); }); clearInterval(tick);
        blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); pl.src = URL.createObjectURL(blob); pl.hidden = false;
        rb.classList.remove('on'); rb.querySelector('span').textContent = 'Record again';
      };
      rec.start(); t0 = Date.now(); rb.classList.add('on'); rb.querySelector('span').textContent = 'Stop';
      tick = setInterval(function () { secs = Math.round((Date.now() - t0) / 1000); tm.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'); }, 250);
    } catch (e) { tm.textContent = 'The microphone is not available here.'; }
  });
  // A chosen file: measure it, so the page can say how long it is.
  form.querySelector('input[type=file]').addEventListener('change', function () {
    var f = this.files[0]; if (!f) return; var a = new Audio(URL.createObjectURL(f));
    a.addEventListener('loadedmetadata', function () { if (isFinite(a.duration)) form.elements.seconds.value = Math.round(a.duration); });
  });
  form.addEventListener('submit', async function (e) {
    if (!blob) return; // a file or words alone go the ordinary way
    e.preventDefault();
    var fd = new FormData(form); fd.delete('audio'); fd.set('seconds', secs);
    fd.append('audio', blob, 'voice' + (/mp4/.test(blob.type) ? '.m4a' : '.webm'));
    var b = form.querySelector('.buy-btn'); b.disabled = true; b.textContent = 'Saving…';
    var r = await fetch(form.action, { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
    location.href = form.action + (r.ok ? '?ok=1' : '?ok=empty');
  });
})();
