// The Lightroom Classic plug-in (29 Oct): its house calls run under plain Lua 5.1 with Lightroom's toolkit stubbed
// (test/lr/stubs.lua, curl for LrHttp): paired by the code, a photograph published, the same file again changes
// nothing, and a new edit re-published becomes the master of the same work. Skipped where there is no lua5.1.
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { execFile, execFileSync } = require('child_process');
const sharp = require('sharp');
const { createApp } = require('../src/app');
let lua = null; for (const c of ['lua5.1', 'luajit']) { try { execFileSync('which', [c]); lua = c; break; } catch (e) { /* none */ } }
if (!lua) { console.log('lightroom: skipped (no lua5.1)'); process.exit(0); }

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-lr-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'lr', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('lr','Lee Room','lr@example.com','maker',datetime('now'),'house')").run();
  const maker = db.prepare("SELECT * FROM makers WHERE handle='lr'").get();
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  await go('/account?maker=lr');

  const svg = c => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200"><rect width="1800" height="1200" fill="${c}"/><circle cx="700" cy="500" r="300" fill="#fff"/><rect x="1100" y="700" width="500" height="300" fill="#123"/></svg>`);
  const a = path.join(dir, 'L1002685.jpg'), b = path.join(dir, 'L1002685-edit.jpg');
  fs.writeFileSync(a, await sharp(svg('#4a6a8a')).jpeg({ quality: 95 }).toBuffer());
  fs.writeFileSync(b, await sharp(svg('#2a3a4a')).jpeg({ quality: 95 }).toBuffer()); // the same picture, darker: the new edit
  const urlFile = path.join(dir, 'url.txt');
  const env = { ...process.env, LR_PLUGIN: path.join(__dirname, '..', 'lightroom', 'watermark.lrplugin'), LR_STUBS: path.join(__dirname, 'lr', 'stubs.lua'), LR_HOUSE: base, LR_URLFILE: urlFile };
  const child = new Promise(res => execFile(lua, [path.join(__dirname, 'lr', 'run.lua'), a, b], { env, timeout: 120000 }, (e, out, err) => res({ code: e ? e.code : 0, out, err })));
  // The browser: the maker says yes where they are signed in.
  for (let i = 0; i < 100 && !fs.existsSync(urlFile); i++) await new Promise(r => setTimeout(r, 100));
  const code = new URL(fs.readFileSync(urlFile, 'utf8')).searchParams.get('code');
  await go('/push/answer', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `code=${code}&yes=1` });
  const r = await child;
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.ok(/signed in Lee Room/.test(r.out), r.out);
  const slug = (/first (\S+) work/.exec(r.out) || [])[1]; assert.ok(slug, 'published as a work: ' + r.out);
  assert.ok(/again \S+ held/.test(r.out), 'the same file again changes nothing: ' + r.out);
  assert.ok(new RegExp(`edit ${slug} master`).test(r.out), 'the edit is the master of the same work: ' + r.out);
  const w = db.prepare('SELECT * FROM works WHERE slug=?').get(slug);
  assert.ok(w.maker_id === maker.id && w.title === 'From Lightroom' && w.place === 'Philadelphia', 'the title and place from Lightroom');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM works WHERE maker_id=?').get(maker.id).n, 1, 'one work, not two');
  assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='work.edited' AND subject=?").get(slug), 'the register says it');
  const sha = require('crypto').createHash('sha256').update(fs.readFileSync(b)).digest('hex');
  assert.strictEqual(w.sha256, sha, 'the master is the edit, byte for byte');
  const zr = await fetch(base + '/lightroom/watermark.lrplugin.zip'); const zb = Buffer.from(await zr.arrayBuffer());
  assert.ok(zr.status === 200 && zb.slice(0, 2).toString() === 'PK' && zb.includes(Buffer.from('watermark.lrplugin/Info.lua')), 'the plug-in is served, zipped');
  assert.ok(/Plug-in Manager/.test(await (await fetch(base + '/lightroom')).text()), 'the page says how');
  srv.close(); console.log('lightroom: all good'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
