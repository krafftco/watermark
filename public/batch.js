// Batch (20 Oct): tick works, a bar rises with what can be done to all of them at once. Publish asks for one
// attestation for the lot; the bar stays out of the way until something is ticked.
(function () {
  var form = document.querySelector('[data-batch]'); if (!form) return;
  var bar = form.querySelector('[data-bt-bar]'), n = form.querySelector('[data-bt-n]'), attest = form.querySelector('[data-bt-attest]'), pub = form.querySelector('[data-bt-publish]');
  var boxes = function () { return [].slice.call(document.querySelectorAll('input[name="slugs"][form="' + form.id + '"], [data-batch] input[name="slugs"]')); };
  function paint() { var c = boxes().filter(function (b) { return b.checked; }).length; bar.hidden = !c; if (n) n.textContent = c; document.body.classList.toggle('bt-on', c > 0); }
  document.addEventListener('change', function (e) { if (e.target.name === 'slugs') paint(); });
  var all = form.querySelector('[data-bt-all]'), none = form.querySelector('[data-bt-none]');
  if (all) all.addEventListener('click', function () { boxes().forEach(function (b) { b.checked = true; }); paint(); });
  if (none) none.addEventListener('click', function () { boxes().forEach(function (b) { b.checked = false; }); paint(); });
  // Publish: the attestation shows on the first press; the second press, ticked, submits.
  if (pub && attest) pub.addEventListener('click', function (e) { var cb = attest.querySelector('input'); if (attest.hidden) { attest.hidden = false; cb.focus(); e.preventDefault(); return; } if (!cb.checked) { e.preventDefault(); cb.focus(); attest.classList.add('bt-need'); } });
  // Shift-click ticks a run.
  var last = null; document.addEventListener('click', function (e) { var b = e.target; if (!b || b.name !== 'slugs') return; if (e.shiftKey && last) { var bs = boxes(), i = bs.indexOf(last), j = bs.indexOf(b); if (i > -1 && j > -1) { var lo = Math.min(i, j), hi = Math.max(i, j); for (var k = lo; k <= hi; k++) bs[k].checked = b.checked; paint(); } } last = b; });
  paint();
})();
