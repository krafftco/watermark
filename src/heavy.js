'use strict';
// The heavy doors (10 Nov). Twice in one evening a crawler found a door that makes the website work hard for anyone who
// knocks: first the backgrounds (a 4K file cut from a master), then, named by the lag line the next morning, the
// free-and-clear originals (/open/:slug/take: a whole master read into memory, marked and sent) and a book set as a PDF
// (/read/:slug.pdf: a novel typeset on the spot, seconds of the one thread every visitor shares). One rule for every
// such door, set here, ahead of the routes:
//   a door that hands out a master or sets a book ('master'): no crawler is answered (403); a person may take
//     HEAVY_PER_10MIN (12) in ten minutes (429 after); one is served at a time across all of them and at most
//     HEAVY_WAITING (4) wait in line, the rest are asked to come back (503, Retry-After).
//   a door that draws a picture from a display copy ('draw': share cards, details): crawlers are answered (a link
//     preview needs its card), HEAVY_DRAW (2) at a time, HEAVY_DRAW_WAITING (20) in line.
// The Studio and a signed-in maker pass the count and the crawler test, never the line. Nothing here is on under test.
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|python|curl\/|wget|go-http|okhttp|java\/|scrapy|httpclient|monitor|uptime|render\/|pingdom|betterstack|gpt|claude|anthropic|perplexity|bytespider|ccbot|amazonbot|applebot|yandex|baidu|semrush|ahrefs|mj12|dotbot|petal|node-fetch|axios|libwww|feedfetcher/i;
const DOORS = [
  [/^\/open\/[^/]+\/take\/?$/, 'master'],
  [/^\/read\/[^/]+\.pdf$/, 'master', 'whole'], // typeset as it is sent: the lane is held to the end
  [/^\/w\/[^/]+\/background\/[^/]+\/?$/, 'master'],
  [/^\/w\/[^/]+\/d\/\d+\/save\/?$/, 'master'],
  [/^\/w\/[^/]+\/archive\.wmark$/, 'master'],
  [/^\/img\/[^/]+\/detail\/\d+\/?$/, 'draw'],
  [/^\/w\/[^/]+\/(post|story)\.jpg$/, 'draw'],
  [/^\/(read|art)\/[^/]+\/card\.png$/, 'draw'],
];
function mountHeavy(app, { isStudio, makerOf, cfg = {} }) {
  const off = process.env.NODE_ENV === 'test' && process.env.HEAVY_TEST !== '1';
  const PER = Math.max(1, Number(process.env.HEAVY_PER_10MIN || 12));
  const lanes = { master: { max: 1, wait: Math.max(0, Number(process.env.HEAVY_WAITING || 8)), on: 0, q: [] }, draw: { max: Math.max(1, Number(process.env.HEAVY_DRAW || 2)), wait: Math.max(0, Number(process.env.HEAVY_DRAW_WAITING || 20)), on: 0, q: [] } };
  const took = new Map(); const seen = { refused: 0, limited: 0, turned: 0, served: 0 };
  const kindOf = p => { for (const [re, k] of DOORS) if (re.test(p)) return k; return null; };
  const wholeOf = p => DOORS.some(([re, , w]) => w && re.test(p));
  const HOLD = Math.max(5, Number(process.env.HEAVY_HOLD_S || 45)) * 1000;
  function leave(L) { L.on--; const next = L.q.shift(); if (next) { L.on++; next(); } }
  app.use((req, res, next) => {
    if (off || req.method !== 'GET') return next();
    const kind = kindOf(req.path); if (!kind) return next();
    let known = false; try { known = !!(isStudio && isStudio(req)) || !!(makerOf && makerOf(req)); } catch (e) { known = false; }
    if (kind === 'master' && !known) {
      const ua = String(req.headers['user-agent'] || '');
      if (!ua || BOT.test(ua)) { seen.refused++; res.set('X-Robots-Tag', 'noindex, nofollow'); return res.sendStatus(403); }
      const now = Date.now(), ip = req.ip || 'x'; const t = (took.get(ip) || []).filter(x => now - x < 600e3);
      if (t.length >= PER) { seen.limited++; res.set('Retry-After', '600'); return res.sendStatus(429); }
      t.push(now); took.set(ip, t); if (took.size > 5000) took.clear();
    }
    const L = lanes[kind];
    // (11 Nov: the lane was held until the last byte had reached the phone, so one slow or abandoned download kept the
    // door shut and the next people were turned away with a 503, which the app shows as the cold page.) The heavy part
    // is making the file, not sending it: the lane is let go the moment the answer begins (its headers are written),
    // or after HEAVY_HOLD_S at most; only a door that works as it sends ('whole') holds to the end. A full line is
    // 429, the house's own sign, never 503.
    const go = () => { seen.served++; let done = false; const out = () => { if (done) return; done = true; clearTimeout(cap); leave(L); }; const cap = setTimeout(out, HOLD); if (cap.unref) cap.unref();
      res.on('finish', out); res.on('close', out);
      if (!wholeOf(req.path)) { const wh = res.writeHead; res.writeHead = function () { out(); return wh.apply(this, arguments); }; }
      next(); };
    if (L.on < L.max) { L.on++; return go(); }
    if (L.q.length >= L.wait) { seen.turned++; res.set('Retry-After', '30'); return res.sendStatus(429); }
    L.q.push(go);
    req.on('close', () => { const i = L.q.indexOf(go); if (i >= 0) L.q.splice(i, 1); }); // gone before their turn
  });
  app.locals.heavy = { state: () => ({ ...seen, master: { on: lanes.master.on, waiting: lanes.master.q.length }, draw: { on: lanes.draw.on, waiting: lanes.draw.q.length } }), kindOf, BOT };
  return app.locals.heavy;
}
module.exports = { mountHeavy, DOORS, BOT };
