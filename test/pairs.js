// Pairs (29 Oct): masters joined to the web copies they were exported beside, though the two are not the same file:
// a tighter crop and a warmer grade with the camera's same moment is joined at once; black and white and a hard crop
// with no moment is asked of the maker; a burst frame of the same size, and another picture, are left alone; undo
// puts both back.
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { createApp } = require('../src/app');

let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function scene(n, w = 3000, h = 2000) {
  let s = ''; seed = n * 7919 + 1;
  for (let i = 0; i < 60; i++) { const x = rnd() * w, y = rnd() * h, r = 40 + rnd() * 260, c = `rgb(${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)})`; s += rnd() > .5 ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>` : `<rect x="${x}" y="${y}" width="${r * 1.6}" height="${r}" fill="${c}"/>`; }
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#556"/>${s}</svg>`));
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-pairs-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'pairs', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('pz','Pia Zed','pz@example.com','maker',datetime('now'),'house')").run();
  const maker = db.prepare("SELECT * FROM makers WHERE handle='pz'").get();
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  await go('/account?maker=pz');
  const put = async (buf, name, at) => {
    const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), name);
    const j = await (await go('/account/works/one', { method: 'POST', body: fd })).json(); assert.ok(j.ok, name + ': ' + JSON.stringify(j));
    if (at) db.prepare('UPDATE works SET taken_at=? WHERE slug=?').run(at, j.slug); return j.slug;
  };
  // The web copies, long held: 1200 px exports of what was sent to the web.
  const webA = await put(await scene(1).resize(1200).jpeg({ quality: 82 }).toBuffer(), 'paris-a-web.jpg', '2025-06-01T18:20:11');
  const webB = await put(await scene(2).resize(1200).jpeg({ quality: 82 }).toBuffer(), 'paris-b-web.jpg', '2025-06-02T09:00:00');
  const webC = await put(await scene(3).resize(1200).jpeg({ quality: 82 }).toBuffer(), 'paris-c-web.jpg', '2025-06-03T10:00:00');
  db.prepare("UPDATE works SET created_at=datetime('now','-3 days'), caption='The quay at dusk.' WHERE slug=?").run(webA);
  // The masters: A re-edited (cropped 92%, warmer, brighter) at the same moment; B black and white, hard crop, no moment;
  // C's burst neighbour (another frame, the same size as C's web copy); D another picture entirely.
  const mA = await scene(1).extract({ left: 120, top: 80, width: 2760, height: 1840 }).modulate({ brightness: 1.12 }).linear(1.08, 4).jpeg({ quality: 96 }).toBuffer();
  const mB = await scene(2).extract({ left: 400, top: 250, width: 2250, height: 1500 }).greyscale().jpeg({ quality: 96 }).toBuffer();
  const sibC = await scene(3).affine([1, 0, 0, 1], { idx: 14, idy: 6 }).resize(1200).modulate({ brightness: 1.05 }).jpeg({ quality: 83 }).toBuffer();
  const sA = await put(mA, 'L1002685.jpg', '2025-06-01T18:20:11');
  const sB = await put(mB, 'L1002690.jpg', null);
  const sC = await put(sibC, 'L1002699.jpg', '2025-06-03T10:00:00');
  const sD = await put(await scene(9).jpeg({ quality: 96 }).toBuffer(), 'L1002700.jpg', '2025-06-01T18:20:11');
  const st = s => db.prepare('SELECT status FROM works WHERE slug=?').get(s).status;
  // What the first look at arrival already joined is fine; the scan does the rest.
  const r = await app.locals.pairs.scan(maker.id);
  const A = db.prepare('SELECT * FROM works WHERE slug=?').get(webA);
  assert.strictEqual(st(sA), 'merged', 'A joined: ' + JSON.stringify(r) + ' ' + JSON.stringify(db.prepare('SELECT * FROM pairs').all()));
  assert.ok(A.width >= 2700 && A.caption === 'The quay at dusk.', 'the old record keeps its words and takes the master');
  const pB = db.prepare("SELECT p.* FROM pairs p JOIN works w ON w.id=p.new_id WHERE w.slug=?").get(sB);
  assert.ok(pB && pB.status === 'proposed', 'B asked of the maker: ' + JSON.stringify(pB));
  assert.ok(!db.prepare("SELECT 1 FROM pairs p JOIN works w ON w.id=p.new_id WHERE w.slug=?").get(sC), 'a burst frame the same size is its own work');
  assert.ok(!db.prepare("SELECT 1 FROM pairs p JOIN works w ON w.id=p.new_id WHERE w.slug=? AND p.score > .7").get(sD) && st(sD) === 'hidden', 'another picture at the same moment is its own work');
  // The desk: confirm B, undo A.
  assert.ok(/1 picture that looks like one you hold/.test(await (await go('/account')).text()), 'the desk says it');
  let t = await (await go('/account/pairs')).text(); assert.ok(/Pictures you already hold/.test(t) && /Same picture/.test(t), 'the desk asks');
  await go(`/account/pairs/${pB.id}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'do=join' });
  assert.strictEqual(st(sB), 'merged', 'B joined by the maker');
  assert.ok(db.prepare('SELECT width FROM works WHERE slug=?').get(webB).width === 2250, 'B: the master on the old record');
  const pA = db.prepare("SELECT p.* FROM pairs p JOIN works w ON w.id=p.new_id WHERE w.slug=?").get(sA);
  await go(`/account/pairs/${pA.id}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'do=undo' });
  const A2 = db.prepare('SELECT * FROM works WHERE slug=?').get(webA);
  assert.ok(st(sA) === 'hidden' && A2.width === 1200, 'undo puts both back');
  const img = await fetch(base + `/img/${webA}/thumb?f=jpg`); assert.strictEqual(img.status, 200, 'the old picture shows again');
  assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='work.merged'").get() && db.prepare("SELECT 1 FROM ledger WHERE type='work.unmerged'").get(), 'the register says both');
  const again = await app.locals.pairs.scan(maker.id); assert.strictEqual(again.looked, 0, 'a second look sees only what is new');
  srv.close(); console.log('pairs: all good'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
