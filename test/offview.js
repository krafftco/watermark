// A photographer's work not on view (#198): an upload lands 'hidden'; its pictures, its page and the doors beneath them
// reach only its maker, the Studio, a curator with keys, a holder of a live licence on it, and the people of an album
// that holds it. An album's own link travels with each picture it shows (?token=), so 'Anyone with the link' keeps
// working for everyone who has it, without a cookie; behind 'The group' and 'By invitation' only the people inside see.
// A stranger meets the house's own not-found sign (a picture its plain 404); every off-view answer is private, no-store.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-198-offview-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'offview', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  let ip = 10; // each person signs in from an address of their own (the sign-in limiter counts by address)
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, 'x-forwarded-for': jar.__ip || '10.0.0.1', cookie: Object.entries(jar).filter(([k]) => k !== '__ip').map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const person = () => ({ __ip: `10.0.${++ip}.1` });
  const signin = async (jar, email) => { app.locals.lastCode = null; await form(jar, '/signin/code', { email }); assert.ok(app.locals.lastCode, 'a code for ' + email); await form(jar, '/signin/verify', { email, code: app.locals.lastCode.code }); };
  const NAV = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' };
  const IMG = { 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image', accept: 'image/avif,image/webp,image/*' };
  const priv = r => /private/.test(r.headers.get('cache-control') || '') && /no-store/.test(r.headers.get('cache-control') || '');
  let checks = 0;
  // A picture: who may see it gets it, privately; anyone else a plain 404, privately.
  const pic = async (jar, p, ok, who) => { const r = await go(jar, p, { headers: IMG }); await r.arrayBuffer(); checks++;
    if (ok) { assert.equal(r.status, 200, `${who}: ${p} answers 200, not ${r.status}`); assert.ok(priv(r), `${who}: ${p} is private, no-store (${r.headers.get('cache-control')})`); }
    else { assert.equal(r.status, 404, `${who}: ${p} answers 404, not ${r.status}`); assert.ok(priv(r), `${who}: the refusal of ${p} is private, no-store`); } };
  // A page: a stranger meets the house's own sign, never a bare status (the work's own page leads on to Wander, as a
  // photograph taken down always has: smoke, 'See the watermark'); the others are let through.
  const pageOf = async (jar, p, ok, who) => { const r = await go(jar, p, { headers: NAV }); const t = await r.text(); checks++;
    assert.ok(priv(r), `${who}: ${p} is private, no-store (${r.headers.get('cache-control')})`);
    if (ok) { assert.notEqual(r.status, 404, `${who}: ${p} is let through (${r.status})`); assert.ok(!/class="nf"/.test(t), `${who}: ${p} is not the sign`); }
    else if (/^\/(w\/[^/?]+|m\/[^/]+\/[^/?]+)(\?|$)/.test(p)) { assert.equal(r.status, 302, `${who}: ${p}, the page itself, leads on (${r.status})`); assert.ok(/^\/wander/.test(r.headers.get('location') || ''), `${who}: on to Wander: ${r.headers.get('location')}`); assert.ok(!/class="nf"/.test(t) && !t.includes('Just arrived') && !t.includes('/img/'), `${who}: nothing of it is shown`); }
    else { assert.equal(r.status, 404, `${who}: ${p} answers 404 (${r.status})`); assert.ok(/class="nf"/.test(t) && /<html/i.test(t), `${who}: ${p} is the house's own sign, not a bare status`); }
    return t; };
  const say = (...a) => console.log('offview:', ...a);

  // 1. A photographer, her pictures (one on view, the rest not), and the people around them.
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  await form(studio, '/studio/accounts', { name: 'Ada Lens', email: 'ada@example.com' });
  const invite = (app.locals.mailLog || []).find(m => m.to === 'ada@example.com' && /invitation/i.test(m.subject)); assert.ok(invite, 'the invitation');
  const ada = {}; await go(ada, (invite.text.match(/http:\/\/localhost(\/account\/join\/[\w-]+)/) || [])[1]);
  const M = db.prepare("SELECT * FROM makers WHERE email='ada@example.com'").get(); assert.ok(M && M.joined_at, 'Ada has joined');
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const work = async (title, status) => { const f = path.join(dir, `ov-${++k}.jpg`); fs.writeFileSync(f, await sharp(fx).rotate(90 * (k % 4)).modulate({ hue: 40 * k }).negate({ alpha: k % 2 === 0 }).greyscale(k > 4).jpeg().toBuffer()); const w = await app.locals.registerWork({ file: f, title, makerId: M.id, place: 'Dallas', originalName: path.basename(f) }); db.prepare('UPDATE works SET status=?, keep_back=0 WHERE slug=?').run(status, w.slug); return db.prepare('SELECT * FROM works WHERE slug=?').get(w.slug); };
  const onView = await work('On the wall', 'held'), upload = await work('Just arrived', 'hidden'), inLink = await work('For the link', 'hidden'), inJoin = await work('For the group', 'hidden'), inInv = await work('By invitation', 'hidden');
  const kept = await work('Kept back', 'held'); db.prepare('UPDATE works SET keep_back=1 WHERE id=?').run(kept.id);
  const stranger = person();
  // a curator with keys to Ada's archive
  const cur = person(); await signin(cur, 'cur@example.com'); const curB = db.prepare("SELECT id FROM buyers WHERE email='cur@example.com'").get();
  db.prepare("INSERT INTO curators (maker_id, email, name, buyer_id, token, status) VALUES (?, 'cur@example.com', 'Cur', ?, 'cur-token-198', 'on')").run(M.id, curB.id);
  // a holder of a live licence on the upload, and one whose licence has ended
  const hold = person(); await signin(hold, 'hold@example.com'); const holdB = db.prepare("SELECT id FROM buyers WHERE email='hold@example.com'").get();
  const past = person(); await signin(past, 'past@example.com'); const pastB = db.prepare("SELECT id FROM buyers WHERE email='past@example.com'").get();
  const use = db.prepare('SELECT id FROM uses WHERE maker_id=? ORDER BY id LIMIT 1').get(M.id); assert.ok(use, 'a use');
  const lic = (b, ref, ends) => db.prepare("INSERT INTO licenses (ref, work_id, use_id, licensee_name, licensee_email, status, buyer_id, starts_at, ends_at) VALUES (?, ?, ?, 'H', 'h@example.com', 'active', ?, datetime('now'), ?)").run(ref, upload.id, use.id, b.id, ends);
  lic(holdB, 'WM-198-0001', null); lic(pastB, 'WM-198-0002', new Date(Date.now() - 864e5).toISOString());
  say('1. Ada, six pictures (one on view, one kept back, four not on view), a curator, a holder and a past holder');

  // 2. The picture route and the work page, for each viewer of a work that is simply not on view yet.
  { const r = await go(stranger, `/img/${onView.slug}/thumb`, { headers: IMG }); await r.arrayBuffer(); assert.equal(r.status, 200); assert.ok(/public/.test(r.headers.get('cache-control')), 'a picture on view is public as before'); }
  for (const size of ['thumb', 'screen', 'large', 'wall']) await pic(stranger, `/img/${upload.slug}/${size}`, false, 'stranger');
  await pic(ada, `/img/${upload.slug}/large`, true, 'maker'); await pic(studio, `/img/${upload.slug}/large`, true, 'Studio');
  await pic(cur, `/img/${upload.slug}/large`, true, 'curator'); await pic(hold, `/img/${upload.slug}/large`, true, 'holder');
  await pic(past, `/img/${upload.slug}/large`, false, 'a holder whose licence ended');
  await pic(stranger, `/img/${upload.slug.toUpperCase()}/thumb`, false, 'stranger, another case');
  await pic(stranger, `/img/${kept.slug}/thumb`, false, 'stranger, kept back'); await pic(ada, `/img/${kept.slug}/thumb`, true, 'maker, kept back');
  await pageOf(stranger, `/w/${upload.slug}`, false, 'stranger'); await pageOf(stranger, `/m/${M.handle}/${upload.slug}`, false, 'stranger');
  await pageOf(stranger, `/w/${upload.slug}/life`, false, 'stranger, a door under the page'); await pageOf(stranger, `/license/${upload.slug}`, false, 'stranger, its licence page');
  for (const sub of ['life', 'deed', 'object', 'frame', 'claim', 'post.jpg', 'placard.jpg', 'badge.svg', 'credential']) { const r = await go(stranger, `/w/${upload.slug}/${sub}`, { headers: NAV }); await r.text(); assert.equal(r.status, 404, `stranger: /w/…/${sub} is not found (${r.status})`); assert.ok(priv(r), `/w/…/${sub} private`); checks++; }
  for (const p of [`/api/work/${upload.slug}`, `/license/${upload.slug}`, `/buy/${upload.slug}`, `/iiif/${upload.slug}/info.json`]) { const r = await go(stranger, p); await r.text(); assert.equal(r.status, 404, `stranger: ${p} is not found (${r.status})`); checks++; }
  await pageOf(stranger, `/w/${kept.slug}`, false, 'stranger, kept back but held');
  for (const sl of [upload.slug, 'no-such-work-198']) { const r = await go(stranger, `/easel/${sl}`, { headers: NAV }); await r.text(); assert.equal(r.status, 302, `the easel: ${sl} answers as a work it does not have`); assert.equal(r.headers.get('location'), '/wander'); }
  await pageOf(ada, `/w/${upload.slug}`, true, 'maker'); await pageOf(studio, `/w/${upload.slug}`, true, 'Studio');
  await pageOf(cur, `/w/${upload.slug}`, true, 'curator'); await pageOf(hold, `/w/${upload.slug}`, true, 'holder');
  await pageOf(past, `/w/${upload.slug}`, false, 'a holder whose licence ended');
  { const r = await go(stranger, '/w/no-such-work-198', { headers: NAV }); assert.equal(r.status, 404); assert.ok(/class="nf"/.test(await r.text()), 'an unknown address is the same sign'); }
  { const t = await (await go(ada, `/easel/${upload.slug}`)).text(); assert.ok(t.includes(`/img/${upload.slug}/large`), 'the maker studies her own upload'); }
  { const t = await (await go(stranger, `/wander?at=${upload.slug}`)).text(); assert.ok(!t.includes(upload.slug), 'Wander does not open on a stranger’s view of it'); }
  // A showing given on purpose stays public: the cover Ada chose for one of her public books.
  { const cov = await work('A cover', 'hidden'); await pic(stranger, `/img/${cov.slug}/thumb`, false, 'stranger, before it is a cover');
    db.prepare("INSERT INTO texts (slug, kind, title, author, maker_id, public, cover_work_id, status) VALUES ('ada-book-198', 'essay', 'A book', 'Ada Lens', ?, 1, ?, 'held')").run(M.id, cov.id);
    const r = await go(stranger, `/img/${cov.slug}/thumb`, { headers: IMG }); await r.arrayBuffer(); assert.equal(r.status, 200, 'a public book’s cover shows to anyone'); }
  say(`2. not on view: picture and page for stranger, maker, Studio, curator, holder, past holder (${checks} checks)`);

  // 3. The three doors. An album per door, each holding one picture not on view; the client gets the link.
  const album = async (title, slug, door) => {
    const body = new URLSearchParams([['title', title], ['client', 'Rachel'], ['days', '30'], ['size', 'original'], ['door', door], ['works', slug]]);
    const r = await go(ada, '/account/deliveries', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }); await r.text();
    const d = db.prepare('SELECT * FROM deliveries WHERE title=?').get(title); assert.ok(d, 'album ' + title); assert.equal(d.door, door);
    const client = person(); const t = await (await go(client, `/deliver/${d.token}`)).text(); // the client's own link
    return { d: db.prepare('SELECT * FROM deliveries WHERE id=?').get(d.id), client, page: t };
  };
  const imgsOf = (html, slug) => [...html.matchAll(/\/img\/([\w.~%-]+)\/(thumb|screen|large|wall)(\?token=[\w%-]+)?/g)].filter(m => m[1] === slug).map(m => m[0]);
  const L = await album('The link', inLink.slug, 'link'), J = await album('The group', inJoin.slug, 'join'), N = await album('Invited', inInv.slug, 'invited');
  for (const [A, w] of [[L, inLink], [J, inJoin], [N, inInv]]) {
    const srcs = imgsOf(A.page, w.slug); assert.ok(srcs.length >= 2, `${A.d.door}: the client's page shows the picture (${srcs.length})`);
    assert.ok(srcs.every(s => s.endsWith('?token=' + encodeURIComponent(A.d.token))), `${A.d.door}: every picture on the client's page carries its link: ${srcs.join(' ')}`);
    for (const s of new Set(srcs)) await pic(person(), s, true, `${A.d.door}: anyone holding the client's link, no cookie`);
    await pic(A.client, `/img/${w.slug}/large`, A.d.door !== 'link', `${A.d.door}: the client without the link on the picture`); // behind a private door the client is a member (its cookie); the open door keeps no cookie
    await pic(stranger, `/img/${w.slug}/large`, false, `${A.d.door}: stranger`); await pic(stranger, `/img/${w.slug}/large?token=${A === L ? J.d.token : L.d.token}`, false, `${A.d.door}: another album's link`);
    await pic(ada, `/img/${w.slug}/large`, true, `${A.d.door}: maker`); await pic(studio, `/img/${w.slug}/large`, true, `${A.d.door}: Studio`); await pic(cur, `/img/${w.slug}/large`, true, `${A.d.door}: curator`);
    await pageOf(stranger, `/w/${w.slug}`, false, `${A.d.door}: stranger's work page`);
    await pageOf(person(), `/w/${w.slug}?token=${A.d.token}`, true, `${A.d.door}: the work page with the client's link`);
  }
  // The passed-on link (/a/<share>): the open door shows to anyone who has it; a private door shows its door, no picture.
  const sharePage = async (jar, A) => go(jar, `/a/${A.d.share_token}`).then(r => r.text());
  { const anyone = person(); const t = await sharePage(anyone, L); const srcs = imgsOf(t, inLink.slug); assert.ok(srcs.length && srcs.every(s => s.endsWith('?token=' + L.d.share_token)), 'link: the passed-on page carries its own link, never the client’s: ' + srcs.join(' '));
    assert.ok(!t.includes(L.d.token), 'link: the client’s token is never on the passed-on page');
    for (const s of new Set(srcs)) await pic(person(), s, true, 'link: anyone with the passed-on link');
    await pic(anyone, `/img/${inLink.slug}/large`, false, 'link: the passed-on page’s visitor, without the link on the picture'); }
  for (const [A, w] of [[J, inJoin], [N, inInv]]) {
    const anyone = person(); const t = await sharePage(anyone, A); assert.equal(imgsOf(t, w.slug).length, 0, `${A.d.door}: the door shows no picture to a stranger with the link`);
    await pic(anyone, `/img/${w.slug}/large?token=${A.d.share_token}`, false, `${A.d.door}: a stranger with the passed-on link`);
    { const r = await go(anyone, `/a/${A.d.share_token}/card.jpg`, { headers: IMG }); await r.arrayBuffer(); assert.equal(r.status, 404, `${A.d.door}: the album's card is not shown at the door`); }
  }
  { const r = await go(person(), `/a/${L.d.share_token}/card.jpg`, { headers: IMG }); await r.arrayBuffer(); assert.equal(r.status, 200, 'link: the album card shows'); assert.ok(priv(r), 'the album card is private, no-store'); }
  // The group: a name and you are in; then the pictures, by cookie and by the link they carry.
  { const g = person(); await sharePage(g, J); const r = await form(g, `/a/${J.d.share_token}/join`, { name: 'Grace' }); assert.equal(r.status, 303);
    const t = await sharePage(g, J); const srcs = imgsOf(t, inJoin.slug); assert.ok(srcs.length, 'join: a member sees the picture');
    for (const s of new Set(srcs)) await pic(g, s, true, 'join: a member, by the page'); await pic(g, `/img/${inJoin.slug}/thumb`, true, 'join: a member, by her cookie');
    await pic(g, `/img/${inLink.slug}/thumb`, false, 'join: a member of one album, another album’s picture'); }
  // By invitation: the maker invites; the person's own link lets them in.
  { const r = await form(ada, `/account/deliveries/${N.d.id}/members`, { name: 'Ivy', email: 'ivy@example.com' }); const made = decodeURIComponent((r.headers.get('location') || '').match(/made=([^&#]+)/)[1]);
    const iv = person(); await go(iv, `/in/${made}`); const t = await sharePage(iv, N); const srcs = imgsOf(t, inInv.slug); assert.ok(srcs.length, 'invited: the person invited sees the picture');
    for (const s of new Set(srcs)) await pic(iv, s, true, 'invited: by the page'); await pic(iv, `/img/${inInv.slug}/thumb`, true, 'invited: by her cookie');
    const asker = person(); await sharePage(asker, N); await form(asker, `/a/${N.d.share_token}/join`, { name: 'Ask', email: 'ask@example.com' }); await pic(asker, `/img/${inInv.slug}/thumb?token=${N.d.share_token}`, false, 'invited: one who asked and is not yet let in'); }
  say('3. the three doors: client link, passed-on link, member by cookie and by page, stranger, another album');

  // 4. Wander and the easel in an album carry its link; outside the album they open nothing.
  for (const [A, w, key] of [[L, inLink, `delivery:${L.d.token}`], [L, inLink, `album:${L.d.share_token}`]]) {
    const j = await (await go(person(), `/api/stroll?in=${encodeURIComponent(key)}`)).json().catch(() => null);
    const t = await (await go(person(), `/wander?in=${encodeURIComponent(key)}&at=${w.slug}`)).text();
    const srcs = imgsOf(t, w.slug); assert.ok(srcs.length, `Wander ${key.split(':')[0]}: the picture is there`); assert.ok(srcs.every(s => s.includes('?token=')), `Wander ${key.split(':')[0]}: every picture carries the link: ${srcs.join(' ')}`);
    for (const s of new Set(srcs)) await pic(person(), s, true, `Wander ${key.split(':')[0]}: anyone with the link`);
    if (j && j.items) assert.ok(j.items.every(x => !x.img || /\?token=/.test(x.img)), 'Wander’s feed carries the link');
    const study = (t.match(/data-st-easel href="([^"]+)"/) || [])[1]; assert.ok(study && /token=/.test(study), 'Wander’s Study carries the link: ' + study);
    const ez = await (await go(person(), study.replace(/&amp;/g, '&'))).text(); assert.ok(imgsOf(ez, w.slug).every(s => s.includes('?token=')) && imgsOf(ez, w.slug).length, 'the easel’s pictures carry the link');
  }
  { const t = await (await go(person(), `/wander?in=${encodeURIComponent('delivery:' + L.d.token)}&at=${upload.slug}`)).text(); assert.ok(!t.includes(upload.slug), 'an album’s Wander does not open on a picture it does not hold'); }
  { const r = await go(person(), `/easel/${inJoin.slug}?token=${J.d.share_token}`, { headers: NAV }); await r.text(); assert.equal(r.status, 302, 'the easel behind a private door, for a stranger with the passed-on link'); }
  say('4. Wander and the easel carry the album’s link');

  // 5. A closed album lets no one in by its link.
  { const r = await form(ada, `/account/deliveries/${L.d.id}/close`, {}); await r.text(); const d = db.prepare('SELECT status FROM deliveries WHERE id=?').get(L.d.id);
    if (d.status !== 'closed') { app.locals.deliveries.close(L.d); }
    await pic(person(), `/img/${inLink.slug}/large?token=${L.d.token}`, false, 'closed: the client’s link'); await pic(person(), `/img/${inLink.slug}/large?token=${L.d.share_token}`, false, 'closed: the passed-on link'); }
  // 6. The picture moves on view: public again for everyone, as it was.
  db.prepare("UPDATE works SET status='held' WHERE id=?").run(upload.id);
  { const r = await go(stranger, `/img/${upload.slug}/thumb`, { headers: IMG }); await r.arrayBuffer(); assert.equal(r.status, 200, 'hung: the stranger sees it'); assert.ok(/public/.test(r.headers.get('cache-control')), 'hung: public again'); }
  say(`5–6. closed albums let no one in; a work hung is public again (${checks} checks)`);

  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok: offview');
  process.exit(0);
})().catch(e => { console.error('offview FAILED:', e && e.stack || e); process.exit(1); });
