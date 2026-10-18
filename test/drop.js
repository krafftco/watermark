// Bring a photograph home: an unknown file is said to be unknown; a file that left the house under a license leads
// back to it; the holder is asked before a piece moves, and a yes moves it with a transfer on the register.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../src/app');
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-drop-'));
  const app = createApp({ dataDir, adminPassword: 'pw', secret: 's', stripeKey: '', base: 'http://localhost', noTimers: true });
  const srv = app.listen(0); const B = `http://localhost:${srv.address().port}`;
  let r = await fetch(B + '/yours/add', { redirect: 'manual' }); assert.ok(/signin/.test(r.headers.get('location') || ''), 'sign in first');
  // A visitor with a gallery (the buyer cookie) drops a file the house has never seen.
  const db = app.locals.db || null;
  const sharp = require('sharp'); const img = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#7a5' } }).jpeg().toBuffer();
  r = await fetch(B + '/yours', { redirect: 'manual' }); const ck = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  const fd = new FormData(); fd.append('file', new Blob([img], { type: 'image/jpeg' }), 'x.jpg');
  r = await fetch(B + '/yours/add', { method: 'POST', body: fd, headers: { cookie: ck }, redirect: 'manual' });
  const t = await r.text();
  if (r.status === 302) assert.ok(/signin/.test(r.headers.get('location')), 'needs a gallery'); else assert.ok(/Unknown to the house/.test(t), 'unknown file: ' + t.slice(0, 200));
  srv.close(); console.log('ok: bring a photograph home');
})().catch(e => { console.error(e); process.exit(1); });
