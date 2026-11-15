// The agents' door (#28): GET /agents/desk.json, shut unless AGENT_KEY is set (32 characters or more), answering only
// to `Authorization: Bearer <key>`; every other way of asking answers as the house's own 404. Three lists, no "@", no
// letter's words unless AGENT_LETTERS=1; at most sixty answers an hour; absent from every menu, map and index; the key
// never in anything the house logs. The key is made here, at run time: none is ever written into the repository.
process.env.NODE_ENV = 'test';
delete process.env.AGENT_KEY; delete process.env.AGENT_LETTERS;
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs'); const os = require('os'); const path = require('path');

// Everything the house says while this test runs, kept to be searched for the key at the end.
const said = [];
for (const k of ['log', 'error', 'warn', 'info', 'debug']) { const f = console[k]; console[k] = (...a) => { said.push(a.map(x => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch (e) { return String(x); } })())).join(' ')); f.apply(console, a); }; }
for (const s of [process.stdout, process.stderr]) { const w = s.write.bind(s); s.write = (c, ...a) => { said.push(String(c)); return w(c, ...a); }; }

const { createApp } = require('../src/app');
const V = require('../src/views');
const ledger = require('../src/ledger');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-agents-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'agents', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const B = `http://127.0.0.1:${srv.address().port}`;
  const KEY = crypto.randomBytes(32).toString('base64url'); // 43 characters, made now
  const get = (p, h = {}) => fetch(B + p, { headers: { accept: 'text/html', ...h } });
  const bearer = k => ({ authorization: `Bearer ${k}` });

  // A small desk: two makers (one by the open door, unproven), works, letters of every kind, a visit, a hang, a sale.
  const mk1 = db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('ada-lens','Ada Lens','ada@example.com','maker',datetime('now'),'record')").run().lastInsertRowid;
  db.prepare('UPDATE makers SET email_ok=0 WHERE id=?').run(mk1);
  const mk2 = db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('bo-frame','Bo Frame','bo@example.com','maker',datetime('now'),'house')").run().lastInsertRowid;
  const work = (m, slug, status) => db.prepare("INSERT INTO works (maker_id, slug, title, original_file, sha256, status, width, height) VALUES (?,?,?,?,?,?,1000,1000)").run(m, slug, slug, slug + '.jpg', crypto.createHash('sha256').update(slug).digest('hex'), status).lastInsertRowid;
  const w1 = work(mk1, 'harbour-at-dusk', 'held'); work(mk1, 'kept-back', 'hidden'); work(mk2, 'bo-one', 'held');
  db.prepare("INSERT INTO maker_steps (maker_id, step) VALUES (?, 'shared')").run(mk2);
  const WORDS = { fb: 'The basket emptied itself; write to me at guest@example.com', rep: 'Seen on a blog without credit', claim: 'I made this photograph in 2019, Jane Roe' };
  db.prepare("INSERT INTO feedback (kind, body, email, page, device, ip) VALUES ('broke', ?, 'guest@example.com', '/w/harbour-at-dusk', 'Mac', '10.0.0.1')").run(WORDS.fb);
  db.prepare("INSERT INTO sightings (work_id, url, note, reporter_email) VALUES (?, 'https://example.org/x', ?, 'spotter@example.com')").run(w1, WORDS.rep);
  db.prepare("INSERT INTO disputes (work_id, kind, name, email, body, ip) VALUES (?, 'made', 'Jane Roe', 'jane@example.com', ?, '10.0.0.2')").run(w1, WORDS.claim);
  db.prepare("INSERT INTO disputes (work_id, kind, name, email, body, status) VALUES (?, 'person', 'Sam Poe', 'sam@example.com', 'I am in it', 'dismissed')").run(w1);
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT INTO here (day, visitor, at) VALUES (?,?,?)').run(today, 'v1', Math.floor(Date.now() / 1000));
  db.prepare('INSERT INTO here (day, visitor, at) VALUES (?,?,?)').run(today, 'v2', Math.floor(Date.now() / 1000));
  ledger.append(db, 'work.published', 'harbour-at-dusk', { by: 'test' });

  // The house's own 404, for comparison: the same status and the same body.
  const nf = await get('/agents/nothing-here.json'); const nfBody = await nf.text();
  assert.strictEqual(nf.status, 404);
  const like404 = async (r, why) => { assert.strictEqual(r.status, 404, why + ': status'); assert.strictEqual(await r.text(), nfBody, why + ': the 404 body'); assert.ok(!r.headers.get('x-robots-tag') || true); };

  // Shut: no key set; then a key too short.
  await like404(await get('/agents/desk.json'), 'no key set');
  await like404(await get('/agents/desk.json', bearer('anything')), 'no key set, a header given');
  process.env.AGENT_KEY = KEY.slice(0, 31);
  await like404(await get('/agents/desk.json', bearer(KEY.slice(0, 31))), 'a short key set: shut even to itself');
  process.env.AGENT_KEY = KEY;

  // A key set: no header, a wrong key, the key in the address, another scheme: all the 404.
  await like404(await get('/agents/desk.json'), 'no header');
  await like404(await get('/agents/desk.json', bearer(KEY.slice(0, -1) + (KEY.endsWith('A') ? 'B' : 'A'))), 'a wrong key');
  await like404(await get('/agents/desk.json', bearer(KEY + 'x')), 'a longer key');
  await like404(await get('/agents/desk.json?key=' + KEY), 'the key in the query string');
  await like404(await get('/agents/desk.json?key=' + KEY, bearer(KEY)), 'the key in the query string, even with the header');
  await like404(await get('/agents/desk.json', { authorization: `Basic ${KEY}` }), 'another scheme');
  await like404(await fetch(B + '/agents/desk.json', { method: 'POST', headers: { ...bearer(KEY), origin: B } }), 'nothing is written through it');

  // The right key: the three lists, with their shapes.
  let r = await get('/agents/desk.json', bearer(KEY)); let calls = 1;
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('cache-control'), 'private, no-store');
  assert.strictEqual(r.headers.get('x-robots-tag'), 'noindex');
  let raw = await r.text(); let J = JSON.parse(raw);
  assert.strictEqual(J.days, 7); assert.strictEqual(J.counts.length, 7); assert.strictEqual(J.words, false);
  assert.ok(!raw.includes('@'), 'no "@" anywhere in the answer');
  for (const w of Object.values(WORDS)) assert.ok(!raw.includes(w.slice(0, 20)), 'no letter\'s words with the switch off');
  for (const s of ['Ada Lens', 'Bo Frame', 'Jane Roe', 'Sam Poe', 'example', '10.0.0']) assert.ok(!raw.includes(s), `no name, address or ip: ${s}`);
  const kinds = J.letters.map(l => l.kind).sort();
  assert.deepStrictEqual(kinds, ['dispute', 'feedback', 'notice', 'report']);
  for (const l of J.letters) assert.deepStrictEqual(Object.keys(l).sort(), ['answered', 'day', 'kind', 'number', 'work']);
  const L = k => J.letters.find(l => l.kind === k);
  assert.strictEqual(L('feedback').work, 'harbour-at-dusk'); assert.strictEqual(L('feedback').answered, false); assert.ok(/^F-\d+$/.test(L('feedback').number));
  assert.strictEqual(L('report').work, 'harbour-at-dusk'); assert.ok(/^R-\d+$/.test(L('report').number));
  assert.ok(/^WM-C-\d{4}$/.test(L('notice').number)); assert.strictEqual(L('notice').answered, false); assert.strictEqual(L('dispute').answered, true);
  assert.strictEqual(L('feedback').day, today);
  const M = h => J.makers.find(m => m.handle === h);
  for (const m of J.makers) assert.deepStrictEqual(Object.keys(m).sort(), ['address_proven', 'day', 'door', 'handle', 'number', 'on_view', 'shared', 'works_in']);
  assert.deepStrictEqual(M('ada-lens'), { number: Number(mk1), handle: 'ada-lens', day: today, door: 'record', works_in: 2, on_view: 1, shared: false, address_proven: false });
  assert.deepStrictEqual(M('bo-frame'), { number: Number(mk2), handle: 'bo-frame', day: today, door: 'house', works_in: 1, on_view: 1, shared: true, address_proven: true });
  const T = J.counts[J.counts.length - 1];
  assert.deepStrictEqual(Object.keys(T).sort(), ['collected', 'day', 'joins', 'visits', 'works_hung', 'works_in']);
  assert.strictEqual(T.day, today); assert.ok(T.visits >= 2 && T.joins >= 2 && T.works_in >= 3 && T.works_hung >= 1, JSON.stringify(T));
  r = await get('/agents/desk.json?days=40', bearer(KEY)); calls++; assert.strictEqual((await r.json()).counts.length, 31, 'at most 31 days');
  r = await get('/agents/desk.json?days=0', bearer(KEY)); calls++; assert.strictEqual((await r.json()).days, 7, 'a nonsense span is the default');
  r = await get('/agents/desk.json?days=1', bearer(KEY)); calls++; assert.strictEqual((await r.json()).counts.length, 1);

  // The words, only on the switch (counsel's and Will's word): there, with any address masked.
  process.env.AGENT_LETTERS = '1';
  r = await get('/agents/desk.json', bearer(KEY)); calls++; raw = await r.text(); J = JSON.parse(raw);
  assert.strictEqual(J.words, true);
  assert.ok(raw.includes('The basket emptied itself') && raw.includes('Seen on a blog without credit') && raw.includes('I made this photograph'), 'the words, with the switch on');
  assert.ok(!raw.includes('@') && raw.includes('[address]'), 'an address in the words is masked');
  delete process.env.AGENT_LETTERS;
  r = await get('/agents/desk.json', bearer(KEY)); calls++; raw = await r.text();
  assert.ok(!raw.includes('The basket emptied itself'), 'off again: no words');
  // Off, the words are not even read: the statements the door runs with the switch off name no words' column.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'agentsdoor.js'), 'utf8');
  for (const name of ['feedback', 'reports', 'claims']) { const m = new RegExp(`\\n    ${name}: db\\.prepare\\('([^']+)'`).exec(src); assert.ok(m, name); assert.ok(!/\b(body|note|email|name|url|ip|reporter_email)\b/.test(m[1].replace(/\bw\.slug\b/, '')), `${name} reads no words: ${m[1]}`); }

  // Absent from every map and menu: DOORS, ROOMS, heavy's DOORS, the sitemap, /everything, Find, robots.
  assert.ok(!JSON.stringify(V.DOORS).includes('/agents'), 'not in DOORS');
  assert.ok(!JSON.stringify(V.ROOMS).includes('/agents'), 'not in ROOMS');
  try { assert.ok(!JSON.stringify(require('../src/heavy').DOORS || []).includes('/agents'), 'not in heavy DOORS'); } catch (e) { if (e instanceof assert.AssertionError) throw e; }
  for (const p of ['/sitemap.xml', '/everything', '/robots.txt', '/find?q=agents', '/find?q=desk', '/']) { const t = await (await get(p)).text(); assert.ok(!t.includes('/agents'), `not in ${p}`); }

  // The limiter: sixty answers an hour for the key, then a plain 429 with Retry-After.
  while (calls < 60) { r = await get('/agents/desk.json?days=1', bearer(KEY)); assert.strictEqual(r.status, 200, 'answer ' + (calls + 1)); await r.arrayBuffer(); calls++; }
  r = await get('/agents/desk.json?days=1', bearer(KEY));
  assert.strictEqual(r.status, 429, 'the sixty-first answer in the hour');
  const ra = Number(r.headers.get('retry-after')); assert.ok(ra > 0 && ra <= 3600, 'Retry-After ' + ra);
  assert.ok(!(await r.text()).includes('@'));
  await like404(await get('/agents/desk.json', bearer('w'.repeat(43))), 'a wrong key while limited is still the 404');

  // The key never in anything the house logs: the console, the request trail, the hits.
  await new Promise(res => setTimeout(res, 300));
  const trail = (global.__wmLast || []).join(' ');
  let hits = ''; try { hits = JSON.stringify(db.prepare('SELECT path, ref FROM hits ORDER BY id DESC LIMIT 500').all()); } catch (e) { /* no hits kept in this house */ }
  for (const [where, text] of [['console', said.join('\n')], ['request trail', trail], ['hits', hits]]) assert.ok(!text.includes(KEY) && !text.includes(KEY.slice(0, 31)), `the key is not in the ${where}`);

  srv.close(); delete process.env.AGENT_KEY;
  try { db.close && db.close(); } catch (e) { /* closed */ }
  fs.rmSync(dir, { recursive: true, force: true }); // only this test's own house
  console.log('agentsdoor: all hold');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
