// The house's identity at two addresses (#220, after #215). The house's identity for credentials is did:web plus its
// host, so it moves when the house does; a credential already issued names the host it was issued on. Held here:
//   1. Before the move: one identity, the document as it always was, a credential issued and checked.
//   2. After the move (BASE_URL new, the old host redirecting): the identity document is answered on the old host,
//      not redirected, with the old host's id and the same key; on the new host it carries the new id and names the old
//      one as also-known-as. The same for a maker's document. The credential issued before the move still checks, at
//      the house's own door and as a stranger would check it (resolve the issuer's document on its own host, find the
//      key by its id, check the proof). A new credential is issued under the new identity and checks the same way.
//   3. The same with OLD_HOSTS=none (the step where the address has moved and the old host still serves pages).
//   4. The test house, and a house with no address set (a child process), have one identity and nothing changes.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const http = require('http');
const FIRST = ['watermark', 'krafftco', 'com'].join('.'), NEW = 'watermark.world';
const UNSET = process.argv[2] === 'unset';
if (UNSET) { delete process.env.BASE_URL; delete process.env.OLD_HOSTS; } else { process.env.BASE_URL = `https://${NEW}`; delete process.env.OLD_HOSTS; }
delete process.env.STAGING;
const { createApp } = require('../src/app');
const B = require('../src/bridge');

