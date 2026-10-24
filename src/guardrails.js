// Guardrails. The house will one day be a target; this is the first line, kept plain so it can be read.
//  - Headers on every response: a content security policy, no framing, strict referrers, HSTS, no sniffing.
//  - Cross-site writes refused: a POST must come from the house's own origin (or the Krafft sites for the
//    few shared endpoints), so no page elsewhere can act in a signed-in visitor's name.
//  - Rates: sign-in codes, passkeys, the Studio door, uploads, notes and the market are limited per address,
//    so a password or a code cannot be guessed and a form cannot be flooded. Counts live in memory per
//    instance; good for one box, and the shape to move to a shared store when there are many.
//  - Stripe webhooks are checked by signature elsewhere (app.js); the register is signed (ledger.js);
//    secrets never leave the host's environment; every query is prepared; every string is escaped on output.
const ALLOWED_ORIGINS = /^https:\/\/([a-z0-9-]+\.)?(krafftco\.com|wrkfullerton\.com)$/i;

function securityHeaders(base) {
  const https = String(base || '').startsWith('https');
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https://archive.org https://*.archive.org",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    // the vault, for arrivals put straight into the bucket from the Masters desk (S3, or an S3-compatible endpoint)
    `connect-src 'self' https://api.stripe.com https://studios.krafftco.com https://*.krafftco.com${process.env.S3_BUCKET ? ' https://*.amazonaws.com' : ''}${process.env.S3_ENDPOINT ? ' ' + String(process.env.S3_ENDPOINT).replace(/\/$/, '') + ' https://*.' + String(process.env.S3_ENDPOINT).replace(/^https?:\/\//, '').replace(/\/.*$/, '') : ''}`,
    "frame-src https://js.stripe.com https://checkout.stripe.com",
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
  return (req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com"), xr-spatial-tracking=(self), interest-cohort=()');
    res.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (https) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // house.js and k.js are loaded by other Krafft sites and must stay embeddable as scripts; the policy
    // governs documents, so it is set only on HTML responses.
    const p = req.path;
    if (!/\.(js|css|json|svg|png|jpg|jpeg|webp|pdf|wmk)$/i.test(p) && !p.startsWith('/img/') && !p.startsWith('/api/') && !p.startsWith('/d/')) res.set('Content-Security-Policy', csp);
    next();
  };
}

// A POST, PUT or DELETE must come from the house itself. Stripe's webhook and the public JSON endpoints
// that other Krafft sites call are allowed through by path.
function sameOrigin(base) {
  const self = (() => { try { return new URL(base).host.toLowerCase(); } catch (e) { return ''; } })();
  const OPEN = [/^\/stripe\/webhook$/, /^\/api\//, /^\/w\/[^/]+\/(capture|stood)$/];
  return (req, res, next) => {
    if (!/^(POST|PUT|PATCH|DELETE)$/.test(req.method)) return next();
    if (OPEN.some(r => r.test(req.path))) return next();
    const origin = req.get('origin') || (req.get('referer') ? (() => { try { return new URL(req.get('referer')).origin; } catch (e) { return ''; } })() : '');
    if (!origin) return next(); // old browsers, curl and the tests send none; the cookie's SameSite=Lax is the second lock
    let host = ''; try { host = new URL(origin).host.toLowerCase(); } catch (e) { /* malformed */ }
    const ok = host === self || host === req.get('host') || ALLOWED_ORIGINS.test(origin) || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    if (!ok) return res.status(403).send('Refused: this request did not come from Watermark.');
    next();
  };
}

// Fixed-window limits per address, per group. Small and in memory; enough to stop guessing and flooding.
function limiter({ windowMs, max, name }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now > v.reset) hits.delete(k); }, Math.max(windowMs, 60000)).unref();
  return (req, res, next) => {
    const ip = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, ''); const k = name + ':' + ip; const now = Date.now();
    let v = hits.get(k); if (!v || now > v.reset) { v = { n: 0, reset: now + windowMs }; hits.set(k, v); }
    v.n++;
    res.set('X-RateLimit-Limit', String(max)); res.set('X-RateLimit-Remaining', String(Math.max(0, max - v.n)));
    if (v.n > max) { res.set('Retry-After', String(Math.ceil((v.reset - now) / 1000))); return res.status(429).type('text/plain').send(`Too many tries. Wait ${Math.ceil((v.reset - now) / 1000)} seconds.`); }
    next();
  };
}

function mountGuardrails(app, { base }) {
  app.use(securityHeaders(base));
  app.use(sameOrigin(base));
  const L = (name, max, windowMs) => limiter({ name, max, windowMs });
  // The doors: codes, passkeys, the Studio password, joining.
  app.use(['/signin/code'], L('code', 8, 15 * 60000));
  app.use(['/signin/verify'], L('verify', 20, 15 * 60000));
  app.use(['/auth'], L('auth', 40, 15 * 60000));
  app.post('/studio/login', L('studio', 10, 15 * 60000));
  app.post('/join', L('join', 5, 60 * 60000));
  // The books and the market: no flooding.
  app.post(['/guestbook', '/w/:slug/notes', '/collector/:code/notes'], L('notes', 20, 10 * 60000));
  app.post(['/w/:slug/applaud', '/collector/:code/hat'], L('hat', 120, 10 * 60000));
  app.post(['/account/works/one', '/studio/works'], L('upload', 400, 60 * 60000));
  // The public doors a stranger may bring a file to (21 Oct, the bag check): a handful an hour each, never a flood.
  app.post(['/verify', '/yours/add', '/w/:slug/claim', '/cabinet/add'], L('bring', 30, 60 * 60000));
  app.post(['/account/deliveries', '/trade/quote', '/rights/:handle', '/feedback'], L('ask', 40, 60 * 60000));
  app.post(['/swap', '/yours/send', '/yours/offer', '/market/:id/bid', '/w/:slug/offer', '/friends', '/m/:slug/patron'], L('money', 60, 10 * 60000));
  app.use(['/w/:slug/capture', '/w/:slug/stood'], L('beacon', 600, 10 * 60000));
}

module.exports = { mountGuardrails, securityHeaders, sameOrigin, limiter };
