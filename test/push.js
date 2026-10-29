// Push (29 Oct): a computer paired by a code, a folder culled by Lightroom's stars, sent through the vault's doors,
// verified, and never sent twice; the key opens only the vault, and ending it ends it.
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { execFile } = require('child_process');
const sharp = require('sharp');
const { createApp } = require('../src/app');

const xmpJpeg = (buf, rating) => {
  const ns = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');
  const pkt = Buffer.from(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="${rating}"/></rdf:RDF></x:xmpmeta>`, 'utf8');
  const len = ns.length + pkt.length + 2; const seg = Buffer.concat([Buffer.from([0xff, 0xe1, len >> 8, len & 255]), ns, pkt]);
  return Buffer.concat([buf.subarray(0, 2), seg, buf.subarray(2)]);
};
const pic = (i, w = 1600, h = 1067) => sharp({ create: { width: w, height: h, channels: 3, background: { r: (i * 70) % 255, g: (i * 31) % 255, b: (i * 113) % 255 } } })
  .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="${200 + i * 230}" cy="${300 + (i % 3) * 200}" r="${150 + i * 20}" fill="#fff"/><rect x="${i * 90}" y="700" width="500" height="200" fill="#123"/></svg>`) }]).jpeg({ quality: 90 }).toBuffer();
