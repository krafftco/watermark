// Companies (3 Nov): a company as a maker; its page in rooms; the designer named; others' art and portraits wait for its word; others' art never sold.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-co-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'co', noTimers: true, vaultNow: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [k, v] = c.split(';')[0].split('='); jar[k] = v; } return r; });
  const form = (p, body) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  await form('/studio/login', { password: 'pw' });
  await form('/studio/accounts', { name: 'Kronberg Werke', kind: 'company', invite: '0' });
  const co = db.prepare("SELECT * FROM makers WHERE name='Kronberg Werke'").get(); assert.equal(co.kind, 'company', 'a company account');
  await go(`/account?maker=${co.handle}`);
  const fx = path.join(__dirname, 'fixture.jpg'); let k = 0;
  const put = async (title, extra = {}) => { const f = path.join(dir, `c-${++k}.jpg`); fs.writeFileSync(f, await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: (k * 53) % 255, g: (k * 97) % 255, b: (k * 31) % 255 } } }).composite([{ input: await sharp(fx).resize(300 + k * 60).toBuffer(), left: k * 60, top: k * 40 }]).jpeg().toBuffer()); const w = await app.locals.registerWork({ file: f, title, makerId: co.id, originalName: path.basename(f), ...extra }); assert.ok(w && w.slug, title); db.prepare("UPDATE works SET status='hidden' WHERE slug=?").run(w.slug); return w.slug; }; // a company's vault brings work in kept back
  const radio = await put('A pocket radio', { kind: 'design' }); const line = await put('The line at night'); const press = await put('The 1962 press'); const face = await put('Margarete, thirty-one years on the line'); const painting = await put('A painting in the boardroom', { kind: 'painting' });
  // The record: the designer, the year, the room.
  await form(`/account/works/${radio}/object`, { kind: 'design', designer: 'Dieter Rams', made: '1958, Kronberg' });
  for (const [s, room] of [[line, 'making'], [press, 'machines'], [face, 'people']]) await form(`/account/works/${s}/company`, { room });
  const a = app.locals.art.ensure('Gerhard Richter', { born: 1932 }); db.prepare('UPDATE works SET artist_id=? WHERE slug=?').run(a.id, painting);
  let t = await (await go(`/account/works/${painting}`)).text(); assert.ok(t.includes("On the company's page") && t.includes('We hold the right to show it'), 'the record asks the company for its word on others’ art');
  // Publishing: the portrait and the painting wait for the company's word; the rest hang.
  const r = await (await form('/account/works/batch', { slugs: [radio, line, press, face, painting].join(','), do: 'publish', attest: '1', json: '1' })).json();
  const st = s => db.prepare('SELECT status FROM works WHERE slug=?').get(s).status;
  assert.ok([radio, line, press].every(s => st(s) === 'held'), 'the products, the making and the machines hang: ' + JSON.stringify(r));
  assert.ok(st(face) !== 'held' && st(painting) !== 'held', 'the portrait and the painting wait');
  t = await (await go('/account/company')).text(); assert.ok(t.includes('Waiting for your word') && t.includes('Margarete') && t.includes('the right to show it online'), 'the desk lists what waits');
  await form(`/account/works/${face}/company`, { room: 'people', show_ok: '1' }); await form(`/account/works/${painting}/company`, { room: 'collection', show_ok: '1' });
  await form('/account/works/batch', { slugs: [face, painting].join(','), do: 'publish', attest: '1', json: '1' });
  assert.ok(st(face) === 'held' && st(painting) === 'held', 'with the word given, they hang');
  await form('/account/company', { founded: '1921' });
  // The page: the rooms, the designer, the history by decade; no patrons' wall.
  t = await (await fetch(base + '/m/' + co.handle)).text();
  for (const s of ['The products', 'The making', 'The machines', 'The people', 'The collection', 'Dieter Rams', 'since 1921', 'Company']) assert.ok(t.includes(s), 'the page has ' + s);
  assert.ok(!t.includes('pat-wall'), 'no patrons’ wall on a company');
  t = await (await fetch(base + '/w/' + radio)).text(); assert.ok(t.includes('Designed by Dieter Rams for Kronberg Werke'), 'the design is credited to its designer');
  // Others' art is shown, never sold: no Collect, no licence.
  const w = db.prepare('SELECT * FROM works WHERE slug=?').get(painting); assert.ok(app.locals.companies.closed(w), 'closed');
  t = await (await fetch(base + '/w/' + painting)).text(); assert.ok(!/data-share/.test(t), 'no Collect on another artist’s work kept by a company');
  // The index.
  t = await (await fetch(base + '/companies')).text(); assert.ok(t.includes('Companies are makers too.') && t.includes('Kronberg Werke') && t.includes('Open your archive.'), 'the index and the offer');
  srv.close(); console.log('companies: all hold');
})().catch(e => { console.error(e); process.exit(1); });
