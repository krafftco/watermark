// Arrivals: the Masters desk's uploader (20 Oct). Each file goes straight into the vault in parts (four in flight),
// by addresses the house signs; the house's server never carries the bytes. Parts already up are remembered on this
// computer (localStorage), so a closed tab or a dropped connection picks up where it stopped. When a vault takes
// no parts (the local disk), the whole file is put to the house in one stream. Progress reads in MB/s and what is
// left; the house's queue (what has been taken in, matched, archived) is shown beneath as it works.
(function () {
  // The sender, shared by the Studio's masters desk and every maker's vault: WMArrivals.send(file, { base, meta,
  // onBytes, stopped }) resolves with the arrival's id once the whole file is in the vault.
  var K = 'wm-arrivals', mem = {}; try { mem = JSON.parse(localStorage.getItem(K) || '{}'); } catch (e) { mem = {}; }
  var save = function () { try { localStorage.setItem(K, JSON.stringify(mem)); } catch (e) { /* full */ } };
  var keyOf = function (f) { return (f.webkitRelativePath || f.name) + ':' + f.size + ':' + (f.lastModified || 0); };
  var post = function (url, body) { return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }).then(function (r) { if (r.status === 401 || r.redirected) throw 'signed-out'; return r.json(); }); };
  // Plain words for what went wrong: the two failures a browser can meet talking to the bucket are both the bucket's
  // CORS rule (docs/ARRIVALS.md), and the desk says so rather than 'Failed to fetch'.
  var CORS = 'The vault did not let the browser in: the bucket needs its CORS rule (ExposeHeaders ETag). See docs/ARRIVALS.md.';
  function putPart(url, blob, tries) {
    return fetch(url, { method: 'PUT', body: blob }).then(function (r) { if (!r.ok) throw new Error('the vault answered ' + r.status); var et = r.headers.get('ETag') || r.headers.get('etag'); if (!et) throw new Error(CORS); return et.replace(/"/g, ''); })
      .catch(function (e) { if (e.message === CORS) throw e; if (e instanceof TypeError) { if (tries > 0) return new Promise(function (res) { setTimeout(res, 1200); }).then(function () { return putPart(url, blob, tries - 1); }); throw new Error(CORS); } if (tries > 0) return new Promise(function (res) { setTimeout(res, 1500 * (4 - tries)); }).then(function () { return putPart(url, blob, tries - 1); }); throw e; });
  }
  // The fingerprint (29 Oct): SHA-256 of each file, taken in a worker before it is sent (public/sha256-worker.js); the
  // house checks the bytes that land against it and asks first whether it already holds them.
  var W = null, wq = {}, wn = 0;
  function hash(f) {
    if (typeof Worker === 'undefined') return Promise.resolve(null);
    if (!W) { try { W = new Worker('/static/sha256-worker.js'); W.onmessage = function (e) { var m = e.data, q = wq[m.id]; if (!q) return; if (m.read != null) { if (q.on) q.on(m.read); return; } delete wq[m.id]; if (m.sha256) q.ok(m.sha256); else q.ok(null); }; W.onerror = function () { for (var k in wq) { wq[k].ok(null); delete wq[k]; } }; } catch (e) { return Promise.resolve(null); } }
    return new Promise(function (ok) { var id = ++wn; wq[id] = { ok: ok }; W.postMessage({ id: id, file: f }); });
  }
  var viaHouse = false; // once the bucket has refused the browser this visit, every file goes through the house
  async function throughHouse(base, m, f, onBytes) {
    var r = await fetch(base + '/arrivals/' + m.id + '/body', { method: 'PUT', credentials: 'same-origin', body: f, headers: { 'content-type': 'application/octet-stream' } }).then(function (r) { if (r.status === 401 || r.redirected) throw 'signed-out'; return r.json(); });
    if (!r.ok) throw new Error(r.error || 'refused'); onBytes(f.size); m.done = true; save(); return m.id;
  }
  async function send(f, o) {
    o = o || {}; var base = o.base || '/studio', k = base + ':' + keyOf(f), m = mem[k] || {}; var folder = (f.webkitRelativePath || '').split('/').slice(0, -1).join('/');
    var onBytes = o.onBytes || function () {}, stopped = o.stopped || function () { return false; };
    // (21 Oct) A file already finished from this computer is sent afresh, never replayed: the memory resumes a send
    // that was cut short, it does not stand in for a new one (the same eighteen chosen again showed the old records
    // and sent nothing). The masters desk still skips files it has sent, through sentBefore.
    if (m.done) m = {};
    if (!m.id) { var body = { name: f.name, size: f.size, type: f.type || 'image/jpeg', folder: folder }; if (o.sha256 === undefined) o.sha256 = await hash(f); if (o.sha256) body.sha256 = o.sha256; if (o.importId) body.import_id = o.importId; var meta = o.meta || {}; for (var key in meta) if (meta[key] != null) body[key] = meta[key]; var st = await post(base + '/arrivals/start', body); if (!st.ok) throw new Error(st.error || 'refused'); if (st.already) { onBytes(f.size); mem[k] = { id: st.id, done: true }; save(); if (o.onAlready) o.onAlready(st.already); return st.id; } m = { id: st.id, direct: st.direct, partSize: st.partSize, parts: st.parts, etags: {} }; mem[k] = m; save(); }
    if (!m.direct || viaHouse) return throughHouse(base, m, f, onBytes);
    var todo = []; for (var n = 1; n <= m.parts; n++) if (!m.etags[n]) todo.push(n); onBytes((m.parts - todo.length) * m.partSize);
    var i = 0;
    async function worker() {
      while (i < todo.length && !stopped()) {
        var n = todo[i++]; var u = await post(base + '/arrivals/' + m.id + '/urls', { parts: String(n) }); if (!u.ok || !u.urls[n]) throw new Error('no address for part ' + n);
        var blob = f.slice((n - 1) * m.partSize, Math.min(f.size, n * m.partSize));
        var et; try { et = await putPart(u.urls[n], blob, 3); } catch (e) { if (e.message === CORS) { viaHouse = true; if (o.onVia) o.onVia('house'); throw 'via-house'; } throw e; } m.etags[n] = et; save(); onBytes(blob.size);
      }
    }
    var lanes = []; for (var l = 0; l < (o.lanes || 4); l++) lanes.push(worker());
    try { await Promise.all(lanes); } catch (e) { if (e === 'via-house') { m.etags = {}; save(); return throughHouse(base, m, f, onBytes); } throw e; }
    if (stopped()) throw 'stopped';
    var parts = []; for (var j = 1; j <= m.parts; j++) parts.push({ n: j, etag: m.etags[j] });
    var d = await post(base + '/arrivals/' + m.id + '/done', { parts: JSON.stringify(parts) }); if (!d.ok) throw new Error(d.error || 'the vault refused');
    m.done = true; save(); return m.id;
  }
  var fmt = function (b) { return b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(0) + ' MB' : Math.round(b / 1e3) + ' KB'; };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  window.WMArrivals = { send: send, hash: hash, post: post, fmt: fmt, esc: esc, sentBefore: function (base, f) { var m = mem[base + ':' + keyOf(f)]; return !!(m && m.done); } };

  // The Studio's masters desk.
  var inp = document.getElementById('mFiles'), go = document.getElementById('mGo'), sum = document.getElementById('mSum'), list = document.getElementById('mList'), bar = document.getElementById('mBar'), q = document.getElementById('mQueue');
  if (!inp || !go) return;
  var files = [], stop = false;
  var keep = function (f) { var p = f.webkitRelativePath || f.name; return /\.(jpe?g|tiff?|png)$/i.test(f.name) && !/(^|\/)[_.]/.test(p) && !window.WMArrivals.sentBefore('/studio', f); };
  inp.onchange = function () { files = [].filter.call(inp.files, keep); var total = files.reduce(function (a, f) { return a + f.size; }, 0); go.disabled = !files.length; go.textContent = files.length ? 'Send ' + files.length + ' masters (' + fmt(total) + ')' : 'Nothing new in that folder'; sum.textContent = files.length ? files.length + ' files chosen, ' + fmt(total) + '. Nothing has been sent yet: press Send.' : 'Every file in that folder has already been sent from this computer.'; if (bar) bar.style.width = '0%'; };
  var sent = 0, t0 = 0, totalBytes = 0;
  var fileNo = 0;
  function tick(extra) { var s = (Date.now() - t0) / 1000, rate = sent / Math.max(s, 1); var left = rate > 0 ? Math.round((totalBytes - sent) / rate / 60) : null; if (bar) bar.style.width = Math.min(100, sent / Math.max(totalBytes, 1) * 100).toFixed(1) + '%'; sum.innerHTML = '<b>Sending ' + fileNo + ' of ' + files.length + '</b> · ' + fmt(sent) + ' of ' + fmt(totalBytes) + ' · ' + (rate / 1e6).toFixed(1) + ' MB/s' + (left != null ? ' · about ' + left + ' min left' : '') + (extra ? ' · ' + esc(extra) : ''); }
  function one(f) { return send(f, { base: '/studio', onBytes: function (b) { sent += b; tick(f.name); }, stopped: function () { return stop; } }); }
  go.onclick = async function () {
    if (go.dataset.running) { stop = true; go.textContent = 'Stopping…'; return; }
    go.dataset.running = '1'; stop = false; t0 = Date.now(); sent = 0; totalBytes = files.reduce(function (a, f) { return a + f.size; }, 0); go.textContent = 'Stop';
    var ok = 0, failed = 0;
    for (var x = 0; x < files.length && !stop; x++) {
      var f = files[x]; fileNo = x + 1; tick(f.name);
      try { await one(f); ok++; var li = document.createElement('li'); li.className = 'done'; li.textContent = (f.webkitRelativePath || f.name) + ' · in the vault'; list.insertBefore(li, list.firstChild); }
      catch (e) { if (e === 'stopped') break; if (e === 'signed-out') { sum.textContent = 'Signed out: sign in again and choose the folder; it picks up where it stopped.'; break; } failed++; var li2 = document.createElement('li'); li2.className = 'fail'; li2.textContent = (f.webkitRelativePath || f.name) + ' · ' + (e.message || e); list.insertBefore(li2, list.firstChild); }
      tick(ok + ' sent' + (failed ? ', ' + failed + ' failed' : ''));
    }
    delete go.dataset.running; go.textContent = stop ? 'Stopped: choose the folder again to continue' : 'Sent ' + ok + (failed ? ' · ' + failed + ' failed' : '');
    if (!stop) sum.innerHTML = ok ? '<b>' + ok + ' in the vault.</b> The house is taking them in below; you can leave this page.' + (failed ? ' ' + failed + ' failed: the reasons are listed.' : '') : (failed ? '<b>Nothing was sent.</b> ' + failed + ' failed: the reason is listed below.' : '');
    if (!stop) { inp.value = ''; }
  };
  // The house's queue beneath, every three seconds while the page is open.
  function queue() {
    fetch('/studio/arrivals/state', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
      if (!s || !q) return; var c = s.counts || {};
      q.innerHTML = '<p class="k">The house takes them in</p><p>' + (s.working ? 'Taking in <b>' + esc(s.working.name) + '</b>' + (s.waiting.length > 1 ? ', ' + (s.waiting.length - 1) + ' waiting' : '') : s.waiting.length ? s.waiting.length + ' waiting' : 'Nothing waiting') + ' · ' + (c.master || 0) + ' masters swapped in · ' + (c.archive || 0) + ' new to the archive · ' + ((c.known || 0) + (c.smaller || 0)) + ' already held' + (s.failed ? ' · ' + s.failed + ' failed' : '') + '</p>' +
        (s.recent.length ? '<ul class="bulk-list">' + s.recent.slice(0, 12).map(function (r) { return '<li class="' + (r.status === 'failed' ? 'fail' : 'done') + '">' + esc(r.name) + ' · ' + (r.status === 'failed' ? esc(r.error || 'failed') + ' <button type="button" class="link" data-retry="' + r.id + '">Try again</button>' : r.outcome === 'master' ? 'master of <a href="/w/' + esc(r.slug) + '">' + esc(r.title || r.slug) + '</a>' : r.outcome === 'archive' ? 'into the archive as <a href="/w/' + esc(r.slug) + '">' + esc(r.title || r.slug) + '</a>' : r.outcome === 'smaller' ? 'no larger than what is held' : 'already held') + '</li>'; }).join('') + '</ul>' : '');
    }).catch(function () {});
  }
  if (q) { q.addEventListener('click', function (e) { var b = e.target.closest('[data-retry]'); if (b) post('/studio/arrivals/' + b.dataset.retry + '/retry', {}).then(queue); }); queue(); setInterval(function () { if (!document.hidden) queue(); }, 3000); }
})();
