// The sitter (31 Oct): a picture is linked to a person only by their word; their word on commercial use holds.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sit-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'sit', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (p, o = {}, j) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie()) j[c.split('=')[0]] = c.split('=')[1].split(';')[0]; return r; });
  const form = b => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  const me = {}; await go('/studio/login', form({ password: 'pw' }), me);
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('ph','Pia Hart','ph@example.com','maker',datetime('now'),'house')").run();
  const mid = db.prepare("SELECT id FROM makers WHERE handle='ph'").get().id;
  db.prepare('INSERT INTO uses (maker_id,key,name,description,term_months,kind,sort,price_cents) SELECT ?,key,name,description,term_months,kind,sort,price_cents FROM uses WHERE maker_id=(SELECT MIN(id) FROM makers)').run(mid);
  await go('/account?maker=ph', {}, me);
  const put = async n => { const buf = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: { r: 40 * n, g: 90, b: 120 } } }).jpeg().toBuffer(); const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), `s${n}.jpg`); const j = await (await go('/account/works/one', { method: 'POST', body: fd }, me)).json(); return j.slug; };
  const a = await put(1), b2 = await put(2), c = await put(3);
  db.prepare("UPDATE works SET status='held', width=6000, height=7500 WHERE maker_id=?").run(mid);
  const W = s => db.prepare('SELECT * FROM works WHERE slug=?').get(s);
  // 1. A release with an address links the sitter at once; a minor's never does.
  db.prepare("INSERT INTO work_releases (work_id, maker_id, kind, subject, signed_on, minor, by, email) VALUES (?,?,?,?,date('now'),0,'signed on the house',?)").run(W(a).id, mid, 'model', 'Ana Ruiz', 'ana@example.com');
  db.prepare("INSERT INTO work_releases (work_id, maker_id, kind, subject, signed_on, minor, by, email) VALUES (?,?,?,?,date('now'),1,'signed on the house',?)").run(W(c).id, mid, 'model', 'A child (signed by a parent)', 'parent@example.com');
  app.locals.sitters.sync();
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM sittings WHERE status='on'").get().n, 1, 'the release links one sitter; the minor none');
  // 2. Named on another work: known by her release, so linked at once.
  let r = await go(`/account/works/${b2}/sitter`, form({ name: 'Ana Ruiz', email: 'ana@example.com' }), me); assert.ok(/sit=linked/.test(r.headers.get('location')), 'known: linked');
  // 3. A stranger named: asked, and nothing links until she says yes.
  r = await go(`/account/works/${c}/sitter`, form({ name: 'Bea Stone', email: 'bea@example.com' }), me); assert.ok(/sit=asked/.test(r.headers.get('location')));
  const tok = db.prepare("SELECT st.token FROM sittings st JOIN sitters s ON s.id=st.sitter_id JOIN buyers b ON b.id=s.buyer_id WHERE b.email='bea@example.com'").get().token;
  const bea = {}; let t = await (await go(`/sit/${tok}`, {}, bea)).text(); assert.ok(/Is it you\?/.test(t));
  r = await go(`/sit/${tok}`, form({ a: 'yes' }), bea); assert.ok(/\/yours\/sitter/.test(r.headers.get('location')), 'yes: signed in, to her room');
  t = await (await go('/yours/sitter', {}, bea)).text(); assert.ok(/Pictures of you/.test(t) && t.includes(c) && /Photographed by/.test(t), 'her room');
  // 4. Her word: no commercial use; the wall stops offering a company's or a campaign's use; personal uses stay.
  await go('/yours/sitter', form({ credit: '1', commercial: 'closed', fee: '' }), bea);
  const j = app.locals.workJSON(W(c)); assert.ok(!j.uses.some(u => ['commercial', 'campaign'].includes(u.key)), 'closed: not listed');
  assert.ok(j.uses.some(u => u.key === 'social'), 'Collect stays');
  // 5. Ask me first (the default): listed, never instant.
  const ana = db.prepare("SELECT s.* FROM sitters s JOIN buyers b ON b.id=s.buyer_id WHERE b.email='ana@example.com'").get(); assert.strictEqual(ana.commercial, 'ask');
  const ja = app.locals.workJSON(W(a)); const cu = ja.uses.find(u => u.key === 'commercial'); assert.ok(!cu || !cu.instant, 'ask first: never instant');
  // 6. The credit on the work page; keep a picture of yourself.
  t = await (await go(`/w/${c}`, {}, {})).text(); assert.ok(/With <span>Bea Stone<\/span>/.test(t), 'the credit');
  r = await go(`/yours/sitter/keep/${c}`, form({}), bea); assert.ok(/ok=kept/.test(r.headers.get('location')));
  assert.ok(db.prepare("SELECT 1 FROM licenses WHERE work_id=? AND intended_use='Kept by its sitter' AND status='active'").get(W(c).id), 'kept, a free licence');
  r = await go(`/yours/sitter/keep/${a}`, form({}), bea); assert.strictEqual(r.status, 403, 'only her own pictures');
  t = await (await go('/account/sitters', {}, me)).text(); assert.ok(/Ana Ruiz/.test(t) && /Bea Stone/.test(t), 'your sitters');
  t = await (await go(`/account/works/${a}`, {}, me)).text(); assert.ok(/In this picture/.test(t) && /Signed a release/.test(t), 'on the record');

  // 7. A company asks to use a picture of Ana (ask me first): she is asked by link; the photographer cannot quote until she says yes.
  { const u = db.prepare("SELECT * FROM uses WHERE maker_id=? AND key='commercial'").get(mid); const ref = 'WM-2026-990001';
    db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,licensee_company,intended_use,status) VALUES (?,?,?,?,?,?,?,'requested')").run(ref, W(a).id, u.id, 'Buyer', 'buyer@example.com', 'Halden', 'The spring catalogue');
    require('../src/ledger').append(db, 'license.requested', ref, { work: a, use: 'commercial' }); await new Promise(r => setTimeout(r, 30));
    const ak = db.prepare("SELECT * FROM sitter_asks WHERE license_ref=?").get(ref); assert.ok(ak && ak.status === 'asked', 'Ana is asked');
    let x = await app.locals.requests.accept(ref, 90000, 'test'); assert.ok(!x.ok && /Waiting on Ana/.test(x.why), 'no quote before her yes: ' + x.why);
    const anaJar = {}; let tx = await (await go(`/sit/ask/${ak.token}`, {}, anaJar)).text(); assert.ok(/Halden would like to use it/.test(tx) && /10% of Pia/.test(tx), 'what she is asked, and her share');
    await go(`/sit/ask/${ak.token}`, form({ a: 'yes' }), anaJar);
    // Her yes; paid: 10% of the photographer's side to her pocket, a cost on the photographer's statement.
    db.prepare("UPDATE licenses SET price_cents=90000, house_cents=0, status='active' WHERE ref=?").run(ref);
    assert.strictEqual(app.locals.sitters.pay(ref), 1, 'paid');
    const pay = db.prepare("SELECT * FROM sitter_pay WHERE license_ref=?").get(ref); assert.strictEqual(pay.cents, 9000, '10% of the side');
    assert.ok(db.prepare("SELECT 1 FROM pocket WHERE kind='sitting' AND ref=? AND cents=9000").get(ref), 'in her pocket');
    const st = app.locals.payouts.statement(db.prepare('SELECT * FROM makers WHERE id=?').get(mid)); assert.strictEqual(st.sitters.s, 9000, 'a cost on the statement');
    assert.strictEqual(app.locals.sitters.pay(ref), 0, 'never twice');
    // A no declines the request.
    const ref2 = 'WM-2026-990002'; db.prepare("INSERT INTO licenses (ref,work_id,use_id,licensee_name,licensee_email,licensee_company,status) VALUES (?,?,?,?,?,?,'requested')").run(ref2, W(a).id, u.id, 'Buyer', 'buyer@example.com', 'Other Co');
    require('../src/ledger').append(db, 'license.requested', ref2, { work: a, use: 'commercial' }); await new Promise(r => setTimeout(r, 30));
    const ak2 = db.prepare("SELECT * FROM sitter_asks WHERE license_ref=?").get(ref2); await go(`/sit/ask/${ak2.token}`, form({ a: 'no' }), {});
    assert.strictEqual(db.prepare('SELECT status FROM licenses WHERE ref=?').get(ref2).status, 'declined', 'her no declines it'); }
  console.log('sitters: all hold'); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
