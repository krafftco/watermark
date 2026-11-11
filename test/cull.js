// The cull (11 Nov): swipe right to show, left to keep back, undo; the same rules as publishing anywhere else.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-cull-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'cull', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const sharp = require('sharp');
  const house = db.prepare('SELECT * FROM makers ORDER BY id LIMIT 1').get();
  const mk = async (i, hue) => { const f = path.join(dir, `in${i}.jpg`); await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: hue, g: 90 + i * 20, b: 200 - hue } } }).composite([{ input: Buffer.from(`<svg width="1200" height="800"><circle cx="${200 + i * 150}" cy="${300 + i * 40}" r="${80 + i * 30}" fill="#fff"/><rect x="${i * 90}" y="600" width="300" height="60" fill="#000"/></svg>`) }]).jpeg({ quality: 92 }).toFile(f); const w = await app.locals.registerWork({ file: f, title: `Frame ${i}`, place: i < 3 ? 'Paris' : 'Rome', originalName: `in${i}.jpg`, makerId: house.id }); db.prepare("UPDATE works SET status='hidden', maker_id=? WHERE slug=?").run(house.id, w.slug); return w.slug; };
  const slugs = []; for (let i = 0; i < 4; i++) slugs.push(await mk(i, 40 + i * 50));
  // sign in as the house's maker through the Studio (the house walks every /account room)
  let r = await fetch(base + '/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: 'password=pw', redirect: 'manual' });
  const jar = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  const H = { cookie: jar, origin: base, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  const get = p => fetch(base + p, { headers: { cookie: jar }, redirect: 'manual' });
  const sayTo = b => fetch(base + '/account/cull/say', { method: 'POST', headers: H, body: new URLSearchParams(b).toString() }).then(x => x.json());
  r = await get('/account/cull'); assert.equal(r.status, 200); let t = await r.text(); assert.ok(t.includes('data-cll') && t.includes('Undecided') && t.includes('/static/cull.js'), 'the room');
  r = await get('/account/cull.json'); let d = await r.json(); assert.equal(d.deck, 'undecided'); assert.equal(d.works.length, 4); assert.equal(d.counts.private, 4);
  r = await get('/account/cull.json?deck=undecided&place=Rome'); d = await r.json(); assert.equal(d.works.length, 1, 'one place');
  // right, without the word: refused; with it: on view, on the register
  let a = await sayTo({ slug: slugs[0], to: 'show' }); assert.equal(a.ok, false); assert.equal(a.msg, 'attest');
  a = await sayTo({ slug: slugs[0], to: 'show', attest: '1' }); assert.ok(a.ok && a.status === 'public');
  assert.equal(db.prepare('SELECT status FROM works WHERE slug=?').get(slugs[0]).status, 'held');
  assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='work.published' AND subject=?").get(slugs[0]), 'told on the register');
  // left on a hidden work: stays hidden, and is decided
  a = await sayTo({ slug: slugs[1], to: 'hide' }); assert.ok(a.ok && a.status === 'private');
  r = await get('/account/cull.json'); d = await r.json(); assert.deepEqual(d.works.map(w => w.slug).sort(), [slugs[2], slugs[3]].sort(), 'the undecided deck never serves a decided work twice');
  // a kept-back work let go by the swipe
  db.prepare('UPDATE works SET keep_back=1 WHERE slug=?').run(slugs[2]);
  a = await sayTo({ slug: slugs[2], to: 'show', attest: '1' }); assert.ok(a.ok && a.status === 'public' && a.kept === 0);
  // undo: back to kept back, and undecided again
  a = await sayTo({ slug: slugs[2], to: 'undo', was: 'private', kept: '1' }); assert.ok(a.ok && a.status === 'private' && a.kept === 1);
  assert.equal(db.prepare('SELECT cull_at FROM works WHERE slug=?').get(slugs[2]).cull_at, null);
  // left on a work on view takes it down; undo puts it back
  a = await sayTo({ slug: slugs[0], to: 'hide' }); assert.ok(a.ok && a.status === 'private');
  a = await sayTo({ slug: slugs[0], to: 'undo', was: 'public', kept: '0' }); assert.ok(a.ok && a.status === 'public');
  // someone else's work, and a stranger
  a = await sayTo({ slug: 'no-such-work', to: 'show', attest: '1' }); assert.equal(a.ok, false);
  r = await fetch(base + '/account/cull/say', { method: 'POST', headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: `slug=${slugs[3]}&to=show&attest=1` }); assert.equal(r.status, 401);
  r = await fetch(base + '/account/cull', { redirect: 'manual' }); assert.equal(r.status, 302);
  assert.equal(db.prepare('SELECT status FROM works WHERE slug=?').get(slugs[3]).status, 'hidden');
  r = await get('/account/table'); t = await r.text(); assert.ok(t.includes('href="/account/cull"'), 'the Library leads to it');
  srv.close(); console.log('cull: right shows, left keeps back, undo takes it back'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
