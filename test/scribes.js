// The scribes (9 Nov; Will: "a scribe … only job, disciplined like a monastery monk"): every process of ROLE=scribe
// claims the next work without its copies from one queue, best first; two never hold the same work; the set is made
// and the work marked; a failure is counted and set aside after three; imports can be held, and a queued feed pauses.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-scribes-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'scribes', noTimers: true, vaultNow: true });
  const { db } = app.locals; const CP = app.locals.copies;
  db.prepare("INSERT INTO makers (handle, name, kind, joined_at, door) VALUES ('ada', 'Ada Lens', 'maker', datetime('now'), 'house')").run();
  const ada = db.prepare("SELECT * FROM makers WHERE handle='ada'").get();
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const put = async (title, extra) => { const f = path.join(dir, `in-${++k}.jpg`); fs.writeFileSync(f, await sharp(fx).modulate({ brightness: 0.6 + k * 0.1 }).jpeg().toBuffer()); const w = await app.locals.registerWork({ file: f, title, makerId: ada.id, place: 'Rome', originalName: path.basename(f) }); db.prepare(`UPDATE works SET status='held', copies_at=NULL ${extra || ''} WHERE slug=?`).run(w.slug); return db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug); };
  const plain = await put('Plain'); const best = await put('Best', ', curated=1, stars=5'); const kept = await put('Kept', ', keep_back=1');
  // 1. Best first; a claimed work is never claimed again; kept-back work is not in the queue.
  const p0 = CP.progress(); assert.equal(p0.left, 2, JSON.stringify(p0));
  const c1 = CP.claim(); assert.equal(c1.slug, best.slug, 'the best first');
  const c2 = CP.claim(); assert.equal(c2.slug, plain.slug, 'the next, never the same');
  assert.equal(CP.claim(), null, 'nothing else to claim (kept back is not on view)');
  db.prepare('UPDATE works SET copies_claim=NULL, copies_claim_at=NULL').run();
  // A stale claim (its scribe died) is given up.
  db.prepare("UPDATE works SET copies_claim='gone:1', copies_claim_at='2000-01-01 00:00:00' WHERE id=?").run(best.id);
  assert.equal(CP.claim().slug, best.slug, 'a stale claim is taken over'); db.prepare('UPDATE works SET copies_claim=NULL, copies_claim_at=NULL').run();
  // 2. The scribe's one turn: claims, makes the whole set, marks it, lets go.
  assert.equal(await CP.one(), true); let w = db.prepare('SELECT * FROM works WHERE id=?').get(best.id);
  assert.ok(w.copies_at && !w.copies_claim, JSON.stringify({ c: w.copies_at, cl: w.copies_claim }));
  const images = require('../src/images'); for (const s of ['thumb', 'screen', 'large']) assert.ok(fs.existsSync(images.fileOf(path.join(dir, 'cache'), best.slug, s, 'jpg')), s);
  // 3. A failure is counted; after three it is set aside, never looped on.
  const orig = fs.readdirSync(path.join(dir, 'originals')).filter(n => n.includes(plain.slug)); for (const n of orig) fs.renameSync(path.join(dir, 'originals', n), path.join(dir, 'originals', n + '.away'));
  db.prepare('UPDATE works SET vaulted=1 WHERE id=?').run(plain.id);
  const vault = app.locals.store; const realGet = vault.get; vault.get = async () => { throw new Error('gone'); };
  for (let i = 0; i < 3; i++) await CP.one();
  vault.get = realGet; w = db.prepare('SELECT * FROM works WHERE id=?').get(plain.id); assert.equal(w.copies_tries, 3); assert.ok(!w.copies_at);
  assert.equal(await CP.one(), false, 'set aside'); const p1 = CP.progress(); assert.equal(p1.left, 0); assert.equal(p1.stuck, 1, JSON.stringify(p1));
  // 4. Imports held: a queued feed pauses; released, it runs again.
  db.prepare("INSERT INTO feeds (kind, url, maker_id, status, created_at) VALUES ('csv', 'https://example.org/x.csv', ?, 'queued', datetime('now'))").run(ada.id);
  CP.holdImports(true); assert.equal(db.prepare('SELECT status FROM feeds ORDER BY id DESC').get().status, 'paused'); assert.ok(app.locals.importsHeld());
  CP.holdImports(false); assert.equal(db.prepare('SELECT status FROM feeds ORDER BY id DESC').get().status, 'queued'); assert.ok(!app.locals.importsHeld());
  // 5. The Studio's page says it.
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const login = await fetch(`${base}/studio/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  const ck = (login.headers.get('set-cookie') || '').split(';')[0];
  const r = await fetch(`${base}/studio/scribes`, { headers: { cookie: ck } }); const html = await r.text(); assert.equal(r.status, 200, html.slice(0, 200)); assert.ok(/The scribes/.test(html) && /ready/.test(html));
  const j = await (await fetch(`${base}/studio/scribes.json`, { headers: { cookie: ck } })).json(); assert.equal(j.stuck, 1);
  srv.close(); console.log('scribes: hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
