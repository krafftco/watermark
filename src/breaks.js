'use strict';
// A break is handled by the house (#149; Will, 20 Nov: "handle breaks beautifully, and never compromise the entire
// site"). Two parts live here:
//   - the house's answer to a fault inside it (layer 4): every bare status a person can meet, every thrown error and
//     every limit ends in the house's own page (the sign, with the way back and, when the fault is passing, a quiet
//     try again), or, for a script, JSON with words it can show. Images, media and files keep their plain status.
//     Each fault is kept for the fix in the background: `app.locals.lastFault`, the last few in
//     `app.locals.recentFaults` (both on /healthz for the Studio) and a `[break]` line in the log.
//   - the "one moment" page (layer 1): one self-contained file (no font, style or script asked of the house, which is
//     what is down) that the edge serves from the vault's bucket when the website does not answer, and the house's
//     service worker shows when a navigation fails. It tries the address again by itself and returns the visitor there.
//
// Every word a person reads on these pages is in COPY, below, and nowhere else. All of it is a draft for Will.
const COPY = {
  // The edge's page and the app's: the house cannot be reached at all.
  moment: {
    title: 'One moment · Watermark',
    kicker: 'One moment',
    head: 'Watermark caught a cold.', // Will's words, 21 Oct
    line: 'The house is not answering for a moment. Nothing you have collected, kept or made is lost.',
    trying: 'This page will open by itself when the house answers.',
    tryingN: 'Trying again',
    retry: 'Try again',
    back: 'Back',
    still: 'Still trying. If it is taking long, the house is being mended; you can close this page and come back later.',
    noscript: 'This page tries again every twenty seconds.',
  },
  // A room inside the house gave way; the rest of the house is up.
  room: {
    500: 'Nothing you have collected, kept or made is lost, and the house has been told. The rest of the house is open.', // under the sign’s own headline, “Something in this room gave way.”
    passing: 'The house did not answer this page in time. Nothing is lost; the page will try again by itself.',
    limit: 'This page asked the house a question that took too long, so it was stopped before it held up anyone else. The rest of the house is open; try this page again in a minute.',
    retry: 'Try again',
    back: 'Back to where you were',
    trying: 'Trying again by itself…',
    upload: 'The file is larger than the vault takes in one piece.',
  },
  // A script's answer: the same in a line a page can show.
  json: {
    500: 'Something gave way on the house’s side. Nothing is lost; try again in a moment.',
    passing: 'The house could not answer just now. Nothing is lost; try again in a moment.',
  },
};

// (#123) Several copies of the website: each fault says which copy it came from (faults are kept per process).
const { ME } = require('./instances');
const PASSING = new Set([502, 503, 504]); // a fault that passes by itself: the page tries again
const isLimit = e => !!(e && (e.limit || e.code === '57014')); // 57014: Postgres's own "statement timeout" (the async path, src/adb.js)
// The statement a limit stopped, as text, never its values (the bridge's error carries it; the async path's message ends "in: <sql>").
const sqlOf = e => { if (!e) return null; if (e.sql) return String(e.sql).replace(/\s+/g, ' ').slice(0, 300); const m = String(e.message || '').match(/\n\s*in: ([\s\S]*)$/); return m ? m[1].replace(/\s+/g, ' ').slice(0, 300) : null; };
const roomOf = req => (req.route && req.route.path ? (req.baseUrl || '') + (typeof req.route.path === 'string' ? req.route.path : String(req.route.path)) : req.path);

