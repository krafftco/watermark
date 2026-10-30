// Every room, reachable and real (30 Oct, Will: "do we have every link accessible in the app?"; "none of it should be
// bullshit"). Every room on the maker's, the collector's and the house's sheet answers for that person; and every link
// on the studio's, the gallery's and the house's front pages answers too. A dead room fails the build.
process.env.NODE_ENV = 'test';
const assert = require('assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { createApp } = require('../src/app');
const V = require('../src/views');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-menus-'));
  const app = createApp({ dataDir: dir, base: 'http://localhost', adminPassword: 'pw', secret: 'menus', noTimers: true, vaultNow: true });
  const { db } = app.locals;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare("INSERT INTO makers (handle, name, email, kind, joined_at, door) VALUES ('mk','Mira Kell','mk@example.com','maker',datetime('now'),'house')").run();
  const jar = {};
  const go = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o, headers: { origin: base, accept: 'text/html', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(o.headers || {}) } }).then(r => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } return r; });
  await go('/studio/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=pw' });
  await go('/account?maker=mk'); await go('/yours');
  const bad = [];
  const check = async (h, who) => {
    if (/logout|signout/.test(h)) return;
    const r = await go(h); const loc = r.headers.get('location') || '';
    const body = r.status === 200 ? await r.text() : '';
    if (r.status >= 400 || /\/signin|\/studio\/door|\/studio\/login/.test(loc) || /class="nf\b|class="sign\b/.test(body.slice(0, 20000)) && /Not here|cannot find|no longer/i.test(body.slice(0, 20000))) bad.push(`${who} ${h} → ${r.status}${loc ? ' ' + loc : ''}`);
  };
  const rooms = groups => groups.flatMap(([, l]) => l.map(x => x[0]));
  for (const h of rooms(V.ROOMS.maker)) await check(h, 'maker');
  for (const h of rooms(V.ROOMS.yours)) await check(h, 'yours');
  for (const h of rooms(V.ROOMS.house)) await check(h, 'house');
  // The sheet is on the studio's and the house's pages, and the collector's.
  const acc = await (await go('/account')).text(); assert.ok(/data-rm-open/.test(acc) && /Contact sheets/.test(acc) && /Every room/.test(acc), 'the studio carries every room');
  const st = await (await go('/studio')).text(); assert.ok(/data-rm-open/.test(st) && /Feeds in/.test(st), 'the house carries every room');
  const yo = await (await go('/yours')).text(); assert.ok(/data-rm-open/.test(yo) && /commonplace/.test(yo), 'the gallery carries its rooms');
  // Every link on those front pages answers.
  const seen = new Set();
  for (const [page, html] of [['/account', acc], ['/studio', st], ['/yours', yo]]) {
    for (const m of html.matchAll(/href="(\/(?:account|studio|yours|notices|draw|wander)[^"#]*)"/g)) {
      const h = m[1].replace(/&amp;/g, '&'); if (seen.has(h) || /\.(csv|zip|pdf|json)(\?|$)/.test(h)) continue; seen.add(h); await check(h, 'link on ' + page);
    }
  }
  assert.deepStrictEqual(bad, [], 'every room answers:\n' + bad.join('\n'));
  console.log(`menus: ok (${rooms(V.ROOMS.maker).length + rooms(V.ROOMS.yours).length + rooms(V.ROOMS.house).length} rooms, ${seen.size} links)`); srv.close(); process.exit(0);
})().catch(e => { console.error(e.message || e); process.exit(1); });
