// Never a broken picture (9 Nov): a page that cannot load a picture tells the house; a missing copy takes the work off
// the open walls and is made again; repeated reports with the copy in place send it to the restoration room.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-picture-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'picture', noTimers: true, vaultNow: true });
  const { db } = app.locals; const P = app.locals.pictures; const images = require('../src/images'); const cache = path.join(dir, 'cache');
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const f = path.join(dir, 'in.jpg'); fs.copyFileSync(path.join(__dirname, 'fixture.jpg'), f);
  const w = await app.locals.registerWork({ file: f, title: 'The Chandelier', place: 'Paris', originalName: 'in.jpg' });
  db.prepare("UPDATE works SET status='held' WHERE slug=?").run(w.slug);
  await app.locals.copies.make(db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug));
  assert.ok(db.prepare('SELECT copies_at FROM works WHERE slug=?').get(w.slug).copies_at, 'copies made');
  // The copy is there: the visitor's connection; the third report inside the hour asks for a check.
  assert.equal(await P.failed(w.slug, 'screen'), 'sound'); assert.equal(await P.failed(w.slug, 'screen'), 'sound'); assert.equal(await P.failed(w.slug, 'screen'), 'check');
  assert.equal(await P.checks(), 1, 'the worker checks it'); assert.equal(db.prepare('SELECT state FROM picture_reports WHERE slug=?').get(w.slug).state, 'checked');
  assert.ok(db.prepare('SELECT copies_at FROM works WHERE slug=?').get(w.slug).copies_at, 'a sound work stays on the walls');
  // The copy is gone: off the open walls, a ticket, and made again.
  for (const fm of ['jpg', 'webp']) { try { fs.unlinkSync(images.fileOf(cache, w.slug, 'screen', fm)); } catch (e) { /* */ } }
  const r = await fetch(`${base}/api/picture/failed?s=${w.slug}&z=screen`, { method: 'POST', headers: { origin: 'http://localhost' } }); assert.equal(r.status, 204);
  for (let i = 0; i < 40 && db.prepare('SELECT copies_at FROM works WHERE slug=?').get(w.slug).copies_at; i++) await new Promise(x => setTimeout(x, 50));
  assert.equal(db.prepare('SELECT copies_at FROM works WHERE slug=?').get(w.slug).copies_at, null, 'off the open walls until remade');
  assert.ok(db.prepare('SELECT 1 FROM render_asks WHERE slug=?').get(w.slug), 'a ticket for the scribes');
  assert.equal(db.prepare('SELECT state FROM picture_reports WHERE slug=?').get(w.slug).state, 'remaking');
  await app.locals.copies.make(db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug));
  assert.ok(fs.existsSync(images.fileOf(cache, w.slug, 'screen', 'jpg')) && db.prepare('SELECT copies_at FROM works WHERE slug=?').get(w.slug).copies_at, 'made again, back on the walls');
  // A work not on view, or unknown, is nothing to report.
  assert.equal(await P.failed('no-such-work', 'screen'), 'not on view');
  // The page keeps a failed picture unseen, tries again, and tells the house.
  const html = await (await fetch(`${base}/about`)).text(); assert.ok(html.includes('/api/picture/failed') && html.includes('wm-ld'), 'the head script');
  srv.close(); console.log('picture: never a broken one'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
