'use strict';
// The heavy doors (10 Nov). Twice in one evening a crawler found a door that makes the website work hard for anyone who
// knocks: first the backgrounds (a 4K file cut from a master), then, named by the lag line the next morning, the
// free-and-clear originals (/open/:slug/take: a whole master read into memory, marked and sent) and a book set as a PDF
// (/read/:slug.pdf: a novel typeset on the spot, seconds of the one thread every visitor shares). One rule for every
// such door, set here, ahead of the routes:
//   (superseded 11 Nov: see the note above mountHeavy; the count by address and the turn-away are gone.)
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
  [/^\/w\/[^/]+\/(post|story|placard)\.jpg$/, 'draw'],
  [/^\/(read|art)\/[^/]+\/card\.png$/, 'draw'],
];
// (11 Nov, after two mornings of a real person being turned away: first the cold page, then a bare 'Too Many Requests'.)
// The rule now: a person is never refused. A person is a browser that has been inside the house: it carries one of the
// house's cookies (every page sets one by script), or is signed in. Their request waits its turn in the line, for as
// long as HEAVY_WAIT_S; there is no count of takes by address (behind the edge an address is not a person, and a
// dozen in ten minutes shut the door on whoever came next). A browser with no cookie (a link opened cold, a scraper
// following links) is sent to the page the button is on, which costs nothing; it never reaches the work or the line.
// Only a line already HEAVY_WAITING deep answers 'one moment', as a page of the house that tries again by itself.
const PERSON = /(?:^|;\s*)wm_[a-z0-9_]+=/i;
function pageFor(p) {
  let m;
  if ((m = p.match(/^\/open\/([^/]+)\/take/))) return `/w/${m[1]}#open`;
  if ((m = p.match(/^\/read\/([^/]+)\.pdf$/))) return `/read/${m[1]}`;
  if ((m = p.match(/^\/w\/([^/]+)\/background\//))) return `/w/${m[1]}#backgrounds`;
  if ((m = p.match(/^\/w\/([^/]+)\/d\/(\d+)\/save/))) return `/w/${m[1]}/d/${m[2]}`;
  if ((m = p.match(/^\/w\/([^/]+)\/archive\.wmark$/))) return `/w/${m[1]}`;
  return '/';
}
const moment = back => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="4"><title>One moment · Watermark</title><style>html,body{height:100%;margin:0;background:#0b0a09;color:#e9e4da;font:17px/1.5 Georgia,'Times New Roman',serif}main{min-height:100%;display:grid;place-content:center;text-align:center;padding:24px}h1{font-weight:400;font-size:28px;margin:0 0 10px}p{margin:0 0 18px;opacity:.75}a{color:#d9bc7c}</style></head><body><main><h1>One moment.</h1><p>The house is fetching it from the vault. This page tries again by itself.</p><p><a href="${back}">Back to the work</a></p></main></body></html>`;
function mountHeavy(app, { isStudio, makerOf, cfg = {} }) {
  const off = process.env.NODE_ENV === 'test' && process.env.HEAVY_TEST !== '1';
  const WAIT = Math.max(1, Number(process.env.HEAVY_WAIT_S || 90)) * 1000;
  const lanes = { master: { max: Math.max(1, Number(process.env.HEAVY_MASTER || 2)), wait: Math.max(1, Number(process.env.HEAVY_WAITING || 60)), on: 0, q: [] }, draw: { max: Math.max(1, Number(process.env.HEAVY_DRAW || 2)), wait: Math.max(1, Number(process.env.HEAVY_DRAW_WAITING || 60)), on: 0, q: [] } };
  const seen = { refused: 0, sentBack: 0, turned: 0, served: 0, waited: 0 };
  const kindOf = p => { for (const [re, k] of DOORS) if (re.test(p)) return k; return null; };
  const wholeOf = p => DOORS.some(([re, , w]) => w && re.test(p));
  const HOLD = Math.max(5, Number(process.env.HEAVY_HOLD_S || 45)) * 1000;
  function leave(L) { L.on--; const next = L.q.shift(); if (next) { L.on++; next(); } }
  const busy = (req, res) => { seen.turned++; res.set('Retry-After', '4'); res.set('Cache-Control', 'private, no-store');
    if (String(req.headers.accept || '').includes('text/html')) return res.status(429).type('html').send(moment(pageFor(req.path)));
    return res.status(429).type('text/plain').send('One moment: the house is busy. Try again in a few seconds.'); };
  app.use((req, res, next) => {
    if (off || req.method !== 'GET') return next();
    const kind = kindOf(req.path); if (!kind) return next();
    let known = false; try { known = !!(isStudio && isStudio(req)) || !!(makerOf && makerOf(req)); } catch (e) { known = false; }
    if (kind === 'master' && !known) {
      const ua = String(req.headers['user-agent'] || '');
      if (!ua || BOT.test(ua)) { seen.refused++; res.set('X-Robots-Tag', 'noindex, nofollow'); return res.sendStatus(403); }
      if (!PERSON.test(String(req.headers.cookie || ''))) { seen.sentBack++; res.set('X-Robots-Tag', 'noindex, nofollow'); res.set('Cache-Control', 'private, no-store'); return res.redirect(302, pageFor(req.path)); }
    }
    const L = lanes[kind];
    // The heavy part is making the file, not sending it: the lane is let go the moment the answer begins (its headers
    // are written), or after HEAVY_HOLD_S at most; only a door that works as it sends ('whole') holds to the end.
    const go = () => { seen.served++; let done = false; const out = () => { if (done) return; done = true; clearTimeout(cap); leave(L); }; const cap = setTimeout(out, HOLD); if (cap.unref) cap.unref();
      res.on('finish', out); res.on('close', out);
      if (!wholeOf(req.path)) { const wh = res.writeHead; res.writeHead = function () { out(); return wh.apply(this, arguments); }; }
      next(); };
    if (L.on < L.max) { L.on++; return go(); }
    if (L.q.length >= L.wait) return busy(req, res);
    // wait your turn: a person's download begins when the one ahead has begun
    seen.waited++; let gone = false;
    const turn = () => { if (gone) return leave(L); clearTimeout(tm); go(); };
    const drop = () => { const i = L.q.indexOf(turn); if (i >= 0) L.q.splice(i, 1); };
    const tm = setTimeout(() => { drop(); gone = true; busy(req, res); }, WAIT); if (tm.unref) tm.unref();
    L.q.push(turn);
    req.on('close', () => { if (!res.headersSent) { drop(); gone = true; clearTimeout(tm); } }); // gone before their turn
  });
  app.locals.heavy = { state: () => ({ ...seen, master: { on: lanes.master.on, waiting: lanes.master.q.length }, draw: { on: lanes.draw.on, waiting: lanes.draw.q.length } }), kindOf, BOT, PERSON, pageFor };
  return app.locals.heavy;
}
module.exports = { mountHeavy, DOORS, BOT, PERSON, pageFor };
