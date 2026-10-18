/* The basket (18 Oct): gather photographs from anywhere in the house, collect them all at once. Kept in the browser
   (cookie wm_bk: slugs); the house reserves nothing until payment. "Add to basket" sits beside every Collect on a
   photograph's page and in the stroll's rail; a small basket with the count follows you until you collect. */
(function () {
  if (window.WMBasket) return;
  var MAX = 40, NAME = 'wm_bk';
  var BAG = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.2 8.6h13.6l-1.1 10.6a1.4 1.4 0 0 1-1.4 1.3H7.7a1.4 1.4 0 0 1-1.4-1.3z"/><path d="M8.8 8.6V7a3.2 3.2 0 0 1 6.4 0v1.6"/></svg>';
  function read() { var m = document.cookie.match(/(?:^|;\s*)wm_bk=([^;]*)/); return m && m[1] ? decodeURIComponent(m[1]).split(',').filter(Boolean) : []; }
  function write(list) { document.cookie = NAME + '=' + encodeURIComponent(list.slice(0, MAX).join(',')) + '; path=/; max-age=' + (60 * 60 * 24 * 60) + '; samesite=lax' + (location.protocol === 'https:' ? '; secure' : ''); paint(); }
  function has(s) { return read().indexOf(s) >= 0; }
  function add(s) { var l = read(); if (l.indexOf(s) < 0) { l.push(s); write(l); } bump(); return l.length; }
  function remove(s) { write(read().filter(function (x) { return x !== s; })); }
  var pill, toast, tt;
  function paint() {
    var n = read().length;
    if (!pill) { pill = document.createElement('a'); pill.className = 'bk-pill'; pill.href = '/basket'; pill.setAttribute('aria-label', 'Your basket'); document.body.appendChild(pill); }
    pill.innerHTML = BAG + '<b>' + n + '</b><span>' + (n === 1 ? 'photograph' : 'photographs') + '</span>';
    pill.hidden = !n || location.pathname === '/basket';
    if (document.querySelector('[data-stroll]')) pill.classList.add('bk-in-stroll');
    [].forEach.call(document.querySelectorAll('[data-bk-add]'), function (b) { var on = has(b.getAttribute('data-bk-add')); b.setAttribute('aria-pressed', on ? 'true' : 'false'); var t = b.querySelector('[data-bk-t]'); if (t) t.textContent = on ? (b.classList.contains('st-b') ? 'In basket' : 'In your basket') : (b.classList.contains('st-b') ? 'Basket' : 'Add to basket'); });
  }
  function bump() { if (!pill) return; pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump'); try { navigator.vibrate && navigator.vibrate(10); } catch (e) {} }
  function say(html) {
    if (!toast) { toast = document.createElement('div'); toast.className = 'bk-toast'; toast.setAttribute('role', 'status'); document.body.appendChild(toast); }
    toast.innerHTML = html; toast.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { toast.classList.remove('on'); }, 3200);
  }
  function toggle(slug) {
    if (has(slug)) { remove(slug); say('Taken out of the basket.'); }
    else { var n = add(slug); say('In your basket &middot; ' + n + ' &middot; <a href="/basket">Collect ' + (n === 1 ? 'it' : 'them') + '</a>'); }
  }
  window.WMBasket = { add: add, remove: remove, has: has, list: read, toggle: toggle };

  // A photograph's page: beside Collect.
  function onWork() {
    var f = document.querySelector('form.share-buy'); if (!f || document.querySelector('.bk-add')) return;
    var slug = f.getAttribute('data-share'); if (!slug) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'bk-add'; b.setAttribute('data-bk-add', slug);
    b.innerHTML = BAG + '<span data-bk-t>Add to basket</span>';
    f.insertAdjacentElement('afterend', b);
  }
  // The stroll: a Basket act in each rail, new cards included.
  function onStroll(root) {
    [].forEach.call((root || document).querySelectorAll('.st-i'), function (it) {
      var rail = it.querySelector('.st-rail'); if (!rail || rail.querySelector('[data-bk-add]')) return;
      if (!it.querySelector('[data-st-buy]')) return; // held, or not for sale
      var slug = it.getAttribute('data-slug');
      var b = document.createElement('button'); b.type = 'button'; b.className = 'st-b'; b.setAttribute('data-bk-add', slug);
      b.innerHTML = BAG + '<span data-bk-t>Basket</span>';
      var share = rail.querySelector('[data-st-share]'); rail.insertBefore(b, share || null);
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-bk-add]'); if (b) { e.preventDefault(); e.stopPropagation(); toggle(b.getAttribute('data-bk-add')); paint(); return; }
    var r = e.target.closest && e.target.closest('[data-bk-remove]'); if (r) { e.preventDefault(); remove(r.getAttribute('data-bk-remove')); var li = r.closest('li'); if (li) li.style.opacity = '.3'; setTimeout(function () { location.reload(); }, 180); }
  }, true);
  function init() {
    onWork(); onStroll();
    var sc = document.querySelector('[data-st-scroll]');
    if (sc && window.MutationObserver) new MutationObserver(function () { onStroll(sc); paint(); }).observe(sc, { childList: true });
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  addEventListener('pageshow', paint);
})();
