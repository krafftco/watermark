// Hang your best and child safety (29 Oct): graded work sorted into what hangs now and what wants a look (people,
// children, a doubtful file, a burst twin); kept back is honoured by every publish; a held work is shown to no one;
// the house releases or reports; the doors that open an account ask for eighteen; the kids' corner keeps no one.
process.env.NODE_ENV = 'test'; process.env.HANG_MIN_MP = '1';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { createApp } = require('../src/app');
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const scene = (n, w = 1800, h = 1200) => { let s = ''; seed = n * 7919 + 3; for (let i = 0; i < 90; i++) { const x = rnd() * w, y = rnd() * h, r = 10 + rnd() * 120; s += `<rect x="${x}" y="${y}" width="${r * 1.4}" height="${r}" fill="rgb(${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)})"/>`; } return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#777"/>${s}</svg>`)); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-hang-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'hang', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('hb','Hal Best','hb@example.com','maker',datetime('now'),'house')").run();
  const maker = db.prepare("SELECT * FROM makers WHERE handle='hb'").get();
  const jar = {}; const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const form = (p, b) => go(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
  await form('/studio/login', { password: 'pw' }); await go('/account?maker=hb');
  const put = async (buf, name) => { const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), name); const j = await (await go('/account/works/one', { method: 'POST', body: fd })).json(); assert.ok(j.ok, name + JSON.stringify(j)); return j.slug; };
  const s = {};
  s.clear = await put(await scene(1).jpeg({ quality: 95 }).toBuffer(), 'clear.jpg');
  s.clear2 = await put(await scene(2).jpeg({ quality: 95 }).toBuffer(), 'clear2.jpg');
  s.soft = await put(await scene(3).blur(14).jpeg({ quality: 95 }).toBuffer(), 'soft.jpg');
  s.dark = await put(await scene(4).linear(0.04, 0).jpeg({ quality: 95 }).toBuffer(), 'dark.jpg');
  s.people = await put(await scene(5).jpeg({ quality: 95 }).toBuffer(), 'street.jpg');
  s.kid = await put(await scene(6).jpeg({ quality: 95 }).toBuffer(), 'kid.jpg');
  s.unread = await put(await scene(7).jpeg({ quality: 95 }).toBuffer(), 'unread.jpg');
  s.twin = await put(await scene(1).modulate({ brightness: 1.03 }).jpeg({ quality: 93 }).toBuffer(), 'clear-burst.jpg');
  const read = (people = 0, minors = false) => JSON.stringify({ art: false, people: { recognisable: people, minors, crowd: false }, safety: { nudity: false, sexual: false }, property: {} });
  for (const k of ['clear', 'clear2', 'soft', 'dark', 'twin']) db.prepare('UPDATE works SET stars=4, attribution=? WHERE slug=?').run(read(), s[k]);
  db.prepare('UPDATE works SET stars=4, attribution=? WHERE slug=?').run(read(2), s.people);
  db.prepare('UPDATE works SET stars=5, attribution=? WHERE slug=?').run(read(1, true), s.kid);
  db.prepare('UPDATE works SET stars=4 WHERE slug=?').run(s.unread);
  db.prepare("UPDATE works SET taken_at='2025-05-01T10:00:00', stars=5 WHERE slug=?").run(s.clear); db.prepare("UPDATE works SET taken_at='2025-05-01T10:00:00', stars=4 WHERE slug=?").run(s.twin);
  const p = await app.locals.hangBest.plan(maker, 4);
  const names = k => p[k].map(x => x.w.slug).sort();
  assert.deepStrictEqual(names('clear'), [s.clear, s.clear2].sort(), 'clear: ' + JSON.stringify(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.map(x => x.w.slug + (x.why ? ':' + x.why.join('/') : ''))]))));
  assert.ok(names('check').includes(s.soft) && names('check').includes(s.dark) && names('check').includes(s.twin), 'soft, dark and the burst twin wait for a look');
  assert.deepStrictEqual(names('people'), [s.people]); assert.deepStrictEqual(names('children'), [s.kid]); assert.deepStrictEqual(names('unread'), [s.unread]);
  // The room, then keep the street picture back, then hang the clear and the people group.
  let r = await go('/account/hang?from=4'); let t = await r.text();
  for (let i = 0; i < 40 && /data-hb-wait/.test(t); i++) { await new Promise(z => setTimeout(z, 150)); t = await (await go('/account/hang?from=4')).text(); }
  assert.ok(/Ready to hang · 2/.test(t) && /With people · 1/.test(t) && /book of your work/.test(t), 'the room says it');
  let j = await (await go('/account/hang/keep', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: `slug=${s.people}&on=1` })).json(); assert.ok(j.ok && j.on);
  await form('/account/hang/go', { from: '4', group: 'clear', attest: '1' });
  await form('/account/hang/go', { from: '4', group: 'people', attest: '1' });
  const st = k => db.prepare('SELECT status FROM works WHERE slug=?').get(s[k]).status;
  assert.ok(st('clear') === 'held' && st('clear2') === 'held' && st('people') === 'hidden' && st('soft') === 'hidden', 'clear hung; kept back stays down');
  r = await form('/account/works/batch', { do: 'publish', attest: '1', json: '1', slugs: s.people }); j = await r.json(); assert.ok(/kept back/.test(j.msg) && st('people') === 'hidden', 'batch refuses what is kept back: ' + j.msg);
  await form('/account/hang/go', { from: '4', group: 'check', attest: '1', slugs: s.dark }); assert.ok(st('dark') === 'held' && st('soft') === 'hidden', 'a doubtful one only when tapped in');
  // Child safety: held out of every room, shown to no one, decided by the house.
  const kid = db.prepare('SELECT * FROM works WHERE slug=?').get(s.kid);
  assert.ok(app.locals.safety.quarantine(kid, 'a test'));
  assert.strictEqual(st('kid'), 'quarantined');
  assert.strictEqual((await go(`/img/${s.kid}/thumb?f=jpg`)).status, 404, 'shown to no one, the maker included');
  r = await form('/account/works/batch', { do: 'publish', attest: '1', json: '1', slugs: s.kid }); j = await r.json(); assert.ok(st('kid') === 'quarantined', 'cannot be published');
  t = await (await go('/studio/safety')).text(); assert.ok(/Held for the house/.test(t) && /CyberTipline/.test(t) && !t.includes('look.jpg') && !t.includes('/img/' + s.kid), 'the desk, without the picture');
  const h = db.prepare('SELECT * FROM safety_holds').get();
  await form(`/studio/safety/${h.id}`, { do: 'release', note: 'a beach' }); assert.strictEqual(st('kid'), 'hidden', 'released');
  assert.ok(!(await (await fetch(base + '/ledger')).text()).includes('quarantined'), 'never on the public register');
  // The doors ask for eighteen.
  r = await fetch(base + '/record', { method: 'POST', redirect: 'manual', headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Young&email=y@example.com' });
  assert.ok(/ok=adult/.test(r.headers.get('location')) && !db.prepare("SELECT 1 FROM makers WHERE email='y@example.com'").get(), 'no studio without eighteen');
  assert.ok(/eighteen or older/.test(await (await fetch(base + '/join')).text()));
  // The kids' corner keeps no one.
  await fetch(base + '/kids', { headers: { cookie: 'wm_v=kidvisitor' } }); if (app.locals.analytics && app.locals.analytics.flush) await app.locals.analytics.flush();
  assert.ok(!db.prepare("SELECT 1 FROM hits WHERE path LIKE '/kids%' AND visitor IS NOT NULL").get(), 'counted, never a visitor');
  srv.close(); console.log('hang your best: all good'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
