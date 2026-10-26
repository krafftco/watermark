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
  // 3. one finger moves, two fingers look (phone); 8. doors (keys on a desk, swipes on a phone)
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
    // 8. doors by swipe
    const doors = await p.evaluate(async () => {
      const sc = document.querySelector('.st-scroll'); const img = sc.querySelectorAll('.st-im')[2] || sc.querySelector('.st-im');
      const T = (x, y, id) => new Touch({ identifier: id, target: img, clientX: x, clientY: y });
      const fire = (type, ts, ct) => sc.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: ts, changedTouches: ct || ts, targetTouches: ts }));
      const open = () => { const r = document.querySelector('.st-side-r'), l = document.querySelector('.st-side-l'); return { keys: !!(r && r.classList.contains('on')), yours: !!(l && l.classList.contains('on')), rk: r ? r.className : '', lk: l ? l.className : '' }; };
      fire('touchstart', [T(300, 400, 7)]); for (let k = 1; k <= 10; k++) { fire('touchmove', [T(300 - k * 22, 400, 7)]); await new Promise(r => setTimeout(r, 12)); }
      fire('touchend', [], [T(80, 400, 7)]); await new Promise(r => setTimeout(r, 600));
      const a = open();
      return a;
    });
    ok(8, doors.keys || /on|open/.test(doors.rk), name, `a swipe left did not open the Keys (${doors.rk})`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  } else {
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(600);
    const d1 = await p.evaluate(() => { const r = document.querySelector('.st-side-r'); return r ? r.className : ''; });
    ok(8, /on|open/.test(d1), name, `→ did not open the Keys (${d1})`);
    await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(500);
    const d2 = await p.evaluate(() => { const r = document.querySelector('.st-side-r'); return r ? r.className : ''; });
    ok(8, !/\bon\b|open/.test(d2), name, `← did not close the Keys (${d2})`);
    await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(500);
    const d3 = await p.evaluate(() => { const l = document.querySelector('.st-side-l'); return l ? l.className : ''; });
    ok(8, /on|open/.test(d3), name, `← again did not open Yours (${d3})`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
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
