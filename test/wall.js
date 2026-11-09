// The wall standard (7 Nov; Will: "if it can't meet frame-to-frame, it can't show"): the house's open walls show only
// a work whose master can fill a screen and that the standard has not read as soft or blank; the work stays on its
// maker's own page and in any chosen set; the house may say otherwise per work; a living maker's work is measured
// (never taken down) and a 'down' reading keeps it off the open walls only.
process.env.NODE_ENV = 'test'; process.env.FRICK_PARALLEL = '1';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-wall-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'wall', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; } return r; });
  const W = app.locals.wall; assert.strictEqual(W.WALL_MIN_PX, 800, 'the floor under test');
  db.prepare("INSERT INTO makers (handle, name, kind, joined_at, door) VALUES ('ada', 'Ada Lens', 'maker', datetime('now'), 'house')").run();
  const ada = db.prepare("SELECT * FROM makers WHERE handle='ada'").get();
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const put = async (buf, title) => { const f = path.join(dir, `in-${++k}.jpg`); fs.writeFileSync(f, buf); const w = await app.locals.registerWork({ file: f, title, makerId: ada.id, place: 'Paris', originalName: path.basename(f) }); db.prepare("UPDATE works SET status='held', stars=5, curated=1 WHERE slug=?").run(w.slug); return w.slug; };
  const big = await put(await sharp(fx).resize(1800, 1200, { fit: 'fill' }).sharpen().jpeg({ quality: 95 }).toBuffer(), 'The Big One');
  const fine = await put(fs.readFileSync(fx), 'The Fine One'); // 1,200 px: over the test floor
  const small = await put(await sharp(fx).resize(600).jpeg().toBuffer(), 'The Small One'); // 600 px: under it
  const onFeed = async () => (await (await go('/api/stroll?n=20')).json()).items.map(i => i.slug);
  const inWalk = () => { app.locals.walk.forget('collection'); return (app.locals.walk.list('collection') || { works: [] }).works.map(w => w.slug); };
  // 1. The floor: the small one is not on the open wander, the collection walk, today's pool or the maker's Latest; the others are.
  let feed = await onFeed(); assert.ok(feed.includes(big) && feed.includes(fine) && !feed.includes(small), 'the open wander: ' + feed.join(','));
  let walk = inWalk(); assert.ok(walk.includes(fine) && !walk.includes(small), 'the collection walk: ' + walk.join(','));
  { const pool = new Set(); for (let i = 0; i < 1; i++) { const t = app.locals.todays(); if (t) pool.add(t.slug); } assert.ok(!pool.has(small), 'today never the small one'); }
  assert.ok(!W.holds(db.prepare('SELECT * FROM works WHERE slug=?').get(small)).ok && W.holds(db.prepare('SELECT * FROM works WHERE slug=?').get(fine)).ok, 'holds()');
  // 2. The maker's own page and a chosen set still show it.
  let t = await (await go(`/wander?maker=ada-lens`)).text(); assert.ok(t.includes(small), 'a maker’s wander shows the small one');
  t = await (await go(`/m/ada-lens/${small}`)).text(); assert.ok(t.includes('The Small One'), 'its own page');
  t = await (await go(`/w/${small}`)).text(); assert.ok(t.includes('The Small One') && !t.includes('Not on the house’s open walls'), 'the public page says nothing of it');
  assert.ok(t.includes('In the collection') && !t.includes('onv-on'), 'the small one: in the collection, not on view'); t = await (await go(`/w/${fine}`)).text(); assert.ok(t.includes('onv-on') && t.includes('On view'), 'the fine one: on view');
  // 3. The record says why, and the house may say otherwise.
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  t = await (await go(`/studio/works/${small}`)).text(); assert.ok(t.includes('Not on the house’s open walls') && t.includes('600 px on the long side'), 'the record’s line');
  let r = await go(`/studio/works/${small}/wall`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'wall=on&json=1' }); assert.strictEqual((await r.json()).wall, 'on');
  feed = await onFeed(); assert.ok(feed.includes(small), 'the house’s say puts it on');
  r = await go(`/studio/works/${big}/wall`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'wall=off&json=1' }); assert.strictEqual((await r.json()).wall, 'off');
  feed = await onFeed(); assert.ok(!feed.includes(big), 'the house’s say takes it off');
  await go(`/studio/works/${big}/wall`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'wall=&json=1' });
  await go(`/studio/works/${small}/wall`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'wall=&json=1' });
  // 4. Living makers read by the standard: the house measures, never takes down; a 'down' keeps it off the open walls only.
  const F = app.locals.frick; let calls = 0; F.transport = async () => { calls++; throw new Error('Al is never asked about a living maker'); };
  const j = F.run({ living: true }); for (let i = 0; i < 600 && j.running; i++) await new Promise(r2 => setTimeout(r2, 50));
  assert.ok(!j.running && j.failed === 0 && j.total === 3 && !j.auto, JSON.stringify(j)); assert.strictEqual(calls, 0);
  const rd = s => JSON.parse(db.prepare('SELECT frick FROM works WHERE slug=?').get(s).frick || 'null');
  assert.strictEqual(rd(small).verdict, 'down', 'the small one read down: ' + JSON.stringify(rd(small)));
  assert.strictEqual(db.prepare('SELECT status FROM works WHERE slug=?').get(small).status, 'held', 'never taken down by the house');
  assert.strictEqual(F.apply({ living: true }), 0, 'apply refuses the living scope');
  // a reading of down on the fine one (sharp enough, but the house reads a fault) keeps it off the open walls
  db.prepare('UPDATE works SET frick=? WHERE slug=?').run(JSON.stringify({ at: 'now', m: {}, house: [{ k: 'soft or blurred', hard: true, why: 'test' }], al: null, verdict: 'down', by: 'house' }), fine);
  feed = await onFeed(); assert.ok(!feed.includes(fine) && feed.includes(big), 'a down reading keeps it off: ' + feed.join(','));
  walk = inWalk(); assert.ok(!walk.includes(fine), 'and off the collection walk');
  t = await (await go(`/studio/works/${fine}`)).text(); assert.ok(t.includes('read by the standard: soft or blurred'), 'the record names the reading');
  F.keep(fine); feed = await onFeed(); assert.ok(feed.includes(fine), '“It hangs” puts it back: ' + feed.join(",") + " " + JSON.stringify(rd(fine)));
  t = await (await go('/studio/standard?living=1')).text(); assert.ok(t.includes('Living makers') && t.includes('never taken down by it'), 'the desk’s living scope');
  const c = W.counts(); assert.ok(c.n === 3 && c.ok === 2, JSON.stringify(c));
  srv.close(); console.log('wall: holds'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
