/* Share it, paid in place. Any "Share it" on the page opens a small sheet with the wallet button
   (Apple Pay, Google Pay or Link, whichever this device has). One tap, Face ID, and the file is
   handed over here: no checkout page, nothing to fill in. A device with no wallet goes to the
   card checkout instead. */
(function () {
  var C = window.__WM_PAY; if (!C || !C.pk) return;
  var stripe, elements, ece, sheet, cur, ready = false, available = false, loading;

  function loadStripe() {
    if (loading) return loading;
    loading = new Promise(function (res, rej) {
      if (window.Stripe) return res();
      var s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    }).then(function () {
      stripe = window.Stripe(C.pk);
      elements = stripe.elements({ mode: 'payment', amount: C.amount, currency: 'usd', appearance: { theme: 'flat', variables: { borderRadius: '0px', colorPrimary: '#0e0e0e', fontFamily: 'Archivo, Helvetica Neue, Arial, sans-serif' } } });
    });
    return loading;
  }
  // Warm up while the visitor looks, so the sheet opens instantly.
  (window.requestIdleCallback || function (f) { setTimeout(f, 1500); })(function () { loadStripe().catch(function () {}); });

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function build() {
    sheet = el('div', 'ps'); sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Share it');
    sheet.innerHTML = '<div class="ps-veil"></div><div class="ps-card"><button type="button" class="ps-x" aria-label="Close">&times;</button>'
      + '<div class="ps-buy"><div class="ps-head"><div class="ps-mat"><img class="ps-img" alt=""></div><div class="ps-row"><p class="ps-t"></p><p class="ps-p">' + esc(C.price) + '</p></div><p class="ps-k">Collect it &middot; yours to share</p></div>'
      + '<div class="ps-ece"></div><p class="ps-wait">One moment&hellip;</p><button type="button" class="ps-card-link">Pay by card instead</button>'
      + '<p class="ps-fine">85% goes to the photographer. Your card is remembered here, so next time it&rsquo;s one tap. <button type="button" class="ps-forget">Don&rsquo;t remember</button></p></div>'
      + '<div class="ps-done" hidden><span class="ps-seal" aria-hidden="true"></span><h2>Yours.</h2><p class="ps-dt"></p>'
      + '<a class="ps-dl" href="#" download>Save the photograph</a><button type="button" class="ps-copy">Copy the credit</button><a class="ps-lic" href="#">Your license</a></div></div>';
    document.body.appendChild(sheet);
    sheet.querySelector('.ps-veil').onclick = close; sheet.querySelector('.ps-x').onclick = close;
    sheet.querySelector('.ps-card-link').onclick = function () { checkout(cur.slug); };
    sheet.querySelector('.ps-forget').onclick = function () { forget(); this.textContent = 'It won\u2019t be remembered'; this.disabled = true; };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) close(); });
  }

  function mount() {
    ece = elements.create('expressCheckout', { emailRequired: true, buttonHeight: 54, buttonTheme: { applePay: 'black', googlePay: 'black', paypal: 'black' }, buttonType: { applePay: 'buy', googlePay: 'buy' }, layout: { maxColumns: 1, maxRows: 3, overflow: 'never' } });
    ece.on('ready', function (e) { ready = true; available = !!(e.availablePaymentMethods && Object.keys(e.availablePaymentMethods).some(function (k) { return e.availablePaymentMethods[k]; })); settle(); });
    ece.on('confirm', pay);
    ece.mount(sheet.querySelector('.ps-ece'));
  }
  function settle() {
    if (!cur) return;
    sheet.querySelector('.ps-wait').hidden = true;
    if (ready && !available) checkout(cur.slug); // no wallet on this device: straight to card checkout
  }

  async function pay(ev) {
    var b = ev.billingDetails || {};
    try {
      var r = await fetch('/pay/' + encodeURIComponent(cur.slug), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: b.email || '', name: b.name || '' }) });
      var j = await r.json(); if (!j.ok) throw new Error('intent');
      var res = await stripe.confirmPayment({ elements: elements, clientSecret: j.secret, confirmParams: { return_url: location.origin + '/w/' + cur.slug + '?paid=' + j.ref }, redirect: 'if_required' });
      if (res.error) { ev.paymentFailed && ev.paymentFailed({ reason: 'fail' }); return; }
      var d; for (var i = 0; i < 6; i++) { d = await (await fetch('/pay/' + j.ref + '/done', { method: 'POST' })).json(); if (d.ok) break; await new Promise(function (r) { setTimeout(r, 800); }); }
      if (d && d.ok) done(d); else location.href = '/w/' + cur.slug + '?paid=' + j.ref;
    } catch (e) { ev.paymentFailed && ev.paymentFailed({ reason: 'fail' }); }
  }

  function done(d) {
    sheet.querySelector('.ps-buy').hidden = true;
    var x = sheet.querySelector('.ps-done'); x.hidden = false;
    sheet.querySelector('.ps-dt').textContent = d.title + '. ' + d.credit + '.';
    var dl = sheet.querySelector('.ps-dl'); dl.href = d.download; sheet.querySelector('.ps-lic').href = d.page;
    sheet.querySelector('.ps-copy').onclick = function () { var t = d.credit; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { sheet.querySelector('.ps-copy').textContent = 'Copied'; }).catch(function () {}); };
    sheet.classList.add('is-done');
    setTimeout(function () { dl.click(); }, 450); // the file, handed over
    sheet.querySelector('.ps-dt').textContent += ' Next time, one tap.';
    if (d.no) sheet.querySelector('.ps-done h2').textContent = 'Collector No. ' + d.no + '.';
    sheet.querySelector('.ps-lic').textContent = 'Your collection'; sheet.querySelector('.ps-lic').href = '/yours';
  }

  function checkout(slug) {
    var f = el('form'); f.method = 'post'; f.action = '/buy/' + slug; var i = el('input'); i.type = 'hidden'; i.name = 'use'; i.value = 'social'; f.appendChild(i); document.body.appendChild(f); f.submit();
  }

  var tapping = false;
  function hasTap() { return /(?:^|; )wm_tap=1/.test(document.cookie); }
  function forget() { fetch('/pay/forget', { method: 'POST' }).catch(function () {}); document.cookie = 'wm_tap=; max-age=0; path=/'; }

  // Like the subway gate: a remembered card, one tap, gone. Undo sits on screen for a few seconds.
  async function tap(slug, title) {
    if (tapping) return; tapping = true;
    toast('<span class="pt-spin"></span>Sharing&hellip;');
    try {
      var d = await (await fetch('/pay/' + encodeURIComponent(slug) + '/tap', { method: 'POST' })).json();
      if (!d.ok) { hideToast(); tapping = false; return open(slug, title, null, true); }
      toast('<b>Yours.</b> ' + (d.no ? 'Collector No. ' + d.no + ' &middot; ' : '') + esc(d.price || C.price) + ' &middot; <a href="/yours">Collection</a> &middot; <a href="' + esc(d.download) + '" download>Save</a> <button type="button" class="pt-undo">Undo</button>', 9000);
      var a = document.createElement('a'); a.href = d.download; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
      var u = document.querySelector('.pt-undo'); if (u) u.onclick = async function () { u.disabled = true; var r = await (await fetch('/pay/' + d.ref + '/undo', { method: 'POST' })).json(); toast(r.ok ? 'Undone. Refunded in full.' : 'Too late to undo here; write to the maker.', 4000); };
    } catch (e) { hideToast(); open(slug, title, null, true); }
    tapping = false;
  }
  var tEl, tT;
  function toast(html, ms) {
    if (!tEl) { tEl = el('div', 'pt'); tEl.setAttribute('role', 'status'); document.body.appendChild(tEl); }
    tEl.innerHTML = html; tEl.classList.add('in'); clearTimeout(tT); if (ms) tT = setTimeout(hideToast, ms);
  }
  function hideToast() { if (tEl) tEl.classList.remove('in'); }

  async function open(slug, title, img, noTap, amount) {
    amount = +amount || C.amount;
    if (!noTap && hasTap()) return tap(slug, title);
    if (!sheet) build();
    cur = { slug: slug, amount: amount };
    sheet.querySelector('.ps-p').textContent = '$' + (amount / 100);
    sheet.classList.remove('is-done'); sheet.querySelector('.ps-buy').hidden = false; sheet.querySelector('.ps-done').hidden = true;
    sheet.querySelector('.ps-img').src = img || '/img/' + slug + '/thumb'; sheet.querySelector('.ps-t').textContent = title || '';
    sheet.querySelector('.ps-copy').textContent = 'Copy the credit';
    sheet.querySelector('.ps-wait').hidden = ready;
    sheet.hidden = false; document.documentElement.classList.add('ps-on');
    requestAnimationFrame(function () { sheet.classList.add('in'); });
    try { await loadStripe(); elements.update({ amount: amount }); if (!ece) mount(); else settle(); } catch (e) { checkout(slug); }
  }
  function close() { sheet.classList.remove('in'); document.documentElement.classList.remove('ps-on'); setTimeout(function () { sheet.hidden = true; }, 260); }

  window.WMShare = open;
  // On pages without the collection script (a collector's wall), "Collect it" opens the sheet too.
  document.addEventListener('click', function (e) {
    if (window.__WM) return;
    var b = e.target.closest && e.target.closest('[data-buy]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var a = b.closest('[data-s]'); if (a) open(a.dataset.s, (a.querySelector('.pc b') || {}).textContent || '');
  }, true);
  // The Share it form on a work page opens the sheet instead of leaving.
  document.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('form[data-share], form.lb-share'); if (!f) return;
    e.preventDefault();
    var slug = f.dataset.share || (f.action.split('/buy/')[1] || '').split(/[?#]/)[0];
    var title = f.dataset.title || (document.getElementById('lbT') || {}).textContent || '';
    open(slug, title, null, false, f.dataset.amount);
  }, true);
})();