// Who is asking: a person at a page ('page'), a script ('json'), or an image, a sound or a file ('bare').
const OLD_FILEISH = /^\/(api|img|cab|static|d|portrait|ledger\.json|healthz|sw\.js)/;
function wants(req) {
  const mode = req.get('sec-fetch-mode'), dest = req.get('sec-fetch-dest');
  if (mode === 'navigate' || dest === 'document' || dest === 'iframe') return 'page';
  if (/^\/api\//.test(req.path) || req.xhr || dest === 'empty') return 'json';
  const accept = String(req.get('accept') || '');
  if (/application\/json/.test(accept) && !/text\/html/.test(accept)) return 'json';
  // No fetch metadata (an older browser, a test): the rule the house had before (#149 keeps it exactly here).
  if (!mode && req.method === 'GET' && req.accepts('html') && !OLD_FILEISH.test(req.path) && !req.xhr) return 'page';
  return 'bare';
}

// Where they were: the page that sent them, if it is the house's own and not this one.
function backOf(req) {
  const ref = req.get('referer'); if (!ref) return null;
  try { const u = new URL(ref); const host = req.get('host'); if (host && u.host !== host) return null; const p = u.pathname + u.search; return p && p !== req.originalUrl ? p : null; } catch (e) { return null; }
}

function mountBreaks(app, { V, coverFor = () => null }) {
  const recent = []; app.locals.recentFaults = recent;
  // Keep the fault: the room (the route as written), the address, the error, and for a limit the statement's text.
  function record(req, err, code, kind) {
    const f = { at: new Date().toISOString(), instance: ME, code, kind: kind || (isLimit(err) ? 'limit' : err ? 'error' : 'status'), room: roomOf(req), path: req.path, method: req.method,
      message: err ? String(err.message || err).split('\n')[0].slice(0, 300) : null, sql: isLimit(err) ? sqlOf(err) : null,
      stack: err && err.stack ? String(err.stack).split('\n').slice(1, 6).map(x => x.trim()).join(' | ') : null };
    app.locals.lastFault = f; recent.unshift(f); if (recent.length > 20) recent.length = 20;
    console.error(`[break] ${ME} ${code} ${f.kind} ${req.method} ${f.room}${f.room !== req.path ? ` (${req.path})` : ''}: ${f.message || '(no message)'}${f.sql ? ` | sql: ${f.sql}` : ''}`);
    return f;
  }
  const jsonWords = (code, err) => isLimit(err) ? COPY.room.limit : code >= 500 ? (PASSING.has(code) ? COPY.json.passing : COPY.json[500]) : ((V.SIGNS[code] || {}).h || 'That could not be done.');
  // The house's answer, by who is asking. `detail` replaces the sign's line; a passing fault on a GET tries again by itself.
  function answer(req, res, code, err, { detail = null, plain, as = null } = {}) {
    if (res.headersSent) return;
    const w = as || wants(req);
    if (w === 'page') {
      const limit = isLimit(err), passing = limit || PASSING.has(code);
      const words = detail || (limit ? COPY.room.limit : code === 413 ? COPY.room.upload : code >= 500 ? (passing ? COPY.room.passing : COPY.room[500]) : null);
      const get = req.method === 'GET' || req.method === 'HEAD';
      const back = backOf(req);
      const next = code >= 500 && get ? { href: req.originalUrl, label: COPY.room.retry } : null;
      let cover = null; try { cover = coverFor(); } catch (e) { cover = null; }
      res.set('Cache-Control', 'no-store');
      return res.status(code).send(V.sign({ code, cover, detail: words, next, back: back ? { href: back, label: COPY.room.back } : null, retry: passing && get ? COPY.room.trying : null }));
    }
    if (w === 'json') return res.status(code).json({ ok: false, code, why: jsonWords(code, err), error: jsonWords(code, err) });
    return plain ? plain(code) : res.status(code).end();
  }
  // Every bare status in the app goes through here (any room, mounted before or after this).
  const plainSendStatus = Object.getPrototypeOf(app.response).sendStatus;
  app.response.sendStatus = function (code) {
    if (code < 400) return plainSendStatus.call(this, code);
    if (code >= 500) record(this.req, null, code, 'status');
    return answer(this.req, this, code, null, { plain: c => plainSendStatus.call(this, c) });
  };
  // A room that caught its own error says so: `res.fault(e)` (500) or `res.fault(e, 503)`.
  app.response.fault = function (err, code = 500) {
    const c = isLimit(err) ? 503 : code; record(this.req, err, c);
    if (isLimit(err)) this.set('Retry-After', '60');
    if (this.headersSent) { try { this.req.socket.destroy(); } catch (e) { /* gone */ } return; } // a file half sent is cut, never ended as if whole
    return answer(this.req, this, c, err, { plain: x => plainSendStatus.call(this, x) });
  };
  // The last sign: any error a room throws (or an async room rejects; Express 5 brings it here).
  function handler(err, req, res, next) {
    let code = err && (err.status || err.statusCode) >= 400 ? (err.status || err.statusCode) : 500;
    if (err && err.code === 'LIMIT_FILE_SIZE') code = 413; else if (err && err.name === 'MulterError') code = 400; // uploads
    if (isLimit(err)) code = 503;
    if (code >= 500) record(req, err, code);
    if (res.headersSent) return next(err);
    if (isLimit(err)) res.set('Retry-After', '60');
    const w = wants(req);
    // A page asked by a browser without fetch metadata still gets the sign (as before), not a bare body.
    const as = w === 'bare' && req.accepts('html') && !req.xhr && !/^\/(api|img|cab)/.test(req.path) ? 'page' : null;
    return answer(req, res, code, err, { as });
  }
  return { record, answer, handler, wants };
}

// ---------- The "one moment" page ----------
// The house's wave, drawn here so the page asks nothing of the house.
const WAVE = (() => { try { return require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'wave.svg'), 'utf8').replace(/<\?xml[^>]*>/, '').replace(/fill="#[0-9a-f]+"/gi, 'fill="currentColor"').replace('<svg ', '<svg aria-hidden="true" focusable="false" ').trim(); } catch (e) { return ''; } })();
const H = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The page itself. `marker` lets a script tell this page from the house's answer.
function momentPage() {
  const T = COPY.moment;
  const words = JSON.stringify({ tryingN: T.tryingN, still: T.still }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#0b0a09">
<title>${H(T.title)}</title>
<noscript><meta http-equiv="refresh" content="20"></noscript>
<style>
html,body{height:100%;margin:0}
body{background:#0b0a09;color:#e9e4da;font:17px/1.55 Georgia,"Times New Roman",serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
main{min-height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;max-width:34em;margin:0 auto;padding:max(48px,env(safe-area-inset-top)) 24px max(48px,env(safe-area-inset-bottom))}
.w{display:block;width:44px;height:22px;color:#8a837a;margin:0 0 28px}.w svg{width:100%;height:100%}
.k{font:600 11px/1 "Helvetica Neue",Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#8a837a;margin:0 0 14px}
h1{font-weight:400;font-size:clamp(30px,6vw,44px);line-height:1.08;letter-spacing:-.01em;margin:0 0 16px}
p{margin:0 0 14px}.l{color:#cfc8bc}.t{font-size:14px;color:#8a837a;margin-top:6px;min-height:1.5em}
.r{display:flex;flex-wrap:wrap;gap:12px 22px;align-items:center;margin-top:22px}
a{color:#d9bc7c;text-decoration:none}a:hover,a:focus-visible{text-decoration:underline}
.b{display:inline-block;padding:12px 22px;border:1px solid #d9bc7c;color:#e9e4da;font:500 14px/1 "Helvetica Neue",Arial,sans-serif;letter-spacing:.04em}
.b:hover,.b:focus-visible{background:#d9bc7c;color:#0b0a09;text-decoration:none}
.a{font:14px/1 "Helvetica Neue",Arial,sans-serif;color:#a39b8f}
@media (prefers-reduced-motion:no-preference){.t[data-on]::after{content:"";display:inline-block;width:6px;height:6px;margin-left:8px;border-radius:50%;background:#8a837a;vertical-align:middle;animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.2}}}
</style></head>
<body data-wm-moment><main role="main">
<span class="w">${WAVE}</span>
<p class="k">${H(T.kicker)}</p>
<h1>${H(T.head)}</h1>
<p class="l">${H(T.line)}</p>
<p class="t" data-t aria-live="polite">${H(T.trying)}</p>
<noscript><p class="t">${H(T.noscript)}</p></noscript>
<p class="r"><a class="b" href="" data-again>${H(T.retry)}</a><a class="a" href="javascript:history.back()" data-back hidden>${H(T.back)}</a></p>
</main>
<script>(function(){
var W=${words},t=document.querySelector('[data-t]'),n=0,timer=null,busy=false,t0=Date.now();
var back=document.querySelector('[data-back]');if(history.length>1&&back){back.hidden=false;}
var again=document.querySelector('[data-again]');if(again)again.addEventListener('click',function(e){e.preventDefault();go(true);});
function home(){location.replace(location.href);}
function wait(){var s=Math.min(30,Math.round(3*Math.pow(1.5,n)));timer=setTimeout(function(){go(false)},s*1000+Math.random()*1000);}
function go(now){if(busy)return;busy=true;clearTimeout(timer);n++;if(t){t.setAttribute('data-on','');t.textContent=(Date.now()-t0>180000?W.still:W.tryingN+' ('+n+')');}
var c=('AbortController' in window)?new AbortController():null,k=setTimeout(function(){if(c)c.abort();},10000);
fetch(location.href,{cache:'no-store',credentials:'same-origin',redirect:'follow',signal:c?c.signal:undefined}).then(function(r){clearTimeout(k);busy=false;
if(r.status>=500||r.headers.get('x-wm-moment')){wait();return;}
/* an edge set to answer this page as 200 would look like the house: read it before leaving */
return r.text().then(function(b){if(b.indexOf('data-wm-moment')<0)home();else wait();});}).catch(function(){clearTimeout(k);busy=false;wait();});}
addEventListener('online',function(){go(true)});document.addEventListener('visibilitychange',function(){if(!document.hidden)go(true)});
wait();})();</script>
</body></html>
`;
}

module.exports = { COPY, mountBreaks, momentPage, wants, isLimit, sqlOf };
