/* Save to Photos (Will, 18 Oct: on a phone a download should land in Photos, not Files). A page cannot write to the
   camera roll; the phone's own share sheet can ("Save Image"). So on a phone every file link of the house (/d/…, any
   a[download] of an image) fetches the file and hands it to the share sheet. If the phone needs a fresh tap after the
   fetch, a "Save to Photos" button appears in place for that tap. On a computer, links download as they always did.

   In the installed app (#43; Will, 15 Nov: "when we save a file it opens this black screen viewer… you can't get out of
   that screen"): the app has no browser bar, so a file opened in its window replaces the house with the bare file and
   nothing to press. Here, and only here, every press on anything that hands over a file (found by the link itself: a
   download attribute, ?dl=, a path that ends in /file, /take, /instax, /save, a file's extension, the house's download
   doors) never navigates the app to the file. The file is fetched and given to the device's own share sheet (Save
   Image, Save to Files, AirDrop); where a file cannot be shared, or is large (a .zip, or over SHARE_MAX), it opens
   outside the app's window, which the app shows in its own sheet with Done, and the house stays where it was. */
(function () {
  // No one-tap save (29 Oct, Will: "we can't make it one tap and save"): a long press or a right click on a picture of
  // the house offers nothing. A screenshot can't be stopped; the file can be kept from being handed over. The ways to
  // keep a picture are the house's own: Collect, the holder's Save it, an album's Download.
  document.addEventListener('contextmenu', function (e) { var t = e.target; if (t && (t.tagName === 'IMG' || t.tagName === 'PICTURE' || t.tagName === 'CANVAS' || (t.closest && t.closest('.ez,.st,.wv,.vr,.trp,.tw,.plate,.dw,.yx'))) && !(t.closest && t.closest('[data-allow-save]'))) e.preventDefault(); }, true);
  document.addEventListener('dragstart', function (e) { var t = e.target; if (t && t.tagName === 'IMG' && !(t.closest && t.closest('[data-allow-save]'))) e.preventDefault(); }, true);

  if (window.__WM_SAVE) return; window.__WM_SAVE = 1;
  var APP = false;
  try { APP = !!(window.__WM_APP || navigator.standalone === true || ['standalone', 'fullscreen', 'minimal-ui'].some(function (k) { return matchMedia('(display-mode: ' + k + ')').matches; })); } catch (e) { APP = false; }
  var phone = matchMedia('(pointer:coarse)').matches && /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var can = false;
  try { can = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File([new Uint8Array([255, 216, 255])], 'x.jpg', { type: 'image/jpeg' })] })); } catch (e) { can = false; }
  if (!APP && (!phone || !can)) return;
  var SHARE_MAX = 50 * 1024 * 1024;
  function isFile(a) { var h = a.getAttribute('href') || ''; return /^\/d\/|\/d\/[A-Za-z0-9_-]+/.test(h) || /^\/deliver\/[^/]+\/[^/]+\/(file|instax)(\?(?!.*full=1)|$)/.test(h) || (a.hasAttribute('download') && /\.(jpe?g|png|webp|heic|tiff?)(\?|$)|\/d\/|\/instax(\?|$)/i.test(h)); }
  // In the app: what hands over a file, by the link alone. A new download link anywhere is covered without being told.
  var TAKE = /\/(file|take|instax|save)$|\.(zip|pdf|csv|json|wmark|wmk|wmd|ots|txt|jpe?g|png|webp|gif|tiff?|heic|mp3|m4a|mp4|mov)$|^\/(d|library\/d|comp|release\/r|lab\/asset)\/|\/background\/|^\/b\/[^/]+\/(f|t)\/|^\/registry\/o\/\d+\/file\//i;
  var OUTSIDE = /\.(zip|csv|json|wmark|wmk|wmd|ots|txt)$/i; // not for the share sheet: large, or a file only another program opens
  var IMAGE = /\.(jpe?g|png|webp|gif|tiff?|heic)$|\/(instax|save)$|\/background\/|^\/d\//i;
  function taken(a) {
    var h = a.getAttribute('href'); if (!h || h.charAt(0) === '#' || /^(mailto|tel|sms|javascript):/i.test(h)) return null;
    var u; try { u = new URL(a.href, location.href); } catch (e) { return null; }
    if (u.protocol === 'blob:') return a.hasAttribute('download') ? u : null;
    if (u.origin !== location.origin) return null;
    if (/^\/(img|portrait|static)\//.test(u.pathname) && !a.hasAttribute('download')) return null; // a picture as shown is not a file handed over
    return a.hasAttribute('download') || u.searchParams.get('dl') || TAKE.test(u.pathname) ? u : null;
  }
  // Say so: the link reads as what it now does.
  function relabel(root) {
    if (!can) return;
    var r = root || document, list = [].slice.call(r.querySelectorAll('a[href]')); if (r.matches && r.matches('a[href]')) list.push(r);
    list.forEach(function (a) {
      if (a.__wmSave || !isFile(a)) return; a.__wmSave = 1;
      if (/^(Save|Save the photograph|Take the file|Download|File)$/i.test((a.textContent || '').trim())) a.textContent = 'Save to Photos';
    });
  }
  var sheet, btn, line, pending = null, act = null;
  function ui() {
    if (sheet) return;
    sheet = document.createElement('div'); sheet.className = 'sv'; sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Saving');
    sheet.innerHTML = '<div class="sv-card"><p class="sv-l" data-sv-l role="status" aria-live="polite">Preparing the photograph&hellip;</p><button type="button" class="sv-b" data-sv-b disabled>Save to Photos</button><button type="button" class="sv-x" data-sv-x>Not now</button></div>';
    document.body.appendChild(sheet); btn = sheet.querySelector('[data-sv-b]'); line = sheet.querySelector('[data-sv-l]');
    sheet.querySelector('[data-sv-x]').onclick = close; sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    btn.onclick = function () { if (act) { var f = act; act = null; f(); return; } if (pending) share(pending, true); };
  }
  function close() { if (sheet) sheet.hidden = true; pending = null; act = null; }
  // A fresh tap for what the device would not do without one: the button says what it will do.
  function offer(say, label, fn) { ui(); line.textContent = say; btn.textContent = label; btn.disabled = false; act = fn; sheet.hidden = false; }
  function share(file, fromButton) {
    return navigator.share({ files: [file], title: file.name.replace(/\.[a-z0-9]+$/i, '') }).then(function () { close(); }).catch(function (e) {
      if (e && e.name === 'AbortError') { close(); return; } // they closed the sheet: not an error, nothing to say
      if (!fromButton) { ui(); pending = file; act = null; line.textContent = 'Ready.'; btn.disabled = false; sheet.hidden = false; return; } // the phone wants a fresh tap
      line.textContent = APP ? 'This device would not open the share sheet. Try again in a moment.' : 'This phone would not open the share sheet. Try the link again, or long-press the photograph and choose Save to Photos.'; btn.disabled = true;
    });
  }
  function nameFrom(res, a, u) {
    var cd = res.headers.get('content-disposition') || '', x = cd.match(/filename\*=UTF-8''([^;]+)/i), m = cd.match(/filename="?([^";]+)"?/i);
    if (x) { try { return decodeURIComponent(x[1]); } catch (e) { /* fall through */ } }
    if (m) return m[1];
    var d = a.getAttribute('download'); if (d) return d;
    var t = (res.headers.get('content-type') || 'image/jpeg').split(';')[0], ext = t === 'image/png' ? 'png' : t === 'image/tiff' ? 'tif' : t === 'application/pdf' ? 'pdf' : 'jpg';
    var last = u && u.protocol !== 'blob:' ? decodeURIComponent(u.pathname.split('/').pop() || '') : '';
    if (APP && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
    return ((a.getAttribute('data-name') || document.title.split(' · ')[0] || 'Watermark').replace(/[^\w\- ]+/g, '').trim() || 'Watermark') + '.' + ext;
  }
  function stop(e) { e.preventDefault(); e.stopPropagation(); }

  // ---- In the installed app ----
  // Outside the app's window: the house stays where it was. A blocked window gets a button for the tap it wants.
  function outside(href) {
    var w = null; try { w = window.open(href, '_blank'); } catch (e) { w = null; }
    if (!w) offer('The file opens outside the app, and you come back here.', 'Open the file', function () { close(); try { window.open(href, '_blank'); } catch (e) { /* */ } });
  }
  function busy(a, on) { a.__wmBusy = on; if (on) { a.setAttribute('aria-busy', 'true'); a.setAttribute('aria-disabled', 'true'); a.setAttribute('data-sv-busy', ''); } else { a.removeAttribute('aria-busy'); a.removeAttribute('aria-disabled'); a.removeAttribute('data-sv-busy'); } }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function why(k, to) { var e = new Error(k); e.to = to; return e; }
  // The heavy doors may answer "one moment" (429/503 with Retry-After) and try again; a person is never refused, so
  // neither is this: the quiet line, then the same request again, as the house asks.
  function fetchFile(u, a, n) {
    return fetch(u.href, { credentials: 'same-origin' }).then(function (r) {
      if ((r.status === 429 || r.status === 503) && n < 8) {
        line.textContent = 'One moment: the house is busy. It will try again by itself.';
        return wait(Math.min(15, Math.max(1, +r.headers.get('retry-after') || 4)) * 1000).then(function () { return fetchFile(u, a, n + 1); });
      }
      if (r.status === 410) throw why('used');
      if (!r.ok) throw why('http');
      var t = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (t === 'text/html') throw why('page', r.url); // a page of the house, not a file (sent to the page the button is on)
      if ((+r.headers.get('content-length') || 0) > SHARE_MAX) { try { r.body && r.body.cancel(); } catch (e) { /* */ } throw why('big'); }
      return r.blob().then(function (b) { if (b.size > SHARE_MAX) throw why('big'); return new File([b], nameFrom(r, a, u), { type: (b.type || t || 'application/octet-stream').split(';')[0] }); });
    });
  }
  function take(a, u) {
    if (a.__wmBusy) return;
    var path = u.protocol === 'blob:' ? (a.getAttribute('download') || '') : u.pathname;
    if (!can || OUTSIDE.test(path) || OUTSIDE.test(a.getAttribute('download') || '')) { outside(u.href); return; }
    busy(a, true); ui(); pending = null; act = null; btn.textContent = 'Save to Photos'; btn.disabled = true; sheet.hidden = false;
    line.textContent = IMAGE.test(path) ? 'Preparing the photograph…' : 'Preparing the file…';
    fetchFile(u, a, 0).then(function (f) {
      busy(a, false);
      var ok = false; try { ok = navigator.canShare({ files: [f] }); } catch (e) { ok = false; }
      if (!ok) { offer('This file opens outside the app, and you come back here.', 'Open the file', function () { close(); outside(u.href); }); return; }
      pending = f; btn.textContent = /^image\//.test(f.type) ? 'Save to Photos' : 'Save the file'; line.textContent = 'Ready.'; btn.disabled = false;
      return share(f, false);
    }).catch(function (err) {
      busy(a, false); var k = err && err.message;
      if (k === 'page') { close(); location.href = err.to || u.href; return; }
      if (k === 'big') { offer('This file is large. It opens outside the app, and you come back here.', 'Open the file', function () { close(); outside(u.href); }); return; }
      ui(); sheet.hidden = false; btn.disabled = true;
      line.textContent = k === 'used' ? 'Every download on this license has been used. Your license page can add more.' : 'The file could not be fetched just now. Try again in a moment.';
    });
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    if (APP) {
      if (a.__wmBusy) { stop(e); return; } // pressed once already: it is on its way
      var u = taken(a); if (!u) return;
      stop(e); take(a, u); return;
    }
    if (!isFile(a)) return;
    stop(e);
    ui(); act = null; btn.textContent = 'Save to Photos'; line.textContent = 'Preparing the photograph…'; btn.disabled = true; sheet.hidden = false;
    fetch(a.href, { credentials: 'same-origin' }).then(function (r) {
      if (r.status === 410) throw new Error('used');
      if (!r.ok) throw new Error('http ' + r.status);
      return r.blob().then(function (b) { return new File([b], nameFrom(r, a), { type: (b.type || 'image/jpeg').split(';')[0] }); });
    }).then(function (f) { pending = f; line.textContent = 'Ready.'; btn.disabled = false; return share(f, false); })
      .catch(function (err) { line.textContent = err && err.message === 'used' ? 'Every download on this license has been used. Your license page can add more.' : 'The file could not be fetched just now. Try again in a moment.'; btn.disabled = true; });
  }, true);
  // Pages that hand a file over by themselves (after paying) leave it to the visitor's tap on a phone.
  window.__WM_NO_AUTO_DL = true;
  relabel();
  if (window.MutationObserver) new MutationObserver(function (m) { m.forEach(function (x) { [].forEach.call(x.addedNodes || [], function (n) { if (n.nodeType === 1) relabel(n); }); }); }).observe(document.documentElement, { childList: true, subtree: true });
})();
