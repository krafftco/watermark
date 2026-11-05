// The registry (5 Nov): the record of a physical work; an owner records it, a custodian attests, title passes by two
// hands, every entry on the register, the record ready for the desk.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-rgy-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'rgy', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const multi = (jar, p, fields, file) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); if (file) fd.append('file', new Blob([file.buf], { type: file.type }), file.name); return go(jar, p, { method: 'POST', body: fd }); };
  const signin = async (jar, email) => { app.locals.lastCode = null; await form(jar, '/signin/code', { email }); await form(jar, '/signin/verify', { email, code: app.locals.lastCode.code }); };
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  await form(studio, '/studio/accounts', { name: 'Harbour Fine Art Storage', email: 'desk@harbour.example', kind: 'custodian', invite: '0' });
  const cus = db.prepare("SELECT * FROM makers WHERE email='desk@harbour.example'").get(); assert.equal(cus.kind, 'custodian');

  // the public door; a stranger is sent to sign in
  let t = await (await go({}, '/registry')).text(); assert.ok(t.includes('The record of a work, kept.'));
  assert.ok((await go({}, '/yours/registry')).headers.get('location').startsWith('/signin'));

  // an owner records a painting with its photograph
  const ann = {}; await signin(ann, 'ann@example.com');
  const jpg = await sharp({ create: { width: 900, height: 700, channels: 3, background: { r: 120, g: 90, b: 60 } } }).jpeg().toBuffer();
  let r = await multi(ann, '/yours/registry', { title: 'A Woman Reading by a Window', artist: 'Jan van der Meer', made: 'c. 1642', medium: 'Oil on canvas', dims: '61 × 50 cm', marks: 'A dealer’s label on the stretcher' }, { buf: jpg, type: 'image/jpeg', name: 'p.jpg' });
  const o = db.prepare('SELECT * FROM objects').get(); assert.ok(o && o.photo && o.made_year === 1642 && r.headers.get('location') === `/registry/o/${o.id}?ok=made`);
  const R = app.locals.registry; const no = R.no(o); assert.ok(/^WR \d{4} \d{4} \d{4}$/.test(no) && R.byNo(no).id === o.id, 'the number reads back');
  assert.equal(R.byNo(no.slice(0, -1) + ((+no.slice(-1) + 1) % 10)), null, 'a mistyped number fails');

  // provenance before 1933, a paper for the acquisition; the 1933–45 years are asked for
  await multi(ann, `/registry/o/${o.id}/event`, { kind: 'provenance', party: 'The Six family, Amsterdam', year_from: '1700', year_to: '1920', how: 'by descent', source: 'Hofstede de Groot, 1907, no. 31' });
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  await multi(ann, `/registry/o/${o.id}/event`, { kind: 'acquired', party: 'A private collection, Geneva', on_date: '2019-05-02', how: 'purchase', price: '1,250,000' }, { buf: pdf, type: 'application/pdf', name: 'bill.pdf' });
  let rd = R.ready(R.obj ? o : db.prepare('SELECT * FROM objects WHERE id=?').get(o.id));
  const key = k => rd.find(x => x.k === k).ok;
  assert.ok(key('described') && key('title') && !key('provenance') && !key('custody') && !key('opinion') && !key('search'), 'the gap is asked for: ' + JSON.stringify(rd.map(x => [x.k, x.ok])));
  await multi(ann, `/registry/o/${o.id}/event`, { kind: 'provenance', party: 'Galerie Meyer, Lucerne', year_from: '1920', year_to: '1960', how: 'purchase' });
  await multi(ann, `/registry/o/${o.id}/event`, { kind: 'opinion', party: 'The catalogue raisonné committee', on_date: '2020-01-10', result: 'By the artist' });
  await multi(ann, `/registry/o/${o.id}/event`, { kind: 'search', party: 'The Art Loss Register', on_date: new Date().toISOString().slice(0, 10), result: 'clear' }, { buf: pdf, type: 'application/pdf', name: 'alr.pdf' });

  // the custodian: named, attests receipt and condition in its own name
  r = await form(ann, `/registry/o/${o.id}/custodian`, { handle: cus.handle }); assert.ok(r.headers.get('location').includes('ok=custodian'));
  const harbour = {}; await signin(harbour, 'desk@harbour.example');
  t = await (await go(harbour, '/account/custody')).text(); assert.ok(t.includes('A Woman Reading') && t.includes('Not yet attested'));
  await multi(harbour, `/account/custody/${o.id}`, { result: 'received', condition: 'Good', body: 'Bay 4, rack 12' });
  const ev = db.prepare('SELECT * FROM object_events WHERE object_id=? ORDER BY id').all(o.id);
  assert.ok(ev.some(e => e.kind === 'custody' && e.by_kind === 'custodian' && e.by_name === 'Harbour Fine Art Storage') && ev.some(e => e.kind === 'condition' && e.by_kind === 'custodian'), 'attested in its own name');
  assert.ok(ev.every(e => e.sha && e.seq), 'every entry fingerprinted and on the register');
  rd = R.ready(db.prepare('SELECT * FROM objects WHERE id=?').get(o.id)); assert.ok(rd.every(x => x.ok), 'ready for the desk: ' + JSON.stringify(rd.filter(x => !x.ok).map(x => x.k)));

  // a correction sets right, and both stand on the register
  const first = ev.find(e => e.kind === 'provenance');
  await multi(ann, `/registry/o/${o.id}/event`, { kind: 'provenance', party: 'The Six family, Amsterdam', year_from: '1700', year_to: '1919', how: 'by descent', corrects: String(first.id) });
  t = await (await go(ann, `/registry/o/${o.id}`)).text(); assert.ok(t.includes('sets right an earlier entry') && t.includes('1700–1919') && !t.includes('1700–1920'), 'the corrected entry gives way');
  assert.ok(t.includes('$1,250,000') && t.includes('Bay 4, rack 12'), 'the owner sees the price and where it is held');

  // private by default; public shows the object, never the owner, place, price or papers
  const stranger = {};
  assert.equal((await go(stranger, `/registry/o/${o.id}`)).status, 302, 'a stranger is asked to sign in');
  const bea = {}; await signin(bea, 'bea@example.com');
  assert.equal((await go(bea, `/registry/o/${o.id}`)).status, 404, 'another person sees nothing');
  await form(ann, `/registry/o/${o.id}/share`, { public: '1' });
  const path_ = '/r/' + no.replace(/\s+/g, '').slice(2);
  t = await (await go(stranger, path_)).text();
  assert.ok(t.includes('A Woman Reading') && t.includes('Galerie Meyer') && !t.includes('1,250,000') && !t.includes('Geneva') && !t.includes('Harbour') && !t.includes('Bay 4') && !t.includes('The paper') && t.includes('Owner and place are kept private'), 'public: the object, not the owner');
  t = await (await go(stranger, '/registry')).text(); assert.ok(t.includes(path_), 'on the public registry');
  // a reader's link: the whole record and the papers
  await form(ann, `/registry/o/${o.id}/share`, { link: '1' }); const tok = db.prepare('SELECT token FROM objects WHERE id=?').get(o.id).token;
  t = await (await go(stranger, `/registry/o/${o.id}?k=${tok}`)).text(); assert.ok(t.includes('The paper') && t.includes('Geneva') && !t.includes('1,250,000'), 'a reader sees the papers, never the price');
  const acq = ev.find(e => e.kind === 'acquired');
  r = await go(stranger, `/registry/o/${o.id}/file/${acq.id}?k=${tok}`); assert.equal(r.status, 200); assert.ok((await r.text()).startsWith('%PDF'));
  assert.equal((await go(stranger, `/registry/o/${o.id}/file/${acq.id}`)).status, 404, 'no paper without the link');
  r = await go(ann, `/registry/o/${o.id}/dossier.pdf`); assert.equal(r.status, 200); assert.ok(Buffer.from(await r.arrayBuffer()).slice(0, 4).toString() === '%PDF', 'the dossier');

  // title by two hands
  await form(ann, `/registry/o/${o.id}/transfer`, { email: 'bea@example.com', note: 'As agreed in October', attest: '1' });
  const x = db.prepare("SELECT * FROM object_transfers WHERE status='offered'").get(); assert.ok(x);
  t = await (await go(bea, '/yours/registry')).text(); assert.ok(t.includes('Offered to you'));
  t = await (await go(bea, `/registry/take/${x.token}`)).text(); assert.ok(t.includes('Accept the title'));
  await form(bea, `/registry/take/${x.token}`, { attest: '1' });
  const after = db.prepare('SELECT * FROM objects WHERE id=?').get(o.id); const bb = db.prepare("SELECT id FROM buyers WHERE email='bea@example.com'").get();
  assert.equal(after.owner, `b:${bb.id}`); assert.equal(after.public, 0, 'private again for the new owner'); assert.equal(after.custodian_id, cus.id, 'the custodian stays');
  assert.equal((await go(ann, `/registry/o/${o.id}`)).status, 404, 'the old owner no longer holds the record');
  assert.equal((await go(bea, `/registry/take/${x.token}`)).status, 410, 'the offer is spent');
  t = await (await go(bea, `/registry/o/${o.id}`)).text(); assert.ok(t.includes('Title passed') && t.includes('Yours'));

  // the register keeps it all, hidden from the public page
  assert.ok(db.prepare("SELECT COUNT(*) n FROM ledger WHERE type='object.event'").get().n >= 9);
  t = await (await go(stranger, '/ledger')).text(); assert.ok(!t.includes('object.event') && !t.includes('A Woman Reading'));
  t = await (await go(studio, '/studio/registry')).text(); assert.ok(t.includes(no));
  srv.close(); console.log('registry: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
