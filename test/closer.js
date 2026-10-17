// Look closer: a guide is written from the image and record, shown marked as AI, and the maker can correct, approve and hide it.
const assert = require('assert');
const express = require('express');
const Database = require('better-sqlite3');
process.env.ANTHROPIC_API_KEY = 'test-key'; process.env.NODE_ENV = 'test';
const V = require('../src/views');
const { mountCloser } = require('../src/closer');
(async () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE works (id INTEGER PRIMARY KEY, maker_id INTEGER, slug TEXT, title TEXT, place TEXT, taken_at TEXT, camera TEXT, lens TEXT, caption TEXT, keywords TEXT, status TEXT)");
  db.prepare("INSERT INTO works (maker_id, slug, title, place, taken_at, camera, status) VALUES (1,'dome','The Dome of the Pantheon','Rome, Italy','2024-05-01','Leica Q3','held')").run();
  let sent = null;
  const fetchImpl = async (url, o) => { sent = JSON.parse(o.body); return { ok: true, json: async () => ({ model: 'claude-test', content: [{ type: 'text', text: 'An oculus open to the sky.\n\nThe light falls in a disc.' }] }) }; };
  const app = express(); app.use(express.urlencoded({ extended: false }));
  let studio = true; const ledgerLog = [];
  mountCloser(app, { db, C: {}, studioOnly: (q, r, n) => n(), isStudio: () => studio, makerOf: () => null, imageOf: async () => Buffer.from('jpeg'),
    ledger: { append: (d, t, s) => ledgerLog.push(t) }, V, fetchImpl });
  assert.strictEqual(await app.locals.closerFill(), 1, 'one guide written');
  assert.ok(sent.messages[0].content[0].type === 'image' && /Rome, Italy/.test(sent.messages[0].content[1].text), 'image and record sent');
  assert.ok(/Never identify/.test(sent.system), 'no identifying people');
  let w = db.prepare('SELECT * FROM works').get(); let c = app.locals.closerOf(w);
  assert.strictEqual(c.state, 'shown'); assert.deepStrictEqual(ledgerLog, ['work.guide']);
  const html = V.work ? null : null; // the block renders through views
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (body) => fetch(`${base}/closer/dome`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  await post({ act: 'save', text: 'An oculus, nine metres across.' });
  c = app.locals.closerOf(db.prepare('SELECT * FROM works').get()); assert.strictEqual(c.state, 'approved'); assert.ok(c.edited);
  await post({ act: 'hide' }); assert.strictEqual(app.locals.closerOf(db.prepare('SELECT * FROM works').get()), null, 'hidden');
  await post({ act: 'show' }); assert.strictEqual(app.locals.closerOf(db.prepare('SELECT * FROM works').get()).state, 'approved');
  studio = false; const r = await post({ act: 'hide' }); assert.strictEqual(r.status, 403, 'only the maker or the Studio');
  const page = await (await fetch(`${base}/closer/dome`, { redirect: 'manual' })).status; assert.strictEqual(page, 302);
  srv.close(); console.log('ok: look closer');
})().catch(e => { console.error(e); process.exit(1); });
