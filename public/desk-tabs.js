// The catalogue card: a long record folded into tabs. Every top-level h2 in the record becomes a tab; what
// follows it, up to the next, is its panel. Without this script the page reads top to bottom, as before.
(function () {
  var root = document.querySelector('[data-desk-tabs]'); if (!root) return;
  var kids = Array.prototype.slice.call(root.children);
  var tabs = [], cur = null;
  kids.forEach(function (el) {
    if (el.tagName === 'H2') { cur = { title: el.textContent.trim(), id: 't-' + el.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), nodes: [el] }; tabs.push(cur); }
    else if (cur) cur.nodes.push(el);
  });
  if (tabs.length < 2) return;
  var nav = document.createElement('nav'); nav.className = 'wk-tabs'; nav.setAttribute('aria-label', 'The record');
  tabs.forEach(function (t) {
    var panel = document.createElement('section'); panel.className = 'wk-panel'; panel.id = t.id;
    root.insertBefore(panel, t.nodes[0]);
    t.nodes.forEach(function (n) { panel.appendChild(n); });
    var a = document.createElement('a'); a.href = '#' + t.id; a.textContent = t.title; a.dataset.tab = t.id; nav.appendChild(a); t.panel = panel; t.link = a;
  });
  root.insertBefore(nav, tabs[0].panel);
  function show(id, push) {
    var found = false;
    tabs.forEach(function (t) { var on = t.id === id; t.panel.hidden = !on; t.link.toggleAttribute('aria-current', on); if (on) found = true; });
    if (!found) return show(tabs[0].id, push);
    if (push) try { history.replaceState(null, '', '#' + id); } catch (e) {}
  }
  nav.addEventListener('click', function (e) { var a = e.target.closest('a[data-tab]'); if (!a) return; e.preventDefault(); show(a.dataset.tab, true); window.scrollTo({ top: nav.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' }); });
  // A notice (?ok=) about terms or the master belongs with its tab; a hash picks a tab; else the first.
  var want = (location.hash || '').slice(1);
  var ok = document.querySelector('.ok, .err'); if (!want && ok) { var p = ok.closest('.wk-panel'); if (p) want = p.id; }
  show(want || tabs[0].id, false);
  window.addEventListener('hashchange', function () { show((location.hash || '').slice(1), false); });
})();
