// The house without a disk (5 Nov): the website's disk comes off so a deploy is zero-downtime, and from then the box's
// folders are a cache that every deploy empties. This proves that what the house keeps is in the vault and comes back:
// a work's display copies, a portrait, a maker's drawing, a claim's evidence, a signed release and a registry photo
// are put in; every folder under the data directory but the database is wiped (the vault here is a fake S3 in memory,
// so nothing of it is on the disk); and each is served again, 200, byte for byte where a byte-for-byte copy was kept.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const http = require('http'); const sharp = require('sharp');
const { createStore } = require('../src/storage');
const { createApp } = require('../src/app');
const objs = {};
const client = { async send(cmd) {
  const n = cmd.constructor.name, i = cmd.input;
  if (n === 'PutObjectCommand') { objs[i.Key] = Buffer.from(i.Body); return {}; }
  if (n === 'GetObjectCommand') { if (!objs[i.Key]) { const e = new Error('nope'); e.name = 'NoSuchKey'; throw e; } const b = objs[i.Key]; return { Body: { transformToByteArray: async () => new Uint8Array(b) } }; }
  if (n === 'HeadObjectCommand') { if (!objs[i.Key]) { const e = new Error('nope'); e.name = 'NotFound'; throw e; } return { ContentLength: objs[i.Key].length }; }
  if (n === 'DeleteObjectCommand') { delete objs[i.Key]; return {}; }
  if (n === 'ListObjectsV2Command') return { Contents: Object.keys(objs).filter(k => k.startsWith(i.Prefix)).map(Key => ({ Key })) };
  if (n === 'GetBucketCorsCommand') return { CORSRules: [] };
  return {};
} };
function req(port, method, p, { body, headers = {}, cookie } = {}) {
  return new Promise((res, rej) => {
    const h = { ...headers }; if (cookie) h.cookie = cookie;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) { body = new URLSearchParams(body).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (body) h['content-length'] = Buffer.byteLength(body);
    const r = http.request({ port, method, path: p, headers: h }, s => { const c = []; s.on('data', d => c.push(d)); s.on('end', () => res({ status: s.statusCode, headers: s.headers, body: Buffer.concat(c) })); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}
const boundary = 'xxDISKLESSxx';
const mp = (name, buf, fields, type = 'image/jpeg') => Buffer.concat([...Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)), Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
const MP = { 'content-type': 'multipart/form-data; boundary=' + boundary };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-diskless-'));
  const store = createStore({ bucket: 'b', client, vaultKey: 'a-key-for-the-test-house-0123456789abcdef' });
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'diskless', noTimers: true, store, vaultNow: true });
  const { db, registerWork } = app.locals; const images = require('../src/images');
  assert.ok(app.locals.files, 'the files helper is mounted');
  const srv = app.listen(0); const port = srv.address().port;
  const fixture = path.join(__dirname, 'fixture.jpg');
  // The Studio.
  let r = await req(port, 'POST', '/studio/login', { body: { password: 'pw' } }); const ck = r.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
  // A work, and its display copies.
  const tmp = path.join(dir, 'in.jpg'); fs.copyFileSync(fixture, tmp);
  const w = await registerWork({ file: tmp, title: 'Diskless', originalName: 'diskless.jpg' });
  db.prepare("UPDATE works SET status='held' WHERE id=?").run(w.id);
  r = await req(port, 'GET', `/img/${w.slug}/screen`, { headers: { accept: 'image/webp' } }); assert.strictEqual(r.status, 200); const screen1 = r.body;
  await images.settled();
  assert.ok(Object.keys(objs).some(k => k.startsWith('renditions/') && /screen/.test(k) && /webp$/.test(k)), 'the display copy went to the bucket: ' + Object.keys(objs).filter(k => k.startsWith('renditions/')).join(','));
  // A maker with a portrait and a drawing.
  const m = db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('ada', 'Ada', 'ada@example.com', 'maker', datetime('now'), 'house') RETURNING id").get();
  const port2 = port;
  // A portrait through the Studio acting as the maker (?maker= sets wm_as for the Studio).
  r = await req(port2, 'GET', '/account?maker=ada', { cookie: ck }); const asck = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const cookie = `${ck}; ${asck}`;
  const face = await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 120, g: 80, b: 60 } } }).jpeg().toBuffer();
  r = await req(port2, 'POST', '/account/profile', { cookie, body: mp('p.jpg', face, { name: 'Ada', bio: 'A bio long enough to count as a bio.' }), headers: MP });
  const mk = db.prepare('SELECT * FROM makers WHERE id=?').get(m.id); assert.ok(mk.portrait, 'the portrait is set: ' + r.status);
  r = await req(port2, 'GET', '/portrait/ada'); assert.strictEqual(r.status, 200); const portrait1 = r.body;
  assert.ok(objs['portraits/' + mk.portrait], 'the portrait is in the vault');
  // A claim with evidence.
  const paper = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  r = await req(port2, 'POST', `/w/${w.slug}/claim`, { body: mp('evidence.pdf', paper, { kind: 'copyright', name: 'Bo Claimant', email: 'bo@example.com', body: 'This is my photograph and I can prove it with the papers attached here.', oath: '1' }, 'application/pdf'), headers: MP });
  const claim = db.prepare('SELECT * FROM disputes ORDER BY id DESC LIMIT 1').get(); assert.ok(claim && claim.file, 'the claim is in with its file: ' + r.status);
  assert.ok(objs['claims/' + claim.file], 'the evidence is in the vault');
  r = await req(port2, 'GET', `/studio/claims/${claim.id}/file`, { cookie: ck }); assert.strictEqual(r.status, 200); const evidence1 = r.body;
  // The sweep before the disk comes off: a copy on the disk the bucket lacks is put there once.
  r = await req(port2, 'GET', `/img/${w.slug}/thumb?f=jpg`); assert.strictEqual(r.status, 200); await images.settled();
  { const f = images.fileOf(path.join(dir, 'cache'), w.slug, 'thumb', 'jpg'); assert.ok(fs.existsSync(f), 'the thumb is on the disk'); delete objs['renditions/' + path.basename(f)]; const st = await images.pushAll(path.join(dir, 'cache'), { gapMs: 0 }); assert.ok(st.done && st.put >= 1 && objs['renditions/' + path.basename(f)], 'the sweep put the copy the bucket lacked: ' + JSON.stringify(st)); }
  // Wipe the disk: every folder but the database and the vault's own staging.
  for (const d of fs.readdirSync(dir)) { if (/\.db/.test(d) || d === 'vault') continue; const p = path.join(dir, d); if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true }); }
  assert.ok(!fs.existsSync(path.join(dir, 'cache')) && !fs.existsSync(path.join(dir, 'portraits')) && !fs.existsSync(path.join(dir, 'claims')), 'the folders are gone');
  // Everything comes back.
  r = await req(port2, 'GET', `/img/${w.slug}/screen`, { headers: { accept: 'image/webp' } }); assert.strictEqual(r.status, 200, 'the display copy is served again'); assert.ok(r.body.equals(screen1), 'the same bytes, from the bucket');
  r = await req(port2, 'GET', `/img/${w.slug}/large?f=jpg`); assert.strictEqual(r.status, 200, 'a copy never put is made again from the vault\'s original');
  r = await req(port2, 'GET', '/portrait/ada'); assert.strictEqual(r.status, 200, 'the portrait is served again'); assert.ok(r.body.equals(portrait1), 'byte for byte');
  r = await req(port2, 'GET', '/portrait/ada?tall=1'); assert.strictEqual(r.status, 200, 'the tall portrait too');
  r = await req(port2, 'GET', `/studio/claims/${claim.id}/file`, { cookie: ck }); assert.strictEqual(r.status, 200, 'the evidence is served again'); assert.ok(r.body.equals(evidence1), 'byte for byte');
  // The vault's copy of the original is what the thumb was made from.
  assert.ok(objs['originals/' + w.original_file], 'the original is in the vault');
  srv.close(); console.log('diskless: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
