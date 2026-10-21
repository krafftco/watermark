/* The stroll: one photograph at a time, edge to edge, a swipe to the next; endless, never the same twice. Double-tap tips
   your hat. The rail acts in place. Standing is told to the house when you move on. The next three load while you look. */
(function () {
  var root = document.querySelector('[data-stroll]'); if (!root) return;
  var scroller = root.querySelector('[data-st-scroll]'), S = window.__WM_STROLL || { items: [] }, q = S.q || '', maker = S.maker || '', guideOn = false;
  var set = S.set || null;
  try { guideOn = localStorage.getItem('wm_stroll_guide') === '1'; } catch (e) {}
  var items = {}, order = [], seen = [], cur = null, since = Date.now(), loading = false, done = false, chrome = true;
  var toast = root.querySelector('[data-st-toast]'), tt;
  var V = (document.cookie.match(/(?:^|;\s*)wm_v=([^;]+)/) || [])[1] || '';
  var sayHold = 0;
  function say(m, ms) { if (sayHold > Date.now() && m.indexOf('A hat is') !== 0) { setTimeout(function () { say(m, ms); }, sayHold - Date.now()); return; } toast.textContent = m; toast.hidden = false; toast.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { toast.classList.remove('on'); setTimeout(function () { toast.hidden = true; }, 400); }, ms || 2200); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var ic = {};
  (function () { var first = scroller.querySelector('.st-i'); if (!first) return; var ey = first.querySelector('[data-eye] svg'); ic.eye = ey ? ey.outerHTML : ''; ['hat', 'bravo', 'hang', 'buy', 'guide', 'card', 'easel', 'share', 'more'].forEach(function (k) { var b = first.querySelector('[data-st-' + k + ']'); if (b) { var svg = b.querySelector('svg'); ic[k] = svg ? svg.outerHTML : ''; } }); ic.collect = ic.buy || (first.querySelector('.st-held svg') || {}).outerHTML || ''; })();

  function register(w, el) { items[w.slug] = w; order.push(w.slug); seen.push(w.slug); w.el = el; }
  S.items.forEach(function (w) { var el = scroller.querySelector('.st-i[data-slug="' + w.slug + '"]'); if (el) register(w, el); });

  function screenFor(w) {
    var el = document.createElement('section'); el.className = 'st-i'; el.setAttribute('data-slug', w.slug);
    el.innerHTML = '<img class="st-im" src="' + esc(w.img) + '" alt="' + esc(w.title) + '" draggable="false" decoding="async" loading="lazy"' + (w.width && w.height ? ' width="' + w.width + '" height="' + w.height + '"' : '') + '>'
      + '<div class="st-plate"><a class="st-by" href="/wander?maker=' + esc(w.makerSlug) + '&at=' + esc(w.slug) + '" data-st-maker>' + esc(w.maker) + '</a><a class="st-t" href="/m/' + esc(w.makerSlug) + '/' + esc(w.slug) + '">' + esc(w.title) + '</a><span class="st-k">' + (w.place ? '<a href="/wander?q=' + encodeURIComponent(w.place) + '">' + esc(w.place) + '</a>' : '') + (w.place && w.year ? ' · ' : '') + esc(w.year || '') + '</span></div>'
      + '<button type="button" class="st-eye" data-eye="' + esc(w.slug) + '" aria-label="See the watermark">' + (ic.eye || '') + '</button>'
      + '<nav class="st-rail" aria-label="Acts">'
      + '<button type="button" class="st-b" data-st-hat aria-pressed="' + (w.hat && w.hat.mine ? 'true' : 'false') + '">' + ic.hat + '<span data-st-hat-n>Hat</span></button>'
      + '<button type="button" class="st-b st-bv" data-st-bravo aria-pressed="' + (w.bravo && w.bravo.mine ? 'true' : 'false') + '">' + (ic.bravo || '') + '<span>Bravo</span></button>'
      + '<button type="button" class="st-b" data-st-hang>' + ic.hang + '<span>Hang</span></button>'
      + (w.held ? '<span class="st-b st-held">' + ic.collect + '<span>Yours</span></span>' : w.collect ? '<button type="button" class="st-b st-buy" data-st-buy data-url="' + esc(w.collect.url) + '" data-pocket="' + (w.collect.pocket ? 1 : 0) + '">' + ic.collect + '<span>' + esc(w.collect.price) + '</span></button>' : '')
      + (w.guide ? '<button type="button" class="st-b" data-st-guide>' + ic.guide + '<span>Guide</span></button>' : '')
      + '<button type="button" class="st-b" data-st-share>' + ic.share + '<span>Share</span></button>'
      + '<button type="button" class="st-b st-moreb" data-st-more aria-expanded="false" aria-label="More">' + (ic.more || '') + '<span>More</span></button>'
      + '<div class="st-more" data-st-morebox hidden><button type="button" class="st-b" data-st-card>' + ic.card + '<span>Card</span></button>'
      + '<a class="st-b" data-st-easel href="/easel/' + esc(w.slug) + '?back=' + encodeURIComponent('/wander?at=' + w.slug) + '">' + (ic.easel || '') + '<span>Study</span></a></div></nav>'
      + '<div class="st-hat-fly" aria-hidden="true">' + ic.hat + '</div>';
    try { var im0 = el.querySelector('.st-im'); if (window.WMTrue && im0) { WMTrue.cap(im0); im0.addEventListener('load', function () { WMTrue.cap(im0); }, { once: true }); } } catch (e) { /* true size */ }
    return el;
  }
  // More, before the visitor reaches the end.
  function more() {
    if (loading || done) return; loading = true; if (window.WMWave) WMWave.show();
    fetch('/api/stroll?n=8&q=' + encodeURIComponent(q) + '&maker=' + encodeURIComponent(maker) + (set ? '&in=' + encodeURIComponent(set.key) : '') + '&seen=' + encodeURIComponent(seen.slice(-300).join(','))).then(function (r) { return r.json(); }).then(function (j) {
      var list = (j && j.items) || [];
      if (set && (j.end || !list.length)) { done = true; setTimeout(function () { var e = document.createElement('section'); e.className = 'st-i st-none st-end'; e.innerHTML = '<p>That is all of ' + esc(set.label.replace(/^The /, 'the ')) + '.</p><a href="' + esc(set.href) + '">Back to it</a><a href="/wander">Wander everything</a>'; scroller.appendChild(e); }, 0); }
      else if (!list.length) { done = true; return; }
      list.forEach(function (w) { if (items[w.slug]) return; var el = screenFor(w); scroller.appendChild(el); register(w, el); io.observe(el); });
    }).catch(function () {}).then(function () { loading = false; if (window.WMWave) WMWave.hide(); });
  }
  // Which photograph is before you now; the one before it is told to the house.
  function stood(slug, s) { if (!slug || s < 2) return; try { navigator.sendBeacon('/w/' + slug + '/stood', JSON.stringify({ v: V, s: s })); } catch (e) {} }
  function prefetch(i) { for (var k = 1; k <= 3; k++) { var w = items[order[i + k]]; if (w && !w.pre) { w.pre = new Image(); w.pre.src = w.img; } } }
  // Turning the phone (Will, 18 Oct: a horizontal photograph should be enjoyed sideways, full screen; Instagram gets
  // this wrong). The screen's height changes under the scroll, so the snap would land on a neighbour: through the
  // turn the current work is held in place, and landscape is its own presentation (the picture alone, edge to edge).
  var turning = false, turnT = null;
  function resnap() {
    var w = items[cur]; if (!w || !w.el) return;
    turning = true; clearTimeout(turnT);
    scroller.style.scrollSnapType = 'none'; scroller.scrollTop = w.el.offsetTop;
    requestAnimationFrame(function () { scroller.scrollTop = w.el.offsetTop; scroller.style.scrollSnapType = ''; turnT = setTimeout(function () { scroller.scrollTop = w.el.offsetTop; turning = false; }, 320); });
    var land = innerWidth > innerHeight; root.classList.toggle('st-land', land);
    if (land && TOUCH) { root.classList.add('st-arr'); clearTimeout(stillT); }
  }
  var rsT = null; addEventListener('resize', function () { clearTimeout(rsT); rsT = setTimeout(resnap, 60); }); addEventListener('orientationchange', function () { setTimeout(resnap, 120); setTimeout(resnap, 420); });
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', function () { setTimeout(resnap, 100); });
  root.classList.toggle('st-land', innerWidth > innerHeight);
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (turning) return;
      if (!e.isIntersecting || e.intersectionRatio < 0.6) return;
      var slug = e.target.getAttribute('data-slug'); if (slug === cur) return;
      if (cur) stood(cur, Math.round((Date.now() - since) / 1000));
      cur = slug; since = Date.now();
      var i = order.indexOf(slug); prefetch(i); if (i >= order.length - 4) more();
      try { history.replaceState(null, '', '/wander?at=' + slug + (set ? '&in=' + encodeURIComponent(set.key) : '') + (q ? '&q=' + encodeURIComponent(q) : '') + (maker ? '&maker=' + encodeURIComponent(maker) : '')); } catch (x) {}
      stopGuide(true); if (guideOn && items[slug] && items[slug].guide) setTimeout(function () { if (cur === slug) guide(items[slug], true); }, 500);
      arrive(slug);
    });
  }, { root: scroller, threshold: [0.6] });
  order.forEach(function (s) { io.observe(items[s].el); });
  if (order.length < 6) more();
  addEventListener('pagehide', function () { if (cur) stood(cur, Math.round((Date.now() - since) / 1000)); });

  // The acts.
  // Hat vs Bravo, said once (Will, 19 Oct: people keep asking): the first time either is pressed, one line.
  function hatOrBravoTold() { try { if (localStorage.getItem('wm_hb_told')) return true; localStorage.setItem('wm_hb_told', '1'); } catch (e) {} sayHold = Date.now() + 5200; say('A hat is a nod: I saw it. Bravo is a shout: it floored me. Hats are free; three bravos a month.', 5200); return false; }
  function hat(w, fly) {
    hatOrBravoTold();
    var b = w.el.querySelector('[data-st-hat]'), n = w.el.querySelector('[data-st-hat-n]');
    if (fly) { var f = w.el.querySelector('.st-hat-fly'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); try { navigator.vibrate && navigator.vibrate(12); } catch (x) {} }
    if (fly && w.hat && w.hat.mine) return; // a double-tap never takes a hat back
    fetch('/w/' + w.slug + '/applaud', { method: 'POST', headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) return; w.hat = { n: j.n, mine: !!j.mine }; b.setAttribute('aria-pressed', j.mine ? 'true' : 'false'); // no numbers on the wall
    }).catch(function () {});
  }
  // Bravo: the standing ovation, a few a month. Gold flecks from the button, the phone answers, the maker is told.
  function bravo(w, b) {
    hatOrBravoTold();
    var was = b.getAttribute('aria-pressed') === 'true';
    if (!was) {
      try { navigator.vibrate && navigator.vibrate([14, 50, 14, 50, 40]); } catch (x) {}
      if (!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        var r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, fx = document.createElement('div'); fx.className = 'bv-fx'; document.body.appendChild(fx);
        for (var i = 0; i < 30; i++) { var p = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 140; p.style.left = cx + 'px'; p.style.top = cy + 'px'; p.style.background = ['#c9a45c', '#e8d29a', '#b38a3e', '#f4ead0', '#fff'][i % 5]; p.style.setProperty('--x', Math.cos(a) * d + 'px'); p.style.setProperty('--y', (Math.sin(a) * d - 60) + 'px'); p.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg'); fx.appendChild(p); }
        var wd = document.createElement('b'); wd.textContent = 'Bravo!'; wd.style.left = (innerWidth / 2) + 'px'; wd.style.top = (innerHeight / 2) + 'px'; fx.appendChild(wd);
        setTimeout(function () { fx.remove(); }, 1700);
      }
    }
    b.setAttribute('aria-pressed', was ? 'false' : 'true');
    fetch('/w/' + w.slug + '/bravo', { method: 'POST', headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.spent) { b.setAttribute('aria-pressed', 'false'); say('Your ' + (j.of || 3) + ' bravos this month are given.'); return; }
      if (!j || !j.ok) { b.setAttribute('aria-pressed', was ? 'true' : 'false'); return; }
      w.bravo = { mine: !!j.on }; b.setAttribute('aria-pressed', j.on ? 'true' : 'false');
      if (j.on) say(j.left ? 'Bravo. The maker is told. ' + j.left + ' left this month.' : 'Bravo. The maker is told. Your last this month.');
    }).catch(function () { b.setAttribute('aria-pressed', was ? 'true' : 'false'); });
  }
  function hang(w) {
    fetch('/hang/add', { method: 'post', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'work=' + encodeURIComponent(w.slug) + '&hang=wander&title=From+my+wandering&json=1' })
      .then(function (r) { return r.json(); }).then(function (j) { say(j && j.ok ? 'Hung on your wall.' : 'Sign in to hang it.'); }).catch(function () { say('Could not hang it just now.'); });
  }
  function checkout(w) { var f = document.createElement('form'); f.method = 'post'; f.action = w.collect.url + '?back=' + encodeURIComponent('/wander?at=' + w.slug); f.innerHTML = '<input type="hidden" name="use" value="social">'; document.body.appendChild(f); f.submit(); }
  function buy(w, b) {
    if (!w.collect) return;
    if (b.getAttribute('data-pocket') !== '1') return checkout(w);
    b.disabled = true;
    fetch(w.collect.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'use=social&from=pocket&json=1' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { w.held = true; var s = document.createElement('span'); s.className = 'st-b st-held'; s.innerHTML = ic.collect + '<span>Yours</span>'; b.replaceWith(s); say('Yours.' + (j.no ? ' No. ' + j.no : '')); }
      else checkout(w);
    }).catch(function () { checkout(w); });
  }
  // The guide: a sheet with the text, read in the house voice.
  var sheet = root.querySelector('[data-st-guide-sheet]'), gt = root.querySelector('[data-st-gt]'), gby = root.querySelector('[data-st-gby]'), audio = null, Sy = null /* the browser's synthetic voice is never used (Will, 20 Oct); the house's recording or nothing */;
  function stopGuide(keepSheet) { if (audio) { audio.pause(); audio = null; } if (Sy) Sy.cancel(); if (!keepSheet) sheet.hidden = true; else sheet.hidden = true; }
  function guide(w, quiet) {
    if (!w.guide) return;
    gt.innerHTML = w.guide.split(/\n{2,}/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    gby.innerHTML = esc(w.approved ? 'Written with AI, approved by the maker.' : 'Written by AI from the photograph and its record.') + (w.study ? ' <a class="st-gmore" href="/m/' + esc(w.makerSlug) + '/' + esc(w.slug) + '#study">Go further: what to look for, the history, the artists, what to read</a>' : '');
    if (!quiet) sheet.hidden = false;
    if (w.audio) { audio = new Audio(w.audio); audio.onerror = function () { audio = null; speak(w); }; var p = audio.play(); if (p && p.catch) p.catch(function () { audio = null; speak(w); }); }
    else speak(w);
  }
  function speak(w) { if (!Sy) return; Sy.cancel(); w.guide.split(/\n{2,}/).forEach(function (t) { var u = new SpeechSynthesisUtterance(t); u.rate = 0.94; Sy.speak(u); }); }
  root.querySelector('[data-st-gx]').addEventListener('click', stopGuide);
  sheet.addEventListener('click', function (e) { if (e.target === sheet) stopGuide(); });
  // A card for the maker: 99 cents from the pocket in one tap; else the card page with every amount.
  function card(w) {
    fetch('/w/' + w.slug + '/thanks', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'amount=99&json=1' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { say('A card sent to ' + w.maker.split(' ')[0] + ', 99\u00a2.'); try { navigator.vibrate && navigator.vibrate(12); } catch (x) {} }
      else location.href = (j && j.go) || ('/w/' + w.slug + '/thanks');
    }).catch(function () { location.href = '/w/' + w.slug + '/thanks'; });
  }
  function share(w) {
    var url = location.origin + '/m/' + w.makerSlug + '/' + w.slug, text = w.title + ', a photograph by ' + w.maker + ' on Watermark';
    if (navigator.share) navigator.share({ title: w.title, text: text, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { say('Link copied.'); });
  }
  scroller.addEventListener('click', function (e) {
    var it = e.target.closest('.st-i'); if (!it) return; var w = items[it.getAttribute('data-slug')]; if (!w) return;
    var b = e.target.closest('button');
    if (!b) { if (e.target.closest('.st-plate')) return; return; }
    e.preventDefault();
    if (b.hasAttribute('data-st-hat')) hat(w, false);
    else if (b.hasAttribute('data-st-bravo')) bravo(w, b);
    else if (b.hasAttribute('data-st-hang')) hang(w);
    else if (b.hasAttribute('data-st-buy')) buy(w, b);
    else if (b.hasAttribute('data-st-guide')) guide(w);
    else if (b.hasAttribute('data-st-card')) card(w);
    else if (b.hasAttribute('data-st-share')) share(w);
  });
  // A double-tap on the picture tips your hat; a single tap rests the chrome.
  var lastTap = 0, tapT = null;
  scroller.addEventListener('pointerup', function (e) {
    if (e.target.closest('button, a')) return; var it = e.target.closest('.st-i'); if (!it) return;
    var now = Date.now();
    if (now - lastTap < 320) { clearTimeout(tapT); lastTap = 0; var w = items[it.getAttribute('data-slug')]; if (w) hat(w, true); return; }
    lastTap = now; tapT = setTimeout(function () {
      // On a phone the picture leads: a tap calls the plate and the acts for a few seconds; a tap while they show sends them away.
      if (TOUCH) { if (root.classList.contains('st-still') || root.classList.contains('st-arr')) { root.classList.remove('st-arr'); quiet(TAP); } else { clearTimeout(stillT); root.classList.add('st-still'); } return; }
      chrome = !chrome; root.classList.toggle('st-rest', !chrome); }, 330);
  });
  // Stopping the guide when you move on.
  scroller.addEventListener('scroll', function () { if (audio || (Sy && Sy.speaking)) { if (!sheet.hidden) return; } }, { passive: true });
  // Keys, for a desk.
  document.addEventListener('keydown', function (e) {
    var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    var w = items[cur]; var h = scroller.clientHeight;
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === ' ') { e.preventDefault(); scroller.scrollBy({ top: h, behavior: 'smooth' }); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); scroller.scrollBy({ top: -h, behavior: 'smooth' }); }
    else if (e.key === 'Escape') { if (!sheet.hidden) stopGuide(); else location.href = '/collection'; }
    else if (w && (e.key === 'h' || e.key === 'H')) hat(w, true);
    else if (w && (e.key === 's' || e.key === 'S')) hang(w);
    else if (w && (e.key === 'g' || e.key === 'G')) (sheet.hidden ? guide(w) : stopGuide());
    else if (w && (e.key === 'c' || e.key === 'C')) { var b = w.el.querySelector('[data-st-buy]'); if (b) buy(w, b); }
  });
  // Guide on: each photograph's guide is read as you arrive, in the house voice, until you turn it off.
  var gon = root.querySelector('[data-st-gon]');
  function paintGon() { if (gon) gon.checked = !!guideOn; }
  paintGon();
  if (gon) gon.addEventListener('change', function () { guideOn = gon.checked; try { localStorage.setItem('wm_stroll_guide', guideOn ? '1' : '0'); } catch (e) {} if (guideOn && items[cur]) guide(items[cur], true); else stopGuide(); say(guideOn ? 'The guide will read each one.' : 'Guide off.'); });
  // The doors beside the stroll (Will, 19 Oct): a swipe left opens the Keys (the bench under this work, the balcony,
  // your keys; then your gallery and the collection); a swipe right opens Yours (your wallet, as a collector or a maker,
  // with a switch). The door follows the finger and snaps; a swipe back, the shade, or Esc closes it. Fetched once a
  // work (/stroll/side/:slug), for whoever is signed in. Replaces the old sideways swipe into the maker's stroll, which
  // looked like nothing had happened (the same picture, a chip).
  var sideL = root.querySelector('[data-st-side="yours"]'), sideR = root.querySelector('[data-st-side="keys"]'), shade = root.querySelector('[data-st-shade]');
  var sideOpen = null, sideCache = {}, sideFor = null, sideAs = 'collector';
  try { sideAs = localStorage.getItem('wm_side_as') || 'collector'; } catch (e) {}
  function sideW(el) { return el ? el.getBoundingClientRect().width : 0; }
  function sideSet(el, x, anim) { if (!el) return; el.style.transition = anim ? 'transform .42s cubic-bezier(.16,1,.3,1)' : 'none'; el.style.transform = 'translateX(' + x + 'px)'; }
  function paintAs() { root.querySelectorAll('[data-sd-as]').forEach(function (p) { p.hidden = p.getAttribute('data-sd-as') !== sideAs; }); root.querySelectorAll('[data-sd-switch]').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-sd-switch') === sideAs ? 'true' : 'false'); }); }
  function sideFill(slug) {
    if (sideFor === slug) return; sideFor = slug;
    var go = function (d) { sideL.querySelector('[data-sd-body]').innerHTML = d.yours || ''; sideR.querySelector('[data-sd-body]').innerHTML = d.keys || ''; paintAs(); };
    if (sideCache[slug]) return go(sideCache[slug]);
    fetch('/stroll/side/' + encodeURIComponent(slug), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) { sideCache[slug] = d; if (sideFor === slug) go(d); }).catch(function () {});
  }
  function sideShow(which, anim) {
    var el = which === 'keys' ? sideR : sideL; if (!el) return;
    sideOpen = which; root.classList.add('st-side-on'); shade.hidden = false; el.classList.add('on');
    sideSet(el, 0, anim !== false); clearTimeout(stillT); root.classList.add('st-still');
  }
  function sideHide(anim) {
    if (!sideOpen) return; var el = sideOpen === 'keys' ? sideR : sideL; var w = sideW(el);
    sideSet(el, sideOpen === 'keys' ? w : -w, anim !== false); el.classList.remove('on'); sideOpen = null; root.classList.remove('st-side-on'); shade.hidden = true;
  }
  var sx0 = null, sy0 = null, sLock = null, sEl = null, sBase = 0, sX = 0;
  scroller.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || e.target.closest('button, a, input')) { sx0 = null; return; }
    sx0 = e.touches[0].clientX; sy0 = e.touches[0].clientY; sLock = null; sEl = null;
  }, { passive: true });
  scroller.addEventListener('touchmove', function (e) {
    if (sx0 == null) return; var dx = e.touches[0].clientX - sx0, dy = e.touches[0].clientY - sy0;
    if (!sLock) { if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; sLock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (sLock === 'x') { var w = items[cur]; if (w) sideFill(w.slug); sEl = dx < 0 ? sideR : sideL; sBase = sideW(sEl); sEl.classList.add('on'); shade.hidden = false; } }
    if (sLock !== 'x' || !sEl) return;
    e.preventDefault();
    var open = sEl === sideR ? Math.max(0, Math.min(sBase, -dx)) : Math.max(0, Math.min(sBase, dx)); sX = open;
    sideSet(sEl, sEl === sideR ? sBase - open : open - sBase, false);
    shade.style.opacity = String(0.6 * open / sBase);
  }, { passive: false });
  scroller.addEventListener('touchend', function (e) {
    if (sx0 == null) return; var dx = e.changedTouches[0].clientX - sx0; var lock = sLock, el = sEl; sx0 = null; sLock = null; sEl = null;
    if (lock !== 'x' || !el) return;
    shade.style.opacity = '';
    if (sX > sBase * 0.3 || Math.abs(dx) > 90) sideShow(el === sideR ? 'keys' : 'yours'); else { sideSet(el, el === sideR ? sBase : -sBase, true); el.classList.remove('on'); shade.hidden = !sideOpen; }
  }, { passive: true });
  // Closing: the shade, Esc, or a swipe back on the door itself.
  shade.addEventListener('click', function () { sideHide(); });
  (function () { var x0 = null; shade.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true }); shade.addEventListener('touchend', function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) >= 60) move(dx < 0 ? 1 : -1); }, { passive: true }); })();
  scroller.addEventListener('scroll', function () { if (sideOpen) sideHide(); }, { passive: true });
  [sideL, sideR].forEach(function (el) {
    if (!el) return; var x0 = null;
    el.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) < 60) return; move(dx < 0 ? 1 : -1); }, { passive: true });
    el.addEventListener('click', function (e) { var b = e.target.closest('[data-sd-switch]'); if (!b) return; sideAs = b.getAttribute('data-sd-switch'); try { localStorage.setItem('wm_side_as', sideAs); } catch (x) {} paintAs(); });
  });
  // Three rooms in a row, Yours · Wander · the Keys (Will, 19 Oct: left, left, right, right, every combination should
  // land somewhere, always easy, always quick): `move(dir)` steps along the row. From Wander, → opens the Keys and ←
  // opens Yours; from an open door, a step back closes it to Wander, and a step further wraps round to the other door.
  // Arrow keys, a sideways trackpad scroll, and a swipe all move the same way.
  function move(dir) {
    var w = items[cur]; if (w) sideFill(w.slug);
    if (!sideOpen) return sideShow(dir > 0 ? 'keys' : 'yours');
    if ((sideOpen === 'keys' && dir < 0) || (sideOpen === 'yours' && dir > 0)) return sideHide();
    var other = sideOpen === 'keys' ? 'yours' : 'keys'; sideHide(); setTimeout(function () { sideShow(other); }, 180);
  }
  document.addEventListener('keydown', function (e) {
    var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape' && sideOpen) { e.preventDefault(); e.stopImmediatePropagation(); sideHide(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); move(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); move(-1); }
  }, true);
  // A sideways scroll on a trackpad: one step per gesture.
  var wx = 0, wT = null, wDone = false;
  addEventListener('wheel', function (e) {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) return;
    clearTimeout(wT); wT = setTimeout(function () { wx = 0; wDone = false; }, 350);
    if (wDone) return; wx += e.deltaX;
    if (Math.abs(wx) > 60) { wDone = true; wx = 0; e.preventDefault(); move(e.deltaX > 0 ? 1 : -1); }
  }, { passive: false });
  root.addEventListener('click', function (e) { var k = e.target.closest('[data-st-doors]'); if (!k) return; var w = items[cur]; if (w) sideFill(w.slug); sideShow(k.getAttribute('data-st-doors')); });
  // A fresh work closes an open door and drops the old answer.
  var sideWatch = setInterval(function () { if (sideOpen) return; var w = items[cur]; if (w && sideFor && sideFor !== w.slug) sideFor = null; }, 800);
  // Staying is what pays (Will, 18 Oct: a feed pays you for moving on; Watermark pays you for staying).
  // Hold still and the plate and the acts fall away, leaving only the picture; stay longer and one line of the
  // guide rises. Racing on earns nothing; once, after a fast run, the next photograph holds and asks you to stay.
  // The chrome on a phone (Will, 18 Oct: the buttons must not take the picture for long; everything there the moment
  // it is wanted). Arriving shows the plate alone (title, maker) for ARR; the acts stay away until a tap calls them,
  // for TAP; moving on sends everything away at once. A swipe never wakes the chrome; only a tap does.
  var TOUCH = matchMedia('(pointer:coarse)').matches, ARR = 2600, TAP = 4000;
  var stillT = null, lineT = null, STILL = TOUCH ? ARR : 6000, LINE = 20000, arrivals = [], sitting = false, sitT = null, SIT = 90000;
  function firstLine(g) { var t = String(g || '').split(/\n{2,}/)[0]; var m = t.match(/^.{20,180}?[.!?](?=\s|$)/); return (m ? m[0] : t.slice(0, 160)).trim(); }
  // Over the chrome (21 Oct, Will: the buttons did weird things under the cursor): while the pointer rests on the rail or
  // the top bar the chrome never fades, so a button is where the hand left it.
  var overChrome = false;
  if (!TOUCH) [].forEach.call(root.querySelectorAll('.st-top'), function (el) { el.addEventListener('pointerenter', function () { overChrome = true; clearTimeout(stillT); root.classList.remove('st-still'); }); el.addEventListener('pointerleave', function () { overChrome = false; quiet(); }); });
  if (!TOUCH) root.addEventListener('pointerover', function (e) { var r = e.target.closest && e.target.closest('.st-rail'); if (r && !overChrome) { overChrome = true; clearTimeout(stillT); root.classList.remove('st-still'); } });
  if (!TOUCH) root.addEventListener('pointerout', function (e) { var r = e.target.closest && e.target.closest('.st-rail'); if (r && !(e.relatedTarget && r.contains(e.relatedTarget))) { overChrome = false; quiet(); } });
  function quiet(ms) { clearTimeout(stillT); root.classList.remove('st-still'); stillT = setTimeout(function () { if (sheet.hidden && !overChrome) { root.classList.add('st-still'); root.classList.remove('st-arr'); } }, sitting ? 1500 : (ms || STILL)); }
  ['touchstart', 'pointermove', 'keydown', 'wheel'].forEach(function (t) { addEventListener(t, function (e) { if (TOUCH && (t === 'touchstart' || t === 'wheel')) return; if (t === 'pointermove' && e.pointerType === 'touch') return; quiet(); }, { passive: true }); });
  if (TOUCH) { var movingT = null; scroller.addEventListener('scroll', function () { if (!movingT) { clearTimeout(stillT); root.classList.add('st-still'); root.classList.remove('st-arr'); } clearTimeout(movingT); movingT = setTimeout(function () { movingT = null; }, 180); }, { passive: true }); }
  var firstArr = true;
  function arrive(slug) {
    // The first screen keeps its bar and acts a few seconds longer, so a newcomer sees Find and Settings exist.
    if (TOUCH && !firstArr) root.classList.add('st-arr');
    quiet(firstArr && TOUCH ? 5000 : undefined); firstArr = false; clearTimeout(lineT);
    var w = items[slug]; if (!w || !w.el) return;
    var gp = document.documentElement.getAttribute('data-guide') || 'hints';
    if (gp !== 'off' && w.guide && !w.el.querySelector('.st-line')) lineT = setTimeout(function () { if (cur !== slug) return; var p = document.createElement('p'); p.className = 'st-line'; p.textContent = firstLine(w.guide); w.el.appendChild(p); requestAnimationFrame(function () { p.classList.add('on'); }); }, sitting ? 9000 : gp === 'full' ? 7000 : LINE);
    if (sitting) { clearTimeout(sitT); sitT = setTimeout(next, SIT); return; }
    var now = Date.now(); arrivals.push(now); arrivals = arrivals.filter(function (t) { return now - t < 60000; });
    var told = false; try { told = sessionStorage.getItem('wm_stay') === '1'; } catch (e) {}
    if (arrivals.length >= 15 && !told) { try { sessionStorage.setItem('wm_stay', '1'); } catch (e) {} hold(); }
  }
  function hold() {
    var st = root.querySelector('[data-st-stay]'); if (!st) return; st.hidden = false; requestAnimationFrame(function () { st.classList.add('on'); });
    scroller.style.overflowY = 'hidden';
    setTimeout(function () { scroller.style.overflowY = ''; st.classList.remove('on'); setTimeout(function () { st.hidden = true; }, 900); }, 3200);
  }
  function next() { scroller.scrollBy({ top: scroller.clientHeight, behavior: 'smooth' }); }
  // Sit: one tap and the stroll becomes a room to sit in. Each photograph held a minute and a half, the guide read
  // in the house voice, quiet music made here (four sines breathing; nothing streamed), the screen kept awake.
  var sitb = root.querySelector('[data-st-sit]'), sitbar = root.querySelector('[data-st-sitbar]'), ac = null, lock = null, wasGuide = false;
  function music(on) {
    try {
      if (!on) { if (ac) { var a = ac; ac = null; a.master.gain.setTargetAtTime(0, a.ctx.currentTime, 1.2); setTimeout(function () { a.ctx.close(); }, 4000); } return; }
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      var ctx = new C(), master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
      [110, 164.81, 220, 277.18].forEach(function (f, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.25 / (i + 1);
        l.frequency.value = 0.05 + i * 0.013; lg.gain.value = 0.12 / (i + 1); l.connect(lg); lg.connect(g.gain);
        o.connect(g); g.connect(master); o.start(); l.start();
      });
      master.gain.setTargetAtTime(0.05, ctx.currentTime, 2.5); ac = { ctx: ctx, master: master };
    } catch (e) { ac = null; }
  }
  function wake() { try { navigator.wakeLock && navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener && l.addEventListener('release', function () { lock = null; }); }).catch(function () {}); } catch (e) {} }
  // The pace (18 Oct, settings): you scroll, or the stroll moves on by itself every 15, 30 or 90 seconds. Sit is the
  // preset: 90 s, the guide read, quiet music. The music and the voice are switches of their own.
  var pace = 0, musicOn = false; try { pace = +localStorage.getItem('wm_stroll_pace') || 0; musicOn = localStorage.getItem('wm_stroll_music') === '1'; } catch (e) {}
  var paceB = root.querySelectorAll('[data-pace]'), musicSw = root.querySelector('[data-st-music]');
  function paintPace() { [].forEach.call(paceB, function (b) { b.setAttribute('aria-pressed', +b.getAttribute('data-pace') === pace ? 'true' : 'false'); }); if (musicSw) musicSw.checked = musicOn; sitting = pace > 0; SIT = (pace || 90) * 1000; root.classList.toggle('st-sit', sitting); if (sitb) sitb.setAttribute('aria-pressed', (pace === 90 && musicOn && guideOn) ? 'true' : 'false'); sitbar.hidden = !sitting; }
  function setPace(p) { pace = p; try { localStorage.setItem('wm_stroll_pace', String(p)); } catch (e) {} paintPace(); clearTimeout(sitT); if (pace > 0) { wake(); if (cur) { sitT = setTimeout(next, SIT); } } else { try { lock && lock.release(); } catch (e) {} lock = null; quiet(); } }
  function setMusic(on) { musicOn = on; try { localStorage.setItem('wm_stroll_music', on ? '1' : '0'); } catch (e) {} if (on && !ac) music(true); if (!on && ac) music(false); paintPace(); }
  function sit(on) {
    if (on) { setPace(90); setMusic(true); if (!guideOn) { guideOn = true; try { localStorage.setItem('wm_stroll_guide', '1'); } catch (e) {} paintGon(); if (items[cur]) guide(items[cur], true); } say('Sit as long as you like. Each one stays a while.', 3200); }
    else { setPace(0); setMusic(false); if (guideOn) { guideOn = false; try { localStorage.setItem('wm_stroll_guide', '0'); } catch (e) {} paintGon(); stopGuide(); } }
    paintPace();
  }
  [].forEach.call(paceB, function (b) { b.addEventListener('click', function () { setPace(+b.getAttribute('data-pace')); say(pace ? 'Moving on every ' + pace + ' seconds.' : 'You scroll.'); }); });
  if (musicSw) musicSw.addEventListener('change', function () { setMusic(musicSw.checked); });
  if (sitb) {
    sitb.addEventListener('click', function () { sit(!(pace === 90 && musicOn && guideOn)); closeSheets(); });
    sitbar.querySelector('[data-st-stand]').addEventListener('click', function () { sit(false); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && sitting && !lock) wake(); });
  }
  paintPace(); if (musicOn) { var once = function () { if (musicOn && !ac) music(true); removeEventListener('touchstart', once); removeEventListener('click', once); }; addEventListener('touchstart', once, { passive: true }); addEventListener('click', once); }
  if (cur) arrive(cur);
  // The guide's setting, the same one as on every photograph's page: Off · Hints · Full.
  function paintG() { var g = document.documentElement.getAttribute('data-guide') || 'hints'; [].forEach.call(root.querySelectorAll('[data-guide-set]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-guide-set') === g ? 'true' : 'false'); }); root.classList.toggle('st-gfull', g === 'full'); }
  // More (21 Oct, the cut): Card, Study and the basket live behind one button; a tap elsewhere on the screen folds it.
  root.addEventListener('click', function (e) { var mb = e.target.closest && e.target.closest('[data-st-more]'); var rail = e.target.closest && e.target.closest('.st-rail'); if (!mb) { if (!rail) [].forEach.call(root.querySelectorAll('[data-st-morebox]:not([hidden])'), function (x) { x.hidden = true; var m = x.parentNode.querySelector('[data-st-more]'); if (m) m.setAttribute('aria-expanded', 'false'); }); return; } var box = mb.parentNode.querySelector('[data-st-morebox]'); if (!box) return; box.hidden = !box.hidden; mb.setAttribute('aria-expanded', box.hidden ? 'false' : 'true'); }, true);
  root.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-guide-set]'); if (!b) return; var g = b.getAttribute('data-guide-set'); document.documentElement.setAttribute('data-guide', g); try { localStorage.setItem('wm_guide', g); } catch (x) {} paintG(); if (g === 'off') [].forEach.call(root.querySelectorAll('.st-line'), function (l) { l.remove(); }); say(g === 'off' ? 'The guide is off. It is always here when you want it.' : g === 'full' ? 'The guide in full.' : 'Hints: a line for those who stay.'); });
  paintG();
  // Settings: a sheet from the top bar (18 Oct). Find is the house's own (find.js), opened from the bar's Find.
  var fsheet = null, ssheet = root.querySelector('[data-st-ssheet]');
  function closeSheets() { if (ssheet) ssheet.hidden = true; root.classList.remove('st-sheet-on'); quiet(); }
  function openSheet(el) { closeSheets(); el.hidden = false; root.classList.add('st-sheet-on'); clearTimeout(stillT); root.classList.remove('st-still', 'st-arr'); }
  var sb = root.querySelector('[data-st-settings]');
  if (sb) sb.addEventListener('click', function () { openSheet(ssheet); });
  [].forEach.call(root.querySelectorAll('[data-st-sx2]'), function (b) { b.addEventListener('click', closeSheets); });
  if (ssheet) ssheet.addEventListener('click', function (e) { if (e.target === ssheet) closeSheets(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ssheet && !ssheet.hidden) { e.stopImmediatePropagation(); closeSheets(); } }, true);
})();
