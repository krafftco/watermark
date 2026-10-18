/* Save to Photos (Will, 18 Oct: on a phone a download should land in Photos, not Files). A page cannot write to the
   camera roll; the phone's own share sheet can ("Save Image"). So on a phone every file link of the house (/d/…, any
   a[download] of an image) fetches the file and hands it to the share sheet. If the phone needs a fresh tap after the
   fetch, a "Save to Photos" button appears in place for that tap. On a computer, links download as they always did. */
(function () {
  if (window.__WM_SAVE) return; window.__WM_SAVE = 1;
  var phone = matchMedia('(pointer:coarse)').matches && /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var can = false;
  try { can = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File([new Uint8Array([255, 216, 255])], 'x.jpg', { type: 'image/jpeg' })] })); } catch (e) { can = false; }
  if (!phone || !can) return;
  function isFile(a) { var h = a.getAttribute('href') || ''; return /^\/d\/|\/d\/[A-Za-z0-9_-]+/.test(h) || (a.hasAttribute('download') && /\.(jpe?g|png|webp|heic|tiff?)(\?|$)|\/d\//i.test(h)); }
  // Say so: the link reads as what it now does.
  function relabel(root) {
    var r = root || document, list = [].slice.call(r.querySelectorAll('a[href]')); if (r.matches && r.matches('a[href]')) list.push(r);
    list.forEach(function (a) {
      if (a.__wmSave || !isFile(a)) return; a.__wmSave = 1;
      if (/^(Save|Save the photograph|Take the file|Download|File)$/i.test((a.textContent || '').trim())) a.textContent = 'Save to Photos';
    });
  }
  var sheet, btn, line, pending = null;
  function ui() {
    if (sheet) return;
    sheet = document.createElement('div'); sheet.className = 'sv'; sheet.hidden = true;
    sheet.innerHTML = '<div class="sv-card"><p class="sv-l" data-sv-l>Preparing the photograph&hellip;</p><button type="button" class="sv-b" data-sv-b disabled>Save to Photos</button><button type="button" class="sv-x" data-sv-x>Not now</button></div>';
    document.body.appendChild(sheet); btn = sheet.querySelector('[data-sv-b]'); line = sheet.querySelector('[data-sv-l]');
    sheet.querySelector('[data-sv-x]').onclick = close; sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    btn.onclick = function () { if (pending) share(pending, true); };
  }
  function close() { if (sheet) sheet.hidden = true; pending = null; }
  function share(file, fromButton) {
    return navigator.share({ files: [file], title: file.name.replace(/\.[a-z]+$/i, '') }).then(function () { close(); }).catch(function (e) {
      if (e && e.name === 'AbortError') { close(); return; } // they closed the sheet
      if (!fromButton) { ui(); pending = file; line.textContent = 'Ready.'; btn.disabled = false; sheet.hidden = false; return; } // the phone wants a fresh tap
      line.textContent = 'This phone would not open the share sheet. Try the link again, or long-press the photograph and choose Save to Photos.'; btn.disabled = true;
    });
  }
  function nameFrom(res, a) {
    var cd = res.headers.get('content-disposition') || '', u = cd.match(/filename\*=UTF-8''([^;]+)/i), m = cd.match(/filename="?([^";]+)"?/i);
    if (u) { try { return decodeURIComponent(u[1]); } catch (e) { /* fall through */ } }
    if (m) return m[1];
    var t = (res.headers.get('content-type') || 'image/jpeg').split(';')[0], ext = t === 'image/png' ? 'png' : t === 'image/tiff' ? 'tif' : 'jpg';
    return ((a.getAttribute('data-name') || document.title.split(' · ')[0] || 'Watermark').replace(/[^\w\- ]+/g, '').trim() || 'Watermark') + '.' + ext;
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a || !isFile(a) || e.metaKey || e.ctrlKey) return;
    e.preventDefault(); e.stopPropagation();
    ui(); line.textContent = 'Preparing the photograph…'; btn.disabled = true; sheet.hidden = false;
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
