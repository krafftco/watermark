/* The rights in the contract: choose what is in it; the price and the agreement follow. */
(function () {
  var D = window.__WM_RT, box = document.querySelector('[data-rt]'), btn = document.getElementById('buyBtn');
  if (!D || !box || !btn) return;
  var form = box.closest('form'), slug = (form.getAttribute('action') || '').split('/').pop();
  var money = function (c) { return '$' + Math.round(c / 100).toLocaleString('en-US'); };
  // (#183) Where, how many, for how long: the answers go with the form and into the agreement.
  var aw = box.querySelector('[data-aq-where]'), ao = box.querySelector('[data-aq-of]'), am = box.querySelector('[data-aq-many]'), at = box.querySelector('[data-aq-term]'), as = box.querySelector('[data-aq-say]');
  function asked() { var n = am && ao && ao.value ? String(am.value || '').replace(/[^0-9]/g, '') : ''; return { where: aw ? aw.value : '', of: n ? ao.value : '', many: n }; }
  function narrowed() { var a = asked(); return !!(a.where || a.many); }
  function qs() { var a = asked(); return (a.where ? '&where=' + encodeURIComponent(a.where) : '') + (a.many ? '&of=' + encodeURIComponent(a.of) + '&many=' + a.many : ''); }
  var hseq = 0;
  function holds() {
    // The statement of what you will hold follows the answers (the house writes it: /contract/…?holds=1).
    var k = cur(), h = document.querySelector('[data-holds-for="' + k + '"]'); if (!h) return;
    var c = chosen(), n = ++hseq;
    fetch('/contract/' + slug + '?holds=1&use=' + encodeURIComponent(k) + c.add.map(function (x) { return '&add=' + x; }).join('') + c.x.map(function (x) { return '&x=' + x; }).join('') + qs()).then(function (r) { return r.ok ? r.text() : null; }).then(function (t) {
      if (!t || n !== hseq) return; var d = document.createElement('div'); d.innerHTML = t; var p = d.querySelector('.holds'); if (p) h.innerHTML = p.innerHTML;
    }).catch(function () {});
  }
  function cur() { var i = form.querySelector('.bu input:checked'); return i ? i.value : null; }
  function setUse(reset) {
    var k = cur(), u = D.uses[k];
    if (!u || u.personal || u.print) { box.hidden = true; [].forEach.call(box.querySelectorAll('input'), function (i) { i.checked = false; }); price(); return; }
    box.hidden = false;
    if (at) at.textContent = u.term || '';
    [].forEach.call(box.querySelectorAll('.rt-c'), function (c) {
      var r = c.getAttribute('data-r'), i = c.querySelector('input'), has = u.has.indexOf(r) >= 0, can = u.addable.indexOf(r) >= 0;
      i.disabled = has || !can; if (reset || has) i.checked = has; c.classList.toggle('is-in', has);
      c.querySelector('em').textContent = has ? 'Included' : can ? '+' + money(D.add) : '';
    });
    if (reset) { [].forEach.call(box.querySelectorAll('.rt-e input'), function (i) { i.checked = false; }); if (aw) aw.value = ''; if (ao) ao.value = ''; if (am) { am.value = ''; am.hidden = true; } }
    price();
  }
  function chosen() {
    var add = [], x = [];
    [].forEach.call(box.querySelectorAll('.rt-c input:checked:not(:disabled)'), function (i) { add.push(i.value); });
    [].forEach.call(box.querySelectorAll('.rt-e input:checked'), function (i) { x.push(i.value); });
    return { add: add, x: x };
  }
  function assent() { var a = document.querySelector('[data-assent]'); if (!a) return; var c = chosen(); a.href = '/contract/' + slug + '?use=' + encodeURIComponent(cur() || '') + c.add.map(function (x) { return '&add=' + x; }).join('') + c.x.map(function (x) { return '&x=' + x; }).join('') + qs(); }
  function price() {
    assent();
    var k = cur(), u = D.uses[k], inp = form.querySelector('.bu input:checked'); if (!u || !inp) return;
    var c = chosen(), ask = c.x.some(function (e) { return D.extras[e] == null; }) || narrowed();
    if (as) as.hidden = !narrowed();
    var label = inp.getAttribute('data-label') || '';
    if (box.hidden || u.base == null || /Ask the maker/.test(label)) { btn.textContent = label; return; }
    var total = u.base + c.add.length * D.add + c.x.reduce(function (s, e) { return s + (D.extras[e] || 0); }, 0);
    btn.textContent = ask ? 'Ask the maker' : label.replace(/\$[\d,]+/, money(total));
  }
  form.addEventListener('change', function (e) {
    if (e.target.name === 'use') { setUse(true); holds(); return; }
    if (e.target.name === 'of' && am) { am.hidden = !ao.value; if (ao.value) am.focus(); }
    if (/^(add|x|where|of|many)$/.test(e.target.name)) { price(); holds(); }
  });
  if (am) am.addEventListener('input', function () { price(); });
  // Read the agreement as it would stand with these rights.
  var dlg = box.querySelector('[data-rt-d]'), body = box.querySelector('[data-rt-body]');
  box.querySelector('[data-rt-read]').addEventListener('click', function (e) {
    e.preventDefault();
    var c = chosen(), q = 'frag=1&use=' + encodeURIComponent(cur()) + c.add.map(function (a) { return '&add=' + a; }).join('') + c.x.map(function (a) { return '&x=' + a; }).join('') + qs();
    body.innerHTML = '<p class="rt-wait">The agreement&hellip;</p>';
    if (dlg.showModal) dlg.showModal(); else { location.href = '/contract/' + slug + '?' + q.replace('frag=1&', ''); return; }
    fetch('/contract/' + slug + '?' + q).then(function (r) { return r.text(); }).then(function (h) { body.innerHTML = '<p class="k">The agreement, as it would read</p>' + h + '<p class="rt-full"><a href="/contract/' + slug + '?' + q.replace('frag=1&', '') + '" target="_blank">Open it in full</a></p>'; });
  });
  dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.closest('[data-rt-close]')) dlg.close(); });
  setUse(false);
})();
