/* The rights in the contract: choose what is in it; the price and the agreement follow. */
(function () {
  var D = window.__WM_RT, box = document.querySelector('[data-rt]'), btn = document.getElementById('buyBtn');
  if (!D || !box || !btn) return;
  var form = box.closest('form'), slug = (form.getAttribute('action') || '').split('/').pop();
  var money = function (c) { return '$' + Math.round(c / 100).toLocaleString('en-US'); };
  function cur() { var i = form.querySelector('.bu input:checked'); return i ? i.value : null; }
  function setUse(reset) {
    var k = cur(), u = D.uses[k];
    if (!u || u.personal || u.print) { box.hidden = true; [].forEach.call(box.querySelectorAll('input'), function (i) { i.checked = false; }); price(); return; }
    box.hidden = false;
    [].forEach.call(box.querySelectorAll('.rt-c'), function (c) {
      var r = c.getAttribute('data-r'), i = c.querySelector('input'), has = u.has.indexOf(r) >= 0, can = u.addable.indexOf(r) >= 0;
      i.disabled = has || !can; if (reset || has) i.checked = has; c.classList.toggle('is-in', has);
      c.querySelector('em').textContent = has ? 'Included' : can ? '+' + money(D.add) : '';
    });
    if (reset) [].forEach.call(box.querySelectorAll('.rt-e input'), function (i) { i.checked = false; });
    price();
  }
  function chosen() {
    var add = [], x = [];
    [].forEach.call(box.querySelectorAll('.rt-c input:checked:not(:disabled)'), function (i) { add.push(i.value); });
    [].forEach.call(box.querySelectorAll('.rt-e input:checked'), function (i) { x.push(i.value); });
    return { add: add, x: x };
  }
  function price() {
    var k = cur(), u = D.uses[k], inp = form.querySelector('.bu input:checked'); if (!u || !inp) return;
    var c = chosen(), ask = c.x.some(function (e) { return D.extras[e] == null; });
    var label = inp.getAttribute('data-label') || '';
    if (box.hidden || u.base == null || /Ask the maker/.test(label)) { btn.textContent = label; return; }
    var total = u.base + c.add.length * D.add + c.x.reduce(function (s, e) { return s + (D.extras[e] || 0); }, 0);
    btn.textContent = ask ? 'Ask the maker' : label.replace(/\$[\d,]+/, money(total));
  }
  form.addEventListener('change', function (e) {
    if (e.target.name === 'use') setUse(true); else if (e.target.name === 'add' || e.target.name === 'x') price();
  });
  // Read the agreement as it would stand with these rights.
  var dlg = box.querySelector('[data-rt-d]'), body = box.querySelector('[data-rt-body]');
  box.querySelector('[data-rt-read]').addEventListener('click', function (e) {
    e.preventDefault();
    var c = chosen(), q = 'frag=1&use=' + encodeURIComponent(cur()) + c.add.map(function (a) { return '&add=' + a; }).join('') + c.x.map(function (a) { return '&x=' + a; }).join('');
    body.innerHTML = '<p class="rt-wait">The agreement&hellip;</p>';
    if (dlg.showModal) dlg.showModal(); else { location.href = '/contract/' + slug + '?' + q.replace('frag=1&', ''); return; }
    fetch('/contract/' + slug + '?' + q).then(function (r) { return r.text(); }).then(function (h) { body.innerHTML = '<p class="k">The agreement, as it would read</p>' + h + '<p class="rt-full"><a href="/contract/' + slug + '?' + q.replace('frag=1&', '') + '" target="_blank">Open it in full</a></p>'; });
  });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  setUse(false);
})();
