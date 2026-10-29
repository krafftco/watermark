// The same frame by the camera's own moment (29 Oct): a re-export of a held frame, edited and the same size, becomes
// its master instead of a twin; a different picture made in the same second comes in as its own work.
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sf-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'sf', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('sf','Sam Frame','sf@example.com','maker',datetime('now'),'house')").run();
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' }); await go('/account?maker=sf');
  const scene = (seed) => { const W = 1200, H = 800, px = Buffer.alloc(W * H * 3); let s = seed; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const v = (Math.sin(x / (40 + seed)) + Math.cos(y / (27 + seed * 3))) * 60 + 128 + (s % 9); px[(y * W + x) * 3] = v; px[(y * W + x) * 3 + 1] = v * 0.8; px[(y * W + x) * 3 + 2] = 255 - v; } return sharp(px, { raw: { width: W, height: H, channels: 3 } }); };
  const exif = { IFD0: { Make: 'Leica Camera AG', Model: 'LEICA Q3' }, IFD2: { DateTimeOriginal: '2025:06:12 20:38:50' } };
  const put = async (img, name) => { const buf = await img.withExif(exif).jpeg({ quality: 92 }).toBuffer(); const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), name); return (await go('/account/works/one', { method: 'POST', body: fd })).json(); };
  const a = await put(scene(1), 'L1001726.jpg'); assert.ok(a.ok, JSON.stringify(a));
  const n0 = db.prepare("SELECT COUNT(*) n FROM works WHERE status<>'merged'").get().n;
  const b = await put(scene(1).modulate({ brightness: 1.15 }).linear(1.1, -8), 'L1001726-edit.jpg');
  assert.ok(b.ok && b.outcome === 'master' && b.slug === a.slug, 'the new edit is the master: ' + JSON.stringify(b));
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM works WHERE status<>'merged'").get().n, n0, 'no twin');
  assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='work.edited' AND subject=?").get(a.slug), 'told');
  const c = await put(scene(7), 'L1001727.jpg');
  assert.ok(c.ok && c.slug !== a.slug, 'another picture in the same second is its own work: ' + JSON.stringify(c));
  console.log('same frame: ok'); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
