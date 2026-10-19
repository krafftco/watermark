// The Studio door (Will, 19 Oct: security 1/6). The back office opens to named people, not to a shared password.
// STUDIO_EMAILS (comma-separated, in Render) names who may enter. Two factors, ten minutes apart at most:
// the email code (or the one-tap link in that mail: possession of the inbox) and the person's passkey (Face ID,
// Touch ID, a phone: possession of the device and the person). Until the person has a passkey the code alone
// opens the door and the page asks them to add one; once a passkey exists it is required. Every opening is told
// on the register (`studio.opened`, hidden) with its factors. ADMIN_PASSWORD still answers only while
// STUDIO_EMAILS is unset (development, tests); the page says so.
const LIFE = 10 * 60 * 1000;

function mountDoor(app, { db, C, V, ledger, buyerOf, openStudio, isStudio, passkeysOf }) {
  db.exec(`CREATE TABLE IF NOT EXISTS studio_factors (id INTEGER PRIMARY KEY, email TEXT NOT NULL, factor TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS studio_factors_email ON studio_factors(email, at)`);
  const list = () => String(process.env.STUDIO_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const named = email => list().includes(String(email || '').trim().toLowerCase());
  const keysFor = email => { const b = db.prepare('SELECT * FROM buyers WHERE lower(email)=lower(?)').get(email); return b ? passkeysOf(b) : []; };
  const fresh = email => { const since = Date.now() - LIFE; db.prepare('DELETE FROM studio_factors WHERE at < ?').run(since - 864e5); return new Set(db.prepare('SELECT factor FROM studio_factors WHERE email=? AND at > ?').all(String(email).toLowerCase(), since).map(r => r.factor)); };
  const state = email => { const f = fresh(email), hasKey = keysFor(email).length > 0; const code = f.has('code') || f.has('link'); const key = f.has('passkey'); return { code, key, hasKey, open: code && (key || !hasKey) }; };

  // Called by the sign-in (code, link) and the passkey verification. Returns true when the door opened.
  function factor(req, res, email, which) {
    email = String(email || '').trim().toLowerCase(); if (!email || !named(email)) return false;
    db.prepare('INSERT INTO studio_factors (email, factor, at) VALUES (?,?,?)').run(email, which, Date.now());
    const s = state(email);
    if (!s.open || isStudio(req)) return s.open;
    openStudio(res);
    db.prepare('DELETE FROM studio_factors WHERE email=?').run(email);
    try { ledger.append(db, 'studio.opened', email.replace(/@.*/, '@…'), { factors: s.key ? 'code+passkey' : 'code', passkey: s.hasKey }); } catch (e) { /* */ }
    return true;
  }
  app.locals.studioFactor = factor;
  app.locals.studioNamed = named;
  app.locals.studioDoor = { list, named, state };

  // The door page: where you are in the two steps.
  app.get('/studio/door', (req, res) => {
    if (isStudio(req)) return res.redirect('/studio');
    const b = buyerOf(req); const email = b && b.email && named(b.email) ? b.email : null;
    const s = email ? state(email) : null;
    const esc = V.esc;
    res.send(V.layout({ title: 'The door · Studio · Watermark', path: '/studio/door', body: `<section class="narrow dr"><p class="k">Studio</p><h1>The door.</h1>
${!list().length ? `<p class="err">No one is named at the door yet. Set <code>STUDIO_EMAILS</code> on the server to the addresses that may enter; until then <a href="/studio/login">the password</a> answers.</p>` : ''}
<ol class="dr-steps">
<li class="${s && s.code ? 'done' : email ? 'now' : 'now'}"><b>Your email code.</b> ${s && s.code ? 'Done.' : `<a class="buy-btn" href="/signin?next=/studio/door">Sign in with your email</a>`}${email && !(s && s.code) ? `<small>Signed in as ${esc(email)}; the door needs a fresh code.</small>` : ''}</li>
<li class="${s && s.code ? (s.key || !s.hasKey ? 'done' : 'now') : ''}"><b>Your passkey.</b> ${s && s.code ? (s.hasKey ? (s.key ? 'Done.' : `<button type="button" class="buy-btn" data-door-key>Use your passkey</button><small>Face ID, Touch ID or your phone.</small>`) : `<span>You have none yet, so the code alone opens the door today. <a href="/yours?tab=settings#passkey">Add a passkey</a> and it will be asked for from then on.</span>`) : '<small>After the code.</small>'}</li>
</ol>
${s && s.open ? `<p class="ok">The door is open. <a href="/studio">Into the studio →</a></p>` : ''}
<p class="note">Two factors, ten minutes apart at most: the code proves the inbox, the passkey proves the device and the person. Every opening is on the register.</p>
<script src="/static/webauthn.js"></script><script>(function(){var b=document.querySelector('[data-door-key]');if(!b)return;b.addEventListener('click',async function(){try{var W=window.SimpleWebAuthnBrowser;var o=await fetch('/auth/passkey/login/options',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'}).then(function(r){return r.json()});var a=await W.startAuthentication({optionsJSON:o});var v=await fetch('/auth/passkey/login/verify',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(a)}).then(function(r){return r.json()});location.href=v.ok?'/studio':'/studio/door?no=1';}catch(e){b.textContent='That did not work. Try again.';}});})();</script></section>` }));
  });
}
module.exports = { mountDoor };
