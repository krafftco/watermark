// What each source asks of a machine (#170, src/asks.js): the Library of Congress at their 10 a minute across every job;
// the Art Institute's AIC-User-Agent on every request to its API and IIIF server, the contact from HOUSE_EMAIL; Project
// Gutenberg and Gutendex not read by machine (timers, boot chores, the Studio's presses) until Will lifts the pause, the
// desk saying so, and the books already in the house as they were.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const A = require('../src/asks');
(async () => {
  // 1. The pace, on a test's clock: three loc.gov requests at once leave 6 s apart; another host is not held.
  A.reset(); let t = 1000; const slept = []; const sent = [];
  const f = A.wrap(async (u, o) => { sent.push({ u: String(u), h: (o && o.headers) || {} }); return new Response('{}'); }, { sleep: async ms => { slept.push(ms); }, now: () => t });
  await f('https://www.loc.gov/collections/x/?fo=json'); await f('https://tile.loc.gov/storage/a.pdf'); await f('https://www.loc.gov/item/b/');
  await f('https://example.org/x');
  assert.deepEqual(slept, [6000, 12000], 'loc.gov at one request every 6 s, any of its hosts: ' + JSON.stringify(slept));
  assert.equal(A.LOC_GAP_MS * 10, 60000, 'ten a minute');
  t += 60000; slept.length = 0; await f('https://www.loc.gov/item/c/'); assert.deepEqual(slept, [], 'after a quiet minute, no wait');
  // 2. The Art Institute's header, with the contact from the setting; nowhere else.
  const was = process.env.HOUSE_EMAIL; process.env.HOUSE_EMAIL = 'desk@house.example';
  sent.length = 0; await f('https://api.artic.edu/api/v1/artworks/search?q=x', { headers: { accept: 'application/json' } }); await f('https://www.artic.edu/iiif/2/abc/full/max/0/default.jpg'); await f('https://collectionapi.metmuseum.org/x');
  assert.ok(sent[0].h['AIC-User-Agent'] === 'Watermark (https://watermark.krafftco.com; desk@house.example)' && sent[0].h.accept === 'application/json', 'the API, with its own headers kept: ' + JSON.stringify(sent[0].h));
  assert.ok(sent[1].h['AIC-User-Agent'], 'the IIIF server'); assert.ok(!sent[2].h['AIC-User-Agent'], 'never another museum');
  assert.ok(/size/.test('size') && sent[1].u.endsWith('/full/max/0/default.jpg'), 'the size taken is not changed here');
  delete process.env.HOUSE_EMAIL; assert.equal(A.aicAgent(), 'Watermark (https://watermark.krafftco.com)', 'no setting, no address'); if (was) process.env.HOUSE_EMAIL = was;
  // 3. Gutenberg and Gutendex paused; their harvest endpoint (the way they offer) is not; Will's switch lifts it.
  for (const u of ['https://www.gutenberg.org/ebooks/1342.txt.utf-8', 'https://www.gutenberg.org/ebooks/search.opds/?query=x', 'https://gutenberg.org/cache/epub/1/pg1.txt', 'https://gutendex.com/books/?search=x']) {
    let e = null; try { await f(u); } catch (x) { e = x; } assert.ok(e && e.paused && e.message === A.PAUSED_LINE, 'paused: ' + u);
  }
  await f('https://www.gutenberg.org/robot/harvest?filetypes[]=txt'); assert.ok(sent.some(s => /robot\/harvest/.test(s.u)), 'the harvest endpoint is theirs to offer');
  process.env.GUTENBERG_OPEN = '1'; await f('https://gutendex.com/books/1'); delete process.env.GUTENBERG_OPEN;

  // 4. In the house: the importers' fetch keeps the asks; the Studio's presses say the line and ask nothing.
  const { createApp } = require('../src/app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-asks-')); const asked = [];
  const fetchImpl = async (u, o) => { asked.push({ u: String(u), h: (o && o.headers) || {} }); return new Response(JSON.stringify({ data: [], pagination: { total: 0 }, results: [] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'asks', noTimers: true, vaultNow: true, fetchImpl });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; } return r; });
  const form = (p, b) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  await form('/studio/login', { password: 'pw' });
  await app.locals.scout.search('aic', { q: 'seurat' }).catch(() => null);
  assert.ok(asked.some(a => /api\.artic\.edu/.test(a.u) && a.h['AIC-User-Agent']), 'the scout’s Art Institute search carries the header');
  A.reset(); await app.locals.iiif.doFetch('https://www.loc.gov/a/'); await app.locals.iiif.doFetch('https://www.loc.gov/b/');
  { const ws = A.log.map(x => x.wait); assert.ok(ws.length === 2 && ws[0] === 0 && ws[1] > 5000 && ws[1] <= 6000, JSON.stringify(ws) + ' '); } assert.ok(true, 'the feeds’ loc.gov requests are paced (a test does not sleep, the wait is still set)');
  const n0 = asked.length;
  let r = await go('/studio/reading'); let h = await r.text(); assert.ok(h.includes(A.PAUSED_LINE), 'the desk says so');
  r = await go('/studio/reading?q=pride'); h = await r.text(); assert.ok(h.includes(A.PAUSED_LINE) && !/Bring in No\./.test(h), 'no search of Gutendex');
  for (const p of ['/studio/reading/bring', '/studio/reading/canon', '/studio/reading/pictures']) { r = await form(p, { id: '1342' }); assert.ok(decodeURIComponent(r.headers.get('location') || '').includes(A.PAUSED_LINE), p + ' says the line'); }
  db.prepare("INSERT INTO texts (slug, kind, title, author, body, public, status, source, terms) VALUES ('a-held-book','book','A Held Book','An Author','# One\n\nA line of the book, long enough to be a paragraph of it.',1,'held','https://www.gutenberg.org/ebooks/99','Public domain.')").run();
  r = await form('/studio/reading/a-held-book/pictures', {}); assert.ok(decodeURIComponent(r.headers.get('location') || '').includes(A.PAUSED_LINE), 'a book’s pictures press says the line');
  assert.equal(await app.locals.shelves.backfill(), null, 'the shelves’ boot chore asks Gutendex nothing');
  assert.equal(asked.length, n0, 'not one request left the house: ' + JSON.stringify(asked.slice(n0).map(a => a.u)));
  r = await go('/read/a-held-book'); assert.equal(r.status, 200, 'a book already in the house stays as it was');
  srv.close(); fs.rmSync(dir, { recursive: true, force: true }); console.log('the sources’ asks: holds'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
