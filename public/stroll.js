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
  function say(m, ms) { toast.textContent = m; toast.hidden = false; toast.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { toast.classList.remove('on'); setTimeout(function () { toast.hidden = true; }, 400); }, ms || 2200); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var ic = {};
  (function () { var first = scroller.querySelector('.st-i'); if (!first) return; var ey = first.querySelector('[data-eye] svg'); ic.eye = ey ? ey.outerHTML : ''; ['hat', 'bravo', 'hang', 'buy', 'guide', 'card', 'share'].forEach(function (k) { var b = first.querySelector('[data-st-' + k + ']'); if (b) { var svg = b.querySelector('svg'); ic[k] = svg ? svg.outerHTML : ''; } }); ic.collect = ic.buy || (first.querySelector('.st-held svg') || {}).outerHTML || ''; })();

  function register(w, el) { items[w.slug] = w; order.push(w.slug); seen.push(w.slug); w.el = el; }
  S.items.forEach(function (w) { var el = scroller.querySelector('.st-i[data-slug="' + w.slug + '"]'); if (el) register(w, el); });

  function screenFor(w) {
    var el = document.createElement('section'); el.className = 'st-i'; el.setAttribute('data-slug', w.slug);
    el.innerHTML = '<img class="st-im" src="' + esc(w.img) + '" alt="' + esc(w.title) + '" draggable="false" decoding="async" loading="lazy"' + (w.width && w.height ? ' width="' + w.width + '" height="' + w.height + '"' : '') + '>'
      + '<div class="st-plate"><a class="st-by" href="/stroll?maker=' + esc(w.makerSlug) + '&at=' + esc(w.slug) + '" data-st-maker>' + esc(w.maker) + '</a><a class="st-t" href="/m/' + esc(w.makerSlug) + '/' + esc(w.slug) + '">' + esc(w.title) + '</a><span class="st-k">' + (w.place ? '<a href="/stroll?q=' + encodeURIComponent(w.place) + '">' + esc(w.place) + '</a>' : '') + (w.place && w.year ? ' · ' : '') + esc(w.year || '') + '</span></div>'
      + '<button type="button" class="st-eye" data-eye="' + esc(w.slug) + '" aria-label="See the watermark">' + (ic.eye || '') + '</button>'
      + '<nav class="st-rail" aria-label="Acts">'
      + '<button type="button" class="st-b" data-st-hat aria-pressed="' + (w.hat && w.hat.mine ? 'true' : 'false') + '">' + ic.hat + '<span data-st-hat-n>Hat</span></button>'
      + '<button type="button" class="st-b st-bv" data-st-bravo aria-pressed="' + (w.bravo && w.bravo.mine ? 'true' : 'false') + '">' + (ic.bravo || '') + '<span>Bravo</span></button>'
      + '<button type="button" class="st-b" data-st-hang>' + ic.hang + '<span>Hang</span></button>'
      + (w.held ? '<span class="st-b st-held">' + ic.collect + '<span>Yours</span></span>' : w.collect ? '<button type="button" class="st-b st-buy" data-st-buy data-url="' + esc(w.collect.url) + '" data-pocket="' + (w.collect.pocket ? 1 : 0) + '">' + ic.collect + '<span>' + esc(w.collect.price) + '</span></button>' : '')
      + (w.guide ? '<button type="button" class="st-b" data-st-guide>' + ic.guide + '<span>Guide</span></button>' : '')
      + '<button type="button" class="st-b" data-st-card>' + ic.card + '<span>Card</span></button>'
      + '<button type="button" class="st-b" data-st-share>' + ic.share + '<span>Share</span></button></nav>'
      + '<div class="st-hat-fly" aria-hidden="true">' + ic.hat + '</div>';
    return el;
  }
  // More, before the visitor reaches the end.
  function more() {
    if (loading || done) return; loading = true;
    fetch('/api/stroll?n=8&q=' + encodeURIComponent(q) + '&maker=' + encodeURIComponent(maker) + (set ? '&in=' + encodeURIComponent(set.key) : '') + '&seen=' + encodeURIComponent(seen.slice(-300).join(','))).then(function (r) { return r.json(); }).then(function (j) {
      var list = (j && j.items) || [];
      if (set && (j.end || !list.length)) { done = true; setTimeout(function () { var e = document.createElement('section'); e.className = 'st-i st-none st-end'; e.innerHTML = '<p>That is all of ' + esc(set.label.replace(/^The /, 'the ')) + '.</p><a href="' + esc(set.href) + '">Back to it</a><a href="/stroll">Stroll everything</a>'; scroller.appendChild(e); }, 0); }
      else if (!list.length) { done = true; return; }
      list.forEach(function (w) { if (items[w.slug]) return; var el = screenFor(w); scroller.appendChild(el); register(w, el); io.observe(el); });
    }).catch(function () {}).then(function () { loading = false; });
  }
  // Which photograph is before you now; the one before it is told to the house.
  function stood(slug, s) { if (!slug || s < 2) return; try { navigator.sendBeacon('/w/' + slug + '/stood', JSON.stringify({ v: V, s: s })); } catch (e) {} }
  function prefetch(i) { for (var k = 1; k <= 3; k++) { var w = items[order[i + k]]; if (w && !w.pre) { w.pre = new Image(); w.pre.src = w.img; } } }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting || e.intersectionRatio < 0.6) return;
      var slug = e.target.getAttribute('data-slug'); if (slug === cur) return;
      if (cur) stood(cur, Math.round((Date.now() - since) / 1000));
      cur = slug; since = Date.now();
      var i = order.indexOf(slug); prefetch(i); if (i >= order.length - 4) more();
      try { history.replaceState(null, '', '/stroll?at=' + slug + (set ? '&in=' + encodeURIComponent(set.key) : '') + (q ? '&q=' + encodeURIComponent(q) : '') + (maker ? '&maker=' + encodeURIComponent(maker) : '')); } catch (x) {}
      stopGuide(true); if (guideOn && items[slug] && items[slug].guide) setTimeout(function () { if (cur === slug) guide(items[slug], true); }, 500);
      arrive(slug);
    });
  }, { root: scroller, threshold: [0.6] });
  order.forEach(function (s) { io.observe(items[s].el); });
  if (order.length < 6) more();
  addEventListener('pagehide', function () { if (cur) stood(cur, Math.round((Date.now() - since) / 1000)); });

  // The acts.
  function hat(w, fly) {
    var b = w.el.querySelector('[data-st-hat]'), n = w.el.querySelector('[data-st-hat-n]');
    if (fly) { var f = w.el.querySelector('.st-hat-fly'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); try { navigator.vibrate && navigator.vibrate(12); } catch (x) {} }
    if (fly && w.hat && w.hat.mine) return; // a double-tap never takes a hat back
    fetch('/w/' + w.slug + '/applaud', { method: 'POST', headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) return; w.hat = { n: j.n, mine: !!j.mine }; b.setAttribute('aria-pressed', j.mine ? 'true' : 'false'); // no numbers on the wall
    }).catch(function () {});
  }
  // Bravo: the standing ovation, a few a month. Gold flecks from the button, the phone answers, the maker is told.
  function bravo(w, b) {
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
  function checkout(w) { var f = document.createElement('form'); f.method = 'post'; f.action = w.collect.url + '?back=' + encodeURIComponent('/stroll?at=' + w.slug); f.innerHTML = '<input type="hidden" name="use" value="social">'; document.body.appendChild(f); f.submit(); }
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
  var sheet = root.querySelector('[data-st-guide-sheet]'), gt = root.querySelector('[data-st-gt]'), gby = root.querySelector('[data-st-gby]'), audio = null, Sy = window.speechSynthesis;
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
  function paintGon() { gon.setAttribute('aria-pressed', guideOn ? 'true' : 'false'); }
  paintGon();
  gon.addEventListener('click', function () { guideOn = !guideOn; try { localStorage.setItem('wm_stroll_guide', guideOn ? '1' : '0'); } catch (e) {} paintGon(); if (guideOn && items[cur]) guide(items[cur], true); else stopGuide(); say(guideOn ? 'The guide will read each one.' : 'Guide off.'); });
  // A swipe sideways on the picture opens the maker's own stroll (left), or returns to everything (right).
  var sx0 = null, sy0 = null;
  scroller.addEventListener('touchstart', function (e) { if (e.target.closest('button, a')) { sx0 = null; return; } sx0 = e.touches[0].clientX; sy0 = e.touches[0].clientY; }, { passive: true });
  scroller.addEventListener('touchend', function (e) { if (sx0 == null) return; var dx = e.changedTouches[0].clientX - sx0, dy = e.changedTouches[0].clientY - sy0; sx0 = null; if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.7) return; var w = items[cur]; if (!w) return; if (dx < 0 && !maker) location.href = '/stroll?maker=' + encodeURIComponent(w.makerSlug) + '&at=' + encodeURIComponent(w.slug); else if (dx > 0 && maker) location.href = '/stroll?at=' + encodeURIComponent(w.slug); }, { passive: true });
  // Staying is what pays (Will, 18 Oct: a feed pays you for moving on; Watermark pays you for staying).
  // Hold still and the plate and the acts fall away, leaving only the picture; stay longer and one line of the
  // guide rises. Racing on earns nothing; once, after a fast run, the next photograph holds and asks you to stay.
  // The chrome on a phone (Will, 18 Oct: the buttons must not take the picture for long; everything there the moment
  // it is wanted). Arriving shows the plate alone (title, maker) for ARR; the acts stay away until a tap calls them,
  // for TAP; moving on sends everything away at once. A swipe never wakes the chrome; only a tap does.
  var TOUCH = matchMedia('(pointer:coarse)').matches, ARR = 2600, TAP = 4000;
  var stillT = null, lineT = null, STILL = TOUCH ? ARR : 6000, LINE = 20000, arrivals = [], sitting = false, sitT = null, SIT = 90000;
  function firstLine(g) { var t = String(g || '').split(/\n{2,}/)[0]; var m = t.match(/^.{20,180}?[.!?](?=\s|$)/); return (m ? m[0] : t.slice(0, 160)).trim(); }
  function quiet(ms) { clearTimeout(stillT); root.classList.remove('st-still'); stillT = setTimeout(function () { if (sheet.hidden) { root.classList.add('st-still'); root.classList.remove('st-arr'); } }, sitting ? 1500 : (ms || STILL)); }
  ['touchstart', 'pointermove', 'keydown', 'wheel'].forEach(function (t) { addEventListener(t, function (e) { if (TOUCH && (t === 'touchstart' || t === 'wheel')) return; if (t === 'pointermove' && e.pointerType === 'touch') return; quiet(); }, { passive: true }); });
  if (TOUCH) { var movingT = null; scroller.addEventListener('scroll', function () { if (!movingT) { clearTimeout(stillT); root.classList.add('st-still'); root.classList.remove('st-arr'); } clearTimeout(movingT); movingT = setTimeout(function () { movingT = null; }, 180); }, { passive: true }); }
  function arrive(slug) {
    if (TOUCH) root.classList.add('st-arr');
    quiet(); clearTimeout(lineT);
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
  function sit(on) {
    if (!sitb) return;
    sitting = on; root.classList.toggle('st-sit', on); sitb.setAttribute('aria-pressed', on ? 'true' : 'false'); sitbar.hidden = !on;
    clearTimeout(sitT); music(on);
    if (on) { wasGuide = guideOn; guideOn = true; if (items[cur]) { guide(items[cur], true); arrive(cur); } wake(); }
    else { guideOn = wasGuide; if (!guideOn) stopGuide(); try { lock && lock.release(); } catch (e) {} lock = null; quiet(); }
  }
  if (sitb) {
    sitb.addEventListener('click', function () { sit(!sitting); if (sitting) say('Sit as long as you like. Each one stays a while.', 3200); });
    sitbar.querySelector('[data-st-stand]').addEventListener('click', function () { sit(false); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && sitting && !lock) wake(); });
  }
  if (cur) arrive(cur);
  // The guide's setting, the same one as on every photograph's page: Off · Hints · Full.
  function paintG() { var g = document.documentElement.getAttribute('data-guide') || 'hints'; [].forEach.call(root.querySelectorAll('[data-guide-set]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-guide-set') === g ? 'true' : 'false'); }); root.classList.toggle('st-gfull', g === 'full'); }
  root.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-guide-set]'); if (!b) return; var g = b.getAttribute('data-guide-set'); document.documentElement.setAttribute('data-guide', g); try { localStorage.setItem('wm_guide', g); } catch (x) {} paintG(); if (g === 'off') [].forEach.call(root.querySelectorAll('.st-line'), function (l) { l.remove(); }); say(g === 'off' ? 'The guide is off. It is always here when you want it.' : g === 'full' ? 'The guide in full.' : 'Hints: a line for those who stay.'); });
  paintG();
  // Find: a word strolls through one place, one maker, one subject.
  var form = root.querySelector('[data-st-search]'), sx = root.querySelector('[data-st-sx]'), inp = form.querySelector('input');
  sx.addEventListener('click', function () { root.classList.add('st-find'); inp.focus(); });
  inp.addEventListener('blur', function () { if (!inp.value) root.classList.remove('st-find'); });
  if (q) root.classList.add('st-find');
})();
