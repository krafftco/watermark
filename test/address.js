// The house at its own address (#215; Will, 23 Nov 2026). Three things are held here:
//   1. With BASE_URL set to a new address, every door in DOORS (and the machine pages that name the house: the sitemap,
//      robots.txt, security.txt, the DID document, the house bar and the K as served) spells the old host nowhere.
//   2. A GET or HEAD arriving on an old host is answered 308 to the same path and query on the new one, never kept by
//      a cache; an album's token survives; a POST (Stripe's webhook, the Krafft sites' calls) and /healthz are not turned.
//   3. With BASE_URL unset the house stands where it first stood and nothing is redirected (run again as a child).
// And no file of the house but src/address.js spells a host of its own.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const http = require('http');
const FIRST = ['watermark', 'krafftco', 'com'].join('.'), NEW = 'watermark.world';
const UNSET = process.argv[2] === 'unset';
if (UNSET) { delete process.env.BASE_URL; delete process.env.OLD_HOSTS; delete process.env.HOUSE_EMAIL; }
else { process.env.BASE_URL = `https://${NEW}`; process.env.HOUSE_EMAIL = `house@${NEW}`; delete process.env.OLD_HOSTS; }
const ADDR = require('../src/address');
const { createApp } = require('../src/app');
const V = require('../src/views');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-address-'));
  const app = createApp({ dataDir: dir, ...(UNSET ? {} : { base: `https://${NEW}` }), adminPassword: 'pw', secret: 'address', noTimers: true, vaultNow: true });
  const srv = app.listen(0); const port = srv.address().port;
  const ask = (method, p, host, body) => new Promise((ok, no) => {
    const r = http.request({ port, host: '127.0.0.1', method, path: p, headers: { host, accept: 'text/html', ...(body != null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}) } }, res => {
      const b = []; res.on('data', d => b.push(d)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(b).toString('utf8') }));
    }); r.on('error', no); if (body != null) r.write(body); r.end();
  });
  try {
    if (UNSET) {
      // 3. Where the house first stood: the same address as before this change, and no redirect mounted.
      assert.equal(ADDR.base(), `https://${FIRST}`); assert.equal(ADDR.host(), FIRST); assert.equal(ADDR.email(), `house@${FIRST}`);
      assert.deepEqual(ADDR.oldHosts(), [], 'the host the house stands on is never an old host');
      { const r = await ask('GET', '/everything', 'localhost'); assert.ok(r.body.includes(`https://${FIRST}/`), 'unset: a page names the house where it first stood'); }
      for (const p of ['/', '/everything', '/a/tok?x=1']) { const r = await ask('GET', p, FIRST); assert.notEqual(r.status, 308, `unset: ${p} is not turned`); }
      const hj = await ask('GET', '/house.js', FIRST); assert.ok(hj.status === 200 && !hj.body.includes('{{HOUSE}}') && hj.body.includes("'http://localhost:3000'"), 'the bar, with the address written in');
      console.log('address (unset): ok');
      return;
    }
    // The setting, read.
    assert.equal(ADDR.base(), `https://${NEW}`); assert.equal(ADDR.host(), NEW); assert.deepEqual(ADDR.oldHosts(), [FIRST]);
    assert.deepEqual(ADDR.oldHosts(`https://${NEW}`, ` Old.Example , https://${NEW}/ ,${FIRST}`), ['old.example', FIRST], 'a list, tidied; the house itself left out');

    // 1. Every door, at the new address: the old host is spelled nowhere. (The two namespaces are names inside issued
    // files, not addresses; a page that prints one is still not linking to the house.)
    const doors = new Set(['/', '/everything', '/sitemap.xml', '/robots.txt', '/.well-known/security.txt', '/.well-known/did.json', '/house.js', '/k.js', '/developers', '/legal', '/legal/house.txt', '/claims', '/signin', '/tv', '/verify']);
    for (const [, list] of V.DOORS) for (const [h] of list) doors.add(h);
    const bad = []; let read = 0;
    for (const p of doors) {
      let r = await ask('GET', p, NEW); let hops = 0;
      while (r.status >= 300 && r.status < 400 && hops++ < 4) { const loc = r.headers.location || ''; if (loc.includes(FIRST)) bad.push(`${p} → ${loc}`); const u = new URL(loc, `https://${NEW}`); if (u.host !== NEW) break; r = await ask('GET', u.pathname + u.search, NEW); }
      if (r.status >= 500) bad.push(`${p} → ${r.status}`);
      if (r.status !== 200) continue; read++;
      const body = r.body.split(ADDR.NS.xmp).join('').split(ADDR.NS.vc).join(''); let i = body.indexOf(FIRST);
      if (i >= 0) bad.push(`${p}: …${body.slice(Math.max(0, i - 70), i + 50).replace(/\s+/g, ' ')}…`);
      if (/\$\{[^}]*address/.test(body)) bad.push(`${p}: a setting left unread in the page`);
    }
    assert.deepEqual(bad, [], 'the old host on the house at its new address:\n' + bad.join('\n'));
    assert.ok(read >= doors.size - 12, `the doors were read (${read} of ${doors.size})`);
    { const r = await ask('GET', '/sitemap.xml', NEW); assert.ok(r.body.includes(`https://${NEW}/`), 'the sitemap at the new address'); }
    { const r = await ask('GET', '/house.js', NEW); assert.ok(r.body.includes(`'https://${NEW}'`) && !r.body.includes('{{HOUSE}}'), 'the bar leads to the new address'); }
    { const r = await ask('GET', '/k.js', NEW); assert.ok(r.body.includes(`'https://${NEW}'`), 'the K leads to the new address'); }

    // 2. The old host: every GET and HEAD goes on, permanently, path and query whole.
    for (const p of ['/', '/wander?at=abc-1&in=open', '/a/Tok3n_-x?k=9f2c&from=mail', '/deliver/abc123?t=s3cret%2Fx', '/img/some-work/screen.jpg', '/d/WM-2026-0001/file?dl=1', '/c/WM-2026-0001', '/ledger/12', '/api/v1/works?maker=mk&page=2', '/signin?next=%2Faccount', '/house.js', '/.well-known/did.json']) {
      const r = await ask('GET', p, FIRST);
      assert.equal(r.status, 308, `${p} on the old host`); assert.equal(r.headers.location, `https://${NEW}${p}`, `${p}: the same path and query`);
      assert.ok(/no-store/.test(r.headers['cache-control'] || ''), `${p}: the redirect is never kept by a cache`);
    }
    { const r = await ask('HEAD', '/a/Tok3n?k=1', FIRST); assert.ok(r.status === 308 && r.headers.location === `https://${NEW}/a/Tok3n?k=1`, 'HEAD too'); }
    { const r = await ask('GET', '/a/Tok3n?k=1', FIRST.toUpperCase() + ':443'); assert.equal(r.status, 308, 'the host in any case, with a port'); }
    // What a machine posts is never turned; neither is the health line the watch and the promotion read.
    { const r = await ask('POST', '/stripe/webhook', FIRST, '{}'); assert.ok(r.status !== 308 && !r.headers.location, `the webhook answers on the old host (${r.status})`); }
    { const r = await ask('POST', '/api/seen', FIRST, '{"work":"none"}'); assert.equal(r.status, 204, 'a Krafft site’s call answers on the old host'); }
    { const r = await ask('GET', '/healthz', FIRST); assert.equal(r.status, 200, '/healthz answers where it is asked'); }
    { const r = await new Promise((ok, no) => { const q = http.request({ port, host: '127.0.0.1', method: 'GET', path: '/api/push/me', headers: { host: FIRST, authorization: 'Bearer not-a-key' } }, res => { res.resume(); ok(res); }); q.on('error', no); q.end(); }); assert.notEqual(r.statusCode, 308, 'a read that carries a key is answered where it is asked'); }
    { const r = await ask('GET', '/push/watermark.js', NEW); assert.ok(r.status === 200 && r.body.includes(`'https://${NEW}'`) && !r.body.includes('{{HOUSE}}'), 'push, as served, knows the house'); }
    { const r = await ask('GET', '/stripe/webhook', FIRST); assert.notEqual(r.status, 308, 'the webhook path is never turned'); }
    // The new host, and any other (a museum's own address), are left alone.
    for (const h of [NEW, 'collection.museum.example']) { const r = await ask('GET', '/everything', h); assert.equal(r.status, 200, `${h} is not turned`); }

    // No file of the house spells a host of its own but the one that holds the setting.
    const spelled = [];
    for (const d of ['src', 'public', 'test', 'scripts', 'bin']) { const root = path.join(__dirname, '..', d); if (!fs.existsSync(root)) continue;
      for (const f of fs.readdirSync(root, { recursive: true })) { const file = path.join(root, String(f)); if (!/\.(js|css|html|json|webmanifest|txt|svg)$/.test(file) || !fs.statSync(file).isFile()) continue; if (d === 'src' && f === 'address.js') continue; if (fs.readFileSync(file, 'utf8').includes(FIRST)) spelled.push(`${d}/${f}`); } }
    assert.deepEqual(spelled, [], 'these spell the house’s host; read it from src/address.js: ' + spelled.join(', '));

    // 3. Unset, in a process of its own (the settings are read as the modules load).
    const env = { ...process.env }; delete env.BASE_URL; delete env.OLD_HOSTS; delete env.HOUSE_EMAIL;
    const out = require('child_process').execFileSync(process.execPath, [__filename, 'unset'], { env, encoding: 'utf8' }); assert.ok(/address \(unset\): ok/.test(out), out);
    console.log('address: ok');
  } finally { srv.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* leave it */ } setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); }
})().catch(e => { console.error(e); process.exit(1); });
