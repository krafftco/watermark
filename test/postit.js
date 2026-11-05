// Post it and the link in bio (5 Nov): a post and a story for every work on view; nothing kept back, nothing behind a
// door; /@handle opens on the maker's work; the maker's Instagram room lists their link and their works.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-postit-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'postit', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, kind, bio, joined_at, door) VALUES ('ada', 'Ada Lens', 'maker', 'I photograph rivers at dawn. And other things.', datetime('now'), 'house')").run();
  const ada = db.prepare("SELECT * FROM makers WHERE handle='ada'").get();
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const put = async (title, extra = '') => { const f = path.join(dir, `in-${++k}.jpg`); fs.writeFileSync(f, await sharp(fx).resize(1600 - k * 97).modulate({ hue: k * 70 }).flop(k % 2 === 0).jpeg().toBuffer()); const w = await app.locals.registerWork({ file: f, title, makerId: ada.id, originalName: path.basename(f) }); db.prepare(`UPDATE works SET status='held'${extra} WHERE slug=?`).run(w.slug); return w.slug; };
  const shown = await put('The River at Dawn'), kept = await put('A Private One', ', keep_back=1'), adult = await put('The Room Upstairs', ", zone='mature'");
  const get = (p, h = {}) => fetch(base + p, { redirect: 'manual', headers: h });
  for (const [kind, H] of [['post', 1350], ['story', 1920]]) {
    const r = await get(`/w/${shown}/${kind}.jpg`); assert.strictEqual(r.status, 200, kind);
    const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata(); assert.ok(meta.width === 1080 && meta.height === H, `${kind} ${meta.width}x${meta.height}`);
  }
  assert.strictEqual((await get(`/w/${kept}/post.jpg`)).status, 404, 'kept back is never a card');
  assert.strictEqual((await get(`/w/${adult}/story.jpg`)).status, 404, 'behind the door is never a card for a stranger');
  assert.strictEqual((await get(`/w/${adult}/story.jpg`, { cookie: 'wm_zone=mature' })).status, 200, 'the rooms open, it is');
  const dl = await get(`/w/${shown}/post.jpg?dl=1`); assert.ok(/attachment; filename="The River at Dawn \(post\)\.jpg"/.test(dl.headers.get('content-disposition') || ''), 'named for saving');
  let t = await (await get('/@ada')).text();
  assert.ok(t.includes('Ada Lens') && t.includes('Wander Ada') && t.includes(`/w/${shown}/post.jpg`) && t.includes('I photograph rivers at dawn.'), 'the link in bio');
  assert.ok(!t.includes(kept) && !t.includes(adult), 'nothing kept back or behind a door on it');
  assert.strictEqual((await get('/@nobody-here')).status, 404);
  assert.strictEqual((await get('/@ada-lens')).status, 200, 'by the page slug too');
  assert.strictEqual((await get('/account/billboard')).status, 302, 'the room is the maker\'s');
  const login = await fetch(base + '/studio/login', { method: 'POST', redirect: 'manual', headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  let jar = (login.headers.getSetCookie() || []).map(c => c.split(';')[0]).join('; ');
  const as = await get('/account/billboard?maker=ada', { cookie: jar }); jar += '; ' + (as.headers.getSetCookie() || []).map(c => c.split(';')[0]).join('; ');
  const room = as.status === 200 ? as : await get('/account/billboard', { cookie: jar });
  t = await room.text(); assert.ok(t.includes('/@ada') && t.includes(`data-wm-send="${shown}"`) && !t.includes(`data-wm-send="${kept}"`), 'the room: ' + room.status);
  console.log('post it: ok'); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