const run = (args, env) => new Promise(res => execFile(process.execPath, [path.join(__dirname, '..', 'bin', 'watermark.js'), ...args], { env: { ...process.env, ...env } }, (e, out, err) => res({ code: e ? e.code : 0, out: out + err })));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-push-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'push', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  let maker = db.prepare("SELECT * FROM makers WHERE kind IS NULL OR kind='maker' ORDER BY id LIMIT 1").get();
  if (!maker) { db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('push','The Pusher','push@example.com','maker',datetime('now'),'house')").run(); maker = db.prepare("SELECT * FROM makers WHERE handle='push'").get(); }
  const jar = {}; const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const take = r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar[k] = v; } return r; };
  const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: cookie(), ...(o.headers || {}) } }).then(take);
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  await go(`/account?maker=${maker.handle}`);

  // The pairing, by hand (what login does), approved where the maker is signed in.
  const b = await (await fetch(base + '/api/push/begin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: "Will's MacBook Pro" }) })).json();
  assert.ok(b.ok && /^[A-Z]{4}-[A-Z]{4}$/.test(b.code), 'a code: ' + JSON.stringify(b));
  assert.ok((await (await fetch(base + '/api/push/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device: b.device }) })).json()).waiting, 'waiting before the yes');
  const pr = await go('/push?code=' + b.code.replace('-', '')); const pg = await pr.text(); if (!/Let Will/.test(pg)) console.log(pr.status, pr.headers.get('location'), pg.slice(0, 300));
  assert.ok(/Let Will.{1,6}s MacBook Pro send to your vault/.test(pg), 'the page asks');
  await go('/push/answer', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `code=${b.code.replace('-', '')}&yes=1` });
  const k = await (await fetch(base + '/api/push/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device: b.device }) })).json();
  assert.ok(k.ok && /^wmk_/.test(k.key), 'the key once: ' + JSON.stringify(k));
  const again = await fetch(base + '/api/push/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device: b.device }) });
  assert.strictEqual(again.status, 403, 'never twice');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM push_keys').all()).includes(k.key), 'only the hash is kept');
  // The key opens the vault's doors only.
  assert.strictEqual((await fetch(base + '/account', { headers: { authorization: `Bearer ${k.key}` } })).status, 403, 'not a page');
  assert.strictEqual((await fetch(base + '/account/arrivals/state', { headers: { authorization: `Bearer ${k.key}` } })).status, 200, 'the vault, yes');
  assert.strictEqual((await fetch(base + '/account/arrivals/state', { headers: { authorization: 'Bearer wmk_' + 'x'.repeat(40) } })).status, 401, 'a wrong key');

  // A folder as Lightroom leaves it: four exports with stars inside, one a reject, one unrated; a cache folder; a note.
  const src = path.join(dir, 'Philadelphia'); fs.mkdirSync(path.join(src, '02_PHILADELPHIA'), { recursive: true }); fs.mkdirSync(path.join(src, 'Previews'));
  fs.writeFileSync(path.join(src, 'JOE_PHILLY-001.jpg'), xmpJpeg(await pic(1), 4));
  fs.writeFileSync(path.join(src, 'JOE_PHILLY-002.jpg'), xmpJpeg(await pic(2), 5));
  fs.writeFileSync(path.join(src, '02_PHILADELPHIA', 'JOE_PHILLY-003.jpg'), xmpJpeg(await pic(3), 3));
  fs.writeFileSync(path.join(src, 'JOE_PHILLY-004.jpg'), xmpJpeg(await pic(4), -1));
  fs.writeFileSync(path.join(src, 'JOE_PHILLY-005.jpg'), await pic(5));
  fs.writeFileSync(path.join(src, 'Previews', 'cache.jpg'), await pic(6));
  fs.writeFileSync(path.join(src, 'notes.txt'), 'not a picture');
  const home = path.join(dir, 'home'); fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ house: base, key: k.key }));
  const env = { WATERMARK_HOME: home };

  const dry = await run(['push', src, '--stars', '3', '--dry', '--place', 'Philadelphia'], env);
  assert.strictEqual(dry.code, 0, dry.out);
  assert.ok(/5 files/.test(dry.out) && /★★★★★ 1/.test(dry.out) && /rejected 1/.test(dry.out) && /unrated 1/.test(dry.out), 'the stars are read: ' + dry.out);
  assert.ok(/3 kept, 2 left/.test(dry.out) && /would send 3 files/.test(dry.out), 'the cull: ' + dry.out);
  const before = db.prepare('SELECT COUNT(*) n FROM works WHERE maker_id=?').get(maker.id).n;

  const p1 = await run(['push', src, '--stars', '3', '--place', 'Philadelphia', '--places'], env);
  assert.strictEqual(p1.code, 0, p1.out);
  assert.ok(/3 held \(3 verified\)/.test(p1.out), 'held and verified: ' + p1.out);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM works WHERE maker_id=?').get(maker.id).n, before + 3, 'three works');
  const placed = db.prepare("SELECT COUNT(*) n FROM works WHERE maker_id=? AND place='Philadelphia'").get(maker.id).n;
  assert.ok(placed >= 3, 'the place carried');
  assert.ok(db.prepare('SELECT sent FROM push_keys').get().sent >= 3, 'the key counts what it sent');

  // The same line again: nothing goes. A fresh computer (no state): the house already holds the bytes.
  const p2 = await run(['push', src, '--stars', '3'], env);
  assert.ok(/All 3 already sent/.test(p2.out), 'never twice from this computer: ' + p2.out);
  fs.rmSync(path.join(home, 'state'), { recursive: true });
  const p3 = await run(['push', src, '--stars', '3', '--no-wait'], env);
  assert.ok(/0 sent, 3 the house already held/.test(p3.out), 'never twice at all: ' + p3.out);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM works WHERE maker_id=?').get(maker.id).n, before + 3, 'still three');

  // The list, and the end of a key.
  const list = await (await go('/account/push')).text();
  assert.ok(/Will.{1,6}s MacBook Pro/.test(list) && /watermark\.js login/.test(list), 'listed with the way in');
  const kid = db.prepare('SELECT id FROM push_keys').get().id;
  await go(`/account/push/${kid}/end`, { method: 'POST' });
  const p4 = await run(['push', src], env);
  assert.strictEqual(p4.code, 2, 'ended: ' + p4.out); assert.ok(/signed out/.test(p4.out));
  assert.ok(/watermark: send an archive/.test(await (await fetch(base + '/push/watermark.js')).text()), 'the command is served');

  srv.close(); console.log('push: all good');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
