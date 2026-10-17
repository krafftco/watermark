// Hanging, the way Pinterest saves: one button, a sheet of your walls, tap a wall and it is hung; a new wall is one
// line. And on your own wall, arrange by dragging. No page changes.
(function () {
  var I = { hang: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.2" r="1"/><path d="M12 5.2 7.2 9.6M12 5.2l4.8 4.4"/><rect x="4.8" y="9.6" width="14.4" height="10.4"/><rect x="7.6" y="12.2" width="8.8" height="5.2"/></svg>', check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.2 4.2L19 7.4"/></svg>' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var sheet = null;
  function openSheet(slug, anchor) {
    if (sheet) sheet.remove();
    sheet = document.createElement('div'); sheet.className = 'hs'; sheet.innerHTML = '<div class="hs-bg"></div><div class="hs-card" role="dialog" aria-label="Hang it"><div class="hs-head"><b>Hang it on a wall</b><button type="button" class="hs-x" aria-label="Close">&times;</button></div><form class="hs-new"><input name="title" placeholder="A new wall: give it a title" maxlength="80" autocomplete="off"><button type="submit">Make it and hang</button></form><div class="hs-list"><p class="hs-wait">Your walls…</p></div><p class="hs-note">Choose a wall; the photograph is hung at once. Walls are private until you show them.</p></div>';
    document.body.appendChild(sheet); requestAnimationFrame(function () { sheet.classList.add('on'); });
    var close = function () { if (!sheet) return; sheet.classList.remove('on'); setTimeout(function () { sheet && sheet.remove(); sheet = null; }, 240); };
    sheet.querySelector('.hs-bg').addEventListener('click', close); sheet.querySelector('.hs-x').addEventListener('click', close);
    document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc_); } });
    var list = sheet.querySelector('.hs-list');
    function row(h) { return '<button type="button" class="hs-row" data-id="' + h.id + '">' + (h.thumb ? '<img src="/img/' + esc(h.thumb) + '/thumb" alt="">' : '<span class="hs-blank"></span>') + '<span class="hs-t"><b>' + esc(h.title) + '</b><small>' + h.n + ' photograph' + (h.n === 1 ? '' : 's') + (h.public ? ' · shown' : ' · private') + '</small></span><span class="hs-go">Hang</span></button>'; }
    function hang(id, title, btn) {
      var body = new URLSearchParams({ work: slug, hang: id, title: title || '', json: '1' });
      if (btn) { btn.disabled = true; btn.querySelector('.hs-go').textContent = '…'; }
      fetch('/hang/add', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok) throw 0;
        if (btn) { btn.classList.add('done'); btn.querySelector('.hs-go').innerHTML = I.check + ' Hung'; var n = btn.querySelector('small'); if (n) n.textContent = n.textContent.replace(/^\d+/, function (m) { return String(+m + 1); }); }
        var a = document.createElement('a'); a.className = 'hs-seen'; a.href = '/hang/' + j.slug; a.textContent = 'See the wall →'; sheet.querySelector('.hs-note').replaceWith(a);
        var it = anchor && anchor.closest('[data-hangit]'); if (it) { var ob = it.querySelector('[data-hang-open] span'); if (ob) ob.textContent = 'Hung'; }
        setTimeout(close, 1400);
      }).catch(function () { if (btn) { btn.disabled = false; btn.querySelector('.hs-go').textContent = 'Hang'; } });
    }
    fetch('/api/hangs/mine', { headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) {
      var hs = (j && j.hangs) || [];
      list.innerHTML = hs.length ? hs.map(row).join('') : '<p class="hs-wait">No wall yet. Make one above; it takes a title.</p>';
      list.querySelectorAll('.hs-row').forEach(function (b) { b.addEventListener('click', function () { hang(b.getAttribute('data-id'), '', b); }); });
    }).catch(function () { list.innerHTML = '<p class="hs-wait">Your walls could not be fetched.</p>'; });
    var nf = sheet.querySelector('.hs-new'); nf.addEventListener('submit', function (e) { e.preventDefault(); var t = nf.title.value.trim(); if (!t) { nf.title.focus(); return; } nf.querySelector('button').disabled = true; hang('new', t); });
    setTimeout(function () { nf.title.focus(); }, 260);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-hang-open]'); if (!b) return; e.preventDefault();
    var it = b.closest('[data-hangit]'); openSheet(it ? it.getAttribute('data-hangit') : b.getAttribute('data-hang-open'), b);
  });

  // Arranging: drag the plates on your own wall.
  var wall = document.querySelector('[data-arrange]');
  if (wall) {
    var url = wall.getAttribute('data-arrange'), dragging = null, saveT = null;
    function save() { clearTimeout(saveT); saveT = setTimeout(function () { var order = [].map.call(wall.querySelectorAll('.hg-pl'), function (p, i) { var n = p.querySelector('.hg-grip i'); if (n) n.textContent = i + 1; return p.getAttribute('data-slug'); }).join(','); fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ order: order }) }).then(function () { wall.classList.add('saved'); setTimeout(function () { wall.classList.remove('saved'); }, 900); }); }, 300); }
    wall.addEventListener('dragstart', function (e) { var p = e.target.closest('.hg-pl'); if (!p) return; dragging = p; p.classList.add('lift'); try { e.dataTransfer.setData('text/plain', p.getAttribute('data-slug')); e.dataTransfer.effectAllowed = 'move'; } catch (x) {} });
    wall.addEventListener('dragend', function () { if (dragging) dragging.classList.remove('lift'); dragging = null; wall.querySelectorAll('.over').forEach(function (p) { p.classList.remove('over'); }); });
    wall.addEventListener('dragover', function (e) { if (!dragging) return; e.preventDefault(); var p = e.target.closest('.hg-pl'); if (!p || p === dragging) return; var r = p.getBoundingClientRect(); var before = e.clientY < r.top + r.height / 2; p.parentNode.insertBefore(dragging, before ? p : p.nextSibling); });
    wall.addEventListener('drop', function (e) { e.preventDefault(); save(); });
    // Touch: press the grip, move, release.
    var tp = null, ghost = null;
    wall.addEventListener('touchstart', function (e) { var g = e.target.closest('.hg-grip'); if (!g) return; tp = g.closest('.hg-pl'); tp.classList.add('lift'); }, { passive: true });
    wall.addEventListener('touchmove', function (e) { if (!tp) return; e.preventDefault(); var t = e.touches[0], el = document.elementFromPoint(t.clientX, t.clientY), p = el && el.closest('.hg-pl'); if (!p || p === tp) return; var r = p.getBoundingClientRect(); p.parentNode.insertBefore(tp, t.clientY < r.top + r.height / 2 ? p : p.nextSibling); }, { passive: false });
    wall.addEventListener('touchend', function () { if (!tp) return; tp.classList.remove('lift'); tp = null; save(); });
  }
})();
