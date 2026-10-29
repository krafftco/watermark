// A museum for everyone (29 Oct): the open door, the limited wall, the halls earned, following and Wander's Following.
process.env.NODE_ENV = 'test'; process.env.MUSEUM_WALL = '3';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { createApp } = require('../src/app');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-mus-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'mus', noTimers: true, vaultNow: true });
  const { db } = app.locals; const M = app.locals.museums;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jarOf = () => { const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; }); return go; };
  const form = (go, p, body) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

  // The door says it.
  let r = await fetch(base + '/join'); let t = await r.text();
  assert.ok(/Open your museum/.test(t) && /action="\/record"/.test(t) && /Collectors, not followers/.test(t), 'the door is open');

  // An artist opens a museum and puts work in.
  const ana = jarOf(); r = await form(ana, '/record', { name: 'Ana Open', email: 'ana@example.com', adult: '1' });
  assert.ok(/\/account\/upload/.test(r.headers.get('location')), 'opened');
  const am = db.prepare("SELECT * FROM makers WHERE email='ana@example.com'").get(); assert.equal(am.door, 'record');
  const slugs = [];
  for (let i = 0; i < 4; i++) {
    const buf = await sharp({ create: { width: 1600, height: 1100, channels: 3, background: { r: 30 + i * 50, g: 90, b: 160 - i * 30 } } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100"><circle cx="${300 + i * 300}" cy="${400 + i * 100}" r="${180 + i * 40}" fill="#fff"/></svg>`) }]).jpeg().toBuffer();
    const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), `ana-${i}.jpg`); fd.append('place', 'Lisbon');
    r = await ana('/account/works/one', { method: 'POST', body: fd }); const j = await r.json(); assert.ok(j.ok, 'in: ' + JSON.stringify(j)); slugs.push(j.slug);
  }
  // The wall: three on view (MUSEUM_WALL=3 here), the fourth refused with the reason.
  r = await form(ana, '/account/works/batch', { do: 'publish', attest: '1', json: '1', slugs: slugs.join(',') });
  const bj = await r.json().catch(() => ({}));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND status='held'").get(am.id).n, 3, 'three on view: ' + JSON.stringify(bj));
  assert.ok(/walls are full/.test(JSON.stringify(bj)), 'the fourth is told why');
  assert.equal(M.wallLeft(am), 0);

  // On view in the museum, not in the halls.
  const held = db.prepare("SELECT slug FROM works WHERE maker_id=? AND status='held' ORDER BY id").all(am.id).map(x => x.slug);
  const inHall = s => !!db.prepare(`SELECT 1 FROM works w WHERE w.slug=?${M.hallSql('w')}`).get(s);
  assert.ok(held.every(s => !inHall(s)), 'the halls hold what was placed');
  r = await fetch(base + `/m/${am.handle}`); t = await r.text(); assert.ok(r.status === 200 && held.every(s => t.includes(s)), 'the museum shows them');
  assert.ok(/data-follow="maker:\d+"/.test(t), 'a follow button on the artist');
  r = await fetch(base + '/api/stroll?n=16'); assert.ok(!(await r.json()).items.some(i => held.includes(i.slug)), 'not in the open Wander');

  // A collector follows the artist; nothing earned yet.
  const col = jarOf();
  r = await form(col, '/follow', { k: `maker:${am.id}` }); assert.ok((await r.json()).go, 'a stranger is sent to sign in');
  const b = db.prepare("INSERT INTO buyers (customer, code, name, email, public) VALUES ('cus_colfollow','COLFOLLOW','Cole Lector','cole@example.com',1)").run(); const bid = b.lastInsertRowid;
  app.locals.lastCode = null; await form(col, '/signin/code', { email: 'cole@example.com' });
  await form(col, '/signin/verify', { email: 'cole@example.com', code: app.locals.lastCode.code });
  r = await form(col, '/follow', { k: `maker:${am.id}` }); let fj = await r.json(); assert.ok(fj.ok && fj.on, 'followed: ' + JSON.stringify(fj));
  r = await col('/api/follow?k=maker:' + am.id); assert.equal((await r.json()).on['maker:' + am.id], true);
  assert.ok(!/follower/i.test(t.replace(/Collectors, not followers/g, '')), 'no follower count on the wall');

  // Following, in Wander: the artist's new work.
  r = await col('/api/stroll?in=following&n=8'); let sj = await r.json();
  assert.ok(sj.items && held.some(s => sj.items.map(i => i.slug).includes(s)), 'Wander walks what they follow: ' + JSON.stringify(sj).slice(0, 200));
  r = await col('/yours/following'); t = await r.text(); assert.ok(/Ana Open/.test(t) && /in=following/.test(t), 'the list');

  // Earning the hall: two bravos.
  db.prepare("INSERT INTO buyers (customer, code, name) VALUES ('cus_b2','B2', 'Two')").run();
  const w0 = db.prepare('SELECT id FROM works WHERE slug=?').get(held[0]).id;
  db.prepare('INSERT INTO bravos (work_id, buyer_id) VALUES (?,?),(?,?)').run(w0, bid, w0, bid + 1);
  // hung by someone else on a public wall
  const w1 = db.prepare('SELECT id FROM works WHERE slug=?').get(held[1]).id;
  const hg = db.prepare("INSERT INTO hangs (buyer_id, slug, title, public) VALUES (?, 'cole-wall', 'Cole’s wall', 1)").run(bid).lastInsertRowid;
  db.prepare('INSERT INTO hang_works (hang_id, work_id, pos) VALUES (?,?,0)').run(hg, w1);
  assert.equal(M.earn(), 2, 'two earned');
  assert.ok(inHall(held[0]) && inHall(held[1]) && !inHall(held[2]), 'bravo and the curator brought them in; the third waits');
  assert.equal(db.prepare('SELECT hall_why FROM works WHERE id=?').get(w0).hall_why, 'bravo');

  // Following a collector: their wall shows in Following.
  const ana2 = ana; r = await form(ana2, '/follow', { k: `gallery:${bid}` }); fj = await r.json(); assert.ok(fj.ok && fj.on, 'an artist follows a curator');
  r = await form(ana2, '/follow', { k: `maker:${am.id}` }); assert.ok(/This is you/.test(JSON.stringify(await r.json())), 'not yourself');
  // Unfollow
  r = await form(col, '/follow', { k: `maker:${am.id}` }); assert.equal((await r.json()).on, false, 'unfollowed');

  // Signed at capture: the camera's own Content Credentials, said on the work's page.
  db.prepare('UPDATE works SET credentials=? WHERE slug=?').run(JSON.stringify({ captured: true, issuer: 'Leica Camera AG', camera_signer: 'Leica Camera AG', chain: [] }), held[0]);
  r = await fetch(base + `/w/${held[0]}`); t = await r.text(); assert.ok(/Signed at capture/.test(t) && /signed by Leica at the moment it was made/.test(t), 'the camera’s signature, said');
  // An invited maker's work is in the halls at once.
  db.prepare("UPDATE makers SET door='house' WHERE id=?").run(am.id);
  assert.ok(inHall(held[2]), 'invited: all of it in the halls');

  srv.close(); console.log('museums: all good'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
