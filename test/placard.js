'use strict';
// The placard (12 Nov): the house's card for Instagram. It says only what the record says.
process.env.NODE_ENV = 'test';
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const sharp = require('sharp'); const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-plc-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'plc', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const house = db.prepare('SELECT * FROM makers ORDER BY id LIMIT 1').get();
  const f = path.join(dir, 'a.jpg'); await sharp({ create: { width: 1600, height: 1100, channels: 3, background: { r: 60, g: 120, b: 90 } } }).jpeg().toFile(f);
  const w = await app.locals.registerWork({ file: f, title: 'The gardens', place: 'Paris', originalName: 'a.jpg', makerId: house.id });
  db.prepare("UPDATE works SET status='held' WHERE id=?").run(w.id);
  const get = async (u, h) => fetch(base + u, { headers: { cookie: 'wm_in=1', ...(h || {}) } });
  let r = await get(`/w/${w.slug}/placard.jpg`); assert.strictEqual(r.status, 200, 'the placard is made');
  assert.ok(/image\/jpeg/.test(r.headers.get('content-type')));
  const buf = Buffer.from(await r.arrayBuffer()); const m = await sharp(buf).metadata(); assert.strictEqual(m.width, 1080); assert.strictEqual(m.height, 1350);
  const row = db.prepare('SELECT * FROM works WHERE id=?').get(w.id);
  let st = app.locals.postIt.stateOf(row, { query: {}, cookies: {}, headers: {} });
  assert.ok(['on', 'kept'].includes(st.key), 'with nothing sold it is on view or kept: ' + st.key);
  assert.ok(!/\d+ (people|collectors)/.test(st.line + st.sub), 'never a count of people');
  // a piece collected: the card says so, and a holder's own card carries the number
  const use = db.prepare("SELECT id FROM uses WHERE key='social' ORDER BY id LIMIT 1").get();
  db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, price_cents, status, collector_no) VALUES ('WM-2026-000777', ?, ?, 'Ada', 'ada@example.com', 700, 'active', 3)").run(w.id, use.id);
  st = app.locals.postIt.stateOf(row, { query: {}, cookies: {}, headers: {} }); assert.strictEqual(st.key, 'collected');
  st = app.locals.postIt.stateOf(row, { query: { ref: 'WM-2026-000777' }, cookies: {}, headers: {} }); assert.strictEqual(st.key, 'mine'); assert.ok(/No\. 3/.test(st.line));
  st = app.locals.postIt.stateOf(row, { query: { ref: 'WM-2026-999999' }, cookies: {}, headers: {} }); assert.notStrictEqual(st.key, 'mine', 'a number that is not this work’s says nothing');
  r = await get(`/w/${w.slug}/placard.jpg?ref=WM-2026-000777&dl=1`); assert.strictEqual(r.status, 200); assert.ok(/private/.test(r.headers.get('cache-control'))); assert.ok(/attachment/.test(r.headers.get('content-disposition')));
  // a work kept back is never made a card
  db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(w.id);
  r = await get(`/w/${w.slug}/placard.jpg`); assert.strictEqual(r.status, 404);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], buf);
  console.log('the placard: ok'); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
