'use strict';
// Search asked of the database (9 Nov, the scale test): past FIND_DB_OVER works the house keeps no list of every work
// in memory; a search asks the database for candidates. Here it is forced on (FIND_DB=1) over a small house, so the
// road a 500,000-work house takes is walked on every run, on SQLite and on CI's Postgres.
process.env.FIND_DB = '1'; process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const sharp = require('sharp');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-finddb-'));
  const { createApp } = require('../src/app');
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 's', noTimers: true, vaultNow: true });
  const { registerWork, db } = app.locals;
  const mk = async (i, title, place, year) => { const f = path.join(dir, `f${i}.jpg`); await sharp({ create: { width: 1200, height: 800, channels: 3, noise: { type: 'gaussian', mean: 60 + i * 30, sigma: 25 } } }).jpeg().toFile(f); const w = await registerWork({ file: f, originalName: `f${i}.jpg`, title, place }); db.prepare("UPDATE works SET status='held', taken_at=?, stars=? WHERE id=?").run(`${year}-05-01 10:00:00`, 3 + i, w.id); return w; };
  const a = await mk(0, 'The Staircase', 'Paris', 2025), b = await mk(1, 'Sunset over the City', 'Florence', 2024), c = await mk(2, 'A Bell Tower', 'Florence', 1998);
  require('../src/indexes').ensure(db);
  const F = app.locals.find; const ix = F.index();
  assert.strictEqual(ix.big, true, 'the works stay in the database'); assert.strictEqual(ix.works.length, 0);
  assert.ok(ix.places.find(p => p.name === 'Florence' && p.n === 2), 'places counted by the database');
  assert.ok(ix.years.get(1998), 'years counted'); assert.ok(ix.makers.length >= 1 && ix.makers[0].n === 3, 'makers counted');
  const s = q => F.search(q, 12, null).works.map(w => w.slug);
  assert.deepStrictEqual(s('staircase'), [a.slug], 'by title');
  assert.strictEqual(s('florence').length, 2, 'by place');
  assert.deepStrictEqual(s('florence 1998'), [c.slug], 'two words, a place and a year');
  assert.deepStrictEqual(s('bell'), [c.slug], 'a word inside the title');
  assert.strictEqual(s(String(ix.makers[0].name).split(' ')[0].toLowerCase()).length, 3, 'by the maker’s name');
  assert.strictEqual(s('zzzzqq').length, 0, 'nothing by that word');
  if (db.kind === 'postgres') assert.ok(s('staircsae').includes(a.slug), 'a slip of the fingers, forgiven by the database');
  const be = F.before({ cookies: {} }); assert.ok(Array.isArray(be.places), 'before you type');
  // Wander by a word asks the same words.
  const http = require('http'); const srv = http.createServer(app).listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const j = await (await fetch(`${base}/api/stroll?n=8&q=florence`)).json(); const got = (j.items || []).map(x => x.slug).filter(x => !/^[trc]:/.test(x));
  assert.deepStrictEqual(got.sort(), [b.slug, c.slug].sort(), 'Wander by a word');
  const j2 = await (await fetch(`${base}/api/stroll?n=8&q=1998`)).json(); assert.ok((j2.items || []).some(x => x.slug === c.slug), 'Wander by a year');
  const j3 = await (await fetch(`${base}/api/stroll?n=8&q=o'brien%25_`)).json(); assert.ok(Array.isArray(j3.items), 'a quote or a wildcard in the word is only a word');
  srv.close(); console.log('finddb: search asked of the database holds'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
