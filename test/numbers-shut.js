// The numbers desk and the digest are shut on the live website (20 Nov: opening the desk twice stopped the house) and
// say so in words; the switch opens them again. Run: NODE_ENV=test node test/numbers-shut.js
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createApp } = require('../src/app.js');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ns-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'ns', noTimers: true, vaultNow: true });
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie()) jar[c.split('=')[0]] = c.split('=')[1].split(';')[0]; return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  let asked = 0; const real = app.locals.analytics.report; app.locals.analytics.report = (...a) => { asked++; return real(...a); };
  process.env.NUMBERS_DESK = '0';
  let r = await go('/studio/analytics'); let t = await r.text();
  assert.strictEqual(r.status, 200, 'the desk answers'); assert.ok(/closed for repair/.test(t) && /Back to the Studio/.test(t), 'in words, with a way back'); assert.ok(!/an-bars|their browsers answering/.test(t), 'and shows no figures');
  r = await go('/studio/analytics.json'); assert.strictEqual((await r.json()).closed, true, 'the json door says closed');
  r = await go('/studio/analytics?frag=1'); assert.strictEqual((await r.json()).closed, true, 'so does the page\'s own refresh');
  r = await go('/studio/digest'); assert.ok(/closed for repair/.test(await r.text()), 'the digest too');
  r = await go('/studio/digest/send', { method: 'POST' }); assert.strictEqual(r.status, 302, 'sending it goes back to the Studio'); assert.ok(/closed/.test(decodeURIComponent(r.headers.get('location'))), 'with the reason');
  assert.strictEqual(asked, 0, 'and the report was never asked for');
  process.env.NUMBERS_DESK = '1';
  r = await go('/studio/analytics'); t = await r.text(); assert.ok(r.status === 200 && /their browsers answering/.test(t), 'the switch opens the desk');
  delete process.env.NUMBERS_DESK; srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('the numbers desk, shut and opened: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
