// A photographer's first ten minutes (#223), the parts a request can prove: the way from the studio to a work's own desk,
// titles kept as typed, the used invitation's way on, first steps ticking on publish alone, and the words on the vault's
// page and the Library's publish sheet. (The print room refused from a small master is in test/firstsale.js; the sheet
// at a phone's width, the raw file named and the folder were walked in a browser: see the pull request.)
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { titleCase } = require('../src/titles');
const { createApp } = require('../src/app');
(async () => {
  // Titles: a word that opens with a figure is the maker's, as typed; the rest is set as before.
  assert.equal(titleCase('81st street, 5am'), '81st Street, 5am'); assert.equal(titleCase('35mm on the ferry'), '35mm on the Ferry');
  assert.equal(titleCase('the dome of the pantheon'), 'The Dome of the Pantheon'); assert.equal(titleCase('late-afternoon light'), 'Late-Afternoon Light'); assert.equal(titleCase('(untitled) no. 4'), '(Untitled) No. 4');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-firstminutes-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'firstminutes', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (jar, p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (jar, p, body) => go(jar, p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const page = async (jar, p) => { const r = await go(jar, p); assert.equal(r.status, 200, `${p} answers 200, not ${r.status}`); return r.text(); };

  const studio = {}; await form(studio, '/studio/login', { password: 'pw' }); await form(studio, '/studio/accounts', { name: 'Roland Avery', email: 'roland@example.com' });
  const invite = (app.locals.mailLog || []).find(m => m.to === 'roland@example.com'); const link = (invite.text.match(/http:\/\/localhost(\/account\/join\/[\w-]+)/) || [])[1]; assert.ok(link, 'the invitation carries its link');
  const roland = {}; await go(roland, link);
  const M = db.prepare("SELECT * FROM makers WHERE email='roland@example.com'").get(); assert.ok(M && M.joined_at, 'Roland has joined');

  // The invitation opened again on a second device: said plainly, with a way on.
  let r = await go({}, link); let html = await r.text();
  assert.ok(/This link has been used\./.test(html) && /<a class="buy-btn" href="\/signin\?next=\/account">Sign in with your email<\/a>/.test(html), 'a used invitation offers "Sign in with your email"');
  assert.equal((await go({}, '/signin?next=/account')).status, 200, 'and that door opens');

  // One work in, private.
  const f = path.join(dir, 'IMG_0001.jpg'); fs.writeFileSync(f, await sharp({ create: { width: 4000, height: 3000, channels: 3, noise: { type: 'gaussian', mean: 90, sigma: 50 } } }).jpeg({ quality: 70 }).toBuffer());
  const w = await app.locals.registerWork({ file: f, title: '81st street, 5am', makerId: M.id, originalName: 'IMG_0001.jpg' }); db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(w.id);
  assert.equal(db.prepare('SELECT title FROM works WHERE id=?').get(w.id).title, '81st Street, 5am', 'the title is held as typed where it opens with a figure');

  // First steps: 1 of 3 with the work in; publishing alone ticks the second (no stars asked).
  html = await page(roland, '/account'); assert.ok(/First steps &middot; 1 of 3/.test(html), 'one step done with a work in');
  assert.ok(html.includes(`<b><a href="/account/works/${w.slug}"`), 'the holdings title opens the work’s own desk');
  r = await form(roland, `/account/works/${w.slug}/show`, { attest: '1' }); assert.equal(db.prepare('SELECT status FROM works WHERE id=?').get(w.id).status, 'held', 'published');
  html = await page(roland, '/account'); assert.ok(/First steps &middot; 2 of 3/.test(html), 'publishing ticks "Your best in front" with no grade given');

  // The public page: its maker is offered the desk; a stranger is not.
  html = await page(roland, `/w/${w.slug}`); assert.ok(html.includes(`<a href="/account/works/${w.slug}">Edit this work</a>`), 'the maker sees "Edit this work" on the public page');
  html = await page({}, `/w/${w.slug}`); assert.ok(!/Edit this work/.test(html) && !html.includes('/account/works/'), 'a stranger does not');
  assert.equal((await go(roland, `/account/works/${w.slug}`)).status, 200, 'and the desk opens for its maker');

  // The Library: the loupe's link is the desk; the sheet says what a press without the tick means; the line says where Publish is.
  db.prepare("UPDATE works SET status='hidden' WHERE id=?").run(w.id);
  html = await page(roland, '/account/table'); assert.ok(/data-lib-attest-say[^>]*hidden>Tick the box first\.</.test(html) && /<span data-lib-sel>Select what to publish<\/span>/.test(html) && /data-lib-lopen href="#">Edit this work</.test(html), 'the Library’s words');
  assert.ok(/<label><input type="checkbox" data-lib-attest-cb[^>]*><span>These are mine/.test(html), 'the attestation is one run of text beside its box');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'table.js'), 'utf8'); assert.ok(!/href = '\/w\/'/.test(js) && /lopen\]'\)\.href = '\/account\/works\/'/.test(js), 'the loupe opens the desk');
  new Function(js); // the Library's script parses whole (a `//` at the end of one of its long lines swallows the rest)

  // The vault's page: a folder can be chosen; a raw file is named; nothing promises what cannot be done.
  html = await page(roland, '/account/upload'); assert.ok(/id="aFolder" webkitdirectory/.test(html) && !/a folder&rsquo;s worth/.test(html) && /was left out: it is a raw file\. Export it from your edit as a full-size JPEG or TIFF/.test(html) && /Under 12 MP: held/.test(html), 'the vault’s page');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => /aFiles/.test(s)); assert.equal(inline.length, 1); new Function('return async function(){' + inline[0] + '}'); // and its script parses

  srv.close(); console.log('firstminutes: ok'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
