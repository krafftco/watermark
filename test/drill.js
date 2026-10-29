// The fire drill (29 Oct, Will: "we never can mess up; we have to be all-stars at this; someday we're going to be
// entrusted with big, big imports"). A real import through the real doors, every night, with everything that goes
// wrong on a real day, checked to the file; it fails loudly when anything slips or slows.
//   node test/drill.js                    the local vault (the house's own road, as on a laptop)
//   DRILL_S3_ENDPOINT=http://127.0.0.1:9000 DRILL_S3_BUCKET=drill AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… node test/drill.js
//                                         an S3 vault (MinIO in CI): files go straight to the bucket in parts, as in the browser
// What a day holds: full-size 60 MP masters; two frames of one scene at the same size (both held, as their own works);
// the same bytes under another name (never sent twice: the house already holds them); a truncated JPEG and a page
// named .jpg (turned away at the door, with why); a file whose bytes change on the way (not kept: the fingerprints
// differ); a connection dropped halfway through a file (picked up where it stopped); one file never sent (named).
// DRILL_BIG (6) sets how many 60 MP masters; DRILL_MEM_MB (1600) the house's memory ceiling; DRILL_SECS (900) the time.
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { createStore } = require('../src/storage');

const BIG = +(process.env.DRILL_BIG || 6), MEM = +(process.env.DRILL_MEM_MB || 1600), SECS = +(process.env.DRILL_SECS || 900);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const t0 = Date.now(); const say = (...a) => console.log(`[drill ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// A picture with its own shape (so the eye's hash tells them apart), at a given size.
async function frame(i, w, h, { bright = 0, q = 92 } = {}) {
  const cx = Math.round(w * (0.2 + 0.6 * ((i * 37) % 100) / 100)), cy = Math.round(h * (0.25 + 0.5 * ((i * 61) % 100) / 100)), r = Math.round(Math.min(w, h) * (0.12 + 0.2 * ((i * 13) % 10) / 10));
  const hue = (i * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" x2="${i % 2}" y1="0" y2="1"><stop offset="0" stop-color="hsl(${hue},40%,${22 + bright}%)"/><stop offset="1" stop-color="hsl(${(hue + 140) % 360},55%,${62 + bright}%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${(hue + 60) % 360},30%,${85 + bright / 2}%)"/><rect x="${Math.round(w * ((i * 17) % 50) / 100)}" y="${Math.round(h * 0.7)}" width="${Math.round(w * 0.3)}" height="${Math.round(h * 0.12)}" fill="hsl(${hue},20%,${12 + bright}%)"/></svg>`;
  // grain, so a master weighs what a real one does (a smooth picture compresses to nothing)
  const grain = await sharp({ create: { width: Math.round(w / 3), height: Math.round(h / 3), channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 26 } } }).png().toBuffer();
  const g2 = await sharp(grain).resize(w, h, { kernel: 'nearest' }).png().toBuffer();
  return sharp(Buffer.from(svg)).composite([{ input: g2, blend: 'soft-light' }]).jpeg({ quality: q }).toBuffer();
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-drill-'));
  let store = null;
  if (process.env.DRILL_S3_ENDPOINT) {
    const S3 = require('@aws-sdk/client-s3'); const bucket = process.env.DRILL_S3_BUCKET || 'drill';
    const c = new S3.S3Client({ region: 'us-east-1', endpoint: process.env.DRILL_S3_ENDPOINT, forcePathStyle: true });
    try { await c.send(new S3.CreateBucketCommand({ Bucket: bucket })); } catch (e) { if (!/BucketAlready/.test(e.name)) throw e; }
    store = createStore({ bucket, endpoint: process.env.DRILL_S3_ENDPOINT, region: 'us-east-1' });
  }
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'drill', noTimers: true, vaultNow: true, ...(store ? { store } : {}) });
  const { db } = app.locals; const direct = app.locals.arrivals.direct;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  let peak = 0; const mem = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 100);
  say(direct ? 'an S3 vault: straight to the bucket in parts' : 'the local vault: through the house');

  // A maker, walked by the Studio (the cookie a maker's own sign-in would give).
  let maker = db.prepare("SELECT * FROM makers WHERE kind IS NULL OR kind='maker' ORDER BY id LIMIT 1").get();
  if (!maker) { db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('drill','The Drill','drill@example.com','maker',datetime('now'),'house')").run(); maker = db.prepare("SELECT * FROM makers WHERE handle='drill'").get(); }
  const jar = {}; const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const take = r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar[k] = v; } return r; };
  const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: cookie(), ...(o.headers || {}) } }).then(take);
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  await go(`/account?maker=${maker.handle}`);
  const form = (p, body) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }).then(r => r.json());

  // The day's files.
  const files = [];
  for (let i = 0; i < BIG; i++) files.push({ name: `DRILL_MASTER-${String(i + 1).padStart(3, '0')}.jpg`, buf: await frame(i, 9528, 6328), expect: 'held' });
  const sceneA = await frame(900, 6000, 4000), sceneB = await frame(900, 6000, 4000, { bright: 3, q: 90 });
  files.push({ name: 'DRILL_SCENE-a.jpg', buf: sceneA, expect: 'held' }, { name: 'DRILL_SCENE-b.jpg', buf: sceneB, expect: 'held' });
  files.push({ name: 'DRILL_COPY-of-master-1.jpg', buf: files[0].buf, expect: 'already', after: files[0].name });
  const whole = await frame(901, 4000, 3000); files.push({ name: 'DRILL_TRUNCATED.jpg', buf: whole.subarray(0, Math.floor(whole.length * 0.6)), expect: 'need' });
  files.push({ name: 'DRILL_NOT-A-PICTURE.jpg', buf: Buffer.from('<!doctype html><html><body>not a picture</body></html>'.repeat(40)), expect: 'need' });
  const changed = await frame(902, 4000, 3000); files.push({ name: 'DRILL_CHANGED-ON-THE-WAY.jpg', buf: changed, claim: sha(await frame(903, 4000, 3000)), expect: 'need' });
  files.push({ name: 'DRILL_DROPPED-HALFWAY.jpg', buf: await frame(904, 9528, 6328), drop: true, expect: 'held' });
  files.push({ name: 'DRILL_NEVER-SENT.jpg', buf: Buffer.alloc(4096, 7), never: true, expect: 'none' });
  const bytes = files.reduce((a, f) => a + f.buf.length, 0);
  say(`${files.length} files, ${(bytes / 1e6).toFixed(0)} MB, ${BIG + 1} of them 60 MP`);

  // One import for the lot, as the vault page makes it.
  const im = await go('/account/imports', { method: 'POST', headers: { 'content-type': 'application/x-watermark-import+json' }, body: JSON.stringify({ label: 'The drill', place: 'Philadelphia', files: files.map(f => [f.name, f.buf.length]) }) }).then(r => r.json());
  assert.ok(im.ok, 'the import: ' + JSON.stringify(im));

  // The sender, as the browser does it: ask first with the fingerprint, then parts (four at a time) or the whole body.
  async function send(f, { stopAfter = 0 } = {}) {
    const st = await form('/account/arrivals/start', { name: f.name, size: f.buf.length, type: 'image/jpeg', sha256: f.claim || sha(f.buf), import_id: im.id, place: 'Philadelphia' });
    if (!st.ok) throw new Error('start: ' + JSON.stringify(st));
    if (st.already) return st;
    if (!st.direct) { const r = await go(`/account/arrivals/${st.id}/body`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: f.buf }).then(r => r.json()); assert.ok(r.ok, 'body: ' + JSON.stringify(r)); return st; }
    const etags = f.etags || (f.etags = {}); const todo = []; for (let n = 1; n <= st.parts; n++) if (!etags[n]) todo.push(n);
    let i = 0, sent = 0;
    const lane = async () => { while (i < todo.length) { const n = todo[i++]; if (stopAfter && sent >= stopAfter) return; const u = await form(`/account/arrivals/${st.id}/urls`, { parts: String(n) }); const part = f.buf.subarray((n - 1) * st.partSize, Math.min(f.buf.length, n * st.partSize)); const r = await fetch(u.urls[n], { method: 'PUT', body: part }); assert.ok(r.ok, 'part ' + n + ' ' + r.status); etags[n] = (r.headers.get('etag') || '').replace(/"/g, ''); sent++; } };
    await Promise.all([lane(), lane(), lane(), lane()]);
    if (Object.keys(etags).length < st.parts) return { ...st, partial: true };
    const d = await form(`/account/arrivals/${st.id}/done`, { parts: JSON.stringify(Object.entries(etags).map(([n, etag]) => ({ n: +n, etag }))) }); assert.ok(d.ok, 'done: ' + JSON.stringify(d));
    return st;
  }
  const waitHeld = async name => { for (let k = 0; k < SECS * 10; k++) { const a = db.prepare("SELECT status FROM arrivals WHERE name=? ORDER BY id DESC LIMIT 1").get(name); if (a && /done|failed/.test(a.status)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('never answered: ' + name); };

  // Three at a time, as the vault page sends. The dropped file goes halfway, then is picked up where it stopped; the
  // copy goes once its original is held (the house can only say "already" of what it has).
  const queue = files.filter(f => !f.never && !f.after && !f.drop); let qi = 0;
  const lanes = [0, 1, 2].map(async () => { while (qi < queue.length) { const f = queue[qi++]; await send(f); } });
  const dropped = files.find(f => f.drop);
  if (direct) { const first = await send(dropped, { stopAfter: 3 }); assert.ok(first.partial, 'the connection drops halfway'); const again = await send(dropped); assert.ok(again.again === 'uploading' && again.id === first.id, 'picked up as the same arrival: ' + JSON.stringify(again)); }
  else { await send(dropped); } // the local road is one put: a drop there is a resend, which the house takes as the same arrival
  await Promise.all(lanes);
  await waitHeld(files[0].name);
  for (const f of files.filter(f => f.after)) { const st = await send(f); assert.equal(st.already, 'held', 'the same bytes under another name are not sent again'); }
  for (const f of files.filter(f => !f.never)) await waitHeld(f.name);
  await new Promise(r => setTimeout(r, 2500)); await app.locals.imports.check(im.id);

  // The receipt must say exactly what happened, file by file.
  const ij = await go(`/account/imports/${im.id}.json`).then(r => r.json());
  const by = Object.fromEntries(ij.files.map(r => [r.name, r]));
  const miss = [];
  for (const f of files) { const r = by[f.name]; const st = r ? r.state : 'missing'; if (st !== f.expect) miss.push(`${f.name}: expected ${f.expect}, was ${st}${r && r.why ? ` (${r.why})` : ''}`); if (f.expect === 'held' && !(r && r.verified)) miss.push(`${f.name}: held but not verified`); if (f.expect === 'need' && !(r && r.why)) miss.push(`${f.name}: needs you, but no why`); }
  const heldWorks = db.prepare("SELECT COUNT(*) n FROM works WHERE title LIKE 'Drill %'").get().n;
  const c = ij.counts;
  say('the receipt:', JSON.stringify({ chosen: c.chosen, held: c.held, verified: c.verified, already: c.already, need: c.need, none: c.none }), `works made ${heldWorks}`);
  if (heldWorks !== files.filter(f => f.expect === 'held').length) miss.push(`works made ${heldWorks}, expected ${files.filter(f => f.expect === 'held').length}`);
  const csv = await go(`/account/imports/${im.id}/receipt.csv`).then(r => r.text()); if (!/needs you,3/.test(csv)) miss.push('the receipt CSV does not count three that need you');
  // every original held is the bytes that were sent
  for (const f of files.filter(f => f.expect === 'held')) { const w = db.prepare('SELECT w.sha256 FROM arrivals a JOIN works w ON w.slug=a.slug WHERE a.name=? ORDER BY a.id DESC LIMIT 1').get(f.name); if (!w || w.sha256 !== sha(f.buf)) miss.push(`${f.name}: the original held is not the bytes sent`); }
  clearInterval(mem); srv.close();
  const secs = (Date.now() - t0) / 1000, peakMb = Math.round(peak / 1048576);
  say(`${(bytes / 1e6).toFixed(0)} MB in ${secs.toFixed(0)} s (${(bytes / 1e6 / secs).toFixed(1)} MB/s end to end), the house's peak memory ${peakMb} MB`);
  if (peakMb > MEM) miss.push(`memory peaked at ${peakMb} MB, over ${MEM}`);
  if (secs > SECS) miss.push(`took ${secs.toFixed(0)} s, over ${SECS}`);
  if (miss.length) { console.error('THE DRILL FAILED:\n  ' + miss.join('\n  ')); process.exit(1); }
  console.log('the drill: every file accounted for');
  process.exit(0);
})().catch(e => { console.error('THE DRILL FAILED:', e.stack || e); process.exit(1); });
