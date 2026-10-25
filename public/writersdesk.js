// The Writer's Desk (25 Oct): the binder, the page, the inspector. Plain text, autosaved; [[links]] with a small
// prompt; snapshots; the corkboard for a folder; focus mode; drag to reorder. Nothing leaves the house.
(function () {
  var root = document.querySelector('[data-wsd]'); if (!root) return;
  var D = window.__WSD; var ID = root.getAttribute('data-id'); var base = '/account/desk/' + ID;
  var pages = D.pages || []; var cur = null; var dirty = false; var saveT = null; var lastBody = '';
  var $ = function (s) { return root.querySelector(s); };
  var tree = $('[data-wsd-tree]'), ed = $('[data-wsd-ed]'), cork = $('[data-wsd-cork]'), none = $('[data-wsd-none]'), body = $('[data-wsd-body]'), ptitle = $('[data-wsd-ptitle]'), pwords = $('[data-wsd-pwords]');
  var syn = $('[data-wsd-syn]'), status = $('[data-wsd-status]'), back = $('[data-wsd-back]'), drafts = $('[data-wsd-drafts]'), saved = $('[data-wsd-saved]');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function api(method, path, data) { var o = { method: method, credentials: 'same-origin', headers: { 'Accept': 'application/json' } }; if (data) { o.headers['Content-Type'] = 'application/x-www-form-urlencoded'; var fd = new URLSearchParams(); Object.keys(data).forEach(function (k) { if (data[k] != null) fd.append(k, data[k]); }); o.body = fd; } return fetch(base + path, o).then(function (r) { return r.json(); }); }
  function wc(s) { return String(s || '').split(/\s+/).filter(Boolean).length; }
  function byId(id) { for (var i = 0; i < pages.length; i++) if (pages[i].id === id) return pages[i]; return null; }
  function kids(pid) { return pages.filter(function (p) { return (p.parent_id || null) === (pid || null); }).sort(function (a, b) { return a.pos - b.pos || a.id - b.id; }); }
  // The binder.
  function node(p) {
    var ch = p.kind === 'folder' ? kids(p.id) : [];
    return '<li class="wsd-n wsd-' + p.kind + (cur && cur.id === p.id ? ' is-cur' : '') + '" data-id="' + p.id + '" draggable="true"><a href="#" class="wsd-nl" data-open="' + p.id + '"><span class="wsd-ni"></span><b>' + esc(p.title) + '</b>' + (p.kind === 'text' ? '<small>' + (p.words || 0) + '</small>' : '') + (p.status === 'final' ? '<i class="wsd-fin" title="Final">●</i>' : p.status === 'revised' ? '<i class="wsd-rev" title="Revised">◐</i>' : '') + '</a>' + (p.kind === 'folder' ? '<ol class="wsd-sub" data-folder="' + p.id + '">' + ch.map(node).join('') + '</ol>' : '') + '</li>';
  }
  function renderTree() { tree.innerHTML = kids(null).map(node).join(''); }
  tree.addEventListener('click', function (e) { var a = e.target.closest('[data-open]'); if (!a) return; e.preventDefault(); open(+a.getAttribute('data-open')); });
  // Drag to reorder (a page onto a folder moves it in; between pages sets the order).
  var drag = null;
  tree.addEventListener('dragstart', function (e) { var li = e.target.closest('.wsd-n'); if (!li) return; drag = +li.getAttribute('data-id'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(drag)); } catch (x) {} li.classList.add('is-drag'); });
  tree.addEventListener('dragend', function () { tree.querySelectorAll('.is-drag, .is-over, .is-into').forEach(function (x) { x.classList.remove('is-drag', 'is-over', 'is-into'); }); drag = null; });
  tree.addEventListener('dragover', function (e) { var li = e.target.closest('.wsd-n'); if (!li || !drag) return; e.preventDefault(); tree.querySelectorAll('.is-over, .is-into').forEach(function (x) { x.classList.remove('is-over', 'is-into'); }); var r = li.getBoundingClientRect(); var into = li.classList.contains('wsd-folder') && e.clientY > r.top + r.height * 0.3 && e.clientY < r.bottom - r.height * 0.3 && +li.getAttribute('data-id') !== drag; li.classList.add(into ? 'is-into' : 'is-over'); });
  tree.addEventListener('drop', function (e) {
    var li = e.target.closest('.wsd-n'); if (!li || !drag) return; e.preventDefault(); var to = +li.getAttribute('data-id'); if (to === drag) return;
    var p = byId(drag), t = byId(to); if (!p || !t) return;
    var into = li.classList.contains('is-into'); var parent = into ? t.id : (t.parent_id || null);
    var sib = kids(parent).map(function (x) { return x.id; }).filter(function (x) { return x !== drag; });
    if (into) sib.push(drag); else { var i = sib.indexOf(to); var r = li.getBoundingClientRect(); sib.splice(e.clientY > r.top + r.height / 2 ? i + 1 : i, 0, drag); }
    p.parent_id = parent; sib.forEach(function (id, k) { var x = byId(id); if (x) x.pos = k; }); renderTree();
    api('POST', '/pages/' + drag + '/move', { parent: parent || '', order: sib.join(',') }).then(function (a) { if (a.pages) { pages = a.pages; renderTree(); } });
  });
  root.querySelectorAll('[data-wsd-add]').forEach(function (b) { b.addEventListener('click', function () {
    var kind = b.getAttribute('data-wsd-add'); var parent = cur && cur.kind === 'folder' ? cur.id : (cur ? (cur.parent_id || '') : '');
    var title = kind === 'folder' ? prompt('The folder (a part, an act):', 'Part Two') : kind === 'note' ? 'A note' : prompt('The page (a chapter, a scene):', 'Chapter ' + (pages.filter(function (p) { return p.kind === 'text'; }).length + 1)); if (title == null) return;
    api('POST', '/pages', { kind: kind, parent: parent, title: title }).then(function (a) { if (!a.ok) return; pages = a.pages; renderTree(); open(a.id); });
  }); });
  // The page.
  function open(id) {
    flush(); var p = byId(id); if (!p) return; cur = p; renderTree(); none.hidden = true;
    if (p.kind === 'folder') { ed.hidden = true; cork.hidden = false; renderCork(p); return; }
    cork.hidden = true; ed.hidden = false;
    api('GET', '/pages/' + id).then(function (a) {
      if (!a.page) return; cur = Object.assign(p, a.page); ptitle.value = cur.title; body.value = cur.body || ''; lastBody = body.value; syn.value = cur.synopsis || ''; status.value = cur.status || 'draft';
      pwords.textContent = wc(body.value) + ' words'; paintBack(a.backlinks); paintDrafts(a.drafts); body.classList.toggle('wsd-monoish', p.kind === 'note'); body.focus();
    });
  }
  function renderCork(f) {
    var ch = kids(f.id); cork.innerHTML = '<h2 class="wsd-ch">' + esc(f.title) + ' <small>' + ch.length + ' card' + (ch.length === 1 ? '' : 's') + ' · ' + ch.reduce(function (n, p) { return n + (p.words || 0); }, 0).toLocaleString('en-US') + ' words</small></h2><div class="wsd-cards">' + ch.map(function (p) { return '<a href="#" class="wsd-card wsd-card-' + p.kind + '" data-open="' + p.id + '"><b>' + esc(p.title) + '</b><p>' + esc(p.synopsis || '') + '</p><small>' + (p.kind === 'text' ? (p.words || 0) + ' words · ' : '') + esc(p.status) + '</small></a>'; }).join('') + '</div>' + (ch.length ? '' : '<p class="note">An empty folder. Add a page while it is chosen and it goes in here.</p>');
    cork.querySelectorAll('[data-open]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); open(+a.getAttribute('data-open')); }); });
  }
  function paintBack(list) { back.innerHTML = (list || []).length ? list.map(function (b) { return '<li><a href="#" data-open="' + b.id + '">' + esc(b.title) + '</a></li>'; }).join('') : '<li class="wsd-dim">No page names this one yet.</li>'; back.querySelectorAll('[data-open]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); open(+a.getAttribute('data-open')); }); }); }
  function when(s) { try { var d = new Date(String(s).replace(' ', 'T') + 'Z'); return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return s; } }
  function paintDrafts(list) {
    drafts.innerHTML = (list || []).length ? list.map(function (d) { return '<li><span>' + when(d.at) + ' · ' + d.words + ' words' + (d.by === 'house' ? ' · the house' : '') + (d.note ? ' · ' + esc(d.note) : '') + '</span> <a href="#" data-see="' + d.id + '">See</a> <a href="#" data-restore="' + d.id + '">Restore</a></li>'; }).join('') : '<li class="wsd-dim">No drafts kept yet. The first comes with the first rewrite.</li>';
    drafts.querySelectorAll('[data-see]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); api('GET', '/pages/' + cur.id + '/drafts/' + a.getAttribute('data-see')).then(function (x) { if (!x.draft) return; var w = window.open('', '_blank'); if (!w) return; w.document.write('<title>A draft · ' + esc(cur.title) + '</title><pre style="white-space:pre-wrap;font:16px/1.6 Georgia,serif;max-width:40em;margin:40px auto;padding:0 20px">' + esc(x.draft.body) + '</pre>'); w.document.close(); }); }); });
    drafts.querySelectorAll('[data-restore]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); if (!confirm('Restore this draft? The page as it is now is kept as a draft too.')) return; api('POST', '/pages/' + cur.id + '/restore/' + a.getAttribute('data-restore')).then(function (x) { if (!x.ok) return; cur.body = x.page.body; cur.words = x.page.words; body.value = cur.body; lastBody = body.value; pwords.textContent = wc(body.value) + ' words'; paintDrafts(x.drafts); refreshCounts(); say('Restored.'); }); }); });
  }
  function say(s) { saved.textContent = s; clearTimeout(say.t); say.t = setTimeout(function () { saved.textContent = ''; }, 2500); }
  function refreshCounts() { api('GET', '/pages').then(function (a) { if (a.pages) { pages = a.pages; renderTree(); } $('[data-wsd-total] b').textContent = (a.words || 0).toLocaleString('en-US'); }); }
  function save() {
    if (!cur || cur.kind === 'folder') return Promise.resolve(); clearTimeout(saveT); saveT = null; var p = cur;
    var data = { body: body.value, title: ptitle.value, synopsis: syn.value, status: status.value }; dirty = false;
    return api('PUT', '/pages/' + p.id, data).then(function (a) { if (!a.ok) { say('Not saved.'); dirty = true; return; } p.title = data.title; p.synopsis = data.synopsis; p.status = data.status; p.words = a.words; p.body = data.body; lastBody = data.body; $('[data-wsd-today] b').textContent = (a.today || 0).toLocaleString('en-US'); $('[data-wsd-total] b').textContent = (a.total || 0).toLocaleString('en-US'); paintBack(a.backlinks); renderTree(); say(a.snapped ? 'Saved · a draft kept' : 'Saved'); if (a.snapped) api('GET', '/pages/' + p.id).then(function (x) { if (x.drafts) paintDrafts(x.drafts); }); });
  }
  function flush() { if (dirty) save(); }
  function touched() { dirty = true; clearTimeout(saveT); saveT = setTimeout(save, 1500); pwords.textContent = wc(body.value) + ' words'; }
  body.addEventListener('input', function () { touched(); linkPrompt(); }); ptitle.addEventListener('input', touched); syn.addEventListener('input', touched); status.addEventListener('change', touched);
  addEventListener('beforeunload', function (e) { if (dirty) { try { navigator.sendBeacon && navigator.sendBeacon(base + '/pages/' + cur.id + '/beacon', new URLSearchParams({ body: body.value, title: ptitle.value, synopsis: syn.value, status: status.value })); } catch (x) {} e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
  // [[ a link: type two brackets and the pages are offered; a title typed that is not a page can be made.
  var lp = null;
  function linkPrompt() {
    var v = body.value, at = body.selectionStart; var m = /\[\[([^\]\n]*)$/.exec(v.slice(0, at)); if (!m) { if (lp) { lp.remove(); lp = null; } return; }
    var q = m[1].toLowerCase(); var hits = pages.filter(function (p) { return p.kind !== 'folder' && p.title.toLowerCase().indexOf(q) >= 0 && p.id !== (cur && cur.id); }).slice(0, 8);
    if (!lp) { lp = document.createElement('div'); lp.className = 'wsd-lp'; ed.appendChild(lp); }
    lp.innerHTML = (hits.map(function (p) { return '<button type="button" data-t="' + esc(p.title) + '">' + esc(p.title) + '</button>'; }).join('') || '') + (m[1].trim() && !hits.some(function (p) { return p.title.toLowerCase() === q; }) ? '<button type="button" data-new="' + esc(m[1].trim()) + '">Make a page called “' + esc(m[1].trim()) + '”</button>' : '');
    if (!lp.innerHTML) { lp.remove(); lp = null; return; }
    lp.querySelectorAll('button').forEach(function (b) { b.addEventListener('mousedown', function (e) { e.preventDefault(); var t = b.getAttribute('data-t') || b.getAttribute('data-new'); var pre = v.slice(0, at).replace(/\[\[[^\]\n]*$/, '[[' + t + ']]'); body.value = pre + v.slice(at); body.selectionStart = body.selectionEnd = pre.length; lp.remove(); lp = null; touched(); if (b.hasAttribute('data-new')) api('POST', '/pages', { kind: 'text', parent: cur.parent_id || '', title: t }).then(function (a) { if (a.pages) { pages = a.pages; renderTree(); } }); }); });
  }
  // Snapshots, removal, focus, print, compile, the title.
  $('[data-wsd-snap]').addEventListener('click', function () { if (!cur || cur.kind === 'folder') return; var note = prompt('A word on this draft (optional):', ''); if (note === null) return; save().then(function () { api('POST', '/pages/' + cur.id + '/snapshot', { note: note }).then(function (a) { if (a.drafts) paintDrafts(a.drafts); say('A draft kept.'); }); }); });
  $('[data-wsd-del]').addEventListener('click', function () { if (!cur) return; if (!confirm('Remove “' + cur.title + '” and its drafts?')) return; api('DELETE', '/pages/' + cur.id).then(function (a) { if (!a.ok) { alert(a.msg || 'Not removed.'); return; } pages = a.pages; cur = null; renderTree(); ed.hidden = true; cork.hidden = true; none.hidden = false; $('[data-wsd-total] b').textContent = (a.total || 0).toLocaleString('en-US'); }); });
  $('[data-wsd-focus]').addEventListener('click', function () { root.classList.toggle('wsd-focus'); body.focus(); });
  $('[data-wsd-print]').addEventListener('click', function () { flush(); setTimeout(function () { window.open(base + '.pdf', '_blank'); }, 300); });
  $('[data-wsd-compile]').addEventListener('click', function () { flush(); $('[data-wsd-compilebox]').hidden = false; });
  $('[data-wsd-compileno]').addEventListener('click', function () { $('[data-wsd-compilebox]').hidden = true; });
  var tT; $('[data-wsd-title]').addEventListener('input', function () { clearTimeout(tT); tT = setTimeout(function () { api('POST', '/title', { title: $('[data-wsd-title]').value }); document.title = $('[data-wsd-title]').value + ' · The Writer’s Desk'; }, 800); });
  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey; if (!mod) { if (e.key === 'Escape' && root.classList.contains('wsd-focus')) root.classList.remove('wsd-focus'); return; }
    var k = e.key.toLowerCase();
    if (k === 's' && e.shiftKey) { e.preventDefault(); $('[data-wsd-snap]').click(); return; }
    if (k === 's') { e.preventDefault(); save(); return; }
    if (k === 'f' && e.shiftKey) { e.preventDefault(); root.classList.toggle('wsd-focus'); return; }
    if (k === 'b' && document.activeElement === body) { e.preventDefault(); wrap('**'); return; }
    if (k === 'i' && document.activeElement === body) { e.preventDefault(); wrap('*'); return; }
    if (k === 'k' && document.activeElement === body) { e.preventDefault(); wrap('[[', ']]'); linkPrompt(); return; }
  });
  function wrap(a, b) { b = b == null ? a : b; var s = body.selectionStart, en = body.selectionEnd, v = body.value; body.value = v.slice(0, s) + a + v.slice(s, en) + b + v.slice(en); body.selectionStart = s + a.length; body.selectionEnd = en + a.length; touched(); }
  // Begin at the first page.
  renderTree(); var first = pages.filter(function (p) { return p.kind !== 'folder'; })[0]; if (first) open(first.id);
})();
