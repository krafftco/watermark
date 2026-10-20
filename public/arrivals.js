// Arrivals: the Masters desk's uploader (20 Oct). Each file goes straight into the vault in parts (four in flight),
// by addresses the house signs; the house's server never carries the bytes. Parts already up are remembered on this
// computer (localStorage), so a closed tab or a dropped connection picks up where it stopped. When a vault takes
// no parts (the local disk), the whole file is put to the house in one stream. Progress reads in MB/s and what is
// left; the house's queue (what has been taken in, matched, archived) is shown beneath as it works.
(function () {
  var inp = document.getElementById('mFiles'), go = document.getElementById('mGo'), sum = document.getElementById('mSum'), list = document.getElementById('mList'), bar = document.getElementById('mBar'), q = document.getElementById('mQueue');
  if (!inp || !go) return;
  var K = 'wm-arrivals', mem = {}; try { mem = JSON.parse(localStorage.getItem(K) || '{}'); } catch (e) { mem = {}; }
  var save = function () { try { localStorage.setItem(K, JSON.stringify(mem)); } catch (e) { /* full */ } };
  var files = [], stop = false, PAR = 4;
  var keyOf = function (f) { return (f.webkitRelativePath || f.name) + ':' + f.size + ':' + (f.lastModified || 0); };
  var keep = function (f) { var p = f.webkitRelativePath || f.name; return /\.(jpe?g|tiff?|png)$/i.test(f.name) && !/(^|\/)[_.]/.test(p) && !(mem[keyOf(f)] && mem[keyOf(f)].done); };
  var fmt = function (b) { return b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(0) + ' MB' : Math.round(b / 1e3) + ' KB'; };
  var post = function (url, body) { return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }).then(function (r) { if (r.status === 401 || r.redirected) throw 'signed-out'; return r.json(); }); };
  inp.onchange = function () { files = [].filter.call(inp.files, keep); var total = files.reduce(function (a, f) { return a + f.size; }, 0); go.disabled = !files.length; go.textContent = files.length ? 'Send ' + files.length + ' masters (' + fmt(total) + ')' : 'Nothing new in that folder'; var done = Object.keys(mem).filter(function (k) { return mem[k].done; }).length; sum.textContent = done ? done + ' already sent from this computer.' : ''; };

  function putPart(url, blob, tries) {
    return fetch(url, { method: 'PUT', body: blob }).then(function (r) { if (!r.ok) throw new Error('part ' + r.status); var et = r.headers.get('ETag') || r.headers.get('etag'); if (!et) throw new Error('no-etag'); return et.replace(/"/g, ''); })
      .catch(function (e) { if (String(e.message) === 'no-etag') throw e; if (tries > 0) return new Promise(function (res) { setTimeout(res, 1500 * (4 - tries)); }).then(function () { return putPart(url, blob, tries - 1); }); throw e; });
  }
  var sent = 0, t0 = 0, totalBytes = 0;
  function tick(extra) { var s = (Date.now() - t0) / 1000, rate = sent / Math.max(s, 1); var left = rate > 0 ? Math.round((totalBytes - sent) / rate / 60) : null; if (bar) bar.style.width = Math.min(100, sent / Math.max(totalBytes, 1) * 100).toFixed(1) + '%'; sum.textContent = fmt(sent) + ' of ' + fmt(totalBytes) + ' · ' + (rate / 1e6).toFixed(1) + ' MB/s' + (left != null ? ' · about ' + left + ' min left' : '') + (extra ? ' · ' + extra : ''); }
  async function one(f) {
    var k = keyOf(f), m = mem[k] || {}; var folder = (f.webkitRelativePath || '').split('/').slice(0, -1).join('/');
    if (!m.id) { var st = await post('/studio/arrivals/start', { name: f.name, size: f.size, type: f.type || 'image/jpeg', folder: folder }); if (!st.ok) throw new Error(st.error || 'refused'); m = { id: st.id, direct: st.direct, partSize: st.partSize, parts: st.parts, etags: {} }; mem[k] = m; save(); }
    if (!m.direct) {
      var r = await fetch('/studio/arrivals/' + m.id + '/body', { method: 'PUT', credentials: 'same-origin', body: f, headers: { 'content-type': 'application/octet-stream' } }).then(function (r) { return r.json(); });
      if (!r.ok) throw new Error(r.error || 'refused'); sent += f.size; m.done = true; save(); return;
    }
    var todo = []; for (var n = 1; n <= m.parts; n++) if (!m.etags[n]) todo.push(n); sent += (m.parts - todo.length) * m.partSize;
    var i = 0;
    async function worker() {
      while (i < todo.length && !stop) {
        var n = todo[i++]; var u = await post('/studio/arrivals/' + m.id + '/urls', { parts: String(n) }); if (!u.ok || !u.urls[n]) throw new Error('no address for part ' + n);
        var blob = f.slice((n - 1) * m.partSize, Math.min(f.size, n * m.partSize));
        var et = await putPart(u.urls[n], blob, 3); m.etags[n] = et; sent += blob.size; save(); tick(f.name);
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (stop) throw 'stopped';
    var parts = []; for (var j = 1; j <= m.parts; j++) parts.push({ n: j, etag: m.etags[j] });
    var d = await post('/studio/arrivals/' + m.id + '/done', { parts: JSON.stringify(parts) }); if (!d.ok) throw new Error(d.error || 'the vault refused');
    m.done = true; save();
  }
  go.onclick = async function () {
    if (go.dataset.running) { stop = true; go.textContent = 'Stopping…'; return; }
    go.dataset.running = '1'; stop = false; t0 = Date.now(); sent = 0; totalBytes = files.reduce(function (a, f) { return a + f.size; }, 0); go.textContent = 'Stop';
    var ok = 0, failed = 0;
    for (var x = 0; x < files.length && !stop; x++) {
      var f = files[x];
      try { await one(f); ok++; var li = document.createElement('li'); li.className = 'done'; li.textContent = (f.webkitRelativePath || f.name) + ' · in the vault'; list.insertBefore(li, list.firstChild); }
      catch (e) { if (e === 'stopped') break; if (e === 'signed-out') { sum.textContent = 'Signed out: sign in again and choose the folder; it picks up where it stopped.'; break; } failed++; var li2 = document.createElement('li'); li2.className = 'fail'; li2.textContent = (f.webkitRelativePath || f.name) + ' · ' + (e.message || e); list.insertBefore(li2, list.firstChild); }
      tick(ok + ' sent' + (failed ? ', ' + failed + ' failed' : ''));
    }
    delete go.dataset.running; go.textContent = stop ? 'Stopped: choose the folder again to continue' : 'Sent ' + ok + (failed ? ' · ' + failed + ' failed' : '');
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
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  if (q) { q.addEventListener('click', function (e) { var b = e.target.closest('[data-retry]'); if (b) post('/studio/arrivals/' + b.dataset.retry + '/retry', {}).then(queue); }); queue(); setInterval(function () { if (!document.hidden) queue(); }, 3000); }
})();
