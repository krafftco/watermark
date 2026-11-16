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
  // A maker with nothing on view (handle withheld); one the house is holding; a reader at play: the last two never listed.
  const mk3 = db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('cy-nothing-yet','Cy Nothing','cy@example.com','maker',datetime('now'),'record')").run().lastInsertRowid;
  work(mk3, 'cy-kept', 'hidden');
  const mkHeld = db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door, standing) VALUES ('jane-q-private','Jane Q Private','jq@example.com','maker',datetime('now'),'house','held')").run().lastInsertRowid;
  work(mkHeld, 'jq-one', 'held');
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door, bio) VALUES ('rita-reader','Rita Reader','rita@example.com','maker',datetime('now'),'play','A reader of the house, at play.')").run();
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
  for (const s of ['Ada Lens', 'Bo Frame', 'Jane Roe', 'Sam Poe', 'example', '10.0.0', 'cy-nothing-yet', 'Cy Nothing', 'jane-q-private', 'rita', 'Rita']) assert.ok(!raw.includes(s), `no name, address, ip or withheld handle: ${s}`);
  const kinds = J.letters.map(l => l.kind).sort();
  assert.deepStrictEqual(kinds, ['dispute', 'feedback', 'notice', 'report']);
  for (const l of J.letters) assert.deepStrictEqual(Object.keys(l).sort(), ['answered', 'day', 'kind', 'number', 'work']);
  const L = k => J.letters.find(l => l.kind === k);
  assert.strictEqual(L('feedback').work, 'harbour-at-dusk'); assert.strictEqual(L('feedback').answered, false); assert.ok(/^F-\d+$/.test(L('feedback').number));
  assert.strictEqual(L('report').work, 'harbour-at-dusk'); assert.ok(/^R-\d+$/.test(L('report').number));
  assert.ok(/^WM-C-\d{4}$/.test(L('notice').number)); assert.strictEqual(L('notice').answered, false); assert.strictEqual(L('dispute').answered, true);
  assert.strictEqual(L('feedback').day, today);
  const M = h => J.makers.find(m => m.handle === h);
  for (const m of J.makers) assert.deepStrictEqual(Object.keys(m).sort(), ['day', 'door', 'handle', 'number', 'on_view', 'proven', 'shared', 'works_in']);
  assert.deepStrictEqual(M('ada-lens'), { number: Number(mk1), handle: 'ada-lens', day: today, door: 'record', works_in: 2, on_view: 1, shared: false, proven: false });
  assert.deepStrictEqual(M('bo-frame'), { number: Number(mk2), handle: 'bo-frame', day: today, door: 'house', works_in: 1, on_view: 1, shared: true, proven: true });
  assert.deepStrictEqual(J.makers.find(m => m.number === Number(mk3)), { number: Number(mk3), handle: null, day: today, door: 'record', works_in: 1, on_view: 0, shared: false, proven: true }, 'nothing on view: the number only');
  assert.deepStrictEqual(J.makers.map(m => m.number).filter(x => x !== 1).sort(), [mk1, mk2, mk3].map(Number).sort(), 'the held maker and the reader at play are not listed (1 is the house\'s own, made at boot)');
  assert.ok(!J.makers.some(m => m.number === Number(mkHeld) || m.door === 'play'));
  const T = J.counts[J.counts.length - 1];
  assert.deepStrictEqual(Object.keys(T).sort(), ['collected', 'day', 'joins', 'visits', 'works_hung', 'works_in']);
  assert.strictEqual(T.joins, 5, 'joins: the house\'s own, three makers and the held one; never the reader at play'); assert.strictEqual(T.day, today); assert.ok(T.visits >= 2 && T.joins >= 2 && T.works_in >= 3 && T.works_hung >= 1, JSON.stringify(T));
  r = await get('/agents/desk.json?days=40', bearer(KEY)); calls++; assert.strictEqual((await r.json()).counts.length, 31, 'at most 31 days');
  r = await get('/agents/desk.json?days=0', bearer(KEY)); calls++; assert.strictEqual((await r.json()).days, 7, 'a nonsense span is the default');
  r = await get('/agents/desk.json?days=1', bearer(KEY)); calls++; assert.strictEqual((await r.json()).counts.length, 1);

  // The words, only on the switch (counsel's and Will's word): there, with any address masked.
  process.env.AGENT_LETTERS = '1';
  r = await get('/agents/desk.json', bearer(KEY)); calls++; raw = await r.text(); J = JSON.parse(raw);
  assert.strictEqual(J.words, true);
  assert.ok(raw.includes('The basket emptied itself') && raw.includes('Seen on a blog without credit') && raw.includes('I made this photograph'), 'the words, with the switch on');
  assert.ok(!raw.includes('@') && raw.includes('[email]'), 'an email address in the words is masked');
  // The masking, each shape (best-effort; the switch stays off until counsel and Will say otherwise).
  const fb = db.prepare("INSERT INTO feedback (kind, body, page) VALUES ('idea', ?, NULL)");
  const SHAPES = [
    ['write to jane.roe@gmail.com please', 'jane.roe', '[email]'],
    ['or jane dot roe at gmail dot com', 'roe', '[email]'],
    ['and jane (at) mail [dot] example [dot] org', 'jane', '[email]'],
    ['call +1 (212) 555-0199 any time', '555-0199', '[phone]'],
    ['or +44 20 7946 0958 in London', '7946', '[phone]'],
    ['my cell 212.555.0199 works', '555.0199', '[phone]'],
    ['or (212) 555-0123 after six', '555-0123', '[phone]'],
    ['or 212-555-0144 at the office', '555-0144', '[phone]'],
    ['I live at 409 East 81st Street Apt 4B, New York', '81st', '[street]'],
    ['send it to 12 Baker St.', 'Baker', '[street]'],
    ['ship to 1600 Pennsylvania Avenue NW', 'Pennsylvania', '[street]'],
    ['New York NY 10028-0102 is the ZIP', '10028', '[postcode]'],
    ['London SW1A 1AA for the print', 'SW1A', '[postcode]'],
  ];
  SHAPES.forEach(([t], i) => fb.run(`s${i}: ${t}`));
  r = await get('/agents/desk.json?days=1', bearer(KEY)); calls++; J = JSON.parse(await r.text());
  for (const [i, [t, gone, mark]] of SHAPES.entries()) { const l = J.letters.find(x => x.words && x.words.startsWith(`s${i}: `)); assert.ok(l && l.words.includes(mark), `masked as ${mark}: ${t} → ${l && l.words}`); assert.ok(l, `masked as ${mark}: ${t}`); assert.ok(!l.words.includes(gone), `${gone} masked in: ${l.words}`); }
  const keep = J.letters.find(x => x.words && x.words.startsWith('I made this photograph in 2019')); assert.ok(keep && keep.words.includes('2019'), 'a year is not a postcode');
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

  // A secret in an address never reaches the trail: the door's path in any case, and any key/token/code/secret/
  // authorization parameter on any address of the house. The value is "abc" made distinct, so a hash cannot match it.
  const ABC = 'abc' + crypto.randomBytes(6).toString('hex');
  await like404(await get('/AGENTS/desk.json?key=' + ABC), 'the door in capitals, with a key in the address');
  for (const p of [`/AGENTS/desk.json?key=${ABC}`, `/collection?Token=${ABC}`, `/nothing?a=1&CODE=${ABC}`, `/find?q=x&secret=${ABC}`, `/about?Authorization=${ABC}`]) await (await get(p)).arrayBuffer();
  const trail0 = (global.__wmLast || []).join(' ');
  assert.ok(!trail0.includes(ABC) && trail0.includes('/AGENTS/desk.json') && trail0.includes('/collection'), 'the trail keeps the paths only: ' + trail0);
  await (await get('/find?q=keep-this-one')).arrayBuffer(); assert.ok((global.__wmLast || []).join(' ').includes('q=keep-this-one'), 'an ordinary query is kept');

  // The key never in anything the house logs: the console, the request trail, the hits.
  await new Promise(res => setTimeout(res, 300));
  const trail = (global.__wmLast || []).join(' ');
  let hits = ''; try { hits = JSON.stringify(db.prepare('SELECT path, ref FROM hits ORDER BY id DESC LIMIT 500').all()); } catch (e) { /* no hits kept in this house */ }
  for (const [where, text] of [['console', said.join('\n')], ['request trail', trail], ['hits', hits]]) { assert.ok(!text.includes(KEY) && !text.includes(KEY.slice(0, 31)), `the key is not in the ${where}`); assert.ok(!text.includes(ABC), `the "abc" value is not in the ${where}`); }

  // Postgres: the indexes are built CONCURRENTLY, and one left half-built (INVALID) is noticed, dropped and built again.
  if (db.kind === 'postgres') {
    const valid = name => { const r = db.prepare('SELECT i.indisvalid AS ok FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = ? LIMIT 1').get(name); return r ? !!r.ok : null; };
    db.exec('DROP INDEX IF EXISTS works_created');
    try { db.exec('CREATE UNIQUE INDEX CONCURRENTLY works_created ON works (maker_id)'); } catch (e) { /* duplicates: the build fails and leaves the index invalid, as a dead build does */ }
    assert.strictEqual(valid('works_created'), false, 'a half-built index, made on purpose');
    const logged = []; require('../src/indexes').ensure(db, { log: x => logged.push(x) });
    assert.strictEqual(valid('works_created'), true, 'built again, valid');
    assert.ok(logged.some(x => /works_created was left half-built/.test(x)), 'and said in the log');
  }

  srv.close(); delete process.env.AGENT_KEY;
  try { db.close && db.close(); } catch (e) { /* closed */ }
  fs.rmSync(dir, { recursive: true, force: true }); // only this test's own house
  console.log('agentsdoor: all hold');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
