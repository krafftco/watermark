// The heavy doors (10 Nov): no crawler takes a master or has a book typeset; a person's dozen; one at a time.
process.env.NODE_ENV = 'test'; process.env.HEAVY_TEST = '1'; 
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
  const person = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1';
  const get = (p, ua, cookie) => fetch(base + p, { headers: Object.assign({ 'user-agent': ua, accept: 'text/html,*/*' }, cookie ? { cookie } : {}), redirect: 'manual' });
  const inside = 'wm_tz=America%2FNew_York'; // every page of the house sets one by script
  assert.equal(H.kindOf(`/open/${w.slug}/take`), 'master'); assert.equal(H.kindOf('/read/a-book.pdf'), 'master'); assert.equal(H.kindOf(`/w/${w.slug}/post.jpg`), 'draw'); assert.equal(H.kindOf(`/w/${w.slug}`), null);
  for (const ua of ['Mozilla/5.0 (compatible; GPTBot/1.2)', 'python-requests/2.31', 'Mozilla/5.0 (compatible; AhrefsBot/7.0)', '']) { const r = await get(`/open/${w.slug}/take`, ua, inside); assert.equal(r.status, 403, 'a crawler is not answered: ' + ua); await r.arrayBuffer(); }
  // a browser that has never been inside (a scraper following links, a link opened cold) is sent to the page the button is on
  let r = await get(`/open/${w.slug}/take`, person); assert.equal(r.status, 302, 'no cookie: back to the page'); assert.equal(r.headers.get('location'), `/w/${w.slug}#open`); await r.arrayBuffer();
  r = await get(`/w/${w.slug}/background/iphone`, person); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `/w/${w.slug}#backgrounds`); await r.arrayBuffer();
  // a person is never refused: forty in a row, then forty at once, every one answered with the file
  for (let i = 0; i < 40; i++) { const x = await get(`/open/${w.slug}/take`, person, inside); assert.equal(x.status, 200, 'take ' + i); assert.ok((x.headers.get('content-disposition') || '').includes('attachment')); await x.arrayBuffer(); }
  const all = await Promise.all(Array.from({ length: 40 }, () => get(`/open/${w.slug}/take`, person, inside).then(async x => { await x.arrayBuffer(); return x.status; })));
  assert.ok(all.every(c => c === 200), 'forty at once: ' + JSON.stringify(all));
  const bg = await Promise.all(['iphone', 'duo1', 'macbook', 'frame', 'tv', 'ipad'].map(k => get(`/w/${w.slug}/background/${k}`, person, inside).then(async x => { await x.arrayBuffer(); return x.status; })));
  assert.ok(bg.every(c => c === 200), 'every screen at once: ' + JSON.stringify(bg));
  r = await get('/read/no-such-book.pdf', 'Mozilla/5.0 (compatible; bingbot/2.0)'); assert.equal(r.status, 403, 'nor a book'); await r.arrayBuffer();
  r = await get(`/w/${w.slug}/post.jpg`, 'facebookexternalhit/1.1'); assert.notEqual(r.status, 403, 'a link preview still gets its card'); await r.arrayBuffer();
  r = await get(`/w/${w.slug}`, 'Mozilla/5.0 (compatible; Googlebot/2.1)'); assert.equal(r.status, 200, 'pages are for everyone'); await r.text();
  let st = H.state(); assert.ok(st.refused >= 5 && st.sentBack === 2 && st.turned === 0 && st.waited > 0 && st.master.on === 0 && st.master.waiting === 0, JSON.stringify(st));
  // an abandoned download does not hold the door
  await new Promise((ok, no) => { const rq = require('http').get(base + `/open/${w.slug}/take`, { headers: { 'user-agent': person, cookie: inside } }, rs => { rs.pause(); setTimeout(() => { try { assert.equal(H.state().master.on, 0, 'the lane is free once the answer has begun'); rs.destroy(); ok(); } catch (e) { no(e); } }, 150); }); rq.on('error', no); });
  // the page itself sets the cookie the door looks for
  r = await get(`/w/${w.slug}`, person); const page = await r.text(); assert.ok(/wm_tz=/.test(page), 'the page marks the browser as having been inside');
  r = await get('/robots.txt', person); const t = await r.text(); assert.ok(t.includes('Disallow: /open/*/take') && t.includes('Disallow: /read/*.pdf'));
  srv.close(); console.log('heavy: the doors hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
