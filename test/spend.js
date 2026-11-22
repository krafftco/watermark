// The meter on Al (8 Nov; Will: "why am I paying 41 dollars a day in api credits"): every call on the house's key is
// counted by module and day; the background fills stop at AL_DAY_MAX, the pressed work at AL_PRESS_MAX; AL_FILLS=0
// stops every background job; the art fill never reads a museum's or the shelf's work.
process.env.NODE_ENV = 'test'; process.env.AL_DAY_MAX = '3'; process.env.AL_PRESS_MAX = '2'; process.env.ANTHROPIC_API_KEY = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-spend-'));
  let calls = 0;
  let broke = false; // (#196) the account out of credit: the API's own answer
  const fetchImpl = async (u) => { if (/api\.anthropic\.com/.test(String(u))) { calls++; if (broke) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }), { status: 400, headers: { 'content-type': 'application/json' } }); return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ art: false, confidence: 0.9, people: { recognisable: false }, score: 4, why: 'fine', text: 'A guide.' }) }] }), { status: 200, headers: { 'content-type': 'application/json' } }); } return new Response('no', { status: 404 }); };
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'spend', noTimers: true, vaultNow: true, fetchImpl });
  const { db } = app.locals; const S = app.locals.spend; assert.ok(S, 'mounted');
  // The meter itself.
  assert.ok(S.ok('art') && S.ok('closer') && S.ok('jacket'), 'three background calls');
  assert.ok(!S.ok('foryou'), 'the fourth is refused');
  assert.ok(S.ok('frick') && S.ok('aledit') && !S.ok('frick'), 'the pressed line is its own');
  let t = S.today(); assert.strictEqual(t.background, 3); assert.strictEqual(t.pressed, 2); assert.strictEqual(t.refused, 2); assert.strictEqual(t.by.art, 1);
  assert.strictEqual(S.week().length, 7);
  // The kill switch.
  process.env.AL_FILLS = '0'; db.prepare("DELETE FROM settings WHERE k LIKE 'al_%'").run();
  assert.ok(!S.ok('art') && S.ok('frick'), 'fills off refuses the background, never a press'); assert.strictEqual(S.today().fills, false);
  delete process.env.AL_FILLS; db.prepare("DELETE FROM settings WHERE k LIKE 'al_%'").run();
  // The art fill reads a living maker's arrival, never a museum's or the shelf's.
  db.prepare("INSERT INTO makers (handle, name, kind, joined_at, door) VALUES ('ada', 'Ada Lens', 'maker', datetime('now'), 'house')").run();
  db.prepare("INSERT INTO makers (handle, name, kind, joined_at, door) VALUES ('the-met', 'A museum', 'institution', datetime('now'), 'house')").run();
  const ada = db.prepare("SELECT * FROM makers WHERE handle='ada'").get(), met = db.prepare("SELECT * FROM makers WHERE handle='the-met'").get();
  const fx = path.join(__dirname, 'fixture.jpg');
  const sharp = require('sharp'); let k = 0;
  const put = async (m, title) => { const f = path.join(dir, `${title}.jpg`); fs.writeFileSync(f, await sharp(fx).modulate({ brightness: 0.6 + (k++) * 0.3 }).jpeg().toBuffer()); const w = await app.locals.registerWork({ file: f, title, makerId: m.id, originalName: `${title}.jpg` }); db.prepare("UPDATE works SET status='held' WHERE id=?").run(w.id); return w; };
  const mine = await put(ada, 'Mine'); const theirs = await put(met, 'Theirs');
  const did = await app.locals.art.fill(10);
  assert.strictEqual(did, 1, 'one read: the maker’s');
  assert.ok(db.prepare('SELECT attribution FROM works WHERE id=?').get(mine.id).attribution, 'the maker’s work read');
  assert.ok(!db.prepare('SELECT attribution FROM works WHERE id=?').get(theirs.id).attribution, 'the museum’s never');
  assert.strictEqual(S.today().by.art, 1);
  // Past the line the fill stops without marking anything missed.
  db.prepare("UPDATE works SET attribution=NULL WHERE id=?").run(mine.id); S.ok('closer'); S.ok('closer');
  const did2 = await app.locals.art.fill(10); assert.strictEqual(did2, 0, 'the line holds the fill');
  assert.ok(!db.prepare('SELECT attribution FROM works WHERE id=?').get(mine.id).attribution, 'nothing marked missed');
  // /healthz (full) carries it.
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; } return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  const h = await (await go('/healthz')).json(); assert.ok(h.al && h.al.backgroundMax === 3 && h.al.background === 3, 'healthz al: ' + JSON.stringify(h.al));
  assert.ok(/Al: 3 background calls/.test(app.locals.digest.compose()), 'the digest says');
  // (#196) Out of credit: the fill makes one call, hears the API, stops; no work is marked missed; every background call
  // waits (a press still goes); the log and the Studio's desk say it once; past the wait the fill reads them all.
  db.prepare("DELETE FROM settings WHERE k LIKE 'al_%'").run(); db.prepare('UPDATE works SET attribution=NULL WHERE id=?').run(mine.id);
  const f2 = path.join(dir, 'Mine2.jpg'); fs.writeFileSync(f2, await sharp(fx).negate({ alpha: false }).flop().jpeg().toBuffer());
  const mine2 = await app.locals.registerWork({ file: f2, title: 'Mine2', makerId: ada.id, originalName: 'Mine2.jpg' }); db.prepare("UPDATE works SET status='held' WHERE id=?").run(mine2.id);
  const said = []; const err = console.error; console.error = (...a) => { said.push(a.join(' ')); err(...a); };
  broke = true; let c0 = calls;
  assert.strictEqual(await app.locals.art.fill(10), 0, 'nothing read');
  assert.strictEqual(calls - c0, 1, 'one call, not one a work');
  for (const w of [mine, mine2]) assert.strictEqual(db.prepare('SELECT attribution FROM works WHERE id=?').get(w.id).attribution, null, 'left unread, never marked missed');
  assert.ok(S.credit() && S.today().credit, 'kept'); assert.ok(!S.ok('closer') && !S.ok('jacket'), 'the background waits'); assert.ok(S.ok('frick'), 'a press still goes');
  c0 = calls; assert.strictEqual(await app.locals.art.fill(10), 0); assert.strictEqual(calls, c0, 'the next fill does not call at all');
  console.error = err; assert.strictEqual(said.filter(l => /credit is too low/.test(l)).length, 1, 'said once in the log: ' + said.join(' | '));
  const desk = await (await go('/studio')).text(); assert.strictEqual((desk.match(/credit is too low/g) || []).length, 1, 'said once on the Studio’s desk');
  assert.ok(/OUT OF CREDIT/.test(app.locals.digest.compose()), 'and in the digest');
  db.prepare("UPDATE settings SET v=? WHERE k='credit_low'").run(JSON.stringify({ ...S.credit(), until: Date.now() - 1 })); broke = false;
  assert.ok(!S.credit(), 'the wait over'); assert.strictEqual(await app.locals.art.fill(10), 2, 'both read once the account is paid');
  assert.ok(!/credit is too low/.test(await (await go('/studio')).text()), 'and the desk is clear');
  srv.close(); console.log('spend: holds'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
