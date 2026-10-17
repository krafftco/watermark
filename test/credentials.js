// Content Credentials: a delivered file is signed, names the maker and the license, keeps the original as its parent.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { execSync } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-cr-'));
const sh = c => execSync(c, { cwd: dir, stdio: 'pipe' });
fs.writeFileSync(path.join(dir, 'leaf.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=1.3.6.1.5.5.7.3.36,emailProtection\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
sh('openssl ecparam -name prime256v1 -genkey -noout -out ca.key && openssl req -x509 -new -key ca.key -sha256 -days 30 -subj "/CN=Test Root/O=Test" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out ca.pem');
sh('openssl ecparam -name prime256v1 -genkey -noout -out l0.key && openssl pkcs8 -topk8 -nocrypt -in l0.key -out leaf.key && openssl req -new -key leaf.key -subj "/CN=Watermark Test/O=Test" -out leaf.csr && openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 30 -sha256 -extfile leaf.ext -out leaf.pem');
process.env.C2PA_CERT = fs.readFileSync(path.join(dir, 'leaf.pem'), 'utf8') + fs.readFileSync(path.join(dir, 'ca.pem'), 'utf8');
process.env.C2PA_KEY = fs.readFileSync(path.join(dir, 'leaf.key')).toString('base64');
const CR = require('../src/credentials');
(async () => {
  assert.ok(CR.enabled(), 'signer configured');
  const src = path.join(__dirname, 'fixture.jpg'), out = path.join(dir, 'out.jpg');
  assert.equal(await CR.inspect(src), null, 'a plain file carries nothing');
  assert.ok(await CR.seal({ input: src, output: out, parent: src, title: 'Test', maker: 'Ada', accession: 'WM.2026.0001', url: 'https://wm.test/w/test', ref: 'WM-2026-000001', licensee: 'Co', use: 'In a story', fingerprint: 'ab' }), 'sealed');
  const c = await CR.inspect(out);
  assert.equal(c.state, 'Valid'); assert.equal(c.author, 'Ada'); assert.equal(c.app, 'Watermark');
  console.log('ok: content credentials');
})().catch(e => { console.error(e); process.exit(1); });
