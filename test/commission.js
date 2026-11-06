// The commission room (5 Nov): a collector asks an artist for a work made for them; they talk it through with
// photographs and films; the artist offers a fee, the collector accepts; the agreement is written and the collector
// pays; the artist posts an update; strangers see nothing.
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-cnv-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'cnv', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('ari','Ari Lens','ari@example.com','maker',datetime('now'),'house')").run();
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('bo','Bo Other','bo@example.com','maker',datetime('now'),'house')").run();
  const ari = db.prepare("SELECT * FROM makers WHERE handle='ari'").get();
  const mkJar = () => { const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; }); const form = (p, b) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() }); return { go, form }; };
  const client = mkJar(); const artist = mkJar(); const other = mkJar();
  await artist.form('/studio/login', { password: 'pw' }); await artist.go('/account?maker=ari');
  await other.form('/studio/login', { password: 'pw' }); await other.go('/account?maker=bo');

  // The collector's door.
  let t = await (await client.go('/commission?to=ari')).text(); assert.ok(/Commission Ari Lens/.test(t) && /Begin the conversation/.test(t), 'the door');
  let r = await client.form('/brands/brief', { kind: 'personal', to: 'ari', contact: 'Amy Field', email: 'amy@example.com', title: 'Our house in the snow', body: 'For the hall.', kinds: 'photographs', n: '1', budget: '1500' });
  assert.strictEqual(r.status, 302);
  const b0 = db.prepare('SELECT * FROM briefs').get(); assert.ok(b0.kind === 'personal' && b0.company === 'Amy Field' && b0.uses === 'personal' && b0.to_maker === ari.id, JSON.stringify(b0));
  t = await (await client.go(`/b/${b0.token}`)).text(); assert.ok(/Talk with Ari/.test(t), 'the room on the desk');

  // The collector writes with a photograph; the artist reads it and answers with an offer.
  const pic = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 210, b: 230 } } }).jpeg().toBuffer();
  let fd = new FormData(); fd.append('body', 'Here is the house last winter.'); fd.append('files', new Blob([pic], { type: 'image/jpeg' }), 'house.jpg');
  r = await client.go(`/b/${b0.token}/t/${ari.id}/say`, { method: 'POST', body: fd }); assert.strictEqual(r.status, 302);
  let msgs = db.prepare('SELECT * FROM commission_msgs ORDER BY id').all(); assert.ok(msgs.length === 1 && JSON.parse(msgs[0].files).length === 1, 'kept with its photograph');
  t = await (await artist.go(`/account/briefs/${b0.ref}`)).text(); assert.ok(/Here is the house last winter/.test(t) && /Talk with Amy/.test(t), 'the artist reads it');
  r = await artist.go(`/account/briefs/${b0.ref}/m/${msgs[0].id}/0`); assert.ok(r.status === 200 && /image\/jpeg/.test(r.headers.get('content-type')), 'the artist sees the photograph');
  r = await client.go(`/b/${b0.token}/t/${ari.id}/f/${msgs[0].id}/0`); assert.strictEqual(r.status, 200, 'the collector sees it too');
  assert.strictEqual((await client.go(`/b/wrong/t/${ari.id}/f/${msgs[0].id}/0`)).status, 404, 'a stranger sees nothing');
  assert.strictEqual((await other.go(`/account/briefs/${b0.ref}/m/${msgs[0].id}/0`)).status, 404, 'another artist sees nothing');
  // A page named .jpg is turned away and named.
  fd = new FormData(); fd.append('body', 'And this.'); fd.append('files', new Blob([Buffer.from('<html><script>x</script></html>')], { type: 'image/jpeg' }), 'bad.jpg');
  r = await client.go(`/b/${b0.token}/t/${ari.id}/say`, { method: 'POST', body: fd }); assert.ok(/bad\.jpg/.test(decodeURIComponent(r.headers.get('location'))), 'the refusal named');

  // Offers: the artist offers $1,200; a newer offer replaces it at $1,400; the collector accepts.
  await artist.form(`/account/briefs/${b0.ref}/say`, { body: 'I could do it at dawn.', fee: '1200', terms: 'Two rounds of changes' });
  await artist.form(`/account/briefs/${b0.ref}/say`, { body: 'With a framed print.', fee: '1400', due: '2026-12-20', terms: 'A framed 16 x 20 included' });
  const offers = db.prepare("SELECT * FROM commission_msgs WHERE kind='offer' ORDER BY id").all(); assert.deepStrictEqual(offers.map(o => o.status), ['replaced', 'open']);
  r = await artist.form(`/account/briefs/${b0.ref}/accept/${offers[1].id}`, {}); assert.strictEqual(db.prepare('SELECT status FROM briefs').get().status, 'open', 'the artist cannot accept their own offer');
  t = await (await client.go(`/b/${b0.token}`)).text(); assert.ok(/Accept \$1,400/.test(t), 'the collector can accept');
  await client.form(`/b/${b0.token}/t/${ari.id}/accept/${offers[1].id}`, {});
  let b = db.prepare('SELECT * FROM briefs').get(); assert.ok(b.status === 'chosen' && b.fee_cents === 140000 && b.due === '2026-12-20' && b.agreement_hash.length === 64, 'agreed: ' + JSON.stringify(b));
  t = await (await client.go(`/b/${b0.token}`)).text(); assert.ok(/the Collector/.test(t) && /to keep, print and hang at home/.test(t) && /Pay \$/.test(t), 'a collector’s agreement, and the payment');
  assert.ok(db.prepare("SELECT 1 FROM commission_msgs WHERE side='house' AND body LIKE 'Agreed:%'").get(), 'the house says it was agreed');

  // Paid; the artist posts an update with a film; the collector's page asks for what is new.
  await client.form(`/b/${b0.token}/pay`, {}); b = db.prepare('SELECT * FROM briefs').get(); assert.strictEqual(b.status, 'commissioned');
  const last = db.prepare('SELECT MAX(id) n FROM commission_msgs').get().n;
  const reel = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(4096, 7)]);
  fd = new FormData(); fd.append('body', 'The first morning. Snow came in at six.'); fd.append('update', '1'); fd.append('files', new Blob([reel], { type: 'video/mp4' }), 'dawn.mp4');
  await artist.go(`/account/briefs/${b0.ref}/say`, { method: 'POST', body: fd });
  const up = db.prepare('SELECT * FROM commission_msgs ORDER BY id DESC').get(); assert.ok(up.kind === 'update' && /video\//.test(JSON.parse(up.files)[0].mime), 'an update with its film');
  const j = await (await client.go(`/b/${b0.token}/t/${ari.id}/thread.json?after=${last}`)).json(); assert.ok(j.after === up.id && /The first morning/.test(j.html) && /<video/.test(j.html), 'what is new, for the page');
  // After payment an offer is not taken.
  await client.form(`/b/${b0.token}/t/${ari.id}/say`, { body: 'Could it be less?', fee: '900' });
  assert.ok(!db.prepare("SELECT 1 FROM commission_msgs WHERE kind='offer' AND fee_cents=90000").get(), 'no offers once paid');

  // The collector's list, signed in by the email.
  r = await client.go('/yours/commissions'); assert.ok(r.status === 302 && /signin/.test(r.headers.get('location')), 'your commissions ask you to sign in');
  srv.close(); console.log('ok: the commission room');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
