// The Wander walk: checks the ten sentences of docs/WANDER.md against a running house, on a phone and on a desk.
// node scripts/wander-walk.js   (WALK_BASE=http://localhost:3081; needs playwright: PW=/path/to/node_modules/playwright)
'use strict';
const PW = process.env.PW || '/opt/npm-tools/node_modules/playwright';
const { chromium, devices } = require(PW);
const BASE = process.env.WALK_BASE || 'http://localhost:3081';
const faults = [];
const fault = (n, where, what) => { faults.push(`${n}. ${where}: ${what}`); };
const ok = (n, cond, where, what) => { if (!cond) fault(n, where, what); return !!cond; };

async function walk(name, opts, phone) {
  const b = await chromium.launch();
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  const errs = [], bad = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('response', r => { if (r.status() >= 400 && !/favicon|fonts\.g|\/api\/for-you/.test(r.url())) bad.push(r.status() + ' ' + r.url().replace(BASE, '')); });
  await p.route(/fonts\.googleapis|fonts\.gstatic/, r => r.abort());
  // 1. opens on a picture
  const html = await (await fetch(BASE + '/wander')).text();
  const inHtml = (html.match(/class="st-i(?: |")/g) || []).length;
  ok(1, inHtml >= 3, name, `only ${inHtml} screens in the HTML`);
  const r0 = await p.goto(BASE + '/wander', { waitUntil: 'load', timeout: 20000 });
  ok(10, r0.status() === 200, name, `/wander answered ${r0.status()}`);
  await p.waitForTimeout(600);
  const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, first: !!document.querySelector('.st-i .st-im') }));
  ok(1, m.sw <= m.iw, name, `page wider than the screen: ${m.sw} > ${m.iw}`);
  ok(1, m.first, name, 'no photograph on the first screen');
  // 2. whole and true
  const t = await p.evaluate(() => {
    const img = document.querySelector('.st-i .st-im'); if (!img) return null;
    const r = img.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    return { nw: img.naturalWidth, nh: img.naturalHeight, w: r.width, h: r.height, dpr, fit: getComputedStyle(img).objectFit, vw: innerWidth, vh: innerHeight, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  if (ok(2, t && t.nw > 0, name, 'the first picture did not decode')) {
    ok(2, t.w * t.dpr <= t.nw * 1.25 + 2, name, `shown larger than its pixels: ${Math.round(t.w * t.dpr)} device px over ${t.nw}`);
    ok(2, t.fit === 'contain', name, `object-fit is ${t.fit}, so it may be cropped`);
    ok(2, t.left >= -1 && t.right <= t.vw + 1 && t.top >= -1 && t.bottom <= t.vh + 1, name, 'the picture spills off the screen');
    const fill = Math.max(t.w / t.vw, t.h / t.vh);
    const capped = t.w * t.dpr >= t.nw * 1.2;
    ok(2, fill >= 0.9 || capped, name, `the picture fills only ${Math.round(fill * 100)}% of the screen and is not at true size`);
  }
  // 4. nothing counts you
  const rail = await p.evaluate(() => { const r = document.querySelector('.st-i .st-rail'); if (!r) return null; return [].map.call(r.querySelectorAll('.st-b'), b => b.textContent.replace(/\s+/g, ' ').trim()); });
  if (ok(4, rail && rail.length, name, 'no rail on the first screen')) {
    const counted = rail.filter(x => /\d/.test(x) && !/^Collect/.test(x));
    ok(4, !counted.length, name, `a number on the rail: ${counted.join(' | ')}`);
    ok(4, rail.some(x => /^Hat$/.test(x)), name, `the hat reads ${JSON.stringify(rail[0])}, not Hat`);
    ok(7, /^Collect/.test(rail[rail.length - 1]) || /^Yours$/.test(rail[rail.length - 1]), name, `Collect is not last on the rail: ${rail[rail.length - 1]}`);
    const buy = await p.evaluate(() => { const b = document.querySelector('.st-i .st-buy'); if (!b) return null; const s = getComputedStyle(b); const o = getComputedStyle(document.querySelector('.st-i .st-rail .st-b')); return { bg: s.backgroundColor, w: b.getBoundingClientRect().width, ow: Math.max.apply(null, [].map.call(document.querySelectorAll('.st-i .st-rail .st-b:not(.st-buy)'), x => x.getBoundingClientRect().width)), price: /\$\d/.test(b.textContent) }; });
    if (buy) {
      ok(7, buy.price, name, 'Collect carries no price');
      const a = buy.bg.match(/[\d.]+/g) || [];
      ok(7, a.length < 4 || +a[3] <= 0.5, name, `Collect is filled (${buy.bg})`);
      ok(7, buy.w <= buy.ow * 1.3, name, `Collect is ${Math.round(buy.w)}px wide against the rail's ${Math.round(buy.ow)}`);
    }
  }
  // 6. every screen is a record
  const tog = await p.evaluate(() => { const a = document.querySelector('.st-i .st-tog'); const s = document.querySelector('.st-i').getAttribute('data-slug'); return a ? { href: a.getAttribute('href'), slug: s } : null; });
  if (ok(6, tog && tog.href, name, 'no toggle to the record on the plate')) {
    ok(6, tog.href.indexOf(tog.slug) >= 0 && /from=wander/.test(tog.href), name, `the toggle leads to ${tog.href}, not this work's record`);
    const rec = await ctx.newPage(); await rec.route(/fonts\.g/, r => r.abort());
    const rr = await rec.goto(BASE + tog.href, { waitUntil: 'load', timeout: 20000 });
    ok(6, rr.status() === 200, name, `the record answered ${rr.status()}`);
    const back = await rec.evaluate(() => { const a = document.querySelector('.vtog a'); return a ? a.getAttribute('href') : null; });
    ok(6, back && back === '/wander?at=' + tog.slug, name, `the record's pill goes to ${back}`);
    await rec.close();
  }
  // 5. stillness
  await p.mouse.move(Math.round((opts.viewport || devices['iPhone 13'].viewport).width / 2), Math.round((opts.viewport || devices['iPhone 13'].viewport).height / 2));
  await p.waitForTimeout(500);
  const stillBefore = await p.evaluate(() => document.querySelector('.st').classList.contains('st-still'));
  await p.waitForTimeout(6600);
  const still = await p.evaluate(() => document.querySelector('.st').classList.contains('st-still'));
  ok(5, still, name, 'after six seconds still the chrome is still up');
  if (phone) await p.touchscreen.tap(50, 300); else await p.mouse.move(100, 300);
  await p.waitForTimeout(700);
  const woke = await p.evaluate(() => !document.querySelector('.st').classList.contains('st-still'));
  ok(5, woke, name, 'a touch did not bring the chrome back');
  // 8. the two sides (#241): Where next on the left, About on the right, said once; the shield opens About at the record.
  const SIDES = () => { window.sides = () => { const r = document.querySelector('.st-side-r'), l = document.querySelector('.st-side-l'); const on = e => !!(e && e.classList.contains('on') && getComputedStyle(e).visibility === 'visible'); const a = document.activeElement; const tab = s => { const t = document.querySelector(s); return t ? `${t.getAttribute('aria-label')}|${t.textContent.trim()}` : ''; }; return { about: on(r), next: on(l), cls: [l && l.className, r && r.className], focus: a && r.contains(a) ? 'about' : a && l.contains(a) ? 'next' : '', here: !!document.querySelector('.st-scroll'), tabs: { l: tab('.st-tab-l'), r: tab('.st-tab-r') } }; }; };
  const aboutHolds = async () => {
    await p.waitForFunction(() => document.querySelector('.st-side-r [data-st-rec]'), null, { timeout: 5000 }).catch(() => {});
    const a = await p.evaluate(() => { const r = document.querySelector('.st-side-r'); const top = s => { const e = r.querySelector(s); return e ? e.getBoundingClientRect().top + r.scrollTop : -1; }; const t = (r.querySelector('.wka-h h3') || {}).textContent || ''; return { label: r.getAttribute('aria-label'), work: top('.wka-h'), who: top('.whp-h'), rec: top('[data-st-rec]'), recs: r.querySelectorAll('[data-st-rec]').length, title: t, said: t ? r.textContent.split(t).length - 1 : 0, number: [...r.querySelectorAll('dt')].filter(d => d.textContent === 'Its number').length, sheet: !!document.querySelector('.wye') }; });
    ok(8, a.label === 'About this work', name, `the right side is named ${a.label}`);
    ok(8, a.work >= 0 && a.work < a.who && a.who < a.rec, name, `About is not the work, who made it, the record, in that order (${a.work}, ${a.who}, ${a.rec})`);
    ok(8, a.recs === 1 && a.number === 1 && a.said === 1 && !a.sheet, name, `About does not say it once (records ${a.recs}, numbers ${a.number}, the title ${a.said} times, a sheet ${a.sheet})`);
  };
  const nextHolds = async () => {
    await p.waitForFunction(() => document.querySelector('.st-side-l .wnx-door'), null, { timeout: 5000 }).catch(() => {});
    const n = await p.evaluate(() => { const l = document.querySelector('.st-side-l'); return { label: l.getAttribute('aria-label'), ways: [...l.querySelectorAll('.wnx-t')].map(a => ({ href: a.getAttribute('href'), n: parseInt(a.querySelector('i').textContent.replace(/,/g, ''), 10), name: a.querySelector('b').textContent })), doors: [...l.querySelectorAll('.wnx-door')].map(a => a.getAttribute('href')) }; });
    ok(8, n.label === 'Where next', name, `the left side is named ${n.label}`);
    ok(8, n.ways.length <= 6 && n.ways.every(w => w.n >= 4 && /^\/wander\?(in|maker)=/.test(w.href)), name, `Where next's ways are not six at most, four works or more, each a Wander (${JSON.stringify(n.ways)})`);
    ok(8, n.doors.length >= 1 && n.doors[n.doors.length - 1] === '/look', name, `Where next does not end in the standing doors (${n.doors})`);
    for (const w of [...n.ways.map(x => x.href), ...n.doors]) { const r = await fetch(BASE + w.replace(/#.*/, '')); ok(8, r.status === 200, name, `${w} answered ${r.status}`); if (/^\/wander/.test(w)) { const h = await r.text(); ok(8, (h.match(/class="st-i(?: |")/g) || []).length >= 1 && !/st-none/.test(h), name, `${w} lands on no picture`); } }
  };
  const shieldOpens = async press => {
    const had = await press(); ok(8, had, name, 'no shield on the picture'); await p.waitForTimeout(900);
    const s = await p.evaluate(() => { const r = document.querySelector('.st-side-r'), rec = r.querySelector('[data-st-rec]'); const b = rec ? rec.getBoundingClientRect() : null; return { on: r.classList.contains('on'), top: b ? b.top : -1, h: innerHeight, focus: document.activeElement === rec, sheet: !!document.querySelector('.wye'), eyes: document.querySelectorAll('.st [data-eye]').length }; });
    ok(8, s.on && !s.sheet && !s.eyes, name, `the shield did not open About alone (${JSON.stringify(s)})`);
    ok(8, s.top >= 0 && s.top < s.h * 0.5 && s.focus, name, `the shield did not open About at the record (${JSON.stringify(s)})`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  };
  // 3. one finger moves, two fingers look (phone)
  if (phone) {
    const sw = await p.evaluate(async () => {
      const sc = document.querySelector('.st-scroll'); const img = sc.querySelector('.st-im');
      const T = (x, y, id) => new Touch({ identifier: id, target: img, clientX: x, clientY: y });
      const fire = (type, ts, ct) => sc.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: ts, changedTouches: ct || ts, targetTouches: ts }));
      const top0 = sc.scrollTop, h = sc.clientHeight;
      fire('touchstart', [T(200, 600, 1)]); for (let k = 1; k <= 12; k++) { fire('touchmove', [T(200, 600 - k * 30, 1)]); await new Promise(r => setTimeout(r, 8)); }
      fire('touchend', [], [T(200, 240, 1)]); await new Promise(r => setTimeout(r, 800));
      const moved = sc.scrollTop - top0;
      // two fingers: a pinch on the second screen's picture
      const el2 = sc.querElementsByClass; const img2 = sc.querySelectorAll('.st-im')[1] || img;
      const T2 = (x, y, id) => new Touch({ identifier: id, target: img2, clientX: x, clientY: y });
      fire('touchstart', [T2(150, 400, 3), T2(250, 400, 4)]);
      for (let k = 1; k <= 8; k++) { fire('touchmove', [T2(150 - k * 10, 400, 3), T2(250 + k * 10, 400, 4)]); await new Promise(r => setTimeout(r, 16)); }
      fire('touchend', [], [T2(70, 400, 3), T2(330, 400, 4)]); await new Promise(r => setTimeout(r, 300));
      const zoomed = document.querySelector('.st').classList.contains('st-zoom');
      const tr = getComputedStyle(img2).transform;
      // a flick lets go
      fire('touchstart', [T2(200, 500, 5)]); for (let k = 1; k <= 4; k++) { fire('touchmove', [T2(200, 500 - k * 40, 5)]); await new Promise(r => setTimeout(r, 12)); }
      fire('touchend', [], [T2(200, 340, 5)]); await new Promise(r => setTimeout(r, 900));
      const letGo = !document.querySelector('.st').classList.contains('st-zoom');
      const moved2 = sc.scrollTop - top0;
      return { moved, h, zoomed, tr, letGo, moved2, at: location.search };
    });
    ok(3, Math.abs(sw.moved - sw.h) < 4, name, `one finger moved ${sw.moved}px, not one screen (${sw.h})`);
    ok(3, sw.zoomed && sw.tr !== 'none', name, 'two fingers did not zoom');
    ok(3, sw.letGo, name, 'a flick did not let the zoom go');
    ok(3, Math.abs(sw.moved2 - 2 * sw.h) < 4, name, `after the flick the wall stood at ${sw.moved2}, not two screens (${2 * sw.h})`);
    ok(10, /at=/.test(sw.at), name, `the address did not follow the picture (${sw.at})`);
    // 8. the two sides by swipe: a finger moving left opens About, a finger moving right opens Where next
    const swipe = dx => p.evaluate(async dx => {
      const sc = document.querySelector('.st-scroll'); const h = sc.clientHeight; const img = [...sc.querySelectorAll('.st-im')].find(i => { const r = i.getBoundingClientRect(); return r.top > -h / 2 && r.top < h / 2; }) || sc.querySelector('.st-im');
      const x0 = dx < 0 ? 300 : 60; const T = x => new Touch({ identifier: 7, target: img, clientX: x, clientY: 400 });
      const fire = (type, ts, ct) => sc.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: ts, changedTouches: ct || ts, targetTouches: ts }));
      fire('touchstart', [T(x0)]); for (let k = 1; k <= 10; k++) { fire('touchmove', [T(x0 + dx * k / 10)]); await new Promise(r => setTimeout(r, 12)); }
      fire('touchend', [], [T(x0 + dx)]); await new Promise(r => setTimeout(r, 900));
      return sides();
    }, dx);
    await p.evaluate(SIDES);
    const doors = await swipe(-220);
    ok(8, doors.about && !doors.next, name, `a finger moving left did not open About (${JSON.stringify(doors.cls)})`);
    await aboutHolds();
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    const nx = await swipe(220);
    ok(8, nx.next && !nx.about, name, `a finger moving right did not open Where next (${JSON.stringify(nx.cls)})`);
    await nextHolds();
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    // The thumb starts a swipe left at the right edge, on the rail (5 Nov: "left swipe doesn't work"): it must open too.
    const fromRail = await p.evaluate(async () => {
      const sc = document.querySelector('.st-scroll'); const btn = [...document.querySelectorAll('.st-rail button')].find(b => { const r = b.getBoundingClientRect(); return r.width && r.top > 0 && r.bottom < innerHeight; });
      if (!btn) return 'no rail'; const r = btn.getBoundingClientRect(), x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
      const T = (x, y) => new Touch({ identifier: 9, target: btn, clientX: x, clientY: y });
      const fire = (type, ts, ct) => btn.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: ts, changedTouches: ct || ts, targetTouches: ts }));
      fire('touchstart', [T(x0, y0)]); for (let k = 1; k <= 10; k++) { fire('touchmove', [T(x0 - k * 22, y0 + k)]); await new Promise(r => setTimeout(r, 12)); }
      fire('touchend', [], [T(x0 - 220, y0 + 10)]); await new Promise(r => setTimeout(r, 600));
      return document.querySelector('main.st').classList.contains('st-side-on') ? 'open' : 'shut';
    });
    ok(8, fromRail === 'open', name, `a swipe left that starts on the rail did not open About (${fromRail})`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    // The shield opens About at the record, and no sheet of its own. A tap brings the chrome first.
    await p.touchscreen.tap(60, 300); await p.waitForTimeout(700);
    await shieldOpens(() => p.evaluate(() => { const sc = document.querySelector('.st-scroll'); const h = sc.clientHeight; const b = [...sc.querySelectorAll('.st-i .st-eye')].find(e => { const r = e.getBoundingClientRect(); return r.top > 0 && r.top < h; }); if (b) b.click(); return !!b; }));
  } else {
    await p.evaluate(SIDES);
    // → opens About, ← closes it; ← opens Where next, → closes it; Esc closes either. The edge tabs say where they go.
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(700);
    let d = await p.evaluate(() => sides());
    ok(8, d.about && !d.next, name, `→ did not open About (${JSON.stringify(d.cls)})`);
    ok(8, d.focus === 'about', name, `focus did not go into About (${d.focus})`);
    await aboutHolds();
    await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(600);
    d = await p.evaluate(() => sides()); ok(8, !d.about && !d.next, name, `← did not close About (${JSON.stringify(d.cls)})`);
    await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(700);
    d = await p.evaluate(() => sides()); ok(8, d.next && !d.about, name, `← from the picture did not open Where next (${JSON.stringify(d.cls)})`);
    ok(8, d.focus === 'next', name, `focus did not go into Where next (${d.focus})`);
    await nextHolds();
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(600);
    d = await p.evaluate(() => sides()); ok(8, !d.about && !d.next && d.here, name, `→ did not close Where next (${JSON.stringify(d.cls)})`);
    ok(8, d.tabs.l === 'Where next|Next' && d.tabs.r === 'About this work|About', name, `the edge tabs read ${JSON.stringify(d.tabs)}`);
    for (const [which, want] of [['yours', 'next'], ['keys', 'about']]) {
      await p.mouse.move(700, 450); await p.waitForTimeout(300);
      await p.evaluate(w => document.querySelector(`[data-st-doors="${w}"]`).click(), which); await p.waitForTimeout(700);
      d = await p.evaluate(() => sides()); ok(8, d[want] && !d[want === 'next' ? 'about' : 'next'], name, `the ${which === 'yours' ? 'left' : 'right'} edge tab did not open ${want === 'next' ? 'Where next' : 'About'}`);
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);
      d = await p.evaluate(() => sides()); ok(8, !d.about && !d.next && d.here, name, 'Esc did not close the side and stay in Wander');
    }
    await shieldOpens(() => p.evaluate(() => { const sc = document.querySelector('.st-scroll'); const h = sc.clientHeight; const b = [...sc.querySelectorAll('.st-i .st-eye')].find(e => { const r = e.getBoundingClientRect(); return r.top > 0 && r.top < h; }); if (b) b.click(); return !!b; }));
    const sc0 = await p.evaluate(() => document.querySelector('.st-scroll').scrollTop);
    await p.keyboard.press('ArrowDown'); await p.waitForTimeout(900);
    const sc1 = await p.evaluate(() => ({ t: document.querySelector('.st-scroll').scrollTop, h: document.querySelector('.st-scroll').clientHeight }));
    ok(3, Math.abs(sc1.t - sc0 - sc1.h) < 4, name, `↓ moved ${sc1.t - sc0}px, not one screen (${sc1.h})`);
  }
  // 9. no connection
  await p.waitForTimeout(8500); // the pack is packed 8 s after load
  const packed = await p.evaluate(() => { try { return (JSON.parse(localStorage.getItem('wm_pack') || '{}').items || []).length; } catch (e) { return -1; } });
  ok(9, packed >= 8, name, `the pack holds ${packed} after nine seconds`);
  await ctx.setOffline(true);
  const before = await p.evaluate(() => document.querySelectorAll('.st-i').length);
  await p.evaluate(() => { const sc = document.querySelector('.st-scroll'); sc.scrollTop = sc.scrollHeight; });
  await p.waitForTimeout(2500);
  const off = await p.evaluate(() => ({ n: document.querySelectorAll('.st-i').length, said: (document.querySelector('[data-st-toast]') || {}).textContent || '' }));
  ok(9, off.n > before, name, `offline, the wall did not grow from the pack (${before} → ${off.n})`);
  ok(9, /No connection/.test(off.said) || /brought with you/.test(off.said), name, `offline, the house said ${JSON.stringify(off.said)}`);
  await ctx.setOffline(false);
  await p.evaluate(() => dispatchEvent(new Event('online')));
  await p.waitForTimeout(800);
  // 10. faults
  const netErrs = bad.filter(x => !/ERR_INTERNET_DISCONNECTED|net::/.test(x));
  ok(10, !errs.length, name, `script errors: ${errs.join(' | ').slice(0, 300)}`);
  ok(10, !netErrs.length, name, `failed requests: ${netErrs.join(', ').slice(0, 300)}`);
  await b.close();
}

(async () => {
  await walk('phone', { ...devices['iPhone 13'] }, true);
  await walk('desk', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, false);
  if (faults.length) { console.log('wander: ' + faults.length + ' fault' + (faults.length > 1 ? 's' : '')); faults.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log('wander: all ten hold');
})().catch(e => { console.error(e); process.exit(2); });
