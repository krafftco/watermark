// A break is handled by the house (#149, layer 4): a room that throws, a limit that fires, a bare status and an upload
// too large each end in the house's own page (the sign, the way back, a quiet try again when the fault passes) or, for
// a script, JSON with words; never a bare body. The fault is kept with its room and, for a limit, its statement.
// Layer 1's page (the edge's "one moment") is checked here too: self-contained, the house's look, it tries again.
// Run: NODE_ENV=test node test/breaks.js
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createApp } = require('../src/app.js');
const B = require('../src/breaks');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-breaks-'));
  const said = []; const err0 = console.error; console.error = (...a) => { said.push(a.join(' ')); };
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'breaks', noTimers: true, vaultNow: true });
  // Test rooms, first in the router: each breaks a different way.
  const limitErr = () => { const e = new Error('database: over the limit of 4000 ms'); e.status = 503; e.limit = true; e.code = '57014'; e.sql = 'SELECT slug FROM works WHERE maker_id=? ORDER BY stars DESC LIMIT 200'; return e; };
  const asyncLimit = () => { const e = new Error('canceling statement due to statement timeout\n  in: SELECT id FROM hits WHERE at > $1 LIMIT 50'); e.code = '57014'; return e; };
  app.get('/__break/throw', () => { throw new Error('the room gave way'); });
  app.get('/__break/async', async () => { await new Promise(r => setImmediate(r)); throw new Error('the async room gave way'); });
  app.get('/__break/limit', () => { throw limitErr(); });
  app.get('/__break/adb', async () => { throw asyncLimit(); });
  app.get('/__break/fault', (req, res) => { try { throw new Error('the vault did not answer'); } catch (e) { res.fault(e, 503); } });
  app.get('/__break/bare', (req, res) => res.sendStatus(500));
  app.post('/__break/form', (req, res) => res.sendStatus(403));
  app.get('/api/__break', () => { throw new Error('the api gave way'); });
  app.get('/img/__break/screen', (req, res) => res.sendStatus(500));
  const st = app.router.stack; for (let i = 0; i < 9; i++) st.unshift(st.pop());
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const nav = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  const script = { accept: '*/*', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' };
  const go = (p, h = nav, o = {}) => fetch(base + p, { redirect: 'manual', headers: h, ...o });
  const isSign = t => /<html/i.test(t) && /class="nf"/.test(t) && /href="\/collection"/.test(t);

  // A page door that throws: the house's page with its words, a Try again, the way back; never a trace.
  let r = await go('/__break/throw', { ...nav, referer: base + '/collection?q=sea' }); let t = await r.text();
  assert.strictEqual(r.status, 500); assert.ok(isSign(t), 'a thrown room: the house\'s own page');
  assert.ok(t.includes(B.COPY.room[500]) && !/the room gave way|at .*\.js:\d+/.test(t), 'in the house\'s words, no trace');
  assert.ok(t.includes(`href="/__break/throw">${B.COPY.room.retry}`), 'Try again, to the same address');
  assert.ok(t.includes(`href="/collection?q=sea">${B.COPY.room.back}`), 'and back to where they were');
  assert.ok(!t.includes('data-cold'), 'a room that gave way is not tried again by itself (it would give way again)');
  let F = app.locals.lastFault; assert.ok(F && F.room === '/__break/throw' && F.code === 500 && F.kind === 'error' && /gave way/.test(F.message) && F.stack, 'kept: ' + JSON.stringify(F));
  assert.ok(said.some(l => /^\[break\] 500 error GET \/__break\/throw: the room gave way/.test(l)), 'and logged');

  r = await go('/__break/async'); t = await r.text(); assert.strictEqual(r.status, 500); assert.ok(isSign(t), 'an async room that rejects: the same');
  assert.strictEqual(app.locals.lastFault.room, '/__break/async');

  // A limit: 503, the limit's words, Retry-After, a quiet try again; the statement kept without values.
  r = await go('/__break/limit'); t = await r.text();
  assert.strictEqual(r.status, 503); assert.strictEqual(r.headers.get('retry-after'), '60'); assert.ok(isSign(t) && t.includes('took too long, so it was stopped'), 'a limit, in words');
  assert.ok(t.includes('data-cold') && t.includes(B.COPY.room.trying), 'tried again by itself');
  F = app.locals.lastFault; assert.ok(F.kind === 'limit' && F.room === '/__break/limit' && F.sql === limitErr().sql, 'the statement kept: ' + JSON.stringify(F));
  assert.ok(said.some(l => /^\[break\] 503 limit GET \/__break\/limit: .*\| sql: SELECT slug FROM works/.test(l)), 'and logged with it');
  // The async path's limit (Postgres's own 57014, src/adb.js): the same page, the statement read from its message.
  r = await go('/__break/adb'); t = await r.text(); assert.strictEqual(r.status, 503); assert.ok(isSign(t) && /took too long/.test(t));
  assert.strictEqual(app.locals.lastFault.sql, 'SELECT id FROM hits WHERE at > $1 LIMIT 50');
  // The same limit to a script: JSON with words.
  r = await go('/__break/limit', script); let j = await r.json(); assert.strictEqual(r.status, 503); assert.ok(j.ok === false && /took too long/.test(j.why) && j.error === j.why, 'a script hears it in words');

  // A room that caught its own error (res.fault) and a bare sendStatus(500): the house's page; the first keeps its error.
  r = await go('/__break/fault'); t = await r.text(); assert.strictEqual(r.status, 503); assert.ok(isSign(t) && t.includes(B.COPY.room.passing) && t.includes('data-cold'));
  assert.ok(/vault did not answer/.test(app.locals.lastFault.message) && app.locals.lastFault.room === '/__break/fault');
  r = await go('/__break/bare'); t = await r.text(); assert.strictEqual(r.status, 500); assert.ok(isSign(t), 'sendStatus(500): the page');
  assert.ok(app.locals.lastFault.kind === 'status' && app.locals.lastFault.room === '/__break/bare', 'and kept, with its room');
  r = await go('/__break/bare', script); j = await r.json(); assert.ok(j.why === B.COPY.json[500], 'to a script, in words');

  // A form a person sent (a POST navigation) that is refused: the page, not 'Forbidden'.
  r = await go('/__break/form', nav, { method: 'POST' }); t = await r.text(); assert.strictEqual(r.status, 403); assert.ok(isSign(t), 'a refused form: the page');
  // An API door: JSON with words, however it is asked.
  r = await go('/api/__break', { accept: '*/*' }); j = await r.json(); assert.strictEqual(r.status, 500); assert.ok(j.why && j.ok === false, 'the API: JSON in words');
  r = await go('/api/nothing-here', { accept: '*/*' }); j = await r.json(); assert.strictEqual(r.status, 404); assert.ok(/no page at this address/.test(j.why), 'the API\'s 404 in words, not "Not Found"');
  // A picture keeps its plain status (an <img> cannot show a page), but a person who opens it is shown the page.
  r = await go('/img/__break/screen', { accept: 'image/avif,image/webp,*/*', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }); t = await r.text(); assert.strictEqual(r.status, 500); assert.ok(!/<html/i.test(t), 'an image: its status');
  r = await go('/img/__break/screen'); t = await r.text(); assert.ok(isSign(t), 'opened as a page: the page');
  // An upload too large (multer): the house's words, 413, not a 500.
  { const e = new Error('File too large'); e.code = 'LIMIT_FILE_SIZE'; e.name = 'MulterError';
    app.post('/__break/upload', () => { throw e; }); st.unshift(st.pop());
    r = await go('/__break/upload', nav, { method: 'POST' }); t = await r.text(); assert.strictEqual(r.status, 413); assert.ok(isSign(t) && t.includes(B.COPY.room.upload), 'too large: said so'); }
  // The Studio's health carries the faults.
  assert.ok(Array.isArray(app.locals.recentFaults) && app.locals.recentFaults.length >= 8 && app.locals.recentFaults[0].at, 'the last faults kept');
  // And the house is still open after all of it.
  r = await go('/'); assert.strictEqual(r.status, 200, 'the front page after every break'); await r.text();

  // Layer 1: the one-moment page. Asks nothing of any address, reads with scripts off, tries again, never 'blockchain'.
  const M = B.momentPage();
  assert.ok(!/<link\b|<img\b|\bsrc=|@import|url\(|fonts\.g/i.test(M), 'the page asks nothing of the house or anyone');
  assert.ok(/<noscript><meta http-equiv="refresh" content="20"><\/noscript>/.test(M) && /href="" data-again/.test(M), 'with scripts off it tries again itself, and Try again is a plain link');
  assert.ok(/background:#0b0a09/.test(M) && /data-wm-moment/.test(M) && /fetch\(location\.href/.test(M) && /location\.replace\(location\.href\)/.test(M), 'the dark wall; it asks the same address and returns there');
  assert.ok(!/blockchain|!/i.test(Object.values(B.COPY).map(o => Object.values(o).join(' ')).join(' ')), 'the words: no exclamation, never blockchain');
  r = await go('/static/cold.html'); t = await r.text(); assert.strictEqual(t, M, 'the house serves the same file at /static/cold.html'); assert.strictEqual(r.headers.get('x-wm-moment'), '1');
  // Its script, run against a house that is down and then up: it waits, then returns the visitor.
  { const s = M.match(/<script>([\s\S]*?)<\/script>/)[1]; let up = false, replaced = null; const timers = [];
    const env = { document: { querySelector: () => ({ hidden: true, addEventListener() {}, setAttribute() {}, set textContent(v) {} }), addEventListener() {}, hidden: false },
      history: { length: 1 }, location: { href: base + '/w/somewhere', replace: u => { replaced = u; } }, addEventListener() {}, setTimeout: (f, ms) => { if (ms !== 10000) timers.push(f); return timers.length; }, clearTimeout() {},
      fetch: async () => (up ? { status: 200, headers: { get: () => null }, text: async () => '<html>the house</html>' } : { status: 503, headers: { get: () => null }, text: async () => '' }), AbortController, Math, Date, JSON, window: {} };
    env.window = env; new Function(...Object.keys(env), s)(...Object.values(env));
    const tick = async () => { const f = timers.shift(); f(); await new Promise(r => setTimeout(r, 5)); };
    await tick(); assert.strictEqual(replaced, null, 'the house down: it waits');
    up = true; await tick(); assert.strictEqual(replaced, base + '/w/somewhere', 'the house up: back where they were'); }

  console.error = err0; srv.close(); try { app.locals.db.close(); } catch (x) {} fs.rmSync(dir, { recursive: true, force: true });
  console.log('breaks: every break ends in the house\'s page or words, and is kept'); process.exit(0);
})().catch(e => { console.error = console.log; console.error(e); process.exit(1); });
