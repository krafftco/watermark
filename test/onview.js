// On view at (#166): a living maker's object, where it can be seen, and the gallery's way to buy when it represents it.
process.env.NODE_ENV = 'test';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os'); const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ovw-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'ovw', noTimers: true, vaultNow: true, prepared: true });
  const { db } = app.locals; const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const go = (p, o = {}, j) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of r.headers.getSetCookie()) j[c.split('=')[0]] = c.split('=')[1].split(';')[0]; return r; });
  const form = b => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  const page = async (p, j = {}, h = {}) => (await go(p, { headers: h }, j)).text();
  const me = {}; await go('/studio/login', form({ password: 'pw' }), me);
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('ph','Pia Hart','ph@example.com','maker',datetime('now'),'house')").run();
  const mid = db.prepare("SELECT id FROM makers WHERE handle='ph'").get().id;
  db.prepare('INSERT INTO uses (maker_id,key,name,description,term_months,kind,sort,price_cents) SELECT ?,key,name,description,term_months,kind,sort,price_cents FROM uses WHERE maker_id=(SELECT MIN(id) FROM makers)').run(mid);
  await go('/account?maker=ph', {}, me);
  const put = async n => { const buf = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: { r: 40 * n, g: 90, b: 120 } } }).jpeg().toBuffer(); const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), `s${n}.jpg`); const j = await (await go('/account/works/one', { method: 'POST', body: fd }, me)).json(); return j.slug; };
  const a = await put(1), b = await put(2), c = await put(3), d = await put(4), e = await put(5), f = await put(6), g = await put(7);
  db.prepare("UPDATE works SET status='held', width=6000, height=7500 WHERE maker_id=?").run(mid);
  const W = s => db.prepare('SELECT * FROM works WHERE slug=?').get(s);
  const year = new Date().getUTCFullYear(); const later = `${year + 1}-03-14`, past = `${year - 1}-02-01`, pastEnd = `${year - 1}-04-30`;
  const OV = app.locals.onview;
  // The stranger sees the house's Collect on a work before any line is stated.
  let t = await page(`/w/${b}`); assert.ok(/action="\/buy\//.test(t), 'before: the house sells it');

  // 1. One work: the fields, stored once, by the maker on the work's own desk; the line on the work page with the link.
  let r = await go(`/account/works/${a}/onview`, form({ do: 'save', venue: 'Galerie Nord', street: '12 Hudson Street', city: 'New York', country: 'United States', url: 'https://galerie-nord.example', enquire: 'sales@galerie-nord.example', opens_on: `${year - 1}-01-01`, until_on: later, afterwards: 'history' }), me);
  assert.ok(/ov=ok-1/.test(r.headers.get('location')), 'saved for one work: ' + r.headers.get('location'));
  const s1 = db.prepare('SELECT * FROM onview_places').get(); assert.ok(s1 && s1.country === 'United States' && s1.stated_by === 'maker' && Number(s1.represents) === 0, 'the fields');
  t = await page(`/w/${a}`, {}, { 'accept-language': 'en-GB' });
  assert.ok(t.includes('On view at <a href="https://galerie-nord.example"') && t.includes('12 Hudson Street, New York, United States') && t.includes(`datetime="${later}"`), 'the line, with the venue link and the date');
  assert.ok(/Stated by the maker\./.test(t) && /\/claim\?kind=venue/.test(t), 'who stated it, and the door to correct it');
  assert.ok(!/in partnership with|represented by/i.test(t.replace(/Represented by <a href="\/m\//g, '')), 'never a partnership or a representation not ticked');
  assert.ok(/action="\/buy\//.test(t), 'not represented: the house still sells it');
  // Dates in the visitor's style: a German visitor reads März.
  t = await page(`/w/${a}`, {}, { 'accept-language': 'de-DE,de;q=0.9' }); assert.ok(/14\. März/.test(t), 'the date in the visitor\'s language');
  // The desk shows the place again.
  t = await page(`/account/works/${a}`, me); assert.ok(/Where it can be seen/.test(t) && /Galerie Nord/.test(t), 'the field on the desk');

  // 2. A whole hang at once, reusing the same place; a represented work (outside the United States).
  db.prepare("INSERT INTO buyers (customer, email, name, code, public) VALUES ('', 'ph@example.com', 'Pia Hart', 'phcode', 1)").run();
  const bid = db.prepare("SELECT id FROM buyers WHERE code='phcode'").get().id;
  db.prepare("INSERT INTO hangs (buyer_id, slug, title, public) VALUES (?, 'rooms', 'Rooms', 1)").run(bid); const hid = db.prepare("SELECT id FROM hangs WHERE slug='rooms'").get().id;
  [b, c].forEach((s, i) => db.prepare('INSERT INTO hang_works (hang_id, work_id, pos) VALUES (?,?,?)').run(hid, W(s).id, i));
  r = await go(`/account/works/${b}/onview`, form({ do: 'save', venue: 'Galerie Lumen', street: '8 rue de Seine', city: 'Paris', country: 'France', url: 'https://lumen.example', enquire: 'https://lumen.example/enquire', until_on: later, represents: '1', afterwards: 'history', hang: String(hid) }), me);
  assert.ok(/ov=ok-2/.test(r.headers.get('location')), 'saved for the whole hang: ' + r.headers.get('location'));
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM onview_works sw JOIN onview_places s ON s.id=sw.showing_id WHERE s.venue=?').get('Galerie Lumen').n, 2, 'both works of the hang, one place');
  // 3. Represented: the way to buy is the gallery's; the house's Collect is not beside it, nor a licence or prints (default off).
  t = await page(`/w/${c}`);
  assert.ok(t.includes('On view at <a href="https://lumen.example"') && t.includes('8 rue de Seine, Paris, France'), 'the line abroad');
  assert.ok(t.includes('href="https://lumen.example/enquire"') && t.includes('Enquire with Galerie Lumen') && /Galerie Lumen represents this work/.test(t), 'enquire with the gallery');
  assert.ok(!/action="\/buy\//.test(t) && !/data-collect-now/.test(t), 'no Collect from the house beside it');
  assert.ok(!/href="\/license\/[^"]+\?use=/.test(t), 'no licence offered (default off)');
  r = await go(`/buy/${c}`, form({ use: 'social' }), {}); assert.ok(r.status === 302 && !/stripe|checkout/i.test(r.headers.get('location') || ''), 'the buy door refuses it too');
  r = await go(`/license/${c}`, {}, {}); assert.ok(r.status === 302, 'nothing to license: back to the page');
  assert.ok(OV.blocks(W(c), 'social') && OV.blocks(W(c), 'print') && OV.blocks(W(c), 'editorial'), 'the gate');
  // The maker keeps a licence: offered under "Also from the house"; Collect still not.
  await go(`/account/works/${c}/onview`, form({ do: 'save', place: String(db.prepare("SELECT id FROM onview_places WHERE venue='Galerie Lumen'").get().id), venue: 'Galerie Lumen', street: '8 rue de Seine', city: 'Paris', country: 'France', url: 'https://lumen.example', enquire: 'https://lumen.example/enquire', until_on: later, represents: '1', licence: '1', afterwards: 'history' }), me);
  t = await page(`/w/${c}`); assert.ok(/Also from the house/.test(t) && /href="\/license\/[^"]+\?use=editorial/.test(t) && !/action="\/buy\//.test(t), 'a licence kept, Collect not');
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM onview_places WHERE venue='Galerie Lumen'").get().n, 1, 'stored once, reused');
  // 4. The maker's page and Wander's plate.
  t = await page('/m/ph'); assert.ok(/Where the work can be seen/.test(t) && /Galerie Lumen/.test(t) && /Galerie Nord/.test(t) && /Stated by the maker/.test(t), 'the maker\'s page');
  t = JSON.stringify(Object.values(JSON.parse(await page(`/stroll/side/${c}`))).join(' ')); t = JSON.parse(t); assert.ok(/ovw-wk/.test(t) && /On view at <a href="https:\/\/lumen.example"/.test(t) && /Enquire with Galerie Lumen/.test(t), 'Wander\'s plate: ' + t.slice(0, 200));
  // The register names the work (so a kept copy of the page is remade), privately.
  assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='onview.stated' AND subject=?").get(c), 'the register names the work');

  // 5. After the last date: history, or gone (and gone gives the house's own sale back).
  db.prepare("UPDATE onview_places SET opens_on=?, until_on=? WHERE venue='Galerie Nord'").run(past, pastEnd);
  t = await page(`/w/${a}`); assert.ok(new RegExp(`Shown at <a href="https://galerie-nord.example"[^>]*>Galerie Nord</a>, New York, United States, ${year - 1}\\.`).test(t), 'history');
  db.prepare("UPDATE onview_places SET afterwards='gone' WHERE venue='Galerie Nord'").run();
  t = await page(`/w/${a}`); assert.ok(!/Galerie Nord/.test(t) && !/class="ovw"/.test(t), 'gone');
  db.prepare("UPDATE onview_places SET until_on=?, afterwards='gone' WHERE venue='Galerie Lumen'").run(pastEnd);
  t = await page(`/w/${b}`); assert.ok(!/Galerie Lumen/.test(t) && /action="\/buy\//.test(t), 'past and gone: the house sells it again');
  db.prepare("UPDATE onview_places SET until_on=?, afterwards='history' WHERE venue='Galerie Lumen'").run(later);

  // 6. The gallery asks through the claim door (no sale paused); the Studio removes the line at once.
  t = await page(`/w/${c}/claim?kind=venue`); assert.ok(/value="venue" checked/.test(t) && /No sale is paused/.test(t), 'the door, preset');
  r = await go(`/w/${c}/claim`, form({ kind: 'venue', name: 'Lumen desk', email: 'desk@lumen.example', body: 'We no longer represent this work; please take the line off.', oath: '1' }), {});
  assert.strictEqual(r.status, 200); assert.strictEqual(Number(W(c).disputed), 0, 'no sale paused');
  const did = db.prepare("SELECT id FROM disputes WHERE kind='venue'").get().id;
  r = await go(`/studio/claims/${did}/decide`, form({ outcome: 'uphold' }), me);
  assert.strictEqual(W(c).status, 'held', 'upheld: the work stays up'); t = await page(`/w/${c}`); assert.ok(!/Galerie Lumen/.test(t), 'the line is off');
  // The Studio removes a place from every work, from the Studio's desk.
  t = await page(`/studio/works/${b}`, me); assert.ok(/Remove this place from every work/.test(t), 'the Studio\'s button');
  r = await go(`/studio/works/${b}/onview`, form({ do: 'remove' }), me); assert.ok(/ov=ok-removed/.test(r.headers.get('location')));
  t = await page(`/w/${b}`); assert.ok(!/Galerie Lumen/.test(t) && /action="\/buy\//.test(t), 'removed: gone from the page, the house sells again');
  // The Studio states a line: said as Watermark's.
  await go(`/studio/works/${d}/onview`, form({ do: 'save', venue: 'Haus am See', city: 'Zürich', country: 'Switzerland', afterwards: 'history' }), me);
  t = await page(`/w/${d}`); assert.ok(/On view at Haus am See, Zürich, Switzerland\./.test(t) && /Stated by Watermark\./.test(t), 'the Studio\'s line');
  // 7. A stranger cannot state one; a represented work needs a way to enquire; bad dates are told.
  r = await go(`/account/works/${d}/onview`, form({ do: 'save', venue: 'X', city: 'Y', country: 'Z' }), {}); assert.ok(/signin/.test(r.headers.get('location')), 'only its maker');
  r = await go(`/account/works/${d}/onview`, form({ do: 'save', venue: 'Somewhere', city: 'Oslo', country: 'Norway', represents: '1' }), me); assert.ok(/ov=how/.test(r.headers.get('location')), 'represented needs a way to enquire');
  r = await go(`/account/works/${d}/onview`, form({ do: 'save', venue: 'Somewhere', city: 'Oslo', country: 'Norway', opens_on: later, until_on: past }), me); assert.ok(/ov=dates/.test(r.headers.get('location')), 'dates');
  t = await page(`/account/works/${d}?ov=how`, me); assert.ok(/A represented work needs a way to enquire/.test(t), 'told in words');

  // 8. Prepared copies (#139): a stranger's copy of a work's page follows the line on the worker's next round, and a copy
  // made before the change is never served after it (it is told at once, as when the picture copies are told).
  { const P = app.locals.prepared; assert.ok(P && P.round, 'prepared copies are on in this house');
    const now = () => Math.floor(Date.now() / 1000);
    for (const s of [e, f, g]) db.prepare("INSERT INTO hits (at, path, kind, status, ms, visitor, bot) VALUES (?, ?, 'page', 200, 5, 'v1', 0)").run(now(), '/w/' + s);
    const turn = async (o = {}) => { await P.round(o); await P.sync(); await P.sync(); };
    const stranger = async s => { const r = await fetch(base + '/w/' + s); return { copy: r.headers.get('x-prepared') !== null, body: await r.text() }; };
    await turn({ all: true });
    let x = await stranger(e); assert.ok(x.copy && !/class="ovw"/.test(x.body) && /action="\/buy\//.test(x.body), 'a copy, before any line, selling as the house');
    // 1. The line, after one round.
    await go(`/account/works/${e}/onview`, form({ do: 'save', venue: 'Galerie Est', street: '3 Bowery', city: 'New York', country: 'United States', url: 'https://est.example', enquire: 'desk@est.example', until_on: later, afterwards: 'history' }), me);
    x = await stranger(e); assert.ok(!x.copy || /Galerie Est/.test(x.body), 'between the write and the round: never the old copy');
    await turn(); x = await stranger(e); assert.ok(x.copy && /On view at <a href="https:\/\/est.example"/.test(x.body), 'the copy carries the line after one round');
    // 2. Represented: no stale copy goes on offering Collect; after one round the copy enquires with the gallery.
    const pid = db.prepare("SELECT id FROM onview_places WHERE venue='Galerie Est'").get().id;
    await go(`/account/works/${e}/onview`, form({ do: 'save', place: String(pid), venue: 'Galerie Est', street: '3 Bowery', city: 'New York', country: 'United States', url: 'https://est.example', enquire: 'desk@est.example', until_on: later, represents: '1', afterwards: 'history' }), me);
    x = await stranger(e); assert.ok(!/action="\/buy\//.test(x.body) && !/data-collect-now/.test(x.body), 'before the round: no Collect from any copy');
    await turn(); x = await stranger(e); assert.ok(x.copy && !/action="\/buy\//.test(x.body) && !/data-collect-now/.test(x.body) && /Enquire with Galerie Est/.test(x.body), 'the copy enquires, no Collect');
    // 3. Removed by the Studio: the copy loses the line after one round.
    await go(`/studio/works/${e}/onview`, form({ do: 'remove' }), me);
    x = await stranger(e); assert.ok(!/Galerie Est/.test(x.body), 'before the round: the line is not served');
    await turn(); x = await stranger(e); assert.ok(x.copy && !/Galerie Est/.test(x.body) && /action="\/buy\//.test(x.body), 'the copy without the line, the house selling again');
    // 4. A whole hang at once: each work named, each copy remade.
    db.prepare("INSERT INTO hangs (buyer_id, slug, title, public) VALUES (?, 'rooms-two', 'Rooms Two', 1)").run(bid); const h2 = db.prepare("SELECT id FROM hangs WHERE slug='rooms-two'").get().id;
    [f, g].forEach((s, i) => db.prepare('INSERT INTO hang_works (hang_id, work_id, pos) VALUES (?,?,?)').run(h2, W(s).id, i));
    for (const s of [f, g]) { x = await stranger(s); assert.ok(x.copy && /action="\/buy\//.test(x.body), 'copies before'); }
    await go(`/account/works/${f}/onview`, form({ do: 'save', venue: 'Galerie West', city: 'Berlin', country: 'Germany', url: 'https://west.example', until_on: later, represents: '1', afterwards: 'history', hang: String(h2) }), me);
    for (const s of [f, g]) assert.ok(db.prepare("SELECT 1 FROM ledger WHERE type='onview.stated' AND subject=?").get(s), 'the register names ' + s);
    await turn();
    for (const s of [f, g]) { x = await stranger(s); assert.ok(x.copy && /Enquire with Galerie West/.test(x.body) && !/action="\/buy\//.test(x.body), 'each copy of the hang, after one round: ' + s); }
  }

  console.log('onview: all hold'); srv.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
