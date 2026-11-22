// A maker's own uploads get their copies through the scribes, kept back or private alike (#196; Will, 22 Nov: 31
// photographs kept back for a client album, 15 of them black in the album picker). The masters come in through the
// vault's own doors; the website never opens a master (NO_MASTER_ON_WEB); the scribes' path (claim → make → mark) takes
// the maker's own new works first, every size; then the queue as before; a museum's kept-back and private works stay out.
// Then the walk: the album picker, as the maker, shows a picture in every square, and the album's screen copy is there.
// KEPT_N (31) sets how many photographs.
process.env.NODE_ENV = 'test'; process.env.NO_MASTER_ON_WEB = '1';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto'); const sharp = require('sharp');
const { createApp } = require('../src/app');
const images = require('../src/images');
const N = Math.max(2, +process.env.KEPT_N || 31);
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-keptcopies-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'keptcopies', noTimers: true, vaultNow: true });
  const { db } = app.locals; const CP = app.locals.copies; const cache = path.join(dir, 'cache');
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const say = (...a) => console.log('keptcopies:', ...a);

  // 1. A photographer joins and sends N photographs through the vault's doors.
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  await form(studio, '/studio/accounts', { name: 'Ada Lens', email: 'ada@example.com' });
  const invite = (app.locals.mailLog || []).find(m => m.to === 'ada@example.com' && /invitation/i.test(m.subject)); assert.ok(invite, 'the invitation');
  const ada = {}; await go(ada, (invite.text.match(/http:\/\/localhost(\/account\/join\/[\w-]+)/) || [])[1]);
  const M = db.prepare("SELECT * FROM makers WHERE email='ada@example.com'").get(); assert.ok(M && M.joined_at, 'Ada has joined');
  const send = async k => {
    // Each a different picture to the fingerprint: a field of noise of its own.
    const buf = await sharp({ create: { width: 1000, height: 667, channels: 3, noise: { type: 'gaussian', mean: 90 + (k % 7) * 10, sigma: 50 } } }).jpeg({ quality: 82 }).toBuffer();
    const st = await form(ada, '/account/arrivals/start', { name: `DSC_${1000 + k}.jpg`, size: buf.length, type: 'image/jpeg', sha256: crypto.createHash('sha256').update(buf).digest('hex') }).then(x => x.json()); assert.ok(st.ok, 'start: ' + JSON.stringify(st));
    if (!st.direct) { const b = await go(ada, `/account/arrivals/${st.id}/body`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buf }).then(x => x.json()); assert.ok(b.ok, 'body: ' + JSON.stringify(b)); }
    for (let i = 0; i < 600; i++) { const a = db.prepare('SELECT status, slug, error FROM arrivals WHERE id=?').get(st.id); if (a.status === 'done') return db.prepare('SELECT * FROM works WHERE slug=?').get(a.slug); if (a.status === 'failed') throw new Error('arrival failed: ' + a.error); await new Promise(x => setTimeout(x, 50)); }
    throw new Error('the arrival never finished');
  };
  const own = []; for (let k = 0; k < N; k++) own.push(await send(k));
  assert.ok(own.every(w => w.maker_id === M.id && w.status === 'hidden'), 'every upload is Ada’s and private as it lands');
  // Half kept back on view's side (held, keep_back), half left private as they landed: both are "kept back" to Ada.
  for (const w of own.filter((w, i) => i % 2)) db.prepare("UPDATE works SET status='held', keep_back=1 WHERE id=?").run(w.id);
  say(`1. ${N} photographs in through the vault, ${own.filter((w, i) => i % 2).length} kept back, the rest private`);

  // 2. A museum's works beside them: on view (in the queue as before), kept back and private (never in it).
  db.prepare("INSERT INTO makers (handle, name, kind, joined_at, door) VALUES ('museum-a', 'A Museum', 'institution', datetime('now'), 'house')").run();
  const mus = db.prepare("SELECT * FROM makers WHERE handle='museum-a'").get(); const fx = path.join(__dirname, 'fixture.jpg'); let j = 0;
  const shelf = async (title, set) => { const f = path.join(dir, `mus-${++j}.jpg`); fs.writeFileSync(f, await sharp(fx).rotate(90 * j).negate({ alpha: false }).jpeg().toBuffer()); const w = await app.locals.registerWork({ file: f, title, makerId: mus.id, place: 'Rome', originalName: path.basename(f) }); db.prepare(`UPDATE works SET ${set}, copies_at=NULL WHERE slug=?`).run(w.slug); return db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug); };
  const onView = await shelf('On view', "status='held', curated=1, stars=5"); const museumKept = await shelf('Kept', "status='held', keep_back=1"); const museumPrivate = await shelf('Private', "status='hidden'");
  const p0 = CP.progress(); assert.equal(p0.left, N + 1, 'left: Ada’s ' + N + ' and the museum’s one on view: ' + JSON.stringify({ left: p0.left }));

  // 3. Before the scribes: the picker's squares are the dark (the fault Will saw).
  const thumbs = h => [...h.matchAll(/<img[^>]+src="\/img\/([^/"]+)\/thumb"/g)].map(m => m[1]);
  let pick = await go(ada, '/account/deliveries/new'); assert.equal(pick.status, 200); let html = await pick.text(); let sq = thumbs(html.slice(html.indexOf('data-dv-pick')));
  assert.equal(sq.length, N, 'every photograph has its square: ' + sq.length);
  let r = await go(ada, `/img/${sq[0]}/thumb`); assert.equal(r.headers.get('x-making'), '1', 'before the scribes, the dark'); await r.arrayBuffer();
  db.prepare('DELETE FROM render_asks').run(); // the scribes alone, not the visitor's ticket, make them here

  // 4. The scribes' path: Ada's own new works first (the museum's curated five-star work waits behind them), every size.
  const order = []; const t0 = Date.now();
  for (let i = 0; i < N + 5; i++) { const before = CP.scribe.made; if (!(await CP.one())) break; assert.equal(CP.scribe.made, before + 1, 'made, not failed: ' + CP.scribe.error); order.push(CP.scribe.last); }
  const ms = Date.now() - t0;
  const ids = new Set(own.map(w => w.slug));
  assert.ok(order.slice(0, N).every(s => ids.has(s)), 'Ada’s own first: ' + order.join(','));
  assert.equal(order[N], onView.slug, 'then the queue as before');
  assert.equal(order.length, N + 1, 'and nothing else: ' + order.length);
  for (const w of [museumKept, museumPrivate]) { const x = db.prepare('SELECT copies_at, copies_claim, copies_tries FROM works WHERE id=?').get(w.id); assert.ok(!x.copies_at && !x.copies_claim && !x.copies_tries, 'a museum’s kept-back or private work stays out: ' + JSON.stringify(x)); }
  for (const w of own) {
    assert.ok(db.prepare('SELECT copies_at FROM works WHERE id=?').get(w.id).copies_at, 'marked: ' + w.slug);
    for (const s of ['thumb', 'screen', 'large']) assert.ok(fs.existsSync(images.fileOf(cache, w.slug, s, 'jpg')), `${w.slug} ${s}`);
  }
  assert.equal(CP.progress().left, 0);
  say(`2. the scribes' path: ${N} of Ada's first, every size, in ${(ms / 1000).toFixed(1)} s on one lane; the museum's kept-back and private untouched`);

  // 5. The walk: the picker as Ada, every square a picture; the album's screen copy too; a stranger still sees none of it.
  pick = await go(ada, '/account/deliveries/new'); html = await pick.text(); sq = thumbs(html.slice(html.indexOf('data-dv-pick'))); assert.equal(sq.length, N);
  for (const s of sq) for (const z of ['thumb', 'screen']) {
    r = await go(ada, `/img/${s}/${z}`); const b = Buffer.from(await r.arrayBuffer());
    assert.equal(r.status, 200, `${s} ${z}`); assert.ok(!r.headers.get('x-making') && !r.headers.get('x-stand-in'), `${s} ${z}: ${r.headers.get('x-making') ? 'the dark' : 'a stand-in'}`);
    assert.ok(/image\/(jpeg|webp)/.test(r.headers.get('content-type')), r.headers.get('content-type')); const m = await sharp(b).metadata(); assert.ok(m.width > 24, 'a picture, not the placeholder');
  }
  const kept = own.find((w, i) => i % 2); r = await go({}, `/img/${kept.slug}/screen`); assert.equal(r.status, 404, 'a stranger never sees a kept-back picture'); await r.arrayBuffer();
  say(`3. the album picker: ${N} squares, each with its thumb and its screen copy`);
  srv.close(); fs.rmSync(dir, { recursive: true, force: true }); console.log('keptcopies: holds'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
