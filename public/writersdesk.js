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
  // ---- Write, the app (26 Oct, after Obsidian): reading view, the switcher, the palette, search, the graph, the daily note, outline and tags ----
  var readv = $('[data-wsd-readv]'), outline = $('[data-wsd-outline]'), tagsEl = $('[data-wsd-tags]'), sheet = $('[data-wsd-sheet]'), sq = $('[data-wsd-sq]'), sl = $('[data-wsd-sl]'), sk = $('[data-wsd-sk]'), graphv = $('[data-wsd-graphv]');
  var reading = false;
  function inline(t) {
    t = esc(t);
    t = t.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, function (_, a, b) { return '<a href="#" class="wsd-rl" data-link="' + a.trim() + '">' + (b || a).trim() + '</a>'; });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/(^|\s)#([\p{L}\p{N}_-]{2,40})/gu, '$1<span class="wsd-tag">#$2</span>');
    return t;
  }
  function render(md) {
    var lines = String(md || '').split('\n'), out = [], list = null, quote = [], para = [];
    var flushP = function () { if (para.length) { out.push('<p>' + inline(para.join('\n')).replace(/\n/g, '<br>') + '</p>'); para = []; } };
    var flushL = function () { if (list) { out.push('<' + list.t + '>' + list.items.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</' + list.t + '>'); list = null; } };
    var flushQ = function () { if (quote.length) { out.push('<blockquote>' + inline(quote.join('\n')).replace(/\n/g, '<br>') + '</blockquote>'); quote = []; } };
    lines.forEach(function (ln) {
      var h = /^(#{1,4})\s+(.*)$/.exec(ln), ul = /^\s*[-*]\s+(.*)$/.exec(ln), ol = /^\s*\d+[.)]\s+(.*)$/.exec(ln), q = /^>\s?(.*)$/.exec(ln);
      if (h) { flushP(); flushL(); flushQ(); out.push('<h' + (h[1].length + 1) + '>' + inline(h[2]) + '</h' + (h[1].length + 1) + '>'); return; }
      if (/^\s*(\*\s*\*\s*\*|---|___)\s*$/.test(ln)) { flushP(); flushL(); flushQ(); out.push('<hr>'); return; }
      if (ul || ol) { flushP(); flushQ(); var t = ul ? 'ul' : 'ol'; if (!list || list.t !== t) { flushL(); list = { t: t, items: [] }; } list.items.push((ul || ol)[1]); return; }
      if (q) { flushP(); flushL(); quote.push(q[1]); return; }
      if (!ln.trim()) { flushP(); flushL(); flushQ(); return; }
      flushL(); flushQ(); para.push(ln);
    });
    flushP(); flushL(); flushQ(); return out.join('\n');
  }
  function openByTitle(t) { var p = pages.filter(function (x) { return x.kind !== 'folder' && x.title.toLowerCase() === String(t).toLowerCase(); })[0]; if (p) open(p.id); else if (confirm('No page “' + t + '” yet. Make it?')) api('POST', '/pages', { kind: 'text', parent: cur && cur.parent_id || '', title: t }).then(function (a) { if (a.ok) { pages = a.pages; renderTree(); open(a.id); } }); }
  function paintRead() { if (!readv) return; readv.innerHTML = '<h1 class="wsd-rt">' + esc(ptitle.value) + '</h1>' + render(body.value); }
  function setReading(on) {
    reading = on; var b = $('[data-wsd-read]'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) { flush(); paintRead(); readv.hidden = false; body.hidden = true; ptitle.hidden = true; root.classList.add('wsd-reading'); } else { readv.hidden = true; body.hidden = false; ptitle.hidden = false; root.classList.remove('wsd-reading'); body.focus(); }
  }
  if (readv) readv.addEventListener('click', function (e) { var a = e.target.closest('[data-link]'); if (a) { e.preventDefault(); openByTitle(a.getAttribute('data-link')); } });
  var rb = $('[data-wsd-read]'); if (rb) rb.addEventListener('click', function () { setReading(!reading); });
  // Outline and tags, from the page as it is.
  function paintMeta() {
    if (outline) { var hs = (body.value.match(/^#{1,4}\s+.+$/gm) || []).slice(0, 60); outline.innerHTML = hs.length ? hs.map(function (h) { var m = /^(#+)\s+(.*)$/.exec(h); return '<li class="wsd-o' + m[1].length + '"><a href="#" data-head="' + esc(m[2]) + '">' + esc(m[2]) + '</a></li>'; }).join('') : '<li class="wsd-none">No heads yet: a line that begins with # is one.</li>'; }
    if (tagsEl) { var tg = {}; (body.value.match(/(^|\s)#([\p{L}\p{N}_-]{2,40})/gu) || []).forEach(function (x) { tg[x.trim().slice(1).toLowerCase()] = 1; }); var ks = Object.keys(tg); tagsEl.innerHTML = ks.length ? ks.map(function (k) { return '<a href="#" class="wsd-tag" data-tagq="#' + esc(k) + '">#' + esc(k) + '</a>'; }).join(' ') : '<span class="wsd-none">#a-word in the text is a tag.</span>'; }
  }
  if (outline) outline.addEventListener('click', function (e) { var a = e.target.closest('[data-head]'); if (!a) return; e.preventDefault(); var t = a.getAttribute('data-head'); var i = body.value.indexOf(t); if (i >= 0) { body.focus(); body.setSelectionRange(i, i); var lines = body.value.slice(0, i).split('\n').length; body.scrollTop = Math.max(0, (lines - 3) * 28); } });
  if (tagsEl) tagsEl.addEventListener('click', function (e) { var a = e.target.closest('[data-tagq]'); if (!a) return; e.preventDefault(); openSheet('search', a.getAttribute('data-tagq')); });
  var metaT; body.addEventListener('input', function () { clearTimeout(metaT); metaT = setTimeout(paintMeta, 400); });
  var _open = open; open = function (id) { _open(id); if (reading) setTimeout(function () { setReading(true); }, 300); setTimeout(paintMeta, 350); };
  // One sheet, three uses: open a page (⌘O), an act by name (⌘P), search every page (⌘F).
  var mode = 'open', sel = 0, rows = [];
  var ACTS = [
    ['New page', function () { $('[data-wsd-add="text"]').click(); }], ['New folder', function () { $('[data-wsd-add="folder"]').click(); }], ['New note', function () { $('[data-wsd-add="note"]').click(); }],
    ['Today’s page (the Journal)', daily], ['Reading view (⌘E)', function () { setReading(!reading); }], ['Search every page (⌘F)', function () { openSheet('search'); }],
    ['The graph (⌘G)', showGraph], ['Focus (⌘⇧F)', function () { root.classList.toggle('wsd-focus'); }], ['Take a snapshot (⌘⇧S)', function () { $('[data-wsd-snap]').click(); }],
    ['Print the manuscript', function () { $('[data-wsd-print]').click(); }], ['Export as Markdown', function () { location.href = base + '/export.zip'; }], ['Compile and shelve', function () { $('[data-wsd-compile]').click(); }],
    ['Back to the desks', function () { location.href = '/account/desk'; }]
  ];
  function openSheet(m, q) { mode = m; sel = 0; sheet.hidden = false; sq.value = q || ''; sq.placeholder = m === 'open' ? 'A page, by a few letters' : m === 'acts' ? 'An act, by name' : 'A word, in every page'; sk.textContent = m === 'open' ? '↑↓ choose · Enter opens · a new title makes a page · Esc' : m === 'acts' ? '↑↓ choose · Enter does it · Esc' : '↑↓ choose · Enter opens the page · Esc'; sq.focus(); sq.select(); fill(); }
  function closeSheet() { sheet.hidden = true; if (!reading) body.focus(); }
  var fillT = null;
  function fill() {
    var q = sq.value.trim(), ql = q.toLowerCase();
    if (mode === 'open') { rows = pages.filter(function (p) { return p.kind !== 'folder' && (!ql || fuzzy(p.title.toLowerCase(), ql)); }).slice(0, 30).map(function (p) { return { t: p.title, s: (p.words || 0) + ' words', go: function () { open(p.id); } }; }); if (q && !rows.some(function (r) { return r.t.toLowerCase() === ql; })) rows.push({ t: 'Make “' + q + '”', s: 'a new page', go: function () { openByTitle(q); } }); paint(); return; }
    if (mode === 'acts') { rows = ACTS.filter(function (a) { return !ql || fuzzy(a[0].toLowerCase(), ql); }).map(function (a) { return { t: a[0], s: '', go: a[1] }; }); paint(); return; }
    clearTimeout(fillT); if (!q) { rows = []; paint(); return; }
    fillT = setTimeout(function () { api('GET', '/search?q=' + encodeURIComponent(q)).then(function (a) { rows = (a.hits || []).map(function (h) { return { t: h.title + (h.n > 1 ? ' · ' + h.n : ''), s: h.snippet || (h.inTitle ? 'in the title' : ''), go: function () { open(h.id); setTimeout(function () { var i = body.value.toLowerCase().indexOf(ql); if (i >= 0) { body.focus(); body.setSelectionRange(i, i + q.length); } }, 400); } }; }); paint(); }); }, 180);
  }
  function fuzzy(h, n) { var i = 0; for (var k = 0; k < h.length && i < n.length; k++) if (h[k] === n[i]) i++; return i === n.length; }
  function paint() { sl.innerHTML = rows.length ? rows.map(function (r, i) { return '<li' + (i === sel ? ' class="is-sel"' : '') + ' data-i="' + i + '"><b>' + esc(r.t) + '</b>' + (r.s ? '<i>' + esc(r.s) + '</i>' : '') + '</li>'; }).join('') : '<li class="wsd-none">' + (mode === 'search' && sq.value ? 'Nothing by that word.' : mode === 'search' ? 'Type a word.' : 'Nothing.') + '</li>'; }
  sq.addEventListener('input', function () { sel = 0; fill(); });
  sq.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); paint(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); } else if (e.key === 'Enter') { e.preventDefault(); var r = rows[sel]; if (r) { closeSheet(); r.go(); } } else if (e.key === 'Escape') { e.preventDefault(); closeSheet(); } });
  sl.addEventListener('click', function (e) { var li = e.target.closest('[data-i]'); if (!li) return; var r = rows[+li.getAttribute('data-i')]; if (r) { closeSheet(); r.go(); } });
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  var ob = $('[data-wsd-open]'); if (ob) ob.addEventListener('click', function () { openSheet('open'); });
  var sb = $('[data-wsd-search]'); if (sb) sb.addEventListener('click', function () { openSheet('search'); });
  var pb = $('[data-wsd-palette]'); if (pb) pb.addEventListener('click', function () { openSheet('acts'); });
  // Today's page.
  function daily() { flush(); api('POST', '/daily', {}).then(function (a) { if (a.ok) { pages = a.pages; renderTree(); open(a.id); } }); }
  var db_ = $('[data-wsd-daily]'); if (db_) db_.addEventListener('click', daily);
  // The graph: a small force layout on a canvas; drag the points; tap one to open it.
  var G = null;
  function showGraph() {
    flush(); graphv.hidden = false; root.classList.add('wsd-graphon');
    api('GET', '/graph').then(function (a) {
      var cv = $('[data-wsd-gc]'), ctx = cv.getContext('2d'), W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
      var nodes = (a.nodes || []).map(function (n, i) { var ang = i / Math.max(1, a.nodes.length) * Math.PI * 2; return Object.assign({ x: W / 2 + Math.cos(ang) * Math.min(W, H) * 0.33, y: H / 2 + Math.sin(ang) * Math.min(W, H) * 0.33, vx: 0, vy: 0 }, n); });
      var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
      var edges = (a.edges || []).map(function (e) { return [byId[e[0]], byId[e[1]]]; }).filter(function (e) { return e[0] && e[1]; });
      nodes.forEach(function (n) { if (n.parent && byId[n.parent]) edges.push([byId[n.parent], n, true]); });
      var nl = edges.filter(function (e) { return !e[2]; }).length; $('[data-wsd-gn]').textContent = nodes.length + ' page' + (nodes.length === 1 ? '' : 's') + ' · ' + nl + ' link' + (nl === 1 ? '' : 's');
      var drag = null, hot = null, t = 0; G = { on: true };
      function step() {
        if (!G || !G.on) return; t++;
        if (t < 400) {
          for (var i = 0; i < nodes.length; i++) for (var j = i + 1; j < nodes.length; j++) { var A = nodes[i], B = nodes[j], dx = B.x - A.x, dy = B.y - A.y, d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2), f = 1800 / d2; var fx = dx / d * f, fy = dy / d * f; A.vx -= fx; A.vy -= fy; B.vx += fx; B.vy += fy; }
          edges.forEach(function (e) { var A = e[0], B = e[1], dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01, want = e[2] ? 70 : 110, f = (d - want) * 0.02; A.vx += dx / d * f; A.vy += dy / d * f; B.vx -= dx / d * f; B.vy -= dy / d * f; });
          nodes.forEach(function (n) { if (n === drag) return; n.vx += (W / 2 - n.x) * 0.002; n.vy += (H / 2 - n.y) * 0.002; n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy; n.x = Math.max(16, Math.min(W - 16, n.x)); n.y = Math.max(16, Math.min(H - 16, n.y)); });
        }
        ctx.clearRect(0, 0, W, H);
        edges.forEach(function (e) { ctx.strokeStyle = e[2] ? 'rgba(239,232,219,.10)' : 'rgba(217,188,124,.45)'; ctx.lineWidth = e[2] ? 1 : 1.2; ctx.beginPath(); ctx.moveTo(e[0].x, e[0].y); ctx.lineTo(e[1].x, e[1].y); ctx.stroke(); });
        nodes.forEach(function (n) { var r = n.kind === 'folder' ? 7 : 4 + Math.min(8, Math.sqrt((n.words || 0) / 60)); ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fillStyle = n === hot ? '#d9bc7c' : n.kind === 'folder' ? '#8f8a81' : cur && cur.id === n.id ? '#efe9dd' : '#b9b09f'; ctx.fill(); if (n === hot || nodes.length < 40 || n.kind === 'folder') { ctx.fillStyle = n === hot ? '#f2efe9' : 'rgba(239,232,219,.7)'; ctx.font = (n === hot ? '600 ' : '400 ') + '11px Inter, system-ui, sans-serif'; ctx.fillText(n.title.slice(0, 40), n.x + r + 5, n.y + 4); } });
        requestAnimationFrame(step);
      }
      step();
      function at(e) { var r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0] : e).clientX - r.left, y = (e.touches ? e.touches[0] : e).clientY - r.top; var best = null, bd = 18; nodes.forEach(function (n) { var d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } }); return { n: best, x: x, y: y }; }
      var moved = false;
      cv.onpointerdown = function (e) { var h = at(e); drag = h.n; moved = false; if (drag) cv.setPointerCapture(e.pointerId); };
      cv.onpointermove = function (e) { var h = at(e); hot = h.n; if (drag) { drag.x = h.x; drag.y = h.y; moved = true; t = Math.min(t, 300); } cv.style.cursor = h.n ? 'pointer' : 'default'; };
      cv.onpointerup = function (e) { if (drag && !moved && drag.kind !== 'folder') { var id = drag.id; hideGraph(); open(id); } drag = null; };
    });
  }
  function hideGraph() { graphv.hidden = true; root.classList.remove('wsd-graphon'); if (G) G.on = false; G = null; }
  var gb = $('[data-wsd-graph]'); if (gb) gb.addEventListener('click', showGraph); var gx = $('[data-wsd-gx]'); if (gx) gx.addEventListener('click', hideGraph);
  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey; var k = e.key.toLowerCase();
    if (e.key === 'Escape') { if (!sheet.hidden) { closeSheet(); return; } if (!graphv.hidden) { hideGraph(); return; } if (reading) { setReading(false); return; } }
    if (!mod) return;
    if (k === 'o') { e.preventDefault(); openSheet('open'); } else if (k === 'p') { e.preventDefault(); openSheet('acts'); } else if (k === 'f' && !e.shiftKey) { e.preventDefault(); openSheet('search'); } else if (k === 'e') { e.preventDefault(); setReading(!reading); } else if (k === 'g') { e.preventDefault(); if (graphv.hidden) showGraph(); else hideGraph(); } else if (k === 'd') { e.preventDefault(); daily(); }
  }, true);
  // Begin at the first page.
  renderTree(); var first = pages.filter(function (p) { return p.kind !== 'folder'; })[0]; if (first) open(first.id);
})();
