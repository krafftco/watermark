// Guests add their own photographs to an album (#203; Will, 22 Nov, ANI.31). The issue's "Done means", walked over HTTP
// as each person, then the add step and the album at a phone's width in a real browser (Playwright's Chromium; CHROME=
// a system Chrome):
//   1. a guest opens the album's link, adds three pictures (no password: a name, an email, the sentence they agree to);
//      a video and a file over the size are refused plainly, by name; an address that already opens a studio is asked
//      to sign in first; nothing is shown to anyone (the group, a stranger) before the letter's link is pressed;
//   2. the letter's link (it went only to that address) signs the guest in and opens their own studio with the three
//      pictures in it, private, each "Shared with" the album and said to be a phone copy;
//   3. the photographer sees them "Added by" the guest, shows two and declines one; can neither grade nor show the
//      guest's work as their own;
//   4. the group sees the two, below the photographer's own, credited to the guest, never the declined one; the cover,
//      the film and Wander's walk are still the photographer's; the guests are Wander's own walk; a guest's picture can
//      be hearted and downloaded (the file carries the guest's name), never kept, printed or asked to license;
//   5. a stranger sees none of it, by the page or by the picture's address;
//   6. the album names its photographer (their page once they have one) and the commission door, here and at Wander's end;
//   7. the guest takes one out of the album from their studio: it leaves the album and stays theirs;
//   8. a closed album accepts nothing.
// SHOTS=<dir> keeps screenshots.
process.env.NODE_ENV = 'test';
process.env.GUEST_FILE_MB = '3'; // a small ceiling, so a "film scan" of a few MB is refused here
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
const SHOTS = process.env.SHOTS || '';
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-albumguests-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'albumguests', noTimers: true, vaultNow: true });
  const { db } = app.locals; const CP = app.locals.copies;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const say = (...a) => console.log('albumguests:', ...a);
  const fails = []; const ok = (c, m) => { if (!c) { fails.push(m); console.log('FAIL ' + m); } };
  const noise = (w, h, k) => sharp({ create: { width: w, height: h, channels: 3, noise: { type: 'gaussian', mean: 60 + k * 23, sigma: 50 } } }).jpeg({ quality: 88 }).toBuffer();

  // The photographer and her album: three photographs, a private group door (the link asks a name).
  const studio = {}; await form(studio, '/studio/login', { password: 'pw' });
  await form(studio, '/studio/accounts', { name: 'Ada Lens', email: 'ada@example.com' });
  const invite = (app.locals.mailLog || []).find(m => m.to === 'ada@example.com' && /invitation/i.test(m.subject)); assert.ok(invite, 'the invitation');
  const ada = {}; await go(ada, (invite.text.match(/http:\/\/localhost(\/account\/join\/[\w-]+)/) || [])[1]);
  const M = db.prepare("SELECT * FROM makers WHERE email='ada@example.com'").get(); assert.ok(M && M.joined_at, 'Ada has joined');
  const own = [];
  for (let k = 0; k < 3; k++) { const f = path.join(dir, `ADA_${k}.jpg`); fs.writeFileSync(f, await noise(2400, 1600, k)); const w = await app.locals.registerWork({ file: f, title: `ADA_${k}`, makerId: M.id, originalName: `ADA_${k}.jpg` }); db.prepare("UPDATE works SET taken_at=?, status='hidden' WHERE id=?").run(`2026-11-21T2${k}:00:00.000Z`, w.id); own.push(w.slug); }
  const made = new URLSearchParams(); for (const [k, v] of Object.entries({ title: 'ANI.31', client: 'Ani', door: 'join', days: '30', size: 'original' })) made.append(k, v); own.forEach(s => made.append('works', s));
  let r = await go(ada, '/account/deliveries', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: made.toString() }); assert.equal(r.status, 302, 'the album is made');
  const d = db.prepare('SELECT * FROM deliveries WHERE maker_id=? ORDER BY id DESC LIMIT 1').get(M.id);
  let html = await (await go(ada, `/account/deliveries/${d.id}`)).text();
  ok(/name="r_add" value="1" checked/.test(html), 'the door’s rules carry "Add their own photographs", on by default');
  const sh = db.prepare('SELECT share_token FROM deliveries WHERE id=?').get(d.id).share_token; assert.ok(sh);
  const A = `/a/${sh}`;

  // The group: Ani comes in by the link with her name; Ben too, and he is the guest who adds.
  const ani = {}; r = await form(ani, `${A}/join`, { name: 'Ani Bisaria' }); assert.equal(r.status, 303);
  const ben = {}; r = await form(ben, `${A}/join`, { name: 'Ben Guest' }); assert.equal(r.status, 303);
  html = await (await go(ben, A)).text();
  ok(/href="\/a\/[^"]+\/add"[^>]*>[\s\S]{0,400}Add yours/.test(html) && /Add your photographs/.test(html), 'the album offers the guest "Add yours" and "Add your photographs"');

  // 1. The add step: a name, an email, the sentence, the pictures.
  html = await (await go(ben, `${A}/add`)).text();
  ok(/Add your photographs\./.test(html) && /name="agree"/.test(html) && /Your photographs stay yours/.test(html) && /type="file" name="files"[^>]*multiple/.test(html), 'the add step: name, email, the sentence, many pictures at once');
  ok(!/type="password"/i.test(html), 'no password');
  const send = async (jar, files, fields = {}, json = true) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); for (const f of files) fd.append('files', new Blob([f.buf], { type: f.type || 'image/jpeg' }), f.name); return go(jar, `${A}/add`, { method: 'POST', body: fd, headers: json ? { accept: 'application/json' } : {} }); };
  const who = { name: 'Ben Guest', email: 'ben@example.com', agree: '1' };
  // Refused plainly: without the sentence; a video; a file over the ceiling (3 MB here); an address with a studio.
  let j = await (await send(ben, [{ name: 'a.jpg', buf: await noise(800, 600, 1) }], { name: 'Ben Guest', email: 'ben@example.com' })).json();
  ok(j.stop && j.why === 'agree' && /Tick the line/.test(j.say), 'without the sentence ticked, asked plainly: ' + JSON.stringify(j));
  j = await (await send(ben, [{ name: 'party.mov', buf: Buffer.alloc(2048, 1), type: 'video/quicktime' }], who)).json();
  ok(j.kept === 0 && j.why === 'video' && /video cannot be added/.test(j.say), 'a video is refused plainly: ' + JSON.stringify(j));
  const big = await sharp({ create: { width: 3000, height: 2200, channels: 3, noise: { type: 'gaussian', mean: 120, sigma: 90 } } }).jpeg({ quality: 100 }).toBuffer(); assert.ok(big.length > 3 * 1024 * 1024, 'the big file is over 3 MB: ' + big.length);
  r = await send(ben, [{ name: 'SCAN_0001.jpg', buf: big }], who, false); ok(r.status === 303 && /why=big/.test(r.headers.get('location') || ''), 'a file over the ceiling: back to the page, by name');
  html = await (await go(ben, r.headers.get('location'))).text(); ok(/larger than an album takes \(3 MB\)/.test(html), 'the page says why, in words');
  j = await (await send({ ...ben }, [{ name: 'a.jpg', buf: await noise(800, 600, 2) }], { name: 'Ada', email: 'ada@example.com', agree: '1' })).json();
  ok(j.stop && j.why === 'known', 'an address that opens a proven studio must sign in first: ' + JSON.stringify(j));
  // Three pictures, one a request, as the page's own script sends them.
  const added = []; let key = '';
  for (let k = 0; k < 3; k++) { j = await (await send(ben, [{ name: `IMG_10${k}.jpg`, buf: await noise(1600, 1200, 5 + k) }], key ? { g: key } : who)).json(); ok(j.ok && j.kept === 1, `picture ${k + 1} kept: ` + JSON.stringify(j)); key = j.g || key; }
  const B = db.prepare("SELECT * FROM makers WHERE email='ben@example.com'").get();
  ok(B && Number(B.email_ok) === 0 && B.door === 'album', 'a studio of his own, unproven until the letter');
  const gws = db.prepare("SELECT w.slug, w.status, w.maker_id FROM delivery_guest_works g JOIN works w ON w.id=g.work_id WHERE g.delivery_id=? ORDER BY w.id").all(d.id);
  ok(gws.length === 3 && gws.every(w => w.status === 'hidden' && w.maker_id === B.id), 'three works of Ben’s own, private');
  gws.forEach(w => added.push(w.slug));
  const masters = db.prepare(`SELECT original_file, sha256 FROM works WHERE slug IN (${added.map(() => '?').join(',')})`).all(...added); ok(masters.every(x => x.sha256), 'each fingerprinted as it arrived');
  // Before the letter is pressed: shown to no one.
  html = await (await go(ani, A)).text(); ok(!added.some(s => html.includes(s)), 'the group sees none before the email is confirmed');
  html = await (await go(ada, `/account/deliveries/${d.id}`)).text(); ok(/3 more wait for the sender to confirm their email/.test(html) && !added.some(s => html.includes(`/img/${s}/`)), 'the photographer: three wait for the sender, no picture yet');
  for (const s of added) { r = await go(ani, `/img/${s}/thumb`); ok(r.status === 404, `the group cannot open ${s} by its address before: ${r.status}`); }
  for (const s of added) { r = await go({}, `/img/${s}/thumb`); ok(r.status === 404, `a stranger cannot open ${s} by its address: ${r.status}`); }
  say('1. a guest adds three; a video, a large file and a known address are refused in words; nothing is shown before the letter');

  // 2. The letter, only to that address; its link opens his studio.
  const letters = (app.locals.mailLog || []).filter(m => m.to === 'ben@example.com'); ok(letters.length === 1, 'one letter, however many pictures: ' + letters.length);
  const link = (letters[0].text.match(/http:\/\/localhost(\/added\/[\w-]+)/) || [])[1]; assert.ok(link, 'the letter carries the link');
  const phone = {}; r = await go(phone, link); ok(r.status === 302 && /^\/account\?ok=/.test(r.headers.get('location') || ''), 'the link lands in his studio');
  ok(Number(db.prepare('SELECT email_ok FROM makers WHERE id=?').get(B.id).email_ok) === 1, 'the address is proven');
  html = await (await go(phone, r.headers.get('location'))).text();
  ok(/Your photographs are in your studio, private and yours/.test(html), 'his studio says so');
  ok(added.every(s => html.includes(`id="w-${s}"`)), 'his three pictures are in his studio');
  ok((html.match(/Shared with ANI\.31, waiting for Ada/g) || []).length === 3, 'each marked "Shared with ANI.31", waiting for Ada');
  ok((html.match(/A phone copy · Shared with/g) || []).length === 3, 'each said to be a phone copy');
  say('2. the letter’s link signs him in; his studio holds the three, private, each "Shared with ANI.31"');

  // 3. The photographer shows two and declines one.
  html = await (await go(ada, `/account/deliveries/${d.id}`)).text();
  ok(/Added by Ben Guest/.test(html) && added.every(s => html.includes(`data-gad-slug="${s}"`)) && /Show all 3/.test(html), 'the photographer sees "Added by Ben Guest", three, Show all');
  for (const s of added) { r = await go(ada, `/img/${s}/thumb`); ok(r.status === 200, `the photographer sees ${s} to decide: ${r.status}`); }
  r = await form(ada, `/account/deliveries/${d.id}/guests`, { work: added[0], act: 'yes' }); ok(r.status === 302, 'show one');
  r = await form(ada, `/account/deliveries/${d.id}/guests`, { work: added[1], act: 'yes' }); ok(r.status === 302, 'show two');
  r = await form(ada, `/account/deliveries/${d.id}/guests`, { work: added[2], act: 'no' }); ok(r.status === 302, 'decline one');
  const states = db.prepare('SELECT w.slug, g.state, g.ref FROM delivery_guest_works g JOIN works w ON w.id=g.work_id WHERE g.delivery_id=?').all(d.id);
  ok(states.filter(x => x.state === 'in').length === 2 && states.find(x => x.slug === added[2]).state === 'no', 'two shown, one not: ' + JSON.stringify(states.map(x => x.state)));
  const lic = db.prepare('SELECT l.*, u.maker_id AS umaker FROM licenses l JOIN uses u ON u.id=l.use_id WHERE l.ref=?').get(states.find(x => x.slug === added[0]).ref);
  ok(lic && lic.umaker === B.id && lic.status === 'active' && !lic.price_cents, 'shown under Ben’s own use, no price (never licensed as Ada’s)');
  r = await form(ada, `/account/works/${added[0]}/stars`, { n: '5' }); ok(r.status === 404, 'the photographer cannot grade a guest’s work: ' + r.status);
  r = await form(ada, `/account/works/${added[0]}/show`, { attest: '1' }); ok(r.status === 404, 'nor hang it: ' + r.status);
  ok(db.prepare('SELECT status FROM works WHERE slug=?').get(added[0]).status === 'hidden', 'still private, still Ben’s');
  say('3. the photographer shows two and declines one; she cannot grade or hang them');

  // 4. The group sees the two, below Ada's own, credited to Ben.
  html = await (await go(ani, A)).text();
  const gi = html.indexOf('id="guests"'); const guestPart = html.slice(gi, html.indexOf('</section>', gi));
  ok(html.indexOf('id="guests"') > html.indexOf(`data-dv-slug="${own[0]}"`), 'the guests’ part comes after the photographer’s pictures');
  ok(guestPart.includes(`data-dv-slug="${added[0]}"`) && guestPart.includes(`data-dv-slug="${added[1]}"`) && !html.includes(added[2]), 'the group sees the two shown, never the declined one');
  ok((guestPart.match(/<span class="gad-by">Ben<\/span>/g) || []).length === 2 && /From Ben <span>2<\/span>/.test(guestPart), 'each credited "Ben", in his own part');
  ok(/From the guests/.test(guestPart), 'the part is "From the guests"');
  const film = JSON.parse(html.match(/window\.__DV=(\{.*?\});<\/script>/)[1].replace(/\\u003c/g, '<')).list.map(x => x.s);
  ok(JSON.stringify(film) === JSON.stringify(own), 'the film plays the photographer’s own only');
  ok(!guestPart.includes('/print') && !guestPart.includes('data-dv-keep') && !guestPart.includes('/ask"'), 'no Print, Keep or license on a guest’s picture');
  let wj = await (await go(ani, `/api/stroll?in=album:${sh}&n=8`)).json(); ok(wj.items.every(x => own.includes(x.slug)), 'Wander’s walk of the album is the photographer’s');
  wj = await (await go(ani, `/api/stroll?in=album:${sh}.guests&n=8`)).json(); ok(wj.items.length === 2 && wj.items.every(x => added.includes(x.slug)), 'the guests are their own walk: ' + wj.items.map(x => x.slug).join(','));
  html = await (await go(ani, `/wander?in=album:${sh}.guests`)).text(); ok(r = /"title":"From the guests · ANI\.31"/.test(html), 'Wander’s guests walk is named for them');
  html = await (await go(ani, `/wander?in=album:${sh}`)).text(); const al = JSON.parse(html.match(/window\.__WM_STROLL=(\{.*?\});<\/script>/)[1].replace(/\\u003c/g, '<')).set.album;
  ok(al.guests && /\.guests/.test(al.guests) && /\/add$/.test(al.add || ''), 'Wander from the album leads to the guests and to Add your photographs');
  for (const s of added.slice(0, 2)) { r = await go(ani, `/img/${s}/thumb`); ok(r.status === 200, `the group opens ${s}: ${r.status}`); }
  r = await go(ani, `/img/${added[2]}/thumb`); ok(r.status === 404, 'the declined one stays Ben’s: ' + r.status);
  j = await (await go(ani, `${A}/${added[0]}/heart`, { method: 'POST', headers: { accept: 'application/json' } })).json(); ok(j.ok && j.on, 'a guest’s picture can be hearted');
  r = await go(ani, `${A}/${added[0]}/file`); const file = Buffer.from(await r.arrayBuffer());
  ok(r.status === 200 && /image\/jpeg/.test(r.headers.get('content-type') || ''), 'and downloaded: ' + r.status);
  ok(file.includes(Buffer.from('Ben Guest')) && !file.includes(Buffer.from('Ada Lens')), 'the file carries Ben’s name, not Ada’s');
  r = await form(ani, `${A}/${added[0]}/keep`, { email: 'ani@example.com' }); ok(r.status === 404, 'never kept from the album: ' + r.status);
  r = await go(ani, `${A}/${added[0]}/ask`); ok(r.status === 404, 'never asked to license from the album: ' + r.status);
  say('4. the group sees two, below Ada’s, credited to Ben; their own walk; hearted and downloaded with his name; no print, keep or licence');

  // 5. A stranger: the door, no picture; not by the address either.
  html = await (await go({}, A)).text(); ok(!added.some(s => html.includes(s)) && !own.some(s => html.includes(s)), 'a stranger sees the door, no picture');
  for (const s of added) { r = await go({}, `/img/${s}/thumb`); ok(r.status === 404, `a stranger cannot open ${s}: ${r.status}`); }
  wj = await go({}, `/api/stroll?in=album:${sh}.guests&n=8`); ok(!(await wj.text()).includes(added[0]), 'nor through Wander');
  say('5. a stranger sees none');

  // 6. The photographer named, with the commission door; her page once she has one.
  html = await (await go(ani, A)).text();
  ok(/<p class="dv-by">Photographs by Ada Lens <a class="dv-ask" href="\/commission\?to=ada-lens">Ask Ada to photograph your night<\/a><\/p>/.test(html), 'the line: Photographs by Ada Lens (no page yet), Ask Ada to photograph your night');
  ok(al.by && al.by.name === 'Ada Lens' && al.by.href === null && /^\/commission\?to=/.test(al.by.ask), 'Wander’s end carries the same');
  db.prepare("UPDATE works SET status='held' WHERE slug=?").run(own[0]);
  html = await (await go(ani, A)).text(); ok(/Photographs by <a href="\/m\/[\w-]+">Ada Lens<\/a>/.test(html), 'with a public page, her name links to it');
  r = await go(ani, '/commission?to=ada-lens'); ok(r.status === 200, 'the commission door opens: ' + r.status);
  say('6. "Photographs by Ada Lens" and "Ask Ada to photograph your night" on the album and at Wander’s end');

  // 7. Ben takes one out from his studio; it stays his.
  r = await form(phone, '/account/shared/out', { work: added[1], album: String(d.id) }); ok(r.status === 302, 'Ben takes one out');
  html = await (await go(ani, A)).text(); ok(!html.includes(added[1]) && html.includes(added[0]), 'it leaves the album');
  r = await go(ani, `/img/${added[1]}/thumb`); ok(r.status === 404, 'and the group no longer opens it');
  html = await (await go(phone, '/account')).text(); ok(html.includes(`id="w-${added[1]}"`) && db.prepare('SELECT maker_id FROM works WHERE slug=?').get(added[1]).maker_id === B.id, 'it stays in his studio');
  ok(db.prepare("SELECT l.ends_at FROM licenses l WHERE l.ref=?").get(states.find(x => x.slug === added[1]).ref).ends_at < new Date().toISOString(), 'its showing in the album ended');
  say('7. Ben takes one out: it leaves the album and stays in his studio');

  // A phone, 390 wide: the add step and the album's guests part fit, and their controls are large enough to press.
  let browser = null;
  try { const { chromium } = require('playwright'); browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : fs.existsSync('/usr/bin/google-chrome') ? { channel: 'chrome' } : {}); } catch (e) { browser = null; }
  if (browser) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const cookies = Object.entries(ben).map(([name, value]) => ({ name, value, url: base }));
    await ctx.addCookies(cookies); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    for (const [where, sel] of [[`${A}/add`, '.gad-f input[name=name], .gad-f input[name=email], .gad-ok, .gad-pick .buy-btn, .gad-go .buy-btn, .gad-back a'], [`${A}#guests`, '.gad-add .buy-btn, .gad-s .dvh-b, .dv-by a']]) {
      await p.goto(base + where, { waitUntil: 'load' });
      const wide = await p.evaluate(() => document.documentElement.scrollWidth); ok(wide <= 390, `${where}: no wider than the phone (${wide})`);
      const small = await p.$$eval(sel, els => els.map(e => { const b = e.getBoundingClientRect(); return { c: e.className || e.name || e.tagName, w: Math.round(b.width), h: Math.round(b.height) }; }).filter(b => b.w && (b.h < 44 && b.c !== 'dvh-b')));
      ok(!small.length, `${where}: every control at least 44 px tall: ` + JSON.stringify(small));
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `guests-${where.includes('add') ? 'add' : 'album'}-390.png`), fullPage: true }); }
    }
    ok(!errs.length, 'no script errors: ' + errs.join(' | '));
    await browser.close(); say('a phone, 390 wide: the add step and the guests’ part fit, every control large enough');
  } else say('no browser here: the 390 walk was not run');

  // 8. A closed album accepts nothing.
  await form(ada, `/account/deliveries/${d.id}/close`, {});
  r = await go(ben, `${A}/add`); ok(r.status === 410 && /takes nothing more/.test(await r.text()), 'a closed album: the add step says it is closed: ' + r.status);
  j = await (await send(ben, [{ name: 'late.jpg', buf: await noise(800, 600, 9) }], { g: key })).json(); ok(j.stop && j.why === 'closed', 'and takes nothing: ' + JSON.stringify(j));
  ok(db.prepare('SELECT COUNT(*) n FROM delivery_guest_works WHERE delivery_id=?').get(d.id).n === 3, 'nothing more was kept');
  say('8. a closed album accepts nothing');

  srv.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
  if (fails.length) { console.log(`albumguests: ${fails.length} failed`); process.exit(1); }
  console.log('albumguests: all held'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
