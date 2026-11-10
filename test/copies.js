// The copies (8 Nov; Will: "this thing needs to fly all the time"): the website never opens a master. A missing copy is
// answered with the nearest copy or the wall's dark and asked of the worker by a ticket; the worker makes the set and
// marks the work; once the backfill has read every work, the open walls show only work whose copies are made.
process.env.NODE_ENV = 'test'; process.env.NO_MASTER_ON_WEB = '1';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-copies-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'copies', noTimers: true, vaultNow: true });
  const { db } = app.locals; const CP = app.locals.copies; const W = app.locals.wall; assert.ok(CP && CP.noMaster(), 'the website of a split house');
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, kind, joined_at, door) VALUES ('ada', 'Ada Lens', 'maker', datetime('now'), 'house')").run();
  const ada = db.prepare("SELECT * FROM makers WHERE handle='ada'").get();
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const put = async (buf, title) => { const f = path.join(dir, `in-${++k}.jpg`); fs.writeFileSync(f, buf); const w = await app.locals.registerWork({ file: f, title, makerId: ada.id, place: 'Paris', originalName: path.basename(f) }); db.prepare("UPDATE works SET status='held', stars=5, curated=1 WHERE slug=?").run(w.slug); return db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug); };
  const a = await put(fs.readFileSync(fx), 'Unmade');
  const b = await put(await sharp(fx).modulate({ brightness: 0.7 }).jpeg().toBuffer(), 'Made');
  const cache = path.join(dir, 'cache'); const images = require('../src/images');
  // 1. Nothing made: the website answers the dark and writes a ticket; the master is never opened (no copy appears on the disk).
  let r = await fetch(`${base}/img/${a.slug}/screen`); assert.equal(r.status, 200); assert.equal(r.headers.get('x-making'), '1'); assert.ok(/svg/.test(r.headers.get('content-type')));
  assert.ok(!fs.existsSync(images.fileOf(cache, a.slug, 'screen', 'jpg')), 'no copy made on the website');
  assert.equal(db.prepare('SELECT n FROM render_asks WHERE slug=?').get(a.slug).n, 1, 'a ticket');
  await fetch(`${base}/img/${a.slug}/thumb`); assert.equal(db.prepare('SELECT n FROM render_asks WHERE slug=?').get(a.slug).n, 2, 'counted, one ticket');
  // 2. The worker drains: the set is made, the work marked, the ticket gone.
  assert.equal(await CP.drain(), 1); assert.ok(db.prepare('SELECT copies_at FROM works WHERE id=?').get(a.id).copies_at, 'marked'); assert.ok(!db.prepare('SELECT 1 FROM render_asks WHERE slug=?').get(a.slug));
  r = await fetch(`${base}/img/${a.slug}/screen`); assert.equal(r.status, 200); assert.ok(!r.headers.get('x-making')); assert.ok(/s-maxage=86400/.test(r.headers.get('cache-control')), r.headers.get('cache-control'));
  // 3. (9 Nov, the stall) The website does no picture work: the large copy exists, the WebP thumb is wanted: the nearest finished file is handed back as a stand-in, a ticket written, nothing decoded (the master is moved away first).
  const orig = fs.readdirSync(path.join(dir, 'originals')).filter(n => n.includes(b.slug)); assert.ok(orig.length);
  await CP.make(b); for (const n of orig) fs.renameSync(path.join(dir, 'originals', n), path.join(dir, 'originals', n + '.away'));
  for (const f of fs.readdirSync(cache)) if (f.startsWith(b.slug + '-') && /thumb|screen/.test(f)) fs.unlinkSync(path.join(cache, f));
  r = await fetch(`${base}/img/${b.slug}/thumb`, { headers: { accept: 'image/webp' } }); assert.equal(r.status, 200); assert.ok(r.headers.get('x-stand-in'), 'a stand-in, not a resize'); assert.ok(/private, no-store/.test(r.headers.get('cache-control')), 'never cached at the edge');
  assert.ok(!fs.existsSync(images.fileOf(cache, b.slug, 'thumb', 'webp')) && !fs.existsSync(images.fileOf(cache, b.slug, 'thumb', 'jpg')), 'nothing made on the website');
  assert.ok(db.prepare('SELECT 1 FROM render_asks WHERE slug=?').get(b.slug), 'the worker asked');
  const m = await sharp(Buffer.from(await r.arrayBuffer())).metadata(); assert.ok(m.width > 640, 'the larger finished copy, as it is: ' + JSON.stringify(m));
  for (const n of orig) fs.renameSync(path.join(dir, 'originals', n + '.away'), path.join(dir, 'originals', n));
  await CP.drain(); r = await fetch(`${base}/img/${b.slug}/thumb`, { headers: { accept: 'image/webp' } }); assert.equal(r.headers.get('content-type'), 'image/webp'); assert.ok(!r.headers.get('x-stand-in'), 'the worker made it');
  for (const n of orig) fs.renameSync(path.join(dir, 'originals', n), path.join(dir, 'originals', n + '.away'));
  for (const n of orig) fs.renameSync(path.join(dir, 'originals', n + '.away'), path.join(dir, 'originals', n));
  // 3b. (10 Nov) A phone's viewer asks for the wall copy, which is made only when asked: it is handed the large copy (the largest smaller one, never the thumb), the worker makes the wall copy, and the next look has it. A master no larger than the large copy answers with the large copy itself.
  const big = await put(await sharp({ create: { width: 4200, height: 2800, channels: 3, noise: { type: 'gaussian', mean: 120, sigma: 40 } } }).jpeg({ quality: 80 }).toBuffer(), 'Big'); await CP.make(big);
  r = await fetch(`${base}/img/${big.slug}/wall?f=jpg`); assert.ok(r.headers.get('x-stand-in'), 'a stand-in for the wall'); let mw = await sharp(Buffer.from(await r.arrayBuffer())).metadata(); assert.equal(mw.width, 2400, 'the large copy stands in, not the thumb: ' + mw.width);
  assert.equal(db.prepare('SELECT size FROM render_asks WHERE slug=?').get(big.slug).size, 'wall');
  await CP.drain(); r = await fetch(`${base}/img/${big.slug}/wall?f=jpg`); assert.ok(!r.headers.get('x-stand-in'), 'the wall copy, made'); mw = await sharp(Buffer.from(await r.arrayBuffer())).metadata(); assert.equal(mw.width, 3840);
  r = await fetch(`${base}/img/${a.slug}/wall?f=jpg`); assert.ok(!r.headers.get('x-stand-in') && !r.headers.get('x-making'), 'a small master: the large copy is the answer');
  // 4. The gate: before the backfill every work the standard allows is on the open walls; after, only work with its copies.
  const c = await put(await sharp(fx).modulate({ brightness: 1.3 }).jpeg().toBuffer(), 'Fresh');
  const feed = async () => (await (await fetch(`${base}/api/stroll?n=20`)).json()).items.map(i => i.slug);
  assert.ok(!W.gate()); let f = await feed(); assert.ok(f.includes(c.slug) && f.includes(a.slug), 'before the gate: ' + f.join(','));
  const job = await CP.backfill(); assert.ok(job.done && W.gate(), JSON.stringify(job)); assert.equal(job.missing, 1, 'only the fresh one is missing its copies: ' + JSON.stringify(job));
  f = await feed(); assert.ok(f.includes(a.slug) && f.includes(b.slug) && !f.includes(c.slug), 'after the gate the fresh one waits: ' + f.join(','));
  assert.ok(/copies are not yet made/.test(W.holds(db.prepare('SELECT * FROM works WHERE id=?').get(c.id)).why));
  const walk = () => { app.locals.walk.forget('collection'); return app.locals.walk.list('collection').works.map(w => w.slug); }; assert.ok(!walk().includes(c.slug), 'the collection walk too');
  CP.ask(c.slug); await CP.drain(); f = await feed(); assert.ok(f.includes(c.slug), 'made, it goes up by itself');
  const h = await (await fetch(`${base}/healthz`)).json(); assert.ok(h.copies && h.copies.gate === true && h.copies.made === 4, JSON.stringify(h.copies));
  srv.close(); console.log('copies: holds'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