(async () => {
  const dirs = [], open = [];
  // A house: its own folder, the same signing seed every time (the key does not move when the address does).
  const house = cfg => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-identity-')); dirs.push(dir);
    const calls = [];
    const app = createApp({ dataDir: dir, adminPassword: 'pw', secret: 'identity220', noTimers: true, vaultNow: true, fetchImpl: async u => { calls.push(String(u)); return { ok: false, status: 404, json: async () => ({}) }; }, ...cfg });
    const { db } = app.locals; const srv = app.listen(0); open.push(srv); const port = srv.address().port;
    const mid = db.prepare('SELECT id FROM makers ORDER BY id LIMIT 1').get().id;
    db.prepare("INSERT INTO works (maker_id, slug, title, original_file, sha256, status, width, height) VALUES (?, 'a-held-work', 'A held work', 'a.jpg', ?, 'held', 1000, 1000)").run(mid, 'ab'.repeat(32));
    const ask = (method, p, host, body) => new Promise((ok, no) => {
      const r = http.request({ port, host: '127.0.0.1', method, path: p, headers: { host, accept: 'application/json', ...(body != null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}) } }, res => {
        const b = []; res.on('data', d => b.push(d)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(b).toString('utf8') }));
      }); r.on('error', no); if (body != null) r.write(body); r.end();
    });
    const doc = async (host, p = '/.well-known/did.json') => { const r = await ask('GET', p, host); assert.equal(r.status, 200, `${p} on ${host} is answered there, not ${r.status} ${r.headers.location || ''}`); return { ...JSON.parse(r.body), cache: r.headers['cache-control'] }; };
    const issue = async host => { const r = await ask('GET', '/w/a-held-work/credential', host); assert.equal(r.status, 200, `a credential on ${host}: ${r.status}`); return JSON.parse(r.body); };
    const check = async (vc, host) => JSON.parse((await ask('POST', '/api/v1/credentials/verify', host, JSON.stringify(vc))).body);
    // As a stranger checks: the issuer's did:web names a host; its document is read on that host, at the address the
    // method gives; the document must carry the issuer's id, and the key is found by the proof's own id.
    const stranger = async vc => {
      const vm = vc.proof.verificationMethod, did = vm.split('#')[0], u = new URL(B.didUrl(did));
      const r = await ask('GET', u.pathname, u.host); if (r.status !== 200) return { ok: false, why: `the document answered ${r.status}` };
      const d = JSON.parse(r.body); if (d.id !== did) return { ok: false, why: `the document is ${d.id}, not ${did}` };
      const k = (d.verificationMethod || []).find(x => x.id === vm); if (!k || !d.assertionMethod.includes(vm)) return { ok: false, why: 'no such key in the document' };
      return { ok: B.checkProof(vc, B.fromMultikey(k.publicKeyMultibase)), why: 'the signature' };
    };
    return { app, ask, doc, issue, check, stranger, calls, makerSlug: require('../src/views').makerSlug(db.prepare('SELECT * FROM makers WHERE id=?').get(mid)) };
  };
  const did = h => `did:web:${encodeURIComponent(h)}`;
  try {
    if (UNSET) {
      // 4b. No address set: one identity, the document as it always was, on any host; no old identity is the house's own.
      const h = house({});
      for (const host of ['localhost:3000', FIRST, NEW]) {
        const d = await h.doc(host); assert.equal(d.id, 'did:web:localhost%3A3000', `unset, on ${host}`); assert.deepEqual(d.alsoKnownAs, ['http://localhost:3000']);
        assert.equal(d.verificationMethod[0].id, 'did:web:localhost%3A3000#register'); assert.equal(d.cache, 'public, max-age=300');
        const m = await h.doc(host, `/m/${h.makerSlug}/did.json`); assert.equal(m.id, `did:web:localhost%3A3000:m:${h.makerSlug}`); assert.equal(m.controller, 'did:web:localhost%3A3000'); assert.equal(m.cache, 'public, max-age=300');
        assert.ok(!JSON.stringify([d, m]).includes(FIRST), 'unset: the first host is named nowhere');
      }
      const vc = await h.issue('localhost:3000'); assert.equal(vc.issuer.id, 'did:web:localhost%3A3000'); assert.equal((await h.check(vc, 'localhost:3000')).ok, true);
      const other = B.prove({ '@context': vc['@context'], type: ['VerifiableCredential'], issuer: did(FIRST), credentialSubject: { id: 'urn:x' } }, { vm: `${did(FIRST)}#register`, signBytes: require('../src/ledger').signBytes });
      const r = await h.check(other, 'localhost:3000'); assert.equal(r.ok, false, 'unset: another host is not the house'); assert.deepEqual(h.calls, [`https://${FIRST}/.well-known/did.json`], 'unset: it is looked up as any issuer is');
      console.log('identity (unset): ok');
      return;
    }

    // 1. Before the move: the house stands where it first stood.
    const before = house({ base: `https://${FIRST}` });
    const d0 = await before.doc(FIRST);
    assert.equal(d0.id, did(FIRST)); assert.deepEqual(d0.alsoKnownAs, [`https://${FIRST}`], 'before: one identity, as it always was'); assert.equal(d0.cache, 'public, max-age=300');
    assert.equal((await before.doc(NEW)).id, did(FIRST), 'before: the house has not been anywhere else');
    const key = d0.verificationMethod[0].publicKeyMultibase; assert.ok(key.startsWith('z6Mk'));
    const old = await before.issue(FIRST);
    assert.equal(old.issuer.id, did(FIRST)); assert.equal(old.proof.verificationMethod, `${did(FIRST)}#register`); assert.equal(old.credentialSubject.maker.id, `${did(FIRST)}:m:${before.makerSlug}`);
    assert.equal((await before.check(old, FIRST)).ok, true, 'before: it checks'); assert.equal((await before.stranger(old)).ok, true, 'before: a stranger checks it');
    console.log('identity: before the move, a credential issued under', old.issuer.id);

    // 2 and 3. After the move: the old host redirecting (OLD_HOSTS unset), then OLD_HOSTS=none.
    for (const [say, cfg, turned] of [['the old host redirecting', { base: `https://${NEW}` }, true], ['OLD_HOSTS=none', { base: `https://${NEW}`, oldHosts: 'none' }, false]]) {
      const h = house(cfg);
      // The document, on each host.
      const dn = await h.doc(NEW), dold = await h.doc(FIRST), dcase = await h.doc(FIRST.toUpperCase() + ':443');
      assert.equal(dn.id, did(NEW), `${say}: the new host carries the new id`); assert.deepEqual(dn.alsoKnownAs, [`https://${NEW}`, did(FIRST)], `${say}: and names the old one`);
      assert.equal(dold.id, did(FIRST), `${say}: the old host carries its own id`); assert.deepEqual(dold.alsoKnownAs, [`https://${NEW}`, did(NEW)], `${say}: and names the new one`);
      assert.equal(dcase.id, did(FIRST), `${say}: the host in any case, with a port`);
      for (const [d, me] of [[dn, did(NEW)], [dold, did(FIRST)]]) {
        const k = d.verificationMethod[0]; assert.equal(d.verificationMethod.length, 1);
        assert.equal(k.id, `${me}#register`); assert.equal(k.controller, me); assert.equal(k.publicKeyMultibase, key, `${say}: the same key at ${me}`);
        assert.deepEqual(d.assertionMethod, [`${me}#register`]); assert.deepEqual(d.authentication, [`${me}#register`]);
        assert.ok(d.service.every(s => s.id.startsWith(me + '#') && s.serviceEndpoint.startsWith(`https://${NEW}`)), `${say}: the services lead to where the house stands`);
        assert.ok(/no-store/.test(d.cache), `${say}: no cache may hand one host's document to the other (${d.cache})`);
      }
      assert.equal((await h.doc('collection.museum.example')).id, did(NEW), `${say}: any other host is told the house's own id`);
      // A maker's document, the same way.
      const mp = `/m/${h.makerSlug}/did.json`, mn = await h.doc(NEW, mp), mo = await h.doc(FIRST, mp);
      assert.equal(mn.id, `${did(NEW)}:m:${h.makerSlug}`); assert.equal(mn.controller, did(NEW)); assert.ok(mn.alsoKnownAs.includes(`${did(FIRST)}:m:${h.makerSlug}`), `${say}: the maker's new id names the old`);
      assert.equal(mo.id, `${did(FIRST)}:m:${h.makerSlug}`); assert.equal(mo.controller, did(FIRST)); assert.ok(mo.alsoKnownAs.includes(`${did(NEW)}:m:${h.makerSlug}`), `${say}: the maker's old id names the new`);
      assert.equal(mo.id, old.credentialSubject.maker.id, `${say}: the maker named in the old credential is still found`);
      // Everything else on the old host is as #215 left it.
      { const r = await h.ask('GET', '/everything', FIRST); if (turned) { assert.equal(r.status, 308, `${say}: a page on the old host is sent on`); assert.equal(r.headers.location, `https://${NEW}/everything`); } else assert.equal(r.status, 200, `${say}: a page on the old host is served`); }
      { const r = await h.ask('GET', '/.well-known/security.txt', FIRST); assert.equal(r.status, turned ? 308 : 200, `${say}: only the identity documents stay`); }
      // The credential issued before the move: at the house's door on either host, and as a stranger.
      for (const host of [NEW, FIRST]) { const r = await h.check(old, host); assert.ok(r.ok === true && r.issuer === did(FIRST), `${say}: the old credential checks at the door on ${host}: ${JSON.stringify(r)}`); }
      assert.deepEqual(h.calls, [], `${say}: the house knows its own old identity; nothing is fetched`);
      { const r = await h.stranger(old); assert.equal(r.ok, true, `${say}: a stranger checks the old credential (${r.why})`); }
      // Altered, or signed by someone else in the old name: refused.
      assert.equal((await h.check({ ...old, credentialSubject: { ...old.credentialSubject, title: 'Another title' } }, NEW)).ok, false, `${say}: an altered one does not check`);
      { const kp = require('crypto').generateKeyPairSync('ed25519'); const { proof, ...bare } = old;
        const forged = B.prove(bare, { vm: `${did(FIRST)}#register`, signBytes: b => require('crypto').sign(null, b, kp.privateKey) });
        assert.equal((await h.check(forged, NEW)).ok, false, `${say}: another key in the old name does not check`); assert.equal((await h.stranger(forged)).ok, false); }
      // New credentials: the new identity, wherever they are asked for.
      const fresh = await h.issue(NEW);
      assert.equal(fresh.issuer.id, did(NEW), `${say}: issued under the new identity`); assert.equal(fresh.proof.verificationMethod, `${did(NEW)}#register`); assert.equal(fresh.credentialSubject.maker.id, `${did(NEW)}:m:${h.makerSlug}`);
      assert.equal((await h.check(fresh, NEW)).ok, true); assert.equal((await h.stranger(fresh)).ok, true, `${say}: a stranger checks the new one`);
      if (!turned) assert.equal((await h.issue(FIRST)).issuer.id, did(NEW), `${say}: asked on the old host, still the new identity`);
      console.log(`identity: after the move (${say}), both documents answer, the old credential and the new one check`);
    }

    // 4a. The test house never stood at the first address: one identity.
    { const h = house({ base: 'https://next.example', staging: true }); const d = await h.doc(FIRST); assert.equal(d.id, did('next.example')); assert.deepEqual(d.alsoKnownAs, ['https://next.example']); assert.equal((await h.check(old, 'next.example')).ok, false, 'the test house does not answer for the live house'); }

    // 4b. Unset, in a process of its own.
    const env = { ...process.env }; delete env.BASE_URL; delete env.OLD_HOSTS;
    const out = require('child_process').execFileSync(process.execPath, [__filename, 'unset'], { env, encoding: 'utf8' }); assert.ok(/identity \(unset\): ok/.test(out), out);
    console.log('identity: ok');
  } finally { for (const s of open) s.close(); for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* leave it */ } } setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); }
})().catch(e => { console.error(e); process.exit(1); });
