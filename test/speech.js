// The house voice: a guide is rendered once by the provider, kept, served; the same text is never rendered twice;
// a changed guide is read again; with no provider the route answers 404 so the page falls back to the browser's voice.
const assert = require('assert');
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mountSpeech, STYLE } = require('../src/speech');

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-speech-'));
  const db = new Database(':memory:');
  db.exec("CREATE TABLE works (id INTEGER PRIMARY KEY, slug TEXT, status TEXT, curated INTEGER DEFAULT 0, stars INTEGER DEFAULT 0, closer TEXT)");
  db.prepare("INSERT INTO works (slug, status, closer) VALUES ('dome','held',?)").run(JSON.stringify({ text: 'An oculus open to the sky.\n\nThe light falls in a disc.', state: 'shown' }));
  const closerOf = w => (w && w.closer ? JSON.parse(w.closer) : null);
  const stored = {}; const store = { put: async (k, local) => { stored[k] = fs.readFileSync(local); }, get: async k => stored[k] };
  let calls = 0;
  const fetchImpl = async (url, o) => { calls++; const b = JSON.parse(o.body); assert.strictEqual(b.instructions, STYLE); assert.ok(/oculus/.test(b.input)); return { ok: true, arrayBuffer: async () => Buffer.from('ID3mp3bytes:' + b.input.length) }; };
  const app = express();
  const saved = { NODE_ENV: process.env.NODE_ENV, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  // No provider, not test: 404.
  delete process.env.OPENAI_API_KEY; delete process.env.ELEVENLABS_API_KEY; process.env.NODE_ENV = 'development';
  const sp = mountSpeech(app, { db, C: { dataDir }, store, closerOf, fetchImpl });
  const srv = app.listen(0); const port = srv.address().port;
  const get = p => fetch(`http://localhost:${port}${p}`);
  assert.strictEqual((await get('/closer/dome/audio')).status, 404, 'no provider: 404');
  // A provider: rendered once, served, kept in the store.
  process.env.OPENAI_API_KEY = 'test-key';
  let r = await get('/closer/dome/audio'); assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('content-type'), 'audio/mpeg');
  assert.ok(/^ID3mp3bytes/.test(Buffer.from(await r.arrayBuffer()).toString()));
  assert.strictEqual(calls, 1);
  r = await get('/closer/dome/audio'); assert.strictEqual(r.status, 200); assert.strictEqual(calls, 1, 'served from the house, not rendered again');
  assert.ok(Object.keys(stored).some(k => /^speech\/dome-/.test(k)), 'kept in the vault');
  assert.strictEqual(await sp.fill(), 0, 'nothing left to read');
  // The guide changes: read again.
  db.prepare("UPDATE works SET closer=? WHERE slug='dome'").run(JSON.stringify({ text: 'An oculus, corrected.', state: 'approved' }));
  assert.strictEqual(await sp.fill(), 1, 'the corrected guide is read');
  assert.strictEqual(calls, 2);
  assert.strictEqual((await get('/closer/nope/audio')).status, 404);
  srv.close(); process.env.NODE_ENV = saved.NODE_ENV; if (saved.OPENAI_API_KEY) process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY; else delete process.env.OPENAI_API_KEY;
  console.log('ok: the house voice');
})().catch(e => { console.error(e); process.exit(1); });
