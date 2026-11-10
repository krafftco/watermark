// The heavy doors (10 Nov): no crawler takes a master or has a book typeset; a person's dozen; one at a time.
process.env.NODE_ENV = 'test'; process.env.HEAVY_TEST = '1'; process.env.HEAVY_PER_10MIN = '3';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-heavy-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'heavy', noTimers: true, vaultNow: true });
  const { db } = app.locals; const H = app.locals.heavy;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const f = path.join(dir, 'in.jpg'); fs.copyFileSync(path.join(__dirname, 'fixture.jpg'), f);
  const w = await app.locals.registerWork({ file: f, title: 'Open Work', place: 'Paris', originalName: 'in.jpg' });
  db.prepare("UPDATE works SET status='held', open='cc0' WHERE slug=?").run(w.slug);
  const get = (p, ua) => fetch(base + p, { headers: { 'user-agent': ua }, redirect: 'manual' });
  const person = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1';
  assert.equal(H.kindOf(`/open/${w.slug}/take`), 'master'); assert.equal(H.kindOf('/read/a-book.pdf'), 'master'); assert.equal(H.kindOf(`/w/${w.slug}/post.jpg`), 'draw'); assert.equal(H.kindOf(`/w/${w.slug}`), null);
  for (const ua of ['Mozilla/5.0 (compatible; GPTBot/1.2)', 'python-requests/2.31', 'Mozilla/5.0 (compatible; AhrefsBot/7.0)', '']) { const r = await get(`/open/${w.slug}/take`, ua); assert.equal(r.status, 403, 'a crawler is not answered: ' + ua); await r.arrayBuffer(); }
  for (let i = 0; i < 3; i++) { const r = await get(`/open/${w.slug}/take`, person); assert.equal(r.status, 200, 'a person takes it'); await r.arrayBuffer(); }
  let r = await get(`/open/${w.slug}/take`, person); assert.equal(r.status, 429, 'past the count'); await r.arrayBuffer();
  r = await get('/read/no-such-book.pdf', 'Mozilla/5.0 (compatible; bingbot/2.0)'); assert.equal(r.status, 403, 'nor a book'); await r.arrayBuffer();
  r = await get(`/w/${w.slug}/post.jpg`, 'facebookexternalhit/1.1'); assert.notEqual(r.status, 403, 'a link preview still gets its card'); await r.arrayBuffer();
  r = await get(`/w/${w.slug}`, 'Mozilla/5.0 (compatible; Googlebot/2.1)'); assert.equal(r.status, 200, 'pages are for everyone'); await r.text();
  const st = H.state(); assert.ok(st.refused >= 5 && st.limited === 1 && st.master.on === 0 && st.master.waiting === 0, JSON.stringify(st));
  r = await get('/robots.txt', person); const t = await r.text(); assert.ok(t.includes('Disallow: /open/*/take') && t.includes('Disallow: /read/*.pdf'));
  srv.close(); console.log('heavy: the doors hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
