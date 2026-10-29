// The brief (29 Oct): a brand asks once; an artist answers; the brand chooses and pays (held); the artist delivers
// photographs from the vault and a reel; a company's use waits for the release of anyone recognisable; the brand
// approves; the fee joins the artist's statement; a quiet brand is approved by itself.
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-brief-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'brief', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('ari','Ari Lens','ari@example.com','maker',datetime('now'),'house')").run();
  const maker = db.prepare("SELECT * FROM makers WHERE handle='ari'").get();
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (p, b) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  await form('/studio/login', { password: 'pw' }); await go('/account?maker=ari');
  const put = async (n, name) => { const buf = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: 40 * n, g: 90, b: 200 - 20 * n } } }).jpeg().toBuffer(); const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), name); const j = await (await go('/account/works/one', { method: 'POST', body: fd })).json(); assert.ok(j.ok, JSON.stringify(j)); return j.slug; };
  const plain = await put(1, 'plain.jpg'); const street = await put(4, 'street.jpg');
  db.prepare('UPDATE works SET attribution=? WHERE slug=?').run(JSON.stringify({ art: false, people: { recognisable: 0 }, property: {} }), plain);
  db.prepare('UPDATE works SET attribution=? WHERE slug=?').run(JSON.stringify({ art: false, people: { recognisable: 2 }, property: {} }), street);

  // 1. The door and the brief, to Ari.
  let t = await (await go('/brands?to=ari')).text(); assert.ok(/Commission Ari Lens/.test(t) && /Send the brief/.test(t), 'the door');
  let r = await form('/brands/brief', { to: 'ari', company: 'Natora', contact: 'Jo', email: 'jo@natora.example', title: 'Founders, for the spring', body: 'Portraits and a short reel.', kinds: 'photographs', n: '3', uses: 'commercial', territory: 'us', term: '12', budget: '2500' });
  assert.strictEqual(r.status, 302); const b0 = db.prepare('SELECT * FROM briefs').get(); assert.ok(b0 && b0.to_maker === maker.id && /^BR-/.test(b0.ref));
  assert.strictEqual((await go('/b/nope')).status, 404);
  // 2. Ari answers.
  t = await (await go('/account/briefs')).text(); assert.ok(t.includes(b0.title), 'on the artist’s desk');
  await form(`/account/briefs/${b0.ref}/answer`, { fee: '2000', line: 'In the morning light.', refs: plain });
  const a = db.prepare('SELECT * FROM brief_answers').get(); assert.ok(a && a.fee_cents === 200000);
  t = await (await go(`/b/${b0.token}`)).text(); assert.ok(/Choose Ari/.test(t) && /\$2,000/.test(t), 'the answer on the brand’s desk');
  // 3. Choose and pay (held).
  await form(`/b/${b0.token}/choose`, { answer: String(a.id) });
  t = await (await go(`/b/${b0.token}`)).text(); assert.ok(/COMMISSION AND LICENCE/.test(t) && /Pay \$/.test(t), 'the agreement and the payment');
  assert.ok(db.prepare('SELECT agreement_hash FROM briefs').get().agreement_hash.length === 64, 'fingerprinted');
  await form(`/b/${b0.token}/pay`, {}); let b = db.prepare('SELECT * FROM briefs').get(); assert.ok(b.paid === 1 && b.status === 'commissioned', 'funded: ' + b.status);
  // 4. Deliver: the street picture waits for a release; the plain one and a reel go.
  t = await (await go(`/account/briefs/${b0.ref}`)).text(); assert.ok(/Needs a release/.test(t) && /Deliver/.test(t), 'deliver, with the held one marked');
  const reel = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(4096, 7)]);
  const fd = new FormData(); fd.append('works', plain); fd.append('works', street); fd.append('files', new Blob([reel], { type: 'video/mp4' }), 'reel.mp4'); fd.append('files', new Blob([Buffer.from('<html><script>x</script>')], { type: 'video/mp4' }), 'bad.mp4');
  r = await go(`/account/briefs/${b0.ref}/deliver`, { method: 'POST', body: fd }); const ok = decodeURIComponent(r.headers.get('location'));
  const files = db.prepare('SELECT * FROM brief_files ORDER BY id').all();
  assert.deepStrictEqual(files.map(f => f.kind).sort(), ['image', 'video'], 'the plain one and the reel: ' + ok);
  assert.ok(/Street|street/.test(ok) && /bad\.mp4/.test(ok), 'refusals named: ' + ok);
  b = db.prepare('SELECT * FROM briefs').get(); assert.strictEqual(b.status, 'delivered');
  // The brand looks; strangers cannot.
  const vid = files.find(f => f.kind === 'video');
  r = await go(`/b/${b.token}/f/${vid.id}`); assert.strictEqual(r.status, 200); assert.ok(/inline/.test(r.headers.get('content-disposition') || ''));
  assert.strictEqual((await go(`/b/wrong/f/${vid.id}`)).status, 404);
  // A change, then deliver again, then approve.
  await form(`/b/${b.token}/change`, { note: 'Warmer, please.' }); assert.strictEqual(db.prepare('SELECT status FROM briefs').get().status, 'commissioned');
  t = await (await go(`/account/briefs/${b0.ref}`)).text(); assert.ok(/Warmer, please/.test(t), 'the change is told');
  const fd2 = new FormData(); fd2.append('files', new Blob([reel], { type: 'video/mp4' }), 'reel-2.mp4');
  await go(`/account/briefs/${b0.ref}/deliver`, { method: 'POST', body: fd2 });
  await form(`/b/${b.token}/approve`, {}); b = db.prepare('SELECT * FROM briefs').get(); assert.ok(b.status === 'done' && b.approved_at, 'approved');
  r = await go(`/b/${b.token}/f/${vid.id}`); assert.ok(/attachment/.test(r.headers.get('content-disposition') || ''), 'taken once approved');
  // The money: on the statement, clearing.
  const st = app.locals.payouts.statement(db.prepare('SELECT * FROM makers WHERE id=?').get(maker.id));
  assert.ok(st.commissions.s === 200000 && st.owed >= 200000 && st.clearing >= 200000, 'on the statement and clearing: ' + JSON.stringify({ c: st.commissions, owed: st.owed, cl: st.clearing }));
  assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='commission.approved'").get());
  // A quiet brand: approved by itself.
  await form('/brands/brief', { company: 'Quiet Co', email: 'q@q.example', title: 'Open call', kinds: 'reel', uses: 'campaign', territory: 'world', term: '0' });
  const q = db.prepare("SELECT * FROM briefs WHERE company='Quiet Co'").get(); assert.ok(q.to_maker === null);
  await form(`/account/briefs/${q.ref}/answer`, { fee: '500' }); const qa = db.prepare('SELECT * FROM brief_answers WHERE brief_id=?').get(q.id);
  await form(`/b/${q.token}/choose`, { answer: String(qa.id) }); await form(`/b/${q.token}/pay`, {});
  const fd3 = new FormData(); fd3.append('works', plain); await go(`/account/briefs/${q.ref}/deliver`, { method: 'POST', body: fd3 });
  db.prepare("UPDATE briefs SET delivered_at=datetime('now','-20 days') WHERE id=?").run(q.id); app.locals.briefs.quiet();
  assert.strictEqual(db.prepare('SELECT status FROM briefs WHERE id=?').get(q.id).status, 'done', 'approved by itself');
  t = await (await go('/studio/briefs')).text(); assert.ok(t.includes('Quiet Co'));
  t = await (await go('/m/ari')).text(); assert.ok(/Commission Ari/.test(t) || !/mh-fo/.test(t), 'the maker page’s door');
  srv.close(); console.log('briefs: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
