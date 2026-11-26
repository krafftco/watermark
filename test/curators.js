// A curator's first ten minutes (#225). One true word on pay in the letter, the curator's room and the public wall,
// read against what the code pays; a letter on approval with the public link; an address that follows the title, the
// old one sending on; no public link and no Share on a draft; a photograph the public has not seen never opened by one
// press, named on the approval, and the show opened with it or without it; Curators where a maker can find it.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
const V = require('../src/views'); const H = require('../src/hangs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-cur-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'cur', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, accept: 'text/html', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body = {}, h = {}) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...h }, body: new URLSearchParams(body).toString() });
  const text = async (jar, p) => { const r = await go(jar, p); assert.equal(r.status, 200, `${p} → ${r.status} ${r.headers.get('location') || ''}`); return r.text(); };
  const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '’').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('mira','Mira Kell','mira@example.com','maker',datetime('now'),'house')").run();
  const mira = db.prepare("SELECT * FROM makers WHERE handle='mira'").get();
  const W = {};
  for (const [k, title, status, kb] of [['a', 'The Pier', 'held', 0], ['b', 'Low Tide', 'held', 0], ['c', 'The Dunes at Night', 'hidden', 0], ['d', 'Her Father', 'hidden', 1], ['e', 'The Ferry', 'hidden', 0]]) {
    const f = path.join(dir, `${k}.jpg`); fs.writeFileSync(f, await sharp(path.join(__dirname, 'fixture.jpg')).resize(900).modulate({ hue: k.charCodeAt(0) * 7 }).jpeg().toBuffer());
    const w = await app.locals.registerWork({ file: f, title, makerId: mira.id, originalName: `${k}.jpg` });
    db.prepare('UPDATE works SET status=?, keep_back=? WHERE slug=?').run(status, kb, w.slug); W[k] = db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug);
  }
  const st = id => db.prepare('SELECT status, keep_back FROM works WHERE id=?').get(id);
  const maker = {}; await form(maker, '/studio/login', { password: 'pw' }); await go(maker, '/account?maker=mira');

  // 6. Curators is where a maker can find it: the quiet sheet, /everything, Find.
  assert.ok(V.isQuiet(), 'the house is quiet');
  { const acc = await text(maker, '/account'); const sheet = acc.slice(acc.indexOf('data-rm '), acc.indexOf('data-rm-none')); assert.ok(sheet.includes('href="/account/curators"'), 'Curators is on the maker’s quiet sheet');
    const ev = await text({}, '/everything'); assert.ok(ev.includes('href="/account/curators"'), 'Curators is on /everything');
    assert.ok(V.DOORS.some(([, l]) => l.some(([h, , , w]) => h === '/account/curators' && /curator/.test(w))), 'Find knows the room by the word a maker types');
    const r = await go({}, '/account/curators'); assert.ok(r.status === 302 && /\/signin\?next=/.test(r.headers.get('location')), 'a stranger is sent to sign in, never a bare status'); }

  // 1 + 7. The invitation: plain, and it says what the code pays.
  const pct = H.CURATOR_PCT, SHARE = H.curatorShare(); assert.equal(SHARE, `${pct}% of the price, from the house’s share`);
  let r = await form(maker, '/account/curators', { name: 'Noor Haddad', email: 'noor@example.com', label: 'Tide Gallery' });
  const cur = db.prepare("SELECT * FROM curators WHERE email='noor@example.com'").get();
  { const L = require('../src/mail-letters').curatorInvite({ base, name: 'Noor Haddad', maker: 'Mira Kell', makerFirst: 'Mira', label: 'Tide Gallery', link: base + '/curate/join/x', no: 1, share: SHARE });
    assert.ok(L.text.includes(`you earn ${SHARE}, never Mira’s`) && plain(L.html).includes(`you earn ${SHARE}, never Mira’s`), 'the invitation states the share the code pays');
    assert.ok(/credited to your pocket at the sale; on Fridays what has cleared goes to your bank, once you have connected one/.test(L.text), 'and how it reaches a bank');
    assert.ok(!/paid on Fridays with the makers|pleasure of your eye/.test(L.text + L.html), 'the old words are gone');
    assert.ok(/Nothing opens until Mira approves it/.test(L.text) && /please do not forward it/.test(L.text), 'plain about approval and about the link');
    const page = await text(maker, '/account/curators'); assert.ok(plain(page).includes(`they earn ${SHARE}, never yours`), 'the maker reads the same share where the keys are sent'); }
  const noor = {}; r = await go(noor, '/curate/join/' + cur.token); const desk = r.headers.get('location').split('?')[0]; assert.ok(desk.startsWith('/curate/'));
  { const t = plain(await text(noor, desk)); assert.ok(t.includes(`earns you ${SHARE}`), 'the desk’s first steps state the share');
    const room = plain(await text(noor, '/curate')); assert.ok(room.includes(`you earn ${SHARE}, never the maker’s`) && !/paid on Fridays\./.test(room), 'the curator’s room states it the same way'); }
  // …and the code pays exactly that: a sale through an open wall credits pct of the price, from the house.
  { const buyer = db.prepare("INSERT INTO buyers (customer, email, name) VALUES ('', 'cx@example.com', 'Cx')").run().lastInsertRowid; const nb = db.prepare("SELECT id FROM buyers WHERE lower(email)='noor@example.com'").get().id;
    const hid = db.prepare("INSERT INTO hangs (buyer_id, slug, title, public) VALUES (?,?,?,1)").run(nb, 'pay-check', 'Pay check').lastInsertRowid;
    const got = app.locals.hangs.reward({ ref: 'WM-TEST-225', via: `hang:${hid}`, price_cents: 35000, buyer_id: buyer }, W.a);
    assert.ok(got && got.cents === Math.round(35000 * pct / 100), 'the sentence is the code: ' + JSON.stringify(got && got.cents));
    assert.equal(db.prepare("SELECT cents FROM pocket WHERE buyer_id=? AND kind='curation' ORDER BY id DESC LIMIT 1").get(nb).cents, 35000 * pct / 100, 'credited to the pocket at the sale');
    db.prepare('DELETE FROM hangs WHERE id=?').run(hid); }

  // 3. A show begins under a working title; the address follows the title.
  r = await form(noor, desk + '/show', { title: 'A show of Mira' }); const sid = +new URL('http://x' + r.headers.get('location')).searchParams.get('show');
  const hang = () => db.prepare('SELECT * FROM hangs WHERE id=?').get(sid); assert.equal(hang().slug, 'a-show-of-mira');
  for (const k of ['a', 'b', 'c', 'd']) { r = await form(noor, `/curate/show/${sid}/toggle`, { work: W[k].slug }, { accept: 'application/json' }); assert.ok((await r.json()).in); }
  await form(noor, `/curate/show/${sid}/title`, { title: 'Out East', line: 'Four from the coast.' });
  assert.equal(hang().slug, 'out-east', 'the address follows the title'); assert.equal(db.prepare("SELECT hang_id FROM hang_was WHERE slug='a-show-of-mira'").get().hang_id, sid);
  r = await go({}, '/hang/a-show-of-mira'); assert.equal(r.status, 404, 'a draft’s old address tells a stranger nothing'); assert.ok(!r.headers.get('location'));
  r = await go(noor, '/hang/a-show-of-mira'); assert.ok(r.status === 302 && r.headers.get('location').endsWith('/hang/out-east'), 'its curator is sent on');

  // 4. A draft: no Share, no public link, and a line that says when there will be one.
  { const pv = await text(noor, `/curate/show/${sid}`);
    assert.ok(!/data-send/.test(pv), 'no Share button on a private preview'); assert.ok(!/class="cu-open"/.test(pv) && !pv.includes('/hang/out-east'), 'no public link on a draft');
    assert.ok(/A private preview: only you and Mira can open this page/.test(pv) && /no public link until Mira approves it/.test(pv), 'the line says so');
    assert.ok(pv.includes('not public yet; Mira is asked by name before it is') && pv.includes('kept back by Mira; it stays private'), 'each unseen photograph says what will happen to it');
    const dk = await text(noor, `${desk}?show=${sid}`); assert.ok(!/data-send/.test(dk) && /it has no public link until it is approved/.test(dk), 'nor on the desk'); }
  r = await form(noor, `/curate/show/${sid}/propose`); assert.equal(hang().review, 'proposed');

  // 5. One press never publishes: the button leads to a page that names each photograph.
  { const list = await text(maker, '/account/curators'); assert.ok(list.includes(`href="/account/shows/${sid}/approve"`) && !list.includes(`action="/account/shows/${sid}/approve"`), 'the button on Curators is a door to the names, not a press');
    const pv = await text(maker, `/curate/show/${sid}`); assert.ok(pv.includes(`href="/account/shows/${sid}/approve"`) && !pv.includes(`action="/account/shows/${sid}/approve"`), 'and on the preview'); }
  r = await form(maker, `/account/shows/${sid}/approve`); assert.ok(r.status === 303 && r.headers.get('location') === `/account/shows/${sid}/approve`, 'a bare press is sent to the names');
  assert.equal(hang().review, 'proposed'); assert.equal(st(W.c.id).status, 'hidden'); assert.equal(hang().public, 0);
  r = await form(maker, `/account/shows/${sid}/approve`, { with: 'all' }); assert.ok(/changed=1/.test(r.headers.get('location')), 'nor a press that names nothing');
  assert.equal(st(W.c.id).status, 'hidden', 'still private');
  let ok = await text(maker, `/account/shows/${sid}/approve`);
  { const out = ok.slice(ok.indexOf('data-cu-out'), ok.indexOf('</ul>', ok.indexOf('data-cu-out'))), kept = ok.slice(ok.indexOf('data-cu-kept'), ok.indexOf('</ul>', ok.indexOf('data-cu-kept')));
    assert.ok(out.includes('The Dunes at Night') && !out.includes('Her Father') && !out.includes('The Pier'), 'the photograph that would be published is named');
    assert.ok(kept.includes('Her Father'), 'the one the maker kept back is named, apart'); assert.ok(/stays private whichever you press/.test(ok));
    assert.ok(/Open the show and publish this photograph/.test(ok) && /Open the show without it \(2 photographs\)/.test(ok), 'both ways are offered, in words that say what each does'); }
  const seenOf = t => /name="seen" value="([^"]*)"/.exec(t)[1];
  // The curator hangs one more unseen photograph after the maker read the page: the old page cannot publish it.
  r = await form(noor, `/curate/show/${sid}/toggle`, { work: W.e.slug }, { accept: 'application/json' }); assert.ok((await r.json()).in);
  r = await form(maker, `/account/shows/${sid}/approve`, { with: 'all', seen: seenOf(ok) }); assert.ok(/changed=1/.test(r.headers.get('location')), 'a photograph hung since is named first');
  assert.equal(st(W.e.id).status, 'hidden'); assert.equal(st(W.c.id).status, 'hidden'); assert.equal(hang().public, 0);
  ok = await text(maker, `/account/shows/${sid}/approve?changed=1`); assert.ok(/The show changed since you last looked/.test(ok) && ok.includes('The Ferry'));
  // Without them: the show opens with what is already public; nothing is published; the curator is told, by name.
  const n0 = (app.locals.mailLog || []).length;
  r = await form(maker, `/account/shows/${sid}/approve`, { with: 'none', seen: seenOf(ok) }); assert.equal(r.status, 303);
  assert.ok(hang().review === 'approved' && hang().public === 1, 'the show opens');
  for (const k of ['c', 'd', 'e']) assert.equal(st(W[k].id).status, 'hidden', `${W[k].title} stays private`);
  assert.equal(st(W.d.id).keep_back, 1);
  assert.deepEqual(db.prepare('SELECT w.title FROM hang_works hw JOIN works w ON w.id=hw.work_id WHERE hw.hang_id=? ORDER BY hw.pos').all(sid).map(x => x.title), ['The Pier', 'Low Tide'], 'what was left out leaves the show');
  { const said = decodeURIComponent(r.headers.get('location')); assert.ok(/Out East is open\./.test(said) && /Left out, still private: The Dunes at Night; Her Father; The Ferry\./.test(said), said); }

  // 2. The letter on approval, with the public link.
  const code = db.prepare("SELECT code FROM buyers WHERE lower(email)='noor@example.com'").get().code; const pub = `/g/${code}/hang/out-east`;
  { const sent = (app.locals.mailLog || []).slice(n0).filter(x => x.to === 'noor@example.com'); assert.equal(sent.length, 1, 'one letter to the curator');
    assert.equal(sent[0].subject, 'Your show is open: Out East'); assert.equal(sent[0].link, 'http://localhost' + pub, 'it carries the public link');
    assert.ok(sent[0].text.includes('http://localhost' + pub) && /Mira opened it without 3 photographs, which stay private: The Dunes at Night; Her Father; The Ferry\./.test(sent[0].text) && sent[0].text.includes(`you earn ${SHARE}, never Mira’s`), sent[0].text);
    const note = db.prepare("SELECT * FROM notices WHERE kind='reviewed' ORDER BY id DESC LIMIT 1").get(); assert.ok(/Left out, still private/.test(note.body), 'the bell says it too'); }
  // 3. The public link where the curator looks; the old address sends a stranger on now that the show is open.
  { const pv = await text(noor, `/curate/show/${sid}`); assert.ok(/class="cu-open"/.test(pv) && pv.includes(`data-copy="http://localhost${pub}"`) && pv.indexOf('cu-open') < pv.indexOf('cu-wall'), 'the link is at the head of the page, with Copy');
    const dk = await text(noor, `${desk}?show=${sid}`); assert.ok(dk.includes(`data-copy="http://localhost${pub}"`), 'and on the desk beside the show');
    r = await go({}, '/hang/a-show-of-mira'); assert.ok(r.status === 302 && r.headers.get('location') === pub, 'the old address sends on: ' + r.headers.get('location'));
    r = await go({}, `/g/${code}/hang/a-show-of-mira`); assert.ok(r.status === 302 && r.headers.get('location') === pub);
    const wall = await text({}, pub); assert.ok(wall.includes('The Pier') && wall.includes('Low Tide') && !wall.includes('The Dunes at Night') && !wall.includes('Her Father'), 'the open show holds only what was approved');
    // 1. The public wall says the same thing about pay.
    const t = plain(wall); assert.ok(t.includes(`Noor earns ${SHARE}, never the maker’s`) && !/Curators are not paid to hang a wall/.test(t), 'the public wall states the share: ' + t.slice(t.indexOf('Thank the eye'), t.indexOf('Thank the eye') + 300));
    for (const k of ['c', 'd', 'e']) { const im = await go({}, `/img/${W[k].slug}/screen`); assert.notEqual(im.status, 200, `${W[k].title} is not served to a stranger`); } }
  // Renamed while open: the address follows again, both old ones arrive; going back to a title takes its address back.
  await form(noor, `/curate/show/${sid}/title`, { title: 'Out East, Again' }); assert.equal(hang().slug, 'out-east-again');
  for (const old of ['a-show-of-mira', 'out-east']) { r = await go({}, '/hang/' + old); assert.ok(r.status === 302 && r.headers.get('location').endsWith('/hang/out-east-again'), old); }
  await form(noor, `/curate/show/${sid}/title`, { title: 'Out East' }); assert.equal(hang().slug, 'out-east'); assert.ok(!db.prepare("SELECT 1 FROM hang_was WHERE slug='out-east'").get());
  r = await go({}, '/hang/out-east'); assert.equal(r.status, 200); r = await go({}, '/hang/out-east-again'); assert.equal(r.status, 302);
  // Another show cannot take an address this one has left.
  r = await form(noor, desk + '/show', { title: 'A show of Mira' }); const sid2 = +new URL('http://x' + r.headers.get('location')).searchParams.get('show');
  assert.equal(db.prepare('SELECT slug FROM hangs WHERE id=?').get(sid2).slug, 'a-show-of-mira-2', 'an address a show has left is not given to another');

  // 5. With them: only what the page named is published, and never the one kept back.
  for (const k of ['a', 'c', 'd']) await form(noor, `/curate/show/${sid2}/toggle`, { work: W[k].slug }, { accept: 'application/json' });
  await form(noor, `/curate/show/${sid2}/propose`);
  ok = await text(maker, `/account/shows/${sid2}/approve`);
  r = await form(maker, `/account/shows/${sid2}/approve`, { with: 'all', seen: seenOf(ok) }); assert.equal(r.status, 303);
  assert.equal(st(W.c.id).status, 'held', 'the named photograph is published'); assert.deepEqual(st(W.d.id), { status: 'hidden', keep_back: 1 }, 'the kept-back one never is');
  assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='work.published' AND subject=?").get(W.c.slug), 'the register says so');
  // A show of nothing but unseen work cannot open without it; a show with nothing unseen opens at one press.
  r = await form(noor, desk + '/show', { title: 'Only the ferry' }); const sid3 = +new URL('http://x' + r.headers.get('location')).searchParams.get('show');
  await form(noor, `/curate/show/${sid3}/toggle`, { work: W.e.slug }, { accept: 'application/json' }); await form(noor, `/curate/show/${sid3}/propose`);
  ok = await text(maker, `/account/shows/${sid3}/approve`); assert.ok(/the show would be empty/.test(ok) && !/value="none"/.test(ok));
  r = await form(maker, `/account/shows/${sid3}/approve`, { with: 'none', seen: seenOf(ok) }); assert.equal(db.prepare('SELECT review FROM hangs WHERE id=?').get(sid3).review, 'proposed', 'an empty show does not open');
  r = await form(noor, desk + '/show', { title: 'Two already seen' }); const sid4 = +new URL('http://x' + r.headers.get('location')).searchParams.get('show');
  for (const k of ['a', 'b']) await form(noor, `/curate/show/${sid4}/toggle`, { work: W[k].slug }, { accept: 'application/json' }); await form(noor, `/curate/show/${sid4}/propose`);
  { const list = await text(maker, '/account/curators'); assert.ok(list.includes(`action="/account/shows/${sid4}/approve"`), 'nothing unseen: one press'); }
  r = await form(maker, `/account/shows/${sid4}/approve`); assert.equal(db.prepare('SELECT public FROM hangs WHERE id=?').get(sid4).public, 1);
  // No door here answers a bare status.
  r = await form({}, `/account/shows/${sid}/approve`); assert.ok(r.status === 303 && /signin/.test(r.headers.get('location')));
  r = await go(maker, '/account/shows/999999/approve'); assert.ok(r.status === 303 && /account\/curators/.test(r.headers.get('location')));
  console.log('curators: ok'); srv.close(); process.exit(0);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
