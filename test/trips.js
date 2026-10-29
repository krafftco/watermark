// The trip (29 Oct): a place played as it was shot; held-back frames a wash of colour; hide and unhide in one tap;
// a kept-back picture is shown to no one but the maker and the house.
process.env.NODE_ENV = 'test'; process.env.TRIP_MIN = '3';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-trip-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'trip', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('tr','Tess Road','tr@example.com','maker',datetime('now'),'house')").run();
  const jar = {}; const go = (p, o = {}, j = jar) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); j[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' }); await go('/account?maker=tr');
  const put = async n => { const buf = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 30 * n, g: 120, b: 200 - 20 * n } } }).jpeg().toBuffer(); const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), `m${n}.jpg`); const j = await (await go('/account/works/one', { method: 'POST', body: fd })).json(); assert.ok(j.ok, JSON.stringify(j)); return j.slug; };
  const s = []; for (let n = 1; n <= 5; n++) s.push(await put(n));
  const times = ['2026-05-14 09:00:00', '2026-05-14 09:05:00', '2026-05-14 18:30:00', '2026-05-15 08:10:00', '2026-05-15 08:20:00'];
  s.forEach((slug, i) => db.prepare("UPDATE works SET place='Milan, Italy', taken_at=?, status=? , keep_back=? WHERE slug=?").run(times[i], i === 2 ? 'hidden' : 'held', i === 2 ? 1 : 0, slug));
  db.prepare('UPDATE works SET in_trip=0 WHERE slug=?').run(s[4]);
  const tl = app.locals.trips.list(db.prepare("SELECT * FROM makers WHERE handle='tr'").get());
  assert.ok(tl.length === 1 && tl[0].n === 4 && tl[0].held === 1 && tl[0].slug === 'milan-italy', JSON.stringify(tl));
  // A stranger: the film, the held frame as a wash, the left-out frame absent, cards between days.
  const st = {};
  let t = await (await go('/trip/tr/milan-italy', {}, st)).text();
  const data = JSON.parse(t.match(/window.__WM_TRIP=(\{.*?\})<\/script>/)[1]);
  const fr = data.seq.filter(x => !x.card); const cards = data.seq.filter(x => x.card).map(x => x.card);
  assert.deepStrictEqual(fr.map(x => x.slug), s.slice(0, 4), 'in the order taken, the left-out frame absent');
  assert.ok(!fr[2].shown && !fr[2].open && fr[0].open, 'the held frame stays closed to a stranger');
  assert.ok(cards.some(c => /That evening/.test(c)) && cards.some(c => /The next morning/.test(c)), 'the cards: ' + cards.join(' | '));
  assert.ok(/held back by the photographer/.test(t), 'said on the door');
  assert.strictEqual((await go(`/img/${s[2]}/large`, {}, st)).status, 404, 'a kept-back picture to no one else');
  const held = await go(`/img/${s[2]}/held`, {}, st); assert.strictEqual(held.status, 200); const hm = await sharp(Buffer.from(await held.arrayBuffer())).metadata(); assert.ok(hm.width === 900, 'a wash');
  assert.strictEqual((await go(`/img/${s[4]}/held`, {}, st)).status, 404, 'a frame out of the trip has no wash either');
  assert.strictEqual((await go(`/trip/work/${s[2]}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'show=1' }, st)).status, 403, 'a stranger cannot unhide');
  // The maker: every frame open; unhide the held one, hide another.
  t = await (await go('/trip/tr/milan-italy')).text(); const own = JSON.parse(t.match(/window.__WM_TRIP=(\{.*?\})<\/script>/)[1]);
  assert.ok(own.mine && own.seq.filter(x => !x.card).every(x => x.open), 'the maker sees all');
  assert.strictEqual((await go(`/img/${s[2]}/thumb`)).status, 200, 'the maker sees their own kept-back picture');
  let j = await (await go(`/trip/work/${s[2]}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'show=1' })).json(); assert.ok(j.ok && j.shown);
  j = await (await go(`/trip/work/${s[0]}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'show=0' })).json(); assert.ok(j.ok && !j.shown);
  const row = sl => db.prepare('SELECT status, keep_back FROM works WHERE slug=?').get(sl);
  assert.deepStrictEqual([row(s[2]), row(s[0])], [{ status: 'held', keep_back: 0 }, { status: 'hidden', keep_back: 1 }]);
  t = await (await go('/m/tr')).text(); assert.ok(/Trips/.test(t) && /\/trip\/tr\/milan-italy/.test(t), 'the maker page offers the trip');
  srv.close(); console.log('trips: all hold'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
