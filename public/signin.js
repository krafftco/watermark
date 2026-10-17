/* Signing in: one field, a six-digit code, and a passkey offered in the same field when the browser holds one. */
(function () {
  var root = document.querySelector('[data-si]'); if (!root) return;
  var steps = {}; root.querySelectorAll('[data-step]').forEach(function (s) { steps[s.getAttribute('data-step')] = s; });
  if (!steps.email) return;
  var emailForm = root.querySelector('[data-si-email]'), emailIn = emailForm.querySelector('input'), codeForm = root.querySelector('[data-si-code]');
  var boxes = Array.prototype.slice.call(root.querySelectorAll('[data-si-boxes] input'));
  var email = '', next = root.getAttribute('data-next') || '';
  function msg(step, t, bad) { var m = step.querySelector('[data-si-msg]'); if (m) { m.textContent = t || ''; m.classList.toggle('bad', !!bad); } }
  function busy(form, on) { form.classList.toggle('busy', !!on); form.querySelectorAll('button, input').forEach(function (x) { x.disabled = !!on; }); }
  function show(name) {
    Object.keys(steps).forEach(function (k) { steps[k].classList.toggle('is-on', k === name); });
    if (name === 'code') setTimeout(function () { boxes[0].focus(); }, 60);
    if (name === 'email') setTimeout(function () { emailIn.focus(); }, 60);
  }
  async function post(u, body) { var r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); return { ok: r.ok, j: await r.json().catch(function () { return {}; }) }; }

  async function send(again) {
    var v = emailIn.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) { msg(steps.email, 'That does not look like an email address.', true); emailIn.focus(); shake(emailIn.parentNode); return; }
    email = v; busy(emailForm, true); msg(steps.email, '');
    var r = await post('/signin/code', { email: email }); busy(emailForm, false);
    if (!r.ok) { msg(again ? steps.code : steps.email, r.j.why || 'Not sent. Try again in a moment.', true); return; }
    root.querySelector('[data-si-to]').textContent = r.j.to;
    if (r.j.sent === false) { var off = steps.code.querySelector('[data-si-off]'); if (off) off.hidden = false; }
    boxes.forEach(function (b) { b.value = ''; b.classList.remove('ok', 'bad'); }); msg(steps.code, again ? 'A new code is on its way.' : '');
    if (!again) show('code');
  }
  emailForm.addEventListener('submit', function (e) { e.preventDefault(); send(false); });
  root.querySelector('[data-si-again]').addEventListener('click', function () { send(true); });
  root.querySelector('[data-si-back]').addEventListener('click', function () { show('email'); });

  // The six boxes: type, paste, arrow, backspace; the moment the sixth lands, we go.
  function code() { return boxes.map(function (b) { return b.value; }).join(''); }
  function fill(str, from) { var d = String(str).replace(/\D/g, ''); if (!d) return; for (var i = 0; i < d.length && from + i < 6; i++) boxes[from + i].value = d[i]; var n = Math.min(5, from + d.length); boxes[n].focus(); if (code().length === 6) verify(); }
  boxes.forEach(function (b, i) {
    b.addEventListener('input', function () { var v = b.value.replace(/\D/g, ''); b.value = ''; if (v) fill(v, i); });
    b.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace') { e.preventDefault(); if (b.value) b.value = ''; else if (i > 0) { boxes[i - 1].value = ''; boxes[i - 1].focus(); } boxes.forEach(function (x) { x.classList.remove('bad'); }); }
      else if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus(); else if (e.key === 'ArrowRight' && i < 5) boxes[i + 1].focus();
    });
    b.addEventListener('paste', function (e) { e.preventDefault(); fill((e.clipboardData || window.clipboardData).getData('text'), 0); });
    b.addEventListener('focus', function () { b.select(); });
  });
  codeForm.addEventListener('submit', function (e) { e.preventDefault(); verify(); });
  function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  async function verify() {
    var c = code(); if (c.length !== 6) { msg(steps.code, 'All six digits.', true); shake(codeForm); return; }
    busy(codeForm, true); msg(steps.code, '');
    var r = await post('/signin/verify', { email: email, code: c, next: next }); busy(codeForm, false);
    if (!r.ok) { boxes.forEach(function (b) { b.classList.add('bad'); }); shake(codeForm); msg(steps.code, r.j.why || 'Not that one.', true); if (r.j.again) root.querySelector('[data-si-again]').focus(); else { boxes.forEach(function (b) { b.value = ''; }); boxes[0].focus(); } return; }
    boxes.forEach(function (b, i) { setTimeout(function () { b.classList.add('ok'); }, i * 40); });
    var hello = root.querySelector('[data-si-hello]'), sub = root.querySelector('[data-si-sub]');
    hello.textContent = r.j.name ? (r.j.fresh ? 'Welcome, ' + r.j.name + '.' : 'Welcome back, ' + r.j.name + '.') : (r.j.fresh ? 'Welcome.' : 'Welcome back.');
    sub.textContent = r.j.maker ? 'Your room is open.' : r.j.fresh ? 'Your gallery begins here.' : 'Your gallery is open.';
    setTimeout(function () { show('done'); }, 380);
    setTimeout(function () { location.href = r.j.to || '/yours'; }, 1500);
  }

  // Conditional passkeys: if this browser holds one for Watermark, it is offered in the email field itself.
  var W = window.SimpleWebAuthnBrowser;
  if (W && W.browserSupportsWebAuthnAutofill && emailIn) W.browserSupportsWebAuthnAutofill().then(async function (yes) {
    if (!yes) return;
    try {
      var o = await post('/auth/passkey/login/options'); if (!o.ok) return;
      var a = await W.startAuthentication({ optionsJSON: o.j, useBrowserAutofill: true });
      var v = await post('/auth/passkey/login/verify', a);
      if (v.ok) { show('done'); setTimeout(function () { location.href = next || '/yours'; }, 900); } else msg(steps.email, 'That passkey is not one Watermark knows. Use your email.', true);
    } catch (e) { /* the person typed an email instead; that is fine */ }
  });
})();
