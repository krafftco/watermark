// The stand (31 Oct): the maker's phone at a party. Today's work, a code to the work's page, publish on a word, the Instax file.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sd-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'sd', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie()) jar[c.split('=')[0]] = c.split('=')[1].split(';')[0]; return r; });
  assert.strictEqual((await go('/account/stand')).status, 302, 'a stranger is sent to sign in');
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  const h = db.prepare("SELECT handle FROM makers ORDER BY id LIMIT 1").get().handle; await go(`/account?maker=${h}`);
  const buf = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 200, g: 90, b: 40 } } }).jpeg().toBuffer(); const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), 'party.jpg');
  const j = await (await go('/account/works/one', { method: 'POST', body: fd })).json();
  let t = await (await go('/account/stand')).text(); assert.ok(t.includes(`/account/stand/${j.slug}`), 'tonight’s work on the stand');
  t = await (await go(`/account/stand/${j.slug}`)).text(); assert.ok(t.includes('Put it on view to sell') && !t.includes('<svg'.repeat(1) + 'x'), 'kept back: the word first');
  await go(`/account/stand/${j.slug}/sell`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'attest=1' });
  assert.strictEqual(db.prepare('SELECT status FROM works WHERE slug=?').get(j.slug).status, 'held', 'on view');
  t = await (await go(`/account/stand/${j.slug}`)).text(); assert.ok(t.includes('Scan to make it yours') && t.includes('sd2-qr'), 'the code to scan');
  const ix = await go(`/account/stand/${j.slug}/instax`); assert.strictEqual(ix.status, 200, "instax"); if (!/image/.test(ix.headers.get("content-type"))) { console.log(ix.headers.get("content-type"), (await ix.text()).slice(0, 300)); process.exit(1); } const meta = await sharp(Buffer.from(await ix.arrayBuffer())).metadata(); assert.ok(meta.width === 800 && meta.height === 600, 'the Instax mini file');
  // People, not requests: a browser that answers is a person; a bare fetch is not; the Studio is never counted.
  const before = app.locals.analytics.report('today').cur.people;
  await fetch(base + '/api/here', { method: 'POST', headers: { origin: base, cookie: 'wm_v=abc123def456', 'user-agent': 'Mozilla/5.0 (iPhone)' } });
  await fetch(base + '/api/here', { method: 'POST', headers: { origin: base, 'user-agent': 'Googlebot/2.1' } });
  const R = app.locals.analytics.report('today'); assert.strictEqual(R.cur.people, before + 1, 'one person, not the bot'); assert.ok(R.now.people >= 1, 'on the site now');
  assert.ok((await (await go('/studio/analytics')).text()).includes('their browsers answering'), 'the numbers say it');
  console.log('the stand: all hold'); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
