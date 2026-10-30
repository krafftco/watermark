// Al's edit (29 Oct): the archive graded against itself; the maker's own grades of two and up never touched;
// file-name titles given a plain one; a maker who grades over Al takes the grade back.
process.env.NODE_ENV = 'test'; process.env.ANTHROPIC_API_KEY = 'test'; process.env.ALEDIT_PARALLEL = '1';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-al-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'al', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('al','Ada Lens','al@example.com','maker',datetime('now'),'house')").run();
  const m = db.prepare("SELECT * FROM makers WHERE handle='al'").get();
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' }); await go('/account?maker=al');
  const slugs = [];
  for (let n = 1; n <= 20; n++) {
    const buf = await sharp({ create: { width: 600 + n * 7, height: 400, channels: 3, background: { r: 12 * n, g: 240 - 11 * n, b: (n * 53) % 255 } } }).jpeg().toBuffer();
    const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), `f${n}.jpg`); const j = await (await go('/account/works/one', { method: 'POST', body: fd })).json(); assert.ok(j.ok, JSON.stringify(j));
    db.prepare("UPDATE works SET title=?, stars=0, status='hidden' WHERE slug=?").run(`JOE MILAN ${100 + n}`, j.slug); slugs.push(j.slug);
  }
  assert.strictEqual(new Set(slugs).size, 20);
  // The maker graded one 3 (theirs) and one 1 (Al may raise it).
  db.prepare('UPDATE works SET stars=3 WHERE slug=?').run(slugs[0]);
  db.prepare('UPDATE works SET stars=1 WHERE slug=?').run(slugs[19]);
  // Al's answers: score by the frame's number, the twentieth best.
  let calls = 0;
  const fake = async (url, o) => { calls++; const body = JSON.parse(o.body); const t = body.messages[0].content[1].text; const n = +t.match(/JOE MILAN (\d+)/)[1] - 100; return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ score: 1 + n / 5, why: 'light', title: n === 20 ? 'The Last Light' : 'A Quiet Street' }) }] }) }; };
  // Re-mount with the fake wire.
  require('../src/aledit').mountAlEdit(app, { db, ledger: require('../src/ledger'), isStudio: () => false, makerOf: () => m, fetchImpl: fake });
  const job = app.locals.alEdit.run(m);
  for (let i = 0; i < 200 && job.running; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(!job.running && job.failed === 0, JSON.stringify(job));
  assert.strictEqual(calls, 20);
  const w = s => db.prepare('SELECT * FROM works WHERE slug=?').get(s);
  assert.strictEqual(w(slugs[19]).stars, 5, 'the best: five stars (raised over a 1)');
  assert.strictEqual(w(slugs[19]).stars_by, 'al'); assert.strictEqual(w(slugs[19]).title, 'The Last Light'); assert.strictEqual(w(slugs[19]).title_given, 'JOE MILAN 120');
  assert.strictEqual(w(slugs[0]).stars, 3, 'the maker’s own 3 untouched'); assert.ok(w(slugs[0]).stars_by !== 'al');
  assert.ok([16, 17, 18].every(i => w(slugs[i]).stars === 4), 'the next 15%: four');
  assert.strictEqual(w(slugs[1]).stars, 1, 'the weakest: one');
  // The maker grades over Al: theirs from then on.
  db.prepare('UPDATE works SET stars=2 WHERE slug=?').run(slugs[19]);
  app.locals.alEdit.stars(m.id);
  assert.strictEqual(w(slugs[19]).stars, 2, 'a grade over Al’s is the maker’s');
  // A second run reads only what is new.
  const j2 = app.locals.alEdit.run(m); assert.strictEqual(j2.total, 0);
  const lib = await (await go('/account/table')).text(); assert.ok(/Al’s edit: 20 of 20 read/.test(lib), 'the Library says it: ' + (lib.match(/lib-line.{0,600}/) || [lib.slice(0, 300)])[0]);
  // Al's picks: strong convictions only; street work with people goes, a portrait and a child wait.
  const W = i => db.prepare('SELECT * FROM works WHERE slug=?').get(slugs[i]);
  const setA = (i, a) => db.prepare('UPDATE works SET attribution=? WHERE slug=?').run(JSON.stringify(a), slugs[i]);
  setA(18, { people: { recognisable: 4, crowd: true } }); setA(17, { people: { recognisable: 1, crowd: false } }); setA(16, { people: { recognisable: 1, minors: true } });
  const hung = [];
  app.locals.hangBest = { plan: async () => ({ clear: [{ w: W(19) }, { w: W(2) }], people: [{ w: W(18) }, { w: W(17) }], children: [{ w: W(16) }], check: [], unread: [] }), hang: (mm, ws) => { hung.push(...ws.map(x => x.slug)); return ws.length; } };
  const pk = await app.locals.alEdit.picks(m, 4.3);
  assert.deepStrictEqual(pk.go.map(x => x.slug).sort(), [slugs[18], slugs[19]].sort(), 'the strong clear frame and the street scene: ' + JSON.stringify(pk.go));
  assert.strictEqual(pk.held.portraits[0].slug, slugs[17]); assert.strictEqual(pk.held.children[0].slug, slugs[16]);
  console.log('al edit: ok'); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
