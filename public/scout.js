// The scout: a museum's open collection searched where it lives, ticked, brought in.
(function () {
  var root = document.querySelector('[data-sct]'); if (!root) return;
  var f = root.querySelector('[data-sct-f]'), g = root.querySelector('[data-sct-g]'), n = root.querySelector('[data-sct-n]'), pg = root.querySelector('[data-sct-pg]');
  var bar = root.querySelector('[data-sct-bar]'), cnt = root.querySelector('[data-sct-c]'), dlg = root.querySelector('[data-sct-d]');
  var KEY = 'wm_scout', picked = {}; try { picked = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { picked = {}; }
  var state = { page: 1 }, last = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function src() { return (f.querySelector('[name=src]:checked') || {}).value || 'met'; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(picked)); } catch (e) { /* */ } var k = Object.keys(picked).length; bar.hidden = !k && !(last && last.items.length); cnt.textContent = k ? k + ' chosen' : 'Nothing chosen yet'; root.querySelector('[data-sct-go]').disabled = !k; }
  function tile(it) {
    var on = !!picked[it.id];
    return '<figure class="sct-t' + (on ? ' on' : '') + (it.held ? ' held' : '') + (it.open ? '' : ' shut') + '" data-id="' + esc(it.id) + '"><button type="button" class="sct-im" data-look><img loading="lazy" src="' + esc(it.thumb) + '" alt=""></button>' +
      (it.held ? '<a class="sct-hd" href="/w/' + esc(it.held) + '">Held</a>' : it.open ? '<label class="sct-tk"><input type="checkbox" data-tick' + (on ? ' checked' : '') + '><span></span></label>' : '<span class="sct-hd">Not open</span>') +
      '<figcaption><b>' + esc(it.label) + '</b><i>' + esc([it.by, it.date].filter(Boolean).join(', ')) + '</i>' + (it.medium ? '<small>' + esc(it.medium) + '</small>' : '') + '</figcaption></figure>';
  }
  function draw(r) {
    last = r; var pages = Math.ceil(Math.min(r.total, 10000) / r.per) || 1;
    n.textContent = r.total ? r.total.toLocaleString() + ' open works with pictures' + (r.total > 10000 ? ' (the first 10,000 can be paged)' : '') + ' · page ' + r.page + ' of ' + pages : 'Nothing found. Try another word.';
    g.innerHTML = r.items.map(tile).join('');
    pg.innerHTML = (r.page > 1 ? '<button type="button" class="link" data-pg="' + (r.page - 1) + '">← Before</button>' : '') + (r.page < pages ? '<button type="button" class="link" data-pg="' + (r.page + 1) + '">Next →</button>' : '');
    save();
  }
  function look(page) {
    state.page = page || 1; var fd = new FormData(f), q = new URLSearchParams();
    fd.forEach(function (v, k) { q.set(k, v); }); q.set('page', state.page);
    n.textContent = 'Looking…'; g.innerHTML = ''; if (window.WMWave) WMWave.show();
    fetch('/studio/scout/api?' + q, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (r) { if (window.WMWave) WMWave.hide(); if (r.error) { n.textContent = r.error; return; } draw(r); window.scrollTo({ top: 0 }); }).catch(function () { if (window.WMWave) WMWave.hide(); n.textContent = 'The museum did not answer. Try again.'; });
  }
  f.addEventListener('submit', function (e) { e.preventDefault(); look(1); });
  f.addEventListener('change', function (e) { if (e.target.name === 'src' || e.target.type === 'checkbox') look(1); });
  pg.addEventListener('click', function (e) { var b = e.target.closest('[data-pg]'); if (b) look(+b.dataset.pg); });
  function item(id) { return last && last.items.filter(function (x) { return x.id === id; })[0]; }
  g.addEventListener('change', function (e) {
    if (!e.target.matches('[data-tick]')) return; var t = e.target.closest('.sct-t'), it = item(t.dataset.id); if (!it) return;
    if (e.target.checked) picked[it.id] = { id: it.id, label: it.label, image: it.image, thumb: it.thumb, summary: it.summary, meta: it.meta, artist: it.artist, kind: it.kind, rights: it.rights, src: src() }; else delete picked[it.id];
    t.classList.toggle('on', e.target.checked); save();
  });
  g.addEventListener('click', function (e) {
    var b = e.target.closest('[data-look]'); if (!b) return; var it = item(b.closest('.sct-t').dataset.id); if (!it) return;
    dlg.querySelector('img').src = it.thumb; var big = new Image(); big.onload = function () { dlg.querySelector('img').src = big.src; }; big.src = it.image;
    dlg.querySelector('.sct-dm').innerHTML = '<h2>' + esc(it.label) + '</h2><p>' + esc(it.summary) + '</p><dl>' + (it.meta || []).map(function (m) { return '<dt>' + esc(m.label) + '</dt><dd>' + esc(m.value) + '</dd>'; }).join('') + '</dl><p><a href="' + esc(it.id) + '" target="_blank" rel="noopener">The museum’s own record ↗</a> · ' + (it.open ? 'Open access (CC0)' : 'Not open: it stays where it is') + '</p>';
    dlg.showModal();
  });
  root.querySelector('[data-sct-x]').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  root.querySelector('[data-sct-all]').addEventListener('click', function () { g.querySelectorAll('[data-tick]').forEach(function (c) { if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } }); });
  root.querySelector('[data-sct-none]').addEventListener('click', function () { picked = {}; g.querySelectorAll('[data-tick]').forEach(function (c) { c.checked = false; c.closest('.sct-t').classList.remove('on'); }); save(); });
  root.querySelector('[data-sct-go]').addEventListener('click', function () {
    var list = Object.keys(picked).map(function (k) { return picked[k]; }); if (!list.length) return;
    var by = {}; list.forEach(function (it) { (by[it.src] = by[it.src] || []).push(it); });
    var b = this; b.disabled = true; b.textContent = 'Sending…';
    var srcs = Object.keys(by), done = [], i = 0;
    (function next() {
      if (i >= srcs.length) { picked = {}; save(); b.textContent = 'Bring them in'; location.href = done.length === 1 ? done[0] : '/studio/feeds?ok=' + encodeURIComponent(done.length + ' runs started from the scout.'); return; }
      var s = srcs[i++];
      fetch('/studio/scout/bring', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/x-watermark-scout+json' }, body: JSON.stringify({ src: s, q: f.q.value, maker: root.querySelector('[data-sct-maker]').value, show: root.querySelector('[data-sct-show]').checked, items: by[s] }) })
        .then(function (r) { return r.json(); }).then(function (r) { if (r.error) { alert(r.error); b.disabled = false; b.textContent = 'Bring them in'; return; } done.push(r.href); next(); });
    })();
  });
  save(); look(1);
})();
