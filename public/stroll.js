/* The stroll: one photograph at a time, edge to edge, a swipe to the next; endless, never the same twice. Double-tap zooms in; the hat is on the rail. Old line: Double-tap tips
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
  (function () { var first = scroller.querySelector('.st-i'); if (!first) return; var ey = first.querySelector('[data-eye] svg'); ic.eye = ey ? ey.outerHTML : ''; ['hat', 'bravo', 'hang', 'buy', 'guide', 'card', 'easel', 'share', 'more', 'settings', 'record'].forEach(function (k) { var b = first.querySelector('[data-st-' + k + ']'); if (b) { var svg = b.querySelector('svg'); ic[k] = svg ? svg.outerHTML : ''; } }); ic.page = ic.record || ''; ic.collect = ic.buy || (first.querySelector('.st-held svg') || {}).outerHTML || ''; })();
  ['wave', 'play', 'pause'].forEach(function (k) { var t = root.querySelector('template[data-st-ic="' + k + '"]'); if (t) ic[k] = t.innerHTML; });

  function register(w, el) { items[w.slug] = w; order.push(w.slug); seen.push(w.slug); w.el = el; }
  S.items.forEach(function (w) { var el = scroller.querySelector('.st-i[data-slug="' + w.slug + '"]'); if (el) register(w, el); });

  function screenFor(w) {
    var el = document.createElement('section');
    if (w.kind === 'record') {
      el.className = 'st-i st-rec'; el.setAttribute('data-slug', w.slug); el.setAttribute('data-kind', 'record');
      el.innerHTML = '<article class="st-rc"><a class="st-rdisc" href="' + esc(w.href) + '"><img src="' + esc(w.img) + '" alt="" loading="lazy"></a><p class="k">From the Listening Room</p><h2>' + esc(w.title) + '</h2><p class="st-rby">' + esc(w.by) + (w.composer ? ' · ' + esc(w.composer) : '') + (w.year ? ' · ' + esc(w.year) : '') + '</p>' + (w.line ? '<p class="st-rline">' + esc(w.line) + '</p>' : '') + '<div class="st-racts"><button type="button" class="st-rplay" data-st-rplay data-src="' + esc(w.url) + '">' + (ic.play || '') + (ic.pause || '') + '<span>Play ' + esc(w.side) + '</span></button><a class="st-rgo" href="' + esc(w.href) + '">Into the room' + (w.n > 1 ? ' · ' + w.n + ' sides' : '') + '</a></div></article>';
      return el;
    }
    if (w.kind === 'text') {
      el.className = 'st-i st-txt'; el.setAttribute('data-slug', w.slug); el.setAttribute('data-kind', 'text');
      el.innerHTML = '<a class="st-bk" href="/read/' + esc(w.book) + '" style="--cloth:' + esc(w.cloth || '#2f4a3a') + '">' + (w.cover ? '<img src="' + esc(w.cover) + '" alt="">' : '<span class="st-bkc"><i></i><b>' + esc(w.title) + '</b>' + (w.author ? '<small>' + esc(w.author) + '</small>' : '') + '<i></i></span>') + '</a><article class="st-tx"><p class="k">From the shelf</p><h2>' + esc(w.title) + '</h2>' + (w.author ? '<p class="st-txa">' + esc(w.author) + '</p>' : '') + (w.head ? '<p class="st-txh">' + esc(w.head) + '</p>' : '') + '<div class="st-txb">' + (w.excerpt || []).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div><a class="st-txgo" href="' + esc(w.href) + '">Read on' + (w.n ? ' · ' + w.n + ' chapters' : '') + '</a></article>';
      return el;
    }
    el.className = 'st-i'; el.setAttribute('data-slug', w.slug);
    el.innerHTML = '<img class="st-im" src="' + esc(w.img) + '" alt="' + esc(w.title) + '" draggable="false" decoding="async" loading="lazy"' + (w.width && w.height ? ' width="' + w.width + '" height="' + w.height + '"' : '') + '>'
      + '<div class="st-plate"><a class="st-by" href="/wander?maker=' + esc(w.makerSlug) + '&at=' + esc(w.slug) + '" data-st-maker>' + esc(w.maker) + '</a><a class="st-t" href="/m/' + esc(w.makerSlug) + '/' + esc(w.slug) + '?from=wander">' + esc(w.title) + '</a><span class="st-k">' + (w.place ? '<a href="/wander?q=' + encodeURIComponent(w.place) + '">' + esc(w.place) + '</a>' : '') + (w.place && w.year ? ' · ' : '') + esc(w.year || '') + '</span><a class="st-tog" href="/m/' + esc(w.makerSlug) + '/' + esc(w.slug) + '?from=wander" title="Watermark: the record under the picture; the guide, the papers, the prices, the provenance"><b>' + (ic.wave || '') + 'Wander</b><span>' + (ic.page || '') + 'Watermark</span></a></div>'
      + '<button type="button" class="st-eye" data-eye="' + esc(w.slug) + '" aria-label="See the watermark">' + (ic.eye || '') + '</button>'
      + '<nav class="st-rail" aria-label="Acts">'
      + '<button type="button" class="st-b" data-st-hat aria-pressed="' + (w.hat && w.hat.mine ? 'true' : 'false') + '" title="Hat: a nod, I saw it. Free, as many as you like.">' + ic.hat + '<span data-st-hat-n>Hat</span></button>'
      + '<button type="button" class="st-b st-bv" data-st-bravo aria-pressed="' + (w.bravo && w.bravo.mine ? 'true' : 'false') + '" title="Bravo: it floored me. Three a month.">' + (ic.bravo || '') + '<span>Bravo</span></button>'
      + '<button type="button" class="st-b" data-st-hang title="Save it to a wall of yours, like a pin. Find it again in Yours.">' + ic.hang + '<span>Save</span></button>'
      + '<button type="button" class="st-b" data-st-share title="Send it to someone.">' + ic.share + '<span>Share</span></button>'
      + '<button type="button" class="st-b st-moreb" data-st-more aria-expanded="false" aria-label="More">' + (ic.more || '') + '<span>More</span></button>'
      + '<div class="st-more" data-st-morebox hidden>'
      + '<a class="st-b" data-st-record href="/m/' + esc(w.makerSlug) + '/' + esc(w.slug) + '?from=wander" title="Watermark: the record under the picture; the guide, the papers, the prices, the provenance.">' + (ic.page || '') + '<span>Watermark</span></a>'
      + (w.guide ? '<button type="button" class="st-b" data-st-guide title="Look closer: what to see in it, read by Al.">' + ic.guide + '<span>Look closer</span></button>' : '')
      + '<a class="st-b" data-st-easel href="/easel/' + esc(w.slug) + '?back=' + encodeURIComponent('/wander?at=' + w.slug) + '" title="Draw it: the picture alone, with the easel\'s tools.">' + (ic.easel || '') + '<span>Draw</span></a>'
      + '<button type="button" class="st-b" data-st-card title="A thank-you card to the maker, from 99¢.">' + ic.card + '<span>Thank</span></button><button type="button" class="st-b" data-st-settings title="Sit a while: each work held a minute and a half, the guide read, quiet music.">' + (ic.settings || '') + '<span>Sit</span></button></div>'
      + (w.held ? '<span class="st-b st-held">' + ic.collect + '<span>Yours</span></span>' : w.collect ? '<button type="button" class="st-b st-buy" data-st-buy data-url="' + esc(w.collect.url) + '" data-pocket="' + (w.collect.pocket ? 1 : 0) + '" title="Collect it: yours to keep, numbered, with the papers. ' + esc(w.collect.price) + '.">' + ic.collect + '<span>Collect<b>' + esc(w.collect.price) + '</b></span><em>Yours to keep</em></button>' : '')
      + '</nav>'
      + '<div class="st-hat-fly" aria-hidden="true">' + ic.hat + '</div>';
    try { var im0 = el.querySelector('.st-im'); if (window.WMTrue && im0) { WMTrue.cap(im0); im0.addEventListener('load', function () { WMTrue.cap(im0); }, { once: true }); } } catch (e) { /* true size */ }
    return el;
  }
  // The pack (Will, 23 Oct: "you need to be able to wander in the subway", like Spotify; "lost connection, restored
  // connection", so people feel their work is always there). Forty works are kept on this phone: their records in
  // localStorage, their pictures in the app's cache, warmed one at a time while the signal is good. When the feed cannot
  // be reached the next screens come from the pack, and the room says so once; when the house answers again it says that too.
  var PACK_N = 40, pack = [], packing = false, offline = false, packedAt = 0;
  try { var pk0 = JSON.parse(localStorage.getItem('wm_pack') || '{}'); pack = pk0.items || []; packedAt = pk0.at || 0; } catch (e) { pack = []; }
  function strip(w) { var o = {}; for (var k in w) if (k !== 'el' && k !== 'pre' && Object.prototype.hasOwnProperty.call(w, k)) o[k] = w[k]; return o; }
  function savePack() { try { localStorage.setItem('wm_pack', JSON.stringify({ at: Date.now(), items: pack.slice(0, PACK_N) })); } catch (e) { /* full */ } }
  function warm(i) { var w = pack[i]; if (!w) return; if (!w.img) { warm(i + 1); return; } fetch(w.img, { credentials: 'same-origin' }).catch(function () {}).then(function () { setTimeout(function () { warm(i + 1); }, 900); }); }
  function packUp() {
    if (packing || q || maker || set || !navigator.onLine) return; if (pack.length >= PACK_N && Date.now() - packedAt < 6 * 3600000) { warm(0); return; }
    packing = true;
    fetch('/api/stroll?n=' + PACK_N + '&seen=').then(function (r) { return r.json(); }).then(function (j) { var list = (j && j.items) || []; if (!list.length) return; pack = list.map(strip); packedAt = Date.now(); savePack(); warm(0); }).catch(function () {}).then(function () { packing = false; });
  }
  function fromPack(n) { var out = []; for (var i = 0; i < pack.length && out.length < n; i++) if (!items[pack[i].slug]) out.push(pack[i]); return out; }
  function lost() { if (offline) return; offline = true; say(pack.length ? 'No connection. Wandering what you brought with you.' : 'No connection. The house will be back.', 3200); }
  function found() { if (!offline) return; offline = false; say('Connected again.', 2000); if (!done) more(); }
  addEventListener('online', found); addEventListener('offline', lost);
  var hadNet = false;
  // More, before the visitor reaches the end.
  function more() {
    if (loading || done) return; loading = true; if (window.WMWave) WMWave.show();
    fetch('/api/stroll?n=8&q=' + encodeURIComponent(q) + '&maker=' + encodeURIComponent(maker) + (set ? '&in=' + encodeURIComponent(set.key) : '') + '&seen=' + encodeURIComponent(seen.slice(-300).join(','))).then(function (r) { if (!r.ok) throw new Error('no feed'); return r.json(); }).then(function (j) {
      if (hadNet) found(); hadNet = true;
      var list = (j && j.items) || [];
      if (set && (j.end || !list.length)) { done = true; setTimeout(function () { var e = document.createElement('section'); e.className = 'st-i st-none st-end'; e.innerHTML = '<p>That is all of ' + esc(set.label.replace(/^The /, 'the ')) + '.</p><a href="' + esc(set.href) + '">Back to it</a><a href="/wander">Wander everything</a>'; scroller.appendChild(e); }, 0); }
      else if (!list.length) { done = true; return; }
      list.forEach(function (w) { if (items[w.slug]) return; var el = screenFor(w); scroller.appendChild(el); register(w, el); io.observe(el); });
      if (!packing && !pack.length) setTimeout(packUp, 1500);
    }).catch(function () {
      // The house cannot be reached: the pack, if there is one.
      if (!set) { var list = fromPack(8); lost(); list.forEach(function (w) { var el = screenFor(w); scroller.appendChild(el); register(w, el); io.observe(el); }); }
    }).then(function () { loading = false; if (window.WMWave) WMWave.hide(); });
  }
  // Opened with no signal (the room itself kept by the app): what hangs comes from the pack.
  if (!navigator.onLine && pack.length && !set) { var open0 = fromPack(8); if (open0.length) { scroller.querySelectorAll('.st-i').forEach(function (el) { el.remove(); }); items = {}; order = []; seen = []; open0.forEach(function (w) { var el = screenFor(w); scroller.appendChild(el); register(w, el); }); lost(); } }
  setTimeout(packUp, 8000);
  // Which photograph is before you now; the one before it is told to the house.
  function stood(slug, s) { if (!slug || s < 2 || /^[tr]:/.test(slug)) return; try { navigator.sendBeacon('/w/' + slug + '/stood', JSON.stringify({ v: V, s: s })); } catch (e) {} }
  function prefetch(i) { for (var k = 1; k <= 3; k++) { var w = items[order[i + k]]; if (w && w.img && !w.pre) { w.pre = new Image(); w.pre.src = w.img; } } }
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
      if (Z.on) zEnd(false);
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
    // From an album (a delivery), the card carries the album's token so a kept-back photograph may be thanked for, and
    // the card page is the album's own.
    var via = S.set && S.set.via ? S.set.via : '', home = via ? '/deliver/' + via + '#thanks' : '/w/' + w.slug + '/thanks';
    fetch('/w/' + w.slug + '/thanks', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'amount=99&json=1' + (via ? '&via=' + encodeURIComponent(via) : '') }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { say('A card sent to ' + w.maker.split(' ')[0] + ', 99\u00a2.'); try { navigator.vibrate && navigator.vibrate(12); } catch (x) {} }
      else location.href = (j && j.go) || home;
    }).catch(function () { location.href = home; });
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
  // The first Save explains itself once (24 Oct: the buttons must get people to do things; each says what it gets you).
  root.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-st-hang]'); if (!b) return; try { if (localStorage.getItem('wm_save_told')) return; localStorage.setItem('wm_save_told', '1'); } catch (x) { return; } setTimeout(function () { say('Saved to a wall of yours. Find it again in Yours, any time.', 3600); }, 900); });
  // A tap rests or calls the chrome; a double-tap zooms in on the spot, as in every photo app (24 Oct, Will: zooming
  // was not happening; the double-tap had been the hat, so a pinch's two lifts read as one). The hat is on the rail.
  var lastTap = 0, tapT = null, tapX = 0, tapY = 0;
  scroller.addEventListener('pointerup', function (e) {
    if (e.pointerType === 'touch' && Date.now() - Z.at < 400) return; // the end of a pinch or a pan is not a tap
    if (e.target.closest('button, a')) return; var it = e.target.closest('.st-i'); if (!it) return;
    var now = Date.now();
    if (now - lastTap < 320 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 40) { clearTimeout(tapT); lastTap = 0; zTap(it, e.clientX, e.clientY); return; }
    lastTap = now; tapX = e.clientX; tapY = e.clientY; tapT = setTimeout(function () {
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
    if (e.key === 'l' || e.key === 'L') { hold(!held); return; }
    if (held && (e.key === 'Escape')) { hold(false); return; }
    if (held && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k' || e.key === ' ')) { e.preventDefault(); return; }
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
  // Pinch (Will, 23 Oct, with the Duo in hand: "you need to be able to zoom and pinch inside Wander"): two fingers on
  // the photograph scale it about the pinch, up to five times; one finger then pans; a tap sets it back; while zoomed
  // the chrome rests and the scroll is held, so the next photograph waits. The browser's own page zoom never fires.
  var Z = { on: false, s: 1, x: 0, y: 0, img: null, d0: 0, s0: 1, mx: 0, my: 0, px: 0, py: 0, pan: null, at: 0, held: false };
  function zApply(anim) { if (!Z.img) return; Z.img.style.transition = anim ? 'transform .35s cubic-bezier(.2,.8,.2,1)' : 'none'; Z.img.style.transform = Z.s > 1.001 ? 'translate(' + Z.x + 'px,' + Z.y + 'px) scale(' + Z.s + ')' : ''; }
  // Kept on the screen: the scaled picture never leaves a gap at an edge it could fill, and centres when it is smaller.
  function zClamp() { if (!Z.img) return; var W = innerWidth, H = innerHeight, B = Z.base || { x: 0, y: 0 }; var w = Z.img.offsetWidth * Z.s, h = Z.img.offsetHeight * Z.s; var left = B.x - Z.mx * (Z.s - 1) + Z.x, top = B.y - Z.my * (Z.s - 1) + Z.y; var nl = Math.max(Math.min(0, W - w), Math.min(0, left)), nt = Math.max(Math.min(0, H - h), Math.min(0, top)); if (w <= W) nl = (W - w) / 2; if (h <= H) nt = (H - h) / 2; Z.x += nl - left; Z.y += nt - top; }
  // The picture under the fingers: the current screen's image, the large copy swapped in for the detail.
  function zPick() {
    var w = items[cur]; var img = w && w.el && w.el.querySelector('.st-im'); if (!img) return null;
    if (Z.img && Z.img !== img) { Z.img.style.transform = ''; Z.img.style.transition = ''; Z.s = 1; Z.x = 0; Z.y = 0; }
    if (!img.__wmBig && /\/screen(\?|$)/.test(img.getAttribute('src') || '')) { img.__wmBig = 1; var big = new Image(); big.onload = function () { img.src = big.src; }; big.src = img.getAttribute('src').replace(/\/screen(\?|$)/, '/large$1'); }
    if (Z.img !== img) { var r = img.getBoundingClientRect(); Z.base = { x: r.left, y: r.top }; }
    Z.img = img; return img;
  }
  function zOrigin(cx, cy) { var r = Z.img.getBoundingClientRect(); if (Z.s <= 1.001) { Z.mx = cx - r.left; Z.my = cy - r.top; Z.img.style.transformOrigin = Z.mx + 'px ' + Z.my + 'px'; var r2 = Z.img.getBoundingClientRect(); Z.base = { x: r2.left, y: r2.top }; } }
  // Held: the zoom stays after the fingers lift (Will, 24 Oct: it must zoom like a photo app); one finger pans; a
  // double-tap, a pinch back under 1.08, or moving on sets it to rights.
  function zHold(moved) { Z.held = Z.s > 1.08; if (moved !== false) Z.at = Date.now(); if (!Z.held) { zEnd(true); return; } Z.on = true; Z.pan = null; root.classList.add('st-zoom'); try { if (!localStorage.getItem('wm_zoom_told')) { localStorage.setItem('wm_zoom_told', '1'); say('Zoomed. One finger moves around; a flick, a double-tap or a pinch back lets go.', 3600); } } catch (e) { /* */ } }
  function zEnd(anim) { Z.s = 1; Z.x = 0; Z.y = 0; zApply(anim !== false); root.classList.remove('st-zoom'); Z.on = false; Z.held = false; Z.pan = null; Z.at = Date.now(); var im = Z.img; setTimeout(function () { if (im && (Z.img !== im || Z.s <= 1.001)) { im.style.transform = ''; im.style.transition = ''; } }, 400); }
  function zTap(it, cx, cy) { var img = zPick(); if (!img) return; if (Z.s > 1.08) { zEnd(true); return; } zOrigin(cx, cy); Z.s = 2.5; Z.x = 0; Z.y = 0; zClamp(); zApply(true); zHold(); }
  scroller.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
      var img = zPick(); if (!img) return;
      var a = e.touches[0], b = e.touches[1]; Z.d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1; Z.s0 = Z.s;
      zOrigin((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      Z.px = (a.clientX + b.clientX) / 2; Z.py = (a.clientY + b.clientY) / 2; Z.on = true; Z.pan = null; root.classList.add('st-zoom'); sx0 = null; e.preventDefault(); return;
    }
    if (Z.on && e.touches.length === 1) { Z.pan = { x: e.touches[0].clientX - Z.x, y: e.touches[0].clientY - Z.y, t: Date.now(), x0: e.touches[0].clientX, y0: e.touches[0].clientY, stuck: 0 }; Z.d0 = 0; sx0 = null; e.preventDefault(); return; }
    if (e.touches.length !== 1 || e.target.closest('button, a, input')) { sx0 = null; return; }
    if (held) { sx0 = null; if (!e.target.closest('.st-hld')) e.preventDefault(); return; }
    sx0 = e.touches[0].clientX; sy0 = e.touches[0].clientY; sLock = null; sEl = null; sT0 = Date.now(); sTop0 = scroller.scrollTop; sMoved = false;
  }, { passive: false });
  scroller.addEventListener('touchmove', function (e) {
    if (Z.on) {
      e.preventDefault();
      if (e.touches.length >= 2) { var a = e.touches[0], b = e.touches[1], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); Z.s = Math.max(1, Math.min(6, Z.s0 * d / Z.d0)); var cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2; Z.x += cx - Z.px; Z.y += cy - Z.py; Z.px = cx; Z.py = cy; zClamp(); zApply(false); }
      else if (Z.pan && e.touches.length === 1) { var wantY = e.touches[0].clientY - Z.pan.y; Z.x = e.touches[0].clientX - Z.pan.x; Z.y = wantY; zClamp(); Z.pan.stuck = Math.max(Z.pan.stuck || 0, Math.abs(wantY - Z.y)); zApply(false); }
      return;
    }
    if (held) { e.preventDefault(); return; }
    if (sx0 == null) return; var dx = e.touches[0].clientX - sx0, dy = e.touches[0].clientY - sy0;
    if (!sLock) { if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; sLock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (sLock === 'x') { var w = items[cur]; if (w) sideFill(w.slug); sEl = dx < 0 ? sideR : sideL; sBase = sideW(sEl); sEl.classList.add('on'); shade.hidden = false; } }
    if (sLock === 'y' && OWN) { e.preventDefault(); sMoved = true; if (!sManual) { sManual = true; scroller.style.scrollSnapType = 'none'; } scroller.scrollTop = sTop0 - dy; return; }
    if (sLock !== 'x' || !sEl) return;
    e.preventDefault();
    var open = sEl === sideR ? Math.max(0, Math.min(sBase, -dx)) : Math.max(0, Math.min(sBase, dx)); sX = open;
    sideSet(sEl, sEl === sideR ? sBase - open : open - sBase, false);
    shade.style.opacity = String(0.6 * open / sBase);
  }, { passive: false });
  // iOS's own pinch events, a second road: when the two touches were taken by the page (a pinch that began as a scroll),
  // the gesture still reports its scale, and the page's own zoom is refused.
  (function () {
    var g0 = 1, gx = 0, gy = 0;
    scroller.addEventListener('gesturestart', function (e) { e.preventDefault(); if (Z.on && Z.d0) return; var img = zPick(); if (!img) return; g0 = Z.s; gx = e.clientX; gy = e.clientY; zOrigin(gx, gy); Z.on = true; Z.pan = null; root.classList.add('st-zoom'); Z.d0 = 0; }, { passive: false });
    scroller.addEventListener('gesturechange', function (e) { e.preventDefault(); if (!Z.on || Z.d0) return; Z.s = Math.max(1, Math.min(6, g0 * e.scale)); Z.x += e.clientX - gx; Z.y += e.clientY - gy; gx = e.clientX; gy = e.clientY; zClamp(); zApply(false); }, { passive: false });
    scroller.addEventListener('gestureend', function (e) { e.preventDefault(); if (!Z.on || Z.d0) return; zHold(); }, { passive: false });
  })();
  scroller.addEventListener('touchcancel', function () { if (Z.on) { Z.d0 = 0; zHold(); } }, { passive: true });
  scroller.addEventListener('touchend', function (e) {
    if (Z.on) {
      if (e.touches.length >= 2) return;
      if (e.touches.length === 1) { Z.pan = { x: e.touches[0].clientX - Z.x, y: e.touches[0].clientY - Z.y, t: Date.now(), x0: e.touches[0].clientX, y0: e.touches[0].clientY }; Z.s0 = Z.s; return; }
      // The last finger lifts: the zoom holds where it is (a pinch back under 1.08 sets it to rights). A pan that did not move is a tap.
      // A flick, or a drag that went on past the picture's edge, lets the zoom go and moves on (24 Oct: a held zoom had no way out but a pinch).
      if (Z.pan) { var dyz = e.changedTouches[0].clientY - Z.pan.y0, dtz = Date.now() - Z.pan.t; var flick = Math.abs(dyz) > 70 && Math.abs(dyz) / Math.max(1, dtz) > 0.6; var past = Z.pan.stuck > 60; if (Z.d0 === 0 && (flick || past)) { zEnd(true); scroller.scrollTo({ top: Math.round(scroller.scrollTop / scroller.clientHeight) * scroller.clientHeight + (dyz < 0 ? 1 : -1) * scroller.clientHeight, behavior: 'smooth' }); Z.pan = null; return; } }
      var moved = !Z.pan || Math.hypot(e.changedTouches[0].clientX - Z.pan.x0, e.changedTouches[0].clientY - Z.pan.y0) > 8; Z.d0 = 0; zHold(moved); return;
    }
    if (sx0 == null) return; var dx = e.changedTouches[0].clientX - sx0, dyE = e.changedTouches[0].clientY - sy0, dtE = Date.now() - sT0; var lock = sLock, el = sEl; sx0 = null; sLock = null; sEl = null;
    if (lock === 'y' && OWN && sManual) { settle(dyE, dtE); return; }
    if (lock !== 'x' || !el) return;
    shade.style.opacity = '';
    if (sX > sBase * 0.3 || Math.abs(dx) > 90) sideShow(el === sideR ? 'keys' : 'yours'); else { sideSet(el, el === sideR ? sBase : -sBase, true); el.classList.remove('on'); shade.hidden = !sideOpen; }
  }, { passive: true });
  // Settle (24 Oct): after a one-finger drag the wall goes to the next screen, the one before, or stays, by how far and
  // how fast; native snap is handed back once it has arrived, so wheel and keys scroll as they always did.
  var OWN = matchMedia('(pointer:coarse)').matches, sT0 = 0, sTop0 = 0, sMoved = false, sManual = false, settleT = null;
  function settle(dy, dt) {
    var h = scroller.clientHeight, v = dy / Math.max(1, dt); var dir = 0;
    if (Math.abs(dy) > h * 0.18 || Math.abs(v) > 0.45) dir = dy < 0 ? 1 : -1;
    var target = Math.max(0, Math.round(sTop0 / h) * h + dir * h);
    scroller.scrollTo({ top: target, behavior: 'smooth' });
    clearTimeout(settleT); settleT = setTimeout(function () { scroller.scrollTop = target; scroller.style.scrollSnapType = ''; sManual = false; }, 420);
  }
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
    else if (held && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); e.stopImmediatePropagation(); }
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
  // The turntable (Will, 25 Oct: "keep playing music throughout the wander experience; keep serving songs if someone
  // starts playing from a thing"): a record started from a screen keeps playing through the whole wander, side after
  // side, and when it ends the next record on the shelf follows, as the Listening Room does; a small bar (`.st-tt`)
  // shows what is on with pause, next and ×; where you were is kept (sessionStorage `wm_tt`), so leaving Wander for
  // a work and coming back resumes at the same second on the first touch. Moving on never lifts the needle now.
  var TT = { a: null, rec: null, i: 0, list: null, bar: null, want: false };
  function ttList() { if (TT.list) return Promise.resolve(TT.list); return fetch('/api/listening', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) { TT.list = (j.records || []).filter(function (r) { return r.tracks && r.tracks.length; }); return TT.list; }).catch(function () { return []; }); }
  function ttAudio() { if (TT.a) return TT.a; var a = new Audio(); a.preload = 'auto'; a.addEventListener('ended', function () { ttNext(); }); a.addEventListener('play', function () { TT.want = false; ttPaint(); }); a.addEventListener('pause', ttPaint); a.addEventListener('timeupdate', ttKeep); TT.a = a; return a; }
  function ttSide(i, t) {
    var r = TT.rec; if (!r || !r.tracks[i]) return ttNextRecord();
    TT.i = i; var a = ttAudio(); a.src = r.tracks[i].url; ttKeepT = 0; try { sessionStorage.setItem('wm_tt', JSON.stringify({ slug: r.slug, i: i, t: t || 0 })); } catch (e) {} if (t) { a.addEventListener('loadedmetadata', function once() { a.removeEventListener('loadedmetadata', once); try { a.currentTime = t; } catch (e) {} }); }
    ttPaint(); return a.play().catch(function () { TT.want = true; ttPaint(); });
  }
  function ttPlay(slug, i, t) { return ttList().then(function (list) { var r = null; for (var k = 0; k < list.length; k++) if (list[k].slug === slug) r = list[k]; if (!r) return; TT.rec = r; ttSide(i || 0, t || 0); try { if (navigator.mediaSession) { navigator.mediaSession.metadata = new MediaMetadata({ title: r.tracks[TT.i].title || r.title, artist: r.by, album: r.title + ' · Watermark', artwork: [{ src: r.art, sizes: '512x512' }] }); navigator.mediaSession.setActionHandler('nexttrack', ttNext); navigator.mediaSession.setActionHandler('pause', function () { TT.a && TT.a.pause(); }); navigator.mediaSession.setActionHandler('play', function () { TT.a && TT.a.play(); }); } } catch (e) {} }); }
  function ttNext() { if (!TT.rec) return; if (TT.rec.tracks[TT.i + 1]) ttSide(TT.i + 1); else ttNextRecord(); }
  function ttNextRecord() { ttList().then(function (list) { if (!list.length) return ttOff(); var k = -1; for (var j = 0; j < list.length; j++) if (TT.rec && list[j].slug === TT.rec.slug) k = j; var n = list[(k + 1) % list.length]; if (!n || (TT.rec && n.slug === TT.rec.slug && list.length === 1)) return ttOff(); TT.rec = n; ttSide(0); }); }
  function ttOff() { if (TT.a) { try { TT.a.pause(); TT.a.removeAttribute('src'); TT.a.load(); } catch (e) {} } TT.rec = null; TT.want = false; try { sessionStorage.removeItem('wm_tt'); } catch (e) {} ttPaint(); }
  var ttKeepT = 0; function ttKeep() { var now = Date.now(); if (now - ttKeepT < 4000 || !TT.rec || !TT.a) return; ttKeepT = now; try { sessionStorage.setItem('wm_tt', JSON.stringify({ slug: TT.rec.slug, i: TT.i, t: Math.floor(TT.a.currentTime) })); } catch (e) {} }
  function ttPaint() {
    var on = !!TT.rec; root.classList.toggle('st-tton', on);
    if (!TT.bar) { TT.bar = document.createElement('div'); TT.bar.className = 'st-tt'; TT.bar.innerHTML = '<img alt=""><span class="st-ttt"><b></b><i></i></span><button type="button" data-tt-pp aria-label="Pause"></button><button type="button" data-tt-next aria-label="Next">' + (ic.next || '→') + '</button><button type="button" data-tt-off aria-label="Lift the needle">' + (ic.close || '×') + '</button>'; root.appendChild(TT.bar);
      TT.bar.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; if (b.hasAttribute('data-tt-pp')) { if (!TT.a) return; if (TT.a.paused) { TT.want = false; TT.a.play().catch(function () {}); } else TT.a.pause(); } else if (b.hasAttribute('data-tt-next')) ttNext(); else if (b.hasAttribute('data-tt-off')) ttOff(); });
      TT.bar.querySelector('.st-ttt').addEventListener('click', function () { if (TT.rec) location.href = '/listening/' + encodeURIComponent(TT.rec.slug); }); }
    TT.bar.hidden = !on; if (!on) { root.querySelectorAll('.st-ron').forEach(function (el) { el.classList.remove('st-ron'); }); root.querySelectorAll('[data-st-rplay].on').forEach(function (b) { b.classList.remove('on'); }); return; }
    var playing = TT.a && !TT.a.paused; var side = TT.rec.tracks[TT.i] || {};
    TT.bar.querySelector('img').src = TT.rec.cover || TT.rec.art; TT.bar.querySelector('b').textContent = TT.rec.title; TT.bar.querySelector('i').textContent = (side.title ? side.title + ' · ' : '') + (TT.rec.by || '') + (TT.want ? ' · Tap to resume' : '');
    TT.bar.querySelector('[data-tt-pp]').innerHTML = playing ? (ic.pause || '❚❚') : (ic.play || '▶'); TT.bar.classList.toggle('on', playing);
    root.querySelectorAll('.st-i.st-rec').forEach(function (el) { var mine = el.getAttribute('data-slug') === 'r:' + TT.rec.slug; el.classList.toggle('st-ron', mine && playing); var b = el.querySelector('[data-st-rplay]'); if (b) { b.classList.toggle('on', mine && playing); var sp = b.querySelector('span'); if (sp && mine) sp.textContent = playing ? 'Playing · ' + (side.title || '') : 'Paused'; } });
  }
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-st-rplay]'); if (!b) return; e.preventDefault();
    var slug = (b.closest('.st-i').getAttribute('data-slug') || '').replace(/^r:/, '');
    if (TT.rec && TT.rec.slug === slug && TT.a) { if (TT.a.paused) { TT.want = false; TT.a.play().catch(function () {}); } else TT.a.pause(); return; }
    ttPlay(slug, 0, 0);
  });
  // Resume what was on: shown paused, started on the first touch (the browser wants a gesture).
  try { var kept = JSON.parse(sessionStorage.getItem('wm_tt') || 'null'); if (kept && kept.slug) { ttList().then(function (list) { var r = null; for (var k = 0; k < list.length; k++) if (list[k].slug === kept.slug) r = list[k]; if (!r) return; TT.rec = r; TT.i = kept.i || 0; TT.want = true; ttPaint(); var go = function () { removeEventListener('touchstart', go); removeEventListener('click', go); removeEventListener('keydown', go); if (TT.want && TT.rec) { TT.want = false; ttSide(TT.i, kept.t || 0); } }; addEventListener('touchstart', go, { passive: true }); addEventListener('click', go); addEventListener('keydown', go); }); } } catch (e) {}
  var rStop = function () {}; // kept for older callers: the needle no longer lifts on its own
  // Stay (25 Oct): while a record is on, the rest of the house opens in a layer over Wander, so the music never stops.
  if (window.WMStay) WMStay.arm(function () { return !!TT.rec; }, { get bar() { return TT.bar; }, onClose: function () { if (TT.bar) { root.appendChild(TT.bar); } },
    onWander: function (at) { if (TT.bar) root.appendChild(TT.bar); var el = at && root.querySelector('.st-i[data-slug="' + at.replace(/"/g, '') + '"]'); if (el) el.scrollIntoView(); } });
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
  // The newcomer's nudge (23 Oct, for a phone handed over in a gallery): once per device, if the first photograph is
  // still on screen four seconds in and this phone has never swiped here, one line and a chevron, 'Swipe up for the
  // next'; the first scroll takes it away and the phone remembers.
  (function () {
    if (!TOUCH) return; var swiped = false; try { swiped = localStorage.getItem('wm_swiped') === '1'; } catch (e) {}
    if (swiped) return; var nd = root.querySelector('[data-st-swipe]'); if (!nd) return;
    var away = function () { try { localStorage.setItem('wm_swiped', '1'); } catch (e) {} clearTimeout(t); nd.classList.remove('on'); setTimeout(function () { nd.hidden = true; }, 700); scroller.removeEventListener('scroll', away); };
    scroller.addEventListener('scroll', away, { passive: true });
    var t = setTimeout(function () { if (scroller.scrollTop > 10) return away(); nd.hidden = false; requestAnimationFrame(function () { nd.classList.add('on'); }); setTimeout(away, 9000); }, 4000);
  })();
  function hold() {
    var st = root.querySelector('[data-st-stay]'); if (!st) return; st.hidden = false; requestAnimationFrame(function () { st.classList.add('on'); });
    scroller.style.overflowY = 'hidden';
    setTimeout(function () { scroller.style.overflowY = ''; st.classList.remove('on'); setTimeout(function () { st.hidden = true; }, 900); }, 3200);
  }
  function next() { scroller.scrollBy({ top: scroller.clientHeight, behavior: 'smooth' }); }
  // Hold (Will, 24 Oct: "a toggle that comes on and off that shows if you are locked and in full screen; that could be
  // if you are drawing"): one tap and this work is held: the browser's full screen, the screen kept awake, nothing
  // scrolls or swipes (pinch, pan and the double-tap still work), the chrome away, and one small badge top centre
  // saying Held · full screen, which is also the way out (a tap, L or Esc).
  var held = false, holdB = root.querySelector('[data-st-hold]'), heldB = root.querySelector('[data-st-held]'), heldFs = root.querySelector('[data-st-heldfs]');
  function paintHold() { root.classList.toggle('st-holding', held); if (holdB) holdB.setAttribute('aria-pressed', held ? 'true' : 'false'); if (heldB) heldB.hidden = !held; if (heldFs) heldFs.textContent = document.fullscreenElement || document.webkitFullscreenElement ? 'full screen' : 'on this screen'; }
  function hold(on) {
    held = !!on; var d = document, el = d.documentElement;
    if (held) { closeSheets(); if (sideOpen) sideHide(); clearTimeout(stillT); root.classList.remove('st-arr'); root.classList.add('st-still'); try { if (!d.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(function () {}); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen(); } catch (e) {} wake(); say('Held. Pinch to look closer; tap Held to release.', 2600); }
    else { try { if (d.fullscreenElement && d.exitFullscreen) d.exitFullscreen().catch(function () {}); else if (d.webkitFullscreenElement && d.webkitExitFullscreen) d.webkitExitFullscreen(); } catch (e) {} if (!sitting) { try { lock && lock.release(); } catch (e) {} } root.classList.remove('st-still'); }
    paintHold();
  }
  if (holdB) holdB.addEventListener('click', function () { hold(!held); });
  if (heldB) heldB.addEventListener('click', function () { hold(false); });
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (t) { document.addEventListener(t, function () { if (held && !(document.fullscreenElement || document.webkitFullscreenElement)) { /* left by the system's own way out: the hold goes too */ hold(false); } else paintHold(); }); });
  paintHold();
  // Sit: one tap and the stroll becomes a room to sit in. Each photograph held a minute and a half, the guide read
  // in the house voice, quiet music made here (four sines breathing; nothing streamed), the screen kept awake.
  var sitb = root.querySelector('[data-st-sit]'), sitbar = root.querySelector('[data-st-sitbar]'), ac = null, lock = null, wasGuide = false;
  function music(on) {
    if (on && TT.rec && TT.a && !TT.a.paused) return; // the turntable is on: no sines over a record
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
  root.addEventListener('click', function (e) { var sb = e.target.closest && e.target.closest('[data-st-settings]'); if (sb) openSheet(ssheet); });
  [].forEach.call(root.querySelectorAll('[data-st-sx2]'), function (b) { b.addEventListener('click', closeSheets); });
  if (ssheet) ssheet.addEventListener('click', function (e) { if (e.target === ssheet) closeSheets(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ssheet && !ssheet.hidden) { e.stopImmediatePropagation(); closeSheets(); } }, true);
})();
