// The standard (5 Nov): the shelves read for size, sharpness and edges, and looked at by Al; what falls short comes off
// the wall, named, reversible; a person may keep one; a living maker's own work is never read.
process.env.NODE_ENV = 'test'; process.env.ANTHROPIC_API_KEY = 'test'; process.env.FRICK_PARALLEL = '1';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-frick-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'frick', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; } return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  const a = app.locals.art.ensure('Jan Vermeer', { born: 1632, died: 1675 });
  db.prepare("INSERT INTO makers (handle, name, kind, house, joined_at, door) VALUES ('the-public-domain', 'The public domain', 'institution', 'Open', datetime('now'), 'house')").run();
  db.prepare("INSERT INTO makers (handle, name, kind, joined_at, door) VALUES ('ada', 'Ada Lens', 'maker', datetime('now'), 'house')").run();
  const shelf = db.prepare("SELECT * FROM makers WHERE handle='the-public-domain'").get(), ada = db.prepare("SELECT * FROM makers WHERE handle='ada'").get();
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const put = async (buf, title, maker = shelf) => { const f = path.join(dir, `in-${++k}.jpg`); fs.writeFileSync(f, buf); const w = await app.locals.registerWork({ file: f, title, makerId: maker.id, kind: 'painting', originalName: path.basename(f) }); db.prepare(`UPDATE works SET status='held', ${maker === shelf ? "open='pd', artist_id=" + a.id : 'open=NULL'} WHERE slug=?`).run(w.slug); return w.slug; };
  const big = n => sharp(fx).resize(3000 + n * 10, 2200, { fit: 'fill' }).sharpen().jpeg({ quality: 95 }).toBuffer();
  const goods = []; for (let i = 0; i < 12; i++) goods.push(await put(await big(i), `A View ${i}`));
  const tiny = await put(await sharp(fx).resize(900).jpeg().toBuffer(), 'The Small One');
  const soft = await put(await sharp(fx).resize(3000, 2200, { fit: 'fill' }).blur(14).jpeg({ quality: 95 }).toBuffer(), 'The Soft One');
  const edged = await put(await sharp(await sharp(fx).resize(2600, 1800, { fit: 'fill' }).sharpen().jpeg().toBuffer()).extend({ top: 300, bottom: 300, left: 300, right: 300, background: { r: 250, g: 250, b: 248 } }).jpeg({ quality: 95 }).toBuffer(), 'The Scanner Bed');
  const skew = await put(await big(40), 'The Skewed One');
  const mine = await put(await sharp(fx).resize(700).jpeg().toBuffer(), 'My Own Small Photograph', ada);
  // Al: every picture hangs, but the skewed one is down.
  let calls = 0;
  app.locals.frick.transport = async (u, o) => { calls++; const t = JSON.parse(o.body).messages[0].content[1].text; const down = /Skewed/.test(t); return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(down ? { verdict: 'down', score: 1.5, faults: ['skewed or keystoned'], why: 'the canvas leans' } : { verdict: 'hang', score: 4.5, faults: [], why: 'a clean scan' }) }] }) }; };
  const F = app.locals.frick;
  const j = F.run({}, { auto: false }); for (let i = 0; i < 600 && j.running; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(!j.running && j.failed === 0, JSON.stringify(j));
  const r = s => JSON.parse(db.prepare('SELECT frick FROM works WHERE slug=?').get(s).frick || 'null');
  assert.strictEqual(r(mine), null, 'a living maker’s own work is never read');
  assert.strictEqual(r(tiny).verdict, 'down', 'too small: ' + JSON.stringify(r(tiny).house));
  assert.ok(r(tiny).al === null, 'a hard fault is not sent to Al');
  assert.ok(['down', 'check'].includes(r(soft).verdict) && r(soft).house.some(f => f.k === 'soft or blurred'), 'soft: ' + JSON.stringify(r(soft)));
  assert.ok(['down', 'check'].includes(r(edged).verdict) && r(edged).house.some(f => f.k === 'bad edges'), 'the scanner bed: ' + JSON.stringify(r(edged).m.edges));
  assert.strictEqual(r(skew).verdict, 'down', 'Al’s down: ' + JSON.stringify(r(skew)));
  const hung = goods.filter(s => r(s).verdict === 'hang').length; assert.ok(hung >= 11, `the good files hang (${hung} of 12): ` + JSON.stringify(goods.map(s => [r(s).verdict, r(s).house, r(s).m.edges])));
  // The desk shows them; the hand takes them down; one is kept by a person; all put back.
  let t = await (await go('/studio/standard')).text(); assert.ok(t.includes('The standard') && t.includes('To come down') && t.includes(tiny), 'the desk');
  const keepIt = await (await go('/studio/standard/keep', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `slug=${skew}&json=1` })).json(); assert.ok(keepIt.ok);
  const ap = await (await go('/studio/standard/apply', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1' })).json();
  const st = s => db.prepare('SELECT status, keep_back, tidy FROM works WHERE slug=?').get(s);
  assert.ok(ap.n >= 1 && st(tiny).status === 'hidden' && /below the standard: too small/.test(st(tiny).tidy), 'taken off the wall, named: ' + JSON.stringify(st(tiny)));
  assert.strictEqual(st(skew).status, 'held', 'the one a person kept stays');
  assert.strictEqual(st(goods[0]).status, 'held');
  // Read again with the take-down on: nothing new to take; a second run reads only what is unread.
  const j2 = F.run({}); assert.strictEqual(j2.total, 0, 'nothing unread');
  const bk = await (await go('/studio/standard/back', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1' })).json();
  assert.ok(bk.n >= 1 && st(tiny).status === 'held' && !st(tiny).tidy, 'put back');
  // By artist, with the take-down as it reads.
  db.prepare('UPDATE works SET frick=NULL').run();
  const j3 = F.run({ artist: a.id }, { auto: true }); for (let i = 0; i < 600 && j3.running; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(j3.taken >= 1 && st(tiny).status === 'hidden', 'taken down as it reads: ' + JSON.stringify(j3));
  assert.ok(calls >= 12, 'Al looked: ' + calls);
  console.log('the standard: ok'); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
