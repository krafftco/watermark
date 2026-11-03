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
  const m1600 = await sharp(fx).resize(1600).jpeg().toBuffer(); const md = await sharp(m1600).metadata();
  const hands = await put(await sharp(m1600).extract({ left: Math.round(md.width * .15), top: Math.round(md.height * .15), width: Math.round(md.width * .7), height: Math.round(md.height * .7) }).resize(2200).jpeg({ quality: 96 }).toBuffer(), 'The hands'); // seven tenths of the picture at more pixels than the whole: a detail by its look, not its name
  const framed = await put(await sharp(await sharp(fx).resize(2000).jpeg().toBuffer()).extend({ top: 160, bottom: 160, left: 160, right: 160, background: { r: 120, g: 90, b: 40 } }).jpeg({ quality: 95 }).toBuffer(), 'Mona Lisa in its frame'); // more pixels, but a margin round the picture
  // Folios: two different pages of a codex, alike to the eye, must never be one; and no chain through a third.
  const page = async (seed, title) => { const im = await sharp({ create: { width: 1000, height: 1400, channels: 3, background: { r: 222, g: 205, b: 170 } } }).composite([{ input: Buffer.from(`<svg width="1000" height="1400"><g fill="#3a2a1a">${Array.from({ length: 34 }, (_, i) => `<rect x="${90 + ((seed * 37 + i * 53) % 140)}" y="${120 + i * 34}" width="${520 + ((seed * 71 + i * 29) % 260)}" height="9"/>`).join('')}</g></svg>`), top: 0, left: 0 }]).jpeg().toBuffer(); return put(im, title); };
  const f1 = await page(1, 'Codex Atlanticus - 001R'), f2 = await page(2, 'Codex Atlanticus - 002R'), f3 = await page(3, 'Codex Atlanticus - 003R');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM works WHERE artist_id=? AND status='held'").get(a.id).n, 12);
  const p = await app.locals.tidy.plan(a);
  assert.ok(p && p.groups.length >= 1, 'a group of repeats'); const g = p.groups.find(x => x.keep.slug === master); assert.ok(g, 'the master is the one kept: ' + JSON.stringify(p.groups.map(x => x.keep.slug)));
  assert.ok(g.others.some(o => o.slug === web) && g.others.some(o => o.slug === grey), 'the web copy and the grey copy are its repeats'); assert.ok(g.others.some(o => o.slug === hands), 'the detail is a repeat too: the whole stands over its part, pixels or no'); assert.ok(g.others.some(o => o.slug === framed), 'the framed copy is a repeat, and loses to the clean one though larger');
  assert.ok(!p.groups.some(x => [x.keep, ...x.others].filter(o => [f1, f2, f3].includes(o.slug)).length > 1), 'three folios of a codex: never one');
  assert.ok(!p.groups.some(x => [x.keep, ...x.others].some(o => o.slug === other)), 'a different picture stands alone');
  const bad = Object.fromEntries(p.bad.map(b => [b.slug, b.why])); assert.ok(/too small/.test(bad[tiny] || ''), 'tiny: ' + bad[tiny]); assert.ok(/strip/.test(bad[strip] || '') || g.others.some(o => o.slug === strip), 'the strip, by its shape or as a crop of the whole: ' + bad[strip]); assert.ok(/detail/.test(bad[detail] || '') || g.others.some(o => o.slug === detail), 'the detail, by its name or as a crop of the whole');
  let t = await (await go(`/studio/art/${a.slug}/tidy`)).text(); assert.ok(t.includes('class="studio-wrap tyd"') && t.includes('tyd-best') && t.includes('Take ') && t.includes(master), 'the desk shows the plan with the best copy first');
  const r = await (await go(`/studio/art/${a.slug}/tidy/apply`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1' })).json();
  assert.ok(r.ok && r.n >= 4, 'taken off view: ' + r.n);
  for (const s of [web, grey, tiny, strip]) { const w = db.prepare('SELECT status, keep_back, tidy FROM works WHERE slug=?').get(s); assert.ok(w.status === 'hidden' && w.keep_back === 1 && w.tidy, s + ' off view, named: ' + w.tidy); }
  for (const s of [master, other, f1, f2, f3]) assert.equal(db.prepare('SELECT status FROM works WHERE slug=?').get(s).status, 'held', s + ' stands');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='work.tidied'").get().n, r.n, 'each told on the register (hidden)');
  t = await (await fetch(base + '/ledger')).text(); assert.ok(!t.includes('tidied'), 'never on the public register');
  t = await (await fetch(base + '/art/' + a.slug)).text(); assert.ok(t.includes('/img/' + master + '/') && !t.includes('/img/' + web + '/'), 'the page shows the kept copy only');
  const u = await (await go(`/studio/art/${a.slug}/tidy/undo`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'json=1' })).json(); assert.equal(u.n, r.n);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM works WHERE artist_id=? AND status='held'").get(a.id).n, 12, 'all back');
  assert.equal((await fetch(base + `/studio/art/${a.slug}/tidy`, { redirect: 'manual' })).status === 200, false, 'a stranger is refused');
  srv.close(); console.log('tidy: all hold');
})().catch(e => { console.error(e); process.exit(1); });
