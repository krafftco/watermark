// Trimming the scans (12 Nov, #1): a shelf scan's border (a paper margin, a black bar) is proposed as a trim, applied
// by a person, and left off the display copies; a flat field of the picture's own is never trimmed; a living maker's
// work never; an untrimmed work's copies keep their names and bytes; the master is never touched; Undo puts it back.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto'); const sharp = require('sharp');
const { createApp } = require('../src/app');
const images = require('../src/images');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-trim-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'trim', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; } return r; });
  const form = (p, body) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  await form('/studio/login', 'password=pw');
  db.prepare("INSERT INTO makers (handle, name, kind, house, joined_at, door) VALUES ('the-public-domain', 'The public domain', 'institution', 'Open', datetime('now'), 'house')").run();
  db.prepare("INSERT INTO makers (handle, name, kind, joined_at, door) VALUES ('ada', 'Ada Lens', 'maker', datetime('now'), 'house')").run();
  const shelf = db.prepare("SELECT * FROM makers WHERE handle='the-public-domain'").get(), ada = db.prepare("SELECT * FROM makers WHERE handle='ada'").get();
  let k = 0;
  const put = async (buf, title, maker = shelf) => { const f = path.join(dir, `in-${++k}.jpg`); fs.writeFileSync(f, buf); const w = await app.locals.registerWork({ file: f, title, makerId: maker.id, kind: 'painting', originalName: path.basename(f) }); db.prepare(`UPDATE works SET status='held', open=${maker === shelf ? "'pd'" : 'NULL'} WHERE slug=?`).run(w.slug); return w.slug; };
  // A painting-like surface: mid tones (60–200) with brushy texture, never near the white of paper or the black of a bar.
  const paint = async (W, H, seed = 1) => { const raw = Buffer.alloc(W * H * 3); let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); for (let i = 0; i < raw.length; i += 3) { raw[i] = 60 + rnd() * 140; raw[i + 1] = 60 + rnd() * 120; raw[i + 2] = 50 + rnd() * 110; } return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).blur(2).toBuffer().then(b => sharp(b, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()); };
  // (a) a white paper margin top (60) and left (60), a thin black bar on the right (20), nothing at the bottom.
  const inner = await paint(2400, 1740);
  const scanned = await sharp(await sharp(inner).extend({ top: 60, left: 60, background: { r: 246, g: 244, b: 238 } }).png().toBuffer()).extend({ right: 20, background: { r: 6, g: 6, b: 6 } }).jpeg({ quality: 95 }).toBuffer();
  const a = await put(scanned, 'A Scan With A Margin');
  // (b) a flat dark ground running to every edge, a painted figure in the middle.
  const fig = await paint(1000, 800, 7);
  const ground = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 20, g: 18, b: 16 } } }).composite([{ input: fig, left: 700, top: 500 }]).jpeg({ quality: 95 }).toBuffer();
  const b = await put(ground, 'A Figure On A Dark Ground');
  // (c) a living maker's work with the same margin.
  const c = await put(await sharp(scanned).jpeg({ quality: 93 }).toBuffer(), 'My Own Scan', ada);
  // (d) an untrimmed work: its copy's name and bytes before anything is trimmed.
  const d = await put(await paint(2000, 1500, 3).then(p => sharp(p).jpeg({ quality: 95 }).toBuffer()), 'An Untouched Picture');
  const T = app.locals.trim, cache = path.join(dir, 'cache');
  const row = s => db.prepare('SELECT * FROM works WHERE slug=?').get(s);
  const screen = async s => { const r = await go(`/img/${s}/screen`, { headers: { accept: 'image/jpeg' } }); assert.strictEqual(r.status, 200, `/img/${s}/screen ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
  const dBefore = await screen(d);
  assert.ok(fs.existsSync(path.join(cache, `${d}-screenq5.jpg`)), '(d) an untrimmed copy keeps its old name');
  // The proposals (the job, one at a time; never applied).
  const job = T.run(50); for (let i = 0; i < 400 && job.running; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(!job.running && job.failed === 0, JSON.stringify(job));
  const readOf = s => JSON.parse(row(s).trim_read || 'null');
  const ra = readOf(a); assert.ok(ra && ra.box, '(a) a trim proposed: ' + JSON.stringify(ra));
  const W = 2480, H = 1800; // the scan's full size
  const near = (v, want, tol, what) => assert.ok(Math.abs(v - want) <= tol, `${what}: ${v} vs ${want} (${JSON.stringify(ra)})`);
  near(ra.box.x * W, 60, 8, '(a) the left margin'); near(ra.box.y * H, 60, 8, '(a) the top margin');
  near((1 - ra.box.x - ra.box.w) * W, 20, 8, '(a) the black bar'); near((1 - ra.box.y - ra.box.h) * H, 0, 0.5, '(a) the bottom untouched');
  assert.ok(ra.box.x * W >= 60 && ra.box.y * H >= 60 && (1 - ra.box.x - ra.box.w) * W >= 20, '(a) the cut reaches past every border');
  const rb = readOf(b); assert.ok(rb && !rb.box, '(b) a flat ground of the picture’s own is not trimmed: ' + JSON.stringify(rb));
  assert.strictEqual(readOf(c), null, '(c) a living maker’s work is never read');
  assert.ok(!row(a).trim, 'nothing applied by the house');
  // The desk.
  let t = await (await go('/studio/trim')).text(); assert.ok(t.includes('Trim the scans') && t.includes(a) && t.includes('Apply'), 'the desk');
  assert.ok([200, 302].includes((await go(`/studio/trim/${a}/before.jpg`)).status), 'before thumb');
  // (c) Apply refused for a living maker's work.
  const rc = await form('/studio/trim/apply', `slug=${c}&json=1`); assert.strictEqual(rc.status, 403, '(c) apply refused');
  db.prepare('UPDATE works SET trim_read=? WHERE slug=?').run(JSON.stringify(ra), c);
  assert.strictEqual((await form('/studio/trim/apply', `slug=${c}&json=1`)).status, 403, '(c) refused even with a reading in place');
  // (e) Apply: the master's bytes the same, before and after.
  const master = path.join(dir, 'originals', row(a).original_file); const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const shaBefore = sha(master), aBefore = await screen(a);
  const ap = await (await form('/studio/trim/apply', `slug=${a}&json=1`)).json(); assert.ok(ap.ok, JSON.stringify(ap));
  assert.ok(row(a).trim && !row(a).copies_at, 'trim kept; copies to be remade');
  assert.ok(db.prepare('SELECT 1 FROM render_asks WHERE slug=?').get(a), 'a ticket for the scribes');
  await app.locals.copies.make(row(a));
  const aAfter = await screen(a);
  assert.strictEqual(sha(path.join(dir, 'originals', row(a).original_file)), shaBefore, '(e) the master untouched');
  // (a) the served copy has no border on the trimmed sides.
  const { data, info } = await sharp(aAfter).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
  let white = 0, black = 0;
  for (let y = 0; y < info.height; y++) for (const x of [0, 1]) { const p = px(x, y); if (p.every(v => v > 225)) white++; }
  for (let x = 0; x < info.width; x++) for (const y of [0, 1]) { const p = px(x, y); if (p.every(v => v > 225)) white++; }
  for (let y = 0; y < info.height; y++) for (const x of [info.width - 1, info.width - 2]) { const p = px(x, y); if (p.every(v => v < 35)) black++; }
  assert.strictEqual(white, 0, '(a) no paper on the top and left edges of the served copy');
  assert.strictEqual(black, 0, '(a) no black bar on the right edge of the served copy');
  assert.ok(!aAfter.equals(aBefore), 'the copy changed');
  assert.ok(fs.readdirSync(cache).some(f => f.startsWith(`${a}-t`) && f.endsWith('-screenq5.jpg')), 'the trimmed copy carries the box in its name');
  // (d) the untrimmed work: same name, same bytes, and the same bytes the copy code makes without a trim.
  assert.ok((await screen(d)).equals(dBefore), '(d) untouched bytes');
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-trim-d-'));
  const again = await images.derivative(path.join(dir, 'originals', row(d).original_file), fresh, d, 'screen', 'jpg', { trim: null });
  assert.strictEqual(path.basename(again), `${d}-screenq5.jpg`); assert.ok(fs.readFileSync(again).equals(dBefore), '(d) made afresh, the same bytes');
  fs.rmSync(fresh, { recursive: true, force: true });
  // (f) Undo: the untrimmed copy back, byte for byte; the trimmed copies gone.
  const un = await (await form('/studio/trim/undo', `slug=${a}&json=1`)).json(); assert.ok(un.ok);
  assert.ok(!row(a).trim, 'trim cleared');
  assert.ok((await screen(a)).equals(aBefore), '(f) undo restores the original copy');
  assert.ok(!fs.readdirSync(cache).some(f => f.startsWith(`${a}-t`)), '(f) the trimmed copies are gone');
  assert.strictEqual(sha(path.join(dir, 'originals', row(a).original_file)), shaBefore, '(e) the master untouched after undo');
  // Not this one: set aside.
  db.prepare('UPDATE works SET trim_read=? WHERE slug=?').run(JSON.stringify(ra), a);
  assert.ok((await (await form('/studio/trim/dismiss', `slug=${a}&json=1`)).json()).ok); assert.ok(readOf(a).dismissed, 'set aside');
  // The register keeps the acts hidden.
  const ev = db.prepare("SELECT type AS kind FROM ledger WHERE type IN ('work.trimmed','work.untrimmed')").all().map(r => r.kind); assert.deepStrictEqual(ev.sort(), ['work.trimmed', 'work.untrimmed']);
  const pub = await (await go('/ledger')).text(); assert.ok(!/trimmed/i.test(pub), 'hidden from the public register');
  console.log('trimming the scans: ok'); srv.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
