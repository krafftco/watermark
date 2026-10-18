/* Find, everywhere (Will, 18 Oct: straight to the picture). One overlay: the header's Find, the stroll's Find, the
   / key or ⌘K open it; as you type the works appear with their pictures; ↑↓ move, Enter opens the first (or the
   chosen) at once; a word with no work strolls through everything that matches. Before typing: where you stood
   lately, yours, the ways in. In the stroll (mode 'stroll') a work opens inside the stroll, so the flow holds. */
(function () {
  var ov = null, inp = null, list = null, foot = null, mode = 'page', t = null, sel = -1, rows = [], lastQ = null, IC = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var PHONE = matchMedia('(max-width:760px) and (pointer:coarse)').matches;
  function hrefOf(r) { return (mode === 'stroll' || PHONE) && r.stroll ? r.stroll : r.href; }
  function build() {
    if (ov) return;
    ov = document.createElement('div'); ov.className = 'fd'; ov.hidden = true; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Find');
    ov.innerHTML = '<div class="fd-card"><form class="fd-f" action="/find" method="get"><span class="fd-ic">' + (IC.find || '') + '</span><input type="search" name="q" placeholder="A title, a place, a maker, a year, a word" aria-label="Find" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><button type="button" class="fd-x" aria-label="Close">' + (IC.close || '×') + '</button></form><div class="fd-list" role="listbox"></div><p class="fd-foot"></p></div>';
    document.body.appendChild(ov);
    inp = ov.querySelector('input'); list = ov.querySelector('.fd-list'); foot = ov.querySelector('.fd-foot');
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.fd-x').addEventListener('click', close);
    ov.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); go(); });
    inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { load(inp.value.trim()); }, 110); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); } else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    list.addEventListener('click', function (e) { var a = e.target.closest('a'); if (!a) return; try { sessionStorage.setItem('wm_find_q', inp.value); } catch (x) {} });
  }
  function move(d) { var as = list.querySelectorAll('a'); if (!as.length) return; sel = (sel + d + as.length) % as.length; [].forEach.call(as, function (a, i) { a.classList.toggle('on', i === sel); }); as[sel].scrollIntoView({ block: 'nearest' }); }
  function go() {
    var as = list.querySelectorAll('a'); var q = inp.value.trim();
    if (sel >= 0 && as[sel]) { location.href = as[sel].href; return; }
    if (rows.length && rows[0].kind === 'work' && as[0]) { location.href = as[0].href; return; }
    if (q) location.href = '/stroll?q=' + encodeURIComponent(q);
  }
  function workRow(w) { return '<a class="fd-w" href="' + esc(hrefOf(w)) + '" role="option"><img src="' + esc(w.img) + '" alt="" loading="lazy"><span><b>' + esc(w.title) + '</b><small>' + esc(w.maker) + (w.place ? ' · ' + esc(w.place) : '') + (w.year ? ' · ' + esc(w.year) : '') + '</small></span><i>' + (IC.next || '') + '</i></a>'; }
  function wayRow(x, k) { return '<a class="fd-w fd-way" href="' + esc(hrefOf(x)) + '" role="option">' + (x.img ? '<img src="' + esc(x.img) + '" alt="" loading="lazy">' : '<span class="fd-blank"></span>') + '<span><b>' + esc(x.name) + '</b><small>' + k + (x.by ? ' · ' + esc(x.by) : '') + (x.n ? ' · ' + x.n + ' work' + (x.n === 1 ? '' : 's') : '') + '</small></span><i>' + (IC.next || '') + '</i></a>'; }
  function chips(k, items) { if (!items || !items.length) return ''; return '<p class="fd-k">' + k + '</p><div class="fd-chips">' + items.map(function (x) { return '<a href="' + esc(x.href) + '">' + esc(x.name) + '<i>' + x.n + '</i></a>'; }).join('') + '</div>'; }
  function render(d) {
    sel = -1; rows = [];
    if (!d.q) {
      var b = d.before || {}; var h = '';
      if (b.lately && b.lately.length) { h += '<p class="fd-k">Where you stood lately</p>' + b.lately.map(workRow).join(''); rows = rows.concat(b.lately); }
      if (b.yours && b.yours.length) { h += '<p class="fd-k">Yours</p>' + b.yours.map(workRow).join(''); rows = rows.concat(b.yours); }
      h += chips('Places', b.places) + chips('Makers', b.makers) + chips('Rooms', b.rooms);
      list.innerHTML = h; foot.textContent = PHONE ? 'Type, or tap a way in.' : 'Type, then Enter opens the first. ↑ ↓ choose. Esc closes.'; return;
    }
    var out = '';
    if (d.works && d.works.length) { out += d.works.map(workRow).join(''); rows = rows.concat(d.works); }
    (d.makers || []).forEach(function (m) { out += wayRow(m, 'Maker'); rows.push(m); });
    (d.places || []).forEach(function (p) { out += wayRow(p, 'Place'); rows.push(p); });
    (d.rooms || []).forEach(function (r) { out += wayRow(r, 'Room'); rows.push(r); });
    (d.hangs || []).forEach(function (w) { out += wayRow(w, 'A wall'); rows.push(w); });
    if (!out) out = '<p class="fd-none">Nothing by that word yet. Try a place, a maker, or a year.</p>';
    else if (d.works && d.works.length) out += '<a class="fd-all" href="/stroll?q=' + encodeURIComponent(d.q) + '">' + (IC.wave || '') + '<span>Wander through “' + esc(d.q) + '”' + (d.more ? ' · ' + (d.works.length + d.more) + ' works' : '') + '</span></a>';
    list.innerHTML = out; foot.textContent = d.works && d.works.length ? (PHONE ? 'Tap a work to go straight to it.' : 'Enter opens the first. ↑ ↓ choose.') : '';
  }
  var ctl = null;
  function load(q) {
    if (q === lastQ) return; lastQ = q;
    if (ctl) ctl.abort(); ctl = new AbortController();
    fetch('/api/find?q=' + encodeURIComponent(q), { credentials: 'same-origin', signal: ctl.signal }).then(function (r) { return r.json(); }).then(function (d) { if ((d.q || '') === (inp.value.trim())) render(d); }).catch(function () {});
  }
  function open(opts) {
    opts = opts || {}; mode = opts.mode || 'page'; build();
    ov.hidden = false; document.documentElement.classList.add('fd-on');
    var q = opts.q != null ? opts.q : ''; try { if (!q) q = sessionStorage.getItem('wm_find_q') || ''; } catch (e) {}
    inp.value = q; lastQ = null; load(q.trim());
    setTimeout(function () { inp.focus(); if (q) inp.select(); }, 30);
  }
  function close() { if (!ov) return; ov.hidden = true; document.documentElement.classList.remove('fd-on'); }
  // Glyphs come from the page's templates where it carries them; else plain.
  [].forEach.call(document.querySelectorAll('template[data-ic]'), function (tp) { IC[tp.getAttribute('data-ic')] = tp.innerHTML; });
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-find-open]'); if (!b) return; e.preventDefault(); open({ mode: b.getAttribute('data-find-open') || 'page' }); });
  document.addEventListener('keydown', function (e) {
    var tg = e.target; var typing = tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable);
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (ov && !ov.hidden) close(); else open({ mode: document.querySelector('main.st') ? 'stroll' : 'page' }); }
    else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); open({ mode: document.querySelector('main.st') ? 'stroll' : 'page' }); }
  });
  window.WMFind = { open: open, close: close };
})();
