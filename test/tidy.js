// The tidy (2 Nov): an artist's set read for repeats and bad files; the best copy kept, the rest off view, reversible.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-tidy-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'tidy', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; } return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  const a = app.locals.art.ensure('Leonardo da Vinci', { born: 1452, died: 1519 });
  db.prepare("INSERT INTO makers (handle, name, kind, house, joined_at, door) VALUES ('the-public-domain', 'The public domain', 'institution', 'Open', datetime('now'), 'house')").run();
  const shelf = db.prepare("SELECT * FROM makers WHERE handle='the-public-domain'").get(); await go(`/account?maker=${shelf.handle}`);
  // Each file through the feeds' own door (registerWork, as iiif.take leaves it): a Commons category brings repeats in as their own records.
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0; const put = async (buf, title) => { const f = path.join(dir, `in-${++k}.jpg`); fs.writeFileSync(f, buf); const w = await app.locals.registerWork({ file: f, title, makerId: shelf.id, kind: 'painting', artist: a.name, originalName: path.basename(f) }); assert.ok(w && w.slug, title); db.prepare("UPDATE works SET status='held', open='pd', artist_id=? WHERE slug=?").run(a.id, w.slug); return w.slug; };
  // The same painting three times (the master, a web copy, a grey copy), a different picture, a tiny file, a strip, a detail by its name.
  const master = await put(await sharp(fx).resize(1600).jpeg({ quality: 95 }).toBuffer(), 'Mona Lisa');
  const web = await put(await sharp(fx).resize(900).modulate({ brightness: 1.08 }).jpeg({ quality: 80 }).toBuffer(), 'Mona Lisa (Louvre scan)');
  const grey = await put(await sharp(fx).resize(1400).greyscale().jpeg().toBuffer(), 'Mona Lisa, black and white');
  const other = await put(await sharp(fx).resize(1300).flip().flop().rotate(90).jpeg().toBuffer(), 'The Last Supper');
  const tiny = await put(await sharp(fx).resize(300).rotate(180).jpeg().toBuffer(), 'Lady with an Ermine');
  const strip = await put(await sharp(fx).resize(2000, 300, { fit: 'cover' }).jpeg().toBuffer(), 'Predella panel');
  const detail = await put(await sharp(fx).resize(1300).extract({ left: 0, top: 0, width: 600, height: 700 }).jpeg().toBuffer(), 'Mona Lisa (detail of the hands)');
  const hands = await put(await sharp(await sharp(fx).resize(1600).jpeg().toBuffer()).metadata().then(async md => sharp(await sharp(fx).resize(1600).jpeg().toBuffer()).extract({ left: Math.round(md.width * .06), top: Math.round(md.height * .05), width: Math.round(md.width * .88), height: Math.round(md.height * .9) }).resize(2200).jpeg({ quality: 96 }).toBuffer()), 'The hands'); // a close scan of most of the picture, more pixels than the whole, no 'detail' in its name
  assert.equal(db.prepare("SELECT COUNT(*) n FROM works WHERE artist_id=? AND status='held'").get(a.id).n, 8);
  const p = await app.locals.tidy.plan(a);
  assert.ok(p && p.groups.length >= 1, 'a group of repeats'); const g = p.groups.find(x => x.keep.slug === master); assert.ok(g, 'the master is the one kept: ' + JSON.stringify(p.groups.map(x => x.keep.slug)));
  assert.ok(g.others.some(o => o.slug === web) && g.others.some(o => o.slug === grey), 'the web copy and the grey copy are its repeats'); assert.ok(g.others.some(o => o.slug === hands), 'the close scan of most of it is a repeat too: the whole stands over its crop, pixels or no');
  assert.ok(!p.groups.some(x => [x.keep, ...x.others].some(o => o.slug === other)), 'a different picture stands alone');
  const bad = Object.fromEntries(p.bad.map(b => [b.slug, b.why])); assert.ok(/too small/.test(bad[tiny] || ''), 'tiny: ' + bad[tiny]); assert.ok(/strip/.test(bad[strip] || '') || g.others.some(o => o.slug === strip), 'the strip, by its shape or as a crop of the whole: ' + bad[strip]); assert.ok(/detail/.test(bad[detail] || '') || g.others.some(o => o.slug === detail), 'the detail, by its name or as a crop of the whole');
  let t = await (await go(`/studio/art/${a.slug}/tidy`)).text(); assert.ok(t.includes('class="studio-wrap tyd"') && t.includes('tyd-best') && t.includes('Take ') && t.includes(master), 'the desk shows the plan with the best copy first');
  const r = await (await go(`/studio/art/${a.slug}/tidy/apply`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1' })).json();
  assert.ok(r.ok && r.n >= 4, 'taken off view: ' + r.n);
  for (const s of [web, grey, tiny, strip]) { const w = db.prepare('SELECT status, keep_back, tidy FROM works WHERE slug=?').get(s); assert.ok(w.status === 'hidden' && w.keep_back === 1 && w.tidy, s + ' off view, named: ' + w.tidy); }
  for (const s of [master, other]) assert.equal(db.prepare('SELECT status FROM works WHERE slug=?').get(s).status, 'held', s + ' stands');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='work.tidied'").get().n, r.n, 'each told on the register (hidden)');
  t = await (await fetch(base + '/ledger')).text(); assert.ok(!t.includes('tidied'), 'never on the public register');
  t = await (await fetch(base + '/art/' + a.slug)).text(); assert.ok(t.includes('/img/' + master + '/') && !t.includes('/img/' + web + '/'), 'the page shows the kept copy only');
  const u = await (await go(`/studio/art/${a.slug}/tidy/undo`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1' })).json(); assert.equal(u.n, r.n);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM works WHERE artist_id=? AND status='held'").get(a.id).n, 8, 'all back');
  assert.equal((await fetch(base + `/studio/art/${a.slug}/tidy`, { redirect: 'manual' })).status === 200, false, 'a stranger is refused');
  srv.close(); console.log('tidy: all hold');
})().catch(e => { console.error(e); process.exit(1); });
