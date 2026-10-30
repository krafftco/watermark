// The contact sheet (30 Oct): frames shot one after another in one place; the chosen one circled; outtakes a wash until
// the maker opens the sheet; a frame held back never shows; the maker circles another; Wander carries a cut.
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const sharp = require('sharp');
const { createApp } = require('../src/app');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sheet-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'sheet', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('cs','Cora Sheet','cs@example.com','maker',datetime('now'),'house')").run();
  const go = (p, o = {}, j) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, cookie: Object.entries(j || {}).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { if (j) for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); j[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  const me = {}; await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' }, me); await go('/account?maker=cs', {}, me);
  const s = [];
  for (let n = 1; n <= 7; n++) { const buf = await sharp({ create: { width: n === 3 ? 800 : 1200, height: n === 3 ? 1200 : 800, channels: 3, background: { r: 30 * n, g: 100, b: 220 - 25 * n } } }).jpeg().toBuffer(); const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), `c${n}.jpg`); const j = await (await go('/account/works/one', { method: 'POST', body: fd }, me)).json(); assert.ok(j.ok, JSON.stringify(j)); s.push(j.slug); }
  // Six frames in four minutes on the Ponte Vecchio; the seventh two hours later is another sheet's (and alone).
  const t = i => (i < 6 ? `2026-05-14 19:0${i}:00` : '2026-05-14 21:30:00');
  s.forEach((slug, i) => db.prepare("UPDATE works SET place='Florence, Italy', taken_at=?, status=?, keep_back=?, stars=? WHERE slug=?").run(t(i), [1, 4].includes(i) ? 'held' : 'hidden', i === 5 ? 1 : 0, i === 4 ? 5 : 3, slug));
  const SH = app.locals.sheets; SH.forget(db.prepare("SELECT id FROM makers WHERE handle='cs'").get().id);
  const m = db.prepare("SELECT * FROM makers WHERE handle='cs'").get();
  const ls = SH.list(m); assert.strictEqual(ls.length, 1, 'one sheet'); assert.strictEqual(ls[0].frames.length, 6); assert.strictEqual(ls[0].pick.slug, s[4], 'the five-star frame on view is circled');
  assert.ok(SH.of({ slug: s[0], maker_id: m.id }), 'an outtake belongs to it'); assert.strictEqual(SH.of({ slug: s[6], maker_id: m.id }), null, 'the lone frame is on no sheet');
  // A stranger: closed, so outtakes are a wash; the frames on view true; the held-back frame a wash; one loop.
  let h = await (await go(`/sheet/${s[0]}`)).text();
  let d = JSON.parse(h.match(/window.__WM_SHEET=(\{.*?\})<\/script>/)[1]);
  assert.strictEqual(d.frames.length, 6); assert.ok(d.frames[4].pick && d.frames[4].open && d.frames[1].open, 'on view: true');
  assert.ok(!d.frames[0].open && /\/sheet\/wash\//.test(d.frames[0].img), 'a closed outtake: a wash'); assert.ok(!d.frames[5].open, 'held back: a wash');
  assert.strictEqual((h.match(/class="ctc-loop"/g) || []).length, 1, 'one frame circled'); assert.ok(/class="ctc-tick"/.test(h), 'the other on view ticked'); assert.ok(/ctc-pt/.test(h), 'the upright frame lies on its side, as on film');
  assert.strictEqual((await go(`/sheet/wash/${s[5]}`)).status, 200);
  assert.strictEqual((await go(`/sheet/${s[0]}/open`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'on=1' })).status, 403, 'a stranger cannot open it');
  // The maker opens it: outtakes show true to everyone; the held-back frame never.
  assert.strictEqual((await go(`/sheet/${s[0]}/open`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'on=1' }, me)).status, 303);
  d = JSON.parse((await (await go(`/sheet/${s[0]}`)).text()).match(/window.__WM_SHEET=(\{.*?\})<\/script>/)[1]);
  assert.ok(d.frames[0].open && d.frames[0].out && !d.frames[5].open, 'open: outtakes true, held back still a wash');
  // The maker circles the other frame on view; an outtake cannot be circled.
  let r = await (await go(`/sheet/${s[1]}/pick`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'json=1' }, me)).json(); assert.ok(r.ok);
  assert.strictEqual(SH.list(m)[0].pick.slug, s[1], 'circled by hand');
  assert.strictEqual((await go(`/sheet/${s[2]}/pick`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'json=1' }, me)).status, 400);
  // The maker sees all, the studio list, the work page's line, Wander's More and its screen.
  const own = JSON.parse((await (await go(`/sheet/${s[1]}`, {}, me)).text()).match(/window.__WM_SHEET=(\{.*?\})<\/script>/)[1]);
  assert.ok(own.mine && own.frames.every(f => f.open));
  assert.ok(/Contact sheets\./.test(await (await go('/account/sheets', {}, me)).text()));
  assert.ok(/The contact sheet · 6 frames/.test(await (await go(`/w/${s[4]}`)).text()), 'the work page says it');
  assert.ok(app.locals.wanderJSON(db.prepare('SELECT * FROM works WHERE slug=?').get(s[4]), { cookies: {} }).sheet, 'Wander knows');
  const sc = SH.screen([]); assert.ok(sc && sc.kind === 'sheet' && /ctc-cut/.test(sc.film) && !/data-ctc-open/.test(sc.film), 'a still cut for Wander');
  assert.ok(/st-sheet/.test(SH.card(sc)));
  { const { strollPage } = require('../src/stroll'); const one = app.locals.wanderJSON(db.prepare('SELECT * FROM works WHERE slug=?').get(s[4]), { cookies: {} });
    const page = strollPage({ items: [one, sc, one], I: require('../src/icons') }); assert.ok(/st-sheet/.test(page) && /ctc-cut/.test(page), 'Wander draws the contact sheet screen on its own page (30 Oct: it threw)'); }
  assert.ok(/data-ctc/.test(await (await go(`/sheet/${s[6]}`)).text()) === false, 'a lone frame goes to its own page');
  console.log('sheets: ok'); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
